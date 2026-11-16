//! `drift security` reads the deployment boundary from `.drift/config.yaml`
//! (`security: {internal, public}`) and from compose files at any depth, names each
//! entry point's exposure and its source, and lists internet-facing entry points
//! first. It hides nothing: an unguarded internal route is still unguarded.

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

const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
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
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn exposure_comes_from_compose_and_config_with_config_winning() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"root\", \"workspaces\": [\"apps/*\"] }",
    );
    for app in ["web", "admin", "worker", "tools"] {
        write(
            r,
            &format!("apps/{app}/package.json"),
            &format!("{{ \"name\": \"{app}\", \"dependencies\": {{ \"next\": \"15.0.0\" }} }}"),
        );
        write(r, &format!("apps/{app}/app/api/x/route.ts"), UNGUARDED);
    }
    // web publishes a port; worker does not; admin publishes one but a person says it
    // sits behind the gateway; tools is in no compose service and no setting.
    write(
        r,
        "docker-compose.yml",
        "services:\n  web:\n    build: ./apps/web\n    ports:\n      - \"3000:3000\"\n  admin:\n    build:\n      context: apps/admin\n    ports: [\"3001:3001\"]\n  worker:\n    build: ./apps/worker\n  db:\n    image: postgres\n",
    );
    write(
        r,
        ".drift/config.yaml",
        "security:\n  internal: [apps/admin]\n",
    );

    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let by_path = |p: &str| -> Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["path"] == p)
            .cloned()
            .unwrap()
    };
    let web = by_path("apps/web/app/api/x/route.ts");
    assert_eq!(web["exposure"], "public");
    assert_eq!(
        web["boundary"],
        "compose service web in docker-compose.yml publishes ports"
    );
    let admin = by_path("apps/admin/app/api/x/route.ts");
    assert_eq!(admin["exposure"], "internal");
    assert_eq!(admin["boundary"], "config security.internal");
    let worker = by_path("apps/worker/app/api/x/route.ts");
    assert_eq!(worker["exposure"], "internal");
    assert_eq!(
        worker["boundary"],
        "compose service worker in docker-compose.yml publishes no ports"
    );
    let tools = by_path("apps/tools/app/api/x/route.ts");
    assert_eq!(tools["exposure"], "unknown");
    assert!(tools.get("boundary").is_none(), "{tools}");
    let rules = inv["boundaries"]["rules"].as_array().unwrap();
    assert_eq!(rules.len(), 3, "{rules:#?}");
    assert_eq!(rules[0]["dir"], "apps/admin");
    assert_eq!(rules[0]["source"], "config security.internal");

    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("Exposure: 1 internet-facing, 2 internal in what Drift read, 1 unknown (from .drift/config.yaml and compose files)\n"),
        "{text}"
    );
    let section = &text[text
        .find("\nEntry points where Drift found no guard\n")
        .unwrap()..];
    let rows: Vec<&str> = section.lines().skip(2).take(4).collect();
    assert_eq!(
        rows,
        [
            "  http GET /api/x  apps/web/app/api/x/route.ts:1  internet-facing (compose service web in docker-compose.yml publishes ports)",
            "  http GET /api/x  apps/tools/app/api/x/route.ts:1",
            "  http GET /api/x  apps/admin/app/api/x/route.ts:1  internal in what Drift read (config security.internal)",
            "  http GET /api/x  apps/worker/app/api/x/route.ts:1  internal in what Drift read (compose service worker in docker-compose.yml publishes no ports)",
        ]
    );
    assert!(!r.join(".drift/conventions.yaml").exists());
}

/// A FastAPI service in `dir`: the `rules` router mounted under `/v1` and again under
/// `/v2`, an `internal` router under `/internal/v1`, and `/health` on the app.
fn fastapi_service(r: &Path, dir: &str, app: &str) {
    write(
        r,
        &format!("{dir}/pyproject.toml"),
        "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, &format!("{dir}/app/__init__.py"), "");
    // What it starts with: a route is internal only when that is read too.
    write(
        r,
        &format!("{dir}/Dockerfile"),
        "FROM python:3.12\nWORKDIR /app\nCOPY . /app\nCMD [\"uvicorn\", \"app.main:app\", \"--host\", \"0.0.0.0\"]\n",
    );
    write(
        r,
        &format!("{dir}/app/rules.py"),
        "from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n\n\n@router.get(\"\")\nasync def list_rules():\n    return []\n\n\n@router.get(\"/{rule_id}\")\nasync def get_rule(rule_id: str):\n    return {}\n",
    );
    write(
        r,
        &format!("{dir}/app/internal.py"),
        "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.post(\"/jobs/lease\")\nasync def lease_job():\n    return {}\n",
    );
    write(
        r,
        &format!("{dir}/app/main.py"),
        &format!(
            "from fastapi import FastAPI\n\nfrom app.internal import router as internal_router\nfrom app.rules import router as rules_router\n\napp = {app}\napp.include_router(rules_router, prefix=\"/v1\")\napp.include_router(rules_router, prefix=\"/v2\")\napp.include_router(internal_router, prefix=\"/internal/v1\")\n\n\n@app.get(\"/health\")\nasync def health():\n    return {{}}\n"
        ),
    );
}

/// An nginx gateway in front of `api`, which publishes no ports, with `conf` as its
/// configuration; `more` is further services of the compose file.
fn behind_nginx(r: &Path, conf: &str, more: &str) {
    write(
        r,
        "services/compose.yaml",
        &format!(
            "services:\n  gateway:\n    image: nginx:alpine\n    ports: [\"9000:80\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n    depends_on: [api]\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n{more}"
        ),
    );
    write(r, "services/nginx.conf", conf);
}

/// (exposure, boundary) of each http entry point, by method and route.
fn exposures(r: &Path) -> std::collections::BTreeMap<String, (String, String)> {
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "http")
        .map(|e| {
            let text = |k: &str| e[k].as_str().unwrap_or_default().to_string();
            (
                format!("{} {}", text("method"), text("route")),
                (text("exposure"), text("boundary")),
            )
        })
        .collect()
}

/// The rewrites the measured repository writes on every location: they keep the path.
const RULES_V1: &str = "  location /v1/rules {\n    rewrite ^/v1/rules/?(.+)$ /v1/rules/$1 break;\n    rewrite ^/v1/rules/?$ /v1/rules break;\n    proxy_pass http://api:8000;\n    proxy_set_header Host $host;\n  }\n";

/// Behind an nginx gateway, exposure is each route's: internet-facing where a location
/// proxies its path to the service, internal where none can, the gateway being the
/// only way in. A router mounted twice has a route for each mount. A service that
/// publishes its own ports stays internet-facing whatever the gateway routes.
#[test]
fn a_gateway_makes_exposure_a_matter_of_each_route() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    fastapi_service(r, "services/direct", "FastAPI()");
    fastapi_service(r, "services/worker", "FastAPI()");
    behind_nginx(
        r,
        &format!(
            "server {{\n  listen 80;\n{RULES_V1}  location /v2/rules {{ proxy_pass http://api:8000; }}\n  location = /health {{ proxy_pass http://api:8000; }}\n}}\n"
        ),
        "  direct:\n    build: ./direct\n    ports: [\"8001:8000\"]\n  worker:\n    build: ./worker\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let rows: Vec<String> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let text = |k: &str| e[k].as_str().unwrap_or_default().to_string();
            format!(
                "{} {} {} | {} | {}",
                text("path").split('/').nth(1).unwrap_or_default(),
                text("method"),
                text("route"),
                text("exposure"),
                text("boundary")
            )
        })
        .collect();
    let gw = "gateway gateway (services/nginx.conf)";
    let inside = "reachable only inside the compose network";
    let direct = "compose service direct in services/compose.yaml publishes ports";
    assert_eq!(
        rows,
        [
            format!(
                "api POST /internal/v1/jobs/lease | internal | {gw} routes no location to /internal/v1/jobs/lease on api: {inside}"
            ),
            format!("api GET /health | public | {gw} routes = /health to api"),
            format!("api GET /v1/rules/{{rule_id}} | public | {gw} routes /v1/rules to api"),
            format!("api GET /v2/rules/{{rule_id}} | public | {gw} routes /v2/rules to api"),
            format!("api GET /v1/rules | public | {gw} routes /v1/rules to api"),
            format!("api GET /v2/rules | public | {gw} routes /v2/rules to api"),
            format!("direct POST /internal/v1/jobs/lease | public | {direct}"),
            format!("direct GET /health | public | {direct}"),
            format!("direct GET /v1/rules/{{rule_id}} | public | {direct}"),
            format!("direct GET /v2/rules/{{rule_id}} | public | {direct}"),
            format!("direct GET /v1/rules | public | {direct}"),
            format!("direct GET /v2/rules | public | {direct}"),
            format!(
                "worker POST /internal/v1/jobs/lease | internal | {gw} routes no location to /internal/v1/jobs/lease on worker: {inside}"
            ),
            format!(
                "worker GET /health | internal | {gw} routes no location to /health on worker: {inside}"
            ),
            format!(
                "worker GET /v1/rules/{{rule_id}} | internal | {gw} routes no location to /v1/rules/{{rule_id}} on worker: {inside}"
            ),
            format!(
                "worker GET /v2/rules/{{rule_id}} | internal | {gw} routes no location to /v2/rules/{{rule_id}} on worker: {inside}"
            ),
            format!(
                "worker GET /v1/rules | internal | {gw} routes no location to /v1/rules on worker: {inside}"
            ),
            format!(
                "worker GET /v2/rules | internal | {gw} routes no location to /v2/rules on worker: {inside}"
            ),
        ],
        "{rows:#?}"
    );
    // The rule of a directory is the service's as a whole, and still names compose.
    let rules: Vec<(&str, &str, &str)> = inv["boundaries"]["rules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| {
            (
                x["dir"].as_str().unwrap(),
                x["exposure"].as_str().unwrap(),
                x["source"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rules,
        [
            (
                "services/api",
                "public",
                "compose service api in services/compose.yaml is routed by gateway gateway"
            ),
            ("services/direct", "public", direct),
            (
                "services/worker",
                "internal",
                "compose service worker in services/compose.yaml publishes no ports and gateway gateway routes nothing to it"
            ),
        ]
    );
    assert!(inv["boundaries"].get("warnings").is_none(), "{inv}");

    // Text, the card and the edit-time facts read the same exposure.
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("Exposure: 11 internet-facing, 7 internal in what Drift read, 0 unknown (from compose files)\n"),
        "{text}"
    );
    assert!(
        text.contains(&format!("  http POST /internal/v1/jobs/lease  services/api/app/internal.py:6  internal in what Drift read ({gw} routes no location to /internal/v1/jobs/lease on api: {inside})\n")),
        "{text}"
    );
    let card = drift(r, &["--no-cache", "card", "services/api/app/rules.py"]);
    assert!(
        card.contains(&format!("internet-facing ({gw} routes /v2/rules to api)")),
        "{card}"
    );
    let card = drift(r, &["--no-cache", "card", "services/api/app/internal.py"]);
    assert!(
        card.contains(&format!(
            "internal in what Drift read ({gw} routes no location to /internal/v1/jobs/lease on api: {inside})"
        )),
        "{card}"
    );
    assert!(!card.contains("exposure ("), "{card}");
}

/// [STRICT] "Internal" said of a public route is the dangerous error. Whatever the
/// gateway may do that Drift does not read makes the route unknown, never internal,
/// and names what was not read.
#[test]
fn what_a_gateway_may_route_is_unknown_never_internal() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let base = format!(
        "{RULES_V1}  location /v2/rules {{ proxy_pass http://api:8000; }}\n  location = /health {{ proxy_pass http://api:8000; }}\n"
    );
    let gw = "gateway gateway (services/nginx.conf)";
    // (what the configuration adds, the app, what the boundary says)
    let cases: [(&str, &str, &str, String); 9] = [
        (
            "",
            "",
            "FastAPI()",
            format!("internal|{gw} routes no location to /internal/v1/jobs/lease on api: reachable only inside the compose network"),
        ),
        (
            "include extra/*.conf;\n",
            "",
            "FastAPI()",
            format!("unknown|{gw} may route /internal/v1/jobs/lease to api: not all of it is read (services/nginx.conf:1: `include` is not followed)"),
        ),
        (
            "",
            // A plain anchored prefix (`~ ^/int`) is evaluated; this one is not.
            "  location ~ ^/(int|ext) { proxy_pass http://api:8000; }\n",
            "FastAPI()",
            format!("unknown|{gw} may route /internal/v1/jobs/lease to api: location ~ ^/(int|ext) is a regular expression, which Drift does not evaluate"),
        ),
        (
            "",
            "  location /internal { proxy_pass http://$backend; }\n",
            "FastAPI()",
            format!("unknown|{gw} may route /internal/v1/jobs/lease to api: location /internal proxies to a host Drift cannot resolve and may carry it, which Drift could not confirm"),
        ),
        // A longer location answers by itself, but only for the paths it matches as
        // nginx compares them: the shorter one to the service is not ruled out.
        (
            "",
            "  location / { proxy_pass http://api:8000; }\n  location /internal { return 403; }\n",
            "FastAPI()",
            format!("unknown|{gw} may route /internal/v1/jobs/lease to api: location / may carry it, which Drift could not confirm"),
        ),
        // A rewrite that is not evaluated may produce the path.
        (
            "",
            "  location /pub/ {\n    rewrite ^/pub/(\\w+)$ /internal/v1/jobs/$1 break;\n    proxy_pass http://api:8000;\n  }\n",
            "FastAPI()",
            format!("unknown|{gw} may route /internal/v1/jobs/lease to api: location /pub/ may carry it, which Drift could not confirm"),
        ),
        // The service answers at a location where Drift reads no route of it: its
        // routes may be mounted under a prefix Drift does not see.
        (
            "",
            "  location /svc { proxy_pass http://api:8000; }\n",
            "FastAPI()",
            format!("unknown|{gw} routes /svc to api, where Drift reads no route of it: its routes may be served under a prefix"),
        ),
        // FastAPI answers `/<root path>/<route>` as well as `/<route>`.
        (
            "",
            "",
            "FastAPI(title=\"api\", root_path=\"/health\")",
            "unknown|Drift does not know what `FastAPI(root_path=...)` (services/api/app/main.py:6) does to the paths of api".to_string(),
        ),
        // A rewrite that is evaluated and produces the path: internet-facing.
        (
            "",
            "  location /pub/ {\n    rewrite ^/pub/(.*)$ /internal/v1/jobs/$1 break;\n    proxy_pass http://api:8000;\n  }\n",
            "FastAPI()",
            format!("public|{gw} routes /pub/ to api"),
        ),
    ];
    for (before, locations, app, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", app);
        behind_nginx(
            r,
            &format!("{before}server {{\n  listen 80;\n{base}{locations}}}\n"),
            "",
        );
        let got = exposures(r);
        let (exposure, boundary) = &got[CLAIM];
        assert_eq!(format!("{exposure}|{boundary}"), want, "{locations}{app}");
        // What a location does route stays internet-facing.
        assert_eq!(got["GET /v1/rules/{rule_id}"].0, "public", "{locations}");
    }

    // What is not read is said once, with the exposure counts.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    behind_nginx(
        r,
        &format!("include extra/*.conf;\nserver {{\n{base}}}\n"),
        "",
    );
    let compose = std::fs::read_to_string(r.join("services/compose.yaml")).unwrap();
    write(
        r,
        "services/compose.yaml",
        &compose.replace(
            "    depends_on: [api]\n",
            "    command: [\"nginx\", \"-g\", \"daemon off;\"]\n",
        ),
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("gateway gateway: what its 'command' does is not read (and 1 more not read): so what gateway gateway routes is not all known, and a route it does not match is unknown, not internal\n"),
        "{text}"
    );
    assert!(
        text.contains("Exposure: 5 internet-facing, 0 internal in what Drift read, 1 unknown"),
        "{text}"
    );

    // A person's setting keeps precedence over what the gateway says, both ways.
    for (setting, exposure) in [("internal", "internal"), ("public", "public")] {
        write(
            r,
            ".drift/config.yaml",
            &format!("security:\n  {setting}: [services/api]\n"),
        );
        for (route, (got, boundary)) in exposures(r) {
            assert_eq!(got, exposure, "{route}");
            assert_eq!(boundary, format!("config security.{setting}"), "{route}");
        }
    }
}

