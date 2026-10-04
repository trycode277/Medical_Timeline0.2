from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Index, Text
from sqlmodel import Field, Relationship, SQLModel

from app.models.base import utcnow
from app.models.enums import EventType, pg_enum

if TYPE_CHECKING:
    from app.models.patient import Patient
    from app.models.record import MedicalRecord


class MedicalEvent(SQLModel, table=True):
    __tablename__ = "medical_events"
    __table_args__ = (Index("ix_medical_events_patient_date", "patient_id", "event_date"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    patient_id: UUID = Field(foreign_key="patients.id", ondelete="CASCADE")
    # Null for manually created events; SET NULL if the source record is deleted
    record_id: UUID | None = Field(
        default=None, foreign_key="medical_records.id", index=True, ondelete="SET NULL"
    )

    event_type: EventType = Field(
        sa_column=Column(pg_enum(EventType, "event_type"), nullable=False, index=True)
    )
    event_date: date = Field(index=True)
    title: str | None = Field(default=None, max_length=255)
    description: str = Field(sa_type=Text)
    provider: str | None = Field(default=None, max_length=255, index=True)

    # Extraction metadata (populated by the processing pipeline)
    source_page: int | None = Field(default=None)
    confidence: float | None = Field(default=None)

    created_at: datetime = Field(
        default_factory=utcnow, sa_type=DateTime(timezone=True), nullable=False
    )
    updated_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    patient: "Patient" = Relationship(back_populates="events")
    record: "MedicalRecord" = Relationship(back_populates="events")
