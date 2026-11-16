//! Input validation (PLAN-R13 §1.6). Population: request entry points that read input
//! (`reads_input`) or whose input is unknown (neither `reads_input` nor `no_input`).
//!
//! Uses:
//! - `schema:<library>`: input parsed with a schema value at the boundary (`inputs`
//!   whose definition is built with zod, yup, joi, valibot, ...; a `validates` body
//!   calling one);
//! - `typed_model:<library>`: input bound to a declared class the framework validates
//!   (a pydantic model, a DRF serializer, a Nest DTO with class-validator decorators
//!   and a `ValidationPipe` in the repo; a FastAPI body model);
//!   `typed_model_unchecked:class-validator` when no `ValidationPipe` is seen;
//! - `manual:body_check`: a check on a parameter or header that answers 400 or 422.
//!
//! None: the handler reads input and nothing validates it. Unknown [STRICT]: input
//! not known to be read (`unclassified` `input`), an input type or a `validates`
//! body whose library cannot be told, an input step on a tRPC / next-safe-action
//! chain with no input recorded, an in-repo wrapper with no definition.

use drift_core::{SymbolKind, WrapKind, builders::INPUT_STEPS, controls};

use super::common::{
    self, REQUEST_KINDS, declared, external, in_skipped, unit_symbol, unknown, unreadable, use_of,
};
use super::libraries::{TYPED_MODEL_LIBRARIES, VALIDATION_PIPE_CALLEES, validation_library};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, Use, VariantSource};

pub struct Validation;

/// Adapters whose route options declare the request schema the framework validates
/// with (Fastify `schema: { body, querystring }`), which the facts do not record.
const SCHEMA_IN_OPTIONS: &[&str] = &["fastify"];

impl Concern for Validation {
    fn id(&self) -> &'static str {
        super::VALIDATION
    }

    fn unit(&self) -> &'static str {
        "entry_point"
    }

    /// Input parsed with the accepted schema and checked by hand as well is still
    /// parsed with that schema: the checks add up.
    fn additive(&self) -> bool {
        true
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        common::entries(cx, REQUEST_KINDS)
            .into_iter()
            .filter(|u| may_read_input(cx, u))
            .collect()
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        if let Some(a) = unreadable(cx, unit) {
            return a;
        }
        let (UnitRef::Entry { entry, .. }, Some((sfile, s))) = (*unit, unit_symbol(cx, unit))
        else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if let Some(a) = common::truncated(sfile, s, &["inputs", "body_checks", "responses"]) {
            return a;
        }
        let ctx = cx.context();
        let mut uses: Vec<Use> = Vec::new();
        let mut sources: Vec<VariantSource> = Vec::new();
        for w in s.wraps.iter().filter(|w| w.kind == WrapKind::Call) {
            if !external(&w.wrapper) && ctx.definition(&w.wrapper).is_none() {
                let reason = if in_skipped(cx, &w.wrapper) {
                    UnknownReason::Unparsed
                } else {
                    UnknownReason::OpaqueWrapper
                };
                return unknown(reason, &w.wrapper);
            }
        }
        let bodies = common::bodies(cx, s);
        let inputs: Vec<&String> = bodies.iter().flat_map(|b| &b.inputs).collect();
        for i in &inputs {
            match input(cx, &entry.adapter, i) {
                Ok((mechanism, lib, source)) => {
                    uses.push(use_of(mechanism, &lib));
                    sources.push(source);
                }
                Err((reason, instrument)) => return unknown(reason, &instrument),
            }
        }
        if inputs.is_empty() {
            if common::any_control(&bodies, "validates") {
                let lib = bodies
                    .iter()
                    .flat_map(|b| &b.calls)
                    .find_map(|c| schema_call(cx, c));
                match lib {
                    Some(l) => {
                        uses.push(use_of("schema", &l));
                        sources.push(VariantSource::Usage);
                    }
                    // A schema is applied, but which library cannot be told. The
                    // validating call is not named, so no instrument.
                    None => return unknown(UnknownReason::Unclassified, ""),
                }
            }
            let steps = s
                .derives_from
                .split('.')
                .skip(1)
                .any(|step| INPUT_STEPS.contains(&step.trim_end_matches("()")));
            if steps && uses.is_empty() {
                return unknown(UnknownReason::Unclassified, &s.derives_from);
            }
        }
        let rejects_bad_input = bodies
            .iter()
            .flat_map(|b| &b.responses)
            .any(|r| matches!(r.status, 400 | 422) && !r.in_catch);
        let checks = || bodies.iter().flat_map(|b| &b.body_checks);
        // A presence or shape check that answers 400 / 422 (`if (!body.name) return
        // 400`): manual validation, whatever the check reads.
        let manual = checks().any(common::check_invalid) || rejects_bad_input;
        if manual {
            uses.push(use_of("manual", "body_check"));
            sources.push(VariantSource::Usage);
        }
        if !uses.is_empty() {
            return common::known(uses, common::source_of(&sources));
        }
        if SCHEMA_IN_OPTIONS.contains(&entry.adapter.as_str()) {
            // The route's options may carry its schema (`schema: { body }`), which the
            // facts do not hold: nothing found is not none [STRICT].
            unknown(UnknownReason::Unresolved, "")
        } else if common::any_control(&bodies, controls::READS_INPUT) {
            Assignment::None {
                label: "reads input, nothing validates it".into(),
            }
        } else {
            // Whether it reads input at all is not known; nothing to name.
            unknown(UnknownReason::Unclassified, "")
        }
    }
}

