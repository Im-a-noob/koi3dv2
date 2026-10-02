import * as THREE from "three";

/**
 * PondFFTOcean — pond-adapted GPU FFT ocean core (WebGL2 only, no compute).
 *
 * Three cascades sized for an 85 m pond (default sizes [24, 6, 1.5] m,
 * grids [64, 64, 32]). Each cascade runs a Tessendorf-style pipeline:
 *
 *   H0 (CPU Phillips, once per sea-state)
 *     -> spectrum pass: h(k,t) = h0(k)*e^{iwt} + conj(h0(-k))*e^{-iwt},
 *        dispersion w = sqrt(9.81 * |k|), Dx/Dz spectra derived analytically
 *     -> Cooley-Tukey radix-2 DIF FFT via precomputed butterfly texture
 *        (log2N horizontal + log2N vertical ping-pong passes)
 *     -> combine: 1/N^2 normalize + (-1)^(x+y) recenter, finite-difference
 *        slopes + Jacobian folding factor.
 *
 * VRAM: per cascade ~6x N^2 RGBA half-float. For [64,64,32] this is
 * < 1 MiB total — far under the 30 MiB budget (no 512 grids here).
 *
 * Reference patterns: three.js Water.js float-target setup,
 * achrefelouafi/OceanThreejs (butterfly + normalize), webgl_gpgpu_water
 * ping-pong via fullscreen quad. Standalone module — NOT wired into
 * water.ts / PondCanvas yet.
 */

export interface PondSeaParams {
  windSpeed?: number; // m/s, pond scale 1..8
  windDir?: THREE.Vector2 | { x: number; y: number };
  choppiness?: number; // horizontal displacement scale, ~0..1.5
  heightScale?: number; // vertical amplitude multiplier
}

export interface PondCascadeTexture {
  /** RGBA: height, Dx, Dz, Jacobian. World tile size = `size` metres. */
  displacement: THREE.Texture;
  /** RGBA: slopeX, slopeZ, 0, 1. */
  slopes: THREE.Texture;
  /** Tile size in metres. */
  size: number;
  /** Grid resolution (N). */
  grid: number;
}

export interface PondFFTOptions {
  sizes?: number[];
  grids?: number[];
  seed?: number;
  heightScale?: number;
}

const GRAVITY = 9.81;
const TAU = Math.PI * 2;
const PHILLIPS_A = 0.0081;
const MAX_LOG_N = 7; // supports grids up to 128

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32 + Box-Muller), so sea states are reproducible.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    do {
      u = rng();
    } while (u <= 1e-9);
    v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(TAU * v);
    return mag * Math.cos(TAU * v);
  };
}

// ---------------------------------------------------------------------------
// Shaders (fullscreen quad, GLSL1 style — three upgrades to 300 es on WebGL2)
// ---------------------------------------------------------------------------

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Spectrum: H0 texture holds h0(k) in RG and h0(-k) in BA (k=0 texel is 0).
// k-vectors are derived arithmetically from the texel index.
const SPECTRUM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uH0;
uniform float uTime;
uniform float uSize;
uniform float uN;
uniform float uChop;
uniform float uMode; // 0: (H, Dx) -> bufA | 1: (Dz, 0) -> bufB

