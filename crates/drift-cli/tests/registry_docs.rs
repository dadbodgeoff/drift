//! End-to-end tests of F7 (a registry key already taken) and F8 (a documented
//! exception) through the `drift` binary: `census`, `drift check` (text and JSON)
//! and the Claude Code hooks agree, and neither exemption can silence a guard or be
//! decided wrongly by a hook's single-file scan.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
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
    )
}

fn hook(root: &Path, event: &str, extra: Value) -> Option<Value> {
    let mut input = json!({ "session_id": "s1", "cwd": root, "hook_event_name": event });
    input
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let (code, out) = run(root, &["hook", "claude", event], Some(&input.to_string()));
    assert_eq!(code, 0, "hooks always exit 0");
    let out = out.trim();
    (!out.is_empty()).then(|| serde_json::from_str(out).expect("hook output is JSON"))
}

fn edit(root: &Path, rel: &str) -> Value {
    json!({ "tool_name": "Write", "tool_input": { "file_path": root.join(rel) } })
}

/// What PostToolUse says after `rel` was written, as text ("" when silent).
fn post(r: &Path, rel: &str) -> String {
    hook(r, "PostToolUse", edit(r, rel))
        .map(|v| v.to_string())
        .unwrap_or_default()
}

/// The id of the accepted convention whose yaml block contains all of `needles`, set
/// to block. Python conventions are suggestions (decision D7: Python advises only), so
/// blocking one takes `--force`.
fn block(r: &Path, needles: &[&str]) -> String {
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| needles.iter().all(|n| b.contains(n)))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("no convention with {needles:?} in\n{yaml}"));
    run(r, &["review", "--block", &id, "--force"], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));
    id
}

fn background(r: &Path) {
    write(
        r,
        "pyproject.toml",
        "[project]\nname = \"acme\"\ndependencies = [\"fastapi\", \"flask\"]\n",
    );
    write(r, "app/__init__.py", "");
    for i in 0..60 {
        write(
            r,
            &format!("app/o{i}/thing.py"),
            &format!("class Thing{i}:\n    pass\n"),
        );
        write(
            r,
            &format!("lib/u{i}.py"),
            &format!("def u{i}():\n    return {i}\n"),
        );
    }
}

/// 40 choice sets on the team's `ChoiceSet` in 8 apps, and the convention blocking.
fn choices_repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    background(r);
    write(r, "app/kit/__init__.py", "");
    write(r, "app/kit/choices.py", "class ChoiceSet:\n    pass\n");
    for f in 0..8 {
        write(r, &format!("app/m{f}/__init__.py"), "");
        let mut body = String::from("from app.kit.choices import ChoiceSet\n\n");
        for k in ["Status", "Kind", "Role", "Mode", "Level"] {
            body.push_str(&format!("\nclass M{f}{k}Choices(ChoiceSet):\n    pass\n"));
        }
        write(r, &format!("app/m{f}/choices.py"), &body);
    }
    // A legacy outlier: a rule every member follows is not proposed.
    write(r, "app/plain/__init__.py", "");
    write(r, "app/plain/choices.py", "class Plain:\n    pass\n");
    let id = block(r, &["extend ChoiceSet"]);
    (dir, id)
}

#[test]
fn a_documented_exception_is_listed_by_check_and_the_hooks_and_a_mention_is_not_one() {
    let (dir, id) = choices_repo();
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/choices.py",
        concat!(
            "class ActionChoices:\n",
            "    \"\"\"The built-in actions. Not a ChoiceSet: plugins add their own.\"\"\"\n\n\n",
            "class ColourChoices:\n",
            "    \"\"\"A ChoiceSet of colours, like ChoiceSet.\"\"\"\n\n\n",
            "class PendingChoices:\n",
            "    \"\"\"Not a ChoiceSet yet.\"\"\"\n",
        ),
    );
    let reason = "documented exception: \\\"Not a ChoiceSet\\\"";
    let ctx = post(r, "app/new/choices.py");
    assert!(
        ctx.contains(&format!(
            "`ActionChoices` not checked against {id}: {reason}"
        )),
        "{ctx}"
    );
    assert!(
        ctx.contains("ColourChoices") && ctx.contains("PendingChoices"),
        "{ctx}"
    );
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 1, "{text}");
    assert!(
        text.contains(&format!(
            "exempt [{id}] app/new/choices.py:1 ActionChoices (documented exception: \"Not a ChoiceSet\")"
        )),
        "{text}"
    );
    let (_, json) = run(r, &["check", "--format", "json"], None);
    let v: Value = serde_json::from_str(&json).unwrap();
    let exempt: Vec<&str> = v["exempt"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["symbol"].as_str().unwrap())
        .collect();
    assert_eq!(exempt, ["ActionChoices"], "{json}");
    let violators: Vec<&str> = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["symbol"].as_str().unwrap())
        .collect();
    assert!(
        violators.contains(&"ColourChoices") && violators.contains(&"PendingChoices"),
        "{json}"
    );
}

