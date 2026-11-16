//! One-question calibration of block candidates (round 11, WS-K): `drift review --json`
//! asks "Are these the same kind of thing?" of each block candidate, with the convention,
//! two or three holders and every member it would flag, by file; `--answer ID=same`
//! accepts the card, `ID=different --set-apart PATHS` accepts it with those files exempt
//! by path (code `different_kind`), `ID=not-a-convention` rejects it.
//!
//! [STRICT] Fail closed: an unanswered candidate stays one and reaches no agent; an entry
//! point under an auth or validation rule is set apart only with its own `--confirm-entry`.
//!
//! `review --json` is pinned as golden files (`tests/golden/`; `DRIFT_GOLDEN_UPDATE=1`
//! rewrites them).

use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_REVIEW_VIA")
        // The debug builds' switch that turns the show policy off, as the other CLI tests.
        .env("DRIFT_TEST_UNSHOWN", "1")
        .output()
        .unwrap()
}

fn ok(root: &Path, args: &[&str]) -> String {
    let out = run(root, args);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

fn policy_bytes(root: &Path) -> Vec<u8> {
    std::fs::read(root.join(".drift/conventions.yaml")).unwrap()
}

/// Refused with exit 2 and `why` on stderr, the policy unchanged.
fn refused(root: &Path, args: &[&str], why: &str) {
    let before = policy_bytes(root);
    let out = run(root, args);
    let err = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(2), "{args:?}: {out:?}");
    assert!(err.contains(why), "{args:?}: {err}");
    assert_eq!(policy_bytes(root), before, "{args:?} changed the policy");
}

fn questions(root: &Path) -> Value {
    serde_json::from_str(&ok(root, &["review", "--json"])).unwrap()
}

fn golden(name: &str, got: &str) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name);
    if std::env::var("DRIFT_GOLDEN_UPDATE").is_ok_and(|v| v == "1") {
        std::fs::write(&path, got).unwrap();
    }
    let want = std::fs::read_to_string(&path).unwrap_or_default();
    assert_eq!(
        got,
        want,
        "{} differs (DRIFT_GOLDEN_UPDATE=1 rewrites it)",
        path.display()
    );
}

/// `(violations, members exempt as a different kind)` of `id`, as `drift check` sees them.
fn verdicts(root: &Path, id: &str) -> (Vec<String>, Vec<String>) {
    let out = run(root, &["check", "--format", "json"]);
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let key = |e: &Value| {
        format!(
            "{}#{}",
            e["path"].as_str().unwrap(),
            e["symbol"].as_str().unwrap()
        )
    };
    let flagged = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["id"] == id)
        .map(key)
        .collect();
    let exempt = v["exempt"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| e["id"] == id && e["code"] == "different_kind")
                .map(key)
                .collect()
        })
        .unwrap_or_default();
    (flagged, exempt)
}

fn agents_md(root: &Path) -> String {
    ok(root, &["export", "agents-md"])
}

