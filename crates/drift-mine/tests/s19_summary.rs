//! The short security summary (stream S19): the inventory's findings ranked from the
//! facts it holds, said in two or three lines each, repeats grouped, capped.
//!
//! Each test pins what did not exist before: `drift security` listed every finding
//! with no order a newcomer could act on, and a guard Drift could not read sat in the
//! same listing as one it read and found absent.

use drift_mine::practices::UnitRow;
use drift_mine::security::{EntryRow, Exposure, Inventory, Reach};
use drift_mine::security_summary::{
    Caller, Readings, Summary, Validation, render, render_first_run, summarize,
};

fn entry(path: &str, method: &str, route: &str, line: u32) -> EntryRow {
    EntryRow {
        path: path.to_string(),
        package: String::new(),
        symbol: format!("{method} {route}"),
        line,
        kind: "http".to_string(),
        method: Some(method.to_string()),
        route: Some(route.to_string()),
        guards: Vec::new(),
        wrappers: Vec::new(),
        opaque: Vec::new(),
        authenticates: Vec::new(),
        opens: Vec::new(),
        validates: false,
        reaches: Vec::new(),
        reads: Vec::new(),
        exposure: Exposure::Public,
        boundary: None,
        local: false,
        descriptions: Vec::new(),
        tied: false,
        basis: None,
        exposure_basis: None,
        known_open: false,
        verifies_signature: Vec::new(),
    }
}

fn reach(kind: &str, entry: &EntryRow, through: &[&str], fed: bool) -> Reach {
    let mut via = vec![format!("{}#{}", entry.path, entry.symbol)];
    via.extend(through.iter().map(|s| s.to_string()));
    Reach {
        kind: kind.to_string(),
        via,
        fed,
    }
}

fn with(mut e: EntryRow, kind: &str, through: &[&str], fed: bool) -> EntryRow {
    let r = reach(kind, &e, through, fed);
    e.reaches.push(r);
    e
}

fn inv(entries: Vec<EntryRow>) -> Inventory {
    Inventory {
        entry_points: entries,
        ..Inventory::default()
    }
}

fn ranked_kinds(s: &Summary) -> Vec<(String, Caller)> {
    s.ranked
        .iter()
        .map(|r| (r.kind.clone(), r.caller))
        .collect()
}

/// A request value reaching an operation of an entry point with no guard ranks
/// first; one guarded ranks after it even when its operation matters more; an
/// operation no request value was read reaching is not ranked and is counted.
#[test]
fn fed_and_unguarded_ranks_above_unfed() {
    let open = with(
        entry("server.ts", "POST", "/login", 10),
        "sql_string_interpolation",
        &["routes/login.ts#login"],
        true,
    );
    let mut guarded = with(
        entry("server.ts", "POST", "/contributions", 20),
        "eval",
        &["routes/contributions.ts#handle"],
        true,
    );
    guarded.guards = vec!["isLoggedIn".to_string()];
    let unfed = with(
        entry("server.ts", "GET", "/about", 30),
        "dynamic_fetch",
        &["lib/webhook.ts#notify"],
        false,
    );
    let s = summarize(&inv(vec![unfed, guarded, open]), &Readings::default());
    assert_eq!(
        ranked_kinds(&s),
        [
            ("sql_string_interpolation".to_string(), Caller::Anyone),
            ("eval".to_string(), Caller::PassesGuard),
        ]
    );
    assert_eq!(s.not_ranked.not_fed, 1);
    let text = render(&s, 10);
    let first = text.lines().position(|l| l.contains("/login")).unwrap();
    let second = text
        .lines()
        .position(|l| l.contains("/contributions"))
        .unwrap();
    assert!(first < second, "{text}");
    assert!(!text.contains("GET /about"), "{text}");
    assert!(
        text.contains("1 where Drift read no request value reaching the operation"),
        "{text}"
    );
}

/// Among entry points with no guard, what the operation does orders them: code
/// execution, then query injection, and a redirect last.
#[test]
fn consequence_orders_code_execution_before_queries_before_redirects() {
    let a = with(
        entry("a.ts", "GET", "/r", 1),
        "dynamic_redirect",
        &["a.ts#go"],
        true,
    );
    let b = with(
        entry("b.ts", "GET", "/q", 1),
        "nosql_injection",
        &["b.ts#find"],
        true,
    );
    let c = with(
        entry("c.ts", "GET", "/x", 1),
        "shell_exec",
        &["c.ts#run"],
        true,
    );
    let s = summarize(&inv(vec![a, b, c]), &Readings::default());
    let kinds: Vec<&str> = s.ranked.iter().map(|r| r.kind.as_str()).collect();
    assert_eq!(kinds, ["shell_exec", "nosql_injection", "dynamic_redirect"]);
}

