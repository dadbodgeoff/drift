//! Workspace-aware Drift on synthetic monorepos (every name is invented): one `drift
//! init` at the root of a multi-package repository mines each package as its own root
//! would, writes one scoped policy, and every surface (check, PR mode, the hooks, MCP)
//! resolves a touched file's package from any working directory in the repository.
//!
//! Fixtures:
//! - `polyglot`: no manifest at the root; a Next app in `frontend/` (an app nested
//!   without a workspace manifest), three FastAPI services in `backend/services/*` with
//!   the same router layout and a shared Python package in `backend/packages/common`.
//! - `polyglot` with `uv`: the same, with a root `[tool.uv.workspace]`.
//! - `pnpm`: a pnpm workspace (`apps/*`, `packages/*`).

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

/// Runs with the experimental intra-package layering on (`DRIFT_EXPERIMENTAL`): most
/// fixtures exercise the surfaces with its cards. [`run_default`] runs without it.
fn run_in(cwd: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String, String) {
    run_with(cwd, args, stdin, true)
}

fn run_default(cwd: &Path, args: &[&str]) -> (i32, String, String) {
    run_with(cwd, args, None, false)
}

fn run_with(
    cwd: &Path,
    args: &[&str],
    stdin: Option<&str>,
    layering: bool,
) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    if layering {
        cmd.env("DRIFT_EXPERIMENTAL", "intra_package_layering");
    } else {
        cmd.env_remove("DRIFT_EXPERIMENTAL");
    }
    let mut child = cmd
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env_remove("DRIFT_CACHE_DIR")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(s) = stdin {
        child.stdin.take().unwrap().write_all(s.as_bytes()).unwrap();
    } else {
        drop(child.stdin.take());
    }
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn ok(cwd: &Path, args: &[&str]) -> String {
    let (code, out, err) = run_in(cwd, args, None);
    assert!(
        code == 0 || code == 1,
        "drift {args:?} failed ({code}): {err}"
    );
    out
}

fn census(cwd: &Path, extra: &[&str]) -> Value {
    let mut args = vec!["census", "--json", "--max", "50"];
    args.extend_from_slice(extra);
    serde_json::from_str(&ok(cwd, &args)).unwrap()
}

/// The Next app: 80 `lib/` helpers of which one imports `app/dash/state.ts` (a layering
/// inversion), 30 `app/dash` views importing `lib/`, and 40 route handlers of which 38
/// are wrapped in `withSession`.
fn next_app(r: &Path, at: &str, name: &str) {
    write(
        r,
        &format!("{at}/package.json"),
        &format!(
            "{{\"name\":\"{name}\",\"private\":true,\"dependencies\":{{\"next\":\"14.2.0\"}}}}\n"
        ),
    );
    write(
        r,
        &format!("{at}/tsconfig.json"),
        "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@/*\":[\"./*\"]}}}\n",
    );
    write(
        r,
        &format!("{at}/lib/auth.ts"),
        "export function withSession<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 1..=80 {
        let body = if i == 31 {
            "import { panelState } from \"@/app/dash/state\";\nexport function helper31(): string {\n  return String(panelState);\n}\n".to_string()
        } else {
            format!("export function helper{i}(x: number): number {{\n  return x + {i};\n}}\n")
        };
        write(r, &format!("{at}/lib/util{i}.ts"), &body);
    }
    write(
        r,
        &format!("{at}/app/dash/state.ts"),
        "export const panelState = 1;\n",
    );
    for i in 1..=30 {
        write(
            r,
            &format!("{at}/app/dash/view{i}.ts"),
            &format!(
                "import {{ helper{i} }} from \"@/lib/util{i}\";\nexport function view{i}(): number {{\n  return helper{i}(1);\n}}\n"
            ),
        );
    }
    for i in 0..40 {
        let body = if i < 38 {
            "import { withSession } from \"@/lib/auth\";\n\nexport const GET = withSession(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n"
        } else {
            "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n"
        };
        write(r, &format!("{at}/app/api/r{i:02}/route.ts"), body);
    }
}

