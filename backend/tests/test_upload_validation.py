from unittest.mock import AsyncMock

import pytest
from sqlmodel import select

from app.core.config import settings
from app.models import AccountType, MedicalRecord, Patient, User

PDF = b"%PDF-1.4\n%test\n" + b"0" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


@pytest.fixture(autouse=True)
def pipeline_mock(monkeypatch):
    """Upload tests must not run OCR/LLM; just record that processing was scheduled."""
    mock = AsyncMock()
    monkeypatch.setattr("app.api.routes.records.process_record", mock)
    return mock


def post_upload(client, token, *files, data=None):
    return client.post(
        "/api/records/upload",
        headers={"Authorization": f"Bearer {token}"},
        data=data,
        files=[("files", f) for f in files],
    )


def files_on_disk():
    return [p for p in settings.upload_dir.rglob("*") if p.is_file()]


async def record_count(session_factory):
    async with session_factory() as session:
        return len((await session.exec(select(MedicalRecord))).all())


async def test_valid_pdf_is_accepted_for_authenticated_patient(
    client, registered_patient, pipeline_mock
):
    patient, token = registered_patient
    response = await post_upload(
        client, token, ("scan.pdf", PDF, "application/pdf")
    )
    assert response.status_code == 202
    body = response.json()
    assert len(body) == 1 and body[0]["status"] == "pending"
    assert body[0]["patient_id"] == str(patient.id)
    assert body[0]["original_filename"] == "scan.pdf"
    assert "storage_path" not in body[0]
    pipeline_mock.assert_awaited_once()
    assert len(files_on_disk()) == 1


async def test_multiple_files_create_one_record_each(
    client, registered_patient, pipeline_mock
):
    _, token = registered_patient
    response = await post_upload(
        client,
        token,
        ("a.pdf", PDF, "application/pdf"),
        ("b.png", PNG, "image/png"),
    )
    assert response.status_code == 202 and len(response.json()) == 2
    assert pipeline_mock.await_count == 2


async def test_unauthenticated_upload_is_rejected(client, patient):
    response = await client.post(
        "/api/records/upload",
        files=[("files", ("a.pdf", PDF, "application/pdf"))],
    )
    assert response.status_code == 401


async def test_upload_does_not_allow_client_to_choose_another_patient(
    client, registered_patient, session_factory
):
    patient, token = registered_patient
    async with session_factory() as session:
        other_patient = Patient(first_name="Other", last_name="Patient")
        session.add(other_patient)
        await session.commit()
        await session.refresh(other_patient)

    response = await post_upload(
        client,
        token,
        ("a.pdf", PDF, "application/pdf"),
        data={"patient_id": str(other_patient.id)},
    )
    assert response.status_code == 202
    assert response.json()[0]["patient_id"] == str(patient.id)


@pytest.mark.parametrize("account_type", [AccountType.CAREGIVER, AccountType.CLINICIAN])
async def test_non_patient_accounts_cannot_upload(
    client, session_factory, monkeypatch, account_type
):
    from pydantic import SecretStr

    from app.core.config import settings
    from app.core.security import create_access_token

    monkeypatch.setattr(
        settings,
        "jwt_secret_key",
        SecretStr("test-only-secret-key-with-at-least-32-bytes"),
    )
    async with session_factory() as session:
        user = User(
            full_name=f"Test {account_type.value}",
            email=f"{account_type.value}@example.com",
            password_hash="not-used-by-this-test",
            account_type=account_type,
        )
        session.add(user)
        await session.commit()
        token = create_access_token(user.id)

    response = await post_upload(
        client, token, ("a.pdf", PDF, "application/pdf")
    )
    assert response.status_code == 403


async def test_patient_account_without_linked_patient_cannot_upload(
    client, session_factory, monkeypatch
):
    from pydantic import SecretStr

    from app.core.config import settings
    from app.core.security import create_access_token

    monkeypatch.setattr(
        settings,
        "jwt_secret_key",
        SecretStr("test-only-secret-key-with-at-least-32-bytes"),
    )
    async with session_factory() as session:
        user = User(
            full_name="Unlinked Patient",
            email="unlinked@example.com",
            password_hash="not-used-by-this-test",
            account_type=AccountType.PATIENT,
        )
        session.add(user)
        await session.commit()
        token = create_access_token(user.id)

    response = await post_upload(
        client, token, ("a.pdf", PDF, "application/pdf")
    )
    assert response.status_code == 403


async def test_unsupported_content_type_rejected(client, registered_patient):
    _, token = registered_patient
    response = await post_upload(
        client, token, ("notes.txt", b"hello", "text/plain")
    )
    assert response.status_code == 415
    assert files_on_disk() == []


async def test_content_must_match_declared_type(client, registered_patient):
    _, token = registered_patient
    response = await post_upload(
        client, token, ("fake.pdf", b"this is not a pdf", "application/pdf")
    )
    assert response.status_code == 415
    assert files_on_disk() == []


async def test_empty_file_rejected(client, registered_patient):
    _, token = registered_patient
    response = await post_upload(
        client, token, ("empty.pdf", b"", "application/pdf")
    )
    assert response.status_code == 400
    assert files_on_disk() == []


async def test_oversized_file_rejected_and_cleaned_up(
    client, registered_patient, monkeypatch
):
    _, token = registered_patient
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    big = PDF + b"0" * (1024 * 1024)
    response = await post_upload(
        client, token, ("big.pdf", big, "application/pdf")
    )
    assert response.status_code == 413
    assert files_on_disk() == []


async def test_too_many_files_rejected(
    client, registered_patient, monkeypatch
):
    _, token = registered_patient
    monkeypatch.setattr(settings, "max_files_per_upload", 1)
    response = await post_upload(
        client,
        token,
        ("a.pdf", PDF, "application/pdf"),
        ("b.pdf", PDF, "application/pdf"),
    )
    assert response.status_code == 400


async def test_missing_files_is_422(client, registered_patient):
    _, token = registered_patient
    response = await client.post(
        "/api/records/upload",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 422


async def test_upload_is_all_or_nothing(
    client, registered_patient, session_factory, pipeline_mock
):
    _, token = registered_patient
    response = await post_upload(
        client,
        token,
        ("ok.pdf", PDF, "application/pdf"),
        ("bad.txt", b"hi", "text/plain"),
    )
    assert response.status_code == 415
    assert files_on_disk() == []
    assert await record_count(session_factory) == 0
    pipeline_mock.assert_not_awaited()


async def test_client_filename_cannot_escape_upload_dir(
    client, registered_patient, session_factory
):
    _, token = registered_patient
    response = await post_upload(
        client, token, ("../../etc/passwd.pdf", PDF, "application/pdf")
    )
    assert response.status_code == 202
    assert response.json()[0]["original_filename"] == "passwd.pdf"
    (stored,) = files_on_disk()
    assert settings.upload_dir in stored.parents
