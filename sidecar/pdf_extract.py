"""PDF text-layer extraction via PyMuPDF.

Text-layer PDFs only, per PLAN.md's v1 scope — scanned/image-only PDFs raise
NoTextLayerError rather than being silently mishandled. OCR is a separate,
larger scope decision for a later phase.
"""

import pymupdf


class NoTextLayerError(Exception):
    """The PDF has no extractable text (scanned/image-only)."""


def extract_text(path: str) -> dict:
    doc = pymupdf.open(path)
    try:
        pages = [page.get_text("text") for page in doc]
        page_count = doc.page_count
    finally:
        doc.close()

    text = "\n\n".join(page.strip() for page in pages)
    if not text.strip():
        raise NoTextLayerError(path)

    return {"page_count": page_count, "text": text}
