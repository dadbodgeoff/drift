//! Logging (PLAN-R13 §1.4): which logger each logging symbol uses, and in which style.
//! Population: symbols with at least one log-call candidate (`log_calls`) that is not
//! a proven non-logger (a toast's `error`, `Math.log`, and what Python's standard
//! library answers outside `logging`: `math.log`, an argparse parser's `error`).
//!
//! The instrument is the logger's origin, read through the receiver binding:
//! `console`, `print`, a library logger (pino, winston, structlog, loguru, Nest
//! `Logger`, `logging.getLogger`, ...), or the repo's own logger: an in-repo binding
//! built by a logger library and imported by at least [`REPO_LOGGER_FILES`] files
//! (`repo_logger`, "repo logger lib/log.ts#log (winston)"). The mechanism is the
//! style: `structured` (an object or keyword arguments) or `message`.
//!
//! Unknown [STRICT]: a level-named call on a receiver with no logging origin
//! (`unclassified`, no guess), or whose binding is in a file not parsed. There is no
//! `none`: the population is symbols that log.

use drift_core::{FileFacts, LogCall, Symbol};

use super::common::{self, declared, external, in_skipped, unknown, use_of};
use super::libraries::{logger_library, not_logger};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};

pub struct Logging;

/// Files that must import an in-repo logger binding for it to be the repo's logger.
pub const REPO_LOGGER_FILES: usize = 3;

// No way of logging is passive ([`Concern::passive`], the default): logging to the
// language's own output would be, but the classifier records no fact of the use that
// says so (its mechanisms are the style and whether the logger is the repo's own), and
// deciding from the instrument's name would be a list of names.

impl Concern for Logging {
    fn id(&self) -> &'static str {
        super::LOGGING
    }

    fn unit(&self) -> &'static str {
        "symbol"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        let mut out = Vec::new();
        for file in &cx.facts.files {
            for symbol in &file.symbols {
                if symbol.log_calls.iter().any(|l| !not_logger(&l.callee)) {
                    out.push(UnitRef::Symbol { file, symbol });
                }
            }
        }
        out
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        let UnitRef::Symbol { file, symbol } = *unit else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if !file.parse_ok {
            return unknown(UnknownReason::Unparsed, &file.path);
        }
        if let Some(a) = common::truncated(file, symbol, &["log_calls"]) {
            return a;
        }
        let mut uses: Vec<Use> = Vec::new();
        let mut sources = Vec::new();
        let mut labels = Vec::new();
        for l in symbol.log_calls.iter().filter(|l| !not_logger(&l.callee)) {
            let style = if l.structured {
                "structured"
            } else {
                "message"
            };
            match origin(cx, file, l) {
                Ok(o) => {
                    labels.push(format!("{style} logs via {}", o.label));
                    uses.push(use_of(o.mechanism(style), &o.instrument));
                    sources.push(o.source);
                }
                Err((reason, instrument)) => return unknown(reason, &instrument),
            }
        }
        uses.sort();
        uses.dedup();
        labels.sort();
        labels.dedup();
        Assignment::Known {
            uses,
            label: labels.join(" + "),
            source: common::source_of(&sources),
        }
    }
}

/// Where a log call's logger comes from.
struct Origin {
    instrument: String,
    label: String,
    repo_logger: bool,
    source: VariantSource,
}

impl Origin {
    fn mechanism(&self, style: &str) -> &'static str {
        match (self.repo_logger, style) {
            (true, "structured") => "structured_repo_logger",
            (true, _) => "message_repo_logger",
            (false, "structured") => "structured",
            (false, _) => "message",
        }
    }

    fn library(name: &str, source: VariantSource) -> Self {
        Origin {
            instrument: name.to_string(),
            label: name.to_string(),
            repo_logger: false,
            source,
        }
    }
}