/// Drift reads one mount of an Express router, so a route of a service the gateway
/// routes to is not said to be internal; a service it routes nothing to is.
#[test]
fn a_route_whose_other_mounts_are_not_read_is_not_said_to_be_internal() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    for svc in ["api", "jobs"] {
        write(
            r,
            &format!("services/{svc}/package.json"),
            &format!("{{ \"name\": \"{svc}\", \"dependencies\": {{ \"express\": \"4.19.0\" }} }}"),
        );
        write(
            r,
            &format!("services/{svc}/Dockerfile"),
            "FROM node:22\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"dist/app.js\"]\n",
        );
        write(
            r,
            &format!("services/{svc}/src/app.ts"),
            "import express from \"express\";\n\nconst app = express();\n\nexport function listUsers(req: any, res: any) {\n  res.json([]);\n}\n\nexport function purge(req: any, res: any) {\n  res.json({});\n}\n\napp.get(\"/api/users\", listUsers);\napp.post(\"/internal/purge\", purge);\n\nexport default app;\n",
        );
    }
    write(
        r,
        "compose.yaml",
        "services:\n  gateway:\n    image: nginx:alpine\n    ports: [\"80:80\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n  api:\n    build: ./services/api\n  jobs:\n    build: ./services/jobs\n",
    );
    write(
        r,
        "nginx.conf",
        "server {\n  location /api { proxy_pass http://api:3000; }\n}\n",
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let rows: Vec<String> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            format!(
                "{} {} | {} | {}",
                e["path"].as_str().unwrap(),
                e["route"].as_str().unwrap(),
                e["exposure"].as_str().unwrap(),
                e["boundary"].as_str().unwrap()
            )
        })
        .collect();
    let gw = "gateway gateway (nginx.conf)";
    assert_eq!(
        rows,
        [
            format!("services/api/src/app.ts /api/users | public | {gw} routes /api to api"),
            format!(
                "services/api/src/app.ts /internal/purge | unknown | {gw} routes to api, and a express route may be mounted on paths Drift does not read"
            ),
            format!(
                "services/jobs/src/app.ts /api/users | internal | {gw} routes no location to /api/users on jobs: reachable only inside the compose network"
            ),
            format!(
                "services/jobs/src/app.ts /internal/purge | internal | {gw} routes no location to /internal/purge on jobs: reachable only inside the compose network"
            ),
        ],
        "{rows:#?}"
    );
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
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A gateway built from a Dockerfile is read from the configuration the Dockerfile
/// copies in; a step that may write more leaves the unmatched routes unknown. A change
/// to the configuration that routes an internal route shows as now internet-facing,
/// for that route and not for the handler's other mount.
#[test]
fn a_gateway_built_from_a_dockerfile_is_read_and_a_new_location_is_a_change() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    write(
        r,
        "services/compose.yaml",
        "services:\n  web:\n    build: ./web\n    ports: [\"80:80\"]\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n",
    );
    let dockerfile = "FROM node:22 AS build\nRUN npm ci && npm run build\n\nFROM nginx:1.27-alpine\nRUN rm /etc/nginx/conf.d/default.conf\nCOPY nginx.conf /etc/nginx/conf.d/app.conf\nCOPY --from=build /app/dist /usr/share/nginx/html\nCMD [\"nginx\", \"-g\", \"daemon off;\"]\n";
    write(r, "services/web/Dockerfile", dockerfile);
    let conf = |more: &str| {
        format!(
            "server {{\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {{ try_files $uri /index.html; }}\n  error_page 500 502 503 504 /50x.html;\n  location /v1/ {{ proxy_pass http://api:8000; }}\n  location /health {{ proxy_pass http://api:8000; }}\n{more}}}\n"
        )
    };
    write(r, "services/web/nginx.conf", &conf(""));
    let gw = "gateway web (services/web/nginx.conf)";
    let got = exposures(r);
    assert_eq!(
        got["GET /v1/rules"],
        ("public".to_string(), format!("{gw} routes /v1/ to api"))
    );
    assert_eq!(
        got["POST /internal/v1/jobs/lease"],
        (
            "internal".to_string(),
            format!(
                "{gw} routes no location to /internal/v1/jobs/lease on api: reachable only inside the compose network"
            )
        )
    );

    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-q", "-m", "base"]);
    git(r, &["checkout", "-q", "-b", "change"]);
    write(
        r,
        "services/web/nginx.conf",
        &conf(
            "  location /internal/ { proxy_pass http://api:8000; }\n  location /v2/ { proxy_pass http://api:8000; }\n",
        ),
    );
    git(r, &["commit", "-q", "-am", "route internal and v2"]);
    let diff: Value = serde_json::from_str(&drift(
        r,
        &["--no-cache", "security", "--diff-base", "main", "--json"],
    ))
    .unwrap();
    let now: Vec<(&str, &str)> = diff["now_public"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["symbol"].as_str().unwrap(), e["route"].as_str().unwrap()))
        .collect();
    // Route by route: the `/v1` mount of the rules was internet-facing already.
    assert_eq!(
        now,
        [
            ("lease_job", "/internal/v1/jobs/lease"),
            ("get_rule", "/v2/rules/{rule_id}"),
            ("list_rules", "/v2/rules"),
        ],
        "{diff}"
    );

    // A step that may write configuration: what is not matched is unknown.
    write(
        r,
        "services/web/Dockerfile",
        &format!("{dockerfile}RUN envsubst < /tmpl > /etc/nginx/conf.d/more.conf\n"),
    );
    write(r, "services/web/nginx.conf", &conf(""));
    let got = exposures(r);
    assert_eq!(got["GET /v1/rules"].0, "public");
    assert_eq!(
        got["POST /internal/v1/jobs/lease"],
        (
            "unknown".to_string(),
            format!(
                "{gw} may route /internal/v1/jobs/lease to api: not all of it is read (gateway web: a step of its Dockerfile (`RUN envsubst < /tmpl > /etc/nginx/conf.d/more.conf`) is not read)"
            )
        )
    );
}

/// The exit code of an agent hook run on `root` for `event`, a file written when
/// `file` names one. A hook that aborts or hangs takes the agent's session with it.
fn hook_exit(root: &Path, event: &str, file: Option<&str>) -> Option<i32> {
    use std::io::Write;
    let mut input = serde_json::json!({
        "session_id": "s1", "cwd": root, "hook_event_name": event, "source": "startup"
    });
    if let Some(file) = file {
        input["tool_name"] = "Edit".into();
        input["tool_input"] = serde_json::json!({ "file_path": root.join(file) });
    }
    let mut child = Command::new(&*BIN)
        .args(["hook", "claude", event])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap().status.code()
}

/// A gateway configuration written to break the reader (blocks nested sixty thousand
/// deep) is refused as not nginx configuration: `drift security` and `drift card`
/// answer, the services behind the gateway are unknown, and the agent hooks exit 0.
#[test]
fn a_configuration_nested_without_end_is_not_read_and_nothing_aborts() {
    for conf in [
        "a {\n".repeat(60_000),
        "server { location / {\n".repeat(10_000),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        behind_nginx(r, &conf, "");
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        let warnings = inv["boundaries"]["warnings"].to_string();
        assert!(
            warnings.contains("services/nginx.conf: line ")
                && warnings.contains("not nginx configuration"),
            "{warnings}"
        );
        for (route, (exposure, _)) in exposures(r) {
            assert_eq!(exposure, "unknown", "{route}");
        }
        let card = drift(r, &["--no-cache", "card", "services/api/app/internal.py"]);
        assert!(card.contains("Not known: exposure ("), "{card}");
        drift(r, &["init"]);
        assert_eq!(hook_exit(r, "SessionStart", None), Some(0));
        assert_eq!(
            hook_exit(r, "PostToolUse", Some("services/api/app/internal.py")),
            Some(0)
        );
    }
}

/// `drift ARGS` in `root`, given `secs` to finish: its standard output, or none when
/// it had to be stopped.
fn drift_within(root: &Path, args: &[&str], secs: u64) -> Option<String> {
    use std::io::Read;
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        stdout.read_to_string(&mut out).map(|_| out).ok()
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(secs);
    while child.try_wait().unwrap().is_none() {
        if std::time::Instant::now() > deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    reader.join().unwrap()
}

/// Comparing a route with a location takes bounded work: forty parameters side by
/// side and a location of a hundred and twenty characters were tried in every way
/// they could be split, and `drift security` (and so the hooks) did not come back.
#[test]
fn a_route_of_adjacent_parameters_is_compared_in_bounded_time() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    let params: String = (0..40).map(|i| format!("{{p{i}}}")).collect();
    write(
        r,
        "services/api/app/internal.py",
        &format!(
            "from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.post(\"/{params}/zz\")\nasync def lease_job():\n    return {{}}\n"
        ),
    );
    let long = "a".repeat(120);
    behind_nginx(
        r,
        &format!(
            "server {{\n  listen 80;\n  location /internal/v1/{long} {{\n    proxy_pass http://api:8000;\n  }}\n  location /internal/v1/{long}/b {{\n    proxy_pass http://api:8000;\n  }}\n  location /v1/ {{ proxy_pass http://api:8000; }}\n}}\n"
        ),
        "",
    );
    // Generous: the comparison takes milliseconds, and took longer than a minute.
    let out = drift_within(r, &["--no-cache", "security", "--json"], 120)
        .expect("drift security did not finish");
    let inv: Value = serde_json::from_str(&out).unwrap();
    let claim = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["symbol"] == "lease_job")
        .unwrap();
    assert_eq!(claim["exposure"], "public", "{claim}");
    assert_eq!(
        claim["boundary"],
        format!("gateway gateway (services/nginx.conf) routes /internal/v1/{long} to api")
    );
}

/// A `return` at the level of a server does not make its locations unreachable when a
/// `rewrite ... break` before it lets some paths through: the route a location of
/// that server proxies is not internal.
#[test]
fn a_server_level_return_after_a_rewrite_does_not_make_a_route_internal() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    behind_nginx(
        r,
        "server {\n  listen 80;\n  rewrite ^/pub/(.*)$ /internal/v1/$1 break;\n  return 404;\n  location /internal/ {\n    proxy_pass http://api:8000;\n  }\n}\nserver {\n  listen 81;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
        "",
    );
    let got = exposures(r);
    let (exposure, boundary) = &got["POST /internal/v1/jobs/lease"];
    assert_ne!(exposure, "internal", "{boundary}");
    assert!(boundary.contains("routes /internal/ to api"), "{boundary}");
    // A server that only redirects still proxies nothing.
    behind_nginx(
        r,
        "server {\n  listen 80;\n  return 301 https://$host$request_uri;\n  location /internal/ {\n    proxy_pass http://api:8000;\n  }\n}\nserver {\n  listen 81;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
        "",
    );
    assert_eq!(exposures(r)["POST /internal/v1/jobs/lease"].0, "internal");
}

