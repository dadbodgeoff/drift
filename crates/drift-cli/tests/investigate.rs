//! `drift investigate`: every route Drift could not settle, on a small FastAPI service
//! with one of each kind of item: routes whose reach nothing says (`exposure`), a tenant
//! key of the route handed to a package Drift does not follow (`unread`, authz), a
//! package dependency no vocabulary classifies (`unread`, authn), a check found and not
//! proven that a `drift setup` question asks (`check`, pointed to), and a route Drift
//! read to the end and found no guard on (`nothing_found`, authn: an internal token route
//! anyone may call).
//!
//! Each outcome is checked against what `drift security`, `drift practices`, a card, the
//! census and the session hook say before and after: a proposal changes none of them
//! until a person confirms it, a cautious outcome takes effect, and findings and gap
//! reports are local files git does not see.

use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift` with `args` and `stdin`: (exit code, stdout, stderr).
fn run_in(root: &Path, args: &[&str], stdin: &str) -> (i32, String, String) {
    let mut child = Command::new(&*BIN);
    child
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE");
    // A run that says `--by person` is a person's script, and says so as a person does
    // without a terminal to type ids on; no other run sets them.
    if args.windows(2).any(|w| w == ["--by", "person"]) {
        child
            .env("DRIFT_SETUP_PERSON", "1")
            .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1");
    }
    let mut child = child
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
    )
}

fn drift_in(root: &Path, args: &[&str], stdin: &str) -> String {
    let (code, out, err) = run_in(root, args, stdin);
    assert_eq!(code, 0, "drift {args:?}: {err}");
    out
}

fn drift(root: &Path, args: &[&str]) -> String {
    drift_in(root, args, "")
}

fn drift_fails(root: &Path, args: &[&str]) -> String {
    let (code, _, err) = run_in(root, args, "");
    assert_ne!(code, 0, "drift {args:?} succeeded");
    err
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&drift(root, args)).unwrap()
}

fn config(root: &Path) -> Option<String> {
    std::fs::read_to_string(root.join(".drift/config.yaml")).ok()
}

const SERVICES: &str = r#"class ForbiddenError(Exception):
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

const DEPS: &str = r#"from typing import Annotated

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
Caller = Annotated[object, Depends(get_caller)]
"#;

const RULES: &str = r#"from fastapi import APIRouter

from app.deps import RuleBookDep

router = APIRouter(prefix="/rules")


@router.get("/a")
async def read_a(rule_id: str, service: RuleBookDep):
    return service.read(rule_id)


@router.get("/b")
async def read_b(rule_id: str, service: RuleBookDep):
    return service.read(rule_id)
"#;

const ITEMS: &str = r#"from fastapi import APIRouter

from vendor_sdk import load_item

from app.deps import Caller

router = APIRouter(prefix="/orgs/{org_id}/items")


@router.get("/{item_id}")
async def get_item(org_id: str, item_id: str, caller: Caller):
    return await load_item(org_id, item_id)


@router.delete("/{item_id}")
async def delete_item(org_id: str, item_id: str, caller: Caller):
    return await load_item(org_id, item_id)
"#;

const TOKENS: &str = r#"from fastapi import APIRouter

router = APIRouter()


@router.post("/_internal/token")
async def mint_token(user_id: str):
    return {"token": user_id}
"#;

const REPORTS: &str = r#"from fastapi import APIRouter, Depends

from vendor_auth import require_member

router = APIRouter(prefix="/reports")


@router.get("/weekly", dependencies=[Depends(require_member)])
async def weekly():
    return []
"#;

const MAIN: &str = r#"from fastapi import FastAPI

from app.api.items import router as items_router
from app.api.reports import router as reports_router
from app.api.rules import router as rules_router
from app.api.tokens import router as tokens_router

app = FastAPI()
app.include_router(rules_router)
app.include_router(items_router)
app.include_router(tokens_router)
app.include_router(reports_router)
"#;

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\", \"sqlalchemy\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/services.py", SERVICES);
    write(r, "svc/app/deps.py", DEPS);
    write(r, "svc/app/api/rules.py", RULES);
    write(r, "svc/app/api/items.py", ITEMS);
    write(r, "svc/app/api/tokens.py", TOKENS);
    write(r, "svc/app/api/reports.py", REPORTS);
    write(r, "svc/app/main.py", MAIN);
    dir
}

fn listing(root: &Path, args: &[&str]) -> Value {
    let mut a = vec!["investigate", "--json"];
    a.extend_from_slice(args);
    let v = json(root, &a);
    assert_eq!(v["schema"], "drift-investigate");
    assert_eq!(v["version"], 1);
    v
}

fn items(root: &Path) -> Vec<Value> {
    listing(root, &["--all"])["items"]
        .as_array()
        .unwrap()
        .clone()
}

/// The item of `kind` and `concern` (its reason too, where one kind has two).
fn item(root: &Path, kind: &str, concern: &str) -> Value {
    items(root)
        .into_iter()
        .find(|i| i["kind"] == kind && i["concern"] == concern)
        .unwrap_or_else(|| panic!("no {kind} item of {concern}"))
}

fn id(v: &Value) -> String {
    v["id"].as_str().unwrap().to_string()
}

/// Everything a proposal must leave as it was: the security inventory, the practice
/// map, a card, the census and the session hook.
fn everything(root: &Path) -> Vec<String> {
    vec![
        drift(root, &["security", "--json"]),
        drift(root, &["practices", "--json", "--units"]),
        drift(root, &["card", "svc/app/api/reports.py"]),
        drift(root, &["census", "--json", "--max", "15"]),
        drift_in(
            root,
            &["hook", "claude", "SessionStart"],
            r#"{"session_id":"t","hook_event_name":"SessionStart","source":"startup"}"#,
        ),
    ]
}

/// `concern` of `symbol` in `practices --json --units`: (assignment, declared).
fn unit(root: &Path, concern: &str, symbol: &str) -> (String, String) {
    let v = json(root, &["practices", "--json", "--units"]);
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == concern)
        .unwrap();
    let u = c["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["symbol"] == symbol)
        .unwrap();
    (
        u["assignment"].as_str().unwrap().to_string(),
        u["declared"].as_str().unwrap_or_default().to_string(),
    )
}

/// `route -> exposure` of `drift security --json`.
fn exposures(root: &Path) -> Vec<(String, String)> {
    let v = json(root, &["security", "--json"]);
    let mut out: Vec<(String, String)> = v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["route"].as_str().unwrap_or_default().to_string(),
                e["exposure"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    out.sort();
    out
}

/// An agent's outcome (stdin is not a terminal: `--by agent` is the default).
fn record(root: &Path, id_outcome: &str, reason: &str, cited: &str) -> String {
    drift(
        root,
        &[
            "investigate",
            "--record",
            id_outcome,
            "--reason",
            reason,
            "--evidence",
            cited,
        ],
    )
}

// ---------- the open list ----------

/// Every route Drift could not settle is in one item, grouped by what would settle it,
/// most routes first; the check a setup question asks points to it; ids are stable;
/// each item outside setup carries its evidence with file and line, bounded.
#[test]
fn the_open_list_groups_routes_by_what_would_settle_them() {
    let dir = repo();
    let r = dir.path();
    let l = listing(r, &[]);
    let all = l["items"].as_array().unwrap();
    let kinds: Vec<(String, String, String, u64)> = all
        .iter()
        .map(|i| {
            (
                i["kind"].as_str().unwrap().to_string(),
                i["concern"].as_str().unwrap().to_string(),
                i["not_read"]["reason"].as_str().unwrap().to_string(),
                i["route_count"].as_u64().unwrap(),
            )
        })
        .collect();
    let has = |k: &str, c: &str, why: &str, n: u64| {
        assert!(
            kinds.contains(&(k.into(), c.into(), why.into(), n)),
            "{k} {c} {why} {n}: {kinds:?}"
        )
    };
    has("exposure", "exposure", "nothing_says", 6);
    has("unread", "authz", "not_followed", 2);
    has("check", "authz", "check_not_proven", 2);
    has("nothing_found", "authn", "nothing_found", 1);
    has("unread", "authn", "unclassified", 1);
    // Most routes first.
    let counts: Vec<u64> = kinds.iter().map(|k| k.3).collect();
    assert!(counts.windows(2).all(|w| w[0] >= w[1]), "{counts:?}");
    assert_eq!(l["open"], all.len());
    assert_eq!(l["waiting"], 0);
    // The check is a setup question: pointed to, answered there.
    let check = all.iter().find(|i| i["kind"] == "check").unwrap();
    let setup = json(r, &["setup", "--json"]);
    let asked = setup["questions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["kind"] == "check")
        .unwrap();
    assert_eq!(check["setup"], asked["id"]);
    let offered: Vec<&str> = check["outcomes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["outcome"].as_str().unwrap())
        .collect();
    assert_eq!(offered, ["finding", "drift-gap", "skip"]);
    // The package's guard: suggested by its name; a proposal.
    let guard = all
        .iter()
        .find(|i| i["kind"] == "unread" && i["concern"] == "authn")
        .unwrap();
    assert_eq!(
        guard["outcomes"][0]["outcome"],
        "guard:pkg:vendor_auth#require_member"
    );
    assert_eq!(guard["outcomes"][0]["needs_person"], true);
    assert_eq!(guard["outcomes"][1]["outcome"], "not-a-guard");
    assert_eq!(guard["outcomes"][1]["needs_person"], false);
    // Stable ids.
    let again: Vec<String> = listing(r, &[])["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(id)
        .collect();
    assert_eq!(again, all.iter().map(id).collect::<Vec<_>>());
    // The evidence: the handler of the token route, as written, with its line.
    let e = listing(r, &["--evidence"]);
    for i in e["items"].as_array().unwrap() {
        if i["setup"].is_string() {
            assert!(i.get("context").is_none(), "{i:#}");
            continue;
        }
        let ctx = &i["context"];
        assert!(!ctx["facts"].as_array().unwrap().is_empty(), "{i:#}");
        let ex = ctx["excerpts"].as_array().unwrap();
        assert!(!ex.is_empty(), "{i:#}");
        for x in ex {
            assert!(x["file"].as_str().unwrap().starts_with("svc/"), "{x}");
            assert!(x["line"].as_u64().unwrap() >= 1, "{x}");
            assert!(x["text"].as_str().unwrap().lines().count() <= 41, "{x}");
        }
    }
    let token = e["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["kind"] == "nothing_found")
        .unwrap();
    let handler = token["context"]["excerpts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["what"] == "the handler of POST /_internal/token (mint_token)")
        .unwrap();
    assert_eq!(handler["file"], "svc/app/api/tokens.py");
    assert_eq!(handler["line"], 6);
    assert!(
        handler["text"]
            .as_str()
            .unwrap()
            .contains("async def mint_token(user_id: str):"),
        "{handler}"
    );
    // The handler is not shown again as something it calls.
    assert!(
        !token["context"]["excerpts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["what"]
                .as_str()
                .unwrap()
                .contains("which the handler calls")),
        "{token:#}"
    );
    // One item alone.
    let one = listing(r, &["--evidence", "--item", &id(token)]);
    assert_eq!(one["items"].as_array().unwrap().len(), 1);
    let err = drift_fails(r, &["investigate", "--json", "--item", "I-000000"]);
    assert!(err.contains("no item I-000000"), "{err}");
    // The text: each item with the command that records an outcome.
    let text = drift(r, &["investigate", "--list"]);
    assert!(
        text.contains(&format!("drift investigate --record {}=<guard:", id(guard))),
        "{text}"
    );
    assert!(
        text.contains(&format!(
            "Asked by drift setup: drift setup --answer {}=<answer>",
            asked["id"].as_str().unwrap()
        )),
        "{text}"
    );
    // Listing writes nothing.
    assert_eq!(config(r), None);
    assert!(!r.join(".drift").exists());
}

// ---------- the trust rule ----------

/// A guard named by an agent is a proposal: nothing Drift says changes (security,
/// practices, the card, the census, the session hook) until a person confirms it; then
/// it is exactly a person's answer. An agent cannot confirm; a rejection is remembered.
#[test]
fn a_proposal_changes_nothing_until_a_person_confirms_it() {
    let dir = repo();
    let r = dir.path();
    let guard = id(&item(r, "unread", "authn"));
    let before = everything(r);
    let outcome = format!("{guard}=guard:pkg:vendor_auth#require_member");
    let said = record(
        r,
        &outcome,
        "vendor_auth.require_member answers 401 without a session",
        "svc/app/api/reports.py:3",
    );
    assert!(
        said.starts_with(&format!("{guard}: proposed, waiting for a person")),
        "{said}"
    );
    assert!(
        said.contains("1 route goes from unknown to known"),
        "{said}"
    );
    assert_eq!(everything(r), before);
    let cfg = config(r).unwrap();
    assert!(
        cfg.starts_with("setup:\n  proposed:\n    # drift setup "),
        "{cfg}"
    );
    assert!(!cfg.contains("practices:"), "{cfg}");
    let l = listing(r, &[]);
    assert_eq!(l["waiting"], 1);
    assert_eq!(l["items"][0]["id"], guard.as_str());
    assert_eq!(l["items"][0]["status"], "proposed");
    assert_eq!(l["items"][0]["record"]["by"], "agent");
    // An agent cannot confirm.
    let err = drift_fails(r, &["setup", "--confirm", &guard]);
    assert!(err.contains("--confirm is for a person"), "{err}");
    assert_eq!(everything(r), before);
    // A person rejects it in review: nothing changes, and the agent may not propose it
    // again on the same evidence.
    let out = drift_in(r, &["setup", "--by", "person", "--review"], "r\n");
    assert!(
        out.contains("Its reason: vendor_auth.require_member answers 401"),
        "{out}"
    );
    assert!(out.contains("Confirmed 0, rejected 1, waiting 0."), "{out}");
    assert_eq!(everything(r), before);
    let err = drift_fails(
        r,
        &[
            "investigate",
            "--record",
            &outcome,
            "--reason",
            "again",
            "--evidence",
            "svc/app/api/reports.py:3",
        ],
    );
    assert!(err.contains("a person rejected"), "{err}");
    // Proposed again after the rejection is forgotten, and confirmed.
    drift(r, &["setup", "--by", "person", "--forget", &guard]);
    record(r, &outcome, "it answers 401", "svc/app/api/reports.py:3");
    let said = drift(r, &["setup", "--by", "person", "--confirm", &guard]);
    assert!(said.starts_with(&format!("{guard}: confirmed: ")), "{said}");
    assert_eq!(unit(r, "authn", "weekly").0, "known");
    let cfg = config(r).unwrap();
    assert!(
        cfg.contains("practices:\n  authn:\n    # drift setup ")
            && cfg.contains("; proposed by an agent on ")
            && cfg.contains(" because it answers 401; confirmed\n")
            && cfg.contains("\"pkg:vendor_auth#require_member\": \"require_member\""),
        "{cfg}"
    );
    assert!(cfg.contains("confirmed_by: \"person\""), "{cfg}");
    // As a person's own answer.
    let person = repo();
    let p = person.path();
    drift(p, &["investigate", "--by", "person", "--record", &outcome]);
    assert_eq!(
        drift(r, &["practices", "--json", "--units"]),
        drift(p, &["practices", "--json", "--units"])
    );
    assert_eq!(
        drift(r, &["security", "--json"]),
        drift(p, &["security", "--json"])
    );
}

/// "Nothing outside reaches these routes" by an agent is a proposal; confirmed, the
/// routes are reachable only from inside. A check named by an agent is a proposal too.
#[test]
fn internal_and_a_check_are_proposals() {
    let dir = repo();
    let r = dir.path();
    let reach = id(&item(r, "exposure", "exposure"));
    let unread = id(&item(r, "unread", "authz"));
    let before = everything(r);
    record(
        r,
        &format!("{reach}=internal"),
        "no load balancer leads to svc",
        "svc/app/main.py:9",
    );
    let said = record(
        r,
        &format!("{unread}=check:tenant:svc/app/services.py#RuleBook._ensure_access"),
        "it compares the rule's tenant with the caller's",
        "svc/app/services.py:9",
    );
    assert!(said.contains("proposed, waiting for a person"), "{said}");
    // It does not reach these routes: said, so a person is not misled.
    assert!(
        said.contains("no route of this item goes from unknown to known"),
        "{said}"
    );
    assert_eq!(everything(r), before);
    // A symbol that names nothing is refused.
    let err = drift_fails(
        r,
        &[
            "investigate",
            "--record",
            &format!("{unread}=check:tenant:svc/app/nowhere.py#nope"),
            "--reason",
            "x",
        ],
    );
    assert!(err.contains("which is nowhere in the repository"), "{err}");
    let out = drift_in(r, &["setup", "--by", "person", "--review"], "");
    assert!(
        out.contains("2 answers an agent gave wait for you."),
        "{out}"
    );
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--confirm",
            &reach,
            "--reject",
            &unread,
        ],
    );
    let inside = exposures(r);
    assert!(inside.iter().all(|(_, e)| e == "internal"), "{inside:?}");
    assert!(config(r).unwrap().contains("security:\n  internal:\n"));
}

/// Confirming "nothing outside reaches these routes" writes what holds exactly the item's
/// routes: the narrowest directory holding them and nothing else, else their files, and
/// never `""`. A package or a file added later elsewhere is not made internal by it, and
/// forgetting the answer takes out what it wrote.
#[test]
fn internal_covers_only_the_items_routes() {
    const ROUTES: &str = "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/v1/items\")\nasync def items():\n    return []\n\n\n@app.get(\"/v1/orders\")\nasync def orders():\n    return []\n";
    const PUBLIC: &str = "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.post(\"/webhook/pay\")\nasync def pay():\n    return {}\n";
    let project =
        |name: &str| format!("[project]\nname = \"{name}\"\ndependencies = [\"fastapi\"]\n");
    // The routes of the root package under `app/`, then spread over the root and `app/`.
    for (files, wrote) in [
        (vec!["app/main.py"], vec!["app"]),
        (
            vec!["main.py", "app/more.py"],
            vec!["app/more.py", "main.py"],
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", &project("svc"));
        write(r, "app/__init__.py", "");
        for f in &files {
            write(r, f, ROUTES);
        }
        let reach = id(&item(r, "exposure", "exposure"));
        record(
            r,
            &format!("{reach}=internal"),
            "behind the gateway",
            &format!("{}:1", files[0]),
        );
        let said = drift(r, &["setup", "--by", "person", "--confirm", &reach]);
        let cfg = config(r).unwrap();
        let inside: Vec<&str> = cfg
            .split("  internal:\n")
            .nth(1)
            .unwrap()
            .lines()
            .filter(|l| l.starts_with("    - "))
            .map(|l| l.trim_start_matches("    - ").trim_matches('"'))
            .collect();
        assert_eq!(inside, wrote, "{cfg}");
        assert!(said.contains("security.internal gets "), "{said}");
        assert!(exposures(r).iter().all(|(_, e)| e == "internal"));
        // Added later: a package of its own, and a file beside the routes' own.
        write(r, "public/pyproject.toml", &project("pub"));
        write(r, "public/api.py", PUBLIC);
        write(r, "later.py", &PUBLIC.replace("/webhook/pay", "/later"));
        let now = exposures(r);
        for route in ["/webhook/pay", "/later"] {
            let e = &now.iter().find(|(r, _)| r == route).unwrap().1;
            assert_ne!(e, "internal", "{route}: {now:?}");
        }
        drift(r, &["setup", "--by", "person", "--forget", &reach]);
        assert!(
            !config(r).unwrap_or_default().contains("internal:"),
            "{:?}",
            config(r)
        );
    }
}

/// A person's word is typed on the terminal: `--confirm`, `--reject`, `--review` and a
/// person's outcome that makes a fact ask for the id on `/dev/tty`, never standard input.
/// `DRIFT_SETUP_PERSON=1` alone, with no terminal, is refused even with the id piped in;
/// with `DRIFT_SETUP_PERSON_NONINTERACTIVE=1` too, a person's script is taken at its word.
#[cfg(unix)]
#[test]
fn a_persons_word_is_typed_on_the_terminal() {
    use std::os::unix::process::CommandExt as _;
    let dir = repo();
    let r = dir.path();
    let reach = id(&item(r, "exposure", "exposure"));
    record(
        r,
        &format!("{reach}=internal"),
        "no load balancer leads to svc",
        "svc/app/main.py:9",
    );
    let waiting = config(r).unwrap();
    // No controlling terminal at all: a new session.
    let detached = |args: &[&str], stdin: &str| {
        let mut c = Command::new(&*BIN);
        c.arg("--no-cache")
            .args(args)
            .current_dir(r)
            .env("DRIFT_SETUP_PERSON", "1")
            .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // SAFETY: `setsid` is async-signal-safe and touches no memory of the parent.
        unsafe {
            c.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
        let mut child = c.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(stdin.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        (out.status.success(), String::from_utf8(out.stderr).unwrap())
    };
    let typed = format!("{reach}\nc\n");
    let outcome = format!("{reach}=internal");
    for args in [
        vec!["setup", "--by", "person", "--confirm", &reach],
        vec!["setup", "--by", "person", "--reject", &reach],
        vec!["setup", "--by", "person", "--review"],
        vec!["investigate", "--by", "person", "--record", &outcome],
    ] {
        let (ok, err) = detached(&args, &typed);
        assert!(!ok, "{args:?}");
        assert!(
            err.contains(&format!("a person types {reach} at the terminal"))
                && err.contains("DRIFT_SETUP_PERSON_NONINTERACTIVE=1"),
            "{args:?}: {err}"
        );
    }
    assert_eq!(config(r).unwrap(), waiting);
    // A person's script that says both is taken at its word, and recorded as confirmed.
    drift(r, &["setup", "--by", "person", "--confirm", &reach]);
    assert!(config(r).unwrap().contains("confirmed_by: \"person\""));
}

/// Without `--by`, an agent's environment makes the run an agent's on a terminal too
/// (`CLAUDECODE` set, or `DRIFT_AGENT=1`); a person at a terminal types the id, and a
/// wrong one changes nothing. The terminal is a pseudo-terminal `script` opens.
#[cfg(target_os = "linux")]
#[test]
fn on_a_terminal_an_agents_environment_is_an_agent() {
    let has_script = Command::new("script")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success());
    if !has_script {
        eprintln!("skipped: no util-linux `script` to open a pseudo-terminal");
        return;
    }
    let dir = repo();
    let r = dir.path();
    let reach = id(&item(r, "exposure", "exposure"));
    record(
        r,
        &format!("{reach}=internal"),
        "no load balancer leads to svc",
        "svc/app/main.py:9",
    );
    let waiting = config(r).unwrap();
    let on_terminal = |env: &[(&str, &str)], typed: &str| {
        let mut c = Command::new("script");
        c.args([
            "-qec",
            &format!("{} --no-cache setup --confirm {reach}", *BIN),
            "/dev/null",
        ])
        .current_dir(r)
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        for (k, v) in env {
            c.env(k, v);
        }
        let mut child = c.spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(typed.as_bytes())
            .unwrap();
        let out = child.wait_with_output().unwrap();
        (
            out.status.success(),
            String::from_utf8_lossy(&out.stdout).to_string(),
        )
    };
    let typed = format!("{reach}\n");
    for env in [[("DRIFT_AGENT", "1")], [("CLAUDECODE", "1")]] {
        let (ok, out) = on_terminal(&env, &typed);
        assert!(!ok, "{env:?}: {out}");
        assert!(
            out.contains("--confirm is for a person") && out.contains("This run is an agent's"),
            "{env:?}: {out}"
        );
    }
    let (ok, out) = on_terminal(&[], "I-000000\n");
    assert!(!ok, "{out}");
    assert!(
        out.contains(&format!("To confirm {reach} on your word, type {reach}: ")),
        "{out}"
    );
    assert!(out.contains("was not typed: nothing changed"), "{out}");
    assert_eq!(config(r).unwrap(), waiting);
    let (ok, out) = on_terminal(&[], &typed);
    assert!(ok, "{out}");
    assert!(out.contains(&format!("{reach}: confirmed")), "{out}");
    assert!(config(r).unwrap().contains("confirmed_by: \"person\""));
}

/// What can only keep or raise Drift's caution takes effect at once and is recorded with
/// its reason: "not a guard" and "not a check" change no answer (an unknown stays
/// unknown, never `none`), "reachable" makes routes reachable from the internet, a skip
/// with a note keeps the note for the person and the item listed. A reason is required
/// of an agent.
#[test]
fn cautious_outcomes_take_effect_and_change_no_answer() {
    let dir = repo();
    let r = dir.path();
    let guard = id(&item(r, "unread", "authn"));
    let unread = id(&item(r, "unread", "authz"));
    let reach = id(&item(r, "exposure", "exposure"));
    let before = everything(r);
    let err = drift_fails(
        r,
        &["investigate", "--record", &format!("{guard}=not-a-guard")],
    );
    assert!(err.contains("an agent's outcome needs a reason"), "{err}");
    assert_eq!(config(r), None);
    let said = record(
        r,
        &format!("{guard}=not-a-guard"),
        "require_member only logs the request",
        "svc/app/api/reports.py:3",
    );
    assert_eq!(
        said.trim(),
        format!("{guard}: Nothing changes in what Drift says.")
    );
    assert_eq!(everything(r), before);
    assert_eq!(unit(r, "authn", "weekly").0, "unknown");
    let cfg = config(r).unwrap();
    assert!(
        cfg.contains(
            "it is not a guard; answered by an agent because require_member only logs the request\n"
        ),
        "{cfg}"
    );
    // Settled: not listed again, until what it rests on changes.
    assert!(
        !listing(r, &[])["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == guard.as_str())
    );
    assert_eq!(
        items(r).iter().find(|i| i["id"] == guard.as_str()).unwrap()["status"],
        "answered"
    );
    write(
        r,
        "svc/app/api/reports.py",
        &REPORTS.replace("weekly", "monthly"),
    );
    assert!(
        listing(r, &[])["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["id"] == guard.as_str() && i["status"] == "changed")
    );
    write(r, "svc/app/api/reports.py", REPORTS);
    // A skip with a note: kept, and the item stays listed with it.
    record(
        r,
        &format!("{unread}=skip"),
        "vendor_sdk.load_item is not in the repository",
        "svc/app/api/items.py:3",
    );
    let l = listing(r, &[]);
    let skipped = l["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == unread.as_str())
        .unwrap();
    assert_eq!(skipped["status"], "skipped");
    assert_eq!(
        skipped["record"]["reason"],
        "vendor_sdk.load_item is not in the repository"
    );
    assert_eq!(l["skipped"], 1);
    let text = drift(r, &["investigate"]);
    assert!(
        text.contains("an agent skipped it on ")
            && text.contains(": vendor_sdk.load_item is not in the repository"),
        "{text}"
    );
    assert_eq!(everything(r), before);
    // Reachable: from the internet, at once.
    record(
        r,
        &format!("{reach}=reachable"),
        "the chart's ingress routes / to svc",
        "svc/app/main.py:9",
    );
    let open = exposures(r);
    assert!(open.iter().all(|(_, e)| e == "public"), "{open:?}");
    assert!(config(r).unwrap().contains("security:\n  public:\n"));
    // An outcome an item does not take is refused.
    let err = drift_fails(
        r,
        &[
            "investigate",
            "--record",
            &format!("{unread}=not-a-guard"),
            "--reason",
            "x",
        ],
    );
    assert!(err.contains("takes one of: check:tenant:"), "{err}");
}

/// An instrument an agent recorded as not a guard is not offered by `drift practices
/// --hints` (the line would undo the record); the left-out line names the record.
#[test]
fn hints_leave_out_what_an_outcome_said_is_not_a_guard() {
    let dir = repo();
    let r = dir.path();
    let line = "\"pkg:vendor_auth#require_member\": \"require_member\"";
    let hints = drift(r, &["practices", "--hints"]);
    assert!(hints.contains(line), "{hints}");
    let guard = id(&item(r, "unread", "authn"));
    record(
        r,
        &format!("{guard}=not-a-guard"),
        "require_member reads the membership table and lets every caller through",
        "svc/app/api/items.py:1",
    );
    let hints = drift(r, &["practices", "--hints"]);
    assert!(!hints.contains(line), "{hints}");
    assert!(
        hints.contains(&format!(
            "# left out: \"pkg:vendor_auth#require_member\" under authn: answered not a guard by {guard}"
        )),
        "{hints}"
    );
}

