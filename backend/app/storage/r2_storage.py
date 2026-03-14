from __future__ import annotations

import io
import os
from functools import lru_cache

from app.core.config import get_settings


def _getenv(name: str) -> str | None:
    # Prefer real environment variables (Cloud Run).
    v = os.getenv(name)
    if v is not None and str(v).strip() != "":
        return v

    # Fallback to Settings so local dev can rely on .env without installing an extra dotenv loader.
    s = get_settings()
    if name == "R2_ENDPOINT_URL":
        return s.r2_endpoint_url
    if name in {"R2_BUCKET_NAME", "R2_BUCKET"}:
        return s.r2_bucket_name or s.r2_bucket
    if name == "R2_ACCESS_KEY_ID":
        return s.r2_access_key_id
    if name == "R2_SECRET_ACCESS_KEY":
        return s.r2_secret_access_key
    if name == "R2_REGION":
        return s.r2_region
    return None


def r2_bucket_name() -> str | None:
    return _getenv("R2_BUCKET_NAME") or _getenv("R2_BUCKET")


def r2_enabled() -> bool:
    return bool(
        _getenv("R2_ENDPOINT_URL")
        and _getenv("R2_ACCESS_KEY_ID")
        and _getenv("R2_SECRET_ACCESS_KEY")
        and r2_bucket_name()
    )


def _require_boto3():
    try:
        import boto3  # type: ignore
        from botocore.config import Config  # type: ignore
    except Exception as e:  # pragma: no cover
        raise RuntimeError("R2 storage backend requires boto3/botocore to be installed") from e
    return boto3, Config


# Cached boto3 client instance (lazily created).
s3_client = None


@lru_cache
def get_s3_client():
    """
    Cloudflare R2 is S3-compatible.

    Note: we build the client lazily so local-only dev still boots if boto3 is missing.
    """
    global s3_client
    if s3_client is not None:
        return s3_client

    boto3, Config = _require_boto3()

    # Required by user spec: use os.getenv (via _getenv) to read R2 vars.
    s3_client = boto3.client(
        service_name="s3",
        endpoint_url=_getenv("R2_ENDPOINT_URL"),
        aws_access_key_id=_getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_getenv("R2_SECRET_ACCESS_KEY"),
        region_name=_getenv("R2_REGION") or "auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 5, "mode": "standard"}),
    )
    return s3_client


def upload_pdf(*, key: str, pdf_bytes: bytes, bucket: str | None = None) -> None:
    """Upload a PDF object from memory."""
    b = bucket or r2_bucket_name()
    if not b:
        raise RuntimeError("R2 bucket is not configured")
    get_s3_client().put_object(Bucket=b, Key=key, Body=pdf_bytes, ContentType="application/pdf")


def download_pdf_stream(*, key: str, bucket: str | None = None) -> io.BytesIO:
    """Download a PDF object into memory and return a BytesIO stream."""
    b = bucket or r2_bucket_name()
    if not b:
        raise RuntimeError("R2 bucket is not configured")
    obj = get_s3_client().get_object(Bucket=b, Key=key)
    data = obj["Body"].read()
    return io.BytesIO(data)


