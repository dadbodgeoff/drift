//! `drift setup` as one guided flow (crates/drift-cli/src/guided.rs).
//!
//! Pins:
//! - answered from a script (`--yes-to`, `--no-to`), it accepts exactly the proposals
//!   named (advising), records a practice from the map as `drift practices promote`
//!   does, writes the security baseline only on a yes, records a "no" to an agent
//!   integration under `setup:`, and leaves `drift check` with nothing new;
//! - with no terminal and no answers it changes no file, on a fresh repository and on
//!   one already set up, and prints each question with the flag that answers it;
//! - Enter (an empty answer) skips: nothing is written, not even `drift init`'s files on
//!   a repository that has none; a yes there runs `drift init` first;
//! - a key no question has, or one given to both lists, is an error with nothing written;
//! - an agent's run asks nothing and writes nothing;
//! - a re-run asks nothing already decided; `--forget` undoes a recorded "no".

use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use drift_mine::policy::{ConventionsFile, Mode, Status};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
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

/// The repository of `s10_from_map.rs`: 40 routes, 38 wrapped in `withAuth` (r38 and
/// r39 are not), and 30 helpers: a mined convention and a practice from the map.
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
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i:02}() {{ return {i}; }}\n"),
        );
    }
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    dir
}

/// Runs drift with no fact cache, no agent's environment, and `stdin` as standard
/// input (`None`: no input at all). `person`: a script a person runs.
fn run(root: &Path, args: &[&str], stdin: Option<&str>, person: bool) -> (i32, String, String) {
    let mut c = Command::new(&*BIN);
    c.arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    if person {
        c.env("DRIFT_SETUP_PERSON", "1")
            .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1");
    }
    let mut child = c.spawn().unwrap();
    if let Some(text) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args, None, false);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

fn person(root: &Path, args: &[&str], stdin: Option<&str>) -> String {
    let (code, out, err) = run(root, args, stdin, true);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

/// Every file under `root` with its bytes.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut todo = vec![root.to_path_buf()];
    while let Some(d) = todo.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                todo.push(p);
            } else {
                out.insert(
                    p.strip_prefix(root).unwrap().to_path_buf(),
                    std::fs::read(&p).unwrap(),
                );
            }
        }
    }
    out
}

/// The ids of the proposals a run asked, with where each came from: the cards'
/// `[k of n] ID (from)` lines.
fn cards(out: &str) -> Vec<(String, String)> {
    out.lines()
        .filter_map(|l| {
            let rest = l.trim_start().strip_prefix('[')?;
            let (place, rest) = rest.split_once("] ")?;
            if !place.contains(" of ") {
                return None;
            }
            let (id, from) = rest.split_once(" (")?;
            Some((id.to_string(), from.to_string()))
        })
        .collect()
}

fn first_card(out: &str, from: &str) -> String {
    cards(out)
        .into_iter()
        .find(|(_, f)| f.starts_with(from))
        .map(|(id, _)| id)
        .unwrap_or_else(|| panic!("no proposal {from:?} asked in:\n{out}"))
}

#[test]
fn scripted_answers_accept_what_they_name_and_check_reports_nothing_new() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    // What a person is asked, without answering: the ids to answer.
    let dry = drift(r, &["setup"]);
    let mined = first_card(&dry, "mined");
    let practice = first_card(&dry, "from the map, not mined: a practice");
    let yes = format!("{mined},{practice},baseline");
    let out = person(
        r,
        &["setup", "--by", "person", "--yes-to", &yes, "--no-to", "agents-md"],
        None,
    );
    let policy = ConventionsFile::load(r).unwrap().expect("a policy");
    for id in [&mined, &practice] {
        let c = policy.conventions.iter().find(|c| &c.id == id).unwrap();
        assert_eq!(c.status, Status::Accepted, "{id}\n{out}");
        assert_eq!(c.mode, Mode::Advise, "{id}: every rule accepted here advises");
    }
    // Nothing else was accepted.
    assert_eq!(
        policy
            .conventions
            .iter()
            .filter(|c| c.status == Status::Accepted)
            .count(),
        2,
        "{out}"
    );
    // The practice is recorded as `drift practices promote` records it.
    let lock = read(r, "drift.lock");
    assert!(
        lock.contains(&format!("{practice} app/api/r38/route.ts#GET"))
            && lock.contains(&format!("{practice} app/api/r39/route.ts#GET")),
        "{lock}"
    );
    // The baseline was written; the agents block was not, and the "no" is recorded.
    assert!(
        read(r, ".drift/security.lock").starts_with("# drift security baseline"),
        "{out}"
    );
    assert!(!r.join("AGENTS.md").exists(), "{out}");
    assert!(read(r, ".drift/config.yaml").contains("answer: \"declined\""), "{out}");
    assert!(out.contains("In CI: drift check --diff-base origin/main"), "{out}");
    // `drift check` reports nothing new.
    let (code, check, err) = run(r, &["check"], None, false);
    assert_eq!(code, 0, "{check}\n{err}");
    assert!(check.contains("drift: no new violations"), "{check}");
}

