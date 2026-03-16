from __future__ import annotations

from datetime import datetime, timezone
import base64
import hashlib
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.storage import storage
from app.core.security import create_viewer_token, decode_token, verify_password
from app.db.session import get_db
from app.models.models import Order, OrderStatus, Product, ProductAttachment
from app.schemas.schemas import (
    ViewerAttachmentOut,
    ViewerAuthRequest,
    ViewerAuthResponse,
    ViewerDownloadRequest,
    ViewerMetaResponse,
)
from app.utils.qr_png import make_qr_png_bytes
from app.utils.public_url import public_frontend_base_url
from app.utils.secure_pdf import watermark_encrypt_pdf_bytes
from app.utils.watermark import watermark_pdf_bytes


router = APIRouter()
# Watermarked PDF cache (in-memory, per instance).
# We do NOT persist watermarked/encrypted outputs to disk or object storage.
# This cache exists solely to reduce repeated watermark CPU cost during short time windows.
_WM_CACHE_TTL_S = 300.0
_WM_CACHE_MAX_ITEMS = 12
_wm_cache: "OrderedDict[tuple[str, str, str], tuple[float, bytes]]" = OrderedDict()


def _wm_cache_get(key: tuple[str, str, str]) -> bytes | None:
    now = time.time()
    item = _wm_cache.get(key)
    if not item:
        return None
    ts, data = item
    if (now - ts) > _WM_CACHE_TTL_S:
        try:
            del _wm_cache[key]
        except Exception:
            pass
        return None
    try:
        _wm_cache.move_to_end(key)
    except Exception:
        pass
    return data


def _wm_cache_put(key: tuple[str, str, str], data: bytes) -> None:
    now = time.time()
    _wm_cache[key] = (now, data)
    try:
        _wm_cache.move_to_end(key)
    except Exception:
        pass
    while len(_wm_cache) > _WM_CACHE_MAX_ITEMS:
        try:
            _wm_cache.popitem(last=False)
        except Exception:
            break


def _decode_viewer_token(viewer_token: str) -> tuple[str, int]:
    try:
        payload = decode_token(viewer_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("typ") != "viewer":
        raise HTTPException(status_code=401, detail="Invalid token type")

    order_id = payload.get("sub")
    pv = payload.get("pv")
    if not order_id or pv is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return str(order_id), int(pv)


def _load_active_order(order_id: str, pv: int, db: Session) -> Order:
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status != OrderStatus.active:
        raise HTTPException(status_code=403, detail="Order is not active")
    if int(o.password_version) != int(pv):
        raise HTTPException(status_code=401, detail="Token expired")
    return o


def _ensure_primary_attachment(*, product: Product, db: Session) -> None:
    if not product.source_pdf_path or str(product.source_pdf_path).startswith('__'):
        return
    has_any = (
        db.scalar(select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == product.id)) or 0
    )
    if int(has_any) > 0:
        return
    filename = Path(product.source_pdf_path or "").name or f"{product.id}.pdf"
    db.add(
        ProductAttachment(
            product_id=product.id,
            filename=filename,
            file_path=product.source_pdf_path,
            sort_index=0,
        )
    )
    db.commit()


def _list_attachments(*, product: Product, db: Session) -> list[ProductAttachment]:
    _ensure_primary_attachment(product=product, db=db)
    return (
        db.scalars(
            select(ProductAttachment)
            .where(ProductAttachment.product_id == product.id)
            .order_by(ProductAttachment.sort_index.asc(), ProductAttachment.created_at.asc())
        ).all()
        or []
    )


def _download_password(*, order_id: str, pv: int) -> str:
    """
    Deprecated: previously used a derived password for downloads.

    Current product behavior is:
    - viewer access password: generated at delivery and shown once
    - download PDF open password (after confirm): equals viewer access password
    """
    settings = get_settings()
    seed = f"{settings.jwt_secret_key}|{order_id}|{pv}".encode("utf-8")
    digest = hashlib.sha256(seed).digest()
    return base64.b32encode(digest).decode("ascii").rstrip("=").lower()[:10]


def _find_attachment_path(atts: list[ProductAttachment], attachment_id: str) -> tuple[str, str]:
    for a in atts:
        if a.id == attachment_id:
            return a.file_path, a.filename
    raise HTTPException(status_code=404, detail="Attachment not found")


