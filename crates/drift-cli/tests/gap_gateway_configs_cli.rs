//! `drift security --json` behind gateways that are not nginx, Traefik labels or a
//! Caddyfile: a compose stack fronted by HAProxy, Envoy, Kong (DB-less), Apache
//! httpd, or Traefik's file provider has each route of the service behind it decided
//! on its own, from the configuration the gateway mounts. Before, every route there
//! read unknown.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

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

/// A FastAPI service in `services/api`: `/v1/rules`, `/health`, and an internal
/// `/internal/v1/jobs/lease`, started by a command Drift reads.
fn api(r: &Path) {
    write(
        r,
        "services/api/pyproject.toml",
        "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "services/api/app/__init__.py", "");
    write(
        r,
        "services/api/Dockerfile",
        "FROM python:3.12\nWORKDIR /app\nCOPY . /app\nCMD [\"uvicorn\", \"app.main:app\", \"--host\", \"0.0.0.0\"]\n",
    );
    write(
        r,
        "services/api/app/main.py",
        "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/v1/rules\")\nasync def list_rules():\n    return []\n\n\n@app.post(\"/internal/v1/jobs/lease\")\nasync def lease_job():\n    return {}\n",
    );
}

/// A stack in `services/compose.yaml`: the gateway `edge` (its definition `gateway`,
/// with its configuration `files` written beside the compose file) in front of `api`,
/// which publishes no ports. (exposure, boundary) of each route of `api`.
fn behind(gateway: &str, files: &[(&str, &str)]) -> BTreeMap<String, (String, String)> {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    api(r);
    write(
        r,
        "services/compose.yaml",
        &format!(
            "services:\n  edge:\n{gateway}    ports: [\"9000:80\"]\n    depends_on: [api]\n  api:\n    build:\n      context: ..\n      dockerfile: services/api/Dockerfile\n"
        ),
    );
    for (rel, text) in files {
        write(r, &format!("services/{rel}"), text);
    }
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

/// The routes of `api` by their exposure: (`GET /v1/rules`, `POST /internal/...`).
fn pair(got: &BTreeMap<String, (String, String)>) -> (&str, &str) {
    let of = |k: &str| got.get(k).map_or("missing", |(x, _)| x.as_str());
    (of("GET /v1/rules"), of("POST /internal/v1/jobs/lease"))
}

const HAPROXY: &str = "defaults\n  mode http\n  timeout connect 5s\nfrontend web\n  bind :80\n  acl api_paths path_beg /v1/\n  use_backend api if api_paths\nbackend api\n  server a api:8000\n";

/// Pins HAProxy through the CLI: the route `use_backend` carries is internet-facing
/// and names the rule, the route nothing forwards is internal, and Lua that Drift
/// does not read makes it unknown.
#[test]
fn haproxy_stack() {
    let gw = "    image: haproxy:2.9\n    volumes:\n      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro\n";
    let got = behind(gw, &[("haproxy.cfg", HAPROXY)]);
    assert_eq!(pair(&got), ("public", "internal"), "{got:#?}");
    assert_eq!(
        got["GET /v1/rules"].1,
        "gateway edge (services/haproxy.cfg) routes use_backend api if api_paths to api"
    );
    let lua = HAPROXY.replace("  use_backend", "  http-request lua.check\n  use_backend");
    let got = behind(gw, &[("haproxy.cfg", &lua)]);
    assert_eq!(pair(&got).1, "unknown", "{got:#?}");
}

const ENVOY: &str = "static_resources:\n  listeners:\n  - name: main\n    filter_chains:\n    - filters:\n      - name: envoy.filters.network.http_connection_manager\n        typed_config:\n          \"@type\": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager\n          route_config:\n            virtual_hosts:\n            - name: all\n              domains: [\"*\"]\n              routes:\n              - match: { prefix: \"/v1/\" }\n                route: { cluster: api }\n          http_filters:\n          - name: envoy.filters.http.router\n  clusters:\n  - name: api\n    type: STRICT_DNS\n    load_assignment:\n      cluster_name: api\n      endpoints:\n      - lb_endpoints:\n        - endpoint: { address: { socket_address: { address: api, port_value: 8000 } } }\n";

/// Pins Envoy through the CLI, its configuration at the official image's default
/// path; a `safe_regex` route makes the other route unknown.
#[test]
fn envoy_stack() {
    let gw = "    image: envoyproxy/envoy:v1.31-latest\n    volumes:\n      - ./envoy.yaml:/etc/envoy/envoy.yaml:ro\n";
    let got = behind(gw, &[("envoy.yaml", ENVOY)]);
    assert_eq!(pair(&got), ("public", "internal"), "{got:#?}");
    let regex = ENVOY.replace(
        "{ prefix: \"/v1/\" }",
        "{ safe_regex: { regex: \"^/v1/.*\" } }",
    );
    let got = behind(gw, &[("envoy.yaml", &regex)]);
    assert_eq!(pair(&got), ("unknown", "unknown"), "{got:#?}");
}

const KONG: &str = "_format_version: \"3.0\"\nservices:\n- name: api\n  url: http://api:8000\n  routes:\n  - name: rules\n    paths: [/v1]\n    strip_path: false\n";

/// Pins Kong DB-less through the CLI, its declarative file named by its
/// environment; in database mode its routes are not in the repository and stay
/// unknown.
#[test]
fn kong_stack() {
    let gw = "    image: kong:3.6\n    environment:\n      KONG_DATABASE: \"off\"\n      KONG_DECLARATIVE_CONFIG: /kong/kong.yml\n    volumes:\n      - ./kong.yml:/kong/kong.yml:ro\n";
    let got = behind(gw, &[("kong.yml", KONG)]);
    assert_eq!(pair(&got), ("public", "internal"), "{got:#?}");
    let db = gw.replace("\"off\"", "postgres");
    let got = behind(&db, &[("kong.yml", KONG)]);
    assert_eq!(pair(&got).1, "unknown", "{got:#?}");
}

const HTTPD: &str = "ServerRoot \"/usr/local/apache2\"\nListen 80\nLoadModule proxy_module modules/mod_proxy.so\nLoadModule proxy_http_module modules/mod_proxy_http.so\n<VirtualHost *:80>\n  ServerName app.example.com\n  ProxyPass /v1 http://api:8000/v1\n  ProxyPassReverse /v1 http://api:8000/v1\n</VirtualHost>\n";

/// Pins Apache httpd through the CLI; a `RewriteRule` that rewrites the path,
/// which Drift does not follow, makes the other route unknown.
#[test]
fn httpd_stack() {
    let gw = "    image: httpd:2.4\n    volumes:\n      - ./httpd.conf:/usr/local/apache2/conf/httpd.conf:ro\n";
    let got = behind(gw, &[("httpd.conf", HTTPD)]);
    assert_eq!(pair(&got), ("public", "internal"), "{got:#?}");
    let rewrite = HTTPD.replace(
        "  ProxyPass /v1",
        "  RewriteEngine On\n  RewriteRule ^/old/(.*)$ /v1/$1 [PT]\n  ProxyPass /v1",
    );
    let got = behind(gw, &[("httpd.conf", &rewrite)]);
    assert_eq!(pair(&got).1, "unknown", "{got:#?}");
}

/// Pins Traefik's file provider through the CLI: the router in the dynamic file is
/// read beside the labels (none here, the docker provider exposing nothing by
/// default), and the file provider no longer leaves every route unknown.
#[test]
fn traefik_file_provider_stack() {
    let gw = "    image: traefik:v3.0\n    command:\n      - --providers.docker=true\n      - --providers.docker.exposedbydefault=false\n      - --providers.file.filename=/etc/traefik/dynamic.yml\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock:ro\n      - ./dynamic.yml:/etc/traefik/dynamic.yml:ro\n";
    let dynamic = "http:\n  routers:\n    api:\n      rule: \"PathPrefix(`/v1`)\"\n      service: api\n  services:\n    api:\n      loadBalancer:\n        servers:\n          - url: \"http://api:8000\"\n";
    let got = behind(gw, &[("dynamic.yml", dynamic)]);
    assert_eq!(pair(&got), ("public", "internal"), "{got:#?}");
}