/// [STRICT] A route whose router is mounted in a way Drift does not read is not given
/// its unprefixed path: behind a gateway that routes `/v1/` to the service it was
/// called internal at `/jobs/lease` while it is served, and routed, at
/// `/v1/jobs/lease`. No route is internal unless every way it can be mounted was read.
#[test]
fn a_route_whose_mount_is_not_read_is_never_internal() {
    let conf = "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n  location = /health { proxy_pass http://api:8000; }\n}\n";
    let head = "import importlib\n\nfrom fastapi import APIRouter, FastAPI\nfrom starlette.routing import Mount\n\nfrom app.internal import router as internal_router\nfrom app.rules import router as rules_router\n\napp = FastAPI()\napp.include_router(rules_router, prefix=\"/v1\")\n";
    // (how the internal router is mounted, the route Drift gives it, its exposure)
    let cases = [
        (
            "app.include_router(internal_router, prefix=\"/internal/v1\")\n",
            "POST /internal/v1/jobs/lease",
            "internal",
        ),
        (
            "for r in [internal_router]:\n    app.include_router(r, prefix=\"/v1\")\n",
            "POST /?/jobs/lease",
            "unknown",
        ),
        (
            "OPTS = {\"prefix\": \"/v1\"}\napp.include_router(internal_router, **OPTS)\n",
            "POST /?/jobs/lease",
            "unknown",
        ),
        (
            "for name in [\"app.internal\"]:\n    app.include_router(importlib.import_module(name).router, prefix=\"/v1\")\n",
            "POST /?/jobs/lease",
            "unknown",
        ),
        (
            "for r, p in [(internal_router, \"/v1\")]:\n    app.include_router(r, prefix=p)\n",
            "POST /?/jobs/lease",
            "unknown",
        ),
        (
            "v1 = APIRouter(prefix=\"/v1\")\nfor r in [internal_router]:\n    v1.include_router(r)\napp.include_router(v1)\n",
            "POST /?/jobs/lease",
            "unknown",
        ),
        (
            "app.router.routes.append(Mount(\"/v1\", app=internal_router))\n",
            "POST /?/v1/jobs/lease",
            "unknown",
        ),
        // An application mounted on the app by name is read: the gateway routes it.
        (
            "sub = FastAPI()\nsub.include_router(internal_router, prefix=\"/internal/v1\")\napp.mount(\"/v1\", sub)\n",
            "POST /v1/internal/v1/jobs/lease",
            "public",
        ),
    ];
    for (mount, route, exposure) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            "services/api/app/main.py",
            &format!(
                "{head}{mount}\n\n@app.get(\"/health\")\nasync def health():\n    return {{}}\n"
            ),
        );
        behind_nginx(r, conf, "");
        let got = exposures(r);
        let (said, boundary) = got
            .get(route)
            .unwrap_or_else(|| panic!("{route}: {got:#?}"));
        assert_eq!(said, exposure, "{mount}: {boundary}");
        assert_eq!(got["GET /v1/rules"].0, "public", "{mount}");
        assert_eq!(got["GET /health"].0, "public", "{mount}");
    }

    // Flask: a blueprint registered in a loop, an application behind a dispatcher.
    let flask = [
        "from flask import Flask\n\nfrom app.internal import bp as internal_bp\nfrom app.rules import bp as rules_bp\n\napp = Flask(__name__)\napp.register_blueprint(rules_bp, url_prefix=\"/v1\")\nfor b in [internal_bp]:\n    app.register_blueprint(b, url_prefix=\"/v1\")\n",
        "from flask import Flask\nfrom werkzeug.middleware.dispatcher import DispatcherMiddleware\n\nfrom app.internal import bp as internal_bp\nfrom app.rules import bp as rules_bp\n\napp = Flask(__name__)\napp.register_blueprint(rules_bp, url_prefix=\"/v1\")\nadmin = Flask(\"admin\")\nadmin.register_blueprint(internal_bp, url_prefix=\"/internal\")\napp.wsgi_app = DispatcherMiddleware(app.wsgi_app, {\"/v1\": admin})\n",
    ];
    for main in flask {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "services/api/pyproject.toml",
            "[project]\nname = \"api\"\ndependencies = [\"flask\"]\n",
        );
        write(r, "services/api/app/__init__.py", "");
        write(
            r,
            "services/api/app/rules.py",
            "from flask import Blueprint\n\nbp = Blueprint(\"rules\", __name__)\n\n\n@bp.get(\"/rules\")\ndef list_rules():\n    return []\n",
        );
        write(
            r,
            "services/api/app/internal.py",
            "from flask import Blueprint\n\nbp = Blueprint(\"internal\", __name__)\n\n\n@bp.post(\"/jobs/lease\")\ndef lease_job():\n    return {}\n",
        );
        write(r, "services/api/app/main.py", main);
        behind_nginx(r, conf, "");
        let got = exposures(r);
        let claim: Vec<_> = got
            .iter()
            .filter(|(k, _)| k.ends_with("/jobs/lease"))
            .collect();
        assert_eq!(claim.len(), 1, "{got:#?}");
        assert_eq!(claim[0].1.0, "unknown", "{main}: {got:#?}");
        assert!(claim[0].0.starts_with("POST /?/"), "{got:#?}");
        assert_eq!(got["GET /v1/rules"].0, "public", "{main}");
    }
}

/// The compose file of [`behind_nginx`] with `api` lines added to the `api` service
/// (indented six spaces under it) and `more` further services.
fn compose_with(r: &Path, api: &str, more: &str) {
    write(
        r,
        "services/compose.yaml",
        &format!(
            "services:\n  gateway:\n    image: nginx:alpine\n    ports: [\"9000:80\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n    depends_on: [api]\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n{api}{more}"
        ),
    );
}

/// [STRICT] A root path given to the server moves every route under a prefix, so a
/// route no location reaches at its own path may be reached under it. It is looked for
/// in what the service starts with (a script the Dockerfile copies in is read where it
/// is in the repository) and in its env files; a start command or an env file that is
/// not read leaves the routes of a service a location proxies to unknown.
#[test]
fn a_root_path_in_a_start_script_or_an_env_file_is_read_or_the_route_is_unknown() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let conf = "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n  location = /health { proxy_pass http://api:8000; }\n}\n";
    let script = "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nRUN chmod +x /app/entrypoint.sh\nCMD [\"./entrypoint.sh\"]\n";
    let plain = "#!/bin/bash\nset -euo pipefail\nWORKERS=\"${UVICORN_WORKERS:-1}\"\nalembic upgrade head\nexec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers $WORKERS\n";
    let who = "compose service api in services/compose.yaml";
    let gw = "gateway gateway (services/nginx.conf)";
    // (the Dockerfile, the start script, lines of the api service, an env file, what
    // the boundary of the internal route says)
    type Case<'a> = (&'a str, Option<&'a str>, &'a str, Option<&'a str>, String);
    let cases: [Case; 11] = [
        // Read, and no root path anywhere: internal.
        (script, Some(plain), "", None, "internal|".to_string()),
        (
            script,
            Some("#!/bin/sh\nexec uvicorn app.main:app --host 0.0.0.0 --root-path /api\n"),
            "",
            None,
            format!(
                "unknown|{who}: its start command has `--root-path`, which sets a prefix for every route; so where its routes are served is not known"
            ),
        ),
        // The script is not in the repository.
        (
            script,
            None,
            "",
            None,
            format!(
                "unknown|{who}: its start command has `./entrypoint.sh`, which is not read (nothing the Dockerfile copies from the repository puts it there); so where its routes are served is not known"
            ),
        ),
        // It hands over to another script.
        (
            script,
            Some("#!/bin/sh\n. ./env.sh\nexec ./run.sh\n"),
            "",
            None,
            format!(
                "unknown|{who}: its start command has `. ./env.sh` in services/api/entrypoint.sh, which Drift does not read; so where its routes are served is not known"
            ),
        ),
        // A program Drift does not know.
        (
            "FROM python:3.12\nWORKDIR /app\nCOPY . /app\n",
            None,
            "    command: make serve\n",
            None,
            format!(
                "unknown|{who}: its start command has `make`, a program Drift does not know; so where its routes are served is not known"
            ),
        ),
        // Nothing says what it starts with: the base image does.
        (
            "FROM tiangolo/uvicorn-gunicorn-fastapi:python3.11\nCOPY . /app\n",
            None,
            "",
            None,
            format!(
                "unknown|{who}: what it starts with is not in the repository (no `command`, and no CMD in a Dockerfile Drift reads); so where its routes are served is not known"
            ),
        ),
        // Env files: one that sets the root path, one that does not, one that is not there.
        (
            script,
            Some(plain),
            "    env_file:\n      - ./api/.env.docker\n",
            Some("UVICORN_ROOT_PATH=/api\n"),
            format!(
                "unknown|{who}: what it is given or starts with names `UVICORN_ROOT_PATH`, which sets a prefix for every route; so where its routes are served is not known"
            ),
        ),
        (
            script,
            Some(plain),
            "    env_file: ./api/.env.docker\n",
            Some("LOG_LEVEL=info\n"),
            "internal|".to_string(),
        ),
        // An env file that is not in the repository, required or optional: outside
        // what Drift reads. The route stays internal and its reason carries the
        // condition; the file is named once in the warnings.
        (
            script,
            Some(plain),
            "    env_file:\n      - ./api/.env.docker\n",
            None,
            format!(
                "internal|{gw} routes no location to /internal/v1/jobs/lease on api: reachable only inside the compose network; not read: env file services/api/.env.docker (not in the repository)"
            ),
        ),
        (
            script,
            Some(plain),
            "    env_file:\n      - path: ./api/.env.docker\n        required: false\n",
            None,
            format!(
                "internal|{gw} routes no location to /internal/v1/jobs/lease on api: reachable only inside the compose network; not read: env file services/api/.env.docker (not in the repository)"
            ),
        ),
        // In the repository and not a file Drift can read (here a directory).
        (
            script,
            Some(plain),
            "    env_file: ./api/app\n",
            None,
            format!(
                "unknown|{who} takes its environment from services/api/app, which Drift cannot read: it may set a root path"
            ),
        ),
    ];
    for (dockerfile, start, api, env, want) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(r, "services/api/Dockerfile", dockerfile);
        if let Some(start) = start {
            write(r, "services/api/entrypoint.sh", start);
        }
        if let Some(env) = env {
            write(r, "services/api/.env.docker", env);
        }
        write(r, "services/nginx.conf", conf);
        compose_with(r, api, "");
        let got = exposures(r);
        let (exposure, boundary) = &got[CLAIM];
        let said = format!("{exposure}|{boundary}");
        assert!(
            said.starts_with(&want),
            "{dockerfile}{start:?}{api}{env:?}\n{said}"
        );
        // What was not read is said once in the warnings as well.
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        let warned = inv["boundaries"]["warnings"].to_string();
        let warnings: Vec<&str> = inv["boundaries"]["warnings"]
            .as_array()
            .map(|a| a.iter().filter_map(|w| w.as_str()).collect())
            .unwrap_or_default();
        assert_eq!(
            warnings.iter().any(|w| want
                .strip_prefix("unknown|")
                .is_some_and(|why| w.starts_with(why))),
            want.starts_with("unknown|"),
            "{want}: {warned}"
        );
        assert_eq!(
            warned.contains(&format!("{who} takes its environment from services/api/.env.docker, which is not in the repository; what it sets is not read")),
            want.contains("; not read: env file"),
            "{want}: {warned}"
        );
        // What a location reaches at its own path stays internet-facing.
        assert_eq!(got["GET /v1/rules"].0, "public");
    }
}

/// The override file compose merges into a compose file by default is read with it: a
/// service whose ports it publishes is internet-facing.
#[test]
fn a_compose_override_file_that_publishes_ports_is_read() {
    let conf = "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n";
    for (base, over) in [
        ("compose.yaml", "compose.override.yaml"),
        ("docker-compose.yml", "docker-compose.override.yml"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        behind_nginx(r, conf, "");
        if base != "compose.yaml" {
            std::fs::rename(
                r.join("services/compose.yaml"),
                r.join("services").join(base),
            )
            .unwrap();
        }
        let internal = exposures(r);
        assert_eq!(internal["POST /internal/v1/jobs/lease"].0, "internal");
        write(
            r,
            &format!("services/{over}"),
            "services:\n  api:\n    ports:\n      - \"8000:8000\"\n",
        );
        let got = exposures(r);
        assert_eq!(
            got["POST /internal/v1/jobs/lease"],
            (
                "public".to_string(),
                format!("compose service api in services/{base} publishes ports")
            )
        );
        // One that cannot be parsed: what it changes is not known.
        write(r, &format!("services/{over}"), "services: [\n");
        let inv: Value =
            serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
        assert!(
            inv["boundaries"]["warnings"][0]
                .as_str()
                .unwrap()
                .starts_with(&format!("services/{over}: not parsed")),
            "{inv}"
        );
        assert_eq!(exposures(r)["POST /internal/v1/jobs/lease"].0, "unknown");
    }
}

/// Another service of the file that publishes ports and may be a proxy Drift does not
/// read (an nginx from a private registry with nothing mounted, an image it does not
/// know) keeps every route of the service from being internal. A data store that
/// publishes ports, or an application built from the repository, is no proxy.
#[test]
fn another_published_service_that_may_proxy_keeps_a_route_from_being_internal() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let conf = "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n";
    let cases = [
        (
            "  edge:\n    image: registry.example.com/team/nginx:prod\n    ports: [\"8443:443\"]\n",
            Some("image registry.example.com/team/nginx:prod"),
        ),
        (
            "  edge:\n    image: openresty/openresty:alpine\n    ports: [\"8080:80\"]\n    volumes:\n      - ./edge.conf:/usr/local/openresty/nginx/conf/nginx.conf:ro\n",
            Some("image openresty/openresty:alpine"),
        ),
        (
            "  edge:\n    image: kong:3\n    ports: [\"8000:8000\"]\n",
            Some("image kong:3"),
        ),
        (
            "  edge:\n    image: ghcr.io/acme/sidecar:1\n    ports: [\"7000:7000\"]\n",
            Some("image ghcr.io/acme/sidecar:1"),
        ),
        // No proxy: a database, a broker, an application of the repository.
        (
            "  db:\n    image: postgres:16\n    ports: [\"5432:5432\"]\n  broker:\n    image: rabbitmq:4-management\n    ports: [\"15672:15672\"]\n",
            None,
        ),
        (
            "  direct:\n    build: ./direct\n    ports: [\"8001:8000\"]\n",
            None,
        ),
        // On another network: it cannot reach the service.
        (
            "  edge:\n    image: kong:3\n    ports: [\"8000:8000\"]\n    networks: [outside]\n",
            Some("-"),
        ),
    ];
    for (more, stranger) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(r, "services/direct/Dockerfile", "FROM python:3.12\n");
        write(r, "services/nginx.conf", conf);
        let api = if stranger == Some("-") {
            "    networks: [inner]\n"
        } else {
            ""
        };
        compose_with(r, api, more);
        let got = exposures(r);
        let (exposure, boundary) = &got[CLAIM];
        match stranger {
            Some(image) if image != "-" => {
                assert_eq!(exposure, "unknown", "{more}{boundary}");
                assert_eq!(
                    boundary,
                    &format!(
                        "compose service edge in services/compose.yaml publishes ports and may proxy to api ({image}): what it routes is not read"
                    ),
                );
            }
            _ => assert_eq!(exposure, "internal", "{more}{boundary}"),
        }
        assert_eq!(got["GET /v1/rules"].0, "public", "{more}");
    }
    // With no gateway Drift knows at all: a service that publishes no ports is still
    // not internal while such a service may proxy to it.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    write(
        r,
        "services/compose.yaml",
        "services:\n  edge:\n    image: kong:3\n    ports: [\"8000:8000\"]\n  api:\n    build: ./api\n",
    );
    let (exposure, boundary) = &exposures(r)[CLAIM];
    assert_eq!(exposure, "unknown", "{boundary}");
    assert!(
        boundary.contains("edge in services/compose.yaml publishes ports and may proxy to api")
    );
}

/// A host the gateway names with the network's name after the service's, or with a
/// dot at the end, is that service; a name that is no service of the file may be one
/// by a name Drift does not read, and is never taken to lead nowhere.
#[test]
fn a_qualified_upstream_name_is_its_service_and_an_unknown_one_is_unknown() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let gw = "gateway gateway (services/nginx.conf)";
    for host in ["api.services_default:8000", "api.:8000"] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        behind_nginx(
            r,
            &format!(
                "server {{\n  listen 80;\n  location /v1/ {{ proxy_pass http://api:8000; }}\n  location /internal/ {{ proxy_pass http://{host}; }}\n}}\n"
            ),
            "",
        );
        assert_eq!(
            exposures(r)[CLAIM],
            (
                "public".to_string(),
                format!("{gw} routes /internal/ to api")
            ),
            "{host}"
        );
    }
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    behind_nginx(
        r,
        "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n  location /internal/ { proxy_pass http://backend-blue:8000; }\n}\n",
        "",
    );
    let (exposure, boundary) = &exposures(r)[CLAIM];
    assert_eq!(exposure, "unknown", "{boundary}");
    assert!(
        boundary.contains("proxies to a host Drift cannot resolve"),
        "{boundary}"
    );
}

