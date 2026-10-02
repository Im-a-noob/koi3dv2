import * as THREE from "three";
import { TAU, rand, srgb, pondR, terrainH } from "../math/noise";
import { underwater } from "../shaders/underwater";
import { getWaterSurface } from "../math/water-physics";

export interface LeafPalette {
  base: THREE.Color;
  light: THREE.Color;
  shade: THREE.Color;
  vein: THREE.Color;
  center: THREE.Color;
}

export interface FlowerPalette {
  outerPetal: THREE.Color;
  innerPetal: THREE.Color;
  petalLight: THREE.Color;
  center: THREE.Color;
  centerDark: THREE.Color;
}

export const LOTUS_LEAF_PALETTES: readonly LeafPalette[] = [
  {
    base: new THREE.Color(0x5f9d78),
    light: new THREE.Color(0x76aa84),
    shade: new THREE.Color(0x487c66),
    vein: new THREE.Color(0x3f705e),
    center: new THREE.Color(0x4f866b),
  },
  {
    base: new THREE.Color(0x568f6f),
    light: new THREE.Color(0x6ca17b),
    shade: new THREE.Color(0x416f5b),
    vein: new THREE.Color(0x386653),
    center: new THREE.Color(0x497d63),
  },
];

export const LOTUS_FLOWER_PALETTES: readonly FlowerPalette[] = [
  {
    outerPetal: new THREE.Color(0xf29aaa),
    innerPetal: new THREE.Color(0xffc4cc),
    petalLight: new THREE.Color(0xffe1e2),
    center: new THREE.Color(0xf2bd45),
    centerDark: new THREE.Color(0xb96d31),
  },
  {
    outerPetal: new THREE.Color(0xe985ac),
    innerPetal: new THREE.Color(0xfab7ce),
    petalLight: new THREE.Color(0xffdce6),
    center: new THREE.Color(0xf5c64b),
    centerDark: new THREE.Color(0xbd7330),
  },
];

export interface LotusClusterItem {
  group: THREE.Group;
  shadowMesh: THREE.Mesh;
  flowerMesh?: THREE.Mesh;
  baseX: number;
  baseZ: number;
  radius: number;
  phase: number;
  hasFlower: boolean;
}

export class LotusSystem {
  public readonly group = new THREE.Group();
  public readonly shadowGroup = new THREE.Group();
  public readonly items: LotusClusterItem[] = [];

  private leafMaterial: THREE.MeshStandardMaterial;
  private veinMaterial: THREE.LineBasicMaterial;
  private flowerMaterial: THREE.MeshStandardMaterial;
  private shadowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.leafMaterial = underwater(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.38,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
      { caustic: 0.3, snow: 0.8 }
    );

