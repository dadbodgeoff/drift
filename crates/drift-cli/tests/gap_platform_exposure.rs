//! A repository deployed on a hosting platform: the platform's own file says how
//! what it deploys is reached (`crates/drift-mine/src/security/platforms.rs`). One
//! small application per platform file, each route read as the file says; a monorepo
//! whose one platform file does not say which application it deploys stays unknown
//! and is asked about in `drift setup`; and a security baseline written before these
//! files were read does not start failing.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

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

/// Runs Drift in `root`: exit code, stdout, stderr.
fn run(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
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

fn inventory(root: &Path) -> Value {
    let (code, out, err) = run(root, &["--no-cache", "security", "--json"]);
    assert_eq!(code, 0, "{err}");
    serde_json::from_str(&out).unwrap()
}

/// (exposure, boundary) of the entry points under `dir`.
fn under(inv: &Value, dir: &str) -> Vec<(String, String)> {
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["path"].as_str().unwrap().starts_with(&format!("{dir}/")))
        .map(|e| {
            (
                e["exposure"].as_str().unwrap().to_string(),
                e["boundary"].as_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

/// A Next.js application in `dir` with one route and no guard.
fn next_app(r: &Path, dir: &str, name: &str) {
    write(
        r,
        &format!("{dir}/package.json"),
        &format!("{{ \"name\": \"{name}\", \"dependencies\": {{ \"next\": \"15.0.0\" }} }}"),
    );
    write(
        r,
        &format!("{dir}/app/api/items/route.ts"),
        "export async function GET(req: Request) {\n  return Response.json([]);\n}\n",
    );
}

/// A FastAPI application in `dir` with one route and no guard.
fn fastapi_app(r: &Path, dir: &str) {
    write(
        r,
        &format!("{dir}/requirements.txt"),
        "fastapi==0.115.0\nmangum==0.19.0\n",
    );
    write(
        r,
        &format!("{dir}/app.py"),
        "from fastapi import FastAPI\nfrom mangum import Mangum\n\napp = FastAPI()\n\n\n@app.get(\"/items\")\nasync def items():\n    return []\n\n\nhandler = Mangum(app)\n",
    );
}

/// Every route of `dir` reads `exposure`, said by `file` at the start of the reason.
#[track_caller]
fn all_are(inv: &Value, dir: &str, exposure: &str, file: &str) {
    let rows = under(inv, dir);
    assert!(!rows.is_empty(), "no route under {dir}: {inv:#}");
    for (x, why) in &rows {
        assert_eq!(x, exposure, "{dir}: {why}\n{inv:#}");
        assert!(why.starts_with(&format!("{file}:")), "{dir}: {why}");
    }
}

/// Vercel, Netlify, Render, Heroku, App Engine, Fly.io: the platform serves the
/// application on a public URL, so its routes are internet-facing, with the file and
/// line that say so; the file read to the end is no longer listed as not read.
#[test]
fn a_platform_that_serves_on_a_public_url_makes_its_routes_internet_facing() {
    let cases: &[(&str, &str, &str)] = &[
        (
            "vercel.json",
            "{\"framework\": \"nextjs\"}\n",
            "Vercel serves",
        ),
        (
            "netlify.toml",
            "[build]\n  command = \"next build\"\n  publish = \".next\"\n",
            "Netlify serves",
        ),
        (
            "render.yaml",
            "services:\n  - type: web\n    name: web\n    runtime: node\n    buildCommand: npm run build\n    startCommand: npm start\n",
            "Render service `web` is a web service",
        ),
        (
            "fly.toml",
            "app = \"web\"\n\n[http_service]\n  internal_port = 3000\n  force_https = true\n",
            "the Fly proxy serves app `web`",
        ),
        ("Procfile", "web: npm start\n", "Heroku routes requests"),
        (
            "app.yaml",
            "runtime: nodejs20\nservice: web\n",
            "App Engine serves service `web`",
        ),
    ];
    for (file, text, says) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        next_app(r, "web", "web");
        write(r, &format!("web/{file}"), text);
        if *file == "Procfile" {
            write(r, "web/app.json", "{ \"name\": \"web\" }\n");
        }
        let inv = inventory(r);
        all_are(&inv, "web", "public", &format!("web/{file}"));
        let (_, why) = &under(&inv, "web")[0];
        assert!(why.contains(says), "{file}: {why}");
        let unread = inv["boundaries"]["unread"].as_array();
        assert!(
            unread.is_none_or(|u| u.is_empty()),
            "{file} is read to the end: {inv:#}"
        );
        assert_eq!(inv["boundaries"]["platforms"][0]["code"], "web", "{inv:#}");
    }
}

/// Internal only on proof: a Fly app with no service that publishes a port, a Render
/// private service and a worker are reached on the private network only; the same
/// files beside a description Drift does not read (here Terraform) say unknown.
#[test]
fn internal_only_where_the_platform_file_proves_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "api", "api");
    write(
        r,
        "api/fly.toml",
        "app = \"api\"\n\n[processes]\n  app = \"npm start\"\n",
    );
    let inv = inventory(r);
    all_are(&inv, "api", "internal", "api/fly.toml");
    assert!(under(&inv, "api")[0].1.contains("private network only"));
    let basis = &inv["entry_points"][0]["exposure_basis"];
    assert!(
        basis["descriptions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d == "api/fly.toml"),
        "{basis:#}"
    );

    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "inner", "inner");
    next_app(r, "jobs", "jobs");
    write(
        r,
        "render.yaml",
        "services:\n  - type: pserv\n    name: inner\n    rootDir: inner\n  - type: worker\n    name: jobs\n    rootDir: jobs\n",
    );
    let inv = inventory(r);
    all_are(&inv, "inner", "internal", "render.yaml");
    all_are(&inv, "jobs", "internal", "render.yaml");

    // Terraform Drift does not read may route to anything.
    write(r, "infra/main.tf", "resource \"aws_lb\" \"x\" {}\n");
    let inv = inventory(r);
    for (x, why) in under(&inv, "inner") {
        assert_eq!(x, "unknown", "{why}");
        assert!(why.contains("Terraform (infra/main.tf)"), "{why}");
    }
}

/// AWS SAM and the Serverless Framework: a function an HTTP event routes every path
/// to is internet-facing (an authorizer is named with it, its guard unknown), one
/// with no HTTP event is not, and one routed a single path is unknown (which of its
/// routes that is, is not read).
#[test]
fn functions_are_reached_as_their_events_say() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_app(r, "web");
    fastapi_app(r, "jobs");
    fastapi_app(r, "one");
    write(
        r,
        "template.yaml",
        "AWSTemplateFormatVersion: '2010-09-09'\nTransform: AWS::Serverless-2016-10-31\nGlobals:\n  Function:\n    Runtime: python3.12\nResources:\n  Web:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: web/\n      Handler: app.handler\n      Events:\n        Proxy:\n          Type: HttpApi\n          Properties:\n            Auth:\n              Authorizer: Jwt\n  Jobs:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: jobs/\n      Handler: app.handler\n      Events:\n        Queue:\n          Type: SQS\n          Properties:\n            Queue: !GetAtt Work.Arn\n  One:\n    Type: AWS::Serverless::Function\n    Properties:\n      CodeUri: one/\n      Handler: app.handler\n      Events:\n        Get:\n          Type: Api\n          Properties:\n            Path: /items\n            Method: get\n  Work:\n    Type: AWS::SQS::Queue\n",
    );
    write(r, "samconfig.toml", "version = 0.1\n");
    let inv = inventory(r);
    all_are(&inv, "web", "public", "template.yaml");
    assert!(
        under(&inv, "web")[0].1.contains("authorizer Jwt"),
        "{inv:#}"
    );
    all_are(&inv, "jobs", "internal", "template.yaml");
    all_are(&inv, "one", "unknown", "template.yaml");
    assert!(under(&inv, "one")[0].1.contains("GET /items only"));

    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_app(r, "svc");
    write(
        r,
        "svc/serverless.yml",
        "service: svc\nprovider:\n  name: aws\n  runtime: python3.12\nfunctions:\n  api:\n    handler: app.handler\n    events:\n      - http:\n          path: /{proxy+}\n          method: any\n",
    );
    let inv = inventory(r);
    all_are(&inv, "svc", "public", "svc/serverless.yml");
    std::fs::write(
        r.join("svc/serverless.yml"),
        "service: svc\nprovider:\n  name: aws\nfunctions:\n  nightly:\n    handler: app.handler\n    events:\n      - schedule: rate(1 day)\n",
    )
    .unwrap();
    let inv = inventory(r);
    all_are(&inv, "svc", "internal", "svc/serverless.yml");
}

