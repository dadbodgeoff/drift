from app.core.routing import VersionedRouter

router = VersionedRouter()


@router.delete("/users/{user_id}")
def delete_user(user_id: int) -> None:
    return None