/// Whether an entry unit is one this concern counts: out only when every body it runs
/// provably takes no input. [`Validation::assign`] is not to be asked about any other
/// unit: of one that reads nothing it can only say it does not know whether input is
/// read.
pub fn may_read_input<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> bool {
    unit_symbol(cx, unit).is_none_or(|(_, s)| {
        !common::bodies(cx, s)
            .iter()
            .all(|b| b.controls.iter().any(|c| c == controls::NO_INPUT))
    })
}

type Classified = (&'static str, String, VariantSource);

/// How an input type or schema validates: its library and whether it is a schema value
/// or a typed model.
fn input(cx: &Cx<'_>, adapter: &str, i: &str) -> Result<Classified, (UnknownReason, String)> {
    if let Some(label) = declared(cx, super::VALIDATION, i) {
        return Ok(("schema", label.to_string(), VariantSource::Declared));
    }
    let typed = |lib: String, source| {
        let m = if TYPED_MODEL_LIBRARIES.contains(&lib.as_str()) {
            "typed_model"
        } else {
            "schema"
        };
        (m, lib, source)
    };
    if let Some(lib) = validation_library(i) {
        return Ok(typed(lib, VariantSource::Vocab));
    }
    if external(i) {
        return Err((UnknownReason::Unclassified, i.to_string()));
    }
    let ctx = cx.context();
    let Some(d) = ctx.definition(i) else {
        // FastAPI validates every declared body or query model itself.
        if adapter == "fastapi" {
            return Ok(("typed_model", "fastapi".into(), VariantSource::Vocab));
        }
        let reason = if in_skipped(cx, i) {
            UnknownReason::Unparsed
        } else {
            UnknownReason::Unresolved
        };
        return Err((reason, i.to_string()));
    };
    if d.kind == SymbolKind::Class {
        let (module, _) = i.split_once('#').unwrap_or((i, ""));
        let class = format!("{module}#{}", d.name);
        // Its own field decorators, or an in-repo base's.
        let decorated = d
            .field_decorators
            .iter()
            .find_map(|f| validation_library(f))
            .or_else(|| {
                ctx.ancestors(&class).iter().find_map(|a| {
                    ctx.definition(a).and_then(|b| {
                        b.field_decorators
                            .iter()
                            .find_map(|f| validation_library(f))
                    })
                })
            });
        if let Some(lib) = decorated {
            let piped = cx.facts.files.iter().any(|f| {
                f.symbols.iter().any(|s| {
                    s.calls.iter().any(|c| {
                        VALIDATION_PIPE_CALLEES
                            .iter()
                            .any(|p| crate::mine::norm_ref(c).trim_end_matches("(new)") == *p)
                    })
                })
            });
            let m = if piped {
                "typed_model"
            } else {
                "typed_model_unchecked"
            };
            return Ok((m, lib, VariantSource::Usage));
        }
        if let Some(lib) = ctx
            .ancestors(&class)
            .iter()
            .find_map(|a| validation_library(a))
        {
            return Ok(typed(lib, VariantSource::Usage));
        }
        if adapter == "fastapi" {
            return Ok(("typed_model", "fastapi".into(), VariantSource::Vocab));
        }
        return Err((UnknownReason::Unclassified, i.to_string()));
    }
    match schema_library(cx, d, 0) {
        Some(lib) => Ok(typed(lib, VariantSource::Usage)),
        None => Err((UnknownReason::Unclassified, i.to_string())),
    }
}

/// Bindings followed at most from a schema value to the library it is built with.
const SCHEMA_HOPS: usize = 6;

/// The validation library a schema value is built with: one its own calls, wraps or
/// derivation name, or, followed through in-repo bindings it is built from
/// (`partnerSchema = analyticsQuerySchema.omit(...)`), theirs. A value the lowering
/// marks `schema_value` whose library cannot be reached is `repo_schema`.
fn schema_library(cx: &Cx<'_>, d: &drift_core::Symbol, hops: usize) -> Option<String> {
    let own = d
        .calls
        .iter()
        .chain(d.wraps.iter().map(|w| &w.wrapper))
        .chain(std::iter::once(&d.derives_from).filter(|x| !x.is_empty()));
    if let Some(l) = own.clone().find_map(|c| validation_library(c)) {
        return Some(l);
    }
    if hops < SCHEMA_HOPS {
        for c in own {
            if common::external(c) {
                continue;
            }
            if let Some(n) = cx.context().definition(c)
                && n.kind != SymbolKind::Function
                && !std::ptr::eq(n, d)
                && let Some(l) = schema_library(cx, n, hops + 1)
            {
                return Some(l);
            }
        }
    }
    (hops == 0 && d.traits.iter().any(|t| t == "schema_value")).then(|| "repo_schema".to_string())
}

/// The schema library a call validates with: a library's own call, or a method of an
/// in-repo schema value built with one (`CreateProject.parse`).
fn schema_call(cx: &Cx<'_>, c: &str) -> Option<String> {
    if let Some(l) = validation_library(c) {
        return Some(l);
    }
    if external(c) {
        return None;
    }
    let d = cx.context().definition(c)?;
    if d.kind == SymbolKind::Function {
        return None;
    }
    schema_library(cx, d, 0)
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn schemas_models_and_none() {
        let d = empty();
        let facts = fixtures::next_clerk();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(key(&of(&all, route, "POST")), "schema:zod");
        assert!(matches!(of(&all, route, "GET"), Assignment::None { .. }));
        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        assert_eq!(
            key(&of(
                &all,
                "services/api/app/routers/items.py",
                "create_item"
            )),
            "typed_model:fastapi"
        );
        let facts = fixtures::nest_mixed();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        // Decorated DTO, no ValidationPipe anywhere: declared, not enforced.
        assert_eq!(
            key(&of(
                &all,
                "src/projects/projects.controller.ts",
                "POST /projects"
            )),
            "typed_model_unchecked:class-validator"
        );
    }

    #[test]
    fn unknown_input_and_library() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        assert_eq!(
            of(&all, "app/api/form/route.ts", "POST"),
            unknown(UnknownReason::Unclassified, "")
        );
        assert_eq!(
            of(&all, "app/api/maybe/route.ts", "GET"),
            unknown(UnknownReason::Unclassified, "")
        );
        // `no_input`: out of the population.
        assert!(!all.iter().any(|(p, _, _)| p == "app/api/open/route.ts"));
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        assert_eq!(
            key(&of(&all, "svc/app/routes.py", "admin_items")),
            "manual:body_check+typed_model:pydantic"
        );
        assert!(matches!(
            of(&all, "svc/app/routes.py", "list_items"),
            Assignment::None { .. }
        ));
    }

    #[test]
    fn schemas_built_from_schemas_in_other_files() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        assert_eq!(
            key(&of(&all, "app/api/calendar/route.ts", "DELETE")),
            "schema:zod"
        );
    }

    /// A presence check answering 400 is manual validation, not none.
    #[test]
    fn presence_checks_are_manual() {
        let d = empty();
        let facts = fixtures::ts_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&Validation, &cx);
        assert_eq!(
            key(&of(&all, "apps/open/app/api/thing/route.ts", "POST")),
            "manual:body_check"
        );
    }
}
