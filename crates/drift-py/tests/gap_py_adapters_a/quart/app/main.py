from quart import Quart

from app.items import bp

app = Quart(__name__)
app.register_blueprint(bp, url_prefix="/api/items")


@app.route("/health")
async def health():
    return "ok"


@app.websocket("/ws")
async def ws():
    return None
