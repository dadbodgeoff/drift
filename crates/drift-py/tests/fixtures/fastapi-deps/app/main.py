from fastapi import Depends, FastAPI

from app.deps import get_current_active_user
from app.routes import guarded, mounted, soft, strict

app = FastAPI()
app.include_router(strict.router)
app.include_router(guarded.router)
app.include_router(soft.router)
# (c) dependencies added at the mount.
app.include_router(mounted.router, dependencies=[Depends(get_current_active_user)])
