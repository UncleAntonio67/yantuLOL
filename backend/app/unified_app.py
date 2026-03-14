from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.main import create_app


class CachedStaticFiles(StaticFiles):
    """Static files with aggressive caching (safe for Vite hashed assets)."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            # Vite outputs fingerprinted filenames under /assets, safe to cache long.
            resp.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        return resp


def create_unified_app() -> FastAPI:
    """
    Unified ASGI app for platforms where running a separate frontend service is inconvenient.

    - Keeps all backend routes (/api/*, /docs, /openapi.json, /static/product-images/*).
    - Optionally serves a built React app from FRONTEND_DIST_DIR.
    """
    app = create_app()
    settings = get_settings()

    dist_dir = Path(settings.frontend_dist_dir) if settings.frontend_dist_dir else None
    if not dist_dir or not dist_dir.exists():
        return app

    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", CachedStaticFiles(directory=str(assets_dir)), name="frontend-assets")

    index_file = dist_dir / "index.html"
    if index_file.exists():

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            # Do not cache HTML so deployments update immediately.
            return FileResponse(index_file, headers={"Cache-Control": "no-store"})

    return app


app = create_unified_app()
