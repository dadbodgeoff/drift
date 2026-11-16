//! Serverless functions and Workers are entry points (`drift_mine::serverless`).
//!
//! Before, nothing made a Lambda handler, a Worker or a Netlify or Vercel function an
//! entry point: a repository of them had an empty security inventory. The deployment
//! file says which export of which file the platform invokes and by what, and each
//! one is now listed with that kind and route, in the listed reading only (mining is
//! frozen). What the configuration does not settle is reported as not listed, never
//! guessed, and a guard the platform applies is named and its verdict is unknown.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

fn json(root: &Path, args: &[&str]) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// `drift security --json`: each entry point as `kind METHOD route path#symbol
/// verdict` (`guarded`, `unknown` or `none`), and each place not listed as
/// `path:line what`, sorted.
fn security(root: &Path) -> (Vec<String>, Vec<String>, Value) {
    let v = json(root, &["security", "--json"]);
    let mut rows: Vec<String> = v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let some = |key: &str| e[key].as_array().is_some_and(|a| !a.is_empty());
            let verdict = match (some("guards"), some("opaque")) {
                (true, _) => "guarded",
                (false, true) => "unknown",
                (false, false) => "none",
            };
            format!(
                "{} {} {} {}#{} {verdict}",
                e["kind"].as_str().unwrap_or_default(),
                e["method"].as_str().unwrap_or("-"),
                e["route"].as_str().unwrap_or_default(),
                e["path"].as_str().unwrap_or_default(),
                e["symbol"].as_str().unwrap_or_default(),
            )
        })
        .collect();
    rows.sort();
    let mut unlisted: Vec<String> = v["unlisted"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|u| {
            format!(
                "{}:{} {}",
                u["path"].as_str().unwrap_or_default(),
                u["line"],
                u["symbol"].as_str().unwrap_or_default()
            )
        })
        .collect();
    unlisted.sort();
    (rows, unlisted, v)
}

