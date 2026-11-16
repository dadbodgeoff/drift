//! Practice readings added since the measured build, in the listed reading only
//! ([`drift_core::Listed`]): a call handed a schema beside the request's data
//! ([`drift_core::controls::PARSES_INPUT`]), a Nest pipe on a parameter decorator
//! ([`drift_core::controls::PIPES_INPUT`]), and a refusal handed to the continuation
//! on the branch where a value of the caller is absent
//! ([`drift_core::controls::REFUSES_WITHOUT`]). What mining reads is what the
//! measured build read. Also the requests and statuses a test file records
//! ([`drift_core::FileFacts::test_requests`], which mining does not read): Cypress's
//! `cy.visit` / `cy.request`, and a package assertion handed a status read and a
//! literal status (`assert.equal(res.status, 401)`).

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan};

const PACKAGE: &str = r#"{ "name": "app", "dependencies": { "express": "4.19.2", "zod": "3.23.8", "@conform-to/zod": "1.1.5", "@nestjs/common": "10.3.0" } }"#;

fn repo(files: &[(&str, &str)]) -> RepoFacts {
    let dir = tempfile::tempdir().expect("tempdir");
    for (path, text) in files {
        let p = dir.path().join(path);
        fs::create_dir_all(p.parent().unwrap_or(Path::new("."))).expect("mkdir");
        fs::write(p, text).expect("write");
    }
    scan(
        dir.path(),
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .expect("scan")
    .0
}

/// Every control of every symbol of `path` that starts with `prefix`.
fn controls(r: &RepoFacts, path: &str, prefix: &str) -> Vec<String> {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
        .symbols
        .iter()
        .flat_map(|s| s.controls.iter())
        .filter(|c| c.starts_with(prefix))
        .cloned()
        .collect()
}

const PARSED: &str = r#"
import express from "express";
import { z } from "zod";
import { parseWithZod } from "@conform-to/zod";

const LoginSchema = z.object({ username: z.string() });
const app = express();

app.post("/login", (req, res) => {
  const submission = parseWithZod(req.body, { schema: LoginSchema });
  res.json(submission);
});

app.post("/echo", (req, res) => {
  const copy = Object.assign({}, req.body);
  res.json(copy);
});
"#;

#[test]
fn a_call_handed_a_schema_and_the_request_is_listed() {
    let r = repo(&[("package.json", PACKAGE), ("src/app.ts", PARSED)]);
    let prefix = drift_core::controls::PARSES_INPUT;
    assert!(controls(&r, "src/app.ts", prefix).is_empty());
    let listed = r.listed();
    let got = controls(&listed, "src/app.ts", prefix);
    assert!(
        got.iter()
            .any(|c| c.contains("parseWithZod") && c.ends_with("#LoginSchema")),
        "{got:?}"
    );
    // A global's call is no parse: nothing names what `Object.assign` checks.
    assert!(!got.iter().any(|c| c.contains("assign")), "{got:?}");
}

const PIPED: &str = r#"
import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";

@Controller("schedules")
export class SchedulesController {
  @Get(":id")
  one(@Param("id", ParseIntPipe) id: number) {
    return id;
  }

  @Get(":slug/plain")
  plain(@Param("slug") slug: string) {
    return slug;
  }
}
"#;

#[test]
fn a_pipe_on_a_parameter_decorator_is_listed() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/schedules.controller.ts", PIPED),
    ]);
    let path = "src/schedules.controller.ts";
    let prefix = drift_core::controls::PIPES_INPUT;
    assert!(controls(&r, path, prefix).is_empty());
    let listed = r.listed();
    let got = controls(&listed, path, prefix);
    assert_eq!(got.len(), 1, "{got:?}");
    assert!(got[0].ends_with("#ParseIntPipe"), "{got:?}");
}

const USERS: &str = r#"
export const users = new Map<string, { id: string }>();
"#;

const REFUSED: &str = r#"
import { users } from "./users";

export function updateProfile() {
  return (req, res, next) => {
    const user = users.get(req.cookies.token);
    if (!user) {
      return next(new Error("Blocked illegal activity"));
    }
    res.json(user);
  };
}

export function skipped() {
  return (req, res, next) => {
    const user = users.get(req.cookies.token);
    if (!user) {
      return next("route");
    }
    res.json(user);
  };
}
"#;

