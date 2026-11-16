//! `drift check --diff-base`: on a two-commit git repo, only what the change
//! introduces is reported, and only blocking violations in it fail the check.

use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

const GUARDED: &str = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
/// Two functions in the `src/lib` role: `utilA` breaks the "pass `level` to `log()`"
/// suggestion (it calls `log({})`), `utilB` follows it.
const MULTI: &str = "import { log } from \"./log\";\n\nexport function utilA() {\n  log({}); return 1;\n}\n\nexport function utilB() {\n  log({ level: \"x\" });\n  return 2;\n}\n";

/// An unguarded handler outside `app/`, followed by a helper.
const LEGACY: &str = "export async function GET(req: Request) {\n  return Response.json({ ok: helper() });\n}\n\nexport function helper() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  return a + b + c;\n}\n";

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift` with its exit code, stdout and stderr.
fn drift(root: &Path, args: &[&str], env: &[(&str, &Path)]) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.env("DRIFT_TEST_UNSHOWN", "1");
    cmd.args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .env_remove("GITHUB_STEP_SUMMARY");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
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
        ])
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

struct Ids {
    auth: String,
    email: String,
    log: String,
}

/// Commit `main`: routes guarded by `withAuth` (accepted in block mode, two legacy
/// routes baselined), emails rendering a wrapper (accepted, advise; a suggestion since decision D7) and lib
/// functions passing `level` to `log()` (a suggestion, accepted; TypeScript call rules
/// are not proposed). After `drift init`, main
/// also gained an unguarded route and `utilA`: new violations that are not part of
/// any later diff. Then branch `pr` off it.
fn repo() -> (tempfile::TempDir, Ids) {
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
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 38 { GUARDED } else { UNGUARDED },
        );
    }
    write(
        r,
        "src/ui/base.tsx",
        "export function BaseEmailWrapper(p: any) {\n  return <div>{p.children}</div>;\n}\n",
    );
    write(
        r,
        "src/lib/log.ts",
        "export function log(m: { level?: string }) {}\n\nexport function logLine(m: string) {\n  log({});\n}\n",
    );
    for i in 10..40 {
        let email = if i < 39 {
            format!(
                "import {{ BaseEmailWrapper }} from \"../ui/base\";\n\nexport function Email{i}() {{\n  return <BaseEmailWrapper><p>hi</p></BaseEmailWrapper>;\n}}\n"
            )
        } else {
            format!("export function Email{i}() {{\n  return <p>hi</p>;\n}}\n")
        };
        write(r, &format!("src/emails/e{i}.tsx"), &email);
        let util = if i < 12 {
            // `logLine`, a helper of the lib functions that leaves the key out, is a
            // shared part of their role (#52): listed as exempt, never a violation.
            format!(
                "import {{ log, logLine }} from \"./log\";\n\nexport function util{i}() {{\n  log({{ level: \"x\" }});\n  logLine(\"y\");\n  return {i};\n}}\n"
            )
        } else if i < 39 {
            format!(
                "import {{ log }} from \"./log\";\n\nexport function util{i}() {{\n  log({{ level: \"x\" }});\n  return {i};\n}}\n"
            )
        } else {
            format!(
                "import {{ log }} from \"./log\";\n\nexport function util{i}() {{\n  log({{}});\n  return {i};\n}}\n"
            )
        };
        write(r, &format!("src/lib/u{i}.ts"), &util);
    }
    for i in 10..30 {
        write(
            r,
            &format!("src/ui/c{i}.tsx"),
            &format!("export function Card{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
        write(
            r,
            &format!("src/other/o{i}.ts"),
            &format!("export function other{i}() {{\n  return {i};\n}}\n"),
        );
    }
    let (code, _, err) = drift(r, &["init"], &[]);
    assert_eq!(code, 0, "{err}");
    let (_, census, _) = drift(r, &["census", "--json"], &[]);
    let census: Value = serde_json::from_str(&census).unwrap();
    let id = |kind: &str| -> String {
        census["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["rule_kind"] == kind)
            .unwrap_or_else(|| panic!("{kind} learned: {census}"))["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let ids = Ids {
        auth: id("wrapped_by:call"),
        email: id("wrapped_by:jsx"),
        log: id("passes_key"),
    };
    let all = format!("{},{},{}", ids.auth, ids.email, ids.log);
    // The suggestions are shown to agents (W0), so `check` text lists their findings too.
    assert_eq!(drift(r, &["review", "--show-to-agents", &all], &[]).0, 0);
    assert_eq!(drift(r, &["review", "--block", &ids.auth], &[]).0, 0);

    write(r, "app/api/old/route.ts", UNGUARDED);
    write(r, "src/lib/multi.ts", MULTI);
    // A guarded route in a directory with a space, and a handler outside the role.
    write(r, "app/api/with space/route.ts", GUARDED);
    write(r, "lib/legacy/route.ts", LEGACY);
    write(r, ".gitignore", ".drift/cache/\n");
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "pr"]);
    (dir, ids)
}

fn git_out(root: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Commit everything on `pr`, then `check --diff-base main` as JSON: exit code and report.
fn commit_and_check(r: &Path) -> (i32, Value) {
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr"]);
    let (code, out, err) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "json"],
        &[],
    );
    assert!(code == 0 || code == 1, "{out}{err}");
    (code, json(&out))
}

/// Fix main's own unguarded route, so nothing outside a diff fails the check: then
/// only the diff rules can find a violation, and the merge base is not checked
/// (the report's `diff.base_checked` is false).
fn only_the_diff_rules(r: &Path) {
    git(r, &["checkout", "-q", "main"]);
    write(r, "app/api/old/route.ts", GUARDED);
    git(r, &["commit", "-qam", "fix old"]);
    git(r, &["checkout", "-qB", "pr"]);
}

/// The scan index files in `.drift/cache` (one per scanned root and language).
fn cache_indexes(r: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for d in std::fs::read_dir(r.join(".drift/cache")).unwrap().flatten() {
        if d.file_name().to_string_lossy().starts_with("index-") {
            for f in std::fs::read_dir(d.path()).unwrap().flatten() {
                out.push(f.path().display().to_string());
            }
        }
    }
    out.sort();
    out
}

fn json(out: &str) -> Value {
    serde_json::from_str(out).unwrap_or_else(|e| panic!("{e}: {out}"))
}

/// `(id, path, symbol)` of the new violations in a JSON report.
fn new_in(report: &Value) -> Vec<(String, String, String)> {
    report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["baselined"] == false && v["suppressed"] == false)
        .map(|v| {
            (
                v["id"].as_str().unwrap().to_string(),
                v["path"].as_str().unwrap().to_string(),
                v["symbol"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

fn t(id: &str, path: &str, symbol: &str) -> (String, String, String) {
    (id.to_string(), path.to_string(), symbol.to_string())
}

#[test]
fn reports_only_what_the_diff_introduces() {
    let (dir, ids) = repo();
    let r = dir.path();
    // Main itself already fails: the route and utilA added after init block or advise.
    let (code, out, _) = drift(r, &["check"], &[]);
    assert_eq!(code, 1, "{out}");
    let (code, out, err) = drift(r, &["check", "--diff-base", "main"], &[]);
    assert_eq!(
        (code, out.contains("no new violations")),
        (0, true),
        "{out}{err}"
    );

    // The PR: drops the `level` key from utilB's log() call (in its body, not its
    // declaration line),
    // adds an unwrapped email, renames a legacy route, deletes a guarded one.
    write(
        r,
        "src/lib/multi.ts",
        &MULTI.replace("log({ level: \"x\" })", "log({})"),
    );
    write(
        r,
        "src/emails/e99.tsx",
        "export function Email99() {\n  return <p>new</p>;\n}\n",
    );
    git(r, &["mv", "app/api/r39", "app/api/r39b"]);
    git(r, &["rm", "-q", "app/api/r10/route.ts"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr"]);

    let (code, out, err) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "json"],
        &[],
    );
    assert_eq!(code, 0, "advice only: {out}{err}");
    let report = json(&out);
    assert_eq!(
        new_in(&report),
        [
            t(&ids.email, "src/emails/e99.tsx", "Email99"),
            t(&ids.log, "src/lib/multi.ts", "utilB"),
        ],
        "untouched utilA, the route added on main and the renamed legacy route are not reported"
    );
    let d = &report["diff"];
    assert_eq!(d["base"], "main");
    assert_eq!(
        (
            &d["files_added"],
            &d["files_changed"],
            &d["files_renamed"],
            &d["files_deleted"]
        ),
        (
            &Value::from(1),
            &Value::from(2),
            &Value::from(1),
            &Value::from(1)
        ),
        "{d}"
    );
    assert_eq!(d["new_outside_diff"], 3, "{d}");

    // The full check still sees all of them, including the renamed legacy route
    // (its lock key moved): PR mode is what keeps that off the pull request.
    let (_, out, _) = drift(r, &["check", "--format", "json"], &[]);
    let all = new_in(&json(&out));
    assert!(
        all.contains(&t(&ids.auth, "app/api/r39b/route.ts", "GET")),
        "{all:?}"
    );
    assert!(
        all.contains(&t(&ids.log, "src/lib/multi.ts", "utilA")),
        "{all:?}"
    );
    assert!(
        all.contains(&t(&ids.auth, "app/api/old/route.ts", "GET")),
        "{all:?}"
    );

    // --strict fails on any new violation in the diff.
    assert_eq!(
        drift(r, &["check", "--diff-base", "main", "--strict"], &[]).0,
        1
    );

    // Text says what was compared and what was left out, with the real legacy count.
    let (_, text, _) = drift(r, &["check", "--diff-base", "main"], &[]);
    let legacy = |out: &str| {
        let i = out
            .find(" legacy, baselined")
            .unwrap_or_else(|| panic!("{out}"));
        out[..i].rsplit('(').next().unwrap().to_string()
    };
    let (_, plain, _) = drift(r, &["check"], &[]);
    assert_eq!(legacy(&text), legacy(&plain), "{text}\n{plain}");
    assert_ne!(legacy(&text), "0", "{text}");
    assert!(
        text.contains(
            "1 added, 2 changed, 1 deleted file(s); 3 new violation(s) outside the diff not shown"
        ),
        "{text}"
    );
    assert!(
        text.contains("src/lib/multi.ts:7 utilB") && !text.contains("utilA"),
        "{text}"
    );

    // Unwrapping a guarded route on the branch blocks.
    write(r, "app/api/r05/route.ts", UNGUARDED);
    git(r, &["commit", "-qam", "unwrap"]);
    let (code, out, _) = drift(r, &["check", "--diff-base", "main"], &[]);
    assert_eq!(code, 1, "{out}");
    assert!(out.contains("app/api/r05/route.ts:1 GET"), "{out}");
    let (code, sarif, _) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "sarif"],
        &[],
    );
    assert_eq!(code, 1);
    let s = json(&sarif);
    let levels: Vec<(&str, &str)> = s["runs"][0]["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
                    .as_str()
                    .unwrap(),
                r["level"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        levels,
        [
            ("app/api/r05/route.ts", "error"),
            // A JSX layout wrapper is a suggestion since decision D7: a note.
            ("src/emails/e99.tsx", "note"),
            ("src/lib/multi.ts", "note"),
        ]
    );

    // An uncommitted, untracked file counts as added: check scans the working tree.
    write(r, "app/api/wip/route.ts", UNGUARDED);
    let (_, out, _) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "json"],
        &[],
    );
    assert!(
        new_in(&json(&out)).contains(&t(&ids.auth, "app/api/wip/route.ts", "GET")),
        "{out}"
    );
}

#[test]
fn github_format_annotates_and_writes_the_summary() {
    let (dir, ids) = repo();
    let r = dir.path();
    write(r, "app/api/r05/route.ts", UNGUARDED);
    write(
        r,
        "src/emails/a,b:c.tsx",
        "export function EmailX() {\n  return <p>new</p>;\n}\n",
    );
    write(
        r,
        "src/lib/multi.ts",
        &MULTI.replace("log({ level: \"x\" })", "log({})"),
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr"]);

    let summary_dir = tempfile::tempdir().unwrap();
    let summary = summary_dir.path().join("summary.md");
    std::fs::write(&summary, "earlier step\n").unwrap();
    let (code, out, err) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "github"],
        &[("GITHUB_STEP_SUMMARY", &summary)],
    );
    assert_eq!(code, 1, "{out}{err}");
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines.len(),
        4,
        "three annotations and a summary line: {out}"
    );
    assert!(
        lines[0].starts_with(&format!(
            "::error file=app/api/r05/route.ts,line=1,title=drift {}::",
            ids.auth
        )),
        "{out}"
    );
    assert!(
        lines[1].starts_with(&format!(
            "::notice file=src/emails/a%2Cb%3Ac.tsx,line=1,title=drift {}::",
            ids.email
        )),
        "{out}"
    );
    assert!(
        lines[2].starts_with(&format!(
            "::notice file=src/lib/multi.ts,line=7,title=drift {}::",
            ids.log
        )),
        "{out}"
    );
    assert!(
        lines[0].contains("%0ABlock mode: this fails the check.%0A"),
        "{out}"
    );
    assert!(
        lines[0].contains(&format!("`// drift-ignore {}: <reason>`", ids.auth)),
        "{out}"
    );
    assert_eq!(
        lines[3],
        "drift: 3 new violation(s) introduced by the diff, 1 in block mode"
    );

    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(md.starts_with("earlier step\n## Drift\n"), "appends: {md}");
    assert!(
        md.contains("**3 new convention violation(s)** introduced by this diff (against `main`"),
        "{md}"
    );
    assert!(
        md.contains("**1 fail(s) the check** (conventions in block mode)"),
        "{md}"
    );
    assert!(
        md.contains("| Default | 1 | 0 |\n| Suggestion | 0 | 2 |"),
        "{md}"
    );
    assert!(
        md.contains(&format!("| `{}` HTTP handlers", ids.auth))
            && md.contains("`app/api/r05/route.ts`:1 `GET` | block |"),
        "{md}"
    );
    assert!(md.contains("drift-ignore <id>: <reason>"), "{md}");
    assert!(md.contains("2 new violation(s) outside this diff"), "{md}");

    // A suppression added in the diff clears the failure and is listed for reviewers.
    write(
        r,
        "app/api/r05/route.ts",
        &format!(
            "// drift-ignore {}: public health check\n{UNGUARDED}",
            ids.auth
        ),
    );
    git(r, &["commit", "-qam", "suppress"]);
    std::fs::remove_file(&summary).unwrap();
    let (code, out, _) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "github"],
        &[("GITHUB_STEP_SUMMARY", &summary)],
    );
    assert_eq!(code, 0, "{out}");
    assert!(!out.contains("::error"), "{out}");
    let md = std::fs::read_to_string(&summary).unwrap();
    assert!(md.contains("None fails the check"), "{md}");
    assert!(
        md.contains(&format!(
            "1 suppressed with `drift-ignore` (check the reasons): `{}` at `app/api/r05/route.ts`:2",
            ids.auth
        )),
        "{md}"
    );

    // Without --diff-base, github format covers every new violation.
    let (code, out, _) = drift(r, &["check", "--format", "github"], &[]);
    assert_eq!(code, 1, "the unguarded route on main blocks: {out}");
    assert!(
        out.contains("::error file=app/api/old/route.ts,line=1,"),
        "{out}"
    );

    // A default-tier convention in advise mode (the call wrapper, set back to advise) is
    // a warning: the end-to-end case D7 took from the JSX email wrapper, now a suggestion.
    assert_eq!(drift(r, &["review", "--advise", &ids.auth], &[]).0, 0);
    let (code, out, _) = drift(r, &["check", "--format", "github"], &[]);
    assert_eq!(code, 0, "advice only: {out}");
    assert!(
        out.contains(&format!(
            "::warning file=app/api/old/route.ts,line=1,title=drift {}::",
            ids.auth
        )) && !out.contains("::error"),
        "{out}"
    );
    let (_, sarif, _) = drift(r, &["check", "--format", "sarif"], &[]);
    let s = json(&sarif);
    assert!(
        s["runs"][0]["results"].as_array().unwrap().iter().any(|x| {
            x["ruleId"] == ids.auth.as_str()
                && x["level"] == "warning"
                && x["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
                    == "app/api/old/route.ts"
        }),
        "{sarif}"
    );
}

