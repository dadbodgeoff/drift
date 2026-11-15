//! A body that answers "not signed in" in the `except` handler of a `try` it cannot
//! pass otherwise (`drift_core::controls::HANDLER_REJECTS`), or in a handler where
//! that is not proven (`HANDLER_MAY_REJECT`). `REJECTS_CALLER` counts nothing inside
//! a handler and is what it was.

use drift_core::controls::{HANDLER_MAY_REJECT, HANDLER_REJECTS, REJECTS_CALLER};
use drift_py::{ScanOptions, scan};

const DEPS: &str = r#"
from django.http import JsonResponse
from fastapi import HTTPException, status
from flask import abort, redirect, url_for


def named(authorization=""):
    try:
        claims = decode(authorization)
    except JWTError:
        raise HTTPException(status_code=401, detail="sign in first")
    return claims


def several(authorization=""):
    try:
        claims = decode(authorization)
    except (JWTError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return claims


def broad(authorization=""):
    try:
        claims = decode(authorization)
    except Exception:
        raise HTTPException(status_code=401)
    return claims


def bare(authorization=""):
    try:
        claims = decode(authorization)
    except:
        raise HTTPException(status_code=401)
    return claims


def bound(authorization=""):
    credentials_exception = HTTPException(status_code=401, detail="bad credentials")
    try:
        claims = decode(authorization)
    except JWTError as exc:
        raise credentials_exception from exc
    return claims


def aborts():
    try:
        g.user = signer.loads(request.headers["X-Token"])
    except BadSignature:
        abort(401)


def to_sign_in():
    try:
        g.user = signer.loads(request.cookies["s"])
    except BadSignature:
        return redirect(url_for("auth.login"))


def decorator(view):
    def inner(request, *args, **kwargs):
        try:
            request.account = signing.loads(request.headers["X-Token"])
        except signing.BadSignature:
            return JsonResponse({"detail": "sign in"}, status=401)
        return view(request, *args, **kwargs)

    return inner


def returns_in_try(authorization=""):
    try:
        return decode(authorization)
    except JWTError:
        raise HTTPException(status_code=401)


def every_handler_refuses(authorization=""):
    try:
        claims = decode(authorization)
    except JWTError:
        raise HTTPException(status_code=401)
    except Exception:
        raise
    return claims


class Verifier:
    def __call__(self, authorization=""):
        try:
            claims = decode(authorization)
        except JWTError:
            raise HTTPException(status_code=401)
        return claims


# ---- not proven: something that may be the guard


def after_a_return(authorization=""):
    if not authorization:
        return None
    try:
        claims = decode(authorization)
    except JWTError:
        raise HTTPException(status_code=401)
    return claims


def under_a_branch_of_the_handler(request, authorization=""):
    try:
        claims = decode(authorization)
    except JWTError:
        if request.method != "GET":
            raise HTTPException(status_code=401)
        claims = None
    return claims


def another_handler_goes_on(authorization=""):
    try:
        claims = decode(authorization)
    except KeyError:
        raise HTTPException(status_code=401)
    except JWTError:
        claims = {}
    return claims


def swallowed_outside(authorization=""):
    claims = None
    try:
        try:
            claims = decode(authorization)
        except JWTError:
            raise HTTPException(status_code=401)
    except Exception:
        pass
    return claims


def returns_under_a_branch(authorization=""):
    try:
        if not authorization:
            return None
        return decode(authorization)
    except JWTError:
        raise HTTPException(status_code=401)


def in_a_loop(authorization=""):
    for key in KEYS:
        try:
            return decode(authorization, key)
        except JWTError:
            raise HTTPException(status_code=401)


def under_a_branch(strict, authorization=""):
    claims = None
    if strict:
        try:
            claims = decode(authorization)
        except JWTError:
            raise HTTPException(status_code=401)
    return claims


def forbids_a_token(token=""):
    try:
        claims = decode(token)
    except JWTError:
        raise HTTPException(status_code=403, detail="no")
    return claims


# ---- no guard: the handler goes on, or answers for what the view raised


def optional(authorization=""):
    try:
        claims = decode(authorization)
    except JWTError:
        return None
    return claims


def swallows(authorization=""):
    user = None
    try:
        user = decode(authorization)
    except JWTError:
        pass
    return user


def sets_none(authorization=""):
    try:
        user = decode(authorization)
    except JWTError:
        user = None
    return user


def maps_errors(view):
    def inner(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except AuthError:
            abort(401)

    return inner


async def maps_in_middleware(request, call_next):
    try:
        return await call_next(request)
    except AuthError:
        return JsonResponse({"detail": "sign in"}, status=401)


def session():
    db = Session()
    try:
        yield db
    except AuthError:
        raise HTTPException(status_code=401)


def forbids_a_file(path=""):
    try:
        data = open(path).read()
    except OSError:
        raise HTTPException(status_code=403, detail="no")
    return data
"#;

#[test]
fn a_401_in_the_handler_of_a_try_the_body_cannot_pass_otherwise_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("deps.py"), DEPS).unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "deps.py").unwrap();
    let controls = |n: &str| -> Vec<&str> {
        f.symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
            .controls
            .iter()
            .map(String::as_str)
            .filter(|c| [HANDLER_REJECTS, HANDLER_MAY_REJECT, REJECTS_CALLER].contains(c))
            .collect()
    };
    for n in [
        "named",
        "several",
        "broad",
        "bare",
        "bound",
        "aborts",
        "to_sign_in",
        "decorator",
        "returns_in_try",
        "every_handler_refuses",
        "Verifier",
    ] {
        assert_eq!(controls(n), [HANDLER_REJECTS], "{n}");
    }
    for n in [
        "after_a_return",
        "under_a_branch_of_the_handler",
        "another_handler_goes_on",
        "swallowed_outside",
        "returns_under_a_branch",
        "in_a_loop",
        "under_a_branch",
        "forbids_a_token",
    ] {
        assert_eq!(controls(n), [HANDLER_MAY_REJECT], "{n}");
    }
    for n in [
        "optional",
        "swallows",
        "sets_none",
        "maps_errors",
        "maps_in_middleware",
        "session",
        "forbids_a_file",
    ] {
        assert!(controls(n).is_empty(), "{n}: {:?}", controls(n));
    }
    // The method's own facts say it too: a middleware class is read by its
    // `dispatch` or `__call__`, not by what another method of the class does.
    let verifier = f.symbols.iter().find(|s| s.name == "Verifier").unwrap();
    let call = verifier
        .members
        .iter()
        .find(|m| m.name == "__call__")
        .unwrap();
    assert_eq!(
        call.unread,
        [HANDLER_REJECTS, drift_core::controls::PARAM_FLOWS]
    );
}

