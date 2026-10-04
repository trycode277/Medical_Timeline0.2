from datetime import date, datetime
from uuid import UUID

from sqlmodel import Field, SQLModel


class PatientCreate(SQLModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date | None = None
    mrn: str | None = Field(default=None, max_length=64)


class PatientRead(PatientCreate):
    id: UUID
    created_at: datetime