/// `drift check --format json` exits 1 and reports `symbol` as a violation of `id`,
/// with no exemption; PostToolUse names it and lists no exemption.
fn reported_not_exempt(r: &Path, rel: &str, symbol: &str, id: &str) {
    let ctx = post(r, rel);
    assert!(ctx.contains(symbol), "{ctx}");
    assert!(!ctx.contains("not checked against"), "{ctx}");
    let (code, json) = run(r, &["check", "--format", "json"], None);
    assert_eq!(code, 1, "{json}");
    let v: Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("exempt").is_none(), "{json}");
    assert!(
        v["violations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["symbol"] == symbol && e["id"] == id),
        "{json}"
    );
}

#[test]
fn a_docstring_cannot_silence_a_decorator_guard() {
    // Review repro: 30 `@admins_only` views blocking; a new view that "is not an
    // `admins_only` view" is still a violation, for check and the hooks.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    background(r);
    write(r, "app/auth.py", "def admins_only(f):\n    return f\n");
    for f in 0..7 {
        write(r, &format!("app/v{f}/__init__.py"), "");
        let mut body = format!(
            "from flask import Blueprint\n\nfrom app.auth import admins_only\n\nbp = Blueprint(\"v{f}\", __name__)\n"
        );
        for k in 0..5 {
            body.push_str(&format!(
                "\n\n@bp.route(\"/v{f}/{k}\")\n@admins_only\ndef view{f}_{k}():\n    return \"\"\n"
            ));
        }
        write(r, &format!("app/v{f}/views.py"), &body);
    }
    write(r, "app/v8/__init__.py", "");
    write(
        r,
        "app/v8/views.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"v8\", __name__)\n\n\n@bp.route(\"/legacy\")\ndef legacy_view():\n    return \"\"\n",
    );
    let id = block(r, &["admins_only"]);
    write(r, "app/v9/__init__.py", "");
    write(
        r,
        "app/v9/views.py",
        "from flask import Blueprint\n\nbp = Blueprint(\"v9\", __name__)\n\n\n@bp.route(\"/export\")\ndef admin_export_users():\n    \"\"\"Not an `admins_only` view: the gateway checks it.\"\"\"\n    return \"\"\n",
    );
    reported_not_exempt(r, "app/v9/views.py", "admin_export_users", &id);
}

#[test]
fn a_docstring_cannot_silence_an_auth_dependency() {
    // Review repro (polar D-31bf00's shape): routes take an auth dependency; a new
    // unauthenticated route that "does not use get_current_user" is a violation.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    background(r);
    write(r, "app/api/__init__.py", "");
    write(
        r,
        "app/api/deps.py",
        "from typing import Annotated\nfrom fastapi import Depends\n\ndef get_current_user():\n    return 1\n\nCurrentUser = Annotated[object, Depends(get_current_user)]\n",
    );
    for i in 10..40 {
        let route = if i < 39 {
            format!(
                "from fastapi import APIRouter\nfrom app.api.deps import CurrentUser\n\nrouter = APIRouter()\n\n@router.get(\"/r{i}\")\ndef read_{i}(user: CurrentUser):\n    return {i}\n"
            )
        } else {
            format!(
                "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get(\"/r{i}\")\ndef read_{i}():\n    return {i}\n"
            )
        };
        write(r, &format!("app/api/r{i}.py"), &route);
    }
    let id = block(r, &["get_current_user()"]);
    write(
        r,
        "app/api/export.py",
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n@router.get(\"/export\")\ndef export_users():\n    \"\"\"Does not use `get_current_user`: the gateway checks it.\"\"\"\n    return 1\n",
    );
    reported_not_exempt(r, "app/api/export.py", "export_users", &id);
}

/// 30 apps whose filtersets are registered with `@register_filterset` under their
/// `Meta.model`; with `shared`, two of them register the same model.
fn filtersets_repo(shared: bool) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    background(r);
    write(r, "app/utils/__init__.py", "");
    write(
        r,
        "app/utils/filtersets.py",
        "def register_filterset(cls):\n    return cls\n",
    );
    for i in 0..30 {
        write(r, &format!("app/m{i}/__init__.py"), "");
        write(
            r,
            &format!("app/m{i}/models.py"),
            &format!("class M{i}:\n    pass\n"),
        );
        let model = if shared && i == 2 { 1 } else { i };
        write(
            r,
            &format!("app/m{i}/filtersets.py"),
            &format!(
                "from app.m{model}.models import M{model}\nfrom app.utils.filtersets import register_filterset\n\n\n@register_filterset\nclass M{i}FilterSet:\n    class Meta:\n        model = M{model}\n"
            ),
        );
    }
    write(r, "app/legacy/__init__.py", "");
    write(
        r,
        "app/legacy/filtersets.py",
        "class LegacyFilterSet:\n    pass\n",
    );
    let id = block(r, &["register_filterset"]);
    (dir, id)
}

