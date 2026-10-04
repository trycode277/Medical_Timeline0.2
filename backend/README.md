# Patient Medical Timeline API

FastAPI + SQLModel (async) + PostgreSQL.

## Run
OCR needs the Tesseract binary: `sudo apt install tesseract-ocr` (or `brew install tesseract`).
```bash
cp .env.example .env   # set ANTHROPIC_API_KEY (or OPENAI_API_KEY + LLM_PROVIDER=openai, LLM_MODEL=gpt-4o)
docker compose up -d db
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Docs: http://localhost:8000/docs

## Try it
```bash
# 1. create a patient
curl -X POST localhost:8000/api/patients -H 'Content-Type: application/json' \
  -d '{"first_name":"Jane","last_name":"Doe"}'

# 2. upload records (returns 202 + record ids; poll /api/records/{id})
curl -X POST localhost:8000/api/records/upload \
  -F patient_id=<PATIENT_ID> -F files=@scan.pdf -F files=@page2.png

# 3. filter / search events
curl "localhost:8000/api/events?patient_id=<ID>&event_type=test&event_type=diagnosis&date_from=2024-01-01&q=glucose"
```

## Layout
```
backend/
├── app/
│   ├── main.py            # app factory, lifespan, CORS
│   ├── core/              # config (env), async DB engine/session
│   ├── models/            # SQLModel tables: Patient, MedicalRecord, MedicalEvent
│   ├── schemas/           # request/response models
│   ├── api/
│   │   ├── deps.py
│   │   ├── router.py
│   │   └── routes/        # patients, records (upload), events (CRUD/filter/search)
│   └── services/
│       ├── storage.py     # validated streaming upload to temp storage
│       ├── pipeline.py    # background job: OCR -> extraction -> persist events
│       └── intelligence/
│           ├── ocr.py         # PDF text layer + Tesseract fallback, images/TIFF
│           ├── schemas.py     # strict Pydantic output schema
│           ├── safety.py      # safety system prompt + output backstop
│           ├── extraction.py  # prompt, chunking, LangChain structured output
│           ├── postprocess.py # grounding check, date sanity, dedupe
│           └── llm.py         # Anthropic/OpenAI chat model factory
├── requirements.txt
├── docker-compose.yml
└── .env.example
```

## Production TODOs
- Alembic migrations instead of `create_all`
- Durable queue (Celery/ARQ) instead of `BackgroundTasks`; object storage instead of local temp dir
- PHI compliance: use an LLM vendor agreement (BAA / zero data retention) or de-identify text before sending it
- Auth + per-user access control and audit logging (this is PHI; consider HIPAA/GDPR obligations)
- `pg_trgm` / `tsvector` index for faster search

## Testing
```bash
pip install -r requirements-dev.txt
pytest                      # unit tests (SQLite in memory; no Postgres, LLM or network needed)
pytest -m "not ocr"         # skip the OCR tests
python scripts/generate_mock_records.py --out mock_data   # synthetic PDFs/PNG for manual runs
```
OCR scanned-file tests need the `tesseract` binary and are skipped if it is missing.
