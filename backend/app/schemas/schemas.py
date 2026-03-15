from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    role: str
    nickname: str


class AdminMeResponse(BaseModel):
    id: str
    username: str
    nickname: str
    role: str



class ChangeMyPasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)

class TeamMemberOut(BaseModel):
    id: str
    username: str
    nickname: str
    role: str
    is_active: bool
    created_at: datetime


class TeamMemberCreate(BaseModel):
    username: str
    password: str = Field(min_length=8)
    nickname: str
    role: Literal["super_admin", "normal_admin"] = "normal_admin"


class ProductOut(BaseModel):
    id: str
    name: str
    description: str
    price: Decimal
    cover_image: str | None
    sales_count: int
    attachment_count: int = 0
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ProductUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    price: Decimal | None = None
    cover_image: str | None = None
    is_active: bool | None = None


class PagedBase(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class ProductPage(PagedBase):
    items: list[ProductOut]


class OrderOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    buyer_id: str
    buyer_email: EmailStr | None
    delivery_method: str
    status: str
    unit_price: Decimal
    is_confirmed: bool
    confirmed_at: datetime | None
    operator_id: str
    operator_nickname: str
    password_last4: str
    created_at: datetime
    refunded_at: datetime | None


class OrderPage(PagedBase):
    items: list[OrderOut]


class ProductAttachmentOut(BaseModel):
    id: str
    filename: str
    sort_index: int
    created_at: datetime


class ProductDetailOut(BaseModel):
    id: str
    name: str
    description: str
    price: Decimal
    cover_image: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    attachments: list[ProductAttachmentOut]


class DeliverRequest(BaseModel):
    product_id: str
    buyer_id: str
    buyer_email: EmailStr | None = None
    delivery_method: Literal["text", "email", "qrcode"] = "text"


class DeliverResponse(BaseModel):
    order_id: str
    viewer_url: str
    password: str
    copy_text: str
    delivery_method: Literal["text", "email", "qrcode"]
    email_subject: str | None = None
    email_body: str | None = None
    qrcode_url: str | None = None
    qrcode_image_url: str | None = None
    smtp_configured: bool
    legal_disclaimer: str


class RefundResponse(BaseModel):
    order_id: str
    status: str


class ResetOrderPasswordResponse(BaseModel):
    order_id: str
    password: str
    password_last4: str
    password_version: int
    copy_text: str


class DashboardStats(BaseModel):
    today_revenue: Decimal
    today_orders: int
    active_products: int
    total_refunds: int


class DashboardSalesRankItem(BaseModel):
    product_id: str
    product_name: str
    sales: int


class DashboardRevenueRankItem(BaseModel):
    product_id: str
    product_name: str
    revenue: Decimal


class DashboardRefundRateItem(BaseModel):
    product_id: str
    product_name: str
    total_orders: int
    refunded_orders: int
    refund_rate: float


class DashboardAnalytics(BaseModel):
    sales_ranking: list[DashboardSalesRankItem]
    revenue_ranking: list[DashboardRevenueRankItem]
    refund_rate_by_product: list[DashboardRefundRateItem]


class SendEmailRequest(BaseModel):
    subject: str
    body: str


class SendEmailResponse(BaseModel):
    ok: bool


class ViewerAuthRequest(BaseModel):
    order_id: str
    password: str


class ViewerAuthResponse(BaseModel):
    viewer_token: str
    expires_in_minutes: int


class ViewerDownloadRequest(BaseModel):
    # PDF open password: must match access password.
    password: str = Field(min_length=1)


class ViewerAttachmentOut(BaseModel):
    id: str
    filename: str


class ViewerMetaResponse(BaseModel):
    order_id: str
    product_name: str
    is_confirmed: bool
    can_download: bool
    download_password: str | None = None
    attachments: list[ViewerAttachmentOut]



class SystemR2PrefixUsage(BaseModel):
    prefix: str
    objects: int
    bytes: int
    truncated: bool


class SystemDbOverview(BaseModel):
    ok: bool
    latency_ms: int
    products: int
    orders: int
    active_orders: int
    confirmed_orders: int
    refunded_orders: int
    confirmed_revenue: Decimal
    views_total: int
    orders_viewed_24h: int
    last_view_at: datetime | None


class SystemR2Overview(BaseModel):
    enabled: bool
    bucket: str | None
    prefixes: list[SystemR2PrefixUsage]


class SystemOverviewResponse(BaseModel):
    environment: str
    server_time: datetime
    db: SystemDbOverview
    r2: SystemR2Overview



class OrderPasswordResponse(BaseModel):
    order_id: str
    password: str

