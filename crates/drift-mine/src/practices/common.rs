//! Helpers the concern classifiers share: populations of entry points and symbols,
//! handler resolution through re-exports, and the small pieces of an assignment.

use drift_core::{
    BodyCheck, ExportKind, FileFacts, MatcherPolarity, RepoFacts, RouteMatcher, Symbol, SymbolKind,
    TestRequest,
};

use super::{Assignment, Cx, UnitRef, UnknownReason, Use, VariantSource};

/// Re-exports followed at most from an entry point to its handler (as
/// `drift-ts/src/repo.rs`).
pub const MAX_REEXPORT_HOPS: usize = 16;

/// Entry kinds a request reaches (PLAN-R13 §1.1). `page` and `layout` are a
/// sub-population of their own and stay out.
pub const REQUEST_KINDS: &[&str] = &["http", "server_action", "graphql", "rpc", "job"];

/// The entry points of these kinds, each with its handler ([`handler`]), in facts
/// order. Tests and non-production files are in: the engine moves them to `left_out`.
pub fn entries<'a>(cx: &Cx<'a>, kinds: &[&str]) -> Vec<UnitRef<'a>> {
    let mut out = Vec::new();
    for file in &cx.facts.files {
        for entry in &file.entry_points {
            if kinds.contains(&entry.kind.as_str()) {
                out.push(UnitRef::Entry {
                    file,
                    entry,
                    symbol: handler(cx.facts, file, &entry.symbol).map(|(_, s)| s),
                });
            }
        }
    }
    out
}

/// The file with this path (facts files are sorted by path).
pub fn file_at<'a>(facts: &'a RepoFacts, path: &str) -> Option<&'a FileFacts> {
    match facts.files.binary_search_by(|f| f.path.as_str().cmp(path)) {
        Ok(i) => Some(&facts.files[i]),
        Err(_) => facts.files.iter().find(|f| f.path == path),
    }
}

/// The symbol that handles the export `name` of `file`, and its file: a local symbol,
/// or the origin of a re-export, followed at most [`MAX_REEXPORT_HOPS`] times. A
/// binding that is another function under a second name and nothing more (`export
/// const GET = handler; export const DELETE = handler;`) is that function: the
/// binding has no body of its own to read.
pub fn handler<'a>(
    facts: &'a RepoFacts,
    file: &'a FileFacts,
    name: &str,
) -> Option<(&'a FileFacts, &'a Symbol)> {
    let mut file = file;
    let mut name = name.to_string();
    let mut alias = None;
    for _ in 0..=MAX_REEXPORT_HOPS {
        if let Some(s) = file
            .symbols
            .iter()
            .find(|s| s.exported_as.contains(&name) || s.name == name)
        {
            let Some((path, origin)) = plain_alias(s) else {
                return Some((file, s));
            };
            alias.get_or_insert((file, s));
            let Some(next) = file_at(facts, path) else {
                return alias;
            };
            file = next;
            name = origin.to_string();
            continue;
        }
        let Some(e) = file
            .exports
            .iter()
            .find(|e| e.name == name && e.kind == ExportKind::ReExport)
        else {
            return alias;
        };
        let Some((path, origin)) = e.origin.split_once('#') else {
            return alias;
        };
        let Some(next) = file_at(facts, path) else {
            return alias;
        };
        file = next;
        name = origin.to_string();
    }
    alias
}

/// The in-repo binding a `const` or `let` is a second name of: bound to a name and
/// nothing more, with no call, wrap or builder of its own.
fn plain_alias(s: &Symbol) -> Option<(&str, &str)> {
    if !matches!(s.kind, SymbolKind::Const | SymbolKind::Variable)
        || !s.calls.is_empty()
        || !s.wraps.is_empty()
        || !s.made_by.is_empty()
    {
        return None;
    }
    let (path, name) = s.derives_from.split_once('#')?;
    (!name.is_empty() && !name.contains(['.', '(']) && !path.contains(':')).then_some((path, name))
}

