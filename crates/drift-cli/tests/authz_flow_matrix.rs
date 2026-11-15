//! Authorization and a value of the caller, as a matrix (TypeScript and JavaScript).
//!
//! The rule under test: authorization is `none` only where no value of the caller
//! flows anywhere the facts did not classify. A handler that uses a value read off
//! the caller's identity in a call argument, a comparison, a property value, a
//! template or a query builder is not `none`: it is `known` where a proof that
//! already exists applies, otherwise unknown with the use named. The sources of "a
//! value of the caller" and the uses that are no scope are two closed lists
//! (`crates/drift-ts/src/caller.rs`); a value of the request or of the settings
//! is not the caller's.
//!
//! The design is a covering one, in two blocks, each cell generated here and read by
//! the built binary:
//!
//! - **sources x uses** ([`sources_and_uses`]): for each framework, every source of
//!   that framework (the entries of the closed list it can write, and the request
//!   values and settings as the negative sources) with every use, in the handler's
//!   own body, with the framework's own library. Every source meets every use, and
//!   every framework has every kind of source.
//! - **libraries x positions** ([`libraries_and_positions`]): every library with
//!   every place the use can sit (the handler's body, one arm of an `if`, one arm of
//!   a conditional bound to a local that is then used, a callback, a helper of the
//!   same file, a service method of another file), with one source of the caller and
//!   one of the request, the frameworks in turn.
//!
//! Every cell is a route that uses the value and a sibling route with the same
//! source read and the same query without the value: the sibling must read `none`,
//! so the rule cannot pass by calling everything unknown.
//!
//! `DRIFT_MATRIX_DUMP=<file>` appends one line per cell (block, framework, source,
//! use or position, library, whose the value is, expected, read, sibling) for
//! counting states; `DRIFT_MATRIX_KEEP=<dir>` keeps the fixtures.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

type Files = BTreeMap<String, String>;

fn write(files: &Files) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, body) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
    dir
}

