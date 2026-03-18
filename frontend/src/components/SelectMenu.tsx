import React, { useEffect, useMemo, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

function ChevronDownIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className || "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  name?: string;
  searchable?: boolean;
};

export default function SelectMenu(props: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(() => props.options.find((o) => o.value === props.value) || null, [props.options, props.value]);
  const showSearch = Boolean(props.searchable ?? props.options.length > 8);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return props.options;
    return props.options.filter((o) => `${o.label} ${o.hint || ""}`.toLowerCase().includes(qq));
  }, [props.options, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    window.setTimeout(() => {
      try {
        scrollerRef.current?.scrollTo({ top: 0 });
      } catch {
        // ignore
      }
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  function pick(v: string) {
    props.onChange(v);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={["relative", props.className].filter(Boolean).join(" ")}>
      {props.name ? <input type="hidden" name={props.name} value={props.value} /> : null}

      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen(true)}
        className={[
          "w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-200",
          "flex items-center justify-between gap-2",
          props.disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-white",
          props.buttonClassName
        ]
          .filter(Boolean)
          .join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
      >
        <span className={["truncate", selected ? "text-gray-900 font-semibold" : "text-gray-500"].join(" ")}>
          {selected ? selected.label : props.placeholder || "请选择"}
        </span>
        <span className="text-gray-600">
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-x-0 bottom-0">
              <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-white shadow-2xl overflow-hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="font-black text-gray-900">选择</div>
                  <button className="text-sm font-semibold text-gray-600 hover:text-brand-700" type="button" onClick={() => setOpen(false)}>
                    关闭
                  </button>
                </div>
                <div ref={scrollerRef} className="max-h-[75vh] overflow-auto p-4 space-y-3">
                  {showSearch && (
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="搜索"
                      className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                    />
                  )}
                  <div className="space-y-2">
                    {filtered.map((o) => (
                      <button
                        type="button"
                        key={o.value}
                        disabled={o.disabled}
                        onClick={() => pick(o.value)}
                        className={[
                          "w-full text-left rounded-2xl border px-4 py-3 transition",
                          o.value === props.value ? "border-brand-200 bg-brand-50" : "border-gray-100 bg-white/80 hover:bg-white",
                          o.disabled ? "opacity-60 cursor-not-allowed" : ""
                        ].join(" ")}
                      >
                        <div className="text-sm font-semibold text-gray-900">{o.label}</div>
                        {o.hint ? <div className="mt-1 text-xs text-gray-600">{o.hint}</div> : null}
                      </button>
                    ))}
                    {!filtered.length ? <div className="text-xs text-gray-600 px-2 py-2">无匹配项</div> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden md:block absolute z-50 mt-2 w-full">
            <div className="glass rounded-2xl shadow-soft overflow-hidden border border-gray-100">
              <div className="p-3 border-b border-gray-100">
                {showSearch ? (
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="搜索"
                    className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                    autoFocus
                  />
                ) : (
                  <div className="text-[11px] font-semibold tracking-wide text-gray-500">请选择</div>
                )}
              </div>
              <div ref={scrollerRef} className="max-h-[320px] overflow-auto p-2">
                {filtered.map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    disabled={o.disabled}
                    onClick={() => pick(o.value)}
                    className={[
                      "w-full text-left rounded-xl px-3 py-2 transition",
                      o.value === props.value ? "bg-brand-50 text-brand-800" : "hover:bg-gray-50 text-gray-800",
                      o.disabled ? "opacity-60 cursor-not-allowed" : ""
                    ].join(" ")}
                  >
                    <div className="text-sm font-semibold truncate">{o.label}</div>
                    {o.hint ? <div className="text-[11px] text-gray-500 truncate">{o.hint}</div> : null}
                  </button>
                ))}
                {!filtered.length ? <div className="text-xs text-gray-600 px-3 py-2">无匹配项</div> : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
