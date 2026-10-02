import React from "react";
import {
  Volume2,
  VolumeX,
  Settings,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Compass,
} from "lucide-react";
import { SceneName } from "../types/koi";
import { SCENE_PRESETS } from "../engine/presets";

interface HeaderProps {
  currentScene: SceneName;
  isMuted: boolean;
  onToggleSound: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  cleanMode: boolean;
  onToggleCleanMode: () => void;
  onOpenSettings: () => void;
  cameraMode: "orbit" | "topdown" | "shoreline";
  onChangeCameraMode: (mode: "orbit" | "topdown" | "shoreline") => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentScene,
  isMuted,
  onToggleSound,
  volume,
  onVolumeChange,
  cleanMode,
  onToggleCleanMode,
  onOpenSettings,
  cameraMode,
  onChangeCameraMode,
}) => {
  const [fullscreen, setFullscreen] = React.useState(false);
  const preset = SCENE_PRESETS[currentScene];

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  };

  if (cleanMode) {
    return (
      <div className="fixed top-4 right-4 z-40">
        <button
          onClick={onToggleCleanMode}
          className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 text-white/80 hover:text-white backdrop-blur-md border border-white/10 transition-all shadow-lg"
          title="Hiện giao diện (Phím H)"
        >
          <Eye size={18} />
        </button>
      </div>
    );
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-40 p-4 md:p-6 pointer-events-none flex flex-wrap items-start justify-between gap-3">
      {/* Brand & Scene Info */}
      <div className="pointer-events-auto flex items-center gap-3.5 bg-stone-900/75 hover:bg-stone-900/85 backdrop-blur-xl border border-white/10 px-4 py-2.5 rounded-2xl shadow-2xl transition-all">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-red-500/20 border border-amber-500/30 flex items-center justify-center text-amber-300 font-['Shippori_Mincho'] text-xl font-bold select-none shadow-inner">
          和
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-['Shippori_Mincho'] text-lg md:text-xl font-bold text-stone-100 tracking-wide">
              Nagomi · 和み
            </h1>
            <span className="text-[11px] font-medium tracking-wider uppercase px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              3D Koi Pool
            </span>
          </div>
          <p className="text-xs text-stone-400 font-light flex items-center gap-1.5 mt-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Khung cảnh:</span>
            <span className="text-stone-200 font-medium">{preset?.label}</span>
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="pointer-events-auto flex items-center gap-2 bg-stone-900/75 hover:bg-stone-900/85 backdrop-blur-xl border border-white/10 p-1.5 rounded-2xl shadow-2xl transition-all">
        {/* Camera Views dropdown or toggle */}
        <div className="flex items-center bg-stone-800/60 rounded-xl p-1 border border-white/5 text-xs">
          <button
            onClick={() => onChangeCameraMode("orbit")}
            className={`px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              cameraMode === "orbit"
                ? "bg-stone-700 text-stone-100 shadow-sm font-medium"
                : "text-stone-400 hover:text-stone-200"
            }`}
            title="Góc nhìn 3D Tự do"
          >
            <Compass size={14} />
            <span className="hidden sm:inline">3D</span>
          </button>
          <button
            onClick={() => onChangeCameraMode("topdown")}
            className={`px-2.5 py-1.5 rounded-lg transition-all ${
              cameraMode === "topdown"
                ? "bg-stone-700 text-stone-100 shadow-sm font-medium"
                : "text-stone-400 hover:text-stone-200"
            }`}
            title="Góc nhìn trên xuống (Zen Top-Down)"
          >
            Trên xuống
          </button>
          <button
            onClick={() => onChangeCameraMode("shoreline")}
            className={`px-2.5 py-1.5 rounded-lg transition-all ${
              cameraMode === "shoreline"
                ? "bg-stone-700 text-stone-100 shadow-sm font-medium"
                : "text-stone-400 hover:text-stone-200"
            }`}
            title="Góc nhìn mép bờ hồ"
          >
            Mép hồ
          </button>
        </div>

        <div className="w-px h-5 bg-white/10 my-auto" />

        {/* Audio Mute & Volume */}
        <div className="flex items-center gap-1.5 px-1.5">
          <button
            onClick={onToggleSound}
            className={`p-2 rounded-xl transition-all ${
              !isMuted
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "text-stone-400 hover:text-stone-200 hover:bg-stone-800"
            }`}
            title={isMuted ? "Bật âm thanh (Phím M)" : "Tắt âm thanh"}
          >
            {!isMuted ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>

          {!isMuted && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-16 h-1.5 bg-stone-700 rounded-lg appearance-none cursor-pointer accent-amber-400 hidden sm:block"
              title="Âm lượng"
            />
          )}
        </div>

        <div className="w-px h-5 bg-white/10 my-auto" />

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl text-stone-300 hover:text-stone-100 hover:bg-stone-800/80 transition-all"
          title="Tùy chỉnh hồ cá"
        >
          <Settings size={17} />
        </button>

        {/* Clean Mode */}
        <button
          onClick={onToggleCleanMode}
          className="p-2 rounded-xl text-stone-300 hover:text-stone-100 hover:bg-stone-800/80 transition-all hidden sm:block"
          title="Ẩn giao diện để ngắm cảnh (Phím H)"
        >
          <EyeOff size={17} />
        </button>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="p-2 rounded-xl text-stone-300 hover:text-stone-100 hover:bg-stone-800/80 transition-all hidden md:block"
          title="Toàn màn hình"
        >
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </div>
    </header>
  );
};
