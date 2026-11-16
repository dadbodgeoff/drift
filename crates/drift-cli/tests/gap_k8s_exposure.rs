//! Exposure from plain Kubernetes manifests (audit gap 4): an Ingress, a Gateway API
//! route, an OpenShift Route or a Service open outside the cluster reaches a
//! workload through its Service's selector, the workload's container runs code of
//! the repository (an image the repository builds, or a person's tie), and each
//! route of that code is then internet-facing, internal, or unknown with a reason.
//!
//! Before, any manifest in the repository made every route unknown: Drift
//! recognised Kubernetes and did not read it as a deployment.

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

fn run(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> (i32, String, String) {
    let mut cmd = Command::new(&*BIN);
    cmd.arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("GITHUB_STEP_SUMMARY");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let out = cmd.output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

fn drift(root: &Path, args: &[&str]) -> String {
    let (code, out, err) = run(root, args, &[]);
    assert_eq!(code, 0, "{out}{err}");
    out
}

fn inventory(root: &Path) -> Value {
    serde_json::from_str(&drift(root, &["security", "--json"])).unwrap()
}

/// The row of the route `route`: (exposure, boundary).
fn row(inv: &Value, route: &str) -> (String, String) {
    let e = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == route)
        .unwrap_or_else(|| panic!("no row {route}: {inv:#}"));
    (
        e["exposure"].as_str().unwrap().to_string(),
        e["boundary"].as_str().unwrap_or_default().to_string(),
    )
}

const UNGUARDED: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

/// A Next.js application in `apps/<name>` with a route at each of `routes`.
fn next_app(root: &Path, name: &str, routes: &[&str]) {
    write(
        root,
        "package.json",
        "{ \"name\": \"root\", \"private\": true, \"workspaces\": [\"apps/*\"] }",
    );
    write(
        root,
        &format!("apps/{name}/package.json"),
        &format!("{{ \"name\": \"{name}\", \"dependencies\": {{ \"next\": \"15.0.0\" }} }}"),
    );
    for r in routes {
        write(root, &format!("apps/{name}/app{r}/route.ts"), UNGUARDED);
    }
}

/// A Deployment and its Service in the namespace `ns`, as most charts render them:
/// a named container port, the Service's target port by that name.
fn workload(name: &str, ns: &str, image: &str) -> String {
    let ns_line = if ns.is_empty() {
        String::new()
    } else {
        format!("  namespace: {ns}\n")
    };
    format!(
        "apiVersion: apps/v1
kind: Deployment
metadata:
  name: {name}
{ns_line}  labels:
    app.kubernetes.io/name: {name}
spec:
  replicas: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: {name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {name}
    spec:
      containers:
        - name: {name}
          image: {image}
          command: [\"next\", \"start\"]
          ports:
            - name: http
              containerPort: 3000
          readinessProbe:
            httpGet: {{path: /api/health, port: http}}
---
apiVersion: v1
kind: Service
metadata:
  name: {name}
{ns_line}spec:
  selector:
    app.kubernetes.io/name: {name}
  ports:
    - name: http
      port: 80
      targetPort: http
"
    )
}

/// An ingress-nginx Ingress with the annotations such a file usually carries, none of
/// which changes where a path goes.
fn ingress(ns: &str, path: &str, service: &str) -> String {
    let ns_line = if ns.is_empty() {
        String::new()
    } else {
        format!("  namespace: {ns}\n")
    };
    format!(
        "apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: front
{ns_line}  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    nginx.ingress.kubernetes.io/ssl-redirect: \"true\"
    nginx.ingress.kubernetes.io/proxy-body-size: 8m
spec:
  ingressClassName: nginx
  tls:
    - hosts: [shop.example.com]
      secretName: shop-tls
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: {path}
            pathType: Prefix
            backend:
              service:
                name: {service}
                port:
                  number: 80
"
    )
}

/// Skaffold builds `ghcr.io/acme/web` from `apps/web`: the image is the repository's.
const SKAFFOLD: &str = "apiVersion: skaffold/v4beta6
kind: Config
build:
  artifacts:
    - image: ghcr.io/acme/web
      context: apps/web
manifests:
  rawYaml:
    - k8s/*.yaml
";

/// Pins: an ingress-nginx path decides route by route. `/api` (Prefix) reaches the
/// workload that runs `apps/web` (its image is a Skaffold artifact of that
/// directory): `/api/orders` is internet-facing and names the Ingress, the Service
/// and the Deployment with file and line; `/admin/stats`, which no rule takes, is
/// internal. Before, both read unknown because a manifest was there.
#[test]
fn an_ingress_path_decides_each_route_of_the_workload_it_reaches() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", &["/api/orders", "/admin/stats"]);
    write(r, "skaffold.yaml", SKAFFOLD);
    write(
        r,
        "k8s/web.yaml",
        &workload("web", "shop", "ghcr.io/acme/web:1.4.2"),
    );
    write(r, "k8s/ingress.yaml", &ingress("shop", "/api", "web"));
    let inv = inventory(r);
    let (x, why) = row(&inv, "/api/orders");
    assert_eq!(x, "public", "{why}");
    assert!(
        why.contains("Ingress front (k8s/ingress.yaml:4) routes shop.example.com/api (Prefix) to Service web:80, which selects Deployment shop/web (k8s/web.yaml:4), container web"),
        "{why}"
    );
    assert!(
        why.contains(
            "image ghcr.io/acme/web:1.4.2 is built from apps/web by an artifact of skaffold.yaml:1"
        ),
        "{why}"
    );
    let (x, why) = row(&inv, "/admin/stats");
    assert_eq!(x, "internal", "{why}");
    assert!(
        why.contains("nothing in the Kubernetes manifests routes /admin/stats to it from outside"),
        "{why}"
    );
    // The manifests are descriptions read, not ones left unread.
    let unread = inv["boundaries"]["unread"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(unread.is_empty(), "{unread:#?}");
    let text = drift(r, &["security"]);
    assert!(text.contains("(from Kubernetes manifests)"), "{text}");
}

/// Pins: the same workload built by a compose service (`image` and `build`), and a
/// Service of type LoadBalancer: every route is internet-facing, and the compose
/// file's own word (no published ports: internal) is named beside it.
#[test]
fn a_load_balancer_opens_every_route_and_the_compose_file_is_named_beside_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", &["/api/orders", "/admin/stats"]);
    write(
        r,
        "docker-compose.yml",
        "services:\n  web:\n    build: ./apps/web\n    image: ghcr.io/acme/web:dev\n",
    );
    write(
        r,
        "k8s/web.yaml",
        &workload("web", "shop", "ghcr.io/acme/web:1.4.2"),
    );
    write(
        r,
        "k8s/edge.yaml",
        "apiVersion: v1\nkind: Service\nmetadata:\n  name: edge\n  namespace: shop\nspec:\n  type: LoadBalancer\n  selector:\n    app.kubernetes.io/name: web\n  ports:\n    - port: 443\n      targetPort: 3000\n",
    );
    let inv = inventory(r);
    for route in ["/api/orders", "/admin/stats"] {
        let (x, why) = row(&inv, route);
        assert_eq!(x, "public", "{why}");
        assert!(
            why.contains("internet-facing in k8s/web.yaml (Service edge (k8s/edge.yaml:4, type LoadBalancer), which selects Deployment shop/web (k8s/web.yaml:4), container web: every path (image ghcr.io/acme/web:1.4.2 is built from apps/web by compose service web in docker-compose.yml))"),
            "{why}"
        );
        assert!(
            why.contains("internal in the compose files (compose service web in docker-compose.yml publishes no ports)"),
            "{why}"
        );
    }
}

/// Pins kustomize: an overlay that only sets a namespace and a new image tag reads
/// as its base does; one that patches the Deployment makes its routes unknown,
/// naming the patch, and the patch file is not read as a workload of its own; a
/// name prefix touches every resource.
#[test]
fn a_kustomize_overlay_is_read_and_what_it_patches_is_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", &["/api/orders", "/admin/stats"]);
    write(r, "skaffold.yaml", SKAFFOLD);
    write(
        r,
        "deploy/base/web.yaml",
        &workload("web", "", "ghcr.io/acme/web:1.4.2"),
    );
    write(r, "deploy/base/ingress.yaml", &ingress("", "/api", "web"));
    write(
        r,
        "deploy/base/kustomization.yaml",
        "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - web.yaml\n  - ingress.yaml\n",
    );
    let overlay = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: shop\nresources:\n  - ../../base\nimages:\n  - name: ghcr.io/acme/web\n    newTag: 1.5.0\nlabels:\n  - pairs: {env: prod}\n";
    write(r, "deploy/overlays/prod/kustomization.yaml", overlay);
    let inv = inventory(r);
    assert_eq!(
        row(&inv, "/api/orders").0,
        "public",
        "{:?}",
        row(&inv, "/api/orders")
    );
    assert_eq!(
        row(&inv, "/admin/stats").0,
        "internal",
        "{:?}",
        row(&inv, "/admin/stats")
    );

    write(
        r,
        "deploy/overlays/prod/kustomization.yaml",
        &format!(
            "{overlay}patches:\n  - path: resources.yaml\n    target:\n      kind: Deployment\n      name: web\n"
        ),
    );
    write(
        r,
        "deploy/overlays/prod/resources.yaml",
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  template:\n    spec:\n      containers:\n        - name: web\n          resources:\n            limits: {memory: 512Mi}\n",
    );
    let inv = inventory(r);
    for route in ["/api/orders", "/admin/stats"] {
        let (x, why) = row(&inv, route);
        assert_eq!(x, "unknown", "{why}");
        assert!(
            why.contains("deploy/overlays/prod/kustomization.yaml patches it (resources.yaml)"),
            "{why}"
        );
    }
    let warnings = inv["boundaries"]["warnings"].to_string();
    assert!(!warnings.contains("ties to no code"), "{warnings}");

    write(
        r,
        "deploy/overlays/prod/kustomization.yaml",
        &format!("{overlay}namePrefix: prod-\n"),
    );
    let (x, why) = row(&inventory(r), "/admin/stats");
    assert_eq!(x, "unknown", "{why}");
    assert!(why.contains("has `namePrefix`"), "{why}");
}

/// Pins: a Service whose selector matches nothing reaches no workload (the routes
/// are internal, and the selector is said); a headless Service opens nothing; and a
/// Service of no namespace selecting a workload of a named one is not proved to be
/// in it: what the Ingress takes is unknown, what it cannot take stays internal.
#[test]
fn a_selector_that_matches_nothing_a_headless_service_and_two_namespaces() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", &["/api/orders", "/admin/stats"]);
    write(r, "skaffold.yaml", SKAFFOLD);
    let mut web = workload("web", "shop", "ghcr.io/acme/web:1.4.2");
    web = web.replacen(
        "spec:\n  selector:\n    app.kubernetes.io/name: web\n  ports:",
        "spec:\n  selector:\n    app.kubernetes.io/name: website\n  ports:",
        1,
    );
    web.push_str("---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web-headless\n  namespace: shop\nspec:\n  clusterIP: None\n  selector:\n    app.kubernetes.io/name: web\n  ports:\n    - port: 3000\n");
    write(r, "k8s/web.yaml", &web);
    write(r, "k8s/ingress.yaml", &ingress("shop", "/api", "web"));
    let inv = inventory(r);
    assert_eq!(
        row(&inv, "/api/orders").0,
        "internal",
        "{:?}",
        row(&inv, "/api/orders")
    );
    let warnings = inv["boundaries"]["warnings"].to_string();
    assert!(
        warnings.contains("Service shop/web (k8s/web.yaml:31) is reached from outside and its selector matches no workload of the manifests"),
        "{warnings}"
    );

    // The Service and the Ingress name no namespace; the Deployment names one.
    let svc = workload("web", "", "x")
        .split("---\n")
        .nth(1)
        .unwrap()
        .to_string();
    let deploy = workload("web", "shop", "ghcr.io/acme/web:1.4.2")
        .split("---\n")
        .next()
        .unwrap()
        .to_string();
    write(r, "k8s/web.yaml", &format!("{deploy}---\n{svc}"));
    write(r, "k8s/ingress.yaml", &ingress("", "/api", "web"));
    let inv = inventory(r);
    let (x, why) = row(&inv, "/api/orders");
    assert_eq!(x, "unknown", "{why}");
    assert!(
        why.contains("whether they are applied to one namespace is not in the manifests"),
        "{why}"
    );
    assert_eq!(
        row(&inv, "/admin/stats").0,
        "internal",
        "{:?}",
        row(&inv, "/admin/stats")
    );
}

/// Pins: a Gateway API `HTTPRoute` decides by its path match, for a workload a person
/// tied to its code (`security.kubernetes`: the image is built elsewhere); a workload
/// reached from outside that runs no code Drift can tie keeps every route from being
/// internal; and `drift setup` asks which workload runs code it cannot tie.
#[test]
fn a_gateway_route_a_persons_tie_and_the_setup_question() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "api", &["/v1/items", "/internal/sync"]);
    write(
        r,
        "k8s/api.yaml",
        &workload("api", "shop", "registry.example.com/acme/api:7"),
    );
    write(
        r,
        "k8s/route.yaml",
        "apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: api\n  namespace: shop\nspec:\n  parentRefs:\n    - name: public\n      namespace: gateway\n  hostnames: [api.example.com]\n  rules:\n    - matches:\n        - path: {type: PathPrefix, value: /v1}\n      backendRefs:\n        - name: api\n          port: 80\n",
    );
    // Untied: unknown, and a question.
    let inv = inventory(r);
    assert_eq!(row(&inv, "/v1/items").0, "unknown");
    let (code, out, err) = run(r, &["setup", "--json"], &[]);
    assert_eq!(code, 0, "{out}{err}");
    let listing: Value = serde_json::from_str(&out).unwrap();
    let q = listing["questions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["kind"] == "kubernetes")
        .unwrap_or_else(|| panic!("{listing:#}"))
        .clone();
    assert_eq!(q["question"], "Which workload runs api?");
    assert_eq!(
        q["choices"][0]["label"],
        "`shop/Deployment/api` (registry.example.com/acme/api:7)"
    );
    assert_eq!(
        q["choices"][0]["writes"],
        "- {workload: \"shop/Deployment/api\", code: \"apps/api\"}"
    );
    assert_eq!(q["choices"][0]["needs_person"], true);
    let id = q["id"].as_str().unwrap().to_string();
    let (code, out, err) = run(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=runs-1"),
        ],
        &[
            ("DRIFT_SETUP_PERSON", "1"),
            ("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1"),
        ],
    );
    assert_eq!(code, 0, "{out}{err}");
    let config = std::fs::read_to_string(r.join(".drift/config.yaml")).unwrap();
    assert!(config.contains("kubernetes:"), "{config}");

    let inv = inventory(r);
    let (x, why) = row(&inv, "/v1/items");
    assert_eq!(x, "public", "{why}");
    assert!(
        why.contains("HTTPRoute api (k8s/route.yaml:4) routes api.example.com/v1 to Service api:80, which selects Deployment shop/api (k8s/api.yaml:4), container api (tied to apps/api by .drift/config.yaml)"),
        "{why}"
    );
    assert_eq!(
        row(&inv, "/internal/sync").0,
        "internal",
        "{:?}",
        row(&inv, "/internal/sync")
    );

    // A dashboard open to the outside on a load balancer, built elsewhere.
    write(
        r,
        "k8s/grafana.yaml",
        &workload("grafana", "monitoring", "grafana/grafana:11.2.0").replace(
            "spec:\n  selector:\n    app.kubernetes.io/name: grafana\n  ports:",
            "spec:\n  type: LoadBalancer\n  selector:\n    app.kubernetes.io/name: grafana\n  ports:",
        ),
    );
    let (x, why) = row(&inventory(r), "/internal/sync");
    assert_eq!(x, "unknown", "{why}");
    assert!(
        why.contains("Deployment monitoring/grafana (k8s/grafana.yaml:4) is reached from outside and runs grafana/grafana:11.2.0, which Drift ties to no code of the repository"),
        "{why}"
    );
}

/// Pins what stops an internal verdict, and what also stops an internet-facing one:
/// an ingress-nginx `rewrite-target` changes the path the application sees, so the
/// rule proves nothing and may carry anything; an object of a kind Drift does not
/// read (an Istio `VirtualService`) may route to any workload; a Helm chart's
/// templates are not rendered and say so; a manifest that does not parse is named.
#[test]
fn what_drift_does_not_read_keeps_routes_from_being_decided() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "web", &["/api/orders", "/admin/stats"]);
    write(r, "skaffold.yaml", SKAFFOLD);
    write(
        r,
        "k8s/web.yaml",
        &workload("web", "shop", "ghcr.io/acme/web:1.4.2"),
    );
    write(
        r,
        "k8s/ingress.yaml",
        &ingress("shop", "/api", "web").replace(
            "    nginx.ingress.kubernetes.io/proxy-body-size: 8m\n",
            "    nginx.ingress.kubernetes.io/proxy-body-size: 8m\n    nginx.ingress.kubernetes.io/rewrite-target: /$2\n",
        ),
    );
    let inv = inventory(r);
    for route in ["/api/orders", "/admin/stats"] {
        let (x, why) = row(&inv, route);
        assert_eq!(x, "unknown", "{why}");
        assert!(
            why.contains("its annotation nginx.ingress.kubernetes.io/rewrite-target changes the path or the backend"),
            "{why}"
        );
    }

    write(r, "k8s/ingress.yaml", &ingress("shop", "/api", "web"));
    write(
        r,
        "k8s/mesh.yaml",
        "apiVersion: networking.istio.io/v1\nkind: VirtualService\nmetadata:\n  name: web\n  namespace: shop\nspec:\n  hosts: [web.example.com]\n  http:\n    - route:\n        - destination: {host: web}\n",
    );
    let inv = inventory(r);
    assert_eq!(row(&inv, "/api/orders").0, "public");
    let (x, why) = row(&inv, "/admin/stats");
    assert_eq!(x, "unknown", "{why}");
    assert!(
        why.contains("VirtualService shop/web (k8s/mesh.yaml:4) is a VirtualService of networking.istio.io/v1, which Drift does not read"),
        "{why}"
    );

    std::fs::remove_file(r.join("k8s/mesh.yaml")).unwrap();
    write(
        r,
        "chart/Chart.yaml",
        "apiVersion: v2\nname: web\nversion: 0.1.0\n",
    );
    write(
        r,
        "chart/templates/deployment.yaml",
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\n",
    );
    let (x, why) = row(&inventory(r), "/admin/stats");
    assert_eq!(x, "unknown", "{why}");
    assert!(why.contains("Helm (chart/Chart.yaml"), "{why}");

    std::fs::remove_dir_all(r.join("chart")).unwrap();
    write(
        r,
        "k8s/broken.yaml",
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: x\ndata: [unclosed\n",
    );
    let inv = inventory(r);
    assert_eq!(row(&inv, "/admin/stats").0, "unknown");
    let warnings = inv["boundaries"]["warnings"].to_string();
    assert!(
        warnings.contains("k8s/broken.yaml: not read as a Kubernetes manifest (the document at line 1 is not parsed"),
        "{warnings}"
    );
}

/// Pins: the security baseline does not move with exposure. Its keys name a route by
/// its handler, method and path, never by where it is reachable from, so a route
/// that read unknown and now reads internet-facing (a person tied its workload)
/// holds the same findings, and `drift check` against the older baseline passes.
#[test]
fn a_new_reading_of_exposure_fails_no_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r, "api", &["/v1/items"]);
    write(r, ".gitignore", ".drift/cache/\n");
    write(
        r,
        "k8s/api.yaml",
        &workload("api", "shop", "registry.example.com/acme/api:7"),
    );
    write(r, "k8s/ingress.yaml", &ingress("shop", "/v1", "api"));
    let _ = run(r, &["init"], &[]);
    assert_eq!(row(&inventory(r), "/v1/items").0, "unknown");
    let (code, out, err) = run(r, &["security", "--write-baseline"], &[]);
    assert_eq!(code, 0, "{out}{err}");
    let before = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();

    write(
        r,
        ".drift/config.yaml",
        "security:\n  kubernetes:\n    - {workload: shop/Deployment/api, code: apps/api}\n",
    );
    assert_eq!(row(&inventory(r), "/v1/items").0, "public");
    let (code, out, err) = run(r, &["check"], &[]);
    assert_eq!(code, 0, "{out}{err}");
    let (code, out, err) = run(r, &["security", "--write-baseline"], &[]);
    assert_eq!(code, 0, "{out}{err}");
    let after = std::fs::read_to_string(r.join(".drift/security.lock")).unwrap();
    assert_eq!(before, after);
}
