//! A value of the caller, and what a body does with one (TypeScript lowering 66;
//! lowering 68 for what [`Flow::param_flows`] counts and the callback of `then`).
//!
//! Authorization is "none" only where no value of the caller flows anywhere the
//! facts did not classify. This module is the one place that says what a value of
//! the caller is and which uses of one are no scope; every other use is recorded
//! ([`drift_core::Symbol::caller_args`], with [`drift_core::CALLER_USE_UNREAD`]
//! for one that has no callee to name),
//! whatever the library, and a reader that finds no check and no filter then
//! answers unknown with the use named. Nothing here makes a unit known.
//!
//! # The sources of a value of the caller (closed)
//!
//! 1. What a sign-in accessor hands back, by the name of what is called (the
//!    imported name of an import, the last name of a member path):
//!    [`CALLER_ACCESSORS`] (`auth()`, `getServerSession(...)`, `getSession()`,
//!    `currentUser()`, `getToken({ req })`, `supabase.auth.getUser()`,
//!    `validateRequest()`, `jwtVerify(...)`, ...), and `verify` / `decode` of a
//!    package that verifies tokens ([`drift_core::guard_lists::verifying_package`]).
//!    An accessor that also loads rows by an argument ([`ARGUMENT_SENSITIVE`]:
//!    `getUser(id)`) is one only when called with nothing or with the request.
//! 2. What the call returns that the body signs the caller in by: the callee whose
//!    result a check of the same body answers "not signed in" on (`const who =
//!    await identify(req); if (!who) return 401`), whatever it is called.
//! 3. A member of the request or of a request-scoped context that holds the caller
//!    ([`holder_key`]): `req.user`, `req.auth`, `req.session`, `request.user`,
//!    `res.locals.user`, `c.get("user")`, `c.var.claims`, `ctx.session`, `ctx.user`,
//!    `opts.ctx.user`, and one named for a tenant or an owner (`req.orgId`). The
//!    holders are the parameters named in [`HOLDER_PARAMS`] and a member `ctx`,
//!    `context`, `req` or `request` of any parameter.
//! 4. A parameter decorated to receive the caller ([`caller_decorator`]:
//!    `@CurrentUser() user`, `@Session() session`), and a parameter named for the
//!    caller ([`caller_name`]: `user`, `session`, `currentUser`, `claims`): the
//!    wrapper or the framework hands it in.
//! 5. Any other member of a holder (`req.depot`, `ctx.depot`, `c.get("depot")`),
//!    where some body of the repository binds a value of the caller on a holder
//!    under that key (`req.depot = claims.depotId`, `c.set("depot", ...)`,
//!    `next({ ctx: { depot: ... } })`). Written `<callee> via global#held.<key>`;
//!    linking keeps it only where a binding exists.
//! 6. What a function of the repository called with nothing, or with the request
//!    only, hands back, where that function's own body returns a value of the
//!    caller in every `return` that gives a value
//!    ([`drift_core::controls::RETURNS_CALLER`]); one call deep. Written `<callee>
//!    via <function>`; linking keeps it only for such a function.
//! 7. What is read off any of these, or of sources 8 and 9 (a member, an item,
//!    an awaited value, a conversion on [`CONVERSIONS`] or [`PASS_METHODS`], an arm of a conditional or
//!    of a logical expression, a template, an object or an array that holds one),
//!    a local bound to one or destructured from one, any number of hops in the
//!    order written, the element of a loop over one, what a callback of
//!    [`ELEMENT_METHODS`] is given when called on one (`all.filter((p) => ...)`,
//!    `Promise.resolve(v).then((given) => ...)`), and a property shorthand of
//!    such a local.
//! 8. What a request-scoped store gives (TypeScript lowering 70): `store.getStore()`
//!    of an `AsyncLocalStorage`, a read of a store of a package on
//!    [`CONTEXT_STORES`] (`this.cls.get("museumId")` of `nestjs-cls`), and a member
//!    of the request a provider is given by `@Inject(REQUEST)` (`this.req.curator`,
//!    read as a holder's member is). A local bound to `ctx.switchToHttp()
//!    .getRequest()` is the request. What a guard, a middleware or a strategy puts
//!    on the request is a binding of the caller under that key (source 5), unless
//!    it is what the request sent or a literal ([`identity_value`]).
//! 9. A module-level binding a function of its file writes a parameter's value onto
//!    (`setMuseum(id) { current = id }`): a holder set per request
//!    ([`request_holders`]).
//!
//! **Not the caller's:** what the request sent ([`REQUEST_VALUES`]: `params`,
//! `query`, `body`, `headers`, `cookies`, `searchParams`, a tRPC `input`, form
//! data, `cookies()` and `headers()` of Next.js), the environment and settings
//! (`process.env.X`, a value a module binds), a literal, and what any other call
//! returns.
//!
//! # The uses that are no scope (closed)
//!
//! A value of the caller is not recorded as used where it is only:
//!
//! - returned by the function, or written to the response (`flow_response`: `res.json(...)`, `NextResponse.json(...)`, `c.json(...)`,
//!   `reply.send(...)`, `new Response(...)`, a header or a cookie of the response);
//! - logged with `console`;
//! - converted ([`CONVERSIONS`], [`PASS_METHODS`], [`PASS_CONSTRUCTORS`]): the value
//!   converted is still the caller's;
//! - put in a local collection (`ids.push(...)`, `params.set(...)`): the collection
//!   then holds it;
//! - bound on a request-scoped holder (source 5);
//! - compared with itself, with `null` or `undefined`, or tested for being there
//!   (the object itself, or a member on [`PRESENCE`]: `if (!session?.user?.id)`),
//!   and, in the condition of an exit that answers "not signed in", compared with
//!   another value of the caller or with the request's credential;
//! - compared by order (`<`, `>`) with a literal, a clock or a count: an expiry,
//!   a quota (`bounded`); against a field of a row it is a use;
//!
//! A reader adds the callees that are no scope by what they are, which the
//! lowering cannot know: a logger, an error reporter, a tracer, a rate limiter, a
//! cache invalidation or a redirect (`drift_mine::practices::authz`).
//!
//! # The uses recorded
//!
//! Every call given a value of the caller in an argument at any depth (an object's
//! property, an array, a template, an arm of a conditional), a tagged template, a
//! `new`, a method called on one that is no conversion (`user.can(...)`), a
//! comparison for equality anywhere (`===`, `!==`, `includes`, `some`, `find`,
//! `filter`, ...), a `switch` on one, an index by one, and a test of one that is
//! not a test for presence (`session.user.isAdmin ? all : mine`).

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_ast::ast::*;
use oxc_semantic::SymbolId;

use super::{Collector, RawBase, RawOperand, RawRef, call_name, peel, unwrap_expr};

/// Packages whose store holds what a guard or a middleware put there for the
/// request (source 8).
const CONTEXT_STORES: &[&str] = &[
    "nestjs-cls",
    "cls-hooked",
    "express-http-context",
    "express-http-context2",
    "express-cls-hooked",
    "cls-rtracer",
];

/// A value that may be who calls, put on the request: not a literal, not
/// `null`/`undefined`, not a member of what the request sent (`req.headers.x`).
fn identity_value(e: &Expression) -> bool {
    match peel(e) {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::BinaryExpression(_)
        | Expression::UnaryExpression(_) => false,
        Expression::Identifier(id) => id.name != "undefined",
        Expression::StaticMemberExpression(m) => {
            let mut cur = &m.object;
            let mut names = vec![m.property.name.as_str()];
            while let Expression::StaticMemberExpression(o) = peel(cur) {
                names.push(o.property.name.as_str());
                cur = &o.object;
            }
            !names.iter().any(|n| REQUEST_VALUES.contains(n))
                && matches!(
                    peel(cur),
                    Expression::Identifier(_)
                        | Expression::CallExpression(_)
                        | Expression::AwaitExpression(_)
                        | Expression::ThisExpression(_)
                )
        }
        Expression::CallExpression(c) => !matches!(
            call_name(&c.callee),
            Some("now" | "randomUUID" | "uuid" | "nanoid" | "Date" | "String" | "Number")
        ),
        Expression::AwaitExpression(_) | Expression::NewExpression(_) => true,
        Expression::ConditionalExpression(c) => {
            identity_value(&c.consequent) || identity_value(&c.alternate)
        }
        Expression::LogicalExpression(l) => identity_value(&l.left) || identity_value(&l.right),
        _ => false,
    }
}

/// The members the key of a record is read by, as the Python lowering reads them:
/// `user.id`, `user.pk`, and the subject a token names (`claims.sub`).
const RECORD_KEYS: &[&str] = &["id", "pk", "sub"];

/// Sign-in accessors, by name (source 1).
const CALLER_ACCESSORS: &[&str] = &[
    "auth",
    "getAuth",
    "currentUser",
    "getCurrentUser",
    "getUser",
    "getUserId",
    "getSession",
    "getServerSession",
    "getServerAuthSession",
    "getSessionUser",
    "getToken",
    "getKindeServerSession",
    "getIronSession",
    "getClaims",
    "validateRequest",
    "validateSession",
    "verifySession",
    "verifyToken",
    "verifyIdToken",
    "verifyJwt",
    "verifyAccessToken",
    "jwtVerify",
    "decodeJwt",
    "requireUser",
    "requireAuth",
    "requireSession",
    "requireUserId",
    "protect",
];

/// Accessors that are also the name of a loader of rows: the caller's only when
/// called with nothing or with the request.
const ARGUMENT_SENSITIVE: &[&str] = &["getUser", "getUserId", "currentUser", "getCurrentUser"];

/// Parameters that are a request, a response or a request-scoped context.
const HOLDER_PARAMS: &[&str] = &[
    "req", "request", "res", "response", "reply", "c", "ctx", "context",
];

/// Members of any parameter that are a holder themselves (`opts.ctx.user`,
/// `ctx.req.user`).
const HOLDER_MEMBERS: &[&str] = &["ctx", "context", "req", "request"];

/// Members of a holder that hold what the application put there, one level down
/// (`res.locals.user`, `c.var.user`, `ctx.state.user`).
const HOLDER_STORES: &[&str] = &["locals", "var", "state"];

