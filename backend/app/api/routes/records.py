from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile, status
from sqlmodel import col, select

from app.api.deps import SessionDep
from app.core.config import settings
from app.models.patient import Patient
from app.models.record import MedicalRecord
from app.schemas.record import RecordRead
from app.services.pipeline import process_record
from app.services.storage import StoredFile, save_upload_temporarily

router = APIRouter(prefix="/records", tags=["records"])


@router.post("/upload", response_model=list[RecordRead], status_code=status.HTTP_202_ACCEPTED)
async def upload_records(
    background_tasks: BackgroundTasks,
    session: SessionDep,
    patient_id: Annotated[UUID, Form()],
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
    if await session.get(Patient, patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")

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
    patient_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    stmt = select(MedicalRecord)
    if patient_id:
        stmt = stmt.where(col(MedicalRecord.patient_id) == patient_id)
    stmt = stmt.order_by(col(MedicalRecord.uploaded_at).desc()).limit(limit).offset(offset)
    return (await session.exec(stmt)).all()


@router.get("/{record_id}", response_model=RecordRead)
async def get_record(record_id: UUID, session: SessionDep):
    record = await session.get(MedicalRecord, record_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found.")
    return record
