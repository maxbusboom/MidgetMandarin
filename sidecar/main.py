"""Midget Mandarin NLP sidecar.

Local-only HTTP service the Tauri app talks to for PDF extraction,
segmentation/POS tagging, dictionary lookups, and Anki export. Runs as a
Tauri sidecar process in production, but can also run standalone (see
PLAN.md §5.4/5.6) while iterating on sidecar code without restarting the
whole app.
"""

import os

import pymupdf
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from pdf_extract import NoTextLayerError, extract_content, render_page

app = FastAPI(title="Midget Mandarin sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


class ExtractRequest(BaseModel):
    path: str


class PageRequest(BaseModel):
    path: str
    page_number: int
    dpi: int = 150


@app.post("/extract")
def extract(req: ExtractRequest) -> dict:
    try:
        return extract_content(req.path)
    except pymupdf.FileNotFoundError:
        raise HTTPException(status_code=404, detail="file not found")
    except NoTextLayerError:
        raise HTTPException(
            status_code=422,
            detail="This PDF has no extractable text layer — OCR isn't supported yet.",
        )
    except pymupdf.FileDataError as e:
        raise HTTPException(status_code=400, detail=f"could not read PDF: {e}")


@app.post("/page")
def page(req: PageRequest) -> dict:
    try:
        return render_page(req.path, req.page_number, req.dpi)
    except pymupdf.FileNotFoundError:
        raise HTTPException(status_code=404, detail="file not found")
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except pymupdf.FileDataError as e:
        raise HTTPException(status_code=400, detail=f"could not read PDF: {e}")


def main() -> None:
    port = int(os.environ.get("MIDGET_MANDARIN_SIDECAR_PORT", "7420"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
