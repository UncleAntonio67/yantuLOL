from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
import fitz
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_dumps(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@dataclass(frozen=True)
class HttpResp:
    status: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8"))


def http_request(method: str, url: str, *, headers: dict[str, str] | None = None, body: bytes | None = None) -> HttpResp:
    headers2 = dict(headers or {})
    req = Request(url, method=method.upper(), headers=headers2, data=body)
    try:
        with urlopen(req, timeout=15) as res:
            b = res.read()
            hdrs = {k.lower(): v for k, v in dict(res.headers).items()}
            return HttpResp(status=int(res.status), headers=hdrs, body=b)
    except HTTPError as e:
        b = e.read() if hasattr(e, "read") else b""
        hdrs = {k.lower(): v for k, v in dict(getattr(e, "headers", {}) or {}).items()}
        return HttpResp(status=int(e.code), headers=hdrs, body=b)
    except URLError as e:
        raise RuntimeError(f"Network error for {method} {url}: {e}") from e


def http_json(method: str, url: str, payload: Any | None, *, headers: dict[str, str] | None = None) -> HttpResp:
    hdrs = {"accept": "application/json"}
    if headers:
        hdrs.update(headers)
    body = None
    if payload is not None:
        body = _json_dumps(payload)
        hdrs["content-type"] = "application/json"
    return http_request(method, url, headers=hdrs, body=body)


def http_multipart(url: str, *, fields: dict[str, str], files: list[tuple[str, str, bytes, str]], headers: dict[str, str] | None = None) -> HttpResp:
    boundary = "----yantu-smoke-" + uuid.uuid4().hex
    lines: list[bytes] = []
    for k, v in fields.items():
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        lines.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
        lines.append(str(v).encode("utf-8"))
        lines.append(b"\r\n")
    for name, filename, content, ctype in files:
        lines.append(f"--{boundary}\r\n".encode("utf-8"))
        lines.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"))
        lines.append(f"Content-Type: {ctype}\r\n\r\n".encode("utf-8"))
        lines.append(content)
        lines.append(b"\r\n")
    lines.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(lines)

    hdrs = {"accept": "application/json", "content-type": f"multipart/form-data; boundary={boundary}"}
    if headers:
        hdrs.update(headers)
    return http_request("POST", url, headers=hdrs, body=body)


def assert_ok(resp: HttpResp, msg: str) -> None:
    if 200 <= resp.status < 300:
        return
    detail = ""
    try:
        j = resp.json()
        if isinstance(j, dict) and "detail" in j:
            detail = str(j["detail"])
        else:
            detail = str(j)
    except Exception:
        detail = resp.body[:500].decode("utf-8", errors="replace")
    raise AssertionError(f"{msg}: status={resp.status} detail={detail}")


def make_sample_pdf_bytes() -> bytes:
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        raise RuntimeError("PyMuPDF (fitz) is required for smoke test sample PDF generation") from e

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), "Yantu Smoke PDF", fontsize=20)
    b = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return b


