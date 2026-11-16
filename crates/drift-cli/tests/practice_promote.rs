//! `drift practices promote` and the practice step of `drift review`
//! (docs/v2/PROMOTE-A-PRACTICE.md): on a repository whose routes are mostly wrapped in
//! `withAuth`, a person makes that the rule for new code in one place. What qualifies is
//! decided from counts; a refusal writes nothing and exits 2; block mode goes through a
//! replay of the git history.
//!
//! `--list` leaves out a practice already promoted (a convention of the same concern,
//! accepted, in a place that holds or is held by the candidate's) and one a person
//! declined, and says how many of each it left out.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{AgentsChoice, ConventionsFile, Mode, Status};
use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const AUTH: &str = "type Handler = (req: Request) => Promise<Response>;\n\nexport function withAuth(h: Handler): Handler {\n  return async (req) => {\n    if (!req.headers.get(\"authorization\")) {\n      return new Response(\"Unauthorized\", { status: 401 });\n    }\n    return h(req);\n  };\n}\n";
const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift` with its exit code, stdout and stderr.
fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// `drift`'s stdout, which must succeed.
fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

/// `drift ... --json`'s stdout, parsed, with the exit code.
fn json(root: &Path, args: &[&str]) -> (i32, Value) {
    let (code, out, err) = run(root, args);
    let v = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{args:?}: {e}\n{out}\n{err}"));
    (code, v)
}

/// `git` with a fixed identity, and the author and committer date `date` when given.
fn git(root: &Path, args: &[&str], date: Option<&str>) {
    let mut cmd = Command::new("git");
    cmd.args([
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "init.defaultBranch=main",
    ])
    .args(args)
    .current_dir(root)
    .stdin(Stdio::null());
    if let Some(d) = date {
        cmd.env("GIT_AUTHOR_DATE", d).env("GIT_COMMITTER_DATE", d);
    }
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Everything but the routes: the package, the path alias, the guard and 30 helpers.
fn base(r: &Path) {
    write(r, "package.json", "{ \"name\": \"demo\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(r, "lib/auth.ts", AUTH);
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i:02}() {{ return {i}; }}\n"),
        );
    }
}

fn route(r: &Path, i: usize, guarded: bool) {
    write(
        r,
        &format!("app/api/r{i:02}/route.ts"),
        if guarded { GUARDED } else { UNGUARDED },
    );
}

/// `routes` route files, route `i` wrapped in `withAuth` when `guarded(i)`.
fn repo(routes: usize, guarded: impl Fn(usize) -> bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    base(r);
    for i in 0..routes {
        route(r, i, guarded(i));
    }
    dir
}

/// The sample: 40 routes, 38 wrapped in `withAuth` (r38 and r39 are not), after `drift init`.
fn sample() -> tempfile::TempDir {
    let dir = repo(40, |i| i < 38);
    // Without the proposals from the map: this file is about promoting by hand
    // (`s10_from_map.rs` covers what `init` proposes).
    drift(dir.path(), &["init", "--no-from-map"]);
    dir
}

/// The sample in a git repository whose last commit added 16 guarded routes (r22..r37),
/// a month after the first added the rest (r38 and r39 among them): the 15 routes added
/// last all follow `withAuth`. Then `drift init`.
fn sample_with_history() -> tempfile::TempDir {
    history(|i| i < 38, |i| (22..38).contains(&i))
}

/// 40 routes, route `i` guarded when `guarded(i)`, committed in two commits: the rest of
/// the repository and every route not `later(i)`, then a month later the others.
fn history(guarded: impl Fn(usize) -> bool, later: impl Fn(usize) -> bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    base(r);
    for i in (0..40).filter(|i| !later(*i)) {
        route(r, i, guarded(i));
    }
    git(r, &["init", "-q"], None);
    git(r, &["add", "-A"], None);
    git(r, &["commit", "-qm", "first"], Some("2024-01-01T00:00:00Z"));
    for i in (0..40).filter(|i| later(*i)) {
        route(r, i, guarded(i));
    }
    git(r, &["add", "-A"], None);
    git(r, &["commit", "-qm", "later"], Some("2024-02-01T00:00:00Z"));
    // Without the proposals from the map, as in `sample`.
    drift(r, &["init", "--no-from-map"]);
    dir
}

/// The id of the authn variant labelled `label`, or of kind `kind` when `label` is empty.
fn variant(r: &Path, label: &str, kind: &str) -> String {
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    let authn = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authn")
        .unwrap_or_else(|| panic!("no authn concern in {v}"));
    authn["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| {
            if label.is_empty() {
                x["kind"] == kind
            } else {
                x["label"] == label
            }
        })
        .unwrap_or_else(|| panic!("no authn variant {label:?}/{kind:?} in {authn}"))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn with_auth(r: &Path) -> String {
    variant(r, "wrap withAuth", "")
}

fn policy(r: &Path) -> ConventionsFile {
    ConventionsFile::load(r).unwrap().expect("a policy")
}

fn practices(r: &Path) -> Vec<drift_mine::policy::Convention> {
    policy(r)
        .conventions
        .into_iter()
        .filter(|c| c.rule.is_practice())
        .collect()
}

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

/// The two files a promotion writes, as they are.
fn snapshot(r: &Path) -> (String, String) {
    (read(r, ".drift/conventions.yaml"), read(r, "drift.lock"))
}

fn lock_lines(r: &Path, id: &str) -> Vec<String> {
    read(r, "drift.lock")
        .lines()
        .filter(|l| l.starts_with(&format!("{id} ")))
        .map(str::to_string)
        .collect()
}

#[test]
fn every_invocation_of_drift_practices_still_works() {
    let dir = sample();
    let r = dir.path();
    drift(r, &["practices"]);
    drift(r, &["practices", "--all"]);
    drift(r, &["practices", "--concern", "authn", "--all"]);
    let v: Value = serde_json::from_str(&drift(r, &["practices", "--json"])).unwrap();
    assert!(v["concerns"].is_array(), "{v}");
    drift(r, &["practices", "--hints"]);
    let help = drift(r, &["practices", "promote", "--help"]);
    assert!(help.contains("--in <PATH>"), "{help}");
    assert!(help.contains("--dry-run"), "{help}");
}

#[test]
fn a_dry_run_prints_the_preview_and_writes_nothing() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    let before = snapshot(r);
    let out = drift(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--dry-run"],
    );
    assert!(out.contains("38"), "{out}");
    assert!(out.contains("app/api/r38/route.ts"), "{out}");
    assert!(out.ends_with("Dry run: nothing was written.\n"), "{out}");
    assert_eq!(snapshot(r), before);
    assert!(practices(r).is_empty());
}

#[test]
fn promoting_writes_one_accepted_convention_and_records_the_exceptions() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    let out = drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    assert!(
        out.ends_with("Wrote .drift/conventions.yaml and drift.lock.\n"),
        "{out}"
    );
    let ps = practices(r);
    assert_eq!(ps.len(), 1, "{ps:?}");
    let c = &ps[0];
    assert_eq!(c.status, Status::Accepted);
    assert_eq!(c.mode, Mode::Advise);
    assert_eq!(c.agents, Some(AgentsChoice::Show));
    assert_eq!(c.promoted_from_practice.as_deref(), Some(id.as_str()));
    let yaml = read(r, ".drift/conventions.yaml");
    assert!(yaml.contains("type: practice"), "{yaml}");
    assert!(
        yaml.contains(&format!("promoted_from_practice: {id}")),
        "{yaml}"
    );
    let lines = lock_lines(r, &c.id);
    assert_eq!(
        lines,
        vec![
            format!("{} app/api/r38/route.ts#GET", c.id),
            format!("{} app/api/r39/route.ts#GET", c.id),
        ]
    );
}

#[test]
fn the_json_has_the_documented_fields() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    let (code, v) = json(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--json"],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["written"], true, "{v}");
    assert_eq!(v["place"], "app/api", "{v}");
    assert_eq!(v["baselined"], 2, "{v}");
    assert!(v["replay"].is_null(), "{v}");
    assert!(v["preview"].as_str().is_some_and(|p| !p.is_empty()), "{v}");
    let conv = &v["convention"];
    assert_eq!(conv["status"], "accepted", "{v}");
    assert_eq!(conv["mode"], "advise", "{v}");
    assert_eq!(conv["promoted_from_practice"], id.as_str(), "{v}");
    assert_eq!(conv["id"], practices(r)[0].id.as_str(), "{v}");
    let c = &v["candidate"];
    assert_eq!(c["concern"], "authn", "{v}");
    assert_eq!(c["place"]["package"], "", "{v}");
    assert_eq!(c["place"]["dir"], "app/api", "{v}");
    assert_eq!(c["ways"][0]["id"], id.as_str(), "{v}");
    assert_eq!(c["ways"][0]["members"], 38, "{v}");
    assert_eq!(c["follows"], 38, "{v}");
    assert_eq!(c["exceptions"].as_array().map(Vec::len), Some(2), "{v}");
    assert_eq!(c["exceptions"][0]["path"], "app/api/r38/route.ts", "{v}");
    assert_eq!(c["unknown"], 0, "{v}");
    assert_eq!(c["total"], 40, "{v}");
    assert_eq!(c["forced"], false, "{v}");
}

#[test]
fn promoting_again_keeps_the_id_and_changes_nothing() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    let after = snapshot(r);
    let first = practices(r)[0].id.clone();
    let (code, v) = json(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--json"],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["convention"]["id"], first.as_str(), "{v}");
    assert_eq!(v["baselined"], 0, "{v}");
    assert_eq!(snapshot(r), after);
    assert_eq!(practices(r).len(), 1);
}

/// Before: the practice is listed with its command. After it is promoted: not listed
/// again, and the note names the convention that covers it.
#[test]
fn the_list_shows_a_practice_until_it_is_promoted() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    let before = snapshot(r);
    let (code, v) = json(r, &["practices", "promote", "--list", "--json"]);
    assert_eq!(code, 0, "{v}");
    let listed = v["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["candidate"]["ways"][0]["id"] == id.as_str())
        .unwrap_or_else(|| panic!("{id} not listed: {v}"))
        .clone();
    let command = listed["command"].as_str().unwrap();
    assert!(
        command.starts_with(&format!("drift practices promote {id} --in ")),
        "{command}"
    );
    assert_eq!(listed["candidate"]["concern"], "authn", "{listed}");
    let text = drift(r, &["practices", "promote", "--list"]);
    assert!(text.contains(command), "{text}");
    assert_eq!(snapshot(r), before, "--list writes nothing");

    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    let promoted = practices(r)[0].id.clone();
    let (_, v) = json(r, &["practices", "promote", "--list", "--json"]);
    assert!(
        v["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["candidate"]["concern"] != "authn"),
        "{v}"
    );
    assert_eq!(v["promoted"][0], promoted.as_str(), "{v}");
    let text = drift(r, &["practices", "promote", "--list"]);
    assert!(text.contains("Already promoted"), "{text}");
    assert!(text.contains(&promoted), "{text}");
}

#[test]
fn a_refusal_exits_2_and_writes_nothing() {
    let dir = sample();
    let r = dir.path();
    let none = variant(r, "", "none");
    let guard = with_auth(r);
    let before = snapshot(r);
    for (args, code) in [
        (vec!["P-ffffff", "--in", "app/api"], "unknown_variant"),
        (vec![none.as_str(), "--in", "app/api"], "not_a_way"),
        (vec![guard.as_str(), "--in", "lib"], "no_such_place"),
    ] {
        let mut all = vec!["practices", "promote"];
        all.extend(args.iter().copied());
        all.push("--json");
        let (exit, v) = json(r, &all);
        assert_eq!(exit, 2, "{all:?}: {v}");
        assert_eq!(v["refused"]["code"], code, "{all:?}: {v}");
        assert!(v["message"].as_str().is_some_and(|m| !m.is_empty()), "{v}");
        // In text, the sentence on stderr.
        all.pop();
        let (exit, out, err) = run(r, &all);
        assert_eq!(exit, 2, "{all:?}: {out}");
        assert!(!err.trim().is_empty(), "{all:?}");
        assert_eq!(snapshot(r), before, "{all:?} wrote");
    }
}

#[test]
fn a_place_with_seven_routes_is_too_small() {
    let dir = repo(7, |_| true);
    let r = dir.path();
    drift(r, &["init"]);
    let id = with_auth(r);
    let before = snapshot(r);
    let (code, v) = json(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--json"],
    );
    assert_eq!(code, 2, "{v}");
    assert_eq!(v["refused"]["code"], "too_small", "{v}");
    assert_eq!(v["refused"]["units"], 7, "{v}");
    assert_eq!(snapshot(r), before);
}

#[test]
fn below_the_share_only_force_promotes_and_never_to_block() {
    let dir = repo(40, |i| i < 24);
    let r = dir.path();
    drift(r, &["init"]);
    let id = with_auth(r);
    let before = snapshot(r);
    let (code, v) = json(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--json"],
    );
    assert_eq!(code, 2, "{v}");
    assert_eq!(v["refused"]["code"], "below_share", "{v}");
    let (code, out, _) = run(
        r,
        &[
            "practices",
            "promote",
            &id,
            "--in",
            "app/api",
            "--block",
            "--force",
        ],
    );
    assert_eq!(code, 2, "{out}");
    assert_eq!(snapshot(r), before);

    let (code, v) = json(
        r,
        &[
            "practices",
            "promote",
            &id,
            "--in",
            "app/api",
            "--force",
            "--json",
        ],
    );
    assert_eq!(code, 0, "{v}");
    assert_eq!(v["candidate"]["forced"], true, "{v}");
    assert_eq!(v["convention"]["mode"], "advise", "{v}");
    let ps = practices(r);
    assert_eq!(ps.len(), 1);
    assert_eq!(ps[0].status, Status::Accepted);
    assert_eq!(lock_lines(r, &ps[0].id).len(), 16);
}

#[test]
fn block_without_git_history_is_refused_and_says_why() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    let before = snapshot(r);
    let (code, out, err) = run(
        r,
        &["practices", "promote", &id, "--in", "app/api", "--block"],
    );
    assert_eq!(code, 2, "{out}{err}");
    assert!(err.contains("not a git repository"), "{err}");
    assert!(err.contains("needs no history"), "{err}");
    assert_eq!(snapshot(r), before);
}

#[test]
fn block_is_granted_when_the_routes_added_last_follow_it() {
    let dir = sample_with_history();
    let r = dir.path();
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
    assert_eq!(v["replay"]["recent"], 15, "{v}");
    assert_eq!(v["replay"]["followed"], 15, "{v}");
    assert_eq!(v["convention"]["mode"], "block", "{v}");
    assert_eq!(practices(r)[0].mode, Mode::Block);
}

#[test]
fn block_is_refused_when_the_routes_added_last_do_not_follow_it() {
    // 34 of 40 guarded (85%: it may be promoted), but the 6 that are not were added in
    // the last commit, with 9 guarded ones: of the last 15, 9 follow it.
    let dir = history(|i| i < 34, |i| i >= 25);
    let r = dir.path();
    let id = with_auth(r);
    let before = snapshot(r);
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
    assert_eq!(v["refused"]["replay"]["recent"], 15, "{v}");
    assert_eq!(v["refused"]["replay"]["followed"], 9, "{v}");
    assert_eq!(snapshot(r), before);
    // Advise needs no history.
    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    assert_eq!(practices(r)[0].mode, Mode::Advise);
}

#[test]
fn review_block_of_a_promoted_practice_goes_through_the_replay() {
    // No history: refused, whatever --force says.
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    let did = practices(r)[0].id.clone();
    for args in [
        vec!["review", "--block", did.as_str()],
        vec!["review", "--block", did.as_str(), "--force"],
    ] {
        let (code, out, err) = run(r, &args);
        assert_eq!(code, 2, "{args:?}: {out}{err}");
        assert!(err.contains("needs no history"), "{err}");
        assert_eq!(practices(r)[0].mode, Mode::Advise);
    }
    let (_, _, err) = run(r, &["review", "--block", &did, "--force"]);
    assert!(err.contains("--force does not lift"), "{err}");

    // With a history that follows it: blocks.
    let dir = sample_with_history();
    let r = dir.path();
    let id = with_auth(r);
    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    let did = practices(r)[0].id.clone();
    drift(r, &["review", "--block", &did]);
    assert_eq!(practices(r)[0].mode, Mode::Block);
    assert_eq!(practices(r)[0].status, Status::Accepted);
    // And back.
    drift(r, &["review", "--advise", &did]);
    assert_eq!(practices(r)[0].mode, Mode::Advise);
}

#[test]
fn a_rejected_practice_is_not_listed_again() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    // Where `--list` would put it.
    drift(r, &["practices", "promote", &id]);
    let did = practices(r)[0].id.clone();
    drift(r, &["review", "--reject", &did]);
    assert_eq!(practices(r)[0].status, Status::Rejected);
    let (code, v) = json(r, &["practices", "promote", "--list", "--json"]);
    assert_eq!(code, 0, "{v}");
    assert!(
        v["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["candidate"]["ways"][0]["id"] != id.as_str()),
        "{v}"
    );
    assert_eq!(v["declined"], 1, "{v}");
    let text = drift(r, &["practices", "promote", "--list"]);
    assert!(text.contains("1 declined"), "{text}");
    // An explicit promote accepts it again, under the same id.
    drift(r, &["practices", "promote", &id]);
    let ps = practices(r);
    assert_eq!(ps.len(), 1);
    assert_eq!(ps[0].id, did);
    assert_eq!(ps[0].status, Status::Accepted);
}

#[test]
fn review_names_where_a_promoted_practice_came_from() {
    let dir = sample();
    let r = dir.path();
    let id = with_auth(r);
    drift(r, &["practices", "promote", &id, "--in", "app/api"]);
    let did = practices(r)[0].id.clone();
    let list = drift(r, &["review", "--list"]);
    assert!(list.contains(&format!("[{did}]")), "{list}");
    assert!(list.contains("promoted from the practice map"), "{list}");
    assert!(list.contains(&id), "{list}");
    let card = drift(r, &["review", "--show", &did]);
    assert!(
        card.contains(&format!(
            "origin:   promoted from the practice map, variant {id}"
        )),
        "{card}"
    );
}

#[test]
fn promote_needs_drift_init_first() {
    let dir = repo(40, |i| i < 38);
    let r = dir.path();
    let id = with_auth(r);
    let (code, out, err) = run(r, &["practices", "promote", &id, "--in", "app/api"]);
    assert_eq!(code, 2, "{out}{err}");
    assert!(err.contains("drift init"), "{err}");
    assert!(!r.join(".drift/conventions.yaml").exists());
}
