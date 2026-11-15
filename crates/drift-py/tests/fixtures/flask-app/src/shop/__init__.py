from flask import Flask

from shop import admin
from shop.api import api_bp
from shop.auth import bp as auth_bp
from shop.hooks import check_csrf, init_hooks


def create_app() -> Flask:
    app = Flask(__name__)
    app.before_request(check_csrf)

    @app.before_request
    def require_tenant() -> None:
        return None

    init_hooks(app)
    app.register_blueprint(auth_bp)
    app.register_blueprint(admin.bp, url_prefix="/admin")
    app.register_blueprint(api_bp)
    # A blueprint imported inside the factory (to avoid import cycles).
    from shop.reports import bp as reports_bp

    app.register_blueprint(reports_bp, url_prefix="/reports")
    return app
