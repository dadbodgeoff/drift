//! A `practices:` declaration in `.drift/config.yaml` is a person's word, not a proof
//! (the approved rule): it makes a unit `known` only where the unit runs the declared
//! symbol on every path. A unit that calls it under a branch stays unknown, with the
//! declaration named as a check found and not proven; a unit that never calls it is
//! what it was; a declaration that names nothing in the repository is a warning and
//! settles nothing. A declared unit says so in its text, is counted apart in the
//! summary, and is never a recipe, a promotable rule or a way to copy.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// stdout and stderr of a run that must succeed.
fn run(root: &Path, args: &[&str]) -> (String, String) {
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
    (
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    run(root, args).0
}

const DEPS: &str = r#"from fastapi import HTTPException, Request


def get_caller(request: Request):
    token = request.headers.get("authorization")
    if not token:
        raise HTTPException(status_code=401, detail="unauthenticated")
    return request.state.caller
"#;

/// Two helpers nothing classifies: one turns callers away with a `LookupError` (authn
/// cannot tell it is a sign-in), the other with a 403 on what names no role, tenant or
/// owner (authz cannot tell what it checks).
const GUARDS: &str = r#"from fastapi import HTTPException, Request

from app import features


def require_tenant(request: Request):
    if "x-tenant" not in request.headers:
        raise LookupError("no tenant")
    return request.headers["x-tenant"]


def check_feature(caller, name):
    if not features.enabled(caller, name):
        raise HTTPException(status_code=403, detail="not enabled")
"#;

/// Routes that call a helper on every path (`<p>always0..2`), only under a branch
/// (`<p>sometimes`), or never (`<p>never`): `t` for authn, calling `require_tenant`
/// with no other guard; `f` for authz, behind `get_caller`, calling `check_feature`.
fn routes() -> String {
    let mut out = String::from(
        "from fastapi import APIRouter, Depends, Request\n\nfrom app.deps import get_caller\nfrom app.guards import check_feature, require_tenant\n\nrouter = APIRouter()\n",
    );
    for (p, args, call) in [
        ("t", "request: Request", "require_tenant(request)"),
        (
            "f",
            "caller=Depends(get_caller)",
            "check_feature(caller, \"export\")",
        ),
    ] {
        for i in 0..3 {
            out.push_str(&format!(
                "\n\n@router.get(\"/{p}always{i}\")\nasync def {p}always{i}({args}):\n    {call}\n    return {{}}\n"
            ));
        }
        out.push_str(&format!("\n\n@router.get(\"/{p}sometimes\")\nasync def {p}sometimes(strict: bool, {args}):\n    if strict:\n        {call}\n    return {{}}\n"));
        out.push_str(&format!(
            "\n\n@router.get(\"/{p}never\")\nasync def {p}never({args}):\n    return {{}}\n"
        ));
    }
    out
}

/// The routes with every call on every path.
fn plain_routes() -> String {
    routes().replace("    if strict:\n        ", "    ")
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/deps.py", DEPS);
    write(r, "svc/app/guards.py", GUARDS);
    write(
        r,
        "svc/app/features.py",
        "def enabled(caller, name):\n    return name in caller.features\n",
    );
    write(r, "svc/app/api/routes.py", &routes());
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.routes import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
}

const ROUTES: &str = "svc/app/api/routes.py";
const AUTHN_LINE: &str = "    \"svc/app/guards.py#require_tenant\": \"tenant header\"\n";
const AUTHZ_LINE: &str = "    \"svc/app/guards.py#check_feature\": \"feature check\"\n";

fn declare(root: &Path, extra: &str) {
    write(
        root,
        ".drift/config.yaml",
        &format!("practices:\n  authn:\n{AUTHN_LINE}  authz:\n{AUTHZ_LINE}{extra}"),
    );
}

fn report(root: &Path) -> Value {
    serde_json::from_str(&drift(
        root,
        &["--no-cache", "practices", "--json", "--units"],
    ))
    .unwrap()
}

fn concern<'a>(r: &'a Value, id: &str) -> &'a Value {
    r["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
}

