//! Textbook gaps the practice map must keep reporting, whatever later rules do (the
//! integration defect log's lesson 2), and findings from a monorepo pilot turned into
//! fixtures: a FastAPI dependency that signs callers in only through another
//! dependency is read as that one, and a compose file under `platform/apps/` built
//! from the repository root locates each service by its Dockerfile. In a monorepo of a
//! Next.js app and a FastAPI service, a call in a handler's body is read by one rule in
//! `drift security` and `drift practices` (a guard when it rejects, unknown when it only
//! looks like one, else nothing), each package keeps its own authn policy, and each
//! package's tests test its own routes. Two things the map knows are findings: a key a
//! signed-in caller names that nothing scopes, and a helper copied into two services.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

const CALLER_CONTEXT: &str = r#"from fastapi import HTTPException, Request


def resolve_principal(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return {"org": "x"}
"#;

const SERVICES: &str = r#"from typing import Annotated

from fastapi import Depends

from app.core.principal import resolve_principal


class ForbiddenError(Exception):
    pass


class FolderService:
    def __init__(self, caller):
        self.caller = caller

    async def copy(self, team_id, request):
        await self._ensure_team_access(team_id)
        return {"copied": team_id}

    async def _ensure_team_access(self, team_id):
        if team_id != self.caller["team_id"]:
            raise ForbiddenError("forbidden")


def get_folder_service(caller: Annotated[dict, Depends(resolve_principal)]) -> FolderService:
    return FolderService(caller)


class ReviewService:
    async def review(self, team_id):
        if team_id == "":
            raise ForbiddenError("forbidden")
        return {"reviewed": team_id}


def get_review_service() -> ReviewService:
    return ReviewService()
"#;

fn fastapi_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "platform/apps/ledger-svc/pyproject.toml",
        "[project]\nname = \"ledger-svc\"\ndependencies = [\"fastapi\"]\n",
    );
    let base = "platform/apps/ledger-svc";
    write(r, &format!("{base}/app/__init__.py"), "");
    write(r, &format!("{base}/app/core/__init__.py"), "");
    write(r, &format!("{base}/app/core/principal.py"), CALLER_CONTEXT);
    write(r, &format!("{base}/app/core/services.py"), SERVICES);
    write(r, &format!("{base}/app/api/__init__.py"), "");
    // Eight routes: four with the caller context and the service, four with the
    // service only, one with neither.
    let mut routes = String::from(
        "from fastapi import APIRouter, Depends\n\nfrom app.core.principal import resolve_principal\nfrom app.core.services import ReviewService, FolderService, get_review_service, get_folder_service\n\nrouter = APIRouter(prefix=\"/v2/folders\")\n\n",
    );
    for i in 0..4 {
        routes.push_str(&format!(
            "@router.post(\"/both{i}\")\nasync def both{i}(team_id: str, caller=Depends(resolve_principal), service: FolderService = Depends(get_folder_service)):\n    return await service.copy(team_id, caller)\n\n\n"
        ));
    }
    for i in 0..4 {
        routes.push_str(&format!(
            "@router.post(\"/svc{i}\")\nasync def svc{i}(team_id: str, service: FolderService = Depends(get_folder_service)):\n    return await service.copy(team_id, None)\n\n\n"
        ));
    }
    // One route whose only dependency builds a service that rejects in its methods:
    // not a sign-in, maybe the auth step, so unknown.
    routes.push_str(
        "@router.post(\"/review\")\nasync def review(team_id: str, service: ReviewService = Depends(get_review_service)):\n    return await service.review(team_id)\n\n\n",
    );
    // Not at a probe path: a `GET /health` that reads no input is recorded as open.
    routes.push_str("@router.get(\"/about\")\nasync def about():\n    return {\"ok\": True}\n");
    write(r, &format!("{base}/app/api/folders.py"), &routes);
    write(
        r,
        &format!("{base}/app/main.py"),
        "from fastapi import FastAPI\n\nfrom app.api.folders import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
}

#[test]
fn a_dependency_that_signs_in_through_another_is_read_as_that_one() {
    let dir = fastapi_repo();
    let r = dir.path();
    let v: Value = serde_json::from_str(&drift(r, &["--no-cache", "practices", "--json"])).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .expect("authn concern");
    let variants = authn["variants"].as_array().unwrap();
    let keys: Vec<(String, u64)> = variants
        .iter()
        .filter(|x| x["kind"] == "known")
        .map(|x| {
            (
                x["key"].as_str().unwrap_or("").to_string(),
                x["members"].as_u64().unwrap_or(0),
            )
        })
        .collect();
    // One variant for the eight guarded routes, keyed by the check, not by the service
    // that rides in with it; the route with neither is the recorded absence.
    assert_eq!(keys.len(), 1, "{keys:?}\n{authn:#}");
    assert!(
        keys[0].0.contains("resolve_principal") && !keys[0].0.contains("get_folder_service"),
        "{keys:?}"
    );
    assert_eq!(keys[0].1, 8, "{keys:?}");
    assert_eq!(authn["population"]["none"], 1, "{authn:#}");
    // The route guarded only by a service whose methods reject is unknown, not known
    // and not none.
    assert_eq!(authn["population"]["unknown"], 1, "{authn:#}");
    let unknown = authn["unknown"]["examples"]
        .as_array()
        .map(|a| a.iter().any(|e| e.to_string().contains("review")))
        .unwrap_or(false);
    assert!(unknown, "{:#}", authn["unknown"]);
    // Its reason names the fix: the body of a call could not be read.
    assert_eq!(
        authn["unknown"]["reasons"],
        serde_json::json!([{ "reason": "body_unreadable", "members": 1 }]),
        "{:#}",
        authn["unknown"]
    );
    // Authorization: the handler hands `team_id` to `service.copy()`, a method of
    // the class the parameter is annotated with, and that method's sibling
    // `_ensure_team_access` forbids a team the caller does not hold. The
    // eight routes are a tenancy check, known, not `not_followed`.
    let authz = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .expect("authz concern");
    let known: Vec<(String, u64)> = authz["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["kind"] == "known")
        .map(|x| {
            (
                x["key"].as_str().unwrap_or("").to_string(),
                x["members"].as_u64().unwrap_or(0),
            )
        })
        .collect();
    assert_eq!(known.len(), 1, "{authz:#}");
    // Keyed by the check the service method calls, named for the tenant.
    assert!(
        known[0].0.starts_with("tenancy_check:") && known[0].0.contains("_ensure_team_access"),
        "{known:?}"
    );
    assert_eq!(known[0].1, 8, "{known:?}\n{authz:#}");
    assert_eq!(authz["population"]["unknown"], 0, "{authz:#}");
}

#[test]
fn a_compose_file_under_services_locates_each_service_by_its_dockerfile() {
    let dir = fastapi_repo();
    let r = dir.path();
    write(
        r,
        "platform/apps/docker-compose.yml",
        "services:\n  gateway:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n  ledger-svc:\n    build:\n      context: ../..\n      dockerfile: platform/apps/ledger-svc/Dockerfile\n  runner:\n    build:\n      context: ../..\n",
    );
    write(
        r,
        "platform/apps/ledger-svc/Dockerfile",
        "FROM python:3.12\n",
    );
    // A Next.js app in the same repository, in no compose service.
    write(
        r,
        "frontend/package.json",
        "{ \"name\": \"frontend\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "frontend/app/api/analyze/route.ts",
        "export async function POST(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let by_path = |p: &str| -> Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["path"] == p)
            .cloned()
            .unwrap_or_else(|| panic!("no entry {p}: {:#}", inv["entry_points"]))
    };
    let ledger = by_path("platform/apps/ledger-svc/app/api/folders.py");
    assert_eq!(ledger["exposure"], "internal", "{ledger:#}");
    assert_eq!(
        ledger["boundary"],
        "compose service ledger-svc in platform/apps/docker-compose.yml publishes no ports"
    );
    let front = by_path("frontend/app/api/analyze/route.ts");
    assert_eq!(front["exposure"], "unknown", "{front:#}");
    assert!(front.get("boundary").is_none(), "{front:#}");
    let warnings = inv["boundaries"]["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:#?}");
    assert!(
        warnings[0].as_str().unwrap().starts_with(
            "platform/apps/docker-compose.yml: service runner builds from the repository root"
        ),
        "{warnings:#?}"
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("service runner builds from the repository root"),
        "{text}"
    );
}

/// A Nest controller whose handler hands the tenant id to an injected service; the
/// service's method forbids a tenant the caller does not hold. The member's own checks
/// make authz known, not `body_unreadable`.
#[test]
fn a_nest_service_method_that_forbids_is_the_handlers_tenancy_check() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/passport\": \"10.0.0\" } }",
    );
    write(
        r,
        "src/projects/projects.service.ts",
        "import { ForbiddenException, Injectable } from \"@nestjs/common\";\n\n@Injectable()\nexport class ProjectsService {\n  constructor(private readonly session: { orgId: string }) {}\n\n  list(orgId: string) {\n    if (orgId !== this.session.orgId) {\n      throw new ForbiddenException();\n    }\n    return [];\n  }\n}\n",
    );
    let mut controller = String::from(
        "import { Controller, Get, Param, UseGuards } from \"@nestjs/common\";\nimport { AuthGuard } from \"@nestjs/passport\";\nimport { ProjectsService } from \"./projects.service\";\n\n@Controller(\"projects\")\n@UseGuards(AuthGuard(\"jwt\"))\nexport class ProjectsController {\n  constructor(private readonly projects: ProjectsService) {}\n",
    );
    for i in 0..8 {
        controller.push_str(&format!(
            "\n  @Get(\"r{i}/:orgId\")\n  r{i}(@Param(\"orgId\") orgId: string) {{\n    return this.projects.list(orgId);\n  }}\n"
        ));
    }
    controller.push_str("}\n");
    write(r, "src/projects/projects.controller.ts", &controller);
    let v: Value = serde_json::from_str(&drift(r, &["--no-cache", "practices", "--json"])).unwrap();
    let authz = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .expect("authz concern");
    assert_eq!(authz["population"]["total"], 8, "{authz:#}");
    assert_eq!(authz["population"]["unknown"], 0, "{authz:#}");
    let known: Vec<(String, u64)> = authz["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["kind"] == "known")
        .map(|x| {
            (
                x["key"].as_str().unwrap_or("").to_string(),
                x["members"].as_u64().unwrap_or(0),
            )
        })
        .collect();
    assert_eq!(known.len(), 1, "{authz:#}");
    assert!(known[0].0.contains("tenancy_check"), "{known:?}");
    assert_eq!(known[0].1, 8, "{known:?}");
}

// A Next.js app beside a FastAPI service, as in the owner's monorepo. Each has three
// helpers its routes share: one that turns the caller away with a 401
// (`requireSession`, `require_caller`), one named for access that throws a plain
// error (`assertSession`, `require_tenant`), so only being shared, throwing and the
// name say it guards, and one that throws for reasons of its own (`parseBody`,
// `load_run`).

const PARSE_BODY: &str = "export async function parseBody(req: Request) {\n  const body = await req.json();\n  if (!body) {\n    throw new Error(\"empty body\");\n  }\n  return body;\n}\n";
const SESSION: &str = "export function requireSession(req: Request) {\n  if (!req.headers.get(\"cookie\")) {\n    throw new Response(\"Unauthorized\", { status: 401 });\n  }\n}\n\nexport function assertSession(req: Request) {\n  if (!req.headers.get(\"cookie\")) {\n    throw new Error(\"no session\");\n  }\n}\n";
const PARSE_ROUTE: &str = "import { parseBody } from \"@/lib/http\";\n\nexport async function POST(req: Request) {\n  const body = await parseBody(req);\n  return Response.json({ body });\n}\n";
const SESSION_ROUTE: &str = "import { requireSession } from \"@/lib/session\";\n\nexport async function GET(req: Request) {\n  requireSession(req);\n  return Response.json({ ok: true });\n}\n";
const NAMED_ROUTE: &str = "import { assertSession } from \"@/lib/session\";\n\nexport async function GET(req: Request) {\n  assertSession(req);\n  return Response.json({ ok: true });\n}\n";
/// The mocks are set before the handler loads, so the test imports it late.
const SESSION_ROUTE_TEST: &str = "import { describe, expect, it, vi } from \"vitest\";\n\ndescribe(\"GET\", () => {\n  it(\"answers a signed-in caller\", async () => {\n    vi.stubEnv(\"SESSION_SECRET\", \"x\");\n    const { GET } = await import(\"./route\");\n    const res = await GET(new Request(\"http://localhost/api\", { headers: { cookie: \"s=1\" } }));\n    expect(res.ok).toBe(true);\n  });\n});\n";

const SERVICE_AUTH: &str = r#"from fastapi import HTTPException, Request


def require_caller(request: Request):
    if "authorization" not in request.headers:
        raise HTTPException(status_code=401, detail="sign in")
    return request.headers["authorization"]
"#;

const STORE: &str = r#"from fastapi import HTTPException, Request


def load_run(run_id: str):
    if not run_id:
        raise HTTPException(status_code=404, detail="no such run")
    return {"id": run_id}


def require_tenant(request: Request):
    if "x-tenant" not in request.headers:
        raise LookupError("no tenant")
    return request.headers["x-tenant"]
"#;

const SERVICE_TESTS: &str = r#"import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_rules(client):
    assert client.get("/v1/rules").json() == []


def test_runs(client):
    assert client.get("/v1/runs").json() == []
"#;

const SERVICE_ROUTES: &str = "services/api/app/api/routes.py";
/// Routes of each package that share its helper that rejects: enough that the package
/// sets each variant apart from the other, which is what a split folds on.
const GUARDED: usize = 24;
/// Routes of each package that share each of its other two helpers.
const HELPED: usize = 4;

fn monorepo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "frontend/package.json",
        "{ \"name\": \"frontend\", \"dependencies\": { \"next\": \"15.0.0\" }, \"devDependencies\": { \"vitest\": \"2.0.0\" } }",
    );
    write(
        r,
        "frontend/tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "frontend/lib/http.ts", PARSE_BODY);
    write(r, "frontend/lib/session.ts", SESSION);
    for i in 0..HELPED {
        write(
            r,
            &format!("frontend/app/api/parse{i}/route.ts"),
            PARSE_ROUTE,
        );
        write(
            r,
            &format!("frontend/app/api/named{i}/route.ts"),
            NAMED_ROUTE,
        );
    }
    for i in 0..GUARDED {
        write(
            r,
            &format!("frontend/app/api/sess{i}/route.ts"),
            SESSION_ROUTE,
        );
    }
    // The app's proxies to the service: the same routes once `/api` is set aside.
    for name in ["rules", "runs"] {
        write(
            r,
            &format!("frontend/app/api/v1/{name}/route.ts"),
            &format!(
                "export async function GET() {{\n  return fetch(\"http://api.internal/v1/{name}\");\n}}\n"
            ),
        );
    }
    for i in 0..2 {
        write(
            r,
            &format!("frontend/app/api/sess{i}/route.test.ts"),
            SESSION_ROUTE_TEST,
        );
    }
    let base = "services/api";
    write(
        r,
        &format!("{base}/pyproject.toml"),
        "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, &format!("{base}/app/__init__.py"), "");
    write(r, &format!("{base}/app/api/__init__.py"), "");
    write(r, &format!("{base}/app/auth.py"), SERVICE_AUTH);
    write(r, &format!("{base}/app/store.py"), STORE);
    let mut routes = String::from(
        "from fastapi import APIRouter, Request\n\nfrom app.auth import require_caller\nfrom app.store import load_run, require_tenant\n\nrouter = APIRouter(prefix=\"/v1\")\n\n",
    );
    for i in 0..HELPED {
        routes.push_str(&format!(
            "@router.get(\"/run{i}/{{run_id}}\")\nasync def run{i}(run_id: str):\n    return load_run(run_id)\n\n\n"
        ));
        routes.push_str(&format!(
            "@router.get(\"/tenant{i}\")\nasync def tenant{i}(request: Request):\n    return {{\"tenant\": require_tenant(request)}}\n\n\n"
        ));
    }
    for i in 0..GUARDED {
        routes.push_str(&format!(
            "@router.get(\"/caller{i}\")\nasync def caller{i}(request: Request):\n    return {{\"caller\": require_caller(request)}}\n\n\n"
        ));
    }
    for name in ["rules", "runs"] {
        routes.push_str(&format!(
            "@router.get(\"/{name}\")\nasync def list_{name}():\n    return []\n\n\n"
        ));
    }
    write(r, SERVICE_ROUTES, &routes);
    write(
        r,
        &format!("{base}/app/main.py"),
        "from fastapi import FastAPI\n\nfrom app.api.routes import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    write(r, &format!("{base}/tests/__init__.py"), "");
    write(r, &format!("{base}/tests/test_routes.py"), SERVICE_TESTS);
    dir
}

/// One concern of `drift practices --json --units`.
fn concern_with_units(root: &Path, id: &str) -> Value {
    let v: Value = serde_json::from_str(&drift(
        root,
        &["--no-cache", "practices", "--json", "--units"],
    ))
    .unwrap();
    v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("no concern {id}"))
        .clone()
}

/// The unit of `symbol` in `path`.
fn unit<'a>(concern: &'a Value, path: &str, symbol: &str) -> &'a Value {
    concern["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["path"] == path && u["symbol"] == symbol)
        .unwrap_or_else(|| panic!("no unit {path} {symbol}: {:#}", concern["units"]))
}

/// The key of the variant a unit is in (a policy's own key, not its fold's).
fn variant_key(concern: &Value, unit: &Value) -> String {
    let variants = concern["variants"].as_array().unwrap();
    variants
        .iter()
        .chain(
            variants
                .iter()
                .filter_map(|v| v["alternatives"].as_array())
                .flatten(),
        )
        .find(|v| v["id"] == unit["variant"])
        .map(|v| v["key"].as_str().unwrap_or("").to_string())
        .unwrap_or_else(|| panic!("no variant of {unit}: {variants:#?}"))
}

/// The entry rows of `drift security --json`, each `(path, symbol, guards, opaque)`.
fn entry_rows(root: &Path) -> Vec<(String, String, Vec<String>, Vec<String>)> {
    let inv: Value =
        serde_json::from_str(&drift(root, &["--no-cache", "security", "--json"])).unwrap();
    let list = |v: &Value| -> Vec<String> {
        v.as_array()
            .map(|a| a.iter().map(|g| g.as_str().unwrap().to_string()).collect())
            .unwrap_or_default()
    };
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["path"].as_str().unwrap().to_string(),
                e["symbol"].as_str().unwrap().to_string(),
                list(&e["guards"]),
                // Not serialised when empty.
                list(&e["opaque"]),
            )
        })
        .collect()
}

/// One rule for a call in a handler's body, three outcomes, in both reports.
///
/// - It turns callers away (`requireSession()` throwing a 401, `require_caller()`
///   raising one): authn is known by it, and `drift security` lists it as a guard.
/// - It looks like a guard and is not shown to reject (`assertSession()` throwing a
///   plain `Error`, `require_tenant()` raising a `LookupError`: shared, throwing, named
///   for access): authn is unknown, with the helper as the instrument and the
///   `practices:` line that names it; `drift security` lists it as `opaque`, so the
///   route is neither guarded nor "no guard".
/// - Anything else routes share that throws (`parseBody()` on an empty body,
///   `load_run()` raising a 404): none, no guard.
#[test]
fn a_body_call_is_a_guard_unknown_or_nothing_in_both_reports() {
    let dir = monorepo();
    let authn = concern_with_units(dir.path(), "authn");
    let rows = entry_rows(dir.path());
    let row = |path: &str, symbol: &str| -> (&[String], &[String]) {
        rows.iter()
            .find(|(p, s, ..)| p == path && s == symbol)
            .map(|(_, _, g, o)| (g.as_slice(), o.as_slice()))
            .unwrap_or_else(|| panic!("no entry {path} {symbol}: {rows:#?}"))
    };
    let none: &[String] = &[];
    for i in 0..GUARDED {
        for (path, symbol, proof, listed) in [
            (
                format!("frontend/app/api/sess{i}/route.ts"),
                "GET".to_string(),
                "body_call:frontend/lib/session.ts#requireSession",
                "requireSession (body call)",
            ),
            (
                SERVICE_ROUTES.to_string(),
                format!("caller{i}"),
                "body_call:services/api/app/auth.py#require_caller",
                "require_caller (body call)",
            ),
        ] {
            let u = unit(&authn, &path, &symbol);
            assert_eq!(u["assignment"], "known", "{u:#}");
            // By the call that rejects (whether or not its variant is folded).
            let key = variant_key(&authn, u);
            assert!(key.contains(proof), "{key}");
            assert_eq!(row(&path, &symbol), (&[listed.to_string()][..], none));
        }
    }
    for i in 0..HELPED {
        for (path, symbol, listed) in [
            (
                format!("frontend/app/api/named{i}/route.ts"),
                "GET".to_string(),
                "assertSession (body call)",
            ),
            (
                SERVICE_ROUTES.to_string(),
                format!("tenant{i}"),
                "require_tenant (body call)",
            ),
        ] {
            let u = unit(&authn, &path, &symbol);
            assert_eq!(u["assignment"], "unknown", "{u:#}");
            assert_eq!(u["reason"], "unclassified", "{u:#}");
            assert_eq!(row(&path, &symbol), (none, &[listed.to_string()][..]));
        }
        for (path, symbol) in [
            (
                format!("frontend/app/api/parse{i}/route.ts"),
                "POST".to_string(),
            ),
            (SERVICE_ROUTES.to_string(), format!("run{i}")),
        ] {
            let u = unit(&authn, &path, &symbol);
            assert_eq!(u["assignment"], "none", "{u:#}");
            assert_eq!(row(&path, &symbol), (none, none), "{path} {symbol}");
        }
    }
    // The helper is the unknown's instrument, with the line that names it.
    let instruments = authn["unknown"]["instruments"].as_array().unwrap();
    for (helper, short) in [
        ("frontend/lib/session.ts#assertSession", "assertSession"),
        ("services/api/app/store.py#require_tenant", "require_tenant"),
    ] {
        let i = instruments
            .iter()
            .find(|i| i["instrument"] == helper)
            .unwrap_or_else(|| panic!("{helper}: {instruments:#?}"));
        assert_eq!(i["members"], HELPED, "{i:#}");
        assert_eq!(
            i["config_hint"],
            format!("practices: {{authn: {{\"{helper}\": \"{short}\"}}}}"),
            "{i:#}"
        );
    }
    // No variant, alone or folded, is keyed by a helper that is not proven to reject,
    // and no row lists one as a guard.
    let keys = authn["variants"].to_string();
    for helper in ["assertSession", "require_tenant", "parseBody", "load_run"] {
        assert!(!keys.contains(helper), "{helper}: {:#}", authn["variants"]);
        assert!(
            rows.iter()
                .flat_map(|(_, _, g, _)| g)
                .all(|g| !g.contains(helper)),
            "{helper}: {rows:#?}"
        );
    }
    // The headline counts them apart: the routes with nothing (the helpers that are
    // no guard, the proxies and the two lists) and the routes that cannot be told.
    let text = drift(dir.path(), &["--no-cache", "security"]);
    let entries = 2 * (GUARDED + 2 * HELPED + 2);
    assert!(
        text.starts_with(&format!(
            "{entries} entry points ({} where Drift found no guard in what it read, {} whose guard cannot be read, ",
            2 * (HELPED + 2),
            2 * HELPED
        )),
        "{text}"
    );
}

