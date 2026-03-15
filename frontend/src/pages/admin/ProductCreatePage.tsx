import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import FilePicker from "../../components/FilePicker";
import { Input, Label, Textarea } from "../../components/Field";
import { apiForm, apiJson } from "../../lib/api";
import { toast } from "../../lib/toast";
import type { AdminMe, Product } from "../../lib/types";

export default function ProductCreatePage() {
  const nav = useNavigate();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);

  const canManage = me?.role === "super_admin";

  useEffect(() => {
    apiJson<AdminMe>("/api/admin/me").then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">新增商品</div>
        <div className="mt-1 text-sm text-gray-600">移动端建议在本页完成上传与配置，避免弹窗操作困难</div>
      </div>
    );
  }, []);

  if (me && !canManage) {
    return (
      <div className="space-y-4">
        {titleBlock}
        <Card>
          <div className="text-sm text-gray-700">当前账号无权限新增商品，请使用超级管理员账号操作。</div>
          <div className="mt-4">
            <Button tone="ghost" onClick={() => nav("/admin/products")}>返回商品库</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        {titleBlock}
        <div className="hidden md:block">
          <Button tone="ghost" onClick={() => nav("/admin/products")}>返回</Button>
        </div>
      </div>

      {err && <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-800">{err}</div>}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setBusy(true);
          try {
            const fd = new FormData(e.currentTarget);
            const cover = fd.get("cover_image_file");
            const coverUrl = String(fd.get("cover_image") || "").trim();
            if (cover instanceof File && cover.size > 0) {
              // backend prefers file; keep url for fallback only
              fd.set("cover_image", "");
            } else if (!coverUrl) {
              fd.delete("cover_image");
            }

            await apiForm<Product>("/api/admin/products", fd);
            toast.success("商品已创建");
            nav("/admin/products", { replace: true });
          } catch (ex: any) {
            setErr(ex?.message || "创建失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title="基础信息" subtitle="名称、描述、价格、状态" className="lg:col-span-2">
            <div className="space-y-4">
              <div>
                <Label>商品名称</Label>
                <Input name="name" required placeholder="例如 2026 研途LOL XX资料包" />
              </div>
              <div>
                <Label>商品描述</Label>
                <Textarea name="description" rows={5} placeholder="建议用 2-4 行描述内容、适用人群、更新频率" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>售价</Label>
                  <Input name="price" type="number" step="0.01" defaultValue="0" required />
                </div>
                <div>
                  <Label>状态</Label>
                  <select
                    name="is_active"
                    defaultValue="true"
                    className="w-full rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200"
                  >
                    <option value="true">上架</option>
                    <option value="false">下架</option>
                  </select>
                </div>
              </div>
            </div>
          </Card>

          <Card title="封面图片" subtitle="可选，用于商品列表展示" className="lg:col-span-1">
            <div className="space-y-3">
              <FilePicker
                name="cover_image_file"
                accept="image/png,image/jpeg,image/webp"
                multiple={false}
                required={false}
                label="上传封面"
                hint="支持 png/jpg/webp，建议 1:1。"
                onFilesChange={(files) => {
                  const f = files[0];
                  if (!f) {
                    setCoverPreviewUrl(null);
                    return;
                  }
                  const url = URL.createObjectURL(f);
                  setCoverPreviewUrl(url);
                }}
              />

              <div>
                <Label>封面 URL (备选)</Label>
                <Input name="cover_image" placeholder="例如 https://.../cover.png" />
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white/80 p-3">
                {coverPreviewUrl ? (
                  <img
                    src={coverPreviewUrl}
                    alt="cover preview"
                    className="w-full aspect-square rounded-xl object-cover border border-gray-100 bg-white"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                    暂无
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card title="PDF 附件" subtitle="支持上传多个，阅读页可切换查看" className="lg:col-span-3">
            <FilePicker
              name="attachments"
              accept="application/pdf"
              multiple
              required
              label="上传 PDF (支持多个)"
              hint="仅支持 PDF。发货后买家可在线查看，不可下载；确认收货后才开放下载。"
            />
          </Card>

          <div className="lg:col-span-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button tone="ghost" type="button" onClick={() => nav("/admin/products")}>取消</Button>
            <Button type="submit" disabled={busy}>{busy ? "创建中..." : "创建商品"}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