/// What a body does with a value of the caller, or of its own parameters, where no
/// check or filter records it (lowering 53): `caller_args`, `param_flows`, and
/// `scope_unread` for a comparison or a path whose key has no tenant's name.
#[test]
fn a_value_of_the_caller_handed_on_or_compared_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("views.py"),
        r#"
from fastapi import Depends
from flask import g, jsonify

from deps import current_principal, get_db
from models import Event, Shipment


def load(event_id, venue_id):
    row = Event.query.get(event_id)
    if row is None or row.venue_id != venue_id:
        return None
    return row


def purge_all(caller):
    return {"purged": True}


def by_tenant(event_id):
    return load(event_id, g.user.venue_id)


def by_manager(request):
    return Shipment.objects.visible_to(request.user.staff)


def by_dependency(shipment_id: int, db=Depends(get_db), principal=Depends(current_principal)):
    return load(db, principal.depot_id)


def by_relation(request):
    return request.user.depot.shipments.all()


def by_attribute():
    return jsonify([e.title for e in g.user.venue.events])


def dropped(request):
    out = []
    for s in Shipment.objects.all():
        if s.depot_id != request.user.depot_id:
            continue
        out.append(s)
    return out


def asks_who(request):
    if request.user.kind == "staff":
        return 1
    return request.user.username.title()


def requested(user_id, users_bp):
    register(users_bp)
    return load(user_id, 1)
"#,
    )
    .unwrap();
    std::fs::write(
        dir.path().join("models.py"),
        "class Event:\n    pass\n\n\nclass Shipment:\n    pass\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("deps.py"),
        "def get_db():\n    yield None\n\n\ndef current_principal():\n    return None\n",
    )
    .unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "views.py").unwrap();
    let sym = |n: &str| f.symbols.iter().find(|s| s.name == n).unwrap();
    let has = |n: &str, c: &str| sym(n).controls.iter().any(|x| x == c);
    use drift_core::controls::{PARAM_FLOWS, SCOPE_UNREAD};
    assert!(has("load", PARAM_FLOWS));
    assert!(!has("purge_all", PARAM_FLOWS));
    assert_eq!(sym("by_tenant").caller_args, ["views.py#load"]);
    assert_eq!(
        sym("by_manager").caller_args,
        ["models.py#Shipment.objects.visible_to"]
    );
    // Of a dependency: the reader says whether it signs the caller in.
    assert_eq!(
        sym("by_dependency").caller_args,
        [
            "views.py#load via deps.py#current_principal",
            "views.py#load via deps.py#get_db"
        ]
    );
    for n in ["by_relation", "by_attribute", "dropped"] {
        assert!(has(n, SCOPE_UNREAD), "{n}");
    }
    assert!(!has("asks_who", SCOPE_UNREAD));
    for n in ["asks_who", "requested", "by_relation", "dropped"] {
        assert!(
            sym(n).caller_args.is_empty(),
            "{n}: {:?}",
            sym(n).caller_args
        );
    }
}

