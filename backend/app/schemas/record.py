from datetime import datetime
from uuid import UUID

from sqlmodel import SQLModel

from app.models.enums import ProcessingStatus


class RecordRead(SQLModel):
    id: UUID
    patient_id: UUID
    original_filename: str
    content_type: str
    file_size: int
    status: ProcessingStatus
    error_message: str | None
    uploaded_at: datetime
    processed_at: datetime | None
