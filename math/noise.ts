import * as THREE from "three";

export const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (x: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, x));

export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const wrap = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export const approach = (v: number, g: number, step: number): number =>
  v < g ? Math.min(g, v + step) : Math.max(g, v - step);

let seedState = 20240917;

export function rnd(): number {
  seedState ^= seedState << 13;
  seedState ^= seedState >>> 17;
  seedState ^= seedState << 5;
  return ((seedState >>> 0) % 1000003) / 1000003;
}

export const rand = (a: number, b: number): number => a + (b - a) * rnd();

export const pick = <T>(arr: T[]): T =>
  arr[Math.floor(rnd() * arr.length) % arr.length];

export function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const fbm = (x: number, y: number): number =>
  (vnoise(x, y) * 0.5 +
    vnoise(x * 2.03, y * 2.03) * 0.25 +
    vnoise(x * 4.1, y * 4.1) * 0.125) /
  0.875;

export const srgb = (r: number, g: number, b: number): THREE.Color =>
  new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

/* ---------- Organic Pond Shape ---------- */
export function pondR(th: number): number {
  return (
    9.4 +
    0.9 * Math.sin(2 * th + 0.6) +
    0.55 * Math.sin(3 * th + 2.1) +
    0.3 * Math.sin(5 * th + 0.3)
  );
}

export function pondD(x: number, z: number): number {
  return Math.hypot(x, z) / pondR(Math.atan2(z, x));
}

export function terrainH(x: number, z: number): number {
  const d = pondD(x, z);
  let y = lerp(-2.6, -0.2, smooth(0.35, 1.0, d));
  y += 0.62 * smooth(0.97, 1.12, d);
  y += (fbm(x * 0.35 + 10, z * 0.35) - 0.45) * 0.6 * smooth(1.1, 1.6, d);
  y += (fbm(x * 1.7, z * 1.7) - 0.5) * 0.14 * (1 - smooth(0.95, 1.05, d));
  return y;
}
