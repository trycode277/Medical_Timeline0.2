from datetime import date
from enum import Enum
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlmodel import asc, col, desc, func, or_, select

from app.api.deps import SessionDep, get_current_user
from app.models.base import utcnow
from app.models.enums import AccountType, EventType
from app.models.event import MedicalEvent
from app.models.patient import Patient
from app.models.record import MedicalRecord
from app.models.user import User
from app.schemas.event import EventCreate, EventPage, EventRead, EventUpdate

router = APIRouter(prefix="/events", tags=["events"])

NULLABLE_FIELDS = {"title", "provider"}


class SortOrder(str, Enum):
    ASC = "asc"
    DESC = "desc"


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _get_event_or_404(session: SessionDep, event_id: UUID) -> MedicalEvent:
    event = await session.get(MedicalEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found.")
    return event


@router.get("", response_model=EventPage)
async def list_events(
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
    record_id: UUID | None = None,
    event_type: Annotated[list[EventType] | None, Query()] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    provider: str | None = Query(default=None, max_length=255),
    q: str | None = Query(
        default=None, min_length=2, max_length=200,
        description="Free-text search across title, description and provider",
    ),
    order: SortOrder = SortOrder.ASC,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    if current_user.account_type != AccountType.PATIENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only patient accounts can view medical events.",
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

    if date_from and date_to and date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "date_from must be <= date_to.")

    conditions = [col(MedicalEvent.patient_id) == patient.id]
    if record_id:
        conditions.append(col(MedicalEvent.record_id) == record_id)
    if event_type:
        conditions.append(col(MedicalEvent.event_type).in_(event_type))
    if date_from:
        conditions.append(col(MedicalEvent.event_date) >= date_from)
    if date_to:
        conditions.append(col(MedicalEvent.event_date) <= date_to)
    if provider:
        conditions.append(
            col(MedicalEvent.provider).ilike(f"%{_escape_like(provider)}%", escape="\\")
        )
    if q:
        pattern = f"%{_escape_like(q)}%"
        conditions.append(
            or_(
                col(MedicalEvent.title).ilike(pattern, escape="\\"),
                col(MedicalEvent.description).ilike(pattern, escape="\\"),
                col(MedicalEvent.provider).ilike(pattern, escape="\\"),
            )
        )

    direction = asc if order == SortOrder.ASC else desc
    items_stmt = (
        select(MedicalEvent)
        .where(*conditions)
        .order_by(
            direction(col(MedicalEvent.event_date)),
            direction(col(MedicalEvent.created_at)),
            col(MedicalEvent.id),
        )
        .limit(limit)
        .offset(offset)
    )
    count_stmt = select(func.count()).select_from(MedicalEvent).where(*conditions)

    events = (await session.exec(items_stmt)).all()
    total = (await session.exec(count_stmt)).one()
    return EventPage(
        items=[EventRead.model_validate(e) for e in events],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=EventRead, status_code=status.HTTP_201_CREATED)
async def create_event(payload: EventCreate, session: SessionDep):
    if await session.get(Patient, payload.patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")
    if payload.record_id:
        record = await session.get(MedicalRecord, payload.record_id)
        if record is None or record.patient_id != payload.patient_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "record_id does not exist for this patient.",
            )
    event = MedicalEvent.model_validate(payload)
    session.add(event)
    await session.commit()
    return event


@router.get("/{event_id}", response_model=EventRead)
async def get_event(event_id: UUID, session: SessionDep):
    return await _get_event_or_404(session, event_id)


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(event_id: UUID, payload: EventUpdate, session: SessionDep):
    event = await _get_event_or_404(session, event_id)
    data = {
        k: v
        for k, v in payload.model_dump(exclude_unset=True).items()
        if v is not None or k in NULLABLE_FIELDS
    }
    data["updated_at"] = utcnow()
    event.sqlmodel_update(data)
    session.add(event)
    await session.commit()
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: UUID, session: SessionDep):
    event = await _get_event_or_404(session, event_id)
    await session.delete(event)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
