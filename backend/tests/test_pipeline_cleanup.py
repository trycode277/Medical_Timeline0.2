import os
import time
from uuid import uuid4

import pytest
from sqlmodel import select

from app.models import MedicalEvent, MedicalRecord
from app.models.enums import ProcessingStatus
from app.services import pipeline
from app.services.cleanup import sweep_stale_uploads
from app.services.intelligence.errors import OCRError
from app.services.intelligence.ocr import PageText
from app.services.intelligence.schemas import ExtractedMedicalEvent

SENTINEL = "SENTINEL-PHI-123"


def make_event():
    return ExtractedMedicalEvent(
        date="2024-03-04", category="test", title="Blood test", description="Lab panel documented.",
        provider="Northside Lab", source_page=1, evidence_quote=SENTINEL,
    )


@pytest.fixture
def wired(monkeypatch, session_factory):
    monkeypatch.setattr(pipeline, "async_session_factory", session_factory)


async def make_record(session_factory, patient, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4 fake")
    async with session_factory() as s:
        r = MedicalRecord(patient_id=patient.id, original_filename="x.pdf", content_type="application/pdf",
                          file_size=13, storage_path=str(path))
        s.add(r)
        await s.commit()
        return r.id


async def load(session_factory, rid):
    async with session_factory() as s:
        return await s.get(MedicalRecord, rid)


async def test_success_saves_events_then_deletes_file(wired, monkeypatch, session_factory, patient, tmp_path):
    f = tmp_path / "uploads" / "a.pdf"
    rid = await make_record(session_factory, patient, f)

    async def fake_pages(path, content_type):
        return [PageText(1, f"{SENTINEL} lab results", "ocr")]

    async def fake_events(pages):
        return [make_event()]

    monkeypatch.setattr(pipeline, "extract_pages", fake_pages)
    monkeypatch.setattr(pipeline, "extract_events_from_pages", fake_events)
    await pipeline.process_record(rid)

    record = await load(session_factory, rid)
    assert record.status == ProcessingStatus.COMPLETED and record.storage_path == ""
    assert not f.exists()
    async with session_factory() as s:
        events = (await s.exec(select(MedicalEvent))).all()
    assert len(events) == 1 and events[0].record_id == rid

    # raw OCR text must never be written anywhere on disk
    for p in tmp_path.rglob("*"):
        if p.is_file():
            assert SENTINEL.encode() not in p.read_bytes()


async def test_known_failure_is_recorded_and_file_deleted(wired, monkeypatch, session_factory, patient, tmp_path):
    f = tmp_path / "uploads" / "b.pdf"
    rid = await make_record(session_factory, patient, f)

    async def boom(path, content_type):
        raise OCRError("Could not read the file (RuntimeError).")

    monkeypatch.setattr(pipeline, "extract_pages", boom)
    await pipeline.process_record(rid)

    record = await load(session_factory, rid)
    assert record.status == ProcessingStatus.FAILED
    assert record.error_message == "Could not read the file (RuntimeError)."
    assert not f.exists()


async def test_unexpected_error_gets_generic_message(wired, monkeypatch, session_factory, patient, tmp_path):
    f = tmp_path / "uploads" / "c.pdf"
    rid = await make_record(session_factory, patient, f)

    async def boom(path, content_type):
        raise RuntimeError("secret patient text")

    monkeypatch.setattr(pipeline, "extract_pages", boom)
    await pipeline.process_record(rid)

    record = await load(session_factory, rid)
    assert record.status == ProcessingStatus.FAILED
    assert "secret" not in record.error_message
    assert not f.exists()


async def test_missing_record_is_ignored(wired):
    await pipeline.process_record(uuid4())


def test_sweeper_removes_only_stale_files_and_empty_dirs(tmp_path):
    root = tmp_path / "uploads"
    (root / "p1").mkdir(parents=True)
    (root / "p2").mkdir(parents=True)
    old, fresh = root / "p1" / "old.pdf", root / "p2" / "fresh.pdf"
    old.write_bytes(b"x")
    fresh.write_bytes(b"x")
    two_hours_ago = time.time() - 7200
    os.utime(old, (two_hours_ago, two_hours_ago))

    assert sweep_stale_uploads(root, max_age_seconds=3600) == 1
    assert not old.exists() and fresh.exists()
    assert not (root / "p1").exists()  # emptied folder pruned


def test_sweeper_handles_missing_directory(tmp_path):
    assert sweep_stale_uploads(tmp_path / "nope", 60) == 0
