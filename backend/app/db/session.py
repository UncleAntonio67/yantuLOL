from __future__ import annotations

from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.core.config import get_settings
from app.models.models import Base
from sqlalchemy import text


def _make_engine():
    settings = get_settings()
    connect_args = {}
    # SQLite needs check_same_thread for FastAPI dev
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    url = settings.database_url
    # Accept plain "postgresql://" URLs by upgrading them to psycopg3 driver URLs.
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    elif url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema()


def _sqlite_has_column(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return any(r[1] == column for r in rows)  # (cid, name, type, notnull, dflt, pk)


def ensure_schema() -> None:
    """
    Minimal idempotent schema upgrades.

    This project intentionally avoids a full Alembic migration flow for MVP speed.
    For production, you should replace this with real migrations.
    """
    settings = get_settings()

    with engine.begin() as conn:
        if settings.database_url.startswith("sqlite"):
            # New table: product_attachments
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS product_attachments (
                        id TEXT PRIMARY KEY,
                        product_id TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        file_path TEXT NOT NULL,
                        sort_index INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
                        FOREIGN KEY(product_id) REFERENCES products(id)
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_attachments_product_id ON product_attachments(product_id)"))

            # Orders: revenue + confirmation workflow
            if not _sqlite_has_column(conn, "orders", "unit_price"):
                conn.execute(text("ALTER TABLE orders ADD COLUMN unit_price NUMERIC(12,2)"))
            if not _sqlite_has_column(conn, "orders", "confirmed_at"):
                conn.execute(text("ALTER TABLE orders ADD COLUMN confirmed_at DATETIME"))
            if not _sqlite_has_column(conn, "orders", "confirmed_by"):
                conn.execute(text("ALTER TABLE orders ADD COLUMN confirmed_by TEXT"))
            if not _sqlite_has_column(conn, "orders", "access_password_token"):
                conn.execute(text("ALTER TABLE orders ADD COLUMN access_password_token TEXT"))

            # Backfill unit_price for existing rows (best-effort).
            conn.execute(
                text(
                    """
                    UPDATE orders
                    SET unit_price = COALESCE(unit_price, (SELECT products.price FROM products WHERE products.id = orders.product_id), 0)
                    WHERE unit_price IS NULL
                    """
                )
            )
            return

        # Postgres (Neon) / others: best-effort additive migrations.
        try:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_password_token TEXT"))
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at)"))
        except Exception:
            pass
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_unit_price ON orders(unit_price)"))
        except Exception:
            pass