#[test]
fn missing_base_shallow_clones_and_no_git_fail_loudly() {
    let (dir, _) = repo();
    let r = dir.path();
    write(
        r,
        "src/emails/e99.tsx",
        "export function Email99() {\n  return <p>x</p>;\n}\n",
    );
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr"]);

    let (code, out, err) = drift(r, &["check", "--diff-base", "no-such-branch"], &[]);
    assert_eq!(code, 2, "{out}");
    assert!(
        err.contains("base ref `no-such-branch` not found") && out.is_empty(),
        "{err}"
    );

    let url = format!("file://{}", r.display());
    let clones = tempfile::tempdir().unwrap();
    let c = clones.path();
    // fetch-depth: 1 (the actions/checkout default): the base branch is not there at all.
    git(
        c,
        &["clone", "-q", "--depth", "1", "--branch", "pr", &url, "one"],
    );
    let (code, _, err) = drift(
        &c.join("one"),
        &["check", "--diff-base", "origin/main"],
        &[],
    );
    assert_eq!(code, 2, "{err}");
    assert!(
        err.contains("`origin/main` not found") && err.contains("fetch-depth: 0 needed"),
        "{err}"
    );
    // Both branches, but not their history: no merge base.
    git(
        c,
        &[
            "clone",
            "-q",
            "--depth",
            "1",
            "--no-single-branch",
            "--branch",
            "pr",
            &url,
            "both",
        ],
    );
    let (code, _, err) = drift(&c.join("both"), &["check", "--diff-base", "main"], &[]);
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("Did you mean `origin/main`?"), "{err}");
    let (code, _, err) = drift(
        &c.join("both"),
        &["check", "--diff-base", "origin/main"],
        &[],
    );
    assert_eq!(code, 2, "{err}");
    assert!(
        err.contains("no merge base") && err.contains("fetch-depth: 0 needed"),
        "{err}"
    );
    // A full clone works.
    git(c, &["clone", "-q", "--branch", "pr", &url, "full"]);
    let (code, out, err) = drift(
        &c.join("full"),
        &["check", "--diff-base", "origin/main", "--format", "json"],
        &[],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(json(&out)["diff"]["files_added"], 1, "{out}");

    // No git at all: an error, not a pass.
    let plain = tempfile::tempdir().unwrap();
    let p = plain.path();
    for f in [".drift/conventions.yaml", "drift.lock", "package.json"] {
        write(p, f, &std::fs::read_to_string(r.join(f)).unwrap());
    }
    let (code, _, err) = drift(p, &["check", "--diff-base", "main"], &[]);
    assert_eq!(code, 2, "{err}");
    assert!(err.contains("needs a git work tree"), "{err}");
}

