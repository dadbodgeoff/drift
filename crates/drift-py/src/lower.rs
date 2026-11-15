//! Lower one Python file into raw, pre-resolution facts (see [`crate::raw`]).
//!
//! Two passes over the module: the first records every module-level binding
//! (imports, defs, classes, assignments, including inside top-level `if`/`try`
//! blocks), so references anywhere in the file resolve; the second lowers each
//! top-level declaration to a symbol. Names bound inside a function (parameters,
//! assignments, local imports) shadow module names, following Python's scoping
//! rules (class bodies are not visible from their methods).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use drift_core::{SymbolKind, WrapKind};
use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, PySourceType, Stmt};
use ruff_python_parser::parse_unchecked_source;
use ruff_source_file::{LineIndex, OneIndexed};
use ruff_text_size::{Ranged, TextSize};

use crate::raw::*;
use crate::stdlib;

/// Bumped whenever lowering output changes for the same input text.
pub const LOWERING_VERSION: u32 = 69;

/// Functions of libraries, by their last name, whose call in a body is a guard or
/// not by its arguments (`verify_jwt_in_request(optional=True)`): each call of a
/// name on the list is recorded with its arguments
/// ([`drift_core::controls::SHAPE`]), and whether every request makes it
/// ([`drift_core::Symbol::conditional_calls`]), for the reader's closed lists to
/// decide (`drift_mine::py_guards`). Any other call's arguments are not kept. The
/// standard library's (`json.loads`) are dropped where they are linked.
pub(crate) const SHAPED_CALLS: &[&str] = &[
    "verify_jwt_in_request",
    // What verifies a token and raises where it does not verify, or does not by
    // its options (`jwt.decode(token, options={"verify_signature": False})`).
    "decode",
    "loads",
    "unsign",
    "verify",
    "verify_token",
    "verify_id_token",
    "verify_oauth2_token",
    "verify_firebase_token",
];

/// Maximum member segments kept in a canonical reference (`a.b.c.d`).
const MAX_MEMBER_DEPTH: usize = 4;
/// Most callees kept in a symbol's call order.
const MAX_ORDER: usize = 32;

/// Name of the pseudo-symbol that collects top-level statements.
pub const MODULE_SYMBOL: &str = "(module)";

/// Index used in `args` for keyword arguments (`callee@99:name`): Python passes
/// options by keyword, which has no position.
pub const KWARG_INDEX: u32 = 99;

#[path = "adapters.rs"]
pub(crate) mod adapters;
#[path = "guard_paths.rs"]
pub(crate) mod guard_paths;
#[path = "held.rs"]
pub(crate) mod held;
#[path = "outgoing.rs"]
pub(crate) mod outgoing;
#[path = "practice.rs"]
pub(crate) mod practice;
#[path = "receivers.rs"]
pub(crate) mod receivers;
#[path = "registries.rs"]
pub(crate) mod registries;
#[path = "settings.rs"]
pub(crate) mod settings;
#[path = "signals.rs"]
pub(crate) mod signals;
#[path = "verdict.rs"]
pub(crate) mod verdict;

/// [`lower_file`] on a stack that covers `text` ([`drift_core::stack::with_stack_for`]).
/// Every parse of repository content goes through this.
pub fn lower_on_stack(
    rel_path: &str,
    text: &str,
) -> Result<RawFile, drift_core::stack::Unavailable> {
    drift_core::stack::with_stack_for(text.len(), || lower_file(rel_path, text))
}

/// Lower `text` into raw facts. The path is not used: output must depend only on the
/// text, because it is cached by content hash. Recurses once per nesting level: the
/// caller's stack must cover `text` (see [`lower_on_stack`]).
pub fn lower_file(_rel_path: &str, text: &str) -> RawFile {
    let parsed = parse_unchecked_source(text, PySourceType::Python);
    let module = parsed.syntax();
    let mut l = Lowerer::new(text);
    l.out.parse_ok = parsed.errors().is_empty();
    l.collect_bindings(&module.body, Ctx::default());
    l.collect_env_tables(&module.body);
    let mut finder = ImportFinder {
        found: BTreeMap::new(),
        depth: 0,
    };
    for s in &module.body {
        finder.visit_stmt(s);
    }
    let found = std::mem::take(&mut finder.found);
    l.out.imports = found
        .into_iter()
        .map(|((spec, from, type_only), names)| RawImport {
            spec,
            names: names.into_iter().collect(),
            type_only,
            from,
        })
        .collect();
    l.collect_module_lists(&module.body);
    l.lower_body(&module.body);
    l.lower_adapters_anywhere(&module.body);
    l.lower_settings(&module.body);
    l.lower_error_handlers(&module.body);
    l.lower_main_guard(&module.body);
    l.lower_tests(&module.body);
    {
        let mut sent = outgoing::OutgoingFinder::new(&l, text);
        for s in &module.body {
            ruff_python_ast::visitor::Visitor::visit_stmt(&mut sent, s);
        }
        l.out.outgoing = sent.found;
    }
    let mut lists = registries::ListFinder::new(&l);
    lists.module(&module.body);
    let (lists, discovers) = lists.finish();
    l.out.lists = lists;
    l.out.discovers = discovers;

    // Suppressions: `# drift-ignore D-abc123: reason` in the comment block directly above.
    let mut comments: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    let mut comment_lines = BTreeSet::new();
    for t in parsed.tokens().iter() {
        if t.kind() != ruff_python_ast::token::TokenKind::Comment {
            continue;
        }
        let line = l.line_of(t.range().start().to_u32());
        // Only comments alone on their line form a block above a declaration.
        let start = l.line_start(line, text);
        let before = &text[start..t.range().start().to_usize()];
        if !before.trim().is_empty() {
            continue;
        }
        comment_lines.insert(line);
        let body = text[t.range()].trim_start_matches('#').trim();
        if let Some(id) = suppression_id(body) {
            comments.entry(line).or_default().push(id);
        }
    }
    let mut out = l.finish();
    for sym in &mut out.symbols {
        let mut line = sym.line.saturating_sub(1);
        while line > 0 && comment_lines.contains(&line) {
            if let Some(ids) = comments.get(&line) {
                sym.suppressions.extend(ids.iter().cloned());
            }
            line -= 1;
        }
        sym.suppressions.sort();
        sym.suppressions.dedup();
    }
    out
}

/// `drift-ignore D-abc123: reason` -> `D-abc123` (a reason is required).
fn suppression_id(comment: &str) -> Option<String> {
    let rest = comment.strip_prefix("drift-ignore ")?;
    let (id, reason) = rest.split_once(':')?;
    let id = id.trim();
    let valid =
        id.len() == 8 && id.starts_with("D-") && id[2..].bytes().all(|b| b.is_ascii_hexdigit());
    (valid && !reason.trim().is_empty()).then(|| id.to_string())
}

/// Statement context while collecting module-level bindings.
#[derive(Debug, Clone, Copy, Default)]
struct Ctx {
    /// Inside `if TYPE_CHECKING:`.
    type_only: bool,
    /// A fallback branch (`except`, `else` of an `if`): never overrides an earlier binding.
    fallback: bool,
}

pub(crate) struct Lowerer<'t> {
    lines: LineIndex,
    /// The expressions a read mount took as its target (by address): not references
    /// that hand a router on elsewhere ([`RawFile::router_uses`]).
    pub(crate) read_targets: BTreeSet<usize>,
    /// The `Mount(path, app=...)` calls of the route tables that were read (by
    /// address), each with the application the table is of, its full prefix there
    /// and the middleware on the way ([`RawMount::table`]).
    pub(crate) table_mounts: HashMap<usize, RawTableMount>,
    /// The module's `urlpatterns`, or a part of it, is not a list Drift reads (a
    /// comprehension, a subscript): which views it routes is not read.
    pub(crate) unread_urlpatterns: bool,
    /// Registration calls whose view is not written at the call (a loop variable, a
    /// table entry, arguments spread into the call): the router and the adapter of
    /// each ([`Lowerer::lower_adapters_anywhere`]).
    pub(crate) unplaced: BTreeSet<(Option<RawRef>, &'static str)>,
    /// The expressions a read registration took as its view (by address): not names
    /// a registration that is not read may be handed.
    pub(crate) placed_views: BTreeSet<usize>,
    /// The calls made under a branch, in a loop or in a `try` (by address).
    pub(crate) branched: BTreeSet<usize>,
    /// Module-level name -> binding.
    pub(crate) bindings: BTreeMap<String, RawBinding>,
    /// Names of module-level `def`s (functions that can be wrapped).
    pub(crate) functions: BTreeSet<String>,
    /// The module-level `def`s by name, the first of each
    /// ([`verdict::of_test`] reads the test a decorator is given).
    defs: HashMap<String, &'t ast::StmtFunctionDef>,
    /// Names bound inside `if TYPE_CHECKING:` only.
    type_only_names: BTreeSet<String>,
    /// Names an import bound that the module then binds again, with what the
    /// import was ([`Lowerer::bind`]).
    pub(crate) rebound_imports: BTreeMap<String, RawBase>,
    /// `__all__` literal names, and whether it was fully static.
    all: Option<(Vec<String>, bool)>,
    /// Module-level list/tuple assignments (`api_patterns = [path(...), ...]`).
    pub(crate) lists: HashMap<String, &'t [Expr]>,
    /// Module-level names bound once, to a dict written in place (`PROTECTED =
    /// {"dependencies": [...]}`).
    pub(crate) dicts: HashMap<String, &'t ast::ExprDict>,
    pub(crate) out: RawFile,
    module_sym: Option<RawSymbol>,
    /// Names of module-level symbols already emitted (first definition wins).
    emitted: BTreeSet<String>,
    /// While a route handler nested in a FastAPI app factory is lowered
    /// ([`Lowerer::lower_factory_routes`]): the factory and its local apps and routers.
    pub(crate) factory: Option<(String, BTreeSet<String>)>,
    /// Module string constants, dicts of them and one-line env helpers, for env reads
    /// through them ([`Lowerer::collect_env_tables`]).
    pub(crate) env_strings: BTreeMap<String, String>,
    pub(crate) env_dicts: BTreeMap<String, BTreeMap<String, String>>,
    pub(crate) env_helpers: BTreeMap<String, usize>,
    /// Module-level names bound to an env read (`API_KEY = os.environ["API_KEY"]`).
    pub(crate) env_names: BTreeSet<String>,
    /// Module-level names bound to a logger derived with bound fields
    /// (`log = structlog.get_logger().bind(service="x")`).
    pub(crate) bound_loggers: BTreeSet<String>,
    /// While a class's methods are lowered: the class of each `self.<attr>` that
    /// `__init__` binds from a typed parameter or a constructor call, so
    /// `self.repo.find()` is a call of that class's method.
    pub(crate) self_types: HashMap<String, RawRef>,
    /// While a class's methods are lowered: the class and the methods its body
    /// defines, so a `self.m()` it does not define is recorded as a base's
    /// ([`receivers`]).
    pub(crate) self_class: Option<String>,
    pub(crate) self_methods: BTreeSet<String>,
    /// The bases of the class being lowered, as written: what `super()` stands for.
    pub(crate) self_bases: Vec<RawRef>,
    /// What [`Lowerer::self_types`] held for the class just lowered
    /// ([`drift_core::Symbol::attr_types`]).
    pub(crate) attr_types: Vec<(String, RawRef)>,
    /// The parameter of `__init__` each attribute of `self` is bound from
    /// ([`drift_core::controls::ATTR_PARAM`]), of the class being lowered.
    pub(crate) attr_params: Vec<(String, String, u32)>,
}

fn is_constant_name(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_uppercase())
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// String value of a literal (plain strings and f-strings without interpolation).
pub(crate) fn string_value(e: &Expr) -> Option<String> {
    match e {
        Expr::StringLiteral(s) => Some(s.value.to_str().to_string()),
        Expr::FString(f) => {
            let mut out = String::new();
            for part in f.value.iter() {
                match part {
                    ast::FStringPartRef::Literal(l) => out.push_str(&l.value),
                    ast::FStringPartRef::FString(fs) => {
                        for el in &fs.elements {
                            match el {
                                ast::InterpolatedStringElement::Literal(l) => {
                                    out.push_str(&l.value)
                                }
                                ast::InterpolatedStringElement::Interpolation(_) => {
                                    return None;
                                }
                            }
                        }
                    }
                }
            }
            Some(out)
        }
        _ => None,
    }
}

/// Elements of a list, tuple or set literal.
pub(crate) fn elements(e: &Expr) -> Option<&[Expr]> {
    match e {
        Expr::List(l) => Some(&l.elts),
        Expr::Tuple(t) => Some(&t.elts),
        Expr::Set(s) => Some(&s.elts),
        _ => None,
    }
}

pub(crate) fn keyword<'e>(call: &'e ast::ExprCall, name: &str) -> Option<&'e Expr> {
    call.arguments
        .keywords
        .iter()
        .find(|k| k.arg.as_ref().is_some_and(|a| a.as_str() == name))
        .map(|k| &k.value)
}

/// Positional argument `i`, or keyword `name`.
pub(crate) fn arg<'e>(call: &'e ast::ExprCall, i: usize, name: &str) -> Option<&'e Expr> {
    call.arguments
        .args
        .get(i)
        .filter(|a| !a.is_starred_expr())
        .or_else(|| keyword(call, name))
}

/// Names bound by an assignment target (`a`, `a, b`, `[a, *b]`).
fn target_names<'e>(e: &'e Expr, out: &mut Vec<&'e str>) {
    match e {
        Expr::Name(n) => out.push(n.id.as_str()),
        Expr::Tuple(t) => t.elts.iter().for_each(|x| target_names(x, out)),
        Expr::List(l) => l.elts.iter().for_each(|x| target_names(x, out)),
        Expr::Starred(s) => target_names(&s.value, out),
        _ => {}
    }
}

/// A class base that no reference stands for (`class X(*BASES)`), also added to a
/// class defined again with other bases: it is no class of the repo, so the class's
/// ancestry is unknown.
pub(crate) fn unknown_base() -> RawRef {
    RawRef {
        base: RawBase::Global(drift_core::UNKNOWN_BASE_NAME.into()),
        member: String::new(),
    }
}

/// Names a class-body statement binds in the class scope, as [`bind_stmt`] finds them:
/// assignments, methods and nested classes, also inside `if`/`try`/`with`/`for`/`match`
/// blocks, `with ... as` and `for` targets, imports and walrus targets. An annotation
/// without a value counts: in a pydantic model or a dataclass it redeclares the field.
fn class_stmt_names(s: &Stmt) -> Vec<String> {
    let mut scope = Scope {
        class: true,
        ..Scope::default()
    };
    let mut globals = BTreeSet::new();
    bind_stmt(s, &mut scope, &mut globals);
    let mut w = WalrusFinder { names: vec![] };
    w.visit_stmt(s);
    let mut out: Vec<String> = scope
        .names
        .into_keys()
        .chain(w.names)
        .filter(|n| !globals.contains(n))
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The body without a leading docstring.
fn without_docstring(body: &[Stmt]) -> &[Stmt] {
    match body.first() {
        Some(Stmt::Expr(e)) if e.value.is_string_literal_expr() => &body[1..],
        _ => body,
    }
}

/// The function files its first parameter in a registry and hands it back unchanged
/// ([`drift_core::controls::REGISTERS_ARG`]): undecorated and not async, its body
/// (past the docstring) is assignments and registry appends, then `return <param>`;
/// at least one statement stores the parameter itself (`registry[key] = cls`,
/// `registry.append(cls)`, `registry.add(cls)`), and the parameter is otherwise only
/// read through an attribute (`cls.model`, `cls._meta.model`). Nothing assigns to the
/// parameter or its attributes, calls a method on it or passes it anywhere else, and
/// there is no nested function, class, branch or loop: a decorator that changes the
/// class (`cls.login_required = True`, `setattr(cls, ...)`) or wraps it is no registry.
fn registers_arg(f: &ast::StmtFunctionDef) -> bool {
    if !f.decorator_list.is_empty() || f.is_async {
        return false;
    }
    let p = &f.parameters;
    let Some(first) = p.posonlyargs.iter().chain(&p.args).next() else {
        return false;
    };
    let name = first.parameter.name.as_str();
    let Some((Stmt::Return(ret), rest)) = without_docstring(&f.body).split_last() else {
        return false;
    };
    if !ret.value.as_deref().is_some_and(|v| is_name(v, name)) {
        return false;
    }
    let mut stored = false;
    for s in rest {
        match s {
            Stmt::Assign(a) => {
                let value_is_param = is_name(&a.value, name);
                for t in &a.targets {
                    match t {
                        Expr::Name(n) if n.id.as_str() != name && !value_is_param => {}
                        Expr::Subscript(sub)
                            if only_reads(&sub.value, name) && only_reads(&sub.slice, name) => {}
                        _ => return false,
                    }
                }
                if value_is_param {
                    stored = true;
                } else if !only_reads(&a.value, name) {
                    return false;
                }
            }
            Stmt::Expr(e) => {
                let Expr::Call(c) = e.value.as_ref() else {
                    return false;
                };
                let Expr::Attribute(at) = c.func.as_ref() else {
                    return false;
                };
                if !matches!(at.attr.as_str(), "append" | "add")
                    || !only_reads(&at.value, name)
                    || !c.arguments.keywords.is_empty()
                {
                    return false;
                }
                match &c.arguments.args[..] {
                    [x] if is_name(x, name) => stored = true,
                    _ => return false,
                }
            }
            _ => return false,
        }
    }
    stored
}

fn is_name(e: &Expr, name: &str) -> bool {
    matches!(e, Expr::Name(n) if n.id.as_str() == name)
}

/// `e` uses `name` only to read an attribute of it (`cls.model`): never the bare name,
/// a method call on it, or inside a lambda.
fn only_reads(e: &Expr, name: &str) -> bool {
    struct Uses<'n> {
        name: &'n str,
        other: bool,
    }
    impl<'a> Visitor<'a> for Uses<'_> {
        fn visit_expr(&mut self, e: &'a Expr) {
            match e {
                Expr::Lambda(_) => self.other = true,
                // A method call on it (`cls.label()`) may change it.
                Expr::Call(c) if method_of(&c.func, self.name) => self.other = true,
                Expr::Attribute(a) if is_name(&a.value, self.name) => {}
                Expr::Name(n) if n.id.as_str() == self.name => self.other = true,
                _ => visitor::walk_expr(self, e),
            }
        }
    }
    let mut u = Uses { name, other: false };
    u.visit_expr(e);
    !u.other
}

/// `func` is an attribute of `name` (`cls.label` in `cls.label()`).
fn method_of(func: &Expr, name: &str) -> bool {
    matches!(func, Expr::Attribute(a) if is_name(&a.value, name))
}

fn is_type_checking(test: &Expr) -> bool {
    match test {
        Expr::Name(n) => n.id.as_str() == "TYPE_CHECKING",
        Expr::Attribute(a) => a.attr.as_str() == "TYPE_CHECKING",
        _ => false,
    }
}

impl<'t> Lowerer<'t> {
    fn new(text: &'t str) -> Self {
        Self {
            lines: LineIndex::from_source_text(text),
            bindings: BTreeMap::new(),
            functions: BTreeSet::new(),
            defs: HashMap::new(),
            type_only_names: BTreeSet::new(),
            rebound_imports: BTreeMap::new(),
            all: None,
            lists: HashMap::new(),
            dicts: HashMap::new(),
            read_targets: BTreeSet::new(),
            table_mounts: HashMap::new(),
            unread_urlpatterns: false,
            unplaced: BTreeSet::new(),
            placed_views: BTreeSet::new(),
            branched: BTreeSet::new(),
            out: RawFile::default(),
            module_sym: None,
            emitted: BTreeSet::new(),
            factory: None,
            env_strings: BTreeMap::new(),
            env_dicts: BTreeMap::new(),
            env_helpers: BTreeMap::new(),
            env_names: BTreeSet::new(),
            bound_loggers: BTreeSet::new(),
            self_types: HashMap::new(),
            self_class: None,
            self_methods: BTreeSet::new(),
            self_bases: Vec::new(),
            attr_types: Vec::new(),
            attr_params: Vec::new(),
        }
    }

    /// 1-based line of a byte offset (`\n`, `\r\n` and a lone `\r` all end a line).
    pub(crate) fn line_of(&self, offset: u32) -> u32 {
        u32::try_from(self.lines.line_index(TextSize::new(offset)).get()).unwrap_or(u32::MAX)
    }

    /// Byte offset where 1-based `line` starts.
    fn line_start(&self, line: u32, text: &str) -> usize {
        self.lines
            .line_start(
                OneIndexed::new(line as usize).unwrap_or(OneIndexed::MIN),
                text,
            )
            .to_usize()
    }

    pub(crate) fn line(&self, node: &impl Ranged) -> u32 {
        self.line_of(node.range().start().to_u32())
    }

    fn finish(mut self) -> RawFile {
        if let Some(m) = self.module_sym.take()
            && !(m.calls.is_empty() && m.sinks.is_empty() && m.reads.is_empty())
        {
            self.out.symbols.push(m);
        }
        for s in &mut self.out.symbols {
            s.calls.sort();
            s.calls.dedup();
            s.args.sort();
            s.args.dedup();
            s.omits.sort();
            s.omits.dedup();
            s.declares.sort();
            s.declares.dedup();
            s.controls.sort();
            s.controls.dedup();
            s.reads.sort();
            s.reads.dedup();
            s.throws.sort();
            s.throws.dedup();
            s.sinks.sort();
            s.sinks.dedup();
            s.since_sinks.sort();
            s.since_sinks.dedup();
            let read = s.sinks.clone();
            s.since_sinks.retain(|k| !read.contains(k));
            for m in &mut s.members {
                m.since_sinks.sort();
                m.since_sinks.dedup();
                let read = m.sinks.clone();
                m.since_sinks.retain(|k| !read.contains(k));
            }
            s.methods.sort();
            s.methods.dedup();
            s.body_checks.sort();
            s.body_checks.dedup();
            s.raise_checks.sort();
            s.raise_checks.dedup();
            s.check_sides.sort();
            s.check_sides.dedup();
            s.filter_values.sort();
            s.filter_values.dedup();
            s.arg_sides.sort();
            s.arg_sides.dedup();
            s.responses.sort();
            s.responses.dedup();
            s.log_calls.sort();
            s.log_calls.dedup();
            s.catches.sort();
            s.catches.dedup();
            s.headers.sort();
            s.headers.dedup();
            s.inputs.sort();
            s.inputs.dedup();
            s.scoped.sort();
            s.scoped.dedup();
            s.handles.sort();
            s.handles.dedup();
        }
        self.out.symbols.sort();
        self.out.bindings = std::mem::take(&mut self.bindings).into_iter().collect();
        self.out.all = self.all.take().and_then(|(names, complete)| {
            complete.then(|| {
                let mut n = names;
                n.sort();
                n.dedup();
                n
            })
        });
        self.out.dep_aliases.sort();
        self.out.alias_types.sort();
        self.out.alias_types.dedup_by(|a, b| a.0 == b.0);
        self.out.routes.sort();
        self.out.routers.sort();
        // One of a name is kept, as the measured build kept it; the others beside it.
        let mut rebound = Vec::new();
        self.out.routers.dedup_by(|a, b| {
            let same = a.name == b.name;
            if same {
                rebound.push(a.clone());
            }
            same
        });
        self.out.routers_rebound = rebound;
        self.out.mounts.sort();
        self.out.mounts.dedup();
        self.out.registrations.sort();
        self.out.registrations.dedup();
        self.out.hooks.sort();
        self.out.hooks.dedup();
        self.out.entry_points.sort();
        self.out.entry_points.dedup();
        self.out.models.sort();
        self.out
    }

