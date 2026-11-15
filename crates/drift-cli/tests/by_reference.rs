//! End to end, from JavaScript source: handlers routed by reference through the common
//! Express idioms (`asyncHandler(ctrl.m)`, `ctrl.m.bind(ctrl)`, arrays of handlers,
//! object-literal controllers) are entry points, so no exemption applies to them
//! (`Rule::exemption_allowed`), in `census`, `drift check` and the hooks, whose
//! single-file scan defers to a full one.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use drift_mine::context::RepoContext;
use drift_mine::roles::{FileKinds, View, units};
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

/// What PostToolUse says after `rel` was written, as text ("" when silent).
fn post(r: &Path, rel: &str) -> String {
    let edit = json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(rel) } });
    hook(r, "PostToolUse", edit)
        .map(|v| v.to_string())
        .unwrap_or_default()
}

/// An ESM Express app: 30 controllers on the team's `BaseController` (no route uses
/// them, so the base guards nothing), one legacy controller without it, and plain
/// classes elsewhere.
fn app(r: &Path) {
    write(
        r,
        "package.json",
        r#"{"name":"acme","version":"1.0.0","type":"module","dependencies":{"express":"4.18.0","express-async-handler":"1.2.0","svix-express":"1.0.0"}}"#,
    );
    write(
        r,
        "src/lib/base.js",
        "export class BaseController {\n  send(res, x) {\n    res.json(x);\n  }\n}\n",
    );
    write(
        r,
        "src/lib/verify.js",
        "export function verify(req, res, next) {\n  next();\n}\n",
    );
    for i in 0..30 {
        write(
            r,
            &format!("src/controllers/c{i}.controller.js"),
            &format!(
                "import {{ BaseController }} from \"../lib/base.js\";\n\nexport class C{i}Controller extends BaseController {{\n  list(req, res) {{\n    this.send(res, [{i}]);\n  }}\n}}\n"
            ),
        );
    }
    write(
        r,
        "src/controllers/legacy.controller.js",
        "export class LegacyController {\n  list(req, res) {\n    res.json([]);\n  }\n}\n",
    );
    for i in 0..100 {
        write(
            r,
            &format!("src/other/o{i}.js"),
            &format!("export class O{i} {{\n  run() {{\n    return {i};\n  }}\n}}\n"),
        );
    }
}

/// The webhook controller, on a package's base and named for it (exempt as
/// `named_for_base` while no route reaches it), and the routes file registering its
/// `handle` the way `how` says.
fn stripe(r: &Path, how: &str) {
    write(
        r,
        "src/controllers/stripe.controller.js",
        concat!(
            "import { WebhookHandler } from \"svix-express\";\n\n",
            "export class StripeWebhookHandler extends WebhookHandler {\n",
            "  handle(req, res) {\n    res.end();\n  }\n}\n\n",
            "export const stripe = new StripeWebhookHandler();\n",
        ),
    );
    let route = match how {
        "asyncHandler" => "router.post(\"/stripe\", asyncHandler(stripe.handle));",
        "bind" => "router.post(\"/stripe\", stripe.handle.bind(stripe));",
        "array" => "router.post(\"/stripe\", [verify, stripe.handle]);",
        "nested" => "router.post(\"/stripe\", verify, asyncHandler(stripe.handle.bind(stripe)));",
        _ => "router.get(\"/health\", verify);",
    };
    write(
        r,
        "src/routes.js",
        &format!(
            concat!(
                "import express from \"express\";\n",
                "import asyncHandler from \"express-async-handler\";\n",
                "import {{ stripe }} from \"./controllers/stripe.controller.js\";\n",
                "import {{ verify }} from \"./lib/verify.js\";\n\n",
                "const router = express.Router();\n",
                "{}\n\n",
                "export default router;\n",
            ),
            route
        ),
    );
}

/// The accepted, blocking "extend BaseController" convention of [`app`].
fn blocking(r: &Path) -> String {
    run(r, &["init"], None);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let id = yaml
        .split("- id: ")
        .skip(1)
        .find(|b| b.contains("extend BaseController"))
        .map(|b| b[..8].to_string())
        .unwrap_or_else(|| panic!("no BaseController convention in\n{yaml}"));
    // A base-class rule is a suggestion since decision D7, so blocking it takes --force.
    run(r, &["review", "--block", &id, "--force"], None);
    hook(r, "SessionStart", json!({ "source": "startup" }));
    id
}

/// `drift check --format json`: the symbols exempt from and newly violating `id`.
fn checked(r: &Path, id: &str) -> (Vec<String>, Vec<String>) {
    let (_, out) = run(r, &["check", "--format", "json"], None);
    let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
    // Legacy violations (`drift.lock`, `LegacyController`) are left out.
    let of = |k: &str| -> Vec<String> {
        v.get(k)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|e| e["id"] == id && e["baselined"] != true)
            .map(|e| e["symbol"].as_str().unwrap().to_string())
            .collect()
    };
    (of("exempt"), of("violations"))
}