/// A Traefik gateway in front of `api` and `worker`, neither publishing ports:
/// `command` is Traefik's, `labels` those of `api` (one a line, indented six spaces).
fn behind_traefik(r: &Path, command: &str, labels: &str) {
    fastapi_service(r, "services/api", "FastAPI()");
    fastapi_service(r, "services/worker", "FastAPI()");
    write(
        r,
        "services/compose.yaml",
        &format!(
            "services:\n  edge:\n    image: traefik:v3.1\n    command: [{command}]\n    ports: [\"80:80\"]\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock:ro\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n    labels:\n{labels}  worker:\n    build: ./worker\n"
        ),
    );
}

/// (exposure, boundary) of each http entry point of the service in `services/<svc>`,
/// by method and route.
fn exposures_of(r: &Path, svc: &str) -> std::collections::BTreeMap<String, (String, String)> {
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| {
            e["kind"] == "http"
                && e["path"]
                    .as_str()
                    .unwrap()
                    .starts_with(&format!("services/{svc}/"))
        })
        .map(|e| {
            let text = |k: &str| e[k].as_str().unwrap_or_default().to_string();
            (
                format!("{} {}", text("method"), text("route")),
                (text("exposure"), text("boundary")),
            )
        })
        .collect()
}

/// Behind Traefik, exposure is each route's, read from the routers on the services'
/// labels: internet-facing where a router's rule matches the route's path and no
/// other rule on that host could take it elsewhere, internal where no router of the
/// service can carry it and everything Traefik routes by is on the labels.
#[test]
fn traefik_router_labels_make_exposure_a_matter_of_each_route() {
    const OFF: &str = "\"--providers.docker=true\", \"--providers.docker.exposedbydefault=false\", \"--entrypoints.web.address=:80\"";
    let rule = "Host(`api.example.com`) && (PathPrefix(`/v1`) || Path(`/health`))";
    let gw = "gateway edge (services/compose.yaml)";
    let inside = "reachable only inside the compose network";
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    behind_traefik(
        r,
        OFF,
        &format!("      - traefik.enable=true\n      - traefik.http.routers.api.rule={rule}\n"),
    );
    let api = exposures_of(r, "api");
    let said = |route: &str| api[route].clone();
    assert_eq!(
        said("GET /v1/rules/{rule_id}"),
        ("public".to_string(), format!("{gw} routes {rule} to api"))
    );
    assert_eq!(said("GET /health").0, "public");
    // The same router mounted under `/v2`, and the internal one: no rule carries them.
    for route in ["GET /v2/rules", "POST /internal/v1/jobs/lease"] {
        let path = route.split(' ').nth(1).unwrap();
        assert_eq!(
            said(route),
            (
                "internal".to_string(),
                format!("{gw} routes no router to {path} on api: {inside}")
            )
        );
    }
    // Not enabled, and exposure by default is off: Traefik routes nothing to it.
    for (route, (exposure, boundary)) in exposures_of(r, "worker") {
        assert_eq!(exposure, "internal", "{route}: {boundary}");
        assert!(boundary.contains("routes no router to"), "{boundary}");
    }
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    assert!(inv["boundaries"].get("warnings").is_none(), "{inv}");

    // What changes the answer for the internal route, and to what.
    let enabled = "      - traefik.enable=true\n";
    let cases: [(&str, String, &str, &str); 7] = [
        // Exposure by default left on: every container has a router for every path.
        (
            "\"--providers.docker=true\"",
            String::new(),
            "public",
            "routes the default router of api to api",
        ),
        // A prefix that is stripped: any route is behind it.
        (
            OFF,
            format!(
                "{enabled}      - traefik.http.routers.api.rule=PathPrefix(`/api`)\n      - traefik.http.routers.api.middlewares=strip\n      - traefik.http.middlewares.strip.stripprefix.prefixes=/api\n"
            ),
            "public",
            "routes PathPrefix(`/api`) to api",
        ),
        // A rule Drift does not evaluate may carry anything.
        (
            OFF,
            format!(
                "{enabled}      - traefik.http.routers.api.rule=PathPrefix(`/v1`) && Method(`GET`)\n"
            ),
            "unknown",
            "router PathPrefix(`/v1`) && Method(`GET`) is not one Drift evaluates",
        ),
        (
            OFF,
            format!(
                "{enabled}      - traefik.http.routers.api.rule=PathRegexp(`^/(v1|internal)/`)\n"
            ),
            "unknown",
            "is not one Drift evaluates",
        ),
        (
            OFF,
            format!(
                "{enabled}      - traefik.http.routers.api.rule=PathPrefix(`/v1`)\n      - traefik.http.routers.api.middlewares=rewrite@file\n"
            ),
            "unknown",
            "is not one Drift evaluates",
        ),
        // Routers that are not on the labels: a file provider.
        (
            "\"--providers.docker.exposedbydefault=false\", \"--providers.file.directory=/etc/traefik/dynamic\"",
            format!("{enabled}      - traefik.http.routers.api.rule=PathPrefix(`/v1`)\n"),
            "unknown",
            "not all of it is read (gateway edge: its `file` provider is not read)",
        ),
        // The rule alone carries the path.
        (
            OFF,
            format!("{enabled}      - traefik.http.routers.api.rule=PathPrefix(`/internal`)\n"),
            "public",
            "routes PathPrefix(`/internal`) to api",
        ),
    ];
    for (command, labels, exposure, why) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        behind_traefik(r, command, &labels);
        let api = exposures_of(r, "api");
        let (said, boundary) = &api["POST /internal/v1/jobs/lease"];
        assert_eq!(said, exposure, "{labels}{boundary}");
        assert!(boundary.contains(why), "{labels}{boundary}");
    }
}

/// Behind Caddy, exposure is each route's, read from the Caddyfile the gateway
/// mounts: `reverse_proxy` with a path matcher, `handle`, `handle_path` (which takes
/// the prefix off) and `uri strip_prefix`.
#[test]
fn a_caddyfile_makes_exposure_a_matter_of_each_route() {
    let gw = "gateway edge (services/Caddyfile)";
    let caddy = |r: &Path, caddyfile: &str| {
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            "services/compose.yaml",
            "services:\n  edge:\n    image: caddy:2\n    ports: [\"80:80\", \"443:443\"]\n    volumes:\n      - ./Caddyfile:/etc/caddy/Caddyfile:ro\n      - caddy_data:/data\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\nvolumes:\n  caddy_data:\n",
        );
        write(r, "services/Caddyfile", caddyfile);
    };
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    caddy(
        r,
        "{\n\temail ops@example.com\n}\n\napi.example.com {\n\tencode gzip\n\treverse_proxy /v1/* api:8000\n\thandle /health {\n\t\treverse_proxy api:8000\n\t}\n}\n",
    );
    let got = exposures(r);
    assert_eq!(
        got["GET /v1/rules/{rule_id}"],
        (
            "public".to_string(),
            format!("{gw} routes reverse_proxy /v1/* to api")
        )
    );
    assert_eq!(got["GET /health"].0, "public");
    for route in ["GET /v2/rules", "POST /internal/v1/jobs/lease"] {
        let path = route.split(' ').nth(1).unwrap();
        assert_eq!(
            got[route],
            (
                "internal".to_string(),
                format!(
                    "{gw} routes no matcher to {path} on api: reachable only inside the compose network"
                )
            )
        );
    }

    let cases = [
        // `handle_path` takes `/api` off: every route is behind it.
        (
            ":80 {\n\thandle_path /api/* {\n\t\treverse_proxy api:8000\n\t}\n}\n",
            "public",
            "routes reverse_proxy /api/* to api",
        ),
        (
            ":80 {\n\thandle /api/* {\n\t\turi strip_prefix /api\n\t\treverse_proxy api:8000\n\t}\n}\n",
            "public",
            "routes reverse_proxy /api/* to api",
        ),
        // Not evaluated, or not read: unknown, never internal.
        (
            ":80 {\n\thandle /v1/* {\n\t\trewrite * /internal{uri}\n\t\treverse_proxy api:8000\n\t}\n}\n",
            "unknown",
            "matcher reverse_proxy /v1/* is not one Drift evaluates",
        ),
        (
            ":80 {\n\timport sites/*\n\treverse_proxy /v1/* api:8000\n}\n",
            "unknown",
            "not all of it is read (services/Caddyfile:2: `import` is not followed)",
        ),
        (
            ":80 {\n\treverse_proxy /v1/* api:8000\n\treverse_proxy {$BACKEND}\n}\n",
            "unknown",
            "proxies to a host Drift cannot resolve",
        ),
    ];
    for (caddyfile, exposure, why) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        caddy(r, caddyfile);
        let got = exposures(r);
        let (said, boundary) = &got["POST /internal/v1/jobs/lease"];
        assert_eq!(said, exposure, "{caddyfile}{boundary}");
        assert!(boundary.contains(why), "{caddyfile}{boundary}");
    }
    // A file written to break the reader: not read, nothing aborts, nothing internal.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    caddy(r, &":80 {\n".repeat(20_000));
    for (route, (exposure, _)) in exposures(r) {
        assert_eq!(exposure, "unknown", "{route}");
    }
    drift(r, &["init"]);
    assert_eq!(hook_exit(r, "SessionStart", None), Some(0));
}

/// [STRICT] A router built with a prefix that is not a string literal is served under
/// it all the same: its routes were called internal at the path without the prefix,
/// while the gateway routes the real one.
#[test]
fn a_router_built_with_a_prefix_that_is_not_a_literal_is_never_internal() {
    let conf = "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n  location = /health { proxy_pass http://api:8000; }\n}\n";
    for ctor in [
        "APIRouter(prefix=PREFIX)",
        "APIRouter(prefix=settings.API_V1_STR)",
        "APIRouter(prefix=PREFIX + \"\")",
        "APIRouter(prefix=f\"{PREFIX}\")",
        "APIRouter(**OPTIONS)",
        "VersionedRouter()",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            "services/api/app/internal.py",
            &format!(
                "from fastapi import APIRouter\n\nfrom app.config import settings\n\nPREFIX = \"/v1\"\nOPTIONS = {{\"prefix\": \"/v1\"}}\n\n\nclass VersionedRouter(APIRouter):\n    def __init__(self, *args, **kwargs):\n        super().__init__(*args, prefix=\"/v1\", **kwargs)\n\n\nrouter = {ctor}\n\n\n@router.post(\"/jobs/lease\")\nasync def lease_job():\n    return {{}}\n"
            ),
        );
        write(
            r,
            "services/api/app/main.py",
            "from fastapi import FastAPI\n\nfrom app.internal import router as internal_router\nfrom app.rules import router as rules_router\n\napp = FastAPI()\napp.include_router(rules_router, prefix=\"/v1\")\napp.include_router(internal_router)\n\n\n@app.get(\"/health\")\nasync def health():\n    return {}\n",
        );
        behind_nginx(r, conf, "");
        let got = exposures(r);
        let (exposure, boundary) = got
            .get("POST /?/jobs/lease")
            .unwrap_or_else(|| panic!("{ctor}: {got:#?}"));
        assert_eq!(exposure, "unknown", "{ctor}: {boundary}");
        assert_eq!(got["GET /v1/rules"].0, "public", "{ctor}");
    }
}

/// A Django service in `services/api` behind an nginx gateway that routes `/v1/`:
/// `root` is its root URLconf and `core` the URLconf of its `core` app, whose
/// `lease_job` view `core/internal_urls.py` lists at `jobs/lease`.
fn django_behind_nginx(r: &Path, root: &str, core: &str) {
    let at = |rel: &str, body: &str| write(r, &format!("services/api/{rel}"), body);
    at(
        "pyproject.toml",
        "[project]\nname = \"api\"\ndependencies = [\"django\"]\n",
    );
    at(
        "Dockerfile",
        "FROM python:3.12\nWORKDIR /app\nCOPY . /app\nCMD [\"gunicorn\", \"proj.wsgi:application\"]\n",
    );
    at("manage.py", "");
    at(
        "proj/settings.py",
        "ROOT_URLCONF = \"proj.urls\"\nINSTALLED_APPS = [\"core\"]\n",
    );
    at("proj/__init__.py", "");
    at(
        "proj/wsgi.py",
        "from django.core.wsgi import get_wsgi_application\n\napplication = get_wsgi_application()\n",
    );
    at("proj/urls.py", root);
    at("core/__init__.py", "");
    at("core/urls.py", core);
    at(
        "core/internal_urls.py",
        "from django.urls import path\n\nfrom core import views\n\nurlpatterns = [path(\"jobs/lease\", views.lease_job)]\n",
    );
    at(
        "core/views.py",
        "from django.http import JsonResponse\n\n\ndef list_rules(request):\n    return JsonResponse({})\n\n\ndef lease_job(request):\n    return JsonResponse({})\n",
    );
    behind_nginx(
        r,
        "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
        "",
    );
}

