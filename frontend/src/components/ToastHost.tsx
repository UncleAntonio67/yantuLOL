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
      const duration = Math.max(800, Math.min(8000, Number(p.durationMs || 1600)));

      setItems((prev) => [{ id, tone, message: msg }, ...prev].slice(0, 3));

      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, duration);
    });
  }, []);

  if (!items.length) return null;

  return (
    <div className="fixed right-3 top-3 z-[1000] space-y-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={[
            "max-w-[320px] rounded-2xl border px-4 py-3 text-sm shadow-soft",
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