#[test]
fn a_changed_file_whose_path_has_a_space() {
    let (dir, ids) = repo();
    let r = dir.path();
    only_the_diff_rules(r);
    write(r, "app/api/with space/route.ts", UNGUARDED);
    let (code, report) = commit_and_check(r);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["diff"]["base_checked"], false, "{report}");
    assert_eq!(
        new_in(&report),
        [t(&ids.auth, "app/api/with space/route.ts", "GET")]
    );
}

#[test]
fn an_added_line_starting_with_plus_plus_is_content() {
    let (dir, ids) = repo();
    let r = dir.path();
    only_the_diff_rules(r);
    // The first hunk adds `++ n;`, which the patch shows as `+++ n;`; the later
    // hunks unwrap the handler.
    write(
        r,
        "app/api/r05/route.ts",
        &format!("let n = 0;\n++ n;\n\n{UNGUARDED}"),
    );
    let (code, report) = commit_and_check(r);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["diff"]["base_checked"], false, "{report}");
    assert_eq!(
        new_in(&report),
        [t(&ids.auth, "app/api/r05/route.ts", "GET")]
    );
}

#[test]
fn a_rename_into_a_role_with_edits_away_from_the_declaration() {
    let (dir, ids) = repo();
    let r = dir.path();
    only_the_diff_rules(r);
    assert!(
        !drift(r, &["check"], &[]).1.contains("lib/legacy"),
        "outside the role on main"
    );
    git(r, &["mv", "lib/legacy", "app/api/moved"]);
    write(
        r,
        "app/api/moved/route.ts",
        &LEGACY.replace("const c = 3;", "const c = 4;"),
    );
    git(r, &["add", "-A"]);
    let status = git_out(r, &["diff", "--cached", "--name-status", "-M", "main"]);
    assert!(
        status
            .lines()
            .any(|l| l.starts_with('R') && l.ends_with("app/api/moved/route.ts")),
        "git sees a rename: {status}"
    );
    let (code, report) = commit_and_check(r);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["diff"]["base_checked"], false, "{report}");
    assert_eq!(
        new_in(&report),
        [t(&ids.auth, "app/api/moved/route.ts", "GET")]
    );
}