/// [STRICT] A handler with one mount Drift reads and another it does not is not known
/// by the first alone. A router mounted once by name and again in a loop has an entry
/// under a prefix that is not known; a Django view whose patterns are also included
/// as an imported list, or added to another list, is listed at each path; a pattern
/// under `i18n_patterns` is listed under a prefix that is not known; and beside an
/// include Drift cannot follow no view is internal.
#[test]
fn a_handler_also_mounted_where_drift_reads_no_mount_is_never_internal() {
    // FastAPI: the second mount is in a loop.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    write(
        r,
        "services/api/app/main.py",
        "from fastapi import FastAPI\n\nfrom app.internal import router as internal_router\nfrom app.rules import router as rules_router\n\napp = FastAPI()\napp.include_router(rules_router, prefix=\"/v1\")\napp.include_router(internal_router, prefix=\"/internal/v1\")\nfor prefix in (\"/v1/ops\",):\n    app.include_router(internal_router, prefix=prefix)\n\n\n@app.get(\"/health\")\nasync def health():\n    return {}\n",
    );
    behind_nginx(
        r,
        "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
        "",
    );
    let got = exposures(r);
    assert_eq!(
        got["POST /internal/v1/jobs/lease"].0, "internal",
        "{got:#?}"
    );
    let (exposure, boundary) = got
        .get("POST /?/jobs/lease")
        .unwrap_or_else(|| panic!("{got:#?}"));
    assert_eq!(exposure, "unknown", "{boundary}");
    assert_eq!(got["GET /health"].0, "internal", "{got:#?}");

    let core = "from django.urls import path\n\nfrom core import views\n\nurlpatterns = [path(\"rules/\", views.list_rules)]\n";
    // Django: the patterns are included a second time as an imported list.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_behind_nginx(
        r,
        "from django.urls import include, path\nfrom core.internal_urls import urlpatterns as internal_patterns\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n    path(\"internal/\", include(\"core.internal_urls\")),\n    path(\"v1/ops/\", include((internal_patterns, \"ops\"))),\n]\n",
        core,
    );
    let got = exposures(r);
    assert_eq!(got["ANY /v1/ops/jobs/lease"].0, "public", "{got:#?}");
    assert_eq!(got["ANY /internal/jobs/lease"].0, "internal", "{got:#?}");

    // Django: the patterns are added to another list.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_behind_nginx(
        r,
        "from django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n    path(\"internal/\", include(\"core.internal_urls\")),\n]\n",
        "from django.urls import path\n\nfrom core import views\nfrom core.internal_urls import urlpatterns as more\n\nurlpatterns = [path(\"rules/\", views.list_rules)] + more\n",
    );
    let got = exposures(r);
    assert_eq!(got["ANY /v1/jobs/lease"].0, "public", "{got:#?}");

    // Django: `i18n_patterns` serves its patterns under a language prefix.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_behind_nginx(
        r,
        "from django.conf.urls.i18n import i18n_patterns\nfrom django.urls import include, path\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n]\nurlpatterns += i18n_patterns(path(\"internal/\", include(\"core.internal_urls\")))\n",
        core,
    );
    let got = exposures(r);
    let (exposure, boundary) = got
        .get("ANY /?/internal/jobs/lease")
        .unwrap_or_else(|| panic!("{got:#?}"));
    assert_eq!(exposure, "unknown", "{boundary}");

    // Django: an include Drift cannot follow may serve any view under `/v1/`.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    django_behind_nginx(
        r,
        "from django.urls import include, path\n\nfrom proj.plugins import plugin_urls\n\nurlpatterns = [\n    path(\"v1/\", include(\"core.urls\")),\n    path(\"internal/\", include(\"core.internal_urls\")),\n    path(\"v1/\", include(plugin_urls())),\n]\n",
        core,
    );
    let got = exposures(r);
    let (exposure, boundary) = &got["ANY /internal/jobs/lease"];
    assert_eq!(exposure, "unknown", "{boundary}");
    assert!(
        boundary.contains("an include Drift cannot follow"),
        "{boundary}"
    );
}

/// [STRICT] A route is internal only when Drift read what serves it to the end: the
/// server and each of its options, and an application object every use of which it
/// knows. Each of these moves the routes of the service under a prefix in a way the
/// words `root_path=` do not show; each read internal. What is not known is named
/// as written, in the route's reason and once in the warnings.
#[test]
fn what_serves_a_route_is_read_to_the_end_or_the_route_is_unknown() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let conf = "server {\n  listen 80;\n  location /api/ { proxy_pass http://api:8000; }\n  location /v1/ { proxy_pass http://api:8000; }\n}\n";
    let uvicorn = "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nCMD [\"uvicorn\", \"app.main:app\", \"--host\", \"0.0.0.0\"]\n";
    let main = |app: &str, more: &str| {
        format!(
            "from fastapi import FastAPI\n\nfrom app.internal import router as internal_router\nfrom app.rules import router as rules_router\n\napp = {app}\napp.include_router(rules_router, prefix=\"/v1\")\napp.include_router(internal_router, prefix=\"/internal/v1\")\n{more}\n\n@app.get(\"/api/ping\")\nasync def ping():\n    return {{}}\n"
        )
    };
    // (the Dockerfile, lines of the api service, app/main.py, another file, what the
    // reason names)
    type Case<'a> = (
        &'a str,
        &'a str,
        String,
        Option<(&'a str, &'a str)>,
        &'a str,
    );
    let cases: Vec<Case> = vec![
        // The control: all of it read.
        (uvicorn, "", main("FastAPI(title=\"api\")", ""), None, ""),
        // A worker class of the repository (`CONFIG_KWARGS = {"root_path": "/api"}`).
        (
            "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nCMD [\"gunicorn\", \"-k\", \"app.worker.ApiWorker\", \"app.main:app\"]\n",
            "",
            main("FastAPI()", ""),
            Some((
                "services/api/app/worker.py",
                "from uvicorn.workers import UvicornWorker\n\n\nclass ApiWorker(UvicornWorker):\n    CONFIG_KWARGS = {\"root_path\": \"/api\"}\n",
            )),
            "`-k app.worker.ApiWorker`, a worker class Drift does not know",
        ),
        // A configuration file of the server.
        (
            "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nCMD [\"hypercorn\", \"--config\", \"hypercorn.toml\", \"app.main:app\"]\n",
            "",
            main("FastAPI()", ""),
            Some(("services/api/hypercorn.toml", "root_path = \"/api\"\n")),
            "`--config`, an option of hypercorn that Drift does not know",
        ),
        // Compose puts a variable into the command: from the `.env` beside it.
        (
            uvicorn,
            "    command: uvicorn app.main:app --host 0.0.0.0 ${UVICORN_EXTRA_ARGS}\n",
            main("FastAPI()", ""),
            Some(("services/.env", "UVICORN_EXTRA_ARGS=--root-path /api\n")),
            "`--root-path`, which sets a prefix for every route",
        ),
        // The same with no such file: the variable is the host's.
        (
            uvicorn,
            "    command: uvicorn app.main:app --host 0.0.0.0 ${UVICORN_EXTRA_ARGS}\n",
            main("FastAPI()", ""),
            None,
            "`${UVICORN_EXTRA_ARGS}`, which compose takes from the environment it is run in",
        ),
        // The shell puts a variable into the command that nothing Drift reads sets.
        (
            "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nCMD uvicorn app.main:app --host 0.0.0.0 $SERVER_ARGS\n",
            "",
            main("FastAPI()", ""),
            None,
            "`$SERVER_ARGS`, which nothing Drift reads sets",
        ),
        // Options spread into the application.
        (
            uvicorn,
            "",
            main("FastAPI(**settings.fastapi_kwargs)", "").replace(
                "from fastapi import FastAPI\n",
                "from fastapi import FastAPI\n\nfrom app.config import settings\n",
            ),
            Some((
                "services/api/app/config.py",
                "class Settings:\n    fastapi_kwargs = {\"root_path\": \"/api\"}\n\n\nsettings = Settings()\n",
            )),
            "`FastAPI(**settings.fastapi_kwargs)` (services/api/app/main.py:8)",
        ),
        (
            uvicorn,
            "",
            main("FastAPI(**OPTIONS)", "").replace(
                "app = FastAPI",
                "OPTIONS = {}\nOPTIONS[\"root_\" + \"path\"] = \"/api\"\napp = FastAPI",
            ),
            None,
            "`FastAPI(**OPTIONS)`",
        ),
        // Assigned after it is built.
        (
            uvicorn,
            "",
            main("FastAPI()", "app.root_path = \"/api\"\n"),
            None,
            "`app.root_path` (services/api/app/main.py:9)",
        ),
        // A middleware that strips a prefix.
        (
            uvicorn,
            "",
            main(
                "FastAPI()",
                "\n\nclass StripPrefix:\n    def __init__(self, app, prefix=\"/api\"):\n        self.app, self.prefix = app, prefix\n\n    async def __call__(self, scope, receive, send):\n        if scope[\"type\"] == \"http\" and scope[\"path\"].startswith(self.prefix):\n            scope = dict(scope, path=scope[\"path\"][len(self.prefix):])\n        await self.app(scope, receive, send)\n\n\napp.add_middleware(StripPrefix)\n",
            ),
            None,
            "`app.add_middleware(StripPrefix)` (services/api/app/main.py:21)",
        ),
        // The server is started on a wrapper around the application.
        (
            "FROM python:3.12\nWORKDIR /app\nCOPY services/api /app\nCMD [\"uvicorn\", \"app.main:application\"]\n",
            "",
            main(
                "FastAPI()",
                "\n\nasync def application(scope, receive, send):\n    if scope[\"type\"] == \"http\":\n        scope = dict(scope, path=scope[\"path\"].removeprefix(\"/api\"))\n    await app(scope, receive, send)\n",
            ),
            None,
            "starts on `application` of services/api/app/main.py, which is not an application object Drift reads",
        ),
    ];
    for (dockerfile, api, main, other, names) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(r, "services/api/Dockerfile", dockerfile);
        write(r, "services/api/app/main.py", &main);
        if let Some((path, text)) = other {
            write(r, path, text);
        }
        write(r, "services/nginx.conf", conf);
        compose_with(r, api, "");
        let got = exposures(r);
        // Options spread into the constructor may hold a prefix as well: every route
        // of the application is then listed under one that is not known.
        if names.contains("(**") {
            let (exposure, boundary) = got
                .get("POST /?/internal/v1/jobs/lease")
                .unwrap_or_else(|| panic!("{names}: {got:#?}"));
            assert_eq!(exposure, "unknown", "{names}: {boundary}");
            continue;
        }
        let (exposure, boundary) = got
            .get(CLAIM)
            .unwrap_or_else(|| panic!("{names}: {got:#?}"));
        // What a location reaches at its own path stays internet-facing.
        assert_eq!(got["GET /v1/rules"].0, "public", "{names}");
        if names.is_empty() {
            assert_eq!(exposure, "internal", "{boundary}");
            continue;
        }
        assert_eq!(exposure, "unknown", "{names}: {boundary}");
        assert!(boundary.contains(names), "{names}: {boundary}");
    }
}

/// [STRICT] A service is internal only when the whole compose file says so: what the
/// file includes and what a service extends is read with it, and anything in it that
/// may let a request in, and that Drift does not read, leaves the service unknown. A
/// service that only calls another is its client, and the reason says so.
#[test]
fn what_a_compose_file_brings_in_or_lets_in_is_read_or_nothing_is_internal() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let gateway = "  gateway:\n    image: nginx:alpine\n    ports: [\"9000:80\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n    depends_on: [api]\n";
    let api = "  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n";
    let web = "  web:\n    build: ./web\n    ports: [\"3000:3000\"]\n    environment:\n      API_URL: http://api:8000\n";
    // (the compose file, other files, the exposure of the claim route, what its
    // reason says)
    type Case<'a> = (String, Vec<(&'a str, &'a str)>, &'a str, &'a str);
    let cases: Vec<Case> = vec![
        // The control.
        (
            format!("services:\n{gateway}{api}"),
            vec![],
            "internal",
            "reachable only inside the compose network",
        ),
        // `extends` brings in published ports.
        (
            format!(
                "services:\n{gateway}{api}    extends:\n      file: common.yml\n      service: python-base\n"
            ),
            vec![(
                "services/common.yml",
                "services:\n  python-base:\n    restart: unless-stopped\n    ports:\n      - \"8000:8000\"\n",
            )],
            "public",
            "compose service api in services/compose.yaml publishes ports",
        ),
        // ... from a file that is not there.
        (
            format!(
                "services:\n{gateway}{api}    extends:\n      file: common.yml\n      service: python-base\n"
            ),
            vec![],
            "unknown",
            "compose service api in services/compose.yaml is not all read: services/common.yml is not in the repository",
        ),
        // `include` brings in a gateway that routes everything to the service.
        (
            format!("include:\n  - ./infra/edge.yaml\nservices:\n{api}"),
            vec![
                (
                    "services/infra/edge.yaml",
                    "services:\n  edge:\n    image: nginx:alpine\n    ports: [\"80:80\"]\n    volumes:\n      - ./edge.conf:/etc/nginx/conf.d/default.conf:ro\n",
                ),
                (
                    "services/infra/edge.conf",
                    "server {\n  listen 80;\n  location / { proxy_pass http://api:8000; }\n}\n",
                ),
            ],
            "public",
            "gateway edge (services/infra/edge.conf) routes / to api",
        ),
        (
            format!("include:\n  - ./infra/edge.yaml\nservices:\n{gateway}{api}"),
            vec![],
            "unknown",
            "services/compose.yaml includes `./infra/edge.yaml`, which is not read with it",
        ),
        // A network other compose projects join.
        (
            format!(
                "services:\n{gateway}{api}    networks: [edge]\nnetworks:\n  edge:\n    external: true\n"
            ),
            vec![],
            "unknown",
            "is on the external network `edge`, which containers outside services/compose.yaml join",
        ),
        // A setting Drift does not know.
        (
            format!("services:\n{gateway}{api}    volumes_from: [gateway]\n"),
            vec![],
            "unknown",
            "has `volumes_from`, a setting Drift does not know",
        ),
        // A tunnel publishes nothing and lets the world in.
        (
            format!(
                "services:\n{gateway}{api}  tunnel:\n    image: cloudflare/cloudflared:latest\n    command: tunnel --no-autoupdate run --url http://api:8000\n"
            ),
            vec![],
            "unknown",
            "compose service tunnel in services/compose.yaml may let requests in to api (image cloudflare/cloudflared:latest)",
        ),
        // An application of the repository that can proxy and names the service.
        (
            format!("services:\n{gateway}{api}{web}"),
            vec![
                (
                    "services/web/package.json",
                    "{ \"name\": \"web\", \"dependencies\": { \"express\": \"4.19.0\", \"http-proxy-middleware\": \"3.0.0\" } }\n",
                ),
                (
                    "services/web/src/server.js",
                    "const { createProxyMiddleware } = require(\"http-proxy-middleware\");\n",
                ),
            ],
            "unknown",
            "compose service web in services/compose.yaml may relay requests to api (http-proxy-middleware in services/web/package.json, and its compose definition names it)",
        ),
        (
            format!(
                "services:\n{gateway}{api}  web:\n    build: ./web\n    ports: [\"3000:3000\"]\n"
            ),
            vec![
                (
                    "services/web/package.json",
                    "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n",
                ),
                (
                    "services/web/next.config.mjs",
                    "export default {\n  async rewrites() {\n    return [{ source: \"/backend/:path*\", destination: \"http://api:8000/:path*\" }];\n  },\n};\n",
                ),
            ],
            "unknown",
            "compose service web in services/compose.yaml may relay requests to api (services/web/next.config.mjs names it)",
        ),
        // A rewrite whose target comes from the environment may be this service,
        // which the application is given the name of.
        (
            format!("services:\n{gateway}{api}{web}"),
            vec![
                (
                    "services/web/package.json",
                    "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n",
                ),
                (
                    "services/web/next.config.mjs",
                    "export default {\n  async rewrites() {\n    return [{ source: \"/backend/:path*\", destination: `${process.env.API_URL}/:path*` }];\n  },\n};\n",
                ),
            ],
            "unknown",
            "compose service web in services/compose.yaml may relay requests to api (services/web/next.config.mjs sets `destination` to a target that is not a literal, and its compose definition names it)",
        ),
        // One written out, to another host: the application is still a client.
        (
            format!("services:\n{gateway}{api}{web}"),
            vec![
                (
                    "services/web/package.json",
                    "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n",
                ),
                (
                    "services/web/next.config.mjs",
                    "export default {\n  async rewrites() {\n    return [{ source: \"/docs/:path*\", destination: \"https://docs.example.com/:path*\" }];\n  },\n};\n",
                ),
                (
                    "services/web/middleware.ts",
                    "import { NextResponse } from \"next/server\";\n\nexport function middleware(req) {\n  return NextResponse.rewrite(new URL(\"/login\", req.url));\n}\n",
                ),
            ],
            "internal",
            "reachable only inside the compose network; called by web as a client",
        ),
        // One that only calls it: a client, not a way in.
        (
            format!("services:\n{gateway}{api}{web}"),
            vec![(
                "services/web/package.json",
                "{ \"name\": \"web\", \"dependencies\": { \"express\": \"4.19.0\" } }\n",
            )],
            "internal",
            "reachable only inside the compose network; called by web as a client",
        ),
    ];
    for (compose, files, exposure, says) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            "services/nginx.conf",
            "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
        );
        write(
            r,
            "services/web/Dockerfile",
            "FROM node:22\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"src/server.js\"]\n",
        );
        for (path, text) in files {
            write(r, path, text);
        }
        write(r, "services/compose.yaml", &compose);
        let got = exposures(r);
        let (found, boundary) = got
            .get(CLAIM)
            .unwrap_or_else(|| panic!("{compose}: {got:#?}"));
        assert_eq!(found, exposure, "{compose}\n{boundary}");
        assert!(boundary.contains(says), "{compose}\n{boundary}");
    }
}

