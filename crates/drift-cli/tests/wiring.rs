//! Wiring rules (experimental): "you added one, but did not register it".
//!
//! Small synthetic repositories, one positive and one negative per exclusion
//! class: a registry that lists every member is proposed and catches the next
//! unregistered one; members wired by discovery (file-based routing, glob imports,
//! DI auto-registration, framework autodiscovery) and lists that cover only a
//! subset are not. Co-change rules come from git history and degrade to nothing in
//! a shallow clone. With the feature off, nothing changes.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

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

/// `drift` in `root` (feature flag from the repo's own config only).
fn run(root: &Path, args: &[&str], stdin: Option<&str>) -> (i32, String) {
    let mut child = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("GITHUB_STEP_SUMMARY")
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

fn ok(root: &Path, args: &[&str]) -> String {
    let (code, out) = run(root, args, None);
    assert_eq!(code, 0, "{args:?}: {out}");
    out
}

fn census(root: &Path) -> Value {
    serde_json::from_str(&ok(root, &["--no-cache", "census", "--json"])).unwrap()
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
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn enable(root: &Path) {
    write(root, ".drift/config.yaml", "experimental: [wiring]\n");
}

/// [`enable`], with Python mined proposals said to be on (the default, decision D13-py;
/// with `off`, Python wiring proposals are withheld with the rest).
fn enable_python(root: &Path) {
    write(
        root,
        ".drift/config.yaml",
        "experimental: [wiring]\nproposals: {python: on}\n",
    );
}

fn wiring_proposals(c: &Value) -> Vec<Value> {
    c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["rule_kind"] == "registered_in" || p["rule_kind"] == "mirrors_keys")
        .cloned()
        .collect()
}

fn status_of<'a>(c: &'a Value, dir: &str) -> Vec<&'a str> {
    c["wiring"]["registries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["role"]["dir"] == dir)
        .map(|r| r["status"].as_str().unwrap())
        .collect()
}

const SERVICES: &[&str] = &[
    "users", "billing", "orders", "invoices", "payments", "reports",
];

fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().unwrap().to_uppercase().chain(c).collect()
}

fn service(name: &str) -> String {
    format!(
        "import {{ Injectable }} from \"@nestjs/common\";\n\n@Injectable()\nexport class {}Service {{\n  run() {{\n    return 1;\n  }}\n}}\n",
        cap(name)
    )
}

/// A Nest app: six services, all in `app.module.ts`'s providers.
fn nest(registered: &[&str]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut providers = String::new();
    for n in SERVICES {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
        if registered.contains(n) {
            imports.push_str(&format!(
                "import {{ {}Service }} from \"./{n}/{n}.service\";\n",
                cap(n)
            ));
            providers.push_str(&format!("    {}Service,\n", cap(n)));
        }
    }
    write(
        r,
        "src/app.module.ts",
        &format!(
            "{imports}\n@Module({{\n  providers: [\n{providers}  ],\n}})\nexport class AppModule {{}}\n"
        ),
    );
    dir
}

#[test]
fn feature_off_changes_nothing() {
    let dir = nest(SERVICES);
    let r = dir.path();
    let c = census(r);
    assert!(c.get("wiring").is_none(), "no wiring block when off");
    assert!(wiring_proposals(&c).is_empty());
    let text = ok(r, &["--no-cache", "census"]);
    assert!(!text.contains("wiring"), "{text}");
    // The environment variable turns it on too.
    let out = Command::new(&*BIN)
        .args(["--no-cache", "census", "--json"])
        .current_dir(r)
        .env("DRIFT_EXPERIMENTAL", "wiring")
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    let on: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(on["wiring"]["enabled"], true);
}

/// `drift` with exit code, stdout and stderr.
fn run3(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("GITHUB_STEP_SUMMARY")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Unknown keys and features warn on stderr, never fail: other keys are harmless,
/// and a misspelt feature is said, not silently ignored.
#[test]
fn unknown_config_keys_warn_and_change_nothing() {
    let dir = nest(SERVICES);
    let r = dir.path();
    write(
        r,
        ".drift/config.yaml",
        "experimentl: [wiring]\nother_tool: 1\n",
    );
    let (code, out, err) = run3(r, &["--no-cache", "census", "--json"]);
    assert_eq!(code, 0, "{err}");
    assert!(err.contains("unknown setting `experimentl`"), "{err}");
    assert!(err.contains("unknown setting `other_tool`"), "{err}");
    let c: Value = serde_json::from_str(&out).unwrap();
    assert!(c.get("wiring").is_none(), "the feature stays off");
    write(r, ".drift/config.yaml", "experimental: [wirng]\n");
    let (code, _, err) = run3(r, &["--no-cache", "census", "--json"]);
    assert_eq!(code, 0);
    assert!(
        err.contains("unknown experimental feature `wirng`"),
        "{err}"
    );
    write(r, ".drift/config.yaml", "experimental: wiring\n");
    assert_ne!(
        run3(r, &["--no-cache", "census", "--json"]).0,
        0,
        "not a list: an error"
    );
}

#[test]
fn nest_providers_registry_catches_an_unregistered_service() {
    let dir = nest(SERVICES);
    let r = dir.path();
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    let p = &props[0];
    assert_eq!(p["tier"], "suggestion");
    assert_eq!(p["rule"]["type"], "registered_in");
    assert_eq!(
        p["rule"]["slot"],
        "arg:pkg:@nestjs/common#Module@0:providers"
    );
    assert_eq!(p["rule"]["path"], "src/app.module.ts");
    assert_eq!(p["role"]["entry"], "*");
    assert_eq!(p["evidence"]["holders"], 6);
    assert_eq!(p["wiring"]["registry"]["path"], "src/app.module.ts");
    assert_eq!(p["wiring"]["registry"]["label"], "Module() providers");
    assert_eq!(p["wiring"]["registry"]["line"], 10);
    assert!(p["wiring"]["registry"]["like"]["name"].is_string());
    assert_eq!(c["wiring"]["cochange"]["history"], "no_git");
    let id = p["id"].as_str().unwrap().to_string();

    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    assert!(ok(r, &["--no-cache", "check"]).contains("no new violations"));

    // The agent adds a service and forgets to register it.
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains(
            "fix  add RefundsService to Module() providers in src/app.module.ts:10 (like "
        ),
        "{text}"
    );
    let v: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "check", "--format", "json"])).unwrap();
    let vs = v["violations"].as_array().unwrap();
    assert_eq!(vs.len(), 1);
    assert_eq!(vs[0]["symbol"], "RefundsService");
    assert_eq!(vs[0]["wire"]["action"], "register");
    assert_eq!(vs[0]["wire"]["path"], "src/app.module.ts");
    assert_eq!(vs[0]["mode"], "advise", "suggestions advise");
    // Structured for tools (Studio): the registry, the missing entry, a sibling.
    assert_eq!(vs[0]["wire"]["line"], 10);
    assert_eq!(vs[0]["wire"]["label"], "Module() providers");
    assert_eq!(vs[0]["wire"]["entry"]["symbol"], "RefundsService");
    assert_eq!(
        vs[0]["wire"]["entry"]["path"],
        "src/refunds/refunds.service.ts"
    );
    assert_eq!(vs[0]["wire"]["entry"]["line"], 4);
    assert!(
        vs[0]["wire"]["like"]["name"]
            .as_str()
            .unwrap()
            .ends_with("Service")
    );
    assert!(vs[0]["wire"]["like"]["line"].as_u64().unwrap() >= 11);
    assert!(
        vs[0]["wire"]["like"]["path"]
            .as_str()
            .unwrap()
            .ends_with(".service.ts")
    );

    // Registered: clean again.
    let module = std::fs::read_to_string(r.join("src/app.module.ts"))
        .unwrap()
        .replace(
            "import { Module } from \"@nestjs/common\";\n",
            "import { Module } from \"@nestjs/common\";\nimport { RefundsService } from \"./refunds/refunds.service\";\n",
        )
        .replace("  ],", "    RefundsService,\n  ],");
    write(r, "src/app.module.ts", &module);
    assert!(ok(r, &["--no-cache", "check"]).contains("no new violations"));
}

#[test]
fn a_registry_of_a_subset_is_not_a_rule() {
    let dir = nest(&SERVICES[..4]);
    let r = dir.path();
    enable(r);
    let c = census(r);
    assert!(wiring_proposals(&c).is_empty());
    assert_eq!(status_of(&c, "src"), ["below_threshold"]);
}

#[test]
fn barrel_reexports_catch_a_missing_export() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "ui" }"#);
    let mut index = String::new();
    for n in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] {
        write(
            r,
            &format!("src/widgets/{n}.ts"),
            &format!("export function {n}() {{\n  return \"{n}\";\n}}\n"),
        );
        index.push_str(&format!("export * from \"./{n}\";\n"));
    }
    write(r, "src/widgets/index.ts", &index);
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["slot"], "exports");
    assert_eq!(props[0]["rule"]["path"], "src/widgets/index.ts");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(
        r,
        "src/widgets/eta.ts",
        "export function eta() {\n  return 1;\n}\n",
    );
    let text = ok(r, &["--no-cache", "check"]);
    // A barrel of `export *` lines takes another such line, not a name.
    assert!(
        text.contains(
            "fix  add `export * from \"./eta\"` to src/widgets/index.ts (like `export * from \"./"
        ),
        "{text}"
    );
    let v: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "check", "--format", "json"])).unwrap();
    assert_eq!(v["violations"][0]["wire"]["action"], "reexport_module");
}

#[test]
fn file_based_routes_are_not_registered_anywhere() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "web", "dependencies": { "next": "15" } }"#,
    );
    let mut sitemap = String::new();
    let mut list = String::new();
    for n in ["a", "b", "c", "d", "e", "f"] {
        write(
            r,
            &format!("app/{n}/page.tsx"),
            &format!("export default function Page{n}() {{\n  return <div>{n}</div>;\n}}\n"),
        );
        sitemap.push_str(&format!("import P{n} from \"../app/{n}/page\";\n"));
        list.push_str(&format!("P{n}, "));
    }
    write(
        r,
        "lib/sitemap.ts",
        &format!("{sitemap}export const pages = [{list}];\n"),
    );
    enable(r);
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
    assert_eq!(status_of(&c, "app"), ["autodiscovered:file_routing"]);
}