    // ------------------------------------------------------------------ pass 1: bindings

    fn bind(&mut self, name: &str, b: RawBinding, ctx: Ctx) {
        if name.is_empty() {
            return; // a def or class whose name error recovery lost
        }
        // A fallback never replaces a runtime binding, but does replace a type-only one.
        if ctx.fallback && self.bindings.contains_key(name) && !self.type_only_names.contains(name)
        {
            return;
        }
        if ctx.type_only {
            if self.bindings.contains_key(name) {
                return;
            }
            self.type_only_names.insert(name.to_string());
        } else {
            self.type_only_names.remove(name);
        }
        // A name imported and then bound again (`from api import app`, `app =
        // TokenMiddleware(app)`): what it was first.
        if matches!(b, RawBinding::Local)
            && let Some(RawBinding::Import {
                spec, name: from, ..
            }) = self.bindings.get(name)
        {
            self.rebound_imports.insert(
                name.to_string(),
                RawBase::Import {
                    spec: spec.clone(),
                    name: from.clone(),
                },
            );
        }
        self.bindings.insert(name.to_string(), b);
    }

    fn collect_bindings(&mut self, body: &'t [Stmt], ctx: Ctx) {
        for stmt in body {
            match stmt {
                Stmt::FunctionDef(f) => {
                    self.functions.insert(f.name.as_str().to_string());
                    self.defs.entry(f.name.as_str().to_string()).or_insert(f);
                    self.bind(f.name.as_str(), RawBinding::Local, ctx);
                }
                Stmt::ClassDef(c) => self.bind(c.name.as_str(), RawBinding::Local, ctx),
                Stmt::Assign(a) => {
                    let mut names = Vec::new();
                    for t in &a.targets {
                        target_names(t, &mut names);
                    }
                    for n in names {
                        if n == "__all__" {
                            self.set_all(&a.value, false);
                        }
                        self.bind(n, RawBinding::Local, ctx);
                    }
                }
                Stmt::AnnAssign(a) if a.value.is_some() => {
                    if let Expr::Name(n) = a.target.as_ref() {
                        if n.id.as_str() == "__all__"
                            && let Some(v) = &a.value
                        {
                            self.set_all(v, false);
                        }
                        self.bind(n.id.as_str(), RawBinding::Local, ctx);
                    }
                }
                Stmt::AugAssign(a) => {
                    if let Expr::Name(n) = a.target.as_ref() {
                        if n.id.as_str() == "__all__" {
                            self.set_all(&a.value, true);
                        } else if !self.bindings.contains_key(n.id.as_str()) {
                            self.bind(n.id.as_str(), RawBinding::Local, ctx);
                        }
                    }
                }
                Stmt::TypeAlias(t) => {
                    if let Expr::Name(n) = t.name.as_ref() {
                        self.bind(n.id.as_str(), RawBinding::Local, ctx);
                    }
                }
                Stmt::Import(i) => {
                    for a in &i.names {
                        let full = a.name.as_str();
                        match &a.asname {
                            Some(as_) => self.bind(
                                as_.as_str(),
                                RawBinding::Import {
                                    spec: full.to_string(),
                                    name: "*".into(),
                                    explicit: as_.as_str() == full,
                                },
                                ctx,
                            ),
                            None => {
                                let top = full.split('.').next().unwrap_or(full);
                                self.bind(
                                    top,
                                    RawBinding::Import {
                                        spec: top.to_string(),
                                        name: "*".into(),
                                        explicit: false,
                                    },
                                    ctx,
                                );
                            }
                        }
                    }
                }
                Stmt::ImportFrom(i) => {
                    let spec = from_spec(i);
                    for a in &i.names {
                        let name = a.name.as_str();
                        if name == "*" {
                            if !self.out.star_imports.contains(&spec) {
                                self.out.star_imports.push(spec.clone());
                            }
                            continue;
                        }
                        let local = a.asname.as_ref().map_or(name, |x| x.as_str());
                        self.bind(
                            local,
                            RawBinding::Import {
                                spec: spec.clone(),
                                name: name.to_string(),
                                explicit: a.asname.as_ref().is_some_and(|x| x.as_str() == name),
                            },
                            ctx,
                        );
                    }
                }
                Stmt::If(i) => {
                    if is_type_checking(&i.test) {
                        self.collect_bindings(
                            &i.body,
                            Ctx {
                                type_only: true,
                                ..ctx
                            },
                        );
                        // `else:` is what runs: its bindings replace the type-only ones.
                        for c in &i.elif_else_clauses {
                            self.collect_bindings(&c.body, ctx);
                        }
                    } else {
                        self.collect_bindings(&i.body, ctx);
                        for c in &i.elif_else_clauses {
                            self.collect_bindings(
                                &c.body,
                                Ctx {
                                    fallback: true,
                                    ..ctx
                                },
                            );
                        }
                    }
                }
                Stmt::Try(t) => {
                    self.collect_bindings(&t.body, ctx);
                    for h in &t.handlers {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        self.collect_bindings(
                            &h.body,
                            Ctx {
                                fallback: true,
                                ..ctx
                            },
                        );
                    }
                    self.collect_bindings(&t.orelse, ctx);
                    self.collect_bindings(&t.finalbody, ctx);
                }
                Stmt::With(w) => self.collect_bindings(&w.body, ctx),
                Stmt::For(f) => {
                    let mut names = Vec::new();
                    target_names(&f.target, &mut names);
                    for n in names {
                        self.bind(
                            n,
                            RawBinding::Local,
                            Ctx {
                                fallback: true,
                                ..ctx
                            },
                        );
                    }
                    self.collect_bindings(
                        &f.body,
                        Ctx {
                            fallback: true,
                            ..ctx
                        },
                    );
                }
                Stmt::Expr(e) => {
                    // `__all__.extend([...])` / `__all__.append("x")`
                    if let Expr::Call(c) = e.value.as_ref()
                        && let Expr::Attribute(a) = c.func.as_ref()
                        && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "__all__")
                    {
                        match (a.attr.as_str(), c.arguments.args.first()) {
                            ("extend", Some(v)) => self.set_all(v, true),
                            ("append", Some(v)) => match string_value(v) {
                                Some(s) => {
                                    if let Some((names, _)) = &mut self.all {
                                        names.push(s);
                                    }
                                }
                                None => {
                                    if let Some((_, complete)) = &mut self.all {
                                        *complete = false;
                                    }
                                }
                            },
                            _ => {
                                if let Some((_, complete)) = &mut self.all {
                                    *complete = false;
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Record `__all__ = [...]` (or `+=`/`extend` when `extend`).
    fn set_all(&mut self, value: &Expr, extend: bool) {
        let mut names = Vec::new();
        let mut complete = true;
        let mut parts = vec![value];
        while let Some(e) = parts.pop() {
            match e {
                Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
                    parts.push(&b.left);
                    parts.push(&b.right);
                }
                e => match elements(e) {
                    Some(els) => {
                        for x in els {
                            match string_value(x) {
                                Some(s) => names.push(s),
                                None => complete = false,
                            }
                        }
                    }
                    None => complete = false,
                },
            }
        }
        match (&mut self.all, extend) {
            (Some((existing, c)), true) => {
                existing.extend(names);
                *c &= complete;
            }
            _ => self.all = Some((names, complete)),
        }
    }

    /// Module-level list assignments, for Django `include(local_patterns)`.
    fn collect_module_lists(&mut self, body: &'t [Stmt]) {
        let mut bound: BTreeMap<&str, usize> = BTreeMap::new();
        for stmt in body {
            if let Stmt::Assign(a) = stmt {
                let mut names = Vec::new();
                for t in &a.targets {
                    target_names(t, &mut names);
                }
                for n in names {
                    *bound.entry(n).or_default() += 1;
                }
                if let [Expr::Name(n)] = a.targets.as_slice()
                    && let Expr::Dict(d) = a.value.as_ref()
                {
                    self.dicts.insert(n.id.as_str().to_string(), d);
                }
            }
        }
        self.dicts
            .retain(|n, _| bound.get(n.as_str()).copied() == Some(1));
        for stmt in body {
            if let Stmt::Assign(a) = stmt
                && let [Expr::Name(n)] = a.targets.as_slice()
                && let Some(els) = elements(&a.value)
            {
                self.lists.insert(n.id.as_str().to_string(), els);
            }
        }
    }

    // ------------------------------------------------------------------ references

    /// Module-level resolution of a name (no local scopes).
    pub(crate) fn module_base(&self, name: &str) -> RawBase {
        match self.bindings.get(name) {
            Some(RawBinding::Local) => RawBase::Local(name.to_string()),
            Some(RawBinding::Import { spec, name, .. }) => RawBase::Import {
                spec: spec.clone(),
                name: name.clone(),
            },
            None if stdlib::is_builtin(name) || self.out.star_imports.is_empty() => {
                RawBase::Global(name.to_string())
            }
            None => RawBase::Star(name.to_string()),
        }
    }

    /// Reference for an expression at module level (decorators, base classes, router calls).
    pub(crate) fn canon(&self, e: &Expr) -> Option<RawRef> {
        canon_with(e, &|n| Some(self.module_base(n)))
    }

    // ------------------------------------------------------------------ pass 2: symbols

    fn lower_body(&mut self, body: &'t [Stmt]) {
        for stmt in body {
            self.lower_statement(stmt);
        }
        self.reassigned_permissions(body);
    }

    /// `<Class>.permission_classes = ...` written after the class
    /// ([`RawSymbol::drf_reassigned`]): the last assignment the module makes wins
    /// where each is a statement of the module itself; one under a branch, in a
    /// loop or a function, or an augmented one, is not ordered.
    fn reassigned_permissions(&mut self, body: &'t [Stmt]) {
        struct Found<'a> {
            depth: usize,
            /// (class, the value where the assignment is a plain module statement)
            hits: Vec<(&'a str, Option<&'a Expr>)>,
        }
        impl<'a> Found<'a> {
            fn target(&mut self, t: &'a Expr, value: Option<&'a Expr>) {
                if let Expr::Attribute(a) = t
                    && a.attr.as_str() == "permission_classes"
                    && let Expr::Name(n) = a.value.as_ref()
                {
                    let ordered = self.depth == 0;
                    self.hits.push((n.id.as_str(), value.filter(|_| ordered)));
                }
            }
        }
        impl<'a> Visitor<'a> for Found<'a> {
            fn visit_stmt(&mut self, s: &'a Stmt) {
                match s {
                    Stmt::Assign(a) => {
                        let single = a.targets.len() == 1;
                        for t in &a.targets {
                            self.target(t, single.then_some(&*a.value));
                        }
                    }
                    Stmt::AugAssign(a) => self.target(&a.target, None),
                    Stmt::AnnAssign(a) => self.target(&a.target, None),
                    _ => {
                        self.depth += 1;
                        visitor::walk_stmt(self, s);
                        self.depth -= 1;
                    }
                }
            }
            fn visit_expr(&mut self, _: &'a Expr) {}
        }
        let mut found = Found {
            depth: 0,
            hits: Vec::new(),
        };
        for s in body {
            found.visit_stmt(s);
        }
        let mut last: BTreeMap<&str, Option<&Expr>> = BTreeMap::new();
        for (class, value) in found.hits {
            let e = last.entry(class).or_insert(value);
            // One that is not ordered leaves the class's permissions unread.
            *e = match (*e, value) {
                (Some(_), Some(v)) => Some(v),
                _ => None,
            };
        }
        for (class, value) in last {
            let read = value.map(|v| (self.class_list(Some(v)), self.classes_unread(Some(v))));
            let Some(sym) = self
                .out
                .symbols
                .iter_mut()
                .find(|s| s.name == class && s.kind == SymbolKind::Class)
            else {
                continue;
            };
            sym.drf_reassigned = Some(match read {
                Some((classes, None)) => Reassigned {
                    classes: Some(classes),
                    unread: None,
                },
                Some((_, Some(words))) => Reassigned {
                    classes: Some(vec![]),
                    unread: Some(words),
                },
                None => Reassigned {
                    classes: Some(vec![]),
                    unread: Some(format!(
                        "{class}.permission_classes, assigned where it is not ordered"
                    )),
                },
            });
        }
    }

    /// A module-level symbol of this name was already emitted.
    pub(crate) fn has_symbol(&self, name: &str) -> bool {
        self.emitted.contains(name)
    }

    pub(crate) fn push_symbol(&mut self, s: RawSymbol) {
        if s.name.starts_with("__") && s.name.ends_with("__") {
            return; // `__all__`, `__version__`: module metadata, not symbols
        }
        // Error recovery can leave a def or class without a name (`class {{ x }}:` in a
        // template); `(module)` is the one pseudo-symbol.
        let valid = s.name == MODULE_SYMBOL
            || s.name.split('.').all(|part| {
                !part.is_empty()
                    && !part.starts_with(|c: char| c.is_ascii_digit())
                    && part.chars().all(|c| c.is_alphanumeric() || c == '_')
            });
        if !valid {
            return;
        }
        if self.emitted.insert(s.name.clone()) {
            self.out.symbols.push(s);
        } else if s.kind != SymbolKind::Class
            && let Some(first) = self.out.symbols.iter_mut().find(|x| x.name == s.name)
        {
            // A name bound again: the first definition is the one kept, and what
            // the name holds where it is used is not read ([`RawSymbol::values`]).
            first.values.extend(s.values);
            first.values.push((None, String::new()));
        } else if s.kind == SymbolKind::Class
            && let Some(first) = self
                .out
                .symbols
                .iter_mut()
                .find(|x| x.name == s.name && x.kind == SymbolKind::Class)
        {
            // `if ...: class Schema: ... else: class Schema(BaseModel): ...`: only the first
            // definition is kept, so when the others extend something else, what the
            // class extends at runtime is unknown.
            let bases = |x: &RawSymbol| -> Vec<RawRef> {
                x.wraps
                    .iter()
                    .filter(|(_, k)| *k == WrapKind::Extends)
                    .map(|(r, _)| r.clone())
                    .collect()
            };
            let unknown = (unknown_base(), WrapKind::Extends);
            if bases(first) != bases(&s) && !first.wraps.contains(&unknown) {
                first.wraps.push(unknown);
            }
        }
    }

    fn lower_statement(&mut self, stmt: &'t Stmt) {
        match stmt {
            Stmt::FunctionDef(f) => {
                let sym = self.lower_function(f);
                self.push_symbol(sym);
                self.lower_factory_routes(f);
            }
            Stmt::ClassDef(c) => self.lower_class(c),
            Stmt::Assign(a) => {
                let mut names = Vec::new();
                for t in &a.targets {
                    target_names(t, &mut names);
                }
                let only_names = a
                    .targets
                    .iter()
                    .all(|t| matches!(t, Expr::Name(_) | Expr::Tuple(_) | Expr::List(_)));
                if names.is_empty() || !only_names {
                    // `app.config["X"] = ...`, `os.environ["X"] = ...`
                    self.module_statement(stmt);
                    return;
                }
                for name in names {
                    self.lower_assignment(name, &a.value, stmt);
                }
            }
            Stmt::AnnAssign(a) => match (a.target.as_ref(), &a.value) {
                (Expr::Name(n), Some(v)) => {
                    let is_alias = matches!(a.annotation.as_ref(), Expr::Name(x) if x.id.as_str() == "TypeAlias")
                        || matches!(a.annotation.as_ref(), Expr::Attribute(x) if x.attr.as_str() == "TypeAlias");
                    if is_alias {
                        self.record_dep_alias(n.id.as_str(), v);
                    }
                    self.lower_assignment(n.id.as_str(), v, stmt);
                }
                (Expr::Name(_), None) => {}
                _ => self.module_statement(stmt),
            },
            Stmt::TypeAlias(t) => {
                if let Expr::Name(n) = t.name.as_ref() {
                    self.record_dep_alias(n.id.as_str(), &t.value);
                    let mut sym = RawSymbol::empty(n.id.as_str(), SymbolKind::Const, self.line(t));
                    let mut c = Collector::new(self, true);
                    c.annotation(&t.value);
                    c.fill(&mut sym);
                    self.push_symbol(sym);
                }
            }
            Stmt::AugAssign(a) => {
                if let Expr::Name(n) = a.target.as_ref()
                    && n.id.as_str() == "urlpatterns"
                {
                    self.lower_urlpatterns(&a.value, "");
                }
                self.module_statement(stmt);
            }
            Stmt::If(i) => {
                // `if TYPE_CHECKING:` bodies are types only; their `else` runs.
                if !is_type_checking(&i.test) {
                    self.module_expr(&i.test, stmt);
                    self.lower_body(&i.body);
                }
                for c in &i.elif_else_clauses {
                    if let Some(t) = &c.test {
                        self.module_expr(t, stmt);
                    }
                    self.lower_body(&c.body);
                }
            }
            Stmt::Try(t) => {
                self.lower_body(&t.body);
                for h in &t.handlers {
                    let ast::ExceptHandler::ExceptHandler(h) = h;
                    self.lower_body(&h.body);
                }
                self.lower_body(&t.orelse);
                self.lower_body(&t.finalbody);
            }
            Stmt::With(w) => {
                for item in &w.items {
                    self.module_expr(&item.context_expr, stmt);
                }
                self.lower_body(&w.body);
            }
            Stmt::Import(_) | Stmt::ImportFrom(_) | Stmt::Pass(_) => {}
            Stmt::Expr(e) => {
                if let Expr::Call(c) = e.value.as_ref()
                    && let Expr::Attribute(a) = c.func.as_ref()
                    && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "urlpatterns")
                    && matches!(a.attr.as_str(), "append" | "extend")
                {
                    for x in &c.arguments.args {
                        match elements(x) {
                            Some(_) => self.lower_urlpatterns(x, ""),
                            None => self.lower_url_entry(x, ""),
                        }
                    }
                }
                self.module_statement(stmt);
            }
            _ => self.module_statement(stmt),
        }
    }

    /// Feed a top-level statement into the module pseudo-symbol.
    fn module_statement(&mut self, stmt: &'t Stmt) {
        let mut part = RawSymbol::empty(MODULE_SYMBOL, SymbolKind::Module, self.line(stmt));
        let mut c = Collector::new(self, false);
        c.visit_stmt(stmt);
        c.fill(&mut part);
        self.merge_module(part);
    }

    fn module_expr(&mut self, e: &'t Expr, at: &Stmt) {
        let mut part = RawSymbol::empty(MODULE_SYMBOL, SymbolKind::Module, self.line(at));
        let mut c = Collector::new(self, false);
        c.visit_expr(e);
        c.fill(&mut part);
        self.merge_module(part);
    }

    fn merge_module(&mut self, part: RawSymbol) {
        let m = self
            .module_sym
            .get_or_insert_with(|| RawSymbol::empty(MODULE_SYMBOL, SymbolKind::Module, part.line));
        // After the continuation only in every part that meets it.
        let met_before = |s: &RawSymbol| -> BTreeSet<RawRef> {
            s.calls
                .iter()
                .chain(&s.throws)
                .filter(|r| !s.after_continuation.contains(r))
                .cloned()
                .collect()
        };
        let (m_before, part_before) = (met_before(m), met_before(&part));
        m.after_continuation.retain(|r| !part_before.contains(r));
        for r in part.after_continuation {
            if !m_before.contains(&r) && !m.after_continuation.contains(&r) {
                m.after_continuation.push(r);
            }
        }
        m.calls.extend(part.calls);
        m.args.extend(part.args);
        m.omits.extend(part.omits);
        m.controls.extend(part.controls);
        m.string_literals += part.string_literals;
        m.reads.extend(part.reads);
        m.throws.extend(part.throws);
        m.sinks.extend(part.sinks);
        m.since_sinks.extend(part.since_sinks);
        m.body_checks.extend(part.body_checks);
        m.responses.extend(part.responses);
        m.log_calls.extend(part.log_calls);
        m.catches.extend(part.catches);
        m.headers.extend(part.headers);
        m.inputs.extend(part.inputs);
        m.scoped.extend(part.scoped);
        m.raise_checks.extend(part.raise_checks);
        m.check_sides.extend(part.check_sides);
        m.filter_values.extend(part.filter_values);
        m.arg_sides.extend(part.arg_sides);
        for r in part.order {
            if !m.order.contains(&r) && m.order.len() < MAX_ORDER {
                m.order.push(r);
            }
        }
    }

    /// The dependencies of the function a dependency factory hands back:
    ///
    /// ```python
    /// def auth_dependency():
    ///     async def get_caller(caller=Depends(CallerGate(api_key=KEY))):
    ///         return caller
    ///     return get_caller
    ///
    /// AuthDep = Depends(auth_dependency())
    /// ```
    ///
    /// FastAPI runs what the call returns, so `Depends(auth_dependency())` depends on
    /// what `get_caller`'s parameters do. They are kept as the factory's
    /// [`RawSymbol::call_deps`], the entry the linker reads for a dependency made by a
    /// call (`Depends(x())`), as it does a class's `__call__` for `Depends(Class())`.
    /// Only a function defined in the factory's own body and returned by name counts.
    fn returned_function_deps(&self, body: &[Stmt]) -> Vec<RawDep> {
        let mut out = Vec::new();
        for stmt in body {
            let Stmt::Return(r) = stmt else { continue };
            let Some(Expr::Name(n)) = r.value.as_deref() else {
                continue;
            };
            // The definition in force at the `return`: the last one before it.
            let inner = body.iter().rev().find_map(|s| match s {
                Stmt::FunctionDef(f)
                    if f.name.as_str() == n.id.as_str() && f.range.start() < r.range.start() =>
                {
                    Some(f)
                }
                _ => None,
            });
            if let Some(f) = inner {
                for d in self.parameter_deps(&f.parameters) {
                    if !out.contains(&d) {
                        out.push(d);
                    }
                }
            }
        }
        out
    }

    /// `def f(...)` at module level (or a method): its symbol.
    pub(crate) fn lower_function(&mut self, f: &'t ast::StmtFunctionDef) -> RawSymbol {
        let name = f.name.as_str();
        let mut sym = RawSymbol::empty(name, SymbolKind::Function, self.line(f));
        sym.is_async = f.is_async;
        if f.returns.is_some() {
            sym.controls.push("typed_return".into());
        }
        if registers_arg(f) {
            sym.controls
                .push(drift_core::controls::REGISTERS_ARG.into());
        }
        for (i, d) in f.decorator_list.iter().enumerate() {
            self.lower_decorator(name, d, i as u32, &mut sym);
        }
        sym.deps = self.parameter_deps(&f.parameters);
        sym.call_deps = self.returned_function_deps(&f.body);
        sym.param_uses = adapters::param_uses(f);
        sym.params = adapters::positional_params(&f.parameters, false);
        sym.returns = self.returned_callables(f);
        if self.returns_unread(f) {
            sym.controls
                .push(drift_core::controls::RETURNS_UNREAD.into());
        }
        if hands_back_param(f, 0) == (true, true) {
            sym.controls
                .push(drift_core::controls::HANDS_BACK_PARAM.into());
        }
        self.returns_result_of(&f.body, &mut sym.returns_result_of, 0);
        if self.refusal_not_returned(f) {
            sym.controls
                .push(drift_core::controls::REFUSAL_NOT_RETURNED.into());
        }
        (sym.returns_instance, sym.returns_type) = self.returns_instance(f);
        sym.disclaims = crate::docs::docstring(&f.body)
            .map(|d| crate::docs::disclaims(d, name))
            .unwrap_or_default();
        let mut c = Collector::new(self, false);
        c.function(&f.parameters, &f.body, f.returns.as_deref());
        c.fill(&mut sym);
        let body = without_docstring(&f.body);
        if body.len() == 1 && matches!(body[0], Stmt::Try(_)) {
            sym.wraps.push((
                RawRef {
                    base: RawBase::Global(String::new()),
                    member: String::new(),
                },
                WrapKind::Try,
            ));
        }
        sym
    }

    /// `X = value` at module level.
    fn lower_assignment(&mut self, name: &str, value: &'t Expr, stmt: &'t Stmt) {
        let line = self.line(stmt);
        if name == "urlpatterns" {
            self.lower_urlpatterns(value, "");
        }
        self.lower_router_def(name, value);
        self.record_dep_alias(name, value);
        let kind = if is_constant_name(name) {
            SymbolKind::Const
        } else {
            SymbolKind::Variable
        };
        let mut sym = RawSymbol::empty(name, kind, line);
        // `rule_book = None`: bound later, by code that runs at start-up.
        if matches!(value, Expr::NoneLiteral(_) | Expr::EllipsisLiteral(_)) {
            sym.controls.push(drift_core::controls::LATE_BOUND.into());
        }
        if matches!(name, "CORS_ALLOW_ALL_ORIGINS" | "CORS_ORIGIN_ALLOW_ALL")
            && matches!(value, Expr::BooleanLiteral(b) if b.value)
        {
            sym.sinks.push(signals::kind::CORS.into());
        }
        // The call the value is (`bearer = HTTPBearer(auto_error=False)`,
        // `current = users.current_user(active=True)`), as it is written.
        match value {
            Expr::Call(call)
                if matches!(call.func.as_ref(), Expr::Name(_) | Expr::Attribute(_)) =>
            {
                if let Some(r) = self.canon(&call.func) {
                    sym.values.push((Some(r), adapters::args_shape(call)));
                }
            }
            Expr::Name(_) | Expr::Attribute(_) => {
                if let Some(r) = self.canon(value) {
                    sym.values.push((Some(r), String::new()));
                }
            }
            _ => {}
        }
        let mut c = Collector::new(self, false);
        let mut cur = value;
        // Peel wrapper calls (`handler = login_required(view)`); the callee is a wrap.
        while let Expr::Call(call) = cur {
            let Some(wrapper) = c.canon(&call.func) else {
                break;
            };
            let Some(inner) = call.arguments.args.first() else {
                break;
            };
            if !self.wraps_function(inner, 0) {
                break;
            }
            sym.wraps.push((wrapper.clone(), WrapKind::Call));
            for k in &call.arguments.keywords {
                if let Some(a) = &k.arg {
                    c.args
                        .insert((wrapper.clone(), KWARG_INDEX, a.as_str().to_string()));
                }
                c.visit_expr(&k.value);
            }
            for a in call.arguments.args.iter().skip(1) {
                c.visit_expr(a);
            }
            cur = inner;
        }
        match cur {
            Expr::Lambda(_) => {
                sym.kind = SymbolKind::Function;
                c.visit_expr(cur);
            }
            Expr::Name(n) if !sym.wraps.is_empty() => {
                sym.kind = SymbolKind::Function;
                if let Some(base) = c.resolve(n.id.as_str()) {
                    c.calls.insert(RawRef {
                        base,
                        member: "(ref)".into(),
                    });
                }
            }
            other => c.visit_expr(other),
        }
        c.fill(&mut sym);
        self.push_symbol(sym);
    }

    /// True when `e` is a lambda, a module-level `def`, or a call that wraps one.
    fn wraps_function(&self, e: &Expr, depth: usize) -> bool {
        if depth > 8 {
            return false;
        }
        match e {
            Expr::Lambda(_) => true,
            Expr::Name(n) => self.functions.contains(n.id.as_str()),
            Expr::Call(c) => c
                .arguments
                .args
                .first()
                .is_some_and(|a| self.wraps_function(a, depth + 1)),
            _ => false,
        }
    }

    /// A decorator on a function or class: a wrap, or an adapter registration.
    /// `@user_passes_test(<test>)`, also as the argument of `@method_decorator`: what
    /// the test answers a caller who is not signed in, where it is read
    /// ([`drift_core::controls::PASSES_TEST_SIGNED_IN`]).
    fn passes_test(&self, d: &ast::Decorator, sym: &mut RawSymbol) {
        const TEST: &str = "django.contrib.auth.decorators.user_passes_test";
        const METHOD: &str = "django.utils.decorators.method_decorator";
        let is = |c: &ast::ExprCall, what: &str| {
            self.canon(&c.func).and_then(|r| dotted(&r)).as_deref() == Some(what)
        };
        let Expr::Call(outer) = &d.expression else {
            return;
        };
        let call = match outer.arguments.args.first() {
            Some(Expr::Call(inner)) if is(outer, METHOD) => inner,
            _ => outer,
        };
        if !is(call, TEST) {
            return;
        }
        let test = call
            .arguments
            .args
            .first()
            .or_else(|| call.arguments.find_keyword("test_func").map(|k| &k.value));
        // A name the module binds to its own `def`.
        let defs = |n: &str| -> Option<&'t ast::StmtFunctionDef> {
            matches!(self.bindings.get(n), Some(RawBinding::Local))
                .then(|| self.defs.get(n).copied())
                .flatten()
        };
        let control = match test.and_then(|t| verdict::of_test(t, &defs)) {
            Some(verdict::Verdict::SignedIn) => drift_core::controls::PASSES_TEST_SIGNED_IN,
            Some(verdict::Verdict::True) => drift_core::controls::PASSES_TEST_TRUE,
            _ => drift_core::controls::PASSES_TEST_UNREAD,
        };
        if !sym.controls.iter().any(|c| c == control) {
            sym.controls.push(control.into());
        }
        // What the test asks of a caller who is signed in, where it is read.
        let asks = match test.and_then(|t| verdict::asks_of_test(t, &defs)) {
            Some(verdict::Asks::Role) => drift_core::controls::TEST_ASKS_ROLE,
            Some(verdict::Asks::Status) => drift_core::controls::TEST_ASKS_STATUS,
            None => drift_core::controls::TEST_ASKS_UNREAD,
        };
        if !sym.controls.iter().any(|c| c == asks) {
            sym.controls.push(asks.into());
        }
    }

    pub(crate) fn lower_decorator(
        &mut self,
        symbol: &str,
        d: &'t ast::Decorator,
        position: u32,
        sym: &mut RawSymbol,
    ) {
        self.practice_decorator(symbol, d, sym);
        self.passes_test(d, sym);
        if self.lower_entry_decorator(symbol, d, position, sym) {
            return;
        }
        let (func, call) = match &d.expression {
            Expr::Call(c) => (c.func.as_ref(), Some(c)),
            e => (e, None),
        };
        // A decorator that is no name: what it applies may be the guard.
        let named = |e: &Expr| self.canon(e);
        let Some(r) = named(func) else {
            sym.since_wraps
                .push((sym.wraps.len() as u32, None, practice::words(&d.expression)));
            return;
        };
        let dotted = dotted(&r);
        // `@method_decorator(login_required, name="dispatch")` applies its argument.
        if dotted.as_deref() == Some("django.utils.decorators.method_decorator")
            && let Some(inner) = call.and_then(|c| c.arguments.args.first())
        {
            for x in elements(inner).map_or_else(|| vec![inner], |els| els.iter().collect()) {
                let (f, ic) = match x {
                    Expr::Call(ic) => (ic.func.as_ref(), Some(ic)),
                    other => (other, None),
                };
                match named(f) {
                    Some(ir) => {
                        if let Some(ic) = ic {
                            sym.shapes.push((ir.clone(), adapters::args_shape(ic)));
                        }
                        sym.wraps.push((ir, WrapKind::Decorator));
                    }
                    // A name bound to a list is read where it is bound; anything
                    // else that is no name is kept by its words.
                    None if !matches!(x, Expr::Name(_) | Expr::Attribute(_)) => sym
                        .since_wraps
                        .push((sym.wraps.len() as u32, None, practice::words(x))),
                    None => {}
                }
            }
            return;
        }
        if let Some(c) = call {
            for k in &c.arguments.keywords {
                if let Some(a) = &k.arg {
                    sym.args
                        .push((r.clone(), KWARG_INDEX, a.as_str().to_string()));
                }
            }
            sym.shapes.push((r.clone(), adapters::args_shape(c)));
        }
        sym.wraps.push((r, WrapKind::Decorator));
    }
}

impl Lowerer<'_> {
    /// A module-level function of this module that never returns and refuses: its
    /// body has no `return` or `yield` and ends by raising a rejection or by
    /// `abort(401)` (`def deny(): raise HTTPException(status_code=401)`). A call of
    /// it as a statement is a refusal where it stands.
    pub(crate) fn denier(&self, name: &str) -> bool {
        use drift_core::controls::Rejection::{Forbidden, Unauthenticated};
        if !matches!(self.bindings.get(name), Some(RawBinding::Local)) {
            return false;
        }
        let Some(f) = self.defs.get(name) else {
            return false;
        };
        let body = without_docstring(&f.body);
        if any_stmt(body, &|s| matches!(s, Stmt::Return(_))) {
            return false;
        }
        match body.last() {
            Some(Stmt::Raise(r)) => r.exc.as_deref().is_some_and(|e| {
                matches!(rejection_marker(e, 0), Some(Unauthenticated | Forbidden))
            }),
            Some(Stmt::Expr(x)) => match x.value.as_ref() {
                Expr::Call(c) => matches!(call_rejection(c), Some(Unauthenticated | Forbidden)),
                _ => false,
            },
            _ => false,
        }
    }

    /// [`drift_core::controls::REFUSAL_NOT_RETURNED`]: the function hands back, by
    /// name, functions defined in its body none of which refuses or names another
    /// that does, while one it does not hand back refuses, and its own statements
    /// do not.
    fn refusal_not_returned(&self, f: &ast::StmtFunctionDef) -> bool {
        use drift_core::controls::Rejection::{Forbidden, Unauthenticated};
        let body = without_docstring(&f.body);
        let inner: Vec<&ast::StmtFunctionDef> = body
            .iter()
            .filter_map(|s| match s {
                Stmt::FunctionDef(d) => Some(d),
                _ => None,
            })
            .collect();
        if inner.len() < 2 {
            return false;
        }
        let refuses = |b: &[Stmt]| {
            any_stmt(b, &|s| match s {
                Stmt::Raise(r) => r.exc.as_deref().is_some_and(|e| {
                    matches!(rejection_marker(e, 0), Some(Unauthenticated | Forbidden))
                }),
                Stmt::Return(r) => r.value.as_deref().is_some_and(|e| {
                    matches!(rejection_marker(e, 0), Some(Unauthenticated | Forbidden))
                }),
                Stmt::Expr(x) => match x.value.as_ref() {
                    Expr::Call(c) => {
                        matches!(call_rejection(c), Some(Unauthenticated | Forbidden))
                    }
                    _ => false,
                },
                _ => false,
            })
        };
        let returned: Vec<&str> = body
            .iter()
            .filter_map(|s| match s {
                Stmt::Return(r) => match r.value.as_deref() {
                    Some(Expr::Name(n)) => Some(n.id.as_str()),
                    _ => None,
                },
                _ => None,
            })
            .collect();
        // Every `return` of the body hands back a function defined in it.
        let returns = body.iter().filter(|s| matches!(s, Stmt::Return(_))).count();
        if returned.is_empty() || returned.len() != returns {
            return false;
        }
        type Defs<'d> = Vec<&'d ast::StmtFunctionDef>;
        let (kept, left): (Defs, Defs) = inner
            .iter()
            .copied()
            .partition(|d| returned.contains(&d.name.as_str()));
        !kept.is_empty()
            && left.iter().any(|d| refuses(&d.body))
            && kept
                .iter()
                .all(|d| !refuses(&d.body) && left.iter().all(|l| !names(&d.body, l.name.as_str())))
            && !refuses(
                &body
                    .iter()
                    .filter(|s| !matches!(s, Stmt::FunctionDef(_)))
                    .cloned()
                    .collect::<Vec<_>>(),
            )
    }

    /// [`RawSymbol::returns_result_of`] of a body, and of the functions defined in
    /// it (what a decorator runs in the view's place).
    fn returns_result_of(&self, body: &[Stmt], out: &mut Vec<RawRef>, depth: usize) {
        // The callee of `f(...)` or `await f(...)`.
        let callee = |e: &Expr| -> Option<RawRef> {
            let e = match e {
                Expr::Await(a) => a.value.as_ref(),
                e => e,
            };
            match e {
                Expr::Call(c) => self
                    .canon(&c.func)
                    .filter(|r| !matches!(r.base, RawBase::Global(_))),
                _ => None,
            }
        };
        // `x`, `x is not None`, `x != None`, `isinstance(x, ...)`.
        fn tests(test: &Expr, x: &str) -> bool {
            match test {
                Expr::Name(n) => n.id.as_str() == x,
                Expr::Compare(c) => {
                    matches!(&*c.ops, [ast::CmpOp::IsNot | ast::CmpOp::NotEq])
                        && matches!(&*c.operands, [left, Expr::NoneLiteral(_)] if is_name(left, x))
                }
                Expr::Call(c) => {
                    matches!(c.func.as_ref(), Expr::Name(f) if f.id.as_str() == "isinstance")
                        && c.arguments.args.first().is_some_and(|a| is_name(a, x))
                }
                _ => false,
            }
        }
        // `if <test of x>: return x`, with nothing else in the branch.
        let returns = |i: &ast::StmtIf, x: &str, test: &Expr| -> bool {
            tests(test, x)
                && matches!(&*i.body, [Stmt::Return(r)] if r.value.as_deref().is_some_and(|v| is_name(v, x)))
        };
        let body = without_docstring(body);
        for (n, stmt) in body.iter().enumerate() {
            match stmt {
                Stmt::Assign(a) => {
                    if let [Expr::Name(x)] = a.targets.as_slice()
                        && let Some(r) = callee(&a.value)
                        && let Some(Stmt::If(i)) = body.get(n + 1)
                        && returns(i, x.id.as_str(), &i.test)
                        && !out.contains(&r)
                    {
                        out.push(r);
                    }
                }
                Stmt::If(i) => {
                    // `if (x := f()) is not None: return x`, `if x := f(): return x`.
                    let named = match i.test.as_ref() {
                        Expr::Named(w) => Some(w),
                        Expr::Compare(c)
                            if matches!(&*c.ops, [ast::CmpOp::IsNot | ast::CmpOp::NotEq]) =>
                        {
                            match &*c.operands {
                                [Expr::Named(w), Expr::NoneLiteral(_)] => Some(w),
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                    if let Some(w) = named
                        && let Expr::Name(x) = w.target.as_ref()
                        && let Some(r) = callee(&w.value)
                        && matches!(&*i.body, [Stmt::Return(ret)]
                            if ret.value.as_deref().is_some_and(|v| is_name(v, x.id.as_str())))
                        && !out.contains(&r)
                    {
                        out.push(r);
                    }
                }
                Stmt::FunctionDef(inner) if depth < 3 => {
                    self.returns_result_of(&inner.body, out, depth + 1);
                }
                _ => {}
            }
        }
    }

    /// A `return` of the function's own body hands back something the facts do not
    /// name ([`drift_core::controls::RETURNS_UNREAD`]): a lookup (`GUARDS[mode]`),
    /// a local variable that is no nested `def`, an attribute of a local or of a
    /// parameter (`self.guard`), or the result of calling one of those. A nested
    /// `def` by its name or called, a parameter handed back, a module-level name,
    /// a class built, `None` and any literal or display are read, or are no
    /// callable at all.
    fn returns_unread(&self, f: &ast::StmtFunctionDef) -> bool {
        #[derive(Default)]
        struct Found<'a> {
            returns: Vec<&'a Expr>,
            defs: BTreeSet<&'a str>,
        }
        impl<'a> Visitor<'a> for Found<'a> {
            fn visit_stmt(&mut self, s: &'a Stmt) {
                match s {
                    Stmt::FunctionDef(f) => {
                        self.defs.insert(f.name.as_str());
                    }
                    Stmt::ClassDef(c) => {
                        self.defs.insert(c.name.as_str());
                    }
                    Stmt::Return(r) => self.returns.extend(r.value.as_deref()),
                    _ => visitor::walk_stmt(self, s),
                }
            }
            fn visit_expr(&mut self, _: &'a Expr) {}
        }
        let mut found = Found::default();
        for s in &f.body {
            found.visit_stmt(s);
        }
        if found.returns.is_empty() {
            return false;
        }
        let mut params = Scope::default();
        parameter_names(&f.parameters, &mut params);
        let mut scope = Scope::default();
        let mut globals = BTreeSet::new();
        bind_body(&f.body, &mut scope, &mut globals);
        // A name the body binds that is neither a nested definition nor declared
        // global: a variable.
        let variable = |n: &str| {
            scope.names.contains_key(n) && !found.defs.contains(n) && !globals.contains(n)
        };
        let local = |n: &str| variable(n) || params.names.contains_key(n);
        fn unread(e: &Expr, variable: &dyn Fn(&str) -> bool, local: &dyn Fn(&str) -> bool) -> bool {
            match e {
                Expr::Subscript(_) => true,
                Expr::If(i) => {
                    unread(&i.body, variable, local) || unread(&i.orelse, variable, local)
                }
                Expr::Await(a) => unread(&a.value, variable, local),
                Expr::Name(n) => variable(n.id.as_str()),
                Expr::Attribute(_) => {
                    let mut base = e;
                    while let Expr::Attribute(a) = base {
                        base = &a.value;
                    }
                    match base {
                        Expr::Name(n) => local(n.id.as_str()),
                        _ => true,
                    }
                }
                Expr::Call(c) => match c.func.as_ref() {
                    Expr::Name(n) => local(n.id.as_str()),
                    f @ Expr::Attribute(_) => unread(f, variable, local),
                    // `wraps(view)(inner)` and the like: what a call hands back,
                    // called.
                    Expr::Call(inner) => unread(&Expr::Call(inner.clone()), variable, local),
                    _ => true,
                },
                _ => false,
            }
        }
        found.returns.iter().any(|e| unread(e, &variable, &local))
    }

    /// The callables a function's own `return` statements hand back by reference
    /// ([`RawReturn`]): a module-level or imported name or attribute
    /// (`return verify`, `return deps.verify`), an instance of a class
    /// (`return BearerAuth(...)`), or `functools.partial(f, ...)`. A local of the
    /// function (a nested `def`, whose body already folds into the function's, or a
    /// variable) and any other expression are none of these.
    fn returned_callables(&self, f: &ast::StmtFunctionDef) -> Vec<RawReturn> {
        struct Returns<'a>(Vec<&'a Expr>);
        impl<'a> Visitor<'a> for Returns<'a> {
            fn visit_stmt(&mut self, s: &'a Stmt) {
                match s {
                    Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
                    Stmt::Return(r) => self.0.extend(r.value.as_deref()),
                    _ => visitor::walk_stmt(self, s),
                }
            }
            fn visit_expr(&mut self, _: &'a Expr) {}
        }
        let mut found = Returns(Vec::new());
        for s in &f.body {
            found.visit_stmt(s);
        }
        let mut scope = Scope::default();
        parameter_names(&f.parameters, &mut scope);
        let mut globals = BTreeSet::new();
        bind_body(&f.body, &mut scope, &mut globals);
        let local = |e: &Expr| -> bool {
            let mut base = e;
            while let Expr::Attribute(a) = base {
                base = &a.value;
            }
            match base {
                Expr::Name(n) => {
                    scope.names.contains_key(n.id.as_str()) && !globals.contains(n.id.as_str())
                }
                _ => true,
            }
        };
        let reference = |e: &Expr| -> Option<RawRef> {
            if !matches!(e, Expr::Name(_) | Expr::Attribute(_)) || local(e) {
                return None;
            }
            self.canon(e)
                .filter(|r| !matches!(r.base, RawBase::Global(_)))
        };
        let mut out = Vec::new();
        for e in found.0 {
            match e {
                Expr::Name(_) | Expr::Attribute(_) => out.extend(reference(e).map(RawReturn::Ref)),
                Expr::Call(c) => {
                    let partial = matches!(
                        self.canon(&c.func).as_ref().and_then(dotted).as_deref(),
                        Some("functools.partial")
                    );
                    if partial {
                        out.push(RawReturn::Partial(
                            c.arguments.args.first().and_then(&reference),
                        ));
                    } else if matches!(c.func.as_ref(), Expr::Name(_) | Expr::Attribute(_))
                        && match c.func.as_ref() {
                            Expr::Name(n) => n.id.as_str(),
                            Expr::Attribute(a) => a.attr.as_str(),
                            _ => "",
                        }
                        .starts_with(|ch: char| ch.is_ascii_uppercase())
                        && let Some(r) = reference(&c.func)
                    {
                        out.push(RawReturn::Instance(r, adapters::soft_args(c).keyword));
                    }
                }
                _ => {}
            }
        }
        out.sort();
        out.dedup();
        out
    }
}

/// Specifier of `from <spec> import ...`, relative dots included.
fn from_spec(i: &ast::StmtImportFrom) -> String {
    let dots = ".".repeat(i.level as usize);
    match &i.module {
        Some(m) => format!("{dots}{}", m.as_str()),
        None => dots,
    }
}

/// Full dotted path of an imported reference without calls (`fastapi.APIRouter`,
/// `rest_framework.routers.DefaultRouter`); `None` for local, global or relative refs.
pub(crate) fn dotted(r: &RawRef) -> Option<String> {
    let RawBase::Import { spec, name } = &r.base else {
        return None;
    };
    if spec.starts_with('.') || r.member.contains('(') {
        return None;
    }
    let mut s = spec.clone();
    if name != "*" {
        s.push('.');
        s.push_str(name);
    }
    s.push_str(&r.member);
    Some(s)
}

/// Canonical raw reference for an expression, with `resolve` deciding what a bare
/// name refers to (`None` for function-local names).
pub(crate) fn canon_with(e: &Expr, resolve: &dyn Fn(&str) -> Option<RawBase>) -> Option<RawRef> {
    match e {
        Expr::Name(n) => Some(RawRef {
            base: resolve(n.id.as_str())?,
            member: String::new(),
        }),
        Expr::Attribute(a) => {
            let mut r = canon_with(&a.value, resolve)?;
            if r.member.matches('.').count() >= MAX_MEMBER_DEPTH {
                return Some(r);
            }
            r.member.push('.');
            r.member.push_str(a.attr.as_str());
            Some(r)
        }
        Expr::Call(c) => {
            let mut r = canon_with(&c.func, resolve)?;
            if !r.member.ends_with("()") {
                r.member.push_str("()");
            }
            Some(r)
        }
        _ => None,
    }
}

/// Collects every import statement in the file (module level and inside functions).
struct ImportFinder {
    /// (spec, from, type_only) -> names
    found: BTreeMap<(String, bool, bool), BTreeSet<String>>,
    depth: usize,
}

impl ImportFinder {
    fn add(&mut self, spec: String, from: bool, name: &str, type_only: bool) {
        self.found
            .entry((spec, from, type_only))
            .or_default()
            .insert(name.to_string());
    }
}

impl<'a> Visitor<'a> for ImportFinder {
    fn visit_stmt(&mut self, stmt: &'a Stmt) {
        match stmt {
            Stmt::If(i) if self.depth == 0 && is_type_checking(&i.test) => {
                for s in &i.body {
                    match s {
                        Stmt::Import(imp) => {
                            for a in &imp.names {
                                self.add(a.name.as_str().to_string(), false, "*", true);
                            }
                        }
                        Stmt::ImportFrom(imp) => {
                            for a in &imp.names {
                                self.add(from_spec(imp), true, a.name.as_str(), true);
                            }
                        }
                        other => self.visit_stmt(other),
                    }
                }
                for c in &i.elif_else_clauses {
                    for s in &c.body {
                        self.visit_stmt(s);
                    }
                }
            }
            Stmt::Import(imp) => {
                for a in &imp.names {
                    self.add(a.name.as_str().to_string(), false, "*", false);
                }
            }
            Stmt::ImportFrom(imp) => {
                for a in &imp.names {
                    self.add(from_spec(imp), true, a.name.as_str(), false);
                }
            }
            Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {
                self.depth += 1;
                visitor::walk_stmt(self, stmt);
                self.depth -= 1;
            }
            _ => visitor::walk_stmt(self, stmt),
        }
    }
}

/// One function, class or comprehension scope: locally bound names, with the import
/// they come from when bound by a local `import`.
#[derive(Debug, Default)]
struct Scope {
    names: HashMap<String, Option<(String, String)>>,
    class: bool,
}

/// Names a function body binds (without descending into nested scopes).
fn bind_body(body: &[Stmt], scope: &mut Scope, globals: &mut BTreeSet<String>) {
    for stmt in body {
        bind_stmt(stmt, scope, globals);
    }
}

fn bind_target(e: &Expr, scope: &mut Scope) {
    let mut names = Vec::new();
    target_names(e, &mut names);
    for n in names {
        scope.names.entry(n.to_string()).or_insert(None);
    }
}

fn bind_stmt(stmt: &Stmt, scope: &mut Scope, globals: &mut BTreeSet<String>) {
    match stmt {
        Stmt::FunctionDef(f) => {
            scope
                .names
                .entry(f.name.as_str().to_string())
                .or_insert(None);
        }
        Stmt::ClassDef(c) => {
            scope
                .names
                .entry(c.name.as_str().to_string())
                .or_insert(None);
        }
        Stmt::Assign(a) => a.targets.iter().for_each(|t| bind_target(t, scope)),
        Stmt::AnnAssign(a) => bind_target(&a.target, scope),
        Stmt::AugAssign(a) => bind_target(&a.target, scope),
        Stmt::TypeAlias(t) => bind_target(&t.name, scope),
        Stmt::For(f) => {
            bind_target(&f.target, scope);
            bind_body(&f.body, scope, globals);
            bind_body(&f.orelse, scope, globals);
        }
        Stmt::While(w) => {
            bind_body(&w.body, scope, globals);
            bind_body(&w.orelse, scope, globals);
        }
        Stmt::If(i) => {
            bind_body(&i.body, scope, globals);
            for c in &i.elif_else_clauses {
                bind_body(&c.body, scope, globals);
            }
        }
        Stmt::With(w) => {
            for item in &w.items {
                if let Some(v) = &item.optional_vars {
                    bind_target(v, scope);
                }
            }
            bind_body(&w.body, scope, globals);
        }
        Stmt::Try(t) => {
            bind_body(&t.body, scope, globals);
            for h in &t.handlers {
                let ast::ExceptHandler::ExceptHandler(h) = h;
                if let Some(n) = &h.name {
                    scope.names.entry(n.as_str().to_string()).or_insert(None);
                }
                bind_body(&h.body, scope, globals);
            }
            bind_body(&t.orelse, scope, globals);
            bind_body(&t.finalbody, scope, globals);
        }
        Stmt::Match(m) => {
            for case in &m.cases {
                bind_pattern(&case.pattern, scope);
                bind_body(&case.body, scope, globals);
            }
        }
        Stmt::Import(i) => {
            for a in &i.names {
                let full = a.name.as_str();
                let (local, spec) = match &a.asname {
                    Some(x) => (x.as_str(), full),
                    None => {
                        let top = full.split('.').next().unwrap_or(full);
                        (top, top)
                    }
                };
                scope
                    .names
                    .insert(local.to_string(), Some((spec.to_string(), "*".into())));
            }
        }
        Stmt::ImportFrom(i) => {
            let spec = from_spec(i);
            for a in &i.names {
                if a.name.as_str() == "*" {
                    continue;
                }
                let local = a.asname.as_ref().map_or(a.name.as_str(), |x| x.as_str());
                scope.names.insert(
                    local.to_string(),
                    Some((spec.clone(), a.name.as_str().to_string())),
                );
            }
        }
        Stmt::Global(g) => {
            for n in &g.names {
                globals.insert(n.as_str().to_string());
            }
        }
        Stmt::Delete(_) | Stmt::Expr(_) | Stmt::Return(_) | Stmt::Raise(_) | Stmt::Assert(_) => {
            // Walrus targets bind in the enclosing function.
            let mut w = WalrusFinder { names: vec![] };
            w.visit_stmt(stmt);
            for n in w.names {
                scope.names.entry(n).or_insert(None);
            }
        }
        _ => {}
    }
}

fn bind_pattern(p: &ast::Pattern, scope: &mut Scope) {
    use ast::Pattern as P;
    match p {
        P::MatchAs(m) => {
            if let Some(n) = &m.name {
                scope.names.entry(n.as_str().to_string()).or_insert(None);
            }
            if let Some(inner) = &m.pattern {
                bind_pattern(inner, scope);
            }
        }
        P::MatchStar(m) => {
            if let Some(n) = &m.name {
                scope.names.entry(n.as_str().to_string()).or_insert(None);
            }
        }
        P::MatchMapping(m) => {
            m.patterns.iter().for_each(|x| bind_pattern(x, scope));
            if let Some(n) = &m.rest {
                scope.names.entry(n.as_str().to_string()).or_insert(None);
            }
        }
        P::MatchSequence(m) => m.patterns.iter().for_each(|x| bind_pattern(x, scope)),
        P::MatchClass(m) => {
            m.arguments
                .patterns
                .iter()
                .for_each(|x| bind_pattern(x, scope));
            m.arguments
                .keywords
                .iter()
                .for_each(|k| bind_pattern(&k.pattern, scope));
        }
        P::MatchOr(m) => m.patterns.iter().for_each(|x| bind_pattern(x, scope)),
        P::MatchValue(_) | P::MatchSingleton(_) => {}
    }
}

/// Walrus targets of a statement, also inside compound statements, but not in the
/// bodies of nested functions, classes and lambdas (their own scopes).
struct WalrusFinder {
    names: Vec<String>,
}

impl<'a> Visitor<'a> for WalrusFinder {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        match s {
            Stmt::FunctionDef(f) => {
                for d in &f.decorator_list {
                    self.visit_decorator(d);
                }
            }
            Stmt::ClassDef(c) => {
                for d in &c.decorator_list {
                    self.visit_decorator(d);
                }
                if let Some(a) = &c.arguments {
                    self.visit_arguments(a);
                }
            }
            _ => visitor::walk_stmt(self, s),
        }
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Named(n) = e
            && let Expr::Name(t) = n.target.as_ref()
        {
            self.names.push(t.id.as_str().to_string());
        }
        if !matches!(e, Expr::Lambda(_)) {
            visitor::walk_expr(self, e);
        }
    }
}

/// Whether a `return` of `f`, or of a function it defines (to two levels), hands
/// back one of that function's own parameters unchanged (`return view`), and
/// whether another hands back anything else ([`drift_core::controls::HANDS_BACK_PARAM`]
/// where both). A value that may be a parameter is one: either branch of `a if c
/// else b` and of `a or b`, and a local the body binds to one anywhere (`if
/// settings.DEBUG: inner = view`, then `return inner`), which may also be
/// anything else it is bound to.
fn hands_back_param(f: &ast::StmtFunctionDef, depth: usize) -> (bool, bool) {
    /// The names the body binds to what may be a parameter, to a fixed point.
    struct Bound<'a> {
        params: BTreeSet<&'a str>,
        changed: bool,
    }
    fn may_be<'a>(params: &BTreeSet<&'a str>, e: &'a Expr) -> bool {
        match e {
            Expr::Name(n) => params.contains(n.id.as_str()),
            Expr::If(i) => may_be(params, &i.body) || may_be(params, &i.orelse),
            Expr::BoolOp(b) => b.values.iter().any(|v| may_be(params, v)),
            Expr::Named(n) => may_be(params, &n.value),
            _ => false,
        }
    }
    impl<'a> Visitor<'a> for Bound<'a> {
        fn visit_stmt(&mut self, s: &'a Stmt) {
            match s {
                Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
                Stmt::Assign(a) => {
                    if may_be(&self.params, &a.value) {
                        for t in &a.targets {
                            if let Expr::Name(n) = t
                                && self.params.insert(n.id.as_str())
                            {
                                self.changed = true;
                            }
                        }
                    }
                }
                Stmt::AnnAssign(a) => {
                    if let (Some(v), Expr::Name(n)) = (a.value.as_deref(), a.target.as_ref())
                        && may_be(&self.params, v)
                        && self.params.insert(n.id.as_str())
                    {
                        self.changed = true;
                    }
                }
                _ => visitor::walk_stmt(self, s),
            }
        }
        fn visit_expr(&mut self, _: &'a Expr) {}
    }
    struct Found<'a> {
        params: BTreeSet<&'a str>,
        own: BTreeSet<&'a str>,
        param: bool,
        other: bool,
        inner: Vec<&'a ast::StmtFunctionDef>,
    }
    impl<'a> Visitor<'a> for Found<'a> {
        fn visit_stmt(&mut self, s: &'a Stmt) {
            match s {
                Stmt::FunctionDef(f) => self.inner.push(f),
                Stmt::ClassDef(_) => {}
                Stmt::Return(r) => match r.value.as_deref() {
                    Some(Expr::Name(n)) if self.own.contains(n.id.as_str()) => self.param = true,
                    Some(e) if may_be(&self.params, e) => {
                        self.param = true;
                        self.other = true;
                    }
                    _ => self.other = true,
                },
                _ => visitor::walk_stmt(self, s),
            }
        }
        fn visit_expr(&mut self, _: &'a Expr) {}
    }
    let p = &f.parameters;
    let own: BTreeSet<&str> = p
        .posonlyargs
        .iter()
        .chain(&p.args)
        .chain(&p.kwonlyargs)
        .map(|a| a.parameter.name.as_str())
        .collect();
    let mut bound = Bound {
        params: own.clone(),
        changed: true,
    };
    while bound.changed {
        bound.changed = false;
        for s in &f.body {
            bound.visit_stmt(s);
        }
    }
    struct Names<'a, 'b>(&'b mut BTreeSet<&'a str>);
    impl<'a> Visitor<'a> for Names<'a, '_> {
        fn visit_stmt(&mut self, s: &'a Stmt) {
            match s {
                Stmt::FunctionDef(_) | Stmt::ClassDef(_) => {}
                Stmt::Assign(a) => {
                    for t in &a.targets {
                        let mut names = Vec::new();
                        target_names(t, &mut names);
                        self.0.extend(names);
                    }
                }
                _ => visitor::walk_stmt(self, s),
            }
        }
        fn visit_expr(&mut self, _: &'a Expr) {}
    }
    // A parameter bound again to anything is no longer only the parameter.
    let mut rebound: BTreeSet<&str> = BTreeSet::new();
    for s in &f.body {
        Names(&mut rebound).visit_stmt(s);
    }
    let mut found = Found {
        own: own
            .iter()
            .filter(|p| !rebound.contains(*p))
            .copied()
            .collect(),
        params: bound.params,
        param: false,
        other: false,
        inner: Vec::new(),
    };
    for s in &f.body {
        found.visit_stmt(s);
    }
    let (mut param, mut other) = (found.param, found.other);
    if depth < 2 {
        for inner in found.inner {
            let (p, o) = hands_back_param(inner, depth + 1);
            param |= p;
            other |= o;
        }
    }
    (param, other)
}

