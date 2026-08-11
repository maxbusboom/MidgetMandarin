"""PDF content extraction via PyMuPDF.

Text-layer PDFs only, per PLAN.md's v1 scope — scanned/image-only PDFs raise
NoTextLayerError rather than being silently mishandled. OCR is a separate,
larger scope decision for a later phase.

Extracts text and embedded images interleaved in reading order per page
(rather than one flattened string) so the reflow view can inline figures at
roughly their original position instead of dropping them. Text runs carry
jieba POS-bucket tags for noun/verb/adjective highlighting.
"""

import base64

import pymupdf

from segmentation import tag_tokens


class NoTextLayerError(Exception):
    """The PDF has no extractable text (scanned/image-only)."""


def extract_content(path: str) -> dict:
    doc = pymupdf.open(path)
    try:
        pages = []
        flat_text_parts = []
        for page in doc:
            items = []
            for block in page.get_text("dict")["blocks"]:
                if block["type"] == 0:
                    text = "".join(
                        span["text"] for line in block["lines"] for span in line["spans"]
                    )
                    if not text.strip():
                        continue
                    items.append({"type": "text", "tokens": tag_tokens(text)})
                    flat_text_parts.append(text)
                elif block["type"] == 1 and block.get("image"):
                    items.append(
                        {
                            "type": "image",
                            "data": base64.b64encode(block["image"]).decode("ascii"),
                            "ext": block.get("ext", "png"),
                            "width": block.get("width"),
                            "height": block.get("height"),
                        }
                    )
            pages.append(items)
        page_count = doc.page_count
    finally:
        doc.close()

    flat_text = "\n\n".join(flat_text_parts)
    if not flat_text.strip():
        raise NoTextLayerError(path)

    return {"page_count": page_count, "text": flat_text, "blocks": pages}


def _word_boxes(page) -> list[dict]:
    """Word-level boxes for click-to-dictionary hit-testing.

    page.get_text("words") only splits on whitespace, which Chinese doesn't
    use — an entire line comes back as "one word". Instead, pull
    per-character boxes from rawdict, run jieba over each span's exact text
    (same segmentation used for Reflow highlighting), and union the
    constituent characters' boxes per jieba token. jieba's cut is a strict
    partition of the input string, so walking it in lockstep with the char
    list always stays aligned.
    """
    boxes = []
    for block in page.get_text("rawdict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                chars = span["chars"]
                text = "".join(c["c"] for c in chars)
                if not text.strip():
                    continue
                idx = 0
                for word, bucket in tag_tokens(text):
                    word_chars = chars[idx : idx + len(word)]
                    idx += len(word)
                    if not word.strip():
                        continue
                    boxes.append(
                        {
                            "text": word,
                            "pos": bucket,
                            "x0": min(c["bbox"][0] for c in word_chars),
                            "y0": min(c["bbox"][1] for c in word_chars),
                            "x1": max(c["bbox"][2] for c in word_chars),
                            "y1": max(c["bbox"][3] for c in word_chars),
                        }
                    )
    return boxes


def render_page(path: str, page_number: int, dpi: int = 150) -> dict:
    """Rasterizes one page plus its word bounding boxes, for the
    original-layout fallback view (figures/equations/columns render exactly
    as in the source PDF since this is just a picture of the real page)."""
    doc = pymupdf.open(path)
    try:
        if page_number < 0 or page_number >= doc.page_count:
            raise IndexError(f"page {page_number} out of range (0..{doc.page_count - 1})")
        page = doc[page_number]
        pix = page.get_pixmap(dpi=dpi)
        scale = dpi / 72.0
        return {
            "image_data": base64.b64encode(pix.tobytes("png")).decode("ascii"),
            "width": pix.width,
            "height": pix.height,
            # boxes are in PDF points (72 dpi); scale to match the rendered
            # pixmap so the frontend can overlay them directly.
            "words": [
                {
                    "text": w["text"],
                    "pos": w["pos"],
                    "x0": w["x0"] * scale,
                    "y0": w["y0"] * scale,
                    "x1": w["x1"] * scale,
                    "y1": w["y1"] * scale,
                }
                for w in _word_boxes(page)
            ],
        }
    finally:
        doc.close()
