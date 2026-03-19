from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import shutil
import threading
import time
from typing import Tuple

from app.core.config import get_settings
from app.storage import r2_storage


def _require_boto3():
    """Import boto3 lazily so local-only dev doesn't require the dependency."""
    try:
        import boto3  # type: ignore
        from botocore.config import Config  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("R2 storage backend requires boto3/botocore to be installed") from e
    return boto3, Config


@dataclass(frozen=True)
class R2Location:
    bucket: str
    key: str


def _is_r2_uri(uri: str) -> bool:
    return isinstance(uri, str) and uri.startswith("r2://")


def _parse_r2_uri(uri: str) -> R2Location:
    # r2://bucket/key...
    raw = uri[len("r2://") :]
    parts = raw.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError("Invalid r2 uri")
    return R2Location(bucket=parts[0], key=parts[1])


def _r2_uri(bucket: str, key: str) -> str:
    return f"r2://{bucket}/{key}"


def r2_enabled() -> bool:
    return r2_storage.r2_enabled()

@lru_cache
def _r2_client():
    return r2_storage.get_s3_client()


# ---- R2 hot-read cache -------------------------------------------------------
# Goal: reduce repeated cross-region fetches (Cloud Run -> R2) for popular PDFs.
# Best-effort, per-process and bounded to avoid memory bloat.
_R2_BYTES_CACHE_TTL_S = 600.0  # 10 min
_R2_BYTES_CACHE_MAX_ITEMS = 10
_R2_BYTES_CACHE_MAX_BYTES = 96 * 1024 * 1024  # 96 MiB total
_R2_BYTES_CACHE_MAX_OBJ_BYTES = 24 * 1024 * 1024  # skip caching very large objects
_r2_bytes_cache: "OrderedDict[str, tuple[float, bytes, str | None]]" = OrderedDict()
_r2_bytes_cache_total_bytes = 0
_r2_bytes_cache_lock = threading.Lock()


def _r2_cache_get(uri: str) -> tuple[bytes, str | None] | None:
    global _r2_bytes_cache_total_bytes
    now = time.time()
    with _r2_bytes_cache_lock:
        item = _r2_bytes_cache.get(uri)
        if not item:
            return None
        ts, data, ct = item
        if (now - ts) > _R2_BYTES_CACHE_TTL_S:
            try:
                del _r2_bytes_cache[uri]
                _r2_bytes_cache_total_bytes -= len(data)
            except Exception:
                pass
            return None
        try:
            _r2_bytes_cache.move_to_end(uri)
        except Exception:
            pass
        return data, ct


def _r2_cache_put(uri: str, data: bytes, ct: str | None) -> None:
    global _r2_bytes_cache_total_bytes
    if not data:
        return
    if len(data) > _R2_BYTES_CACHE_MAX_OBJ_BYTES:
        return
    with _r2_bytes_cache_lock:
        prev = _r2_bytes_cache.get(uri)
        if prev:
            _r2_bytes_cache_total_bytes -= len(prev[1])
        _r2_bytes_cache[uri] = (time.time(), data, ct)
        _r2_bytes_cache_total_bytes += len(data)
        try:
            _r2_bytes_cache.move_to_end(uri)
        except Exception:
            pass

        # Enforce both item-count and total-bytes limits.
        while len(_r2_bytes_cache) > _R2_BYTES_CACHE_MAX_ITEMS or _r2_bytes_cache_total_bytes > _R2_BYTES_CACHE_MAX_BYTES:
            try:
                _, (_, old_data, _) = _r2_bytes_cache.popitem(last=False)
                _r2_bytes_cache_total_bytes -= len(old_data)
            except Exception:
                break


def _r2_cache_invalidate(uri: str) -> None:
    global _r2_bytes_cache_total_bytes
    with _r2_bytes_cache_lock:
        item = _r2_bytes_cache.pop(uri, None)
        if item:
            _r2_bytes_cache_total_bytes -= len(item[1])


def _r2_cache_invalidate_prefix(*, bucket: str, prefix: str) -> None:
    global _r2_bytes_cache_total_bytes
    if not bucket or prefix is None:
        return
    head = f"r2://{bucket}/{prefix}"
    with _r2_bytes_cache_lock:
        for k in list(_r2_bytes_cache.keys()):
            if k.startswith(head):
                item = _r2_bytes_cache.pop(k, None)
                if item:
                    _r2_bytes_cache_total_bytes -= len(item[1])