/// What the practice map says of authorization, by unit (`GET /c3/scoped`, `QUERY c3scoped`,
/// or the symbol of a server action): the assignment, and the reason it is unknown.
/// A unit authorization does not list (its authentication is `none`) is absent.
fn authz(root: &Path) -> BTreeMap<String, (String, String)> {
    let out = Command::new(&*BIN)
        .args(["--no-cache", "practices", "--json", "--units"])
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let c = v["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "authz")
        .expect("no authz concern");
    c["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let route = u["route"].as_str().unwrap_or_default();
            let key = if route.is_empty() {
                u["symbol"].as_str().unwrap_or_default().to_string()
            } else {
                format!("{} {route}", u["method"].as_str().unwrap_or_default())
            };
            (
                key,
                (
                    u["assignment"].as_str().unwrap().to_string(),
                    u["reason"].as_str().unwrap_or_default().to_string(),
                ),
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The libraries.

/// A data library: how the rows are read without a filter, how they are filtered by
/// the value `@V@` on a column that names no tenant and no owner (`depotId`), and
/// the same filter built in one arm of a conditional, bound to a local and then
/// handed to the query (statements that define `out`).
struct Lib {
    name: &'static str,
    all: &'static str,
    filter: &'static str,
    ternary: &'static str,
    /// Filtered by a value of the request, the library's filter is one the facts
    /// already hold as a filter of unknown source (an object of keys given to a data
    /// call): unknown before this rule and after it. `Always`: also where the
    /// object is bound to a local first (a `where` key is written at the call).
    unsourced: Unsourced,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Unsourced {
    Never,
    WrittenAtTheCall,
    Always,
}

const PRISMA: Lib = Lib {
    name: "prisma",
    all: "await prisma.parcel.findMany()",
    filter: "await prisma.parcel.findMany({ where: { depotId: @V@ } })",
    ternary: "const where = flag ? {} : { depotId: @V@ };\nconst out = await prisma.parcel.findMany({ where });",
    unsourced: Unsourced::Always,
};
const DRIZZLE: Lib = Lib {
    name: "drizzle",
    all: "await db.select().from(parcels)",
    filter: "await db.select().from(parcels).where(eq(parcels.depotId, @V@))",
    ternary: "const cond = flag ? undefined : eq(parcels.depotId, @V@);\nconst out = await db.select().from(parcels).where(cond);",
    unsourced: Unsourced::Never,
};
const KNEX: Lib = Lib {
    name: "knex",
    all: "await knex(\"parcels\").select(\"*\")",
    filter: "await knex(\"parcels\").where(\"depot_id\", @V@)",
    ternary: "const by = flag ? {} : { depot_id: @V@ };\nconst out = await knex(\"parcels\").where(by);",
    unsourced: Unsourced::Never,
};
const TYPEORM_QB: Lib = Lib {
    name: "typeorm-query-builder",
    all: "await dataSource.getRepository(Parcel).createQueryBuilder(\"p\").getMany()",
    filter: "await dataSource.getRepository(Parcel).createQueryBuilder(\"p\").where(\"p.depotId = :depot\", { depot: @V@ }).getMany()",
    ternary: "const bound = flag ? { depot: null } : { depot: @V@ };\nconst out = await dataSource.getRepository(Parcel).createQueryBuilder(\"p\").where(\"p.depotId = :depot\", bound).getMany();",
    unsourced: Unsourced::WrittenAtTheCall,
};
const TYPEORM_FIND: Lib = Lib {
    name: "typeorm-find",
    all: "await dataSource.getRepository(Parcel).find()",
    filter: "await dataSource.getRepository(Parcel).find({ where: { depotId: @V@ } })",
    ternary: "const where = flag ? {} : { depotId: @V@ };\nconst out = await dataSource.getRepository(Parcel).find({ where });",
    unsourced: Unsourced::Always,
};
const SEQUELIZE: Lib = Lib {
    name: "sequelize",
    all: "await ParcelRow.findAll()",
    filter: "await ParcelRow.findAll({ where: { depotId: @V@ } })",
    ternary: "const where = flag ? {} : { depotId: @V@ };\nconst out = await ParcelRow.findAll({ where });",
    unsourced: Unsourced::Always,
};
const MONGOOSE: Lib = Lib {
    name: "mongoose",
    all: "await ParcelDoc.find().lean()",
    filter: "await ParcelDoc.find({ depotId: @V@ }).lean()",
    ternary: "const query = flag ? {} : { depotId: @V@ };\nconst out = await ParcelDoc.find(query).lean();",
    unsourced: Unsourced::WrittenAtTheCall,
};
const KYSELY: Lib = Lib {
    name: "kysely",
    all: "await kdb.selectFrom(\"parcels\").selectAll().execute()",
    filter: "await kdb.selectFrom(\"parcels\").selectAll().where(\"depot_id\", \"=\", @V@).execute()",
    ternary: "const depot = flag ? null : @V@;\nconst out = await kdb.selectFrom(\"parcels\").selectAll().where(\"depot_id\", \"=\", depot).execute();",
    unsourced: Unsourced::Never,
};
const PG: Lib = Lib {
    name: "pg",
    all: "(await pool.query(\"select * from parcels\")).rows",
    filter: "(await pool.query(\"select * from parcels where depot_id = $1\", [@V@])).rows",
    ternary: "const values = flag ? [null] : [@V@];\nconst out = (await pool.query(\"select * from parcels where depot_id = $1\", values)).rows;",
    unsourced: Unsourced::Never,
};
const POSTGRES: Lib = Lib {
    name: "postgres-tagged",
    all: "await sql`select * from parcels`",
    filter: "await sql`select * from parcels where depot_id = ${@V@}`",
    ternary: "const depot = flag ? null : @V@;\nconst out = await sql`select * from parcels where depot_id = ${depot}`;",
    unsourced: Unsourced::Never,
};
const ARRAY: Lib = Lib {
    name: "array-filter",
    all: "PARCELS.slice()",
    filter: "PARCELS.filter((p) => p.depotId === @V@)",
    ternary: "const depot = flag ? null : @V@;\nconst out = PARCELS.filter((p) => depot === null || p.depotId === depot);",
    unsourced: Unsourced::Never,
};

const LIBS: &[&Lib] = &[
    &PRISMA,
    &DRIZZLE,
    &KNEX,
    &TYPEORM_QB,
    &TYPEORM_FIND,
    &SEQUELIZE,
    &MONGOOSE,
    &KYSELY,
    &PG,
    &POSTGRES,
    &ARRAY,
];

/// The clients, in one module of every fixture.
const DATA: &str = r#"import { PrismaClient } from "@prisma/client";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import knexFactory from "knex";
import { DataSource } from "typeorm";
import { Sequelize, DataTypes, Model } from "sequelize";
import mongoose from "mongoose";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import postgres from "postgres";

export const prisma = new PrismaClient();
export const db = drizzle(process.env.DATABASE_URL!);
export const parcels = pgTable("parcels", { id: text("id"), depotId: text("depot_id"), status: text("status") });
export const knex = knexFactory({ client: "pg" });
export class Parcel {
  id!: string;
  depotId!: string;
}
export const dataSource = new DataSource({ type: "postgres", entities: [Parcel] });
const sequelize = new Sequelize(process.env.DATABASE_URL!);
export class ParcelRow extends Model {}
ParcelRow.init({ depotId: DataTypes.STRING }, { sequelize });
export const ParcelDoc = mongoose.model("Parcel", new mongoose.Schema({ depotId: String }));
export const pool = new Pool();
export const kdb = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
export const sql = postgres(process.env.DATABASE_URL!);
export const PARCELS: { id: string; depotId: string }[] = [];
"#;

/// What the uses that are no scope are handed to, and the settings.
const EXTRAS: &str = r#"import pino from "pino";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createClient } from "redis";

export const logger = pino();
export const ratelimit = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(10, "10 s") });
export const kv = createClient();
export const settings = { defaultDepot: process.env.DEFAULT_DEPOT ?? "d1" };
export function normalized(depot: unknown) {
  return typeof depot === "string" ? depot : "";
}
"#;

/// A service per library, in a module of its own: a method filters by its
/// parameter. The static ones are read where they are called; a method of the
/// instance the module exports is not followed.
fn services(prefix: &str) -> String {
    let mut out = format!(
        "import {{ eq }} from \"drizzle-orm\";\nimport {{ prisma, db, parcels, knex, dataSource, Parcel, ParcelRow, ParcelDoc, kdb, pool, sql, PARCELS }} from \"{prefix}/data\";\n\n"
    );
    for (i, l) in LIBS.iter().enumerate() {
        let _ = writeln!(
            out,
            "export class Parcels{i} {{\n  static async listFor(depot: string) {{\n    return {f};\n  }}\n\n  static async listAll() {{\n    return {a};\n  }}\n\n  async findFor(depot: string) {{\n    return {f};\n  }}\n\n  async findAll() {{\n    return {a};\n  }}\n}}\nexport const parcels{i} = new Parcels{i}();\n",
            f = l.filter.replace("@V@", "depot"),
            a = l.all
        );
    }
    out
}

fn lib_index(l: &Lib) -> usize {
    LIBS.iter().position(|x| x.name == l.name).unwrap()
}

/// What every file of a fixture that holds handlers imports of the shared modules.
fn imports(prefix: &str) -> String {
    let services: Vec<String> = (0..LIBS.len())
        .map(|i| format!("Parcels{i}, parcels{i}"))
        .collect();
    format!(
        "import {{ eq, and, or, inArray }} from \"drizzle-orm\";\nimport {{ prisma, db, parcels, knex, dataSource, Parcel, ParcelRow, ParcelDoc, kdb, pool, sql, PARCELS }} from \"{prefix}/data\";\nimport {{ logger, ratelimit, kv, settings, normalized }} from \"{prefix}/extras\";\nimport {{ {} }} from \"{prefix}/services\";\ndeclare const flag: boolean;\n",
        services.join(", ")
    )
}

// ---------------------------------------------------------------------------
// The uses and the positions.

/// What a route that uses a value reads, by whose the value is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reads {
    /// A use the facts do not classify: unknown with a value of the caller, `none`
    /// with one of the request or the settings.
    Flows,
    /// The same, through the library's own filter: with a value of the request,
    /// unknown where the library's filter is one of unknown source
    /// ([`Lib::unsourced`]).
    FlowsToFilter,
    /// The same, through Prisma's `where` whatever the fixture's library.
    FlowsToWhere,
    /// A request handed to another service: unknown whoever the value is of.
    Forwards,
    /// A use on the closed list of what is no scope: `none` whoever the value is of.
    NoScope,
}

/// A use of the value `@V@`: statements that define `out`, what the handler answers
/// with. `@ALL@` is the library's rows without a filter, `@FILTER@` its filter by
/// `@V@`, `@S@` its service.
struct Use {
    name: &'static str,
    code: &'static str,
    reads: Reads,
}

const fn a_use(name: &'static str, code: &'static str, reads: Reads) -> Use {
    Use { name, code, reads }
}

const USES: &[Use] = &[
    // An argument of a call.
    a_use(
        "library-filter",
        "const out = @FILTER@;",
        Reads::FlowsToFilter,
    ),
    a_use(
        "orm-operators-and",
        "const out = await db.select().from(parcels).where(and(eq(parcels.depotId, @V@), inArray(parcels.status, [\"open\"])));",
        Reads::Flows,
    ),
    a_use(
        "orm-operators-or-in",
        "const out = await db.select().from(parcels).where(or(inArray(parcels.depotId, [@V@]), eq(parcels.status, \"lost\")));",
        Reads::Flows,
    ),
    a_use(
        "query-builder",
        "const out = await knex(\"parcels\").where(\"depot_id\", @V@).orderBy(\"id\");",
        Reads::Flows,
    ),
    a_use(
        "service-method",
        "const out = await @S@.listFor(@V@);",
        Reads::FlowsToFilter,
    ),
    a_use(
        "raw-sql-parameters",
        "const out = (await pool.query(\"select * from parcels where depot_id = $1 order by id\", [@V@])).rows;",
        Reads::Flows,
    ),
    a_use(
        "tagged-template",
        "const out = await sql`select * from parcels where depot_id = ${@V@} order by id`;",
        Reads::Flows,
    ),
    a_use(
        "fetch-another-service",
        "const out = await (await fetch(`http://inventory.internal/parcels?depot=${@V@}`)).json();",
        Reads::Forwards,
    ),
    // A property value in an object passed to a call.
    a_use(
        "object-property",
        "const out = await prisma.parcel.findMany({ where: { depotId: @V@ }, orderBy: { id: \"asc\" } });",
        Reads::FlowsToWhere,
    ),
    // An operand of a comparison.
    a_use(
        "if-comparison",
        "const all = @ALL@;\nconst out = [];\nfor (const p of all) {\n  if (p.depotId === @V@) out.push(p);\n}",
        Reads::Flows,
    ),
    a_use(
        "ternary-comparison",
        "const all = @ALL@;\nconst out = all.length > 0 && all[0].depotId === @V@ ? all : [];",
        Reads::Flows,
    ),
    a_use(
        "filter-callback",
        "const all = @ALL@;\nconst out = all.filter((p) => p.depotId === @V@);",
        Reads::Flows,
    ),
    a_use(
        "find-callback",
        "const all = @ALL@;\nconst out = all.find((p) => p.depotId == @V@) ?? null;",
        Reads::Flows,
    ),
    a_use(
        "some-callback",
        "const all = @ALL@;\nconst out = all.some((p) => p.depotId !== @V@) ? [] : all;",
        Reads::Flows,
    ),
    a_use(
        "switch",
        "let out;\nswitch (@V@) {\n  case \"d1\":\n    out = @ALL@;\n    break;\n  default:\n    out = [];\n}",
        Reads::Flows,
    ),
    a_use(
        "includes",
        "const out = [\"d1\", \"d2\"].includes(@V@) ? @ALL@ : [];",
        Reads::Flows,
    ),
    // Bound to a local that is then used; inside one arm.
    a_use(
        "local-then-filter",
        "const value = @V@;\nconst wanted = value;\nconst out = @FILTER:wanted@;",
        Reads::FlowsToFilter,
    ),
    // Through a helper of the repository that hands back what it was given.
    a_use(
        "through-a-helper",
        "const handedBack = normalized(@V@);\nconst out = @FILTER:handedBack@;",
        Reads::FlowsToFilter,
    ),
    // What a promise of the value settles with, in the callback of `then`.
    a_use(
        "then-callback",
        "const out = await Promise.resolve(@V@).then(async (given) => {\n  const found = @FILTER:given@;\n  return found;\n});",
        Reads::FlowsToFilter,
    ),
    a_use(
        "conditional-arm",
        "const out = @FILTER:(flag ? \"d0\" : @V@)@;",
        Reads::FlowsToFilter,
    ),
    a_use(
        "logical-arm",
        "const out = @FILTER:(@V@ || \"d0\")@;",
        Reads::FlowsToFilter,
    ),
    a_use(
        "template-then-call",
        "const key = `parcels:${@V@}`;\nconst out = JSON.parse((await kv.get(key)) ?? \"[]\");",
        Reads::Flows,
    ),
    a_use(
        "index",
        "const byDepot: Record<string, unknown[]> = {};\nfor (const p of @ALL@) (byDepot[p.depotId] ??= []).push(p);\nconst out = byDepot[@V@] ?? [];",
        Reads::Flows,
    ),
    // The closed list of what is no scope.
    a_use(
        "returned",
        "const out = { who: @V@, rows: @ALL@ };",
        Reads::NoScope,
    ),
    a_use(
        "logged-console",
        "console.log(\"listing for\", @V@);\nconst out = @ALL@;",
        Reads::NoScope,
    ),
    a_use(
        "logged-logger",
        "logger.info({ depot: @V@ }, \"listing\");\nconst out = @ALL@;",
        Reads::NoScope,
    ),
    a_use(
        "rate-limit-key",
        "await ratelimit.limit(String(@V@));\nconst out = @ALL@;",
        Reads::NoScope,
    ),
    a_use(
        "compared-with-itself",
        "const value = @V@;\nconst same = value === value;\nconst out = same ? @ALL@ : @ALL@;",
        Reads::NoScope,
    ),
    a_use(
        "presence",
        "const value = @V@;\nconst out = value == null ? [] : @ALL@;",
        Reads::NoScope,
    ),
];

/// Where the library's filter sits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Position {
    Body,
    IfArm,
    TernaryLocal,
    Callback,
    Helper,
    /// A static method of a class of another file: read where it is called.
    Service,
    /// A method of an instance another file exports: not followed, so neither the
    /// route nor its sibling is read to the end.
    ServiceInstance,
}

const POSITIONS: &[Position] = &[
    Position::Body,
    Position::IfArm,
    Position::TernaryLocal,
    Position::Callback,
    Position::Helper,
    Position::Service,
    Position::ServiceInstance,
];

/// A cell's code: what stands at the top of the file, the statements of the route
/// that uses the value and those of its sibling.
struct Code {
    top: String,
    covered: String,
    sibling: String,
}

/// `@FILTER@` and `@FILTER:<expr>@` are the library's filter by `@V@` or by the
/// expression; then `@ALL@`, `@S@` and `@V@`.
fn fill(code: &str, lib: &Lib, v: &str) -> String {
    let mut out = String::new();
    let mut rest = code;
    while let Some(at) = rest.find("@FILTER") {
        out += &rest[..at];
        let after = &rest[at + "@FILTER".len()..];
        if let Some(tail) = after.strip_prefix('@') {
            out += lib.filter;
            rest = tail;
        } else {
            // `@FILTER:<expr>@`: the expression may hold `@V@`, so it ends at the
            // last `@` before the end of the statement.
            let tail = after.strip_prefix(':').unwrap();
            let end = tail.find("@;").unwrap();
            out += &lib.filter.replace("@V@", &tail[..end]);
            rest = &tail[end + 1..];
        }
    }
    out += rest;
    out.replace("@ALL@", lib.all)
        .replace("@S@", &format!("Parcels{}", lib_index(lib)))
        .replace("@I@", &format!("parcels{}", lib_index(lib)))
        .replace("@V@", v)
}

fn use_code(u: &Use, lib: &Lib, v: &str) -> Code {
    // A value that is awaited where it is read cannot be read in a callback that is
    // not `async`: it is bound first.
    if v.contains("await ") && u.code.contains("=> p.") {
        let mut code = use_code(u, lib, "awaited");
        code.covered = format!("const awaited = {v};\n{}", code.covered);
        return code;
    }
    let sibling = if u.name == "service-method" {
        fill("const out = await @S@.listAll();", lib, v)
    } else {
        fill("const out = @ALL@;", lib, v)
    };
    Code {
        top: String::new(),
        covered: fill(u.code, lib, v),
        sibling,
    }
}

fn position_code(p: Position, lib: &Lib, v: &str, n: usize) -> Code {
    let plain = fill("const out = @ALL@;", lib, v);
    match p {
        Position::Body => Code {
            top: String::new(),
            covered: fill("const out = @FILTER@;", lib, v),
            sibling: plain,
        },
        Position::IfArm => Code {
            top: String::new(),
            covered: fill(
                "let out;\nif (flag) {\n  out = @ALL@;\n} else {\n  out = @FILTER@;\n}",
                lib,
                v,
            ),
            sibling: fill(
                "let out;\nif (flag) {\n  out = @ALL@;\n} else {\n  out = [];\n}",
                lib,
                v,
            ),
        },
        Position::TernaryLocal => Code {
            top: String::new(),
            covered: fill(lib.ternary, lib, v),
            sibling: plain,
        },
        Position::Callback => Code {
            top: String::new(),
            covered: fill(
                "const out = (await Promise.all([\"a\"].map(async () => @FILTER@))).flat();",
                lib,
                v,
            ),
            sibling: fill(
                "const out = (await Promise.all([\"a\"].map(async () => @ALL@))).flat();",
                lib,
                v,
            ),
        },
        Position::Helper => Code {
            top: format!(
                "async function load{n}(depot: string) {{\n  return {};\n}}\n\nasync function loadAll{n}() {{\n  return {};\n}}\n",
                lib.filter.replace("@V@", "depot"),
                lib.all
            ),
            covered: format!("const out = await load{n}({v});"),
            sibling: format!("const out = await loadAll{n}();"),
        },
        Position::Service => Code {
            top: String::new(),
            covered: fill("const out = await @S@.listFor(@V@);", lib, v),
            sibling: fill("const out = await @S@.listAll();", lib, v),
        },
        Position::ServiceInstance => Code {
            top: String::new(),
            covered: fill("const out = await @I@.findFor(@V@);", lib, v),
            sibling: fill("const out = await @I@.findAll();", lib, v),
        },
    }
}

// ---------------------------------------------------------------------------
// The sources and the frameworks.

/// A source of the value: what the handler does first (`pre`), the expression that
/// reads the value (`v`), the handler's parameters where the source needs its own
/// (`sig`), and whether the value is the caller's.
struct Source {
    name: &'static str,
    pre: &'static str,
    v: &'static str,
    sig: &'static str,
    caller: bool,
    how: How,
}

/// How a value of the request is read, where a reading older than this rule
/// already answers unknown for the handler that reads it so.
#[derive(Clone, Copy, PartialEq, Eq)]
enum How {
    Plain,
    /// By a method called through the request parameter
    /// (`req.nextUrl.searchParams.get("depot")`): not read in a body that also hands
    /// a value to a method of a local ([`calls_a_local_method`]).
    RequestCall,
    /// By a method of Hono's `c.req`, which is not followed: the handler is not
    /// read to the end, whatever it does with the value.
    Unread,
}

const fn caller(name: &'static str, pre: &'static str, v: &'static str) -> Source {
    Source {
        name,
        pre,
        v,
        sig: "",
        caller: true,
        how: How::Plain,
    }
}

const fn other(name: &'static str, pre: &'static str, v: &'static str) -> Source {
    Source {
        name,
        pre,
        v,
        sig: "",
        caller: false,
        how: How::Plain,
    }
}

const fn read(how: How, s: Source) -> Source {
    Source {
        name: s.name,
        pre: s.pre,
        v: s.v,
        sig: s.sig,
        caller: s.caller,
        how,
    }
}

const fn with(sig: &'static str, s: Source) -> Source {
    Source {
        name: s.name,
        pre: s.pre,
        v: s.v,
        sig,
        caller: s.caller,
        how: s.how,
    }
}

/// A framework's side: its files, its sources, how a route is written and found.
struct Framework {
    name: &'static str,
    /// The directory the shared modules are written in.
    shared: &'static str,
    files: &'static [(&'static str, &'static str)],
    sources: &'static [Source],
    /// The library the first block is written with.
    lib: &'static Lib,
    /// The handlers of a fixture: `(n, top, sig, pre, covered, sibling)` per cell.
    render: fn(&[Cell]) -> Files,
    /// The keys of a cell's two units.
    keys: fn(usize) -> (String, String),
}

/// One cell, as a framework writes it.
struct Cell {
    n: usize,
    top: String,
    sig: &'static str,
    pre: &'static str,
    covered: String,
    sibling: String,
}

fn indent(code: &str, by: &str) -> String {
    code.lines()
        .map(|l| {
            if l.is_empty() {
                String::new()
            } else {
                format!("{by}{l}")
            }
        })
        .collect::<Vec<String>>()
        .join("\n")
}

// Next.js route handlers.

const NEXT_PACKAGE: &str = r#"{ "name": "web", "dependencies": { "next": "15.0.0", "react": "19.0.0", "next-auth": "5.0.0", "@clerk/nextjs": "6.0.0", "@prisma/client": "5.20.0", "drizzle-orm": "0.33.0", "knex": "3.1.0", "typeorm": "0.3.20", "sequelize": "6.37.0", "mongoose": "8.5.0", "kysely": "0.27.0", "pg": "8.12.0", "postgres": "3.4.0", "pino": "9.0.0", "@upstash/ratelimit": "2.0.0", "@upstash/redis": "1.34.0", "redis": "4.7.0" } }
"#;

const TSCONFIG: &str = r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
"#;

const NEXT_SESSION: &str = r#"import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { getToken } from "next-auth/jwt";
import { pool } from "./data";
import { kv } from "./extras";

export type Session = { userId: string; depotId: string; role: string; user: { id: string; depotId: string } };

export const { auth, handlers } = NextAuth({ providers: [] });
export const authOptions = { providers: [] };

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get("session")?.value;
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw, "base64").toString()) as Session;
}

export async function currentDepot() {
  const session = await getSession();
  return session?.depotId ?? null;
}

export async function depotOf(req: NextRequest) {
  const token = await getToken({ req });
  return (token?.depotId as string) ?? null;
}

export async function signedIn() {
  const session = await auth();
  if (!session?.user) return null;
  await kv.set("seen:" + session.user.id, "1");
  return session;
}

export async function memberOf(orgId: string) {
  const session = await auth();
  if (!session?.user) return null;
  return session.user.memberships.some((m: { orgId: string }) => m.orgId === orgId) ? session : null;
}

export async function identify(req: NextRequest) {
  const key = req.headers.get("x-api-key");
  if (!key) return null;
  return (await pool.query("select * from api_keys where key = $1", [key])).rows[0] ?? null;
}
"#;

const SIGNED_IN: &str = "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });";

