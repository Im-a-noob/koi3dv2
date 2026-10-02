import * as THREE from "three";
import { FoodPellet } from "../types/koi";
import { TAU, rand, rnd, pondD, terrainH } from "../math/noise";
import { underwater, sharedUniforms } from "../shaders/underwater";
import { getWaterSurface } from "../math/water-physics";
import { sound } from "./audio";
import { KoiFish } from "./koi-mesh";

// Transparent iridescent rainbow material for bubbles
export function createRainbowBubbleMaterial(): THREE.Material {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0.08,
    transparent: true,
    opacity: 0.95,
    side: THREE.FrontSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.uniforms.uSunCol = sharedUniforms.uSunCol;
    sh.uniforms.uWaterCol = sharedUniforms.uWaterCol;

    sh.vertexShader =
      "varying vec3 vBubbleWPos;\nvarying vec3 vBubbleNorm;\n" +
      sh.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vBubbleWPos = (modelMatrix * wp4).xyz;
        #ifdef USE_INSTANCING
          mat3 bNormMat = mat3(modelMatrix * instanceMatrix);
        #else
          mat3 bNormMat = normalMatrix;
        #endif
        vBubbleNorm = normalize(bNormMat * normal);
        `
      );

    sh.fragmentShader =
      `varying vec3 vBubbleWPos;
      varying vec3 vBubbleNorm;
      uniform float uTime;
      uniform vec3 uSunCol;
      uniform vec3 uWaterCol;

      vec3 spectralRainbow(float t) {
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.00, 0.33, 0.67);
        vec3 col = clamp(a + b * cos(6.28318 * (c * t + d)), 0.0, 1.0);
        return col * col * 1.35; // Rich optical saturation
      }
      ` +
      sh.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
        vec3 V = normalize(cameraPosition - vBubbleWPos);
        vec3 N = normalize(vBubbleNorm);
        float cosTheta = clamp(abs(dot(N, V)), 0.0, 1.0);
        float fresnel = pow(1.0 - cosTheta, 2.3);

        // Thin-film thickness variation & hydrodynamic swirl
        float swirl = sin(vBubbleWPos.y * 16.0 + uTime * 2.2 + vBubbleWPos.x * 12.0 + vBubbleWPos.z * 12.0) * 0.16;
        float opd = (1.0 - cosTheta) * 3.6 + swirl + vBubbleWPos.y * 0.55;

        // Vivid spectral rainbow color
        vec3 rainbowColor = spectralRainbow(opd);

        // Dual specular highlights (sun glint on outer surface & inner back reflection)
        vec3 L = normalize(vec3(0.35, 0.95, 0.3));
        vec3 H = normalize(L + V);
        float spec1 = pow(max(0.0, dot(N, H)), 72.0);
        float spec2 = pow(max(0.0, -dot(N, H)), 32.0) * 0.35;
        vec3 sunGlint = (spec1 + spec2) * vec3(1.0, 0.98, 0.92) * 2.6;

        // Base crystal water glass tint at center
        vec3 centerGlass = vec3(0.88, 0.96, 1.0);

        // Blend: crystal center -> vibrant chromatic rainbow rim + sparkling sun glint
        vec3 finalColor = mix(centerGlass, rainbowColor, fresnel * 0.9 + 0.1) + sunGlint;

        // Transparency: transparent in middle, bright rainbow silhouette at edges, solid glint
        float alpha = clamp(fresnel * 0.78 + (spec1 + spec2) * 0.95 + 0.08, 0.0, 0.96);

        gl_FragColor = vec4(finalColor, alpha);
        `
      );
  };

  return mat;
}

export function createFoodMesh(x: number, z: number): FoodPellet {
  const geo = new THREE.DodecahedronGeometry(0.045, 0);
  const mat = underwater(
    new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.85,
    }),
    { caustic: 0.5, snow: 0 }
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0.02, z);
  mesh.castShadow = true;

  const ang = rand(0, TAU);
  const spd = rand(0.02, 0.08);

  return {
    x,
    z,
    vx: Math.cos(ang) * spd,
    vz: Math.sin(ang) * spd,
    born: 0,
    eaten: false,
    mesh,
  };
}

