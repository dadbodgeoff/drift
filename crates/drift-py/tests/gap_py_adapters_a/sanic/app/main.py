from sanic import Blueprint, Sanic
from sanic.response import json

from app.items import bp

app = Sanic("fx")
api = Blueprint.group(bp, url_prefix="/api")
app.blueprint(api)


@app.on_request
async def note(request):
    request.ctx.seen = True


@app.get("/health")
async def health(request):
    return json({"ok": True})


@app.websocket("/ws")
async def feed(request, ws):
    await ws.send("hi")
