import * as THREE from "three";
import { sharedUniforms } from "./underwater";

export const RIPN = 16;

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
      uNear: { value: camera.near },
      uFar: { value: camera.far },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
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
      uniform float uNear;
      uniform float uFar;
      varying vec3 vW;

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
      void evaluateWaterSurface(vec2 p, out float h, out vec2 grad) {
        float w = 1.0 + uWind * 1.5;
        h = 0.0;
        grad = vec2(0.0);

        // 1. Primary Wind Swell (Trochoid peak)
        {
          vec2 d = vec2(0.821, 0.571);
          float k = 6.283185 / 2.6;
          float amp = 0.016 * w;
          float phase = k * dot(d, p) - (k * 1.15) * uTime * w;
          float sinP = sin(phase);
          float cosP = cos(phase);
          float normSin = sinP * 0.5 + 0.5;
          h += amp * (pow(max(0.0, normSin), 1.8) * 2.0 - 1.0);
          float dCrest = 1.8 * pow(max(0.0, normSin), 0.8) * cosP;
          grad += amp * k * d * dCrest;
        }

        // 2. Cross Swell (Trochoid peak)
        {
          vec2 d = vec2(-0.451, 0.892);
          float k = 6.283185 / 1.75;
          float amp = 0.011 * w;
          float phase = k * dot(d, p) - (k * 1.35) * uTime * w;
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
          float amp = 0.0065 * w;
          float phase = k * dot(d, p) - (k * 1.65) * uTime * w;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }

        // 4. Micro Capillary Ripples
        {
          vec2 d = vec2(-0.707, -0.707);
          float k = 6.283185 / 0.52;
          float amp = 0.0035 * w;
          float phase = k * dot(d, p) - (k * 2.1) * uTime * w;
          h += amp * sin(phase);
          grad += amp * k * d * cos(phase);
        }

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

        // Analytical pristine normal
        vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));

        // Subtle micro-surface shimmer
        vec2 fbmUv = p * 1.6 + vec2(uTime * 0.22, uTime * 0.16) * (1.0 + uWind * 1.2);
        float shimmer = (vn(fbmUv) - 0.5) * 0.02 * (1.0 + uWind * 1.2);
        n = normalize(n + vec3(shimmer, 0.0, shimmer * 0.8));

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
        vec3 col = mix(refracted, refl, fres * edgeFade);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true,
  });

  return { mat, ripples };
}
