import React, { useEffect, useState } from "react";
import { onToast, type ToastPayload } from "../lib/toast";

type ToastItem = {
  id: string;
  message: string;
  tone: "success" | "error" | "info";
};

function toneClass(t: ToastItem["tone"]) {
  if (t === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (t === "error") return "border-red-200 bg-red-50 text-red-900";
  return "border-gray-200 bg-white/90 text-gray-900";
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return onToast((p: ToastPayload) => {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const tone = (p.tone || "info") as ToastItem["tone"];
      const msg = String(p.message || "").trim() || "操作完成";
      const duration = Math.max(900, Math.min(8000, Number(p.durationMs || 1600)));

      setItems((prev) => [{ id, tone, message: msg }, ...prev].slice(0, 3));

      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, duration);
    });
  }, []);

  if (!items.length) return null;

  // Centered, minimal obstruction. Designed mainly for quick feedback such as copy success.
  return (
    <div className="fixed left-1/2 top-1/2 z-[1000] -translate-x-1/2 -translate-y-1/2 space-y-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={[
            "max-w-[340px] rounded-2xl border px-4 py-3 text-sm shadow-soft transition transform-gpu pointer-events-auto",
            "backdrop-blur",
            toneClass(t.tone)
          ].join(" ")}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
