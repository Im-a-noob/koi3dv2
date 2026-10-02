import React from "react";
import {
  Sun,
  Sunset,
  Moon,
  CloudRain,
  CloudLightning,
  Flower2,
  Palmtree,
  Leaf,
  Snowflake,
} from "lucide-react";
import { SceneName } from "../types/koi";
import { SCENE_PRESETS } from "../engine/presets";

interface SceneDockProps {
  currentScene: SceneName;
  onSelectScene: (scene: SceneName) => void;
}

export const SceneDock: React.FC<SceneDockProps> = ({
  currentScene,
  onSelectScene,
}) => {
  const scenes: { id: SceneName; icon: React.ReactNode; label: string; keyNum: number }[] = [
    { id: "sunny", icon: <Sun size={18} />, label: "Nắng đẹp", keyNum: 1 },
    { id: "sunset", icon: <Sunset size={18} />, label: "Hoàng hôn", keyNum: 2 },
    { id: "night", icon: <Moon size={18} />, label: "Đêm trăng", keyNum: 3 },
    { id: "rain", icon: <CloudRain size={18} />, label: "Mưa rơi", keyNum: 4 },
    { id: "storm", icon: <CloudLightning size={18} />, label: "Sấm sét", keyNum: 5 },
    { id: "spring", icon: <Flower2 size={18} />, label: "Mùa xuân", keyNum: 6 },
    { id: "summer", icon: <Palmtree size={18} />, label: "Mùa hạ", keyNum: 7 },
    { id: "autumn", icon: <Leaf size={18} />, label: "Mùa thu", keyNum: 8 },
    { id: "winter", icon: <Snowflake size={18} />, label: "Mùa đông", keyNum: 9 },
  ];

  return (
    <div className="flex items-center gap-1.5 p-2 bg-stone-900/80 hover:bg-stone-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-x-auto max-w-full scrollbar-none transition-all">
      {scenes.map((s) => {
        const isActive = currentScene === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelectScene(s.id)}
            className={`relative flex flex-col items-center justify-center min-w-[62px] md:min-w-[70px] py-2 px-2.5 rounded-xl text-xs transition-all duration-200 group ${
              isActive
                ? "bg-gradient-to-b from-amber-500/25 to-red-500/25 text-amber-200 border border-amber-500/40 shadow-lg font-medium"
                : "text-stone-400 hover:text-stone-100 hover:bg-stone-800/60"
            }`}
            title={`${s.label} (Phím ${s.keyNum}) - ${SCENE_PRESETS[s.id]?.desc}`}
          >
            <div
              className={`p-1.5 rounded-lg mb-1 transition-transform group-hover:scale-110 ${
                isActive ? "text-amber-300" : "text-stone-400 group-hover:text-stone-200"
              }`}
            >
              {s.icon}
            </div>
            <span className="text-[11px] font-medium leading-none tracking-tight">
              {s.label}
            </span>
            <span className="text-[9px] text-stone-500 mt-1 font-mono">
              [{s.keyNum}]
            </span>

            {isActive && (
              <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-amber-400 shadow-sm" />
            )}
          </button>
        );
      })}
    </div>
  );
};
