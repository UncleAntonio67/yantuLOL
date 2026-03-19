import React from "react";
import Spinner from "./Spinner";

export default function LoadingOverlay(props: { open: boolean; label?: string }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/20 p-6">
      <div className="glass rounded-2xl shadow-soft px-6 py-5 flex items-center gap-3">
        <Spinner className="h-5 w-5 text-gray-700" label={props.label || "加载中"} />
        <div className="text-sm font-semibold text-gray-800">{props.label || "加载中"}</div>
      </div>
    </div>
  );
}

