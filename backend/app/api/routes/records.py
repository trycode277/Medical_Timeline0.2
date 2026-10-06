from pathlib import Path
from typing import Annotated
from uuid import UUID

from anyio import to_thread
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from sqlmodel import col, select

from app.api.deps import SessionDep, get_current_user
from app.core.config import settings
from app.models.enums import AccountType
from app.models.event import MedicalEvent
from app.models.patient import Patient
from app.models.record import MedicalRecord
from app.models.user import User
from app.schemas.record import RecordRead
from app.services.cleanup import delete_file
from app.services.pipeline import process_record
from app.services.storage import StoredFile, save_upload_temporarily

router = APIRouter(prefix="/records", tags=["records"])


@router.post("/upload", response_model=list[RecordRead], status_code=status.HTTP_202_ACCEPTED)
async def upload_records(
    background_tasks: BackgroundTasks,
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
    files: Annotated[list[UploadFile], File(description="One or more PDF/image files")],
):
    """Accept PDF/image uploads (a multi-page PDF is one file). Each file becomes a
    MedicalRecord (status=pending) and is processed in the background:
    OCR -> LLM structured extraction -> MedicalEvents. Returns 202 immediately since
    OCR + LLM calls can take a while; poll GET /records/{id} for status, then fetch the
    results with GET /events?record_id=..."""
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files provided.")
    if len(files) > settings.max_files_per_upload:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Too many files (max {settings.max_files_per_upload}).",
        )
    if current_user.account_type != AccountType.PATIENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only patient accounts can upload medical records.",
        )

    patient_result = await session.exec(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.one_or_none()
    if patient is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This patient account is not linked to a patient record.",
        )
    patient_id = patient.id

    stored: list[StoredFile] = []
    records: list[MedicalRecord] = []
    try:
        for upload in files:
            saved = await save_upload_temporarily(upload, patient_id)
            stored.append(saved)
            record = MedicalRecord(
                patient_id=patient_id,
                original_filename=saved.original_filename,
                content_type=saved.content_type,
                file_size=saved.size,
                storage_path=str(saved.path),
            )
            session.add(record)
            records.append(record)
        await session.commit()
    except BaseException:
        await session.rollback()
        for saved in stored:  # all-or-nothing: don't leave orphaned temp files
            saved.path.unlink(missing_ok=True)
        raise

    for record in records:
        background_tasks.add_task(process_record, record.id)
    return records


@router.get("", response_model=list[RecordRead])
async def list_records(
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[RecordRead]:
    if current_user.account_type != AccountType.PATIENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only patient accounts can view medical records.",
        )

    patient_result = await session.exec(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.one_or_none()
    if patient is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This patient account is not linked to a patient record.",
        )

    stmt = select(MedicalRecord).where(
        col(MedicalRecord.patient_id) == patient.id
    )
    stmt = stmt.order_by(col(MedicalRecord.uploaded_at).desc()).limit(limit).offset(offset)
    return (await session.exec(stmt)).all()


@router.get("/{record_id}", response_model=RecordRead)
async def get_record(record_id: UUID, session: SessionDep):
    record = await session.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found.")
    return record


@router.delete("/{record_id}")
async def delete_record(
    record_id: UUID,
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    if current_user.account_type != AccountType.PATIENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only patient accounts can delete medical records.",
        )

    patient_result = await session.exec(
        select(Patient).where(Patient.user_id == current_user.id)
    )
    patient = patient_result.one_or_none()
    if patient is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This patient account is not linked to a patient record.",
        )

    record_result = await session.exec(
        select(MedicalRecord).where(
            MedicalRecord.id == record_id,
            MedicalRecord.patient_id == patient.id,
        )
    )
    record = record_result.one_or_none()
    if record is None:
        # Treat an unknown id and another patient's id alike, without disclosing ownership.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medical record not found.")

    storage_path: Path | None = None
    stored_path = record.storage_path.strip()
    if stored_path:
        upload_root = settings.upload_dir.resolve()
        patient_directory = (upload_root / str(patient.id)).resolve()
        if (
            patient_directory.parent != upload_root
            or patient_directory.name != str(patient.id)
        ):
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "The stored medical document could not be safely removed.",
            )
        candidate = Path(stored_path)
        if not candidate.is_absolute():
            candidate = upload_root / candidate
        resolved_parent = candidate.parent.resolve()
        if candidate.name in {"", ".", ".."} or resolved_parent != patient_directory:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "The stored medical document could not be safely removed.",
            )
        # Keep the leaf unresolved so unlink removes a symlink itself, never its target.
        storage_path = resolved_parent / candidate.name

    try:
        event_result = await session.exec(
            select(MedicalEvent).where(
                MedicalEvent.record_id == record.id,
                MedicalEvent.patient_id == patient.id,
            )
        )
        for event in event_result.all():
            await session.delete(event)
        await session.delete(record)
        await session.commit()
    except BaseException:
        await session.rollback()
        raise

    if storage_path is not None:
        # File removal follows the committed DB transaction; missing files are safe.
        await to_thread.run_sync(delete_file, storage_path)

    return {"message": "Medical record deleted successfully"}
