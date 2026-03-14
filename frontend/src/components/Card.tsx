import React from "react";

export default function Card(props: React.PropsWithChildren<{ className?: string; title?: string; subtitle?: string }>) {
  return (
    <section className={["glass rounded-2xl shadow-soft", props.className].filter(Boolean).join(" ")}> 
      {(props.title || props.subtitle) && (
        <div className="px-5 pt-5">
          {props.title && <h2 className="text-lg font-bold text-gray-900">{props.title}</h2>}
          {props.subtitle && <p className="mt-1 text-sm text-gray-600">{props.subtitle}</p>}
        </div>
      )}
      <div className={props.title || props.subtitle ? "p-5" : "p-5"}>{props.children}</div>
    </section>
  );
}