//! What forwards in the repository's Terraform, beyond an AWS load balancer's listener
//! rules, read for the routes of code a person tied to a target
//! (`security.terraform`): per resource family, a route a forward that is read
//! carries is internet-facing, a route nothing forwards is internal only when
//! everything was read, and an expression the files do not settle makes routes
//! unknown with the expression named.

use std::path::Path;

use drift_mine::gateway::Route;
use drift_mine::policy::TerraformTie;
use drift_mine::security::Exposure;
use drift_mine::terraform::Terraform;

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// A tie of the code `services/api` to `<kind>.<name>` of the module `infra`.
fn tie(kind: &str, name: &str) -> TerraformTie {
    TerraformTie {
        module: "infra".into(),
        group: Some(name.into()),
        kind: (kind != "aws_lb_target_group").then(|| kind.to_string()),
        code: "services/api".into(),
    }
}

/// The Terraform `files` (path, text), read with `extra` files beside them (a
/// `.tfvars`), and what `tie` makes of each `(method, route)`.
fn verdicts(
    files: &[(&str, &str)],
    extra: &[(&str, &str)],
    tie: &TerraformTie,
    routes: &[(&str, &str)],
) -> Vec<(Exposure, String)> {
    let dir = tempfile::tempdir().unwrap();
    for (p, t) in files.iter().chain(extra) {
        write(dir.path(), p, t);
    }
    let names: Vec<String> = files.iter().map(|(p, _)| p.to_string()).collect();
    let tf = Terraform::read(dir.path(), &names);
    let tied = tf.tied(tie).unwrap_or_else(|e| panic!("{e}"));
    routes
        .iter()
        .map(|(method, route)| tied.verdict(&Route::parse(route).unwrap(), route, Some(method)))
        .collect()
}

fn one(
    files: &[(&str, &str)],
    tie: &TerraformTie,
    method: &str,
    route: &str,
) -> (Exposure, String) {
    verdicts(files, &[], tie, &[(method, route)]).remove(0)
}

const GROUP: &str = "resource \"aws_lb_target_group\" \"api\" {\n  port = 8000\n}\n";

fn listener(lb: &str, default_action: &str) -> String {
    format!(
        "{GROUP}\n{lb}\nresource \"aws_lb_listener\" \"https\" {{\n  load_balancer_arn = aws_lb.main.arn\n  port              = 443\n  default_action {{\n{default_action}\n  }}\n}}\n"
    )
}

const FORWARD: &str =
    "    type             = \"forward\"\n    target_group_arn = aws_lb_target_group.api.arn";
const FIXED: &str = "    type = \"fixed-response\"\n    fixed_response {\n      content_type = \"text/plain\"\n      status_code  = \"404\"\n    }";

fn rule(listener_head: &str, patterns: &str) -> String {
    format!(
        "\nresource \"aws_lb_listener_rule\" \"api\" {{\n{listener_head}\n  listener_arn = aws_lb_listener.https.arn\n  action {{\n    type             = \"forward\"\n    target_group_arn = aws_lb_target_group.api.arn\n  }}\n  condition {{\n    path_pattern {{\n      values = {patterns}\n    }}\n  }}\n}}\n"
    )
}

