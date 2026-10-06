from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from starlette.concurrency import run_in_threadpool

from app.api.deps import SessionDep, get_current_user
from app.core.security import (
    AuthenticationConfigurationError,
    create_access_token,
    hash_password,
    verify_password,
)
from app.models.enums import AccountType
from app.models.patient import Patient
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
async def register(payload: RegisterRequest, session: SessionDep):
    existing_user = await session.exec(
        select(User).where(User.email == str(payload.email))
    )
    if existing_user.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    hashed_password = await run_in_threadpool(hash_password, payload.password)
    user = User(
        full_name=payload.full_name,
        email=str(payload.email),
        password_hash=hashed_password,
        account_type=payload.account_type,
    )

    if payload.account_type == AccountType.PATIENT:
        name_parts = payload.full_name.split()
        first_name = name_parts[0]
        last_name = " ".join(name_parts[1:])
        if len(first_name) > 100 or len(last_name) > 100:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Full name cannot be represented within the patient name field limits.",
            )
        user.patient = Patient(first_name=first_name, last_name=last_name)

    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from exc
    return user


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, session: SessionDep):
    result = await session.exec(select(User).where(User.email == str(payload.email)))
    user = result.first()
    if user is None or not await run_in_threadpool(
        verify_password, payload.password, user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        access_token = create_access_token(user.id)
    except AuthenticationConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured.",
        ) from exc

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user,
    }


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    session: SessionDep,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    password_matches = await run_in_threadpool(
        verify_password, payload.current_password, current_user.password_hash
    )
    if not password_matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password.",
        )

    current_user.password_hash = await run_in_threadpool(
        hash_password, payload.new_password
    )
    session.add(current_user)
    try:
        await session.commit()
    except BaseException:
        await session.rollback()
        raise

    return {"message": "Password changed successfully."}
