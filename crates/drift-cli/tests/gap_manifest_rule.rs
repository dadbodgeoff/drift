//! The manifest rule from the map (`from_map: manifest`, `Rule::ImportsDeclared`): code in
//! a workspace package imports only the packages its own `package.json` declares. On a
//! pnpm-style monorepo with a phantom dependency (`lodash`, declared by the root only),
//! a devDependency used in source and in a test, a type-only import satisfied by its
//! `@types/` package, a Node built-in, a subpath import, a `paths` alias and a workspace
//! package by name: what is proposed and counted, that nothing is checked or recorded
//! until a person accepts it, that accepting records today's break, and that a new
//! phantom import fails `drift check` once the person sets the rule to block. Every name
//! is invented.

use std::path::Path;
use std::process::{Command, Output, Stdio};

use drift_mine::mine::Rule;
use drift_mine::policy::{CONVENTIONS_FILE, Convention, ConventionsFile, LOCK_FILE, Mode, Status};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
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
        .stdin(Stdio::null())
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap()
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = run(root, args);
    let (stdout, stderr) = (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    );
    assert!(out.status.success(), "{args:?} failed:\n{stdout}\n{stderr}");
    stdout
}

fn read(r: &Path, rel: &str) -> String {
    std::fs::read_to_string(r.join(rel)).unwrap_or_default()
}

/// The source files of `apps/web`: each imports `next` (declared), a Node built-in, the
/// `@/` alias into its own package, the workspace package `@acme/ui` (declared with
/// `workspace:*`), a subpath of `zod` (declared), types of `express` (only
/// `@types/express` is declared, as a devDependency) and `msw` (a devDependency, used in
/// source).
const WEB_FILE: &str = "import Link from \"next/link\";\nimport { readFileSync } from \"node:fs\";\nimport path from \"path\";\nimport { util } from \"@/lib/util\";\nimport { Button } from \"@acme/ui\";\nimport { z } from \"zod/v4\";\nimport type { Request } from \"express\";\nimport { http } from \"msw\";\n\nexport function page(req: Request) {\n  return [Link, readFileSync, path, util, Button, z, http, req];\n}\n";

/// The phantom dependency: `lodash` is declared by the root `package.json` only.
const PHANTOM: &str = "import { chunk } from \"lodash\";\n\nexport function pages(xs: number[]) {\n  return chunk(xs, 2);\n}\n";

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"acme\", \"private\": true, \"devDependencies\": { \"lodash\": \"4.17.21\", \"vitest\": \"1.6.0\", \"typescript\": \"5.4.5\" } }",
    );
    write(
        r,
        "pnpm-workspace.yaml",
        "packages:\n  - apps/*\n  - packages/*\n",
    );
    write(
        r,
        "packages/ui/package.json",
        "{ \"name\": \"@acme/ui\", \"main\": \"src/index.ts\", \"dependencies\": { \"react\": \"18.3.1\" } }",
    );
    write(
        r,
        "packages/ui/src/index.ts",
        "export { Button } from \"./button\";\n",
    );
    write(
        r,
        "packages/ui/src/button.tsx",
        "import * as React from \"react\";\n\nexport function Button() {\n  return React.createElement(\"button\");\n}\n",
    );
    write(
        r,
        "apps/web/package.json",
        "{ \"name\": \"@acme/web\", \"dependencies\": { \"@acme/ui\": \"workspace:*\", \"next\": \"14.2.3\", \"zod\": \"3.23.8\" }, \"devDependencies\": { \"@types/express\": \"4.17.21\", \"msw\": \"2.3.0\" } }",
    );
    write(
        r,
        "apps/web/tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./src/*\"] } } }",
    );
    write(r, "apps/web/src/lib/util.ts", "export const util = 1;\n");
    for i in 0..20 {
        write(r, &format!("apps/web/src/pages/p{i:02}.ts"), WEB_FILE);
    }
    write(r, "apps/web/src/phantom.ts", PHANTOM);
    // A test file: `vitest` is declared by the root only, `msw` by the package. Test
    // files are not members of the rule's role, so neither is checked.
    write(
        r,
        "apps/web/src/pages/p00.test.ts",
        "import { test } from \"vitest\";\nimport { http } from \"msw\";\nimport { page } from \"./p00\";\n\ntest(\"page\", () => { page(http as never); });\n",
    );
    dir
}

fn policy(r: &Path) -> ConventionsFile {
    ConventionsFile::load(r).unwrap().expect("a policy")
}

fn manifest_of<'a>(p: &'a ConventionsFile, package: &str) -> Option<&'a Convention> {
    p.conventions
        .iter()
        .find(|c| c.rule == Rule::ImportsDeclared && c.role.package == package)
}