/// A guard an agent proposed for an item and a person rejected is not offered by `drift
/// practices --hints` either; the left-out line names the item.
#[test]
fn hints_leave_out_a_guard_a_person_rejected() {
    let dir = repo();
    let r = dir.path();
    let line = "\"pkg:vendor_auth#require_member\": \"require_member\"";
    let guard = id(&item(r, "unread", "authn"));
    record(
        r,
        &format!("{guard}=guard:pkg:vendor_auth#require_member"),
        "vendor_auth.require_member answers 401 without a session",
        "svc/app/api/reports.py:3",
    );
    let hints = drift(r, &["practices", "--hints"]);
    assert!(
        hints.contains(line) && !hints.contains("# left out"),
        "{hints}"
    );
    drift(r, &["setup", "--by", "person", "--reject", &guard]);
    let hints = drift(r, &["practices", "--hints"]);
    assert!(!hints.contains(line), "{hints}");
    assert!(
        hints.contains(&format!(
            "# left out: \"pkg:vendor_auth#require_member\" under authn: rejected by a person in {guard}, proposed as a guard (`drift setup --forget {guard}` asks again)"
        )),
        "{hints}"
    );
}

// ---------- findings and gap reports ----------

fn git(root: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.com")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.com")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

const PATCH: &str = "--- a/svc/app/api/tokens.py\n+++ b/svc/app/api/tokens.py\n@@ -5,4 +5,6 @@ router = APIRouter()\n \n @router.post(\"/_internal/token\")\n async def mint_token(user_id: str):\n+    if not settings.LOCAL:\n+        raise HTTPException(status_code=404)\n     return {\"token\": user_id}\n";