/// The sources of a value of the caller (lowering 55; the closed list of
/// `Collector::caller_value`): a claims accessor called with nothing, what a
/// request-scoped holder keeps, a member of the request that says the caller where
/// the request is a typed parameter, and a local the body assigned one to. A
/// comparison with one in the condition of an `if` that refuses is kept
/// (`scope_unread`) where no check records it. What says nothing of the caller is
/// none: a holder's `db`, a lookup by something else than a key written in place,
/// a function called with arguments.
#[test]
fn a_value_of_the_caller_is_read_off_a_closed_list_of_sources() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("views.py"),
        r#"
from flask import abort, g, session
from flask_jwt_extended import get_jwt, get_jwt_identity
from starlette.requests import Request

from models import Event


def load(venue_id, event_id):
    row = Event.query.get(event_id)
    return row if row is not None and row.venue_id == venue_id else None


def accessor_item(event_id):
    return load(get_jwt()["venue_id"], event_id)


def accessor_get(event_id):
    return load(get_jwt().get("venue_id"), event_id)


def accessor_identity(event_id):
    return load(event_id=event_id, venue_id=get_jwt_identity())


def holder(event_id):
    return load(g.principal.venue_id, event_id)


def holder_key(event_id):
    return load(g.tenant_id, event_id)


def state(request: Request, event_id):
    return load(request.state.claims["venue_id"], event_id)


def scope(request: Request, event_id):
    return load(request.scope["user"].venue_id, event_id)


def typed_request(request: Request, event_id):
    return load(request.user.venue_id, event_id)


def session_get(event_id):
    return load(session.get("venue_id"), event_id)


def local(event_id):
    venue = get_jwt()["venue_id"]
    return load(venue, event_id)


def local_twice(event_id):
    claims = get_jwt()
    venue = claims.get("venue_id") or abort(403)
    return load(venue, event_id)


def rebound(event_id):
    venue = get_jwt()["venue_id"]
    venue = 3
    return load(venue, event_id)


def refused(event_id):
    row = Event.query.get(event_id)
    if row.venue_id != get_jwt()["venue_id"]:
        abort(404)
    return row


def refused_otherwise(event_id):
    row = Event.query.get(event_id)
    if row.venue_id != g.user.venue_id:
        return {"error": "no"}, 400
    return row


def holder_db(event_id):
    return load(g.db, event_id)


def state_db(request: Request, event_id):
    return load(request.state.db, event_id)


def lookup(table, key, event_id):
    return load(table.get(key), event_id)


def with_arguments(token, event_id):
    return load(get_current_user(token), event_id)


def refused_on_the_row(event_id):
    row = Event.query.get(event_id)
    if row.cancelled != row.archived:
        abort(404)
    return row
"#,
    )
    .unwrap();
    std::fs::write(dir.path().join("models.py"), "class Event:\n    pass\n").unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let f = r.files.iter().find(|f| f.path == "views.py").unwrap();
    let sym = |n: &str| f.symbols.iter().find(|s| s.name == n).unwrap();
    let has = |n: &str, c: &str| sym(n).controls.iter().any(|x| x == c);
    use drift_core::controls::SCOPE_UNREAD;
    for n in [
        "accessor_item",
        "accessor_get",
        "accessor_identity",
        "holder",
        "holder_key",
        "state",
        "scope",
        "typed_request",
        "session_get",
        "local",
        "local_twice",
    ] {
        assert_eq!(sym(n).caller_args, ["views.py#load"], "{n}");
    }
    for n in ["refused", "refused_otherwise"] {
        assert!(has(n, SCOPE_UNREAD), "{n}");
    }
    for n in [
        "rebound",
        "holder_db",
        "state_db",
        "lookup",
        "with_arguments",
        "refused",
        "refused_on_the_row",
    ] {
        assert!(
            sym(n).caller_args.is_empty(),
            "{n}: {:?}",
            sym(n).caller_args
        );
    }
    assert!(!has("refused_on_the_row", SCOPE_UNREAD));
}