fn parameter_names(p: &ast::Parameters, scope: &mut Scope) {
    for a in p.posonlyargs.iter().chain(&p.args).chain(&p.kwonlyargs) {
        scope
            .names
            .insert(a.parameter.name.as_str().to_string(), None);
    }
    if let Some(v) = &p.vararg {
        scope.names.insert(v.name.as_str().to_string(), None);
    }
    if let Some(k) = &p.kwarg {
        scope.names.insert(k.name.as_str().to_string(), None);
    }
}

/// Walks a symbol's body collecting calls, argument keys, control facts and signals.
pub(crate) struct Collector<'l, 't> {
    pub(crate) l: &'l Lowerer<'t>,
    scopes: Vec<Scope>,
    /// Calls in annotations are types, not calls.
    in_annotation: bool,
    pub(crate) calls: BTreeSet<RawRef>,
    pub(crate) args: BTreeSet<(RawRef, u32, String)>,
    /// Per callee: how many calls name their keywords, and how many of them pass each.
    keyed_calls: BTreeMap<RawRef, (u32, BTreeMap<String, u32>)>,
    /// The class's own attributes (assigned, annotated, defined), each with the
    /// callees called directly in its statement (only class scopes open), or `None`.
    declares: BTreeSet<(String, Option<RawRef>)>,
    /// The attributes the top-level class-body statement being walked binds.
    class_attrs: Vec<String>,
    pub(crate) controls: BTreeSet<String>,
    strings: u32,
    reads: BTreeSet<String>,
    throws: BTreeSet<RawRef>,
    pub(crate) sinks: BTreeSet<String>,
    /// Sinks the measured build did not read ([`RawSymbol::since_sinks`]).
    since_sinks: BTreeSet<String>,
    /// [`RawSymbol::fed_sinks`], and the names the body binds to a value read off
    /// a parameter or off what the request sent ([`Collector::input_reaches`]).
    fed_sinks: BTreeSet<String>,
    fed_locals: BTreeSet<String>,
    /// [`RawSymbol::param_passes`].
    param_passes: BTreeSet<RawRef>,
    /// The names the body binds to SQL text (text that holds a keyword), and those
    /// it binds to SQL text built from a part that is no literal
    /// ([`Collector::note_sql_binding`]).
    sql_text: BTreeSet<String>,
    pub(crate) sql_built: BTreeSet<String>,
    order: Vec<RawRef>,
    /// The body turns its caller away ([`drift_core::controls::REJECTS_CALLER`]) as not
    /// signed in, or as not allowed: what it raises or returns says so
    /// ([`Collector::rejecting`]), or `abort(401)` or a sign-in redirect
    /// ([`Collector::note_rejection`]), where it counts ([`Collector::counting`]).
    unauthenticated: bool,
    forbidden: bool,
    /// The body answers "not signed in" in the `except` handler of a `try` it cannot
    /// pass otherwise ([`drift_core::controls::HANDLER_REJECTS`]), or in a handler
    /// where that is not proven ([`drift_core::controls::HANDLER_MAY_REJECT`]):
    /// [`Collector::note_handler_rejection`].
    handler_rejects: bool,
    handler_may_reject: bool,
    /// The `try` statements that are such proof, by where they start.
    proven_tries: BTreeSet<TextSize>,
    /// What the paths of the functions walked say of their refusals
    /// ([`guard_paths`]): one refuses and lets through only requests that passed a
    /// refusal; one lets a request through that passed none
    /// ([`drift_core::controls::REJECTS_SOME`]); one refuses and never returns
    /// ([`drift_core::controls::REFUSES_ALL`]).
    rejects_every: bool,
    rejects_some: bool,
    refuses_all: bool,
    /// A handler of such a `try` answers "not allowed" (a 403): something that may
    /// be the guard in a body that reads a subject, as a 403 outside a handler counts
    /// only there.
    handler_forbidden: bool,
    /// The body reads a user, session, auth, token or permission value
    /// ([`drift_core::controls::names_subject`]): a 403 counts only next to one.
    reads_subject: bool,
    /// Inside an `except` handler: what is raised or returned there converts an error
    /// caught from deeper code, it does not reject a caller itself.
    in_except: u32,
    /// The current function has handed control on to its continuation on every path
    /// so far ([`Collector::continues`]: `call_next()`, the wrapped view, a
    /// dependency's `yield`): a guard rejects before it hands control on.
    continued: bool,
    /// Per function being walked (innermost last): the index of its scope in
    /// [`Self::scopes`] and its parameter names. A parameter of an enclosing function
    /// called in a nested one is the view a decorator wraps
    /// (`def deco(target): def inner(*a): return target(*a)`).
    frames: Vec<(usize, BTreeSet<String>)>,
    /// The symbol's own (outermost) function: its parameters as input sources, and the
    /// names its request object goes by ([`Lowerer::input_params`]).
    input_params: Option<(Vec<RawParamKind>, bool)>,
    request_names: BTreeSet<String>,
    input_reads: bool,
    input_escapes: bool,
    /// Per function being walked (innermost last): its parameters in order, for telling
    /// a call that forwards them ([`Collector::forwards_own`]).
    frame_params: Vec<FrameParams>,
    /// Locals bound to what the continuation hands back (`response = await
    /// call_next(request)`), or to a value derived from it.
    continuation_vars: BTreeSet<String>,
    /// Callees called (and errors raised) before the continuation, and those only
    /// after it or on its result ([`drift_core::Symbol::after_continuation`]).
    before_calls: BTreeSet<RawRef>,
    after_calls: BTreeSet<RawRef>,
    /// Local names bound to an error or response that says it rejects the caller
    /// (`credentials_exception = HTTPException(status_code=401)`), so that
    /// `raise credentials_exception` does.
    rejection_vars: BTreeMap<String, drift_core::controls::Rejection>,
    /// The parameters of the outermost function walked (the symbol's own).
    own_params: BTreeSet<String>,
    /// Callees a call passes one of [`Self::own_params`] to.
    forwards: BTreeSet<RawRef>,
    /// Own parameters the function's own scope has rebound so far (`fp = open(...)`):
    /// a later call does not receive the caller's value.
    rebound: BTreeSet<String>,
    /// Practice facts ([`practice`]).
    body_checks: BTreeSet<RawBodyCheck>,
    pub(crate) raise_checks: BTreeSet<RawRaiseCheck>,
    responses: BTreeSet<RawResponse>,
    log_calls: BTreeSet<RawLogCall>,
    catches: BTreeSet<RawCatch>,
    headers: BTreeSet<String>,
    inputs: BTreeSet<RawInput>,
    scoped: BTreeSet<RawScoped>,
    /// Where the sides of the comparisons the checks record come from, and the
    /// values the scoped queries filter by ([`drift_core::controls::SIDES`],
    /// [`drift_core::controls::FILTER_VALUE`]).
    pub(crate) check_sides: BTreeSet<RawCheckSides>,
    filter_values: BTreeSet<RawFilterValue>,
    /// The calls of the repository's code, with what each argument is
    /// ([`drift_core::controls::ARG_VALUE`]).
    arg_sides: BTreeSet<(RawRef, Vec<(String, RawSide)>)>,
    /// Locals by where the value they are bound to comes from
    /// ([`Collector::side`]).
    pub(crate) side_locals: BTreeMap<String, RawSide>,
    /// Locals bound to either of two values (`org = org or user.org_id`, `a if c
    /// else b`).
    pub(crate) either_locals: BTreeSet<String>,
    /// What the returns of the symbol's own function give: what the request sent
    /// in each so far ([`drift_core::controls::RETURNS_REQUEST`]).
    returns_request: Option<bool>,
    /// Locals bound to a logger ([`Collector::log_init`]), per function.
    log_locals: BTreeMap<String, practice::LogRecv>,
    /// Per class being walked (innermost last): attributes bound to a logger, at class
    /// level or as `self.x = ...` in `__init__`.
    self_logs: Vec<BTreeMap<String, practice::LogRecv>>,
    /// Per function frame: each parameter annotated with a class, as the class's raw
    /// reference, so `service.copy()` is a call of `FolderService.copy`.
    param_types: Vec<HashMap<String, RawRef>>,
    /// Per function being walked (innermost last): what each parameter stands for in a
    /// check ([`Lowerer::param_operands`]).
    param_ops: Vec<BTreeMap<String, RawOperand>>,
    /// Locals bound to a value a check reads (`user = get_user(token)`).
    check_locals: BTreeMap<String, (RawOperand, String)>,
    /// Locals bound to a value of the caller ([`Collector::caller_value`]), with the
    /// dependency where it is what one gives (`venue = get_jwt()["venue_id"]`,
    /// `venue = claims["venue_id"]`).
    pub(crate) caller_locals: BTreeMap<String, Option<RawDep>>,
    /// Those of [`Self::caller_locals`] bound to the caller itself or the key of
    /// the caller's record ([`Collector::caller_self`]).
    pub(crate) self_locals: BTreeSet<String>,
    /// Locals bound to an HMAC, as the key it is keyed with ([`Collector::compare_operand`]).
    hmac_locals: BTreeMap<String, RawOperand>,
    /// Locals bound to a response or an HTTP error (`exc = HTTPException(401)`).
    response_vars: BTreeMap<String, RawResponse>,
    /// Names the enclosing `except ... as e` clauses bind, innermost last.
    except_names: Vec<String>,
    /// Why the node being walked does not run for every request that reaches the
    /// current function's body, outermost first ([`drift_core::not_always`]), each
    /// with the condition in words: an `if` body, an `elif` or `else` of a branch that
    /// goes on, a loop, a `match` case, a `try` whose handler swallows, the right side
    /// of `and` / `or`. A check or a call there is conditional
    /// ([`drift_core::BodyCheck::conditional`]).
    conds: Vec<(&'static str, String)>,
    /// The current function has returned for some requests without refusing them
    /// (`if preview: return {...}`): what follows does not run for those. The
    /// condition in words.
    skipped: Option<String>,
    /// Every branch that has returned so far without refusing did so for the
    /// requests it found to be about the caller's own record
    /// ([`Collector::own_test`]): what follows is asked of every other request.
    skipped_own: bool,
    /// The bodies of the functions being walked, innermost last, and whether the
    /// function about to be walked is one its enclosing body never names again.
    bodies: Vec<&'t [Stmt]>,
    uncalled: bool,
    /// The calls of the symbol being walked, each with why it does not run for every
    /// request, empty where it does ([`drift_core::Symbol::conditional_calls`]).
    pub(crate) conditional_calls: BTreeSet<(RawRef, String)>,
    /// Per function being walked (innermost last): how its own scope binds each local
    /// ([`receivers::local_bindings`]), and its parameters annotated as plain values.
    recv_locals: Vec<HashMap<String, receivers::Binding<'t>>>,
    plain_params: Vec<HashMap<String, receivers::Recv>>,
    /// Method calls on a receiver `calls` does not hold
    /// ([`drift_core::Symbol::receiver_calls`]).
    pub(crate) receiver_calls: BTreeSet<RawReceiverCall>,
    /// The exits (a `raise`, an error answer) that are the first of an `if` whose
    /// condition was read, by where the statement starts, each with whether the body
    /// had by then returned for some requests
    /// ([`drift_core::controls::UNREAD_EXIT`]).
    pub(crate) claimed: HashMap<TextSize, bool>,
    /// The callees whose call's value the body returns
    /// ([`drift_core::Symbol::returns_calls`]).
    returns_calls: BTreeSet<RawRef>,
    /// The callees the body hands a value of the caller to
    /// ([`drift_core::Symbol::caller_args`]).
    caller_args: BTreeSet<(RawRef, Option<RawDep>)>,
    /// What the returns of the symbol's own function give: a value of the caller in
    /// each so far ([`drift_core::controls::RETURNS_CALLER`]); `None` before the
    /// first.
    returns_caller: Option<bool>,
    /// The dependencies the returns of the symbol's own function read their value
    /// off, and whether one gives anything else
    /// ([`drift_core::controls::RETURNS_GIVEN`]).
    returns_via: Vec<RawDep>,
    returns_else: bool,
    /// The callees whose call's value the returns of the symbol's own function
    /// give, and whether one gives anything but `False` or a call
    /// ([`drift_core::controls::RETURNS_ONLY`]).
    held: BTreeSet<(RawHeld, Vec<RawRef>)>,
    /// [`RawSymbol::rows`].
    rows: BTreeSet<(RawRef, RawRows)>,
    /// A rejection that counts was a response the body returns, and one that was
    /// raised or made by a call (`abort(401)`), for
    /// [`drift_core::controls::RETURNS_REJECTION`].
    rejects_by_return: bool,
    rejects_otherwise: bool,
    returns_401: bool,
    inner_rejects_by_return: bool,
    /// How the calls of a library function whose arguments decide are written
    /// ([`SHAPED_CALLS`]).
    call_shapes: BTreeSet<(RawRef, String)>,
    /// Where the callee of the call being walked ends, when it is a method
    /// (`<receiver>.all`): the last name of that path is the method, not a member
    /// read ([`Collector::note_scope_path`]).
    pub(crate) method_end: Option<TextSize>,
    /// The calls whose value is dropped, by where they start: a call that is a
    /// statement of its own (`assert_rule_org(rule, caller)`) or bound to a name the
    /// body never reads, not awaited, returned or handed to another call
    /// (`asyncio.run(warm())`). Such a call of an
    /// `async def` runs nothing ([`drift_core::not_always::NOT_AWAITED`]).
    dropped: BTreeSet<TextSize>,
    /// The call being recorded is one of them.
    call_dropped: bool,
    /// What the current function's body has called so far, each callee once, in the
    /// order of its first call ([`drift_core::BodyCheck::after`]).
    pub(crate) prior: Vec<crate::raw::RawReceiverCall>,
    /// [`Collector::prior`] of the function the collector was started on, once its
    /// body is walked, as [`Collector::called_before`] caps it: what the body
    /// calls, in the order of each callee's first call
    /// ([`drift_core::Member::order`]).
    pub(crate) body_order: Vec<crate::raw::RawReceiverCall>,
    /// The expression being walked is the condition of an `if` whose first exit
    /// refuses: what it compares is recorded as a check.
    refusal_test: usize,
}

impl<'l, 't> Collector<'l, 't> {
    /// `annotations_only`: the collector walks a type expression.
    pub(crate) fn new(l: &'l Lowerer<'t>, annotations_only: bool) -> Self {
        Self {
            l,
            scopes: Vec::new(),
            in_annotation: annotations_only,
            calls: BTreeSet::new(),
            args: BTreeSet::new(),
            keyed_calls: BTreeMap::new(),
            declares: BTreeSet::new(),
            class_attrs: Vec::new(),
            controls: BTreeSet::new(),
            strings: 0,
            reads: BTreeSet::new(),
            throws: BTreeSet::new(),
            sinks: BTreeSet::new(),
            since_sinks: BTreeSet::new(),
            fed_sinks: BTreeSet::new(),
            fed_locals: BTreeSet::new(),
            param_passes: BTreeSet::new(),
            sql_text: BTreeSet::new(),
            sql_built: BTreeSet::new(),
            order: Vec::new(),
            unauthenticated: false,
            forbidden: false,
            handler_rejects: false,
            handler_may_reject: false,
            proven_tries: BTreeSet::new(),
            rejects_every: false,
            rejects_some: false,
            refuses_all: false,
            handler_forbidden: false,
            reads_subject: false,
            in_except: 0,
            continued: false,
            frames: Vec::new(),
            frame_params: Vec::new(),
            input_params: None,
            request_names: BTreeSet::new(),
            input_reads: false,
            input_escapes: false,
            continuation_vars: BTreeSet::new(),
            before_calls: BTreeSet::new(),
            after_calls: BTreeSet::new(),
            rejection_vars: BTreeMap::new(),
            own_params: BTreeSet::new(),
            forwards: BTreeSet::new(),
            rebound: BTreeSet::new(),
            body_checks: BTreeSet::new(),
            raise_checks: BTreeSet::new(),
            responses: BTreeSet::new(),
            log_calls: BTreeSet::new(),
            catches: BTreeSet::new(),
            headers: BTreeSet::new(),
            inputs: BTreeSet::new(),
            scoped: BTreeSet::new(),
            check_sides: BTreeSet::new(),
            filter_values: BTreeSet::new(),
            arg_sides: BTreeSet::new(),
            side_locals: BTreeMap::new(),
            either_locals: BTreeSet::new(),
            returns_request: None,
            log_locals: BTreeMap::new(),
            param_types: Vec::new(),
            self_logs: Vec::new(),
            param_ops: Vec::new(),
            check_locals: BTreeMap::new(),
            caller_locals: BTreeMap::new(),
            self_locals: BTreeSet::new(),
            hmac_locals: BTreeMap::new(),
            response_vars: BTreeMap::new(),
            except_names: Vec::new(),
            conds: Vec::new(),
            skipped: None,
            skipped_own: false,
            bodies: Vec::new(),
            uncalled: false,
            conditional_calls: BTreeSet::new(),
            claimed: HashMap::new(),
            returns_calls: BTreeSet::new(),
            caller_args: BTreeSet::new(),
            returns_caller: None,
            returns_via: Vec::new(),
            returns_else: false,
            held: BTreeSet::new(),
            rows: BTreeSet::new(),
            rejects_by_return: false,
            rejects_otherwise: false,
            returns_401: false,
            inner_rejects_by_return: false,
            call_shapes: BTreeSet::new(),
            method_end: None,
            dropped: BTreeSet::new(),
            call_dropped: false,
            prior: Vec::new(),
            body_order: Vec::new(),
            refusal_test: 0,
            recv_locals: Vec::new(),
            plain_params: Vec::new(),
            receiver_calls: BTreeSet::new(),
        }
    }

