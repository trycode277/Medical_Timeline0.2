from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import EmailStr, field_validator
from sqlmodel import Field, SQLModel

from app.models.enums import AccountType


class RegisterRequest(SQLModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)
    account_type: AccountType = AccountType.PATIENT

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name must not be empty.")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class LoginRequest(SQLModel):
    email: EmailStr = Field(max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class UserRead(SQLModel):
    id: UUID
    full_name: str
    email: EmailStr
    account_type: AccountType
    created_at: datetime


class LoginResponse(SQLModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserRead
