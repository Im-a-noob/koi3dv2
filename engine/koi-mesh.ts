import * as THREE from "three";
import {
  KoiVariety,
  KoiFishData,
  FoodPellet,
  KoiBodyParams,
  DEFAULT_BODY_PARAMS,
} from "../types/koi";
import { getKoiTexture, getKoiFinTexture } from "./koi-texture";
import {
  TAU,
  lerp,
  clamp,
  smooth,
  wrap,
  rnd,
  rand,
  pick,
  pondD,
  terrainH,
  srgb,
} from "../math/noise";
import { underwater, underwaterFin } from "../shaders/underwater";

export const NODES = 14;
const RING = 16;
const SEGS = 26;

export enum SwimState {
  Glide = 0,
  Coast = 1,
  Hover = 2,
  Burst = 3,
  Pivot = 4,
}

const STATE_NAMES: Record<SwimState, string> = {
  [SwimState.Glide]: "Lướt êm (Glide)",
  [SwimState.Coast]: "Thả trôi (Coast)",
  [SwimState.Hover]: "Đứng nước (Hover)",
  [SwimState.Burst]: "Tăng tốc (Burst)",
  [SwimState.Pivot]: "Lượn gấp (Pivot)",
};

const VARIETY_NAMES: Record<KoiVariety, string> = {
  kohaku: "Kohaku (Hồng Bạch)",
  sanke: "Taisho Sanke (Tam Thể)",
  showa: "Showa Sanshoku (Hắc Tam)",
  ogon: "Yamabuki Ogon (Hoàng Kim)",
  utsuri: "Shiro Utsuri (Bạch Tả)",
  asagi: "Asagi (Thiển Thuận)",
  tancho: "Tancho (Đan Đỉnh)",
};

const FIN_COLORS: Record<KoiVariety, [THREE.Color, THREE.Color]> = {
  kohaku: [srgb(0.96, 0.93, 0.88), srgb(0.94, 0.52, 0.38)],
  sanke: [srgb(0.96, 0.93, 0.88), srgb(0.92, 0.44, 0.28)],
  showa: [srgb(0.18, 0.18, 0.18), srgb(0.88, 0.35, 0.22)],
  ogon: [srgb(0.95, 0.82, 0.28), srgb(1.0, 0.9, 0.45)],
  utsuri: [srgb(0.18, 0.18, 0.18), srgb(0.94, 0.94, 0.94)],
  asagi: [srgb(0.88, 0.42, 0.28), srgb(0.96, 0.62, 0.42)],
  tancho: [srgb(0.96, 0.94, 0.92), srgb(0.92, 0.94, 0.96)],
};

interface PatchDefinition {
  pos: number;
  len: number;
  width: number;
  offset: number;
  kind: "accent" | "marking";
  phase: number;
}

// Authored Nagomi Nishikigoi pattern definitions
const KOI_PATTERNS: Record<KoiVariety, PatchDefinition[]> = {
  // Kohaku: 3-step traditional Sandan Hi (red) on pure white base
  kohaku: [
    { pos: 0.17, len: 0.095, width: 0.74, offset: 0.04, kind: "accent", phase: 0.2 },
    { pos: 0.48, len: 0.115, width: 0.69, offset: -0.12, kind: "accent", phase: 1.8 },
    { pos: 0.76, len: 0.085, width: 0.62, offset: 0.16, kind: "accent", phase: 3.5 },
  ],
  // Sanke: 2 large Hi (red) patches + 3 inky black Sumi stepping stones
  sanke: [
    { pos: 0.19, len: 0.095, width: 0.70, offset: 0.04, kind: "accent", phase: 0.4 },
    { pos: 0.58, len: 0.105, width: 0.66, offset: -0.14, kind: "accent", phase: 2.1 },
    { pos: 0.38, len: 0.052, width: 0.34, offset: 0.38, kind: "marking", phase: 4.2 },
    { pos: 0.68, len: 0.048, width: 0.30, offset: 0.24, kind: "marking", phase: 1.1 },
    { pos: 0.79, len: 0.046, width: 0.30, offset: -0.36, kind: "marking", phase: 5.4 },
  ],
  // Showa: Inky black Sumi base with Menware head mark + red & white lightning patterns
  showa: [
    { pos: 0.12, len: 0.078, width: 0.52, offset: -0.02, kind: "marking", phase: 0.8 },
    { pos: 0.34, len: 0.115, width: 0.84, offset: 0.08, kind: "marking", phase: 2.6 },
    { pos: 0.73, len: 0.112, width: 0.78, offset: -0.14, kind: "marking", phase: 4.8 },
    { pos: 0.17, len: 0.088, width: 0.64, offset: 0.06, kind: "accent", phase: 1.5 },
    { pos: 0.53, len: 0.102, width: 0.62, offset: 0.16, kind: "accent", phase: 3.9 },
  ],
  // Ogon: Solid metallic golden sheen (no patches)
  ogon: [],
  // Tancho: Pure white body with a single, pristine circular crimson sun disc on forehead
  tancho: [
    { pos: 0.155, len: 0.072, width: 0.54, offset: 0.0, kind: "accent", phase: 0.0 },
  ],
  // Shiro Utsuri: Graphic bold black Sumi patches on snowy white skin
  utsuri: [
    { pos: 0.22, len: 0.105, width: 0.74, offset: 0.08, kind: "marking", phase: 0.6 },
    { pos: 0.51, len: 0.112, width: 0.68, offset: -0.18, kind: "marking", phase: 2.4 },
    { pos: 0.79, len: 0.084, width: 0.60, offset: 0.22, kind: "marking", phase: 4.5 },
  ],
  // Asagi: Reticulated net scales on back with red cheeks and lateral line
  asagi: [],
};

export function koiColor(
  variety: KoiVariety,
  t: number,
  side: number,
  top: number,
  seed: number,
  L: number,
  out: THREE.Color
) {
  // Nagomi Base Palettes
  const cWhite = srgb(0.95, 0.92, 0.86);
  const cRed = srgb(0.86, 0.24, 0.14);
  const cBlack = srgb(0.12, 0.12, 0.11);
  const cGold = srgb(0.94, 0.76, 0.18);
  const cAsagiSlate = srgb(0.28, 0.38, 0.48);
  const cAsagiBlue = srgb(0.42, 0.54, 0.65);

  // Default to clean porcelain white base
  out.copy(cWhite);

  // Subtle individual fish seed variation for natural organic uniqueness
  const dSeed = (seed % 100) * 0.0008;
  const pSeed = (seed % 50) * 0.04;

  if (variety === "ogon") {
    // Yamabuki Ogon: Metallic golden luster with subtle scale highlights
    const scale = Math.sin(t * 54.0 + side * 14.0) * Math.sin(t * 54.0 - side * 14.0);
    const sheen = scale > 0.1 ? 1.08 : 0.94;
    out.copy(cGold).multiplyScalar(sheen);
    if (top < -0.4) {
      out.lerp(srgb(0.88, 0.70, 0.22), 0.5);
    }
    return;
  }

  if (variety === "asagi") {
    // Asagi: Diamond reticulated indigo/slate scales on back, vermilion red on cheeks/flanks
    if (top > 0.0) {
      const net = Math.sin(t * 48.0 + side * 16.0) * Math.sin(t * 48.0 - side * 16.0);
      out.copy(net > 0 ? cAsagiSlate : cAsagiBlue);
      // Soft lighten towards head
      if (t < 0.18) out.lerp(cWhite, (0.18 - t) / 0.18);
    } else {
      // Cheeks and ventral flanks vermilion red
      const isCheek = t > 0.08 && t < 0.26 && Math.abs(side) > 0.35;
      const isFlank = t >= 0.26 && top < -0.3;
      if (isCheek || isFlank) {
        out.copy(cRed);
      } else {
        out.copy(cWhite);
      }
    }
    return;
  }

  // Evaluate Nagomi Patches
  const patches = KOI_PATTERNS[variety] || [];
  let accentWeight = 0;
  let markingWeight = 0;

  for (const patch of patches) {
    const pPos = patch.pos + dSeed * 2.0;
    const pOff = patch.offset + dSeed * 4.0;
    const dt = (t - pPos) / patch.len;
    const ds = (side - pOff) / patch.width;
    const dist = Math.hypot(dt, ds);

    // Nagomi harmonic wobble function for natural organic spot contours
    const angle = Math.atan2(ds, dt);
    const wobble =
      1.0 +
      Math.sin(angle * 3.0 + patch.phase + pSeed) * 0.08 +
      Math.cos(angle * 2.0 - patch.phase * 0.7 + pSeed) * 0.045;

    const r = dist / wobble;

    // Patches are situated on the dorsal crest and upper flanks (fading towards white belly)
    const dorsalFade = smooth(-0.35, -0.05, top);

    if (r < 1.08 && dorsalFade > 0.01) {
      // Sashi / Kiwa smooth edge transition
      const edge = smooth(1.08, 0.88, r) * dorsalFade;
      if (patch.kind === "marking") {
        markingWeight = Math.max(markingWeight, edge);
      } else {
        accentWeight = Math.max(accentWeight, edge);
      }
    }
  }

  // Composite: Base -> Hi Red (Accent) -> Sumi Black (Marking)
  if (accentWeight > 0) {
    out.lerp(cRed, accentWeight);
  }
  if (markingWeight > 0) {
    out.lerp(cBlack, markingWeight);
  }

  // Showa has black pigment underlying base
  if (variety === "showa" && markingWeight < 0.2 && accentWeight < 0.2) {
    const showaBaseDark = top > -0.2 && Math.sin(t * 16.0 + side * 6.0) > 0.15;
    if (showaBaseDark) {
      out.lerp(cBlack, 0.85);
    }
  }

  // Soft belly shading for authentic 3D volume
  if (top < -0.4) {
    out.lerp(srgb(0.92, 0.90, 0.86), clamp((-top - 0.4) / 0.6, 0, 1));
  }
}

