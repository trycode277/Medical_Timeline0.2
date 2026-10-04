from datetime import date, datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.models.enums import EventType


class EventBase(SQLModel):
    event_type: EventType
    event_date: date
    title: str | None = Field(default=None, max_length=255)
    description: str = Field(min_length=1)
    provider: str | None = Field(default=None, max_length=255)


class EventCreate(EventBase):
    patient_id: UUID
    record_id: UUID | None = None


class EventUpdate(SQLModel):
    event_type: EventType | None = None
    event_date: date | None = None
    title: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, min_length=1)
    provider: str | None = Field(default=None, max_length=255)


class EventRead(EventBase):
    id: UUID
    patient_id: UUID
    record_id: UUID | None
    source_page: int | None
    confidence: float | None
    created_at: datetime
    updated_at: datetime | None


class EventPage(SQLModel):
    items: list[EventRead]
    total: int
    limit: int
    offset: int