/// A person who names the helper, with the line `drift practices --hints` offers,
/// makes its routes known by it. What was not named stays unknown.
#[test]
fn naming_a_helper_that_looks_like_a_guard_makes_its_routes_known() {
    let dir = monorepo();
    let line = "\"frontend/lib/session.ts#assertSession\": \"assertSession\"";
    let hints = drift(dir.path(), &["--no-cache", "practices", "--hints"]);
    assert!(
        hints.contains(&format!("  authn:\n    {line}  # {HELPED} unit(s)\n")),
        "{hints}"
    );
    write(
        dir.path(),
        ".drift/config.yaml",
        &format!("practices:\n  authn:\n    {line}\n"),
    );
    let authn = concern_with_units(dir.path(), "authn");
    for i in 0..HELPED {
        let named = unit(
            &authn,
            &format!("frontend/app/api/named{i}/route.ts"),
            "GET",
        );
        assert_eq!(named["assignment"], "known", "{named:#}");
        assert_eq!(
            variant_key(&authn, named),
            "body_call:frontend/lib/session.ts#assertSession"
        );
        let tenant = unit(&authn, SERVICE_ROUTES, &format!("tenant{i}"));
        assert_eq!(tenant["assignment"], "unknown", "{tenant:#}");
    }
    let declared = authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["key"] == "body_call:frontend/lib/session.ts#assertSession")
        .unwrap_or_else(|| panic!("{:#}", authn["variants"]));
    assert_eq!(declared["source"], "declared", "{declared:#}");
    assert_eq!(declared["members"], HELPED, "{declared:#}");
    let hints = drift(dir.path(), &["--no-cache", "practices", "--hints"]);
    assert!(!hints.contains("assertSession"), "{hints}");
    assert!(hints.contains("require_tenant"), "{hints}");
}

/// The app's in-body guard and the service's are two policies, each its package's
/// own: not one policy "requireSession, or require_caller" that offers each package a
/// guard its code cannot call.
#[test]
fn a_web_app_and_a_service_keep_their_own_authn_policies() {
    let dir = monorepo();
    let authn = concern_with_units(dir.path(), "authn");
    // The variants either guard is in, whatever else the map reads as authn.
    let known: Vec<&Value> = authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| {
            let key = v["key"].as_str().unwrap();
            v["kind"] == "known"
                && (key.contains("requireSession") || key.contains("require_caller"))
        })
        .collect();
    let keys: Vec<(&str, u64)> = known
        .iter()
        .map(|v| (v["key"].as_str().unwrap(), v["members"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        keys,
        [
            (
                "body_call:frontend/lib/session.ts#requireSession",
                GUARDED as u64
            ),
            (
                "body_call:services/api/app/auth.py#require_caller",
                GUARDED as u64
            ),
        ],
        "{known:#?}"
    );
    for v in known {
        assert!(
            v["alternatives"].as_array().is_none_or(|a| a.is_empty()),
            "{v:#}"
        );
        assert!(!v["label"].as_str().unwrap().contains(", or "), "{v:#}");
    }
    // Each unit is in its own package's policy.
    for (path, symbol, guard) in [
        ("frontend/app/api/sess0/route.ts", "GET", "requireSession"),
        (SERVICE_ROUTES, "caller0", "require_caller"),
    ] {
        let key = variant_key(&authn, unit(&authn, path, symbol));
        assert!(key.ends_with(guard), "{path}: {key}");
    }
}

const TWO_GUARDS: &str = "export function requireSession(req: Request) {\n  if (!req.headers.get(\"cookie\")) {\n    throw new Response(\"Unauthorized\", { status: 401 });\n  }\n}\n\nexport function requireToken(req: Request) {\n  if (!req.headers.get(\"authorization\")) {\n    throw new Response(\"Unauthorized\", { status: 401 });\n  }\n}\n";

/// A web app that signs callers in by session on its routes and by token under
/// `app/api/hooks/`, and an admin app whose few routes call the web app's session
/// guard.
fn two_apps() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for app in ["web", "admin"] {
        write(
            r,
            &format!("apps/{app}/package.json"),
            &format!("{{ \"name\": \"{app}\", \"dependencies\": {{ \"next\": \"15.0.0\" }} }}"),
        );
    }
    write(r, "apps/web/lib/session.ts", TWO_GUARDS);
    let route = |import: &str, guard: &str| {
        format!(
            "import {{ {guard} }} from \"{import}\";\n\nexport async function GET(req: Request) {{\n  {guard}(req);\n  return Response.json({{ ok: true }});\n}}\n"
        )
    };
    for i in 0..GUARDED {
        write(
            r,
            &format!("apps/web/app/api/sess{i}/route.ts"),
            &route("../../../lib/session", "requireSession"),
        );
        write(
            r,
            &format!("apps/web/app/api/hooks/tok{i}/route.ts"),
            &route("../../../../lib/session", "requireToken"),
        );
    }
    for i in 0..HELPED {
        write(
            r,
            &format!("apps/admin/app/api/adm{i}/route.ts"),
            &route("../../../../web/lib/session", "requireSession"),
        );
    }
    dir
}

/// A split is folded in the package it is in, from that package's own routes: the
/// web app's policy is "requireSession, or requireToken" whatever the admin app
/// does, and the admin app's routes, which call the session guard and nothing else,
/// keep that guard as their own policy. Its recipe never offers it the token.
#[test]
fn a_split_folds_in_its_own_package_and_another_packages_use_stands_alone() {
    let dir = two_apps();
    let authn = concern_with_units(dir.path(), "authn");
    let session = "body_call:apps/web/lib/session.ts#requireSession";
    let token = "body_call:apps/web/lib/session.ts#requireToken";
    let list: Vec<(&str, u64, Vec<&str>)> = authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            (
                v["key"].as_str().unwrap(),
                v["members"].as_u64().unwrap(),
                v["where"]["packages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| p["package"].as_str().unwrap())
                    .collect(),
            )
        })
        .collect();
    let fold = format!("any_of({session}|{token})");
    assert_eq!(
        list,
        [
            (fold.as_str(), 2 * GUARDED as u64, vec!["apps/web"]),
            (session, HELPED as u64, vec!["apps/admin"]),
        ],
        "{:#}",
        authn["variants"]
    );
    let policy = &authn["variants"][0];
    let alternatives: Vec<(&str, u64)> = policy["alternatives"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| (a["key"].as_str().unwrap(), a["members"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        alternatives,
        [(session, GUARDED as u64), (token, GUARDED as u64)]
    );
    let own = &authn["variants"][1];
    assert!(own["alternatives"].is_null(), "{own:#}");
    // The same way of doing it as the policy's alternative, in another policy; and
    // one of the dominant policy's ways alone is not the admin app's "own way".
    assert_eq!(own["id"], policy["alternatives"][0]["id"]);
    assert_eq!(authn["divergence"].as_array().unwrap().len(), 0);
    // Every unit is in its package's policy, and each package's profile is its own.
    let of = |path: &str| unit(&authn, path, "GET")["variant"].clone();
    assert_eq!(of("apps/web/app/api/sess0/route.ts"), policy["id"]);
    assert_eq!(of("apps/web/app/api/hooks/tok0/route.ts"), policy["id"]);
    assert_eq!(of("apps/admin/app/api/adm0/route.ts"), own["id"]);
    for (package, id, members) in [
        ("apps/web", &policy["id"], 2 * GUARDED),
        ("apps/admin", &own["id"], HELPED),
    ] {
        let profile = authn["by_package"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["package"] == package)
            .unwrap_or_else(|| panic!("{package}: {:#}", authn["by_package"]));
        assert_eq!(profile["variants"].as_array().unwrap().len(), 1);
        assert_eq!(&profile["variants"][0]["id"], id, "{profile:#}");
        assert_eq!(profile["variants"][0]["members"], members, "{profile:#}");
    }
    let report: Value =
        serde_json::from_str(&drift(dir.path(), &["--no-cache", "practices", "--json"])).unwrap();
    let recipe_label = |package: &str| -> String {
        let recipe = report["recipes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["package"] == package)
            .unwrap_or_else(|| panic!("{package}: {:#}", report["recipes"]));
        let concern = recipe["concerns"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["concern"] == "authn")
            .unwrap();
        assert_eq!(concern["variants"].as_array().unwrap().len(), 1);
        concern["variants"][0]["label"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let web = recipe_label("apps/web");
    assert!(
        web.contains("requireSession") && web.contains(", or ") && web.contains("requireToken"),
        "{web}"
    );
    let admin = recipe_label("apps/admin");
    assert!(
        admin.contains("requireSession") && !admin.contains("requireToken"),
        "{admin}"
    );
}

/// A call named like a log level that Python's standard library answers outside
/// `logging` is no log call (found on a pilot repository, where each of these
/// read "unknown logger" and offered a `practices:` line for it): `math.log(x)` takes
/// a logarithm, so `scale` is not a symbol that logs, and `parser.error(..)` on an
/// argparse parser does not hide that `main` logs with `print`. The strict side
/// stays: a logger a standard-library function hands back cannot be read, and is
/// unknown with its line offered.
#[test]
fn the_standard_librarys_math_and_argparse_are_not_loggers() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"tool\"\ndependencies = []\n",
    );
    write(r, "tool/__init__.py", "");
    write(
        r,
        "tool/cli.py",
        "import argparse\nimport math\nimport multiprocessing\n\n\ndef main():\n    parser = argparse.ArgumentParser()\n    args = parser.parse_args()\n    if not args:\n        parser.error(\"no arguments\")\n    print(\"done\")\n\n\ndef scale(x):\n    return math.log(x)\n\n\ndef work():\n    logger = multiprocessing.get_logger()\n    logger.info(\"started\")\n",
    );
    let logging = concern_with_units(r, "logging");
    let mut symbols: Vec<&str> = logging["units"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["symbol"].as_str().unwrap())
        .collect();
    symbols.sort_unstable();
    assert_eq!(symbols, ["main", "work"], "{:#}", logging["units"]);
    assert_eq!(unit(&logging, "tool/cli.py", "main")["assignment"], "known");
    assert_eq!(
        unit(&logging, "tool/cli.py", "work")["assignment"],
        "unknown"
    );
    let instruments: Vec<&str> = logging["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["instrument"].as_str().unwrap())
        .collect();
    assert_eq!(instruments, ["pkg:python:multiprocessing#get_logger()"]);
    let hints = drift(r, &["--no-cache", "practices", "--hints"]);
    assert!(
        hints.contains("\"pkg:python:multiprocessing#get_logger()\""),
        "{hints}"
    );
    assert!(
        !hints.contains("argparse") && !hints.contains("math"),
        "{hints}"
    );
}

/// A webhook verifier called on an object built in place is the verifier:
/// `Webhook(secret).verify(..)` is svix's signature check, so the route's caller is a
/// service (`service_auth`), not an unknown the report asks a person to name. Found on
/// a pilot repository.
#[test]
fn a_svix_signature_check_on_a_built_webhook_is_service_auth() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"keys\"\ndependencies = [\"fastapi\", \"svix\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI, HTTPException, Request\nfrom svix.webhooks import Webhook, WebhookVerificationError\n\napp = FastAPI()\nSECRET = \"whsec_test\"\n\n\n@app.post(\"/webhooks/clerk\")\nasync def clerk_webhook(request: Request):\n    raw = await request.body()\n    try:\n        Webhook(SECRET).verify(raw, dict(request.headers))\n    except WebhookVerificationError as exc:\n        raise HTTPException(status_code=400, detail=\"Invalid signature\") from exc\n    return {\"ok\": True}\n\n\n@app.post(\"/webhooks/billing\")\nasync def billing_webhook(request: Request):\n    raw = await request.body()\n    Webhook(SECRET).verify(raw, dict(request.headers))\n    return {\"ok\": True}\n",
    );
    let authn = concern_with_units(r, "authn");
    for symbol in ["clerk_webhook", "billing_webhook"] {
        let u = unit(&authn, "app/main.py", symbol);
        assert_eq!(u["assignment"], "known", "{u:#}");
        assert_eq!(
            variant_key(&authn, u),
            "service_auth:pkg:svix#webhooks.Webhook().verify",
            "{u:#}"
        );
    }
    assert_eq!(
        authn["population"]["unknown"], 0,
        "{:#}",
        authn["population"]
    );
    let hints = drift(r, &["--no-cache", "practices", "--hints"]);
    assert!(!hints.contains("svix"), "{hints}");
}

/// Reading the request is not an unread call: `request.json()` on a
/// `request: NextRequest` is the framework's own method, so a route that does nothing
/// else has no guard (none), which `drift security` says too. Found on the owner's
/// repository, where such routes read unknown. The strict side stays, because what
/// this drops turns an unknown into "no guard": a method of an in-repo type the facts
/// do not define, a longer path (it may be an untyped parameter's beside the typed
/// one's of the same path), and a body that also hands a value to a call the facts
/// did not record (`ctx.json(body)` on a parameter with no type) are unknown.
#[test]
fn reading_a_framework_request_is_not_an_unread_call() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/deps.ts",
        "export interface Gate {\n  admit(request: Request): Promise<void>;\n}\n",
    );
    write(
        r,
        "app/api/ingest/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\n\nexport async function POST(request: NextRequest) {\n  const body = await request.json();\n  return NextResponse.json({ body });\n}\n",
    );
    write(
        r,
        "app/api/handoff/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\nimport { Gate } from \"@/lib/deps\";\n\nexport async function POST(request: NextRequest, gate: Gate) {\n  await gate.admit(request);\n  const body = await request.json();\n  return NextResponse.json({ body });\n}\n",
    );
    // `ctx` has no type: `ctx.json(body)` is in no fact but the mark that a value was
    // handed to a call that was not recorded. It may be the step that signs in.
    write(
        r,
        "app/api/handed/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\n\nexport async function POST(req: NextRequest, ctx) {\n  const body = await req.json();\n  ctx.json(body);\n  return NextResponse.json({ ok: true });\n}\n",
    );
    // The same path through a typed and an untyped parameter, awaited (a body that
    // awaits nothing hands its caller to no one).
    write(
        r,
        "app/api/deep/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\n\nexport async function GET(req: NextRequest, ctx) {\n  const url = req.nextUrl.clone();\n  await ctx.nextUrl.clone();\n  return NextResponse.json({ url });\n}\n",
    );
    let authn = concern_with_units(r, "authn");
    let ingest = unit(&authn, "app/api/ingest/route.ts", "POST");
    assert_eq!(ingest["assignment"], "none", "{ingest:#}");
    for (path, symbol) in [
        ("app/api/handoff/route.ts", "POST"),
        ("app/api/deep/route.ts", "GET"),
    ] {
        let u = unit(&authn, path, symbol);
        assert_eq!(
            (&u["assignment"], &u["reason"]),
            (&Value::from("unknown"), &Value::from("body_unreadable")),
            "{path}: {u:#}"
        );
    }
    // The request's own `req.json()` is unread only for what `ctx.json(body)` does: the
    // handler is read in part, and is what the unit is unknown for.
    let handed = unit(&authn, "app/api/handed/route.ts", "POST");
    assert_eq!(
        (&handed["assignment"], &handed["reason"]),
        (&Value::from("unknown"), &Value::from("partly_read")),
        "{handed:#}"
    );
    let instruments: Vec<&str> = authn["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["instrument"].as_str().unwrap())
        .collect();
    assert_eq!(
        instruments,
        [
            "app/api/handed/route.ts#POST",
            "lib/deps.ts#Gate.admit",
            "param:ctx.nextUrl.clone"
        ]
    );
    let rows = entry_rows(r);
    let ingest = rows
        .iter()
        .find(|(path, ..)| path == "app/api/ingest/route.ts")
        .unwrap();
    assert!(ingest.2.is_empty() && ingest.3.is_empty(), "{ingest:?}");
}

/// A proxy route hands the request to one helper and returns what it answers
/// (`return proxyRequest(request, params)`): the helper's catch that responds is how
/// the route's errors become responses, the same variant as a route with the try in
/// its own body. Found on a pilot repository, where 24 such routes read as letting
/// errors reach the framework. A handler that answers itself is read as it stands,
/// and a helper that answers without catching leaves the route with the default.
#[test]
fn a_route_that_hands_the_request_to_a_helper_has_the_helpers_error_handling() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    // The helper is in the route's own file, and catches what the upstream throws.
    write(
        r,
        "app/api/v1/[...path]/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\n\nasync function proxyRequest(request: NextRequest, params: { path: string[] }) {\n  const path = params.path.join(\"/\");\n  try {\n    const response = await fetch(`http://backend/${path}`, { method: request.method });\n    return new NextResponse(await response.text(), { status: response.status });\n  } catch (error) {\n    console.error(\"proxy error\", error);\n    return NextResponse.json({ error: \"Failed to connect to backend\" }, { status: 502 });\n  }\n}\n\nexport async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {\n  return proxyRequest(request, await params);\n}\n\nexport async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {\n  return proxyRequest(request, await params);\n}\n",
    );
    // The try is in the handler.
    write(
        r,
        "app/api/own/route.ts",
        "import { NextResponse } from \"next/server\";\n\nexport async function GET() {\n  try {\n    const response = await fetch(\"http://backend/own\");\n    return NextResponse.json(await response.json());\n  } catch (error) {\n    return NextResponse.json({ error: \"failed\" }, { status: 502 });\n  }\n}\n",
    );
    // The helper answers and catches nothing: whatever is thrown reaches the framework.
    write(
        r,
        "lib/plain.ts",
        "import { NextResponse } from \"next/server\";\n\nexport async function forward(url: string) {\n  const response = await fetch(url);\n  return NextResponse.json(await response.json());\n}\n",
    );
    for name in ["plain", "plain2"] {
        write(
            r,
            &format!("app/api/{name}/route.ts"),
            "import { forward } from \"@/lib/plain\";\n\nexport async function GET() {\n  return forward(\"http://backend/plain\");\n}\n",
        );
    }
    // The handler awaits a helper whose catch answers 401, and returns what another
    // one answers, which catches nothing: the catch is not how the route's errors
    // become responses. The facts do not say whose value is returned, so with two
    // helpers that answer neither is followed.
    write(
        r,
        "lib/session.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\n\nexport async function readSession(request: NextRequest) {\n  try {\n    const token = request.headers.get(\"authorization\");\n    return JSON.parse(atob(token ?? \"\"));\n  } catch (error) {\n    return NextResponse.json({ error: \"bad token\" }, { status: 401 });\n  }\n}\n",
    );
    for name in ["both", "both2"] {
        write(
            r,
            &format!("app/api/{name}/route.ts"),
            "import { NextRequest } from \"next/server\";\nimport { readSession } from \"@/lib/session\";\nimport { forward } from \"@/lib/plain\";\n\nexport async function GET(request: NextRequest) {\n  await readSession(request);\n  return forward(\"http://backend/x\");\n}\n",
        );
    }
    let errors = concern_with_units(r, "errors");
    let variant = |path: &str, symbol: &str| -> String {
        let u = unit(&errors, path, symbol);
        errors["variants"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == u["variant"])
            .unwrap_or_else(|| panic!("{u:#}"))["key"]
            .as_str()
            .unwrap()
            .to_string()
    };
    const TRY: &str = "in_body_try:pkg:next#NextResponse.json";
    assert_eq!(variant("app/api/v1/[...path]/route.ts", "GET"), TRY);
    assert_eq!(variant("app/api/v1/[...path]/route.ts", "POST"), TRY);
    assert_eq!(variant("app/api/own/route.ts", "GET"), TRY);
    assert_eq!(
        variant("app/api/plain/route.ts", "GET"),
        "bubble:framework_default"
    );
    assert_eq!(
        variant("app/api/both/route.ts", "GET"),
        "bubble:framework_default"
    );
}

/// A call that builds an object is no guard, whatever the class is called: an
/// endpoint that mints a token from `CreateSessionRequestBody(user_id=..)` and checks
/// nothing has no guard (none), which `drift security` says too. Found on the owner's
/// repository, where the word "Session" in the class's name made the route unknown.
/// The strict side stays: a package's function named for access may be the guard and
/// cannot be read, so its route is unknown and the line that names it is offered.
#[test]
fn a_route_that_only_builds_a_request_body_has_no_guard() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"keys\"\ndependencies = [\"fastapi\", \"clerk-backend-api\", \"acme-sessions\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/clerk.py",
        "from clerk_backend_api import Clerk\n\nclerk_client = Clerk(bearer_auth=\"test\")\n",
    );
    write(
        r,
        "app/main.py",
        "from acme_sessions import require_session\nfrom clerk_backend_api import CreateSessionRequestBody\nfrom fastapi import FastAPI, Query, Request\n\nfrom app.clerk import clerk_client\n\napp = FastAPI()\n\n\n@app.post(\"/_internal/issue-token\")\nasync def issue_token(user_id: str = Query(...)):\n    session = await clerk_client.sessions.create_async(\n        request=CreateSessionRequestBody(user_id=user_id)\n    )\n    return {\"token\": session.id}\n\n\n@app.get(\"/reports\")\nasync def reports(request: Request):\n    require_session(request)\n    return []\n",
    );
    let authn = concern_with_units(r, "authn");
    let mint = unit(&authn, "app/main.py", "issue_token");
    assert_eq!(mint["assignment"], "none", "{mint:#}");
    let reports = unit(&authn, "app/main.py", "reports");
    assert_eq!(
        (&reports["assignment"], &reports["reason"]),
        (&Value::from("unknown"), &Value::from("unclassified")),
        "{reports:#}"
    );
    let instruments: Vec<&str> = authn["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["instrument"].as_str().unwrap())
        .collect();
    assert_eq!(instruments, ["pkg:acme_sessions#require_session"]);
    let hints = drift(r, &["--no-cache", "practices", "--hints"]);
    assert!(
        hints.contains("\"pkg:acme_sessions#require_session\""),
        "{hints}"
    );
    assert!(!hints.contains("CreateSessionRequestBody"), "{hints}");
    let rows = entry_rows(r);
    let mint = rows
        .iter()
        .find(|(_, symbol, ..)| symbol == "issue_token")
        .unwrap();
    assert!(mint.2.is_empty() && mint.3.is_empty(), "{mint:?}");
}

