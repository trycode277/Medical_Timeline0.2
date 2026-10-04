"""Structured event extraction: pages -> chunks -> LLM (schema-forced) -> validated,
grounded, safety-checked, deduplicated events."""
import asyncio
import logging
from datetime import datetime, timezone

from langchain_core.prompts import ChatPromptTemplate

from app.core.config import settings
from app.services.intelligence.errors import ExtractionError, PipelineError
from app.services.intelligence.llm import get_chat_model
from app.services.intelligence.ocr import PageText
from app.services.intelligence.postprocess import dedupe_events, filter_events
from app.services.intelligence.safety import SAFETY_SYSTEM_PROMPT
from app.services.intelligence.schemas import ExtractedMedicalEvent, ExtractionResult

logger = logging.getLogger(__name__)

# NOTE: no curly braces here; only {today} and {document_text} are template variables.
EXTRACTION_INSTRUCTIONS = """TASK
Extract every dated medical event from the document excerpt and return it in the required structure.

CATEGORIES (choose exactly one per event)
- visit: an encounter such as an appointment, consultation, admission, discharge, emergency or telehealth visit.
- test: a lab test, imaging study, biopsy, ECG, screening or similar, with results reported exactly as written.
- diagnosis: a condition the document states was diagnosed or assessed by a clinician.
- treatment: a procedure, surgery, therapy, vaccination or other intervention.
- medication: a medication prescribed, started, changed, stopped or administered. Give name, dose, route and frequency only as written.

RULES
- One event per distinct occurrence. Do not duplicate the same event.
- date must be YYYY-MM-DD. If only month and year are given, use the first day of that month and state in the description that the exact day is not specified. If a date cannot be determined from the document (including encounter or report dates stated elsewhere in the excerpt), skip the event.
- title: a short neutral label (about 80 characters or fewer).
- description: 1-3 factual sentences using only information stated in the document.
- provider: the clinician, facility or lab as named in the document, otherwise null.
- source_page: the page number from the PAGE markers.
- evidence_quote: copy a short verbatim excerpt from the document that supports the event. Do not paraphrase.
- If the excerpt contains no dated events, return an empty list."""

HUMAN_TEMPLATE = """Today's date is {today}. Pages in the excerpt are marked with lines like PAGE 3.

<document>
{document_text}
</document>"""

_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", SAFETY_SYSTEM_PROMPT + "\n\n" + EXTRACTION_INSTRUCTIONS),
        ("human", HUMAN_TEMPLATE),
    ]
)


def chunk_pages(pages: list[PageText], max_chars: int) -> list[list[PageText]]:
    """Group consecutive pages into chunks of roughly max_chars (page boundaries kept)."""
    chunks: list[list[PageText]] = []
    current: list[PageText] = []
    size = 0
    for page in pages:
        if not page.text.strip():
            continue
        if current and size + len(page.text) > max_chars:
            chunks.append(current)
            current, size = [], 0
        current.append(page)
        size += len(page.text)
    if current:
        chunks.append(current)
    return chunks


def render_chunk(chunk: list[PageText]) -> str:
    return "\n\n".join(f"PAGE {p.page_number}\n{p.text}" for p in chunk)


def _build_chain():
    llm = get_chat_model().with_structured_output(ExtractionResult)
    # Retries transient API errors and schema-validation failures
    return (_prompt | llm).with_retry(stop_after_attempt=settings.llm_max_retries)


async def extract_events_from_pages(pages: list[PageText]) -> list[ExtractedMedicalEvent]:
    chunks = chunk_pages(pages, settings.extraction_chunk_chars)
    if not chunks:
        raise ExtractionError("No readable text could be extracted from this file.")

    chain = _build_chain()
    semaphore = asyncio.Semaphore(settings.extraction_concurrency)
    today = datetime.now(timezone.utc).date()

    async def run(chunk: list[PageText]) -> list[ExtractedMedicalEvent]:
        text = render_chunk(chunk)
        async with semaphore:
            result: ExtractionResult = await chain.ainvoke(
                {"today": today.isoformat(), "document_text": text}
            )
        return filter_events(result.events, text, today)

    try:
        per_chunk = await asyncio.gather(*(run(c) for c in chunks))
    except PipelineError:
        raise
    except Exception as exc:
        # Fail the whole record rather than silently saving a partial timeline.
        # Deliberately excludes str(exc): validation errors can echo document text.
        logger.exception("LLM extraction failed")
        raise ExtractionError(f"LLM extraction failed ({type(exc).__name__}).") from exc

    events = dedupe_events([e for chunk_events in per_chunk for e in chunk_events])
    logger.info("Extracted %d events from %d chunks", len(events), len(chunks))
    return events
