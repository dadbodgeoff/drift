//! What an answer of absence rests on: `none` (authentication, authorization) and
//! `internal` (exposure) are what Drift found in what it read, and every surface says
//! so, with what it saw and did not read (`basis`). Authentication that identifies
//! the caller and turns no one away is `identified`, counted apart. A `none`
//! variant's key and P- id are its identity: the new words never move them.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &[u8]) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn run(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .args(["--no-cache"])
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&run(root, args)).unwrap()
}

fn concern<'a>(practices: &'a Value, id: &str) -> &'a Value {
    practices["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .unwrap()
}

fn unit<'a>(c: &'a Value, symbol: &str) -> &'a Value {
    c["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["symbol"] == symbol)
        .unwrap_or_else(|| panic!("no unit {symbol}: {c:#}"))
}

fn variant<'a>(c: &'a Value, id: &str) -> &'a Value {
    c["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap_or_else(|| panic!("no variant {id}: {:#}", c["variants"]))
}

fn row<'a>(inv: &'a Value, path: &str) -> &'a Value {
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["path"] == path)
        .unwrap_or_else(|| panic!("no row {path}"))
}

fn not_read(basis: &Value) -> Vec<(String, String)> {
    basis["not_read"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| {
            (
                n["kind"].as_str().unwrap().to_string(),
                n["what"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

const CALLER: &str = "from fastapi import HTTPException, Request\n\n\ndef get_caller(request: Request):\n    token = request.headers.get(\"authorization\")\n    if not token:\n        raise HTTPException(status_code=401, detail=\"unauthenticated\")\n    return request.state.caller\n";

const MAIN: &str = "from fastapi import Depends, FastAPI\n\nfrom app.deps import get_caller\n\napp = FastAPI()\n\n\n@app.get(\"/health\")\ndef health():\n    return {\"ok\": True}\n\n\n@app.get(\"/version\")\ndef version():\n    return {\"v\": 1}\n\n\n@app.get(\"/me\")\ndef me(caller=Depends(get_caller)):\n    return {\"ok\": True}\n\n\n@app.get(\"/whoami\")\ndef whoami(caller=Depends(get_caller)):\n    return {\"ok\": True}\n";

const SESSION: &str = "import { getServerSession } from \"next-auth\";\n\nexport async function GET() {\n  const session = await getServerSession();\n  return Response.json({ name: session?.user?.name ?? null });\n}\n";

/// The ids a `none` and an `identifies` variant had at 2bfdecf5, before the labels said
/// what they rest on: the same fixture gives the same key and id now.
#[test]
fn a_none_variant_keeps_its_key_and_id_and_only_its_label_changes() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "app/__init__.py", b"");
    write(r, "app/deps.py", CALLER.as_bytes());
    write(r, "app/main.py", MAIN.as_bytes());
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let none = variant(authn, "P-68fb99");
    assert_eq!(none["key"], "none:no guard, nothing opens it");
    assert_eq!(none["kind"], "none");
    assert_eq!(none["label"], "no guard found in what Drift read");
    assert_eq!(unit(authn, "version")["variant"], "P-68fb99");
    let authz = concern(&p, "authz");
    let none = variant(authz, "P-280f4e");
    assert_eq!(
        none["key"],
        "none:no role check, no tenant scope, no owner scope"
    );
    assert_eq!(
        none["label"],
        "no role check, tenant scope or owner scope found in what Drift read"
    );
    // The authz basis: the handler and the dependency read, nothing listed unread.
    let b = &unit(authz, "me")["basis"];
    assert_eq!(b["bodies"], 2, "{b}");
    assert_eq!(b["followed"], json!(["app/deps.py#get_caller"]));
    assert_eq!(b["not_read"], json!([]));

    // An identified variant keeps the `identifies` key and id, and its group's id.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        br#"{"name":"x","dependencies":{"next":"14.0.0","next-auth":"4.0.0"}}"#,
    );
    for d in ["a", "b"] {
        write(r, &format!("app/api/{d}/route.ts"), SESSION.as_bytes());
    }
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let v = variant(authn, "P-bd437d");
    assert_eq!(v["key"], "identifies:pkg:next-auth#getServerSession");
    assert_eq!(v["kind"], "identified");
    let g = authn["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["kind"] == "identified")
        .unwrap();
    assert_eq!(g["id"], "G-c8ba8d", "{g}");
}

/// One repository with a route whose authentication is `none` beside a package's
/// function no list knows and a file the scan skipped, behind a compose service that
/// publishes no ports beside a description Drift does not read and a YAML file it does
/// not recognise; and a route that only reads the session (`identified`).
fn mixed() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "svc/app/main.py",
        b"import company_auth\nfrom fastapi import FastAPI, Request\n\napp = FastAPI()\n\n\n@app.get(\"/reports\")\ndef reports(request: Request):\n    who = company_auth.lookup(request)\n    return {\"who\": who}\n",
    );
    write(r, "svc/app/__init__.py", b"");
    write(r, "svc/app/broken.py", b"x = \"\xff\xfe\"\n");
    write(r, "svc/compose.yaml", b"services:\n  api:\n    build: .\n");
    write(r, "other/Procfile", b"web: gunicorn app:app\n");
    write(r, "docs/mkdocs.yml", b"site_name: docs\n");
    write(
        r,
        "web/package.json",
        br#"{"name":"web","dependencies":{"next":"14.0.0","next-auth":"4.0.0"}}"#,
    );
    write(r, "web/app/api/me/route.ts", SESSION.as_bytes());
    dir
}

#[test]
fn none_says_what_drift_read_and_did_not_on_every_surface() {
    let dir = mixed();
    let r = dir.path();
    let unread = [
        ("file".to_string(), "svc/app/broken.py".to_string()),
        (
            "package_function".to_string(),
            "pkg:company_auth#lookup".to_string(),
        ),
    ];
    // practices --json: the unit's basis, and the variant's union of its members'.
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let u = unit(authn, "reports");
    assert_eq!(u["assignment"], "none");
    assert_eq!(not_read(&u["basis"]), unread);
    let v = variant(authn, u["variant"].as_str().unwrap());
    assert_eq!(not_read(v), unread);
    // practices text.
    let text = run(r, &["practices", "--all"]);
    assert!(
        text.contains("none: no guard found in what Drift read (2 not read: svc/app/broken.py (skipped by the scan), lookup from company_auth)"),
        "{text}"
    );
    assert!(
        text.contains("none 50% (nothing found in what Drift read)"),
        "{text}"
    );
    // security --json: the same basis on both surfaces, and the internal row's.
    let inv = json(r, &["security", "--json"]);
    let e = row(&inv, "svc/app/main.py");
    assert_eq!(e["basis"], u["basis"]);
    assert_eq!(e["exposure"], "internal");
    let x = &e["exposure_basis"];
    assert_eq!(x["descriptions"], json!(["svc/compose.yaml"]));
    assert_eq!(
        not_read(x),
        [
            ("description".to_string(), "other/Procfile".to_string()),
            ("file".to_string(), "docs/mkdocs.yml".to_string()),
            ("file".to_string(), "svc/app/broken.py".to_string()),
        ]
    );
    // security text: the heading, the count per row, internal in what Drift read.
    let text = run(r, &["security"]);
    assert!(
        text.contains("2 where Drift found no guard in what it read"),
        "{text}"
    );
    assert!(
        text.contains("Exposure: 0 internet-facing, 1 internal in what Drift read, 1 unknown"),
        "{text}"
    );
    let line = text
        .lines()
        .find(|l| l.contains("svc/app/main.py:7"))
        .unwrap();
    assert!(
        text.contains("\nEntry points where Drift found no guard\n"),
        "{text}"
    );
    assert!(
        line.contains("internal in what Drift read (compose service api in svc/compose.yaml publishes no ports; 3 not read: other/Procfile")
            && line.ends_with("  2 not read"),
        "{line}"
    );
    // The card.
    let card = run(r, &["card", "svc/app/main.py"]);
    assert!(
        card.contains(
            "reports: no guard found in what Drift read (2 not read); internal in what Drift read ("
        ),
        "{card}"
    );
    // The MCP tool says the same as the CLI (it serves an adopted repository).
    run(r, &["init"]);
    let mcp = mcp_security(r);
    assert!(
        mcp.contains("Entry points where Drift found no guard") && mcp.contains("  2 not read"),
        "{mcp}"
    );
}

#[test]
fn identified_is_its_own_state_on_both_surfaces_and_counted_apart() {
    let dir = mixed();
    let r = dir.path();
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let u = unit(authn, "GET");
    assert_eq!(u["assignment"], "identified");
    // Not a none: no basis; its key keeps the instrument.
    assert!(u.get("basis").is_none(), "{u}");
    let v = variant(authn, u["variant"].as_str().unwrap());
    assert_eq!(v["kind"], "identified");
    assert_eq!(v["key"], "identifies:pkg:next-auth#getServerSession");
    assert_eq!(
        v["label"],
        "identified by getServerSession, turns no one away"
    );
    let pop = &authn["population"];
    assert_eq!(
        (&pop["known"], &pop["identified"], &pop["none"]),
        (&json!(0), &json!(1), &json!(1))
    );
    assert_eq!(p["summary"]["identified"], 1);
    // Never a recipe's way to copy: counted in its recipe concern apart.
    let rc = p["recipes"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|r| r["concerns"].as_array().unwrap())
        .find(|c| c["concern"] == "authn" && c["identified"] == 1)
        .expect("an authn recipe concern counting it");
    assert_eq!(rc["variants"], json!([]), "{rc}");
    // drift security lists it with no guard, identified by the same instrument.
    let inv = json(r, &["security", "--json"]);
    let e = row(&inv, "web/app/api/me/route.ts");
    assert_eq!(e["guards"], json!([]));
    assert_eq!(e["authenticates"], json!(["getServerSession"]));
    let text = run(r, &["security"]);
    let line = text
        .lines()
        .find(|l| l.contains("web/app/api/me/route.ts:3"))
        .unwrap();
    assert!(
        line.contains("identified by getServerSession, turns no one away"),
        "{line}"
    );
    let all = run(r, &["practices", "--all"]);
    assert!(all.contains("known 0%, identified 50%, none 50%"), "{all}");
}

/// `drift_security` over MCP, on `root`.
fn mcp_security(root: &Path) -> String {
    let mut child = Command::new(&*BIN)
        .args(["--no-cache", "mcp"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let msgs = [
        json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"drift_security","arguments":{}}}),
    ];
    let mut stdin = child.stdin.take().unwrap();
    for m in msgs {
        writeln!(stdin, "{m}").unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    let text = String::from_utf8(out.stdout).unwrap();
    let reply: Value = text
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .find(|v| v["id"] == 1)
        .expect("a reply to the call");
    reply["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Python webhooks: each route verifies (or does not) a signature in its body.
const PY_HOOKS: &str = r#"import os

import stripe
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from slack_sdk.signature import SignatureVerifier
from standardwebhooks import Webhook as StandardWebhook
from svix.webhooks import Webhook, WebhookVerificationError

app = FastAPI()
slack = SignatureVerifier(os.environ["SLACK_SECRET"])


@app.post("/hooks/svix-400")
async def svix_400(request: Request):
    payload = await request.body()
    wh = Webhook(os.environ["SVIX_SECRET"])
    try:
        evt = wh.verify(payload, dict(request.headers))
    except WebhookVerificationError:
        raise HTTPException(status_code=400, detail="bad signature")
    return {"type": evt["type"]}


@app.post("/hooks/svix-response")
async def svix_response(request: Request):
    payload = await request.body()
    wh = Webhook(os.environ["SVIX_SECRET"])
    try:
        wh.verify(payload, dict(request.headers))
    except WebhookVerificationError:
        return JSONResponse({"error": "bad signature"}, status_code=400)
    return {"ok": True}


@app.post("/hooks/svix-uncaught")
async def svix_uncaught(request: Request):
    payload = await request.body()
    Webhook(os.environ["SVIX_SECRET"]).verify(payload, dict(request.headers))
    return {"ok": True}


@app.post("/hooks/standard")
async def standard(request: Request):
    payload = await request.body()
    wh = StandardWebhook(os.environ["STD_SECRET"])
    wh.verify(payload, dict(request.headers))
    return {"ok": True}


@app.post("/hooks/stripe")
async def stripe_hook(request: Request):
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature"), os.environ["STRIPE_SECRET"])
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400)
    return {"id": event["id"]}


@app.post("/hooks/slack-400")
async def slack_400(request: Request):
    body = await request.body()
    if not slack.is_valid_request(body, dict(request.headers)):
        raise HTTPException(status_code=400)
    return {"ok": True}


@app.post("/hooks/svix-swallowed")
async def svix_swallowed(request: Request):
    payload = await request.body()
    wh = Webhook(os.environ["SVIX_SECRET"])
    try:
        wh.verify(payload, dict(request.headers))
    except WebhookVerificationError:
        pass
    return {"ok": True}


@app.post("/hooks/svix-answers-ok")
async def svix_answers_ok(request: Request):
    payload = await request.body()
    wh = Webhook(os.environ["SVIX_SECRET"])
    try:
        wh.verify(payload, dict(request.headers))
    except WebhookVerificationError:
        return {"ok": False}
    return {"ok": True}


@app.post("/hooks/svix-branch")
async def svix_branch(request: Request):
    payload = await request.body()
    if os.environ.get("VERIFY_HOOKS"):
        Webhook(os.environ["SVIX_SECRET"]).verify(payload, dict(request.headers))
    return {"ok": True}


@app.post("/hooks/stripe-logged")
async def stripe_logged(request: Request):
    payload = await request.body()
    try:
        stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature"), os.environ["STRIPE_SECRET"])
    except Exception:
        print("bad signature")
    return {"ok": True}


@app.post("/hooks/slack-ignored")
async def slack_ignored(request: Request):
    body = await request.body()
    slack.is_valid_request(body, dict(request.headers))
    return {"ok": True}


@app.post("/hooks/sign-only")
async def sign_only(request: Request):
    payload = await request.body()
    Webhook(os.environ["SVIX_SECRET"]).sign("id", 0, payload)
    return {"ok": True}
"#;

/// TypeScript webhooks, one route file each.
const TS_HOOKS: &[(&str, &str)] = &[
    (
        "stripe",
        "import Stripe from \"stripe\";\nconst stripe = new Stripe(process.env.STRIPE_KEY!);\nexport async function POST(req: Request) {\n  const body = await req.text();\n  let event: Stripe.Event;\n  try {\n    event = stripe.webhooks.constructEvent(body, req.headers.get(\"stripe-signature\")!, process.env.STRIPE_WEBHOOK_SECRET!);\n  } catch (err) {\n    return new Response(\"bad signature\", { status: 400 });\n  }\n  return Response.json({ id: event.id });\n}\n",
    ),
    (
        "svix",
        "import { Webhook } from \"svix\";\nexport async function POST(req: Request) {\n  const body = await req.text();\n  const wh = new Webhook(process.env.SVIX_SECRET!);\n  const evt = wh.verify(body, Object.fromEntries(req.headers));\n  return Response.json({ evt });\n}\n",
    ),
    (
        "stripe-logged",
        "import Stripe from \"stripe\";\nconst stripe = new Stripe(process.env.STRIPE_KEY!);\nexport async function POST(req: Request) {\n  const body = await req.text();\n  try {\n    stripe.webhooks.constructEvent(body, req.headers.get(\"stripe-signature\")!, process.env.STRIPE_WEBHOOK_SECRET!);\n  } catch (err) {\n    console.log(err);\n  }\n  return Response.json({ ok: true });\n}\n",
    ),
    (
        "svix-branch",
        "import { Webhook } from \"svix\";\nexport async function POST(req: Request) {\n  const body = await req.text();\n  if (process.env.VERIFY_HOOKS) {\n    new Webhook(process.env.SVIX_SECRET!).verify(body, Object.fromEntries(req.headers));\n  }\n  return Response.json({ ok: true });\n}\n",
    ),
    (
        "octokit",
        "import { Webhooks } from \"@octokit/webhooks\";\nconst webhooks = new Webhooks({ secret: process.env.GH_SECRET! });\nexport async function POST(req: Request) {\n  const body = await req.text();\n  if (!(await webhooks.verify(body, req.headers.get(\"x-hub-signature-256\") ?? \"\"))) {\n    return new Response(\"unauthorized\", { status: 401 });\n  }\n  return Response.json({ ok: true });\n}\n",
    ),
    (
        "octokit-ignored",
        "import { Webhooks } from \"@octokit/webhooks\";\nconst webhooks = new Webhooks({ secret: process.env.GH_SECRET! });\nexport async function POST(req: Request) {\n  const body = await req.text();\n  await webhooks.verify(body, req.headers.get(\"x-hub-signature-256\") ?? \"\");\n  return Response.json({ ok: true });\n}\n",
    ),
];

/// A webhook whose body verifies the sending service's signature, on a closed list of
/// verifier call shapes, and whose failure leaves the handler (raised past it, or
/// answered with a 4xx), is known on the practice map by the verifier (`service_auth`)
/// and listed apart from "no guard found" by `drift security`: it verifies a signature,
/// and no sign-in is asked by design. Never a guard. One that calls a verifier whose
/// failure is not proven to stop the request (swallowed, answered with a success, made
/// for some requests only, logged, its result ignored, octokit's `verify`) is unknown
/// on both surfaces (`signature_not_proven`), never known and never "no guard found".
/// The two surfaces agree on every route, and so do `drift check --diff-base` and
/// `drift security --diff-base` for the same routes added by a change.
#[test]
fn a_webhook_that_verifies_a_signature_is_not_without_a_guard() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let git = |args: &[&str]| {
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
            .current_dir(r)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {out:?}");
    };
    // The base: the packages, and no webhook.
    write(r, "svc/app/__init__.py", b"");
    write(
        r,
        "web/package.json",
        br#"{"name":"web","dependencies":{"next":"15.0.0","stripe":"16.0.0","svix":"1.0.0","@octokit/webhooks":"13.0.0"}}"#,
    );
    git(&["init", "-q"]);
    git(&["add", "-A"]);
    git(&["commit", "-qm", "base"]);
    run(r, &["init"]);
    git(&["checkout", "-qb", "hooks"]);
    write(r, "svc/app/main.py", PY_HOOKS.as_bytes());
    for (name, body) in TS_HOOKS {
        write(r, &format!("web/app/api/{name}/route.ts"), body.as_bytes());
    }
    git(&["add", "-A"]);
    git(&["commit", "-qm", "hooks"]);

    let verified = [
        ("/hooks/svix-400", "svix Webhook.verify"),
        ("/hooks/svix-response", "svix Webhook.verify"),
        ("/hooks/svix-uncaught", "svix Webhook.verify"),
        ("/hooks/standard", "standard-webhooks Webhook.verify"),
        ("/hooks/stripe", "Stripe Webhook.construct_event"),
        (
            "/hooks/slack-400",
            "Slack SignatureVerifier.is_valid_request",
        ),
        ("/api/stripe", "Stripe webhooks.constructEvent"),
        ("/api/svix", "svix Webhook.verify"),
    ];
    let unproven = [
        "/hooks/svix-swallowed",
        "/hooks/svix-answers-ok",
        "/hooks/svix-branch",
        "/hooks/stripe-logged",
        "/hooks/slack-ignored",
        "/api/stripe-logged",
        "/api/svix-branch",
        "/api/octokit",
        "/api/octokit-ignored",
    ];

    // The practice map, by route.
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let unit_of = |route: &str| -> &Value {
        authn["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["route"] == route)
            .unwrap_or_else(|| panic!("no unit {route}"))
    };
    let key_of = |u: &Value| -> String {
        u["key"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| variant(authn, u["variant"].as_str().unwrap())["key"].to_string())
    };
    // The inventory, by route.
    let inv = json(r, &["security", "--json"]);
    let by_route = |route: &str| -> &Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["route"] == route)
            .unwrap_or_else(|| panic!("no row {route}"))
    };
    for (route, by) in verified {
        let u = unit_of(route);
        assert_eq!(u["assignment"], "known", "{route}: {u}");
        let key = key_of(u);
        assert!(key.contains("service_auth:"), "{route}: {key}");
        let e = by_route(route);
        assert_eq!(e["verifies_signature"], json!([by]), "{route}: {e}");
        assert_eq!(e["guards"], json!([]), "never a guard: {route}: {e}");
        assert!(e.get("basis").is_none(), "{route}: {e}");
    }
    for route in unproven {
        let u = unit_of(route);
        assert_eq!(
            (u["assignment"].as_str(), u["reason"].as_str()),
            (Some("unknown"), Some("signature_not_proven")),
            "{route}: {u}"
        );
        let e = by_route(route);
        assert!(e.get("verifies_signature").is_none(), "{route}: {e}");
        assert_eq!(e["guards"], json!([]), "{route}: {e}");
        assert!(
            e["opaque"].as_array().is_some_and(|o| !o.is_empty()),
            "guard unknown, never no guard: {route}: {e}"
        );
    }
    // Another method of the verifier's class verifies nothing (here a call Drift does
    // not read: its guard is unknown, as before).
    let e = by_route("/hooks/sign-only");
    assert!(e.get("verifies_signature").is_none(), "{e}");

    // The text: counted and listed apart, in the row's own words.
    let text = run(r, &["security"]);
    assert!(
        text.contains(&format!(
            "0 where Drift found no guard in what it read, {} whose guard cannot be read, {} that verify a webhook signature (no sign-in by design)",
            unproven.len() + 1,
            verified.len()
        )),
        "{text}"
    );
    let (rest, signed) = text
        .split_once("\nEntry points that verify a webhook signature (no sign-in by design)\n")
        .unwrap_or_else(|| panic!("{text}"));
    for (route, by) in verified {
        assert!(!rest.contains(&format!(" {route} ")), "{route}: {text}");
        let line = signed
            .lines()
            .find(|l| l.contains(&format!(" {route} ")))
            .unwrap_or_else(|| panic!("{route}: {text}"));
        assert!(
            line.ends_with(&format!(
                "verifies a signature ({by}); no sign-in by design"
            )),
            "{line}"
        );
    }
    assert!(
        !text.contains("\nEntry points where Drift found no guard\n"),
        "{text}"
    );
    // The card says the same.
    let card = run(r, &["card", "web/app/api/svix/route.ts"]);
    assert!(
        card.contains("POST: verifies a signature (svix Webhook.verify); no sign-in by design"),
        "{card}"
    );

    // A change that adds them: `drift check` and `drift security` list the same
    // routes, the unproven ones (and the unread call), never a verified one.
    let check = json(r, &["check", "--diff-base", "main", "--format", "json"]);
    let mut from_check: Vec<String> = check["practices"]["added"]
        .as_array()
        .unwrap_or_else(|| panic!("{check:#}"))
        .iter()
        .map(|a| a["route"].as_str().unwrap().to_string())
        .collect();
    from_check.sort();
    let diff = json(r, &["security", "--diff-base", "main", "--json"]);
    let mut from_security: Vec<String> = diff["added_without_guard"]
        .as_array()
        .unwrap_or_else(|| panic!("{diff:#}"))
        .iter()
        .map(|a| a["route"].as_str().unwrap().to_string())
        .collect();
    from_security.sort();
    let mut want: Vec<String> = unproven
        .iter()
        .chain(&["/hooks/sign-only"])
        .map(|s| s.to_string())
        .collect();
    want.sort();
    assert_eq!(from_check, want);
    assert_eq!(from_security, want);
}

