import React, { useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { apiJson } from "../../lib/api";
import type { SystemOverview } from "../../lib/types";

function fmtBytes(n: number) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export default function SystemPage() {
  const [data, setData] = useState<SystemOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setErr(null);
    setBusy(true);
    try {
      const d = await apiJson<SystemOverview>("/api/admin/system/overview");
      setData(d);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">系统监控</div>
        <div className="mt-1 text-sm text-gray-600">查看访问情况、数据库与对象存储概况（仅用于运营监控，不包含敏感密钥）</div>
      </div>
    );
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        {titleBlock}
        <Button tone="ghost" onClick={() => void refresh()} disabled={busy}>
          {busy ? "刷新中..." : "刷新"}
        </Button>
      </div>

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      {!data ? (
        <Card>
          <div className="text-sm text-gray-600">加载中...</div>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-5">
              <div className="text-xs font-semibold tracking-wide text-gray-600">环境</div>
              <div className="mt-2 text-lg font-black text-gray-900">{data.environment}</div>
              <div className="mt-2 text-xs text-gray-500">Server time: {data.server_time}</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-5">
              <div className="text-xs font-semibold tracking-wide text-gray-600">订单总数</div>
              <div className="mt-2 text-3xl font-black text-gray-900">{data.db.orders}</div>
              <div className="mt-2 text-xs text-gray-500">Active: {data.db.active_orders} | Refunded: {data.db.refunded_orders}</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-5">
              <div className="text-xs font-semibold tracking-wide text-gray-600">确认营收</div>
              <div className="mt-2 text-3xl font-black text-gray-900">¥{data.db.confirmed_revenue}</div>
              <div className="mt-2 text-xs text-gray-500">Confirmed orders: {data.db.confirmed_orders}</div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-5">
              <div className="text-xs font-semibold tracking-wide text-gray-600">阅读访问</div>
              <div className="mt-2 text-3xl font-black text-gray-900">{data.db.views_total}</div>
              <div className="mt-2 text-xs text-gray-500">过去 24h 访问订单: {data.db.orders_viewed_24h}</div>
            </div>
          </div>

          <Card title="数据库状态" subtitle="连通性与核心指标">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                <div className="text-xs text-gray-500">连通性</div>
                <div className={data.db.ok ? "mt-1 font-black text-green-700" : "mt-1 font-black text-red-700"}>{data.db.ok ? "OK" : "ERROR"}</div>
                <div className="mt-2 text-xs text-gray-600">Latency: {data.db.latency_ms} ms</div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                <div className="text-xs text-gray-500">商品数</div>
                <div className="mt-1 font-black text-gray-900">{data.db.products}</div>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                <div className="text-xs text-gray-500">最近访问</div>
                <div className="mt-1 font-black text-gray-900">{data.db.last_view_at || "-"}</div>
              </div>
            </div>
          </Card>

          <Card title="对象存储 (R2)" subtitle="统计 source_pdfs/product_images 前缀下的对象数量和体积（近似值，可能截断）">
            {!data.r2.enabled ? (
              <div className="text-sm text-gray-600">当前未启用 R2（使用本地磁盘存储）。</div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-gray-600">Bucket: {data.r2.bucket || "-"}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.r2.prefixes.map((p) => (
                    <div key={p.prefix} className="rounded-2xl border border-gray-100 bg-white/70 p-4">
                      <div className="text-xs font-semibold text-gray-700">{p.prefix}</div>
                      <div className="mt-2 text-sm text-gray-700">Objects: {p.objects}</div>
                      <div className="mt-1 text-sm text-gray-700">Size: {fmtBytes(p.bytes)}</div>
                      {p.truncated && <div className="mt-2 text-[11px] text-amber-700">已截断: 对象过多，统计为近似值</div>}
                    </div>
                  ))}
                </div>
                <div className="text-[11px] text-gray-600 leading-5">
                  系统不会把加密水印后的下载文件写入对象存储。下载文件为实时生成。
                  如需精确容量与费用，请以 Cloudflare 控制台为准。
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