/// A listener's default action forwards every path; one that answers by itself
/// forwards nothing, and a rule of an internal load balancer forwards from inside
/// only. Where `internal` is a variable, its default decides unless a `.tfvars` file
/// sets it again, and then the routes are unknown, the file named.
#[test]
fn aws_load_balancer_listeners_and_internal_balancers() {
    let t = tie("aws_lb_target_group", "api");
    let public_lb = "resource \"aws_lb\" \"main\" {\n  internal = false\n}\n";
    let (x, why) = one(
        &[("infra/main.tf", &listener(public_lb, FORWARD))],
        &t,
        "GET",
        "/anything",
    );
    assert_eq!(x, Exposure::Public, "{why}");
    assert!(why.contains("listener `https` (infra/main.tf:"), "{why}");
    assert!(why.contains("forwards every path"), "{why}");

    // Fixed response by default, one rule: what the rule does not carry is internal.
    let files = format!("{}{}", listener(public_lb, FIXED), rule("", "[\"/v1/*\"]"));
    let v = verdicts(
        &[("infra/main.tf", &files)],
        &[],
        &t,
        &[("GET", "/v1/items"), ("GET", "/health")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");

    // An internal load balancer: its listener and rules forward from inside only.
    let internal =
        |value: &str| format!("resource \"aws_lb\" \"main\" {{\n  internal = {value}\n}}\n");
    let files = format!(
        "{}{}",
        listener(&internal("true"), FORWARD),
        rule("", "[\"/v1/*\"]")
    );
    let (x, why) = one(&[("infra/main.tf", &files)], &t, "GET", "/v1/items");
    assert_eq!(x, Exposure::Internal, "{why}");
    assert!(
        why.contains("from inside only") && why.contains("`internal = true`"),
        "{why}"
    );

    // A CloudFront VPC origin that names it can send requests to it from outside.
    let fronted = format!(
        "{files}\nresource \"aws_cloudfront_vpc_origin\" \"edge\" {{\n  vpc_origin_endpoint_config {{\n    arn = aws_lb.main.arn\n  }}\n}}\n"
    );
    let (x, why) = one(&[("infra/main.tf", &fronted)], &t, "GET", "/v1/items");
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("aws_cloudfront_vpc_origin `edge`"), "{why}");

    // `internal = var.internal`: its default decides, unless something sets it again.
    let vars = "variable \"internal\" {\n  default = true\n}\n";
    let files = format!(
        "{}{}{vars}",
        listener(&internal("var.internal"), FORWARD),
        rule("", "[\"/v1/*\"]")
    );
    let tf = [("infra/main.tf", files.as_str())];
    assert_eq!(one(&tf, &t, "GET", "/v1/items").0, Exposure::Internal);
    let (x, why) = verdicts(
        &tf,
        &[("envs/prod.tfvars", "internal = false\n")],
        &t,
        &[("GET", "/v1/items")],
    )
    .remove(0);
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(
        why.contains("`var.internal` is set in envs/prod.tfvars"),
        "{why}"
    );
    let undeclared = format!(
        "{}{}",
        listener(&internal("var.internal"), FORWARD),
        rule("", "[\"/v1/*\"]")
    );
    let (x, why) = one(&[("infra/main.tf", &undeclared)], &t, "GET", "/v1/items");
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("`internal = var.internal`"), "{why}");
}

/// `for_each` over a map the files settle expands, each instance's patterns read;
/// over a variable with no default it stays unknown, the expression named.
#[test]
fn for_each_and_locals_expand_listener_rules() {
    let t = tie("aws_lb_target_group", "api");
    let lb = "resource \"aws_lb\" \"main\" {}\n";
    let locals = "locals {\n  prefix = \"/v1\"\n  paths = {\n    items = \"${local.prefix}/items*\"\n    users = \"${local.prefix}/users*\"\n  }\n}\n";
    let files = format!(
        "{}{locals}{}",
        listener(lb, FIXED),
        rule("  for_each = local.paths", "[each.value]")
    );
    let v = verdicts(
        &[("infra/main.tf", &files)],
        &[],
        &t,
        &[
            ("GET", "/v1/items/{id}"),
            ("GET", "/v1/users"),
            ("GET", "/v1/admin"),
        ],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Public, "{v:?}");
    assert_eq!(v[2].0, Exposure::Internal, "{v:?}");

    let files = format!(
        "{}{}",
        listener(lb, FIXED),
        rule("  for_each = var.paths", "[each.value]")
    );
    let (x, why) = one(&[("infra/main.tf", &files)], &t, "GET", "/v1/admin");
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("is not read (it has `for_each`)"), "{why}");
    assert!(why.contains("`for_each = var.paths`"), "{why}");
}

