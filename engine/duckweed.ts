import * as THREE from "three";
import { TAU, rand, srgb, pondR } from "../math/noise";
import { underwater } from "../shaders/underwater";
import { getWaterSurface } from "../math/water-physics";

export interface DuckweedPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  center: THREE.Color;
}

export const DUCKWEED_PALETTES: readonly DuckweedPalette[] = [
  {
    base: new THREE.Color(0x6fc94f),
    light: new THREE.Color(0x9be66c),
    shade: new THREE.Color(0x45963e),
    center: new THREE.Color(0xc3ee75),
  },
  {
    base: new THREE.Color(0x83d35b),
    light: new THREE.Color(0xb1ed76),
    shade: new THREE.Color(0x549e43),
    center: new THREE.Color(0xd0f28a),
  },
];

export interface DuckweedPatch {
  group: THREE.Group;
  baseX: number;
  baseZ: number;
  phase: number;
  driftSpeed: number;
  tiltSX: number;
  tiltSZ: number;
}

export class DuckweedSystem {
  public readonly group = new THREE.Group();
  public readonly patches: DuckweedPatch[] = [];

  private leafMaterial: THREE.MeshStandardMaterial;
  private highlightMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.leafMaterial = underwater(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.42,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
      { caustic: 0.2, snow: 0.8 }
    );

    this.highlightMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    scene.add(this.group);

