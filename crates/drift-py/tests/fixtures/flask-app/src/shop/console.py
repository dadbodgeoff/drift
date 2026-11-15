from flask import Blueprint

bp = Blueprint("console", __name__, url_prefix="/console")


@bp.post("/purge")
def purge() -> str:
    return "purged"
