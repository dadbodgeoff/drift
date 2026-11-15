//! Authorization and authentication soundness, by family: the constructs a check or a
//! guard can hide in, each in more than one framework. A unit is `known` only where
//! the check is proven to run for every request, `none` only where every body in reach
//! was read, and `unknown` with the check that was found otherwise.

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

/// What the map says of the unit of `symbol`: its assignment; the key it is known by
/// or the reason it is unknown; and, for a check found and not proven, the obligation
/// that fails.
fn said<'a>(concern: &'a Value, symbol: &str) -> (&'a str, Option<&'a str>, Option<&'a str>) {
    // `symbol @ path` where several files have a unit of that name.
    let (symbol, path) = match symbol.split_once(" @ ") {
        Some((s, p)) => (s, Some(p)),
        None => (symbol, None),
    };
    let u = concern["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| {
            u["symbol"] == symbol
                && path.is_none_or(|p| u["path"].as_str().is_some_and(|x| x.contains(p)))
        })
        .unwrap_or_else(|| panic!("no unit {symbol}: {:#}", concern["units"]));
    let assignment = u["assignment"].as_str().unwrap();
    let variants = concern["variants"].as_array().unwrap();
    let what = match assignment {
        // A unit's own key, else the key of the variant it is in.
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
    (assignment, what, u["not_proven"]["obligation"].as_str())
}

/// [STRICT] A helper that returns early for some callers (`if (user.role === "support")
/// return;`) before its tenant comparison does not check them. TypeScript recorded
/// no reason for a check after a bare `return`, and the route read `known tenancy
/// check` (the acceptance suite's helper_early_return_next; here in Express).
#[test]
fn a_typescript_helper_that_returns_before_its_check_is_found_not_proven() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0", "http-errors": "2.0.0" } }
"#,
        ),
        (
            "src/access.ts",
            r#"import createError from "http-errors";
export function assertSameOrg(user: { orgId: string; role: string }, rule: { orgId: string }) {
  if (user.role === "support") {
    return;
  }
  if (rule.orgId !== user.orgId) {
    throw createError(403, "forbidden");
  }
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { prisma } from "./db";
import { assertSameOrg } from "./access";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.delete("/rules/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  assertSameOrg(req.user, rule);
  await prisma.rule.delete({ where: { id: rule.id } });
  res.status(204).end();
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE /rules/:id"),
        (
            "unknown",
            Some("check_not_proven"),
            Some("after_conditional_return")
        ),
    );
}

/// [STRICT] A helper that holds the check and is called only under a branch (`if
/// (req.method !== "GET") assertSameOrg(...)`), or as the right side of `&&`, checks
/// nothing for the other requests. TypeScript recorded no conditional calls. The
/// same helper called on every path is the unit's tenant check.
#[test]
fn a_typescript_helper_called_under_a_branch_is_found_not_proven() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0", "http-errors": "2.0.0" } }
"#,
        ),
        (
            "src/access.ts",
            r#"import createError from "http-errors";
export function assertSameOrg(user: { orgId: string }, rule: { orgId: string }) {
  if (rule.orgId !== user.orgId) {
    throw createError(403, "forbidden");
  }
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { prisma } from "./db";
import { assertSameOrg } from "./access";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.all("/rules/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.method !== "GET") {
    assertSameOrg(req.user, rule);
  }
  res.json(rule);
});
app.get("/rules2/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  rule.private && assertSameOrg(req.user, rule);
  res.json(rule);
});
app.get("/control/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  assertSameOrg(req.user, rule);
  res.json(rule);
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "ALL /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET /rules2/:id"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET /control/:id"),
        ("known", Some("tenancy_check:param:user"), None),
    );
}

/// [STRICT] An `async` helper called without `await` settles after the handler went
/// on: its rejection stops nothing (the acceptance suite's noawait_void_next). So for
/// a call with only `.catch()` on it and for one bound to a name the body never
/// reads. Awaited, directly or through the name it is bound to, it is the unit's
/// tenant check.
#[test]
fn a_typescript_check_whose_promise_is_dropped_is_found_not_proven() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0", "http-errors": "2.0.0" } }
"#,
        ),
        (
            "src/access.ts",
            r#"import createError from "http-errors";
import { prisma } from "./db";
export async function assertOrgAccess(user: { orgId: string }, ruleId: string) {
  const rule = await prisma.rule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.orgId !== user.orgId) throw createError(403, "forbidden");
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { prisma } from "./db";
import { assertOrgAccess } from "./access";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.get("/rules/:id", requireUser, async (req, res) => {
  assertOrgAccess(req.user, req.params.id).catch(() => {});
  res.json(await prisma.rule.findUnique({ where: { id: req.params.id } }));
});
app.get("/bound/:id", requireUser, async (req, res) => {
  const pending = assertOrgAccess(req.user, req.params.id);
  res.json(await prisma.rule.findUnique({ where: { id: req.params.id } }));
});
app.get("/control/:id", requireUser, async (req, res) => {
  await assertOrgAccess(req.user, req.params.id);
  res.json(await prisma.rule.findUnique({ where: { id: req.params.id } }));
});
app.get("/control2/:id", requireUser, async (req, res) => {
  const pending = assertOrgAccess(req.user, req.params.id);
  await pending;
  res.json(await prisma.rule.findUnique({ where: { id: req.params.id } }));
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "GET /bound/:id"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "GET /control/:id"),
        ("known", Some("tenancy_check:param:user"), None),
    );
    assert_eq!(
        said(&c, "GET /control2/:id"),
        ("known", Some("tenancy_check:param:user"), None),
    );
}

/// [STRICT] The same through an injected NestJS service: `this.access.assertOrg(...)`
/// with no `await`, where `assertOrg` is `async`.
#[test]
fn a_nest_service_check_that_is_not_awaited_is_found_not_proven() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/passport": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/access.service.ts",
            r#"import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "./db";
@Injectable()
export class AccessService {
  async assertOrg(user: { orgId: string }, ruleId: string): Promise<void> {
    const rule = await prisma.rule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.orgId !== user.orgId) throw new ForbiddenException();
  }
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/rules.controller.ts",
            r#"import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AccessService } from "./access.service";
import { prisma } from "./db";
@Controller("rules")
@UseGuards(AuthGuard("jwt"))
export class RulesController {
  constructor(private readonly access: AccessService) {}
  @Get(":id")
  async one(@Req() req, @Param("id") id: string) {
    this.access.assertOrg(req.user, id);
    return prisma.rule.findUnique({ where: { id } });
  }
  @Get("control/:id")
  async control(@Req() req, @Param("id") id: string) {
    await this.access.assertOrg(req.user, id);
    return prisma.rule.findUnique({ where: { id } });
  }
}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "GET /rules/control/:id"),
        ("known", Some("tenancy_check:param:user"), None),
    );
}

/// [STRICT] An `async def` method reached through a dependency alias (`service:
/// RuleBookDep`), through what `Depends(get_rule_book)` injects, or through
/// the instance a function hands back, and called without `await`, never runs. The
/// linker knew only functions and methods called by their own name as `async`, so
/// these read `known tenancy check`.
#[test]
fn a_python_method_reached_through_a_binding_and_not_awaited_is_found_not_proven() {
    let dir = repo(&[
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
        ("svc/app/__init__.py", ""),
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
            "svc/app/main.py",
            r#"from fastapi import APIRouter, Depends, FastAPI

from app.deps import get_caller
from app.service import RuleBook, RuleBookDep, get_rule_book

app = FastAPI()
router = APIRouter(prefix="/rules")


@router.get("/alias/{rule_id}")
async def by_alias(rule_id: int, service: RuleBookDep):
    service.assert_access(rule_id)
    return await service.load(rule_id)


@router.get("/instance/{rule_id}")
async def by_instance(rule_id: int, caller=Depends(get_caller)):
    service = get_rule_book(caller)
    service.assert_access(rule_id)
    return await service.load(rule_id)


@router.get("/depends/{rule_id}")
async def by_depends(rule_id: int, service=Depends(get_rule_book)):
    service.assert_access(rule_id)
    return await service.load(rule_id)


@router.get("/control/{rule_id}")
async def control(rule_id: int, service: RuleBookDep):
    await service.assert_access(rule_id)
    return await service.load(rule_id)


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
            "svc/app/service.py",
            r#"from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_caller
from app.models import Rule

db = Session()


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    async def assert_access(self, rule_id):
        rule = db.get(Rule, rule_id)
        if rule.org_id != self.caller.org_id:
            raise HTTPException(status_code=403, detail="another organization")

    async def load(self, rule_id):
        return db.get(Rule, rule_id)


def get_rule_book(caller=Depends(get_caller)) -> RuleBook:
    return RuleBook(caller)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "by_alias"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "by_depends"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "by_instance"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "control"),
        (
            "known",
            Some("tenancy_check:svc/app/service.py#RuleBook.assert_access"),
            None
        ),
    );
}

