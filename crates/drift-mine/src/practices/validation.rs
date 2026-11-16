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
        // What the listed reading adds (TypeScript): calls handed what the request
        // sent beside a schema, and the pipes a parameter decorator is handed. A
        // function of the repository handed both may check the input or not: its
        // body is not followed here, so it is found, not proven [STRICT].
        let mut unproven: Option<String> = None;
        for c in bodies.iter().flat_map(|b| &b.controls) {
            let read = if let Some(rest) = c.strip_prefix(controls::PARSES_INPUT) {
                parsed_input(cx, rest)
            } else if let Some(pipe) = c.strip_prefix(controls::PIPES_INPUT) {
                piped_input(cx, pipe)
            } else {
                continue;
            };
            match read {
                Some(Ok((mechanism, lib, source))) => {
                    uses.push(use_of(mechanism, &lib));
                    sources.push(source);
                }
                Some(Err(instrument)) => {
                    if unproven.as_ref().is_none_or(|u| instrument < *u) {
                        unproven = Some(instrument);
                    }
                }
                None => {}
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
                    // A schema handed to a call beside the input was read above.
                    None if !uses.is_empty() => {}
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
        // Python: every input the handler takes is a parameter the framework parses
        // by its declared type before the body runs (`id: uuid.UUID` in FastAPI, a
        // `<uuid:pk>` converter in a Django route), and the body reads no other
        // ([`controls::INPUT_TYPED`]): a value of another shape is answered with an
        // error. Only where nothing else was found, so a unit that also binds a
        // model keeps its way. [STRICT] Shown, as a check found and not proven, and
        // never a use: the audits measured Drift's reading of typed parameters wrong
        // (3 of 3), and this reading of them is not yet measured, so it is no way a
        // candidate rule may rest on (review R5, row 7). A person may declare it.
        if uses.is_empty()
            && sfile.lang == "py"
            && s.controls.iter().any(|c| c == controls::INPUT_TYPED)
        {
            return unknown(
                UnknownReason::CheckNotProven,
                &format!("typed_param:{}", entry.adapter),
            );
        }
        if !uses.is_empty() {
            return common::known(uses, common::source_of(&sources));
        }
        if let Some(instrument) = unproven {
            return unknown(UnknownReason::Unclassified, &instrument);
        }
        if SCHEMA_IN_OPTIONS.contains(&entry.adapter.as_str()) {
            // The route's options may carry its schema (`schema: { body }`), which the
            // facts do not hold: nothing found is not none [STRICT].
            unknown(UnknownReason::Unresolved, "")
        } else if common::any_control(&bodies, controls::READS_INPUT) {
            // The input is handed to a call of a package (or one not resolved)
            // that is no validation library Drift knows: what it does with the
            // input is not read, so whether it validates is unknown, never none.
            if let Some(callee) = handed_unread(&bodies) {
                return unknown(UnknownReason::Unclassified, &callee);
            }
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
///
/// A body whose parameter names the input only to leave it unread
/// ([`controls::INPUT_UNREAD`], `async ({ ctx, input }) => handler({ ctx })`)
/// takes none either: naming a key is not reading it.
pub fn may_read_input<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> bool {
    unit_symbol(cx, unit).is_none_or(|(_, s)| {
        !common::bodies(cx, s).iter().all(|b| {
            b.controls
                .iter()
                .any(|c| c == controls::NO_INPUT || c == controls::INPUT_UNREAD)
        })
    })
}

/// The first (by name) call of a package, or one that did not resolve, a body
/// hands the request's input to ([`controls::INPUT_HANDED`]) and that is no
/// validation library Drift knows ([`validation_library`]). A function of the
/// repository is not counted: its body is code Drift reads where it is defined.
fn handed_unread(bodies: &[&drift_core::Symbol]) -> Option<String> {
    bodies
        .iter()
        .flat_map(|b| &b.controls)
        .filter_map(|c| c.strip_prefix(controls::INPUT_HANDED))
        .flat_map(|rest| rest.split('\t'))
        .filter(|callee| callee.starts_with("pkg:") || callee.starts_with("unresolved:"))
        .filter(|callee| validation_library(callee).is_none())
        .min()
        .map(str::to_string)
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

/// What a call handed what the request sent beside a binding does with it
/// ([`controls::PARSES_INPUT`], `<callee>\t<binding>`): `None` where the binding is
/// no schema (a client, a setting, a function), so the call says nothing of
/// validation. Where it is one, a package's call checks the request against it
/// (`parseWithZod(formData, { schema })`): `schema:<library>`, the library the
/// schema is built with, whatever the callee is called. A function of the
/// repository handed both, or a callee that was not resolved, is not followed:
/// `Err` with it.
fn parsed_input(cx: &Cx<'_>, rest: &str) -> Option<Result<Classified, String>> {
    let (callee, given) = rest.split_once('\t')?;
    let (lib, source) = if let Some(label) = declared(cx, super::VALIDATION, given) {
        (label.to_string(), VariantSource::Declared)
    } else if let Some(lib) = validation_library(given) {
        (lib, VariantSource::Usage)
    } else if external(given) {
        return None;
    } else {
        let d = cx.context().definition(given)?;
        if matches!(d.kind, SymbolKind::Function | SymbolKind::Class) {
            return None;
        }
        (schema_library(cx, d, 0)?, VariantSource::Usage)
    };
    if callee.starts_with("pkg:") {
        Some(Ok(("schema", lib, source)))
    } else {
        Some(Err(crate::mine::norm_ref(callee).into_owned()))
    }
}

/// What a pipe a parameter decorator is handed does to the request's value
/// ([`controls::PIPES_INPUT`]): the framework runs it on the value before the
/// handler and answers for what it refuses. A package's pipe is a typed model of
/// the parameter by that pipe; a class of the repository is a schema where its own
/// calls are a validation library's, and found, not proven, otherwise (`Err`). A
/// reference to anything but a class (a constant naming the parameter) is no pipe.
fn piped_input(cx: &Cx<'_>, pipe: &str) -> Option<Result<Classified, String>> {
    if let Some(label) = declared(cx, super::VALIDATION, pipe) {
        return Some(Ok(("schema", label.to_string(), VariantSource::Declared)));
    }
    if pipe.starts_with("pkg:") {
        return Some(Ok(("typed_model", pipe.to_string(), VariantSource::Usage)));
    }
    if external(pipe) {
        return Some(Err(crate::mine::norm_ref(pipe).into_owned()));
    }
    let d = cx.context().definition(pipe)?;
    if d.kind != SymbolKind::Class {
        return None;
    }
    Some(
        d.calls
            .iter()
            .find_map(|c| validation_library(c))
            .map(|lib| ("schema", lib, VariantSource::Usage))
            .ok_or_else(|| crate::mine::norm_ref(pipe).into_owned()),
    )
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

    /// The listed reading's parses and pipes: a package's call handed a schema beside
    /// what the request sent validates with the schema's library, whatever it is
    /// called; one of the repository is found, not proven; a binding that is no
    /// schema says nothing; a package's pipe on a parameter is a typed model.
    #[test]
    fn calls_handed_a_schema_and_parameter_pipes() {
        let d = empty();
        let route = "app/api/projects/[projectId]/route.ts";
        let with = |control: &str| {
            let mut facts = fixtures::next_clerk();
            for f in facts.files.iter_mut().filter(|f| f.path == route) {
                for s in f.symbols.iter_mut().filter(|s| s.name == "GET") {
                    s.controls.push(control.to_string());
                }
            }
            facts
        };
        let at = |facts: &drift_core::RepoFacts| {
            let cx = Cx::new(facts, &d);
            of(&assign_all(&Validation, &cx), route, "GET")
        };
        let parses = controls::PARSES_INPUT;
        let facts = with(&format!(
            "{parses}pkg:@conform-to/zod#parseWithZod\tlib/schemas.ts#CreateProject"
        ));
        assert_eq!(key(&at(&facts)), "schema:zod");
        let facts = with(&format!(
            "{parses}lib/forms.ts#parseForm\tlib/schemas.ts#CreateProject"
        ));
        assert!(
            matches!(at(&facts), Assignment::Unknown { .. }),
            "{:?}",
            at(&facts)
        );
        // `db` is a client, not a schema: the call says nothing of validation.
        let facts = with(&format!("{parses}pkg:acme#send\tlib/db.ts#db"));
        assert!(matches!(at(&facts), Assignment::None { .. }), "{:?}", at(&facts));
        let facts = with(&format!(
            "{}pkg:@nestjs/common#ParseIntPipe",
            controls::PIPES_INPUT
        ));
        let k = key(&at(&facts));
        assert!(
            k.starts_with("typed_model:") && k.ends_with("ParseIntPipe"),
            "{k}"
        );
        // Without them the handler reads input and nothing validates it.
        let facts = fixtures::next_clerk();
        assert!(matches!(at(&facts), Assignment::None { .. }));
    }
}
