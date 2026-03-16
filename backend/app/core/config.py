from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _project_root() -> Path:
    # backend/app/core/config.py -> parents[3] == project root
    return Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_project_root() / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "yantu-redoc"
    environment: str = "dev"

    base_url: str = "http://localhost:8000"
    admin_frontend_base_url: str = "http://localhost:5173"

    # Keep sqlite as default so project boots without Postgres.
    database_url: str = "sqlite+pysqlite:///" + str(_project_root() / "backend" / "dev.db")

    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 720
    viewer_token_expire_minutes: int = 15

    # Optional: store order access passwords in encrypted form so admins can retrieve/copy later.
    # If not set, it will be derived from JWT_SECRET_KEY (rotating JWT secret will break decrypting old passwords).
    password_vault_key: str | None = None


    # Storage
    source_pdf_dir: str = str(_project_root() / "backend" / "storage" / "source_pdfs")
    product_image_dir: str = str(_project_root() / "backend" / "storage" / "product_images")
    generated_pdf_dir: str = str(_project_root() / "backend" / "storage" / "generated_pdfs")
    generated_pdf_ttl_days: int = 7

    # Cloudflare R2 (S3-compatible) optional storage backend.
    # If these are set, the app will store source PDFs and product cover images in R2
    # instead of local disk. This is required for Cloud Run deployments.
    r2_endpoint_url: str | None = None
    r2_bucket: str | None = None
    r2_bucket_name: str | None = None  # accepts env var R2_BUCKET_NAME
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    # R2 commonly uses "auto", but keep it configurable.
    r2_region: str | None = "auto"
    # Serve built frontend (optional, used for single-container deployments)
    frontend_dist_dir: str | None = None

    # Watermarking: important when buyer_id contains Chinese. Prefer a TTF/TTC file.
    watermark_font_file: str | None = None

    # Legal disclaimer (used in delivery messages)
    legal_disclaimer_text: str = (
        "【法律声明/版权提示】本资料仅限购买者本人学习使用，严禁转载、分享、二次传播或用于商业用途。"
        "本资料已写入可追溯水印与访问日志，如发生泄露将依法追责。"
    )

    # SMTP
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_use_tls: bool = True

    # Bootstrap (one-time) super admin creation.
    # If your database has no team_members, and these env vars are set,
    # the server will create a super admin at startup.
    # Remove these env vars after the first successful boot.
    bootstrap_admin_username: str | None = None
    bootstrap_admin_password: str | None = None
    bootstrap_admin_nickname: str = "Super Admin"

    def resolved_watermark_font_file(self) -> str | None:
        if self.watermark_font_file:
            return self.watermark_font_file

        # Windows dev convenience (Chinese-capable font)
        win = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyh.ttc"
        if win.exists():
            return str(win)

        # Cloud Run / Debian: fonts-noto-cjk installs Noto TTC/OTF under /usr/share/fonts.
        linux_candidates = [
            Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            Path("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf"),
            Path("/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf"),
            Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
            Path("/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf"),
            Path("/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf"),
        ]
        for c in linux_candidates:
            if c.exists():
                return str(c)

        return None


@lru_cache
def get_settings() -> Settings:
    env_file = os.environ.get("ENV_FILE")
    if env_file:
        return Settings(_env_file=env_file)

    # Prefer a local dev env file when present to avoid accidentally using production creds.
    local = _project_root() / ".env.local"
    if local.exists():
        return Settings(_env_file=str(local))

    return Settings()