/// [STRICT] `repo.delete_rule(rule_id)` before the comparison of the rule's
/// organisation with the caller's: the 403 arrives after another organisation's rule
/// is gone, and the route read `known tenancy check` (second review k13, the
/// acceptance suite's after_effect_fastapi). A check records what its body calls
/// before it; the reader follows each callee, and one that reaches a write
/// (`db.delete`, `db.commit`) leaves the check found, not proven. Loading the row
/// first and deleting after the check is the unit's tenant check.
#[test]
fn a_check_after_a_call_that_changes_data_is_found_not_proven() {
    let dir = repo(&[
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
        ("svc/app/__init__.py", ""),
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
            "svc/app/main.py",
            r#"from fastapi import APIRouter, Depends, FastAPI, HTTPException

from app import repo
from app.deps import get_caller

app = FastAPI()
router = APIRouter(prefix="/rules")


@router.delete("/{rule_id}")
async def remove_rule(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    repo.delete_rule(rule_id)
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")
    return {"deleted": rule_id}


@router.delete("/checked/{rule_id}")
async def remove_checked(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")
    repo.delete_rule(rule_id)
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
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "remove_rule"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    assert_eq!(
        said(&c, "remove_checked"),
        ("known", Some("tenancy_check:claim:.org_id"), None),
    );
}

/// [STRICT] The same in Flask: `db.session.delete(project)` and `db.session.commit()`
/// before `abort(403)` on the team comparison.
#[test]
fn a_flask_check_after_a_commit_is_found_not_proven() {
    let dir = repo(&[
        (
            "app.py",
            r#"from flask import Flask, abort, jsonify
from flask_login import LoginManager, current_user, login_required

from models import Project, db

app = Flask(__name__)
login_manager = LoginManager(app)


@app.delete("/projects/<int:project_id>")
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)
    db.session.delete(project)
    db.session.commit()
    if project.team_id != current_user.team_id:
        abort(403)
    return "", 204


@app.delete("/control/<int:project_id>")
@login_required
def delete_checked(project_id):
    project = Project.query.get_or_404(project_id)
    if project.team_id != current_user.team_id:
        abort(403)
    db.session.delete(project)
    db.session.commit()
    return "", 204
"#,
        ),
        (
            "models.py",
            r#"from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.String, nullable=False)
    owner_id = db.Column(db.String, nullable=False)
    name = db.Column(db.String)
"#,
        ),
        (
            "requirements.txt",
            r#"flask
flask-login
flask-sqlalchemy
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "delete_project"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    assert_eq!(
        said(&c, "delete_checked"),
        (
            "known",
            Some("tenancy_check:claim:.query.get_or_404.team_id"),
            None
        ),
    );
}

/// [STRICT] The same in a DRF view: `ticket.delete()`, a method of the row itself,
/// before `raise PermissionDenied()` on the organisation comparison.
#[test]
fn a_drf_check_after_the_row_is_deleted_is_found_not_proven() {
    let dir = repo(&[
        (
            "requirements.txt",
            r#"django
djangorestframework
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["rest_framework", "tickets"]
ROOT_URLCONF = "proj.urls"
REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"]}
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from tickets.views import TicketDetail, TicketChecked

urlpatterns = [
    path("tickets/<int:pk>/", TicketDetail.as_view()),
    path("control/<int:pk>/", TicketChecked.as_view()),
]
"#,
        ),
        ("tickets/__init__.py", ""),
        (
            "tickets/models.py",
            r#"from django.db import models


class Ticket(models.Model):
    org_id = models.IntegerField()
    title = models.CharField(max_length=100)
"#,
        ),
        (
            "tickets/views.py",
            r#"from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tickets.models import Ticket


class TicketDetail(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        ticket = get_object_or_404(Ticket, pk=pk)
        ticket.delete()
        if ticket.org_id != request.user.org_id:
            raise PermissionDenied()
        return Response(status=204)


class TicketChecked(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        ticket = get_object_or_404(Ticket, pk=pk)
        if ticket.org_id != request.user.org_id:
            raise PermissionDenied()
        ticket.delete()
        return Response(status=204)
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "TicketDetail.delete"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    assert_eq!(said(&c, "TicketChecked.delete").0, "known");
}

/// [STRICT] The same in a Next.js route: `await prisma.rule.delete(...)` before the 403
/// on the organisation comparison. An update after the check leaves it the unit's.
#[test]
fn a_next_check_after_a_delete_is_found_not_proven() {
    let dir = repo(&[
        (
            "web/package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0", "react": "19.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, "strict": true } }
"#,
        ),
        (
            "web/app/api/rules/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  await prisma.rule.delete({ where: { id: rule.id } });
  if (rule.orgId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return new NextResponse(null, { status: 204 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  if (rule.orgId !== session.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await prisma.rule.update({ where: { id: rule.id }, data: { seen: true } });
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/lib/db.ts",
            r#"import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
"#,
        ),
        (
            "web/lib/session.ts",
            r#"import { cookies } from "next/headers";

export type Session = { userId: string; orgId: string; role: string; memberships: { orgId: string }[] };

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get("session")?.value;
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString()) as Session;
}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    assert_eq!(
        said(&c, "GET"),
        ("known", Some("tenancy_check:claim:.orgId"), None),
    );
}

/// [STRICT] The check is in a helper, and the handler calls the helper after
/// `archiveRule(rule.id)`, a function of the repository that updates the row: what
/// the helper checks is checked after the effect. Called before it, the helper is
/// the unit's tenant check.
#[test]
fn a_helper_called_after_a_call_that_changes_data_is_found_not_proven() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0", "http-errors": "2.0.0" } }
"#,
        ),
        (
            "src/access.ts",
            r#"import createError from "http-errors";
export function assertSameOrg(user: { orgId: string }, rule: { orgId: string }) {
  if (rule.orgId !== user.orgId) {
    throw createError(403, "forbidden");
  }
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/rules.ts",
            r#"import { prisma } from "./db";
export async function archiveRule(id: string) {
  await prisma.rule.update({ where: { id }, data: { archived: true } });
}
export async function loadRule(id: string) {
  return prisma.rule.findUniqueOrThrow({ where: { id } });
}
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { assertSameOrg } from "./access";
import { archiveRule, loadRule } from "./rules";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.post("/rules/:id/archive", requireUser, async (req, res) => {
  const rule = await loadRule(req.params.id);
  await archiveRule(rule.id);
  assertSameOrg(req.user, rule);
  res.status(204).end();
});
app.post("/control/:id/archive", requireUser, async (req, res) => {
  const rule = await loadRule(req.params.id);
  assertSameOrg(req.user, rule);
  await archiveRule(rule.id);
  res.status(204).end();
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "POST /rules/:id/archive"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    assert_eq!(
        said(&c, "POST /control/:id/archive"),
        ("known", Some("tenancy_check:param:user"), None),
    );
}

/// [STRICT] The service that holds the check is reached through somewhere the
/// application stored it (`current_app.extensions["projects"]`, Flask's `g`, a
/// dictionary of services or of functions) or through a lookup by name
/// (`getattr(service, name)(...)`, directly or bound to a local first,
/// `operator.methodcaller`, `functools.partial`). The facts named a package's call,
/// or nothing, and the route read `none` (the acceptance suite's
/// extensions_service_flask and getattr_dispatch_flask). What runs there was not
/// read: unknown. A method of what the request sent (`request.headers["x"]
/// .replace(...)`) is still a plain value's, and that route is a `none`.
#[test]
fn a_service_reached_through_a_registry_or_a_lookup_by_name_is_never_a_none() {
    let dir = repo(&[
        (
            "app.py",
            r#"import functools
import operator

from flask import Flask, abort, current_app, g, jsonify, request
from flask_login import LoginManager, current_user, login_required

from models import Project, db

app = Flask(__name__)
login_manager = LoginManager(app)


class ProjectService:
    def get_checked(self, project_id, user):
        project = Project.query.get_or_404(project_id)
        if project.team_id != user.team_id:
            abort(403)
        return project

    @property
    def checked(self):
        project = Project.query.get_or_404(request.view_args["project_id"])
        if project.team_id != current_user.team_id:
            abort(403)
        return project


def check_team(user, project):
    if project.team_id != user.team_id:
        abort(403)


service = ProjectService()
app.extensions["projects"] = service
SERVICES = {"projects": service}
HANDLERS = {"check": check_team}


@app.before_request
def bind_services():
    g.projects = service


@app.get("/ext/<int:project_id>")
@login_required
def by_extension(project_id):
    project = current_app.extensions["projects"].get_checked(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/appext/<int:project_id>")
@login_required
def by_app_extension(project_id):
    project = app.extensions["projects"].get_checked(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/g/<int:project_id>")
@login_required
def by_g(project_id):
    project = g.projects.get_checked(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/dict/<int:project_id>")
@login_required
def by_dict(project_id):
    project = SERVICES["projects"].get_checked(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/getattr/<int:project_id>")
@login_required
def by_getattr(project_id):
    project = getattr(service, "get_checked")(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/getattr2/<int:project_id>")
@login_required
def by_getattr_bound(project_id):
    method = getattr(service, request.args["op"])
    project = method(project_id, current_user)
    return jsonify(id=project.id)


@app.get("/table/<int:project_id>")
@login_required
def by_table(project_id):
    project = Project.query.get_or_404(project_id)
    HANDLERS["check"](current_user, project)
    return jsonify(id=project.id)


@app.get("/partial/<int:project_id>")
@login_required
def by_partial(project_id):
    project = Project.query.get_or_404(project_id)
    check = functools.partial(check_team, current_user)
    check(project)
    return jsonify(id=project.id)


@app.get("/methodcaller/<int:project_id>")
@login_required
def by_methodcaller(project_id):
    project = operator.methodcaller("get_checked", project_id, current_user)(service)
    return jsonify(id=project.id)


@app.get("/property/<int:project_id>")
@login_required
def by_property(project_id):
    project = service.checked
    return jsonify(id=project.id)


@app.get("/plain/<int:project_id>")
@login_required
def plain(project_id):
    project = Project.query.get_or_404(project_id)
    name = request.headers["x-name"].replace("a", project.name)
    return jsonify(id=project.id, name=name)
"#,
        ),
        (
            "models.py",
            r#"from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.String, nullable=False)
    owner_id = db.Column(db.String, nullable=False)
    name = db.Column(db.String)
"#,
        ),
        (
            "requirements.txt",
            r#"flask
flask-login
flask-sqlalchemy
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "by_extension"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_app_extension"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(said(&c, "by_g"), ("unknown", Some("body_unreadable"), None),);
    assert_eq!(
        said(&c, "by_dict"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_getattr"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_getattr_bound"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_table"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_partial"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(
        said(&c, "by_methodcaller"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(said(&c, "plain"), ("none", None, None),);
}

/// [STRICT] `app.addHook("onRequest", ...)` runs before every route registered
/// after it. It was not read, and a route with no guard of its own read `none` (the
/// acceptance suite's fastify_prehandler_check). A hook written in place is lowered
/// as a function of its own; this one answers 401 in the `catch` of `await
/// request.jwtVerify()`. No check recorded why and the route was unknown; the `try`
/// is now read as the check on the verification ([`a_401_sent_from_the_catch_of_the_
/// verification_is_a_sign_in_guard`]), so the hook is the guard. So it is of a route
/// written above the hook: a Fastify route takes the hooks of its instance when the
/// instance is ready.
#[test]
fn a_fastify_hook_of_the_application_is_read_or_unknown_never_a_none() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "fastify": "4.28.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import Fastify from "fastify";
import { prisma } from "./db";

const app = Fastify();

app.get("/before/:id", async (request) => {
  const { id } = request.params as { id: string };
  return prisma.invoice.findUnique({ where: { id } });
});

app.addHook("onRequest", async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthenticated" });
  }
});

app.get("/invoices/:id", async (request) => {
  const { id } = request.params as { id: string };
  return prisma.invoice.findUnique({ where: { id } });
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    let hook = Some("middleware:src/server.ts#app onRequest 11");
    assert_eq!(said(&c, "GET /invoices/:id"), ("known", hook, None));
    assert_eq!(said(&c, "GET /before/:id"), ("known", hook, None));
}

/// A hook that is a function of the repository and answers 401 for every request
/// without a credential is the route's guard.
#[test]
fn a_named_fastify_hook_that_answers_401_is_the_guard() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "fastify": "4.28.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { prisma } from "./db";

const app = Fastify();

async function verify(request: FastifyRequest, reply: FastifyReply) {
  if (!request.headers.authorization) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}
app.addHook("preHandler", verify);

app.get("/invoices/:id", async (request) => {
  const { id } = request.params as { id: string };
  return prisma.invoice.findUnique({ where: { id } });
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "GET /invoices/:id"),
        ("known", Some("middleware:src/server.ts#verify"), None),
    );
}

/// [STRICT] `app.use((req, res, next) => { if (!req.headers.authorization) { 401 }
/// next(); })`: the middleware has no name to follow, and every route after it read
/// `none`. It is read where it is written.
#[test]
fn an_express_middleware_written_in_place_is_read() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { prisma } from "./db";

const app = express();

app.use((req, res, next) => {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
});

app.get("/invoices/:id", async (req, res) => {
  res.json(await prisma.invoice.findUnique({ where: { id: req.params.id } }));
});

app.listen(3000);
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "GET /invoices/:id"),
        ("known", Some("middleware:src/server.ts#app use 6"), None),
    );
}

/// [STRICT] `app.use("/api/*", requireUser)` on a Hono app: a middleware for the
/// routes under the path, not a router mounted there. The route under it is guarded
/// by it; a route outside the path is not.
#[test]
fn a_hono_middleware_given_for_a_path_guards_the_routes_under_it() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "hono": "4.6.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/auth.ts",
            r#"import type { Context, Next } from "hono";
export async function requireUser(c: Context, next: Next) {
  const token = c.req.header("authorization");
  if (!token) return c.json({ error: "unauthenticated" }, 401);
  c.set("user", decode(token));
  await next();
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/server.ts",
            r#"import { Hono } from "hono";
import { prisma } from "./db";
import { requireUser } from "./auth";
const app = new Hono();
app.use("/api/*", requireUser);
app.get("/api/invoices/:id", async (c) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: c.req.param("id") } });
  if (!invoice || invoice.orgId !== c.get("user").orgId) return c.json({ error: "forbidden" }, 403);
  return c.json(invoice);
});
app.get("/public/status", (c) => c.json({ ok: true, at: c.req.query("at") }));
export default app;
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "GET /api/invoices/:id"),
        ("known", Some("middleware:src/auth.ts#requireUser"), None),
    );
    assert_eq!(said(&c, "GET /public/status"), ("none", None, None),);
}

/// [STRICT] A check that does not run, or whose refusal stops nothing, read `known
/// tenancy check`: under `with suppress(HTTPException):` (the refusal is dropped, as
/// by a `try` whose handler serves the request); handed to the event loop and not
/// awaited (`asyncio.create_task(check(...))`, `asyncio.ensure_future(...)` bound to
/// a name nothing reads); called in a `lambda` that is only defined. A task that is
/// awaited, and the same helper called plainly, are the unit's tenant check.
#[test]
fn a_python_check_that_is_suppressed_scheduled_or_in_a_lambda_is_found_not_proven() {
    let dir = repo(&[
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
        ("svc/app/__init__.py", ""),
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
            "svc/app/helpers.py",
            r#"from fastapi import HTTPException


def assert_rule_org(rule, caller):
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")


async def assert_rule_org_async(rule, caller):
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")
"#,
        ),
        (
            "svc/app/main.py",
            r#"import asyncio
import contextlib
from contextlib import suppress

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_caller
from app.helpers import assert_rule_org, assert_rule_org_async
from app.models import Rule

app = FastAPI()
router = APIRouter(prefix="/rules")
db = Session()


@router.get("/suppress/{rule_id}")
async def suppressed(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    with suppress(HTTPException):
        assert_rule_org(rule, caller)
    return rule


@router.get("/suppress2/{rule_id}")
async def suppressed_inline(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    with contextlib.suppress(Exception):
        if rule.org_id != caller.org_id:
            raise HTTPException(status_code=403, detail="another organization")
    return rule


@router.get("/task/{rule_id}")
async def scheduled(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    asyncio.create_task(assert_rule_org_async(rule, caller))
    return rule


@router.get("/future/{rule_id}")
async def ensured(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    pending = asyncio.ensure_future(assert_rule_org_async(rule, caller))
    return rule


@router.get("/lambda/{rule_id}")
async def in_lambda(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    check = lambda: assert_rule_org(rule, caller)
    return rule


@router.get("/taskawaited/{rule_id}")
async def task_awaited(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    await asyncio.create_task(assert_rule_org_async(rule, caller))
    return rule


@router.get("/control/{rule_id}")
async def control(rule_id: int, caller=Depends(get_caller)):
    rule = db.get(Rule, rule_id)
    assert_rule_org(rule, caller)
    return rule


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
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "suppressed"),
        ("unknown", Some("check_not_proven"), Some("swallowed")),
    );
    assert_eq!(
        said(&c, "suppressed_inline"),
        ("unknown", Some("check_not_proven"), Some("swallowed")),
    );
    assert_eq!(
        said(&c, "scheduled"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "ensured"),
        ("unknown", Some("check_not_proven"), Some("not_awaited")),
    );
    assert_eq!(
        said(&c, "in_lambda"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "task_awaited"),
        (
            "known",
            Some("tenancy_check:svc/app/helpers.py#assert_rule_org_async"),
            None
        ),
    );
    assert_eq!(
        said(&c, "control"),
        (
            "known",
            Some("tenancy_check:svc/app/helpers.py#assert_rule_org"),
            None
        ),
    );
}

/// [STRICT] In a Next.js handler: a check in an arrow function bound to a name
/// nothing calls, a helper called only from such a function or from a nested
/// function declaration nothing calls, and a helper called in a `setTimeout`
/// callback, read `known tenancy check`. A check or a helper under a branch on the
/// request's method (`if (req.method !== "GET")`, a `switch`, a pages-router handler)
/// checks nothing for the other methods. The same arrow function called on every
/// path is the unit's tenant check.
#[test]
fn a_typescript_check_in_a_function_that_does_not_run_where_it_is_written_is_found_not_proven() {
    let dir = repo(&[
        (
            "web/package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0", "react": "19.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, "strict": true } }
"#,
        ),
        (
            "web/app/api/arrow/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  const check = () => {
    if (rule.orgId !== session.orgId) throw new Error("forbidden");
  };
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/app/api/arrowhelper/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  const check = () => assertRuleAccess(session, rule);
  function verify() {
    assertRuleAccess(session, rule);
  }
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/app/api/called/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  const check = () => assertRuleAccess(session, rule);
  check();
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/app/api/method/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  if (req.method !== "GET") {
    if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/app/api/switch/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  switch (req.method) {
    case "DELETE":
      assertRuleAccess(session, rule);
      break;
  }
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/app/api/timeout/[id]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { assertRuleAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: params.id } });
  setTimeout(() => assertRuleAccess(session, rule), 0);
  return NextResponse.json(rule);
}
"#,
        ),
        (
            "web/lib/access.ts",
            r#"import type { Session } from "./session";
export function assertRuleAccess(session: Session, rule: { orgId: string }): void {
  if (rule.orgId !== session.orgId) throw new Error("forbidden");
}
"#,
        ),
        (
            "web/lib/db.ts",
            r#"import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
"#,
        ),
        (
            "web/lib/session.ts",
            r#"import { cookies } from "next/headers";

export type Session = { userId: string; orgId: string; role: string; memberships: { orgId: string }[] };

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get("session")?.value;
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString()) as Session;
}
"#,
        ),
        (
            "web/pages/api/rules/[id].ts",
            r#"import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession();
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: String(req.query.id) } });
  if (req.method === "DELETE") {
    if (rule.orgId !== session.orgId) return res.status(403).json({ error: "Forbidden" });
    await prisma.rule.delete({ where: { id: rule.id } });
    return res.status(204).end();
  }
  return res.json(rule);
}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET @ api/arrow/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET @ api/arrowhelper/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET @ api/timeout/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET @ api/method/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "POST @ api/switch/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "default @ pages/api/rules/"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(
        said(&c, "GET @ api/called/"),
        ("known", Some("tenancy_check:param:session"), None),
    );
}

/// [STRICT] A DRF permission class of the repository read `known tenancy guard` by
/// its name and the framework's contract; what `has_permission` compares is not in
/// the facts, so it is found by its name, not proven. One that defines only
/// `has_object_permission` decides nothing where the view never asks for the object
/// check: an `APIView` handler that loads the row itself and does not call
/// `check_object_permissions()` or `get_object()`, and a list view (obligation
/// `not_called`). The library's own class (`IsAdminUser`) keeps the library's
/// meaning.
#[test]
fn a_drf_permission_class_of_the_repository_is_found_by_name_or_not_called() {
    let dir = repo(&[
        (
            "requirements.txt",
            r#"django
djangorestframework
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["rest_framework", "tickets"]
ROOT_URLCONF = "proj.urls"
REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"]}
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from tickets import views

urlpatterns = [
    path("plain/<int:pk>/", views.PlainDetail.as_view()),
    path("asked/<int:pk>/", views.AskedDetail.as_view()),
    path("generic/<int:pk>/", views.GenericDetail.as_view()),
    path("listed/", views.TicketList.as_view()),
    path("admin/<int:pk>/", views.AdminDetail.as_view()),
    path("member/<int:pk>/", views.MemberDetail.as_view()),
]
"#,
        ),
        ("tickets/__init__.py", ""),
        (
            "tickets/models.py",
            r#"from django.db import models


class Ticket(models.Model):
    org_id = models.IntegerField()
    title = models.CharField(max_length=100)
"#,
        ),
        (
            "tickets/views.py",
            r#"from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from tickets.models import Ticket


class IsOrgMember(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.org_id == request.user.org_id


class IsOrgAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.org_role == "admin"


class TicketSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = ["id", "title"]


class PlainDetail(APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    def get(self, request, pk):
        ticket = Ticket.objects.get(pk=pk)
        return Response(TicketSerializer(ticket).data)


class AskedDetail(APIView):
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]

    def get(self, request, pk):
        ticket = Ticket.objects.get(pk=pk)
        self.check_object_permissions(request, ticket)
        return Response(TicketSerializer(ticket).data)


class GenericDetail(generics.RetrieveAPIView):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]


class TicketList(generics.ListAPIView):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [permissions.IsAuthenticated, IsOrgMember]


class AdminDetail(generics.RetrieveAPIView):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [permissions.IsAuthenticated, permissions.IsAdminUser]


class MemberDetail(generics.RetrieveAPIView):
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer
    permission_classes = [permissions.IsAuthenticated, IsOrgAdmin]
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "PlainDetail.get"),
        ("unknown", Some("check_not_proven"), Some("not_called")),
    );
    assert_eq!(
        said(&c, "TicketList"),
        ("unknown", Some("check_not_proven"), Some("not_called")),
    );
    assert_eq!(
        said(&c, "AskedDetail.get"),
        ("unknown", Some("check_not_proven"), Some("by_name_only")),
    );
    assert_eq!(
        said(&c, "GenericDetail"),
        ("unknown", Some("check_not_proven"), Some("by_name_only")),
    );
    assert_eq!(
        said(&c, "MemberDetail"),
        ("unknown", Some("check_not_proven"), Some("by_name_only")),
    );
    assert_eq!(
        said(&c, "AdminDetail"),
        (
            "known",
            Some("role_guard:pkg:rest_framework#permissions.IsAdminUser"),
            None
        ),
    );
}

/// [STRICT] `@UseGuards(RolesGuard)` read `known role guard` from the class's name.
/// This `RolesGuard` lets every caller through. A guard of the repository is a role
/// guard where its own body answers 403 on a role value; where only the name says
/// so it is found by its name. (`AdminGuard` here does throw on `req.user.role`,
/// read off a local the TypeScript facts do not follow: unknown too, a listed
/// weakness, never a false known.)
#[test]
fn a_nest_guard_named_for_a_role_is_found_by_its_name() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/passport": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/guards.ts",
            r#"import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    return this.allowed(req.user);
  }
  private allowed(user: { flags: string[] }): boolean {
    return user.flags.length >= 0;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.user.role !== "admin") throw new ForbiddenException();
    return true;
  }
}
"#,
        ),
        (
            "src/rules.controller.ts",
            r#"import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminGuard, RolesGuard } from "./guards";
import { prisma } from "./db";
@Controller("rules")
@UseGuards(AuthGuard("jwt"))
export class RulesController {
  @Get(":id")
  @UseGuards(RolesGuard)
  one(@Param("id") id: string) {
    return prisma.rule.findUnique({ where: { id } });
  }
  @Delete(":id")
  @UseGuards(AdminGuard)
  remove(@Param("id") id: string) {
    return prisma.rule.delete({ where: { id } });
  }
}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("by_name_only")),
    );
    assert_eq!(
        said(&c, "DELETE /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("by_name_only")),
    );
}

/// A dependency that records the caller (`db.add(...)`, `db.commit()`) before it
/// answers 403 for another organisation still guards the route: `after_effect` is
/// about what the request asked the route to change, not a guard's own bookkeeping
/// before its refusal.
#[test]
fn what_a_guard_writes_before_it_refuses_is_not_the_routes_effect() {
    let dir = repo(&[
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
        ("svc/app/__init__.py", ""),
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
            "svc/app/main.py",
            r#"from fastapi import APIRouter, Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from app.deps import get_caller
from app.models import Rule

app = FastAPI()
router = APIRouter(prefix="/orgs/{org_id}/rules")
db = Session()


class Seen(Rule):
    pass


def require_member(org_id: str, caller=Depends(get_caller)):
    db.add(Seen(org_id=caller.org_id))
    db.commit()
    if caller.org_id != org_id:
        raise HTTPException(status_code=403, detail="another organization")
    return caller


@router.get("/{rule_id}")
async def get_rule(org_id: str, rule_id: int, caller=Depends(require_member)):
    return db.get(Rule, rule_id)


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
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "get_rule"),
        (
            "known",
            Some("tenancy_guard:svc/app/main.py#require_member"),
            None
        ),
    );
}

/// [STRICT] `pool.query("select * from invoices where org_id = $1",
/// [req.user.orgId])` scopes by the caller's organisation in SQL written as text,
/// and the route read `none`. A string or a template (tagged or not) that starts
/// with an SQL verb and names a tenant or an owner key, and a query builder's
/// comparison by such a column (`eq(invoices.orgId, ...)`, `.where("org_id", ...)`),
/// are a filter no fact records: unknown, never a recorded absence. SQL that names
/// no such key is still a `none`.
#[test]
fn a_typescript_query_scoped_in_sql_text_or_by_a_builder_is_never_a_none() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "express": "4.19.0", "pg": "8.11.0", "postgres": "3.4.0", "@prisma/client": "5.20.0", "drizzle-orm": "0.33.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { Pool } from "pg";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { drizzle } from "drizzle-orm/node-postgres";
export const pool = new Pool();
export const sql = postgres(process.env.DATABASE_URL!);
export const prisma = new PrismaClient();
export const db = drizzle(pool);
"#,
        ),
        (
            "src/schema.ts",
            r#"import { pgTable, text } from "drizzle-orm/pg-core";
export const invoices = pgTable("invoices", { id: text("id"), orgId: text("org_id"), status: text("status") });
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { and, eq } from "drizzle-orm";
import { db, pool, prisma, sql } from "./db";
import { invoices } from "./schema";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  req.user = decode(req.headers.authorization);
  next();
}
app.get("/tagged", requireUser, async (req, res) => {
  const rows = await sql`select * from invoices where org_id = ${req.user.orgId}`;
  res.json(rows);
});
app.get("/driver", requireUser, async (req, res) => {
  const { rows } = await pool.query("select * from invoices where org_id = $1", [req.user.orgId]);
  res.json(rows);
});
app.get("/prismaraw", requireUser, async (req, res) => {
  const rows = await prisma.$queryRaw`select * from invoices where org_id = ${req.user.orgId}`;
  res.json(rows);
});
app.get("/drizzle", requireUser, async (req, res) => {
  const rows = await db.select().from(invoices).where(eq(invoices.orgId, req.user.orgId));
  res.json(rows);
});
app.get("/drizzle2", requireUser, async (req, res) => {
  const rows = await db.select().from(invoices).where(and(eq(invoices.status, "open"), eq(invoices.orgId, req.user.orgId)));
  res.json(rows);
});
app.get("/plainsql", requireUser, async (req, res) => {
  const { rows } = await pool.query("select count(*) from invoices where status = $1", ["open"]);
  res.json(rows);
});
app.get("/plaindrizzle", requireUser, async (req, res) => {
  const rows = await db.select().from(invoices).where(eq(invoices.status, "open"));
  res.json(rows);
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /driver"),
        ("unknown", Some("unclassified"), None),
    );
    // A tagged template is a call of its tag, given the caller's organisation: the
    // use is named (it read `dynamic` while the tag was no call of the body).
    assert_eq!(
        said(&c, "GET /tagged"),
        ("unknown", Some("unclassified"), None),
    );
    assert_eq!(
        said(&c, "GET /prismaraw"),
        ("unknown", Some("unclassified"), None),
    );
    assert_eq!(
        said(&c, "GET /drizzle"),
        ("unknown", Some("body_unreadable"), None),
    );
    assert_eq!(said(&c, "GET /plainsql"), ("none", None, None),);
}

/// [STRICT] `prisma.rule.findMany({ where: { orgId: user.orgId } })` in a method of
/// an injected NestJS service: the TypeScript facts held no keys for a method's
/// calls, and the route read `none`. A method now records the keys its calls are
/// given, so the filter is found (not proven: where its value comes from is not in
/// the facts). A method that only counts is still a `none`.
#[test]
fn a_query_a_nest_service_filters_by_a_tenant_key_is_found() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/passport": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/rules.controller.ts",
            r#"import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RulesService } from "./rules.service";
@Controller("rules")
@UseGuards(AuthGuard("jwt"))
export class RulesController {
  constructor(private readonly rules: RulesService) {}
  @Get()
  list(@Req() req) {
    return this.rules.list(req.user);
  }
  @Get("all")
  all() {
    return this.rules.all();
  }
  @Get("count")
  count() {
    return this.rules.count();
  }
}
"#,
        ),
        (
            "src/rules.service.ts",
            r#"import { Injectable } from "@nestjs/common";
import { prisma } from "./db";
@Injectable()
export class RulesService {
  list(user: { orgId: string }) {
    return prisma.rule.findMany({ where: { orgId: user.orgId } });
  }
  all() {
    return prisma.rule.findMany({ where: { archived: false } });
  }
  count() {
    return prisma.rule.count();
  }
}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /rules"),
        (
            "unknown",
            Some("check_not_proven"),
            Some("sides_not_caller_and_resource")
        ),
    );
    assert_eq!(said(&c, "GET /rules/count"), ("none", None, None),);
}

/// [STRICT] `app.useGlobalGuards(new AuthGuard())` in `main.ts` guards every route,
/// and a controller with no guard of its own read `none`. It is read as a module's
/// `APP_GUARD` provider is.
#[test]
fn a_nest_guard_registered_for_the_whole_application_is_read() {
    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "a", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/app.module.ts",
            r#"import { Module } from "@nestjs/common";
import { InvoicesController } from "./invoices.controller";
@Module({ controllers: [InvoicesController] })
export class AppModule {}
"#,
        ),
        (
            "src/auth.guard.ts",
            r#"import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    return true;
  }
}
"#,
        ),
        (
            "src/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "src/invoices.controller.ts",
            r#"import { Controller, Get, Param } from "@nestjs/common";
import { prisma } from "./db";
@Controller("invoices")
export class InvoicesController {
  @Get(":id")
  one(@Param("id") id: string) {
    return prisma.invoice.findUnique({ where: { id } });
  }
}
"#,
        ),
        (
            "src/main.ts",
            r#"import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AuthGuard } from "./auth.guard";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalGuards(new AuthGuard());
  await app.listen(3000);
}
bootstrap();
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "GET /invoices/:id"),
        ("known", Some("app_guard:src/auth.guard.ts#AuthGuard"), None),
    );
}

/// [STRICT] A middleware class with only `__call__(scope, receive, send)` that
/// sends a 401 itself for some requests and calls the application it wraps for the
/// rest. No check records the branch (the answer is sent, not returned), and the
/// route read `none`. It may be the guard: unknown.
#[test]
fn a_pure_asgi_middleware_that_answers_some_requests_itself_is_never_a_none() {
    let dir = repo(&[
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
        ),
        ("svc/app/__init__.py", ""),
        (
            "svc/app/auth.py",
            r#"from starlette.responses import JSONResponse


class TokenMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope["headers"])
            if b"authorization" not in headers:
                response = JSONResponse({"detail": "unauthenticated"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
"#,
        ),
        (
            "svc/app/main.py",
            r#"from fastapi import FastAPI

from app.auth import TokenMiddleware

app = FastAPI()
app.add_middleware(TokenMiddleware)


@app.get("/rules/{rule_id}")
async def get_rule(rule_id: int):
    return {"id": rule_id}
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(said(&c, "get_rule"), ("unknown", Some("unresolved"), None),);
}

/// [STRICT] `decorators = [login_required]` on a Flask `MethodView` wraps every
/// handler of the class. A list written in place is read, each element as a
/// decorator of the view (Python lowering 60): a library's guard on the closed
/// list is the guard. A list with an element that is not read (a spread) may hold
/// the guard: unknown. A view class without one is a `none`.
#[test]
fn a_flask_method_view_with_a_decorators_list_is_never_a_none() {
    let dir = repo(&[
        (
            "app.py",
            r#"from flask import Flask, jsonify
from flask.views import MethodView
from flask_login import LoginManager, login_required

app = Flask(__name__)
login_manager = LoginManager(app)


def audited(view):
    return view


class RuleView(MethodView):
    decorators = [login_required]

    def get(self, rule_id):
        return jsonify(id=rule_id)


class OpenView(MethodView):
    def get(self, rule_id):
        return jsonify(id=rule_id)


class MixedView(MethodView):
    decorators = [audited, *([login_required])]

    def get(self, rule_id):
        return jsonify(id=rule_id)


app.add_url_rule("/rules/<int:rule_id>", view_func=RuleView.as_view("rule"))
app.add_url_rule("/open/<int:rule_id>", view_func=OpenView.as_view("open"))
app.add_url_rule("/mixed/<int:rule_id>", view_func=MixedView.as_view("mixed"))
"#,
        ),
        (
            "requirements.txt",
            r#"flask
flask-login
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "RuleView.get"),
        (
            "known",
            Some("decorator:pkg:flask_login#login_required"),
            None
        ),
    );
    assert_eq!(
        said(&c, "MixedView.get"),
        ("unknown", Some("unresolved"), None),
    );
    assert_eq!(said(&c, "OpenView.get"), ("none", None, None),);
}

/// [STRICT] `@method_decorator(decorators, name="dispatch")` with the list bound to
/// a name, and `@method_decorator([...])` on a `dispatch` method, were not read and
/// the views read `none`. Each may be the guard: unknown. The list written in place
/// is read as before.
#[test]
fn a_django_view_guarded_through_method_decorator_is_read_or_unknown() {
    let dir = repo(&[
        (
            "manage.py",
            r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
"#,
        ),
        (
            "requirements.txt",
            r#"django
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["django.contrib.auth", "tickets"]
ROOT_URLCONF = "proj.urls"
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from tickets import views

urlpatterns = [
    path("listed/<int:pk>/", views.ListedView.as_view()),
    path("single/<int:pk>/", views.SingleView.as_view()),
    path("dispatch/<int:pk>/", views.DispatchView.as_view()),
    path("open/<int:pk>/", views.OpenView.as_view()),
]
"#,
        ),
        ("tickets/__init__.py", ""),
        (
            "tickets/views.py",
            r#"from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.cache import never_cache

decorators = [never_cache, login_required]


@method_decorator(decorators, name="dispatch")
class ListedView(View):
    def get(self, request, pk):
        return JsonResponse({"id": pk})


@method_decorator([never_cache, login_required], name="dispatch")
class SingleView(View):
    def get(self, request, pk):
        return JsonResponse({"id": pk})


class DispatchView(View):
    @method_decorator([never_cache, login_required])
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def get(self, request, pk):
        return JsonResponse({"id": pk})


class OpenView(View):
    def get(self, request, pk):
        return JsonResponse({"id": pk})
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "ListedView.get"),
        ("unknown", Some("unresolved"), None),
    );
    assert_eq!(
        said(&c, "DispatchView.get"),
        ("unknown", Some("unresolved"), None),
    );
    assert_eq!(
        said(&c, "SingleView.get"),
        (
            "known",
            Some("decorator:pkg:django#contrib.auth.decorators.login_required"),
            None
        ),
    );
    assert_eq!(said(&c, "OpenView.get"), ("none", None, None),);
}

/// [STRICT] `django.contrib.auth.middleware.LoginRequiredMiddleware` in
/// `MIDDLEWARE` turns away every request that is not signed in. The facts held it
/// on each view and the map did not know it: the views read `none`.
#[test]
fn djangos_login_required_middleware_in_settings_is_the_guard() {
    let dir = repo(&[
        (
            "manage.py",
            r#"import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
"#,
        ),
        (
            "requirements.txt",
            r#"django
"#,
        ),
        ("proj/__init__.py", ""),
        (
            "proj/settings.py",
            r#"INSTALLED_APPS = ["django.contrib.auth", "tickets"]
ROOT_URLCONF = "proj.urls"
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.auth.middleware.LoginRequiredMiddleware",
]
"#,
        ),
        (
            "proj/urls.py",
            r#"from django.urls import path

from tickets import views

urlpatterns = [
    path("fn/<int:pk>/", views.detail),
    path("cbv/<int:pk>/", views.DetailView.as_view()),
]
"#,
        ),
        ("tickets/__init__.py", ""),
        (
            "tickets/views.py",
            r#"from django.http import JsonResponse
from django.views import View


def detail(request, pk):
    return JsonResponse({"id": pk})


class DetailView(View):
    def get(self, request, pk):
        return JsonResponse({"id": pk})
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        said(&c, "detail"),
        (
            "known",
            Some("middleware:pkg:django#contrib.auth.middleware.LoginRequiredMiddleware"),
            None
        ),
    );
    assert_eq!(
        said(&c, "DetailView.get"),
        (
            "known",
            Some("middleware:pkg:django#contrib.auth.middleware.LoginRequiredMiddleware"),
            None
        ),
    );
}

// ---- A check only some requests reach, in TypeScript: the arms of a branch --------

/// A Next.js app with a session, a Prisma client, a helper that holds the tenant
/// check, and this `app/api/rules/[id]/route.ts`.
fn next_app(route: &str) -> tempfile::TempDir {
    repo(&[
        (
            "web/package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0", "react": "19.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "web/tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] }, "strict": true } }
"#,
        ),
        (
            "web/lib/session.ts",
            r#"import { cookies } from "next/headers";
export type Session = { userId: string; orgId: string; role: string };
export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get("session")?.value;
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString()) as Session;
}
"#,
        ),
        (
            "web/lib/db.ts",
            r#"import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient();
"#,
        ),
        (
            "web/lib/access.ts",
            r#"import { Session } from "@/lib/session";
export class Forbidden extends Error { status = 403; }
export function assertSameOrg(session: Session, rule: { orgId: string }) {
  if (rule.orgId !== session.orgId) {
    throw new Forbidden("forbidden");
  }
}
"#,
        ),
        ("web/app/api/rules/[id]/route.ts", route),
    ])
}

/// The imports of a route of [`next_app`] and the start of a handler `name`: the
/// session or a 401, the rule or a 404.
fn next_handler(name: &str) -> String {
    format!(
        r#"import {{ NextRequest, NextResponse }} from "next/server";
import {{ getSession }} from "@/lib/session";
import {{ prisma }} from "@/lib/db";
import {{ assertSameOrg }} from "@/lib/access";
async function {name}(req: NextRequest, {{ params }}: {{ params: {{ id: string }} }}) {{
  const session = await getSession();
  if (!session) return NextResponse.json({{ error: "Unauthorized" }}, {{ status: 401 }});
  const rule = await prisma.rule.findUnique({{ where: {{ id: params.id }} }});
  if (!rule) return NextResponse.json({{ error: "Not found" }}, {{ status: 404 }});
"#
    )
}

/// An Express app with a `requireUser` guard, a Prisma client, and these routes.
fn express_app(routes: &str) -> tempfile::TempDir {
    let server = format!(
        r#"import express from "express";
import {{ PrismaClient }} from "@prisma/client";
const prisma = new PrismaClient();
const app = express();
function requireUser(req, res, next) {{
  if (!req.headers.authorization) return res.status(401).json({{ error: "unauthenticated" }});
  req.user = decode(req.headers.authorization);
  next();
}}
{routes}"#
    );
    repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        ("src/server.ts", &server),
    ])
}

/// [STRICT] One Next.js handler serves several methods and holds the tenant check in
/// the `else` of the branch on the method: `if (req.method === "GET") { return
/// json(rule) } else { <check> }`. The `else` of a branch that returns was read as
/// what every request reaches, and both routes read `known tenancy check` though a
/// GET never reaches the comparison. The same with the helper called there.
#[test]
fn a_check_in_the_else_of_a_method_branch_that_serves_is_found_not_proven() {
    for check in [
        r#"if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });"#,
        "assertSameOrg(session, rule);",
    ] {
        let dir = next_app(&format!(
            r#"{}  if (req.method === "GET") {{
    return NextResponse.json(rule);
  }} else {{
    {check}
    await prisma.rule.delete({{ where: {{ id: rule.id }} }});
  }}
  return new NextResponse(null, {{ status: 204 }});
}}
export {{ handler as GET, handler as DELETE }};
"#,
            next_handler("handler")
        ));
        let c = concern(dir.path(), "authz");
        for verb in ["GET", "DELETE"] {
            assert_eq!(
                said(&c, verb),
                (
                    "unknown",
                    Some("check_not_proven"),
                    Some("after_conditional_return")
                ),
                "{verb}: {check}"
            );
        }
    }
}

/// [STRICT] The same where each verb is a function of its own that hands the request
/// to one shared function, and that function branches on the method.
#[test]
fn a_check_in_the_else_arm_of_a_shared_function_is_found_not_proven() {
    let dir = next_app(&format!(
        r#"{}  if (req.method === "GET") {{
    return NextResponse.json(rule);
  }} else {{
    if (rule.orgId !== session.orgId) return NextResponse.json({{ error: "Forbidden" }}, {{ status: 403 }});
  }}
  return new NextResponse(null, {{ status: 204 }});
}}
export async function GET(req: NextRequest, ctx: {{ params: {{ id: string }} }}) {{
  return handle(req, ctx);
}}
export async function DELETE(req: NextRequest, ctx: {{ params: {{ id: string }} }}) {{
  return handle(req, ctx);
}}
"#,
        next_handler("handle")
    ));
    let c = concern(dir.path(), "authz");
    for verb in ["GET", "DELETE"] {
        assert_eq!(
            said(&c, verb),
            (
                "unknown",
                Some("check_not_proven"),
                Some("after_conditional_return")
            ),
            "{verb}"
        );
    }
}

