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

/**
 * Computes exact water height, surface normal, and pitch/roll tilt
 * perfectly synchronized between CPU and GPU.
 */
export function getWaterSurface(
  x: number,
  z: number,
  time: number,
  wind: number = 0.15,
  ripples?: THREE.Vector4[]
): WaterSurfaceState {
  const w = 1.0 + wind * 1.5;
  let h = 0;
  let gradX = 0;
  let gradZ = 0;

  // Evaluate 4 Gerstner Trochoidal Waves
  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const wave = GERSTNER_WAVES[i];
    const len = Math.hypot(wave.dx, wave.dz) || 1;
    const nx = wave.dx / len;
    const nz = wave.dz / len;

    const k = (2 * Math.PI) / wave.wavelength;
    const amp = wave.amplitude * w;
    const phase = k * (nx * x + nz * z) - k * wave.speed * time * w;

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
