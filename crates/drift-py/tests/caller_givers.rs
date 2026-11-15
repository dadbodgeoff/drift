//! What may give a value of the caller where a reader must say (lowering 58): a
//! function called with nothing or with the request, and an attribute of a
//! request-scoped holder. `drift_core::controls::RETURNS_CALLER` on the function,
//! and `caller_args` entries `<callee> via <giver>` that the linker keeps only
//! where the giver may give one.

use drift_core::controls::RETURNS_CALLER;
use drift_py::{ScanOptions, scan};

const APP: &str = r#"
from flask import Flask, abort, g, request
from flask_jwt_extended import get_jwt

from helpers import elsewhere, plain

app = Flask(__name__)


def venue():
    return get_jwt()["venue_id"]


def venue_through_a_local():
    claims = get_jwt()
    return claims.get("venue_id")


def venue_or_nothing():
    if not get_jwt():
        return None
    return g.user.venue_id


def sometimes():
    if request.args.get("v"):
        return request.args["v"]
    return get_jwt()["venue_id"]


def constant():
    return 20


def of_request(req):
    return req.user.tenant_id


@app.before_request
def remember():
    g.venue_id = get_jwt()["venue_id"]
    g.place = venue()
    g.started = 1


def handed(rid):
    return load(rid, venue())


def handed_elsewhere(rid):
    return load(rid, elsewhere())


def handed_constant(rid):
    return load(rid, constant()), load(rid, plain())


def handed_with_an_argument(rid):
    return load(rid, of_request(rid))


def compared(rid):
    row = load_any(rid)
    v = venue()
    if row.venue_id != v:
        abort(404)
    return row


def held(rid):
    return load(rid, g.venue_id), load(rid, g.place)


def held_compared(rid):
    row = load_any(rid)
    if row.venue_id != g.venue_id:
        abort(404)
    return row


def held_nothing(rid):
    return load(rid, g.started), load(rid, g.unbound)


def named_local(rid):
    session = constant()
    return load(rid, session)


def state(request, rid):
    request.state.venue_id = request.session["venue_id"]
    return load(rid, request.state.venue_id)


def load(rid, venue_id):
    return None


def load_any(rid):
    return None
"#;

const HELPERS: &str = r#"
from flask_jwt_extended import get_jwt_identity


def elsewhere():
    return get_jwt_identity()


def plain():
    return "x"
"#;

#[test]
fn what_gives_a_value_of_the_caller_is_recorded_for_a_reader() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("app.py"), APP).unwrap();
    std::fs::write(dir.path().join("helpers.py"), HELPERS).unwrap();
    let r = scan(dir.path(), &ScanOptions::default()).unwrap().0;
    let file = |p: &str| r.files.iter().find(|f| f.path == p).unwrap();
    let symbol = |p: &str, n: &str| {
        file(p)
            .symbols
            .iter()
            .find(|s| s.name == n)
            .unwrap_or_else(|| panic!("{n}"))
    };
    let returns = |p: &str, n: &str| symbol(p, n).controls.iter().any(|c| c == RETURNS_CALLER);
    for n in [
        "venue",
        "venue_through_a_local",
        "venue_or_nothing",
        "of_request",
    ] {
        assert!(returns("app.py", n), "{n}");
    }
    assert!(returns("helpers.py", "elsewhere"));
    for n in ["sometimes", "constant", "handed", "load"] {
        assert!(!returns("app.py", n), "{n}");
    }
    assert!(!returns("helpers.py", "plain"));

    let args = |n: &str| symbol("app.py", n).caller_args.clone();
    assert_eq!(args("handed"), ["app.py#load via app.py#venue"]);
    assert_eq!(
        args("handed_elsewhere"),
        ["app.py#load via helpers.py#elsewhere"]
    );
    // A helper that returns no value of the caller gives nothing, and one called
    // with an argument of its own is no source.
    assert!(args("handed_constant").is_empty());
    assert!(args("handed_with_an_argument").is_empty());
    // Compared with: the giver as its own callee.
    assert_eq!(args("compared"), ["app.py#venue via app.py#venue"]);
    // A holder: bound where the value is the caller's, read through itself.
    assert_eq!(
        args("remember"),
        ["pkg:flask#g.place via app.py#venue", "pkg:flask#g.venue_id"]
    );
    assert_eq!(
        args("held"),
        [
            "app.py#load via pkg:flask#g.place",
            "app.py#load via pkg:flask#g.venue_id"
        ]
    );
    assert_eq!(
        args("held_compared"),
        ["pkg:flask#g.venue_id via pkg:flask#g.venue_id"]
    );
    assert!(args("held_nothing").is_empty());
    // A local whose name says the caller is the caller's by its name, as it was.
    assert_eq!(args("named_local"), ["app.py#load"]);
    assert_eq!(
        args("state"),
        [
            "app.py#load via global#request.state.venue_id",
            "global#request.state.venue_id"
        ]
    );
}