/// Changes that break untouched routes from another file: plain check fails, so PR
/// mode must too (main would go red on push). To tell the change's violations from
/// main's it compares with the merge base. The merge-base worktree is cleaned up.
///
/// S7 made a mined rule fewer than 75% of whose tellable members follow it stale, and a
/// stale rule advised; both changes then left the auth rule stale and every check passed.
/// Review fix v1, item 1: what a change breaks (violations not in `drift.lock`) counts as
/// following for staleness, and staleness never demotes such a violation. So:
/// - re-export the wrapper: every route breaks anew; the rule is not stale and blocks,
///   in the plain check and in PR mode, as before S7;
/// - delete the wrapper: every guarded route is "cannot tell" (the wrapper resolves to
///   no code Drift read), and unknown is never a violation, so the change reports
///   nothing; the plain check still fails on main's own unguarded route, which is not
///   in the lock, though the rule is stale on the lock's two legacy routes.
#[test]
fn cross_file_causes_compare_with_the_merge_base() {
    for case in ["delete the wrapper", "re-export the wrapper"] {
        let (dir, ids) = repo();
        let r = dir.path();
        match case {
            "delete the wrapper" => git(r, &["rm", "-q", "lib/auth.ts"]),
            _ => {
                write(
                    r,
                    "lib/auth-impl.ts",
                    "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
                );
                write(
                    r,
                    "lib/auth.ts",
                    "export { withAuth } from \"./auth-impl\";\n",
                );
            }
        }
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "pr"]);
        let (plain, out, _) = drift(r, &["check"], &[]);
        assert_eq!(plain, 1, "{case}: plain check fails: {out}");
        if case == "delete the wrapper" {
            assert!(
                out.contains("it is wrapped in withAuth, which does not resolve to code Drift read"),
                "{case}: {out}"
            );
            assert!(
                out.contains("a violation not in drift.lock still blocks"),
                "{case}: {out}"
            );
        } else {
            assert!(!out.contains("is stale"), "{case}: {out}");
        }
        let status = git_out(r, &["status", "--porcelain"]);
        let indexes = cache_indexes(r);
        let (code, out, err) = drift(
            r,
            &["check", "--diff-base", "main", "--format", "json"],
            &[],
        );
        let report = json(&out);
        assert_eq!(report["diff"]["base_checked"], true, "{case}");
        let new = new_in(&report);
        if case == "delete the wrapper" {
            // Every route is cannot-tell: nothing of the change's is reported.
            assert_eq!(code, 0, "{case}: {out}{err}");
            assert!(new.is_empty(), "{case}: {new:?}");
        } else {
            assert_eq!(code, 1, "{case}: {out}{err}");
            assert!(
                new.contains(&t(&ids.auth, "app/api/r00/route.ts", "GET")),
                "{case}: {new:?}"
            );
        }
        // What main already had is still not the pull request's.
        assert!(
            !new.contains(&t(&ids.auth, "app/api/old/route.ts", "GET")),
            "{case}: {new:?}"
        );
        // The temporary worktree is gone and the working tree untouched.
        // The merge base was checked out without registering a worktree, with its own
        // fact cache: nothing is left in .git or .drift/cache.
        let worktrees = git_out(r, &["worktree", "list", "--porcelain"]);
        assert_eq!(worktrees.matches("worktree ").count(), 1, "{worktrees}");
        assert!(!r.join(".git/worktrees").exists(), "{case}");
        assert_eq!(
            cache_indexes(r),
            indexes,
            "{case}: no index for a temporary root"
        );
        assert_eq!(git_out(r, &["status", "--porcelain"]), status, "{case}");
    }
}