const NEXT_SOURCES: &[Source] = &[
    caller("session-member", SIGNED_IN, "session.depotId"),
    caller(
        "next-auth-session-user",
        "const session = await auth();\nif (!session?.user) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });",
        "session.user.depotId",
    ),
    caller(
        "get-server-session-inline",
        "if (!(await getServerSession(authOptions))) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });",
        "(await getServerSession(authOptions))!.user.depotId",
    ),
    caller(
        "clerk-auth-destructured",
        "const { userId, orgId } = await clerkAuth();\nif (!userId) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });",
        "orgId",
    ),
    caller(
        "destructured",
        "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nconst { depotId } = session;",
        "depotId",
    ),
    caller(
        "alias-several-hops",
        "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nconst current = session;\nconst { user } = current;\nconst depot = user.depotId;",
        "depot",
    ),
    caller(
        "helper-called-with-nothing",
        SIGNED_IN,
        "(await currentDepot())",
    ),
    caller(
        "helper-called-with-the-request",
        SIGNED_IN,
        "(await depotOf(req))",
    ),
    caller("converted", SIGNED_IN, "String(session.depotId)"),
    caller(
        "what-the-unit-signs-in-by",
        "const who = await identify(req);\nif (!who) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });",
        "who.depotId",
    ),
    // The helper the route signs the caller in by uses the caller's own id (it
    // notes that the user was seen): that is identification, and the sibling stays
    // `none`; what it returns is the caller's.
    caller(
        "what-a-sign-in-helper-that-uses-the-identity-returns",
        "const session = await signedIn();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });",
        "session.user.depotId",
    ),
    read(
        How::RequestCall,
        other(
            "request-query",
            SIGNED_IN,
            "req.nextUrl.searchParams.get(\"depot\")",
        ),
    ),
    read(
        How::RequestCall,
        other("request-header", SIGNED_IN, "req.headers.get(\"x-depot\")"),
    ),
    read(
        How::RequestCall,
        other(
            "request-body",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nconst body = await req.json();",
            "body.depot",
        ),
    ),
    read(
        How::RequestCall,
        other(
            "request-cookie",
            SIGNED_IN,
            "req.cookies.get(\"depot\")?.value",
        ),
    ),
    other("environment", SIGNED_IN, "process.env.DEFAULT_DEPOT"),
    other("settings", SIGNED_IN, "settings.defaultDepot"),
    other("literal", SIGNED_IN, "\"d1\""),
];

fn next_render(cells: &[Cell]) -> Files {
    let mut files = Files::new();
    let head = format!(
        "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getServerSession }} from \"next-auth\";\nimport {{ auth as clerkAuth }} from \"@clerk/nextjs/server\";\nimport {{ getSession, auth, authOptions, currentDepot, depotOf, identify, signedIn, memberOf }} from \"@/lib/session\";\n{}",
        imports("@/lib")
    );
    for c in cells {
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            files.insert(
                format!("app/api/c{}/{kind}/route.ts", c.n),
                format!(
                    "{head}\n{}\nexport async function GET(req: NextRequest) {{\n{}\n{}\n  return NextResponse.json(out);\n}}\n",
                    c.top,
                    indent(c.pre, "  "),
                    indent(body, "  ")
                ),
            );
        }
    }
    files
}

fn next_keys(n: usize) -> (String, String) {
    (
        format!("GET /api/c{n}/scoped"),
        format!("GET /api/c{n}/plain"),
    )
}

const NEXT: Framework = Framework {
    name: "next-route-handlers",
    shared: "lib",
    files: &[
        ("package.json", NEXT_PACKAGE),
        ("tsconfig.json", TSCONFIG),
        ("lib/session.ts", NEXT_SESSION),
    ],
    sources: NEXT_SOURCES,
    lib: &DRIZZLE,
    render: next_render,
    keys: next_keys,
};

// Next.js server actions.

const ACTION_SIGNED_IN: &str =
    "const session = await auth();\nif (!session?.user) throw new Error(\"Unauthorized\");";

const ACTION_SOURCES: &[Source] = &[
    caller(
        "next-auth-session-user",
        ACTION_SIGNED_IN,
        "session.user.depotId",
    ),
    caller(
        "destructured",
        "const session = await auth();\nif (!session?.user) throw new Error(\"Unauthorized\");\nconst { user: { depotId } } = session;",
        "depotId",
    ),
    caller(
        "helper-called-with-nothing",
        ACTION_SIGNED_IN,
        "(await currentDepot())",
    ),
    other("form-data", ACTION_SIGNED_IN, "formData.get(\"depot\")"),
    other("environment", ACTION_SIGNED_IN, "process.env.DEFAULT_DEPOT"),
];

fn action_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "\"use server\";\n\nimport {{ auth, currentDepot }} from \"@/lib/session\";\n{}\n",
        imports("@/lib")
    );
    for c in cells {
        out += &c.top;
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            let _ = writeln!(
                out,
                "export async function c{}{kind}(formData: FormData) {{\n{}\n{}\n  return out;\n}}\n",
                c.n,
                indent(c.pre, "  "),
                indent(body, "  ")
            );
        }
    }
    Files::from([("app/actions.ts".to_string(), out)])
}

fn action_keys(n: usize) -> (String, String) {
    (format!("c{n}scoped"), format!("c{n}plain"))
}

const ACTIONS: Framework = Framework {
    name: "next-server-actions",
    shared: "lib",
    files: &[
        ("package.json", NEXT_PACKAGE),
        ("tsconfig.json", TSCONFIG),
        ("lib/session.ts", NEXT_SESSION),
    ],
    sources: ACTION_SOURCES,
    lib: &PRISMA,
    render: action_render,
    keys: action_keys,
};

// Express.

const API_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "express": "4.19.0", "fastify": "5.0.0", "@fastify/jwt": "9.0.0", "hono": "4.6.0", "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@trpc/server": "11.0.0", "zod": "3.23.0", "jsonwebtoken": "9.0.0", "@prisma/client": "5.20.0", "drizzle-orm": "0.33.0", "knex": "3.1.0", "typeorm": "0.3.20", "sequelize": "6.37.0", "mongoose": "8.5.0", "kysely": "0.27.0", "pg": "8.12.0", "postgres": "3.4.0", "pino": "9.0.0", "@upstash/ratelimit": "2.0.0", "@upstash/redis": "1.34.0", "redis": "4.7.0" } }
"#;

const EXPRESS_AUTH: &str = r#"import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const claims = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!) as any;
    (req as any).user = claims;
    (req as any).auth = claims;
    (req as any).depot = claims.depotId;
    res.locals.user = claims;
  } catch {
    return res.status(401).json({ error: "unauthenticated" });
  }
  next();
}

export function depotOf(req: Request) {
  return (req as any).user.depotId as string;
}
"#;

const EXPRESS_SOURCES: &[Source] = &[
    caller("req-user", "", "(req as any).user.depotId"),
    caller("req-auth", "", "(req as any).auth.depotId"),
    caller("res-locals-user", "", "res.locals.user.depotId"),
    caller("req-session-user", "", "(req as any).session.user.depotId"),
    caller(
        "destructured",
        "const { user } = req as any;",
        "user.depotId",
    ),
    caller(
        "alias-several-hops",
        "const current = (req as any).user;\nconst mine = current.depotId;",
        "mine",
    ),
    caller("helper-called-with-the-request", "", "depotOf(req)"),
    caller("holder-a-middleware-sets", "", "(req as any).depot"),
    other("request-query", "", "req.query.depot"),
    other("request-params", "", "req.params.depot"),
    other("request-body", "", "req.body.depot"),
    other("request-header", "", "req.headers[\"x-depot\"]"),
    other("environment", "", "process.env.DEFAULT_DEPOT"),
];

fn express_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "import express from \"express\";\nimport {{ requireAuth, depotOf }} from \"./auth\";\n{}\nconst app = express();\napp.use(express.json());\n\n",
        imports("./lib")
    );
    for c in cells {
        out += &c.top;
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            let _ = writeln!(
                out,
                "app.get(\"/c{}/{kind}\", requireAuth, async (req, res) => {{\n{}\n{}\n  res.json(out);\n}});\n",
                c.n,
                indent(c.pre, "  "),
                indent(body, "  ")
            );
        }
    }
    out += "app.listen(3000);\n";
    Files::from([("src/server.ts".to_string(), out)])
}

fn http_keys(n: usize) -> (String, String) {
    (format!("GET /c{n}/scoped"), format!("GET /c{n}/plain"))
}

const EXPRESS: Framework = Framework {
    name: "express",
    shared: "src/lib",
    files: &[("package.json", API_PACKAGE), ("src/auth.ts", EXPRESS_AUTH)],
    sources: EXPRESS_SOURCES,
    lib: &KNEX,
    render: express_render,
    keys: http_keys,
};

// Fastify.

const FASTIFY_AUTH: &str = r#"import type { FastifyReply, FastifyRequest } from "fastify";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const claims = (await request.jwtVerify()) as any;
    (request as any).depot = claims.depotId;
  } catch {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}
"#;

const FASTIFY_SOURCES: &[Source] = &[
    caller("request-user", "", "(request.user as any).depotId"),
    caller(
        "alias-several-hops",
        "const user = request.user as any;\nconst { depotId } = user;",
        "depotId",
    ),
    caller("holder-a-hook-sets", "", "(request as any).depot"),
    other("request-query", "", "(request.query as any).depot"),
    other("request-params", "", "(request.params as any).depot"),
    other("request-body", "", "(request.body as any).depot"),
    other("request-header", "", "request.headers[\"x-depot\"]"),
    other("environment", "", "process.env.DEFAULT_DEPOT"),
];

fn fastify_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "import Fastify from \"fastify\";\nimport fastifyJwt from \"@fastify/jwt\";\nimport {{ authenticate }} from \"./auth\";\n{}\nconst app = Fastify();\napp.register(fastifyJwt, {{ secret: process.env.JWT_SECRET! }});\n\n",
        imports("./lib")
    );
    for c in cells {
        out += &c.top;
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            let _ = writeln!(
                out,
                "app.get(\"/c{}/{kind}\", {{ preHandler: [authenticate] }}, async (request, reply) => {{\n{}\n{}\n  return reply.send(out);\n}});\n",
                c.n,
                indent(c.pre, "  "),
                indent(body, "  ")
            );
        }
    }
    out += "app.listen({ port: 3000 });\n";
    Files::from([("src/server.ts".to_string(), out)])
}

const FASTIFY: Framework = Framework {
    name: "fastify",
    shared: "src/lib",
    files: &[("package.json", API_PACKAGE), ("src/auth.ts", FASTIFY_AUTH)],
    sources: FASTIFY_SOURCES,
    lib: &PG,
    render: fastify_render,
    keys: http_keys,
};

// Hono.

const HONO_AUTH: &str = r#"import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";

export const requireToken: MiddlewareHandler = async (c, next) => {
  try {
    const claims = await verify(String(c.req.header("authorization")), process.env.JWT_SECRET!);
    c.set("user", claims);
    c.set("claims", claims);
    c.set("depot", claims.depotId);
  } catch {
    return c.json({ error: "unauthenticated" }, 401);
  }
  await next();
};
"#;

const HONO_SOURCES: &[Source] = &[
    caller("context-get-user", "", "c.get(\"user\").depotId"),
    caller("context-var-claims", "", "c.var.claims.depotId"),
    caller(
        "alias-several-hops",
        "const user = c.get(\"user\");\nconst mine = user.depotId;",
        "mine",
    ),
    caller("holder-a-middleware-sets", "", "c.get(\"depot\")"),
    caller("holder-read-off-var", "", "c.var.depot"),
    read(
        How::Unread,
        other("request-query", "", "c.req.query(\"depot\")"),
    ),
    read(
        How::Unread,
        other("request-param", "", "c.req.param(\"depot\")"),
    ),
    read(
        How::Unread,
        other("request-header", "", "c.req.header(\"x-depot\")"),
    ),
    other("request-cookie", "", "getCookie(c, \"depot\")"),
    other("environment", "", "process.env.DEFAULT_DEPOT"),
];

fn hono_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "import {{ Hono }} from \"hono\";\nimport {{ getCookie }} from \"hono/cookie\";\nimport {{ requireToken }} from \"./auth\";\n{}\nconst app = new Hono<{{ Variables: {{ user: any; claims: any; depot: string }} }}>();\n\n",
        imports("./lib")
    );
    for c in cells {
        out += &c.top;
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            let _ = writeln!(
                out,
                "app.get(\"/c{}/{kind}\", requireToken, async (c) => {{\n{}\n{}\n  return c.json(out);\n}});\n",
                c.n,
                indent(c.pre, "  "),
                indent(body, "  ")
            );
        }
    }
    out += "export default app;\n";
    Files::from([("src/server.ts".to_string(), out)])
}

const HONO: Framework = Framework {
    name: "hono",
    shared: "src/lib",
    files: &[("package.json", API_PACKAGE), ("src/auth.ts", HONO_AUTH)],
    sources: HONO_SOURCES,
    lib: &KYSELY,
    render: hono_render,
    keys: http_keys,
};

// NestJS.

const NEST_GUARDS: &str = r#"import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import jwt from "jsonwebtoken";

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    req.user = jwt.verify(String(req.headers.authorization), process.env.JWT_SECRET!);
    return true;
  }
}

export const CurrentUser = createParamDecorator((key: string | undefined, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest().user;
  return key ? user?.[key] : user;
});
"#;

const NEST_SOURCES: &[Source] = &[
    with(
        "@CurrentUser() user: any",
        caller("current-user-decorator", "", "user.depotId"),
    ),
    with(
        "@CurrentUser(\"depotId\") mine: string",
        caller("current-user-decorator-with-a-key", "", "mine"),
    ),
    with(
        "@Req() req: any",
        caller("req-user", "", "req.user.depotId"),
    ),
    with(
        "@Request() request: any",
        caller(
            "request-user-alias",
            "const { user } = request;\nconst mine = user.depotId;",
            "mine",
        ),
    ),
    with(
        "@Session() session: any",
        caller("session-decorator", "", "session.user.depotId"),
    ),
    with(
        "@Query(\"depot\") depot: string",
        other("request-query", "", "depot"),
    ),
    with(
        "@Param(\"depot\") depot: string",
        other("request-param", "", "depot"),
    ),
    with("@Body() body: any", other("request-body", "", "body.depot")),
    with(
        "@Headers(\"x-depot\") depot: string",
        other("request-header", "", "depot"),
    ),
    other("environment", "", "process.env.DEFAULT_DEPOT"),
];

