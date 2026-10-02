import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import {
  X,
  RotateCcw,
  Compass,
  Sliders,
  Check,
} from "lucide-react";
import { KoiBodyParams, DEFAULT_BODY_PARAMS, KoiVariety, KoiFishData } from "../types/koi";
import { KoiFish } from "../engine/koi-mesh";

interface KoiBodyCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetFish: KoiFishData | null;
  onApplyParams: (params: KoiBodyParams, applyAll: boolean) => void;
}

const VARIETIES: { id: KoiVariety; name: string; color: string }[] = [
  { id: "kohaku", name: "Kohaku", color: "#e63946" },
  { id: "sanke", name: "Sanke", color: "#ff5722" },
  { id: "showa", name: "Showa", color: "#212529" },
  { id: "ogon", name: "Ogon", color: "#ffc107" },
  { id: "utsuri", name: "Utsuri", color: "#6c757d" },
  { id: "asagi", name: "Asagi", color: "#457b9d" },
  { id: "tancho", name: "Tancho", color: "#d90429" },
];

export const KoiBodyCustomizerModal: React.FC<KoiBodyCustomizerModalProps> = ({
  isOpen,
  onClose,
  targetFish,
  onApplyParams,
}) => {
  const [params, setParams] = useState<KoiBodyParams>(
    targetFish?.bodyParams ? { ...targetFish.bodyParams } : { ...DEFAULT_BODY_PARAMS }
  );
  const [variety, setVariety] = useState<KoiVariety>(targetFish?.variety || "kohaku");

  // Rotation angles (deg)
  const [rotX, setRotX] = useState<number>(20); // Pitch
  const [rotY, setRotY] = useState<number>(45); // Yaw
  const [rotZ, setRotZ] = useState<number>(0);  // Roll

  // Live refs to prevent stale closure in 60fps renderLoop
  const rotRef = useRef<{ x: number; y: number; z: number }>({ x: 20, y: 45, z: 0 });
  const paramsRef = useRef<KoiBodyParams>(params);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fishInstanceRef = useRef<KoiFish | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pivotGroupRef = useRef<THREE.Group | null>(null);

  // Sync params when modal opens or target fish changes
  useEffect(() => {
    if (isOpen) {
      const initial = targetFish?.bodyParams
        ? { ...targetFish.bodyParams }
        : { ...DEFAULT_BODY_PARAMS };
      setParams(initial);
      paramsRef.current = initial;
      setVariety(targetFish?.variety || "kohaku");
      if (fishInstanceRef.current) {
        fishInstanceRef.current.setBodyParams(initial);
      }
    }
  }, [targetFish, isOpen]);

  // Setup isolated 3D Three.js Studio Scene
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 360;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 50);
    camera.position.set(0, 1.8, 3.2);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    // Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaed, 2.5);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7ed6df, 1.5);
    rimLight.position.set(-3, -2, -3);
    scene.add(rimLight);

    // Studio pivot group for smooth 3D rotation
    const pivot = new THREE.Group();
    scene.add(pivot);
    pivotGroupRef.current = pivot;

    // Create preview Koi Fish
    const fish = new KoiFish(variety, scene, 999);
    fish.setBodyParams(paramsRef.current);
    pivot.add(fish.body);
    pivot.add(fish.fins);
    fish.eyes.forEach((eye) => pivot.add(eye));
    fishInstanceRef.current = fish;

    let animId: number;
    const clock = new THREE.Clock();

    const renderLoop = () => {
      animId = requestAnimationFrame(renderLoop);
      const dt = clock.getDelta();

      if (fishInstanceRef.current && pivotGroupRef.current) {
        // Continuous swimming wave and geometry deform using live params
        fishInstanceRef.current.setBodyParams(paramsRef.current);
        fishInstanceRef.current.updateStudioWave(dt);

        // Apply 3D Rotation from live rotRef (never stale!)
        pivotGroupRef.current.rotation.x = THREE.MathUtils.degToRad(rotRef.current.x);
        pivotGroupRef.current.rotation.y = THREE.MathUtils.degToRad(rotRef.current.y);
        pivotGroupRef.current.rotation.z = THREE.MathUtils.degToRad(rotRef.current.z);
      }

      renderer.render(scene, camera);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animId);
      if (fishInstanceRef.current && sceneRef.current) {
        if (pivotGroupRef.current) {
          pivotGroupRef.current.remove(fishInstanceRef.current.body);
          pivotGroupRef.current.remove(fishInstanceRef.current.fins);
          fishInstanceRef.current.eyes.forEach((eye) => pivotGroupRef.current?.remove(eye));
        }
        fishInstanceRef.current.destroy(sceneRef.current);
        fishInstanceRef.current = null;
      }
      renderer.dispose();
    };
  }, [isOpen]);

  // Variety change inside studio
  const handleSelectVariety = (v: KoiVariety) => {
    setVariety(v);
    if (!sceneRef.current || !pivotGroupRef.current) return;

    if (fishInstanceRef.current) {
      pivotGroupRef.current.remove(fishInstanceRef.current.body);
      pivotGroupRef.current.remove(fishInstanceRef.current.fins);
      fishInstanceRef.current.eyes.forEach((eye) => pivotGroupRef.current?.remove(eye));
      fishInstanceRef.current.destroy(sceneRef.current);
    }

    const newFish = new KoiFish(v, sceneRef.current, 999);
    newFish.setBodyParams(paramsRef.current);
    pivotGroupRef.current.add(newFish.body);
    pivotGroupRef.current.add(newFish.fins);
    newFish.eyes.forEach((eye) => pivotGroupRef.current?.add(eye));
    fishInstanceRef.current = newFish;
  };

  // Interactive Drag-to-Rotate on Canvas
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, rx: 0, ry: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      rx: rotRef.current.x,
      ry: rotRef.current.y,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const nextY = Math.round((dragStartRef.current.ry + dx * 0.6) % 360);
    const nextX = Math.round(Math.max(-75, Math.min(75, dragStartRef.current.rx - dy * 0.6)));
    
    rotRef.current.x = nextX;
    rotRef.current.y = nextY;
    setRotX(nextX);
    setRotY(nextY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    isDraggingRef.current = false;
  };

  // Quick preset view angles
  const setQuickAngle = (view: "top" | "side" | "persp" | "under") => {
    let nx = 20, ny = 45, nz = 0;
    if (view === "top") {
      nx = 80; ny = 0; nz = 0;
    } else if (view === "side") {
      nx = 0; ny = 90; nz = 0;
    } else if (view === "persp") {
      nx = 25; ny = 45; nz = 0;
    } else if (view === "under") {
      nx = -70; ny = 0; nz = 0;
    }
    rotRef.current = { x: nx, y: ny, z: nz };
    setRotX(nx);
    setRotY(ny);
    setRotZ(nz);
  };

  // Rotation slider handlers
  const handlePitchChange = (val: number) => {
    rotRef.current.x = val;
    setRotX(val);
  };

  const handleYawChange = (val: number) => {
    rotRef.current.y = val;
    setRotY(val);
  };

  // Body Proportion change handler (real-time 3D morphing)
  const updateParam = (key: keyof KoiBodyParams, value: number) => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      paramsRef.current = next;
      if (fishInstanceRef.current) {
        fishInstanceRef.current.setBodyParams(next);
      }
      return next;
    });
  };

  // Preset proportions
  const applyPreset = (presetName: "standard" | "butterfly" | "jumbo" | "torpedo") => {
    let newParams = { ...DEFAULT_BODY_PARAMS };
    if (presetName === "butterfly") {
      newParams = {
        lengthScale: 1.15,
        widthScale: 0.9,
        heightScale: 0.85,
        finScale: 1.7,
        tailLength: 1.8,
        tailSpread: 1.6,
        eyeSize: 1.1,
        eyeSpacing: 1.0,
      };
    } else if (presetName === "jumbo") {
      newParams = {
        lengthScale: 1.05,
        widthScale: 1.35,
        heightScale: 1.3,
        finScale: 1.1,
        tailLength: 0.95,
        tailSpread: 1.2,
        eyeSize: 1.15,
        eyeSpacing: 1.1,
      };
    } else if (presetName === "torpedo") {
      newParams = {
        lengthScale: 1.4,
        widthScale: 0.8,
        heightScale: 0.8,
        finScale: 0.9,
        tailLength: 1.2,
        tailSpread: 0.9,
        eyeSize: 0.95,
        eyeSpacing: 0.9,
      };
    }
    paramsRef.current = newParams;
    setParams(newParams);
    if (fishInstanceRef.current) {
      fishInstanceRef.current.setBodyParams(newParams);
    }
  };

  const handleResetParams = () => {
    const next = { ...DEFAULT_BODY_PARAMS };
    paramsRef.current = next;
    setParams(next);
    if (fishInstanceRef.current) {
      fishInstanceRef.current.setBodyParams(next);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-stone-900/95 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[92vh]">
        {/* Left Column: 3D Studio & Rotation Controls */}
        <div className="w-full md:w-[46%] p-5 bg-gradient-to-b from-stone-950/80 to-stone-900/80 flex flex-col border-b md:border-b-0 md:border-r border-white/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Compass className="text-amber-400" size={18} />
              <span className="font-['Shippori_Mincho'] text-sm font-semibold text-stone-100">
                Xoay 3D & Xem Trước
              </span>
            </div>
            <span className="text-[11px] text-stone-400 bg-stone-800/80 px-2 py-0.5 rounded-full border border-white/5">
              Kéo chuột để xoay 360°
            </span>
          </div>

          {/* Interactive 3D Canvas */}
          <div className="relative flex-1 min-h-[240px] md:min-h-[290px] rounded-2xl bg-stone-950/90 border border-white/10 overflow-hidden flex items-center justify-center shadow-inner">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
            />

            {/* Quick Angle Buttons Overlay */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-stone-900/80 backdrop-blur-md p-1 rounded-xl border border-white/10 z-10">
              <button
                onClick={() => setQuickAngle("top")}
                className="px-2 py-1 text-[10px] font-medium text-stone-300 hover:text-white hover:bg-stone-800 rounded-lg transition-all"
                title="Góc nhìn từ trên lưng xuống"
              >
                Lưng
              </button>
              <button
                onClick={() => setQuickAngle("side")}
                className="px-2 py-1 text-[10px] font-medium text-stone-300 hover:text-white hover:bg-stone-800 rounded-lg transition-all"
                title="Góc nhìn ngang mạn sườn"
              >
                Mạn
              </button>
              <button
                onClick={() => setQuickAngle("persp")}
                className="px-2 py-1 text-[10px] font-medium text-stone-300 hover:text-white hover:bg-stone-800 rounded-lg transition-all"
                title="Góc phối cảnh 3/4"
              >
                3/4
              </button>
              <button
                onClick={() => setQuickAngle("under")}
                className="px-2 py-1 text-[10px] font-medium text-stone-300 hover:text-white hover:bg-stone-800 rounded-lg transition-all"
                title="Góc nhìn từ dưới bụng lên"
              >
                Bụng
              </button>
            </div>
          </div>

          {/* 3D Rotation Sliders */}
          <div className="mt-3.5 space-y-2 bg-stone-950/40 p-3 rounded-xl border border-white/5">
            <div className="flex items-center justify-between text-[11px] text-stone-300">
              <span>Xoay ngang (Yaw): {Math.round(rotY)}°</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={rotY}
                onChange={(e) => handleYawChange(parseFloat(e.target.value))}
                className="w-32 h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-500"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-stone-300">
              <span>Ngước / Cúi (Pitch): {Math.round(rotX)}°</span>
              <input
                type="range"
                min={-65}
                max={65}
                value={rotX}
                onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                className="w-32 h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          {/* Variety Selector */}
          <div className="mt-3">
            <span className="text-[11px] font-medium text-stone-400 block mb-1.5">
              Dòng cá (Variety):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {VARIETIES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleSelectVariety(v.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all border ${
                    variety === v.id
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-stone-900/60 text-stone-400 border-white/5 hover:bg-stone-800/60"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: v.color }}
                  />
                  <span>{v.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Body Proportions Sliders */}
        <div className="flex-1 p-5 md:p-6 overflow-y-auto max-h-[60vh] md:max-h-none flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-white/10">
              <div>
                <h2 className="font-['Shippori_Mincho'] text-lg font-bold text-stone-100 flex items-center gap-2">
                  <Sliders className="text-amber-400" size={19} />
                  <span>Tinh Chỉnh Dáng Cá Koi</span>
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">
                  Tùy chỉnh tỷ lệ dài, rộng, cao, vây bơi, đuôi én và mắt cá (xem trước tức thì).
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Presets */}
            <div className="my-4">
              <span className="text-[11px] font-medium text-stone-400 block mb-2">
                Dáng cá mẫu (Presets):
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => applyPreset("standard")}
                  className="px-2.5 py-2 rounded-xl bg-stone-800/60 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-white/5 text-center transition-all hover:border-amber-500/40"
                >
                  Chuẩn Ginrin
                </button>
                <button
                  onClick={() => applyPreset("butterfly")}
                  className="px-2.5 py-2 rounded-xl bg-stone-800/60 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-white/5 text-center transition-all hover:border-amber-500/40"
                >
                  Cá Bướm (Longfin)
                </button>
                <button
                  onClick={() => applyPreset("jumbo")}
                  className="px-2.5 py-2 rounded-xl bg-stone-800/60 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-white/5 text-center transition-all hover:border-amber-500/40"
                >
                  Jumbo Phúc Hậu
                </button>
                <button
                  onClick={() => applyPreset("torpedo")}
                  className="px-2.5 py-2 rounded-xl bg-stone-800/60 hover:bg-stone-800 text-stone-300 text-xs font-medium border border-white/5 text-center transition-all hover:border-amber-500/40"
                >
                  Thon Ngư Lôi
                </button>
              </div>
            </div>

            {/* Sliders Group 1: Thân cá */}
            <div className="space-y-3.5 mb-5 bg-stone-950/40 p-3.5 rounded-2xl border border-white/5">
              <h3 className="text-xs font-semibold text-amber-400/90 tracking-wide uppercase font-mono">
                1. Thân cá (Body Dimensions)
              </h3>

              {/* Chiều dài */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Chiều dài thân</span>
                  <span className="font-mono text-amber-400">{params.lengthScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.65}
                  max={1.55}
                  step={0.02}
                  value={params.lengthScale}
                  onChange={(e) => updateParam("lengthScale", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Chiều rộng */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Chiều rộng (ngang thân)</span>
                  <span className="font-mono text-amber-400">{params.widthScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.65}
                  max={1.55}
                  step={0.02}
                  value={params.widthScale}
                  onChange={(e) => updateParam("widthScale", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>

              {/* Độ dày / Chiều cao */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Độ cao lưng / Độ dày thân</span>
                  <span className="font-mono text-amber-400">{params.heightScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.02}
                  value={params.heightScale}
                  onChange={(e) => updateParam("heightScale", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>

            {/* Sliders Group 2: Vây & Đuôi */}
            <div className="space-y-3.5 mb-5 bg-stone-950/40 p-3.5 rounded-2xl border border-white/5">
              <h3 className="text-xs font-semibold text-emerald-400/90 tracking-wide uppercase font-mono">
                2. Vây & Đuôi cá (Fins & Tail)
              </h3>

              {/* Độ xòe vây bơi */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Độ vươn vây ngực / bụng</span>
                  <span className="font-mono text-emerald-400">{params.finScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.9}
                  step={0.02}
                  value={params.finScale}
                  onChange={(e) => updateParam("finScale", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Chiều dài đuôi én */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Chiều dài vây đuôi</span>
                  <span className="font-mono text-emerald-400">{params.tailLength.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.9}
                  step={0.02}
                  value={params.tailLength}
                  onChange={(e) => updateParam("tailLength", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Độ xòe thùy đuôi */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Độ xòe thùy đuôi én</span>
                  <span className="font-mono text-emerald-400">{params.tailSpread.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.8}
                  step={0.02}
                  value={params.tailSpread}
                  onChange={(e) => updateParam("tailSpread", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-emerald-500"
                />
              </div>
            </div>

            {/* Sliders Group 3: Mắt cá */}
            <div className="space-y-3.5 mb-5 bg-stone-950/40 p-3.5 rounded-2xl border border-white/5">
              <h3 className="text-xs font-semibold text-cyan-400/90 tracking-wide uppercase font-mono">
                3. Đôi mắt (Eyes Proportions)
              </h3>

              {/* Kích thước mắt */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Kích thước mắt</span>
                  <span className="font-mono text-cyan-400">{params.eyeSize.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.02}
                  value={params.eyeSize}
                  onChange={(e) => updateParam("eyeSize", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              {/* Khoảng cách mắt */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-300 font-medium">Khoảng cách 2 mắt</span>
                  <span className="font-mono text-cyan-400">{params.eyeSpacing.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.65}
                  max={1.35}
                  step={0.02}
                  value={params.eyeSpacing}
                  onChange={(e) => updateParam("eyeSpacing", parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-stone-800 rounded appearance-none cursor-pointer accent-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
            <button
              onClick={handleResetParams}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-all border border-white/5 active:scale-[0.98]"
            >
              <RotateCcw size={14} />
              <span>Đặt lại chuẩn</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  onApplyParams(params, false);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-100 text-xs font-medium border border-white/10 transition-all shadow-md active:scale-[0.98]"
              >
                {targetFish ? `Áp dụng cho cá #${targetFish.id}` : "Áp dụng cho cá này"}
              </button>

              <button
                onClick={() => {
                  onApplyParams(params, true);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-stone-950 text-xs font-bold shadow-lg shadow-amber-900/40 transition-all active:scale-[0.98]"
              >
                <Check size={15} />
                <span>Áp dụng toàn hồ & Lưu</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
