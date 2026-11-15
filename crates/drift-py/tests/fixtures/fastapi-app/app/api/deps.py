from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")


def get_db() -> Generator[str, None, None]:
    yield "session"


SessionDep = Annotated[str, Depends(get_db)]


def get_current_user(session: SessionDep, token: str = Depends(oauth2_scheme)) -> str:
    if not token:
        raise HTTPException(status_code=401, detail="no token")
    return token


CurrentUser = Annotated[str, Depends(get_current_user)]


def get_current_superuser(user: CurrentUser) -> str:
    return user


class Authorizer:
    def __init__(self, scope: str) -> None:
        self.scope = scope

    def __call__(self, user: CurrentUser) -> str:
        return user


_write_items = Authorizer("items:write")
WriteItems = Annotated[str, Depends(_write_items)]