fn unit<'a>(c: &'a Value, symbol: &str) -> &'a Value {
    c["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["path"] == ROUTES && u["symbol"] == symbol)
        .unwrap_or_else(|| panic!("no unit {symbol}: {:#}", c["units"]))
}

/// `(assignment, reason, the declared text, the check found and its obligation)`.
fn state(c: &Value, symbol: &str) -> (String, String, String, String) {
    let u = unit(c, symbol);
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    (
        s(&u["assignment"]),
        s(&u["reason"]),
        s(&u["declared"]),
        format!(
            "{} {}",
            s(&u["not_proven"]["check"]),
            s(&u["not_proven"]["obligation"])
        )
        .trim()
        .to_string(),
    )
}

/// The concerns read here: each with the prefix of its routes and its helper.
const CASES: [(&str, &str, &str, &str); 2] = [
    ("authn", "t", "require_tenant", "tenant header"),
    ("authz", "f", "check_feature", "feature check"),
];

/// Before any declaration: each helper is unknown where its routes call it, and the
/// routes that never call it are a recorded absence.
#[test]
fn without_a_declaration_the_helpers_are_unknown() {
    let dir = repo();
    let r = report(dir.path());
    for (id, p, ..) in CASES {
        let c = concern(&r, id);
        for symbol in ["always0", "always1", "always2", "sometimes"] {
            let symbol = format!("{p}{symbol}");
            assert_eq!(state(c, &symbol).0, "unknown", "{id} {symbol}");
            assert_eq!(state(c, &symbol).1, "unclassified", "{id} {symbol}");
        }
        assert_eq!(state(c, &format!("{p}never")).0, "none", "{id}");
    }
    assert_eq!(r["summary"]["declared"], 0);
}

/// [STRICT] The declared helper settles the routes that call it on every path, and
/// only those. Before the fix, `tsometimes` and `fsometimes` (which call the helper
/// under `if strict:`) read `known`: the declaration was matched against the
/// instrument alone, never against the unit's calls.
#[test]
fn a_declaration_settles_only_the_routes_that_run_it_on_every_path() {
    let dir = repo();
    declare(dir.path(), "");
    let r = report(dir.path());
    for (id, p, symbol, label) in CASES {
        let c = concern(&r, id);
        for always in ["always0", "always1", "always2"] {
            let always = format!("{p}{always}");
            let (assignment, _, declared, _) = state(c, &always);
            assert_eq!(assignment, "known", "{id} {always}");
            assert_eq!(
                declared,
                format!("{label} (declared in .drift/config.yaml: {symbol})"),
                "{id} {always}"
            );
        }
        let sometimes = format!("{p}sometimes");
        assert_eq!(
            state(c, &sometimes),
            (
                "unknown".to_string(),
                "check_not_proven".to_string(),
                String::new(),
                format!("declared:svc/app/guards.py#{symbol} under_branch")
            ),
            "{id}"
        );
        assert_eq!(
            unit(c, &sometimes)["not_proven"]["line"],
            format!(
                "unknown: the check declared in .drift/config.yaml was found (`{symbol}`) but is not proven to run on every request: it runs only on some paths (under a branch or in a loop)"
            )
        );
        // A declaration settles nothing that does not call it.
        assert_eq!(state(c, &format!("{p}never")).0, "none", "{id}");
        assert_eq!(c["population"]["declared"], 3, "{id}");
        // The `practices:` hint never offers a line that would not settle its units.
        assert!(
            c["unknown"]["instruments"]
                .as_array()
                .unwrap()
                .iter()
                .all(|i| i["config_hint"].is_null()),
            "{id}: {:#}",
            c["unknown"]
        );
    }
    assert_eq!(r["summary"]["declared"], 6);
}

/// Without the declaration, the hint for a helper some routes call under a branch is
/// not offered: naming it would not settle those. Without the branch it is.
#[test]
fn a_helper_some_routes_call_under_a_branch_is_not_hinted() {
    let dir = repo();
    let hints = drift(dir.path(), &["--no-cache", "practices", "--hints"]);
    assert!(!hints.contains("check_feature"), "{hints}");
    assert!(!hints.contains("require_tenant"), "{hints}");
    write(dir.path(), ROUTES, &plain_routes());
    let hints = drift(dir.path(), &["--no-cache", "practices", "--hints"]);
    for symbol in ["check_feature", "require_tenant"] {
        assert!(
            hints.contains(&format!(
                "\"svc/app/guards.py#{symbol}\": \"{symbol}\"  # 4 unit(s)"
            )),
            "{hints}"
        );
    }
}