/// Pins the proposal: `census --from-map` proposes `apps/web`'s manifest with today's
/// phantom counted and where it is declared instead, says it writes nothing, and every
/// other kind of import of the fixture holds (only the one phantom differs). Before this
/// change no manifest was ever proposed.
#[test]
fn census_proposes_the_manifest_with_todays_phantom_counted() {
    let dir = repo();
    let r = dir.path();
    let out = drift(r, &["census", "--from-map"]);
    assert!(
        out.contains("Code in apps/web imports only the packages apps/web/package.json declares"),
        "{out}"
    );
    assert!(
        out.contains("today: 1 import(s) of 1 package(s) apps/web/package.json does not declare, in 1 file(s): lodash (1; declared in package.json)"),
        "{out}"
    );
    assert!(
        out.contains("20 of the 21 files there that import a package follow it, 1 differ"),
        "{out}"
    );
    assert!(!r.join(CONVENTIONS_FILE).exists(), "census writes nothing");
    let json: serde_json::Value =
        serde_json::from_str(&drift(r, &["census", "--from-map", "--json"])).unwrap();
    let web = json["from_map"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "manifest" && e["manifest"]["package"] == "apps/web")
        .expect("a manifest proposal for apps/web");
    assert_eq!(web["proposed"], true);
    assert_eq!(web["differ"], 1);
    assert_eq!(web["manifest"]["undeclared"][0]["package"], "lodash");
    assert_eq!(web["convention"]["rule"]["type"], "imports_declared");
}

/// Pins the life of the rule: `init` writes it proposed and advising, at policy format 4
/// (said in one line), and leaves it out of `drift.lock`; accepting records today's
/// phantom, so `check` is clean; once a person sets it to block, a new phantom import in
/// a later change fails `check`, with a message naming the import, the manifest that
/// should declare it, where it is declared instead and the fix.
#[test]
fn accepted_and_set_to_block_a_new_phantom_fails_check() {
    let dir = repo();
    let r = dir.path();
    let out = drift(r, &["init"]);
    assert!(out.contains("is now policy format 4 because"), "{out}");
    let yaml = read(r, CONVENTIONS_FILE);
    assert!(yaml.contains("\nversion: 4\n"), "{yaml}");
    assert!(yaml.contains("type: imports_declared"), "{yaml}");
    assert!(yaml.contains("from_map: manifest"), "{yaml}");
    let p = policy(r);
    let c = manifest_of(&p, "apps/web")
        .expect("proposed for apps/web")
        .clone();
    assert_eq!(
        (c.status, c.mode, c.agents),
        (Status::Proposed, Mode::Advise, None)
    );
    assert!(
        !read(r, LOCK_FILE).contains(&c.id),
        "a proposal is not baselined"
    );
    // Nothing checks a proposal.
    drift(r, &["check"]);

    let accepted = run(r, &["review", "--accept", &c.id]);
    assert!(accepted.status.success());
    let out = String::from_utf8_lossy(&accepted.stderr).into_owned();
    assert!(
        out.contains("1 unit(s) that break it today recorded"),
        "{out}"
    );
    assert!(
        read(r, LOCK_FILE).contains(&format!("{} apps/web/src/phantom.ts#(file)", c.id)),
        "{}",
        read(r, LOCK_FILE)
    );
    let clean = drift(r, &["check"]);
    assert!(clean.contains("no new violations"), "{clean}");

    drift(r, &["review", "--block", &c.id, "--force"]);
    assert_eq!(
        manifest_of(&policy(r), "apps/web").unwrap().mode,
        Mode::Block
    );
    assert!(drift(r, &["check"]).contains("no new violations"));

    write(
        r,
        "apps/web/src/later.ts",
        "import fp from \"lodash/fp\";\n\nexport const later = fp;\n",
    );
    let out = run(r, &["check"]);
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    assert_eq!(out.status.code(), Some(1), "{text}");
    assert!(text.contains("apps/web/src/later.ts"), "{text}");
    assert!(
        text.contains("imports `lodash/fp`: not declared in apps/web/package.json (declared in package.json at the root); fix: add lodash to apps/web/package.json"),
        "{text}"
    );
    assert!(
        !text.contains("phantom.ts"),
        "today's break stays recorded: {text}"
    );
    let json: serde_json::Value =
        serde_json::from_slice(&run(r, &["check", "--format", "json"]).stdout).unwrap();
    let v = json["violations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["path"] == "apps/web/src/later.ts")
        .expect("the new violation");
    assert_eq!(v["import"]["specifier"], "lodash/fp");
    assert_eq!(v["import"]["undeclared"]["package"], "lodash");
    assert_eq!(v["import"]["undeclared"]["declared_in"][0], "package.json");
}

/// Pins that a file an older Drift wrote still loads and checks: `init --no-from-map`
/// writes no manifest rule, so the file stays at the format it had (2, a workspace), and
/// `check` reads it; a version-3 file written by hand loads too.
#[test]
fn an_older_drifts_file_still_loads() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init", "--no-from-map"]);
    let yaml = read(r, CONVENTIONS_FILE);
    assert!(!yaml.contains("imports_declared"), "{yaml}");
    assert!(!yaml.contains("\nversion: 4\n"), "{yaml}");
    drift(r, &["check"]);
    write(
        r,
        CONVENTIONS_FILE,
        "version: 3\nengine: drift 0.1.0-dev\nfile_kinds:\n  literal_stems: []\n  suffixes: []\nconventions: []\n",
    );
    assert!(drift(r, &["check"]).contains("no new violations"));
}
