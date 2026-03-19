from __future__ import annotations

import hashlib

import fitz  # PyMuPDF


def _is_openable_pdf_bytes(data: bytes) -> bool:
    if not data:
        return False
    try:
        d = fitz.open(stream=data, filetype="pdf")
        try:
            # Encrypted PDFs will set needs_pass=True, which is expected here.
            return int(getattr(d, "page_count", 0) or 0) > 0 or bool(getattr(d, "needs_pass", False))
        finally:
            d.close()
    except Exception:
        return False


def _normalize_owner_password(owner_password: str) -> str:
    """Normalize owner password to a stable short string.

    PyMuPDF/PDF encryption can be picky about length/charset. We only use the
    owner password to set PDF permissions (not for user access), so deriving a
    deterministic value is safe.
    """

    s = (owner_password or "").strip() or "owner"
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]


def encrypt_pdf_bytes(*, pdf_bytes: bytes, user_password: str, owner_password: str) -> bytes:
    """Encrypt a PDF (AES-256) with a user-open password.

    This must not silently fail: a downloaded PDF must require the password.
    """

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return doc.write(
            garbage=4,
            deflate=True,
            # Classic layout improves compatibility with mobile WebViews and some built-in PDF viewers.
            use_objstms=False,
            use_xref_streams=False,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            permissions=0,  # best-effort: disable print/copy/edit in compliant readers
            owner_pw=_normalize_owner_password(owner_password),
            user_pw=(user_password or "").strip(),
        )
    finally:
        doc.close()


def watermark_encrypt_pdf_bytes(
    *,
    pdf_bytes: bytes,
    watermark_text: str,
    font_file: str | None,
    user_password: str,
    owner_password: str,
) -> bytes:
    """Produce a watermarked PDF, then encrypt it (AES-256) with a user password.

    Watermarking is best-effort. Encryption is required. If watermark drawing
    fails (font/encoding/corrupt pdf), we still return an encrypted PDF.
    """

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    try:
        fontname = "wm"
        if font_file:
            try:
                doc.insert_font(fontname=fontname, fontfile=font_file)
            except Exception:
                fontname = "helv"
        else:
            fontname = "helv"

        # Diagonal watermark via transformation matrix.
        wm_matrix = fitz.Matrix(1, 1).prerotate(45)

        # If we fell back to helv and the watermark contains CJK, helv may fail to encode.
        wm_text = watermark_text
        if fontname == "helv":
            ascii_only = watermark_text.encode("utf-8", errors="ignore").decode("ascii", errors="ignore").strip()
            wm_text = ascii_only or "WATERMARK"

        for page in doc:
            rect = page.rect
            w, h = rect.width, rect.height
            step = max(160, int(min(w, h) / 2.7))
            fontsize = max(10, int(min(w, h) / 30))

            for x in range(0, int(w) + step, step):
                for y in range(0, int(h) + step, step):
                    origin = fitz.Point(x, y)
                    try:
                        page.insert_text(
                            origin,
                            wm_text,
                            fontsize=fontsize,
                            fontname=fontname,
                            fill=(0.25, 0.25, 0.25),
                            fill_opacity=0.28,
                            morph=(origin, wm_matrix),
                            overlay=True,
                        )
                    except Exception:
                        # Best-effort: skip this stamp. Never block download.
                        continue

        try:
            out = doc.write(
                garbage=4,
                deflate=True,
                use_objstms=False,
                use_xref_streams=False,
                encryption=fitz.PDF_ENCRYPT_AES_256,
                permissions=0,
                owner_pw=_normalize_owner_password(owner_password),
                user_pw=(user_password or "").strip(),
            )
            if not _is_openable_pdf_bytes(out):
                raise RuntimeError("encrypted pdf bytes are not openable")
            return out
        except Exception:
            # Last resort: drop watermark but keep encryption.
            raw = doc.write(garbage=4, deflate=True, use_objstms=False, use_xref_streams=False)
            return encrypt_pdf_bytes(pdf_bytes=raw, user_password=user_password, owner_password=owner_password)
    finally:
        doc.close()

