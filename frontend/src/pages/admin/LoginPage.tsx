import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { Input, Label } from "../../components/Field";
import { apiJson } from "../../lib/api";
import { setAdminToken } from "../../lib/storage";

export default function LoginPage() {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center font-black text-xl">研</div>
            <div className="text-left">
              <div className="text-lg font-black tracking-wide">研途LOL</div>
              <div className="text-xs text-gray-600">管理后台登录</div>
            </div>
          </div>
        </div>

        <Card title="登录" subtitle="请输入账号密码进入发货工作台">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr(null);
              setBusy(true);
              try {
                const res = await apiJson<{ access_token: string }>("/api/admin/login", {
                  method: "POST",
                  body: JSON.stringify({ username, password })
                });
                setAdminToken(res.access_token);
                nav("/admin", { replace: true });
              } catch (ex: any) {
                setErr(ex?.message || "登录失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <Label>用户名</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="例如 boss" autoComplete="username" />
            </div>
            <div>
              <Label>密码</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </div>
            {err && <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{err}</div>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "登录中..." : "登录"}
            </Button>

            <div className="text-xs text-gray-600 leading-5">
              开发环境默认账号示例: <code className="rounded bg-white/70 px-1 py-0.5">test_admin / ChangeMe123!</code>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
