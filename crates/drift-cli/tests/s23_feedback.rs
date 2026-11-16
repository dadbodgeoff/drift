//! `drift feedback` (S23): a person marks reports true or wrong, and `drift feedback
//! export` writes one JSON document of counts, rule kinds and verdicts that names none of
//! the code. These tests pin, on a repository built with distinctive names:
//! - the export holds the decisions (one accepted, one declined), the rule kinds, the
//!   counts at acceptance and now, the marks with their verdicts, the exceptions without
//!   their reasons, and the review log's counts;
//! - it holds none of the repository's paths, symbols, package name, directory name, raw
//!   convention ids or reasons (a mark's reason only with `--include-reasons`);
//! - `--dry-run` prints the document and writes nothing;
//! - two exports of the same state are byte-identical;
//! - marking a report wrong changes no verdict of `drift check`.
//!
//! Before this stream there was no `drift feedback` command: every test fails.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// The repository's directory name: it must never reach the document.
const REPO_DIR: &str = "narwhal-zanzibar-7731";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_REVIEW_VIA")
        .output()
        .unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(root, args);
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

const GUARDED: &str = "import { withQuokkaAuth } from \"@/lib/quokka_auth\";\n\nexport const GET = withQuokkaAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

struct Repo {
    _dir: tempfile::TempDir,
    root: PathBuf,
    auth: String,
    email: String,
}

/// 40 routes under `app/api/okapi*`, 37 wrapped in `withQuokkaAuth` (accepted), and 30
/// emails, 29 rendered in `<PangolinFrame>` (declined); an exception with a reason; one
/// new unguarded route marked wrong, and one legacy route marked true. The review log is
/// on for the decisions.
fn repo() -> Repo {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join(REPO_DIR);
    let r = root.as_path();
    write(
        r,
        "package.json",
        "{ \"name\": \"marmoset-ledger-product\" }",
    );
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/quokka_auth.ts",
        "export function withQuokkaAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        let body = if i < 37 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/okapi{i:02}/route.ts"), body);
    }
    write(
        r,
        "src/ui/pangolin_frame.tsx",
        "export function PangolinFrame(p: any) {\n  return <div>{p.children}</div>;\n}\n",
    );
    for i in 0..30 {
        let email = if i < 29 {
            format!(
                "import {{ PangolinFrame }} from \"../ui/pangolin_frame\";\n\nexport function TapirMail{i}() {{\n  return <PangolinFrame><p>hi</p></PangolinFrame>;\n}}\n"
            )
        } else {
            format!("export function TapirMail{i}() {{\n  return <p>hi</p>;\n}}\n")
        };
        write(r, &format!("src/tapir_mail/m{i:02}.tsx"), &email);
    }
    for i in 0..30 {
        let body = format!("export function wombatHelper{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/wombat{i:02}.ts"), &body);
    }
    for i in 0..20 {
        write(
            r,
            &format!("src/ui/c{i:02}.tsx"),
            &format!("export function ArmadilloCard{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
    }
    drift(r, &["init"]);
    let census: Value = serde_json::from_str(&drift(r, &["census", "--json"])).unwrap();
    let find = |what: &str| {
        census["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["summary"].as_str().unwrap().contains(what))
            .unwrap_or_else(|| panic!("{what} convention in {census}"))["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let auth = find("withQuokkaAuth");
    let email = find("PangolinFrame");
    drift(r, &["review", "--set-log", "on"]);
    drift(r, &["review", "--list"]);
    drift(r, &["review", "--accept", &auth]);
    drift(r, &["review", "--reject", &email]);
    drift(
        r,
        &[
            "review",
            "--exempt",
            &auth,
            "--member",
            "app/api/okapi38/route.ts#GET",
            "--reason",
            "quokka health check, public by design",
        ],
    );
    // The next `drift init` keeps the counts the person accepted the convention on
    // (`accepted_evidence`); it runs before the new route, so the route is new code.
    drift(r, &["init"]);
    write(r, "app/api/okapinew/route.ts", UNGUARDED);
    drift(
        r,
        &[
            "feedback",
            "mark",
            &auth,
            "app/api/okapinew/route.ts#GET",
            "--wrong",
            "--why",
            "okapi secret reason, wombat said so",
        ],
    );
    // A line of drift.lock, quoted: the legacy outlier, marked true.
    drift(
        r,
        &[
            "feedback",
            "mark",
            &format!("{auth} app/api/okapi37/route.ts#GET"),
            "--true",
        ],
    );
    Repo {
        _dir: dir,
        root,
        auth,
        email,
    }
}

/// The JSON document a dry run prints after its summary.
fn dry_run_document(stdout: &str) -> &str {
    let at = stdout
        .find("\n{\n")
        .unwrap_or_else(|| panic!("no document in {stdout}"));
    &stdout[at + 1..]
}

/// Every file under `root` with its bytes.
fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.insert(p.clone(), std::fs::read(&p).unwrap_or_default());
            }
        }
    }
    out
}

