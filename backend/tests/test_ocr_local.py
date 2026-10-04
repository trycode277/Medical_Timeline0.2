"""Local OCR checks on generated synthetic PDFs. Run: pytest -m ocr
Scanned-file tests are skipped automatically when the tesseract binary is missing."""
import re
import shutil

import pytest

from app.services.intelligence.errors import OCRError
from app.services.intelligence.ocr import _extract_pages_sync
from scripts.generate_mock_records import EXPECTED, generate_all

pytestmark = pytest.mark.ocr
needs_tesseract = pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract not installed")


@pytest.fixture(scope="module")
def mock_files(tmp_path_factory):
    return generate_all(tmp_path_factory.mktemp("mock_records"))


def normalized(pages):
    return re.sub(r"\s+", " ", " ".join(p.text for p in pages)).lower()


def found_ratio(pages, markers):
    text = normalized(pages)
    return sum(m in text for m in markers) / len(markers)


@pytest.mark.parametrize("name", list(EXPECTED))
def test_text_layer_pdfs_are_read_without_ocr(mock_files, name):
    pages = _extract_pages_sync(mock_files[name], "application/pdf")
    assert len(pages) == EXPECTED[name]["pages"]
    assert all(p.method == "text_layer" for p in pages)
    assert found_ratio(pages, EXPECTED[name]["markers"]) == 1.0


@needs_tesseract
@pytest.mark.parametrize("name", list(EXPECTED))
def test_scanned_pdfs_are_read_with_ocr(mock_files, name):
    pages = _extract_pages_sync(mock_files[f"{name}_scanned"], "application/pdf")
    assert len(pages) == EXPECTED[name]["pages"]
    assert all(p.method == "ocr" for p in pages)
    assert found_ratio(pages, EXPECTED[name]["markers"]) >= 0.75  # tolerate minor OCR misses


@needs_tesseract
def test_png_page_is_read_with_ocr(mock_files):
    pages = _extract_pages_sync(mock_files["visit_notes_page1_png"], "image/png")
    assert len(pages) == 1 and "riverside" in normalized(pages)


def test_corrupted_pdf_raises_clear_error(tmp_path):
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(OCRError):
        _extract_pages_sync(bad, "application/pdf")