/// The handler of an entry unit with its own file (a re-export's origin file), or the
/// symbol of a symbol unit with its file.
pub fn unit_symbol<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> Option<(&'a FileFacts, &'a Symbol)> {
    match *unit {
        UnitRef::Entry { file, entry, .. } => handler(cx.facts, file, &entry.symbol),
        UnitRef::Symbol { file, symbol } | UnitRef::Catch { file, symbol, .. } => {
            Some((file, symbol))
        }
        UnitRef::TestFile { .. } | UnitRef::File { .. } => None,
    }
}

/// What every classifier says first about an entry unit: no handler, or a file of it
/// not parsed. `None` when the unit can be read.
pub fn unreadable<'a>(cx: &Cx<'a>, unit: &UnitRef<'a>) -> Option<Assignment> {
    let file = unit.file();
    if !file.parse_ok {
        return Some(unknown(UnknownReason::Unparsed, &file.path));
    }
    match unit_symbol(cx, unit) {
        None => Some(unknown(UnknownReason::NoSymbol, "")),
        Some((f, _)) if !f.parse_ok => Some(unknown(UnknownReason::Unparsed, &f.path)),
        Some(_) => None,
    }
}

/// The module of a canonical reference was skipped by the scan (not parsed).
pub fn in_skipped(cx: &Cx<'_>, canonical: &str) -> bool {
    let module = canonical.split_once('#').map_or(canonical, |(m, _)| m);
    cx.facts.skipped.iter().any(|s| s.path == module)
}

/// A reference into a package, the runtime or an unresolved import: not the repo's.
pub fn external(r: &str) -> bool {
    r.starts_with("pkg:") || r.starts_with("global#") || r.starts_with("unresolved:")
}

/// The package a reference is into (`pkg:@clerk/nextjs/server#auth` -> `@clerk/nextjs`),
/// `None` for the repo's own.
pub fn package(r: &str) -> Option<String> {
    let n = crate::mine::norm_ref(r);
    let (module, _) = n.strip_prefix("pkg:")?.split_once('#')?;
    Some(module.to_string())
}

/// The package a reference is into, by its first module segment as Python names it
/// (`pkg:sqlalchemy.orm#sessionmaker` -> `sqlalchemy`).
pub fn package_root(r: &str) -> Option<String> {
    let p = package(r)?;
    // The Python standard library is canonical under its language
    // (`pkg:python:logging#getLogger`): the vocabularies name the module (`logging`).
    let p = match p.strip_prefix(PYTHON_STDLIB) {
        Some(rest) => rest.to_string(),
        None => p,
    };
    Some(if p.starts_with('@') {
        p
    } else {
        p.split(['.', '/']).next().unwrap_or(&p).to_string()
    })
}

/// The prefix of a Python standard-library module in a canonical reference.
pub const PYTHON_STDLIB: &str = "python:";

/// The name after `#` (`lib/auth.ts#withAuth` -> `withAuth`).
pub fn short(r: &str) -> &str {
    r.rsplit_once('#').map_or(r, |(_, n)| n)
}