/// The service's pytest client asks the service: `client.get("/v1/rules")` tests
/// `list_rules`, not the app's proxy at `/api/v1/rules`. And a route test that loads
/// the handler late (`await import("./route")`) imports it.
#[test]
fn a_services_tests_test_the_service_and_a_deferred_import_tests_the_route() {
    let dir = monorepo();
    let testing = concern_with_units(dir.path(), "testing");
    for name in ["rules", "runs"] {
        let served = unit(&testing, SERVICE_ROUTES, &format!("list_{name}"));
        assert_eq!(served["assignment"], "known", "{served:#}");
        assert_eq!(
            variant_key(&testing, served),
            "tested_none_asserted:pytest",
            "{served:#}"
        );
        let proxy = unit(
            &testing,
            &format!("frontend/app/api/v1/{name}/route.ts"),
            "GET",
        );
        assert_eq!(proxy["assignment"], "none", "{proxy:#}");
    }
    for i in 0..GUARDED {
        let route = unit(
            &testing,
            &format!("frontend/app/api/sess{i}/route.ts"),
            "GET",
        );
        if i < 2 {
            assert_eq!(route["assignment"], "known", "{route:#}");
            assert_eq!(
                variant_key(&testing, route),
                "tested_none_asserted:vitest",
                "{route:#}"
            );
        } else {
            assert_eq!(route["assignment"], "none", "{route:#}");
        }
    }
    // Two units each: the service's by pytest, the app's by vitest.
    let known: Vec<(&str, u64)> = testing["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "known")
        .map(|v| (v["key"].as_str().unwrap(), v["members"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        known,
        [
            ("tested_none_asserted:pytest", 2),
            ("tested_none_asserted:vitest", 2),
        ]
    );
}

const KEYED_DEPS: &str = r#"from fastapi import HTTPException, Request
from sqlalchemy.orm import sessionmaker

SessionLocal = sessionmaker()


def get_current_user(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return {"id": token, "org_id": token}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_exporter(request: Request):
    return request.app.state.exporter
"#;

const KEYED_STORE: &str = r#"from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import Note


def load_settings(db: Session, user_id: str):
    return db.execute(text("select 1")).all()


def notes_of(db: Session, org_id: str):
    return db.execute(select(Note).where(Note.org_id == org_id)).all()
"#;

const KEYED_ROUTES: &str = r#"from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, get_exporter
from app.models import Note
from app.store import load_settings, notes_of

router = APIRouter()


@router.get("/users/{user_id}/settings")
async def user_settings(user_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return load_settings(db, user_id)


@router.get("/notes")
async def list_notes(org_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return notes_of(db, org_id)


@router.get("/notes-inline")
async def list_notes_inline(org_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.execute(select(Note).where(Note.org_id == org_id)).all()


@router.get("/users/{user_id}/profile")
async def own_profile(user_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    if user["id"] != user_id:
        raise HTTPException(status_code=403, detail="forbidden")
    return load_settings(db, user_id)


@router.get("/users/{user_id}/export")
async def user_export(user_id: str, user=Depends(get_current_user), exporter=Depends(get_exporter)):
    return exporter.run(user_id)


@router.get("/public/users/{user_id}/card")
async def public_card(user_id: str, db: Session = Depends(get_db)):
    return load_settings(db, user_id)


@router.get("/my/notes")
async def my_notes(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return db.execute(select(Note).where(Note.org_id == user["org_id"])).all()
"#;

/// A FastAPI service whose routes sign the caller in and take a user or an
/// organisation from the request.
fn keyed_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/deps.py", KEYED_DEPS);
    write(
        r,
        "svc/app/models.py",
        "from sqlalchemy import Column, String\nfrom sqlalchemy.orm import declarative_base\n\nBase = declarative_base()\n\n\nclass Note(Base):\n    __tablename__ = \"notes\"\n    id = Column(String, primary_key=True)\n    org_id = Column(String)\n    body = Column(String)\n",
    );
    write(r, "svc/app/store.py", KEYED_STORE);
    write(r, "svc/app/api/users.py", KEYED_ROUTES);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.users import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
}

/// A signed-in route that takes a user or an organisation from the request and
/// neither checks nor scopes it is the first finding, in text and in JSON, with the key
/// and where. Nothing is said of the route that compares the key with the caller, the
/// one that hands it to a value the facts cannot read (an untyped dependency's method),
/// the one that signs nobody in, or the one scoped by the caller's own organisation.
#[test]
fn a_key_a_signed_in_caller_names_and_nothing_scopes_is_the_first_finding() {
    let dir = keyed_repo();
    let v: Value =
        serde_json::from_str(&drift(dir.path(), &["--no-cache", "practices", "--json"])).unwrap();
    let findings = v["findings"].as_array().unwrap();
    let unscoped: Vec<(&str, u64, Vec<&str>)> = findings
        .iter()
        .filter(|f| f["kind"] == "unscoped_key")
        .map(|f| {
            (
                f["key"].as_str().unwrap(),
                f["members"].as_u64().unwrap(),
                f["examples"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e["symbol"].as_str().unwrap())
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        unscoped,
        [
            ("org_id", 2, vec!["list_notes", "list_notes_inline"]),
            ("user_id", 1, vec!["user_settings"]),
        ],
        "{findings:#?}"
    );
    // They rank before every other kind, and name the concern and the package.
    for f in &findings[..2] {
        assert_eq!(f["kind"], "unscoped_key", "{findings:#?}");
        assert_eq!(f["concern"], "authz");
        assert_eq!(f["package"], "svc");
        assert_eq!(f["examples"][0]["path"], "svc/app/api/users.py");
    }
    // No other finding carries a key.
    for f in &findings[2..] {
        assert!(f.get("key").is_none(), "{f:#}");
    }
    // What the map says of the units nothing is said about.
    let authz = concern_with_units(dir.path(), "authz");
    let assignment =
        |symbol: &str| unit(&authz, "svc/app/api/users.py", symbol)["assignment"].clone();
    // `exporter=Depends(get_exporter)` with no annotation, and a factory that hands
    // back `request.app.state.exporter`: what `exporter.run(user_id)` runs cannot be
    // told. It read "none" while the call was in no fact; it is unknown.
    assert_eq!(assignment("user_export"), "unknown");
    assert_eq!(assignment("my_notes"), "known");
    assert_ne!(assignment("own_profile"), "none");

    let text = drift(dir.path(), &["--no-cache", "practices"]);
    let lines: Vec<&str> = text
        .lines()
        .skip_while(|l| *l != "Findings:")
        .skip(1)
        .take(2)
        .collect();
    assert_eq!(
        lines,
        [
            "  - authz unscoped key in svc: 2 signed-in entry point(s) take `org_id` from the request and nothing read checks or scopes it, so a signed-in caller can name any org_id (svc/app/api/users.py:17 list_notes; svc/app/api/users.py:22 list_notes_inline)",
            "  - authz unscoped key in svc: 1 signed-in entry point(s) take `user_id` from the request and nothing read checks or scopes it, so a signed-in caller can name any user_id (svc/app/api/users.py:12 user_settings)",
        ],
        "{text}"
    );
    for quiet in ["own_profile", "user_export", "public_card", "my_notes"] {
        assert!(
            !text
                .lines()
                .any(|l| l.contains("unscoped key") && l.contains(quiet)),
            "{quiet}: {text}"
        );
    }
}

const FETCH_JSON: &str = r#"import json

import httpx


def fetch_json(url: str, token: str):
    response = httpx.get(url, headers={"authorization": token})
    return json.loads(response.text)
"#;

/// Two services of a monorepo, each with its own copy of `fetch_json`, a `load` that
/// only shares the name, a `main`, a route of the same name and a test helper.
fn copied_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let loads = [
        "import json\n\n\ndef load(path: str):\n    with open(path) as f:\n        return json.load(f)\n",
        "import csv\nimport gzip\n\n\ndef load(path: str):\n    with gzip.open(path, \"rt\") as f:\n        return list(csv.reader(f))\n",
    ];
    for (name, load) in ["billing", "orders"].into_iter().zip(loads) {
        let base = format!("services/{name}");
        write(
            r,
            &format!("{base}/pyproject.toml"),
            &format!("[project]\nname = \"{name}\"\ndependencies = [\"fastapi\", \"httpx\"]\n"),
        );
        write(r, &format!("{base}/app/__init__.py"), "");
        // The orders copy sits lower in its file: every copy is said with its own line.
        let client = if name == "orders" {
            format!("\"\"\"HTTP helpers.\"\"\"\n{FETCH_JSON}")
        } else {
            FETCH_JSON.to_string()
        };
        write(r, &format!("{base}/app/client.py"), &client);
        write(r, &format!("{base}/app/files.py"), load);
        write(
            r,
            &format!("{base}/app/cli.py"),
            "import json\n\nimport httpx\n\n\ndef main():\n    print(json.dumps(httpx.get(\"http://upstream/health\").text))\n\n\nif __name__ == \"__main__\":\n    main()\n",
        );
        write(
            r,
            &format!("{base}/app/main.py"),
            "from fastapi import FastAPI\n\nfrom app.client import fetch_json\nfrom app.files import load\n\napp = FastAPI()\n\n\n@app.get(\"/items\")\nasync def list_items():\n    return {\"items\": fetch_json(\"http://upstream/items\", \"t\"), \"seed\": load(\"seed\")}\n",
        );
        write(r, &format!("{base}/tests/__init__.py"), "");
        write(
            r,
            &format!("{base}/tests/test_items.py"),
            "import json\n\nimport httpx\n\n\ndef make_items():\n    return json.loads(httpx.get(\"http://upstream/items\").text)\n\n\ndef test_items():\n    assert make_items() == []\n",
        );
    }
    dir
}

/// A helper copied into two services is a finding with every copy's path and line, in
/// text and in JSON, and "helpers" leaves the not-covered list. Functions that only
/// share a name, a `main`, the two routes of one name and the tests' helpers are not
/// said to be copies.
#[test]
fn a_helper_defined_in_two_services_is_a_finding_with_every_copy() {
    let dir = copied_repo();
    let v: Value =
        serde_json::from_str(&drift(dir.path(), &["--no-cache", "practices", "--json"])).unwrap();
    let duplicates: Vec<&Value> = v["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["kind"] == "duplicate_helper")
        .collect();
    assert_eq!(duplicates.len(), 1, "{:#}", v["findings"]);
    let f = duplicates[0];
    assert_eq!(f["key"], "fetch_json", "{f:#}");
    assert_eq!(f["concern"], "hygiene");
    // The copies are in two packages: the finding is no one package's.
    assert_eq!(f["package"], Value::Null);
    assert_eq!(f["members"], 2);
    assert_eq!(f["shared_calls"], 2);
    let copies: Vec<(&str, u64)> = f["copies"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["path"].as_str().unwrap(), c["line"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        copies,
        [
            ("services/billing/app/client.py", 6),
            ("services/orders/app/client.py", 7),
        ]
    );
    // The other kinds carry no copies.
    for other in v["findings"].as_array().unwrap() {
        if other["kind"] != "duplicate_helper" {
            assert!(other.get("copies").is_none(), "{other:#}");
            assert!(other.get("shared_calls").is_none(), "{other:#}");
        }
    }
    let not_covered = v["not_covered"].to_string();
    assert!(
        not_covered.contains("hygiene (duplicate libraries, escape hatches)"),
        "{not_covered}"
    );

    let text = drift(dir.path(), &["--no-cache", "practices"]);
    let line = text
        .lines()
        .find(|l| l.contains("duplicate helper"))
        .unwrap_or_else(|| panic!("{text}"));
    assert_eq!(
        line,
        "  - duplicate helper across packages: `fetch_json` is defined in 2 files and the copies share 2 call(s) (services/billing/app/client.py:6; services/orders/app/client.py:7)",
    );
    assert_eq!(
        text.lines()
            .filter(|l| l.contains("duplicate helper"))
            .count(),
        1,
        "{text}"
    );
    assert!(
        text.contains("hygiene (duplicate libraries, escape hatches);"),
        "{text}"
    );
    // A helper is no concern's: one concern's report does not carry it.
    let scoped: Value = serde_json::from_str(&drift(
        dir.path(),
        &["--no-cache", "practices", "--json", "--concern", "authn"],
    ))
    .unwrap();
    assert!(
        scoped["findings"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["kind"] != "duplicate_helper"),
        "{:#}",
        scoped["findings"]
    );
}

const RULE_SERVICES: &str = r#"class ForbiddenError(Exception):
    pass


def load_rule(rule_id):
    return RULES[rule_id]


RULES = {}


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_rules(self, org_id):
        if org_id != self.caller.org_id:
            raise ForbiddenError("another organization")
        return []

    def get_rule(self, rule_id):
        rule = load_rule(rule_id)
        self._ensure_access(rule)
        return rule

    def _ensure_access(self, rule):
        if rule.org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def record(self, body):
        return {"by": self._person()}

    def _person(self):
        if not self.caller.token_user_id:
            raise ForbiddenError("recorded with a person's own sign-in")
        return self.caller.token_user_id

    def ping(self):
        return {"ok": True}


class SharedRuleBook(RuleBook):
    def shared(self):
        return self.caller.shared
"#;

const RULE_DEPS: &str = r#"from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.services import RuleBook, SharedRuleBook


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller


def get_rule_book(caller=Depends(get_caller)) -> RuleBook:
    return RuleBook(caller)


def get_shared_rule_book(caller=Depends(get_caller)) -> SharedRuleBook:
    return SharedRuleBook(caller)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
"#;

const RULE_ROUTES: &str = r#"from fastapi import APIRouter, Depends

from app.deps import RuleBookDep, get_caller, get_rule_book, get_shared_rule_book
from app.services import RuleBook, SharedRuleBook

router = APIRouter(prefix="/rules")


@router.get("")
async def list_rules(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()


@router.get("/one")
async def get_rule(rule_id: str, service: RuleBookDep):
    return service.get_rule(rule_id)


@router.get("/one/history")
async def rule_history(rule_id: str, service: RuleBookDep):
    return service.get_rule(rule_id)


@router.get("/shared")
async def shared_rules(org_id: str, service: SharedRuleBook = Depends(get_shared_rule_book)):
    return service.list_rules(org_id)


@router.get("/built")
async def built_rules(org_id: str, caller=Depends(get_caller)):
    return RuleBook(caller).list_rules(org_id)


@router.get("/untyped")
async def untyped_rules(org_id: str, service=Depends(get_rule_book)):
    return service.list_rules(org_id)


@router.post("/record")
async def record_rule(body: dict, service: RuleBookDep):
    return service.record(body)
"#;

/// A FastAPI service whose authorization lives in a service class, reached through a
/// dependency alias, a typed dependency of a subclass, an instance built in place and
/// a dependency no annotation types.
fn rules_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/services.py", RULE_SERVICES);
    write(r, "svc/app/deps.py", RULE_DEPS);
    write(r, "svc/app/api/rules.py", RULE_ROUTES);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
}

/// A service class: `list_rules` hands the organisation asked for to
/// `RuleBook.list_rules`, which raises `ForbiddenError` when it is not the
/// caller's, and gets the service through `RuleBookDep = Annotated[RuleBook,
/// Depends(get_rule_book)]`. The map said "no authorization" of such a route. The
/// check is read through the alias, through a subclass's typed dependency (the base
/// class defines the method), through an instance built in place and through a
/// sibling method; and a method that checks nothing is a recorded absence.
#[test]
fn a_check_in_a_service_method_is_read_through_a_dependency_alias() {
    let dir = rules_repo();
    let authz = concern_with_units(dir.path(), "authz");
    let routes = "svc/app/api/rules.py";
    let list = "tenancy_check:svc/app/services.py#RuleBook.list_rules";
    for symbol in ["list_rules", "shared_rules", "built_rules"] {
        let u = unit(&authz, routes, symbol);
        assert_eq!(u["assignment"], "known", "{symbol}: {u:#}");
        assert_eq!(variant_key(&authz, u), list, "{symbol}");
    }
    for symbol in ["get_rule", "rule_history"] {
        let one = unit(&authz, routes, symbol);
        assert_eq!(one["assignment"], "known", "{one:#}");
        // Named for what the sibling compares (the rule's organisation with the
        // caller's): a tenant check, and not a role check for the word `access` in
        // its name.
        assert_eq!(
            variant_key(&authz, one),
            "tenancy_check:svc/app/services.py#RuleBook._ensure_access"
        );
    }
    let ping = unit(&authz, routes, "ping");
    assert_eq!(ping["assignment"], "none", "{ping:#}");
}

/// A refusal below the handler that names neither a role, a tenant nor an owner was
/// dropped, and the route read "no authorization": `record` asks `_person`, which
/// raises `ForbiddenError` unless a person's own token signed the caller in. The map
/// cannot name that check, and it is one: the route is unknown, with where the
/// refusal is. The same of a Next.js route whose helper answers 403.
#[test]
fn a_refusal_below_the_handler_that_nothing_explains_is_unknown() {
    let dir = rules_repo();
    let r = dir.path();
    write(
        r,
        "web/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "web/lib/session.ts",
        "export async function getSession(): Promise<{ token: string } | null> {\n  return null;\n}\n\nexport async function betaIsOn(): Promise<boolean> {\n  return false;\n}\n",
    );
    write(
        r,
        "web/lib/gate.ts",
        "import { betaIsOn } from \"./session\";\n\nexport async function gated(name: string) {\n  if (!(await betaIsOn())) {\n    return new Response(\"no\", { status: 403 });\n  }\n  return new Response(name);\n}\n",
    );
    write(
        r,
        "web/app/api/beta/route.ts",
        "import { getSession } from \"../../../lib/session\";\nimport { gated } from \"../../../lib/gate\";\n\nexport async function GET() {\n  const session = await getSession();\n  if (!session) {\n    return new Response(\"Unauthorized\", { status: 401 });\n  }\n  return gated(\"beta\");\n}\n",
    );
    let authz = concern_with_units(r, "authz");
    for (path, symbol) in [
        ("svc/app/api/rules.py", "record_rule"),
        ("web/app/api/beta/route.ts", "GET"),
    ] {
        let u = unit(&authz, path, symbol);
        assert_eq!(
            (&u["assignment"], &u["reason"]),
            (&Value::from("unknown"), &Value::from("unclassified")),
            "{path}: {u:#}"
        );
    }
    let instruments: Vec<&str> = authz["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["instrument"].as_str().unwrap())
        .collect();
    for where_ in [
        "svc/app/services.py#RuleBook._person",
        "web/lib/gate.ts#gated",
    ] {
        assert!(instruments.contains(&where_), "{instruments:?}");
    }
}

/// A Next.js route reads its request, asks a helper whether the caller may open the
/// workspace and answers 403 when it may not: the helper's answer is the tenant
/// check. A route that only reads the request and logs is a recorded absence, where
/// the request read made it unknown. A route that only hands the request to another
/// service is not said to authorise nothing: what authorises it may be upstream, and
/// the facts do not say that the caller's own credential goes with it.
#[test]
fn a_proxy_route_is_read_and_a_forward_is_not_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "lib/session.ts",
        "export async function getSession(): Promise<{ token: string; orgId: string } | null> {\n  return null;\n}\n",
    );
    write(
        r,
        "lib/access.ts",
        "export async function ownsWorkspace(id: string | null, token: string): Promise<boolean> {\n  const probe = await fetch(`https://projects.internal/v1/spaces/${id}`, {\n    headers: { Authorization: `Bearer ${token}` },\n  });\n  return probe.ok;\n}\n",
    );
    let head = "import { NextRequest, NextResponse } from \"next/server\";\nimport { getSession } from \"../../../lib/session\";\n";
    let sign_in = "  const session = await getSession();\n  if (!session) {\n    return NextResponse.json({ error: \"Unauthorized\" }, { status: 401 });\n  }\n";
    for route in ["run", "compare"] {
        write(
            r,
            &format!("app/api/{route}/route.ts"),
            &format!(
                "{head}import {{ ownsWorkspace }} from \"../../../lib/access\";\n\nexport async function POST(request: NextRequest) {{\n{sign_in}  const workspaceId = request.nextUrl.searchParams.get(\"workspaceId\");\n  if (!(await ownsWorkspace(workspaceId, session.token))) {{\n    return NextResponse.json({{ error: \"Forbidden\" }}, {{ status: 403 }});\n  }}\n  return NextResponse.json({{ ok: true }}, {{ status: 202 }});\n}}\n"
            ),
        );
    }
    write(
        r,
        "app/api/events/route.ts",
        &format!(
            "{head}\nexport async function POST(request: NextRequest) {{\n{sign_in}  const kind = request.nextUrl.searchParams.get(\"kind\");\n  console.info(kind);\n  return new NextResponse(null, {{ status: 204 }});\n}}\n"
        ),
    );
    write(
        r,
        "app/api/things/route.ts",
        &format!(
            "{head}\nexport async function GET(request: NextRequest) {{\n{sign_in}  const page = request.nextUrl.searchParams.get(\"page\");\n  const res = await fetch(`https://upstream.internal/v1/things?page=${{page}}`, {{\n    headers: {{ Authorization: `Bearer ${{session.token}}` }},\n  }});\n  return new NextResponse(await res.text(), {{ status: res.status }});\n}}\n"
        ),
    );
    let authz = concern_with_units(r, "authz");
    // The 403 on what `ownsWorkspace` answered is a tenant check by the function's
    // name only: found, not proven, never a none.
    for route in ["app/api/run/route.ts", "app/api/compare/route.ts"] {
        let run = unit(&authz, route, "POST");
        assert_eq!(
            (
                &run["assignment"],
                &run["reason"],
                &run["not_proven"]["check"],
                &run["not_proven"]["obligation"]
            ),
            (
                &Value::from("unknown"),
                &Value::from("check_not_proven"),
                &Value::from("tenancy_check:lib/access.ts#ownsWorkspace"),
                &Value::from("by_name_only")
            ),
            "{run:#}"
        );
    }
    let events = unit(&authz, "app/api/events/route.ts", "POST");
    assert_eq!(events["assignment"], "none", "{events:#}");
    // Named by the function that hands the request on, not by `fetch`.
    let things = unit(&authz, "app/api/things/route.ts", "GET");
    assert_eq!(
        (&things["assignment"], &things["reason"]),
        (&Value::from("unknown"), &Value::from("forwarded")),
        "{things:#}"
    );
    let instruments: Vec<&str> = authz["unknown"]["instruments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["instrument"].as_str().unwrap())
        .collect();
    assert_eq!(
        instruments,
        ["lib/access.ts#ownsWorkspace", "app/api/things/route.ts#GET"]
    );
}

const ORG_DEPS: &str = r#"from fastapi import Depends, HTTPException, Path, Request

from app.users import resolve


def authenticate(request: Request) -> str:
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return token


class Authorize:
    def __init__(self, needed_role=None):
        self.needed_role = needed_role

    async def __call__(
        self,
        token: str = Depends(authenticate),
        organization_id: str = Path(alias="org_id"),
    ):
        user = resolve(token)
        active = user.current_org
        if active is None or organization_id != active.id:
            raise HTTPException(status_code=403, detail="Forbidden")
        if self.needed_role is not None and active.role != self.needed_role:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
"#;

const ORG_ROUTES: &str = r#"from fastapi import APIRouter, Depends

from app.deps import Authorize, authenticate
from app.users import remove, resolve

router = APIRouter(prefix="/organizations")


@router.delete("/{org_id}/members/{member_id}")
async def delete_member(org_id: str, member_id: str, _=Depends(Authorize(needed_role="admin"))):
    return remove(member_id)


@router.patch("/{org_id}/members/{member_id}")
async def update_member(org_id: str, member_id: str, _=Depends(Authorize(needed_role="admin"))):
    return remove(member_id)


@router.get("/{org_id}/members")
async def list_members(org_id: str, token: str = Depends(authenticate)):
    return resolve(token)
"#;

/// A members service: `delete_member` takes the organisation from the route
/// and checks nothing in its body, and its dependency `Authorize(needed_role=...)`
/// answers 403 when the organisation is not the caller's active one or the role is
/// not the required one. The dependency's `__call__` is read: it is the route's
/// tenant guard (the role comparison is conditional on how the instance was built,
/// and is not proven). A route under the same path with no such dependency
/// stays unknown (the tenant in the route, and nothing read enforces it).
///
/// A dependency is also where a service comes from: a route that calls a method of
/// what an untyped dependency injects (`service=Depends(get_rule_book)`, then
/// `service.list_rules(org_id)`, a call in no fact) under a dependency that builds a
/// service class has not been read, and is unknown, not a recorded absence.
#[test]
fn a_dependency_that_checks_the_tenant_in_the_route_is_the_routes_guard() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(
        r,
        "svc/app/users.py",
        "def resolve(token):\n    return {\"id\": token}\n\n\ndef remove(member_id):\n    return None\n",
    );
    write(r, "svc/app/deps.py", ORG_DEPS);
    write(r, "svc/app/api/organizations.py", ORG_ROUTES);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.organizations import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    let authz = concern_with_units(r, "authz");
    let routes = "svc/app/api/organizations.py";
    for symbol in ["delete_member", "update_member"] {
        let guarded = unit(&authz, routes, symbol);
        assert_eq!(guarded["assignment"], "known", "{guarded:#}");
        // The tenant comparison runs for every request: the tenant guard. The role
        // comparison is one operand of `self.needed_role is not None and ...`: it
        // decides only for an instance built with a role, which the facts do not
        // follow from `Authorize(needed_role=...)` to the attribute. [STRICT]: a
        // guard of the repository is a role guard where its body answers 403 on a
        // role for every request, so the role is not in the key (it was, read from
        // a check that is conditional).
        assert_eq!(
            variant_key(&authz, guarded),
            "tenancy_guard:svc/app/deps.py#Authorize"
        );
    }
    let open = unit(&authz, routes, "list_members");
    assert_eq!(
        (&open["assignment"], &open["reason"]),
        (&Value::from("unknown"), &Value::from("not_followed")),
        "{open:#}"
    );

    // The call on what the untyped dependency injects is recorded by its factory
    // (`get_rule_book().list_rules`), whose `return RuleBook(caller)` says what
    // it is: the route is known by the service's check, where it was unknown.
    let rules = rules_repo();
    let authz = concern_with_units(rules.path(), "authz");
    let untyped = unit(&authz, "svc/app/api/rules.py", "untyped_rules");
    assert_eq!(untyped["assignment"], "known", "{untyped:#}");
    assert_eq!(
        variant_key(&authz, untyped),
        "tenancy_check:svc/app/services.py#RuleBook.list_rules"
    );
}

const SERVICE_DEPS: &str = r#"from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.services import RuleBook


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller


def get_rule_book(caller=Depends(get_caller)) -> RuleBook:
    return RuleBook(caller)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
"#;

/// A FastAPI service `svc` with these `app/services.py`, `app/deps.py` and
/// `app/api/rules.py`, its router mounted in `app/main.py`.
fn service_repo(services: &str, deps: &str, routes: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/services.py", services);
    write(r, "svc/app/deps.py", deps);
    write(r, "svc/app/api/rules.py", routes);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
}

/// `(assignment, variant key or unknown reason)` of the authz unit `symbol` of
/// `svc/app/api/rules.py`.
fn authz_of(authz: &Value, symbol: &str) -> (String, String) {
    let u = unit(authz, "svc/app/api/rules.py", symbol);
    let assignment = u["assignment"].as_str().unwrap().to_string();
    let what = match assignment.as_str() {
        // A unit of a variant in the tail carries its own key.
        "known" => match u["key"].as_str() {
            Some(key) => key.to_string(),
            None => variant_key(authz, u),
        },
        "unknown" => u["reason"].as_str().unwrap().to_string(),
        _ => String::new(),
    };
    (assignment, what)
}

/// A check that only asks that the caller has an organisation and then answers with
/// every tenant's rows is no tenant check: `if not self.caller.org_id: raise
/// ForbiddenError`. It read `known tenancy_check`. A tenant counts only where it is
/// compared with something; a refusal the map cannot name leaves the route unknown.
#[test]
fn a_tenant_that_is_only_asked_for_scopes_nothing() {
    let services = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_everything(self):
        if not self.caller.org_id:
            raise ForbiddenError("sign in to an organization first")
        return ["every", "tenant"]

    def list_rules(self, org_id):
        if org_id != self.caller.org_id:
            raise ForbiddenError("another organization")
        return []
"#;
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/everything")
async def list_everything(service: RuleBookDep):
    return service.list_everything()


@router.get("")
async def list_rules(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)


@router.get("/again")
async def list_rules_again(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    assert_eq!(
        authz_of(&authz, "list_everything"),
        ("unknown".to_string(), "unclassified".to_string())
    );
    for symbol in ["list_rules", "list_rules_again"] {
        assert_eq!(
            authz_of(&authz, symbol),
            (
                "known".to_string(),
                "tenancy_check:svc/app/services.py#RuleBook.list_rules".to_string()
            )
        );
    }
}

/// A dependency that signs the caller in by looking a key up (`select(ApiKey).where(
/// ApiKey.org_id == <the x-org-id header>, ApiKey.token == token)`) filters its own
/// query by a tenant the caller named. That is not the scope of the routes behind it:
/// they read `known tenancy_requested:org_id (header)`, one that only answers
/// `{"deleted": True}` among them. A dependency's queries are not taken for the
/// route's.
#[test]
fn a_query_in_a_sign_in_dependency_is_not_the_routes_scope() {
    let services = "class RuleBook:\n    def __init__(self, caller):\n        self.caller = caller\n\n    def ping(self):\n        return {\"ok\": True}\n";
    let deps = r#"from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApiKey
from app.services import RuleBook


def get_db() -> Session:
    return Session()


def get_caller(request: Request, db: Session = Depends(get_db)):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    org_id = request.headers.get("x-org-id")
    key = db.execute(select(ApiKey).where(ApiKey.org_id == org_id, ApiKey.token == token)).scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return key


def get_rule_book(caller=Depends(get_caller)) -> RuleBook:
    return RuleBook(caller)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
"#;
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import RuleBookDep, get_caller

router = APIRouter(prefix="/rules")


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()


@router.delete("/all")
async def delete_all(caller=Depends(get_caller)):
    return {"deleted": True}
"#;
    let dir = service_repo(services, deps, routes);
    write(
        dir.path(),
        "svc/app/models.py",
        "from sqlalchemy import Column, String\nfrom sqlalchemy.orm import declarative_base\n\nBase = declarative_base()\n\n\nclass ApiKey(Base):\n    __tablename__ = \"api_keys\"\n    token = Column(String, primary_key=True)\n    org_id = Column(String)\n",
    );
    let authz = concern_with_units(dir.path(), "authz");
    for symbol in ["ping", "delete_all"] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("none".to_string(), String::new()),
            "{symbol}"
        );
    }
}

/// A check that refuses the caller's OWN organisation and serves any other one (`if
/// org_id == self.caller.org_id: raise ForbiddenError`) read `known tenancy_check`:
/// the facts did not say which way the comparison refuses. They do now, and only a
/// check that turns away a mismatch is the tenant check; the other way round is a
/// refusal the map cannot name (unknown). The same of a Next.js route's own 403.
#[test]
fn a_check_that_refuses_the_callers_own_tenant_is_not_a_tenant_check() {
    let services = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_other(self, org_id):
        if org_id == self.caller.org_id:
            raise ForbiddenError("use /rules for your own organization")
        return ["rows of", org_id]

    def list_rules(self, org_id):
        if not (org_id == self.caller.org_id):
            raise ForbiddenError("another organization")
        return []
"#;
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/other")
async def list_other(org_id: str, service: RuleBookDep):
    return service.list_other(org_id)


@router.get("")
async def list_rules(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)


@router.get("/again")
async def list_rules_again(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let r = dir.path();
    write(
        r,
        "web/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "web/lib/session.ts",
        "export async function getSession(): Promise<{ orgId: string } | null> {\n  return null;\n}\n",
    );
    for (name, op) in [("own", "==="), ("other", "!==")] {
        write(
            r,
            &format!("web/app/api/{name}/route.ts"),
            &format!(
                "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getSession }} from \"../../../lib/session\";\n\nexport async function GET(request: NextRequest) {{\n  const session = await getSession();\n  if (!session) {{\n    return NextResponse.json({{ error: \"Unauthorized\" }}, {{ status: 401 }});\n  }}\n  if (session.orgId {op} request.headers.get(\"x-org-id\")) {{\n    return NextResponse.json({{ error: \"Forbidden\" }}, {{ status: 403 }});\n  }}\n  return NextResponse.json({{ ok: true }});\n}}\n"
            ),
        );
    }
    let authz = concern_with_units(r, "authz");
    assert_eq!(
        authz_of(&authz, "list_other"),
        ("unknown".to_string(), "unclassified".to_string())
    );
    for symbol in ["list_rules", "list_rules_again"] {
        assert_eq!(
            authz_of(&authz, symbol),
            (
                "known".to_string(),
                "tenancy_check:svc/app/services.py#RuleBook.list_rules".to_string()
            )
        );
    }
    let own = unit(&authz, "web/app/api/own/route.ts", "GET");
    assert_eq!(own["assignment"], "unknown", "{own:#}");
    let other = unit(&authz, "web/app/api/other/route.ts", "GET");
    assert_eq!(other["assignment"], "known", "{other:#}");
}

/// `RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]` types the
/// service by its base class, and the factory returns `ScopedRuleBook(caller)`,
/// which overrides `list_rules`. Reading the base's method said "no authorization"
/// where the override checks, and `known tenancy_check` where the base checks and
/// the override does not. Where a subclass of the repository overrides the method,
/// which one runs is not known: the route is unknown both ways. A method the
/// subclass leaves alone is read as before.
#[test]
fn a_method_a_subclass_overrides_is_not_read_from_the_annotated_class() {
    let checks = "        if org_id != self.caller.org_id:\n            raise ForbiddenError(\"another organization\")\n";
    let services = |base: &str, sub: &str| {
        format!(
            "class ForbiddenError(Exception):\n    pass\n\n\nclass RuleBook:\n    def __init__(self, caller):\n        self.caller = caller\n\n    def list_rules(self, org_id):\n{base}        return []\n\n    def ping(self):\n        return {{\"ok\": True}}\n\n\nclass ScopedRuleBook(RuleBook):\n    def list_rules(self, org_id):\n{sub}        return []\n"
        )
    };
    let deps = SERVICE_DEPS
        .replace(
            "from app.services import RuleBook",
            "from app.services import RuleBook, ScopedRuleBook",
        )
        .replace("return RuleBook(caller)", "return ScopedRuleBook(caller)");
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("")
async def list_rules(org_id: str, service: RuleBookDep):
    return service.list_rules(org_id)


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()
"#;
    for (base, sub) in [("", checks), (checks, "")] {
        let dir = service_repo(&services(base, sub), &deps, routes);
        let authz = concern_with_units(dir.path(), "authz");
        assert_eq!(
            authz_of(&authz, "list_rules"),
            ("unknown".to_string(), "body_unreadable".to_string()),
            "base checks: {}",
            !base.is_empty()
        );
        assert_eq!(
            authz_of(&authz, "ping"),
            ("none".to_string(), String::new())
        );
    }
}

/// A check three and four calls below the handler (`service.get_rule` ->
/// `fetch_one` -> `authorize`, which raises 403) was not read: the reach stopped two
/// calls down and dropped what the deepest body called, so the route read "no
/// authorization". The reach goes deeper now, and what the deepest body it reads
/// calls in the repository is unread: such a route is unknown, never a none.
#[test]
fn a_check_deeper_than_the_reach_is_never_a_none() {
    let mut services = String::from(
        "from fastapi import HTTPException\n\n\nclass RuleBook:\n    def __init__(self, caller):\n        self.caller = caller\n\n    def ping(self):\n        return {\"ok\": True}\n\n    def get_rule(self, rule_id):\n        return fetch_one(self.caller, rule_id)\n\n    def delete_rule(self, rule_id):\n        return load(self.caller, rule_id)\n\n    def far(self, rule_id):\n        return step1(self.caller, rule_id)\n\n\ndef load(caller, rule_id):\n    return fetch_one(caller, rule_id)\n\n\ndef fetch_one(caller, rule_id):\n    rule = caller.rules.pop()\n    authorize(caller, rule)\n    return rule\n\n\ndef authorize(caller, rule):\n    if caller.plan != rule.plan:\n        raise HTTPException(status_code=403, detail=\"no\")\n",
    );
    // A chain of eight helpers ends in the same check.
    for i in 1..=8 {
        let next = if i < 8 {
            format!("step{}(caller, rule_id)", i + 1)
        } else {
            "fetch_one(caller, rule_id)".to_string()
        };
        services.push_str(&format!(
            "\n\ndef step{i}(caller, rule_id):\n    return {next}\n"
        ));
    }
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()


@router.get("/one")
async def get_rule(rule_id: str, service: RuleBookDep):
    return service.get_rule(rule_id)


@router.delete("/one")
async def delete_rule(rule_id: str, service: RuleBookDep):
    return service.delete_rule(rule_id)


@router.get("/far")
async def far(rule_id: str, service: RuleBookDep):
    return service.far(rule_id)
"#;
    let dir = service_repo(&services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    assert_eq!(
        authz_of(&authz, "ping"),
        ("none".to_string(), String::new())
    );
    // Read to the check, which names neither a role, a tenant nor an owner.
    for symbol in ["get_rule", "delete_rule"] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("unknown".to_string(), "unclassified".to_string()),
            "{symbol}"
        );
    }
    // Deeper than is read: unread.
    assert_eq!(
        authz_of(&authz, "far"),
        ("unknown".to_string(), "body_unreadable".to_string())
    );
}

/// A dependency that turns a signed-in caller away on something the map cannot name
/// (`require_feature` answers 403 unless the caller's plan has the feature) was read
/// for the checks it proves and for nothing else, so the routes under it read "no
/// authorization". Its refusal is read as the handler's own would be: the routes are
/// unknown, whether the dependency is the route's or a parameter's. A route without
/// it is still a recorded absence.
#[test]
fn a_dependency_that_refuses_on_what_the_map_cannot_name_is_not_a_none() {
    let services = "class RuleBook:\n    def __init__(self, caller):\n        self.caller = caller\n\n    def list_rules(self, org_id):\n        return []\n\n    def ping(self):\n        return {\"ok\": True}\n";
    let deps = format!(
        "{SERVICE_DEPS}\n\ndef require_feature(caller=Depends(get_caller)):\n    if not caller.features.get(\"rules\"):\n        raise HTTPException(status_code=403, detail=\"not enabled\")\n    return caller\n"
    );
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import RuleBookDep, require_feature

router = APIRouter(prefix="/rules")


@router.get("", dependencies=[Depends(require_feature)])
async def list_rules(service: RuleBookDep):
    return service.list_rules("x")


@router.get("/ping")
async def ping(service: RuleBookDep, caller=Depends(require_feature)):
    return service.ping()


@router.get("/plain")
async def plain(service: RuleBookDep):
    return service.ping()
"#;
    let dir = service_repo(services, &deps, routes);
    let authz = concern_with_units(dir.path(), "authz");
    for symbol in ["list_rules", "ping"] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("unknown".to_string(), "unclassified".to_string()),
            "{symbol}"
        );
    }
    assert_eq!(
        authz_of(&authz, "plain"),
        ("none".to_string(), String::new())
    );
}

/// A service whose constructor answers 403 unless the caller is an admin authorises
/// every route that gets one built: `RuleBook.__init__` runs in the dependency
/// that builds it. The constructor was not read (only the method the handler calls
/// was), so the routes read "no authorization". A route that gets no service is
/// still a recorded absence.
#[test]
fn a_check_in_the_constructor_of_an_injected_service_is_read() {
    let services = r#"from fastapi import HTTPException


class RuleBook:
    def __init__(self, caller):
        if caller.role != "admin":
            raise HTTPException(status_code=403, detail="forbidden")
        self.caller = caller

    def delete_rule(self, rule_id):
        return {"deleted": rule_id}

    def ping(self):
        return {"ok": True}


def purge_all(caller):
    return {"purged": True}
"#;
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import RuleBookDep, get_caller
from app.services import purge_all

router = APIRouter(prefix="/rules")


@router.delete("/one")
async def delete_rule(rule_id: str, service: RuleBookDep):
    return service.delete_rule(rule_id)


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()


@router.delete("/all")
async def delete_all(caller=Depends(get_caller)):
    return purge_all(caller)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    for symbol in ["delete_rule", "ping"] {
        let (assignment, key) = authz_of(&authz, symbol);
        assert_eq!(assignment, "known", "{symbol}");
        assert!(
            key.contains("role_check:svc/app/services.py#RuleBook.__init__"),
            "{symbol}: {key}"
        );
    }
    assert_eq!(
        authz_of(&authz, "delete_all"),
        ("none".to_string(), String::new())
    );
}

/// The check sits in a decorator on what the handler calls: `@require_role("admin")`
/// on the service's method, `@admins_only` on a helper. Neither was read (a method's
/// decorators were in no fact), and the routes read "no authorization". A decorator on
/// a callee is read as a dependency around the unit is: it is the role guard here.
#[test]
fn a_check_in_a_decorator_on_the_method_a_handler_calls_is_read() {
    let services = r#"import functools

from fastapi import HTTPException


def require_role(role):
    def wrap(fn):
        @functools.wraps(fn)
        def inner(self, *args, **kwargs):
            if self.caller.role != role:
                raise HTTPException(status_code=403, detail="forbidden")
            return fn(self, *args, **kwargs)
        return inner
    return wrap


def admins_only(fn):
    @functools.wraps(fn)
    def inner(caller, *args, **kwargs):
        if caller.role != "admin":
            raise HTTPException(status_code=403, detail="forbidden")
        return fn(caller, *args, **kwargs)
    return inner


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    @require_role("admin")
    def delete_rule(self, rule_id):
        return {"deleted": rule_id}

    def ping(self):
        return {"ok": True}


@admins_only
def purge_all(caller):
    return {"purged": True}
"#;
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import RuleBookDep, get_caller
from app.services import purge_all

router = APIRouter(prefix="/rules")


@router.delete("/one")
async def delete_rule(rule_id: str, service: RuleBookDep):
    return service.delete_rule(rule_id)


@router.delete("/all")
async def delete_all(caller=Depends(get_caller)):
    return purge_all(caller)


@router.get("/ping")
async def ping(service: RuleBookDep):
    return service.ping()
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    for symbol in ["delete_rule", "delete_all"] {
        let u = unit(&authz, "svc/app/api/rules.py", symbol);
        assert_eq!(u["assignment"], "known", "{symbol}: {u:#}");
        let variant = authz["variants"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == u["variant"])
            .unwrap();
        let mechanisms: Vec<&str> = variant["mechanisms"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m.as_str())
            .collect();
        assert!(mechanisms.contains(&"role_guard"), "{symbol}: {variant:#}");
    }
    assert_eq!(
        authz_of(&authz, "ping"),
        ("none".to_string(), String::new())
    );
}

/// `rule_book = None` at module level, set by an `init()` at start-up: a handler's
/// `state.rule_book.list_rules(org_id)` was read as a call on a plain value, a
/// library's, and the route read "no authorization" while the service set there
/// checks the organisation. What a name bound to nothing holds is not in the facts:
/// the route is unknown.
#[test]
fn a_service_held_in_a_module_name_bound_later_is_not_read_as_a_plain_value() {
    let services = "class ForbiddenError(Exception):\n    pass\n\n\nclass RuleBook:\n    def __init__(self, caller):\n        self.caller = caller\n\n    def list_rules(self, org_id):\n        if org_id != self.caller.org_id:\n            raise ForbiddenError(\"another organization\")\n        return []\n";
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import get_caller
from app import state

router = APIRouter(prefix="/rules")


@router.get("")
async def list_rules(org_id: str, caller=Depends(get_caller)):
    return state.rule_book.list_rules(org_id)


@router.get("/names")
async def names(key: str, caller=Depends(get_caller)):
    return state.NAMES.get(key)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    write(
        dir.path(),
        "svc/app/state.py",
        "from app.services import RuleBook\n\nrule_book = None\nNAMES = {\"a\": \"b\"}\n\n\ndef init(caller):\n    global rule_book\n    rule_book = RuleBook(caller)\n",
    );
    let authz = concern_with_units(dir.path(), "authz");
    assert_eq!(
        authz_of(&authz, "list_rules"),
        ("unknown".to_string(), "body_unreadable".to_string())
    );
    assert_eq!(
        authz_of(&authz, "names"),
        ("none".to_string(), String::new())
    );
}

/// A catch-all proxy route asks whether the caller may open the
/// workspace only inside `if (req.method !== "GET" && req.method !== "HEAD")`, and
/// there only when the body names a workspace; every method of the route read `known
/// tenancy_check`. A check inside a branch only some requests take does not check the
/// others: it is not the unit's authorization, and since something there turns a
/// caller away the unit is unknown, not a none. The same check that every request
/// reaches is the tenant check, as before; and a service method whose check sits
/// under `if scope == "org"` is unknown too.
#[test]
fn a_check_that_only_some_requests_reach_does_not_make_the_route_known() {
    let services = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def scoped_rules(self, org_id, scope):
        if scope == "org":
            if org_id != self.caller.org_id:
                raise ForbiddenError("another organization")
        return []
"#;
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/scoped")
async def scoped_rules(org_id: str, scope: str, service: RuleBookDep):
    return service.scoped_rules(org_id, scope)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let r = dir.path();
    write(
        r,
        "web/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "web/lib/session.ts",
        "export async function getSession(): Promise<{ token: string } | null> {\n  return null;\n}\n",
    );
    write(
        r,
        "web/lib/access.ts",
        "export async function callerCanOpenWorkspace(id: string | null, token: string): Promise<boolean> {\n  return id !== null && token !== \"\";\n}\n",
    );
    let proxy = |guarded: &str| {
        format!(
            "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getSession }} from \"../../../lib/session\";\nimport {{ callerCanOpenWorkspace }} from \"../../../lib/access\";\n\nasync function proxy(req: NextRequest) {{\n  const session = await getSession();\n  if (!session) {{\n    return NextResponse.json({{ error: \"Unauthorized\" }}, {{ status: 401 }});\n  }}\n  const workspaceId = req.nextUrl.searchParams.get(\"workspaceId\");\n{guarded}\n  return NextResponse.json({{ ok: true }});\n}}\n\nexport async function GET(req: NextRequest) {{\n  return proxy(req);\n}}\n\nexport async function POST(req: NextRequest) {{\n  return proxy(req);\n}}\n"
        )
    };
    let check = "if (!(await callerCanOpenWorkspace(workspaceId, session.token))) {\n      return NextResponse.json({ error: \"Forbidden\" }, { status: 403 });\n    }";
    write(
        r,
        "web/app/api/some/route.ts",
        &proxy(&format!(
            "  if (req.method !== \"GET\" && req.method !== \"HEAD\") {{\n    {check}\n  }}"
        )),
    );
    write(
        r,
        "web/app/api/every/route.ts",
        &proxy(&format!("  {check}")),
    );
    let authz = concern_with_units(r, "authz");
    for method in ["GET", "POST"] {
        // Under the branch: found, and not proven to run on every request. On
        // every request: found by the function's name only. Neither is known, and
        // only the second is settled by naming the function.
        let found = |route: &str| {
            let u = unit(&authz, route, method);
            assert_eq!(
                (&u["assignment"], &u["reason"], &u["not_proven"]["check"]),
                (
                    &Value::from("unknown"),
                    &Value::from("check_not_proven"),
                    &Value::from("tenancy_check:web/lib/access.ts#callerCanOpenWorkspace")
                ),
                "{method}: {u:#}"
            );
            (
                u["not_proven"]["obligation"].as_str().unwrap().to_string(),
                !u["not_proven"]["config_hint"]
                    .as_str()
                    .unwrap_or_default()
                    .is_empty(),
            )
        };
        assert_eq!(
            found("web/app/api/some/route.ts"),
            ("under_branch".to_string(), false)
        );
        assert_eq!(
            found("web/app/api/every/route.ts"),
            ("by_name_only".to_string(), true)
        );
    }
    // The service's check under `if scope == "org"`: found, with the condition.
    let scoped = unit(&authz, "svc/app/api/rules.py", "scoped_rules");
    assert_eq!(
        (
            &scoped["reason"],
            &scoped["not_proven"]["check"],
            &scoped["not_proven"]["obligation"],
            &scoped["not_proven"]["when"]
        ),
        (
            &Value::from("check_not_proven"),
            &Value::from("tenancy_check:svc/app/services.py#RuleBook.scoped_rules"),
            &Value::from("under_branch"),
            &Value::from("only when scope == \"...\"")
        ),
        "{scoped:#}"
    );
}

/// A method called on a local (`svc = RuleBook(caller)`, then
/// `svc.list_rules(org_id)`) or on what an untyped dependency injects left no call
/// fact: the check in the service was not read, and a route whose only work was such
/// a call read "no authorization". The call is recorded by what its receiver is and
/// followed: into the class built, and into the class the factory really builds (a
/// subclass under the base's annotation). Where the receiver cannot be told the unit
/// is unknown, never a none; a list or a string built in the body is a plain value.
#[test]
fn a_call_on_a_local_or_an_injected_value_is_followed_into_its_class() {
    let services = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_rules(self, org_id):
        return []

    def ping(self):
        return {"ok": True}


class ScopedRuleBook(RuleBook):
    def list_rules(self, org_id):
        if org_id != self.caller.org_id:
            raise ForbiddenError("another organization")
        return []
"#;
    let deps = format!(
        "{}\n\ndef get_scoped_service(caller=Depends(get_caller)) -> RuleBook:\n    return ScopedRuleBook(caller)\n\n\ndef get_plugin(request: Request):\n    return request.app.state.plugin\n",
        SERVICE_DEPS.replace(
            "from app.services import RuleBook",
            "from app.services import RuleBook, ScopedRuleBook"
        )
    );
    let routes = r#"from fastapi import APIRouter, Depends

from app.deps import get_caller, get_plugin, get_scoped_service
from app.services import ScopedRuleBook

router = APIRouter(prefix="/rules")


@router.get("/local")
async def local_rules(org_id: str, caller=Depends(get_caller)):
    svc = ScopedRuleBook(caller)
    return svc.list_rules(org_id)


@router.get("/injected")
async def injected_rules(org_id: str, service=Depends(get_scoped_service)):
    return service.list_rules(org_id)


@router.get("/plugin")
async def plugin_rules(org_id: str, caller=Depends(get_caller), plugin=Depends(get_plugin)):
    return plugin.rules_of(org_id)


@router.get("/handed")
async def handed_rules(org_id: str, sink, caller=Depends(get_caller)):
    return sink.push(org_id)


@router.get("/plain")
async def plain_rules(name: str, caller=Depends(get_caller)):
    out = []
    out.append(name)
    return ", ".join(out)
"#;
    let dir = service_repo(services, &deps, routes);
    let authz = concern_with_units(dir.path(), "authz");
    for symbol in ["local_rules", "injected_rules"] {
        assert_eq!(
            authz_of(&authz, symbol),
            (
                "known".to_string(),
                "tenancy_check:svc/app/services.py#ScopedRuleBook.list_rules".to_string()
            ),
            "{symbol}"
        );
    }
    for symbol in ["plugin_rules", "handed_rules"] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("unknown".to_string(), "body_unreadable".to_string()),
            "{symbol}"
        );
    }
    assert_eq!(
        authz_of(&authz, "plain_rules"),
        ("none".to_string(), String::new())
    );
}

/// A service run as `python -m app.messaging.consumer` had no entry point: its
/// consumer extends `BaseRabbitMQConsumer`, and the word split read `MQConsumer` as one
/// word. It is an entry point of kind `consumer`: listed in `drift security` with its
/// kind and not counted as a route with no guard, listed in the practice map as a kind
/// of its own, and in no population of authn or authz (no caller signs in to it).
#[test]
fn a_message_consumer_is_an_entry_point_of_its_own_kind() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"aio-pika\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/messaging/__init__.py", "");
    write(
        r,
        "svc/app/messaging/base.py",
        "class BaseRabbitMQConsumer:\n    def __init__(self, url):\n        self.url = url\n\n    async def consume(self):\n        raise NotImplementedError\n",
    );
    write(
        r,
        "svc/app/messaging/consumer.py",
        "import asyncio\n\nfrom app.messaging.base import BaseRabbitMQConsumer\n\n\nclass AbConsumer(BaseRabbitMQConsumer):\n    async def _messages_handler(self, *messages):\n        return None\n\n\nasync def _run():\n    consumer = AbConsumer(\"amqp://\")\n    await consumer.consume()\n\n\nif __name__ == \"__main__\":\n    asyncio.run(_run())\n",
    );
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/health\")\nasync def health():\n    return {\"ok\": True}\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let kinds: Vec<(&str, &str)> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["symbol"].as_str().unwrap(), e["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(kinds, [("health", "http"), ("AbConsumer", "consumer")]);
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.starts_with(
            "2 entry points (1 where Drift found no guard in what it read, 1 consumer not counted: fed by a queue, no caller to sign in, "
        ),
        "{text}"
    );
    let v: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "practices", "--json", "--units"])).unwrap();
    assert_eq!(
        v["consumers"].as_array().unwrap().len(),
        1,
        "{:#}",
        v["consumers"]
    );
    let c = &v["consumers"][0];
    assert_eq!(
        (&c["path"], &c["symbol"], &c["line"], &c["adapter"]),
        (
            &Value::from("svc/app/messaging/consumer.py"),
            &Value::from("AbConsumer"),
            &Value::from(6),
            &Value::from("queue")
        )
    );
    // No concern counts it: there is no caller to sign in, and it is no HTTP route.
    for concern in v["concerns"].as_array().unwrap() {
        if !["authn", "authz", "errors", "api", "validation", "testing"]
            .contains(&concern["id"].as_str().unwrap())
        {
            continue;
        }
        // A concern with no unit has no `units` key.
        let units = concern["units"].as_array().cloned().unwrap_or_default();
        assert!(
            units.iter().all(|u| u["symbol"] != "AbConsumer"),
            "{}: {units:#?}",
            concern["id"]
        );
    }
    let map = drift(r, &["--no-cache", "practices"]);
    assert!(
        map.contains(
            "Message consumers (1): fed by a queue, so no caller signs in and authn and authz do not apply; listed, not classified: svc/app/messaging/consumer.py:6 AbConsumer (queue)."
        ),
        "{map}"
    );
}

