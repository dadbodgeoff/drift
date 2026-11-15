from fastapi import APIRouter, Depends

from app.api.deps import get_current_superuser
from app.api.routes import admin, items

api_router = APIRouter()
api_router.include_router(items.router)
api_router.include_router(
    admin.router, prefix="/admin", dependencies=[Depends(get_current_superuser)]
)
