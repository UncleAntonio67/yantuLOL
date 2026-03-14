import React, { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { apiJson } from "../../lib/api";
import { ADMIN_TOKEN_CLEARED_EVENT, clearAdminToken, getAdminToken } from "../../lib/storage";
import type { AdminMe } from "../../lib/types";

function HamburgerIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className || "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function XIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className || "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </svg>
  );
}

function itemClass(isActive: boolean) {
  return [
    "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition",
    isActive ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
  ].join(" ");
}

function roleText(role?: string) {
  return role === "super_admin" ? "超级管理员" : "管理员";
}

export default function AdminShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  // Close drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [loc.pathname]);

  // Prevent background scrolling when drawer is open (mobile).
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  const breadcrumb = useMemo(() => {
    if (loc.pathname.startsWith("/admin/orders")) return "发货与售后";
    if (loc.pathname.startsWith("/admin/products")) return "商品库管理";
    if (loc.pathname.startsWith("/admin/team")) return "团队管理";
    return "数据总览";
  }, [loc.pathname]);

  function logout() {
    clearAdminToken();
    nav("/admin/login", { replace: true });
  }

  function Sidebar(props: { variant: "desktop" | "mobile" }) {
    const cls =
      props.variant === "desktop"
        ? "glass rounded-2xl shadow-soft overflow-hidden h-fit"
        : "h-full w-[280px] bg-white shadow-2xl";

    return (
      <aside className={cls}>
        <div className="px-5 py-5 border-b border-gray-100">
          <Link to="/admin" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-black">研</div>
            <div>
              <div className="text-sm font-black tracking-wide">研途LOL</div>
              <div className="text-xs text-gray-600">自动发货与版权保护</div>
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
            <div className="text-xs text-gray-600">{roleText(me?.role)}</div>
          </div>
          <button className="text-xs font-semibold text-gray-600 hover:text-brand-700" onClick={logout}>
            退出
          </button>
        </div>
      </aside>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass rounded-2xl px-6 py-4 text-sm text-gray-700">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Mobile drawer */}
      <div className={["fixed inset-0 z-50 md:hidden", drawerOpen ? "" : "pointer-events-none"].join(" ")}>
        <div
          className={["absolute inset-0 bg-black/40 transition-opacity", drawerOpen ? "opacity-100" : "opacity-0"].join(" ")}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={[
            "absolute inset-y-0 left-0 transition-transform",
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          ].join(" ")}
        >
          <div className="h-14 px-4 flex items-center justify-between border-b border-gray-100 bg-white">
            <div className="text-sm font-black">菜单</div>
            <button className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-gray-700" onClick={() => setDrawerOpen(false)}>
              <XIcon />
            </button>
          </div>
          <Sidebar variant="mobile" />
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-3 sm:px-4 py-4 sm:py-6">
        {/* Mobile top bar */}
        <div className="md:hidden mb-4">
          <div className="glass rounded-2xl shadow-soft px-4 py-3 flex items-center justify-between">
            <button
              className="rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-gray-800"
              onClick={() => setDrawerOpen(true)}
              aria-label="打开菜单"
            >
              <HamburgerIcon />
            </button>
            <div className="text-sm font-bold text-gray-900 truncate px-3">{breadcrumb}</div>
            <button className="text-xs font-semibold text-gray-600 hover:text-brand-700" onClick={logout}>
              退出
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5 lg:gap-6">
          <div className="hidden md:block">
            <Sidebar variant="desktop" />
          </div>

          <main>
            <div className="hidden md:flex mb-4 items-center justify-between">
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
