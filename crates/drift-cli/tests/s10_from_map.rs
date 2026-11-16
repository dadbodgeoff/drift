//! Proposals from the map at `drift init`, `drift census --from-map` and `drift review`:
//! on a repository whose routes are mostly wrapped in `withAuth`, `init` proposes the
//! practice (`from_map: practice`, proposed, advise, shown to no agent, nothing in
//! `drift.lock`); `--no-from-map` proposes none; a plain census is unchanged; accepting
//! the proposal writes what `drift practices promote` writes; a declined one is not
//! offered again.

use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::policy::{Convention, ConventionsFile, Mode, Status};
use drift_mine::practices::promote;
use serde_json::Value;

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

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, 0, "{args:?} failed:\n{out}\n{err}");
    out
}

fn json(root: &Path, args: &[&str]) -> Value {
    let out = drift(root, args);
    serde_json::from_str(&out).unwrap_or_else(|e| panic!("{args:?}: {e}\n{out}"))
}

/// 40 routes, 38 wrapped in `withAuth` (r38 and r39 are not), with 30 helpers.
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

fn policy(r: &Path) -> ConventionsFile {
    ConventionsFile::load(r).unwrap().expect("a policy")
}

/// The practices proposed from the map.
fn from_map(r: &Path) -> Vec<Convention> {
    policy(r)
        .conventions
        .into_iter()
        .filter(|c| c.from_map.as_deref() == Some("practice"))
        .collect()
}

/// The sign-in practice proposed from the map.
fn sign_in(r: &Path) -> Convention {
    from_map(r)
        .into_iter()
        .find(|c| matches!(&c.rule, drift_mine::mine::Rule::Practice { concern, .. } if concern == "authn"))
        .unwrap_or_else(|| panic!("no sign-in proposal in {:?}", from_map(r)))
}

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

fn lock_lines(r: &Path, id: &str) -> Vec<String> {
    read(r, "drift.lock")
        .lines()
        .filter(|l| l.starts_with(&format!("{id} ")))
        .map(str::to_string)
        .collect()
}

#[test]
fn init_proposes_the_practice_from_the_map_and_enforces_nothing() {
    let dir = repo();
    let r = dir.path();
    let out = drift(r, &["init"]);
    let c = sign_in(r);
    assert_eq!(c.status, Status::Proposed);
    assert_eq!(c.mode, Mode::Advise);
    assert_eq!(c.agents, None, "a proposal from the map reaches no agent");
    assert!(c.rule.is_practice());
    assert!(
        lock_lines(r, &c.id).is_empty(),
        "nothing is recorded until a person accepts it"
    );
    let yaml = read(r, ".drift/conventions.yaml");
    assert!(yaml.contains("from_map: practice"), "{yaml}");
    assert!(out.contains("From the map (not mined"), "{out}");
    assert!(out.contains(&format!("[{}]", c.id)), "{out}");
    assert!(out.contains("could not be read (never reported)"), "{out}");
    assert!(out.contains("Also seen, not proposed: "), "{out}");
    assert!(!out.contains("not at all"), "{out}");
    // Not checked: `drift check` reads accepted practices only.
    let (_, check, _) = run(r, &["check"]);
    assert!(!check.contains(&c.id), "{check}");
}

#[test]
fn no_from_map_writes_none() {
    let dir = repo();
    let r = dir.path();
    let out = drift(r, &["init", "--no-from-map"]);
    assert!(
        policy(r).conventions.iter().all(|c| c.from_map.is_none()),
        "{:?}",
        policy(r).conventions
    );
    assert!(!out.contains("From the map"), "{out}");
    // A later init with it drops nothing a person decided, and proposes again.
    drift(r, &["init"]);
    assert!(!from_map(r).is_empty());
    drift(r, &["init", "--no-from-map"]);
    assert!(from_map(r).is_empty());
}

#[test]
fn a_plain_census_has_no_section_and_from_map_appends_one() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let plain = drift(r, &["census"]);
    assert!(!plain.contains("From the map"), "{plain}");
    let with = drift(r, &["census", "--from-map"]);
    assert!(with.starts_with(&plain), "{plain}\n---\n{with}");
    assert!(with[plain.len()..].contains("From the map (not mined"), "{with}");
    let v = json(r, &["census", "--json"]);
    assert!(v.get("from_map").is_none(), "{v}");
    let v = json(r, &["census", "--json", "--from-map"]);
    let all = v["from_map"].as_array().expect("a from_map array");
    assert!(all.iter().any(|p| p["proposed"] == true), "{v}");
    // Deterministic.
    assert_eq!(json(r, &["census", "--json", "--from-map"])["from_map"], v["from_map"]);
}

