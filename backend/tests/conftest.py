import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

import app.models  # noqa: F401  (registers tables)
from app.core.config import settings
from app.core.database import get_session
from app.main import app as fastapi_app
from app.core.security import create_access_token
from app.models import AccountType, Patient, User


@pytest_asyncio.fixture
async def session_factory():
    """In-memory SQLite stands in for Postgres (no server needed for unit tests)."""
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def client(session_factory, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")

    async def override_session():
        async with session_factory() as session:
            yield session

    fastapi_app.dependency_overrides[get_session] = override_session
    # ASGITransport does not run the lifespan, so no Postgres / sweeper is started
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def patient(session_factory):
    async with session_factory() as session:
        p = Patient(first_name="Jane", last_name="Testpatient")
        session.add(p)
        await session.commit()
        return p


@pytest_asyncio.fixture
async def registered_patient(session_factory, monkeypatch):
    monkeypatch.setattr(
        settings,
        "jwt_secret_key",
        SecretStr("test-only-secret-key-with-at-least-32-bytes"),
    )
    async with session_factory() as session:
        user = User(
            full_name="Jane Testpatient",
            email="jane.testpatient@example.com",
            password_hash="not-used-by-this-test",
            account_type=AccountType.PATIENT,
        )
        patient = Patient(first_name="Jane", last_name="Testpatient", user=user)
        session.add(user)
        await session.commit()
        await session.refresh(patient)
        return patient, create_access_token(user.id)
