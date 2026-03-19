import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Spinner from "../../components/Spinner";
import { Input, Label } from "../../components/Field";
import { downloadViewerPdf, fetchViewerMeta, viewerAuth } from "../../lib/api";
import type { ViewerMeta } from "../../lib/types";
import "../../lib/polyfills";

// Lazy-load PDF.js only when needed. This improves initial load performance and
// avoids fragile module evaluation in some mobile WebViews (notably WeChat).
let _pdfjsPromise: Promise<any> | null = null;
async function loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
    // Vite: point worker to bundled module.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod as any).GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    return mod as any;
  });
  return _pdfjsPromise;
}

function normalizeViewerError(msg: string) {
  const m = String(msg || "").trim();
  if (!m) return "加载失败";
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return "网络错误，请稍后重试";
  if (m.startsWith("HTTP 5")) return `服务暂时不可用（${m}）`;
  if (m.includes("getOrInsertComputed")) return "当前浏览器兼容性不足，建议点击“在新窗口打开 PDF”或使用系统浏览器打开";
  if (m.includes("file not found") || m.includes("not found")) return "文件不存在或已被删除，请联系管理员";
  if (m.includes("No readable PDF")) return "该商品暂无可阅读的 PDF 文件，请联系管理员上传";
  if (m.includes("Invalid password")) return "密码错误";
  if (m.includes("Invalid token") || m.includes("Token expired")) return "访问已过期，请重新验证";
  if (m.includes("Unexpected server response")) return "服务异常，请稍后再试";
  return m;
}