#[test]
fn an_unrouted_handler_named_for_its_base_is_exempt() {
    // The baseline the idioms below change: no route reaches the webhook handler.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    let id = blocking(r);
    stripe(r, "unrouted");
    let ctx = post(r, "src/controllers/stripe.controller.js");
    assert!(ctx.contains("not checked against"), "{ctx}");
    let (exempt, violations) = checked(r, &id);
    assert_eq!(exempt, ["StripeWebhookHandler"]);
    assert!(violations.is_empty(), "{violations:?}");
}

/// A handler routed by `how` is an entry point: `check` reports it with no exemption,
/// and the hook, whose single-file scan of the controller does not see the routes file,
/// defers to a full scan and agrees.
fn routed_is_not_exempt(how: &str) {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    let id = blocking(r);
    stripe(r, how);
    let ctx = post(r, "src/controllers/stripe.controller.js");
    assert!(ctx.contains("StripeWebhookHandler"), "{how}: {ctx}");
    assert!(!ctx.contains("not checked against"), "{how}: {ctx}");
    let (exempt, violations) = checked(r, &id);
    assert!(exempt.is_empty(), "{how}: {exempt:?}");
    assert_eq!(violations, ["StripeWebhookHandler"], "{how}");
}

#[test]
fn a_handler_in_async_handler_is_an_entry_point() {
    routed_is_not_exempt("asyncHandler");
}

#[test]
fn a_bound_handler_is_an_entry_point() {
    routed_is_not_exempt("bind");
}

#[test]
fn a_handler_in_an_array_is_an_entry_point() {
    routed_is_not_exempt("array");
}

#[test]
fn a_bound_handler_in_async_handler_after_middleware_is_an_entry_point() {
    routed_is_not_exempt("nested");
}

#[test]
fn handlers_of_object_literal_controllers_are_entry_points() {
    // `export default { listItems, get: getItem }` and `export const ctrl = { create,
    // remove }` (`remove` imported): a route referring to a property makes the object
    // and every function its properties refer to entry units; a function no route
    // reaches is not one.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{"name":"acme","version":"1.0.0","type":"module","dependencies":{"express":"4.18.0"}}"#,
    );
    write(
        r,
        "src/controllers/items.js",
        concat!(
            "function listItems(req, res) {\n  res.json([]);\n}\n\n",
            "function getItem(req, res) {\n  res.json({});\n}\n\n",
            "export function unrouted(req, res) {\n  res.json({});\n}\n\n",
            "export default { listItems, get: getItem };\n",
        ),
    );
    write(
        r,
        "src/lib/remove.js",
        "export function remove(req, res) {\n  res.json({});\n}\n",
    );
    write(
        r,
        "src/controllers/orders.js",
        concat!(
            "import { remove } from \"../lib/remove.js\";\n\n",
            "export function create(req, res) {\n  res.json({});\n}\n\n",
            "export const ctrl = { create, remove };\n",
        ),
    );
    write(
        r,
        "src/routes.js",
        concat!(
            "import express from \"express\";\n",
            "import items from \"./controllers/items.js\";\n",
            "import { ctrl } from \"./controllers/orders.js\";\n\n",
            "const router = express.Router();\n",
            "router.get(\"/items\", items.listItems);\n",
            "router.delete(\"/orders/:id\", ctrl.remove);\n\n",
            "export default router;\n",
        ),
    );
    let (facts, _) = drift_ts::scan(
        r,
        &drift_ts::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let all = units(&facts, &FileKinds::learn(&facts));
    let ctx = RepoContext::new(&facts, &all);
    let entry = |path: &str, name: &str| {
        let f = facts.files.iter().find(|f| f.path == path).unwrap();
        let s = f
            .symbols
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name} in {:?}", f.symbols));
        ctx.is_entry_unit(f, s)
    };
    for (path, name) in [
        ("src/controllers/items.js", "listItems"),
        ("src/controllers/items.js", "getItem"),
        ("src/controllers/items.js", "default"),
        ("src/controllers/orders.js", "create"),
        ("src/controllers/orders.js", "ctrl"),
        ("src/lib/remove.js", "remove"),
    ] {
        assert!(entry(path, name), "{path}#{name}");
    }
    assert!(!entry("src/controllers/items.js", "unrouted"));
    // The units mining sees carry the same answer.
    assert!(
        all.iter().any(|u| matches!(u.view, View::Symbol(f, s)
        if f.path == "src/controllers/orders.js" && s.name == "create" && ctx.is_entry_unit(f, s)))
    );
}
