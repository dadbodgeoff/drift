//! Precision of `drift security` (eval/security/2026-11-07): what an entry point
//! reaches, which files are Next.js entry points, which calls are risky operations,
//! and which env reads reach the browser.
//!
//! - A call of one method of a class runs that method, not every method of the class
//!   (`storage.delete()` does not reach the `fetch(url)` in `storage.fetchFile`;
//!   `PromotionRule.objects.filter()` does not reach a raw query in another method).
//! - `src/pages/Login.tsx` in a package built with Vite is no Next.js page.
//! - `axios.isAxiosError(e)`, `fetch(\`http://localhost:${port}/x\`)`,
//!   `execSync("git --version")`, Hono's `c.redirect("/done", 302)`,
//!   `Markup(escape(body))` and `os.system("clear")` are not risky operations.
//! - A `"use client"` file's env read on the server side of `typeof window` is no leak.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_mine::security::{Inventory, inventory};

fn write(root: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let p = root.join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
}

fn ts(files: &[(&str, &str)]) -> (RepoFacts, Inventory) {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), files);
    let (facts, _) = drift_ts::scan(
        dir.path(),
        &drift_ts::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let inv = inventory(&facts);
    (facts, inv)
}

fn py(files: &[(&str, &str)]) -> (RepoFacts, Inventory) {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), files);
    let (facts, _) = drift_py::scan(
        dir.path(),
        &drift_py::ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap();
    let inv = inventory(&facts);
    (facts, inv)
}

/// The sink kinds the entry point `symbol` reaches.
fn reaches(inv: &Inventory, symbol: &str) -> Vec<String> {
    let e = inv
        .entry_points
        .iter()
        .find(|e| e.symbol == symbol)
        .unwrap_or_else(|| panic!("no entry point {symbol}: {:?}", inv.entry_points));
    e.reaches.iter().map(|r| r.kind.clone()).collect()
}

fn sinks_of(facts: &RepoFacts, path: &str, symbol: &str) -> Vec<String> {
    facts
        .files
        .iter()
        .find(|f| f.path == path)
        .and_then(|f| f.symbols.iter().find(|s| s.name == symbol))
        .unwrap_or_else(|| panic!("no {path}#{symbol}"))
        .sinks
        .clone()
}

const NEXT_PKG: (&str, &str) = (
    "package.json",
    r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }"#,
);

const STORAGE: (&str, &str) = (
    "lib/storage.ts",
    r#"export class StorageClient {
  async delete(key: string) {
    return this.remove(key);
  }
  async remove(key: string) {
    return key.length;
  }
  async fetchFile(url: string) {
    return fetch(url);
  }
  async download(url: string) {
    return this.fetchFile(url);
  }
}
export const storage = new StorageClient();
"#,
);

#[test]
fn a_method_call_reaches_only_that_method() {
    let (facts, inv) = ts(&[
        NEXT_PKG,
        STORAGE,
        (
            "app/api/delete/route.ts",
            "import { storage } from \"../../../lib/storage\";\nexport async function POST(req: Request) {\n  await storage.delete(await req.text());\n  return new Response();\n}\n",
        ),
        (
            "app/api/fetch/route.ts",
            "import { storage } from \"../../../lib/storage\";\nexport async function GET(req: Request) {\n  await storage.download(await req.text());\n  return new Response();\n}\n",
        ),
    ]);
    // The class's own facts still hold every method together.
    assert_eq!(
        sinks_of(&facts, "lib/storage.ts", "StorageClient"),
        ["dynamic_fetch"]
    );
    let class = facts.files[..]
        .iter()
        .find(|f| f.path == "lib/storage.ts")
        .and_then(|f| f.symbols.iter().find(|s| s.name == "StorageClient"))
        .unwrap();
    let names: Vec<&str> = class.members.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["delete", "download", "fetchFile", "remove"]);
    let download = class.members.iter().find(|m| m.name == "download").unwrap();
    assert_eq!(download.calls, ["lib/storage.ts#StorageClient.fetchFile"]);
    // `storage.delete()` runs `delete` and `remove`: no fetch.
    assert!(reaches(&inv, "POST").is_empty(), "{:?}", inv.entry_points);
    // `storage.download()` calls `this.fetchFile()`, which fetches.
    assert_eq!(reaches(&inv, "GET"), ["dynamic_fetch"]);
    let get = inv.entry_points.iter().find(|e| e.symbol == "GET").unwrap();
    assert_eq!(
        get.reaches[0].via,
        [
            "app/api/fetch/route.ts#GET",
            "lib/storage.ts#StorageClient.download",
            "lib/storage.ts#StorageClient.fetchFile"
        ]
    );
}