def put_bytes(*, uri: str, data: bytes, content_type: str | None = None) -> None:
    """
    Store bytes to either local disk (plain path) or R2 (r2://bucket/key).
    """
    if _is_r2_uri(uri):
        loc = _parse_r2_uri(uri)
        extra = {}
        if content_type:
            extra["ContentType"] = content_type
        _r2_client().put_object(Bucket=loc.bucket, Key=loc.key, Body=data, **extra)
        _r2_cache_invalidate(uri)
        return

    p = Path(uri)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


def put_fileobj(*, uri: str, fileobj, content_type: str | None = None) -> None:
    """
    Store a file-like object to either local disk (plain path) or R2 (r2://bucket/key).

    This avoids reading large uploads into memory and usually uploads faster
    via multipart for large files.
    """
    if _is_r2_uri(uri):
        loc = _parse_r2_uri(uri)
        extra = {}
        if content_type:
            extra["ContentType"] = content_type
        try:
            fileobj.seek(0)
        except Exception:
            pass
        # upload_fileobj uses multipart uploads when needed.
        if extra:
            _r2_client().upload_fileobj(fileobj, loc.bucket, loc.key, ExtraArgs=extra)
        else:
            _r2_client().upload_fileobj(fileobj, loc.bucket, loc.key)
        _r2_cache_invalidate(uri)
        return

    p = Path(uri)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("wb") as f:
        try:
            fileobj.seek(0)
        except Exception:
            pass
        shutil.copyfileobj(fileobj, f)


def get_bytes(uri: str) -> tuple[bytes, str | None]:
    """
    Read bytes + content-type (if available).
    """
    if _is_r2_uri(uri):
        cached = _r2_cache_get(uri)
        if cached is not None:
            return cached
        loc = _parse_r2_uri(uri)
        obj = _r2_client().get_object(Bucket=loc.bucket, Key=loc.key)
        ct = obj.get("ContentType")
        data = obj["Body"].read()
        _r2_cache_put(uri, data, ct)
        return data, ct

    p = Path(uri)
    return p.read_bytes(), None


def delete_uri(uri: str) -> None:
    if _is_r2_uri(uri):
        loc = _parse_r2_uri(uri)
        _r2_client().delete_object(Bucket=loc.bucket, Key=loc.key)
        _r2_cache_invalidate(uri)
        return
    try:
        Path(uri).unlink()
    except FileNotFoundError:
        return


def delete_r2_prefix(*, bucket: str, prefix: str) -> None:
    """
    Best-effort delete for all objects under a prefix.
    """
    client = _r2_client()
    token: str | None = None
    while True:
        kwargs = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        contents = resp.get("Contents") or []
        if contents:
            # S3 delete_objects supports up to 1000 keys per call; list_objects_v2 also returns up to 1000.
            client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": x["Key"]} for x in contents]})
            try:
                _r2_cache_invalidate_prefix(bucket=bucket, prefix=prefix)
            except Exception:
                pass
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")


def product_attachment_uri(*, product_id: str, attachment_id: str) -> str:
    s = get_settings()
    if r2_enabled():
        key = f"source_pdfs/{product_id}/{attachment_id}.pdf"
        return _r2_uri((s.r2_bucket_name or s.r2_bucket), key)
    return str(Path(s.source_pdf_dir) / product_id / f"{attachment_id}.pdf")


def product_cover_uri(*, product_id: str, suffix: str) -> str:
    s = get_settings()
    suffix2 = suffix if suffix.startswith(".") else f".{suffix}"
    if r2_enabled():
        key = f"product_images/{product_id}{suffix2}"
        return _r2_uri((s.r2_bucket_name or s.r2_bucket), key)
    return str(Path(s.product_image_dir) / f"{product_id}{suffix2}")


def product_cover_public_path(*, product_id: str, suffix: str) -> str:
    suffix2 = suffix if suffix.startswith(".") else f".{suffix}"
    return f"/static/product-images/{product_id}{suffix2}"


def resolve_cover_r2_uri_from_name(name: str) -> str:
    """
    Map a public name like `abc.png` -> r2://bucket/product_images/abc.png
    """
    s = get_settings()
    safe = Path(name).name
    if safe != name or "/" in safe or "\\" in safe:
        raise ValueError("Invalid name")
    key = f"product_images/{safe}"
    return _r2_uri((s.r2_bucket_name or s.r2_bucket), key)