#[test]
fn no_terminal_and_no_answers_changes_no_file() {
    // A fresh repository: nothing is written, not even `drift init`'s files.
    let dir = repo();
    let r = dir.path();
    let before = snapshot(r);
    let out = drift(r, &["setup"]);
    assert_eq!(snapshot(r), before, "{out}");
    assert!(out.contains("Would ask"), "{out}");
    assert!(out.contains("--yes-to baseline"), "{out}");
    assert!(out.contains("Nothing was changed"), "{out}");

    // A repository already set up: every byte is kept.
    drift(r, &["init"]);
    let before = snapshot(r);
    let out = drift(r, &["setup"]);
    assert_eq!(snapshot(r), before, "{out}");
    // Deterministic.
    assert_eq!(drift(r, &["setup"]), out);
}

#[test]
fn enter_skips_and_writes_nothing() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let before = snapshot(r);
    let enters = "\n".repeat(200);
    let out = person(
        r,
        &["setup", "--by", "person", "--guided"],
        Some(enters.as_str()),
    );
    assert_eq!(snapshot(r), before, "{out}");
    assert!(
        out.contains("Skipped, asked again by the next `drift setup`"),
        "{out}"
    );
}

/// Pins that `drift init` runs only once a person answers a proposal: on a repository
/// with no conventions file, Enter at every question, or the input ending at once,
/// writes no file (before, the flow ran `drift init` before asking anything).
#[test]
fn enter_or_eof_on_a_fresh_repository_writes_nothing() {
    let dir = repo();
    let r = dir.path();
    let before = snapshot(r);
    let enters = "\n".repeat(200);
    for input in [enters.as_str(), ""] {
        let out = person(r, &["setup", "--by", "person", "--guided"], Some(input));
        assert_eq!(snapshot(r), before, "{out}");
        assert!(out.contains("would propose"), "{out}");
        assert!(out.contains("Nothing written."), "{out}");
    }
}

/// Pins that a yes on a repository with no conventions file runs `drift init` (the
/// binary itself, with `--root`) and records the answer in what it wrote.
#[test]
fn a_yes_on_a_fresh_repository_runs_init_then_records_it() {
    let dir = repo();
    let r = dir.path();
    let dry = drift(r, &["setup"]);
    let mined = first_card(&dry, "mined");
    let out = person(r, &["setup", "--by", "person", "--yes-to", &mined], None);
    assert!(out.contains("Ran `drift init`"), "{out}");
    let policy = ConventionsFile::load(r).unwrap().expect("a policy");
    let c = policy.conventions.iter().find(|c| c.id == mined).unwrap();
    assert_eq!(c.status, Status::Accepted, "{out}");
    assert_eq!(c.mode, Mode::Advise, "{out}");
    assert_eq!(
        policy
            .conventions
            .iter()
            .filter(|c| c.status == Status::Accepted)
            .count(),
        1,
        "{out}"
    );
    assert!(r.join("drift.lock").exists(), "{out}");
    // Nothing else was said yes to.
    assert!(!r.join(".drift/security.lock").exists(), "{out}");
}

