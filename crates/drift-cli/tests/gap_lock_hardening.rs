//! Drift's own files are never a way in or out of the repository, and the commands it
//! prints are safe to paste.
//!
//! Pins:
//! - every writer of `.drift/security.lock`, `drift.lock` and `.drift/conventions.yaml`
//!   refuses a link in their place that leads to a file outside, to a directory outside,
//!   or to nothing: it exits non-zero naming the link, the outside stays as it was, and
//!   the link is left a link (before, `drift security --write-baseline` wrote through a
//!   link, and a dangling final link was silently replaced by a regular file);
//! - every gate that reads them (`drift check`, `drift security --ratchet`) fails closed
//!   on such a link, saying which path and why, instead of comparing against a file the
//!   change does not hold, or reading a dangling baseline as "no baseline" (before, both
//!   exited 0); a link that stays inside the repository is still read;
//! - every command Drift prints that names a convention id or a path from the
//!   repository is one shell word per argument: run through a real `sh`, it executes
//!   nothing and hands Drift the id and the path exactly.

use std::path::Path;
use std::process::Command;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// Runs drift with no fact cache and no agent's environment: (exit code, stdout, stderr).
fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY")
        .env_remove("CLAUDECODE")
        .env_remove("DRIFT_AGENT")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn ok(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args);
    assert_eq!(code, 0, "{args:?}: {out}\n{err}");
    out
}

/// Routes wrapped in `withAuth` (37 of 40), that convention accepted in block mode,
/// `drift.lock` and the security baseline written.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 0..40 {
        let body = if i < 37 { GUARDED } else { UNGUARDED };
        write(r, &format!("app/api/r{i:02}/route.ts"), body);
    }
    for i in 0..30 {
        let body = format!("export function h{i}() {{\n  return {i};\n}}\n");
        write(r, &format!("lib/h{i:02}.ts"), &body);
    }
    ok(r, &["init"]);
    let census: serde_json::Value = serde_json::from_str(&ok(r, &["census", "--json"])).unwrap();
    let id = census["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .expect("withAuth convention")["id"]
        .as_str()
        .unwrap()
        .to_string();
    ok(r, &["review", "--block", &id]);
    ok(r, &["security", "--write-baseline"]);
    dir
}

#[cfg(unix)]
mod links {
    use super::*;
    use std::os::unix::fs::symlink;

    /// What a link in place of one of Drift's files leads to.
    #[derive(Debug, Clone, Copy)]
    enum Leads {
        File,
        Dir,
        Nothing,
    }

    const ALL: [Leads; 3] = [Leads::File, Leads::Dir, Leads::Nothing];
    const KEEP: &str = "export KEEP=1\n";

    /// Replaces `rel` in `r` by a link to somewhere in `outside`, which the caller
    /// checks with [`untouched`] afterwards.
    fn link(r: &Path, rel: &str, outside: &Path, leads: Leads) {
        let target = match leads {
            Leads::File => {
                std::fs::write(outside.join("bashrc"), KEEP).unwrap();
                outside.join("bashrc")
            }
            Leads::Dir => {
                std::fs::create_dir_all(outside.join("dir")).unwrap();
                outside.join("dir")
            }
            Leads::Nothing => outside.join("nothing"),
        };
        let p = r.join(rel);
        if std::fs::symlink_metadata(&p).is_ok() {
            std::fs::remove_file(&p).unwrap();
        }
        symlink(&target, &p).unwrap();
    }

    fn untouched(r: &Path, rel: &str, outside: &Path, leads: Leads, said: &str) {
        match leads {
            Leads::File => assert_eq!(
                std::fs::read_to_string(outside.join("bashrc")).unwrap(),
                KEEP,
                "{said}"
            ),
            Leads::Dir => assert!(
                std::fs::read_dir(outside.join("dir"))
                    .unwrap()
                    .next()
                    .is_none(),
                "{said}"
            ),
            Leads::Nothing => assert!(!outside.join("nothing").exists(), "{said}"),
        }
        assert!(
            std::fs::symlink_metadata(r.join(rel))
                .unwrap()
                .file_type()
                .is_symlink(),
            "the link was replaced: {said}"
        );
    }

    /// Each writer, with its file replaced by a link that leads outside or to nothing:
    /// refused, the link named, nothing written outside, the link left as it is.
    #[test]
    fn no_writer_goes_through_a_link() {
        let writers: [(&str, &[&str]); 3] = [
            (".drift/security.lock", &["security", "--write-baseline"]),
            ("drift.lock", &["init"]),
            (".drift/conventions.yaml", &["init"]),
        ];
        let dir = repo();
        let r = dir.path();
        for (rel, args) in writers {
            let saved = std::fs::read(r.join(rel)).unwrap();
            for leads in ALL {
                let outside = tempfile::tempdir().unwrap();
                link(r, rel, outside.path(), leads);
                let (code, out, err) = run(r, args);
                let said = format!("{rel} {leads:?} {args:?}: {code}\n{out}\n{err}");
                assert_ne!(code, 0, "{said}");
                assert!(err.contains("is a symbolic link"), "{said}");
                assert!(err.contains(rel), "the path is named: {said}");
                untouched(r, rel, outside.path(), leads, &said);
            }
            std::fs::remove_file(r.join(rel)).unwrap();
            std::fs::write(r.join(rel), saved).unwrap();
        }
    }

