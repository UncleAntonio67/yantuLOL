import React from "react";

export function Label(props: React.PropsWithChildren) {
  return <div className="mb-1 text-xs font-semibold tracking-wide text-gray-700">{props.children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        [
          "w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-200",
          props.className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={
        [
          "w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-200",
          props.className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={
        [
          "w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-200",
          props.className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}