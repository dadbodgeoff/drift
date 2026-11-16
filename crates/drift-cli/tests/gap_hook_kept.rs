//! The practice map is kept between hook processes also when it holds a unit Drift
//! could not read. Such a unit carries the instrument its reason is about, a field no
//! output shows; written without it the map did not read back equal, so it was never
//! kept, and every hook of a session built it again (seconds on a large repository).

use std::io::Write;
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

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// One hook's standard output.
fn hook(root: &Path, session: &str, event: &str) -> String {
    let input = json!({ "session_id": session, "cwd": root, "hook_event_name": event, "source": "startup" });
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(["hook", "claude", event])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(0), "hooks always exit 0: {out:?}");
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

const INSTRUMENT: &str = "src/auth.ts#dynamicGuard";

/// An Express service: six route files, each with a route behind `requireUser` and
/// one behind a guard picked at run time from a table, which Drift cannot read.
/// `drift init` has run and nothing is accepted.
fn service() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"svc\", \"version\": \"1.0.0\", \"dependencies\": { \"express\": \"4.19.2\" } }\n",
    );
    write(
        r,
        "src/registry.ts",
        "export const checkers: Record<string, any> = {};\n",
    );
    write(
        r,
        "src/auth.ts",
        "import { checkers } from \"./registry\";\n\nexport function requireUser(req: any, res: any, next: any) {\n  if (!req.user) {\n    res.status(401).end();\n    return;\n  }\n  next();\n}\n\nexport const dynamicGuard = checkers[process.env.GUARD_NAME ?? \"default\"];\n",
    );
    for n in ["a", "b", "c", "d", "e", "f"] {
        write(
            r,
            &format!("src/routes/{n}.ts"),
            &format!(
                "import {{ Router }} from \"express\";\nimport {{ requireUser, dynamicGuard }} from \"../auth\";\n\nexport const router = Router();\n\nrouter.get(\"/{n}\", requireUser, (req, res) => {{\n  res.json({{ ok: true }});\n}});\n\nrouter.post(\"/{n}/unknown\", dynamicGuard, (req, res) => {{\n  res.json({{ ok: true }});\n}});\n"
            ),
        );
    }
    drift(r, &["init"]);
    dir
}

fn kept(r: &Path, kind: &str) -> Vec<std::path::PathBuf> {
    let mut out: Vec<_> = std::fs::read_dir(r.join(".drift/cache/derived-v1"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            name.starts_with(&format!("{kind}-")) && name.ends_with(".json")
        })
        .collect();
    out.sort();
    out
}

#[test]
fn a_map_with_a_unit_drift_could_not_read_is_kept_and_read_back() {
    let dir = service();
    let r = dir.path();
    // The fixture is what the test is about: units that are unknown for an instrument.
    let map: Value = serde_json::from_str(&drift(r, &["practices", "--json", "--units"])).unwrap();
    let unknown_for_it = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| {
            c["unknown"]["instruments"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .any(|i| i["instrument"] == INSTRUMENT && i["members"] == 6);
    assert!(unknown_for_it, "{}", map["concerns"]);
    let _ = std::fs::remove_dir_all(r.join(".drift/cache/derived-v1"));

    // The first hook of a session builds the map and keeps it, whole.
    let first = hook(r, "s1", "SessionStart");
    let files = kept(r, "practices");
    assert_eq!(files.len(), 1, "the practice map was not kept: {files:?}");
    let bytes = std::fs::read_to_string(&files[0]).unwrap();
    assert!(
        bytes.contains(&format!("\"instrument\":\"{INSTRUMENT}\"")),
        "kept without the unit's instrument"
    );
    let written = std::fs::metadata(&files[0]).unwrap().modified().unwrap();
    // So are the other two results SessionStart reads the whole repository for.
    let (keys, index) = (kept(r, "security-keys"), kept(r, "hint-index"));
    assert_eq!((keys.len(), index.len()), (1, 1), "{keys:?} {index:?}");
    let index_written = std::fs::metadata(&index[0]).unwrap().modified().unwrap();
    let hints = std::fs::read(r.join(".drift/cache/sessions/agent-hints.idx")).unwrap();

    // The next session, on the same code, reads it back: the same answer, the same
    // one file, not written again.
    let second = hook(r, "s2", "SessionStart");
    assert_eq!(second, first);
    assert_eq!(kept(r, "practices"), files);
    assert_eq!(
        std::fs::metadata(&files[0]).unwrap().modified().unwrap(),
        written,
        "the kept map was built and written again"
    );
    assert_eq!(kept(r, "hint-index"), index);
    assert_eq!(
        std::fs::metadata(&index[0]).unwrap().modified().unwrap(),
        index_written,
        "the kept index was built and written again"
    );
    // The index the session's search hints read is the one a session builds afresh.
    assert_eq!(
        std::fs::read(r.join(".drift/cache/sessions/agent-hints.idx")).unwrap(),
        hints
    );

    // What Drift prints is the same from the kept map as from one built afresh, and
    // shows no unit's instrument: the field is for the kept file alone.
    let from_kept = drift(r, &["practices", "--json", "--units"]);
    let _ = std::fs::remove_dir_all(r.join(".drift/cache/derived-v1"));
    let afresh = drift(r, &["practices", "--json", "--units"]);
    assert_eq!(from_kept, afresh);
    let printed: Value = serde_json::from_str(&afresh).unwrap();
    let rows = printed["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| c["units"].as_array().cloned().unwrap_or_default())
        .collect::<Vec<_>>();
    assert!(rows.len() >= 12, "{}", rows.len());
    assert!(rows.iter().all(|u| u.get("instrument").is_none()));

    // A kept file that does not parse is computed again and replaced, whole.
    hook(r, "s3", "SessionStart");
    let files = kept(r, "practices");
    assert_eq!(files.len(), 1);
    std::fs::write(&files[0], b"{ not json").unwrap();
    let third = hook(r, "s4", "SessionStart");
    assert_eq!(third, first);
    let bytes = std::fs::read_to_string(&files[0]).unwrap();
    assert!(bytes.contains(&format!("\"instrument\":\"{INSTRUMENT}\"")));
}
