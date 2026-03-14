from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import secrets
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, func, select

# Allow running via `python scripts/seed_neon_r2.py` without installing as a package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal, init_db
from app.models.models import DeliveryMethod, Order, OrderStatus, Product, ProductAttachment, Role, TeamMember
from app.storage import storage


SEED_PRODUCT_PREFIX = "[seed]"
SEED_USERNAME_PREFIX = "seed_"
SEED_BUYER_PREFIX = "seed_buyer_"


def _order_id() -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    suffix = secrets.token_hex(4).upper()
    return f"ORD-{now}-{suffix}"


def _password() -> str:
    # Human typable, consistent with app behavior.
    return secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12]


def _content_type_for_image(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".png":
        return "image/png"
    if suf in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suf == ".webp":
        return "image/webp"
    return "application/octet-stream"


def purge_seed_data(*, db) -> None:
    """Remove previously seeded data (best-effort)."""
    settings = get_settings()

    products = db.scalars(select(Product).where(Product.name.like(f"{SEED_PRODUCT_PREFIX}%"))).all()
    product_ids = [p.id for p in products]

    if product_ids:
        # Delete orders first (FK to products + operators).
        db.execute(delete(Order).where(Order.product_id.in_(product_ids)))

        # Delete attachments and underlying objects.
        atts = db.scalars(select(ProductAttachment).where(ProductAttachment.product_id.in_(product_ids))).all()
        for a in atts:
            try:
                storage.delete_uri(a.file_path)
            except Exception:
                pass
        db.execute(delete(ProductAttachment).where(ProductAttachment.product_id.in_(product_ids)))

        # Delete product images and any remaining objects under prefixes.
        for pid in product_ids:
            try:
                if storage.r2_enabled():
                    bucket = settings.r2_bucket_name or settings.r2_bucket
                    if bucket:
                        storage.delete_r2_prefix(bucket=str(bucket), prefix=f"source_pdfs/{pid}/")
                        storage.delete_r2_prefix(bucket=str(bucket), prefix=f"product_images/{pid}")
            except Exception:
                pass

        db.execute(delete(Product).where(Product.id.in_(product_ids)))

    # Delete seeded team members (after orders are gone).
    db.execute(delete(TeamMember).where(TeamMember.username.like(f"{SEED_USERNAME_PREFIX}%")))
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Neon(Postgres) + Cloudflare R2 with demo data.")
    parser.add_argument("--purge", action="store_true", help="Delete previous seed data first (recommended for reruns).")
    parser.add_argument("--products", type=int, default=3)
    parser.add_argument("--attachments-per-product", type=int, default=2)
    parser.add_argument("--orders-per-product", type=int, default=8)
    parser.add_argument("--confirm-rate", type=float, default=0.6)
    parser.add_argument("--refund-rate", type=float, default=0.1)

    parser.add_argument("--admin-username", default=f"{SEED_USERNAME_PREFIX}admin")
    parser.add_argument("--admin-password", default="ChangeMe123!")
    parser.add_argument("--admin-nickname", default="Seed Super Admin")
    parser.add_argument("--extra-admins", type=int, default=2)

    parser.add_argument("--pdf", default=str(Path(__file__).resolve().parent / "__smoke.pdf"))
    parser.add_argument("--cover", default=str(Path(__file__).resolve().parent / "__smoke.png"))
    parser.add_argument("--require-r2", action="store_true", help="Fail if R2 is not enabled (prod seeding).")
    args = parser.parse_args()

    settings = get_settings()
    print(f"[info] database_url startswith: {settings.database_url.split(':', 1)[0]}")
    print(f"[info] r2_enabled: {storage.r2_enabled()}")
    if args.require_r2:
        # Production seeding should target Neon/Postgres + R2, not the local SQLite dev DB.
        if settings.database_url.startswith("sqlite"):
            raise SystemExit(
                "DATABASE_URL is using sqlite. Set ENV_FILE to your production .env or export DATABASE_URL to Neon."
            )
        if not storage.r2_enabled():
            raise SystemExit(
                "R2 is not enabled. Set R2_ENDPOINT_URL/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME."
            )

    pdf_path = Path(args.pdf)
    cover_path = Path(args.cover)
    if not pdf_path.exists():
        raise SystemExit(f"missing pdf: {pdf_path}")
    if not cover_path.exists():
        raise SystemExit(f"missing cover image: {cover_path}")

    pdf_bytes = pdf_path.read_bytes()
    if not pdf_bytes.startswith(b"%PDF-"):
        raise SystemExit("invalid PDF header for seed pdf")
    cover_bytes = cover_path.read_bytes()

    # Create tables.
    init_db()

    db = SessionLocal()
    try:
        if args.purge:
            print("[seed] purging previous seed data...")
            purge_seed_data(db=db)

        # Create/ensure super admin.
        admin = db.scalar(select(TeamMember).where(TeamMember.username == args.admin_username))
        if not admin:
            admin = TeamMember(
                username=args.admin_username,
                password_hash=hash_password(args.admin_password),
                nickname=args.admin_nickname,
                role=Role.super_admin,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
            print(f"[seed] created super admin: {admin.username}")
        else:
            print(f"[seed] admin exists: {admin.username} (not changing password)")

        # Extra admins.
        for i in range(1, int(args.extra_admins) + 1):
            uname = f"{SEED_USERNAME_PREFIX}ops{i}"
            if db.scalar(select(func.count()).select_from(TeamMember).where(TeamMember.username == uname)):
                continue
            u = TeamMember(
                username=uname,
                password_hash=hash_password("ChangeMe123!"),
                nickname=f"Seed Ops {i}",
                role=Role.normal_admin,
                is_active=True,
            )
            db.add(u)
        db.commit()

        # Seed products + attachments + cover image.
        created_products: list[Product] = []
        for pi in range(1, int(args.products) + 1):
            name = f"{SEED_PRODUCT_PREFIX} Demo Product {pi}"
            existing = db.scalar(select(Product).where(Product.name == name))
            if existing:
                created_products.append(existing)
                continue

            price = Decimal("9.90") + Decimal(str(pi))
            p = Product(
                name=name,
                description=f"Seeded demo product #{pi}.",
                price=price,
                cover_image=None,
                is_active=True,
                source_pdf_path="__pending__",
            )
            db.add(p)
            db.commit()
            db.refresh(p)

            # Upload cover image (public via backend proxy route).
            cover_suffix = cover_path.suffix.lower() or ".png"
            cover_uri = storage.product_cover_uri(product_id=p.id, suffix=cover_suffix)
            storage.put_bytes(uri=cover_uri, data=cover_bytes, content_type=_content_type_for_image(cover_path))
            p.cover_image = storage.product_cover_public_path(product_id=p.id, suffix=cover_suffix)

            # Upload attachments (PDF).
            for ai in range(int(args.attachments_per_product)):
                att_id = str(uuid4())
                uri = storage.product_attachment_uri(product_id=p.id, attachment_id=att_id)
                storage.put_bytes(uri=uri, data=pdf_bytes, content_type="application/pdf")
                db.add(
                    ProductAttachment(
                        id=att_id,
                        product_id=p.id,
                        filename=f"demo_{pi}_{ai+1}.pdf",
                        file_path=uri,
                        sort_index=ai,
                    )
                )
                if ai == 0:
                    p.source_pdf_path = uri

            db.add(p)
            db.commit()
            db.refresh(p)
            created_products.append(p)
            print(f"[seed] created product: {p.id} {p.name}")

        # Seed orders.
        methods = [DeliveryMethod.text, DeliveryMethod.qrcode, DeliveryMethod.email]
        now = datetime.now(timezone.utc)
        total_orders = 0
        for p in created_products:
            for oi in range(int(args.orders_per_product)):
                order_id = _order_id()
                pw = _password()
                buyer_id = f"{SEED_BUYER_PREFIX}{p.id[:6]}_{oi+1}"
                method = methods[(oi + len(p.id)) % len(methods)]
                email = f"{buyer_id}@example.com" if method == DeliveryMethod.email else None

                confirmed = (secrets.randbelow(10_000) / 10_000.0) < float(args.confirm_rate)
                refunded = (secrets.randbelow(10_000) / 10_000.0) < float(args.refund_rate)
                if refunded:
                    confirmed = True

                created_at = now - timedelta(days=secrets.randbelow(30), hours=secrets.randbelow(24))

                o = Order(
                    id=order_id,
                    product_id=p.id,
                    unit_price=p.price,
                    buyer_id=buyer_id,
                    buyer_email=email,
                    delivery_method=method,
                    access_password_hash=hash_password(pw),
                    access_password_last4=pw[-4:],
                    password_version=1,
                    status=OrderStatus.refunded if refunded else OrderStatus.active,
                    operator_id=admin.id,
                    created_at=created_at,
                    confirmed_at=(created_at + timedelta(hours=1)) if confirmed else None,
                    confirmed_by=admin.id if confirmed else None,
                    refunded_at=(created_at + timedelta(days=1)) if refunded else None,
                    refunded_by=admin.id if refunded else None,
                    view_count=int(secrets.randbelow(15)),
                    last_view_at=(created_at + timedelta(hours=2)) if confirmed else None,
                )
                db.add(o)
                total_orders += 1

        db.commit()
        print(f"[seed] created orders: {total_orders}")

        print("")
        print("[seed] Login credentials (admin UI):")
        print(f"  username: {args.admin_username}")
        print(f"  password: {args.admin_password}")
        print("")
        print("[seed] Notes:")
        print("  - Viewer passwords are random per order and are not printed by default.")
        print("  - If you use unified Cloud Run hosting, set ADMIN_FRONTEND_BASE_URL to your Cloud Run URL.")

    finally:
        db.close()


if __name__ == "__main__":
    main()

