//! A practice a person promoted to a convention (`drift practices promote`) is checked
//! wherever code is checked: `drift check` reports a new unit of its place that breaks
//! it as a violation of that convention (advice in advise mode), baselines the
//! exceptions recorded at promotion, honours `drift-ignore`, lists a recorded exception
//! that was fixed, never goes stale because a change broke its units (those block), and
//! keeps all of it across a `drift init`
//! re-run. End to end on the TypeScript repository of the promote brief: 40 route files
//! in `app/api`, 38 wrapped in `withAuth`, 2 not.

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

/// `drift ARGS` in `root`: its exit code, standard output and standard error.
fn run(root: &Path, args: &[&str]) -> (Option<i32>, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// `drift ARGS` in `root`, which must succeed: its standard output.
fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, Some(0), "{args:?} failed:\n{out}\n{err}");
    out
}

const AUTH: &str = r#"type Handler = (req: Request) => Promise<Response>;

export function withAuth(h: Handler): Handler {
  return async (req) => {
    if (!req.headers.get("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return h(req);
  };
}
"#;

/// The same guard under another name, in another file.
const GUARD: &str = r#"type Handler = (req: Request) => Promise<Response>;

export function requireAuth(h: Handler): Handler {
  return async (req) => {
    if (!req.headers.get("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return h(req);
  };
}
"#;

const WRAPPED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const REWRAPPED: &str = "import { requireAuth } from \"@/lib/guard\";\n\nexport const GET = requireAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";

const OPEN: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn route(n: usize) -> String {
    format!("app/api/r{n:02}/route.ts")
}

/// The brief's repository: 38 routes wrapped in `withAuth`, `r38` and `r39` not, and 30
/// helpers.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for n in 0..40 {
        write(r, &route(n), if n < 38 { WRAPPED } else { OPEN });
    }
    for n in 0..30 {
        write(
            r,
            &format!("lib/h{n:02}.ts"),
            &format!("export function h{n:02}() {{ return {n}; }}\n"),
        );
    }
    dir
}

/// The id of the authn variant labelled `wrap withAuth` (`drift practices --json`).
fn with_auth_variant(root: &Path) -> String {
    let v: Value = serde_json::from_str(&drift(root, &["practices", "--json"])).unwrap();
    v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["id"] == "authn")
        .flat_map(|c| c["variants"].as_array().unwrap())
        .find(|x| x["label"] == "wrap withAuth")
        .and_then(|x| x["id"].as_str())
        .unwrap_or_else(|| panic!("no `wrap withAuth` variant: {v:#}"))
        .to_string()
}

/// [`repo`] after `drift init` and `drift practices promote <P-id> --in app/api`: the
/// directory and the promoted convention's id.
fn promoted() -> (tempfile::TempDir, String) {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let variant = with_auth_variant(r);
    let out = drift(
        r,
        &[
            "practices",
            "promote",
            &variant,
            "--in",
            "app/api",
            "--json",
        ],
    );
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    assert_eq!(v["written"], true, "{v:#}");
    assert_eq!(v["baselined"], 2, "{v:#}");
    let id = v["convention"]["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("D-"), "{id}");
    (dir, id)
}

/// The lock's entries of convention `id`, as written (`<id> <path>#<symbol>` lines).
fn lock_entries(root: &Path, id: &str) -> Vec<String> {
    std::fs::read_to_string(root.join("drift.lock"))
        .unwrap()
        .lines()
        .filter(|l| l.starts_with(&format!("{id} ")))
        .map(str::to_string)
        .collect()
}

fn check_json(root: &Path) -> Value {
    let out = drift(root, &["check", "--format", "json"]);
    serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"))
}

/// The violations of convention `id` in a `drift check --format json` report.
fn of<'a>(report: &'a Value, id: &str) -> Vec<&'a Value> {
    report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["id"] == id)
        .collect()
}

