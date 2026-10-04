import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import check_production_settings, settings
from app.core.database import engine, init_db
from app.services.cleanup import run_upload_sweeper


@asynccontextmanager
async def lifespan(app: FastAPI):
    check_production_settings(settings)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    await init_db()
    sweeper = asyncio.create_task(run_upload_sweeper())
    yield
    sweeper.cancel()
    with suppress(asyncio.CancelledError):
        await sweeper
    await engine.dispose()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}