    pub(crate) fn fill(mut self, sym: &mut RawSymbol) {
        if let Some((params, variadic)) = self.input_params.take() {
            sym.input_use = Some(RawInputUse {
                reads: self.input_reads,
                escapes: self.input_escapes,
                variadic,
                params,
            });
        }
        if self.unauthenticated || (self.forbidden && self.reads_subject) {
            self.controls
                .insert(drift_core::controls::REJECTS_CALLER.into());
        }
        // It turns callers away only by a response it hands back: a refusal where
        // the framework takes what it returns (a view, a hook, what a decorator
        // runs in the view's place), and none where its caller drops the value or
        // FastAPI does (a dependency).
        if !self.rejects_otherwise && !self.handler_rejects {
            if self.rejects_by_return || self.returns_401 {
                self.controls
                    .insert(drift_core::controls::RETURNS_REJECTION.into());
            } else if self.inner_rejects_by_return {
                self.controls
                    .insert(drift_core::controls::RETURNS_REFUSING.into());
            }
        }
        if let Some(c) = self.handler_control() {
            self.controls.insert(c.into());
        }
        if self.returns_caller == Some(true) {
            self.controls
                .insert(drift_core::controls::RETURNS_CALLER.into());
        }
        if self.returns_request == Some(true) {
            self.controls
                .insert(drift_core::controls::RETURNS_REQUEST.into());
        }
        if self.rejects_every && !self.rejects_some {
            self.controls
                .insert(drift_core::controls::REFUSES_EVERY.into());
        }
        if self.rejects_some && !self.rejects_every {
            self.controls
                .insert(drift_core::controls::REJECTS_SOME.into());
        } else if self.refuses_all && !self.rejects_every {
            self.controls
                .insert(drift_core::controls::REFUSES_ALL.into());
        }
        // After the continuation only, here and in what the symbol already holds: a
        // callee or error this walk, or an earlier one, meets before it is not.
        let before = std::mem::take(&mut self.before_calls);
        sym.after_continuation.retain(|r| !before.contains(r));
        let earlier: BTreeSet<&RawRef> = sym
            .calls
            .iter()
            .chain(&sym.throws)
            .filter(|r| !sym.after_continuation.contains(r))
            .collect();
        let after: Vec<RawRef> = std::mem::take(&mut self.after_calls)
            .into_iter()
            .filter(|r| !before.contains(r) && !earlier.contains(r))
            .collect();
        sym.after_continuation.extend(after);
        sym.calls.extend(self.calls);
        sym.args.extend(self.args);
        sym.declares.extend(self.declares);
        for (callee, (calls, keys)) in self.keyed_calls {
            for (key, n) in keys {
                if n < calls {
                    sym.omits.push((callee.clone(), KWARG_INDEX, key));
                }
            }
        }
        sym.controls.extend(self.controls);
        sym.string_literals += self.strings;
        sym.reads.extend(self.reads);
        sym.throws.extend(self.throws);
        sym.sinks.extend(self.sinks);
        sym.since_sinks.extend(self.since_sinks);
        sym.fed_sinks.extend(self.fed_sinks);
        sym.param_passes.extend(self.param_passes);
        if !self.returns_else && sym.kind == SymbolKind::Function {
            sym.returns_given = std::mem::take(&mut self.returns_via);
        }
        if sym.kind == SymbolKind::Function {
            sym.held = std::mem::take(&mut self.held).into_iter().collect();
            sym.rows = std::mem::take(&mut self.rows).into_iter().collect();
        }
        sym.forwards.extend(self.forwards);
        sym.body_checks.extend(self.body_checks);
        sym.raise_checks.extend(self.raise_checks);
        sym.responses.extend(self.responses);
        sym.log_calls.extend(self.log_calls);
        sym.catches.extend(self.catches);
        sym.headers.extend(self.headers);
        sym.inputs.extend(self.inputs);
        sym.scoped.extend(self.scoped);
        sym.receiver_calls.extend(self.receiver_calls);
        sym.conditional_calls.extend(self.conditional_calls);
        sym.returns_calls.extend(self.returns_calls);
        sym.caller_args.extend(self.caller_args);
        sym.check_sides.extend(self.check_sides);
        sym.filter_values.extend(self.filter_values);
        sym.arg_sides.extend(self.arg_sides);
        sym.shapes.extend(self.call_shapes);
        for r in self.order {
            if !sym.order.contains(&r) && sym.order.len() < MAX_ORDER {
                sym.order.push(r);
            }
        }
    }

