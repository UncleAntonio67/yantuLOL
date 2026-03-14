from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import select

# Allow running via `python scripts/create_admin.py` without installing as a package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.security import hash_password
from app.db.session import SessionLocal, init_db
from app.models.models import Role, TeamMember


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an admin user in the database.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--nickname", required=True)
    parser.add_argument("--role", choices=[r.value for r in Role], default=Role.super_admin.value)
    args = parser.parse_args()

    if len(args.password) < 8:
        raise SystemExit("password must be at least 8 characters")

    init_db()
    db = SessionLocal()
    try:
        existing = db.scalar(select(TeamMember).where(TeamMember.username == args.username))
        if existing:
            raise SystemExit("username already exists")
        user = TeamMember(
            username=args.username,
            password_hash=hash_password(args.password),
            nickname=args.nickname,
            role=Role(args.role),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"created: id={user.id} username={user.username} role={user.role.value}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