    this.veinMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });

    this.flowerMaterial = underwater(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.28,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
      { caustic: 0.25, snow: 0.6 }
    );

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x0a2b26,
      opacity: 0.42,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    scene.add(this.shadowGroup);
    scene.add(this.group);

    this.buildClusters();
  }

  private edgePoint(
    cx: number,
    cz: number,
    radius: number,
    angle: number,
    phase: number
  ): { x: number; z: number } {
    // Nagomi organic edge wobble formula
    const wobble =
      1 +
      Math.sin(angle * 3 + phase) * 0.035 +
      Math.cos(angle * 5 - phase) * 0.025;
    const verticalScale = 0.92;
    return {
      x: cx + Math.cos(angle) * radius * wobble,
      z: cz + Math.sin(angle) * radius * verticalScale * wobble,
    };
  }

  private leafColorAt(
    target: THREE.Color,
    palette: LeafPalette,
    angle: number,
    phase: number
  ): void {
    // Nagomi directional light & organic tone variation
    const directionalLight = 0.5 + Math.cos(angle + 2.2) * 0.42;
    const organicVariation = Math.sin(angle * 3 + phase * 0.7) * 0.045;
    const tone = Math.max(0, Math.min(1, directionalLight + organicVariation));
    if (tone < 0.5) {
      target.copy(palette.shade).lerp(palette.base, tone * 2);
    } else {
      target.copy(palette.base).lerp(palette.light, (tone - 0.5) * 2);
    }
  }

  private buildLeafMesh(
    radius: number,
    angle: number,
    phase: number,
    palette: LeafPalette
  ): { leafMesh: THREE.Mesh; veinMesh: THREE.LineSegments; shadowGeo: THREE.BufferGeometry } {
    const leafSegments = 28;
    const notchHalfAngle = 0.3; // Nagomi V-shaped slit
    const start = angle + notchHalfAngle;
    const span = TAU - notchHalfAngle * 2;

    const positions: number[] = [];
    const colors: number[] = [];
    const shadowPositions: number[] = [];

    const centerColor = palette.center;
    const colorA = new THREE.Color();
    const colorB = new THREE.Color();

    for (let i = 0; i < leafSegments; i++) {
      const aA = start + (i / leafSegments) * span;
      const aB = start + ((i + 1) / leafSegments) * span;

      const pA = this.edgePoint(0, 0, radius, aA, phase);
      const pB = this.edgePoint(0, 0, radius, aB, phase);

      this.leafColorAt(colorA, palette, aA, phase);
      this.leafColorAt(colorB, palette, aB, phase);

      // Subtle 3D saucer cup shape
      const yA = 0.02 * (radius / 1.0);
      const yB = 0.02 * (radius / 1.0);

      // Center
      positions.push(0, 0, 0);
      colors.push(centerColor.r, centerColor.g, centerColor.b);
      // pA
      positions.push(pA.x, yA, pA.z);
      colors.push(colorA.r, colorA.g, colorA.b);
      // pB
      positions.push(pB.x, yB, pB.z);
      colors.push(colorB.r, colorB.g, colorB.b);

      // Shadow vertices (projected flat)
      shadowPositions.push(0, 0, 0);
      shadowPositions.push(pA.x, 0, pA.z);
      shadowPositions.push(pB.x, 0, pB.z);
    }

    // Center circular button (8 segments)
    const centerR = Math.max(0.04, radius * 0.075);
    for (let i = 0; i < 8; i++) {
      const a1 = (i / 8) * TAU;
      const a2 = ((i + 1) / 8) * TAU;
      positions.push(0, 0.005, 0);
      colors.push(centerColor.r, centerColor.g, centerColor.b);
      positions.push(Math.cos(a1) * centerR, 0.005, Math.sin(a1) * centerR);
      colors.push(centerColor.r, centerColor.g, centerColor.b);
      positions.push(Math.cos(a2) * centerR, 0.005, Math.sin(a2) * centerR);
      colors.push(centerColor.r, centerColor.g, centerColor.b);
    }

    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    leafGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    leafGeo.computeVertexNormals();

    const shadowGeo = new THREE.BufferGeometry();
    shadowGeo.setAttribute("position", new THREE.Float32BufferAttribute(shadowPositions, 3));
    shadowGeo.computeVertexNormals();

    // 5 Radiating veins
    const veinPos: number[] = [];
    const veinCol: number[] = [];
    const veinCount = 5;
    for (let i = 1; i <= veinCount; i++) {
      const vAngle = start + (i / (veinCount + 1)) * span;
      const vEdge = this.edgePoint(0, 0, radius * 0.72, vAngle, phase);

      veinPos.push(0, 0.006, 0);
      veinCol.push(palette.vein.r, palette.vein.g, palette.vein.b);
      veinPos.push(vEdge.x, 0.006, vEdge.z);
      veinCol.push(palette.vein.r, palette.vein.g, palette.vein.b);
    }

    const veinGeo = new THREE.BufferGeometry();
    veinGeo.setAttribute("position", new THREE.Float32BufferAttribute(veinPos, 3));
    veinGeo.setAttribute("color", new THREE.Float32BufferAttribute(veinCol, 3));

    const leafMesh = new THREE.Mesh(leafGeo, this.leafMaterial);
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = true;

    const veinMesh = new THREE.LineSegments(veinGeo, this.veinMaterial);

    return { leafMesh, veinMesh, shadowGeo };
  }

  private buildFlowerMesh(
    radius: number,
    rotation: number,
    palette: FlowerPalette
  ): THREE.Mesh {
    const positions: number[] = [];
    const colors: number[] = [];

    // Helper to draw sculpted 3D petal rings
    const drawPetalRing = (
      count: number,
      lengthFrac: number,
      widthFrac: number,
      angleOffset: number,
      cupTilt: number,
      primaryColor: THREE.Color,
      alternateColor: THREE.Color
    ) => {
      for (let i = 0; i < count; i++) {
        const ang = rotation + angleOffset + (i / count) * TAU;
        const dirX = Math.cos(ang);
        const dirZ = Math.sin(ang);
        const sideX = -dirZ;
        const sideZ = dirX;

        const baseDist = radius * 0.12;
        const tipDist = radius * lengthFrac;
        const halfW = radius * widthFrac;

        const bx = dirX * baseDist;
        const bz = dirZ * baseDist;
        const by = 0.02;

        const tx = dirX * tipDist;
        const tz = dirZ * tipDist;
        const ty = 0.02 + cupTilt * 0.12 * radius;

        const c = i % 3 === 0 ? alternateColor : primaryColor;

        // Petal triangle (baseLeft, tip, baseRight)
        positions.push(bx + sideX * halfW, by, bz + sideZ * halfW);
        colors.push(c.r, c.g, c.b);

        positions.push(tx, ty, tz);
        colors.push(c.r, c.g, c.b);

        positions.push(bx - sideX * halfW, by, bz - sideZ * halfW);
        colors.push(c.r, c.g, c.b);
      }
    };

    // Outer petal ring: 8 petals, length 1.0, width 0.22
    drawPetalRing(8, 1.0, 0.22, 0, 0.35, palette.outerPetal, palette.petalLight);

    // Inner petal ring: 6 petals, length 0.66, width 0.19, angleOffset PI/6
    drawPetalRing(
      6,
      0.66,
      0.19,
      Math.PI / 6,
      0.65,
      palette.innerPetal,
      palette.petalLight
    );

    // Center dual-tone pistil receptacle (outer circle dark, inner dome light)
    const pistilR = radius * 0.26;
    for (let i = 0; i < 12; i++) {
      const a1 = (i / 12) * TAU;
      const a2 = ((i + 1) / 12) * TAU;

      // Outer ring (palette.centerDark)
      positions.push(0, 0.04, 0);
      colors.push(palette.centerDark.r, palette.centerDark.g, palette.centerDark.b);
      positions.push(Math.cos(a1) * pistilR, 0.035, Math.sin(a1) * pistilR);
      colors.push(palette.centerDark.r, palette.centerDark.g, palette.centerDark.b);
      positions.push(Math.cos(a2) * pistilR, 0.035, Math.sin(a2) * pistilR);
      colors.push(palette.centerDark.r, palette.centerDark.g, palette.centerDark.b);

      // Inner dome (palette.center)
      const innerR = pistilR * 0.65;
      positions.push(0, 0.06, 0);
      colors.push(palette.center.r, palette.center.g, palette.center.b);
      positions.push(Math.cos(a1) * innerR, 0.055, Math.sin(a1) * innerR);
      colors.push(palette.center.r, palette.center.g, palette.center.b);
      positions.push(Math.cos(a2) * innerR, 0.055, Math.sin(a2) * innerR);
      colors.push(palette.center.r, palette.center.g, palette.center.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.flowerMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildClusters(): void {
    // Generate organic clusters of lotus leaves across the pond margins
    const clusterAngles = [0.3, 1.25, 2.4, 3.8, 4.9, 5.7];
    const leafPlacements: { x: number; z: number; r: number; ang: number; flower: boolean }[] = [];

    for (const baseAng of clusterAngles) {
      const R = pondR(baseAng) * rand(0.52, 0.78);
      const cx = Math.cos(baseAng) * R;
      const cz = Math.sin(baseAng) * R;

      // Group of 2 to 4 leaves per cluster
      const numLeaves = Math.floor(rand(2, 4));
      for (let k = 0; k < numLeaves; k++) {
        const offA = rand(0, TAU);
        const offD = rand(0.3, 1.4);
        const lx = cx + Math.cos(offA) * offD;
        const lz = cz + Math.sin(offA) * offD;
        const radius = rand(0.75, 1.35);
        const ang = rand(0, TAU);
        const flower = k === 0 && rand(0, 1) > 0.35; // ~65% clusters have a flower

        if (!leafPlacements.some((p) => Math.hypot(p.x - lx, p.z - lz) < (p.r + radius) * 0.45)) {
          leafPlacements.push({ x: lx, z: lz, r: radius, ang, flower });
        }
      }
    }

    // Build meshes
    for (let i = 0; i < leafPlacements.length; i++) {
      const p = leafPlacements[i];
      const phase = rand(0, TAU);
      const leafPal = LOTUS_LEAF_PALETTES[i % LOTUS_LEAF_PALETTES.length];

      const { leafMesh, veinMesh, shadowGeo } = this.buildLeafMesh(p.r, p.ang, phase, leafPal);

      const leafGroup = new THREE.Group();
      leafGroup.add(leafMesh, veinMesh);

      // Shadow mesh projected onto water surface/bed
      const shadowMesh = new THREE.Mesh(shadowGeo, this.shadowMaterial);
      shadowMesh.position.set(p.x + 0.12, -0.04, p.z + 0.18);
      shadowMesh.scale.setScalar(1.02);
      this.shadowGroup.add(shadowMesh);

      let flowerMesh: THREE.Mesh | undefined;
      if (p.flower) {
        const flowerPal = LOTUS_FLOWER_PALETTES[i % LOTUS_FLOWER_PALETTES.length];
        flowerMesh = this.buildFlowerMesh(p.r * 0.45, rand(0, TAU), flowerPal);
        // Position on leaf notch or floating edge
        flowerMesh.position.set(p.r * 0.28, 0.03, -p.r * 0.22);
        leafGroup.add(flowerMesh);
      }

      leafGroup.position.set(p.x, 0.025, p.z);
      this.group.add(leafGroup);

      this.items.push({
        group: leafGroup,
        shadowMesh,
        flowerMesh,
        baseX: p.x,
        baseZ: p.z,
        radius: p.r,
        phase,
        hasFlower: p.flower,
      });
    }
  }

  public update(time: number, wind: number = 0.15, ripples?: THREE.Vector4[]): void {
    // Nagomi organic sway, gentle drift, surface wave bobbing and tilt
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const driftX = Math.sin(time * 0.12 + item.phase) * 0.05;
      const driftZ = Math.cos(time * 0.15 + item.phase * 1.3) * 0.045;
      const sway = Math.sin(time * 0.085 + item.phase) * 0.055;
      const pulse = 1 + Math.sin(time * 0.11 + item.phase) * 0.015;

      const px = item.baseX + driftX;
      const pz = item.baseZ + driftZ;

      // Hydrodynamic wave height and normal tilt
      const surf = getWaterSurface(px, pz, time, wind, ripples);

      item.group.position.set(px, 0.018 + surf.y, pz);
      item.group.rotation.x = surf.tiltX * 0.82;
      item.group.rotation.y = sway;
      item.group.rotation.z = surf.tiltZ * 0.82;
      item.group.scale.setScalar(pulse);

      item.shadowMesh.position.set(px + 0.12, -0.04 + surf.y * 0.4, pz + 0.18);
      item.shadowMesh.rotation.y = sway;
      item.shadowMesh.scale.setScalar(pulse * 1.02);

      if (item.flowerMesh) {
        item.flowerMesh.rotation.y = Math.sin(time * 0.12 + item.phase) * 0.04;
      }
    }
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.shadowGroup);
    this.leafMaterial.dispose();
    this.veinMaterial.dispose();
    this.flowerMaterial.dispose();
    this.shadowMaterial.dispose();
  }
}