    this.buildPatches();
  }

  private ellipsePoint(
    cx: number,
    cz: number,
    radius: number,
    rotation: number,
    angle: number,
    verticalScale: number
  ): { x: number; z: number } {
    const lx = Math.cos(angle) * radius;
    const lz = Math.sin(angle) * radius * verticalScale;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    return {
      x: cx + lx * cosR - lz * sinR,
      z: cz + lx * sinR + lz * cosR,
    };
  }

  private buildPatchGeometry(
    count: number,
    spreadRadius: number,
    palette: DuckweedPalette
  ): { leafMesh: THREE.Mesh; highlightMesh: THREE.Mesh } {
    const leafPositions: number[] = [];
    const leafColors: number[] = [];

    const hlPositions: number[] = [];
    const hlColors: number[] = [];

    const verticalScale = 0.76;
    const leafSegments = 7;
    const hlSegments = 5;

    for (let i = 0; i < count; i++) {
      // Clustered spread
      const u = Math.pow(rand(0, 1), 0.68);
      const theta = rand(0, TAU);
      const lx = Math.cos(theta) * spreadRadius * u;
      const lz = Math.sin(theta) * spreadRadius * u;

      const radius = rand(0.045, 0.11);
      const rotation = rand(0, TAU);
      const tone = rand(0, 1);
      const leafCol =
        tone < 0.24 ? palette.light : tone > 0.82 ? palette.shade : palette.base;

      const pushSingleLeaf = (cx: number, cz: number, r: number, rot: number) => {
        // Cupped leaf disk (7 triangles): rim lifted ~10% radius + V-fold + edge curl
        for (let s = 0; s < leafSegments; s++) {
          const aA = (s / leafSegments) * TAU;
          const aB = ((s + 1) / leafSegments) * TAU;
          const pA = this.ellipsePoint(cx, cz, r, rot, aA, verticalScale);
          const pB = this.ellipsePoint(cx, cz, r, rot, aB, verticalScale);
          const dxA = (pA.x - cx) / r;
          const dzA = (pA.z - cz) / r;
          const dxB = (pB.x - cx) / r;
          const dzB = (pB.z - cz) / r;
          const yA =
            0.1 * r * (dxA * dxA + dzA * dzA) +
            0.025 * r * dxA * dxA +
            Math.sin(aA * 5 + rot) * 0.008 * r;
          const yB =
            0.1 * r * (dxB * dxB + dzB * dzB) +
            0.025 * r * dxB * dxB +
            Math.sin(aB * 5 + rot) * 0.008 * r;

          leafPositions.push(cx, 0, cz);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);
          leafPositions.push(pA.x, yA, pA.z);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);
          leafPositions.push(pB.x, yB, pB.z);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);
        }

        // Highlight center button
        const hlR = Math.max(0.008, r * 0.14);
        const hx = cx - Math.cos(rot) * r * 0.18;
        const hz = cz - Math.sin(rot) * r * 0.18;
        for (let s = 0; s < hlSegments; s++) {
          const aA = (s / hlSegments) * TAU;
          const aB = ((s + 1) / hlSegments) * TAU;
          hlPositions.push(hx, 0.002, hz);
          hlColors.push(palette.center.r, palette.center.g, palette.center.b);
          hlPositions.push(hx + Math.cos(aA) * hlR, 0.002, hz + Math.sin(aA) * hlR);
          hlColors.push(palette.center.r, palette.center.g, palette.center.b);
          hlPositions.push(hx + Math.cos(aB) * hlR, 0.002, hz + Math.sin(aB) * hlR);
          hlColors.push(palette.center.r, palette.center.g, palette.center.b);
        }
      };

      pushSingleLeaf(lx, lz, radius, rotation);

      // Paired leaf (42% chance in Nagomi)
      if (rand(0, 1) < 0.42) {
        const pairX = lx + Math.cos(rotation + 0.8) * radius * 0.92;
        const pairZ = lz + Math.sin(rotation + 0.8) * radius * 0.92;
        pushSingleLeaf(pairX, pairZ, radius * 0.68, rotation + 0.4);
      }
    }

    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute("position", new THREE.Float32BufferAttribute(leafPositions, 3));
    leafGeo.setAttribute("color", new THREE.Float32BufferAttribute(leafColors, 3));
    leafGeo.computeVertexNormals();

    const hlGeo = new THREE.BufferGeometry();
    hlGeo.setAttribute("position", new THREE.Float32BufferAttribute(hlPositions, 3));
    hlGeo.setAttribute("color", new THREE.Float32BufferAttribute(hlColors, 3));

    const leafMesh = new THREE.Mesh(leafGeo, this.leafMaterial);
    leafMesh.castShadow = true;
    const highlightMesh = new THREE.Mesh(hlGeo, this.highlightMaterial);

    return { leafMesh, highlightMesh };
  }

  private buildPatches(): void {
    // 7 patches clustered along quiet edges and bays of the pond
    const patchAngles = [0.8, 1.9, 2.8, 4.3, 5.1, 5.9, 3.4];
    for (let i = 0; i < patchAngles.length; i++) {
      const th = patchAngles[i];
      const R = pondR(th) * rand(0.68, 0.88);
      const px = Math.cos(th) * R;
      const pz = Math.sin(th) * R;

      const count = Math.floor(rand(24, 48));
      const spread = rand(0.65, 1.35);
      const palette = DUCKWEED_PALETTES[i % DUCKWEED_PALETTES.length];

      const { leafMesh, highlightMesh } = this.buildPatchGeometry(
        count,
        spread,
        palette
      );

      const patchGroup = new THREE.Group();
      patchGroup.add(leafMesh, highlightMesh);
      patchGroup.position.set(px, 0.015, pz);
      this.group.add(patchGroup);

      this.patches.push({
        group: patchGroup,
        baseX: px,
        baseZ: pz,
        phase: rand(0, TAU),
        driftSpeed: rand(0.8, 1.2),
        tiltSX: 0,
        tiltSZ: 0,
      });
    }
  }

  public update(time: number, wind: number = 0.15, ripples?: THREE.Vector4[], activity: number = 0, dt: number = 1 / 60): void {
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i];
      const driftX = Math.sin(time * 0.12 * p.driftSpeed + p.phase) * 0.04;
      const driftZ = Math.cos(time * 0.15 * p.driftSpeed + p.phase * 1.2) * 0.035;
      const sway = Math.sin(time * 0.09 + p.phase) * 0.035;

      const px = p.baseX + driftX;
      const pz = p.baseZ + driftZ;

      const surf = getWaterSurface(px, pz, time, wind, ripples, activity);

      const bobY = 0.004 * Math.sin(time * 2 + p.phase);
      let gTX = surf.tiltX;
      let gTZ = surf.tiltZ;
      const gMag = Math.hypot(gTX, gTZ);
      if (gMag > 0.45) {
        const s = 0.45 / gMag;
        gTX *= s;
        gTZ *= s;
      }
      const tiltK = 1 - Math.exp(-dt * 6);
      const targetTX = gTX * 1.0 + 0.02 * Math.sin(time * 1.3 + p.phase);
      const targetTZ = gTZ * 1.0 + 0.02 * Math.cos(time * 1.1 + p.phase);
      p.tiltSX += (targetTX - p.tiltSX) * tiltK;
      p.tiltSZ += (targetTZ - p.tiltSZ) * tiltK;
      const tiltX = 0.35 * Math.tanh(p.tiltSX / 0.35);
      const tiltZ = 0.35 * Math.tanh(p.tiltSZ / 0.35);
      p.group.position.set(px, 0.015 + surf.y + bobY, pz);
      p.group.rotation.x = tiltX;
      p.group.rotation.y = sway;
      p.group.rotation.z = tiltZ;
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.leafMaterial.dispose();
    this.highlightMaterial.dispose();
  }
}