const SERVICES: [&str; 3] = ["billing", "catalog", "notify"];

/// Next frontend + 3 FastAPI services (12 routers each, 11 depending on the shared
/// `current_user`) + the shared package; with `uv`, a root uv workspace.
fn polyglot(uv: bool) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "frontend", "lumen-web");
    write(
        r,
        "frontend/next-env.d.ts",
        "/// <reference types=\"next\" />\n",
    );
    write(
        r,
        "backend/packages/common/pyproject.toml",
        "[project]\nname = \"orbit-common\"\nversion = \"0.1.0\"\n[build-system]\nrequires = [\"setuptools\"]\nbuild-backend = \"setuptools.build_meta\"\n[tool.setuptools.packages.find]\nwhere = [\"src\"]\n",
    );
    write(
        r,
        "backend/packages/common/src/orbit_common/__init__.py",
        "",
    );
    write(
        r,
        "backend/packages/common/src/orbit_common/auth.py",
        "def current_user():\n    return {\"id\": 1}\n",
    );
    for svc in SERVICES {
        write(
            r,
            &format!("backend/services/{svc}/pyproject.toml"),
            &format!(
                "[project]\nname = \"orbit-{svc}\"\nversion = \"0.1.0\"\ndependencies = [\"fastapi\", \"orbit-common\"]\n"
            ),
        );
        write(r, &format!("backend/services/{svc}/app/__init__.py"), "");
        write(
            r,
            &format!("backend/services/{svc}/app/routers/__init__.py"),
            "",
        );
        for i in 0..10 {
            write(
                r,
                &format!("backend/services/{svc}/app/services/s{i:02}.py"),
                &format!("def compute_{svc}_{i}(x):\n    return x + {i}\n"),
            );
        }
        for i in 0..12 {
            let dep = if i < 11 {
                "user=Depends(current_user)"
            } else {
                ""
            };
            write(
                r,
                &format!("backend/services/{svc}/app/routers/r{i:02}.py"),
                &format!(
                    "from fastapi import APIRouter, Depends\nfrom orbit_common.auth import current_user\n\nrouter = APIRouter()\n\n\n@router.get(\"/{svc}/{i}\")\ndef read_{svc}_{i}({dep}):\n    return {{\"n\": {i}}}\n"
                ),
            );
        }
    }
    if uv {
        write(
            r,
            "pyproject.toml",
            "[project]\nname = \"orbit\"\nversion = \"0.1.0\"\n[tool.uv.workspace]\nmembers = [\"backend/services/*\", \"backend/packages/*\"]\n",
        );
    }
    dir
}

/// A pnpm workspace: two Next apps and a UI package.
fn pnpm() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{\"name\":\"zephyr\",\"private\":true}\n",
    );
    write(
        r,
        "pnpm-workspace.yaml",
        "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n",
    );
    next_app(r, "apps/web", "@zephyr/web");
    next_app(r, "apps/admin", "@zephyr/admin");
    write(r, "packages/ui/package.json", "{\"name\":\"@zephyr/ui\"}\n");
    for i in 0..4 {
        write(
            r,
            &format!("packages/ui/src/c{i}.tsx"),
            &format!("export function C{i}() {{\n  return null;\n}}\n"),
        );
    }
    dir
}

/// The packages of the census's workspace report, by path.
fn report(c: &Value) -> Vec<Value> {
    c["workspace"]["packages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn row<'a>(rows: &'a [Value], path: &str) -> &'a Value {
    rows.iter()
        .find(|p| p["path"] == path)
        .unwrap_or_else(|| panic!("package {path} in {rows:?}"))
}

/// A card as one package's own root would see it: role and rule with the package
/// prefix taken off, and the evidence.
fn shape(p: &Value, package: &str) -> String {
    let strip = |s: &str| {
        if package.is_empty() {
            return s.to_string();
        }
        s.replace(&format!("{package}/"), "")
            .replace(&format!("\"package\":\"{package}\""), "\"package\":\"\"")
    };
    let mut role = p["role"].clone();
    role.as_object_mut().unwrap().remove("members");
    // Not the lift: it is counted against the repository's units, as it always was.
    format!(
        "{} {} {}/{}",
        strip(&role.to_string()),
        strip(&p["rule"].to_string()),
        p["evidence"]["holders"],
        p["evidence"]["total"]
    )
}

fn shapes_in(c: &Value, package: &str) -> Vec<String> {
    let mut v: Vec<String> = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["role"]["package"] == package && p["role"].get("also").is_none())
        .map(|p| shape(p, package))
        .collect();
    v.sort();
    v
}