void main() {
  float i = floor(gl_FragCoord.x);
  float j = floor(gl_FragCoord.y);
  float half = uN * 0.5;
  float n = i <= half ? i : i - uN;
  float m = j <= half ? j : j - uN;
  float kx = 6.28318530718 * n / uSize;
  float kz = 6.28318530718 * m / uSize;
  float k = length(vec2(kx, kz));

  vec4 h0 = texture2D(uH0, vUv);
  float omega = sqrt(9.81 * k);
  float ph = omega * uTime;
  vec2 e = vec2(cos(ph), sin(ph));

  // h(k,t) = h0(k)*e^{iwt} + conj(h0(-k))*e^{-iwt}
  vec2 t1 = vec2(
    h0.r * e.x - h0.g * e.y,
    h0.r * e.y + h0.g * e.x
  );
  vec2 amc = vec2(h0.b, -h0.a);
  vec2 ec = vec2(e.x, -e.y);
  vec2 t2 = vec2(
    amc.x * ec.x - amc.y * ec.y,
    amc.x * ec.y + amc.y * ec.x
  );
  vec2 h = t1 + t2;

  vec2 kdir = k > 1e-6 ? vec2(kx, kz) / k : vec2(0.0);
  // Dx/Dz spectra = -i * (kx/k) * h * chop ; -i*(a+ib) = (b, -a)
  vec2 nih = vec2(h.y, -h.x);
  vec2 dx = nih * kdir.x * uChop;
  vec2 dz = nih * kdir.y * uChop;

  if (uMode < 0.5) {
    gl_FragColor = vec4(h, dx);
  } else {
    gl_FragColor = vec4(dz, vec2(0.0));
  }
}
`;

// One radix-2 DIF butterfly stage. LUT texel (x, stage):
//   R,G = twiddle W = exp(+i*2*pi*p/m) (IFFT sign — pairs with 1/N^2 normalize)
//   B,A = source texel indices srcA, srcB
const BUTTERFLY_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uButterfly;
uniform float uN;
uniform float uLogN;
uniform float uStage;
uniform float uHorizontal;

void main() {
  float idx = uHorizontal > 0.5 ? floor(gl_FragCoord.x) : floor(gl_FragCoord.y);
  vec4 lut = texture2D(uButterfly, vec2((idx + 0.5) / uN, (uStage + 0.5) / uLogN));
  vec2 w = lut.rg;
  float a = lut.b;
  float b = lut.a;

  vec2 uvA = uHorizontal > 0.5
    ? vec2((a + 0.5) / uN, vUv.y)
    : vec2(vUv.x, (a + 0.5) / uN);
  vec2 uvB = uHorizontal > 0.5
    ? vec2((b + 0.5) / uN, vUv.y)
    : vec2(vUv.x, (b + 0.5) / uN);
  vec4 va = texture2D(uSrc, uvA);
  vec4 vb = texture2D(uSrc, uvB);

  // DIF top/bottom flag (indices are precomputed; flag is cheap arithmetic).
  float mf = uN / pow(2.0, uStage);
  bool top = mod(idx, mf) < mf * 0.5;

  vec4 outv;
  if (top) {
    outv = va + vb;
  } else {
    vec2 d0 = va.rg - vb.rg;
    vec2 d1 = va.ba - vb.ba;
    outv = vec4(
      w.x * d0.x - w.y * d0.y, w.x * d0.y + w.y * d0.x,
      w.x * d1.x - w.y * d1.y, w.x * d1.y + w.y * d1.x
    );
  }
  gl_FragColor = outv;
}
`;

// Inversion + packing. DIF leaves data bit-reversed, so every fetch reverses.
// Applies 1/N^2 normalize and (-1)^(x+y) recenter per fetched texel.
const COMBINE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBufA; // RG: H complex, BA: Dx complex
uniform sampler2D uBufB; // RG: Dz complex
uniform float uN;
uniform float uLogN;
uniform float uSize;
uniform float uHeight;
uniform float uMode; // 0: (h, Dx, Dz, J) | 1: (slopeX, slopeZ, 0, 1)

int bitReverse(int x) {
  int r = 0;
  int xx = x;
  for (int s = 0; s < ${MAX_LOG_N}; s++) {
    if (s >= int(uLogN)) break;
    r = (r << 1) | (xx & 1);
    xx = xx >> 1;
  }
  return r;
}

vec2 revUv(int x, int y) {
  return (vec2(float(bitReverse(x)), float(bitReverse(y))) + 0.5) / uN;
}

float recenter(int x, int y) {
  return mod(float(x + y), 2.0) < 1.0 ? 1.0 : -1.0;
}

float norm() { return 1.0 / (uN * uN); }

float heightAt(int x, int y, int N) {
  int xi = (x + N) % N;
  int yi = (y + N) % N;
  return texture2D(uBufA, revUv(xi, yi)).r * norm() * recenter(xi, yi);
}

float dxAt(int x, int y, int N) {
  int xi = (x + N) % N;
  int yi = (y + N) % N;
  return texture2D(uBufA, revUv(xi, yi)).b * norm() * recenter(xi, yi);
}

float dzAt(int x, int y, int N) {
  int xi = (x + N) % N;
  int yi = (y + N) % N;
  return texture2D(uBufB, revUv(xi, yi)).r * norm() * recenter(xi, yi);
}

