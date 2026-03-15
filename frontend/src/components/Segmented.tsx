import React from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export default function Segmented<T extends string>(props: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const size = props.size || "md";
  const base = size === "sm" ? "px-3 py-2 text-xs rounded-xl" : "px-4 py-2.5 text-sm rounded-2xl";

  return (
    <div className="inline-flex rounded-2xl border border-gray-200 bg-white/70 p-1 gap-1">
      {props.options.map((opt) => {
        const active = opt.value === props.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={[
              base,
              "font-semibold transition whitespace-nowrap",
              active ? "bg-gray-900 text-white shadow-soft" : "text-gray-700 hover:bg-white"
            ].join(" ")}
            onClick={() => props.onChange(opt.value)}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}