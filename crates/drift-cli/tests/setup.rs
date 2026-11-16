//! `drift setup`: the questions only a person can answer, one per kind on a small
//! fixture (a test stack beside the main compose file; Terraform with a target group
//! that matches the service by its health check and its rules, and a decoy; a helper
//! with a check Drift found and could not prove, called by several routes and by one
//! only under a branch), driven by `--answer` and by a scripted terminal. Each answer
//! is checked against what `drift security` / `drift practices` say before and after,
//! and against the config file written; "skip" changes nothing; a second run asks
//! nothing answered; `--forget` undoes; a hand-written config keeps every byte outside
//! what setup writes; no question uses Drift's own words for things.

use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift --no-cache <args>` in `root`. A run that says `--by person` is a person's
/// script, and says so as a person does without a terminal to type ids on
/// (`DRIFT_SETUP_PERSON=1`, `DRIFT_SETUP_PERSON_NONINTERACTIVE=1`); no other run sets
/// them.
fn command(root: &Path, args: &[&str]) -> Command {
    let mut c = Command::new(&*BIN);
    c.arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE");
    if args.windows(2).any(|w| w == ["--by", "person"]) {
        c.env("DRIFT_SETUP_PERSON", "1")
            .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1");
    }
    c
}

fn drift_in(root: &Path, args: &[&str], stdin: &str) -> String {
    let mut child = command(root, args)
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
    assert!(
        out.status.success(),
        "drift {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    drift_in(root, args, "")
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&drift(root, args)).unwrap()
}

fn config(root: &Path) -> Option<String> {
    std::fs::read_to_string(root.join(".drift/config.yaml")).ok()
}

const ROUTES: &str = r#"from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"ok": True}


@router.get("/v1/items")
async def items():
    return []


@router.get("/v1/items/{item_id}")
async def item(item_id: str):
    return {}


@router.get("/admin/stats")
async def stats():
    return {}
"#;

/// A FastAPI service `svc` started by the main compose file (no ports) and by an
/// end-to-end stack (ports published), with Terraform: a target group whose health
/// check is `/health` and whose rule forwards `/v1/*`, and a decoy for another service.
fn deploy_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/api/__init__.py", "");
    write(r, "svc/app/api/routes.py", ROUTES);
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.routes import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    write(
        r,
        "svc/Dockerfile",
        "FROM python:3.12\nCOPY . /app\nCMD [\"uvicorn\", \"app.main:app\"]\n",
    );
    write(
        r,
        "docker-compose.yml",
        "services:\n  api:\n    build: ./svc\n",
    );
    write(
        r,
        "e2e/docker-compose.e2e.yml",
        "services:\n  api:\n    build: ../svc\n    ports:\n      - \"8000:8000\"\n",
    );
    write(
        r,
        "infra/api/main.tf",
        "resource \"aws_lb_target_group\" \"api\" {\n  name = \"api-tg\"\n  port = 8000\n  health_check {\n    path = \"/health\"\n  }\n}\n\nresource \"aws_lb_listener_rule\" \"api\" {\n  action {\n    type             = \"forward\"\n    target_group_arn = aws_lb_target_group.api.arn\n  }\n  condition {\n    path_pattern {\n      values = [\"/v1/*\"]\n    }\n  }\n}\n",
    );
    write(
        r,
        "infra/billing/main.tf",
        "resource \"aws_lb_target_group\" \"billing\" {\n  name = \"billing-tg\"\n  port = 9000\n  health_check {\n    path = \"/billing/health\"\n  }\n}\n",
    );
    dir
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

    def maybe(self, rule, strict):
        if strict:
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


@router.get("/c")
async def read_c(rule_id: str, service: RuleBookDep):
    return service.read(rule_id)


@router.get("/maybe")
async def read_maybe(rule_id: str, strict: bool, service: RuleBookDep):
    return service.maybe(rule_id, strict)
"#;

/// A service whose routes reach a tenant check Drift found and could not prove (it is
/// skipped for global rules): three on every request, one only under a branch.
fn check_repo() -> tempfile::TempDir {
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
    write(
        r,
        "svc/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.api.rules import router\n\napp = FastAPI()\napp.include_router(router)\n",
    );
    dir
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

fn all(exposure: &str) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = [
        "/admin/stats",
        "/health",
        "/v1/items",
        "/v1/items/{item_id}",
    ]
    .iter()
    .map(|r| (r.to_string(), exposure.to_string()))
    .collect();
    v.sort();
    v
}

fn questions(root: &Path, all: bool) -> Vec<Value> {
    let mut args = vec!["setup", "--json"];
    if all {
        args.push("--all");
    }
    let v = json(root, &args);
    assert_eq!(v["schema"], "drift-setup-questions");
    assert_eq!(v["version"], 1);
    v["questions"].as_array().unwrap().clone()
}

/// The authz unit of `symbol`: `(assignment, declared text)`.
fn authz(root: &Path, symbol: &str) -> (String, String) {
    let v = json(root, &["practices", "--json", "--units"]);
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
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

/// The test stack: asked once with how many routes each answer moves, answered by
/// `--answer`, written under `security.not_deployed` with a comment, then the next
/// question (Terraform) is about what is left. Asked again: nothing. Forgotten: as
/// before, byte for byte.
#[test]
fn a_test_stack_is_asked_answered_and_forgotten() {
    let dir = deploy_repo();
    let r = dir.path();
    assert_eq!(exposures(r), all("public"));
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    let q = &qs[0];
    assert_eq!(q["kind"], "deployment");
    assert_eq!(q["status"], "open");
    assert_eq!(q["default"], "skip");
    let id = q["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("S-") && id.len() == 6, "{id}");
    assert_eq!(
        q["question"],
        "Is this file used to deploy, or only for tests or local development?"
    );
    assert_eq!(q["text"][0], "`e2e/docker-compose.e2e.yml` starts svc.");
    let tests_only = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["answer"] == "tests-only")
        .unwrap();
    assert_eq!(tests_only["moves"], 4);
    assert_eq!(
        tests_only["effect"],
        "Drift leaves the file out: 4 routes of svc go from reachable from the internet to unknown."
    );
    assert_eq!(tests_only["writes_under"], "security.not_deployed");
    // The main compose file is the only other description: leaving it out moves no
    // route any other file speaks for, so it is not asked about.
    let text = drift(r, &["setup", "--list"]);
    assert!(
        text.contains(&format!(
            "drift setup --answer {id}=<deploys|tests-only|skip>"
        )),
        "{text}"
    );
    let said = drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    assert_eq!(
        said,
        format!(
            "{id}: Drift leaves the file out: 4 routes of svc go from reachable from the internet to unknown.\n"
        )
    );
    let cfg = config(r).unwrap();
    let today = &cfg[cfg.find('(').unwrap() + 1..cfg.find(')').unwrap()];
    let comment = format!(
        "# drift setup {id} ({today}), asked whether `e2e/docker-compose.e2e.yml` is used to deploy: only for tests or local development"
    );
    assert_eq!(
        cfg,
        format!(
            "security:\n  not_deployed:\n    {comment}\n    - \"e2e/docker-compose.e2e.yml\"\n\nsetup:\n  {comment}\n  {id}: {{answer: \"tests-only\", seen: \"{}\"}}\n",
            q["evidence"].as_str().unwrap()
        )
    );
    assert_eq!(exposures(r), all("unknown"));
    // Answered: not asked again. The question that is left is the Terraform one.
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    assert_eq!(qs[0]["kind"], "terraform");
    let every = questions(r, true);
    let again = every.iter().find(|q| q["id"] == id.as_str()).unwrap();
    assert_eq!(again["status"], "answered");
    assert_eq!(again["answered"], "tests-only");
    // Forgotten: the file is gone again (setup wrote all of it), and Drift is as
    // before.
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    assert_eq!(config(r).unwrap(), "");
    assert_eq!(exposures(r), all("public"));
}

/// The Terraform tie: the target group that matches the service (by its health check
/// and the paths its rule forwards) is offered first, the decoy after it; "yes" ties
/// them and the rules decide each route.
#[test]
fn a_terraform_target_group_is_offered_by_what_matches_and_tied() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    let q = questions(r, false).remove(0);
    assert_eq!(q["kind"], "terraform");
    assert_eq!(q["question"], "Is that right?");
    assert_eq!(
        q["text"][1],
        "Target group `api` (infra/api/main.tf:1) looks like the one that sends requests to svc: its health check /health is a route of svc; its rules send /v1/*, which 2 routes of svc start with."
    );
    assert!(
        q["text"][2].as_str().unwrap().starts_with(
            "Drift will take your word that only this target group sends requests to svc"
        ),
        "{q:#}"
    );
    let choices: Vec<&str> = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["label"].as_str().unwrap())
        .collect();
    assert_eq!(
        choices,
        [
            "Yes, it is `api`",
            "No, it is `billing` (infra/billing/main.tf:1)",
            "Terraform does not deploy this service",
            "Skip / not sure"
        ]
    );
    assert_eq!(
        q["choices"][0]["effect"],
        "2 routes of svc go from unknown to reachable from the internet; 2 routes of svc go from unknown to reachable only from inside."
    );
    let tid = q["id"].as_str().unwrap();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{tid}=tie-1"),
        ],
    );
    assert!(
        config(r).unwrap().contains("  terraform:\n")
            && config(r)
                .unwrap()
                .contains("    - {target: \"infra/api#aws_lb_target_group.api\", code: \"svc\"}\n"),
        "{}",
        config(r).unwrap()
    );
    assert_eq!(
        exposures(r),
        [
            ("/admin/stats".to_string(), "internal".to_string()),
            ("/health".to_string(), "internal".to_string()),
            ("/v1/items".to_string(), "public".to_string()),
            ("/v1/items/{item_id}".to_string(), "public".to_string()),
        ]
    );
    assert!(questions(r, false).is_empty());
    // Forgetting the test stack leaves the tie, which is the person's other answer.
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    assert!(config(r).unwrap().contains("aws_lb_target_group.api"));
    assert!(!config(r).unwrap().contains("not_deployed"));
}

/// The check: shown with where it is, its first lines, why Drift cannot count it, the
/// note on what it lets through, and exactly which routes a "yes" settles and which
/// stay unknown and why. "Yes" writes a `practices:` line; the practice map then
/// says the routes are known on the person's word, and the one that calls the check
/// under a branch is still unknown.
#[test]
fn a_check_is_shown_with_its_gap_and_declared_on_a_yes() {
    let dir = check_repo();
    let r = dir.path();
    assert_eq!(authz(r, "read_a").0, "unknown");
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    let q = &qs[0];
    assert_eq!(q["kind"], "check");
    assert_eq!(
        q["text"][0],
        "`RuleBook._ensure_access` (svc/app/services.py:9) is called by 4 routes:"
    );
    assert!(
        q["text"][1]
            .as_str()
            .unwrap()
            .contains("def _ensure_access(self, rule):")
    );
    assert_eq!(
        q["text"][2],
        "Drift found a tenant check in it, but cannot count it: it is skipped when `rule.visibility == Visibility.SHARED`."
    );
    assert_eq!(
        q["text"][3],
        "If you say yes, Drift counts it as checked, on your word, on 3 routes. `GET /rules/maybe` (read_maybe) stays unknown: it calls the check only under a branch."
    );
    assert!(
        q["note"]
            .as_str()
            .unwrap()
            .starts_with("Note: this check lets some requests through: it is skipped when `rule.visibility == Visibility.SHARED`."),
        "{q:#}"
    );
    assert_eq!(
        q["question"],
        "Is `_ensure_access` your check that the caller may act on this record?"
    );
    let id = q["id"].as_str().unwrap();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tenant"),
        ],
    );
    assert!(
        config(r).unwrap().contains("practices:\n  authz:\n")
            && config(r).unwrap().contains(
                "    \"svc/app/services.py#RuleBook._ensure_access\": \"tenant check\"\n"
            ),
        "{}",
        config(r).unwrap()
    );
    for symbol in ["read_a", "read_b", "read_c"] {
        assert_eq!(
            authz(r, symbol),
            (
                "known".to_string(),
                "tenant check (declared in .drift/config.yaml: RuleBook._ensure_access)"
                    .to_string()
            )
        );
    }
    assert_eq!(authz(r, "read_maybe").0, "unknown");
    // Changing the answer replaces what it wrote.
    drift(
        r,
        &["setup", "--by", "person", "--answer", &format!("{id}=no")],
    );
    let cfg = config(r).unwrap();
    assert!(!cfg.contains("practices:"), "{cfg}");
    assert!(cfg.contains(&format!("{id}: {{answer: \"no\",")), "{cfg}");
    assert_eq!(authz(r, "read_a").0, "unknown");
}

/// `drift practices --hints` does not offer the line a "no" answered: merging it would
/// undo the answer. The left-out line says which answer, and forgetting it brings the
/// line back. An agent's "no" counts too (it takes effect at once).
#[test]
fn hints_leave_out_a_check_answered_no() {
    let dir = check_repo();
    let r = dir.path();
    let line = "\"svc/app/services.py#RuleBook._ensure_access\": \"RuleBook._ensure_access\"";
    let hints = drift(r, &["practices", "--hints"]);
    assert!(hints.contains(line), "{hints}");
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    for answer in [
        vec!["setup", "--by", "person", "--answer"],
        vec![
            "setup",
            "--reason",
            "it lets SHARED rules through",
            "--evidence",
            "svc/app/services.py:9",
            "--answer",
        ],
    ] {
        let mut args = answer.clone();
        let pair = format!("{id}=no");
        args.push(&pair);
        drift(r, &args);
        let hints = drift(r, &["practices", "--hints"]);
        assert!(!hints.contains(line), "{hints}");
        assert!(
            hints.contains(&format!(
                "# left out: \"svc/app/services.py#RuleBook._ensure_access\" under authz: answered not a check by {id} (`drift setup --forget {id}` asks again)"
            )),
            "{hints}"
        );
        drift(r, &["setup", "--by", "person", "--forget", &id]);
        let hints = drift(r, &["practices", "--hints"]);
        assert!(
            hints.contains(line) && !hints.contains("# left out"),
            "{hints}"
        );
    }
}

/// `drift practices --hints` does not offer the line of a check an agent proposed and a
/// person rejected (in review or with `--reject`): merging it would undo the person's
/// word. The left-out line names the question, and forgetting the rejection brings the
/// line back. A proposal still waiting leaves the line as it is.
#[test]
fn hints_leave_out_a_check_a_person_rejected() {
    let dir = check_repo();
    let r = dir.path();
    let line = "\"svc/app/services.py#RuleBook._ensure_access\": \"RuleBook._ensure_access\"";
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    let reason = "services.py:9 compares rule.tenant_id with the caller's tenant_id";
    let left_out = format!(
        "# left out: \"svc/app/services.py#RuleBook._ensure_access\" under authz: rejected by a person in {id}, proposed as a check (`drift setup --forget {id}` asks again)"
    );
    for reject in [
        vec!["setup", "--by", "person", "--review"],
        vec!["setup", "--by", "person", "--reject", id.as_str()],
    ] {
        drift(r, &agent(&format!("{id}=tenant"), reason));
        let hints = drift(r, &["practices", "--hints"]);
        assert!(
            hints.contains(line) && !hints.contains("# left out"),
            "{hints}"
        );
        drift_in(r, &reject, "r\n");
        assert!(config(r).unwrap().contains("  rejected:\n"));
        let hints = drift(r, &["practices", "--hints"]);
        assert!(!hints.contains(line), "{hints}");
        assert!(hints.contains(&left_out), "{hints}");
        drift(r, &["setup", "--by", "person", "--forget", &id]);
        let hints = drift(r, &["practices", "--hints"]);
        assert!(
            hints.contains(line) && !hints.contains("# left out"),
            "{hints}"
        );
    }
}

/// "Skip", everywhere, changes nothing: no file, the same reports.
#[test]
fn skip_changes_nothing() {
    for dir in [deploy_repo(), check_repo()] {
        let r = dir.path();
        let security = drift(r, &["security", "--json"]);
        let practices = drift(r, &["practices", "--json", "--units"]);
        for q in questions(r, false) {
            let id = q["id"].as_str().unwrap();
            drift(
                r,
                &["setup", "--by", "person", "--answer", &format!("{id}=skip")],
            );
        }
        // Enter on every question of a terminal run.
        drift_in(r, &["setup", "--by", "person", "--interactive"], "\n\n\n\n");
        assert_eq!(config(r), None);
        assert_eq!(drift(r, &["security", "--json"]), security);
        assert_eq!(drift(r, &["practices", "--json", "--units"]), practices);
    }
}

/// A config a person wrote, with comments, keeps every byte outside what setup adds,
/// through answers of each kind and their forgetting.
#[test]
fn a_hand_written_config_survives_byte_for_byte() {
    let hand = "# Settings for Drift. Keep this comment.\nexperimental: []\n\nsecurity:\n  # We say these ourselves.\n  internal:\n    - docs   # the docs site\n\nagents:\n  brief: on\n";
    let dir = deploy_repo();
    let r = dir.path();
    write(r, ".drift/config.yaml", hand);
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    let cfg = config(r).unwrap();
    // The person's lines stay where they were; setup's go under their key and at the end.
    assert!(
        cfg.starts_with("# Settings for Drift. Keep this comment.\nexperimental: []\n\nsecurity:\n  # We say these ourselves.\n  internal:\n    - docs   # the docs site\n  not_deployed:\n"),
        "{cfg}"
    );
    assert!(
        cfg.contains("\n\nagents:\n  brief: on\n\nsetup:\n"),
        "{cfg}"
    );
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    assert_eq!(config(r).unwrap(), hand);
}

/// A terminal run, scripted on stdin: one question at a time, the line that says what
/// changed after each answer, the next question computed from it, and the summary.
#[test]
fn an_interactive_run_asks_one_at_a_time_and_sums_up() {
    let dir = deploy_repo();
    let r = dir.path();
    let out = drift_in(r, &["setup", "--by", "person", "--interactive"], "2\n1\n");
    assert!(
        out.starts_with("Drift found 1 thing only you can answer (about 1 minute). Press Enter to skip any of them.\n"),
        "{out}"
    );
    assert!(out.contains("Question 1 of 1 ("), "{out}");
    assert!(
        out.contains("  2. Only for tests or local development: "),
        "{out}"
    );
    assert!(out.contains("  s. Skip / not sure (default): "), "{out}");
    assert!(
        out.contains("  -> Drift leaves the file out: 4 routes of svc go from reachable from the internet to unknown.\n"),
        "{out}"
    );
    // The answer opened the Terraform question, asked next.
    assert!(out.contains("Question 2 of 2 ("), "{out}");
    assert!(out.contains("  1. Yes, it is `api`: "), "{out}");
    assert!(
        out.contains(
            "Before: routes: 4 reachable from the internet, 0 unknown, 0 reachable only from inside"
        ),
        "{out}"
    );
    assert!(
        out.contains(
            "After:  routes: 2 reachable from the internet, 0 unknown, 2 reachable only from inside"
        ),
        "{out}"
    );
    assert!(
        out.contains(
            "Written: .drift/config.yaml. Commit it so your teammates get the same answers."
        ),
        "{out}"
    );
    assert_eq!(
        drift(r, &["setup", "--list"]).lines().next(),
        Some(
            "Nothing to ask: Drift has no question only you can answer (2 answered in .drift/config.yaml; `drift setup --all` asks them again)."
        )
    );
}

/// A question whose evidence changed is asked again.
#[test]
fn an_answer_on_changed_evidence_is_asked_again() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=deploys"),
        ],
    );
    // "It deploys" writes nothing but the answer.
    assert!(!config(r).unwrap().contains("security:"));
    assert!(questions(r, false).is_empty());
    write(
        r,
        "e2e/docker-compose.e2e.yml",
        "services:\n  api:\n    build: ../svc\n    ports:\n      - \"8001:8000\"\n",
    );
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    assert_eq!(qs[0]["status"], "changed");
    assert_eq!(qs[0]["answered"], "deploys");
}

/// No question uses Drift's internal words for things: a person reads "test stack",
/// "deploys", "tenant check", "routes", "every request", never these.
#[test]
fn no_question_uses_internal_words() {
    const INTERNAL: &[&str] = &[
        "not_deployed",
        "tenancy",
        "instrument",
        "unit",
        "units",
        "obligation",
        "verdict",
        "exposure",
        "boundary",
    ];
    let mut texts: Vec<String> = Vec::new();
    let dir = deploy_repo();
    let r = dir.path();
    texts.push(drift(r, &["setup", "--list"]));
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    texts.push(drift(r, &["setup", "--list"]));
    let dir = check_repo();
    texts.push(drift(dir.path(), &["setup", "--list"]));
    for text in &texts {
        // What is in backticks is the person's own code, quoted.
        let plain: String = text
            .split('`')
            .enumerate()
            .filter(|(i, _)| i % 2 == 0)
            .map(|(_, s)| s)
            .collect::<Vec<_>>()
            .join(" ");
        for line in plain.lines() {
            // The code lines shown, and the commands, are the person's code and Drift's CLI.
            if line.starts_with("    ") || line.trim_start().starts_with("Answer: drift setup") {
                continue;
            }
            for w in line.split(|c: char| !(c.is_alphanumeric() || c == '_')) {
                assert!(
                    !INTERNAL.contains(&w.to_lowercase().as_str()),
                    "`{w}` in: {line}"
                );
            }
        }
    }
}

/// `drift init` lists `drift setup` among its next steps where there are questions open,
/// and not once they are answered.
#[test]
fn init_ends_with_the_open_questions() {
    let dir = deploy_repo();
    let r = dir.path();
    let out = drift(r, &["init"]);
    assert!(
        out.contains("\nNext\n  drift setup                1 question only you can answer\n"),
        "{out}"
    );
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=deploys"),
        ],
    );
    let out = drift(r, &["init"]);
    assert!(!out.contains("only you can answer"), "{out}");
}

/// Where Terraform is all that deploys a service (no compose file describes it), the
/// tie is still asked: nothing else speaks for its routes.
#[test]
fn a_service_only_terraform_deploys_is_asked_about() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_file(r.join("docker-compose.yml")).unwrap();
    std::fs::remove_dir_all(r.join("e2e")).unwrap();
    assert_eq!(exposures(r), all("unknown"));
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    assert_eq!(qs[0]["kind"], "terraform");
    assert!(
        qs[0]["text"][0]
            .as_str()
            .unwrap()
            .ends_with("Nothing else in the repository says how they are deployed."),
        "{:#}",
        qs[0]
    );
    let id = qs[0]["id"].as_str().unwrap();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tie-1"),
        ],
    );
    assert_eq!(
        exposures(r),
        [
            ("/admin/stats".to_string(), "internal".to_string()),
            ("/health".to_string(), "internal".to_string()),
            ("/v1/items".to_string(), "public".to_string()),
            ("/v1/items/{item_id}".to_string(), "public".to_string()),
        ]
    );
}

/// The same where the compose files are there and a person left them all out: what
/// they would have said is no description.
#[test]
fn a_service_whose_compose_files_are_all_left_out_is_asked_about() {
    let dir = deploy_repo();
    let r = dir.path();
    write(
        r,
        ".drift/config.yaml",
        "security:\n  not_deployed:\n    - docker-compose.yml\n    - e2e\n",
    );
    assert_eq!(exposures(r), all("unknown"));
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    assert_eq!(qs[0]["kind"], "terraform");
    assert_eq!(qs[0]["choices"][0]["label"], "Yes, it is `api`");
}

// ---------- an agent's answers: the trust rule ----------

/// `drift` that must fail: its stderr.
fn drift_fails(root: &Path, args: &[&str], stdin: &str) -> String {
    let mut child = command(root, args)
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
    assert!(!out.status.success(), "drift {args:?} succeeded");
    String::from_utf8(out.stderr).unwrap()
}

/// What an agent answers with (stdin is not a terminal: `--by agent` is the default).
fn agent<'a>(id_answer: &'a str, reason: &'a str) -> Vec<&'a str> {
    vec![
        "setup",
        "--answer",
        id_answer,
        "--reason",
        reason,
        "--evidence",
        "e2e/docker-compose.e2e.yml:1",
    ]
}

/// Everything a proposal must leave as it was: the security inventory, the practice
/// map, a card, the census and the session hook.
fn everything(root: &Path, file: &str) -> Vec<String> {
    vec![
        drift(root, &["security", "--json"]),
        drift(root, &["practices", "--json", "--units"]),
        drift(root, &["card", file]),
        drift(root, &["census", "--json", "--max", "15"]),
        drift_in(
            root,
            &["hook", "claude", "SessionStart"],
            r#"{"session_id":"t","hook_event_name":"SessionStart","source":"startup"}"#,
        ),
    ]
}

/// An agent's answer that can only make Drift more cautious takes effect at once and
/// says who gave it and why; without a reason it is refused.
#[test]
fn an_agents_cautious_answer_takes_effect_with_its_reason() {
    let dir = deploy_repo();
    let r = dir.path();
    let q = questions(r, false).remove(0);
    let id = q["id"].as_str().unwrap().to_string();
    let tests_only = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["answer"] == "tests-only")
        .unwrap();
    // Routes go from the internet to unknown: never a false "inside".
    assert_eq!(tests_only["needs_person"], false);
    let err = drift_fails(r, &["setup", "--answer", &format!("{id}=tests-only")], "");
    assert!(err.contains("an agent's answer needs a reason"), "{err}");
    assert_eq!(config(r), None);
    let said = drift(
        r,
        &agent(
            &format!("{id}=tests-only"),
            "the e2e workflow runs it with `docker compose up` for tests",
        ),
    );
    assert!(
        said.contains("go from reachable from the internet to unknown"),
        "{said}"
    );
    assert_eq!(exposures(r), all("unknown"));
    let cfg = config(r).unwrap();
    assert!(
        cfg.contains("only for tests or local development; answered by an agent because the e2e workflow runs it with `docker compose up` for tests\n"),
        "{cfg}"
    );
    assert!(
        cfg.contains(&format!("  {id}: {{answer: \"tests-only\", seen: \"{}\", by: \"agent\", reason: \"the e2e workflow runs it with `docker compose up` for tests\", evidence: [\"e2e/docker-compose.e2e.yml:1\"], on: ", q["evidence"].as_str().unwrap())),
        "{cfg}"
    );
    let again = questions(r, true);
    let again = again.iter().find(|q| q["id"] == id.as_str()).unwrap();
    assert_eq!(again["status"], "answered");
    assert_eq!(again["answered_by"], "agent");
}

/// The Terraform tie by an agent is a proposal: nothing Drift says changes (security,
/// practices, the card, the census, the session hook) until a person confirms it; then
/// it is exactly a person's answer, and the comment says who proposed it and why.
#[test]
fn an_agents_tie_is_a_proposal_until_a_person_confirms_it() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    let q = questions(r, false).remove(0);
    assert_eq!(q["kind"], "terraform");
    assert_eq!(q["choices"][0]["needs_person"], true);
    let tid = q["id"].as_str().unwrap().to_string();
    let before = everything(r, "svc/app/api/routes.py");
    let cfg_before = config(r).unwrap();
    let said = drift(
        r,
        &agent(
            &format!("{tid}=tie-1"),
            "infra/api/main.tf:1 health check /health and rule /v1/* match svc",
        ),
    );
    assert!(
        said.starts_with(&format!("{tid}: proposed, waiting for a person")),
        "{said}"
    );
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    let cfg = config(r).unwrap();
    // Only the record under setup.proposed was added.
    assert!(cfg.starts_with(&cfg_before), "{cfg}");
    assert!(cfg.contains("\n  proposed:\n    # drift setup "), "{cfg}");
    assert!(!cfg.contains("terraform:"), "{cfg}");
    // Listed first, waiting for a person.
    let listing = json(r, &["setup", "--json"]);
    assert_eq!(listing["waiting"], 1);
    assert_eq!(listing["questions"][0]["status"], "proposed");
    assert_eq!(listing["questions"][0]["proposal"]["answer"], "tie-1");
    assert_eq!(listing["questions"][0]["proposal"]["by"], "agent");
    let text = drift(r, &["setup", "--list"]);
    assert!(
        text.contains("is an answer an agent gave, waiting for a person: `drift setup --review`"),
        "{text}"
    );
    assert!(
        text.contains(&format!("drift setup --confirm {tid}")),
        "{text}"
    );
    // An agent cannot confirm, nor review.
    let err = drift_fails(r, &["setup", "--confirm", &tid], "");
    assert!(err.contains("--confirm is for a person"), "{err}");
    let err = drift_fails(r, &["setup", "--review"], "c\n");
    assert!(err.contains("--review is for a person"), "{err}");
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    // Confirmed: as a person's answer.
    let said = drift(r, &["setup", "--by", "person", "--confirm", &tid]);
    assert!(said.starts_with(&format!("{tid}: confirmed: ")), "{said}");
    let cfg = config(r).unwrap();
    assert!(!cfg.contains("proposed:"), "{cfg}");
    assert!(
        cfg.contains("; proposed by an agent on ")
            && cfg.contains(" because infra/api/main.tf:1 health check /health and rule /v1/* match svc; confirmed\n"),
        "{cfg}"
    );
    assert!(cfg.contains("confirmed_by: \"person\""), "{cfg}");
    let person = deploy_repo();
    let p = person.path();
    drift(
        p,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    drift(
        p,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{tid}=tie-1"),
        ],
    );
    assert_eq!(
        drift(r, &["security", "--json"]),
        drift(p, &["security", "--json"])
    );
    assert!(questions(r, false).is_empty());
}

/// A tenant check by an agent is a proposal with no effect on the practice map; a
/// person rejects it: it goes, a record stays, and the question is not asked again on
/// the same evidence, nor can the agent propose the same again; once the code changes
/// it is asked again. "No" by an agent takes effect.
#[test]
fn an_agents_check_is_a_proposal_and_a_rejection_is_remembered() {
    let dir = check_repo();
    let r = dir.path();
    let q = questions(r, false).remove(0);
    let id = q["id"].as_str().unwrap().to_string();
    for c in q["choices"].as_array().unwrap() {
        let fact = matches!(c["answer"].as_str().unwrap(), "tenant" | "owner" | "role");
        assert_eq!(c["needs_person"], fact, "{c:#}");
    }
    let before = everything(r, "svc/app/api/rules.py");
    let reason = "services.py:9 compares rule.tenant_id with the caller's tenant_id";
    drift(r, &agent(&format!("{id}=tenant"), reason));
    assert_eq!(everything(r, "svc/app/api/rules.py"), before);
    assert_eq!(authz(r, "read_a").0, "unknown");
    // Reviewed in a terminal (scripted): rejected.
    let out = drift_in(r, &["setup", "--by", "person", "--review"], "r\n");
    assert!(out.contains("An agent answered this on "), "{out}");
    assert!(out.contains(&format!("Its reason: {reason}")), "{out}");
    assert!(
        out.contains("What it read: e2e/docker-compose.e2e.yml:1"),
        "{out}"
    );
    assert!(out.contains("Confirmed 0, rejected 1, waiting 0."), "{out}");
    // Only the agent's answer is offered: confirm, reject or skip.
    assert!(!out.contains("Yes, it checks the caller's role"), "{out}");
    assert_eq!(everything(r, "svc/app/api/rules.py"), before);
    let cfg = config(r).unwrap();
    assert!(
        cfg.contains("  rejected:\n    # drift setup-rejected "),
        "{cfg}"
    );
    assert!(questions(r, false).is_empty());
    let every = questions(r, true);
    assert_eq!(every[0]["status"], "rejected");
    assert_eq!(every[0]["rejected"]["answer"], "tenant");
    let err = drift_fails(r, &agent(&format!("{id}=tenant"), reason), "");
    assert!(err.contains("a person rejected `tenant`"), "{err}");
    // "No" is cautious: it takes effect, and the rejection stays beside it.
    drift(r, &agent(&format!("{id}=no"), "not sure it is a check"));
    let every = questions(r, true);
    assert_eq!(every[0]["status"], "answered");
    assert!(config(r).unwrap().contains("rejected:"));
    assert_eq!(everything(r, "svc/app/api/rules.py"), before);
    // The check's code changes: the question is open again.
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    drift(r, &agent(&format!("{id}=tenant"), reason));
    drift(r, &["setup", "--by", "person", "--reject", &id]);
    write(
        r,
        "svc/app/services.py",
        &SERVICES.replace("another tenant", "another team"),
    );
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    assert_eq!(qs[0]["status"], "open");
    assert_eq!(qs[0]["rejected"]["stale"], true);
    // Proposed again and confirmed in review: known, on the person's word.
    let id = qs[0]["id"].as_str().unwrap().to_string();
    drift(r, &agent(&format!("{id}=tenant"), reason));
    let out = drift_in(r, &["setup", "--by", "person", "--review"], "c\n");
    assert!(out.contains("Confirmed 1, rejected 0, waiting 0."), "{out}");
    assert_eq!(authz(r, "read_a").0, "known");
    assert!(!config(r).unwrap().contains("rejected:"));
}

/// "Nothing outside can reach these services" by an agent is a proposal; "some" takes
/// effect.
#[test]
fn an_agents_word_that_nothing_outside_reaches_is_a_proposal() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_dir_all(r.join("e2e")).unwrap();
    std::fs::remove_dir_all(r.join("infra/api")).unwrap();
    let qs = questions(r, false);
    assert_eq!(qs.len(), 1, "{qs:#?}");
    let q = &qs[0];
    assert_eq!(q["question"], "Can requests from outside reach svc?");
    let id = q["id"].as_str().unwrap().to_string();
    let before = everything(r, "svc/app/api/routes.py");
    drift(
        r,
        &agent(&format!("{id}=none"), "the compose file publishes no port"),
    );
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    assert!(!config(r).unwrap().contains("internal:"));
    drift(
        r,
        &agent(&format!("{id}=some"), "infra/billing may front it"),
    );
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    assert!(!config(r).unwrap().contains("proposed:"));
    assert_eq!(questions(r, true)[0]["status"], "answered");
}

/// Leaving out a compose file is cautious only while no route becomes reachable only
/// from inside: where what is left keeps the service inside, it is a proposal.
#[test]
fn an_agents_test_stack_that_would_make_routes_inside_is_a_proposal() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_dir_all(r.join("infra")).unwrap();
    let q = questions(r, false).remove(0);
    let id = q["id"].as_str().unwrap().to_string();
    let tests_only = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["answer"] == "tests-only")
        .unwrap();
    assert!(
        tests_only["effect"]
            .as_str()
            .unwrap()
            .contains("to reachable only from inside"),
        "{tests_only:#}"
    );
    assert_eq!(tests_only["needs_person"], true);
    let before = everything(r, "svc/app/api/routes.py");
    drift(r, &agent(&format!("{id}=tests-only"), "named e2e"));
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    assert_eq!(exposures(r), all("public"));
    drift(r, &["setup", "--by", "person", "--confirm", &id]);
    assert_eq!(exposures(r), all("internal"));
}

/// An agent does not replace a person's answer, nor ask questions one at a time.
#[test]
fn an_agent_does_not_replace_a_persons_answer() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=deploys"),
        ],
    );
    let cfg = config(r).unwrap();
    let err = drift_fails(r, &agent(&format!("{id}=tests-only"), "named e2e"), "");
    assert!(err.contains("was answered by a person"), "{err}");
    assert_eq!(config(r).unwrap(), cfg);
    let err = drift_fails(r, &["setup", "--interactive"], "\n");
    assert!(err.contains("is for a person"), "{err}");
}

// ---------- the evidence an agent reads ----------

fn with_evidence(root: &Path) -> Vec<Value> {
    let v = json(root, &["setup", "--json", "--evidence"]);
    v["questions"].as_array().unwrap().clone()
}

/// The excerpt of `q` whose `what` starts with `what`, in `file`.
fn excerpt<'a>(q: &'a Value, what: &str, file: &str) -> &'a Value {
    q["context"]["excerpts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["what"].as_str().unwrap().starts_with(what) && e["file"] == file)
        .unwrap_or_else(|| panic!("no excerpt `{what}` of {file} in {:#}", q["context"]))
}

fn facts(q: &Value) -> Vec<String> {
    q["context"]["facts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f.as_str().unwrap().to_string())
        .collect()
}

/// A deployment question shows the compose file's service, its comments, the other
/// compose file of the same code, what Drift read of each route, and every place that
/// names the file, each with its line; without `--evidence`, none of it.
#[test]
fn the_evidence_of_a_test_stack() {
    let dir = deploy_repo();
    let r = dir.path();
    write(
        r,
        "e2e/docker-compose.e2e.yml",
        "# The end-to-end stack: brought up by CI before the browser tests.\nservices:\n  api:\n    build: ../svc\n    ports:\n      - \"8000:8000\"\n",
    );
    write(
        r,
        ".github/workflows/e2e.yml",
        "name: e2e\non: [pull_request]\njobs:\n  e2e:\n    steps:\n      - run: docker compose -f e2e/docker-compose.e2e.yml up -d\n      - run: npm test\n",
    );
    write(
        r,
        "Makefile",
        "e2e:\n\tdocker compose -f e2e/docker-compose.e2e.yml up\n",
    );
    write(
        r,
        "docs/testing.md",
        "# Testing\n\nRun `docker-compose.e2e.yml` locally.\n",
    );
    let plain = questions(r, false);
    assert!(plain[0].get("context").is_none());
    assert!(
        plain[0]["how_to_decide"]
            .as_str()
            .unwrap()
            .contains("A file or folder name alone")
    );
    let q = with_evidence(r).remove(0);
    assert_eq!(q["kind"], "deployment");
    let svc = excerpt(&q, "compose service `api`", "e2e/docker-compose.e2e.yml");
    assert_eq!(svc["line"], 3);
    assert_eq!(
        svc["text"],
        "  api:\n    build: ../svc\n    ports:\n      - \"8000:8000\""
    );
    assert_eq!(
        excerpt(&q, "the file's own comments", "e2e/docker-compose.e2e.yml")["line"],
        1
    );
    assert_eq!(
        excerpt(
            &q,
            "the same code in another compose file",
            "docker-compose.yml"
        )["text"],
        "  api:\n    build: ./svc"
    );
    let ci = excerpt(&q, "names the file", ".github/workflows/e2e.yml");
    assert_eq!(ci["line"], 5);
    assert!(
        ci["text"]
            .as_str()
            .unwrap()
            .contains("docker compose -f e2e/docker-compose.e2e.yml up -d")
    );
    assert_eq!(excerpt(&q, "names the file", "Makefile")["line"], 1);
    assert_eq!(
        excerpt(&q, "names a file by this name", "docs/testing.md")["line"],
        2
    );
    let f = facts(&q);
    assert!(
        f.iter()
            .any(|f| f.starts_with("3 lines in workflows, scripts, Dockerfiles and docs name it")),
        "{f:#?}"
    );
    assert!(
        f.contains(&"svc (4 routes): 4 reachable from the internet. What Drift read: reachable from the internet: compose service api in e2e/docker-compose.e2e.yml publishes ports (4).".to_string()),
        "{f:#?}"
    );
    assert!(
        f.contains(
            &"Other compose files start the same code: `docker-compose.yml` (api).".to_string()
        ),
        "{f:#?}"
    );
    assert!(
        f.iter()
            .any(|f| f.starts_with("Drift does not read Terraform")),
        "{f:#?}"
    );
}

/// A Terraform question shows each candidate target group with what matched and what
/// did not, the group's resource and the listener rule that sends to it, the decoy, the
/// service's compose definition and start command, and its routes.
#[test]
fn the_evidence_of_a_terraform_tie() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    let q = with_evidence(r).remove(0);
    assert_eq!(q["kind"], "terraform");
    let f = facts(&q);
    assert!(
        f.contains(&"Most likely: Target group `api` (infra/api/main.tf:1, port 8000, health check /health, rules send /v1/*). Matched: its health check /health is a route of svc; its rules send /v1/*, which 2 routes of svc start with. Did not match: nothing.".to_string()),
        "{f:#?}"
    );
    assert!(
        f.contains(&"Not a candidate: Target group `billing` (infra/billing/main.tf:1, port 9000, health check /billing/health). Matched: nothing. Did not match: its health check /billing/health is not a route of svc; no listener rule Drift reads sends requests to it.".to_string()),
        "{f:#?}"
    );
    assert!(
        f.contains(
            &"The routes of svc (4): /admin/stats, /health, /v1/items, /v1/items/{item_id}"
                .to_string()
        ),
        "{f:#?}"
    );
    let tg = excerpt(&q, "target group `api`", "infra/api/main.tf");
    assert_eq!(tg["line"], 1);
    assert!(
        tg["text"]
            .as_str()
            .unwrap()
            .ends_with("    path = \"/health\"\n  }\n}")
    );
    let rule = excerpt(
        &q,
        "a listener rule that sends to `api`",
        "infra/api/main.tf",
    );
    assert_eq!(rule["line"], 9);
    assert!(
        rule["text"]
            .as_str()
            .unwrap()
            .contains("values = [\"/v1/*\"]")
    );
    assert_eq!(
        excerpt(&q, "compose service `api`", "docker-compose.yml")["line"],
        2
    );
    assert_eq!(
        excerpt(&q, "what the service starts", "svc/Dockerfile")["text"],
        "CMD [\"uvicorn\", \"app.main:app\"]"
    );
}

/// The question whether anything outside reaches some services shows what Drift read
/// of them, the Terraform it does not read, and the target groups none matched.
#[test]
fn the_evidence_of_a_reach_question() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_dir_all(r.join("e2e")).unwrap();
    std::fs::remove_dir_all(r.join("infra/api")).unwrap();
    let q = with_evidence(r).remove(0);
    assert_eq!(q["question"], "Can requests from outside reach svc?");
    assert!(
        q["how_to_decide"]
            .as_str()
            .unwrap()
            .contains("private subnets")
    );
    let f = facts(&q);
    assert!(
        f.contains(
            &"Drift does not read Terraform on its own: 1 file in 1 directory: infra/billing"
                .to_string()
        ),
        "{f:#?}"
    );
    assert!(
        f.contains(&"The entry points of svc: GET /health (http, svc/app/api/routes.py:6); GET /v1/items/{item_id} (http, svc/app/api/routes.py:16); GET /v1/items (http, svc/app/api/routes.py:11); GET /admin/stats (http, svc/app/api/routes.py:21).".to_string()),
        "{f:#?}"
    );
    assert!(
        f.contains(&"Target group `billing` (infra/billing/main.tf:1, port 9000, health check /billing/health): none of these services' routes matched it.".to_string()),
        "{f:#?}"
    );
    assert!(
        f.iter()
            .any(|f| f.starts_with("svc (4 routes): 4 unknown. What Drift read: unknown: ")),
        "{f:#?}"
    );
    excerpt(&q, "compose service `api`", "docker-compose.yml");
}

/// A check question shows the function in full, its class and how the class is given
/// the caller, where the class is made, each call with the lines around it, and every
/// route with whether a "yes" counts it.
#[test]
fn the_evidence_of_a_check() {
    let dir = check_repo();
    let r = dir.path();
    let q = with_evidence(r).remove(0);
    assert_eq!(q["kind"], "check");
    let body = excerpt(&q, "the function, in full", "svc/app/services.py");
    assert_eq!(body["line"], 9);
    assert_eq!(
        body["text"],
        "    def _ensure_access(self, rule):\n        if rule.visibility == Visibility.SHARED:\n            return\n        if rule.tenant_id != self.caller.tenant_id:\n            raise ForbiddenError(\"another tenant\")"
    );
    assert_eq!(excerpt(&q, "its class", "svc/app/services.py")["line"], 5);
    assert_eq!(
        excerpt(
            &q,
            "how its class is given the caller",
            "svc/app/services.py"
        )["text"],
        "    def __init__(self, caller):\n        self.caller = caller"
    );
    assert!(
        excerpt(&q, "where `RuleBook` is made", "svc/app/deps.py")["text"]
            .as_str()
            .unwrap()
            .contains("return RuleBook(caller)")
    );
    let uses: Vec<&str> = q["context"]["excerpts"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["what"].as_str())
        .filter(|w| w.starts_with("a use of `_ensure_access`"))
        .collect();
    assert_eq!(
        uses,
        [
            "a use of `_ensure_access` (line 16)",
            "a use of `_ensure_access` (line 21)"
        ],
        "{:#}",
        q["context"]
    );
    let f = facts(&q);
    assert!(
        f.contains(&"Drift found a tenant check in `RuleBook._ensure_access`, and cannot count it: it is skipped when `rule.visibility == Visibility.SHARED`.".to_string()),
        "{f:#?}"
    );
    let routes = q["context"]["routes"].as_array().unwrap();
    assert_eq!(routes.len(), 4);
    let maybe = routes
        .iter()
        .find(|x| x["route"] == "`GET /rules/maybe` (read_maybe)")
        .unwrap();
    assert_eq!(maybe["every_request"], false);
    assert_eq!(
        maybe["stays_because"],
        "it calls the check only under a branch"
    );
    assert_eq!(maybe["handler"], "svc/app/api/rules.py:23");
    assert_eq!(
        routes.iter().filter(|x| x["every_request"] == true).count(),
        3
    );
    let h = excerpt(
        &q,
        "the handler of `GET /rules/maybe`",
        "svc/app/api/rules.py",
    );
    assert_eq!(h["line"], 23);
    assert!(
        h["text"]
            .as_str()
            .unwrap()
            .ends_with("    return service.maybe(rule_id, strict)"),
        "{h:#}"
    );
}

/// Evidence is bounded: a compose file with a very long comment and a workflow that
/// names it on hundreds of lines give excerpts of at most 40 lines, at most 25 places
/// that name it, and say how much was left out.
#[test]
fn the_evidence_is_bounded() {
    let dir = deploy_repo();
    let r = dir.path();
    let comment: String = (0..2000)
        .map(|i| format!("# line {i} {}\n", "x".repeat(500)))
        .collect();
    write(
        r,
        "e2e/docker-compose.e2e.yml",
        &format!(
            "{comment}services:\n  api:\n    build: ../svc\n    ports:\n      - \"8000:8000\"\n"
        ),
    );
    let runs: String = (0..300)
        .map(|i| format!("      - run: docker compose -f e2e/docker-compose.e2e.yml up # {i}\n"))
        .collect();
    write(
        r,
        ".github/workflows/e2e.yml",
        &format!("jobs:\n  e2e:\n    steps:\n{runs}"),
    );
    let out = drift(r, &["setup", "--json", "--evidence"]);
    assert!(out.len() < 200 * 1024, "{} bytes", out.len());
    let v: Value = serde_json::from_str(&out).unwrap();
    let q = &v["questions"][0];
    let ex = q["context"]["excerpts"].as_array().unwrap();
    assert!(ex.len() <= 30);
    for e in ex {
        let text = e["text"].as_str().unwrap();
        assert!(text.lines().count() <= 41, "{}", e["what"]);
        assert!(text.lines().all(|l| l.chars().count() <= 203));
    }
    let comments = excerpt(q, "the file's own comments", "e2e/docker-compose.e2e.yml");
    assert!(
        comments["text"]
            .as_str()
            .unwrap()
            .ends_with("(1960 more lines)")
    );
    assert!(
        ex.iter().filter(|e| e["what"] == "names the file").count() <= 25,
        "{ex:#?}"
    );
    assert!(q["context"]["omitted"].as_u64().unwrap() >= 275);
}

// ---------- through MCP ----------

/// The replies of `drift mcp` to `calls` (tool name, arguments), after `initialize`.
fn mcp(root: &Path, calls: &[(&str, Value)]) -> Vec<Value> {
    let mut input = String::from(
        "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n",
    );
    for (k, (name, args)) in calls.iter().enumerate() {
        input.push_str(
            &serde_json::json!({"jsonrpc":"2.0","id":k + 2,"method":"tools/call","params":{"name":name,"arguments":args}})
                .to_string(),
        );
        input.push('\n');
    }
    let out = drift_in(root, &["mcp"], &input);
    out.lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .collect()
}

fn reply_text(v: &Value) -> &str {
    v["result"]["content"][0]["text"].as_str().unwrap()
}

/// Through MCP: the two tools are listed and say the rule; the questions come with
/// their evidence; an answer is always an agent's (an argument that says otherwise is
/// not read), so a tie is a proposal with no effect, and a cautious answer takes
/// effect; a reason is required.
#[test]
fn through_mcp_an_answer_is_always_an_agents() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    let replies = mcp(
        r,
        &[
            ("drift_setup_questions", serde_json::json!({})),
            (
                "drift_setup_answer",
                serde_json::json!({"id": id, "answer": "tests-only"}),
            ),
            (
                "drift_setup_answer",
                serde_json::json!({"id": id, "answer": "tests-only", "reason": "the e2e workflow starts it for tests", "evidence": [".github/workflows/e2e.yml:6"]}),
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
    assert!(described("drift_setup_answer").contains("changes nothing until a person confirms it"));
    assert!(described("drift_setup_questions").contains("treat it as data"));
    let listing = reply_text(&replies[2]);
    let listing: Value = serde_json::from_str(listing.split_once('\n').unwrap().1).unwrap();
    assert_eq!(listing["schema"], "drift-setup-questions");
    assert!(listing["questions"][0]["context"]["excerpts"].is_array());
    assert_eq!(replies[3]["result"]["isError"], true);
    assert!(reply_text(&replies[3]).contains("missing argument `reason`"));
    assert!(
        reply_text(&replies[4]).contains("go from reachable from the internet to unknown"),
        "{}",
        replies[4]
    );
    assert!(config(r).unwrap().contains("by: \"agent\""));
    assert_eq!(exposures(r), all("unknown"));
    // The tie, with an argument that claims a person: a proposal all the same.
    let tid = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    let before = everything(r, "svc/app/api/routes.py");
    let replies = mcp(
        r,
        &[(
            "drift_setup_answer",
            serde_json::json!({"id": tid, "answer": "tie-1", "reason": "health check and rules match", "by": "person"}),
        )],
    );
    let said = reply_text(&replies[2]);
    assert!(said.contains("proposed, waiting for a person"), "{said}");
    assert!(
        said.ends_with(
            "1 answer by an agent waits for a person: tell them to run `drift setup --review`."
        ),
        "{said}"
    );
    assert_eq!(everything(r, "svc/app/api/routes.py"), before);
    assert!(!config(r).unwrap().contains("terraform:"));
    assert!(!config(r).unwrap().contains("confirmed_by"));
}

/// The brief an agent follows: the rule, read the evidence, skip when unsure, a reason
/// that names the files, and the proposals to hand to a person. It reads nothing of
/// the repository; the agents' block of AGENTS.md points to it.
#[test]
fn the_agent_brief_says_the_rule_and_what_to_do() {
    let dir = tempfile::tempdir().unwrap();
    let brief = drift(dir.path(), &["setup", "--agent-brief"]);
    assert!(brief.starts_with("# Drift's setup questions, for an agent\n"));
    for said in [
        "An answer that can only make Drift more cautious takes effect at once",
        "changes nothing until a person confirms it",
        "Never pass `--by person`",
        "drift setup --json --evidence",
        "drift_setup_questions",
        "answer `skip`",
        "a reason that names the files you read",
        "`drift setup --review`",
    ] {
        assert!(brief.contains(said), "{said}: {brief}");
    }
    let dir = check_repo();
    let r = dir.path();
    drift(r, &["init"]);
    let md = drift(r, &["export", "agents-md"]);
    assert!(
        md.contains("`drift setup --agent-brief` says how an agent goes through them"),
        "{md}"
    );
}

// ---------- several answers in one run ----------

/// `drift` with `args`: (exit code, stdout, stderr).
fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = command(root, args).stdin(Stdio::null()).output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
    )
}

/// `--answers FILE` applies each answer in order in one run, under the same rule, and
/// ends where the same answers one by one end: the test stack takes effect, the tie it
/// opens is a proposal, and the file says so; a pair that names no question is said on
/// stderr, fails the run, and leaves the others written.
#[test]
fn several_answers_in_one_run_end_as_one_by_one() {
    let batch = deploy_repo();
    let r = batch.path();
    let one = deploy_repo();
    let o = one.path();
    let id = questions(r, false)[0]["id"].as_str().unwrap().to_string();
    // One by one, to learn the tie's id.
    drift(
        o,
        &agent(&format!("{id}=tests-only"), "the e2e workflow starts it"),
    );
    let tid = questions(o, false)[0]["id"].as_str().unwrap().to_string();
    drift(
        o,
        &agent(&format!("{tid}=tie-1"), "health check and rules match"),
    );
    let file = r.join("answers.json");
    std::fs::write(
        &file,
        serde_json::json!([
            {"id": id, "answer": "tests-only", "reason": "the e2e workflow starts it", "evidence": ["e2e/docker-compose.e2e.yml:1"]},
            {"id": tid, "answer": "tie-1", "reason": "health check and rules match", "evidence": ["e2e/docker-compose.e2e.yml:1"]},
            {"id": "S-0000", "answer": "deploys", "reason": "x"},
        ])
        .to_string(),
    )
    .unwrap();
    let (code, out, err) = run(r, &["setup", "--answers", file.to_str().unwrap()]);
    assert_eq!(code, 1, "{out}{err}");
    assert!(
        err.contains("drift: S-0000: not answered: no question S-0000"),
        "{err}"
    );
    let lines: Vec<&str> = out.lines().collect();
    assert!(
        lines[0].starts_with(&format!("{id}: Drift leaves the file out")),
        "{out}"
    );
    assert!(
        lines[1].starts_with(&format!("{tid}: proposed, waiting for a person")),
        "{out}"
    );
    assert_eq!(
        lines[2],
        "1 answer by an agent waits for a person: `drift setup --review`."
    );
    assert_eq!(config(r), config(o));
    // Several pairs on one flag, by a person.
    let dir = check_repo();
    let c = dir.path();
    let cid = questions(c, false)[0]["id"].as_str().unwrap().to_string();
    let (code, out, _) = run(
        c,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{cid}=skip"),
            &format!("{cid}=tenant"),
        ],
    );
    assert_eq!(code, 0, "{out}");
    assert_eq!(authz(c, "read_a").0, "known");
}

// ---------- an agent's word only ever makes Drift more cautious ----------

/// The id of the deployment question about `file`, from the listing of every question.
fn deployment_id(root: &Path, file: &str) -> String {
    questions(root, true)
        .iter()
        .find(|q| {
            q["kind"] == "deployment"
                && q["text"][0]
                    .as_str()
                    .unwrap()
                    .starts_with(&format!("`{file}`"))
        })
        .unwrap_or_else(|| panic!("no question about {file}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// An agent's "only for tests" was cautious when it was given (Terraform Drift does
/// not read kept the routes unknown). The Terraform goes: what is left would now make
/// the routes reachable only from inside on the agent's word alone. Judged again each
/// time the config is read: the routes read unknown, the question is asked again, and
/// the agent's answer to it now is a proposal; a person's confirmation makes it a fact.
#[test]
fn an_agents_cautious_answer_is_judged_again_as_the_code_changes() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    drift(
        r,
        &agent(
            &format!("{id}=tests-only"),
            "the e2e workflow starts it for tests",
        ),
    );
    assert_eq!(exposures(r), all("unknown"));
    std::fs::remove_dir_all(r.join("infra")).unwrap();
    assert_eq!(exposures(r), all("unknown"));
    let v = json(r, &["security", "--json"]);
    let why = v["entry_points"][0]["boundary"].as_str().unwrap();
    assert!(
        why.contains("which an agent answered and no person confirmed"),
        "{why}"
    );
    let q = questions(r, false)
        .into_iter()
        .find(|q| q["id"] == id.as_str())
        .unwrap();
    assert_eq!(q["status"], "changed");
    let tests_only = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["answer"] == "tests-only")
        .unwrap();
    assert_eq!(tests_only["needs_person"], true);
    let said = drift(
        r,
        &agent(
            &format!("{id}=tests-only"),
            "the e2e workflow starts it for tests",
        ),
    );
    assert!(
        said.starts_with(&format!("{id}: proposed, waiting for a person")),
        "{said}"
    );
    assert_eq!(exposures(r), all("unknown"));
    drift(r, &["setup", "--by", "person", "--confirm", &id]);
    assert_eq!(exposures(r), all("internal"));
    assert!(config(r).unwrap().contains("confirmed_by: \"person\""));
}

/// An agent never takes out nor replaces a person's answer: `--forget` of it is
/// refused, and once its evidence changed the agent's other answer waits for a person
/// with the person's still in force. An agent's own answer is taken out by it only
/// where that makes no route reachable only from inside.
#[test]
fn an_agent_never_takes_out_or_replaces_a_persons_answer() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_dir_all(r.join("infra")).unwrap();
    let e2e = deployment_id(r, "e2e/docker-compose.e2e.yml");
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{e2e}=tests-only"),
        ],
    );
    let main = deployment_id(r, "docker-compose.yml");
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{main}=tests-only"),
        ],
    );
    assert_eq!(exposures(r), all("unknown"));
    let cfg = config(r).unwrap();
    let err = drift_fails(r, &["setup", "--forget", &main], "");
    assert!(
        err.contains("an agent does not take a person's answer out"),
        "{err}"
    );
    assert_eq!(config(r).unwrap(), cfg);
    assert_eq!(exposures(r), all("unknown"));
    // The evidence changes: the agent's "it deploys" is a proposal, the person's
    // answer stays in force.
    write(
        r,
        "docker-compose.yml",
        "# local dev stack\nservices:\n  api:\n    build: ./svc\n",
    );
    let said = drift(
        r,
        &agent(&format!("{main}=deploys"), "prod runs the root compose"),
    );
    assert!(
        said.starts_with(&format!("{main}: proposed, waiting for a person")),
        "{said}"
    );
    assert_eq!(exposures(r), all("unknown"));
    assert!(
        config(r)
            .unwrap()
            .contains(&format!("  {main}: {{answer: \"tests-only\""))
    );
    // Its own proposal an agent may take out.
    drift(r, &["setup", "--forget", &main]);
    assert!(!config(r).unwrap().contains("proposed:"));
    // An agent's own answer whose leaving out made routes unknown (the only compose
    // file, which keeps them inside, left out as drift setup writes it): taking it
    // out would make them reachable only from inside, which needs a person.
    let dir = deploy_repo();
    let o = dir.path();
    std::fs::remove_dir_all(o.join("infra")).unwrap();
    std::fs::remove_dir_all(o.join("e2e")).unwrap();
    assert_eq!(exposures(o), all("internal"));
    let comment = format!(
        "# drift setup {main} (2026-11-11), asked whether `docker-compose.yml` is used to deploy: only for tests or local development; answered by an agent because only for local development"
    );
    write(
        o,
        ".drift/config.yaml",
        &format!(
            "security:\n  not_deployed:\n    {comment}\n    - \"docker-compose.yml\"\n\nsetup:\n  {comment}\n  {main}: {{answer: \"tests-only\", seen: \"0\", by: \"agent\", reason: \"only for local development\", evidence: [], on: \"2026-11-11\"}}\n"
        ),
    );
    assert_eq!(exposures(o), all("unknown"));
    let err = drift_fails(o, &["setup", "--forget", &main], "");
    assert!(
        err.contains("would make 4 routes reachable only from inside"),
        "{err}"
    );
    assert_eq!(exposures(o), all("unknown"));
    drift(o, &["setup", "--by", "person", "--forget", &main]);
    assert_eq!(exposures(o), all("internal"));
}

/// `--forget` takes out only the lines drift setup wrote. Where a person took its entry
/// out by hand and wrote their own key below its comment, or put a line of their own
/// under one, nothing is taken out: the file stays as the person left it, and Drift
/// says which line. Before the fix the key below the comment went, and the person's
/// `- svc` moved under `not_deployed`.
#[test]
fn forget_takes_out_only_the_lines_drift_setup_wrote() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    let hand = format!(
        "security:\n  not_deployed:\n    - other/compose.yml\n    # drift setup {id} (2026-11-11), asked whether `e2e/docker-compose.e2e.yml` is used to deploy: only for tests or local development\n  internal:\n    - svc   # our gateway keeps it inside\n\nsetup:\n  # drift setup {id} (2026-11-11), asked whether `e2e/docker-compose.e2e.yml` is used to deploy: only for tests or local development\n  {id}: {{answer: \"tests-only\", seen: \"0\"}}\n"
    );
    write(r, ".drift/config.yaml", &hand);
    let err = drift_fails(r, &["setup", "--by", "person", "--forget", &id], "");
    assert!(err.contains("line 5 is not what Drift wrote for"), "{err}");
    assert_eq!(config(r).unwrap(), hand);
    // A line of the person's in place of Drift's, under its comment: the same.
    let replaced = hand.replace(
        "local development\n  internal:",
        "local development\n    - \"e2e/other.yml\"\n  internal:",
    );
    write(r, ".drift/config.yaml", &replaced);
    let err = drift_fails(r, &["setup", "--by", "person", "--forget", &id], "");
    assert!(err.contains("line 5 is not what Drift wrote for"), "{err}");
    assert_eq!(config(r).unwrap(), replaced);
    // Drift's own lines, as it wrote them, come out.
    let own = hand.replace(
        "local development\n  internal:",
        "local development\n    - \"e2e/docker-compose.e2e.yml\"\n  internal:",
    );
    write(r, ".drift/config.yaml", &own);
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    assert_eq!(
        config(r).unwrap(),
        "security:\n  not_deployed:\n    - other/compose.yml\n  internal:\n    - svc   # our gateway keeps it inside\n"
    );
}

/// A run that asks one question at a time writes each answer into the file as it is
/// then: what was written meanwhile (by hand, by another run) stays.
#[test]
fn an_edit_made_during_an_interactive_run_is_kept() {
    use std::io::Read as _;
    let dir = deploy_repo();
    let r = dir.path();
    let mut child = command(r, &["setup", "--by", "person", "--interactive"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let reader = {
        let seen = seen.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stdout.read(&mut buf) {
                if n == 0 {
                    break;
                }
                seen.lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        })
    };
    let start = std::time::Instant::now();
    while !seen.lock().unwrap().contains("> ") {
        assert!(start.elapsed().as_secs() < 300, "no question asked");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    // A person edits the file while the question waits.
    write(
        r,
        ".drift/config.yaml",
        "# added meanwhile\npackages:\n  exclude: [legacy]\n",
    );
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"2\n").unwrap();
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    reader.join().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let cfg = config(r).unwrap();
    assert!(
        cfg.starts_with(
            "# added meanwhile\npackages:\n  exclude: [legacy]\n\nsecurity:\n  not_deployed:\n"
        ),
        "{cfg}"
    );
}

/// A run that asks one question at a time (and a review) says on stderr, at once, that
/// it is reading the repository: the line is there before the first question, and stdout
/// carries only what it did before.
#[test]
fn an_interactive_run_says_at_once_that_it_reads_the_repository() {
    use std::io::Read as _;
    const LINE: &str =
        "Reading the repository to ask its questions (this can take a minute on a large one)...\n";
    let dir = deploy_repo();
    let r = dir.path();
    let mut child = command(r, &["setup", "--by", "person", "--interactive"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let read_all = |mut from: Box<dyn std::io::Read + Send>| {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let into = seen.clone();
        let reader = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = from.read(&mut buf) {
                if n == 0 {
                    break;
                }
                into.lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&buf[..n]));
            }
        });
        (seen, reader)
    };
    let (out, out_reader) = read_all(Box::new(child.stdout.take().unwrap()));
    let (err, err_reader) = read_all(Box::new(child.stderr.take().unwrap()));
    let start = std::time::Instant::now();
    while !out.lock().unwrap().contains("> ") {
        assert!(start.elapsed().as_secs() < 300, "no question asked");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // The first question is asked: the line came before it.
    assert_eq!(err.lock().unwrap().as_str(), LINE);
    drop(child.stdin.take());
    assert!(child.wait().unwrap().success());
    out_reader.join().unwrap();
    err_reader.join().unwrap();
    let (out, err) = (out.lock().unwrap().clone(), err.lock().unwrap().clone());
    assert!(err.starts_with(LINE), "{err}");
    // Stdout starts with the questions, as it did.
    assert!(
        out.starts_with("Drift found 1 thing only you can answer (about 1 minute). Press Enter to skip any of them.\n"),
        "{out}"
    );
    assert!(!out.contains("Reading the repository"), "{out}");
    // A review says it too; a listing, an answer or JSON does not.
    let review = command(r, &["setup", "--by", "person", "--review"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&review.stderr).starts_with(LINE));
    assert!(!String::from_utf8_lossy(&review.stdout).contains("Reading the repository"));
    for args in [vec!["setup", "--list"], vec!["setup", "--json"]] {
        let quiet = command(r, &args).stdin(Stdio::null()).output().unwrap();
        assert!(quiet.status.success());
        assert!(
            quiet.stderr.is_empty(),
            "{args:?}: {}",
            String::from_utf8_lossy(&quiet.stderr)
        );
    }
}

/// A config with CRLF line endings and no newline at its end keeps both through an
/// answer and its forgetting.
#[test]
fn line_endings_and_a_missing_last_newline_are_kept() {
    let dir = deploy_repo();
    let r = dir.path();
    let hand = "# ours\r\npackages:\r\n  exclude: [legacy]";
    write(r, ".drift/config.yaml", hand);
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    let cfg = config(r).unwrap();
    assert!(
        cfg.starts_with(
            "# ours\r\npackages:\r\n  exclude: [legacy]\r\n\r\nsecurity:\r\n  not_deployed:\r\n"
        ),
        "{cfg:?}"
    );
    assert!(!cfg.ends_with('\n'), "{cfg:?}");
    assert_eq!(
        cfg.matches('\n').count(),
        cfg.matches("\r\n").count(),
        "{cfg:?}"
    );
    drift(r, &["setup", "--by", "person", "--forget", &id]);
    assert_eq!(config(r).unwrap(), hand);
}

/// `--by person` is a person's word only where a person is there: a terminal, or a
/// script a person runs that says so (`DRIFT_SETUP_PERSON=1`). Without either, it is
/// refused, and nothing is written.
#[test]
fn a_persons_word_needs_a_terminal_or_the_variable() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    let bare = |args: &[&str]| {
        Command::new(&*BIN)
            .arg("--no-cache")
            .args(args)
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .env_remove("DRIFT_SETUP_PERSON")
            .stdin(Stdio::null())
            .output()
            .unwrap()
    };
    for args in [
        vec![
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
        vec!["setup", "--by", "person", "--confirm", &id],
        vec!["setup", "--by", "person", "--review"],
        vec!["setup", "--by", "person", "--forget", &id],
        vec!["setup", "--by", "person", "--interactive"],
    ] {
        let out = bare(&args);
        assert!(!out.status.success(), "{args:?}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            err.contains("--by person needs a terminal") && err.contains("DRIFT_SETUP_PERSON=1"),
            "{err}"
        );
    }
    assert_eq!(config(r), None);
    // Listing is no answer: it needs neither.
    assert!(
        bare(&["setup", "--by", "person", "--list"])
            .status
            .success()
    );
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
    );
    assert!(config(r).unwrap().contains("not_deployed"));
}

/// An agent's reason is kept as a person reads it: control characters, format
/// characters (`U+202E`, `U+200B`) and noncharacters (`U+FFFF`) are taken out, and a
/// reason with nothing left is no reason.
#[test]
fn an_agents_reason_is_kept_plain() {
    let dir = deploy_repo();
    let r = dir.path();
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    let err = drift_fails(
        r,
        &agent(&format!("{id}=tests-only"), "\u{1}\u{7}\u{200b}\u{202e}"),
        "",
    );
    assert!(err.contains("an agent's answer needs a reason"), "{err}");
    assert_eq!(config(r), None);
    drift(
        r,
        &agent(
            &format!("{id}=tests-only"),
            "the e2e \u{202e}workflow\u{200b} starts it \u{ffff}for tests",
        ),
    );
    let cfg = config(r).unwrap();
    assert!(
        cfg.contains("reason: \"the e2e workflow starts it for tests\""),
        "{cfg}"
    );
}

/// A deployment question says what the file starts, and its evidence what else starts
/// the same code, from the same config: the one in force without this question's own
/// answer.
#[test]
fn a_deployment_question_and_its_evidence_read_the_same_config() {
    let dir = deploy_repo();
    let r = dir.path();
    std::fs::remove_dir_all(r.join("infra")).unwrap();
    let e2e = deployment_id(r, "e2e/docker-compose.e2e.yml");
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{e2e}=tests-only"),
        ],
    );
    let q = with_evidence(r)
        .into_iter()
        .find(|q| {
            q["text"][0]
                .as_str()
                .unwrap()
                .starts_with("`docker-compose.yml`")
        })
        .unwrap();
    assert_eq!(q["text"][0], "`docker-compose.yml` starts svc.");
    let f = facts(&q);
    assert!(
        f.iter()
            .any(|f| f.starts_with("svc (4 routes): 4 reachable only from inside.")),
        "{f:#?}"
    );
}

/// What cannot be written safely says why, then the line to add by hand on its own.
#[test]
fn an_edit_that_cannot_be_made_says_why_and_then_the_line() {
    let dir = deploy_repo();
    let r = dir.path();
    write(r, ".drift/config.yaml", "security: {internal: [docs]}\n");
    let id = deployment_id(r, "e2e/docker-compose.e2e.yml");
    let err = drift_fails(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tests-only"),
        ],
        "",
    );
    assert!(
        err.contains("cannot be edited safely (`security` is written on one line"),
        "{err}"
    );
    assert!(
        err.ends_with(
            "Add this under `security.not_deployed` yourself:\n  - \"e2e/docker-compose.e2e.yml\"\n"
        ),
        "{err:?}"
    );
}
