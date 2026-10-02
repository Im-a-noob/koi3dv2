import * as THREE from "three";
import {
  TAU,
  rand,
  rnd,
  pick,
  pondR,
  pondD,
  terrainH,
  srgb,
  smooth,
  lerp,
  clamp,
  wrap,
} from "../math/noise";
import { underwater } from "../shaders/underwater";
import { LotusSystem } from "./lotus";
import { DuckweedSystem } from "./duckweed";
import { TinyFishSystem } from "./tiny-fish";

export function lumpGeo(detail = 1, amt = 0.35): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const noise =
      Math.sin(v.x * 2.3 + 1.2) * Math.cos(v.y * 2.7) * Math.sin(v.z * 2.1) * amt;
    v.multiplyScalar(1 + noise);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export interface EnvironmentObjects {
  terrain: THREE.Mesh;
  lanterns: {
    group: THREE.Group;
    glow: THREE.MeshStandardMaterial;
    light: THREE.PointLight;
    x: number;
    z: number;
  }[];
  lotus: LotusSystem;
  duckweed: DuckweedSystem;
  tinyFish: TinyFishSystem;
  pads: {
    group: THREE.Group;
    x: number;
    z: number;
    ph: number;
    spin: number;
  }[];
  lotusFlowers: {
    flower: THREE.Group;
    base: boolean;
    rank: number;
  }[];
  reeds: {
    update: (t: number, wind: number) => void;
  };
  trees: {
    update: (c: {
      trees: number;
      canopy: number;
      canopyA: THREE.Color;
      canopyB: THREE.Color;
    }) => void;
    randomBlob: () => any;
  };
  meadow: {
    update: (bloom: number) => void;
  };
  birds: {
    list: any[];
    update: (dt: number, wantBirds: boolean) => void;
  };
}