/// A finding and a gap report are files under `.drift/` that git does not see; nothing
/// in what Drift says changes; the issue draft and the fix branch come only on a
/// person's command, and the branch leaves the working tree, the index and the current
/// branch as they were.
#[test]
fn findings_and_gap_reports_stay_local_and_git_ignored() {
    let dir = repo();
    let r = dir.path();
    let scratch = tempfile::tempdir().unwrap();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.name", "t"]);
    git(r, &["config", "user.email", "t@example.com"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "fixture"]);
    let head = git(r, &["rev-parse", "HEAD"]);
    let token = id(&item(r, "nothing_found", "authn"));
    let check = item(r, "check", "authz");
    let before = everything(r);
    let err = drift_fails(
        r,
        &[
            "investigate",
            "--record",
            &format!("{token}=finding"),
            "--reason",
            "x",
            "--evidence",
            "svc/app/api/tokens.py:6",
        ],
    );
    assert!(err.contains("a finding needs a title"), "{err}");
    let patch = scratch.path().join("fix.diff");
    std::fs::write(&patch, PATCH).unwrap();
    let said = drift(
        r,
        &[
            "investigate",
            "--record",
            &format!("{token}=finding"),
            "--title",
            "Anyone can mint a token for any user",
            "--reason",
            "POST /_internal/token takes user_id from the query and returns a token; nothing signs the caller in",
            "--fix",
            "Serve the route only in local development",
            "--evidence",
            "svc/app/api/tokens.py:6",
            "--patch",
            patch.to_str().unwrap(),
        ],
    );
    let fid = format!("F-{}", &token[2..]);
    assert!(
        said.contains(&format!(
            "finding {fid} written to .drift/findings/{fid}.md"
        )),
        "{said}"
    );
    // The setup question's check takes a gap report.
    let answers = json!([{
        "id": check["id"],
        "outcome": "drift-gap",
        "reason": "RuleBook returns early for global rules, which every organization may read",
        "expect": "authz of GET /things/a is known: ThingService checks the caller's organization for every rule it does not share",
        "files": {
            "svc/pyproject.toml": "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
            "svc/app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/rules/a\")\nasync def read_a(rule_id: str):\n    return RuleBook().read(rule_id)\n",
        },
        "replace": {"RuleBook": "ThingService", "rules": "things"},
    }]);
    let file = scratch.path().join("answers.json");
    std::fs::write(&file, answers.to_string()).unwrap();
    let said = drift(r, &["investigate", "--answers", file.to_str().unwrap()]);
    let gid = format!("G-{}", &id(&check)[2..]);
    assert!(
        said.contains(&format!(
            "gap report {gid} written to .drift/gap-reports/{gid}/"
        )),
        "{said}"
    );
    assert!(said.contains("Drift says of the fixture now: "), "{said}");
    for f in [
        format!(".drift/findings/{fid}.json"),
        format!(".drift/findings/{fid}.md"),
        format!(".drift/gap-reports/{gid}/expect.md"),
        format!(".drift/gap-reports/{gid}/gap.json"),
        format!(".drift/gap-reports/{gid}/fixture/svc/app/main.py"),
    ] {
        assert!(r.join(&f).is_file(), "{f}");
    }
    // Git sees none of it.
    assert_eq!(
        git(r, &["status", "--porcelain", "--untracked-files=all"]),
        ""
    );
    assert_eq!(everything(r), before);
    // Settled, and listed by `drift findings`.
    let all = items(r);
    let st = |i: &str| all.iter().find(|x| x["id"] == i).unwrap()["status"].clone();
    assert_eq!(st(&token), "finding");
    assert_eq!(st(check["id"].as_str().unwrap()), "gap");
    let f = json(r, &["findings", "--json"]);
    assert_eq!(f["schema"], "drift-findings");
    assert_eq!(f["findings"][0]["id"], fid.as_str());
    assert_eq!(
        f["findings"][0]["routes"][0],
        "POST /_internal/token (mint_token) svc/app/api/tokens.py:6"
    );
    assert!(
        f["findings"][0]["excerpts"][0]["text"]
            .as_str()
            .unwrap()
            .contains("async def mint_token")
    );
    assert_eq!(f["gap_reports"][0]["id"], gid.as_str());
    let md = std::fs::read_to_string(r.join(format!(".drift/findings/{fid}.md"))).unwrap();
    assert!(
        md.starts_with("# Anyone can mint a token for any user\n"),
        "{md}"
    );
    assert!(
        md.contains("## Suggested fix\n\nServe the route only in local development\n"),
        "{md}"
    );
    // The issue draft, on request: printed, or written to a file.
    let issue = drift(r, &["findings", "--issue", &fid]);
    assert!(
        issue.starts_with(
            "# Anyone can mint a token for any user\n\n## Where\n\n- POST /_internal/token"
        ),
        "{issue}"
    );
    assert!(
        issue.contains("## What is wrong\n\nPOST /_internal/token takes user_id"),
        "{issue}"
    );
    assert!(
        issue.contains("`svc/app/api/tokens.py:3`\n\n```\nrouter = APIRouter()\n\n\n@router.post(\"/_internal/token\")\nasync def mint_token"),
        "{issue}"
    );
    let out = scratch.path().join("issue.md");
    drift(
        r,
        &[
            "findings",
            "--issue",
            &fid,
            "--write",
            out.to_str().unwrap(),
        ],
    );
    assert_eq!(std::fs::read_to_string(&out).unwrap(), issue);
    // The fix branch, on request: beside the working tree.
    let said = drift(r, &["findings", "--branch", &fid]);
    let branch = format!("drift/{}", fid.to_lowercase());
    assert!(
        said.starts_with(&format!("branch {branch} made at ")),
        "{said}"
    );
    assert_eq!(git(r, &["rev-parse", "HEAD"]), head);
    assert_eq!(
        git(r, &["status", "--porcelain", "--untracked-files=all"]),
        ""
    );
    assert_eq!(
        git(r, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "main"
    );
    let shown = git(r, &["show", &branch, "--", "svc/app/api/tokens.py"]);
    assert!(shown.contains("+    if not settings.LOCAL:"), "{shown}");
    let err = drift_fails(r, &["findings", "--branch", &fid]);
    assert!(err.contains("exists: Drift does not replace it"), "{err}");
    // No remote was touched: there is none.
    assert_eq!(git(r, &["remote"]), "");
}

/// A finding recorded on a grouped item lists the routes the agent cites: those it names
/// with `--routes`, else those whose files its `--evidence` names; with neither, all the
/// item's, and the draft says the routes are the item's, not a claim about each.
#[test]
fn a_finding_lists_only_the_routes_the_agent_cites() {
    let record = |extra: &[&str], cited: &str| -> (Value, String, String) {
        let dir = repo();
        let r = dir.path();
        // The exposure item groups routes of four files.
        let item = item(r, "exposure", "exposure");
        assert_eq!(item["route_count"], 6, "{item}");
        let mut args = vec!["investigate", "--record"];
        let token = format!("{}=finding", id(&item));
        args.push(&token);
        args.extend_from_slice(&["--title", "T", "--reason", "why", "--fix", "f"]);
        args.extend_from_slice(extra);
        args.extend_from_slice(&["--evidence", cited]);
        drift(r, &args);
        let fid = format!("F-{}", &id(&item)[2..]);
        let f = json(r, &["findings", "--json"]);
        let issue = drift(r, &["findings", "--issue", &fid]);
        let md = std::fs::read_to_string(r.join(format!(".drift/findings/{fid}.md"))).unwrap();
        (f["findings"][0].clone(), issue, md)
    };
    let routes = |f: &Value| -> Vec<String> {
        f["routes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap().to_string())
            .collect()
    };
    const NOTE: &str = "These are all the routes of the investigate item";

    // Evidence in one route's file: that route only, and no note.
    let (f, issue, md) = record(&[], "svc/app/api/tokens.py:6");
    assert_eq!(
        routes(&f),
        ["POST /_internal/token (mint_token) svc/app/api/tokens.py:6"]
    );
    assert!(f.get("routes_scope").is_none(), "{f}");
    assert!(!issue.contains(NOTE) && !md.contains(NOTE), "{issue}");
    assert!(!issue.contains("/rules/a"), "{issue}");

    // Evidence in two files: the routes of both.
    let (f, _, _) = record(&[], "svc/app/api/rules.py:8-14");
    assert_eq!(routes(&f).len(), 2, "{f}");

    // `--routes` names them (and beats the evidence's files).
    let (f, issue, _) = record(&["--routes", "GET /rules/a"], "svc/app/api/tokens.py:6");
    assert_eq!(routes(&f), ["GET /rules/a (read_a) svc/app/api/rules.py:8"]);
    assert!(!issue.contains(NOTE), "{issue}");

    // Neither: all the item's, and the draft and the note say so.
    let (f, issue, md) = record(&[], "svc/app/services.py:9");
    assert_eq!(routes(&f).len(), 6, "{f}");
    assert_eq!(f["routes_scope"], "item", "{f}");
    assert!(issue.contains(NOTE) && md.contains(NOTE), "{issue}");
}

/// A finding's patch never changes Drift's policy and state: one that touches `.drift/`
/// or `drift.lock` (renamed into them too) is refused when recorded, and `--branch` refuses
/// one stored that does, making no branch. The issue draft is written only to a new file
/// a person names: never under `.drift/`, to `drift.lock` or through a symbolic link, and
/// over a file that is there only with `--force`.
#[cfg(unix)]
#[test]
fn findings_never_write_policy() {
    let dir = repo();
    let r = dir.path();
    let scratch = tempfile::tempdir().unwrap();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.name", "t"]);
    git(r, &["config", "user.email", "t@example.com"]);
    write(r, "drift.lock", "{}\n");
    write(r, ".drift/config.yaml", "agents:\n  brief: on\n");
    git(r, &["add", "-A", "-f"]);
    git(r, &["commit", "-q", "-m", "fixture"]);
    let token = id(&item(r, "nothing_found", "authn"));
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap();
    let cfg = config(r).unwrap();
    let finding = |patch: &str| {
        let file = scratch.path().join("fix.diff");
        std::fs::write(&file, patch).unwrap();
        run_in(
            r,
            &[
                "investigate",
                "--record",
                &format!("{token}=finding"),
                "--title",
                "Anyone can mint a token",
                "--reason",
                "nothing signs the caller in",
                "--fix",
                "Serve it only locally",
                "--evidence",
                "svc/app/api/tokens.py:6",
                "--patch",
                file.to_str().unwrap(),
            ],
            "",
        )
    };
    let config_patch = "--- a/.drift/config.yaml\n+++ b/.drift/config.yaml\n@@ -1,2 +1,4 @@\n agents:\n   brief: on\n+security:\n+  internal: [\"\"]\n";
    let lock_patch = "--- a/drift.lock\n+++ b/drift.lock\n@@ -1 +1 @@\n-{}\n+{\"x\": 1}\n";
    let rename = "diff --git a/svc/app/api/tokens.py b/.drift/conventions.yaml\nsimilarity index 100%\nrename from svc/app/api/tokens.py\nrename to .drift/conventions.yaml\n";
    for (patch, path) in [
        (config_patch, ".drift/config.yaml"),
        (lock_patch, "drift.lock"),
        (rename, ".drift/conventions.yaml"),
        (&format!("{PATCH}{config_patch}"), ".drift/config.yaml"),
    ] {
        let (code, _, err) = finding(patch);
        assert_ne!(code, 0, "{patch}");
        assert!(
            err.contains(&format!("the patch changes `{path}`")),
            "{err}"
        );
    }
    let fid = format!("F-{}", &token[2..]);
    assert!(!r.join(format!(".drift/findings/{fid}.json")).exists());
    // One stored that touches the config (written by an earlier Drift): no branch.
    let (code, _, err) = finding(PATCH);
    assert_eq!(code, 0, "{err}");
    let json_path = r.join(format!(".drift/findings/{fid}.json"));
    let mut stored: Value =
        serde_json::from_str(&std::fs::read_to_string(&json_path).unwrap()).unwrap();
    stored["patch"] = json!(format!("{PATCH}{config_patch}"));
    std::fs::write(&json_path, stored.to_string()).unwrap();
    let err = drift_fails(r, &["findings", "--branch", &fid]);
    assert!(
        err.contains("the patch changes `.drift/config.yaml`"),
        "{err}"
    );
    assert_eq!(git(r, &["branch", "--list", "drift/*"]), "");
    // The issue draft: never into policy, never through a link, never over a file.
    let issue = drift(r, &["findings", "--issue", &fid]);
    let outside = scratch.path().join("outside.md");
    std::fs::write(&outside, "keep\n").unwrap();
    std::os::unix::fs::symlink(&outside, r.join("linked.md")).unwrap();
    std::os::unix::fs::symlink(scratch.path(), r.join("docs")).unwrap();
    write(r, "issue.md", "mine\n");
    for (target, said) in [
        (".drift/config.yaml", "Drift's policy and state"),
        (".drift/conventions.yaml", "Drift's policy and state"),
        (".drift/new.md", "Drift's policy and state"),
        ("drift.lock", "Drift's policy and state"),
        ("svc/../drift.lock", "Drift's policy and state"),
        ("linked.md", "is a symbolic link"),
        ("docs/issue.md", "is a symbolic link"),
        ("issue.md", "exists: Drift does not replace it"),
    ] {
        for force in [false, true] {
            if force && said.starts_with("exists") {
                continue;
            }
            let mut args = vec!["findings", "--issue", &fid, "--write", target];
            if force {
                args.push("--force");
            }
            let err = drift_fails(r, &args);
            assert!(err.contains(said), "{target}: {err}");
        }
    }
    assert_eq!(config(r).unwrap(), cfg);
    assert_eq!(std::fs::read_to_string(r.join("drift.lock")).unwrap(), lock);
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep\n");
    assert!(!scratch.path().join("issue.md").exists());
    assert_eq!(
        std::fs::read_to_string(r.join("issue.md")).unwrap(),
        "mine\n"
    );
    drift(
        r,
        &[
            "findings", "--issue", &fid, "--write", "issue.md", "--force",
        ],
    );
    assert_eq!(std::fs::read_to_string(r.join("issue.md")).unwrap(), issue);
    drift(r, &["findings", "--issue", &fid, "--write", "new.md"]);
    assert_eq!(std::fs::read_to_string(r.join("new.md")).unwrap(), issue);
}

/// A gap report holds none of the names marked to replace, in its files, their paths,
/// `expect.md` or `gap.json`; one in which a marked name remains in a spelling Drift
/// does not replace is refused, and nothing is written.
#[test]
fn a_gap_report_holds_no_marked_name() {
    let dir = repo();
    let r = dir.path();
    let token = id(&item(r, "nothing_found", "authn"));
    let names = ["acme-billing", "AcmeLedger", "ledger_entries"];
    let gap = |files: Value| {
        json!([{
            "id": token,
            "outcome": "drift-gap",
            "reason": "acme-billing fronts AcmeLedger with a gateway that checks the session",
            "expect": "authn of POST /acme-billing/ledger_entries is known: the gateway AcmeLedger runs behind checks it",
            "files": files,
            "replace": {"acme-billing": "svc-a", "AcmeLedger": "Things", "ledger_entries": "rows"},
        }])
    };
    let ok = gap(json!({
        "acme-billing/pyproject.toml": "[project]\nname = \"acme-billing\"\ndependencies = [\"fastapi\"]\n",
        "acme-billing/app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.post(\"/acme-billing/ledger_entries\")\nasync def post_ledger_entries():\n    return AcmeLedger().add()\n",
    }));
    let scratch = tempfile::tempdir().unwrap();
    let file = scratch.path().join("gap.json");
    std::fs::write(&file, ok.to_string()).unwrap();
    drift(r, &["investigate", "--answers", file.to_str().unwrap()]);
    let base = r.join(format!(".drift/gap-reports/G-{}", &token[2..]));
    let mut seen = 0;
    for e in walk(&base) {
        let rel = e
            .strip_prefix(&base)
            .unwrap()
            .to_string_lossy()
            .to_lowercase();
        let text = std::fs::read_to_string(&e).unwrap().to_lowercase();
        for n in names {
            let n = n.to_lowercase();
            assert!(
                !rel.contains(&n) && !text.contains(&n),
                "{n} in {rel}: {text}"
            );
        }
        seen += 1;
    }
    assert_eq!(seen, 4, "fixture files, expect.md, gap.json");
    let expect = std::fs::read_to_string(base.join("expect.md")).unwrap();
    assert!(expect.contains("`fixture/svc-a/app/main.py`"), "{expect}");
    assert!(expect.contains("POST /svc-a/rows"), "{expect}");
    // What Drift says of the fixture, read as a repository of its own.
    assert!(
        expect.contains("- authn of `POST /svc-a/rows` (svc-a/app/main.py:6): "),
        "{expect}"
    );
    assert!(expect.contains("## What Drift "), "{expect}");
    // `acmeLedger` is a spelling of a marked name that is not replaced: refused.
    let left = gap(json!({ "app/main.py": "acmeLedger = 1\n" }));
    std::fs::write(&file, left.to_string()).unwrap();
    let (code, _, err) = run_in(r, &["investigate", "--answers", file.to_str().unwrap()], "");
    assert_ne!(code, 0);
    assert!(
        err.contains("the gap report still holds `AcmeLedger`"),
        "{err}"
    );
    // The earlier report is left as it was.
    assert!(base.join("fixture/svc-a/app/main.py").is_file());
}

/// A gap report writes its files under its own `fixture/` and nowhere else: a neutral
/// name holding a path separator or `..` is refused, and so is a path that leaves the
/// fixture once names are replaced. Nothing is written, `.drift/config.yaml` least of all,
/// nor beside the temporary copy Drift reads the fixture from.
#[test]
fn a_gap_report_writes_only_its_fixture() {
    let dir = repo();
    let r = dir.path();
    let token = id(&item(r, "nothing_found", "authn"));
    let before = config(r);
    let scratch = tempfile::tempdir().unwrap();
    // The temporary copy is made three levels down: `../../..` from it stays in `scratch`.
    let tmp = scratch.path().join("a/b/c");
    std::fs::create_dir_all(&tmp).unwrap();
    let outside = scratch.path().join("outside");
    let file = scratch.path().join("gap.json");
    let run = |replace: Value, files: Value| {
        let gap = json!([{
            "id": token,
            "outcome": "drift-gap",
            "reason": "Drift does not read QQ",
            "expect": "QQ is a guard",
            "files": files,
            "replace": replace,
        }]);
        std::fs::write(&file, gap.to_string()).unwrap();
        let out = Command::new(&*BIN)
            .args([
                "--no-cache",
                "investigate",
                "--answers",
                file.to_str().unwrap(),
            ])
            .current_dir(r)
            .env("TMPDIR", &tmp)
            .env_remove("DRIFT_SETUP_PERSON")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!out.status.success(), "{replace}: written");
        String::from_utf8(out.stderr).unwrap()
    };
    let config_file = json!({"QQ/config.yaml": "security:\n  internal:\n    - \"\"\n"});
    for to in ["../../..", outside.to_str().unwrap(), "a/b", "a\\b", ".."] {
        let err = run(json!({ "QQ": to }), config_file.clone());
        // (The temporary directory's random name may hold the name replaced, `qq`
        // in any case: the path is then refused for that, before its separators.)
        assert!(
            err.contains("a neutral name holds no") || err.contains("which is not a neutral name"),
            "{to}: {err}"
        );
    }
    // `QQ.` becomes `..` once `QQ` is `.`.
    let err = run(json!({"QQ": "."}), json!({"QQ./config.yaml": "x: 1\n"}));
    assert!(err.contains("stays inside it"), "{err}");
    // Through MCP, the same.
    let call = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "drift_investigate_record",
        "arguments": {
            "id": token, "outcome": "drift-gap", "reason": "Drift does not read QQ",
            "expect": "QQ is a guard", "files": config_file, "replace": {"QQ": "../../.."},
        },
    }});
    let mut child = Command::new(&*BIN)
        .args(["--no-cache", "mcp"])
        .current_dir(r)
        .env("TMPDIR", &tmp)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(format!("{call}\n").as_bytes())
        .unwrap();
    let out = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap();
    let reply: Value = serde_json::from_str(out.lines().last().unwrap()).unwrap();
    assert_eq!(reply["result"]["isError"], true, "{reply}");
    assert!(
        reply_text(&reply).contains("a neutral name holds no"),
        "{reply}"
    );
    assert_eq!(config(r), before);
    assert!(
        !r.join(format!(".drift/gap-reports/G-{}", &token[2..]))
            .exists()
    );
    for left in ["a/config.yaml", "outside/config.yaml", "config.yaml"] {
        assert!(!scratch.path().join(left).exists(), "{left}");
    }
}

fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}

/// Nothing here can make a network call: no HTTP client is among Drift's dependencies.
#[test]
fn no_http_client_is_a_dependency() {
    let lock =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../Cargo.lock")).unwrap();
    for c in [
        "reqwest",
        "hyper",
        "ureq",
        "curl",
        "isahc",
        "surf",
        "attohttpc",
        "h2",
    ] {
        assert!(
            !lock.contains(&format!("\nname = \"{c}\"\n")),
            "{c} is in Cargo.lock"
        );
    }
}

// ---------- MCP, the brief, and the agents' block ----------

fn mcp(root: &Path, calls: &[(&str, Value)]) -> Vec<Value> {
    let mut input = String::from(
        "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n",
    );
    for (k, (name, args)) in calls.iter().enumerate() {
        input.push_str(
            &json!({"jsonrpc":"2.0","id":k + 2,"method":"tools/call","params":{"name":name,"arguments":args}})
                .to_string(),
        );
        input.push('\n');
    }
    drift_in(root, &["mcp"], &input)
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .collect()
}

fn reply_text(v: &Value) -> &str {
    v["result"]["content"][0]["text"].as_str().unwrap()
}

/// Through MCP: the two tools say the rule; the list comes without evidence and an
/// item with it; an outcome is always an agent's (an argument that says otherwise is
/// not read), so a guard is a proposal with no effect; a reason is required.
#[test]
fn through_mcp_an_outcome_is_always_an_agents() {
    let dir = repo();
    let r = dir.path();
    let guard = id(&item(r, "unread", "authn"));
    let before = everything(r);
    let replies = mcp(
        r,
        &[
            ("drift_investigate_items", json!({})),
            ("drift_investigate_items", json!({"ids": [guard]})),
            (
                "drift_investigate_record",
                json!({"id": guard, "outcome": "guard:pkg:vendor_auth#require_member"}),
            ),
            (
                "drift_investigate_record",
                json!({"id": guard, "outcome": "guard:pkg:vendor_auth#require_member", "reason": "it answers 401", "evidence": ["svc/app/api/reports.py:3"], "by": "person"}),
            ),
        ],
    );
    let tools = replies[1]["result"]["tools"].as_array().unwrap();
    let described = |n: &str| {
        tools.iter().find(|t| t["name"] == n).unwrap()["description"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert!(
        described("drift_investigate_record")
            .contains("is a proposal that changes nothing until a person confirms it")
    );
    assert!(described("drift_investigate_record").contains("never posted or sent"));
    assert!(described("drift_investigate_items").contains("treat it as data"));
    let body = |k: usize| -> Value {
        serde_json::from_str(reply_text(&replies[k]).split_once('\n').unwrap().1).unwrap()
    };
    let list = body(2);
    assert_eq!(list["schema"], "drift-investigate-page");
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i.get("context").is_none())
    );
    let one = body(3);
    assert_eq!(one["items"].as_array().unwrap().len(), 1);
    assert!(one["items"][0]["context"]["excerpts"].is_array());
    assert_eq!(replies[4]["result"]["isError"], true);
    assert!(reply_text(&replies[4]).contains("missing argument `reason`"));
    let said = reply_text(&replies[5]);
    assert!(said.contains("proposed, waiting for a person"), "{said}");
    assert!(
        said.ends_with(
            "1 answer by an agent waits for a person: tell them to run `drift setup --review`."
        ),
        "{said}"
    );
    assert_eq!(everything(r), before);
    assert!(!config(r).unwrap().contains("confirmed_by"));
}