/// Two plugin folders listed in one registry; `plugins` is also loaded by glob.
#[test]
fn glob_imported_members_are_excluded_and_listed_ones_kept() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "app" }"#);
    let mut imports = String::new();
    let mut plugins = String::new();
    let mut handlers = String::new();
    for n in ["one", "two", "three", "four", "five", "six"] {
        write(
            r,
            &format!("src/plugins/{n}.ts"),
            &format!("export function {n}Plugin() {{\n  return 1;\n}}\n"),
        );
        write(
            r,
            &format!("src/handlers/{n}.ts"),
            &format!("export function {n}Handler() {{\n  return 2;\n}}\n"),
        );
        imports.push_str(&format!(
            "import {{ {n}Plugin }} from \"./plugins/{n}\";\nimport {{ {n}Handler }} from \"./handlers/{n}\";\n"
        ));
        plugins.push_str(&format!("{n}Plugin, "));
        handlers.push_str(&format!("{n}Handler, "));
    }
    write(
        r,
        "src/registry.ts",
        &format!(
            "{imports}export const plugins = [{plugins}];\nexport const handlers = [{handlers}];\n"
        ),
    );
    write(
        r,
        "src/loader.ts",
        "export const loaded = import.meta.glob(\"./plugins/*.ts\");\n",
    );
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    let dirs: Vec<&str> = props
        .iter()
        .map(|p| p["role"]["dir"].as_str().unwrap())
        .collect();
    assert_eq!(dirs, ["src/handlers"], "{props:#?}");
    assert!(
        status_of(&c, "src/plugins")
            .iter()
            .all(|s| *s == "autodiscovered:glob_import")
    );
}

#[test]
fn di_auto_registered_services_are_excluded() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "ng", "dependencies": { "@angular/core": "18" } }"#,
    );
    let mut imports = String::from("import { NgModule } from \"@angular/core\";\n");
    let mut providers = String::new();
    for n in SERVICES {
        write(
            r,
            &format!("src/app/{n}/{n}.service.ts"),
            &format!(
                "import {{ Injectable }} from \"@angular/core\";\n\n@Injectable({{ providedIn: \"root\" }})\nexport class {}Service {{}}\n",
                cap(n)
            ),
        );
        imports.push_str(&format!(
            "import {{ {}Service }} from \"./{n}/{n}.service\";\n",
            cap(n)
        ));
        providers.push_str(&format!("{}Service, ", cap(n)));
    }
    write(
        r,
        "src/app/app.module.ts",
        &format!(
            "{imports}@NgModule({{ providers: [{providers}] }})\nexport class AppModule {{}}\n"
        ),
    );
    enable(r);
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
    assert!(
        status_of(&c, "src/app")
            .iter()
            .all(|s| *s == "autodiscovered:di_auto_registration"),
        "{:#?}",
        c["wiring"]["registries"]
    );
}

/// Celery tasks named in `include=[...]`: a rule, unless `autodiscover_tasks()` finds them.
#[test]
fn celery_include_is_a_registry_unless_tasks_are_autodiscovered() {
    for autodiscover in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(r, "pyproject.toml", "[project]\nname = \"proj\"\n");
        write(r, "proj/__init__.py", "");
        let mut include = String::new();
        for app in ["shop", "blog", "news", "mail", "media"] {
            write(r, &format!("proj/{app}/__init__.py"), "");
            write(
                r,
                &format!("proj/{app}/tasks.py"),
                &format!(
                    "from celery import shared_task\n\n\n@shared_task\ndef {app}_sync():\n    return 1\n\n\n@shared_task\ndef {app}_clean():\n    return 2\n"
                ),
            );
            include.push_str(&format!("\"proj.{app}.tasks\", "));
        }
        let discover = if autodiscover {
            "app.autodiscover_tasks()\n"
        } else {
            ""
        };
        write(
            r,
            "proj/worker.py",
            &format!(
                "from celery import Celery\n\napp = Celery(\"proj\", include=[{include}])\n{discover}"
            ),
        );
        enable_python(r);
        let c = census(r);
        let props = wiring_proposals(&c);
        if autodiscover {
            assert!(props.is_empty(), "{props:#?}");
            assert!(
                status_of(&c, "proj")
                    .iter()
                    .all(|s| *s == "autodiscovered:framework_autodiscovery"),
                "{:#?}",
                c["wiring"]["registries"]
            );
        } else {
            assert_eq!(props.len(), 1, "{props:#?}");
            assert_eq!(props[0]["rule"]["slot"], "arg:pkg:celery#Celery@99:include");
            assert_eq!(props[0]["wiring"]["registry"]["label"], "Celery(include=)");
            // A new tasks module that is not included.
            let id = props[0]["id"].as_str().unwrap().to_string();
            ok(r, &["--no-cache", "init"]);
            ok(r, &["review", "--show-to-agents", &id]);
            write(r, "proj/ads/__init__.py", "");
            write(
                r,
                "proj/ads/tasks.py",
                "from celery import shared_task\n\n\n@shared_task\ndef ads_sync():\n    return 1\n",
            );
            let text = ok(r, &["--no-cache", "check"]);
            assert!(
                text.contains("fix  add ads_sync to Celery(include=) in proj/worker.py:3"),
                "{text}"
            );
        }
    }
}

/// Django: each app's views are in its own `urlpatterns`; no one list holds them all,
/// so the family of `urlpatterns` lists is the registry and the nearest is named.
#[test]
fn django_urlpatterns_family_names_the_nearest_urlconf() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"site\"\n");
    write(r, "apps/__init__.py", "");
    for app in ["shop", "blog", "news", "mail", "media"] {
        write(r, &format!("apps/{app}/__init__.py"), "");
        write(
            r,
            &format!("apps/{app}/views.py"),
            &format!(
                "def {app}_list(request):\n    return 1\n\n\ndef {app}_detail(request, pk):\n    return 2\n"
            ),
        );
        write(
            r,
            &format!("apps/{app}/urls.py"),
            &format!(
                "from django.urls import path\n\nfrom . import views\n\nurlpatterns = [\n    path(\"\", views.{app}_list),\n    path(\"<int:pk>/\", views.{app}_detail),\n]\n"
            ),
        );
    }
    enable_python(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["slot"], "binding:urlpatterns");
    assert!(
        props[0]["rule"].get("path").is_none(),
        "a family has no path"
    );
    assert_eq!(props[0]["wiring"]["lists"], 5);
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    let views = std::fs::read_to_string(r.join("apps/blog/views.py")).unwrap();
    write(
        r,
        "apps/blog/views.py",
        &format!("{views}\n\ndef blog_archive(request):\n    return 3\n"),
    );
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains("fix  add blog_archive to `urlpatterns` in apps/blog/urls.py:5"),
        "{text}"
    );
}

fn env_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "web" }"#);
    git(r, &["init", "-q"]);
    let mut env = Vec::new();
    for i in 0..6 {
        let k = format!("FEATURE_{i}_KEY");
        env.push(k.clone());
        write(
            r,
            "src/env.ts",
            &format!(
                "import {{ z }} from \"zod\";\n\nexport const env = z.object({{\n{}}});\n",
                env.iter()
                    .map(|k| format!("  {k}: z.string(),\n"))
                    .collect::<String>()
            ),
        );
        write(
            r,
            ".env.example",
            &env.iter().map(|k| format!("{k}=\n")).collect::<String>(),
        );
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", &format!("add {k}")]);
    }
    enable_python(r);
    dir
}

#[test]
fn cochange_rule_from_history_and_its_check() {
    let dir = env_repo();
    let r = dir.path();
    let c = census(r);
    assert_eq!(c["wiring"]["cochange"]["history"], "read");
    assert_eq!(c["wiring"]["cochange"]["commits"], 6);
    let props = wiring_proposals(&c);
    let p = props
        .iter()
        .find(|p| p["rule"]["type"] == "mirrors_keys" && p["rule"]["from"] == "src/env.ts")
        .expect("env.ts -> .env.example");
    assert_eq!(p["rule"]["to"], ".env.example");
    assert_eq!(p["evidence"]["holders"], 6);
    assert_eq!(p["evidence"]["total"], 6);
    assert_eq!(p["tier"], "suggestion");
    assert_eq!(p["wiring"]["history"]["commits"], 6);
    // Deterministic for a given HEAD.
    assert_eq!(
        ok(r, &["--no-cache", "census", "--json"]),
        ok(r, &["--no-cache", "census", "--json"])
    );
    let id = p["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    assert!(ok(r, &["--no-cache", "check"]).contains("no new violations"));

    // A key added to the schema only.
    let env = std::fs::read_to_string(r.join("src/env.ts"))
        .unwrap()
        .replace("});", "  STRIPE_SECRET_KEY: z.string(),\n});");
    write(r, "src/env.ts", &env);
    let v: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "check", "--format", "json"])).unwrap();
    let vs = v["violations"].as_array().unwrap();
    assert_eq!(vs.len(), 1, "{vs:#?}");
    assert_eq!(vs[0]["path"], "src/env.ts");
    assert_eq!(vs[0]["symbol"], "STRIPE_SECRET_KEY");
    assert_eq!(vs[0]["wire"]["action"], "mirror");
    assert_eq!(vs[0]["wire"]["path"], ".env.example");
    assert_eq!(vs[0]["wire"]["entry"]["symbol"], "STRIPE_SECRET_KEY");
    assert_eq!(vs[0]["wire"]["entry"]["path"], "src/env.ts");
    assert_eq!(vs[0]["wire"]["like"]["path"], ".env.example");
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains("fix  add STRIPE_SECRET_KEY to keys in .env.example:1"),
        "{text}"
    );
}

#[test]
fn shallow_clones_give_no_cochange_rules() {
    let src = env_repo();
    let dir = tempfile::tempdir().unwrap();
    let url = format!("file://{}", src.path().display());
    git(dir.path(), &["clone", "-q", "--depth", "1", &url, "c"]);
    let r = dir.path().join("c");
    enable(&r);
    let c = census(&r);
    assert_eq!(c["wiring"]["cochange"]["history"], "shallow");
    assert!(
        wiring_proposals(&c)
            .iter()
            .all(|p| p["rule"]["type"] != "mirrors_keys")
    );
}

#[test]
fn pr_mode_reports_an_added_member_without_its_registration() {
    let dir = nest(SERVICES);
    let r = dir.path();
    enable(r);
    let c = census(r);
    let id = wiring_proposals(&c)[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "feature"]);
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "add refunds"]);
    let v: Value = serde_json::from_str(&ok(
        r,
        &[
            "--no-cache",
            "check",
            "--diff-base",
            "main",
            "--format",
            "json",
        ],
    ))
    .unwrap();
    let vs = v["violations"].as_array().unwrap();
    assert_eq!(vs.len(), 1, "{v:#?}");
    assert_eq!(vs[0]["path"], "src/refunds/refunds.service.ts");
    assert_eq!(vs[0]["wire"]["path"], "src/app.module.ts");
}