const GUARDED: &str = "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// 30 route handlers, 28 wrapped in `withAuth()`: one block candidate, an auth wrapper
/// whose two outliers are entry points. Returns the repository and the card's id.
fn auth_repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 10..40 {
        write(
            r,
            &format!("app/api/r{i}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
        write(
            r,
            &format!("lib/h{i}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    ok(r, &["init"]);
    let q = questions(r);
    let id = q["candidates"][0]["id"].as_str().unwrap().to_string();
    (dir, id)
}

/// `packages/core` below `packages/app`: 200 core files, 3 of which import from app (a
/// test fixture, a seed and a legacy file). One block candidate, a layering rule.
fn layering_repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    );
    write(r, "packages/core/package.json", r#"{ "name": "@x/core" }"#);
    write(
        r,
        "packages/app/package.json",
        r#"{ "name": "@x/app", "main": "index.ts" }"#,
    );
    write(r, "packages/app/index.ts", "export const app = 1;\n");
    for i in 0..30 {
        write(
            r,
            &format!("packages/app/src/x{i}.ts"),
            &format!("import {{ c{i} }} from '../../core/src/c{i}';\nexport const x{i} = c{i};\n"),
        );
    }
    for i in 0..200 {
        write(
            r,
            &format!("packages/core/src/c{i}.ts"),
            &format!("export const c{i} = {i};\n"),
        );
    }
    for n in ["fixtures", "seed", "legacy"] {
        write(
            r,
            &format!("packages/core/src/{n}.ts"),
            &format!("import {{ app }} from '@x/app';\nexport const {n} = app;\n"),
        );
    }
    ok(r, &["init"]);
    let q = questions(r);
    let id = q["candidates"][0]["id"].as_str().unwrap().to_string();
    (dir, id)
}

const FIXTURES: &str = "packages/core/src/fixtures.ts";
const SEED: &str = "packages/core/src/seed.ts";
const LEGACY: &str = "packages/core/src/legacy.ts";

#[test]
fn review_json_is_golden() {
    let (dir, id) = auth_repo();
    let r = dir.path();
    let before = policy_bytes(r);
    let out = ok(r, &["review", "--json"]);
    golden("review-questions-auth.json", &out);
    // It changes nothing.
    assert_eq!(policy_bytes(r), before);
    let q: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(q["question"], "Are these the same kind of thing?");
    let c = &q["candidates"][0];
    assert_eq!(c["id"], id.as_str());
    assert_eq!(c["holders"].as_array().unwrap().len(), 3);
    assert_eq!(c["flagged_total"], 2);
    assert_eq!(c["auth_or_validation"], true);
    assert!(
        c["flagged"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["members"][0]["needs_confirmation"] == true),
        "{c}"
    );

    let (dir, _) = layering_repo();
    let out = ok(dir.path(), &["review", "--json"]);
    golden("review-questions-layering.json", &out);
    let q: Value = serde_json::from_str(&out).unwrap();
    let c = &q["candidates"][0];
    assert_eq!(c["rule_kind"], "avoids:import");
    assert_eq!(c["auth_or_validation"], false);
    let paths: Vec<&str> = c["flagged"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, [FIXTURES, LEGACY, SEED]);
}

/// Yes accepts the card (it reaches agents); not a convention rejects it; unanswered, it
/// stays a candidate and reaches no agent [STRICT].
#[test]
fn yes_accepts_not_a_convention_rejects_and_unanswered_stays_a_candidate() {
    let (dir, id) = layering_repo();
    let r = dir.path();
    // Unanswered: asked any number of times, nothing changes and agents see nothing.
    let before = policy_bytes(r);
    questions(r);
    ok(r, &["review", "--list"]);
    assert_eq!(policy_bytes(r), before);
    assert!(!agents_md(r).contains("packages/app"), "{}", agents_md(r));

    let out = ok(r, &["review", &format!("--answer={id}=same")]);
    assert!(
        out.contains(&format!("{id}: the same kind of thing: accepted"))
            // The one still proposed is the manifest proposal of packages/app
            // (`from_map: manifest`), which no answer here is about.
            && out.contains("1 accepted (0 block), 1 proposed, 0 rejected"),
        "{out}"
    );
    assert!(agents_md(r).contains("packages/app"), "{}", agents_md(r));
    // No longer a candidate: no question, and no second answer.
    assert_eq!(questions(r)["candidates"], serde_json::json!([]));
    refused(
        r,
        &["review", &format!("--answer={id}=same")],
        "is not a block candidate",
    );

    let (dir, id) = layering_repo();
    let r = dir.path();
    let out = ok(
        r,
        &["review", "--answer", &format!("{id}=not-a-convention")],
    );
    assert!(
        out.contains(&format!("{id}: not a convention: rejected"))
            && out.contains("0 accepted (0 block), 1 proposed, 1 rejected"),
        "{out}"
    );
    assert!(!agents_md(r).contains("packages/app"));
}

/// "No, these are different": the files picked are written as a path list, the card is
/// accepted with it, and `drift check` exempts exactly their members, deterministically.
#[test]
fn different_sets_files_apart_by_path_and_check_applies_it() {
    let (dir, id) = layering_repo();
    let r = dir.path();
    assert_eq!(
        verdicts(r, &id),
        (vec![], vec![]),
        "a proposal is not checked"
    );
    let out = ok(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            &format!("{FIXTURES},./{SEED}"),
        ],
    );
    assert!(
        out.contains(&format!("{id}: accepted, with 2 file(s) set apart as a different kind (2 flagged member(s) exempt"))
            && !out.contains("still flagged"),
        "{out}"
    );
    let yaml = String::from_utf8(policy_bytes(r)).unwrap();
    assert!(
        yaml.contains(&format!(
            "  different_kind:\n  - path: {FIXTURES}\n  - path: {SEED}\n"
        )),
        "{yaml}"
    );
    let set_apart = |p: &str| format!("{p}#(file)");
    assert_eq!(
        verdicts(r, &id),
        (
            vec![set_apart(LEGACY)],
            vec![set_apart(FIXTURES), set_apart(SEED)]
        )
    );
    // Their lock entries stay (a policy decision, not a fix): `fixed` does not list them.
    let report: Value =
        serde_json::from_slice(&run(r, &["check", "--format", "json"]).stdout).unwrap();
    assert_eq!(report["fixed"], serde_json::json!([]), "{report}");
    // Deterministic: the same verdicts on every run, and for a new import in a file set
    // apart (by path), while the same import elsewhere is flagged.
    write(
        r,
        FIXTURES,
        "import { app } from '@x/app';\nimport { x0 } from '../../app/src/x0';\nexport const fixtures = [app, x0];\n",
    );
    assert_eq!(
        verdicts(r, &id),
        (
            vec![set_apart(LEGACY)],
            vec![set_apart(FIXTURES), set_apart(SEED)]
        )
    );
    let card = ok(r, &["review", "--show", &id]);
    assert!(
        card.contains(&format!(
            "  set apart as a different kind: 2 file(s)\n    {FIXTURES}\n    {SEED}\n"
        )),
        "{card}"
    );
}

/// [STRICT] An entry point under an auth or validation rule is set apart only with a
/// confirmation of its own; without it, it stays flagged and its file is not written.
#[test]
fn an_entry_point_under_an_auth_rule_needs_its_own_confirmation() {
    let (dir, id) = auth_repo();
    let r = dir.path();
    let (r38, r39) = ("app/api/r38/route.ts", "app/api/r39/route.ts");
    let out = ok(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            r38,
        ],
    );
    assert!(
        out.contains(&format!("{id}: accepted, with 0 file(s) set apart as a different kind (0 flagged member(s) exempt"))
            && out.contains(&format!("  still flagged: {r38}#GET (an entry point under an auth or validation rule is set apart only with --confirm-entry PATH#SYMBOL")),
        "{out}"
    );
    // It says how to finish.
    assert!(
        out.contains(&format!(
            "  to finish: answer again with the same --set-apart files and `--confirm-entry {r38}#GET` for each"
        )),
        "{out}"
    );
    let yaml = String::from_utf8(policy_bytes(r)).unwrap();
    assert!(!yaml.contains("different_kind"), "{yaml}");
    assert_eq!(
        verdicts(r, &id),
        (vec![format!("{r38}#GET"), format!("{r39}#GET")], vec![])
    );

    // Confirmed by name: covered, and only that entry point.
    let (dir, id) = auth_repo();
    let r = dir.path();
    // A confirmation of a member that is not set apart, or not an entry point, is refused.
    refused(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            r38,
            "--confirm-entry",
            &format!("{r39}#GET"),
        ],
        "is not an entry point under an auth or validation rule in a file set apart",
    );
    ok(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            &format!("{r38},{r39}"),
            "--confirm-entry",
            &format!("{r38}#GET"),
        ],
    );
    let yaml = String::from_utf8(policy_bytes(r)).unwrap();
    assert!(
        yaml.contains(&format!(
            "  different_kind:\n  - path: {r38}\n    entry_points:\n    - GET\n"
        )) && !yaml.contains(r39),
        "{yaml}"
    );
    assert_eq!(
        verdicts(r, &id),
        (vec![format!("{r39}#GET")], vec![format!("{r38}#GET")])
    );
    // A new, unconfirmed entry point in the file set apart is flagged.
    write(
        r,
        r38,
        "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n\nexport async function POST(req: Request) {\n  return Response.json({ ok: true });\n}\n",
    );
    assert_eq!(
        verdicts(r, &id),
        (
            vec![format!("{r38}#POST"), format!("{r39}#GET")],
            vec![format!("{r38}#GET")]
        )
    );
}

