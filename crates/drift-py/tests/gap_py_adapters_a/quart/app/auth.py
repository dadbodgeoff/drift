from functools import wraps
from quart import abort, session


def login_required(f):
    @wraps(f)
    async def inner(*args, **kwargs):
        if "user" not in session:
            abort(401)
        return await f(*args, **kwargs)
    return inner