/// A guard Drift could not read is never ranked, whatever it reaches: it is counted
/// under "could not read", and the text says nothing ranks.
#[test]
fn an_unknown_guard_is_never_ranked() {
    let mut e = with(
        entry("server.ts", "POST", "/upload", 5),
        "eval",
        &["lib/x.ts#run"],
        true,
    );
    e.opaque = vec!["uploadMiddleware".to_string()];
    let s = summarize(&inv(vec![e]), &Readings::default());
    assert!(s.ranked.is_empty(), "{:?}", s.ranked);
    assert_eq!(s.not_ranked.guard_unknown, 1);
    let text = render(&s, 10);
    assert!(text.contains("nothing ranks"), "{text}");
    assert!(
        text.contains("1 where Drift could not read the guard"),
        "{text}"
    );
    assert!(!text.contains("1. "), "{text}");
    let first = render_first_run(&s);
    assert_eq!(first.lines().count(), 1, "{first}");
    assert!(
        first.starts_with("From the security inventory: nothing ranks. Drift could not rank 1 pair(s) of an entry point and a risky operation it reaches"),
        "{first}"
    );
}

/// Twenty routes with the same hole through the same helper are one line with a
/// count and the first three places.
#[test]
fn repeats_through_one_operation_are_one_line() {
    let entries: Vec<EntryRow> = (0..20)
        .map(|i| {
            with(
                entry("server.ts", "GET", &format!("/files/{i:02}"), 100 + i),
                "path_traversal",
                &["lib/files.ts#serve"],
                true,
            )
        })
        .collect();
    let s = summarize(&inv(entries), &Readings::default());
    assert_eq!(s.ranked.len(), 1);
    assert_eq!(s.ranked[0].places.len(), 20);
    let text = render(&s, 10);
    let line = text.lines().find(|l| l.starts_with("  1. ")).unwrap();
    assert!(
        line.contains("at 20 entry points through lib/files.ts#serve"),
        "{line}"
    );
    assert!(line.contains("GET /files/00 (server.ts:100)"), "{line}");
    assert!(line.contains("GET /files/02 (server.ts:102)"), "{line}");
    assert!(!line.contains("/files/03"), "{line}");
    assert!(line.contains("and 17 more"), "{line}");
    assert!(!text.contains("  2. "), "{text}");
}

/// The text stops at N, then says how many more and the command that lists all.
#[test]
fn the_cap_line_counts_the_rest() {
    let entries: Vec<EntryRow> = (0..12)
        .map(|i| {
            with(
                entry("server.ts", "POST", &format!("/r{i:02}"), i + 1),
                "dynamic_fetch",
                &[format!("lib/f{i:02}.ts#send").as_str()],
                true,
            )
        })
        .collect();
    let s = summarize(&inv(entries), &Readings::default());
    assert_eq!(s.ranked.len(), 12);
    let text = render(&s, 10);
    assert!(text.contains("\n  10. "), "{text}");
    assert!(!text.contains("\n  11. "), "{text}");
    assert!(
        text.contains("  2 more ranked: `drift security --top 12` lists them all"),
        "{text}"
    );
    let top = s.top(10);
    assert_eq!((top.shown.len(), top.more), (10, 2));
    // The first run shows three.
    let first = render_first_run(&s);
    assert!(first.contains("\n  3. "), "{first}");
    assert!(!first.contains("\n  4. "), "{first}");
    assert!(
        first.contains("9 more ranked in `drift security --top`"),
        "{first}"
    );
}

