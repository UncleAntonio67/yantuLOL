from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles


REPO_ROOT = Path(__file__).resolve().parent
DIST_DIR = REPO_ROOT / "frontend" / "dist"
ASSETS_DIR = DIST_DIR / "assets"

BACKEND_BASE = os.environ.get("YANTU_BACKEND_BASE", "http://127.0.0.1:8000").rstrip("/")

# Hop-by-hop headers (RFC 7230) must not be forwarded.
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _filter_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers:
        lk = k.lower()
        if lk in HOP_BY_HOP:
            continue
        # Let the client library compute content-length.
        if lk == "content-length":
            continue
        out[k] = v
    return out


async def proxy_api(request: Request) -> Response:
    """
    Serve the built frontend from `frontend/dist`, and proxy `/api/*` to backend.

    This avoids needing Vite in environments where esbuild spawn is blocked.
    """
    client: httpx.AsyncClient = request.app.state.client
    url = f"{BACKEND_BASE}{request.url.path}"
    if request.url.query:
        url += f"?{request.url.query}"

    body = await request.body()
    headers = _filter_headers(request.headers.items())

    resp = await client.request(
        request.method,
        url,
        content=body if body else None,
        headers=headers,
        timeout=30,
        follow_redirects=False,
    )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=_filter_headers(resp.headers.items()),
        media_type=resp.headers.get("content-type"),
    )


async def spa_fallback(request: Request) -> Response:
    # Serve actual built files if present.
    path = request.path_params.get("path") or ""
    candidate = (DIST_DIR / path).resolve()
    if str(candidate).startswith(str(DIST_DIR.resolve())) and candidate.is_file():
        return FileResponse(candidate)

    # Otherwise return SPA entry.
    index = DIST_DIR / "index.html"
    if not index.exists():
        return Response(
            content="frontend/dist not found. Run `npm run build` in frontend first.",
            status_code=500,
            media_type="text/plain",
        )
    return FileResponse(index)


async def on_startup() -> None:
    app.state.client = httpx.AsyncClient()


async def on_shutdown() -> None:
    client: httpx.AsyncClient = app.state.client
    await client.aclose()


routes = [
    Route("/api/{path:path}", proxy_api, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
]

if ASSETS_DIR.exists():
    routes.append(Mount("/assets", app=StaticFiles(directory=str(ASSETS_DIR)), name="assets"))

routes.append(Route("/{path:path}", spa_fallback, methods=["GET", "HEAD"]))
routes.append(Route("/", spa_fallback, methods=["GET", "HEAD"]))

app = Starlette(debug=False, routes=routes, on_startup=[on_startup], on_shutdown=[on_shutdown])