/// [STRICT] `export const GET = handler; export const DELETE = handler;`: the
/// bindings have no body, and the map read them for the handler: authentication
/// `none` though the function answers 401 without a session, and no authorization
/// unit at all. They are the function, read as `export { handler as GET }` is: here
/// the check sits in one case of a `switch` on the method.
#[test]
fn a_next_handler_bound_to_several_verbs_is_read_as_the_function() {
    let dir = next_app(&format!(
        r#"{}  switch (req.method) {{
    case "DELETE":
      if (rule.orgId !== session.orgId) return NextResponse.json({{ error: "Forbidden" }}, {{ status: 403 }});
      await prisma.rule.delete({{ where: {{ id: rule.id }} }});
      return new NextResponse(null, {{ status: 204 }});
    default:
      return NextResponse.json(rule);
  }}
}}
export const GET = handler;
export const DELETE = handler;
"#,
        next_handler("handler")
    ));
    let authz = concern(dir.path(), "authz");
    let authn = concern(dir.path(), "authn");
    for verb in ["GET", "DELETE"] {
        assert_eq!(
            said(&authz, verb),
            ("unknown", Some("check_not_proven"), Some("under_branch")),
            "{verb}"
        );
        assert_eq!(said(&authn, verb).0, "known", "{verb}");
    }
}