fn origin(cx: &Cx<'_>, file: &FileFacts, l: &LogCall) -> Result<Origin, (UnknownReason, String)> {
    let c = l.callee.as_str();
    if c.starts_with("global#console.") {
        return Ok(Origin::library("console", VariantSource::Vocab));
    }
    if c == "global#print" {
        return Ok(Origin::library("print", VariantSource::Vocab));
    }
    let receiver = c.rsplit_once('.').map_or(c, |(r, _)| r);
    if let Some(label) =
        declared(cx, super::LOGGING, receiver).or_else(|| declared(cx, super::LOGGING, c))
    {
        return Ok(Origin {
            instrument: receiver.to_string(),
            label: label.to_string(),
            repo_logger: false,
            source: VariantSource::Declared,
        });
    }
    if let Some(lib) = logger_library(c) {
        return Ok(Origin::library(&lib, VariantSource::Vocab));
    }
    if external(c) {
        return Err((UnknownReason::Unclassified, receiver.to_string()));
    }
    let Some(d) = cx.context().definition(receiver) else {
        let reason = if in_skipped(cx, receiver) {
            UnknownReason::Unparsed
        } else {
            UnknownReason::Unclassified
        };
        return Err((reason, receiver.to_string()));
    };
    let module = receiver.split_once('#').map_or("", |(m, _)| m);
    let Some(lib) = logger_origin(cx, d, 0).or_else(|| assigned_in(cx, module, d)) else {
        return Err((UnknownReason::Unclassified, receiver.to_string()));
    };
    if module != file.path && importers(cx, module, &d.name) >= REPO_LOGGER_FILES {
        return Ok(Origin {
            instrument: receiver.to_string(),
            label: format!("repo logger {receiver} ({lib})"),
            repo_logger: true,
            source: VariantSource::Usage,
        });
    }
    Ok(Origin::library(&lib, VariantSource::Usage))
}

/// Bindings followed at most from a logger binding to the library it wraps.
const LOGGER_HOPS: usize = 5;

/// The logger library (or `console`) a binding is built on: what it calls, is wrapped
/// in, extends or derives from, its methods' calls for a class, and, followed through
/// the in-repo bindings and factories it is built from (`logger = extendedLogger`,
/// `extendedLogger = pinoLogger.child(...)`, `pinoLogger = pino(...)`), theirs.
fn logger_origin(cx: &Cx<'_>, d: &Symbol, hops: usize) -> Option<String> {
    let refs: Vec<&String> = d
        .calls
        .iter()
        .chain(d.wraps.iter().map(|w| &w.wrapper))
        .chain(d.members.iter().flat_map(|m| &m.calls))
        .chain(
            [&d.derives_from, &d.made_by]
                .into_iter()
                .filter(|x| !x.is_empty()),
        )
        .collect();
    for r in &refs {
        if r.starts_with("global#console.") {
            return Some("console".into());
        }
        if let Some(l) = logger_library(r) {
            return Some(l);
        }
    }
    if hops >= LOGGER_HOPS {
        return None;
    }
    refs.iter()
        .filter(|r| !external(r))
        .filter_map(|r| cx.context().definition(r.trim_end_matches("(ref)")))
        .filter(|n| !std::ptr::eq(*n, d))
        .find_map(|n| logger_origin(cx, n, hops + 1))
}

/// A binding declared without a value (`export let logger: Logger`) and assigned
/// elsewhere in its module: the logger library the module's own code builds it with.
fn assigned_in(cx: &Cx<'_>, module: &str, d: &Symbol) -> Option<String> {
    if !(d.calls.is_empty() && d.derives_from.is_empty() && d.wraps.is_empty()) {
        return None;
    }
    let f = common::file_at(cx.facts, module)?;
    f.symbols
        .iter()
        .flat_map(|s| &s.calls)
        .find_map(|c| logger_library(c))
}