export function buildEnvironment(scene: THREE.Scene): EnvironmentObjects {
  // 1. Terrain Mesh
  const TS = 90;
  const SEG = 200;
  const tg = new THREE.PlaneGeometry(TS, TS, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const tPos = tg.attributes.position;
  const tCol = new Float32Array(tPos.count * 3);
  const cSand = srgb(0.64, 0.58, 0.47);
  const cPebble = srgb(0.4, 0.38, 0.34);
  const cDark = srgb(0.22, 0.21, 0.2);
  const cGrass = srgb(0.35, 0.48, 0.22);
  const tmpCol = new THREE.Color();

  for (let i = 0; i < tPos.count; i++) {
    const x = tPos.getX(i);
    const z = tPos.getZ(i);
    const y = terrainH(x, z);
    tPos.setY(i, y);

    const d = pondD(x, z);
    if (d < 0.8) {
      tmpCol.copy(cDark).lerp(cPebble, d / 0.8);
    } else if (d < 1.05) {
      tmpCol.copy(cPebble).lerp(cSand, (d - 0.8) / 0.25);
    } else {
      tmpCol.copy(cSand).lerp(cGrass, smooth(1.05, 1.3, d));
    }
    tCol[i * 3] = tmpCol.r;
    tCol[i * 3 + 1] = tmpCol.g;
    tCol[i * 3 + 2] = tmpCol.b;
  }
  tg.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
  tg.computeVertexNormals();

  const terrainMat = underwater(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
    }),
    { caustic: 1.0, snow: 1.0, dry: true }
  );
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // 2. Shore Boulders & Stones
  const rockGeo = lumpGeo(2, 0.4);
  const rockMat = underwater(
    new THREE.MeshStandardMaterial({
      color: 0x7a7974,
      roughness: 0.9,
    }),
    { caustic: 0.7, snow: 1.0 }
  );

  const rockCount = 52;
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  const dummy = new THREE.Object3D();
  const cRock = new THREE.Color();

  for (let i = 0; i < rockCount; i++) {
    const th = rand(0, TAU);
    const R = pondR(th) * rand(0.96, 1.22);
    const x = Math.cos(th) * R;
    const z = Math.sin(th) * R;
    const y = terrainH(x, z);
    const s = rand(0.3, 0.85);

    dummy.position.set(x, y + s * 0.2, z);
    dummy.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    dummy.scale.set(s * rand(0.8, 1.3), s * rand(0.6, 1.1), s * rand(0.8, 1.3));
    dummy.updateMatrix();
    rockMesh.setMatrixAt(i, dummy.matrix);
    rockMesh.setColorAt(
      i,
      cRock.setHex(0x706f6a).offsetHSL(rand(-0.04, 0.04), rand(-0.1, 0.1), rand(-0.1, 0.1))
    );
  }
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  scene.add(rockMesh);

  // 3. Stone Lanterns (Tōrō)
  const lanterns: EnvironmentObjects["lanterns"] = [];
  const stoneMat = underwater(
    new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.92 })
  );

  for (const th of [-0.25, 3.0]) {
    const R = pondR(th) * 1.21;
    const x = Math.cos(th) * R;
    const z = Math.sin(th) * R;
    const y = terrainH(x, z);

    const gr = new THREE.Group();
    const parts: [THREE.BufferGeometry, number][] = [
      [new THREE.CylinderGeometry(0.42, 0.5, 0.22, 8), 0.11],
      [new THREE.CylinderGeometry(0.13, 0.17, 0.85, 8), 0.64],
      [new THREE.BoxGeometry(0.72, 0.12, 0.72), 1.12],
    ];
    for (const [geo, py] of parts) {
      const m = new THREE.Mesh(geo, stoneMat);
      m.position.y = py;
      m.castShadow = true;
      m.receiveShadow = true;
      gr.add(m);
    }

    const glow = new THREE.MeshStandardMaterial({
      color: 0xd9cfb9,
      emissive: 0xff9944,
      emissiveIntensity: 0.0,
      roughness: 0.8,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.38, 0.44), glow);
    box.position.y = 1.37;
    box.castShadow = true;
    gr.add(box);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4), stoneMat);
    roof.position.y = 1.77;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    roof.receiveShadow = true;
    gr.add(roof);

    const top = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), stoneMat);
    top.position.y = 2.02;
    gr.add(top);

    const light = new THREE.PointLight(0xffa858, 0, 11, 2);
    light.position.y = 1.37;
    gr.add(light);

    gr.position.set(x, y - 0.05, z);
    gr.rotation.y = rand(0, TAU);
    scene.add(gr);
    lanterns.push({ glow, light, group: gr, x, z });
  }

  // 4. Reeds along pond edge
  const reedGeo = new THREE.ConeGeometry(0.03, 1, 4, 1);
  reedGeo.translate(0, 0.5, 0);
  const reedItems: {
    x: number;
    z: number;
    y: number;
    h: number;
    tx: number;
    tz: number;
    ph: number;
    ry: number;
  }[] = [];

  for (const th of [0.4, 2.35, 3.6, 5.2]) {
    const R = pondR(th);
    for (let k = 0; k < 22; k++) {
      const a = th + rand(-0.14, 0.14);
      const r = R * rand(1.01, 1.14);
      const rx = Math.cos(a) * r;
      const rz = Math.sin(a) * r;
      reedItems.push({
        x: rx,
        z: rz,
        y: terrainH(rx, rz),
        h: rand(1.1, 2.2),
        tx: rand(-0.12, 0.12),
        tz: rand(-0.12, 0.12),
        ph: rand(0, TAU),
        ry: rand(0, TAU),
      });
    }
  }

  const reedMesh = new THREE.InstancedMesh(
    reedGeo,
    underwater(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { snow: 0 }),
    reedItems.length
  );
  const cReed1 = srgb(0.36, 0.48, 0.2);
  const cReed2 = srgb(0.55, 0.52, 0.28);
  const cTmp = new THREE.Color();
  reedItems.forEach((it, i) =>
    reedMesh.setColorAt(i, cTmp.copy(cReed1).lerp(cReed2, rnd() * 0.6))
  );
  reedMesh.castShadow = true;
  scene.add(reedMesh);

  const reedDummy = new THREE.Object3D();
  const reeds = {
    update(t: number, wind: number) {
      const amp = 0.05 * (1 + wind * 3);
      const sp = 1 + wind * 1.6;
      reedItems.forEach((it, i) => {
        reedDummy.position.set(it.x, it.y - 0.04, it.z);
        reedDummy.rotation.set(
          it.tx + Math.sin(t * 1.1 * sp + it.ph) * amp,
          it.ry,
          it.tz + wind * 0.18 + Math.cos(t * 0.9 * sp + it.ph) * amp
        );
        reedDummy.scale.set(1, it.h, 1);
        reedDummy.updateMatrix();
        reedMesh.setMatrixAt(i, reedDummy.matrix);
      });
      reedMesh.instanceMatrix.needsUpdate = true;
    },
  };

  // 5. Authentic Nagomi Lotus, Duckweed & Tiny Fish Systems
  const lotus = new LotusSystem(scene);
  const duckweed = new DuckweedSystem(scene);
  const tinyFish = new TinyFishSystem(scene, 4, 22);

  const pads: EnvironmentObjects["pads"] = [];
  const lotusFlowers: EnvironmentObjects["lotusFlowers"] = [];

  // 6. Japanese Trees surrounding pond
  const treeSpots: { x: number; z: number }[] = [];
  let tTries = 0;
  while (treeSpots.length < 14 && tTries < 2500) {
    tTries++;
    const th = rand(0, TAU);
    const R = pondR(th) * rand(1.3, 1.85);
    const x = Math.cos(th) * R;
    const z = Math.sin(th) * R;
    if (z > 3 && Math.abs(x) < 10) continue;
    if (lanterns.some((l) => Math.hypot(l.x - x, l.z - z) < 2.5)) continue;
    if (treeSpots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.2)) continue;
    treeSpots.push({ x, z });
  }

  const trunkMat = underwater(
    new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.92 })
  );
  const blobs: any[] = [];
  const treeList = treeSpots.map((sp, ti) => {
    const treeGroup = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 2.5, 7), trunkMat);
    trunk.position.y = 1.25;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    treeGroup.add(trunk);

    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6), trunkMat);
    b1.position.set(0.35, 2.2, 0.2);
    b1.rotation.set(0.3, 0.4, 0.6);
    b1.castShadow = true;
    treeGroup.add(b1);

    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 6), trunkMat);
    b2.position.set(-0.3, 2.3, -0.2);
    b2.rotation.set(-0.4, -0.3, -0.6);
    b2.castShadow = true;
    treeGroup.add(b2);

    const y = terrainH(sp.x, sp.z);
    const s = rand(0.9, 1.3);
    const yaw = rand(0, TAU);
    treeGroup.position.set(sp.x, y, sp.z);
    treeGroup.rotation.y = yaw;
    scene.add(treeGroup);

    // Canopy foliage blobs
    const branchTips = [
      new THREE.Vector3(0, 2.8, 0),
      new THREE.Vector3(0.8, 2.9, 0.5),
      new THREE.Vector3(-0.7, 2.85, -0.4),
      new THREE.Vector3(0.3, 3.4, -0.2),
      new THREE.Vector3(-0.4, 3.3, 0.4),
    ];
    for (const tp of branchTips) {
      blobs.push({
        tree: ti,
        local: tp,
        r: rand(0.7, 1.1),
        v: rnd(),
        fall: rnd(),
        q: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU))
        ),
        world: new THREE.Vector3(),
        scale: 0,
      });
    }

    return {
      group: treeGroup,
      x: sp.x,
      y,
      z: sp.z,
      s,
      yaw,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      grow: 0,
    };
  });

  const canopyMesh = new THREE.InstancedMesh(
    lumpGeo(2, 0.5),
    underwater(new THREE.MeshStandardMaterial({ roughness: 0.8 }), { snow: 0.8 }),
    blobs.length
  );
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  canopyMesh.frustumCulled = false;
  scene.add(canopyMesh);

  const TRUNK = new THREE.Color(0x5b4636);
  const TRUNK_DEAD = new THREE.Color(0x4a4440);
  const m4 = new THREE.Matrix4();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const cCanopy = new THREE.Color();

  const trees = {
    update(c: {
      trees: number;
      canopy: number;
      canopyA: THREE.Color;
      canopyB: THREE.Color;
    }) {
      const N = treeList.length;
      treeList.forEach((t, i) => {
        t.grow = smooth(0, 1, c.trees * N - i);
        t.group.visible = t.grow > 0.002;
        t.group.scale.setScalar(Math.max(t.s * t.grow, 1e-4));
      });
      trunkMat.color.copy(TRUNK).lerp(TRUNK_DEAD, 1 - c.canopy);

      blobs.forEach((b, i) => {
        const t = treeList[b.tree];
        const k = t.s * t.grow;
        const lx = b.local.x * k;
        const lz = b.local.z * k;
        b.world.set(
          t.x + lx * t.cos + lz * t.sin,
          t.y + b.local.y * k,
          t.z - lx * t.sin + lz * t.cos
        );
        b.scale = b.r * k * smooth(0, 1, c.canopy * 1.35 - b.fall * 0.35);
        pv.copy(b.world);
        sv.setScalar(Math.max(b.scale, 1e-4));
        m4.compose(pv, b.q, sv);
        canopyMesh.setMatrixAt(i, m4);
        canopyMesh.setColorAt(i, cCanopy.copy(c.canopyA).lerp(c.canopyB, b.v));
      });
      canopyMesh.instanceMatrix.needsUpdate = true;
      if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    },
    randomBlob() {
      for (let k = 0; k < 8; k++) {
        const b = pick(blobs);
        if (b && b.scale > 0.25) return b;
      }
      return null;
    },
  };

  // 7. Spring Meadow Flowers
  const mGeo = new THREE.CircleGeometry(1, 16);
  mGeo.rotateX(-Math.PI / 2);
  const mPos = mGeo.attributes.position;
  const mColr = new Float32Array(mPos.count * 3);
  for (let i = 0; i < mPos.count; i++) {
    const rx = mPos.getX(i);
    const rz = mPos.getZ(i);
    const r = Math.hypot(rx, rz);
    mPos.setY(i, r * r * 0.25);
    mColr.set(r < 0.05 ? [1, 0.8, 0.2] : [1, 1, 1], i * 3);
  }
  mGeo.setAttribute("color", new THREE.BufferAttribute(mColr, 3));
  mGeo.computeVertexNormals();

  const palette = [
    "#f7a8c4",
    "#fbf6ee",
    "#f7d54a",
    "#c9a6e8",
    "#ee6a5a",
    "#f8b98a",
    "#ffffff",
  ].map((h) => new THREE.Color(h));

  const meadowItems: {
    x: number;
    z: number;
    y: number;
    s: number;
    rx: number;
    rz: number;
    ry: number;
    rank: number;
    col: THREE.Color;
  }[] = [];

  for (let c = 0; c < 50; c++) {
    const th = rand(0, TAU);
    const R = pondR(th) * rand(1.15, 2.0);
    const cx = Math.cos(th) * R;
    const cz = Math.sin(th) * R;
    const baseCol = pick(palette);
    const countInCluster = 10 + Math.floor(rnd() * 12);

    for (let k = 0; k < countInCluster; k++) {
      const a = rand(0, TAU);
      const r = Math.abs(rand(-1, 1) + rand(-1, 1)) * 0.5;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (pondD(x, z) < 1.12) continue;
      meadowItems.push({
        x,
        z,
        y: terrainH(x, z) + rand(0.08, 0.22),
        s: rand(0.08, 0.14),
        rx: rand(-0.3, 0.3),
        rz: rand(-0.3, 0.3),
        ry: rand(0, TAU),
        rank: rnd(),
        col: baseCol.clone().lerp(pick(palette), rnd() < 0.2 ? 0.8 : 0.12),
      });
    }
  }

  const meadowMesh = new THREE.InstancedMesh(
    mGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
    meadowItems.length
  );
  meadowItems.forEach((it, i) => meadowMesh.setColorAt(i, it.col));
  meadowMesh.receiveShadow = true;
  meadowMesh.frustumCulled = false;
  scene.add(meadowMesh);

  const mDummy = new THREE.Object3D();
  const meadow = {
    update(bloom: number) {
      meadowMesh.visible = bloom > 0.002;
      meadowItems.forEach((it, i) => {
        const g = smooth(0, 1, bloom * 1.4 - it.rank * 0.4);
        mDummy.position.set(it.x, it.y, it.z);
        mDummy.rotation.set(it.rx, it.ry, it.rz);
        mDummy.scale.setScalar(Math.max(it.s * g, 1e-4));
        mDummy.updateMatrix();
        meadowMesh.setMatrixAt(i, mDummy.matrix);
      });
      meadowMesh.instanceMatrix.needsUpdate = true;
    },
  };

  // 8. Japanese Garden Birds
  const perches: { p: THREE.Vector3; yaw: number; busy: boolean }[] = [];
  lanterns.forEach((l) => {
    perches.push({
      p: l.group.localToWorld(new THREE.Vector3(0, 2.1, 0)),
      yaw: rand(0, TAU),
      busy: false,
    });
    perches.push({
      p: l.group.localToWorld(new THREE.Vector3(0.28, 1.18, 0.28)),
      yaw: rand(0, TAU),
      busy: false,
    });
  });

  const birdTones = [
    [0x7a5a3c, 0xd9c3a0],
    [0x5f636c, 0xe0dcd2],
    [0x8a4b2a, 0xe7c29a],
    [0x6b5a44, 0xcfbfa2],
  ];
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xe0a030, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.2 });
  const birdScale = 2.0;

  const birdList = birdTones.map(([back, belly], i) => {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    inner.scale.setScalar(birdScale);

    const bm = new THREE.MeshStandardMaterial({ color: back, roughness: 0.8 });
    const lm = new THREE.MeshStandardMaterial({ color: belly, roughness: 0.85 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bm);
    body.scale.set(0.062, 0.058, 0.12);

    const bellyM = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), lm);
    bellyM.scale.set(0.055, 0.045, 0.1);
    bellyM.position.set(0, -0.016, 0.01);

    const head = new THREE.Group();
    head.position.set(0, 0.045, 0.1);
    const hm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), bm);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.045, 6), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, -0.004, 0.058);
    const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), eyeMat);
    e1.position.set(0.034, 0.012, 0.028);
    const e2 = e1.clone();
    e2.position.x = -0.034;
    head.add(hm, beak, e1, e2);

    const wings = [-1, 1].map((sd) => {
      const pv = new THREE.Group();
      pv.position.set(sd * 0.045, 0.03, 0.01);
      const wg = new THREE.BufferGeometry();
      wg.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            0,
            0,
            0.05,
            0,
            0,
            -0.06,
            sd * 0.2,
            0,
            -0.04,
            0,
            0,
            0.05,
            sd * 0.2,
            0,
            -0.04,
            sd * 0.13,
            0,
            0.03,
          ],
          3
        )
      );
      wg.computeVertexNormals();
      pv.add(
        new THREE.Mesh(
          wg,
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(back).multiplyScalar(0.85),
            side: THREE.DoubleSide,
            roughness: 0.8,
          })
        )
      );
      inner.add(pv);
      return { pv, sd };
    });

    inner.add(body, bellyM, head);
    root.rotation.order = "YXZ";
    root.visible = false;
    scene.add(root);

    return {
      root,
      inner,
      head,
      wings,
      st: "away",
      pos: new THREE.Vector3(0, -50, 0),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      t: 0,
      phase: rand(0, TAU),
      seed: rand(0, 100),
      perch: null as any,
      ang: rand(0, TAU),
      rad: rand(6, 10),
      alt: rand(3, 5),
      dir: rnd() < 0.5 ? -1 : 1,
      delay: i * 1.5,
    };
  });

  const bTgt = new THREE.Vector3();
  const bTmp = new THREE.Vector3();
  const bDes = new THREE.Vector3();

  function seekBird(b: any, maxSp: number, arriveK: number, k: number, dt: number) {
    bTmp.subVectors(bTgt, b.pos);
    const d = bTmp.length();
    if (d > 1e-4) bDes.copy(bTmp).multiplyScalar(Math.min(maxSp, d * arriveK) / d);
    else bDes.set(0, 0, 0);
    b.vel.lerp(bDes, 1 - Math.exp(-dt * k));
    return d;
  }

  const birds = {
    list: birdList,
    update(dt: number, wantBirds: boolean) {
      for (const b of birdList) {
        if (b.st === "away") {
          if (!wantBirds) continue;
          b.delay -= dt;
          if (b.delay > 0) continue;
          const a = rand(0, TAU);
          b.pos.set(Math.cos(a) * 26, rand(6, 8), Math.sin(a) * 26);
          b.vel.set(-Math.cos(a) * 3, -0.5, -Math.sin(a) * 3);
          b.yaw = Math.atan2(b.vel.x, b.vel.z);
          b.st = "fly";
          b.t = rand(4, 8);
          b.root.visible = true;
        }

        if (!wantBirds && b.st !== "leave") {
          if (b.perch) {
            b.perch.busy = false;
            b.perch = null;
          }
          b.st = "leave";
          b.vel.y = Math.max(b.vel.y, 1.5);
        }

        if (b.st === "fly") {
          b.ang += dt * 0.42 * b.dir;
          bTgt.set(Math.cos(b.ang) * b.rad, b.alt, Math.sin(b.ang) * b.rad);
          seekBird(b, 3.4, 99, 1.4, dt);
          b.t -= dt;
          if (b.t <= 0) {
            const free = perches.filter((p) => !p.busy);
            if (free.length > 0) {
              b.perch = pick(free);
              b.perch.busy = true;
              b.st = "land";
            } else {
              b.t = rand(3, 6);
            }
          }
        } else if (b.st === "land") {
          const pp = b.perch.p;
          const dxz = Math.hypot(pp.x - b.pos.x, pp.z - b.pos.z);
          bTgt.set(pp.x, pp.y + (dxz > 0.9 ? 0.7 : 0), pp.z);
          const d = seekBird(b, 3.0, 2.2, 3.2, dt);
          if (dxz < 0.9 && d < 0.06 + dt * 1.5) {
            b.pos.copy(pp);
            b.vel.set(0, 0, 0);
            b.st = "perch";
            b.t = rand(10, 20);
            b.yaw = b.perch.yaw;
          }
        } else if (b.st === "perch") {
          b.t -= dt;
          if (rnd() < dt * 0.25) b.yaw += rand(-0.7, 0.7);
          if (b.t <= 0) {
            b.perch.busy = false;
            b.perch = null;
            b.st = "fly";
            b.t = rand(4, 8);
            b.vel.set(Math.sin(b.yaw) * 1.5, 2.4, Math.cos(b.yaw) * 1.5);
            b.ang = Math.atan2(b.pos.z, b.pos.x);
          }
        } else if (b.st === "leave") {
          bTgt.set(b.pos.x, 0, b.pos.z);
          if (bTgt.lengthSq() < 1) bTgt.set(1, 0, 0);
          bTgt.normalize().multiplyScalar(40);
          bTgt.y = 12;
          seekBird(b, 5, 99, 1.5, dt);
          if (Math.hypot(b.pos.x, b.pos.z) > 32) {
            b.st = "away";
            b.root.visible = false;
            b.delay = rand(1, 4);
          }
        }

        if (b.st !== "perch") b.pos.addScaledVector(b.vel, dt);
        const hs = Math.hypot(b.vel.x, b.vel.z);
        if (b.st !== "perch" && hs > 0.15) {
          b.yaw += wrap(Math.atan2(b.vel.x, b.vel.z) - b.yaw) * (1 - Math.exp(-dt * 6));
          b.pitch = lerp(b.pitch, clamp(Math.atan2(b.vel.y, hs), -0.6, 0.6), 1 - Math.exp(-dt * 5));
        } else {
          b.pitch = lerp(b.pitch, 0, 1 - Math.exp(-dt * 6));
        }

        b.root.position.copy(b.pos);
        b.root.rotation.set(-b.pitch, b.yaw, 0);

        if (b.st === "perch") {
          for (const w of b.wings) w.pv.rotation.set(0, w.sd * 1.25, -w.sd * 0.15);
        } else {
          b.phase += dt * (b.st === "land" ? 22 : 17);
          const flap = Math.sin(b.phase) * 0.95;
          for (const w of b.wings) w.pv.rotation.set(0, w.sd * 0.12, w.sd * flap);
        }
      }
    },
  };

  return {
    terrain,
    lanterns,
    lotus,
    duckweed,
    tinyFish,
    pads,
    lotusFlowers,
    reeds,
    trees,
    meadow,
    birds,
  };
}
