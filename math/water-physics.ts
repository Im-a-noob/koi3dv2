import * as THREE from "three";

export interface WaterSurfaceState {
  y: number;
  normal: THREE.Vector3;
  tiltX: number; // Pitch angle in radians (for rotation.x)
  tiltZ: number; // Roll angle in radians (for rotation.z)
}

// 4 Calibrated Gerstner Wave Octaves matching GLSL shader
export interface GerstnerWaveParams {
  dx: number;
  dz: number;
  wavelength: number;
  speed: number;
  amplitude: number;
  steepness: number;
}

export const GERSTNER_WAVES: readonly GerstnerWaveParams[] = [
  // 1. Primary Wind Swell
  { dx: 0.82, dz: 0.57, wavelength: 2.6, speed: 1.15, amplitude: 0.016, steepness: 1.8 },
  // 2. Cross Swell
  { dx: -0.45, dz: 0.89, wavelength: 1.75, speed: 1.35, amplitude: 0.011, steepness: 1.6 },
  // 3. Diagonal Chop
  { dx: 0.95, dz: -0.31, wavelength: 1.05, speed: 1.65, amplitude: 0.0065, steepness: 1.0 },
  // 4. Micro Capillary Ripples
  { dx: -0.71, dz: -0.71, wavelength: 0.52, speed: 2.1, amplitude: 0.0035, steepness: 1.0 },
];

// Scattered low-amplitude chop octaves breaking the 4-dir tiling.
// Nominal total (4 legacy + 2 extra at w=1, gust=1): 0.043 m < 5 cm pond-safe.
export const EXTRA_CHOP_WAVES: readonly GerstnerWaveParams[] = [
  { dx: 0.31, dz: 0.95, wavelength: 0.7, speed: 1.9, amplitude: 0.004, steepness: 1.0 },
  { dx: -0.88, dz: 0.47, wavelength: 0.35, speed: 2.4, amplitude: 0.002, steepness: 1.0 },
];

// hsh-derived phase offsets (hsh(1,2), hsh(3,1), hsh(3.1,7.7), hsh(5.2,1.3) x TAU).
const PHASE_1 = 3.0340149;
const PHASE_2 = 3.9565355;
const PHASE_5 = 3.8330216;
const PHASE_6 = 3.4558566;

