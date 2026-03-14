import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { Input, Label } from "../../components/Field";
import { downloadViewerPdf, fetchViewerMeta, fetchViewerPdf, viewerAuth } from "../../lib/api";
import type { ViewerMeta } from "../../lib/types";
import * as pdfjsLib from "pdfjs-dist";

// Vite: point worker to bundled module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function normalizeViewerError(msg: string) {
  const m = String(msg || "").trim();
  if (!m) return "加载失败";
  if (m.includes("文件尚未上传")) return "该商品文件尚未上传，请联系管理员处理。";
  if (m.includes("文件不存在")) return "文件不存在或已被删除，请联系管理员重新上传。";
  if (m.includes("Invalid password")) return "密码错误";
  if (m.includes("Invalid token")) return "访问已过期，请重新验证";
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
  const [pdfBuf, setPdfBuf] = useState<ArrayBuffer | null>(null);
  const [rendering, setRendering] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const watermarkHint = useMemo(() => {
    return orderId ? `订单 ${orderId} 的专属资料` : "专属资料";
  }, [orderId]);

  const renderScale = useMemo(() => {
    const w = typeof window === "undefined" ? 1024 : window.innerWidth;
    return w < 640 ? 1.05 : 1.35;
  }, []);

  useEffect(() => {
    if (!pdfBuf || !containerRef.current) return;

    (async () => {
      setRendering(true);
      const container = containerRef.current!;
      container.innerHTML = "";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadingTask = (pdfjsLib as any).getDocument({ data: pdfBuf });
      const pdf = await loadingTask.promise;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "w-full rounded-xl border border-gray-100 bg-white";

        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        container.appendChild(canvas);
      }
    })()
      .catch((e) => {
        setErr(normalizeViewerError(String(e?.message || e)));
      })
      .finally(() => {
        setRendering(false);
      });
  }, [pdfBuf, renderScale]);

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
    const onBeforePrint = (e: Event) => {
      e.preventDefault?.();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeprint", onBeforePrint as any);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("beforeprint", onBeforePrint as any);
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
      const buf = await fetchViewerPdf(viewerToken, attId || undefined);
      setPdfBuf(buf);
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
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".pdf") ? filename.replace(/\.pdf$/i, "_download.pdf") : `${filename}_download.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
          <div className="p-6 text-sm text-gray-700">出于版权保护，打印已被禁用。</div>
        </div>

        {!viewerToken ? (
          <div className="max-w-md">
            <Card title="验证访问" subtitle="输入密码后开始在线阅读（退款后会立即失效）">
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
                    const buf = await fetchViewerPdf(res.viewer_token, first || undefined);
                    setPdfBuf(buf);
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
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入管理员提供的密码"
                    required
                    autoComplete="off"
                  />
                </div>
                {err && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{err}</div>}
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "验证中..." : "开始阅读"}
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
                    {meta.product_name} |{" "}
                    {meta.is_confirmed ? "已确认收货，可下载" : "未确认收货，仅可在线查看"}
                  </div>
                  <Button tone="ghost" type="button" onClick={() => void refreshViewer()}>
                    刷新
                  </Button>
                </div>

                {meta.attachments.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {meta.attachments.map((a) => (
                      <button
                        key={a.id}
                        className={[
                          "rounded-xl px-3 py-2 text-xs font-semibold border transition",
                          activeAttachmentId === a.id
                            ? "bg-brand-50 text-brand-700 border-brand-200"
                            : "bg-white/70 text-gray-700 border-gray-200 hover:bg-gray-50"
                        ].join(" ")}
                        onClick={async () => {
                          if (!viewerToken) return;
                          setErr(null);
                          setActiveAttachmentId(a.id);
                          try {
                            const buf = await fetchViewerPdf(viewerToken, a.id);
                            setPdfBuf(buf);
                          } catch (ex: any) {
                            setErr(normalizeViewerError(ex?.message || "加载失败"));
                          }
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
                    <div className="mt-1 text-xs text-gray-600 leading-6">
                      下载文件已加密且写入水印。打开密码与访问密码一致。
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {meta.attachments.map((a) => (
                        <button
                          key={a.id}
                          className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                          onClick={() => void doDownload(a.id, a.filename)}
                          disabled={!!dlBusyId}
                          type="button"
                        >
                          {dlBusyId === a.id ? "生成中..." : `下载: ${a.filename}`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 leading-6">
                    下载暂未开放。需要管理员确认收货后，才会开放下载并计入营收。
                  </div>
                )}
              </div>
            )}

            <div className="glass rounded-2xl p-4" onContextMenu={(e) => e.preventDefault()} tabIndex={0}>
              <div className="mb-3 text-xs text-gray-600">
                已验证。若退款或密码重置，页面将无法继续加载。
              </div>
              {rendering && <div className="mb-3 text-xs text-gray-600">渲染中，请稍候...</div>}
              <div ref={containerRef} className="space-y-4 select-none" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
