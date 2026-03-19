import { clearAdminToken, getAdminToken } from "./storage";
import type { ViewerMeta } from "./types";

export type ApiError = {
  status: number;
  message: string;
};

export class ApiErrorImpl extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isWeChatUA(): boolean {
  try {
    return /MicroMessenger/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

function normalizeNetworkErrorMessage(msg: string): string {
  const m = String(msg || "").trim();
  if (!m) return "网络错误，请稍后重试";
  const lower = m.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout")) return "请求超时，请稍后重试";
  if (m.includes("Failed to fetch") || lower.includes("networkerror")) {
    if (isWeChatUA()) return "网络错误（微信内可能不稳定）。建议点击右上角用系统浏览器打开，或稍后重试。";
    return "网络错误，请检查网络后重试";
  }
  return m;
}

async function readError(res: Response): Promise<ApiErrorImpl> {
  let message = res.statusText || `HTTP ${res.status}`;

  try {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const data = (await res.json()) as { detail?: unknown };
      const detail = data?.detail;
      if (typeof detail === "string" && detail.trim()) {
        message = detail;
      } else if (Array.isArray(detail)) {
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
      return new ApiErrorImpl(res.status, message);
    }

    // Non-JSON errors: try text body.
    const txt = (await res.text()).trim();
    if (txt) {
      // Avoid flooding UI.
      message = txt.length > 800 ? txt.slice(0, 800) + "..." : txt;
    }
  } catch {
    // ignore
  }

  return new ApiErrorImpl(res.status, message);
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const controller = init?.signal ? null : new AbortController();
    const signal = init?.signal || controller?.signal;

    // Conservative timeouts: WeChat WebView tends to hang or fail silently.
    const method = (init?.method || "GET").toUpperCase();
    const isForm = init?.body instanceof FormData;
    const timeoutMs =
      method === "GET" ? 20_000 :
      isForm ? 180_000 :
      30_000;

    let timer: number | null = null;
    if (controller) {
      timer = window.setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      return await fetch(input, { ...init, signal });
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  } catch (e: any) {
    const msg = normalizeNetworkErrorMessage(String(e?.message || e || "网络错误"));
    throw new ApiErrorImpl(0, msg);
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});
  headers.set("Accept", "application/json");
  if (!(init?.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await safeFetch(path, { ...init, headers });
  if (res.status === 401) {
    clearAdminToken();
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

type CacheEntry = {
  expiresAt: number;
  value?: unknown;
  inFlight?: Promise<unknown>;
};

// In-memory GET cache with TTL + in-flight de-dup. This improves perceived speed on pages
// that repeatedly load the same bootstrap data (products/team/etc).
const _jsonCache = new Map<string, CacheEntry>();

function _cacheKey(path: string): string {
  // Keyed by token to avoid cross-user data bleed after logout/login.
  const token = getAdminToken() || "";
  return `${token}::${path}`;
}

export function invalidateApiCache(prefix: string = ""): void {
  if (!prefix) {
    _jsonCache.clear();
    return;
  }
  for (const k of Array.from(_jsonCache.keys())) {
    if (k.endsWith(prefix) || k.includes(`::${prefix}`)) _jsonCache.delete(k);
  }
}

export async function apiJsonCached<T>(path: string, ttlMs: number = 5000, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET") return await apiJson<T>(path, init);
  if (init?.body) return await apiJson<T>(path, init);

  const now = Date.now();
  const key = _cacheKey(path);
  const existing = _jsonCache.get(key);
  if (existing?.value !== undefined && existing.expiresAt > now) return existing.value as T;
  if (existing?.inFlight) return (await existing.inFlight) as T;

  const p = (async () => {
    const v = await apiJson<T>(path, init);
    _jsonCache.set(key, { expiresAt: now + Math.max(0, ttlMs), value: v });
    return v;
  })();

  _jsonCache.set(key, { expiresAt: now + Math.max(0, ttlMs), inFlight: p });
  try {
    return (await p) as T;
  } catch (e) {
    _jsonCache.delete(key);
    throw e;
  }
}

export async function apiForm<T>(path: string, form: FormData, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(init?.headers || {});
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await safeFetch(path, { ...init, method: init?.method || "POST", body: form, headers });
  if (res.status === 401) clearAdminToken();
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function viewerAuth(orderId: string, password: string): Promise<{ viewer_token: string; expires_in_minutes: number }> {
  const res = await safeFetch("/api/viewer/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ order_id: orderId, password })
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { viewer_token: string; expires_in_minutes: number };
}

export async function fetchViewerPdf(token: string, attachmentId?: string): Promise<ArrayBuffer> {
  const suffix = attachmentId ? `/${encodeURIComponent(attachmentId)}` : "";
  const res = await safeFetch(`/api/viewer/document/${encodeURIComponent(token)}${suffix}`, {
    method: "GET",
    headers: { "Accept": "application/pdf" }
  });
  if (!res.ok) throw await readError(res);
  return await res.arrayBuffer();
}

export async function fetchViewerMeta(token: string): Promise<ViewerMeta> {
  const res = await safeFetch(`/api/viewer/meta/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as ViewerMeta;
}

export async function downloadViewerPdf(token: string, attachmentId: string, password: string): Promise<Blob> {
  const res = await safeFetch(`/api/viewer/download/${encodeURIComponent(token)}/${encodeURIComponent(attachmentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/pdf" },
    body: JSON.stringify({ password })
  });
  if (!res.ok) throw await readError(res);
  return await res.blob();
}
