from __future__ import annotations

import fitz  # PyMuPDF


def watermark_encrypt_pdf_bytes(
    *,
    pdf_bytes: bytes,
    watermark_text: str,
    font_file: str | None,
    user_password: str,
    owner_password: str,
) -> bytes:
    """
    Produce a watermarked PDF, then encrypt it (AES-256) with a user password.

    Notes:
    - PDF encryption is not a perfect DRM solution, but it is a useful friction point.
    - We keep the watermark stable (no timestamp) so it is reproducible.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    fontname = "wm"
    if font_file:
        try:
            doc.insert_font(fontname=fontname, fontfile=font_file)
        except Exception:
            fontname = "helv"
    else:
        fontname = "helv"

    wm_matrix = fitz.Matrix(1, 1).prerotate(45)

    for page in doc:
        rect = page.rect
        w, h = rect.width, rect.height
        step = max(180, int(min(w, h) / 3))
        fontsize = max(10, int(min(w, h) / 35))
        for x in range(0, int(w) + step, step):
            for y in range(0, int(h) + step, step):
                origin = fitz.Point(x, y)
                page.insert_text(
                    origin,
                    watermark_text,
                    fontsize=fontsize,
                    fontname=fontname,
                    fill=(0.2, 0.2, 0.2),
                    fill_opacity=0.12,
                    morph=(origin, wm_matrix),
                    overlay=True,
                )

    try:
        # Use `write()` instead of `tobytes()` to ensure encryption is applied reliably.
        out = doc.write(
            garbage=4,
            deflate=True,
            encryption=fitz.PDF_ENCRYPT_AES_256,
            permissions=0,  # best-effort: disable print/copy/edit in compliant readers
            owner_pw=owner_password,
            user_pw=user_password,
        )
        return out
    finally:
        doc.close()

