import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/Card";
import { apiJson } from "../../lib/api";
import type { DashboardAnalytics, DashboardStats } from "../../lib/types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-5">
      <div className="text-xs font-semibold tracking-wide text-gray-600">{label}</div>
      <div className="mt-2 text-3xl font-black text-gray-900">{value}</div>
      {hint && <div className="mt-2 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

function clamp01(x: number) {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function BarRow({
  label,
  valueText,
  ratio,
  tone = "brand"
}: {
  label: string;
  valueText: string;
  ratio: number;
  tone?: "brand" | "green" | "amber";
}) {
  const r = clamp01(ratio);
  const bg =
    tone === "green"
      ? "from-green-500 to-emerald-400"
      : tone === "amber"
        ? "from-amber-500 to-yellow-300"
        : "from-brand-600 to-brand-300";
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <div className="col-span-5 sm:col-span-4 min-w-0">
        <div className="truncate text-sm font-semibold text-gray-900">{label}</div>
      </div>
      <div className="col-span-5 sm:col-span-6">
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${bg}`} style={{ width: `${Math.round(r * 100)}%` }} />
        </div>
      </div>
      <div className="col-span-2 text-right text-xs font-mono text-gray-700">{valueText}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([
          apiJson<DashboardStats>("/api/admin/dashboard/stats"),
          apiJson<DashboardAnalytics>("/api/admin/dashboard/analytics")
        ]);
        setStats(s);
        setAnalytics(a);
      } catch (ex: any) {
        setErr(ex?.message || "加载失败");
      }
    })();
  }, []);

  const maxSales = useMemo(() => {
    const arr = analytics?.sales_ranking || [];
    return arr.reduce((m, x) => Math.max(m, x.sales), 0) || 0;
  }, [analytics]);

  const maxRevenue = useMemo(() => {
    const arr = analytics?.revenue_ranking || [];
    return arr.reduce((m, x) => Math.max(m, Number(x.revenue || 0)), 0) || 0;
  }, [analytics]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div className="hidden md:block">
          <div className="text-2xl font-black">数据总览</div>
          <div className="mt-1 text-sm text-gray-600">方案 B：在线阅读链接 + 动态水印 + 退款即时吊销</div>
        </div>
      </div>

      {err && <div className="glass rounded-2xl px-5 py-4 text-sm text-brand-800 border border-brand-200 bg-brand-50">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="今日确认营收" value={stats ? `¥${stats.today_revenue}` : "-"} hint="仅确认收货后计入" />
        <Stat label="今日确认单数" value={stats ? String(stats.today_orders) : "-"} hint="发货后需确认收货" />
        <Stat label="在售商品数" value={stats ? String(stats.active_products) : "-"} />
        <Stat label="累计退款单数" value={stats ? String(stats.total_refunds) : "-"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="销量排行" subtitle="按已确认订单数统计（退款不计入）">
          {!analytics ? (
            <div className="text-sm text-gray-600">加载中...</div>
          ) : analytics.sales_ranking.length === 0 ? (
            <div className="text-sm text-gray-600">暂无数据</div>
          ) : (
            <div className="space-y-3">
              {analytics.sales_ranking.map((x) => (
                <BarRow key={x.product_id} label={x.product_name} valueText={String(x.sales)} ratio={maxSales ? x.sales / maxSales : 0} />
              ))}
            </div>
          )}
        </Card>

        <Card title="单品收入排行" subtitle="按已确认订单金额汇总（退款不计入）">
          {!analytics ? (
            <div className="text-sm text-gray-600">加载中...</div>
          ) : analytics.revenue_ranking.length === 0 ? (
            <div className="text-sm text-gray-600">暂无数据</div>
          ) : (
            <div className="space-y-3">
              {analytics.revenue_ranking.map((x) => {
                const v = Number(x.revenue || 0);
                return (
                  <BarRow
                    key={x.product_id}
                    label={x.product_name}
                    valueText={`¥${x.revenue}`}
                    ratio={maxRevenue ? v / maxRevenue : 0}
                    tone="green"
                  />
                );
              })}
            </div>
          )}
        </Card>

        <Card title="退款率" subtitle="按 refunded / total 订单计算">
          {!analytics ? (
            <div className="text-sm text-gray-600">加载中...</div>
          ) : analytics.refund_rate_by_product.length === 0 ? (
            <div className="text-sm text-gray-600">暂无数据</div>
          ) : (
            <div className="space-y-3">
              {analytics.refund_rate_by_product.map((x) => (
                <BarRow
                  key={x.product_id}
                  label={x.product_name}
                  valueText={`${Math.round(clamp01(x.refund_rate) * 100)}%`}
                  ratio={clamp01(x.refund_rate)}
                  tone="amber"
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="使用建议" subtitle="降低传播风险的常用操作">
        <div className="text-sm text-gray-700 leading-6">
          发货成功后，建议先在后台预览通知文案或邮件正文，再发送给买家。发现泄露风险时，使用“退款吊销”或“重置密码”可立刻阻断访问。
        </div>
      </Card>
    </div>
  );
}
