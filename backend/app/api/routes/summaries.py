from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlmodel import col, desc, func, select

from app.api.deps import SessionDep
from app.models.event import MedicalEvent
from app.models.patient import Patient
from app.schemas.summary import SummaryPoint, SummaryRead
from app.services.intelligence.errors import LLMConfigError, PipelineError
from app.services.intelligence.summary import MAX_EVENTS, summarize_events

router = APIRouter(prefix="/patients", tags=["summary"])


@router.get("/{patient_id}/summary", response_model=SummaryRead)
async def get_patient_summary(
    patient_id: UUID,
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Concise AI summary of the events in the date range. Restates documented events
    only (no diagnosis, advice or health-trend judgments). Cached by content."""
    if await session.get(Patient, patient_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found.")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "date_from must be <= date_to.")

    conds = [col(MedicalEvent.patient_id) == patient_id]
    if date_from:
        conds.append(col(MedicalEvent.event_date) >= date_from)
    if date_to:
        conds.append(col(MedicalEvent.event_date) <= date_to)

    total = (await session.exec(select(func.count()).select_from(MedicalEvent).where(*conds))).one()
    meta = dict(patient_id=patient_id, date_from=date_from, date_to=date_to, event_count=total)
    if total == 0:
        return SummaryRead(**meta, summarized_count=0, truncated=False, category_counts={},
                           overview="No events were found in this date range.", key_points=[])

    # newest MAX_EVENTS in range, then oldest-first for the model
    stmt = (select(MedicalEvent).where(*conds)
            .order_by(desc(col(MedicalEvent.event_date)), desc(col(MedicalEvent.created_at)))
            .limit(MAX_EVENTS))
    events = list(reversed((await session.exec(stmt)).all()))

    try:
        result = await summarize_events(events, date_from, date_to)
    except LLMConfigError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except PipelineError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    return SummaryRead(
        **meta,
        summarized_count=len(events),
        truncated=total > len(events),
        category_counts=result.category_counts,
        overview=result.overview,
        key_points=[SummaryPoint(text=t, event_ids=ids) for t, ids in result.key_points],
    )