/// The control: several verbs from one function with the check before the branch on
/// the method is the tenant check of each.
#[test]
fn a_check_before_the_branch_on_the_method_is_the_tenant_check_of_every_verb() {
    let dir = next_app(&format!(
        r#"{}  if (rule.orgId !== session.orgId) return NextResponse.json({{ error: "Forbidden" }}, {{ status: 403 }});
  if (req.method === "DELETE") {{
    await prisma.rule.delete({{ where: {{ id: rule.id }} }});
    return new NextResponse(null, {{ status: 204 }});
  }}
  return NextResponse.json(rule);
}}
export const GET = handler, DELETE = handler;
"#,
        next_handler("handler")
    ));
    let c = concern(dir.path(), "authz");
    for verb in ["GET", "DELETE"] {
        assert_eq!(
            said(&c, verb),
            ("known", Some("tenancy_check:claim:.orgId"), None),
            "{verb}"
        );
    }
}

/// [STRICT] `if (req.method === "DELETE" && rule.orgId !== session.orgId) return 403`:
/// the comparison decides only where the other operand holds. TypeScript read both
/// operands as checks of every request (`known`, and the method as a role). The same
/// for an admin bypass in Express, and for the `else` that refuses of `if (preview ||
/// same) { ... } else { 403 }`.
#[test]
fn a_typescript_tenant_comparison_that_is_an_operand_of_and_is_found_not_proven() {
    let dir = next_app(&format!(
        r#"{}  if (req.method === "DELETE" && rule.orgId !== session.orgId) {{
    return NextResponse.json({{ error: "Forbidden" }}, {{ status: 403 }});
  }}
  return NextResponse.json(rule);
}}
export {{ handler as GET, handler as DELETE }};
"#,
        next_handler("handler")
    ));
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE"),
        ("unknown", Some("check_not_proven"), Some("and_operand")),
    );
    let unit = c["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["symbol"] == "DELETE")
        .unwrap();
    assert_eq!(
        unit["not_proven"]["when"], r#"only when req.method === "...""#,
        "{unit:#}"
    );

    let dir = express_app(
        r#"app.get("/bypass/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.user.role !== "admin" && rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rule);
});
app.get("/negated/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.query.preview || rule.orgId === req.user.orgId) {
    res.json(rule);
  } else {
    res.status(403).json({ error: "forbidden" });
  }
});
app.get("/either/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUnique({ where: { id: req.params.id } });
  if (!rule) {
    return res.status(404).json({ error: "not found" });
  } else if (rule.orgId !== req.user.orgId) {
    return res.status(403).json({ error: "forbidden" });
  }
  res.json(rule);
});
"#,
    );
    let c = concern(dir.path(), "authz");
    for route in ["GET /bypass/:id", "GET /negated/:id"] {
        assert_eq!(
            said(&c, route),
            ("unknown", Some("check_not_proven"), Some("and_operand")),
            "{route}"
        );
    }
    // The `else` of a branch that turns its own requests away is every other request.
    assert_eq!(said(&c, "GET /either/:id").0, "known");
}

/// [STRICT] A return that serves some requests, wherever it is: under two branches,
/// in a `switch` case, or as a bare `return` after the answer in an `else if` chain.
/// Only a branch at the top of the body that returned was read, and the comparison
/// below read `known`.
#[test]
fn a_typescript_check_after_a_return_in_a_nested_branch_or_a_case_is_found_not_proven() {
    let dir = express_app(
        r#"app.get("/nested/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.query.preview) {
    if (rule.public) {
      return res.json({ id: rule.id });
    }
  }
  if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rule);
});
app.get("/case/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  switch (req.query.mode) {
    case "head":
      return res.json({ id: rule.id });
  }
  if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rule);
});
app.get("/bare/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.query.preview) {
    res.json({ id: rule.id });
    return;
  } else if (rule.orgId !== req.user.orgId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json(rule);
});
app.all("/all/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.method === "GET") {
    return res.json(rule);
  } else {
    if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  }
  await prisma.rule.delete({ where: { id: rule.id } });
  res.status(204).end();
});
"#,
    );
    let c = concern(dir.path(), "authz");
    for route in [
        "GET /nested/:id",
        "GET /case/:id",
        "GET /bare/:id",
        "ALL /all/:id",
    ] {
        assert_eq!(
            said(&c, route),
            (
                "unknown",
                Some("check_not_proven"),
                Some("after_conditional_return")
            ),
            "{route}"
        );
    }
}

/// [STRICT] `if (req.method === "PATCH") return 403` compares the request's method
/// with a literal: nothing of the caller. Beside a tenant check it read as a role
/// check too (`role_check:param:req.method`).
#[test]
fn a_403_on_the_request_method_is_no_role_check() {
    let dir = express_app(
        r#"app.all("/rules/:id", requireUser, async (req, res) => {
  if (req.method === "PATCH") return res.status(403).json({ error: "no patch" });
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rule);
});
"#,
    );
    let c = concern(dir.path(), "authz");
    let (assignment, key, _) = said(&c, "ALL /rules/:id");
    assert_eq!(assignment, "known");
    assert!(
        key.is_some_and(|k| k.starts_with("tenancy_check:") && !k.contains("role_check")),
        "{key:?}"
    );
}

/// The line of a Next.js route that refuses another tenant's rule, and the helper
/// call that does.
const NEXT_INLINE: &str = r#"if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });"#;
const NEXT_THROW: &str =
    r#"if (rule.orgId !== session.orgId) throw new Error("forbidden", { cause: 403 });"#;

/// Both verbs of a route of [`next_app`] say this of authorization.
fn both_verbs(route: &str, want: (&str, Option<&str>, Option<&str>), what: &str) {
    let dir = next_app(route);
    let c = concern(dir.path(), "authz");
    for verb in ["GET", "DELETE"] {
        assert_eq!(said(&c, verb), want, "{verb}: {what}");
    }
}

/// [STRICT] One verb is another under a second name (`export const DELETE = GET;`,
/// `export { GET as DELETE }`), and the function branches on the method: the check in
/// one arm is the check of neither.
#[test]
fn a_next_verb_that_is_another_verb_under_a_second_name_is_read_as_that_function() {
    for (alias, obligation) in [
        ("export const DELETE = GET;", "after_conditional_return"),
        ("export { GET as DELETE };", "after_conditional_return"),
    ] {
        let route = format!(
            r#"{}  if (req.method === "GET") {{
    return NextResponse.json(rule);
  }} else {{
    {NEXT_INLINE}
    await prisma.rule.delete({{ where: {{ id: rule.id }} }});
  }}
  return new NextResponse(null, {{ status: 204 }});
}}
{alias}
"#,
            next_handler("GET").replace("async function GET", "export async function GET")
        );
        both_verbs(
            &route,
            ("unknown", Some("check_not_proven"), Some(obligation)),
            alias,
        );
    }
}

/// [STRICT] A callback written under the branch on the method runs for the requests
/// that take the branch: `if (req.method === "DELETE") { await
/// prisma.$transaction(async (tx) => { <check> }) }`. Each function started its own
/// count of branches, and the comparison in the callback read `known` for a GET too.
/// The same for a helper called in the callback, and for a callback after a return
/// that serves.
#[test]
fn a_check_in_a_callback_under_a_branch_is_found_not_proven() {
    for check in [NEXT_THROW, "assertSameOrg(session, rule);"] {
        let route = format!(
            r#"{}  if (req.method === "DELETE") {{
    await prisma.$transaction(async (tx) => {{
      {check}
      await tx.rule.delete({{ where: {{ id: rule.id }} }});
    }});
  }}
  return NextResponse.json(rule);
}}
export {{ handler as GET, handler as DELETE }};
"#,
            next_handler("handler")
        );
        both_verbs(
            &route,
            ("unknown", Some("check_not_proven"), Some("under_branch")),
            check,
        );
    }
    let route = format!(
        r#"{}  if (req.method === "GET") return NextResponse.json(rule);
  await prisma.$transaction(async (tx) => {{
    {NEXT_THROW}
    await tx.rule.delete({{ where: {{ id: rule.id }} }});
  }});
  return new NextResponse(null, {{ status: 204 }});
}}
export {{ handler as GET, handler as DELETE }};
"#,
        next_handler("handler")
    );
    both_verbs(
        &route,
        (
            "unknown",
            Some("check_not_proven"),
            Some("after_conditional_return"),
        ),
        "after a return that serves",
    );

    let dir = express_app(
        r#"app.all("/branch/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (req.method !== "GET") {
    await prisma.$transaction(async (tx) => {
      if (rule.orgId !== req.user.orgId) throw new Error("forbidden", { cause: 403 });
      await tx.rule.delete({ where: { id: rule.id } });
    });
  }
  res.json(rule);
});
app.all("/always/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  await prisma.$transaction(async (tx) => {
    if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
    await tx.rule.update({ where: { id: rule.id }, data: { seen: true } });
  });
  res.json(rule);
});
"#,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "ALL /branch/:id"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    // The control: a callback every request reaches.
    assert_eq!(said(&c, "ALL /always/:id").0, "known");
}

/// [STRICT] A function written in the handler under a name of its own checks where
/// it is called, not where it is written: `const check = () => { <check> }; if
/// (req.method === "DELETE") check();`. Read where it stands, its comparison was the
/// tenant check of every verb. As a declaration, as an arrow that calls the helper,
/// called in a `switch` case, and handed to a call under the branch.
#[test]
fn a_local_function_called_only_under_a_branch_is_found_not_proven() {
    for (local, call) in [
        (
            format!("function check() {{\n    {NEXT_THROW}\n  }}"),
            r#"if (req.method === "DELETE") { check(); }"#,
        ),
        (
            "const check = () => {\n    assertSameOrg(session, rule);\n  };".to_string(),
            r#"if (req.method === "DELETE") { check(); }"#,
        ),
        (
            format!("const check = () => {{\n    {NEXT_THROW}\n  }};"),
            r#"switch (req.method) { case "DELETE": check(); }"#,
        ),
        (
            format!("const check = async () => {{\n    {NEXT_THROW}\n  }};"),
            r#"if (req.method === "DELETE") await prisma.$transaction(check);"#,
        ),
    ] {
        let route = format!(
            r#"{}  {local}
  {call}
  return NextResponse.json(rule);
}}
export {{ handler as GET, handler as DELETE }};
"#,
            next_handler("handler")
        );
        both_verbs(
            &route,
            ("unknown", Some("check_not_proven"), Some("under_branch")),
            call,
        );
    }
    // The controls: called for every request, before or after it is written.
    for body in [
        format!(
            "const check = () => {{\n    {NEXT_THROW}\n  }};\n  check();\n  return NextResponse.json(rule);"
        ),
        format!(
            "check();\n  return NextResponse.json(rule);\n  function check() {{\n    {NEXT_THROW}\n  }}"
        ),
    ] {
        let route = format!(
            "{}  {body}\n}}\nexport {{ handler as GET, handler as DELETE }};\n",
            next_handler("handler")
        );
        both_verbs(
            &route,
            ("known", Some("tenancy_check:claim:.orgId"), None),
            &body,
        );
    }

    let dir = express_app(
        r#"app.all("/local/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  const sameOrg = () => {
    if (rule.orgId !== req.user.orgId) throw new Error("forbidden", { cause: 403 });
  };
  if (req.method === "DELETE") {
    sameOrg();
    await prisma.rule.delete({ where: { id: rule.id } });
  }
  res.json(rule);
});
app.get("/called/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  function sameOrg() {
    if (rule.orgId !== req.user.orgId) throw new Error("forbidden", { cause: 403 });
  }
  sameOrg();
  res.json(rule);
});
"#,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "ALL /local/:id"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(said(&c, "GET /called/:id").0, "known");
}

