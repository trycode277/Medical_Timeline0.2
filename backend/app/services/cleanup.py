"""Data minimization: uploaded files are removed as soon as processing has finished, and a
periodic sweep deletes anything orphaned by a crash. OCR text is never written to disk
(it lives in memory only for the duration of the pipeline)."""
import asyncio
import logging
import time
from pathlib import Path

from anyio import to_thread

from app.core.config import settings

logger = logging.getLogger(__name__)


def delete_file(path: Path | str | None) -> bool:
    """Best-effort delete of one upload (plus its per-patient folder if now empty)."""
    if not path:
        return False
    p = Path(path)
    existed = p.exists()
    try:
        p.unlink(missing_ok=True)
        try:
            p.parent.rmdir()  # only succeeds when empty
        except OSError:
            pass
    except OSError:
        logger.exception("Could not delete upload file")
        return False
    return existed


def sweep_stale_uploads(root: Path, max_age_seconds: float, now: float | None = None) -> int:
    """Delete files under `root` older than `max_age_seconds`; prune empty folders."""
    if not root.exists():
        return 0
    cutoff = (now if now is not None else time.time()) - max_age_seconds
    removed = 0
    for p in root.rglob("*"):
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                removed += 1
        except OSError:
            logger.exception("Sweep could not delete a stale upload")
    for d in sorted((x for x in root.rglob("*") if x.is_dir()), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass
    return removed


async def run_upload_sweeper() -> None:
    """Background loop started from the app lifespan."""
    while True:
        try:
            removed = await to_thread.run_sync(
                sweep_stale_uploads,
                settings.upload_dir,
                settings.upload_sweep_max_age_minutes * 60,
            )
            if removed:
                logger.info("Sweeper removed %d stale upload(s)", removed)
        except Exception:
            logger.exception("Upload sweeper iteration failed")
        await asyncio.sleep(settings.upload_sweep_interval_minutes * 60)