    /// Each file a gate reads, linked to a copy of itself outside the repository (so a
    /// reader that followed the link would pass): `drift check` fails closed, naming the
    /// path and why; `drift security --ratchet` too for the baseline. A dangling
    /// baseline fails the same way, never read as no baseline.
    #[test]
    fn no_gate_reads_through_a_link() {
        let dir = repo();
        let r = dir.path();
        let (code, out, err) = run(r, &["check"]);
        assert_eq!(code, 0, "the repository passes as it is: {out}\n{err}");
        for rel in [
            ".drift/security.lock",
            "drift.lock",
            ".drift/conventions.yaml",
        ] {
            let outside = tempfile::tempdir().unwrap();
            let copy = outside.path().join("copy");
            std::fs::rename(r.join(rel), &copy).unwrap();
            symlink(&copy, r.join(rel)).unwrap();
            let mut gates: Vec<&[&str]> = vec![&["check"]];
            if rel == ".drift/security.lock" {
                gates.push(&["security", "--ratchet"]);
            }
            for args in gates {
                let (code, out, err) = run(r, args);
                let said = format!("{rel} {args:?}: {code}\n{out}\n{err}");
                assert_eq!(code, 2, "{said}");
                assert!(err.contains(rel), "the path is named: {said}");
                assert!(err.contains("leads outside the repository"), "{said}");
            }
            std::fs::remove_file(r.join(rel)).unwrap();
            std::fs::rename(&copy, r.join(rel)).unwrap();
        }

        let rel = ".drift/security.lock";
        let outside = tempfile::tempdir().unwrap();
        let saved = r.join(".drift/kept.lock");
        std::fs::rename(r.join(rel), &saved).unwrap();
        symlink(outside.path().join("nothing"), r.join(rel)).unwrap();
        for args in [&["check"][..], &["security", "--ratchet"]] {
            let (code, out, err) = run(r, args);
            let said = format!("dangling {args:?}: {code}\n{out}\n{err}");
            assert_eq!(code, 2, "{said}");
            assert!(err.contains("does not exist"), "{said}");
        }

        // A link that stays inside the repository is read as before.
        std::fs::remove_file(r.join(rel)).unwrap();
        symlink("kept.lock", r.join(rel)).unwrap();
        let (code, out, err) = run(r, &["check"]);
        assert_eq!(code, 0, "{out}\n{err}");
    }
}

/// A convention id and a route directory with a space, both quotes, `$(…)` and `;`.
const ID: &str = "D-1; $(touch pwned) it's \"q\"";
const DIR: &str = "app/api/we ird'$(touch pwned);x \"q\"";

/// The commands in `text` that name what the repository wrote: every backquoted span
/// starting `drift `, and the rest of a line from `drift practices promote`.
fn commands(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (i, part) in text.split('`').enumerate() {
        if i % 2 == 1 && part.starts_with("drift ") {
            out.push(part.to_string());
        }
    }
    for line in text.lines() {
        if let Some(at) = line.find("drift practices promote ") {
            out.push(line[at..].trim_end().to_string());
        }
    }
    out.retain(|c| c.contains("D-1;") || c.contains("we ird"));
    out
}

/// `cmd` with each `<placeholder>` written as a plain word.
fn placeholder(cmd: &str) -> String {
    let mut out = String::new();
    let mut rest = cmd;
    while let Some(at) = rest.find('<') {
        match rest[at..].find('>') {
            Some(end) if !rest[at + 1..at + end].contains(char::is_whitespace) => {
                out.push_str(&rest[..at]);
                out.push_str("PLACEHOLDER");
                rest = &rest[at + end + 1..];
            }
            _ => break,
        }
    }
    out.push_str(rest);
    out
}

/// Every command Drift prints with a repository's id or path in it is one shell word
/// per argument: `sh` runs nothing in it and hands over the id and path exactly.
#[cfg(unix)]
#[test]
fn printed_commands_quote_what_the_repository_wrote() {
    let dir = repo();
    let r = dir.path();
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let mined = policy
        .lines()
        .find_map(|l| l.trim().strip_prefix("- id: "))
        .unwrap()
        .to_string();
    let quoted = serde_json::to_string(ID).unwrap();
    std::fs::write(
        r.join(".drift/conventions.yaml"),
        policy.replace(&format!("id: {mined}"), &format!("id: {quoted}")),
    )
    .unwrap();
    let file = format!("{DIR}/route.ts");
    write(r, &file, UNGUARDED);

    let mut printed = String::new();
    for args in [
        &["check"][..],
        &["review", "--show", ID],
        &["practices"],
        &["card", &file],
    ] {
        let (_, out, err) = run(r, args);
        printed.push_str(&out);
        printed.push_str(&err);
    }
    let cmds = commands(&printed);
    assert!(
        cmds.iter().any(|c| c.contains("--exempt")) && cmds.iter().any(|c| c.contains("we ird")),
        "the fixture prints commands naming the id and the path:\n{printed}"
    );
    let member = format!("{file}#GET");
    for cmd in &cmds {
        let scratch = tempfile::tempdir().unwrap();
        // A placeholder (`<why>`, `<answer>`) is for a person to fill in, not a word.
        let rest = placeholder(cmd.strip_prefix("drift ").unwrap());
        let out = Command::new("sh")
            .arg("-c")
            .arg(format!("set -f; printf '%s\\n' {rest}"))
            .current_dir(scratch.path())
            .output()
            .unwrap();
        let words = String::from_utf8_lossy(&out.stdout).into_owned();
        assert!(out.status.success(), "{cmd}\n{words}");
        assert!(
            std::fs::read_dir(scratch.path()).unwrap().next().is_none(),
            "the shell ran something in: {cmd}"
        );
        let words: Vec<&str> = words.lines().collect();
        if cmd.contains("D-1;") {
            assert!(words.contains(&ID), "{cmd}: {words:?}");
        }
        if cmd.contains("we ird") {
            assert!(
                words
                    .iter()
                    .any(|w| *w == file || *w == member || *w == DIR),
                "{cmd}: {words:?}"
            );
        }
    }
    assert!(!r.join("pwned").exists());
}