/// [STRICT] A table of functions by method, built in the handler and picked with
/// `table[req.method]()`: the function that checks runs for its own method. Its
/// comparison read `known` for every verb. The same for a method of an object
/// literal, and for a function assigned to a member.
#[test]
fn a_check_in_a_function_kept_in_a_table_is_found_not_proven() {
    for check in [NEXT_INLINE, "assertSameOrg(session, rule);"] {
        let route = format!(
            r#"{}  const table: Record<string, () => Promise<NextResponse>> = {{
    GET: async () => NextResponse.json(rule),
    DELETE: async () => {{
      {check}
      await prisma.rule.delete({{ where: {{ id: rule.id }} }});
      return new NextResponse(null, {{ status: 204 }});
    }},
  }};
  return table[req.method]();
}}
export {{ handler as GET, handler as DELETE }};
"#,
            next_handler("handler")
        );
        both_verbs(
            &route,
            ("unknown", Some("check_not_proven"), Some("under_branch")),
            check,
        );
    }
    let dir = express_app(
        r#"app.all("/method/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  const ops = {
    async remove() {
      if (rule.orgId !== req.user.orgId) throw new Error("forbidden", { cause: 403 });
      await prisma.rule.delete({ where: { id: rule.id } });
    },
  };
  if (req.method === "DELETE") await ops.remove();
  res.json(rule);
});
app.all("/assigned/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  const ops: Record<string, () => void> = {};
  ops.DELETE = () => {
    if (rule.orgId !== req.user.orgId) throw new Error("forbidden", { cause: 403 });
  };
  ops[req.method]?.();
  res.json(rule);
});
"#,
    );
    let c = concern(dir.path(), "authz");
    for route in ["ALL /method/:id", "ALL /assigned/:id"] {
        assert_eq!(
            said(&c, route),
            ("unknown", Some("check_not_proven"), Some("under_branch")),
            "{route}"
        );
    }
}

// ---- Whose the two sides of a TypeScript comparison are -------------------------

/// [STRICT] `rule.orgId !== req.query.orgId`, `params.orgId !== body.orgId`, a row
/// against a header: nothing of the caller is compared, and a caller of any tenant
/// passes by sending the value. TypeScript recorded what the other side is read
/// from (`param:req`) without the member path, so `req.query.orgId` read as
/// `req.user.orgId` does, and a side that could not be read counted as the
/// caller's: `known tenancy check`. One side must be read off the caller.
#[test]
fn a_typescript_comparison_with_nothing_of_the_caller_is_found_not_proven() {
    let dir = express_app(
        r#"app.get("/query/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (rule.orgId !== req.query.orgId) return res.status(404).json({ error: "not found" });
  res.json(rule);
});
app.get("/caller/:id", requireUser, async (req, res) => {
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: req.params.id } });
  if (rule.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rule);
});
app.put("/owner/:id", requireUser, async (req, res) => {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id } });
  if (post.ownerId !== req.body.userId) return res.status(403).json({ error: "forbidden" });
  res.json(post);
});
app.post("/role-sent", requireUser, async (req, res) => {
  if (req.body.role !== "admin") return res.status(403).json({ error: "forbidden" });
  res.json(await prisma.rule.findMany());
});
app.post("/role", requireUser, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  res.json(await prisma.rule.findMany());
});
"#,
    );
    let c = concern(dir.path(), "authz");
    for route in ["GET /query/:id", "PUT /owner/:id", "POST /role-sent"] {
        assert_eq!(
            said(&c, route),
            (
                "unknown",
                Some("check_not_proven"),
                Some("sides_not_caller_and_resource")
            ),
            "{route}"
        );
    }
    // The controls: the caller's tenant, the caller's role.
    assert_eq!(
        said(&c, "GET /caller/:id"),
        ("known", Some("tenancy_check:param:req"), None)
    );
    assert_eq!(said(&c, "POST /role").0, "known");

    for (compare, path) in [
        (
            "params.orgId !== body.orgId",
            "app/api/orgs/[orgId]/rules/route.ts",
        ),
        (
            r#"rule.orgId !== req.headers.get("x-org-id")"#,
            "app/api/orgs/[orgId]/rules/route.ts",
        ),
        (
            "rule.orgId !== params.orgId",
            "app/api/orgs/[orgId]/rules/route.ts",
        ),
        (
            "session.orgId !== params.orgId",
            "app/api/orgs/[orgId]/rules/route.ts",
        ),
    ] {
        let route = format!(
            r#"import {{ NextRequest, NextResponse }} from "next/server";
import {{ getSession }} from "@/lib/session";
import {{ prisma }} from "@/lib/db";
export async function POST(req: NextRequest, {{ params }}: {{ params: {{ orgId: string }} }}) {{
  const session = await getSession();
  if (!session) return NextResponse.json({{ error: "Unauthorized" }}, {{ status: 401 }});
  const body = await req.json();
  const rule = await prisma.rule.findUniqueOrThrow({{ where: {{ id: body.id }} }});
  if ({compare}) return NextResponse.json({{ error: "Forbidden" }}, {{ status: 403 }});
  return NextResponse.json(rule);
}}
"#
        );
        let dir = next_app("export {};\n");
        let p = dir.path().join("web").join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, route).unwrap();
        let c = concern(dir.path(), "authz");
        let got = said(&c, "POST");
        if compare.starts_with("session.") {
            assert_eq!(got.0, "known", "{compare}");
        } else {
            assert_eq!(
                got,
                (
                    "unknown",
                    Some("check_not_proven"),
                    Some("sides_not_caller_and_resource")
                ),
                "{compare}"
            );
        }
    }
}

// ---- A sibling method called through `this` ---------------------------------------

/// A NestJS controller whose `DELETE /rules/:id` calls `RulesService.remove(user,
/// id)`, a service with a private `assertSameOrg`, and this body of `remove`.
fn nest_service(remove: &str, check_async: bool) -> tempfile::TempDir {
    let service = format!(
        r#"import {{ ForbiddenException, Injectable }} from "@nestjs/common";
import {{ PrismaService }} from "./prisma.service";
@Injectable()
export class RulesService {{
  constructor(private readonly prisma: PrismaService) {{}}
  private {}assertSameOrg(user: {{ orgId: string }}, rule: {{ orgId: string }}) {{
    if (rule.orgId !== user.orgId) throw new ForbiddenException();
  }}
  async remove(user: {{ orgId: string; role: string }}, id: string) {{
{remove}
  }}
}}
"#,
        if check_async { "async " } else { "" }
    );
    repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/prisma.service.ts",
            r#"import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
@Injectable()
export class PrismaService extends PrismaClient {}
"#,
        ),
        (
            "src/auth.guard.ts",
            r#"import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    req.user = decode(req.headers.authorization);
    return true;
  }
}
"#,
        ),
        (
            "src/rules.controller.ts",
            r#"import { Controller, Delete, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RulesService } from "./rules.service";
@Controller("rules")
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}
  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any) {
    return this.rules.remove(req.user, id);
  }
}
"#,
        ),
        ("src/rules.service.ts", &service),
    ])
}

/// [STRICT] `if (user.role !== "support") this.assertSameOrg(user, rule);` in a
/// service method: the sibling method was listed among the method's calls with no
/// word of the branch, and the route read `known tenancy check`. The same after a
/// return that serves, in a callback under a branch, through a local function called
/// under a branch, and for an `async` sibling whose promise is dropped.
#[test]
fn a_sibling_method_called_only_for_some_requests_is_found_not_proven() {
    let load = "    const rule = await this.prisma.rule.findUniqueOrThrow({ where: { id } });\n";
    for (body, check_async, obligation) in [
        (
            r#"    if (user.role !== "support") this.assertSameOrg(user, rule);
    return rule;"#,
            false,
            "under_branch",
        ),
        (
            "    if (rule.public) return rule;\n    this.assertSameOrg(user, rule);\n    return rule;",
            false,
            "after_conditional_return",
        ),
        (
            r#"    if (rule.locked) {
      await this.prisma.$transaction(async () => {
        this.assertSameOrg(user, rule);
      });
    }
    return rule;"#,
            false,
            "under_branch",
        ),
        (
            r#"    const check = () => this.assertSameOrg(user, rule);
    if (rule.locked) check();
    return rule;"#,
            false,
            "under_branch",
        ),
        (
            "    this.assertSameOrg(user, rule);\n    return rule;",
            true,
            "not_awaited",
        ),
    ] {
        let dir = nest_service(&format!("{load}{body}"), check_async);
        let c = concern(dir.path(), "authz");
        assert_eq!(
            said(&c, "DELETE /rules/:id"),
            ("unknown", Some("check_not_proven"), Some(obligation)),
            "{body}"
        );
    }
    // The control: called for every request, before the row is handed back.
    let dir = nest_service(
        &format!("{load}    this.assertSameOrg(user, rule);\n    return rule;"),
        false,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE /rules/:id"),
        ("known", Some("tenancy_check:param:user"), None)
    );

    // A static method's sibling, from Express.
    let dir = express_app(
        r#"class Rules {
  static assertSameOrg(user: { orgId: string }, rule: { orgId: string }) {
    if (rule.orgId !== user.orgId) throw Object.assign(new Error("forbidden"), { status: 403 });
  }
  static async read(user: { orgId: string; role: string }, id: string) {
    const rule = await prisma.rule.findUniqueOrThrow({ where: { id } });
    if (user.role !== "support") this.assertSameOrg(user, rule);
    return rule;
  }
  static async readChecked(user: { orgId: string; role: string }, id: string) {
    const rule = await prisma.rule.findUniqueOrThrow({ where: { id } });
    this.assertSameOrg(user, rule);
    return rule;
  }
}
app.get("/some/:id", requireUser, async (req, res) => {
  res.json(await Rules.read(req.user, req.params.id));
});
app.get("/every/:id", requireUser, async (req, res) => {
  res.json(await Rules.readChecked(req.user, req.params.id));
});
"#,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "GET /some/:id"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    assert_eq!(said(&c, "GET /every/:id").0, "known");
}

/// [STRICT] The check is in a helper, and the method that calls it deletes the row
/// first: `const rule = await this.prisma.rule.delete(...); this.assertSameOrg(user,
/// rule);`. A function's calls were held in order and a method's were not, so the
/// helper's comparison read `known` though it refuses after the row is gone. In a
/// NestJS service, in a static method that calls a plain function, and in a Python
/// service method.
#[test]
fn a_check_in_a_helper_a_method_calls_after_a_write_is_found_not_proven() {
    let dir = nest_service(
        r#"    const rule = await this.prisma.rule.delete({ where: { id } });
    this.assertSameOrg(user, rule);
    return rule;"#,
        false,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    // The control: the row is read, checked, then deleted.
    let dir = nest_service(
        r#"    const rule = await this.prisma.rule.findUniqueOrThrow({ where: { id } });
    this.assertSameOrg(user, rule);
    return this.prisma.rule.delete({ where: { id } });"#,
        false,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "DELETE /rules/:id").0, "known");

    let dir = express_app(
        r#"function assertSameOrg(user: { orgId: string }, rule: { orgId: string }) {
  if (rule.orgId !== user.orgId) throw Object.assign(new Error("forbidden"), { status: 403 });
}
class Rules {
  static async remove(user: { orgId: string }, id: string) {
    const rule = await prisma.rule.delete({ where: { id } });
    assertSameOrg(user, rule);
    return rule;
  }
}
app.delete("/rules/:id", requireUser, async (req, res) => {
  res.json(await Rules.remove(req.user, req.params.id));
});
"#,
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "DELETE /rules/:id"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );

    let service = |remove: &str| {
        let rules = format!(
            r#"from fastapi import APIRouter, Depends, HTTPException

from app import repo
from app.deps import get_caller

router = APIRouter()


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def _assert_same_org(self, rule):
        if rule.org_id != self.caller.org_id:
            raise HTTPException(status_code=403, detail="forbidden")

    def remove(self, rule_id):
        rule = repo.get_rule(rule_id)
{remove}
        return rule


def get_service(caller=Depends(get_caller)):
    return RuleBook(caller)


@router.delete("/rules/{{rule_id}}")
def delete_rule(rule_id: int, service: RuleBook = Depends(get_service)):
    return service.remove(rule_id)
"#
        );
        repo(&[
            (
                "svc/pyproject.toml",
                "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n",
            ),
            ("svc/app/__init__.py", ""),
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
            ("svc/app/api/__init__.py", ""),
            ("svc/app/api/rules.py", &rules),
            (
                "svc/app/main.py",
                "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
            ),
        ])
    };
    let dir = service("        repo.delete_rule(rule_id)\n        self._assert_same_org(rule)");
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "delete_rule"),
        ("unknown", Some("check_not_proven"), Some("after_effect")),
    );
    let dir = service("        self._assert_same_org(rule)\n        repo.delete_rule(rule_id)");
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "delete_rule").0, "known");
}

// ---- A scoped query behind a receiver the facts did not follow -------------------

/// A NestJS app whose `GET /rules` hands the caller to `RulesService.list`, with
/// this controller (the plain one when `None`), this service and these other files.
fn nest_list(controller: Option<&str>, service: &str, extra: &[(&str, &str)]) -> tempfile::TempDir {
    const CONTROLLER: &str = r#"import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RulesService } from "./rules.service";
@Controller("rules")
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}
  @Get()
  list(@Req() req: any) {
    return this.rules.list(req.user);
  }
}
"#;
    let mut files = vec![
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/prisma.service.ts",
            r#"import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
@Injectable()
export class PrismaService extends PrismaClient {}
"#,
        ),
        (
            "src/auth.guard.ts",
            r#"import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    return true;
  }
}
"#,
        ),
        ("src/rules.controller.ts", controller.unwrap_or(CONTROLLER)),
        ("src/rules.service.ts", service),
    ];
    files.extend_from_slice(extra);
    repo(&files)
}

/// A NestJS service whose `list(user)` is this body, with these constructor
/// parameters and imports.
fn rules_service(imports: &str, ctor: &str, list: &str) -> String {
    format!(
        r#"import {{ Injectable }} from "@nestjs/common";
import {{ PrismaService }} from "./prisma.service";
{imports}
@Injectable()
export class RulesService {{
  constructor({ctor}) {{}}
  list(user: {{ orgId: string }}) {{
    {list}
  }}
}}
"#
    )
}