/// A card's Siblings line says of message consumers what its entry-point line says:
/// fed by a queue, no caller to sign in; never that none has a guard.
#[test]
fn a_card_says_of_sibling_consumers_that_a_queue_feeds_them() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"aio-pika\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/messaging/__init__.py", "");
    write(
        r,
        "svc/app/messaging/base.py",
        "class BaseRabbitMQConsumer:\n    def __init__(self, url):\n        self.url = url\n\n    async def consume(self):\n        raise NotImplementedError\n",
    );
    for name in ["A", "B", "C", "D", "E", "F", "G", "H", "I"] {
        write(
            r,
            &format!("svc/app/messaging/{}.py", name.to_lowercase()),
            &format!(
                "import asyncio\n\nfrom app.messaging.base import BaseRabbitMQConsumer\n\n\nclass {name}Consumer(BaseRabbitMQConsumer):\n    async def _messages_handler(self, *messages):\n        return None\n\n\nasync def _run():\n    consumer = {name}Consumer(\"amqp://\")\n    await consumer.consume()\n\n\nif __name__ == \"__main__\":\n    asyncio.run(_run())\n"
            ),
        );
    }
    let card = drift(r, &["--no-cache", "card", "svc/app/messaging/a.py"]);
    assert!(
        card.contains("[consumer] AConsumer: fed by a queue, no caller to sign in"),
        "{card}"
    );
    assert!(
        card.contains(
            "Siblings: 9 consumer entry points in svc/app/messaging/; fed by a queue, no caller to sign in\n"
        ),
        "{card}"
    );
    assert!(!card.contains("none has a guard"), "{card}");
}

