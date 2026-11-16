//! GraphQL entry points in Python (strawberry, graphene, ariadne): every resolver of a
//! root field of a schema Drift ties to its root types is an entry point of kind
//! `graphql`, `<OPERATION> <root type>.<field>` as a NestJS resolver is, with its
//! guards (the field's permission classes, the decorators of the resolver, what the
//! route serving the schema gives) and its typed inputs. Pins, for each library: the
//! roots are defined in another file than the schema, a guarded and an unguarded
//! mutation are both listed, a resolver of a type that is no root is not, and all of
//! it is in the listed reading only (what mining reads is as it was).

use std::path::Path;

use drift_core::{FileFacts, RepoFacts, WrapKind};
use drift_py::{ScanOptions, scan};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scanned(r: &Path) -> RepoFacts {
    scan(
        r,
        &ScanOptions {
            cache_dir: None,
            threads: 1,
        },
    )
    .unwrap()
    .0
}

fn file<'a>(repo: &'a RepoFacts, path: &str) -> &'a FileFacts {
    repo.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("no file {path}"))
}

/// `METHOD route symbol adapter` of each `graphql` entry point of `path`, sorted.
fn graphql(repo: &RepoFacts, path: &str) -> Vec<String> {
    let mut out: Vec<String> = file(repo, path)
        .entry_points
        .iter()
        .filter(|e| e.kind == "graphql")
        .map(|e| {
            format!(
                "{} {} {} {}",
                e.method.as_deref().unwrap_or("-"),
                e.route.as_deref().unwrap_or("-"),
                e.symbol,
                e.adapter
            )
        })
        .collect();
    out.sort();
    out
}

/// What mining reads has no GraphQL entry point, and no resolver method symbol.
fn mining_unchanged(repo: &RepoFacts, paths: &[&str]) {
    for p in paths {
        let f = file(repo, p);
        assert!(
            f.entry_points.iter().all(|e| e.kind != "graphql"),
            "{p}: {:?}",
            f.entry_points
        );
    }
}

/// The wraps of `symbol` in `path`, `kind wrapper`, as the listed reading has them.
fn wraps(repo: &RepoFacts, path: &str, symbol: &str) -> Vec<String> {
    let f = file(repo, path);
    let s = f
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no symbol {symbol} in {path}"));
    s.wraps
        .iter()
        .map(|w| format!("{:?} {}", w.kind, w.wrapper))
        .collect()
}

fn mount<'a>(repo: &'a RepoFacts, path: &str, route: &str) -> &'a drift_core::MountFacts {
    file(repo, path)
        .mounts
        .iter()
        .find(|m| m.route == route)
        .unwrap_or_else(|| panic!("no mount of {route} in {path}"))
}

const AUTH: &str = r#"from functools import wraps


def login_required(fn):
    @wraps(fn)
    def wrapper(root, info, *args, **kwargs):
        if not info.context.user.is_authenticated:
            raise PermissionError("sign in")
        return fn(root, info, *args, **kwargs)

    return wrapper
"#;

/// strawberry: `@strawberry.type` roots in `app/types.py`, the schema in
/// `app/schema.py`, served by strawberry's Django view in the URLconf. The guarded
/// mutation's permission class is on its mount, the unguarded one has none but
/// what serving gives, `Post.author` (a field of a type that is no root) is no
/// entry point, and the typed argument of a strawberry input class is an input.
#[test]
fn strawberry_root_fields_are_entry_points() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/types.py",
        r#"import strawberry
from strawberry.permission import BasePermission
from strawberry.types import Info


class IsAuthenticated(BasePermission):
    message = "Not signed in"

    def has_permission(self, source, info: Info, **kwargs) -> bool:
        return info.context.request.user.is_authenticated


@strawberry.input
class UserInput:
    name: str


@strawberry.type
class Post:
    title: str

    @strawberry.field
    def author(self) -> str:
        return "someone"


def all_posts() -> list[Post]:
    return []


@strawberry.type
class Query:
    posts: list[Post] = strawberry.field(resolver=all_posts)
    plain: str = "x"


@strawberry.type
class Mutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    def delete_user(self, info: Info, user_id: int) -> bool:
        return True

    @strawberry.mutation
    def create_user(self, data: UserInput) -> bool:
        return True
