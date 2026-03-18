import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/Card";
import Segmented from "../../components/Segmented";
import Spinner from "../../components/Spinner";
import { apiJsonCached } from "../../lib/api";
import type { DashboardAnalytics, DashboardStats } from "../../lib/types";

function fmtMoney(v?: string | number | null) {
  const n = typeof v === "number" ? v : Number(v || 0);
  if (!Number.isFinite(n)) return "-";
  // Keep it simple; backend already returns 2dp decimals.
  return `¥${n.toFixed(2)}`;
}

function Stat(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-4 sm:p-5">
      <div className="text-xs font-semibold tracking-wide text-gray-600">{props.label}</div>
      <div className="mt-2 text-2xl sm:text-3xl font-black text-gray-900">{props.value}</div>
      {props.hint && <div className="mt-2 text-xs text-gray-500 leading-5">{props.hint}</div>}
    </div>
  );
}

function clamp01(x: number) {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function BarRow(props: { label: string; valueText: string; ratio: number; tone?: "brand" | "green" | "amber" }) {
  const r = clamp01(props.ratio);
  const tone = props.tone || "brand";
  const bg =
    tone === "green"
      ? "from-green-500 to-emerald-400"
      : tone === "amber"
        ? "from-amber-500 to-yellow-300"
        : "from-brand-600 to-brand-300";
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <div className="col-span-5 sm:col-span-4 min-w-0">
        <div className="truncate text-sm font-semibold text-gray-900">{props.label}</div>
      </div>
      <div className="col-span-5 sm:col-span-6">
        <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${bg}`} style={{ width: `${Math.round(r * 100)}%` }} />
        </div>
      </div>
      <div className="col-span-2 text-right text-xs font-mono text-gray-700">{props.valueText}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mobileChart, setMobileChart] = useState<"sales" | "revenue" | "refund">("sales");

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([
          apiJsonCached<DashboardStats>("/api/admin/dashboard/stats", 5000),
          apiJsonCached<DashboardAnalytics>("/api/admin/dashboard/analytics", 5000)
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

  const loading = !stats || !analytics;

  const salesCard = (
    <Card title="销量排行" subtitle="按已确认订单数统计（退款不计入）">
      {!analytics ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-6 w-6 text-gray-500" />
          <span className="sr-only">加载中</span>
        </div>
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
  );

  const revenueCard = (
    <Card title="单品收入排行" subtitle="按已确认订单金额汇总（退款不计入）">
      {!analytics ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-6 w-6 text-gray-500" />
          <span className="sr-only">加载中</span>
        </div>
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
                valueText={fmtMoney(x.revenue)}
                ratio={maxRevenue ? v / maxRevenue : 0}
                tone="green"
              />
            );
          })}
        </div>
      )}
    </Card>
  );

  const refundCard = (
    <Card title="退款率" subtitle="按 refunded / total 订单计算">
      {!analytics ? (
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-6 w-6 text-gray-500" />
          <span className="sr-only">加载中</span>
        </div>
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
  );

  return (
    <div className="space-y-5">
      <div className="hidden md:block">
        <div className="text-2xl font-black">数据总览</div>
        <div className="mt-1 text-sm text-gray-600">在线阅读 + 动态水印 + 确认收货后计入收入，退款立刻作废</div>
      </div>

      {err && <div className="glass rounded-2xl px-5 py-4 text-sm text-brand-800 border border-brand-200 bg-brand-50">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="今日确认收入" value={stats ? fmtMoney(stats.today_revenue) : "-"} hint="仅确认收货后计入（按北京时间统计）" />
        <Stat label="今日确认单数" value={stats ? String(stats.today_orders) : "-"} hint="确认后开放下载" />
        <Stat label="累计总收入" value={stats ? fmtMoney(stats.total_revenue) : "-"} hint="排除已退款订单" />
        <Stat label="在售商品数" value={stats ? String(stats.active_products) : "-"} />
        <Stat label="累计退款单数" value={stats ? String(stats.total_refunds) : "-"} />
      </div>

      <div className="md:hidden">
        <div className="glass rounded-2xl shadow-soft p-2">
          <Segmented
            size="sm"
            value={mobileChart}
            options={[
              { value: "sales", label: "销量" },
              { value: "revenue", label: "收入" },
              { value: "refund", label: "退款率" }
            ]}
            onChange={(v: any) => setMobileChart(v)}
          />
        </div>
        <div className="mt-3">
          {mobileChart === "sales" ? salesCard : mobileChart === "revenue" ? revenueCard : refundCard}
        </div>
      </div>

      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-6">
        {salesCard}
        {revenueCard}
        {refundCard}
      </div>

      <Card>
        <details className="text-sm text-gray-700 leading-6">
          <summary className="cursor-pointer select-none text-xs font-semibold tracking-wide text-gray-700">使用建议</summary>
          <div className="mt-3">
            发货成功后建议先在后台预览通知文案，再发送给买家。发现传播风险时，使用“退款”或“重置密码”可立刻阻断访问。
          </div>
          {loading && <div className="mt-3 text-xs text-gray-500">提示: 首次加载较慢属正常，数据会缓存 5 秒。</div>}
        </details>
      </Card>
    </div>
  );
}
