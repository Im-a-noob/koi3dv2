import * as THREE from "three";
import { TAU, rand, srgb, pondR, pondD, terrainH } from "../math/noise";
import { underwater } from "../shaders/underwater";

export interface BambooCulm {
  x: number;
  z: number;
  y: number;
  h: number;
  r: number;
  bx: number;
  bz: number;
  ph: number;
  ry: number;
}

export class BambooSystem {
  public readonly group = new THREE.Group();
  public readonly items: BambooCulm[] = [];

  private culmMesh: THREE.InstancedMesh;
  private nodeMesh: THREE.InstancedMesh;
  private leafMesh: THREE.InstancedMesh;
  private nodeBase: { culm: number; frac: number }[] = [];
  private leafBase: { culm: number; frac: number; side: number; droop: number }[] = [];
  private dummy = new THREE.Object3D();
  private dir = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private quat = new THREE.Quaternion();

  constructor(scene: THREE.Scene, avoid: { x: number; z: number; r: number }[] = []) {
    const clumps: { x: number; z: number }[] = [];
    let tries = 0;
    while (clumps.length < 3 && tries < 2500) {
      tries++;
      const th = rand(0, TAU);
      const R = pondR(th) * rand(1.25, 1.5);
      const x = Math.cos(th) * R;
      const z = Math.sin(th) * R;
      const d = pondD(x, z);
      if (d < 1.25 || d > 1.5) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
      if (clumps.some((c) => Math.hypot(c.x - x, c.z - z) < 4)) continue;
      clumps.push({ x, z });
    }

    for (const c of clumps) {
      const n = Math.floor(rand(10, 17));
      for (let k = 0; k < n; k++) {
        const a = rand(0, TAU);
        const rr = Math.abs(rand(-1, 1) + rand(-1, 1)) * 0.7;
        const x = c.x + Math.cos(a) * rr;
        const z = c.z + Math.sin(a) * rr;
        if (pondD(x, z) < 1.05) continue;
        this.items.push({
          x,
          z,
          y: terrainH(x, z),
          h: rand(2.5, 4.5),
          r: rand(0.035, 0.06),
          bx: rand(-0.06, 0.06),
          bz: rand(-0.06, 0.06),
          ph: rand(0, TAU),
          ry: rand(0, TAU),
        });
      }
    }

    const culmGeo = new THREE.CylinderGeometry(0.62, 1.0, 1, 7);
    culmGeo.translate(0, 0.5, 0);
    const culmMat = underwater(
      new THREE.MeshStandardMaterial({ roughness: 0.55 }),
      { snow: 0 }
    );
    this.culmMesh = new THREE.InstancedMesh(culmGeo, culmMat, Math.max(this.items.length, 1));
    const cCulmA = srgb(0.42, 0.56, 0.24);
    const cCulmB = srgb(0.55, 0.62, 0.3);
    const cTmp = new THREE.Color();
    this.items.forEach((it, i) => {
      this.culmMesh.setColorAt(i, cTmp.copy(cCulmA).lerp(cCulmB, ((i * 0.37) % 1) * 0.7));
    });
    this.culmMesh.castShadow = true;
    this.group.add(this.culmMesh);

    const nodeGeo = new THREE.CylinderGeometry(1.12, 1.12, 0.055, 7);
    const nodeMat = underwater(
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      { snow: 0 }
    );
    const ringsPer = 4;
    this.nodeBase = [];
    this.items.forEach((_, ci) => {
      for (let k = 0; k < ringsPer; k++) {
        this.nodeBase.push({ culm: ci, frac: 0.22 + (k / ringsPer) * 0.68 });
      }
    });
    this.nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, Math.max(this.nodeBase.length, 1));
    const cNode = srgb(0.28, 0.4, 0.17);
    this.nodeBase.forEach((_, i) => this.nodeMesh.setColorAt(i, cNode));
    this.group.add(this.nodeMesh);

