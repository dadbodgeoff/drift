//! TypeScript tenant scoping, end to end: `drift practices --json` reads a route
//! whose only authorization is a query filtered by the tenant the request names
//! (`where: { orgId: req.params.orgId }`) as `tenancy_requested`, and says the key
//! is unscoped (`unscoped_key`), as it does for the same Python route; `drift
//! security --write-baseline` holds the finding as `unscoped-key`, a kind that
//! advises first, read since inventory 3.
//!
//! The twins that must not be said: the same query by the caller's tenant (a claim
//! of the verified token), the same lookup followed by a check of the row's tenant
//! against the caller's, and a query a class method makes with what its caller
//! passed (not followed: unknown, never unscoped).

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

const PACKAGE: &str = "{ \"name\": \"api\", \"dependencies\": { \"express\": \"4.19.0\", \"@prisma/client\": \"5.20.0\", \"jsonwebtoken\": \"9.0.0\" } }\n";

const SERVER: &str = r#"import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { Projects } from "./projects";
const prisma = new PrismaClient();
const projects = new Projects();
const app = express();
function requireUser(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  req.user = jwt.verify(token, process.env.JWT_KEY);
  next();
}
app.get("/orgs/:orgId/projects", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { orgId: req.params.orgId } }));
});
app.get("/mine/projects", requireUser, async (req, res) => {
  res.json(await prisma.project.findMany({ where: { orgId: req.user.orgId } }));
});
app.get("/orgs/:orgId/checked", requireUser, async (req, res) => {
  const rows = await prisma.project.findMany({ where: { orgId: req.params.orgId } });
  if (req.params.orgId !== req.user.orgId) return res.status(403).json({ error: "forbidden" });
  res.json(rows);
});
app.get("/orgs/:orgId/service", requireUser, async (req, res) => {
  res.json(await projects.list(req.params.orgId));
});
"#;

const PROJECTS: &str = r#"import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export class Projects {
  async list(orgId: string) {
    return prisma.project.findMany({ where: { orgId } });
  }
}
"#;

fn app() -> tempfile::TempDir {
    write(&[
        ("package.json", PACKAGE),
        ("src/server.ts", SERVER),
        ("src/projects.ts", PROJECTS),
    ])
}

/// Each authz unit by its route: its assignment and its uses.
fn authz(map: &Value) -> BTreeMap<String, (String, Vec<String>)> {
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .unwrap();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let uses = u["uses"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect();
            (
                u["route"].as_str().unwrap_or_default().to_string(),
                (u["assignment"].as_str().unwrap().to_string(), uses),
            )
        })
        .collect()
}

/// Pins the practice map's reading: the tenant the request names is
/// `tenancy_requested`, and the one route that does nothing else takes an
/// unscoped key; the caller's tenant is the route's filter, a check of the row
/// after the read is the route's check, and a class method's query is unknown.
#[test]
fn practices_read_the_tenant_a_typescript_request_names() {
    let dir = app();
    let (code, out, err) = drift(dir.path(), &["practices", "--json", "--units"]);
    assert_eq!(code, 0, "{err}");
    let map: Value = serde_json::from_str(&out).unwrap();
    let got = authz(&map);
    let (said, uses) = &got["/orgs/:orgId/projects"];
    assert_eq!(said, "known", "{got:?}");
    assert_eq!(uses, &["tenancy_requested:where.orgId (param)"], "{got:?}");
    assert_eq!(
        got["/mine/projects"].1,
        ["tenancy_filter:where.orgId (session)"],
        "{got:?}"
    );
    assert!(
        got["/orgs/:orgId/checked"]
            .1
            .iter()
            .any(|u| u.starts_with("tenancy_check:")),
        "{got:?}"
    );
    assert_eq!(got["/orgs/:orgId/service"].0, "unknown", "{got:?}");

    let unscoped: Vec<(String, Vec<String>)> = map["findings"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["kind"] == "unscoped_key")
        .map(|f| {
            (
                f["key"].as_str().unwrap().to_string(),
                f["examples"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e["symbol"].as_str().unwrap().to_string())
                    .collect(),
            )
        })
        .collect();
    assert_eq!(
        unscoped,
        [(
            "orgId".to_string(),
            vec!["GET /orgs/:orgId/projects".to_string()]
        )],
        "{:#?}",
        map["findings"]
    );
}

/// Pins the security baseline: the finding is held as `unscoped-key` for that
/// route alone, the kind advises (it is not on the `# fail:` line), and a finding of
/// it is read since inventory 3, so a baseline an older Drift wrote does not fail on
/// one this reading adds to code that did not change.
#[test]
fn the_security_baseline_holds_the_typescript_unscoped_key() {
    let dir = app();
    let (code, _, err) = drift(dir.path(), &["security", "--write-baseline"]);
    assert_eq!(code, 0, "{err}");
    let lock = std::fs::read_to_string(dir.path().join(".drift/security.lock")).unwrap();
    let keys: Vec<&str> = lock
        .lines()
        .filter_map(|l| l.strip_prefix("unscoped-key\t"))
        .collect();
    assert_eq!(keys.len(), 1, "{lock}");
    assert!(
        keys[0].contains("GET /orgs/:orgId/projects takes orgId"),
        "{lock}"
    );
    let fail = lock
        .lines()
        .find_map(|l| l.strip_prefix("# fail: "))
        .unwrap_or_default();
    assert!(!fail.split(',').any(|k| k == "unscoped-key"), "{lock}");
    assert_eq!(drift_mine::ratchet::found_since("unscoped-key", keys[0]), 3);
}
