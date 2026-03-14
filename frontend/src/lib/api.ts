import { clearAdminToken, getAdminToken } from "./storage";
import type { ViewerMeta } from "./types";

export type ApiError = {
  status: number;
  message: string;
};

// Throwing plain objects makes error handling brittle (some callsites assume `Error`).
export class ApiErrorImpl extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<ApiErrorImpl> {
  let message = res.statusText || "Request failed";
  try {
    const data = (await res.json()) as { detail?: unknown };
    const detail = data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      message = detail;
    } else if (Array.isArray(detail)) {
      // FastAPI validation errors: [{loc: [...], msg: "...", type: "..."}]
      const parts = detail
        .map((e: any) => {
          const loc = Array.isArray(e?.loc) ? e.loc.filter((x: any) => x !== "body").join(".") : "";
          const msg = typeof e?.msg === "string" ? e.msg : "参数错误";
          return loc ? `${loc}: ${msg}` : msg;
        })
        .filter(Boolean);
      if (parts.length) message = `请求参数错误: ${parts.join("；")}`;
    } else if (detail && typeof detail === "object") {
      message = JSON.stringify(detail);
    }
  } catch {
    // ignore
  }
  return new ApiErrorImpl(res.status, message);
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    // token invalid/expired
    clearAdminToken();
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function apiForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, method: init?.method || "POST", body: form, headers });
  if (res.status === 401) clearAdminToken();
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function viewerAuth(orderId: string, password: string): Promise<{ viewer_token: string; expires_in_minutes: number }> {
  const res = await fetch("/api/viewer/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ order_id: orderId, password })
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { viewer_token: string; expires_in_minutes: number };
}

export async function fetchViewerPdf(token: string, attachmentId?: string): Promise<ArrayBuffer> {
  const suffix = attachmentId ? `/${encodeURIComponent(attachmentId)}` : "";
  const res = await fetch(`/api/viewer/document/${encodeURIComponent(token)}${suffix}`, {
    method: "GET",
    headers: { "Accept": "application/pdf" }
  });
  if (!res.ok) throw await readError(res);
  return await res.arrayBuffer();
}

export async function fetchViewerMeta(token: string): Promise<ViewerMeta> {
  const res = await fetch(`/api/viewer/meta/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ViewerMeta;
}


export async function downloadViewerPdf(token: string, attachmentId: string, password: string): Promise<Blob> {
  const res = await fetch(`/api/viewer/download/${encodeURIComponent(token)}/${encodeURIComponent(attachmentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/pdf" },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw await readError(res);
  return await res.blob();
}