#[test]
fn end_of_turn_hook_advises_once_about_unwired_additions() {
    let dir = nest(SERVICES);
    let r = dir.path();
    enable(r);
    let c = census(r);
    let id = wiring_proposals(&c)[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    let hook = |event: &str, extra: Value| -> Option<Value> {
        let mut input = json!({ "session_id": "s1", "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (code, out) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        assert_eq!(code, 0);
        let out = out.trim();
        (!out.is_empty()).then(|| serde_json::from_str(out).unwrap())
    };
    hook("SessionStart", json!({ "source": "startup" }));
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    let path = r.join("src/refunds/refunds.service.ts");
    // Per edit: silent (the registry is another file).
    assert!(
        hook(
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": path } })
        )
        .is_none()
    );
    let stop = hook("Stop", json!({ "stop_hook_active": false })).expect("advice at end of turn");
    // Advice never blocks or continues the turn: it is shown to the person...
    assert!(stop.get("decision").is_none(), "{stop}");
    let text = stop["systemMessage"].as_str().unwrap();
    assert!(
        text.contains("fix  add RefundsService to Module() providers in src/app.module.ts:10"),
        "{text}"
    );
    // ...and given to the agent with the next prompt, once.
    let next = hook("UserPromptSubmit", json!({ "prompt": "go on" })).expect("queued advice");
    let ctx = next["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap();
    assert!(ctx.contains("RefundsService"), "{ctx}");
    assert!(hook("UserPromptSubmit", json!({ "prompt": "again" })).is_none());
    // A turn without edits does nothing (no scan), and a finding is said once.
    assert!(hook("Stop", json!({ "stop_hook_active": false })).is_none());
    hook(
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": path } }),
    );
    assert!(
        hook("Stop", json!({ "stop_hook_active": false })).is_none(),
        "said once"
    );
}

/// `INSTALLED_APPS = ["shop", ...]` registers each app's config, not every class in
/// the package: app configs get a rule, the package's views do not.
#[test]
fn installed_apps_registers_app_configs_only() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"site\"\n");
    write(r, "site/__init__.py", "");
    let mut apps = String::new();
    for app in ["shop", "blog", "news", "mail", "media"] {
        write(r, &format!("site/{app}/__init__.py"), "");
        write(
            r,
            &format!("site/{app}/apps.py"),
            &format!(
                "from django.apps import AppConfig\n\n\nclass {}Config(AppConfig):\n    name = \"site.{app}\"\n",
                cap(app)
            ),
        );
        write(
            r,
            &format!("site/{app}/views.py"),
            &format!(
                "class {}View:\n    pass\n\n\nclass {}Detail:\n    pass\n",
                cap(app),
                cap(app)
            ),
        );
        apps.push_str(&format!("    \"site.{app}\",\n"));
    }
    write(
        r,
        "site/settings.py",
        &format!("INSTALLED_APPS = [\n    \"django.contrib.admin\",\n{apps}]\n"),
    );
    enable_python(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["slot"], "binding:INSTALLED_APPS");
    assert_eq!(props[0]["role"]["file"], "apps");
    assert_eq!(props[0]["evidence"]["holders"], 5);
}

/// Lists passed to calls inside a component or hook body run code; they register
/// nothing (`useTable({ columns })` in every table component).
#[test]
fn lists_inside_function_bodies_are_not_registries() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "web" }"#);
    for n in ["users", "teams", "orders", "invoices", "keys", "logs"] {
        write(
            r,
            &format!("src/tables/{n}/columns.ts"),
            "export const columns = [{ id: \"a\" }];\n",
        );
        write(
            r,
            &format!("src/tables/{n}/table.ts"),
            "import { useTable } from \"table-lib\";\nimport { columns } from \"./columns\";\n\nexport function Table() {\n  return useTable({ columns });\n}\n",
        );
    }
    enable(r);
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
}

/// A directory whose members were already unregistered when the rule was learned
/// (baselined) registers them some way Drift cannot see: a new sibling there is not
/// reported, one elsewhere is.
#[test]
fn siblings_of_baselined_outliers_are_not_reported() {
    let dir = nest(SERVICES);
    let r = dir.path();
    let extra = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
    let mut module = std::fs::read_to_string(r.join("src/app.module.ts")).unwrap();
    for n in extra {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
        module = format!(
            "import {{ {}Service }} from \"./{n}/{n}.service\";\n{module}",
            cap(n)
        )
        .replace("  ],", &format!("    {}Service,\n  ],", cap(n)));
    }
    write(r, "src/app.module.ts", &module);
    // Registered dynamically: not in the providers list Drift reads.
    write(r, "src/dyn/dyn.service.ts", &service("dyn"));
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["evidence"]["holders"], 15);
    assert_eq!(props[0]["evidence"]["total"], 16);
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(r, "src/dyn/more.service.ts", &service("more"));
    assert!(ok(r, &["--no-cache", "check"]).contains("no new violations"));
    write(r, "src/fresh/fresh.service.ts", &service("fresh"));
    let text = ok(r, &["--no-cache", "check"]);
    assert!(text.contains("FreshService"), "{text}");
    assert!(!text.contains("MoreService"), "{text}");
}

/// A Nest app with the providers rule accepted; returns the rule id.
fn accepted_nest() -> (tempfile::TempDir, String) {
    let dir = nest(SERVICES);
    let r = dir.path();
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    (dir, id)
}

/// Edit `src/app.module.ts`: add import lines, `imports: [...]`, provider lines.
fn edit_app_module(r: &Path, imports: &str, modules: &str, providers: &str) {
    let mut m = std::fs::read_to_string(r.join("src/app.module.ts")).unwrap();
    m = format!("{imports}{m}");
    if !modules.is_empty() {
        m = m.replace(
            "@Module({\n",
            &format!("@Module({{\n  imports: [{modules}],\n"),
        );
    }
    m = m.replace("  ],\n})", &format!("{providers}  ],\n}})"));
    write(r, "src/app.module.ts", &m);
}

fn clean(r: &Path) {
    let out = ok(r, &["--no-cache", "check"]);
    assert!(out.contains("no new violations"), "{out}");
}

/// The README's own case: a feature module that `AppModule` imports registers its
/// providers. Also as a `@Global()` module.
#[test]
fn feature_modules_imported_by_the_root_register_their_providers() {
    for global in ["", "@Global()\n"] {
        let (dir, _) = accepted_nest();
        let r = dir.path();
        write(r, "src/refunds/refunds.service.ts", &service("refunds"));
        write(
            r,
            "src/refunds/refunds.module.ts",
            &format!(
                "import {{ Global, Module }} from \"@nestjs/common\";\nimport {{ RefundsService }} from \"./refunds.service\";\n\n{global}@Module({{ providers: [RefundsService], exports: [RefundsService] }})\nexport class RefundsModule {{}}\n"
            ),
        );
        edit_app_module(
            r,
            "import { RefundsModule } from \"./refunds/refunds.module\";\n",
            "RefundsModule",
            "",
        );
        clean(r);
        // The same service not provided by the feature module is still missing,
        // and the fix names the nearest list of the rule's kind: the feature module's.
        write(r, "src/refunds/disputes.service.ts", &service("disputes"));
        let text = ok(r, &["--no-cache", "check"]);
        assert!(
            text.contains(
                "fix  add DisputesService to Module() providers in src/refunds/refunds.module.ts"
            ),
            "{text}"
        );
    }
}

/// `forwardRef(() => X)` names X; so does an import from another feature module.
#[test]
fn forward_refs_and_nested_module_imports_register() {
    let (dir, _) = accepted_nest();
    let r = dir.path();
    let feature = |name: &str, imports: &str, header: &str| {
        format!(
            "import {{ Module, forwardRef }} from \"@nestjs/common\";\n{header}import {{ {c}Service }} from \"./{name}.service\";\n\n@Module({{ imports: [{imports}], providers: [{c}Service] }})\nexport class {c}Module {{}}\n",
            c = cap(name)
        )
    };
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    write(
        r,
        "src/refunds/refunds.module.ts",
        &feature("refunds", "", ""),
    );
    edit_app_module(
        r,
        "import { forwardRef } from \"@nestjs/common\";\nimport { RefundsModule } from \"./refunds/refunds.module\";\n",
        "forwardRef(() => RefundsModule)",
        "",
    );
    clean(r);
    // Imported from a feature module that AppModule imports.
    write(r, "src/ledger/ledger.service.ts", &service("ledger"));
    write(r, "src/ledger/ledger.module.ts", &feature("ledger", "", ""));
    write(
        r,
        "src/refunds/refunds.module.ts",
        &feature(
            "refunds",
            "forwardRef(() => LedgerModule)",
            "import { LedgerModule } from \"../ledger/ledger.module\";\n",
        ),
    );
    clean(r);
}

/// `...providers()` (a helper, in either form) is opaque: unknown, never missing.
/// A spread of a spread of a list is read through.
#[test]
fn helper_and_nested_spreads_are_never_reported_missing() {
    let imports = "import { RefundsService } from \"./refunds/refunds.service\";\nimport { ChargebacksService } from \"./chargebacks/chargebacks.service\";\n";
    for (helper, spread) in [
        (
            "function disputeProviders() {\n  return [RefundsService, ChargebacksService];\n}\n",
            "    ...disputeProviders(),\n",
        ),
        (
            "const disputeProviders = () => [RefundsService, ChargebacksService];\n",
            "    ...disputeProviders(),\n",
        ),
        (
            "const dispute = [RefundsService, ChargebacksService];\nconst extra = [...dispute];\n",
            "    ...extra,\n",
        ),
    ] {
        let (dir, _) = accepted_nest();
        let r = dir.path();
        write(r, "src/refunds/refunds.service.ts", &service("refunds"));
        write(
            r,
            "src/chargebacks/chargebacks.service.ts",
            &service("chargebacks"),
        );
        edit_app_module(r, &format!("{imports}{helper}"), "", spread);
        clean(r);
    }
}

fn component(name: &str) -> String {
    format!(
        "import {{ Component }} from \"@angular/core\";\n\n@Component({{ selector: \"app-{name}\", template: \"\" }})\nexport class {}Component {{}}\n",
        cap(name)
    )
}

