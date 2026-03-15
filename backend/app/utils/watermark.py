from __future__ import annotations

import fitz  # PyMuPDF


def watermark_pdf_bytes(*, pdf_bytes: bytes, watermark_text: str, font_file: str | None) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # If you need Chinese text, pass a font_file (TTF/TTC). Otherwise text may not render correctly.
    fontname = "wm"
    if font_file:
        try:
            doc.insert_font(fontname=fontname, fontfile=font_file)
        except Exception:
            fontname = "helv"
    else:
        fontname = "helv"

    # PyMuPDF's rotate parameter only supports 0/90/180/270.
    # For a diagonal watermark we use a transformation matrix via `morph`.
    wm_matrix = fitz.Matrix(1, 1).prerotate(45)

    for page in doc:
        rect = page.rect
        w, h = rect.width, rect.height

        # Stronger, more visible watermark for on-screen reading.
        step = max(120, int(min(w, h) / 2.9))
        fontsize = max(14, int(min(w, h) / 22))

        for x in range(0, int(w) + step, step):
            for y in range(0, int(h) + step, step):
                origin = fitz.Point(x, y)
                page.insert_text(
                    origin,
                    watermark_text,
                    fontsize=fontsize,
                    fontname=fontname,
                    fill=(0.10, 0.10, 0.10),
                    fill_opacity=0.32,
                    morph=(origin, wm_matrix),
                    overlay=True,
                )

    return doc.tobytes(garbage=4, deflate=True)
