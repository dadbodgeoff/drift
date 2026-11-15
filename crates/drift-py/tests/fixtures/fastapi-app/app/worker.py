from celery import Celery, shared_task
from celery.schedules import crontab

celery_app = Celery("worker")
celery_app.conf.beat_schedule = {
    "nightly-cleanup": {"task": "app.worker.cleanup", "schedule": crontab(hour=3)},
    "not-a-task-here": {"task": "elsewhere.tasks.run", "schedule": 60.0},
}


@celery_app.task(name="send-email", bind=True)
def send_email(self, to: str) -> None:
    print(to)


@shared_task
def cleanup() -> None:
    pass


@celery_app.task
def reindex() -> None:
    pass


@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs) -> None:
    sender.add_periodic_task(600.0, reindex.s(), name="reindex-every-10-minutes")
