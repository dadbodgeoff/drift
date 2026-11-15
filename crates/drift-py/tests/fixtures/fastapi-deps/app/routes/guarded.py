from fastapi import APIRouter, Depends

from app.deps import get_current_active_user

# (c) router-level dependencies: every route of the router depends on them.
router = APIRouter(prefix="/guarded", dependencies=[Depends(get_current_active_user)])


@router.get("/")
def guarded_list() -> list:
    return []
