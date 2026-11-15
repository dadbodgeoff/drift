from flask import Flask

from shop.console import bp as console_bp
from shop.hooks import init_hooks


def create_admin_app() -> Flask:
    """A second app factory sharing the hooks helper."""
    app = Flask(__name__)
    init_hooks(app)
    app.register_blueprint(console_bp)
    return app
