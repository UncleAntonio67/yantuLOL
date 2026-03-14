from __future__ import annotations

from datetime import datetime, timezone
import base64
import hashlib
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
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
from app.utils.secure_pdf import watermark_encrypt_pdf_bytes
from app.utils.watermark import watermark_pdf_bytes


router = APIRouter()


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
    if not verify_password(payload.password, o.access_password_hash):
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
def viewer_document_default(viewer_token: str, db: Session = Depends(get_db)) -> Response:
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    atts = _list_attachments(product=p, db=db)
    if not atts:
        raise HTTPException(status_code=404, detail="No attachment")
    return viewer_document(viewer_token=viewer_token, attachment_id=atts[0].id, db=db)


@router.get("/document/{viewer_token}/{attachment_id}")
def viewer_document(viewer_token: str, attachment_id: str, db: Session = Depends(get_db)) -> Response:
    settings = get_settings()
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    atts = _list_attachments(product=p, db=db)
    file_path, filename = _find_attachment_path(atts, attachment_id)

    # Update view counters (best-effort)
    o.view_count = int(o.view_count) + 1
    o.last_view_at = datetime.now(timezone.utc)
    db.add(o)
    db.commit()

    watermark_text = f"{o.buyer_id} | {o.id} | {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}"
    try:
        src, _ = storage.get_bytes(file_path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    out = watermark_pdf_bytes(pdf_bytes=src, watermark_text=watermark_text, font_file=settings.resolved_watermark_font_file())
    headers = {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": f"inline; filename=\"{Path(filename).name}\"",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
    }
    return Response(content=out, media_type="application/pdf", headers=headers)


@router.get("/download/{viewer_token}/{attachment_id}")
def viewer_download_get_deprecated(viewer_token: str, attachment_id: str, db: Session = Depends(get_db)) -> Response:
    # New behavior requires POST with password so the PDF open password equals access password.
    raise HTTPException(
        status_code=405, detail="Use POST /api/viewer/download/{viewer_token}/{attachment_id} with password"
    )


@router.post("/download/{viewer_token}/{attachment_id}")
def viewer_download(viewer_token: str, attachment_id: str, payload: ViewerDownloadRequest, db: Session = Depends(get_db)) -> Response:
    settings = get_settings()
    order_id, pv = _decode_viewer_token(viewer_token)
    o = _load_active_order(order_id, pv, db)
    if not o.confirmed_at:
        raise HTTPException(status_code=403, detail="Download is not enabled yet")
    if not verify_password(payload.password, o.access_password_hash):
        raise HTTPException(status_code=401, detail="Invalid password")

    p = db.get(Product, o.product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    atts = _list_attachments(product=p, db=db)
    file_path, filename = _find_attachment_path(atts, attachment_id)

    # Do not persist generated PDFs on server to avoid storage growth.
    try:
        src, _ = storage.get_bytes(file_path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    watermark_text = f"{o.buyer_id} | {o.id}"
    out = watermark_encrypt_pdf_bytes(
        pdf_bytes=src,
        watermark_text=watermark_text,
        font_file=settings.resolved_watermark_font_file(),
        user_password=payload.password,
        owner_password=settings.jwt_secret_key,
    )
    headers = {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": f"attachment; filename=\"{Path(filename).stem}_download.pdf\"",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=out, media_type="application/pdf", headers=headers)


@router.get("/qrcode/{order_id}.png")
def viewer_qrcode_png(order_id: str, db: Session = Depends(get_db)) -> Response:
    # Public QR code: encodes the viewer URL only (password must still be sent separately).
    settings = get_settings()
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")

    viewer_url = f"{settings.admin_frontend_base_url.rstrip('/')}/view/{order_id}"
    png = make_qr_png_bytes(viewer_url, scale=8, border=4)
    headers = {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=png, media_type="image/png", headers=headers)