/// A card's "Defined elsewhere too" reads the entry points the practice map reads:
/// handlers listed only by the newer listing (a Starlette route table) are entry
/// points, not copies of a helper, on both surfaces.
#[test]
fn a_card_and_the_practice_map_leave_out_the_same_entry_points_from_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "site/pyproject.toml",
        "[project]\nname = \"site\"\ndependencies = [\"starlette\"]\n",
    );
    write(r, "site/app/__init__.py", "");
    write(
        r,
        "site/app/store.py",
        "def load(k):\n    return [k]\n\n\ndef shape(x):\n    return {\"x\": x}\n",
    );
    for v in ["a", "b", "c"] {
        write(
            r,
            &format!("site/app/{v}.py"),
            &format!(
                "from starlette.responses import JSONResponse\n\nfrom app.store import load, shape\n\n\nasync def index(request):\n    return JSONResponse(shape(load(\"{v}\")))\n"
            ),
        );
    }
    write(
        r,
        "site/app/main.py",
        "from starlette.applications import Starlette\nfrom starlette.routing import Route\n\nfrom app import a, b, c\n\napp = Starlette(routes=[\n    Route(\"/a\", a.index),\n    Route(\"/b\", b.index),\n    Route(\"/c\", c.index),\n])\n",
    );
    write(
        r,
        "site/app/warm.py",
        "from app import a, b, c\n\n\nasync def warm():\n    await a.index(None)\n    await b.index(None)\n    await c.index(None)\n",
    );
    let v: Value = serde_json::from_str(&drift(r, &["--no-cache", "practices", "--json"])).unwrap();
    let dupes: Vec<&Value> = v["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| f["kind"] == "duplicate_helper")
        .collect();
    assert!(dupes.is_empty(), "{dupes:#?}");
    let card = drift(r, &["--no-cache", "card", "site/app/a.py"]);
    assert!(card.contains("[http] index"), "{card}");
    assert!(!card.contains("Defined elsewhere too"), "{card}");
}

/// [STRICT] `known` needs proof that the named check runs on every request. Each of
/// these read `known tenancy_check`: the check is skipped for rules of global scope
/// (an early return in the helper), runs only when the caller has an organisation
/// (one operand of `and`), is called under a branch of the service method, or is
/// called on the right of `or`. Each is now unknown with the check that was found, the
/// obligation that failed and, where the code states it, the condition in its own
/// words; the summary counts them by obligation; a plain check on every path stays
/// known.
#[test]
fn a_check_that_does_not_run_on_every_request_is_found_not_proven() {
    let services = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def _ensure_access(self, rule):
        if rule.visibility == Visibility.SHARED:
            return
        if rule.tenant_id != self.caller.tenant_id:
            raise ForbiddenError("another tenant")

    def _ensure_org(self, rule):
        if rule.org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def _ensure_org_if_set(self, rule):
        if self.caller.org_id is not None and rule.org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def early_return(self, rule):
        self._ensure_access(rule)
        return rule

    def operand(self, rule):
        self._ensure_org_if_set(rule)
        return rule

    def branch(self, rule, strict):
        if strict:
            self._ensure_org(rule)
        return rule

    def bypass(self, rule):
        self.caller.is_support or self._ensure_org(rule)
        return rule

    def plain(self, rule):
        self._ensure_org(rule)
        return rule
"#;
    let routes = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/early")
async def early_return(rule_id: str, service: RuleBookDep):
    return service.early_return(rule_id)


@router.get("/operand")
async def operand(rule_id: str, service: RuleBookDep):
    return service.operand(rule_id)


@router.get("/branch")
async def branch(rule_id: str, strict: bool, service: RuleBookDep):
    return service.branch(rule_id, strict)


@router.get("/bypass")
async def bypass(rule_id: str, service: RuleBookDep):
    return service.bypass(rule_id)


@router.get("/plain")
async def plain(rule_id: str, service: RuleBookDep):
    return service.plain(rule_id)


@router.get("/plain-again")
async def plain_again(rule_id: str, service: RuleBookDep):
    return service.plain(rule_id)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    let found = |symbol: &str| {
        let u = unit(&authz, "svc/app/api/rules.py", symbol);
        assert_eq!(
            (&u["assignment"], &u["reason"]),
            (&Value::from("unknown"), &Value::from("check_not_proven")),
            "{symbol}: {u:#}"
        );
        let n = &u["not_proven"];
        (
            n["check"].as_str().unwrap().to_string(),
            n["obligation"].as_str().unwrap().to_string(),
            n["when"].as_str().unwrap_or_default().to_string(),
            !n["config_hint"].as_str().unwrap_or_default().is_empty(),
        )
    };
    let check = |method: &str| format!("tenancy_check:svc/app/services.py#RuleBook.{method}");
    assert_eq!(
        found("early_return"),
        (
            check("_ensure_access"),
            "after_conditional_return".to_string(),
            "not when rule.visibility == Visibility.SHARED".to_string(),
            true
        )
    );
    assert_eq!(
        found("operand"),
        (
            check("_ensure_org_if_set"),
            "and_operand".to_string(),
            "only when self.caller.org_id is not None".to_string(),
            true
        )
    );
    // The unit only sometimes reaches the check: naming it settles nothing.
    assert_eq!(
        found("branch"),
        (
            check("_ensure_org"),
            "under_branch".to_string(),
            String::new(),
            false
        )
    );
    assert_eq!(
        found("bypass"),
        (
            check("_ensure_org"),
            "bypass_operand".to_string(),
            String::new(),
            false
        )
    );
    for symbol in ["plain", "plain_again"] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("known".to_string(), check("_ensure_org"))
        );
    }
    // The line a person reads: what was found and why it is not proven, never a
    // statement that the route does it.
    assert_eq!(
        unit(&authz, "svc/app/api/rules.py", "early_return")["not_proven"]["line"],
        "unknown: a tenant check was found (`_ensure_access`) but is not proven to run on every request: it is skipped when rule.visibility == Visibility.SHARED"
    );
    let by: Vec<(String, u64)> = authz["unknown"]["not_proven"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| {
            (
                o["obligation"].as_str().unwrap().to_string(),
                o["members"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        by,
        [
            ("after_conditional_return".to_string(), 1),
            ("and_operand".to_string(), 1),
            ("bypass_operand".to_string(), 1),
            ("under_branch".to_string(), 1),
        ]
    );
    let text = drift(dir.path(), &["--no-cache", "practices", "--all"]);
    assert!(
        text.contains("check found, not proven 4: after_conditional_return 1, and_operand 1, bypass_operand 1, under_branch 1"),
        "{text}"
    );
    assert!(
        text.contains("unknown: a tenant check was found (`_ensure_org_if_set`) but is not proven to run on every request: it decides only when self.caller.org_id is not None"),
        "{text}"
    );
    // `--hints` lists the checks a `practices:` line settles first, and only those
    // the unit runs on every path.
    let hints = drift(dir.path(), &["--no-cache", "practices", "--hints"]);
    assert!(
        hints.contains("\"svc/app/services.py#RuleBook._ensure_access\": \"RuleBook._ensure_access\"  # 1 unit(s): check found, not proven (after_conditional_return)"),
        "{hints}"
    );
    assert!(!hints.contains("RuleBook._ensure_org\""), "{hints}");
    // A person names the check: the unit is known as declared, never as read.
    write(
        dir.path(),
        ".drift/config.yaml",
        "practices:\n  authz:\n    \"svc/app/services.py#RuleBook._ensure_access\": \"rule access\"\n    \"svc/app/services.py#RuleBook._ensure_org\": \"org\"\n",
    );
    let authz = concern_with_units(dir.path(), "authz");
    let early = unit(&authz, "svc/app/api/rules.py", "early_return");
    assert_eq!(early["assignment"], "known", "{early:#}");
    let key = early["key"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| variant_key(&authz, early));
    assert_eq!(key, "declared:svc/app/services.py#RuleBook._ensure_access");
    // Declaring a check the unit only sometimes reaches does not make it known.
    assert_eq!(found("operand").1, "and_operand");
    let branch = unit(&authz, "svc/app/api/rules.py", "branch");
    assert_eq!(branch["assignment"], "unknown", "{branch:#}");
}

/// [STRICT] A unit is never known because of a name alone. A helper that refuses
/// someone and is named for a tenant (`ensure_org_access`), a 403 on the answer of a
/// function named for one (`owns_workspace`) and a dependency named for one that
/// rejects (`require_partner_tenant`, which lets every call that names no partner
/// tenant through) each read `known tenancy_check` / `tenancy_guard`. They are unknown, with
/// the check found by its name only, or with what the dependency's body really does.
#[test]
fn a_check_named_for_a_tenant_is_not_known_by_its_name() {
    let services = r#"from fastapi import HTTPException

from app import acl


def ensure_org_access(caller, rule_id):
    if not acl.allowed(caller, rule_id):
        raise HTTPException(status_code=403)


def owns_workspace(caller, rule_id):
    return acl.lookup(caller, rule_id)


class RuleBook:
    def __init__(self, caller):
        self.caller = caller
"#;
    let deps = r#"from fastapi import Depends, HTTPException, Request

from app.services import RuleBook


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller


def require_partner_tenant(request: Request, rule_id: str, caller=Depends(get_caller)):
    tenant = request.state.partner_tenant
    if not tenant:
        return
    if caller.tenant_id != tenant:
        raise HTTPException(status_code=403)
"#;
    let routes = r#"from fastapi import APIRouter, Depends, HTTPException

from app.deps import get_caller, require_partner_tenant
from app.services import ensure_org_access, owns_workspace

router = APIRouter(prefix="/rules")


@router.get("/named")
async def named(rule_id: str, caller=Depends(get_caller)):
    ensure_org_access(caller, rule_id)
    return []


@router.get("/answer")
async def answer(rule_id: str, user=Depends(get_caller)):
    if not owns_workspace(user, rule_id):
        raise HTTPException(status_code=403)
    return []


@router.get("/partner", dependencies=[Depends(require_partner_tenant)])
async def partner(rule_id: str, caller=Depends(get_caller)):
    return []
"#;
    let dir = service_repo(services, deps, routes);
    write(
        dir.path(),
        "svc/app/acl.py",
        "import requests\n\n\ndef allowed(caller, rule_id):\n    return requests.get(\"http://acl/allowed\").json()\n\n\ndef lookup(caller, rule_id):\n    return requests.get(\"http://acl/lookup\").json()\n",
    );
    let authz = concern_with_units(dir.path(), "authz");
    let found = |symbol: &str| {
        let u = unit(&authz, "svc/app/api/rules.py", symbol);
        assert_eq!(u["assignment"], "unknown", "{symbol}: {u:#}");
        let n = &u["not_proven"];
        (
            u["reason"].as_str().unwrap().to_string(),
            n["check"].as_str().unwrap_or_default().to_string(),
            n["obligation"].as_str().unwrap_or_default().to_string(),
        )
    };
    // A helper the proof of a guard does not hold to reject is a refusal nothing
    // names, as before.
    assert_eq!(found("named").0, "unclassified");
    assert_eq!(
        found("answer"),
        (
            "check_not_proven".to_string(),
            "tenancy_check:svc/app/services.py#owns_workspace".to_string(),
            "by_name_only".to_string()
        )
    );
    // The dependency's body was read: its check runs only when a partner tenant is
    // named.
    let partner = unit(&authz, "svc/app/api/rules.py", "partner");
    assert_eq!(
        (
            &partner["reason"],
            &partner["not_proven"]["check"],
            &partner["not_proven"]["obligation"],
            &partner["not_proven"]["when"]
        ),
        (
            &Value::from("check_not_proven"),
            &Value::from("tenancy_check:svc/app/deps.py#require_partner_tenant"),
            &Value::from("after_conditional_return"),
            &Value::from("not when not tenant")
        ),
        "{partner:#}"
    );
    assert_eq!(
        unit(&authz, "svc/app/api/rules.py", "answer")["not_proven"]["line"],
        "unknown: a tenant check was found by its name only (`owns_workspace`): no comparison of the caller with what is asked for was read in it"
    );
}

/// [STRICT] `none` is a claim that every body the request runs was read. Three ways
/// a check was not read, each of which read "no authorization" (second review, B4): a
/// constructor that hands on to its base's (`super().__init__`), the `__post_init__`
/// of a dataclass, and a service kept on `request.app.state`. The dataclass's check is
/// read where the class is built; the other two are unknown, never a none. A
/// `__post_init__` on a class that is no dataclass does not run.
#[test]
fn a_check_in_a_base_constructor_a_post_init_or_behind_app_state_is_never_a_none() {
    let services = r#"from dataclasses import dataclass


class ForbiddenError(Exception):
    pass


class Base:
    def __init__(self, caller, org_id):
        if org_id != caller.org_id:
            raise ForbiddenError("another organization")
        self.caller = caller


class ViaSuper(Base):
    def __init__(self, caller, org_id):
        super().__init__(caller, org_id)

    def rows(self):
        return []


@dataclass
class PostInit:
    caller: object
    org_id: str

    def __post_init__(self):
        if self.org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def rows(self):
        return []


class NotADataclass:
    def __post_init__(self):
        if self.org_id != self.caller.org_id:
            raise ForbiddenError("another organization")

    def rows(self):
        return []


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def list_checked(self, caller, org_id):
        if org_id != caller.org_id:
            raise ForbiddenError("another organization")
        return []
"#;
    let routes = r#"from fastapi import APIRouter, Depends, Request

from app.deps import get_caller
from app.services import NotADataclass, PostInit, ViaSuper

router = APIRouter(prefix="/rules")


@router.get("/super")
async def via_super(org_id: str, caller=Depends(get_caller)):
    return ViaSuper(caller, org_id).rows()


@router.get("/post")
async def post_init(org_id: str, caller=Depends(get_caller)):
    return PostInit(caller, org_id).rows()


@router.get("/post-again")
async def post_init_again(org_id: str, caller=Depends(get_caller)):
    return PostInit(caller, org_id).rows()


@router.get("/plain")
async def not_a_dataclass(caller=Depends(get_caller)):
    return NotADataclass().rows()


@router.get("/state")
async def app_state(org_id: str, request: Request, caller=Depends(get_caller)):
    return request.app.state.rules.list_checked(caller, org_id)
"#;
    let dir = service_repo(services, SERVICE_DEPS, routes);
    let authz = concern_with_units(dir.path(), "authz");
    assert_eq!(authz_of(&authz, "via_super").0, "unknown");
    assert_eq!(
        authz_of(&authz, "app_state"),
        ("unknown".to_string(), "body_unreadable".to_string())
    );
    for symbol in ["post_init", "post_init_again"] {
        assert_eq!(
            authz_of(&authz, symbol),
            (
                "known".to_string(),
                "tenancy_check:svc/app/services.py#PostInit.__post_init__".to_string()
            )
        );
    }
    assert_eq!(authz_of(&authz, "not_a_dataclass").0, "none");
}

/// [STRICT] A query filtered by a key named for a tenant is the tenant's scope only
/// where the value is the caller's own. `where: { orgId }` with `orgId` read from the
/// query string filters by whatever the request chose, and read `known
/// tenancy_filter:where.orgId` (second review, B6). Where the facts do not say where
/// the value came from, the filter is found and not proven: unknown, with the line
/// that says so.
#[test]
fn a_filter_by_a_tenant_key_of_unknown_source_is_found_not_proven() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "web/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"@prisma/client\": \"5.0.0\" } }",
    );
    write(
        r,
        "web/lib/session.ts",
        "export type Session = { token: string; orgId: string };\nexport async function getSession(): Promise<Session | null> {\n  return null;\n}\n",
    );
    write(
        r,
        "web/lib/db.ts",
        "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
    );
    write(
        r,
        "web/app/api/rules/route.ts",
        "import { NextRequest, NextResponse } from \"next/server\";\nimport { getSession } from \"../../../lib/session\";\nimport { prisma } from \"../../../lib/db\";\n\nexport async function GET(req: NextRequest) {\n  const session = await getSession();\n  if (!session) return NextResponse.json({ error: \"Unauthorized\" }, { status: 401 });\n  const orgId = req.nextUrl.searchParams.get(\"orgId\")!;\n  return NextResponse.json(await prisma.rule.findMany({ where: { orgId } }));\n}\n",
    );
    let authz = concern_with_units(r, "authz");
    let u = unit(&authz, "web/app/api/rules/route.ts", "GET");
    assert_eq!(
        (
            &u["assignment"],
            &u["reason"],
            &u["not_proven"]["check"],
            &u["not_proven"]["obligation"],
            &u["not_proven"]["line"]
        ),
        (
            &Value::from("unknown"),
            &Value::from("check_not_proven"),
            &Value::from("tenancy_filter:where.orgId"),
            &Value::from("sides_not_caller_and_resource"),
            &Value::from(
                "unknown: a query filtered by `orgId` was found but the value it filters by is not proven to be the caller's own"
            )
        ),
        "{u:#}"
    );
    // Nothing to name in `practices:`: the key is no symbol.
    assert!(u["not_proven"].get("config_hint").is_none(), "{u:#}");
}