fn opaque_of<'v>(v: &'v Value, route: &str) -> Vec<&'v str> {
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["route"] == route)
        .flat_map(|e| e["opaque"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect()
}

const SERVERLESS_YML: &str = "service: users
provider:
  name: aws
  runtime: nodejs20.x
functions:
  getUser:
    handler: src/users.getUser
    events:
      - http:
          path: users/{id}
          method: get
          authorizer: checkToken
      - httpApi: 'POST /users'
  nightly:
    handler: src/jobs.nightly
    events:
      - schedule: rate(1 day)
  onMessage:
    handler: src/jobs.onMessage
    events:
      - sqs: arn:aws:sqs:us-east-1:1:q
  direct:
    handler: src/jobs.direct
  missing:
    handler: src/gone.handler
    events:
      - http: GET /gone
  templated:
    handler: ${self:custom.entry}
";

/// Pins the Serverless Framework: each function's handler is an entry point of the
/// kind its events say (an HTTP route with its method and path, a schedule's
/// `cron`, a queue's `consumer`, a function with no event `job`); an authorizer on
/// the event is named and leaves the verdict unknown; a handler that names no file
/// of the repository, or is written with a variable, is not listed and is reported
/// where it is written. In the facts it is in the listed reading only.
#[test]
fn serverless_framework_functions_are_entry_points() {
    let dir = write(&[
        ("package.json", "{ \"name\": \"svc\" }\n"),
        ("serverless.yml", SERVERLESS_YML),
        (
            "src/users.ts",
            "export const getUser = async (event: any) => {\n  return { statusCode: 200, body: event.body };\n};\n",
        ),
        (
            "src/jobs.ts",
            "export async function nightly() {\n  return 1;\n}\nexport async function onMessage(event: any) {\n  return event.Records.length;\n}\nexport async function direct(event: any) {\n  return event;\n}\n",
        ),
    ]);
    let (rows, unlisted, v) = security(dir.path());
    assert_eq!(
        rows,
        [
            "consumer - onMessage src/jobs.ts#onMessage none",
            "cron - nightly src/jobs.ts#nightly none",
            "http GET /users/{id} src/users.ts#getUser unknown",
            "http POST /users src/users.ts#getUser none",
            "job - direct src/jobs.ts#direct none",
        ]
    );
    assert_eq!(
        opaque_of(&v, "/users/{id}"),
        ["authorizer checkToken (serverless.yml:9)"]
    );
    assert_eq!(
        unlisted,
        [
            "serverless.yml:25 src/gone.handler",
            "serverless.yml:29 ${self:custom.entry}",
        ]
    );
    // Mining reads the measured entry points, which these are not among.
    let facts = json(dir.path(), &["scan", "--json"]);
    let users = facts["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "src/users.ts")
        .unwrap();
    assert!(
        users["entry_points"].as_array().unwrap().is_empty(),
        "{users}"
    );
    assert_eq!(users["listed"]["entry_points"][0]["adapter"], "serverless");
}

/// Pins a monorepo of two services: each handler is resolved from its own service's
/// directory, and a Python runtime's handler names a Python file.
#[test]
fn each_service_of_a_monorepo_resolves_from_its_own_directory() {
    let dir = write(&[
        ("package.json", "{ \"name\": \"mono\" }\n"),
        (
            "services/a/serverless.yml",
            "service: a\nprovider:\n  name: aws\n  runtime: nodejs20.x\nfunctions:\n  main:\n    handler: handler.main\n    events:\n      - httpApi:\n          method: get\n          path: /a\n",
        ),
        (
            "services/a/handler.ts",
            "export const main = async (event: any) => ({ statusCode: 200, body: event.body });\n",
        ),
        (
            "services/b/serverless.yml",
            "service: b\nprovider:\n  name: aws\n  runtime: python3.12\nfunctions:\n  create:\n    handler: src/index.handler\n    events:\n      - http: POST b\n",
        ),
        (
            "services/b/src/index.py",
            "def handler(event, context):\n    return {\"statusCode\": 200, \"body\": event[\"body\"]}\n",
        ),
    ]);
    let (rows, unlisted, _) = security(dir.path());
    assert_eq!(
        rows,
        [
            "http GET /a services/a/handler.ts#main none",
            "http POST /b services/b/src/index.py#handler none",
        ]
    );
    assert!(unlisted.is_empty(), "{unlisted:?}");
}

const SAM_TEMPLATE: &str = "AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: nodejs20.x
    CodeUri: app/
  Api:
    Auth:
      DefaultAuthorizer: MyCognito
Resources:
  ListFn:
    Type: AWS::Serverless::Function
    Properties:
      Handler: list.handler
      Events:
        List:
          Type: Api
          Properties:
            Path: /items
            Method: get
        Health:
          Type: Api
          Properties:
            Path: /health
            Method: get
            Auth:
              Authorizer: NONE
  QueueFn:
    Type: AWS::Serverless::Function
    Properties:
      Handler: queue.handler
      Events:
        Q:
          Type: SQS
          Properties:
            Queue: !GetAtt Q.Arn
  RefFn:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: !Ref CodeLocation
      Handler: x.handler
";

/// Pins AWS SAM: `Globals` give each function its code directory and runtime; an
/// `Api` event is a route, under the API's default authorizer (named, verdict
/// unknown) unless the event says `Authorizer: NONE`; an `SQS` event is a consumer;
/// a `CodeUri` written with an intrinsic function is not guessed.
#[test]
fn sam_functions_are_entry_points() {
    let dir = write(&[
        ("package.json", "{ \"name\": \"sam\" }\n"),
        ("template.yaml", SAM_TEMPLATE),
        (
            "app/list.ts",
            "export const handler = async (event: any) => ({ statusCode: 200, body: event.body });\n",
        ),
        (
            "app/queue.ts",
            "export const handler = async (event: any) => event.Records.length;\n",
        ),
    ]);
    let (rows, unlisted, v) = security(dir.path());
    assert_eq!(
        rows,
        [
            "consumer - QueueFn app/queue.ts#handler none",
            "http GET /health app/list.ts#handler none",
            "http GET /items app/list.ts#handler unknown",
        ]
    );
    assert_eq!(
        opaque_of(&v, "/items"),
        ["default authorizer MyCognito of Globals (template.yaml)"]
    );
    assert_eq!(unlisted, ["template.yaml:40 RefFn CodeUri"]);
}

/// Pins Cloudflare Workers: the default export's `fetch` serves every path, its
/// `scheduled` runs on the configured crons, and a Durable Object class the Worker
/// declares is run by the Worker's own code.
#[test]
fn worker_handlers_are_entry_points() {
    let dir = write(&[
        ("package.json", "{ \"name\": \"edge\" }\n"),
        (
            "wrangler.toml",
            "name = \"edge\"\nmain = \"src/index.ts\"\n\n[triggers]\ncrons = [\"0 * * * *\"]\n\n[[durable_objects.bindings]]\nname = \"COUNTER\"\nclass_name = \"Counter\"\n",
        ),
        (
            "src/index.ts",
            "export default {\n  async fetch(request: Request) {\n    const u = new URL(request.url);\n    return new Response(u.searchParams.get(\"q\"));\n  },\n  async scheduled() {\n    return;\n  },\n};\n\nexport class Counter {\n  async fetch(req: Request) {\n    return new Response(\"1\");\n  }\n}\n",
        ),
    ]);
    let (rows, unlisted, _) = security(dir.path());
    assert_eq!(
        rows,
        [
            "cron - edge src/index.ts#default.scheduled none",
            "http ANY /* src/index.ts#default.fetch none",
            "job - Counter src/index.ts#Counter none",
        ]
    );
    assert!(unlisted.is_empty(), "{unlisted:?}");
}

/// Pins a Worker that hands its requests to a Hono app (`export default app`, and
/// `export default { fetch: app.fetch }` of an app in another file): the app's
/// routes are listed once, by the Hono adapter, and no catch-all `fetch` beside
/// them; a `wrangler.jsonc` with comments is read.
#[test]
fn a_worker_serving_a_hono_app_is_listed_once() {
    let hono = "import { Hono } from \"hono\";\nconst app = new Hono();\napp.get(\"/users/:id\", (c) => c.json({ id: c.req.param(\"id\") }));\nexport default app;\n";
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"edge\", \"dependencies\": { \"hono\": \"4.6.0\" } }\n",
        ),
        (
            "wrangler.jsonc",
            "{\n  // the API\n  \"name\": \"api\",\n  \"main\": \"src/index.ts\",\n}\n",
        ),
        ("src/index.ts", hono),
        (
            "workers/b/wrangler.toml",
            "name = \"b\"\nmain = \"index.ts\"\n",
        ),
        (
            "workers/b/app.ts",
            "import { Hono } from \"hono\";\nconst app = new Hono();\napp.post(\"/b\", (c) => c.json({}));\nexport default app;\n",
        ),
        (
            "workers/b/index.ts",
            "import app from \"./app\";\nexport default {\n  fetch: app.fetch,\n};\n",
        ),
    ]);
    let (rows, unlisted, _) = security(dir.path());
    assert_eq!(
        rows,
        [
            "http GET /users/:id src/index.ts#GET /users/:id none",
            "http POST /b workers/b/app.ts#POST /b none",
        ]
    );
    assert!(unlisted.is_empty(), "{unlisted:?}");
}

