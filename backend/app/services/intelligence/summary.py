"""AI summary over already-extracted events (never raw documents).

The LLM only sees numbered event lines. Output is schema-validated, citations are
checked against real event numbers, and the safety backstop screens the text.
"""
import hashlib
import logging
from collections import Counter, OrderedDict
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from app.core.config import settings
from app.models.event import MedicalEvent
from app.services.intelligence.errors import PipelineError, SummaryError
from app.services.intelligence.llm import get_chat_model
from app.services.intelligence.safety import SUMMARY_SYSTEM_PROMPT, find_policy_violations

logger = logging.getLogger(__name__)

MAX_EVENTS = 150
DESC_CHARS = 400
CACHE_SIZE = 128
PLURALS = {"visit": "visits", "test": "tests", "diagnosis": "diagnoses",
           "treatment": "treatments", "medication": "medications"}


class _Point(BaseModel):
    text: str = Field(min_length=3, max_length=300, description="One neutral sentence restating documented events.")
    event_numbers: list[int] = Field(min_length=1, max_length=8, description="Numbers of the supporting events.")


class _LLMSummary(BaseModel):
    overview: str = Field(min_length=10, max_length=900, description="2-4 neutral sentences in date order.")
    key_points: list[_Point] = Field(default_factory=list, max_length=5)


@dataclass(slots=True)
class SummaryResult:
    overview: str
    key_points: list[tuple[str, list[UUID]]]
    category_counts: dict[str, int]


_HUMAN = """Date range: {date_range}.

Events, oldest first (each line: number | date | category | title | provider | description):
<events>
{events}
</events>"""

_prompt = ChatPromptTemplate.from_messages([("system", SUMMARY_SYSTEM_PROMPT), ("human", _HUMAN)])
_cache: OrderedDict[str, SummaryResult] = OrderedDict()  # in-process; use Redis for multi-worker


def _one_line(s: str | None, limit: int = 255) -> str:
    return " ".join((s or "-").split())[:limit]


def _render(events: list[MedicalEvent]) -> str:
    return "\n".join(
        f"[{i}] {e.event_date.isoformat()} | {e.event_type.value} | {_one_line(e.title)} | "
        f"{_one_line(e.provider)} | {_one_line(e.description, DESC_CHARS)}"
        for i, e in enumerate(events, start=1)
    )


def _fallback_overview(events: list[MedicalEvent], counts: dict[str, int]) -> str:
    parts = ", ".join(
        f"{n} {k if n == 1 else PLURALS.get(k, k + 's')}" for k, n in counts.items()
    )
    return (f"The records document {len(events)} events between "
            f"{events[0].event_date.isoformat()} and {events[-1].event_date.isoformat()}: {parts}.")


async def summarize_events(
    events: list[MedicalEvent], date_from: date | None, date_to: date | None
) -> SummaryResult:
    """`events` must be non-empty and sorted oldest first."""
    counts = dict(Counter(e.event_type.value for e in events))
    rendered = _render(events)
    date_range = f"{date_from or 'earliest'} to {date_to or 'latest'}"

    key = hashlib.sha256(f"{settings.llm_model}|{date_range}|{rendered}".encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]

    chain = (_prompt | get_chat_model().with_structured_output(_LLMSummary)).with_retry(
        stop_after_attempt=settings.llm_max_retries
    )
    try:
        raw: _LLMSummary = await chain.ainvoke({"date_range": date_range, "events": rendered})
    except PipelineError:
        raise
    except Exception as exc:
        logger.exception("Summary generation failed")
        raise SummaryError(f"Summary generation failed ({type(exc).__name__}).") from exc

    overview = raw.overview.strip()
    if find_policy_violations(overview):
        logger.warning("Summary overview failed the safety backstop; using deterministic fallback")
        overview = _fallback_overview(events, counts)

    points: list[tuple[str, list[UUID]]] = []
    for p in raw.key_points:
        ids = [events[n - 1].id for n in dict.fromkeys(p.event_numbers) if 1 <= n <= len(events)]
        if ids and not find_policy_violations(p.text):  # drop uncited or unsafe points
            points.append((p.text.strip(), ids))

    result = SummaryResult(overview=overview, key_points=points, category_counts=counts)
    _cache[key] = result
    while len(_cache) > CACHE_SIZE:
        _cache.popitem(last=False)
    return result
