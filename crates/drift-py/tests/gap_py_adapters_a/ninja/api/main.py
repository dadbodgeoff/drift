from ninja import NinjaAPI

from api.auth import ApiKey
from api.items import router as items_router

api = NinjaAPI(auth=ApiKey())
api.add_router("/items", items_router)


@api.exception_handler(ValueError)
def bad_value(request, exc):
    return api.create_response(request, {"detail": str(exc)}, status=400)


@api.get("/health", auth=None)
def health(request):
    return {"ok": True}