const LAMBDA: &str = "resource \"aws_lambda_function\" \"api\" {\n  function_name = \"api\"\n}\n";

fn rest_api(endpoint: &str, part: &str, authorization: &str) -> String {
    format!(
        "{LAMBDA}\nresource \"aws_api_gateway_rest_api\" \"main\" {{\n  name = \"main\"\n{endpoint}\n}}\n\nresource \"aws_api_gateway_resource\" \"users\" {{\n  rest_api_id = aws_api_gateway_rest_api.main.id\n  parent_id   = aws_api_gateway_rest_api.main.root_resource_id\n  path_part   = {part}\n}}\n\nresource \"aws_api_gateway_resource\" \"user\" {{\n  rest_api_id = aws_api_gateway_rest_api.main.id\n  parent_id   = aws_api_gateway_resource.users.id\n  path_part   = \"{{id}}\"\n}}\n\nresource \"aws_api_gateway_method\" \"get_user\" {{\n  rest_api_id   = aws_api_gateway_rest_api.main.id\n  resource_id   = aws_api_gateway_resource.user.id\n  http_method   = \"GET\"\n  authorization = \"{authorization}\"\n}}\n\nresource \"aws_api_gateway_integration\" \"get_user\" {{\n  rest_api_id             = aws_api_gateway_rest_api.main.id\n  resource_id             = aws_api_gateway_resource.user.id\n  http_method             = aws_api_gateway_method.get_user.http_method\n  integration_http_method = \"POST\"\n  type                    = \"AWS_PROXY\"\n  uri                     = aws_lambda_function.api.invoke_arn\n}}\n"
    )
}

