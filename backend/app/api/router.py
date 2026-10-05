from fastapi import APIRouter

from app.api.routes import auth, events, patients, records, summaries

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(patients.router)
api_router.include_router(records.router)
api_router.include_router(summaries.router)
api_router.include_router(events.router)
