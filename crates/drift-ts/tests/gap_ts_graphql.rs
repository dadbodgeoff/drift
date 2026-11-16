//! GraphQL operations outside NestJS: each field of a root type (`Query`,
//! `Mutation`, `Subscription`) of a resolver map a GraphQL server or schema builder
//! is given, and each root field a code-first builder adds (Pothos, Nexus,
//! TypeGraphQL), is an entry point of kind `graphql`, shaped as a NestJS
//! resolver's (`MUTATION Mutation.createUser`). Listed for the practice map and
//! `drift security` only: what mining reads is what the measured build read, which
//! listed none of them.

use std::fs;
use std::path::Path;

use drift_core::{EntryPoint, FileFacts, RepoFacts};
use drift_ts::{ScanOptions, scan};

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

fn file<'r>(r: &'r RepoFacts, path: &str) -> &'r FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

/// The GraphQL operations of the whole repository, as `<method> <route>`.
fn operations(r: &RepoFacts) -> Vec<String> {
    let mut out: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| f.entry_points.iter())
        .filter(|e| e.kind == "graphql")
        .map(|e: &EntryPoint| {
            format!(
                "{} {}",
                e.method.as_deref().unwrap_or_default(),
                e.route.as_deref().unwrap_or_default()
            )
        })
        .collect();
    out.sort();
    out
}

/// The symbol of the operation `<method> <route>` in `path`.
fn symbol<'r>(r: &'r RepoFacts, path: &str, name: &str) -> &'r drift_core::Symbol {
    file(r, path)
        .symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {path}"))
}

const PACKAGE: &str =
    r#"{ "name": "api", "dependencies": { "@apollo/server": "4.10.0", "graphql": "16.8.1" } }"#;

const ONE_FILE: &str = r#"
import { ApolloServer } from "@apollo/server";
import { GraphQLError } from "graphql";
import { db } from "./db";

const typeDefs = `type Query { users: [User] }`;

const resolvers = {
  Query: {
    users: async () => db.user.findMany(),
  },
  Mutation: {
    async createUser(_parent, args, context) {
      if (!context.user) {
        throw new GraphQLError("sign in", { extensions: { code: "UNAUTHENTICATED" } });
      }
      return db.user.create({ data: { name: args.name } });
    },
    deleteUser: async (_parent, { id }) => db.user.delete({ where: { id } }),
  },
  User: {
    posts: (user) => db.post.findMany({ where: { authorId: user.id } }),
  },
};

export const server = new ApolloServer({ typeDefs, resolvers });
"#;

const DB: &str = r#"
export const db: any = {};
"#;

/// A resolver map in the file of its server: each root field is an operation in
/// the listed reading, none in the measured one; a field of another type (`User.posts`)
/// resolves a field of a value and is no operation.
#[test]
fn a_resolver_map_given_to_apollo_lists_its_root_fields() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/server.ts", ONE_FILE),
        ("src/db.ts", DB),
    ]);
    assert!(operations(&r).is_empty(), "{:?}", operations(&r));
    let listed = r.listed();
    assert_eq!(
        operations(&listed),
        [
            "MUTATION Mutation.createUser",
            "MUTATION Mutation.deleteUser",
            "QUERY Query.users",
        ]
    );
    let create = symbol(&listed, "src/server.ts", "MUTATION Mutation.createUser");
    // `args` is request input; `context` holds the caller, so the check is read.
    assert!(
        create
            .controls
            .iter()
            .any(|c| c == drift_core::controls::READS_INPUT),
        "{:?}",
        create.controls
    );
    let delete = symbol(&listed, "src/server.ts", "MUTATION Mutation.deleteUser");
    assert!(
        delete
            .controls
            .iter()
            .any(|c| c == drift_core::controls::READS_INPUT),
        "{:?}",
        delete.controls
    );
    let users = symbol(&listed, "src/server.ts", "QUERY Query.users");
    assert!(
        users
            .controls
            .iter()
            .any(|c| c == drift_core::controls::NO_INPUT),
        "{:?}",
        users.controls
    );
}

const USERS: &str = r#"
import { db } from "../db";

export const userResolvers = {
  Query: {
    me: (_p, _a, ctx) => ctx.user,
  },
};
"#;

const POSTS: &str = r#"
import { db } from "../db";
import { extra } from "./extra";

export default {
  Mutation: {
    publish: (_p, args) => db.post.update({ where: { id: args.id } }),
    ...extra,
  },
};
"#;

const EXTRA: &str = r#"
export const extra = { archive: () => null };
"#;

const INDEX: &str = r#"
import { mergeResolvers } from "@graphql-tools/merge";
import { userResolvers } from "./users";
import postResolvers from "./posts";

export const resolvers = mergeResolvers([userResolvers, postResolvers]);
"#;

const YOGA_SERVER: &str = r#"
import { createSchema, createYoga } from "graphql-yoga";
import { resolvers } from "./resolvers";

export const yoga = createYoga({
  schema: createSchema({ typeDefs: "type Query { me: String }", resolvers }),
});
"#;

const UNSERVED: &str = r#"
export const fixtures = {
  Query: {
    sample: () => 1,
  },
};
"#;

