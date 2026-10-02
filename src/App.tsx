import React, { useState, useEffect, useRef, useCallback } from "react";
import { SceneName, PondSettings, KoiFishData, KoiVariety, KoiBodyParams } from "./types/koi";
import { PondCanvas } from "./components/PondCanvas";
import { Header } from "./components/Header";
import { SceneDock } from "./components/SceneDock";
import { ActionControls } from "./components/ActionControls";
import { FishInspector } from "./components/FishInspector";
import { SettingsModal } from "./components/SettingsModal";
import { KoiBodyCustomizerModal } from "./components/KoiBodyCustomizerModal";
import { sound } from "./engine/audio";

const DEFAULT_SETTINGS: PondSettings = {
  fishCount: 10,
  selectedVarieties: [
    "kohaku",
    "sanke",
    "showa",
    "ogon",
    "utsuri",
    "asagi",
    "tancho",
  ],
  causticsQuality: true,
  enableBirds: true,
  enableRainRipples: true,
  waterClarity: 0.85,
  cameraSpeed: 1.0,
  soundVolume: 0.7,
  isMuted: false,
  activeCameraMode: "orbit",
};

const STORAGE_KEY_SETTINGS = "nagomi_koi_settings_v2";
const STORAGE_KEY_BODY = "nagomi_koi_body_params_v2";