/// [STRICT] The practice map never reads `known` for a webhook whose verification can
/// be ignored, swallowed or made for some requests only: each shape that older drift
/// read as a service's check (`service_auth`) is unknown, `signature_not_proven`.
/// Every shape is asserted, and every one that fails is named.
#[test]
fn a_webhook_verification_that_can_be_skipped_is_never_known() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "svc/app/__init__.py", b"");
    write(r, "svc/app/main.py", PY_HOOKS.as_bytes());
    write(
        r,
        "web/package.json",
        br#"{"name":"web","dependencies":{"next":"15.0.0","stripe":"16.0.0","svix":"1.0.0","@octokit/webhooks":"13.0.0"}}"#,
    );
    for (name, body) in TS_HOOKS {
        write(r, &format!("web/app/api/{name}/route.ts"), body.as_bytes());
    }
    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let shapes = [
        // A Stripe verification whose failure the `except` only prints.
        "/hooks/stripe-logged",
        // A svix verification some requests skip.
        "/hooks/svix-branch",
        // A Stripe verification whose failure the `catch` only logs.
        "/api/stripe-logged",
        // octokit's `verify` answers a boolean; here it is ignored.
        "/api/octokit-ignored",
    ];
    let failures: Vec<String> = shapes
        .iter()
        .filter_map(|route| {
            let u = authn["units"]
                .as_array()
                .unwrap()
                .iter()
                .find(|u| u["route"] == *route)
                .unwrap_or_else(|| panic!("no unit {route}"));
            (u["assignment"] != "unknown" || u["reason"] != "signature_not_proven")
                .then(|| format!("{route}: {u}"))
        })
        .collect();
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// A credential compare (`crypto.timingSafeEqual`, `hmac.compare_digest`) answers a
/// boolean: it signs the caller in as a service only where that answer decides a
/// refusal. Tested and refused (in the condition, through a local, through a helper
/// that returns it): known, on the practice map and with a guard or `known_open` in
/// the inventory as before. Ignored, logged, or bound to a name never tested: never
/// known; read as the body is without it. Every shape is asserted, and every one that
/// fails is named.
#[test]
fn a_credential_compare_is_a_check_only_where_its_answer_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let head = "import { timingSafeEqual } from \"crypto\";\nconst secret = Buffer.from(process.env.CRON_SECRET ?? \"\");\nfunction valid(given: Buffer) {\n  return timingSafeEqual(given, secret);\n}\nexport async function GET(req: Request) {\n  const given = Buffer.from(req.headers.get(\"authorization\") ?? \"\");\n";
    let refused = "    return new Response(\"unauthorized\", { status: 401 });\n  }\n";
    let ts = [
        (
            "tested",
            format!(
                "  if (given.length !== secret.length || !timingSafeEqual(given, secret)) {{\n{refused}"
            ),
            true,
        ),
        (
            "tested-local",
            format!("  const ok = timingSafeEqual(given, secret);\n  if (!ok) {{\n{refused}"),
            true,
        ),
        (
            "helper",
            format!("  if (!valid(given)) {{\n{refused}"),
            true,
        ),
        (
            "ignored",
            "  timingSafeEqual(given, secret);\n".to_string(),
            false,
        ),
        (
            "logged",
            "  console.log(\"match\", timingSafeEqual(given, secret));\n".to_string(),
            false,
        ),
        (
            "assigned",
            "  const ok = timingSafeEqual(given, secret);\n".to_string(),
            false,
        ),
        ("helper-ignored", "  valid(given);\n".to_string(), false),
    ];
    write(
        r,
        "web/package.json",
        br#"{"name":"web","dependencies":{"next":"15.0.0"}}"#,
    );
    for (name, body, _) in &ts {
        write(
            r,
            &format!("web/app/api/{name}/route.ts"),
            format!("{head}{body}  return Response.json({{ ok: true }});\n}}\n").as_bytes(),
        );
    }
    let py = [
        (
            "tested",
            "    if not hmac.compare_digest(request.headers.get(\"authorization\", \"\"), SECRET):\n        raise HTTPException(status_code=401)\n",
            true,
        ),
        (
            "tested-local",
            "    ok = hmac.compare_digest(request.headers.get(\"authorization\", \"\"), SECRET)\n    if not ok:\n        raise HTTPException(status_code=401)\n",
            true,
        ),
        (
            "ignored",
            "    hmac.compare_digest(request.headers.get(\"authorization\", \"\"), SECRET)\n",
            false,
        ),
        (
            "logged",
            "    print(hmac.compare_digest(request.headers.get(\"authorization\", \"\"), SECRET))\n",
            false,
        ),
        (
            "assigned",
            "    ok = hmac.compare_digest(request.headers.get(\"authorization\", \"\"), SECRET)\n",
            false,
        ),
    ];
    let mut main = String::from(
        "import hmac\nimport os\n\nfrom fastapi import FastAPI, HTTPException, Request\n\napp = FastAPI()\nSECRET = os.environ[\"CRON_SECRET\"]\n",
    );
    for (i, (name, body, _)) in py.iter().enumerate() {
        main.push_str(&format!(
            "\n\n@app.get(\"/py/{name}\")\nasync def route_{i}(request: Request):\n{body}    return {{\"ok\": True}}\n"
        ));
    }
    write(r, "svc/app/__init__.py", b"");
    write(r, "svc/app/main.py", main.as_bytes());

    let p = json(r, &["practices", "--json", "--units"]);
    let authn = concern(&p, "authn");
    let inv = json(r, &["security", "--json"]);
    let mut failures = Vec::new();
    let cells = ts
        .iter()
        .map(|(n, _, k)| (format!("/api/{n}"), *k))
        .chain(py.iter().map(|(n, _, k)| (format!("/py/{n}"), *k)));
    for (route, checked) in cells {
        let u = authn["units"]
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["route"] == route.as_str())
            .unwrap_or_else(|| panic!("no unit {route}"));
        let e = inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["route"] == route.as_str())
            .unwrap_or_else(|| panic!("no row {route}"));
        let known = u["assignment"] == "known";
        if known != checked {
            failures.push(format!("{route}: the practice map says {u}"));
        }
        // Not checked: nothing in the inventory claims a guard for it either.
        if !checked && e["guards"] != json!([]) {
            failures.push(format!("{route}: the inventory says {e}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