/// A pull request that only edits the policy changes what every file must follow:
/// dropping a `drift.lock` entry makes that legacy route new and blocking, so PR
/// mode runs the full check.
#[test]
fn a_policy_change_checks_everything() {
    let (dir, ids) = repo();
    let r = dir.path();
    let lock = std::fs::read_to_string(r.join("drift.lock")).unwrap();
    assert!(lock.contains("app/api/r38/route.ts#GET"), "{lock}");
    let kept: String = lock
        .lines()
        .filter(|l| !l.contains("app/api/r38/route.ts#GET"))
        .map(|l| format!("{l}\n"))
        .collect();
    write(r, "drift.lock", &kept);
    let (code, report) = commit_and_check(r);
    assert_eq!(code, 1, "{report}");
    assert_eq!(report["diff"]["policy_changed"], true, "{report}");
    let new = new_in(&report);
    assert!(
        new.contains(&t(&ids.auth, "app/api/r38/route.ts", "GET")),
        "{new:?}"
    );
    assert_eq!(report["diff"]["new_outside_diff"], 0, "{report}");
    let (_, text, _) = drift(r, &["check", "--diff-base", "main"], &[]);
    assert!(
        text.contains("the policy changed, so every new violation is reported"),
        "{text}"
    );
}

/// `check --format json` gains a `conventions` array (tier and effective mode per policy
/// convention), after the report's own fields: the bytes before it are the old output.
#[test]
fn check_json_lists_policy_conventions_after_the_report() {
    let (dir, ids) = repo();
    let r = dir.path();
    let (_, out, err) = drift(r, &["check", "--format", "json"], &[]);
    let v = json(&out);
    let cut = out
        .find(",\n  \"conventions\": [")
        .unwrap_or_else(|| panic!("{out}{err}"));
    assert!(out.starts_with("{\n  \"violations\": ["), "{out}");
    assert!(out.find("\n  \"fixed\": ").unwrap() < cut, "{out}");
    // Without the new key, the output is exactly the report as it was serialised before.
    let old: Value = serde_json::from_str(&format!("{}\n}}", &out[..cut])).unwrap();
    let mut without = v.clone();
    without.as_object_mut().unwrap().remove("conventions");
    assert_eq!(old, without);
    // `exempt` is #45's (here `src/lib/log.ts#logLine`, a shared part of its role, #52).
    // `standing` is S7's (`CheckReport::standing`: per accepted mined rule, what the
    // check read of its members), serialised with the report, before `conventions`.
    assert_eq!(
        old.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["violations", "fixed", "exempt", "standing"]
    );
    assert!(
        old["exempt"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["symbol"] == "logLine" && e["code"] == "shared_part"),
        "{old}"
    );
    let conv = |id: &str| {
        v["conventions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == id)
            .unwrap_or_else(|| panic!("{id} in {v}"))
            .clone()
    };
    let auth = conv(&ids.auth);
    assert_eq!(
        (
            &auth["status"],
            &auth["mode"],
            &auth["effective_mode"],
            &auth["tier"]
        ),
        (
            &Value::from("accepted"),
            &Value::from("block"),
            &Value::from("block"),
            &Value::from("default")
        ),
        "{auth}"
    );
    let log = conv(&ids.log);
    assert_eq!(log["tier"], "suggestion", "{log}");
    assert_eq!(log["effective_mode"], "advise", "{log}");
    assert_eq!(log["rule_kind"], "passes_key", "{log}");
    // Diff mode carries it too.
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "pr", "--allow-empty"]);
    let (_, out, _) = drift(
        r,
        &["check", "--diff-base", "main", "--format", "json"],
        &[],
    );
    let d = json(&out);
    assert!(d["diff"].is_object(), "{d}");
    assert_eq!(d["conventions"], v["conventions"]);
}