/// A declaration of a symbol that is nowhere in the repository is a warning, and
/// changes nothing.
#[test]
fn a_declaration_of_nothing_is_a_warning_and_changes_nothing() {
    let dir = repo();
    declare(dir.path(), "");
    let before = report(dir.path());
    declare(
        dir.path(),
        "    \"svc/app/guards.py#check_featur\": \"typo\"\n",
    );
    let (out, err) = run(
        dir.path(),
        &["--no-cache", "practices", "--json", "--units"],
    );
    assert_eq!(serde_json::from_str::<Value>(&out).unwrap(), before);
    assert!(
        err.contains("`practices.authz` names `svc/app/guards.py#check_featur`, which is nowhere in the repository"),
        "{err}"
    );
    // The lines that do name something are not warned about.
    assert!(!err.contains("check_feature`"), "{err}");
    assert!(!err.contains("require_tenant"), "{err}");
}

/// A declared variant is the person's word: the text says so and counts it apart,
/// and it is never a recipe, a promotable rule, the way a hook or a card offers to
/// copy, or what another unit departs from.
#[test]
fn a_declared_variant_is_shown_as_declared_and_never_mined() {
    let dir = repo();
    declare(dir.path(), "");
    let text = drift(dir.path(), &["--no-cache", "practices", "--all"]);
    assert!(
        text.contains("(3 of them declared in .drift/config.yaml, not proven)"),
        "{text}"
    );
    assert!(
        text.contains("feature check (declared in .drift/config.yaml: check_feature)"),
        "{text}"
    );
    let r: Value =
        serde_json::from_str(&drift(dir.path(), &["--no-cache", "practices", "--json"])).unwrap();
    let mut declared_ids = Vec::new();
    for c in r["concerns"].as_array().unwrap() {
        for v in c["variants"].as_array().unwrap() {
            if v["source"] == "declared" {
                assert!(v["promotable"].is_null(), "{v:#}");
                declared_ids.push(v["id"].as_str().unwrap().to_string());
            }
        }
    }
    assert_eq!(declared_ids.len(), 2, "{declared_ids:?}");
    let recipes = r["recipes"].to_string();
    for id in &declared_ids {
        assert!(!recipes.contains(id.as_str()), "{id}: {recipes}");
    }
    // A file whose units are all declared: its card says so, and the hook's package
    // line offers no declared way to copy.
    let only: String = plain_routes()
        .split("\n\n\n")
        .filter(|r| !r.contains("never") && !r.contains("sometimes") && !r.contains("talways"))
        .collect::<Vec<_>>()
        .join("\n\n\n");
    write(dir.path(), ROUTES, &only);
    let card = drift(dir.path(), &["--no-cache", "card", ROUTES]);
    assert!(
        card.contains("authz: feature check (declared in .drift/config.yaml: check_feature)"),
        "{card}"
    );
    assert!(!card.contains("copy svc/app/api/routes.py"), "{card}");
    let r: Value =
        serde_json::from_str(&drift(dir.path(), &["--no-cache", "practices", "--json"])).unwrap();
    assert!(
        !r["recipes"].to_string().contains("declared"),
        "{:#}",
        r["recipes"]
    );
}

// ---------- a declared check settles a route only where its refusal stops it ----------

const RULE_SERVICE: &str = r#"class ForbiddenError(Exception):
    pass


class RuleBook:
    def __init__(self, caller):
        self.caller = caller

    def _ensure_access(self, rule):
        if rule.visibility == Visibility.SHARED:
            return
        if rule.tenant_id != self.caller.tenant_id:
            raise ForbiddenError("another tenant")

    def read(self, rule):
        self._ensure_access(rule)
        return rule
"#;

const RULE_DEPS: &str = r#"from typing import Annotated

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

