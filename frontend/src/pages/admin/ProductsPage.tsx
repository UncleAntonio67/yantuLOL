import React, { useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Pagination from "../../components/Pagination";
import { Input, Label, Textarea } from "../../components/Field";
import { apiForm, apiJson } from "../../lib/api";
import type { Product, ProductAttachment, ProductPage } from "../../lib/types";

type ModalState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; product: Product };

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ProductAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  function summaryText(s: string, max = 72) {
    const t = (s || "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    return t.length > max ? t.slice(0, max) + "..." : t;
  }

  useEffect(() => {
    setCoverPreviewUrl(null);
  }, [modal.open, modal.open && modal.mode]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const modalCoverSrc = useMemo(() => {
    if (coverPreviewUrl) return coverPreviewUrl;
    if (modal.open && modal.mode === "edit") return modal.product.cover_image;
    return null;
  }, [coverPreviewUrl, modal]);

  useEffect(() => {
    if (!(modal.open && modal.mode === "edit")) {
      setAttachments([]);
      return;
    }
    void reloadAttachments(modal.product.id);
  }, [modal.open, modal.open && modal.mode === "edit" ? modal.product.id : ""]);

  async function reloadAttachments(productId: string) {
    setErr(null);
    setAttBusy(true);
    try {
      const data = await apiJson<ProductAttachment[]>(`/api/admin/products/${productId}/attachments`);
      setAttachments(data);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    } finally {
      setAttBusy(false);
    }
  }

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const data = await apiJson<ProductPage>(`/api/admin/products/paged?page=${page}&page_size=${pageSize}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-black">商品库管理</div>
          <div className="mt-1 text-sm text-gray-600">仅支持 PDF 作为源文件，可上传多个附件并在阅读页切换查看</div>
        </div>
        <Button onClick={() => setModal({ open: true, mode: "create" })}>新增商品</Button>
      </div>

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <Card>
        {loading ? (
          <div className="text-sm text-gray-600">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gray-600">暂无商品。建议先新增一个 PDF 商品用于联调。</div>
        ) : (
          <div className="space-y-3">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[920px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[84px]" />
                  <col className="w-[360px]" />
                  <col className="w-[80px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[90px]" />
                  <col className="w-[110px]" />
                </colgroup>
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-3">封面</th>
                    <th className="px-3 py-3">商品</th>
                    <th className="px-3 py-3">附件数</th>
                    <th className="px-3 py-3">售价</th>
                    <th className="px-3 py-3">已确认销量</th>
                    <th className="px-3 py-3">状态</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((p) => (
                    <tr key={p.id} className="hover:bg-white/60 align-top">
                      <td className="px-3 py-3">
                        {p.cover_image ? (
                          <img
                            src={p.cover_image}
                            alt={`${p.name} cover`}
                            className="h-12 w-12 rounded-xl object-cover border border-gray-100 bg-white"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                            无图
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-gray-900 truncate">{p.name}</div>
                        <div className="mt-1 text-xs text-gray-600 line-clamp-2">{summaryText(p.description, 120)}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-700">{p.attachment_count}</td>
                      <td className="px-3 py-3 font-semibold text-gray-900">CNY {p.price}</td>
                      <td className="px-3 py-3">{p.sales_count}</td>
                      <td className="px-3 py-3">
                        <span className={p.is_active ? "text-green-700" : "text-gray-500"}>{p.is_active ? "上架" : "下架"}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button tone="ghost" onClick={() => setModal({ open: true, mode: "edit", product: p })}>
                          编辑
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {items.map((p) => (
                <div key={p.id} className="rounded-2xl border border-gray-100 bg-white/80 p-4">
                  <div className="flex gap-3">
                    <div className="shrink-0">
                      {p.cover_image ? (
                        <img
                          src={p.cover_image}
                          alt={`${p.name} cover`}
                          className="h-12 w-12 rounded-xl object-cover border border-gray-100 bg-white"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                          无图
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-gray-900 truncate">{p.name}</div>
                      <div className="mt-1 text-xs text-gray-600 line-clamp-2">{summaryText(p.description, 120)}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-gray-700">附件 {p.attachment_count}</span>
                        <span className="rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-gray-700">已确认销量 {p.sales_count}</span>
                        <span
                          className={[
                            "rounded-lg border px-2 py-1 font-semibold",
                            p.is_active ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-600"
                          ].join(" ")}
                        >
                          {p.is_active ? "上架" : "下架"}
                        </span>
                        <span className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 font-semibold text-brand-800">CNY {p.price}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button tone="ghost" onClick={() => setModal({ open: true, mode: "edit", product: p })}>
                      编辑
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={(p) => setPage(p)} className="mt-4" />
      </Card>

      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="glass w-full max-w-3xl rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="font-black">{modal.mode === "create" ? "新增商品" : "编辑商品"}</div>
              <button className="text-sm text-gray-600 hover:text-brand-700" onClick={() => setModal({ open: false })}>
                关闭
              </button>
            </div>

            <form
              className="p-5 space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setErr(null);
                try {
                  const fd = new FormData(e.currentTarget);
                  if (modal.mode === "create") {
                    const created = await apiForm<Product>("/api/admin/products", fd);
                    const willChange = page !== 1;
                    setPage(1);
                    setModal({ open: false });
                    if (!willChange) void refresh();
                    return;
                  }

                  const coverFile = fd.get("cover_image_file");
                  const coverUrl = String(fd.get("cover_image") || "").trim();
                  const clearCover = String(fd.get("clear_cover") || "") === "on";

                  const patch: any = {
                    name: String(fd.get("name") || ""),
                    description: String(fd.get("description") || ""),
                    price: String(fd.get("price") || "0"),
                    is_active: String(fd.get("is_active") || "true") === "true"
                  };
                  if (clearCover) patch.cover_image = null;
                  else if (coverUrl) patch.cover_image = coverUrl;

                  const updated = await apiJson<Product>(`/api/admin/products/${modal.product.id}`, { method: "PUT", body: JSON.stringify(patch) });
                  let finalProduct = updated;

                  if (coverFile instanceof File && coverFile.size > 0) {
                    const imgFd = new FormData();
                    imgFd.append("cover_image_file", coverFile);
                    finalProduct = await apiForm<Product>(`/api/admin/products/${modal.product.id}/cover-image`, imgFd);
                  }

                  setItems(items.map((x) => (x.id === finalProduct.id ? finalProduct : x)));
                  setModal({ open: false });
                } catch (ex: any) {
                  setErr(ex?.message || "保存失败");
                }
              }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 space-y-4">
                  <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                    <div className="text-xs font-semibold tracking-wide text-gray-700">基础信息</div>
                    <div>
                      <Label>商品名称</Label>
                      <Input name="name" defaultValue={modal.mode === "edit" ? modal.product.name : ""} required placeholder="例如 2026 研途LOL XX资料包" />
                    </div>
                    <div>
                      <Label>商品描述</Label>
                      <Textarea name="description" rows={4} defaultValue={modal.mode === "edit" ? modal.product.description : ""} placeholder="建议用 2-4 行描述内容与适用人群" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>售价</Label>
                        <Input name="price" type="number" step="0.01" defaultValue={modal.mode === "edit" ? modal.product.price : "0"} required />
                      </div>
                      <div>
                        <Label>状态</Label>
                        <select
                          name="is_active"
                          defaultValue={modal.mode === "edit" ? String(modal.product.is_active) : "true"}
                          className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                        >
                          <option value="true">上架</option>
                          <option value="false">下架</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                    <div className="text-xs font-semibold tracking-wide text-gray-700">封面图片 (可选)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>上传封面</Label>
                        <input
                          name="cover_image_file"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="w-full text-sm"
                          onChange={(e) => {
                            const f = e.currentTarget.files?.[0];
                            if (!f) {
                              setCoverPreviewUrl(null);
                              return;
                            }
                            const url = URL.createObjectURL(f);
                            setCoverPreviewUrl(url);
                          }}
                        />
                        <div className="mt-1 text-xs text-gray-500">支持 png/jpg/webp。建议 1:1 方图。</div>
                      </div>
                      <div>
                        <Label>封面 URL (备选)</Label>
                        <Input
                          name="cover_image"
                          defaultValue={modal.mode === "edit" ? modal.product.cover_image || "" : ""}
                          placeholder="例如 https://.../cover.png"
                        />
                        <div className="mt-1 text-xs text-gray-500">如同时上传文件，将优先使用文件。</div>
                      </div>
                    </div>
                    {modal.mode === "edit" && (
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input name="clear_cover" type="checkbox" />
                        清空封面图
                      </label>
                    )}
                  </div>

                  {modal.mode === "create" && (
                    <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                      <div className="text-xs font-semibold tracking-wide text-gray-700">PDF 附件</div>
                      <div>
                        <Label>上传 PDF (支持多个)</Label>
                        <input name="attachments" type="file" accept="application/pdf" multiple required className="w-full text-sm" />
                        <div className="mt-1 text-xs text-gray-500">仅支持 PDF。买家验证后可在线查看多个文件。</div>
                      </div>
                    </div>
                  )}

                  {modal.mode === "edit" && (
                    <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold tracking-wide text-gray-700">附件管理</div>
                        {attBusy && <div className="text-xs text-gray-500">加载中...</div>}
                      </div>

                      {attachments.length === 0 ? (
                        <div className="text-xs text-gray-600">暂无附件</div>
                      ) : (
                        <div className="space-y-2">
                          {attachments
                            .slice()
                            .sort((a, b) => (a.sort_index || 0) - (b.sort_index || 0))
                            .map((a) => (
                              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white/80 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-gray-900">{a.filename}</div>
                                </div>
                                <Button
                                  tone="ghost"
                                  type="button"
                                  onClick={async () => {
                                    if (!confirm("确认删除该附件？")) return;
                                    setErr(null);
                                    try {
                                      await apiJson(`/api/admin/products/${modal.product.id}/attachments/${a.id}`, { method: "DELETE" });
                                      await reloadAttachments(modal.product.id);
                                      await refresh();
                                    } catch (ex: any) {
                                      setErr(ex?.message || "删除失败");
                                    }
                                  }}
                                >
                                  删除
                                </Button>
                              </div>
                            ))}
                        </div>
                      )}

                      <div>
                        <Label>追加附件</Label>
                        <input
                          type="file"
                          accept="application/pdf"
                          multiple
                          className="w-full text-sm"
                          onChange={async (e) => {
                            const files = Array.from(e.currentTarget.files || []);
                            if (!files.length) return;
                            setErr(null);
                            setAttBusy(true);
                            try {
                              const fd = new FormData();
                              for (const f of files) fd.append("attachments", f);
                              await apiForm(`/api/admin/products/${modal.product.id}/attachments`, fd);
                              await reloadAttachments(modal.product.id);
                              await refresh();
                            } catch (ex: any) {
                              setErr(ex?.message || "上传失败");
                            } finally {
                              setAttBusy(false);
                              e.currentTarget.value = "";
                            }
                          }}
                        />
                        <div className="mt-1 text-xs text-gray-500">仅支持 PDF。上传后会加入附件列表。</div>
                      </div>
                    </div>
                  )}

                  {err && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{err}</div>}
                </div>

                <div className="lg:col-span-1 space-y-4">
                  <div className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                    <div className="text-xs font-semibold tracking-wide text-gray-700">封面预览</div>
                    <div className="mt-2 rounded-2xl border border-gray-100 bg-white/80 p-3">
                      {modalCoverSrc ? (
                        <img src={modalCoverSrc} alt="cover preview" className="w-full aspect-square rounded-xl object-cover border border-gray-100 bg-white" />
                      ) : (
                        <div className="w-full aspect-square rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                          暂无
                        </div>
                      )}
                    </div>
                    <div className="mt-3 text-[11px] text-gray-600 leading-5">
                      封面会在商品库列表展示。建议使用清晰的 1:1 图片，便于识别。
                    </div>
                  </div>

                  {modal.mode === "edit" && (
                    <div className="rounded-2xl border border-red-100 bg-red-50/60 p-4">
                      <div className="text-xs font-semibold tracking-wide text-red-800">危险操作</div>
                      <div className="mt-2 text-xs text-red-800/80 leading-5">删除商品会同时删除其源文件。若商品已有订单，将无法删除。</div>
                      <div className="mt-3">
                        <Button
                          tone="danger"
                          type="button"
                          className="w-full"
                          onClick={async () => {
                            if (!confirm("确认删除该商品？若已有订单将无法删除。")) return;
                            setErr(null);
                            try {
                              await apiJson(`/api/admin/products/${modal.product.id}`, { method: "DELETE" });
                              setModal({ open: false });
                              await refresh();
                            } catch (ex: any) {
                              setErr(ex?.message || "删除失败");
                            }
                          }}
                        >
                          删除商品
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button tone="ghost" type="button" onClick={() => setModal({ open: false })}>
                  取消
                </Button>
                <Button type="submit">保存</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

