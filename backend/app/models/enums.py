from enum import Enum

from sqlalchemy import Enum as SAEnum


class EventType(str, Enum):
    VISIT = "visit"
    TEST = "test"
    DIAGNOSIS = "diagnosis"
    TREATMENT = "treatment"
    MEDICATION = "medication"


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


def pg_enum(enum_cls: type[Enum], name: str) -> SAEnum:
    """Postgres enum that stores the lowercase values, not the member names."""
    return SAEnum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])
