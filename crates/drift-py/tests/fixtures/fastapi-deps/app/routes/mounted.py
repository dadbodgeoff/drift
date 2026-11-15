from fastapi import APIRouter

router = APIRouter(prefix="/mounted")


@router.get("/")
def mounted_list() -> list:
    return []
