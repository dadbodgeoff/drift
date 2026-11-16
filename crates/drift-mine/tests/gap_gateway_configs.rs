//! Gateways read from their own configuration (HAProxy, Envoy, Kong, httpd,
//! Traefik's file provider, a Caddy snippet, an nginx anchored-prefix regex), so
//! that a route behind them is decided on its own: internet-facing where a rule
//! provably carries it, internal where no rule can and everything was read, unknown
//! where a rule Drift does not evaluate, or a part it does not read, may carry it.

use std::path::Path;

use drift_mine::gateway::{Gateway, Route, Target};
use drift_mine::gateway_configs::{self as configs, Fs};

fn resolve(host: &str) -> Target {
    match host {
        "api" | "web" | "jobs" => Target::Services(vec![host.to_string()]),
        _ => Target::Unresolved,
    }
}

fn route(t: &str) -> Route {
    Route::parse(t).unwrap()
}

/// (carried by, may carry) of `path` on `service`, over every gateway read.
fn verdict(gs: &[Gateway], service: &str, path: &str) -> &'static str {
    let r = route(path);
    if gs.iter().any(|g| g.carries(service, &r).is_some()) {
        "public"
    } else if gs
        .iter()
        .any(|g| g.may_carry(service, &r).is_some() || !g.unread.is_empty())
    {
        "unknown"
    } else {
        "internal"
    }
}

fn write(root: &Path, rel: &str, text: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

const HAPROXY: &str = "global\n  maxconn 256\ndefaults\n  mode http\n  timeout client 30s\nfrontend web\n  bind :80\n  acl is_api path_beg /api\n  http-request redirect scheme https unless { ssl_fc }\n  http-request deny if { path_beg /api/admin }\n  use_backend api if is_api\n  default_backend site\nbackend api\n  server a1 api:8000 check\nbackend site\n  server w1 web:3000\n";

/// Pins HAProxy: `use_backend ... if` a path ACL carries the route, the default
/// backend carries what nothing else takes, a path no rule to the service can match
/// is internal, a deny is not forwarded, and a TLS redirect does not stop the proof.
#[test]
fn haproxy_routes_each_path_by_its_rules() {
    let files = [("haproxy/haproxy.cfg".to_string(), HAPROXY.to_string())];
    let gs = configs::haproxy("edge", &files, &resolve).unwrap();
    assert!(gs.iter().all(|g| g.unread.is_empty()), "{:?}", gs[0].unread);
    assert_eq!(verdict(&gs, "api", "/api/users/{id}"), "public");
    assert_eq!(verdict(&gs, "web", "/about"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");
    // Denied first: never proved carried (and the `/api` rule could still reach it
    // in another case or with a trailing slash, so not internal either).
    assert_ne!(verdict(&gs, "api", "/api/admin/users"), "public");
    assert_eq!(
        gs[0].carries("api", &route("/api/users")),
        Some("use_backend api if is_api")
    );
}

/// Pins what HAProxy reads as unknown: a fetch it does not evaluate may carry
/// anything to its backend, a map file or Lua leaves the configuration not all read,
/// and a `tcp` frontend carries every path.
#[test]
fn haproxy_unmodelled_constructs_are_unknown() {
    let regex = HAPROXY.replace(
        "use_backend api if is_api",
        "use_backend api if { path_reg ^/v[0-9]+/ }",
    );
    let gs = configs::haproxy("edge", &[("h.cfg".into(), regex)], &resolve).unwrap();
    assert!(gs[0].unread.is_empty());
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
    assert_eq!(verdict(&gs, "api", "/v1/rules"), "unknown");

    let map = HAPROXY.replace(
        "use_backend api if is_api",
        "use_backend %[path,map_beg(/etc/haproxy/routes.map)]",
    );
    let gs = configs::haproxy("edge", &[("h.cfg".into(), map)], &resolve).unwrap();
    assert!(!gs[0].unread.is_empty());
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");

    let lua = HAPROXY.replace("  maxconn 256\n", "  lua-load /etc/haproxy/route.lua\n");
    let gs = configs::haproxy("edge", &[("h.cfg".into(), lua)], &resolve).unwrap();
    assert!(
        gs[0].unread.iter().any(|u| u.contains("Lua")),
        "{:?}",
        gs[0].unread
    );

    let tcp = "frontend raw\n  bind :443\n  mode tcp\n  default_backend api\nbackend api\n  mode tcp\n  server a api:8443\n";
    let gs = configs::haproxy("edge", &[("h.cfg".into(), tcp.into())], &resolve).unwrap();
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "public");
    assert!(
        configs::haproxy(
            "edge",
            &[("h.cfg".into(), "server x api:1\n".into())],
            &resolve
        )
        .is_err()
    );
}

const ENVOY: &str = r#"static_resources:
  listeners:
  - name: main
    address:
      socket_address: { address: 0.0.0.0, port_value: 8080 }
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: ingress
          route_config:
            name: local
            virtual_hosts:
            - name: all
              domains: ["*"]
              routes:
              - match: { prefix: "/admin" }
                direct_response: { status: 403 }
              - match: { prefix: "/api/" }
                route: { cluster: api }
              - match: { prefix: "/" }
                route: { cluster: web }
          http_filters:
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
  - name: api
    type: STRICT_DNS
    load_assignment:
      cluster_name: api
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: api, port_value: 8000 }
  - name: web
    type: LOGICAL_DNS
    load_assignment:
      cluster_name: web
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: web, port_value: 3000 }
"#;