/// [STRICT] Every description of a deployment in the repository is found and counts.
/// A compose file is known by what it holds, whatever its name; of two that describe
/// one service the most exposed decides, and the route's reason names each with what
/// it says. A description Drift recognises and does not read (Kubernetes, Terraform)
/// keeps anything from being called internal. A person can leave a description that
/// deploys nothing out, and what it would have said is still said.
#[test]
fn every_description_of_a_deployment_counts_and_the_most_exposed_decides() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let service = |r: &Path| {
        fastapi_service(r, "services/api", "FastAPI()");
        behind_nginx(
            r,
            "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
            "",
        );
    };
    let inventory = |r: &Path| -> Value {
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap()
    };
    let claim = |inv: &Value| -> Value {
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["method"] == "POST" && e["route"] == "/internal/v1/jobs/lease")
            .cloned()
            .unwrap()
    };
    let warned = |inv: &Value, what: &str| {
        inv["boundaries"]["warnings"].as_array().is_some_and(|a| {
            a.iter()
                .any(|w| w.as_str().is_some_and(|w| w.contains(what)))
        })
    };

    // A second stack under a name compose does not look for, whose gateway routes
    // the internal routes.
    let second = |r: &Path| {
        write(
            r,
            "e2e/stack.yml",
            "services:\n  gateway:\n    image: nginx:alpine\n    ports: [\"9000:80\"]\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n",
        );
        write(
            r,
            "e2e/nginx.conf",
            "server {\n  listen 80;\n  location /internal/v1 { proxy_pass http://api:8000; }\n}\n",
        );
    };
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    service(r);
    assert_eq!(exposures(r)[CLAIM].0, "internal");
    second(r);
    let inv = inventory(r);
    let e = claim(&inv);
    assert_eq!(e["exposure"], "public", "{e:#}");
    let boundary = e["boundary"].as_str().unwrap();
    assert!(
        boundary.starts_with("internet-facing in e2e/stack.yml (gateway gateway (e2e/nginx.conf) routes /internal/v1 to api); internal in services/compose.yaml (gateway gateway (services/nginx.conf) routes no location to /internal/v1/jobs/lease on api"),
        "{boundary}"
    );
    assert!(
        boundary.ends_with("a compose file that deploys nothing can be left out under security.not_deployed in .drift/config.yaml"),
        "{boundary}"
    );
    let said: Vec<(&str, &str)> = e["descriptions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["compose"].as_str().unwrap(),
                d["exposure"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        said,
        [
            ("e2e/stack.yml", "public"),
            ("services/compose.yaml", "internal")
        ]
    );
    // Left out by a person: the first stack decides, and the route says what the
    // other would have made of it.
    write(
        r,
        ".drift/config.yaml",
        "security:\n  not_deployed:\n    - e2e/stack.yml\n",
    );
    let inv = inventory(r);
    let e = claim(&inv);
    assert_eq!(e["exposure"], "internal", "{e:#}");
    assert!(
        e["boundary"].as_str().unwrap().ends_with(
            "; e2e/stack.yml, left out by .drift/config.yaml, would make it internet-facing"
        ),
        "{e:#}"
    );
    assert!(e.get("descriptions").is_none(), "{e:#}");
    assert!(
        warned(
            &inv,
            "e2e/stack.yml: left out by .drift/config.yaml (security.not_deployed)"
        ),
        "{inv:#}"
    );

    // A compose file beside the first that names its service is laid over it.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    service(r);
    write(
        r,
        "services/docker-compose.prod.yml",
        "services:\n  api:\n    ports: [\"8000:8000\"]\n",
    );
    let got = exposures(r);
    assert_eq!(
        got[CLAIM],
        (
            "public".to_string(),
            "compose service api in services/docker-compose.prod.yml publishes ports".to_string()
        )
    );

    // Descriptions Drift recognises and does not read.
    for (path, text, kind, left) in [
        (
            "k8s/ingress.yaml",
            "apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: api}\nspec:\n  rules:\n    - http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend: {service: {name: api, port: {number: 8000}}}\n",
            "Kubernetes",
            "k8s",
        ),
        (
            "infra/main.tf",
            "resource \"aws_lb_listener_rule\" \"api\" {\n  listener_arn = var.listener\n}\n",
            "Terraform",
            "infra/main.tf",
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        service(r);
        write(r, path, text);
        let inv = inventory(r);
        let e = claim(&inv);
        assert_eq!(e["exposure"], "unknown", "{e:#}");
        let boundary = e["boundary"].as_str().unwrap();
        // The compose finding is kept, and the files are named. For Terraform the
        // way out is a tie, which is said; never leaving it out.
        let hint = match kind {
            "Terraform" => {
                "; security.terraform in .drift/config.yaml can tie this code to the target group that forwards to it"
            }
            _ => "",
        };
        assert!(
            boundary.contains("reachable only inside the compose network")
                && boundary.ends_with(&format!(
                    "; but {kind} ({path}) in the repository is not read and may route to it{hint}"
                )),
            "{boundary}"
        );
        assert!(
            warned(
                &inv,
                &format!("{kind} in the repository is not read ({path})")
            ),
            "{inv:#}"
        );
        assert_eq!(inv["boundaries"]["unread"][0]["kind"], kind);
        assert_eq!(inv["boundaries"]["unread"][0]["count"], 1);
        write(
            r,
            ".drift/config.yaml",
            &format!("security:\n  not_deployed:\n    - {left}\n"),
        );
        let inv = inventory(r);
        assert_eq!(claim(&inv)["exposure"], "internal", "{inv:#}");
        assert!(
            warned(
                &inv,
                &format!("1 {kind} file left out by .drift/config.yaml")
            ),
            "{inv:#}"
        );
    }

    // A description that deploys the application of another directory to a platform
    // says nothing of this service.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    service(r);
    write(r, "web/vercel.json", "{}\n");
    assert_eq!(exposures(r)[CLAIM].0, "internal");
    // A Procfile with no app.json is not read as a Heroku app (a `fly.toml` with no
    // service is read since, and keeps the code internal: `gap_platform_exposure.rs`).
    write(r, "services/api/Procfile", "web: uvicorn app.main:app\n");
    let got = exposures(r);
    assert_eq!(got[CLAIM].0, "unknown", "{got:#?}");
    assert!(
        got[CLAIM].1.ends_with(
            "; but Procfile (services/api/Procfile) in the repository is not read and may route to it"
        ),
        "{got:#?}"
    );
}

/// [STRICT] What describes a deployment in a form Drift does not read is recognised
/// as Terraform and Kubernetes are, by what the file holds where it can be told
/// (and by its name where the name alone says it), so that a service a compose file
/// publishes nothing of is never said to be internal while one is there: a matrix
/// of every recognised shape (Bicep, an API Gateway OpenAPI document in YAML and in
/// JSON, CloudFormation and SAM in JSON, an ARM template, an Azure Container App,
/// a CDK app by its `cdk.json` and by its dependencies in JavaScript and Python, a
/// Pulumi stack file and a Pulumi program by its dependencies, CDK for Terraform, a
/// Cloud Run service, a Kubernetes manifest in JSON and a kustomization, an ECS task
/// definition, an AWS Copilot manifest, a Cloudflare Worker, App Engine's dispatch,
/// an Azure Developer CLI project, Kamal, and a platform's file that routes
/// elsewhere: Vercel rewrites to another host, Netlify proxy redirects, Firebase
/// rewrites to a service, a `fly.toml` that builds another directory) by every place
/// it may be (beside the services, at the
/// root, deep in an infrastructure tree). A file that only looks related (a
/// `package.json` with no infrastructure library, a `vercel.json` that rewrites
/// within its application, an OpenAPI document with no gateway extension, a JSON
/// configuration) and a platform's file of another directory change nothing. (A
/// Render Blueprint is read since: `gap_platform_exposure.rs` pins what it says.)
#[test]
fn every_description_drift_does_not_read_keeps_a_service_from_being_internal() {
    const CLAIM: &str = "POST /internal/v1/jobs/lease";
    let service = |r: &Path| {
        fastapi_service(r, "services/api", "FastAPI()");
        behind_nginx(
            r,
            "server {\n  listen 80;\n  location /v1/ { proxy_pass http://api:8000; }\n}\n",
            "",
        );
    };
    // (file name, text, the kind said)
    let shapes: &[(&str, &str, &str)] = &[
        (
            "main.bicep",
            "resource api 'Microsoft.App/containerApps@2023-05-01' = {\n  name: 'api'\n  properties: { configuration: { ingress: { external: true, targetPort: 8000 } } }\n}\n",
            "Bicep",
        ),
        (
            "openapi.yaml",
            "openapi: 3.0.1\npaths:\n  /lease:\n    post:\n      x-amazon-apigateway-integration:\n        type: http_proxy\n        uri: http://api.internal:8000/internal/v1/jobs/lease\n",
            "API Gateway",
        ),
        (
            "api.json",
            "{\"openapi\": \"3.0.1\", \"paths\": {\"/lease\": {\"post\": {\"x-amazon-apigateway-integration\": {\"type\": \"http_proxy\", \"uri\": \"http://api:8000/internal/v1/jobs/lease\"}}}}}\n",
            "API Gateway",
        ),
        (
            "gateway.yaml",
            "swagger: '2.0'\npaths:\n  /lease:\n    post:\n      x-google-backend:\n        address: https://api-xyz.a.run.app\n",
            "API Gateway",
        ),
        (
            "template.json",
            "{\"AWSTemplateFormatVersion\": \"2010-09-09\", \"Transform\": \"AWS::Serverless-2016-10-31\", \"Resources\": {}}\n",
            "CloudFormation",
        ),
        (
            "stack.json",
            "{\"Resources\": {\"Api\": {\"Type\": \"AWS::ApiGatewayV2::Api\"}}}\n",
            "CloudFormation",
        ),
        (
            "azuredeploy.json",
            "{\"$schema\": \"https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#\", \"resources\": []}\n",
            "Azure Resource Manager",
        ),
        (
            "containerapp.yaml",
            "type: Microsoft.App/containerApps\nproperties:\n  configuration:\n    ingress:\n      external: true\n",
            "Azure Container Apps",
        ),
        (
            "cdk.json",
            "{ \"app\": \"npx ts-node bin/app.ts\" }\n",
            "CDK",
        ),
        (
            "package.json",
            "{ \"name\": \"infra\", \"dependencies\": { \"aws-cdk-lib\": \"2.150.0\", \"constructs\": \"10.0.0\" } }\n",
            "CDK",
        ),
        (
            "requirements.txt",
            "aws-cdk-lib==2.150.0\nconstructs>=10.0.0\n",
            "CDK",
        ),
        (
            "Pulumi.prod.yaml",
            "config:\n  aws:region: us-east-1\n",
            "Pulumi",
        ),
        (
            "package.json",
            "{ \"name\": \"infra\", \"devDependencies\": { \"@pulumi/aws\": \"6.0.0\" } }\n",
            "Pulumi",
        ),
        (
            "pyproject.toml",
            "[project]\nname = \"infra\"\ndependencies = [\n  \"pulumi>=3.0.0\",\n  \"pulumi-aws>=6.0.0\",\n]\n",
            "Pulumi",
        ),
        (
            "cdktf.json",
            "{ \"language\": \"typescript\", \"app\": \"npx ts-node main.ts\" }\n",
            "CDK for Terraform",
        ),
        (
            "service.yaml",
            "apiVersion: serving.knative.dev/v1\nkind: Service\nmetadata:\n  name: api\n",
            "Kubernetes",
        ),
        (
            "ingress.json",
            "{\"apiVersion\": \"networking.k8s.io/v1\", \"kind\": \"Ingress\"}\n",
            "Kubernetes",
        ),
        (
            "kustomization.yaml",
            "resources:\n  - ingress.yaml\n",
            "Kubernetes",
        ),
        (
            "task-def.json",
            "{\"family\": \"api\", \"containerDefinitions\": [{\"name\": \"api\", \"portMappings\": [{\"containerPort\": 8000}]}]}\n",
            "ECS",
        ),
        (
            "manifest.yml",
            "name: api\ntype: Load Balanced Web Service\nhttp:\n  path: '/'\n",
            "AWS Copilot",
        ),
        (
            "wrangler.toml",
            "name = \"edge\"\nmain = \"src/index.ts\"\nroutes = [{ pattern = \"example.com/*\", zone_name = \"example.com\" }]\n",
            "Cloudflare Workers",
        ),
        (
            "dispatch.yaml",
            "dispatch:\n  - url: '*/internal/*'\n    service: api\n",
            "App Engine dispatch",
        ),
        (
            "azure.yaml",
            "name: shop\nservices:\n  api:\n    project: ./services/api\n    language: py\n    host: containerapp\n",
            "Azure Developer CLI",
        ),
        (
            "deploy.yml",
            "service: api\nimage: org/api\nservers:\n  web:\n    - 192.0.2.1\nproxy:\n  host: api.example.com\n",
            "Kamal",
        ),
        (
            "vercel.json",
            "{\"rewrites\": [{\"source\": \"/internal/(.*)\", \"destination\": \"https://api.example.com/internal/$1\"}]}\n",
            "Vercel rewrites",
        ),
        (
            "netlify.toml",
            "[[redirects]]\n  from = \"/internal/*\"\n  to = \"https://api.example.com/internal/:splat\"\n  status = 200\n",
            "Netlify proxy redirects",
        ),
        (
            "firebase.json",
            "{\"hosting\": {\"rewrites\": [{\"source\": \"/internal/**\", \"run\": {\"serviceId\": \"api\"}}]}}\n",
            "Firebase rewrites",
        ),
        (
            "fly.toml",
            "app = \"api\"\n[build]\n  dockerfile = \"../services/api/Dockerfile\"\n",
            "Fly.io build",
        ),
    ];
    let places = ["deploy", "", "infra/aws/prod"];
    let mut cells = 0;
    let mut wrong = Vec::new();
    for (file, text, kind) in shapes {
        for place in places {
            let path = match place {
                "" => file.to_string(),
                p => format!("{p}/{file}"),
            };
            let dir = tempfile::tempdir().unwrap();
            let r = dir.path();
            service(r);
            assert_eq!(exposures(r)[CLAIM].0, "internal", "{path}: before");
            write(r, &path, text);
            let got = exposures(r);
            let (exposure, boundary) = &got[CLAIM];
            if exposure != "unknown"
                || !boundary.ends_with(&format!(
                    "; but {kind} ({path}) in the repository is not read and may route to it"
                ))
            {
                wrong.push(format!("{path} ({kind}): {exposure}: {boundary}"));
            }
            cells += 1;
        }
    }
    assert_eq!(cells, shapes.len() * places.len());
    assert!(
        wrong.is_empty(),
        "{} of {cells} cells wrong:\n{}",
        wrong.len(),
        wrong.join("\n")
    );

    // What only looks like one says nothing.
    let unrelated: &[(&str, &str)] = &[
        (
            "web/package.json",
            "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\", \"react\": \"19.0.0\" } }\n",
        ),
        (
            "tools/requirements.txt",
            "requests==2.32.0\npulumi_like_name_not==0.1\n",
        ),
        (
            "web/vercel.json",
            "{\"rewrites\": [{\"source\": \"/(.*)\", \"destination\": \"/index.html\"}]}\n",
        ),
        (
            "docs/openapi.yaml",
            "openapi: 3.0.1\npaths:\n  /lease:\n    post:\n      responses: {}\n",
        ),
        (
            "web/tsconfig.json",
            "{ \"compilerOptions\": { \"strict\": true } }\n",
        ),
        (
            "web/netlify.toml",
            "[build]\n  publish = \"dist\"\n[[redirects]]\n  from = \"/*\"\n  to = \"/index.html\"\n  status = 200\n",
        ),
        (
            "web/firebase.json",
            "{\"hosting\": {\"public\": \"dist\", \"rewrites\": [{\"source\": \"**\", \"destination\": \"/index.html\"}]}}\n",
        ),
        (
            "web/render.yaml",
            "services:\n  - type: web\n    name: web\n    buildCommand: npm run build\n",
        ),
        (
            "web/fly.toml",
            "app = \"web\"\n[build]\n  dockerfile = \"Dockerfile\"\n",
        ),
        ("web/apprunner.yaml", "version: 1.0\nruntime: nodejs18\n"),
    ];
    for (path, text) in unrelated {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        service(r);
        write(r, path, text);
        let got = exposures(r);
        assert_eq!(got[CLAIM].0, "internal", "{path}: {:?}", got[CLAIM]);
    }
}

/// A source file that is not read (here a line too long to be written by hand) may
/// hold entry points: `security` says so, in its text and in `skipped`, where it
/// printed its counts as if the file were not there.
#[test]
fn a_source_file_that_is_not_read_is_said_by_security() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    write(
        r,
        "services/api/app/bulk.py",
        &format!(
            "from fastapi import APIRouter\n\nrouter = APIRouter()\nBLOB = \"{}\"\n\n\n@router.post(\"/bulk\")\nasync def bulk():\n    return {{}}\n",
            "x".repeat(6000)
        ),
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let skipped = inv["skipped"].as_array().expect("skipped");
    assert_eq!(skipped.len(), 1, "{inv:#}");
    assert_eq!(skipped[0]["path"], "services/api/app/bulk.py");
    assert_eq!(skipped[0]["reason"], "minified");
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains("1 source file(s) NOT READ, so an entry point or a risky operation in one is not listed: services/api/app/bulk.py (minified)"),
        "{text}"
    );
}

