//! `drift security --json` lists the root fields of a Python GraphQL schema as entry
//! points, `MUTATION Mutation.<field>` as it lists a NestJS resolver, each with what
//! guards it: a strawberry permission class is named and its verdict unknown (it is
//! the library's own check, whose answer Drift does not read), a mutation with none
//! is listed without a guard where the route serving the schema was read, and a
//! sign-in wrapper around the serving view guards every field. A field of a type that
//! is no root is not listed.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn repo(files: &[(&str, &str)]) -> tempfile::TempDir {
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

/// `(guards, opaque)` of the entry point `METHOD route`.
fn entry(inv: &Value, method: &str, route: &str) -> (Vec<String>, Vec<String>) {
    let e = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["route"] == route && e["method"] == method)
        .unwrap_or_else(|| panic!("no entry point {method} {route}: {:#}", inv["entry_points"]));
    let list = |k: &str| -> Vec<String> {
        e[k].as_array()
            .map(|a| a.iter().map(|x| x.as_str().unwrap().to_string()).collect())
            .unwrap_or_default()
    };
    (list("guards"), list("opaque"))
}

const TYPES: &str = r#"import strawberry
from strawberry.permission import BasePermission
from strawberry.types import Info


class IsAuthenticated(BasePermission):
    message = "Not signed in"

    def has_permission(self, source, info: Info, **kwargs) -> bool:
        return info.context.request.user.is_authenticated


@strawberry.type
class Post:
    title: str

    @strawberry.field
    def author(self) -> str:
        return "someone"


@strawberry.type
class Query:
    @strawberry.field
    def posts(self) -> list[Post]:
        return []


@strawberry.type
class Mutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    def delete_user(self, info: Info, user_id: int) -> bool:
        return True

    @strawberry.mutation
    def create_user(self, name: str) -> bool:
        return True
"#;

const SCHEMA: &str = "import strawberry\n\nfrom app.types import Mutation, Query\n\nschema = strawberry.Schema(query=Query, mutation=Mutation)\n";

#[test]
fn security_lists_graphql_mutations_with_their_guards() {
    let dir = repo(&[
        ("pyproject.toml", "[project]\nname = \"fx\"\n"),
        ("app/__init__.py", ""),
        ("app/types.py", TYPES),
        ("app/schema.py", SCHEMA),
        (
            "app/urls.py",
            "from django.urls import path\nfrom strawberry.django.views import GraphQLView\n\nfrom app.schema import schema\n\nurlpatterns = [path(\"graphql/\", GraphQLView.as_view(schema=schema))]\n",
        ),
    ]);
    let inv = security(dir.path());
    let (guards, opaque) = entry(&inv, "MUTATION", "Mutation.delete_user");
    assert!(guards.is_empty(), "{guards:?}");
    assert!(
        opaque.iter().any(|o| o.contains("IsAuthenticated")),
        "the permission class is named, its verdict unknown: {opaque:?}"
    );
    assert_eq!(
        entry(&inv, "MUTATION", "Mutation.create_user"),
        (vec![], vec![]),
        "no guard"
    );
    entry(&inv, "QUERY", "Query.posts");
    let routes: Vec<&str> = inv["entry_points"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["route"].as_str())
        .collect();
    assert!(!routes.contains(&"Post.author"), "{routes:?}");

    // The serving view behind Django's sign-in wrapper: every field is guarded by it.
    let dir = repo(&[
        ("pyproject.toml", "[project]\nname = \"fx\"\n"),
        ("app/__init__.py", ""),
        ("app/types.py", TYPES),
        ("app/schema.py", SCHEMA),
        (
            "app/urls.py",
            "from django.contrib.auth.decorators import login_required\nfrom django.urls import path\nfrom strawberry.django.views import GraphQLView\n\nfrom app.schema import schema\n\nurlpatterns = [path(\"graphql/\", login_required(GraphQLView.as_view(schema=schema)))]\n",
        ),
    ]);
    let inv = security(dir.path());
    let (guards, _) = entry(&inv, "MUTATION", "Mutation.create_user");
    assert!(
        guards.iter().any(|g| g.contains("login_required")),
        "{guards:?}"
    );
}
