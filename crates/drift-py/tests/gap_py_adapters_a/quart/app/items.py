from quart import Blueprint, request

from app.auth import login_required

bp = Blueprint("items", __name__, url_prefix="/items")


@bp.before_request
async def note():
    request.seen = True


@bp.route("/<int:item_id>")
@login_required
async def show(item_id):
    return {"id": item_id}


@bp.post("/")
async def create():
    data = await request.get_json()
    return data
