from litestar import Controller, Router, get, post

from app.guards import requires_admin


class ItemController(Controller):
    path = "/items"

    @get("/{item_id:int}", guards=[requires_admin])
    async def show(self, item_id: int) -> dict:
        return {"id": item_id}

    @post("/")
    async def create(self, data: dict) -> dict:
        return data


@get("/stats")
async def stats() -> dict:
    return {}


admin_router = Router(path="/admin", route_handlers=[stats], guards=[requires_admin])
