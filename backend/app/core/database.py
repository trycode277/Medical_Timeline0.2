from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=settings.db_echo, pool_pre_ping=True)

async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


async def init_db() -> None:
    """Dev convenience. Use Alembic migrations in production."""
    import app.models  # noqa: F401  (registers tables on SQLModel.metadata)

    async with engine.begin() as conn:
        # Serialize schema creation across uvicorn workers / replicas starting together
        await conn.execute(text("SELECT pg_advisory_xact_lock(72656311)"))
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.execute(
            text("ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id UUID")
        )
        await conn.execute(
            text(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'fk_patients_user_id_users'
                          AND conrelid = 'patients'::regclass
                    ) THEN
                        ALTER TABLE patients
                        ADD CONSTRAINT fk_patients_user_id_users
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'uq_patients_user_id'
                          AND conrelid = 'patients'::regclass
                    ) THEN
                        ALTER TABLE patients
                        ADD CONSTRAINT uq_patients_user_id UNIQUE (user_id);
                    END IF;
                END
                $$;
                """
            )
        )