export class KoiFish {
  public id: number;
  public variety: KoiVariety;
  public varietyName: string;

  // Nagomi Physics & State Variables
  public position: { x: number; z: number } = { x: 0, z: 0 };
  public velocity: { x: number; z: number } = { x: 0, z: 0 };

  public get x(): number {
    return this.position.x;
  }
  public get z(): number {
    return this.position.z;
  }
  public heading: number = 0;
  public angularVelocity: number = 0;
  public speed: number = 0;
  public cruiseSpeed: number = 0.85;
  public maximumSpeed: number = 1.55;
  public turnStrength: number = 5.2;

  public bodyLength: number = 1.45;
  public bodyWidth: number = 0.26;
  public swimPhase: number = 0;
  public phaseOffset: number = 0;
  public wanderSeed: number = 0;

  public state: SwimState = SwimState.Glide;
  public stateAge: number = 0;
  public stateDuration: number = 2.5;
  public pivotHeading: number = 0;

  public reactivity: number = 0.7;
  public callDelay: number = 0;
  public respondedToCall: boolean = false;
  public callResponseAge: number = 0;
  public tailEffort: number = 0.62;

  // Depth control
  public depth: number = -0.55;
  public targetDepth: number = -0.55;
  public depthTransitionRate: number = 1.0;
  public depthStateAge: number = 0;
  public depthStateDuration: number = 10;
  public inDeepPeriod: boolean = false;

  // Feeding & gulping
  public gulpCountdown: number = 4.0;
  public gulpAnimation: number = 0;
  public behaviorRng: number = 1;

  // Respiration: Buccal-Opercular Pumping Cycle & Surface Piping
  public breathPhase: number = 0;
  public breathRate: number = 2.4;
  public mouthAperture: number = 0;
  public operculumFlare: number = 0;
  public surfacePipingTimer: number = 14.0;
  public isPiping: boolean = false;
  public gillBubblePending: number = 0;

  // Flee / Scatter & Jump
  public flee: number = 0;
  public jump: any = null;

  // Nagomi Flexible 14-Node Spine & Render Spine
  public spine: { x: number; z: number }[] = [];
  public renderSpine: { x: number; z: number }[] = [];
  public spineY: number[] = [];
  public spacing: number = 0.11;

  // Customizable body proportions & 3D rotation
  public bodyParams: KoiBodyParams = { ...DEFAULT_BODY_PARAMS };

  public setBodyParams(params: Partial<KoiBodyParams>) {
    Object.assign(this.bodyParams, params);
    this.spacing = (this.bodyLength * this.bodyParams.lengthScale) / (NODES - 1);
  }

  public getBodyParams(): KoiBodyParams {
    return { ...this.bodyParams };
  }

  public updateStudioWave(dt: number) {
    this.updateRespiration(dt);
    this.swimPhase += dt * 3.5;
    this.spacing = (this.bodyLength * this.bodyParams.lengthScale) / (NODES - 1);
    const totalHalfLength = (this.bodyLength * this.bodyParams.lengthScale) * 0.45;
    for (let i = 0; i < NODES; i++) {
      this.spine[i].x = totalHalfLength - i * this.spacing;
      this.spine[i].z = 0;
      this.spineY[i] = 0;
    }
    this.renderSpine[0] = { ...this.spine[0] };
    for (let node = 1; node < NODES; node++) {
      const t = node / (NODES - 1);
      const waveEnvelope = Math.pow(t, 1.6);
      const wave =
        Math.sin(this.swimPhase - t * 5.5) *
        this.bodyWidth *
        this.bodyParams.widthScale *
        0.75 *
        waveEnvelope;

      this.renderSpine[node].x = this.spine[node].x;
      this.renderSpine[node].z = wave;
      this.spineY[node] = 0;
    }
    this.draw();
    this.body.geometry.computeBoundingBox();
    this.body.geometry.computeBoundingSphere();
    this.fins.geometry.computeBoundingBox();
    this.fins.geometry.computeBoundingSphere();
  }

  // 3D Three.js Mesh representation
  public body: THREE.Mesh;
  public fins: THREE.Mesh;
  public eyes: THREE.Mesh[];
  private posAttr: THREE.BufferAttribute;
  private finPosAttr: THREE.BufferAttribute;

  private jP = new THREE.Vector3();
  private jA = new THREE.Vector3();
  private jB = new THREE.Vector3();

