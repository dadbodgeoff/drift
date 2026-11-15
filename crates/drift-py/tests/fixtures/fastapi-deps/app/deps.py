"""Dependency shapes a route may reach `get_current_user` through, and soft look-alikes."""

from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Depends, Security
from fastapi.security import HTTPBearer, OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")
optional_scheme = OAuth2PasswordBearer(tokenUrl="/login", auto_error=False)


def get_db():
    yield "session"


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    return token


# (a) a chain: a dependency whose own parameters depend on the strict one.
def get_current_active_user(user: str = Depends(get_current_user)) -> str:
    return user


def get_current_superuser(user: Annotated[str, Security(get_current_active_user)]) -> str:
    return user


# (b) an alias, an alias of a `Depends(f)` constant, and an alias of an alias.
CurrentUser = Annotated[str, Depends(get_current_user)]
AUTH_REQUIRED = Depends(get_current_user)
AuthDep = Annotated[str, AUTH_REQUIRED]
SuperUser = Annotated[str, Depends(get_current_superuser)]


# (d) classes: `Depends(Class)` runs `__init__`, `Depends(instance)` runs `__call__`.
class RoleChecker:
    def __init__(self, role: str, db: str = Depends(get_db)) -> None:
        self.role = role

    def __call__(self, user: CurrentUser) -> str:
        return user


require_admin = RoleChecker("admin")


class Pagination:
    def __init__(self, user: CurrentUser, page: int = 1) -> None:
        self.page = page


class Signer:
    # Only `__init__` depends on the user; an instance runs `__call__`.
    def __init__(self, user: CurrentUser) -> None:
        self.user = user

    def __call__(self, db: str = Depends(get_db)) -> str:
        return "signed"


sign = Signer("x")


# Soft look-alikes: none of these may count as `get_current_user`.
def get_optional_user(user: str = Depends(get_current_user)) -> Optional[str]:
    """Named optional: a chain stops here."""
    return user


def get_viewer(user: str | None = Depends(get_current_user), db: str = Depends(get_db)) -> str:
    """Takes the user as possibly `None`: soft for its dependents (the session is not)."""
    return user or "anonymous"


def get_token_user(token: Annotated[str | None, Depends(optional_scheme)] = None) -> str | None:
    """Reads the token through a scheme built with `auto_error=False`."""
    return token


def auth_context(db: str = Depends(get_db)) -> dict:
    """Named for auth, yet depends on no user: the name proves nothing."""
    return {}


def public_auth(user: str = Depends(get_current_user)) -> str:
    """Named public: a chain does not follow it."""
    return user


def get_auth(required: bool = True):
    def dep(token: str = Depends(oauth2_scheme)) -> str:
        return token

    return dep


MaybeUser = Annotated[Optional[str], Depends(get_current_user)]


def get_wrapped_user(user: MaybeUser) -> str:
    """An `Annotated[Optional[...], Depends(...)]` alias is possibly `None`, too."""
    return user or ""


# Soft flags passed by position, or with a value that is not a literal.
DEBUG = False
positional_scheme = OAuth2PasswordBearer("/login", None, None, None, False)


def require(optional: bool = False):
    """A factory whose first parameter is the soft flag."""

    def dep(user: str = Depends(get_current_user)) -> str:
        return user

    return dep


class Require:
    def __init__(self, optional: bool = False) -> None:
        self.optional = optional

    def __call__(self, user: CurrentUser) -> str:
        return user


class Auth:
    def __init__(self, required: bool = True) -> None:
        self.required = required

    def __call__(self, user: CurrentUser) -> str:
        return user


# Module-level instances: soft by keyword or position, and a strict one.
relaxed = Auth(required=False)
loose = Require(optional=True)
lax = Auth(False)
strict_auth = Auth(True)


def get_relaxed_user(user: str = Depends(relaxed)) -> str:
    """A soft instance through a parameter that is not optional."""
    return user


def verify_public_key(user: str = Depends(get_current_user)) -> str:
    """Strict, though "public" is in its name (not as its qualifier)."""
    return user


# How positional arguments bind: `*args`, keyword-only and positional-only parameters.
def require_any(*roles: str, optional: bool = False):
    """`require_any(True)` passes a role: `optional` is keyword-only."""

    def dep(user: str = Depends(get_current_user)) -> str:
        return user

    return dep


def require_role(role: object, *, required: bool = True):
    """`require_role(False)` passes the role, not `required`."""

    def dep(user: str = Depends(get_current_user)) -> str:
        return user

    return dep


def require_flag(optional: bool = False, /):
    """`require_flag(True)` binds the positional-only `optional`."""

    def dep(user: str = Depends(get_current_user)) -> str:
        return user

    return dep


# A class without an `__init__` of its own takes its base's; a dataclass builds one.
class SubAuth(Auth):
    pass


@dataclass
class DataAuth:
    required: bool = True

    def __call__(self, user: CurrentUser) -> str:
        return user


class Roles:
    def __init__(self, required) -> None:
        self.required = required

    def __call__(self, user: CurrentUser) -> str:
        return user


# Strict, though each starts with a soft word: the qualifier is on something else.
def public_key_auth(user: str = Depends(get_current_user)) -> str:
    return user


def optional_scopes_user(user: str = Depends(get_current_user)) -> str:
    return user
