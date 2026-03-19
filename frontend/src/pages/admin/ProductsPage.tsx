
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import ConfirmDialog from "../../components/ConfirmDialog";
import Spinner from "../../components/Spinner";
import Pagination from "../../components/Pagination";
import { apiJson, apiJsonCached } from "../../lib/api";
import { toast } from "../../lib/toast";
import type { AdminMe, Product, ProductPage } from "../../lib/types";

function summaryText(s: string, max = 72) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max) + "..." : t;
}

function CoverThumb(props: { src?: string | null; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const src = props.src || "";
  const hasSrc = Boolean(src);
  return (
    <div className="h-12 w-12 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white overflow-hidden relative shrink-0">
      {!loaded && hasSrc && <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-gray-100 via-white to-gray-100" />}
      {hasSrc ? (
        <img
          src={src}
          alt={props.alt}
          className={["h-12 w-12 object-cover bg-white transition-opacity", loaded ? "opacity-100" : "opacity-0"].join(" ")}
          loading="lazy"
          decoding="async"
          width={48}
          height={48}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      ) : (
        <div className="h-12 w-12 flex items-center justify-center text-xs font-black text-gray-400">无图</div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const nav = useNavigate();

  const [me, setMe] = useState<AdminMe | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteDlg, setDeleteDlg] = useState<{ productId: string; name: string; orderCount: number } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteInfoBusyId, setDeleteInfoBusyId] = useState<string | null>(null);

  const pageSize = 10;
  const canManage = me?.role === "super_admin";

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">商品库管理</div>
        <div className="mt-1 text-sm text-gray-600">仅支持 PDF 作为源文件，可上传多个附件并在阅读页切换查看。</div>
      </div>
    );
  }, []);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const [m, data] = await Promise.all([
        apiJsonCached<AdminMe>("/api/admin/me", 10000),
        apiJson<ProductPage>(`/api/admin/products/paged?page=${page}&page_size=${pageSize}`)
      ]);
      setMe(m);
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

  async function doDelete(productId: string, name: string) {
    setErr(null);
    setDeleteInfoBusyId(productId);
    try {
      const info = await apiJson<{ product_id: string; order_count: number }>(`/api/admin/products/${productId}/delete-info`);
      setDeleteDlg({ productId, name, orderCount: Number(info.order_count || 0) });
    } catch (ex: any) {
      setErr(ex?.message || "无法获取删除信息");
    } finally {
      setDeleteInfoBusyId(null);
    }
  }

  async function doDeleteConfirmed() {
    if (!deleteDlg) return;
    setErr(null);
    setDeleteBusy(true);
    try {
      const cascade = deleteDlg.orderCount > 0;
      const qs = cascade ? "?cascade_orders=true" : "";
      await apiJson(`/api/admin/products/${deleteDlg.productId}${qs}`, { method: "DELETE" });
      toast.success("已删除商品");
      setDeleteDlg(null);
      if (page !== 1 && items.length === 1) setPage((p) => Math.max(1, p - 1));
      else await refresh();
    } catch (ex: any) {
      setErr(ex?.message || "删除失败");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!deleteDlg}
        title="删除商品"
        message={
          deleteDlg
            ? deleteDlg.orderCount > 0
              ? `该商品关联 ${deleteDlg.orderCount} 条发货记录。确认删除将同时删除这些发货记录（不可恢复）。`
              : `确定要删除商品：${deleteDlg.name} 吗？该操作不可恢复。`
            : ""
        }
        confirmText={deleteDlg && deleteDlg.orderCount > 0 ? "删除商品并删除发货记录" : "确认删除"}
        cancelText="取消"
        danger
        busy={deleteBusy}
        onClose={() => setDeleteDlg(null)}
        onConfirm={() => void doDeleteConfirmed()}
      />

      <div className="flex items-end justify-between gap-3">
        {titleBlock}
        {canManage ? (
          <Button className="w-full md:w-auto" onClick={() => nav("/admin/products/new")}>新增商品</Button>
        ) : (
          <div className="text-xs text-gray-600">仅超级管理员可新增或编辑商品</div>
        )}
      </div>

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Spinner className="h-6 w-6 text-gray-500" label="加载中" /></div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gray-600">暂无商品。建议先新增一个 PDF 商品用于联调。</div>
        ) : (
          <div className="space-y-3">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full table-auto text-left text-sm">
                <colgroup>
                  <col className="w-[76px]" />
                  <col className="w-[360px]" />
                  <col className="w-[86px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[80px]" />
                  <col className="w-[180px]" />
                </colgroup>
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-3">封面</th>
                    <th className="px-3 py-3">商品</th>
                    <th className="px-3 py-3">附件</th>
                    <th className="px-3 py-3">售价</th>
                    <th className="px-3 py-3">确认销量</th>
                    <th className="px-3 py-3">状态</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((p) => (
                    <tr key={p.id} className="hover:bg-white/60 align-top">
                      <td className="px-3 py-3">
                        <CoverThumb src={p.cover_image} alt={`${p.name} cover`} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-gray-900 truncate" title={p.name}>{p.name}</div>
                        <div className="mt-1 text-xs text-gray-600 line-clamp-2">{summaryText(p.description, 140)}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{p.attachment_count}</td>
                      <td className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">CNY {p.price}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{p.sales_count}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={p.is_active ? "text-green-700" : "text-gray-500"}>{p.is_active ? "上架" : "下架"}</span>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <Button tone="ghost" size="sm" onClick={() => nav(`/admin/products/${p.id}/edit`)} disabled={!canManage}>
                            编辑
                          </Button>
                          {canManage && (
                            <Button
                              tone="danger"
                              size="sm"
                              onClick={() => void doDelete(p.id, p.name)}
                              disabled={deleteBusy || deleteInfoBusyId === p.id}
                            >
                              删除
                            </Button>
                          )}
                        </div>
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
                    <CoverThumb src={p.cover_image} alt={`${p.name} cover`} />
                  </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-black text-gray-900 truncate">{p.name}</div>
                      <div className="mt-1 text-xs text-gray-600 line-clamp-2">{summaryText(p.description, 120)}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-gray-700">附件 {p.attachment_count}</span>
                        <span className="rounded-lg border border-gray-200 bg-white/70 px-2 py-1 text-gray-700">确认销量 {p.sales_count}</span>
                        <span className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 font-semibold text-brand-800">CNY {p.price}</span>
                        <span className={["rounded-lg border px-2 py-1 font-semibold", p.is_active ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-600"].join(" ")}
                        >
                          {p.is_active ? "上架" : "下架"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <Button tone="ghost" size="sm" onClick={() => nav(`/admin/products/${p.id}/edit`)} disabled={!canManage}>
                      编辑
                    </Button>
                    {canManage && (
                      <Button
                        tone="danger"
                        size="sm"
                        onClick={() => void doDelete(p.id, p.name)}
                        disabled={deleteBusy || deleteInfoBusyId === p.id}
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={(p) => setPage(p)} className="mt-4" />
      </Card>
    </div>
  );
}
