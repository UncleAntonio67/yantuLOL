import React, { useEffect, useMemo, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Pagination from "../../components/Pagination";
import { Input, Label, Select } from "../../components/Field";
import { apiJson } from "../../lib/api";
import type { DeliverResponse, Order, OrderPage, Product, SendEmailResponse, TeamMember } from "../../lib/types";

function ensureDisclaimer(text: string, disclaimer: string): string {
  const d = (disclaimer || "").trim();
  if (!d) return text;
  if (text.includes(d)) return text;
  const t = (text || "").trimEnd();
  return `${t}\n\n${d}`;
}

function QrPng({ src }: { src: string }) {
  return <img src={src} alt="QR code" className="h-auto w-full max-w-[240px] rounded-2xl border border-gray-100 bg-white p-2" loading="lazy" />;
}

type ResetResult = { order_id: string; password: string; password_last4: string; password_version: number; copy_text: string };

function fmtDate(dt: any) {
  const s = String(dt || "");
  if (!s) return "-";
  return s.replace("T", " ").slice(0, 16);
}

function shortId(id: string) {
  const s = String(id || "");
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}...${s.slice(-6)}`;
}

async function safeCopy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export default function OrdersPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [operators, setOperators] = useState<TeamMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // mobile tabs
  const [mobileTab, setMobileTab] = useState<"deliver" | "records">("deliver");

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

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  // action menu
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenuFor) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest("[data-menu-root]")) return;
      setOpenMenuFor(null);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [openMenuFor]);

  // deliver form
  const [productId, setProductId] = useState("");
  const [deliverBuyerId, setDeliverBuyerId] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"text" | "email" | "qrcode">("text");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [deliverBusy, setDeliverBusy] = useState(false);
  const [deliverRes, setDeliverRes] = useState<DeliverResponse | null>(null);
  const [notifyText, setNotifyText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailInfo, setEmailInfo] = useState<string | null>(null);

  const [resetRes, setResetRes] = useState<ResetResult | null>(null);

  async function loadBootstrap() {
    setErr(null);
    try {
      const [ps, team] = await Promise.all([apiJson<Product[]>("/api/admin/products"), apiJson<TeamMember[]>("/api/admin/team")]);
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
      const os = await apiJson<OrderPage>(`/api/admin/orders/paged?${params.toString()}`);
      setOrders(os.items);
      setTotal(os.total);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, buyerIdQuery, productFilter, operatorFilter, statusFilter, createdFromQuery, createdToQuery]);

  const activeCount = useMemo(() => orders.filter((o) => o.status === "active").length, [orders]);

  async function doConfirm(orderId: string) {
    if (!confirm("确认已收货并开放下载？确认后将计入营收。")) return;
    setErr(null);
    try {
      await apiJson(`/api/admin/orders/${orderId}/confirm`, { method: "POST" });
      await loadOrders();
    } catch (ex: any) {
      setErr(ex?.message || "确认失败");
    }
  }

  async function doRefund(orderId: string) {
    if (!confirm("确认退款并吊销访问权限？")) return;
    setErr(null);
    try {
      await apiJson(`/api/admin/orders/${orderId}/refund`, { method: "POST" });
      await loadOrders();
    } catch (ex: any) {
      setErr(ex?.message || "退款失败");
    }
  }

  async function doResetPw(orderId: string) {
    setErr(null);
    try {
      const r = await apiJson<ResetResult>(`/api/admin/orders/${orderId}/reset-password`, { method: "POST" });
      setResetRes(r);
      await loadOrders();
      // Password is only shown once, so help operator copy immediately.
      await safeCopy(r.password);
    } catch (ex: any) {
      setErr(ex?.message || "重置失败");
    }
  }

  const headerBlock = (
    <div className="hidden md:flex items-end justify-between">
      <div>
        <div className="text-2xl font-black">发货与售后</div>
        <div className="mt-1 text-sm text-gray-600">发货后仅在线查看不计营收，确认收货后才允许下载并计入营收</div>
      </div>
      <div className="text-xs text-gray-600">本页 active 订单: {activeCount}</div>
    </div>
  );

  const mobileTabs = (
    <div className="md:hidden">
      <div className="glass rounded-2xl p-1 grid grid-cols-2 gap-1">
        <button
          type="button"
          className={["rounded-2xl px-3 py-2 text-sm font-semibold transition", mobileTab === "deliver" ? "bg-white text-gray-900 shadow-soft" : "text-gray-600 hover:bg-white/60"].join(" ")}
          onClick={() => setMobileTab("deliver")}
        >
          新建发货
        </button>
        <button
          type="button"
          className={["rounded-2xl px-3 py-2 text-sm font-semibold transition", mobileTab === "records" ? "bg-white text-gray-900 shadow-soft" : "text-gray-600 hover:bg-white/60"].join(" ")}
          onClick={() => setMobileTab("records")}
        >
          发货记录
        </button>
      </div>
      <div className="mt-2 text-xs text-gray-600">Active 订单: {activeCount}</div>
    </div>
  );

  const deliverPanel = (
    <Card title="新建发货" subtitle="手动创建订单并生成链接与密码">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setDeliverRes(null);
          setErr(null);
          setDeliverBusy(true);
          try {
            const body: any = { product_id: productId, buyer_id: deliverBuyerId, delivery_method: deliveryMethod };
            if (deliveryMethod === "email") body.buyer_email = buyerEmail;
            const res = await apiJson<DeliverResponse>("/api/admin/orders/deliver", {
              method: "POST",
              body: JSON.stringify(body)
            });
            setDeliverRes(res);
            setEmailInfo(null);
            setNotifyText(res.copy_text || "");
            setEmailSubject(res.email_subject || "研途LOL 专属资料在线阅读");
            setEmailBody(res.email_body || res.copy_text || "");
            await safeCopy(res.password);
            if (page !== 1) setPage(1);
            else await loadOrders();
          } catch (ex: any) {
            setErr(ex?.message || "发货失败");
          } finally {
            setDeliverBusy(false);
          }
        }}
      >
        <div>
          <Label>选择商品</Label>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">--请选择--</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>买家ID (用于水印)</Label>
          <Input value={deliverBuyerId} onChange={(e) => setDeliverBuyerId(e.target.value)} placeholder="例如 小红书8899" required />
        </div>
        <div>
          <Label>发货方式</Label>
          <Select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as any)}>
            <option value="text">图文私信文案</option>
            <option value="email">发至邮箱 (SMTP)</option>
            <option value="qrcode">二维码 (同链接)</option>
          </Select>
        </div>
        {deliveryMethod === "email" && (
          <div>
            <Label>买家邮箱</Label>
            <Input value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="buyer@example.com" required />
          </div>
        )}

        <Button type="submit" disabled={deliverBusy} className="w-full">
          {deliverBusy ? "生成中..." : "生成专属资料"}
        </Button>

        {deliverRes && (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-bold text-gray-900">已生成</div>
                <div className="mt-1 text-xs text-gray-600">密码已自动复制到剪贴板（如浏览器限制复制，请手动复制）。</div>
              </div>
              <Button tone="ghost" size="sm" type="button" onClick={() => setDeliverRes(null)}>
                清空
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="break-all">
                <div className="text-xs text-gray-700">在线阅读链接</div>
                <div className="font-mono text-xs text-brand-800">{deliverRes.viewer_url}</div>
              </div>
              <div>
                <div className="text-xs text-gray-700">访问密码</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono font-black text-brand-800 text-lg">{deliverRes.password}</div>
                  <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(deliverRes.password)}>
                    复制密码
                  </Button>
                </div>
              </div>
            </div>

            {deliverRes.delivery_method === "qrcode" && (
              <div className="rounded-2xl border border-brand-200 bg-white/70 p-3">
                <div className="text-xs font-semibold tracking-wide text-gray-700">二维码预览</div>
                <div className="mt-2 flex flex-col sm:flex-row gap-3 sm:items-start">
                  <QrPng src={deliverRes.qrcode_image_url || `/api/viewer/qrcode/${deliverRes.order_id}.png`} />
                  <div className="text-xs text-gray-600 leading-6">
                    扫码将打开阅读链接。出于安全考虑，不建议把密码写进二维码里，密码请单独发送给买家。
                    <div className="mt-2">
                      <Button tone="ghost" size="sm" type="button" onClick={() => window.open(deliverRes.viewer_url, "_blank")}>打开阅读页预览</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {deliverRes.delivery_method === "email" ? (
              <div className="rounded-2xl border border-brand-200 bg-white/70 p-3 space-y-3">
                <div className="text-xs font-semibold tracking-wide text-gray-700">邮件预览 (可编辑)</div>
                {!deliverRes.smtp_configured && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    当前未配置 SMTP，无法直接发送邮件。你仍可编辑内容并复制粘贴到外部邮件客户端发送。
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-700">主题</div>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="邮件主题" />
                </div>
                <div>
                  <div className="text-xs text-gray-700">正文</div>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={7}
                    className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 font-mono"
                  />
                </div>
                {emailInfo && <div className="text-xs text-gray-600">{emailInfo}</div>}
                <div className="flex flex-wrap gap-2">
                  <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(ensureDisclaimer(emailBody, deliverRes.legal_disclaimer))}>
                    复制邮件正文
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    disabled={emailBusy || !deliverRes.smtp_configured}
                    onClick={async () => {
                      setErr(null);
                      setEmailInfo(null);
                      setEmailBusy(true);
                      try {
                        const body = ensureDisclaimer(emailBody, deliverRes.legal_disclaimer);
                        await apiJson<SendEmailResponse>(`/api/admin/orders/${deliverRes.order_id}/send-email`, {
                          method: "POST",
                          body: JSON.stringify({ subject: emailSubject, body })
                        });
                        setEmailInfo("邮件已发送。");
                      } catch (ex: any) {
                        setErr(ex?.message || "发送失败");
                      } finally {
                        setEmailBusy(false);
                      }
                    }}
                  >
                    {emailBusy ? "发送中..." : "发送邮件"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-brand-200 bg-white/70 p-3 space-y-2">
                <div className="text-xs font-semibold tracking-wide text-gray-700">通知文案 (可编辑)</div>
                <textarea
                  value={notifyText}
                  onChange={(e) => setNotifyText(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 font-mono"
                />
                <div className="text-[11px] text-gray-600 leading-5">法律声明将自动附加在末尾，用于降低传播风险。</div>
                <div className="flex flex-wrap gap-2">
                  <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(ensureDisclaimer(notifyText, deliverRes.legal_disclaimer))}>
                    复制文案
                  </Button>
                  <Button tone="ghost" size="sm" type="button" onClick={() => window.open(deliverRes.viewer_url, "_blank")}>打开阅读页</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </form>
    </Card>
  );

  const recordsPanel = (
    <Card title="发货记录 & 售后" subtitle="支持按买家、商品、操作人、日期筛选">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 w-full">
        <div>
          <Label>买家ID</Label>
          <Input value={buyerIdInput} onChange={(e) => setBuyerIdInput(e.target.value)} placeholder="包含匹配" />
        </div>
        <div>
          <Label>商品</Label>
          <Select value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setPage(1); }}>
            <option value="">全部</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>操作人</Label>
          <Select value={operatorFilter} onChange={(e) => { setOperatorFilter(e.target.value); setPage(1); }}>
            <option value="">全部</option>
            {operators.map((u) => (
              <option key={u.id} value={u.id}>{u.nickname}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>开始日期</Label>
          <Input type="date" value={createdFromInput} onChange={(e) => setCreatedFromInput(e.target.value)} />
        </div>
        <div>
          <Label>结束日期</Label>
          <Input type="date" value={createdToInput} onChange={(e) => setCreatedToInput(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button
            tone="ghost"
            className="w-full"
            onClick={() => {
              setBuyerIdQuery(buyerIdInput);
              setCreatedFromQuery(createdFromInput);
              setCreatedToQuery(createdToInput);
              setPage(1);
            }}
          >
            查询
          </Button>
        </div>
        <div>
          <Label>状态</Label>
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">全部</option>
            <option value="active">生效中</option>
            <option value="refunded">已退款</option>
          </Select>
        </div>
        <div className="md:col-span-5 flex items-end">
          <div className="text-[11px] text-gray-600 leading-5">
            系统不保存明文密码。需要再次发送密码时，请使用“重置密码”，新密码会自动复制，且旧密码立即失效。
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 text-sm text-gray-600">加载中...</div>
      ) : orders.length === 0 ? (
        <div className="mt-4 text-sm text-gray-600">暂无订单</div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full table-auto text-left text-sm min-w-[980px]">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-3">订单</th>
                  <th className="px-3 py-3">买家ID</th>
                  <th className="px-3 py-3">商品</th>
                  <th className="px-3 py-3">操作人</th>
                  <th className="px-3 py-3">状态</th>
                  <th className="px-3 py-3">营收</th>
                  <th className="px-3 py-3">后4位</th>
                  <th className="px-3 py-3">创建</th>
                  <th className="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-white/60 align-top">
                    <td className="px-3 py-2 font-mono text-xs" title={o.id}>{shortId(o.id)}</td>
                    <td className="px-3 py-2 font-semibold text-brand-700 truncate" title={o.buyer_id}>{o.buyer_id}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-gray-900 truncate" title={o.product_name}>{o.product_name}</div>
                      <div className="text-[11px] text-gray-500 truncate">发货方式: {o.delivery_method}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{o.operator_nickname}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={o.status === "active" ? "text-green-700" : "text-gray-500"}>{o.status === "active" ? "生效" : "失效"}</span>
                      {o.status === "active" && (
                        <span className={o.is_confirmed ? "ml-2 text-green-700 font-semibold" : "ml-2 text-amber-700 font-semibold"}>
                          {o.is_confirmed ? "已确认" : "待确认"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-900 whitespace-nowrap">{o.is_confirmed && o.status === "active" ? `¥${o.unit_price}` : "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <span>{o.password_last4}</span>
                        <button className="text-[11px] font-semibold text-gray-600 hover:text-brand-700" type="button" onClick={() => void safeCopy(o.password_last4)}>
                          复制
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <div className="relative inline-flex items-center justify-end gap-2" data-menu-root>
                        <Button tone="ghost" size="sm" type="button" onClick={() => window.open(`/view/${o.id}`, "_blank")}>阅读</Button>
                        <Button tone="ghost" size="sm" type="button" onClick={() => setOpenMenuFor((prev) => (prev === o.id ? null : o.id))}>操作</Button>

                        {openMenuFor === o.id && (
                          <div className="absolute right-0 top-[calc(100%+8px)] w-52 rounded-2xl border border-gray-100 bg-white shadow-soft p-2 text-left z-20">
                            <div className="px-2 py-1 text-[11px] text-gray-500">订单 {shortId(o.id)}</div>
                            <div className="mt-1 space-y-1">
                              {o.status === "active" && !o.is_confirmed && (
                                <button
                                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 text-left"
                                  onClick={() => { setOpenMenuFor(null); void doConfirm(o.id); }}
                                >
                                  确认收货
                                </button>
                              )}
                              {o.status === "active" && (
                                <button
                                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 text-left"
                                  onClick={() => { setOpenMenuFor(null); void doRefund(o.id); }}
                                >
                                  退款吊销
                                </button>
                              )}
                              {o.status === "active" && (
                                <button
                                  className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 text-left"
                                  onClick={() => { setOpenMenuFor(null); void doResetPw(o.id); }}
                                >
                                  重置密码并复制
                                </button>
                              )}
                              {o.status !== "active" && (
                                <div className="px-3 py-2 text-xs text-gray-500">该订单已失效</div>
                              )}
                            </div>
                          </div>
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
                    <div className="font-black text-gray-900 truncate">{o.product_name}</div>
                    <div className="mt-1 text-xs text-gray-600">
                      买家ID: <span className="font-semibold text-brand-700 break-all">{o.buyer_id}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 font-mono break-all">{o.id}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={["rounded-lg border px-2 py-1 text-xs font-semibold", o.status === "active" ? "border-green-200 bg-green-50 text-green-800" : "border-gray-200 bg-gray-50 text-gray-600"].join(" ")}
                    >
                      {o.status === "active" ? "生效" : "失效"}
                    </div>
                    {o.status === "active" && (
                      <div className={["mt-2 rounded-lg border px-2 py-1 text-xs font-semibold", o.is_confirmed ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"].join(" ")}
                      >
                        {o.is_confirmed ? "已确认" : "待确认"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-700">
                  <div className="rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
                    <div className="text-[11px] text-gray-500">操作人</div>
                    <div className="mt-1 font-semibold text-gray-900 truncate">{o.operator_nickname}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
                    <div className="text-[11px] text-gray-500">创建</div>
                    <div className="mt-1 font-semibold text-gray-900">{fmtDate(o.created_at)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white/70 px-3 py-2">
                    <div className="text-[11px] text-gray-500">后4位</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-gray-900">{o.password_last4}</span>
                      <button className="text-[11px] font-semibold text-gray-600" type="button" onClick={() => void safeCopy(o.password_last4)}>复制</button>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button tone="ghost" size="sm" type="button" onClick={() => window.open(`/view/${o.id}`, "_blank")}>阅读</Button>
                  {o.status === "active" && !o.is_confirmed && (
                    <Button tone="ghost" size="sm" type="button" onClick={() => void doConfirm(o.id)}>确认收货</Button>
                  )}
                  {o.status === "active" && (
                    <>
                      <Button tone="danger" size="sm" type="button" onClick={() => void doRefund(o.id)}>退款</Button>
                      <Button tone="ghost" size="sm" type="button" onClick={() => void doResetPw(o.id)}>重置并复制</Button>
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
      {headerBlock}
      {mobileTabs}

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={mobileTab === "deliver" ? "block" : "hidden md:block"}>{deliverPanel}</div>
        <div className={mobileTab === "records" ? "block lg:col-span-2" : "hidden md:block lg:col-span-2"}>{recordsPanel}</div>
      </div>

      {resetRes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="glass w-full max-w-lg rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="font-black">已重置密码</div>
              <button className="text-sm text-gray-600 hover:text-brand-700" onClick={() => setResetRes(null)}>
                关闭
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-gray-700">新密码只会显示一次，请立刻复制发送给买家。</div>
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
                <div className="text-xs text-gray-700">订单</div>
                <div className="font-mono text-xs break-all">{resetRes.order_id}</div>
                <div className="mt-2 text-xs text-gray-700">新密码</div>
                <div className="font-mono font-black text-brand-800 text-lg">{resetRes.password}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(resetRes.password)}>
                  复制密码
                </Button>
                <Button tone="ghost" size="sm" type="button" onClick={() => void safeCopy(resetRes.copy_text)}>
                  复制文案
                </Button>
                <Button tone="ghost" size="sm" type="button" onClick={() => window.open(`/view/${resetRes.order_id}`, "_blank")}>打开阅读页</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