/// A name Python keeps for classes (PEP 8 CapWords: `ArgumentParser`,
/// `CreateSessionRequestBody`, `HTTPBearer`): it starts with a capital and is not a
/// constant (`MAX_SIZE`). Python has no `new`, so this is how a class, and a call that
/// builds an object of it, reads there, as the Python lowering reads one (a validated
/// model, a router instance); TypeScript marks the call `(new)`.
pub fn class_name(name: &str) -> bool {
    name.starts_with(|c: char| c.is_ascii_uppercase())
        && name.chars().any(|c| c.is_ascii_lowercase())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The prefix of a callee reached through a parameter's members
/// (`param:server.services.secret.canRevoke`): the TypeScript lowering names the call
/// by the parameter, and no body is linked to that name.
pub const PARAM_CALLEE: &str = "param:";

/// A call through a parameter (`param:request.json`) is a method of a package's type:
/// the framework's request object, not work the handler hands on. When a parameter is
/// annotated with a type, the TypeScript lowering records a call through it twice in
/// the body's `calls`: by the parameter (`param:request.json`) and by the type, as the
/// type's reference followed by the same member path
/// (`pkg:next/server#NextRequest.json`). So the call is a package's when the calls
/// name its member path through a type and every such name is a package's: what it
/// runs is that package's code, as any `pkg:` callee, and no body of the repository
/// is left unread behind it.
///
/// [STRICT], because what this drops turns an unknown into "no guard". All of:
/// - **one member** (`request.json`, never `request.nextUrl.searchParams.get`). The
///   names do not say which parameter a type's name stands for; only the lowering's
///   own rule ties them. It records a call through a parameter with no type from two
///   members on, and a one-member call only through a typed parameter: so a
///   one-member `param:` callee is a typed parameter's, and its type's name is among
///   those of the same path. A longer path may be an untyped parameter's
///   (`ctx.auth.verify()`) beside a typed one's of the same path, and stays unread;
/// - **every name of the path through a type is a package's**: not in the repository
///   (`svc.find()` on a `svc: UsersService`), not unresolved;
/// - **the body hands no value to a call the facts did not record**
///   ([`drift_core::controls::UNREAD_CALL`]: `ctx.json(body)` on a parameter with no
///   type is not in `calls` at all). Where it does, the request read was not the only
///   thing unread, and the unit stays what it was without this rule: unknown.
///
/// Read by [`request_param_call`].
pub fn package_param_call(body: &Symbol, callee: &str) -> bool {
    !hands_unrecorded(body) && package_param_shape(body, callee)
}

/// The body hands a value to a call the facts did not record
/// ([`drift_core::controls::UNREAD_CALL`]).
fn hands_unrecorded(body: &Symbol) -> bool {
    body.controls
        .iter()
        .any(|c| c == drift_core::controls::UNREAD_CALL)
}

/// [`package_param_call`] but for what the rest of the body hands on.
fn package_param_shape(body: &Symbol, callee: &str) -> bool {
    let Some((_, path)) = callee
        .strip_prefix(PARAM_CALLEE)
        .and_then(|c| c.split_once('.'))
    else {
        return false;
    };
    if path.contains('.') {
        return false;
    }
    let mut named = body
        .calls
        .iter()
        .filter(|t| {
            !t.starts_with(PARAM_CALLEE)
                && t.contains('#')
                && short(t)
                    .split_once('.')
                    .is_some_and(|(ty, members)| !ty.is_empty() && members == path)
        })
        .peekable();
    named.peek().is_some() && named.all(|t| t.starts_with("pkg:"))
}

/// A call through a parameter is a method of a package's type: the framework's
/// request object ([`package_param_call`], one member:
/// `request.json`), or a longer path through it (`req.nextUrl.searchParams.get`).
///
/// The lowering records a call through a typed parameter twice, by the parameter and
/// by the type; a call through a parameter with no type only by the parameter. So of a
/// longer path, when exactly one parameter's call has it and the calls name the same
/// path through a type, that call is the typed parameter's; and it is a package's when
/// every such type is. [STRICT], as [`package_param_call`]: where the body
/// hands a value to a call the facts did not record, the request read was not the
/// only thing unread, and the call stays unread.
///
/// Also a method of a member that the parameter's declared type gives a built-in
/// value's type ([`builtin_value_shape`]: `params.path.join` on `params: { path:
/// string[] }` is `Array`'s `join`), under the same [STRICT] condition.
pub fn request_param_call(body: &Symbol, callee: &str) -> bool {
    package_param_call(body, callee)
        || (!hands_unrecorded(body)
            && (longer_param_shape(body, callee) || builtin_value_shape(body, callee)))
}

/// `callee` is `param:<parameter>.<member>.<method>` and the body records that the
/// parameter's declared type gives the member a built-in value's type
/// ([`drift_core::controls::BUILTIN_VALUE`]).
fn builtin_value_shape(body: &Symbol, callee: &str) -> bool {
    let Some((value, _method)) = callee
        .strip_prefix(PARAM_CALLEE)
        .and_then(|c| c.rsplit_once('.'))
    else {
        return false;
    };
    value.matches('.').count() == 1
        && body
            .controls
            .iter()
            .any(|c| c.strip_prefix(drift_core::controls::BUILTIN_VALUE) == Some(value))
}

/// A call through a parameter that is a method of a package's type
/// ([`request_param_call`]), in a body that also hands a value to a call the facts did
/// not record: what is unread there is that other call, not this one. The function the
/// body is of is what a person reads ([`super::UnknownReason::PartlyRead`]).
pub fn request_call_beside_unrecorded(body: &Symbol, callee: &str) -> bool {
    hands_unrecorded(body)
        && (package_param_shape(body, callee)
            || longer_param_shape(body, callee)
            || builtin_value_shape(body, callee))
}

/// The longer path of [`request_param_call`], but for what the rest of the body hands
/// on.
fn longer_param_shape(body: &Symbol, callee: &str) -> bool {
    let path_of = |c: &str| {
        c.strip_prefix(PARAM_CALLEE)
            .and_then(|c| c.split_once('.'))
            .map(|(_, path)| path.to_string())
    };
    let Some(path) = path_of(callee) else {
        return false;
    };
    if !path.contains('.') {
        return false;
    }
    let through_parameters = body
        .calls
        .iter()
        .filter(|t| path_of(t).as_deref() == Some(path.as_str()))
        .count();
    let mut named = body
        .calls
        .iter()
        .filter(|t| {
            !t.starts_with(PARAM_CALLEE)
                && t.contains('#')
                && short(t)
                    .split_once('.')
                    .is_some_and(|(ty, members)| !ty.is_empty() && members == path)
        })
        .peekable();
    through_parameters == 1 && named.peek().is_some() && named.all(|t| t.starts_with("pkg:"))
}

/// The callee builds an object and nothing else: TypeScript's `new X(..)` (`X(new)`),
/// or, in a Python body (`py`), a call of a class by its name ([`class_name`]:
/// `CreateSessionRequestBody(user_id=..)`). A method called on what it builds
/// (`Webhook(secret).verify`) is another callee.
pub fn builds_object(py: bool, callee: &str) -> bool {
    callee.ends_with("(new)")
        || (py && class_name(short(callee).rsplit('.').next().unwrap_or_default()))
}

/// The label a person declared for `canonical` under `concern`
/// (`.drift/config.yaml` `practices:`).
pub fn declared<'c>(cx: &Cx<'c>, concern: &str, canonical: &str) -> Option<&'c str> {
    let table = cx.declared.get(concern)?;
    table
        .get(canonical)
        .or_else(|| table.get(crate::mine::norm_ref(canonical).as_ref()))
        .map(String::as_str)
}