#[test]
fn root_census_is_the_union_of_the_package_censuses() {
    for uv in [false, true] {
        let dir = polyglot(uv);
        let r = dir.path();
        let root = census(r, &[]);
        let mut packages: Vec<String> = report(&root)
            .iter()
            .map(|p| p["path"].as_str().unwrap().to_string())
            .collect();
        packages.retain(|p| !p.is_empty());
        assert_eq!(
            packages,
            [
                "backend/packages/common",
                "backend/services/billing",
                "backend/services/catalog",
                "backend/services/notify",
                "frontend"
            ]
        );
        for pkg in &packages {
            let alone = census(r, &["--root", pkg]);
            let mut want = shapes_in(&alone, "");
            want.sort();
            assert_eq!(shapes_in(&root, pkg), want, "package {pkg} (uv: {uv})");
        }
        // The app's intra-package layering is mined from the root (pilot G1: F11 gave
        // nothing here and a layering card with `--root frontend`).
        assert!(
            shapes_in(&root, "frontend")
                .iter()
                .any(|s| s.contains("import:app/dash")),
            "{:?}",
            shapes_in(&root, "frontend")
        );
    }
}

#[test]
fn sibling_services_pool_into_one_convention() {
    let dir = polyglot(false);
    let r = dir.path();
    let c = census(r, &["--python-proposals"]);
    let pooled: Vec<&Value> = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["role"].get("also").is_some())
        .collect();
    assert_eq!(pooled.len(), 1, "{pooled:?}");
    let p = pooled[0];
    let parts: Vec<&str> = std::iter::once(p["role"]["package"].as_str().unwrap())
        .chain(
            p["role"]["also"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a["package"].as_str().unwrap()),
        )
        .collect();
    assert_eq!(
        parts,
        SERVICES.map(|s| format!("backend/services/{s}")).to_vec()
    );
    assert_eq!(p["evidence"]["holders"], 33);
    assert_eq!(p["evidence"]["total"], 36);
    assert_eq!(p["tier"], "suggestion");
    let summary = p["summary"].as_str().unwrap();
    assert!(
        summary.contains(
            "of backend/services/billing, backend/services/catalog and backend/services/notify"
        ),
        "{summary}"
    );
    // No service is big enough alone: each package's own census has no card.
    for s in SERVICES {
        let alone = census(
            r,
            &[
                "--root",
                &format!("backend/services/{s}"),
                "--python-proposals",
            ],
        );
        assert_eq!(alone["proposals"].as_array().unwrap().len(), 0, "{s}");
    }
}

