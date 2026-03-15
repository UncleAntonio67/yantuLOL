from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from app.core.config import get_settings


def _derive_key_from_jwt_secret(jwt_secret: str) -> str:
    # Fernet expects a urlsafe base64-encoded 32-byte key.
    raw = hashlib.sha256((jwt_secret + "|password-vault").encode("utf-8")).digest()
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _require_cryptography():
    try:
        from cryptography.fernet import Fernet  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("Password vault requires cryptography to be installed") from e
    return Fernet


@lru_cache
def _fernet():
    settings = get_settings()
    Fernet = _require_cryptography()
    key = (settings.password_vault_key or "").strip() or _derive_key_from_jwt_secret(settings.jwt_secret_key)
    return Fernet(key.encode("ascii"))


def encrypt_password(plain: str) -> str:
    """Encrypt an order access password for storage."""
    t = (plain or "").strip()
    if not t:
        raise ValueError("empty password")
    return _fernet().encrypt(t.encode("utf-8")).decode("ascii")


def decrypt_password(token: str) -> str:
    """Decrypt an encrypted order access password."""
    t = (token or "").strip()
    if not t:
        raise ValueError("empty token")
    out = _fernet().decrypt(t.encode("ascii"))
    return out.decode("utf-8")