/// Lazy routes (`loadComponent`, `loadChildren`) load what no reference shows.
#[test]
fn lazy_routes_are_never_reported_missing() {
    for lazy in [
        "  { path: \"settings\", loadComponent: () => import(\"./settings/settings.component\").then((m) => m.SettingsComponent) },\n",
        "  { path: \"settings\", loadChildren: () => import(\"./settings/settings.routes\").then((m) => m.SETTINGS_ROUTES) },\n",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        write(
            r,
            "package.json",
            r#"{ "name": "ng", "dependencies": { "@angular/core": "18" } }"#,
        );
        let mut imports = String::from("import { Routes } from \"@angular/router\";\n");
        let mut routes = String::new();
        for n in SERVICES {
            write(r, &format!("src/app/{n}/{n}.component.ts"), &component(n));
            imports.push_str(&format!(
                "import {{ {}Component }} from \"./{n}/{n}.component\";\n",
                cap(n)
            ));
            routes.push_str(&format!(
                "  {{ path: \"{n}\", component: {}Component }},\n",
                cap(n)
            ));
        }
        let file = |extra: &str| {
            format!("{imports}\nexport const routes: Routes = [\n{routes}{extra}];\n")
        };
        write(r, "src/app/app.routes.ts", &file(""));
        enable(r);
        let c = census(r);
        let props = wiring_proposals(&c);
        assert_eq!(props.len(), 1, "{props:#?}");
        assert_eq!(props[0]["rule"]["slot"], "binding:routes");
        let id = props[0]["id"].as_str().unwrap().to_string();
        ok(r, &["--no-cache", "init"]);
        ok(r, &["review", "--show-to-agents", &id]);
        write(
            r,
            "src/app/settings/settings.component.ts",
            &component("settings"),
        );
        write(r, "src/app/app.routes.ts", &file(lazy));
        clean(r);
    }
}

/// `include("shop.refunds_urls")` makes that urlconf's patterns reachable.
#[test]
fn django_include_by_string_reaches_the_included_urlconf() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"site\"\n");
    write(r, "proj/__init__.py", "");
    write(r, "shop/__init__.py", "");
    write(r, "shop/views/__init__.py", "");
    let mut imports = String::from("from django.urls import include, path\n\n");
    let mut pats = String::new();
    for n in ["cart", "order", "item", "price", "stock", "promo"] {
        write(
            r,
            &format!("shop/views/{n}.py"),
            &format!("def {n}_view(request):\n    return 1\n"),
        );
        imports.push_str(&format!("from shop.views.{n} import {n}_view\n"));
        pats.push_str(&format!("    path(\"{n}/\", {n}_view),\n"));
    }
    let urls = |extra: &str| format!("{imports}\nurlpatterns = [\n{pats}{extra}]\n");
    write(r, "proj/urls.py", &urls(""));
    enable_python(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["path"], "proj/urls.py");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(
        r,
        "shop/views/refund.py",
        "def refund_view(request):\n    return 1\n",
    );
    write(
        r,
        "shop/refunds_urls.py",
        "from django.urls import path\n\nfrom shop.views.refund import refund_view\n\nurlpatterns = [path(\"\", refund_view)]\n",
    );
    write(
        r,
        "proj/urls.py",
        &urls("    path(\"refunds/\", include(\"shop.refunds_urls\")),\n"),
    );
    clean(r);
    // An include Drift cannot place makes the list opaque: still never "missing".
    write(
        r,
        "shop/views/audit.py",
        "def audit_view(request):\n    return 1\n",
    );
    write(
        r,
        "proj/urls.py",
        &urls(
            "    path(\"refunds/\", include(\"shop.refunds_urls\")),\n    path(\"x/\", include(\"thirdparty.urls\")),\n",
        ),
    );
    clean(r);
}

/// A router mounted on a mounted router is registered.
#[test]
fn express_sub_routers_mounted_on_mounted_routers_register() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "api", "dependencies": { "express": "4" } }"#,
    );
    let router = |n: &str| {
        format!(
            "import {{ Router }} from \"express\";\n\nexport const {n}Router = Router();\n{n}Router.get(\"/\", (req, res) => res.send(\"{n}\"));\n"
        )
    };
    let mut imports = String::from("import express from \"express\";\n");
    let mut uses = String::new();
    for n in ["users", "teams", "orders", "invoices", "keys", "logs"] {
        write(r, &format!("src/routes/{n}.ts"), &router(n));
        imports.push_str(&format!("import {{ {n}Router }} from \"./routes/{n}\";\n"));
        uses.push_str(&format!("app.use(\"/{n}\", {n}Router);\n"));
    }
    let app = |extra: &str| format!("{imports}{extra}\nexport const app = express();\n{uses}");
    write(r, "src/app.ts", &app(""));
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    let p = props
        .iter()
        .find(|p| {
            p["rule"]["slot"]
                .as_str()
                .unwrap_or("")
                .starts_with("calls:")
        })
        .unwrap_or_else(|| panic!("{props:#?}"));
    let id = p["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(r, "src/routes/refunds.ts", &router("refunds"));
    write(
        r,
        "src/routes/admin.ts",
        "import { Router } from \"express\";\nimport { refundsRouter } from \"./refunds\";\n\nexport const adminRouter = Router();\nadminRouter.use(\"/refunds\", refundsRouter);\n",
    );
    let mut text = app("import { adminRouter } from \"./routes/admin\";\n");
    text.push_str("app.use(\"/admin\", adminRouter);\n");
    write(r, "src/app.ts", &text);
    clean(r);
}

/// With the flag off, accepted wiring conventions are inert everywhere, and `init`
/// does not keep them.
#[test]
fn flag_off_disables_accepted_wiring_conventions_everywhere() {
    let (dir, id) = accepted_nest();
    let r = dir.path();
    git(r, &["init", "-q"]);
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "base"]);
    git(r, &["checkout", "-qb", "feature"]);
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    git(r, &["add", "-A"]);
    git(r, &["commit", "-qm", "refunds"]);
    // On: reported.
    assert!(ok(r, &["--no-cache", "check"]).contains("RefundsService"));
    // Off.
    std::fs::remove_file(r.join(".drift/config.yaml")).unwrap();
    let (code, out, err) = run3(r, &["--no-cache", "check"]);
    assert_eq!(code, 0);
    assert!(out.contains("no new violations"), "{out}");
    assert!(err.contains("1 wiring convention(s) skipped"), "{err}");
    for format in ["json", "sarif"] {
        let (_, out, _) = run3(r, &["--no-cache", "check", "--format", format]);
        assert!(!out.contains("RefundsService"), "{format}: {out}");
    }
    let (_, out, _) = run3(r, &["--no-cache", "check", "--diff-base", "main"]);
    assert!(!out.contains("RefundsService"), "{out}");
    // Hooks: nothing at the end of a turn that added it.
    let hook = |event: &str, extra: Value| -> Option<Value> {
        let mut input = json!({ "session_id": "s2", "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (_, out) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        let out = out.trim();
        (!out.is_empty()).then(|| serde_json::from_str(out).unwrap())
    };
    hook("SessionStart", json!({ "source": "startup" }));
    write(r, "src/ledger/ledger.service.ts", &service("ledger"));
    let path = r.join("src/ledger/ledger.service.ts");
    hook(
        "PostToolUse",
        json!({ "tool_name": "Write", "tool_input": { "file_path": path } }),
    );
    assert!(hook("Stop", json!({ "stop_hook_active": false })).is_none());
    // init drops them.
    let (code, _, err) = run3(r, &["--no-cache", "init"]);
    assert_eq!(code, 0);
    assert!(err.contains("1 wiring convention(s) dropped"), "{err}");
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(!policy.contains(&id), "{policy}");
}

/// Wiring rules never block: not when set to block by hand, not with --force.
#[test]
fn wiring_rules_never_block() {
    let (dir, id) = accepted_nest();
    let r = dir.path();
    let (_, _, err) = run3(r, &["review", "--block", &id, "--force"]);
    assert!(
        err.contains("experimental wiring rules only advise"),
        "{err}"
    );
    let policy = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    // Set to block by hand.
    let edited = policy.replacen("mode: advise", "mode: block", usize::MAX);
    assert_ne!(edited, policy);
    write(r, ".drift/conventions.yaml", &edited);
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    // `--strict` (the pre-commit hook, the action's `args: --strict`) reports it and
    // still passes: wiring rules only advise.
    let (code, out, _) = run3(r, &["--no-cache", "check", "--strict"]);
    assert!(out.contains("RefundsService"));
    assert_eq!(code, 0, "--strict never fails on wiring advice: {out}");
    let (code, out, _) = run3(
        r,
        &["--no-cache", "check", "--strict", "--format", "github"],
    );
    assert_eq!(code, 0, "{out}");
    let (code, out, _) = run3(r, &["--no-cache", "check"]);
    assert_eq!(code, 0, "advice never fails the check: {out}");
    let v: Value =
        serde_json::from_str(&run3(r, &["--no-cache", "check", "--format", "json"]).1).unwrap();
    assert_eq!(v["violations"][0]["mode"], "advise");
    // The Stop hook: never `decision: block`.
    let input = |event: &str, extra: Value| {
        let mut i = json!({ "session_id": "s3", "cwd": r, "hook_event_name": event });
        i.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        i.to_string()
    };
    run(
        r,
        &["hook", "claude", "SessionStart"],
        Some(&input("SessionStart", json!({ "source": "startup" }))),
    );
    write(r, "src/ledger/ledger.service.ts", &service("ledger"));
    let path = r.join("src/ledger/ledger.service.ts");
    run(
        r,
        &["hook", "claude", "PostToolUse"],
        Some(&input(
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": path } }),
        )),
    );
    let (_, out) = run(
        r,
        &["hook", "claude", "Stop"],
        Some(&input("Stop", json!({ "stop_hook_active": false }))),
    );
    assert!(!out.contains("\"decision\""), "{out}");
    assert!(out.contains("LedgerService"), "{out}");
}

/// Services provided by feature modules that `AppModule` imports count as
/// registered in its providers; the rule says so, and only providers lists count
/// (an `imports` list never "holds" a service).
#[test]
fn reach_through_imported_modules_is_mined_and_said() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut modules = String::new();
    for n in SERVICES {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
    }
    for n in &SERVICES[2..] {
        write(
            r,
            &format!("src/{n}/{n}.module.ts"),
            &format!(
                "import {{ Module }} from \"@nestjs/common\";\nimport {{ {c}Service }} from \"./{n}.service\";\n\n@Module({{ providers: [{c}Service] }})\nexport class {c}Module {{}}\n",
                c = cap(n)
            ),
        );
        imports.push_str(&format!(
            "import {{ {c}Module }} from \"./{n}/{n}.module\";\n",
            c = cap(n)
        ));
        modules.push_str(&format!("{}Module, ", cap(n)));
    }
    imports.push_str("import { UsersService } from \"./users/users.service\";\nimport { BillingService } from \"./billing/billing.service\";\n");
    write(
        r,
        "src/app.module.ts",
        &format!(
            "{imports}\n@Module({{\n  imports: [{modules}],\n  providers: [UsersService, BillingService],\n}})\nexport class AppModule {{}}\n"
        ),
    );
    enable(r);
    let c = census(r);
    let services: Vec<Value> = wiring_proposals(&c)
        .into_iter()
        .filter(|p| p["role"]["file"] == "*.service")
        .collect();
    assert_eq!(services.len(), 1, "{services:#?}");
    let p = &services[0];
    assert_eq!(
        p["rule"]["slot"],
        "arg:pkg:@nestjs/common#Module@0:providers"
    );
    assert_eq!(p["rule"]["path"], "src/app.module.ts");
    assert_eq!(p["rule"]["reach"], true);
    assert_eq!(p["evidence"]["holders"], 6);
    assert!(
        p["summary"]
            .as_str()
            .unwrap()
            .ends_with("directly or in the lists it reaches"),
        "{p:#?}"
    );
    let id = p["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    clean(r);
    write(r, "src/orders/refunds.service.ts", &service("refunds"));
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains(
            "fix  add RefundsService to Module() providers in src/orders/orders.module.ts"
        ),
        "{text}"
    );
}