/// Nothing in `doc` names the code: no path, symbol, package name, directory name, raw
/// convention id or reason of the fixture.
fn assert_names_nothing(doc: &str, repo: &Repo) {
    for raw in [
        REPO_DIR,
        "narwhal",
        "zanzibar",
        "okapi",
        "Okapi",
        "quokka",
        "Quokka",
        "pangolin",
        "Pangolin",
        "tapir",
        "Tapir",
        "wombat",
        "Wombat",
        "Armadillo",
        "marmoset",
        "route.ts",
        ".ts",
        "app/",
        "lib/",
        "src/",
        "#GET",
        "public by design",
        repo.auth.as_str(),
        repo.email.as_str(),
    ] {
        assert!(!doc.contains(raw), "{raw:?} is in the document:\n{doc}");
    }
}

fn convention<'a>(doc: &'a Value, kind: &str) -> &'a Value {
    doc["conventions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["rule_kind"] == kind)
        .unwrap_or_else(|| panic!("no {kind} convention in {doc}"))
}

#[test]
fn export_holds_counts_and_kinds_and_names_nothing() {
    let repo = repo();
    let r = repo.root.as_path();
    let outside = tempfile::tempdir().unwrap();
    let out = outside.path().join("feedback.json");
    let printed = drift(r, &["feedback", "export", "--out", out.to_str().unwrap()]);
    // The summary says what it holds and leaves out, and where it goes, before writing.
    assert!(
        printed.contains("the file holds this, and nothing else"),
        "{printed}"
    );
    assert!(
        printed.contains("It leaves out: every path, symbol"),
        "{printed}"
    );
    assert!(printed.contains(".drift/feedback/key"), "{printed}");
    assert!(printed.contains("nothing is sent"), "{printed}");
    assert!(printed.contains(out.to_str().unwrap()), "{printed}");
    let text = std::fs::read_to_string(&out).unwrap();
    assert_names_nothing(&text, &repo);
    let doc: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(doc["schema"], "drift-feedback", "{doc}");
    assert_eq!(doc["include_reasons"], false);
    assert!(
        doc["files_by_language"]["ts"].as_u64().unwrap() >= 40,
        "{doc}"
    );
    assert!(
        doc["files_by_language"]["tsx"].as_u64().unwrap() >= 30,
        "{doc}"
    );

    let auth = convention(&doc, "wrapped_by:call");
    assert_eq!(auth["decision"], "accepted", "{auth}");
    assert_eq!(auth["proposed_by"], "mined", "{auth}");
    assert_eq!(auth["tier"], "default", "{auth}");
    assert_eq!(auth["mode"], "advise", "{auth}");
    assert_eq!(auth["at_acceptance"]["holders"], 37, "{auth}");
    assert_eq!(auth["exceptions"], 1, "{auth}");
    assert!(auth["now"].is_object(), "{auth}");
    assert!(auth["now"]["not_checked"].is_u64(), "{auth}");
    // The new route is a report on new code.
    assert!(auth["now"]["new_reports"].as_u64().unwrap() >= 1, "{auth}");
    let id = auth["id"].as_str().unwrap();
    assert!(id.starts_with("h:"), "{auth}");

    let email = convention(&doc, "wrapped_by:jsx");
    assert_eq!(email["decision"], "declined", "{email}");
    assert_eq!(email["tier"], "suggestion", "{email}");
    assert!(email["now"].is_null(), "{email}");

    let marks = doc["marks"].as_array().unwrap();
    assert_eq!(marks.len(), 2, "{doc}");
    for m in marks {
        assert_eq!(m["convention"], id, "marks join the convention's hash: {m}");
        assert_eq!(m["kind"], "wrapped_by:call", "{m}");
        assert!(m["reason"].is_null(), "{m}");
    }
    let wrong = marks.iter().find(|m| m["verdict"] == "wrong").unwrap();
    assert_eq!(wrong["new_code"], true, "{wrong}");
    assert_eq!(wrong["reason_given"], true, "{wrong}");
    let right = marks.iter().find(|m| m["verdict"] == "true").unwrap();
    assert_eq!(
        right["new_code"], false,
        "the legacy outlier is in drift.lock: {right}"
    );
    let by_kind = &doc["marks_by_kind"]["wrapped_by:call"];
    assert_eq!(by_kind["true"], 1, "{doc}");
    assert_eq!(by_kind["wrong"], 1, "{doc}");
    assert_eq!(by_kind["wrong_on_new_code"], 1, "{doc}");

    let exceptions = doc["exceptions"].as_array().unwrap();
    assert!(
        exceptions
            .iter()
            .any(|e| e["convention"] == id && e["source"] == "review" && e["reason_given"] == true),
        "{doc}"
    );

    let log = &doc["review_log"];
    assert_eq!(log["found"], true, "{log}");
    assert!(log["total"]["shown"].as_u64().unwrap() >= 1, "{log}");
    assert_eq!(log["by_kind"]["wrapped_by:call"]["accepted"], 1, "{log}");
    assert_eq!(log["by_kind"]["wrapped_by:jsx"]["declined"], 1, "{log}");
    assert!(
        log["by_channel"]["mined"]["accepted"].as_u64().unwrap() >= 1,
        "{log}"
    );

    // The key stays on this machine, and is not in the document.
    let key = std::fs::read_to_string(r.join(".drift/feedback/key")).unwrap();
    assert!(!text.contains(key.trim()), "the key is in the document");
}