"#,
    );
    write(
        r,
        "app/schema.py",
        "import strawberry\n\nfrom app.types import Mutation, Query\n\nschema = strawberry.Schema(query=Query, mutation=Mutation)\n",
    );
    write(
        r,
        "app/urls.py",
        "from django.urls import path\nfrom strawberry.django.views import GraphQLView\n\nfrom app.schema import schema\n\nurlpatterns = [path(\"graphql/\", GraphQLView.as_view(schema=schema))]\n",
    );
    let repo = scanned(r);
    mining_unchanged(&repo, &["app/types.py", "app/schema.py"]);
    let listed = repo.listed();
    assert_eq!(
        graphql(&listed, "app/types.py"),
        [
            "MUTATION Mutation.create_user Mutation.create_user strawberry",
            "MUTATION Mutation.delete_user Mutation.delete_user strawberry",
            "QUERY Query.posts all_posts strawberry",
        ]
    );
    // The permission class guards the one mutation, read where the inventory reads
    // a field's permission classes; the schema's Django route adds nothing.
    let guarded = mount(&listed, "app/types.py", "Mutation.delete_user");
    assert!(!guarded.opaque, "{guarded:?}");
    assert_eq!(
        guarded
            .wraps
            .iter()
            .map(|w| (w.kind, w.wrapper.as_str()))
            .collect::<Vec<_>>(),
        [(WrapKind::Call, "app/types.py#IsAuthenticated")]
    );
    assert!(
        file(&listed, "app/types.py")
            .mounts
            .iter()
            .all(|m| m.route != "Mutation.create_user"),
        "the unguarded mutation has nothing on its mount"
    );
    // The resolver method is a symbol of the listed reading, its typed input read.
    let f = file(&listed, "app/types.py");
    let create = f
        .symbols
        .iter()
        .find(|s| s.name == "Mutation.create_user")
        .unwrap();
    assert_eq!(create.inputs, ["app/types.py#UserInput"]);
    assert!(wraps(&listed, "app/types.py", "Mutation.create_user").is_empty());
    assert!(f.symbols.iter().all(|s| s.name != "Post.author"));
    // Not in what mining reads.
    assert!(
        file(&repo, "app/types.py")
            .symbols
            .iter()
            .all(|s| s.name != "Mutation.create_user")
    );
}

/// graphene: the roots in `app/schema.py`, a query mixin in `app/queries.py` and the
/// mutation classes in `app/mutations.py`. A mutation mounted with `.Field()` is its
/// class's `mutate`, with its decorator as a wrap and its `Arguments` as inputs; a
/// mixin's `resolve_<field>` is a root field; a `resolve_<field>` of a type that is no
/// root is not. The schema is served nowhere Drift reads: guard unknown on every
/// mount.
#[test]
fn graphene_root_fields_are_entry_points() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/auth.py", AUTH);
    write(
        r,
        "app/mutations.py",
        r#"import graphene

from app.auth import login_required


class UserInput(graphene.InputObjectType):
    name = graphene.String()


class CreateUser(graphene.Mutation):
    class Arguments:
        data = UserInput(required=True)

    ok = graphene.Boolean()

    def mutate(root, info, data):
        return CreateUser(ok=True)


class DeleteUser(graphene.Mutation):
    class Arguments:
        user_id = graphene.ID()

    ok = graphene.Boolean()

    @staticmethod
    @login_required
    def mutate(root, info, user_id):
        return DeleteUser(ok=True)
"#,
    );
    write(
        r,
        "app/queries.py",
        r#"import graphene


class UserType(graphene.ObjectType):
    name = graphene.String()
    friends = graphene.List(graphene.String)

    def resolve_friends(root, info):
        return []


class UserQueries(graphene.ObjectType):
    me = graphene.Field(UserType)

    def resolve_me(root, info):
        return None
"#,
    );
    write(
        r,
        "app/schema.py",
        r#"import graphene

from app.mutations import CreateUser, DeleteUser
from app.queries import UserQueries


class Query(UserQueries, graphene.ObjectType):
    pass


class Mutation(graphene.ObjectType):
    create_user = CreateUser.Field()
    delete_user = DeleteUser.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)
