from datetime import datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, String
from sqlmodel import Field, Relationship, SQLModel

from app.models.base import utcnow
from app.models.enums import AccountType, pg_enum

if TYPE_CHECKING:
    from app.models.patient import Patient


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    full_name: str = Field(max_length=200)
    email: str = Field(max_length=320, unique=True, index=True)
    password_hash: str = Field(sa_type=String(255), nullable=False)
    account_type: AccountType = Field(
        default=AccountType.PATIENT,
        sa_column=Column(pg_enum(AccountType, "account_type"), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utcnow, sa_type=DateTime(timezone=True), nullable=False
    )

    patient: Optional["Patient"] = Relationship(
        back_populates="user",
        sa_relationship_kwargs={"uselist": False},
    )
