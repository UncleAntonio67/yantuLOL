import React from "react";

type Tone = "brand" | "ghost" | "danger";
type Size = "md" | "sm";

export default function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size }
) {
  const tone = props.tone || "brand";
  const size = props.size || "md";

  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition select-none " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs rounded-md" : "px-4 py-2 text-sm";

  const styles =
    tone === "brand"
      ? "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-200"
      : tone === "danger"
        ? "bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-200"
        : "bg-white/80 text-gray-800 border border-gray-200 hover:bg-gray-50";

  const { className, tone: _t, size: _s, ...rest } = props;
  return <button className={[base, sizeCls, styles, className].filter(Boolean).join(" ")} {...rest} />;
}