/// Pins that a key no question has is an error naming it, with nothing written
/// (before, it was skipped and the rest of the answers written), and that a key given
/// to both lists is refused.
#[test]
fn an_unknown_or_doubled_key_is_refused_and_nothing_is_written() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let before = snapshot(r);
    let (code, out, err) = run(
        r,
        &["setup", "--by", "person", "--yes-to", "baseline,D-nosuch"],
        None,
        true,
    );
    assert_ne!(code, 0, "{out}\n{err}");
    assert!(err.contains("names D-nosuch,"), "{err}");
    assert_eq!(snapshot(r), before, "{out}");
    let (code, out, err) = run(
        r,
        &["setup", "--by", "person", "--yes-to", "baseline", "--no-to", "basline"],
        None,
        true,
    );
    assert_ne!(code, 0, "{out}\n{err}");
    assert!(err.contains("names basline,"), "{err}");
    assert_eq!(snapshot(r), before, "{out}");
    let (code, out, err) = run(
        r,
        &["setup", "--by", "person", "--yes-to", "baseline", "--no-to", "baseline"],
        None,
        true,
    );
    assert_ne!(code, 0, "{out}\n{err}");
    assert!(err.contains("baseline given to both"), "{err}");
    assert_eq!(snapshot(r), before, "{out}");
}

/// Runs drift as an agent does (`DRIFT_AGENT=1`), with a person's variables set too.
fn agent(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("CLAUDECODE")
        .env("DRIFT_AGENT", "1")
        .env("DRIFT_SETUP_PERSON", "1")
        .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Pins that an agent's run asks nothing and writes nothing, even with `--by person`
/// and a person's variables (before, a scripted `--by person` run wrote the baseline).
#[test]
fn an_agents_run_asks_nothing_and_writes_nothing() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let before = snapshot(r);
    let (code, out, err) = agent(r, &["setup"]);
    assert_eq!(code, 0, "{out}\n{err}");
    assert!(out.contains("Would ask"), "{out}");
    for args in [
        &["setup", "--by", "person", "--yes-to", "baseline"][..],
        &["setup", "--by", "person", "--guided"][..],
        &["setup", "--yes-to", "baseline"][..],
    ] {
        let (code, out, err) = agent(r, args);
        assert_ne!(code, 0, "{args:?}\n{out}\n{err}");
    }
    assert_eq!(snapshot(r), before);
}

/// Pins that `drift setup --forget <id>` undoes a recorded "no": the question is asked
/// again.
#[test]
fn forget_undoes_a_recorded_no() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let out = person(r, &["setup", "--by", "person", "--no-to", "agents-md"], None);
    let id = out
        .split("recorded as ")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .unwrap_or_else(|| panic!("no id in:\n{out}"))
        .to_string();
    assert!(id.starts_with("S-"), "{out}");
    assert!(!drift(r, &["setup"]).contains("--yes-to agents-md"));
    person(r, &["setup", "--by", "person", "--forget", &id], None);
    let again = drift(r, &["setup"]);
    assert!(again.contains("--yes-to agents-md"), "{again}");
    assert!(!read(r, ".drift/config.yaml").contains("declined"), "{again}");
}

#[test]
fn a_rerun_asks_nothing_already_decided() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let dry = drift(r, &["setup"]);
    let mined = first_card(&dry, "mined");
    let practice = first_card(&dry, "from the map, not mined: a practice");
    let yes = format!("{mined},{practice},baseline");
    person(
        r,
        &["setup", "--by", "person", "--yes-to", &yes, "--no-to", "agents-md"],
        None,
    );
    let before = snapshot(r);
    let again = drift(r, &["setup"]);
    let asked: Vec<String> = cards(&again).into_iter().map(|(id, _)| id).collect();
    assert!(!asked.contains(&mined) && !asked.contains(&practice), "{again}");
    assert!(!again.contains("--yes-to baseline"), "{again}");
    assert!(!again.contains("--yes-to agents-md"), "{again}");
    assert!(again.contains("you said no earlier"), "{again}");
    // The same answers again: none is asked, so none is used, and nothing changes.
    let out = person(
        r,
        &["setup", "--by", "person", "--yes-to", &yes, "--no-to", "agents-md"],
        None,
    );
    assert!(out.contains("Not asked, so not used:"), "{out}");
    assert_eq!(snapshot(r), before, "{out}");
}
