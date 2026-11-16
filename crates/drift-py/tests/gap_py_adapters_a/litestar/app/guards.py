from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.handlers.base import BaseRouteHandler


def requires_admin(connection: ASGIConnection, _: BaseRouteHandler) -> None:
    if not connection.headers.get("x-admin"):
        raise NotAuthorizedException()