export default function App() {
  const [currentScene, setCurrentScene] = useState<SceneName>("sunny");
  const [settings, setSettings] = useState<PondSettings>(() => {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      const savedBody = localStorage.getItem(STORAGE_KEY_BODY);
      let initial = { ...DEFAULT_SETTINGS };
      if (savedSettings) {
        initial = { ...initial, ...JSON.parse(savedSettings) };
      }
      if (savedBody) {
        initial.globalKoiParams = JSON.parse(savedBody);
      }
      return initial;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [selectedFish, setSelectedFish] = useState<KoiFishData | null>(null);
  const [cleanMode, setCleanMode] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isCustomizerOpen, setIsCustomizerOpen] = useState<boolean>(false);
  const [customizingFish, setCustomizingFish] = useState<KoiFishData | null>(null);
  const [cameraMode, setCameraMode] = useState<"orbit" | "topdown" | "shoreline">(
    settings.activeCameraMode || "orbit"
  );
  const [isMuted, setIsMuted] = useState<boolean>(settings.isMuted || false);
  const [volume, setVolume] = useState<number>(settings.soundVolume || 0.7);

  // Sync settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.warn("Failed to persist settings:", e);
    }
  }, [settings]);

  const controlsRef = useRef<{
    dropFood: (x?: number, z?: number) => void;
    scatterFish: () => void;
    triggerJump: () => void;
    setCameraView: (mode: "orbit" | "topdown" | "shoreline") => void;
    updateFishBody: (id: number | "all", params: Partial<KoiBodyParams>) => void;
  } | null>(null);

  // Sound handlers
  const handleToggleSound = useCallback(() => {
    const muted = sound.toggleMute();
    setIsMuted(muted);
  }, []);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    sound.setVolume(vol);
  }, []);

  // Controls triggers
  const handleDropFood = () => {
    sound.ensureContext();
    controlsRef.current?.dropFood();
  };

  const handleScatter = () => {
    sound.ensureContext();
    controlsRef.current?.scatterFish();
  };

  const handleJump = () => {
    sound.ensureContext();
    controlsRef.current?.triggerJump();
  };

  const handleChangeCameraMode = (mode: "orbit" | "topdown" | "shoreline") => {
    setCameraMode(mode);
    controlsRef.current?.setCameraView(mode);
  };

  const handleSelectScene = (scene: SceneName) => {
    sound.ensureContext();
    setCurrentScene(scene);
  };

  const handleUpdateSettings = (newSettings: Partial<PondSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const handleResetSettings = () => {
    try {
      localStorage.removeItem(STORAGE_KEY_SETTINGS);
      localStorage.removeItem(STORAGE_KEY_BODY);
    } catch (e) {
      console.warn("Failed to clear localStorage:", e);
    }
    setSettings(DEFAULT_SETTINGS);
  };

  // Body Customizer handlers
  const handleOpenCustomizer = useCallback((fish?: KoiFishData | null) => {
    setCustomizingFish(fish || selectedFish || null);
    setIsCustomizerOpen(true);
  }, [selectedFish]);

  const handleApplyBodyParams = useCallback(
    (newParams: KoiBodyParams, applyAll: boolean) => {
      try {
        localStorage.setItem(STORAGE_KEY_BODY, JSON.stringify(newParams));
      } catch (e) {
        console.warn("Failed to persist body params:", e);
      }

      if (controlsRef.current) {
        if (applyAll || !customizingFish) {
          controlsRef.current.updateFishBody("all", newParams);
          setSettings((prev) => ({
            ...prev,
            globalKoiParams: newParams,
          }));
        } else {
          controlsRef.current.updateFishBody(customizingFish.id, newParams);
          setSelectedFish((prev) =>
            prev && prev.id === customizingFish.id
              ? { ...prev, bodyParams: newParams }
              : prev
          );
        }
      }
    },
    [customizingFish]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const SCENE_KEYS: SceneName[] = [
      "sunny",
      "sunset",
      "night",
      "rain",
      "storm",
      "spring",
      "summer",
      "autumn",
      "winter",
    ];

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        handleScatter();
      } else if (e.key === "m" || e.key === "M") {
        handleToggleSound();
      } else if (e.key === "h" || e.key === "H") {
        setCleanMode((prev) => !prev);
      } else if (e.key === "f" || e.key === "F") {
        handleDropFood();
      } else if (e.key === "c" || e.key === "C") {
        handleOpenCustomizer(selectedFish);
      } else {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) {
          handleSelectScene(SCENE_KEYS[num - 1]);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleScatter, handleToggleSound, handleOpenCustomizer, selectedFish]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#121a16] select-none">
      {/* 3D Pond Canvas */}
      <PondCanvas
        currentScene={currentScene}
        settings={settings}
        onSelectFish={setSelectedFish}
        refControls={controlsRef}
      />

      {/* Top Header */}
      <Header
        currentScene={currentScene}
        isMuted={isMuted}
        onToggleSound={handleToggleSound}
        volume={volume}
        onVolumeChange={handleVolumeChange}
        cleanMode={cleanMode}
        onToggleCleanMode={() => setCleanMode(!cleanMode)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        cameraMode={cameraMode}
        onChangeCameraMode={handleChangeCameraMode}
      />

      {/* Fish Inspector Card */}
      {!cleanMode && (
        <FishInspector
          fish={selectedFish}
          onClose={() => setSelectedFish(null)}
          onOpenCustomizer={handleOpenCustomizer}
        />
      )}

      {/* Bottom HUD & Dock */}
      {!cleanMode && (
        <div className="fixed bottom-4 left-0 right-0 z-40 flex flex-col items-center gap-2.5 px-4 pointer-events-none">
          {/* Hint Pill */}
          <div className="pointer-events-auto bg-stone-950/60 backdrop-blur-md border border-white/10 text-stone-300 text-[11px] md:text-xs py-1.5 px-3.5 rounded-full shadow-lg text-center hidden sm:flex items-center gap-2">
            <span>✨ Click mặt nước để <b>thả mồi</b></span>
            <span className="text-stone-600">·</span>
            <span>Kéo chuột để <b>xoay 3D</b></span>
            <span className="text-stone-600">·</span>
            <span>Cuộn để <b>thu phóng</b></span>
            <span className="text-stone-600">·</span>
            <span>Phím <kbd className="font-mono bg-stone-800 px-1 py-0.2 rounded text-[10px]">Space</kbd> để <b>xua cá</b></span>
            <span className="text-stone-600">·</span>
            <span>Phím <kbd className="font-mono bg-stone-800 px-1 py-0.2 rounded text-[10px]">C</kbd> để <b>chỉnh dáng cá</b></span>
          </div>

          {/* Action buttons (Thả thức ăn, Xua cá, Cá nhảy, Chỉnh dáng cá) */}
          <div className="pointer-events-auto">
            <ActionControls
              onDropFood={handleDropFood}
              onScatter={handleScatter}
              onJump={handleJump}
              onOpenCustomizer={() => handleOpenCustomizer(selectedFish)}
            />
          </div>

          {/* 9 Atmospheric Scene Presets Dock */}
          <div className="pointer-events-auto max-w-full">
            <SceneDock
              currentScene={currentScene}
              onSelectScene={handleSelectScene}
            />
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onReset={handleResetSettings}
        onOpenCustomizer={() => handleOpenCustomizer(selectedFish)}
      />

      {/* Koi 3D Body Customizer Modal */}
      <KoiBodyCustomizerModal
        isOpen={isCustomizerOpen}
        onClose={() => setIsCustomizerOpen(false)}
        targetFish={customizingFish}
        onApplyParams={handleApplyBodyParams}
      />
    </div>
  );
}