/// Maps merged across files are served through imports, a default export and
/// `mergeResolvers`; a spread of a value of another file is not read, and the
/// unlisted-routes report says where; a map nothing serves lists nothing.
#[test]
fn maps_merged_across_files_are_served_and_an_unread_spread_is_said() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/db.ts", DB),
        ("src/resolvers/users.ts", USERS),
        ("src/resolvers/posts.ts", POSTS),
        ("src/resolvers/extra.ts", EXTRA),
        ("src/resolvers/index.ts", INDEX),
        ("src/server.ts", YOGA_SERVER),
        ("src/fixtures.ts", UNSERVED),
    ]);
    assert!(operations(&r).is_empty(), "{:?}", operations(&r));
    let listed = r.listed();
    assert_eq!(
        operations(&listed),
        ["MUTATION Mutation.publish", "QUERY Query.me"]
    );
    // `...extra` inside `Mutation` (line 8) may add operations Drift did not read.
    assert_eq!(file(&listed, "src/resolvers/posts.ts").unlisted_routes, [8]);
    assert!(file(&listed, "src/fixtures.ts").entry_points.is_empty());
}

const PERMISSIONS: &str = r#"
import { rule, shield } from "graphql-shield";

export const isAdmin = rule()(async (_p, _a, ctx) => ctx.user?.role === "admin");

export const permissions = shield({
  Mutation: {
    removePost: isAdmin,
  },
});
"#;

const SHIELDED: &str = r#"
import { makeExecutableSchema } from "@graphql-tools/schema";
import { applyMiddleware } from "graphql-middleware";
import { permissions } from "./permissions";

const resolvers = {
  Mutation: {
    removePost: (_p, args) => args.id,
    renamePost: (_p, args) => args.name,
  },
};

export const schema = applyMiddleware(
  makeExecutableSchema({ typeDefs: "type Mutation { removePost: ID }", resolvers }),
  permissions,
);
"#;

/// A `graphql-shield` rule map applied to the schema gives the field it names its
/// rule, as the operation's first wrap; a field it names none for has none.
#[test]
fn a_shield_rule_map_guards_the_fields_it_names() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/permissions.ts", PERMISSIONS),
        ("src/schema.ts", SHIELDED),
    ]);
    let listed = r.listed();
    let removed = symbol(&listed, "src/schema.ts", "MUTATION Mutation.removePost");
    assert_eq!(
        removed.wraps.first().map(|w| w.wrapper.as_str()),
        Some("src/permissions.ts#isAdmin"),
        "{:?}",
        removed.wraps
    );
    let renamed = symbol(&listed, "src/schema.ts", "MUTATION Mutation.renamePost");
    assert!(renamed.wraps.is_empty(), "{:?}", renamed.wraps);
}

const BUILDER: &str = r#"
import SchemaBuilder from "@pothos/core";

export const builder = new SchemaBuilder({});
"#;

const POTHOS_FIELDS: &str = r#"
import { builder } from "./builder";

builder.queryField("me", (t) =>
  t.field({
    type: "String",
    resolve: (_root, _args, ctx) => ctx.user.name,
  }),
);

builder.mutationFields((t) => ({
  rename: t.field({
    type: "String",
    authScopes: { loggedIn: true },
    args: { name: t.arg.string() },
    resolve: (_root, args) => args.name,
  }),
}));
"#;

/// Pothos: the root fields a `SchemaBuilder` of `@pothos/core` is given are
/// operations wherever the builder is imported; `authScopes` is a guard Drift does
/// not read, so the operation's guard is unknown, never none.
#[test]
fn pothos_root_fields_are_operations_and_auth_scopes_are_unknown() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/builder.ts", BUILDER),
        ("src/schema.ts", POTHOS_FIELDS),
    ]);
    assert!(operations(&r).is_empty());
    let listed = r.listed();
    assert_eq!(
        operations(&listed),
        ["MUTATION Mutation.rename", "QUERY Query.me"]
    );
    let rename = symbol(&listed, "src/schema.ts", "MUTATION Mutation.rename");
    assert!(
        rename
            .app_middleware
            .iter()
            .any(|m| m.contains("authScopes of Mutation.rename")),
        "{:?}",
        rename.app_middleware
    );
    let me = symbol(&listed, "src/schema.ts", "QUERY Query.me");
    assert!(me.app_middleware.is_empty(), "{:?}", me.app_middleware);
}

const NEXUS: &str = r#"
import { extendType, mutationField } from "nexus";

export const UserQuery = extendType({
  type: "Query",
  definition(t) {
    t.nonNull.list.field("users", {
      type: "User",
      resolve: () => [],
    });
  },
});

export const SignUp = mutationField("signUp", {
  type: "User",
  resolve: (_root, args) => ({ name: args.name }),
});
"#;

const TYPE_GRAPHQL: &str = r#"
import { Arg, Authorized, Mutation, Query, Resolver } from "type-graphql";

@Resolver()
export class RecipeResolver {
  @Query()
  recipes() {
    return [];
  }

  @Authorized()
  @Mutation()
  addRecipe(@Arg("title") title: string) {
    return { title };
  }
}
"#;

/// Nexus and TypeGraphQL: the root fields are certain from the package's API in
/// the file itself; `@Authorized()` wraps the method it decorates.
#[test]
fn nexus_and_type_graphql_root_fields_are_operations() {
    let r = repo(&[
        ("package.json", PACKAGE),
        ("src/nexus.ts", NEXUS),
        ("src/recipe.ts", TYPE_GRAPHQL),
    ]);
    assert!(operations(&r).is_empty());
    let listed = r.listed();
    assert_eq!(
        operations(&listed),
        [
            "MUTATION Mutation.signUp",
            "MUTATION RecipeResolver.addRecipe",
            "QUERY Query.users",
            "QUERY RecipeResolver.recipes",
        ]
    );
    let add = symbol(
        &listed,
        "src/recipe.ts",
        "MUTATION RecipeResolver.addRecipe",
    );
    assert!(
        add.wraps.iter().any(|w| w.wrapper.ends_with("#Authorized")),
        "{:?}",
        add.wraps
    );
}
