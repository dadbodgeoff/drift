//! Next.js: what wraps an exported route handler.

use super::{Framework, Is, Position, Thing, itself, thing};

const PACKAGE: &str = r#"{ "name": "web", "dependencies": { "next": "15.0.0", "jose": "5.0.0", "@acme/next-sso": "1.0.0" } }
"#;

const TSCONFIG: &str = r#"{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./*"] } } }
"#;

/// The wrappers of the repository.
const AUTH: &str = r#"import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { lookup } from "./generated/lookup";

type Handler = (req: NextRequest) => Promise<Response> | Response;
const key = new TextEncoder().encode(process.env.JWT_SECRET);

async function getSession(req: NextRequest) {
  return req.cookies.get("session")?.value ?? null;
}

export function withAuth(handler: Handler): Handler {
  return async (req) => {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return handler(req);
  };
}

export function withToken(handler: Handler): Handler {
  return async (req) => {
    try {
      await jwtVerify(String(req.headers.get("authorization")), key);
    } catch {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return handler(req);
  };
}

export function withLogging(handler: Handler): Handler {
  return async (req) => {
    console.log(req.method, req.url);
    return handler(req);
  };
}

export function withSome(handler: Handler): Handler {
  return async (req) => {
    if (req.nextUrl.pathname.startsWith("/api/admin") && !(await getSession(req))) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    return handler(req);
  };
}

export function withUnread(handler: Handler): Handler {
  return async (req) => {
    await lookup(req);
    return handler(req);
  };
}

export function withStrictOr(strict: boolean) {
  if (strict) {
    return (handler: Handler): Handler => async (req) => {
      if (!(await getSession(req))) {
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      }
      return handler(req);
    };
  }
  return (handler: Handler): Handler => async (req) => handler(req);
}

export const wrappers: Record<string, (h: Handler) => Handler> = {};
export function pick(kind: string) {
  return wrappers[kind];
}
"#;

/// What every route file starts with.
pub const IMPORTS: &str = "import { withAuth, withToken, withLogging, withSome, withUnread, withStrictOr, wrappers, pick } from \"@/lib/auth\";\nimport { withSso } from \"@acme/next-sso\";\nimport { fromElsewhere } from \"@/lib/generated/wrappers\";\ndeclare const flag: boolean;\ndeclare const kind: string;\ndeclare const injected: typeof withAuth;\n";

const THINGS: &[Thing] = &[
    // a.
    thing('a', "returns-401", "withAuth", Is::Guard),
    thing('a', "catch-401", "withToken", Is::Guard),
    // b.
    thing('b', "logs", "withLogging", Is::Nothing),
    // c.
    thing('c', "some-paths", "withSome", Is::Unknown),
    thing('c', "unread-call", "withUnread", Is::Unknown),
    // g.
    thing('g', "package", "withSso", Is::Unknown),
    // h.
    thing(
        'h',
        "conditional",
        "(flag ? withAuth : withLogging)",
        Is::Unknown,
    ),
    thing('h', "computed", "wrappers[kind]", Is::Unknown),
    thing('h', "member-unread", "wrappers.authed", Is::Unknown),
    thing('h', "declared", "injected", Is::Unknown),
    thing('h', "unresolved-import", "fromElsewhere", Is::Unknown),
    thing('h', "factory-not-followed", "pick(\"authed\")", Is::Unknown),
    // A factory that hands back one of two wrappers written in its body.
    thing(
        'h',
        "factory-of-two-closures",
        "withStrictOr(false)",
        Is::Unknown,
    ),
];

const POSITIONS: &[Position] = &[
    Position {
        name: "wrapper-of-the-export",
        code: "//// app/api/c@N@/guarded/route.ts\n@I@export const GET = @G@(async () => Response.json([]));\n//// app/api/c@N@/open/route.ts\nexport const GET = async () => Response.json([]);\n",
        covered: "/api/c@N@/guarded",
        sibling: "/api/c@N@/open",
        reads: itself,
    },
    Position {
        name: "wrapper-inside-another",
        code: "//// app/api/c@N@/guarded/route.ts\n@I@export const GET = withLogging(@G@(async () => Response.json([])));\n//// app/api/c@N@/open/route.ts\n@I@export const GET = withLogging(async () => Response.json([]));\n",
        covered: "/api/c@N@/guarded",
        sibling: "/api/c@N@/open",
        reads: itself,
    },
    Position {
        name: "wrapper-of-a-declared-handler",
        code: "//// app/api/c@N@/guarded/route.ts\n@I@async function handler() {\n  return Response.json([]);\n}\nexport const GET = @G@(handler);\n//// app/api/c@N@/open/route.ts\nasync function handler() {\n  return Response.json([]);\n}\nexport const GET = handler;\n",
        covered: "/api/c@N@/guarded",
        sibling: "/api/c@N@/open",
        reads: itself,
    },
];

pub const NEXT_WRAPPERS: Framework = Framework {
    name: "next-wrappers",
    imports: IMPORTS,
    files: &[
        ("package.json", PACKAGE),
        ("tsconfig.json", TSCONFIG),
        ("lib/auth.ts", AUTH),
    ],
    file: "",
    head: "",
    tail: "",
    things: THINGS,
    positions: POSITIONS,
    method: "GET",
};