#[test]
fn a_passive_candidate_is_never_proposed() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let v = json(r, &["census", "--json", "--from-map"]);
    for p in v["from_map"].as_array().unwrap() {
        if p["proposed"] == true {
            assert_ne!(p["candidate"]["passive"], true, "{p}");
        }
    }
    // Each candidate the practice list marks passive is held, with why, never written.
    let list = json(r, &["practices", "promote", "--list", "--json"]);
    let held: Vec<&Value> = v["from_map"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["proposed"] == false)
        .collect();
    for item in list["candidates"].as_array().unwrap() {
        let cand: promote::Candidate =
            serde_json::from_value(item["candidate"].clone()).unwrap();
        if !cand.passive {
            continue;
        }
        let id = promote::convention_id(&cand.place, &cand.concern);
        let rule = promote::convention(&cand).rule;
        assert!(
            from_map(r).iter().all(|c| c.rule != rule),
            "{id} was proposed"
        );
        assert!(
            held.iter()
                .any(|p| p["id"] == id.as_str() && p["reason"] == "passive"),
            "{id} not held as passive: {v}"
        );
    }
}

#[test]
fn accepting_in_review_writes_what_promote_writes() {
    let a = repo();
    let ra = a.path();
    drift(ra, &["init"]);
    let proposal = sign_in(ra);
    drift(ra, &["review", "--accept", &proposal.id]);
    let accepted = policy(ra)
        .conventions
        .into_iter()
        .find(|c| c.id == proposal.id)
        .unwrap();

    let b = repo();
    let rb = b.path();
    drift(rb, &["init", "--no-from-map"]);
    let place = promote::place_of(&proposal).unwrap().shown();
    let way = proposal.promoted_from_practice.clone().unwrap();
    drift(rb, &["practices", "promote", &way, "--in", &place]);
    let promoted = policy(rb)
        .conventions
        .into_iter()
        .find(|c| c.id == proposal.id)
        .expect("the same id");

    // The same entry, but for where it came from.
    assert_eq!(accepted.from_map.as_deref(), Some("practice"));
    let mut same = accepted.clone();
    same.from_map = None;
    assert_eq!(same, promoted);
    assert_eq!(accepted.status, Status::Accepted);
    assert_eq!(accepted.mode, Mode::Advise);
    // The same lock lines.
    assert_eq!(lock_lines(ra, &proposal.id), lock_lines(rb, &proposal.id));
    assert_eq!(
        lock_lines(ra, &proposal.id),
        vec![
            format!("{} app/api/r38/route.ts#GET", proposal.id),
            format!("{} app/api/r39/route.ts#GET", proposal.id),
        ]
    );
    // Once accepted it is not proposed again, and a re-init keeps it as it is.
    drift(ra, &["init"]);
    let again = policy(ra)
        .conventions
        .into_iter()
        .find(|c| c.id == proposal.id)
        .unwrap();
    assert_eq!(again, accepted);
}

#[test]
fn a_declined_proposal_is_not_offered_again() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let c = sign_in(r);
    drift(r, &["review", "--reject", &c.id]);
    let out = drift(r, &["init"]);
    let kept: Vec<Convention> = policy(r)
        .conventions
        .into_iter()
        .filter(|x| x.id == c.id)
        .collect();
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert_eq!(kept[0].status, Status::Rejected);
    assert!(!out.contains(&format!("[{}]", c.id)), "{out}");
    let v = json(r, &["census", "--json", "--from-map"]);
    assert!(
        v["from_map"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["id"] != c.id.as_str()),
        "{v}"
    );
    assert!(lock_lines(r, &c.id).is_empty());
}

#[test]
fn review_lists_the_proposals_from_the_map_apart() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let c = sign_in(r);
    let list = drift(r, &["review", "--list"]);
    assert!(list.contains("from the map, not mined"), "{list}");
    assert!(
        list.contains(&format!("[{}] {} (proposed, from the map: practice)", c.id, c.summary)),
        "{list}"
    );
}