/// The card of a file says which of its functions other files define too, with each
/// other copy's path and line: an agent changing one copy learns the change does not
/// reach the rest. A file that defines only its own (the two `load`s share a name and
/// nothing else) gets no such section.
/// A FastAPI service whose `rules` router is included twice, behind `require_admin`
/// under `guarded` and with nothing under `open`.
fn mounted_twice(r: &Path, guarded: &str, open: &str) {
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(
        r,
        "svc/app/deps.py",
        "from fastapi import Depends, HTTPException, Request\n\n\ndef get_caller(request: Request):\n    token = request.headers.get(\"authorization\")\n    if not token:\n        raise HTTPException(status_code=401, detail=\"unauthenticated\")\n    return request.state.caller\n\n\ndef require_admin(caller=Depends(get_caller)):\n    if caller.role != \"admin\":\n        raise HTTPException(status_code=403, detail=\"admins only\")\n    return caller\n",
    );
    write(
        r,
        "svc/app/rules.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.get(\"\")\nasync def list_rules():\n    return []\n",
    );
    write(
        r,
        "svc/app/main.py",
        &format!(
            "from fastapi import Depends, FastAPI\n\nfrom app.deps import require_admin\nfrom app.rules import router\n\napp = FastAPI()\napp.include_router(router, prefix=\"{guarded}\", dependencies=[Depends(require_admin)])\napp.include_router(router, prefix=\"{open}\")\n"
        ),
    );
}

/// A router mounted twice with different dependencies is two entry points, each with
/// the guards of its own mount, in `drift security`, on the card and in the practice
/// map, whichever prefix sorts first. The mount with no dependency is the one listed
/// as having no guard; it is never given the other mount's.
#[test]
fn a_router_mounted_twice_has_each_mounts_own_guards() {
    for (guarded, open) in [("/admin", "/public"), ("/zadmin", "/open")] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        mounted_twice(r, guarded, open);
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        let guards = |route: &str| -> Value {
            inv["entry_points"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["route"] == route)
                .unwrap_or_else(|| panic!("{route}: {inv}"))["guards"]
                .clone()
        };
        assert_eq!(
            guards(&format!("{guarded}/rules")),
            serde_json::json!(["require_admin", "get_caller"])
        );
        assert_eq!(guards(&format!("{open}/rules")), serde_json::json!([]));
        let text = drift(r, &["--no-cache", "security"]);
        assert!(
            text.starts_with("2 entry points (1 where Drift found no guard in what it read"),
            "{text}"
        );
        assert!(
            text.contains(&format!(
                "Entry points where Drift found no guard\n  http GET {open}/rules  svc/app/rules.py:6\n\n"
            )),
            "{text}"
        );
        let card = drift(r, &["--no-cache", "card", "svc/app/rules.py"]);
        assert!(
            card.contains(&format!(
                "  GET {guarded}/rules [http] list_rules: guards require_admin › get_caller;"
            )),
            "{card}"
        );
        assert!(
            card.contains(&format!(
                "  GET {open}/rules [http] list_rules: no guard found in what Drift read;"
            )),
            "{card}"
        );
        // The card's practice line is the file's most common answer, and says when
        // the file's entry points do not share it.
        assert!(
            card.contains("(1 of the 2 here; the others differ)"),
            "{card}"
        );

        // Two units in each concern of entry points: the guarded mount signs callers
        // in and checks a role, the open one does neither.
        let map: Value = serde_json::from_str(&drift(
            r,
            &["--no-cache", "practices", "--json", "--all", "--units"],
        ))
        .unwrap();
        let unit = |concern: &str, route: &str| -> Option<(String, String)> {
            let c = map["concerns"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == concern)
                .unwrap();
            let u = c["units"]
                .as_array()
                .unwrap()
                .iter()
                .find(|u| u["route"] == route)?;
            // The unit's own key where its variant stands for several one-off ways.
            let variant = match u["key"].as_str() {
                Some(key) => key.to_string(),
                None => c["variants"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|v| v["id"] == u["variant"])
                    .map(|v| v["key"].as_str().unwrap().to_string())
                    .unwrap_or_default(),
            };
            Some((u["assignment"].as_str().unwrap().to_string(), variant))
        };
        let (g, o) = (format!("{guarded}/rules"), format!("{open}/rules"));
        assert_eq!(
            unit("authn", &g),
            Some((
                "known".into(),
                "dependency:svc/app/deps.py#get_caller".into()
            ))
        );
        assert_eq!(unit("authn", &o).unwrap().0, "none");
        assert_eq!(
            unit("authz", &g),
            Some((
                "known".into(),
                "role_guard:svc/app/deps.py#require_admin".into()
            ))
        );
        // No one signs in on the open mount: it is no unit of authorization.
        assert_eq!(unit("authz", &o), None);
        for concern in ["errors", "api", "testing"] {
            assert!(
                unit(concern, &g).is_some() && unit(concern, &o).is_some(),
                "{concern}"
            );
        }
    }
}

/// Dependencies given at a mount that cannot be read (a variable, options spread into
/// the call) leave that mount's routes unknown: not unguarded, and not guarded by what
/// another mount of the same router adds.
#[test]
fn a_mount_whose_dependencies_cannot_be_read_is_unknown_not_another_mounts() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    mounted_twice(r, "/admin", "/public");
    write(
        r,
        "svc/app/main.py",
        "from fastapi import Depends, FastAPI\n\nfrom app.deps import require_admin\nfrom app.rules import router\n\nOPTIONS = {\"dependencies\": [Depends(require_admin)]}\n\napp = FastAPI()\napp.include_router(router, prefix=\"/admin\", dependencies=[Depends(require_admin)])\napp.include_router(router, prefix=\"/partner\", **OPTIONS)\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let row = |route: &str| -> Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["route"] == route)
            .unwrap()
            .clone()
    };
    assert_eq!(
        row("/admin/rules")["guards"],
        serde_json::json!(["require_admin", "get_caller"])
    );
    assert_eq!(row("/partner/rules")["guards"], serde_json::json!([]));
    assert_eq!(
        row("/partner/rules")["opaque"],
        serde_json::json!(["what its mount adds"])
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.starts_with("2 entry points (0 where Drift found no guard in what it read"),
        "{text}"
    );
    let map: Value = serde_json::from_str(&drift(
        r,
        &[
            "--no-cache",
            "practices",
            "--json",
            "--concern",
            "authn",
            "--units",
        ],
    ))
    .unwrap();
    let units = map["concerns"][0]["units"].as_array().unwrap();
    let of = |route: &str| units.iter().find(|u| u["route"] == route).unwrap();
    assert_eq!(of("/admin/rules")["assignment"], "known");
    assert_eq!(of("/partner/rules")["assignment"], "unknown");
    assert_eq!(of("/partner/rules")["reason"], "unresolved");
}

/// A test that asks for `/things03/7` tests the route `/things03/{thing_id}`: a
/// concrete segment is what a parameter takes. `/users/me` is the static route's and
/// leaves `/users/{user_id}` untested; a route no test asks for is never covered. A
/// tested handler that takes no input is known: validation, which has nothing to say
/// of it, is not asked.
#[test]
fn a_test_is_matched_to_the_parameterised_route_it_asks_for() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"pytest\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(
        r,
        "svc/app/things.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/things03\")\n\n\n@router.get(\"/{thing_id}\")\ndef read_thing(thing_id: int):\n    return {\"id\": thing_id}\n\n\n@router.delete(\"/{thing_id}\")\ndef drop_thing(thing_id: int):\n    return {}\n",
    );
    write(
        r,
        "svc/app/users.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/users\")\n\n\n@router.get(\"/me\")\ndef me():\n    return {}\n\n\n@router.get(\"/{user_id}\")\ndef one(user_id: str):\n    return {}\n\n\n@router.get(\"/{user_id}/files/{path:path}\")\ndef user_file(user_id: str, path: str):\n    return {}\n",
    );
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.things import router as things\nfrom app.users import router as users\n\napp = FastAPI()\napp.include_router(things)\napp.include_router(users, prefix=\"/v1\")\n\n\n@app.get(\"/health\")\ndef health():\n    return {\"ok\": True}\n",
    );
    write(
        r,
        "svc/tests/test_api.py",
        "from fastapi.testclient import TestClient\n\nfrom app.main import app\n\nclient = TestClient(app)\n\n\ndef test_thing():\n    client.get(\"/things03/7\")\n\n\ndef test_me():\n    client.get(\"/v1/users/me?verbose=1\")\n\n\ndef test_file():\n    client.get(\"/v1/users/7/files/a/b.txt\")\n\n\ndef test_health():\n    response = client.get(\"/health/\")\n    assert response.status_code == 200\n",
    );
    let map: Value = serde_json::from_str(&drift(
        r,
        &[
            "--no-cache",
            "practices",
            "--json",
            "--concern",
            "testing",
            "--units",
        ],
    ))
    .unwrap();
    let concern = &map["concerns"][0];
    let answer = |symbol: &str| -> String {
        let u = concern["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["symbol"] == symbol)
            .unwrap_or_else(|| panic!("{symbol}: {concern}"));
        let key = match u["key"].as_str() {
            Some(key) => key.to_string(),
            None => concern["variants"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == u["variant"])
                .map(|v| v["key"].as_str().unwrap().to_string())
                .unwrap_or_default(),
        };
        format!("{} {key}", u["assignment"].as_str().unwrap())
    };
    assert_eq!(answer("read_thing"), "known tested_none_asserted:pytest");
    // The same path with another method: not asked for.
    assert_eq!(answer("drop_thing"), "none none:untested");
    assert_eq!(answer("me"), "known tested_none_asserted:pytest");
    assert_eq!(answer("one"), "none none:untested");
    assert_eq!(answer("user_file"), "known tested_none_asserted:pytest");
    assert_eq!(answer("health"), "known tested_all_required:pytest");
    let card = drift(r, &["--no-cache", "card", "svc/app/things.py"]);
    assert!(
        card.contains("read_thing: covered by svc/tests/test_api.py"),
        "{card}"
    );
    assert!(card.contains("drop_thing: no test found"), "{card}");
}

/// An Express router mounted twice, once behind a guard: two entry points, each with
/// the middleware of its own mount, in `drift security` and in the practice map.
#[test]
fn an_express_router_mounted_twice_has_each_mounts_own_guards() {
    for (guarded, open) in [("/admin", "/public"), ("/zadmin", "/open")] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
        );
        write(
            r,
            "src/auth.ts",
            "export function requireAdmin(req: any, res: any, next: any) {\n  if (!req.headers.authorization) {\n    res.status(401).end();\n    return;\n  }\n  next();\n}\n",
        );
        write(
            r,
            "src/routes/users.ts",
            "import { Router } from \"express\";\n\nexport const users = Router();\nusers.get(\"/users\", (req, res) => {\n  res.json([]);\n});\n",
        );
        write(
            r,
            "src/app.ts",
            &format!(
                "import express from \"express\";\nimport {{ users }} from \"./routes/users\";\nimport {{ requireAdmin }} from \"./auth\";\n\nconst app = express();\napp.use(\"{guarded}\", requireAdmin, users);\napp.use(\"{open}\", users);\nexport default app;\n"
            ),
        );
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        let guards = |route: &str| -> Value {
            inv["entry_points"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["route"] == route)
                .unwrap_or_else(|| panic!("{route}: {inv}"))["guards"]
                .clone()
        };
        assert_eq!(
            guards(&format!("{guarded}/users")),
            serde_json::json!(["requireAdmin"])
        );
        assert_eq!(guards(&format!("{open}/users")), serde_json::json!([]));
        let text = drift(r, &["--no-cache", "security"]);
        assert!(
            text.starts_with("2 entry points (1 where Drift found no guard in what it read"),
            "{text}"
        );
        assert!(
            text.contains(&format!(
                "Entry points where Drift found no guard\n  http GET {open}/users  "
            )),
            "{text}"
        );
        let map: Value = serde_json::from_str(&drift(
            r,
            &[
                "--no-cache",
                "practices",
                "--json",
                "--concern",
                "authn",
                "--units",
            ],
        ))
        .unwrap();
        let units = map["concerns"][0]["units"].as_array().unwrap();
        let of = |route: &str| -> &str {
            units
                .iter()
                .find(|u| u["route"] == route)
                .unwrap_or_else(|| panic!("{route}: {units:?}"))["assignment"]
                .as_str()
                .unwrap()
        };
        assert_eq!(of(&format!("{guarded}/users")), "known");
        assert_eq!(of(&format!("{open}/users")), "none");
    }
}

#[test]
fn the_card_of_a_file_names_the_other_copies_of_its_helpers() {
    let dir = copied_repo();
    let card = drift(
        dir.path(),
        &["--no-cache", "card", "services/billing/app/client.py"],
    );
    assert!(
        card.contains(
            "Defined elsewhere too (facts, not rules; a change here does not reach the copies):\n  fetch_json:6 is also at services/orders/app/client.py:7; the copies share 2 call(s)\nNot known: "
        ),
        "{card}"
    );
    assert!(!card.contains("No answer for this file"), "{card}");
    let other = drift(
        dir.path(),
        &["--no-cache", "card", "services/orders/app/client.py"],
    );
    assert!(
        other.contains("  fetch_json:7 is also at services/billing/app/client.py:6; "),
        "{other}"
    );
    let own = drift(
        dir.path(),
        &["--no-cache", "card", "services/billing/app/files.py"],
    );
    assert!(!own.contains("Defined elsewhere too"), "{own}");
}