/// One use, its instrument package-normalised.
pub fn use_of(mechanism: &str, instrument: &str) -> Use {
    Use {
        mechanism: mechanism.to_string(),
        instrument: crate::mine::norm_ref(instrument).into_owned(),
    }
}

pub fn unknown(reason: UnknownReason, instrument: &str) -> Assignment {
    Assignment::Unknown {
        reason,
        instrument: instrument.to_string(),
    }
}

/// `Known` with the uses sorted, and the label built from them unless given.
pub fn known(mut uses: Vec<Use>, source: VariantSource) -> Assignment {
    uses.sort();
    uses.dedup();
    let label = uses
        .iter()
        .map(|u| format!("{} {}", u.mechanism.replace('_', " "), short(&u.instrument)))
        .collect::<Vec<_>>()
        .join(" + ");
    Assignment::Known {
        uses,
        label,
        source,
    }
}

/// A variant's source from its instruments': declared when any was declared, else
/// usage when any was read from an in-repo definition, else vocabulary.
pub fn source_of(sources: &[VariantSource]) -> VariantSource {
    sources.iter().copied().max().unwrap_or_default()
}

/// The production entry symbols of a file: the handlers its own entry points name.
pub fn is_entry_symbol(file: &FileFacts, symbol: &Symbol) -> bool {
    file.entry_points
        .iter()
        .any(|e| e.symbol == symbol.name || symbol.exported_as.contains(&e.symbol))
}

/// `path#name` of a symbol.
pub fn canonical(file: &FileFacts, symbol: &Symbol) -> String {
    format!("{}#{}", file.path, symbol.name)
}