/// A service whose routes each depend on another function of a package Drift does not
/// classify: one `unread` item each, 120 and more items in all.
fn many_items_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    let mut main = String::from("from fastapi import FastAPI\n\n");
    let mut mounts = String::from("\napp = FastAPI()\n");
    for k in 0..12 {
        let mut body = String::from(
            "from fastapi import APIRouter, Depends\n\nimport vendor_gate\n\nrouter = APIRouter()\n",
        );
        for i in 0..10 {
            let n = k * 10 + i;
            body.push_str(&format!(
                "\n\n@router.get(\"/area{k}/thing{n}\", dependencies=[Depends(vendor_gate.member_of_{n})])\nasync def thing_{n}():\n    return []\n"
            ));
        }
        write(r, &format!("svc/app/api/area{k}.py"), &body);
        main.push_str(&format!("from app.api.area{k} import router as area{k}\n"));
        mounts.push_str(&format!("app.include_router(area{k})\n"));
    }
    write(r, "svc/app/main.py", &(main + &mounts));
    dir
}

/// Without `ids`, MCP `drift_investigate_items` gives one page of the list in short (50
/// items unless `limit` says), well under 20 KB, with the total and the offset of the
/// next page; the pages together are the whole list in its order, and `drift
/// investigate --json --limit` prints the same page. An item's evidence comes with its
/// id. `--json` alone is as it was: every item in full.
#[test]
fn the_list_comes_in_short_pages() {
    let dir = many_items_repo();
    let r = dir.path();
    let full = listing(r, &[]);
    let every: Vec<String> = full["items"].as_array().unwrap().iter().map(id).collect();
    assert!(every.len() >= 120, "{}", every.len());
    assert!(full["items"][0]["outcomes"].is_array());
    let first = every[0].clone();
    let replies = mcp(
        r,
        &[
            ("drift_investigate_items", json!({})),
            ("drift_investigate_items", json!({"offset": 50})),
            (
                "drift_investigate_items",
                json!({"offset": 100, "limit": 200}),
            ),
            ("drift_investigate_items", json!({"limit": 0})),
            ("drift_investigate_items", json!({"limit": 201})),
            ("drift_investigate_items", json!({"offset": -1})),
            (
                "drift_investigate_items",
                json!({"ids": [first], "limit": 5}),
            ),
            ("drift_investigate_items", json!({"ids": [first]})),
        ],
    );
    let body = |k: usize| -> Value {
        serde_json::from_str(reply_text(&replies[k]).split_once('\n').unwrap().1).unwrap()
    };
    let text = reply_text(&replies[2]);
    assert!(text.len() < 20_000, "{} bytes", text.len());
    let page = body(2);
    assert_eq!(page["schema"], "drift-investigate-page");
    assert_eq!(page["version"], 1);
    assert_eq!(page["total"], every.len());
    assert_eq!(
        (page["offset"].clone(), page["limit"].clone()),
        (json!(0), json!(50))
    );
    assert_eq!(page["next_offset"], 50);
    assert_eq!(page["open"], full["open"]);
    assert_eq!(page["routes"], full["routes"]);
    let lines = page["items"].as_array().unwrap();
    assert_eq!(lines.len(), 50);
    let mut keys: Vec<&str> = lines[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["concern", "id", "kind", "route_count", "status", "what"]
    );
    let what = full["items"][0]["what"].as_str().unwrap();
    assert!(what.starts_with(lines[0]["what"].as_str().unwrap().trim_end_matches("...")));
    assert!(
        lines
            .iter()
            .all(|l| l["what"].as_str().unwrap().chars().count() <= 163)
    );
    let second = body(3);
    assert_eq!(
        (second["offset"].clone(), second["next_offset"].clone()),
        (json!(50), json!(100))
    );
    let last = body(4);
    assert_eq!(last["items"].as_array().unwrap().len(), every.len() - 100);
    assert!(last.get("next_offset").is_none(), "{last:#}");
    let paged: Vec<String> = [&page, &second, &last]
        .iter()
        .flat_map(|p| p["items"].as_array().unwrap().iter().map(id))
        .collect();
    assert_eq!(paged, every);
    for (k, arg) in [
        (5, "`limit` must be 1 to 200"),
        (6, "`limit` must be 1 to 200"),
        (7, "`offset`"),
        (8, "page the list without `ids`"),
    ] {
        assert_eq!(replies[k]["result"]["isError"], true, "{}", replies[k]);
        assert!(reply_text(&replies[k]).contains(arg), "{}", replies[k]);
    }
    let one = body(9);
    assert_eq!(one["schema"], "drift-investigate");
    assert_eq!(one["items"].as_array().unwrap().len(), 1);
    assert!(one["items"][0]["context"].is_object());
    // The command line prints the same page.
    let cli = json(r, &["investigate", "--json", "--limit", "50"]);
    assert_eq!(cli, page);
    let cli = json(
        r,
        &["investigate", "--json", "--limit", "200", "--offset", "100"],
    );
    assert_eq!(cli, last);
    for bad in [
        vec!["investigate", "--limit", "50"],
        vec!["investigate", "--json", "--limit", "0"],
        vec!["investigate", "--json", "--offset", "5"],
        vec![
            "investigate",
            "--json",
            "--limit",
            "5",
            "--item",
            first.as_str(),
        ],
    ] {
        drift_fails(r, &bad);
    }
}

