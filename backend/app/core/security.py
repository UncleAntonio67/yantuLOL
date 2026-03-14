from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import secrets

from jose import jwt
from passlib.context import CryptContext

from app.core.config import get_settings


# Avoid bcrypt backend issues on some Windows/Python combinations.
# PBKDF2 is widely supported and good enough for an internal admin system MVP.
_pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_admin_access_token(*, subject: str, role: str, nickname: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "typ": "admin",
        "sub": subject,
        "role": role,
        "nickname": nickname,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_token_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_viewer_token(*, order_id: str, password_version: int) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "typ": "viewer",
        "sub": order_id,
        "pv": password_version,
        "jti": secrets.token_urlsafe(16),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.viewer_token_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