/// The classes of the file whose methods an entry symbol is: `Cls` of `Cls.get`, and
/// for a Nest route the `@Controller` class it is written in (whose decorators apply
/// to every route of that class, and to no route of another controller of the
/// file): the last one declared above the route.
pub fn owning_classes<'a>(file: &'a FileFacts, symbol: &Symbol) -> Vec<&'a Symbol> {
    let class = symbol.name.split_once('.').map(|(c, _)| c);
    let controller = |s: &Symbol| {
        s.wraps.iter().any(|w| {
            w.kind == drift_core::WrapKind::Decorator
                && crate::mine::norm_ref(&w.wrapper) == "pkg:@nestjs/common#Controller"
        })
    };
    let classes = || {
        file.symbols
            .iter()
            .filter(|s| s.kind == drift_core::SymbolKind::Class)
    };
    let own = classes()
        .filter(|s| controller(s) && s.line <= symbol.line)
        .max_by_key(|s| s.line);
    classes()
        .filter(|s| {
            Some(s.name.as_str()) == class
                || own.is_some_and(|o| std::ptr::eq(o, *s))
                // A route with no line of its own (facts written by hand): every
                // controller of the file, as before.
                || (symbol.line == 0 && controller(s))
        })
        .collect()
}

// ---------- facts schema 11 amendments (PLAN-R14 WS-B), read through accessors ----------

/// `field` (or one of its inner lists, `responses.keys`) of the list lost entries to
/// its cap (B1 `truncated`).
fn cut(truncated: &[String], field: &str) -> bool {
    truncated
        .iter()
        .any(|t| t == field || t.strip_prefix(field).is_some_and(|r| r.starts_with('.')))
}

/// The symbol's capped `field` lost entries (B1 `Symbol.truncated`).
pub fn symbol_truncated(s: &Symbol, field: &str) -> bool {
    cut(&s.truncated, field)
}

/// The file's capped `field` lost entries (B1 `FileFacts.truncated`).
pub fn file_truncated(f: &FileFacts, field: &str) -> bool {
    cut(&f.truncated, field)
}

/// The first of `fields` the symbol or its file lost entries of: what the classifier
/// read is incomplete, so the unit is unknown, never none [STRICT].
pub fn truncated(file: &FileFacts, s: &Symbol, fields: &[&str]) -> Option<Assignment> {
    fields
        .iter()
        .find(|f| symbol_truncated(s, f) || file_truncated(file, f))
        .map(|f| unknown(UnknownReason::Unparsed, &format!("truncated:{f}")))
}

/// The matcher's patterns are not all it holds (B2 `RouteMatcher.opaque`; an empty
/// list is unknown too).
pub fn matcher_opaque(m: &RouteMatcher) -> bool {
    m.opaque || m.patterns.is_empty()
}

/// What a matcher lists (B2 `RouteMatcher.polarity`): `Some(true)` routes it applies
/// to, `Some(false)` routes left public, `None` unknown. `config.matcher` applies;
/// with no polarity recorded, a list named public (`isPublicRoute`) is public: a name
/// may take coverage away, never give it.
pub fn matcher_polarity(m: &RouteMatcher) -> Option<bool> {
    match m.polarity {
        MatcherPolarity::Applies => return Some(true),
        MatcherPolarity::Public => return Some(false),
        MatcherPolarity::Unknown => {}
    }
    if m.binding == "config.matcher" {
        return Some(true);
    }
    let words = super::libraries::key_words(&m.binding);
    words
        .iter()
        .any(|w| super::libraries::PUBLIC_MATCHER_NAMES.contains(&w.as_str()))
        .then_some(false)
}

/// A check that turns away invalid input (B3 `CheckOutcome::Invalid`).
pub fn check_invalid(c: &BodyCheck) -> bool {
    c.outcome == drift_core::CheckOutcome::Invalid
}

/// Which route the test request asks for is not known (B6 `TestRequest.dynamic`, or
/// neither a route nor a target).
pub fn request_dynamic(r: &TestRequest) -> bool {
    r.dynamic || (r.route.is_empty() && r.target.is_empty())
}

/// A data-access call whose filter names a key, and where the value came from
/// (PLAN-R14 B7 `Symbol.scoped_queries`: `session`, `param`, `header`, `literal`,
/// `unknown`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scoped {
    pub callee: String,
    pub key: String,
    pub source: String,
    /// [`drift_core::ScopedQuery::condition`].
    pub condition: String,
}

impl Scoped {
    /// The key, with where its value came from when known (`org_id (session)`).
    pub fn label(&self) -> String {
        if self.source.is_empty() || self.source == "unknown" {
            self.key.clone()
        } else {
            format!("{} ({})", self.key, self.source)
        }
    }
}