    /// What a bare name refers to here; `None` for names local to an enclosing function.
    pub(crate) fn resolve(&self, name: &str) -> Option<RawBase> {
        let innermost = self.scopes.len().saturating_sub(1);
        for (i, s) in self.scopes.iter().enumerate().rev() {
            if s.class && i != innermost {
                continue; // class bodies are not visible from their methods
            }
            if let Some(b) = s.names.get(name) {
                return b.as_ref().map(|(spec, n)| RawBase::Import {
                    spec: spec.clone(),
                    name: n.clone(),
                });
            }
        }
        Some(self.l.module_base(name))
    }

    /// `name` here is one of the symbol's own parameters: bound in the outermost
    /// function's scope, not reassigned there yet, and not rebound by a nested
    /// function or comprehension.
    fn own_param(&self, name: &str) -> bool {
        self.own_params.contains(name)
            && !self.rebound.contains(name)
            && !self
                .scopes
                .iter()
                .skip(1)
                .any(|s| s.names.contains_key(name))
    }

    /// Own parameters `targets` rebind in the function's own scope.
    fn rebind(&mut self, targets: &[&Expr]) {
        if self.scopes.len() != 1 || self.scopes[0].class {
            return;
        }
        fn names<'e>(e: &'e Expr, out: &mut Vec<&'e str>) {
            match e {
                Expr::Name(n) => out.push(n.id.as_str()),
                Expr::Tuple(t) => t.elts.iter().for_each(|e| names(e, out)),
                Expr::List(l) => l.elts.iter().for_each(|e| names(e, out)),
                Expr::Starred(s) => names(&s.value, out),
                _ => {}
            }
        }
        let mut out = Vec::new();
        for t in targets {
            names(t, &mut out);
        }
        for n in out {
            if self.own_params.contains(n) {
                self.rebound.insert(n.to_string());
            }
        }
    }

    pub(crate) fn canon(&self, e: &Expr) -> Option<RawRef> {
        canon_with(e, &|n| self.resolve(n))
    }

    /// Walk a function: parameters (defaults are calls, annotations are types), then the body.
    pub(crate) fn function(
        &mut self,
        params: &'t ast::Parameters,
        body: &'t [Stmt],
        returns: Option<&'t Expr>,
    ) {
        self.recv_locals
            .push(receivers::local_bindings(params, body));
        self.plain_params.push(receivers::plain_params(params));
        self.function_inner(params, body, returns);
        self.plain_params.pop();
        self.recv_locals.pop();
    }

    fn function_inner(
        &mut self,
        params: &'t ast::Parameters,
        body: &'t [Stmt],
        returns: Option<&'t Expr>,
    ) {
        for p in params.iter() {
            if let Some(a) = p.annotation() {
                self.annotation(a);
            }
        }
        for p in params
            .posonlyargs
            .iter()
            .chain(&params.args)
            .chain(&params.kwonlyargs)
        {
            if let Some(d) = &p.default
                && !self.l.is_depends_call(d)
            {
                self.visit_expr(d);
            }
        }
        if let Some(r) = returns {
            self.annotation(r);
        }
        if self.frames.is_empty() {
            self.inputs
                .extend(self.l.param_inputs(params).into_iter().map(RawInput::Param));
            if self.input_params.is_none() {
                let (kinds, variadic, requests) = self.l.input_params(params);
                self.input_params = Some((kinds, variadic));
                self.request_names = requests;
            }
        }
        let ops: BTreeMap<String, RawOperand> = self.l.param_operands(params).into_iter().collect();
        for op in ops.values() {
            if let RawOperand::Header(h) = op {
                self.headers.insert(h.clone());
            }
        }
        let mut scope = Scope::default();
        parameter_names(params, &mut scope);
        if self.scopes.is_empty() {
            self.own_params = scope.names.keys().cloned().collect();
        }
        let mut globals = BTreeSet::new();
        bind_body(body, &mut scope, &mut globals);
        for g in globals {
            scope.names.remove(&g);
        }
        let own: BTreeSet<String> = {
            let mut p = Scope::default();
            parameter_names(params, &mut p);
            p.names.into_keys().collect()
        };
        // Typed parameters are read in the enclosing scope, where the type's name lives.
        let typed = self.typed_params(params);
        self.scopes.push(scope);
        self.frames.push((self.scopes.len() - 1, own));
        self.frame_params.push(FrameParams::of(params));
        self.param_ops.push(ops);
        self.param_types.push(typed);
        let check_locals = std::mem::take(&mut self.check_locals);
        let side_locals = std::mem::take(&mut self.side_locals);
        let either_locals = std::mem::take(&mut self.either_locals);
        let caller_locals = std::mem::take(&mut self.caller_locals);
        let self_locals = std::mem::take(&mut self.self_locals);
        let hmac_locals = std::mem::take(&mut self.hmac_locals);
        let log_locals = std::mem::take(&mut self.log_locals);
        let response_vars = std::mem::take(&mut self.response_vars);
        // Each function hands control on in its own body, and branches there: a
        // function defined inside another (a decorator's wrapper, a dependency a
        // factory builds) is read as a body of its own.
        let continued = std::mem::replace(&mut self.continued, false);
        let conds = std::mem::take(&mut self.conds);
        let skipped = self.skipped.take();
        let skipped_own = std::mem::replace(&mut self.skipped_own, false);
        let prior = std::mem::take(&mut self.prior);
        if std::mem::take(&mut self.uncalled) {
            self.conds
                .push((drift_core::not_always::UNDER_BRANCH, String::new()));
        }
        self.bodies.push(body);
        for s in without_docstring(body) {
            self.visit_stmt(s);
        }
        self.bodies.pop();
        self.note_held(body);
        match self.guard_paths(body) {
            guard_paths::Paths::Silent => {}
            guard_paths::Paths::RefusesAll => self.refuses_all = true,
            guard_paths::Paths::Every => self.rejects_every = true,
            guard_paths::Paths::Some => self.rejects_some = true,
        }
        self.conds = conds;
        // The symbol's own function returns early, without refusing, only for the
        // requests about the caller's own record.
        if self.frames.len() == 1 && self.skipped.is_some() && self.skipped_own {
            self.controls
                .insert(drift_core::controls::RETURNS_EARLY_FOR_OWN.into());
        }
        self.skipped = skipped;
        self.skipped_own = skipped_own;
        if self.frames.len() == 1 {
            self.body_order = self.called_before();
        }
        self.prior = prior;
        self.continued = continued;
        self.check_locals = check_locals;
        self.side_locals = side_locals;
        self.either_locals = either_locals;
        self.caller_locals = caller_locals;
        self.self_locals = self_locals;
        self.hmac_locals = hmac_locals;
        self.log_locals = log_locals;
        self.response_vars = response_vars;
        self.param_ops.pop();
        self.frame_params.pop();
        self.param_types.pop();
        self.frames.pop();
        self.scopes.pop();
    }

    /// Each parameter annotated with a class ([`type_expr`]): the class's raw reference,
    /// resolved where the annotation is written.
    fn typed_params(&self, params: &ast::Parameters) -> HashMap<String, RawRef> {
        let mut out = HashMap::new();
        for p in params.iter() {
            let Some(a) = p.annotation() else { continue };
            let Some(t) = type_expr(a) else { continue };
            // A builtin or undefined type (`str`, `int`) says nothing about practices.
            if let Some(r) = self.canon(t)
                && !matches!(r.base, RawBase::Global(_))
            {
                out.insert(p.name().as_str().to_string(), r);
            }
        }
        out
    }