/// Cloudflare Workers and Cloud Run: a worker on a route is internet-facing (its file
/// stays listed as not read: a worker may pass requests on to any origin); a Cloud
/// Run service names only an image, so its code is tied by a person
/// (`security.platforms`), and is then read as its ingress says.
#[test]
fn workers_and_cloud_run() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "edge", "edge");
    write(
        r,
        "edge/wrangler.toml",
        "name = \"edge\"\nmain = \"app/api/items/route.ts\"\nroutes = [{ pattern = \"api.example.com/*\", zone_name = \"example.com\" }]\n",
    );
    let inv = inventory(r);
    all_are(&inv, "edge", "public", "edge/wrangler.toml");
    assert_eq!(inv["boundaries"]["unread"][0]["kind"], "Cloudflare Workers");

    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_app(r, "api");
    write(
        r,
        "deploy/service.yaml",
        "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n  annotations:\n    run.googleapis.com/ingress: internal\nspec:\n  template:\n    spec:\n      containers:\n        - image: gcr.io/p/api\n",
    );
    let inv = inventory(r);
    for (x, _) in under(&inv, "api") {
        assert_eq!(x, "unknown");
    }
    assert!(
        inv["boundaries"]["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w
                .as_str()
                .unwrap()
                .starts_with("deploy/service.yaml: it runs `gcr.io/p/api`")),
        "{inv:#}"
    );
    write(
        r,
        ".drift/config.yaml",
        "security:\n  platforms:\n    - {file: deploy/service.yaml, code: api}\n",
    );
    let inv = inventory(r);
    all_are(&inv, "api", "internal", "deploy/service.yaml");
    assert!(under(&inv, "api")[0].1.contains("(security.platforms)"));
}