/// Spreading a constant with a literal value (no references) hides nothing; a
/// constant bound to a call result does.
#[test]
fn spreads_of_literal_constants_are_not_opaque() {
    let (dir, _) = accepted_nest();
    let r = dir.path();
    write(
        r,
        "src/tokens.ts",
        "export const EXTRA = [{ provide: \"A\", useValue: 1 }];\nexport const MADE = makeProviders();\nfunction makeProviders() {\n  return [];\n}\n",
    );
    edit_app_module(
        r,
        "import { EXTRA } from \"./tokens\";\n",
        "",
        "    ...EXTRA,\n",
    );
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    assert!(
        ok(r, &["--no-cache", "check"]).contains("RefundsService"),
        "still reported"
    );
    let m = std::fs::read_to_string(r.join("src/app.module.ts")).unwrap();
    write(
        r,
        "src/app.module.ts",
        &m.replace(
            "import { EXTRA } from \"./tokens\";",
            "import { EXTRA, MADE } from \"./tokens\";",
        )
        .replace("    ...EXTRA,\n", "    ...EXTRA,\n    ...MADE,\n"),
    );
    clean(r);
}

/// A barrel that re-exports a list constant is not opaque because of the list.
#[test]
fn barrels_do_not_take_in_reexported_lists() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "ui" }"#);
    let mut index = String::new();
    for n in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] {
        write(
            r,
            &format!("src/w/{n}.ts"),
            &format!("export function {n}() {{\n  return 1;\n}}\n"),
        );
        index.push_str(&format!("export {{ {n} }} from \"./{n}\";\n"));
    }
    write(
        r,
        "src/w/list.ts",
        "import { CONFIG, helper } from \"../../lib/helper\";\nexport const ALL = [CONFIG, ...helper()];\n",
    );
    write(
        r,
        "lib/helper.ts",
        "export const CONFIG = { a: 1 };\nexport function helper() {\n  return [];\n}\n",
    );
    index.push_str("export { ALL } from \"./list\";\n");
    write(r, "src/w/index.ts", &index);
    enable(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert!(
        props
            .iter()
            .any(|p| p["rule"]["slot"] == "exports" && p["rule"]["path"] == "src/w/index.ts"),
        "{:#?}",
        c["wiring"]["registries"]
    );
}

/// When the list a fix would name is built from another list
/// (`providers: [...services, AuditService]`), the fix names the inner list.
#[test]
fn fixes_name_the_inner_list_of_a_derived_one() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::new();
    let mut list = String::new();
    // Too few in the inner list for a rule of its own: the outer one is proposed.
    for n in &SERVICES[..4] {
        write(r, &format!("src/services/{n}.service.ts"), &service(n));
        imports.push_str(&format!(
            "import {{ {}Service }} from \"./{n}.service\";\n",
            cap(n)
        ));
        list.push_str(&format!("  {}Service,\n", cap(n)));
    }
    write(
        r,
        "src/services/index.ts",
        &format!("{imports}\nexport const services = [\n{list}];\n"),
    );
    for n in ["audit", "mail", "queue", "search", "cache"] {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
    }
    write(
        r,
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { services } from \"./services\";\nimport { AuditService } from \"./audit/audit.service\";\nimport { MailService } from \"./mail/mail.service\";\nimport { QueueService } from \"./queue/queue.service\";\nimport { SearchService } from \"./search/search.service\";\nimport { CacheService } from \"./cache/cache.service\";\n\n@Module({\n  providers: [...services, AuditService, MailService, QueueService, SearchService, CacheService],\n})\nexport class AppModule {}\n",
    );
    enable(r);
    let c = census(r);
    let outer = wiring_proposals(&c)
        .into_iter()
        .find(|p| p["rule"]["path"] == "src/app.module.ts")
        .unwrap_or_else(|| panic!("{:#?}", wiring_proposals(&c)));
    let id = outer["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(r, "src/services/refunds.service.ts", &service("refunds"));
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains("fix  add RefundsService to `services` in src/services/index.ts"),
        "{text}"
    );
}

/// Census ids are unique: the census and `init` must agree on what a rule is.
fn assert_unique_ids(c: &Value) {
    let ids: Vec<&str> = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    let set: std::collections::BTreeSet<&str> = ids.iter().copied().collect();
    assert_eq!(set.len(), ids.len(), "duplicate ids: {ids:?}");
}

/// A tRPC router nested in another, in one file: both lists have the same slot, so
/// they are one registry and one rule, not the same rule twice under one id.
#[test]
fn nested_lists_of_one_slot_are_one_rule() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "t", "dependencies": { "@trpc/server": "11" } }"#,
    );
    write(
        r,
        "server/trpc.ts",
        "import { initTRPC } from \"@trpc/server\";\nconst t = initTRPC.create();\nexport const router = t.router;\nexport const procedure = t.procedure;\n",
    );
    let routes = [
        "getMethods",
        "createKey",
        "deleteKey",
        "findKeys",
        "updateKey",
        "signinKey",
    ];
    let mut imports = String::from("import { router } from \"../trpc\";\n");
    for n in routes {
        write(
            r,
            &format!("server/auth/{n}.ts"),
            &format!(
                "import {{ procedure }} from \"../trpc\";\nexport const {n}Route = procedure.query(() => 1);\n"
            ),
        );
        imports.push_str(&format!("import {{ {n}Route }} from \"./{n}\";\n"));
    }
    write(
        r,
        "server/auth/router.ts",
        &format!(
            "{imports}\nexport const authRouter = router({{\n  getMethods: getMethodsRoute,\n  key: router({{\n    create: createKeyRoute,\n    delete: deleteKeyRoute,\n    find: findKeysRoute,\n    update: updateKeyRoute,\n    signin: signinKeyRoute,\n  }}),\n}});\n"
        ),
    );
    enable(r);
    let c = census(r);
    assert_unique_ids(&c);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["path"], "server/auth/router.ts");
    assert_eq!(props[0]["evidence"]["holders"], 6);
    assert_eq!(props[0]["wiring"]["lists"], 2);
    // The fix names the list that holds most of the role: the nested router.
    assert_eq!(props[0]["wiring"]["registry"]["line"], 11);
    let text = ok(r, &["--no-cache", "census"]);
    let id = props[0]["id"].as_str().unwrap();
    assert_eq!(text.matches(id).count(), 1, "{text}");
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", id]);
    write(
        r,
        "server/auth/rotateKey.ts",
        "import { procedure } from \"../trpc\";\nexport const rotateKeyRoute = procedure.query(() => 1);\n",
    );
    let text = ok(r, &["--no-cache", "check"]);
    assert_eq!(text.matches("rotateKeyRoute").count(), 2, "{text}");
}

/// Two `@Module`s in one file (immich's `ApiModule` and `MaintenanceModule`): one
/// registry, one rule, and neither module is an outlier of its own lists.
#[test]
fn two_modules_in_one_file_are_one_registry() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    for n in SERVICES {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
        imports.push_str(&format!(
            "import {{ {}Service }} from \"./{n}/{n}.service\";\n",
            cap(n)
        ));
    }
    let list = |ns: &[&str]| {
        ns.iter()
            .map(|n| format!("{}Service", cap(n)))
            .collect::<Vec<_>>()
            .join(", ")
    };
    write(
        r,
        "src/app.module.ts",
        &format!(
            "{imports}\n@Module({{ providers: [{}] }})\nexport class ApiModule {{}}\n\n@Module({{ providers: [{}] }})\nexport class MaintenanceModule {{}}\n",
            list(SERVICES),
            list(&SERVICES[..4])
        ),
    );
    enable(r);
    let c = census(r);
    assert_unique_ids(&c);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["evidence"]["holders"], 6);
    assert_eq!(props[0]["evidence"]["total"], 6);
    assert_eq!(props[0]["wiring"]["lists"], 2);
}