#[test]
fn a_nest_service_method_reaches_only_that_method() {
    let (_, inv) = ts(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0" } }"#,
        ),
        (
            "src/billing.service.ts",
            "export class BillingService {\n  count() {\n    return 1;\n  }\n  sync(url: string) {\n    return fetch(url);\n  }\n}\n",
        ),
        (
            "src/rules.service.ts",
            "import { BillingService } from \"./billing.service\";\nexport class RulesService {\n  constructor(private readonly billing: BillingService) {}\n  remove() {\n    return this.billing.count();\n  }\n  refresh(url: string) {\n    return this.billing.sync(url);\n  }\n}\n",
        ),
        (
            "src/rules.controller.ts",
            "import { Controller, Delete, Post, Body } from \"@nestjs/common\";\nimport { RulesService } from \"./rules.service\";\n@Controller(\"rules\")\nexport class RulesController {\n  constructor(private readonly rules: RulesService) {}\n  @Delete()\n  remove() {\n    return this.rules.remove();\n  }\n  @Post()\n  refresh(@Body() url: string) {\n    return this.rules.refresh(url);\n  }\n}\n",
        ),
    ]);
    assert!(
        reaches(&inv, "DELETE /rules").is_empty(),
        "{:?}",
        inv.entry_points
    );
    assert_eq!(reaches(&inv, "POST /rules"), ["dynamic_fetch"]);
}

#[test]
fn python_method_calls_reach_only_that_method() {
    let (_, inv) = py(&[
        (
            "pyproject.toml",
            "[project]\nname = \"shop\"\ndependencies = [\"django\", \"requests\"]\n",
        ),
        (
            "shop/models.py",
            "from django.db import connection, models\n\n\nclass PromotionRule(models.Model):\n    name = models.CharField(max_length=10)\n\n    @staticmethod\n    def next_ids(n):\n        with connection.cursor() as cursor:\n            cursor.execute(f\"SELECT nextval('seq') FROM generate_series(1, {n})\")\n\n    @classmethod\n    def allocate(cls, n):\n        return cls.next_ids(n)\n",
        ),
        (
            "shop/views.py",
            "from django.http import JsonResponse\n\nfrom .models import PromotionRule\n\n\ndef rules(request):\n    return JsonResponse({\"n\": PromotionRule.objects.filter(name=request.GET[\"q\"]).count()})\n\n\ndef allocate(request):\n    PromotionRule.allocate(int(request.GET[\"n\"]))\n    return JsonResponse({})\n",
        ),
        (
            "shop/urls.py",
            "from django.urls import path\n\nfrom . import views\n\nurlpatterns = [\n    path(\"rules/\", views.rules),\n    path(\"allocate/\", views.allocate),\n]\n",
        ),
    ]);
    // `PromotionRule.objects` is the model's manager, no method of the class.
    assert!(reaches(&inv, "rules").is_empty(), "{:?}", inv.entry_points);
    // `allocate` calls `cls.next_ids`, which builds SQL by interpolation.
    assert_eq!(reaches(&inv, "allocate"), ["sql_string_interpolation"]);
}

