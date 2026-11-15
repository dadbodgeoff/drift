//! NestJS: the things (guards) and the positions (where `@UseGuards` is written).

use super::{Framework, Is, Position, Thing, itself, thing};

const PACKAGE: &str = r#"{ "name": "api", "dependencies": { "@nestjs/common": "10.0.0", "@nestjs/core": "10.0.0", "@nestjs/passport": "10.0.0", "@nestjs/throttler": "5.0.0", "@acme/nest-sso": "1.0.0" } }
"#;

/// The guard classes of the repository.
const GUARDS: &str = r#"import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { lookup } from "./generated/lookup";

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Injectable()
export class ReturnsFalse implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    return Boolean(req.headers.authorization);
  }
}

// A name is no evidence: this one refuses whoever has no key.
@Injectable()
export class PublicApiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.headers["x-api-key"]) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Injectable()
export class AlwaysTrue implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

// It calls something and can only return true.
@Injectable()
export class LogsThenTrue implements CanActivate {
  private readonly logger = new Logger("guard");
  canActivate(context: ExecutionContext): boolean {
    this.logger.log(context.getHandler().name);
    console.log("seen");
    return true;
  }
}

@Injectable()
export class SomeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.path.startsWith("/admin") && !req.headers.authorization) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Injectable()
export class UnreadGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await lookup(context);
    return true;
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}

@Injectable()
export class StrictJwtGuard extends AuthGuard("jwt") {
  handleRequest(err: unknown, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }
    return user;
  }
}

@Injectable()
export class OptionalJwtGuard extends AuthGuard("jwt") {
  handleRequest(_err: unknown, user: any) {
    return user;
  }
}

@Injectable()
export class AnonymousJwtGuard extends AuthGuard(["jwt", "anonymous"]) {}
"#;

const HEAD: &str = r#"import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ThrottlerGuard } from "@nestjs/throttler";
import { SsoGuard } from "@acme/nest-sso";
import { FromElsewhere } from "./generated/guards";
import {
  JwtGuard, ReturnsFalse, PublicApiGuard, AlwaysTrue, LogsThenTrue, SomeGuard, UnreadGuard,
  JwtAuthGuard, StrictJwtGuard, OptionalJwtGuard, AnonymousJwtGuard,
} from "./guards";

declare const flag: boolean;
declare const registry: Record<string, any>;
"#;

const THINGS: &[Thing] = &[
    // a.
    thing('a', "throws-unauthorized", "JwtGuard", Is::Guard),
    thing('a', "returns-what-it-read", "ReturnsFalse", Is::Guard),
    thing('a', "named-public", "PublicApiGuard", Is::Guard),
    thing('a', "built-in-place", "new JwtGuard()", Is::Guard),
    // b.
    thing('b', "returns-true", "AlwaysTrue", Is::Nothing),
    thing('b', "calls-then-returns-true", "LogsThenTrue", Is::Nothing),
    // c.
    thing('c', "some-paths", "SomeGuard", Is::Unknown),
    thing('c', "unread-call-then-true", "UnreadGuard", Is::Unknown),
    // d.
    thing('d', "passport", "AuthGuard(\"jwt\")", Is::Guard),
    thing('d', "passport-subclass", "JwtAuthGuard", Is::Guard),
    thing(
        'd',
        "passport-handle-request-throws",
        "StrictJwtGuard",
        Is::Guard,
    ),
    // e.
    thing(
        'e',
        "passport-anonymous",
        "AuthGuard([\"jwt\", \"anonymous\"])",
        Is::Unknown,
    ),
    thing(
        'e',
        "passport-subclass-anonymous",
        "AnonymousJwtGuard",
        Is::Unknown,
    ),
    thing('e', "passport-optional", "OptionalJwtGuard", Is::Nothing),
    thing(
        'e',
        "passport-variable",
        "AuthGuard(registry.strategy)",
        Is::Unknown,
    ),
    // f.
    thing('f', "throttler", "ThrottlerGuard", Is::Nothing),
    // g.
    thing('g', "package", "SsoGuard", Is::Unknown),
    // h.
    thing(
        'h',
        "conditional",
        "(flag ? JwtGuard : AlwaysTrue)",
        Is::Unknown,
    ),
    thing('h', "member-unread", "registry.guard", Is::Unknown),
    thing('h', "unresolved-import", "FromElsewhere", Is::Unknown),
];

const POSITIONS: &[Position] = &[
    Position {
        name: "method",
        code: "@Controller(\"c@N@\")\nexport class C@N@ {\n  @Get(\"in\")\n  @UseGuards(@G@)\n  covered() {\n    return [];\n  }\n\n  @Get(\"out\")\n  open() {\n    return [];\n  }\n}\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    // Two controllers in one file each time: the class decorators of one are not
    // those of the other.
    Position {
        name: "class",
        code: "@Controller(\"c@N@/in\")\n@UseGuards(@G@)\nexport class C@N@ {\n  @Get()\n  covered() {\n    return [];\n  }\n}\n\n@Controller(\"c@N@/out\")\nexport class Open@N@ {\n  @Get()\n  open() {\n    return [];\n  }\n}\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
    Position {
        name: "method-of-several",
        code: "@Controller(\"c@N@\")\nexport class C@N@ {\n  @Get(\"in\")\n  @UseGuards(AlwaysTrue, @G@)\n  covered() {\n    return [];\n  }\n\n  @Get(\"out\")\n  @UseGuards(AlwaysTrue)\n  open() {\n    return [];\n  }\n}\n",
        covered: "@P@/in",
        sibling: "@P@/out",
        reads: itself,
    },
];

pub const NEST: Framework = Framework {
    name: "nest",
    imports: "",
    files: &[("package.json", PACKAGE), ("src/guards.ts", GUARDS)],
    file: "src/items.controller.ts",
    head: HEAD,
    tail: "",
    things: THINGS,
    positions: POSITIONS,
    method: "GET",
};