/// [STRICT] A NestJS controller hands the caller to its service and the service
/// filters the query by the caller's tenant, where the facts did not follow the
/// call: the scoped query is in a method of a base class (`this.scoped(orgId)`),
/// behind a getter, on a query builder or a model the property's type does not name
/// (`this.knex("rules").where({ org_id })`, `model: typeof Rule`), or the service is
/// injected in a base controller, typed with `import type`, or looked up in the
/// container (`this.moduleRef.get(RulesService)`). Each read `none`: "no tenant
/// scope", of a route that has one.
#[test]
fn a_scoped_query_behind_a_receiver_the_facts_did_not_follow_is_never_a_none() {
    let prisma = "private readonly prisma: PrismaService";
    let plain = rules_service(
        "",
        prisma,
        "return this.prisma.rule.findMany({ where: { orgId: user.orgId } });",
    );
    let cases: Vec<(&str, tempfile::TempDir)> = vec![
        (
            "a base class's method",
            nest_list(
                None,
                r#"import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenantService } from "./base.service";
@Injectable()
export class RulesService extends TenantService {
  constructor(prisma: PrismaService) { super(prisma); }
  list(user: { orgId: string }) {
    return this.scoped(user.orgId);
  }
}
"#,
                &[(
                    "src/base.service.ts",
                    r#"import { PrismaService } from "./prisma.service";
export abstract class TenantService {
  constructor(protected readonly prisma: PrismaService) {}
  protected scoped(orgId: string) {
    return this.prisma.rule.findMany({ where: { orgId } });
  }
}
"#,
                )],
            ),
        ),
        (
            "a getter",
            nest_list(
                None,
                &rules_service(
                    "",
                    prisma,
                    "return this.table.findMany({ where: { orgId: user.orgId } });\n  }\n  private get table() {\n    return this.prisma.rule;",
                ),
                &[],
            ),
        ),
        (
            "a query builder the property's type does not name",
            nest_list(
                None,
                &rules_service(
                    r#"import { Inject } from "@nestjs/common";"#,
                    r#"@Inject("KNEX") private readonly knex: any"#,
                    r#"return this.knex("rules").where({ org_id: user.orgId });"#,
                ),
                &[],
            ),
        ),
        (
            "a model typed `typeof Rule`",
            nest_list(
                None,
                &rules_service(
                    "import { InjectModel } from \"@nestjs/sequelize\";\nimport { Rule } from \"./rule.model\";",
                    "@InjectModel(Rule) private readonly model: typeof Rule",
                    "return this.model.findAll({ where: { orgId: user.orgId } });",
                ),
                &[(
                    "src/rule.model.ts",
                    "import { Column, Model, Table } from \"sequelize-typescript\";\n@Table\nexport class Rule extends Model {\n  @Column orgId: string;\n}\n",
                )],
            ),
        ),
        (
            "a service injected in a base controller",
            nest_list(
                Some(
                    r#"import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { BaseController } from "./base.controller";
@Controller("rules")
@UseGuards(AuthGuard)
export class RulesController extends BaseController {
  @Get()
  list(@Req() req: any) {
    return this.rules.list(req.user);
  }
}
"#,
                ),
                &plain,
                &[(
                    "src/base.controller.ts",
                    "import { RulesService } from \"./rules.service\";\nexport abstract class BaseController {\n  constructor(protected readonly rules: RulesService) {}\n}\n",
                )],
            ),
        ),
        (
            "a service typed with `import type`",
            nest_list(
                Some(
                    r#"import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import type { RulesService } from "./rules.service";
@Controller("rules")
@UseGuards(AuthGuard)
export class RulesController {
  constructor(@Inject("RULES") private readonly rules: RulesService) {}
  @Get()
  list(@Req() req: any) {
    return this.rules.list(req.user);
  }
}
"#,
                ),
                &plain,
                &[],
            ),
        ),
        (
            "a service looked up in the container",
            nest_list(
                Some(
                    r#"import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { RulesService } from "./rules.service";
@Controller("rules")
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly moduleRef: ModuleRef) {}
  @Get()
  list(@Req() req: any) {
    return this.moduleRef.get(RulesService).list(req.user);
  }
}
"#,
                ),
                &plain,
                &[],
            ),
        ),
    ];
    for (what, dir) in &cases {
        let c = concern(dir.path(), "authz");
        assert_eq!(said(&c, "GET /rules").0, "unknown", "{what}");
    }
    // The control: a service that reads every row, through a property that holds a
    // plain value, is a recorded absence still.
    let dir = nest_list(
        None,
        &rules_service(
            "",
            prisma,
            "this.seen.push(\"listed\");\n    return this.prisma.rule.findMany({ orderBy: { id: \"asc\" } });\n  }\n  private seen: string[] = [];\n  private noop() {",
        ),
        &[],
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "GET /rules").0, "none");
    // The same service keeping the caller's organisation in a property: a value
    // of the caller handed to a call that nothing classifies as no scope (what the
    // class does with what it keeps is not followed) is not a recorded absence.
    let dir = nest_list(
        None,
        &rules_service(
            "",
            prisma,
            "this.seen.push(user.orgId);\n    return this.prisma.rule.findMany({ orderBy: { id: \"asc\" } });\n  }\n  private seen: string[] = [];\n  private noop() {",
        ),
        &[],
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "GET /rules").0, "unknown");
}

/// [STRICT] The same for a plain class used from Next.js and from Express, reached
/// through a local that is another name for what a module binds: `const svc =
/// services.rules; svc.list(session.orgId)`, a destructured binding, a module
/// loaded with `import()`, a module-level alias. The call was in no fact, and the
/// route read `none`. A method of a value the body built is still nothing
/// (`rows.map(...)`).
#[test]
fn a_service_called_through_another_name_for_a_modules_binding_is_never_a_none() {
    const SERVICE: &str = r#"import { prisma } from "@/lib/db";
export class RuleBook {
  list(orgId: string) {
    return prisma.rule.findMany({ where: { orgId } });
  }
}
export const ruleService = new RuleBook();
"#;
    const SERVICES: &str = "import { RuleBook } from \"@/lib/rule-service\";\nexport const services = { rules: new RuleBook() };\n";
    for (imports, body, want) in [
        (
            r#"import { services } from "@/lib/services";"#,
            "const svc = services.rules;\n  return NextResponse.json(await svc.list(session.orgId));",
            "unknown",
        ),
        (
            r#"import { services } from "@/lib/services";"#,
            "const { rules } = services;\n  return NextResponse.json(await rules.list(session.orgId));",
            "unknown",
        ),
        (
            "",
            "const { ruleService } = await import(\"@/lib/rule-service\");\n  return NextResponse.json(await ruleService.list(session.orgId));",
            "unknown",
        ),
        (
            "",
            "const mod = await import(\"@/lib/rule-service\");\n  return NextResponse.json(await mod.ruleService.list(session.orgId));",
            "unknown",
        ),
        (
            "import { services } from \"@/lib/services\";\nconst svc = services.rules;",
            "return NextResponse.json(await svc.list(session.orgId));",
            "unknown",
        ),
        (
            r#"import { services } from "@/lib/services";"#,
            "let svc;\n  svc = services.rules;\n  return NextResponse.json(await svc.list(session.orgId));",
            "unknown",
        ),
        // The control: methods of what the body itself built.
        (
            "",
            "const rows = await prisma.rule.findMany();\n  const names = rows.filter((r) => r.name).map((r) => r.name);\n  return NextResponse.json(names.join(\",\"));",
            "none",
        ),
    ] {
        let route = format!(
            r#"import {{ NextRequest, NextResponse }} from "next/server";
import {{ getSession }} from "@/lib/session";
import {{ prisma }} from "@/lib/db";
{imports}
export async function GET(req: NextRequest) {{
  const session = await getSession();
  if (!session) return NextResponse.json({{ error: "Unauthorized" }}, {{ status: 401 }});
  {body}
}}
"#
        );
        let dir = next_app(&route);
        for (rel, text) in [
            ("lib/rule-service.ts", SERVICE),
            ("lib/services.ts", SERVICES),
        ] {
            std::fs::write(dir.path().join("web").join(rel), text).unwrap();
        }
        let c = concern(dir.path(), "authz");
        assert_eq!(said(&c, "GET").0, want, "{body}");
    }

    let dir = repo(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "express": "4.19.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/service.ts",
            r#"import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export class RuleBook {
  list(orgId: string) {
    return prisma.rule.findMany({ where: { orgId } });
  }
}
export const services = { rules: new RuleBook() };
"#,
        ),
        (
            "src/server.ts",
            r#"import express from "express";
import { services } from "./service";
const app = express();
function requireUser(req, res, next) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  next();
}
app.get("/alias", requireUser, async (req, res) => {
  const { rules } = services;
  res.json(await rules.list(req.user.orgId));
});
app.get("/plain", requireUser, async (req, res) => {
  const seen = new Set<string>();
  seen.add(String(req.query.page));
  res.json([...seen]);
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "GET /alias").0, "unknown");
    assert_eq!(said(&c, "GET /plain").0, "none");
}

// ---- Authentication: what runs before a route and is written somewhere else -------

const EXPRESS_PACKAGE: &str =
    "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n";
const EXPRESS_GUARD: &str = r#"import type { NextFunction, Request, Response } from "express";
export function requireToken(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  next();
}
"#;
const EXPRESS_ITEMS: &str = r#"import { Router } from "express";
export const router = Router();
router.get("/items", (req, res) => {
  res.json([]);
});
"#;
const HONO_PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"hono\": \"4.6.0\" } }\n";
const HONO_GUARD: &str = r#"import { createMiddleware } from "hono/factory";
export const requireEditor = createMiddleware(async (c, next) => {
  if (!c.req.header("authorization")) return c.json({ error: "unauthenticated" }, 401);
  await next();
});
"#;
const FASTIFY_GUARD: &str = r#"import type { FastifyReply, FastifyRequest } from "fastify";
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!request.headers.authorization) {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}
"#;

/// A Fastify server with `authenticate` in `src/auth.ts` and this `src/server.ts`
/// after the instance `app` is built.
fn fastify_app(server: &str, dependencies: &str) -> tempfile::TempDir {
    let package = format!(
        "{{ \"name\": \"api\", \"dependencies\": {{ \"fastify\": \"5.0.0\"{dependencies} }} }}\n"
    );
    let server = format!(
        "import Fastify from \"fastify\";\nimport {{ authenticate }} from \"./auth\";\nconst app = Fastify();\n{server}\napp.listen({{ port: 3000 }});\n"
    );
    repo(&[
        ("package.json", &package),
        ("src/auth.ts", FASTIFY_GUARD),
        ("src/server.ts", &server),
    ])
}

