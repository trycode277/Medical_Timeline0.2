from datetime import date

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.services.intelligence import extraction, llm
from app.services.intelligence.errors import ExtractionError, LLMConfigError
from app.services.intelligence.ocr import PageText
from app.services.intelligence.postprocess import dedupe_events, filter_events, is_grounded
from app.services.intelligence.safety import enforce_safety, find_policy_violations
from app.services.intelligence.schemas import ExtractedMedicalEvent, ExtractionResult

TODAY = date(2025, 1, 1)
SOURCE = "Follow-up visit on 2024-03-04 with Dr. Rivera. Blood pressure measured 128 over 82 at clinic."


def make_event(**over):
    base = dict(
        date="2024-03-04", category="visit", title="Follow-up visit",
        description="Routine follow-up documented.", provider="Dr. Rivera", source_page=1,
        evidence_quote="Follow-up visit on 2024-03-04",
    )
    return ExtractedMedicalEvent(**{**base, **over})


class FakeChain:
    def __init__(self, *results):
        self.results, self.calls = list(results), []

    async def ainvoke(self, inputs):
        self.calls.append(inputs)
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, Exception):
            raise result
        return result


# ---------- schema ----------
def test_schema_rejects_unknown_category_and_ancient_dates():
    with pytest.raises(ValidationError):
        make_event(category="surgery")
    with pytest.raises(ValidationError):
        make_event(date="1850-01-01")


def test_schema_normalizes_blank_provider_and_trims_text():
    ev = make_event(provider="   ", title="  Padded title  ")
    assert ev.provider is None and ev.title == "Padded title"


# ---------- grounding / plausibility / dedupe ----------
def test_grounding_exact_and_noisy_quotes_pass_hallucinations_fail():
    assert is_grounded("FOLLOW-UP visit  on 2024-03-04", SOURCE)
    assert is_grounded("blood pressure measured 128 over 82 at the clinic", SOURCE)  # OCR-noise tolerance
    assert not is_grounded("Patient underwent cardiac bypass surgery", SOURCE)


def test_filter_events_drops_ungrounded_and_far_future_events():
    good = make_event()
    invented = make_event(title="Invented surgery", evidence_quote="Patient underwent cardiac bypass surgery")
    future = make_event(date="2030-01-01", title="Year slip")
    kept = filter_events([good, invented, future], SOURCE, TODAY)
    assert [e.title for e in kept] == ["Follow-up visit"]


def test_dedupe_keeps_longest_description():
    short = make_event(description="Short.")
    long = make_event(description="A longer, more complete description.")
    (kept,) = dedupe_events([short, long])
    assert kept.description.startswith("A longer")


# ---------- safety ----------
@pytest.mark.parametrize("text", [
    "You should stop taking this medication.",
    "I recommend a follow-up scan.",
    "The patient likely has diabetes.",
    "Please consult your doctor about this.",
])
def test_safety_backstop_flags_advice_and_speculation(text):
    assert find_policy_violations(text)


def test_safety_backstop_allows_documented_facts():
    assert not find_policy_violations("Physician documented HbA1c of 7.4 %, flagged high in the report.")
    assert not find_policy_violations("Patient advised by the nurse to reduce salt intake.")


def test_enforce_safety_drops_advice_events():
    bad = make_event(title="Advice", description="You should stop taking Metformin.")
    assert enforce_safety([make_event(), bad]) == [make_event()]


def test_prompts_format_without_template_errors():
    msgs = extraction._prompt.format_messages(today="2025-01-01", document_text="{curly} braces")
    assert len(msgs) == 2 and "NEVER diagnose" in msgs[0].content
    assert "{curly} braces" in msgs[1].content

    from app.services.intelligence import summary
    assert len(summary._prompt.format_messages(date_range="a to b", events="[1] x")) == 2


# ---------- chunking ----------
def test_chunk_pages_respects_limit_and_skips_blank_pages():
    pages = [PageText(1, "a" * 100, "ocr"), PageText(2, "b" * 100, "ocr"),
             PageText(3, "   ", "ocr"), PageText(4, "c" * 100, "ocr")]
    chunks = extraction.chunk_pages(pages, max_chars=250)
    assert [[p.page_number for p in c] for c in chunks] == [[1, 2], [4]]
    assert "PAGE 2" in extraction.render_chunk(chunks[0])


# ---------- end-to-end extraction with a fake LLM ----------
async def test_extract_events_keeps_grounded_drops_hallucinated_and_dedupes(monkeypatch):
    result = ExtractionResult(events=[
        make_event(),
        make_event(title="Invented", evidence_quote="Patient underwent cardiac bypass surgery"),
    ])
    monkeypatch.setattr(extraction, "_build_chain", lambda: FakeChain(result))
    monkeypatch.setattr(settings, "extraction_chunk_chars", 60)  # force two chunks, same text each
    pages = [PageText(1, SOURCE, "text_layer"), PageText(2, SOURCE, "text_layer")]
    events = await extraction.extract_events_from_pages(pages)
    assert [e.title for e in events] == ["Follow-up visit"]  # grounded, and merged across chunks


async def test_extraction_without_text_raises_clear_error():
    with pytest.raises(ExtractionError):
        await extraction.extract_events_from_pages([PageText(1, "  ", "ocr")])


async def test_llm_failure_message_never_leaks_document_text(monkeypatch):
    monkeypatch.setattr(extraction, "_build_chain", lambda: FakeChain(ValueError("PATIENT-SECRET-TEXT")))
    with pytest.raises(ExtractionError) as err:
        await extraction.extract_events_from_pages([PageText(1, SOURCE, "ocr")])
    assert "PATIENT-SECRET-TEXT" not in str(err.value)
    assert "ValueError" in str(err.value)


def test_missing_api_key_is_a_config_error(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "anthropic")
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    llm.get_chat_model.cache_clear()
    with pytest.raises(LLMConfigError):
        llm.get_chat_model()
