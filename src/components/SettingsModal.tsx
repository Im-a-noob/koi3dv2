import React from "react";
import { X, Sliders, RotateCcw, Info } from "lucide-react";
import { PondSettings, KoiVariety } from "../types/koi";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PondSettings;
  onUpdateSettings: (newSettings: Partial<PondSettings>) => void;
  onReset: () => void;
  onOpenCustomizer?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onReset,
  onOpenCustomizer,
}) => {
  if (!isOpen) return null;

  const varieties: { id: KoiVariety; name: string; color: string }[] = [
    { id: "kohaku", name: "Kohaku (Hồng Bạch)", color: "#e63946" },
    { id: "sanke", name: "Taisho Sanke (Tam Thể)", color: "#ff5722" },
    { id: "showa", name: "Showa Sanshoku (Hắc Tam)", color: "#212529" },
    { id: "ogon", name: "Yamabuki Ogon (Hoàng Kim)", color: "#ffc107" },
    { id: "utsuri", name: "Shiro Utsuri (Bạch Tả)", color: "#6c757d" },
    { id: "asagi", name: "Asagi (Thiển Thuận)", color: "#457b9d" },
    { id: "tancho", name: "Tancho (Đan Đỉnh)", color: "#d90429" },
  ];

  const toggleVariety = (v: KoiVariety) => {
    let next = [...settings.selectedVarieties];
    if (next.includes(v)) {
      if (next.length > 1) {
        next = next.filter((item) => item !== v);
      }
    } else {
      next.push(v);
    }
    onUpdateSettings({ selectedVarieties: next });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-stone-900/95 border border-white/10 rounded-2xl shadow-2xl p-6 text-stone-200 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Sliders size={20} className="text-amber-400" />
            <h2 className="font-['Shippori_Mincho'] text-lg font-bold text-stone-100">
              Cài đặt hồ cá Koi 3D
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-6 py-4">
          {/* Fish Count */}
          <div>
            <div className="flex justify-between items-center text-sm mb-2">
              <span className="font-medium text-stone-200">Số lượng cá Koi trong hồ</span>
              <span className="font-mono text-amber-400 font-semibold px-2 py-0.5 rounded bg-stone-800 border border-white/5">
                {settings.fishCount} con
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={24}
              step={1}
              value={settings.fishCount}
              onChange={(e) => onUpdateSettings({ fishCount: parseInt(e.target.value) })}
              className="w-full h-2 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <div className="flex justify-between text-[11px] text-stone-500 mt-1">
              <span>3 con (Thanh tịnh)</span>
              <span>12 con (Tiêu chuẩn)</span>
              <span>24 con (Đông đúc)</span>
            </div>
          </div>

          {/* Koi Varieties */}
          <div>
            <span className="font-medium text-sm text-stone-200 block mb-2.5">
              Các dòng cá Koi xuất hiện
            </span>
            <div className="grid grid-cols-1 gap-2">
              {varieties.map((v) => {
                const isSelected = settings.selectedVarieties.includes(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggleVariety(v.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all border ${
                      isSelected
                        ? "bg-stone-800/90 text-stone-100 border-amber-500/40"
                        : "bg-stone-900/40 text-stone-400 border-white/5 hover:bg-stone-800/40"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white/20"
                        style={{ backgroundColor: v.color }}
                      />
                      <span className="font-medium">{v.name}</span>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        isSelected
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-stone-800 text-stone-500"
                      }`}
                    >
                      {isSelected ? "Bật" : "Tắt"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Koi Body Customizer Quick Access */}
          {onOpenCustomizer && (
            <button
              onClick={() => {
                onClose();
                onOpenCustomizer();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-medium text-xs border border-amber-500/30 transition-all shadow-sm active:scale-[0.98]"
            >
              <Sliders size={15} />
              <span>Studio Tinh Chỉnh Dáng Cá Koi 3D</span>
            </button>
          )}

          {/* Shortcut Keys Table */}
          <div className="bg-stone-950/50 p-3.5 rounded-xl border border-white/5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-300 mb-2">
              <Info size={14} className="text-amber-400" />
              <span>Phím tắt nhanh</span>
            </div>
            <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs text-stone-400">
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  1-9
                </kbd>
                Đổi 9 khung cảnh
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  Space
                </kbd>
                Xua cá tản đi
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  M
                </kbd>
                Bật / Tắt âm thanh
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  H
                </kbd>
                Ẩn / Hiện giao diện
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  C
                </kbd>
                Chỉnh dáng cá Koi
              </div>
              <div>
                <kbd className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-200 border border-white/10 font-mono text-[10px] mr-1.5">
                  F
                </kbd>
                Thả thức ăn
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-white/10">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors"
          >
            <RotateCcw size={14} />
            <span>Mặc định</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-xs tracking-wide transition-all shadow-md"
          >
            Hoàn tất
          </button>
        </div>
      </div>
    </div>
  );
};