/// Pins Netlify and Vercel functions: a file of `netlify/functions` exporting
/// `handler` is served at `/.netlify/functions/<name>` (one built with `schedule`
/// runs on a schedule), and a file of `api/` beside a `vercel.json` at its path (its
/// default export for every method, an exported method for that one); files under
/// `_` are not functions.
#[test]
fn netlify_and_vercel_functions_are_entry_points() {
    let dir = write(&[
        (
            "package.json",
            "{ \"name\": \"fns\", \"dependencies\": { \"@netlify/functions\": \"2.8.0\" } }\n",
        ),
        (
            "netlify/functions/hello.ts",
            "export const handler = async (event: any) => ({ statusCode: 200, body: event.body });\n",
        ),
        (
            "netlify/functions/daily.ts",
            "import { schedule } from \"@netlify/functions\";\nexport const handler = schedule(\"@daily\", async () => ({ statusCode: 200 }));\n",
        ),
        ("vercel.json", "{}\n"),
        (
            "api/users/[id].ts",
            "export default function handler(req: any, res: any) {\n  res.json({ id: req.query.id });\n}\n",
        ),
        (
            "api/hello.ts",
            "export function GET(request: Request) {\n  return new Response(\"hi\");\n}\n",
        ),
        (
            "api/_lib/db.ts",
            "export default function db() {\n  return 1;\n}\n",
        ),
    ]);
    let (rows, unlisted, _) = security(dir.path());
    assert_eq!(
        rows,
        [
            // The `schedule(...)` wrapper is a package's that no list reads: unknown.
            "cron - /.netlify/functions/daily netlify/functions/daily.ts#handler unknown",
            "http ANY /.netlify/functions/hello netlify/functions/hello.ts#handler none",
            "http ANY /api/users/[id] api/users/[id].ts#default none",
            "http GET /api/hello api/hello.ts#GET none",
        ]
    );
    assert!(unlisted.is_empty(), "{unlisted:?}");
}
