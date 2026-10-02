import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SceneName, KoiVariety, FoodPellet, KoiFishData, PondSettings, KoiBodyParams } from "../types/koi";
import { SCENE_PRESETS } from "../engine/presets";
import { sharedUniforms } from "../shaders/underwater";
import { createWaterMaterial, RIPN } from "../shaders/water";
import { buildEnvironment, EnvironmentObjects } from "../engine/pond-environment";
import { KoiFish, SwimState } from "../engine/koi-mesh";
import { createFoodMesh, createParticleSystem } from "../engine/particles";
import { sound } from "../engine/audio";
import { pondD, rand, rnd, TAU, lerp, clamp } from "../math/noise";
import { getWaterSurface } from "../math/water-physics";
import { PondFFTOcean } from "../engine/fft-ocean";

interface PondCanvasProps {
  currentScene: SceneName;
  settings: PondSettings;
  onSelectFish: (fish: KoiFishData | null) => void;
  onFeedDrop?: () => void;
  refControls: React.MutableRefObject<{
    dropFood: (x?: number, z?: number) => void;
    scatterFish: () => void;
    triggerJump: () => void;
    setCameraView: (mode: "orbit" | "topdown" | "shoreline") => void;
    updateFishBody: (id: number | "all", params: Partial<KoiBodyParams>) => void;
  } | null>;
}