/// The symbol's scoped queries (B7 `Symbol.scoped_queries`): data-access calls
/// filtered by a tenant key, with where the value came from.
pub fn scoped_queries(s: &Symbol) -> Vec<Scoped> {
    scoped(&s.scoped_queries)
}

/// Scoped queries as the classifiers read them ([`scoped_queries`]).
pub fn scoped(queries: &[drift_core::ScopedQuery]) -> Vec<Scoped> {
    queries
        .iter()
        .map(|q| Scoped {
            callee: q.callee.clone(),
            key: q.key.clone(),
            source: match q.source {
                drift_core::ScopeSource::Session => "session",
                drift_core::ScopeSource::Param => "param",
                drift_core::ScopeSource::Header => "header",
                drift_core::ScopeSource::Literal => "literal",
                drift_core::ScopeSource::Unknown => "unknown",
            }
            .to_string(),
            condition: q.condition.clone(),
        })
        .collect()
}

// ---------- the bodies an entry runs ----------

/// Bodies read at most for one entry ([`bodies`]).
const MAX_BODIES: usize = 8;

/// The bodies an entry point runs: its handler symbol, and the in-repo functions it
/// hands itself to by reference (`defaultResponderForAppDir(deleteHandler)`,
/// `router.get("/x", auth, handler)`), followed two levels. What the request does is
/// in those bodies, not in the wrapped binding.
pub fn bodies<'a>(cx: &Cx<'a>, s: &'a Symbol) -> Vec<&'a Symbol> {
    let mut out: Vec<&'a Symbol> = vec![s];
    let mut level: Vec<&'a Symbol> = vec![s];
    for _ in 0..2 {
        let mut next = Vec::new();
        for b in level {
            for c in &b.calls {
                let Some(r) = c.strip_suffix("(ref)") else {
                    continue;
                };
                // What a call of a function of the repository built, where that
                // function hands back the one function written in it
                // (`app.get("/me", currentUser())`): its facts are that body's.
                let r = match r.strip_suffix("()") {
                    Some(made_by) if crate::guard_position::returns_function(cx, made_by) => {
                        made_by
                    }
                    _ => r,
                };
                if external(r) || out.len() >= MAX_BODIES {
                    continue;
                }
                if let Some(d) = cx.context().definition(r)
                    && d.kind == drift_core::SymbolKind::Function
                    && !out.iter().any(|x| std::ptr::eq(*x, d))
                {
                    out.push(d);
                    next.push(d);
                }
            }
        }
        level = next;
    }
    out
}

/// The handler module an entry point loads lazily for its body (tRPC's
/// `const { editHandler } = await import("./edit.handler")`, or cached in
/// `UNSTABLE_HANDLER_CACHE`): the functions a module its file loads with `import()`
/// exports, where the module's file name starts with the procedure's name (`edit` of
/// `MUTATION edit`).
pub fn lazy_handlers<'a>(cx: &Cx<'a>, file: &'a FileFacts, s: &Symbol) -> Vec<&'a Symbol> {
    let proc = s.name.rsplit(' ').next().unwrap_or(&s.name);
    let mut out = Vec::new();
    for i in file.imports.iter().filter(|i| {
        matches!(
            i.load,
            drift_core::ImportLoad::Dynamic | drift_core::ImportLoad::Lazy
        )
    }) {
        let name = i.module.rsplit('/').next().unwrap_or(&i.module);
        if name.split('.').next() != Some(proc) {
            continue;
        }
        if let Some(f) = file_at(cx.facts, &i.module) {
            out.extend(f.symbols.iter().filter(|x| {
                x.kind == drift_core::SymbolKind::Function && !x.exported_as.is_empty()
            }));
        }
    }
    out
}

/// One of the bodies has the control (`reads_input`, `validates`).
pub fn any_control(bodies: &[&Symbol], control: &str) -> bool {
    bodies
        .iter()
        .any(|b| b.controls.iter().any(|c| c == control))
}

#[cfg(test)]
pub mod fixtures {
    use drift_core::RepoFacts;