#[test]
fn census_reports_each_package_and_why_it_is_silent() {
    let dir = polyglot(true);
    let r = dir.path();
    let c = census(r, &[]);
    let rows = report(&c);
    let front = row(&rows, "frontend");
    assert_eq!(front["languages"], json!(["ts"]));
    assert!(front["cards"].as_u64().unwrap() >= 2, "{front}");
    assert!(front["silent"].is_null());
    let common = row(&rows, "backend/packages/common");
    assert_eq!(common["declared_by"], json!(["uv workspace"]));
    assert!(
        common["silent"]
            .as_str()
            .unwrap()
            .starts_with("too small to mine"),
        "{common}"
    );
    // Python proposals on (the default): the services' pooled card covers each.
    let billing = row(&rows, "backend/services/billing");
    assert_eq!(billing["languages"], json!(["py"]));
    assert_eq!(billing["cards"], 1, "{billing}");
    // Skipped files stay in their package's row, by reason.
    assert_eq!(front["skipped"], json!({ "declaration": 1 }), "{front}");
    // Off (a person's `proposals: {python: off}`): silent, and why.
    write(r, ".drift/config.yaml", "proposals: {python: off}\n");
    let off = report(&census(r, &[]));
    let billing = row(&off, "backend/services/billing");
    assert!(
        billing["silent"].as_str().unwrap().contains(
            "Python proposals are off (`proposals: {python: off}` in .drift/config.yaml)"
        ),
        "{billing}"
    );
    std::fs::remove_file(r.join(".drift/config.yaml")).unwrap();
    assert_eq!(c["workspace"]["tools"], json!(["uv"]));
    // The text census lists them too.
    let text = ok(r, &["census"]);
    assert!(text.contains("Packages (6):"), "{text}");
    assert!(text.contains("backend/packages/common  [py, 2 files, 0 roles]  silent: too small"));

    let p = pnpm();
    let c = census(p.path(), &[]);
    let rows = report(&c);
    assert_eq!(c["workspace"]["tools"], json!(["pnpm"]));
    assert_eq!(
        row(&rows, "apps/web")["declared_by"],
        json!(["pnpm-workspace.yaml"])
    );
    assert_eq!(
        row(&rows, "packages/ui")["declared_by"],
        json!(["pnpm-workspace.yaml"])
    );
    assert!(row(&rows, "packages/ui")["silent"].is_string());
    for app in ["apps/web", "apps/admin"] {
        assert!(row(&rows, app)["cards"].as_u64().unwrap() >= 2, "{app}");
    }
}

