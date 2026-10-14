from celery import Celery

from app.core.config import settings

celery_app = Celery("wishtrip", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    imports=["app.workers.tasks"],
    # Reels download from Instagram and run ffmpeg/OCR: their own queue and worker
    # (concurrency 1), so they never hold up embedding jobs or hammer Instagram.
    task_routes={"reels.process": {"queue": "media"}},
)
