//! A tRPC procedure is called by its dotted path, the keys of the routers it is
//! mounted through (`admin.users.byId`), not by its key alone. These pin the listed
//! reading (what the practice map and `drift security` read): one route per path a
//! procedure is served at, across files, through `mergeRouters`, nested records,
//! lazy routers and named procedures; `?` where the composition is not read (a
//! computed key, a router nothing mounts, a router a function builds). The measured
//! reading, which mining reads, keeps each procedure's key as before.

use std::fs;
use std::path::Path;

use drift_core::RepoFacts;
use drift_ts::{ScanOptions, scan, scan_file};

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

const TRPC: &str = r#"import { initTRPC } from "@trpc/server";
const t = initTRPC.create();
export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;
"#;

/// Read by procedures of two routers: `byId` is a key of both.
const USER: &str = r#"import { router, publicProcedure } from "../trpc";
import { me } from "../procedures/me";

export const userRouter = router({
  byId: publicProcedure.query(() => 1),
  list: publicProcedure.query(() => []),
  me,
});
"#;

const POST: &str = r#"import { router, publicProcedure } from "../trpc";

export const postRouter = router({
  byId: publicProcedure.query(() => 2),
});
"#;

const ME: &str = r#"import { publicProcedure } from "../trpc";

export const me = publicProcedure.query(() => "me");
"#;

/// Two deep under the app, a computed key and a router a function builds. (A
/// procedure in a nested record, `settings: { get }`, is no entry point of either
/// reading yet: only a router's own keys are read for procedures.)
const ADMIN: &str = r#"import { router, publicProcedure } from "../trpc";
import { userRouter } from "./user";
import { tickRouter } from "./tick";

const KEY = "dyn";

function makeRouter() {
  return router({ fromFn: publicProcedure.query(() => 0) });
}

export const adminRouter = router({
  users: userRouter,
  settings: { get: publicProcedure.query(() => ({})) },
  [KEY]: tickRouter,
  made: makeRouter(),
});
"#;

const TICK: &str = r#"import { router, publicProcedure } from "../trpc";

export const tickRouter = router({
  tick: publicProcedure.mutation(() => 0),
});
"#;

const SLOW: &str = r#"import { router, publicProcedure } from "../trpc";

export const slowRouter = router({
  crunch: publicProcedure.query(() => 0),
});
"#;

const REPORT: &str = r#"import { router, publicProcedure } from "../trpc";

export const reportRouter = router({
  weekly: publicProcedure.query(() => 0),
});
export const helper = 1;
"#;

const ORPHAN: &str = r#"import { router, publicProcedure } from "../trpc";

export const orphanRouter = router({
  ping: publicProcedure.query(() => "pong"),
});
"#;

/// The app: merged with a core router, `userRouter` mounted here and under admin.
const APP: &str = r#"import { lazy } from "@trpc/server";
import { router, mergeRouters, publicProcedure } from "./trpc";
import { userRouter } from "./routers/user";
import { postRouter } from "./routers/post";
import { adminRouter } from "./routers/admin";

const coreRouter = router({
  health: publicProcedure.query(() => "ok"),
});

export const appRouter = mergeRouters(
  coreRouter,
  router({
    user: userRouter,
    post: postRouter,
    admin: adminRouter,
    slow: lazy(() => import("./routers/slow")),
    report: lazy(() => import("./routers/report").then((m) => m.reportRouter)),
  }),
);
export type AppRouter = typeof appRouter;
"#;

fn fixture(r: &Path) {
    write(r, "package.json", "{ \"name\": \"api\" }");
    write(r, "src/trpc.ts", TRPC);
    write(r, "src/app.ts", APP);
    write(r, "src/routers/user.ts", USER);
    write(r, "src/routers/post.ts", POST);
    write(r, "src/routers/admin.ts", ADMIN);
    write(r, "src/routers/tick.ts", TICK);
    write(r, "src/routers/slow.ts", SLOW);
    write(r, "src/routers/report.ts", REPORT);
    write(r, "src/routers/orphan.ts", ORPHAN);
    write(r, "src/procedures/me.ts", ME);
}

