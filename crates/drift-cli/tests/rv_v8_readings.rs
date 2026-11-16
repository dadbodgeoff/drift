//! Review of PR 148, area 6, items 1, 2 and 4: practice readings that claimed to
//! know what they do not. Each test runs `drift practices --json --units` on a
//! repository written for it and pins the reading the reviewer's scenario gets.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// A repository with these files.
fn repo(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

/// One concern of `drift practices --json --units`.
fn concern(root: &Path, id: &str) -> Value {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no concern {id}"))
        .clone()
}

/// The unit of `symbol`: its assignment, and the key it is known by (its own, else
/// its variant's) or the reason it is unknown.
fn said(concern: &Value, symbol: &str) -> (String, String) {
    let u = concern["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["symbol"] == symbol)
        .unwrap_or_else(|| panic!("no unit {symbol}: {:#}", concern["units"]));
    let assignment = u["assignment"].as_str().unwrap_or_default().to_string();
    let variants = concern["variants"].as_array().unwrap();
    let what = match assignment.as_str() {
        "known" => u["key"].as_str().or_else(|| {
            variants
                .iter()
                .chain(
                    variants
                        .iter()
                        .filter_map(|v| v["alternatives"].as_array())
                        .flatten(),
                )
                .find(|v| v["id"] == u["variant"])
                .and_then(|v| v["key"].as_str())
        }),
        "unknown" => u["reason"].as_str(),
        _ => None,
    };
    (assignment, what.unwrap_or_default().to_string())
}

/// Item 1: a base class's override answers a view's errors only where it is the
/// method that runs for the view's request. `CreateBase.create` catching an
/// `IntegrityError` was read as `ReadView.get`'s error handling, though `create`
/// never runs on a GET; and in `class MixedView(Silent, Answering)` Python runs
/// `Silent.handle_exception`, which hands on to nothing, yet `Answering`'s was
/// credited (the classes were ranked by distance, not by method resolution order).
/// A view built on `Answering` alone still takes its `handle_exception`.
#[test]
fn a_base_override_counts_only_where_it_runs_for_the_view() {
    let dir = repo(&[
        (
            "depot/__init__.py",
            r#""#,
        ),
        (
            "depot/settings.py",
            r#"SECRET_KEY = "x"
ROOT_URLCONF = "depot.urls"
INSTALLED_APPS = ["rest_framework"]
MIDDLEWARE = []
"#,
        ),
        (
            "depot/urls.py",
            r#"from django.urls import path

from depot import views

urlpatterns = [
    path("read/", views.ReadView.as_view()),
    path("mixed/", views.MixedView.as_view()),
    path("plain/", views.PlainView.as_view()),
]
"#,
        ),
        (
            "depot/views.py",
            r#"from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError
from rest_framework.response import Response
from rest_framework.views import APIView


class CreateBase(APIView):
    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            return Response({"error": "conflict"}, status=409)


class ReadView(CreateBase):
    def get(self, request):
        return Response({})


class Answering(APIView):
    def handle_exception(self, exc):
        try:
            return super().handle_exception(exc)
        except ObjectDoesNotExist:
            return Response({"error": "not found"}, status=404)


class Silent:
    def handle_exception(self, exc):
        return Response({"error": "failed"}, status=500)


class MixedView(Silent, Answering):
    def get(self, request):
        return Response({})


class PlainView(Answering):
    def get(self, request):
        return Response({})
"#,
        ),
        (
            "manage.py",
            r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "depot.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
"#,
        ),
    ]);
    let c = concern(dir.path(), "errors");
    for view in ["ReadView.get", "MixedView.get"] {
        let (assignment, key) = said(&c, view);
        assert_eq!(assignment, "known", "{view}: {key}");
        assert!(!key.contains("base_handler"), "{view}: {key}");
    }
    assert_eq!(
        said(&c, "PlainView.get"),
        (
            "known".to_string(),
            "base_handler:depot/views.py#Answering.handle_exception".to_string()
        )
    );
}

/// Item 2: a guard called after the write, past the end of a call order that was
/// cut at its cap, read as running before the write: `remove_far` (a function's
/// order, cut at 32 and marked `order` in the listed reading's `truncated`) and
/// `svc_far` (through `Rules.remove_far`, a method's order, cut at 16 and ended
/// with `*`) were `known`. Where the guard comes in the order is not read: the
/// check is found, not proven. The same guard before the write is still the
/// unit's check, and one in the order after the write is still `after_effect`.
#[test]
fn a_guard_past_a_cut_call_order_is_not_proven_to_run_before_the_write() {
    let dir = repo(&[
        (
            "svc/app/__init__.py",
            r#""#,
        ),
        (
            "svc/app/deps.py",
            r#"from fastapi import HTTPException, Request


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller
"#,
        ),
        (
            "svc/app/guard.py",
            r#"from fastapi import HTTPException


def require_same_org(rule, caller):
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")
"#,
        ),
        (
            "svc/app/main.py",
            r#"import math

from fastapi import APIRouter, Depends, FastAPI

from app import repo
from app.deps import get_caller
from app.guard import require_same_org

app = FastAPI()
router = APIRouter(prefix="/rules")


@router.delete("/near/{rule_id}")
async def remove_near(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    repo.delete_rule(rule_id)
    require_same_org(rule, caller)
    return {"deleted": rule_id}


@router.delete("/far/{rule_id}")
async def remove_far(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    repo.delete_rule(rule_id)
    math.acos(1)
    math.asin(1)
    math.atan(1)
    math.ceil(1)
    math.cos(1)
    math.cosh(1)
    math.degrees(1)
    math.erf(1)
    math.erfc(1)
    math.exp(1)
    math.expm1(1)
    math.fabs(1)
    math.factorial(1)
    math.floor(1)
    math.gamma(1)
    math.isqrt(1)
    math.lgamma(1)
    math.log10(1)
    math.log1p(1)
    math.log2(1)
    math.radians(1)
    math.sin(1)
    math.sinh(1)
    math.sqrt(1)
    math.tan(1)
    math.tanh(1)
    math.trunc(1)
    math.isfinite(1)
    math.isinf(1)
    math.isnan(1)
    math.frexp(1)
    math.modf(1)
    math.exp2(1)
    math.cbrt(1)
    require_same_org(rule, caller)
    return {"deleted": rule_id}


@router.delete("/first/{rule_id}")
async def remove_first(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    require_same_org(rule, caller)
    repo.delete_rule(rule_id)
    return {"deleted": rule_id}


from app.service import Rules


@router.delete("/svc-near/{rule_id}")
async def svc_near(rule_id: int, caller=Depends(get_caller)):
    Rules().remove_near(rule_id, caller)
    return {"deleted": rule_id}


@router.delete("/svc-far/{rule_id}")
async def svc_far(rule_id: int, caller=Depends(get_caller)):
    Rules().remove_far(rule_id, caller)
    return {"deleted": rule_id}


app.include_router(router)
"#,
        ),
        (
            "svc/app/models.py",
            r#"from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Rule(Base):
    __tablename__ = "rules"
    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[str]
"#,
        ),
        (
            "svc/app/repo.py",
            r#"from sqlalchemy.orm import Session

from app.models import Rule

db = Session()


def get_rule(rule_id):
    return db.get(Rule, rule_id)


def delete_rule(rule_id):
    db.delete(db.get(Rule, rule_id))
    db.commit()
"#,
        ),
        (
            "svc/app/service.py",
            r#"import math

from app import repo
from app.guard import require_same_org


class Rules:
    def remove_near(self, rule_id, caller):
        rule = repo.get_rule(rule_id)
        repo.delete_rule(rule_id)
        require_same_org(rule, caller)

    def remove_far(self, rule_id, caller):
        rule = repo.get_rule(rule_id)
        repo.delete_rule(rule_id)
        math.acos(1)
        math.asin(1)
        math.atan(1)
        math.ceil(1)
        math.cos(1)
        math.cosh(1)
        math.degrees(1)
        math.erf(1)
        math.erfc(1)
        math.exp(1)
        math.expm1(1)
        math.fabs(1)
        math.factorial(1)
        math.floor(1)
        math.gamma(1)
        math.isqrt(1)
        math.lgamma(1)
        math.log10(1)
        math.log1p(1)
        math.log2(1)
        require_same_org(rule, caller)
"#,
        ),
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    for unit in ["remove_far", "svc_far", "remove_near", "svc_near"] {
        assert_eq!(
            said(&c, unit),
            ("unknown".to_string(), "check_not_proven".to_string()),
            "{unit}"
        );
    }
    assert_eq!(said(&c, "remove_first").0, "known");
}

/// Item 4: `catch (e) { sendError(res, e); next(e) }` was read as the framework's
/// handling (`bubble:framework_default`, the clause a `rethrow`), though the
/// helper may have answered the request: what it does is not read, so the unit is
/// unknown. A clause that answered itself first is the handler answering; one
/// that only logs before handing the error on, or hands it on alone, is the
/// framework's.
#[test]
fn a_catch_that_may_answer_before_next_is_not_the_frameworks_handling() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0" } }
"#,
        ),
        (
            "src/errors.ts",
            r#"export function sendError(res: any, e: unknown) {
  res.status(500).json({ error: String(e) });
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { sendError } from "./errors";
declare const store: any;
const app = express();
app.get("/answered/:id", async (req, res, next) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    res.status(500).json({ error: "failed" });
    next(e);
  }
});
app.get("/helper/:id", async (req, res, next) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    sendError(res, e);
    next(e);
  }
});
app.get("/logged/:id", async (req, res, next) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    console.error(e);
    next(e);
  }
});
app.get("/plain/:id", async (req, res, next) => {
  try {
    res.json(await store.read(req.params.id));
  } catch (e) {
    next(e);
  }
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "errors");
    assert_eq!(said(&c, "GET /helper/:id").0, "unknown");
    assert_eq!(
        said(&c, "GET /answered/:id"),
        ("known".to_string(), "in_body_try:respond".to_string())
    );
    for unit in ["GET /logged/:id", "GET /plain/:id"] {
        assert_eq!(
            said(&c, unit),
            ("known".to_string(), "bubble:framework_default".to_string()),
            "{unit}"
        );
    }
}
