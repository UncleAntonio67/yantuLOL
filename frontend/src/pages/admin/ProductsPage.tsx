import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Pagination from "../../components/Pagination";
import { apiJson } from "../../lib/api";
import type { AdminMe, Product, ProductPage } from "../../lib/types";

function summaryText(s: string, max = 72) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? t.slice(0, max) + "..." : t;
}

export default function ProductsPage() {
  const nav = useNavigate();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const canManage = me?.role === "super_admin";

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">商品库管理</div>
        <div className="mt-1 text-sm text-gray-600">仅支持 PDF 作为源文件，可上传多个附件并在阅读页切换查看</div>
      </div>
    );
  }, []);

  async function refresh() {
    setErr(null);
    setLoading(true);
    try {
      const [m, data] = await Promise.all([
        apiJson<AdminMe>("/api/admin/me"),
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

  async function doDelete(productId: string) {
    if (!confirm("确认删除该商品？若已有订单将无法删除。")) return;
    setErr(null);
    try {
      await apiJson(`/api/admin/products/${productId}`, { method: "DELETE" });
      if (page !== 1 && items.length === 1) setPage((p) => Math.max(1, p - 1));
      else await refresh();
    } catch (ex: any) {
      setErr(ex?.message || "删除失败");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        {titleBlock}
        {canManage ? (
          <Button className="w-full md:w-auto" onClick={() => nav("/admin/products/new")}>新增商品</Button>
        ) : (
          <div className="text-xs text-gray-600">仅超级管理员可新增/编辑商品</div>
        )}
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
              <table className="w-full table-auto text-left text-sm">
                <colgroup>
                  <col className="w-[76px]" />
                  <col className="w-[360px]" />
                  <col className="w-[86px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[80px]" />
                  <col className="w-[160px]" />
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
                        {p.cover_image ? (
                          <img src={p.cover_image} alt={`${p.name} cover`} className="h-12 w-12 rounded-xl object-cover border border-gray-100 bg-white" loading="lazy" />
                        ) : (
                          <div className="h-12 w-12 rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                            无图
                          </div>
                        )}
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
                            <Button tone="danger" size="sm" onClick={() => void doDelete(p.id)}>
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
                      {p.cover_image ? (
                        <img src={p.cover_image} alt={`${p.name} cover`} className="h-12 w-12 rounded-xl object-cover border border-gray-100 bg-white" loading="lazy" />
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
                      <Button tone="danger" size="sm" onClick={() => void doDelete(p.id)}>
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