/// Thousands of routes behind thousands of rewriting locations: each pair compared
/// is a step of the run's budget, so `security` and `card` answer in bounded time,
/// and what was not compared is unknown and says why.
#[test]
fn many_routes_behind_many_rewriting_locations_are_compared_in_bounded_time() {
    const N: usize = 1500;
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fastapi_service(r, "services/api", "FastAPI()");
    let mut rules =
        String::from("from fastapi import APIRouter\n\nrouter = APIRouter(prefix=\"/rules\")\n");
    for i in 0..N {
        rules.push_str(&format!(
            "\n\n@router.get(\"/r{i}/{{a}}/{{b}}/x{i}/{{c}}\")\nasync def r{i}(a: str, b: str, c: str):\n    return {{}}\n"
        ));
    }
    write(r, "services/api/app/rules.py", &rules);
    let mut conf = String::from("server {\n  listen 80;\n");
    for i in 0..N {
        conf.push_str(&format!(
            "  location /p{i}/ {{ rewrite ^/p{i}/(\\w+)/(.*)$ /v1/$1/$2 break; proxy_pass http://api:8000; }}\n"
        ));
    }
    conf.push_str("}\n");
    behind_nginx(r, &conf, "");
    let out = drift_within(r, &["--no-cache", "security", "--json"], 60).expect("security in time");
    let inv: Value = serde_json::from_str(&out).unwrap();
    let claim = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == "/internal/v1/jobs/lease")
        .unwrap();
    assert_eq!(claim["exposure"], "unknown", "{claim:#}");
    assert!(
        claim["boundary"]
            .as_str()
            .unwrap()
            .ends_with("there are more routes and locations than Drift compares in one run"),
        "{claim:#}"
    );
    assert!(
        drift_within(
            r,
            &["--no-cache", "card", "services/api/app/internal.py"],
            60
        )
        .is_some(),
        "card in time"
    );
}

#[test]
fn a_broken_compose_file_or_setting_is_a_warning_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        "{ \"name\": \"t\", \"dependencies\": { \"next\": \"15.0.0\" } }",
    );
    write(r, "app/api/x/route.ts", UNGUARDED);
    write(r, "compose.yaml", "services: [\n");
    write(
        r,
        ".drift/config.yaml",
        "security:\n  internal: apps/admin\n  colour: red\n",
    );
    let text = drift(r, &["--no-cache", "security"]);
    assert!(text.contains("compose.yaml: not parsed"), "{text}");
    assert!(
        text.contains("'security.internal' must be a list of directories (ignored)"),
        "{text}"
    );
    assert!(
        text.contains("unknown 'security' setting 'colour' (ignored)"),
        "{text}"
    );
    assert!(!text.contains("Exposure:"), "{text}");
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    assert_eq!(inv["boundaries"]["warnings"].as_array().unwrap().len(), 3);
}

/// A published application of the repository that names an unpublished service is
/// its client only when the path of every request it sends is written out. One whose
/// handler builds the URL from the request it serves (a catch-all route, the
/// request's path) relays whatever it is asked for: the service's routes are then
/// unknown, never internal, and the reason names the handler. So is one whose URL is
/// not read. Code that runs in the browser sends nothing from the application.
#[test]
fn an_application_that_forwards_what_it_is_asked_is_not_a_client() {
    let compose = |web: &str| {
        format!(
            "services:\n  web:\n    build: ./{web}\n    ports: [\"3000:3000\"]\n    environment:\n      API_URL: http://api:8000\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n"
        )
    };
    let next = "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n";
    let python = "[project]\nname = \"bff\"\ndependencies = [\"fastapi\", \"httpx\"]\n";
    type Case = (
        &'static str,
        Vec<(&'static str, &'static str)>,
        &'static str,
        &'static str,
    );
    let cases: Vec<Case> = vec![
        // A Next catch-all route handler that forwards the path it is given.
        (
            "web",
            vec![
                ("services/web/package.json", next),
                (
                    "services/web/app/api/proxy/[...path]/route.ts",
                    "async function forward(req: Request, path: string[]) {\n  const url = `${process.env.API_URL}/${path.join(\"/\")}`;\n  return fetch(url, { method: req.method });\n}\n\nexport async function GET(req: Request, { params }: { params: { path: string[] } }) {\n  return forward(req, params.path);\n}\n",
                ),
            ],
            "unknown",
            "compose service web in services/compose.yaml may relay requests to api: `forward` (services/web/app/api/proxy/[...path]/route.ts:3) sends a request, and `path.join(\"/\")` is built from the request being served",
        ),
        // A URL that is a parameter of a helper: where it goes is not read.
        (
            "web",
            vec![
                ("services/web/package.json", next),
                (
                    "services/web/lib/api.ts",
                    "export async function call(target: string) {\n  return fetch(target);\n}\n",
                ),
            ],
            "unknown",
            "`call` (services/web/lib/api.ts:2) sends a request, and `target` is not read",
        ),
        // The same in Python: a catch-all route relayed with httpx.
        (
            "bff",
            vec![
                ("services/bff/pyproject.toml", python),
                (
                    "services/bff/main.py",
                    "import os\n\nimport httpx\nfrom fastapi import FastAPI, Request\n\napp = FastAPI()\nAPI = os.environ[\"API_URL\"]\n\n\n@app.api_route(\"/proxy/{full_path:path}\", methods=[\"GET\", \"POST\"])\nasync def relay(full_path: str, request: Request):\n    async with httpx.AsyncClient() as client:\n        upstream = await client.request(request.method, f\"{API}/{full_path}\")\n    return upstream.json()\n",
                ),
            ],
            "unknown",
            "compose service web in services/compose.yaml may relay requests to api: `relay` (services/bff/main.py:13) sends a request, and `full_path` is built from the request being served",
        ),
        // Paths written out, an identifier aside: a client.
        (
            "web",
            vec![
                ("services/web/package.json", next),
                (
                    "services/web/app/api/rules/[id]/route.ts",
                    "export async function GET(req: Request, { params }: { params: { id: string } }) {\n  const res = await fetch(`${process.env.API_URL}/v1/rules/${params.id}`);\n  return Response.json(await res.json());\n}\n",
                ),
                (
                    "services/web/app/rules.tsx",
                    "\"use client\";\n\nexport async function load(target: string) {\n  return fetch(target);\n}\n",
                ),
            ],
            "internal",
            "compose service api in services/compose.yaml publishes no ports; called by web as a client",
        ),
        (
            "bff",
            vec![
                ("services/bff/pyproject.toml", python),
                (
                    "services/bff/main.py",
                    "import os\n\nimport httpx\nfrom fastapi import FastAPI\n\napp = FastAPI()\nAPI = os.environ[\"API_URL\"]\n\n\n@app.get(\"/rules/{rule_id}\")\nasync def rule(rule_id: str):\n    url = f\"{API}/v1/rules/{rule_id}\"\n    return httpx.get(url).json()\n",
                ),
            ],
            "internal",
            "compose service api in services/compose.yaml publishes no ports; called by web as a client",
        ),
    ];
    for (web, files, exposure, says) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            &format!("services/{web}/Dockerfile"),
            "FROM node:22\nWORKDIR /app\nCOPY . .\n",
        );
        for (path, text) in &files {
            write(r, path, text);
        }
        write(r, "services/compose.yaml", &compose(web));
        let got = exposures(r);
        let (found, boundary) = &got["POST /internal/v1/jobs/lease"];
        assert_eq!(found, exposure, "{files:?}: {boundary}");
        assert!(boundary.contains(says), "{files:?}: {boundary}");
    }
}

/// Something of the repository's Terraform that is not read: what it is, the module
/// of the service, further files, and what the verdict says of it.
type Unread = (
    &'static str,
    String,
    &'static [(&'static str, &'static str)],
    &'static str,
);

const TF_GROUP: &str = "resource \"aws_lb_target_group\" \"api\" {\n  port     = 8000\n  protocol = \"HTTP\"\n  vpc_id   = var.vpc_id\n}\n";

/// A listener rule of the module `infra/modules/api` that forwards to its target
/// group `group`: `head` are attributes of the rule, `patterns` the expression of its
/// path patterns.
fn tf_rule(name: &str, head: &str, group: &str, patterns: &str) -> String {
    format!(
        "\nresource \"aws_lb_listener_rule\" \"{name}\" {{\n  listener_arn = data.aws_lb_listener.https.arn\n  priority     = 1\n{head}\n  action {{\n    type             = \"forward\"\n    target_group_arn = {group}\n  }}\n\n  condition {{\n    path_pattern {{\n      values = {patterns}\n    }}\n  }}\n  condition {{\n    host_header {{\n      values = [var.hostname]\n    }}\n  }}\n}}\n"
    )
}

/// The service `api` behind nginx, which routes `/v1/rules` to it and nothing else,
/// and Terraform beside it: the module of the service (`api`: its target group and
/// rules), a load balancer whose listeners answer for themselves, and another
/// service's module with a rule for every path. `tie`: the `security:` of the config.
fn with_terraform(r: &Path, api: &str, more: &[(&str, &str)], tie: &str) {
    fastapi_service(r, "services/api", "FastAPI()");
    behind_nginx(
        r,
        "server {\n  listen 80;\n  location /v1/rules {\n    proxy_pass http://api:8000;\n  }\n}\n",
        "",
    );
    write(r, "infra/modules/api/main.tf", &format!("{TF_GROUP}{api}"));
    write(
        r,
        "infra/modules/web/main.tf",
        "resource \"aws_lb_target_group\" \"web\" {\n  port = 3000\n}\n\nresource \"aws_lb_listener_rule\" \"web\" {\n  listener_arn = data.aws_lb_listener.https.arn\n  priority     = 9\n\n  action {\n    type             = \"forward\"\n    target_group_arn = aws_lb_target_group.web.id\n  }\n\n  condition {\n    path_pattern {\n      values = [\"/*\"]\n    }\n  }\n}\n\nresource \"aws_lb_listener_rule\" \"old\" {\n  listener_arn = data.aws_lb_listener.https.arn\n  action {\n    type = \"redirect\"\n    redirect {\n      path        = \"/v1/#{path}\"\n      status_code = \"HTTP_301\"\n    }\n  }\n  condition {\n    path_pattern {\n      values = [\"/internal/*\"]\n    }\n  }\n}\n",
    );
    write(
        r,
        "infra/modules/lb/main.tf",
        "module \"alb\" {\n  source = \"terraform-aws-modules/alb/aws\"\n  name   = var.name\n\n  listeners = {\n    https = {\n      port        = 443\n      protocol    = \"HTTPS\"\n      action_type = \"fixed-response\"\n      fixed_response = {\n        content_type = \"text/plain\"\n        status_code  = \"404\"\n      }\n    }\n  }\n}\n",
    );
    write(
        r,
        "infra/live/prod/api/terragrunt.hcl",
        "include \"root\" {\n  path = find_in_parent_folders(\"root.hcl\")\n}\n\nterraform {\n  source = \"../../../modules/api\"\n}\n",
    );
    for (path, text) in more {
        write(r, path, text);
    }
    if tie.is_empty() {
        let _ = std::fs::remove_file(r.join(".drift/config.yaml"));
    } else {
        write(r, ".drift/config.yaml", &format!("security:\n{tie}"));
    }
}