def make_sample_png_bytes() -> bytes:
    # Minimal 1x1 PNG (RGBA)
    return bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
        "0000000A49444154789C636000000200015DDB2D0B0000000049454E44AE426082"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("YANTU_BASE_URL", "http://127.0.0.1:8000"))
    ap.add_argument("--admin-user", default=os.environ.get("YANTU_ADMIN_USER", "smoke_admin"))
    ap.add_argument("--admin-pass", default=os.environ.get("YANTU_ADMIN_PASS", "SmokeTest123!"))
    args = ap.parse_args()

    base = args.base.rstrip("/")
    admin_user = args.admin_user
    admin_pass = args.admin_pass

    run_id = uuid.uuid4().hex[:8]
    print(f"[smoke] base={base} run={run_id}")

    # 0) Backend alive
    r = http_request("GET", f"{base}/docs", headers={"accept": "text/html"})
    assert_ok(r, "backend /docs not reachable")
    print("[ok] backend reachable")

    # 1) Login
    r = http_json("POST", f"{base}/api/admin/login", {"username": admin_user, "password": admin_pass})
    assert_ok(r, "admin login failed")
    token = r.json()["access_token"]
    print("[ok] login")

    auth = {"authorization": f"Bearer {token}"}

    # 2) me
    r = http_json("GET", f"{base}/api/admin/me", None, headers=auth)
    assert_ok(r, "admin /me failed")
    me = r.json()
    assert me["username"] == admin_user
    print("[ok] /me")

    # 2.1) team create + list (super admin)
    if me.get("role") == "super_admin":
        team_user = f"smoke_team_{run_id}"
        r = http_json(
            "POST",
            f"{base}/api/admin/team",
            {"username": team_user, "password": "SmokeTeam123!", "nickname": f"Smoke Team {run_id}", "role": "normal_admin"},
            headers=auth,
        )
        assert_ok(r, "create team member failed")
        created = r.json()
        assert created["username"] == team_user

        r = http_json("GET", f"{base}/api/admin/team", None, headers=auth)
        assert_ok(r, "list team failed")
        team_list = r.json()
        assert isinstance(team_list, list)
        assert any(x.get("username") == team_user for x in team_list)
        print("[ok] team create + list")

        # Duplicate should fail.
        r = http_json(
            "POST",
            f"{base}/api/admin/team",
            {"username": team_user, "password": "SmokeTeam123!", "nickname": f"Smoke Team {run_id}", "role": "normal_admin"},
            headers=auth,
        )
        assert r.status == 400
        print("[ok] team duplicate username rejected")

    # 3) create product with multi attachments + cover image file
    pdf_bytes = make_sample_pdf_bytes()
    pdf_bytes2 = make_sample_pdf_bytes()
    png_bytes = make_sample_png_bytes()
    prod_name = f"Smoke Product {run_id}"

    r = http_multipart(
        f"{base}/api/admin/products",
        fields={"name": prod_name, "description": "smoke test product", "price": "9.99", "is_active": "true"},
        files=[
            ("cover_image_file", "__smoke.png", png_bytes, "image/png"),
            ("attachments", "__a1.pdf", pdf_bytes, "application/pdf"),
            ("attachments", "__a2.pdf", pdf_bytes2, "application/pdf"),
        ],
        headers=auth,
    )
    assert_ok(r, "create product failed")
    p = r.json()
    product_id = p["id"]
    assert p["name"] == prod_name
    assert p["cover_image"] and p["cover_image"].startswith("/static/product-images/")
    assert int(p.get("attachment_count") or 0) >= 2
    print("[ok] create product")

    # 3.1) cover image is accessible
    img_url = base + p["cover_image"]
    r = http_request("GET", img_url)
    assert_ok(r, "cover image fetch failed")
    assert r.body.startswith(b"\x89PNG\r\n\x1a\n")
    print("[ok] cover image served")

    # 3.2) products paged endpoint
    r = http_json("GET", f"{base}/api/admin/products/paged?page=1&page_size=5", None, headers=auth)
    assert_ok(r, "products paged failed")
    pj = r.json()
    assert isinstance(pj, dict)
    assert isinstance(pj.get("items"), list)
    assert isinstance(pj.get("total"), int)
    assert pj.get("page") == 1
    assert pj.get("page_size") == 5
    print("[ok] products paged")

    # 4) update product: clear cover via JSON
    r = http_json("PUT", f"{base}/api/admin/products/{product_id}", {"cover_image": None}, headers=auth)
    assert_ok(r, "update product failed")
    p2 = r.json()
    assert p2["cover_image"] is None
    print("[ok] update product (clear cover)")

    # 5) upload cover image endpoint
    r = http_multipart(
        f"{base}/api/admin/products/{product_id}/cover-image",
        fields={},
        files=[("cover_image_file", "__smoke2.png", png_bytes, "image/png")],
        headers=auth,
    )
    assert_ok(r, "upload cover image failed")
    p3 = r.json()
    assert p3["cover_image"] and p3["cover_image"].startswith("/static/product-images/")
    print("[ok] upload cover image")

    # 6) deliver text
    r = http_json(
        "POST",
        f"{base}/api/admin/orders/deliver",
        {"product_id": product_id, "buyer_id": f"buyer_{run_id}", "delivery_method": "text"},
        headers=auth,
    )
    assert_ok(r, "deliver text failed")
    d_text = r.json()
    assert d_text["delivery_method"] == "text"
    assert d_text["legal_disclaimer"] in d_text["copy_text"]
    print("[ok] deliver text + legal disclaimer")

    # 6.1) orders paged endpoint
    r = http_json("GET", f"{base}/api/admin/orders/paged?page=1&page_size=5", None, headers=auth)
    assert_ok(r, "orders paged failed")
    oj = r.json()
    assert isinstance(oj, dict)
    assert isinstance(oj.get("items"), list)
    assert isinstance(oj.get("total"), int)
    assert oj.get("page") == 1
    assert oj.get("page_size") == 5
    assert oj["total"] >= 1
    print("[ok] orders paged")

    # orders paged: created_at range filter should work
    r = http_json(
        "GET",
        f"{base}/api/admin/orders/paged?created_from=2000-01-01T00:00:00%2B00:00&created_to=2100-01-01T00:00:00%2B00:00&page=1&page_size=5",
        None,
        headers=auth,
    )
    assert_ok(r, "orders paged (created_from/to) failed")
    print("[ok] orders paged created_at filter")


    # 7) deliver qrcode + qr png endpoint
    r = http_json(
        "POST",
        f"{base}/api/admin/orders/deliver",
        {"product_id": product_id, "buyer_id": f"buyerqr_{run_id}", "delivery_method": "qrcode"},
        headers=auth,
    )
    assert_ok(r, "deliver qrcode failed")
    d_qr = r.json()
    assert d_qr["delivery_method"] == "qrcode"
    assert d_qr["qrcode_image_url"] and d_qr["qrcode_image_url"].endswith(".png")
    qr_png_url = base + d_qr["qrcode_image_url"]
    r = http_request("GET", qr_png_url)
    assert_ok(r, "qr png fetch failed")
    assert r.body.startswith(b"\x89PNG\r\n\x1a\n")
    print("[ok] deliver qrcode + qr png served")

    # 8) deliver email without SMTP should still succeed; send-email should fail if SMTP not configured
    r = http_json(
        "POST",
        f"{base}/api/admin/orders/deliver",
        {
            "product_id": product_id,
            "buyer_id": f"buyerem_{run_id}",
            "buyer_email": "buyer@example.com",
            "delivery_method": "email",
        },
        headers=auth,
    )
    assert_ok(r, "deliver email failed")
    d_em = r.json()
    assert d_em["delivery_method"] == "email"
    assert d_em["email_subject"]
    assert d_em["email_body"]
    if not d_em["smtp_configured"]:
        r2 = http_json(
            "POST",
            f"{base}/api/admin/orders/{d_em['order_id']}/send-email",
            {"subject": d_em["email_subject"], "body": d_em["email_body"]},
            headers=auth,
        )
        assert r2.status in (400, 500), f"send-email should fail without smtp, got {r2.status}"
    print("[ok] deliver email preview")

    # 9) Viewer auth + document fetch (use text order)
    order_id = d_text["order_id"]
    password = d_text["password"]
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": order_id, "password": password})
    assert_ok(r, "viewer auth failed")
    vt = r.json()["viewer_token"]
    r = http_request("GET", f"{base}/api/viewer/document/{vt}", headers={"accept": "application/pdf"})
    assert_ok(r, "viewer document failed")
    assert r.body.startswith(b"%PDF-")
    # downloaded pdf should be encrypted and require password
    doc = fitz.open(stream=r.body, filetype="pdf")
    assert doc.needs_pass, "downloaded pdf should require password"
    assert not doc.authenticate("wrong_password"), "wrong password should not authenticate"
    assert doc.authenticate(d_conf["password"]), "access password should authenticate downloaded pdf"
    doc.close()
    print("[ok] viewer pdf served")

    # 9.1) viewer meta should list attachments and allow reading the second attachment
    r = http_json("GET", f"{base}/api/viewer/meta/{vt}", None)
    assert_ok(r, "viewer meta failed")
    meta = r.json()
    atts = meta.get("attachments") or []
    assert isinstance(atts, list) and len(atts) >= 2, "expected >=2 attachments"
    att2 = atts[1]["id"]
    r = http_request("GET", f"{base}/api/viewer/document/{vt}/{att2}", headers={"accept": "application/pdf"})
    assert_ok(r, "viewer document (attachment 2) failed")
    assert r.body.startswith(b"%PDF-")
    print("[ok] viewer multi-attachment")

    # 10) Refund should revoke access immediately
    r = http_json("POST", f"{base}/api/admin/orders/{order_id}/refund", None, headers=auth)
    assert_ok(r, "refund failed")
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": order_id, "password": password})
    assert r.status == 403, f"viewer auth should be 403 after refund, got {r.status}"
    r = http_request("GET", f"{base}/api/viewer/document/{vt}", headers={"accept": "application/pdf"})
    assert r.status == 403, f"viewer document should be 403 after refund, got {r.status}"
    print("[ok] refund revokes access")

    # 10.1) Password reset should invalidate existing viewer tokens immediately
    r = http_json(
        "POST",
        f"{base}/api/admin/orders/deliver",
        {"product_id": product_id, "buyer_id": f"buyerreset_{run_id}", "delivery_method": "text"},
        headers=auth,
    )
    assert_ok(r, "deliver (for reset test) failed")
    d_reset = r.json()
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": d_reset["order_id"], "password": d_reset["password"]})
    assert_ok(r, "viewer auth (reset test) failed")
    vt2 = r.json()["viewer_token"]
    r = http_json("POST", f"{base}/api/admin/orders/{d_reset['order_id']}/reset-password", None, headers=auth)
    assert_ok(r, "reset password failed")
    new_pw = r.json()["password"]
    # old token should fail
    r = http_request("GET", f"{base}/api/viewer/document/{vt2}", headers={"accept": "application/pdf"})
    assert r.status == 401, f"old viewer token should be 401 after reset, got {r.status}"
    # old password should fail
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": d_reset["order_id"], "password": d_reset["password"]})
    assert r.status == 401, f"old password should be 401 after reset, got {r.status}"
    # new password should work
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": d_reset["order_id"], "password": new_pw})
    assert_ok(r, "viewer auth with new password failed")
    print("[ok] reset password invalidates old tokens")

    # 10.2) Confirm receipt -> enable download -> revenue recognized
    r = http_json(
        "POST",
        f"{base}/api/admin/orders/deliver",
        {"product_id": product_id, "buyer_id": f"buyerconfirm_{run_id}", "delivery_method": "text"},
        headers=auth,
    )
    assert_ok(r, "deliver (for confirm test) failed")
    d_conf = r.json()
    # viewer can read before confirm
    r = http_json("POST", f"{base}/api/viewer/auth", {"order_id": d_conf["order_id"], "password": d_conf["password"]})
    assert_ok(r, "viewer auth (confirm test) failed")
    vt3 = r.json()["viewer_token"]
    r = http_json("GET", f"{base}/api/viewer/meta/{vt3}", None)
    assert_ok(r, "viewer meta failed")
    meta = r.json()
    assert meta["can_download"] is False

    r = http_json("POST", f"{base}/api/admin/orders/{d_conf['order_id']}/confirm", None, headers=auth)
    assert_ok(r, "confirm order failed")

    # meta should allow download now
    r = http_json("GET", f"{base}/api/viewer/meta/{vt3}", None)
    assert_ok(r, "viewer meta (after confirm) failed")
    meta2 = r.json()
    assert meta2["can_download"] is True
    assert meta2.get("download_password") in (None, "")
    atts = meta2["attachments"]
    assert isinstance(atts, list) and atts, "attachments missing"
    att_id = atts[0]["id"]
    r = http_request("POST", f"{base}/api/viewer/download/{vt3}/{att_id}", headers={"accept": "application/pdf", "content-type": "application/json"}, body=_json_dumps({"password": d_conf["password"]}))
    assert_ok(r, "viewer download failed")
    assert r.body.startswith(b"%PDF-")
    print("[ok] confirm enables download")

    # 11) Analytics endpoint should respond
    r = http_json("GET", f"{base}/api/admin/dashboard/analytics", None, headers=auth)
    assert_ok(r, "dashboard analytics failed")
    a = r.json()
    assert isinstance(a.get("sales_ranking"), list)
    assert isinstance(a.get("revenue_ranking"), list)
    assert isinstance(a.get("refund_rate_by_product"), list)
    print("[ok] dashboard analytics")

    # 12) list_products sales_count reflects confirmed orders only (refund excluded)
    r = http_json("GET", f"{base}/api/admin/products", None, headers=auth)
    assert_ok(r, "list products failed")
    products = r.json()
    found = next((x for x in products if x["id"] == product_id), None)
    assert found is not None, "created product missing from list"
    assert int(found["sales_count"]) >= 1, f"sales_count should be >=1, got {found['sales_count']}"
    print("[ok] list_products sales_count aggregated")

    print("[smoke] all checks passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"[smoke][FAIL] {e}", file=sys.stderr)
        raise