#[test]
fn single_package_repositories_are_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, ".", "solo");
    let c = census(r, &[]);
    assert!(c.get("workspace").is_none(), "no per-package report");
    ok(r, &["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains("\nversion: 1\n"), "{yaml}");
    assert!(!yaml.contains("\npackages:"), "{yaml}");
    let text = ok(r, &["census"]);
    assert!(!text.contains("Packages ("), "{text}");
}

#[test]
fn packages_config_overrides_discovery() {
    let dir = polyglot(false);
    let r = dir.path();
    write(
        r,
        ".drift/config.yaml",
        "packages:\n  exclude: [backend/services/notify]\n",
    );
    let rows = report(&census(r, &[]));
    assert!(
        rows.iter().all(|p| p["path"] != "backend/services/notify"),
        "{rows:?}"
    );
    // Explicit roots: the whole backend is one package.
    write(
        r,
        ".drift/config.yaml",
        "packages:\n  roots: [frontend, backend]\n",
    );
    let paths: Vec<Value> = report(&census(r, &[]))
        .iter()
        .map(|p| p["path"].clone())
        .collect();
    assert_eq!(paths, [json!("backend"), json!("frontend")]);
    // A setting Drift cannot read is a warning, and changes nothing.
    write(r, ".drift/config.yaml", "packages:\n  roots: frontend\n");
    let (_, _, err) = run_in(r, &["census", "--json"], None);
    assert!(err.contains("packages.roots"), "{err}");
}

/// The polyglot repository with one `drift init` at the root and the app's layering
/// card accepted in block mode; its id.
fn initialised() -> (tempfile::TempDir, String) {
    let dir = polyglot(true);
    let r = dir.path();
    ok(r, &["init"]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(yaml.contains("\nversion: 2\n"), "{yaml}");
    assert!(yaml.contains("\npackages:\n"), "{yaml}");
    assert!(yaml.contains("- frontend\n"), "{yaml}");
    let c = census(r, &[]);
    let id = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["signal"] == "import:frontend/app/dash")
        .map(|p| p["id"].as_str().unwrap().to_string())
        .expect("layering card");
    ok(r, &["review", "--block", &id]);
    (dir, id)
}

const BAD: &str = "import { panelState } from \"@/app/dash/state\";\nexport function helper99(): number {\n  return panelState;\n}\n";

#[test]
fn check_resolves_the_package_from_any_directory() {
    let (dir, id) = initialised();
    let r = dir.path();
    write(r, "frontend/lib/util99.ts", BAD);
    // From the root, the package and a folder inside it, with paths as each sees them.
    for (cwd, file) in [
        (r.to_path_buf(), "frontend/lib/util99.ts"),
        (r.join("frontend"), "lib/util99.ts"),
        (r.join("frontend/lib"), "util99.ts"),
    ] {
        let (code, out, err) = run_in(&cwd, &["check", file], None);
        assert_eq!(code, 1, "{out}{err}");
        assert!(
            out.contains(&id) && out.contains("frontend/lib/util99.ts"),
            "{out}"
        );
        let (code, out, _) = run_in(&cwd, &["check", "--format", "github"], None);
        assert_eq!(code, 1);
        assert!(out.contains("file=frontend/lib/util99.ts"), "{out}");
    }
}

#[test]
fn github_and_sarif_paths_are_from_the_git_top_level() {
    // A per-package policy (`--root frontend`): annotations still name files as the
    // repository does (pilot G1, third effect).
    let dir = polyglot(false);
    let r = dir.path();
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(r)
            .output()
            .unwrap()
    };
    git(&["init", "-q", "."]);
    ok(r, &["--root", "frontend", "init"]);
    let c = census(&r.join("frontend"), &[]);
    let id = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["signal"] == "import:app/dash")
        .map(|p| p["id"].as_str().unwrap().to_string())
        .unwrap();
    ok(r, &["--root", "frontend", "review", "--block", &id]);
    write(r, "frontend/lib/util99.ts", BAD);
    let (_, out, _) = run_in(
        r,
        &["--root", "frontend", "check", "--format", "github"],
        None,
    );
    assert!(out.contains("file=frontend/lib/util99.ts"), "{out}");
    let (_, out, _) = run_in(
        r,
        &["--root", "frontend", "check", "--format", "sarif"],
        None,
    );
    let sarif: Value = serde_json::from_str(&out).unwrap();
    let uris: Vec<&str> = sarif["runs"][0]["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            x["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
                .as_str()
                .unwrap()
        })
        .collect();
    assert!(uris.contains(&"frontend/lib/util99.ts"), "{uris:?}");
    // Text keeps the run's own paths.
    let (_, out, _) = run_in(r, &["--root", "frontend", "check"], None);
    assert!(
        out.contains("lib/util99.ts") && !out.contains("frontend/lib/util99.ts"),
        "{out}"
    );
}

#[test]
fn pr_mode_resolves_the_package_from_a_subdirectory() {
    let (dir, id) = initialised();
    let r = dir.path();
    let git = |args: &[&str]| {
        let o = Command::new("git")
            .args(["-c", "user.email=t@x", "-c", "user.name=t"])
            .args(args)
            .current_dir(r)
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    };
    git(&["init", "-q", "."]);
    git(&["add", "-A"]);
    git(&["commit", "-qm", "base"]);
    write(r, "frontend/lib/util99.ts", BAD);
    let (code, out, err) = run_in(
        &r.join("frontend/app"),
        &["check", "--diff-base", "HEAD", "--format", "github"],
        None,
    );
    assert_eq!(code, 1, "{out}{err}");
    assert!(
        out.contains(&id) && out.contains("file=frontend/lib/util99.ts"),
        "{out}"
    );
}

fn hook_in(cwd: &Path, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": "s1", "cwd": cwd, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out, err) = run_in(cwd, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, 0, "hooks always exit 0: {err}");
    if out.trim().is_empty() {
        eprintln!("{event} in {}: no output; stderr: {err}", cwd.display());
    }
    (!out.trim().is_empty()).then(|| serde_json::from_str(&out).unwrap())
}