/// Members of a holder that hold what the request sent, and methods that read it.
const REQUEST_VALUES: &[&str] = &[
    "body",
    "query",
    "params",
    "param",
    "headers",
    "header",
    "cookies",
    "cookie",
    "nextUrl",
    "url",
    "originalUrl",
    "baseUrl",
    "path",
    "method",
    "hostname",
    "host",
    "ip",
    "ips",
    "protocol",
    "json",
    "formData",
    "text",
    "arrayBuffer",
    "blob",
    "searchParams",
    "input",
    "rawInput",
    "parsedInput",
    "valid",
    "parseBody",
    "queries",
    "files",
    "file",
    "get",
];

/// Members of a holder that are the framework's own.
const FRAMEWORK_MEMBERS: &[&str] = &[
    "log",
    "logger",
    "server",
    "app",
    "raw",
    "socket",
    "signal",
    "connection",
    "routeOptions",
    "res",
    "env",
    "executionCtx",
    "event",
    "next",
    "status",
    "statusCode",
    "id",
];

/// The last word of a name that says the caller.
const CALLER_WORDS: &[&str] = &[
    "user",
    "session",
    "auth",
    "claims",
    "principal",
    "identity",
    "viewer",
    "actor",
    "caller",
    "me",
];

/// The last word of a holder's key that says the caller or the caller's tenant,
/// beyond [`CALLER_WORDS`].
const HOLDER_WORDS: &[&str] = &[
    "member",
    "membership",
    "jwt",
    "token",
    "payload",
    "tenant",
    "org",
    "organization",
    "organisation",
    "workspace",
    "team",
    "account",
    "company",
];

/// Global functions and static methods whose value is what they were given.
const CONVERSIONS: &[&str] = &[
    "String",
    "Number",
    "BigInt",
    "Boolean",
    "parseInt",
    "parseFloat",
    "encodeURIComponent",
    "decodeURIComponent",
    "structuredClone",
    "JSON.stringify",
    "JSON.parse",
    "Object.assign",
    "Object.entries",
    "Object.values",
    "Object.keys",
    "Object.fromEntries",
    "Object.freeze",
    "Array.from",
    "Promise.resolve",
    "Promise.all",
];

/// Methods whose value is still the value they were called on.
const PASS_METHODS: &[&str] = &[
    "toString",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "valueOf",
    "toJSON",
    "toHexString",
    "toISOString",
    "slice",
    "substring",
    "split",
    "at",
    "concat",
    "join",
    "flat",
    "map",
    "get",
    "entries",
    "values",
    "keys",
    "then",
    "catch",
    "finally",
    "forEach",
];

/// Methods that compare the value they are called on, or the one they are given.
const COMPARE_METHODS: &[&str] = &[
    "includes",
    "has",
    "some",
    "every",
    "find",
    "findIndex",
    "findLast",
    "filter",
    "indexOf",
    "startsWith",
    "endsWith",
    "equals",
    "localeCompare",
];

/// Methods that give their callback an element of what they are called on.
const ELEMENT_METHODS: &[&str] = &[
    "map",
    "filter",
    "some",
    "every",
    "find",
    "findIndex",
    "forEach",
    "flatMap",
    "then",
];

/// Methods that put what they are given in the local they are called on.
const COLLECT_METHODS: &[&str] = &["push", "unshift", "add", "set", "append"];

/// Classes whose instance is still the value it was built from.
const PASS_CONSTRUCTORS: &[&str] = &[
    "ObjectId",
    "Date",
    "URL",
    "URLSearchParams",
    "Headers",
    "Map",
    "Set",
    "Array",
    "String",
    "Number",
];

/// The last member of a value tested for being there.
const PRESENCE: &[&str] = &[
    "user",
    "session",
    "id",
    "userId",
    "user_id",
    "sub",
    "uid",
    "email",
    "data",
    "auth",
    "claims",
    "token",
    "accessToken",
    "payload",
    "identity",
    "principal",
    "length",
];

/// Methods of a response that write to it.
const RESPONSE_SINKS: &[&str] = &[
    "json",
    "send",
    "text",
    "html",
    "body",
    "redirect",
    "sendStatus",
    "end",
    "sendFile",
    "render",
    "jsonp",
    "status",
    "code",
    "type",
    "header",
    "setHeader",
    "set",
    "cookie",
    "append",
    "write",
    "view",
    "newResponse",
];

/// Receivers named for a response.
const RESPONSES: &[&str] = &["res", "response", "reply", "c", "h"];

/// Nest decorators of a parameter that hand it what the request sent, or the
/// request itself.
const INPUT_DECORATORS: &[&str] = &[
    "Body",
    "Query",
    "Param",
    "Headers",
    "Req",
    "Request",
    "Res",
    "Response",
    "Next",
    "Ip",
    "HostParam",
    "UploadedFile",
    "UploadedFiles",
    "Cookies",
    "Args",
    "Payload",
];