#[test]
fn pages_of_a_package_not_built_with_next_are_not_entry_points() {
    let page = "export default function Login() {\n  return <div dangerouslySetInnerHTML={{ __html: \"x\" }} />;\n}\n";
    let (_, inv) = ts(&[
        (
            "package.json",
            r#"{ "name": "root", "private": true, "devDependencies": { "prettier": "3.0.0" } }"#,
        ),
        (
            "frontend/package.json",
            r#"{ "name": "spa", "dependencies": { "react": "18.0.0", "vite": "5.0.0" } }"#,
        ),
        ("frontend/src/pages/Login.tsx", page),
        (
            "frontend/app/api/x/route.ts",
            "export async function GET() {\n  return new Response();\n}\n",
        ),
        (
            "web/package.json",
            r#"{ "name": "web", "dependencies": { "next": "15.0.0" } }"#,
        ),
        ("web/pages/login.tsx", page),
        // A server action says so itself, in any package.
        (
            "frontend/src/actions.ts",
            "\"use server\";\nexport async function save(x: string) {\n  return x;\n}\n",
        ),
        // A manifest with no dependencies says nothing about the framework.
        ("bare/package.json", r#"{ "name": "bare" }"#),
        (
            "bare/app/api/y/route.ts",
            "export async function POST() {\n  return new Response();\n}\n",
        ),
    ]);
    let paths: Vec<(&str, &str)> = inv
        .entry_points
        .iter()
        .map(|e| (e.path.as_str(), e.kind.as_str()))
        .collect();
    assert_eq!(
        paths,
        [
            ("bare/app/api/y/route.ts", "http"),
            ("frontend/src/actions.ts", "server_action"),
            ("web/pages/login.tsx", "page"),
        ]
    );
}

#[test]
fn a_next_config_makes_a_package_next() {
    let (_, inv) = ts(&[
        (
            "package.json",
            r#"{ "name": "web", "dependencies": { "react": "18.0.0" } }"#,
        ),
        ("next.config.mjs", "export default {};\n"),
        (
            "app/page.tsx",
            "export default function Home() {\n  return null;\n}\n",
        ),
    ]);
    assert_eq!(inv.entry_points.len(), 1, "{:?}", inv.entry_points);
}

#[test]
fn safe_forms_of_typescript_calls_are_not_sinks() {
    let (facts, _) = ts(&[
        NEXT_PKG,
        (
            "lib/calls.ts",
            r#"import axios from "axios";
import { execSync } from "child_process";
import { Hono } from "hono";
const PORT = 4983;
export function helpers(e: unknown) {
  return axios.isAxiosError(e);
}
export function client(url: string) {
  return axios.get(url);
}
export function local(port: number) {
  return fetch(`http://localhost:${port}/api/notify`);
}
export function host(h: string) {
  return fetch(`http://${h}:80/api`);
}
export function version() {
  return execSync("git --version").toString().trim();
}
export function run(cmd: string) {
  return execSync(`git ${cmd}`).toString();
}
const app = new Hono();
app.get("/done", (c) => c.redirect("/finished", 302));
app.get("/back", (c) => c.redirect(c.req.query("to") ?? "/", 302));
export function express(res: any, to: string) {
  return res.redirect(302, to);
}
"#,
        ),
    ]);
    let s = |n: &str| sinks_of(&facts, "lib/calls.ts", n);
    assert!(s("helpers").is_empty(), "{:?}", s("helpers"));
    assert_eq!(s("client"), ["dynamic_fetch"]);
    assert!(s("local").is_empty(), "{:?}", s("local"));
    assert_eq!(s("host"), ["dynamic_fetch"]);
    assert!(s("version").is_empty(), "{:?}", s("version"));
    assert_eq!(s("run"), ["shell_exec"]);
    assert!(s("GET /done").is_empty(), "{:?}", s("GET /done"));
    assert_eq!(s("GET /back"), ["dynamic_redirect"]);
    assert_eq!(s("express"), ["dynamic_redirect"]);
}

#[test]
fn safe_forms_of_python_calls_are_not_sinks() {
    let (facts, _) = py(&[
        (
            "pyproject.toml",
            "[project]\nname = \"svc\"\ndependencies = [\"requests\", \"markupsafe\"]\n",
        ),
        (
            "svc/calls.py",
            r#"import os
import subprocess

import requests
from markupsafe import Markup, escape


def linkify(body, url):
    return Markup(escape(body)) + Markup(f'<a href="{escape(url)}">{escape(url)}</a>')


def raw(body):
    return Markup(f"<b>{body}</b>")


def clear():
    os.system("clear")


def run(cmd):
    os.system(cmd)
    subprocess.run(f"git {cmd}", shell=True)


def local(port):
    return requests.get(f"http://localhost:{port}/health")


def remote(host):
    return requests.get(f"http://{host}:80/health")
"#,
        ),
    ]);
    let s = |n: &str| sinks_of(&facts, "svc/calls.py", n);
    assert!(s("linkify").is_empty(), "{:?}", s("linkify"));
    assert_eq!(s("raw"), ["raw_html"]);
    assert!(s("clear").is_empty(), "{:?}", s("clear"));
    assert_eq!(s("run"), ["shell_exec"]);
    assert!(s("local").is_empty(), "{:?}", s("local"));
    assert_eq!(s("remote"), ["dynamic_fetch"]);
}

#[test]
fn env_reads_on_the_server_side_of_a_client_file_do_not_leak() {
    let (_, inv) = ts(&[
        NEXT_PKG,
        (
            "app/trpc.ts",
            r#""use client";
export const url =
  typeof window !== "undefined"
    ? "/api/trpc"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/trpc`
      : "http://localhost:3000/api/trpc";
export function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.APP_HOST) return `https://${process.env.APP_HOST}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
export function serverOnly() {
  if (typeof window === "undefined") {
    return process.env.INTERNAL_URL;
  }
  return "";
}
export function leaky() {
  return process.env.SECRET_KEY;
}
"#,
        ),
    ]);
    let leaked: Vec<&str> = inv
        .client_leaks
        .iter()
        .map(|g| g.reaches.as_str())
        .collect();
    assert_eq!(leaked, ["env:SECRET_KEY"]);
    // The inventory of env reads still lists them all.
    for v in [
        "process.env.VERCEL_URL",
        "process.env.APP_HOST",
        "process.env.PORT",
        "process.env.INTERNAL_URL",
        "process.env.SECRET_KEY",
    ] {
        assert!(inv.env.contains_key(v), "{v}: {:?}", inv.env);
    }
}
