from litestar import Litestar, get

from app.items import ItemController, admin_router


async def log_response(response):
    return response


@get("/health")
async def health() -> dict:
    return {"ok": True}


app = Litestar(
    route_handlers=[health, ItemController, admin_router],
    after_request=log_response,
)
