from app.core.security import hash_password, verify_password
from app.models.user import User


async def set_account_password(session_factory, user_id, password: str) -> None:
    async with session_factory() as session:
        user = await session.get(User, user_id)
        assert user is not None
        user.password_hash = hash_password(password)
        session.add(user)
        await session.commit()


async def test_authenticated_user_can_change_password(
    client, session_factory, registered_patient
):
    patient, token = registered_patient
    await set_account_password(session_factory, patient.user_id, "current-password")

    response = await client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": "current-password",
            "new_password": "replacement-password",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Password changed successfully."}
    async with session_factory() as session:
        user = await session.get(User, patient.user_id)
    assert user is not None
    assert user.password_hash != "replacement-password"
    assert verify_password("replacement-password", user.password_hash)


async def test_change_password_rejects_incorrect_current_password(
    client, session_factory, registered_patient
):
    patient, token = registered_patient
    await set_account_password(session_factory, patient.user_id, "current-password")

    response = await client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": "incorrect-password",
            "new_password": "replacement-password",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Current password is incorrect."
    async with session_factory() as session:
        user = await session.get(User, patient.user_id)
    assert user is not None
    assert verify_password("current-password", user.password_hash)


async def test_change_password_requires_authentication(client):
    response = await client.post(
        "/api/auth/change-password",
        json={
            "current_password": "current-password",
            "new_password": "replacement-password",
        },
    )

    assert response.status_code == 401


async def test_change_password_rejects_short_or_same_password(
    client, session_factory, registered_patient
):
    patient, token = registered_patient
    await set_account_password(session_factory, patient.user_id, "current-password")
    headers = {"Authorization": f"Bearer {token}"}

    short_password = await client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": "current-password", "new_password": "short"},
    )
    same_password = await client.post(
        "/api/auth/change-password",
        headers=headers,
        json={
            "current_password": "current-password",
            "new_password": "current-password",
        },
    )

    assert short_password.status_code == 422
    assert same_password.status_code == 400


async def test_change_password_does_not_accept_a_client_user_id(
    client, session_factory, registered_patient
):
    patient, token = registered_patient
    await set_account_password(session_factory, patient.user_id, "current-password")

    response = await client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "user_id": "00000000-0000-0000-0000-000000000001",
            "current_password": "current-password",
            "new_password": "replacement-password",
        },
    )

    assert response.status_code == 422
    async with session_factory() as session:
        user = await session.get(User, patient.user_id)
    assert user is not None
    assert verify_password("current-password", user.password_hash)
