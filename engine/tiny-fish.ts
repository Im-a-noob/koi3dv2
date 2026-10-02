import * as THREE from "three";
import { TAU, rand, pondR, clamp } from "../math/noise";
import { underwater } from "../shaders/underwater";
import { KoiFish } from "./koi-mesh";

export interface TinyFishPalette {
  body: THREE.Color;
  light: THREE.Color;
  accent: THREE.Color;
  fin: THREE.Color;
  eye: THREE.Color;
}

export const TINY_FISH_PALETTES: readonly TinyFishPalette[] = [
  // 0: Golden Sun Minnows
  {
    body: new THREE.Color(0xffe66d),
    light: new THREE.Color(0xfff3a0),
    accent: new THREE.Color(0xff8c42),
    fin: new THREE.Color(0xffc857),
    eye: new THREE.Color(0x203638),
  },
  // 1: Azure Neon Minnows
  {
    body: new THREE.Color(0x56dffc),
    light: new THREE.Color(0xb2f2ff),
    accent: new THREE.Color(0x3877ed),
    fin: new THREE.Color(0x85edff),
    eye: new THREE.Color(0x173b52),
  },
  // 2: Ruby Rose Minnows
  {
    body: new THREE.Color(0xff72ad),
    light: new THREE.Color(0xffbad2),
    accent: new THREE.Color(0xffd05e),
    fin: new THREE.Color(0xff9bc2),
    eye: new THREE.Color(0x4d2940),
  },
  // 3: Spring Emerald Minnows
  {
    body: new THREE.Color(0xa8ed48),
    light: new THREE.Color(0xddff8c),
    accent: new THREE.Color(0x38bb78),
    fin: new THREE.Color(0xc5f56d),
    eye: new THREE.Color(0x254535),
  },
];

export interface TinyFishAgent {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  bodyLength: number;
  bodyWidth: number;
  tailPhase: number;
  phase: number;
  schoolIndex: number;
  paletteIndex: number;
  cruiseSpeed: number;
  fleeDelay: number;
  fleeTime: number;
  fleeDuration: number;
  callPoint: { x: number; z: number };
}

interface TinySchoolRange {
  start: number;
  count: number;
  phase: number;
  heading: number;
  swirlDirection: number; // -1 or 1
}