/// The words of a camel-case or snake-case name, lower case.
fn words(name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in name.chars() {
        if !c.is_ascii_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        cur.push(c.to_ascii_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// `name` is one of the sign-in accessors a call is read as by its name
/// (source 1, [`CALLER_ACCESSORS`]).
pub(super) fn accessor_name(name: &str) -> bool {
    CALLER_ACCESSORS.contains(&name)
}

/// A name that says the caller by its last word (`user`, `currentUser`,
/// `authSession`; not `userId`, which names a value anyone may hold).
fn caller_name(name: &str) -> bool {
    words(name)
        .last()
        .is_some_and(|w| CALLER_WORDS.contains(&w.as_str()))
}

/// A key of a holder that holds the caller, or the caller's tenant or owner
/// (source 3).
fn holder_key(key: &str) -> bool {
    caller_name(key)
        || words(key)
            .last()
            .is_some_and(|w| HOLDER_WORDS.contains(&w.as_str()))
        || drift_core::practice::tenant_key(key)
        || drift_core::practice::owner_key(key)
}

/// A parameter decorator that hands in the caller: any that is not one of Nest's
/// own for the request ([`INPUT_DECORATORS`]) and is named for the caller or the
/// tenant (`@CurrentUser()`, `@AuthUser()`, `@Session()`, `@Tenant()`).
fn caller_decorator(name: &str) -> bool {
    !INPUT_DECORATORS.contains(&name)
        && words(name)
            .iter()
            .any(|w| CALLER_WORDS.contains(&w.as_str()) || HOLDER_WORDS.contains(&w.as_str()))
}

/// The holder a key is bound on, as a reference ([`drift_core::CALLER_HOLDER_TS`]).
fn held(key: &str) -> RawRef {
    RawRef {
        base: RawBase::Global("held".into()),
        member: format!(".{key}"),
    }
}

/// A key a holder can be read by.
fn plain_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Whose a value is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Taint {
    /// The caller's, by sources 1 to 4.
    caller: bool,
    /// A parameter of the function the walk started on, or read off one.
    param: bool,
    /// What may give it (sources 5 and 6): a holder's key, a function called with
    /// nothing or with the request.
    via: Vec<RawRef>,
    /// The caller's by the name of a parameter alone (source 4, undecorated):
    /// whoever calls the function chose the value, and its name is not what it
    /// is. Read since the measured build: the listed reading writes such a
    /// value as the parameter it is read off, for the calls to say what they
    /// pass ([`Taint::proven_own`]).
    named: bool,
}

impl Taint {
    fn caller() -> Self {
        Taint {
            caller: true,
            ..Taint::default()
        }
    }

    fn is_empty(&self) -> bool {
        !self.caller && !self.param && self.via.is_empty()
    }

    /// A value of the caller by its own source (sources 1 to 4), and of nothing
    /// that only may give one.
    pub(super) fn callers_own(&self) -> bool {
        self.caller && self.via.is_empty()
    }

    /// [`Taint::callers_own`], and not by the name of a parameter alone.
    pub(super) fn proven_own(&self) -> bool {
        self.callers_own() && !self.named
    }

    /// Read off a parameter of the function the walk started on.
    pub(super) fn of_a_parameter(&self) -> bool {
        self.param
    }

    /// A value of the caller, or of what may give one.
    fn of_caller(&self) -> bool {
        self.caller || !self.via.is_empty()
    }

    /// What may have given the value, where nothing says it is the caller's by its
    /// own source: the functions called with nothing or with the request.
    pub(super) fn given_by(&self) -> &[RawRef] {
        match self.caller {
            true => &[],
            false => &self.via,
        }
    }

    fn join(&mut self, other: Taint) {
        self.caller |= other.caller;
        self.param |= other.param;
        self.named |= other.named;
        for v in other.via {
            if !self.via.contains(&v) && self.via.len() < 4 {
                self.via.push(v);
            }
        }
    }
}

/// What a [`Collector`] gathers of the values of the caller in a body.
#[derive(Default)]
pub(super) struct Flow {
    /// Locals bound to a value of the caller, of a parameter or of a giver.
    locals: HashMap<SymbolId, Taint>,
    /// The parameters of the function the walk started on.
    own_params: HashSet<SymbolId>,
    /// Each of them by its name and where a call gives it: its position in the
    /// function's parameters (`#0`), and for a name bound by a pattern the keys it
    /// is read under (`#0.userId` of `({ userId })`).
    pub(super) own_at: HashMap<SymbolId, (String, String)>,
    /// Parameters decorated to receive the caller.
    caller_params: HashSet<SymbolId>,
    /// The parameters of a method whose body is walked by itself
    /// ([`Collector::flow_method_params`]), by name.
    params: HashMap<SymbolId, String>,
    /// The callees given a value of the caller, with what may give it.
    pub(super) caller_args: BTreeSet<(RawRef, Option<RawRef>)>,
    /// A use of a value of the caller with no callee to name.
    pub(super) unread: bool,
    /// A use of a value of one of the function's own parameters (a rest
    /// parameter and a member of one only named like a holder included), or a
    /// `return` of one: what is handed back is used where the call's value is.
    pub(super) param_flows: bool,
    /// What the function the walk started on returns: a value of the caller, and
    /// anything else that is a value.
    returns_caller: bool,
    returns_other: bool,
    /// The functions called with nothing or with the request whose value a
    /// `return` gives, and that some `return` gives a value that is neither the
    /// caller's nor such a call's.
    returns_given: BTreeSet<RawRef>,
    returns_else: bool,
    /// The callees of the repository whose call's value the body takes as the
    /// caller (source 1): [`drift_core::controls::CALLER_FROM`].
    pub(super) caller_from: std::cell::RefCell<BTreeSet<RawRef>>,
    /// The keys named for the caller the body reads off a holder as who calls
    /// ([`drift_core::controls::READS_HELD`]).
    pub(super) held_read: std::cell::RefCell<BTreeSet<String>>,
    /// The keys named for the caller the body binds on a holder to what the
    /// request sent ([`drift_core::controls::HOLDS_SENT`]).
    pub(super) holds_sent: BTreeSet<String>,
    /// Locals bound to what a keyed store of the file handed back under a key
    /// that is the caller's by its own source (`const cached =
    /// CACHE.get(JSON.stringify(token))`), by the store
    /// ([`Collector::kept_read`]).
    kept_locals: HashMap<SymbolId, String>,
    /// The stores a `return` hands back such a read of.
    returns_kept: BTreeSet<String>,
    /// Each `set` on a keyed store of the file: the store, and whether the key
    /// is the caller's by its own source and the value a value of the caller
    /// (`CACHE.set(JSON.stringify(token), session)`).
    pub(super) keeps: BTreeSet<(String, bool)>,
    /// The locals bound to the caller itself or the key of the caller's record
    /// ([`Collector::caller_self`]) and never bound again, with what may give it.
    self_locals: HashMap<SymbolId, Vec<RawRef>>,
    /// The tags of the tagged templates of the body.
    pub(super) tags: BTreeSet<RawRef>,
    /// Walking the condition of an exit that answers "not signed in".
    pub(super) authn_test: u32,
}

impl Flow {
    /// The function's own body returns a value of the caller wherever it returns a
    /// value ([`drift_core::controls::RETURNS_CALLER`]).
    pub(super) fn returns_caller(&self) -> bool {
        self.returns_caller && !self.returns_other && self.returns_kept.is_empty()
    }
}

impl Flow {
    /// The keyed stores of the file whose read under a key of the caller's the
    /// function hands back, where every other `return` that gives a value gives
    /// a value of the caller ([`super::RawSymbol::returns_kept`]).
    pub(super) fn returns_kept(&self) -> impl Iterator<Item = &String> {
        self.returns_kept.iter().filter(|_| !self.returns_other)
    }
}

impl Flow {
    /// The functions whose value the function hands back, where every `return`
    /// that gives a value gives a value of the caller or what one of them gave
    /// ([`super::RawSymbol::returns_via`]).
    pub(super) fn returns_via(&self) -> impl Iterator<Item = &RawRef> {
        self.returns_given.iter().filter(|_| !self.returns_else)
    }
}

impl Flow {
    /// `s` is a parameter of the function the walk started on.
    pub(super) fn own_param(&self, s: SymbolId) -> bool {
        self.own_params.contains(&s)
    }
}

impl<'l, 's> Collector<'l, 's> {
    /// Notes the parameters of a function being entered: those of the function
    /// the walk started on, and those decorated to receive the caller.
    pub(super) fn flow_params(&mut self, params: &FormalParameters) {
        fn names(p: &BindingPattern, out: &mut Vec<SymbolId>) {
            match p {
                BindingPattern::BindingIdentifier(b) => out.extend(b.symbol_id.get()),
                BindingPattern::AssignmentPattern(a) => names(&a.left, out),
                BindingPattern::ObjectPattern(o) => {
                    for prop in &o.properties {
                        names(&prop.value, out);
                    }
                    if let Some(r) = &o.rest {
                        names(&r.argument, out);
                    }
                }
                BindingPattern::ArrayPattern(a) => {
                    for el in a.elements.iter().flatten() {
                        names(el, out);
                    }
                }
            }
        }
        // Each name a pattern binds, with the keys it is read under: a key that
        // cannot be written in a side (computed, not an identifier), an item of a
        // list and the rest of an object are read under what holds them.
        fn paths(p: &BindingPattern, at: String, out: &mut Vec<(SymbolId, String)>) {
            match p {
                BindingPattern::BindingIdentifier(b) => {
                    out.extend(b.symbol_id.get().map(|s| (s, at)));
                }
                BindingPattern::AssignmentPattern(a) => paths(&a.left, at, out),
                BindingPattern::ObjectPattern(o) => {
                    for prop in &o.properties {
                        let key = (!prop.computed)
                            .then(|| super::key_name(&prop.key))
                            .flatten()
                            .filter(|k| super::side_key(k));
                        let under = match key {
                            Some(k) => format!("{at}.{k}"),
                            None => at.clone(),
                        };
                        paths(&prop.value, under, out);
                    }
                    if let Some(r) = &o.rest {
                        paths(&r.argument, at, out);
                    }
                }
                BindingPattern::ArrayPattern(a) => {
                    for el in a.elements.iter().flatten() {
                        paths(el, at.clone(), out);
                    }
                }
            }
        }
        let own = self.fn_depth == 1;
        // `(...args)`: a parameter as any other.
        if own
            && let Some(rest) = &params.rest
            && let BindingPattern::BindingIdentifier(b) = &rest.rest.argument
            && let Some(s) = b.symbol_id.get()
        {
            self.flow.own_params.insert(s);
            self.flow.params.insert(s, b.name.to_string());
        }
        for (at, item) in params.items.iter().enumerate() {
            let mut found = Vec::new();
            names(&item.pattern, &mut found);
            if own {
                let mut under = Vec::new();
                paths(&item.pattern, format!("#{at}"), &mut under);
                for (s, token) in under {
                    let name = self.l.scoping.symbol_name(s).to_string();
                    self.flow.own_at.insert(s, (name, token));
                }
            }
            let decorated = item.decorators.iter().any(|d| {
                let e = match unwrap_expr(&d.expression) {
                    Expression::CallExpression(c) => &c.callee,
                    e => e,
                };
                call_name(e).is_some_and(caller_decorator)
            });
            for s in &found {
                if own {
                    self.flow.own_params.insert(*s);
                }
                if decorated {
                    self.flow.caller_params.insert(*s);
                }
            }
            // `({ ctx: { depot } })`: a member of a holder, destructured where the
            // parameter is declared.
            if let BindingPattern::ObjectPattern(o) = &item.pattern {
                for prop in &o.properties {
                    let (Some(holder), BindingPattern::ObjectPattern(inner)) =
                        (super::key_name(&prop.key), &prop.value)
                    else {
                        continue;
                    };
                    if !HOLDER_MEMBERS.contains(&holder.as_str()) {
                        continue;
                    }
                    for p in &inner.properties {
                        let Some(key) = super::key_name(&p.key) else {
                            continue;
                        };
                        let t = self.holder_taint(&[key.as_str()], own);
                        let mut bound = Vec::new();
                        names(&p.value, &mut bound);
                        for s in bound {
                            if !t.is_empty() {
                                self.flow.locals.insert(s, t.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    /// The name of a parameter of a function being walked.
    fn flow_param(&self, s: SymbolId) -> Option<&String> {
        self.p.params.get(&s).or_else(|| self.flow.params.get(&s))
    }

    /// The parameters of a method whose body is walked without its signature (a
    /// NestJS route's): the function's own.
    pub(super) fn flow_method_params(&mut self, params: &FormalParameters) {
        fn names(p: &BindingPattern, out: &mut Vec<(SymbolId, String)>) {
            match p {
                BindingPattern::BindingIdentifier(b) => {
                    if let Some(s) = b.symbol_id.get() {
                        out.push((s, b.name.to_string()));
                    }
                }
                BindingPattern::AssignmentPattern(a) => names(&a.left, out),
                BindingPattern::ObjectPattern(o) => {
                    for prop in &o.properties {
                        names(&prop.value, out);
                    }
                }
                BindingPattern::ArrayPattern(a) => {
                    for el in a.elements.iter().flatten() {
                        names(el, out);
                    }
                }
            }
        }
        let mut found = Vec::new();
        for item in &params.items {
            names(&item.pattern, &mut found);
        }
        self.flow.params.extend(found);
        let depth = std::mem::replace(&mut self.fn_depth, 1);
        self.flow_params(params);
        self.fn_depth = depth;
    }

    /// Whose the member `segs` of a holder is.
    fn holder_taint(&self, segs: &[&str], own: bool) -> Taint {
        // `res.locals.user`, `c.var.user`; `ctx.req.user`, and Hono's `c.req`, which
        // is the request.
        let mut i = 0;
        while i < segs.len()
            && (HOLDER_STORES.contains(&segs[i]) || HOLDER_MEMBERS.contains(&segs[i]))
        {
            i += 1;
        }
        let mut t = Taint::default();
        match segs.get(i) {
            // The holder itself: the request handed on is no value of a
            // parameter (what is done with it is read where it is done).
            None => {}
            Some(k) if REQUEST_VALUES.contains(k) || FRAMEWORK_MEMBERS.contains(k) => {}
            Some(k) if holder_key(k) => {
                t.caller = true;
                if plain_key(k) {
                    self.flow.held_read.borrow_mut().insert((*k).to_string());
                }
            }
            // Any other key: what a body of the repository bound on the holder,
            // or, in a helper whose parameter is only named like one, a member
            // of what it was given.
            Some(k) => {
                t.param = own;
                if plain_key(k) {
                    t.via.push(held(k));
                }
            }
        }
        t
    }

    /// Whose the member `segs` of the parameter `name` is.
    fn param_taint(&self, s: SymbolId, name: &str, segs: &[&str]) -> Taint {
        let own = self.flow.own_params.contains(&s);
        if self.flow.caller_params.contains(&s) || caller_name(name) {
            return Taint {
                caller: true,
                param: own,
                via: Vec::new(),
                named: !self.flow.caller_params.contains(&s),
            };
        }
        if HOLDER_PARAMS.contains(&name) {
            return self.holder_taint(segs, own);
        }
        if let Some(first) = segs.first()
            && HOLDER_MEMBERS.contains(first)
        {
            return self.holder_taint(&segs[1..], own);
        }
        Taint {
            param: own,
            ..Taint::default()
        }
    }

    /// Whose a value is ([`Taint`]).
    pub(super) fn taint(&self, e: &Expression) -> Taint {
        self.taint_path(e, &[], 0)
    }

    /// Whose the member `extra` of a value is.
    fn taint_path<'b, 'a>(&self, e: &'b Expression<'a>, extra: &[&'b str], depth: usize) -> Taint {
        if depth > 12 {
            return Taint::default();
        }
        let mut segs: Vec<&str> = Vec::new();
        let mut cur = peel(e);
        loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    segs.push(m.property.name.as_str());
                    cur = peel(&m.object);
                }
                Expression::ComputedMemberExpression(m) => {
                    segs.push(match unwrap_expr(&m.expression) {
                        Expression::StringLiteral(l) => l.value.as_str().unwrap_or("[]"),
                        _ => "[]",
                    });
                    cur = peel(&m.object);
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        segs.push(m.property.name.as_str());
                        cur = peel(&m.object);
                    }
                    ChainElement::ComputedMemberExpression(m) => {
                        segs.push(match unwrap_expr(&m.expression) {
                            Expression::StringLiteral(l) => l.value.as_str().unwrap_or("[]"),
                            _ => "[]",
                        });
                        cur = peel(&m.object);
                    }
                    ChainElement::CallExpression(call) => {
                        return self.taint_call(call, depth);
                    }
                    _ => return Taint::default(),
                },
                _ => break,
            }
        }
        segs.reverse();
        segs.extend(extra);
        let both = |a: &'b Expression<'a>, b: &'b Expression<'a>| {
            let mut t = self.taint_path(a, &segs, depth + 1);
            t.join(self.taint_path(b, &segs, depth + 1));
            t
        };
        match cur {
            // `this.req.curator.museumId` of a provider given the request
            // (`@Inject(REQUEST) private req: Request`): a member of the request.
            Expression::ThisExpression(_)
                if segs
                    .first()
                    .is_some_and(|f| self.l.this_request.borrow().contains(*f)) =>
            {
                self.holder_taint(&segs[1..], false)
            }
            Expression::Identifier(id) => {
                let Some(s) = self.symbol_of(id) else {
                    return Taint::default();
                };
                // A module-level holder set per request (source 9).
                if self.l.request_holders.contains(&s) {
                    return Taint::caller();
                }
                if let Some(t) = self.flow.locals.get(&s) {
                    return t.clone();
                }
                match self.flow_param(s) {
                    Some(name) => self.param_taint(s, name, &segs),
                    None => Taint::default(),
                }
            }
            Expression::CallExpression(c) => self.taint_call(c, depth),
            Expression::NewExpression(n) => {
                let mut t = Taint::default();
                if call_name(&n.callee).is_some_and(|c| PASS_CONSTRUCTORS.contains(&c)) {
                    for a in &n.arguments {
                        t.join(self.taint_argument(a, depth));
                    }
                }
                t
            }
            Expression::ConditionalExpression(c) => both(&c.consequent, &c.alternate),
            Expression::LogicalExpression(l) => both(&l.left, &l.right),
            Expression::BinaryExpression(b) if b.operator == BinaryOperator::Addition => {
                both(&b.left, &b.right)
            }
            Expression::TemplateLiteral(t) => {
                let mut out = Taint::default();
                for x in &t.expressions {
                    out.join(self.taint_path(x, &[], depth + 1));
                }
                out
            }
            Expression::ObjectExpression(o) => {
                let mut out = Taint::default();
                for p in &o.properties {
                    match p {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            out.join(self.taint_path(&p.value, &[], depth + 1));
                        }
                        ObjectPropertyKind::SpreadProperty(s) => {
                            out.join(self.taint_path(&s.argument, &[], depth + 1));
                        }
                    }
                }
                out
            }
            Expression::ArrayExpression(a) => {
                let mut out = Taint::default();
                for el in &a.elements {
                    match el {
                        ArrayExpressionElement::SpreadElement(s) => {
                            out.join(self.taint_path(&s.argument, &[], depth + 1));
                        }
                        other => {
                            if let Some(x) = other.as_expression() {
                                out.join(self.taint_path(x, &[], depth + 1));
                            }
                        }
                    }
                }
                out
            }
            Expression::AssignmentExpression(a) => self.taint_path(&a.right, &segs, depth + 1),
            Expression::SequenceExpression(s) => s
                .expressions
                .last()
                .map(|x| self.taint_path(x, &segs, depth + 1))
                .unwrap_or_default(),
            _ => Taint::default(),
        }
    }

    fn taint_argument(&self, a: &Argument, depth: usize) -> Taint {
        match a {
            Argument::SpreadElement(s) => self.taint_path(&s.argument, &[], depth + 1),
            other => other
                .as_expression()
                .map(|x| self.taint_path(x, &[], depth + 1))
                .unwrap_or_default(),
        }
    }

    /// A global function or static method on [`CONVERSIONS`].
    fn conversion(&self, callee: &Expression) -> bool {
        match unwrap_expr(callee) {
            Expression::Identifier(id) => {
                self.symbol_of(id).is_none() && CONVERSIONS.contains(&id.name.as_str())
            }
            Expression::StaticMemberExpression(m) => match unwrap_expr(&m.object) {
                Expression::Identifier(id) if self.symbol_of(id).is_none() => {
                    CONVERSIONS.contains(&format!("{}.{}", id.name, m.property.name).as_str())
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// The object a method is called on, and the method.
    fn method<'b, 'a>(callee: &'b Expression<'a>) -> Option<(&'b Expression<'a>, &'b str)> {
        match unwrap_expr(callee) {
            Expression::StaticMemberExpression(m) => Some((&m.object, m.property.name.as_str())),
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => {
                    Some((&m.object, m.property.name.as_str()))
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// The key a call reads off a context (`c.get("user")`), or binds on one
    /// (`c.set("user", claims)`).
    fn holder_call<'b>(&self, c: &'b CallExpression<'_>, method: &str) -> Option<&'b str> {
        let (object, name) = Self::method(&c.callee)?;
        if name != method {
            return None;
        }
        let Expression::Identifier(id) = unwrap_expr(object) else {
            return None;
        };
        let s = self.symbol_of(id)?;
        let param = self.flow_param(s)?;
        if !matches!(param.as_str(), "c" | "ctx" | "context") {
            return None;
        }
        match c.arguments.first()?.as_expression().map(unwrap_expr) {
            Some(Expression::StringLiteral(l)) => l.value.as_str().filter(|k| plain_key(k)),
            _ => None,
        }
    }

    /// An argument is the request or the context, read off one, or an object of
    /// such (`getToken({ req })`).
    fn request_like(&self, e: &Expression) -> bool {
        let mut cur = peel(e);
        loop {
            match cur {
                Expression::StaticMemberExpression(m) => cur = peel(&m.object),
                Expression::Identifier(id) => {
                    return self
                        .symbol_of(id)
                        .and_then(|s| self.flow_param(s))
                        .is_some_and(|name| HOLDER_PARAMS.contains(&name.as_str()));
                }
                Expression::ObjectExpression(o) => {
                    return o.properties.iter().all(|p| match p {
                        ObjectPropertyKind::ObjectProperty(p) => self.request_like(&p.value),
                        ObjectPropertyKind::SpreadProperty(_) => false,
                    });
                }
                _ => return false,
            }
        }
    }

    /// The call is of a sign-in accessor (source 1).
    fn accessor(&self, c: &CallExpression, callee: Option<&RawRef>) -> bool {
        // The imported name of an import called by itself, else the name written.
        let name = match callee {
            Some(RawRef {
                base: RawBase::Import { name, .. },
                member,
            }) if member.is_empty() && name != "default" && name != "*" => name.as_str(),
            _ => match call_name(&c.callee) {
                Some(n) => n,
                None => return false,
            },
        };
        let plain = || {
            c.arguments
                .iter()
                .all(|a| a.as_expression().is_some_and(|x| self.request_like(x)))
        };
        if CALLER_ACCESSORS.contains(&name) {
            return !ARGUMENT_SENSITIVE.contains(&name) || plain();
        }
        matches!(name, "verify" | "decode")
            && matches!(callee, Some(RawRef { base: RawBase::Import { spec, .. }, .. })
                if drift_core::guard_lists::verifying_package(spec))
    }

    /// The value is the caller itself or the key of the caller's record, and
    /// nothing else read off the caller: what a call that gives the caller handed
    /// back, whole (`await requireUserId(request)`); the key of a value of the
    /// caller ([`RECORD_KEYS`]: `session.user.id`, `claims.sub`); a conversion of
    /// one (`String(session.user.id)`); a local bound to one and never bound
    /// again. Rows a query narrows to it are this caller's and no one else's,
    /// whatever the key is called; a group or a setting of the caller
    /// (`session.user.orgId`) is not it. What may give it (nothing where it is the
    /// caller's by its own source), for linking to say whether each gives the
    /// caller.
    pub(super) fn caller_self(&self, e: &Expression) -> Option<Vec<RawRef>> {
        self.caller_self_at(e, 0)
    }

    fn caller_self_at(&self, e: &Expression, depth: usize) -> Option<Vec<RawRef>> {
        if depth > 6 {
            return None;
        }
        let whole = |t: Taint| (!t.param && !t.named && t.of_caller()).then_some(t.via);
        match peel(e) {
            Expression::Identifier(id) => {
                let s = self.symbol_of(id)?;
                self.flow.self_locals.get(&s).cloned()
            }
            Expression::CallExpression(c) => {
                if self.conversion(&c.callee) {
                    return match c.arguments.as_slice() {
                        [a] => a
                            .as_expression()
                            .and_then(|x| self.caller_self_at(x, depth + 1)),
                        _ => None,
                    };
                }
                // A read of a holder or a store gives what was put under the key,
                // and a method that passes its object on gives a part of it.
                if self.holder_call(c, "get").is_some()
                    || self.context_store(c)
                    || Self::method(&c.callee)
                        .is_some_and(|(_, m)| m == "getStore" || PASS_METHODS.contains(&m))
                {
                    return None;
                }
                whole(self.taint_call(c, 0))
            }
            Expression::StaticMemberExpression(m)
                if RECORD_KEYS.contains(&m.property.name.as_str()) =>
            {
                whole(self.taint(&m.object))
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m)
                    if RECORD_KEYS.contains(&m.property.name.as_str()) =>
                {
                    whole(self.taint(&m.object))
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// The value is a value of the caller, whatever it says of the caller, and
    /// nothing of a parameter: what may give it ([`Collector::caller_self`]).
    pub(super) fn caller_side(&self, e: &Expression) -> Option<Vec<RawRef>> {
        let t = self.taint(e);
        (!t.param && !t.named && t.of_caller()).then_some(t.via)
    }

    /// Whose the value a call hands back is.
    fn taint_call(&self, c: &CallExpression, depth: usize) -> Taint {
        if let Some(k) = self.holder_call(c, "get") {
            return self.holder_taint(&[k], false);
        }
        let method = Self::method(&c.callee);
        // A request-scoped store (source 8): what a store of the request gives
        // (`store.getStore()` of an `AsyncLocalStorage`, `this.cls.get("museumId")`
        // of `nestjs-cls`, `httpContext.get("user")`) is what a guard or a
        // middleware put there for this request.
        if method.is_some_and(|(_, m)| m == "getStore") || self.context_store(c) {
            return Taint::caller();
        }
        // A conversion: what it was given, or called on.
        if self.conversion(&c.callee) {
            let mut t = Taint::default();
            for a in &c.arguments {
                t.join(self.taint_argument(a, depth));
            }
            return t;
        }
        if let Some((object, name)) = method
            && PASS_METHODS.contains(&name)
        {
            let t = self.taint_path(object, &[], depth + 1);
            if !t.is_empty() {
                return t;
            }
        }
        let callee = self.l.canon_callee(&c.callee);
        if self.accessor(c, callee.as_ref()) {
            if let Some(r) = &callee
                && !matches!(r.base, RawBase::Global(_))
            {
                self.flow.caller_from.borrow_mut().insert(r.clone());
            }
            return Taint::caller();
        }
        // What a function called with nothing, or with the request, hands back.
        let mut t = Taint::default();
        if let Some(r) = callee
            && !matches!(r.base, RawBase::Global(_))
            && c.arguments
                .iter()
                .all(|a| a.as_expression().is_some_and(|x| self.request_like(x)))
        {
            t.via.push(r);
        }
        t
    }

    /// A read of a request-scoped store of a package on [`CONTEXT_STORES`]
    /// (`this.cls.get(...)`, `cls.get(...)`, `httpContext.get(...)`).
    fn context_store(&self, c: &CallExpression) -> bool {
        let Some((_, m)) = Self::method(&c.callee) else {
            return false;
        };
        if !matches!(m, "get" | "getStore" | "getContext") {
            return false;
        }
        matches!(self.l.canon_callee(&c.callee), Some(RawRef { base: RawBase::Import { spec, .. }, .. })
            if CONTEXT_STORES.iter().any(|p| spec == *p || spec.starts_with(&format!("{p}/"))))
    }

    /// Records a use of a value: by the callee it is handed to, or with none.
    fn flow_use(&mut self, callee: Option<RawRef>, t: &Taint) {
        if t.param {
            self.flow.param_flows = true;
        }
        if t.caller {
            match &callee {
                Some(r) => {
                    self.flow.caller_args.insert((r.clone(), None));
                }
                None => self.flow.unread = true,
            }
        }
        for g in &t.via {
            let entry = match &callee {
                Some(r) => (r.clone(), Some(g.clone())),
                None => (g.clone(), Some(g.clone())),
            };
            if self.flow.caller_args.len() < 64 {
                self.flow.caller_args.insert(entry);
            }
        }
    }

    /// A value bound on a request-scoped holder under `key` (source 5).
    fn flow_hold(&mut self, key: &str, t: &Taint) {
        if !plain_key(key) || holder_key(key) {
            return;
        }
        if t.caller {
            self.flow.caller_args.insert((held(key), None));
        }
        for g in &t.via {
            if *g != held(key) {
                self.flow.caller_args.insert((held(key), Some(g.clone())));
            }
        }
    }

    /// The call writes to the response: `res.json(x)`, `res.status(200).send(x)`,
    /// `reply.code(200).send(x)`, `c.json(x)`, `Response.json(x)`,
    /// `NextResponse.json(x)`.
    fn flow_response(&self, callee: &Expression) -> bool {
        let Some((mut object, name)) = Self::method(callee) else {
            return false;
        };
        if !RESPONSE_SINKS.contains(&name) {
            return false;
        }
        loop {
            match unwrap_expr(object) {
                Expression::Identifier(id) => {
                    return match self.symbol_of(id) {
                        Some(s) => self
                            .p
                            .params
                            .get(&s)
                            .is_some_and(|n| RESPONSES.contains(&n.as_str())),
                        None => id.name == "Response",
                    } || self
                        .l
                        .canon(object)
                        .is_some_and(|r| super::is_next_response(&r));
                }
                Expression::CallExpression(c) => match Self::method(&c.callee) {
                    Some((o, n)) if RESPONSE_SINKS.contains(&n) => object = o,
                    _ => return false,
                },
                _ => return false,
            }
        }
    }

    /// A call: what it is given, and what it is called on.
    /// The keyed store of the file a call reads or fills: what `get` or `set` is
    /// called on directly, where that is a top-level declaration of the file
    /// (`CACHE.get(key)` of `const CACHE = new LRUCache(...)`).
    fn keyed_store(&self, c: &CallExpression, method: &str) -> Option<String> {
        let (_, name) = Self::method(&c.callee)?;
        if name != method {
            return None;
        }
        match self.l.canon_callee(&c.callee)? {
            RawRef {
                base: RawBase::Local(store),
                member,
            } if member.len() == method.len() + 1 => Some(store),
            _ => None,
        }
    }

    /// `e` is what a keyed store of the file handed back under a key that is the
    /// caller's by its own source, or a local bound to that: the store. What the
    /// store holds under such a key is the caller's where every `set` of the
    /// file puts a value of the caller under one, which linking says
    /// ([`super::RawSymbol::keeps`]).
    pub(super) fn kept_read(&self, e: &Expression) -> Option<String> {
        match peel(e) {
            Expression::Identifier(id) => self.flow.kept_locals.get(&self.symbol_of(id)?).cloned(),
            Expression::CallExpression(c) => {
                let store = self.keyed_store(c, "get")?;
                let [key] = c.arguments.as_slice() else {
                    return None;
                };
                self.taint_argument(key, 0).proven_own().then_some(store)
            }
            _ => None,
        }
    }

    pub(super) fn flow_call(&mut self, it: &CallExpression) {
        if let Some(store) = self.keyed_store(it, "set") {
            let kept = match it.arguments.as_slice() {
                [key, value] => {
                    let value = self.taint_argument(value, 0);
                    self.taint_argument(key, 0).proven_own() && value.caller && !value.named
                }
                _ => false,
            };
            if self.flow.keeps.len() < 16 {
                self.flow.keeps.insert((store, kept));
            }
        }
        // A value bound on a context: `c.set("depot", claims.depotId)`.
        if let Some(key) = self.holder_call(it, "set") {
            let key = key.to_string();
            if let Some(v) = it.arguments.get(1) {
                let t = self.taint_argument(v, 0);
                self.flow_hold(&key, &t);
            }
            return;
        }
        // `next({ ctx: { depot: ctx.session.user.depotId } })`.
        if call_name(&it.callee) == Some("next")
            && let Some(Expression::ObjectExpression(o)) = it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
            && let Some(Expression::ObjectExpression(ctx)) =
                super::routes::object_prop(o, "ctx").map(unwrap_expr)
        {
            for p in &ctx.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = p
                    && let Some(key) = super::key_name(&p.key)
                {
                    let t = self.taint(&p.value);
                    self.flow_hold(&key, &t);
                }
            }
            return;
        }
        let method = Self::method(&it.callee);
        let on = method
            .map(|(object, _)| self.taint(object))
            .unwrap_or_default();
        // A callback of an iteration is given an element of what it runs over.
        if let Some((_, name)) = method
            && !on.is_empty()
            && ELEMENT_METHODS.contains(&name)
            && let Some(f) = it.arguments.first().and_then(|a| a.as_expression())
        {
            let first = match unwrap_expr(f) {
                Expression::ArrowFunctionExpression(f) => f.params.items.first(),
                Expression::FunctionExpression(f) => f.params.items.first(),
                _ => None,
            };
            if let Some(FormalParameter {
                pattern: BindingPattern::BindingIdentifier(b),
                ..
            }) = first
                && let Some(s) = b.symbol_id.get()
            {
                self.flow.locals.insert(s, on.clone());
            }
        }
        let mut given = Taint::default();
        for a in &it.arguments {
            given.join(self.taint_argument(a, 0));
        }
        if given.is_empty() && on.is_empty() {
            return;
        }
        if let Some((_, name)) = method {
            // A comparison by a method: of the value it is called on, or given.
            if COMPARE_METHODS.contains(&name) {
                let mut t = on;
                t.join(given);
                // By its name where it has one (`repo.find({ where })`).
                let callee = self.l.canon_callee(&it.callee);
                self.flow_use(callee, &t);
                return;
            }
            // A method of a value of the caller that is no conversion
            // (`user.can("edit")`, `session.user.getOrganizations()`).
            if !on.is_empty()
                && !PASS_METHODS.contains(&name)
                && !COLLECT_METHODS.contains(&name)
                && self.holder_call(it, "get").is_none()
            {
                // The request's own methods are read where they are read.
                if on.of_caller() {
                    let mut t = on.clone();
                    t.param = false;
                    self.flow_use(None, &t);
                }
            }
        }
        if given.is_empty() {
            return;
        }
        // What is no scope: a response, a log, a conversion, a local collection.
        if self.flow_response(&it.callee) || self.conversion(&it.callee) {
            return;
        }
        if let Some((object, name)) = method {
            // Read off a value of the caller with one (`claims.get(key)`); given
            // one, a lookup by it.
            if PASS_METHODS.contains(&name) && !on.is_empty() {
                return;
            }
            if matches!(unwrap_expr(object), Expression::Identifier(id)
                if id.name == "console" && self.symbol_of(id).is_none())
            {
                return;
            }
            if COLLECT_METHODS.contains(&name)
                && let Expression::Identifier(id) = unwrap_expr(object)
                && let Some(s) = self.symbol_of(id)
                && !self.flow_param(s).is_some()
            {
                self.flow.locals.entry(s).or_default().join(given);
                return;
            }
        }
        let callee = self.l.canon_callee(&it.callee);
        self.flow_use(callee, &given);
    }

    /// `new X(...)` given a value.
    pub(super) fn flow_new(&mut self, it: &NewExpression) {
        let mut given = Taint::default();
        for a in &it.arguments {
            given.join(self.taint_argument(a, 0));
        }
        if given.is_empty() {
            return;
        }
        let name = call_name(&it.callee).unwrap_or_default();
        // A response, an error thrown, a value built from the value.
        if matches!(name, "Response" | "NextResponse")
            || name.ends_with("Error")
            || name.ends_with("Exception")
            || PASS_CONSTRUCTORS.contains(&name)
        {
            return;
        }
        let callee = self.l.canon(&it.callee).map(|mut r| {
            r.member.push_str("(new)");
            r
        });
        self.flow_use(callee, &given);
    }

    /// A tagged template: a call of its tag, given what the template holds.
    pub(super) fn flow_tagged(&mut self, it: &TaggedTemplateExpression) {
        let tag = self.l.canon(&it.tag);
        if let Some(r) = &tag
            && self.flow.tags.len() < 16
        {
            self.flow.tags.insert(r.clone());
        }
        let mut given = Taint::default();
        for x in &it.quasi.expressions {
            given.join(self.taint(x));
        }
        if !given.is_empty() {
            self.flow_use(tag, &given);
        }
    }

    /// The same value on both sides: one name, or one member path of one name.
    fn same_value(&self, a: &Expression, b: &Expression) -> bool {
        fn path<'b>(
            c: &Collector,
            e: &'b Expression<'_>,
            out: &mut Vec<&'b str>,
        ) -> Option<SymbolId> {
            match peel(e) {
                Expression::Identifier(id) => c.symbol_of(id),
                Expression::StaticMemberExpression(m) => {
                    out.push(m.property.name.as_str());
                    path(c, &m.object, out)
                }
                _ => None,
            }
        }
        let (mut pa, mut pb) = (Vec::new(), Vec::new());
        match (path(self, a, &mut pa), path(self, b, &mut pb)) {
            (Some(x), Some(y)) => x == y && pa == pb,
            _ => false,
        }
    }

    /// A comparison: for equality, and by order (`<`, `>=`) against anything but a
    /// literal, a clock or a count ([`bounded`]: `session.expires < Date.now()` is
    /// no scope, `row.level <= session.user.level` is one). In the condition of an
    /// exit that answers "not signed in", a comparison of a value of the caller
    /// with another value of the caller (of the same giver) or with the request's
    /// credential ([`credential_read`]) is how the caller is identified; with anything else
    /// (a row the body read, what the request sent, a literal) it is a use: an
    /// ownership or role check answered with 401 is still a check.
    pub(super) fn flow_binary(&mut self, it: &BinaryExpression) {
        let order = matches!(
            it.operator,
            BinaryOperator::LessThan
                | BinaryOperator::LessEqualThan
                | BinaryOperator::GreaterThan
                | BinaryOperator::GreaterEqualThan
        );
        if !order
            && !matches!(
                it.operator,
                BinaryOperator::StrictEquality
                    | BinaryOperator::Equality
                    | BinaryOperator::StrictInequality
                    | BinaryOperator::Inequality
            )
        {
            return;
        }
        // Against a literal, a clock or a count it is no scope where the value is an
        // expiry or a count (`token.exp < now`, `items.length > 10`); a member
        // compared with a literal (`session.user.level < 3`) is a role gate.
        if order
            && (bounded(&it.left) || bounded(&it.right))
            && (expiry_or_count(&it.left) || expiry_or_count(&it.right))
        {
            return;
        }
        let absent = |e: &Expression| match peel(e) {
            Expression::NullLiteral(_) => true,
            Expression::Identifier(id) => id.name == "undefined",
            Expression::UnaryExpression(u) => {
                matches!(u.operator, UnaryOperator::Typeof | UnaryOperator::Void)
            }
            Expression::StringLiteral(l) => matches!(
                l.value.as_str().unwrap_or_default(),
                "undefined" | "string" | "number" | "object" | "function" | "boolean"
            ),
            _ => false,
        };
        if absent(&it.left) || absent(&it.right) || self.same_value(&it.left, &it.right) {
            return;
        }
        let (l, r) = (self.taint(&it.left), self.taint(&it.right));
        if self.flow.authn_test > 0 {
            // Both sides are the caller's: values of the caller, or what the same
            // givers handed back (`session.user.id !== session.sub`). A value some
            // other call handed back (a row the body read) is not.
            let same = (l.caller && r.caller)
                || (!l.caller
                    && !r.caller
                    && !l.via.is_empty()
                    && l.via.iter().all(|v| r.via.contains(v))
                    && r.via.iter().all(|v| l.via.contains(v)));
            if same
                || (l.of_caller() && credential_read(&it.right))
                || (r.of_caller() && credential_read(&it.left))
            {
                return;
            }
        }
        let mut t = l;
        t.join(r);
        if !t.is_empty() {
            self.flow_use(None, &t);
        }
    }

    /// The condition of an `if` or of a conditional expression: a value of the
    /// caller tested for more than being there.
    /// Also in the condition of an exit that answers "not signed in": a test for
    /// more than being there (`!session.user.isAdmin`) is a role check, whatever
    /// the exit answers; there, a tenant or owner key tested is being there.
    pub(super) fn flow_test(&mut self, e: &Expression) {
        match peel(e) {
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                self.flow_test(&u.argument);
            }
            Expression::LogicalExpression(l) => {
                self.flow_test(&l.left);
                self.flow_test(&l.right);
            }
            e @ (Expression::StaticMemberExpression(_) | Expression::ChainExpression(_)) => {
                let last = match e {
                    Expression::StaticMemberExpression(m) => Some(m.property.name.as_str()),
                    Expression::ChainExpression(c) => match &c.expression {
                        ChainElement::StaticMemberExpression(m) => Some(m.property.name.as_str()),
                        _ => None,
                    },
                    _ => None,
                };
                let Some(last) = last else { return };
                // In the condition of an exit that answers "not signed in", a tenant
                // or owner key tested for being there (`if (!session?.orgId)`) is
                // how the caller is identified; a flag (`!session.user.isAdmin`)
                // is not.
                let identifies = self.flow.authn_test > 0
                    && (drift_core::practice::tenant_key(last)
                        || drift_core::practice::owner_key(last));
                if PRESENCE.contains(&last) || caller_name(last) || identifies {
                    return;
                }
                let t = self.taint(e);
                if !t.is_empty() {
                    self.flow_use(None, &t);
                }
            }
            _ => {}
        }
    }

    /// `switch (<value>)`, and an index by a value.
    pub(super) fn flow_selects(&mut self, e: &Expression) {
        let t = self.taint(e);
        if !t.is_empty() {
            self.flow_use(None, &t);
        }
    }

    /// Binds the names of a pattern to whose the value they are bound to is.
    fn flow_bind<'b, 'a>(
        &mut self,
        id: &'b BindingPattern<'a>,
        init: &'b Expression<'a>,
        path: &mut Vec<&'b str>,
    ) {
        match id {
            BindingPattern::BindingIdentifier(b) => {
                let Some(s) = b.symbol_id.get() else { return };
                // The caller itself: the value whole, or the key of a record read
                // where the name is bound (`const { id } = session.user`).
                let whole = match path.split_last() {
                    None => self.caller_self(init),
                    Some((last, before)) if RECORD_KEYS.contains(last) => {
                        let t = self.taint_path(init, before, 0);
                        (!t.param && !t.named && t.of_caller()).then_some(t.via)
                    }
                    Some(_) => None,
                };
                match whole {
                    Some(givers) => self.flow.self_locals.insert(s, givers),
                    None => self.flow.self_locals.remove(&s),
                };
                match path.is_empty().then(|| self.kept_read(init)).flatten() {
                    Some(store) => self.flow.kept_locals.insert(s, store),
                    None => self.flow.kept_locals.remove(&s),
                };
                let t = self.taint_path(init, path, 0);
                if t.is_empty() {
                    self.flow.locals.remove(&s);
                } else {
                    self.flow.locals.insert(s, t);
                }
            }
            BindingPattern::AssignmentPattern(a) => self.flow_bind(&a.left, init, path),
            BindingPattern::ObjectPattern(o) => {
                for p in &o.properties {
                    // A key that is not written is any member.
                    let key: &'b str = match &p.key {
                        PropertyKey::StaticIdentifier(k) if !p.computed => k.name.as_str(),
                        _ => "[]",
                    };
                    path.push(key);
                    self.flow_bind(&p.value, init, path);
                    path.pop();
                }
                if let Some(r) = &o.rest {
                    self.flow_bind(&r.argument, init, path);
                }
            }
            BindingPattern::ArrayPattern(a) => {
                for el in a.elements.iter().flatten() {
                    path.push("[]");
                    self.flow_bind(el, init, path);
                    path.pop();
                }
            }
        }
    }

    /// `const x = <value>`, `const { a, b: { c } } = <value>`.
    pub(super) fn flow_declarator<'b, 'a>(
        &mut self,
        id: &'b BindingPattern<'a>,
        init: &'b Expression<'a>,
    ) {
        // `const req = context.switchToHttp().getRequest()` in a Nest guard or
        // interceptor: the local is the request, a holder as `req` is.
        if let BindingPattern::BindingIdentifier(b) = id
            && let Some(s) = b.symbol_id.get()
            && let Expression::CallExpression(c) = peel(init)
            && Self::method(&c.callee).is_some_and(|(_, m)| m == "getRequest")
        {
            self.flow.locals.remove(&s);
            self.flow.params.insert(s, "req".to_string());
            return;
        }
        let mut path = Vec::new();
        self.flow_bind(id, init, &mut path);
    }

    /// `for (const x of <value>)`.
    pub(super) fn flow_for_of(&mut self, it: &ForOfStatement) {
        let ForStatementLeft::VariableDeclaration(d) = &it.left else {
            return;
        };
        for decl in &d.declarations {
            let mut path = vec!["[]"];
            self.flow_bind(&decl.id, &it.right, &mut path);
        }
    }

    /// `x = <value>`, `x.k = <value>`, `req.depot = <value>`.
    pub(super) fn flow_assign(&mut self, it: &AssignmentExpression) {
        // A local bound again is whatever it was last given.
        if let AssignmentTarget::AssignmentTargetIdentifier(id) = &it.left
            && let Some(s) = self.symbol_of(id)
        {
            self.flow.self_locals.remove(&s);
        }
        // A key named for the caller bound to what the request sent: what is
        // read under it afterwards is what the request chose.
        if let Some(key) = self.held_target(&it.left)
            && holder_key(key)
            && plain_key(key)
            && self.request_sent(&it.right, 0)
        {
            self.flow.holds_sent.insert(key.to_string());
        }
        let mut t = self.taint(&it.right);
        if t.is_empty() {
            // What a guard, a middleware or a strategy puts on the request is who
            // calls (`req.curator = await this.curators.byToken(token)`, `req.curator
            // = user`): a binding of the caller under that key, wherever its value
            // came from, unless it is what the request sent or a literal. Read as
            // such for the uses of the value only (source 5); no check is proven by
            // it.
            if !identity_value(&it.right) {
                return;
            }
            t = Taint::caller();
            t.param = false;
            let AssignmentTarget::StaticMemberExpression(_) = &it.left else {
                return;
            };
        }
        let mut segs: Vec<&str> = Vec::new();
        let root = match &it.left {
            AssignmentTarget::AssignmentTargetIdentifier(id) => self.symbol_of(id),
            AssignmentTarget::StaticMemberExpression(m) => {
                segs.push(m.property.name.as_str());
                let mut cur = peel(&m.object);
                loop {
                    match cur {
                        Expression::StaticMemberExpression(m) => {
                            segs.push(m.property.name.as_str());
                            cur = peel(&m.object);
                        }
                        Expression::Identifier(id) => break self.symbol_of(id),
                        _ => break None,
                    }
                }
            }
            _ => None,
        };
        let Some(s) = root else { return };
        segs.reverse();
        match self.flow_param(s).cloned() {
            // A member of a holder: `req.depot = claims.depotId`.
            Some(name) => {
                let on_holder = if HOLDER_PARAMS.contains(&name.as_str()) {
                    Some(&segs[..])
                } else if segs.first().is_some_and(|f| HOLDER_MEMBERS.contains(f)) {
                    Some(&segs[1..])
                } else {
                    None
                };
                if let Some(mut rest) = on_holder {
                    while rest.first().is_some_and(|k| HOLDER_STORES.contains(k)) {
                        rest = &rest[1..];
                    }
                    if let Some(key) = rest.first()
                        && !REQUEST_VALUES.contains(key)
                        && !FRAMEWORK_MEMBERS.contains(key)
                    {
                        let key = (*key).to_string();
                        self.flow_hold(&key, &t);
                    }
                }
            }
            None if !self.taint(&it.right).is_empty() => {
                self.flow.locals.entry(s).or_default().join(t)
            }
            None => {}
        }
    }

    /// The key an assignment binds on a request-scoped holder (`req.user = ...`,
    /// `ctx.state.user = ...`, `req.session.user = ...`): the first key under
    /// the holder and its stores that is no value of the request and no member
    /// of the framework's.
    fn held_target<'b>(&self, left: &'b AssignmentTarget) -> Option<&'b str> {
        let AssignmentTarget::StaticMemberExpression(m) = left else {
            return None;
        };
        let mut segs: Vec<&'b str> = vec![m.property.name.as_str()];
        let mut cur = peel(&m.object);
        let root = loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    segs.push(m.property.name.as_str());
                    cur = peel(&m.object);
                }
                Expression::Identifier(id) => break self.symbol_of(id)?,
                _ => return None,
            }
        };
        segs.reverse();
        let name = self.flow_param(root)?;
        let mut rest = if HOLDER_PARAMS.contains(&name.as_str()) {
            &segs[..]
        } else if segs.first().is_some_and(|f| HOLDER_MEMBERS.contains(f)) {
            &segs[1..]
        } else {
            return None;
        };
        while rest.first().is_some_and(|k| HOLDER_STORES.contains(k)) {
            rest = &rest[1..];
        }
        rest.first()
            .copied()
            .filter(|k| !REQUEST_VALUES.contains(k) && !FRAMEWORK_MEMBERS.contains(k))
    }

    /// The value is what the request sent, or is built of it: a member of the
    /// request's own values read off a holder (`req.body.user`,
    /// `req.headers["x-user-id"]`, `ctx.request.query.as`), a local bound to
    /// one, an object written in place that holds one, or an alternative that
    /// may be one (`req.user || req.query.as`); and the row a call is asked for
    /// by its own key with such a value ([`Collector::keyed_by_sent`]). What any
    /// other call made of such a value is whatever the call does with it (a row
    /// found by a key the caller was issued, a token verified), and is not read
    /// here.
    fn request_sent(&self, e: &Expression, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        match peel(e) {
            Expression::ObjectExpression(o) => o.properties.iter().any(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => self.request_sent(&p.value, depth + 1),
                ObjectPropertyKind::SpreadProperty(s) => self.request_sent(&s.argument, depth + 1),
            }),
            Expression::ConditionalExpression(c) => {
                self.request_sent(&c.consequent, depth + 1)
                    || self.request_sent(&c.alternate, depth + 1)
            }
            Expression::LogicalExpression(l) => {
                self.request_sent(&l.left, depth + 1) || self.request_sent(&l.right, depth + 1)
            }
            Expression::AwaitExpression(a) => self.request_sent(&a.argument, depth + 1),
            // A row the request names by its own key (`findUnique({ where: { id:
            // req.headers["x-user-id"] } })`): whichever row the request chose.
            Expression::CallExpression(c) => c
                .arguments
                .iter()
                .any(|a| a.as_expression().is_some_and(|x| self.keyed_by_sent(x, 0))),
            Expression::NewExpression(_) => false,
            x => {
                // Read off one of the function's own parameters under a key of
                // the request's values, directly or through a local.
                if self.param_root(x).is_some_and(|(_, at)| {
                    at.split('.').skip(1).any(|k| REQUEST_VALUES.contains(&k))
                }) {
                    return true;
                }
                // The same off a holder that is no parameter of the function the
                // walk started on (a callback's `req`).
                let mut segs: Vec<&str> = Vec::new();
                let mut cur = x;
                let root = loop {
                    match cur {
                        Expression::StaticMemberExpression(m) => {
                            segs.push(m.property.name.as_str());
                            cur = peel(&m.object);
                        }
                        Expression::ComputedMemberExpression(m) => cur = peel(&m.object),
                        Expression::Identifier(id) => break self.symbol_of(id),
                        _ => break None,
                    }
                };
                root.and_then(|s| self.flow_param(s)).is_some_and(|name| {
                    (HOLDER_PARAMS.contains(&name.as_str())
                        || segs.last().is_some_and(|f| HOLDER_MEMBERS.contains(f)))
                        && segs.iter().any(|k| REQUEST_VALUES.contains(k))
                })
            }
        }
    }

    /// An object handed to a call that names a row by its own key
    /// ([`RECORD_KEYS`], `_id`) with what the request sent, at any depth (`{
    /// where: { id } }` with `id` read off a header): the key of a record
    /// identifies it and is no secret, so the row is whichever the request chose.
    /// Not where the value is the credential the request carries (a session
    /// looked up by the cookie's value): that is what the request was issued.
    fn keyed_by_sent(&self, e: &Expression, depth: usize) -> bool {
        let Expression::ObjectExpression(o) = peel(e) else {
            return false;
        };
        depth < 4
            && o.properties.iter().any(|p| {
                let ObjectPropertyKind::ObjectProperty(p) = p else {
                    return false;
                };
                let record_key = !p.computed
                    && super::key_name(&p.key)
                        .is_some_and(|k| RECORD_KEYS.contains(&k.as_str()) || k == "_id");
                (record_key
                    && !matches!(peel(&p.value), Expression::ObjectExpression(_))
                    && self.request_sent(&p.value, 1)
                    && !self.credential_read(&p.value))
                    || self.keyed_by_sent(&p.value, depth + 1)
            })
    }

    /// What the function the walk started on returns.
    pub(super) fn flow_return(&mut self, e: &Expression) {
        match peel(e) {
            Expression::NullLiteral(_) => return,
            Expression::Identifier(id) if id.name == "undefined" => return,
            _ => {}
        }
        // What a keyed store of the file kept under a key of the caller's: the
        // caller's where the file only ever puts a value of the caller there.
        if let Some(store) = self.kept_read(e) {
            self.flow.returns_kept.insert(store);
            return;
        }
        let t = self.taint(e);
        // What the function hands back of a value of one of its parameters is
        // used where the call's value is: a call given a value of the caller is
        // not read as one that does nothing with it.
        if t.param {
            self.flow.param_flows = true;
        }
        if t.caller {
            self.flow.returns_caller = true;
        } else {
            self.flow.returns_other = true;
            // What a function called with nothing or with the request gave, and
            // nothing else: a holder's key is no function, a parameter's value
            // is whatever was passed.
            let given = !t.param
                && !t.via.is_empty()
                && t.via.iter().all(|g| !matches!(g.base, RawBase::Global(_)));
            match given {
                true => self.flow.returns_given.extend(t.via.iter().cloned()),
                false => self.flow.returns_else = true,
            }
        }
    }

    /// Where a check of the body answers "not signed in" on what a callee gave,
    /// what that callee gives is the caller's (source 2): its entries are those of
    /// a value of the caller.
    pub(super) fn flow_settle(&mut self, signs_in: &[RawOperand]) {
        let entries = std::mem::take(&mut self.flow.caller_args);
        for (callee, via) in entries {
            match via {
                Some(g) if signs_in.contains(&RawOperand::Ref(g.clone())) => {
                    if callee == g {
                        self.flow.unread = true;
                    } else {
                        self.flow.caller_args.insert((callee, None));
                    }
                }
                via => {
                    self.flow.caller_args.insert((callee, via));
                }
            }
        }
    }
}

/// The module-level bindings of a program that a function writes a value that may
/// be who calls onto ([`identity_value`]), read off a parameter of a function it is
/// in: the binding itself (`currentMuseum = museumId` in `setMuseum(museumId)`) or a
/// member of it (`current.orgId = req.user.orgId` in a middleware). Such a binding
/// is set per request: what is read off it is the caller's (source 9). A lazily
/// built client (`cached = new Client()`) is given no parameter's value.
pub(super) fn request_holders(
    program: &Program,
    scoping: &oxc_semantic::Scoping,
) -> HashSet<SymbolId> {
    struct Holders<'s> {
        scoping: &'s oxc_semantic::Scoping,
        module: HashSet<SymbolId>,
        depth: u32,
        found: HashSet<SymbolId>,
        /// The parameters of the functions being walked.
        params: HashSet<SymbolId>,
    }
    /// The symbols an expression refers to.
    struct Refs<'s> {
        scoping: &'s oxc_semantic::Scoping,
        out: HashSet<SymbolId>,
    }
    impl<'a> oxc_ast_visit::Visit<'a> for Refs<'_> {
        fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
            if let Some(s) = it
                .reference_id
                .get()
                .and_then(|r| self.scoping.get_reference(r).symbol_id())
            {
                self.out.insert(s);
            }
        }
    }
    fn params_of(p: &FormalParameters, out: &mut HashSet<SymbolId>) {
        fn names(p: &BindingPattern, out: &mut HashSet<SymbolId>) {
            match p {
                BindingPattern::BindingIdentifier(b) => {
                    if let Some(s) = b.symbol_id.get() {
                        out.insert(s);
                    }
                }
                BindingPattern::AssignmentPattern(a) => names(&a.left, out),
                BindingPattern::ObjectPattern(o) => {
                    for prop in &o.properties {
                        names(&prop.value, out);
                    }
                }
                BindingPattern::ArrayPattern(a) => {
                    for el in a.elements.iter().flatten() {
                        names(el, out);
                    }
                }
            }
        }
        for item in &p.items {
            names(&item.pattern, out);
        }
    }
    impl Holders<'_> {
        fn root(&self, e: &Expression) -> Option<SymbolId> {
            match unwrap_expr(e) {
                Expression::Identifier(id) => id
                    .reference_id
                    .get()
                    .and_then(|r| self.scoping.get_reference(r).symbol_id()),
                Expression::StaticMemberExpression(m) => self.root(&m.object),
                Expression::ComputedMemberExpression(m) => self.root(&m.object),
                _ => None,
            }
        }
    }
    impl<'a> oxc_ast_visit::Visit<'a> for Holders<'_> {
        fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
            self.depth += 1;
            params_of(&it.params, &mut self.params);
            oxc_ast_visit::walk::walk_function(self, it, flags);
            self.depth -= 1;
        }
        fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
            self.depth += 1;
            params_of(&it.params, &mut self.params);
            oxc_ast_visit::walk::walk_arrow_function_expression(self, it);
            self.depth -= 1;
        }
        fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
            let from_param = || {
                let mut refs = Refs {
                    scoping: self.scoping,
                    out: HashSet::new(),
                };
                oxc_ast_visit::Visit::visit_expression(&mut refs, &it.right);
                refs.out.iter().any(|s| self.params.contains(s))
            };
            if self.depth > 0 && identity_value(&it.right) && from_param() {
                let root = match &it.left {
                    AssignmentTarget::AssignmentTargetIdentifier(id) => id
                        .reference_id
                        .get()
                        .and_then(|r| self.scoping.get_reference(r).symbol_id()),
                    AssignmentTarget::StaticMemberExpression(m) => self.root(&m.object),
                    AssignmentTarget::ComputedMemberExpression(m) => self.root(&m.object),
                    _ => None,
                };
                if let Some(s) = root
                    && self.module.contains(&s)
                {
                    self.found.insert(s);
                }
            }
            oxc_ast_visit::walk::walk_assignment_expression(self, it);
        }
    }
    let mut module = HashSet::new();
    for stmt in &program.body {
        let decl = match stmt {
            Statement::VariableDeclaration(d) => Some(&**d),
            Statement::ExportDeclaration(e) => match &e.declaration {
                Declaration::VariableDeclaration(d) => Some(&**d),
                _ => None,
            },
            _ => None,
        };
        for d in decl.into_iter().flat_map(|d| &d.declarations) {
            if let BindingPattern::BindingIdentifier(b) = &d.id
                && let Some(s) = b.symbol_id.get()
            {
                module.insert(s);
            }
        }
    }
    let mut v = Holders {
        scoping,
        module,
        depth: 0,
        found: HashSet::new(),
        params: HashSet::new(),
    };
    oxc_ast_visit::Visit::visit_program(&mut v, program);
    v.found
}

