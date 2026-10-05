from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlmodel import select

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_session
from app.core.security import create_access_token, verify_password
from app.models.enums import AccountType
from app.models.patient import Patient
from app.models.user import User


@pytest.fixture(autouse=True)
def jwt_secret(monkeypatch):
    monkeypatch.setattr(
        settings,
        "jwt_secret_key",
        SecretStr("test-only-secret-key-with-at-least-32-bytes"),
    )


async def test_registration_creates_safe_user_and_hashes_password(client, session_factory):
    response = await client.post(
        "/api/auth/register",
        json={
            "full_name": "  Alex Example  ",
            "email": "  ALEX@example.com ",
            "password": "correct-horse-battery",
            "account_type": "patient",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["full_name"] == "Alex Example"
    assert body["email"] == "alex@example.com"
    assert body["account_type"] == "patient"
    assert "password" not in body
    assert "password_hash" not in body

    async with session_factory() as session:
        user = (await session.exec(select(User))).one()
        patient = (await session.exec(select(Patient))).one()
    assert user.password_hash != "correct-horse-battery"
    assert verify_password("correct-horse-battery", user.password_hash)
    assert patient.user_id == user.id
    assert patient.first_name == "Alex"
    assert patient.last_name == "Example"


@pytest.mark.parametrize(
    ("full_name", "expected_first", "expected_last"),
    [("Dayananda K S", "Dayananda", "K S"), ("John", "John", "")],
)
async def test_patient_registration_parses_names(
    client, session_factory, full_name, expected_first, expected_last
):
    response = await client.post(
        "/api/auth/register",
        json={
            "full_name": full_name,
            "email": f"{expected_first.lower()}@example.com",
            "password": "correct-horse-battery",
            "account_type": "patient",
        },
    )
    assert response.status_code == 201

    async with session_factory() as session:
        patient = (await session.exec(select(Patient))).one()
    assert patient.first_name == expected_first
    assert patient.last_name == expected_last


@pytest.mark.parametrize("account_type", ["caregiver", "clinician"])
async def test_non_patient_registration_does_not_create_patient(
    client, session_factory, account_type
):
    response = await client.post(
        "/api/auth/register",
        json={
            "full_name": "Alex Example",
            "email": f"{account_type}@example.com",
            "password": "correct-horse-battery",
            "account_type": account_type,
        },
    )
    assert response.status_code == 201
    async with session_factory() as session:
        users = (await session.exec(select(User))).all()
        patients = (await session.exec(select(Patient))).all()
    assert len(users) == 1
    assert patients == []


async def test_registration_rejects_duplicate_normalized_email(client):
    payload = {
        "full_name": "Alex Example",
        "email": "alex@example.com",
        "password": "correct-horse-battery",
        "account_type": "patient",
    }
    assert (await client.post("/api/auth/register", json=payload)).status_code == 201
    payload["email"] = " ALEX@EXAMPLE.COM "

    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {"full_name": "", "email": "valid@example.com", "password": "correct-password"},
        {"full_name": "Alex", "email": "not-an-email", "password": "correct-password"},
        {"full_name": "Alex", "email": "valid@example.com", "password": "short"},
        {
            "full_name": "Alex",
            "email": "valid@example.com",
            "password": "correct-password",
            "account_type": "administrator",
        },
    ],
)
async def test_registration_rejects_invalid_data(client, payload):
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 422


async def test_login_returns_bearer_token_and_safe_user(client):
    await client.post(
        "/api/auth/register",
        json={
            "full_name": "Alex Example",
            "email": "alex@example.com",
            "password": "correct-horse-battery",
            "account_type": "clinician",
        },
    )

    response = await client.post(
        "/api/auth/login",
        json={"email": " ALEX@EXAMPLE.COM ", "password": "correct-horse-battery"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "alex@example.com"
    assert body["user"]["account_type"] == "clinician"
    assert "password_hash" not in body["user"]


async def test_patient_login_succeeds_with_linked_patient(client, session_factory):
    await client.post(
        "/api/auth/register",
        json={
            "full_name": "Patient Example",
            "email": "patient@example.com",
            "password": "correct-horse-battery",
            "account_type": "patient",
        },
    )
    response = await client.post(
        "/api/auth/login",
        json={"email": "patient@example.com", "password": "correct-horse-battery"},
    )
    assert response.status_code == 200
    assert response.json()["access_token"]
    async with session_factory() as session:
        user = (await session.exec(select(User))).one()
        patient = (await session.exec(select(Patient))).one()
    assert patient.user_id == user.id


@pytest.mark.parametrize(
    "email,password",
    [
        ("alex@example.com", "wrong-password"),
        ("missing@example.com", "correct-horse-battery"),
    ],
)
async def test_login_rejects_wrong_password_or_unknown_email(client, email, password):
    await client.post(
        "/api/auth/register",
        json={
            "full_name": "Alex Example",
            "email": "alex@example.com",
            "password": "correct-horse-battery",
            "account_type": "patient",
        },
    )

    response = await client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


async def test_protected_route_rejects_missing_or_invalid_bearer_token(
    session_factory,
):
    probe = FastAPI()

    @probe.get("/protected")
    async def protected(
        user: Annotated[User, Depends(get_current_user)],
    ):
        return {"id": str(user.id)}

    async def override_session():
        async with session_factory() as session:
            yield session

    async with session_factory() as session:
        user = User(
            full_name="Test User",
            email="test@example.com",
            password_hash="not-used-by-this-test",
            account_type=AccountType.PATIENT,
        )
        session.add(user)
        await session.commit()
    valid_token = create_access_token(user.id)

    probe.dependency_overrides[get_session] = override_session
    async with AsyncClient(
        transport=ASGITransport(app=probe), base_url="http://test"
    ) as client:
        missing = await client.get("/protected")
        invalid = await client.get(
            "/protected", headers={"Authorization": "Bearer not-a-valid-jwt"}
        )
        valid = await client.get(
            "/protected",
            headers={"Authorization": f"Bearer {valid_token}"},
        )

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert valid.status_code == 200
    assert valid.json()["id"] == str(user.id)
    assert missing.headers["www-authenticate"] == "Bearer"
    assert invalid.headers["www-authenticate"] == "Bearer"
