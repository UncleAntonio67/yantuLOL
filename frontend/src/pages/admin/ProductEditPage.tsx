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

  useEffect(() => {
    apiJsonCached<AdminMe>("/api/admin/me", 10000).then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  async function reload() {
    if (!productId) return;
    setErr(null);
    try {
      const d = await apiJson<ProductDetail>(`/api/admin/products/${productId}`);
      setDetail(d);
      setIsActive(String((d as any).is_active) === "false" ? "false" : "true");
    } catch (ex: any) {
      setErr(ex?.message || "鍔犺浇澶辫触");
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const modalCoverSrc = useMemo(() => {
    if (coverPreviewUrl) return coverPreviewUrl;
    return detail?.cover_image || null;
  }, [coverPreviewUrl, detail]);

  const titleBlock = useMemo(() => {
    return (
      <div className="hidden md:block">
        <div className="text-2xl font-black">缂栬緫鍟嗗搧</div>
        <div className="mt-1 text-sm text-gray-600">鍒犻櫎鎿嶄綔宸蹭粠鏈〉绉婚櫎锛岃鍦ㄥ晢鍝佸垪琛ㄤ腑鍒犻櫎</div>
      </div>
    );
  }, []);

  if (!productId) {
    return (
      <Card>
        <div className="text-sm text-gray-700">缂哄皯 productId</div>
      </Card>
    );
  }

  if (me && !canManage) {
    return (
      <div className="space-y-4">
        {titleBlock}
        <Card>
          <div className="text-sm text-gray-700">褰撳墠璐﹀彿鏃犳潈闄愮紪杈戝晢鍝侊紝璇蜂娇鐢ㄨ秴绾х鐞嗗憳璐﹀彿鎿嶄綔銆?/div>
          <div className="mt-4">
            <Button tone="ghost" onClick={() => nav("/admin/products")}>杩斿洖鍟嗗搧搴?/Button>
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
          <Button tone="ghost" onClick={() => nav("/admin/products")}>杩斿洖</Button>
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
          <div className="flex items-center justify-center py-10"><Spinner className="h-6 w-6 text-gray-500" /><span className="sr-only">鍔犺浇涓?..</span></div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title="鍩虹淇℃伅" subtitle="鍚嶇О銆佹弿杩般€佷环鏍笺€佺姸鎬? className="lg:col-span-2">
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
                    name: String(fd.get("name") || ""),
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

                  toast.success("宸蹭繚瀛?);
                  await reload();
                } catch (ex: any) {
                  setErr(ex?.message || "淇濆瓨澶辫触");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div>
                <Label>鍟嗗搧鍚嶇О</Label>
                <Input name="name" defaultValue={detail.name} required />
              </div>
              <div>
                <Label>鍟嗗搧鎻忚堪</Label>
                <Textarea name="description" rows={5} defaultValue={detail.description} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>鍞环</Label>
                  <Input name="price" type="number" step="0.01" defaultValue={String(detail.price)} required />
                </div>
                <div>
                  <Label>鐘舵€?/Label>
                  <input type="hidden" name="is_active" value={isActive} />
                  <Segmented
                    size="sm"
                    value={isActive}
                    options={[
                      { value: "true", label: "\u4e0a\u67b6" },
                      { value: "false", label: "\u4e0b\u67b6" }
                    ]}
                    onChange={(v: any) => setIsActive(v)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-3">
                <div className="text-xs font-semibold tracking-wide text-gray-700">灏侀潰鍥剧墖</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FilePicker
                    name="cover_image_file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple={false}
                    required={false}
                    label="涓婁紶灏侀潰"
                    hint="鏀寔 png/jpg/webp銆?
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
                    <Label>灏侀潰 URL (澶囬€?</Label>
                    <Input name="cover_image" defaultValue={detail.cover_image || ""} placeholder="渚嬪 https://.../cover.png" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input name="clear_cover" type="checkbox" />
                  娓呯┖灏侀潰鍥?
                </label>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button tone="ghost" type="button" onClick={() => nav("/admin/products")}>杩斿洖鍒楄〃</Button>
                <Button type="submit" disabled={busy}>{busy ? "淇濆瓨涓?.." : "淇濆瓨"}</Button>
              </div>
            </form>
          </Card>

          <Card title="灏侀潰棰勮" subtitle="鍒楄〃灞曠ず鏁堟灉" className="lg:col-span-1">
            <div className="rounded-2xl border border-gray-100 bg-white/80 p-3">
              {modalCoverSrc ? (
                <img src={modalCoverSrc} alt="cover preview" className="w-full aspect-square rounded-xl object-cover border border-gray-100 bg-white" />
              ) : (
                <div className="w-full aspect-square rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-white flex items-center justify-center text-xs font-black text-gray-400">
                  鏆傛棤
                </div>
              )}
            </div>
            <div className="mt-3 text-[11px] text-gray-600 leading-5">灏侀潰涓婁紶鍚庝細瑕嗙洊 URL銆傚缓璁娇鐢ㄦ竻鏅扮殑 1:1 鍥剧墖銆?/div>
          </Card>

          <Card title="闄勪欢绠＄悊" subtitle="浠呮敮鎸?PDF锛屽彲杩藉姞鎴栧垹闄? className="lg:col-span-3">
            <div className="space-y-4">
              {detail.attachments.length === 0 ? (
                <div className="text-sm text-gray-600">鏆傛棤闄勪欢</div>
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
                          鍒犻櫎
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
                  label="杩藉姞闄勪欢"
                  hint="浠呮敮鎸?PDF銆備笂浼犲悗涔板闃呰椤靛彲鍒囨崲鏌ョ湅澶氫釜鏂囦欢銆?
                  onFilesChange={async (files) => {
                    if (!files.length) return;
                    setErr(null);
                    setAttBusy(true);
                    try {
                      const fd = new FormData();
                      for (const f of files) fd.append("attachments", f);
                      await apiForm(`/api/admin/products/${detail.id}/attachments`, fd);
                      toast.success("闄勪欢宸蹭笂浼?);
                      await reload();
                    } catch (ex: any) {
                      setErr(ex?.message || "涓婁紶澶辫触");
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

