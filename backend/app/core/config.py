import tempfile
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (or a local .env in development)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "production"] = "development"
    app_name: str = "Patient Medical Timeline API"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/timeline"
    db_echo: bool = False

    # Temporary upload storage. Files are deleted as soon as processing finishes.
    upload_dir: Path = Path(tempfile.gettempdir()) / "timeline_uploads"
    max_upload_mb: int = 25
    max_files_per_upload: int = 20
    # Safety net for files orphaned by crashes: anything older than this is deleted
    upload_sweep_max_age_minutes: int = 60
    upload_sweep_interval_minutes: int = 15

    cors_origins: list[str] = ["http://localhost:3000"]

    # --- OCR ---
    ocr_language: str = "eng"          # tesseract language(s), e.g. "eng+spa"
    ocr_dpi: int = 300                 # rasterization DPI for scanned PDF pages
    ocr_min_text_chars: int = 40       # below this, a PDF page is treated as scanned
    max_pages_per_file: int = 200

    # --- LLM extraction ---
    llm_provider: Literal["anthropic", "openai", "ollama"] = "anthropic"
    llm_model: str = "claude-sonnet-5-5"   # e.g. "gpt-4o" when llm_provider="openai"
    anthropic_api_key: SecretStr | None = None   # SecretStr: masked in repr/logs
    openai_api_key: SecretStr | None = None
    llm_max_tokens: int = 4096
    llm_timeout_seconds: int = 120
    llm_max_retries: int = 3
    extraction_chunk_chars: int = 12000    # ~3k tokens of source text per LLM call
    extraction_concurrency: int = 3        # parallel LLM calls per record
    max_concurrent_records: int = 2        # records processed at once per worker

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg_driver(cls, v: str) -> str:
        """Managed Postgres hosts hand out postgres:// or postgresql:// URLs (often with
        sslmode=...); the async engine needs the asyncpg driver and asyncpg's ssl= option."""
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                v = "postgresql+asyncpg://" + v[len(prefix):]
        return v.replace("sslmode=", "ssl=")

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()


def check_production_settings(s: Settings) -> None:
    """Fail fast at startup instead of running a production instance with unsafe config."""
    if s.environment != "production":
        return

    problems: list[str] = []

    if s.llm_provider != "ollama":
        key = (
            s.anthropic_api_key
            if s.llm_provider == "anthropic"
            else s.openai_api_key
        )

        if not key or not key.get_secret_value():
            problems.append(
                f"no API key set for LLM_PROVIDER={s.llm_provider}"
            )

    if "postgres:postgres@" in s.database_url:
        problems.append(
            "DATABASE_URL uses the default postgres:postgres credentials"
        )

    if "*" in s.cors_origins:
        problems.append("CORS_ORIGINS must not contain '*'")

    if problems:
        raise RuntimeError(
            "Refusing to start in production: " + "; ".join(problems)
        )