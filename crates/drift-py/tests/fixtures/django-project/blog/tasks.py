from celery import shared_task


@shared_task
def purge_drafts() -> None:
    pass