/// What the map says of authentication for the unit at `route`.
fn authn_at<'a>(c: &'a Value, route: &str) -> (&'a str, Option<&'a str>) {
    let u = c["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["route"] == route)
        .unwrap_or_else(|| panic!("no unit at {route}: {:#}", c["units"]));
    let assignment = u["assignment"].as_str().unwrap();
    let what = match assignment {
        "known" => u["key"].as_str().or_else(|| {
            c["variants"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == u["variant"])
                .and_then(|v| v["key"].as_str())
        }),
        "unknown" => u["reason"].as_str(),
        _ => None,
    };
    (assignment, what)
}

/// [STRICT] A middleware given for a path runs for the router mounted under that
/// path: Hono `app.use("/staff/*", requireEditor)` before `app.route(
/// "/staff/articles", sub)`, and `v1.use("*", requireEditor)` where `v1` mounts
/// `cache` and is itself mounted. The mounted routes read `none`: only routes
/// registered on the same instance took what it was given for a path. The same in
/// Express, for a path and for a middleware written in place. A router mounted
/// before the middleware, or under another path, has none.
#[test]
fn a_middleware_given_for_a_path_guards_the_router_mounted_under_it() {
    let dir = repo(&[
        ("package.json", HONO_PACKAGE),
        ("src/auth.ts", HONO_GUARD),
        (
            "src/articles.ts",
            "import { Hono } from \"hono\";\nexport const sub = new Hono();\nsub.get(\"/\", (c) => c.json([]));\n",
        ),
        (
            "src/cache.ts",
            "import { Hono } from \"hono\";\nexport const cache = new Hono();\ncache.get(\"/stats\", (c) => c.json({}));\n",
        ),
        (
            "src/app.ts",
            r#"import { Hono } from "hono";
import { requireEditor } from "./auth";
import { sub } from "./articles";
import { cache } from "./cache";
const app = new Hono();
const v1 = new Hono();
v1.use("*", requireEditor);
v1.route("/cache", cache);
app.route("/v1", v1);
app.use("/staff/*", requireEditor);
app.route("/staff/articles", sub);
app.route("/public/articles", sub);
export default app;
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    let guard = Some("middleware:src/auth.ts#requireEditor");
    assert_eq!(authn_at(&c, "/staff/articles"), ("known", guard));
    assert_eq!(authn_at(&c, "/v1/cache/stats"), ("known", guard));
    assert_eq!(authn_at(&c, "/public/articles").0, "none");

    let dir = repo(&[
        ("package.json", EXPRESS_PACKAGE),
        ("src/auth.ts", EXPRESS_GUARD),
        ("src/items.ts", EXPRESS_ITEMS),
        (
            "src/app.ts",
            r#"import express from "express";
import { requireToken } from "./auth";
import { router } from "./items";
export const app = express();
app.use("/early", router);
app.use("/staff", requireToken);
app.use("/staff/api", router);
app.use("/open", router);
export const inner = express();
inner.use((req, res, next) => {
  if (!req.headers.cookie) return res.status(401).end();
  next();
});
inner.use("/inner", router);
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        authn_at(&c, "/staff/api/items"),
        ("known", Some("middleware:src/auth.ts#requireToken"))
    );
    assert_eq!(authn_at(&c, "/inner/items").0, "known");
    for open in ["/early/items", "/open/items"] {
        assert_eq!(authn_at(&c, open).0, "none", "{open}");
    }
}

/// [STRICT] An application handed to a function goes where what is registered on it
/// is not read: `setupAuth(admin)` (a helper of the repository that calls
/// `app.use(requireToken)` on its parameter) and `protect(admin)` (a package's).
/// The routes mounted on it afterwards read `none`. They are unknown, softly; the
/// application beside it that went nowhere is still without a guard, and so is one
/// only handed to what starts a server on it.
#[test]
fn an_application_handed_to_a_function_is_never_without_a_guard() {
    for (import, call) in [
        (
            "import { setupAuth } from \"./setup\";",
            "setupAuth(admin);",
        ),
        ("import { protect } from \"corp-auth\";", "protect(admin);"),
    ] {
        let app = format!(
            r#"import express from "express";
import http from "node:http";
import {{ router }} from "./items";
{import}
export const admin = express();
export const pub = express();
{call}
admin.use("/admin", router);
admin.get("/direct", (req, res) => {{
  res.json([]);
}});
pub.use("/public", router);
http.createServer(pub).listen(3000);
pub.get("/started", (req, res) => {{
  res.json([]);
}});
"#
        );
        let dir = repo(&[
            ("package.json", EXPRESS_PACKAGE),
            ("src/auth.ts", EXPRESS_GUARD),
            ("src/items.ts", EXPRESS_ITEMS),
            (
                "src/setup.ts",
                "import type { Express } from \"express\";\nimport { requireToken } from \"./auth\";\nexport function setupAuth(app: Express) {\n  app.use(requireToken);\n}\n",
            ),
            ("src/app.ts", &app),
        ]);
        let c = concern(dir.path(), "authn");
        // The helper of the repository is read ([`a_helper_that_registers_a_guard_on_
        // the_application_it_is_handed_is_read`]); the package's is not.
        let want = if call.starts_with("setupAuth") {
            "known"
        } else {
            "unknown"
        };
        for route in ["/admin/items", "/direct"] {
            assert_eq!(authn_at(&c, route).0, want, "{call} {route}");
        }
        for route in ["/public/items", "/started"] {
            assert_eq!(authn_at(&c, route).0, "none", "{call} {route}");
        }
    }
}

/// [STRICT] Fastify route options and Hono handlers that are spread into the
/// registration: `app.get("/x", { ...secured }, handler)` where `secured` holds
/// `onRequest: [authenticate]`, `app.get(path, ...handlers)` where `handlers` is
/// `factory.createHandlers(requireEditor, handler)`. What is spread was not read and
/// the route read `none`. It is unknown; options written out are read as before.
///
/// An object literal bound with `const` in the same file, with no computed key and
/// no spread of its own, is read where it is spread: its hooks are the route's,
/// except one that a later property or spread replaces. An imported object, one
/// with a computed key, a `let` and one a later unread spread may replace stay
/// unknown.
#[test]
fn guards_spread_into_a_registration_are_read_or_unknown_never_a_none() {
    let dir = fastify_app(
        r#"import { shared } from "./opts";
const secured = { onRequest: [authenticate] };
const hook = "onRequest";
const computed = { [hook]: authenticate };
let rebound = { onRequest: authenticate };
const plain = { schema: {} };
app.get("/spread", { ...secured }, async () => []);
app.get("/imported", { ...shared, schema: {} }, async () => []);
app.route({ method: "GET", url: "/full", ...secured, handler: async () => [] });
app.get("/computed", { ...computed }, async () => []);
app.get("/rebound", { ...rebound }, async () => []);
app.get("/replaced", { ...secured, onRequest: [] }, async () => []);
app.get("/replaced-by-spread", { ...secured, ...shared }, async () => []);
app.get("/kept", { ...plain, ...secured, schema: {} }, async () => []);
app.get("/plain", { ...plain }, async () => []);
app.get("/written", { onRequest: [authenticate] }, async () => []);
app.get("/open", async () => []);
"#,
        "",
    );
    std::fs::write(
        dir.path().join("src/opts.ts"),
        "import { authenticate } from \"./auth\";\nexport const shared = { preHandler: authenticate };\n",
    )
    .unwrap();
    let c = concern(dir.path(), "authn");
    for route in ["/spread", "/full", "/kept"] {
        assert_eq!(
            authn_at(&c, route),
            ("known", Some("middleware:src/auth.ts#authenticate")),
            "{route}"
        );
    }
    for route in ["/imported", "/computed", "/rebound", "/replaced-by-spread"] {
        assert_eq!(authn_at(&c, route).0, "unknown", "{route}");
    }
    // The hook the spread gave is replaced by an empty one; an object read to the
    // end that holds no hook gives none.
    for route in ["/replaced", "/plain", "/open"] {
        assert_eq!(authn_at(&c, route).0, "none", "{route}");
    }
    assert_eq!(
        authn_at(&c, "/written"),
        ("known", Some("wrap:src/auth.ts#authenticate"))
    );

    let dir = repo(&[
        ("package.json", HONO_PACKAGE),
        ("src/auth.ts", HONO_GUARD),
        (
            "src/handlers.ts",
            "import { createFactory } from \"hono/factory\";\nimport { requireEditor } from \"./auth\";\nconst factory = createFactory();\nexport const shared = factory.createHandlers(requireEditor, (c) => c.json([]));\n",
        ),
        (
            "src/app.ts",
            r#"import { Hono } from "hono";
import { createFactory } from "hono/factory";
import { requireEditor } from "./auth";
import { shared } from "./handlers";
const factory = createFactory();
const handlers = factory.createHandlers(requireEditor, (c) => c.json([]));
const app = new Hono();
app.get("/articles", ...handlers);
app.get("/shared", ...shared);
app.get("/open", (c) => c.json([]));
export default app;
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    for route in ["/articles", "/shared"] {
        assert_eq!(authn_at(&c, route).0, "unknown", "{route}");
    }
    assert_eq!(authn_at(&c, "/open").0, "none");
}

/// [STRICT] A Fastify route declared in full (`app.route({ method, url, handler })`)
/// takes the hooks of its instance as one declared in short does: under a root
/// `onRequest` hook it read `none`. And the instance handed to a package's plugin
/// (`app.register(require("@acme/fastify-sso"))`) may have a hook that was not
/// read: unknown. `@fastify/jwt` only decorates the instance: it guards nothing.
#[test]
fn a_fastify_route_in_full_and_a_packages_plugin_are_read() {
    let dir = fastify_app(
        r#"app.addHook("onRequest", authenticate);
app.route({ method: "GET", url: "/full", handler: async () => [] });
app.get("/short", async () => []);
"#,
        "",
    );
    let c = concern(dir.path(), "authn");
    let guard = Some("middleware:src/auth.ts#authenticate");
    assert_eq!(authn_at(&c, "/full"), ("known", guard));
    assert_eq!(authn_at(&c, "/short"), ("known", guard));

    for (register, want) in [
        (r#"app.register(require("@acme/fastify-sso"));"#, "unknown"),
        (
            "import sso from \"@acme/fastify-sso\";\nawait app.register(sso, { realm: \"x\" });",
            "unknown",
        ),
        (
            "import jwt from \"@fastify/jwt\";\napp.register(jwt, { secret: \"x\" });",
            "none",
        ),
    ] {
        let dir = fastify_app(
            &format!(
                "{register}\napp.get(\"/items\", async () => []);\napp.route({{ method: \"GET\", url: \"/full\", handler: async () => [] }});\n"
            ),
            ", \"@acme/fastify-sso\": \"1.0.0\", \"@fastify/jwt\": \"9.0.0\"",
        );
        let c = concern(dir.path(), "authn");
        for route in ["/items", "/full"] {
            assert_eq!(authn_at(&c, route).0, want, "{register} {route}");
        }
    }
}

// ---- Authentication: routers a function builds or is handed -----------------------

/// [STRICT] The routes of a Fastify plugin function were not entry points, so a hook
/// added in the plugin had nothing to guard in the map. They are listed, under the
/// prefix the plugin is registered with, and take the hooks of their instance: one
/// added in the plugin, one of the instance the plugin is registered on, and one
/// added by a plugin that `fastify-plugin` wraps (its hooks are its parent's),
/// written in place or in a file of its own. A plugin that is not so wrapped keeps
/// its hooks to itself, and a hook added under a condition is not read.
#[test]
fn the_routes_of_a_fastify_plugin_are_listed_under_its_hooks() {
    let plugin = |body: &str| {
        format!(
            "import type {{ FastifyInstance }} from \"fastify\";\nimport {{ authenticate }} from \"./auth\";\nexport default async function plugin(instance: FastifyInstance, opts: {{ strict?: boolean }}) {{\n{body}\n}}\n"
        )
    };
    let dir = fastify_app(
        r#"import fp from "fastify-plugin";
import guarded from "./guarded";
import plain from "./plain";
import wrapped from "./wrapped";
import sometimes from "./sometimes";
import shared from "./shared";
app.register(async (scope) => {
  scope.addHook("onRequest", authenticate);
  scope.get("/inline", async () => []);
  scope.register(wrapped, { prefix: "/w" });
}, { prefix: "/a" });
app.register(guarded, { prefix: "/v1" });
app.register(plain);
app.register(sometimes);
app.get("/before", async () => []);
"#,
        ", \"fastify-plugin\": \"5.0.0\"",
    );
    for (rel, text) in [
        (
            "src/guarded.ts",
            plugin(
                "  instance.addHook(\"preHandler\", authenticate);\n  instance.get(\"/items\", async () => []);",
            ),
        ),
        (
            "src/plain.ts",
            plugin("  instance.get(\"/plain\", async () => []);"),
        ),
        (
            "src/wrapped.ts",
            plugin("  instance.get(\"/wrapped\", async () => []);"),
        ),
        (
            "src/sometimes.ts",
            plugin(
                "  if (opts.strict) {\n    instance.addHook(\"onRequest\", authenticate);\n  }\n  instance.get(\"/sometimes\", async () => []);",
            ),
        ),
    ] {
        std::fs::write(dir.path().join(rel), text).unwrap();
    }
    let c = concern(dir.path(), "authn");
    let guard = Some("middleware:src/auth.ts#authenticate");
    for route in ["/a/inline", "/v1/items", "/a/w/wrapped"] {
        assert_eq!(authn_at(&c, route), ("known", guard), "{route}");
    }
    // A sibling plugin's hook is its own; a hook under a condition may not run.
    assert_eq!(authn_at(&c, "/plain").0, "none");
    assert_eq!(authn_at(&c, "/before").0, "none");
    assert_eq!(authn_at(&c, "/sometimes").0, "unknown");

    // `fastify-plugin`: the hook is the root's, for the routes of the root.
    for register in [
        "import fp from \"fastify-plugin\";\nawait app.register(fp(async (app) => {\n  app.addHook(\"onRequest\", authenticate);\n}));",
        "import authPlugin from \"./plugin\";\napp.register(authPlugin);",
    ] {
        let dir = fastify_app(
            &format!("{register}\napp.get(\"/items\", async () => []);\n"),
            ", \"fastify-plugin\": \"5.0.0\"",
        );
        std::fs::write(
            dir.path().join("src/plugin.ts"),
            "import fp from \"fastify-plugin\";\nimport { authenticate } from \"./auth\";\nexport default fp(async (instance) => {\n  instance.addHook(\"onRequest\", authenticate);\n});\n",
        )
        .unwrap();
        let c = concern(dir.path(), "authn");
        assert_eq!(authn_at(&c, "/items"), ("known", guard), "{register}");
    }
}

/// [STRICT] An Express router built by a factory that takes the guard as a parameter
/// (`makeRouter(requireAuth)`): its routes were not listed at all. They are, under
/// the path the factory's result is mounted at, with the guard unknown: what the
/// factory is handed is not read where the route is registered. A factory that
/// takes none and registers none is without a guard; one that registers a guard it
/// imports has it.
#[test]
fn the_routes_of_a_router_factory_are_listed_with_the_guard_it_is_handed_unknown() {
    let items = |signature: &str, body: &str| {
        format!(
            "import {{ Router, type RequestHandler }} from \"express\";\nimport {{ requireToken }} from \"./auth\";\nexport {signature} {{\n  const router = Router();\n{body}\n  return router;\n}}\n"
        )
    };
    for (factory, call, want) in [
        (
            items(
                "function makeRouter(guard: RequestHandler)",
                "  router.use(guard);\n  router.get(\"/items\", (req, res) => {\n    res.json([]);\n  });",
            ),
            "makeRouter(requireToken)",
            ("unknown", Some("body_unreadable")),
        ),
        (
            items(
                "function makeRouter(guard: RequestHandler)",
                "  router.get(\"/items\", guard, (req, res) => {\n    res.json([]);\n  });",
            ),
            "makeRouter(requireToken)",
            ("unknown", Some("body_unreadable")),
        ),
        (
            items(
                "function makeRouter()",
                "  router.get(\"/items\", (req, res) => {\n    res.json([]);\n  });",
            ),
            "makeRouter()",
            ("none", None),
        ),
        (
            items(
                "function makeRouter()",
                "  router.use(requireToken);\n  router.get(\"/items\", (req, res) => {\n    res.json([]);\n  });",
            ),
            "makeRouter()",
            ("known", Some("wrap:src/auth.ts#requireToken")),
        ),
    ] {
        let app = format!(
            "import express from \"express\";\nimport {{ requireToken }} from \"./auth\";\nimport {{ makeRouter }} from \"./items\";\nconst app = express();\napp.use(\"/api\", {call});\n"
        );
        let dir = repo(&[
            ("package.json", EXPRESS_PACKAGE),
            ("src/auth.ts", EXPRESS_GUARD),
            ("src/items.ts", &factory),
            ("src/app.ts", &app),
        ]);
        let c = concern(dir.path(), "authn");
        assert_eq!(authn_at(&c, "/api/items"), want, "{factory}");
    }
}

/// [STRICT] A helper of the repository that registers a guard on the application it
/// is handed is read: `setupAuth(admin)` where `setupAuth(app: Express) {
/// app.use(requireToken); }`. The guard is that of the routers mounted on the
/// application afterwards. A helper that registers under a condition, or hands the
/// application on, is not read: unknown.
#[test]
fn a_helper_that_registers_a_guard_on_the_application_it_is_handed_is_read() {
    for (helper, want) in [
        ("  app.use(requireToken);", "known"),
        (
            "  if (process.env.AUTH) {\n    app.use(requireToken);\n  }",
            "unknown",
        ),
        ("  other(app);", "unknown"),
        ("  app.disable(\"x-powered-by\");", "none"),
    ] {
        let setup = format!(
            "import type {{ Express }} from \"express\";\nimport {{ requireToken }} from \"./auth\";\nimport {{ other }} from \"corp-auth\";\nexport function setupAuth(app: Express) {{\n{helper}\n}}\n"
        );
        let dir = repo(&[
            ("package.json", EXPRESS_PACKAGE),
            ("src/auth.ts", EXPRESS_GUARD),
            ("src/items.ts", EXPRESS_ITEMS),
            ("src/setup.ts", &setup),
            (
                "src/app.ts",
                "import express from \"express\";\nimport { router } from \"./items\";\nimport { setupAuth } from \"./setup\";\nexport const admin = express();\nexport const pub = express();\nsetupAuth(admin);\nadmin.use(\"/admin\", router);\npub.use(\"/public\", router);\n",
            ),
        ]);
        let c = concern(dir.path(), "authn");
        assert_eq!(authn_at(&c, "/admin/items").0, want, "{helper}");
        assert_eq!(authn_at(&c, "/public/items").0, "none", "{helper}");
    }
}

/// [STRICT] A guard whose only 401 is sent from the `catch` of the token
/// verification: `try { await request.jwtVerify() } catch (err) { reply.code(401)
/// .send() }` used as `onRequest: authenticate`, and in Express `try { jwt.verify(
/// token, secret) } catch { return res.status(401).end() } next()`. A rejection in a
/// `catch` counted for nothing, and the route read `none`. Where the handler answers
/// 401, hands control on nowhere, and the function goes on only past the `try`, it
/// is the sign-in guard. A handler that calls `next()` itself, or one that does not
/// leave before the `next()` that follows, lets the request through.
#[test]
fn a_401_sent_from_the_catch_of_the_verification_is_a_sign_in_guard() {
    let dir = fastify_app(
        r#"app.get("/route", { onRequest: authenticate }, async () => []);
app.get("/open", async () => []);
"#,
        ", \"@fastify/jwt\": \"9.0.0\"",
    );
    std::fs::write(
        dir.path().join("src/auth.ts"),
        r#"import type { FastifyReply, FastifyRequest } from "fastify";
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: "unauthenticated" });
  }
}
"#,
    )
    .unwrap();
    let c = concern(dir.path(), "authn");
    assert_eq!(
        authn_at(&c, "/route"),
        ("known", Some("wrap:src/auth.ts#authenticate"))
    );
    assert_eq!(authn_at(&c, "/open").0, "none");

    let dir = repo(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"jsonwebtoken\": \"9.0.0\" } }\n",
        ),
        (
            "src/auth.ts",
            r#"import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
export function requireToken(req: Request, res: Response, next: NextFunction) {
  try {
    jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    return res.status(401).end();
  }
  next();
}
export function handsOn(req: Request, res: Response, next: NextFunction) {
  try {
    jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    res.status(401);
    return next();
  }
  next();
}
export function fallsThrough(req: Request, res: Response, next: NextFunction) {
  try {
    jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
  } catch {
    res.status(401).json({ error: "unauthenticated" });
  }
  next();
}
"#,
        ),
        (
            "src/app.ts",
            r#"import express from "express";
import { fallsThrough, handsOn, requireToken } from "./auth";
const app = express();
app.get("/guarded", requireToken, (req, res) => {
  res.json([]);
});
app.get("/hands-on", handsOn, (req, res) => {
  res.json([]);
});
app.get("/falls-through", fallsThrough, (req, res) => {
  res.json([]);
});
"#,
        ),
    ]);
    let c = concern(dir.path(), "authn");
    assert_eq!(
        authn_at(&c, "/guarded"),
        ("known", Some("wrap:src/auth.ts#requireToken"))
    );
    for route in ["/hands-on", "/falls-through"] {
        assert_ne!(authn_at(&c, route).0, "known", "{route}");
    }
}

// ---- Authorization behind what a Fastify instance carries -------------------------

/// A Fastify server whose `onRequest` hook signs the operator in, with a Prisma
/// client `prisma`, the `@fastify/postgres` plugin, this `src/service.ts` and these
/// statements after them.
fn fastify_fleet(service: &str, routes: &str) -> tempfile::TempDir {
    let server = format!(
        r#"import Fastify from "fastify";
import pg from "@fastify/postgres";
import {{ DeviceService }} from "./service";
const app = Fastify();
app.register(pg, {{ connectionString: process.env.DATABASE_URL }});
app.addHook("onRequest", async (request, reply) => {{
  if (!request.headers.authorization) return reply.code(401).send({{ error: "unauthenticated" }});
  request.operator = decode(request.headers.authorization);
}});
{routes}
app.listen({{ port: 3000 }});
"#
    );
    repo(&[
        (
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"fastify\": \"5.0.0\", \"@fastify/postgres\": \"6.0.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        ),
        ("src/service.ts", service),
        ("src/server.ts", &server),
    ])
}

const DEVICE_SERVICE: &str = r#"import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export class DeviceService {
  async getChecked(id: string, operator: { fleetId: string }) {
    const device = await prisma.device.findUniqueOrThrow({ where: { id } });
    if (device.fleetId !== operator.fleetId) {
      throw Object.assign(new Error("forbidden"), { statusCode: 403 });
    }
    return device;
  }
}
"#;

/// [STRICT] SQL written as text and scoped by a value of the caller, where the
/// column is not named for a tenant: `app.pg.query("select * from devices where
/// fleet_id = $1", [request.operator.fleetId])`, the same through
/// `request.server.pg` and a client taken from the pool, and a tagged template. The
/// text names no tenant key, so no filter was found and the route read `none`. SQL
/// that filters its rows, given a value read off the caller, may be the scope:
/// unknown. A query with no `where`, or given what the request sent, is not.
#[test]
fn sql_given_a_value_of_the_caller_is_never_a_none() {
    let dir = fastify_fleet(
        DEVICE_SERVICE,
        r#"app.get("/instance", async (request) => {
  const { rows } = await app.pg.query("select * from devices where fleet_id = $1", [request.operator.fleetId]);
  return rows;
});
app.get("/server", async (request) => {
  const { rows } = await request.server.pg.query("select * from devices where fleet_id = $1", [request.operator.fleetId]);
  return rows;
});
app.get("/client", async (request) => {
  const client = await app.pg.connect();
  const { rows } = await client.query("SELECT id FROM devices WHERE fleet_id = $1", [request.operator.fleetId]);
  return rows;
});
app.get("/tagged", async (request) => {
  return app.pg.query(sql`select * from devices where fleet_id = ${request.operator.fleetId}`);
});
app.get("/all", async () => {
  const { rows } = await app.pg.query("select * from devices");
  return rows;
});
app.get("/by-id/:id", async (request) => {
  const { rows } = await app.pg.query("select * from devices where id = $1", [request.params.id]);
  return rows;
});
"#,
    );
    let c = concern(dir.path(), "authz");
    for route in ["/instance", "/server", "/client", "/tagged"] {
        assert_eq!(said(&c, &format!("GET {route}")).0, "unknown", "{route}");
    }
    for route in ["/all", "/by-id/:id"] {
        assert_eq!(said(&c, &format!("GET {route}")).0, "none", "{route}");
    }
}

/// [STRICT] A service reached through a Fastify decoration: `app.decorate("devices",
/// new DeviceService())`, then `request.server.devices.getChecked(id,
/// request.operator)` in the handler, where `getChecked` throws 403 on another
/// fleet. The call was in no fact and the route read `none`. The decoration is
/// followed to the class it built; one that holds what is not read (a package's
/// factory), and what a request carries beside its own plumbing
/// (`request.devices`), is unread. Never a `none`.
#[test]
fn a_service_reached_through_a_fastify_decoration_is_never_a_none() {
    for (decorate, call) in [
        (
            r#"app.decorate("devices", new DeviceService());"#,
            "request.server.devices.getChecked(request.params.id, request.operator)",
        ),
        (
            r#"app.decorate("devices", new DeviceService());"#,
            "app.devices.getChecked(request.params.id, request.operator)",
        ),
        (
            r#"app.decorate("devices", makeDevices());"#,
            "request.server.devices.getChecked(request.params.id, request.operator)",
        ),
        (
            r#"app.decorateRequest("devices", null);"#,
            "request.devices.getChecked(request.params.id, request.operator)",
        ),
    ] {
        let dir = fastify_fleet(
            DEVICE_SERVICE,
            &format!(
                "{decorate}\napp.get(\"/devices/:id\", async (request) => {{\n  const device = {call};\n  return device;\n}});\napp.get(\"/plain\", async (request) => {{\n  request.log.info(\"plain\");\n  return [];\n}});\n"
            ),
        );
        let c = concern(dir.path(), "authz");
        assert_eq!(said(&c, "GET /devices/:id").0, "unknown", "{call}");
        assert_eq!(said(&c, "GET /plain").0, "none", "{call}");
    }
}

// ---- A filter or a policy call only some requests reach ---------------------------

/// [STRICT] A query filtered by the caller's tenant inside a branch of the unit's
/// own body: `if mine: stmt = select(Rule).where(Rule.org_id == caller.org_id)` /
/// `else: stmt = select(Rule)`. The filter was a fact of the body with no word of
/// where, and the route read `known tenancy_filter` though the other requests get
/// every tenant's rows. The same in an arm of a conditional expression, after a
/// return that serves, and for a Flask-SQLAlchemy `filter_by`. A filter every request
/// reaches, with a second one under a branch, is the scope.
#[test]
fn a_query_filtered_under_a_branch_is_found_not_proven() {
    let fastapi = |body: &str| {
        let rules = format!(
            r#"from fastapi import APIRouter, Depends
from sqlalchemy import select

from app import repo
from app.deps import get_caller
from app.models import Rule

router = APIRouter(prefix="/rules")


@router.get("")
async def list_rules(mine: bool = False, caller=Depends(get_caller)):
{body}
"#
        );
        repo(&[
            (
                "svc/pyproject.toml",
                "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n",
            ),
            ("svc/app/__init__.py", ""),
            (
                "svc/app/deps.py",
                "from fastapi import HTTPException, Request\n\n\ndef get_caller(request: Request):\n    if not request.headers.get(\"authorization\"):\n        raise HTTPException(status_code=401, detail=\"unauthenticated\")\n    return request.state.caller\n",
            ),
            (
                "svc/app/repo.py",
                "from sqlalchemy.orm import Session\n\ndb = Session()\n",
            ),
            (
                "svc/app/models.py",
                "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column\n\n\nclass Base(DeclarativeBase):\n    pass\n\n\nclass Rule(Base):\n    __tablename__ = \"rules\"\n    id: Mapped[int] = mapped_column(primary_key=True)\n    org_id: Mapped[str]\n    owner_id: Mapped[str]\n",
            ),
            ("svc/app/api/__init__.py", ""),
            ("svc/app/api/rules.py", &rules),
            (
                "svc/app/main.py",
                "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
            ),
        ])
    };
    for (body, obligation) in [
        (
            "    if mine:\n        stmt = select(Rule).where(Rule.org_id == caller.org_id)\n    else:\n        stmt = select(Rule)\n    return repo.db.execute(stmt).scalars().all()",
            "under_branch",
        ),
        (
            "    stmt = select(Rule).where(Rule.org_id == caller.org_id) if mine else select(Rule)\n    return repo.db.execute(stmt).scalars().all()",
            "under_branch",
        ),
        (
            "    if not mine:\n        return repo.db.execute(select(Rule)).scalars().all()\n    stmt = select(Rule).where(Rule.org_id == caller.org_id)\n    return repo.db.execute(stmt).scalars().all()",
            "after_conditional_return",
        ),
    ] {
        let dir = fastapi(body);
        let c = concern(dir.path(), "authz");
        assert_eq!(
            said(&c, "list_rules"),
            ("unknown", Some("check_not_proven"), Some(obligation)),
            "{body}"
        );
    }
    // The control: scoped for every request, narrowed for some.
    let dir = fastapi(
        "    stmt = select(Rule).where(Rule.org_id == caller.org_id)\n    if mine:\n        stmt = stmt.where(Rule.owner_id == caller.id)\n    return repo.db.execute(stmt).scalars().all()",
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "list_rules"),
        ("known", Some("tenancy_filter:org_id (session)"), None)
    );

    let flask = |body: &str| {
        let app = format!(
            r#"from flask import Flask, jsonify, request
from flask_login import current_user, login_required

from models import Rule

app = Flask(__name__)


@app.get("/rules")
@login_required
def list_rules():
{body}
    return jsonify([r.id for r in rows])
"#
        );
        repo(&[
            (
                "pyproject.toml",
                "[project]\nname = \"svc\"\ndependencies = [\"flask\", \"flask-login\", \"flask-sqlalchemy\"]\n",
            ),
            (
                "models.py",
                "from flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()\n\n\nclass Rule(db.Model):\n    id = db.Column(db.Integer, primary_key=True)\n    org_id = db.Column(db.String)\n",
            ),
            ("app.py", &app),
        ])
    };
    let dir = flask(
        "    if request.args.get(\"mine\"):\n        rows = Rule.query.filter_by(org_id=current_user.org_id).all()\n    else:\n        rows = Rule.query.all()",
    );
    let c = concern(dir.path(), "authz");
    assert_eq!(
        said(&c, "list_rules"),
        ("unknown", Some("check_not_proven"), Some("under_branch")),
    );
    let dir = flask("    rows = Rule.query.filter_by(org_id=current_user.org_id).all()");
    let c = concern(dir.path(), "authz");
    assert_eq!(said(&c, "list_rules").0, "known");
}

/// [STRICT] A policy library's call under a branch, end to end: `if (req.method !==
/// "GET") { ForbiddenError.from(ability).throwUnlessCan("read", rule) }` decides for
/// the requests that take the branch. Called for every request, it is the policy.
#[test]
fn a_policy_library_call_under_a_branch_is_found_not_proven() {
    for (check, want) in [
        (
            "if (req.method !== \"GET\") {\n    ForbiddenError.from(defineAbilityFor(session)).throwUnlessCan(\"read\", rule);\n  }",
            ("unknown", Some("check_not_proven"), Some("under_branch")),
        ),
        (
            "switch (req.method) {\n    case \"DELETE\":\n      ForbiddenError.from(defineAbilityFor(session)).throwUnlessCan(\"delete\", rule);\n  }",
            ("unknown", Some("check_not_proven"), Some("under_branch")),
        ),
    ] {
        let route = format!(
            r#"import {{ NextRequest, NextResponse }} from "next/server";
import {{ ForbiddenError }} from "@casl/ability";
import {{ getSession }} from "@/lib/session";
import {{ prisma }} from "@/lib/db";
import {{ defineAbilityFor }} from "@/lib/ability";
export async function GET(req: NextRequest, {{ params }}: {{ params: {{ id: string }} }}) {{
  const session = await getSession();
  if (!session) return NextResponse.json({{ error: "Unauthorized" }}, {{ status: 401 }});
  const rule = await prisma.rule.findUnique({{ where: {{ id: params.id }} }});
  {check}
  return NextResponse.json(rule);
}}
"#
        );
        let dir = next_app(&route);
        std::fs::write(
            dir.path().join("web/package.json"),
            "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\", \"@prisma/client\": \"5.20.0\", \"@casl/ability\": \"6.0.0\" } }\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("web/lib/ability.ts"),
            "import { AbilityBuilder, createMongoAbility } from \"@casl/ability\";\nexport function defineAbilityFor(session: { orgId: string }) {\n  const { can, build } = new AbilityBuilder(createMongoAbility);\n  can(\"read\", \"Rule\", { orgId: session.orgId });\n  return build();\n}\n",
        )
        .unwrap();
        let c = concern(dir.path(), "authz");
        assert_eq!(said(&c, "GET"), want, "{check}");
    }
    let route = r#"import { NextRequest, NextResponse } from "next/server";
import { ForbiddenError } from "@casl/ability";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { defineAbilityFor } from "@/lib/ability";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await prisma.rule.findUnique({ where: { id: params.id } });
  ForbiddenError.from(defineAbilityFor(session)).throwUnlessCan("read", rule);
  return NextResponse.json(rule);
}
"#;
    let dir = next_app(route);
    std::fs::write(
        dir.path().join("web/package.json"),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\", \"@prisma/client\": \"5.20.0\", \"@casl/ability\": \"6.0.0\" } }\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("web/lib/ability.ts"),
        "import { AbilityBuilder, createMongoAbility } from \"@casl/ability\";\nexport function defineAbilityFor(session: { orgId: string }) {\n  const { can, build } = new AbilityBuilder(createMongoAbility);\n  can(\"read\", \"Rule\", { orgId: session.orgId });\n  return build();\n}\n",
    )
    .unwrap();
    let c = concern(dir.path(), "authz");
    let (assignment, key, _) = said(&c, "GET");
    assert_eq!(assignment, "known");
    assert!(key.is_some_and(|k| k.starts_with("policy:")), "{key:?}");
}

