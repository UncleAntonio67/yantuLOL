from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import math
from pathlib import Path
import secrets
import time as time_mod
import shutil
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.storage import storage
from app.storage import r2_storage
from app.core.security import create_admin_access_token, decode_token, hash_password, verify_password
from app.db.session import get_db
from app.models.models import DeliveryMethod, Order, OrderStatus, Product, ProductAttachment, Role, TeamMember
from app.schemas.schemas import (
    AdminMeResponse,
    ChangeMyPasswordRequest,
    DashboardAnalytics,
    DashboardStats,
    DeliverRequest,
    DeliverResponse,
    LoginRequest,
    LoginResponse,
    OrderPage,
    OrderOut,
    ProductPage,
    ProductAttachmentOut,
    ProductDetailOut,
    ProductOut,
    ProductUpdate,
    RefundResponse,
    ResetOrderPasswordResponse,
    SendEmailRequest,
    SendEmailResponse,
    TeamMemberCreate,
    TeamMemberOut,
    SystemOverviewResponse,
    OrderPasswordResponse,
)
from app.services.emailer import send_delivery_email
from app.utils.public_url import public_frontend_base_url
from app.utils import password_vault


router = APIRouter()
_bearer = HTTPBearer(auto_error=False)
# Simple in-memory caching for heavy monitoring/analytics endpoints.
# Cloud Run instances are ephemeral, but caching still reduces repeated R2 list calls.
_SYSTEM_OVERVIEW_TTL_S = 15.0
_DASHBOARD_ANALYTICS_TTL_S = 10.0
_system_overview_cache: tuple[float, SystemOverviewResponse] | None = None
_dashboard_analytics_cache: tuple[float, DashboardAnalytics] | None = None


def _require_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> TeamMember:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        payload = decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if payload.get("typ") != "admin":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    admin_id = payload.get("sub")
    admin = db.get(TeamMember, admin_id)
    if not admin or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found or disabled")
    return admin


def _require_super_admin(admin: TeamMember = Depends(_require_admin)) -> TeamMember:
    if admin.role != Role.super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")
    return admin


def _generate_order_id() -> str:
    # Manual creation, avoid DB sequences: timestamp + random suffix.
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    suffix = secrets.token_hex(2).upper()
    return f"ORD-{now}-{suffix}"


def _generate_password() -> str:
    # Stronger than 6 digits; still human typable.
    return secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12]
def _encrypt_password_optional(pw: str) -> str | None:
    """Best-effort encrypt for password retrieval. If crypto deps are missing, skip."""
    try:
        return password_vault.encrypt_password(pw)
    except Exception:
        return None


def _viewer_url(*, order_id: str, request: Request | None = None) -> str:
    base = public_frontend_base_url(request)
    if not base:
        settings = get_settings()
        base = settings.admin_frontend_base_url.rstrip("/")
    return f"{base}/view/{order_id}"
def _copy_text(*, viewer_url: str, password: str, buyer_id: str) -> str:
    return (
        f"【研途LOL】亲，您的专属资料已生成。\n"
        f"在线阅读链接: {viewer_url}\n"
        f"访问密码: {password}\n"
        f"提示: 本链接仅供在线查看；下载将在确认收货后开放。\n"
        f"提示: 文档已写入您的专属水印（买家ID: {buyer_id}），请勿外传。"
    )


def _append_legal_disclaimer(message: str) -> str:
    settings = get_settings()
    disclaimer = (settings.legal_disclaimer_text or "").strip()
    if not disclaimer:
        return message
    # Ensure we append exactly once.
    if disclaimer in message:
        return message
    return f"{message}\n\n{disclaimer}"


def _store_product_cover_image(*, product_id: str, upload: UploadFile) -> str:
    settings = get_settings()
    suffix = Path(upload.filename or "").suffix.lower()
    allowed = {".png", ".jpg", ".jpeg", ".webp"}
    if suffix not in allowed:
        raise HTTPException(status_code=400, detail="Only png/jpg/jpeg/webp cover image is supported")

    # Remove previous cover image files (if any).
    if storage.r2_enabled():
        # product_images/{product_id}.png|jpg|... are all covered by this prefix.
        bucket = settings.r2_bucket_name or settings.r2_bucket
        if bucket:
            storage.delete_r2_prefix(bucket=str(bucket), prefix=f"product_images/{product_id}")
    else:
        out_dir = Path(settings.product_image_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob(f"{product_id}.*"):
            try:
                old.unlink()
            except Exception:
                pass

    ct = None
    if suffix == ".png":
        ct = "image/png"
    elif suffix in {".jpg", ".jpeg"}:
        ct = "image/jpeg"
    elif suffix == ".webp":
        ct = "image/webp"

    uri = storage.product_cover_uri(product_id=product_id, suffix=suffix)
    storage.put_bytes(uri=uri, data=upload.file.read(), content_type=ct)

    # Served by backend at /static/product-images/... (local disk or R2).
    return storage.product_cover_public_path(product_id=product_id, suffix=suffix)

def _ensure_primary_attachment(*, product: Product, db: Session) -> None:
    if not product.source_pdf_path or str(product.source_pdf_path).startswith('__'):
        return
    """
    Upgrade legacy single-file products into the multi-attachment model on demand.
    """
    has_any = db.scalar(
        select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == product.id)
    ) or 0
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