/// A sibling module of the rule's own, which neither imports the other, provides
/// its services: they are provided (twenty's workspace-migration runner).
#[test]
fn services_provided_by_a_sibling_module_are_not_missing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut providers = String::new();
    for n in names {
        let c = format!("{}Handler", cap(n));
        write(
            r,
            &format!("src/runner/{n}-handler.service.ts"),
            &format!(
                "import {{ Injectable }} from \"@nestjs/common\";\n\n@Injectable()\nexport class {c}Service {{\n  run() {{\n    return 1;\n  }}\n}}\n"
            ),
        );
        imports.push_str(&format!(
            "import {{ {c}Service }} from \"./{n}-handler.service\";\n"
        ));
        providers.push_str(&format!("    {c}Service,\n"));
    }
    write(
        r,
        "src/runner/handlers.module.ts",
        &format!(
            "{imports}\n@Module({{\n  providers: [\n{providers}  ],\n}})\nexport class HandlersModule {{}}\n"
        ),
    );
    enable(r);
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["path"], "src/runner/handlers.module.ts");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    // A sibling module, which neither imports nor is imported by the handlers
    // module, provides two services, one of them in a new directory.
    write(r, "src/runner/runner.service.ts", &service("runner"));
    write(r, "src/runner/gauge/gauge.service.ts", &service("gauge"));
    write(
        r,
        "src/runner/runner.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { RunnerService } from \"./runner.service\";\nimport { GaugeService } from \"./gauge/gauge.service\";\n\n@Module({\n  providers: [RunnerService, GaugeService],\n})\nexport class RunnerModule {}\n",
    );
    clean(r);
    // Provided nowhere: still missing.
    write(r, "src/runner/meter/meter.service.ts", &service("meter"));
    let text = ok(r, &["--no-cache", "check"]);
    assert!(text.contains("MeterService"), "{text}");
    assert!(
        !text.contains("GaugeService") && !text.contains("RunnerService"),
        "{text}"
    );
    std::fs::remove_file(r.join("src/runner/meter/meter.service.ts")).unwrap();
    std::fs::remove_file(r.join("src/runner/gauge/gauge.service.ts")).unwrap();
    write(
        r,
        "src/runner/runner.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { RunnerService } from \"./runner.service\";\n\n@Module({\n  providers: [RunnerService],\n})\nexport class RunnerModule {}\n",
    );
    // Mined again (12 of 13 in the handlers module), the role is split between two
    // modules: not proposed against one of them. The family of providers lists
    // stands in, with no false outlier.
    let c = census(r);
    let props = wiring_proposals(&c);
    assert!(
        props
            .iter()
            .all(|p| p["rule"]["path"] != "src/runner/handlers.module.ts"),
        "{props:#?}"
    );
    assert!(
        props.iter().all(|p| p["outliers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["symbol"] != "RunnerService" && o["symbol"] != "GaugeService")),
        "{props:#?}"
    );
    assert!(
        c["wiring"]["registries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["path"] == "src/runner/handlers.module.ts" && x["status"] == "split"),
        "{:#?}",
        c["wiring"]["registries"]
    );
}

/// `settings/__init__.py` doing `from .base import *` re-exports one module: no
/// barrel convention for the whole package, however many names `base.py` has.
#[test]
fn one_star_import_is_not_a_package_barrel() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"proj\"\n");
    for p in ["proj", "proj/api", "proj/sync"] {
        write(r, &format!("{p}/__init__.py"), "");
    }
    let settings = [
        "DEBUG",
        "SECRET_KEY",
        "ALLOWED_HOSTS",
        "DATABASES",
        "TIME_ZONE",
        "LANGUAGE_CODE",
        "STATIC_URL",
        "MEDIA_URL",
        "ROOT_URLCONF",
        "ADMINS",
        "MANAGERS",
        "SITE_ID",
        "USE_TZ",
        "USE_I18N",
        "LOGIN_URL",
        "CACHES",
        "EMAIL_HOST",
        "EMAIL_PORT",
        "SESSION_ENGINE",
        "CSRF_COOKIE_NAME",
    ];
    let base: String = settings
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{s} = {i}\n"))
        .collect();
    write(r, "proj/settings/base.py", &base);
    write(
        r,
        "proj/settings/__init__.py",
        "from .base import *  # noqa\n",
    );
    write(r, "proj/api/serializers.py", "PAGE_SIZE = 50\n");
    write(r, "proj/sync/core.py", "THRESHOLD = 3\n");
    enable_python(r);
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
    // Three star-imported modules: a barrel of the settings package only, never of
    // the whole package, so other packages' constants are not told to go there.
    write(r, "proj/settings/local.py", "LOCAL = 1\nDEV = 2\n");
    write(r, "proj/settings/prod.py", "PROD = 1\nSENTRY = 2\n");
    write(
        r,
        "proj/settings/__init__.py",
        "from .base import *  # noqa\nfrom .local import *  # noqa\nfrom .prod import *  # noqa\n",
    );
    let c = census(r);
    let props = wiring_proposals(&c);
    assert!(
        props.iter().all(|p| p["role"]["dir"] == "proj/settings"),
        "{props:#?}"
    );
    assert_eq!(props.len(), 1, "{props:#?}");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(r, "proj/billing/limits.py", "MAX_INVOICES = 10\n");
    write(r, "proj/settings/mail.py", "MAIL_HOST = 1\n");
    let text = ok(r, &["--no-cache", "check"]);
    assert!(!text.contains("MAX_INVOICES"), "{text}");
    assert!(
        text.contains("fix  add `from .mail import *` to proj/settings/__init__.py"),
        "{text}"
    );
}

/// A Python barrel of star imports, one per module, is a barrel convention; the fix
/// is another star import.
#[test]
fn python_star_import_barrels_get_a_star_import_fix() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"lib\"\n");
    write(r, "lib/__init__.py", "");
    let mut init = String::new();
    for n in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] {
        write(
            r,
            &format!("lib/parts/{n}.py"),
            &format!("def {n}():\n    return 1\n"),
        );
        init.push_str(&format!("from .{n} import *  # noqa\n"));
    }
    write(r, "lib/parts/__init__.py", &init);
    enable_python(r);
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["rule"]["path"], "lib/parts/__init__.py");
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    write(r, "lib/parts/eta.py", "def eta():\n    return 1\n");
    let text = ok(r, &["--no-cache", "check"]);
    assert!(
        text.contains("fix  add `from .eta import *` to lib/parts/__init__.py (like `from ."),
        "{text}"
    );
}

/// A public barrel that leaves out what its own package imports directly is a
/// curated subset: its outliers are internal helpers, so no rule is proposed.
#[test]
fn barrels_of_a_curated_subset_are_not_proposed() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "ui" }"#);
    let names = [
        "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    ];
    let mut index = String::new();
    for n in names {
        write(
            r,
            &format!("src/w/{n}.ts"),
            &format!("export function {n}() {{\n  return \"{n}\";\n}}\n"),
        );
        index.push_str(&format!("export {{ {n} }} from \"./{n}\";\n"));
    }
    write(r, "src/w/index.ts", &index);
    write(
        r,
        "src/w/internal.ts",
        "export function shared() {\n  return 1;\n}\n",
    );
    enable(r);
    // Nobody imports the helper: an omission, proposed.
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["outliers"][0]["symbol"], "shared");
    // A sibling imports it directly, not through the barrel: internal on purpose.
    write(
        r,
        "src/w/alpha.ts",
        "import { shared } from \"./internal\";\nexport function alpha() {\n  return shared();\n}\n",
    );
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
    assert!(
        c["wiring"]["registries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["path"] == "src/w/index.ts" && x["status"] == "curated"),
        "{:#?}",
        c["wiring"]["registries"]
    );
    // Left out of a file the barrel re-exports from (a new schema next to exported
    // ones), it is an omission, imported or not.
    std::fs::remove_file(r.join("src/w/internal.ts")).unwrap();
    write(
        r,
        "src/w/alpha.ts",
        "export function alpha() {\n  return \"alpha\";\n}\nexport function alphaNext() {\n  return 2;\n}\n",
    );
    write(
        r,
        "src/w/beta.ts",
        "import { alphaNext } from \"./alpha\";\nexport function beta() {\n  return alphaNext();\n}\n",
    );
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["outliers"][0]["symbol"], "alphaNext");
}

/// The module that owns a registry (`AppModule`), a module `NestFactory` bootstraps
/// and an `abstract class` are never registered themselves: not outliers.
#[test]
fn owners_roots_and_abstract_classes_are_not_members() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10", "@nestjs/core": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut modules = String::new();
    for n in SERVICES {
        let c = cap(n);
        write(
            r,
            &format!("src/modules/{n}.module.ts"),
            &format!(
                "import {{ Module }} from \"@nestjs/common\";\n\n@Module({{}})\nexport class {c}Module {{}}\n"
            ),
        );
        imports.push_str(&format!("import {{ {c}Module }} from \"./{n}.module\";\n"));
        modules.push_str(&format!("{c}Module, "));
    }
    write(
        r,
        "src/modules/app.module.ts",
        &format!("{imports}\n@Module({{ imports: [{modules}] }})\nexport class AppModule {{}}\n"),
    );
    write(
        r,
        "src/modules/worker.module.ts",
        "import { Module } from \"@nestjs/common\";\n\n@Module({})\nexport class WorkerModule {}\n",
    );
    write(
        r,
        "src/worker.ts",
        "import { NestFactory } from \"@nestjs/core\";\nimport { WorkerModule } from \"./modules/worker.module\";\n\nexport async function work() {\n  return NestFactory.createApplicationContext(WorkerModule);\n}\n",
    );
    // Services: all provided but an abstract base.
    let mut simports = String::new();
    let mut providers = String::new();
    for n in SERVICES {
        write(r, &format!("src/services/{n}.service.ts"), &service(n));
        simports.push_str(&format!(
            "import {{ {}Service }} from \"../services/{n}.service\";\n",
            cap(n)
        ));
        providers.push_str(&format!("{}Service, ", cap(n)));
    }
    write(
        r,
        "src/services/base.service.ts",
        "export abstract class AbstractCrudService {\n  abstract find(): number;\n}\n",
    );
    write(
        r,
        "src/modules/users.module.ts",
        &format!(
            "import {{ Module }} from \"@nestjs/common\";\n{simports}\n@Module({{ providers: [{providers}] }})\nexport class UsersModule {{}}\n"
        ),
    );
    enable(r);
    let c = census(r);
    assert_unique_ids(&c);
    let props = wiring_proposals(&c);
    let modules: Vec<&Value> = props
        .iter()
        .filter(|p| p["rule"]["path"] == "src/modules/app.module.ts")
        .collect();
    assert_eq!(modules.len(), 1, "{props:#?}");
    assert_eq!(modules[0]["evidence"]["total"], 6, "{:#?}", modules[0]);
    assert!(
        modules[0]["outliers"].as_array().unwrap().is_empty(),
        "{:#?}",
        modules[0]
    );
    let services: Vec<&Value> = props
        .iter()
        .filter(|p| p["rule"]["path"] == "src/modules/users.module.ts")
        .collect();
    assert_eq!(services.len(), 1, "{props:#?}");
    assert!(
        services[0]["outliers"].as_array().unwrap().is_empty(),
        "{:#?}",
        services[0]
    );
    let id = modules[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    clean(r);
    // A new module that nothing imports is still reported.
    write(
        r,
        "src/modules/refunds.module.ts",
        "import { Module } from \"@nestjs/common\";\n\n@Module({})\nexport class RefundsModule {}\n",
    );
    let text = ok(r, &["--no-cache", "check"]);
    assert!(text.contains("RefundsModule"), "{text}");
    assert!(
        !text.contains("AppModule") && !text.contains("WorkerModule"),
        "{text}"
    );
}

