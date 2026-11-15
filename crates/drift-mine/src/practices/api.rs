//! API design and responses (PLAN-R13 §1.5). Population: `http` entry points.
//!
//! The key combines how success responses are built, whether a response model is
//! declared, and the error envelope:
//! - `builder:<canonical>`: the most used builder of returned or set responses
//!   (`NextResponse.json`, `res.status().json`, `JSONResponse`); `builder:literal` for
//!   literal returns (a Flask tuple); `builder:return_value` for a framework that
//!   serialises what the handler returns (FastAPI, Nest, tRPC, Flask, Django Ninja)
//!   when no builder is seen;
//! - `model:declared`: a declared response model or schema;
//! - `envelope:{a,b}`: the body keys of the error (status >= 400) responses.
//!
//! Status codes and route shape are attributes, not part of the key. Unknown
//! [STRICT]: no response seen on a framework that does not serialise return values
//! (`unclassified`: what it sends cannot be told).

use std::collections::{BTreeMap, BTreeSet};

use drift_core::ResponseVia;

use super::common::{self, unit_symbol, unknown, unreadable, use_of};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, VariantSource};

pub struct Api;

/// Adapters whose framework turns a handler's return value into the response.
pub const RETURN_VALUE_ADAPTERS: &[&str] = &[
    "fastapi", "nestjs", "trpc", "flask", "ninja", "litestar", "graphql", "drf", "fastify",
    "elysia",
];

impl Concern for Api {
    fn id(&self) -> &'static str {
        super::API
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, &["http"])
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        if let Some(a) = unreadable(cx, unit) {
            return a;
        }
        let (UnitRef::Entry { entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit))
        else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if let Some(a) = common::truncated(sfile, s, &["responses"]) {
            return a;
        }
        let bodies = common::bodies(cx, s);
        let responses: Vec<&drift_core::ResponseFact> =
            bodies.iter().flat_map(|b| &b.responses).collect();
        let builder = match sent_by(&responses) {
            Some(b) => b,
            None => match helper(cx, &bodies, 0).or_else(|| wrapper(cx, s)) {
                Some(h) => h,
                None if RETURN_VALUE_ADAPTERS.contains(&entry.adapter.as_str()) => {
                    "return_value".to_string()
                }
                // What it sends cannot be told: no response, helper or serialising
                // framework is seen. No instrument to name.
                None => return unknown(UnknownReason::Unclassified, ""),
            },
        };
        let mut uses = vec![use_of("builder", &builder)];
        if responses.iter().any(|r| !r.model.is_empty()) {
            uses.push(use_of("model", "declared"));
        }
        let keys: BTreeSet<&str> = responses
            .iter()
            .filter(|r| r.status >= 400)
            .flat_map(|r| r.keys.iter().map(String::as_str))
            .collect();
        if !keys.is_empty() {
            let keys: Vec<&str> = keys.into_iter().collect();
            uses.push(use_of("envelope", &format!("{{{}}}", keys.join(","))));
        }
        let source = if common::external(&builder) || !builder.contains('#') {
            VariantSource::Vocab
        } else {
            VariantSource::Usage
        };
        common::known(uses, source)
    }
}

/// The builder of the returned or set responses: the most used (then by name), or
/// `literal` for literal returns.
fn sent_by(responses: &[&drift_core::ResponseFact]) -> Option<String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    let mut literal = false;
    for r in responses
        .iter()
        .filter(|r| matches!(r.via, ResponseVia::Return | ResponseVia::Setter))
    {
        if r.builder.is_empty() {
            literal = true;
        } else {
            *counts.entry(r.builder.as_str()).or_default() += 1;
        }
    }
    counts
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0)))
        .map(|(b, _)| b.to_string())
        .or_else(|| literal.then(|| "literal".to_string()))
}

/// An in-repo function the bodies call that returns or sets a response
/// (`logAndRespond(...)`): the repo's response helper, followed two levels.
fn helper(cx: &Cx<'_>, bodies: &[&drift_core::Symbol], depth: usize) -> Option<String> {
    if depth >= 2 {
        return None;
    }
    let mut found: Vec<String> = Vec::new();
    for c in bodies.iter().flat_map(|b| &b.calls) {
        if c.ends_with("(ref)") || common::external(c) {
            continue;
        }
        let Some(d) = cx.context().definition(c) else {
            continue;
        };
        if d.kind != drift_core::SymbolKind::Function {
            continue;
        }
        let rs: Vec<&drift_core::ResponseFact> = d.responses.iter().collect();
        if sent_by(&rs).is_some() || helper(cx, &[d], depth + 1).is_some() {
            found.push(crate::mine::norm_ref(c).into_owned());
        }
    }
    found.sort();
    found.into_iter().next()
}

/// The entry's call wrapper sends the response itself (its definition returns or sets
/// one): the wrapper is the builder.
fn wrapper(cx: &Cx<'_>, s: &drift_core::Symbol) -> Option<String> {
    s.wraps
        .iter()
        .filter(|w| w.kind == drift_core::WrapKind::Call && !common::external(&w.wrapper))
        .find(|w| {
            cx.context().definition(&w.wrapper).is_some_and(|d| {
                let rs: Vec<&drift_core::ResponseFact> = d.responses.iter().collect();
                sent_by(&rs).is_some()
            })
        })
        .map(|w| crate::mine::norm_ref(&w.wrapper).into_owned())
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn builder_model_envelope() {
        let d = empty();
        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Api, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(
            key(&of(&all, route, "GET")),
            "builder:pkg:next#NextResponse.json+envelope:{error}"
        );
        assert_eq!(key(&of(&all, route, "GET")), key(&of(&all, route, "POST")));
        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Api, &cx);
        assert_eq!(
            key(&of(
                &all,
                "services/api/app/routers/items.py",
                "create_item"
            )),
            "builder:return_value+model:declared"
        );
        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Api, &cx);
        assert_eq!(
            key(&of(
                &all,
                "src/projects/projects.controller.ts",
                "GET /projects/:id"
            )),
            "builder:return_value+model:declared"
        );
    }

    #[test]
    fn unknown_when_nothing_is_sent() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Api, &cx);
        assert_eq!(
            of(&all, "app/api/session/route.ts", "GET"),
            unknown(UnknownReason::Unclassified, "")
        );
        assert_eq!(
            key(&of(&all, "app/api/open/route.ts", "GET")),
            "builder:pkg:next#NextResponse.json"
        );
    }

    #[test]
    fn helpers_and_handed_over_bodies() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Api, &cx);
        assert_eq!(
            key(&of(&all, "app/api/cron/sync/route.ts", "GET")),
            "builder:app/api/cron/utils.ts#logAndRespond"
        );
        assert_eq!(
            key(&of(&all, "app/api/calendar/route.ts", "DELETE")),
            "builder:pkg:next#NextResponse.json"
        );
        // Fastify sends what the handler returns.
        assert_eq!(
            key(&of(&all, "backend/routes/acme.ts", "POST /new-account")),
            "builder:return_value"
        );
        // Unknown names no pseudo-instrument.
        assert_eq!(
            of(&all, "app/api/session/route.ts", "GET"),
            unknown(UnknownReason::Unclassified, "")
        );
    }
}