/// [STRICT] A `none` for authorization says every body the unit runs was read and none
/// turns a caller away or scopes what it reads. The second review (B4) showed it said
/// of a tenant check in a shape the facts did not hold: a mismatch that raises a class
/// not named for a refusal (`RuleNotFoundError`, `ValueError`), a comparison bound to
/// a name first, `if same: return rule` followed by the raise, `any(...)`, an
/// `assert`, a method that hands back `None`, a comprehension filter, SQL written as
/// text, a relationship of the caller. A mismatch that raises a class not named for
/// a refusal is a tenant check found and not proven (nothing says the other side is
/// the caller's); the others are unknown, never a recorded absence. A body that
/// refuses only on what names no tenant, owner or role (`if rule is None`, `if
/// rule.status != "active"`) is still a none.
#[test]
fn a_tenant_check_in_a_shape_the_facts_do_not_hold_is_never_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(
        r,
        "svc/app/api/rules.py",
        r#"from fastapi import APIRouter, Depends, HTTPException

from app import repo
from app.deps import RuleBookDep, get_caller

router = APIRouter(prefix="/rules")


@router.get("/hidden/{rule_id}")
async def hidden(rule_id: int, service: RuleBookDep):
    return service.hidden(rule_id)


@router.get("/value_error/{rule_id}")
async def value_error(rule_id: int, service: RuleBookDep):
    return service.value_error(rule_id)


@router.get("/flag/{rule_id}")
async def flag(rule_id: int, service: RuleBookDep):
    return service.flag(rule_id)


@router.get("/return_then_raise/{rule_id}")
async def return_then_raise(rule_id: int, service: RuleBookDep):
    return service.return_then_raise(rule_id)


@router.get("/else_raise/{rule_id}")
async def else_raise(rule_id: int, service: RuleBookDep):
    return service.else_raise(rule_id)


@router.get("/any_membership/{rule_id}")
async def any_membership(rule_id: int, service: RuleBookDep):
    return service.any_membership(rule_id)


@router.get("/always_forbidden/{rule_id}")
async def always_forbidden(rule_id: int, service: RuleBookDep):
    return service.always_forbidden(rule_id)


@router.get("/or_none/{rule_id}")
async def or_none(rule_id: int, service: RuleBookDep):
    rule = service.or_none(rule_id)
    if rule is None:
        raise HTTPException(status_code=404)
    return rule


@router.get("/asserted/{rule_id}")
async def asserted(rule_id: int, service: RuleBookDep):
    return service.asserted(rule_id)


@router.get("/comprehension")
async def comprehension(service: RuleBookDep):
    return service.comprehension()


@router.get("/raw_sql")
async def raw_sql(service: RuleBookDep):
    return service.raw_sql()


@router.get("/relationship")
async def relationship(service: RuleBookDep):
    return service.relationship()


@router.get("/handler_return_then_raise/{rule_id}")
async def handler_return_then_raise(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    if rule.org_id == caller.org_id:
        return rule
    raise HTTPException(status_code=404)


@router.get("/handler_ternary/{rule_id}")
async def handler_ternary(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    return rule if rule.org_id == caller.org_id else None


@router.get("/missing/{rule_id}")
async def missing(rule_id: int, service: RuleBookDep):
    return service.missing(rule_id)


@router.get("/archived/{rule_id}")
async def archived(rule_id: int, service: RuleBookDep):
    return service.archived(rule_id)


@router.get("/everything")
async def everything(service: RuleBookDep):
    return service.everything()
"#,
    );
    write(
        r,
        "svc/app/deps.py",
        r#"from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.services import RuleBook


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller


def get_rule_book(caller=Depends(get_caller)) -> RuleBook:
    return RuleBook(caller)


RuleBookDep = Annotated[RuleBook, Depends(get_rule_book)]
"#,
    );
    write(
        r,
        "svc/app/main.py",
        r#"from fastapi import FastAPI

from app.api.rules import router

app = FastAPI()
app.include_router(router)
"#,
    );
    write(
        r,
        "svc/app/models.py",
        r#"from sqlalchemy.orm import DeclarativeBase, Mapped


class Base(DeclarativeBase):
    pass


class Rule(Base):
    __tablename__ = "rules"
    id: Mapped[int]
    org_id: Mapped[str]
    status: Mapped[str]
"#,
    );
    write(
        r,
        "svc/app/repo.py",
        r#"from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Rule

db = Session()


def get_rule(rule_id):
    return db.get(Rule, rule_id)


def all_rules():
    return db.execute(select(Rule)).scalars().all()
"#,
    );
    write(
        r,
        "svc/app/services.py",
        r#"from fastapi import HTTPException
from sqlalchemy import text

from app import repo


class RuleNotFoundError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def hidden(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule is None or rule.org_id != self.caller.org_id:
            raise RuleNotFoundError(rule_id)
        return rule

    def value_error(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule.org_id != self.caller.org_id:
            raise ValueError("rule belongs to another organization")
        return rule

    def flag(self, rule_id):
        rule = repo.get_rule(rule_id)
        same = rule.org_id == self.caller.org_id
        if not same:
            raise HTTPException(status_code=404)
        return rule

    def return_then_raise(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule.org_id == self.caller.org_id:
            return rule
        raise HTTPException(status_code=404)

    def else_raise(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule.org_id == self.caller.org_id:
            return rule
        else:
            raise RuleNotFoundError(rule_id)

    def any_membership(self, rule_id):
        rule = repo.get_rule(rule_id)
        if not any(m.org_id == rule.org_id for m in self.caller.memberships):
            raise RuleNotFoundError(rule_id)
        return rule

    def always_forbidden(self, rule_id):
        raise HTTPException(status_code=403)

    def or_none(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule.org_id != self.caller.org_id:
            return None
        return rule

    def asserted(self, rule_id):
        rule = repo.get_rule(rule_id)
        assert rule.org_id == self.caller.org_id, "another organization"
        return rule

    def comprehension(self):
        return [r for r in repo.all_rules() if r.org_id == self.caller.org_id]

    def raw_sql(self):
        return repo.db.execute(
            text("SELECT * FROM rules WHERE org_id = :org"), {"org": self.caller.org_id}
        ).all()

    def relationship(self):
        return self.caller.organization.rules

    def missing(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule is None:
            raise RuleNotFoundError(rule_id)
        return rule

    def archived(self, rule_id):
        rule = repo.get_rule(rule_id)
        if rule.status != "active":
            raise ValueError("archived")
        assert rule is not None
        return rule

    def everything(self):
        return repo.all_rules()
"#,
    );
    write(
        r,
        "svc/pyproject.toml",
        r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
    );
    let authz = concern_with_units(r, "authz");
    for symbol in ["hidden", "value_error"] {
        let u = unit(&authz, "svc/app/api/rules.py", symbol);
        assert_eq!(
            (
                u["assignment"].as_str(),
                u["reason"].as_str(),
                u["not_proven"]["check"].as_str(),
                u["not_proven"]["obligation"].as_str()
            ),
            (
                Some("unknown"),
                Some("check_not_proven"),
                Some(format!("tenancy_check:svc/app/services.py#RuleBook.{symbol}").as_str()),
                Some("sides_not_caller_and_resource")
            )
        );
    }
    for symbol in [
        "flag",
        "return_then_raise",
        "else_raise",
        "any_membership",
        "always_forbidden",
        "or_none",
        "asserted",
        "comprehension",
        "raw_sql",
        "relationship",
        "handler_ternary",
    ] {
        assert_eq!(
            authz_of(&authz, symbol),
            ("unknown".to_string(), "unclassified".to_string()),
            "{symbol}"
        );
    }
    // In the handler itself, the refusal that follows an `if` returning for the
    // caller's own organisation is the comparison made the other way round, and
    // is read as that check (Python lowering 71).
    assert_eq!(
        authz_of(&authz, "handler_return_then_raise"),
        (
            "known".to_string(),
            "tenancy_check:claim:.org_id".to_string()
        )
    );
    for symbol in ["missing", "archived", "everything"] {
        assert_eq!(authz_of(&authz, symbol).0, "none", "{symbol}");
    }
}

/// [STRICT] A `none` for authentication says every dependency expression on the
/// route, its router and each mount was read. The second review (B2, S4) showed it
/// said of a route whose dependencies are a list bound to a name (`dependencies=
/// COMMON`), spread or concatenated, of `Depends(GUARDS[MODE])`, of
/// `Depends(getattr(deps, "require_admin"))`, and of a guard passed into an app
/// factory (`Depends(guard)` in `create_app(guard)`). Each may be the guard: unknown.
/// A generic class (`Depends(Loader[Rule])`) is still read, and a route with no
/// dependency at all is still a none.
#[test]
fn a_dependency_expression_that_cannot_be_read_is_never_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(
        r,
        "svc/app/api/rules.py",
        r#"from fastapi import APIRouter, Depends

from app import deps
from app.deps import Loader, Rule, get_caller, require_admin

GUARDS = {"admin": require_admin, "member": get_caller}
MODE = "admin"
COMMON = [Depends(require_admin)]

router = APIRouter(prefix="/rules")
listed = APIRouter(prefix="/listed", dependencies=COMMON)
spread = APIRouter(prefix="/spread", dependencies=[*COMMON])
factory_router = APIRouter(prefix="/factory")


@router.get("/lookup")
async def lookup(caller=Depends(GUARDS[MODE])):
    return []


@router.get("/attribute")
async def attribute(caller=Depends(getattr(deps, "require_admin"))):
    return []


@router.get("/route_list", dependencies=COMMON)
async def route_list():
    return []


@router.get("/route_spread", dependencies=[*COMMON])
async def route_spread():
    return []


@router.get("/route_concat", dependencies=COMMON + [Depends(get_caller)])
async def route_concat():
    return []


@listed.get("/a")
async def router_list():
    return []


@spread.get("/a")
async def router_spread():
    return []


@factory_router.get("/a")
async def passed_guard():
    return []


@router.get("/open")
async def nothing():
    return []


@router.get("/guarded")
async def guarded(caller=Depends(get_caller)):
    return []


@router.get("/generic")
async def generic(loader=Depends(Loader[Rule])):
    return []
"#,
    );
    write(
        r,
        "svc/app/deps.py",
        r#"from fastapi import Depends, HTTPException, Request


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller


def require_admin(caller=Depends(get_caller)):
    if caller.role != "admin":
        raise HTTPException(status_code=403, detail="admins only")
    return caller


class Rule:
    pass


class Loader[T]:
    def __init__(self, request: Request):
        if not request.headers.get("authorization"):
            raise HTTPException(status_code=401, detail="unauthenticated")
        self.request = request
"#,
    );
    write(
        r,
        "svc/app/main.py",
        r#"from fastapi import Depends, FastAPI

from app.api.rules import factory_router, listed, router, spread
from app.deps import get_caller


def create_app(guard):
    application = FastAPI()
    application.include_router(router)
    application.include_router(listed)
    application.include_router(spread)
    application.include_router(factory_router, dependencies=[Depends(guard)])
    return application


app = create_app(get_caller)
"#,
    );
    write(
        r,
        "svc/pyproject.toml",
        r#"[project]
name = "svc"
dependencies = ["fastapi"]
"#,
    );
    let authn = concern_with_units(r, "authn");
    for symbol in [
        "lookup",
        "attribute",
        "route_list",
        "route_spread",
        "route_concat",
        "router_list",
        "router_spread",
        "passed_guard",
    ] {
        assert_eq!(
            authz_of(&authn, symbol),
            ("unknown".to_string(), "unresolved".to_string()),
            "{symbol}"
        );
    }
    assert_eq!(authz_of(&authn, "nothing").0, "none");
    assert_eq!(
        authz_of(&authn, "guarded"),
        (
            "known".to_string(),
            "dependency:svc/app/deps.py#get_caller".to_string()
        )
    );
    assert_eq!(
        authz_of(&authn, "generic"),
        (
            "known".to_string(),
            "dependency:svc/app/deps.py#Loader".to_string()
        )
    );
}

/// [STRICT] Authentication done only in middleware read `none` (second review, B1),
/// and with it the route dropped out of the authorization population. The
/// application's middleware is read: a function registered with
/// `@app.middleware("http")` or a class given to `app.add_middleware(...)` is the
/// guard where it answers 401 for every request; one that lets a list of paths
/// through first, and a package's middleware that is not on the closed list of
/// non-auth ones, may be the guard (unknown); CORS, gzip and a request-context
/// function leave a none a none. A 403 the middleware answers is read by
/// authorization as a dependency's is. An auth library's Next.js middleware given a
/// callback (`clerkMiddleware(async (auth, req) => ...)`) is unknown; bare, it
/// protects nothing.
#[test]
fn authentication_in_middleware_is_read_and_never_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "clerk_bare/app/api/rules/route.ts",
        r#"import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([]);
}
"#,
    );
    write(
        r,
        "clerk_bare/middleware.ts",
        r#"import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = { matcher: ["/((?!_next).*)"] };
"#,
    );
    write(
        r,
        "clerk_bare/package.json",
        r#"{ "name": "clerk_bare", "dependencies": { "next": "15.0.0", "@clerk/nextjs": "6.0.0" } }
"#,
    );
    write(
        r,
        "clerk_callback/app/api/rules/route.ts",
        r#"import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([]);
}
"#,
    );
    write(
        r,
        "clerk_callback/middleware.ts",
        r#"import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = { matcher: ["/((?!_next).*)"] };
"#,
    );
    write(
        r,
        "clerk_callback/package.json",
        r#"{ "name": "clerk_callback", "dependencies": { "next": "15.0.0", "@clerk/nextjs": "6.0.0" } }
"#,
    );
    write(r, "cls/app/__init__.py", "");
    write(
        r,
        "cls/app/main.py",
        r#"from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.routes import router


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if not request.headers.get("authorization"):
            return JSONResponse({"detail": "unauthenticated"}, status_code=401)
        if request.state.caller.role != "admin":
            return JSONResponse({"detail": "forbidden"}, status_code=403)
        return await call_next(request)


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])
app.add_middleware(AuthMiddleware)
app.include_router(router)
"#,
    );
    write(
        r,
        "cls/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []
"#,
    );
    write(
        r,
        "cls/pyproject.toml",
        r#"[project]
name = "cls"
dependencies = ["fastapi", "tenantauth"]
"#,
    );
    write(
        r,
        "custom/app/api/rules/route.ts",
        r#"import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([]);
}
"#,
    );
    write(
        r,
        "custom/lib/session.ts",
        r#"export type Session = { token: string; role: string };
export async function getSession(): Promise<Session | null> {
  return null;
}
"#,
    );
    write(
        r,
        "custom/middleware.ts",
        r#"import { NextRequest, NextResponse } from "next/server";
import { getSession } from "./lib/session";

export async function middleware(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
"#,
    );
    write(
        r,
        "custom/package.json",
        r#"{ "name": "custom", "dependencies": { "next": "15.0.0", "@clerk/nextjs": "6.0.0" } }
"#,
    );
    write(r, "fn/app/__init__.py", "");
    write(
        r,
        "fn/app/main.py",
        r#"from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routes import router

app = FastAPI()
app.include_router(router)


@app.middleware("http")
async def require_token(request: Request, call_next):
    token = request.headers.get("authorization")
    if not token:
        return JSONResponse({"detail": "unauthenticated"}, status_code=401)
    if request.url.path.startswith("/admin") and request.state.caller.role != "admin":
        return JSONResponse({"detail": "forbidden"}, status_code=403)
    return await call_next(request)
"#,
    );
    write(
        r,
        "fn/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []
"#,
    );
    write(
        r,
        "fn/pyproject.toml",
        r#"[project]
name = "fn"
dependencies = ["fastapi", "tenantauth"]
"#,
    );
    write(r, "pkg/app/__init__.py", "");
    write(
        r,
        "pkg/app/main.py",
        r#"from fastapi import FastAPI
from tenantauth import TenantAuthMiddleware

from app.routes import router

app = FastAPI()
app.add_middleware(TenantAuthMiddleware, issuer="https://issuer.example")
app.include_router(router)
"#,
    );
    write(
        r,
        "pkg/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []
"#,
    );
    write(
        r,
        "pkg/pyproject.toml",
        r#"[project]
name = "pkg"
dependencies = ["fastapi", "tenantauth"]
"#,
    );
    write(r, "plain/app/__init__.py", "");
    write(
        r,
        "plain/app/main.py",
        r#"from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.routes import router


async def request_context(request: Request, call_next):
    request.state.trace_id = request.headers.get("x-request-id") or str(uuid4())
    return await call_next(request)


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])
app.add_middleware(GZipMiddleware)
app.middleware("http")(request_context)
app.include_router(router)
"#,
    );
    write(
        r,
        "plain/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []
"#,
    );
    write(
        r,
        "plain/pyproject.toml",
        r#"[project]
name = "plain"
dependencies = ["fastapi", "tenantauth"]
"#,
    );
    write(r, "public/app/__init__.py", "");
    write(
        r,
        "public/app/main.py",
        r#"from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routes import router

PUBLIC = ("/health", "/docs")

app = FastAPI()
app.include_router(router)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path in PUBLIC:
        return await call_next(request)
    if not request.headers.get("authorization"):
        return JSONResponse({"detail": "unauthenticated"}, status_code=401)
    return await call_next(request)
"#,
    );
    write(
        r,
        "public/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []
"#,
    );
    write(
        r,
        "public/pyproject.toml",
        r#"[project]
name = "public"
dependencies = ["fastapi", "tenantauth"]
"#,
    );
    let assigned = |concern: &Value, service: &str| -> (String, String, String) {
        let u = concern["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| {
                u["path"]
                    .as_str()
                    .unwrap()
                    .starts_with(&format!("{service}/"))
            })
            .unwrap_or_else(|| panic!("no unit of {service}"));
        let assignment = u["assignment"].as_str().unwrap().to_string();
        let what = match assignment.as_str() {
            "known" => match u["key"].as_str() {
                Some(key) => key.to_string(),
                None => variant_key(concern, u),
            },
            "unknown" => u["reason"].as_str().unwrap().to_string(),
            _ => String::new(),
        };
        let obligation = u["not_proven"]["obligation"]
            .as_str()
            .unwrap_or("")
            .to_string();
        (assignment, what, obligation)
    };
    let known = |key: &str| ("known".to_string(), key.to_string(), String::new());
    let unknown = |reason: &str| ("unknown".to_string(), reason.to_string(), String::new());
    let authn = concern_with_units(r, "authn");
    assert_eq!(
        assigned(&authn, "fn"),
        known("middleware:fn/app/main.py#require_token")
    );
    assert_eq!(
        assigned(&authn, "cls"),
        known("middleware:cls/app/main.py#AuthMiddleware")
    );
    assert_eq!(assigned(&authn, "public"), unknown("unresolved"));
    assert_eq!(assigned(&authn, "pkg"), unknown("opaque_wrapper"));
    assert_eq!(assigned(&authn, "plain").0, "none");
    assert_eq!(assigned(&authn, "clerk_callback"), unknown("unclassified"));
    assert_eq!(assigned(&authn, "clerk_bare").0, "none");
    assert_eq!(
        assigned(&authn, "custom"),
        known("middleware:custom/middleware.ts#middleware")
    );
    let authz = concern_with_units(r, "authz");
    // The 403 for `/admin` paths only is found, not proven; the one every request
    // meets is the unit's role guard.
    assert_eq!(
        assigned(&authz, "fn"),
        (
            "unknown".to_string(),
            "check_not_proven".to_string(),
            "and_operand".to_string()
        )
    );
    assert_eq!(
        assigned(&authz, "cls"),
        known("role_guard:cls/app/main.py#AuthMiddleware")
    );
    assert_eq!(
        assigned(&authz, "custom"),
        known("role_guard:custom/middleware.ts#middleware")
    );
}

/// A route that answers what a helper returns is read through that helper, and only
/// through that one. `await readSession(request)` (whose catch answers 401) followed
/// by `return fetch(url)` or `return passThrough(url)` read `in_body_try` (second
/// review, S3): the helper followed was the only one that builds responses, not the
/// one whose call the route returns. Nothing catches what the fetch throws: the
/// framework's default answers. A route that returns the call of a helper that
/// catches and answers has that helper's handling.
#[test]
fn the_helper_followed_for_errors_is_the_one_whose_call_the_route_returns() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "web/app/api/fetched/route.ts",
        r#"import { NextRequest } from "next/server";
import { readSession } from "../../../lib/session";

export async function GET(request: NextRequest) {
  await readSession(request);
  return fetch("http://backend/x");
}
"#,
    );
    write(
        r,
        "web/app/api/passed/route.ts",
        r#"import { NextRequest } from "next/server";
import { readSession } from "../../../lib/session";
import { passThrough } from "../../../lib/work";

export async function GET(request: NextRequest) {
  await readSession(request);
  return passThrough("http://backend/x");
}
"#,
    );
    write(
        r,
        "web/app/api/proxied/route.ts",
        r#"import { NextRequest } from "next/server";
import { readSession } from "../../../lib/session";
import { proxyRequest } from "../../../lib/work";

export async function GET(request: NextRequest) {
  await readSession(request);
  return proxyRequest(request);
}
"#,
    );
    write(
        r,
        "web/lib/session.ts",
        r#"import { NextRequest, NextResponse } from "next/server";

export async function readSession(request: NextRequest) {
  try {
    const token = request.headers.get("authorization");
    return JSON.parse(atob(token ?? ""));
  } catch (error) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }
}
"#,
    );
    write(
        r,
        "web/lib/work.ts",
        r#"import { NextRequest, NextResponse } from "next/server";

export async function passThrough(url: string) {
  return fetch(url);
}

export async function proxyRequest(request: NextRequest) {
  try {
    return await fetch("http://backend/x", { headers: request.headers });
  } catch (error) {
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  }
}
"#,
    );
    write(
        r,
        "web/package.json",
        r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }
"#,
    );
    let errors = concern_with_units(r, "errors");
    let key = |route: &str| {
        let u = unit(&errors, &format!("web/app/api/{route}/route.ts"), "GET");
        assert_eq!(u["assignment"], "known", "{u:#}");
        match u["key"].as_str() {
            Some(key) => key.to_string(),
            None => variant_key(&errors, u),
        }
    };
    assert_eq!(key("fetched"), "bubble:framework_default");
    assert_eq!(key("passed"), "bubble:framework_default");
    assert_eq!(key("proxied"), "in_body_try:pkg:next#NextResponse.json");
}

/// [STRICT] A NestJS route that returns a call of a method of its own controller
/// (`return this.load(id)`, `return await this.load(id)`, the method private or
/// not) whose body catches and hands back a fallback answers what that method
/// answers: never `bubble` (the framework's 500). Which method of the class
/// catches is not read apart from its class: unknown (`not_followed`). A
/// controller none of whose methods catches stays `bubble`.
#[test]
fn a_nest_route_returning_its_own_method_whose_body_catches_is_not_bubble() {
    let controller = |call: &str, helper: &str| {
        format!(
            "import {{ Controller, Get, Param }} from \"@nestjs/common\";\nimport {{ prisma }} from \"./db\";\n@Controller(\"items\")\nexport class ItemsController {{\n  @Get(\":id\")\n  async one(@Param(\"id\") id: string) {{\n    {call}\n  }}\n{helper}}}\n"
        )
    };
    let catching = "  private async load(id: string) {\n    try {\n      return await prisma.item.findFirst({ where: { id } });\n    } catch {\n      return null;\n    }\n  }\n";
    let plain = "  private async load(id: string) {\n    return prisma.item.findFirst({ where: { id } });\n  }\n";
    for (what, call, helper, want) in [
        ("returned", "return this.load(id);", catching, "unknown"),
        (
            "returned awaited",
            "return await this.load(id);",
            catching,
            "unknown",
        ),
        (
            "public",
            "return this.load(id);",
            &catching.replace("private ", "") as &str,
            "unknown",
        ),
        ("no catch", "return this.load(id);", plain, "known"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "package.json",
            "{ \"name\": \"api\", \"dependencies\": { \"@nestjs/common\": \"10.0.0\", \"@nestjs/core\": \"10.0.0\", \"@prisma/client\": \"5.20.0\" } }\n",
        );
        write(
            r,
            "src/db.ts",
            "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
        );
        write(r, "src/items.controller.ts", &controller(call, helper));
        let errors = concern_with_units(r, "errors");
        let u = unit(&errors, "src/items.controller.ts", "GET /items/:id");
        assert_eq!(u["assignment"], want, "{what}: {u:#}");
        if want == "known" {
            let key = u["key"]
                .as_str()
                .map_or_else(|| variant_key(&errors, u), str::to_string);
            assert_eq!(key, "bubble:framework_default", "{what}");
        } else {
            assert_eq!(u["reason"], "not_followed", "{what}: {u:#}");
        }
    }
}

/// [STRICT] Three more places a guard was and `none` was said (the acceptance
/// suite's public authn cases). A Flask `before_request` hook that returns early for
/// some endpoints and answers 401 for the rest is not proven to guard every route,
/// and may guard this one: unknown. A FastAPI app built in a factory under the name
/// the module also binds (`app = FastAPI(dependencies=[...])` in `create_app()`,
/// `app = create_app()` below) lost its own dependencies: the name is the factory's,
/// so a dependency written there is read, and one taken from a settings object is
/// unknown. An Express list of handlers spread into a mount (`app.use("/api",
/// ...apiGuards, router)`) is read through its elements; a list built by a call is
/// unknown.
#[test]
fn a_conditional_hook_a_factory_app_and_a_spread_list_of_guards_are_never_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "api/package.json",
        r#"{ "name": "api", "dependencies": { "express": "4.19.0" } }
"#,
    );
    write(
        r,
        "api/src/app.ts",
        r#"import express from "express";
import { buildGuards, requireAuth } from "./auth";
import { projects } from "./projects";
import { teams } from "./teams";

const app = express();
const apiGuards = [express.json(), requireAuth];
const built = buildGuards();

app.use("/api/projects", ...apiGuards, projects);
app.use("/api/teams", ...built, teams);
app.listen(3000);
"#,
    );
    write(
        r,
        "api/src/auth.ts",
        r#"import type { NextFunction, Request, Response } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.headers.authorization) return res.status(401).json({ error: "unauthenticated" });
  next();
}

export function buildGuards() {
  return [requireAuth];
}
"#,
    );
    write(
        r,
        "api/src/projects.ts",
        r#"import { Router } from "express";

export const projects = Router();

projects.get("/", async (_req, res) => {
  res.json([]);
});
"#,
    );
    write(
        r,
        "api/src/teams.ts",
        r#"import { Router } from "express";

export const teams = Router();

teams.get("/", async (_req, res) => {
  res.json([]);
});
"#,
    );
    write(r, "factory/app/__init__.py", "");
    write(
        r,
        "factory/app/configured.py",
        r#"from fastapi import Depends, FastAPI

from app.routes import open_router


def build(settings) -> FastAPI:
    app = FastAPI(dependencies=[Depends(settings.auth_dependency)])
    app.include_router(open_router)
    return app
"#,
    );
    write(
        r,
        "factory/app/deps.py",
        r#"from fastapi import HTTPException, Request


def get_caller(request: Request):
    if not request.headers.get("authorization"):
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller
"#,
    );
    write(
        r,
        "factory/app/main.py",
        r#"from fastapi import Depends, FastAPI

from app.deps import get_caller
from app.routes import router


def create_app() -> FastAPI:
    app = FastAPI(dependencies=[Depends(get_caller)])
    app.include_router(router)
    return app


app = create_app()
"#,
    );
    write(
        r,
        "factory/app/routes.py",
        r#"from fastapi import APIRouter

router = APIRouter()
open_router = APIRouter()


@router.get("/rules")
async def list_rules():
    return []


@open_router.get("/status")
async def status():
    return {}
"#,
    );
    write(
        r,
        "factory/pyproject.toml",
        r#"[project]
name = "factory"
dependencies = ["fastapi"]
"#,
    );
    write(
        r,
        "flask/app.py",
        r#"from flask import Flask, g, jsonify, request

app = Flask(__name__)
sessions = {}


@app.before_request
def require_session():
    if request.endpoint == "static":
        return None
    user = sessions.get(request.cookies.get("sid"))
    if user is None:
        return jsonify(error="unauthenticated"), 401
    g.user = user


@app.get("/projects")
def list_projects():
    return jsonify([])
"#,
    );
    write(
        r,
        "flask/pyproject.toml",
        r#"[project]
name = "flask"
dependencies = ["flask"]
"#,
    );
    let authn = concern_with_units(r, "authn");
    let assigned = |path: &str, symbol: &str| -> (String, String) {
        let u = unit(&authn, path, symbol);
        let assignment = u["assignment"].as_str().unwrap().to_string();
        let what = match assignment.as_str() {
            "known" => match u["key"].as_str() {
                Some(key) => key.to_string(),
                None => variant_key(&authn, u),
            },
            "unknown" => u["reason"].as_str().unwrap().to_string(),
            _ => String::new(),
        };
        (assignment, what)
    };
    let unknown = ("unknown".to_string(), "unresolved".to_string());
    assert_eq!(assigned("flask/app.py", "list_projects"), unknown);
    assert_eq!(
        assigned("factory/app/routes.py", "list_rules"),
        (
            "known".to_string(),
            "dependency:factory/app/deps.py#get_caller".to_string()
        )
    );
    assert_eq!(assigned("factory/app/routes.py", "status"), unknown);
    assert_eq!(
        assigned("api/src/projects.ts", "GET /"),
        (
            "known".to_string(),
            "wrap:api/src/auth.ts#requireAuth".to_string()
        )
    );
    assert_eq!(assigned("api/src/teams.ts", "GET /"), unknown);
}

