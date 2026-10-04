"""OCR helper: raw text from uploaded PDF or image medical files.

PDFs: use the embedded text layer when present (fast, exact); fall back to
rasterize + Tesseract for scanned pages. Images (incl. multi-frame TIFF): Tesseract.

Requires the Tesseract binary (apt install tesseract-ocr / brew install tesseract).
"""
import logging
from dataclasses import dataclass
from pathlib import Path

import fitz  # PyMuPDF
import pytesseract
from anyio import to_thread
from PIL import Image, ImageOps, ImageSequence

from app.core.config import settings
from app.services.intelligence.errors import OCRError

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class PageText:
    page_number: int  # 1-based
    text: str
    method: str  # "text_layer" | "ocr"


async def extract_pages(path: Path, content_type: str) -> list[PageText]:
    """Extract per-page text. CPU-bound, so it runs in a worker thread."""
    return await to_thread.run_sync(_extract_pages_sync, path, content_type)


def _extract_pages_sync(path: Path, content_type: str) -> list[PageText]:
    try:
        if content_type == "application/pdf":
            pages = _extract_pdf(path)
        elif content_type.startswith("image/"):
            pages = _extract_image(path)
        else:
            raise OCRError(f"Unsupported content type for OCR: {content_type}")
    except pytesseract.TesseractNotFoundError as exc:
        raise OCRError("Tesseract OCR is not installed on the server.") from exc
    except OCRError:
        raise
    except Exception as exc:  # corrupt/unsupported files (fitz, PIL, ...)
        raise OCRError(f"Could not read the file ({type(exc).__name__}).") from exc

    total_chars = sum(len(p.text) for p in pages)
    logger.info(
        "OCR finished: %d pages, %d chars, %d via OCR",
        len(pages), total_chars, sum(p.method == "ocr" for p in pages),
    )
    return pages


def _extract_pdf(path: Path) -> list[PageText]:
    pages: list[PageText] = []
    with fitz.open(str(path)) as doc:
        if doc.needs_pass:
            raise OCRError("PDF is password-protected.")
        if doc.page_count > settings.max_pages_per_file:
            raise OCRError(f"PDF has too many pages (max {settings.max_pages_per_file}).")

        for index, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            method = "text_layer"
            if len(text) < settings.ocr_min_text_chars:  # likely a scanned page
                pix = page.get_pixmap(dpi=settings.ocr_dpi)
                image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                ocr_text = _ocr_image(image)
                if len(ocr_text) > len(text):
                    text, method = ocr_text, "ocr"
            pages.append(PageText(page_number=index, text=text, method=method))
    return pages


def _extract_image(path: Path) -> list[PageText]:
    pages: list[PageText] = []
    with Image.open(path) as img:
        for index, frame in enumerate(ImageSequence.Iterator(img), start=1):
            if index > settings.max_pages_per_file:
                raise OCRError(f"Image has too many frames (max {settings.max_pages_per_file}).")
            pages.append(PageText(page_number=index, text=_ocr_image(frame.copy()), method="ocr"))
    return pages


def _ocr_image(image: Image.Image) -> str:
    image = ImageOps.exif_transpose(image)          # honor phone-camera rotation
    image = ImageOps.autocontrast(image.convert("L"))  # grayscale + contrast for scans
    return pytesseract.image_to_string(image, lang=settings.ocr_language).strip()
