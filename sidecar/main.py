"""Midget Mandarin NLP sidecar.

Local-only HTTP service the Tauri app talks to for PDF extraction,
segmentation/POS tagging, dictionary lookups, and Anki export. Runs as a
Tauri sidecar process in production, but can also run standalone (see
PLAN.md §5.4/5.6) while iterating on sidecar code without restarting the
whole app.
"""

import os

import uvicorn
from fastapi import FastAPI

app = FastAPI(title="Midget Mandarin sidecar")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def main() -> None:
    port = int(os.environ.get("MIDGET_MANDARIN_SIDECAR_PORT", "7420"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
