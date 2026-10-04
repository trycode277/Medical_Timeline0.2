import pytest

from app.core.config import Settings, check_production_settings

GOOD_DB = "postgresql+asyncpg://timeline:s3cret@db:5432/timeline"


def make(**kw):
    return Settings(_env_file=None, **kw)


def test_managed_host_urls_are_normalized_for_asyncpg():
    s = make(database_url="postgres://u:p@host:5432/db?sslmode=require")
    assert s.database_url == "postgresql+asyncpg://u:p@host:5432/db?ssl=require"
    assert make(database_url="postgresql://u:p@h/db").database_url.startswith("postgresql+asyncpg://")


def test_api_keys_are_masked_in_repr():
    assert "super-secret-key" not in repr(make(anthropic_api_key="super-secret-key"))


def test_development_does_not_require_keys():
    check_production_settings(make(environment="development"))


def test_production_requires_llm_key():
    with pytest.raises(RuntimeError, match="API key"):
        check_production_settings(make(environment="production", database_url=GOOD_DB))


def test_production_rejects_default_database_credentials():
    with pytest.raises(RuntimeError, match="default"):
        check_production_settings(make(environment="production", anthropic_api_key="k"))


def test_production_rejects_wildcard_cors():
    with pytest.raises(RuntimeError, match="CORS"):
        check_production_settings(
            make(environment="production", anthropic_api_key="k", database_url=GOOD_DB, cors_origins=["*"])
        )


def test_valid_production_config_passes():
    check_production_settings(make(environment="production", anthropic_api_key="k", database_url=GOOD_DB))


def test_openai_provider_checks_the_openai_key():
    with pytest.raises(RuntimeError, match="openai"):
        check_production_settings(
            make(environment="production", llm_provider="openai", anthropic_api_key="k", database_url=GOOD_DB)
        )
