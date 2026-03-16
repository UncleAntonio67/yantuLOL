import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../../components/Button";
import Card from "../../components/Card";
import ConfirmDialog from "../../components/ConfirmDialog";
import Spinner from "../../components/Spinner";
import Segmented from "../../components/Segmented";
import FilePicker from "../../components/FilePicker";
import { Input, Label, Textarea } from "../../components/Field";
import { apiForm, apiJson, apiJsonCached } from "../../lib/api";
import { toast } from "../../lib/toast";
import type { AdminMe, Product, ProductAttachment, ProductDetail } from "../../lib/types";

export default function ProductEditPage() {
  const nav = useNavigate();
  const { productId } = useParams();

  const [me, setMe] = useState<AdminMe | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attBusy, setAttBusy] = useState(false);

  const [deleteAtt, setDeleteAtt] = useState<ProductAttachment | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<"true" | "false">("true");

  const canManage = me?.role === "super_admin";

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">编辑商品</div>
        <div className="mt-1 text-sm text-gray-600">删除商品请在商品列表中操作；此处仅编辑商品信息与附件。</div>
      </div>
    );
  }, []);

  async function reload() {
    if (!productId) return;
    setErr(null);
    try {
      const [m, d] = await Promise.all([
        apiJsonCached<AdminMe>("/api/admin/me", 10000),
        apiJson<ProductDetail>(`/api/admin/products/${productId}`)
      ]);
      setMe(m);
      setDetail(d);
      setIsActive(d.is_active ? "true" : "false");
    } catch (ex: any) {
      setErr(ex?.message || "加载失败");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Keep a stable preview even before server updates cover.
  const modalCoverSrc = useMemo(() => {
    return coverPreviewUrl || detail?.cover_image || null;
  }, [coverPreviewUrl, detail?.cover_image]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  if (!productId) {
    return (
      <Card>
        <div className="text-sm text-gray-700">缺少 productId</div>
      </Card>
    );
  }

  if (me && !canManage) {
    return (
      <div className="space-y-4">
        {titleBlock}
        <Card>
          <div className="text-sm text-gray-700">当前账号无权限编辑商品，请使用超级管理员账号操作。</div>
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

      <ConfirmDialog
        open={!!deleteAtt}
        title="删除附件"
        message={deleteAtt ? `确定删除附件：${deleteAtt.filename} 吗？` : ""}
        confirmText="确认删除"
        cancelText="取消"
        danger
        busy={attBusy}
        onClose={() => setDeleteAtt(null)}
        onConfirm={async () => {
          if (!detail || !deleteAtt) return;
          setErr(null);
          setAttBusy(true);
          try {
            await apiJson(`/api/admin/products/${detail.id}/attachments/${deleteAtt.id}`, { method: "DELETE" });
            setDeleteAtt(null);
            toast.success("已删除附件");
            await reload();
          } catch (ex: any) {
            setErr(ex?.message || "删除失败");
          } finally {
            setAttBusy(false);
          }
        }}
      />

      {!detail ? (
        <Card>
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-6 w-6 text-gray-500" label="加载中" />
            <span className="sr-only">加载中</span>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title="基础信息" subtitle="名称、描述、价格、状态" className="lg:col-span-2">
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setErr(null);
                setBusy(true);
                try {
                  const fd = new FormData(e.currentTarget);
                  const coverFile = fd.get("cover_image_file");
                  const coverUrl = String(fd.get("cover_image") || "").trim();
                  const clearCover = String(fd.get("clear_cover") || "") === "on";

                  const patch: any = {
                    name: String(fd.get("name") || "").trim(),
                    description: String(fd.get("description") || ""),
                    price: String(fd.get("price") || "0"),
                    is_active: String(fd.get("is_active") || "true") === "true"
                  };

                  if (clearCover) patch.cover_image = null;
                  else if (coverUrl) patch.cover_image = coverUrl;

                  await apiJson<Product>(`/api/admin/products/${detail.id}`, {
                    method: "PUT",
                    body: JSON.stringify(patch)
                  });

                  if (coverFile instanceof File && coverFile.size > 0) {
                    const imgFd = new FormData();
                    imgFd.append("cover_image_file", coverFile);
                    await apiForm<Product>(`/api/admin/products/${detail.id}/cover-image`, imgFd);
                  }

                  toast.success("已保存");
                  await reload();
                } catch (ex: any) {
                  setErr(ex?.message || "保存失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div>
                <Label>商品名称</Label>
                <Input name="name" defaultValue={detail.name} required />
              </div>

              <div>
                <Label>商品描述</Label>
                <Textarea name="description" rows={5} defaultValue={detail.description} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>售价</Label>
                  <Input name="price" type="number" step="0.01" defaultValue={String(detail.price)} required />
                </div>
                <div>
                  <Label>状态</Label>
                  <input type="hidden" name="is_active" value={isActive} />
                  <Segmented
                    size="sm"
                    value={isActive}
                    options={[
                      { value: "true", label: "上架" },
                      { value: "false", label: "下架" }
                    ]}
                    onChange={(v: any) => setIsActive(v)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                <div className="text-xs font-semibold tracking-wide text-gray-700">封面图片</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FilePicker
                    name="cover_image_file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple={false}
                    required={false}
                    label="上传封面"
                    hint="支持 png/jpg/webp。"
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
                    <Label>封面 URL（可选）</Label>
                    <Input name="cover_image" defaultValue={detail.cover_image || ""} placeholder="例如 https://.../cover.png" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input name="clear_cover" type="checkbox" />
                  清空封面图
                </label>
                <div className="text-[11px] text-gray-600 leading-5">提示: 封面上传会覆盖 URL；如需移除封面请勾选“清空封面图”。</div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button tone="ghost" type="button" onClick={() => nav("/admin/products")}>返回列表</Button>
                <Button type="submit" disabled={busy}>
                  <span className="inline-flex items-center gap-2">
                    {busy && <Spinner className="h-4 w-4 text-white" label="保存中" />}
                    {busy ? "保存中" : "保存"}
                  </span>
                </Button>
              </div>
            </form>
          </Card>

          <Card title="封面预览" subtitle="列表展示效果" className="lg:col-span-1">
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-3">
              {modalCoverSrc ? (
                <img src={modalCoverSrc} alt="cover preview" className="w-full aspect-square rounded-xl object-cover border border-gray-100 bg-white" />
              ) : (
                <div className="w-full aspect-square rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                  暂无
                </div>
              )}
            </div>
            <div className="mt-3 text-[11px] text-gray-600 leading-5">建议使用清晰的 1:1 图片作为封面。</div>
          </Card>

          <Card title="附件管理" subtitle="仅支持 PDF，可追加或删除" className="lg:col-span-3">
            <div className="space-y-4">
              {detail.attachments.length === 0 ? (
                <div className="text-sm text-gray-600">暂无附件</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {detail.attachments
                    .slice()
                    .sort((a, b) => (a.sort_index || 0) - (b.sort_index || 0))
                    .map((a: ProductAttachment) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white/80 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-gray-900" title={a.filename}>{a.filename}</div>
                          <div className="mt-1 text-[11px] text-gray-500 font-mono">{a.id}</div>
                        </div>
                        <Button
                          tone="danger"
                          size="sm"
                          type="button"
                          disabled={attBusy}
                          onClick={() => setDeleteAtt(a)}
                        >
                          删除
                        </Button>
                      </div>
                    ))}
                </div>
              )}

              <div>
                <FilePicker
                  name="__unused__"
                  accept="application/pdf"
                  multiple
                  required={false}
                  label="追加附件"
                  hint="仅支持 PDF。上传后买家阅读页可切换查看多个文件。"
                  onFilesChange={async (files) => {
                    if (!files.length) return;
                    setErr(null);
                    setAttBusy(true);
                    try {
                      const fd = new FormData();
                      for (const f of files) fd.append("attachments", f);
                      await apiForm(`/api/admin/products/${detail.id}/attachments`, fd);
                      toast.success("附件已上传");
                      await reload();
                    } catch (ex: any) {
                      setErr(ex?.message || "上传失败");
                    } finally {
                      setAttBusy(false);
                    }
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
