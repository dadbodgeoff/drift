//! Next.js entry points the last measured build did not list, in the listed
//! reading only ([`drift_core::Listed`]): inline server actions (a function whose
//! own body starts with `"use server"`), Next.js 16's `proxy.ts`,
//! `getServerSideProps` of a Pages Router page, and route files under the
//! extensions `pageExtensions` adds. What mining reads (the file's own
//! `entry_points` and `symbols`) stays as the measured build read it.

use std::fs;
use std::path::Path;

use drift_core::{EntryPoint, FileFacts, RepoFacts};
use drift_ts::{ScanOptions, scan};

const NEXT16: &str =
    r#"{ "name": "web", "dependencies": { "next": "16.0.1", "react": "19.0.0" } }"#;
const NEXT15: &str =
    r#"{ "name": "web", "dependencies": { "next": "^15.5.0", "react": "19.0.0" } }"#;

const SESSION: &str = r#"
import { cookies } from "next/headers";
export async function requireUser() {
  const session = (await cookies()).get("session");
  if (!session) throw new Error("Unauthorized");
  return session.value;
}
"#;

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

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn entries(r: &RepoFacts, path: &str) -> Vec<String> {
    let show = |e: &EntryPoint| {
        format!(
            "{} {} {} {}",
            e.kind,
            e.symbol,
            e.method.as_deref().unwrap_or("-"),
            e.route.as_deref().unwrap_or("-")
        )
    };
    let mut out: Vec<String> = file(r, path).entry_points.iter().map(show).collect();
    out.sort();
    out
}

/// The calls of `symbol` in `path`, as linked.
fn calls(r: &RepoFacts, path: &str, symbol: &str) -> Vec<String> {
    file(r, path)
        .symbols
        .iter()
        .find(|s| s.name == symbol)
        .unwrap_or_else(|| panic!("no symbol {symbol} in {path}"))
        .calls
        .clone()
}

const PAGE: &str = r#"
import { requireUser } from "../../lib/session";
import { db } from "../../lib/db";

export default async function Page() {
  const user = await requireUser();
  async function save(formData: FormData) {
    "use server";
    await db.note.create({ data: { text: formData.get("text") } });
  }
  async function remove(formData: FormData) {
    "use server";
    await requireUser();
    await db.note.delete({ where: { id: formData.get("id") } });
  }
  return (
    <form action={save}>
      <p>{user}</p>
      <button formAction={remove}>x</button>
      <button formAction={async (formData: FormData) => {
        "use server";
        await db.note.deleteMany({});
      }}>all</button>
    </form>
  );
}
"#;

/// An inline action written in a server component is a server action of its own
/// symbol, `<component>.<name>`, in the listed reading only; the component's own
/// guard is not the action's (it does not run when the action is called), and
/// the action that calls the guard itself has it among its calls.
#[test]
fn inline_actions_are_server_actions_with_their_own_guards() {
    let r = repo(&[
        ("package.json", NEXT16),
        ("lib/session.ts", SESSION),
        ("lib/db.ts", "export const db: any = {};\n"),
        ("app/notes/page.tsx", PAGE),
    ]);
    let path = "app/notes/page.tsx";
    // As measured: the page only; no action symbol.
    assert_eq!(entries(&r, path), ["page default - /notes"]);
    assert!(
        !file(&r, path)
            .symbols
            .iter()
            .any(|s| s.name.starts_with("Page."))
    );
    let listed = r.listed();
    assert_eq!(
        entries(&listed, path),
        [
            "page default - /notes",
            "server_action Page.formAction - -",
            "server_action Page.remove - -",
            "server_action Page.save - -",
        ]
    );
    // The component calls the guard; the action it hands out does not.
    assert!(
        calls(&listed, path, "Page")
            .iter()
            .any(|c| c.ends_with("#requireUser"))
    );
    assert!(
        !calls(&listed, path, "Page.save")
            .iter()
            .any(|c| c.ends_with("#requireUser"))
    );
    assert!(
        calls(&listed, path, "Page.remove")
            .iter()
            .any(|c| c.ends_with("#requireUser"))
    );
}

/// A module-level function whose own body says `"use server"`, in a module that
/// does not, is a server action under its own name; an object method passed as
/// props is one under its key; a class method is not read (Next.js refuses it).
#[test]
fn module_level_and_object_inline_actions() {
    let r = repo(&[
        ("package.json", NEXT16),
        (
            "app/actions/page.tsx",
            r#"
async function rename(formData: FormData) {
  "use server";
  return formData.get("name");
}
export const archive = async (id: string) => {
  "use server";
  return id;
};
class Store {
  async put() {
    "use server";
  }
}
export default function Page() {
  return <Editor handlers={{ async publish(id: string) { "use server"; return id; } }} rename={rename} />;
}
"#,
        ),
    ]);
    let path = "app/actions/page.tsx";
    assert_eq!(entries(&r, path), ["page default - /actions"]);
    assert_eq!(
        entries(&r.listed(), path),
        [
            "page default - /actions",
            "server_action Page.publish - -",
            "server_action archive - -",
            "server_action rename - -",
        ]
    );
}

