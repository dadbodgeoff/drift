from typing import Optional

from fastapi import APIRouter, Depends, Security

from app.deps import (
    AUTH_REQUIRED,
    AuthDep,
    CurrentUser,
    Pagination,
    Require,
    Roles,
    SubAuth,
    SuperUser,
    get_current_active_user,
    get_current_user,
    optional_scopes_user,
    public_key_auth,
    require_any,
    require_admin,
    require_role,
    strict_auth,
    verify_public_key,
)

router = APIRouter(prefix="/strict")


@router.get("/active")
def via_chain(user: str = Depends(get_current_active_user)) -> str:
    return user


@router.get("/super")
def via_alias_of_chain(user: SuperUser) -> str:
    return user


@router.get("/alias")
def via_alias(user: CurrentUser) -> str:
    return user


@router.get("/constant")
def via_constant(user: AuthDep) -> str:
    return user


@router.get("/default-constant")
def via_default_constant(user: str = AUTH_REQUIRED) -> str:
    return user


@router.get("/admin")
def via_instance(user: str = Depends(require_admin)) -> str:
    return user


@router.get("/page")
def via_class(page: Pagination = Depends()) -> int:
    return page.page


@router.get("/strict-positional-class")
def via_strict_positional_class(user: str = Depends(Require(False))) -> str:
    return user


@router.get("/strict-instance")
def via_strict_instance(user: str = Depends(strict_auth)) -> str:
    return user


@router.get("/optional-param")
def via_optional_route_param(user: Optional[str] = Depends(get_current_user)) -> str:
    return user or ""


@router.get("/scopes")
def via_security_scopes(user: str = Security(get_current_user, scopes=["items"])) -> str:
    return user


@router.get("/public-key")
def via_strict_soft_word(user: str = Depends(verify_public_key)) -> str:
    return user


@router.get("/varargs")
def via_varargs(user: str = Depends(require_any(True))) -> str:
    return user


@router.get("/keyword-only")
def via_keyword_only(user: str = Depends(require_role(False))) -> str:
    return user


@router.get("/inherited-strict")
def via_inherited_strict(user: str = Depends(SubAuth(True))) -> str:
    return user


@router.get("/list-literal")
def via_list_literal(user: str = Depends(Roles(["admin"]))) -> str:
    return user


@router.get("/list-literal-keyword")
def via_list_literal_keyword(user: str = Depends(Roles(required=["admin"]))) -> str:
    return user


@router.get("/public-key-auth")
def via_public_key_auth(user: str = Depends(public_key_auth)) -> str:
    return user


@router.get("/optional-scopes")
def via_optional_scopes_user(user: str = Depends(optional_scopes_user)) -> str:
    return user
