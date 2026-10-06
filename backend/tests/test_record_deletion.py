from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import select

from app.core.security import create_access_token
from app.models import AccountType, EventType, MedicalEvent, MedicalRecord, Patient, User


async def create_record_with_event(
    session_factory, patient: Patient, storage_path: Path | str
) -> tuple[MedicalRecord, MedicalEvent]:
    async with session_factory() as session:
        record = MedicalRecord(
            patient_id=patient.id,
            original_filename="visit.pdf",
            content_type="application/pdf",
            file_size=4,
            storage_path=str(storage_path),
        )
        session.add(record)
        await session.flush()
        event = MedicalEvent(
            patient_id=patient.id,
            record_id=record.id,
            event_type=EventType.VISIT,
            event_date=date(2026, 1, 10),
            title="Clinic visit",
            description="Routine check-up.",
        )
        session.add(event)
        await session.commit()
        await session.refresh(record)
        await session.refresh(event)
        return record, event


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_patient_can_delete_own_record_events_and_storage_file(
    client, session_factory, registered_patient, tmp_path
):
    patient, token = registered_patient
    stored_file = tmp_path / "uploads" / str(patient.id) / "visit.pdf"
    stored_file.parent.mkdir(parents=True)
    stored_file.write_bytes(b"test")
    record, event = await create_record_with_event(session_factory, patient, stored_file)

    response = await client.delete(
        f"/api/records/{record.id}", headers=auth_headers(token)
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Medical record deleted successfully"}
    assert not stored_file.exists()
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is None
        assert await session.get(MedicalEvent, event.id) is None


async def test_patient_cannot_delete_another_patients_record(
    client, session_factory, registered_patient, tmp_path
):
    _, token = registered_patient
    async with session_factory() as session:
        other_patient = Patient(first_name="Other", last_name="Patient")
        session.add(other_patient)
        await session.commit()
        await session.refresh(other_patient)

    stored_file = tmp_path / "uploads" / str(other_patient.id) / "other.pdf"
    stored_file.parent.mkdir(parents=True)
    stored_file.write_bytes(b"test")
    record, event = await create_record_with_event(session_factory, other_patient, stored_file)

    response = await client.delete(
        f"/api/records/{record.id}", headers=auth_headers(token)
    )

    assert response.status_code == 404
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is not None
        assert await session.get(MedicalEvent, event.id) is not None
    assert stored_file.exists()


@pytest.mark.parametrize("account_type", [AccountType.CAREGIVER, AccountType.CLINICIAN])
async def test_caregiver_and_clinician_cannot_delete_patient_records(
    client, session_factory, registered_patient, account_type
):
    patient, _ = registered_patient
    record, event = await create_record_with_event(session_factory, patient, "")
    async with session_factory() as session:
        user = User(
            full_name=f"Test {account_type.value}",
            email=f"{account_type.value}.{uuid4()}@example.com",
            password_hash="unused-in-test",
            account_type=account_type,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        token = create_access_token(user.id)

    response = await client.delete(
        f"/api/records/{record.id}", headers=auth_headers(token)
    )

    assert response.status_code == 403
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is not None
        assert await session.get(MedicalEvent, event.id) is not None


async def test_deleting_record_safely_handles_missing_storage_file(
    client, session_factory, registered_patient, tmp_path
):
    patient, token = registered_patient
    missing_file = tmp_path / "uploads" / str(patient.id) / "already-removed.pdf"
    record, event = await create_record_with_event(session_factory, patient, missing_file)

    response = await client.delete(
        f"/api/records/{record.id}", headers=auth_headers(token)
    )

    assert response.status_code == 200
    assert not missing_file.exists()
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is None
        assert await session.get(MedicalEvent, event.id) is None


async def test_delete_refuses_a_storage_path_outside_patients_upload_folder(
    client, session_factory, registered_patient, tmp_path
):
    patient, token = registered_patient
    unrelated_file = tmp_path / "uploads" / "another-patient" / "document.pdf"
    unrelated_file.parent.mkdir(parents=True)
    unrelated_file.write_bytes(b"private")
    record, event = await create_record_with_event(
        session_factory, patient, unrelated_file
    )

    response = await client.delete(
        f"/api/records/{record.id}", headers=auth_headers(token)
    )

    assert response.status_code == 500
    assert unrelated_file.read_bytes() == b"private"
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is not None
        assert await session.get(MedicalEvent, event.id) is not None


async def test_missing_record_returns_404(client, registered_patient):
    _, token = registered_patient

    response = await client.delete(
        f"/api/records/{uuid4()}", headers=auth_headers(token)
    )

    assert response.status_code == 404


async def test_delete_record_requires_authentication(client, session_factory, registered_patient):
    patient, _ = registered_patient
    record, event = await create_record_with_event(session_factory, patient, "")

    response = await client.delete(f"/api/records/{record.id}")

    assert response.status_code == 401
    async with session_factory() as session:
        assert await session.get(MedicalRecord, record.id) is not None
        assert await session.get(MedicalEvent, event.id) is not None
