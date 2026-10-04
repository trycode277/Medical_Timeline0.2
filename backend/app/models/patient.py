from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime
from sqlmodel import Field, Relationship, SQLModel

from app.models.base import utcnow

if TYPE_CHECKING:
    from app.models.event import MedicalEvent
    from app.models.record import MedicalRecord


class Patient(SQLModel, table=True):
    __tablename__ = "patients"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100, index=True)
    date_of_birth: date | None = Field(default=None)
    mrn: str | None = Field(default=None, max_length=64, unique=True, index=True)
    created_at: datetime = Field(
        default_factory=utcnow, sa_type=DateTime(timezone=True), nullable=False
    )

    records: list["MedicalRecord"] = Relationship(back_populates="patient")
    events: list["MedicalEvent"] = Relationship(back_populates="patient")
