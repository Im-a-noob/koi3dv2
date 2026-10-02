import React from "react";
import { Sparkles, Utensils, Wind, Sliders } from "lucide-react";

interface ActionControlsProps {
  onDropFood: () => void;
  onScatter: () => void;
  onJump: () => void;
  onOpenCustomizer?: () => void;
}

export const ActionControls: React.FC<ActionControlsProps> = ({
  onDropFood,
  onScatter,
  onJump,
  onOpenCustomizer,
}) => {
  return (
    <div className="flex items-center gap-2">
      {/* Drop Food */}
      <button
        onClick={onDropFood}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-600/90 hover:bg-amber-500 text-stone-950 font-semibold text-xs tracking-wide shadow-lg shadow-amber-900/30 transition-all hover:scale-[1.03] active:scale-[0.98]"
        title="Thả viên thức ăn cho cá (hoặc click trực tiếp lên mặt nước)"
      >
        <Utensils size={15} />
        <span>Thả thức ăn</span>
      </button>

      {/* Scatter Fish */}
      <button
        onClick={onScatter}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-stone-200 border border-white/10 font-medium text-xs tracking-wide backdrop-blur-xl shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98]"
        title="Xua cá bơi tản ra xa (Phím Space)"
      >
        <Wind size={15} className="text-cyan-400" />
        <span>Xua cá</span>
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono bg-stone-800 text-stone-400 rounded border border-white/5">
          Space
        </kbd>
      </button>

      {/* Fish Jump */}
      <button
        onClick={onJump}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-stone-200 border border-white/10 font-medium text-xs tracking-wide backdrop-blur-xl shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98]"
        title="Kích thích một chú cá quẫy mình nhảy lên khỏi mặt nước"
      >
        <Sparkles size={15} className="text-amber-400" />
        <span>Cá nhảy</span>
      </button>

      {/* Koi Body Customizer */}
      {onOpenCustomizer && (
        <button
          onClick={onOpenCustomizer}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-900/80 hover:bg-stone-800 text-amber-300 border border-amber-500/30 font-medium text-xs tracking-wide backdrop-blur-xl shadow-xl transition-all hover:scale-[1.03] active:scale-[0.98]"
          title="Mở giao diện tinh chỉnh vóc dáng & xoay 3D cá Koi"
        >
          <Sliders size={15} className="text-amber-400" />
          <span>Chỉnh dáng cá</span>
        </button>
      )}
    </div>
  );
};