fn opts() -> ScanOptions {
    ScanOptions {
        cache_dir: None,
        threads: 1,
    }
}

/// `path symbol -> route` of every tRPC entry point, listed or measured.
fn routes(r: &RepoFacts, listed: bool) -> Vec<String> {
    let mut out: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| {
            let eps = if listed {
                f.listed_entry_points()
            } else {
                &f.entry_points
            };
            eps.iter().filter(|e| e.adapter == "trpc").map(move |e| {
                format!(
                    "{} {} -> {}",
                    f.path,
                    e.symbol,
                    e.route.as_deref().unwrap_or("-")
                )
            })
        })
        .collect();
    out.sort();
    out
}

/// Every procedure at the dotted path of each way it is mounted: two deep, merged,
/// lazy (the module's one export, or the export picked), named
/// and mounted by its binding, twice under two parents; `?` for what is not read.
#[test]
fn procedures_are_listed_at_their_dotted_paths() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let (facts, _) = scan(dir.path(), &opts()).unwrap();
    assert_eq!(
        routes(&facts, true),
        [
            // A computed key is a segment that is not known; a router a function
            // builds is one nothing Drift read mounts.
            "src/app.ts QUERY health -> health",
            "src/procedures/me.ts me -> admin.users.me",
            "src/procedures/me.ts me -> user.me",
            "src/routers/admin.ts QUERY fromFn -> ?.fromFn",
            "src/routers/orphan.ts QUERY ping -> ?.ping",
            "src/routers/post.ts QUERY byId -> post.byId",
            "src/routers/report.ts QUERY weekly -> report.weekly",
            "src/routers/slow.ts QUERY crunch -> slow.crunch",
            "src/routers/tick.ts MUTATION tick -> admin.?.tick",
            "src/routers/user.ts QUERY byId -> admin.users.byId",
            "src/routers/user.ts QUERY byId -> user.byId",
            "src/routers/user.ts QUERY list -> admin.users.list",
            "src/routers/user.ts QUERY list -> user.list",
        ]
    );
}

/// Mining reads the measured reading, which lists each procedure by its key as the
/// last measured build did: nothing of the paths is in it.
#[test]
fn the_measured_reading_keeps_each_key() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let (facts, _) = scan(dir.path(), &opts()).unwrap();
    assert_eq!(
        routes(&facts, false),
        [
            "src/app.ts QUERY health -> health",
            "src/procedures/me.ts me -> me",
            "src/routers/admin.ts QUERY fromFn -> fromFn",
            "src/routers/orphan.ts QUERY ping -> ping",
            "src/routers/post.ts QUERY byId -> byId",
            "src/routers/report.ts QUERY weekly -> weekly",
            "src/routers/slow.ts QUERY crunch -> crunch",
            "src/routers/tick.ts MUTATION tick -> tick",
            "src/routers/user.ts QUERY byId -> byId",
            "src/routers/user.ts QUERY list -> list",
        ]
    );
}

/// A single-file scan (what a hook reads) reads the routers that mount the file's
/// procedures and lists them as the full scan does.
#[test]
fn a_single_file_scan_lists_the_paths_a_full_scan_does() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let cache = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 0,
    };
    let (full, _) = scan(dir.path(), &opts).unwrap();
    for f in full.files.iter().filter(|f| !f.entry_points.is_empty()) {
        let one = scan_file(dir.path(), &opts, &f.path).unwrap().unwrap();
        assert_eq!(one.files, std::slice::from_ref(f), "{}", f.path);
    }
}

/// A flat router nothing mounts, in a package where no router mounts another, is
/// the API itself: its procedures keep their keys in both readings.
#[test]
fn a_flat_api_keeps_its_keys() {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"api\" }");
    write(r, "src/trpc.ts", TRPC);
    write(
        r,
        "src/app.ts",
        ORPHAN.replace("../trpc", "./trpc").as_str(),
    );
    let (facts, _) = scan(r, &opts()).unwrap();
    assert_eq!(routes(&facts, true), ["src/app.ts QUERY ping -> ping"]);
    assert_eq!(routes(&facts, false), routes(&facts, true));
}