export const PondCanvas: React.FC<PondCanvasProps> = ({
  currentScene,
  settings,
  onSelectFish,
  onFeedDrop,
  refControls,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);

  // References to engine objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fishesRef = useRef<KoiFish[]>([]);
  const pelletsRef = useRef<FoodPellet[]>([]);
  const envRef = useRef<EnvironmentObjects | null>(null);
  const waterRef = useRef<{ mat: THREE.ShaderMaterial; ripples: THREE.Vector4[] } | null>(null);
  const particlesRef = useRef<any>(null);
  const fleeFromRef = useRef<{ x: number; z: number } | null>(null);

  // Lighting & state transition
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const flashLightRef = useRef<THREE.DirectionalLight | null>(null);
  const currentPresetState = useRef<any>(null);
  const targetPresetState = useRef<any>(null);
  const nextStrikeTime = useRef<number>(5);
  const nextJumpTime = useRef<number>(6);
  const timeRef = useRef<number>(0);
  const ripIndexRef = useRef<number>(0);
  // Calm-by-default water: smoothed fish energy 0..1 driving uActivity.
  // Activity 0 + storm wind still shows rain + advected ripples, no swell.
  const activityRef = useRef<number>(0);
  const feedExcitementRef = useRef<number>(0);
  const wakeAccumRef = useRef<Map<number, number>>(new Map());

  // Dynamic helper: add ripple
  const addRipple = (x: number, z: number, amp: number) => {
    if (!waterRef.current) return;
    const r = waterRef.current.ripples[ripIndexRef.current];
    r.set(x, z, timeRef.current, amp);
    ripIndexRef.current = (ripIndexRef.current + 1) % RIPN;
  };

  // Dynamic helper: ripple and wave surface height calculation
  const getRippleHeight = (x: number, z: number): number => {
    return getWaterSurface(x, z, timeRef.current, 0, waterRef.current?.ripples, 0).y;
  };

  // Helper: drop food
  const dropFoodAt = (x?: number, z?: number) => {
    const scene = sceneRef.current;
    if (!scene) return;

    let fx = x !== undefined ? x : rand(-3, 3);
    let fz = z !== undefined ? z : rand(-3, 3);

    // Ensure it's inside pond
    if (pondD(fx, fz) > 0.88) {
      const d = pondD(fx, fz);
      fx *= 0.8 / d;
      fz *= 0.8 / d;
    }

    const pellet = createFoodMesh(fx, fz);
    pellet.born = timeRef.current;
    pelletsRef.current.push(pellet);
    scene.add(pellet.mesh);

    // Nagomi Call Response: individual delay based on distance and reactivity
    fishesRef.current.forEach((fish) => {
      const distanceToCall = Math.hypot(fish.position.x - fx, fish.position.z - fz);
      const distanceAmount = Math.pow(clamp(distanceToCall / 12.0, 0, 1), 1.5);
      fish.callDelay =
        0.04 +
        distanceAmount * 1.05 +
        rand(0, 0.18) +
        (1 - fish.reactivity) * 0.22;
      fish.respondedToCall = false;
      fish.callResponseAge = 0;
    });

    addRipple(fx, fz, 0.6);
    feedExcitementRef.current = 1.0;
    particlesRef.current?.spawnBubble(fx, -0.04, fz, { radius: 0.038, vy: -0.22 });
    particlesRef.current?.spawnBubble(fx + rand(-0.04, 0.04), -0.08, fz + rand(-0.04, 0.04), { radius: 0.024, vy: -0.12 });
    sound.splash(0.7);
    if (onFeedDrop) onFeedDrop();
  };

  // Helper: scatter fish (Nagomi scatter logic)
  const scatterFish = () => {
    fishesRef.current.forEach((fish) => {
      fish.heading += rand(-1.35, 1.35);
      fish.speed = fish.maximumSpeed;
      fish.angularVelocity += rand(-2, 2);
      fish.flee = rand(3.5, 6.0);
      fish.targetDepth = -1.6;
      fish.enterState(SwimState.Burst);
    });
    addRipple(0, 0, 1.2);
    particlesRef.current?.triggerFishJumpBubbles(0, 0, 18);
    sound.splash(1.3);
  };

  // Helper: trigger fish jump
  const triggerJump = () => {
    const available = fishesRef.current.filter((f) => !f.jump);
    if (available.length > 0) {
      const lucky = available[Math.floor(rnd() * available.length)];
      lucky.startJump();
    }
  };

  // Camera preset modes
  const setCameraView = (mode: "orbit" | "topdown" | "shoreline") => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (mode === "topdown") {
      camera.position.set(0, 22, 0.01);
      controls.target.set(0, -0.5, 0);
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI / 4;
    } else if (mode === "shoreline") {
      camera.position.set(0, 3.2, 10.5);
      controls.target.set(0, -0.4, 0);
      controls.minPolarAngle = 0.05;
      controls.maxPolarAngle = 1.35;
    } else {
      // 3D Orbit
      camera.position.set(0, 15, 16);
      controls.target.set(0, -0.6, 0);
      controls.minPolarAngle = 0.05;
      controls.maxPolarAngle = 1.25;
    }
    controls.update();
  };

  // Assign refControls
  if (refControls) {
    refControls.current = {
      dropFood: dropFoodAt,
      scatterFish,
      triggerJump,
      setCameraView,
      updateFishBody: (id: number | "all", params: Partial<KoiBodyParams>) => {
        if (id === "all") {
          fishesRef.current.forEach((f) => f.setBodyParams(params));
        } else {
          const fish = fishesRef.current.find((f) => f.id === id);
          if (fish) fish.setBodyParams(params);
        }
      },
    };
  }

  // Handle global body params updates
  useEffect(() => {
    if (settings.globalKoiParams) {
      fishesRef.current.forEach((f) => f.setBodyParams(settings.globalKoiParams!));
    }
  }, [settings.globalKoiParams]);

  // Handle Scene Preset change
  useEffect(() => {
    const targetPreset = SCENE_PRESETS[currentScene] || SCENE_PRESETS.sunny;
    targetPresetState.current = targetPreset;
    sound.updateScene(currentScene);

    if (currentScene === "storm") {
      nextStrikeTime.current = timeRef.current + rand(1.5, 3.5);
    }
  }, [currentScene]);

  // Handle settings update (fish count, varieties)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentFishes = fishesRef.current;
    const targetCount = settings.fishCount;
    const varieties = settings.selectedVarieties.length > 0
      ? settings.selectedVarieties
      : (["kohaku", "sanke", "showa", "ogon", "utsuri", "asagi", "tancho"] as KoiVariety[]);

    if (currentFishes.length < targetCount) {
      for (let i = currentFishes.length; i < targetCount; i++) {
        const v = varieties[i % varieties.length];
        const fish = new KoiFish(v, scene, i + 1);
        if (settings.globalKoiParams) {
          fish.setBodyParams(settings.globalKoiParams);
        }
        currentFishes.push(fish);
      }
    } else if (currentFishes.length > targetCount) {
      while (currentFishes.length > targetCount) {
        const fish = currentFishes.pop();
        if (fish) fish.destroy(scene);
      }
    }
  }, [settings.fishCount, settings.selectedVarieties]);

  // Main Three.js Lifecycle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId: number;

    // 1. Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    rendererRef.current = renderer;

    // 2. Scene & Fog
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x8fa395, 32, 75);
    sceneRef.current = scene;

    // 3. Camera & Controls
    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 140);
    camera.position.set(0, 15, 16);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, -0.6, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 32;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = 1.25;
    controlsRef.current = controls;

    // 4. Lights
    const hemiLight = new THREE.HemisphereLight(0xcfe0f0, 0x4a5a3a, 1.1);
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const sunLight = new THREE.DirectionalLight(0xfff3df, 3.0);
    sunLight.position.set(8, 22, 12);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const sc = sunLight.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 18;
    sc.bottom = -18;
    sc.near = 1;
    sc.far = 80;
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 0.03;
    scene.add(sunLight);
    scene.add(sunLight.target);
    sunLightRef.current = sunLight;

    const flashLight = new THREE.DirectionalLight(0xdfe6ff, 0);
    flashLight.position.set(-8, 20, -5);
    scene.add(flashLight);
    flashLightRef.current = flashLight;

    // 5. Environment
    const env = buildEnvironment(scene);
    envRef.current = env;

    // 6. Water Surface & RenderTarget for Refraction
    let renderTarget: THREE.WebGLRenderTarget | null = null;
    const size = new THREE.Vector2();

    const makeRenderTarget = () => {
      renderer.getDrawingBufferSize(size);
      if (renderTarget) renderTarget.dispose();
      renderTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
      });
      renderTarget.depthTexture = new THREE.DepthTexture(size.x, size.y);
    };
    makeRenderTarget();

    const water = createWaterMaterial(camera);
    waterRef.current = water;

    // FFT pond lifecycle (default-off safe): enable only when float-linear
    // filtering is available so cascade textures sample correctly.
    // Base wind dir matches existing swell: normalize(0.82, 0.57); the per-frame
    // loop wanders it ±0.35 rad so crests never sit in fixed directions.
    const FFT_BASE_ANGLE = Math.atan2(0.57, 0.82);
    const FFT_SEED = (Date.now() % 100000) | 0;
    const fftWindDir = new THREE.Vector2(0.82, 0.57).normalize();
    const floatLinearOK =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("OES_texture_float_linear");
    let fft: PondFFTOcean | null = null;
    let waterGeo: THREE.PlaneGeometry;
    if (floatLinearOK) {
      const caps = renderer.capabilities as THREE.WebGLCapabilities & {
        maxVertexTextureImageUnits?: number;
      };
      const segs = (caps.maxVertexTextureImageUnits ?? 0) === 0 ? 128 : 256;
      waterGeo = new THREE.PlaneGeometry(85, 85, segs, segs);
      water.mat.defines = { ...(water.mat.defines ?? {}), USE_FFT: 1 };
      try {
        fft = new PondFFTOcean({
          sizes: [24, 6, 1.5],
          grids: [64, 64, 32],
          seed: FFT_SEED,
        });
        fft.init(renderer);
      } catch {
        // FFT init failed -> fall back to legacy path, FFT stays off.
        fft = null;
        if (water.mat.defines) delete water.mat.defines.USE_FFT;
        waterGeo.dispose();
        waterGeo = new THREE.PlaneGeometry(85, 85, 1, 1);
      }
    } else {
      waterGeo = new THREE.PlaneGeometry(85, 85, 1, 1);
    }
    // Legacy-safe FFT uniform slots (ignored by water.ts until its USE_FFT
    // branch lands; uHasFFT guards the first frame before textures arrive).
    for (const [name, value] of [
      ["uFFTHeight0", null],
      ["uFFTHeight1", null],
      ["uFFTHeight2", null],
      ["uHasFFT", 0.0],
    ] as const) {
      if (!water.mat.uniforms[name]) water.mat.uniforms[name] = { value };
    }
    waterGeo.rotateX(-Math.PI / 2);
    const waterMesh = new THREE.Mesh(waterGeo, water.mat);
    waterMesh.position.y = 0;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);

    // 7. Particle Systems
    const particles = createParticleSystem(scene);
    particlesRef.current = particles;

    // 8. Koi Fish Population
    const initialVarieties: KoiVariety[] = [
      "kohaku",
      "sanke",
      "showa",
      "ogon",
      "utsuri",
      "asagi",
      "tancho",
      "kohaku",
      "sanke",
      "ogon",
      "utsuri",
      "tancho",
    ];
    const fishes: KoiFish[] = [];
    for (let i = 0; i < settings.fishCount; i++) {
      const v = initialVarieties[i % initialVarieties.length];
      const fish = new KoiFish(v, scene, i + 1);
      if (settings.globalKoiParams) {
        fish.setBodyParams(settings.globalKoiParams);
      }
      fishes.push(fish);
    }
    fishesRef.current = fishes;

    // Presets initialization
    const initialPreset = SCENE_PRESETS[currentScene] || SCENE_PRESETS.sunny;
    targetPresetState.current = initialPreset;
    currentPresetState.current = {
      ambient: initialPreset.ambient,
      sunIntensity: initialPreset.sunIntensity,
      sunColor: new THREE.Color(...initialPreset.sunColor),
      sunPos: new THREE.Vector3(...initialPreset.sunPos),
      hemiSky: new THREE.Color(...initialPreset.hemiSky),
      hemiGround: new THREE.Color(...initialPreset.hemiGround),
      skyTop: new THREE.Color(...initialPreset.skyTop),
      skyHor: new THREE.Color(...initialPreset.skyHor),
      fogColor: new THREE.Color(...initialPreset.fogColor),
      waterColor: new THREE.Color(...initialPreset.waterColor),
      treeCanopy: new THREE.Color(...initialPreset.treeCanopy),
      causticAmt: initialPreset.causticAmt,
      specular: initialPreset.specular,
      wind: initialPreset.wind,
      rain: initialPreset.rain,
      storm: initialPreset.storm,
      snowCover: initialPreset.snowCover,
      dry: initialPreset.dry,
      fallRate: initialPreset.fallRate,
      fallType: initialPreset.fallType,
      birds: initialPreset.birds,
      jump: initialPreset.jump,
      lanternGlow: initialPreset.lanternGlow,
    };

    // 9. Raycasting for Interaction (Click to feed / Select fish)
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pondPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    let pointerDownPos = { x: 0, y: 0, time: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      const duration = performance.now() - pointerDownPos.time;
      if (dist > 6 || duration > 450) return;

      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);

      // Check if user clicked a Koi Fish first
      const fishMeshes = fishesRef.current.map((f) => f.body);
      const fishIntersects = raycaster.intersectObjects(fishMeshes);

      if (fishIntersects.length > 0) {
        const clickedMesh = fishIntersects[0].object;
        const foundFish = fishesRef.current.find((f) => f.body === clickedMesh);
        if (foundFish) {
          onSelectFish(foundFish.getFishData());
          addRipple(foundFish.x, foundFish.z, 0.4);
          sound.chime(440);
          return;
        }
      }

      // If clicked on pond water surface, drop food pellet!
      if (raycaster.ray.intersectPlane(pondPlane, hitPoint)) {
        if (pondD(hitPoint.x, hitPoint.z) < 0.95) {
          dropFoodAt(hitPoint.x, hitPoint.z);
          onSelectFish(null);
        }
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);

    // 10. Resize handler
    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width / height < 0.9 ? 55 : 40;
      camera.updateProjectionMatrix();

      makeRenderTarget();
      water.mat.uniforms.uRes.value.set(size.x, size.y);
      water.mat.uniforms.uNear.value = camera.near;
      water.mat.uniforms.uFar.value = camera.far;
      // FFT targets are fixed-size (64/64/32), resolution-independent: no-op.
    };
    window.addEventListener("resize", onResize);
    onResize();

    // 11. Initial demo food drop
    setTimeout(() => {
      dropFoodAt(0.5, 0.5);
      dropFoodAt(-0.8, -0.6);
      setLoading(false);
    }, 800);

    // 12. Simulation Loop
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      timeRef.current += dt;
      sharedUniforms.uTime.value = timeRef.current;

      // Still-water mode: no fish-energy activity swell; surface is ripple-only.
      feedExcitementRef.current = Math.max(0, feedExcitementRef.current - dt * 0.25);
      activityRef.current = 0;
      const activity = 0;

      const target = targetPresetState.current;
      const cur = currentPresetState.current;

      // Smooth atmospheric preset interpolation
      if (target && cur) {
        const k = 1 - Math.exp(-dt * 1.5);
        cur.sunIntensity = lerp(cur.sunIntensity, target.sunIntensity, k);
        cur.causticAmt = lerp(cur.causticAmt, target.causticAmt, k);
        cur.specular = lerp(cur.specular, target.specular, k);
        cur.wind = lerp(cur.wind, target.wind, k);
        cur.rain = lerp(cur.rain, target.rain, k);
        cur.storm = lerp(cur.storm, target.storm, k);
        cur.snowCover = lerp(cur.snowCover, target.snowCover, k);
        cur.dry = lerp(cur.dry, target.dry, k);
        cur.birds = lerp(cur.birds, target.birds, k);
        cur.jump = lerp(cur.jump, target.jump, k);
        cur.lanternGlow = lerp(cur.lanternGlow, target.lanternGlow, k);

        cur.sunColor.lerp(new THREE.Color(...target.sunColor), k);
        cur.sunPos.lerp(new THREE.Vector3(...target.sunPos), k);
        cur.hemiSky.lerp(new THREE.Color(...target.hemiSky), k);
        cur.hemiGround.lerp(new THREE.Color(...target.hemiGround), k);
        cur.skyTop.lerp(new THREE.Color(...target.skyTop), k);
        cur.skyHor.lerp(new THREE.Color(...target.skyHor), k);
        cur.fogColor.lerp(new THREE.Color(...target.fogColor), k);
        cur.waterColor.lerp(new THREE.Color(...target.waterColor), k);
        cur.treeCanopy.lerp(new THREE.Color(...target.treeCanopy), k);

        // Apply lights
        if (sunLightRef.current) {
          sunLightRef.current.intensity = cur.sunIntensity;
          sunLightRef.current.color.copy(cur.sunColor);
          sunLightRef.current.position.copy(cur.sunPos);
        }
        if (hemiLightRef.current) {
          hemiLightRef.current.color.copy(cur.hemiSky);
          hemiLightRef.current.groundColor.copy(cur.hemiGround);
        }
        if (scene.fog) {
          scene.fog.color.copy(cur.fogColor);
          scene.background = cur.fogColor;
        }

        // Apply shared uniforms
        sharedUniforms.uSunCol.value.copy(cur.sunColor);
        sharedUniforms.uWaterCol.value.copy(cur.waterColor);
        sharedUniforms.uCausticAmt.value = cur.causticAmt;
        sharedUniforms.uSnowCover.value = cur.snowCover;
        sharedUniforms.uDry.value = cur.dry;

        // Apply water uniforms
        water.mat.uniforms.uSkyTop.value.copy(cur.skyTop);
        water.mat.uniforms.uSkyHor.value.copy(cur.skyHor);
        water.mat.uniforms.uSunDir.value.copy(cur.sunPos).normalize();
        water.mat.uniforms.uSunCol.value.copy(cur.sunColor);
        water.mat.uniforms.uSpec.value = cur.specular;
        water.mat.uniforms.uRain.value = cur.rain;
        water.mat.uniforms.uWind.value = 0;
        water.mat.uniforms.uActivity.value = 0;
        water.mat.uniforms.uHeightScale.value = 0;
        water.mat.uniforms.uHasFFT.value = 0;

        // Apply lantern glow
        env.lanterns.forEach((l) => {
          l.glow.emissiveIntensity = cur.lanternGlow;
          l.light.intensity = cur.lanternGlow * 2.8;
        });

        // Lightning in storm scene
        if (cur.storm > 0.4 && timeRef.current > nextStrikeTime.current) {
          nextStrikeTime.current = timeRef.current + rand(4.0, 9.0);
          if (flashLightRef.current) {
            flashLightRef.current.intensity = rand(8, 14);
            setTimeout(() => {
              if (flashLightRef.current) flashLightRef.current.intensity = 0;
            }, 120);
            setTimeout(() => {
              if (flashLightRef.current) flashLightRef.current.intensity = rand(5, 10);
            }, 180);
            setTimeout(() => {
              if (flashLightRef.current) flashLightRef.current.intensity = 0;
            }, 260);
          }
          sound.thunder(rand(0.6, 0.95));
        }

        // Autonomous fish jump
        if (cur.jump > 0.05 && timeRef.current >= nextJumpTime.current) {
          nextJumpTime.current = timeRef.current + rand(7, 16) / Math.max(cur.jump, 0.2);
          triggerJump();
        }
      }

      // Update food pellets
      pelletsRef.current.forEach((p) => {
        if ((p.padCd ?? 0) > 0) p.padCd = Math.max(0, (p.padCd ?? 0) - dt);
        const riding = p.onPad !== undefined ? env.pads[p.onPad] : undefined;
        if (riding) {
          const load = riding.loads.find((l) => l.pellet === p);
          if (!load) {
            p.onPad = undefined;
            p.padCd = 1;
          } else {
            const yaw = riding.group.rotation.y;
            const ca = Math.cos(yaw);
            const sa = Math.sin(yaw);
            const ox = load.x * ca + load.z * sa;
            const oz = -load.x * sa + load.z * ca;
            p.x = riding.x + ox;
            p.z = riding.z + oz;
            const tiltMag = Math.hypot(riding.group.rotation.x, riding.group.rotation.z);
            if (tiltMag > 0.26) {
              const d = Math.hypot(ox, oz) || 1;
              const dx = ox / d;
              const dz = oz / d;
              riding.loads.splice(riding.loads.indexOf(load), 1);
              p.x = riding.x + dx * (riding.radius + 0.12);
              p.z = riding.z + dz * (riding.radius + 0.12);
              p.vx = dx * 0.6;
              p.vz = dz * 0.6;
              p.onPad = undefined;
              p.padCd = 2.0;
              p.padNear = true;
              addRipple(p.x, p.z, 0.12);
            } else {
              p.mesh.position.set(
                p.x,
                riding.group.position.y + 0.1 * riding.radius + 0.02,
                p.z
              );
              p.mesh.rotation.x = riding.group.rotation.x;
              p.mesh.rotation.z = riding.group.rotation.z;
              return;
            }
          }
        }
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        if (pondD(p.x, p.z) > 0.9) {
          p.vx *= -1;
          p.vz *= -1;
        }
        if (timeRef.current - p.born > 35) {
          p.eaten = true;
        }
        const surf = getWaterSurface(
          p.x,
          p.z,
          timeRef.current,
          0,
          waterRef.current?.ripples,
          0
        );
        if ((p.padCd ?? 0) <= 0 && p.onPad === undefined) {
          let found = -1;
          for (let i = 0; i < env.pads.length; i++) {
            const pad = env.pads[i];
            if (Math.hypot(p.x - pad.x, p.z - pad.z) < pad.radius) {
              found = i;
              break;
            }
          }
          if (found >= 0) {
            const calmPad = env.pads[found];
            const calmTilt = Math.hypot(
              calmPad.group.rotation.x,
              calmPad.group.rotation.z
            );
            if (calmTilt >= 0.15) {
              p.padNear = true;
            } else if (!p.padNear) {
              p.padNear = true;
              const pad = env.pads[found];
              const rimTop = pad.group.position.y + 0.1 * pad.radius;
              if (rimTop > surf.y && rnd() < 0.3) {
                const yaw = pad.group.rotation.y;
                const ca = Math.cos(yaw);
                const sa = Math.sin(yaw);
                const wx = p.x - pad.x;
                const wz = p.z - pad.z;
                p.onPad = found;
                p.vx = 0;
                p.vz = 0;
                pad.loads.push({
                  x: wx * ca - wz * sa,
                  z: wx * sa + wz * ca,
                  w: 0.1,
                  age: 0,
                  pellet: p,
                });
              }
            }
          } else {
            p.padNear = false;
          }
        }
        p.mesh.position.set(
          p.x,
          0.02 + surf.y + Math.sin(timeRef.current * 2 + p.born) * 0.005,
          p.z
        );
        p.mesh.rotation.x = surf.tiltX;
        p.mesh.rotation.z = surf.tiltZ;
      });

      // Remove eaten pellets
      pelletsRef.current = pelletsRef.current.filter((p) => {
        if (p.eaten) {
          if (p.onPad !== undefined) {
            const pad = env.pads[p.onPad];
            if (pad) {
              const li = pad.loads.findIndex((l) => l.pellet === p);
              if (li >= 0) pad.loads.splice(li, 1);
            }
          }
          scene.remove(p.mesh);
        }
        return !p.eaten;
      });

      // Update Koi fishes
      const onSplash = (sx: number, sz: number, samp: number) => {
        addRipple(sx, sz, samp);
        particles.triggerSplash(sx, sz, samp);
        particles.triggerFishJumpBubbles(sx, sz, Math.floor(22 * samp));
        sound.splash(samp);
      };

      fishesRef.current.forEach((f) => {
        f.update(
          dt,
          timeRef.current,
          fishesRef.current,
          pelletsRef.current,
          addRipple,
          onSplash,
          (bx, by, bz, br) => {
            particlesRef.current?.spawnBubble(bx, by, bz, { radius: br, vy: 0.38 });
          }
        );
        // Continuous speed-proportional tail wake (not just splash events).
        const maxS = f.maximumSpeed > 0 ? f.maximumSpeed : 1;
        const speedRatio = clamp(f.speed / maxS, 0, 1);
        let sheltered = false;
        for (const pad of env.pads) {
          const pr = pad.radius * 1.2;
          if (Math.abs(f.position.x - pad.x) > pr || Math.abs(f.position.z - pad.z) > pr) continue;
          let w = pad.flowerBonus;
          for (const l of pad.loads) w += l.w;
          if (w > 0.3 && Math.hypot(f.position.x - pad.x, f.position.z - pad.z) < pr) {
            sheltered = true;
            break;
          }
        }
        if (sheltered) f.speed *= Math.exp(-dt * 0.8);
        if (f.speed > 0.05 && f.depth > -0.9) {
          const acc = (wakeAccumRef.current.get(f.id) ?? 0) + dt;
          const interval = 0.6 - 0.25 * speedRatio;
          if (acc >= interval) {
            wakeAccumRef.current.set(f.id, 0);
            const tx = f.position.x - Math.cos(f.heading) * f.bodyLength * 0.5;
            const tz = f.position.z - Math.sin(f.heading) * f.bodyLength * 0.5;
            addRipple(
              tx,
              tz,
              0.06 + 0.22 * speedRatio + (f.state === SwimState.Burst ? 0.15 : 0)
            );
          } else {
            wakeAccumRef.current.set(f.id, acc);
          }
        }
        f.draw();
      });
      if (wakeAccumRef.current.size > fishesRef.current.length + 4) {
        const live = new Set(fishesRef.current.map((f) => f.id));
        for (const id of wakeAccumRef.current.keys()) {
          if (!live.has(id)) wakeAccumRef.current.delete(id);
        }
      }

      // Update environment elements
      const windVal = cur ? cur.wind : 0.15;
      env.reeds.update(timeRef.current, windVal);
      env.bamboo.update(timeRef.current, windVal);
      env.lotus.update(timeRef.current, 0, waterRef.current?.ripples, 0, dt);
      env.duckweed.update(timeRef.current, 0, waterRef.current?.ripples, 0, dt);
      env.tinyFish.update(dt, timeRef.current, fishesRef.current);

      if (cur) {
        env.trees.update({
          trees: 1.0,
          canopy: cur.snowCover > 0.5 ? 0 : 1.0,
          canopyA: cur.treeCanopy,
          canopyB: cur.treeCanopy.clone().offsetHSL(0.04, 0.1, -0.05),
        });
        env.meadow.update(target.name === "spring" ? 1.0 : 0.1);
        env.birds.update(dt, cur.birds > 0.4);
      }

      // Update Lily Pads
      env.pads.forEach((p) => {
        p.spillCd = Math.max(0, p.spillCd - dt);
        let totalW = p.flowerBonus;
        for (const l of p.loads) {
          l.age += dt;
          totalW += l.w;
        }
        if (totalW > p.capacity && p.spillCd <= 0 && p.loads.length > 0) {
          let hi = 0;
          for (let i = 1; i < p.loads.length; i++) {
            if (p.loads[i].w > p.loads[hi].w) hi++;
          }
          const dropped = p.loads.splice(hi, 1)[0];
          if (dropped.pellet) {
            const dp = dropped.pellet;
            const yaw = p.group.rotation.y;
            const ca = Math.cos(yaw);
            const sa = Math.sin(yaw);
            const ox = dropped.x * ca + dropped.z * sa;
            const oz = -dropped.x * sa + dropped.z * ca;
            const d = Math.hypot(ox, oz) || 1;
            dp.x = p.x + (ox / d) * (p.radius + 0.15);
            dp.z = p.z + (oz / d) * (p.radius + 0.15);
            dp.vx = (ox / d) * 0.5;
            dp.vz = (oz / d) * 0.5;
            dp.onPad = undefined;
            dp.padCd = 2;
            dp.padNear = true;
          }
          addRipple(p.x, p.z, 0.3);
          p.spillCd = 2.5;
          totalW = p.flowerBonus;
          for (const l of p.loads) totalW += l.w;
        }
        let cx = 0;
        let cz = 0;
        if (totalW > 1e-6) {
          for (const l of p.loads) {
            cx += l.x * l.w;
            cz += l.z * l.w;
          }
          cx /= totalW;
          cz /= totalW;
        }
        const area = Math.PI * p.radius * p.radius;
        const target = clamp(totalW / (p.sinkK * area), 0, 0.5 * p.radius);
        const springK = 1 - Math.exp(-dt * 3);
        p.subY += (target - p.subY) * springK;
        p.tiltLX += (clamp((cz / p.radius) * 0.5, -0.3, 0.3) - p.tiltLX) * springK;
        p.tiltLZ += (clamp((-cx / p.radius) * 0.5, -0.3, 0.3) - p.tiltLZ) * springK;
        const surf = getWaterSurface(
          p.x,
          p.z,
          timeRef.current,
          0,
          waterRef.current?.ripples,
          0
        );
        p.group.position.set(
          p.x,
          0.022 + surf.y - p.subY,
          p.z
        );
        // Clamp raw surface gradient magnitude BEFORE gain so one ripple can't pin the tilt.
        let gTX = surf.tiltX;
        let gTZ = surf.tiltZ;
        const gMag = Math.hypot(gTX, gTZ);
        if (gMag > 0.45) {
          const s = 0.45 / gMag;
          gTX *= s;
          gTZ *= s;
        }
        const tiltK = 1 - Math.exp(-dt * 6);
        const softClamp = (v: number): number => 0.35 * Math.tanh(v / 0.35);
        const targetTX =
          gTX * 1.0 + p.tiltLX;
        const targetTZ =
          gTZ * 1.0 + p.tiltLZ;
        p.tiltSX += (targetTX - p.tiltSX) * tiltK;
        p.tiltSZ += (targetTZ - p.tiltSZ) * tiltK;
        p.group.rotation.x = softClamp(p.tiltSX);
        p.group.rotation.z = softClamp(p.tiltSZ);
        const padTiltMag = Math.hypot(p.group.rotation.x, p.group.rotation.z);
        const spinScale = 1 - Math.min(padTiltMag / 0.5, 0.7);
        p.group.rotation.y += p.spin * spinScale * (1 + windVal * 2) * dt;
      });

      // Update particles
      if (cur) {
        particles.update(
          dt,
          target.fallType,
          cur.fallRate,
          cur.wind,
          cur.rain,
          getRippleHeight,
          addRipple,
          fishesRef.current,
          timeRef.current,
          activity
        );
      }

      // Controls update
      controls.update();

      // Still-water mode: FFT cascade disabled; shader falls back to ripple-only.
      void fft;
      void FFT_BASE_ANGLE;
      void fftWindDir;
      if (water.mat.uniforms.uHasFFT) {
        water.mat.uniforms.uHasFFT.value = 0.0;
      }

      // Render pass 1: underwater background to renderTarget
      waterMesh.visible = false;
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, camera);

      // Render pass 2: scene with water shader using renderTarget texture & depth
      waterMesh.visible = true;
      if (renderTarget) {
        water.mat.uniforms.uScene.value = renderTarget.texture;
        water.mat.uniforms.uDepth.value = renderTarget.depthTexture;
      }
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      env.lotus.destroy(scene);
      env.duckweed.destroy(scene);
      env.tinyFish.destroy(scene);
      fft?.dispose();
      waterGeo.dispose();
      renderer.dispose();
      if (renderTarget) renderTarget.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      <canvas
        id="pond"
        ref={canvasRef}
        className="w-full h-full block touch-none cursor-crosshair"
      />

      {loading && (
        <div className="absolute inset-0 bg-[#121a16] flex flex-col items-center justify-center text-[#d9e2da] z-50 transition-opacity duration-700">
          <div className="relative w-16 h-16 mb-4">
            <div className="absolute inset-0 border-2 border-emerald-500/20 rounded-full" />
            <div className="absolute inset-0 border-2 border-transparent border-t-emerald-400 rounded-full animate-spin" />
            <div className="absolute inset-2 flex items-center justify-center font-['Shippori_Mincho'] text-xl text-emerald-400">
              和
            </div>
          </div>
          <h2 className="font-['Shippori_Mincho'] text-2xl tracking-wider mb-1">
            Nagomi · Hồ Cá Koi 3D
          </h2>
          <p className="text-sm text-stone-400 tracking-wide">
            Đang khởi tạo mặt nước và mô phỏng đàn cá...
          </p>
        </div>
      )}
    </div>
  );
};
