import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { apiJson } from "../../lib/api";
import { ADMIN_TOKEN_CLEARED_EVENT, clearAdminToken, getAdminToken } from "../../lib/storage";
import type { AdminMe } from "../../lib/types";

function itemClass(isActive: boolean) {
  return [
    "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition",
    isActive ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
  ].join(" ");
}

export default function AdminShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onTokenCleared = () => nav("/admin/login", { replace: true });
    window.addEventListener(ADMIN_TOKEN_CLEARED_EVENT, onTokenCleared);
    return () => window.removeEventListener(ADMIN_TOKEN_CLEARED_EVENT, onTokenCleared);
  }, [nav]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      nav("/admin/login", { replace: true });
      return;
    }

    (async () => {
      try {
        const data = await apiJson<AdminMe>("/api/admin/me");
        setMe(data);
      } catch {
        clearAdminToken();
        nav("/admin/login", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl px-6 py-4 text-sm text-gray-700">加载中...</div>
      </div>
    );
  }

  const breadcrumb =
    loc.pathname.startsWith("/admin/orders")
      ? "发货与售后"
      : loc.pathname.startsWith("/admin/products")
        ? "商品库管理"
        : loc.pathname.startsWith("/admin/team")
          ? "团队管理"
          : "数据总览";

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
          <aside className="glass rounded-2xl shadow-soft overflow-hidden h-fit">
            <div className="px-5 py-5 border-b border-gray-100">
              <Link to="/admin" className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-black">研</div>
                <div>
                  <div className="text-sm font-black tracking-wide">研途LOL</div>
                  <div className="text-xs text-gray-600">发货与版权保护</div>
                </div>
              </Link>
            </div>

            <nav className="p-3 space-y-2">
              <NavLink to="/admin" end className={({ isActive }) => itemClass(isActive)}>
                数据总览
              </NavLink>
              <NavLink to="/admin/orders" className={({ isActive }) => itemClass(isActive)}>
                发货与售后
              </NavLink>
              <NavLink to="/admin/products" className={({ isActive }) => itemClass(isActive)}>
                商品库管理
              </NavLink>
              <NavLink to="/admin/team" className={({ isActive }) => itemClass(isActive)}>
                团队管理
              </NavLink>
            </nav>

            <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-gray-900">{me?.nickname || "-"}</div>
                <div className="text-xs text-gray-600">{me?.role === "super_admin" ? "超级管理员" : "管理员"}</div>
              </div>
              <button
                className="text-xs font-semibold text-gray-600 hover:text-brand-700"
                onClick={() => {
                  clearAdminToken();
                  nav("/admin/login", { replace: true });
                }}
              >
                退出
              </button>
            </div>
          </aside>

          <main>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs text-gray-600">{breadcrumb}</div>
              <div className="text-xs text-gray-500">后端: /api</div>
            </div>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

