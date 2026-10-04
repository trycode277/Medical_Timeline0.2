from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, Relationship, SQLModel

from app.models.base import utcnow
from app.models.enums import ProcessingStatus, pg_enum

if TYPE_CHECKING:
    from app.models.event import MedicalEvent
    from app.models.patient import Patient


class MedicalRecord(SQLModel, table=True):
    """One uploaded source document (a multi-page PDF or a single scanned image)."""

    __tablename__ = "medical_records"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    patient_id: UUID = Field(foreign_key="patients.id", index=True, ondelete="CASCADE")

    original_filename: str = Field(max_length=255)
    content_type: str = Field(max_length=100)
    file_size: int
    storage_path: str

    status: ProcessingStatus = Field(
        default=ProcessingStatus.PENDING,
        sa_column=Column(pg_enum(ProcessingStatus, "processing_status"), nullable=False, index=True),
    )
    error_message: str | None = Field(default=None)

    uploaded_at: datetime = Field(
        default_factory=utcnow, sa_type=DateTime(timezone=True), nullable=False
    )
    processed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))

    patient: "Patient" = Relationship(back_populates="records")
    events: list["MedicalEvent"] = Relationship(back_populates="record")