#[test]
fn hooks_resolve_the_package_from_any_directory() {
    let (dir, id) = initialised();
    let r = dir.path();
    for cwd in [
        r.to_path_buf(),
        r.join("frontend"),
        r.join("frontend/app/dash"),
    ] {
        let _ = std::fs::remove_dir_all(r.join(".drift/cache/sessions"));
        let start = hook_in(&cwd, "SessionStart", json!({ "source": "startup" }))
            .expect("SessionStart speaks: an accepted convention");
        assert!(start.to_string().contains("drift"), "{start}");
        // Before a new file: its rules, naming its package.
        let target = r.join("frontend/lib/util98.ts");
        let pre = hook_in(
            &cwd,
            "PreToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": target, "content": BAD } }),
        )
        .expect("rules for a new lib file");
        let ctx = pre["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap();
        assert!(
            ctx.contains("in package frontend") && ctx.contains(&id),
            "{ctx}"
        );
        // After it: the violation, naming its package.
        write(r, "frontend/lib/util98.ts", BAD);
        let post = hook_in(
            &cwd,
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": target } }),
        )
        .expect("advice after the edit");
        let ctx = post["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap();
        assert!(
            ctx.contains("is in package frontend") && ctx.contains(&id),
            "{ctx}"
        );
        let stop = hook_in(&cwd, "Stop", json!({ "stop_hook_active": false })).unwrap();
        assert_eq!(stop["decision"], "block", "{stop}");
        std::fs::remove_file(r.join("frontend/lib/util98.ts")).unwrap();
    }
    // A Python file of a service is not given the app's rules.
    let pre = hook_in(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": r.join("backend/services/billing/app/lib/x.py"), "content": "def f():\n    return 1\n" } }),
    );
    assert!(
        pre.as_ref().is_none_or(|v| !v.to_string().contains(&id)),
        "{pre:?}"
    );
}

#[test]
fn hooks_find_a_package_policy_from_the_edited_file() {
    // A policy only in `frontend/.drift` (the per-package workaround), the session at
    // the repository root: the hooks follow the edited file (pilot G1, second effect).
    let dir = polyglot(false);
    let r = dir.path();
    ok(r, &["--root", "frontend", "init"]);
    let c = census(&r.join("frontend"), &[]);
    let id = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["rule"]["signal"] == "import:app/dash")
        .map(|p| p["id"].as_str().unwrap().to_string())
        .unwrap();
    ok(r, &["--root", "frontend", "review", "--accept", &id]);
    let target = r.join("frontend/lib/util97.ts");
    let pre = hook_in(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": target, "content": BAD } }),
    );
    assert!(
        pre.is_some(),
        "the frontend policy speaks for a frontend file"
    );
    // A relative path resolves against the session's directory (a fresh session: rules
    // are primed once per session).
    std::fs::remove_dir_all(r.join("frontend/.drift/cache/sessions")).unwrap();
    let pre = hook_in(
        r,
        "PreToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": "frontend/lib/util96.ts", "content": BAD } }),
    );
    assert!(pre.is_some());
}

fn mcp(cwd: &Path, root: Option<&Path>, calls: &[Value]) -> Vec<Value> {
    let input: String = calls.iter().map(|m| format!("{m}\n")).collect();
    let mut args = vec![];
    let root_s;
    if let Some(p) = root {
        root_s = p.to_string_lossy().into_owned();
        args.extend(["--root", root_s.as_str()]);
    }
    args.push("mcp");
    let (code, out, err) = run_in(cwd, &args, Some(&input));
    assert_eq!(code, 0, "{err}");
    out.lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn tool(name: &str, args: Value) -> Value {
    json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}})
}

#[test]
fn mcp_resolves_the_package_from_any_directory() {
    let (dir, id) = initialised();
    let r = dir.path();
    write(r, "frontend/lib/util99.ts", BAD);
    for (cwd, path) in [
        (r.to_path_buf(), "frontend/lib/util99.ts"),
        (r.join("frontend"), "lib/util99.ts"),
        (r.join("frontend/app/dash"), "../../lib/util99.ts"),
    ] {
        let replies = mcp(
            &cwd,
            None,
            &[
                tool("drift_rules_for", json!({ "path": path })),
                tool("drift_check", json!({ "paths": [path] })),
            ],
        );
        let rules = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            rules.contains("is in package frontend") && rules.contains(&id),
            "{cwd:?}: {rules}"
        );
        let check = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(check.contains(&id), "{cwd:?}: {check}");
    }
}

