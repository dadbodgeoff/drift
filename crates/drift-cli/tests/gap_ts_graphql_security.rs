//! `drift security --json` lists the operations of a GraphQL server outside NestJS:
//! each root field of the resolver map an Apollo Server is given is an entry point
//! of kind `graphql`, with its guard read as a route's is. A resolver that refuses
//! callers with no user in its context is guarded; one that checks nothing has no
//! guard; a field of another type (`User.posts`) is no entry point. The last
//! measured build listed none of them.

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

fn security(root: &Path) -> Value {
    let out = Command::new(&*BIN)
        .arg("--no-cache")
        .args(["security", "--json"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// The `graphql` entry points: `<method> <route>` -> `guarded`, `unknown` or `none`.
fn operations(v: &Value) -> BTreeMap<String, String> {
    v["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"].as_str() == Some("graphql"))
        .map(|e| {
            let has = |key: &str| e[key].as_array().is_some_and(|a| !a.is_empty());
            let verdict = match (has("guards"), has("opaque")) {
                (true, _) => "guarded",
                (false, true) => "unknown",
                (false, false) => "none",
            };
            (
                format!(
                    "{} {}",
                    e["method"].as_str().unwrap_or_default(),
                    e["route"].as_str().unwrap_or_default()
                ),
                verdict.to_string(),
            )
        })
        .collect()
}

const PACKAGE: &str =
    r#"{ "name": "api", "dependencies": { "@apollo/server": "4.10.0", "graphql": "16.8.1" } }"#;

const AUTH: &str = r#"
export function requireUser(resolver) {
  return (parent, args, context, info) => {
    if (!context.user) {
      throw new Error("Unauthorized");
    }
    return resolver(parent, args, context, info);
  };
}
"#;

const SERVER: &str = r#"
import { ApolloServer } from "@apollo/server";
import { requireUser } from "./auth";
import { db } from "./db";

const resolvers = {
  Query: {
    users: async () => db.user.findMany(),
  },
  Mutation: {
    deleteUser: requireUser(async (_parent, args) => db.user.delete({ where: { id: args.id } })),
    resetAll: async () => db.user.deleteMany({}),
  },
  User: {
    posts: (user) => db.post.findMany({ where: { authorId: user.id } }),
  },
};

export const server = new ApolloServer({ typeDefs: "type Query { users: [User] }", resolvers });
"#;

const DB: &str = r#"
import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
"#;

#[test]
fn security_lists_each_root_field_with_its_guard() {
    let dir = write(&[
        ("package.json", PACKAGE),
        ("src/auth.ts", AUTH),
        ("src/server.ts", SERVER),
        ("src/db.ts", DB),
    ]);
    let got = operations(&security(dir.path()));
    let want: BTreeMap<String, String> = [
        ("MUTATION Mutation.deleteUser", "guarded"),
        ("MUTATION Mutation.resetAll", "none"),
        ("QUERY Query.users", "none"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    assert_eq!(got, want);
}