"#,
    );
    let repo = scanned(r);
    mining_unchanged(&repo, &["app/mutations.py", "app/queries.py"]);
    let listed = repo.listed();
    assert_eq!(
        graphql(&listed, "app/mutations.py"),
        [
            "MUTATION Mutation.create_user CreateUser.mutate graphene",
            "MUTATION Mutation.delete_user DeleteUser.mutate graphene",
        ]
    );
    assert_eq!(
        graphql(&listed, "app/queries.py"),
        ["QUERY Query.me UserQueries.resolve_me graphene"]
    );
    assert_eq!(
        wraps(&listed, "app/mutations.py", "DeleteUser.mutate"),
        ["Decorator app/auth.py#login_required"]
    );
    assert!(wraps(&listed, "app/mutations.py", "CreateUser.mutate").is_empty());
    let create = file(&listed, "app/mutations.py")
        .symbols
        .iter()
        .find(|s| s.name == "CreateUser.mutate")
        .unwrap();
    assert_eq!(create.inputs, ["app/mutations.py#UserInput"]);
    for route in ["Mutation.create_user", "Mutation.delete_user"] {
        assert!(mount(&listed, "app/mutations.py", route).opaque, "{route}");
    }
}

/// ariadne: `QueryType()` and `MutationType()` in `app/bindables.py`, resolvers bound
/// with `@query.field(...)` in `app/resolvers.py`, the schema built in
/// `app/schema.py`. The binding decorator is no wrap of the resolver; one below it
/// is. A resolver of `ObjectType("User")` is no entry point.
#[test]
fn ariadne_root_fields_are_entry_points() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(r, "app/auth.py", AUTH);
    write(
        r,
        "app/bindables.py",
        "from ariadne import MutationType, ObjectType, QueryType\n\nquery = QueryType()\nmutation = MutationType()\nuser = ObjectType(\"User\")\n",
    );
    write(
        r,
        "app/resolvers.py",
        r#"from app.auth import login_required
from app.bindables import mutation, query, user


@query.field("me")
def resolve_me(_, info):
    return None


@mutation.field("deleteUser")
@login_required
def resolve_delete_user(_, info, id):
    return True


@mutation.field("createUser")
def resolve_create_user(_, info, input):
    return True


@user.field("friends")
def resolve_friends(obj, info):
    return []
"#,
    );
    write(
        r,
        "app/schema.py",
        r#"from ariadne import load_schema_from_path, make_executable_schema

import app.resolvers
from app.bindables import mutation, query, user

type_defs = load_schema_from_path("schema.graphql")
schema = make_executable_schema(type_defs, query, mutation, user)
"#,
    );
    let repo = scanned(r);
    mining_unchanged(&repo, &["app/resolvers.py"]);
    let listed = repo.listed();
    assert_eq!(
        graphql(&listed, "app/resolvers.py"),
        [
            "MUTATION Mutation.createUser resolve_create_user ariadne",
            "MUTATION Mutation.deleteUser resolve_delete_user ariadne",
            "QUERY Query.me resolve_me ariadne",
        ]
    );
    assert_eq!(
        wraps(&listed, "app/resolvers.py", "resolve_delete_user"),
        ["Decorator app/auth.py#login_required"]
    );
    assert!(wraps(&listed, "app/resolvers.py", "resolve_create_user").is_empty());
    // What mining reads keeps the binding decorator as the wrap it always was.
    let mined = file(&repo, "app/resolvers.py")
        .symbols
        .iter()
        .find(|s| s.name == "resolve_create_user")
        .unwrap();
    assert_eq!(mined.wraps.len(), 1, "{:?}", mined.wraps);
}

/// A schema whose root is built by a call is not tied to it: nothing is listed for
/// it, and its resolvers are no entry points.
#[test]
fn a_root_built_by_a_call_lists_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "pyproject.toml", "[project]\nname = \"fx\"\n");
    write(r, "app/__init__.py", "");
    write(
        r,
        "app/schema.py",
        r#"import strawberry


@strawberry.type
class Mutation:
    @strawberry.mutation
    def create_user(self) -> bool:
        return True


def build():
    return Mutation


schema = strawberry.Schema(query=build(), mutation=build())
"#,
    );
    let repo = scanned(r);
    let listed = repo.listed();
    assert!(graphql(&listed, "app/schema.py").is_empty());
}
