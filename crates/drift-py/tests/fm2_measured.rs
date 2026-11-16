//! FM2: what mining reads is what the build `a0779066` gave it (review M2). That
//! build linked again only the files its test picked (`Linker::links_differently`)
//! and gave mining the listed link of every other file, with the listed readings it
//! made itself. Those stay; a reading added after it never reaches mining (review
//! R5, row 1). Each expectation below is what that build printed (`drift facts`).

use std::path::Path;

use drift_core::{RepoFacts, Symbol, WrapKind, controls};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scanned(root: &Path) -> RepoFacts {
    scan(
        root,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

fn symbol<'a>(repo: &'a RepoFacts, path: &str, name: &str) -> &'a Symbol {
    let f = repo
        .files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path}"));
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{path}#{name}"))
}

fn has_wrap(repo: &RepoFacts, path: &str, name: &str, wrapper: &str, kind: WrapKind) -> bool {
    symbol(repo, path, name)
        .wraps
        .iter()
        .any(|w| w.wrapper == wrapper && w.kind == kind)
}

fn has_control(repo: &RepoFacts, path: &str, name: &str, control: &str) -> bool {
    symbol(repo, path, name)
        .controls
        .iter()
        .any(|c| c == control)
}

/// A repository in which no file's listings differ between the two readings, so
/// that the test of `a0779066` picks none: a Django view whose decorated base class
/// is in another file (review M2, §4 F1), a DRF attribute on a view that is no DRF
/// view, and FastAPI routes with a typed parameter and `response_model=None`.
fn repository(r: &Path) {
    write(
        r,
        "base.py",
        r#"from django.views import View
from django.contrib.auth.decorators import login_required
from django.utils.decorators import method_decorator


@method_decorator(login_required, name="dispatch")
class Base(View):
    pass
"#,
    );
    write(
        r,
        "app/views.py",
        r#"from base import Base


class V1(Base):
    template_name = "x.html"


class V2(Base):
    template_name = "x.html"
"#,
    );
    write(
        r,
        "app/signout.py",
        r#"from django.views import View
from rest_framework.permissions import IsAuthenticated


class SignOut(View):
    permission_classes = [IsAuthenticated]
    template_name = "x.html"
"#,
    );
    write(
        r,
        "urls.py",
        r#"from django.urls import path
from app import views as a
from app.signout import SignOut

urlpatterns = [
    path("signout/", SignOut.as_view()),
    path("a1/", a.V1.as_view()),
    path("a2/", a.V2.as_view()),
]
"#,
    );
    write(
        r,
        "api/main.py",
        r#"from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Message(BaseModel):
    message: str


@app.get("/items/{id}")
def by_id(id: int):
    return {"ok": True}


@app.get("/raw", response_model=None)
def raw() -> Message:
    return Message(message="x")
"#,
    );
}

/// Review M2, finding 1: the inherited decorators of a Django view, a listed
/// reading of `a0779066`'s own, stay in what mining reads of a file its test does
/// not pick, as that build gave them (a `WrappedBy` feature). Before, every file
/// was linked again by the measured linker, which dropped them.
#[test]
fn a_file_the_test_does_not_pick_keeps_the_readings_of_a0779066() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repository(r);
    let mined = scanned(r);
    let listed = mined.listed();
    let inherited = "unresolved:decorators inherited from base.py#Base";
    for name in ["V1", "V2"] {
        assert!(
            has_wrap(&mined, "app/views.py", name, inherited, WrapKind::Decorator),
            "{name}: {:?}",
            symbol(&mined, "app/views.py", name).wraps
        );
        assert!(has_wrap(
            &listed,
            "app/views.py",
            name,
            inherited,
            WrapKind::Decorator
        ));
    }
}

/// Review R5, row 1, in the same repository: the readings added after `a0779066`
/// (a typed parameter, `response_model=None`, DRF attributes no base runs) are in
/// the listed reading only, though the test picks none of these files.
#[test]
fn a_reading_added_since_never_reaches_a_file_the_test_does_not_pick() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    repository(r);
    let mined = scanned(r);
    let listed = mined.listed();
    let m = "api/main.py";
    assert!(has_control(&listed, m, "by_id", controls::INPUT_TYPED));
    assert!(has_control(&listed, m, "raw", controls::NO_RESPONSE_MODEL));
    assert!(!has_control(&mined, m, "by_id", controls::INPUT_TYPED));
    assert!(!has_control(&mined, m, "raw", controls::NO_RESPONSE_MODEL));
    const PERM: &str = "pkg:rest_framework#permissions.IsAuthenticated";
    let s = "app/signout.py";
    assert!(!has_wrap(&listed, s, "SignOut", PERM, WrapKind::Call));
    assert!(has_wrap(&mined, s, "SignOut", PERM, WrapKind::Call));
    for f in &mined.files {
        for sym in &f.symbols {
            for c in &sym.controls {
                assert!(
                    c != controls::INPUT_TYPED && c != controls::NO_RESPONSE_MODEL,
                    "{}#{}: {c} reached what mining reads",
                    f.path,
                    sym.name
                );
            }
            for w in &sym.wraps {
                assert!(
                    !w.wrapper.starts_with("unresolved:permission_classes"),
                    "{}#{}: {}",
                    f.path,
                    sym.name,
                    w.wrapper
                );
            }
        }
    }
}

/// Review M2, finding 1, second path: a FastAPI dependency that is the value a
/// factory of the repository returns, in a function no route serves. `a0779066`
/// gave mining its listed reading (the factory, `make_user`), the measured one
/// being the name (`current`).
#[test]
fn a_factory_value_is_read_as_a0779066_read_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "deps.py",
        r#"from fastapi import Depends
from fastapi.security import HTTPBearer

bearer = HTTPBearer(auto_error=False)


def make_user():
    def dep(token=Depends(bearer)):
        if token is None:
            return None
        return token.credentials

    return dep


current = make_user()
"#,
    );
    write(
        r,
        "models.py",
        "db = None\n\n\nclass Item:\n    owner = None\n",
    );
    write(
        r,
        "helpers.py",
        r#"from fastapi import Depends

from deps import current
from models import Item, db


def owned(item_id: int, u=Depends(current)):
    return db.query(Item).filter(Item.owner == u.id).first()
"#,
    );
    write(
        r,
        "main.py",
        r#"from fastapi import Depends, FastAPI

from deps import current
from models import Item, db

app = FastAPI()


@app.get("/items/{item_id}")
def get(item_id: int, u=Depends(current)):
    return db.query(Item).filter(Item.owner == u.id).first()
"#,
    );
    let mined = scanned(r);
    let rows = "rows:models.py#Item\town\towner\town via deps.py#make_user";
    assert!(
        has_control(&mined, "helpers.py", "owned", rows),
        "{:?}",
        symbol(&mined, "helpers.py", "owned").controls
    );
}