/// The brief an agent follows, and the sentence in the agents' block that points to it.
#[test]
fn the_agent_brief_says_the_rule_and_what_to_do() {
    let dir = repo();
    let r = dir.path();
    let brief = drift(r, &["investigate", "--agent-brief"]);
    assert!(brief.starts_with("# Drift's open routes, for an agent\n"));
    for said in [
        "What can only keep or raise Drift's caution takes effect at once",
        "changes nothing until a person confirms it (`drift setup --review`)",
        "Never pass `--by person`",
        "Put a suspected gap in a finding, never in a reason or a skip note",
        "drift investigate --json --evidence --item <id>",
        "drift_investigate_items",
        "`skip` with a note",
        "A name alone is not enough",
        "`drift-gap`, with a minimal self-contained example",
        "a reason that names the files you read",
        "nothing was posted or sent",
    ] {
        assert!(brief.contains(said), "{said}: {brief}");
    }
    assert!(!r.join(".drift").exists());
    drift(r, &["init"]);
    let md = drift(r, &["export", "agents-md"]);
    assert!(
        md.contains("`drift investigate --agent-brief` says how an agent works through them"),
        "{md}"
    );
}

// ---------- a person's word, and only Drift's own lines ----------

/// An agent never replaces or takes out a person's record, stale or not: neither by
/// recording again nor by `--forget`. A person may.
#[test]
fn an_agent_never_replaces_or_forgets_a_persons_record() {
    let dir = repo();
    let r = dir.path();
    let guard = id(&item(r, "unread", "authn"));
    drift(
        r,
        &[
            "investigate",
            "--by",
            "person",
            "--record",
            &format!("{guard}=not-a-guard"),
        ],
    );
    let cfg = config(r).unwrap();
    let again = |r: &Path| {
        drift_fails(
            r,
            &[
                "investigate",
                "--record",
                &format!("{guard}=guard:pkg:vendor_auth#require_member"),
                "--reason",
                "it answers 401",
            ],
        )
    };
    assert!(again(r).contains("was answered by a person"));
    // What it rests on changes: the person's answer stays in force, and the agent's
    // waits for a person beside it.
    write(
        r,
        "svc/app/api/reports.py",
        &REPORTS.replace("weekly", "monthly"),
    );
    let said = drift(
        r,
        &[
            "investigate",
            "--record",
            &format!("{guard}=guard:pkg:vendor_auth#require_member"),
            "--reason",
            "it answers 401",
        ],
    );
    assert!(said.contains("proposed, waiting for a person"), "{said}");
    assert!(config(r).unwrap().starts_with(cfg.trim_end()));
    // Its own proposal an agent may withdraw; the person's answer, never.
    drift(r, &["setup", "--forget", &guard]);
    assert_eq!(config(r).unwrap(), cfg);
    let err = drift_fails(r, &["setup", "--forget", &guard]);
    assert!(err.contains("was answered by a person"), "{err}");
    // It does not send the agent to an answer that is refused on the same evidence.
    assert!(
        err.contains("nor replace it on the evidence it was given on")
            && !err.contains("Answer it with your reason instead"),
        "{err}"
    );
    assert_eq!(config(r).unwrap(), cfg);
    // The person's record has no reason: its line ends with what was recorded.
    let text = drift(r, &["investigate", "--all"]);
    let line = text
        .lines()
        .find(|l| l.contains("recorded `not-a-guard`"))
        .unwrap_or_else(|| panic!("{text}"));
    assert_eq!(
        line,
        "  recorded `not-a-guard` (on evidence that changed since)"
    );
    // A person forgets it.
    drift(r, &["setup", "--by", "person", "--forget", &guard]);
    assert!(!config(r).unwrap().contains(&guard));
}

