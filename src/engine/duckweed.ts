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
  shadowMesh: THREE.Mesh;
  baseX: number;
  baseZ: number;
  phase: number;
  driftSpeed: number;
}

export class DuckweedSystem {
  public readonly group = new THREE.Group();
  public readonly shadowGroup = new THREE.Group();
  public readonly patches: DuckweedPatch[] = [];

  private leafMaterial: THREE.MeshStandardMaterial;
  private highlightMaterial: THREE.MeshBasicMaterial;
  private shadowMaterial: THREE.MeshBasicMaterial;

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

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x123b2d,
      opacity: 0.24,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    scene.add(this.shadowGroup);
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
  ): { leafMesh: THREE.Mesh; highlightMesh: THREE.Mesh; shadowMesh: THREE.Mesh } {
    const leafPositions: number[] = [];
    const leafColors: number[] = [];

    const hlPositions: number[] = [];
    const hlColors: number[] = [];

    const shPositions: number[] = [];

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
        // Leaf disk (7 triangles)
        for (let s = 0; s < leafSegments; s++) {
          const aA = (s / leafSegments) * TAU;
          const aB = ((s + 1) / leafSegments) * TAU;
          const pA = this.ellipsePoint(cx, cz, r, rot, aA, verticalScale);
          const pB = this.ellipsePoint(cx, cz, r, rot, aB, verticalScale);

          leafPositions.push(cx, 0, cz);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);
          leafPositions.push(pA.x, 0, pA.z);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);
          leafPositions.push(pB.x, 0, pB.z);
          leafColors.push(leafCol.r, leafCol.g, leafCol.b);

          // Shadow
          shPositions.push(cx, 0, cz);
          shPositions.push(pA.x, 0, pA.z);
          shPositions.push(pB.x, 0, pB.z);
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

    const shGeo = new THREE.BufferGeometry();
    shGeo.setAttribute("position", new THREE.Float32BufferAttribute(shPositions, 3));
    shGeo.computeVertexNormals();

    const leafMesh = new THREE.Mesh(leafGeo, this.leafMaterial);
    const highlightMesh = new THREE.Mesh(hlGeo, this.highlightMaterial);
    const shadowMesh = new THREE.Mesh(shGeo, this.shadowMaterial);

    return { leafMesh, highlightMesh, shadowMesh };
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

      const { leafMesh, highlightMesh, shadowMesh } = this.buildPatchGeometry(
        count,
        spread,
        palette
      );

      const patchGroup = new THREE.Group();
      patchGroup.add(leafMesh, highlightMesh);
      patchGroup.position.set(px, 0.015, pz);
      this.group.add(patchGroup);

      shadowMesh.position.set(px + 0.06, -0.04, pz + 0.09);
      this.shadowGroup.add(shadowMesh);

      this.patches.push({
        group: patchGroup,
        shadowMesh,
        baseX: px,
        baseZ: pz,
        phase: rand(0, TAU),
        driftSpeed: rand(0.8, 1.2),
      });
    }
  }

  public update(time: number, wind: number = 0.15, ripples?: THREE.Vector4[]): void {
    for (let i = 0; i < this.patches.length; i++) {
      const p = this.patches[i];
      const driftX = Math.sin(time * 0.12 * p.driftSpeed + p.phase) * 0.04;
      const driftZ = Math.cos(time * 0.15 * p.driftSpeed + p.phase * 1.2) * 0.035;
      const sway = Math.sin(time * 0.09 + p.phase) * 0.035;

      const px = p.baseX + driftX;
      const pz = p.baseZ + driftZ;

      // Hydrodynamic wave height and normal tilt
      const surf = getWaterSurface(px, pz, time, wind, ripples);

      p.group.position.set(px, 0.015 + surf.y, pz);
      p.group.rotation.x = surf.tiltX * 0.88;
      p.group.rotation.y = sway;
      p.group.rotation.z = surf.tiltZ * 0.88;

      p.shadowMesh.position.set(px + 0.06, -0.04 + surf.y * 0.35, pz + 0.09);
      p.shadowMesh.rotation.y = sway;
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.shadowGroup);
    this.leafMaterial.dispose();
    this.highlightMaterial.dispose();
    this.shadowMaterial.dispose();
  }
}