function cpuHsh(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function cpuVn(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = cpuHsh(ix, iy);
  const b = cpuHsh(ix + 1, iy);
  const c = cpuHsh(ix, iy + 1);
  const d = cpuHsh(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function cpuFbm(x: number, y: number): number {
  let s = 0;
  let a = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    s += a * cpuVn(px, py);
    px *= 2.03;
    py *= 2.03;
    a *= 0.5;
  }
  return s;
}

function jitterAngle(t: number): number {
  void t;
  return 0;
}

function gustFactor(x: number, z: number, t: number): number {
  void x;
  void z;
  void t;
  return 1.0;
}

function rotDir(dx: number, dz: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [dx * c - dz * s, dx * s + dz * c];
}

/**
 * Defaults for the coarse CPU heightfield mirror (see fft-cpu-spec.md §b).
 * Size 64 over a 20 world-unit window (±10) → texel ≈ 0.31 u.
 */
export const FFT_HEIGHTFIELD_DEFAULTS = {
  size: 64,
  worldExtent: 20,
} as const;

/**
 * Injected GPU FFT heightfield sampler (sampler injection only;
 * readback wiring is future PondCanvas work).
 */
export interface FftHeightSampler {
  /** Heightfield resolution per side; e.g. 64. */
  readonly size: number;
  /** Full window extent in world units; e.g. 20 (±10). Queries outside clamp. */
  readonly worldExtent: number;
  /** Bilinear height sample; returns metres. */
  sampleHeight(x: number, z: number): number;
  /** Monotonic version counter; bumped per readback refresh. */
  readonly version: number;
}

let fftHeightSampler: FftHeightSampler | null = null;
let fftMirrorEnabled = false;
let lastSamplerVersion = Number.NaN;
let lastVersionUpdateMs = 0;
let fftStaleWarned = false;

/** Called once by the water system when the readback target is ready. */
export function setFftHeightSampler(s: FftHeightSampler | null): void {
  fftHeightSampler = s;
  lastSamplerVersion = Number.NaN;
  lastVersionUpdateMs = 0;
  fftStaleWarned = false;
}

/** Toggle mirror without touching callers. Default false → exact analytic path. */
export function setFftMirrorEnabled(on: boolean): void {
  fftMirrorEnabled = on;
  if (!on) {
    fftStaleWarned = false;
  }
}

function isSamplerStale(sampler: FftHeightSampler): boolean {
  const now = Date.now();
  if (sampler.version !== lastSamplerVersion) {
    lastSamplerVersion = sampler.version;
    lastVersionUpdateMs = now;
    fftStaleWarned = false;
    return false;
  }
  if (lastVersionUpdateMs === 0) {
    lastVersionUpdateMs = now;
    return false;
  }
  return now - lastVersionUpdateMs > 500;
}

/**
 * FFT mirror path: bilinear sampler height + central-difference gradient
 * (eps = worldExtent / size) + analytic ripples additive. No fixed-point
 * iteration: the heightfield is already the displaced surface re-sampled
 * on a regular grid, so a plain bilinear lookup is the evaluated surface.
 */
export function getWaterSurfaceFFT(
  x: number,
  z: number,
  time: number,
  wind: number = 0.15,
  ripples?: THREE.Vector4[],
  sampler: FftHeightSampler | null = fftHeightSampler,
  activity: number = 0
): WaterSurfaceState {
  // Still-water mode: ambient FFT swell disabled, ripple-only surface.
  activity = 0;
  const active = sampler ?? fftHeightSampler;
  if (!active) {
    return getWaterSurfaceAnalytic(x, z, time, wind, ripples, activity);
  }
  const eps = active.worldExtent / active.size;
  let h = active.sampleHeight(x, z);
  let gradX =
    (active.sampleHeight(x + eps, z) - active.sampleHeight(x - eps, z)) /
    (2 * eps);
  let gradZ =
    (active.sampleHeight(x, z + eps) - active.sampleHeight(x, z - eps)) /
    (2 * eps);

  // Gate the ambient FFT swell field by fish activity (zero-mean
  // displacement, so direct scaling holds the surface at 0 when calm).
  h *= activity;
  gradX *= activity;
  gradZ *= activity;

  // Evaluate dynamic ripples if provided
  if (ripples && ripples.length > 0) {
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      const age = time - r.z;
      if (age < 0 || age > 5.0) continue;

      const rx = r.x;
      const rz = r.y; // note: Vector4 stores (x, z, birthTime, amp) -> (x, y, z, w)
      const diffX = x - rx;
      const diffZ = z - rz;
      const d = Math.hypot(diffX, diffZ);
      const q = d - age * 1.35;

      const env =
        ((Math.exp(-q * q * 2.2) * Math.exp(-age * 0.75) * r.w) / (1.0 + d * 0.9)) *
        0.05;
      const sinQ = Math.sin(q * 10.0);
      const cosQ = Math.cos(q * 10.0);

      h += sinQ * env;

      if (d > 0.001) {
        const dirX = diffX / d;
        const dirZ = diffZ / d;
        const dEnv = -4.4 * q * env;
        const dH = 10.0 * cosQ * env + sinQ * dEnv;
        gradX += dirX * dH;
        gradZ += dirZ * dH;
      }
    }
  }

  const normal = new THREE.Vector3(-gradX, 1.0, -gradZ).normalize();
  const tiltX = Math.atan2(-gradZ, 1.0);
  const tiltZ = Math.atan2(gradX, 1.0);

  return {
    y: h,
    normal,
    tiltX,
    tiltZ,
  };
}

/**
 * Preserved entry point: routes to the FFT mirror when enabled with a
 * live sampler, else the exact analytic path. All callers compile untouched.
 */
export function getWaterSurface(
  x: number,
  z: number,
  time: number,
  wind: number = 0.15,
  ripples?: THREE.Vector4[],
  activity: number = 0
): WaterSurfaceState {
  // Still-water mode: ambient FFT swell disabled, ripple-only surface.
  activity = 0;
  if (fftMirrorEnabled && fftHeightSampler) {
    if (isSamplerStale(fftHeightSampler)) {
      if (!fftStaleWarned) {
        fftStaleWarned = true;
        console.warn(
          "[water-physics] FFT height sampler stale (>500ms) — downgrading to analytic surface"
        );
      }
      return getWaterSurfaceAnalytic(x, z, time, wind, ripples, activity);
    }
    return getWaterSurfaceFFT(x, z, time, wind, ripples, fftHeightSampler, activity);
  }
  return getWaterSurfaceAnalytic(x, z, time, wind, ripples, activity);
}

/**
 * Computes exact water height, surface normal, and pitch/roll tilt
 * perfectly synchronized between CPU and GPU.
 */
export function getWaterSurfaceAnalytic(
  x: number,
  z: number,
  time: number,
  wind: number = 0.15,
  ripples?: THREE.Vector4[],
  activity: number = 0
): WaterSurfaceState {
  // Still-water mode: ambient Gerstner/chop disabled, ripple-only surface.
  activity = 0;
  wind = 0;
  const w = 1.0 + wind * 1.5;
  const rotA = jitterAngle(time);
  const gust = gustFactor(x, z, time);
  let h = 0;
  let gradX = 0;
  let gradZ = 0;

  // 4 legacy Gerstner octaves with jittered swell dirs (1-2) + gust.
  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const wave = GERSTNER_WAVES[i];
    let dx = wave.dx;
    let dz = wave.dz;
    let phaseOff = 0;
    if (i === 0) {
      [dx, dz] = rotDir(dx, dz, rotA);
      phaseOff = PHASE_1;
    } else if (i === 1) {
      [dx, dz] = rotDir(dx, dz, -rotA * 0.7);
      phaseOff = PHASE_2;
    }
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;

    const k = (2 * Math.PI) / wave.wavelength;
    const amp = wave.amplitude * w * gust * activity;
    const phase = k * (nx * x + nz * z) - k * wave.speed * time * w + phaseOff;

    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    if (wave.steepness > 1.05) {
      // Trochoidal sharp crest, broad trough
      const normSin = sinP * 0.5 + 0.5;
      const crest = Math.pow(Math.max(0, normSin), wave.steepness) * 2.0 - 1.0;
      h += amp * crest;
      const dCrest = wave.steepness * Math.pow(Math.max(0, normSin), wave.steepness - 1.0) * cosP;
      gradX += amp * k * nx * dCrest;
      gradZ += amp * k * nz * dCrest;
    } else {
      h += amp * sinP;
      gradX += amp * k * nx * cosP;
      gradZ += amp * k * nz * cosP;
    }
  }

  // 2 scattered chop octaves with matching jitter.
  for (let j = 0; j < EXTRA_CHOP_WAVES.length; j++) {
    const wave = EXTRA_CHOP_WAVES[j];
    let dx = wave.dx;
    let dz = wave.dz;
    const phaseOff = j === 0 ? PHASE_5 : PHASE_6;
    if (j === 0) {
      [dx, dz] = rotDir(dx, dz, rotA * 0.5);
    } else {
      [dx, dz] = rotDir(dx, dz, -rotA * 0.5);
    }
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const k = (2 * Math.PI) / wave.wavelength;
    const amp = wave.amplitude * w * gust * activity;
    const phase = k * (nx * x + nz * z) - k * wave.speed * time * w + phaseOff;
    h += amp * Math.sin(phase);
    const c = amp * k * Math.cos(phase);
    gradX += c * nx;
    gradZ += c * nz;
  }

  // Evaluate dynamic ripples if provided
  if (ripples && ripples.length > 0) {
    for (let i = 0; i < ripples.length; i++) {
      const r = ripples[i];
      const age = time - r.z;
      if (age < 0 || age > 5.0) continue;

      const rx = r.x;
      const rz = r.y; // note: Vector4 stores (x, z, birthTime, amp) -> (x, y, z, w)
      const diffX = x - rx;
      const diffZ = z - rz;
      const d = Math.hypot(diffX, diffZ);
      const q = d - age * 1.35;

      const env =
        ((Math.exp(-q * q * 2.2) * Math.exp(-age * 0.75) * r.w) / (1.0 + d * 0.9)) *
        0.05;
      const sinQ = Math.sin(q * 10.0);
      const cosQ = Math.cos(q * 10.0);

      h += sinQ * env;

      if (d > 0.001) {
        const dirX = diffX / d;
        const dirZ = diffZ / d;
        const dEnv = -4.4 * q * env;
        const dH = 10.0 * cosQ * env + sinQ * dEnv;
        gradX += dirX * dH;
        gradZ += dirZ * dH;
      }
    }
  }

  const normal = new THREE.Vector3(-gradX, 1.0, -gradZ).normalize();
  const tiltX = Math.atan2(-gradZ, 1.0);
  const tiltZ = Math.atan2(gradX, 1.0);

  return {
    y: h,
    normal,
    tiltX,
    tiltZ,
  };
}
