from functools import wraps

from flask import Blueprint, abort, redirect, request, session

bp = Blueprint("auth", __name__, url_prefix="/auth")


@bp.before_request
def load_user() -> None:
    session.get("user")


@bp.before_app_request
def load_session() -> None:
    session.get("id")


@bp.route("/login", methods=["GET", "POST"])
def login():
    return redirect(request.args["next"])


@bp.route("/logout")
def logout():
    return redirect("/")


def admins_only(f):
    @wraps(f)
    def inner(*args, **kwargs):
        if not session.get("admin"):
            abort(403)
        return f(*args, **kwargs)

    return inner