    /// A method call on a value whose class the facts know: a parameter annotated with
    /// the class (`service.copy()` with `service: FolderService`), or a `self` attribute
    /// `__init__` binds from one ([`Lowerer::self_types`]). The call is the class's
    /// method (`FolderService.copy`), as a call through a sibling `self.m()` is.
    fn typed_receiver(&self, func: &Expr) -> Option<RawRef> {
        let Expr::Attribute(a) = func else {
            return None;
        };
        let ty = match a.value.as_ref() {
            Expr::Name(n) => self.param_types.last()?.get(n.id.as_str())?.clone(),
            Expr::Attribute(inner) if matches!(inner.value.as_ref(), Expr::Name(s) if s.id.as_str() == "self") => {
                self.l.self_types.get(inner.attr.as_str())?.clone()
            }
            _ => return None,
        };
        let mut r = ty;
        if r.member.matches('.').count() >= MAX_MEMBER_DEPTH {
            return None;
        }
        r.member.push('.');
        r.member.push_str(a.attr.as_str());
        Some(r)
    }

    /// Walk a type expression: only `Any` matters (and `Depends` inside `Annotated` is a dependency).
    pub(crate) fn annotation(&mut self, e: &'t Expr) {
        let prev = self.in_annotation;
        self.in_annotation = true;
        self.visit_expr(e);
        self.in_annotation = prev;
    }

    /// Walk a class body: class-level statements in a class scope, methods as functions.
    pub(crate) fn class_body(&mut self, body: &'t [Stmt]) {
        let mut scope = Scope {
            class: true,
            ..Scope::default()
        };
        let mut globals = BTreeSet::new();
        bind_body(body, &mut scope, &mut globals);
        let logs = self.class_loggers(body);
        self.self_logs.push(logs);
        self.scopes.push(scope);
        // The class's own scope (not a nested `class Meta`): record what each statement
        // binds, so that a subclass reassigning an attribute does not inherit its calls.
        let own = self.scopes.len() == 1;
        for s in without_docstring(body) {
            if own {
                self.class_attrs = class_stmt_names(s);
                for a in &self.class_attrs {
                    self.declares.insert((a.clone(), None));
                }
            }
            self.visit_stmt(s);
            if own {
                self.class_attrs.clear();
            }
        }
        self.scopes.pop();
        self.self_logs.pop();
    }

    /// A rejection here would turn the caller away: outside any `except` handler, and
    /// before the function has handed control on.
    fn counting(&self) -> bool {
        self.in_except == 0 && !self.continued
    }

    fn note(&mut self, r: Option<drift_core::controls::Rejection>) {
        use drift_core::controls::Rejection;
        match r {
            Some(Rejection::Unauthenticated) => self.unauthenticated = true,
            Some(Rejection::Forbidden) => self.forbidden = true,
            Some(Rejection::Throttled) | None => {}
        }
    }

    /// What a raised or returned expression says it rejects the caller as: an error or
    /// response built with 401, 403 or rejection words
    /// (`HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)`,
    /// `JsonResponse(body, status=403)`), or a local bound to one. A bare literal is not.
    fn rejecting(&self, e: &Expr) -> Option<drift_core::controls::Rejection> {
        match e {
            Expr::Call(_) => rejection_marker(e, 0),
            Expr::Name(n) => self.rejection_vars.get(n.id.as_str()).copied(),
            _ => None,
        }
    }

    /// A call that turns the caller away by itself, where it counts: `abort(401)`, a
    /// redirect to a sign-in page (`redirect(url_for("auth.login"))`), or a helper named
    /// for it (`redirect_to_login(...)`, `HttpResponseForbidden()`,
    /// `login_manager.unauthorized()`). Rejection words in any other call's arguments
    /// (`logger.warning("Unauthorized ...")`) say nothing.
    fn note_rejection(&mut self, c: &ast::ExprCall) {
        if !self.counting() {
            return;
        }
        let r = call_rejection(c);
        self.rejects_otherwise |= r.is_some();
        self.note(r);
    }

    /// What the body walked does in its `except` handlers, as a control fact:
    /// [`drift_core::controls::HANDLER_REJECTS`] where it is proven to turn away a
    /// caller who is not signed in, else [`drift_core::controls::HANDLER_MAY_REJECT`]
    /// where a handler says so, or says "not allowed" in a body that reads a subject.
    fn handler_control(&self) -> Option<&'static str> {
        if self.handler_rejects {
            Some(drift_core::controls::HANDLER_REJECTS)
        } else if self.handler_may_reject || (self.handler_forbidden && self.reads_subject) {
            Some(drift_core::controls::HANDLER_MAY_REJECT)
        } else {
            None
        }
    }

    /// What the last statement of an `except` handler does with the request
    /// ([`HandlerExit`]).
    fn handler_exit(&self, body: &[Stmt]) -> HandlerExit {
        use drift_core::controls::Rejection;
        let Some(last) = body.last() else {
            return HandlerExit::GoesOn;
        };
        if self.turns_away(last) == Some(Rejection::Unauthenticated) {
            return HandlerExit::SignIn;
        }
        match last {
            Stmt::Raise(_) => HandlerExit::Refuses,
            Stmt::Return(_) if self.refuses(last) => HandlerExit::Refuses,
            Stmt::Expr(x) => match x.value.as_ref() {
                Expr::Call(c) if last_name(&c.func) == Some("abort") => HandlerExit::Refuses,
                _ => HandlerExit::GoesOn,
            },
            _ => HandlerExit::GoesOn,
        }
    }

    /// What the statement turns the caller away as, where it says: it raises or
    /// returns an error or response that does ([`Collector::rejecting`]), or is a
    /// call that does by itself ([`call_rejection`]: `abort(401)`, a sign-in
    /// redirect).
    fn turns_away(&self, s: &Stmt) -> Option<drift_core::controls::Rejection> {
        let of = |e: &Expr| {
            self.rejecting(e).or_else(|| match e {
                Expr::Call(c) => call_rejection(c),
                _ => None,
            })
        };
        match s {
            Stmt::Raise(r) => r.exc.as_deref().and_then(of),
            Stmt::Return(r) => r.value.as_deref().and_then(of),
            Stmt::Expr(x) => match x.value.as_ref() {
                Expr::Call(c) => call_rejection(c),
                _ => None,
            },
            _ => None,
        }
    }

    /// A `try` of a function's body, once its body is walked, whose handlers answer
    /// "not signed in": proof of a guard
    /// ([`drift_core::controls::HANDLER_REJECTS`]) where every request reaches the
    /// `try` (`every`), its body returns under no branch, every handler ends by
    /// refusing and one of them says so; otherwise something that may be one
    /// ([`drift_core::controls::HANDLER_MAY_REJECT`]). Nothing for a `try` whose
    /// body handed control on: its handlers answer for what the continuation raised.
    fn note_handler_rejection(&mut self, t: &ast::StmtTry, every: bool) {
        let bodies = || {
            t.handlers.iter().map(|h| {
                let ast::ExceptHandler::ExceptHandler(h) = h;
                h.body.as_slice()
            })
        };
        use drift_core::controls::Rejection::{Forbidden, Unauthenticated};
        let says = |r| bodies().any(|b| any_stmt(b, &|s| self.turns_away(s) == Some(r)));
        if !says(Unauthenticated) {
            self.handler_forbidden |= says(Forbidden);
            return;
        }
        let exits: Vec<HandlerExit> = bodies().map(|b| self.handler_exit(b)).collect();
        let returns_under_branch = t.body.iter().any(|s| match s {
            Stmt::Return(_) => false,
            s => any_stmt(std::slice::from_ref(s), &|s| matches!(s, Stmt::Return(_))),
        });
        if every
            && !returns_under_branch
            && exits.contains(&HandlerExit::SignIn)
            && !exits.contains(&HandlerExit::GoesOn)
        {
            self.handler_rejects = true;
            self.proven_tries.insert(t.range().start());
        } else {
            self.handler_may_reject = true;
        }
    }

    /// Why the node being walked does not run for every request that reaches the
    /// current function's body, if it does not: the outermost enclosing condition,
    /// else that the body has returned for some requests.
    pub(crate) fn not_always(&self) -> Option<(&'static str, String)> {
        self.conds.first().cloned().or_else(|| {
            self.skipped
                .clone()
                .map(|w| (drift_core::not_always::AFTER_CONDITIONAL_RETURN, w))
        })
    }

    /// The current function's body calls `c` here ([`Collector::prior`]).
    pub(crate) fn note_prior(&mut self, c: crate::raw::RawReceiverCall) {
        if !self.frames.is_empty() && !self.prior.contains(&c) {
            self.prior.push(c);
        }
    }

    /// What the current function's body called before the node being walked, as
    /// [`drift_core::BodyCheck::after`] holds it: at most
    /// [`drift_core::practice::caps::CHECK_AFTER`], then [`drift_core::AFTER_MORE`].
    pub(crate) fn called_before(&self) -> Vec<crate::raw::RawReceiverCall> {
        let cap = drift_core::practice::caps::CHECK_AFTER;
        let mut out: Vec<crate::raw::RawReceiverCall> =
            self.prior.iter().take(cap).cloned().collect();
        if self.prior.len() > cap {
            out.push(crate::raw::RawReceiverCall::Unread(
                drift_core::AFTER_MORE.to_string(),
            ));
        }
        out
    }

    /// The callee is called here: on every path, or only conditionally
    /// ([`drift_core::Symbol::conditional_calls`]).
    pub(crate) fn note_dominance(&mut self, r: &RawRef) {
        if self.frames.is_empty() {
            return;
        }
        self.note_prior(crate::raw::RawReceiverCall::Ref(r.clone()));
        // On every path and its value dropped: conditional where the callee is an
        // `async def`, which the linker knows.
        let unawaited = if self.call_dropped {
            drift_core::not_always::NOT_AWAITED
        } else {
            ""
        };
        let why = self.not_always().map_or(unawaited, |(why, _)| why);
        self.conditional_calls.insert((r.clone(), why.to_string()));
    }

    /// The statement turns the caller away: a `raise`, or a `return` of an error
    /// response.
    pub(crate) fn refuses(&self, s: &Stmt) -> bool {
        match s {
            Stmt::Raise(_) => true,
            Stmt::Return(r) => r.value.as_deref().is_some_and(|e| {
                self.returned_outcome(e).is_some()
                    || self.response_of(e, false).is_some_and(|r| r.status >= 400)
            }),
            _ => false,
        }
    }

    /// Notes that what follows is skipped for some requests (`skips`: for which, in
    /// the code's words), and whether those are the requests about the caller's own
    /// record. The first skip is what the checks that follow say; every one counts
    /// for whose requests they are.
    fn note_skip(&mut self, skips: Option<String>, own: bool) {
        let Some(words) = skips else { return };
        match self.skipped {
            None => {
                self.skipped = Some(words);
                self.skipped_own = own;
            }
            Some(_) => self.skipped_own &= own,
        }
    }

    /// The test holds exactly where what the request is about is the caller's own
    /// record: one side of `==` or `is` is the caller itself or the key of the
    /// caller's record ([`Collector::caller_self`]), the other is not (`user ==
    /// current_user`, `user_id == request.user.id`).
    fn own_test(&self, test: &Expr) -> bool {
        let Expr::Compare(c) = test else {
            return false;
        };
        let ([ast::CmpOp::Eq | ast::CmpOp::Is], [left, right]) = (&*c.ops, &*c.operands) else {
            return false;
        };
        self.caller_self(left) != self.caller_self(right)
    }

    /// The first exit of the block is a `return` that does not turn the caller away:
    /// the requests that take it are served without what follows the block.
    fn returns_without_refusing(&self, body: &[Stmt]) -> bool {
        body.iter()
            .find(|s| matches!(s, Stmt::Return(_) | Stmt::Raise(_)))
            .is_some_and(|s| !self.refuses(s))
    }

    fn record_call(&mut self, c: &'t ast::ExprCall) {
        self.call_dropped = self.dropped.contains(&c.range().start());
        self.note_kept(c);
        self.note_rejection(c);
        if last_name(&c.func).is_some_and(|n| SHAPED_CALLS.contains(&n))
            && let Some(r) = self.canon(&c.func)
        {
            self.call_shapes.insert((r, adapters::args_shape(c)));
        }
        // The call is handed a value of the caller: what the callee does with it
        // may be the scope ([`drift_core::Symbol::caller_args`]).
        let caller: Vec<Option<RawDep>> = if self.frames.is_empty() {
            vec![]
        } else {
            // And what a dict, list, tuple or set written in place holds
            // (`db.execute(sql, {"lab": user.lab_id})`).
            let mut given = c
                .arguments
                .args
                .iter()
                .chain(c.arguments.keywords.iter().map(|k| &k.value))
                .flat_map(|a| {
                    let held: Vec<&Expr> = match a {
                        Expr::Dict(d) => d.items.iter().map(|i| &i.value).collect(),
                        Expr::List(l) => l.elts.iter().collect(),
                        Expr::Tuple(t) => t.elts.iter().collect(),
                        Expr::Set(x) => x.elts.iter().collect(),
                        _ => Vec::new(),
                    };
                    std::iter::once(a).chain(held)
                });
            // [STRICT] A keyword argument read off what a holder keeps
            // (`Award.get_or_none(funder_id=g.reviewer.funder_id)`): a filter through
            // an API no fact reads may be the caller's scope, whoever put the value
            // there ([`drift_core::controls::SCOPE_UNREAD`]).
            if c.arguments.keywords.iter().any(|k| {
                k.arg.is_some()
                    && matches!(k.value, Expr::Attribute(_) | Expr::Subscript(_))
                    && matches!(self.caller_value(&k.value), Some(Some(RawDep::Gives(_))))
            }) {
                self.controls
                    .insert(drift_core::controls::SCOPE_UNREAD.into());
            }
            // And a value of one of the body's own parameters
            // ([`drift_core::controls::PARAM_FLOWS`]).
            if given.clone().any(|a| self.param_value(a)) {
                self.controls
                    .insert(drift_core::controls::PARAM_FLOWS.into());
            }
            given
                .by_ref()
                .filter_map(|a| self.caller_value(a))
                .collect()
        };
        if !caller.is_empty() {
            self.note_scope_sql_call(c);
        }
        if self.input_params.is_some() && self.hands_request_on(c) {
            self.input_escapes = true;
        }
        let (read, since) = (self.l.call_sinks(self, c), self.l.call_sinks_since(self, c));
        // An operation given a value read off a parameter of the function or off
        // what the request sent ([`drift_core::controls::SINK_FED`]).
        if c.arguments
            .args
            .iter()
            .chain(c.arguments.keywords.iter().map(|k| &k.value))
            .any(|a| self.input_reaches(a, 0))
        {
            self.fed_sinks
                .extend(read.iter().chain(&since).map(|k| k.to_string()));
            // And handed on to what is called ([`drift_core::controls::PASSES_PARAM`]).
            if let Some(r) = self.canon(&c.func) {
                self.param_passes.insert(r);
            }
        }
        for s in read {
            self.sinks.insert(s.to_string());
        }
        for s in since {
            self.since_sinks.insert(s.to_string());
        }
        if self.l.is_validation_call(self, c) {
            self.controls.insert("validates".into());
        }
        if let Some(var) = self.l.env_read_call(self, c) {
            self.reads.insert(var);
        }
        if !self.frames.is_empty() || self.scopes.is_empty() {
            if let Some(l) = self.log_call(c) {
                self.log_calls.insert(l);
            }
            if let Some(h) = self.header_read_call(c) {
                self.headers.insert(h);
            }
            if let Some(i) = self.validated_input(c) {
                self.inputs.insert(RawInput::Validated(i));
            }
            if !self.frames.is_empty() {
                // Filtered only for the requests that reach the call
                // ([`drift_core::ScopedQuery::condition`]).
                let condition = self.not_always().map(|(why, _)| why).unwrap_or_default();
                for (mut q, value) in self.scoped_queries(c) {
                    self.filter_values.insert(RawFilterValue {
                        callee: q.callee.clone(),
                        key: q.key.clone(),
                        value,
                    });
                    q.condition = condition.to_string();
                    self.scoped.insert(q);
                }
            }
            let abort = matches!(c.func.as_ref(), Expr::Name(n) if n.id.as_str() == "abort")
                || matches!(c.func.as_ref(), Expr::Attribute(a) if a.attr.as_str() == "abort");
            if abort
                && let Some(r) =
                    self.l
                        .response_call(c, self.canon(&c.func), false, self.in_except > 0)
            {
                self.responses.insert(r);
            }
        }
        self.note_super(c);
        if let Some(r) = self.canon(&c.func) {
            for k in &c.arguments.keywords {
                if let Some(a) = &k.arg {
                    self.args
                        .insert((r.clone(), KWARG_INDEX, a.as_str().to_string()));
                } else {
                    // `f(**opts)`: may pass any key ([`SPLAT_KEY`]).
                    self.args
                        .insert((r.clone(), KWARG_INDEX, drift_core::SPLAT_KEY.into()));
                }
            }
            if c.arguments
                .args
                .iter()
                .any(|a| matches!(a, Expr::Starred(_)))
            {
                self.args
                    .insert((r.clone(), KWARG_INDEX, drift_core::SPLAT_KEY.into()));
            }
            // What the call is about: its first positional argument, or `*args` /
            // `**kwargs` (not an optional keyword such as `timeout=timeout`).
            let own = |e: &Expr| matches!(e, Expr::Name(n) if self.own_param(n.id.as_str()));
            let first = c
                .arguments
                .args
                .first()
                .is_some_and(|a| !matches!(a, Expr::Starred(_)) && own(a));
            let star = c
                .arguments
                .args
                .iter()
                .any(|a| matches!(a, Expr::Starred(s) if own(&s.value)));
            let double_star = c
                .arguments
                .keywords
                .iter()
                .any(|k| k.arg.is_none() && own(&k.value));
            if first || star || double_star {
                self.forwards.insert(r.clone());
            }
            // A call that unpacks `**kwargs` may pass any key: it leaves none out.
            if c.arguments.keywords.iter().all(|k| k.arg.is_some()) {
                let (calls, keys) = self.keyed_calls.entry(r.clone()).or_default();
                *calls += 1;
                for k in &c.arguments.keywords {
                    if let Some(a) = &k.arg {
                        *keys.entry(a.as_str().to_string()).or_default() += 1;
                    }
                }
            }
            if !self.order.contains(&r) && self.order.len() < MAX_ORDER {
                self.order.push(r.clone());
            }
            // What comes after the continuation, or takes its result, acts on what the
            // continuation handed back (`map_errors(f(*args, **kwargs))`).
            if self.continued || self.call_mentions_continuation(c) {
                self.after_calls.insert(r.clone());
            } else {
                self.before_calls.insert(r.clone());
            }
            if !self.scopes.is_empty() && self.scopes.iter().all(|s| s.class) {
                if self.class_attrs.is_empty() {
                    self.declares.insert((String::new(), Some(r.clone())));
                }
                for a in &self.class_attrs {
                    self.declares.insert((a.clone(), Some(r.clone())));
                }
            }
            self.note_dominance(&r);
            if !matches!(r.base, RawBase::Global(_)) {
                self.caller_args
                    .extend(caller.into_iter().map(|d| (r.clone(), d)));
                self.note_arg_sides(&r, c);
            }
            self.calls.insert(r);
        } else if let Some(r) = self.typed_receiver(&c.func) {
            self.note_dominance(&r);
            self.note_arg_sides(&r, c);
            self.caller_args
                .extend(caller.into_iter().map(|d| (r.clone(), d)));
            if !self.order.contains(&r) && self.order.len() < MAX_ORDER {
                self.order.push(r.clone());
            }
            if self.continued || self.call_mentions_continuation(c) {
                self.after_calls.insert(r.clone());
            } else {
                self.before_calls.insert(r.clone());
            }
            self.calls.insert(r);
        } else if !self.frames.is_empty() {
            // A method of a local or of a parameter no annotation types: the call is
            // not in `calls`. It is recorded by what its receiver is, where the body
            // says so ([`receivers`]).
            self.note_receiver_call(c);
            if matches!(
                c.func.as_ref(),
                Expr::Subscript(_) | Expr::Call(_) | Expr::If(_) | Expr::BoolOp(_) | Expr::Named(_)
            ) {
                self.controls
                    .insert(drift_core::controls::CALLS_UNNAMED.into());
            }
            if !caller.is_empty()
                && let receivers::Recv::Ref(r, _, _) = self.receiver(&c.func, 0)
                && !matches!(r.base, RawBase::Global(_))
            {
                self.caller_args
                    .extend(caller.into_iter().map(|d| (r.clone(), d)));
            }
            if hands_value_on(c) {
                // What it does with the value was not read.
                self.controls
                    .insert(drift_core::controls::UNREAD_CALL.into());
            }
        }
    }
}

/// The call is given a value: not nothing, a literal, or a callback written in place
/// (`exporter.run(user_id)`, `rows.append(row)`; not `rows.all()`, `d.get("k")`,
/// `xs.pop(-1)` or `rows.sort(key=lambda r: r.created)`, whose callback is read where
/// it is). As the TypeScript lowering reads it ([`drift_core::controls::UNREAD_CALL`]).
fn hands_value_on(c: &ast::ExprCall) -> bool {
    fn literal(e: &Expr) -> bool {
        match e {
            Expr::StringLiteral(_)
            | Expr::BytesLiteral(_)
            | Expr::NumberLiteral(_)
            | Expr::BooleanLiteral(_)
            | Expr::NoneLiteral(_)
            | Expr::EllipsisLiteral(_)
            | Expr::Lambda(_) => true,
            // A signed number (`-1`, `+2`).
            Expr::UnaryOp(u) => matches!(u.operand.as_ref(), Expr::NumberLiteral(_)),
            _ => false,
        }
    }
    c.arguments.args.iter().any(|a| !literal(a))
        || c.arguments.keywords.iter().any(|k| !literal(&k.value))
}