/// Pins Envoy: routes are a first match, so `/api/` carries the API's routes though
/// `/` follows, a direct response is not forwarded, and a path no route to the
/// service can match is internal.
#[test]
fn envoy_routes_in_order() {
    let gs = configs::envoy("edge", "envoy/envoy.yaml", ENVOY, &resolve).unwrap();
    assert!(gs[0].unread.is_empty(), "{:?}", gs[0].unread);
    assert_eq!(verdict(&gs, "api", "/api/users"), "public");
    assert_eq!(verdict(&gs, "web", "/about"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");
    assert_ne!(verdict(&gs, "web", "/admin/users"), "public");
}

/// Pins what Envoy reads as unknown: a `safe_regex` match may carry anything, RDS
/// and a Lua filter leave the configuration not all read.
#[test]
fn envoy_unmodelled_constructs_are_unknown() {
    let regex = ENVOY.replace(
        r#"match: { prefix: "/api/" }"#,
        r#"match: { safe_regex: { regex: "^/v[0-9]+/.*" } }"#,
    );
    let gs = configs::envoy("edge", "e.yaml", &regex, &resolve).unwrap();
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
    let lua = ENVOY.replace(
        "          - name: envoy.filters.http.router\n",
        "          - name: envoy.filters.http.lua\n          - name: envoy.filters.http.router\n",
    );
    let gs = configs::envoy("edge", "e.yaml", &lua, &resolve).unwrap();
    assert!(!gs[0].unread.is_empty());
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
    let rds = ENVOY.replace(
        "          route_config:\n            name: local\n",
        "          rds:\n            route_config_name: local\n          route_config:\n            name: local\n",
    );
    let gs = configs::envoy("edge", "e.yaml", &rds, &resolve).unwrap();
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
}

const KONG: &str = "_format_version: \"3.0\"\nservices:\n- name: api\n  url: http://api:8000\n  routes:\n  - name: api-route\n    paths: [/api]\n    strip_path: false\n  plugins:\n  - name: key-auth\n- name: web\n  url: http://web:3000\n  routes:\n  - name: site\n    paths: [/site]\n";

/// Pins Kong (DB-less): a route's path prefix carries the service's routes (a
/// stripped prefix makes every route of the service reachable under it), plugins
/// that cannot move a request change nothing, and a path no route can match is
/// internal.
#[test]
fn kong_routes_by_path() {
    let g = configs::kong("edge", "kong/kong.yml", KONG, &resolve).unwrap();
    assert!(g.unread.is_empty(), "{:?}", g.unread);
    let gs = [g];
    assert_eq!(verdict(&gs, "api", "/api/users"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");
    // `/site` is stripped: any route of web is reachable under it.
    assert_eq!(verdict(&gs, "web", "/about"), "public");
}

/// Pins what Kong reads as unknown: a regex path and a method condition may carry
/// anything; a plugin that may rewrite the path is not read.
#[test]
fn kong_unmodelled_constructs_are_unknown() {
    let regex = KONG.replace("paths: [/api]", "paths: [\"~/v[0-9]+/\"]");
    let gs = [configs::kong("edge", "k.yml", &regex, &resolve).unwrap()];
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
    let methods = KONG.replace(
        "    strip_path: false\n",
        "    strip_path: false\n    methods: [GET]\n",
    );
    let gs = [configs::kong("edge", "k.yml", &methods, &resolve).unwrap()];
    assert_eq!(verdict(&gs, "api", "/api/users"), "unknown");
    let transform = KONG.replace("name: key-auth", "name: request-transformer");
    let g = configs::kong("edge", "k.yml", &transform, &resolve).unwrap();
    assert!(
        g.unread.iter().any(|u| u.contains("request-transformer")),
        "{:?}",
        g.unread
    );
}

/// The httpd container of a repository at `root` whose `apache/` directory is
/// mounted as `/usr/local/apache2/conf`.
fn httpd_of(root: &Path, conf: &str, vhosts: &str) -> Option<Gateway> {
    write(root, "apache/httpd.conf", conf);
    write(root, "apache/extra/vhosts.conf", vhosts);
    let fs = Fs::read(
        root,
        &[(
            Some("apache".to_string()),
            "/usr/local/apache2/conf".to_string(),
        )],
        &[],
    );
    configs::httpd(
        "edge",
        &fs,
        "/usr/local/apache2/conf/httpd.conf",
        "/usr/local/apache2",
        &resolve,
    )
    .unwrap()
}

const HTTPD: &str = "ServerRoot \"/usr/local/apache2\"\nListen 80\nLoadModule proxy_module modules/mod_proxy.so\nLoadModule proxy_http_module modules/mod_proxy_http.so\nServerName localhost\nInclude conf/extra/vhosts.conf\n";

/// Pins httpd: `ProxyPass` in a virtual host carries the routes under its prefix
/// (whole segments), `ProxyPass ... !` is not proxied, the include is followed, and
/// a path no rule to the service can match is internal.
#[test]
fn httpd_proxy_pass_routes_each_path() {
    let dir = tempfile::tempdir().unwrap();
    let g = httpd_of(
        dir.path(),
        HTTPD,
        "<VirtualHost *:80>\n  ServerName app.example.com\n  ProxyPreserveHost On\n  ProxyPass /api/private !\n  ProxyPass /api http://api:8000/api\n  ProxyPassReverse /api http://api:8000/api\n  ProxyPass / http://web:3000/\n</VirtualHost>\n",
    )
    .unwrap();
    assert!(g.unread.is_empty(), "{:?}", g.unread);
    assert_eq!(g.files, ["apache/httpd.conf", "apache/extra/vhosts.conf"]);
    let gs = [g];
    assert_eq!(verdict(&gs, "api", "/api/users/{id}"), "public");
    assert_eq!(verdict(&gs, "web", "/about"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");
    // `/apiary` is not under `/api` as httpd matches segments.
    assert_ne!(verdict(&gs, "api", "/apiary"), "public");
    assert_ne!(verdict(&gs, "api", "/api/private/x"), "public");
}

/// Pins what httpd reads as unknown: a `ProxyPassMatch` and a `RewriteRule ... [P]`
/// may carry anything; a `<Location>` that denies all is not forwarded; and with no
/// main configuration from the repository the gateway is not read at all.
#[test]
fn httpd_unmodelled_constructs_are_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let g = httpd_of(
        dir.path(),
        HTTPD,
        "<VirtualHost *:80>\n  ProxyPassMatch ^/v[0-9]+/(.*)$ http://api:8000/$1\n</VirtualHost>\n",
    )
    .unwrap();
    assert_eq!(verdict(&[g], "api", "/internal/jobs"), "unknown");
    let g = httpd_of(
        dir.path(),
        HTTPD,
        "<VirtualHost *:80>\n  RewriteEngine On\n  RewriteRule ^/old/(.*)$ http://api:8000/new/$1 [P,L]\n</VirtualHost>\n",
    )
    .unwrap();
    assert_eq!(verdict(&[g], "api", "/internal/jobs"), "unknown");
    let g = httpd_of(
        dir.path(),
        HTTPD,
        "<VirtualHost *:80>\n  ProxyPass / http://api:8000/\n  <Location /internal>\n    Require all denied\n  </Location>\n</VirtualHost>\n",
    )
    .unwrap();
    let gs = [g];
    assert_ne!(verdict(&gs, "api", "/internal/jobs"), "public");
    assert_eq!(verdict(&gs, "api", "/v1/rules"), "public");
    let g = httpd_of(dir.path(), "Listen 80\nMyDirective on\n", "");
    assert!(!g.unwrap().unread.is_empty());

    let fs = Fs::read(
        dir.path(),
        &[(
            Some("apache/extra/vhosts.conf".to_string()),
            "/usr/local/apache2/conf/extra/vhosts.conf".to_string(),
        )],
        &[],
    );
    assert!(
        configs::httpd(
            "edge",
            &fs,
            "/usr/local/apache2/conf/httpd.conf",
            "/usr/local/apache2",
            &resolve
        )
        .unwrap()
        .is_none()
    );
}

/// Pins Traefik's file provider: its routers are read with the labels' rule parser,
/// a `stripPrefix` of the rule's own prefix is followed, and a router with a regular
/// expression may carry anything.
#[test]
fn traefik_file_provider_routers_are_read() {
    let yaml = "http:\n  routers:\n    api:\n      rule: \"Host(`app.example.com`) && PathPrefix(`/api`)\"\n      service: api\n  services:\n    api:\n      loadBalancer:\n        servers:\n          - url: \"http://api:8000\"\n";
    let (rules, unread) =
        configs::traefik_file(&[("dynamic.yml".into(), yaml.into())], &resolve).unwrap();
    assert!(unread.is_empty(), "{unread:?}");
    let gs = [Gateway::of_rules(
        "edge",
        vec!["dynamic.yml".into()],
        "router",
        rules,
        unread,
    )];
    assert_eq!(verdict(&gs, "api", "/api/users"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");

    let toml = "[http.routers.api]\nrule = \"PathRegexp(`^/v[0-9]+`)\"\nservice = \"api\"\n[http.services.api.loadBalancer]\n[[http.services.api.loadBalancer.servers]]\nurl = \"http://api:8000\"\n";
    let (rules, unread) =
        configs::traefik_file(&[("dynamic.toml".into(), toml.into())], &resolve).unwrap();
    let gs = [Gateway::of_rules("edge", vec![], "router", rules, unread)];
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "unknown");
    let (_, unread) = configs::traefik_file(
        &[("d.yml".into(), "http:\n  routers: {{ .Routers }}\n".into())],
        &resolve,
    )
    .unwrap();
    assert!(!unread.is_empty());
}

/// Pins the Caddy snippet: `import` of a snippet defined in the Caddyfile is its
/// directives in place, so what it proxies is read and nothing else is unknown.
#[test]
fn a_caddy_snippet_is_read_where_it_is_imported() {
    let text = "(api) {\n\treverse_proxy /v1/* api:8000\n}\n\n:80 {\n\timport api\n}\n";
    let g =
        drift_mine::proxies::caddy("edge", &[("Caddyfile".into(), text.into())], &resolve).unwrap();
    assert!(g.unread.is_empty(), "{:?}", g.unread);
    let gs = [g];
    assert_eq!(verdict(&gs, "api", "/v1/rules"), "public");
    assert_eq!(verdict(&gs, "api", "/internal/jobs"), "internal");
    // A snippet that imports itself costs a bounded amount of work.
    let looped = "(a) {\n\timport a\n\timport a\n}\n:80 {\n\timport a\n}\n";
    let g = drift_mine::proxies::caddy("edge", &[("Caddyfile".into(), looped.into())], &resolve)
        .unwrap();
    assert!(!g.unread.is_empty());
}

/// Pins the nginx anchored-prefix regex: `location ~ ^/internal/` is evaluated, so
/// it takes its paths before the `/` prefix and nothing else of the other service is
/// called a regular expression Drift does not evaluate.
#[test]
fn an_anchored_prefix_regex_location_is_evaluated() {
    let conf = "server {\n  location / { proxy_pass http://api:8000; }\n  location ~ ^/internal/ { proxy_pass http://jobs:9000; }\n}\n";
    let g = Gateway::read("edge", &[("nginx.conf".into(), conf.into())], &resolve).unwrap();
    assert!(g.unread.is_empty(), "{:?}", g.unread);
    assert_eq!(
        g.carries("jobs", &route("/internal/run")),
        Some("~ ^/internal/")
    );
    assert_eq!(g.carries("api", &route("/internal/run")), None);
    assert_eq!(g.carries("api", &route("/v1/rules")), Some("/"));
    // Before, every route of `jobs` was "a regular expression, which Drift does not
    // evaluate"; a path the prefix cannot match is now internal.
    assert_eq!(g.may_carry("jobs", &route("/v1/rules")), None);
    // Any other regular expression is left as before.
    let conf = conf.replace("^/internal/", "^/(internal|jobs)/");
    let g = Gateway::read("edge", &[("nginx.conf".into(), conf)], &resolve).unwrap();
    assert!(g.may_carry("jobs", &route("/v1/rules")).is_some());
}
