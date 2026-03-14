from __future__ import annotations

from fastapi import Request

from app.core.config import get_settings


def public_frontend_base_url(request: Request | None = None) -> str:
    """Resolve public frontend base URL for viewer links / QR codes.

    Priority:
    1) ADMIN_FRONTEND_BASE_URL when configured to a non-localhost value.
    2) Infer from the incoming request (Cloud Run provides X-Forwarded-Proto/Host).

    This prevents accidentally generating localhost links in production.
    """
    settings = get_settings()
    configured = (settings.admin_frontend_base_url or "").strip()
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured.rstrip("/")

    if not request:
        return configured.rstrip("/") if configured else ""

    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc).strip()
    if not host:
        return ""
    return f"{proto}://{host}".rstrip("/")