/// Routes that run the declared tenant check on every path, in ways its refusal does
/// not stop the request or that check another record than the one answered with.
const RULE_ROUTES: &str = r#"from fastapi import APIRouter

from app.deps import RuleBookDep
from app.services import RuleBook

router = APIRouter(prefix="/rules")


class Quiet:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return True


class System:
    org_id = None


@router.get("/a")
async def read_a(rule_id: str, service: RuleBookDep):
    return service.read(rule_id)


@router.get("/quiet")
async def read_quiet(rule_id: str, service: RuleBookDep):
    with Quiet():
        service.read(rule_id)
    return {"id": rule_id}


@router.get("/assert")
async def read_assert(rule_id: str, service: RuleBookDep):
    assert service.read(rule_id)
    return {"id": rule_id}


@router.get("/sys")
async def read_sys(rule_id: str, service: RuleBookDep):
    return RuleBook(System()).read(rule_id)


@router.get("/other")
async def read_other(rule_id: str, other_id: str, service: RuleBookDep):
    service.read(other_id)
    return {"id": rule_id}
"#;

fn authz_units(root: &Path) -> Vec<(String, String, String)> {
    let r = report(root);
    let c = concern(&r, "authz");
    let mut out: Vec<(String, String, String)> = c["units"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| {
            let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
            (
                s(&u["route"]),
                s(&u["assignment"]),
                s(&u["not_proven"]["obligation"]),
            )
        })
        .collect();
    out.sort();
    out
}

fn row(route: &str, assignment: &str, obligation: &str) -> (String, String, String) {
    (route.into(), assignment.into(), obligation.into())
}

/// [STRICT] A declared tenant check is the person's word for what the check does, not
/// for the route reaching it so that its refusal stops the request with the record
/// the route answers with. Before the fix every one of these read `known`: a context
/// manager whose `__exit__` returns `True` swallows the refusal, `python -O` drops an
/// `assert`, `RuleBook(System())` is not built with the request's caller, and
/// `/other` checks `other_id` and answers with `rule_id`.
#[test]
fn a_declared_check_settles_only_a_route_its_refusal_stops() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/services.py", RULE_SERVICE);
    write(r, "svc/app/deps.py", RULE_DEPS);
    write(r, "svc/app/api/rules.py", RULE_ROUTES);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    write(
        r,
        ".drift/config.yaml",
        "practices:\n  authz:\n    \"svc/app/services.py#RuleBook._ensure_access\": \"tenant check\"\n",
    );
    assert_eq!(
        authz_units(r),
        [
            row("/rules/a", "known", ""),
            row("/rules/assert", "unknown", "path_unread"),
            row("/rules/other", "unknown", "path_unread"),
            row("/rules/quiet", "unknown", "swallowed"),
            row("/rules/sys", "unknown", "path_unread"),
        ]
    );
}

fn ts_route(body: &str) -> String {
    format!(
        "import {{ NextResponse }} from \"next/server\";\nimport {{ auth }} from \"@/lib/auth\";\nimport {{ db }} from \"@/lib/db\";\nimport {{ checkFeature }} from \"@/lib/features\";\nexport async function GET(req: Request) {{\n  const session = await auth();\n  if (!session) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n{body}\n  const rows = await db.report.findMany();\n  return NextResponse.json(rows);\n}}\n"
    )
}

