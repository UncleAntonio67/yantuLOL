from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin.routes import router as admin_router
from app.api.viewer.routes import router as viewer_router
from app.core.config import get_settings
from app.db.session import init_db
from app.services.bootstrap import ensure_bootstrap_super_admin
from app.storage import storage


def _guess_image_content_type(suffix: str) -> str:
    s = (suffix or "").lower()
    if s == ".png":
        return "image/png"
    if s in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if s == ".webp":
        return "image/webp"
    return "application/octet-stream"


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()

    # Local dev can store on disk; Cloud Run deployments should use R2.
    if not storage.r2_enabled():
        Path(settings.source_pdf_dir).mkdir(parents=True, exist_ok=True)
        Path(settings.product_image_dir).mkdir(parents=True, exist_ok=True)

    # Kept for backward-compat scripts; current code does not persist generated PDFs by default.
    Path(settings.generated_pdf_dir).mkdir(parents=True, exist_ok=True)

    # For MVP/dev, create tables automatically. For production, replace with Alembic migrations.
    init_db()
    ensure_bootstrap_super_admin()
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    if settings.environment == "dev":
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
    app.include_router(viewer_router, prefix="/api/viewer", tags=["viewer"])

    # Public marketing images only (NOT the protected PDF content).
    @app.get("/static/product-images/{name}")
    def product_image(name: str) -> Response:
        safe = Path(name).name
        if safe != name:
            raise HTTPException(status_code=400, detail="Invalid name")

        if storage.r2_enabled():
            uri = storage.resolve_cover_r2_uri_from_name(safe)
            try:
                data, ct = storage.get_bytes(uri)
            except Exception:
                raise HTTPException(status_code=404, detail="Not found")
            media_type = ct or _guess_image_content_type(Path(safe).suffix)
        else:
            p = Path(settings.product_image_dir) / safe
            if not p.exists() or not p.is_file():
                raise HTTPException(status_code=404, detail="Not found")
            data = p.read_bytes()
            media_type = _guess_image_content_type(p.suffix)

        headers = {
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-origin",
        }
        return Response(content=data, media_type=media_type, headers=headers)

    return app


app = create_app()