export default function ViewerPage() {
  const { orderId } = useParams();
  const [password, setPassword] = useState("");
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<ViewerMeta | null>(null);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dlBusyId, setDlBusyId] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const didRetryRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isWeChat = useMemo(() => {
    try {
      return /MicroMessenger/i.test(navigator.userAgent || "");
    } catch {
      return false;
    }
  }, []);
  // Default to native mode inside WeChat to avoid a "first render" PDF.js attempt.
  const [viewMode, setViewMode] = useState<"native" | "pdfjs">(() => (isWeChat ? "native" : "pdfjs"));

  const pdfUrl = useMemo(() => {
    if (!viewerToken) return null;
    const suffix = activeAttachmentId ? `/${encodeURIComponent(activeAttachmentId)}` : "";
    return `/api/viewer/document/${encodeURIComponent(viewerToken)}${suffix}`;
  }, [viewerToken, activeAttachmentId]);

  const pdfUrlFull = useMemo(() => {
    if (!pdfUrl) return null;
    // Full-content mode avoids Range edge-cases in some built-in PDF viewers.
    return pdfUrl.includes("?") ? `${pdfUrl}&full=1` : `${pdfUrl}?full=1`;
  }, [pdfUrl]);

  // Default to native viewer inside WeChat; pdf.js can be fragile there.
  useEffect(() => {
    if (!viewerToken) return;
    if (!isWeChat) return;
    setViewMode("native");
  }, [viewerToken, isWeChat]);

  const watermarkHint = useMemo(() => {
    return orderId ? `订单 ${orderId} 的专属资料` : "专属资料";
  }, [orderId]);
  // Reset one-time retry when switching to another document.
  useEffect(() => {
    didRetryRef.current = false;
    setRetryNonce(0);
  }, [pdfUrl]);

  // Progressive rendering: render pages lazily when they enter viewport.
  useEffect(() => {
    if (viewMode !== "pdfjs") return;
    if (!pdfUrl || !containerRef.current) return;
    const url = pdfUrl;

    let cancelled = false;
    let io: IntersectionObserver | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdf: any = null;
    let aborter: AbortController | null = null;

    const container = containerRef.current;
    container.innerHTML = "";
    setRendering(true);

    async function createLoadingTask() {
      const pdfjsLib = await loadPdfjs();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getDocument = (pdfjsLib as any).getDocument;

      // WeChat WebView compatibility: it can be fragile with module workers/range requests.
      // Use "data" mode to maximize success rate.
      if (isWeChat) {
        aborter = new AbortController();
        // Force full mode to avoid Range quirks.
        const resp = await fetch(pdfUrlFull || url, { signal: aborter.signal, credentials: "omit" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getDocument({
          data: new Uint8Array(buf),
          disableWorker: true,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true
        }) as any;
      }

      // Prefer url mode so pdf.js can do range fetching (fast on normal browsers).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getDocument({
        url,
        withCredentials: false,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false,
        rangeChunkSize: 1 << 16
      }) as any;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let loadingTask: any = null;

    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadingTask = await createLoadingTask();
      pdf = await loadingTask.promise;
      if (cancelled) return;

      const numPages = Number(pdf.numPages || 0);
      if (!numPages) throw new Error("Invalid PDF: no pages");

      const first = await pdf.getPage(1);
      const vp1 = first.getViewport({ scale: 1 });
      const cw = Math.max(320, container.clientWidth || window.innerWidth || 1024);
      const placeholderScale = Math.min(1.25, Math.max(0.6, (cw / vp1.width) * 0.99));

      // Improve clarity on high DPI screens, but cap for performance.
      const dpr = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));

      const rendered = new Set<number>();
      const inflight = new Map<number, Promise<void>>();
      const placeholderHeight = Math.max(160, Math.floor(vp1.height * placeholderScale));

      const canIO = typeof IntersectionObserver !== "undefined";
      if (canIO) {
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const el = e.target as HTMLDivElement;
              const pageNo = Number(el.dataset.page || "0");
              if (!e.isIntersecting || !pageNo) continue;
              void ensureRender(pageNo);
            }
          },
          { root: null, rootMargin: "900px 0px" }
        );
      }

      function mkPlaceholder(pageNo: number) {
        const wrap = document.createElement("div");
        wrap.dataset.page = String(pageNo);
        wrap.className = "rounded-xl border border-gray-100 bg-white/85 overflow-hidden";
        wrap.style.minHeight = `${placeholderHeight}px`;

        const head = document.createElement("div");
        head.className = "px-3 py-2 text-[11px] text-gray-500";
        head.textContent = `第 ${pageNo} 页`;

        const sk = document.createElement("div");
        sk.className = "h-full w-full animate-pulse";
        sk.style.minHeight = `${Math.max(120, Math.floor(placeholderHeight * 0.55))}px`;
        sk.style.background = "linear-gradient(90deg, rgba(243,244,246,0.65), rgba(255,255,255,0.9), rgba(243,244,246,0.65))";

        wrap.appendChild(head);
        wrap.appendChild(sk);
        return wrap;
      }

      async function ensureRender(pageNo: number) {
        if (cancelled) return;
        if (rendered.has(pageNo)) return;
        const pending = inflight.get(pageNo);
        if (pending) return pending;

        const p = (async () => {
          try {
            const target = container.querySelector(`div[data-page=\"${pageNo}\"]`) as HTMLDivElement | null;
            if (!target || cancelled) return;

            const page = await pdf.getPage(pageNo);
            if (cancelled) return;

            const baseVp = page.getViewport({ scale: 1 });
            // Compute per-page scale so landscape (PPT-style) pages don't overflow and get squashed.
            // Cap zoom-in to avoid huge canvases, but allow zoom-out for very wide slides.
            const cssScale = Math.min(1.25, Math.max(0.55, (cw / baseVp.width) * 0.99));
            const cssViewport = page.getViewport({ scale: cssScale });

            // Render at higher resolution, but cap pixel count to keep wide pages stable.
            let renderScale = cssScale * dpr;
            let renderViewport = page.getViewport({ scale: renderScale });
            const maxPixels = 12_000_000; // ~12MP cap for mobile stability
            const pixels = Number(renderViewport.width) * Number(renderViewport.height);
            if (pixels > maxPixels && pixels > 0) {
              const factor = Math.sqrt(maxPixels / pixels);
              renderScale = Math.max(cssScale, renderScale * factor);
              renderViewport = page.getViewport({ scale: renderScale });
            }

            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(renderViewport.width);
            canvas.height = Math.floor(renderViewport.height);
            canvas.style.display = "block";
            canvas.style.width = `${Math.floor(cssViewport.width)}px`;
            // Preserve aspect ratio when width is constrained by container (avoid stretching/squashing).
            canvas.style.maxWidth = "100%";
            canvas.style.height = "auto";
            canvas.className = "block";

            const ctx = canvas.getContext("2d")!;
            await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

            if (cancelled) return;
            target.innerHTML = "";
            target.appendChild(canvas);
            target.style.minHeight = "";
            rendered.add(pageNo);

            if (pageNo === 1) setRendering(false);
          } finally {
            inflight.delete(pageNo);
          }
        })();

        inflight.set(pageNo, p);
        return p;
      }

      const frag = document.createDocumentFragment();
      const placeholders: HTMLDivElement[] = [];
      for (let i = 1; i <= numPages; i++) {
        const ph = mkPlaceholder(i);
        placeholders.push(ph);
        frag.appendChild(ph);
      }
      container.appendChild(frag);
      if (io) {
        for (const ph of placeholders) io.observe(ph);
      }

      await ensureRender(1);
      if (numPages >= 2) void ensureRender(2);
      if (numPages >= 3) void ensureRender(3);
      if (!io) {
        // Older WebViews: no IO, just render sequentially (best-effort).
        for (let i = 4; i <= numPages; i++) {
          if (cancelled) break;
          // eslint-disable-next-line no-await-in-loop
          await ensureRender(i);
        }
      }
    })()
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e?.message || e);
        // WeChat WebView: if PDF.js fails to initialize (common), fall back to native iframe viewer.
        if (isWeChat && msg.includes("getOrInsertComputed")) {
          setErr("微信内渲染模式兼容性不足，已自动切换到兼容模式。若仍空白，请点击右上角使用系统浏览器打开。");
          setViewMode("native");
          return;
        }
        // Transient 500s can happen due to cold starts or storage hiccups. Retry once.
        if (!didRetryRef.current && msg.includes("Unexpected server response") && msg.includes("500")) {
          didRetryRef.current = true;
          setTimeout(() => setRetryNonce((n) => n + 1), 800);
          return;
        }
        setErr(normalizeViewerError(msg));
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
      try {
        io?.disconnect();
      } catch {
        // ignore
      }
      try {
        aborter?.abort();
      } catch {
        // ignore
      }
      try {
        pdf?.destroy?.();
      } catch {
        // ignore
      }
      try {
        loadingTask.destroy?.();
      } catch {
        // ignore
      }
    };
  }, [pdfUrl, retryNonce]);

  // If the order gets confirmed after the viewer is already open, auto-refresh meta for a short time.
  useEffect(() => {
    if (!viewerToken) return;
    if (!meta) return;
    if (meta.can_download) return;
    let stopped = false;
    const id = window.setInterval(async () => {
      if (stopped) return;
      try {
        const m = await fetchViewerMeta(viewerToken);
        setMeta(m);
        if (m.can_download) {
          stopped = true;
          window.clearInterval(id);
        }
      } catch {
        // ignore
      }
    }, 12_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [viewerToken, meta?.can_download]);

  // Best-effort: block common download/print shortcuts, and make printing blank.
  useEffect(() => {
    if (!viewerToken) return;

    const style = document.createElement("style");
    style.textContent = `
@media print {
  body * { visibility: hidden !important; }
  #viewer-print-block { visibility: visible !important; display: block !important; }
}
`;
    document.head.appendChild(style);

    const onKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "s" || key === "p")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      style.remove();
    };
  }, [viewerToken]);

  async function refreshViewer() {
    if (!viewerToken) return;
    setErr(null);
    try {
      const m = await fetchViewerMeta(viewerToken);
      setMeta(m);
      const attId = activeAttachmentId || m.attachments?.[0]?.id || null;
      setActiveAttachmentId(attId);
    } catch (ex: any) {
      setErr(normalizeViewerError(ex?.message || "刷新失败"));
    }
  }

  async function doDownload(attId: string, filename: string) {
    if (!viewerToken) return;
    if (!password) {
      setErr("请先输入访问密码");
      return;
    }
    setErr(null);
    setDlBusyId(attId);
    try {
      const blob = await downloadViewerPdf(viewerToken, attId, password);
      const url = URL.createObjectURL(blob);

      // WeChat often blocks "download attribute" behavior. Open a new tab as a fallback.
      if (isWeChat) {
        window.open(url, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename.endsWith(".pdf") ? filename.replace(/\.pdf$/i, "_download.pdf") : `${filename}_download.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      if (isWeChat) {
        // Give the new tab time to load the blob URL before revoking it.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        URL.revokeObjectURL(url);
      }
    } catch (ex: any) {
      setErr(normalizeViewerError(ex?.message || "下载失败"));
    } finally {
      setDlBusyId(null);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <div className="text-2xl font-black">在线阅读</div>
          <div className="mt-1 text-sm text-gray-600">{watermarkHint}，已写入专属水印。</div>
        </div>

        {/* Only shown in print */}
        <div id="viewer-print-block" className="hidden">
          <div className="p-6 text-sm text-gray-700">出于版权保护，打印已禁用。</div>
        </div>

        {!viewerToken ? (
          <div className="max-w-md">
            <Card title="验证访问" subtitle="输入密码后开始在线阅读（退款或重置密码会立刻失效）">
              <form
                className="space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!orderId) return;
                  setErr(null);
                  setBusy(true);
                  try {
                    const res = await viewerAuth(orderId, password);
                    setViewerToken(res.viewer_token);
                    const m = await fetchViewerMeta(res.viewer_token);
                    setMeta(m);
                    const first = m.attachments?.[0]?.id || null;
                    setActiveAttachmentId(first);
                  } catch (ex: any) {
                    setErr(normalizeViewerError(ex?.message || "验证失败"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div>
                  <Label>订单号</Label>
                  <Input value={orderId || ""} disabled />
                </div>
                <div>
                  <Label>访问密码</Label>
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入管理员提供的密码" required autoComplete="off" />
                </div>
                {err && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{err}</div>}
                <Button type="submit" disabled={busy} className="w-full">
                  <span className="inline-flex items-center justify-center gap-2">
                    {busy && <Spinner className="h-4 w-4 text-white" label="验证中" />}
                    {busy ? "验证中" : "开始阅读"}
                  </span>
                </Button>
              </form>
            </Card>
          </div>
        ) : (
          <div className="space-y-4">
            {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

            {meta && (
              <div className="glass rounded-2xl p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-xs text-gray-600">
                    {meta.product_name} | {meta.is_confirmed ? "已确认收货，可下载" : "未确认收货，仅在线查看"}
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    {isWeChat && (
                      <Button
                        tone="ghost"
                        type="button"
                        onClick={() => setViewMode((m) => (m === "native" ? "pdfjs" : "native"))}
                        title={viewMode === "native" ? "切换到渲染模式（PDF.js）" : "切换到兼容模式（系统预览）"}
                      >
                        {viewMode === "native" ? "渲染模式" : "兼容模式"}
                      </Button>
                    )}
                    <Button tone="ghost" type="button" onClick={() => void refreshViewer()}>
                      刷新
                    </Button>
                  </div>
                </div>

                {meta.attachments.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {meta.attachments.map((a) => (
                      <button
                        key={a.id}
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-semibold border transition",
                          activeAttachmentId === a.id ? "bg-brand-50 text-brand-700 border-brand-200" : "bg-white/70 text-gray-700 border-gray-200 hover:bg-gray-50"
                        ].join(" ")}
                        onClick={() => {
                          setErr(null);
                          setActiveAttachmentId(a.id);
                          setRendering(true);
                        }}
                        type="button"
                      >
                        {a.filename}
                      </button>
                    ))}
                  </div>
                )}

                {meta.can_download ? (
                  <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-4">
                    <div className="text-xs font-semibold tracking-wide text-gray-700">下载说明</div>
                    <div className="mt-1 text-xs text-gray-600 leading-6">下载文件已加密且写入水印。打开密码与访问密码一致。</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {meta.attachments.map((a) => (
                        <button
                          key={a.id}
                          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                          onClick={() => void doDownload(a.id, a.filename)}
                          disabled={!!dlBusyId}
                          type="button"
                        >
                          <span className="inline-flex items-center gap-2">
                            {dlBusyId === a.id && <Spinner className="h-4 w-4 text-white" label="生成中" />}
                            {dlBusyId === a.id ? "生成中" : `下载: ${a.filename}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 leading-6">
                    下载暂未开放。需管理员确认收货后才会开放下载并计入营收。
                  </div>
                )}
              </div>
            )}

            <div className="glass rounded-2xl p-4" onContextMenu={(e) => e.preventDefault()} tabIndex={0}>
              <div className="mb-3 text-xs text-gray-600">已验证。若退款或密码重置，页面将无法继续加载。</div>

              {viewMode === "native" ? (
                <div className="space-y-3">
                  <div className="text-[11px] text-gray-600 leading-5">
                    当前为兼容模式（系统 PDF 预览）。在微信内通常更稳定；如空白可点击右上角“刷新”或切换到“渲染模式”。
                  </div>
                  {pdfUrl ? (
                    <iframe
                      src={pdfUrlFull || pdfUrl}
                      title="pdf"
                      className="w-full h-[75vh] rounded-xl border border-gray-100 bg-white"
                    />
                  ) : (
                    <div className="flex items-center justify-center py-8">
                      <Spinner className="h-5 w-5 text-gray-500" label="加载中" />
                      <span className="sr-only">加载中</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {rendering && (
                    <div className="mb-3 flex items-center justify-center">
                      <Spinner className="h-5 w-5 text-gray-500" label="渲染中" />
                      <span className="sr-only">渲染中</span>
                    </div>
                  )}
                  {err && pdfUrl && (
                    <div className="mb-3 flex justify-center">
                      <Button tone="ghost" type="button" onClick={() => window.open(pdfUrl, "_blank")}>
                        在新窗口打开 PDF
                      </Button>
                    </div>
                  )}
                  <div ref={containerRef} className="space-y-2 select-none" />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}