def _validate_pdf_upload(upload: UploadFile) -> None:
    filename = (upload.filename or "").lower()
    if not filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF is supported")
    head = upload.file.read(5)
    upload.file.seek(0)
    if head != b"%PDF-":
        raise HTTPException(status_code=400, detail="Invalid PDF header")


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    stmt = select(TeamMember).where(TeamMember.username == payload.username)
    user = db.scalar(stmt)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_admin_access_token(subject=user.id, role=user.role.value, nickname=user.nickname)
    return LoginResponse(access_token=token, role=user.role.value, nickname=user.nickname)


@router.get("/me", response_model=AdminMeResponse)
def me(admin: TeamMember = Depends(_require_admin)) -> AdminMeResponse:
    return AdminMeResponse(id=admin.id, username=admin.username, nickname=admin.nickname, role=admin.role.value)

@router.post("/me/change-password")
def change_my_password(
    payload: ChangeMyPasswordRequest,
    admin: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, admin.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    admin.password_hash = hash_password(payload.new_password)
    db.add(admin)
    db.commit()
    return {"ok": True}



@router.get("/team", response_model=list[TeamMemberOut])
def get_team(_: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    members = db.scalars(select(TeamMember).order_by(TeamMember.created_at.desc())).all()
    return [
        TeamMemberOut(
            id=m.id,
            username=m.username,
            nickname=m.nickname,
            role=m.role.value,
            is_active=m.is_active,
            created_at=m.created_at,
        )
        for m in members
    ]


@router.post("/team", response_model=TeamMemberOut)
def create_team_member(
    payload: TeamMemberCreate,
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    exists = db.scalar(select(func.count()).select_from(TeamMember).where(TeamMember.username == payload.username))
    if exists:
        raise HTTPException(status_code=400, detail="Username already exists")
    user = TeamMember(
        username=payload.username,
        password_hash=hash_password(payload.password),
        nickname=payload.nickname,
        role=Role(payload.role),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return TeamMemberOut(
        id=user.id,
        username=user.username,
        nickname=user.nickname,
        role=user.role.value,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.get("/products", response_model=list[ProductOut])
def list_products(_: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    # sales_count (for analytics) is defined as confirmed (recognized) sales only.
    sales_subq = (
        select(func.count())
        .select_from(Order)
        .where(Order.product_id == Product.id)
        .where(Order.status == OrderStatus.active)
        .where(Order.confirmed_at.is_not(None))
        .scalar_subquery()
    )
    att_subq = (
        select(func.count())
        .select_from(ProductAttachment)
        .where(ProductAttachment.product_id == Product.id)
        .scalar_subquery()
    )
    rows = db.execute(select(Product, sales_subq.label("sales_count"), att_subq.label("attachment_count")).order_by(Product.created_at.desc())).all()
    out: list[ProductOut] = []
    for p, sales, att_count in rows:
        attachment_count = int(att_count or 0)
        if attachment_count == 0:
            attachment_count = 1  # legacy single-file products
        out.append(
            ProductOut(
                id=p.id,
                name=p.name,
                description=p.description,
                price=p.price,
                cover_image=p.cover_image,
                sales_count=int(sales or 0),
                attachment_count=attachment_count,
                is_active=p.is_active,
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
        )
    return out


@router.get("/products/paged", response_model=ProductPage)
def list_products_paged(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    total = int(db.scalar(select(func.count()).select_from(Product)) or 0)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    offset = (page - 1) * page_size

    if total and offset >= total:
        return ProductPage(page=page, page_size=page_size, total=total, total_pages=total_pages, items=[])

    sales_subq = (
        select(func.count())
        .select_from(Order)
        .where(Order.product_id == Product.id)
        .where(Order.status == OrderStatus.active)
        .where(Order.confirmed_at.is_not(None))
        .scalar_subquery()
    )
    att_subq = (
        select(func.count())
        .select_from(ProductAttachment)
        .where(ProductAttachment.product_id == Product.id)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Product, sales_subq.label("sales_count"), att_subq.label("attachment_count"))
        .order_by(Product.created_at.desc())
        .offset(offset)
        .limit(page_size)
    ).all()
    out: list[ProductOut] = []
    for p, sales, att_count in rows:
        attachment_count = int(att_count or 0)
        if attachment_count == 0:
            attachment_count = 1
        out.append(
            ProductOut(
                id=p.id,
                name=p.name,
                description=p.description,
                price=p.price,
                cover_image=p.cover_image,
                sales_count=int(sales or 0),
                attachment_count=attachment_count,
                is_active=p.is_active,
                created_at=p.created_at,
                updated_at=p.updated_at,
            )
        )
    return ProductPage(page=page, page_size=page_size, total=total, total_pages=total_pages, items=out)


@router.post("/products", response_model=ProductOut)
def create_product(
    name: str = Form(...),
    description: str = Form(""),
    price: Decimal = Form(0),
    is_active: bool = Form(True),
    cover_image: str | None = Form(None),
    cover_image_file: UploadFile | None = File(None),
    attachments: list[UploadFile] | None = File(None),
    source_pdf: UploadFile | None = File(None),
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()

    uploads: list[UploadFile] = []
    if attachments:
        uploads.extend(attachments)
    elif source_pdf:
        uploads.append(source_pdf)
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one PDF attachment is required")

    for u in uploads:
        filename = (u.filename or "").lower()
        if not filename.endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF is supported")
        head = u.file.read(5)
        u.file.seek(0)
        if head != b"%PDF-":
            raise HTTPException(status_code=400, detail="Invalid PDF header")

    product = Product(
        name=name,
        description=description,
        price=price,
        cover_image=cover_image if not cover_image_file else None,
        is_active=is_active,
        source_pdf_path="__pending__",
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    for idx, u in enumerate(uploads):
        att_id = str(uuid4())
        uri = storage.product_attachment_uri(product_id=product.id, attachment_id=att_id)
        storage.put_bytes(uri=uri, data=u.file.read(), content_type="application/pdf")
        db.add(
            ProductAttachment(
                id=att_id,
                product_id=product.id,
                filename=(u.filename or f"attachment_{idx+1}.pdf"),
                file_path=uri,
                sort_index=idx,
            )
        )
        if idx == 0:
            product.source_pdf_path = uri

    # If cover image is provided, store it locally and expose it via /static/product-images.
    if cover_image_file:
        product.cover_image = _store_product_cover_image(product_id=product.id, upload=cover_image_file)
    db.add(product)
    db.commit()
    db.refresh(product)

    return ProductOut(
        id=product.id,
        name=product.name,
        description=product.description,
        price=product.price,
        cover_image=product.cover_image,
        sales_count=0,
        attachment_count=len(uploads),
        is_active=product.is_active,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: str,
    payload: ProductUpdate,
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.add(p)
    db.commit()
    db.refresh(p)

    sales = (
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.product_id == p.id)
            .where(Order.status == OrderStatus.active)
            .where(Order.confirmed_at.is_not(None))
        )
        or 0
    )
    att_count = int(
        db.scalar(select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == p.id)) or 0
    )
    if att_count == 0:
        att_count = 1
    return ProductOut(
        id=p.id,
        name=p.name,
        description=p.description,
        price=p.price,
        cover_image=p.cover_image,
        sales_count=int(sales),
        attachment_count=att_count,
        is_active=p.is_active,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.post("/products/{product_id}/cover-image", response_model=ProductOut)
def upload_product_cover_image(
    product_id: str,
    cover_image_file: UploadFile = File(...),
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.cover_image = _store_product_cover_image(product_id=p.id, upload=cover_image_file)
    db.add(p)
    db.commit()
    db.refresh(p)

    sales = (
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.product_id == p.id)
            .where(Order.status == OrderStatus.active)
            .where(Order.confirmed_at.is_not(None))
        )
        or 0
    )
    att_count = int(
        db.scalar(select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == p.id)) or 0
    )
    if att_count == 0:
        att_count = 1
    return ProductOut(
        id=p.id,
        name=p.name,
        description=p.description,
        price=p.price,
        cover_image=p.cover_image,
        sales_count=int(sales),
        attachment_count=att_count,
        is_active=p.is_active,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.delete("/products/{product_id}")
def delete_product(
    product_id: str,
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    has_orders = db.scalar(select(func.count()).select_from(Order).where(Order.product_id == product_id)) or 0
    if has_orders:
        raise HTTPException(status_code=400, detail="Product has orders and cannot be deleted")

    # Best-effort cleanup of stored files.
    atts = db.scalars(select(ProductAttachment).where(ProductAttachment.product_id == p.id)).all()
    for a in atts:
        try:
            if a.file_path:
                storage.delete_uri(a.file_path)
        except Exception:
            pass

    try:
        if p.source_pdf_path:
            storage.delete_uri(p.source_pdf_path)
    except Exception:
        pass

    # Remove any remaining objects for this product (best-effort).
    try:
        if storage.r2_enabled():
            bucket = settings.r2_bucket_name or settings.r2_bucket
            if bucket:
                storage.delete_r2_prefix(bucket=str(bucket), prefix=f"source_pdfs/{p.id}/")
            bucket = settings.r2_bucket_name or settings.r2_bucket
            if bucket:
                storage.delete_r2_prefix(bucket=str(bucket), prefix=f"product_images/{p.id}")
        else:
            shutil.rmtree(str(Path(settings.source_pdf_dir) / p.id), ignore_errors=True)
            img_dir = Path(settings.product_image_dir)
            for old in img_dir.glob(f"{p.id}.*"):
                try:
                    old.unlink()
                except Exception:
                    pass
    except Exception:
        pass
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/products/{product_id}", response_model=ProductDetailOut)
def get_product_detail(product_id: str, _: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _ensure_primary_attachment(product=p, db=db)
    atts = db.scalars(
        select(ProductAttachment)
        .where(ProductAttachment.product_id == p.id)
        .order_by(ProductAttachment.sort_index.asc(), ProductAttachment.created_at.asc())
    ).all()
    return ProductDetailOut(
        id=p.id,
        name=p.name,
        description=p.description,
        price=p.price,
        cover_image=p.cover_image,
        is_active=p.is_active,
        created_at=p.created_at,
        updated_at=p.updated_at,
        attachments=[
            ProductAttachmentOut(id=a.id, filename=a.filename, sort_index=int(a.sort_index), created_at=a.created_at) for a in atts
        ],
    )


@router.get("/products/{product_id}/attachments", response_model=list[ProductAttachmentOut])
def list_product_attachments(product_id: str, _: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _ensure_primary_attachment(product=p, db=db)
    atts = db.scalars(
        select(ProductAttachment)
        .where(ProductAttachment.product_id == p.id)
        .order_by(ProductAttachment.sort_index.asc(), ProductAttachment.created_at.asc())
    ).all()
    return [ProductAttachmentOut(id=a.id, filename=a.filename, sort_index=int(a.sort_index), created_at=a.created_at) for a in atts]


@router.post("/products/{product_id}/attachments", response_model=list[ProductAttachmentOut])
def add_product_attachments(
    product_id: str,
    attachments: list[UploadFile] = File(...),
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if not attachments:
        raise HTTPException(status_code=400, detail="At least one PDF attachment is required")
    _ensure_primary_attachment(product=p, db=db)

    for u in attachments:
        _validate_pdf_upload(u)

    max_sort = int(
        db.scalar(select(func.max(ProductAttachment.sort_index)).where(ProductAttachment.product_id == p.id)) or 0
    )
    for i, u in enumerate(attachments, start=1):
        att_id = str(uuid4())
        uri = storage.product_attachment_uri(product_id=p.id, attachment_id=att_id)
        storage.put_bytes(uri=uri, data=u.file.read(), content_type="application/pdf")
        db.add(
            ProductAttachment(
                id=att_id,
                product_id=p.id,
                filename=(u.filename or f"attachment_{max_sort+i}.pdf"),
                file_path=uri,
                sort_index=max_sort + i,
            )
        )
    db.commit()

    atts = db.scalars(
        select(ProductAttachment)
        .where(ProductAttachment.product_id == p.id)
        .order_by(ProductAttachment.sort_index.asc(), ProductAttachment.created_at.asc())
    ).all()
    return [ProductAttachmentOut(id=a.id, filename=a.filename, sort_index=int(a.sort_index), created_at=a.created_at) for a in atts]


@router.delete("/products/{product_id}/attachments/{attachment_id}")
def delete_product_attachment(
    product_id: str,
    attachment_id: str,
    _: TeamMember = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _ensure_primary_attachment(product=p, db=db)
    att = db.scalar(
        select(ProductAttachment)
        .where(ProductAttachment.product_id == p.id)
        .where(ProductAttachment.id == attachment_id)
    )
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    total = int(db.scalar(select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == p.id)) or 0)
    if total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last attachment")

    # If deleting the primary file, choose the next one as primary.
    deleting_primary = (p.source_pdf_path or "") == (att.file_path or "")

    try:
        if att.file_path:
            storage.delete_uri(att.file_path)
    except Exception:
        pass
    db.delete(att)
    db.commit()

    if deleting_primary:
        next_att = db.scalar(
            select(ProductAttachment)
            .where(ProductAttachment.product_id == p.id)
            .order_by(ProductAttachment.sort_index.asc(), ProductAttachment.created_at.asc())
        )
        if next_att:
            p.source_pdf_path = next_att.file_path
            db.add(p)
            db.commit()

    return {"ok": True}


@router.post("/orders/deliver", response_model=DeliverResponse)
def deliver_order(
    payload: DeliverRequest,
    request: Request,
    admin: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    product = db.get(Product, payload.product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found or inactive")


    _ensure_primary_attachment(product=product, db=db)
    atts_cnt = db.scalar(select(func.count()).select_from(ProductAttachment).where(ProductAttachment.product_id == product.id)) or 0
    if int(atts_cnt) <= 0:
        raise HTTPException(status_code=400, detail="商品未上传 PDF 附件，无法发货")
    if payload.delivery_method == "email":
        if not payload.buyer_email:
            raise HTTPException(status_code=400, detail="buyer_email is required for email delivery")
        # Do NOT block order creation if SMTP is not configured.
        # Sending is handled by a separate endpoint which will validate SMTP config.

    smtp_configured = bool(settings.smtp_host and settings.smtp_username and settings.smtp_password and settings.smtp_from)

    order_id = _generate_order_id()
    password = _generate_password()
    viewer_url = _viewer_url(order_id=order_id, request=request)
    copy_text = _append_legal_disclaimer(
        _copy_text(viewer_url=viewer_url, password=password, buyer_id=payload.buyer_id)
    )

    order = Order(
        id=order_id,
        product_id=product.id,
        unit_price=product.price,
        buyer_id=payload.buyer_id,
        buyer_email=str(payload.buyer_email) if payload.buyer_email else None,
        delivery_method=DeliveryMethod(payload.delivery_method),
        access_password_hash=hash_password(password),
        access_password_last4=password[-4:],
        access_password_token=_encrypt_password_optional(password),
        status=OrderStatus.active,
        operator_id=admin.id,
    )
    db.add(order)
    db.commit()

    email_subject: str | None = None
    email_body: str | None = None
    if payload.delivery_method == "email":
        email_subject = "研途LOL 专属资料在线阅读"
        email_body = copy_text

    return DeliverResponse(
        order_id=order_id,
        viewer_url=viewer_url,
        password=password,
        copy_text=copy_text,
        delivery_method=payload.delivery_method,
        email_subject=email_subject,
        email_body=email_body,
        qrcode_url=viewer_url if payload.delivery_method == "qrcode" else None,
        qrcode_image_url=f"/api/viewer/qrcode/{order_id}.png" if payload.delivery_method == "qrcode" else None,
        smtp_configured=smtp_configured,
        legal_disclaimer=get_settings().legal_disclaimer_text,
    )


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    buyer_id: str | None = None,
    status_filter: str | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(Order, Product, TeamMember)
        .join(Product, Product.id == Order.product_id)
        .join(TeamMember, TeamMember.id == Order.operator_id)
        .order_by(Order.created_at.desc())
    )
    if buyer_id:
        stmt = stmt.where(Order.buyer_id.contains(buyer_id))
    if status_filter:
        try:
            stmt = stmt.where(Order.status == OrderStatus(status_filter))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid status")

    if created_from:
        cf = created_from if created_from.tzinfo else created_from.replace(tzinfo=timezone.utc)
        stmt = stmt.where(Order.created_at >= cf)
    if created_to:
        ct = created_to if created_to.tzinfo else created_to.replace(tzinfo=timezone.utc)
        stmt = stmt.where(Order.created_at <= ct)

    rows = db.execute(stmt).all()
    out: list[OrderOut] = []
    for o, p, op in rows:
        out.append(
            OrderOut(
                id=o.id,
                product_id=o.product_id,
                product_name=p.name,
                buyer_id=o.buyer_id,
                buyer_email=o.buyer_email,
                delivery_method=o.delivery_method.value,
                status=o.status.value,
                unit_price=o.unit_price,
                is_confirmed=bool(o.confirmed_at),
                confirmed_at=o.confirmed_at,
                operator_id=o.operator_id,
                operator_nickname=op.nickname,
                password_last4=o.access_password_last4,
                created_at=o.created_at,
                refunded_at=o.refunded_at,
            )
        )
    return out


@router.get("/orders/paged", response_model=OrderPage)
def list_orders_paged(
    buyer_id: str | None = None,
    product_id: str | None = None,
    operator_id: str | None = None,
    status_filter: str | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    sort_by: str | None = "created_at",
    sort_dir: str | None = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    count_stmt = select(func.count()).select_from(Order)
    data_stmt = (
        select(Order, Product, TeamMember)
        .join(Product, Product.id == Order.product_id)
        .join(TeamMember, TeamMember.id == Order.operator_id)
    )
    if buyer_id:
        count_stmt = count_stmt.where(Order.buyer_id.contains(buyer_id))
        data_stmt = data_stmt.where(Order.buyer_id.contains(buyer_id))
    if product_id:
        count_stmt = count_stmt.where(Order.product_id == product_id)
        data_stmt = data_stmt.where(Order.product_id == product_id)
    if operator_id:
        count_stmt = count_stmt.where(Order.operator_id == operator_id)
        data_stmt = data_stmt.where(Order.operator_id == operator_id)
    if status_filter:
        try:
            st = OrderStatus(status_filter)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid status")
        count_stmt = count_stmt.where(Order.status == st)
        data_stmt = data_stmt.where(Order.status == st)

    if created_from:
        cf = datetime.combine(created_from, time.min).replace(tzinfo=timezone.utc)
        count_stmt = count_stmt.where(Order.created_at >= cf)
        data_stmt = data_stmt.where(Order.created_at >= cf)
    if created_to:
        ct = datetime.combine(created_to, time.min).replace(tzinfo=timezone.utc) + timedelta(days=1)
        count_stmt = count_stmt.where(Order.created_at < ct)
        data_stmt = data_stmt.where(Order.created_at < ct)

    # Sorting
    col = Order.created_at
    if sort_by and sort_by not in {"created_at", "unit_price"}:
        raise HTTPException(status_code=400, detail="Invalid sort_by")
    if sort_by == "unit_price":
        col = Order.unit_price
    d = (sort_dir or "desc").lower()
    if d not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="Invalid sort_dir")
    ob = col.asc() if d == "asc" else col.desc()
    # Stable ordering to avoid row jumps between pages
    if col is Order.created_at:
        data_stmt = data_stmt.order_by(ob, Order.id.asc())
    else:
        data_stmt = data_stmt.order_by(ob, Order.created_at.desc(), Order.id.asc())

    total = int(db.scalar(count_stmt) or 0)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    offset = (page - 1) * page_size

    if total and offset >= total:
        return OrderPage(page=page, page_size=page_size, total=total, total_pages=total_pages, items=[])

    rows = db.execute(data_stmt.offset(offset).limit(page_size)).all()
    out: list[OrderOut] = []
    for o, p, op in rows:
        out.append(
            OrderOut(
                id=o.id,
                product_id=o.product_id,
                product_name=p.name,
                buyer_id=o.buyer_id,
                buyer_email=o.buyer_email,
                delivery_method=o.delivery_method.value,
                status=o.status.value,
                unit_price=o.unit_price,
                is_confirmed=bool(o.confirmed_at),
                confirmed_at=o.confirmed_at,
                operator_id=o.operator_id,
                operator_nickname=op.nickname,
                password_last4=o.access_password_last4,
                created_at=o.created_at,
                refunded_at=o.refunded_at,
            )
        )
    return OrderPage(page=page, page_size=page_size, total=total, total_pages=total_pages, items=out)


@router.post("/orders/{order_id}/confirm", response_model=OrderOut)
def confirm_order(
    order_id: str,
    admin: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status != OrderStatus.active:
        raise HTTPException(status_code=400, detail="Only active orders can be confirmed")
    if not o.confirmed_at:
        o.confirmed_at = datetime.now(timezone.utc)
        o.confirmed_by = admin.id
        db.add(o)
        db.commit()
        db.refresh(o)

    p = db.get(Product, o.product_id)
    op = db.get(TeamMember, o.operator_id)
    return OrderOut(
        id=o.id,
        product_id=o.product_id,
        product_name=p.name if p else "-",
        buyer_id=o.buyer_id,
        buyer_email=o.buyer_email,
        delivery_method=o.delivery_method.value,
        status=o.status.value,
        unit_price=o.unit_price,
        is_confirmed=bool(o.confirmed_at),
        confirmed_at=o.confirmed_at,
        operator_id=o.operator_id,
        operator_nickname=op.nickname if op else "-",
        password_last4=o.access_password_last4,
        created_at=o.created_at,
        refunded_at=o.refunded_at,
    )


@router.post("/orders/{order_id}/refund", response_model=RefundResponse)
def refund_order(
    order_id: str,
    admin: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status == OrderStatus.refunded:
        return RefundResponse(order_id=o.id, status=o.status.value)
    o.status = OrderStatus.refunded
    o.refunded_at = datetime.now(timezone.utc)
    o.refunded_by = admin.id
    db.add(o)
    db.commit()

    # Best-effort cleanup of generated downloadable PDFs for this order.
    try:
        shutil.rmtree(str(Path(settings.generated_pdf_dir) / o.id), ignore_errors=True)
    except Exception:
        pass
    return RefundResponse(order_id=o.id, status=o.status.value)


@router.post("/orders/{order_id}/reset-password", response_model=ResetOrderPasswordResponse)
def reset_order_password(
    order_id: str,
    request: Request,
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status != OrderStatus.active:
        raise HTTPException(status_code=400, detail="Only active orders can reset password")

    new_password = _generate_password()
    o.access_password_hash = hash_password(new_password)
    o.access_password_last4 = new_password[-4:]
    o.access_password_token = _encrypt_password_optional(new_password)
    o.password_version = int(o.password_version) + 1
    db.add(o)
    db.commit()

    viewer_url = _viewer_url(order_id=o.id, request=request)
    copy_text = _append_legal_disclaimer(_copy_text(viewer_url=viewer_url, password=new_password, buyer_id=o.buyer_id))
    return ResetOrderPasswordResponse(
        order_id=o.id,
        password=new_password,
        password_last4=o.access_password_last4,
        password_version=int(o.password_version),
        copy_text=copy_text,
    )


@router.post("/orders/{order_id}/send-email", response_model=SendEmailResponse)
def send_order_email(
    order_id: str,
    payload: SendEmailRequest,
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    if not (settings.smtp_host and settings.smtp_username and settings.smtp_password and settings.smtp_from):
        raise HTTPException(status_code=400, detail="SMTP is not configured")

    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if o.status != OrderStatus.active:
        raise HTTPException(status_code=400, detail="Only active orders can send email")
    if not o.buyer_email:
        raise HTTPException(status_code=400, detail="Order has no buyer_email")

    subject = (payload.subject or "").strip() or "研途LOL 专属资料在线阅读"
    body = _append_legal_disclaimer(payload.body or "")
    send_delivery_email(to_email=o.buyer_email, subject=subject, body=body)
    return SendEmailResponse(ok=True)


@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(_: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    today0 = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Revenue is recognized only after admin confirms receipt.
    today_orders = (
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.confirmed_at.is_not(None))
            .where(Order.confirmed_at >= today0)
            .where(Order.status == OrderStatus.active)
        )
        or 0
    )
    total_refunds = (
        db.scalar(select(func.count()).select_from(Order).where(Order.status == OrderStatus.refunded)) or 0
    )
    active_products = db.scalar(select(func.count()).select_from(Product).where(Product.is_active.is_(True))) or 0
    today_revenue = (
        db.scalar(
            select(func.coalesce(func.sum(Order.unit_price), 0))
            .select_from(Order)
            .where(Order.confirmed_at.is_not(None))
            .where(Order.confirmed_at >= today0)
            .where(Order.status == OrderStatus.active)
        )
        or 0
    )

    return DashboardStats(
        today_revenue=Decimal(str(today_revenue)),
        today_orders=int(today_orders),
        active_products=int(active_products),
        total_refunds=int(total_refunds),
    )


@router.get("/dashboard/analytics", response_model=DashboardAnalytics)
def dashboard_analytics(_: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    global _dashboard_analytics_cache
    now_ts = time_mod.time()
    if _dashboard_analytics_cache and (now_ts - _dashboard_analytics_cache[0]) < _DASHBOARD_ANALYTICS_TTL_S:
        return _dashboard_analytics_cache[1]

    confirmed_sales = func.coalesce(
        func.sum(case(((Order.status == OrderStatus.active) & (Order.confirmed_at.is_not(None)), 1), else_=0)),
        0,
    ).label("confirmed_sales_count")
    refunded_sales = func.coalesce(
        func.sum(case((Order.status == OrderStatus.refunded, 1), else_=0)),
        0,
    ).label("refunded_sales_count")
    total_sales = func.coalesce(func.count(Order.id), 0).label("total_sales_count")
    confirmed_revenue = func.coalesce(
        func.sum(case(((Order.status == OrderStatus.active) & (Order.confirmed_at.is_not(None)), Order.unit_price), else_=0)),
        0,
    ).label("confirmed_revenue")

    stmt = (
        select(Product, confirmed_sales, refunded_sales, total_sales, confirmed_revenue)
        .outerjoin(Order, Order.product_id == Product.id)
        .group_by(Product.id)
    )
    rows = db.execute(stmt).all()

    sales_ranking: list[dict] = []
    revenue_ranking: list[dict] = []
    refund_rates: list[dict] = []
    for p, confirmed_cnt, refunded_cnt, total_cnt, revenue in rows:
        confirmed_cnt_i = int(confirmed_cnt or 0)
        refunded_cnt_i = int(refunded_cnt or 0)
        total_cnt_i = int(total_cnt or 0)
        revenue_d = Decimal(str(revenue or 0))
        sales_ranking.append({"product_id": p.id, "product_name": p.name, "sales": confirmed_cnt_i})
        revenue_ranking.append({"product_id": p.id, "product_name": p.name, "revenue": revenue_d})
        rate = (refunded_cnt_i / total_cnt_i) if total_cnt_i else 0.0
        refund_rates.append(
            {
                "product_id": p.id,
                "product_name": p.name,
                "total_orders": total_cnt_i,
                "refunded_orders": refunded_cnt_i,
                "refund_rate": float(rate),
            }
        )

    sales_ranking.sort(key=lambda x: x["sales"], reverse=True)
    revenue_ranking.sort(key=lambda x: x["revenue"], reverse=True)
    refund_rates.sort(key=lambda x: x["refund_rate"], reverse=True)

    res = DashboardAnalytics(
        sales_ranking=sales_ranking[:10],
        revenue_ranking=revenue_ranking[:10],
        refund_rate_by_product=refund_rates[:10],
    )
    _dashboard_analytics_cache = (now_ts, res)
    return res

@router.get("/system/overview", response_model=SystemOverviewResponse)
def system_overview(_: TeamMember = Depends(_require_admin), db: Session = Depends(get_db)):
    global _system_overview_cache
    now_ts = time_mod.time()
    if _system_overview_cache and (now_ts - _system_overview_cache[0]) < _SYSTEM_OVERVIEW_TTL_S:
        return _system_overview_cache[1]

    settings = get_settings()

    # DB health
    t0 = time_mod.perf_counter()
    ok = True
    try:
        db.execute(select(1)).first()
    except Exception:
        ok = False
    latency_ms = int((time_mod.perf_counter() - t0) * 1000)

    products = int(db.scalar(select(func.count()).select_from(Product)) or 0)
    orders = int(db.scalar(select(func.count()).select_from(Order)) or 0)
    active_orders = int(db.scalar(select(func.count()).select_from(Order).where(Order.status == OrderStatus.active)) or 0)
    confirmed_orders = int(
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.status == OrderStatus.active)
            .where(Order.confirmed_at.is_not(None))
        )
        or 0
    )
    refunded_orders = int(db.scalar(select(func.count()).select_from(Order).where(Order.status == OrderStatus.refunded)) or 0)
    confirmed_revenue_raw = (
        db.scalar(
            select(func.coalesce(func.sum(Order.unit_price), 0))
            .select_from(Order)
            .where(Order.status == OrderStatus.active)
            .where(Order.confirmed_at.is_not(None))
        )
        or 0
    )
    confirmed_revenue = Decimal(str(confirmed_revenue_raw))

    views_total = int(db.scalar(select(func.coalesce(func.sum(Order.view_count), 0)).select_from(Order)) or 0)
    now = datetime.now(timezone.utc)
    orders_viewed_24h = int(
        db.scalar(
            select(func.count())
            .select_from(Order)
            .where(Order.last_view_at.is_not(None))
            .where(Order.last_view_at >= (now - timedelta(hours=24)))
        )
        or 0
    )
    last_view_at = db.scalar(select(func.max(Order.last_view_at)).select_from(Order))

    # R2 usage (best-effort, approximate)
    r2_enabled = bool(storage.r2_enabled())
    bucket = (settings.r2_bucket_name or settings.r2_bucket) if r2_enabled else None
    prefixes: list[dict] = []

    if r2_enabled and bucket:
        try:
            client = r2_storage.get_s3_client()

            def scan_prefix(prefix: str, max_objects: int = 2000) -> dict:
                total_objects = 0
                total_bytes = 0
                token: str | None = None
                truncated = False
                while True:
                    kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
                    if token:
                        kwargs["ContinuationToken"] = token
                    resp = client.list_objects_v2(**kwargs)
                    contents = resp.get("Contents") or []
                    for obj in contents:
                        total_objects += 1
                        total_bytes += int(obj.get("Size") or 0)
                        if total_objects >= max_objects:
                            truncated = True
                            break
                    if truncated:
                        break
                    if not resp.get("IsTruncated"):
                        break
                    token = resp.get("NextContinuationToken")
                return {
                    "prefix": prefix,
                    "objects": int(total_objects),
                    "bytes": int(total_bytes),
                    "truncated": bool(truncated),
                }

            prefixes.append(scan_prefix("source_pdfs/"))
            prefixes.append(scan_prefix("product_images/"))
        except Exception:
            # Keep the endpoint stable even if R2 listing fails.
            prefixes = []

    res = SystemOverviewResponse(
        environment=settings.environment,
        server_time=now,
        db={
            "ok": ok,
            "latency_ms": latency_ms,
            "products": products,
            "orders": orders,
            "active_orders": active_orders,
            "confirmed_orders": confirmed_orders,
            "refunded_orders": refunded_orders,
            "confirmed_revenue": confirmed_revenue,
            "views_total": views_total,
            "orders_viewed_24h": orders_viewed_24h,
            "last_view_at": last_view_at,
        },
        r2={
            "enabled": r2_enabled,
            "bucket": bucket,
            "prefixes": prefixes,
        },
    )
    _system_overview_cache = (now_ts, res)
    return res

@router.get("/orders/{order_id}/password", response_model=OrderPasswordResponse)
def get_order_password(
    order_id: str,
    _: TeamMember = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    if not o.access_password_token:
        raise HTTPException(status_code=404, detail="Password is not stored for this order")
    try:
        pw = password_vault.decrypt_password(o.access_password_token)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt password")
    return OrderPasswordResponse(order_id=o.id, password=pw)
