from __future__ import annotations

import fitz  # PyMuPDF


def watermark_pdf_bytes(*, pdf_bytes: bytes, watermark_text: str, font_file: str | None) -> bytes:
    """Generate an inline-view watermarked PDF.

    This endpoint is used for *online reading*. We must avoid 500s as much as
    possible: if watermarking fails for any reason, we return the original PDF.

    Watermark should be readable but not overpower the content.
    """

    if not pdf_bytes:
        return pdf_bytes

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return pdf_bytes

    try:
        # If you need Chinese text, pass a font_file (TTF/TTC). Otherwise text may not render.
        fontname = "wm"
        if font_file:
            try:
                doc.insert_font(fontname=fontname, fontfile=font_file)
            except Exception:
                fontname = "helv"
        else:
            fontname = "helv"

        wm_matrix = fitz.Matrix(1, 1).prerotate(45)

        # Avoid repeated exceptions when helv cannot encode watermark text.
        wm_text = watermark_text
        if fontname == "helv":
            ascii_only = watermark_text.encode("utf-8", errors="ignore").decode("ascii", errors="ignore").strip()
            wm_text = ascii_only or "WATERMARK"

        for page in doc:
            rect = page.rect
            w, h = rect.width, rect.height

            # Lighter and sparser watermark for readability.
            step = max(220, int(min(w, h) / 2.0))
            fontsize = max(10, int(min(w, h) / 32))

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
                            fill_opacity=0.09,
                            morph=(origin, wm_matrix),
                            overlay=True,
                        )
                    except Exception:
                        # Do not fail the request. Best-effort: skip this stamp.
                        continue

        return doc.tobytes(garbage=4, deflate=True)
    except Exception:
        return pdf_bytes
    finally:
        try:
            doc.close()
        except Exception:
            pass