/// [STRICT] A check in an `async def` that the handler calls without `await` never
/// runs: the call builds a coroutine and drops it. The route read `known tenancy
/// check` (second review, S1 k07). The check is found and not proven (`not_awaited`);
/// the same call awaited is the unit's tenant check.
#[test]
fn a_check_whose_call_is_not_awaited_is_found_not_proven() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(
        r,
        "svc/app/api/rules.py",
        r#"from fastapi import APIRouter, Depends

from app import repo
from app.deps import get_caller
from app.helpers import assert_rule_org

router = APIRouter(prefix="/rules")


@router.get("/forgotten/{rule_id}")
async def forgotten(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    assert_rule_org(rule, caller)
    return rule


@router.get("/awaited/{rule_id}")
async def awaited(rule_id: int, caller=Depends(get_caller)):
    rule = repo.get_rule(rule_id)
    await assert_rule_org(rule, caller)
    return rule
"#,
    );
    write(
        r,
        "svc/app/deps.py",
        r#"from fastapi import HTTPException, Request


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller
"#,
    );
    write(
        r,
        "svc/app/helpers.py",
        r#"from fastapi import HTTPException


async def assert_rule_org(rule, caller):
    if rule.org_id != caller.org_id:
        raise HTTPException(status_code=403, detail="another organization")
"#,
    );
    write(
        r,
        "svc/app/main.py",
        r#"from fastapi import FastAPI

from app.api.rules import router

app = FastAPI()
app.include_router(router)
"#,
    );
    write(
        r,
        "svc/app/models.py",
        r#"from sqlalchemy.orm import DeclarativeBase, Mapped


class Base(DeclarativeBase):
    pass


class Rule(Base):
    __tablename__ = "rules"
    id: Mapped[int]
    org_id: Mapped[str]
    status: Mapped[str]
"#,
    );
    write(
        r,
        "svc/app/repo.py",
        r#"from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Rule

db = Session()


def get_rule(rule_id):
    return db.get(Rule, rule_id)


def all_rules():
    return db.execute(select(Rule)).scalars().all()
"#,
    );
    write(
        r,
        "svc/pyproject.toml",
        r#"[project]
name = "svc"
dependencies = ["fastapi", "sqlalchemy"]
"#,
    );
    let authz = concern_with_units(r, "authz");
    let u = unit(&authz, "svc/app/api/rules.py", "forgotten");
    assert_eq!(
        (
            u["assignment"].as_str(),
            u["reason"].as_str(),
            u["not_proven"]["check"].as_str(),
            u["not_proven"]["obligation"].as_str()
        ),
        (
            Some("unknown"),
            Some("check_not_proven"),
            Some("tenancy_check:svc/app/helpers.py#assert_rule_org"),
            Some("not_awaited")
        ),
        "{u:#}"
    );
    assert_eq!(
        authz_of(&authz, "awaited"),
        (
            "known".to_string(),
            "tenancy_check:svc/app/helpers.py#assert_rule_org".to_string()
        )
    );
}

/// [STRICT] A Next.js route that answers some requests before its tenant check
/// (`if (preview) return NextResponse.json(...)` and then the 403 on a mismatch) does
/// not check those requests. It read `known tenancy check` (second review, B5; the
/// TypeScript lowering knew a check under a branch, not one after a branch that
/// returns). The check is found and not proven. A branch that turns the caller away
/// (a 400 on a missing id) leaves the check that follows the unit's own.
#[test]
fn a_typescript_check_after_a_branch_that_answers_is_found_not_proven() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "web/app/api/early/[id]/route.ts",
        r#"import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/session";
import { loadRule } from "../../../../lib/rules";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await loadRule(params.id);
  if (req.nextUrl.searchParams.get("preview")) return NextResponse.json({ id: rule.id });
  if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(rule);
}
"#,
    );
    write(
        r,
        "web/app/api/invalid/[id]/route.ts",
        r#"import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/session";
import { loadRule } from "../../../../lib/rules";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await loadRule(params.id);
  if (!params.id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(rule);
}
"#,
    );
    write(
        r,
        "web/app/api/plain/[id]/route.ts",
        r#"import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/session";
import { loadRule } from "../../../../lib/rules";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rule = await loadRule(params.id);

  if (rule.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(rule);
}
"#,
    );
    write(
        r,
        "web/lib/rules.ts",
        r#"export type Rule = { id: string; orgId: string; draft: boolean };
export async function loadRule(id: string): Promise<Rule> {
  return { id, orgId: "", draft: false };
}
"#,
    );
    write(
        r,
        "web/lib/session.ts",
        r#"export type Session = { token: string; orgId: string };
export async function getSession(): Promise<Session | null> {
  return null;
}
"#,
    );
    write(
        r,
        "web/package.json",
        r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }
"#,
    );
    let authz = concern_with_units(r, "authz");
    let u = unit(&authz, "web/app/api/early/[id]/route.ts", "GET");
    assert_eq!(
        (
            u["assignment"].as_str(),
            u["reason"].as_str(),
            u["not_proven"]["check"].as_str()
        ),
        (
            Some("unknown"),
            Some("check_not_proven"),
            Some("tenancy_check:claim:.orgId")
        ),
        "{u:#}"
    );
    for route in ["plain", "invalid"] {
        let u = unit(&authz, &format!("web/app/api/{route}/[id]/route.ts"), "GET");
        assert_eq!(u["assignment"], "known", "{route}: {u:#}");
    }
}

/// [STRICT] A TypeScript route that scopes what it answers by comparing in memory
/// (`rules.filter((rule) => rule.orgId === session.orgId)`, a ternary on the same
/// comparison) read `none`: no check turned anyone away and no query was filtered
/// (the acceptance suite's array_filter_next). A comparison by a tenant or an owner
/// key outside the condition of a refusing exit may be the scope: unknown. A route
/// that compares nothing is still a none, and the comparison of a 403 is the check.
#[test]
fn a_typescript_tenant_comparison_no_check_records_is_never_a_none() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "web/app/api/checked/route.ts",
        r#"import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { allRules } from "../../../lib/rules";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rules = await allRules();
  const first = rules[0];
  if (first.orgId !== session.orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(first);
}
"#,
    );
    write(
        r,
        "web/app/api/filtered/route.ts",
        r#"import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { allRules } from "../../../lib/rules";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rules = await allRules();
  return NextResponse.json(rules.filter((rule) => rule.orgId === session.orgId));
}
"#,
    );
    write(
        r,
        "web/app/api/open/route.ts",
        r#"import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { allRules } from "../../../lib/rules";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rules = await allRules();
  return NextResponse.json(rules);
}
"#,
    );
    write(
        r,
        "web/app/api/ternary/route.ts",
        r#"import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { allRules } from "../../../lib/rules";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rules = await allRules();
  const first = rules[0];
  return NextResponse.json(first.orgId === session.orgId ? first : null);
}
"#,
    );
    write(
        r,
        "web/lib/rules.ts",
        r#"export type Rule = { id: string; orgId: string };
export async function allRules(): Promise<Rule[]> {
  return [];
}
"#,
    );
    write(
        r,
        "web/lib/session.ts",
        r#"export type Session = { token: string; orgId: string };
export async function getSession(): Promise<Session | null> {
  return null;
}
"#,
    );
    write(
        r,
        "web/package.json",
        r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }
"#,
    );
    let authz = concern_with_units(r, "authz");
    let assigned = |route: &str| {
        let u = unit(&authz, &format!("web/app/api/{route}/route.ts"), "GET");
        (
            u["assignment"].as_str().unwrap().to_string(),
            u["reason"].as_str().unwrap_or("").to_string(),
        )
    };
    let unknown = ("unknown".to_string(), "unclassified".to_string());
    assert_eq!(assigned("filtered"), unknown);
    assert_eq!(assigned("ternary"), unknown);
    assert_eq!(assigned("open").0, "none");
    assert_eq!(assigned("checked").0, "known");
}

/// [STRICT] A guard is shown only on the routes it runs for (the acceptance suite's
/// held-back mounts cases; each read as the other mount's guard before).
///
/// - A Flask blueprint registered twice on one application, and a `before_request`
///   hook that answers 401 for one registration only (`if request.blueprint ==
///   "items"`, `if request.path.startswith("/admin")`): the hook turns away the
///   callers of some requests, and which routes those are is not read. Neither route
///   is shown with it as a guard (`opaque` in `drift security`), and authn is
///   unknown for both, never known by it.
/// - A view routed on two blueprints, one with a `before_request` hook: known by the
///   hook on that blueprint's route, none on the other.
#[test]
fn a_hook_guards_the_routes_it_runs_for_and_no_other() {
    const ITEMS: &str = r#"from flask import Blueprint, jsonify

bp = Blueprint("items", __name__)


@bp.route("/items")
def list_items():
    return jsonify([])
"#;
    for condition in [
        r#"request.blueprint == "items""#,
        r#"request.path.startswith("/admin")"#,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "requirements.txt", "flask\n");
        write(r, "shop/__init__.py", "");
        write(r, "shop/items.py", ITEMS);
        write(
            r,
            "shop/app.py",
            &format!(
                r#"from flask import Flask, abort, request

from shop.items import bp

app = Flask(__name__)


@app.before_request
def require_staff():
    if {condition}:
        if not request.headers.get("Authorization"):
            abort(401)


app.register_blueprint(bp, url_prefix="/admin")
app.register_blueprint(bp, url_prefix="/public", name="public_items")
"#
            ),
        );
        let rows = entry_rows(r);
        assert_eq!(rows.len(), 2, "{rows:?}");
        for (_, symbol, guards, opaque) in &rows {
            assert_eq!(symbol, "list_items");
            assert!(guards.is_empty(), "{condition}: {guards:?}");
            assert_eq!(opaque, &["require_staff (app hook)"], "{condition}");
        }
        let authn = concern_with_units(r, "authn");
        for u in authn["units"].as_array().unwrap() {
            assert_eq!(u["assignment"], "unknown", "{condition}: {u:#}");
        }
    }
    // An unconditional hook on one of two blueprints the view is routed on.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "requirements.txt", "flask\n");
    write(r, "shop/__init__.py", "");
    write(
        r,
        "shop/app.py",
        r#"from flask import Blueprint, Flask, abort, jsonify, request

staff = Blueprint("staff", __name__, url_prefix="/staff")
shop = Blueprint("shop", __name__, url_prefix="/shop")


@staff.before_request
def require_staff():
    if not request.headers.get("Authorization"):
        abort(401)


@staff.route("/orders")
@shop.route("/orders")
def list_orders():
    return jsonify([])


app = Flask(__name__)
app.register_blueprint(staff)
app.register_blueprint(shop)
"#,
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let guards = |route: &str| -> Vec<String> {
        let e = inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["route"] == route)
            .unwrap_or_else(|| panic!("no route {route}: {inv:#}"));
        e["guards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g.as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(guards("/staff/orders"), ["require_staff"]);
    assert!(guards("/shop/orders").is_empty());
    let authn = concern_with_units(r, "authn");
    let assignment = |route: &str| -> String {
        let u = authn["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["route"] == route)
            .unwrap_or_else(|| panic!("no unit {route}"));
        u["assignment"].as_str().unwrap().to_string()
    };
    assert_eq!(assignment("/staff/orders"), "known");
    assert_eq!(assignment("/shop/orders"), "none");
}

/// [STRICT] An application that goes where Drift does not read what is registered
/// on it is never said to have no guard (each read `none` on the guarded route
/// before): its hook registries written directly, a hook added to what a factory
/// returned, a class of the repository with its own constructor, and a function of
/// a package it is passed to. Authn is unknown for its routes and `drift security`
/// lists what was not read as `opaque`; the application that went nowhere is none.
/// A helper of the repository that registers the hook on its parameter is read: the
/// route is known by the hook. The same of a FastAPI application and
/// `add_middleware`.
#[test]
fn an_application_drift_does_not_read_in_full_is_never_without_a_guard() {
    const ITEMS: &str = r#"from flask import Blueprint, jsonify

bp = Blueprint("items", __name__)


@bp.route("/items")
def list_items():
    return jsonify([])
"#;
    const AUTH: &str = r#"from flask import abort, request


def require_staff():
    if not request.headers.get("Authorization"):
        abort(401)
"#;
    const HEAD: &str = "from flask import Flask\n\nfrom shop.auth import require_staff\nfrom shop.items import bp\n\n";
    const TWO: &str = "admin.register_blueprint(bp, url_prefix=\"/admin\")\npublic.register_blueprint(bp, url_prefix=\"/public\")\n";
    // (what, shop/app.py, the admin route, its assignment, the public route's)
    let cases: &[(&str, String, &str, &str, Option<&str>)] = &[
        (
            "hook registries",
            format!(
                "{HEAD}admin = Flask(\"admin\")\npublic = Flask(\"public\")\nadmin.before_request_funcs.setdefault(None, []).append(require_staff)\n{TWO}"
            ),
            "/admin/items",
            "unknown",
            Some("none"),
        ),
        (
            "a package's function",
            format!(
                "from corp_auth import protect\n{HEAD}admin = Flask(\"admin\")\npublic = Flask(\"public\")\nprotect(admin)\n{TWO}"
            ),
            "/admin/items",
            "unknown",
            Some("none"),
        ),
        (
            "a subclass constructor",
            format!(
                "{HEAD}class AdminApp(Flask):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, **kwargs)\n        self.before_request(require_staff)\n\n\nadmin = AdminApp(\"admin\")\npublic = Flask(\"public\")\n{TWO}"
            ),
            "/?/admin/items",
            "unknown",
            Some("none"),
        ),
        (
            "a factory's result",
            format!(
                "{HEAD}def make_app(name, prefix):\n    app = Flask(name)\n    app.register_blueprint(bp, url_prefix=prefix)\n    return app\n\n\nadmin = make_app(\"admin\", \"/admin\")\nadmin.before_request(require_staff)\npublic = make_app(\"public\", \"/public\")\n"
            ),
            "/?/items",
            "unknown",
            None,
        ),
        (
            "a helper that registers the hook",
            format!(
                "{HEAD}def init_auth(app):\n    app.before_request(require_staff)\n\n\nadmin = Flask(\"admin\")\npublic = Flask(\"public\")\ninit_auth(admin)\n{TWO}"
            ),
            "/admin/items",
            "known",
            Some("none"),
        ),
    ];
    let assignments = |r: &Path| -> std::collections::BTreeMap<String, String> {
        concern_with_units(r, "authn")["units"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| {
                (
                    u["route"].as_str().unwrap().to_string(),
                    u["assignment"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    };
    for (what, app, route, admin, public) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "requirements.txt", "flask\n");
        write(r, "shop/__init__.py", "");
        write(r, "shop/items.py", ITEMS);
        write(r, "shop/auth.py", AUTH);
        write(r, "shop/app.py", app);
        let got = assignments(r);
        assert_eq!(got[*route], *admin, "{what}: {got:?}");
        if let Some(public) = public {
            assert_eq!(got["/public/items"], *public, "{what}: {got:?}");
        }
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        for e in inv["entry_points"].as_array().unwrap() {
            let opaque = e["opaque"].as_array().map_or(0, Vec::len);
            // (A hook on a factory's result is one only some of its applications
            // have: the inventory says so too, as the practice map does.)
            let unread = e["route"] == *route && *admin == "unknown";
            assert_eq!(opaque, usize::from(unread), "{what}: {e:#}");
        }
    }
    // FastAPI: `add_middleware` in a helper is read; in a package's function, on a
    // factory's result and in a subclass constructor it is unknown.
    const ROUTER: &str = "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get(\"/items\")\nasync def list_items():\n    return []\n";
    const TOKEN: &str = "from fastapi import Request\nfrom fastapi.responses import JSONResponse\nfrom starlette.middleware.base import BaseHTTPMiddleware\n\n\nclass RequireToken(BaseHTTPMiddleware):\n    async def dispatch(self, request: Request, call_next):\n        if not request.headers.get(\"authorization\"):\n            return JSONResponse({\"detail\": \"unauthenticated\"}, status_code=401)\n        return await call_next(request)\n";
    const FHEAD: &str = "from fastapi import FastAPI\n\nfrom svc.auth import RequireToken\nfrom svc.items import router\n\n";
    const FTWO: &str = "admin.include_router(router, prefix=\"/admin\")\npublic.include_router(router, prefix=\"/public\")\n";
    let cases: &[(&str, String, &str, &str)] = &[
        (
            "a helper",
            format!(
                "{FHEAD}def init_auth(app):\n    app.add_middleware(RequireToken)\n\n\nadmin = FastAPI()\npublic = FastAPI()\ninit_auth(admin)\n{FTWO}"
            ),
            "/admin/items",
            "known",
        ),
        (
            "a package's function",
            format!(
                "from corp_auth import protect\n{FHEAD}admin = FastAPI()\npublic = FastAPI()\nprotect(admin)\n{FTWO}"
            ),
            "/admin/items",
            "unknown",
        ),
        (
            "a factory's result",
            format!(
                "{FHEAD}def make_app(prefix):\n    app = FastAPI()\n    app.include_router(router, prefix=prefix)\n    return app\n\n\nadmin = make_app(\"/admin\")\nadmin.add_middleware(RequireToken)\npublic = make_app(\"/public\")\n"
            ),
            "/?/items",
            "unknown",
        ),
        (
            "a subclass constructor",
            format!(
                "{FHEAD}class AdminAPI(FastAPI):\n    def __init__(self, **kwargs):\n        super().__init__(**kwargs)\n        self.add_middleware(RequireToken)\n\n\nadmin = AdminAPI()\npublic = FastAPI()\n{FTWO}"
            ),
            "/?/admin/items",
            "unknown",
        ),
        (
            "the middleware list written directly",
            format!(
                "from starlette.middleware import Middleware\n{FHEAD}admin = FastAPI()\npublic = FastAPI()\nadmin.user_middleware.insert(0, Middleware(RequireToken))\n{FTWO}"
            ),
            "/admin/items",
            "unknown",
        ),
    ];
    for (what, main, route, admin) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "pyproject.toml",
            "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
        );
        write(r, "svc/__init__.py", "");
        write(r, "svc/items.py", ROUTER);
        write(r, "svc/auth.py", TOKEN);
        write(r, "svc/main.py", main);
        let got = assignments(r);
        assert_eq!(got[*route], *admin, "fastapi, {what}: {got:?}");
        if let Some(public) = got.get("/public/items") {
            assert_eq!(public, "none", "fastapi, {what}: {got:?}");
        }
    }
}

/// An Express handler written as an arrow that hands back a helper's call
/// (`router.get("/reports", (req, res) => relayJson(req, res))`), where the helper's
/// whole body is a `try`/`catch` that answers 502: the route read `bubble`, because
/// the helper whose call a body returns was looked for in `return` statements only.
/// An arrow with an expression for a body returns it. The same in Next.js
/// (`export const GET = (req: Request) => relay(req)`). A callback written inside
/// the handler returns for itself, not for the route.
#[test]
fn an_arrow_that_hands_back_a_helpers_call_is_handled_where_the_helper_is() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "api/package.json",
        "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\" } }",
    );
    write(
        r,
        "api/src/app.ts",
        r#"import express from "express";
const router = express.Router();
async function relayJson(req, res) {
  try {
    const upstream = await fetch("http://upstream/reports");
    res.json(await upstream.json());
  } catch (e) {
    res.status(502).json({ error: "bad gateway" });
  }
}
async function plain(req, res) {
  res.json(await (await fetch("http://upstream/reports")).json());
}
router.get("/arrow", (req, res) => relayJson(req, res));
router.get("/awaited", async (req, res) => await relayJson(req, res));
router.get("/block", (req, res) => {
  return relayJson(req, res);
});
router.get("/unhandled", (req, res) => plain(req, res));
router.get("/callback", async (req, res) => {
  const rows = [1, 2].map((n) => relayJson(req, res));
  res.json(rows.length);
});
export default router;
"#,
    );
    write(
        r,
        "web/package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\" } }",
    );
    write(
        r,
        "web/lib/relay.ts",
        "export async function relay(req: Request) {\n  try {\n    return await fetch(\"http://upstream/reports\");\n  } catch (e) {\n    return Response.json({ error: \"bad gateway\" }, { status: 502 });\n  }\n}\n",
    );
    write(
        r,
        "web/app/api/reports/route.ts",
        "import { relay } from \"../../../lib/relay\";\nexport const GET = (req: Request) => relay(req);\n",
    );
    let errors = concern_with_units(r, "errors");
    // A unit's own key where it has one (its variant may be folded with others).
    let key = |path: &str, symbol: &str| {
        let u = unit(&errors, path, symbol);
        match u["key"].as_str() {
            Some(k) => k.to_string(),
            None => variant_key(&errors, u),
        }
    };
    let express = key("api/src/app.ts", "GET /block");
    assert!(express.starts_with("in_body_try"), "{express}");
    for route in ["GET /arrow", "GET /awaited"] {
        assert_eq!(key("api/src/app.ts", route), express, "{route}");
    }
    for route in ["GET /unhandled", "GET /callback"] {
        let k = key("api/src/app.ts", route);
        assert!(k.starts_with("bubble"), "{route}: {k}");
    }
    let next = key("web/app/api/reports/route.ts", "GET");
    assert!(next.starts_with("in_body_try"), "{next}");
}
