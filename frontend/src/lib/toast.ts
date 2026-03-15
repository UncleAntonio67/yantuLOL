export type ToastTone = "success" | "error" | "info";

export type ToastPayload = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

const EVENT = "yantu_toast";

export function emitToast(payload: ToastPayload) {
  const detail: ToastPayload = {
    tone: payload.tone || "info",
    durationMs: payload.durationMs || 1600,
    message: String(payload.message || "").trim() || "操作完成"
  };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
}

export function onToast(handler: (p: ToastPayload) => void) {
  const h = (e: Event) => {
    const ce = e as CustomEvent;
    handler(ce.detail as ToastPayload);
  };
  window.addEventListener(EVENT, h as any);
  return () => window.removeEventListener(EVENT, h as any);
}

export const toast = {
  success(message: string, durationMs?: number) {
    emitToast({ message, durationMs, tone: "success" });
  },
  error(message: string, durationMs?: number) {
    emitToast({ message, durationMs: durationMs || 2400, tone: "error" });
  },
  info(message: string, durationMs?: number) {
    emitToast({ message, durationMs, tone: "info" });
  }
};
