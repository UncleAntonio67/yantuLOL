from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.models import Role, TeamMember


def ensure_bootstrap_super_admin() -> None:
    """
    Create the first super admin if the DB is empty and bootstrap env vars exist.

    This is meant for production deployments where there is no interactive DB access.
    Remove BOOTSTRAP_* env vars after first boot.
    """

    settings = get_settings()
    username = (settings.bootstrap_admin_username or "").strip()
    password = settings.bootstrap_admin_password or ""
    nickname = (settings.bootstrap_admin_nickname or "Super Admin").strip() or "Super Admin"

    if not username or not password:
        return

    db: Session = SessionLocal()
    try:
        count = db.scalar(select(func.count()).select_from(TeamMember)) or 0
        if int(count) > 0:
            return

        admin = TeamMember(
            username=username,
            password_hash=hash_password(password),
            nickname=nickname,
            role=Role.super_admin,
            is_active=True,
        )
        db.add(admin)
        db.commit()
    finally:
        db.close()

