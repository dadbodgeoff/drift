from flask import Blueprint
from flask_login import login_required

bp = Blueprint("admin", __name__, url_prefix="/ignored")


@bp.get("/")
@login_required
def index() -> str:
    return "admin"


@bp.post("/users/<int:user_id>/ban")
@login_required
def ban(user_id: int) -> str:
    return "banned"