  constructor(variety: KoiVariety, scene: THREE.Scene, id: number) {
    this.id = id;
    this.variety = variety;
    this.varietyName = VARIETY_NAMES[variety] || "Koi";

    // Initialize RNG state per fish (matching Nagomi XorShift32 seed)
    this.behaviorRng = (0x9e3779b9 ^ Math.imul(id + 1, 0x85ebca6b)) >>> 0;

    // Initial position inside pond
    const a0 = this.behaviorRange(0, TAU);
    const r0 = this.behaviorRange(1.0, 5.5);
    this.position = { x: Math.cos(a0) * r0, z: Math.sin(a0) * r0 };
    this.heading = this.behaviorRange(-Math.PI, Math.PI);

    // Speed & turning attributes (Nagomi parameters scaled to 3D world units)
    this.cruiseSpeed = this.behaviorRange(0.72, 1.15);
    this.maximumSpeed = this.cruiseSpeed * this.behaviorRange(1.6, 1.95);
    this.speed = this.cruiseSpeed * this.behaviorRange(0.75, 1.05);
    this.turnStrength = this.behaviorRange(4.5, 6.8);

    // Body dimensions
    this.bodyLength = this.behaviorRange(1.25, 1.68);
    this.bodyWidth = this.bodyLength * this.behaviorRange(0.17, 0.205);
    this.spacing = this.bodyLength / (NODES - 1);

    this.phaseOffset = this.behaviorRange(0, TAU);
    this.swimPhase = this.phaseOffset;
    this.wanderSeed = this.behaviorRange(0, 100);
    this.reactivity = this.behaviorRange(0.35, 1.0);

    this.depth = this.behaviorRange(-0.42, -0.65);
    this.targetDepth = this.depth;
    this.tailEffort = 0.62;

    // Initialize 14 spine nodes
    for (let i = 0; i < NODES; i++) {
      const sx = this.position.x - Math.cos(this.heading) * i * this.spacing;
      const sz = this.position.z - Math.sin(this.heading) * i * this.spacing;
      this.spine.push({ x: sx, z: sz });
      this.renderSpine.push({ x: sx, z: sz });
      this.spineY.push(this.depth);
    }

    // Build 3D Body Mesh with Vector UV Mapping
    const VCOUNT = (SEGS + 1) * (RING + 1) + 2;
    const pos = new Float32Array(VCOUNT * 3);
    const uvs = new Float32Array(VCOUNT * 2);
    const indices: number[] = [];

    for (let s = 0; s <= SEGS; s++) {
      const t = s / SEGS;
      for (let r = 0; r <= RING; r++) {
        const idx = s * (RING + 1) + r;
        uvs[idx * 2] = t;
        uvs[idx * 2 + 1] = r / RING;
      }
    }

    const headIdx = (SEGS + 1) * (RING + 1);
    const tailIdx = headIdx + 1;
    uvs[headIdx * 2] = 0.0;
    uvs[headIdx * 2 + 1] = 0.5;
    uvs[tailIdx * 2] = 1.0;
    uvs[tailIdx * 2 + 1] = 0.5;

    for (let s = 0; s < SEGS; s++) {
      for (let r = 0; r < RING; r++) {
        const i0 = s * (RING + 1) + r;
        const i1 = s * (RING + 1) + r + 1;
        const i2 = (s + 1) * (RING + 1) + r;
        const i3 = (s + 1) * (RING + 1) + r + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
    for (let r = 0; r < RING; r++) {
      indices.push(headIdx, r, r + 1);
      indices.push(tailIdx, SEGS * (RING + 1) + (r + 1), SEGS * (RING + 1) + r);
    }

    const bg = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute("position", this.posAttr);
    bg.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    bg.setIndex(indices);

    const texture = getKoiTexture(this.variety, this.wanderSeed);
    const metal = variety === "ogon" ? 0.72 : 0.05;
    this.body = new THREE.Mesh(
      bg,
      underwater(
        new THREE.MeshStandardMaterial({
          map: texture,
          roughness: variety === "ogon" ? 0.28 : 0.38,
          metalness: metal,
          side: THREE.DoubleSide,
        }),
        { caustic: 0.6, snow: 0 }
      )
    );
    this.body.castShadow = true;
    this.body.frustumCulled = false;

    // Build Authentic Nagomi Fins (34 vertices, 22 triangles)
    // 0..4: Pectoral Left, 5..9: Pectoral Right
    // 10..12: Pelvic Left, 13..15: Pelvic Right
    // 16..23: Nagomi 2-Lobe Swallow Tail Fin
    // 24..33: Dorsal Fin
    const FV = 34;
    const finPos = new Float32Array(FV * 3);
    const finCol = new Float32Array(FV * 3);
    const [rootC, tipC] = FIN_COLORS[variety] || [srgb(0.96, 0.94, 0.90), srgb(0.94, 0.52, 0.38)];
    const tmpC = new THREE.Color();

    const setC = (i: number, color: THREE.Color) => {
      finCol[i * 3] = color.r;
      finCol[i * 3 + 1] = color.g;
      finCol[i * 3 + 2] = color.b;
    };

    // Pectoral Left (0..4)
    setC(0, rootC);
    setC(1, rootC);
    setC(2, rootC);
    setC(3, tmpC.copy(rootC).lerp(tipC, 0.8));
    setC(4, tmpC.copy(rootC).lerp(tipC, 0.6));

    // Pectoral Right (5..9)
    setC(5, rootC);
    setC(6, rootC);
    setC(7, rootC);
    setC(8, tmpC.copy(rootC).lerp(tipC, 0.8));
    setC(9, tmpC.copy(rootC).lerp(tipC, 0.6));

    // Pelvic Left (10..12) & Right (13..15)
    setC(10, rootC);
    setC(11, tmpC.copy(rootC).lerp(tipC, 0.7));
    setC(12, rootC);
    setC(13, rootC);
    setC(14, tmpC.copy(rootC).lerp(tipC, 0.7));
    setC(15, rootC);

    // Nagomi Swallow Tail (16..23)
    setC(16, rootC);
    setC(17, rootC);
    setC(18, rootC);
    setC(19, tmpC.copy(rootC).lerp(tipC, 0.45)); // notch
    setC(20, tmpC.copy(rootC).lerp(tipC, 0.95)); // upper lobe tip
    setC(21, tmpC.copy(rootC).lerp(tipC, 0.95)); // lower lobe tip
    setC(22, tmpC.copy(rootC).lerp(tipC, 0.75)); // upper mid
    setC(23, tmpC.copy(rootC).lerp(tipC, 0.75)); // lower mid

    // Dorsal Fin (24..33)
    for (let k = 0; k < 5; k++) {
      setC(24 + k, rootC);
      setC(29 + k, tmpC.copy(rootC).lerp(tipC, 0.6));
    }

    const fidx: number[] = [
      // Pectoral Left (0..4)
      0, 1, 3,  1, 2, 4,  1, 4, 3,
      // Pectoral Right (5..9)
      5, 8, 6,  6, 9, 7,  6, 8, 9,
      // Pelvic Left (10..12)
      10, 11, 12,
      // Pelvic Right (13..15)
      13, 15, 14,
      // Nagomi Swallow Tail (16..23)
      16, 17, 22,
      17, 20, 22,
      16, 22, 19,
      16, 19, 23,
      18, 23, 21,
      16, 18, 23,
      // Dorsal Fin (24..33)
      24, 29, 25,  25, 29, 30,
      25, 30, 26,  26, 30, 31,
      26, 31, 27,  27, 31, 32,
      27, 32, 28,  28, 32, 33,
    ];

    const finUvs = new Float32Array(FV * 2);

    // Pectoral Left (0..4)
    finUvs[0] = 0.0; finUvs[1] = 0.05;
    finUvs[2] = 0.0; finUvs[3] = 0.50;
    finUvs[4] = 0.0; finUvs[5] = 0.95;
    finUvs[6] = 1.0; finUvs[7] = 0.30;
    finUvs[8] = 0.9; finUvs[9] = 0.90;

    // Pectoral Right (5..9)
    finUvs[10] = 0.0; finUvs[11] = 0.05;
    finUvs[12] = 0.0; finUvs[13] = 0.50;
    finUvs[14] = 0.0; finUvs[15] = 0.95;
    finUvs[16] = 1.0; finUvs[17] = 0.30;
    finUvs[18] = 0.9; finUvs[19] = 0.90;

    // Pelvic Left (10..12) & Right (13..15)
    finUvs[20] = 0.0; finUvs[21] = 0.1;
    finUvs[22] = 1.0; finUvs[23] = 0.5;
    finUvs[24] = 0.0; finUvs[25] = 0.9;

    finUvs[26] = 0.0; finUvs[27] = 0.1;
    finUvs[28] = 1.0; finUvs[29] = 0.5;
    finUvs[30] = 0.0; finUvs[31] = 0.9;

    // Nagomi Swallow Tail (16..23)
    finUvs[32] = 0.0; finUvs[33] = 0.50; // rootCenter
    finUvs[34] = 0.0; finUvs[35] = 0.20; // rootLeft
    finUvs[36] = 0.0; finUvs[37] = 0.80; // rootRight
    finUvs[38] = 0.55; finUvs[39] = 0.50; // notch
    finUvs[40] = 1.0; finUvs[41] = 0.05; // upperTip
    finUvs[42] = 1.0; finUvs[43] = 0.95; // lowerTip
    finUvs[44] = 0.72; finUvs[45] = 0.15; // upperMid
    finUvs[46] = 0.72; finUvs[47] = 0.85; // lowerMid

    // Dorsal Fin (24..33)
    for (let k = 0; k < 5; k++) {
      const frac = k / 4;
      finUvs[(24 + k) * 2] = frac;
      finUvs[(24 + k) * 2 + 1] = 0.0;

      finUvs[(29 + k) * 2] = frac;
      finUvs[(29 + k) * 2 + 1] = 1.0;
    }

    const fg = new THREE.BufferGeometry();
    this.finPosAttr = new THREE.BufferAttribute(finPos, 3).setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute("position", this.finPosAttr);
    fg.setAttribute("uv", new THREE.BufferAttribute(finUvs, 2));
    fg.setAttribute("color", new THREE.BufferAttribute(finCol, 3));
    fg.setIndex(fidx);

    const finTexture = getKoiFinTexture(variety);
    this.fins = new THREE.Mesh(
      fg,
      underwaterFin(
        new THREE.MeshStandardMaterial({
          map: finTexture,
          transparent: true,
          opacity: 0.95,
          roughness: 0.22,
          metalness: 0.02,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
        { caustic: 0.45, snow: 0 }
      )
    );
    this.fins.castShadow = true;
    this.fins.frustumCulled = false;

    // 3D Eyes (Nagomi glossy obsidian black)
    const eyeGeo = new THREE.SphereGeometry(1, 12, 10);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x141512,
      roughness: 0.12,
      metalness: 0.92,
    });
    this.eyes = [new THREE.Mesh(eyeGeo, eyeMat), new THREE.Mesh(eyeGeo, eyeMat)];
    this.eyes.forEach((e) => e.scale.setScalar(this.bodyWidth * 0.11));

    scene.add(this.body, this.fins, ...this.eyes);
  }

  public destroy(scene: THREE.Scene) {
    scene.remove(this.body);
    scene.remove(this.fins);
    this.eyes.forEach((e) => scene.remove(e));
    this.body.geometry.dispose();
    this.fins.geometry.dispose();
  }

  // --- Nagomi Behavioral Random Generator (XorShift32) ---
  private behaviorUnit(): number {
    let value = this.behaviorRng >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.behaviorRng = value >>> 0;
    return (this.behaviorRng & 0x00ffffff) / 0x01000000;
  }

  private behaviorRange(low: number, high: number): number {
    return low + (high - low) * this.behaviorUnit();
  }

  // --- Nagomi State Transitions ---
  public enterState(next: SwimState): void {
    this.state = next;
    this.stateAge = 0;
    switch (next) {
      case SwimState.Glide:
        this.stateDuration = this.behaviorRange(1.7, 5.2);
        break;
      case SwimState.Coast:
        this.stateDuration = this.behaviorRange(0.7, 2.1);
        break;
      case SwimState.Hover:
        this.stateDuration = this.behaviorRange(0.65, 3.1);
        break;
      case SwimState.Burst:
        this.stateDuration = this.behaviorRange(0.32, 0.92);
        break;
      case SwimState.Pivot: {
        this.stateDuration = this.behaviorRange(0.3, 0.78);
        const direction = this.behaviorUnit() < 0.5 ? -1 : 1;
        this.pivotHeading = wrap(
          this.heading + direction * this.behaviorRange(0.85, 2.35)
        );
        break;
      }
    }
  }

  private updateNaturalState(dt: number): void {
    this.stateAge += dt;
    if (this.stateAge < this.stateDuration) return;

    const roll = this.behaviorUnit();
    switch (this.state) {
      case SwimState.Glide:
        if (roll < 0.25) this.enterState(SwimState.Coast);
        else if (roll < 0.43) this.enterState(SwimState.Hover);
        else if (roll < 0.61) this.enterState(SwimState.Pivot);
        else if (roll < 0.72) this.enterState(SwimState.Burst);
        else this.enterState(SwimState.Glide);
        break;
      case SwimState.Coast:
        if (roll < 0.38) this.enterState(SwimState.Hover);
        else if (roll < 0.72) this.enterState(SwimState.Glide);
        else if (roll < 0.9) this.enterState(SwimState.Pivot);
        else this.enterState(SwimState.Burst);
        break;
      case SwimState.Hover:
        if (roll < 0.34) this.enterState(SwimState.Pivot);
        else if (roll < 0.55) this.enterState(SwimState.Burst);
        else this.enterState(SwimState.Glide);
        break;
      case SwimState.Burst:
        this.enterState(SwimState.Coast);
        break;
      case SwimState.Pivot:
        this.enterState(roll < 0.38 ? SwimState.Burst : SwimState.Glide);
        break;
    }
  }

  // --- Nagomi Depth Progression ---
  private updateDepth(dt: number, isCalled: boolean): void {
    this.depthStateAge += dt;
    if (!isCalled && this.depthStateAge >= this.depthStateDuration) {
      this.depthStateAge = 0;
      if (this.behaviorUnit() < 0.72) {
        this.inDeepPeriod = !this.inDeepPeriod;
      }
      const range = this.inDeepPeriod ? [-1.2, -1.8] : [-0.35, -0.65];
      const durations = this.inDeepPeriod ? [4, 10] : [8, 22];
      this.targetDepth = this.behaviorRange(range[0], range[1]);
      this.depthStateDuration = this.behaviorRange(durations[0], durations[1]);
      const transitionSeconds = this.behaviorRange(2.0, 5.0);
      this.depthTransitionRate = 3 / Math.max(transitionSeconds, 0.1);
    }

    const bed = terrainH(this.position.x, this.position.z) + 0.4;
    this.targetDepth = Math.max(this.targetDepth, bed);

    this.depth +=
      (this.targetDepth - this.depth) *
      (1 - Math.exp(-this.depthTransitionRate * dt));

    this.depth = Math.max(this.depth, bed);
  }

  // --- Nagomi Gulping & Mouth Feeding Ripples ---
  private updateFeedingGulp(
    dt: number,
    onRipple: (x: number, z: number, amp: number) => void
  ): void {
    this.gulpAnimation = Math.max(0, this.gulpAnimation - dt);
    this.gulpCountdown -= dt;
    if (this.gulpCountdown > 0) return;

    const calmState =
      this.state === SwimState.Hover ||
      this.state === SwimState.Coast ||
      this.state === SwimState.Glide;

    const eligible =
      calmState &&
      this.depth >= -0.55 &&
      this.speed <= this.cruiseSpeed * 0.65;

    if (!eligible) {
      this.gulpCountdown = this.behaviorRange(0.8, 2.2);
      return;
    }

    const mouthDist = this.bodyWidth * 0.66;
    const mouthX = this.position.x + Math.cos(this.heading) * mouthDist;
    const mouthZ = this.position.z + Math.sin(this.heading) * mouthDist;

    onRipple(mouthX, mouthZ, 0.28);
    this.gulpAnimation = 0.24;
    this.gulpCountdown = this.behaviorRange(2.5, 6.0);
  }

  // --- Natural Respiration: Buccal-Opercular Pumping Cycle & Surface Piping ---
  public updateRespiration(
    dt: number,
    onBubble?: (x: number, y: number, z: number, r: number) => void,
    onRipple?: (x: number, z: number, amp: number) => void
  ): void {
    // 1. Dynamic respiration frequency based on activity & state
    let targetRate = 2.4; // Cruise ~24 breaths/min
    if (this.state === SwimState.Hover || this.state === SwimState.Coast) {
      targetRate = 1.8; // Calm resting ~18 breaths/min
    } else if (this.state === SwimState.Burst || this.flee > 0) {
      targetRate = 5.2; // Rapid pumping under exertion ~50 breaths/min
    } else if (this.speed > this.cruiseSpeed * 1.15) {
      targetRate = 3.6;
    }

    this.breathRate += (targetRate - this.breathRate) * (1 - Math.exp(-dt * 3.2));
    this.breathPhase = (this.breathPhase + this.breathRate * dt) % TAU;

    // 2. Buccal-Opercular Pumping Action
    // Inhalation: mouth opens, gills sealed
    // Exhalation: mouth seals, gill covers flare outward
    const sinBreath = Math.sin(this.breathPhase);
    const baseMouth = Math.max(0, sinBreath);
    const gulpBoost = this.gulpAnimation > 0 ? (this.gulpAnimation / 0.24) * 0.55 : 0;
    this.mouthAperture = Math.min(1.0, baseMouth * 0.22 + gulpBoost);

    const baseGill = Math.max(0, -sinBreath);
    const exertion = clamp((this.breathRate - 1.8) / 3.4, 0, 1);
    this.operculumFlare = (baseGill * 0.65 + Math.pow(baseGill, 1.4) * 0.35) * (0.8 + exertion * 0.65);

    // 3. Surface Piping Behavior (ngoi lên đớp khí bề mặt)
    this.surfacePipingTimer -= dt;
    if (this.surfacePipingTimer <= 0) {
      this.surfacePipingTimer = this.behaviorRange(16.0, 36.0);
      if (this.depth > -0.65 && !this.inDeepPeriod && this.state !== SwimState.Burst) {
        this.isPiping = true;
        this.targetDepth = -0.08;
      }
    }

    if (this.isPiping) {
      if (this.depth >= -0.16) {
        this.mouthAperture = Math.max(this.mouthAperture, 0.45);
        if (onRipple && Math.random() < 0.35) {
          const hF = this.frameAt(0);
          onRipple(hF.x, hF.z, 0.14);
        }
        this.isPiping = false;
        this.targetDepth = this.behaviorRange(-0.45, -0.75);
        this.gillBubblePending = this.behaviorRange(0.7, 1.6);
      }
    }

    // 4. Gill Bubble Release (xả bọt khí qua nắp mang 2 bên má)
    if (this.gillBubblePending > 0) {
      this.gillBubblePending -= dt;
      if (this.gillBubblePending <= 0 && onBubble) {
        const gF = this.frameAt(3 / 13);
        const gillOffset = gF.w * 0.88;
        // Left gill slit
        onBubble(
          gF.x + gF.sx * gillOffset,
          gF.y - gF.h * 0.12,
          gF.z + gF.sz * gillOffset,
          this.behaviorRange(0.022, 0.038)
        );
        // Right gill slit
        onBubble(
          gF.x - gF.sx * gillOffset,
          gF.y - gF.h * 0.12,
          gF.z - gF.sz * gillOffset,
          this.behaviorRange(0.022, 0.038)
        );
      }
    }
  }

  // --- Nagomi Steering Intentions Calculation ---
  private steeringFor(
    time: number,
    fishes: KoiFish[],
    target: { x: number; z: number } | null,
    targetActive: boolean
  ): { x: number; z: number } {
    const forwardX = Math.cos(this.heading);
    const forwardZ = Math.sin(this.heading);
    let steerX = forwardX * 0.95;
    let steerZ = forwardZ * 0.95;

    // 1. Pivot or Natural Harmonic Wander
    if (this.state === SwimState.Pivot) {
      steerX = Math.cos(this.pivotHeading) * 4.7;
      steerZ = Math.sin(this.pivotHeading) * 4.7;
    } else if (this.state !== SwimState.Hover) {
      // Nagomi dual harmonic wander formula
      const wander =
        Math.sin(time * 0.29 + this.wanderSeed) * 0.7 +
        Math.sin(time * 0.113 + this.wanderSeed * 1.73) * 0.45;
      const wanderHeading = this.heading + wander;
      steerX += Math.cos(wanderHeading) * 0.62;
      steerZ += Math.sin(wanderHeading) * 0.62;
    }

    // 2. Boids (Separation, Alignment, Cohesion)
    let sepX = 0, sepZ = 0;
    let aliX = 0, aliZ = 0;
    let cohX = 0, cohZ = 0;
    let neighbours = 0;

    for (const other of fishes) {
      if (other === this) continue;
      const offX = this.position.x - other.position.x;
      const offZ = this.position.z - other.position.z;
      const dist = Math.hypot(offX, offZ);

      if (dist > 0.001 && dist < 2.3) {
        neighbours++;
        cohX += other.position.x;
        cohZ += other.position.z;

        const otherVLen = Math.hypot(other.velocity.x, other.velocity.z) || 1;
        aliX += other.velocity.x / otherVLen;
        aliZ += other.velocity.z / otherVLen;

        if (dist < 0.9) {
          const sepFactor = (0.9 - dist) / 0.9;
          sepX += (offX / dist) * sepFactor;
          sepZ += (offZ / dist) * sepFactor;
        }
      }
    }

    if (neighbours > 0) {
      const avgCohX = cohX / neighbours - this.position.x;
      const avgCohZ = cohZ / neighbours - this.position.z;
      const cohLen = Math.hypot(avgCohX, avgCohZ) || 1;
      const aliLen = Math.hypot(aliX, aliZ) || 1;

      steerX += (avgCohX / cohLen) * 0.25;
      steerZ += (avgCohZ / cohLen) * 0.25;
      steerX += (aliX / aliLen) * 0.42;
      steerZ += (aliZ / aliLen) * 0.42;
      steerX += sepX * 2.8;
      steerZ += sepZ * 2.8;
    }

    // 3. Pond Edge Avoidance (Nagomi smooth margin avoidance)
    const pd = pondD(this.position.x, this.position.z);
    if (pd > 0.74) {
      const force = Math.pow((pd - 0.74) / 0.24, 1.8) * 5.2;
      const pondAngle = Math.atan2(this.position.z, this.position.x);
      steerX -= Math.cos(pondAngle) * force;
      steerZ -= Math.sin(pondAngle) * force;
    }

    // 4. Target Following & Nagomi Signature Circling Force
    if (targetActive && target && this.callDelay <= 0) {
      const toTargetX = target.x - this.position.x;
      const toTargetZ = target.z - this.position.z;
      const dist = Math.hypot(toTargetX, toTargetZ);

      if (dist > 0.85) {
        // Chase towards target
        const chasePull = this.callResponseAge < 2.6 ? 3.35 : 2.45;
        steerX += (toTargetX / dist) * chasePull;
        steerZ += (toTargetZ / dist) * chasePull;
      } else {
        // Nagomi Signature: Circling tangential force around target!
        const normX = toTargetX / (dist || 1);
        const normZ = toTargetZ / (dist || 1);
        // Perpendicular tangential vector
        const perpX = -normZ;
        const perpZ = normX;
        steerX += perpX * 2.2 - normX * 0.5;
        steerZ += perpZ * 2.2 - normZ * 0.5;
      }
    }

    // 5. Fleeing disturbance
    if (this.flee > 0 && target) {
      const awayX = this.position.x - target.x;
      const awayZ = this.position.z - target.z;
      const dist = Math.hypot(awayX, awayZ) || 1;
      steerX += (awayX / dist) * 6.5;
      steerZ += (awayZ / dist) * 6.5;
    }

    const steerLen = Math.hypot(steerX, steerZ) || 1;
    return { x: steerX / steerLen, z: steerZ / steerLen };
  }

  // --- Nagomi Desired Speed for Current State ---
  private desiredSpeedFor(target: { x: number; z: number } | null, targetActive: boolean): number {
    const chaseDuration = 2.6;
    const chasing = targetActive && this.respondedToCall && this.callResponseAge < chaseDuration;

    if (chasing) {
      const chaseFade = 1 - clamp(this.callResponseAge / chaseDuration, 0, 1);
      return this.maximumSpeed * (1.15 + chaseFade * 0.34);
    }

    let intention = this.cruiseSpeed;
    if (targetActive && target && this.callDelay <= 0) {
      const dist = Math.hypot(target.x - this.position.x, target.z - this.position.z);
      const urgency = clamp(dist / 6.5, 0.2, 1.0);
      intention = this.cruiseSpeed + (this.maximumSpeed - this.cruiseSpeed) * urgency;
    }

    if (this.flee > 0) {
      return this.maximumSpeed * 1.25;
    }

    switch (this.state) {
      case SwimState.Glide:
        return intention;
      case SwimState.Coast:
        return intention * 0.28;
      case SwimState.Hover:
        return 0;
      case SwimState.Burst:
        return this.maximumSpeed * 1.08;
      case SwimState.Pivot:
        return this.cruiseSpeed * 0.16;
    }
  }

  // --- Nagomi Physics Integration & Flexible Spine Wave ---
  private integrate(
    desired: { x: number; z: number },
    desiredSpeed: number,
    dt: number
  ): void {
    const desiredHeading = Math.atan2(desired.z, desired.x);
    const headingError = wrap(desiredHeading - this.heading);
    const pivoting = this.state === SwimState.Pivot;
    const turnMultiplier = pivoting ? 2.65 : 1.0;
    const angularDamping = pivoting ? 2.15 : 3.8;

    const angularAcceleration =
      headingError * this.turnStrength * turnMultiplier -
      this.angularVelocity * angularDamping;

    this.angularVelocity += angularAcceleration * dt;
    const maximumTurnRate = pivoting ? 4.35 : 2.25;
    this.angularVelocity = clamp(this.angularVelocity, -maximumTurnRate, maximumTurnRate);
    this.heading = wrap(this.heading + this.angularVelocity * dt);

    let speedResponse = 1.65;
    let desiredTailEffort = 0.62;

    switch (this.state) {
      case SwimState.Glide:
        break;
      case SwimState.Coast:
        speedResponse = 1.05;
        desiredTailEffort = 0.16;
        break;
      case SwimState.Hover:
        speedResponse = 3.6;
        desiredTailEffort = 0.05;
        break;
      case SwimState.Burst:
        speedResponse = 6.4;
        desiredTailEffort = 1.22;
        break;
      case SwimState.Pivot:
        speedResponse = 4.2;
        desiredTailEffort = 1.0;
        break;
    }

    if (this.flee > 0) {
      speedResponse = 7.0;
      desiredTailEffort = 1.4;
    }

    this.speed += (desiredSpeed - this.speed) * (1 - Math.exp(-speedResponse * dt));
    this.tailEffort += (desiredTailEffort - this.tailEffort) * (1 - Math.exp(-4.5 * dt));

    this.velocity = {
      x: Math.cos(this.heading) * this.speed,
      z: Math.sin(this.heading) * this.speed,
    };

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // Hard pond boundary safety
    const d2 = pondD(this.position.x, this.position.z);
    if (d2 > 0.88) {
      this.position.x *= 0.88 / d2;
      this.position.z *= 0.88 / d2;
    }

    // Nagomi dynamic tail beat rate
    const beatRate =
      0.45 +
      (this.speed / this.maximumSpeed) * 4.6 +
      this.tailEffort * 0.9;
    this.swimPhase += beatRate * dt;

    // Nagomi 14-Node Flexible Spine Inverse Kinematics with Progressive Stiffness
    this.spine[0] = { ...this.position };
    for (let node = 1; node < NODES; node++) {
      const prev = this.spine[node - 1];
      const cur = this.spine[node];
      let dx = cur.x - prev.x;
      let dz = cur.z - prev.z;
      let dist = Math.hypot(dx, dz);

      if (dist < 1e-4) {
        dx = -Math.cos(this.heading);
        dz = -Math.sin(this.heading);
        dist = 1;
      }

      const constrainedX = prev.x + (dx / dist) * this.spacing;
      const constrainedZ = prev.z + (dz / dist) * this.spacing;

      // Progressive looseness towards tail produces lifelike turn follow-through
      const tailAmount = node / (NODES - 1);
      const stiffness = 0.94 - tailAmount * 0.17;

      this.spine[node].x = lerp(cur.x, constrainedX, stiffness);
      this.spine[node].z = lerp(cur.z, constrainedZ, stiffness);
      this.spineY[node] = lerp(this.spineY[node], this.spineY[node - 1], 1 - Math.exp(-dt * 8));
    }

    // Nagomi Lateral Wave Synthesis (buildRenderSpine)
    this.renderSpine[0] = { ...this.spine[0] };
    for (let node = 1; node < NODES; node++) {
      const t = node / (NODES - 1);
      const prevNode = Math.max(0, node - 1);
      const nextNode = Math.min(NODES - 1, node + 1);

      let tx = this.spine[prevNode].x - this.spine[nextNode].x;
      let tz = this.spine[prevNode].z - this.spine[nextNode].z;
      let tlen = Math.hypot(tx, tz);
      if (tlen < 1e-4) {
        tx = Math.cos(this.heading);
        tz = Math.sin(this.heading);
        tlen = 1;
      }
      tx /= tlen;
      tz /= tlen;

      // Perpendicular normal to tangent
      const nx = -tz;
      const nz = tx;

      // Exact Nagomi Wave Formula:
      // waveEnvelope = Math.pow(t, 1.72)
      // wave = Math.sin(swimPhase - t * 6.1) * bodyWidth * 1.15 * waveEnvelope * (0.08 + tailEffort * 0.92)
      const waveEnvelope = Math.pow(t, 1.72);
      const wave =
        Math.sin(this.swimPhase - t * 6.1) *
        this.bodyWidth *
        1.15 *
        waveEnvelope *
        (0.08 + this.tailEffort * 0.92);

      this.renderSpine[node].x = this.spine[node].x + nx * wave;
      this.renderSpine[node].z = this.spine[node].z + nz * wave;
    }
  }

  // --- Jump Handling ---
  public startJump(): boolean {
    const dx = Math.cos(this.heading);
    const dz = Math.sin(this.heading);
    const pre = 2.2;
    const dist = this.bodyLength * rand(1.4, 2.0);
    const H = this.bodyLength * rand(0.42, 0.7);

    if (pondD(this.position.x + dx * pre, this.position.z + dz * pre) > 0.78) return false;
    if (pondD(this.position.x + dx * (pre + dist), this.position.z + dz * (pre + dist)) > 0.8)
      return false;

    this.jump = {
      x0: this.position.x,
      z0: this.position.z,
      dx,
      dz,
      dist,
      H,
      pre,
      y0: this.depth,
      s: -pre,
      v: rand(3.0, 3.8),
    };
    return true;
  }

  private jumpPos(s: number, out: THREE.Vector3) {
    const j = this.jump;
    out.x = j.x0 + j.dx * (s + j.pre);
    out.z = j.z0 + j.dz * (s + j.pre);
    if (s < 0) {
      out.y = lerp(j.y0, -0.22, smooth(-j.pre, 0, s));
    } else if (s <= j.dist) {
      const u = s / j.dist;
      out.y = -0.22 + (j.H + 0.22) * 4 * u * (1 - u);
    } else {
      out.y = Math.max(-0.22 - (s - j.dist) * 0.8, terrainH(out.x, out.z) + 0.42, -1.6);
    }
  }

  private updateJump(dt: number, onSplash: (x: number, z: number, amp: number) => void) {
    const j = this.jump;
    const prev = j.s;
    j.s += j.v * dt;

    if (prev < 0 && j.s >= 0) {
      this.jumpPos(0, this.jP);
      onSplash(this.jP.x, this.jP.z, 1.2);
    }
    if (prev < j.dist && j.s >= j.dist) {
      this.jumpPos(j.dist, this.jP);
      onSplash(this.jP.x, this.jP.z, 1.6);
    }

    let s = j.s;
    this.jumpPos(s, this.jA);
    this.spine[0].x = this.jA.x;
    this.spine[0].z = this.jA.z;
    this.renderSpine[0].x = this.jA.x;
    this.renderSpine[0].z = this.jA.z;
    this.spineY[0] = this.jA.y;

    for (let i = 1; i < NODES; i++) {
      let si = s - this.spacing;
      this.jumpPos(si, this.jB);
      const d = Math.hypot(this.jB.x - this.jA.x, this.jB.y - this.jA.y, this.jB.z - this.jA.z);
      if (d > 1e-4) {
        si = s - (s - si) * (this.spacing / d);
        this.jumpPos(si, this.jB);
      }
      this.spine[i].x = this.jB.x;
      this.spine[i].z = this.jB.z;
      this.renderSpine[i].x = this.jB.x;
      this.renderSpine[i].z = this.jB.z;
      this.spineY[i] = this.jB.y;
      this.jA.copy(this.jB);
      s = si;
    }

    this.position.x = this.spine[0].x;
    this.position.z = this.spine[0].z;
    this.depth = this.spineY[0];
    this.tailEffort = 1.3;
    this.speed = this.cruiseSpeed * 1.6;
    this.swimPhase += dt * 11;

    if (j.s > j.dist + this.bodyLength + 0.5) {
      this.jump = null;
      this.targetDepth = -0.85;
      this.depth = Math.max(this.depth, terrainH(this.position.x, this.position.z) + 0.42);
    }
  }

  // --- Main Update Method ---
  public update(
    dt: number,
    time: number,
    fishes: KoiFish[],
    pellets: FoodPellet[],
    onRipple: (x: number, z: number, amp: number) => void,
    onSplash: (x: number, z: number, amp: number) => void,
    onBubble?: (x: number, y: number, z: number, r: number) => void
  ) {
    if (this.jump) {
      this.updateJump(dt, onSplash);
      return;
    }

    if (this.flee > 0) {
      this.flee -= dt;
    }

    // Update natural respiration & breathing animation
    this.updateRespiration(dt, onBubble, onRipple);

    // Check active food target or ripple call
    let targetPoint: { x: number; z: number } | null = null;
    let targetActive = false;

    if (pellets.length > 0) {
      let closestDist = 15;
      for (const p of pellets) {
        if (p.eaten) continue;
        const d = Math.hypot(p.x - this.position.x, p.z - this.position.z);
        if (d < closestDist) {
          closestDist = d;
          targetPoint = { x: p.x, z: p.z };
          targetActive = true;
        }
      }
    }

    // Nagomi Call Response delay logic
    this.callDelay = Math.max(0, this.callDelay - dt);
    if (targetActive && this.respondedToCall) {
      this.callResponseAge += dt;
    }

    if (targetActive && this.callDelay <= 0 && !this.respondedToCall) {
      this.respondedToCall = true;
      this.callResponseAge = 0;
      this.targetDepth = -0.32; // rise toward surface when responding to call
      this.depthTransitionRate = 3 / 2.4;
      this.enterState(SwimState.Burst);
    }

    if (!targetActive) {
      this.respondedToCall = false;
    }

    // Update Nagomi states
    this.updateNaturalState(dt);
    this.updateDepth(dt, targetActive && this.respondedToCall);
    this.updateFeedingGulp(dt, onRipple);

    // Food eating collision
    if (targetPoint && targetActive) {
      const distToFood = Math.hypot(targetPoint.x - this.position.x, targetPoint.z - this.position.z);
      if (distToFood < this.bodyLength * 0.16 + 0.22 && this.depth > -0.65) {
        const eatenPellet = pellets.find(
          (p) => !p.eaten && Math.hypot(p.x - targetPoint!.x, p.z - targetPoint!.z) < 0.1
        );
        if (eatenPellet) {
          eatenPellet.eaten = true;
          onRipple(eatenPellet.x, eatenPellet.z, 0.45);
          this.enterState(SwimState.Coast);
        }
      }
    }

    // Compute desired steering & desired speed
    const desired = this.steeringFor(time, fishes, targetPoint, targetActive);
    const desiredSpeed = this.desiredSpeedFor(targetPoint, targetActive);

    // Physics Integration
    this.integrate(desired, desiredSpeed, dt);
  }

  // --- Render 3D Mesh Around RenderSpine ---
  public draw() {
    const pos = this.posAttr.array as Float32Array;

    for (let s = 0; s <= SEGS; s++) {
      const t = s / SEGS;
      const fr = this.frameAt(t);
      let radX = fr.w;
      let radY = fr.h;

      // 1. Respiration: Mouth opening & jaw drop at snout (s=0, 1)
      if (s === 0) {
        radY *= 1.0 + this.mouthAperture * 0.42;
        radX *= 1.0 - this.mouthAperture * 0.14;
      } else if (s === 1) {
        radY *= 1.0 + this.mouthAperture * 0.22;
      }

      // 2. Respiration: Operculum (gill covers) lateral flare at head flanks (s = 2..5)
      let gillWeight = 0;
      if (s >= 2 && s <= 5) {
        gillWeight = Math.sin(((s - 1.8) / 3.4) * Math.PI);
      }

      for (let r = 0; r <= RING; r++) {
        const idx = (s * (RING + 1) + r) * 3;
        const th = (r / RING) * TAU - Math.PI;
        const ct = Math.cos(th); // vertical (top/bottom)
        const st = Math.sin(th); // lateral (left/right)

        let effectiveRadX = radX;
        if (gillWeight > 0) {
          const lateralFactor = Math.pow(Math.abs(st), 1.4);
          effectiveRadX = radX * (1.0 + this.operculumFlare * 0.26 * gillWeight * lateralFactor);
        }

        // Slight mouth drop at lower jaw
        let jawDrop = 0;
        if (s <= 1 && ct < -0.2) {
          jawDrop = this.mouthAperture * radY * 0.38 * (-ct);
        }

        pos[idx] = fr.x + fr.sx * st * effectiveRadX + fr.ux * (ct * radY - jawDrop);
        pos[idx + 1] = fr.y + fr.uy * (ct * radY - jawDrop);
        pos[idx + 2] = fr.z + fr.sz * st * effectiveRadX + fr.uz * (ct * radY - jawDrop);
      }
    }

    const hF = this.frameAt(0);
    const headIdx = ((SEGS + 1) * (RING + 1)) * 3;
    const effBodyWidth = this.bodyWidth * this.bodyParams.widthScale;

    // Snout forward extension and slight mouth drop when breathing/gulping
    const mouthAdvance = effBodyWidth * 0.28 + this.mouthAperture * effBodyWidth * 0.14;
    const mouthLower = this.mouthAperture * effBodyWidth * 0.06;

    pos[headIdx] = hF.x + hF.tx * mouthAdvance - hF.ux * mouthLower;
    pos[headIdx + 1] = hF.y - hF.uy * mouthLower;
    pos[headIdx + 2] = hF.z + hF.tz * mouthAdvance - hF.uz * mouthLower;

    const tF = this.frameAt(1);
    const tailIdx = headIdx + 3;
    pos[tailIdx] = tF.x - tF.tx * effBodyWidth * 0.15;
    pos[tailIdx + 1] = tF.y;
    pos[tailIdx + 2] = tF.z - tF.tz * effBodyWidth * 0.15;

    this.posAttr.needsUpdate = true;
    this.body.geometry.computeVertexNormals();

    // Nagomi Eyes placement on oval head flanks (matching eyeAnchor & eyeOffset)
    const eyeRadius = effBodyWidth * 0.11 * this.bodyParams.eyeSize;
    const eyeOffset = hF.w * 0.62 * this.bodyParams.eyeSpacing;
    const eyeX = hF.x + hF.tx * effBodyWidth * 0.08;
    const eyeY = hF.y + hF.h * 0.32;
    const eyeZ = hF.z + hF.tz * effBodyWidth * 0.08;

    this.eyes[0].position.set(
      eyeX + hF.sx * eyeOffset,
      eyeY,
      eyeZ + hF.sz * eyeOffset
    );
    this.eyes[1].position.set(
      eyeX - hF.sx * eyeOffset,
      eyeY,
      eyeZ - hF.sz * eyeOffset
    );
    this.eyes[0].scale.setScalar(eyeRadius);
    this.eyes[1].scale.setScalar(eyeRadius);

    // Update fins
    this.updateFins();
  }

  // Nagomi Authentic Oval Curve Profile:
  // Head forms a smooth rounded convex oval dome (u=0 nose at 0.52 width,
  // expanding along a circular/elliptical arc to 1.0 at shoulders t=0.18)
  private widthProfile(t: number): number {
    if (t < 0.18) {
      const u = t / 0.18;
      // Elliptical convex oval arc
      return 0.52 + Math.sin(u * (Math.PI / 2.0)) * 0.48;
    }
    return Math.pow(Math.max(0, 1 - (t - 0.18) / 0.82), 0.72);
  }

  private frameAt(t: number) {
    const f = t * (NODES - 1);
    const i0 = Math.min(Math.floor(f), NODES - 2);
    const fr = f - i0;
    const a = this.renderSpine[i0];
    const b = this.renderSpine[i0 + 1];
    const ay = this.spineY[i0];
    const by = this.spineY[i0 + 1];

    const x = lerp(a.x, b.x, fr);
    const y = lerp(ay, by, fr);
    const z = lerp(a.z, b.z, fr);

    let tx = a.x - b.x;
    let ty = ay - by;
    let tz = a.z - b.z;
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l;
    ty /= l;
    tz /= l;

    const hl = Math.hypot(tx, tz) || 1;
    const sx = -tz / hl;
    const sz = tx / hl;

    const ux = -sz * ty;
    const uy = sz * tx - sx * tz;
    const uz = sx * ty;

    const w = this.bodyWidth * this.bodyParams.widthScale * this.widthProfile(t);
    // Nagomi hydrodynamic lenticular profile with heightScale modifier
    const h = w * 0.65 * this.bodyParams.heightScale;

    return { x, y, z, tx, ty, tz, sx, sz, ux, uy, uz, w, h };
  }

  private updateFins() {
    const finArr = this.finPosAttr.array as Float32Array;

    // Nagomi fin dynamics & paddle activity
    const gulpProgress = this.gulpAnimation / Math.max(0.24, 0.001);
    const gulpPaddle = Math.sin(Math.PI * gulpProgress) * 0.85;
    const paddleActivity =
      (this.state === SwimState.Hover ? 1.0 : this.state === SwimState.Pivot ? 0.85 : 0.45) +
      gulpPaddle;
    const finPulse =
      0.82 +
      paddleActivity * 0.25 * Math.sin(this.swimPhase * 0.64 + this.phaseOffset) +
      this.operculumFlare * 0.08;

    const effBodyWidth = this.bodyWidth * this.bodyParams.widthScale;
    const pectoralReach = effBodyWidth * (0.65 + paddleActivity * 0.3) * finPulse * this.bodyParams.finScale;
    const flapY = Math.sin(this.swimPhase * 0.64 + this.phaseOffset) * paddleActivity * 0.12;

    // 1. Pectoral Fins (Left: 0..4, Right: 5..9) at Nodes 3, 4, 6
    const pF3 = this.frameAt(3 / 13);
    const pF4 = this.frameAt(4 / 13);
    const pF6 = this.frameAt(6 / 13);

    // Left Pectoral
    // 0: rootFront
    finArr[0] = pF3.x + pF3.sx * pF3.w * 0.95;
    finArr[1] = pF3.y - pF3.h * 0.15;
    finArr[2] = pF3.z + pF3.sz * pF3.w * 0.95;
    // 1: rootCenter
    finArr[3] = pF4.x + pF4.sx * pF4.w * 0.95;
    finArr[4] = pF4.y - pF4.h * 0.15;
    finArr[5] = pF4.z + pF4.sz * pF4.w * 0.95;
    // 2: rootBack
    finArr[6] = pF6.x + pF6.sx * pF6.w * 0.95;
    finArr[7] = pF6.y - pF6.h * 0.15;
    finArr[8] = pF6.z + pF6.sz * pF6.w * 0.95;
    // 3: tipApex
    finArr[9] = pF4.x + pF4.sx * (pF4.w + pectoralReach) - pF4.tx * effBodyWidth * 0.25;
    finArr[10] = pF4.y + flapY;
    finArr[11] = pF4.z + pF4.sz * (pF4.w + pectoralReach) - pF4.tz * effBodyWidth * 0.25;
    // 4: tipTrailing
    finArr[12] = pF6.x + pF6.sx * (pF6.w + pectoralReach * 0.62) - pF6.tx * effBodyWidth * 0.42;
    finArr[13] = pF6.y + flapY * 0.7;
    finArr[14] = pF6.z + pF6.sz * (pF6.w + pectoralReach * 0.62) - pF6.tz * effBodyWidth * 0.42;

    // Right Pectoral (5..9)
    finArr[15] = pF3.x - pF3.sx * pF3.w * 0.95;
    finArr[16] = pF3.y - pF3.h * 0.15;
    finArr[17] = pF3.z - pF3.sz * pF3.w * 0.95;

    finArr[18] = pF4.x - pF4.sx * pF4.w * 0.95;
    finArr[19] = pF4.y - pF4.h * 0.15;
    finArr[20] = pF4.z - pF4.sz * pF4.w * 0.95;

    finArr[21] = pF6.x - pF6.sx * pF6.w * 0.95;
    finArr[22] = pF6.y - pF6.h * 0.15;
    finArr[23] = pF6.z - pF6.sz * pF6.w * 0.95;

    finArr[24] = pF4.x - pF4.sx * (pF4.w + pectoralReach) - pF4.tx * effBodyWidth * 0.25;
    finArr[25] = pF4.y + flapY;
    finArr[26] = pF4.z - pF4.sz * (pF4.w + pectoralReach) - pF4.tz * effBodyWidth * 0.25;

    finArr[27] = pF6.x - pF6.sx * (pF6.w + pectoralReach * 0.62) - pF6.tx * effBodyWidth * 0.42;
    finArr[28] = pF6.y + flapY * 0.7;
    finArr[29] = pF6.z - pF6.sz * (pF6.w + pectoralReach * 0.62) - pF6.tz * effBodyWidth * 0.42;

    // 2. Pelvic Fins (Left: 10..12, Right: 13..15) at Nodes 7, 8, 9
    const pF7 = this.frameAt(7 / 13);
    const pF8 = this.frameAt(8 / 13);
    const pF9 = this.frameAt(9 / 13);
    const pelvicReach = effBodyWidth * (0.35 + 0.05 * finPulse) * this.bodyParams.finScale;

    // Left Pelvic
    finArr[30] = pF7.x + pF7.sx * pF7.w * 0.9;
    finArr[31] = pF7.y - pF7.h * 0.25;
    finArr[32] = pF7.z + pF7.sz * pF7.w * 0.9;

    finArr[33] = pF8.x + pF8.sx * (pF8.w + pelvicReach) - pF8.tx * effBodyWidth * 0.18;
    finArr[34] = pF8.y - pF8.h * 0.25 + flapY * 0.4;
    finArr[35] = pF8.z + pF8.sz * (pF8.w + pelvicReach) - pF8.tz * effBodyWidth * 0.18;

    finArr[36] = pF9.x + pF9.sx * pF9.w * 0.9;
    finArr[37] = pF9.y - pF9.h * 0.25;
    finArr[38] = pF9.z + pF9.sz * pF9.w * 0.9;

    // Right Pelvic
    finArr[39] = pF7.x - pF7.sx * pF7.w * 0.9;
    finArr[40] = pF7.y - pF7.h * 0.25;
    finArr[41] = pF7.z - pF7.sz * pF7.w * 0.9;

    finArr[42] = pF8.x - pF8.sx * (pF8.w + pelvicReach) - pF8.tx * effBodyWidth * 0.18;
    finArr[43] = pF8.y - pF8.h * 0.25 + flapY * 0.4;
    finArr[44] = pF8.z - pF8.sz * (pF8.w + pelvicReach) - pF8.tz * effBodyWidth * 0.18;

    finArr[45] = pF9.x - pF9.sx * pF9.w * 0.9;
    finArr[46] = pF9.y - pF9.h * 0.25;
    finArr[47] = pF9.z - pF9.sz * pF9.w * 0.9;

    // 3. Nagomi Swallow Tail Fin (16..23) with 2 lobes & center notch
    const tF = this.frameAt(1.0);
    const lobeH = effBodyWidth * 1.35 * this.bodyParams.tailSpread;
    const tailWave = Math.sin(this.swimPhase - 6.5) * 0.16 * (0.2 + this.tailEffort * 0.8);
    const tailLenMul = effBodyWidth * this.bodyParams.tailLength;

    // 16: rootCenter
    finArr[48] = tF.x;
    finArr[49] = tF.y;
    finArr[50] = tF.z;

    // 17: rootLeft
    finArr[51] = tF.x;
    finArr[52] = tF.y + tF.h * 0.4;
    finArr[53] = tF.z;

    // 18: rootRight
    finArr[54] = tF.x;
    finArr[55] = tF.y - tF.h * 0.4;
    finArr[56] = tF.z;

    // 19: tailNotch (center indent)
    finArr[57] = tF.x - tF.tx * tailLenMul * 0.95;
    finArr[58] = tF.y;
    finArr[59] = tF.z - tF.tz * tailLenMul * 0.95 + tF.sz * tailWave * 0.5;

    // 20: upperFin (top lobe apex)
    finArr[60] = tF.x - tF.tx * tailLenMul * 1.55;
    finArr[61] = tF.y + lobeH;
    finArr[62] = tF.z - tF.tz * tailLenMul * 1.55 + tF.sz * tailWave;

    // 21: lowerFin (bottom lobe apex)
    finArr[63] = tF.x - tF.tx * tailLenMul * 1.55;
    finArr[64] = tF.y - lobeH;
    finArr[65] = tF.z - tF.tz * tailLenMul * 1.55 - tF.sz * tailWave * 0.7;

    // 22: upperMid (top outer edge)
    finArr[66] = tF.x - tF.tx * tailLenMul * 0.88;
    finArr[67] = tF.y + lobeH * 0.65;
    finArr[68] = tF.z - tF.tz * tailLenMul * 0.88 + tF.sz * tailWave * 0.6;

    // 23: lowerMid (bottom outer edge)
    finArr[69] = tF.x - tF.tx * tailLenMul * 0.88;
    finArr[70] = tF.y - lobeH * 0.65;
    finArr[71] = tF.z - tF.tz * tailLenMul * 0.88 - tF.sz * tailWave * 0.5;

    // 4. Dorsal Fin (24..33) along Nodes 5..9
    for (let k = 0; k < 5; k++) {
      const dF = this.frameAt((5 + k) / 13);
      const bIdx = (24 + k) * 3;
      finArr[bIdx] = dF.x;
      finArr[bIdx + 1] = dF.y + dF.h;
      finArr[bIdx + 2] = dF.z;

      const cIdx = (29 + k) * 3;
      const crestH = this.bodyLength * this.bodyParams.lengthScale * 0.13 * Math.sin((k / 4) * Math.PI) * this.bodyParams.finScale;
      finArr[cIdx] = dF.x;
      finArr[cIdx + 1] = dF.y + dF.h + crestH;
      finArr[cIdx + 2] = dF.z;
    }

    this.finPosAttr.needsUpdate = true;
    this.fins.geometry.computeVertexNormals();
  }

  public getFishData(): KoiFishData {
    const stateStr: KoiFishData["state"] = this.jump
      ? "jumping"
      : this.flee > 0
      ? "fleeing"
      : this.respondedToCall
      ? "feeding"
      : "swimming";

    const colorMap: Record<KoiVariety, string> = {
      kohaku: "#e63946",
      sanke: "#ff5722",
      showa: "#212529",
      ogon: "#ffc107",
      utsuri: "#495057",
      asagi: "#457b9d",
      tancho: "#d90429",
    };

    return {
      id: this.id,
      variety: this.variety,
      varietyName: this.varietyName,
      lengthCm: Math.round(this.bodyLength * this.bodyParams.lengthScale * 42),
      speedKmH: Number((this.speed * 4.2).toFixed(1)),
      depthM: Number(Math.abs(this.depth).toFixed(2)),
      state: stateStr,
      colorHex: colorMap[this.variety] || "#e63946",
      nagomiState: STATE_NAMES[this.state],
      bodyParams: { ...this.bodyParams },
    };
  }
}