fn nest_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "import {{ Body, Controller, Get, Headers, Param, Query, Req, Request, Session, UseGuards }} from \"@nestjs/common\";\nimport {{ JwtGuard, CurrentUser }} from \"./guards\";\n{}\n",
        imports("./lib")
    );
    for c in cells {
        out += &c.top;
        let _ = writeln!(
            out,
            "@Controller(\"c{}\")\n@UseGuards(JwtGuard)\nexport class C{} {{",
            c.n, c.n
        );
        for (kind, name, body) in [
            ("scoped", "covered", &c.covered),
            ("plain", "open", &c.sibling),
        ] {
            let _ = writeln!(
                out,
                "  @Get(\"{kind}\")\n  async {name}({}) {{\n{}\n{}\n    return out;\n  }}\n",
                c.sig,
                indent(c.pre, "    "),
                indent(body, "    ")
            );
        }
        out += "}\n\n";
    }
    Files::from([("src/parcels.controller.ts".to_string(), out)])
}

const NEST: Framework = Framework {
    name: "nestjs",
    shared: "src/lib",
    files: &[
        ("package.json", API_PACKAGE),
        ("src/guards.ts", NEST_GUARDS),
    ],
    sources: NEST_SOURCES,
    lib: &TYPEORM_FIND,
    render: nest_render,
    keys: http_keys,
};

// tRPC.

const TRPC_BASE: &str = r#"import { initTRPC, TRPCError } from "@trpc/server";

type Ctx = { session?: { user: { id: string; depotId: string } } };
const t = initTRPC.context<Ctx>().create();
export const router = t.router;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { session: ctx.session, user: ctx.session.user, depot: ctx.session.user.depotId } });
});
"#;

const TRPC_SOURCES: &[Source] = &[
    caller("ctx-session-user", "", "ctx.session.user.depotId"),
    caller("ctx-user", "", "ctx.user.depotId"),
    caller(
        "destructured",
        "const { user } = ctx;\nconst { depotId } = user;",
        "depotId",
    ),
    caller("ctx-member-a-middleware-sets", "", "ctx.depot"),
    with("opts", caller("opts-ctx-user", "", "opts.ctx.user.depotId")),
    other("input", "", "input.depot"),
    other("environment", "", "process.env.DEFAULT_DEPOT"),
];

fn trpc_render(cells: &[Cell]) -> Files {
    let mut out = format!(
        "import {{ z }} from \"zod\";\nimport {{ router, protectedProcedure }} from \"./trpc\";\n{}\n",
        imports("./lib")
    );
    for c in cells {
        out += &c.top;
    }
    out += "export const appRouter = router({\n";
    for c in cells {
        let sig = if c.sig.is_empty() {
            "{ ctx, input }"
        } else {
            c.sig
        };
        for (kind, body) in [("scoped", &c.covered), ("plain", &c.sibling)] {
            let _ = writeln!(
                out,
                "  c{}{kind}: protectedProcedure.input(z.object({{ depot: z.string() }})).query(async ({sig}) => {{\n{}\n{}\n    return out;\n  }}),",
                c.n,
                indent(c.pre, "    "),
                indent(body, "    ")
            );
        }
    }
    out += "});\n";
    Files::from([("src/router.ts".to_string(), out)])
}

fn trpc_keys(n: usize) -> (String, String) {
    (format!("QUERY c{n}scoped"), format!("QUERY c{n}plain"))
}

const TRPC: Framework = Framework {
    name: "trpc",
    shared: "src/lib",
    files: &[("package.json", API_PACKAGE), ("src/trpc.ts", TRPC_BASE)],
    sources: TRPC_SOURCES,
    lib: &SEQUELIZE,
    render: trpc_render,
    keys: trpc_keys,
};

const FRAMEWORKS: &[&Framework] = &[&NEXT, &ACTIONS, &EXPRESS, &FASTIFY, &HONO, &NEST, &TRPC];

// ---------------------------------------------------------------------------
// Running.

/// What one cell must read, and what it is called.
struct Want {
    cell: String,
    state: &'static str,
    /// What the sibling reads: `none`, but where its work is not followed.
    sibling: &'static str,
    dump: String,
}

/// Writes one fixture, reads it, and holds each cell to what it must read. `key`
/// is the column the values are compared and filtered by, as a member and as SQL
/// names it: every `depotId` and `depot_id` of the fixture is written with it.
fn run(
    block: &str,
    f: &Framework,
    name: &str,
    key: (&str, &str),
    cells: Vec<Cell>,
    wants: Vec<Want>,
    failures: &mut Vec<String>,
) -> usize {
    let mut files: Files = f
        .files
        .iter()
        .map(|(path, body)| ((*path).to_string(), (*body).to_string()))
        .collect();
    files.insert(format!("{}/data.ts", f.shared), DATA.to_string());
    files.insert(format!("{}/extras.ts", f.shared), EXTRAS.to_string());
    files.insert(format!("{}/services.ts", f.shared), services("."));
    files.extend((f.render)(&cells));
    for text in files.values_mut() {
        *text = text.replace("depotId", key.0).replace("depot_id", key.1);
    }
    let dir = write(&files);
    if let Ok(keep) = std::env::var("DRIFT_MATRIX_KEEP") {
        for (rel, body) in &files {
            let to = Path::new(&keep)
                .join(block)
                .join(f.name)
                .join(name)
                .join(key.0)
                .join(rel);
            std::fs::create_dir_all(to.parent().unwrap()).unwrap();
            std::fs::write(to, body).unwrap();
        }
    }
    let map = authz(dir.path());
    let read = |key: &str| match map.get(key) {
        None => ("absent".to_string(), String::new()),
        Some((a, why)) => (a.clone(), why.clone()),
    };
    let mut dump = String::new();
    for (c, w) in cells.iter().zip(&wants) {
        let (covered, sibling) = (f.keys)(c.n);
        let (got, why) = read(&covered);
        let (sib, sib_why) = read(&sibling);
        let _ = writeln!(dump, "{block}\t{}\t{}\t{got}\t{sib}", w.dump, w.state);
        if got != w.state {
            failures.push(format!(
                "{}: {covered} reads {got} ({why}), expected {}",
                w.cell, w.state
            ));
        }
        if sib != w.sibling {
            failures.push(format!(
                "{}: the sibling {sibling} reads {sib} ({sib_why}), expected {}",
                w.cell, w.sibling
            ));
        }
    }
    if let Ok(path) = std::env::var("DRIFT_MATRIX_DUMP") {
        use std::io::Write as _;
        let mut out = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        out.write_all(dump.as_bytes()).unwrap();
    }
    cells.len()
}

/// What a use reads, by whose the value is and the library it goes through.
fn expected(reads: Reads, s: &Source, lib: &Lib, local_first: bool) -> &'static str {
    if s.how == How::Unread {
        return "unknown";
    }
    match (reads, s.caller) {
        (Reads::NoScope, _) => "none",
        (Reads::Forwards, _) => "unknown",
        (_, true) => "unknown",
        (Reads::Flows, false) => "none",
        (Reads::FlowsToFilter, false) => match lib.unsourced {
            Unsourced::Always => "unknown",
            Unsourced::WrittenAtTheCall if !local_first => "unknown",
            _ => "none",
        },
        (Reads::FlowsToWhere, false) => "unknown",
    }
}

/// The use hands a value to a method of a local (`out.push(p)`,
/// `["d1", "d2"].includes(...)`): a call that is not recorded, beside which a method
/// called through the request parameter is not read either ([`How::RequestCall`]).
fn calls_a_local_method(u: &Use) -> bool {
    matches!(u.name, "if-comparison" | "includes" | "index")
}

