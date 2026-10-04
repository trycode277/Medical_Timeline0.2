from datetime import date
from uuid import UUID

from sqlmodel import SQLModel


class SummaryPoint(SQLModel):
    text: str
    event_ids: list[UUID]


class SummaryRead(SQLModel):
    patient_id: UUID
    date_from: date | None
    date_to: date | None
    event_count: int         # all events in range
    summarized_count: int    # events actually sent to the model (capped)
    truncated: bool
    category_counts: dict[str, int]
    overview: str
    key_points: list[SummaryPoint]
