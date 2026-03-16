import React, { useEffect } from "react";
import Button from "./Button";

export default function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const confirmText = props.confirmText || "确认";
  const cancelText = props.cancelText || "取消";

  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props.open, props]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="glass w-full max-w-md rounded-2xl shadow-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="font-black text-gray-900">{props.title}</div>
          <button
            type="button"
            className="text-sm font-semibold text-gray-600 hover:text-brand-700"
            onClick={props.onClose}
            aria-label="close"
          >
            关闭
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-700 leading-6">{props.message}</div>
          <div className="flex justify-end gap-2">
            <Button tone="ghost" type="button" onClick={props.onClose} disabled={props.busy}>
              {cancelText}
            </Button>
            <Button tone={props.danger ? "danger" : "brand"} type="button" onClick={props.onConfirm} disabled={props.busy}>
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