/// A REST API: a method's path and verb carry what the function serves there, with
/// its authorization said as a fact and not counted as a guard; a private API
/// forwards from inside only; a path part the files do not settle is unknown.
#[test]
fn api_gateway_rest_methods() {
    let t = tie("aws_lambda_function", "api");
    let files = rest_api("", "\"users\"", "NONE");
    let v = verdicts(
        &[("infra/api.tf", &files)],
        &[],
        &t,
        &[
            ("GET", "/users/{user_id}"),
            ("POST", "/users/{user_id}"),
            ("GET", "/users"),
            ("GET", "/users/{id}/posts"),
        ],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert!(
        v[0].1.contains("API Gateway method `GET /users/{id}`")
            && v[0].1.contains("authorization `NONE`"),
        "{v:?}"
    );
    for (x, why) in &v[1..] {
        assert_eq!(*x, Exposure::Internal, "{why}");
        assert!(
            why.contains("nothing Drift reads in the repository's Terraform forwards"),
            "{why}"
        );
    }

    let (x, why) = one(
        &[("infra/api.tf", &rest_api("", "\"users\"", "CUSTOM"))],
        &t,
        "GET",
        "/users/{user_id}",
    );
    assert_eq!(x, Exposure::Public, "{why}");
    assert!(
        why.contains("authorization `CUSTOM`") && why.contains("does not count as a guard"),
        "{why}"
    );

    let private = "  endpoint_configuration {\n    types = [\"PRIVATE\"]\n  }";
    let (x, why) = one(
        &[("infra/api.tf", &rest_api(private, "\"users\"", "NONE"))],
        &t,
        "GET",
        "/users/{user_id}",
    );
    assert_eq!(x, Exposure::Internal, "{why}");
    assert!(
        why.contains("is private (endpoint type `PRIVATE`)"),
        "{why}"
    );

    let (x, why) = one(
        &[("infra/api.tf", &rest_api("", "var.part", "NONE"))],
        &t,
        "GET",
        "/admin",
    );
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("`path_part = var.part`"), "{why}");

    // A base path mapping puts a prefix before what the function sees.
    let mapped = format!(
        "{}\nresource \"aws_api_gateway_base_path_mapping\" \"v1\" {{\n  api_id    = aws_api_gateway_rest_api.main.id\n  base_path = \"v1\"\n}}\n",
        rest_api("", "\"users\"", "NONE")
    );
    let (x, why) = one(&[("infra/api.tf", &mapped)], &t, "GET", "/users/{user_id}");
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("puts `/v1` before the path"), "{why}");

    // `{proxy+}` at the root takes every path of one segment or more.
    let proxy = rest_api("", "\"{proxy+}\"", "NONE").replace(
        "resource_id   = aws_api_gateway_resource.user.id\n  http_method   = \"GET\"",
        "resource_id   = aws_api_gateway_resource.users.id\n  http_method   = \"ANY\"",
    ).replace(
        "resource_id             = aws_api_gateway_resource.user.id\n  http_method             = aws_api_gateway_method.get_user.http_method",
        "resource_id             = aws_api_gateway_resource.users.id\n  http_method             = \"ANY\"",
    );
    let v = verdicts(
        &[("infra/api.tf", &proxy)],
        &[],
        &t,
        &[("DELETE", "/a/b/{c}"), ("GET", "/")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");
}

fn http_api(stage: &str, route_key: &str) -> String {
    format!(
        "{LAMBDA}\nresource \"aws_apigatewayv2_api\" \"main\" {{\n  name          = \"main\"\n  protocol_type = \"HTTP\"\n}}\n\nresource \"aws_apigatewayv2_stage\" \"main\" {{\n  api_id      = aws_apigatewayv2_api.main.id\n  name        = \"{stage}\"\n  auto_deploy = true\n}}\n\nresource \"aws_apigatewayv2_integration\" \"api\" {{\n  api_id                 = aws_apigatewayv2_api.main.id\n  integration_type       = \"AWS_PROXY\"\n  integration_uri        = aws_lambda_function.api.invoke_arn\n  payload_format_version = \"2.0\"\n}}\n\nresource \"aws_apigatewayv2_route\" \"api\" {{\n  api_id             = aws_apigatewayv2_api.main.id\n  route_key          = \"{route_key}\"\n  target             = \"integrations/${{aws_apigatewayv2_integration.api.id}}\"\n  authorization_type = \"JWT\"\n}}\n"
    )
}

/// An HTTP API: a route key carries its method and path; `$default` carries every
/// request; a stage other than `$default` may come before the path the function
/// sees, so a route a path key carries is unknown, not internet-facing.
#[test]
fn api_gateway_http_routes() {
    let t = tie("aws_lambda_function", "api");
    let v = verdicts(
        &[("infra/api.tf", &http_api("$default", "GET /items/{id}"))],
        &[],
        &t,
        &[("GET", "/items/{item_id}"), ("GET", "/items")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert!(
        v[0].1.contains("authorization `JWT`") && v[0].1.contains("does not count as a guard"),
        "{v:?}"
    );
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");

    let (x, why) = one(
        &[("infra/api.tf", &http_api("prod", "GET /items/{id}"))],
        &t,
        "GET",
        "/items/{item_id}",
    );
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("its stage `prod`"), "{why}");

    let (x, why) = one(
        &[("infra/api.tf", &http_api("prod", "$default"))],
        &t,
        "PATCH",
        "/anything/{x}",
    );
    assert_eq!(x, Exposure::Public, "{why}");

    // An integration whose function is a variable may be the tied one.
    let var = http_api("$default", "GET /items/{id}")
        .replace("aws_lambda_function.api.invoke_arn", "var.function_arn")
        .replace(
            "route_key          = \"GET /items/{id}\"",
            "route_key          = \"GET /other\"",
        );
    let files = format!("{var}\nresource \"aws_lambda_function\" \"other\" {{}}\n");
    let (x, why) = one(&[("infra/api.tf", &files)], &t, "GET", "/health");
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(
        why.contains("`integration_uri = var.function_arn`"),
        "{why}"
    );
}

/// A Lambda function URL sends every request to its function.
#[test]
fn lambda_function_urls() {
    let t = tie("aws_lambda_function", "api");
    let files = format!(
        "{LAMBDA}\nresource \"aws_lambda_function_url\" \"api\" {{\n  function_name      = aws_lambda_function.api.function_name\n  authorization_type = \"NONE\"\n}}\n"
    );
    let (x, why) = one(&[("infra/fn.tf", &files)], &t, "POST", "/hooks/{id}");
    assert_eq!(x, Exposure::Public, "{why}");
    assert!(
        why.contains("Lambda function URL `api`") && why.contains("authorization `NONE`"),
        "{why}"
    );
    // Without one, nothing forwards to it.
    assert_eq!(
        one(&[("infra/fn.tf", LAMBDA)], &t, "POST", "/hooks/{id}").0,
        Exposure::Internal
    );
}

fn url_map(scheme: &str, backend: &str) -> String {
    format!(
        "resource \"google_compute_backend_service\" \"api\" {{\n  name = \"api\"\n{backend}\n}}\n\nresource \"google_compute_backend_service\" \"web\" {{\n  name = \"web\"\n}}\n\nresource \"google_compute_url_map\" \"main\" {{\n  name            = \"main\"\n  default_service = google_compute_backend_service.web.id\n\n  host_rule {{\n    hosts        = [\"example.com\"]\n    path_matcher = \"paths\"\n  }}\n\n  path_matcher {{\n    name            = \"paths\"\n    default_service = google_compute_backend_service.web.id\n\n    path_rule {{\n      paths   = [\"/api/*\"]\n      service = google_compute_backend_service.api.id\n    }}\n  }}\n}}\n\nresource \"google_compute_target_https_proxy\" \"main\" {{\n  url_map = google_compute_url_map.main.id\n}}\n\nresource \"google_compute_global_forwarding_rule\" \"main\" {{\n  target                = google_compute_target_https_proxy.main.id\n  load_balancing_scheme = \"{scheme}\"\n}}\n"
    )
}

/// A GCP URL map: a path rule carries what its backend service serves under its
/// patterns, from an external forwarding rule; an internal one forwards from inside
/// only. Through a serverless network endpoint group the Cloud Run service is the
/// target; its own ingress and invoker grants say whether it is reached directly.
#[test]
fn gcp_url_maps_and_cloud_run() {
    let t = TerraformTie {
        kind: Some("google_compute_backend_service".into()),
        ..tie("", "api")
    };
    let v = verdicts(
        &[("infra/lb.tf", &url_map("EXTERNAL_MANAGED", ""))],
        &[],
        &t,
        &[("GET", "/api/items/{id}"), ("GET", "/health")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert!(
        v[0].1.contains("path rule /api/* of path matcher `paths`"),
        "{v:?}"
    );
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");
    let (x, why) = one(
        &[("infra/lb.tf", &url_map("INTERNAL_MANAGED", ""))],
        &t,
        "GET",
        "/api/items",
    );
    assert_eq!(x, Exposure::Internal, "{why}");
    assert!(why.contains("from inside only"), "{why}");

    // The web service is the URL map's own default: a request for another host
    // (its `Host` is the client's to choose) reaches it whatever its path. The path
    // matcher's default is every path but what its path rule takes.
    let web = TerraformTie {
        kind: Some("google_compute_backend_service".into()),
        ..tie("", "web")
    };
    let v = verdicts(
        &[("infra/lb.tf", &url_map("EXTERNAL_MANAGED", ""))],
        &[],
        &web,
        &[("GET", "/"), ("GET", "/api/items")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Public, "{v:?}");
    let only_matcher = url_map("EXTERNAL_MANAGED", "").replace(
        "  default_service = google_compute_backend_service.web.id\n\n  host_rule",
        "  default_url_redirect {\n    https_redirect = true\n  }\n\n  host_rule",
    );
    let v = verdicts(
        &[("infra/lb.tf", &only_matcher)],
        &[],
        &web,
        &[("GET", "/"), ("GET", "/api/items")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");

    // Cloud Run behind the load balancer, reached from outside only through it.
    let run = |ingress: &str, invoker: &str| {
        format!(
            "{}\nresource \"google_compute_region_network_endpoint_group\" \"neg\" {{\n  network_endpoint_type = \"SERVERLESS\"\n  cloud_run {{\n    service = google_cloud_run_v2_service.api.name\n  }}\n}}\n\nresource \"google_cloud_run_v2_service\" \"api\" {{\n  name    = \"api\"\n  ingress = {ingress}\n}}\n{invoker}",
            url_map(
                "EXTERNAL_MANAGED",
                "  backend {\n    group = google_compute_region_network_endpoint_group.neg.id\n  }"
            )
        )
    };
    let t = TerraformTie {
        kind: Some("google_cloud_run_v2_service".into()),
        ..tie("", "api")
    };
    let v = verdicts(
        &[(
            "infra/run.tf",
            &run("\"INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER\"", ""),
        )],
        &[],
        &t,
        &[("GET", "/api/items"), ("GET", "/health")],
    );
    assert_eq!(v[0].0, Exposure::Public, "{v:?}");
    assert_eq!(v[1].0, Exposure::Internal, "{v:?}");
    assert!(
        v[1].1
            .contains("ingress `internal-and-cloud-load-balancing`"),
        "{v:?}"
    );

    // Ingress from everywhere: public with an `allUsers` invoker, unknown without.
    let everyone = "\nresource \"google_cloud_run_v2_service_iam_member\" \"public\" {\n  name   = google_cloud_run_v2_service.api.name\n  role   = \"roles/run.invoker\"\n  member = \"allUsers\"\n}\n";
    let (x, why) = one(
        &[("infra/run.tf", &run("\"INGRESS_TRAFFIC_ALL\"", everyone))],
        &t,
        "GET",
        "/health",
    );
    assert_eq!(x, Exposure::Public, "{why}");
    assert!(why.contains("granted to everyone"), "{why}");
    let (x, why) = one(
        &[("infra/run.tf", &run("\"INGRESS_TRAFFIC_ALL\"", ""))],
        &t,
        "GET",
        "/health",
    );
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(
        why.contains("neither `allUsers` nor `allAuthenticatedUsers`"),
        "{why}"
    );
    let (x, why) = one(
        &[("infra/run.tf", &run("var.ingress", everyone))],
        &t,
        "GET",
        "/health",
    );
    assert_eq!(x, Exposure::Unknown, "{why}");
    assert!(why.contains("`ingress = var.ingress`"), "{why}");
}

/// A tie names a target by its kind; one that names a kind Drift does not read
/// forwards to, or a target that is not there, is said and ties nothing.
#[test]
fn a_tie_names_a_target_of_a_kind_drift_reads() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "infra/fn.tf", LAMBDA);
    let tf = Terraform::read(dir.path(), &["infra/fn.tf".to_string()]);
    assert!(tf.tied(&tie("aws_lambda_function", "api")).is_ok());
    let e = tf.tied(&tie("aws_lambda_function", "nope")).unwrap_err();
    assert!(e.contains("no such `aws_lambda_function`"), "{e}");

    let mut warnings = Vec::new();
    let v: serde_json::Value = serde_json::json!({
        "terraform": [
            {"target": "infra#aws_lambda_function.api", "code": "services/api"},
            {"target": "infra#aws_instance.web", "code": "services/web"},
            {"target": "infra#aws_lb_target_group.api", "code": "services/x"}
        ]
    });
    let s = drift_mine::policy::SecuritySettings::read(&v, &mut warnings);
    assert_eq!(s.terraform.len(), 2, "{warnings:?}");
    assert_eq!(s.terraform[0].kind.as_deref(), Some("aws_lambda_function"));
    assert_eq!(s.terraform[0].target(), "infra#aws_lambda_function.api");
    // A target group is written as before: no kind.
    assert_eq!(s.terraform[1].kind, None);
    assert_eq!(s.terraform[1].target(), "infra#aws_lb_target_group.api");
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("`infra#aws_instance.web` names something else")),
        "{warnings:?}"
    );
}
