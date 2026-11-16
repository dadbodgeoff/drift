//! Probation (audit gap 5): a promoted practice in a repository whose history cannot be
//! replayed (here a shallow clone made with `git clone --depth 1`) earns block mode on
//! the units added to its place after it was accepted, with `experimental: [probation]`
//! in `.drift/config.yaml`. Without the setting, `--block` is refused as before, with one
//! line more that names the setting (and, in a shallow clone, how to read the history).
//!
//! The sample is the one of `practice_promote.rs`: 40 routes under `app/api`, 38 wrapped
//! in `withAuth`.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{ConventionsFile, Mode};
use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
const PROBATION_FILE: &str = ".drift/probation.lock";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

fn json(root: &Path, args: &[&str]) -> (i32, Value) {
    let (code, out, err) = run(root, args);
    let v = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{args:?}: {e}\n{out}\n{err}"));
    (code, v)
}

fn git(root: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
            "-c",
            "protocol.file.allow=always",
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env("GIT_AUTHOR_DATE", "2024-01-01T00:00:00Z")
        .env("GIT_COMMITTER_DATE", "2024-01-01T00:00:00Z")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn commit(r: &Path, msg: &str) {
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", msg]);
}

fn route(r: &Path, i: usize, guarded: bool) {
    write(
        r,
        &format!("app/api/r{i:02}/route.ts"),
        if guarded { GUARDED } else { UNGUARDED },
    );
}

/// The sample, committed in two commits with `drift init` and, when `probation`, the
/// setting; then cloned with `--depth 1`. Returns (source, clone): the clone is shallow,
/// so no replay can run in it.
fn shallow(probation: bool) -> (tempfile::TempDir, tempfile::TempDir) {
    let src = tempfile::tempdir().unwrap();
    let s = src.path();
    write(s, "package.json", "{ \"name\": \"demo\" }");
    write(
        s,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(s, "lib/auth.ts", AUTH);
    for i in 0..20 {
        route(s, i, true);
    }
    git(s, &["init", "-q"]);
    commit(s, "first");
    for i in 20..40 {
        route(s, i, i < 38);
    }
    drift(s, &["init", "--no-from-map"]);
    if probation {
        write(s, ".drift/config.yaml", "experimental: [probation]\n");
    }
    commit(s, "second");
    let dst = tempfile::tempdir().unwrap();
    let url = format!("file://{}", s.display());
    git(dst.path(), &["clone", "-q", "--depth", "1", &url, "."]);
    (src, dst)
}

fn with_auth(r: &Path) -> String {
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap()
        .clone();
    authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["label"] == "wrap withAuth")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn practice(r: &Path) -> drift_mine::policy::Convention {
    ConventionsFile::load(r)
        .unwrap()
        .unwrap()
        .conventions
        .into_iter()
        .find(|c| c.rule.is_practice())
        .expect("a promoted practice")
}

/// `drift check --format json`'s `probation`, the one practice on it.
fn probation_of(r: &Path, args: &[&str]) -> Value {
    let mut all = vec!["check", "--format", "json"];
    all.extend_from_slice(args);
    let (code, v) = json(r, &all);
    assert_eq!(code, 0, "{v}");
    let list = v["probation"].as_array().unwrap_or_else(|| panic!("{v}"));
    assert_eq!(list.len(), 1, "{v}");
    list[0].clone()
}

/// The clone with the practice promoted on probation and committed.
fn on_probation() -> (tempfile::TempDir, tempfile::TempDir, String) {
    let (src, dst) = shallow(true);
    let r = dst.path();
    let id = with_auth(r);
    drift(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--block"],
    );
    commit(r, "promote on probation");
    let did = practice(r).id;
    (src, dst, did)
}

/// Pins: with probation off (the default), `--block` in a shallow clone is refused as
/// before, names the shallow clone, how to read the history (`fetch-depth: 0` in CI),
/// and the setting; nothing is written.
#[test]
fn off_a_shallow_clone_is_refused_and_told_how_to_deepen_and_of_the_setting() {
    let (_src, dst) = shallow(false);
    let r = dst.path();
    let id = with_auth(r);
    let before = read(r, ".drift/conventions.yaml");
    let (code, out, err) = run(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--block"],
    );
    assert_eq!(code, 2, "{out}{err}");
    assert!(err.contains("this is a shallow clone"), "{err}");
    assert!(err.contains("needs no history"), "{err}");
    assert!(err.contains("`git fetch --unshallow`"), "{err}");
    assert!(err.contains("fetch-depth: 0"), "{err}");
    assert!(err.contains("`experimental: [probation]`"), "{err}");
    assert_eq!(read(r, ".drift/conventions.yaml"), before);
    assert!(!r.join(PROBATION_FILE).exists());
    let (code, v) = json(
        r,
        &[
            "practices",
            "promote",
            &id,
            "--in",
            "app/api",
            "--block",
            "--json",
        ],
    );
    assert_eq!(code, 2, "{v}");
    assert_eq!(v["refused"]["code"], "block_refused", "{v}");
    assert!(v["hint"].as_str().unwrap().contains("probation"), "{v}");
    // `drift check` says nothing of probation.
    let (_, v) = json(r, &["check", "--format", "json"]);
    assert!(v.get("probation").is_none(), "{v}");
}

/// Pins: with probation on, `--block` in a shallow clone accepts the practice in advise
/// mode on probation, records the units there now, and says what makes it eligible; units
/// added over several commits are counted by `drift check`, and once 15 follow it the
/// check and `--list` say it may block and print the command, which a person runs.
#[test]
fn on_it_is_accepted_on_probation_counted_and_blocks_when_a_person_says_so() {
    let (_src, dst) = shallow(true);
    let r = dst.path();
    let id = with_auth(r);
    let (code, v) = json(
        r,
        &[
            "practices",
            "promote",
            &id,
            "--in",
            "app/api",
            "--block",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["convention"]["mode"], "advise", "{v}");
    assert_eq!(v["probation"]["on_probation"], true, "{v}");
    assert_eq!(v["probation"]["written"], true, "{v}");
    assert_eq!(v["probation"]["count"]["state"], "waiting", "{v}");
    let did = practice(r).id;
    let record = read(r, PROBATION_FILE);
    assert_eq!(
        record
            .lines()
            .filter(|l| l.starts_with(&format!("{did} app/api/")))
            .count(),
        40,
        "{record}"
    );
    assert_eq!(practice(r).mode, Mode::Advise);
    // Promoting again with --block keeps the record: the count goes on.
    let out = drift(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--block"],
    );
    assert!(out.contains("On probation instead"), "{out}");
    assert_eq!(read(r, PROBATION_FILE), record);
    commit(r, "promote on probation");

    // Fifteen new routes that follow it, five per commit.
    for (k, batch) in [40..45, 45..50, 50..55].into_iter().enumerate() {
        for i in batch {
            route(r, i, true);
        }
        commit(r, &format!("routes {k}"));
        let p = probation_of(r, &[]);
        assert_eq!(p["id"], did.as_str(), "{p}");
        assert_eq!(p["counted"], 5 * (k + 1), "{p}");
        assert_eq!(p["at_start"], 40, "{p}");
        let want = if k == 2 { "eligible" } else { "waiting" };
        assert_eq!(p["state"], want, "{p}");
        if k < 2 {
            // Not yet: a person's `drift review --block` is refused, with the count.
            let (code, _, err) = run(r, &["review", "--block", &did]);
            assert_eq!(code, 2, "{err}");
            assert!(err.contains("probation"), "{err}");
            assert_eq!(practice(r).mode, Mode::Advise);
        }
    }
    let p = probation_of(r, &[]);
    let command = format!("drift review --block {did}");
    assert_eq!(p["command"], command.as_str(), "{p}");
    let text = drift(r, &["check"]);
    assert!(text.contains("may block"), "{text}");
    assert!(text.contains(&command), "{text}");
    let list = drift(r, &["practices", "promote", "--list"]);
    assert!(list.contains(&command), "{list}");
    let (_, v) = json(r, &["practices", "promote", "--list", "--json"]);
    assert_eq!(v["probation"][0]["state"], "eligible", "{v}");
    // Eligible is not blocking: nothing blocks until a person runs the command.
    assert_eq!(practice(r).mode, Mode::Advise);
    drift(r, &["review", "--block", &did]);
    assert_eq!(practice(r).mode, Mode::Block);

    // A route that breaks it now fails the check, as a blocking practice does.
    route(r, 55, false);
    let (code, _, _) = run(r, &["check"]);
    assert_eq!(code, 1);
}

/// Pins: a new unit that breaks it makes it not eligible, named; an unknown one counts
/// for neither side.
#[test]
fn a_new_unit_that_breaks_it_is_named() {
    let (_src, dst, did) = on_probation();
    let r = dst.path();
    for i in 40..56 {
        route(r, i, i != 50);
    }
    commit(r, "routes");
    let p = probation_of(r, &[]);
    assert_eq!(p["id"], did.as_str(), "{p}");
    assert_eq!(p["state"], "broken", "{p}");
    assert_eq!(p["broke"][0], "app/api/r50/route.ts#GET", "{p}");
    assert!(p.get("command").is_none(), "{p}");
}

/// Pins the rule that a change cannot promote its own rule: units added by a change
/// that also edits the probation record do not count, and the record the change starts
/// from judges (so dropping units from it gains nothing). Read against the merge base
/// with `--diff-base`, and against `HEAD` for a change not committed yet.
#[test]
fn a_change_that_edits_the_record_does_not_count_its_own_units() {
    let (_src, dst, did) = on_probation();
    let r = dst.path();
    // Fifteen new routes, and the record edited to drop two of those there at the start.
    for i in 40..55 {
        route(r, i, true);
    }
    let record = read(r, PROBATION_FILE);
    let edited: String = record
        .lines()
        .filter(|l| {
            !l.ends_with("app/api/r00/route.ts#GET") && !l.ends_with("app/api/r01/route.ts#GET")
        })
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, PROBATION_FILE, &edited);

    // Not committed yet: against HEAD.
    let p = probation_of(r, &[]);
    assert_eq!(p["state"], "waiting", "{p}");
    assert_eq!(p["counted"], 0, "{p}");
    assert_eq!(p["held_back"], 15, "{p}");
    assert_eq!(p["at_start"], 40, "{p}");
    let (code, _, err) = run(r, &["review", "--block", &did]);
    assert_eq!(code, 2, "{err}");

    // Committed on a branch, read against the branch it starts from.
    git(r, &["checkout", "-q", "-b", "change"]);
    commit(r, "routes and the record");
    let p = probation_of(r, &["--diff-base", "main"]);
    assert_eq!(p["counted"], 0, "{p}");
    assert_eq!(p["held_back"], 15, "{p}");
    assert_eq!(p["at_start"], 40, "{p}");
    assert!(
        p["message"].as_str().unwrap().contains("do not count"),
        "{p}"
    );

    // The same routes without the edit of the record count.
    git(r, &["checkout", "-q", "main"]);
    git(r, &["checkout", "-q", "-b", "honest"]);
    for i in 40..55 {
        route(r, i, true);
    }
    commit(r, "routes");
    let p = probation_of(r, &["--diff-base", "main"]);
    assert_eq!(p["counted"], 15, "{p}");
    assert_eq!(p["state"], "eligible", "{p}");
}