@router.post("/auth", response_model=ViewerAuthResponse)
def viewer_auth(payload: ViewerAuthRequest, db: Session = Depends(get_db)) -> ViewerAuthResponse:
    settings = get_settings()
    o = db.get(Order, payload.order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status != OrderStatus.active:
        raise HTTPException(status_code=403, detail="Order is not active")
    pw = (payload.password or "").strip()
    if not verify_password(pw, o.access_password_hash):
        raise HTTPException(status_code=401, detail="Invalid password")

    token = create_viewer_token(order_id=o.id, password_version=o.password_version)
    return ViewerAuthResponse(viewer_token=token, expires_in_minutes=settings.viewer_token_expire_minutes)


@router.get("/meta/{viewer_token}", response_model=ViewerMetaResponse)
def viewer_meta(viewer_token: str, db: Session = Depends(get_db)) -> ViewerMetaResponse:
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    atts = _list_attachments(product=p, db=db)
    is_confirmed = bool(o.confirmed_at)
    can_download = is_confirmed

    return ViewerMetaResponse(
        order_id=o.id,
        product_name=p.name,
        is_confirmed=is_confirmed,
        can_download=can_download,
        # Downloaded PDFs use the same open password as viewer access password.
        download_password=None,
        attachments=[ViewerAttachmentOut(id=a.id, filename=a.filename) for a in atts],
    )


@router.get("/document/{viewer_token}")
def viewer_document_default(viewer_token: str, request: Request, db: Session = Depends(get_db)) -> Response:
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    atts = _list_attachments(product=p, db=db)
    if not atts:
        raise HTTPException(status_code=404, detail="濞屸剝婀侀崣顖炴鐠囪崵娈戦弬鍥︽")
    return viewer_document(viewer_token=viewer_token, attachment_id=atts[0].id, request=request, db=db)


@router.get("/document/{viewer_token}/{attachment_id}")
def viewer_document(viewer_token: str, attachment_id: str, request: Request, db: Session = Depends(get_db)) -> Response:
    settings = get_settings()
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    atts = _list_attachments(product=p, db=db)
    file_path, filename = _find_attachment_path(atts, attachment_id)

    if not file_path or str(file_path).startswith('__'):
        raise HTTPException(status_code=404, detail="No readable PDF attachment")

    # pdf.js may issue multiple HTTP Range requests for a single view.
    # Count a view only for the initial chunk, and at most once per 30s per order.
    range_hdr = request.headers.get("range") or request.headers.get("Range")
    try_count = True
    if range_hdr:
        rh = str(range_hdr).strip().lower()
        try_count = rh.startswith("bytes=0-") or (rh == "bytes=0")

    try:
        if try_count:
            now_dt = datetime.now(timezone.utc)
            last = o.last_view_at
            if not last or (now_dt - last).total_seconds() > 30:
                o.view_count = int(o.view_count) + 1
                o.last_view_at = now_dt
                db.add(o)
                db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    watermark_text = f"{o.buyer_id} | {o.id}"
    font_file = settings.resolved_watermark_font_file()
    cache_key = (str(file_path), str(watermark_text), str(font_file or ""))
    out = _wm_cache_get(cache_key)
    if out is None:
        try:
            src, _ = storage.get_bytes(file_path)
        except Exception:
            raise HTTPException(status_code=404, detail="PDF file not found in storage")
        out = watermark_pdf_bytes(pdf_bytes=src, watermark_text=watermark_text, font_file=font_file)
        _wm_cache_put(cache_key, out)

    headers = {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{Path(filename).name}"',
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Accept-Ranges": "bytes",
    }

    total = len(out)
    if range_hdr:
        rh = str(range_hdr).strip().lower()
        if rh.startswith("bytes="):
            spec = rh[len("bytes="):]
            if "," not in spec:
                start_s, _, end_s = spec.partition("-")
                try:
                    start = int(start_s) if start_s else 0
                except Exception:
                    start = 0
                try:
                    end = int(end_s) if end_s else (total - 1)
                except Exception:
                    end = total - 1
                start = max(0, start)
                if total <= 0 or start >= total:
                    h = dict(headers)
                    h["Content-Range"] = f"bytes */{total}"
                    return Response(status_code=416, media_type="application/pdf", headers=h)
                end = min(total - 1, max(start, end))
                chunk = out[start:end + 1]
                h = dict(headers)
                h["Content-Range"] = f"bytes {start}-{end}/{total}"
                h["Content-Length"] = str(len(chunk))
                return Response(content=chunk, status_code=206, media_type="application/pdf", headers=h)

    headers["Content-Length"] = str(total)
    return Response(content=out, media_type="application/pdf", headers=headers)


@router.get("/download/{viewer_token}/{attachment_id}")
def viewer_download_get_deprecated(viewer_token: str, attachment_id: str, db: Session = Depends(get_db)) -> Response:
    # New behavior requires POST with password so the PDF open password equals access password.
    raise HTTPException(
        status_code=405, detail="Use POST /api/viewer/download/{viewer_token}/{attachment_id} with password"
    )


@router.post("/download/{viewer_token}/{attachment_id}")
def viewer_download(
    viewer_token: str, attachment_id: str, payload: ViewerDownloadRequest, db: Session = Depends(get_db)
) -> Response:
    settings = get_settings()
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    if not o.confirmed_at:
        raise HTTPException(status_code=403, detail="Download is not enabled yet")

    pw = (payload.password or "").strip()
    if not verify_password(pw, o.access_password_hash):
        raise HTTPException(status_code=401, detail="Invalid password")

    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    atts = _list_attachments(product=p, db=db)
    file_path, filename = _find_attachment_path(atts, attachment_id)

    if not file_path or str(file_path).startswith("__"):
        raise HTTPException(status_code=404, detail="No readable PDF attachment")

    try:
        src, _ = storage.get_bytes(file_path)
    except Exception:
        raise HTTPException(status_code=404, detail="PDF file not found in storage")

    watermark_text = f"{o.buyer_id} | {o.id}"
    try:
        out = watermark_encrypt_pdf_bytes(
            pdf_bytes=src,
            watermark_text=watermark_text,
            font_file=settings.resolved_watermark_font_file(),
            user_password=pw,
            owner_password=settings.jwt_secret_key,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to generate protected PDF")

    headers = {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": f'attachment; filename="{Path(filename).stem}_download.pdf"',
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    return Response(content=out, media_type="application/pdf", headers=headers)


@router.get("/qrcode/{order_id}.png")
def viewer_qrcode_png(order_id: str, request: Request, db: Session = Depends(get_db)) -> Response:
    # Public QR code: encodes the viewer URL only (password must still be sent separately).
    settings = get_settings()
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")

    base = public_frontend_base_url(request) or settings.admin_frontend_base_url.rstrip("/")
    viewer_url = f"{base}/view/{order_id}"
    png = make_qr_png_bytes(viewer_url, scale=8, border=4)
    headers = {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=png, media_type="image/png", headers=headers)