/// A member missing from a list and from the list spread into it is one omission:
/// one rule, one violation, for the inner list. Nested barrels, both accepted, too.
#[test]
fn one_omission_is_reported_once() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let mut imports = String::new();
    let mut list = String::new();
    for n in SERVICES {
        write(r, &format!("src/services/{n}.service.ts"), &service(n));
        imports.push_str(&format!(
            "import {{ {}Service }} from \"./{n}.service\";\n",
            cap(n)
        ));
        list.push_str(&format!("  {}Service,\n", cap(n)));
    }
    write(
        r,
        "src/services/index.ts",
        &format!("{imports}\nexport const services = [\n{list}];\n"),
    );
    for n in ["audit", "mail", "queue"] {
        write(r, &format!("src/{n}/{n}.service.ts"), &service(n));
    }
    write(
        r,
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { services } from \"./services\";\nimport { AuditService } from \"./audit/audit.service\";\nimport { MailService } from \"./mail/mail.service\";\nimport { QueueService } from \"./queue/queue.service\";\n\n@Module({\n  providers: [...services, AuditService, MailService, QueueService],\n})\nexport class AppModule {}\n",
    );
    enable(r);
    let c = census(r);
    let ids: Vec<String> = wiring_proposals(&c)
        .iter()
        .filter(|p| p["rule"]["slot"] != "exports")
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    // The list and the list spread into it: only the more specific (the inner
    // list, the narrower role) is proposed.
    assert_eq!(ids.len(), 1, "{:#?}", wiring_proposals(&c));
    assert!(
        wiring_proposals(&c)
            .iter()
            .any(|p| p["rule"]["path"] == "src/services/index.ts")
    );
    ok(r, &["--no-cache", "init"]);
    for id in &ids {
        ok(r, &["review", "--show-to-agents", id]);
    }
    write(r, "src/services/refunds.service.ts", &service("refunds"));
    let v: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "check", "--format", "json"])).unwrap();
    let vs: Vec<&Value> = v["violations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["symbol"] == "RefundsService")
        .collect();
    assert_eq!(vs.len(), 1, "{v:#?}");
    assert_eq!(vs[0]["wire"]["path"], "src/services/index.ts");

    // Nested barrels: `src/ui/index.ts` names what `src/ui/w/index.ts` re-exports.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "ui" }"#);
    let mut inner = String::new();
    let mut outer = String::new();
    for n in ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"] {
        write(
            r,
            &format!("src/ui/w/{n}.ts"),
            &format!("export function {n}() {{\n  return 1;\n}}\n"),
        );
        inner.push_str(&format!("export {{ {n} }} from \"./{n}\";\n"));
        outer.push_str(&format!("export {{ {n} }} from \"./w\";\n"));
    }
    for n in ["one", "two", "three"] {
        write(
            r,
            &format!("src/ui/{n}.ts"),
            &format!("export function {n}() {{\n  return 1;\n}}\n"),
        );
        outer.push_str(&format!("export {{ {n} }} from \"./{n}\";\n"));
    }
    write(r, "src/ui/w/index.ts", &inner);
    write(r, "src/ui/index.ts", &outer);
    enable(r);
    let ids: Vec<String> = wiring_proposals(&census(r))
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    ok(r, &["--no-cache", "init"]);
    for id in &ids {
        ok(r, &["review", "--show-to-agents", id]);
    }
    write(
        r,
        "src/ui/w/eta.ts",
        "export function eta() {\n  return 1;\n}\n",
    );
    let text = ok(r, &["--no-cache", "check"]);
    assert_eq!(text.matches("  at   src/ui/w/eta.ts").count(), 1, "{text}");
    assert!(text.contains("re-exports in src/ui/w/index.ts"), "{text}");
}

/// The Stop that blocks on another rule still gives the turn's wiring advice: the
/// edits it was about are cleared, so it would never be said otherwise.
#[test]
fn wiring_advice_is_given_when_stop_also_blocks() {
    let dir = nest(SERVICES);
    let r = dir.path();
    enable(r);
    // Routes wrapped in `withAuth`, that convention in block mode (as in first_run).
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    let guarded = "import { withAuth } from \"@/lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
    let unguarded =
        "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";
    for i in 0..40 {
        write(
            r,
            &format!("app/api/r{i:02}/route.ts"),
            if i < 37 { guarded } else { unguarded },
        );
    }
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
    let c = census(r);
    let wiring = wiring_proposals(&c)[0]["id"].as_str().unwrap().to_string();
    let auth = c["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["summary"].as_str().unwrap().contains("withAuth"))
        .unwrap_or_else(|| panic!("{:#?}", c["proposals"]))["id"]
        .as_str()
        .unwrap()
        .to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &wiring]);
    ok(r, &["review", "--block", &auth]);
    let hook = |event: &str, extra: Value| -> Option<Value> {
        let mut input = json!({ "session_id": "s9", "cwd": r, "hook_event_name": event });
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let (code, out) = run(r, &["hook", "claude", event], Some(&input.to_string()));
        assert_eq!(code, 0);
        let out = out.trim();
        (!out.is_empty()).then(|| serde_json::from_str(out).unwrap())
    };
    hook("SessionStart", json!({ "source": "startup" }));
    // One turn: an unguarded route (blocks) and an unregistered service (advice).
    write(r, "app/api/new/route.ts", unguarded);
    write(r, "src/refunds/refunds.service.ts", &service("refunds"));
    for f in ["app/api/new/route.ts", "src/refunds/refunds.service.ts"] {
        hook(
            "PostToolUse",
            json!({ "tool_name": "Write", "tool_input": { "file_path": r.join(f) } }),
        );
    }
    let stop = hook("Stop", json!({ "stop_hook_active": false })).expect("blocks");
    assert_eq!(stop["decision"], "block", "{stop}");
    assert!(
        !stop["reason"].as_str().unwrap().contains("RefundsService"),
        "advice is not a reason to block: {stop}"
    );
    let advice = stop["systemMessage"].as_str().unwrap_or_default();
    assert!(
        advice.contains("add RefundsService to Module() providers in src/app.module.ts"),
        "{stop}"
    );
    let next = hook("UserPromptSubmit", json!({ "prompt": "go on" })).expect("queued advice");
    assert!(
        next["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap()
            .contains("RefundsService")
    );
}

/// A controller file: `@Controller() export class <Name> {}`.
fn controller(name: &str) -> String {
    format!(
        "import {{ Controller }} from \"@nestjs/common\";\n\n@Controller()\nexport class {name} {{}}\n"
    )
}

/// Twenty feature modules with one controller each, and `src/org`'s two
/// controllers, which `org.module.ts` (`org`) registers.
fn controllers_app(org: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "api", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    for i in 1..=20 {
        let c = format!("M{i:02}Controller");
        write(
            r,
            &format!("src/m{i:02}/m{i:02}.controller.ts"),
            &controller(&c),
        );
        write(
            r,
            &format!("src/m{i:02}/m{i:02}.module.ts"),
            &format!(
                "import {{ Module }} from \"@nestjs/common\";\nimport {{ {c} }} from \"./m{i:02}.controller\";\n\n@Module({{ controllers: [{c}] }})\nexport class M{i:02}Module {{}}\n"
            ),
        );
    }
    write(r, "src/org/org.controller.ts", &controller("OrgController"));
    write(
        r,
        "src/org/ee-org.controller.ts",
        &controller("EeOrgController"),
    );
    write(r, "src/org/org.module.ts", org);
    enable(r);
    dir
}

/// `controllers: [...getControllers()]` holds nothing Drift can read: it is kept
/// as an opaque list, so its family is unknown and never says "missing" (novu
/// `OrganizationModule`). Before, the list vanished from the facts.
#[test]
fn a_list_of_only_unreadable_spreads_makes_its_family_unknown() {
    let dir = controllers_app(
        "import { Module } from \"@nestjs/common\";\nimport { OrgController } from \"./org.controller\";\nimport { EeOrgController } from \"./ee-org.controller\";\n\nfunction getControllers() {\n  return [OrgController, EeOrgController];\n}\n\n@Module({ controllers: [...getControllers()] })\nexport class OrgModule {}\n",
    );
    let r = dir.path();
    let facts: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "facts", "src/org/org.module.ts"])).unwrap();
    assert_eq!(facts["registries"][0]["opaque"], true, "{facts:#?}");
    let c = census(r);
    let props = wiring_proposals(&c);
    assert!(
        props.iter().all(|p| p["outliers"]
            .as_array()
            .unwrap()
            .iter()
            .all(|o| o["symbol"] != "OrgController" && o["symbol"] != "EeOrgController")),
        "{props:#?}"
    );
    assert!(
        c["wiring"]["registries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["path"] == "" && x["status"] == "opaque"),
        "{:#?}",
        c["wiring"]["registries"]
    );
}

/// A `DynamicModule` returned by a module's static method
/// (`return { module: OrgModule, controllers: [OrgController] }`) registers like
/// the decorator's lists.
#[test]
fn dynamic_module_lists_register() {
    let dir = controllers_app(
        "import { DynamicModule, Module } from \"@nestjs/common\";\nimport { OrgController } from \"./org.controller\";\nimport { EeOrgController } from \"./ee-org.controller\";\n\n@Module({})\nexport class OrgModule {\n  static forRoot(ee: boolean): DynamicModule {\n    if (ee) {\n      return { module: OrgModule, controllers: [OrgController, EeOrgController] };\n    }\n    return { module: OrgModule, controllers: [OrgController] };\n  }\n}\n",
    );
    let r = dir.path();
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["evidence"]["holders"], 22);
    assert_eq!(props[0]["evidence"]["total"], 22);
    let id = props[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    clean(r);
}

