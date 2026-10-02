import type * as THREE from "three";

export type SceneName =
  | "sunny"
  | "sunset"
  | "night"
  | "rain"
  | "storm"
  | "spring"
  | "summer"
  | "autumn"
  | "winter";

export type KoiVariety =
  | "kohaku"
  | "sanke"
  | "showa"
  | "ogon"
  | "utsuri"
  | "asagi"
  | "tancho";

export interface ScenePreset {
  name: SceneName;
  label: string;
  icon: string;
  desc: string;
  ambient: number;
  sunIntensity: number;
  sunPos: [number, number, number];
  sunColor: [number, number, number];
  skyTop: [number, number, number];
  skyHor: [number, number, number];
  hemiSky: [number, number, number];
  hemiGround: [number, number, number];
  fogColor: [number, number, number];
  waterColor: [number, number, number];
  absorb: [number, number, number];
  treeCanopy: [number, number, number];
  causticAmt: number;
  specular: number;
  wind: number;
  rain: number;
  storm: number;
  snowCover: number;
  dry: number;
  fallRate: number;
  fallType: "sakura" | "maple" | "snow" | "none";
  birds: number;
  jump: number;
  lanternGlow: number;
}

export interface FoodPellet {
  x: number;
  z: number;
  vx: number;
  vz: number;
  born: number;
  eaten: boolean;
  mesh: THREE.Mesh;
}

export interface KoiBodyParams {
  lengthScale: number; // 0.6 to 1.6 (chiều dài thân)
  widthScale: number;  // 0.6 to 1.6 (chiều rộng thân)
  heightScale: number; // 0.5 to 1.6 (độ cao / dày thân)
  finScale: number;    // 0.5 to 2.0 (độ xòe vây bơi)
  tailLength: number;  // 0.6 to 2.0 (chiều dài đuôi én)
  tailSpread: number;  // 0.6 to 2.0 (độ xòe đuôi)
  eyeSize: number;     // 0.5 to 2.2 (kích thước mắt)
  eyeSpacing: number;  // 0.6 to 1.4 (khoảng cách 2 mắt)
  yawDeg?: number;     // góc xoay 3D yaw (-180 to 180)
  pitchDeg?: number;   // góc xoay 3D pitch (-90 to 90)
  rollDeg?: number;    // góc xoay 3D roll (-90 to 90)
}

export const DEFAULT_BODY_PARAMS: KoiBodyParams = {
  lengthScale: 1.0,
  widthScale: 1.0,
  heightScale: 1.0,
  finScale: 1.0,
  tailLength: 1.0,
  tailSpread: 1.0,
  eyeSize: 1.0,
  eyeSpacing: 1.0,
  yawDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
};

export interface KoiFishData {
  id: number;
  variety: KoiVariety;
  varietyName: string;
  lengthCm: number;
  speedKmH: number;
  depthM: number;
  state: "swimming" | "feeding" | "fleeing" | "jumping";
  nagomiState?: string;
  colorHex: string;
  bodyParams?: KoiBodyParams;
}

export interface PondSettings {
  fishCount: number;
  selectedVarieties: KoiVariety[];
  causticsQuality: boolean;
  enableBirds: boolean;
  enableRainRipples: boolean;
  waterClarity: number;
  cameraSpeed: number;
  soundVolume: number;
  isMuted: boolean;
  activeCameraMode: "orbit" | "topdown" | "shoreline";
  globalKoiParams?: KoiBodyParams;
}
