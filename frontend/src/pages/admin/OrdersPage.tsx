
import React, { useEffect, useRef, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Segmented from "../../components/Segmented";
import Pagination from "../../components/Pagination";
import ConfirmDialog from "../../components/ConfirmDialog";
import Spinner from "../../components/Spinner";
import { Input, Label } from "../../components/Field";
import SelectMenu from "../../components/SelectMenu";
import { apiJson, apiJsonCached } from "../../lib/api";
import { toast } from "../../lib/toast";
import type { DeliverResponse, Order, OrderPage, Product, TeamMember } from "../../lib/types";

function ensureDisclaimer(text: string, disclaimer: string): string {
  const d = (disclaimer || "").trim();
  if (!d) return text;
  if (text.includes(d)) return text;
  const t = (text || "").trimEnd();
  return `${t}\n\n${d}`;
}

function fmtDateTime(dt: any) {
  const s = String(dt || "");
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}

function fmtDateOnly(dt: any) {
  const s = String(dt || "");
  if (!s) return "-";
  return s.slice(0, 10);
}

function shortId(id: string) {
  const s = String(id || "");
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}...${s.slice(-6)}`;
}

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [operators, setOperators] = useState<TeamMember[]>([]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadSeq = useRef(0);

  // mobile tabs
  const [mobileTab, setMobileTab] = useState<"deliver" | "records">("deliver");

  // deliver form
  const [productId, setProductId] = useState("");
  const [deliverBuyerId, setDeliverBuyerId] = useState("");
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [deliverRes, setDeliverRes] = useState<DeliverResponse | null>(null);
  const [notifyText, setNotifyText] = useState("");

  // filters
  const [buyerIdInput, setBuyerIdInput] = useState("");
  const [buyerIdQuery, setBuyerIdQuery] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [createdFromInput, setCreatedFromInput] = useState("");
  const [createdToInput, setCreatedToInput] = useState("");
  const [createdFromQuery, setCreatedFromQuery] = useState("");
  const [createdToQuery, setCreatedToQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [sortBy, setSortBy] = useState<"created_at" | "unit_price">("created_at");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // dialogs
  const [confirmDlg, setConfirmDlg] = useState<{ kind: "confirm" | "refund"; orderId: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pwDlg, setPwDlg] = useState<{ orderId: string; loading: boolean; password: string; err?: string } | null>(null);
  const [copyDlg, setCopyDlg] = useState<{ title: string; text: string } | null>(null);

  async function safeCopy(text: string, okMsg: string = "已复制") {
    const t = String(text || "");
    if (!t) {
      toast.error("无可复制内容");
      return false;
    }
    try {
      await navigator.clipboard.writeText(t);
      toast.success(okMsg);
      return true;
    } catch {
      setCopyDlg({ title: "手动复制", text: t });
      toast.info("已打开复制弹窗");
      return false;
    }
  }

  function toggleSort(field: "created_at" | "unit_price") {
    if (sortBy !== field) {
      setSortBy(field);
      setSortDir("desc");
      setPage(1);
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    setPage(1);
  }

  function sortArrow(field: "created_at" | "unit_price") {
    if (sortBy !== field) return "";
    return sortDir === "asc" ? "↑" : "↓";
  }

  async function loadBootstrap() {
    setErr(null);
    try {
      const [ps, team] = await Promise.all([
        apiJsonCached<Product[]>("/api/admin/products", 10000),
        apiJsonCached<TeamMember[]>("/api/admin/team", 10000)
      ]);
      setProducts(ps);
      setOperators(team);
      if (!productId && ps.length) setProductId(ps[0].id);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    }
  }

  async function loadOrders() {
    setErr(null);
    setLoading(true);
    const seq = ++loadSeq.current;
    try {
      const params = new URLSearchParams();
      if (buyerIdQuery) params.set("buyer_id", buyerIdQuery);
      if (productFilter) params.set("product_id", productFilter);
      if (operatorFilter) params.set("operator_id", operatorFilter);
      if (statusFilter) params.set("status_filter", statusFilter);
      if (createdFromQuery) params.set("created_from", createdFromQuery);
      if (createdToQuery) params.set("created_to", createdToQuery);
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      params.set("sort_by", sortBy);
      params.set("sort_dir", sortDir);

      const os = await apiJson<OrderPage>(`/api/admin/orders/paged?${params.toString()}`);
      if (seq !== loadSeq.current) return;
      setOrders(os.items);
      setTotal(os.total);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, buyerIdQuery, productFilter, operatorFilter, statusFilter, createdFromQuery, createdToQuery, sortBy, sortDir]);

  useEffect(() => {
    if (!filtersOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [filtersOpen]);

  async function doConfirmNow(orderId: string) {
    setErr(null);
    try {
      const updated = await apiJson<Order>(`/api/admin/orders/${orderId}/confirm`, { method: "POST" });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...updated } : o)));
      toast.success("已确认收货");
    } catch (ex: any) {
      setErr(ex?.message || "确认失败");
    }
  }

  async function doRefundNow(orderId: string) {
    setErr(null);
    try {
      await apiJson(`/api/admin/orders/${orderId}/refund`, { method: "POST" });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "refunded", refunded_at: new Date().toISOString() } : o)));
      toast.success("已吊销凭证（退款）");
    } catch (ex: any) {
      setErr(ex?.message || "吊销失败");
    }
  }

  async function doResetPw(orderId: string) {
    setErr(null);
    try {
      const r = await apiJson<{ order_id: string; password: string }>(`/api/admin/orders/${orderId}/reset-password`, { method: "POST" });
      await safeCopy(r.password, "新密码已复制");
      setCopyDlg({ title: "新密码（仅显示一次）", text: r.password });
      toast.info("请立刻发送新密码给买家，旧密码已失效");
      loadOrders();
    } catch (ex: any) {
      setErr(ex?.message || "重置失败");
    }
  }

  async function showOrderPassword(orderId: string) {
    setPwDlg({ orderId, loading: true, password: "" });
    try {
      const r = await apiJson<{ order_id: string; password: string }>(`/api/admin/orders/${orderId}/password`);
      setPwDlg({ orderId, loading: false, password: r.password });
    } catch (ex: any) {
      setPwDlg({ orderId, loading: false, password: "", err: ex?.message || "无法获取密码（可使用重置密码）" });
    }
  }

  const headerBlock = (
    <div className="hidden md:block">
      <div className="text-2xl font-black">发货与售后</div>
      <div className="mt-1 text-sm text-gray-600">发货后仅在线查看不计营收，确认收货后才允许下载并计入营收</div>
    </div>
  );

  const mobileTabs = (
    <div className="md:hidden">
      <div className="glass rounded-2xl shadow-soft p-2 flex gap-2">
        <button
          type="button"
          className={[
            "rounded-2xl px-3 py-2 text-sm font-semibold transition flex-1",
            mobileTab === "deliver" ? "bg-white text-gray-900 shadow-soft" : "text-gray-600 hover:bg-white/60"
          ].join(" ")}
          onClick={() => setMobileTab("deliver")}
        >
          新建发货
        </button>
        <button
          type="button"
          className={[
            "rounded-2xl px-3 py-2 text-sm font-semibold transition flex-1",
            mobileTab === "records" ? "bg-white text-gray-900 shadow-soft" : "text-gray-600 hover:bg-white/60"
          ].join(" ")}
          onClick={() => setMobileTab("records")}
        >
          发货记录
        </button>
      </div>
    </div>
  );

  const deliverPanel = (
    <Card title="新建发货" subtitle="手动创建订单并生成链接与密码（仅支持图文文案）">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setDeliverRes(null);
          setDeliverBusy(true);
          try {
            const res = await apiJson<DeliverResponse>("/api/admin/orders/deliver", {
              method: "POST",
              body: JSON.stringify({ product_id: productId, buyer_id: deliverBuyerId, delivery_method: "text" })
            });
            setDeliverRes(res);
            setNotifyText(res.copy_text || "");
            await safeCopy(res.password, "密码已复制");
            toast.success("发货信息已生成");
          } catch (ex: any) {
            setErr(ex?.message || "发货失败");
          } finally {
            setDeliverBusy(false);
          }
        }}
      >
        <div>
          <Label>选择商品</Label>
          <SelectMenu
            value={productId}
            onChange={(v) => setProductId(v)}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="请选择商品"
            searchable
          />
        </div>

        <div>
          <Label>买家ID</Label>
          <Input value={deliverBuyerId} onChange={(e) => setDeliverBuyerId(e.target.value)} placeholder="例如 小红书8899" required />
          <div className="mt-1 text-[11px] text-gray-500">将写入动态水印，用于追溯传播。</div>
        </div>

        <Button type="submit" disabled={deliverBusy} className="w-full">
          <span className="inline-flex items-center justify-center gap-2">
            {deliverBusy && <Spinner className="h-4 w-4 text-white" label="生成中" />}
            {deliverBusy ? "生成中" : "生成专属资料"}
          </span>
        </Button>

        {deliverRes && (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-gray-700">在线阅读链接</div>
                <div className="mt-1 font-mono text-xs text-brand-800 break-all">{deliverRes.viewer_url}</div>
              </div>
              <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(deliverRes.viewer_url, "链接已复制")}>复制链接</Button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-700">访问密码</div>
                <div className="mt-1 font-mono font-black text-brand-800 text-lg">{deliverRes.password}</div>
              </div>
              <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(deliverRes.password, "密码已复制")}>复制密码</Button>
            </div>

            <div className="rounded-2xl border border-brand-200 bg-white/70 p-3 space-y-2">
              <div className="text-xs font-semibold tracking-wide text-gray-700">通知文案（可编辑）</div>
              <textarea
                value={notifyText}
                onChange={(e) => setNotifyText(e.target.value)}
                rows={6}
                className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 font-mono"
              />
              <div className="flex flex-wrap gap-2">
                <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(ensureDisclaimer(notifyText, deliverRes.legal_disclaimer), "文案已复制")}>复制文案</Button>
                <Button tone="ghost" size="sm" type="button" onClick={() => window.open(deliverRes.viewer_url, "_blank")}>打开阅读页</Button>
              </div>
              <div className="text-[11px] text-gray-600 leading-5">系统已附加法律声明，用于降低传播风险。</div>
            </div>
          </div>
        )}
      </form>
    </Card>
  );

  const recordsPanel = (
    <Card title="发货记录与售后" subtitle="支持按买家、商品、操作人、日期筛选；支持时间/金额排序">
      <div className="md:hidden sticky top-2 z-20 flex items-center justify-between gap-2 rounded-2xl border border-gray-100 bg-white/80 p-2 backdrop-blur shadow-soft">
        <div className="text-xs text-gray-600">共 {total} 条</div>
        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            value={sortBy}
            options={[
              { value: "created_at", label: "时间" },
              { value: "unit_price", label: "金额" }
            ]}
            onChange={(v: any) => {
              setSortBy(v as any);
              setPage(1);
            }}
          />
          <button
            type="button"
            className="rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-xs font-semibold text-gray-800"
            onClick={() => {
              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            aria-label="toggle sort direction"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <Button tone="ghost" size="sm" type="button" onClick={() => setFiltersOpen(true)}>
            筛选
          </Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 bg-black/30">
          <div className="absolute inset-x-0 bottom-0 max-h-[92vh] glass rounded-t-3xl shadow-soft overflow-hidden">
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-white/80 backdrop-blur">
              <div className="font-black">筛选与排序</div>
              <div className="flex items-center gap-2">
                <button
                  className="text-sm font-semibold text-gray-600 hover:text-brand-700"
                  type="button"
                  onClick={() => {
                    setBuyerIdInput("");
                    setBuyerIdQuery("");
                    setProductFilter("");
                    setOperatorFilter("");
                    setCreatedFromInput("");
                    setCreatedToInput("");
                    setCreatedFromQuery("");
                    setCreatedToQuery("");
                    setStatusFilter("");
                    setSortBy("created_at");
                    setSortDir("desc");
                    setPage(1);
                    setFiltersOpen(false);
                  }}
                >
                  清空
                </button>
                <button className="text-sm font-semibold text-gray-600 hover:text-brand-700" type="button" onClick={() => setFiltersOpen(false)}>
                  关闭
                </button>
              </div>
            </div>

            <div className="p-4 space-y-4 overflow-auto">
              <div>
                <Label>买家ID</Label>
                <Input value={buyerIdInput} onChange={(e) => setBuyerIdInput(e.target.value)} placeholder="包含匹配" />
              </div>

              <div>
                <Label>商品</Label>
                <SelectMenu
                  value={productFilter}
                  onChange={(v) => {
                    setProductFilter(v);
                    setPage(1);
                  }}
                  options={[{ value: "", label: "全部" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
                  placeholder="全部"
                  searchable
                />
              </div>

              <div>
                <Label>操作人</Label>
                <SelectMenu
                  value={operatorFilter}
                  onChange={(v) => {
                    setOperatorFilter(v);
                    setPage(1);
                  }}
                  options={[{ value: "", label: "全部" }, ...operators.map((u) => ({ value: u.id, label: u.nickname }))]}
                  placeholder="全部"
                  searchable
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>开始日期</Label>
                  <Input type="date" value={createdFromInput} onChange={(e) => setCreatedFromInput(e.target.value)} />
                </div>
                <div>
                  <Label>结束日期</Label>
                  <Input type="date" value={createdToInput} onChange={(e) => setCreatedToInput(e.target.value)} />
                </div>
              </div>

              <div>
                <Label>状态</Label>
                <Segmented
                  size="sm"
                  value={(statusFilter || "all") as any}
                  options={[
                    { value: "all", label: "全部" },
                    { value: "active", label: "生效" },
                    { value: "refunded", label: "已吊销" }
                  ]}
                  onChange={(v: any) => {
                    setStatusFilter(v === "all" ? "" : v);
                    setPage(1);
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>排序字段</Label>
                  <Segmented
                    size="sm"
                    value={sortBy}
                    options={[
                      { value: "created_at", label: "时间" },
                      { value: "unit_price", label: "金额" }
                    ]}
                    onChange={(v: any) => {
                      setSortBy(v as any);
                      setPage(1);
                    }}
                  />
                </div>
                <div>
                  <Label>方向</Label>
                  <Segmented
                    size="sm"
                    value={sortDir}
                    options={[
                      { value: "desc", label: "降序" },
                      { value: "asc", label: "升序" }
                    ]}
                    onChange={(v: any) => {
                      setSortDir(v as any);
                      setPage(1);
                    }}
                  />
                </div>
              </div>

              <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/80 backdrop-blur border-t border-gray-100">
                <Button
                  className="w-full"
                  type="button"
                  onClick={() => {
                    setBuyerIdQuery(buyerIdInput);
                    setCreatedFromQuery(createdFromInput);
                    setCreatedToQuery(createdToInput);
                    setPage(1);
                    setFiltersOpen(false);
                  }}
                >
                  应用筛选
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="hidden md:flex flex-wrap items-end gap-3 rounded-2xl border border-gray-100 bg-white/80 p-3 backdrop-blur shadow-soft sticky top-2 z-10">
        <div className="min-w-[200px]">
          <Label>买家ID</Label>
          <Input value={buyerIdInput} onChange={(e) => setBuyerIdInput(e.target.value)} placeholder="包含匹配" />
        </div>
        <div className="min-w-[220px]">
          <Label>商品</Label>
          <SelectMenu
            value={productFilter}
            onChange={(v) => {
              setProductFilter(v);
              setPage(1);
            }}
            options={[{ value: "", label: "全部" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
            placeholder="全部"
            searchable
          />
        </div>
        <div className="min-w-[180px]">
          <Label>操作人</Label>
          <SelectMenu
            value={operatorFilter}
            onChange={(v) => {
              setOperatorFilter(v);
              setPage(1);
            }}
            options={[{ value: "", label: "全部" }, ...operators.map((u) => ({ value: u.id, label: u.nickname }))]}
            placeholder="全部"
            searchable
          />
        </div>
        <div>
          <Label>开始日期</Label>
          <Input type="date" value={createdFromInput} onChange={(e) => setCreatedFromInput(e.target.value)} />
        </div>
        <div>
          <Label>结束日期</Label>
          <Input type="date" value={createdToInput} onChange={(e) => setCreatedToInput(e.target.value)} />
        </div>
        <div>
          <Label>状态</Label>
          <Segmented
            size="sm"
            value={(statusFilter || "all") as any}
            options={[
              { value: "all", label: "全部" },
              { value: "active", label: "生效" },
              { value: "refunded", label: "已吊销" }
            ]}
            onChange={(v: any) => {
              setStatusFilter(v === "all" ? "" : v);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            tone="ghost"
            type="button"
            onClick={() => {
              setBuyerIdQuery(buyerIdInput);
              setCreatedFromQuery(createdFromInput);
              setCreatedToQuery(createdToInput);
              setPage(1);
            }}
          >
            查询
          </Button>
          <div className="text-xs text-gray-600">共 {total} 条</div>
        </div>
      </div>

      {orders.length === 0 && loading ? (
        <div className="mt-6 flex items-center justify-center"><Spinner className="h-6 w-6 text-gray-500" label="加载中" /></div>
      ) : orders.length === 0 ? (
        <div className="mt-6 text-sm text-gray-600">暂无订单</div>
      ) : (
        <div className="mt-4 space-y-3">
          {loading && <div className="flex items-center justify-center"><Spinner className="h-5 w-5 text-gray-500" label="加载中" /></div>}

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full table-auto text-left text-sm min-w-[1100px]">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-3">订单</th>
                  <th className="px-3 py-3">买家</th>
                  <th className="px-3 py-3">商品</th>
                  <th className="px-3 py-3">操作人</th>
                  <th className="px-3 py-3">状态</th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-gray-900" onClick={() => toggleSort("unit_price")}>金额 <span className="text-[11px]">{sortArrow("unit_price")}</span></button>
                  </th>
                  <th className="px-3 py-3">密码</th>
                  <th className="px-3 py-3">
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-gray-900" onClick={() => toggleSort("created_at")}>时间 <span className="text-[11px]">{sortArrow("created_at")}</span></button>
                  </th>
                  <th className="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-white/60 align-middle">
                    <td className="px-3 py-2 font-mono text-xs" title={o.id}>{shortId(o.id)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-700 truncate" title={o.buyer_id}>{o.buyer_id}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gray-900 truncate" title={o.product_name}>{o.product_name}</div>
                      <div className="text-[11px] text-gray-500 truncate">发货方式: 图文文案</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{o.operator_nickname}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={o.status === "active" ? "text-green-700" : "text-gray-500"}>{o.status === "active" ? "生效" : "已吊销"}</span>
                      {o.status === "active" && (
                        <span className={o.is_confirmed ? "ml-2 text-green-700 font-semibold" : "ml-2 text-amber-700 font-semibold"}>{o.is_confirmed ? "已确认" : "待确认"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">{o.is_confirmed && o.status === "active" ? `¥${o.unit_price}` : "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <span>****{o.password_last4}</span>
                        <button className="text-[11px] font-semibold text-gray-600 hover:text-brand-700" type="button" onClick={() => void showOrderPassword(o.id)}>查看</button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{fmtDateTime(o.created_at)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <Button tone="ghost" size="sm" type="button" onClick={() => window.open(`/view/${o.id}`, "_blank")}>阅读</Button>
                        {o.status === "active" && !o.is_confirmed && (
                          <Button tone="ghost" size="sm" type="button" onClick={() => setConfirmDlg({ kind: "confirm", orderId: o.id })}>确认收货</Button>
                        )}
                        {o.status === "active" && (
                          <>
                            <Button tone="danger" size="sm" type="button" onClick={() => setConfirmDlg({ kind: "refund", orderId: o.id })}>吊销</Button>
                            <Button tone="ghost" size="sm" type="button" onClick={() => void doResetPw(o.id)}>重置密码</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-2xl border border-gray-100 bg-white/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-black text-gray-900 truncate" title={o.product_name}>{o.product_name}</div>
                    <div className="mt-1 text-[11px] text-gray-600 truncate">
                      <span className="font-semibold text-brand-700">{o.buyer_id}</span>
                      <span className="text-gray-400"> · </span>
                      <span className="text-gray-700">{o.operator_nickname}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 font-mono">{shortId(o.id)}</div>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    <div className={[
                      "rounded-lg border px-2 py-1 text-[11px] font-semibold",
                      o.status === "active" ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-600"
                    ].join(" ")}
                    >
                      {o.status === "active" ? "生效" : "已吊销"}
                    </div>
                    {o.status === "active" && (
                      <div className={[
                        "rounded-lg border px-2 py-1 text-[11px] font-semibold",
                        o.is_confirmed ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"
                      ].join(" ")}
                      >
                        {o.is_confirmed ? "已确认" : "待确认"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-700">
                  <div className="rounded-xl border border-gray-100 bg-white/70 px-2.5 py-2">
                    <div className="text-gray-500">密码</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-gray-900">****{o.password_last4}</span>
                      <button className="text-[11px] font-semibold text-gray-600 hover:text-brand-700" type="button" onClick={() => void showOrderPassword(o.id)}>查看</button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white/70 px-2.5 py-2">
                    <div className="text-gray-500">日期</div>
                    <div className="mt-1 font-semibold text-gray-900">{fmtDateOnly(o.created_at)}</div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button tone="ghost" size="sm" type="button" onClick={() => window.open(`/view/${o.id}`, "_blank")}>阅读</Button>
                  {o.status === "active" && !o.is_confirmed && (
                    <Button tone="ghost" size="sm" type="button" onClick={() => setConfirmDlg({ kind: "confirm", orderId: o.id })}>确认</Button>
                  )}
                  {o.status === "active" && (
                    <>
                      <Button tone="danger" size="sm" type="button" onClick={() => setConfirmDlg({ kind: "refund", orderId: o.id })}>吊销</Button>
                      <Button tone="ghost" size="sm" type="button" onClick={() => void doResetPw(o.id)}>重置</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={(p) => setPage(p)} className="mt-4" />
    </Card>
  );

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!confirmDlg}
        title={confirmDlg?.kind === "refund" ? "吊销凭证" : "确认收货"}
        message={
          confirmDlg?.kind === "refund"
            ? "确定要吊销该订单凭证吗？吊销后买家将无法继续在线阅读。"
            : "确定要确认收货吗？确认后将开放下载并计入营收。"
        }
        confirmText={confirmDlg?.kind === "refund" ? "确认吊销" : "确认收货"}
        cancelText="取消"
        danger={confirmDlg?.kind === "refund"}
        busy={confirmBusy}
        onClose={() => setConfirmDlg(null)}
        onConfirm={async () => {
          if (!confirmDlg) return;
          setConfirmBusy(true);
          try {
            if (confirmDlg.kind === "confirm") await doConfirmNow(confirmDlg.orderId);
            else await doRefundNow(confirmDlg.orderId);
            setConfirmDlg(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />

      {copyDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="glass w-full max-w-lg rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="font-black">{copyDlg.title}</div>
              <button className="text-sm text-gray-600 hover:text-brand-700" type="button" onClick={() => setCopyDlg(null)}>关闭</button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={copyDlg.text}
                readOnly
                rows={8}
                className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex justify-end gap-2">
                <Button tone="ghost" type="button" onClick={() => void safeCopy(copyDlg.text)}>再次尝试复制</Button>
                <Button type="button" onClick={() => setCopyDlg(null)}>关闭</Button>
              </div>
              <div className="text-[11px] text-gray-600">提示: 如果系统剪贴板被禁用，可长按选中后手动复制。</div>
            </div>
          </div>
        </div>
      )}

      {pwDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="glass w-full max-w-lg rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="font-black">订单密码</div>
              <button className="text-sm text-gray-600 hover:text-brand-700" type="button" onClick={() => setPwDlg(null)}>关闭</button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-gray-600">订单: <span className="font-mono">{pwDlg.orderId}</span></div>
              {pwDlg.loading ? (
                <div className="flex items-center justify-center py-6"><Spinner className="h-6 w-6 text-gray-500" label="加载中" /></div>
              ) : pwDlg.err ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{pwDlg.err}</div>
              ) : (
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                  <div className="text-xs text-gray-700">密码</div>
                  <div className="mt-1 font-mono font-black text-brand-800 text-lg break-all">{pwDlg.password}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button tone="ghost" size="sm" type="button" disabled={pwDlg.loading || !pwDlg.password} onClick={() => void safeCopy(pwDlg.password, "密码已复制")}>复制密码</Button>
                <Button tone="ghost" size="sm" type="button" onClick={() => setPwDlg(null)}>关闭</Button>
              </div>
              <div className="text-[11px] text-gray-600">提示: 若买家反馈密码遗失，建议优先使用“重置密码”，可立刻使旧密码与旧访问令牌失效。</div>
            </div>
          </div>
        </div>
      )}

      {headerBlock}
      {mobileTabs}

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={mobileTab === "deliver" ? "block" : "hidden md:block"}>{deliverPanel}</div>
        <div className={mobileTab === "records" ? "block lg:col-span-2" : "hidden md:block lg:col-span-2"}>{recordsPanel}</div>
      </div>
    </div>
  );
}