/// What an order comparison of a value of the caller may be against and still be
/// no scope ([`Collector::flow_binary`]): a literal, a clock (`Date.now()`, `new
/// Date()`, `performance.now()`, `dayjs()`, `moment()`, a method of one such as
/// `.getTime()`, arithmetic on one) or a count (`.length`, `.size`, `count()`).
fn bounded(e: &Expression) -> bool {
    match peel(e) {
        Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_) => true,
        Expression::TemplateLiteral(t) => t.expressions.is_empty(),
        Expression::UnaryExpression(u) => {
            matches!(
                u.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus
            ) && bounded(&u.argument)
        }
        Expression::BinaryExpression(b) => {
            matches!(
                b.operator,
                BinaryOperator::Addition
                    | BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
            ) && bounded(&b.left)
                && bounded(&b.right)
        }
        Expression::StaticMemberExpression(m) => {
            matches!(m.property.name.as_str(), "length" | "size")
        }
        e @ (Expression::CallExpression(_) | Expression::NewExpression(_)) => {
            clock(e)
                || matches!(e, Expression::CallExpression(c)
                    if call_name(&c.callee).is_some_and(|n| matches!(n, "count" | "countDocuments")))
                || matches!(e, Expression::CallExpression(c)
                    if matches!(unwrap_expr(&c.callee), Expression::StaticMemberExpression(m)
                        if m.property.name == "floor" || m.property.name == "round" || m.property.name == "ceil")
                        && c.arguments.first().and_then(|a| a.as_expression()).is_some_and(bounded))
        }
        _ => false,
    }
}

