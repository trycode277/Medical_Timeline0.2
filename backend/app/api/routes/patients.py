from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.deps import SessionDep
from app.models.patient import Patient
from app.schemas.patient import PatientCreate, PatientRead

router = APIRouter(prefix="/patients", tags=["patients"])


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(payload: PatientCreate, session: SessionDep):
    patient = Patient.model_validate(payload)
    session.add(patient)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A patient with this MRN already exists.")
    return patient


@router.get("", response_model=list[PatientRead])
async def list_patients(
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    stmt = (
        select(Patient)
        .order_by(col(Patient.last_name), col(Patient.first_name))
        .limit(limit)
        .offset(offset)
    )
    return (await session.exec(stmt)).all()


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(patient_id: UUID, session: SessionDep):
    patient = await session.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")
    return patient