#[test]
fn an_error_handed_to_the_continuation_is_a_refusal_in_the_listed_reading() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/users.ts", USERS),
        ("src/profile.ts", REFUSED),
    ]);
    let prefix = drift_core::controls::REFUSES_WITHOUT;
    let path = "src/profile.ts";
    assert!(controls(&r, path, prefix).is_empty());
    let listed = r.listed();
    let file = listed
        .files
        .iter()
        .find(|f| f.path == path)
        .expect("src/profile.ts scanned");
    let of = |name: &str| -> Vec<&String> {
        file.symbols
            .iter()
            .filter(|s| s.name == name)
            .flat_map(|s| s.controls.iter())
            .filter(|c| c.starts_with(prefix))
            .collect()
    };
    // `users.get(req.cookies.token)` looks the caller up by the credential the
    // request carries (`credential_identity`, older than this reading): the value
    // is the caller's own, so the branch is a check of the caller's own body, read
    // exactly as `throw new Error(...)` in its place is (an `unauthenticated` body
    // check and `rejects_caller`), not a refusal for what a callee gave.
    let sym = |name: &str| {
        file.symbols
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name}: {:?}", file.symbols))
    };
    let update = sym("updateProfile");
    assert!(
        update
            .body_checks
            .iter()
            .any(|b| b.outcome == drift_core::CheckOutcome::Unauthenticated
                && b.source == "src/users.ts#users.get"),
        "{update:?}"
    );
    assert!(
        update
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REJECTS_CALLER),
        "{update:?}"
    );
    assert!(of("updateProfile").is_empty(), "{:?}", of("updateProfile"));
    // `next("route")` skips to another route: it refuses no one.
    let skipped = sym("skipped");
    assert!(of("skipped").is_empty(), "{:?}", of("skipped"));
    assert!(skipped.body_checks.is_empty(), "{skipped:?}");
    assert!(
        !skipped
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REJECTS_CALLER),
        "{skipped:?}"
    );
    // What mining reads has neither: the continuation is read since then.
    let mined = r.files.iter().find(|f| f.path == path).unwrap();
    for s in &mined.symbols {
        assert!(s.body_checks.is_empty(), "{s:?}");
        assert!(
            !s.controls
                .iter()
                .any(|c| c == drift_core::controls::REJECTS_CALLER),
            "{s:?}"
        );
    }
}

/// The same continuation where the value is what a callee gave for a value that is
/// no credential (`users.get(req.params.id)`): whether that is who calls is said
/// where the callee is read, as [`drift_core::controls::REFUSES_WITHOUT`], in the
/// listed reading only.
#[test]
fn an_error_handed_to_the_continuation_for_a_value_a_callee_gave_refuses_without_it() {
    let given = REFUSED.replace("req.cookies.token", "req.params.id");
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/users.ts", USERS),
        ("src/profile.ts", given.as_str()),
    ]);
    let prefix = drift_core::controls::REFUSES_WITHOUT;
    let path = "src/profile.ts";
    assert!(controls(&r, path, prefix).is_empty());
    let listed = r.listed();
    let file = listed
        .files
        .iter()
        .find(|f| f.path == path)
        .expect("src/profile.ts scanned");
    let of = |name: &str| -> Vec<&String> {
        file.symbols
            .iter()
            .filter(|s| s.name == name)
            .flat_map(|s| s.controls.iter())
            .filter(|c| c.starts_with(prefix))
            .collect()
    };
    assert_eq!(
        of("updateProfile"),
        [&format!("{prefix}src/users.ts#users.get")],
        "{:?}",
        file.symbols
    );
    assert!(of("skipped").is_empty(), "{:?}", of("skipped"));
}

const CYPRESS: &str = r#"
describe("allocations", () => {
  it("shows a page", () => {
    cy.visit("/allocations");
  });
  it("posts", () => {
    cy.request("POST", "/login");
    cy.request({ method: "PUT", url: "/profile" });
    cy.request("/status");
  });
});
"#;

const ASSERTED: &str = r#"
import assert from "node:assert/strict";
import request from "supertest";
import { it } from "node:test";

const app = {};

it("refuses", async () => {
  const res = await request(app).get("/rest/basket");
  assert.equal(res.status, 401);
});

it("reversed", async () => {
  const res = await request(app).post("/rest/user/login");
  assert.strictEqual(200, res.statusCode);
});

it("negated", async () => {
  const res = await request(app).get("/rest/admin");
  assert.notEqual(res.status, 500);
});
"#;

#[test]
fn cypress_requests_and_package_assertions_are_recorded() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("cypress/e2e/pages.cy.ts", CYPRESS),
        ("test/api/basket.test.ts", ASSERTED),
    ]);
    let requests = |path: &str| -> Vec<String> {
        let f = r
            .files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("{path} not scanned"));
        let mut out: Vec<String> = f
            .test_requests
            .iter()
            .map(|t| format!("{} {} {:?}", t.method, t.route, t.statuses))
            .collect();
        out.sort();
        out
    };
    assert_eq!(
        requests("cypress/e2e/pages.cy.ts"),
        [
            "GET /allocations []",
            "GET /status []",
            "POST /login []",
            "PUT /profile []",
        ]
    );
    assert_eq!(
        requests("test/api/basket.test.ts"),
        [
            "GET /rest/admin []",
            "GET /rest/basket [401]",
            "POST /rest/user/login [200]",
        ]
    );
}