/// An expiry or a count ([`Collector::flow_binary`]): a clock, `.length`, `.size`, a
/// count call, or a member or name that reads as an expiry (`exp`, `iat`, `nbf`,
/// `expires`, `expiresAt`, `expires_at`, `expiry`).
fn expiry_or_count(e: &Expression) -> bool {
    let e = peel(e);
    let name = match e {
        Expression::Identifier(id) => Some(id.name.as_str()),
        Expression::StaticMemberExpression(m) => Some(m.property.name.as_str()),
        _ => None,
    };
    if let Some(n) = name {
        let n = n.to_ascii_lowercase();
        if matches!(n.as_str(), "exp" | "iat" | "nbf" | "length" | "size")
            || n.starts_with("expire")
            || n.starts_with("expiry")
            || n.starts_with("expiration")
        {
            return true;
        }
    }
    match e {
        Expression::CallExpression(c) => {
            call_name(&c.callee).is_some_and(|n| matches!(n, "count" | "countDocuments"))
                || clock(e)
        }
        Expression::NewExpression(_) | Expression::BinaryExpression(_) => clock(e),
        Expression::StaticMemberExpression(_) => clock(e),
        _ => false,
    }
}

/// A clock ([`bounded`]): `Date.now()`, `new Date(...)`, `performance.now()`,
/// `dayjs(...)`, `moment(...)`, and a method or member read off one
/// (`new Date().toISOString()`, `Date.now() / 1000`).
fn clock(e: &Expression) -> bool {
    match peel(e) {
        Expression::NewExpression(n) => {
            matches!(unwrap_expr(&n.callee), Expression::Identifier(id) if id.name == "Date")
        }
        Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
            Expression::Identifier(id) => matches!(id.name.as_str(), "dayjs" | "moment"),
            Expression::StaticMemberExpression(m) => {
                (m.property.name == "now"
                    && matches!(unwrap_expr(&m.object), Expression::Identifier(o)
                        if matches!(o.name.as_str(), "Date" | "performance")))
                    || clock(&m.object)
            }
            _ => false,
        },
        Expression::StaticMemberExpression(m) => clock(&m.object),
        Expression::BinaryExpression(b) => clock(&b.left) || clock(&b.right),
        _ => false,
    }
}