#[test]
fn python_namespace_split_across_distributions_resolves() {
    // Pilot G2: `pkgs/gamma` ships `acme/__init__.py`, the others are portions.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for d in ["alpha", "beta", "gamma"] {
        write(
            r,
            &format!("pkgs/{d}/pyproject.toml"),
            &format!("[project]\nname = \"acme-{d}\"\nversion = \"0.1\"\n"),
        );
        write(r, &format!("pkgs/{d}/acme/{d}/__init__.py"), "");
    }
    write(r, "pkgs/gamma/acme/__init__.py", "");
    write(
        r,
        "pkgs/alpha/acme/alpha/core.py",
        "def make():\n    return 1\n",
    );
    write(
        r,
        "pkgs/beta/acme/beta/use.py",
        "from acme.alpha.core import make\n\ndef run():\n    return make()\n",
    );
    let imports = scanned_imports(r, "pkgs/beta/acme/beta/use.py");
    assert!(
        imports.contains("\"pkgs/alpha/acme/alpha/core.py\""),
        "{imports}"
    );
}

#[test]
fn a_folder_named_like_a_declared_dependency_does_not_capture_it() {
    // Pilot G6: a migrations folder without `__init__.py` named after its library.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1\"\ndependencies = [\"migrate\"]\n",
    );
    write(
        r,
        "svc/migrate/versions/v1.py",
        "from migrate import op\n\ndef upgrade():\n    op.run()\n",
    );
    write(
        r,
        "svc/migrate/env.py",
        "from migrate import context\nfrom migrate.config import Config\n",
    );
    write(r, "svc/app/main.py", "import requests\n");
    let imports = scanned_imports(r, "svc/migrate/env.py");
    assert!(
        imports.contains("\"pkg:migrate\"") && imports.contains("\"pkg:migrate.config\""),
        "{imports}"
    );
    // Without the declaration the folder is the namespace package, as before.
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1\"\n",
    );
    assert!(scanned_imports(r, "svc/migrate/env.py").contains("\"svc/migrate\""));
}

/// The imports of `rel` in a full scan (what mining and `check` read).
fn scanned_imports(r: &Path, rel: &str) -> String {
    let facts: Value = serde_json::from_str(&ok(r, &["--no-cache", "scan", "--json"])).unwrap();
    facts["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == rel)
        .map(|f| f["imports"].to_string())
        .unwrap_or_default()
}

#[test]
fn pooling_never_makes_a_card_that_may_block() {
    // Three small Next apps whose routes use the workspace's shared `withAuth`: pooled,
    // 29 of 30 handlers follow it, which alone would be a default-tier call wrapper.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{\"name\":\"zephyr\",\"private\":true}\n",
    );
    write(
        r,
        "pnpm-workspace.yaml",
        "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n",
    );
    write(
        r,
        "packages/auth/package.json",
        "{\"name\":\"@zephyr/auth\"}\n",
    );
    write(
        r,
        "packages/auth/src/index.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for app in ["a", "b", "c"] {
        write(
            r,
            &format!("apps/{app}/package.json"),
            &format!("{{\"name\":\"@zephyr/{app}\"}}\n"),
        );
        for i in 0..20 {
            write(
                r,
                &format!("apps/{app}/lib/h{i:02}.ts"),
                &format!("export function h{i}(x: number): number {{\n  return x + {i};\n}}\n"),
            );
        }
        for i in 0..10 {
            let body = if app == "c" && i == 9 {
                "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n".to_string()
            } else {
                "import { withAuth } from \"../../../../../packages/auth/src/index\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n".to_string()
            };
            write(r, &format!("apps/{app}/app/api/r{i:02}/route.ts"), &body);
        }
    }
    let c = census(r, &[]);
    let pooled: Vec<&Value> = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["role"].get("also").is_some())
        .collect();
    assert!(pooled.is_empty(), "{pooled:?}");
}

