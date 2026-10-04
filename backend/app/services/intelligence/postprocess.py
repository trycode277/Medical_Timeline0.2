"""Deterministic checks applied to LLM output: grounding, plausibility, dedupe."""
import logging
import re
from datetime import date, timedelta

from app.services.intelligence.safety import enforce_safety
from app.services.intelligence.schemas import ExtractedMedicalEvent

logger = logging.getLogger(__name__)

_WS = re.compile(r"\s+")
_TOKEN = re.compile(r"[a-z0-9]+")
MAX_FUTURE_DAYS = 366  # guards against OCR/LLM year slips (2024 -> 2042)


def _norm(s: str) -> str:
    return _WS.sub(" ", s).strip().casefold()


def is_grounded(quote: str, source: str, min_overlap: float = 0.85) -> bool:
    """True if the quoted evidence appears in the source text. Exact (whitespace- and
    case-insensitive) match first; otherwise a token-overlap tolerance for OCR noise
    such as hyphenation or line-break artifacts."""
    q, s = _norm(quote), _norm(source)
    if q and q in s:
        return True
    q_tokens = _TOKEN.findall(q)
    if len(q_tokens) < 3:
        return False
    s_tokens = set(_TOKEN.findall(s))
    return sum(t in s_tokens for t in q_tokens) / len(q_tokens) >= min_overlap


def filter_events(
    events: list[ExtractedMedicalEvent], source_text: str, today: date
) -> list[ExtractedMedicalEvent]:
    kept: list[ExtractedMedicalEvent] = []
    dropped = 0
    for ev in events:
        if ev.date > today + timedelta(days=MAX_FUTURE_DAYS):
            dropped += 1
        elif not is_grounded(ev.evidence_quote, source_text):
            dropped += 1  # likely hallucinated: evidence not found in the document
        else:
            kept.append(ev)
    kept = enforce_safety(kept)
    if dropped:
        logger.warning("Dropped %d ungrounded/implausible events", dropped)
    return kept


def dedupe_events(events: list[ExtractedMedicalEvent]) -> list[ExtractedMedicalEvent]:
    """Merge duplicates (same date + category + title), e.g. from chunk overlaps."""
    best: dict[tuple, ExtractedMedicalEvent] = {}
    for ev in events:
        key = (ev.date, ev.category, _norm(ev.title))
        current = best.get(key)
        if current is None or len(ev.description) > len(current.description):
            best[key] = ev
    return sorted(best.values(), key=lambda e: (e.date, e.category.value, e.title))