/// A read of the request's credential ([`Collector::flow_binary`]): a member chain
/// or call through the request's headers or cookies (`req.headers.authorization`,
/// `request.cookies.get("token")?.value`, `cookies().get("session")`,
/// `headers().get("x-api-key")`).
fn credential_read(e: &Expression) -> bool {
    let mut cur = peel(e);
    loop {
        match cur {
            Expression::StaticMemberExpression(m) => {
                if matches!(
                    m.property.name.as_str(),
                    "headers" | "cookies" | "authorization"
                ) {
                    return true;
                }
                cur = peel(&m.object);
            }
            Expression::ComputedMemberExpression(m) => cur = peel(&m.object),
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => {
                    if matches!(
                        m.property.name.as_str(),
                        "headers" | "cookies" | "authorization"
                    ) {
                        return true;
                    }
                    cur = peel(&m.object);
                }
                ChainElement::ComputedMemberExpression(m) => cur = peel(&m.object),
                ChainElement::CallExpression(c) => cur = unwrap_expr(&c.callee),
                _ => return false,
            },
            Expression::CallExpression(c) => {
                if matches!(unwrap_expr(&c.callee), Expression::Identifier(id)
                    if matches!(id.name.as_str(), "cookies" | "headers"))
                {
                    return true;
                }
                cur = unwrap_expr(&c.callee);
            }
            _ => return false,
        }
    }
}