void main() {
  int N = int(uN);
  int x = int(floor(gl_FragCoord.x));
  int y = int(floor(gl_FragCoord.y));
  float wdx = uSize / uN; // world-space texel size

  if (uMode < 0.5) {
    float h = heightAt(x, y, N) * uHeight;
    float dx = dxAt(x, y, N);
    float dz = dzAt(x, y, N);
    // Jacobian via central differences of the displacement field.
    float dDxdx = (dxAt(x + 1, y, N) - dxAt(x - 1, y, N)) / (2.0 * wdx);
    float dDxdz = (dxAt(x, y + 1, N) - dxAt(x, y - 1, N)) / (2.0 * wdx);
    float dDzdx = (dzAt(x + 1, y, N) - dzAt(x - 1, y, N)) / (2.0 * wdx);
    float dDzdz = (dzAt(x, y + 1, N) - dzAt(x, y - 1, N)) / (2.0 * wdx);
    float J = max((1.0 + dDxdx) * (1.0 + dDzdz) - dDxdz * dDzdx, 0.0);
    gl_FragColor = vec4(h, dx, dz, J);
  } else {
    float sx = (heightAt(x + 1, y, N) - heightAt(x - 1, y, N)) / (2.0 * wdx);
    float sz = (heightAt(x, y + 1, N) - heightAt(x, y - 1, N)) / (2.0 * wdx);
    gl_FragColor = vec4(sx, sz, 0.0, 1.0);
  }
}
`;

// ---------------------------------------------------------------------------
// CPU-side spectrum / LUT builders
// ---------------------------------------------------------------------------

interface Cascade {
  size: number;
  N: number;
  logN: number;
  h0Data: Float32Array;
  h0Tex: THREE.DataTexture;
  butterflyTex: THREE.DataTexture;
  bufA: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  bufB: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  outDisp: THREE.WebGLRenderTarget;
  outSlope: THREE.WebGLRenderTarget;
}

export class PondFFTOcean {
  private renderer: THREE.WebGLRenderer | null = null;
  private simType: THREE.TextureDataType = THREE.HalfFloatType;
  private outFilter: THREE.TextureFilter = THREE.LinearFilter;

  private sizes: number[];
  private grids: number[];
  private seed: number;
  private heightScale: number;

  private windSpeed = 3;
  private windDir = new THREE.Vector2(1, 0);
  private choppiness = 0.8;
  private lastBuiltWindSpeed = NaN;
  private lastBuiltDirX = NaN;
  private lastBuiltDirZ = NaN;

  private cascades: Cascade[] = [];
  private quadScene: THREE.Scene | null = null;
  private quadCam: THREE.OrthographicCamera | null = null;
  private quadMesh: THREE.Mesh | null = null;
  private spectrumMat: THREE.ShaderMaterial | null = null;
  private butterflyMat: THREE.ShaderMaterial | null = null;
  private combineMat: THREE.ShaderMaterial | null = null;
  private disposed = false;

  constructor(opts: PondFFTOptions = {}) {
    this.sizes = opts.sizes ?? [24.0, 6.0, 1.5];
    this.grids = opts.grids ?? [64, 64, 32];
    // Random seed per load unless explicitly passed (deterministic option).
    this.seed = opts.seed ?? ((Date.now() % 100000) | 0);
    this.heightScale = opts.heightScale ?? 1.0;
    if (this.sizes.length !== this.grids.length) {
      throw new Error("PondFFTOcean: sizes and grids must match in length");
    }
    for (const n of this.grids) {
      if (n > 128 || (n & (n - 1)) !== 0) {
        throw new Error(
          `PondFFTOcean: grid ${n} must be a power of two <= 128 (pond VRAM budget)`
        );
      }
    }
  }

  // -- lifecycle ------------------------------------------------------------

  init(renderer: THREE.WebGLRenderer): void {
    if (this.renderer) return;
    if (!renderer.capabilities.isWebGL2) {
      throw new Error("PondFFTOcean requires WebGL2");
    }
    this.renderer = renderer;

    // HalfFloat render targets need EXT_color_buffer_float; otherwise fall
    // back to FloatType (same pattern as the PondCanvas refraction target,
    // which already assumes HalfFloat support).
    const canRenderHalfFloat = !!renderer.extensions.get(
      "EXT_color_buffer_float"
    );
    if (canRenderHalfFloat) {
      this.simType = THREE.HalfFloatType;
      this.outFilter = THREE.LinearFilter; // RGBA16F is filterable in WebGL2 core
    } else {
      this.simType = THREE.FloatType;
      const canFilterFloat = !!renderer.extensions.get(
        "OES_texture_float_linear"
      );
      this.outFilter = canFilterFloat
        ? THREE.LinearFilter
        : THREE.NearestFilter;
    }

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      undefined
    );
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);

    this.spectrumMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: SPECTRUM_FRAG,
      uniforms: {
        uH0: { value: null },
        uTime: { value: 0 },
        uSize: { value: 1 },
        uN: { value: 64 },
        uChop: { value: 0.8 },
        uMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.butterflyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BUTTERFLY_FRAG,
      uniforms: {
        uSrc: { value: null },
        uButterfly: { value: null },
        uN: { value: 64 },
        uLogN: { value: 6 },
        uStage: { value: 0 },
        uHorizontal: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.combineMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMBINE_FRAG,
      uniforms: {
        uBufA: { value: null },
        uBufB: { value: null },
        uN: { value: 64 },
        uLogN: { value: 6 },
        uSize: { value: 1 },
        uHeight: { value: 1 },
        uMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    for (let c = 0; c < this.sizes.length; c++) {
      this.cascades.push(this.createCascade(c));
    }
    this.rebuildH0();
  }

  /** Advance the simulation to `time` and run all GPU passes. */
  update(
    time: number,
    windSpeed: number,
    windDir: THREE.Vector2 | { x: number; y: number },
    choppiness: number
  ): void {
    if (!this.renderer || this.disposed) return;
    this.ensureSeaState(windSpeed, windDir, choppiness);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();

    for (const cas of this.cascades) {
      this.runCascade(cas, time);
    }

    r.setRenderTarget(prevTarget);
  }

  /**
   * Update sea parameters. Rebuilds the CPU H0 spectrum only (no GPU passes);
   * per-frame cost stays flat. heightScale/choppiness just set uniforms.
   */
  setSeaParams(params: PondSeaParams): void {
    let windChanged = false;
    if (params.windSpeed !== undefined && params.windSpeed !== this.windSpeed) {
      this.windSpeed = params.windSpeed;
      windChanged = true;
    }
    if (params.windDir !== undefined) {
      const nx = params.windDir.x;
      const nz = params.windDir.y;
      if (nx !== this.windDir.x || nz !== this.windDir.y) {
        this.windDir.set(nx, nz);
        windChanged = true;
      }
    }
    if (params.choppiness !== undefined) this.choppiness = params.choppiness;
    if (params.heightScale !== undefined) this.heightScale = params.heightScale;
    if (windChanged) this.rebuildH0();
  }

  getTextures(): PondCascadeTexture[] {
    return this.cascades.map((c) => ({
      displacement: c.outDisp.texture,
      slopes: c.outSlope.texture,
      size: c.size,
      grid: c.N,
    }));
  }

  getSeed(): number {
    return this.seed;
  }

  setSeed(seed: number): void {
    const s = seed >>> 0;
    if (s === this.seed) return;
    this.seed = s;
    this.lastBuiltWindSpeed = NaN;
    this.lastBuiltDirX = NaN;
    this.lastBuiltDirZ = NaN;
    if (this.cascades.length > 0) this.rebuildH0();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cascades) {
      c.h0Tex.dispose();
      c.butterflyTex.dispose();
      c.bufA[0].dispose();
      c.bufA[1].dispose();
      c.bufB[0].dispose();
      c.bufB[1].dispose();
      c.outDisp.dispose();
      c.outSlope.dispose();
    }
    this.cascades = [];
    this.quadMesh?.geometry.dispose();
    (this.quadMesh?.material as THREE.Material | null)?.dispose?.();
    this.spectrumMat?.dispose();
    this.butterflyMat?.dispose();
    this.combineMat?.dispose();
    this.renderer = null;
  }

  // -- internals ------------------------------------------------------------

  private ensureSeaState(
    windSpeed: number,
    windDir: THREE.Vector2 | { x: number; y: number },
    choppiness: number
  ): void {
    this.choppiness = choppiness;
    const dSpeed = Math.abs(windSpeed - this.windSpeed);
    const dDir = Math.hypot(windDir.x - this.windDir.x, windDir.y - this.windDir.y);
    if (dSpeed > 1e-3 || dDir > 2e-4) {
      this.windSpeed = windSpeed;
      this.windDir.set(windDir.x, windDir.y);
      this.rebuildH0();
    }
  }

  private makeRT(N: number, linear: boolean): THREE.WebGLRenderTarget {
    const filter: THREE.MagnificationTextureFilter = linear
      ? (this.outFilter as THREE.MagnificationTextureFilter)
      : THREE.NearestFilter;
    return new THREE.WebGLRenderTarget(N, N, {
      type: this.simType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private createCascade(index: number): Cascade {
    const N = this.grids[index];
    const size = this.sizes[index];
    const logN = Math.log2(N);
    if (!Number.isInteger(logN)) {
      throw new Error(`PondFFTOcean: grid ${N} is not a power of two`);
    }

    const h0Data = new Float32Array(N * N * 4);
    const h0Tex = new THREE.DataTexture(
      h0Data,
      N,
      N,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    h0Tex.minFilter = THREE.NearestFilter;
    h0Tex.magFilter = THREE.NearestFilter;
    h0Tex.wrapS = THREE.ClampToEdgeWrapping;
    h0Tex.wrapT = THREE.ClampToEdgeWrapping;
    h0Tex.needsUpdate = true;

    // Precomputed Cooley-Tukey DIF butterfly LUT: N x logN RGBA float.
    const lut = new Float32Array(N * logN * 4);
    for (let s = 0; s < logN; s++) {
      const m = N >> s;
      const half = m >> 1;
      for (let x = 0; x < N; x++) {
        const k = x % m;
        const base = Math.floor(x / m) * m;
        let twR: number;
        let twI: number;
        let srcA: number;
        let srcB: number;
        if (k < half) {
          twR = 1;
          twI = 0;
          srcA = base + k;
          srcB = base + k + half;
        } else {
          const p = k - half;
          const ang = (TAU * p) / m; // + sign: inverse DFT
          twR = Math.cos(ang);
          twI = Math.sin(ang);
          srcA = base + p;
          srcB = base + p + half;
        }
        const o = (s * N + x) * 4;
        lut[o] = twR;
        lut[o + 1] = twI;
        lut[o + 2] = srcA;
        lut[o + 3] = srcB;
      }
    }
    const butterflyTex = new THREE.DataTexture(
      lut,
      N,
      logN,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    butterflyTex.minFilter = THREE.NearestFilter;
    butterflyTex.magFilter = THREE.NearestFilter;
    butterflyTex.wrapS = THREE.ClampToEdgeWrapping;
    butterflyTex.wrapT = THREE.ClampToEdgeWrapping;
    butterflyTex.needsUpdate = true;

    // Final outputs are sampled by the water shader with repeat wrapping.
    const outDisp = this.makeRT(N, true);
    outDisp.texture.wrapS = THREE.RepeatWrapping;
    outDisp.texture.wrapT = THREE.RepeatWrapping;
    const outSlope = this.makeRT(N, true);
    outSlope.texture.wrapS = THREE.RepeatWrapping;
    outSlope.texture.wrapT = THREE.RepeatWrapping;

    return {
      size,
      N,
      logN,
      h0Data,
      h0Tex,
      butterflyTex,
      bufA: [this.makeRT(N, false), this.makeRT(N, false)],
      bufB: [this.makeRT(N, false), this.makeRT(N, false)],
      outDisp,
      outSlope,
    };
  }

  /** Phillips spectrum H0(k) on CPU — once per sea-state, never per-frame. */
  private rebuildH0(): void {
    if (
      this.windSpeed === this.lastBuiltWindSpeed &&
      this.windDir.x === this.lastBuiltDirX &&
      this.windDir.y === this.lastBuiltDirZ
    ) {
      return;
    }
    this.lastBuiltWindSpeed = this.windSpeed;
    this.lastBuiltDirX = this.windDir.x;
    this.lastBuiltDirZ = this.windDir.y;

    // Pond-scale winds: 1..8 m/s mapped from the uWind 0..1 uniform.
    const V = Math.min(Math.max(this.windSpeed, 0.5), 8);
    const wlen = Math.hypot(this.windDir.x, this.windDir.y);
    const wx = wlen > 1e-6 ? this.windDir.x / wlen : 1;
    const wz = wlen > 1e-6 ? this.windDir.y / wlen : 0;
    const L = (V * V) / GRAVITY;
    const dampL = 0.02; // suppress sub-cm capillary shimmer

    for (let c = 0; c < this.cascades.length; c++) {
      const cas = this.cascades[c];
      const { N, size } = cas;
      const rng = mulberry32(this.seed + c * 1013);
      const gauss = makeGaussian(rng);
      const half = N / 2;
      for (let j = 0; j < N; j++) {
        const mj = j <= half ? j : j - N;
        for (let i = 0; i < N; i++) {
          const ni = i <= half ? i : i - N;
          const o = (j * N + i) * 4;
          const kx = (TAU * ni) / size;
          const kz = (TAU * mj) / size;
          const k = Math.hypot(kx, kz);
          if (k < 1e-6) {
            cas.h0Data[o] = 0;
            cas.h0Data[o + 1] = 0;
            cas.h0Data[o + 2] = 0;
            cas.h0Data[o + 3] = 0;
            continue;
          }
          const kdx = kx / k;
          const kdz = kz / k;
          const kDotW = kdx * wx + kdz * wz;
          const kL = k * L;
          let P =
            (PHILLIPS_A * Math.exp(-1 / (kL * kL))) /
            (k * k * k * k);
          P *= kDotW * kDotW;
          P *= Math.exp(-k * k * dampL * dampL);
          const amp = Math.sqrt(Math.max(P, 0) / 2);
          cas.h0Data[o] = amp * gauss();
          cas.h0Data[o + 1] = amp * gauss();

          const ii = (N - i) % N;
          const jj = (N - j) % N;
          const ni2 = ii <= half ? ii : ii - N;
          const mj2 = jj <= half ? jj : jj - N;
          const kx2 = (TAU * ni2) / size;
          const kz2 = (TAU * mj2) / size;
          const k2 = Math.hypot(kx2, kz2);
          let Pm = 0;
          if (k2 > 1e-6) {
            const kd2 = (kx2 * wx + kz2 * wz) / k2;
            const kL2 = k2 * L;
            Pm =
              ((PHILLIPS_A * Math.exp(-1 / (kL2 * kL2))) /
                (k2 * k2 * k2 * k2)) *
              kd2 *
              kd2 *
              Math.exp(-k2 * k2 * dampL * dampL);
          }
          const ampm = Math.sqrt(Math.max(Pm, 0) / 2);
          cas.h0Data[o + 2] = ampm * gauss();
          cas.h0Data[o + 3] = ampm * gauss();
        }
      }
      cas.h0Tex.needsUpdate = true;
    }
  }

  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    if (!this.renderer || !this.quadScene || !this.quadCam || !this.quadMesh) {
      return;
    }
    this.quadMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  private runCascade(cas: Cascade, time: number): void {
    const spec = this.spectrumMat!;
    const bf = this.butterflyMat!;
    const comb = this.combineMat!;

    spec.uniforms.uH0.value = cas.h0Tex;
    spec.uniforms.uTime.value = time;
    spec.uniforms.uSize.value = cas.size;
    spec.uniforms.uN.value = cas.N;
    spec.uniforms.uChop.value = this.choppiness;
    spec.uniforms.uMode.value = 0;
    this.blit(spec, cas.bufA[0]);
    spec.uniforms.uMode.value = 1;
    this.blit(spec, cas.bufB[0]);

    let ping = 0;
    let pong = 1;
    bf.uniforms.uButterfly.value = cas.butterflyTex;
    bf.uniforms.uN.value = cas.N;
    bf.uniforms.uLogN.value = cas.logN;
    for (let s = 0; s < cas.logN; s++) {
      bf.uniforms.uStage.value = s;
      bf.uniforms.uHorizontal.value = 1;
      bf.uniforms.uSrc.value = cas.bufA[ping].texture;
      this.blit(bf, cas.bufA[pong]);
      bf.uniforms.uSrc.value = cas.bufB[ping].texture;
      this.blit(bf, cas.bufB[pong]);
      const t = ping;
      ping = pong;
      pong = t;
    }
    for (let s = 0; s < cas.logN; s++) {
      bf.uniforms.uStage.value = s;
      bf.uniforms.uHorizontal.value = 0;
      bf.uniforms.uSrc.value = cas.bufA[ping].texture;
      this.blit(bf, cas.bufA[pong]);
      bf.uniforms.uSrc.value = cas.bufB[ping].texture;
      this.blit(bf, cas.bufB[pong]);
      const t = ping;
      ping = pong;
      pong = t;
    }

    comb.uniforms.uBufA.value = cas.bufA[ping].texture;
    comb.uniforms.uBufB.value = cas.bufB[ping].texture;
    comb.uniforms.uN.value = cas.N;
    comb.uniforms.uLogN.value = cas.logN;
    comb.uniforms.uSize.value = cas.size;
    comb.uniforms.uHeight.value = this.heightScale;
    comb.uniforms.uMode.value = 0;
    this.blit(comb, cas.outDisp);
    comb.uniforms.uMode.value = 1;
    this.blit(comb, cas.outSlope);
  }
}