/// [STRICT] The same in TypeScript: a call in a `try` whose `catch` neither throws
/// nor answers with an error, and one handed to `Promise.allSettled`, do not stop the
/// request when the declared check refuses. Before the fix all three read `known`.
#[test]
fn a_declared_typescript_check_settles_only_a_route_its_refusal_stops() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "web", "dependencies": { "next": "14.2.0", "next-auth": "5.0.0", "@prisma/client": "5.0.0" } }"#,
    );
    write(
        r,
        "tsconfig.json",
        r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }"#,
    );
    write(
        r,
        "lib/auth.ts",
        "import NextAuth from \"next-auth\";\nexport const { auth, handlers } = NextAuth({ providers: [] });\n",
    );
    write(
        r,
        "lib/db.ts",
        "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n",
    );
    write(
        r,
        "lib/features.ts",
        "import { enabled } from \"./flags\";\nexport class Forbidden extends Error { status = 403; }\nexport async function checkFeature(user: unknown, name: string) {\n  if (!enabled(user, name)) throw new Forbidden(\"not enabled\");\n}\n",
    );
    write(
        r,
        "lib/flags.ts",
        "export function enabled(user: unknown, name: string) {\n  return name.length > 3 && user !== null;\n}\n",
    );
    for (name, body) in [
        ("plain", "  await checkFeature(session.user, \"export\");"),
        (
            "trycatch",
            "  try {\n    await checkFeature(session.user, \"export\");\n  } catch (e) {\n    console.error(e);\n  }",
        ),
        (
            "trycatch2",
            "  try { await checkFeature(session.user, \"export\"); } catch {}",
        ),
        (
            "allsettled",
            "  await Promise.allSettled([checkFeature(session.user, \"export\")]);",
        ),
    ] {
        write(r, &format!("app/api/{name}/route.ts"), &ts_route(body));
    }
    write(
        r,
        ".drift/config.yaml",
        "practices:\n  authz:\n    \"lib/features.ts#checkFeature\": \"feature check\"\n",
    );
    assert_eq!(
        authz_units(r),
        [
            row("/api/allsettled", "unknown", "swallowed"),
            row("/api/plain", "known", ""),
            row("/api/trycatch", "unknown", "swallowed"),
            row("/api/trycatch2", "unknown", "swallowed"),
        ]
    );
}

/// An element method, and how its call is written given the callback.
type ElementCall<'a> = (&'a str, &'a dyn Fn(&str) -> String);

