from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

import anyio
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

# content-type -> extension, and the magic bytes we expect at the start of the file
ALLOWED_TYPES: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
}
MAGIC_BYTES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF-",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".tiff": (b"II*\x00", b"MM\x00*"),
    ".webp": (b"RIFF",),
}
CHUNK_SIZE = 1024 * 1024


@dataclass(slots=True)
class StoredFile:
    path: Path
    original_filename: str
    content_type: str
    size: int


async def save_upload_temporarily(upload: UploadFile, patient_id: UUID) -> StoredFile:
    """Stream an upload to disk with type, magic-byte and size validation.

    The client filename is never used in the path (avoids traversal); we keep it
    only as metadata.
    """
    content_type = (upload.content_type or "").lower()
    ext = ALLOWED_TYPES.get(content_type)
    if ext is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type '{content_type}'. Allowed: {', '.join(ALLOWED_TYPES)}",
        )

    dest_dir = settings.upload_dir / str(patient_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{uuid4().hex}{ext}"

    size = 0
    try:
        async with await anyio.open_file(dest, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                if size == 0 and not chunk.startswith(MAGIC_BYTES[ext]):
                    raise HTTPException(
                        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        f"File content does not match declared type '{content_type}'.",
                    )
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File exceeds the {settings.max_upload_mb} MB limit.",
                    )
                await out.write(chunk)
        if size == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file is empty.")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise

    return StoredFile(
        path=dest,
        original_filename=Path(upload.filename or "upload").name[:255],
        content_type=content_type,
        size=size,
    )
