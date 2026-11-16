from functools import wraps

from sanic.exceptions import Unauthorized


def authorized(f):
    @wraps(f)
    async def inner(request, *args, **kwargs):
        if not request.headers.get("authorization"):
            raise Unauthorized("sign in")
        return await f(request, *args, **kwargs)

    return inner
