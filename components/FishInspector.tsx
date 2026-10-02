import React from "react";
import { X, Activity, ArrowDown, Gauge, Sliders } from "lucide-react";
import { KoiFishData } from "../types/koi";

interface FishInspectorProps {
  fish: KoiFishData | null;
  onClose: () => void;
  onOpenCustomizer?: (fish: KoiFishData) => void;
}

export const FishInspector: React.FC<FishInspectorProps> = ({
  fish,
  onClose,
  onOpenCustomizer,
}) => {
  if (!fish) return null;

  const stateLabels: Record<KoiFishData["state"], { text: string; color: string }> = {
    swimming: { text: "Đang bơi lội", color: "text-emerald-400" },
    feeding: { text: "Đang ăn mồi", color: "text-amber-400" },
    fleeing: { text: "Đang lặn tránh", color: "text-cyan-400" },
    jumping: { text: "Đang quẫy nhảy", color: "text-purple-400" },
  };

  const varietyDescriptions: Record<string, string> = {
    kohaku: "Thân trắng tinh khiết với các mảng đỏ Kohaku cổ điển rực rỡ.",
    sanke: "Tam thể Taisho Sanke: nền trắng với đốm đỏ lửa và vệt mực đen Sumi.",
    showa: "Hắc tam Showa: nền đen tuyền với vạt đỏ rực và vệt trắng sấm sét.",
    ogon: "Hoàng kim Ogon: ánh vàng kim loại bóng bẩy lấp lánh phản chiếu ánh mặt trời.",
    utsuri: "Bạch tả Shiro Utsuri: hoa văn đen trắng đối lập mạnh mẽ như cờ vua.",
    asagi: "Thiển thuận Asagi: vảy lưng xanh lam lưới kim cương độc đáo cùng viền bụng đỏ.",
    tancho: "Đan đỉnh Tancho: toàn thân trắng tuyết với duy nhất một vòng tròn đỏ son giữa đỉnh đầu.",
  };

  const currentSt = stateLabels[fish.state] || stateLabels.swimming;

  return (
    <div className="fixed top-20 left-4 z-40 w-80 bg-stone-900/85 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div
            className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
            style={{ backgroundColor: fish.colorHex }}
          />
          <div>
            <h3 className="font-['Shippori_Mincho'] text-base font-bold text-stone-100">
              {fish.varietyName}
            </h3>
            <span className="text-[11px] text-stone-400 font-mono">
              Cá #{fish.id}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-stone-300 my-3 leading-relaxed font-light">
        {varietyDescriptions[fish.variety] || "Cá Koi Nhật Bản thuần chủng."}
      </p>

      <div className="grid grid-cols-3 gap-2 bg-stone-950/50 p-2.5 rounded-xl border border-white/5 text-center">
        <div>
          <span className="text-[10px] text-stone-400 block mb-0.5">Chiều dài</span>
          <span className="text-xs font-semibold text-stone-100 font-mono">
            {fish.lengthCm} cm
          </span>
        </div>
        <div>
          <span className="text-[10px] text-stone-400 block mb-0.5">Tốc độ</span>
          <span className="text-xs font-semibold text-stone-100 font-mono">
            {fish.speedKmH} km/h
          </span>
        </div>
        <div>
          <span className="text-[10px] text-stone-400 block mb-0.5">Độ sâu</span>
          <span className="text-xs font-semibold text-stone-100 font-mono">
            {fish.depthM} m
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-stone-400 px-1">
        <span className="flex items-center gap-1.5">
          <Activity size={13} className={currentSt.color} />
          <span>Hành vi Nagomi:</span>
        </span>
        <span className={`font-medium ${currentSt.color}`}>
          {fish.nagomiState || currentSt.text}
        </span>
      </div>

      {onOpenCustomizer && (
        <button
          onClick={() => onOpenCustomizer(fish)}
          className="mt-3.5 w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium text-xs border border-amber-500/30 transition-all shadow-sm active:scale-[0.98]"
        >
          <Sliders size={14} />
          <span>Chỉnh vóc dáng & xoay 3D</span>
        </button>
      )}
    </div>
  );
};