#[test]
fn reasons_only_when_asked() {
    let repo = repo();
    let r = repo.root.as_path();
    let plain = drift(r, &["feedback", "export", "--dry-run"]);
    assert!(
        !dry_run_document(&plain).contains("okapi secret reason"),
        "{plain}"
    );
    let with = drift(r, &["feedback", "export", "--dry-run", "--include-reasons"]);
    let doc = dry_run_document(&with);
    assert!(doc.contains("okapi secret reason, wombat said so"), "{doc}");
    assert!(with.contains("free text can hold anything"), "{with}");
    // An exception's reason never.
    assert!(!doc.contains("public by design"), "{doc}");
}

#[test]
fn dry_run_writes_nothing_and_is_deterministic() {
    let repo = repo();
    let r = repo.root.as_path();
    let before = tree(r);
    let a = drift(r, &["feedback", "export", "--dry-run"]);
    let b = drift(r, &["feedback", "export", "--dry-run"]);
    assert_eq!(tree(r), before, "a dry run wrote or changed a file");
    assert!(a.contains("nothing was written"), "{a}");
    assert!(!r.join(".drift/feedback/drift-feedback.json").exists());
    assert_eq!(a, b, "two dry runs differ");
    assert_names_nothing(dry_run_document(&a), &repo);

    // The written document is the one the dry run printed, and is the same twice.
    drift(r, &["feedback", "export"]);
    let first = std::fs::read(r.join(".drift/feedback/drift-feedback.json")).unwrap();
    drift(r, &["feedback", "export"]);
    let second = std::fs::read(r.join(".drift/feedback/drift-feedback.json")).unwrap();
    assert_eq!(first, second, "two exports differ");
    assert_eq!(String::from_utf8(first).unwrap(), dry_run_document(&a));
    // The feedback directory ignores itself, as the review log's does.
    let ignore = std::fs::read_to_string(r.join(".drift/feedback/.gitignore")).unwrap();
    assert!(ignore.contains("\n*\n"), "{ignore}");
}

#[test]
fn a_mark_changes_no_verdict() {
    let repo = repo();
    let r = repo.root.as_path();
    let marks = std::fs::read_to_string(r.join(".drift/feedback/marks.json")).unwrap();
    assert!(marks.contains("app/api/okapinew/route.ts#GET"), "{marks}");
    // Drift still reports the route marked wrong.
    let out = run(r, &["check", "--format", "json"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("app/api/okapinew/route.ts"), "{text}");
    // Marking it again replaces the verdict; the mark prints the way to an exception.
    let again = drift(
        r,
        &[
            "feedback",
            "mark",
            &repo.auth,
            "app/api/okapinew/route.ts#GET",
            "--wrong",
        ],
    );
    assert!(again.contains("Replaced the mark"), "{again}");
    assert!(again.contains("This changes no verdict"), "{again}");
    assert!(
        again.contains(&format!(
            // The member is one quoted shell word (`#` is never left bare).
            "drift review --exempt {} --member 'app/api/okapinew/route.ts#GET'",
            repo.auth
        )),
        "{again}"
    );
    let marks: Value = serde_json::from_str(
        &std::fs::read_to_string(r.join(".drift/feedback/marks.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(marks["marks"].as_array().unwrap().len(), 2, "{marks}");
    // Neither --true nor --wrong, or an unknown convention: refused, nothing recorded.
    let out = run(
        r,
        &["feedback", "mark", &repo.auth, "app/api/okapi00/route.ts#GET"],
    );
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    let out = run(r, &["feedback", "mark", "D-000000", "app/a.ts#x", "--true"]);
    assert_eq!(out.status.code(), Some(2), "{out:?}");
    let after: Value = serde_json::from_str(
        &std::fs::read_to_string(r.join(".drift/feedback/marks.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(after, marks);
}