#[test]
fn the_promoted_repository_checks_clean() {
    let (dir, id) = promoted();
    let r = dir.path();
    let (code, out, err) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}\n{err}");
    assert!(out.contains("drift: no new violations"), "{out}");
    // The two exceptions are recorded, as they were.
    let report = check_json(r);
    let mine = of(&report, &id);
    assert_eq!(mine.len(), 2, "{report:#}");
    assert!(mine.iter().all(|v| v["baselined"] == true), "{report:#}");
    let paths: Vec<&str> = mine.iter().map(|v| v["path"].as_str().unwrap()).collect();
    assert_eq!(paths, [route(38), route(39)], "{report:#}");
    assert_eq!(lock_entries(r, &id).len(), 2);
}

#[test]
fn a_new_route_without_the_guard_is_one_new_violation() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, &route(40), OPEN);
    let (code, out, err) = run(r, &["check"]);
    assert_eq!(
        code,
        Some(0),
        "advise mode never fails a check:\n{out}\n{err}"
    );
    assert!(out.contains("drift: 1 new violation(s)"), "{out}");
    assert!(out.contains(&format!("[{id}]")), "{out}");
    assert!(out.contains(&format!("{}:", route(40))), "{out}");
    // Said once, as a violation of the rule: not again as a practice departure.
    assert!(!out.contains(&format!("{}: authn", route(40))), "{out}");

    let report = check_json(r);
    let new: Vec<&Value> = of(&report, &id)
        .into_iter()
        .filter(|v| v["baselined"] == false && v["suppressed"] == false)
        .collect();
    assert_eq!(new.len(), 1, "{report:#}");
    assert_eq!(new[0]["path"], route(40));
    assert_eq!(new[0]["symbol"], "GET");
    assert_eq!(new[0]["mode"], "advise");
    // The convention is in the report's list, as the promoted practice it is.
    assert!(
        report["conventions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == id.as_str() && c["rule_kind"].as_str().is_some()),
        "{report:#}"
    );
}

#[test]
fn a_new_route_with_the_guard_is_clean() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, &route(40), WRAPPED);
    let (code, out, _) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
    assert!(out.contains("drift: no new violations"), "{out}");
    assert!(!out.contains(&route(40)), "{out}");
    let report = check_json(r);
    assert!(
        of(&report, &id)
            .iter()
            .all(|v| v["path"] != route(40).as_str()),
        "{report:#}"
    );
}

#[test]
fn drift_ignore_with_a_reason_suppresses_it() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(
        r,
        &route(40),
        &format!(
            "// drift-ignore {id}: a public health check\nexport async function GET(req: Request) {{\n  return Response.json({{ ok: true }});\n}}\n"
        ),
    );
    let (code, out, _) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
    assert!(out.contains("drift: no new violations"), "{out}");
    assert!(out.contains("1 suppressed by drift-ignore"), "{out}");
    let report = check_json(r);
    let at: Vec<&Value> = of(&report, &id)
        .into_iter()
        .filter(|v| v["path"] == route(40).as_str())
        .collect();
    assert_eq!(at.len(), 1, "{report:#}");
    assert_eq!(at[0]["suppressed"], true, "{report:#}");
}