/// Files that import `name` (or everything) from `module`.
fn importers(cx: &Cx<'_>, module: &str, name: &str) -> usize {
    cx.facts
        .files
        .iter()
        .filter(|f| {
            f.imports
                .iter()
                .any(|i| i.module == module && i.names.iter().any(|n| n == name || n == "*"))
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn library_loggers_through_bindings() {
        let d = empty();
        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        assert_eq!(all.len(), 4, "{all:#?}");
        assert_eq!(
            key(&of(&all, "services/api/app/routers/items.py", "read_item")),
            "structured:structlog"
        );
        assert_eq!(
            key(&of(&all, "services/api/app/services/billing.py", "charge")),
            "structured:logging"
        );
        assert_eq!(
            key(&of(&all, "services/api/app/main.py", "unhandled")),
            "message:logging"
        );
        assert_eq!(
            key(&of(&all, "services/legacy/views.py", "show")),
            "message:print"
        );

        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        assert_eq!(
            key(&of(&all, "app/api/projects/[projectId]/route.ts", "GET")),
            "structured:pino"
        );
        assert_eq!(
            key(&of(&all, "app/api/webhooks/stripe/route.ts", "POST")),
            "message:console"
        );
        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        assert_eq!(
            key(&of(
                &all,
                "src/projects/projects.service.ts",
                "ProjectsService"
            )),
            "structured:@nestjs/common#Logger"
        );
    }

    #[test]
    fn repo_logger_and_unknown() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        for f in ["lib/a.ts", "lib/b.ts", "lib/c.ts"] {
            assert_eq!(
                key(&of(&all, f, "work")),
                "message_repo_logger:lib/log.ts#log"
            );
        }
        assert_eq!(
            of(&all, "lib/util.ts", "report"),
            unknown(UnknownReason::Unclassified, "lib/util.ts#tracker")
        );
        // A toast is no log call.
        assert!(!all.iter().any(|(p, _, _)| p == "lib/toast.ts"));
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        assert_eq!(
            of(&all, "svc/app/jobs.py", "run"),
            unknown(UnknownReason::Unclassified, "svc/app/jobs.py#metrics")
        );
        assert_eq!(
            key(&of(&all, "svc/app/jobs.py", "tidy")),
            "structured:loguru"
        );
    }

    #[test]
    fn repo_loggers_to_the_library_they_wrap() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        let f = "lib/use-loggers.ts";
        assert_eq!(key(&of(&all, f, "stepwise")), "message:pino");
        assert_eq!(key(&of(&all, f, "assigned")), "message:pino");
        assert_eq!(key(&of(&all, f, "injected")), "structured:nestjs-pino");
    }

    /// A call named like a level that Python's standard library answers outside
    /// `logging` is no log call: `math.log(x)` logs nothing, so a symbol that only takes
    /// a logarithm is not in the population, and `parser.error(..)` on an argparse
    /// parser does not hide the logger the symbol does use. The strict side stays: what
    /// a standard-library function returns may be a logger, and a package no table
    /// knows is unclassified, never guessed.
    #[test]
    fn standard_library_calls_named_like_a_level_are_no_log_calls() {
        let call = |callee: &str, level: &str| LogCall {
            callee: callee.into(),
            level: level.into(),
            ..LogCall::default()
        };
        let symbol = |name: &str, log_calls: Vec<LogCall>| Symbol {
            name: name.into(),
            log_calls,
            ..Symbol::default()
        };
        let facts = drift_core::RepoFacts {
            files: vec![FileFacts {
                path: "tool/cli.py".into(),
                lang: "py".into(),
                parse_ok: true,
                symbols: vec![
                    symbol("ln", vec![call("pkg:python:math#log", "log")]),
                    symbol(
                        "main",
                        vec![
                            call("global#print", "print"),
                            call("pkg:python:argparse#ArgumentParser().error", "error"),
                        ],
                    ),
                    symbol(
                        "worker",
                        vec![call("pkg:python:multiprocessing#get_logger().info", "info")],
                    ),
                    symbol("science", vec![call("pkg:numpy#log", "log")]),
                ],
                ..FileFacts::default()
            }],
            ..drift_core::RepoFacts::default()
        };
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        let names: Vec<&str> = all.iter().map(|(_, n, _)| n.as_str()).collect();
        assert_eq!(names, ["main", "worker", "science"]);
        assert_eq!(key(&of(&all, "tool/cli.py", "main")), "message:print");
        assert_eq!(
            of(&all, "tool/cli.py", "worker"),
            unknown(
                UnknownReason::Unclassified,
                "pkg:python:multiprocessing#get_logger()"
            )
        );
        assert_eq!(
            of(&all, "tool/cli.py", "science"),
            unknown(UnknownReason::Unclassified, "pkg:numpy#log")
        );
    }

    /// Python's standard library is canonical under its language
    /// (`pkg:python:logging`): it is the `logging` library.
    #[test]
    fn python_stdlib_logging() {
        let d = empty();
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Logging, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/stdlog.py", "sync")),
            "structured:logging"
        );
        assert_eq!(
            key(&of(&all, "svc/app/stdlog.py", "direct")),
            "message:logging"
        );
    }
}
