import * as THREE from "three";
import { sharedUniforms } from "./underwater";

export const RIPN = 24;

export function createWaterMaterial(camera: THREE.PerspectiveCamera) {
  const ripples = Array.from({ length: RIPN }, () => new THREE.Vector4(0, 0, -100, 0));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: null },
      uDepth: { value: null },
      uRes: { value: new THREE.Vector2() },
      uTime: sharedUniforms.uTime,
      uRipples: { value: ripples },
      uSkyTop: { value: new THREE.Color(0.24, 0.45, 0.72) },
      uSkyHor: { value: new THREE.Color(0.72, 0.82, 0.9) },
      uCloudCol: { value: new THREE.Color(0.85, 0.88, 0.92) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 0.96, 0.88) },
      uSpec: { value: 1.0 },
      uCloud: { value: 0.3 },
      uRain: { value: 0 },
      uWind: { value: 0 },
      // Smoothed fish activity 0..1. Gates ALL ambient swell/FFT/chop
      // amplitude: 0 = glass calm (ripples/rain only), 1 = full living waves.
      // Wind advects/amplifies existing ripples but never creates swell alone.
      uActivity: { value: 0.0 },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      // FFT cascade inputs (PondFFTOcean.getTextures(); legacy default-off).
      // uFFTHeightN bind to displacement textures (RGBA = h, Dx, Dz, Jacobian).
      // Slopes for the vertex normal are derived by forward differences on the
      // height (R) channel, so only these 3 samplers need wiring.
      uFFTHeight0: { value: null },
      uFFTHeight1: { value: null },
      uFFTHeight2: { value: null },
      uFFTTile: { value: new THREE.Vector3(24.0, 6.0, 1.5) },
      uHeightScale: { value: 1.0 },
      uChoppiness: { value: 1.0 },
      uSwellKeep: { value: 0.5 },
      uFoamStrength: { value: 0.35 },
      uHasFFT: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #ifdef USE_FFT
      varying vec3 vNormalW;   // analytic FFT + swell normal (world)
      varying vec2 vC2Slope;   // full-weight c2 slope for near-field fragment detail
      varying float vJacobian; // combined crest factor (~1 flat -> 0 pinched)
      varying float vFFTHeight;// displaced height (foam crest gate)
      uniform sampler2D uFFTHeight0; // RGBA: h, Dx, Dz, Jacobian
      uniform sampler2D uFFTHeight1;
      uniform sampler2D uFFTHeight2;
      uniform vec3 uFFTTile;     // world tile size per cascade, matches fft-ocean sizes
      uniform float uHeightScale;
      uniform float uChoppiness;
      uniform float uSwellKeep;
       uniform float uTime;
       uniform float uWind;
       uniform float uActivity;

      // VS-safe fetch with explicit LOD (GLSL1-on-WebGL2 compatible).
      vec4 fftSample(sampler2D t, vec2 uv) {
        #if defined(GL_EXT_shader_texture_lod)
          return texture2DLodEXT(t, uv, 0.0);
        #else
          return texture2D(t, uv); // vertex shader: implicit LOD 0 on WebGL2
        #endif
      }

      float whsh(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float wvn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(whsh(i), whsh(i + vec2(1.0, 0.0)), u.x),
                   mix(whsh(i + vec2(0.0, 1.0)), whsh(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float wfbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          s += a * wvn(p);
          p *= 2.03;
          a *= 0.5;
        }
        return s;
      }
      vec2 wrot(vec2 d, float a) {
        float c = cos(a), s = sin(a);
        return vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      }
      #endif
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        #ifdef USE_FFT
          vec2 pxz = w.xz; // static mesh: model-space XZ == world XZ
          vec2 uv0 = pxz / uFFTTile.x;
          vec2 uv1 = pxz / uFFTTile.y;
          vec2 uv2 = pxz / uFFTTile.z;
          vec4 s0 = fftSample(uFFTHeight0, uv0);
          vec4 s1 = fftSample(uFFTHeight1, uv1);
          #ifndef FFT_TWO_CASCADE
            vec4 s2 = fftSample(uFFTHeight2, uv2);
          #else
            vec4 s2 = vec4(0.0, 0.0, 0.0, 1.0);
          #endif

          // Forward-difference slopes from the height (R) channel.
          // Epsilon ~1 texel per cascade keeps the gradient exact under LinearFilter.
          float e0 = uFFTTile.x * 0.02;
          float e1 = uFFTTile.y * 0.02;
          float e2 = uFFTTile.z * 0.02;
          vec2 g0 = vec2(
            fftSample(uFFTHeight0, uv0 + vec2(e0 / uFFTTile.x, 0.0)).x - s0.x,
            fftSample(uFFTHeight0, uv0 + vec2(0.0, e0 / uFFTTile.x)).x - s0.x) / e0;
          vec2 g1 = vec2(
            fftSample(uFFTHeight1, uv1 + vec2(e1 / uFFTTile.y, 0.0)).x - s1.x,
            fftSample(uFFTHeight1, uv1 + vec2(0.0, e1 / uFFTTile.y)).x - s1.x) / e1;
          #ifndef FFT_TWO_CASCADE
            vec2 g2 = vec2(
              fftSample(uFFTHeight2, uv2 + vec2(e2 / uFFTTile.z, 0.0)).x - s2.x,
              fftSample(uFFTHeight2, uv2 + vec2(0.0, e2 / uFFTTile.z)).x - s2.x) / e2;
            float jac = (s0.w + s1.w + s2.w) / 3.0;
          #else
            vec2 g2 = vec2(0.0);
            float jac = (s0.w + s1.w) / 2.0;
          #endif

          float hFFT = (s0.x + s1.x + s2.x) * uHeightScale * uActivity * 0.0;
          // True horizontal chop from the Dx/Dz channels (metres).
          vec2 chop = vec2(s0.y + s1.y + s2.y, s0.z + s1.z + s2.z) * uActivity * 0.0;
          // C2_NORMAL_W ~0.5: c2 half-weight in the vertex normal (avoids
          // sub-metre aliasing on the 0.33 m lattice); full weight returns
          // in the fragment via vC2Slope with a distance fade.
          vec2 gFFT = (g0 + g1 + g2 * 0.5) * uHeightScale * uActivity * 0.0;
          vec2 gC2 = g2 * uHeightScale * uActivity * 0.0;

          // Gerstner swell fallback: analytic waves 1-2 at uSwellKeep so the
          // pond keeps its signature directional swell in FFT mode.
          // Direction jitter (slow uTime rotation) + hsh-derived phase offsets
          // break the fixed 4-dir tiling; gust fbm breathes the amplitude.
          // Extra chop octaves 5-6 ride at uSwellKeep. Mirror math lives in
          // water-physics.ts getWaterSurfaceAnalytic (same constants).
          float wnd = 1.0;
          float rotA = 0.0;
          float gust = 1.0;
          float hSwell = 0.0;
          vec2 gSwell = vec2(0.0);
          {
            vec2 d = wrot(vec2(0.821, 0.571), rotA);
            float k = 6.283185 / 2.6;
            float amp = 0.016 * wnd * uSwellKeep * gust * uActivity * 0.0; // frozen
            float phase = k * dot(d, pxz) - (k * 1.15) * uTime * wnd + 3.0340149;
            float normSin = sin(phase) * 0.5 + 0.5;
            hSwell += amp * (pow(max(0.0, normSin), 1.8) * 2.0 - 1.0);
            gSwell += amp * k * d * (1.8 * pow(max(0.0, normSin), 0.8) * cos(phase));
          }
          {
            vec2 d = wrot(vec2(-0.451, 0.892), -rotA * 0.7);
            float k = 6.283185 / 1.75;
            float amp = 0.011 * wnd * uSwellKeep * gust * uActivity * 0.0; // frozen
            float phase = k * dot(d, pxz) - (k * 1.35) * uTime * wnd + 3.9565355;
            float normSin = sin(phase) * 0.5 + 0.5;
            hSwell += amp * (pow(max(0.0, normSin), 1.6) * 2.0 - 1.0);
            gSwell += amp * k * d * (1.6 * pow(max(0.0, normSin), 0.6) * cos(phase));
          }
          {
            vec2 d = wrot(vec2(0.31, 0.95), rotA * 0.5);
            float k = 6.283185 / 0.7;
            float amp = 0.004 * wnd * uSwellKeep * gust * uActivity * 0.0; // frozen
            float phase = k * dot(d, pxz) - (k * 1.9) * uTime * wnd + 3.8330216;
            hSwell += amp * sin(phase);
            gSwell += amp * k * d * cos(phase);
          }
          {
            vec2 d = wrot(vec2(-0.88, 0.47), -rotA * 0.5);
            float k = 6.283185 / 0.35;
            float amp = 0.002 * wnd * uSwellKeep * gust * uActivity * 0.0; // frozen
            float phase = k * dot(d, pxz) - (k * 2.4) * uTime * wnd + 3.4558566;
            hSwell += amp * sin(phase);
            gSwell += amp * k * d * cos(phase);
          }

          w.xz += chop * uChoppiness * 0.0;
          w.y += hFFT + hSwell;

          vec2 g = gFFT + gSwell;
          vNormalW = normalize(vec3(-g.x, 1.0, -g.y));
          vC2Slope = gC2;
          vJacobian = jac;
          vFFTHeight = hFFT + hSwell;
        #endif
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform sampler2D uDepth;
      uniform vec2 uRes;
      uniform float uTime;
      uniform vec4 uRipples[${RIPN}];
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHor;
      uniform vec3 uCloudCol;
      uniform vec3 uSunDir;
      uniform vec3 uSunCol;
      uniform float uSpec;
      uniform float uCloud;
      uniform float uRain;
      uniform float uWind;
      uniform float uActivity;
      uniform float uNear;
      uniform float uFar;
      varying vec3 vW;
      #ifdef USE_FFT
      varying vec3 vNormalW;
      varying vec2 vC2Slope;
      varying float vJacobian;
      varying float vFFTHeight;
      uniform float uHasFFT;     // 1.0 once cascade textures are bound, else grad-path fallback
      uniform float uFoamStrength;
      #endif

      float hsh(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x),
                   mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          s += a * vn(p);
          p *= 2.03;
          a *= 0.5;
        }
        return s;
      }

      float rainRipples(vec2 p) {
        float h = 0.0;
        for (int L = 0; L < 3; L++) {
          float fl = float(L);
          vec2 q = p * (1.7 + fl * 0.55) + fl * 13.7;
          vec2 cell = floor(q);
          vec2 f = fract(q);
          float r0 = hsh(cell + fl * 7.1);
          float rate = 0.9 + r0 * 0.7;
          float cyc = uTime * rate + r0 * 10.0;
          float life = fract(cyc);
          vec2 c = vec2(hsh(cell + 1.3 + floor(cyc)), hsh(cell + 4.7 + floor(cyc))) * 0.5 + 0.25;
          float d = length(f - c);
          float x = d - life * 0.42;
          float ring = sin(x * 42.0) * exp(-x * x * 260.0) * (1.0 - life) * (1.0 - life);
          float on = step(hsh(cell + 9.1 + floor(cyc)), uRain);
          h += ring * on;
        }
        return h * 0.0035;
      }

      // Analytical Gerstner Trochoidal Waves + Ripples
      // Jitter/gust/chop constants mirror water-physics.ts exactly.
      vec2 wrotF(vec2 d, float a) {
        float c = cos(a), s = sin(a);
        return vec2(d.x * c - d.y * s, d.x * s + d.y * c);
      }
      void evaluateWaterSurface(vec2 p, out float h, out vec2 grad) {
        // Frozen: glass-calm ambient. w/rotA/gust held constant so no
        // time/wind auto-motion; ambient amps below are gated to 0 and only
        // uRipples + rain add height. Uniforms (uTime/uWind/uActivity) kept
        // for API compatibility.
        float w = 1.0;
        float rotA = 0.0;
        float gust = 1.0;
        h = 0.0;
        grad = vec2(0.0);

        // In FFT mode the vertex shader already applied swell (waves 1-2 at
        // uSwellKeep) plus the FFT field; chop/micro (waves 3-4) come from the
        // spectrum. The fragment therefore adds ripples + rain only.
        #ifndef USE_FFT
        // 1. Primary Wind Swell (Trochoid peak)
        {
          vec2 d = wrotF(vec2(0.821, 0.571), rotA);
          float k = 6.283185 / 2.6;
          float amp = 0.016 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 1.15) * uTime * w + 3.0340149;
          float sinP = sin(phase);
          float cosP = cos(phase);
          float normSin = sinP * 0.5 + 0.5;
          h += amp * (pow(max(0.0, normSin), 1.8) * 2.0 - 1.0);
          float dCrest = 1.8 * pow(max(0.0, normSin), 0.8) * cosP;
          grad += amp * k * d * dCrest;
        }

        // 2. Cross Swell (Trochoid peak)
        {
          vec2 d = wrotF(vec2(-0.451, 0.892), -rotA * 0.7);
          float k = 6.283185 / 1.75;
          float amp = 0.011 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 1.35) * uTime * w + 3.9565355;
          float sinP = sin(phase);
          float cosP = cos(phase);
          float normSin = sinP * 0.5 + 0.5;
          h += amp * (pow(max(0.0, normSin), 1.6) * 2.0 - 1.0);
          float dCrest = 1.6 * pow(max(0.0, normSin), 0.6) * cosP;
          grad += amp * k * d * dCrest;
        }

        // 3. Diagonal Chop
        {
          vec2 d = vec2(0.951, -0.309);
          float k = 6.283185 / 1.05;
          float amp = 0.0065 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 1.65) * uTime * w;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }

        // 4. Micro Capillary Ripples
        {
          vec2 d = vec2(-0.707, -0.707);
          float k = 6.283185 / 0.52;
          float amp = 0.0035 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 2.1) * uTime * w;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }

        // 5. Scattered chop octave
        {
          vec2 d = wrotF(vec2(0.31, 0.95), rotA * 0.5);
          float k = 6.283185 / 0.7;
          float amp = 0.004 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 1.9) * uTime * w + 3.8330216;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }

        // 6. Fine capillary chop octave
        {
          vec2 d = wrotF(vec2(-0.88, 0.47), -rotA * 0.5);
          float k = 6.283185 / 0.35;
          float amp = 0.002 * w * gust * uActivity * 0.0; // frozen
          float phase = k * dot(d, p) - (k * 2.4) * uTime * w + 3.4558566;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }
        #endif // !USE_FFT

        // 5. Dynamic Interactive Ripples (Analytical Gradient)
        for (int i = 0; i < ${RIPN}; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 5.0) continue;
          vec2 diff = p - r.xy;
          float d = length(diff);
          float q = d - age * 1.35;
          float env = exp(-q * q * 2.2) * exp(-age * 0.75) * r.w / (1.0 + d * 0.9) * 0.05;
          float sinQ = sin(q * 10.0);
          float cosQ = cos(q * 10.0);
          h += sinQ * env;
          if (d > 0.001) {
            vec2 dirR = diff / d;
            float dEnv = -4.4 * q * env;
            float dH = 10.0 * cosQ * env + sinQ * dEnv;
            grad += dirR * dH;
          }
        }

        // Rain impact ripples
        if (uRain > 0.001) {
          h += rainRipples(p);
        }
      }

      float linD(float z) {
        return (uNear * uFar) / (uFar - z * (uFar - uNear));
      }

      void main() {
        vec2 p = vW.xz;
        float h;
        vec2 grad;
        evaluateWaterSurface(p, h, grad);

        #ifdef USE_FFT
          // FFT normal composition: vertex FFT + swell normal, plus fragment
          // ripples/rain grad, c2 capillary detail (near-field only), and the
          // legacy micro shimmer (distance-damped to kill grazing-angle sparkle).
          vec3 nV = normalize(vNormalW);
          float dist = length(cameraPosition - vW);
          float detailFade = 1.0 - smoothstep(6.0, 22.0, dist);
          vec2 gDetail = vC2Slope * (detailFade * 0.5);
          vec2 fbmUv = p * 1.6;
          float shimmerDist = 1.0 - 0.5 * smoothstep(10.0, 30.0, dist);
          float shimmer = (vn(fbmUv) - 0.5) * 0.02 * (0.3 + uWind) * shimmerDist * 0.0;
          vec3 shimVec = vec3(shimmer, 0.0, shimmer * 0.8);
          vec3 nFFT = normalize(nV + vec3(-(grad.x + gDetail.x), 0.0, -(grad.y + gDetail.y)) + shimVec);
          // Null-texture fallback (uHasFFT < 0.5): ripple/rain grad path.
          vec3 nGrad = normalize(vec3(-grad.x, 1.0, -grad.y) + shimVec);
          vec3 n = (uHasFFT > 0.5) ? nFFT : nGrad;
        #else
          // Analytical pristine normal
          vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

          // Subtle micro-surface shimmer
          vec2 fbmUv = p * 1.6;
          float shimmer = (vn(fbmUv) - 0.5) * 0.02 * (0.3 + uWind) * 0.0;
          n = normalize(n + vec3(shimmer, 0.0, shimmer * 0.8));
        #endif

        vec3 V = normalize(cameraPosition - vW);

        vec2 suv = gl_FragCoord.xy / uRes;
        float wz = linD(gl_FragCoord.z);
        float thick = max(linD(texture2D(uDepth, suv).x) - wz, 0.0);
        vec2 ruv = suv + n.xz * 0.05 * clamp(thick * 0.7, 0.0, 1.0);

        vec3 refracted = texture2D(uScene, ruv).rgb;

        vec3 R = reflect(-V, n);
        float skyElev = clamp(R.y, 0.0, 1.0);
        vec3 skyCol = mix(uSkyHor, uSkyTop, pow(skyElev, 0.5));
        vec3 refl = mix(skyCol, uCloudCol, uCloud * 0.6);

        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 120.0) * uSpec;
        refl += uSunCol * spec * 2.4;

        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, n), 0.0), 5.0);

        float edgeFade = smoothstep(0.0, 0.04, thick);
        #ifdef USE_FFT
          // Jacobian crest foam with fbm breakup, inserted BEFORE the fresnel
          // mix and modulated by the same edgeFade. Trough-gated by vFFTHeight
          // so foam kisses crests only; distance-faded past ~18-40 m.
          float foam = 0.0;
          if (uHasFFT > 0.5) {
            float foamBand = smoothstep(0.35, 0.05, vJacobian);
            float breakup = fbm(vW.xz * 3.0 + uTime * 0.15);
            float foamDistFade = 1.0 - smoothstep(18.0, 40.0, dist);
            float crestGate = smoothstep(-0.005, 0.02, vFFTHeight);
            foam = foamBand * smoothstep(0.45, 0.75, breakup) * foamDistFade * uFoamStrength * crestGate * 0.0;
          }
          refracted = mix(refracted, vec3(0.92, 0.95, 0.93), foam * edgeFade);
        #endif
        vec3 col = mix(refracted, refl, fres * edgeFade);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true,
  });

  return { mat, ripples };
}
