from sanic import Blueprint
from sanic.response import json
from sanic.views import HTTPMethodView

from app.auth import authorized

bp = Blueprint("items", url_prefix="/items")


@bp.get("/<item_id:int>")
@authorized
async def show(request, item_id):
    return json({"id": item_id})


class ItemsView(HTTPMethodView):
    async def get(self, request):
        return json([])

    async def post(self, request):
        return json(request.json)


bp.add_route(ItemsView.as_view(), "/")
