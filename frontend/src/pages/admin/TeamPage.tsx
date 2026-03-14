import React, { useEffect, useState } from "react";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { Input, Label, Select } from "../../components/Field";
import { apiJson } from "../../lib/api";
import type { AdminMe, TeamMember } from "../../lib/types";

export default function TeamPage() {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [items, setItems] = useState<TeamMember[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const canCreate = me?.role === "super_admin";

  async function refresh() {
    setErr(null);
    try {
      const [m, t] = await Promise.all([apiJson<AdminMe>("/api/admin/me"), apiJson<TeamMember[]>("/api/admin/team")]);
      if (!Array.isArray(t)) throw new Error("团队列表返回格式错误");
      setMe(m);
      setItems(t);
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-black">团队管理</div>
          <div className="mt-1 text-sm text-gray-600">仅超级管理员可新增管理员账号</div>
        </div>
        {canCreate ? <Button onClick={() => setModalOpen(true)}>新增管理员</Button> : <div />}
      </div>

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((m) => (
            <div key={m.id} className="rounded-2xl border border-gray-100 bg-white/80 p-5">
              <div className="flex items-center justify-between">
                <div className="font-black text-gray-900 truncate">{m.nickname}</div>
                <div className={m.role === "super_admin" ? "text-xs font-bold text-brand-700" : "text-xs text-gray-600"}>
                  {m.role === "super_admin" ? "超级管理员" : "管理员"}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-600">登录名: {m.username}</div>
              <div className="mt-1 text-xs text-gray-600">状态: {m.is_active ? "启用" : "禁用"}</div>
            </div>
          ))}
        </div>
      </Card>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="glass w-full max-w-lg rounded-2xl shadow-soft overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="font-black">新增管理员</div>
              <button className="text-sm text-gray-600 hover:text-brand-700" onClick={() => setModalOpen(false)}>
                关闭
              </button>
            </div>

            <form
              className="p-5 space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setErr(null);
                if (!canCreate) {
                  setErr("只有超级管理员才可以新增账号");
                  return;
                }
                const fd = new FormData(e.currentTarget);
                const body = {
                  username: String(fd.get("username") || ""),
                  password: String(fd.get("password") || ""),
                  nickname: String(fd.get("nickname") || ""),
                  role: String(fd.get("role") || "normal_admin")
                };
                if (body.password.length < 8) {
                  setErr("密码至少 8 位");
                  return;
                }
                try {
                  const created = await apiJson<TeamMember>("/api/admin/team", { method: "POST", body: JSON.stringify(body) });
                  setItems((prev) => [created, ...prev]);
                  setModalOpen(false);
                  void refresh();
                } catch (ex: any) {
                  setErr(ex?.message || "创建失败");
                }
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>登录名</Label>
                  <Input name="username" required placeholder="例如 admin_1" />
                </div>
                <div>
                  <Label>昵称</Label>
                  <Input name="nickname" required placeholder="例如 运营1号" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>密码</Label>
                  <Input name="password" type="password" required placeholder="至少 8 位" />
                </div>
                <div>
                  <Label>角色</Label>
                  <Select name="role" defaultValue="normal_admin">
                    <option value="normal_admin">普通管理员</option>
                    <option value="super_admin">超级管理员</option>
                  </Select>
                </div>
              </div>

              {err && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{err}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <Button tone="ghost" type="button" onClick={() => setModalOpen(false)}>
                  取消
                </Button>
                <Button type="submit">创建</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
