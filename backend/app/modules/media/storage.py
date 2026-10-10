"""Media storage. Local disk (a Docker volume) for now; an S3 backend can implement the same API."""

import uuid
from pathlib import Path

from app.core.config import settings


class LocalStorage:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root or settings.media_root)

    def save(self, data: bytes, filename: str, folder: str) -> str:
        suffix = Path(filename).suffix.lower()[:10]
        key = f"{folder}/{uuid.uuid4().hex}{suffix}"
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def delete(self, key: str) -> None:
        (self.root / key).unlink(missing_ok=True)

    def url(self, key: str) -> str:
        return f"{settings.media_url_prefix}/{key}"


storage = LocalStorage()
