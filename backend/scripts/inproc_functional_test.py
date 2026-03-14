from __future__ import annotations

import uuid

import sys
from pathlib import Path

# Ensure `backend/` is on sys.path so `import app` works when running from scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datetime import datetime, timedelta, timezone

import fitz
from fastapi.testclient import TestClient

from app.main import app


def _make_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    b = doc.write()
    doc.close()
    return b


def _assert_ok(r, msg: str) -> None:
    if 200 <= r.status_code < 300:
        return
    try:
        detail = r.json()
    except Exception:
        detail = r.text
    raise AssertionError(f"{msg}: status={r.status_code} body={detail}")


def main() -> int:
    run_id = uuid.uuid4().hex[:8]
    c = TestClient(app)

    r = c.get("/docs")
    _assert_ok(r, "docs failed")
    print("[ok] /docs")

    admin_user = "smoke_admin"
    admin_pass = "SmokeTest123!"
    r = c.post("/api/admin/login", json={"username": admin_user, "password": admin_pass})
    _assert_ok(r, "login failed")
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[ok] admin login")

    pdf1 = _make_pdf_bytes(f"hello-{run_id}-1")
    pdf2 = _make_pdf_bytes(f"hello-{run_id}-2")
    files = [
        ("attachments", (f"a_{run_id}_1.pdf", pdf1, "application/pdf")),
        ("attachments", (f"a_{run_id}_2.pdf", pdf2, "application/pdf")),
    ]
    data = {"name": f"Smoke Product {run_id}", "description": "desc", "price": "9.99", "is_active": "true"}
    r = c.post("/api/admin/products", data=data, files=files, headers=headers)
    _assert_ok(r, "create product failed")
    product_id = r.json()["id"]
    print("[ok] create product")

    buyer_id = f"buyer_{run_id}"
    r = c.post(
        "/api/admin/orders/deliver",
        json={"product_id": product_id, "buyer_id": buyer_id, "delivery_method": "text"},
        headers=headers,
    )
    _assert_ok(r, "deliver failed")
    order_id = r.json()["order_id"]
    access_pw = r.json()["password"]
    print("[ok] deliver")

    r = c.post("/api/viewer/auth", json={"order_id": order_id, "password": access_pw})
    _assert_ok(r, "viewer auth failed")
    vt = r.json()["viewer_token"]
    print("[ok] viewer auth")

    r = c.post(f"/api/admin/orders/{order_id}/confirm", headers=headers)
    _assert_ok(r, "confirm failed")
    print("[ok] confirm")

    r = c.get(f"/api/viewer/meta/{vt}")
    _assert_ok(r, "viewer meta failed")
    meta = r.json()
    assert meta["can_download"] is True
    att_id = meta["attachments"][0]["id"]
    print("[ok] meta can_download")

    r = c.post(f"/api/viewer/download/{vt}/{att_id}", json={"password": access_pw})
    _assert_ok(r, "viewer download failed")
    b = r.content
    assert b.startswith(b"%PDF-")
    doc = fitz.open(stream=b, filetype="pdf")
    assert doc.needs_pass, "downloaded pdf should require password"
    assert not doc.authenticate("wrong_password"), "wrong password should not authenticate"
    assert doc.authenticate(access_pw), "access password should authenticate downloaded pdf"
    doc.close()
    print("[ok] download encrypted + password stable")

    now = datetime.now(timezone.utc)
    created_from = (now + timedelta(days=365)).isoformat()
    r = c.get(
        "/api/admin/orders/paged",
        params={"created_from": created_from, "page": 1, "page_size": 10},
        headers=headers,
    )
    _assert_ok(r, "orders paged with created_from failed")
    j = r.json()
    assert isinstance(j.get("items"), list)
    assert len(j["items"]) == 0, "future created_from should return empty items"
    print("[ok] created_from filter")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