/// The class a parameter annotation names: `T`, `pkg.T`, `Annotated[T, ...]`,
/// `Optional[T]`, `T | None`. None for anything else (a union of two classes, a
/// literal, a generic): what such a value is cannot be told.
pub(crate) fn type_expr(e: &Expr) -> Option<&Expr> {
    match e {
        Expr::Name(_) | Expr::Attribute(_) => Some(e),
        Expr::Subscript(s) => {
            let head = match s.value.as_ref() {
                Expr::Name(n) => n.id.as_str(),
                Expr::Attribute(a) => a.attr.as_str(),
                _ => return None,
            };
            if !matches!(head, "Annotated" | "Optional") {
                return None;
            }
            match s.slice.as_ref() {
                Expr::Tuple(t) => t.elts.first().and_then(type_expr),
                other => type_expr(other),
            }
        }
        Expr::BinOp(b) if matches!(b.op, ast::Operator::BitOr) => {
            let is_none = |x: &Expr| matches!(x, Expr::NoneLiteral(_));
            if is_none(&b.right) {
                type_expr(&b.left)
            } else if is_none(&b.left) {
                type_expr(&b.right)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// The last name of a callee: `suppress`, `contextlib.suppress`.
fn last_name(e: &Expr) -> Option<&str> {
    match e {
        Expr::Name(n) => Some(n.id.as_str()),
        Expr::Attribute(a) => Some(a.attr.as_str()),
        _ => None,
    }
}

/// The callee hands a coroutine to the event loop to run later
/// (`asyncio.create_task`, `asyncio.ensure_future`, `loop.create_task`, a task
/// group's `start_soon`).
fn schedules(callee: &Expr) -> bool {
    matches!(
        last_name(callee),
        Some("create_task" | "ensure_future" | "run_coroutine_threadsafe" | "start_soon")
    )
}

impl Collector<'_, '_> {
    /// Notes what held where the function whose body this is hands a request on,
    /// lets one through or answers true for one ([`held`]). Of a function defined
    /// in another: where it calls what the outer one was given (a decorator's
    /// wrapper). Of the symbol's own function: where it returns without a refusal
    /// when it refuses somewhere, and where it may answer true when it answers
    /// `False` somewhere. Said only where some site has something that held: a
    /// body that tests nothing says nothing.
    fn note_held(&mut self, body: &[Stmt]) {
        let own = self.frames.len() == 1;
        let handed: BTreeSet<String> = match self.frames.split_last() {
            Some(((_, mine), outer)) if !outer.is_empty() => outer
                .iter()
                .flat_map(|(_, names)| names)
                .filter(|n| !mine.contains(*n))
                .cloned()
                .collect(),
            _ => BTreeSet::new(),
        };
        if !own && handed.is_empty() {
            return;
        }
        let sites = self.held_sites(body, &handed);
        let said = |sites: &BTreeSet<Vec<RawRef>>| sites.iter().any(|s| !s.is_empty());
        if said(&sites.handed) {
            self.held
                .extend(sites.handed.into_iter().map(|s| (RawHeld::Handed, s)));
        }
        if !own {
            return;
        }
        if sites.answers_false && said(&sites.truthy) {
            self.held
                .extend(sites.truthy.into_iter().map(|s| (RawHeld::True, s)));
        }
        if said(&sites.leaves) && !matches!(self.guard_paths(body), guard_paths::Paths::Silent) {
            self.held
                .extend(sites.leaves.into_iter().map(|s| (RawHeld::Leaves, s)));
        }
    }

    /// The value of `e` is read off a parameter of the function, off what the
    /// request sent ([`Collector::side`]), or off a local bound to one, or holds
    /// one: a member or an item of it, text built from it, what a method of it or a
    /// call given it hands back, a collection that holds it. Followed as written,
    /// whatever the names are.
    fn input_reaches(&self, e: &Expr, depth: usize) -> bool {
        if depth > 6 {
            return false;
        }
        let any = |es: &mut dyn Iterator<Item = &Expr>| {
            let mut found = false;
            for x in es {
                found |= self.input_reaches(x, depth + 1);
            }
            found
        };
        match e {
            Expr::Name(_) | Expr::Attribute(_) | Expr::Subscript(_) => {
                let mut root = e;
                while let Expr::Attribute(ast::ExprAttribute { value, .. })
                | Expr::Subscript(ast::ExprSubscript { value, .. }) = root
                {
                    root = value;
                }
                match root {
                    Expr::Name(n) if self.fed_locals.contains(n.id.as_str()) => true,
                    Expr::Call(_) => self.input_reaches(root, depth + 1),
                    _ => {
                        self.param_value(e)
                            || matches!(self.side(e), RawSide::Request | RawSide::Param(..))
                    }
                }
            }
            Expr::FString(f) => f.value.iter().any(|part| match part {
                ast::FStringPartRef::Literal(_) => false,
                ast::FStringPartRef::FString(fs) => fs.elements.iter().any(|el| match el {
                    ast::InterpolatedStringElement::Literal(_) => false,
                    ast::InterpolatedStringElement::Interpolation(i) => {
                        self.input_reaches(&i.expression, depth + 1)
                    }
                }),
            }),
            Expr::BinOp(b) => any(&mut [b.left.as_ref(), b.right.as_ref()].into_iter()),
            Expr::Await(a) => self.input_reaches(&a.value, depth + 1),
            Expr::Starred(s) => self.input_reaches(&s.value, depth + 1),
            Expr::Call(c) => {
                matches!(c.func.as_ref(), Expr::Attribute(a) if self.input_reaches(&a.value, depth + 1))
                    || any(&mut c
                        .arguments
                        .args
                        .iter()
                        .chain(c.arguments.keywords.iter().map(|k| &k.value)))
            }
            Expr::Dict(d) => any(&mut d.items.iter().map(|i| &i.value)),
            Expr::List(l) => any(&mut l.elts.iter()),
            Expr::Tuple(t) => any(&mut t.elts.iter()),
            _ => false,
        }
    }

    /// Notes a name the statement binds to a value read off a parameter or off
    /// what the request sent ([`Collector::input_reaches`]), in the order written;
    /// a name bound to anything else afterwards is one no longer.
    fn note_fed_binding(&mut self, stmt: &Stmt) {
        let (target, value, added) = match stmt {
            Stmt::Assign(a) => match a.targets.as_slice() {
                [Expr::Name(n)] => (n.id.as_str(), a.value.as_ref(), false),
                _ => return,
            },
            Stmt::AnnAssign(a) => match (a.target.as_ref(), a.value.as_deref()) {
                (Expr::Name(n), Some(v)) => (n.id.as_str(), v, false),
                _ => return,
            },
            Stmt::AugAssign(a) => match a.target.as_ref() {
                Expr::Name(n) => (n.id.as_str(), a.value.as_ref(), true),
                _ => return,
            },
            _ => return,
        };
        if self.input_reaches(value, 0) {
            self.fed_locals.insert(target.to_string());
        } else if !added {
            self.fed_locals.remove(target);
        }
    }

    /// Notes a name the statement binds to SQL text, and one it binds to SQL text
    /// built from a part that is no literal: `q = f"SELECT ... '{name}'"`, `q =
    /// "SELECT ..." + name`, `q += f" AND owner = '{owner}'"` on a name that holds
    /// SQL. A query given such a name is given the interpolation
    /// ([`RawSymbol::since_sinks`]). By name, in the order written: the body of one
    /// symbol is one set of names.
    fn note_sql_binding(&mut self, stmt: &Stmt) {
        let (target, value, added) = match stmt {
            Stmt::Assign(a) => match a.targets.as_slice() {
                [Expr::Name(n)] => (n.id.as_str(), a.value.as_ref(), false),
                _ => return,
            },
            Stmt::AnnAssign(a) => match (a.target.as_ref(), a.value.as_deref()) {
                (Expr::Name(n), Some(v)) => (n.id.as_str(), v, false),
                _ => return,
            },
            Stmt::AugAssign(a) if matches!(a.op, ast::Operator::Add) => match a.target.as_ref() {
                Expr::Name(n) => (n.id.as_str(), a.value.as_ref(), true),
                _ => return,
            },
            _ => return,
        };
        let holds_sql = self.sql_text.contains(target) || self.sql_built.contains(target);
        let built = match value {
            // SQL built from built SQL is built.
            Expr::Name(v) => self.sql_built.contains(v.id.as_str()) && (!added || holds_sql),
            Expr::BinOp(b)
                if matches!(b.op, ast::Operator::Add)
                    && [b.left.as_ref(), b.right.as_ref()].iter().any(
                        |x| matches!(x, Expr::Name(v) if self.sql_built.contains(v.id.as_str())),
                    ) =>
            {
                true
            }
            v if added => holds_sql && signals::interpolates(v),
            v => signals::interpolated_sql(v) || signals::concatenated_sql(v),
        };
        if built {
            self.sql_built.insert(target.to_string());
        } else if signals::sql_text(value) {
            self.sql_text.insert(target.to_string());
        }
    }
}

impl<'a> Visitor<'a> for Collector<'_, 'a> {
    fn visit_stmt(&mut self, stmt: &'a Stmt) {
        self.note_fed_binding(stmt);
        self.note_sql_binding(stmt);
        self.note_rows(stmt);
        if Lowerer::secret_binding(stmt) {
            self.since_sinks.insert(signals::kind::SECRET.to_string());
        }
        // A call that is a statement of its own, or bound to a name the body never
        // reads (`checked = verify_access(rule, caller)`): its value is dropped.
        let dropped = match stmt {
            Stmt::Expr(x) => match x.value.as_ref() {
                Expr::Call(c) => Some(c),
                _ => None,
            },
            Stmt::Assign(a) => match (a.targets.as_slice(), a.value.as_ref()) {
                ([Expr::Name(n)], Expr::Call(c))
                    if self.bodies.last().is_some_and(|b| !reads(b, n.id.as_str())) =>
                {
                    Some(c)
                }
                _ => None,
            },
            _ => None,
        };
        if let Some(c) = dropped {
            self.dropped.insert(c.range().start());
            // A coroutine handed to the event loop and not awaited
            // (`asyncio.create_task(check(rule, caller))`) runs when the loop gets to
            // it: what it refuses stops nothing here.
            if schedules(&c.func) {
                for a in &c.arguments.args {
                    if let Expr::Call(inner) = a {
                        self.dropped.insert(inner.range().start());
                    }
                }
            }
        }
        // `with suppress(HTTPException):` drops what its body refuses with, as a
        // `try` whose handler serves the request all the same.
        let suppressed = !self.frames.is_empty()
            && matches!(stmt, Stmt::With(w) if w.items.iter().any(|i| {
                matches!(&i.context_expr, Expr::Call(c) if last_name(&c.func) == Some("suppress"))
            }));
        if suppressed {
            self.conds
                .push((drift_core::not_always::SWALLOWED, String::new()));
        }
        // Loop and `with` targets are bound before their body runs.
        match stmt {
            Stmt::For(f) => self.rebind(&[&f.target]),
            Stmt::With(w) => {
                let t: Vec<&Expr> = w
                    .items
                    .iter()
                    .filter_map(|i| i.optional_vars.as_deref())
                    .collect();
                self.rebind(&t);
            }
            _ => {}
        }
        self.visit_stmt_inner(stmt);
        if suppressed {
            self.conds.pop();
        }
        // An assignment binds once its value is evaluated.
        match stmt {
            Stmt::Assign(a) => {
                let t: Vec<&Expr> = a.targets.iter().collect();
                self.rebind(&t);
            }
            Stmt::AugAssign(a) => self.rebind(&[&a.target]),
            Stmt::AnnAssign(a) if a.value.is_some() => self.rebind(&[&a.target]),
            // What follows a `return` or a `raise` every request reaches never runs.
            Stmt::Return(_) | Stmt::Raise(_)
                if self.conds.is_empty() && !self.frames.is_empty() && self.skipped.is_none() =>
            {
                self.skipped = Some(String::new());
            }
            _ => {}
        }
    }

    fn visit_annotation(&mut self, expr: &'a Expr) {
        self.annotation(expr);
    }

    fn visit_except_handler(&mut self, h: &'a ast::ExceptHandler) {
        let ast::ExceptHandler::ExceptHandler(eh) = h;
        if !self.in_annotation && !self.frames.is_empty() {
            let fact = self.catch_fact(eh);
            self.catches.insert(fact);
        }
        let bound = eh.name.as_ref().map(|n| n.as_str().to_string());
        if let Some(n) = &bound {
            self.except_names.push(n.clone());
        }
        self.in_except += 1;
        visitor::walk_except_handler(self, h);
        self.in_except -= 1;
        if bound.is_some() {
            self.except_names.pop();
        }
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        match e {
            Expr::Call(c) => {
                if !self.in_annotation {
                    self.record_call(c);
                }
                let method = std::mem::replace(
                    &mut self.method_end,
                    matches!(c.func.as_ref(), Expr::Attribute(_)).then(|| c.func.range().end()),
                );
                visitor::walk_expr(self, e);
                self.method_end = method;
                if !self.in_annotation && self.continues(c) {
                    self.continued = true;
                }
            }
            // A dependency's `yield` hands the value on to the endpoint: what follows is
            // teardown, run after the response, never a check on the caller.
            Expr::Yield(_) | Expr::YieldFrom(_) => {
                visitor::walk_expr(self, e);
                if !self.in_annotation {
                    self.continued = true;
                }
            }
            Expr::Await(_) => {
                self.controls.insert("await".into());
                visitor::walk_expr(self, e);
            }
            Expr::Subscript(s) => {
                if !self.in_annotation
                    && let Some(var) = self.l.env_read_subscript(self, s)
                {
                    self.reads.insert(var);
                }
                if !self.in_annotation
                    && let Some(h) = self.header_read(e)
                {
                    self.headers.insert(h);
                }
                visitor::walk_expr(self, e);
            }
            Expr::Name(n) => {
                if drift_core::controls::names_subject(n.id.as_str()) {
                    self.reads_subject = true;
                }
                if let Some(r) = self.resolve(n.id.as_str())
                    && let Some(d) = dotted(&RawRef {
                        base: r,
                        member: String::new(),
                    })
                    && matches!(d.as_str(), "typing.Any" | "typing_extensions.Any")
                {
                    self.controls.insert("uses_any".into());
                }
            }
            Expr::Compare(c) => {
                self.note_scope_compare(c);
                visitor::walk_expr(self, e);
            }
            Expr::Attribute(a) => {
                self.note_scope_path(a);
                if drift_core::controls::names_subject(a.attr.as_str()) {
                    self.reads_subject = true;
                }
                if self.input_params.is_some() && self.reads_request_input(a) {
                    self.input_reads = true;
                }
                if a.attr.as_str() == "Any"
                    && let Some(r) = self.canon(e)
                    && matches!(
                        dotted(&r).as_deref(),
                        Some("typing.Any" | "typing_extensions.Any")
                    )
                {
                    self.controls.insert("uses_any".into());
                }
                visitor::walk_expr(self, e);
            }
            Expr::Lambda(lam) => {
                let mut scope = Scope::default();
                if let Some(p) = &lam.parameters {
                    for d in p
                        .iter_non_variadic_params()
                        .filter_map(|x| x.default.as_deref())
                    {
                        self.visit_expr(d);
                    }
                    parameter_names(p, &mut scope);
                }
                self.scopes.push(scope);
                // What a `lambda` calls runs where the lambda is called, if it is.
                let inside = !self.frames.is_empty();
                if inside {
                    self.conds
                        .push((drift_core::not_always::UNDER_BRANCH, String::new()));
                }
                self.visit_expr(&lam.body);
                if inside {
                    self.conds.pop();
                }
                self.scopes.pop();
            }
            Expr::ListComp(_) | Expr::SetComp(_) | Expr::DictComp(_) | Expr::Generator(_) => {
                let generators: &[ast::Comprehension] = match e {
                    Expr::ListComp(x) => &x.generators,
                    Expr::SetComp(x) => &x.generators,
                    Expr::DictComp(x) => &x.generators,
                    Expr::Generator(x) => &x.generators,
                    _ => unreachable!(),
                };
                let mut scope = Scope::default();
                for g in generators {
                    bind_target(&g.target, &mut scope);
                }
                // The first iterable is evaluated in the enclosing scope.
                if let Some(first) = generators.first() {
                    self.visit_expr(&first.iter);
                }
                self.scopes.push(scope);
                self.conds
                    .push((drift_core::not_always::UNDER_BRANCH, String::new()));
                for (i, g) in generators.iter().enumerate() {
                    if i > 0 {
                        self.visit_expr(&g.iter);
                    }
                    for cond in &g.ifs {
                        self.visit_expr(cond);
                    }
                }
                match e {
                    Expr::ListComp(x) => self.visit_expr(&x.elt),
                    Expr::SetComp(x) => self.visit_expr(&x.elt),
                    Expr::Generator(x) => self.visit_expr(&x.elt),
                    Expr::DictComp(x) => {
                        if let Some(k) = &x.key {
                            self.visit_expr(k);
                        }
                        self.visit_expr(&x.value);
                    }
                    _ => {}
                }
                self.conds.pop();
                self.scopes.pop();
            }
            // The right side of `and` / `or` runs only where the left side lets it.
            Expr::BoolOp(b) if !self.in_annotation && !self.frames.is_empty() => {
                use drift_core::not_always::{AND_OPERAND, BYPASS_OPERAND};
                let mut values = b.values.iter();
                let Some(first) = values.next() else { return };
                self.visit_expr(first);
                let left = practice::words(first);
                let cond = match b.op {
                    ast::BoolOp::And => (AND_OPERAND, format!("only when {left}")),
                    ast::BoolOp::Or => (BYPASS_OPERAND, format!("not when {left}")),
                };
                self.conds.push(cond);
                for v in values {
                    self.visit_expr(v);
                }
                self.conds.pop();
            }
            Expr::If(i) if !self.in_annotation && !self.frames.is_empty() => {
                self.visit_expr(&i.test);
                self.conds
                    .push((drift_core::not_always::UNDER_BRANCH, String::new()));
                self.visit_expr(&i.body);
                self.visit_expr(&i.orelse);
                self.conds.pop();
            }
            Expr::StringLiteral(_) | Expr::FString(_) => {
                if !self.in_annotation {
                    self.strings = self.strings.saturating_add(1);
                    self.note_scope_sql(e);
                }
                visitor::walk_expr(self, e);
            }
            _ => visitor::walk_expr(self, e),
        }
    }
}

impl<'a> Collector<'_, 'a> {
    /// Walk the condition of an `if` or `elif` with the body `body`.
    fn test_expr(&mut self, test: &'a Expr, body: &[Stmt]) {
        let refusing = self.first_exit_refuses(body);
        self.refusal_test += usize::from(refusing);
        self.visit_expr(test);
        self.refusal_test -= usize::from(refusing);
    }

    fn visit_stmt_inner(&mut self, stmt: &'a Stmt) {
        match stmt {
            Stmt::FunctionDef(f) => {
                for d in &f.decorator_list {
                    self.visit_decorator(d);
                }
                // A function defined inside another that the enclosing body never
                // names again (it is not returned, passed on or called) does not run.
                self.uncalled = f.decorator_list.is_empty()
                    && self
                        .bodies
                        .last()
                        .is_some_and(|b| !names(b, f.name.as_str()));
                self.function(&f.parameters, &f.body, f.returns.as_deref());
            }
            Stmt::ClassDef(c) => {
                for d in &c.decorator_list {
                    self.visit_decorator(d);
                }
                if let Some(a) = &c.arguments {
                    for b in &a.args {
                        self.visit_expr(b);
                    }
                }
                self.class_body(&c.body);
            }
            Stmt::Raise(r) => {
                self.controls.insert("throw".into());
                self.note_unread_exit(stmt);
                if self.counting()
                    && let Some(e) = r.exc.as_deref()
                {
                    let r = self.rejecting(e);
                    self.rejects_otherwise |= r.is_some();
                    self.note(r);
                }
                if !self.frames.is_empty()
                    && let Some(resp) = r.exc.as_deref().and_then(|e| self.response_of(e, true))
                {
                    self.responses.insert(resp);
                }
                if let Some(exc) = &r.exc {
                    let thrown = match exc.as_ref() {
                        Expr::Call(c) => self.canon(&c.func),
                        e => self.canon(e),
                    };
                    if let Some(t) = thrown {
                        if self.continued {
                            self.after_calls.insert(t.clone());
                        } else {
                            self.before_calls.insert(t.clone());
                        }
                        self.throws.insert(t);
                    }
                }
                visitor::walk_stmt(self, stmt);
            }
            Stmt::Try(t) => {
                self.controls.insert("try".into());
                // A handler that neither raises nor answers with an error may catch
                // what the body refuses with and serve the request all the same.
                let swallows = !self.frames.is_empty()
                    && t.handlers.iter().any(|h| {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        !h.body.iter().any(|s| self.refuses(s))
                    });
                // Before it hands control on, outside any handler: where an answer
                // turns the caller away. And where every request gets to.
                let counts = !self.frames.is_empty() && self.counting();
                let every = counts && self.conds.is_empty() && self.skipped.is_none();
                if swallows {
                    self.conds
                        .push((drift_core::not_always::SWALLOWED, String::new()));
                }
                for s in &t.body {
                    self.visit_stmt(s);
                }
                if swallows {
                    self.conds.pop();
                }
                if counts && !self.continued {
                    self.note_handler_rejection(t, every);
                }
                for h in &t.handlers {
                    self.visit_except_handler(h);
                }
                for s in t.orelse.iter().chain(&t.finalbody) {
                    self.visit_stmt(s);
                }
            }
            Stmt::Return(r) => {
                if self.refuses(stmt) {
                    self.note_unread_exit(stmt);
                }
                // `return helper(request)`, `return await helper(request)`, of the
                // function's own body.
                if self.frames.len() == 1 {
                    // What each return gives, where it gives a value.
                    if let Some(v) = r.value.as_deref()
                        && !matches!(v, Expr::NoneLiteral(_))
                    {
                        let source = self.caller_value(v);
                        let caller = source == Some(None);
                        self.returns_caller = Some(self.returns_caller.unwrap_or(true) && caller);
                        match source {
                            Some(Some(dep)) if !matches!(dep, RawDep::Gives(_)) => {
                                if !self.returns_via.contains(&dep) {
                                    self.returns_via.push(dep);
                                }
                            }
                            Some(None) => {}
                            _ => self.returns_else = true,
                        }
                        // A parameter that is no dependency is what the request
                        // sent only in what FastAPI calls for a request; a reader
                        // asks of a dependency or a helper called with the request.
                        // Not one with a default: called with nothing, it gives
                        // the default.
                        let request = match self.side(v) {
                            RawSide::Request => true,
                            RawSide::Param(p, _) => self
                                .frame_params
                                .last()
                                .is_some_and(|f| !f.defaulted.contains(&p)),
                            _ => false,
                        };
                        self.returns_request =
                            Some(self.returns_request.unwrap_or(true) && request);
                    }
                    let returned = match r.value.as_deref() {
                        Some(Expr::Await(a)) => Some(a.value.as_ref()),
                        other => other,
                    };
                    if let Some(Expr::Call(c)) = returned
                        && let Some(callee) = self.canon(&c.func)
                        && !matches!(callee.base, RawBase::Global(_))
                    {
                        self.returns_calls.insert(callee);
                    }
                }
                if self.counting()
                    && let Some(e) = r.value.as_deref()
                {
                    let r = self.rejecting(e);
                    if r.is_some() {
                        if self.frames.len() <= 1 {
                            self.rejects_by_return = true;
                        } else {
                            self.inner_rejects_by_return = true;
                        }
                    }
                    self.note(r);
                }
                if !self.frames.is_empty()
                    && let Some(resp) = r.value.as_deref().and_then(|e| self.response_of(e, false))
                {
                    // An answer of 401 the body returns (`return jsonify(...), 401`).
                    if resp.status == 401 && self.counting() {
                        if self.frames.len() <= 1 {
                            self.returns_401 = true;
                        } else {
                            self.inner_rejects_by_return = true;
                        }
                    }
                    self.responses.insert(resp);
                }
                visitor::walk_stmt(self, stmt);
            }
            Stmt::If(i) => {
                // A branch that hands control on and leaves (`if public: return
                // await call_next(request)`) does not hand it on for what follows.
                // An `elif` is reached by every request only where each branch
                // before it leaves (`if not token: raise ...` / `elif ...`).
                use drift_core::not_always::UNDER_BRANCH;
                let here = self.not_always();
                self.note_body_checks(&i.test, &i.body, here.clone());
                // What the branch before an `elif` tested, in words.
                let mut previous = practice::words(&i.test);
                let mut goes_on = !leaves(&i.body);
                // A branch before this one returned without refusing: the requests
                // that took it are served without what the later branches check.
                let mut served = self
                    .returns_without_refusing(&i.body)
                    .then(|| format!("not when {previous}"));
                for c in &i.elif_else_clauses {
                    if let Some(t) = &c.test {
                        let cond = here
                            .clone()
                            .or_else(|| {
                                served
                                    .clone()
                                    .map(|w| (drift_core::not_always::AFTER_CONDITIONAL_RETURN, w))
                            })
                            .or_else(|| {
                                goes_on.then(|| (UNDER_BRANCH, format!("only when not {previous}")))
                            });
                        self.note_body_checks(t, &c.body, cond);
                        previous = practice::words(t);
                        if served.is_none() && self.returns_without_refusing(&c.body) {
                            served = Some(format!("not when {previous}"));
                        }
                    }
                    goes_on |= !leaves(&c.body);
                }
                self.test_expr(&i.test, &i.body);
                let before = self.continued;
                let test = practice::words(&i.test);
                self.conds.push((UNDER_BRANCH, format!("only when {test}")));
                for s in &i.body {
                    self.visit_stmt(s);
                }
                self.conds.pop();
                // A branch that returns without refusing leaves what follows undone
                // for the requests that took it.
                let mut skips = self
                    .returns_without_refusing(&i.body)
                    .then(|| format!("not when {test}"));
                let mut skips_own = skips.is_some() && self.own_test(&i.test);
                let mut after = before || (self.continued && !leaves(&i.body));
                let mut goes_on = !leaves(&i.body);
                let mut previous = test;
                for c in &i.elif_else_clauses {
                    self.continued = before;
                    if let Some(t) = &c.test {
                        self.test_expr(t, &c.body);
                    }
                    // What a later branch does comes after the return of an earlier
                    // one that served the request.
                    if skips.is_some() {
                        self.note_skip(skips.clone(), skips_own);
                    }
                    let own = c.test.as_ref().map(practice::words);
                    let words = match &own {
                        Some(t) => format!("only when {t}"),
                        None => format!("only when not {previous}"),
                    };
                    // An `elif` body runs only where its own test holds; an `else`
                    // of branches that all leave runs for every request that is left.
                    let branch = goes_on || c.test.is_some();
                    if branch {
                        self.conds.push((UNDER_BRANCH, words.clone()));
                    }
                    for s in &c.body {
                        self.visit_stmt(s);
                    }
                    if branch {
                        self.conds.pop();
                    }
                    if skips.is_none() && self.returns_without_refusing(&c.body) {
                        skips = Some(words.replacen("only when", "not when", 1));
                        skips_own = c.test.as_ref().is_some_and(|t| self.own_test(t));
                    } else if self.returns_without_refusing(&c.body) {
                        // A later branch returns too: for the caller's own only
                        // where each does.
                        skips_own &= c.test.as_ref().is_some_and(|t| self.own_test(t));
                    }
                    goes_on |= !leaves(&c.body);
                    if let Some(t) = own {
                        previous = t;
                    }
                    after |= self.continued && !leaves(&c.body);
                }
                self.note_skip(skips, skips_own);
                self.continued = after;
            }
            Stmt::Assign(a) => {
                if let [Expr::Name(n)] = a.targets.as_slice()
                    && matches!(a.value.as_ref(), Expr::Call(_))
                    && let Some(r) = rejection_marker(&a.value, 0)
                {
                    self.rejection_vars.insert(n.id.as_str().to_string(), r);
                }
                self.practice_assign(a);
                // `req = request`: what is read of it is not followed.
                if self.input_params.is_some() && self.is_request(&a.value) {
                    self.input_escapes = true;
                }
                // `response = await call_next(request)`, `rv, err = f(*args)`: what the
                // continuation handed back.
                if self.mentions_continuation(&a.value, 0) {
                    for t in &a.targets {
                        self.bind_continuation_var(t);
                    }
                }
                visitor::walk_stmt(self, stmt);
            }
            Stmt::AnnAssign(a) => {
                if let Some(v) = &a.value
                    && self.mentions_continuation(v, 0)
                {
                    self.bind_continuation_var(&a.target);
                }
                self.annotation(&a.annotation);
                self.visit_expr(&a.target);
                if let Some(v) = &a.value {
                    self.visit_expr(v);
                }
            }
            Stmt::Import(_) | Stmt::ImportFrom(_) => {}
            // An `assert` turns away the requests its test fails, and no check records
            // it. One that only narrows a type (`assert x is not None`,
            // `assert isinstance(x, T)`) asks nothing of the caller.
            Stmt::Assert(a) => {
                let narrows = match a.test.as_ref() {
                    Expr::Compare(c) => {
                        matches!(c.ops.as_ref(), [ast::CmpOp::IsNot])
                            && matches!(c.second_operand(), Expr::NoneLiteral(_))
                    }
                    Expr::Call(c) => practice::callee_name(&c.func) == Some("isinstance"),
                    _ => false,
                };
                if !narrows && !self.frames.is_empty() && self.counting() {
                    self.controls
                        .insert(drift_core::controls::UNREAD_EXIT.into());
                }
                visitor::walk_stmt(self, stmt);
            }
            // A loop body or a `match` case runs for some requests only.
            Stmt::For(_) | Stmt::While(_) | Stmt::Match(_) => {
                self.conds
                    .push((drift_core::not_always::UNDER_BRANCH, String::new()));
                visitor::walk_stmt(self, stmt);
                self.conds.pop();
                // A case, or a loop's body or `else`, that returns without refusing
                // leaves what follows undone for the requests that took it, as an
                // `if` branch does.
                let skips = match stmt {
                    Stmt::Match(m) => m
                        .cases
                        .iter()
                        .any(|c| self.returns_without_refusing(&c.body))
                        .then(|| {
                            format!(
                                "not when {} matches a case that returns",
                                practice::words(&m.subject)
                            )
                        }),
                    Stmt::While(w) => (self.returns_without_refusing(&w.body)
                        || self.returns_without_refusing(&w.orelse))
                    .then(|| format!("not when {}", practice::words(&w.test))),
                    Stmt::For(f) => (self.returns_without_refusing(&f.body)
                        || self.returns_without_refusing(&f.orelse))
                    .then(|| {
                        format!(
                            "not when the loop over {} returns",
                            practice::words(&f.iter)
                        )
                    }),
                    _ => None,
                };
                self.note_skip(skips, false);
            }
            _ => visitor::walk_stmt(self, stmt),
        }
    }
}

/// The body reads the name somewhere: a function defined in it under that name is
/// returned, passed on or called.
fn names(body: &[Stmt], name: &str) -> bool {
    struct Finder<'n> {
        name: &'n str,
        found: bool,
    }
    impl<'a> Visitor<'a> for Finder<'_> {
        fn visit_expr(&mut self, e: &'a Expr) {
            match e {
                Expr::Name(n) if n.id.as_str() == self.name => self.found = true,
                _ => visitor::walk_expr(self, e),
            }
        }
    }
    let mut f = Finder { name, found: false };
    for s in body {
        f.visit_stmt(s);
    }
    f.found
}

/// The body reads the name somewhere (a load, not a binding of it).
fn reads(body: &[Stmt], name: &str) -> bool {
    struct Finder<'n> {
        name: &'n str,
        found: bool,
    }
    impl<'a> Visitor<'a> for Finder<'_> {
        fn visit_expr(&mut self, e: &'a Expr) {
            match e {
                Expr::Name(n) if n.id.as_str() == self.name => {
                    self.found |= matches!(n.ctx, ast::ExprContext::Load);
                }
                _ => visitor::walk_expr(self, e),
            }
        }
    }
    let mut f = Finder { name, found: false };
    for s in body {
        f.visit_stmt(s);
    }
    f.found
}