    const leafGeo = new THREE.ConeGeometry(0.09, 0.85, 4);
    leafGeo.translate(0, -0.42, 0);
    leafGeo.scale(1, 1, 0.35);
    const leafMat = underwater(
      new THREE.MeshStandardMaterial({ roughness: 0.65, side: THREE.DoubleSide }),
      { snow: 0 }
    );
    const leavesPer = 3;
    this.leafBase = [];
    this.items.forEach((_, ci) => {
      for (let k = 0; k < leavesPer; k++) {
        this.leafBase.push({ culm: ci, frac: 0.86 + k * 0.05, side: (k / leavesPer) * TAU, droop: rand(0.7, 1.2) });
      }
    });
    this.leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, Math.max(this.leafBase.length, 1));
    const cLeafA = srgb(0.24, 0.44, 0.2);
    const cLeafB = srgb(0.38, 0.55, 0.25);
    this.leafBase.forEach((_, i) => {
      this.leafMesh.setColorAt(i, cTmp.copy(cLeafA).lerp(cLeafB, (i % 2) * 0.85));
    });
    this.leafMesh.castShadow = true;
    this.group.add(this.leafMesh);

    scene.add(this.group);
    this.update(0, 0.15);
  }

  public update(t: number, wind: number): void {
    const amp = 0.05 * (1 + wind * 3);
    const sp = 1 + wind * 1.6;
    const lean = wind * 0.18;
    this.items.forEach((it, i) => {
      const rx = it.bx + Math.sin(t * 1.1 * sp + it.ph) * amp;
      const rz = it.bz + lean + Math.cos(t * 0.9 * sp + it.ph) * amp;
      this.dummy.position.set(it.x, it.y - 0.05, it.z);
      this.dummy.rotation.set(rx, it.ry, rz);
      this.dummy.scale.set(it.r / 0.05, it.h, it.r / 0.05);
      this.dummy.updateMatrix();
      this.culmMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.culmMesh.instanceMatrix.needsUpdate = true;

    this.quat.setFromUnitVectors(this.up, this.dir.set(0, 1, 0));
    const e = new THREE.Euler();
    this.nodeBase.forEach((nb, i) => {
      const it = this.items[nb.culm];
      const rx = it.bx + Math.sin(t * 1.1 * sp + it.ph) * amp;
      const rz = it.bz + lean + Math.cos(t * 0.9 * sp + it.ph) * amp;
      e.set(rx, it.ry, rz);
      this.quat.setFromEuler(e);
      this.dir.set(0, 1, 0).applyQuaternion(this.quat);
      const along = nb.frac * it.h;
      this.dummy.position.set(
        it.x + this.dir.x * along,
        it.y - 0.05 + this.dir.y * along,
        it.z + this.dir.z * along
      );
      this.dummy.quaternion.copy(this.quat);
      this.dummy.scale.set(it.r / 0.05, 1, it.r / 0.05);
      this.dummy.updateMatrix();
      this.nodeMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.nodeMesh.instanceMatrix.needsUpdate = true;

    this.leafBase.forEach((lb, i) => {
      const it = this.items[lb.culm];
      const rx = it.bx + Math.sin(t * 1.1 * sp + it.ph) * amp;
      const rz = it.bz + lean + Math.cos(t * 0.9 * sp + it.ph) * amp;
      e.set(rx, it.ry, rz);
      this.quat.setFromEuler(e);
      this.dir.set(0, 1, 0).applyQuaternion(this.quat);
      const along = lb.frac * it.h;
      this.dummy.position.set(
        it.x + this.dir.x * along,
        it.y - 0.05 + this.dir.y * along,
        it.z + this.dir.z * along
      );
      this.dummy.rotation.set(rx + lb.droop, it.ry + lb.side, rz);
      this.dummy.scale.setScalar(0.8 + (lb.culm % 3) * 0.15);
      this.dummy.updateMatrix();
      this.leafMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.leafMesh.instanceMatrix.needsUpdate = true;
  }

  public destroy(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.culmMesh.dispose();
    this.nodeMesh.dispose();
    this.leafMesh.dispose();
  }
}