/// The full scan's facts of `rel`.
fn scanned_file(r: &Path, rel: &str) -> Option<Value> {
    let facts: Value = serde_json::from_str(&ok(r, &["--no-cache", "scan", "--json"])).unwrap();
    facts["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == rel)
        .cloned()
}

#[test]
fn a_python_package_named_coverage_is_analysed_but_a_coverage_report_is_not() {
    // Pilot gap (f): `coverage/` was excluded whatever it held.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1\"\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(r, "svc/app/coverage/__init__.py", "");
    write(
        r,
        "svc/app/coverage/calc.py",
        "def ratio(a, b):\n    return a / b\n",
    );
    write(
        r,
        "svc/app/use.py",
        "from app.coverage.calc import ratio\n\ndef run():\n    return ratio(1, 2)\n",
    );
    // A report: no `__init__.py`, generated files.
    write(r, "coverage/index.html", "<html></html>\n");
    write(
        r,
        "coverage/prettify.js",
        "export function p() {\n  return 1;\n}\n",
    );
    write(r, "coverage/report_helper.py", "def h():\n    return 1\n");
    assert!(scanned_file(r, "svc/app/coverage/calc.py").is_some());
    assert!(scanned_file(r, "coverage/prettify.js").is_none());
    assert!(scanned_file(r, "coverage/report_helper.py").is_none());
    let imports = scanned_imports(r, "svc/app/use.py");
    assert!(
        imports.contains("\"svc/app/coverage/calc.py\""),
        "{imports}"
    );
}

#[test]
fn fastapi_routes_in_an_app_factory_are_entry_points() {
    // Pilot gap (g): a route defined inside `create_app()`.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/pyproject.toml",
        "[project]\nname = \"svc\"\nversion = \"0.1\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "svc/app/__init__.py", "");
    write(
        r,
        "svc/app/main.py",
        "from fastapi import Depends, FastAPI\n\n\ndef current_user():\n    return 1\n\n\ndef create_app():\n    app = FastAPI()\n\n    @app.get(\"/health\")\n    def health(user=Depends(current_user)):\n        return {\"ok\": True}\n\n    def helper():\n        return 2\n\n    return app\n",
    );
    let f = scanned_file(r, "svc/app/main.py").unwrap();
    let eps = f["entry_points"].as_array().unwrap();
    assert!(
        eps.iter().any(|e| e["symbol"] == "health"
            && e["kind"] == "http"
            && e["route"] == "/health"
            && e["adapter"] == "fastapi"),
        "{eps:?}"
    );
    let names: Vec<&str> = f["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&"health") && !names.contains(&"helper"),
        "{names:?}"
    );
    let health = f["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "health")
        .unwrap();
    assert!(
        health["wraps"].to_string().contains("current_user"),
        "{health}"
    );
}

#[test]
fn intra_package_layering_is_experimental_and_off_by_default() {
    // Not admitted under the fold rule: without the flag, imports inside one package are
    // no layer edge (F11's behaviour); `experimental: [intra_package_layering]` turns it on.
    let dir = polyglot(false);
    let r = dir.path();
    let layering = |c: &Value| {
        c["proposals"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["rule"]["signal"] == "import:frontend/app/dash")
    };
    let census_default = |r: &Path| -> Value {
        let (code, out, err) = run_default(r, &["census", "--json", "--max", "50"]);
        assert_eq!(code, 0, "{err}");
        serde_json::from_str(&out).unwrap()
    };
    let off = census_default(r);
    assert!(!layering(&off), "off by default");
    // The rest of the workspace work stays on: the per-package report.
    assert!(off.get("workspace").is_some());
    write(
        r,
        ".drift/config.yaml",
        "experimental: [intra_package_layering]\n",
    );
    let (_, _, err) = run_default(r, &["census", "--json"]);
    assert!(!err.contains("unknown experimental feature"), "{err}");
    assert!(layering(&census_default(r)), "on with the flag");
}
