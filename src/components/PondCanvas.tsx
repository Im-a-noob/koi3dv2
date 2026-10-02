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

  // Dynamic helper: add ripple
  const addRipple = (x: number, z: number, amp: number) => {
    if (!waterRef.current) return;
    const r = waterRef.current.ripples[ripIndexRef.current];
    r.set(x, z, timeRef.current, amp);
    ripIndexRef.current = (ripIndexRef.current + 1) % RIPN;
  };

  // Dynamic helper: ripple and wave surface height calculation
  const getRippleHeight = (x: number, z: number): number => {
    const wind = currentPresetState.current ? currentPresetState.current.wind : 0.15;
    return getWaterSurface(x, z, timeRef.current, wind, waterRef.current?.ripples).y;
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

    const waterGeo = new THREE.PlaneGeometry(85, 85, 1, 1);
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
        water.mat.uniforms.uWind.value = cur.wind;

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
          cur ? cur.wind : 0.15,
          waterRef.current?.ripples
        );
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
        if (p.eaten) scene.remove(p.mesh);
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
        f.draw();
      });

      // Update environment elements
      const windVal = cur ? cur.wind : 0.15;
      env.reeds.update(timeRef.current, windVal);
      env.lotus.update(timeRef.current, windVal, waterRef.current?.ripples);
      env.duckweed.update(timeRef.current, windVal, waterRef.current?.ripples);
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

      // Update Lily Pads with wave height and normal tilt
      env.pads.forEach((p) => {
        const surf = getWaterSurface(
          p.x,
          p.z,
          timeRef.current,
          windVal,
          waterRef.current?.ripples
        );
        p.group.position.y = 0.022 + surf.y;
        p.group.rotation.x = surf.tiltX * 0.85;
        p.group.rotation.z = surf.tiltZ * 0.85;
        p.group.rotation.y += p.spin * (1 + windVal * 2) * dt;
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
          timeRef.current
        );
      }

      // Controls update
      controls.update();

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
