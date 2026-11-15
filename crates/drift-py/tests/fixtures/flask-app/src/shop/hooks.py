from flask import request


def check_csrf() -> None:
    request.headers.get("X-CSRF")


def init_hooks(app) -> None:
    @app.before_request
    def track() -> None:
        return None