/// A `nothing found` item says what its routes' basis lists as not read, in the words
/// practices and security give a `none`: never that Drift read every body in reach.
#[test]
fn a_nothing_found_item_says_what_was_not_read() {
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
        "import os\n\n\ndef require_user(request):\n    token = request.headers.get(\"x-token\")\n    log(token)\n    return token\n\n\ndef log(x):\n    os.environ.get(\"X\")\n",
    );
    write(
        r,
        "app/main.py",
        "from fastapi import FastAPI, Request\n\nfrom app.auth import require_user\n\napp = FastAPI()\n\n\nasync def helper(request):\n    return require_user(request)\n\n\n@app.get(\"/v1/via\")\nasync def via(request: Request):\n    await helper(request)\n    return []\n",
    );
    let i = item(r, "nothing_found", "authn");
    let words = i["not_read"]["words"].as_str().unwrap();
    assert_eq!(
        words,
        "no guard found in what Drift read (1 not read: log (not followed))"
    );
    let what = i["what"].as_str().unwrap();
    assert!(what.ends_with(&format!(": {words}.")), "{what}");
    assert!(!what.contains("every body"), "{what}");
}

/// Drift takes out only the lines it wrote: where a person replaced the line below
/// Drift's comment, forgetting is refused, for an agent and for a person, and the file
/// is left.
#[test]
fn drift_takes_out_only_the_lines_it_wrote() {
    let dir = repo();
    let r = dir.path();
    let reach = id(&item(r, "exposure", "exposure"));
    record(
        r,
        &format!("{reach}=reachable"),
        "the ingress routes / to svc",
        "svc/app/main.py:9",
    );
    let cfg = config(r).unwrap();
    assert!(cfg.contains("\n    - \"svc\"\n"), "{cfg}");
    let edited = cfg.replace("\n    - \"svc\"\n", "\n    - \"svc/app\"\n");
    std::fs::write(r.join(".drift/config.yaml"), &edited).unwrap();
    let err = drift_fails(r, &["setup", "--forget", &reach]);
    assert!(err.contains("is not what Drift wrote"), "{err}");
    let err = drift_fails(r, &["setup", "--by", "person", "--forget", &reach]);
    assert!(err.contains("is not what Drift wrote"), "{err}");
    assert_eq!(config(r).unwrap(), edited);
    // Drift's own lines come out.
    std::fs::write(r.join(".drift/config.yaml"), &cfg).unwrap();
    drift(r, &["setup", "--by", "person", "--forget", &reach]);
    assert!(!config(r).unwrap().contains("\"svc\""));
}