/// The same inventory in any order gives the same summary and the same text.
#[test]
fn the_order_does_not_depend_on_the_input_order() {
    let mut entries = Vec::new();
    for (i, kind) in ["dynamic_redirect", "eval", "dynamic_fetch", "raw_sql"]
        .iter()
        .enumerate()
    {
        for j in 0..3u32 {
            let mut e = with(
                entry(
                    &format!("app/{i}.ts"),
                    if j == 0 { "GET" } else { "POST" },
                    &format!("/{i}/{j}"),
                    j + 1,
                ),
                kind,
                &[format!("lib/{}.ts#op", j % 2).as_str()],
                true,
            );
            if j == 2 {
                e.guards = vec!["requireUser".to_string()];
            }
            entries.push(e);
        }
    }
    let base = summarize(&inv(entries.clone()), &Readings::default());
    let mut reversed = entries.clone();
    reversed.reverse();
    let mut rotated = entries.clone();
    rotated.rotate_left(5);
    for other in [reversed, rotated] {
        let s = summarize(&inv(other), &Readings::default());
        assert_eq!(s, base);
        assert_eq!(render(&s, 0), render(&base, 0));
    }
}

/// The practice map's validation reading orders two otherwise equal lines: no
/// validation found before validated; the line says which it read.
#[test]
fn validation_found_ranks_after_none_found() {
    let a = with(entry("a.ts", "POST", "/a", 1), "raw_sql", &["a.ts#q"], true);
    let b = with(entry("b.ts", "POST", "/b", 1), "raw_sql", &["b.ts#q"], true);
    let units = vec![
        UnitRow {
            path: "a.ts".to_string(),
            symbol: "POST /a".to_string(),
            assignment: "known".to_string(),
            ..UnitRow::default()
        },
        UnitRow {
            path: "b.ts".to_string(),
            symbol: "POST /b".to_string(),
            assignment: "none".to_string(),
            ..UnitRow::default()
        },
    ];
    let s = summarize(&inv(vec![a, b]), &Readings::from_units(&units));
    let order: Vec<(&str, Validation)> = s
        .ranked
        .iter()
        .map(|r| (r.places[0].path.as_str(), r.validation))
        .collect();
    assert_eq!(
        order,
        [("b.ts", Validation::NotFound), ("a.ts", Validation::Found)]
    );
    let text = render(&s, 10);
    assert!(text.contains("no input validation found"), "{text}");
    assert!(text.contains("the input is validated on the way"), "{text}");
}

/// What is how the code is set up (a cookie flag), what runs locally, what a queue
/// or a schedule starts, and test code are counted, not ranked.
#[test]
fn settings_local_scheduled_and_test_code_are_not_ranked() {
    let cookie = with(
        entry("a.py", "GET", "/c", 1),
        "cookie_without_httponly",
        &[],
        true,
    );
    let mut local = with(
        entry("cli.py", "GET", "/l", 1),
        "shell_exec",
        &["cli.py#run"],
        true,
    );
    local.local = true;
    let mut job = with(
        entry("jobs.py", "GET", "/j", 1),
        "dynamic_fetch",
        &["jobs.py#sync"],
        true,
    );
    job.kind = "job".to_string();
    let test = with(
        entry("api.test.ts", "GET", "/t", 1),
        "eval",
        &["api.test.ts#x"],
        true,
    );
    let s = summarize(&inv(vec![cookie, local, job, test]), &Readings::default());
    assert!(s.ranked.is_empty(), "{:?}", s.ranked);
    let n = s.not_ranked;
    assert_eq!(
        (
            n.settings,
            n.no_remote_caller,
            n.no_caller,
            n.test_or_example
        ),
        (1, 1, 1, 1)
    );
}

/// Each line is two or three lines: what a caller can do and where, what Drift read,
/// and what it could not read.
#[test]
fn a_line_says_what_was_read_and_what_was_not() {
    let mut e = with(
        entry("server.ts", "POST", "/rest/user/login", 635),
        "sql_string_interpolation",
        &["routes/login.ts#login"],
        true,
    );
    e.exposure = Exposure::Unknown;
    let s = summarize(&inv(vec![e]), &Readings::default());
    let text = render(&s, 10);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines[1],
        "  1. A caller Drift found no guard for can send a value that is written into the text of an SQL query (sql_string_interpolation): POST /rest/user/login (server.ts:635); the operation is in routes/login.ts#login."
    );
    assert_eq!(
        lines[2],
        "     Read: no guard found in what Drift read; a value the request sent reaches the operation through login."
    );
    assert_eq!(
        lines[3],
        "     Not read: whether the value is checked before the operation; whether the input is validated; where the entry point can be reached from."
    );
}
