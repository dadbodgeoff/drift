//! A Nest application read by what runs for a route, not by what its parts are
//! called.
//!
//! - A guard class that reads one key of the route's metadata and uses it where
//!   that is not read (`request.allowed = this.reflector.get(OnlyAllow,
//!   context.getHandler())` in the `getRequest` of a passport guard) answers to a
//!   decorator that sets that key, and to no other: a route under `@Scopes([...])`
//!   is behind the guard as a route with no decorator is.
//! - A method called through a property a class declares with a type
//!   (`this.db.prisma.note.count()`, with `public prisma!: PrismaClient` on the
//!   injected `DbService`) is that type's: a package's, and no body left unread.
//! - A comparison of two parameters that refuses where they differ (`if (userId !==
//!   note.userId) throw new ForbiddenException()`) is the owner's check for a
//!   route whose bodies hand it the caller's own value and the row they loaded,
//!   whatever the method and its parameters are called; handed what the request
//!   chose, or refusing where the two match, it proves nothing.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set, else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

/// `METHOD route` -> `known <mechanisms>`, `none`, or `unknown <reason>`, of one
/// concern of the practice map.
fn concern(root: &Path, id: &str) -> BTreeMap<String, String> {
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
    let map: Value = serde_json::from_slice(&out.stdout).unwrap();
    let concern = map["concerns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .cloned()
        .unwrap();
    let variants: Vec<Value> = concern["variants"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|v| {
            std::iter::once(v.clone())
                .chain(v["alternatives"].as_array().into_iter().flatten().cloned())
        })
        .collect();
    concern["units"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|u| {
            let said = match u["assignment"].as_str().unwrap() {
                "known" => {
                    let key = u["key"]
                        .as_str()
                        .or_else(|| {
                            variants
                                .iter()
                                .find(|v| v["id"] == u["variant"])
                                .and_then(|v| v["key"].as_str())
                        })
                        .unwrap_or_default();
                    let mechanisms: Vec<&str> = key
                        .split('+')
                        .map(|k| k.split(':').next().unwrap_or_default())
                        .collect();
                    format!("known {}", mechanisms.join("+"))
                }
                "unknown" => format!("unknown {}", u["reason"].as_str().unwrap_or_default()),
                other => other.to_string(),
            };
            (u["symbol"].as_str().unwrap_or_default().to_string(), said)
        })
        .collect()
}

fn write(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (rel, text) in files {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    dir
}

fn app() -> tempfile::TempDir {
    write(&[
        (
            "package.json",
            r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@nestjs/passport": "10.0.0", "@prisma/client": "5.20.0" } }
"#,
        ),
        (
            "src/auth/only-allow.ts",
            r#"import { Reflector } from "@nestjs/core";

export const OnlyAllow = Reflector.createDecorator<string[]>();
"#,
        ),
        (
            "src/auth/scopes.ts",
            r#"import { Reflector } from "@nestjs/core";

export const Scopes = Reflector.createDecorator<string[]>();
"#,
        ),
        (
            "src/auth/api-auth.guard.ts",
            r#"import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { OnlyAllow } from "./only-allow";

@Injectable()
export class ApiAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  getRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.allowed = this.reflector.get(OnlyAllow, context.getHandler());
    return request;
  }
}
"#,
        ),
        (
            "src/auth/user.decorator.ts",
            r#"import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const GetUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
"#,
        ),
        (
            "src/db.service.ts",
            r#"import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class DbService {
  public prisma!: PrismaClient;
}
"#,
        ),
        (
            "src/notes.repository.ts",
            r#"import { Injectable } from "@nestjs/common";
import { DbService } from "./db.service";

@Injectable()
export class NotesRepository {
  constructor(private readonly db: DbService) {}

  byId(id: number) {
    return this.db.prisma.note.findUnique({ where: { id } });
  }

  count() {
    return this.db.prisma.note.count();
  }
}
"#,
        ),
        (
            "src/notes.service.ts",
            r#"import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotesRepository } from "./notes.repository";

@Injectable()
export class NotesService {
  constructor(private readonly notes: NotesRepository) {}

  async get(userId: number, id: number) {
    const note = await this.notes.byId(id);
    if (!note) {
      throw new NotFoundException();
    }
    this.mustOwn(userId, note);
    return note;
  }

  async getUnlessTheirs(userId: number, id: number) {
    const note = await this.notes.byId(id);
    if (!note) {
      throw new NotFoundException();
    }
    this.mustNotOwn(userId, note);
    return note;
  }

  count() {
    return this.notes.count();
  }

  mustOwn(userId: number, note: { userId: number }): void {
    if (userId !== note.userId) {
      throw new ForbiddenException();
    }
  }

  mustNotOwn(userId: number, note: { userId: number }): void {
    if (userId === note.userId) {
      throw new ForbiddenException();
    }
  }
}
"#,
        ),
        (
            "src/notes.controller.ts",
            r#"import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiAuthGuard } from "./auth/api-auth.guard";
import { OnlyAllow } from "./auth/only-allow";
import { Scopes } from "./auth/scopes";
import { GetUser } from "./auth/user.decorator";
import { NotesService } from "./notes.service";

@Controller("notes")
@UseGuards(ApiAuthGuard)
export class NotesController {
  constructor(private readonly service: NotesService) {}

  @Get("mine/:id")
  @Scopes(["notes:read"])
  mine(@GetUser() user: { id: number }, @Param("id") id: number) {
    return this.service.get(user.id, id);
  }

  @Get("as/:userId/:id")
  as(@Param("userId") userId: number, @Param("id") id: number) {
    return this.service.get(userId, id);
  }

  @Get("others/:id")
  others(@GetUser() user: { id: number }, @Param("id") id: number) {
    return this.service.getUnlessTheirs(user.id, id);
  }

  @Get("keyed/:id")
  @OnlyAllow(["API_KEY"])
  keyed(@GetUser() user: { id: number }, @Param("id") id: number) {
    return this.service.get(user.id, id);
  }

  @Get("count")
  count() {
    return this.service.count();
  }
}
"#,
        ),
    ])
}

#[test]
fn a_guard_answers_to_the_decorator_that_sets_the_key_it_reads() {
    let dir = app();
    let got = concern(dir.path(), "authn");
    // `@Scopes` sets a key the guard never reads.
    assert!(got["GET /notes/mine/:id"].starts_with("known"), "{got:?}");
    assert!(got["GET /notes/count"].starts_with("known"), "{got:?}");
    // `@OnlyAllow` sets the key the guard reads and hands on: what it then does
    // for the route is not read.
    assert!(
        got["GET /notes/keyed/:id"].starts_with("unknown"),
        "{got:?}"
    );
}

#[test]
fn a_method_through_a_typed_property_is_the_types_own() {
    let dir = app();
    let got = concern(dir.path(), "authz");
    // Read to the end: every row counted, and nothing asked of the caller.
    assert_eq!(got["GET /notes/count"], "none", "{got:?}");
}

#[test]
fn two_parameters_compared_are_the_owners_check_by_what_is_passed() {
    let dir = app();
    let got = concern(dir.path(), "authz");
    // The caller's id against the row the route loaded.
    assert!(got["GET /notes/mine/:id"].starts_with("known"), "{got:?}");
    // The id the request chose against that row.
    assert!(
        got["GET /notes/as/:userId/:id"].starts_with("unknown"),
        "{got:?}"
    );
    // The caller's id, refused where it matches.
    assert!(
        got["GET /notes/others/:id"].starts_with("unknown"),
        "{got:?}"
    );
}