/// Nothing changes on an answer that cannot be applied as given.
#[test]
fn answers_that_do_not_fit_change_nothing() {
    let (dir, id) = layering_repo();
    let r = dir.path();
    refused(
        r,
        &["review", "--answer", &format!("{id}=maybe")],
        "--answer takes ID=same",
    );
    refused(
        r,
        &["review", "--answer", "D-000000=same"],
        "unknown convention D-000000",
    );
    refused(
        r,
        &["review", "--answer", &format!("{id}=different")],
        "\"different\" needs the files",
    );
    refused(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=same"),
            "--set-apart",
            SEED,
        ],
        "--set-apart goes with",
    );
    refused(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            "packages/core/src/c1.ts",
        ],
        "holds no member",
    );
    refused(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            "../outside.ts",
        ],
        "expected a repo-relative file path",
    );
    refused(
        r,
        &["review", "--json", "--answer", &format!("{id}=same")],
        "each go alone",
    );
    assert_eq!(questions(r)["candidates"][0]["id"], id.as_str());
}

/// The review log records the question answered and which flags the person set apart
/// (hashed on export, as members are), and the entry points kept flagged.
#[test]
fn the_review_log_records_which_flags_were_set_apart() {
    let (dir, id) = layering_repo();
    let r = dir.path();
    ok(r, &["review", "--set-log", "on"]);
    ok(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            SEED,
        ],
    );
    let out = r.join("log.json");
    ok(r, &["review", "--export-log", out.to_str().unwrap()]);
    let x: Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
    let e = x["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e.get("question").is_some())
        .expect("an answered question")
        .clone();
    assert_eq!(e["decision"], "accept");
    assert_eq!(e["tier"], "default");
    assert_eq!(e["before"]["status"], "proposed");
    assert_eq!(e["after"]["status"], "accepted");
    assert_eq!(
        e["question"],
        serde_json::json!({
            "v": 1, "answer": "different", "auth_or_validation": false, "holders_shown": 3,
            "flagged": 3, "flagged_files": 3, "set_apart": 1, "set_apart_files": 1,
            "entry_confirmed": 0, "kept_flagged": 0, "needs_confirmation": 0,
        })
    );
    let m = e["set_apart_members"][0].as_str().unwrap();
    assert!(m.starts_with("h:") && m.len() == 18, "{m}");
    assert!(!x.to_string().contains("seed.ts"), "{x}");
    let out2 = r.join("log2.json");
    ok(
        r,
        &[
            "review",
            "--export-log",
            out2.to_str().unwrap(),
            "--include-paths",
        ],
    );
    let raw = std::fs::read_to_string(&out2).unwrap();
    assert!(raw.contains(&format!("{SEED}#(file)")), "{raw}");

    // The auth card: the entry point kept flagged is recorded too.
    let (dir, id) = auth_repo();
    let r = dir.path();
    ok(r, &["review", "--set-log", "on"]);
    ok(
        r,
        &[
            "review",
            "--answer",
            &format!("{id}=different"),
            "--set-apart",
            "app/api/r38/route.ts",
        ],
    );
    let log = std::fs::read_to_string(r.join(".drift/review-log/log.jsonl")).unwrap();
    let e: Value = serde_json::from_str(log.lines().last().unwrap()).unwrap();
    assert_eq!(e["question"]["kept_flagged"], 1);
    assert_eq!(e["question"]["needs_confirmation"], 2);
    assert_eq!(
        e["kept_flagged_members"],
        serde_json::json!(["app/api/r38/route.ts#GET"])
    );
    assert!(e.get("set_apart_members").is_none(), "{e}");
}