/// What an agent's outcome writes at once can only keep or raise caution, whatever the
/// code becomes: `reachable` keeps routes reachable from the internet when a compose
/// file would have kept them inside, and `not-a-guard` leaves an unknown unknown when
/// the code changes.
#[test]
fn a_cautious_record_never_becomes_a_fact() {
    let dir = repo();
    let r = dir.path();
    let reach = id(&item(r, "exposure", "exposure"));
    let guard = id(&item(r, "unread", "authn"));
    record(
        r,
        &format!("{reach}=reachable"),
        "the ingress routes / to svc",
        "svc/app/main.py:9",
    );
    record(
        r,
        &format!("{guard}=not-a-guard"),
        "it only logs",
        "svc/app/api/reports.py:3",
    );
    write(
        r,
        "docker-compose.yml",
        "services:\n  api:\n    build: ./svc\n",
    );
    write(
        r,
        "svc/app/api/reports.py",
        &REPORTS.replace("weekly", "monthly"),
    );
    let reached = exposures(r);
    assert!(reached.iter().all(|(_, e)| e == "public"), "{reached:?}");
    assert_eq!(unit(r, "authn", "monthly").0, "unknown");
}

/// The shapes the first install found named as unread instruments, each a method of a
/// built-in: `params.path.join` on `params: { path: string[] }`, the request's
/// `nextUrl.searchParams.get` in a body that also hands a value to a call the facts do
/// not record, the same with nothing else unread (authentication), `settings.X.rstrip`
/// on a `BaseSettings` instance, and a request handed on with `fetch`. No item names
/// one: each names the function where the reading stops, or the unit is settled.
#[test]
fn no_item_names_a_built_ins_method() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for (rel, body) in [
        (
            "app/api/analyze/route.ts",
            r#"import { NextResponse } from "next/server";
import { sessionOrg } from "@/lib/session";

export async function POST(req: Request) {
  const org = await sessionOrg();
  if (!org) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const res = await fetch(`${process.env.ANALYZER_URL}/analyze`, {
    method: "POST",
    body: await req.text(),
  });
  return NextResponse.json(await res.json());
}
"#,
        ),
        (
            "app/api/config/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";

async function flagsFor(workspaceId: string): Promise<boolean> {
  return workspaceId.length > 0;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const on = workspaceId ? await flagsFor(workspaceId) : false;
  return NextResponse.json({ configured: true, on });
}
"#,
        ),
        (
            "app/api/topology/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { sessionOrg } from "@/lib/session";

export async function GET(req: NextRequest) {
  const org = await sessionOrg();
  if (!org) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const upstream = new URL("/v1/topology", process.env.BACKEND_URL);
  const id = req.nextUrl.searchParams.get("workspace_id");
  if (id) {
    upstream.searchParams.set("workspace_id", id.replace(/^x:/, ""));
  }
  const res = await fetch(upstream, { headers: { "x-org": org } });
  return NextResponse.json(await res.json());
}
"#,
        ),
        (
            "app/api/v1/[...path]/route.ts",
            r#"import { NextRequest, NextResponse } from "next/server";
import { sessionOrg } from "@/lib/session";

const BACKEND = process.env.BACKEND_URL;

async function proxyRequest(request: NextRequest, params: { path: string[] }) {
  const org = await sessionOrg();
  if (!org) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const path = params.path.join("/");
  const url = new URL(`${BACKEND}/v1/${path}`);
  url.searchParams.set("org_id", org);
  const body = await request.text();
  const response = await fetch(url, { method: request.method, body });
  return new NextResponse(await response.text(), { status: response.status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}
"#,
        ),
        (
            "lib/session.ts",
            r#"import { auth } from "@clerk/nextjs/server";

export async function sessionOrg(): Promise<string | null> {
  const { orgId } = await auth();
  return orgId ?? null;
}
"#,
        ),
        (
            "package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0", "@clerk/nextjs": "6.0.0" } }
"#,
        ),
        ("svc/app/__init__.py", r#""#),
        ("svc/app/api/__init__.py", r#""#),
        (
            "svc/app/api/routes.py",
            r#"from fastapi import APIRouter, Depends

from app.core.auth import verify_api_key
from app.services.proposals import ProposalService

router = APIRouter(prefix="/v1", dependencies=[Depends(verify_api_key)])


@router.get("/proposals/{item_id}")
async def get_proposal(item_id: str):
    return await ProposalService().generate(item_id)
"#,
        ),
        ("svc/app/core/__init__.py", r#""#),
        (
            "svc/app/core/auth.py",
            r#"from fastapi import Header, HTTPException

from app.core.config import settings


async def verify_api_key(x_api_key: str = Header(...)) -> str:
    if x_api_key != settings.API_KEY:
        raise HTTPException(status_code=401, detail="bad key")
    return x_api_key
"#,
        ),
        (
            "svc/app/core/config.py",
            r#"from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    STORAGE_URL: str = "http://storage"
    API_KEY: str | None = None


settings = Settings()
"#,
        ),
        (
            "svc/app/main.py",
            r#"from fastapi import FastAPI

from app.api.routes import router

app = FastAPI()
app.include_router(router)
"#,
        ),
        ("svc/app/services/__init__.py", r#""#),
        (
            "svc/app/services/proposals.py",
            r#"from app.core.config import settings


class ProposalService:
    async def generate(self, item_id: str) -> dict:
        base = settings.STORAGE_URL.rstrip("/")
        return {"url": f"{base}/v2/workspaces/{item_id}"}
"#,
        ),
        (
            "svc/pyproject.toml",
            r#"[project]
name = "svc"
dependencies = ["fastapi", "pydantic-settings", "httpx"]
"#,
        ),
        (
            "tsconfig.json",
            r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
"#,
        ),
    ] {
        write(r, rel, body);
    }
    let v = json(r, &["investigate", "--json"]);
    let items = v["items"].as_array().unwrap();
    let builtin = |i: &str| {
        i.starts_with("param:") && i.matches('.').count() >= 2
            || i == "global#fetch"
            || [".join", ".get", ".rstrip", ".searchParams", ".text"]
                .iter()
                .any(|m| i.ends_with(m))
    };
    let mut named: Vec<(String, String, String)> = Vec::new();
    for item in items.iter().filter(|i| i["kind"] != "exposure") {
        let instrument = item["not_read"]["instrument"].as_str().unwrap().to_string();
        assert!(!builtin(&instrument), "{item:#}");
        named.push((
            item["concern"].as_str().unwrap().to_string(),
            item["not_read"]["reason"].as_str().unwrap().to_string(),
            instrument,
        ));
    }
    named.sort();
    let t = |c: &str, r: &str, i: &str| (c.to_string(), r.to_string(), i.to_string());
    assert_eq!(
        named,
        [
            // A route that answers anyone where no `workspaceId` is given, and reads
            // nothing else: no guard found.
            t("authn", "nothing_found", ""),
            t("authz", "forwarded", "app/api/analyze/route.ts#POST"),
            t("authz", "partly_read", "app/api/topology/route.ts#GET"),
            t(
                "authz",
                "partly_read",
                "app/api/v1/[...path]/route.ts#proxyRequest"
            ),
            t(
                "authz",
                "partly_read",
                "svc/app/services/proposals.py#ProposalService.generate"
            ),
        ],
        "{v:#}"
    );
    // The words say what stops the reading.
    let proxy = items
        .iter()
        .find(|i| i["not_read"]["instrument"] == "app/api/v1/[...path]/route.ts#proxyRequest")
        .unwrap();
    assert!(
        proxy["what"]
            .as_str()
            .unwrap()
            .contains("they run `proxyRequest`, which Drift read except for a method of a value whose type it does not know"),
        "{proxy:#}"
    );
    let forwarded = items
        .iter()
        .find(|i| i["not_read"]["reason"] == "forwarded")
        .unwrap();
    assert!(
        forwarded["what"]
            .as_str()
            .unwrap()
            .contains("`POST` hands the request on to another service over HTTP"),
        "{forwarded:#}"
    );
}
