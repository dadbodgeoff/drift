//! Terraform beyond a load balancer's listener rules, through the CLI: `drift setup`
//! offers a Lambda function an HTTP API sends the service's routes to, a person's
//! answer writes the tie under `security.terraform` with the function's kind, and
//! `drift security --json` then reads the API's routes for the tied code: the route a
//! route key carries is internet-facing, one nothing forwards is internal, each with
//! the Terraform it rests on (`tied`).

use std::path::Path;
use std::process::Command;

use serde_json::Value;

static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// `drift --no-cache <args>` in `root`; `person` runs it as a person's script does.
fn drift(root: &Path, args: &[&str], person: bool) -> String {
    let mut c = Command::new(&*BIN);
    c.arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_SETUP_PERSON")
        .env_remove("DRIFT_SETUP_PERSON_NONINTERACTIVE");
    if person {
        c.env("DRIFT_SETUP_PERSON", "1")
            .env("DRIFT_SETUP_PERSON_NONINTERACTIVE", "1");
    }
    let out = c.output().unwrap();
    assert!(
        out.status.success(),
        "drift {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&drift(root, args, false)).unwrap()
}

const ROUTES: &str = "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/items\")\nasync def items():\n    return []\n\n\n@app.get(\"/health\")\nasync def health():\n    return {\"ok\": True}\n";

const TERRAFORM: &str = "resource \"aws_lambda_function\" \"api\" {\n  function_name = \"api\"\n  handler       = \"app.main.handler\"\n}\n\nresource \"aws_apigatewayv2_api\" \"main\" {\n  name          = \"main\"\n  protocol_type = \"HTTP\"\n}\n\nresource \"aws_apigatewayv2_stage\" \"default\" {\n  api_id      = aws_apigatewayv2_api.main.id\n  name        = \"$default\"\n  auto_deploy = true\n}\n\nresource \"aws_apigatewayv2_integration\" \"api\" {\n  api_id           = aws_apigatewayv2_api.main.id\n  integration_type = \"AWS_PROXY\"\n  integration_uri  = aws_lambda_function.api.invoke_arn\n}\n\nresource \"aws_apigatewayv2_route\" \"items\" {\n  api_id             = aws_apigatewayv2_api.main.id\n  route_key          = \"GET /items\"\n  target             = \"integrations/${aws_apigatewayv2_integration.api.id}\"\n  authorization_type = \"NONE\"\n}\n";

/// A FastAPI service only Terraform deploys: an HTTP API sends `GET /items` to the
/// Lambda function `api`.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "services/api/pyproject.toml",
        "[project]\nname = \"api\"\ndependencies = [\"fastapi\"]\n",
    );
    write(r, "services/api/app/__init__.py", "");
    write(r, "services/api/app/main.py", ROUTES);
    write(r, "infra/api/main.tf", TERRAFORM);
    dir
}

/// (route, exposure, boundary, tied) of every entry point.
fn exposures(root: &Path) -> Vec<(String, String, String, bool)> {
    let v = json(root, &["security", "--json"]);
    let mut out: Vec<_> = v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["route"].as_str().unwrap_or_default().to_string(),
                e["exposure"].as_str().unwrap().to_string(),
                e["boundary"].as_str().unwrap_or_default().to_string(),
                e["tied"] == true,
            )
        })
        .collect();
    out.sort();
    out
}

/// Untied, every route is unknown. The setup question offers the function by the
/// route its API sends to it; "yes" writes the tie with the function's kind, and the
/// HTTP API's routes then decide each route.
#[test]
fn a_lambda_function_an_http_api_sends_to_is_offered_and_tied() {
    let dir = repo();
    let r = dir.path();
    let before = exposures(r);
    assert!(before.iter().all(|e| e.1 == "unknown"), "{before:#?}");

    let v = json(r, &["setup", "--json"]);
    let q = v["questions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["kind"] == "terraform")
        .cloned()
        .unwrap_or_else(|| panic!("{v:#}"));
    let text = q["text"].to_string();
    assert!(
        text.contains("Lambda function `api` (infra/api/main.tf:1) looks like the one that sends requests to api"),
        "{text}"
    );
    assert!(
        text.contains(
            "Drift will take your word that only this lambda function sends requests to api"
        ),
        "{text}"
    );
    assert_eq!(q["choices"][0]["label"], "Yes, it is `api`", "{q:#}");
    assert_eq!(
        q["choices"][0]["writes"],
        "- {target: \"infra/api#aws_lambda_function.api\", code: \"services/api\"}",
        "{q:#}"
    );
    let id = q["id"].as_str().unwrap();
    drift(
        r,
        &[
            "setup",
            "--by",
            "person",
            "--answer",
            &format!("{id}=tie-1"),
        ],
        true,
    );
    let config = std::fs::read_to_string(r.join(".drift/config.yaml")).unwrap();
    assert!(
        config.contains("{target: \"infra/api#aws_lambda_function.api\", code: \"services/api\"}"),
        "{config}"
    );

    let after = exposures(r);
    let at = |route: &str| after.iter().find(|e| e.0 == route).cloned().unwrap();
    let (_, x, why, tied) = at("/items");
    assert_eq!(x, "public", "{why}");
    assert!(tied, "{why}");
    assert!(
        why.contains("HTTP API route `GET /items` (infra/api/main.tf:")
            && why.contains("authorization `NONE`")
            && why.contains("tied to services/api by .drift/config.yaml"),
        "{why}"
    );
    let (_, x, why, tied) = at("/health");
    assert_eq!(x, "internal", "{why}");
    assert!(tied, "{why}");
    assert!(
        why.contains("nothing Drift reads in the repository's Terraform forwards /health"),
        "{why}"
    );
}

/// A tie a person writes by hand for a kind Drift reads works the same way; a stage
/// other than `$default` keeps the carried route unknown (the path the function sees
/// may start with it), and a `.tfvars` file that sets the variable a route key rests
/// on makes it unknown, the file named.
#[test]
fn a_hand_written_tie_reads_the_api_and_names_what_it_cannot_settle() {
    let dir = repo();
    let r = dir.path();
    write(
        r,
        ".drift/config.yaml",
        "security:\n  terraform:\n    - target: infra/api#aws_lambda_function.api\n      code: services/api\n",
    );
    let staged = TERRAFORM.replace("name        = \"$default\"", "name        = \"prod\"");
    write(r, "infra/api/main.tf", &staged);
    let after = exposures(r);
    let items = after.iter().find(|e| e.0 == "/items").unwrap();
    assert_eq!(items.1, "unknown", "{items:?}");
    assert!(items.2.contains("its stage `prod`"), "{items:?}");

    let keyed = TERRAFORM.replace("\"GET /items\"", "var.route_key")
        + "\nvariable \"route_key\" {\n  default = \"GET /items\"\n}\n";
    write(r, "infra/api/main.tf", &keyed);
    assert_eq!(
        exposures(r).iter().find(|e| e.0 == "/items").unwrap().1,
        "public"
    );
    write(
        r,
        "infra/envs/prod.tfvars",
        "route_key = \"ANY /{proxy+}\"\n",
    );
    let after = exposures(r);
    let health = after.iter().find(|e| e.0 == "/health").unwrap();
    assert_eq!(health.1, "unknown", "{health:?}");
    assert!(
        health
            .2
            .contains("`var.route_key` is set in infra/envs/prod.tfvars"),
        "{health:?}"
    );
}