/// [STRICT] TypeScript: a declared check called in the callback of an element
/// method (`names.forEach((n) => checkFeature(...))`, and `map`, `flatMap`,
/// `filter`, `some`, `every`, `find`, `reduce`, or a method that is not named,
/// `names[how](...)`) runs once per element, so perhaps never: it settles no unit,
/// which stays unknown with the declared check found and not proven to run on every
/// request, as one called in a `for...of` body does. As a matrix: the method x how
/// the callback is written (an arrow's expression, an arrow with a body, a function
/// expression). Called in the handler's own body, it settles the route.
#[test]
fn a_declared_typescript_check_in_an_element_callback_settles_no_route() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "package.json",
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"next-auth\": \"5.0.0\", \"@prisma/client\": \"5.0.0\" } }\n",
    );
    write(
        root,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n",
    );
    write(
        root,
        "lib/auth.ts",
        "import NextAuth from \"next-auth\";\nexport const { auth, handlers } = NextAuth({ providers: [] });\n",
    );
    write(
        root,
        "lib/db.ts",
        "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n",
    );
    write(
        root,
        "lib/features.ts",
        "export class Forbidden extends Error { status = 403; }\nexport async function checkFeature(user: unknown, name: string) {\n  if (!enabled(user, name)) throw new Forbidden(\"not enabled\");\n}\nfunction enabled(user: unknown, name: string) {\n  return name.length > 3 && user !== null;\n}\n",
    );
    write(
        root,
        ".drift/config.yaml",
        "practices:\n  authz:\n    \"lib/features.ts#checkFeature\": \"feature check\"\n",
    );
    let head = "import { NextResponse } from \"next/server\";\nimport { auth } from \"@/lib/auth\";\nimport { db } from \"@/lib/db\";\nimport { checkFeature } from \"@/lib/features\";\nexport async function GET(req: Request) {\n  const session = await auth();\n  if (!session) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n  const names: string[] = JSON.parse(req.headers.get(\"x-names\") ?? \"[]\");\n  const how = names.length ? \"forEach\" : \"map\";\n";
    let tail = "  return NextResponse.json(await db.report.findMany());\n}\n";
    let call = "checkFeature(session.user, n)";
    let callbacks: [(&str, String); 3] = [
        ("an arrow's expression", format!("(n) => {call}")),
        (
            "an arrow with a body",
            format!("async (n) => {{\n    await {call};\n  }}"),
        ),
        (
            "a function expression",
            format!("async function (n) {{\n    await {call};\n  }}"),
        ),
    ];
    // (the method, how the call is written given the callback).
    let methods: &[ElementCall] = &[
        ("forEach", &|cb| format!("  names.forEach({cb});\n")),
        ("map", &|cb| {
            format!("  await Promise.all(names.map({cb}));\n")
        }),
        ("flatMap", &|cb| format!("  names.flatMap({cb});\n")),
        ("filter", &|cb| format!("  names.filter({cb});\n")),
        ("some", &|cb| format!("  names.some({cb});\n")),
        ("every", &|cb| format!("  names.every({cb});\n")),
        ("find", &|cb| format!("  names.find({cb});\n")),
        ("reduce", &|cb| {
            let cb = cb.replacen("(n)", "(_acc, n)", 1);
            format!("  names.reduce({cb}, null);\n")
        }),
        ("optional forEach", &|cb| {
            format!("  names?.forEach({cb});\n")
        }),
        ("a method not named", &|cb| {
            format!("  (names as any)[how]({cb});\n")
        }),
    ];
    let mut cases = Vec::new();
    for (i, (method, written)) in methods.iter().enumerate() {
        for (j, (form, cb)) in callbacks.iter().enumerate() {
            let symbol = format!("e{i}x{j}");
            write(
                root,
                &format!("app/api/{symbol}/route.ts"),
                &format!("{head}{}{tail}", written(cb)),
            );
            cases.push((
                format!("app/api/{symbol}/route.ts"),
                format!("{method}, {form}"),
            ));
        }
    }
    write(
        root,
        "app/api/plain/route.ts",
        &format!("{head}  await {call};\n{tail}")
            .replace("session.user, n", "session.user, \"export\""),
    );
    write(
        root,
        "app/api/forof/route.ts",
        &format!("{head}  for (const n of names) await {call};\n{tail}"),
    );
    let r = report(root);
    let authz = concern(&r, "authz");
    let of = |path: &str| -> (String, String, String) {
        let u = authz["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["path"] == path)
            .unwrap_or_else(|| panic!("no unit at {path}: {:#}", authz["units"]));
        let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
        (
            s(&u["assignment"]),
            s(&u["not_proven"]["check"]),
            s(&u["not_proven"]["obligation"]),
        )
    };
    assert_eq!(
        of("app/api/plain/route.ts").0,
        "known",
        "called in the body"
    );
    let unproven = (
        "unknown".to_string(),
        "declared:lib/features.ts#checkFeature".to_string(),
        "under_branch".to_string(),
    );
    assert_eq!(of("app/api/forof/route.ts"), unproven, "for...of");
    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|(path, what)| {
            let got = of(path);
            (got != unproven).then(|| format!("{what}: {got:?}"))
        })
        .collect();
    assert!(
        wrong.is_empty(),
        "{} of {} wrong:\n{}",
        wrong.len(),
        cases.len(),
        wrong.join("\n")
    );
}

/// Where every unit of a recipe concern is declared, its recipe line says so: known,
/// nothing to copy. Never an empty `authn: ` line.
#[test]
fn a_recipe_concern_whose_units_are_all_declared_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/auth.py",
        "def require_user(request):\n    return request.headers.get(\"x-token\")\n",
    );
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI, Request\n\nfrom app.auth import require_user\n\napp = FastAPI()\n\n\n@app.get(\"/v1/items\")\nasync def items(request: Request):\n    require_user(request)\n    return []\n\n\n@app.get(\"/v1/orders\")\nasync def orders(request: Request):\n    require_user(request)\n    return []\n",
    );
    write(
        r,
        ".drift/config.yaml",
        "practices:\n  authn:\n    \"app/auth.py#require_user\": \"require_user\"\n",
    );
    let text = drift(r, &["--no-cache", "practices"]);
    let line = text
        .lines()
        .find(|l| l.trim_start().starts_with("authn:"))
        .unwrap_or_else(|| panic!("{text}"));
    assert_eq!(
        line.trim(),
        "authn: known 2/2, nothing to copy (declared in .drift/config.yaml, or one-off ways)",
        "{text}"
    );
}