    fn load(text: &str) -> RepoFacts {
        let mut f: RepoFacts = serde_json::from_str(text).expect("fixture facts");
        f.files.sort_by(|a, b| a.path.cmp(&b.path));
        f
    }

    /// The Next.js and Clerk fixture, with the check TypeScript lowering records for
    /// the Stripe webhook's `stripe.webhooks.constructEvent` call (the fixture's facts
    /// are older than that check): the call the practice map reads a signature by
    /// ([`super::super::authn`]). The fixture file itself is the engine goldens' and
    /// stays as it is.
    pub fn next_clerk() -> RepoFacts {
        let mut f = load(include_str!(
            "../../tests/fixtures/practices/next_clerk.facts.json"
        ));
        for file in &mut f.files {
            if file.path == "app/api/webhooks/stripe/route.ts" {
                for s in &mut file.symbols {
                    s.body_checks.push(drift_core::BodyCheck {
                        source: "pkg:stripe#webhooks.constructEvent".into(),
                        compares: "env".into(),
                        ..drift_core::BodyCheck::default()
                    });
                    s.body_checks.sort();
                }
            }
        }
        f
    }

    pub fn fastapi_split() -> RepoFacts {
        load(include_str!(
            "../../tests/fixtures/practices/fastapi_split.facts.json"
        ))
    }

    pub fn nest_mixed() -> RepoFacts {
        load(include_str!(
            "../../tests/fixtures/practices/nest_mixed.facts.json"
        ))
    }

    /// Cases the three contract fixtures lack: none and unknown units of each concern.
    pub fn ts_cases() -> RepoFacts {
        load(include_str!(
            "../../tests/fixtures/practices/classify_ts.facts.json"
        ))
    }

    pub fn py_cases() -> RepoFacts {
        load(include_str!(
            "../../tests/fixtures/practices/classify_py.facts.json"
        ))
    }
}

#[cfg(test)]
pub mod testkit {
    use super::super::{Assignment, Concern, Cx, Declared, UnitRef};

    /// `(path, symbol name or entry symbol, assignment)` of every unit.
    pub fn assign_all(c: &dyn Concern, cx: &Cx<'_>) -> Vec<(String, String, Assignment)> {
        c.population(cx)
            .iter()
            .map(|u| {
                let name = match u {
                    UnitRef::Entry { entry, .. } => entry.symbol.clone(),
                    UnitRef::Symbol { symbol, .. } | UnitRef::Catch { symbol, .. } => {
                        symbol.name.clone()
                    }
                    UnitRef::TestFile { .. } | UnitRef::File { .. } => String::new(),
                };
                (u.file().path.clone(), name, c.assign(cx, u))
            })
            .collect()
    }

    /// The assignment of the unit at `path` named `name`.
    pub fn of(all: &[(String, String, Assignment)], path: &str, name: &str) -> Assignment {
        all.iter()
            .find(|(p, n, _)| p == path && n == name)
            .unwrap_or_else(|| panic!("no unit {path} {name}: {all:#?}"))
            .2
            .clone()
    }

    /// The sorted uses of a known assignment as `mechanism:instrument`, joined by `+`
    /// whatever separator the engine's key uses ("" for none, "?" for unknown).
    pub fn key(a: &Assignment) -> String {
        match a {
            Assignment::Known { uses, .. } => super::super::VariantKey::new(uses)
                .uses
                .iter()
                .map(|u| format!("{}:{}", u.mechanism, u.instrument))
                .collect::<Vec<_>>()
                .join("+"),
            Assignment::None { .. } => String::new(),
            Assignment::Unknown { .. } => "?".into(),
        }
    }