function wrapAngle(a: number): number {
  while (a < -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

export class TinyFishSystem {
  public readonly group = new THREE.Group();

  public readonly fish: TinyFishAgent[] = [];
  private readonly ranges: TinySchoolRange[] = [];
  private readonly maxFish: number;

  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  private bodyMesh: THREE.Mesh;

  // Body(12: top fan 6 + bottom fan 6) + Fins(2) + Stripe(2) + Eyes(2) + Tail(2) = 20 triangles = 60 vertices
  private readonly VERTS_PER_FISH = 60;

  constructor(scene: THREE.Scene, schoolCount = 4, fishPerSchool = 22) {
    this.maxFish = schoolCount * fishPerSchool;

    const totalVerts = this.maxFish * this.VERTS_PER_FISH;
    const positions = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("color", this.colAttr);

    const bodyMat = underwater(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.26,
        metalness: 0.08,
        side: THREE.DoubleSide,
      }),
      { caustic: 0.45, snow: 0 }
    );

    this.bodyMesh = new THREE.Mesh(geo, bodyMat);
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.castShadow = true;

    this.group.add(this.bodyMesh);

    scene.add(this.group);

    this.initSchools(schoolCount, fishPerSchool);
  }

  private initSchools(schoolCount: number, fishPerSchool: number): void {
    const schoolSettings = [
      { x: -2.8, z: 1.4, heading: 0.35, swirl: 1, pal: 0 },
      { x: 3.2, z: -1.2, heading: 2.75, swirl: -1, pal: 1 },
      { x: -1.4, z: -2.8, heading: -0.72, swirl: 1, pal: 2 },
      { x: 2.6, z: 2.2, heading: 2.2, swirl: -1, pal: 3 },
    ];

    for (let s = 0; s < schoolCount; s++) {
      const cfg = schoolSettings[s % schoolSettings.length];
      const start = this.fish.length;

      for (let i = 0; i < fishPerSchool; i++) {
        const offA = rand(0, TAU);
        const offR = Math.sqrt(rand(0, 1)) * 1.1; // Spread
        const length = rand(0.16, 0.25);
        const width = length * rand(0.24, 0.34);
        const cruiseSpeed = rand(0.85, 1.25);
        const heading = cfg.heading + rand(-0.34, 0.34);

        this.fish.push({
          x: cfg.x + Math.cos(offA) * offR,
          y: rand(-0.25, -0.45),
          z: cfg.z + Math.sin(offA) * offR,
          vx: Math.cos(heading) * cruiseSpeed,
          vz: Math.sin(heading) * cruiseSpeed,
          bodyLength: length,
          bodyWidth: width,
          tailPhase: rand(0, TAU),
          phase: rand(0, TAU),
          schoolIndex: s,
          paletteIndex: cfg.pal,
          cruiseSpeed,
          fleeDelay: -1,
          fleeTime: 0,
          fleeDuration: rand(1.45, 2.35),
          callPoint: { x: 0, z: 0 },
        });
      }

      this.ranges.push({
        start,
        count: fishPerSchool,
        phase: rand(0, TAU),
        heading: cfg.heading,
        swirlDirection: cfg.swirl,
      });
    }
  }

  public update(dt: number, time: number, koiList?: KoiFish[]): void {
    const pArr = this.posAttr.array as Float32Array;
    const cArr = this.colAttr.array as Float32Array;

    // Check Koi presence for Nagomi panic shockwave trigger
    if (koiList && koiList.length > 0) {
      for (const fish of this.fish) {
        if (fish.fleeDelay >= 0 || fish.fleeTime > 0) continue;

        for (const koi of koiList) {
          const dx = fish.x - koi.x;
          const dz = fish.z - koi.z;
          const dist = Math.hypot(dx, dz);
          // Nagomi reaction radius: ~2.4m
          if (dist < 2.4) {
            fish.callPoint.x = koi.x;
            fish.callPoint.z = koi.z;
            // Shockwave propagation delay from Nagomi
            fish.fleeDelay = dist / 6.5 + rand(0, 0.16);
            fish.fleeDuration = rand(1.45, 2.35);
            break;
          }
        }
      }
    }

    // Update each school following Nagomi's exact Boids + Sinuous Steering
    for (let s = 0; s < this.ranges.length; s++) {
      const range = this.ranges[s];
      let center = { x: 0, z: 0 };
      let avgVel = { x: 0, z: 0 };

      for (let i = range.start; i < range.start + range.count; i++) {
        center.x += this.fish[i].x;
        center.z += this.fish[i].z;
        avgVel.x += this.fish[i].vx;
        avgVel.z += this.fish[i].vz;
      }
      center.x /= range.count;
      center.z /= range.count;
      avgVel.x /= range.count;
      avgVel.z /= range.count;

      const avgSpeed = Math.hypot(avgVel.x, avgVel.z) || 0.001;
      const schoolForward = {
        x: avgVel.x / avgSpeed,
        z: avgVel.z / avgSpeed,
      };

      for (let i = range.start; i < range.start + range.count; i++) {
        const fish = this.fish[i];

        // 1. Process Flee Shockwave Activation
        if (fish.fleeDelay >= 0) {
          fish.fleeDelay -= dt;
          if (fish.fleeDelay <= 0) {
            fish.fleeDelay = -1;
            fish.fleeTime = fish.fleeDuration;
            const awayX = fish.x - fish.callPoint.x;
            const awayZ = fish.z - fish.callPoint.z;
            const awayDist = Math.hypot(awayX, awayZ) || 0.001;
            // Impulse boost from Nagomi
            const impulse = 1.35;
            fish.vx += (awayX / awayDist) * impulse;
            fish.vz += (awayZ / awayDist) * impulse;
          }
        }

        // 2. Boids Forces
        let separation = { x: 0, z: 0 };
        let alignment = { x: 0, z: 0 };
        let cohesion = { x: 0, z: 0 };
        let neighbours = 0;

        const neighbourRadius = 1.25;
        const separationRadius = 0.38;

        for (let other = range.start; other < range.start + range.count; other++) {
          if (other === i) continue;
          const offX = fish.x - this.fish[other].x;
          const offZ = fish.z - this.fish[other].z;
          const dist = Math.hypot(offX, offZ);

          if (dist <= 0.001 || dist >= neighbourRadius) continue;
          neighbours++;
          cohesion.x += this.fish[other].x;
          cohesion.z += this.fish[other].z;

          const oSpd = Math.hypot(this.fish[other].vx, this.fish[other].vz) || 0.001;
          alignment.x += this.fish[other].vx / oSpd;
          alignment.z += this.fish[other].vz / oSpd;

          if (dist < separationRadius) {
            const factor = (separationRadius - dist) / separationRadius;
            separation.x += (offX / dist) * factor;
            separation.z += (offZ / dist) * factor;
          }
        }

        const curSpd = Math.hypot(fish.vx, fish.vz) || 0.001;
        const forward = { x: fish.vx / curSpd, z: fish.vz / curSpd };

        if (neighbours > 0) {
          const cohTargetX = (cohesion.x / neighbours) - fish.x;
          const cohTargetZ = (cohesion.z / neighbours) - fish.z;
          const cohLen = Math.hypot(cohTargetX, cohTargetZ) || 0.001;
          cohesion.x = cohTargetX / cohLen;
          cohesion.z = cohTargetZ / cohLen;

          const aliLen = Math.hypot(alignment.x, alignment.z) || 0.001;
          alignment.x /= aliLen;
          alignment.z /= aliLen;
        } else {
          const cohTargetX = center.x - fish.x;
          const cohTargetZ = center.z - fish.z;
          const cohLen = Math.hypot(cohTargetX, cohTargetZ) || 0.001;
          cohesion.x = cohTargetX / cohLen;
          cohesion.z = cohTargetZ / cohLen;
          alignment.x = schoolForward.x;
          alignment.z = schoolForward.z;
        }

        // Swirl force around school center (Nagomi exact formula)
        const fromCenterX = fish.x - center.x;
        const fromCenterZ = fish.z - center.z;
        const fromCenterDist = Math.hypot(fromCenterX, fromCenterZ) || 0.001;
        const normFromCenterX = fromCenterX / fromCenterDist;
        const normFromCenterZ = fromCenterZ / fromCenterDist;
        // Perpendicular vector
        const perpX = -normFromCenterZ * range.swirlDirection;
        const perpZ = normFromCenterX * range.swirlDirection;

        // Wander force with Nagomi dual-harmonic frequencies
        const wanderAngle =
          Math.atan2(forward.z, forward.x) +
          Math.sin(time * 0.62 + fish.phase + range.phase) * 0.58 +
          Math.sin(time * 0.19 + fish.phase * 1.7) * 0.31;
        const wanderDirX = Math.cos(wanderAngle);
        const wanderDirZ = Math.sin(wanderAngle);

        // Blend steering
        let steerX =
          forward.x * 0.82 +
          wanderDirX * 0.34 +
          cohesion.x * 0.62 +
          alignment.x * 0.56 +
          separation.x * 2.8 +
          perpX * 0.46;

        let steerZ =
          forward.z * 0.82 +
          wanderDirZ * 0.34 +
          cohesion.z * 0.62 +
          alignment.z * 0.56 +
          separation.z * 2.8 +
          perpZ * 0.46;

        // Pond boundary avoidance
        const curDist = Math.hypot(fish.x, fish.z);
        const curAng = Math.atan2(fish.z, fish.x);
        const limitR = pondR(curAng) * 0.82;
        if (curDist > limitR) {
          const factor = ((curDist - limitR) / 1.0) * 4.8;
          steerX -= Math.cos(curAng) * factor;
          steerZ -= Math.sin(curAng) * factor;
        }

        // Nagomi periodic speed variation (pulsing stroke)
        let targetSpeed =
          fish.cruiseSpeed *
          (1 + Math.sin(time * 0.83 + fish.phase) * 0.46);

        // Flee steering and burst speed override
        if (fish.fleeTime > 0) {
          fish.fleeTime = Math.max(0, fish.fleeTime - dt);
          const awayX = fish.x - fish.callPoint.x;
          const awayZ = fish.z - fish.callPoint.z;
          const awayLen = Math.hypot(awayX, awayZ) || 0.001;
          const normAwayX = awayX / awayLen;
          const normAwayZ = awayZ / awayLen;

          const schoolAwayX = center.x - fish.callPoint.x;
          const schoolAwayZ = center.z - fish.callPoint.z;
          const schoolAwayLen = Math.hypot(schoolAwayX, schoolAwayZ) || 0.001;

          steerX =
            normAwayX * 5.8 +
            (schoolAwayX / schoolAwayLen) * 0.58 +
            alignment.x * 0.58 +
            separation.x * 2.8;

          steerZ =
            normAwayZ * 5.8 +
            (schoolAwayZ / schoolAwayLen) * 0.58 +
            alignment.z * 0.58 +
            separation.z * 2.8;

          targetSpeed = fish.cruiseSpeed * 2.45;
        }

        // 3. Nagomi Clamped Turn Rate (Prevents unnatural jerking)
        const steerLen = Math.hypot(steerX, steerZ) || 0.001;
        const desiredX = steerX / steerLen;
        const desiredZ = steerZ / steerLen;

        const currentHeading = Math.atan2(fish.vz, fish.vx);
        const desiredHeading = Math.atan2(desiredZ, desiredX);
        const headingStep = clamp(
          wrapAngle(desiredHeading - currentHeading),
          -2.8 * dt,
          2.8 * dt
        );
        const limitedHeading = currentHeading + headingStep;

        // 4. Exponential Speed Inertia
        const response = 1 - Math.exp(-4.8 * dt);
        const currentSpeed = curSpd;
        const nextSpeed = currentSpeed + (targetSpeed - currentSpeed) * response;

        fish.vx = Math.cos(limitedHeading) * nextSpeed;
        fish.vz = Math.sin(limitedHeading) * nextSpeed;

        fish.x += fish.vx * dt;
        fish.z += fish.vz * dt;

        // 5. Nagomi Exact Tail Oscillation Formula
        fish.tailPhase += (4.4 + nextSpeed * 4.2) * dt;

        // Render Geometry
        this.drawMinnow(i, fish, limitedHeading, pArr, cArr);
      }
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  private drawMinnow(
    index: number,
    f: TinyFishAgent,
    heading: number,
    pArr: Float32Array,
    cArr: Float32Array
  ): void {
    const pal = TINY_FISH_PALETTES[f.paletteIndex % TINY_FISH_PALETTES.length];

    const fwdX = Math.cos(heading);
    const fwdZ = Math.sin(heading);
    const sideX = -fwdZ;
    const sideZ = fwdX;

    const cx = f.x;
    const cy = f.y;
    const cz = f.z;

    const L = f.bodyLength;
    const W = f.bodyWidth;

    // Body landmarks matching Nagomi proportions
    const noseX = cx + fwdX * (L * 0.5);
    const noseZ = cz + fwdZ * (L * 0.5);

    const flX = cx + fwdX * (L * 0.16) + sideX * W;
    const flZ = cz + fwdZ * (L * 0.16) + sideZ * W;

    const frX = cx + fwdX * (L * 0.16) - sideX * W;
    const frZ = cz + fwdZ * (L * 0.16) - sideZ * W;

    const blX = cx - fwdX * (L * 0.34) + sideX * (W * 0.58);
    const blZ = cz - fwdZ * (L * 0.34) + sideZ * (W * 0.58);

    const brX = cx - fwdX * (L * 0.34) - sideX * (W * 0.58);
    const brZ = cz - fwdZ * (L * 0.34) - sideZ * (W * 0.58);

    const tailRootX = cx - fwdX * (L * 0.44);
    const tailRootZ = cz - fwdZ * (L * 0.44);

    let vIdx = index * this.VERTS_PER_FISH * 3;

    const putTri = (
      x1: number, y1: number, z1: number,
      x2: number, y2: number, z2: number,
      x3: number, y3: number, z3: number,
      color: THREE.Color
    ) => {
      pArr[vIdx] = x1; pArr[vIdx + 1] = y1; pArr[vIdx + 2] = z1;
      cArr[vIdx] = color.r; cArr[vIdx + 1] = color.g; cArr[vIdx + 2] = color.b;
      vIdx += 3;

      pArr[vIdx] = x2; pArr[vIdx + 1] = y2; pArr[vIdx + 2] = z2;
      cArr[vIdx] = color.r; cArr[vIdx + 1] = color.g; cArr[vIdx + 2] = color.b;
      vIdx += 3;

      pArr[vIdx] = x3; pArr[vIdx + 1] = y3; pArr[vIdx + 2] = z3;
      cArr[vIdx] = color.r; cArr[vIdx + 1] = color.g; cArr[vIdx + 2] = color.b;
      vIdx += 3;
    };

    // Vertical volume: closed bipyramid around the XZ silhouette (echoes koi-mesh tube).
    const H = clamp(W * 0.75, 0.02, 0.06);
    const Hb = H * 0.8;
    const topCy = cy + H;
    const bottomCy = cy - Hb;
    const bellyShade = new THREE.Color().copy(pal.body).multiplyScalar(0.85);

    // 1. Body bipyramid (12 triangles): silhouette loop fans to top/bottom centers.
    // Top keeps nose light / rear body split; bottom is darkened for belly shading.
    putTri(noseX, cy, noseZ, flX, cy, flZ, cx, topCy, cz, pal.light);
    putTri(frX, cy, frZ, noseX, cy, noseZ, cx, topCy, cz, pal.light);
    putTri(flX, cy, flZ, blX, cy, blZ, cx, topCy, cz, pal.body);
    putTri(blX, cy, blZ, tailRootX, cy, tailRootZ, cx, topCy, cz, pal.body);
    putTri(tailRootX, cy, tailRootZ, brX, cy, brZ, cx, topCy, cz, pal.body);
    putTri(brX, cy, brZ, frX, cy, frZ, cx, topCy, cz, pal.body);
    putTri(flX, cy, flZ, noseX, cy, noseZ, cx, bottomCy, cz, bellyShade);
    putTri(noseX, cy, noseZ, frX, cy, frZ, cx, bottomCy, cz, bellyShade);
    putTri(blX, cy, blZ, flX, cy, flZ, cx, bottomCy, cz, bellyShade);
    putTri(tailRootX, cy, tailRootZ, blX, cy, blZ, cx, bottomCy, cz, bellyShade);
    putTri(brX, cy, brZ, tailRootX, cy, tailRootZ, cx, bottomCy, cz, bellyShade);
    putTri(frX, cy, frZ, brX, cy, brZ, cx, bottomCy, cz, bellyShade);

    // 2. Pectoral Fins (2 triangles)
    const finRootX = cx + fwdX * (L * 0.02);
    const finRootZ = cz + fwdZ * (L * 0.02);
    const finBackX = cx - fwdX * (L * 0.18);
    const finBackZ = cz - fwdZ * (L * 0.18);

    const finTipLeftX = finRootX + sideX * (W * 1.28);
    const finTipLeftZ = finRootZ + sideZ * (W * 1.28);
    const finTipRightX = finRootX - sideX * (W * 1.28);
    const finTipRightZ = finRootZ - sideZ * (W * 1.28);

    putTri(finRootX, cy, finRootZ, finTipLeftX, cy, finTipLeftZ, finBackX, cy, finBackZ, pal.fin);
    putTri(finRootX, cy, finRootZ, finBackX, cy, finBackZ, finTipRightX, cy, finTipRightZ, pal.fin);

    // 3. Dorsal Stripe (2 triangles)
    const stFrontX = cx + fwdX * (L * 0.08);
    const stFrontZ = cz + fwdZ * (L * 0.08);
    const stBackX = cx - fwdX * (L * 0.09);
    const stBackZ = cz - fwdZ * (L * 0.09);
    const stW = W * 0.65;

    const stStripeY = cy + H * 0.85 + 0.002;
    putTri(
      stFrontX + sideX * stW, stStripeY, stFrontZ + sideZ * stW,
      stFrontX - sideX * stW, stStripeY, stFrontZ - sideZ * stW,
      stBackX - sideX * stW, stStripeY, stBackZ - sideZ * stW,
      pal.accent
    );
    putTri(
      stFrontX + sideX * stW, stStripeY, stFrontZ + sideZ * stW,
      stBackX - sideX * stW, stStripeY, stBackZ - sideZ * stW,
      stBackX + sideX * stW, stStripeY, stBackZ + sideZ * stW,
      pal.accent
    );

    // 4. Two Lateral Eyes (4 small triangles)
    const eyeFwdX = cx + fwdX * (L * 0.31);
    const eyeFwdZ = cz + fwdZ * (L * 0.31);
    const eyeRad = 0.014;

    const elX = eyeFwdX + sideX * (W * 0.58);
    const elZ = eyeFwdZ + sideZ * (W * 0.58);
    const erX = eyeFwdX - sideX * (W * 0.58);
    const erZ = eyeFwdZ - sideZ * (W * 0.58);

    const eyeY = cy + H * 0.35;
    putTri(
      elX, eyeY, elZ + eyeRad,
      elX + eyeRad, eyeY, elZ - eyeRad,
      elX - eyeRad, eyeY, elZ - eyeRad,
      pal.eye
    );
    putTri(
      erX, eyeY, erZ + eyeRad,
      erX + eyeRad, eyeY, erZ - eyeRad,
      erX - eyeRad, eyeY, erZ - eyeRad,
      pal.eye
    );

    // 5. Vertical swallow tail: fins stand in Y so the side profile reads at low camera angles.
    const tailLen = L * 0.34;
    const tailSwing = Math.sin(f.tailPhase) * W * 0.44;
    const tailCx = tailRootX - fwdX * tailLen + sideX * tailSwing;
    const tailCz = tailRootZ - fwdZ * tailLen + sideZ * tailSwing;
    const tailH = W * 1.1 + L * 0.12;

    const notchX = tailRootX - fwdX * (tailLen * 0.62) + sideX * (tailSwing * 0.44);
    const notchZ = tailRootZ - fwdZ * (tailLen * 0.62) + sideZ * (tailSwing * 0.44);

    putTri(tailRootX, cy, tailRootZ, tailCx, cy + tailH, tailCz, notchX, cy, notchZ, pal.fin);
    putTri(tailRootX, cy, tailRootZ, notchX, cy, notchZ, tailCx, cy - tailH, tailCz, pal.fin);
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.bodyMesh.geometry.dispose();
  }
}