/// How an `except` handler ends ([`Collector::handler_exit`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HandlerExit {
    /// It answers that the caller is not signed in (a 401, a sign-in redirect).
    SignIn,
    /// It turns the request away another way: a `raise`, an error answer, `abort(...)`.
    Refuses,
    /// Anything else: the function may go on and serve the request.
    GoesOn,
}

/// What a call says it turns the caller away as, by itself: `abort(401)`, a redirect
/// to a sign-in page (`redirect(url_for("auth.login"))`), or a helper named for it
/// (`redirect_to_login(...)`, `HttpResponseForbidden()`,
/// `login_manager.unauthorized()`).
fn call_rejection(c: &ast::ExprCall) -> Option<drift_core::controls::Rejection> {
    use drift_core::controls::Rejection;
    let name = match c.func.as_ref() {
        Expr::Name(n) => n.id.as_str(),
        Expr::Attribute(a) => a.attr.as_str(),
        _ => return None,
    };
    let first = c.arguments.args.first();
    match name {
        "abort" => first.and_then(rejection_status_of),
        "redirect" | "RedirectResponse" | "HttpResponseRedirect" => first
            .filter(|e| names_sign_in(e, 0))
            .map(|_| Rejection::Unauthenticated),
        "redirect_to_login" | "unauthorized" => Some(Rejection::Unauthenticated),
        "HttpResponseForbidden" => Some(Rejection::Forbidden),
        _ => None,
    }
}

/// Some statement of the block, at any depth of its compound statements, is one
/// `found` accepts. Not a statement of a function or class defined there.
fn any_stmt(body: &[Stmt], found: &dyn Fn(&Stmt) -> bool) -> bool {
    body.iter().any(|s| {
        if found(s) {
            return true;
        }
        match s {
            Stmt::If(i) => {
                any_stmt(&i.body, found)
                    || i.elif_else_clauses.iter().any(|c| any_stmt(&c.body, found))
            }
            Stmt::For(f) => any_stmt(&f.body, found) || any_stmt(&f.orelse, found),
            Stmt::While(w) => any_stmt(&w.body, found) || any_stmt(&w.orelse, found),
            Stmt::With(w) => any_stmt(&w.body, found),
            Stmt::Try(t) => {
                any_stmt(&t.body, found)
                    || t.handlers.iter().any(|h| {
                        let ast::ExceptHandler::ExceptHandler(h) = h;
                        any_stmt(&h.body, found)
                    })
                    || any_stmt(&t.orelse, found)
                    || any_stmt(&t.finalbody, found)
            }
            Stmt::Match(m) => m.cases.iter().any(|c| any_stmt(&c.body, found)),
            _ => false,
        }
    })
}

/// The rejection a status says: `401`, `403`, `429`, or a status constant named for one
/// (`status.HTTP_401_UNAUTHORIZED`, `HTTPStatus.FORBIDDEN`).
fn rejection_status_of(e: &Expr) -> Option<drift_core::controls::Rejection> {
    match e {
        Expr::NumberLiteral(n) => match &n.value {
            ast::Number::Int(i) => i.as_u64().and_then(drift_core::controls::rejection_status),
            _ => None,
        },
        Expr::Attribute(a) => drift_core::controls::rejection_status_name(a.attr.as_str()),
        Expr::Name(n) => drift_core::controls::rejection_status_name(n.id.as_str()),
        _ => None,
    }
}

/// What an argument says the caller is turned away as: 401, 403 or 429
/// ([`rejection_status_of`]) or rejection words ([`drift_core::controls::rejection_text`]),
/// at any depth of its dicts, lists and the arguments of the calls it makes
/// (`HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)`, `Response(status=403)`).
/// A rate limit anywhere in it wins (`HTTPException(403, "Rate limit exceeded")`).
fn rejection_marker(e: &Expr, depth: usize) -> Option<drift_core::controls::Rejection> {
    use drift_core::controls::Rejection;
    const MAX_DEPTH: usize = 4;
    if depth > MAX_DEPTH {
        return None;
    }
    if let Some(r) = rejection_status_of(e) {
        return Some(r);
    }
    let all = |it: &mut dyn Iterator<Item = &Expr>| {
        it.fold(None, |acc, x| {
            Rejection::combine(acc, rejection_marker(x, depth + 1))
        })
    };
    match e {
        Expr::StringLiteral(s) => drift_core::controls::rejection_text(s.value.to_str()),
        Expr::Dict(d) => all(&mut d.items.iter().map(|i| &i.value)),
        Expr::List(l) => all(&mut l.elts.iter()),
        Expr::Tuple(t) => all(&mut t.elts.iter()),
        Expr::Call(c) => all(&mut c
            .arguments
            .args
            .iter()
            .chain(c.arguments.keywords.iter().map(|k| &k.value))),
        _ => None,
    }
}

/// Calls that hand control on to what a middleware or decorator guards: Starlette's
/// `call_next(request)`, Django's `self.get_response(request)`, a decorator's wrapped
/// view (`f(*args, **kwargs)`).
const PY_CONTINUATIONS: &[&str] = &[
    "call_next",
    "get_response",
    "next",
    "handler",
    "func",
    "function",
    "f",
    "fn",
    "view",
    "view_func",
    "wrapped",
    "wrapped_func",
    "endpoint",
    "callback",
];

impl Collector<'_, '_> {
    /// The call hands control on: a local whose name says so ([`PY_CONTINUATIONS`]),
    /// `self.get_response(request)` or `self.call_next(request)` on any object, the
    /// view a class-based decorator or middleware keeps (`self.view(request)`,
    /// `await self.app(scope, receive, send)`), or a parameter of an enclosing
    /// function: the view a decorator wraps, under any name
    /// (`def deco(target): def inner(*a): return target(*a)`), when the call forwards
    /// the inner function's own parameters ([`Collector::forwards_own`]). Any other
    /// call of such a parameter (`await verifier(token)` in a dependency a factory
    /// builds) is an ordinary call.
    fn continues(&self, c: &ast::ExprCall) -> bool {
        match c.func.as_ref() {
            // A name that says so is one only as a local the function received or
            // bound, never the built-in `next(iterator)` or a module's own `handler`.
            Expr::Name(n) => {
                let name = n.id.as_str();
                (PY_CONTINUATIONS.contains(&name) && self.resolve(name).is_none())
                    || (self.enclosing_param(name) && self.forwards_own(c))
            }
            Expr::Attribute(a) => {
                matches!(a.attr.as_str(), "get_response" | "call_next")
                    || (matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self")
                        && (a.attr.as_str() == "app"
                            || PY_CONTINUATIONS.contains(&a.attr.as_str())))
            }
            _ => false,
        }
    }

    /// The call hands on the innermost function's own parameters: every argument is
    /// one of them (`*args` and `**kwargs` included), and it forwards `*args` or
    /// `**kwargs`, or passes every named parameter in order
    /// (`fn(*args, **kwargs)`, `fn(request, *args, **kwargs)`, `view(request, pk)` in
    /// `def inner(request, pk)`).
    fn forwards_own(&self, c: &ast::ExprCall) -> bool {
        let Some(p) = self.frame_params.last() else {
            return false;
        };
        let own = |e: &Expr| matches!(e, Expr::Name(n) if p.all.iter().any(|x| x == n.id.as_str()));
        let mut star = false;
        let mut named: Vec<&str> = Vec::new();
        for a in &c.arguments.args {
            match a {
                Expr::Starred(s) if own(&s.value) => star = true,
                Expr::Name(n) if own(a) => named.push(n.id.as_str()),
                _ => return false,
            }
        }
        for k in &c.arguments.keywords {
            if !own(&k.value) {
                return false;
            }
            match &k.arg {
                None => star = true,
                Some(_) => {
                    if let Expr::Name(n) = &k.value {
                        named.push(n.id.as_str());
                    }
                }
            }
        }
        star || named == p.named.iter().map(String::as_str).collect::<Vec<_>>()
    }

    /// `name` here is a parameter of a function enclosing the innermost one being
    /// walked: the nearest scope that binds it is that function's own, and binds it as a
    /// parameter.
    fn enclosing_param(&self, name: &str) -> bool {
        let Some(&(current, _)) = self.frames.last() else {
            return false;
        };
        let innermost = self.scopes.len().saturating_sub(1);
        for (i, s) in self.scopes.iter().enumerate().rev() {
            if s.class && i != innermost {
                continue;
            }
            if s.names.contains_key(name) {
                return i < current
                    && self
                        .frames
                        .iter()
                        .any(|(at, params)| *at == i && params.contains(name));
            }
        }
        false
    }

    /// A call's arguments hand it what the continuation handed back
    /// (`map_errors(f(*args, **kwargs))`, `check(await call_next(request))`).
    fn call_mentions_continuation(&self, c: &ast::ExprCall) -> bool {
        c.arguments
            .args
            .iter()
            .chain(c.arguments.keywords.iter().map(|k| &k.value))
            .any(|a| self.mentions_continuation(a, 0))
    }

    /// The expression calls the continuation or uses what it handed back
    /// (`await call_next(request)`, `response.status_code` for `response = f(...)`).
    fn mentions_continuation(&self, e: &Expr, depth: usize) -> bool {
        if depth > 6 {
            return false;
        }
        let m = |x: &Expr| self.mentions_continuation(x, depth + 1);
        match e {
            Expr::Name(n) => self.continuation_vars.contains(n.id.as_str()),
            Expr::Call(c) => {
                self.continues(c)
                    || m(&c.func)
                    || c.arguments
                        .args
                        .iter()
                        .chain(c.arguments.keywords.iter().map(|k| &k.value))
                        .any(m)
            }
            Expr::Await(a) => m(&a.value),
            Expr::Attribute(a) => m(&a.value),
            Expr::Subscript(s) => m(&s.value),
            Expr::Starred(s) => m(&s.value),
            Expr::If(i) => m(&i.body) || m(&i.orelse),
            Expr::BoolOp(b) => b.values.iter().any(m),
            Expr::Tuple(t) => t.elts.iter().any(m),
            Expr::List(l) => l.elts.iter().any(m),
            Expr::Dict(d) => d.items.iter().any(|i| m(&i.value)),
            _ => false,
        }
    }

    /// Record the names an assignment target binds as holding what the continuation
    /// handed back.
    fn bind_continuation_var(&mut self, t: &Expr) {
        match t {
            Expr::Name(n) => {
                self.continuation_vars.insert(n.id.as_str().to_string());
            }
            Expr::Tuple(x) => x.elts.iter().for_each(|e| self.bind_continuation_var(e)),
            Expr::List(x) => x.elts.iter().for_each(|e| self.bind_continuation_var(e)),
            Expr::Starred(x) => self.bind_continuation_var(&x.value),
            _ => {}
        }
    }
}

/// A function's parameters: the named ones in order (positional-only, positional,
/// keyword-only), and those with `*args` / `**kwargs`.
#[derive(Debug, Default)]
struct FrameParams {
    named: Vec<String>,
    all: Vec<String>,
    /// How many of `named` are positional.
    positional: usize,
    /// The named ones with a default value.
    defaulted: Vec<String>,
}

impl FrameParams {
    fn of(p: &ast::Parameters) -> Self {
        let named: Vec<String> = p
            .posonlyargs
            .iter()
            .chain(&p.args)
            .chain(&p.kwonlyargs)
            .map(|x| x.parameter.name.to_string())
            .collect();
        let mut all = named.clone();
        all.extend(p.vararg.iter().map(|v| v.name.to_string()));
        all.extend(p.kwarg.iter().map(|v| v.name.to_string()));
        Self {
            named,
            all,
            positional: p.posonlyargs.len() + p.args.len(),
            defaulted: p
                .posonlyargs
                .iter()
                .chain(&p.args)
                .chain(&p.kwonlyargs)
                .filter(|x| x.default.is_some())
                .map(|x| x.parameter.name.to_string())
                .collect(),
        }
    }
}

/// The block always leaves the function: its last statement returns or raises, or is
/// an `if` whose every branch does.
fn leaves(body: &[Stmt]) -> bool {
    match body.last() {
        Some(Stmt::Return(_) | Stmt::Raise(_)) => true,
        Some(Stmt::If(i)) => {
            leaves(&i.body)
                && i.elif_else_clauses.iter().any(|c| c.test.is_none())
                && i.elif_else_clauses.iter().all(|c| leaves(&c.body))
        }
        _ => false,
    }
}

/// The expression names a sign-in page: a string that does
/// ([`drift_core::controls::sign_in_target`]), or a call given one (`url_for("auth.login")`,
/// `reverse("login")`).
fn names_sign_in(e: &Expr, depth: usize) -> bool {
    if depth > 2 {
        return false;
    }
    match e {
        Expr::StringLiteral(s) => drift_core::controls::sign_in_target(s.value.to_str()),
        Expr::Call(c) => c.arguments.args.iter().any(|x| names_sign_in(x, depth + 1)),
        _ => false,
    }
}