    pub fn empty() -> Declared {
        Declared::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_that_builds_an_object() {
        // `new` in TypeScript, a class called by its name in Python.
        assert!(builds_object(false, "pkg:acme#SessionStore(new)"));
        assert!(builds_object(true, "pkg:acme#SessionStore(new)"));
        assert!(builds_object(
            true,
            "pkg:clerk_backend_api#CreateSessionRequestBody"
        ));
        assert!(builds_object(true, "pkg:acme#models.SessionToken"));
        assert!(!builds_object(false, "pkg:acme#SessionToken"));
        // A method called on what was built is another callee.
        assert!(!builds_object(true, "pkg:svix#webhooks.Webhook().verify"));
        assert!(!builds_object(true, "pkg:acme#require_session"));
    }

    #[test]
    fn a_param_call_whose_type_is_a_packages() {
        let body = |controls: &[&str]| Symbol {
            calls: [
                "lib/users.ts#UsersService.find",
                "param:ctx.nextUrl.searchParams.get",
                "param:deps.jobs.run",
                "param:gate.admit",
                "param:request.json",
                "param:request.nextUrl.searchParams.get",
                "param:svc.find",
                "pkg:acme-sdk#Client.find",
                "pkg:acme-sdk#Client.run",
                "pkg:next/server#NextRequest.json",
                "pkg:next/server#NextRequest.nextUrl.searchParams.get",
                "pkg:next/server#NextResponse.json",
                "unresolved:./gate#Gate.admit",
            ]
            .map(String::from)
            .to_vec(),
            controls: controls.iter().map(|c| c.to_string()).collect(),
            ..Symbol::default()
        };
        let read = body(&["await", "reads_input"]);
        assert!(package_param_call(&read, "param:request.json"));
        // A longer path may be an untyped parameter's beside the typed one's: the
        // names cannot tell `ctx` from `request`, so neither is dropped.
        for callee in [
            "param:request.nextUrl.searchParams.get",
            "param:ctx.nextUrl.searchParams.get",
        ] {
            assert!(!package_param_call(&read, callee), "{callee}");
        }
        // The type is the repository's: a package's method of the same name beside it
        // changes nothing.
        assert!(!package_param_call(&read, "param:svc.find"));
        // No type: the whole member path has no other name among the calls.
        assert!(!package_param_call(&read, "param:deps.jobs.run"));
        // An unresolved type is no package's.
        assert!(!package_param_call(&read, "param:gate.admit"));
        // Not a call through a parameter, and not a call at all.
        assert!(!package_param_call(
            &read,
            "pkg:next/server#NextRequest.json"
        ));
        assert!(!package_param_call(&read, "param:request"));
        // The body hands a value to a call the facts did not record (`ctx.json(body)`
        // on a parameter with no type): the request read is not all that is unread.
        let handed = body(&["await", drift_core::controls::UNREAD_CALL]);
        assert!(!package_param_call(&handed, "param:request.json"));
    }

    #[test]
    fn a_class_by_its_name() {
        for class in [
            "ArgumentParser",
            "CreateSessionRequestBody",
            "HTTPBearer",
            "Webhook",
        ] {
            assert!(class_name(class), "{class}");
        }
        for other in [
            "require_session",
            "log",
            "ACL",
            "MAX_SIZE",
            "Webhook()",
            "",
            "_Private",
        ] {
            assert!(!class_name(other), "{other}");
        }
    }

    #[test]
    fn amendment_accessors_answer_from_todays_facts() {
        // Through JSON, so the amendment fields can land without touching this test.
        let m = |binding: &str, patterns: &[&str]| -> RouteMatcher {
            serde_json::from_value(serde_json::json!({ "binding": binding, "patterns": patterns }))
                .unwrap()
        };
        assert!(matcher_opaque(&m("config.matcher", &[])));
        assert!(!matcher_opaque(&m("config.matcher", &["/api/(.*)"])));
        assert_eq!(matcher_polarity(&m("config.matcher", &["/x"])), Some(true));
        assert_eq!(matcher_polarity(&m("isPublicRoute", &["/x"])), Some(false));
        // A name may take coverage away, never give it.
        assert_eq!(matcher_polarity(&m("isProtectedRoute", &["/x"])), None);
        assert_eq!(matcher_polarity(&m("isApiRoute", &["/x"])), None);
        let r = |route: &str, target: &str| -> TestRequest {
            serde_json::from_value(serde_json::json!({
                "method": "GET", "route": route, "target": target, "statuses": []
            }))
            .unwrap()
        };
        assert!(request_dynamic(&r("", "")));
        assert!(!request_dynamic(&r("/x", "")));
        assert!(!request_dynamic(&r("", "app/x/route.ts")));
        let s = Symbol::default();
        let f = FileFacts::default();
        assert_eq!(truncated(&f, &s, &["responses"]), None);
    }
}