/// Next.js 16 `proxy.ts` at the package root or in `src/` is the middleware,
/// under `proxy` or the default export; not where `next` is older than 16, not
/// elsewhere in the package, and not beside a `middleware.ts` (Next.js stops the
/// build).
#[test]
fn proxy_is_the_middleware_from_next_16() {
    let proxy = r#"
import { NextResponse } from "next/server";
export function proxy(request: Request) {
  return NextResponse.next();
}
export const config = { matcher: ["/dashboard/:path*"] };
"#;
    let r = repo(&[("package.json", NEXT16), ("src/proxy.ts", proxy)]);
    assert!(entries(&r, "src/proxy.ts").is_empty());
    assert_eq!(
        entries(&r.listed(), "src/proxy.ts"),
        ["middleware proxy - -"]
    );
    let matchers = &file(&r, "src/proxy.ts").route_matchers;
    assert!(matchers.iter().any(|m| m.binding == "config.matcher"));

    let default = "const proxy = async (req: Request) => new Response();\nexport default proxy;\n";
    let r = repo(&[("package.json", NEXT16), ("proxy.ts", default)]);
    assert_eq!(entries(&r.listed(), "proxy.ts"), ["middleware default - -"]);

    let r = repo(&[("package.json", NEXT15), ("proxy.ts", proxy)]);
    assert!(entries(&r.listed(), "proxy.ts").is_empty());

    let r = repo(&[("package.json", NEXT16), ("lib/proxy.ts", proxy)]);
    assert!(entries(&r.listed(), "lib/proxy.ts").is_empty());

    let r = repo(&[
        ("package.json", NEXT16),
        ("proxy.ts", proxy),
        (
            "middleware.ts",
            "export function middleware() { return new Response(); }\n",
        ),
    ]);
    assert!(entries(&r.listed(), "proxy.ts").is_empty());
    assert_eq!(
        entries(&r.listed(), "middleware.ts"),
        ["middleware middleware - -"]
    );
}

/// `getServerSideProps` answers every request of its page (and the page's
/// `/_next/data` JSON): an HTTP entry point, GET at the page's route.
/// `getStaticProps` and `getStaticPaths` are handed no request: not entry points.
#[test]
fn get_server_side_props_is_an_entry_point() {
    let r = repo(&[
        ("package.json", NEXT16),
        (
            "pages/users/[id].tsx",
            r#"
export async function getServerSideProps(ctx: any) {
  return { props: { id: ctx.params.id } };
}
export default function User(props: any) {
  return <p>{props.id}</p>;
}
"#,
        ),
        (
            "pages/blog/[slug].tsx",
            r#"
export async function getStaticPaths() { return { paths: [], fallback: "blocking" }; }
export async function getStaticProps(ctx: any) { return { props: { slug: ctx.params.slug } }; }
export default function Post(props: any) { return <p>{props.slug}</p>; }
"#,
        ),
    ]);
    assert_eq!(
        entries(&r, "pages/users/[id].tsx"),
        ["page default - /users/[id]"]
    );
    assert_eq!(
        entries(&r.listed(), "pages/users/[id].tsx"),
        [
            "http getServerSideProps GET /users/[id]",
            "page default - /users/[id]"
        ]
    );
    assert_eq!(
        entries(&r.listed(), "pages/blog/[slug].tsx"),
        ["page default - /blog/[slug]"]
    );
}

/// A route file under an extension Next.js takes by default only through
/// `pageExtensions` (`route.mts`) is a route where the configuration lists it as
/// a literal, and is not one otherwise.
#[test]
fn page_extensions_add_route_files() {
    let route = "export async function GET() { return new Response(\"ok\"); }\n";
    let r = repo(&[
        ("package.json", NEXT16),
        (
            "next.config.mjs",
            "const nextConfig = { pageExtensions: [\"tsx\", \"ts\", \"mts\"] };\nexport default nextConfig;\n",
        ),
        ("app/api/health/route.mts", route),
    ]);
    assert!(entries(&r, "app/api/health/route.mts").is_empty());
    assert_eq!(
        entries(&r.listed(), "app/api/health/route.mts"),
        ["http GET GET /api/health"]
    );

    let r = repo(&[
        ("package.json", NEXT16),
        ("app/api/health/route.mts", route),
    ]);
    assert!(entries(&r.listed(), "app/api/health/route.mts").is_empty());
}
