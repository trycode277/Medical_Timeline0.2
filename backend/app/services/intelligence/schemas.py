"""LLM-facing output schema. Validated strictly with Pydantic; any violation makes the
structured-output call fail and be retried."""
import datetime as dt

from pydantic import BaseModel, Field, field_validator

from app.models.enums import EventType


class ExtractedMedicalEvent(BaseModel):
    date: dt.date = Field(
        description="Date the event occurred, ISO 8601 (YYYY-MM-DD). Never guess a date."
    )
    category: EventType = Field(
        description="Exactly one of: visit, test, diagnosis, treatment, medication."
    )
    title: str = Field(
        min_length=3,
        max_length=255,
        description="Short neutral label, max ~80 chars, e.g. 'Cardiology follow-up visit'.",
    )
    description: str = Field(
        min_length=1,
        max_length=2000,
        description="Neutral, factual 1-3 sentence summary using only what the document states.",
    )
    provider: str | None = Field(
        default=None,
        max_length=255,
        description="Clinician, facility or lab exactly as named in the document; null if absent.",
    )
    source_page: int | None = Field(
        default=None, ge=1, description="Page number (from the PAGE markers) where this appears."
    )
    evidence_quote: str = Field(
        min_length=3,
        max_length=400,
        description="Short VERBATIM excerpt (max ~200 chars) copied from the document that "
        "supports this event. Do not paraphrase.",
    )

    @field_validator("date")
    @classmethod
    def _plausible_year(cls, v: dt.date) -> dt.date:
        if v.year < 1900:
            raise ValueError("date is implausibly old")
        return v

    @field_validator("title", "description", "evidence_quote", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("provider", mode="before")
    @classmethod
    def _blank_provider_to_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class ExtractionResult(BaseModel):
    events: list[ExtractedMedicalEvent] = Field(
        default_factory=list,
        description="All dated events found in the excerpt; empty list if none.",
    )