export function createParticleSystem(scene: THREE.Scene) {
  // 1. Seasonal Falling Leaves & Petals (Sakura, Maple, Snow)
  const FALL_MAX = 220;
  const leafGeo = new THREE.PlaneGeometry(0.12, 0.16);
  leafGeo.rotateX(-Math.PI / 2);

  const leafMat = underwater(
    new THREE.MeshStandardMaterial({
      roughness: 0.6,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    }),
    { caustic: 0.3, snow: 0 }
  );

  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, FALL_MAX);
  leafMesh.castShadow = true;
  leafMesh.frustumCulled = false;
  scene.add(leafMesh);

  interface LeafParticle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    rx: number;
    ry: number;
    rz: number;
    sx: number;
    sz: number;
    scale: number;
    state: number; // 0: inactive, 1: falling, 2: floating on water
    time: number;
    kind: "sakura" | "maple" | "snow";
    color: THREE.Color;
  }

  const leaves: LeafParticle[] = Array.from({ length: FALL_MAX }, () => ({
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    sx: 0,
    sz: 0,
    scale: 0.1,
    state: 0,
    time: 0,
    kind: "sakura",
    color: new THREE.Color(),
  }));

  const sakuraColors = [
    new THREE.Color(0xffc0cb),
    new THREE.Color(0xffb7c5),
    new THREE.Color(0xffe4e1),
  ];
  const mapleColors = [
    new THREE.Color(0xc0392b),
    new THREE.Color(0xd35400),
    new THREE.Color(0xe67e22),
    new THREE.Color(0xf39c12),
  ];
  const snowColor = new THREE.Color(0xf0f8ff);

  const leafDummy = new THREE.Object3D();

  // 2. Rain Droplets & Streaks
  const RAIN_COUNT = 600;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 6);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 6] = rand(-14, 14);
    rainPos[i * 6 + 1] = rand(0, 16);
    rainPos[i * 6 + 2] = rand(-14, 14);
    rainPos[i * 6 + 3] = rainPos[i * 6] - 0.1;
    rainPos[i * 6 + 4] = rainPos[i * 6 + 1] - 0.7;
    rainPos[i * 6 + 5] = rainPos[i * 6 + 2] - 0.1;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0x9cb8c8,
    transparent: true,
    opacity: 0.45,
  });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.visible = false;
  scene.add(rainLines);

  // 3. Splash particles
  const SPLASH_MAX = 100;
  const splashGeo = new THREE.SphereGeometry(0.04, 6, 4);
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xebf5fb,
    transparent: true,
    opacity: 0.75,
  });
  const splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_MAX);
  splashMesh.frustumCulled = false;
  scene.add(splashMesh);

  interface SplashParticle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
  }
  const splashes: SplashParticle[] = Array.from({ length: SPLASH_MAX }, () => ({
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
  }));
  let splashIdx = 0;

  function triggerSplash(x: number, z: number, amp = 1.0, count = 12) {
    for (let k = 0; k < count; k++) {
      const sp = splashes[splashIdx];
      splashIdx = (splashIdx + 1) % SPLASH_MAX;
      sp.x = x + rand(-0.1, 0.1);
      sp.y = 0.05;
      sp.z = z + rand(-0.1, 0.1);
      const th = rand(0, TAU);
      const v = rand(1.2, 3.2) * amp;
      sp.vx = Math.cos(th) * v * 0.4;
      sp.vy = rand(1.5, 4.0) * amp;
      sp.vz = Math.sin(th) * v * 0.4;
      sp.life = 0;
      sp.maxLife = rand(0.35, 0.65);
    }
  }

  // 4. Realistic 3D Underwater Bubbles (Transparent Rainbow Iridescence)
  const BUBBLE_MAX = 380;
  const bubbleGeo = new THREE.SphereGeometry(1, 16, 12);
  const bubbleMat = createRainbowBubbleMaterial();

  const bubbleMesh = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLE_MAX);
  bubbleMesh.frustumCulled = false;
  scene.add(bubbleMesh);

  interface BubbleParticle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    radius: number;
    baseRadius: number;
    wobbleSpeed: number;
    wobbleAmp: number;
    phase: number;
    state: number; // 0: inactive, 1: rising, 2: popping
    life: number;
    maxLife: number;
    popProgress: number;
  }

  const bubbles: BubbleParticle[] = Array.from({ length: BUBBLE_MAX }, () => ({
    x: 0,
    y: -99,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 0.03,
    baseRadius: 0.03,
    wobbleSpeed: 6.0,
    wobbleAmp: 0.02,
    phase: 0,
    state: 0,
    life: 0,
    maxLife: 10,
    popProgress: 0,
  }));

  const bubbleDummy = new THREE.Object3D();
  let ambientBubbleTimer = 0.5;

  // Helper to spawn a single bubble
  function spawnBubble(
    x: number,
    y: number,
    z: number,
    options?: {
      radius?: number;
      vx?: number;
      vy?: number;
      vz?: number;
      maxLife?: number;
    }
  ) {
    const b = bubbles.find((item) => item.state === 0);
    if (!b) return;

    const baseR = options?.radius ?? rand(0.022, 0.06);
    b.x = x + rand(-0.03, 0.03);
    b.y = y;
    b.z = z + rand(-0.03, 0.03);
    b.baseRadius = baseR;
    b.radius = baseR;
    b.vx = options?.vx ?? rand(-0.04, 0.04);
    b.vy = options?.vy ?? (0.38 + baseR * 5.2 + rand(0, 0.12));
    b.vz = options?.vz ?? rand(-0.04, 0.04);
    b.wobbleSpeed = rand(4.5, 8.5);
    b.wobbleAmp = rand(0.012, 0.028);
    b.phase = rand(0, TAU);
    b.state = 1;
    b.life = 0;
    b.maxLife = options?.maxLife ?? rand(6.0, 12.0);
    b.popProgress = 0;
  }

  // Trigger bursting air bubbles when fish jumps or lands in water
  function triggerFishJumpBubbles(x: number, z: number, count = 22) {
    for (let i = 0; i < count; i++) {
      const r = rand(0.02, 0.08);
      const angle = rand(0, TAU);
      const dist = rand(0.05, 0.42);
      const px = x + Math.cos(angle) * dist;
      const pz = z + Math.sin(angle) * dist;
      const py = rand(-0.45, -0.05);

      // Turbulence plunges some bubbles downwards initially
      spawnBubble(px, py, pz, {
        radius: r,
        vx: Math.cos(angle) * rand(0.1, 0.45),
        vy: rand(-0.6, 0.3),
        vz: Math.sin(angle) * rand(0.1, 0.45),
        maxLife: rand(4.0, 8.0),
      });
    }
  }

  // Trigger bubbles from fish mouth during feeding or gulping
  function triggerFishGulpBubbles(x: number, y: number, z: number, count = 4) {
    for (let i = 0; i < count; i++) {
      spawnBubble(x + rand(-0.05, 0.05), y + rand(-0.02, 0.02), z + rand(-0.05, 0.05), {
        radius: rand(0.025, 0.055),
        vy: rand(0.35, 0.65),
      });
    }
  }

  return {
    triggerSplash,
    spawnBubble,
    triggerFishJumpBubbles,
    triggerFishGulpBubbles,
    update(
      dt: number,
      fallType: "sakura" | "maple" | "snow" | "none",
      fallRate: number,
      wind: number,
      rainAmt: number,
      rippleHeightAt: (x: number, z: number) => number,
      addRipple?: (x: number, z: number, amp: number) => void,
      fishes?: KoiFish[],
      elapsedTime?: number
    ) {
      const time = elapsedTime ?? 0;

      // 1. Falling leaves/petals update
      if (fallType !== "none" && fallRate > 0) {
        const spawnCount = Math.floor(fallRate * dt * 15) + (rnd() < 0.2 ? 1 : 0);
        for (let s = 0; s < spawnCount; s++) {
          const inactive = leaves.find((l) => l.state === 0);
          if (inactive) {
            inactive.state = 1;
            inactive.kind = fallType;
            inactive.x = rand(-14, 14);
            inactive.y = rand(8, 14);
            inactive.z = rand(-14, 14);
            inactive.vx = (wind * 0.8 + rand(-0.2, 0.2)) * (fallType === "snow" ? 0.4 : 1.0);
            inactive.vy = fallType === "snow" ? rand(-0.8, -1.6) : rand(-0.9, -1.8);
            inactive.vz = rand(-0.3, 0.3);
            inactive.rx = rand(0, TAU);
            inactive.ry = rand(0, TAU);
            inactive.rz = rand(0, TAU);
            inactive.sx = rand(-1.5, 1.5);
            inactive.sz = rand(-1.5, 1.5);
            inactive.scale = fallType === "snow" ? rand(0.04, 0.08) : rand(0.8, 1.2);
            inactive.time = rand(10, 20);

            if (fallType === "sakura") {
              inactive.color.copy(sakuraColors[Math.floor(rnd() * sakuraColors.length)]);
            } else if (fallType === "maple") {
              inactive.color.copy(mapleColors[Math.floor(rnd() * mapleColors.length)]);
            } else {
              inactive.color.copy(snowColor);
            }
          }
        }
      }

      leaves.forEach((l, i) => {
        if (l.state === 1) {
          l.x += l.vx * dt;
          l.y += l.vy * dt;
          l.z += l.vz * dt;
          l.rx += l.sx * dt;
          l.rz += l.sz * dt;

          const waterY = 0.02;
          const groundY = terrainH(l.x, l.z);

          if (l.y <= waterY && pondD(l.x, l.z) < 0.95) {
            if (l.kind === "snow") {
              l.state = 0;
            } else {
              l.state = 2;
              l.y = waterY;
              l.rx = 0;
              l.rz = 0;
            }
          } else if (l.y <= groundY) {
            l.state = 0;
          }
        } else if (l.state === 2) {
          l.x += (l.vx * 0.2 + wind * 0.05) * dt;
          l.z += l.vz * 0.2 * dt;
          const surf = getWaterSurface(l.x, l.z, time, wind);
          l.y = 0.02 + surf.y;
          l.rx = surf.tiltX * 0.85;
          l.rz = surf.tiltZ * 0.85;
          l.ry += 0.2 * dt;
          l.time -= dt;
          if (l.time <= 0 || pondD(l.x, l.z) > 0.98) {
            l.state = 0;
          }
        }

        if (l.state > 0) {
          leafDummy.position.set(l.x, l.y, l.z);
          leafDummy.rotation.set(l.rx, l.ry, l.rz);
          leafDummy.scale.setScalar(l.scale);
        } else {
          leafDummy.position.set(0, -99, 0);
          leafDummy.scale.setScalar(0.001);
        }
        leafDummy.updateMatrix();
        leafMesh.setMatrixAt(i, leafDummy.matrix);
        leafMesh.setColorAt(i, l.color);
      });
      leafMesh.instanceMatrix.needsUpdate = true;
      if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;

      // 2. Rain Lines
      rainLines.visible = rainAmt > 0.01;
      if (rainLines.visible) {
        rainMat.opacity = Math.min(0.65, rainAmt * 0.7);
        const pArr = rainGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < RAIN_COUNT; i++) {
          const idx = i * 6;
          pArr[idx + 1] -= dt * 22;
          pArr[idx + 4] = pArr[idx + 1] - 0.7;
          if (pArr[idx + 1] < 0) {
            pArr[idx] = rand(-14, 14);
            pArr[idx + 1] = rand(12, 16);
            pArr[idx + 2] = rand(-14, 14);
            pArr[idx + 3] = pArr[idx] - wind * 0.2;
            pArr[idx + 4] = pArr[idx + 1] - 0.7;
            pArr[idx + 5] = pArr[idx + 2] - 0.1;
          }
        }
        rainGeo.attributes.position.needsUpdate = true;
      }

      // 3. Splash particles update
      splashes.forEach((sp, i) => {
        if (sp.life < sp.maxLife) {
          sp.life += dt;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          sp.z += sp.vz * dt;
          sp.vy -= 9.8 * dt;

          const sc = Math.max(0, 1 - sp.life / sp.maxLife) * 1.2;
          leafDummy.position.set(sp.x, Math.max(0.01, sp.y), sp.z);
          leafDummy.scale.setScalar(sc);
        } else {
          leafDummy.position.set(0, -99, 0);
          leafDummy.scale.setScalar(0.001);
        }
        leafDummy.updateMatrix();
        splashMesh.setMatrixAt(i, leafDummy.matrix);
      });
      splashMesh.instanceMatrix.needsUpdate = true;

      // 4. Underwater 3D Bubbles Logic
      // 4A. Ambient Pond Floor Degassing (Natural aeration from rocks & sediment)
      ambientBubbleTimer -= dt;
      if (ambientBubbleTimer <= 0) {
        ambientBubbleTimer = rand(0.35, 0.85);
        const bx = rand(-6.2, 6.2);
        const bz = rand(-6.2, 6.2);
        if (pondD(bx, bz) < 0.82) {
          const by = Math.max(terrainH(bx, bz) + 0.04, -1.65);
          // Spawn small cluster of 1 to 3 bubbles
          const clusterSize = rnd() < 0.3 ? 3 : rnd() < 0.6 ? 2 : 1;
          for (let k = 0; k < clusterSize; k++) {
            spawnBubble(bx + rand(-0.06, 0.06), by - k * 0.08, bz + rand(-0.06, 0.06), {
              radius: rand(0.022, 0.05),
              vy: rand(0.38, 0.58),
            });
          }
        }
      }

      // 4B. Koi Fish Interaction: mouth gulping & high-speed wake bubbles
      if (fishes && fishes.length > 0) {
        fishes.forEach((fish) => {
          // Feeding / gulping air at the mouth
          if (fish.gulpAnimation > 0.04 && rnd() < 0.35) {
            const mouthX = fish.spine[0].x;
            const mouthY = fish.spineY[0] + 0.02;
            const mouthZ = fish.spine[0].z;
            spawnBubble(mouthX, mouthY, mouthZ, {
              radius: rand(0.028, 0.058),
              vy: rand(0.42, 0.72),
            });
          }

          // Rapid swimming or sharp turning: tail & pectoral wake turbulence
          if ((fish.speed > 0.85 || fish.state === 2) && rnd() < 0.16) {
            const tailNode = Math.min(12, fish.spine.length - 1);
            const tailX = fish.spine[tailNode].x;
            const tailY = fish.spineY[tailNode];
            const tailZ = fish.spine[tailNode].z;
            spawnBubble(tailX + rand(-0.08, 0.08), tailY, tailZ + rand(-0.08, 0.08), {
              radius: rand(0.018, 0.036),
              vx: -fish.velocity.x * 0.18,
              vy: rand(0.2, 0.45),
              vz: -fish.velocity.z * 0.18,
            });
          }

          // Surface swimming micro-bubbles
          if (fish.depth > -0.32 && rnd() < 0.04) {
            spawnBubble(fish.position.x + rand(-0.15, 0.15), fish.depth - 0.05, fish.position.z + rand(-0.15, 0.15), {
              radius: rand(0.016, 0.032),
            });
          }
        });
      }

      // 4C. Update all bubbles (buoyancy, helical vortex wiggle, surface pop)
      bubbles.forEach((b, i) => {
        if (b.state === 1) {
          b.life += dt;
          // Buoyancy acceleration
          b.vy += 0.85 * dt;
          b.vy = Math.min(b.vy, 0.5 + b.radius * 7.5);

          b.y += b.vy * dt;

          // Sinusoidal helical vortex wobble
          const wobbleX = Math.sin(time * b.wobbleSpeed + b.phase) * b.wobbleAmp;
          const wobbleZ = Math.cos(time * (b.wobbleSpeed * 0.92) + b.phase) * b.wobbleAmp;
          b.x += (b.vx + wobbleX * 3.5) * dt;
          b.z += (b.vz + wobbleZ * 3.5) * dt;
          b.vx *= 0.96;
          b.vz *= 0.96;

          // Natural expansion as depth decreases (Boyle's law preview)
          const depthRatio = Math.max(0, -b.y / 1.6);
          b.radius = b.baseRadius * (1.0 + (1.0 - depthRatio) * 0.24);

          // Subtle hydrodynamic squashing
          const squash = Math.sin(time * 14.0 + b.phase) * 0.14;
          const scX = b.radius * (1.0 - squash * 0.5);
          const scY = b.radius * (1.0 + squash);
          const scZ = b.radius * (1.0 - squash * 0.5);

          // Surface contact & popping
          const waterSurfaceY = 0.01 + rippleHeightAt(b.x, b.z);
          if (b.y >= waterSurfaceY) {
            b.state = 2; // Popping phase
            b.popProgress = 0;
            b.y = waterSurfaceY;

            // Generate realistic water ripple at pop location
            if (addRipple) {
              addRipple(b.x, b.z, Math.min(0.24, b.radius * 2.2));
            }

            // Play delicate bubble pop sound
            sound.bubblePop(Math.min(0.16, b.radius * 2.5));

            // Droplet splash for larger bubbles
            if (b.radius > 0.042) {
              triggerSplash(b.x, b.z, b.radius * 2.0, 2);
            }
          } else if (pondD(b.x, b.z) > 0.96 || b.life > b.maxLife) {
            b.state = 0; // Exceeded bounds
          }

          bubbleDummy.position.set(b.x, b.y, b.z);
          bubbleDummy.scale.set(scX, scY, scZ);
          bubbleDummy.rotation.set(0, b.phase, 0);
        } else if (b.state === 2) {
          // Popping burst animation
          b.popProgress += dt * 16.0;
          const popExpand = 1.0 + b.popProgress * 1.6;
          const fadeSc = Math.max(0, 1.0 - b.popProgress);
          bubbleDummy.position.set(b.x, b.y, b.z);
          bubbleDummy.scale.set(
            b.radius * popExpand * fadeSc,
            b.radius * 0.3 * fadeSc,
            b.radius * popExpand * fadeSc
          );

          if (b.popProgress >= 1.0) {
            b.state = 0;
          }
        } else {
          bubbleDummy.position.set(0, -99, 0);
          bubbleDummy.scale.setScalar(0.001);
        }

        bubbleDummy.updateMatrix();
        bubbleMesh.setMatrixAt(i, bubbleDummy.matrix);
      });
      bubbleMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
