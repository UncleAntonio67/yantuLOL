from __future__ import annotations

from decimal import Decimal
from datetime import datetime
from enum import Enum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Role(str, Enum):
    super_admin = "super_admin"
    normal_admin = "normal_admin"


class DeliveryMethod(str, Enum):
    text = "text"
    email = "email"
    qrcode = "qrcode"


class OrderStatus(str, Enum):
    active = "active"
    refunded = "refunded"


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[Role] = mapped_column(SAEnum(Role), nullable=False, default=Role.normal_admin)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))

    # Legacy single-file field (kept for backward compatibility / initial attachment).
    # Multi-attachments are stored in ProductAttachment.
    source_pdf_path: Mapped[str] = mapped_column(String(500), nullable=False)

    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sales_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    orders = relationship("Order", back_populates="product")
    attachments = relationship("ProductAttachment", back_populates="product", cascade="all, delete-orphan")


class ProductAttachment(Base):
    __tablename__ = "product_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id"), nullable=False, index=True)
    product = relationship("Product", back_populates="attachments")

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(600), nullable=False)
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id"), nullable=False, index=True)
    product = relationship("Product", back_populates="orders")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))

    buyer_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    buyer_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    delivery_method: Mapped[DeliveryMethod] = mapped_column(SAEnum(DeliveryMethod), nullable=False)

    access_password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    access_password_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    # Encrypted access password (for admin retrieval/copy).
    access_password_token: Mapped[str | None] = mapped_column(String(800), nullable=True)
    password_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    status: Mapped[OrderStatus] = mapped_column(SAEnum(OrderStatus), nullable=False, default=OrderStatus.active)

    operator_id: Mapped[str] = mapped_column(String(36), ForeignKey("team_members.id"), nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("team_members.id"), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("team_members.id"), nullable=True)

    last_view_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