fn check(block: &str, cells: usize, want: usize, failures: Vec<String>) {
    assert_eq!(cells, want, "{block}: every cell is read");
    assert!(
        failures.is_empty(),
        "{block}: {} of {cells} cells fail\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Every source of one framework with every use: a fixture per use.
fn sources_and_uses(f: &Framework) {
    let mut failures = Vec::new();
    let mut read = 0;
    for u in USES {
        let mut cells = Vec::new();
        let mut wants = Vec::new();
        for (n, s) in f.sources.iter().enumerate() {
            let code = use_code(u, f.lib, s.v);
            cells.push(Cell {
                n,
                top: code.top,
                sig: s.sig,
                pre: s.pre,
                covered: code.covered,
                sibling: code.sibling,
            });
            let whose = if s.caller { "caller" } else { "not-caller" };
            wants.push(Want {
                cell: format!("{} / {} / {}", f.name, s.name, u.name),
                state: if s.how == How::RequestCall && calls_a_local_method(u) {
                    "unknown"
                } else {
                    expected(u.reads, s, f.lib, false)
                },
                sibling: "none",
                dump: format!(
                    "{}\t{}\t{}\t{}\t{whose}",
                    f.name, s.name, u.name, f.lib.name
                ),
            });
        }
        read += run(
            "sources-uses",
            f,
            u.name,
            ("depotId", "depot_id"),
            cells,
            wants,
            &mut failures,
        );
    }
    check(f.name, read, USES.len() * f.sources.len(), failures);
}

#[test]
fn every_source_in_every_use_next_route_handlers() {
    sources_and_uses(&NEXT);
}

#[test]
fn every_source_in_every_use_next_server_actions() {
    sources_and_uses(&ACTIONS);
}

#[test]
fn every_source_in_every_use_express() {
    sources_and_uses(&EXPRESS);
}

#[test]
fn every_source_in_every_use_fastify() {
    sources_and_uses(&FASTIFY);
}

#[test]
fn every_source_in_every_use_hono() {
    sources_and_uses(&HONO);
}

#[test]
fn every_source_in_every_use_nestjs() {
    sources_and_uses(&NEST);
}

#[test]
fn every_source_in_every_use_trpc() {
    sources_and_uses(&TRPC);
}

/// The keys the values are compared and filtered by, as a member and as SQL names
/// it: `depotId` (every block above), one named for a tenant, and names on no list.
const KEYS: &[(&str, &str)] = &[
    ("orgId", "org_id"),
    ("kennelId", "kennel_id"),
    ("guildId", "guild_id"),
    ("x", "x"),
];

/// The uses that compare or filter by the value.
const COMPARED: &[&str] = &[
    "library-filter",
    "orm-operators-and",
    "query-builder",
    "raw-sql-parameters",
    "tagged-template",
    "object-property",
    "if-comparison",
    "filter-callback",
    "find-callback",
    "some-callback",
];

/// Every source of every framework in every use that compares or filters by it, with
/// every key of [`KEYS`]: a value of the caller is read whatever the key is called,
/// never `none`, and what reads `none` with `depotId` reads `none` with a key on no
/// list.
#[test]
fn a_value_of_the_caller_is_read_whatever_the_key_is_called() {
    let mut failures = Vec::new();
    let mut read = 0;
    let mut want_cells = 0;
    for f in FRAMEWORKS {
        for key in KEYS {
            for u in USES.iter().filter(|u| COMPARED.contains(&u.name)) {
                let mut cells = Vec::new();
                let mut wants = Vec::new();
                for (n, s) in f.sources.iter().enumerate() {
                    let code = use_code(u, f.lib, s.v);
                    cells.push(Cell {
                        n,
                        top: code.top,
                        sig: s.sig,
                        pre: s.pre,
                        covered: code.covered,
                        sibling: code.sibling,
                    });
                    let whose = if s.caller { "caller" } else { "not-caller" };
                    wants.push(Want {
                        cell: format!("{} / {} / {} / {}", f.name, key.0, s.name, u.name),
                        state: keyed_expected(key.0, u, s, f.lib),
                        sibling: "none",
                        dump: format!("{}\t{}\t{}\t{}\t{whose}", f.name, s.name, u.name, key.0),
                    });
                }
                want_cells += cells.len();
                read += run("keys", f, u.name, *key, cells, wants, &mut failures);
            }
        }
    }
    check("keys", read, want_cells, failures);
}

/// What a cell of [`a_value_of_the_caller_is_read_whatever_the_key_is_called`]
/// reads: what it reads with `depotId`. A value of the caller is read whatever the
/// key is called; a key named for a tenant (`orgId`) is also read where the value
/// compared or filtered by is not the caller's (found, of a source no fact says:
/// unknown where `depotId` reads `none`).
fn keyed_expected(key: &str, u: &Use, s: &Source, lib: &Lib) -> &'static str {
    let want = if s.how == How::RequestCall && calls_a_local_method(u) {
        "unknown"
    } else {
        expected(u.reads, s, lib, false)
    };
    if key == "orgId" && !s.caller && want == "none" {
        "unknown"
    } else if key == "orgId" && want == "unknown" && own_value(s) && keyed_in_an_object(u, lib) {
        // TypeScript lowering 76: a key named for a tenant, filtered by a value that
        // is the caller's by its own source, written as the value of that key in an
        // object the query is given, is the route's tenancy filter. What only may
        // give a value of the caller (a helper, a holder a middleware sets) proves
        // nothing, and neither does a key on no list.
        "known"
    } else {
        want
    }
}

/// The source is a value of the caller by itself (the request's user, a session, a
/// decorated parameter), not what a helper hands back or a holder keeps: those may
/// give one, which a filter is not proven by.
fn own_value(s: &Source) -> bool {
    s.caller
        && !["helper-", "holder-", "ctx-member-", "what-"]
            .iter()
            .any(|given| s.name.starts_with(given))
}

/// The use writes the value as the value of the key in an object a query is given:
/// `{ where: { orgId: v } }`, and the filters of the libraries that take one.
fn keyed_in_an_object(u: &Use, lib: &Lib) -> bool {
    u.name == "object-property"
        || (u.name == "library-filter"
            && matches!(
                lib.name,
                "prisma" | "typeorm-find" | "sequelize" | "mongoose"
            ))
}

/// Every library in every position, the frameworks in turn: a fixture per library,
/// with the framework's first source of the caller and its first of the request.
fn libraries_and_positions(libs: &[&Lib], offset: usize) {
    let mut failures = Vec::new();
    let mut read = 0;
    for (i, lib) in libs.iter().enumerate() {
        let f = FRAMEWORKS[(i + offset) % FRAMEWORKS.len()];
        let of_caller = f.sources.iter().find(|s| s.caller).unwrap();
        let of_request = f.sources.iter().find(|s| !s.caller).unwrap();
        let mut cells = Vec::new();
        let mut wants = Vec::new();
        for p in POSITIONS {
            for s in [of_caller, of_request] {
                let n = cells.len();
                let code = position_code(*p, lib, s.v, n);
                cells.push(Cell {
                    n,
                    top: code.top,
                    sig: s.sig,
                    pre: s.pre,
                    covered: code.covered,
                    sibling: code.sibling,
                });
                let whose = if s.caller { "caller" } else { "not-caller" };
                wants.push(Want {
                    cell: format!("{} / {:?} / {} / {}", lib.name, p, f.name, s.name),
                    state: match p {
                        Position::ServiceInstance => "unknown",
                        _ => expected(Reads::FlowsToFilter, s, lib, *p == Position::TernaryLocal),
                    },
                    sibling: match p {
                        Position::ServiceInstance => "unknown",
                        _ => "none",
                    },
                    dump: format!("{}\t{}\t{:?}\t{}\t{whose}", f.name, s.name, p, lib.name),
                });
            }
        }
        read += run(
            "libraries-positions",
            f,
            lib.name,
            ("depotId", "depot_id"),
            cells,
            wants,
            &mut failures,
        );
    }
    check(
        "libraries and positions",
        read,
        libs.len() * POSITIONS.len() * 2,
        failures,
    );
}

#[test]
fn every_library_in_every_position_prisma_and_drizzle() {
    libraries_and_positions(&[&PRISMA, &DRIZZLE], 0);
}

#[test]
fn every_library_in_every_position_the_other_libraries() {
    libraries_and_positions(&LIBS[2..], 2);
}

/// A Next.js fixture of hand-written routes, by path under `app/api`.
fn next_routes(routes: &[(&str, &str)]) -> BTreeMap<String, (String, String)> {
    let mut files: Files = NEXT
        .files
        .iter()
        .map(|(path, body)| ((*path).to_string(), (*body).to_string()))
        .collect();
    files.insert("lib/data.ts".to_string(), DATA.to_string());
    files.insert("lib/extras.ts".to_string(), EXTRAS.to_string());
    files.insert("lib/services.ts".to_string(), services("."));
    let head = format!(
        "import {{ NextRequest, NextResponse }} from \"next/server\";\nimport {{ getSession, memberOf }} from \"@/lib/session\";\n{}",
        imports("@/lib")
    );
    for (path, body) in routes {
        files.insert(
            format!("app/api/{path}/route.ts"),
            format!(
                "{head}\nexport async function GET(req: NextRequest) {{\n{}\n}}\n",
                indent(body, "  ")
            ),
        );
    }
    authz(write(&files).path())
}

/// The other side stays: nothing becomes known by this rule. Two values of the
/// request compared are no tenant check, a scope in one arm of a branch is never
/// known, and a role check that was proven before is proven still.
#[test]
fn nothing_becomes_known_by_a_value_of_the_caller_in_use() {
    let map = next_routes(&[
        // The tenant the query string names against the one a header names: a
        // caller of any tenant passes by sending both.
        (
            "two-request-values",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nif (req.nextUrl.searchParams.get(\"orgId\") !== req.headers.get(\"x-org-id\")) {\n  return NextResponse.json({ error: \"forbidden\" }, { status: 403 });\n}\nreturn NextResponse.json(await prisma.rule.findMany());",
        ),
        // A filter by the session's tenant in one arm only.
        (
            "one-arm",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nconst rows = await prisma.rule.findMany({ where: flag ? undefined : { orgId: session.orgId } });\nreturn NextResponse.json(rows);",
        ),
        (
            "one-arm-drizzle",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nlet rows;\nif (flag) {\n  rows = await db.select().from(parcels);\n} else {\n  rows = await db.select().from(parcels).where(eq(parcels.depotId, session.depotId));\n}\nreturn NextResponse.json(rows);",
        ),
        // The row's tenant against the session's, before anything is answered.
        (
            "checked",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nconst rule = await prisma.rule.findFirst();\nif (!rule || rule.orgId !== session.orgId) {\n  return NextResponse.json({ error: \"forbidden\" }, { status: 403 });\n}\nreturn NextResponse.json(rule);",
        ),
        // The role of the session, before anything is answered.
        (
            "role",
            "const session = await getSession();\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nif (session.role !== \"admin\") {\n  return NextResponse.json({ error: \"forbidden\" }, { status: 403 });\n}\nreturn NextResponse.json(await prisma.rule.findMany());",
        ),
    ]);
    let read = |route: &str| {
        map.get(&format!("GET /api/{route}"))
            .unwrap_or_else(|| panic!("{route} is not listed: {map:?}"))
            .clone()
    };
    assert_eq!(read("two-request-values").0, "unknown");
    assert_eq!(read("one-arm").0, "unknown");
    assert_eq!(read("one-arm-drizzle").0, "unknown");
    // The row's tenant against the session's is proven, as it was. What made the
    // route unknown was the other half of the test (`!rule`, a 403 on what names
    // neither a role, a tenant nor an owner): beside a check every request passes,
    // a refusal the map cannot name turns more requests away, never fewer.
    assert_eq!(read("checked").0, "known");
    assert_eq!(read("role").0, "known");
}

/// The helper a route signs the caller in by is identification only while it does
/// nothing with a parameter of its own: one that is given what the request chose
/// and compares it with the caller's memberships may be the scope, so neither the
/// route nor a sibling that reads every row is a recorded absence.
#[test]
fn a_sign_in_helper_given_what_the_request_chose_may_scope() {
    let map = next_routes(&[(
        "members",
        "const session = await memberOf(req.nextUrl.searchParams.get(\"org\") ?? \"\");\nif (!session) return NextResponse.json({ error: \"unauthorized\" }, { status: 401 });\nreturn NextResponse.json(await db.select().from(parcels));",
    )]);
    assert_eq!(map["GET /api/members"].0, "unknown", "{map:?}");
}

// ---------------------------------------------------------------------------
// Channels out of the handler (NestJS).

/// How a value of the caller leaves the handler for the query: `@V@` is where the
/// service reads it back (`None` for the query bus, whose value is handed to the
/// query object by the handler itself).
const CHANNELS: &[(&str, Option<&str>)] = &[
    ("cls", Some("this.cls.get(\"museumId\")")),
    ("request-scoped", Some("this.req.@P@.museumId")),
    ("async-local-storage", Some("store.getStore()!.museumId")),
    ("module-holder", Some("getMuseum()")),
    ("query-bus", None),
];

/// The property of the request the guard puts who calls on.
const CALLER_PROPS: &[&str] = &["curator", "user", "member"];

/// A query that reads every row without the value, `@V@` where the value goes: a
/// MikroORM query builder, a TypeORM query builder, raw SQL.
const CHANNEL_QUERIES: &[(&str, &str)] = &[
    (
        "mikro-qb",
        "this.em.createQueryBuilder(Exhibit, \"e\").where(\"e.museum_id = ?\", [@V@]).getResult()",
    ),
    (
        "typeorm-qb",
        "this.repo.createQueryBuilder(\"e\").where(\"e.museumId = :m\").setParameter(\"m\", @V@).getMany()",
    ),
    (
        "raw-sql",
        "this.em.getConnection().execute(\"select * from exhibit where museum_id = ?\", [@V@])",
    ),
];

const CHANNEL_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@nestjs/jwt": "10.0.0", "@nestjs/cqrs": "10.0.0", "@nestjs/typeorm": "10.0.0", "nestjs-cls": "4.0.0", "@mikro-orm/core": "6.0.0", "typeorm": "0.3.20" } }
"#;

/// The guard puts who calls on the request under `@P@`, and in every channel.
const CHANNEL_GUARD: &str = r#"import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { store } from "./store";
import { setMuseum } from "./museum";

@Injectable()
export class CuratorGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly cls: ClsService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.headers.authorization;
    if (!token) throw new UnauthorizedException();
    const user = await this.jwt.verifyAsync(token);
    req.@P@ = user;
    this.cls.set("museumId", req.@P@.museumId);
    store.enterWith({ museumId: req.@P@.museumId });
    setMuseum(req.@P@.museumId);
    return true;
  }
}
"#;

const CHANNEL_SHARED: &[(&str, &str)] = &[
    (
        "src/store.ts",
        "import { AsyncLocalStorage } from \"node:async_hooks\";\nexport const store = new AsyncLocalStorage<{ museumId: string }>();\n",
    ),
    (
        "src/museum.ts",
        "let current: string | undefined;\nexport function setMuseum(museumId: string) {\n  current = museumId;\n}\nexport function getMuseum() {\n  return current;\n}\n",
    ),
    (
        "src/exhibit.entity.ts",
        "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
    ),
    (
        "src/app.module.ts",
        "import { Module } from \"@nestjs/common\";\nimport { APP_GUARD } from \"@nestjs/core\";\nimport { ExhibitsController } from \"./exhibits.controller\";\nimport { CuratorGuard } from \"./guard\";\n@Module({ controllers: [ExhibitsController], providers: [{ provide: APP_GUARD, useClass: CuratorGuard }] })\nexport class AppModule {}\n",
    ),
];

/// [STRICT] A value of the caller that leaves the handler through a channel
/// (`nestjs-cls`, a request-scoped provider given `@Inject(REQUEST)`, an
/// `AsyncLocalStorage` store, a module-level holder set per request, a CQRS
/// `QueryBus` query object) and reaches a query there is never `none`, whatever
/// property of the request the guard put who calls on, whatever the query (a
/// MikroORM or TypeORM query builder, raw SQL), and whether the controller's
/// service reads it or a second service the first calls. The handler itself reads
/// no value of the caller (but for the query bus, which hands it to the query
/// object). Each cell has a sibling route that runs the same query with a literal:
/// it reads `none`.
#[test]
fn a_value_of_the_caller_through_a_channel_is_never_none() {
    let mut failures = Vec::new();
    let mut cells = 0;
    for prop in CALLER_PROPS {
        let mut services = String::from(
            "import { Controller, Get, Inject, Injectable, Param, Req, Scope } from \"@nestjs/common\";\nimport { REQUEST } from \"@nestjs/core\";\nimport { IQueryHandler, QueryBus, QueryHandler } from \"@nestjs/cqrs\";\nimport { InjectRepository } from \"@nestjs/typeorm\";\nimport { ClsService } from \"nestjs-cls\";\nimport { EntityManager } from \"@mikro-orm/core\";\nimport { Repository } from \"typeorm\";\nimport { Exhibit } from \"./exhibit.entity\";\nimport { store } from \"./store\";\nimport { getMuseum } from \"./museum\";\n\n",
        );
        let mut injected = Vec::new();
        let mut routes = String::new();
        let mut keys = Vec::new();
        let mut n = 0;
        for (channel, read) in CHANNELS {
            for (query, q) in CHANNEL_QUERIES {
                for second in [false, true] {
                    n += 1;
                    let cell = format!(
                        "{prop} x {channel} x {query} x {}",
                        if second { "second service" } else { "direct" }
                    );
                    let deps = "private readonly em: EntityManager, @InjectRepository(Exhibit) private readonly repo: Repository<Exhibit>, private readonly cls: ClsService";
                    let literal = q.replace("@V@", "\"m1\"");
                    match read {
                        Some(read) => {
                            let v = read.replace("@P@", prop);
                            let scoped = q.replace("@V@", &v);
                            let (scope, req) = if *channel == "request-scoped" {
                                (
                                    "{ scope: Scope.REQUEST }",
                                    ", @Inject(REQUEST) private readonly req: any",
                                )
                            } else {
                                ("", "")
                            };
                            services += &format!(
                                "@Injectable({scope})\nexport class S{n} {{\n  constructor({deps}{req}) {{}}\n  list() {{\n    return {scoped};\n  }}\n  plain() {{\n    return {literal};\n  }}\n}}\n\n"
                            );
                            let target = if second {
                                services += &format!(
                                    "@Injectable()\nexport class O{n} {{\n  constructor(private readonly inner: S{n}) {{}}\n  list() {{\n    return this.inner.list();\n  }}\n  plain() {{\n    return this.inner.plain();\n  }}\n}}\n\n"
                                );
                                format!("O{n}")
                            } else {
                                format!("S{n}")
                            };
                            injected.push(format!("private readonly s{n}: {target}"));
                            routes += &format!(
                                "  @Get(\"k{n}\")\n  k{n}() {{\n    return this.s{n}.list();\n  }}\n  @Get(\"p{n}\")\n  p{n}() {{\n    return this.s{n}.plain();\n  }}\n"
                            );
                        }
                        None => {
                            let (scoped, plain) = if second {
                                services += &format!(
                                    "@Injectable()\nexport class R{n} {{\n  constructor({deps}) {{}}\n  run(museumId: string) {{\n    return {};\n  }}\n}}\n\n",
                                    q.replace("@V@", "museumId")
                                );
                                (
                                    format!(
                                        "constructor(private readonly runner: R{n}) {{}}\n  execute(q: Q{n}) {{\n    return this.runner.run(q.museumId);\n  }}"
                                    ),
                                    format!(
                                        "constructor(private readonly runner: R{n}) {{}}\n  execute(q: P{n}) {{\n    return this.runner.run(\"m1\");\n  }}"
                                    ),
                                )
                            } else {
                                (
                                    format!(
                                        "constructor({deps}) {{}}\n  execute(q: Q{n}) {{\n    return {};\n  }}",
                                        q.replace("@V@", "q.museumId")
                                    ),
                                    format!(
                                        "constructor({deps}) {{}}\n  execute(q: P{n}) {{\n    return {literal};\n  }}"
                                    ),
                                )
                            };
                            services += &format!(
                                "export class Q{n} {{\n  constructor(public readonly museumId: string) {{}}\n}}\n@QueryHandler(Q{n})\nexport class QH{n} implements IQueryHandler<Q{n}> {{\n  {scoped}\n}}\n\nexport class P{n} {{\n  constructor(public readonly museumId: string) {{}}\n}}\n@QueryHandler(P{n})\nexport class PH{n} implements IQueryHandler<P{n}> {{\n  {plain}\n}}\n\n"
                            );
                            routes += &format!(
                                "  @Get(\"k{n}\")\n  k{n}(@Req() req: any) {{\n    return this.queryBus.execute(new Q{n}(req.{prop}.museumId));\n  }}\n  @Get(\"p{n}\")\n  p{n}(@Req() req: any) {{\n    return this.queryBus.execute(new P{n}(\"m1\"));\n  }}\n"
                            );
                        }
                    }
                    keys.push((n, cell));
                }
            }
        }
        injected.push("private readonly queryBus: QueryBus".to_string());
        services += &format!(
            "@Controller(\"c\")\nexport class ExhibitsController {{\n  constructor({}) {{}}\n{routes}}}\n",
            injected.join(", ")
        );
        let mut files: Files = CHANNEL_SHARED
            .iter()
            .map(|(p, b)| ((*p).to_string(), (*b).to_string()))
            .collect();
        files.insert("package.json".into(), CHANNEL_PACKAGE.into());
        files.insert("src/guard.ts".into(), CHANNEL_GUARD.replace("@P@", prop));
        files.insert("src/exhibits.controller.ts".into(), services);
        let dir = write(&files);
        if let Ok(keep) = std::env::var("DRIFT_MATRIX_KEEP") {
            for (rel, body) in &files {
                let to = Path::new(&keep).join("channels").join(prop).join(rel);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::write(to, body).unwrap();
            }
        }
        let map = authz(dir.path());
        for (n, cell) in keys {
            cells += 1;
            let read = |key: String| {
                map.get(&key)
                    .cloned()
                    .unwrap_or(("absent".into(), String::new()))
            };
            let (got, why) = read(format!("GET /c/k{n}"));
            let (sib, sib_why) = read(format!("GET /c/p{n}"));
            if got == "none" || got == "absent" {
                failures.push(format!("{cell}: reads {got} ({why})"));
            }
            if sib != "none" {
                failures.push(format!(
                    "{cell}: the sibling reads {sib} ({sib_why}), expected none"
                ));
            }
        }
    }
    assert_eq!(
        cells,
        CALLER_PROPS.len() * CHANNELS.len() * CHANNEL_QUERIES.len() * 2
    );
    assert!(
        failures.is_empty(),
        "{} of {cells} cells wrong:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// ---------------------------------------------------------------------------
// What the repository configures outside the route (NestJS).

const OUTSIDE_PACKAGE: &str = r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@prisma/client": "5.20.0", "mongoose": "8.5.0", "@mikro-orm/core": "6.0.0", "sequelize": "6.37.0", "typeorm": "0.3.20", "kysely": "0.27.0", "@nestjs/mongoose": "10.0.0", "@mikro-orm/nestjs": "6.0.0", "casbin": "5.30.0", "@cerbos/grpc": "0.18.0", "rxjs": "7.8.0" } }
"#;

const OUTSIDE_GUARD: &str = "import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from \"@nestjs/common\";\n@Injectable()\nexport class SignedIn implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    const req = context.switchToHttp().getRequest();\n    if (!req.headers.authorization) throw new UnauthorizedException();\n    return true;\n  }\n}\n";

const OUTSIDE_STORE: &str = "import { AsyncLocalStorage } from \"node:async_hooks\";\nexport const store = new AsyncLocalStorage<{ museumId: string }>();\n";

/// A Nest application whose one route `GET /exhibits` is `route` (with `imports`
/// above the controller, `@UseInterceptors` on the controller when `on_class`),
/// with these further files.
fn outside_app(
    imports: &str,
    on_class: &str,
    route: &str,
    providers: &str,
    main: &str,
    more: &[(&str, &str)],
) -> Files {
    let mut files = Files::new();
    files.insert("package.json".into(), OUTSIDE_PACKAGE.into());
    files.insert("src/guard.ts".into(), OUTSIDE_GUARD.into());
    files.insert("src/store.ts".into(), OUTSIDE_STORE.into());
    files.insert(
        "src/exhibits.controller.ts".into(),
        format!(
            "import {{ Controller, ForbiddenException, Get, Req, Res, UseGuards, UseInterceptors }} from \"@nestjs/common\";\nimport {{ SignedIn }} from \"./guard\";\n{imports}\n@Controller(\"exhibits\")\n@UseGuards(SignedIn)\n{on_class}export class ExhibitsController {{\n{route}}}\n"
        ),
    );
    files.insert(
        "src/app.module.ts".into(),
        format!(
            "import {{ Module }} from \"@nestjs/common\";\nimport {{ APP_INTERCEPTOR }} from \"@nestjs/core\";\nimport {{ ExhibitsController }} from \"./exhibits.controller\";\nimport * as i from \"./interceptor\";\n@Module({{ controllers: [ExhibitsController], providers: [{providers}] }})\nexport class AppModule {{}}\n"
        ),
    );
    files.insert(
        "src/main.ts".into(),
        format!(
            "import {{ NestFactory }} from \"@nestjs/core\";\nimport {{ AppModule }} from \"./app.module\";\nimport * as i from \"./interceptor\";\nasync function bootstrap() {{\n  const app = await NestFactory.create(AppModule);\n{main}  await app.listen(3000);\n}}\nbootstrap();\n"
        ),
    );
    files.insert("src/interceptor.ts".into(), "export {};\n".into());
    for (path, body) in more {
        files.insert((*path).to_string(), (*body).to_string());
    }
    files
}

/// A filter the data layer adds: its name, the controller's imports, the route,
/// the files that configure it, and the same files without it.
type FilterShape<'a> = (
    &'a str,
    &'a str,
    &'a str,
    &'a [(&'a str, &'a str)],
    &'a [(&'a str, &'a str)],
);

fn outside_read(files: &Files) -> (String, String) {
    let dir = write(files);
    authz(dir.path())
        .get("GET /exhibits")
        .cloned()
        .unwrap_or_else(|| ("absent".into(), String::new()))
}

/// [STRICT] Round 11's default for authorization: what a library lets the
/// repository configure outside the route, and Drift does not model, makes the
/// routes it may reach unknown, never `none`; and a decision computed and not used
/// to refuse is no check, never `known`. As a matrix:
///
/// - **a filter the data layer adds to every query** (Prisma `$extends` and `$use`,
///   Mongoose query middleware and plugins, a MikroORM `@Filter` with its
///   parameters set in a middleware, a Sequelize default scope and `addScope`, a
///   TypeORM `@EventSubscriber`; and more than one spelling of a shape: MikroORM
///   `filters` in `defineConfig(...)`, in options bound to a name and exported, in
///   a `MikroOrmModule` factory; query middleware in a file that imports only
///   `@nestjs/mongoose`, mongoose's types, or nothing of the library, and `post`;
///   Kysely `plugins` and `withPlugin`; TypeORM `subscribers` of a `DataSource`),
///   each beside a route whose query carries no filter: unknown; the same
///   repository without the configuration reads `none`;
/// - **a NestJS interceptor** whose `intercept` refuses (before `next.handle()`, or
///   in a `tap()` after it) at every place it is registered (the route, the
///   controller, `APP_INTERCEPTOR`, `useGlobalInterceptors`): unknown; one that
///   only logs, at every place: `none`;
/// - **a policy decision** (`enforcer.enforce(...)`, `cerbos.checkResource(...)`)
///   written to a header, logged, or dropped: unknown, never `known`; used to
///   refuse: not `none`.
#[test]
fn what_the_repository_configures_outside_the_route_is_never_none() {
    let mut failures = Vec::new();
    let mut cells = 0;
    let mut check = |cell: String, files: Files, want: &[&str]| {
        cells += 1;
        let (got, why) = outside_read(&files);
        if !want.contains(&got.as_str()) {
            failures.push(format!("{cell}: reads {got} ({why}), expected {want:?}"));
        }
    };
    const PRISMA_ROUTE: &str = "  @Get()\n  all() {\n    return prisma.exhibit.findMany();\n  }\n";
    const PRISMA_IMPORT: &str = "import { prisma } from \"./db\";\n";
    let filters: &[FilterShape] = &[
        (
            "prisma $extends",
            PRISMA_IMPORT,
            PRISMA_ROUTE,
            &[(
                "src/db.ts",
                "import { PrismaClient } from \"@prisma/client\";\nimport { store } from \"./store\";\nexport const prisma = new PrismaClient().$extends({\n  query: {\n    $allModels: {\n      async findMany({ args, query }) {\n        args.where = { ...args.where, museumId: store.getStore()?.museumId };\n        return query(args);\n      },\n    },\n  },\n});\n",
            )],
            &[(
                "src/db.ts",
                "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
            )],
        ),
        (
            "prisma $use",
            PRISMA_IMPORT,
            PRISMA_ROUTE,
            &[(
                "src/db.ts",
                "import { PrismaClient } from \"@prisma/client\";\nimport { store } from \"./store\";\nconst base = new PrismaClient();\nbase.$use(async (params, next) => {\n  params.args = { ...params.args, where: { ...params.args?.where, museumId: store.getStore()?.museumId } };\n  return next(params);\n});\nexport const prisma = base;\n",
            )],
            &[(
                "src/db.ts",
                "import { PrismaClient } from \"@prisma/client\";\nconst base = new PrismaClient();\nexport const prisma = base;\n",
            )],
        ),
        (
            "mongoose pre find",
            "import { Exhibit } from \"./db\";\n",
            "  @Get()\n  all() {\n    return Exhibit.find();\n  }\n",
            &[(
                "src/db.ts",
                "import mongoose from \"mongoose\";\nimport { store } from \"./store\";\nconst schema = new mongoose.Schema({ museumId: String });\nschema.pre(\"find\", function () {\n  this.where({ museumId: store.getStore()?.museumId });\n});\nexport const Exhibit = mongoose.model(\"Exhibit\", schema);\n",
            )],
            &[(
                "src/db.ts",
                "import mongoose from \"mongoose\";\nconst schema = new mongoose.Schema({ museumId: String });\nexport const Exhibit = mongoose.model(\"Exhibit\", schema);\n",
            )],
        ),
        (
            "mongoose plugin",
            "import { Exhibit } from \"./db\";\n",
            "  @Get()\n  all() {\n    return Exhibit.find();\n  }\n",
            &[
                (
                    "src/db.ts",
                    "import mongoose from \"mongoose\";\nimport { museumScope } from \"./scope\";\nconst schema = new mongoose.Schema({ museumId: String });\nschema.plugin(museumScope);\nexport const Exhibit = mongoose.model(\"Exhibit\", schema);\n",
                ),
                (
                    "src/scope.ts",
                    "export function museumScope(schema: any) {\n  schema.pre(/^find/, function (this: any) {\n    this.where({ museumId: \"m\" });\n  });\n}\n",
                ),
            ],
            &[(
                "src/db.ts",
                "import mongoose from \"mongoose\";\nconst schema = new mongoose.Schema({ museumId: String });\nexport const Exhibit = mongoose.model(\"Exhibit\", schema);\n",
            )],
        ),
        (
            "mikro-orm filter",
            "import { EntityManager } from \"@mikro-orm/core\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly em: EntityManager) {}\n  @Get()\n  all() {\n    return this.em.find(Exhibit, {});\n  }\n",
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, Filter, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\n@Filter({ name: \"museum\", cond: (args) => ({ museumId: args.museumId }), default: true })\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/museum.middleware.ts",
                    "import { Injectable, NestMiddleware } from \"@nestjs/common\";\nimport { EntityManager } from \"@mikro-orm/core\";\n@Injectable()\nexport class MuseumMiddleware implements NestMiddleware {\n  constructor(private readonly em: EntityManager) {}\n  use(req: any, res: any, next: () => void) {\n    this.em.setFilterParams(\"museum\", { museumId: req.curator.museumId });\n    next();\n  }\n}\n",
                ),
            ],
            &[(
                "src/exhibit.entity.ts",
                "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
            )],
        ),
        (
            "sequelize default scope",
            "import { Exhibit } from \"./db\";\n",
            "  @Get()\n  all() {\n    return Exhibit.findAll();\n  }\n",
            &[(
                "src/db.ts",
                "import { DataTypes, Model, Sequelize } from \"sequelize\";\nimport { store } from \"./store\";\nconst sequelize = new Sequelize(process.env.DATABASE_URL!);\nexport class Exhibit extends Model {}\nExhibit.init({ museumId: DataTypes.STRING }, { sequelize, defaultScope: { where: { museumId: \"m\" } } });\nExhibit.addScope(\"museum\", () => ({ where: { museumId: store.getStore()?.museumId } }));\n",
            )],
            &[(
                "src/db.ts",
                "import { DataTypes, Model, Sequelize } from \"sequelize\";\nconst sequelize = new Sequelize(process.env.DATABASE_URL!);\nexport class Exhibit extends Model {}\nExhibit.init({ museumId: DataTypes.STRING }, { sequelize });\n",
            )],
        ),
        (
            "typeorm subscriber",
            "import { DataSource } from \"typeorm\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly ds: DataSource) {}\n  @Get()\n  all() {\n    return this.ds.getRepository(Exhibit).find();\n  }\n",
            &[(
                "src/exhibit.entity.ts",
                "import { Column, Entity, EntitySubscriberInterface, EventSubscriber, InsertEvent, PrimaryColumn } from \"typeorm\";\nimport { store } from \"./store\";\n@Entity()\nexport class Exhibit {\n  @PrimaryColumn() id!: string;\n  @Column() museumId!: string;\n}\n@EventSubscriber()\nexport class MuseumSubscriber implements EntitySubscriberInterface<Exhibit> {\n  beforeInsert(event: InsertEvent<Exhibit>) {\n    event.entity.museumId = store.getStore()!.museumId;\n  }\n}\n",
            )],
            &[(
                "src/exhibit.entity.ts",
                "import { Column, Entity, PrimaryColumn } from \"typeorm\";\n@Entity()\nexport class Exhibit {\n  @PrimaryColumn() id!: string;\n  @Column() museumId!: string;\n}\n",
            )],
        ),
        // More spellings of the same shapes: a configuration object of the
        // library (written in its call, bound to a name and exported, given to
        // the Nest module), query middleware in a file that imports only
        // `@nestjs/mongoose`, its types, or nothing of the library, and Kysely's
        // plugins.
        (
            "mikro-orm defineConfig filters",
            "import { EntityManager } from \"@mikro-orm/core\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly em: EntityManager) {}\n  @Get()\n  all() {\n    return this.em.find(Exhibit, {});\n  }\n",
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/mikro-orm.config.ts",
                    "import { defineConfig } from \"@mikro-orm/core\";\nimport { store } from \"./store\";\nexport default defineConfig({ entities: [\"dist/**/*.entity.js\"], filters: { museum: { cond: () => ({ museumId: store.getStore()?.museumId }), default: true } } });\n",
                ),
            ],
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/mikro-orm.config.ts",
                    "import { defineConfig } from \"@mikro-orm/core\";\nexport default defineConfig({ entities: [\"dist/**/*.entity.js\"] });\n",
                ),
            ],
        ),
        (
            "mikro-orm options bound to a name and exported",
            "import { EntityManager } from \"@mikro-orm/core\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly em: EntityManager) {}\n  @Get()\n  all() {\n    return this.em.find(Exhibit, {});\n  }\n",
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/mikro-orm.config.ts",
                    "import type { Options } from \"@mikro-orm/core\";\nimport { store } from \"./store\";\nconst config: Options = { entities: [\"dist/**/*.entity.js\"], filters: { museum: { cond: () => ({ museumId: store.getStore()?.museumId }), default: true } } };\nexport default config;\n",
                ),
            ],
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/mikro-orm.config.ts",
                    "import type { Options } from \"@mikro-orm/core\";\nconst config: Options = { entities: [\"dist/**/*.entity.js\"] };\nexport default config;\n",
                ),
            ],
        ),
        (
            "mikro-orm options given to MikroOrmModule",
            "import { EntityManager } from \"@mikro-orm/core\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly em: EntityManager) {}\n  @Get()\n  all() {\n    return this.em.find(Exhibit, {});\n  }\n",
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/db.module.ts",
                    "import { MikroOrmModule } from \"@mikro-orm/nestjs\";\nimport { store } from \"./store\";\nexport const Db = MikroOrmModule.forRootAsync({ useFactory: () => ({ entities: [\"dist/**/*.entity.js\"], filters: { museum: { cond: () => ({ museumId: store.getStore()?.museumId }), default: true } } }) });\n",
                ),
            ],
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Entity, PrimaryKey, Property } from \"@mikro-orm/core\";\n@Entity()\nexport class Exhibit {\n  @PrimaryKey() id!: string;\n  @Property() museumId!: string;\n}\n",
                ),
                (
                    "src/db.module.ts",
                    "import { MikroOrmModule } from \"@mikro-orm/nestjs\";\nexport const Db = MikroOrmModule.forRootAsync({ useFactory: () => ({ entities: [\"dist/**/*.entity.js\"] }) });\n",
                ),
            ],
        ),
        (
            "@nestjs/mongoose schema pre find",
            "import { InjectModel } from \"@nestjs/mongoose\";\nimport { Model } from \"mongoose\";\nimport { Exhibit } from \"./exhibit.schema\";\n",
            "  constructor(@InjectModel(Exhibit.name) private readonly exhibits: Model<Exhibit>) {}\n  @Get()\n  all() {\n    return this.exhibits.find();\n  }\n",
            &[(
                "src/exhibit.schema.ts",
                "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\nExhibitSchema.pre(\"find\", function () {\n  this.where({ museumId: store.getStore()?.museumId });\n});\n",
            )],
            &[(
                "src/exhibit.schema.ts",
                "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\n",
            )],
        ),
        (
            "@nestjs/mongoose schema pre find, mongoose's types imported",
            "import { InjectModel } from \"@nestjs/mongoose\";\nimport { Model } from \"mongoose\";\nimport { Exhibit } from \"./exhibit.schema\";\n",
            "  constructor(@InjectModel(Exhibit.name) private readonly exhibits: Model<Exhibit>) {}\n  @Get()\n  all() {\n    return this.exhibits.find();\n  }\n",
            &[(
                "src/exhibit.schema.ts",
                "import type { Document } from \"mongoose\";\nimport { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\nExhibitSchema.pre(\"find\", function () {\n  this.where({ museumId: store.getStore()?.museumId });\n});\n",
            )],
            &[(
                "src/exhibit.schema.ts",
                "import type { Document } from \"mongoose\";\nimport { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\n",
            )],
        ),
        (
            "schema pre find in a file that imports nothing of the library",
            "import { InjectModel } from \"@nestjs/mongoose\";\nimport { Model } from \"mongoose\";\nimport { Exhibit } from \"./exhibit.schema\";\n",
            "  constructor(@InjectModel(Exhibit.name) private readonly exhibits: Model<Exhibit>) {}\n  @Get()\n  all() {\n    return this.exhibits.find();\n  }\n",
            &[
                (
                    "src/exhibit.schema.ts",
                    "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\n",
                ),
                (
                    "src/exhibit.hooks.ts",
                    "import { ExhibitSchema } from \"./exhibit.schema\";\nimport { store } from \"./store\";\nExhibitSchema.pre(\"find\", function () {\n  this.where({ museumId: store.getStore()?.museumId });\n});\n",
                ),
            ],
            &[(
                "src/exhibit.schema.ts",
                "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\n",
            )],
        ),
        (
            "schema post findOne",
            "import { InjectModel } from \"@nestjs/mongoose\";\nimport { Model } from \"mongoose\";\nimport { Exhibit } from \"./exhibit.schema\";\n",
            "  constructor(@InjectModel(Exhibit.name) private readonly exhibits: Model<Exhibit>) {}\n  @Get()\n  all() {\n    return this.exhibits.find();\n  }\n",
            &[(
                "src/exhibit.schema.ts",
                "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\nExhibitSchema.post(\"findOne\", function (doc: any) {\n  if (doc && doc.museumId !== store.getStore()?.museumId) throw new Error(\"forbidden\");\n});\n",
            )],
            &[(
                "src/exhibit.schema.ts",
                "import { Prop, Schema, SchemaFactory } from \"@nestjs/mongoose\";\nimport { store } from \"./store\";\n@Schema()\nexport class Exhibit {\n  @Prop() museumId!: string;\n}\nexport const ExhibitSchema = SchemaFactory.createForClass(Exhibit);\n",
            )],
        ),
        (
            "kysely plugins",
            "import { db } from \"./db\";\n",
            "  @Get()\n  all() {\n    return db.selectFrom(\"exhibit\").selectAll().execute();\n  }\n",
            &[
                (
                    "src/db.ts",
                    "import { Kysely, PostgresDialect } from \"kysely\";\nimport { TenantPlugin } from \"./tenant.plugin\";\nexport const db = new Kysely<any>({ dialect: new PostgresDialect({} as any), plugins: [new TenantPlugin()] });\n",
                ),
                (
                    "src/tenant.plugin.ts",
                    "import type { KyselyPlugin } from \"kysely\";\nimport { store } from \"./store\";\nexport class TenantPlugin implements KyselyPlugin {\n  transformQuery(args: any) {\n    return { ...args.node, where: { museumId: store.getStore()?.museumId } };\n  }\n  async transformResult(args: any) {\n    return args.result;\n  }\n}\n",
                ),
            ],
            &[(
                "src/db.ts",
                "import { Kysely, PostgresDialect } from \"kysely\";\nexport const db = new Kysely<any>({ dialect: new PostgresDialect({} as any) });\n",
            )],
        ),
        (
            "kysely withPlugin",
            "import { db } from \"./db\";\n",
            "  @Get()\n  all() {\n    return db.selectFrom(\"exhibit\").selectAll().execute();\n  }\n",
            &[
                (
                    "src/db.ts",
                    "import { Kysely, PostgresDialect } from \"kysely\";\nimport { TenantPlugin } from \"./tenant.plugin\";\nconst base = new Kysely<any>({ dialect: new PostgresDialect({} as any) });\nexport const db = base.withPlugin(new TenantPlugin());\n",
                ),
                (
                    "src/tenant.plugin.ts",
                    "import type { KyselyPlugin } from \"kysely\";\nimport { store } from \"./store\";\nexport class TenantPlugin implements KyselyPlugin {\n  transformQuery(args: any) {\n    return { ...args.node, where: { museumId: store.getStore()?.museumId } };\n  }\n  async transformResult(args: any) {\n    return args.result;\n  }\n}\n",
                ),
            ],
            &[(
                "src/db.ts",
                "import { Kysely, PostgresDialect } from \"kysely\";\nexport const db = new Kysely<any>({ dialect: new PostgresDialect({} as any) });\n",
            )],
        ),
        (
            "typeorm DataSource subscribers",
            "import { DataSource } from \"typeorm\";\nimport { Exhibit } from \"./exhibit.entity\";\n",
            "  constructor(private readonly ds: DataSource) {}\n  @Get()\n  all() {\n    return this.ds.getRepository(Exhibit).find();\n  }\n",
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Column, Entity, EntitySubscriberInterface, InsertEvent, PrimaryColumn } from \"typeorm\";\nimport { store } from \"./store\";\n@Entity()\nexport class Exhibit {\n  @PrimaryColumn() id!: string;\n  @Column() museumId!: string;\n}\nexport class MuseumSubscriber implements EntitySubscriberInterface<Exhibit> {\n  beforeInsert(event: InsertEvent<Exhibit>) {\n    event.entity.museumId = store.getStore()!.museumId;\n  }\n}\n",
                ),
                (
                    "src/data-source.ts",
                    "import { DataSource } from \"typeorm\";\nimport { Exhibit, MuseumSubscriber } from \"./exhibit.entity\";\nexport const ds = new DataSource({ type: \"postgres\", entities: [Exhibit], subscribers: [MuseumSubscriber] });\n",
                ),
            ],
            &[
                (
                    "src/exhibit.entity.ts",
                    "import { Column, Entity, EntitySubscriberInterface, InsertEvent, PrimaryColumn } from \"typeorm\";\nimport { store } from \"./store\";\n@Entity()\nexport class Exhibit {\n  @PrimaryColumn() id!: string;\n  @Column() museumId!: string;\n}\nexport class MuseumSubscriber implements EntitySubscriberInterface<Exhibit> {\n  beforeInsert(event: InsertEvent<Exhibit>) {\n    event.entity.museumId = store.getStore()!.museumId;\n  }\n}\n",
                ),
                (
                    "src/data-source.ts",
                    "import { DataSource } from \"typeorm\";\nimport { Exhibit } from \"./exhibit.entity\";\nexport const ds = new DataSource({ type: \"postgres\", entities: [Exhibit] });\n",
                ),
            ],
        ),
    ];
    for (name, imports, route, with, without) in filters {
        check(
            name.to_string(),
            outside_app(imports, "", route, "", "", with),
            &["unknown"],
        );
        check(
            format!("{name}, without it"),
            outside_app(imports, "", route, "", "", without),
            &["none"],
        );
    }

    let interceptors: &[(&str, &str, &[&str])] = &[
        (
            "before next.handle()",
            "import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from \"@nestjs/common\";\n@Injectable()\nexport class Museum implements NestInterceptor {\n  intercept(ctx: ExecutionContext, next: CallHandler) {\n    const req = ctx.switchToHttp().getRequest();\n    if (req.user.museumId !== req.params.museumId) throw new ForbiddenException();\n    return next.handle();\n  }\n}\n",
            &["unknown", "known"],
        ),
        (
            "in tap() after next.handle()",
            "import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from \"@nestjs/common\";\nimport { tap } from \"rxjs\";\n@Injectable()\nexport class Museum implements NestInterceptor {\n  intercept(ctx: ExecutionContext, next: CallHandler) {\n    const req = ctx.switchToHttp().getRequest();\n    return next.handle().pipe(tap((row: any) => {\n      if (row.museumId !== req.user.museumId) throw new ForbiddenException();\n    }));\n  }\n}\n",
            &["unknown"],
        ),
        (
            "that only logs",
            "import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from \"@nestjs/common\";\nimport { tap } from \"rxjs\";\n@Injectable()\nexport class Museum implements NestInterceptor {\n  intercept(ctx: ExecutionContext, next: CallHandler) {\n    const started = Date.now();\n    return next.handle().pipe(tap(() => console.log(Date.now() - started)));\n  }\n}\n",
            &["none"],
        ),
    ];
    let route_db = [(
        "src/db.ts",
        "import { PrismaClient } from \"@prisma/client\";\nexport const prisma = new PrismaClient();\n",
    )];
    for (kind, body, want) in interceptors {
        let mut more: Vec<(&str, &str)> = route_db.to_vec();
        more.push(("src/interceptor.ts", body));
        let imports =
            "import { prisma } from \"./db\";\nimport { Museum } from \"./interceptor\";\n";
        for (place, on_class, route, providers, main) in [
            (
                "on the route",
                "",
                "  @Get()\n  @UseInterceptors(Museum)\n  all() {\n    return prisma.exhibit.deleteMany();\n  }\n",
                "",
                "",
            ),
            (
                "on the controller",
                "@UseInterceptors(Museum)\n",
                "  @Get()\n  all() {\n    return prisma.exhibit.deleteMany();\n  }\n",
                "",
                "",
            ),
            (
                "as APP_INTERCEPTOR",
                "",
                "  @Get()\n  all() {\n    return prisma.exhibit.deleteMany();\n  }\n",
                "{ provide: APP_INTERCEPTOR, useClass: i.Museum }",
                "",
            ),
            (
                "by useGlobalInterceptors",
                "",
                "  @Get()\n  all() {\n    return prisma.exhibit.deleteMany();\n  }\n",
                "",
                "  app.useGlobalInterceptors(new i.Museum());\n",
            ),
        ] {
            check(
                format!("an interceptor {kind}, {place}"),
                outside_app(imports, on_class, route, providers, main, &more),
                want,
            );
        }
    }

    let enforcer = "    const enforcer = await newEnforcer(\"model.conf\", \"policy.csv\");\n    const ok = await enforcer.enforce(req.user.id, \"exhibits\", \"read\");\n";
    let decision = "    const decision = await cerbos.checkResource({ principal: { id: req.user.id, roles: [\"user\"] }, resource: { kind: \"exhibit\", id: \"all\" }, actions: [\"read\"] });\n";
    let policy_imports = "import { prisma } from \"./db\";\nimport { newEnforcer } from \"casbin\";\nimport { GRPC } from \"@cerbos/grpc\";\nconst cerbos = new GRPC(\"localhost:3593\", { tls: false });\n";
    for (use_, body, want) in [
        (
            "casbin, written to a header",
            format!("{enforcer}    res.setHeader(\"x-allowed\", String(ok));\n"),
            &["unknown"][..],
        ),
        (
            "casbin, logged",
            format!("{enforcer}    console.log(\"allowed\", ok);\n"),
            &["unknown"][..],
        ),
        ("casbin, dropped", enforcer.to_string(), &["unknown"][..]),
        (
            "cerbos, logged",
            format!("{decision}    console.log(decision.isAllowed(\"read\"));\n"),
            &["unknown"][..],
        ),
        (
            "casbin, refusing",
            format!("{enforcer}    if (!ok) throw new ForbiddenException();\n"),
            &["unknown", "known"][..],
        ),
    ] {
        let route = format!(
            "  @Get()\n  async all(@Req() req: any, @Res({{ passthrough: true }}) res: any) {{\n{body}    return prisma.exhibit.findMany();\n  }}\n"
        );
        check(
            format!("a policy decision from {use_}"),
            outside_app(policy_imports, "", &route, "", "", &route_db),
            want,
        );
    }
    assert!(
        failures.is_empty(),
        "{} of {cells} cells wrong:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Where a comparison stands ([`a_comparison_of_the_caller_is_no_scope_only_by_order_with_a_bound_or_as_identification`]):
/// its name, the body given the comparison, and whether it is the condition of an
/// exit that answers "not signed in".
type Place<'a> = (&'a str, &'a dyn Fn(&str) -> String, bool);

/// [STRICT] A comparison of a value of the caller is a use, whatever exit stands on
/// it, but for two closed exceptions. By order (`<`, `<=`, `>`, `>=`) against a
/// clock or a count it is no scope (an expiry, a quota; against a literal only where
/// the member is an expiry or a count, TypeScript lowering 75: `session.user.level < 3`
/// is a role gate); against a field of a row, what the request sent or another value
/// it is a use. In the condition
/// of an exit that answers "not signed in", one against another value of the
/// caller or the request's credential identifies the caller; against anything else
/// (a row, what the request sent, a literal) it is an ownership or role check
/// answered with 401, and a use. As a matrix: the operator (two for equality, four
/// for order) x the other side (a field of a row, a value the request sent, a
/// literal, a clock, a count, another value of the caller, the request's
/// credential) x where it stands (the condition of a 401, a filter's callback, an
/// `if` in a loop that keeps rows). `none` only where the exceptions hold.
#[test]
fn a_comparison_of_the_caller_is_no_scope_only_by_order_with_a_bound_or_as_identification() {
    let ops = ["===", "!==", "<", "<=", ">", ">="];
    // (name, the other side, what kind of side it is).
    let others: &[(&str, &str, &str)] = &[
        ("a field of a row", "first.level", "row"),
        (
            "a value the request sent",
            "Number(req.nextUrl.searchParams.get(\"level\"))",
            "row",
        ),
        ("a literal", "3", "bound"),
        ("a clock", "Date.now()", "bound"),
        ("a count", "rows.length", "bound"),
        (
            "another value of the caller",
            "session.user.maxLevel",
            "caller",
        ),
        (
            "the request's credential",
            "req.headers.get(\"x-level\")",
            "caller",
        ),
    ];
    // (where, the body after `rows` is read, given the comparison).
    let places: &[Place] = &[
        (
            "the condition of a 401",
            &|cmp: &str| {
                format!(
                    "  const first = rows[0];\n  if ({cmp}) return NextResponse.json({{ error: \"unauthenticated\" }}, {{ status: 401 }});\n  return NextResponse.json(rows);\n"
                )
            },
            true,
        ),
        (
            "a filter's callback",
            &|cmp: &str| format!("  return NextResponse.json(rows.filter((first) => {cmp}));\n"),
            false,
        ),
        (
            "an if in a loop that keeps rows",
            &|cmp: &str| {
                format!(
                    "  const visible = [];\n  for (const first of rows) {{\n    if ({cmp}) visible.push(first);\n  }}\n  return NextResponse.json(visible);\n"
                )
            },
            false,
        ),
    ];
    let head = "import { NextResponse, type NextRequest } from \"next/server\";\nimport { auth } from \"@/lib/auth\";\nimport { db } from \"@/lib/db\";\nexport async function GET(req: NextRequest) {\n  const session = await auth();\n  if (!session) return NextResponse.json({ error: \"unauthenticated\" }, { status: 401 });\n  const rows = await db.document.findMany();\n";
    let mut wrong = Vec::new();
    let mut cells = 0;
    for (place, body, signs_in) in places {
        let mut files = Files::new();
        files.insert(
            "package.json".into(),
            "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"next-auth\": \"5.0.0-beta.20\", \"@prisma/client\": \"5.0.0\" } }\n".into(),
        );
        files.insert(
            "tsconfig.json".into(),
            "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
                .into(),
        );
        files.insert(
            "lib/auth.ts".into(),
            "import NextAuth from \"next-auth\";\nexport const { auth, handlers } = NextAuth({ providers: [] });\n".into(),
        );
        files.insert(
            "lib/db.ts".into(),
            "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n".into(),
        );
        let mut want = Vec::new();
        for (i, op) in ops.iter().enumerate() {
            let order = i >= 2;
            for (j, (other, side, kind)) in others.iter().enumerate() {
                let cmp = format!("session.user.level {op} {side}");
                let route = format!("/api/c{i}x{j}");
                files.insert(
                    format!("app{route}/route.ts"),
                    format!("{head}{}}}\n", body(&cmp)),
                );
                // By order against a clock or a count it is no scope; against a literal
                // it is a role gate (`session.user.level < 3`), found and not proven
                // (TypeScript lowering 75: a member compared with a literal is a role
                // check unless the member is an expiry or a count).
                let none = (order && *kind == "bound" && *other != "a literal")
                    || (*signs_in && *kind == "caller");
                want.push((route, format!("{op} {other}"), none));
            }
        }
        let dir = write(&files);
        let got = authz(dir.path());
        for (route, what, none) in want {
            cells += 1;
            let (a, why) = got
                .get(&format!("GET {route}"))
                .cloned()
                .unwrap_or_else(|| ("absent".into(), String::new()));
            let ok = if none {
                a == "none"
            } else {
                a == "unknown" || a == "known"
            };
            if !ok {
                wrong.push(format!(
                    "{place}, {what}: reads {a} ({why}), expected {}",
                    if none { "none" } else { "not none" }
                ));
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {cells} cells:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// [STRICT] In the condition of an exit that answers "not signed in", a value of
/// the caller tested for being there (the session, its user, an id, a tenant or an
/// owner key) is how the caller is identified; a flag tested (`!session.user.isAdmin`,
/// `!session.user.active`, `session.user.role !== "admin"`) is a role check
/// answered with 401, never `none`. As a matrix: the member tested x answered by
/// `NextResponse.json(..., { status: 401 })` or `new Response(null, { status: 401 })`.
#[test]
fn a_flag_of_the_caller_tested_before_a_401_is_a_check_and_its_presence_is_not() {
    let tests: &[(&str, &str, bool)] = &[
        ("!session", "the session", true),
        ("!session?.user", "its user", true),
        ("!session?.user?.id", "an id", true),
        ("!session?.orgId", "a tenant key", true),
        ("!session?.user?.ownerId", "an owner key", true),
        ("!session?.user?.isAdmin", "a flag", false),
        ("!session?.user?.active", "another flag", false),
        (
            "session?.user?.role !== \"admin\"",
            "a role compared",
            false,
        ),
    ];
    let exits = [
        "NextResponse.json({ error: \"unauthenticated\" }, { status: 401 })",
        "new Response(null, { status: 401 })",
    ];
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"next-auth\": \"5.0.0-beta.20\", \"@prisma/client\": \"5.0.0\" } }\n".into(),
    );
    files.insert(
        "tsconfig.json".into(),
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
            .into(),
    );
    files.insert(
        "lib/auth.ts".into(),
        "import NextAuth from \"next-auth\";\nexport const { auth, handlers } = NextAuth({ providers: [] });\n".into(),
    );
    files.insert(
        "lib/db.ts".into(),
        "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n"
            .into(),
    );
    let mut want = Vec::new();
    for (i, (test, what, none)) in tests.iter().enumerate() {
        for (j, exit) in exits.iter().enumerate() {
            let route = format!("/api/t{i}x{j}");
            files.insert(
                format!("app{route}/route.ts"),
                format!(
                    "import {{ NextResponse }} from \"next/server\";\nimport {{ auth }} from \"@/lib/auth\";\nimport {{ db }} from \"@/lib/db\";\nexport async function GET() {{\n  const session = await auth();\n  if ({test}) return {exit};\n  return NextResponse.json(await db.document.findMany());\n}}\n"
                ),
            );
            want.push((route, format!("{what} ({exit})"), *none));
        }
    }
    let dir = write(&files);
    let got = authz(dir.path());
    let mut wrong = Vec::new();
    for (route, what, none) in &want {
        let (a, why) = got
            .get(&format!("GET {route}"))
            .cloned()
            .unwrap_or_else(|| ("absent".into(), String::new()));
        let ok = if *none {
            a == "none"
        } else {
            a == "unknown" || a == "known"
        };
        if !ok {
            wrong.push(format!(
                "{what}: reads {a} ({why}), expected {}",
                if *none { "none" } else { "not none" }
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {} cells:\n{}",
        wrong.len(),
        want.len(),
        wrong.join("\n")
    );
}

/// [STRICT] An order comparison of a member of the caller against a literal is a
/// role gate (`session.user.level < 3`): the check is found and not proven, never
/// "no scope". Only an expiry (`exp`, `iat`, `expiresAt`) or a count (`.length`) is
/// no scope. As a matrix: the member compared x how the comparison is written (the
/// test of an exit that answers 401, the test of a conditional that picks what is
/// served, the literal on the left, `>=`).
#[test]
fn an_order_comparison_of_a_member_of_the_caller_with_a_literal_is_a_role_gate() {
    let members: &[(&str, bool)] = &[
        ("level", false),
        ("tier", false),
        ("rank", false),
        ("points", false),
        ("exp", true),
        ("iat", true),
        ("expiresAt", true),
        ("expires_at", true),
        ("apiKeys.length", true),
    ];
    let forms: &[(&str, &str)] = &[
        (
            "an exit that answers 401",
            "  if (session.user.M < 3) return new Response(null, { status: 401 });\n  return NextResponse.json(await db.document.findMany());\n",
        ),
        (
            "a conditional that picks what is served",
            "  const data = session.user.M >= 3 ? { all: true } : { mine: true };\n  return NextResponse.json(data);\n",
        ),
        (
            "the literal on the left",
            "  if (3 > session.user.M) return new Response(null, { status: 401 });\n  return NextResponse.json(await db.document.findMany());\n",
        ),
    ];
    let mut files = Files::new();
    files.insert(
        "package.json".into(),
        "{ \"name\": \"web\", \"dependencies\": { \"next\": \"14.2.0\", \"next-auth\": \"5.0.0-beta.20\", \"@prisma/client\": \"5.0.0\" } }\n".into(),
    );
    files.insert(
        "tsconfig.json".into(),
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }\n"
            .into(),
    );
    files.insert(
        "lib/auth.ts".into(),
        "import NextAuth from \"next-auth\";\nexport const { auth, handlers } = NextAuth({ providers: [] });\n".into(),
    );
    files.insert(
        "lib/db.ts".into(),
        "import { PrismaClient } from \"@prisma/client\";\nexport const db = new PrismaClient();\n"
            .into(),
    );
    let mut want = Vec::new();
    for (i, (member, none)) in members.iter().enumerate() {
        for (j, (form, body)) in forms.iter().enumerate() {
            let route = format!("/api/o{i}x{j}");
            files.insert(
                format!("app{route}/route.ts"),
                format!(
                    "import {{ NextResponse }} from \"next/server\";\nimport {{ auth }} from \"@/lib/auth\";\nimport {{ db }} from \"@/lib/db\";\nexport async function GET() {{\n  const session = await auth();\n  if (!session) return new Response(null, {{ status: 401 }});\n{}}}\n",
                    body.replace('M', member)
                ),
            );
            want.push((route, format!("{member} in {form}"), *none));
        }
    }
    let dir = write(&files);
    let got = authz(dir.path());
    let mut wrong = Vec::new();
    for (route, what, none) in &want {
        let (a, why) = got
            .get(&format!("GET {route}"))
            .cloned()
            .unwrap_or_else(|| ("absent".into(), String::new()));
        let ok = if *none {
            a == "none"
        } else {
            a == "unknown" || a == "known"
        };
        if !ok {
            wrong.push(format!(
                "{what}: reads {a} ({why}), expected {}",
                if *none { "none" } else { "not none" }
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "{} wrong of {} cells:\n{}",
        wrong.len(),
        want.len(),
        wrong.join("\n")
    );
}