/// A monorepo root with one platform file that does not say which application it
/// deploys: every application stays unknown, the file stays listed as not read, and
/// `drift setup` asks which one it is. A person's answer (`security.platforms`) ties
/// it; a build command that selects a package ties it without asking; and a
/// directory with entry points of its own is what it deploys.
#[test]
fn a_monorepo_platform_file_that_does_not_say_which_application_stays_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"root\", \"private\": true, \"workspaces\": [\"apps/*\"] }",
    );
    next_app(r, "apps/web", "@acme/web");
    next_app(r, "apps/admin", "@acme/admin");
    write(r, "vercel.json", "{}\n");
    let inv = inventory(r);
    for dir in ["apps/web", "apps/admin"] {
        for (x, why) in under(&inv, dir) {
            assert_eq!(x, "unknown", "{dir}: {why}");
        }
    }
    assert_eq!(inv["boundaries"]["unread"][0]["kind"], "Vercel", "{inv:#}");
    assert_eq!(
        inv["boundaries"]["platforms"][0]["candidates"],
        serde_json::json!(["apps/admin", "apps/web"])
    );
    let (code, out, err) = run(r, &["--no-cache", "setup", "--json"]);
    assert_eq!(code, 0, "{err}");
    let setup: Value = serde_json::from_str(&out).unwrap();
    let q = setup["questions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["kind"] == "platform")
        .unwrap_or_else(|| panic!("no platform question: {setup:#}"));
    assert_eq!(
        q["question"],
        "Which application does `vercel.json` deploy?"
    );
    let tie = q["choices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["label"] == "It deploys `apps/web`")
        .unwrap();
    assert_eq!(tie["writes_under"], "security.platforms");
    assert_eq!(tie["needs_person"], true);
    assert_eq!(
        tie["writes"],
        "- {file: \"vercel.json\", code: \"apps/web\"}"
    );

    // The person's word.
    write(
        r,
        ".drift/config.yaml",
        "security:\n  platforms:\n    - {file: vercel.json, code: apps/web}\n",
    );
    let inv = inventory(r);
    all_are(&inv, "apps/web", "public", "vercel.json");
    for (x, _) in under(&inv, "apps/admin") {
        assert_eq!(x, "unknown");
    }

    // The build command selects the package.
    std::fs::remove_file(r.join(".drift/config.yaml")).unwrap();
    write(
        r,
        "vercel.json",
        "{\"buildCommand\": \"turbo run build --filter=@acme/admin\"}\n",
    );
    let inv = inventory(r);
    all_are(&inv, "apps/admin", "public", "vercel.json");
    for (x, _) in under(&inv, "apps/web") {
        assert_eq!(x, "unknown");
    }

    // Only one package below has entry points: the file still does not say it
    // deploys that one, so it stays unknown and is asked about.
    write(r, "vercel.json", "{}\n");
    std::fs::remove_dir_all(r.join("apps/admin/app")).unwrap();
    let inv = inventory(r);
    for (x, why) in under(&inv, "apps/web") {
        assert_eq!(x, "unknown", "apps/web: {why}");
    }
    assert_eq!(
        inv["boundaries"]["platforms"][0]["candidates"],
        serde_json::json!(["apps/web"])
    );

    // The directory it deploys has an application of its own: that is what it
    // serves, and the package below, which it does not say it serves, is unknown.
    write(
        r,
        "package.json",
        "{ \"name\": \"root\", \"private\": true, \"workspaces\": [\"apps/*\"], \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(
        r,
        "app/api/items/route.ts",
        "export async function GET(req: Request) {\n  return Response.json([]);\n}\n",
    );
    let inv = inventory(r);
    all_are(&inv, "app", "public", "vercel.json");
    for (x, why) in under(&inv, "apps/web") {
        assert_eq!(x, "unknown", "apps/web: {why}");
        assert!(why.contains("an application of its own"), "{why}");
    }
    // Tied so, the file is read to the end: no longer listed as not read.
    assert!(
        inv["boundaries"]["unread"]
            .as_array()
            .is_none_or(|u| u.is_empty()),
        "{inv:#}"
    );
    assert!(
        !inv["boundaries"]["warnings"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|w| w
                .as_str()
                .unwrap()
                .starts_with("Vercel in the repository is not read")),
        "{inv:#}"
    );
}

/// A security baseline written before the platform's file was read (here: before it
/// was there, when every route read unknown) does not start failing: exposure is no
/// part of a finding's key, so a route newly read as internet-facing adds none.
#[test]
fn an_old_baseline_does_not_fail_when_a_route_turns_internet_facing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", "web");
    let (code, _, err) = run(r, &["--no-cache", "security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let before = inventory(r);
    assert_eq!(under(&before, "web")[0].0, "unknown");
    write(
        r,
        "web/fly.toml",
        "app = \"web\"\n\n[http_service]\n  internal_port = 3000\n",
    );
    assert_eq!(under(&inventory(r), "web")[0].0, "public");
    let (code, out, err) = run(r, &["--no-cache", "security", "--ratchet"]);
    assert_eq!(code, 0, "{out}\n{err}");
    let (code, out, err) = run(r, &["--no-cache", "security", "--ratchet", "--json"]);
    assert_eq!(code, 0, "{err}");
    let ratchet: Value = serde_json::from_str(&out).unwrap();
    assert!(
        ratchet["added"].as_object().is_none_or(|a| a.is_empty()),
        "{ratchet:#}"
    );
}
