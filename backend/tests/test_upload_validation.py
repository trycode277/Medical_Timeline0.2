from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlmodel import select

from app.core.config import settings
from app.models import MedicalRecord

PDF = b"%PDF-1.4\n%test\n" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


@pytest.fixture(autouse=True)
def pipeline_mock(monkeypatch):
    """Upload tests must not run OCR/LLM; just record that processing was scheduled."""
    mock = AsyncMock()
    monkeypatch.setattr("app.api.routes.records.process_record", mock)
    return mock


def post_upload(client, patient_id, *files):
    return client.post(
        "/api/records/upload",
        data={"patient_id": str(patient_id)},
        files=[("files", f) for f in files],
    )


def files_on_disk():
    return [p for p in settings.upload_dir.rglob("*") if p.is_file()]


async def record_count(session_factory):
    async with session_factory() as s:
        return len((await s.exec(select(MedicalRecord))).all())


async def test_valid_pdf_is_accepted_and_processing_scheduled(client, patient, pipeline_mock):
    r = await post_upload(client, patient.id, ("scan.pdf", PDF, "application/pdf"))
    assert r.status_code == 202
    body = r.json()
    assert len(body) == 1 and body[0]["status"] == "pending"
    assert body[0]["original_filename"] == "scan.pdf"
    assert "storage_path" not in body[0]  # internal path never leaves the server
    pipeline_mock.assert_awaited_once()
    assert len(files_on_disk()) == 1


async def test_multiple_files_create_one_record_each(client, patient, pipeline_mock):
    r = await post_upload(
        client, patient.id, ("a.pdf", PDF, "application/pdf"), ("b.png", PNG, "image/png")
    )
    assert r.status_code == 202 and len(r.json()) == 2
    assert pipeline_mock.await_count == 2


async def test_unsupported_content_type_rejected(client, patient):
    r = await post_upload(client, patient.id, ("notes.txt", b"hello", "text/plain"))
    assert r.status_code == 415
    assert files_on_disk() == []


async def test_content_must_match_declared_type(client, patient):
    r = await post_upload(client, patient.id, ("fake.pdf", b"this is not a pdf", "application/pdf"))
    assert r.status_code == 415
    assert files_on_disk() == []


async def test_empty_file_rejected(client, patient):
    r = await post_upload(client, patient.id, ("empty.pdf", b"", "application/pdf"))
    assert r.status_code == 400
    assert files_on_disk() == []


async def test_oversized_file_rejected_and_cleaned_up(client, patient, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    big = PDF + b"0" * (1024 * 1024)
    r = await post_upload(client, patient.id, ("big.pdf", big, "application/pdf"))
    assert r.status_code == 413
    assert files_on_disk() == []


async def test_too_many_files_rejected(client, patient, monkeypatch):
    monkeypatch.setattr(settings, "max_files_per_upload", 1)
    r = await post_upload(
        client, patient.id, ("a.pdf", PDF, "application/pdf"), ("b.pdf", PDF, "application/pdf")
    )
    assert r.status_code == 400


async def test_unknown_patient_returns_404(client):
    r = await post_upload(client, uuid4(), ("a.pdf", PDF, "application/pdf"))
    assert r.status_code == 404


async def test_missing_files_or_bad_patient_id_is_422(client, patient):
    assert (await client.post("/api/records/upload", data={"patient_id": str(patient.id)})).status_code == 422
    r = await client.post(
        "/api/records/upload",
        data={"patient_id": "not-a-uuid"},
        files=[("files", ("a.pdf", PDF, "application/pdf"))],
    )
    assert r.status_code == 422


async def test_upload_is_all_or_nothing(client, patient, session_factory, pipeline_mock):
    r = await post_upload(
        client, patient.id, ("ok.pdf", PDF, "application/pdf"), ("bad.txt", b"hi", "text/plain")
    )
    assert r.status_code == 415
    assert files_on_disk() == []  # the valid first file was removed too
    assert await record_count(session_factory) == 0
    pipeline_mock.assert_not_awaited()


async def test_client_filename_cannot_escape_upload_dir(client, patient, session_factory):
    r = await post_upload(client, patient.id, ("../../etc/passwd.pdf", PDF, "application/pdf"))
    assert r.status_code == 202
    assert r.json()[0]["original_filename"] == "passwd.pdf"
    (stored,) = files_on_disk()
    assert settings.upload_dir in stored.parents