/// `security.terraform` ties a code directory to the target group that forwards to
/// it, and the listener rules of the repository's Terraform are then read for its
/// routes: internet-facing where a rule that is read carries the route to the tied
/// target, unknown where one may or where something that may forward is not read,
/// internal otherwise. Without a tie Terraform is a description that is not read,
/// and the hint is to tie, never to leave it out.
#[test]
fn a_terraform_tie_reads_the_listener_rules_for_the_tied_code() {
    const TIE: &str = "  terraform:\n    - target: infra/modules/api\n      code: services/api\n";
    const ID: &str = "aws_lb_target_group.api.id";
    let plain = tf_rule("api", "", ID, "[\"/v1/rules*\"]");
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    let of = |route: &str| -> (String, String) { exposures(r)[route].clone() };

    // No tie: nothing is internal, and the way out is the tie.
    with_terraform(r, &plain, &[], "");
    let (exposure, why) = of("GET /v2/rules");
    assert_eq!(exposure, "unknown", "{why}");
    assert!(
        why.contains("Terraform") && why.contains("security.terraform"),
        "{why}"
    );
    assert!(!why.contains("not_deployed"), "{why}");
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let warnings = inv["boundaries"]["warnings"].to_string();
    assert!(
        warnings.contains("Terraform in the repository is not read")
            && warnings.contains("security.terraform")
            && !warnings.contains("not_deployed"),
        "{warnings}"
    );

    // Tied: each route is what the rules say of it, beside what compose says.
    with_terraform(r, &plain, &[], TIE);
    for route in ["GET /v1/rules", "GET /v1/rules/{rule_id}"] {
        let (exposure, why) = of(route);
        assert_eq!(exposure, "public", "{route}: {why}");
        assert!(
            why.contains("a listener rule forwards /v1/rules* to"),
            "{why}"
        );
    }
    for route in [
        "GET /v2/rules",
        "GET /v2/rules/{rule_id}",
        "POST /internal/v1/jobs/lease",
        "GET /health",
    ] {
        let (exposure, why) = of(route);
        assert_eq!(exposure, "internal", "{route}: {why}");
        assert!(
            why.contains("no listener rule in the repository's Terraform forwards")
                && why.contains("tied to services/api by .drift/config.yaml")
                && why.contains("what else Terraform opens to it is not read")
                && why.contains("nor whether an application another rule publishes relays")
                && why.contains("internal in services/compose.yaml"),
            "{route}: {why}"
        );
    }
    let text = drift(r, &["--no-cache", "security"]);
    assert!(
        text.contains(
            "of which 2 internet-facing, 4 internal and 0 unknown rest on a Terraform tie"
        ),
        "{text}"
    );
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    assert!(
        inv["entry_points"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["tied"] == true),
        "{inv:#}"
    );

    // Each of these keeps every route that is not carried from being internal.
    const VARIABLE: &str = "\nresource \"aws_lb_listener_rule\" \"other\" {\n  listener_arn = var.listener_arn\n  action {\n    type             = \"forward\"\n    target_group_arn = var.target_group_arn\n  }\n  condition {\n    path_pattern {\n      values = [\"/reports/*\"]\n    }\n  }\n}\n";
    let unknown: &[Unread] = &[
        (
            "a rule to the tied target with for_each",
            format!(
                "{plain}{}",
                tf_rule("each", "  for_each     = var.paths", ID, "[each.value]")
            ),
            &[],
            "is not read (it has `for_each`)",
        ),
        (
            "a rule to the tied target with count",
            format!(
                "{plain}{}",
                tf_rule(
                    "counted",
                    "  count        = var.enabled ? 1 : 0",
                    "aws_lb_target_group.api[0].arn",
                    "[\"/reports/*\"]"
                )
            ),
            &[],
            "is not read (it has `count`)",
        ),
        (
            "a rule to the tied target whose patterns are a variable",
            format!(
                "{plain}{}",
                tf_rule("patterns", "", ID, "var.listener_path_patterns")
            ),
            &[],
            "its path patterns are not literal strings",
        ),
        (
            "a rule to the tied target with another kind of condition",
            format!(
                "{plain}{}",
                tf_rule("api_header", "", ID, "[\"/reports/*\"]")
                    .replace("host_header", "http_header")
            ),
            &[],
            "its `http_header` condition is not read",
        ),
        (
            "a rule of another module whose target is a variable",
            plain.clone(),
            &[("infra/modules/shared/main.tf", VARIABLE)],
            "its target is not a target group of its module",
        ),
        (
            "a listener that forwards by default",
            plain.clone(),
            &[(
                "infra/modules/edge/main.tf",
                "resource \"aws_lb_listener\" \"https\" {\n  load_balancer_arn = aws_lb.main.arn\n  port              = 443\n\n  default_action {\n    type             = \"forward\"\n    target_group_arn = var.default_target\n  }\n}\n",
            )],
            "listener `https` (infra/modules/edge/main.tf:1) may forward by default",
        ),
        (
            "a load-balancer module whose listener forwards by default",
            plain.clone(),
            &[(
                "infra/modules/edge/main.tf",
                "module \"alb\" {\n  source = \"terraform-aws-modules/alb/aws\"\n\n  listeners = {\n    https = {\n      port = 443\n      forward = {\n        target_group_key = \"api\"\n      }\n    }\n  }\n}\n",
            )],
            "module `alb` (infra/modules/edge/main.tf:1) has a listener that forwards by default",
        ),
        (
            "a terragrunt.hcl with a generate block",
            plain.clone(),
            &[(
                "infra/live/prod/edge/terragrunt.hcl",
                "generate \"rules\" {\n  path      = \"rules.tf\"\n  if_exists = \"overwrite\"\n  contents  = <<EOF\nresource \"aws_lb_listener_rule\" \"more\" {}\nEOF\n}\n",
            )],
            "has a `generate` block",
        ),
    ];
    for (what, api, more, said) in unknown {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        with_terraform(r, api, more, TIE);
        let all = exposures(r);
        for route in [
            "GET /v2/rules",
            "POST /internal/v1/jobs/lease",
            "GET /health",
        ] {
            let (exposure, why) = &all[route];
            assert_eq!(exposure, "unknown", "{what}, {route}: {why}");
            assert!(
                why.contains(said) && why.contains(".drift/config.yaml"),
                "{what}: {why}"
            );
        }
        // What a rule that is read carries stays internet-facing.
        assert_eq!(all["GET /v1/rules"].0, "public", "{what}");
    }

    // Two target groups in the tied module: a rule to either carries.
    let admin = format!(
        "{plain}\nresource \"aws_lb_target_group\" \"admin\" {{\n  port = 8001\n}}\n{}",
        tf_rule(
            "admin",
            "",
            "aws_lb_target_group.admin.arn",
            "[\"/v2/rules\", \"/v2/rules/*\"]"
        )
    );
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    with_terraform(r, &admin, &[], TIE);
    let all = exposures(r);
    assert_eq!(
        all["GET /v2/rules"].0, "public",
        "{:?}",
        all["GET /v2/rules"]
    );
    assert_eq!(all["GET /v2/rules/{rule_id}"].0, "public");
    assert_eq!(all["POST /internal/v1/jobs/lease"].0, "internal");
    // The tie names one of them: the other's rule says nothing of this code.
    with_terraform(
        r,
        &admin,
        &[],
        "  terraform:\n    - target: infra/modules/api#aws_lb_target_group.api\n      code: services/api\n",
    );
    let all = exposures(r);
    assert_eq!(
        all["GET /v2/rules"].0, "internal",
        "{:?}",
        all["GET /v2/rules"]
    );
    assert_eq!(all["GET /v1/rules"].0, "public");

    // `?` is one character and `*` any run: a pattern that just misses the route
    // leaves it internal, one that just catches it makes it internet-facing.
    for (patterns, v2, by_id) in [
        ("[\"/v1/rules*\", \"/v2/rules?\"]", "internal", "internal"),
        ("[\"/v1/rules*\", \"/v?/rules\"]", "public", "internal"),
        (
            "[\"/v1/rules*\", \"/v2/rulesets*\"]",
            "internal",
            "internal",
        ),
        ("[\"/v1/rules*\", \"/v2/rule*\"]", "public", "public"),
        ("[\"/v1/rules*\", \"/v2/rules/?\"]", "internal", "unknown"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        with_terraform(r, &tf_rule("api", "", ID, patterns), &[], TIE);
        let all = exposures(r);
        assert_eq!(
            all["GET /v2/rules"].0, v2,
            "{patterns}: {:?}",
            all["GET /v2/rules"]
        );
        assert_eq!(
            all["GET /v2/rules/{rule_id}"].0, by_id,
            "{patterns}: {:?}",
            all["GET /v2/rules/{rule_id}"]
        );
        assert_eq!(
            all["POST /internal/v1/jobs/lease"].0, "internal",
            "{patterns}"
        );
    }

    // A tie that names no target group of the repository is said, and ties nothing.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    with_terraform(
        r,
        &plain,
        &[],
        "  terraform:\n    - target: infra/modules/nowhere\n      code: services/api\n",
    );
    assert_eq!(exposures(r)["GET /v2/rules"].0, "unknown");
    let inv: Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    assert!(
        inv["boundaries"]["warnings"]
            .to_string()
            .contains("no such `aws_lb_target_group` is in the repository's Terraform"),
        "{}",
        inv["boundaries"]["warnings"]
    );
}

/// A URL bound to a literal is the literal only where nothing writes it again: a
/// `let` or `var` assigned later (`target = req.query.url`), or an object built
/// from it whose parts are set later (`u.host = ...`), sends a request to what the
/// request served may name. The unpublished service it names is then unknown,
/// never internal. A `const` of a literal no one writes is the literal: a client.
#[test]
fn a_url_bound_to_a_literal_and_written_again_is_not_a_fixed_url() {
    let compose = |web: &str| {
        format!(
            "services:\n  web:\n    build: ./{web}\n    ports: [\"3000:3000\"]\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n"
        )
    };
    let next = "{ \"name\": \"web\", \"dependencies\": { \"next\": \"15.0.0\" } }\n";
    let python = "[project]\nname = \"bff\"\ndependencies = [\"fastapi\", \"requests\"]\n";
    let route = "services/web/app/api/proxy/route.ts";
    let cases: Vec<(&str, &str, &str, String, &str)> = vec![
        (
            "let",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  let target = \"http://api:8000/health\";\n  target = new URL(req.url).searchParams.get(\"url\")!;\n  return fetch(target);\n}\n".to_string(),
            "unknown",
        ),
        (
            "var",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  var target = \"http://api:8000/health\";\n  target = new URL(req.url).searchParams.get(\"url\")!;\n  return fetch(target);\n}\n".to_string(),
            "unknown",
        ),
        (
            "an object set later",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  const u = new URL(\"http://api:8000/health\");\n  u.host = new URL(req.url).searchParams.get(\"host\")!;\n  return fetch(u);\n}\n".to_string(),
            "unknown",
        ),
        (
            "destructured, assigned again",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  let { target } = { target: \"http://api:8000/health\" };\n  target = new URL(req.url).searchParams.get(\"url\")!;\n  return fetch(target);\n}\n".to_string(),
            "unknown",
        ),
        (
            "a parameter's default",
            "web",
            "services/web/package.json",
            "async function go(target = \"http://api:8000/health\") {\n  return fetch(target);\n}\n\nexport async function GET(req: Request) {\n  return go(new URL(req.url).searchParams.get(\"url\")!);\n}\n".to_string(),
            "unknown",
        ),
        (
            "a property of a const object set later",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  const cfg = { url: \"http://api:8000/health\" };\n  cfg.url = new URL(req.url).searchParams.get(\"url\")!;\n  return fetch(cfg.url);\n}\n".to_string(),
            "unknown",
        ),
        (
            "python",
            "bff",
            "services/bff/pyproject.toml",
            "import requests\nfrom fastapi import FastAPI, Request\n\napp = FastAPI()\n\n\n@app.get(\"/proxy\")\nasync def relay(request: Request):\n    target = \"http://api:8000/health\"\n    target = request.query_params[\"url\"]\n    return requests.get(target).json()\n".to_string(),
            "unknown",
        ),
        (
            "python, assigned once",
            "bff",
            "services/bff/pyproject.toml",
            "import requests\nfrom fastapi import FastAPI, Request\n\napp = FastAPI()\n\n\n@app.get(\"/proxy\")\nasync def relay(request: Request):\n    target = \"http://api:8000/health\"\n    return requests.get(target).json()\n".to_string(),
            "internal",
        ),
        (
            "const",
            "web",
            "services/web/package.json",
            "export async function GET(req: Request) {\n  const target = \"http://api:8000/health\";\n  return fetch(target);\n}\n".to_string(),
            "internal",
        ),
    ];
    let mut wrong = Vec::new();
    for (what, web, manifest, code, exposure) in cases {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fastapi_service(r, "services/api", "FastAPI()");
        write(
            r,
            &format!("services/{web}/Dockerfile"),
            "FROM node:22\nWORKDIR /app\nCOPY . .\n",
        );
        if web == "web" {
            write(r, manifest, next);
            write(r, route, &code);
        } else {
            write(r, manifest, python);
            write(r, "services/bff/main.py", &code);
        }
        write(r, "services/compose.yaml", &compose(web));
        let got = exposures(r);
        let (found, boundary) = &got["POST /internal/v1/jobs/lease"];
        if found != exposure {
            wrong.push(format!("{what}: {found}, expected {exposure} ({boundary})"));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