/// Every route rewrapped in another guard: before, the practice went stale (no unit did
/// it an accepted way) and fired on nothing, so a change that rewraps every route (an
/// agent's, or a rename) passed the check unread. Units that break a practice anew (not
/// in `drift.lock`) are the gate's to stop, never a reason to stop gating: they count as
/// following it for staleness and for the share it blocks at, so the 38 rewrapped routes
/// are new violations, in the practice's own mode (advise here, as promoted: in block
/// mode they would fail the check), until a person promotes the new way or rejects the
/// practice. Review fix v1, item 1.
#[test]
fn a_renamed_guard_is_not_a_reason_to_stop_gating() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, "lib/guard.ts", GUARD);
    for n in 0..38 {
        write(r, &route(n), REWRAPPED);
    }
    let (code, out, err) = run(r, &["check"]);
    assert_eq!(
        code,
        Some(0),
        "advise mode never fails a check:\n{out}\n{err}"
    );
    assert!(out.contains("drift: 38 new violation(s)"), "{out}");
    assert!(
        !out.lines()
            .any(|l| l.contains(&format!("[{id}]")) && l.contains("stale")),
        "{out}"
    );
    let report = check_json(r);
    assert!(
        report["stale_practices"]
            .as_array()
            .is_none_or(|s| s.iter().all(|s| s["id"] != id.as_str())),
        "{report:#}"
    );
    let new: Vec<&Value> = of(&report, &id)
        .into_iter()
        .filter(|v| v["baselined"] == false)
        .collect();
    assert_eq!(new.len(), 38, "{report:#}");
    assert!(new.iter().all(|v| v["mode"] == "advise"), "{report:#}");
    // The two recorded exceptions stay legacy, and are not "fixed".
    assert_eq!(
        of(&report, &id)
            .iter()
            .filter(|v| v["baselined"] == true)
            .count(),
        2,
        "{report:#}"
    );
    assert!(
        report["fixed"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| !f.as_str().unwrap().starts_with(&id)),
        "{report:#}"
    );
}

/// [STRICT] A unit the practice map cannot tell is never reported: it is counted as
/// not checked. The route is wrapped by a function of a package outside the repository,
/// whose body Drift cannot read: the map says `unknown` (an opaque wrapper), not `none`
/// and not a known way.
#[test]
fn a_route_drift_cannot_read_is_not_checked() {
    const UNREADABLE: &str = "import { secured } from \"acme-gateway\";\n\nexport const GET = secured(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, &route(40), UNREADABLE);
    let (code, out, _) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
    assert!(out.contains("drift: no new violations"), "{out}");
    let line = out
        .lines()
        .find(|l| l.contains(&format!("[{id}]")) && l.contains("not checked"))
        .unwrap_or_else(|| panic!("no not-checked line for {id}:\n{out}"));
    assert!(line.contains("1 in app/api not checked"), "{line}");
    assert!(line.contains("drift practices --hints"), "{line}");
    let report = check_json(r);
    assert!(
        report["practices_not_checked"]
            .as_array()
            .is_some_and(|n| n.iter().any(|n| n["id"] == id.as_str() && n["units"] == 1)),
        "{report:#}"
    );
}

#[test]
fn a_recorded_exception_that_is_fixed_is_listed_as_fixed() {
    let (dir, id) = promoted();
    let r = dir.path();
    write(r, &route(38), WRAPPED);
    let (code, out, _) = run(r, &["check"]);
    assert_eq!(code, Some(0), "{out}");
    assert!(out.contains("lock entries are fixed"), "{out}");
    let report = check_json(r);
    let entry = format!("{id} {}#GET", route(38));
    assert!(
        report["fixed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f.as_str() == Some(entry.as_str())),
        "{entry} not in fixed: {report:#}"
    );
    // The other exception still stands, recorded.
    let left: Vec<&Value> = of(&report, &id);
    assert_eq!(left.len(), 1, "{report:#}");
    assert_eq!(left[0]["path"], route(39));
}

#[test]
fn init_again_keeps_the_promoted_practice_and_its_lock_entries() {
    let (dir, id) = promoted();
    let r = dir.path();
    let before = lock_entries(r, &id);
    assert_eq!(before.len(), 2);
    drift(r, &["init"]);
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(policy.contains(&id), "{policy}");
    assert!(policy.contains("promoted_from_practice"), "{policy}");
    assert_eq!(lock_entries(r, &id), before);
    // And it still checks as before.
    write(r, &route(40), OPEN);
    let out = drift(r, &["check"]);
    assert!(out.contains("drift: 1 new violation(s)"), "{out}");
    assert!(out.contains(&format!("[{id}]")), "{out}");
}