#[test]
fn a_taken_registry_key_is_listed_by_check_and_the_hooks() {
    let (dir, id) = filtersets_repo(false);
    let r = dir.path();
    // A secondary filterset of a model that `M3FilterSet` registers.
    write(
        r,
        "app/m0/filtersets.py",
        "from app.m0.models import M0\nfrom app.m3.models import M3\nfrom app.utils.filtersets import register_filterset\n\n\n@register_filterset\nclass M0FilterSet:\n    class Meta:\n        model = M0\n\n\nclass M3ConnectionFilterSet:\n    class Meta:\n        model = M3\n",
    );
    let reason = "its model M3 is already registered with register_filterset() by M3FilterSet";
    let ctx = post(r, "app/m0/filtersets.py");
    assert!(
        ctx.contains(&format!(
            "`M3ConnectionFilterSet` not checked against {id}: {reason}"
        )),
        "{ctx}"
    );
    let (code, text) = run(r, &["check"], None);
    assert_eq!(code, 0, "{text}");
    assert!(text.contains(reason), "{text}");
}

#[test]
fn hooks_and_check_agree_when_the_new_file_looks_like_a_keyed_registry() {
    // Review repro: the repo's registry is not keyed (M1 is registered twice). The new
    // file registers A and B and leaves `AOtherFilterSet` (model A) undecorated. Alone,
    // the file looks keyed; the hook must decide as check does: a violation.
    let (dir, id) = filtersets_repo(true);
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/models.py",
        "class A:\n    pass\n\n\nclass B:\n    pass\n",
    );
    write(
        r,
        "app/new/filtersets.py",
        concat!(
            "from app.new.models import A, B\n",
            "from app.utils.filtersets import register_filterset\n\n\n",
            "@register_filterset\nclass AFilterSet:\n    class Meta:\n        model = A\n\n\n",
            "@register_filterset\nclass BFilterSet:\n    class Meta:\n        model = B\n\n\n",
            "class AOtherFilterSet:\n    class Meta:\n        model = A\n",
        ),
    );
    let ctx = post(r, "app/new/filtersets.py");
    assert!(ctx.contains("AOtherFilterSet"), "{ctx}");
    assert!(!ctx.contains("not checked against"), "{ctx}");
    let (code, json) = run(r, &["check", "--format", "json"], None);
    assert_eq!(code, 1, "{json}");
    let v: Value = serde_json::from_str(&json).unwrap();
    assert!(
        v["violations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["symbol"] == "AOtherFilterSet" && e["id"] == id.as_str()),
        "{json}"
    );
    let stop = hook(r, "Stop", json!({ "stop_hook_active": false })).unwrap();
    assert_eq!(stop["decision"], "block", "{stop}");
}

/// Known limitation of the neighbour gate (round 11, WS-J; off by default): with
/// `DRIFT_NEIGHBOUR_GATE=on`, a new violator next to a member Drift exempts by itself is
/// held back (eval/study/runs/neighbour-r11-2026-11-08/README.md). When it is fixed, this
/// test fails and must be turned around.
#[test]
fn known_limitation_gate_holds_back_a_violator_next_to_a_documented_exception() {
    // Failure mode: a new violator near a member Drift exempts by itself (documented exception).
    let (dir, _) = choices_repo();
    let r = dir.path();
    write(r, "app/new/__init__.py", "");
    write(
        r,
        "app/new/choices.py",
        concat!(
            "class ActionChoices:\n",
            "    \"\"\"The built-in actions. Not a ChoiceSet: plugins add their own.\"\"\"\n\n\n",
            "class ColourChoices:\n",
            "    \"\"\"A ChoiceSet of colours, like ChoiceSet.\"\"\"\n\n\n",
            "class PendingChoices:\n",
            "    \"\"\"Not a ChoiceSet yet.\"\"\"\n",
        ),
    );
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .env("DRIFT_NEIGHBOUR_GATE", "on")
        .args(["check", "--format", "json"])
        .current_dir(r)
        .stdin(Stdio::null())
        .output()
        .unwrap();
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {out:?}"));
    let held: Vec<&str> = v["suppressed_neighbour"]
        .as_array()
        .map(|hs| hs.iter().map(|h| h["symbol"].as_str().unwrap()).collect())
        .unwrap_or_default();
    assert!(
        held.contains(&"ColourChoices") && held.contains(&"PendingChoices"),
        "{v:#}"
    );
}
