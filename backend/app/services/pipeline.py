"""Asynchronous record-processing pipeline.

OCR -> LLM structured extraction -> persist MedicalEvents -> delete the source file.

Triggered from POST /api/records/upload via FastAPI BackgroundTasks. For production,
enqueue `process_record(record_id)` on a durable queue (Celery, ARQ, SQS) instead.
"""
import asyncio
import logging
from pathlib import Path
from uuid import UUID

from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.base import utcnow
from app.models.enums import ProcessingStatus
from app.models.event import MedicalEvent
from app.models.record import MedicalRecord
from app.services.cleanup import delete_file
from app.services.intelligence.errors import PipelineError
from app.services.intelligence.extraction import extract_events_from_pages
from app.services.intelligence.ocr import extract_pages
from app.services.intelligence.schemas import ExtractedMedicalEvent

logger = logging.getLogger(__name__)

_record_slots = asyncio.Semaphore(settings.max_concurrent_records)


async def persist_events(
    session: AsyncSession, record: MedicalRecord, events: list[ExtractedMedicalEvent]
) -> None:
    # Idempotent: reprocessing a record replaces its previously extracted events
    existing = await session.exec(
        select(MedicalEvent).where(col(MedicalEvent.record_id) == record.id)
    )
    for old in existing.all():
        await session.delete(old)

    for ev in events:
        session.add(
            MedicalEvent(
                patient_id=record.patient_id,
                record_id=record.id,
                event_type=ev.category,
                event_date=ev.date,
                title=ev.title,
                description=ev.description,
                provider=ev.provider,
                source_page=ev.source_page,
            )
        )


async def process_record(record_id: UUID) -> None:
    """Entry point for background processing. Owns its own DB session."""
    async with _record_slots, async_session_factory() as session:
        record = await session.get(MedicalRecord, record_id)
        if record is None:
            logger.warning("process_record: record %s not found", record_id)
            return

        path = Path(record.storage_path)
        content_type = record.content_type
        record.status = ProcessingStatus.PROCESSING
        session.add(record)
        await session.commit()

        try:
            pages = await extract_pages(path, content_type)  # raw OCR text: memory only
            events = await extract_events_from_pages(pages)
            del pages
            await persist_events(session, record, events)
            record.status = ProcessingStatus.COMPLETED
            record.error_message = None
        except Exception as exc:
            logger.exception("Processing failed for record %s", record_id)
            await session.rollback()
            record = await session.get(MedicalRecord, record_id)
            record.status = ProcessingStatus.FAILED
            record.error_message = (
                str(exc)[:500]
                if isinstance(exc, PipelineError)
                else "Unexpected error while processing this file."
            )

        record.storage_path = ""  # nothing left on disk to point at
        record.processed_at = utcnow()
        session.add(record)
        await session.commit()

        # Delete only after the outcome is safely stored (events saved, or failure recorded).
        # If that commit raised, the file stays and the sweeper removes it after the max age.
        delete_file(path)