/// A list spread into an outer list (`providers: [...USE_CASES, Extra]`): a member
/// the outer list names directly is provided, not an outlier of the inner list's
/// rule, and `check` agrees (novu `D-a060a7`).
#[test]
fn members_of_the_outer_list_count_for_an_inner_list() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "api", "dependencies": { "@nestjs/common": "10" } }"#,
    );
    let names: Vec<String> = (1..=11).map(|i| format!("Step{i:02}")).collect();
    let mut imports = String::new();
    let mut list = String::new();
    for n in &names {
        write(
            r,
            &format!("src/usecases/{}.usecase.ts", n.to_lowercase()),
            &format!(
                "import {{ Injectable }} from \"@nestjs/common\";\n\n@Injectable()\nexport class {n}UseCase {{\n  run() {{\n    return 1;\n  }}\n}}\n"
            ),
        );
        if n != "Step11" {
            imports.push_str(&format!(
                "import {{ {n}UseCase }} from \"./{}.usecase\";\n",
                n.to_lowercase()
            ));
            list.push_str(&format!("  {n}UseCase,\n"));
        }
    }
    write(
        r,
        "src/usecases/index.ts",
        &format!("{imports}\nexport const USE_CASES = [\n{list}];\n"),
    );
    write(
        r,
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { USE_CASES } from \"./usecases\";\nimport { Step11UseCase } from \"./usecases/step11.usecase\";\n\n@Module({ providers: [...USE_CASES, Step11UseCase] })\nexport class AppModule {}\n",
    );
    enable(r);
    let c = census(r);
    let inner: Vec<Value> = wiring_proposals(&c)
        .into_iter()
        .filter(|p| p["rule"]["slot"] == "binding:USE_CASES")
        .collect();
    assert_eq!(inner.len(), 1, "{:#?}", wiring_proposals(&c));
    assert_eq!(inner[0]["evidence"]["holders"], 11);
    assert!(inner[0]["outliers"].as_array().unwrap().is_empty());
    let id = inner[0]["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    clean(r);
}

/// A barrel re-exporting `n` widgets of `src/w/`, plus files with the given
/// names, each a function, not re-exported.
fn barrel_with(r: &Path, n: usize, left_out: &[&str]) {
    let mut index = String::new();
    for i in 0..n {
        write(
            r,
            &format!("src/w/w{i:02}.ts"),
            &format!("export function w{i:02}() {{\n  return {i};\n}}\n"),
        );
        index.push_str(&format!("export {{ w{i:02} }} from \"./w{i:02}\";\n"));
    }
    for f in left_out {
        write(
            r,
            &format!("src/w/{f}.ts"),
            &format!("export function {f}() {{\n  return 1;\n}}\n"),
        );
    }
    write(r, "src/w/index.ts", &index);
}

/// One internal helper next to forgotten exports does not make a barrel curated:
/// most of its outliers must be internal (cal.com's email templates, where
/// `BaseScheduledEmail` is internal and `OrganizerAddAttendeeEmail` forgotten).
#[test]
fn a_barrel_is_curated_only_when_most_outliers_are_internal() {
    // A published package: 31 exports, 2 forgotten, 1 internal helper.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "@acme/ui", "version": "1.0.0", "exports": "./src/w/index.ts" }"#,
    );
    barrel_with(r, 31, &["forgotA", "forgotB", "helper"]);
    write(
        r,
        "src/w/w00.ts",
        "import { helper } from \"./helper\";\nexport function w00() {\n  return helper();\n}\n",
    );
    enable(r);
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["outliers"].as_array().unwrap().len(), 3);
    // One forgotten, one internal: half is not most.
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", r#"{ "name": "emails" }"#);
    barrel_with(r, 18, &["OrganizerAddAttendeeEmail", "BaseScheduledEmail"]);
    write(
        r,
        "src/w/w00.ts",
        "import { BaseScheduledEmail } from \"./BaseScheduledEmail\";\nexport function w00() {\n  return BaseScheduledEmail();\n}\n",
    );
    enable(r);
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    let out: Vec<&str> = props[0]["outliers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["symbol"].as_str().unwrap())
        .collect();
    assert!(out.contains(&"OrganizerAddAttendeeEmail"), "{out:?}");
}

/// A sibling module counts only if the app has it: imported somewhere or
/// bootstrapped. `LostService`, provided by a `LostModule` nothing imports, is
/// reported; `GaugeService`, provided by an imported sibling, is not.
#[test]
fn a_module_nothing_imports_provides_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "app", "dependencies": { "@nestjs/common": "10", "@nestjs/core": "10" } }"#,
    );
    let mut imports = String::from("import { Module } from \"@nestjs/common\";\n");
    let mut providers = String::new();
    for n in SERVICES {
        write(r, &format!("src/runner/{n}.service.ts"), &service(n));
        imports.push_str(&format!(
            "import {{ {}Service }} from \"./{n}.service\";\n",
            cap(n)
        ));
        providers.push_str(&format!("{}Service, ", cap(n)));
    }
    write(
        r,
        "src/runner/handlers.module.ts",
        &format!(
            "{imports}\n@Module({{ providers: [{providers}] }})\nexport class HandlersModule {{}}\n"
        ),
    );
    write(
        r,
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { HandlersModule } from \"./runner/handlers.module\";\n\n@Module({ imports: [HandlersModule] })\nexport class AppModule {}\n",
    );
    write(
        r,
        "src/main.ts",
        "import { NestFactory } from \"@nestjs/core\";\nimport { AppModule } from \"./app.module\";\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.listen(3000);\n}\nbootstrap();\n",
    );
    enable(r);
    let props = wiring_proposals(&census(r));
    let rule = props
        .iter()
        .find(|p| p["role"]["file"] == "*.service")
        .unwrap_or_else(|| panic!("{props:#?}"));
    let id = rule["id"].as_str().unwrap().to_string();
    ok(r, &["--no-cache", "init"]);
    ok(r, &["review", "--show-to-agents", &id]);
    clean(r);
    // An imported sibling provides GaugeService; nothing imports LostModule.
    write(r, "src/runner/gauge/gauge.service.ts", &service("gauge"));
    write(
        r,
        "src/runner/gauge/gauge.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { GaugeService } from \"./gauge.service\";\n\n@Module({ providers: [GaugeService] })\nexport class GaugeModule {}\n",
    );
    write(r, "src/runner/lost/lost.service.ts", &service("lost"));
    write(
        r,
        "src/runner/lost/lost.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { LostService } from \"./lost.service\";\n\n@Module({ providers: [LostService] })\nexport class LostModule {}\n",
    );
    write(
        r,
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { HandlersModule } from \"./runner/handlers.module\";\nimport { GaugeModule } from \"./runner/gauge/gauge.module\";\n\n@Module({ imports: [HandlersModule, GaugeModule] })\nexport class AppModule {}\n",
    );
    let text = ok(r, &["--no-cache", "check"]);
    assert!(text.contains("LostService"), "{text}");
    assert!(!text.contains("GaugeService"), "{text}");
    // The fix is to import the lost module, not to provide the service twice.
    assert!(
        text.contains(
            "fix  import LostModule (src/runner/lost/lost.module.ts:4) from a reachable module"
        ),
        "{text}"
    );
    let v: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "check", "--format", "json"])).unwrap();
    assert_eq!(
        v["violations"][0]["wire"]["action"], "import_module",
        "{v:#?}"
    );
}

/// `@Module(getModuleConfig())`: the module's lists exist but cannot be read, so
/// each slot is an opaque list and the family is unknown (novu).
#[test]
fn a_module_built_by_a_call_makes_its_family_unknown() {
    let dir = controllers_app(
        "import { Module } from \"@nestjs/common\";\nimport { getModuleConfig } from \"./config\";\n\n@Module(getModuleConfig())\nexport class OrgModule {}\n",
    );
    let r = dir.path();
    write(
        r,
        "src/org/config.ts",
        "import { OrgController } from \"./org.controller\";\nimport { EeOrgController } from \"./ee-org.controller\";\n\nexport function getModuleConfig() {\n  return { controllers: [OrgController, EeOrgController] };\n}\n",
    );
    let facts: Value =
        serde_json::from_str(&ok(r, &["--no-cache", "facts", "src/org/org.module.ts"])).unwrap();
    let slots: Vec<&str> = facts["registries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["opaque"] == true)
        .map(|x| x["slot"].as_str().unwrap())
        .collect();
    assert_eq!(slots.len(), 4, "{facts:#?}");
    assert!(slots.contains(&"arg:pkg:@nestjs/common#Module@0:controllers"));
    let c = census(r);
    assert!(
        wiring_proposals(&c).is_empty(),
        "{:#?}",
        wiring_proposals(&c)
    );
}

/// A `DynamicModule` returned by a method of an exported object (not a class):
/// `export const DomainsModule = { forRoot() { return { module: Def, controllers:
/// [X] } } }` registers like `@Module({ controllers: [X] })` (novu).
#[test]
fn a_dynamic_module_returned_by_an_object_method_registers() {
    let dir = controllers_app(
        "import type { DynamicModule } from \"@nestjs/common\";\nimport { OrgController } from \"./org.controller\";\nimport { EeOrgController } from \"./ee-org.controller\";\nimport { OrgModuleDefinition } from \"./org.definition\";\n\nexport const OrgModule = {\n  forRoot(): DynamicModule {\n    return { module: OrgModuleDefinition, controllers: [OrgController, EeOrgController] };\n  },\n};\n",
    );
    let r = dir.path();
    write(
        r,
        "src/org/org.definition.ts",
        "import { Module } from \"@nestjs/common\";\n\n@Module({})\nexport class OrgModuleDefinition {}\n",
    );
    let props = wiring_proposals(&census(r));
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_eq!(props[0]["evidence"]["holders"], 22);
    assert!(props[0]["outliers"].as_array().unwrap().is_empty());
}

/// `include([...])` inside `urlpatterns` names the same views as `urlpatterns`:
/// one rule, on the inner list, not one per list (wger).
#[test]
fn nested_lists_for_one_role_give_one_rule() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"site\"\n");
    write(r, "gym/__init__.py", "");
    let mut views = String::new();
    let mut paths = String::new();
    for n in ["List", "Detail", "Create", "Update", "Delete", "Export"] {
        views.push_str(&format!("class Gym{n}View:\n    pass\n\n\n"));
        paths.push_str(&format!(
            "        path(\"{}/\", views.Gym{n}View.as_view()),\n",
            n.to_lowercase()
        ));
    }
    write(r, "gym/views/__init__.py", "");
    write(r, "gym/views/gym.py", &views);
    write(r, "gym/views/more.py", "class GymMoreView:\n    pass\n");
    write(r, "gym/views/other.py", "class GymOtherView:\n    pass\n");
    write(
        r,
        "gym/urls.py",
        &format!(
            "from django.urls import include, path\n\nfrom gym.views import gym as views\nfrom gym.views.more import GymMoreView\nfrom gym.views.other import GymOtherView\n\nurlpatterns = [\n    path(\"gym/\", include([\n{paths}        path(\"more/\", GymMoreView.as_view()),\n        path(\"other/\", GymOtherView.as_view()),\n    ])),\n]\n"
        ),
    );
    enable_python(r);
    let c = census(r);
    let props = wiring_proposals(&c);
    assert_eq!(props.len(), 1, "{props:#?}");
    assert_unique_ids(&c);
}