// ---- Surfaces: a check found and not proven ----------------------------------------

/// A unit whose check was found and is not proven is neither a holder of the
/// practice nor a departure from it: four routes check the tenant for every request
/// and a fifth checks it under a branch. The variant has four members, no finding
/// names the fifth as departing, and its card repeats what was found in the one
/// approved wording, never as what the route does.
#[test]
fn a_unit_with_a_found_check_is_neither_a_holder_nor_a_departure() {
    let checked = format!(
        "{}  {NEXT_INLINE}\n  return NextResponse.json(rule);\n}}\nexport {{ handler as GET }};\n",
        next_handler("handler")
    );
    let branched = format!(
        "{}  if (req.method === \"DELETE\") {{\n    {NEXT_INLINE}\n  }}\n  return NextResponse.json(rule);\n}}\nexport {{ handler as DELETE }};\n",
        next_handler("handler")
    );
    let dir = next_app(&checked);
    for name in ["a", "b", "c"] {
        let p = dir.path().join(format!("web/app/api/{name}/[id]/route.ts"));
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, &checked).unwrap();
    }
    let odd = dir.path().join("web/app/api/odd/[id]/route.ts");
    std::fs::create_dir_all(odd.parent().unwrap()).unwrap();
    std::fs::write(odd, &branched).unwrap();

    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(dir.path())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let authz = report["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .unwrap();
    assert_eq!(
        said(authz, "DELETE"),
        ("unknown", Some("check_not_proven"), Some("under_branch"))
    );
    // Not a holder: the practice has the four that are proven.
    let holders: Vec<u64> = authz["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "known")
        .map(|v| v["members"].as_u64().unwrap())
        .collect();
    assert_eq!(holders, [4], "{:#}", authz["variants"]);
    assert_eq!(authz["population"]["unknown"], 1);
    // Not a departure: no finding says the route does otherwise than the others.
    for f in report["findings"].as_array().unwrap() {
        let names_it = f["examples"].as_array().is_some_and(|e| {
            e.iter()
                .any(|x| x["path"] == "web/app/api/odd/[id]/route.ts")
        });
        assert!(
            !(f["concern"] == "authz" && names_it && f["kind"] != "unknown"),
            "{f:#}"
        );
    }
    let text = |args: &[&str]| {
        let out = Command::new(&*BIN)
            .args(args)
            .current_dir(dir.path())
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let check = text(&["--no-cache", "check"]);
    assert!(!check.contains("odd/[id]/route.ts"), "{check}");
    // The card: what was found, in the approved wording, and nothing else of authz.
    let card = text(&["--no-cache", "card", "web/app/api/odd/[id]/route.ts"]);
    let authz_lines: Vec<&str> = card.lines().filter(|l| l.starts_with("  authz:")).collect();
    assert_eq!(
        authz_lines,
        [
            "  authz: DELETE: unknown: a tenant check was found (`orgId`) but is not proven to run on every request: it runs only on some paths (under a branch or in a loop)"
        ],
        "{card}"
    );
    // A file whose routes are proven says the practice, and no such line.
    let card = text(&["--no-cache", "card", "web/app/api/a/[id]/route.ts"]);
    assert!(card.contains("\n  authz: tenancy check"), "{card}");
    assert!(!card.contains("was found"), "{card}");
}
