from fastapi import APIRouter, Depends, Security
from fastapi.security import HTTPBearer

from app.deps import (
    DEBUG,
    Auth,
    DataAuth,
    Require,
    SubAuth,
    auth_context,
    get_auth,
    get_optional_user,
    get_relaxed_user,
    get_token_user,
    get_viewer,
    get_wrapped_user,
    lax,
    loose,
    optional_scheme,
    positional_scheme,
    public_auth,
    relaxed,
    require,
    require_flag,
    sign,
)

router = APIRouter(prefix="/soft")


@router.get("/optional")
def via_optional(user: str = Depends(get_optional_user)) -> str:
    return user


@router.get("/viewer")
def via_viewer(user: str = Depends(get_viewer)) -> str:
    return user


@router.get("/token")
def via_auto_error(user: str = Depends(get_token_user)) -> str:
    return user


@router.get("/scheme")
def via_soft_scheme(token: str = Depends(optional_scheme)) -> str:
    return token


@router.get("/bearer")
def via_soft_inline(creds: str = Security(HTTPBearer(auto_error=False))) -> str:
    return creds


@router.get("/factory")
def via_soft_factory(user: str = Depends(get_auth(required=False))) -> str:
    return user


@router.get("/context")
def via_auth_context(ctx: dict = Depends(auth_context)) -> dict:
    return ctx


@router.get("/public")
def via_public_auth(user: str = Depends(public_auth)) -> str:
    return user


@router.get("/maybe")
def via_maybe_alias(user: str = Depends(get_wrapped_user)) -> str:
    return user


@router.get("/signed")
def via_init_only(s: str = Depends(sign)) -> str:
    return s


@router.get("/positional-factory")
def via_positional_factory(user: str = Depends(require(True))) -> str:
    return user


@router.get("/positional-class")
def via_positional_class(user: str = Depends(Require(True))) -> str:
    return user


@router.get("/positional-scheme")
def via_positional_scheme(token: str = Depends(positional_scheme)) -> str:
    return token


@router.get("/non-literal")
def via_non_literal(creds: str = Security(HTTPBearer(auto_error=not DEBUG))) -> str:
    return creds


@router.get("/required-instance")
def via_required_instance(user: str = Depends(relaxed)) -> str:
    return user


@router.get("/optional-instance")
def via_optional_instance(user: str = Depends(loose)) -> str:
    return user


@router.get("/positional-instance")
def via_positional_instance(user: str = Depends(lax)) -> str:
    return user


@router.get("/soft-instance-chain")
def via_soft_instance_chain(user: str = Depends(get_relaxed_user)) -> str:
    return user


@router.get("/positional-only")
def via_positional_only(user: str = Depends(require_flag(True))) -> str:
    return user


@router.get("/inherited-init")
def via_inherited_init(user: str = Depends(SubAuth(False))) -> str:
    return user


@router.get("/dataclass")
def via_dataclass(user: str = Depends(DataAuth(False))) -> str:
    return user


FLAGS = (False,)
OPTS = {"required": False}


@router.get("/starred")
def via_starred(user: str = Depends(Auth(*FLAGS))) -> str:
    return user


@router.get("/double-starred")
def via_double_starred(user: str = Depends(Auth(**OPTS))) -> str:
    return user
