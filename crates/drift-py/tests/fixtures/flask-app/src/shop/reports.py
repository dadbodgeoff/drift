from flask import Blueprint

bp = Blueprint("reports", __name__)


@bp.get("/daily")
def daily() -> str:
    return "report"
