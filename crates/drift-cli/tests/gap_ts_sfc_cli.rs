//! Single-file components through the CLI: `drift scan --json` lists a Vue
//! component in `listed_files`, `drift security` reads its risky operation, and
//! `drift census` mines exactly what it mines with the components left out of the
//! walk (as the measured build walked the repository). Before, no `.vue`,
//! `.svelte` or `.astro` file was walked.

use std::path::Path;
use std::process::Command;

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
        .env_remove("DRIFT_EXPERIMENTAL")
        .output()
        .unwrap();
    assert!(out.status.success(), "{args:?} failed: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

/// A small Vue application: services the components call, components, and a
/// `.ts` entry that imports one.
fn app(r: &Path) {
    write(r, "package.json", "{ \"name\": \"shop\" }");
    for i in 0..4 {
        write(
            r,
            &format!("src/services/item{i}.ts"),
            &format!(
                "import {{ http }} from '../http';\nexport function loadItem{i}(id: string) {{\n  return http.get(`/items/{i}/${{id}}`);\n}}\n"
            ),
        );
    }
    write(
        r,
        "src/http.ts",
        "export const http = { get: (u: string) => fetch(u) };\n",
    );
    write(
        r,
        "src/main.ts",
        "import App from './App.vue';\nexport function start() {\n  return App;\n}\n",
    );
    write(
        r,
        "src/App.vue",
        "<template><Item :id=\"id\" /></template>\n<script setup lang=\"ts\">\nimport Item from './Item.vue'\nimport { loadItem0 } from './services/item0'\nconst id = '1'\nloadItem0(id)\n</script>\n",
    );
    write(
        r,
        "src/Item.vue",
        "<script setup lang=\"ts\">\nconst props = defineProps<{ id: string; code: string }>()\nfunction run() {\n  return eval(props.code)\n}\n</script>\n<template><p @click=\"run\">{{ props.id }}</p></template>\n",
    );
    write(
        r,
        "src/Card.svelte",
        "<script lang=\"ts\">\n  import { loadItem1 } from './services/item1';\n  export let id: string;\n  loadItem1(id);\n</script>\n<p>{id}</p>\n",
    );
}

#[test]
fn scan_lists_components_and_security_reads_them() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    app(r);
    let facts: serde_json::Value =
        serde_json::from_str(&drift(r, &["--no-cache", "scan", "--json"])).unwrap();
    let paths = |key: &str| -> Vec<String> {
        facts[key]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|f| f["path"].as_str().unwrap().to_string())
                    .collect()
            })
            .unwrap_or_default()
    };
    assert_eq!(
        paths("listed_files"),
        ["src/App.vue", "src/Card.svelte", "src/Item.vue"]
    );
    assert!(paths("files").iter().all(|p| p.ends_with(".ts")));
    // The `.ts` import of the component resolves to it, and the component's own
    // imports resolve as any module's.
    let main = facts["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "src/main.ts")
        .unwrap();
    assert_eq!(main["imports"][0]["module"], "src/App.vue");
    let app = &facts["listed_files"][0];
    let modules: Vec<&str> = app["imports"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["module"].as_str().unwrap())
        .collect();
    assert!(modules.contains(&"src/Item.vue"), "{modules:?}");
    assert!(modules.contains(&"src/services/item0.ts"), "{modules:?}");

    let security: serde_json::Value =
        serde_json::from_str(&drift(r, &["--no-cache", "security", "--json"])).unwrap();
    let sinks = security["sinks"].as_array().unwrap();
    assert!(
        sinks
            .iter()
            .any(|s| s["path"] == "src/Item.vue" && s["kind"] == "eval" && s["line"] == 3),
        "{sinks:?}"
    );
}

#[test]
fn census_is_the_same_with_and_without_components() {
    let with = tempfile::tempdir().unwrap();
    app(with.path());
    let without = tempfile::tempdir().unwrap();
    app(without.path());
    // Left out of the walk, as the measured build left them out.
    write(without.path(), ".ignore", "*.vue\n*.svelte\n*.astro\n");
    for args in [
        &["--no-cache", "census", "--json"][..],
        &["--no-cache", "census"][..],
        &["--no-cache", "census", "--json", "--all", "--max", "1000"][..],
    ] {
        // The output names the root it read; nothing else may differ.
        let run = |r: &Path| {
            let canonical = r.canonicalize().unwrap();
            drift(r, args)
                .replace(&canonical.display().to_string(), "<root>")
                .replace(&r.display().to_string(), "<root>")
        };
        assert_eq!(run(with.path()), run(without.path()), "{args:?}");
    }
}
