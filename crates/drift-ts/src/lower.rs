//! Lower one TypeScript/JavaScript file into raw, pre-resolution facts.
//!
//! This step depends only on the file's text, so its output is cached by
//! content hash. References to imported names keep their raw specifier; the
//! repo-level pass in [`crate::resolve`] turns them into canonical ids.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use drift_core::{ImportLoad, SkipReason, SymbolKind, WrapKind};
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};

/// Bumped whenever lowering output changes for the same input text.
pub const LOWERING_VERSION: u32 = 76;

/// What an options object gives a Fastify route: for each hook it names
/// (`onRequest`, `preHandler`), what that hook runs.
type HookSets = Vec<(String, Vec<RawRef>, routes::GuardPosition)>;

/// Maximum member segments kept in a canonical reference (`a.b.c.d`).
const MAX_MEMBER_DEPTH: usize = 4;

/// Where a reference points before module resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RawBase {
    /// An imported binding: `import { name } from "spec"` (`default`, `*` or a name).
    Import { spec: String, name: String },
    /// A top-level declaration in this file.
    Local(String),
    /// An ambient or undeclared name (`fetch`, `console`).
    Global(String),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct RawRef {
    pub base: RawBase,
    /// Member path such as `.link.findMany` or `.object().parse`; empty for none.
    pub member: String,
}

/// A call whose shape decides what it is at a guard position
/// ([`drift_core::GuardCall`]), before its references are canonical.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct RawGuardCall {
    pub callee: RawRef,
    /// The arguments of each call of the chain, innermost first.
    pub args: Vec<Vec<RawArg>>,
}

/// One argument of a [`RawGuardCall`] ([`drift_core::CallArg`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RawArg {
    Text(String),
    Bool(bool),
    Number(String),
    Null,
    List(Vec<RawArg>),
    Object(Vec<(String, RawArg)>),
    Ref(RawRef),
    Call(RawGuardCall),
    Function,
    Spread,
    Unread,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawExportTarget {
    /// Declared (or aliased) in this file under this local name.
    Local(String),
    /// Re-exported from another module: `export { name } from "spec"` or an imported binding.
    From { spec: String, name: String },
    /// `export * from "spec"`.
    All { spec: String },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawExport {
    pub name: String,
    pub target: RawExportTarget,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawImport {
    pub spec: String,
    pub names: Vec<String>,
    pub type_only: bool,
    /// When the module is loaded: a declaration, a re-exported module, or a
    /// `require()`/`import()` at module scope is static; inside a function,
    /// `require()` is `Require` and `import()` is `Dynamic`.
    #[serde(default)]
    pub load: ImportLoad,
    /// Made only by re-export statements (`export { x } from "s"`, `export * from
    /// "s"`): the file uses nothing of "s" itself. Client leaks follow such an edge
    /// only for the names re-exported through it ([`crate::repo::Reexports`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reexport: bool,
}

/// A call of a top-level or imported function with string-literal arguments that
/// read as module specifiers (`optionalRequire("pkg")`). The linker keeps those
/// whose callee is a lazy-load helper ([`RawFile::loaders`]) as lazy import edges.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawLoaderCall {
    pub callee: RawRef,
    /// (argument index, specifier)
    pub args: Vec<(u32, String)>,
    /// The call runs when the module loads (module scope, or a function called there
    /// in place): what it loads is loaded with the module.
    #[serde(default)]
    pub eager: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawSymbol {
    pub name: String,
    pub kind: SymbolKind,
    pub line: u32,
    pub wraps: Vec<(RawRef, WrapKind)>,
    pub calls: Vec<RawRef>,
    pub renders: Vec<RawRef>,
    /// (callee, argument index, object key)
    pub args: Vec<(RawRef, u32, String)>,
    pub controls: Vec<String>,
    pub string_literals: u32,
    #[serde(default)]
    pub suppressions: Vec<String>,
    /// Environment variables read (`process.env.X`).
    #[serde(default)]
    pub reads: Vec<String>,
    /// Classes or factories thrown (`throw new AppError()`).
    #[serde(default)]
    pub throws: Vec<RawRef>,
    /// Callees called only after the body hands control on, or on what it hands back
    /// ([`drift_core::Symbol::after_continuation`]).
    #[serde(default)]
    pub after_continuation: Vec<RawRef>,
    /// Risky operations (see `signals::kind`).
    #[serde(default)]
    pub sinks: Vec<String>,
    /// Distinct callees in first-call order (capped), for "A before B" rules.
    #[serde(default)]
    pub order: Vec<RawRef>,
    /// The callees whose call's value the body returns
    /// ([`drift_core::Symbol::returns_calls`]).
    #[serde(default)]
    pub returns_calls: Vec<RawRef>,
    /// The function is a refusal builder: every value it hands back is a response
    /// of this status, built as a value (`const unauthenticated = () =>
    /// NextResponse.json({ error }, { status: 401 })`). A branch that returns a
    /// call of one turns the caller away as one that returns the response itself
    /// does ([`RawSymbol::builder_checks`]). TypeScript lowering 70.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal_builder: Option<drift_core::CheckOutcome>,
    /// The calls of a function of another module this function's own body
    /// returns (`return unauthenticated()`, under a check or not): linking reads
    /// the function as one that refuses by the response it hands back, as one
    /// returning the response itself does, where the callee is a refusal builder
    /// of 401 ([`RawSymbol::refusal_builder`]): `rejects_caller`, and
    /// `returns_rejection:` unless [`Self::other_rejection`], in the listed
    /// reading. TypeScript lowering 71.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns_builder: Vec<RawRef>,
    /// The function also turns its caller away otherwise than by a response it
    /// hands back (it throws, redirects, sets a status on a response it was
    /// handed): no `returns_rejection:` ([`Self::returns_builder`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub other_rejection: bool,
    /// The checks of branches that return a call of a function of another module
    /// (`if (!member) return unauthenticated()`), with the callee: linking keeps
    /// each where the callee is a refusal builder ([`RawSymbol::refusal_builder`]),
    /// with its status, in the listed reading.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub builder_checks: Vec<(RawRef, RawBodyCheck)>,
    /// What a branch on a value of the caller hands back that the lowering does not
    /// read as a refusal or as a service of the request: the value the condition
    /// reads, and the function whose call is what the branch hands back, where that
    /// is all that is known (`const r = unauthorized(); return r;`): linking keeps
    /// the entry where the callee is a refusal builder of 401, or where there is
    /// none. Written `exit_unread:<source>` in the listed reading
    /// ([`drift_core::controls::EXIT_UNREAD`]). TypeScript lowering 74.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread_exits: Vec<(Option<RawRef>, RawOperand)>,
    /// Classes: decorators on the class's fields (`@Field()`, `@IsUUID()`).
    #[serde(default)]
    pub field_decorators: Vec<RawRef>,
    /// Kind facts ([`drift_core::traits`]): `declared_abstract` for `abstract class`.
    #[serde(default)]
    pub traits: Vec<String>,
    /// The binding a value is built from by additive builder steps, with the steps as
    /// its member path (`authedProcedure` + `.input().use()`), or bound to (`base`).
    #[serde(default)]
    pub derives_from: Option<RawRef>,
    /// Functions: the call wrappers of the function value the body returns, outermost
    /// first ([`drift_core::Symbol::returns_wrapped_by`]).
    #[serde(default)]
    pub returns_wrapped_by: Vec<RawRef>,
    /// Values: the in-repo or package callee of the call the value is bound to
    /// (`export const withAuth = createAuthWrapper(opts)`), a candidate for
    /// [`drift_core::Symbol::made_by`]. Linking keeps it only when that callee is proven
    /// to return a function.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub made_by: Option<RawRef>,
    /// Classes: each method's own calls and risky operations
    /// ([`drift_core::Symbol::members`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<RawMember>,
    /// Of `reads`, those made only where the code runs on the server
    /// ([`drift_core::Symbol::server_reads`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub server_reads: Vec<String>,
    /// In-body checks that turn a caller away ([`drift_core::Symbol::body_checks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_checks: Vec<RawBodyCheck>,
    /// Responses sent ([`drift_core::Symbol::responses`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub responses: Vec<RawResponse>,
    /// Log-call candidates ([`drift_core::Symbol::log_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log_calls: Vec<RawLogCall>,
    /// Catch clauses ([`drift_core::Symbol::catches`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catches: Vec<RawCatch>,
    /// Request header names read from literals ([`drift_core::Symbol::headers`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<String>,
    /// Schemas or types request input is validated into ([`drift_core::Symbol::inputs`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<RawRef>,
    /// Error classes handled, `Text("*")` for any ([`drift_core::Symbol::handles_errors`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handles_errors: Vec<RawOperand>,
    /// Calls of an environment helper with a literal name (helper, argument index,
    /// name, read only on the server): linking adds `process.env.<name>` to `reads`
    /// when the callee is one ([`RawFile::env_helpers`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_calls: Vec<(RawRef, u32, String, bool)>,
    /// Nest guards ([`drift_core::Symbol::decorator_args`]): (`UseGuards` decorator,
    /// guard class) on a handler, (`Text("APP_GUARD")`, guard class) on a `@Module`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorator_args: Vec<(RawOperand, RawRef)>,
    /// Calls through a function parameter's members, as `param:<name>.<member path>`
    /// (`server.services.project.getProject()` -> `param:server.services.project.getProject`):
    /// added to [`drift_core::Symbol::calls`] when linked.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub param_calls: Vec<String>,
    /// The same calls through the in-repo class or interface the parameter is
    /// annotated with (`(svc: UsersService) => svc.find()` -> `UsersService` +
    /// `.find`): added to `calls` as canonical references.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub typed_param_calls: Vec<RawRef>,
    /// Every call of the body with why it does not run for every request, empty where
    /// it does ([`drift_core::Symbol::conditional_calls`]): linking lists a callee
    /// with no call on every path.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<(RawRef, String)>,
    /// Method calls through `this` no other fact holds
    /// ([`drift_core::Symbol::receiver_calls`]): of a Nest handler's own body.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<RawReceiverCall>,
    /// Declared `async`, or annotated to hand back a promise
    /// ([`drift_core::Symbol::is_async`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
    /// Routes only: what runs before the handler for every request and is no wrap of
    /// the measured facts ([`drift_core::Symbol::app_middleware`]): a Fastify hook of
    /// the application (`app.addHook("onRequest", verify)`), a middleware written in
    /// place (`app.use((req, res, next) => ...)`) or given for a path
    /// (`app.use("/api/*", requireUser)`). Linking drops one that is a router.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub app_middleware: Vec<RawRef>,
    /// A route's guards that could not be read where it is registered, each with
    /// how: options or handlers spread into the registration (`app.get("/x", {
    /// ...secured }, handler)`, `app.get(path, ...handlers)`). Linked as
    /// `?unread:<how>` in [`drift_core::Symbol::app_middleware`]: the route is never
    /// said to have no guard.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub app_unread: Vec<String>,
    /// The calls the route's router was handed to before the route, with the
    /// argument it was (`setupAuth(app)` -> `setupAuth`, 0): linking says what each
    /// registers on it, or that it is not read.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub app_passed: Vec<(RawRef, u32)>,
    /// A function written in place where a middleware or a hook goes, lowered as a
    /// symbol of its own so that it is read: listed for the practice map and `drift
    /// security` only ([`drift_core::Listed`]), never mined.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub in_place: bool,
    /// Controls of the symbol that only the practice map and `drift security` read
    /// ([`drift_core::Listed`]), never mining: `rejects_caller` for a function whose
    /// only 401 is answered from the handler of a `try` every request enters
    /// ([`Collector::note_verified_try`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub listed_controls: Vec<String>,
    /// NestJS route metadata, each as the start of a control and the key it is for:
    /// what a decorator sets ([`drift_core::controls::SETS_METADATA`]), what a guard
    /// class lets through ([`drift_core::controls::OPENS_FOR_METADATA`]) and that
    /// it reads metadata where that is not read
    /// ([`drift_core::controls::METADATA_UNREAD`]). Linked into the controls of the
    /// listed reading only ([`drift_core::Listed`]), as [`RawSymbol::listed_controls`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nest_metadata: Vec<(String, RawOperand)>,
    /// Of `decorator_args`, the guards a `useGlobalGuards(...)` call in the body
    /// names: what mining reads, as the measured build recorded them. The practice
    /// map and `drift security` read the call itself, with where it stands and what
    /// it is given ([`RawFile::nest_global_guards`]), so the listed reading
    /// ([`drift_core::Listed`]) leaves these out.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub measured_args: Vec<(RawOperand, RawRef)>,
    /// What the body does with the value a call hands back, for the callees it
    /// calls in one of two ways only: `drop` where every call of the callee is a
    /// statement of its own (`await requireSession(req);`), and `return:<key>`
    /// where the body returns the value when there is one, under no condition
    /// (`const denied = await requireSession(req); if (denied) return denied;`;
    /// `<key>` is `.error` for `const { error } = ...; if (error) return error;`).
    /// Linking keeps it, as a control of the listed reading, for a callee that
    /// turns callers away only by the value it hands back
    /// ([`drift_core::controls::RETURNS_REJECTION`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub result_uses: Vec<(RawRef, String)>,
    /// Every exit of the body that answers "not signed in" is in a branch after
    /// which the function goes on (`if (!token) { res.status(401).json({}); }
    /// next();`): the listed reading does not hold `rejects_caller` for it
    /// ([`drift_core::Listed`]); what mining reads is what the measured build read.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rejection_goes_on: bool,
    /// Routes only: of `wraps`, those the listed reading ([`drift_core::Listed`])
    /// does not hold: a hook the route's options name that a later property or
    /// spread replaces (`{ onRequest: authenticate, ...other }`,
    /// `{ onRequest: authenticate, onRequest: undefined }`), and Fastify options
    /// held in a binding that carry no hook (`const opts = { schema };
    /// app.get("/x", opts, handler)`). What mining reads is what the measured
    /// build read.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub listed_unwraps: Vec<RawRef>,
    /// The calls whose shape is recorded ([`drift_core::Listed::guard_calls`]):
    /// those written at a guard position of a route, and those a body makes of an
    /// export of a package on the guard lists ([`drift_core::guard_lists::shaped`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub guard_calls: Vec<RawGuardCall>,
    /// The body hands the request on where the facts do not follow
    /// ([`drift_core::SymbolCalls::hands_on`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hands_on: bool,
    /// A function that returns a function written in its own body
    /// ([`drift_core::SymbolCalls::returns_function`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_function: bool,
    /// The callees called in a `try` block only
    /// ([`drift_core::SymbolCalls::caught`]): those with a name, and those through
    /// a parameter as the facts write them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caught: Vec<RawRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caught_params: Vec<String>,
    /// [`drift_core::SymbolCalls::given_credential`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub given_credential: Vec<RawRef>,
    /// [`drift_core::SymbolCalls::verifies`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verifies: Vec<String>,
    /// The callees the body hands a value of the caller to, each with what may
    /// give the value where it is not the caller's by its own source
    /// ([`caller`], [`drift_core::Symbol::caller_args`]). Linked into the listed
    /// reading only ([`drift_core::Listed`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<(RawRef, Option<RawRef>)>,
    /// The keys of an object a call is given whose value is a value of the caller
    /// by its own source, for a call every request to the body reaches: the callee
    /// and the key's path (`prisma.note.findMany({ where: { userId: session.user.id
    /// } })` -> `where.userId`). Linked into the listed reading as
    /// [`drift_core::controls::FILTER_VALUE`] with the side `caller`, which says
    /// where the value a query filters by comes from. TypeScript lowering 76.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_keys: Vec<(RawRef, String)>,
    /// The risky operations of the body that are given a value read off a
    /// parameter of the function ([`drift_core::controls::SINK_FED`]), by kind.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fed_sinks: Vec<String>,
    /// The callees the body hands a value read off a parameter of the function
    /// ([`drift_core::controls::PASSES_PARAM`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub param_passes: Vec<RawRef>,
    /// As [`Self::fed_sinks`] and [`Self::param_passes`], of a parameter of the
    /// function the body hands back ([`drift_core::controls::SINK_FED_MADE`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub made_fed_sinks: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub made_passes: Vec<RawRef>,
    /// Where the body throws for every request for which what a callee gave is
    /// absent, each with the callees that may have given it
    /// ([`drift_core::controls::REFUSES_WITHOUT`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refuses_without: Vec<Vec<RawRef>>,
    /// What each call of the body hands its callee, by position: `caller` (a value
    /// of the caller by its own source), `param <name> #<position>` (read off a
    /// parameter of the function), `literal`, or `unread`
    /// ([`drift_core::controls::ARG_VALUE`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_sides: Vec<(RawRef, Vec<(String, String)>)>,
    /// The keys of an object given to a callee whose value is read off a parameter
    /// of the function: the callee, the key as [`Collector::object_keys`] writes
    /// it, and the parameter (`param <name> #<position>`,
    /// [`drift_core::controls::FILTER_VALUE`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub param_keys: Vec<(RawRef, String, String)>,
    /// [`drift_core::SymbolCalls::param_flows`].
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub param_flows: bool,
    /// The tags of the body's tagged templates (``sql`select ...` ``): calls of the
    /// listed reading only ([`drift_core::Listed`]), where a body that awaits
    /// nothing else it names is otherwise taken for one that loads its work
    /// without naming it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<RawRef>,
}

/// One method of a class, as lowered ([`drift_core::Member`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawMember {
    pub name: String,
    pub calls: Vec<RawRef>,
    pub sinks: Vec<String>,
    /// Some `return` hands back a non-literal ([`drift_core::Member::returns_nonconstant_bool`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_nonconstant_bool: bool,
    /// Every `return` hands back `true` ([`drift_core::Member::returns_only_true`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_only_true: bool,
    /// The method's own checks that turn the caller away ([`drift_core::Member::body_checks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_checks: Vec<RawBodyCheck>,
    /// Error classes the method's own body throws ([`drift_core::Member::throws`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub throws: Vec<RawRef>,
    /// As [`RawSymbol::conditional_calls`], for this method alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<(RawRef, String)>,
    /// As [`RawSymbol::receiver_calls`], for this method alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<RawReceiverCall>,
    /// What the method's own body calls, in the order of each callee's first call
    /// ([`drift_core::Member::order`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<RawRef>,
    /// As [`RawSymbol::is_async`].
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
    /// Keys passed to calls in the method's own body ([`drift_core::Member::args`]):
    /// the filter keys of its queries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<(RawRef, u32, String)>,
    /// What the method's own body does that no other fact records
    /// ([`drift_core::Member::unread`]): `scope_unread`, `param_flows`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
    /// As [`RawSymbol::caller_args`], for this method alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<(RawRef, Option<RawRef>)>,
    /// As [`RawSymbol::caller_keys`], [`RawSymbol::arg_sides`] and
    /// [`RawSymbol::param_keys`], for this method alone.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_keys: Vec<(RawRef, String)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_sides: Vec<(RawRef, Vec<(String, String)>)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub param_keys: Vec<(RawRef, String, String)>,
}

/// A value a practice fact names before resolution: nothing, a fixed text
/// (`param:req`, `header:x-org-id`, `literal`, `*`), or a reference that linking
/// makes canonical.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RawOperand {
    #[default]
    None,
    Text(String),
    Ref(RawRef),
}

/// A method call through `this` that no other fact of the body holds
/// ([`drift_core::Symbol::receiver_calls`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum RawReceiverCall {
    /// A method of the class that the class does not define itself
    /// (`this.scoped(orgId)`, inherited or a property that holds a function).
    Ref(RawRef),
    /// A method of what a property holds, where the property's type is not read:
    /// `local:this.<property>.<path>`, as written.
    Unread(String),
}

/// [`drift_core::BodyCheck`] before resolution. A `compares` reference is written
/// `call:<canonical>`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawBodyCheck {
    pub source: RawOperand,
    pub reads: String,
    pub compares: RawOperand,
    pub outcome: drift_core::CheckOutcome,
    /// How the condition compares ([`drift_core::BodyCheck::op`]).
    #[serde(default)]
    pub op: String,
    /// Inside a branch only some requests take ([`drift_core::BodyCheck::conditional`]).
    #[serde(default)]
    pub conditional: bool,
    /// Why it is conditional ([`drift_core::BodyCheck::condition`]); empty when it
    /// is not.
    #[serde(default)]
    pub condition: String,
    /// The condition in the code's words ([`drift_core::BodyCheck::unless`]): for an
    /// operand of an effective `&&`, the other operands.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unless: String,
    /// The member path read off [`Self::compares`]
    /// ([`drift_core::BodyCheck::compares_path`]).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub compares_path: String,
    /// What the body calls before the check ([`drift_core::BodyCheck::after`]).
    #[serde(default)]
    pub after: Vec<RawRef>,
    /// The check turns the caller away in a way `rejects_caller` does not hold: a
    /// `try` whose handler answers "not signed in"
    /// ([`Collector::note_verified_try`]), or a branch that sets the status in a
    /// statement of its own and leaves (`res.statusCode = 401; return res.end()`).
    /// Where every request reaches it, the function is a guard for the readings that
    /// list ([`RawSymbol::listed_controls`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub caught: bool,
}

/// [`drift_core::ResponseFact`] before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawResponse {
    pub status: u16,
    pub via: drift_core::ResponseVia,
    pub builder: Option<RawRef>,
    pub model: Option<RawRef>,
    pub keys: Vec<String>,
    pub in_catch: bool,
}

/// [`drift_core::LogCall`] before resolution.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawLogCall {
    pub callee: RawRef,
    pub level: String,
    pub in_catch: bool,
    pub structured: bool,
    pub passes_error: bool,
}

/// [`drift_core::CatchFact`] before resolution: the classes caught (`Text("*")` for
/// any), and what the clause does as (kind, reference): `throw` and `report` carry the
/// reference written after a `:`, the others (`rethrow`, `log`, `respond:<status>`,
/// `return`, `swallow`) none.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawCatch {
    pub catches: Vec<RawOperand>,
    pub does: Vec<(String, Option<RawRef>)>,
}

/// [`drift_core::TestRequest`] before resolution: `target` is the specifier of the
/// module whose handler the test calls.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawTestRequest {
    pub method: String,
    pub route: String,
    pub target: Option<String>,
    pub statuses: Vec<u16>,
    /// The URL had a non-literal part ([`drift_core::TestRequest::dynamic`]).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dynamic: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawFile {
    pub parse_ok: bool,
    /// Set when the file could not be parsed within its memory budget
    /// ([`crate::arena`]): it is skipped as [`SkipReason::TooCostly`], with no facts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skip: Option<SkipReason>,
    pub directives: Vec<String>,
    pub imports: Vec<RawImport>,
    pub exports: Vec<RawExport>,
    pub symbols: Vec<RawSymbol>,
    /// Entry points found while lowering (adapters that need the syntax tree, e.g. Express).
    #[serde(default)]
    pub entry_points: Vec<drift_core::EntryPoint>,
    /// Drizzle tables: `pgTable("links", { id, workspaceId })`.
    #[serde(default)]
    pub models: Vec<RawModel>,
    /// Router mounts: `app.use("/v1", router)`, Hono `app.route("/users", users)`,
    /// Fastify `register(plugin, { prefix })`. Joined into full route paths by the linker.
    #[serde(default)]
    pub mounts: Vec<RawMount>,
    /// What each function of the module registers on a router it is handed
    /// ([`RawRegisters`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub registers: Vec<RawRegisters>,
    /// The module-level bindings that are routers or apps (`const users = Router()`;
    /// `default` for one created in a default export), sorted.
    #[serde(default)]
    pub routers: Vec<String>,
    /// The functions of the module that build a router of their own and register
    /// routes on it (`function makeRouter() { const router = Router(); ... }`): a
    /// call of one given where a router is mounted is the router, no guard.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub router_factories: Vec<String>,
    /// What a Fastify instance is decorated with under a name
    /// (`app.decorate("authenticate", async function (request, reply) { ... })`):
    /// the function, where it is one written there or named; `None` for anything
    /// else. A hook given as `app.authenticate` is that function where the name is
    /// decorated once in the repository.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorated: Vec<(String, Option<RawRef>)>,
    /// The routers each function of the module is handed as a parameter, as
    /// [`RawFile::route_routers`] names them (`routes` -> `app@3`): where the
    /// function is registered as a plugin under a prefix, its own routes are
    /// served under it, and no other route of the file is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub function_routers: Vec<(String, String)>,
    /// Each route symbol registered on one of [`RawFile::routers`], with that
    /// router's binding: (symbol, router).
    #[serde(default)]
    pub route_routers: Vec<(String, String)>,
    /// Lists of references: wiring registries (see [`registries`]).
    #[serde(default)]
    pub lists: Vec<registries::RawList>,
    /// Globs of files loaded at run time, relative to this file (`./pages/*.tsx`).
    #[serde(default)]
    pub discovers: Vec<String>,
    /// Lazy-load helpers defined at the top level: functions whose body `require()`s
    /// or `import()`s one of their parameters, as (local name, parameter index).
    #[serde(default)]
    pub loaders: Vec<(String, u32)>,
    /// Candidate calls of lazy-load helpers, sorted.
    #[serde(default)]
    pub loader_calls: Vec<RawLoaderCall>,
    /// Type declarations, for parameter-type facts ([`crate::typeres`]). TypeScript only.
    /// Shared, not copied, by every module of the type index that reads them.
    #[serde(default)]
    pub types: std::sync::Arc<crate::types::RawTypes>,
    /// tRPC procedure builders and the procedures whose builder only its origin can
    /// prove ([`RawTrpc`]); the linker decides across files.
    #[serde(default)]
    pub trpc: RawTrpc,
    /// The module declares types only ([`drift_core::FileFacts::type_only`]).
    #[serde(default)]
    pub type_only: bool,
    /// The requests the file sends ([`drift_core::FileFacts::outgoing`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outgoing: Vec<drift_core::OutgoingRequest>,
    /// Test files: requests the tests make ([`drift_core::FileFacts::test_requests`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub test_requests: Vec<RawTestRequest>,
    /// Test files: specifiers mocked, and `msw:<route>` ([`drift_core::FileFacts::mocks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mocks: Vec<String>,
    /// The file may hold an entry point of a file-convention router other than
    /// Next.js ([`crate::filerouters::candidate`]): linking lists it where the
    /// file's package is built with one. Not set where the file is lowered as the
    /// last measured build listed it, which listed none.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub file_routes: bool,
    /// Such a file exports a middleware of its route
    /// ([`crate::filerouters::exports_middleware`]): it runs before the handlers
    /// of the routes below it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub route_middleware: bool,
    /// The lines of the registrations written as a route is that the lowering did
    /// not list ([`drift_core::FileFacts::unlisted_routes`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unlisted_routes: Vec<u32>,
    /// The file as the last measured build listed it, where this lowering lists
    /// what that build did not (a router with a base path, a registration at
    /// several paths): linked beside this one, it is what mining reads, and this
    /// one what the practice map and `drift security` read
    /// ([`drift_core::Listed`]). None where the two are the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured: Option<Box<RawFile>>,
    /// Middleware route patterns ([`drift_core::FileFacts::route_matchers`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route_matchers: Vec<drift_core::RouteMatcher>,
    /// The rewrites of a Next.js configuration file
    /// ([`drift_core::Listed::rewrites`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rewrites: Vec<drift_core::NextRewrite>,
    /// Top-level one-line environment helpers: functions whose body only returns a
    /// read of `process.env[param]` (`const env = (k) => process.env[k] ?? ""`), as
    /// (local name, parameter index).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env_helpers: Vec<(String, u32)>,
    /// Top-level Nest decorators composed with `applyDecorators(...)`
    /// (`export function RequireAuthentication() { return applyDecorators(UseGuards(G),
    /// ApiBearerAuth()) }`), as (local name, guard classes its `UseGuards` names, other
    /// decorators it composes). Linking gives each handler decorated with one the
    /// guards as [`drift_core::Symbol::decorator_args`], through nested compositions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub composed_decorators: Vec<(String, Vec<RawRef>, Vec<RawRef>)>,
    /// The middleware a Nest module's `configure` applies
    /// (`consumer.apply(SessionMiddleware).exclude(...).forRoutes("*")`), and what is
    /// registered with `use` on the Nest application ([`RawNestApply`]). Linking gives
    /// each route of the package it covers the middleware
    /// ([`drift_core::Symbol::app_middleware`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nest_applies: Vec<RawNestApply>,
    /// Each Nest route symbol with the controller class it is a method of.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nest_routes: Vec<(String, String)>,
    /// The file sets a global prefix or versioning on a Nest application
    /// (`app.setGlobalPrefix("api")`, `app.enableVersioning()`): the paths its routes
    /// answer at are not the paths written on them, so a path a middleware is
    /// excluded for or applied to is not matched against them.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub nest_prefixed: bool,
    /// The guards registered for a whole Nest application
    /// (`app.useGlobalGuards(new JwtAuthGuard())`), each with whether the call runs
    /// for every start of the application ([`nest::RawGlobalGuard`]). Linking gives
    /// each Nest route of the package the guard
    /// ([`drift_core::Symbol::app_middleware`], [`drift_core::NEST_GUARD`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nest_global_guards: Vec<nest::RawGlobalGuard>,
    /// The calls of `NestFactory.create(...)` or `createMicroservice(...)` in the
    /// file: a package that builds more than one application registers a global
    /// guard on one of them only.
    #[serde(default)]
    pub nest_creates: u32,
    /// Top-level `const NAME = "text"` bindings, at most [`MAX_TEXT_CONSTS`] of
    /// them and no text longer than [`MAX_TEXT_CONST`]: a route metadata key named
    /// by such a binding is that text, wherever it is imported
    /// ([`drift_core::controls::SETS_METADATA`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub text_consts: Vec<(String, String)>,
    /// The imports given where a Node listener goes (`import { guarded } from
    /// "./listener"; http.createServer(guarded)`): the function is read in the file
    /// that declares it ([`RawFile::listener_mounts`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node_listener_refs: Vec<RawRef>,
    /// For each function the module exports that hands its two parameters on to an
    /// application as a Node listener does (`export function guarded(req, res) {
    /// ...; app(req, res) }`), by its local name: the mount that serves the
    /// application through it. Linking keeps it where another file gives the
    /// function to `createServer` ([`RawFile::node_listener_refs`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub listener_mounts: Vec<(String, RawMount)>,
}

/// Middleware applied to the routes of a Nest application beside them: one
/// `apply(...)[.exclude(...)].forRoutes(...)` of a module's `configure(consumer)`,
/// or one `app.use(...)` on the application `NestFactory.create` built.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawNestApply {
    /// What is applied, in order: a middleware class, a function, the callee of a
    /// call that builds one (`helmet()`), a function written in place (a symbol of
    /// its own).
    pub middleware: Vec<RawRef>,
    /// What `forRoutes` names; for `app.use`, every path or the path it is given.
    pub routes: Vec<RawNestRoute>,
    /// What `exclude` names.
    pub exclude: Vec<RawNestRoute>,
    /// Something of it is not written as a literal Drift can match against a route
    /// (a variable, a spread, a middleware that could not be named), or it stands
    /// under a condition: which routes it runs for is not read.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unread: bool,
    /// Where it is written, for saying so: `AppModule.configure`, `app.use`.
    pub at: String,
}

/// A route a Nest middleware is applied to or excluded for.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawNestRoute {
    /// `"bookings"`, `{ path: "bookings", method: RequestMethod.GET }`: the path as
    /// written, and the method (empty for every method).
    Path { path: String, method: String },
    /// A controller class (`forRoutes(BookingsController)`), or any other binding:
    /// linking tells which.
    Controller(RawRef),
}

/// What a file says about tRPC builders, for the linker to prove where a procedure's
/// builder comes from (see [`crate::resolve::Linker`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawTrpc {
    /// Top-level `const` bindings that are a tRPC instance: an `initTRPC` imported
    /// from `@trpc/server`, configured (`.context<C>()`, `.meta<M>()`) and `.create()`d.
    /// `default` for `export default initTRPC.create()`.
    pub instances: Vec<String>,
    /// Top-level `const` bindings (or `default`) bound to a reference followed by
    /// procedure-builder steps only (`.use()`, `.input()`, `.output()`, `.meta()`,
    /// `.concat()`): `authed = t.procedure.use(mw)` -> (`authed`, `t.procedure`),
    /// `api = authed` -> (`api`, `authed`). Whether one is a procedure builder is
    /// proven by following the reference to an instance's `.procedure`.
    /// The reference may also be a call (`api = createTeamPbacProcedure("team.read")`,
    /// member ending in `()`): a builder when the function is proven to return one.
    pub builders: Vec<(String, RawRef)>,
    /// Top-level functions (`function f() {}`, `const f = () => ...`) that are plain (not
    /// async, not generator), never fall through to `undefined`, and whose every
    /// `return` is a reference followed by procedure-builder steps, each as in
    /// `builders`: `createTeamPbacProcedure` -> [`authedProcedure`]. One returns a
    /// procedure builder when every one of these is proven to be one.
    #[serde(default)]
    pub factories: Vec<RawFactory>,
    /// Procedure chains (`api.query(...)`) whose builder neither has a builder step nor
    /// is written with a name ending in "procedure": a procedure only when its builder
    /// (`base`) is proven to be one; otherwise nothing (inline) or `replaces` stays.
    pub candidates: Vec<RawCandidate>,
}

/// A function that may return a procedure builder (see [`RawTrpc::factories`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawFactory {
    pub name: String,
    /// The reference each `return` is built from.
    pub returns: Vec<RawRef>,
    /// With one `return`: the binding it is built from by additive builder steps
    /// (`authedProcedure.input().use()`), as [`RawSymbol::derives_from`] is for a
    /// `const`. The function's symbol derives from it once the function is proven
    /// to return a builder, so a procedure it makes is built on that binding.
    pub derives_from: Option<RawRef>,
}

/// A procedure that only its builder's origin can prove (see [`RawTrpc::candidates`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawCandidate {
    /// The builder the chain starts at.
    pub base: RawRef,
    /// The procedure's symbol, as a proven one would be lowered.
    pub symbol: RawSymbol,
    /// Its entry point.
    pub entry: drift_core::EntryPoint,
    /// A value symbol of the same name lowered as an ordinary value
    /// (`export const x = api.query(fn)`): the procedure takes its place when proven.
    /// False for a procedure inline in a router, which is nothing otherwise.
    pub replaces: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawModel {
    pub name: String,
    pub line: u32,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawMount {
    pub prefix: String,
    pub target: RawRef,
    /// Middleware active on the parent router at the mount (inherited by the mounted routes).
    #[serde(default)]
    pub middleware: Vec<RawRef>,
    /// The module-level binding of the router it is mounted on (`app` in
    /// `app.use("/v1", users)`); "" when not known.
    #[serde(default)]
    pub parent: String,
    /// `app.use(x)` with no path: a mount only if `x` turns out to be a router (the
    /// linker knows); otherwise `x` is middleware and this is nothing.
    #[serde(default)]
    pub tentative: bool,
    /// What runs before the mounted routes and is no wrap
    /// ([`RawSymbol::app_middleware`], for every route of the mounted router): a
    /// middleware the parent was given for a path that covers the mount
    /// (`app.use("/staff/*", requireEditor)` before `app.route("/staff/articles",
    /// sub)`), and one written in place before it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<RawRef>,
    /// The calls the parent was handed to before the mount ([`RawSymbol::app_passed`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub passed: Vec<(RawRef, u32)>,
    /// The calls written at the guard positions the mounted routes pass through
    /// ([`RawSymbol::guard_calls`]): where the router is mounted, and on the parent
    /// before it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<RawGuardCall>,
}

/// What a function registers on a router or an application it is handed as a
/// parameter (`export function setupAuth(app: Express) { app.use(requireToken) }`):
/// what runs before the routes of an application passed to it
/// ([`RawSymbol::app_passed`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRegisters {
    /// The function's name (`default` for a default export).
    pub function: String,
    /// Which parameter the router is.
    pub param: u32,
    /// The middleware and hooks it registers for every route, in order.
    pub middleware: Vec<RawRef>,
    /// It also registers what could not be read (a parameter of its own), or hands
    /// the router on.
    pub unread: bool,
    /// A Fastify plugin wrapped by `fastify-plugin`: registered on an instance, its
    /// hooks are that instance's. A plugin that is not keeps them to itself.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub shared: bool,
    /// The calls written where it registers them ([`RawSymbol::guard_calls`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<RawGuardCall>,
}

#[path = "caller.rs"]
mod caller;
#[path = "input.rs"]
pub(crate) mod input;
#[path = "nest.rs"]
pub(crate) mod nest;
#[path = "outgoing.rs"]
pub(crate) mod outgoing;
#[path = "registries.rs"]
pub(crate) mod registries;
#[path = "routes.rs"]
pub(crate) mod routes;
#[path = "signals.rs"]
pub(crate) mod signals;

/// Most callees kept in a symbol's call order.
const MAX_ORDER: usize = 32;
/// Deepest nested object key recorded (`where.workspace.id`).
const MAX_KEY_DEPTH: usize = 3;

/// Name of the pseudo-symbol that collects top-level statements (route registrations etc.).
pub const MODULE_SYMBOL: &str = "(module)";

/// [`lower_file`] on a stack that covers `text` ([`drift_core::stack::with_stack_for`]).
/// Every parse of repository content goes through this.
pub fn lower_on_stack(
    rel_path: &str,
    text: &str,
) -> Result<RawFile, drift_core::stack::Unavailable> {
    drift_core::stack::with_stack_for(text.len(), || lower_file(rel_path, text))
}

/// Lower `text` (from a file at `rel_path`, used only for the source type) into raw
/// facts. Recurses once per nesting level: the caller's stack must cover `text` (see
/// [`lower_on_stack`]).
pub fn lower_file(rel_path: &str, text: &str) -> RawFile {
    let source_type = SourceType::from_path(rel_path).unwrap_or_else(|_| SourceType::tsx());
    // Plain `.js`/`.mjs`/`.cjs` files commonly contain JSX (React projects, Docusaurus);
    // TypeScript's `.ts` cannot (angle-bracket casts), so only JS gets JSX enabled.
    let source_type = if source_type.is_javascript() {
        source_type.with_jsx(true)
    } else {
        source_type
    };
    let skipped = |reason| RawFile {
        skip: Some(reason),
        ..RawFile::default()
    };
    let lower = |text: &str| {
        crate::arena::with_arena(text.len(), |allocator| {
            lower_parsed(allocator, rel_path, text, source_type)
        })
    };
    let Ok(raw) = lower(text) else {
        return skipped(SkipReason::TooCostly);
    };
    if raw.parse_ok || !source_type.is_javascript() {
        return raw;
    }
    // JavaScript that does not parse: typed with Flow, read without its types
    // ([`crate::flow`]), or skipped when they cannot be removed with certainty.
    let typed = crate::arena::with_arena(text.len(), |allocator| {
        crate::flow::strip_types(allocator, text, source_type)
    });
    match typed {
        Err(_) => skipped(SkipReason::TooCostly),
        Ok(crate::flow::Typed::Untyped) => raw,
        Ok(crate::flow::Typed::Unsupported) => skipped(SkipReason::FlowSyntax),
        Ok(crate::flow::Typed::Stripped(stripped)) => match lower(&stripped) {
            // The strip was checked to parse without error.
            Ok(raw) if raw.parse_ok => raw,
            Ok(_) => skipped(SkipReason::FlowSyntax),
            Err(_) => skipped(SkipReason::TooCostly),
        },
    }
}

/// [`lower_file`] in `allocator`.
fn lower_parsed(
    allocator: &oxc_allocator::Allocator,
    rel_path: &str,
    text: &str,
    source_type: SourceType,
) -> RawFile {
    let ret = Parser::new(allocator, text, source_type).parse();
    if ret.fatal_error {
        return RawFile {
            parse_ok: false,
            ..RawFile::default()
        };
    }
    let program = ret.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;
    let parse_ok = !ret.diagnostics.has_errors();
    routes::take_new_listing();
    let mut out = lower_semantic(&program, &semantic, rel_path, text, source_type, parse_ok);
    // A file with a listing the last measured build did not make is lowered once
    // more as that build listed it: what mining reads ([`RawFile::measured`]).
    if routes::take_new_listing() {
        routes::as_measured(true);
        let measured = lower_semantic(&program, &semantic, rel_path, text, source_type, parse_ok);
        routes::as_measured(false);
        routes::take_new_listing();
        if measured != out {
            out.measured = Some(Box::new(measured));
        }
    }
    out
}

/// One lowering of a parsed file ([`lower_parsed`]).
fn lower_semantic(
    program: &Program,
    semantic: &oxc_semantic::Semantic,
    rel_path: &str,
    text: &str,
    source_type: SourceType,
    parse_ok: bool,
) -> RawFile {
    let mut l = Lowerer::new(semantic.scoping(), text);
    l.typescript = source_type.is_typescript();
    l.test_file = is_test_file(rel_path);
    l.out.parse_ok = parse_ok;
    l.lower_program(program);
    if rel_path
        .rsplit('/')
        .next()
        .is_some_and(|name| name.starts_with("next.config."))
    {
        let mut r = NextRewrites::default();
        r.visit_program(program);
        r.follow(program);
        l.out.rewrites = r.finish();
    }
    if !l.test_file {
        let mut sent = outgoing::OutgoingFinder::new(&l, text);
        sent.visit_program(program);
        l.out.outgoing = sent.found;
    }
    let mut lists = registries::ListFinder::new(&l);
    lists.bindings(program);
    lists.visit_program(program);
    let (lists, discovers) = lists.finish();
    l.out.lists = lists;
    l.out.discovers = discovers;
    let types = if source_type.is_typescript() {
        crate::types::lower_types(
            program,
            semantic.scoping(),
            rel_path.ends_with(".d.ts")
                || rel_path.ends_with(".d.mts")
                || rel_path.ends_with(".d.cts"),
        )
    } else {
        crate::types::RawTypes::default()
    };
    let (suppressions, comment_lines) = suppression_comments(program, text, &l);
    let mut out = l.finish();
    {
        let exported: Vec<&str> = out.exports.iter().map(|e| e.name.as_str()).collect();
        out.file_routes =
            crate::filerouters::candidate(rel_path, &exported) && !routes::unmeasured_listing();
        out.route_middleware = out.file_routes && crate::filerouters::exports_middleware(&exported);
    }
    out.types = std::sync::Arc::new(types);
    for sym in out
        .symbols
        .iter_mut()
        .chain(out.trpc.candidates.iter_mut().map(|c| &mut c.symbol))
    {
        // Suppressions apply from the contiguous comment block directly above the declaration.
        let mut line = sym.line.saturating_sub(1);
        while line > 0 && comment_lines.contains(&line) {
            if let Some(ids) = suppressions.get(&line) {
                sym.suppressions.extend(ids.iter().cloned());
            }
            line -= 1;
        }
        sym.suppressions.sort();
        sym.suppressions.dedup();
    }
    out
}

/// `// drift-ignore D-abc123: reason` comments keyed by line, plus every line
/// covered by a comment. Comments without a reason are ignored, so every
/// exception is explained.
fn suppression_comments(
    program: &Program,
    text: &str,
    l: &Lowerer,
) -> (BTreeMap<u32, Vec<String>>, BTreeSet<u32>) {
    let mut out: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    let mut lines = BTreeSet::new();
    for c in &program.comments {
        for line in l.line_of(c.span.start)..=l.line_of(c.span.end) {
            lines.insert(line);
        }
        let body = c.content_span().source_text(text);
        for line in body.lines() {
            let Some(rest) = line
                .trim()
                .trim_start_matches('*')
                .trim()
                .strip_prefix("drift-ignore ")
            else {
                continue;
            };
            let Some((id, reason)) = rest.split_once(':') else {
                continue;
            };
            let id = id.trim();
            let valid_id = id.len() == 8
                && id.starts_with("D-")
                && id[2..].bytes().all(|b| b.is_ascii_hexdigit());
            if valid_id && !reason.trim().is_empty() {
                out.entry(l.line_of(c.span.end))
                    .or_default()
                    .push(id.to_string());
            }
        }
    }
    (out, lines)
}

struct Lowerer<'s> {
    scoping: &'s Scoping,
    line_starts: Vec<u32>,
    /// Local binding name -> (specifier, imported name).
    imports: BTreeMap<String, (String, String)>,
    out: RawFile,
    /// Accumulates top-level statements that are not declarations.
    module_sym: Option<RawSymbol>,
    /// Express apps/routers: variable name -> router-level middleware registered so far.
    express: BTreeMap<String, Vec<RawRef>>,
    /// How many functions deep the routers being lowered are declared
    /// ([`Lowerer::scoped_fn`]): 0 for the module's own.
    scope: u32,
    /// Counts the functions lowered so, to name their routers apart.
    scope_seq: u32,
    /// Lowering what a function registers under a condition (in an `if`, a `try`):
    /// its routes are listed, and nothing it registers beside them is taken to run
    /// for any route ([`Lowerer::conditional_routes`]).
    scope_conditional: bool,
    /// The prefixes of the plugins being lowered, outermost first.
    scope_prefix: Vec<String>,
    /// The routes registered in the function being lowered: (symbol, router).
    scope_routes: Vec<(String, String)>,
    /// Router variable -> middleware registered on it that could not be read where
    /// it is written (a parameter of the enclosing function), each as
    /// [`RawSymbol::app_unread`] says it.
    scope_unread: BTreeMap<String, Vec<String>>,
    /// Router variable -> the path it is based at (`new Hono().basePath("/api")`),
    /// `?` where it is not a literal.
    base_paths: BTreeMap<String, String>,
    /// Router variable -> the calls written where a guard of its routes goes, each
    /// with the path it was given for (`""` for every route): `r.use(passport.
    /// authenticate("jwt"))`, `app.addHook("onRequest", app.auth([a, b]))`
    /// ([`RawSymbol::guard_calls`] of the routes registered after it).
    position_calls: BTreeMap<String, Vec<(String, RawGuardCall)>>,
    /// What a Fastify instance of the module was decorated with, by name
    /// (`app.decorate("devices", new DeviceService(db))`): the class built, as
    /// `<class>()`, or `None` where what it holds is not read.
    decorations: BTreeMap<String, Option<RawRef>>,
    /// The object literals bound with `const` so far, by name: for each key that
    /// names a Fastify hook, what it runs (`const secured = { onRequest:
    /// [authenticate] }` -> `onRequest`, `authenticate`). `None` where the object is
    /// not read to the end (a computed key, a spread). Spread into a route's
    /// options (`{ ...secured }`), it gives the route those hooks.
    route_options: BTreeMap<String, Option<HookSets>>,
    /// Router variable -> the calls it was handed to so far, with the argument it
    /// was (`setupAuth(app)`, `protect(admin)`): what such a call registers on it is
    /// not read where the call is written ([`RawSymbol::app_passed`]).
    passed: BTreeMap<String, Vec<(RawRef, u32)>>,
    /// Router variable -> what runs before its routes and is no wrap
    /// ([`RawSymbol::app_middleware`]), registered so far: the path pattern it was
    /// given for ("" for every route) and what it is.
    hooks: BTreeMap<String, Vec<(String, RawRef)>>,
    /// Router variable -> what `router.param(name, callback)` registers: the
    /// parameter and the callback, which Express runs before every route of that
    /// router whose path has the parameter, and for no other.
    param_hooks: BTreeMap<String, Vec<(String, RawRef)>>,
    /// Router variable -> framework adapter (`express`, `hono`, `fastify`).
    router_adapter: BTreeMap<String, &'static str>,
    /// Hono `createRoute({...})` configs bound to top-level names.
    route_configs: BTreeMap<String, routes::RouteConfig>,
    /// Types of `this.x` properties in the class being lowered (constructor injection).
    this_types: std::cell::RefCell<BTreeMap<String, RawRef>>,
    /// Properties of the class being lowered that hold a plain value: declared as an
    /// array, a map, a set or a primitive, or initialised with a literal. A method
    /// called on one runs no code of the repository.
    pub(crate) this_plain: std::cell::RefCell<BTreeSet<String>>,
    /// The fields of the class being lowered that hold the request, given by
    /// `@Inject(REQUEST)` (`@nestjs/core`) or `@Inject(CONTEXT)`
    /// (`@nestjs/graphql`) in its constructor: a request-scoped provider's
    /// (caller source 8).
    pub(crate) this_request: std::cell::RefCell<BTreeSet<String>>,
    /// Module-level bindings of the file that a function writes who calls onto
    /// (`let currentMuseum: string | undefined` set by `setMuseum(req.curator.museumId)`,
    /// `current.orgId = user.orgId` in a middleware): a holder set per request,
    /// whose value is the caller's (caller source 9).
    pub(crate) request_holders: HashSet<SymbolId>,
    /// The functions of the file that hand back a Promise: declared `async`, or
    /// with a `Promise<...>` return type, by name or bound to a `const`.
    pub(crate) async_fns: HashSet<SymbolId>,
    /// The functions of the file declared at its top level that are refusal
    /// builders ([`RawSymbol::refusal_builder`]), by name.
    pub(crate) builders: HashMap<String, drift_core::CheckOutcome>,
    /// The names the file binds at its top level to a number a status can be
    /// (`const UNAUTH = 401`): a status the lowering does not read through the name.
    pub(crate) status_consts: HashSet<String>,
    /// The classes the file declares at its top level, by name
    /// ([`Lowerer::app_guards_unread`]).
    top_classes: BTreeSet<String>,
    /// Local binding name -> (specifier, imported name) of the imports written
    /// `import type`: erased at compile time, and still what a property is typed by.
    pub(crate) type_imports: BTreeMap<String, (String, String)>,
    /// TypeScript source: imports used only as types are erased at compile time.
    typescript: bool,
    /// Top-level bindings lowered so far whose value a schema library builds
    /// ([`drift_core::traits::SCHEMA_VALUE`]): a chain on one (`Base.extend({...})`) is a
    /// schema too.
    schema_values: BTreeSet<String>,
    /// The bindings of the file that hold a plain value
    /// ([`drift_core::traits::PLAIN_VALUE`]), by name, as they are declared.
    plain_values: BTreeSet<String>,
    /// Top-level `const NAME = "TEXT"` bindings whose text could name an environment
    /// variable ([`env_name`]), for `process.env[NAME]`; and the properties of top-level
    /// object literals of such texts, as `DICT.key`, for `process.env[DICT.key]`.
    env_consts: BTreeMap<String, String>,
    /// Top-level one-line environment helpers (local name -> parameter index).
    env_helpers: BTreeMap<String, u32>,
    /// Top-level `const`s bound to an environment read (`const SECRET =
    /// process.env.CRON_SECRET!`): an env-derived secret a check compares with.
    env_bound: BTreeSet<String>,
    /// Top-level `const`s bound to `new X(...)`: the class, and whether an argument is
    /// env-derived (`const wh = new Webhooks({ secret: process.env.S })`).
    module_news: BTreeMap<String, (RawRef, bool)>,
    /// Class properties initialised with `new X()` in the class being lowered
    /// (`private readonly logger = new Logger(Svc.name)`): the receiver of a log call
    /// through `this.logger`. Read for log calls only.
    this_news: std::cell::RefCell<BTreeMap<String, RawRef>>,
    /// The file is a test ([`is_test_file`]): it records the requests its tests make.
    test_file: bool,
    /// What the file's bindings hold that an SQL sink reads through a name
    /// ([`signals::SqlLocals`]).
    sql: signals::SqlLocals,
    /// The routers of the module a function registers on without being handed
    /// them, while that function is lowered ([`Lowerer::closure_routes`]): a route
    /// on one is a route of the module's router.
    closure_routers: BTreeSet<String>,
    /// Router of the module -> every registration on it of what runs before its
    /// routes (`use`, `addHook`, `register`, `param`), but of what never
    /// authenticates: where the call starts, and whether it is a statement of the
    /// module itself, run once in the order written ([`routes::RouterSites`]).
    guard_sites: BTreeMap<String, Vec<(u32, bool)>>,
    /// Function of the file, by name -> the parameters a call in the file hands a
    /// router, each with the router's adapter (`configureApp(app, db)` with `app`
    /// an Express application: parameter 0 of `configureApp` is one, whatever it is
    /// typed) ([`routes::HandedRouters`]).
    handed_routers: BTreeMap<String, BTreeMap<u32, &'static str>>,
    /// The registrations lowered inside a function so far, by where they start:
    /// none is lowered twice ([`Lowerer::first_visit`]).
    lowered_sites: HashSet<u32>,
    /// Every function parameter binding of the file, with its name and the in-repo type
    /// it is annotated with (`server: FastifyZodProvider`, `svc: UsersService`).
    params: HashMap<SymbolId, (String, Option<RawRef>)>,
    /// Of the parameters annotated with an object type literal, the members it gives a
    /// built-in value's type ([`builtin_members`]: `path` of `params: { path: string[] }`).
    param_builtins: HashMap<SymbolId, BTreeSet<String>>,
}

fn module_export_name(n: &ModuleExportName) -> String {
    match n {
        ModuleExportName::IdentifierName(i) => i.name.to_string(),
        ModuleExportName::IdentifierReference(i) => i.name.to_string(),
        ModuleExportName::StringLiteral(s) => lit(s),
    }
}

/// String literal value as an owned string (lone surrogates are replaced).
/// Reads the rewrites a Next.js configuration file declares
/// ([`drift_core::Listed::rewrites`]): what the function under a `rewrites` key
/// returns, an array of `{ source, destination }` or an object of such arrays by
/// phase. Whatever else it returns is one rewrite that is not read.
///
/// What the file does not say is not read as no rewrite: the configuration handed
/// to a wrapper that is not on [`NO_REWRITE_WRAPPERS`] (`export default
/// withProxy(nextConfig)`: the wrapper may add its own), and rewrites beside a
/// `basePath` (which path each is matched under is not read) are one rewrite that
/// is not read. `nextConfig.rewrites = async () => [...]` is read as the key is.
#[derive(Default)]
struct NextRewrites {
    out: Vec<drift_core::NextRewrite>,
    /// In the body of a `rewrites` function.
    inside: bool,
    /// The packages the file's bindings come from, by local name.
    bindings: HashMap<String, String>,
    /// The configuration goes through a wrapper that may add rewrites.
    wrapped: bool,
    /// The configuration sets a `basePath`.
    base_path: bool,
    /// The top-level bindings exported as the configuration
    /// (`module.exports = nextConfig`), followed to what they are bound to
    /// ([`NextRewrites::follow`]).
    names: BTreeSet<String>,
    /// The bindings of a configuration function's own body, whose initialisers
    /// were read as exported ([`ExportedReturns`]).
    bound_inside: BTreeSet<String>,
    /// The names handed first to a call that merges into them (`Object.assign(
    /// nextConfig, base)`, `merge(nextConfig, base)`): what they hold afterwards is
    /// not what the file's own object says.
    merged: BTreeSet<String>,
}

/// Calls that add what is in their other arguments to their first (`Object.assign`,
/// `_.merge`, `deepmerge`, `extend`, `defaults`): by the last name of the callee.
fn merging_call(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["assign", "merge", "extend", "defaults", "mixin"]
        .iter()
        .any(|w| name.contains(w))
}

/// Configuration wrappers that add no rewrite to a route of the application
/// (they bundle, compile content, or report to their own host), by package.
/// Closed: any other wrapper may add one.
const NO_REWRITE_WRAPPERS: &[&str] = &[
    "@next/bundle-analyzer",
    "@next/mdx",
    "@sentry/nextjs",
    "next-intl/plugin",
    "nextra",
    "@nx/next",
    "next-pwa",
    "@ducanh2912/next-pwa",
    "@serwist/next",
    "@vanilla-extract/next-plugin",
    "next-contentlayer",
    "next-contentlayer2",
    "@content-collections/next",
    "@vercel/toolbar/plugins/next",
];

/// The module a `require("x")` at the root of an initialiser names
/// (`require("x")`, `require("x")(options)`, `require("x").withX`).
fn required(e: &Expression) -> Option<String> {
    let mut cur = unwrap_expr(e);
    loop {
        match cur {
            Expression::CallExpression(c) => {
                if matches!(unwrap_expr(&c.callee), Expression::Identifier(id) if id.name == "require")
                {
                    return match c.arguments.first()?.as_expression().map(unwrap_expr) {
                        Some(Expression::StringLiteral(l)) => Some(lit(l)),
                        _ => None,
                    };
                }
                cur = unwrap_expr(&c.callee);
            }
            Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
            _ => return None,
        }
    }
}

impl NextRewrites {
    /// The rewrites read, with one that is not read where the file leaves any
    /// unsaid.
    fn finish(mut self) -> Vec<drift_core::NextRewrite> {
        if self.wrapped || (self.base_path && !self.out.is_empty()) {
            self.unread();
        }
        self.out
    }

    /// What the module exports as its configuration: handed to a wrapper, it is
    /// what the wrapper returns. A binding is what it is bound to (followed after
    /// the walk, [`NextRewrites::follow`]); a function is what each of its
    /// `return`s hands back (`module.exports = (phase) => withProxy({...})`).
    fn exported(&mut self, e: &Expression) {
        let c = match peel(e) {
            Expression::CallExpression(c) => c,
            Expression::Identifier(id) => {
                self.names.insert(id.name.to_string());
                return;
            }
            Expression::ArrowFunctionExpression(f) => {
                match &f.body {
                    ArrowFunctionBody::FunctionBody(b) => {
                        ExportedReturns { r: self }.visit_function_body(b)
                    }
                    other => {
                        if let Some(x) = other.as_expression() {
                            self.exported(x);
                        }
                    }
                }
                return;
            }
            Expression::FunctionExpression(f) => {
                if let Some(b) = &f.body {
                    ExportedReturns { r: self }.visit_function_body(b);
                }
                return;
            }
            // `{ ...base, reactStrictMode: true }`: what the spread adds is not read,
            // unless it is an object written in place.
            Expression::ObjectExpression(o) => {
                if o.properties.iter().any(|p| match p {
                    ObjectPropertyKind::SpreadProperty(s) => {
                        !matches!(peel(&s.argument), Expression::ObjectExpression(_))
                    }
                    ObjectPropertyKind::ObjectProperty(_) => false,
                }) {
                    self.wrapped = true;
                }
                return;
            }
            _ => return,
        };
        // The wrapper: the name the callee starts from (`withX(config)`,
        // `createPlugin()(config)`), or the module required in place.
        let package = required(&c.callee).or_else(|| {
            let mut cur = unwrap_expr(&c.callee);
            loop {
                match cur {
                    Expression::CallExpression(inner) => cur = unwrap_expr(&inner.callee),
                    Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                    Expression::Identifier(id) => {
                        return self.bindings.get(id.name.as_str()).cloned();
                    }
                    _ => return None,
                }
            }
        });
        if !package.is_some_and(|p| NO_REWRITE_WRAPPERS.contains(&p.as_str())) {
            self.wrapped = true;
            return;
        }
        // What it wraps may be wrapped again (`withA(withB(config))`).
        for a in &c.arguments {
            if let Some(x) = a.as_expression() {
                self.exported(x);
            }
        }
    }

    /// The top-level bindings exported as the configuration, followed to what
    /// they are bound to: a declaration's initialiser, each value assigned to them
    /// at the top level (`nextConfig = withProxy(nextConfig)`), or the function
    /// declared under the name. A name bound to anything else (an import) is what
    /// the file does not say: one rewrite that is not read.
    fn follow(&mut self, program: &Program) {
        let mut done = BTreeSet::new();
        while let Some(name) = self.names.iter().find(|n| !done.contains(*n)).cloned() {
            done.insert(name.clone());
            let mut bound = self.bound_inside.contains(&name);
            for stmt in &program.body {
                let decl = match stmt {
                    Statement::ExportDeclaration(e) => Some(&e.declaration),
                    s => s.as_declaration(),
                };
                match decl {
                    Some(Declaration::VariableDeclaration(v)) => {
                        for d in &v.declarations {
                            if matches!(&d.id, BindingPattern::BindingIdentifier(b) if b.name == name.as_str())
                            {
                                bound = true;
                                if let Some(init) = &d.init {
                                    self.exported(init);
                                }
                            }
                        }
                    }
                    Some(Declaration::FunctionDeclaration(f))
                        if f.id.as_ref().is_some_and(|id| id.name == name.as_str()) =>
                    {
                        bound = true;
                        if let Some(b) = &f.body {
                            ExportedReturns { r: self }.visit_function_body(b);
                        }
                    }
                    _ => {}
                }
                if let Statement::ExpressionStatement(x) = stmt
                    && let Expression::AssignmentExpression(a) = unwrap_expr(&x.expression)
                    && let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left
                    && id.name == name.as_str()
                {
                    self.exported(&a.right);
                }
            }
            if !bound || self.merged.contains(&name) {
                self.wrapped = true;
            }
        }
    }

    /// The value of a `rewrites` key, or what is assigned to one.
    fn read<'a>(&mut self, value: &Expression<'a>)
    where
        Self: Visit<'a>,
    {
        self.inside = true;
        match unwrap_expr(value) {
            Expression::ArrowFunctionExpression(f) => match &f.body {
                ArrowFunctionBody::FunctionBody(b) => self.visit_function_body(b),
                other => match other.as_expression() {
                    Some(e) => self.list(e),
                    None => self.unread(),
                },
            },
            Expression::FunctionExpression(f) => match &f.body {
                Some(b) => self.visit_function_body(b),
                None => self.unread(),
            },
            _ => self.unread(),
        }
        self.inside = false;
    }

    fn unread(&mut self) {
        self.out.push(drift_core::NextRewrite {
            source: "?".into(),
            destination: "?".into(),
        });
    }

    fn list(&mut self, e: &Expression) {
        match unwrap_expr(e) {
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    let Some(Expression::ObjectExpression(o)) = el.as_expression().map(unwrap_expr)
                    else {
                        self.unread();
                        continue;
                    };
                    let text = |key: &str| -> String {
                        let read = match routes::object_prop(o, key).map(unwrap_expr) {
                            Some(Expression::StringLiteral(l)) => Some(lit(l)),
                            // Another host, whatever follows it.
                            Some(Expression::TemplateLiteral(t)) => t
                                .quasis
                                .first()
                                .map(|q| q.value.raw.to_string())
                                .filter(|first| {
                                    t.expressions.is_empty()
                                        || first.starts_with("http://")
                                        || first.starts_with("https://")
                                }),
                            _ => None,
                        };
                        read.unwrap_or_else(|| "?".into())
                    };
                    self.out.push(drift_core::NextRewrite {
                        source: text("source"),
                        destination: text("destination"),
                    });
                }
            }
            Expression::ObjectExpression(o) => {
                for p in &o.properties {
                    match p {
                        ObjectPropertyKind::ObjectProperty(p)
                            if matches!(
                                key_name(&p.key).as_deref(),
                                Some("beforeFiles" | "afterFiles" | "fallback")
                            ) =>
                        {
                            self.list(&p.value)
                        }
                        _ => self.unread(),
                    }
                }
            }
            _ => self.unread(),
        }
    }
}

/// Hands each value a configuration function returns to [`NextRewrites::exported`],
/// outside the functions written in it.
struct ExportedReturns<'r> {
    r: &'r mut NextRewrites,
}

impl<'a> Visit<'a> for ExportedReturns<'_> {
    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        if let Some(e) = &it.argument {
            self.r.exported(e);
        }
    }

    // A binding of the function's own (`const c = withProxy({...}); return c`):
    // what it is bound to may be what is returned, so it is read as exported, and
    // the name is bound.
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(init) = &it.init {
            let mut names = Vec::new();
            binding_names(&it.id, &mut names);
            self.r.bound_inside.extend(names);
            self.r.exported(init);
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_function(&mut self, _: &Function<'a>, _: oxc_semantic::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
}

impl<'a> Visit<'a> for NextRewrites {
    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        if !self.inside && key_name(&it.key).as_deref() == Some("basePath") {
            self.base_path = true;
        }
        if self.inside || key_name(&it.key).as_deref() != Some("rewrites") {
            walk::walk_object_property(self, it);
            return;
        }
        self.read(&it.value);
    }

    fn visit_import_declaration(&mut self, it: &ImportDeclaration<'a>) {
        for spec in it.specifiers.iter().flatten() {
            let local = match spec {
                ImportDeclarationSpecifier::ImportSpecifier(s) => &s.local,
                ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => &s.local,
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => &s.local,
            };
            self.bindings
                .insert(local.name.to_string(), lit(&it.source));
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        // `const withX = require("x")(options)`, and what a call of a binding of a
        // package hands back (`const withAnalyzer = bundleAnalyzer({ enabled })`).
        if !self.inside
            && let Some(init) = &it.init
            && let Some(module) = required(init).or_else(|| {
                let Expression::CallExpression(c) = unwrap_expr(init) else {
                    return None;
                };
                let mut cur = unwrap_expr(&c.callee);
                loop {
                    match cur {
                        Expression::CallExpression(inner) => cur = unwrap_expr(&inner.callee),
                        Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                        Expression::Identifier(id) => {
                            return self.bindings.get(id.name.as_str()).cloned();
                        }
                        _ => return None,
                    }
                }
            })
        {
            let mut names = Vec::new();
            binding_names(&it.id, &mut names);
            for n in names {
                self.bindings.insert(n, module.clone());
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    // `export { nextConfig as default }`: the binding is the configuration.
    fn visit_export_named_declaration(&mut self, it: &ExportNamedDeclaration<'a>) {
        for spec in &it.specifiers {
            if module_export_name(&spec.exported) == "default" {
                self.names.insert(module_export_name(&spec.local));
            }
        }
        walk::walk_export_named_declaration(self, it);
    }

    // `export { default } from "./base"`, `export * as default from "./base"`: the
    // configuration is another module's.
    fn visit_export_from_declaration(&mut self, it: &ExportFromDeclaration<'a>) {
        if it
            .specifiers
            .iter()
            .any(|spec| module_export_name(&spec.exported) == "default")
        {
            self.wrapped = true;
        }
    }

    fn visit_export_all_declaration(&mut self, it: &ExportAllDeclaration<'a>) {
        if it
            .exported
            .as_ref()
            .is_some_and(|e| module_export_name(e) == "default")
        {
            self.wrapped = true;
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if !self.inside
            && call_name(&it.callee).is_some_and(merging_call)
            && let Some(Expression::Identifier(id)) = it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
        {
            self.merged.insert(id.name.to_string());
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_export_default_declaration(&mut self, it: &ExportDefaultDeclaration<'a>) {
        if let Some(e) = it.declaration.as_expression() {
            self.exported(e);
        } else if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &it.declaration
            && let Some(b) = &f.body
        {
            ExportedReturns { r: self }.visit_function_body(b);
        }
        walk::walk_export_default_declaration(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if !self.inside
            && let AssignmentTarget::StaticMemberExpression(m) = &it.left
        {
            match m.property.name.as_str() {
                // `module.exports = withX(nextConfig)`.
                "exports" if matches!(unwrap_expr(&m.object), Expression::Identifier(id) if id.name == "module") =>
                {
                    self.exported(&it.right);
                }
                // `nextConfig.rewrites = async () => [...]`.
                "rewrites" => {
                    self.read(&it.right);
                    return;
                }
                "basePath" => self.base_path = true,
                _ => {}
            }
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        if self.inside {
            match &it.argument {
                Some(e) => self.list(e),
                None => self.unread(),
            }
        }
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        if !self.inside {
            walk::walk_function(self, it, flags);
        }
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if !self.inside {
            walk::walk_arrow_function_expression(self, it);
        }
    }
}

fn lit(s: &StringLiteral) -> String {
    s.value.display().to_string()
}

/// Strip parentheses and TypeScript-only wrappers.
/// Packages whose calls build schema values (`z.object(...)`, `yup.string()`,
/// `v.pipe(...)`, `Type.Object(...)`, drizzle-zod's `createInsertSchema(table)`).
const SCHEMA_PACKAGES: &[&str] = &[
    "zod",
    "yup",
    "joi",
    "valibot",
    "superstruct",
    "@sinclair/typebox",
    "arktype",
    "io-ts",
    "runtypes",
    "@effect/schema",
    "@vinejs/vine",
    "drizzle-zod",
];

/// Schema steps that make a function of a schema (`z.function().implement(fn)`).
const SCHEMA_FUNCTION_STEPS: &[&str] = &["implement", "implementAsync", "strictImplement"];

/// Built-in calls whose result is plain data, never a library's value
/// (`Object.keys(tools)`, `new Map()`), as (global, member).
const PLAIN_BUILTINS: &[(&str, &str)] = &[
    ("Object", ".keys"),
    ("Object", ".values"),
    ("Object", ".entries"),
    ("Object", ".fromEntries"),
    ("Array", ".from"),
    ("Array", ".of"),
    ("JSON", ".parse"),
    ("Map", ""),
    ("Set", ""),
    ("WeakMap", ""),
    ("WeakSet", ""),
];

/// The identifier a call or member chain starts from (`z` of `z.object().refine(fn)`),
/// and whether a step of the chain makes a function of it ([`SCHEMA_FUNCTION_STEPS`]).
fn chain_root<'b, 'a>(e: &'b Expression<'a>) -> Option<(&'b IdentifierReference<'a>, bool)> {
    let mut cur = unwrap_expr(e);
    let mut function_step = false;
    let mut calls = 0;
    loop {
        cur = match cur {
            Expression::CallExpression(c) => {
                calls += 1;
                unwrap_expr(&c.callee)
            }
            Expression::StaticMemberExpression(m) => {
                function_step |= SCHEMA_FUNCTION_STEPS.contains(&m.property.name.as_str());
                unwrap_expr(&m.object)
            }
            Expression::ComputedMemberExpression(m) => unwrap_expr(&m.object),
            Expression::Identifier(id) if calls > 0 => return Some((id, function_step)),
            _ => return None,
        }
    }
}

/// A module of types only: type aliases, interfaces and ambient (`declare`)
/// declarations, with imports and type exports, and at least one type. A `const enum`, a namespace with code, `export * from`, a re-export
/// of values or any statement that runs is code.
fn is_type_only(program: &Program) -> bool {
    let mut types: BTreeSet<&str> = BTreeSet::new();
    let mut local_exports: Vec<&str> = Vec::new();
    for stmt in &program.body {
        let ok = match stmt {
            Statement::EmptyStatement(_) => true,
            // An import loads another module (`import "server-only"` included); the
            // module itself runs nothing for it.
            Statement::ImportDeclaration(_) => true,
            Statement::ExportDeclaration(e) => type_declaration(&e.declaration, &mut types),
            Statement::ExportDefaultDeclaration(e) => match &e.declaration {
                ExportDefaultDeclarationKind::TSInterfaceDeclaration(t) => {
                    types.insert(t.id.name.as_str());
                    true
                }
                _ => false,
            },
            Statement::ExportNamedDeclaration(e) => {
                if !e.export_kind.is_type() {
                    for s in e.specifiers.iter().filter(|s| !s.export_kind.is_type()) {
                        local_exports.push(match &s.local {
                            ModuleExportName::IdentifierName(i) => i.name.as_str(),
                            ModuleExportName::IdentifierReference(i) => i.name.as_str(),
                            ModuleExportName::StringLiteral(_) => "",
                        });
                    }
                }
                true
            }
            Statement::ExportFromDeclaration(e) => {
                e.export_kind.is_type() || e.specifiers.iter().all(|s| s.export_kind.is_type())
            }
            Statement::ExportAllDeclaration(e) => e.export_kind.is_type(),
            _ => stmt
                .as_declaration()
                .is_some_and(|d| type_declaration(d, &mut types)),
        };
        if !ok {
            return false;
        }
    }
    // `export { x }` exports a type declared here, not an imported value.
    !types.is_empty() && local_exports.iter().all(|n| types.contains(n))
}

/// [`is_type_only`]: a declaration that is erased at compile time; type names are
/// added to `types`.
fn type_declaration<'a>(d: &'a Declaration<'a>, types: &mut BTreeSet<&'a str>) -> bool {
    match d {
        Declaration::TSTypeAliasDeclaration(t) => types.insert(t.id.name.as_str()) || true,
        Declaration::TSInterfaceDeclaration(t) => types.insert(t.id.name.as_str()) || true,
        Declaration::VariableDeclaration(v) => v.declare,
        Declaration::FunctionDeclaration(f) => f.declare,
        Declaration::ClassDeclaration(c) => c.declare,
        Declaration::TSEnumDeclaration(e) => e.declare,
        Declaration::TSExternalModuleDeclaration(m) => m.declare,
        Declaration::TSNamespaceDeclaration(n) => n.declare,
        Declaration::TSGlobalDeclaration(_) => true,
        Declaration::TSImportEqualsDeclaration(_) => false,
    }
}

fn unwrap_expr<'b, 'a>(mut e: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        e = match e {
            Expression::ParenthesizedExpression(p) => &p.expression,
            Expression::TSAsExpression(x) => &x.expression,
            Expression::TSSatisfiesExpression(x) => &x.expression,
            Expression::TSNonNullExpression(x) => &x.expression,
            Expression::TSTypeAssertion(x) => &x.expression,
            Expression::TSInstantiationExpression(x) => &x.expression,
            _ => return e,
        };
    }
}

/// A name that is a tenant or an owner key (`orgId`, `org_id`, `owner_id`).
fn scope_key(name: &str) -> bool {
    drift_core::practice::tenant_key(name) || drift_core::practice::owner_key(name)
}

/// The annotation says the function hands back a promise (`): Promise<void>`).
fn returns_promise(t: Option<&TSTypeAnnotation>) -> bool {
    t.is_some_and(|t| {
        matches!(&t.type_annotation, TSType::TSTypeReference(r)
            if matches!(&r.type_name, TSTypeName::IdentifierReference(id) if id.name == "Promise"))
    })
}

/// The value is an `async` function, one annotated to hand back a promise, or a call
/// given one (`withAuth(async (req) => ...)`: what the wrapper hands back is taken to
/// be as asynchronous as what it wraps).
fn async_function(e: &Expression, depth: usize) -> bool {
    match unwrap_expr(e) {
        Expression::ArrowFunctionExpression(f) => {
            f.r#async || returns_promise(f.return_type.as_deref())
        }
        Expression::FunctionExpression(f) => f.r#async || returns_promise(f.return_type.as_deref()),
        Expression::CallExpression(c) if depth < 3 => c
            .arguments
            .iter()
            .filter_map(|a| a.as_expression())
            .any(|a| async_function(a, depth + 1)),
        _ => false,
    }
}

/// The export a `.then((m) => m.Shell)` or `.then((m) => ({ default: m.Shell }))`
/// picks from the loaded module `m`; None for anything else (`m.Shell.Inner`).
fn lazy_pick(f: &ArrowFunctionExpression) -> Option<String> {
    let [p] = f.params.items.as_slice() else {
        return None;
    };
    let BindingPattern::BindingIdentifier(module) = &p.pattern else {
        return None;
    };
    let member_of_module = |e: &Expression| match unwrap_expr(e) {
        Expression::StaticMemberExpression(m) => match unwrap_expr(&m.object) {
            Expression::Identifier(id) if id.name == module.name => {
                Some(m.property.name.to_string())
            }
            _ => None,
        },
        _ => None,
    };
    let e = unwrap_expr(f.get_expression()?);
    if let Expression::ObjectExpression(o) = e {
        return o.properties.iter().find_map(|p| match p {
            ObjectPropertyKind::ObjectProperty(p)
                if p.key
                    .static_name()
                    .is_some_and(|k| k.as_str() == Some("default")) =>
            {
                member_of_module(&p.value)
            }
            _ => None,
        });
    }
    member_of_module(e)
}

/// Record on a function symbol whether it reads request input: `reads_input` when it
/// does (`saw` is input read anywhere in its body), `no_input` when it provably does
/// not, nothing when Drift cannot tell. Other kinds of symbol (a class whose methods
/// read a request, a component's props) carry neither.
pub(crate) fn record_input(sym: &mut RawSymbol, saw: bool, status: input::InputUse) {
    use drift_core::controls::{NO_INPUT, READS_INPUT};
    if sym.kind != SymbolKind::Function {
        return;
    }
    let fact = match (saw, status) {
        (true, _) | (_, input::InputUse::Reads) => READS_INPUT,
        (_, input::InputUse::None) => NO_INPUT,
        (_, input::InputUse::Unknown) => return,
    };
    if !sym.controls.iter().any(|c| c == fact) {
        sym.controls.push(fact.into());
    }
}

/// A property key's static name as an owned string.
fn key_name(k: &PropertyKey) -> Option<String> {
    k.static_name().and_then(|n| n.as_str().map(String::from))
}

/// A key that can be written in the side of a value (`param opts #0.userId`,
/// [`Collector::param_root`]): an identifier, so that no side holds a space, a tab
/// or a dot of a key's own.
fn side_key(k: &str) -> bool {
    !k.is_empty()
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn starts_upper(s: &str) -> bool {
    s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

impl<'s> Lowerer<'s> {
    fn new(scoping: &'s Scoping, text: &str) -> Self {
        let mut line_starts = vec![0u32];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(u32::try_from(i + 1).unwrap_or(u32::MAX));
            }
        }
        Self {
            scoping,
            line_starts,
            imports: BTreeMap::new(),
            out: RawFile::default(),
            module_sym: None,
            express: BTreeMap::new(),
            passed: BTreeMap::new(),
            decorations: BTreeMap::new(),
            base_paths: BTreeMap::new(),
            position_calls: BTreeMap::new(),
            route_options: BTreeMap::new(),
            scope: 0,
            scope_seq: 0,
            scope_conditional: false,
            scope_prefix: Vec::new(),
            scope_routes: Vec::new(),
            scope_unread: BTreeMap::new(),
            hooks: BTreeMap::new(),
            param_hooks: BTreeMap::new(),
            router_adapter: BTreeMap::new(),
            route_configs: BTreeMap::new(),
            this_types: std::cell::RefCell::new(BTreeMap::new()),
            this_plain: std::cell::RefCell::new(BTreeSet::new()),
            this_request: std::cell::RefCell::new(BTreeSet::new()),
            request_holders: HashSet::new(),
            async_fns: HashSet::new(),
            builders: HashMap::new(),
            status_consts: HashSet::new(),
            top_classes: BTreeSet::new(),
            type_imports: BTreeMap::new(),
            typescript: false,
            schema_values: BTreeSet::new(),
            plain_values: BTreeSet::new(),
            env_consts: BTreeMap::new(),
            env_helpers: BTreeMap::new(),
            env_bound: BTreeSet::new(),
            module_news: BTreeMap::new(),
            this_news: std::cell::RefCell::new(BTreeMap::new()),
            test_file: false,
            sql: signals::SqlLocals::default(),
            closure_routers: BTreeSet::new(),
            guard_sites: BTreeMap::new(),
            handed_routers: BTreeMap::new(),
            lowered_sites: HashSet::new(),
            params: HashMap::new(),
            param_builtins: HashMap::new(),
        }
    }

    fn line_of(&self, offset: u32) -> u32 {
        let idx = self.line_starts.partition_point(|&s| s <= offset);
        u32::try_from(idx).unwrap_or(u32::MAX)
    }

    fn finish(mut self) -> RawFile {
        // A Fastify route takes the hooks of its instance when the instance is
        // ready: one added below the route in the file runs for it too.
        for (symbol, router) in &self.out.route_routers {
            if self.router_adapter.get(router).copied() != Some("fastify") {
                continue;
            }
            let Some(hooks) = self.hooks.get(router) else {
                continue;
            };
            if let Some(sym) = self.out.symbols.iter_mut().find(|s| s.name == *symbol) {
                for (pattern, hook) in hooks {
                    if pattern.is_empty() && !sym.app_middleware.contains(hook) {
                        sym.app_middleware.push(hook.clone());
                    }
                }
                for (pattern, call) in self.position_calls.get(router).into_iter().flatten() {
                    if pattern.is_empty() && !sym.guard_calls.contains(call) {
                        sym.guard_calls.push(call.clone());
                    }
                }
            }
        }
        // Express runs a `router.param` callback for every route of the router with
        // that parameter, wherever in the file it is registered.
        for (symbol, router) in &self.out.route_routers {
            let Some(params) = self.param_hooks.get(router) else {
                continue;
            };
            let Some(path) = self
                .out
                .entry_points
                .iter()
                .find(|e| e.symbol == *symbol)
                .and_then(|e| e.route.clone())
            else {
                continue;
            };
            if let Some(sym) = self.out.symbols.iter_mut().find(|s| s.name == *symbol) {
                for (name, hook) in params {
                    if routes::has_param(&path, name) && !sym.app_middleware.contains(hook) {
                        sym.app_middleware.push(hook.clone());
                    }
                }
            }
        }
        if let Some(m) = self.module_sym.take()
            && !(m.calls.is_empty() && m.renders.is_empty())
        {
            self.out.symbols.push(m);
        }
        for s in self
            .out
            .symbols
            .iter_mut()
            .chain(self.out.trpc.candidates.iter_mut().map(|c| &mut c.symbol))
        {
            s.calls.sort();
            s.calls.dedup();
            s.renders.sort();
            s.renders.dedup();
            s.args.sort();
            s.args.dedup();
            s.controls.sort();
            s.controls.dedup();
            s.reads.sort();
            s.reads.dedup();
            s.throws.sort();
            s.throws.dedup();
            s.after_continuation.sort();
            s.after_continuation.dedup();
            s.sinks.sort();
            s.sinks.dedup();
            s.body_checks.sort();
            s.body_checks.dedup();
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
            s.handles_errors.sort();
            s.handles_errors.dedup();
            s.env_calls.sort();
            s.env_calls.dedup();
            s.param_calls.sort();
            s.param_calls.dedup();
            s.typed_param_calls.sort();
            s.typed_param_calls.dedup();
        }
        self.out.symbols.sort();
        self.out.imports.sort();
        self.out.exports.sort();
        self.out.exports.dedup();
        self.out.directives.sort();
        self.out.directives.dedup();
        self.out
    }

    // ---------------------------------------------------------------- references

    fn resolve_ident(&self, id: &IdentifierReference) -> Option<RawBase> {
        let name = id.name.as_str();
        let symbol = id
            .reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id());
        match symbol {
            None => Some(RawBase::Global(name.to_string())),
            Some(sym) => {
                let flags = self.scoping.symbol_flags(sym);
                if flags.is_import() {
                    let (spec, imported) = self.imports.get(name)?;
                    Some(RawBase::Import {
                        spec: spec.clone(),
                        name: imported.clone(),
                    })
                } else if self.scoping.symbol_scope_id(sym) == self.scoping.root_scope_id() {
                    // CommonJS `const x = require("spec")` bindings are top-level locals.
                    if let Some((spec, imported)) = self.imports.get(name) {
                        return Some(RawBase::Import {
                            spec: spec.clone(),
                            name: imported.clone(),
                        });
                    }
                    Some(RawBase::Local(name.to_string()))
                } else {
                    None
                }
            }
        }
    }

    /// `require("spec")` with a literal specifier and an undeclared `require`.
    fn require_spec(&self, e: &Expression) -> Option<String> {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        self.require_spec_call(c)
    }

    fn require_spec_call(&self, c: &CallExpression) -> Option<String> {
        let Expression::Identifier(id) = unwrap_expr(&c.callee) else {
            return None;
        };
        if id.name != "require"
            || !matches!(self.resolve_ident(id), Some(RawBase::Global(_)))
            || c.arguments.len() != 1
        {
            return None;
        }
        match c.arguments[0].as_expression().map(unwrap_expr) {
            Some(Expression::StringLiteral(l)) => Some(lit(l)),
            _ => None,
        }
    }

    /// True when `e` is the undeclared global `name` (e.g. `module`, `exports`).
    fn is_global(&self, e: &Expression, name: &str) -> bool {
        matches!(unwrap_expr(e), Expression::Identifier(id) if id.name == name && matches!(self.resolve_ident(id), Some(RawBase::Global(_))))
    }

    /// Canonical raw reference for a callee-like expression, if it has one.
    fn canon(&self, e: &Expression) -> Option<RawRef> {
        if let Some(spec) = self.require_spec(e) {
            return Some(RawRef {
                base: RawBase::Import {
                    spec,
                    name: "default".into(),
                },
                member: String::new(),
            });
        }
        match unwrap_expr(e) {
            Expression::Identifier(id) => Some(RawRef {
                base: self.resolve_ident(id)?,
                member: String::new(),
            }),
            Expression::StaticMemberExpression(m)
                if matches!(unwrap_expr(&m.object), Expression::ThisExpression(_)) =>
            {
                // `this.users` -> the injected type (`UsersService`), if known.
                self.this_types
                    .borrow()
                    .get(m.property.name.as_str())
                    .cloned()
            }
            Expression::StaticMemberExpression(m) => {
                let mut r = self.canon(&m.object)?;
                if r.member.matches('.').count() >= MAX_MEMBER_DEPTH {
                    return Some(r);
                }
                r.member.push('.');
                r.member.push_str(m.property.name.as_str());
                Some(r)
            }
            Expression::CallExpression(c) => {
                let mut r = self.canon(&c.callee)?;
                r.member.push_str("()");
                Some(r)
            }
            Expression::ChainExpression(ch) => match &ch.expression {
                ChainElement::CallExpression(c) => {
                    let mut r = self.canon(&c.callee)?;
                    r.member.push_str("()");
                    Some(r)
                }
                ChainElement::StaticMemberExpression(m) => {
                    let mut r = self.canon(&m.object)?;
                    r.member.push('.');
                    r.member.push_str(m.property.name.as_str());
                    Some(r)
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn canon_callee(&self, callee: &Expression) -> Option<RawRef> {
        // Optional calls `a?.b()` put the member chain inside a ChainExpression.
        self.canon(callee)
    }

    fn canon_jsx(&self, name: &JSXElementName) -> Option<RawRef> {
        match name {
            JSXElementName::IdentifierReference(id) if starts_upper(&id.name) => Some(RawRef {
                base: self.resolve_ident(id)?,
                member: String::new(),
            }),
            JSXElementName::MemberExpression(m) => self.canon_jsx_member(m),
            _ => None,
        }
    }

    fn canon_jsx_member(&self, m: &JSXMemberExpression) -> Option<RawRef> {
        let mut r = match &m.object {
            JSXMemberExpressionObject::IdentifierReference(id) => RawRef {
                base: self.resolve_ident(id)?,
                member: String::new(),
            },
            JSXMemberExpressionObject::MemberExpression(inner) => self.canon_jsx_member(inner)?,
            JSXMemberExpressionObject::ThisExpression(_) => return None,
        };
        r.member.push('.');
        r.member.push_str(m.property.name.as_str());
        Some(r)
    }

    // ---------------------------------------------------------------- program

    fn lower_program(&mut self, program: &Program) {
        for d in &program.directives {
            self.out.directives.push(d.directive.to_string());
        }
        self.out.type_only = is_type_only(program);
        // Imports first, so references anywhere in the file can be resolved.
        for stmt in &program.body {
            if let Statement::ImportDeclaration(imp) = stmt {
                self.lower_import(imp);
            }
        }
        // CommonJS: top-level `const x = require("s")`, `const { a } = require("s")`,
        // `const y = require("s").y`.
        for stmt in &program.body {
            if let Statement::VariableDeclaration(v) = stmt {
                for d in &v.declarations {
                    if let Some(init) = &d.init
                        && !self.lower_require_binding(&d.id, init)
                    {
                        self.lower_lazy_binding(&d.id, init);
                    }
                }
            }
        }
        // A re-export (`export { x } from "s"`, `export * from "s"`, `export * as ns
        // from "s"`) is a static import of "s", as Python's `from s import x` in an
        // `__init__` is: the module loads with the file, however else it is loaded.
        for r in reexport_imports(program) {
            match self
                .out
                .imports
                .iter_mut()
                .find(|i| !i.type_only && i.spec == r.spec)
            {
                Some(i) => {
                    i.names.extend(r.names);
                    i.names.sort();
                    i.names.dedup();
                }
                None => self.out.imports.push(r),
            }
        }
        // Any other `require("s")` (inside functions, conditionals) and every literal
        // `import("s")` is still an import, loaded when that code runs.
        let mut finder = LoadFinder {
            l: self,
            specs: BTreeMap::new(),
            depth: 0,
            in_place: None,
            calls: BTreeSet::new(),
        };
        finder.visit_program(program);
        let (specs, calls) = (finder.specs, finder.calls);
        // Value imports already recorded (a type-only one does not load the module).
        let known: BTreeSet<String> = self
            .out
            .imports
            .iter()
            .filter(|i| !i.type_only)
            .map(|i| i.spec.clone())
            .collect();
        for (spec, load) in specs {
            if known.contains(&spec) {
                // Also loaded by the file's own code: no longer a re-export only.
                for i in self.out.imports.iter_mut().filter(|i| i.spec == spec) {
                    i.reexport = false;
                }
            } else {
                self.out.imports.push(RawImport {
                    spec,
                    names: vec!["default".into()],
                    type_only: false,
                    load,
                    reexport: false,
                });
            }
        }
        self.out.loader_calls = calls.into_iter().collect();
        self.out.loaders = self.loaders(program);
        // Express apps and routers, so route registrations can be recognised, whether
        // declared plainly or exported in place (`export const v1 = express.Router()`).
        for stmt in &program.body {
            let decl = match stmt {
                Statement::VariableDeclaration(v) => Some(&**v),
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::VariableDeclaration(v) => Some(&**v),
                    _ => None,
                },
                _ => None,
            };
            if let Some(v) = decl {
                for d in &v.declarations {
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        && let Some(adapter) = self.router_adapter_of(init)
                    {
                        self.express.insert(id.name.to_string(), vec![]);
                        self.router_adapter.insert(id.name.to_string(), adapter);
                        // `new Hono().basePath("/api")`: every path of the router
                        // is under it.
                        if let Some(base) = routes::base_path(init) {
                            self.base_paths.insert(id.name.to_string(), base);
                        }
                    }
                    // Hono: `const route = createRoute({ method, path, middleware })` for `.openapi(route, ...)`.
                    if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        && let Some(cfg) = self.route_config(init)
                    {
                        self.route_configs.insert(id.name.to_string(), cfg);
                    }
                }
            }
            // `export default Router()`, possibly with registrations chained on it.
            if let Statement::ExportDefaultDeclaration(e) = stmt
                && let Some(expr) = e.declaration.as_expression()
                && let Some(adapter) = self.inline_router_adapter(expr)
            {
                self.express
                    .insert(routes::DEFAULT_ROUTER.to_string(), vec![]);
                self.router_adapter
                    .insert(routes::DEFAULT_ROUTER.to_string(), adapter);
            }
        }
        self.out.routers = self.express.keys().cloned().collect();
        self.practice_prepass(program);
        self.request_holders = caller::request_holders(program, self.scoping);
        self.async_fns = async_functions(program);
        self.builders = refusal_builders(program);
        self.status_consts = status_consts(program);
        self.sql = signals::SqlLocals::of(program, self.scoping);
        self.guard_sites = routes::RouterSites::of(self, program);
        self.handed_routers = routes::HandedRouters::of(self, program);
        self.top_classes = top_level_classes(program);
        self.matcher_polarity(program);
        let mut params = ParamFinder {
            l: self,
            found: HashMap::new(),
            builtins: HashMap::new(),
        };
        params.visit_program(program);
        let ParamFinder {
            found, builtins, ..
        } = params;
        self.params = found;
        self.param_builtins = builtins;
        for stmt in &program.body {
            self.lower_statement(stmt);
        }
        // Routers a function builds or is handed: a Fastify plugin's instance, the
        // router of an Express factory, the application a set-up helper is given.
        self.lower_router_functions(program);
        // And the routes a function registers on a router of the module it is not
        // handed, or the module registers under a condition.
        self.lower_closure_routes(program);
        // Fastify `x.route({ method, url, handler })` and `register(plugin, { prefix })`
        // usually live inside plugin functions, so they are found anywhere in the file.
        self.lower_fastify_anywhere(program);
        self.lower_nest_application(program);
        self.lower_nest_global_guards(program);
        self.lower_nest_metadata(program);
        self.out.unlisted_routes = routes::UnlistedRoutes::of(self, program);
        for sym in &mut self.out.symbols {
            if let Some(o) = self.builders.get(&sym.name) {
                sym.refusal_builder = Some(*o);
                // A builder checks no one: what it builds refuses only as the exit
                // of a caller's check ([`RawSymbol::builder_checks`]). The listed
                // reading holds no refusal of its own for it (linking also takes
                // the measured `rejects_caller` off it there).
                sym.listed_controls.retain(|c| {
                    c != drift_core::controls::REJECTS_CALLER
                        && !c.starts_with(drift_core::controls::RETURNS_REJECTION)
                });
            }
        }
        self.lower_node_listeners(program);
        self.lower_rpc_and_jobs_anywhere(program);
        let mut tests = TestFinder {
            l: self,
            tests: self.test_file,
            block: Vec::new(),
            requests: BTreeSet::new(),
            mocks: BTreeSet::new(),
        };
        tests.visit_program(program);
        let (requests, mocks) = (tests.requests, tests.mocks);
        self.out.test_requests = requests.into_iter().collect();
        self.out.mocks = mocks.into_iter().collect();
    }

    /// `const X = dynamic(() => import("spec"))` (`next/dynamic`) or `React.lazy(() =>
    /// import("spec"))`: `X` is the module's default export (or the named export a
    /// `.then((m) => m.Y)` picks), so `<X>` renders that component. No import fact is
    /// added: the dynamic import is one already.
    fn lower_lazy_binding(&mut self, id: &BindingPattern, init: &Expression) {
        let BindingPattern::BindingIdentifier(b) = id else {
            return;
        };
        let Expression::CallExpression(c) = unwrap_expr(init) else {
            return;
        };
        let lazy = match self.canon_callee(&c.callee) {
            Some(RawRef {
                base: RawBase::Import { spec, name },
                member,
            }) => {
                (spec == "next/dynamic" && name == "default" && member.is_empty())
                    || (spec == "react"
                        && ((name == "lazy" && member.is_empty())
                            || (matches!(name.as_str(), "default" | "*") && member == ".lazy")))
            }
            _ => false,
        };
        if !lazy {
            return;
        }
        let Some(loader) = c.arguments.first().and_then(|a| a.as_expression()) else {
            return;
        };
        let Expression::ArrowFunctionExpression(f) = unwrap_expr(loader) else {
            return;
        };
        let Some(body) = (if f.is_expression() {
            f.get_expression()
        } else {
            None
        }) else {
            return;
        };
        let (import, picked) = match unwrap_expr(body) {
            Expression::ImportExpression(i) => (&**i, None),
            // `import("spec").then((m) => m.Named)`
            Expression::CallExpression(then) => {
                let Expression::StaticMemberExpression(m) = unwrap_expr(&then.callee) else {
                    return;
                };
                let Expression::ImportExpression(i) = unwrap_expr(&m.object) else {
                    return;
                };
                if m.property.name != "then" {
                    return;
                }
                let picked = then
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .and_then(|e| match unwrap_expr(e) {
                        Expression::ArrowFunctionExpression(pf) if pf.is_expression() => {
                            lazy_pick(pf)
                        }
                        _ => None,
                    });
                let Some(picked) = picked else { return };
                (&**i, Some(picked))
            }
            _ => return,
        };
        let Expression::StringLiteral(spec) = unwrap_expr(&import.source) else {
            return;
        };
        self.imports.insert(
            b.name.to_string(),
            (lit(spec), picked.unwrap_or_else(|| "default".into())),
        );
    }

    /// Record a CommonJS require binding; returns true when `init` is a require.
    fn lower_require_binding(&mut self, id: &BindingPattern, init: &Expression) -> bool {
        let (spec, member) = match unwrap_expr(init) {
            Expression::StaticMemberExpression(m) => match self.require_spec(&m.object) {
                Some(spec) => (spec, Some(m.property.name.to_string())),
                None => return false,
            },
            e => match self.require_spec(e) {
                Some(spec) => (spec, None),
                None => return false,
            },
        };
        let mut names = Vec::new();
        match id {
            BindingPattern::BindingIdentifier(b) => {
                let imported = member.unwrap_or_else(|| "default".into());
                self.imports
                    .insert(b.name.to_string(), (spec.clone(), imported.clone()));
                names.push(imported);
            }
            BindingPattern::ObjectPattern(o) if member.is_none() => {
                for p in &o.properties {
                    if let (Some(k), BindingPattern::BindingIdentifier(local)) =
                        (p.key.static_name(), &p.value)
                        && let Some(k) = k.as_str()
                    {
                        self.imports
                            .insert(local.name.to_string(), (spec.clone(), k.to_string()));
                        names.push(k.to_string());
                    }
                }
            }
            _ => names.push("default".into()),
        }
        names.sort();
        names.dedup();
        self.out.imports.push(RawImport {
            spec,
            names,
            type_only: false,
            load: ImportLoad::Static,
            reexport: false,
        });
        true
    }

    /// Top-level functions that load a parameter (`function optionalRequire(name) {
    /// return import(name) }`), found by what their body does, not by their name.
    fn loaders(&self, program: &Program) -> Vec<(String, u32)> {
        let mut out = BTreeSet::new();
        let function = |f: &Function| match &f.body {
            Some(body) => self.loaded_params(&f.params, |v| v.visit_function_body(body)),
            None => BTreeSet::new(),
        };
        let mut decls: Vec<&Declaration> = Vec::new();
        for stmt in &program.body {
            match stmt {
                Statement::ExportDeclaration(e) => decls.push(&e.declaration),
                Statement::ExportDefaultDeclaration(e) => {
                    if let ExportDefaultDeclarationKind::FunctionDeclaration(f) = &e.declaration
                        && let Some(id) = &f.id
                    {
                        out.extend(function(f).into_iter().map(|i| (id.name.to_string(), i)));
                    }
                }
                _ => decls.extend(stmt.as_declaration()),
            }
        }
        for d in decls {
            match d {
                Declaration::FunctionDeclaration(f) => {
                    if let Some(id) = &f.id {
                        out.extend(function(f).into_iter().map(|i| (id.name.to_string(), i)));
                    }
                }
                Declaration::VariableDeclaration(v) => {
                    for d in &v.declarations {
                        let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init)
                        else {
                            continue;
                        };
                        let params = match unwrap_expr(init) {
                            Expression::FunctionExpression(f) => function(f),
                            Expression::ArrowFunctionExpression(a) => self
                                .loaded_params(&a.params, |v| v.visit_arrow_function_body(&a.body)),
                            _ => BTreeSet::new(),
                        };
                        out.extend(params.into_iter().map(|i| (id.name.to_string(), i)));
                    }
                }
                _ => {}
            }
        }
        out.into_iter().collect()
    }

    /// Indexes of the parameters a function body passes to `import()`, `require()` or
    /// `createRequire(...)()`.
    fn loaded_params(
        &self,
        params: &FormalParameters,
        walk_body: impl FnOnce(&mut ParamLoads<'_, 's>),
    ) -> BTreeSet<u32> {
        let mut v = ParamLoads {
            l: self,
            params: params
                .items
                .iter()
                .enumerate()
                .filter_map(|(i, p)| match &p.pattern {
                    BindingPattern::BindingIdentifier(b) => {
                        Some((b.symbol_id.get()?, u32::try_from(i).ok()?))
                    }
                    _ => None,
                })
                .collect(),
            found: BTreeSet::new(),
        };
        if v.params.is_empty() {
            return BTreeSet::new();
        }
        walk_body(&mut v);
        v.found
    }

    fn lower_import(&mut self, imp: &ImportDeclaration) {
        let spec = lit(&imp.source);
        let type_only = imp.import_kind.is_type();
        let mut names = Vec::new();
        if let Some(specs) = &imp.specifiers {
            for s in specs {
                let (local, imported) = match s {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => {
                        if s.import_kind.is_type() {
                            self.type_imports.insert(
                                s.local.name.to_string(),
                                (spec.clone(), module_export_name(&s.imported)),
                            );
                            continue;
                        }
                        (s.local.name.to_string(), module_export_name(&s.imported))
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                        (s.local.name.to_string(), "default".to_string())
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                        (s.local.name.to_string(), "*".to_string())
                    }
                };
                names.push(imported.clone());
                if type_only {
                    self.type_imports.insert(local, (spec.clone(), imported));
                } else {
                    self.imports.insert(local, (spec.clone(), imported));
                }
            }
        }
        names.sort();
        names.dedup();
        let type_only = type_only || self.only_used_as_types(imp);
        self.out.imports.push(RawImport {
            spec,
            names,
            type_only,
            load: ImportLoad::Static,
            reexport: false,
        });
    }

    /// TypeScript import elision: an import whose bindings are all referenced, and
    /// only in type positions, is removed from the emitted JavaScript. Unreferenced
    /// bindings are kept (classic-runtime JSX uses `React` without a reference).
    fn only_used_as_types(&self, imp: &ImportDeclaration) -> bool {
        if !self.typescript {
            return false;
        }
        let Some(specs) = &imp.specifiers else {
            return false; // side-effect import
        };
        !specs.is_empty()
            && specs.iter().all(|s| {
                let local = match s {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => &s.local,
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => &s.local,
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => &s.local,
                };
                let Some(sym) = local.symbol_id.get() else {
                    return false;
                };
                let refs = self.scoping.get_resolved_reference_ids(sym);
                !refs.is_empty()
                    && refs
                        .iter()
                        .all(|r| !self.scoping.get_reference(*r).flags().is_value())
            })
    }

    fn export_target_for_local(&self, local: &str) -> RawExportTarget {
        match self.imports.get(local) {
            Some((spec, name)) => RawExportTarget::From {
                spec: spec.clone(),
                name: name.clone(),
            },
            None => RawExportTarget::Local(local.to_string()),
        }
    }

    fn lower_statement(&mut self, stmt: &Statement) {
        match stmt {
            Statement::ImportDeclaration(_) => {}
            Statement::ExportDeclaration(e) => {
                for name in self.lower_declaration(&e.declaration) {
                    self.out.exports.push(RawExport {
                        name: name.clone(),
                        target: RawExportTarget::Local(name),
                    });
                }
            }
            Statement::ExportNamedDeclaration(e) => {
                if e.export_kind.is_type() {
                    return;
                }
                for s in &e.specifiers {
                    if s.export_kind.is_type() {
                        continue;
                    }
                    let local = module_export_name(&s.local);
                    let target = self.export_target_for_local(&local);
                    self.out.exports.push(RawExport {
                        name: module_export_name(&s.exported),
                        target,
                    });
                }
            }
            Statement::ExportFromDeclaration(e) => {
                if e.export_kind.is_type() {
                    return;
                }
                let spec = lit(&e.source);
                for s in &e.specifiers {
                    if s.export_kind.is_type() {
                        continue;
                    }
                    self.out.exports.push(RawExport {
                        name: module_export_name(&s.exported),
                        target: RawExportTarget::From {
                            spec: spec.clone(),
                            name: module_export_name(&s.local),
                        },
                    });
                }
            }
            Statement::ExportDefaultDeclaration(e) => self.lower_export_default(e),
            Statement::ExportAllDeclaration(e) => {
                if e.export_kind.is_type() {
                    return;
                }
                let spec = lit(&e.source);
                match &e.exported {
                    Some(ns) => self.out.exports.push(RawExport {
                        name: module_export_name(ns),
                        target: RawExportTarget::From {
                            spec,
                            name: "*".to_string(),
                        },
                    }),
                    None => self.out.exports.push(RawExport {
                        name: "*".to_string(),
                        target: RawExportTarget::All { spec },
                    }),
                }
            }
            Statement::ExpressionStatement(es)
                if self.lower_cjs_export(&es.expression)
                    || self.lower_express_routes(&es.expression, false) => {}
            _ => {
                if let Statement::ExpressionStatement(es) = stmt {
                    self.note_app_passed(&es.expression);
                }
                if let Some(decl) = stmt.as_declaration() {
                    self.lower_declaration(decl);
                } else {
                    // Top-level statements (e.g. `app.get("/x", handler)`) feed the module pseudo-symbol.
                    let line = self.line_of(stmt.span().start);
                    let mut c = Collector::new(self);
                    c.visit_statement(stmt);
                    let mut part = RawSymbol::empty(MODULE_SYMBOL, SymbolKind::Module, line);
                    c.fill(&mut part);
                    let m = self.module_sym.get_or_insert_with(|| {
                        RawSymbol::empty(MODULE_SYMBOL, SymbolKind::Module, line)
                    });
                    m.calls.extend(part.calls);
                    m.renders.extend(part.renders);
                    m.args.extend(part.args);
                    m.controls.extend(part.controls);
                    for c in part.listed_controls {
                        if c == drift_core::controls::ORM_FILTER && !m.listed_controls.contains(&c)
                        {
                            m.listed_controls.push(c);
                        }
                    }
                    m.string_literals += part.string_literals;
                    m.reads.extend(part.reads);
                    m.throws.extend(part.throws);
                    m.after_continuation.extend(part.after_continuation);
                    m.sinks.extend(part.sinks);
                    for k in part.fed_sinks {
                        if !m.fed_sinks.contains(&k) {
                            m.fed_sinks.push(k);
                        }
                    }
                    for r in part.param_passes {
                        if !m.param_passes.contains(&r) {
                            m.param_passes.push(r);
                        }
                    }
                    m.body_checks.extend(part.body_checks);
                    m.responses.extend(part.responses);
                    m.log_calls.extend(part.log_calls);
                    m.catches.extend(part.catches);
                    m.headers.extend(part.headers);
                    m.inputs.extend(part.inputs);
                    m.handles_errors.extend(part.handles_errors);
                    m.env_calls.extend(part.env_calls);
                    m.param_calls.extend(part.param_calls);
                    m.typed_param_calls.extend(part.typed_param_calls);
                    for r in part.order {
                        if !m.order.contains(&r) && m.order.len() < MAX_ORDER {
                            m.order.push(r);
                        }
                    }
                }
            }
        }
    }

    fn lower_export_default(&mut self, e: &ExportDefaultDeclaration) {
        match &e.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                let name =
                    f.id.as_ref()
                        .map_or_else(|| "default".to_string(), |i| i.name.to_string());
                self.record_trpc_function(&name, f);
                self.lower_function_symbol(&name, f);
                self.out.exports.push(RawExport {
                    name: "default".into(),
                    target: RawExportTarget::Local(name),
                });
            }
            ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                let name =
                    c.id.as_ref()
                        .map_or_else(|| "default".to_string(), |i| i.name.to_string());
                self.lower_class_symbol(&name, c);
                self.out.exports.push(RawExport {
                    name: "default".into(),
                    target: RawExportTarget::Local(name),
                });
            }
            ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
            other => {
                let Some(expr) = other.as_expression() else {
                    return;
                };
                if let Expression::Identifier(id) = unwrap_expr(expr) {
                    let target = self.export_target_for_local(id.name.as_str());
                    self.out.exports.push(RawExport {
                        name: "default".into(),
                        target,
                    });
                    return;
                }
                // `export default Router().get("/a", h)`: the chained registrations are routes.
                self.lower_express_routes(expr, true);
                self.record_trpc_binding("default", expr);
                self.lower_value_symbol("default", expr, SymbolKind::Const, e.span.start);
                self.out.exports.push(RawExport {
                    name: "default".into(),
                    target: RawExportTarget::Local("default".into()),
                });
            }
        }
    }

    /// Lower a declaration; returns the names it declares.
    fn lower_declaration(&mut self, decl: &Declaration) -> Vec<String> {
        match decl {
            Declaration::FunctionDeclaration(f) => {
                let Some(id) = &f.id else { return vec![] };
                let name = id.name.to_string();
                self.record_trpc_function(&name, f);
                self.lower_function_symbol(&name, f);
                vec![name]
            }
            Declaration::ClassDeclaration(c) => {
                let Some(id) = &c.id else { return vec![] };
                let name = id.name.to_string();
                self.lower_class_symbol(&name, c);
                vec![name]
            }
            Declaration::VariableDeclaration(v) => {
                let kind = if v.kind.is_const() {
                    SymbolKind::Const
                } else {
                    SymbolKind::Variable
                };
                let mut names = Vec::new();
                for d in &v.declarations {
                    // `require` bindings are imports, not symbols.
                    if d.init.as_ref().is_some_and(|i| {
                        self.require_spec(i).is_some()
                            || matches!(unwrap_expr(i), Expression::StaticMemberExpression(m) if self.require_spec(&m.object).is_some())
                    }) {
                        continue;
                    }
                    match &d.id {
                        BindingPattern::BindingIdentifier(id) => {
                            let name = id.name.to_string();
                            match &d.init {
                                Some(init) => {
                                    // A `let` may be reassigned: only a `const` is a
                                    // builder or instance whose origin can be proven.
                                    if kind == SymbolKind::Const {
                                        self.record_trpc_binding(&name, init);
                                    }
                                    self.lower_value_symbol(&name, init, kind, d.span.start)
                                }
                                None => self.push_symbol(RawSymbol::empty(
                                    &name,
                                    kind,
                                    self.line_of(d.span.start),
                                )),
                            }
                            names.push(name);
                        }
                        // `export const { GET, POST } = handlers`: one symbol per bound name,
                        // each carrying the facts of the shared initializer.
                        pattern => {
                            if kind == SymbolKind::Const
                                && let (BindingPattern::ObjectPattern(o), Some(init)) =
                                    (pattern, &d.init)
                            {
                                self.record_trpc_destructuring(o, init);
                            }
                            let mut bound = Vec::new();
                            binding_names(pattern, &mut bound);
                            let mut template =
                                RawSymbol::empty("", kind, self.line_of(d.span.start));
                            if let Some(init) = &d.init {
                                let mut c = Collector::new(self);
                                c.visit_expression(init);
                                c.fill(&mut template);
                            }
                            // `export const { GET, POST } = handlers`, `{ handlers: { GET } } =
                            // auth`: each name derives from the member it is read from, so
                            // the resolver can reach the origin.
                            let mut keyed = Vec::new();
                            if let (BindingPattern::ObjectPattern(o), Some(init)) =
                                (pattern, &d.init)
                                && matches!(
                                    unwrap_expr(init),
                                    Expression::Identifier(_)
                                        | Expression::StaticMemberExpression(_)
                                )
                            {
                                destructured_keys(o, "", &mut keyed);
                            }
                            let source = d.init.as_ref().and_then(|i| match unwrap_expr(i) {
                                Expression::Identifier(_)
                                | Expression::StaticMemberExpression(_) => self.canon(i),
                                _ => None,
                            });
                            for name in bound {
                                let mut sym = template.clone();
                                sym.name = name.clone();
                                if let Some(src) = &source
                                    && let Some((_, path)) = keyed.iter().find(|(n, _)| *n == name)
                                    && src.member.matches('.').count() + path.matches('.').count()
                                        <= MAX_MEMBER_DEPTH
                                {
                                    let mut r = src.clone();
                                    r.member.push_str(path);
                                    sym.derives_from = Some(r);
                                }
                                self.push_symbol(sym);
                                names.push(name);
                            }
                        }
                    }
                }
                names
            }
            Declaration::TSNamespaceDeclaration(n) if !n.declare => {
                let name = n.id.name.to_string();
                self.push_symbol(RawSymbol::empty(
                    &name,
                    SymbolKind::Const,
                    self.line_of(n.span.start),
                ));
                vec![name]
            }
            Declaration::TSEnumDeclaration(e) => {
                let name = e.id.name.to_string();
                self.push_symbol(RawSymbol::empty(
                    &name,
                    SymbolKind::Const,
                    self.line_of(e.span.start),
                ));
                vec![name]
            }
            _ => vec![],
        }
    }

    /// Record a top-level `const` (or `export default`) value that is a tRPC instance
    /// or may be a procedure builder ([`RawTrpc`]).
    fn record_trpc_binding(&mut self, name: &str, init: &Expression) {
        if self.is_trpc_instance(init) {
            self.out.trpc.instances.push(name.to_string());
        } else if let Some(r) = self.builder_origin(init) {
            self.out.trpc.builders.push((name.to_string(), r));
        } else if let Some(returns) = match unwrap_expr(init) {
            Expression::ArrowFunctionExpression(a) => crate::types::plain_arrow_returns(a),
            Expression::FunctionExpression(f) => crate::types::plain_function_returns(f),
            _ => None,
        } {
            self.record_trpc_factory(name, returns);
        }
    }

    /// `const { procedure } = t`, `const { procedure: api } = t`: the bound name is
    /// `t.procedure`, a procedure builder when `t` is proven to be a tRPC instance. Only
    /// a plain `procedure` key bound to a plain name: a default (`{ procedure = p }`)
    /// may be anything, and a nested pattern is not the instance's.
    fn record_trpc_destructuring(&mut self, o: &ObjectPattern, init: &Expression) {
        let init = unwrap_expr(init);
        if !matches!(
            init,
            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
        ) {
            return;
        }
        // A global (`window.t`) has no origin to prove.
        let Some(instance) = self
            .canon(init)
            .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }))
        else {
            return;
        };
        for p in &o.properties {
            if p.computed
                || p.key
                    .static_name()
                    .and_then(|k| k.as_str().map(String::from))
                    != Some("procedure".into())
            {
                continue;
            }
            if let BindingPattern::BindingIdentifier(id) = &p.value {
                let mut r = instance.clone();
                r.member.push_str(".procedure");
                self.out.trpc.builders.push((id.name.to_string(), r));
            }
        }
    }

    /// Record a top-level function declaration that may return a procedure builder;
    /// one that is reassigned anywhere (`f = other`) may return anything.
    fn record_trpc_function(&mut self, name: &str, f: &Function) {
        if f.id
            .as_ref()
            .and_then(|id| id.symbol_id.get())
            .is_some_and(|s| self.scoping.symbol_is_mutated(s))
        {
            return;
        }
        if let Some(returns) = crate::types::plain_function_returns(f) {
            self.record_trpc_factory(name, returns);
        }
    }

    /// A function whose every returned value is a possible procedure builder
    /// ([`RawTrpc::factories`]); the linker proves each one.
    fn record_trpc_factory(&mut self, name: &str, returns: Vec<&Expression>) {
        let derives_from = match returns.as_slice() {
            [one] => self.derivation(one),
            _ => None,
        };
        if let Some(refs) = returns
            .into_iter()
            .map(|e| self.builder_origin(e))
            .collect::<Option<Vec<_>>>()
        {
            self.out.trpc.factories.push(RawFactory {
                name: name.to_string(),
                returns: refs,
                derives_from,
            });
        }
    }

    fn push_symbol(&mut self, s: RawSymbol) {
        self.out.symbols.push(s);
    }

    /// Arguments of a function in a `"use server"` file, or with that directive in its
    /// body, are a server action's client input.
    fn takes_client_args(&self, body: Option<&FunctionBody>) -> bool {
        self.out.directives.iter().any(|d| d == "use server")
            || body.is_some_and(|b| b.directives.iter().any(|d| d.directive == "use server"))
    }

    /// [`input::arrow_input`] with [`Self::takes_client_args`].
    fn arrow_input(&self, a: &ArrowFunctionExpression) -> input::InputUse {
        input::arrow_input(a, self.takes_client_args(a.get_function_body()))
    }

    /// [`input::function_input`] with [`Self::takes_client_args`].
    fn function_input(&self, f: &Function) -> input::InputUse {
        input::function_input(f, self.takes_client_args(f.body.as_deref()))
    }

    fn lower_function_symbol(&mut self, name: &str, f: &Function) {
        let mut sym = RawSymbol::empty(name, SymbolKind::Function, self.line_of(f.span.start));
        if f.return_type.is_some() {
            sym.controls.push("typed_return".into());
        }
        sym.is_async = f.r#async || returns_promise(f.return_type.as_deref());
        let mut c = Collector::new(self);
        if error_middleware(&f.params) {
            c.p.handles.insert(RawOperand::Text("*".into()));
        }
        c.visit_function(f, oxc_semantic::ScopeFlags::Function);
        let jsx = c.saw_jsx;
        let saw_input = c.saw_input;
        c.fill(&mut sym);
        if let Some(body) = &f.body {
            self.add_body_wraps(&mut sym, body);
        }
        if jsx && starts_upper(name) {
            sym.kind = SymbolKind::Component;
        }
        let status = self.function_input(f);
        record_input(&mut sym, saw_input, status);
        self.push_symbol(sym);
    }

    fn lower_class_symbol(&mut self, name: &str, class: &Class) {
        self.set_this_types(class);
        self.set_this_news(class);
        let mut sym = RawSymbol::empty(name, SymbolKind::Class, self.line_of(class.span.start));
        if class.r#abstract {
            sym.traits
                .push(drift_core::traits::DECLARED_ABSTRACT.to_string());
        }
        for d in &class.decorators {
            if let Some(r) = self.decorator_ref(d) {
                sym.wraps.push((r, WrapKind::Decorator));
            }
        }
        // Method decorators belong to the methods (NestJS handlers are entry-point
        // symbols of their own), not to the class.
        if let Some(h) = &class.heritage
            && let Some(r) = self.canon(&h.expression)
        {
            sym.wraps.push((r, WrapKind::Extends));
        }
        sym.wraps.sort();
        sym.wraps.dedup();
        // Field decorators say what the class is built for (GraphQL `@Field()`,
        // class-validator `@IsString()`, ORM `@Column()`).
        for e in &class.body.body {
            let decorators = match e {
                ClassElement::PropertyDefinition(p) => &p.decorators,
                ClassElement::AccessorProperty(p) => &p.decorators,
                _ => continue,
            };
            for d in decorators {
                if let Some(r) = self.decorator_ref(d)
                    && !sym.field_decorators.contains(&r)
                {
                    sym.field_decorators.push(r);
                }
            }
        }
        // Class decorators (and their arguments) are facts of the class. Decorators on
        // members (methods, properties, parameters) belong to those members: a NestJS
        // handler's `@Endpoint(new HistoryBuilder())` or `@Authenticated({ permission })`
        // is carried by its entry-point symbol, not rolled up to the controller.
        let mut c = Collector::new(self);
        for d in &class.decorators {
            c.visit_decorator(d);
        }
        c.skip_decorators = true;
        c.visit_class(class);
        c.fill(&mut sym);
        // What a method does with a value of the caller is the method's own
        // ([`RawMember::caller_args`], [`RawMember::unread`]).
        sym.caller_args.clear();
        sym.tags.clear();
        sym.param_flows = false;
        sym.listed_controls
            .retain(|c| c != drift_core::controls::RETURNS_CALLER);
        sym.handles_errors.extend(self.nest_catches(class));
        sym.decorator_args.extend(self.app_guards(class));
        for (at, unless_class) in self.app_guards_unread(name, class) {
            let guard = nest::RawGlobalGuard {
                guard: None,
                conditional: false,
                at,
                unless_class,
            };
            if !self.out.nest_global_guards.contains(&guard) {
                self.out.nest_global_guards.push(guard);
            }
        }
        sym.nest_metadata = self.nest_guard_metadata(class);
        sym.nest_metadata
            .extend(self.direct_metadata(&class.decorators));
        sym.members = self.class_members(name, class);
        self.push_symbol(sym);
        self.lower_nest_controller(name, class);
        self.lower_nest_configure(name, class);
        self.lower_nest_entries(class);
        self.this_types.borrow_mut().clear();
        self.this_plain.borrow_mut().clear();
        self.this_request.borrow_mut().clear();
        self.this_news.borrow_mut().clear();
    }

    /// Properties initialised with `new X(...)` (`private readonly logger = new
    /// Logger(Svc.name)`), for log calls through `this.logger` ([`Lowerer::this_news`]).
    fn set_this_news(&self, class: &Class) {
        let mut map = BTreeMap::new();
        for el in &class.body.body {
            if let ClassElement::PropertyDefinition(p) = el
                && let Some(k) = key_name(&p.key)
                && let Some(Expression::NewExpression(n)) = p.value.as_ref().map(unwrap_expr)
                && let Some(r) = self.canon(&n.callee)
            {
                map.insert(k, r);
            }
        }
        *self.this_news.borrow_mut() = map;
    }

    /// A call that configures a filter a data library adds to the queries it runs,
    /// below any one query ([`drift_core::controls::ORM_FILTER`]): Prisma
    /// `$extends` and `$use`; MikroORM `setFilterParams`, `addFilter` and the
    /// `@Filter` decorator; Kysely `withPlugin`; Mongoose query middleware
    /// (`schema.pre("find", ...)`, `post` too, on any receiver, whatever the file
    /// imports) and plugins; Sequelize scopes and find hooks (`addScope`, `addHook
    /// ("beforeFind", ...)`, `defaultScope`, `@DefaultScope`); TypeORM
    /// `@EventSubscriber`. And, as a family, any configuration object of a file
    /// that imports one of [`ORM_PACKAGES`] that registers code on the queries
    /// ([`Lowerer::orm_registration`]).
    fn orm_filter_call(&self, c: &CallExpression) -> bool {
        let import = |specs: &[&str], names: &[&str]| {
            matches!(self.canon_callee(&c.callee), Some(RawRef { base: RawBase::Import { spec, name }, member })
                if specs.iter().any(|p| spec == *p || spec.starts_with(&format!("{p}/")))
                    && member.is_empty() && names.contains(&name.as_str()))
        };
        if import(&["@mikro-orm"], &["Filter"])
            || import(&["typeorm"], &["EventSubscriber"])
            || import(&["sequelize-typescript"], &["DefaultScope", "Scopes"])
        {
            return true;
        }
        let first_text = || match c
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr)
        {
            Some(Expression::StringLiteral(l)) => Some(lit(l)),
            Some(Expression::RegExpLiteral(_)) => Some("find".to_string()),
            Some(Expression::ArrayExpression(_)) => Some("find".to_string()),
            _ => None,
        };
        let query_hook = |t: &str| {
            [
                "find",
                "count",
                "aggregate",
                "update",
                "delete",
                "distinct",
                "estimated",
            ]
            .iter()
            .any(|q| t.starts_with(q))
        };
        // A file that imports Mongoose, `@nestjs/mongoose` or Typegoose, if only
        // its types (`import type { Document } from "mongoose"`).
        let mongoose = || {
            self.out.imports.iter().any(|i| {
                ["mongoose", "@nestjs/mongoose", "@typegoose/typegoose"]
                    .iter()
                    .any(|p| i.spec == *p || i.spec.starts_with(&format!("{p}/")))
            })
        };
        let sequelize = || {
            self.out
                .imports
                .iter()
                .any(|i| i.spec == "sequelize" || i.spec == "sequelize-typescript")
        };
        match call_name(&c.callee) {
            Some("$extends" | "$use" | "setFilterParams" | "addFilter" | "withPlugin") => true,
            // Query middleware named by the query it runs on is Mongoose's, on a
            // schema of any name and wherever it is bound.
            Some("pre" | "post") if first_text().is_some_and(|t| query_hook(&t)) => true,
            Some("pre") if mongoose() => first_text().is_none_or(|t| query_hook(&t)),
            Some("plugin") if mongoose() => true,
            Some("addScope") if sequelize() => true,
            Some("addHook") if sequelize() => first_text().is_none_or(|t| t.starts_with("beforeFind")),
            Some("init" | "define") if sequelize() => c.arguments.iter().any(|a| {
                matches!(a.as_expression().map(unwrap_expr), Some(Expression::ObjectExpression(o))
                    if ["defaultScope", "scopes", "hooks"].iter().any(|k| routes::object_prop(o, k).is_some()))
            }),
            _ => false,
        }
    }

    /// An object written in a file that imports one of [`ORM_PACKAGES`] (its types
    /// only included) with a key that registers code a data library runs on the
    /// queries ([`ORM_REGISTRATION_KEYS`]: MikroORM `defineConfig({ filters })`,
    /// Kysely `new Kysely({ plugins })`, TypeORM `{ subscribers }`, Sequelize
    /// `{ hooks, defaultScope, scopes }`), wherever the object is written: as the
    /// argument of the library's call, bound to a name and exported, or returned
    /// by a `useFactory`. Which filter it adds and to which queries is not read
    /// ([`drift_core::controls::ORM_FILTER`]).
    fn orm_registration(&self, o: &ObjectExpression) -> bool {
        o.properties.iter().any(|p| {
            matches!(p, ObjectPropertyKind::ObjectProperty(p)
                if key_name(&p.key).is_some_and(|k| ORM_REGISTRATION_KEYS.contains(&k.as_str())))
        }) && self.out.imports.iter().any(|i| {
            ORM_PACKAGES
                .iter()
                .any(|p| i.spec == *p || i.spec.starts_with(&format!("{p}/")))
        })
    }

    /// Nest global guards a `@Module` registers: `providers: [{ provide: APP_GUARD,
    /// useClass: G }]` (or `useExisting`), as (`APP_GUARD`, G).
    fn app_guards(&self, class: &Class) -> Vec<(RawOperand, RawRef)> {
        let mut out = Vec::new();
        for d in &class.decorators {
            let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                continue;
            };
            if !matches!(self.canon_callee(&c.callee), Some(RawRef { base: RawBase::Import { spec, name }, member })
                if spec == "@nestjs/common" && name == "Module" && member.is_empty())
            {
                continue;
            }
            let Some(Expression::ObjectExpression(o)) = c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
            else {
                continue;
            };
            let Some(Expression::ArrayExpression(providers)) =
                routes::object_prop(o, "providers").map(unwrap_expr)
            else {
                continue;
            };
            for el in &providers.elements {
                let Some(Expression::ObjectExpression(p)) = el.as_expression().map(unwrap_expr)
                else {
                    continue;
                };
                let app_guard = routes::object_prop(p, "provide").is_some_and(|x| {
                    matches!(self.canon(x), Some(RawRef { base: RawBase::Import { spec, name }, member })
                        if spec == "@nestjs/core" && name == "APP_GUARD" && member.is_empty())
                });
                if !app_guard {
                    continue;
                }
                if let Some(g) = routes::object_prop(p, "useClass")
                    .or_else(|| routes::object_prop(p, "useExisting"))
                    .and_then(|x| self.canon(x))
                {
                    out.push((RawOperand::Text("APP_GUARD".into()), g));
                }
            }
        }
        out
    }

    /// The providers of a `@Module` that may be a Nest global guard and whose guard
    /// is not read ([`Lowerer::app_guards`] reads `useClass`/`useExisting` naming a
    /// class): an `APP_GUARD` provider given by `useFactory` or `useValue`, or by a
    /// class chosen by a condition (`useClass: process.env.X ? A : B`); a provider
    /// that is no object written in place and no class this file declares (a
    /// variable, whatever its name: `const AUTH_GUARD = { provide: APP_GUARD, ...
    /// }`; a call, `globalGuard()`; a spread; a member); and `providers` that is no
    /// list written in place. A provider bound elsewhere may be an `APP_GUARD`
    /// provider whatever this file imports, so none of these needs the file to
    /// import `APP_GUARD`. An imported binding comes with its reference: linking
    /// reads it as no guard where it names a class ([`nest::RawGlobalGuard::
    /// unless_class`]). Each is where it is written, for saying so; linking makes
    /// every route of the package unknown for it ([`drift_core::APP_UNREAD`]).
    fn app_guards_unread(&self, name: &str, class: &Class) -> Vec<(String, Option<RawRef>)> {
        let imports_app_guard = self
            .out
            .imports
            .iter()
            .any(|i| i.spec == "@nestjs/core" && i.names.iter().any(|n| n == "APP_GUARD"));
        let mut out = Vec::new();
        for d in &class.decorators {
            let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                continue;
            };
            if !matches!(self.canon_callee(&c.callee), Some(RawRef { base: RawBase::Import { spec, name }, member })
                if spec == "@nestjs/common" && name == "Module" && member.is_empty())
            {
                continue;
            }
            let Some(Expression::ObjectExpression(o)) = c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .map(unwrap_expr)
            else {
                continue;
            };
            let Some(providers) = routes::object_prop(o, "providers").map(unwrap_expr) else {
                continue;
            };
            let Expression::ArrayExpression(providers) = providers else {
                out.push((format!("the providers of {name}"), None));
                continue;
            };
            for el in &providers.elements {
                let Some(Expression::ObjectExpression(p)) = el.as_expression().map(unwrap_expr)
                else {
                    // `providers: [UsersService, guardProvider, ...shared]`.
                    let named = match el.as_expression().map(unwrap_expr) {
                        Some(e @ Expression::Identifier(_)) => self.canon(e),
                        _ => None,
                    };
                    match named {
                        // A class of this file.
                        Some(RawRef {
                            base: RawBase::Local(n),
                            ..
                        }) if self.top_classes.contains(&n) => {}
                        // Imported: a class or not, as linking finds it.
                        Some(
                            r @ RawRef {
                                base: RawBase::Import { .. },
                                ..
                            },
                        ) => out.push((format!("a provider of {name}"), Some(r))),
                        _ => out.push((format!("a provider of {name}"), None)),
                    }
                    continue;
                };
                let provide = routes::object_prop(p, "provide");
                let app_guard = provide.is_some_and(|x| {
                    matches!(self.canon(x), Some(RawRef { base: RawBase::Import { spec, name }, member })
                        if spec == "@nestjs/core" && name == "APP_GUARD" && member.is_empty())
                });
                // A `provide` that is not read may be `APP_GUARD` under another name.
                let unread_provide = imports_app_guard
                    && provide.is_some_and(|x| {
                        !matches!(unwrap_expr(x), Expression::StringLiteral(_))
                            && self.canon(x).is_none()
                    });
                if !app_guard && !unread_provide {
                    continue;
                }
                let read = routes::object_prop(p, "useClass")
                    .or_else(|| routes::object_prop(p, "useExisting"))
                    .is_some_and(|x| {
                        matches!(
                            unwrap_expr(x),
                            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                        ) && self.canon(x).is_some_and(|r| !r.member.contains('('))
                    });
                if !read || unread_provide {
                    out.push((format!("the APP_GUARD provider of {name}"), None));
                }
            }
        }
        out
    }

    /// Nest `@Catch(X, Y)` on an exception filter: the classes it handles, `*` for
    /// `@Catch()`.
    fn nest_catches(&self, class: &Class) -> Vec<RawOperand> {
        let mut out = Vec::new();
        for d in &class.decorators {
            let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                continue;
            };
            if !matches!(self.canon_callee(&c.callee), Some(RawRef { base: RawBase::Import { spec, name }, member })
                if spec == "@nestjs/common" && name == "Catch" && member.is_empty())
            {
                continue;
            }
            if c.arguments.is_empty() {
                out.push(RawOperand::Text("*".into()));
            }
            for a in &c.arguments {
                if let Some(r) = a.as_expression().and_then(|x| self.canon(x)) {
                    out.push(RawOperand::Ref(r));
                }
            }
        }
        out
    }

    /// Each method of `class` (and each property bound to a function) with what its
    /// own body calls and the risky operations in it ([`drift_core::Symbol::members`]).
    /// A call of a sibling method through `this` is recorded as the class's member
    /// (`Local(Class)` + `.method`).
    fn class_members(&self, class_name: &str, class: &Class) -> Vec<RawMember> {
        let bodies: Vec<(String, &FormalParameters, MemberBody, bool)> = class
            .body
            .body
            .iter()
            .filter_map(|el| match el {
                ClassElement::MethodDefinition(m) => {
                    let name = if m.kind.is_constructor() {
                        "constructor".to_string()
                    } else {
                        m.key.static_name()?.as_str()?.to_string()
                    };
                    let is_async =
                        m.value.r#async || returns_promise(m.value.return_type.as_deref());
                    Some((
                        name,
                        &*m.value.params,
                        MemberBody::Block(m.value.body.as_deref()?),
                        is_async,
                    ))
                }
                ClassElement::PropertyDefinition(p) => {
                    let name = p.key.static_name()?.as_str()?.to_string();
                    let value = p.value.as_ref()?;
                    let is_async = async_function(value, 0);
                    match unwrap_expr(value) {
                        Expression::ArrowFunctionExpression(f) => {
                            Some((name, &*f.params, MemberBody::Arrow(&f.body), is_async))
                        }
                        Expression::FunctionExpression(f) => Some((
                            name,
                            &*f.params,
                            MemberBody::Block(f.body.as_deref()?),
                            is_async,
                        )),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect();
        let names: BTreeSet<&str> = bodies.iter().map(|(n, _, _, _)| n.as_str()).collect();
        bodies
            .iter()
            .map(|(name, params, body, is_async)| {
                let mut c = Collector::new(self);
                c.skip_decorators = true;
                // The walk starts in the method's body: what is written there is
                // inside a function, and `this` is the instance.
                c.fn_depth = 1;
                c.this_methods = Some((
                    class_name.to_string(),
                    names.iter().map(|n| n.to_string()).collect(),
                ));
                // The method's own parameters, so a check on one reads `param:<name>`.
                c.note_params(params);
                let mut siblings = ThisCalls {
                    names: &names,
                    found: BTreeSet::new(),
                };
                match body {
                    MemberBody::Block(b) => {
                        c.visit_function_body(b);
                        siblings.visit_function_body(b);
                    }
                    MemberBody::Arrow(b) => {
                        c.visit_arrow_function_body(b);
                        siblings.visit_arrow_function_body(b);
                    }
                }
                let only_true = |e: &Expression| {
                    matches!(unwrap_expr(e), Expression::BooleanLiteral(b) if b.value)
                };
                let (returns_nonconstant_bool, returns_only_true) = match body {
                    MemberBody::Block(b) => {
                        let mut r = Returns { found: Vec::new() };
                        r.visit_function_body(b);
                        (
                            r.found.iter().any(|e| !constant_value(e)),
                            !r.found.is_empty() && r.found.iter().all(|e| only_true(e)),
                        )
                    }
                    MemberBody::Arrow(ArrowFunctionBody::FunctionBody(b)) => {
                        let mut r = Returns { found: Vec::new() };
                        r.visit_function_body(b);
                        (
                            r.found.iter().any(|e| !constant_value(e)),
                            !r.found.is_empty() && r.found.iter().all(|e| only_true(e)),
                        )
                    }
                    MemberBody::Arrow(b) => (
                        b.as_expression().is_some_and(|e| !constant_value(e)),
                        b.as_expression().is_some_and(only_true),
                    ),
                };
                let mut tmp = RawSymbol::empty(name, SymbolKind::Function, 0);
                c.fill(&mut tmp);
                let mut calls = tmp.calls;
                calls.extend(siblings.found.into_iter().map(|m| RawRef {
                    base: RawBase::Local(class_name.to_string()),
                    member: format!(".{m}"),
                }));
                calls.sort();
                calls.dedup();
                RawMember {
                    name: name.clone(),
                    calls,
                    sinks: tmp.sinks,
                    returns_nonconstant_bool,
                    returns_only_true,
                    body_checks: tmp.body_checks,
                    throws: tmp.throws,
                    conditional_calls: tmp.conditional_calls,
                    receiver_calls: tmp.receiver_calls,
                    order: tmp.order,
                    is_async: *is_async,
                    args: tmp.args,
                    unread: {
                        let mut unread: Vec<String> = tmp
                            .controls
                            .into_iter()
                            .filter(|c| c == drift_core::controls::SCOPE_UNREAD)
                            .chain(
                                (tmp.hands_on || !tmp.verifies.is_empty())
                                    .then(|| drift_core::MEMBER_HANDS_ON.to_string()),
                            )
                            .chain(
                                tmp.param_flows
                                    .then(|| drift_core::controls::PARAM_FLOWS.to_string()),
                            )
                            .collect();
                        unread.sort();
                        unread.dedup();
                        unread
                    },
                    caller_args: tmp.caller_args,
                    caller_keys: tmp.caller_keys,
                    arg_sides: tmp.arg_sides,
                    param_keys: tmp.param_keys,
                }
            })
            .collect()
    }

    /// The functions an object literal bound to a name holds (`export const guards = {
    /// async authenticate(request, reply) { ... }, optional: async () => { ... } }`),
    /// each as a symbol of its own, `<name>.<key>`: where one is used as a guard
    /// (`{ onRequest: guards.authenticate }`), that function is read, not what the
    /// object does as a whole. Listed for the practice map and `drift security` only
    /// ([`RawSymbol::in_place`]), never mined.
    fn lower_object_methods(&mut self, name: &str, o: &ObjectExpression) {
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else {
                continue;
            };
            let f = unwrap_expr(&p.value);
            let is_async = match f {
                Expression::ArrowFunctionExpression(a) => a.r#async,
                Expression::FunctionExpression(a) => a.r#async,
                _ => continue,
            };
            let Some(key) = key_name(&p.key).filter(|_| !p.computed) else {
                continue;
            };
            let member = format!("{name}.{key}");
            if self.out.symbols.iter().any(|s| s.name == member) {
                continue;
            }
            let mut sym =
                RawSymbol::empty(&member, SymbolKind::Function, self.line_of(f.span().start));
            sym.in_place = true;
            sym.is_async = is_async;
            self.handler_facts(Some(f), &mut sym);
            self.push_symbol(sym);
        }
    }

    fn decorator_ref(&self, d: &Decorator) -> Option<RawRef> {
        match unwrap_expr(&d.expression) {
            Expression::CallExpression(c) => self.canon_callee(&c.callee),
            e => self.canon(e),
        }
    }

    /// `const X = wrapA(wrapB(async (req) => { ... }), { opts })` and plain values.
    fn lower_value_symbol(&mut self, name: &str, init: &Expression, kind: SymbolKind, start: u32) {
        // tRPC: `export const getX = authenticatedProcedure.input(...).query(...)`.
        if let Some(p) = self.procedure_chain(init)
            && self.lower_trpc_procedure(name, p, start)
        {
            return;
        }
        if kind == SymbolKind::Const {
            self.note_route_options(name, init);
        }
        let mut sym = RawSymbol::empty(name, kind, self.line_of(start));
        sym.derives_from = self.derivation(init);
        // What the builder's middleware steps are given (`base.use(isAuthed)`), in
        // source order ([`drift_core::GuardCall::STEPS`]).
        if sym.derives_from.is_some() {
            let mut given: Vec<RawArg> = Vec::new();
            let mut cur = unwrap_expr(init);
            while let Expression::CallExpression(c) = cur {
                let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                    break;
                };
                if drift_core::builders::MIDDLEWARE_STEPS.contains(&m.property.name.as_str()) {
                    let mut step: Vec<RawArg> = c
                        .arguments
                        .iter()
                        .map(|a| match a {
                            Argument::SpreadElement(_) => RawArg::Spread,
                            other => other
                                .as_expression()
                                .map_or(RawArg::Unread, |x| self.arg_shape(x, 1)),
                        })
                        .collect();
                    if step.is_empty() {
                        step.push(RawArg::Unread);
                    }
                    step.extend(given);
                    given = step;
                }
                cur = unwrap_expr(&m.object);
            }
            if !given.is_empty() {
                sym.guard_calls.push(RawGuardCall {
                    callee: RawRef {
                        base: RawBase::Global(".use".to_string()),
                        member: String::new(),
                    },
                    args: vec![given],
                });
            }
        }
        sym.is_async = async_function(init, 0);
        // The call the value is bound to, when it is one (not a builder chain on a
        // binding): what it returns is the value ([`RawSymbol::made_by`]).
        let made_by = match unwrap_expr(init) {
            Expression::CallExpression(c) if sym.derives_from.is_none() => self
                .canon_callee(&c.callee)
                .filter(|r| !matches!(r.base, RawBase::Global(_)) && !r.member.contains('(')),
            _ => None,
        };
        let mut cur = unwrap_expr(init);
        let mut collector = Collector::new(self);
        // Peel wrapper calls, outermost first. Wrapper callees are recorded as wraps, not calls.
        while let Expression::CallExpression(call) = cur {
            // A schema library's chain is a schema, whatever callbacks its steps take
            // (`z.object({...}).refine((v) => ...)`, `.transform(fn)`, `z.lazy(() => s)`):
            // a value, not a function wrapped in calls.
            if self.schema_built(cur) {
                break;
            }
            let Some(wrapper) = self.canon_callee(&call.callee) else {
                // A wrapper with no name around a function (`wrappers[kind](async
                // () => ...)`, `(flag ? withAuth : plain)(handler)`): what runs
                // before the function is not read.
                if call.arguments.iter().enumerate().any(|(i, a)| {
                    a.as_expression()
                        .is_some_and(|e| self.wraps_function(unwrap_expr(e), i == 0, 0))
                }) && !matches!(
                    unwrap_expr(&call.callee),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) {
                    sym.app_unread
                        .push("a wrapper that is not read where it is called".to_string());
                }
                break;
            };
            // A wrapper (HOF) is a call with an argument that ultimately wraps a function.
            let inner = call.arguments.iter().enumerate().find_map(|(i, a)| {
                let e = unwrap_expr(a.as_expression()?);
                self.wraps_function(e, i == 0, 0).then_some(e)
            });
            let Some(inner) = inner else {
                // Given a call with no name around a function (`withLogging((flag ?
                // withAuth : plain)(handler))`): what that call runs is not read.
                if call.arguments.iter().any(|a| {
                    matches!(a.as_expression().map(unwrap_expr),
                    Some(Expression::CallExpression(c))
                        if self.canon_callee(&c.callee).is_none()
                            && !matches!(unwrap_expr(&c.callee),
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_))
                            && c.arguments.iter().enumerate().any(|(i, x)| {
                                x.as_expression().is_some_and(|e| {
                                    self.wraps_function(unwrap_expr(e), i == 0, 0)
                                })
                            }))
                }) {
                    sym.app_unread
                        .push("a wrapper that is not read where it is called".to_string());
                }
                break;
            };
            // next-safe-action `client.schema(S).action(fn)`: the wrapper says what the
            // input is validated into.
            collector.note_input(call);
            sym.wraps.push((wrapper.clone(), WrapKind::Call));
            for (i, a) in call.arguments.iter().enumerate() {
                let Some(ae) = a.as_expression() else {
                    continue;
                };
                let ae = unwrap_expr(ae);
                if std::ptr::eq(ae, inner) {
                    continue;
                }
                collector.object_keys(&wrapper, i, ae);
                collector.visit_expression(ae);
            }
            cur = inner;
        }
        // `cur` is now the wrapped value (function, identifier, literal, ...). A function
        // inside a wrapper call whose one parameter is an object pattern
        // (`client.action(async ({ ctx, parsedInput }) => ...)`) is called by the wrapper
        // with an object of its own: in a `"use server"` file the action is what the
        // wrapper returns, and the keys tell what the function reads (`({ ctx })` reads
        // no input). Any other shape (`withAuth(async (session, payload) => ...)`,
        // `withAuth(async (postId) => ...)`) may be handed the client's arguments.
        let wrapped = !sym.wraps.is_empty();
        let mut status = input::InputUse::Unknown;
        match cur {
            Expression::ArrowFunctionExpression(a) => {
                status = if wrapped && input::takes_one_object(&a.params) {
                    input::arrow_input(a, false)
                } else {
                    self.arrow_input(a)
                };
                sym.kind = SymbolKind::Function;
                if a.return_type.is_some() {
                    sym.controls.push("typed_return".into());
                }
                if error_middleware(&a.params) {
                    collector.p.handles.insert(RawOperand::Text("*".into()));
                }
                collector.visit_arrow_function_expression(a);
                if a.is_expression()
                    && let Some(e) = a.get_expression()
                    && matches!(
                        unwrap_expr(e),
                        Expression::JSXElement(_) | Expression::JSXFragment(_)
                    )
                {
                    collector.controls.insert("return_jsx".into());
                }
                if let Some(b) = a.get_function_body() {
                    self.add_body_wraps(&mut sym, b);
                } else if let Some(e) = a.get_expression() {
                    // A concise body `=> (<Layout>...)` is the root JSX itself.
                    self.add_root_jsx_wrap(&mut sym, e);
                    self.add_returned_wrappers(&mut sym, e);
                }
            }
            Expression::FunctionExpression(f) => {
                status = if wrapped && input::takes_one_object(&f.params) {
                    input::function_input(f, false)
                } else {
                    self.function_input(f)
                };
                sym.kind = SymbolKind::Function;
                if error_middleware(&f.params) {
                    collector.p.handles.insert(RawOperand::Text("*".into()));
                }
                collector.visit_function(f, oxc_semantic::ScopeFlags::Function);
                if let Some(b) = &f.body {
                    self.add_body_wraps(&mut sym, b);
                }
            }
            Expression::ClassExpression(c) => {
                sym.kind = SymbolKind::Class;
                collector.visit_class(c);
            }
            Expression::Identifier(id) if !sym.wraps.is_empty() => {
                // `withAuth(Handler)`: the wrapped value lives elsewhere; record the reference.
                if let Some(base) = self.resolve_ident(id) {
                    collector.calls.insert(RawRef {
                        base,
                        member: "(ref)".into(),
                    });
                }
            }
            Expression::ObjectExpression(o) => {
                // `export default { list, get: getItem }`, `export const ctrl = { create }`:
                // an object of handlers a route may refer to as `ctrl.create`. Record what
                // each property refers to, as a reference.
                for p in &o.properties {
                    let ObjectPropertyKind::ObjectProperty(p) = p else {
                        continue;
                    };
                    if p.computed
                        || !matches!(
                            unwrap_expr(&p.value),
                            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                        )
                    {
                        continue;
                    }
                    if let Some(mut r) = self.canon(&p.value)
                        && !matches!(r.base, RawBase::Global(_))
                    {
                        r.member.push_str("(ref)");
                        collector.calls.insert(r);
                    }
                }
                collector.visit_expression(cur);
            }
            Expression::ArrayExpression(a) => {
                // `const apiGuards = [express.json(), requireAuth]`, given to a route
                // or a mount as `...apiGuards`: a list of handlers. Record what each
                // element refers to, as a reference.
                for el in &a.elements {
                    let e = match el {
                        ArrayExpressionElement::SpreadElement(s) => Some(&s.argument),
                        other => other.as_expression(),
                    };
                    let Some(e) = e else { continue };
                    if !matches!(
                        unwrap_expr(e),
                        Expression::Identifier(_) | Expression::StaticMemberExpression(_)
                    ) {
                        continue;
                    }
                    if let Some(mut r) = self.canon(e)
                        && !matches!(r.base, RawBase::Global(_))
                    {
                        r.member.push_str("(ref)");
                        collector.calls.insert(r);
                    }
                }
                collector.visit_expression(cur);
            }
            other => collector.visit_expression(other),
        }
        let jsx = collector.saw_jsx;
        let saw_input = collector.saw_input;
        collector.fill(&mut sym);
        if jsx && starts_upper(name) && sym.kind == SymbolKind::Function {
            sym.kind = SymbolKind::Component;
        }
        record_input(&mut sym, saw_input, status);
        // A value the lowering already reads as a function or class is not a product.
        // Nor is a PascalCase one (`export const SearchIcon = createIcon(...)`): what
        // a factory makes under such a name may be a component or a class, which a
        // returned function does not tell apart, so it stays a value. An upper-case
        // name (`export const GET = withAuth(handler)`) is a route's handler name.
        let pascal = starts_upper(name) && name.chars().any(|c| c.is_ascii_lowercase());
        if matches!(sym.kind, SymbolKind::Const | SymbolKind::Variable) && !pascal {
            sym.made_by = made_by;
        }
        // An array a binding holds, with something in it that is no literal: handed
        // where a guard goes, each element runs ([`drift_core::GuardCall::LIST`]).
        if matches!(sym.kind, SymbolKind::Const | SymbolKind::Variable)
            && let Expression::ArrayExpression(a) = unwrap_expr(init)
            && !a.elements.is_empty()
            && a.elements.len() <= drift_core::GuardCall::MAX_ITEMS
        {
            let elements: Vec<RawArg> = a
                .elements
                .iter()
                .map(|el| match el {
                    ArrayExpressionElement::SpreadElement(_) => RawArg::Spread,
                    other => other
                        .as_expression()
                        .map_or(RawArg::Unread, |x| self.arg_shape(x, 1)),
                })
                .collect();
            if elements.iter().any(|e| {
                matches!(
                    e,
                    RawArg::Ref(_) | RawArg::Call(_) | RawArg::Function | RawArg::Spread
                )
            }) {
                sym.guard_calls.push(RawGuardCall {
                    callee: RawRef {
                        base: RawBase::Global("[]".to_string()),
                        member: String::new(),
                    },
                    args: vec![elements],
                });
            }
        }
        // An object a binding holds that names a Fastify hook: given as a route's
        // options, what it holds under the hooks runs
        // ([`drift_core::GuardCall::OPTIONS`]).
        if matches!(sym.kind, SymbolKind::Const | SymbolKind::Variable)
            && let Expression::ObjectExpression(o) = unwrap_expr(init)
            && routes::FASTIFY_HOOKS
                .iter()
                .any(|hook| routes::object_prop(o, hook).is_some())
        {
            sym.guard_calls.push(RawGuardCall {
                callee: RawRef {
                    base: RawBase::Global("{}".to_string()),
                    member: String::new(),
                },
                args: vec![vec![self.arg_shape(init, 0)]],
            });
        }
        // What builds a plain value: a schema library, or literals and built-ins only.
        // (`Object.keys(tools)` is read as a wrapper of `tools` above; it is plain data.)
        if matches!(sym.kind, SymbolKind::Const | SymbolKind::Variable) {
            if self.schema_built(init) {
                sym.traits
                    .push(drift_core::traits::SCHEMA_VALUE.to_string());
                self.schema_values.insert(name.to_string());
            } else if self.plain_value(init, 0) {
                sym.traits.push(drift_core::traits::PLAIN_VALUE.to_string());
                self.plain_values.insert(name.to_string());
            }
            sym.traits.sort();
        }
        // An object one of whose functions turns callers away: each function is read
        // for itself where it is used (`{ onRequest: guards.authenticate }`).
        let rejects = sym.listed_controls.len()
            + sym
                .controls
                .iter()
                .filter(|c| *c == drift_core::controls::REJECTS_CALLER)
                .count()
            + sym
                .body_checks
                .iter()
                .filter(|c| {
                    matches!(
                        c.outcome,
                        drift_core::CheckOutcome::Unauthenticated
                            | drift_core::CheckOutcome::SignInRedirect
                    )
                })
                .count();
        let plain = matches!(sym.kind, SymbolKind::Const | SymbolKind::Variable);
        self.push_symbol(sym);
        if let Expression::ObjectExpression(o) = cur
            && plain
            && rejects > 0
        {
            self.lower_object_methods(name, o);
        }
    }

    /// The binding `init` is built from by builder steps that only add to it
    /// ([`drift_core::builders::ADDITIVE_STEPS`]), with those steps, in source order, as
    /// the member path: `authedProcedure.input(s).use(mw)` -> `authedProcedure` +
    /// `.input().use()`. A plain binding (`base`, `t.procedure`) is an alias of it. `None`
    /// for anything else: a factory call, another method, a global, a literal.
    fn derivation(&self, init: &Expression) -> Option<RawRef> {
        let mut steps: Vec<&str> = Vec::new();
        let mut cur = unwrap_expr(init);
        while let Expression::CallExpression(c) = cur {
            let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                return None;
            };
            let step = m.property.name.as_str();
            if !drift_core::builders::ADDITIVE_STEPS.contains(&step) {
                return None;
            }
            steps.push(step);
            cur = unwrap_expr(&m.object);
        }
        if !matches!(
            cur,
            Expression::Identifier(_) | Expression::StaticMemberExpression(_)
        ) {
            return None;
        }
        let mut r = self.canon(cur)?;
        // A binding reached through a call (`initTRPC.create().procedure`) is built by
        // that call, not bound to a name.
        if matches!(r.base, RawBase::Global(_)) || r.member.contains('(') {
            return None;
        }
        for step in steps.iter().rev() {
            r.member.push('.');
            r.member.push_str(step);
            r.member.push_str("()");
        }
        Some(r)
    }

    /// True when `e` is a function, a reference to a top-level function-like
    /// binding (first argument only), or a call that itself wraps one.
    fn wraps_function(&self, e: &Expression, first_arg: bool, depth: usize) -> bool {
        if depth > 8 {
            return false;
        }
        match unwrap_expr(e) {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
            Expression::Identifier(id) => {
                first_arg
                    && matches!(
                        self.resolve_ident(id),
                        Some(RawBase::Local(_) | RawBase::Import { .. })
                    )
            }
            Expression::CallExpression(c) => {
                self.canon_callee(&c.callee).is_some()
                    && !self.schema_built(e)
                    && c.arguments.iter().enumerate().any(|(i, a)| {
                        a.as_expression()
                            .is_some_and(|x| self.wraps_function(x, i == 0, depth + 1))
                    })
            }
            _ => false,
        }
    }

    /// Body-level wraps: a body that is a single `try`, and a component whose root JSX is a component.
    fn add_body_wraps(&self, sym: &mut RawSymbol, body: &FunctionBody) {
        let stmts: Vec<&Statement> = body.statements.iter().collect();
        if stmts.len() == 1 && matches!(stmts[0], Statement::TryStatement(_)) {
            sym.wraps.push((
                RawRef {
                    base: RawBase::Global(String::new()),
                    member: String::new(),
                },
                WrapKind::Try,
            ));
        }
        // `return <Layout>...` (a concise arrow body is handled by the caller).
        if let Some(Statement::ReturnStatement(r)) = stmts.last()
            && let Some(arg) = &r.argument
        {
            self.add_root_jsx_wrap(sym, arg);
            self.add_returned_wrappers(sym, arg);
        }
    }

    /// The function returns a function wrapped in calls (`return createTransformer((f) =>
    /// ...)`): those wrappers, outermost first, peeled as [`Self::lower_value_symbol`]
    /// peels a value's ([`drift_core::Symbol::returns_wrapped_by`]). Nothing when the
    /// returned value is not a wrapped function.
    fn add_returned_wrappers(&self, sym: &mut RawSymbol, returned: &Expression) {
        let mut cur = unwrap_expr(returned);
        let mut found = Vec::new();
        while let Expression::CallExpression(call) = cur {
            let Some(wrapper) = self.canon_callee(&call.callee) else {
                break;
            };
            let inner = call.arguments.iter().enumerate().find_map(|(i, a)| {
                let e = unwrap_expr(a.as_expression()?);
                self.wraps_function(e, i == 0, 0).then_some(e)
            });
            let Some(inner) = inner else { break };
            found.push(wrapper);
            cur = inner;
        }
        sym.returns_wrapped_by = found;
    }

    /// A component whose root JSX (the returned expression, or a concise arrow body
    /// `=> (<Layout>...)`) is a component is wrapped by it.
    fn add_root_jsx_wrap(&self, sym: &mut RawSymbol, root: &Expression) {
        if let Expression::JSXElement(el) = unwrap_expr(root)
            && let Some(rr) = self.canon_jsx(&el.opening_element.name)
        {
            sym.wraps.push((rr, WrapKind::Jsx));
        }
    }
}

/// All identifiers bound by a destructuring pattern, in source order.
/// The names an object pattern binds, each with the member path it reads
/// (`{ handlers: { GET: get } }` -> (`get`, `.handlers.GET`)).
fn destructured_keys(o: &ObjectPattern, prefix: &str, out: &mut Vec<(String, String)>) {
    for p in &o.properties {
        if p.computed {
            continue;
        }
        let Some(k) = key_name(&p.key) else { continue };
        let path = format!("{prefix}.{k}");
        let value = match &p.value {
            BindingPattern::AssignmentPattern(a) => &a.left,
            v => v,
        };
        match value {
            BindingPattern::BindingIdentifier(b) => out.push((b.name.to_string(), path)),
            BindingPattern::ObjectPattern(inner) => destructured_keys(inner, &path, out),
            _ => {}
        }
    }
}

fn binding_names(p: &BindingPattern, out: &mut Vec<String>) {
    match p {
        BindingPattern::BindingIdentifier(id) => out.push(id.name.to_string()),
        BindingPattern::ObjectPattern(o) => {
            for prop in &o.properties {
                binding_names(&prop.value, out);
            }
            if let Some(r) = &o.rest {
                binding_names(&r.argument, out);
            }
        }
        BindingPattern::ArrayPattern(a) => {
            for e in a.elements.iter().flatten() {
                binding_names(e, out);
            }
            if let Some(r) = &a.rest {
                binding_names(&r.argument, out);
            }
        }
        BindingPattern::AssignmentPattern(a) => binding_names(&a.left, out),
    }
}

const EXPRESS_METHODS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "options", "head", "all",
];

impl Lowerer<'_> {
    /// A value a schema library builds: a call chain from an import of one of
    /// [`SCHEMA_PACKAGES`] (`z.object({...}).refine(fn)`, `yup.string()`), or from a
    /// top-level binding of this file that is one (`Base.extend({...})`), with no step
    /// that makes a function of it (`z.function().implement(fn)`).
    fn schema_built(&self, e: &Expression) -> bool {
        let Some((id, function_step)) = chain_root(e) else {
            return false;
        };
        if function_step {
            return false;
        }
        match self.resolve_ident(id) {
            Some(RawBase::Import { spec, .. }) => {
                crate::resolve::bare_package(&spec).is_some_and(|p| SCHEMA_PACKAGES.contains(&p))
            }
            Some(RawBase::Local(name)) => self.schema_values.contains(&name),
            _ => false,
        }
    }

    /// A value built from literals and built-ins only, at its root: an object, array,
    /// string, number, template or other literal, or a built-in call of plain data
    /// ([`PLAIN_BUILTINS`]; `Object.freeze(x)` as `x`). No library's or the repo's code
    /// makes it.
    fn plain_value(&self, e: &Expression, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        let builtin = |callee: &Expression| -> Option<(String, String)> {
            let r = self.canon_callee(callee)?;
            match r.base {
                RawBase::Global(g) => Some((g, r.member)),
                _ => None,
            }
        };
        match unwrap_expr(e) {
            Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::TemplateLiteral(_) => true,
            Expression::UnaryExpression(u) => self.plain_value(&u.argument, depth + 1),
            Expression::CallExpression(c) => match builtin(&c.callee) {
                Some((g, m)) if g == "Object" && m == ".freeze" => c
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .is_some_and(|a| self.plain_value(a, depth + 1)),
                Some((g, m)) => PLAIN_BUILTINS.iter().any(|(pg, pm)| *pg == g && *pm == m),
                None => false,
            },
            Expression::NewExpression(n) => builtin(&n.callee).is_some_and(|(g, m)| {
                m.is_empty()
                    && PLAIN_BUILTINS
                        .iter()
                        .any(|(pg, pm)| *pg == g && pm.is_empty())
            }),
            _ => false,
        }
    }

    /// `module.exports = ...`, `module.exports.x = ...`, `exports.x = ...`.
    fn lower_cjs_export(&mut self, e: &Expression) -> bool {
        let Expression::AssignmentExpression(a) = unwrap_expr(e) else {
            return false;
        };
        let AssignmentTarget::StaticMemberExpression(m) = &a.left else {
            return false;
        };
        let prop = m.property.name.as_str();
        let whole = prop == "exports" && self.is_global(&m.object, "module");
        let named = match unwrap_expr(&m.object) {
            _ if whole => None,
            Expression::StaticMemberExpression(inner)
                if inner.property.name == "exports" && self.is_global(&inner.object, "module") =>
            {
                Some(prop.to_string())
            }
            obj if self.is_global(obj, "exports") => Some(prop.to_string()),
            _ => return false,
        };
        if !whole && named.is_none() {
            return false;
        }
        let start = a.span.start;
        match named {
            Some(name) => self.cjs_export_value(&name, &a.right, start),
            None => match unwrap_expr(&a.right) {
                Expression::ObjectExpression(o) => {
                    for p in &o.properties {
                        let ObjectPropertyKind::ObjectProperty(p) = p else {
                            continue;
                        };
                        if p.computed {
                            continue;
                        }
                        if let Some(k) = p.key.static_name()
                            && let Some(k) = k.as_str()
                        {
                            let k = k.to_string();
                            self.cjs_export_value(&k, &p.value, p.span.start);
                        }
                    }
                }
                right => self.cjs_export_value("default", right, start),
            },
        }
        true
    }

    fn cjs_export_value(&mut self, name: &str, value: &Expression, start: u32) {
        if let Some(spec) = self.require_spec(value) {
            // `module.exports.x = require("./x")` re-exports that module.
            self.out.exports.push(RawExport {
                name: name.to_string(),
                target: RawExportTarget::From {
                    spec,
                    name: "default".into(),
                },
            });
            return;
        }
        let target = match unwrap_expr(value) {
            Expression::Identifier(id) => self.export_target_for_local(id.name.as_str()),
            v => {
                self.lower_value_symbol(name, v, SymbolKind::Const, start);
                RawExportTarget::Local(name.to_string())
            }
        };
        self.out.exports.push(RawExport {
            name: name.to_string(),
            target,
        });
    }
}

/// Collects every `require("literal")` and `import("literal")` specifier in a file,
/// with when it loads (the earliest when a file loads it several ways), and the calls
/// that may be lazy-load helper calls.
struct LoadFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    specs: BTreeMap<String, ImportLoad>,
    /// Functions entered: a `require()` inside one runs when it is called. A function
    /// called in place (`(() => require("x"))()`) runs where it stands and adds none.
    depth: u32,
    /// Start of the function expression the call being visited calls in place.
    in_place: Option<u32>,
    calls: BTreeSet<RawLoaderCall>,
}

impl LoadFinder<'_, '_> {
    fn add(&mut self, spec: String, load: ImportLoad) {
        let e = self.specs.entry(spec).or_insert(load);
        *e = e.earliest(load);
    }
}

impl<'a> Visit<'a> for LoadFinder<'_, '_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        let step = u32::from(self.in_place.take() != Some(it.span.start));
        self.depth += step;
        walk::walk_function(self, it, flags);
        self.depth -= step;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let step = u32::from(self.in_place.take() != Some(it.span.start));
        self.depth += step;
        walk::walk_arrow_function_expression(self, it);
        self.depth -= step;
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        // `import("./x")`: a literal dynamic import is still a dependency. At module
        // scope (`await import("x")`) it runs when the module loads.
        if let Expression::StringLiteral(l) = unwrap_expr(&it.source) {
            let load = if self.depth == 0 {
                ImportLoad::Static
            } else {
                ImportLoad::Dynamic
            };
            self.add(lit(l), load);
        }
        walk::walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // An immediately invoked function runs where the call stands.
        self.in_place = match unwrap_expr(&it.callee) {
            Expression::ArrowFunctionExpression(f) => Some(f.span.start),
            Expression::FunctionExpression(f) => Some(f.span.start),
            _ => None,
        };
        if let Some(spec) = self.l.require_spec_call(it) {
            let load = if self.depth == 0 {
                ImportLoad::Static
            } else {
                ImportLoad::Require
            };
            self.add(spec, load);
        } else if let Expression::Identifier(id) = unwrap_expr(&it.callee)
            && let Some(base @ (RawBase::Import { .. } | RawBase::Local(_))) =
                self.l.resolve_ident(id)
        {
            let args: Vec<(u32, String)> = it
                .arguments
                .iter()
                .enumerate()
                .filter_map(|(i, a)| match a.as_expression().map(unwrap_expr) {
                    Some(Expression::StringLiteral(l)) if module_like(&lit(l)) => {
                        Some((u32::try_from(i).ok()?, lit(l)))
                    }
                    _ => None,
                })
                .collect();
            if !args.is_empty() {
                self.calls.insert(RawLoaderCall {
                    callee: RawRef {
                        base,
                        member: String::new(),
                    },
                    args,
                    eager: self.depth == 0,
                });
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// The value imports the program's re-exports make, one per statement, with the
/// names taken from the source module (`*` for `export *` and `export * as ns`).
/// A type-only statement (`export type { T } from "s"`) is no import, and a
/// statement whose specifiers are all type-only (`export { type T } from "s"`) is
/// none either: TypeScript elides both. `export {} from "s"` still loads "s".
fn reexport_imports(program: &Program) -> Vec<RawImport> {
    let import = |spec: String, names: Vec<String>| RawImport {
        spec,
        names,
        type_only: false,
        load: ImportLoad::Static,
        reexport: true,
    };
    program
        .body
        .iter()
        .filter_map(|stmt| match stmt {
            Statement::ExportFromDeclaration(e) if !e.export_kind.is_type() => {
                let mut names: Vec<String> = e
                    .specifiers
                    .iter()
                    .filter(|s| !s.export_kind.is_type())
                    .map(|s| module_export_name(&s.local))
                    .collect();
                if names.is_empty() && !e.specifiers.is_empty() {
                    return None;
                }
                names.sort();
                names.dedup();
                Some(import(lit(&e.source), names))
            }
            Statement::ExportAllDeclaration(e) if !e.export_kind.is_type() => {
                Some(import(lit(&e.source), vec!["*".into()]))
            }
            _ => None,
        })
        .collect()
}

/// A string that can be a module specifier: relative or absolute (`./x`, `/x`), or
/// an npm package name (lowercase, optionally scoped) with an optional subpath.
fn module_like(s: &str) -> bool {
    if s.is_empty() || s.len() > 214 || s.bytes().any(|b| b.is_ascii_whitespace()) {
        return false;
    }
    if s.starts_with('.') || s.starts_with('/') {
        return true;
    }
    let name_ok = |n: &str| {
        !n.is_empty()
            && n.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-._~".contains(&b))
    };
    let mut parts = s.splitn(3, '/');
    let first = parts.next().unwrap_or_default();
    match first.strip_prefix('@') {
        Some(scope) => name_ok(scope) && parts.next().is_some_and(name_ok),
        None => name_ok(first),
    }
}

/// Finds which of a function's parameters its body loads as a module.
struct ParamLoads<'l, 's> {
    l: &'l Lowerer<'s>,
    params: BTreeMap<oxc_semantic::SymbolId, u32>,
    found: BTreeSet<u32>,
}

impl ParamLoads<'_, '_> {
    fn param(&self, e: &Expression) -> Option<u32> {
        let Expression::Identifier(id) = unwrap_expr(e) else {
            return None;
        };
        let sym = id
            .reference_id
            .get()
            .and_then(|r| self.l.scoping.get_reference(r).symbol_id())?;
        self.params.get(&sym).copied()
    }
}

impl<'a> Visit<'a> for ParamLoads<'_, '_> {
    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        if let Some(i) = self.param(&it.source) {
            self.found.insert(i);
        }
        walk::walk_import_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // `require(name)` or `createRequire(import.meta.url)(name)`.
        let loads = match unwrap_expr(&it.callee) {
            Expression::Identifier(id) => {
                id.name == "require" && matches!(self.l.resolve_ident(id), Some(RawBase::Global(_)))
            }
            Expression::CallExpression(c) => matches!(
                unwrap_expr(&c.callee),
                Expression::Identifier(id) if id.name == "createRequire"
            ),
            _ => false,
        };
        if loads
            && let [arg] = it.arguments.as_slice()
            && let Some(i) = arg.as_expression().and_then(|e| self.param(e))
        {
            self.found.insert(i);
        }
        walk::walk_call_expression(self, it);
    }
}

impl RawSymbol {
    fn empty(name: &str, kind: SymbolKind, line: u32) -> Self {
        Self {
            name: name.to_string(),
            kind,
            line,
            wraps: vec![],
            calls: vec![],
            renders: vec![],
            args: vec![],
            controls: vec![],
            string_literals: 0,
            suppressions: vec![],
            reads: vec![],
            throws: vec![],
            after_continuation: vec![],
            sinks: vec![],
            order: vec![],
            returns_calls: vec![],
            refusal_builder: None,
            returns_builder: Vec::new(),
            other_rejection: false,
            builder_checks: vec![],
            unread_exits: vec![],
            field_decorators: vec![],
            traits: vec![],
            derives_from: None,
            returns_wrapped_by: vec![],
            made_by: None,
            members: vec![],
            server_reads: vec![],
            body_checks: vec![],
            responses: vec![],
            log_calls: vec![],
            catches: vec![],
            headers: vec![],
            inputs: vec![],
            handles_errors: vec![],
            env_calls: vec![],
            decorator_args: vec![],
            param_calls: vec![],
            typed_param_calls: vec![],
            conditional_calls: vec![],
            receiver_calls: vec![],
            is_async: false,
            app_middleware: vec![],
            app_unread: vec![],
            app_passed: vec![],
            in_place: false,
            listed_controls: vec![],
            nest_metadata: vec![],
            measured_args: vec![],
            result_uses: vec![],
            rejection_goes_on: false,
            listed_unwraps: vec![],
            guard_calls: vec![],
            hands_on: false,
            returns_function: false,
            caught: vec![],
            given_credential: vec![],
            caught_params: vec![],
            verifies: vec![],
            caller_args: vec![],
            caller_keys: vec![],
            fed_sinks: vec![],
            param_passes: vec![],
            refuses_without: vec![],
            arg_sides: vec![],
            param_keys: vec![],
            made_fed_sinks: vec![],
            made_passes: vec![],
            param_flows: false,
            tags: vec![],
        }
    }
}

/// Names that are request input wherever a symbol reads them, from any object or as a
/// destructured key: tRPC's `input`, next-safe-action's `parsedInput`, route `params`
/// and `searchParams`.
const INPUT_NAMES: &[&str] = &["input", "parsedInput", "rawInput", "params", "searchParams"];

/// A class member's body: a method's, or an arrow function property's.
#[derive(Clone, Copy)]
enum MemberBody<'b, 'a> {
    Block(&'b FunctionBody<'a>),
    Arrow(&'b ArrowFunctionBody<'a>),
}

/// Calls of sibling methods through `this` (`this.upload(...)`) in one method's body.
struct ThisCalls<'n> {
    names: &'n BTreeSet<&'n str>,
    found: BTreeSet<String>,
}

impl<'a> Visit<'a> for ThisCalls<'_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(unwrap_expr(&m.object), Expression::ThisExpression(_))
            && self.names.contains(m.property.name.as_str())
        {
            self.found.insert(m.property.name.to_string());
        }
        walk::walk_call_expression(self, it);
    }

    // A nested class or function has a `this` of its own.
    fn visit_class(&mut self, _: &Class<'a>) {}
    fn visit_function(&mut self, _: &Function<'a>, _: oxc_semantic::ScopeFlags) {}
}

/// Walks a symbol's body collecting calls, rendered components, argument keys and control facts.
struct Collector<'l, 's> {
    l: &'l Lowerer<'s>,
    calls: BTreeSet<RawRef>,
    renders: BTreeSet<RawRef>,
    args: BTreeSet<(RawRef, u32, String)>,
    controls: BTreeSet<String>,
    strings: u32,
    saw_jsx: bool,
    reads: BTreeSet<String>,
    throws: BTreeSet<RawRef>,
    sinks: BTreeSet<String>,
    /// [`RawSymbol::caller_keys`].
    caller_keys: BTreeSet<(RawRef, String)>,
    /// [`RawSymbol::fed_sinks`].
    fed_sinks: BTreeSet<String>,
    /// [`RawSymbol::param_passes`].
    param_passes: BTreeSet<RawRef>,
    /// [`RawSymbol::made_fed_sinks`], [`RawSymbol::made_passes`].
    made_fed_sinks: BTreeSet<String>,
    made_passes: BTreeSet<RawRef>,
    /// The parameters of the function the walk's own function hands back (`export
    /// function login() { return (req, res) => { ... } }`: `req`, `res`), and the
    /// locals bound to a value read off one: what the function made is called
    /// with is its input, as a parameter of the function itself is.
    product_params: HashSet<SymbolId>,
    /// The locals bound to a value read off a parameter of the walk's own function
    /// ([`Collector::reads_own_param`]).
    own_locals: HashSet<SymbolId>,
    /// The locals bound to a credential the request carries, as it was sent
    /// ([`Collector::credential_read`]).
    cred_seeds: HashSet<SymbolId>,
    /// The locals bound to what a call or a lookup made of such a credential
    /// ([`Collector::credential_identity`]).
    cred_locals: HashSet<SymbolId>,
    /// Some `return` of the walk's own function gives such a value; some gives
    /// anything else that is a value.
    returns_cred: bool,
    returns_not_cred: bool,
    /// [`RawSymbol::refuses_without`].
    refuses_without: BTreeSet<Vec<RawRef>>,
    /// [`RawSymbol::arg_sides`], [`RawSymbol::param_keys`].
    arg_sides: BTreeSet<(RawRef, Vec<(String, String)>)>,
    param_keys: BTreeSet<(RawRef, String, String)>,
    /// The locals bound to a value read off one parameter of the walk's own
    /// function, by that parameter.
    param_locals: HashMap<SymbolId, (String, String)>,
    order: Vec<RawRef>,
    /// The callees whose call's value the body returns, outside any callback.
    returns_calls: BTreeSet<RawRef>,
    /// Do not descend into decorators (set while walking a class body).
    skip_decorators: bool,
    /// Saw request input read anywhere in the body ([`INPUT_NAMES`], an input member
    /// of `req`/`request`).
    saw_input: bool,
    /// The body turns its caller away ([`drift_core::controls::REJECTS_CALLER`]) as not
    /// signed in, or as not allowed: what it throws or returns says so
    /// ([`Collector::rejecting`]), or a status setter or sign-in redirect
    /// ([`Collector::note_rejection`]), where it counts ([`Collector::counting`]).
    unauthenticated: bool,
    forbidden: bool,
    /// The body reads a user, session, auth, token or permission value
    /// ([`drift_core::controls::names_subject`]): a 403 counts only next to one.
    reads_subject: bool,
    /// Inside a `catch` clause: what is thrown or returned there converts an error
    /// caught from deeper code (an error-mapping middleware).
    in_catch: u32,
    /// The statements about to be walked are a function's own body
    /// ([`Collector::note_verified_try`]: a `try` that ends it).
    at_body: bool,
    /// Inside a callback given to `.then()`, `.catch()` or `.finally()`: it runs on
    /// what the promise settles with, after the call that made it.
    in_callback: u32,
    /// The current function has called its continuation (`next()`, the wrapped
    /// `handler()`) on every path so far: a guard rejects before it hands control on,
    /// so what follows is about the continuation's result, not the caller.
    continued: bool,
    /// Local bindings of an error or response that says it rejects the caller
    /// (`const e = new HTTPError(401)`), so that `throw e` does.
    rejection_vars: BTreeMap<String, drift_core::controls::Rejection>,
    /// How many exits that answer "not signed in" were counted, and how many of
    /// them stand in a branch after which the function goes on
    /// ([`Collector::branch_goes_on`]).
    unauth_notes: u32,
    unauth_goes_on: u32,
    /// The check being recorded stands in such a branch.
    check_goes_on: bool,
    /// For each list of statements being walked, innermost last, what comes after
    /// the statement being walked: nothing (0), a statement that leaves the
    /// function (1), anything else (2). With [`Collector::followed_saved`] for the
    /// functions being walked.
    followed: Vec<u8>,
    followed_saved: Vec<Vec<u8>>,
    /// The keys under which the function's own `return`s hand back a response that
    /// says "not signed in" ("" for the response itself, `.error` for `return {
    /// error: NextResponse.json(..., { status: 401 }) }`), and whether the body
    /// turns a caller away in any other way (a throw, a status set, a redirect).
    returned_rejections: BTreeSet<String>,
    other_rejection: bool,
    /// A `return` of the function's own body hands back a call of a refusal
    /// builder of this file that answers 401, and the calls of a function of
    /// another module it returns ([`RawSymbol::returns_builder`]).
    builder_rejects: bool,
    /// Inside the branch of an `if` that answers "not signed in" under a condition
    /// that reads nothing of the request or the caller ([`Collector::caller_free`]).
    free_refusal: u32,
    returns_builder: Vec<RawRef>,
    /// The body configures a filter a data library adds to the queries it runs
    /// ([`drift_core::controls::ORM_FILTER`]).
    orm_filter: bool,
    /// [`RawSymbol::builder_checks`].
    builder_checks: Vec<(RawRef, RawBodyCheck)>,
    /// [`RawSymbol::unread_exits`].
    unread_exits: Vec<(Option<RawRef>, RawOperand)>,
    /// The calls whose value is awaited or returned as it is, by where they end (a
    /// call with `.catch()` on it is not: that call is, and starts where it does).
    awaited_calls: HashSet<u32>,
    /// What the conditions of the branches the walk is inside read, innermost
    /// last ([`Collector::gate`]).
    tests: Vec<Vec<RawOperand>>,
    /// What the conditions of the branches that returned a service read, where
    /// what follows them ran for the others only.
    serving_tests: Vec<RawOperand>,
    /// Locals bound to a call or a response that may be a refusal, with what the
    /// walk was inside when they were bound: kept where the body returns the local
    /// ([`Collector::returned_names`]).
    pending_exits: Vec<(String, Option<RawRef>, Vec<RawOperand>)>,
    /// The locals a `return` of the function's own body hands back, by name.
    returned_names: HashSet<String>,
    /// The `return`s of a branch whose exit [`Collector::note_check`] read, by
    /// where they start.
    covered_returns: HashSet<u32>,
    /// The calls that are a statement of their own, by where they start; the
    /// callees every call of which is one, the callees called in any other way,
    /// and the callees whose value the body returns when there is one, with the
    /// key it is under ([`RawSymbol::result_uses`]).
    drop_sites: HashSet<u32>,
    result_dropped: BTreeSet<RawRef>,
    result_used: BTreeSet<RawRef>,
    result_returned: BTreeSet<(RawRef, String)>,
    /// Per function being walked (innermost last): the local names its continuation
    /// is bound to, from its parameters (`({ next: go })`, `(req, res, next)`,
    /// `(ctx, next)`; [`continuation_params`]).
    continuation_names: Vec<Vec<String>>,
    /// The body hands the request on where the facts do not follow
    /// ([`drift_core::SymbolCalls::hands_on`]).
    hands_on: bool,
    /// How many `try` blocks with a handler the walk is in, and the callees called
    /// in one and outside any ([`drift_core::SymbolCalls::caught`]), as the facts
    /// write a call (`param:request.jwtVerify` for one through a parameter).
    in_try: u32,
    /// How many enclosing branches are taken only where a credential the request
    /// carries is present ([`Collector::credential_present`]), and what is called
    /// in one and outside any ([`drift_core::SymbolCalls::given_credential`]).
    cred_present: u32,
    called_with_credential: BTreeSet<RawRef>,
    called_without_credential: BTreeSet<RawRef>,
    called_in_try: BTreeSet<RawRef>,
    called_outside: BTreeSet<RawRef>,
    params_in_try: BTreeSet<String>,
    params_outside: BTreeSet<String>,
    /// What the function the walk started on returns
    /// ([`drift_core::SymbolCalls::returns_function`]): a function written there,
    /// and anything else.
    returns_fn: u32,
    returns_other: bool,
    /// The calls of exports of packages on the guard lists
    /// ([`RawSymbol::guard_calls`]).
    guard_calls: Vec<RawGuardCall>,
    /// Locals bound to what the continuation hands back (`const r = await next()`), or
    /// to a value derived from it.
    continuation_vars: BTreeSet<String>,
    /// Callees called before the continuation, and those called only after it or on
    /// its result ([`drift_core::Symbol::after_continuation`]).
    before_calls: BTreeSet<RawRef>,
    after_calls: BTreeSet<RawRef>,
    /// Inside code that runs only on the server: the `typeof window === "undefined"`
    /// side of a check, or what follows `if (typeof window !== "undefined") return`.
    server_only: u32,
    /// How many branches of the current function's body enclose the node being walked
    /// (the consequent of an `if`, an `else` of a branch that goes on, a loop, a
    /// `switch` case, an arm of `?:`): a check there runs only for the requests that
    /// take them ([`drift_core::BodyCheck::conditional`]).
    branches: u32,
    /// The current function's body has returned for some requests without turning
    /// them away (`if (preview) return NextResponse.json(draft)`): a check after it
    /// does not run for those ([`drift_core::BodyCheck::conditional`]).
    served: bool,
    /// The expression being walked is the condition of an `if` one of whose branches
    /// turns the caller away: what it compares is recorded as a check.
    refusal_test: u32,
    /// Environment reads made somewhere that is not server-only.
    browser_reads: BTreeSet<String>,
    /// Every call recorded, with why it does not run for every request that reaches
    /// the function it is in, empty where it does
    /// ([`drift_core::Symbol::conditional_calls`]).
    call_whys: BTreeSet<(RawRef, &'static str)>,
    /// The calls whose value is dropped, by where they end (a call and the `.catch()`
    /// on it start at the same place): a call that is a statement of its own, under
    /// `void`, bound to a name the body never reads, or with only `.then()` /
    /// `.catch()` / `.finally()` on it ([`drift_core::not_always::NOT_AWAITED`]).
    dropped: HashSet<u32>,
    /// The functions written inside the body that do not run where they are
    /// written, by where they start: one bound to a name nothing reads (`const
    /// check = () => assertAccess(...)`, never called), a declaration nothing
    /// calls, and a callback handed to a timer (`setTimeout(() => check(), 0)`).
    /// What such a function checks or calls is conditional.
    later_fns: HashSet<u32>,
    /// Functions written as the callback of an element method, run once per
    /// element ([`ELEMENT_METHODS`]): what they call runs for some requests only.
    per_element_fns: HashSet<u32>,
    /// How many functions enclose the node being walked: 0 outside any, and at the
    /// function the collector was started on.
    fn_depth: u32,
    /// Walking a method's body: the class and its methods' names. A call of one
    /// through `this` (`this.assertSameOrg(user, rule)`) is a call of the
    /// repository's own, with its place in the body's order and whether every
    /// request makes it.
    this_methods: Option<(String, BTreeSet<String>)>,
    /// How many functions with a `this` of their own (a `function`, a class) enclose
    /// the node being walked, below the one the collector was started on.
    own_this: u32,
    /// The functions written as a property of an object in place, by where each
    /// starts, with the keys of that object that hold a function; and, for each
    /// enclosing `function`, those keys where it is one of them (`cache = { get(k) {
    /// ... }, put(k, v) { this.get(k) } }`: `this.get` is a method written in the
    /// same value, read with it).
    object_fns: HashMap<u32, std::rc::Rc<HashSet<String>>>,
    value_methods: Vec<Option<std::rc::Rc<HashSet<String>>>>,
    /// Locals bound to a value reached from a parameter by its own members and
    /// their methods (`const path = req.url.split("?")[0].toLowerCase()`), by the
    /// parameter's name: a method of one is a method of a value of the parameter.
    param_values: HashMap<SymbolId, String>,
    /// The functions written inside a function's body under a name of their own
    /// (`function check() {...}`, `const check = () => {...}`), by where they start.
    /// One runs where the body calls it, not where it is written
    /// ([`Collector::settle`]).
    named_fns: HashMap<u32, SymbolId>,
    /// Those of [`Collector::named_fns`] that are `async`.
    async_fns: HashSet<SymbolId>,
    /// Those being walked, innermost last.
    local_fns: Vec<SymbolId>,
    /// A named local function is read where every request gets (`.0`), or called
    /// there with its value dropped (`.1`).
    local_uses: HashMap<SymbolId, (bool, bool)>,
    /// The identifiers that are the callee of a call whose value is dropped, by
    /// where they start.
    dropped_callees: HashSet<u32>,
    /// The checks and the calls written in a named local function at a place every
    /// call of it reaches, with the functions they are in: unconditional only where
    /// each of those runs for every request.
    pending_checks: Vec<(Vec<SymbolId>, RawBodyCheck)>,
    pending_calls: Vec<(Vec<SymbolId>, RawRef, &'static str)>,
    /// Nest guards the body registers for the whole application
    /// (`app.useGlobalGuards(new AuthGuard())`): recorded as a module's `APP_GUARD`
    /// provider is ([`RawSymbol::decorator_args`]).
    global_guards: Vec<RawRef>,
    /// [`RawSymbol::receiver_calls`] of the body.
    receiver_calls: BTreeSet<RawReceiverCall>,
    /// Locals of the body that are another name for something a module binds:
    /// `const svc = services.rules`, `const { rules } = services`, `const {
    /// ruleService } = await import("@/lib/rule-service")`. A call through one is a
    /// call of what it names ([`Collector::note_alias_call`]).
    aliases: HashMap<SymbolId, RawRef>,
    /// The values of the caller in the body, and what it does with them
    /// ([`caller`]).
    flow: caller::Flow,
    /// Practice facts (facts schema 11); see [`Practice`].
    p: Practice,
}

/// What a [`Collector`] gathers for the practice facts (facts schema 11).
#[derive(Default)]
struct Practice {
    /// Local bindings to what they hold: the callee whose result they are
    /// (`const s = await auth()`) or a request header (`header:x`), with the member
    /// path read off it (`const { orgId } = auth()` -> `.orgId`).
    bound: HashMap<SymbolId, (RawOperand, String)>,
    /// Locals bound to what a library always hands back, never null
    /// ([`ALWAYS_PRESENT`]): `const session = await getIronSession(...)`. A test
    /// of one for being there refuses no one.
    present: HashSet<SymbolId>,
    /// Locals bound to a function that hands back a Promise
    /// ([`ASYNC_PREDICATES`]): `const { isAuthenticated } =
    /// getKindeServerSession()`. Negated without `await`, a call of one is always
    /// false.
    promised: HashSet<SymbolId>,
    /// Locals declared with an initialiser (`let ok = check()`): a write of its own,
    /// beside those the body makes later ([`ReassignedReads`]).
    initialised: HashSet<SymbolId>,
    /// Locals bound to request input (`const body = await req.json()`).
    input_vars: HashSet<SymbolId>,
    /// Locals bound to an object built with an env-derived secret
    /// (`const wh = new Webhook(process.env.SVIX_SECRET)`).
    env_secrets: HashSet<SymbolId>,
    /// Parameters of the functions walked, by name.
    params: HashMap<SymbolId, String>,
    /// Calls through parameters ([`RawSymbol::param_calls`], [`RawSymbol::typed_param_calls`]).
    param_calls: BTreeSet<String>,
    typed_param_calls: BTreeSet<RawRef>,
    /// Of those, the methods of a member a parameter's type literal gives a built-in
    /// value's type ([`drift_core::controls::BUILTIN_VALUE`]).
    builtin_values: BTreeSet<String>,
    /// Catch clauses being walked, innermost last.
    frames: Vec<CatchFrame>,
    body_checks: BTreeSet<RawBodyCheck>,
    responses: BTreeSet<RawResponse>,
    log_calls: BTreeSet<RawLogCall>,
    catches: BTreeSet<RawCatch>,
    headers: BTreeSet<String>,
    inputs: BTreeSet<RawRef>,
    handles: BTreeSet<RawOperand>,
    env_calls: BTreeSet<(RawRef, u32, String, bool)>,
    /// Span starts of calls already read as part of a response (`res.status(401)` in
    /// `return res.status(401).json(...)`).
    consumed: HashSet<u32>,
    /// The expression a `return` or `throw` being walked hands back (its span start).
    exit: Option<(u32, drift_core::ResponseVia)>,
    /// Responses noted so far (a `return` in a catch that sends none is `return`).
    sent: u32,
}

/// One catch clause being walked ([`RawCatch`]).
struct CatchFrame {
    param: Option<SymbolId>,
    classes: BTreeSet<RawOperand>,
    does: BTreeSet<(String, Option<RawRef>)>,
}

/// What `e` being true says about where the code runs: `Some(true)` for
/// `typeof window === "undefined"` (the server), `Some(false)` for
/// `typeof window !== "undefined"` (the browser); `document` likewise.
fn window_test(e: &Expression) -> Option<bool> {
    let Expression::BinaryExpression(b) = unwrap_expr(e) else {
        return None;
    };
    let typeof_global = |e: &Expression| {
        matches!(unwrap_expr(e), Expression::UnaryExpression(u)
            if u.operator == UnaryOperator::Typeof
                && matches!(unwrap_expr(&u.argument), Expression::Identifier(id) if matches!(id.name.as_str(), "window" | "document")))
    };
    let undefined = |e: &Expression| matches!(unwrap_expr(e), Expression::StringLiteral(l) if l.value == "undefined");
    if !((typeof_global(&b.left) && undefined(&b.right))
        || (undefined(&b.left) && typeof_global(&b.right)))
    {
        return None;
    }
    match b.operator {
        BinaryOperator::StrictEquality | BinaryOperator::Equality => Some(true),
        BinaryOperator::StrictInequality | BinaryOperator::Inequality => Some(false),
        _ => None,
    }
}

type Parts = (
    Vec<RawRef>,
    Vec<RawRef>,
    Vec<(RawRef, u32, String)>,
    Vec<String>,
    u32,
);

impl<'l, 's> Collector<'l, 's> {
    fn new(l: &'l Lowerer<'s>) -> Self {
        Self {
            l,
            calls: BTreeSet::new(),
            renders: BTreeSet::new(),
            args: BTreeSet::new(),
            controls: BTreeSet::new(),
            strings: 0,
            saw_jsx: false,
            reads: BTreeSet::new(),
            throws: BTreeSet::new(),
            sinks: BTreeSet::new(),
            caller_keys: BTreeSet::new(),
            fed_sinks: BTreeSet::new(),
            param_passes: BTreeSet::new(),
            made_fed_sinks: BTreeSet::new(),
            made_passes: BTreeSet::new(),
            product_params: HashSet::new(),
            own_locals: HashSet::new(),
            cred_seeds: HashSet::new(),
            cred_locals: HashSet::new(),
            returns_cred: false,
            returns_not_cred: false,
            refuses_without: BTreeSet::new(),
            arg_sides: BTreeSet::new(),
            param_keys: BTreeSet::new(),
            param_locals: HashMap::new(),
            order: Vec::new(),
            returns_calls: BTreeSet::new(),
            skip_decorators: false,
            saw_input: false,
            unauthenticated: false,
            forbidden: false,
            reads_subject: false,
            in_catch: 0,
            at_body: false,
            in_callback: 0,
            continued: false,
            rejection_vars: BTreeMap::new(),
            unauth_notes: 0,
            unauth_goes_on: 0,
            check_goes_on: false,
            followed: Vec::new(),
            followed_saved: Vec::new(),
            returned_rejections: BTreeSet::new(),
            other_rejection: false,
            builder_rejects: false,
            free_refusal: 0,
            returns_builder: Vec::new(),
            orm_filter: false,
            builder_checks: Vec::new(),
            unread_exits: Vec::new(),
            awaited_calls: HashSet::new(),
            tests: Vec::new(),
            serving_tests: Vec::new(),
            pending_exits: Vec::new(),
            returned_names: HashSet::new(),
            covered_returns: HashSet::new(),
            drop_sites: HashSet::new(),
            result_dropped: BTreeSet::new(),
            result_used: BTreeSet::new(),
            result_returned: BTreeSet::new(),
            continuation_names: Vec::new(),
            hands_on: false,
            in_try: 0,
            cred_present: 0,
            called_with_credential: BTreeSet::new(),
            called_without_credential: BTreeSet::new(),
            called_in_try: BTreeSet::new(),
            called_outside: BTreeSet::new(),
            params_in_try: BTreeSet::new(),
            params_outside: BTreeSet::new(),
            returns_fn: 0,
            returns_other: false,
            guard_calls: Vec::new(),
            continuation_vars: BTreeSet::new(),
            before_calls: BTreeSet::new(),
            after_calls: BTreeSet::new(),
            server_only: 0,
            branches: 0,
            served: false,
            refusal_test: 0,
            browser_reads: BTreeSet::new(),
            call_whys: BTreeSet::new(),
            dropped: HashSet::new(),
            later_fns: HashSet::new(),
            per_element_fns: HashSet::new(),
            fn_depth: 0,
            this_methods: None,
            own_this: 0,
            object_fns: HashMap::new(),
            value_methods: Vec::new(),
            param_values: HashMap::new(),
            named_fns: HashMap::new(),
            async_fns: HashSet::new(),
            local_fns: Vec::new(),
            local_uses: HashMap::new(),
            dropped_callees: HashSet::new(),
            pending_checks: Vec::new(),
            pending_calls: Vec::new(),
            global_guards: Vec::new(),
            receiver_calls: BTreeSet::new(),
            aliases: HashMap::new(),
            flow: caller::Flow::default(),
            p: Practice::default(),
        }
    }

    fn into_parts(mut self) -> Parts {
        if self.unauthenticated || (self.forbidden && self.reads_subject) {
            self.controls
                .insert(drift_core::controls::REJECTS_CALLER.into());
        }
        (
            self.calls.into_iter().collect(),
            self.renders.into_iter().collect(),
            self.args.into_iter().collect(),
            self.controls.into_iter().collect(),
            self.strings,
        )
    }

    /// A check or a call written in a named local function runs for every request
    /// only where the function does: where the body reads its name (calls it, hands
    /// it on, returns it) at a place every request gets, outside any other such
    /// function. A function called only under a branch (`if (req.method ===
    /// "DELETE") check();`), after a return that serves, or called and not awaited
    /// while `async`, checks the requests that take that path only.
    fn settle(&mut self) {
        let uses = std::mem::take(&mut self.local_uses);
        let runs = |owners: &[SymbolId]| {
            owners.iter().all(|s| {
                uses.get(s).is_some_and(|(read, dropped)| {
                    *read || (*dropped && !self.async_fns.contains(s))
                })
            })
        };
        for (owners, mut c) in std::mem::take(&mut self.pending_checks) {
            if !runs(&owners) {
                c.conditional = true;
                c.condition = drift_core::not_always::UNDER_BRANCH.to_string();
            }
            self.p.body_checks.insert(c);
        }
        for (owners, r, why) in std::mem::take(&mut self.pending_calls) {
            let why = if runs(&owners) {
                why
            } else {
                drift_core::not_always::UNDER_BRANCH
            };
            self.call_whys.insert((r, why));
        }
    }

    /// What a name or a member path stands for where it is a module's binding or a
    /// local that is another name for one ([`Collector::aliases`]): no call in the
    /// path, and nothing global.
    fn module_ref(&self, e: &Expression) -> Option<RawRef> {
        let mut path: Vec<&str> = Vec::new();
        let mut cur = unwrap_expr(e);
        let root = loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    path.push(m.property.name.as_str());
                    cur = unwrap_expr(&m.object);
                }
                Expression::Identifier(id) => break id,
                _ => return None,
            }
        };
        if path.len() >= MAX_MEMBER_DEPTH {
            return None;
        }
        let mut r = match self.symbol_of(root).and_then(|s| self.aliases.get(&s)) {
            Some(r) => r.clone(),
            None => {
                let base = self.l.resolve_ident(root)?;
                if matches!(base, RawBase::Global(_)) {
                    return None;
                }
                RawRef {
                    base,
                    member: String::new(),
                }
            }
        };
        for seg in path.iter().rev() {
            r.member.push('.');
            r.member.push_str(seg);
        }
        Some(r)
    }

    /// `const svc = services.rules`, `const { rules: svc } = services`, `const mod =
    /// await import("./service")` inside a body: the local is another name for what a
    /// module binds ([`Collector::aliases`]).
    fn note_alias(&mut self, id: &BindingPattern, init: &Expression) {
        if self.fn_depth == 0 {
            return;
        }
        let whole = match peel(init) {
            Expression::ImportExpression(i) => match unwrap_expr(&i.source) {
                Expression::StringLiteral(s) => Some(RawRef {
                    base: RawBase::Import {
                        spec: lit(s),
                        name: "*".to_string(),
                    },
                    member: String::new(),
                }),
                _ => None,
            },
            e => self.module_ref(e),
        };
        let Some(whole) = whole else { return };
        match id {
            BindingPattern::BindingIdentifier(b) => {
                if let Some(s) = b.symbol_id.get() {
                    self.aliases.insert(s, whole);
                }
            }
            BindingPattern::ObjectPattern(o) => {
                for p in &o.properties {
                    let BindingPattern::BindingIdentifier(b) = &p.value else {
                        continue;
                    };
                    let (Some(s), false, Some(k)) =
                        (b.symbol_id.get(), p.computed, key_name(&p.key))
                    else {
                        continue;
                    };
                    let r = match &whole.base {
                        // A name of the module loaded: `{ ruleService }` of `import()`.
                        RawBase::Import { spec, name }
                            if name == "*" && whole.member.is_empty() =>
                        {
                            RawRef {
                                base: RawBase::Import {
                                    spec: spec.clone(),
                                    name: k,
                                },
                                member: String::new(),
                            }
                        }
                        _ => RawRef {
                            base: whole.base.clone(),
                            member: format!("{}.{k}", whole.member),
                        },
                    };
                    self.aliases.insert(s, r);
                }
            }
            _ => {}
        }
    }

    /// A call through a local that is another name for a module's binding
    /// (`svc.list(orgId)` after `const svc = services.rules`): a call of what it
    /// names, with its place in the body's order and whether every request makes it
    /// ([`RawReceiverCall::Ref`]). The call ends at `end`.
    fn note_alias_call(&mut self, callee: &Expression, end: u32) {
        if self.aliases.is_empty() {
            return;
        }
        let mut cur = unwrap_expr(callee);
        let root = loop {
            match cur {
                Expression::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => cur = unwrap_expr(&m.object),
                    _ => return,
                },
                Expression::Identifier(id) => break id,
                _ => return,
            }
        };
        if !self
            .symbol_of(root)
            .is_some_and(|s| self.aliases.contains_key(&s))
        {
            return;
        }
        let inner = match unwrap_expr(callee) {
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => {
                    self.module_ref(&m.object).map(|mut r| {
                        r.member.push('.');
                        r.member.push_str(m.property.name.as_str());
                        r
                    })
                }
                _ => None,
            },
            e => self.module_ref(e),
        };
        let Some(r) = inner else { return };
        if !self.order.contains(&r) && self.order.len() < MAX_ORDER {
            self.order.push(r.clone());
        }
        self.note_call_why(r.clone(), end);
        self.receiver_calls.insert(RawReceiverCall::Ref(r));
    }

    /// The walk starts in the body of a method of `class`: what is written there is
    /// inside a function, and `this` is an instance of the class.
    pub(crate) fn in_method_of(&mut self, class: &Class) {
        let name = class
            .id
            .as_ref()
            .map_or_else(|| "default".to_string(), |i| i.name.to_string());
        let methods = class
            .body
            .body
            .iter()
            .filter_map(|el| match el {
                ClassElement::MethodDefinition(m) => m.key.static_name(),
                ClassElement::PropertyDefinition(p)
                    if p.value.as_ref().is_some_and(|v| {
                        matches!(
                            unwrap_expr(v),
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        )
                    }) =>
                {
                    p.key.static_name()
                }
                _ => None,
            })
            .filter_map(|k| k.as_str().map(String::from))
            .collect();
        self.fn_depth = 1;
        self.this_methods = Some((name, methods));
    }

    /// SQL written as text that filters its rows, given a value read off the caller
    /// (`app.pg.query("select * from devices where fleet_id = $1",
    /// [request.operator.fleetId])`, `client.query(text, [session.orgId])`): it may
    /// be the scope, whatever the column is called
    /// ([`drift_core::controls::SCOPE_UNREAD`]). `values`: what the text is given.
    fn note_sql_scope<'b, 'a: 'b>(
        &mut self,
        text: &str,
        values: impl Iterator<Item = &'b Expression<'a>>,
    ) {
        if !drift_core::practice::sql_filters(text) {
            return;
        }
        let mut flat: Vec<&Expression> = Vec::new();
        for v in values {
            match unwrap_expr(v) {
                Expression::ArrayExpression(a) => {
                    flat.extend(a.elements.iter().filter_map(|e| e.as_expression()));
                }
                v => flat.push(v),
            }
        }
        // Read off a parameter through a member that holds no input
        // (`request.operator.fleetId`, `req.user.orgId`), or off what a call gave
        // (`session.orgId`).
        let callers = flat.iter().any(|v| match self.operand(v, 0) {
            Some((RawOperand::Text(t), path)) if t.starts_with("param:") => {
                let mut segs = path.split('.').filter(|s| !s.is_empty());
                let first = segs.next();
                first.is_some_and(|f| !input::REQUEST_INPUT_MEMBERS.contains(&f))
                    && (segs.next().is_some()
                        || drift_core::controls::names_subject(t.trim_start_matches("param:")))
            }
            Some((RawOperand::Ref(_), path)) => !path.is_empty(),
            _ => false,
        });
        if callers {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
    }

    /// A call of what a Fastify instance was decorated with
    /// (`app.devices.getChecked(id, operator)`, `request.server.devices.getChecked(
    /// ...)`), and a method of what a request carries beside its own plumbing
    /// (`request.devices.getChecked(...)`, `req.user.can(...)`): the method of the
    /// class the decoration built, where the module says, else unread
    /// ([`RawReceiverCall`]). It may be where the tenant is checked.
    fn note_carried_call(&mut self, callee: &Expression) {
        let mut members: Vec<&str> = Vec::new();
        let mut cur = unwrap_expr(callee);
        let root = loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    members.push(m.property.name.as_str());
                    cur = unwrap_expr(&m.object);
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        members.push(m.property.name.as_str());
                        cur = unwrap_expr(&m.object);
                    }
                    _ => return,
                },
                Expression::Identifier(id) => break id,
                _ => return,
            }
        };
        members.reverse();
        if members.len() < 2 || members.len() > MAX_MEMBER_DEPTH {
            return;
        }
        let name = root.name.as_str();
        let instance = self.l.router_adapter.get(name).copied() == Some("fastify")
            && self.l.resolve_ident(root).is_some();
        let param = self
            .symbol_of(root)
            .is_some_and(|s| self.l.params.contains_key(&s))
            && PLUMBING_PARAMS.contains(&name);
        // The decoration's name and the method called on it.
        let decorated = if instance {
            Some((members[0], &members[1..]))
        } else if param && members[0] == "server" && members.len() >= 3 {
            Some((members[1], &members[2..]))
        } else {
            None
        };
        let written = || format!("local:{name}.{}", members.join("."));
        let call = match decorated {
            Some((d, _)) if INSTANCE_MEMBERS.contains(&d) => return,
            Some((d, rest)) => match self.l.decorations.get(d) {
                Some(Some(class)) if rest.len() == 1 => {
                    let mut r = class.clone();
                    r.member.push('.');
                    r.member.push_str(rest[0]);
                    RawReceiverCall::Ref(r)
                }
                _ => RawReceiverCall::Unread(written()),
            },
            None if param && !REQUEST_MEMBERS.contains(&members[0]) => {
                RawReceiverCall::Unread(written())
            }
            None => return,
        };
        self.receiver_calls.insert(call);
    }

    /// A call through `this` in a method's body that nothing else records
    /// ([`RawReceiverCall`]): a method the class does not define itself
    /// (`this.scoped(orgId)`: a base class's, or a property that holds a function),
    /// and a method of a property whose type is not read (`this.rules.list(user)`
    /// where `rules` is inherited, typed by an interface, or a getter). It may run
    /// the repository's code, where the tenant is checked or the query scoped. A
    /// property that holds a plain value ([`Lowerer::this_plain`]) runs none.
    fn note_this_call(&mut self, callee: &Expression) {
        if self.own_this != 0 {
            return;
        }
        let Some((class, names)) = &self.this_methods else {
            return;
        };
        let mut path: Vec<&str> = Vec::new();
        let mut cur = unwrap_expr(callee);
        loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    path.push(m.property.name.as_str());
                    cur = unwrap_expr(&m.object);
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        path.push(m.property.name.as_str());
                        cur = unwrap_expr(&m.object);
                    }
                    _ => return,
                },
                Expression::ThisExpression(_) => break,
                _ => return,
            }
        }
        path.reverse();
        let call = match path.as_slice() {
            [] => return,
            [method] if names.contains(*method) => return,
            [method] => RawReceiverCall::Ref(RawRef {
                base: RawBase::Local(class.clone()),
                member: format!(".{method}"),
            }),
            [property, ..] if self.l.this_plain.borrow().contains(*property) => return,
            path => {
                let shown = &path[..path.len().min(MAX_MEMBER_DEPTH)];
                RawReceiverCall::Unread(format!("local:this.{}", shown.join(".")))
            }
        };
        self.receiver_calls.insert(call);
    }

    /// Record why the call of `r` that ends at `end` does not run for every request
    /// ([`Collector::not_always`]): at once, or once it is known whether the named
    /// local function it is written in runs ([`Collector::settle`]).
    fn note_call_why(&mut self, r: RawRef, end: u32) {
        let why = self.not_always(end);
        if !self.local_fns.is_empty()
            && (why.is_empty() || why == drift_core::not_always::NOT_AWAITED)
        {
            self.pending_calls.push((self.local_fns.clone(), r, why));
        } else {
            self.call_whys.insert((r, why));
        }
    }

    /// Record a check: at once, or once it is known whether the named local
    /// function it is written in runs ([`Collector::settle`]).
    fn add_check(&mut self, c: RawBodyCheck) {
        if c.condition.is_empty() && !self.local_fns.is_empty() {
            self.pending_checks.push((self.local_fns.clone(), c));
        } else {
            self.p.body_checks.insert(c);
        }
    }

    /// Enter a function: what it holds of the enclosing one, to hand back to
    /// [`Collector::leave_fn`]. A function written inside another's body is reached
    /// by the requests that reach where it is written (`if (req.method === "DELETE")
    /// { await db.transaction(async (tx) => { <check> }) }`), and not at all where it
    /// does not run where it stands (`later`).
    fn enter_fn(&mut self, start: u32, later: bool) -> (bool, u32, bool, bool) {
        let continued = std::mem::replace(&mut self.continued, false);
        let branches = self.branches;
        let served = self.served;
        if self.fn_depth == 0 {
            self.branches = 0;
            self.served = false;
        }
        self.branches += u32::from(later);
        let named = match self.named_fns.get(&start) {
            Some(sym) if self.fn_depth > 0 => {
                self.local_fns.push(*sym);
                true
            }
            _ => false,
        };
        self.fn_depth += 1;
        self.followed_saved.push(std::mem::take(&mut self.followed));
        (continued, branches, served, named)
    }

    fn leave_fn(&mut self, (continued, branches, served, named): (bool, u32, bool, bool)) {
        self.fn_depth -= 1;
        self.followed = self.followed_saved.pop().unwrap_or_default();
        if named {
            self.local_fns.pop();
        }
        self.served = served;
        self.branches = branches;
        self.continued = continued;
    }

    fn fill(mut self, sym: &mut RawSymbol) {
        self.settle();
        // The values of the caller, and what the body does with them ([`caller`]).
        let signs_in: Vec<RawOperand> = self
            .p
            .body_checks
            .iter()
            .filter(|c| {
                matches!(
                    c.outcome,
                    drift_core::CheckOutcome::Unauthenticated
                        | drift_core::CheckOutcome::SignInRedirect
                )
            })
            .map(|c| c.source.clone())
            .collect();
        self.flow_settle(&signs_in);
        let flow = std::mem::take(&mut self.flow);
        // A use with no callee to name ([`drift_core::CALLER_USE_UNREAD`]).
        let unread = (
            RawRef {
                base: RawBase::Global("scope_unread".into()),
                member: String::new(),
            },
            None,
        );
        if flow.unread && !sym.caller_args.contains(&unread) {
            sym.caller_args.push(unread);
        }
        let returns_caller = drift_core::controls::RETURNS_CALLER;
        if flow.returns_caller() && !sym.listed_controls.iter().any(|c| c == returns_caller) {
            sym.listed_controls.push(returns_caller.to_string());
        }
        sym.param_flows |= flow.param_flows;
        for entry in flow.caller_args {
            if !sym.caller_args.contains(&entry) {
                sym.caller_args.push(entry);
            }
        }
        for tag in flow.tags {
            if !sym.tags.contains(&tag) {
                sym.tags.push(tag);
            }
        }
        let p = std::mem::take(&mut self.p);
        // A 403 is a caller check only next to a subject, as for REJECTS_CALLER.
        let subject = self.reads_subject;
        sym.body_checks.extend(
            p.body_checks
                .into_iter()
                .filter(|c| subject || c.outcome != drift_core::CheckOutcome::Forbidden),
        );
        sym.responses.extend(p.responses);
        sym.log_calls.extend(p.log_calls);
        sym.catches.extend(p.catches);
        sym.headers.extend(p.headers);
        sym.inputs.extend(p.inputs);
        sym.handles_errors.extend(p.handles);
        sym.env_calls.extend(p.env_calls);
        sym.param_calls.extend(p.param_calls);
        sym.typed_param_calls.extend(p.typed_param_calls);
        for c in p.builtin_values {
            if !sym.listed_controls.contains(&c) {
                sym.listed_controls.push(c);
            }
        }
        let browser = std::mem::take(&mut self.browser_reads);
        sym.server_reads
            .extend(self.reads.iter().filter(|r| !browser.contains(*r)).cloned());
        sym.reads.extend(std::mem::take(&mut self.reads));
        sym.throws.extend(std::mem::take(&mut self.throws));
        let before = std::mem::take(&mut self.before_calls);
        sym.after_continuation.extend(
            std::mem::take(&mut self.after_calls)
                .into_iter()
                .filter(|r| !before.contains(r)),
        );
        sym.sinks.extend(std::mem::take(&mut self.sinks));
        sym.caller_keys
            .extend(std::mem::take(&mut self.caller_keys));
        sym.fed_sinks.extend(std::mem::take(&mut self.fed_sinks));
        sym.param_passes
            .extend(std::mem::take(&mut self.param_passes));
        for site in std::mem::take(&mut self.refuses_without) {
            if !sym.refuses_without.contains(&site) {
                sym.refuses_without.push(site);
            }
        }
        sym.arg_sides.extend(std::mem::take(&mut self.arg_sides));
        sym.param_keys.extend(std::mem::take(&mut self.param_keys));
        // Every value the function returns was made of a credential the request
        // carries: what it gives is who the credential says, or nothing.
        if self.returns_cred && !self.returns_not_cred {
            let c = drift_core::controls::RETURNS_CREDENTIAL.to_string();
            if !sym.listed_controls.contains(&c) {
                sym.listed_controls.push(c);
            }
        }
        sym.made_fed_sinks
            .extend(std::mem::take(&mut self.made_fed_sinks));
        sym.made_passes
            .extend(std::mem::take(&mut self.made_passes));
        for r in std::mem::take(&mut self.returns_calls) {
            if !sym.returns_calls.contains(&r) {
                sym.returns_calls.push(r);
            }
        }
        for g in std::mem::take(&mut self.global_guards) {
            let entry = (RawOperand::Text("APP_GUARD".into()), g);
            if !sym.decorator_args.contains(&entry) {
                sym.decorator_args.push(entry.clone());
                sym.measured_args.push(entry);
            }
        }
        for (r, why) in std::mem::take(&mut self.call_whys) {
            let entry = (r, why.to_string());
            if !sym.conditional_calls.contains(&entry) {
                sym.conditional_calls.push(entry);
            }
        }
        for r in std::mem::take(&mut self.order) {
            if !sym.order.contains(&r) && sym.order.len() < MAX_ORDER {
                sym.order.push(r);
            }
        }
        for r in std::mem::take(&mut self.receiver_calls) {
            if !sym.receiver_calls.contains(&r) {
                sym.receiver_calls.push(r);
            }
        }
        for c in std::mem::take(&mut self.builder_checks) {
            if !sym.builder_checks.contains(&c) {
                sym.builder_checks.push(c);
            }
        }
        // A local bound to a call that may be a refusal, and handed back.
        for (name, callee, gate) in std::mem::take(&mut self.pending_exits) {
            if self.returned_names.contains(&name) {
                for source in gate {
                    self.unread_exits.push((callee.clone(), source));
                }
            }
        }
        for e in std::mem::take(&mut self.unread_exits) {
            if !sym.unread_exits.contains(&e) {
                sym.unread_exits.push(e);
            }
        }
        if self.orm_filter {
            let control = drift_core::controls::ORM_FILTER.to_string();
            if !sym.listed_controls.contains(&control) {
                sym.listed_controls.push(control);
            }
        }
        // A refusal builder's call returned: the function refuses by the response
        // it hands back, as one returning the response itself does, for the
        // readings that list (the measured `rejects_caller` stays what it was).
        if self.builder_rejects {
            let c = drift_core::controls::REJECTS_CALLER.to_string();
            if !sym.listed_controls.contains(&c) && !sym.controls.contains(&c) {
                sym.listed_controls.push(c);
            }
        }
        for r in std::mem::take(&mut self.returns_builder) {
            if !sym.returns_builder.contains(&r) {
                sym.returns_builder.push(r);
            }
        }
        sym.other_rejection |= self.other_rejection;
        // The function turns its caller away only by what it hands back.
        if !self.other_rejection {
            for key in &self.returned_rejections {
                let control = format!("{}{key}", drift_core::controls::RETURNS_REJECTION);
                if !sym.listed_controls.contains(&control) {
                    sym.listed_controls.push(control);
                }
            }
        }
        sym.rejection_goes_on |= self.unauth_notes > 0 && self.unauth_goes_on >= self.unauth_notes;
        sym.hands_on |= self.hands_on;
        // One function, written where it is returned: of two under a condition
        // (`if (strict) return guard; return (req, res, next) => next();`), which
        // one runs is not read.
        sym.returns_function |= self.returns_fn == 1 && !self.returns_other;
        // Of what is called in a `try` only, what verifies who calls.
        let verifier = |p: &String| {
            p.rsplit('.')
                .next()
                .is_some_and(|m| drift_core::guard_lists::VERIFIER_MEMBERS.contains(&m))
        };
        // Of what is called only where a credential is present, what verifies.
        let without = std::mem::take(&mut self.called_without_credential);
        sym.given_credential.extend(
            std::mem::take(&mut self.called_with_credential)
                .into_iter()
                .filter(|r| !without.contains(r))
                .filter(|r| {
                    matches!(&r.base, RawBase::Import { spec, .. }
                        if drift_core::guard_lists::verifying_package(spec)
                            || drift_core::guard_lists::shaped(spec))
                }),
        );
        let outside = std::mem::take(&mut self.called_outside);
        sym.caught.extend(
            std::mem::take(&mut self.called_in_try)
                .into_iter()
                .filter(|r| !outside.contains(r))
                .filter(|r| {
                    matches!(&r.base, RawBase::Import { spec, .. }
                        if drift_core::guard_lists::verifying_package(spec)
                            || drift_core::guard_lists::shaped(spec))
                }),
        );
        let outside = std::mem::take(&mut self.params_outside);
        sym.caught_params.extend(
            std::mem::take(&mut self.params_in_try)
                .into_iter()
                .filter(|p| !outside.contains(p) && verifier(p)),
        );
        sym.verifies.extend(outside.into_iter().filter(verifier));
        for c in std::mem::take(&mut self.guard_calls) {
            if !sym.guard_calls.contains(&c) {
                sym.guard_calls.push(c);
            }
        }
        for r in &self.result_dropped {
            if !self.result_used.contains(r) {
                sym.result_uses.push((r.clone(), "drop".to_string()));
            }
        }
        for (r, key) in &self.result_returned {
            sym.result_uses.push((r.clone(), format!("return:{key}")));
        }
        let (calls, renders, args, controls, strings) = self.into_parts();
        sym.calls.extend(calls);
        sym.renders.extend(renders);
        sym.args.extend(args);
        sym.controls.extend(controls);
        sym.string_literals += strings;
        // A `try` every request enters whose handler answers 401: the function
        // turns its caller away, for the readings that list.
        let rejects = drift_core::controls::REJECTS_CALLER;
        if sym.body_checks.iter().any(|c| {
            c.caught && !c.conditional && c.outcome == drift_core::CheckOutcome::Unauthenticated
        }) && !sym.listed_controls.iter().any(|c| c == rejects)
        {
            sym.listed_controls.push(rejects.to_string());
        }
    }

    /// Record object-literal keys passed as argument `index` to `callee`,
    /// including nested keys as paths (`where.workspaceId`).
    fn object_keys(&mut self, callee: &RawRef, index: usize, e: &Expression) {
        self.object_keys_at(callee, index, e, "", 0);
    }

    fn object_keys_at(
        &mut self,
        callee: &RawRef,
        index: usize,
        e: &Expression,
        prefix: &str,
        depth: usize,
    ) {
        let Expression::ObjectExpression(o) = unwrap_expr(e) else {
            return;
        };
        for p in &o.properties {
            if let ObjectPropertyKind::ObjectProperty(p) = p
                && !p.computed
                && let Some(k) = p.key.static_name()
                && let Some(k) = k.as_str()
            {
                let key = if prefix.is_empty() {
                    k.to_string()
                } else {
                    format!("{prefix}.{k}")
                };
                self.args.insert((
                    callee.clone(),
                    u32::try_from(index).unwrap_or(u32::MAX),
                    key.clone(),
                ));
                if depth + 1 < MAX_KEY_DEPTH {
                    self.object_keys_at(callee, index, &p.value, &key, depth + 1);
                }
            }
        }
    }
}

impl Collector<'_, '_> {
    /// Notes the parameters of a function the walk's own function hands back
    /// ([`Collector::product_params`]).
    fn note_product_params(&mut self, f: &Expression) {
        fn names(p: &BindingPattern, out: &mut HashSet<SymbolId>) {
            match p {
                BindingPattern::BindingIdentifier(b) => out.extend(b.symbol_id.get()),
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
        let params = match f {
            Expression::ArrowFunctionExpression(a) => &a.params,
            Expression::FunctionExpression(a) => &a.params,
            _ => return,
        };
        for item in &params.items {
            names(&item.pattern, &mut self.product_params);
        }
    }

    /// `e` names a parameter of the function the walk's own function hands back,
    /// or a local bound to a value read off one ([`Collector::product_params`]).
    fn reads_product_param(&self, e: &Expression) -> bool {
        !self.product_params.is_empty() && self.names_one(e, &|s| self.product_params.contains(&s))
    }

    /// `e` names a parameter of the walk's own function, or a local bound to a value
    /// read off one: whatever the parameter is (the request, a context, a plain
    /// value), what is read off it is what the function was given.
    fn reads_own_param(&self, e: &Expression) -> bool {
        self.names_one(e, &|s| {
            self.flow.own_param(s) || self.own_locals.contains(&s)
        })
    }

    /// Some name written in `e` is a binding `of` holds.
    fn names_one(&self, e: &Expression, of: &dyn Fn(SymbolId) -> bool) -> bool {
        struct Names<'x, 's> {
            scoping: &'s Scoping,
            of: &'x dyn Fn(SymbolId) -> bool,
            found: bool,
        }
        impl<'a> Visit<'a> for Names<'_, '_> {
            fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
                self.found |= it
                    .reference_id
                    .get()
                    .and_then(|r| self.scoping.get_reference(r).symbol_id())
                    .is_some_and(|s| (self.of)(s));
            }
        }
        let mut names = Names {
            scoping: self.l.scoping,
            of,
            found: false,
        };
        names.visit_expression(e);
        names.found
    }

    /// The parameter of the walk's own function a value is read off: the parameter
    /// itself, a member or an item of it (`user.id`, `req.params.id`), or a local
    /// bound to one. Its name, and where a call gives the value: the parameter's
    /// position and the keys read on the way (`#0` of `userId`, `#0.userId` of
    /// `opts.userId` and of `({ userId })`). A member that cannot be named (an item,
    /// a computed key) and what is read above it stand for what holds them. None
    /// for a call's result, a literal, or anything built from more than one value.
    fn param_root(&self, e: &Expression) -> Option<(String, String)> {
        let mut at = peel(e);
        // The members read on the way down, outermost first.
        let mut keys: Vec<&str> = Vec::new();
        loop {
            at = match at {
                Expression::AwaitExpression(a) => peel(&a.argument),
                Expression::StaticMemberExpression(m) => {
                    match side_key(m.property.name.as_str()) {
                        true => keys.push(m.property.name.as_str()),
                        false => keys.clear(),
                    }
                    peel(&m.object)
                }
                Expression::ComputedMemberExpression(m) => {
                    keys.clear();
                    peel(&m.object)
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        match side_key(m.property.name.as_str()) {
                            true => keys.push(m.property.name.as_str()),
                            false => keys.clear(),
                        }
                        peel(&m.object)
                    }
                    ChainElement::ComputedMemberExpression(m) => {
                        keys.clear();
                        peel(&m.object)
                    }
                    _ => return None,
                },
                Expression::Identifier(id) => {
                    let s = self.symbol_of(id)?;
                    let (name, mut token) = self
                        .flow
                        .own_at
                        .get(&s)
                        .or_else(|| self.param_locals.get(&s))
                        .cloned()?;
                    for k in keys.iter().rev().take(MAX_KEY_DEPTH) {
                        token.push('.');
                        token.push_str(k);
                    }
                    return Some((name, token));
                }
                _ => return None,
            };
        }
    }

    /// What one value handed to a call is ([`RawSymbol::arg_sides`]): a value of
    /// the caller by its own source, a value read off a parameter of the function,
    /// a literal, or what is not read.
    fn arg_side(&self, e: &Expression) -> String {
        if self.taint(e).callers_own() {
            return "caller".to_string();
        }
        match self.param_root(e) {
            Some((name, at)) => format!("param {name} {at}"),
            None if literal_text(peel(e)).is_some()
                || matches!(
                    peel(e),
                    Expression::NumericLiteral(_)
                        | Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                ) =>
            {
                "literal".to_string()
            }
            None => "unread".to_string(),
        }
    }

    /// What an object written in place hands a call under each of its keys
    /// (`list({ userId: user.id, take })`), `under` the argument's position
    /// (`#0.userId`). Nothing of an object a spread or a computed key is written
    /// in: either may put any value under any key.
    fn object_sides(
        &self,
        e: &Expression,
        under: &str,
        depth: usize,
        out: &mut Vec<(String, String)>,
    ) {
        let Expression::ObjectExpression(o) = peel(e) else {
            return;
        };
        let mut found: Vec<(String, String)> = Vec::new();
        for p in &o.properties {
            let ObjectPropertyKind::ObjectProperty(p) = p else {
                return;
            };
            let Some(k) = (!p.computed)
                .then(|| key_name(&p.key))
                .flatten()
                .filter(|k| side_key(k))
            else {
                return;
            };
            let key = format!("{under}.{k}");
            // A key written twice holds what was written last.
            found.retain(|(x, _)| *x != key && !x.starts_with(&format!("{key}.")));
            if matches!(peel(&p.value), Expression::ObjectExpression(_)) {
                if depth + 1 < MAX_KEY_DEPTH {
                    self.object_sides(&p.value, &key, depth + 1, &mut found);
                }
            } else {
                found.push((key, self.arg_side(&p.value)));
            }
        }
        out.extend(found);
    }

    /// What a call hands its callee, argument by argument
    /// ([`RawSymbol::arg_sides`]): a value of the caller by its own source, a value
    /// read off a parameter of the function, a literal, or what is not read.
    fn note_arg_sides(&mut self, callee: &RawRef, it: &CallExpression) {
        let mut given: Vec<(String, String)> = it
            .arguments
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let side = match a.as_expression() {
                    None => "unread".to_string(),
                    Some(e) => self.arg_side(e),
                };
                (format!("#{i}"), side)
            })
            .collect();
        // An object written in place hands on what each of its keys holds.
        let mut keyed = Vec::new();
        for (i, a) in it.arguments.iter().enumerate() {
            if let Some(e) = a.as_expression() {
                self.object_sides(e, &format!("#{i}"), 0, &mut keyed);
            }
        }
        let by_key = !keyed.is_empty();
        given.extend(keyed);
        // A call given nothing but objects, lists and functions written in place
        // hands on no value by position: what it is given is read by its keys.
        let written_in_place = it.arguments.iter().all(|a| {
            matches!(
                a.as_expression().map(peel),
                Some(
                    Expression::ObjectExpression(_)
                        | Expression::ArrayExpression(_)
                        | Expression::ArrowFunctionExpression(_)
                        | Expression::FunctionExpression(_)
                )
            )
        });
        if !given.is_empty()
            && (!written_in_place || by_key)
            && self.arg_sides.len() < MAX_ORDER * 4
        {
            self.arg_sides.insert((callee.clone(), given));
        }
    }

    /// Records the keys of an object given to `callee` whose value is a value of
    /// the caller by its own source ([`RawSymbol::caller_keys`]), by the path
    /// [`Collector::object_keys`] writes.
    fn caller_keys_at(&mut self, callee: &RawRef, e: &Expression, prefix: &str, depth: usize) {
        let Expression::ObjectExpression(o) = unwrap_expr(e) else {
            return;
        };
        for p in &o.properties {
            if let ObjectPropertyKind::ObjectProperty(p) = p
                && !p.computed
                && let Some(k) = p.key.static_name()
                && let Some(k) = k.as_str()
            {
                let key = if prefix.is_empty() {
                    k.to_string()
                } else {
                    format!("{prefix}.{k}")
                };
                if matches!(unwrap_expr(&p.value), Expression::ObjectExpression(_)) {
                    if depth + 1 < MAX_KEY_DEPTH {
                        self.caller_keys_at(callee, &p.value, &key, depth + 1);
                    }
                } else if self.taint(&p.value).callers_own() {
                    self.caller_keys.insert((callee.clone(), key));
                } else if let Some((name, at)) = self.param_root(&p.value) {
                    self.param_keys
                        .insert((callee.clone(), key, format!("param {name} {at}")));
                }
            }
        }
    }

    /// A rejection here would turn the caller away: outside any `catch` clause and
    /// promise callback, and before the function has handed control on.
    fn counting(&self) -> bool {
        self.in_catch == 0 && self.in_callback == 0 && !self.continued
    }

    /// The binding is a local of a function (not a top-level name, which another
    /// file may import) that nothing refers to.
    fn unread_local(&self, id: &BindingIdentifier) -> bool {
        id.symbol_id.get().is_some_and(|sym| {
            let scoping = self.l.scoping;
            scoping.symbol_scope_id(sym) != scoping.root_scope_id()
                && scoping.get_resolved_reference_ids(sym).is_empty()
        })
    }

    /// Why a check here does not run for every request that reaches the function it
    /// is in ([`drift_core::BodyCheck::condition`]); empty where it does.
    fn check_condition(&self) -> &'static str {
        if self.branches > 0 {
            drift_core::not_always::UNDER_BRANCH
        } else if self.served {
            drift_core::not_always::AFTER_CONDITIONAL_RETURN
        } else {
            ""
        }
    }

    /// Why the call that ends at `end` does not run, or does not finish, for every
    /// request that reaches the function it is in ([`drift_core::not_always`]); empty
    /// where it does.
    fn not_always(&self, end: u32) -> &'static str {
        use drift_core::not_always::{AFTER_CONDITIONAL_RETURN, NOT_AWAITED, UNDER_BRANCH};
        if self.branches > 0 || self.in_catch > 0 {
            UNDER_BRANCH
        } else if self.served {
            AFTER_CONDITIONAL_RETURN
        } else if self.dropped.contains(&end) {
            NOT_AWAITED
        } else {
            ""
        }
    }

    fn note(&mut self, r: Option<drift_core::controls::Rejection>) {
        use drift_core::controls::Rejection;
        match r {
            Some(Rejection::Unauthenticated) => {
                self.unauthenticated = true;
                self.unauth_notes += 1;
            }
            Some(Rejection::Forbidden) => self.forbidden = true,
            Some(Rejection::Throttled) | None => {}
        }
    }

    /// What a thrown or returned expression says it rejects the caller as: an error
    /// or response built with 401, 403 or rejection words
    /// (`new TRPCError({ code: "UNAUTHORIZED" })`, `new Error("Unauthorized: ...")`,
    /// `NextResponse.json(body, { status: 401 })`), or a local bound to one. A bare
    /// literal (`return "UNAUTHORIZED"` in a status table) is not one.
    fn rejecting(&self, e: &Expression) -> Option<drift_core::controls::Rejection> {
        match unwrap_expr(e) {
            e @ (Expression::CallExpression(_) | Expression::NewExpression(_)) => {
                rejection_marker(e, 0)
            }
            Expression::Identifier(id) => self.rejection_vars.get(id.name.as_str()).copied(),
            _ => None,
        }
    }

    /// A call that turns the caller away by itself, where it counts: a status setter
    /// with 401 or 403 (`res.status(401)`, `reply.code(403)`), a redirect to a sign-in
    /// page (`redirect("/login")`), or a helper named for it (`redirectToSignIn()`,
    /// `unauthorized()`, `forbidden()`). Rejection words in any other call's arguments
    /// (`console.warn("Unauthorized ...")`) say nothing.
    fn note_rejection(&mut self, callee: &Expression, arguments: &[Argument], end: u32) {
        use drift_core::controls::Rejection;
        if !self.counting() {
            return;
        }
        let name = match unwrap_expr(callee) {
            Expression::Identifier(id) => id.name.as_str(),
            Expression::StaticMemberExpression(m) => m.property.name.as_str(),
            _ => return,
        };
        let first = arguments
            .first()
            .and_then(|a| a.as_expression())
            .map(unwrap_expr);
        let rejection = match name {
            "status" | "sendStatus" | "code" | "writeHead" => match first {
                Some(Expression::NumericLiteral(n)) if n.value.fract() == 0.0 => {
                    drift_core::controls::rejection_status(n.value as u64)
                }
                _ => None,
            },
            "redirect" | "permanentRedirect" => first
                .and_then(literal_text)
                .filter(|t| drift_core::controls::sign_in_target(t))
                .map(|_| Rejection::Unauthenticated),
            "redirectToSignIn" | "redirectToLogin" | "redirectToSignin" | "unauthorized" => {
                Some(Rejection::Unauthenticated)
            }
            "forbidden" => Some(Rejection::Forbidden),
            _ => None,
        };
        self.other_rejection |= rejection == Some(Rejection::Unauthenticated);
        self.note(rejection);
        // A function of the repository named `unauthorized()` that the body calls as
        // a statement of its own refuses no one by that call: the answer goes on.
        if rejection == Some(Rejection::Unauthenticated)
            && matches!(name, "unauthorized" | "forbidden")
            && !self.named_refusal(callee)
            && self.dropped.contains(&end)
        {
            self.unauth_goes_on += 1;
            // What a method of a class of the repository does, called under a
            // condition on the caller, is read through its class: not a refusal the
            // call makes, and not nothing.
            if matches!(unwrap_expr(callee), Expression::StaticMemberExpression(_))
                && !matches!(
                    self.l.canon_callee(callee),
                    Some(RawRef { base: RawBase::Import { name, .. }, .. }) if name == "*"
                )
                && self.fn_depth <= 1
            {
                let gate = self.gate();
                self.note_unread_exit(None, &gate);
            }
        }
    }

    /// A call of a function named `unauthorized` or `forbidden` is the refusal its
    /// name says only where the callee is a package's (`unauthorized()` of
    /// `next/navigation`, `reply.unauthorized()`, `Boom.unauthorized()`) or nothing
    /// the file binds: a function of the repository (imported, a static of one of its
    /// classes, a member of its object) goes through linking, and a dropped call of
    /// one that only builds a response refuses no one.
    fn named_refusal(&self, callee: &Expression) -> bool {
        let package = |spec: &str| {
            spec.starts_with("next/")
                || matches!(
                    spec,
                    "next"
                        | "@hapi/boom"
                        | "boom"
                        | "http-errors"
                        | "@fastify/sensible"
                        | "fastify-sensible"
                        | "@nestjs/common"
                )
        };
        let of = |base: Option<RawBase>| match base {
            Some(RawBase::Import { spec, .. }) => package(&spec),
            Some(RawBase::Local(_)) => false,
            _ => true,
        };
        match unwrap_expr(callee) {
            Expression::Identifier(id) => of(self.l.resolve_ident(id)),
            Expression::StaticMemberExpression(m) => {
                let mut root = unwrap_expr(&m.object);
                while let Expression::StaticMemberExpression(inner) = root {
                    root = unwrap_expr(&inner.object);
                }
                match root {
                    Expression::Identifier(id) => of(self.l.resolve_ident(id)),
                    _ => true,
                }
            }
            _ => true,
        }
    }
}

/// Calls that hand control on to what a middleware or wrapper guards: tRPC's and
/// Express's `next()`, a wrapper's `handler()`, Fastify's `done()`.
const CONTINUATIONS: &[&str] = &[
    "next",
    "handler",
    "done",
    "callback",
    "cb",
    "fn",
    "func",
    "wrapped",
    "nextHandler",
    "routeHandler",
];

impl Collector<'_, '_> {
    /// The call hands control on: the continuation a middleware receives, under any
    /// local name (`({ next: go })` then `go()`, `(req, res, next)`), `opts.next()` or
    /// `opts["next"]()`, or a name that says so ([`CONTINUATIONS`]: `handler(req)`).
    fn continues(&self, callee: &Expression) -> bool {
        match unwrap_expr(callee) {
            Expression::Identifier(id) => {
                let name = id.name.as_str();
                CONTINUATIONS.contains(&name)
                    || self
                        .continuation_names
                        .iter()
                        .any(|f| f.iter().any(|n| n == name))
            }
            // `app.handle(req, res)`, where `app` is what the listener hands on to.
            Expression::StaticMemberExpression(m) if m.property.name == "handle" => {
                matches!(unwrap_expr(&m.object), Expression::Identifier(id)
                    if self.continuation_names.iter().any(|f| f.iter().any(|n| n == id.name.as_str())))
            }
            Expression::StaticMemberExpression(m) => m.property.name == "next",
            Expression::ComputedMemberExpression(m) => {
                matches!(&m.expression, Expression::StringLiteral(l) if l.value == "next")
            }
            _ => false,
        }
    }

    /// The expression calls the continuation or uses what it handed back
    /// (`await next()`, `r.data` for `const r = await next()`).
    fn mentions_continuation(&self, e: &Expression, depth: usize) -> bool {
        if depth > 6 {
            return false;
        }
        let e = unwrap_expr(e);
        let arg = |a: &Argument| {
            a.as_expression()
                .is_some_and(|x| self.mentions_continuation(x, depth + 1))
        };
        match e {
            Expression::Identifier(id) => self.continuation_vars.contains(id.name.as_str()),
            Expression::CallExpression(c) => {
                self.continues(&c.callee)
                    || self.mentions_continuation(&c.callee, depth + 1)
                    || c.arguments.iter().any(arg)
            }
            Expression::NewExpression(n) => n.arguments.iter().any(arg),
            Expression::AwaitExpression(a) => self.mentions_continuation(&a.argument, depth + 1),
            Expression::StaticMemberExpression(m) => {
                self.mentions_continuation(&m.object, depth + 1)
            }
            Expression::ComputedMemberExpression(m) => {
                self.mentions_continuation(&m.object, depth + 1)
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::CallExpression(c) => {
                    self.continues(&c.callee)
                        || self.mentions_continuation(&c.callee, depth + 1)
                        || c.arguments.iter().any(arg)
                }
                m => m
                    .as_member_expression()
                    .is_some_and(|m| self.mentions_continuation(m.object(), depth + 1)),
            },
            Expression::ConditionalExpression(c) => {
                self.mentions_continuation(&c.consequent, depth + 1)
                    || self.mentions_continuation(&c.alternate, depth + 1)
            }
            Expression::LogicalExpression(l) => {
                self.mentions_continuation(&l.left, depth + 1)
                    || self.mentions_continuation(&l.right, depth + 1)
            }
            Expression::ObjectExpression(o) => o.properties.iter().any(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => {
                    self.mentions_continuation(&p.value, depth + 1)
                }
                ObjectPropertyKind::SpreadProperty(s) => {
                    self.mentions_continuation(&s.argument, depth + 1)
                }
            }),
            Expression::ArrayExpression(a) => a
                .elements
                .iter()
                .filter_map(|x| x.as_expression())
                .any(|x| self.mentions_continuation(x, depth + 1)),
            _ => false,
        }
    }
}

/// The local names a function's parameters bind its continuation to: the `next`
/// property destructured under any alias (`({ ctx, next: go })`), and the positional
/// continuation of an Express or Koa signature (`(req, res, next)`,
/// `(err, req, res, next)`, `(ctx, next)`).
fn continuation_params(params: &FormalParameters) -> Vec<String> {
    fn ident(p: &BindingPattern) -> Option<String> {
        match p {
            BindingPattern::BindingIdentifier(b) => Some(b.name.to_string()),
            BindingPattern::AssignmentPattern(a) => ident(&a.left),
            _ => None,
        }
    }
    let mut out = Vec::new();
    for item in &params.items {
        if let BindingPattern::ObjectPattern(o) = &item.pattern {
            for p in &o.properties {
                if !p.computed
                    && p.key.static_name().is_some_and(|k| k == "next")
                    && let Some(n) = ident(&p.value)
                {
                    out.push(n);
                }
            }
        }
    }
    let names: Vec<Option<String>> = params.items.iter().map(|i| ident(&i.pattern)).collect();
    let koa = names.len() == 2
        && names[0]
            .as_deref()
            .is_some_and(|n| matches!(n, "ctx" | "context" | "c"));
    if (names.len() == 3 || names.len() == 4 || koa)
        && let Some(Some(last)) = names.last()
    {
        out.push(last.clone());
    }
    out
}

/// `if (<name>) return <name>;`, with the test also written `<name> instanceof
/// Response`, `<name> != null` or `<name> !== undefined`: the value itself (""). And
/// `if (<name>.error) return <name>.error;`, the test also written `"error" in
/// <name>`: the member (`.error`). None for any other statement.
fn returns_when_set(i: &IfStatement, name: &str) -> Option<String> {
    let is =
        |e: &Expression| matches!(unwrap_expr(e), Expression::Identifier(id) if id.name == name);
    let member = |e: &Expression| -> Option<String> {
        let m = match unwrap_expr(e) {
            Expression::StaticMemberExpression(m) => m,
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => m,
                _ => return None,
            },
            _ => return None,
        };
        is(&m.object).then(|| format!(".{}", m.property.name))
    };
    let returned = match &i.consequent {
        Statement::ReturnStatement(r) => r.argument.as_ref()?,
        Statement::BlockStatement(b) => match b.body.as_slice() {
            [Statement::ReturnStatement(r)] => r.argument.as_ref()?,
            _ => return None,
        },
        _ => return None,
    };
    let empty = |e: &Expression| match unwrap_expr(e) {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(id) => id.name == "undefined",
        _ => false,
    };
    match unwrap_expr(&i.test) {
        t if is(t) => is(returned).then(String::new),
        Expression::BinaryExpression(b)
            if b.operator == BinaryOperator::Instanceof && is(&b.left) =>
        {
            is(returned).then(String::new)
        }
        Expression::BinaryExpression(b)
            if matches!(
                b.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            ) && is(&b.left)
                && empty(&b.right) =>
        {
            is(returned).then(String::new)
        }
        Expression::BinaryExpression(b) if b.operator == BinaryOperator::In && is(&b.right) => {
            let key = match unwrap_expr(&b.left) {
                Expression::StringLiteral(l) => format!(".{}", lit(l)),
                _ => return None,
            };
            (member(returned).as_ref() == Some(&key)).then_some(key)
        }
        t => {
            let key = member(t)?;
            (member(returned).as_ref() == Some(&key)).then_some(key)
        }
    }
}

/// The statement always leaves the function: it returns or throws, or every branch
/// of it does.
fn leaves(s: &Statement) -> bool {
    match s {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(b) => b.body.last().is_some_and(leaves),
        Statement::IfStatement(i) => {
            leaves(&i.consequent) && i.alternate.as_ref().is_some_and(leaves)
        }
        _ => false,
    }
}

/// The text of a string or a template literal without expressions.
fn literal_text(e: &Expression) -> Option<String> {
    match e {
        Expression::StringLiteral(s) => Some(s.value.display().to_string()),
        Expression::TemplateLiteral(t) => Some(
            t.quasis
                .iter()
                .map(|q| q.value.raw.as_str())
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    }
}

/// A call that documents responses (OpenAPI / Swagger), never sends one: Nest
/// `applyDecorators(...)` and the `@nestjs/swagger` `Api*Response(s)` decorators,
/// `@hono/zod-openapi` `createRoute`, `hono-openapi` `describeRoute`, zod-to-openapi
/// `registerPath`.
fn describes_responses(callee: &Expression) -> bool {
    call_name(callee).is_some_and(|n| {
        matches!(
            n,
            "applyDecorators" | "createRoute" | "describeRoute" | "registerPath"
        ) || (n.starts_with("Api") && (n.ends_with("Response") || n.ends_with("Responses")))
    })
}

/// What an argument says the caller is turned away as: 401, 403 or 429, rejection words
/// ([`drift_core::controls::rejection_text`]), or a status constant named for it
/// (`HttpStatus.UNAUTHORIZED`), at any depth of its object literals, arrays and the
/// arguments of the calls it makes (`new TRPCError({ code: "UNAUTHORIZED" })`,
/// `NextResponse.json(body, { status: 401 })`). A rate limit anywhere in it wins
/// (`new TRPCError({ code: "FORBIDDEN", message: "Too many requests" })`).
fn rejection_marker(e: &Expression, depth: usize) -> Option<drift_core::controls::Rejection> {
    use drift_core::controls::{
        Rejection, rejection_status, rejection_status_name, rejection_text,
    };
    const MAX_DEPTH: usize = 4;
    if depth > MAX_DEPTH {
        return None;
    }
    let e = unwrap_expr(e);
    if let Some(t) = literal_text(e) {
        return rejection_text(&t);
    }
    // A status in API documentation describes a response; it turns no one away.
    match e {
        Expression::CallExpression(c) if describes_responses(&c.callee) => return None,
        Expression::NewExpression(n) if describes_responses(&n.callee) => return None,
        _ => {}
    }
    let all = |it: &mut dyn Iterator<Item = &Expression>| {
        it.fold(None, |acc, x| {
            Rejection::combine(acc, rejection_marker(x, depth + 1))
        })
    };
    match e {
        Expression::NumericLiteral(n) if n.value.fract() == 0.0 && n.value >= 0.0 => {
            rejection_status(n.value as u64)
        }
        Expression::StaticMemberExpression(m) => rejection_status_name(m.property.name.as_str()),
        Expression::ObjectExpression(o) => all(&mut o.properties.iter().filter_map(|p| match p {
            // `responses: { 401: ... }`, a Fastify `response:` / `schema:` option.
            ObjectPropertyKind::ObjectProperty(p)
                if key_name(&p.key)
                    .is_some_and(|k| matches!(k.as_str(), "responses" | "response" | "schema")) =>
            {
                None
            }
            ObjectPropertyKind::ObjectProperty(p) => Some(&p.value),
            ObjectPropertyKind::SpreadProperty(_) => None,
        })),
        Expression::ArrayExpression(a) => {
            all(&mut a.elements.iter().filter_map(|x| x.as_expression()))
        }
        Expression::ConditionalExpression(c) => all(&mut [&c.consequent, &c.alternate].into_iter()),
        Expression::CallExpression(c) => {
            all(&mut c.arguments.iter().filter_map(|a| a.as_expression()))
        }
        Expression::NewExpression(n) => {
            all(&mut n.arguments.iter().filter_map(|a| a.as_expression()))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------- practice facts

/// The methods of an array (or of a set, a map, an iterator) that call the function
/// they are given once per element: zero times for none.
const ELEMENT_METHODS: &[&str] = &[
    "forEach",
    "map",
    "flatMap",
    "filter",
    "some",
    "every",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "reduce",
    "reduceRight",
];

/// Data libraries a repository may register code with that runs on the queries
/// they make, below any one query ([`Lowerer::orm_registration`]). A closed list;
/// a package and its subpaths.
///
/// Prisma (whose filters are `$extends` / `$use`, read as calls), Drizzle, Knex
/// and Objection take no such key.
const ORM_PACKAGES: &[&str] = &[
    "@mikro-orm",
    "typeorm",
    "@nestjs/typeorm",
    "sequelize",
    "sequelize-typescript",
    "@nestjs/sequelize",
    "mongoose",
    "@nestjs/mongoose",
    "@typegoose/typegoose",
    "kysely",
];

/// The keys of a data library's configuration that register code it runs on the
/// queries ([`Lowerer::orm_registration`]).
const ORM_REGISTRATION_KEYS: &[&str] = &[
    "filters",
    "plugins",
    "hooks",
    "subscribers",
    "extensions",
    "middleware",
    "middlewares",
    "defaultScope",
    "scopes",
];

/// The classes a program declares at its top level, by name: `class X`, `export
/// class X`, `export default class X`, `const X = class { ... }`.
fn top_level_classes(program: &Program) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for stmt in &program.body {
        let decl = match stmt {
            Statement::ExportDeclaration(e) => Some(&e.declaration),
            Statement::ExportDefaultDeclaration(e) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(c) = &e.declaration
                    && let Some(id) = &c.id
                {
                    out.insert(id.name.to_string());
                }
                None
            }
            s => s.as_declaration(),
        };
        match decl {
            Some(Declaration::ClassDeclaration(c)) => {
                if let Some(id) = &c.id {
                    out.insert(id.name.to_string());
                }
            }
            Some(Declaration::VariableDeclaration(v)) => {
                for d in &v.declarations {
                    if let BindingPattern::BindingIdentifier(b) = &d.id
                        && matches!(
                            d.init.as_ref().map(unwrap_expr),
                            Some(Expression::ClassExpression(_))
                        )
                    {
                        out.insert(b.name.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// [`drift_core::BodyCheck::op`] of a branch taken on the answer of a compare that is
/// true where the two values match: through a `!` (or in the `else`) the caller is
/// turned away where they differ, else where they match.
fn compare_op(negated: bool) -> &'static str {
    if negated {
        drift_core::check_op::REFUSES_MISMATCH
    } else {
        drift_core::check_op::REFUSES_MATCH
    }
}

/// The value a condition reads is the answer of a constant-time compare
/// (`crypto.timingSafeEqual`).
fn is_compare(source: &RawOperand) -> bool {
    matches!(source, RawOperand::Ref(r)
        if matches!(&r.base, RawBase::Import { name, .. } if name == "timingSafeEqual")
            || r.member.ends_with(".timingSafeEqual")
            || matches!(&r.base, RawBase::Local(n) if n == "timingSafeEqual"))
}

/// The names a program binds at its top level to a number a status can be
/// (`const UNAUTH = 401`, `export const FORBIDDEN = 403`).
fn status_consts(program: &Program) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut take = |v: &VariableDeclaration| {
        for d in &v.declarations {
            if let BindingPattern::BindingIdentifier(b) = &d.id
                && let Some(Expression::NumericLiteral(n)) = d.init.as_ref().map(unwrap_expr)
                && n.value.fract() == 0.0
                && (100.0..=599.0).contains(&n.value)
            {
                out.insert(b.name.to_string());
            }
        }
    };
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(v) => take(v),
            Statement::ExportDeclaration(e) => {
                if let Declaration::VariableDeclaration(v) = &e.declaration {
                    take(v);
                }
            }
            _ => {}
        }
    }
    out
}

/// The functions of a program declared at its top level that are refusal builders
/// ([`RawSymbol::refusal_builder`]): every value they hand back (each `return`'s,
/// or an arrow's expression body) is a 401 or 403 response built as a value
/// (`NextResponse.json(body, { status: 401 })`, `Response.json(...)`, `new
/// Response(body, { status: 403 })`, `new NextResponse(...)`), all of one status,
/// and they hand back nothing else. By name.
fn refusal_builders(program: &Program) -> HashMap<String, drift_core::CheckOutcome> {
    /// The status of a response built as a value, where it is a literal.
    fn built_status(e: &Expression) -> Option<u16> {
        let (callee, args, is_new) = match peel(e) {
            Expression::CallExpression(c) => (&c.callee, &c.arguments, false),
            Expression::NewExpression(n) => (&n.callee, &n.arguments, true),
            _ => return None,
        };
        let named = match unwrap_expr(callee) {
            Expression::Identifier(id) if is_new => {
                matches!(id.name.as_str(), "Response" | "NextResponse")
            }
            Expression::StaticMemberExpression(m) if !is_new => {
                m.property.name == "json"
                    && matches!(unwrap_expr(&m.object), Expression::Identifier(o)
                        if matches!(o.name.as_str(), "Response" | "NextResponse"))
            }
            _ => false,
        };
        if !named {
            return None;
        }
        let Some(Expression::ObjectExpression(init)) =
            args.get(1).and_then(|a| a.as_expression()).map(unwrap_expr)
        else {
            return None;
        };
        routes::object_prop(init, "status").and_then(literal_status)
    }
    /// Every value a body hands back at its own level; `bare` where it may end
    /// without one or leave otherwise.
    fn returns<'b, 'a>(s: &'b Statement<'a>, found: &mut Vec<&'b Expression<'a>>, bare: &mut bool) {
        match s {
            Statement::ReturnStatement(r) => match &r.argument {
                Some(a) => found.push(a),
                None => *bare = true,
            },
            Statement::BlockStatement(b) => b.body.iter().for_each(|s| returns(s, found, bare)),
            Statement::IfStatement(i) => {
                returns(&i.consequent, found, bare);
                if let Some(a) = &i.alternate {
                    returns(a, found, bare);
                }
            }
            Statement::TryStatement(t) => {
                t.block.body.iter().for_each(|s| returns(s, found, bare));
                if let Some(h) = &t.handler {
                    h.body.body.iter().for_each(|s| returns(s, found, bare));
                }
                if let Some(f) = &t.finalizer {
                    f.body.iter().for_each(|s| returns(s, found, bare));
                }
            }
            Statement::ThrowStatement(_)
            | Statement::SwitchStatement(_)
            | Statement::ForStatement(_)
            | Statement::ForInStatement(_)
            | Statement::ForOfStatement(_)
            | Statement::WhileStatement(_)
            | Statement::DoWhileStatement(_) => *bare = true,
            _ => {}
        }
    }
    fn outcome(values: &[&Expression], bare: bool) -> Option<drift_core::CheckOutcome> {
        if bare || values.is_empty() {
            return None;
        }
        let statuses: Vec<Option<u16>> = values.iter().map(|v| built_status(v)).collect();
        let first = statuses.first().copied().flatten()?;
        if matches!(first, 401 | 403) && statuses.iter().all(|s| *s == Some(first)) {
            status_outcome(first)
        } else {
            None
        }
    }
    fn of_body(body: &FunctionBody) -> Option<drift_core::CheckOutcome> {
        let (mut found, mut bare) = (Vec::new(), false);
        body.statements
            .iter()
            .for_each(|s| returns(s, &mut found, &mut bare));
        // A body that can end without a `return` hands back `undefined` too.
        if !matches!(body.statements.last(), Some(Statement::ReturnStatement(_))) {
            bare = true;
        }
        outcome(&found, bare)
    }
    let mut out = HashMap::new();
    let mut consts = Vec::new();
    for stmt in &program.body {
        let f = match stmt {
            Statement::FunctionDeclaration(f) => Some(&**f),
            Statement::VariableDeclaration(v) => {
                consts.push(&**v);
                None
            }
            Statement::ExportDeclaration(e) => match &e.declaration {
                Declaration::FunctionDeclaration(f) => Some(&**f),
                Declaration::VariableDeclaration(v) => {
                    consts.push(&**v);
                    None
                }
                _ => None,
            },
            _ => None,
        };
        if let Some(f) = f
            && let (Some(n), Some(body)) = (&f.id, &f.body)
            && let Some(o) = of_body(body)
        {
            out.insert(n.name.to_string(), o);
        }
    }
    for v in consts {
        for d in &v.declarations {
            let BindingPattern::BindingIdentifier(b) = &d.id else {
                continue;
            };
            let o = match d.init.as_ref().map(unwrap_expr) {
                Some(Expression::ArrowFunctionExpression(a)) => match &a.body {
                    ArrowFunctionBody::FunctionBody(b) => of_body(b),
                    other => other.as_expression().and_then(|x| outcome(&[x], false)),
                },
                Some(Expression::FunctionExpression(f)) => f.body.as_deref().and_then(of_body),
                _ => None,
            };
            if let Some(o) = o {
                out.insert(b.name.to_string(), o);
            }
        }
    }
    out
}

/// The functions of a program declared at its top level that hand back a Promise
/// ([`Lowerer::async_fns`]).
fn async_functions(program: &Program) -> HashSet<SymbolId> {
    let mut out = HashSet::new();
    let mut function = |f: &Function| {
        if (f.r#async || returns_promise(f.return_type.as_deref()))
            && let Some(s) = f.id.as_ref().and_then(|i| i.symbol_id.get())
        {
            out.insert(s);
        }
    };
    let mut consts = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::FunctionDeclaration(f) => function(f),
            Statement::VariableDeclaration(v) => consts.push(&**v),
            Statement::ExportNamedDeclaration(_) => {}
            Statement::ExportDeclaration(e) => match &e.declaration {
                Declaration::FunctionDeclaration(f) => function(f),
                Declaration::VariableDeclaration(v) => consts.push(&**v),
                _ => {}
            },
            _ => {}
        }
    }
    for v in consts {
        for d in &v.declarations {
            let promised = match d.init.as_ref().map(unwrap_expr) {
                Some(Expression::ArrowFunctionExpression(a)) => {
                    a.r#async || returns_promise(a.return_type.as_deref())
                }
                Some(Expression::FunctionExpression(f)) => {
                    f.r#async || returns_promise(f.return_type.as_deref())
                }
                _ => false,
            };
            if promised
                && let BindingPattern::BindingIdentifier(b) = &d.id
                && let Some(s) = b.symbol_id.get()
            {
                out.insert(s);
            }
        }
    }
    out
}

/// Parentheses, TypeScript wrappers and `await` stripped.
fn peel<'b, 'a>(mut e: &'b Expression<'a>) -> &'b Expression<'a> {
    loop {
        e = unwrap_expr(e);
        match e {
            Expression::AwaitExpression(a) => e = &a.argument,
            _ => return e,
        }
    }
}

/// One operand of a check's condition ([`Collector::condition`]): the value read, its
/// member path, what it is compared with, how, and the other operands of the `&&` it
/// stands in. The second of the compared pair is the member path read off it.
type CheckOperand = (
    RawOperand,
    String,
    (RawOperand, String),
    &'static str,
    Option<String>,
);

/// The operands of an effective `&&`, each with whether the condition tests its
/// negation: `a && !b`, and `!(a || b)`, which is `!a && !b`. One operand, the
/// expression itself, for any other condition.
fn and_operands<'b, 'a>(
    e: &'b Expression<'a>,
    negated: bool,
    depth: usize,
    out: &mut Vec<(&'b Expression<'a>, bool)>,
) {
    let e = peel(e);
    match e {
        Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot && depth < 8 => {
            and_operands(&u.argument, !negated, depth + 1, out)
        }
        Expression::LogicalExpression(l)
            if (l.operator == LogicalOperator::And) != negated
                && l.operator != LogicalOperator::Coalesce
                && depth < 8 =>
        {
            and_operands(&l.left, negated, depth + 1, out);
            and_operands(&l.right, negated, depth + 1, out);
        }
        _ => out.push((e, negated)),
    }
}

/// The role tests of a condition that refuses a caller unless a role or one
/// comparison holds ([`drift_core::not_always::ROLE_ALTERNATIVE`]): an effective
/// `&&` every operand of which but one tests that a member is not set or is not a
/// literal (`!user.isAdmin`, `user.role !== "admin"`), the one left being a
/// comparison of two values. Each role test by the member it reads. None for any
/// other condition. `otherwise`: the refusal is in the `else`, so the condition
/// refuses where it does not hold.
fn role_alternatives<'b, 'a>(
    test: &'b Expression<'a>,
    otherwise: bool,
) -> Option<Vec<&'b Expression<'a>>> {
    let mut operands = Vec::new();
    and_operands(test, otherwise, 0, &mut operands);
    if operands.len() < 2 {
        return None;
    }
    let member = |e: &Expression| match peel(e) {
        Expression::StaticMemberExpression(_) => true,
        Expression::ChainExpression(c) => {
            matches!(c.expression, ChainElement::StaticMemberExpression(_))
        }
        _ => false,
    };
    let text = |e: &Expression| matches!(peel(e), Expression::StringLiteral(_));
    let role = |(e, negated): &(&'b Expression<'a>, bool)| -> Option<&'b Expression<'a>> {
        match e {
            e if member(e) && *negated => Some(*e),
            Expression::BinaryExpression(b) if b.operator.is_equality() => {
                let equal = matches!(
                    b.operator,
                    BinaryOperator::StrictEquality | BinaryOperator::Equality
                );
                let read = match (
                    member(&b.left),
                    text(&b.right),
                    member(&b.right),
                    text(&b.left),
                ) {
                    (true, true, _, _) => &b.left,
                    (_, _, true, true) => &b.right,
                    _ => return None,
                };
                // Refused where the member is not the literal.
                (equal == *negated).then_some(read)
            }
            _ => None,
        }
    };
    let roles: Vec<&Expression> = operands.iter().filter_map(role).collect();
    let rest: Vec<&(&Expression, bool)> = operands.iter().filter(|o| role(o).is_none()).collect();
    let comparison = |e: &Expression| {
        matches!(e, Expression::BinaryExpression(b)
            if b.operator.is_equality() && !text(&b.left) && !text(&b.right))
    };
    (!roles.is_empty() && rest.len() == 1 && comparison(rest[0].0)).then_some(roles)
}

/// At most [`drift_core::not_always::MAX_WORDS`] characters.
fn clip_words(s: String) -> String {
    let max = drift_core::not_always::MAX_WORDS;
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('\u{2026}');
    out
}

/// An expression in the code's own words, for saying when a check runs: names, member
/// paths and operators. A string is written `"..."` (literals are not echoed), as are
/// a number and a call's arguments.
fn words(e: &Expression) -> String {
    fn go(e: &Expression, depth: usize) -> String {
        if depth > 6 {
            return "...".to_string();
        }
        match peel(e) {
            Expression::Identifier(id) => id.name.to_string(),
            Expression::ThisExpression(_) => "this".to_string(),
            Expression::NullLiteral(_) => "null".to_string(),
            Expression::BooleanLiteral(b) => b.value.to_string(),
            Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => "\"...\"".to_string(),
            Expression::StaticMemberExpression(m) => {
                format!("{}.{}", go(&m.object, depth + 1), m.property.name)
            }
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => {
                    format!("{}.{}", go(&m.object, depth + 1), m.property.name)
                }
                ChainElement::CallExpression(c) => format!("{}(...)", go(&c.callee, depth + 1)),
                _ => "...".to_string(),
            },
            Expression::CallExpression(c) => format!("{}(...)", go(&c.callee, depth + 1)),
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                format!("!{}", go(&u.argument, depth + 1))
            }
            Expression::LogicalExpression(l) => format!(
                "({} {} {})",
                go(&l.left, depth + 1),
                l.operator.as_str(),
                go(&l.right, depth + 1)
            ),
            Expression::BinaryExpression(b)
                if b.operator.is_equality() || b.operator.is_compare() =>
            {
                format!(
                    "{} {} {}",
                    go(&b.left, depth + 1),
                    b.operator.as_str(),
                    go(&b.right, depth + 1)
                )
            }
            _ => "...".to_string(),
        }
    }
    clip_words(go(e, 0))
}

/// The functions an object or array literal holds as values, by where they start
/// (`{ GET: () => ..., remove() {...} }`, `[first, () => ...]`), through the
/// literals inside it.
fn kept_functions(e: &Expression, out: &mut Vec<u32>, depth: usize) {
    if depth > MAX_KEY_DEPTH {
        return;
    }
    let value = |v: &Expression, out: &mut Vec<u32>| match unwrap_expr(v) {
        f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
            out.push(f.span().start);
        }
        v => kept_functions(v, out, depth + 1),
    };
    match unwrap_expr(e) {
        Expression::ObjectExpression(o) => {
            for p in &o.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = p {
                    value(&p.value, out);
                }
            }
        }
        Expression::ArrayExpression(a) => {
            for el in &a.elements {
                if let Some(v) = el.as_expression() {
                    value(v, out);
                }
            }
        }
        _ => {}
    }
}

/// The name a call is made by: the identifier, or the last member.
fn call_name<'b>(callee: &'b Expression) -> Option<&'b str> {
    match unwrap_expr(callee) {
        Expression::Identifier(id) => Some(id.name.as_str()),
        Expression::StaticMemberExpression(m) => Some(m.property.name.as_str()),
        Expression::ChainExpression(c) => match &c.expression {
            ChainElement::StaticMemberExpression(m) => Some(m.property.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

/// An HTTP status a literal or a named constant says: `401`, `HttpStatus.NOT_FOUND`,
/// `StatusCodes.FORBIDDEN`, `status.HTTP_404_NOT_FOUND`.
fn literal_status(e: &Expression) -> Option<u16> {
    match unwrap_expr(e) {
        Expression::NumericLiteral(n)
            if n.value.fract() == 0.0 && (100.0..=599.0).contains(&n.value) =>
        {
            Some(n.value as u16)
        }
        Expression::StaticMemberExpression(m) => status_name(m.property.name.as_str()),
        _ => None,
    }
}

/// The status a constant's name says (`NOT_FOUND`, `HTTP_404_NOT_FOUND`).
fn status_name(name: &str) -> Option<u16> {
    if let Some(rest) = name.strip_prefix("HTTP_")
        && let Some(code) = rest.get(..3)
        && let Ok(n) = code.parse::<u16>()
        && (100..=599).contains(&n)
    {
        return Some(n);
    }
    match name {
        "OK" => Some(200),
        "CREATED" => Some(201),
        "NO_CONTENT" => Some(204),
        "UNPROCESSABLE_ENTITY" => Some(422),
        n => drift_core::practice::trpc_status(n),
    }
}

/// The status an object literal of options says: `{ status: 401 }`,
/// `{ statusCode: 404 }`, `{ code: "NOT_FOUND" }` (tRPC).
fn options_status(o: &ObjectExpression) -> Option<u16> {
    o.properties.iter().find_map(|p| {
        let ObjectPropertyKind::ObjectProperty(p) = p else {
            return None;
        };
        match p.key.static_name()?.as_str()? {
            "status" | "statusCode" => literal_status(&p.value),
            "code" => match unwrap_expr(&p.value) {
                Expression::StringLiteral(l) => drift_core::practice::trpc_status(&lit(l)),
                v => literal_status(v),
            },
            _ => None,
        }
    })
}

/// Top-level keys of an object literal (the first argument, or what
/// `JSON.stringify(...)` is given), sorted.
fn body_keys(e: Option<&Expression>) -> Vec<String> {
    let Some(e) = e.map(peel) else {
        return vec![];
    };
    let e = match e {
        Expression::CallExpression(c)
            if call_name(&c.callee) == Some("stringify") && !c.arguments.is_empty() =>
        {
            match c.arguments[0].as_expression() {
                Some(x) => peel(x),
                None => return vec![],
            }
        }
        e => e,
    };
    let Expression::ObjectExpression(o) = e else {
        return vec![];
    };
    let mut keys: Vec<String> = o
        .properties
        .iter()
        .filter_map(|p| match p {
            ObjectPropertyKind::ObjectProperty(p) if !p.computed => key_name(&p.key),
            _ => None,
        })
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

/// Methods that send a response on a response object or builder.
const RESPONSE_METHODS: &[&str] = &[
    "json",
    "send",
    "text",
    "html",
    "body",
    "redirect",
    "sendStatus",
    "end",
    "sendFile",
];
/// Receivers named for a response or a request context (Express `res`, Fastify
/// `reply`, Hono `c`, Koa `ctx`, hapi `h`).
const RESPONSE_RECEIVERS: &[&str] = &["res", "response", "reply", "c", "ctx", "context", "h"];
/// Methods that set a response status.
const STATUS_SETTERS: &[&str] = &["status", "code", "sendStatus", "writeHead"];
/// Calls that report an error to a tracker (`report:<canonical>`).
const REPORT_CALLS: &[&str] = &[
    "captureException",
    "captureError",
    "captureMessage",
    "reportError",
    "trackException",
    "recordException",
];
/// Header-reading methods on a headers object (`req.headers.get(...)`).
const HEADER_GETTERS: &[&str] = &["get", "has"];
/// Members of a headers object that are methods, not header names.
const HEADER_METHODS: &[&str] = &[
    "get",
    "has",
    "set",
    "append",
    "delete",
    "forEach",
    "entries",
    "keys",
    "values",
    "getSetCookie",
];
/// Validation methods whose receiver is the schema (`Schema.parse(body)`).
const SCHEMA_METHODS: &[&str] = &[
    "parse",
    "safeParse",
    "parseAsync",
    "safeParseAsync",
    "validate",
    "validateSync",
    "validateAsync",
    "cast",
];

/// What [`Collector::throws_for_no_caller`] found of an `if`.
enum NoCaller {
    /// The value tested says who calls: whether the `else` is the branch that
    /// throws.
    Own(bool),
    /// The value tested is what one of these callees, given the request, handed
    /// back.
    Given(Vec<RawRef>),
}

/// The outcome a status says for a caller check.
fn status_outcome(s: u16) -> Option<drift_core::CheckOutcome> {
    use drift_core::CheckOutcome;
    match s {
        401 => Some(CheckOutcome::Unauthenticated),
        403 => Some(CheckOutcome::Forbidden),
        404 => Some(CheckOutcome::NotFound),
        429 => Some(CheckOutcome::Throttled),
        _ => None,
    }
}

fn rejection_outcome(r: drift_core::controls::Rejection) -> drift_core::CheckOutcome {
    use drift_core::{CheckOutcome, controls::Rejection};
    match r {
        Rejection::Unauthenticated => CheckOutcome::Unauthenticated,
        Rejection::Forbidden => CheckOutcome::Forbidden,
        Rejection::Throttled => CheckOutcome::Throttled,
    }
}

/// A redirect target that names a sign-in page: `"/login"`, `` `/sign-in?next=${x}` ``,
/// `new URL("/login", req.url)`.
fn sign_in_arg(e: Option<&Expression>) -> bool {
    let Some(e) = e.map(peel) else {
        return false;
    };
    if let Some(t) = literal_text(e) {
        return drift_core::controls::sign_in_target(&t);
    }
    match e {
        Expression::NewExpression(n) => {
            sign_in_arg(n.arguments.first().and_then(|a| a.as_expression()))
        }
        _ => false,
    }
}

/// An environment variable name that may be recorded from a string literal: what
/// `process.env.NAME` could spell.
fn env_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        && !s.as_bytes()[0].is_ascii_digit()
}

/// A route written as a string or template literal: literal parts kept, each
/// placeholder as `{name}` (its identifier or last member, else `param`).
pub(crate) fn route_text(e: &Expression) -> Option<String> {
    match unwrap_expr(e) {
        Expression::StringLiteral(l) => Some(lit(l)),
        Expression::TemplateLiteral(t) => {
            let mut out = String::new();
            for (i, q) in t.quasis.iter().enumerate() {
                out.push_str(q.value.raw.as_str());
                if let Some(x) = t.expressions.get(i) {
                    let name = match unwrap_expr(x) {
                        Expression::Identifier(id) => id.name.as_str(),
                        Expression::StaticMemberExpression(m) => m.property.name.as_str(),
                        _ => "param",
                    };
                    out.push('{');
                    out.push_str(name);
                    out.push('}');
                }
            }
            Some(out)
        }
        _ => None,
    }
}

/// The path of a URL written in a test or a mock: `/api/x`, `http://localhost:3000/api/x`,
/// `` `${baseUrl}/api/x` `` (a leading placeholder is the origin), `*/api/x`.
fn url_path(e: &Expression) -> Option<String> {
    let t = route_text(e)?;
    let t = t.trim_start_matches('*');
    let t = if let Some(rest) = t
        .strip_prefix("http://")
        .or_else(|| t.strip_prefix("https://"))
    {
        rest.find('/').map_or("/", |i| &rest[i..])
    } else if t.starts_with('{') {
        let end = t.find('}')?;
        &t[end + 1..]
    } else {
        t
    };
    t.starts_with('/').then(|| t.to_string())
}

impl Collector<'_, '_> {
    fn symbol_of(&self, id: &IdentifierReference) -> Option<SymbolId> {
        id.reference_id
            .get()
            .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
    }

    /// Bind each name a parameter list declares as a parameter.
    fn note_params(&mut self, params: &FormalParameters) {
        fn walk(p: &BindingPattern, out: &mut Vec<(SymbolId, String)>) {
            match p {
                BindingPattern::BindingIdentifier(b) => {
                    if let Some(s) = b.symbol_id.get() {
                        out.push((s, b.name.to_string()));
                    }
                }
                BindingPattern::AssignmentPattern(a) => walk(&a.left, out),
                BindingPattern::ObjectPattern(o) => {
                    for prop in &o.properties {
                        walk(&prop.value, out);
                    }
                }
                BindingPattern::ArrayPattern(a) => {
                    for el in a.elements.iter().flatten() {
                        walk(el, out);
                    }
                }
            }
        }
        let mut found = Vec::new();
        for item in &params.items {
            walk(&item.pattern, &mut found);
        }
        self.p.params.extend(found);
        self.flow_params(params);
    }

    /// A call through a parameter's members (`server.services.project.getProject()`,
    /// `ctx.prisma.user.findMany()`), which has no canonical callee: the parameter and
    /// the static member path, at most [`MAX_MEMBER_DEPTH`] members, and the path through
    /// the parameter's in-repo type when it has one. A bare `next()` or a path through
    /// a call (`c.get("x").y()`) is none.
    fn note_param_call(&mut self, callee: &Expression) {
        let mut members = Vec::new();
        let mut cur = unwrap_expr(callee);
        loop {
            match cur {
                Expression::StaticMemberExpression(m) => {
                    members.push(m.property.name.as_str());
                    cur = unwrap_expr(&m.object);
                }
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => {
                        members.push(m.property.name.as_str());
                        cur = unwrap_expr(&m.object);
                    }
                    _ => return,
                },
                Expression::Identifier(id) => {
                    let Some(s) = self.symbol_of(id) else { return };
                    // A parameter of any function of the file: a route plugin's
                    // `server`, used in the handlers it registers.
                    let Some((name, ty)) = self.l.params.get(&s) else {
                        return;
                    };
                    // Request and response plumbing (`res.status()`, `req.log.info()`) is
                    // the framework's; an untyped parameter needs a path through what it
                    // carries (`server.services.x.y()`), a typed one any member.
                    let deep_enough = if ty.is_some() {
                        !members.is_empty()
                    } else {
                        members.len() >= 2 && !PLUMBING_PARAMS.contains(&name.as_str())
                    };
                    if !deep_enough || members.len() > MAX_MEMBER_DEPTH {
                        return;
                    }
                    members.reverse();
                    let path: String = members.iter().map(|m| format!(".{m}")).collect();
                    if let [member, _method] = members.as_slice()
                        && self
                            .l
                            .param_builtins
                            .get(&s)
                            .is_some_and(|b| b.contains(*member))
                    {
                        self.p.builtin_values.insert(format!(
                            "{}{name}.{member}",
                            drift_core::controls::BUILTIN_VALUE
                        ));
                    }
                    if self.p.param_calls.len() < MAX_PARAM_CALLS {
                        self.p.param_calls.insert(format!("param:{name}{path}"));
                        if let Some(t) = ty {
                            let mut r = t.clone();
                            r.member = path;
                            self.p.typed_param_calls.insert(r);
                        }
                    }
                    return;
                }
                _ => return,
            }
        }
    }

    /// A request header a call reads: `req.headers.get("x-org-id")`,
    /// `headers().get(..)`, `(await headers()).get(..)`, a local bound to `headers()`,
    /// `req.header("x")`, `c.req.header("x")`, Express `req.get("x")`.
    fn header_read(&self, c: &CallExpression) -> Option<String> {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
            return None;
        };
        if c.arguments.len() != 1 {
            return None;
        }
        let name = match c.arguments[0].as_expression().map(unwrap_expr) {
            Some(Expression::StringLiteral(l)) => lit(l).to_ascii_lowercase(),
            _ => return None,
        };
        let method = m.property.name.as_str();
        let object = peel(&m.object);
        let reads = match method {
            "header" | "getHeader" => true,
            "get" if matches!(object, Expression::Identifier(id) if matches!(id.name.as_str(), "req" | "request")) => {
                true
            }
            m if HEADER_GETTERS.contains(&m) => match object {
                Expression::StaticMemberExpression(o) => o.property.name == "headers",
                Expression::CallExpression(h) => self.is_next_headers(&h.callee),
                Expression::Identifier(id) => self.symbol_of(id).is_some_and(|s| {
                    matches!(self.p.bound.get(&s), Some((RawOperand::Ref(r), path))
                        if path.is_empty() && is_next_headers_ref(r))
                }),
                _ => false,
            },
            _ => false,
        };
        (reads && drift_core::practice::valid_header(&name)).then_some(name)
    }

    fn is_next_headers(&self, callee: &Expression) -> bool {
        self.l
            .canon(callee)
            .is_some_and(|r| is_next_headers_ref(&r))
    }

    /// What a value used in a check stands for: a local bound to a callee's result or
    /// a header (with the member path read off it), a handler parameter
    /// (`param:<name>`), a header read, or a call's callee.
    fn operand(&self, e: &Expression, depth: usize) -> Option<(RawOperand, String)> {
        if depth > 8 {
            return None;
        }
        let e = peel(e);
        let push = |(src, mut path): (RawOperand, String), seg: &str| {
            if path.matches('.').count() < MAX_MEMBER_DEPTH {
                path.push('.');
                path.push_str(seg);
            }
            (src, path)
        };
        match e {
            Expression::Identifier(id) => {
                let s = self.symbol_of(id)?;
                if let Some(b) = self.p.bound.get(&s) {
                    return Some(b.clone());
                }
                self.p
                    .params
                    .get(&s)
                    .map(|n| (RawOperand::Text(format!("param:{n}")), String::new()))
            }
            // The instance, in a method's body: `this.session.orgId`.
            Expression::ThisExpression(_) if self.own_this == 0 && self.this_methods.is_some() => {
                Some((RawOperand::Text("param:this".into()), String::new()))
            }
            Expression::StaticMemberExpression(m) => self
                .operand(&m.object, depth + 1)
                .map(|o| push(o, m.property.name.as_str())),
            Expression::ChainExpression(c) => match &c.expression {
                ChainElement::StaticMemberExpression(m) => self
                    .operand(&m.object, depth + 1)
                    .map(|o| push(o, m.property.name.as_str())),
                ChainElement::CallExpression(c) => self.call_operand(c, depth),
                _ => None,
            },
            Expression::CallExpression(c) => self.call_operand(c, depth),
            // `req.headers.get("x") ?? ""`: the value read.
            Expression::LogicalExpression(l) if l.operator != LogicalOperator::And => {
                self.operand(&l.left, depth + 1)
            }
            _ => None,
        }
    }

    fn call_operand(&self, c: &CallExpression, depth: usize) -> Option<(RawOperand, String)> {
        if let Some(h) = self.header_read(c) {
            return Some((RawOperand::Text(format!("header:{h}")), String::new()));
        }
        // `session.user.roles.includes("admin")`: what the method is called on.
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
            && matches!(
                m.property.name.as_str(),
                "includes" | "has" | "some" | "every" | "startsWith" | "endsWith" | "find"
            )
            && let Some(o) = self.operand(&m.object, depth + 1)
        {
            return Some(o);
        }
        let r = self.l.canon_callee(&c.callee)?;
        // Built-in conversions stand for what they convert:
        // `Uint8Array.from(Buffer.from(sig))` is `sig`.
        if let RawBase::Global(g) = &r.base
            && (matches!(
                (g.as_str(), r.member.as_str()),
                ("Buffer" | "Uint8Array" | "Array", ".from")
            ) || (r.member.is_empty() && matches!(g.as_str(), "String" | "Number" | "BigInt")))
        {
            return c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(|x| self.operand(x, depth + 1));
        }
        Some((RawOperand::Ref(r), String::new()))
    }

    /// The value is env-derived: an environment read ([`Lowerer::env_value`]) or a
    /// local bound to one.
    fn env_derived(&self, e: &Expression, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        if self.l.env_value(e, 0) {
            return true;
        }
        match peel(e) {
            Expression::Identifier(id) => self.symbol_of(id).is_some_and(|s| {
                matches!(self.p.bound.get(&s), Some((RawOperand::Text(t), _)) if t == ENV_COMPARED)
            }),
            Expression::TemplateLiteral(t) => {
                t.expressions.iter().any(|x| self.env_derived(x, depth + 1))
            }
            Expression::CallExpression(c) => c
                .arguments
                .iter()
                .filter_map(|a| a.as_expression())
                .any(|a| self.env_derived(a, depth + 1)),
            Expression::LogicalExpression(l) => {
                self.env_derived(&l.left, depth + 1) || self.env_derived(&l.right, depth + 1)
            }
            // `new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET })`.
            Expression::ObjectExpression(o) => o.properties.iter().any(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => self.env_derived(&p.value, depth + 1),
                ObjectPropertyKind::SpreadProperty(_) => false,
            }),
            _ => false,
        }
    }

    /// What a value wrapped for a comparison stands for (`Buffer.from(sig)` -> `sig`).
    fn unwrapped_operand(&self, e: &Expression) -> Option<(RawOperand, String)> {
        let mut cur = peel(e);
        for _ in 0..3 {
            match cur {
                Expression::CallExpression(c)
                    if matches!(
                        call_name(&c.callee),
                        Some("from" | "toString" | "trim" | "digest")
                    ) && self.header_read(c).is_none() =>
                {
                    cur = match c.arguments.first().and_then(|a| a.as_expression()) {
                        Some(x) => peel(x),
                        None => match unwrap_expr(&c.callee) {
                            Expression::StaticMemberExpression(m) => peel(&m.object),
                            _ => return None,
                        },
                    };
                }
                _ => break,
            }
        }
        self.operand(cur, 0)
            .filter(|(o, _)| !matches!(o, RawOperand::Text(t) if t == ENV_COMPARED))
    }

    /// A signature or secret check made by a call: `crypto.timingSafeEqual(a, b)` (the
    /// source is the non-secret side), Stripe `webhooks.constructEvent(body, sig, secret)`
    /// and svix `new Webhook(secret).verify(payload, headers)` (the source is the
    /// verifier). `compares` is `env` when the secret is env-derived.
    fn verifier_check(&self, c: &CallExpression) -> Option<(RawOperand, String, RawOperand)> {
        let name = call_name(&c.callee)?;
        let args: Vec<&Expression> = c
            .arguments
            .iter()
            .filter_map(|a| a.as_expression())
            .collect();
        let env = |args: &[&Expression]| {
            if args.iter().any(|a| self.env_derived(a, 0)) {
                RawOperand::Text(ENV_COMPARED.into())
            } else {
                RawOperand::None
            }
        };
        match name {
            "timingSafeEqual" if args.len() == 2 => {
                let compares = env(&args);
                let (source, reads) = args
                    .iter()
                    .filter(|a| !self.env_derived(a, 0))
                    .find_map(|a| self.unwrapped_operand(a))
                    .or_else(|| {
                        self.l
                            .canon_callee(&c.callee)
                            .map(|r| (RawOperand::Ref(r), String::new()))
                    })?;
                Some((source, reads, compares))
            }
            "constructEvent" | "constructEventAsync" => {
                let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                    return None;
                };
                let on_webhooks = matches!(unwrap_expr(&m.object), Expression::StaticMemberExpression(o) if o.property.name == "webhooks");
                if !on_webhooks {
                    return None;
                }
                let r = self.l.canon_callee(&c.callee)?;
                // A secret written in the code (`""`, `"whsec_..."`) is not the
                // service's: the check is found, and what it verifies is not proven.
                let compares = match env(&args) {
                    RawOperand::None if args.get(2).is_some_and(|a| is_literal_text(a)) => {
                        RawOperand::Text(LITERAL_SECRET.into())
                    }
                    other => other,
                };
                Some((RawOperand::Ref(r), String::new(), compares))
            }
            "verify" => {
                let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                    return None;
                };
                // The receiver is a svix `Webhook`: built in place or bound to a local.
                let (receiver, secret_env) = match peel(&m.object) {
                    Expression::NewExpression(n) => (
                        self.l.canon(&n.callee),
                        n.arguments
                            .iter()
                            .filter_map(|a| a.as_expression())
                            .any(|a| self.env_derived(a, 0)),
                    ),
                    Expression::Identifier(id) => {
                        let s = self.symbol_of(id)?;
                        match self.p.bound.get(&s) {
                            Some((RawOperand::Ref(r), path)) if path.is_empty() => {
                                let mut r = r.clone();
                                r.member = r.member.trim_end_matches("(new)").to_string();
                                (Some(r), self.p.env_secrets.contains(&s))
                            }
                            // A module-level `const gh = new Webhooks({ secret })`.
                            _ => match self.l.resolve_ident(id) {
                                Some(RawBase::Local(n)) => match self.l.module_news.get(&n) {
                                    Some((r, env)) => (Some(r.clone()), *env),
                                    None => (None, false),
                                },
                                _ => (None, false),
                            },
                        }
                    }
                    _ => (None, false),
                };
                let mut r = receiver.filter(|r| {
                    matches!(&r.base, RawBase::Import { spec, name }
                        if (spec == "svix" && name == "Webhook")
                            || (spec == "@octokit/webhooks" && name == "Webhooks"))
                })?;
                r.member.push_str("(new).verify");
                let literal = matches!(peel(&m.object), Expression::NewExpression(n)
                    if n.arguments.first().and_then(|a| a.as_expression()).is_some_and(is_literal_text));
                let compares = if secret_env {
                    RawOperand::Text(ENV_COMPARED.into())
                } else if literal {
                    RawOperand::Text(LITERAL_SECRET.into())
                } else {
                    env(&args)
                };
                Some((RawOperand::Ref(r), String::new(), compares))
            }
            _ => None,
        }
    }

    /// Record a verifier call as a caller check ([`Collector::verifier_check`]). A
    /// constant-time compare (`crypto.timingSafeEqual`) refuses no one by itself: it
    /// answers a boolean, so it is a check only where that answer decides a refusal,
    /// as the condition of a branch that refuses ([`Collector::condition`]); its call
    /// alone, ignored, logged or bound to a name never tested, records none
    /// (lowering 73). A verifier that throws (Stripe `constructEvent`, svix
    /// `verify`) is the check where it is called.
    fn note_verifier(&mut self, c: &CallExpression) {
        if !self.counting() || call_name(&c.callee) == Some("timingSafeEqual") {
            return;
        }
        // Stripe's `constructEventAsync` rejects where the signature is wrong: a
        // check only where what it returns is awaited or returned as it is. Not
        // awaited, or with `.catch()` on it, it stops nothing.
        if call_name(&c.callee) == Some("constructEventAsync")
            && !self.awaited_calls.contains(&c.span.end)
        {
            return;
        }
        if let Some((source, reads, compares)) = self.verifier_check(c) {
            self.add_check(RawBodyCheck {
                source,
                reads,
                compares,
                outcome: drift_core::CheckOutcome::Unauthenticated,
                op: String::new(),
                conditional: self.branches > 0 || self.served,
                condition: self.check_condition().to_string(),
                unless: String::new(),
                compares_path: String::new(),
                after: self.order.clone(),
                caught: false,
            });
        }
    }

    /// What the other side of a comparison is: nothing for `null`/`undefined`,
    /// `literal`, `param:<name>`, `header:<name>`, `env` (an env-derived secret, never
    /// named), or a callee (`call:` once linked); and the member path read off it
    /// (`req.user.orgId` -> `param:req`, `.user.orgId`).
    fn compared(&self, e: &Expression) -> (RawOperand, String) {
        let only = |o: RawOperand| (o, String::new());
        if self.env_derived(e, 0) {
            return only(RawOperand::Text(ENV_COMPARED.into()));
        }
        let e = peel(e);
        match e {
            Expression::NullLiteral(_) => return only(RawOperand::None),
            Expression::Identifier(id) if id.name == "undefined" => {
                return only(RawOperand::None);
            }
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_) => return only(RawOperand::Text("literal".into())),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                return only(RawOperand::Text("literal".into()));
            }
            _ => {}
        }
        match self.operand(e, 0) {
            Some((o @ (RawOperand::Text(_) | RawOperand::Ref(_)), path)) => (o, path),
            _ => only(RawOperand::None),
        }
    }

    /// The values a check's condition reads: (source, member path, compared with, how
    /// it compares). The last says whether the branch is taken where the two values
    /// differ or where they match ([`drift_core::check_op`]), through any `!` around
    /// the comparison (`negated`); empty for a test of the value itself, a comparison
    /// with `null` or `undefined` among them.
    ///
    /// The fifth is the other operands of an effective `&&` the comparison stands in
    /// (`a && b`, or `!(a || b)`), in the code's words: the branch is taken only
    /// where they hold too, so the comparison decides for those requests only
    /// ([`drift_core::not_always::AND_OPERAND`]).
    fn condition(&self, e: &Expression, out: &mut Vec<CheckOperand>, depth: usize, negated: bool) {
        use drift_core::check_op::{OTHER, REFUSES_MATCH, REFUSES_MISMATCH};
        if depth > 8 {
            return;
        }
        let e = peel(e);
        match e {
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                self.condition(&u.argument, out, depth + 1, !negated)
            }
            Expression::LogicalExpression(l) if (l.operator == LogicalOperator::And) != negated => {
                let other = |x: &Expression| {
                    if negated {
                        format!("!{}", words(x))
                    } else {
                        words(x)
                    }
                };
                for (side, guard) in [(&l.left, other(&l.right)), (&l.right, other(&l.left))] {
                    let mut inner = Vec::new();
                    self.condition(side, &mut inner, depth + 1, negated);
                    out.extend(inner.into_iter().map(|(a, b, c, d, g)| {
                        let g = match g {
                            Some(g) => format!("{guard} && {g}"),
                            None => guard.clone(),
                        };
                        (a, b, c, d, Some(clip_words(g)))
                    }));
                }
            }
            Expression::LogicalExpression(l) => {
                self.condition(&l.left, out, depth + 1, negated);
                self.condition(&l.right, out, depth + 1, negated);
            }
            Expression::BinaryExpression(b)
                if b.operator.is_equality() || b.operator.is_compare() =>
            {
                let side = |x: &Expression| {
                    self.operand(x, 0)
                        .filter(|(o, _)| !matches!(o, RawOperand::Text(t) if t == ENV_COMPARED))
                };
                let nothing = |x: &Expression| match peel(x) {
                    Expression::NullLiteral(_) => true,
                    Expression::Identifier(id) => id.name == "undefined",
                    _ => false,
                };
                let op = |other: &Expression| {
                    let equal = match b.operator {
                        BinaryOperator::StrictEquality | BinaryOperator::Equality => true,
                        BinaryOperator::StrictInequality | BinaryOperator::Inequality => false,
                        _ => return OTHER,
                    };
                    if nothing(other) {
                        ""
                    } else if equal != negated {
                        REFUSES_MATCH
                    } else {
                        REFUSES_MISMATCH
                    }
                };
                if let Some((src, path)) = side(&b.left) {
                    out.push((src, path, self.compared(&b.right), op(&b.right), None));
                } else if let Some((src, path)) = side(&b.right) {
                    out.push((src, path, self.compared(&b.left), op(&b.left), None));
                }
            }
            Expression::CallExpression(c) if self.verifier_check(c).is_some() => {
                // A constant-time compare answers a boolean: the branch is taken where
                // it holds or where it does not. (A verifier that throws has no sides.)
                let op = if call_name(&c.callee) == Some("timingSafeEqual") {
                    compare_op(negated)
                } else {
                    ""
                };
                out.extend(self.verifier_check(c).map(|(source, reads, compares)| {
                    (source, reads, (compares, String::new()), op, None)
                }));
            }
            e => {
                if let Some((src, path)) = self.operand(e, 0)
                    && !matches!(&src, RawOperand::Text(t) if t == ENV_COMPARED)
                {
                    // A local bound to the answer of a constant-time compare
                    // (`const ok = timingSafeEqual(a, b); if (ok) return 401`).
                    let op = if path.is_empty() && is_compare(&src) {
                        compare_op(negated)
                    } else {
                        ""
                    };
                    out.push((src, path, (RawOperand::None, String::new()), op, None));
                }
            }
        }
    }

    /// The statement leaves by a `return` that does not turn the caller away: no
    /// rejection ([`Collector::exit_outcome`]), no error status, not the call that
    /// hands control on.
    fn serves(&self, s: &Statement) -> bool {
        match s {
            // A bare `return` that ends a block may follow the answer itself
            // (`res.status(403).end(); return;`): the block serves where nothing in
            // it turns the caller away.
            Statement::BlockStatement(b) => b.body.last().is_some_and(|l| match l {
                Statement::ReturnStatement(r) if r.argument.is_none() => {
                    self.branch_outcome(s).is_none()
                }
                l => self.serves(l),
            }),
            Statement::ReturnStatement(r) => self.return_serves(r),
            _ => false,
        }
    }

    /// The `return` does not turn the caller away ([`Collector::serves`]).
    fn return_serves(&self, r: &ReturnStatement) -> bool {
        match &r.argument {
            // `if (rule.archived) return;`: the function is over for those
            // requests, and what follows did not run for them.
            None => true,
            // Handing control on (`return next()`) serves them too: the route
            // runs without what follows here. Given an error (`return next(err)`),
            // it does not serve them.
            Some(a) => {
                self.exit_outcome(a).is_none()
                    && self.response_status(a).is_none_or(|n| n < 400)
                    && !matches!(peel(a), Expression::CallExpression(c)
                    if self.continues(&c.callee)
                        && c.arguments.iter().any(|x| !matches!(
                            x.as_expression().map(unwrap_expr),
                            Some(Expression::ObjectExpression(_))
                        )))
            }
        }
    }

    /// How an exit turns the caller away, if it does: a 401/403/404/429 response or
    /// error, a sign-in redirect, `notFound()`, `unauthorized()`, `forbidden()`, or a
    /// local bound to a rejecting error.
    fn exit_outcome(&self, e: &Expression) -> Option<drift_core::CheckOutcome> {
        use drift_core::CheckOutcome;
        let e = peel(e);
        if let Expression::Identifier(id) = e {
            return self
                .rejection_vars
                .get(id.name.as_str())
                .copied()
                .map(rejection_outcome);
        }
        // A call of a refusal builder of this file (`return unauthenticated()`):
        // the response it builds.
        if let Expression::CallExpression(c) = e
            && let Expression::Identifier(_) = unwrap_expr(&c.callee)
            && let Some(RawRef {
                base: RawBase::Local(name),
                member,
            }) = self.l.canon_callee(&c.callee)
            && member.is_empty()
            && let Some(o) = self.l.builders.get(&name)
        {
            return Some(*o);
        }
        let (callee, args) = match e {
            Expression::CallExpression(c) => (&c.callee, &c.arguments),
            Expression::NewExpression(n) => (&n.callee, &n.arguments),
            _ => return None,
        };
        let first = args.first().and_then(|a| a.as_expression());
        match call_name(callee) {
            Some("notFound") => return Some(CheckOutcome::NotFound),
            Some("redirect" | "permanentRedirect") if sign_in_arg(first) => {
                return Some(CheckOutcome::SignInRedirect);
            }
            Some("redirectToSignIn" | "redirectToLogin" | "redirectToSignin") => {
                return Some(CheckOutcome::SignInRedirect);
            }
            Some("unauthorized") if self.named_refusal(callee) => {
                return Some(CheckOutcome::Unauthenticated);
            }
            Some("forbidden") if self.named_refusal(callee) => {
                return Some(CheckOutcome::Forbidden);
            }
            _ => {}
        }
        if let Some(o) = self.response_status(e).and_then(status_outcome) {
            return Some(o);
        }
        rejection_marker(e, 0).map(rejection_outcome)
    }

    /// What a branch does first that turns the caller away.
    fn branch_outcome(&self, s: &Statement) -> Option<drift_core::CheckOutcome> {
        match s {
            Statement::BlockStatement(b) => b.body.iter().find_map(|s| self.branch_outcome(s)),
            Statement::ReturnStatement(r) => r.argument.as_ref().and_then(|a| self.exit_outcome(a)),
            Statement::ThrowStatement(t) => self.exit_outcome(&t.argument),
            // A response built as a value and dropped refuses no one: only one
            // that is returned does.
            Statement::ExpressionStatement(x) => match peel(&x.expression) {
                e @ Expression::CallExpression(_) if !self.built_as_value(e) => {
                    self.exit_outcome(e)
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// The call builds a response as a value and sends nothing where it stands: a
    /// refusal builder of this file (`unauthenticated()`,
    /// [`RawSymbol::refusal_builder`]) or a static method of `Response` /
    /// `NextResponse` (`NextResponse.json(body, { status: 401 })`,
    /// `Response.json(...)`). Written as a statement of its own, it answers no one.
    fn built_as_value(&self, e: &Expression) -> bool {
        let Expression::CallExpression(c) = peel(e) else {
            return false;
        };
        match unwrap_expr(&c.callee) {
            Expression::Identifier(_) => matches!(
                self.l.canon_callee(&c.callee),
                Some(RawRef { base: RawBase::Local(name), member })
                    if member.is_empty() && self.l.builders.contains_key(&name)
            ),
            Expression::StaticMemberExpression(m) => matches!(unwrap_expr(&m.object),
                Expression::Identifier(o) if matches!(o.name.as_str(), "Response" | "NextResponse")),
            _ => false,
        }
    }

    /// How a statement of a `catch` handler turns the caller away: what it returns or
    /// throws ([`Collector::exit_outcome`]), an answer sent as a statement of its own
    /// (`reply.code(401).send()`, `res.sendStatus(401)`, `reply.unauthorized()`), or
    /// an error handed to the framework (`next(createError(401))`). A call that only
    /// carries the words (`logger.warn("Unauthorized", err)`) answers nothing.
    fn handler_outcome(&self, s: &Statement) -> Option<drift_core::CheckOutcome> {
        let (e, returned) = match s {
            Statement::ThrowStatement(t) => return self.exit_outcome(&t.argument),
            Statement::ReturnStatement(r) => (r.argument.as_ref()?, true),
            Statement::ExpressionStatement(x) => (&x.expression, false),
            _ => return None,
        };
        let e = peel(e);
        // A response built as a value and dropped answers no one
        // ([`Collector::built_as_value`]).
        if !returned && self.built_as_value(e) {
            return None;
        }
        if let Expression::CallExpression(c) = e {
            if self.continues(&c.callee) {
                return self.exit_outcome(c.arguments.first()?.as_expression()?);
            }
            if call_name(&c.callee) == Some("unauthorized") && self.named_refusal(&c.callee) {
                return Some(drift_core::CheckOutcome::Unauthenticated);
            }
            if let Some(o) = self.response_status(e).and_then(status_outcome) {
                return Some(o);
            }
            // The status set in a statement of its own (`res.status(401);
            // res.end()`, `res.writeHead(401)`).
            if matches!(
                call_name(&c.callee),
                Some("status" | "code" | "sendStatus" | "writeHead")
            ) && let Some(o) = c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(literal_status)
                .and_then(status_outcome)
            {
                return Some(o);
            }
        }
        // `res.statusCode = 401`.
        if let Expression::AssignmentExpression(a) = e
            && let AssignmentTarget::StaticMemberExpression(m) = &a.left
            && matches!(m.property.name.as_str(), "statusCode" | "status")
            && let Some(o) = literal_status(&a.right).and_then(status_outcome)
        {
            return Some(o);
        }
        if returned { self.exit_outcome(e) } else { None }
    }

    /// The call hands the request on to what the function guards: the continuation
    /// called with nothing, with what the next step is given (`next({ ctx })`) or
    /// with Express's `"route"` / `"router"`. Given an error (`next(err)`,
    /// `done(createError(401))`), it hands the request to the error handler: the
    /// route does not run.
    fn hands_on(&self, c: &CallExpression) -> bool {
        self.continues(&c.callee)
            && match c.arguments.first() {
                None => true,
                Some(a) => matches!(
                    a.as_expression().map(unwrap_expr),
                    Some(Expression::ObjectExpression(_) | Expression::StringLiteral(_)) | None
                ),
            }
    }

    /// `try { request.operator = await request.jwtVerify<Operator>() } catch {
    /// return reply.code(401).send() }`, `try { verify(token) } catch { return
    /// res.status(401).end() } next()`: the caller is turned away as not signed in
    /// where what the `try` runs throws. A check on what the `try` calls, as an `if`
    /// on its answer would be.
    ///
    /// Proven for every request that reaches the `try` where:
    /// - the `try` runs something that can refuse before anything in it serves or
    ///   hands the request on: a call that is a statement of its own, the value of
    ///   an assignment, of a declaration or of a `return` (whatever its type
    ///   arguments and its `await`), or an `if` that throws;
    /// - the handler answers 401 at its own top level, after nothing but plain
    ///   statements, and hands control on nowhere;
    /// - the function goes on only past the `try`: the handler leaves, or the `try`
    ///   ends the function's body (`ends`).
    ///
    /// A 401 the handler answers under a further condition, one after which the
    /// request is handed on, and a `try` that may serve before it verifies are found
    /// and not proven: a conditional check
    /// ([`drift_core::not_always::SWALLOWED`]: what is thrown may be caught and the
    /// request served all the same), never nothing. A handler that answers no 401
    /// (`catch { request.user = null }`) is no check.
    fn note_verified_try(&mut self, it: &TryStatement, ends: bool) {
        use drift_core::CheckOutcome::Unauthenticated;
        use drift_core::not_always::SWALLOWED;
        if !self.counting() {
            return;
        }
        let Some(handler) = &it.handler else { return };
        let stmts = &handler.body.body;
        // The handler gives what it caught to the response or to the framework
        // (`reply.send(err)`, `next(err)`, `done(err)`): the request is answered
        // with that error and not handed on. With `request.jwtVerify()` of
        // `@fastify/jwt`, whose errors carry the status 401, that is the answer
        // "not signed in"; with anything else the status is not read.
        let caught_name = match handler.param.as_ref().map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(b)) => Some(b.name.as_str()),
            _ => None,
        };
        let sends_caught = |s: &Statement| -> bool {
            let e = match s {
                Statement::ReturnStatement(r) => r.argument.as_ref(),
                Statement::ExpressionStatement(x) => Some(&x.expression),
                _ => None,
            };
            let Some(Expression::CallExpression(c)) = e.map(peel) else {
                return false;
            };
            let given = matches!(
                c.arguments.first().and_then(|a| a.as_expression()).map(unwrap_expr),
                Some(Expression::Identifier(id)) if Some(id.name.as_str()) == caught_name
            );
            given
                && c.arguments.len() == 1
                && (self.continues(&c.callee) || call_name(&c.callee) == Some("send"))
        };
        let verifies_jwt = it.block.body.iter().find_map(|s| {
            let value = match s {
                Statement::ExpressionStatement(x) => Some(&x.expression),
                Statement::VariableDeclaration(v) => {
                    v.declarations.iter().find_map(|d| d.init.as_ref())
                }
                Statement::ReturnStatement(r) => r.argument.as_ref(),
                _ => None,
            };
            value.and_then(verified_call)
        });
        let verifies_jwt = verifies_jwt.is_some_and(|c| {
            matches!(unwrap_expr(&c.callee), Expression::StaticMemberExpression(m)
                if m.property.name == "jwtVerify")
        });
        let at = stmts.iter().position(|s| {
            self.handler_outcome(s) == Some(Unauthenticated) || (verifies_jwt && sends_caught(s))
        });
        let mut why = "";
        match at {
            Some(at) => {
                // Before the answer, nothing that may leave or branch.
                if stmts[..at].iter().any(|s| {
                    !matches!(
                        s,
                        Statement::ExpressionStatement(_) | Statement::VariableDeclaration(_)
                    )
                }) {
                    why = SWALLOWED;
                }
                // The function goes on only past the `try`.
                let left = stmts[at..].iter().any(leaves);
                if !left && !(ends && it.finalizer.is_none()) {
                    why = SWALLOWED;
                }
            }
            None => {
                // A 401 somewhere under a condition of the handler.
                let mut nested = Answers401 {
                    c: self,
                    found: false,
                };
                for s in stmts {
                    nested.visit_statement(s);
                }
                // The caught error handed on with a status that is not read: the
                // request is refused, and not known to be for want of a sign-in.
                if !nested.found && !stmts.iter().any(sends_caught) {
                    return;
                }
                why = SWALLOWED;
            }
        }
        // The handler's answer is a response it hands back to the function's caller
        // (`return NextResponse.json(..., { status: 401 })`), or one that turns the
        // caller away where it stands (a throw, a status set on the response).
        let by_value = at.is_some_and(|at| {
            matches!(&stmts[at], Statement::ReturnStatement(r)
                if r.argument.as_ref().is_some_and(|a| self.hands_back_value(a)))
        });
        if by_value && self.fn_depth <= 1 {
            self.returned_rejections.insert(String::new());
        } else {
            self.other_rejection = true;
        }
        // The handler, or what runs whatever happened, hands the request on (`catch {
        // res.status(401); next() }`): the route runs all the same.
        let mut hands_on = HandsOn {
            c: self,
            found: false,
        };
        for s in stmts {
            hands_on.visit_statement(s);
        }
        if let Some(f) = &it.finalizer {
            hands_on.visit_block_statement(f);
        }
        if hands_on.found {
            why = SWALLOWED;
        }
        // What the `try` verifies: the first statement at its top level that can
        // refuse, before anything that may serve or hand the request on.
        let mut verified = false;
        let mut source = RawOperand::None;
        for s in &it.block.body {
            let value = match s {
                Statement::ExpressionStatement(x) => Some(&x.expression),
                Statement::VariableDeclaration(v) => {
                    v.declarations.iter().find_map(|d| d.init.as_ref())
                }
                Statement::ReturnStatement(r) => r.argument.as_ref(),
                // `if (!token) throw new Error("no token")`: the handler answers.
                Statement::IfStatement(i)
                    if i.alternate.is_none()
                        && leaves(&i.consequent)
                        && !self.serves(&i.consequent) =>
                {
                    verified |= throws(&i.consequent);
                    continue;
                }
                Statement::ThrowStatement(_) => {
                    verified = true;
                    break;
                }
                Statement::EmptyStatement(_) => continue,
                // A branch, a loop or a nested `try` before anything is verified:
                // some requests may be served without it.
                _ => {
                    if !verified {
                        why = SWALLOWED;
                        verified = true;
                    }
                    break;
                }
            };
            let Some(call) = value.and_then(verified_call) else {
                // A value read with no call of its own (`const token =
                // req.headers.authorization`) verifies nothing and serves no one,
                // unless it leaves.
                if matches!(s, Statement::ReturnStatement(_)) && !verified {
                    return;
                }
                continue;
            };
            // A function the body was handed may be what it guards, whatever its
            // name (`try { return await inner(req) } catch { ... }` in a wrapper).
            let handed = matches!(unwrap_expr(&call.callee), Expression::Identifier(id)
                if self.symbol_of(id).is_some_and(|s| self.l.params.contains_key(&s)));
            if self.continues(&call.callee) {
                // Handed on before anything was verified.
                if !verified {
                    return;
                }
                break;
            }
            if handed {
                // It may verify and it may serve: found, not proven.
                if !verified {
                    why = SWALLOWED;
                    verified = true;
                }
                break;
            }
            verified = true;
            // Named by the first callee the module can name (`jwt.verify`, not
            // `header.split`).
            if let Some(r) = self.l.canon_callee(&call.callee) {
                source = RawOperand::Ref(r);
                break;
            }
        }
        if !verified {
            return;
        }
        let conditional = self.branches > 0 || self.served || !why.is_empty();
        let condition = match self.check_condition() {
            "" => why,
            c => c,
        };
        // The check alone: `rejects_caller` is what mining reads, and stays what
        // it was ([`RawSymbol::listed_controls`]).
        self.add_check(RawBodyCheck {
            source,
            reads: String::new(),
            compares: RawOperand::None,
            outcome: Unauthenticated,
            op: String::new(),
            conditional,
            condition: condition.to_string(),
            unless: String::new(),
            compares_path: String::new(),
            after: self.order.clone(),
            caught: true,
        });
    }

    /// The call is of a library accessor on [`ALWAYS_PRESENT`]: the package it is
    /// of.
    fn always_present(&self, c: &CallExpression) -> Option<&'static str> {
        let Some(RawRef {
            base: RawBase::Import { spec, name },
            member,
        }) = self.l.canon_callee(&c.callee)
        else {
            return None;
        };
        ALWAYS_PRESENT
            .iter()
            .find(|(p, n)| {
                member.is_empty()
                    && name == *n
                    && (spec == *p || spec.starts_with(&format!("{p}/")))
            })
            .map(|(p, _)| *p)
    }

    /// The condition reads nothing of the request or of the caller: a literal, an
    /// environment read, a header that says nothing of who sends it (the size or the
    /// type of the body, [`NOT_OF_THE_CALLER`]), and operators, conversions and
    /// conditions over those. A call, a parameter, a local or a member of anything
    /// else is not read, and the condition is not one of these.
    fn caller_free(&self, e: &Expression, depth: usize) -> bool {
        if depth > 6 {
            return false;
        }
        let free = |x: &Expression| self.caller_free(x, depth + 1);
        match peel(e) {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_) => true,
            Expression::Identifier(id) => {
                id.name == "undefined"
                    || matches!(self.l.resolve_ident(id), Some(RawBase::Local(n))
                        if self.l.env_bound.contains(&n))
            }
            Expression::TemplateLiteral(t) => t.expressions.iter().all(&free),
            Expression::StaticMemberExpression(m) => self.l.env_read(m).is_some(),
            Expression::ComputedMemberExpression(m) => {
                matches!(unwrap_expr(&m.object), Expression::StaticMemberExpression(o)
                    if o.property.name == "env"
                        && matches!(unwrap_expr(&o.object), Expression::Identifier(p) if p.name == "process"))
                    && free(&m.expression)
            }
            Expression::UnaryExpression(u) => free(&u.argument),
            Expression::BinaryExpression(b) => free(&b.left) && free(&b.right),
            Expression::LogicalExpression(l) => free(&l.left) && free(&l.right),
            Expression::CallExpression(c) => {
                if let Some(h) = self.header_read(c) {
                    return NOT_OF_THE_CALLER.contains(&h.as_str());
                }
                matches!(unwrap_expr(&c.callee), Expression::Identifier(id)
                    if matches!(id.name.as_str(), "Number" | "String" | "Boolean" | "parseInt" | "parseFloat")
                        && matches!(self.l.resolve_ident(id), Some(RawBase::Global(_))))
                    && c.arguments
                        .iter()
                        .all(|a| a.as_expression().is_some_and(&free))
            }
            _ => false,
        }
    }

    /// The condition refuses no one, whatever the request: a test for being there
    /// of a value a library always hands back (`!session` of `getIronSession`), a
    /// negated call that hands back a Promise and is not awaited
    /// (`!isAuthenticated()` of Kinde, `!isSignedIn(req)` of an `async` function of
    /// the file): a Promise is always true.
    fn never_true(&self, test: &Expression) -> bool {
        let Expression::UnaryExpression(u) = unwrap_expr(test) else {
            return false;
        };
        if u.operator != UnaryOperator::LogicalNot {
            return false;
        }
        match unwrap_expr(&u.argument) {
            Expression::Identifier(id) => self
                .symbol_of(id)
                .is_some_and(|s| self.p.present.contains(&s)),
            Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
                Expression::Identifier(id) => self
                    .symbol_of(id)
                    .is_some_and(|s| self.p.promised.contains(&s) || self.l.async_fns.contains(&s)),
                _ => false,
            },
            _ => false,
        }
    }

    /// The `if` throws for every request it takes a branch of, and takes that
    /// branch exactly where a value that says who calls is absent (`if (!userId) {
    /// ...; throw redirect(target) }`, `if (session == null) throw new Error("no
    /// session")`; or the `else` of the opposite test): a request with no caller
    /// never gets past it. What is thrown, and where a redirect sends them, is not
    /// asked: the refusal is that the function is left.
    ///
    /// The value says who calls where it is the caller's by its own source, or
    /// what a call or a lookup made of a credential the request carries
    /// ([`Collector::credential_identity`]); where it is what a callee given the
    /// request handed back, the callee is kept and whether it gives the caller is
    /// read where it is defined ([`NoCaller::Given`]). Read since the measured build
    /// (the listed reading only).
    fn throws_for_no_caller(&self, it: &IfStatement) -> Option<NoCaller> {
        fn always_throws(s: &Statement) -> bool {
            match s {
                Statement::ThrowStatement(_) => true,
                Statement::BlockStatement(b) => b.body.last().is_some_and(always_throws),
                _ => false,
            }
        }
        // The value a test says is absent (`true`) or present (`false`).
        fn asked<'b, 'a>(test: &'b Expression<'a>) -> Option<(&'b Expression<'a>, bool)> {
            let nothing = |x: &Expression| match peel(x) {
                Expression::NullLiteral(_) => true,
                Expression::Identifier(id) => id.name == "undefined",
                _ => false,
            };
            match peel(test) {
                Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                    asked(&u.argument).map(|(x, absent)| (x, !absent))
                }
                Expression::BinaryExpression(b) if b.operator.is_equality() => {
                    let equal = matches!(
                        b.operator,
                        BinaryOperator::StrictEquality | BinaryOperator::Equality
                    );
                    match (nothing(&b.left), nothing(&b.right)) {
                        (false, true) => Some((&b.left, equal)),
                        (true, false) => Some((&b.right, equal)),
                        _ => None,
                    }
                }
                Expression::LogicalExpression(_) | Expression::BinaryExpression(_) => None,
                x => Some((x, false)),
            }
        }
        // A test only some requests reach turns away those: a request that left
        // before it (`if (!cookie) return null`) passed no refusal.
        if !self.check_condition().is_empty() {
            return None;
        }
        let (value, absent) = asked(&it.test)?;
        let otherwise = match (absent, &it.alternate) {
            (true, _) if always_throws(&it.consequent) => false,
            (false, Some(a)) if always_throws(a) => true,
            _ => return None,
        };
        let taint = self.taint(value);
        if taint.callers_own() || self.credential_identity(value) {
            return (!routes::unmeasured_listing()).then_some(NoCaller::Own(otherwise));
        }
        let by = taint.given_by();
        (!by.is_empty()).then(|| NoCaller::Given(by.to_vec()))
    }

    /// `e` reads a credential the request carries, as it was sent: its `Cookie`
    /// or `Authorization` header (`request.headers.get("cookie")`,
    /// `req.headers.authorization`, `req.get("Authorization")`), the cookies a
    /// framework parsed (`req.cookies`, `request.cookies`), or a local bound to one.
    /// The two headers are the ones HTTP gives for it; no name of the repository
    /// is asked.
    fn credential_read(&self, e: &Expression) -> bool {
        struct Reads<'x, 's> {
            scoping: &'s Scoping,
            seeds: &'x HashSet<SymbolId>,
            found: bool,
        }
        fn credential(name: &str) -> bool {
            name.eq_ignore_ascii_case("cookie") || name.eq_ignore_ascii_case("authorization")
        }
        fn headers(e: &Expression) -> bool {
            matches!(unwrap_expr(e), Expression::StaticMemberExpression(m) if m.property.name == "headers")
        }
        impl<'a> Visit<'a> for Reads<'_, '_> {
            fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
                self.found |= it
                    .reference_id
                    .get()
                    .and_then(|r| self.scoping.get_reference(r).symbol_id())
                    .is_some_and(|s| self.seeds.contains(&s));
            }
            fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
                let name = it.property.name.as_str();
                if name == "cookies" || (credential(name) && headers(&it.object)) {
                    self.found = true;
                }
                walk::walk_static_member_expression(self, it);
            }
            fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
                if headers(&it.object)
                    && matches!(unwrap_expr(&it.expression), Expression::StringLiteral(l) if l.value.as_str().is_some_and(credential))
                {
                    self.found = true;
                }
                walk::walk_computed_member_expression(self, it);
            }
            fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
                if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
                    && matches!(m.property.name.as_str(), "get" | "header")
                    && matches!(
                        it.arguments.first().and_then(|a| a.as_expression()).map(unwrap_expr),
                        Some(Expression::StringLiteral(l)) if l.value.as_str().is_some_and(credential)
                    )
                {
                    self.found = true;
                }
                walk::walk_call_expression(self, it);
            }
        }
        let mut reads = Reads {
            scoping: self.l.scoping,
            seeds: &self.cred_seeds,
            found: false,
        };
        reads.visit_expression(e);
        reads.found
    }

    /// The parameter a value is reached from by its own members and their methods
    /// alone (`req.url.split("?")[0].toLowerCase()`, `await req.json()`), or a
    /// local bound to such a value. None of what another function made of a
    /// parameter (`makeService(req)`), which is that function's.
    fn param_chain(&self, e: &Expression) -> Option<String> {
        let mut at = unwrap_expr(e);
        loop {
            at = match at {
                Expression::AwaitExpression(a) => unwrap_expr(&a.argument),
                Expression::StaticMemberExpression(m) => unwrap_expr(&m.object),
                Expression::ComputedMemberExpression(m) => unwrap_expr(&m.object),
                Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
                    Expression::StaticMemberExpression(m) => unwrap_expr(&m.object),
                    _ => return None,
                },
                Expression::Identifier(id) => {
                    let s = self.symbol_of(id)?;
                    return self
                        .l
                        .params
                        .get(&s)
                        .map(|(name, _)| name.clone())
                        .or_else(|| self.param_values.get(&s).cloned());
                }
                _ => return None,
            };
        }
    }

    /// A function written in place and given to a method of a value that is data
    /// (`seen.forEach((fragment) => ...)` on a plain value the file holds,
    /// `req.body.items.map((item) => ...)` on a value of a parameter): what it is
    /// called with are members of that data, not the request, the response or a
    /// continuation. Its parameters are recorded as values of the data
    /// ([`Collector::param_values`]).
    fn note_data_callbacks(&mut self, it: &CallExpression) {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) else {
            return;
        };
        let of = self.param_chain(&m.object).or_else(|| {
            let mut root = unwrap_expr(&m.object);
            while let Expression::StaticMemberExpression(inner) = root {
                root = unwrap_expr(&inner.object);
            }
            match root {
                Expression::Identifier(id) => match self.l.resolve_ident(id) {
                    Some(RawBase::Local(name)) if self.l.plain_values.contains(&name) => Some(name),
                    _ => None,
                },
                _ => None,
            }
        });
        let Some(of) = of else {
            return;
        };
        fn names(p: &BindingPattern, out: &mut Vec<SymbolId>) {
            match p {
                BindingPattern::BindingIdentifier(b) => out.extend(b.symbol_id.get()),
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
        for a in &it.arguments {
            let params = match a.as_expression().map(unwrap_expr) {
                Some(Expression::ArrowFunctionExpression(f)) => &f.params,
                Some(Expression::FunctionExpression(f)) => &f.params,
                _ => continue,
            };
            for item in &params.items {
                names(&item.pattern, &mut found);
            }
        }
        for s in found {
            self.param_values.insert(s, of.clone());
        }
    }

    /// The test holds only where a credential the request carries is present: it
    /// is a read of one and nothing else (`if (token)`, `if
    /// (req.headers.authorization)`), or an `and` one operand of which is (`if
    /// (token && cache.get(token) === undefined)`). A call given one, a negation
    /// and an `or` say nothing of the kind.
    fn credential_present(&self, test: &Expression) -> bool {
        match peel(test) {
            Expression::LogicalExpression(l) if l.operator == LogicalOperator::And => {
                self.credential_present(&l.left) || self.credential_present(&l.right)
            }
            e => {
                let mut at = e;
                loop {
                    at = match at {
                        Expression::StaticMemberExpression(m) => peel(&m.object),
                        Expression::ComputedMemberExpression(m)
                            if matches!(peel(&m.expression), Expression::StringLiteral(_)) =>
                        {
                            peel(&m.object)
                        }
                        Expression::Identifier(_) => break self.credential_read(e),
                        _ => break false,
                    };
                }
            }
        }
    }

    /// `e` is what a call or a lookup made of a credential the request carries: a
    /// call given one, or given what another such call made (`await
    /// store.getSession(request.headers.get("cookie"))`, then `await
    /// db.session.findUnique({ where: { id: sessionId } })`), a member read off
    /// what one made (`session.userId`), or a local bound to one. The credential
    /// itself is not one: it is what the request sent, and says nothing until
    /// something looked it up.
    fn credential_identity(&self, e: &Expression) -> bool {
        let made = |x: &Expression| self.names_one(x, &|s| self.cred_locals.contains(&s));
        let mut at = peel(e);
        loop {
            at = match at {
                Expression::AwaitExpression(a) => peel(&a.argument),
                Expression::StaticMemberExpression(m) => peel(&m.object),
                Expression::ComputedMemberExpression(m) => peel(&m.object),
                Expression::ChainExpression(c) => match &c.expression {
                    ChainElement::StaticMemberExpression(m) => peel(&m.object),
                    ChainElement::ComputedMemberExpression(m) => peel(&m.object),
                    ChainElement::CallExpression(call) => {
                        return call.arguments.iter().any(|a| {
                            a.as_expression()
                                .is_some_and(|x| made(x) || self.credential_read(x))
                        }) || made(&call.callee);
                    }
                    _ => return false,
                },
                Expression::LogicalExpression(l)
                    if matches!(l.operator, LogicalOperator::Coalesce | LogicalOperator::Or)
                        && matches!(peel(&l.right), Expression::NullLiteral(_)) =>
                {
                    peel(&l.left)
                }
                Expression::Identifier(id) => {
                    return self
                        .symbol_of(id)
                        .is_some_and(|s| self.cred_locals.contains(&s));
                }
                Expression::CallExpression(call) => {
                    // A read of the credential itself (`headers.get("cookie")`)
                    // is what was sent, not what was made of it.
                    let given = call.arguments.iter().any(|a| {
                        a.as_expression()
                            .is_some_and(|x| made(x) || self.credential_read(x))
                    });
                    return given || made(&call.callee);
                }
                _ => return false,
            };
        }
    }

    /// Notes what a `return` of the walk's own function gives: what was made of a
    /// credential, or another value. `null` and `undefined` are no value.
    fn note_return_credential(&mut self, e: &Expression) {
        match peel(e) {
            Expression::NullLiteral(_) => return,
            Expression::Identifier(id) if id.name == "undefined" => return,
            _ => {}
        }
        if self.credential_identity(e) {
            self.returns_cred = true;
        } else {
            self.returns_not_cred = true;
        }
    }

    /// Record the checks of an `if` whose branch turns the caller away; whether it
    /// read the exit of one of its branches.
    fn note_check(&mut self, it: &IfStatement) -> bool {
        if !self.counting() {
            return false;
        }
        // [STRICT] A condition that is never true turns no one away: no check.
        if self.never_true(&it.test) {
            return false;
        }
        // The branch that turns the caller away: the `else` is taken where the
        // condition does not hold.
        // A branch that returns a call of a refusal builder: of this file, its
        // status; of another module, kept by linking where it is one.
        let mut pending: Option<RawRef> = None;
        let (outcome, otherwise, listed) = match self.branch_outcome(&it.consequent) {
            Some(o) => (o, false, false),
            None => match it.alternate.as_ref().and_then(|a| self.branch_outcome(a)) {
                Some(o) => (o, true, false),
                // `if (!signed(req)) { res.statusCode = 401; return res.end(); }`, as
                // a Node listener answers: a check for the readings that list.
                None => match status_assigned(&it.consequent) {
                    Some(o) => (o, false, true),
                    None => match self.builder_returned(&it.consequent) {
                        Some((o, None)) => (o, false, false),
                        Some((o, Some(r))) => {
                            pending = Some(r);
                            (o, false, false)
                        }
                        // A branch that always throws, taken where a value of
                        // the caller is absent: no caller without one gets past
                        // it, whatever is thrown and wherever it sends them.
                        None => match self.throws_for_no_caller(it) {
                            Some(NoCaller::Own(otherwise)) => {
                                self.builder_rejects = true;
                                (drift_core::CheckOutcome::Unauthenticated, otherwise, false)
                            }
                            // What a callee gave: whether that is who calls is
                            // said where the callee is read.
                            Some(NoCaller::Given(by)) => {
                                self.refuses_without.insert(by);
                                return false;
                            }
                            None => return false,
                        },
                    },
                },
            },
        };
        // The returns of the branch that turns the caller away are read here.
        match (otherwise, &it.alternate) {
            (true, Some(a)) => self.cover(a),
            _ => self.cover(&it.consequent),
        }
        let mut found = Vec::new();
        self.condition(&it.test, &mut found, 0, otherwise);
        // A 404 is a caller check only under a condition that reads something.
        if found.is_empty() && outcome == drift_core::CheckOutcome::NotFound {
            return true;
        }
        if found.is_empty() {
            // Nothing of the condition is read: where it asks for two things at once
            // (`a && !b`, or the `else` of `a || b`), the branch is taken for some
            // of the requests the second thing alone would turn away.
            found.push((
                RawOperand::None,
                String::new(),
                (RawOperand::None, String::new()),
                "",
                asks_for_both(&it.test, otherwise).then(|| "another condition holds".to_string()),
            ));
        }
        // [STRICT] The condition tests a local the body assigns more than once: what it
        // holds here is not read.
        let mut reassigned = ReassignedReads {
            scoping: self.l.scoping,
            initialised: &self.p.initialised,
            found: false,
        };
        reassigned.visit_expression(&it.test);
        let reassigned = reassigned.found;
        // A condition that refuses unless a role or one comparison holds, read one
        // operand for one check: the roles, in the code's own words
        // ([`drift_core::not_always::ROLE_ALTERNATIVE`]).
        let role_shaped = |compares: &RawOperand, op: &str| {
            (op.is_empty() && *compares == RawOperand::None)
                || matches!(compares, RawOperand::Text(t) if t == "literal")
        };
        let roles: Option<Vec<String>> = role_alternatives(&it.test, otherwise)
            .filter(|roles| {
                self.check_condition().is_empty()
                    && found.len() == roles.len() + 1
                    && found
                        .iter()
                        .filter(|(_, _, (compares, _), op, _)| role_shaped(compares, op))
                        .count()
                        == roles.len()
            })
            .map(|roles| roles.iter().map(|e| words(e)).collect());
        for (source, reads, (compares, compares_path), op, guard) in found {
            // The enclosing condition first, else the other operands of the `&&`.
            let (condition, unless) = match (self.check_condition(), guard, &roles) {
                ("", Some(g), Some(_)) if role_shaped(&compares, op) => (
                    drift_core::not_always::ALTERNATIVE_ROLE,
                    clip_words(format!("only when {g}")),
                ),
                ("", Some(_), Some(roles)) => (
                    drift_core::not_always::ROLE_ALTERNATIVE,
                    clip_words(format!("not when {}", roles.join(" || "))),
                ),
                ("", Some(g), None) => (
                    drift_core::not_always::AND_OPERAND,
                    clip_words(format!("only when {g}")),
                ),
                (c, _, _) => (c, String::new()),
            };
            let condition = if reassigned && condition.is_empty() {
                drift_core::not_always::UNREAD_LOCAL
            } else {
                condition
            };
            // The branch answers "not signed in" and the function goes on: the
            // check is found and proves nothing.
            let goes_on = self.check_goes_on
                && matches!(
                    outcome,
                    drift_core::CheckOutcome::Unauthenticated
                        | drift_core::CheckOutcome::SignInRedirect
                );
            let condition = if goes_on {
                drift_core::not_always::SWALLOWED
            } else {
                condition
            };
            let check = RawBodyCheck {
                source,
                reads,
                compares,
                outcome,
                op: op.to_string(),
                conditional: !condition.is_empty(),
                condition: condition.to_string(),
                unless,
                compares_path,
                after: self.order.clone(),
                caught: listed,
            };
            match &pending {
                Some(r) => {
                    let entry = (r.clone(), check);
                    if !self.builder_checks.contains(&entry) {
                        self.builder_checks.push(entry);
                    }
                }
                None => self.add_check(check),
            }
        }
        true
    }

    /// The values of the caller the conditions around the walk read: the innermost
    /// branch's, else, after a branch that returned a service, those of the
    /// branches that did (what follows ran for the others only).
    fn gate(&self) -> Vec<RawOperand> {
        match self.tests.last() {
            Some(t) => t.clone(),
            None if self.served => self.serving_tests.clone(),
            None => Vec::new(),
        }
    }

    /// The values a condition reads, whichever way it is taken: the callee a
    /// session or a signature is read by, the header or the secret compared.
    fn sources_of(&self, test: &Expression) -> Vec<RawOperand> {
        let mut found = Vec::new();
        self.condition(test, &mut found, 0, false);
        let mut out: Vec<RawOperand> = Vec::new();
        for (source, ..) in found {
            if source != RawOperand::None && !out.contains(&source) {
                out.push(source);
            }
        }
        out
    }

    /// Record what the walk is inside as read by an exit it could not read.
    fn note_unread_exit(&mut self, callee: Option<RawRef>, gate: &[RawOperand]) {
        for source in gate {
            let e = (callee.clone(), source.clone());
            if self.unread_exits.len() < MAX_ORDER && !self.unread_exits.contains(&e) {
                self.unread_exits.push(e);
            }
        }
    }

    /// What a value a branch hands back may be to the caller, where the lowering
    /// does not read it as a service: `Some(None)` a refusal, or a response whose
    /// status was not read; `Some(Some(callee))` a call of a function that is a
    /// refusal builder where linking says so.
    fn exit_kind(&self, e: &Expression) -> Option<Option<RawRef>> {
        use drift_core::CheckOutcome::{SignInRedirect, Unauthenticated};
        let e = peel(e);
        if !matches!(
            e,
            Expression::CallExpression(_) | Expression::NewExpression(_)
        ) {
            return None;
        }
        if matches!(self.exit_outcome(e), Some(Unauthenticated | SignInRedirect))
            || self.status_unread(e)
        {
            return Some(None);
        }
        if let Expression::CallExpression(c) = e
            && matches!(
                unwrap_expr(&c.callee),
                Expression::Identifier(_) | Expression::StaticMemberExpression(_)
            )
            && let Some(r) = self.l.canon_callee(&c.callee)
            && matches!(r.base, RawBase::Import { .. } | RawBase::Local(_))
            && r.member.matches('.').count() <= 1
        {
            return Some(Some(r));
        }
        None
    }

    /// A response built with a status the lowering does not read: an options
    /// argument that is a local or whose `status` is a name (`NextResponse.json(b,
    /// { status: UNAUTH })`, `new Response(null, init)`), or a call handed a name
    /// the file binds to a status (`fail(UNAUTH, "no")`).
    fn status_unread(&self, e: &Expression) -> bool {
        let (callee, args, is_new) = match e {
            Expression::CallExpression(c) => (&c.callee, &c.arguments, false),
            Expression::NewExpression(n) => (&n.callee, &n.arguments, true),
            _ => return false,
        };
        let response = match unwrap_expr(callee) {
            Expression::Identifier(id) if is_new => {
                matches!(id.name.as_str(), "Response" | "NextResponse")
            }
            Expression::StaticMemberExpression(m) if !is_new => {
                m.property.name == "json"
                    && matches!(unwrap_expr(&m.object), Expression::Identifier(o)
                        if matches!(o.name.as_str(), "Response" | "NextResponse"))
            }
            _ => false,
        };
        if response {
            return match args.get(1).and_then(|a| a.as_expression()).map(unwrap_expr) {
                Some(Expression::ObjectExpression(o)) => {
                    options_status(o).is_none()
                        && o.properties.iter().any(|p| match p {
                            ObjectPropertyKind::SpreadProperty(_) => true,
                            ObjectPropertyKind::ObjectProperty(p) => p
                                .key
                                .static_name()
                                .and_then(|n| {
                                    n.as_str().map(|n| matches!(n, "status" | "statusCode"))
                                })
                                .unwrap_or(false),
                        })
                }
                Some(Expression::Identifier(_) | Expression::CallExpression(_)) => true,
                _ => false,
            };
        }
        args.iter().any(|a| {
            matches!(a.as_expression().map(unwrap_expr),
                Some(Expression::Identifier(id)) if self.l.status_consts.contains(id.name.as_str()))
        })
    }

    /// A value the function hands back (`return` of it), in the places it may stand
    /// whole: a local (kept by name), the arms of a conditional, either side of a
    /// logical expression, a call. A call that is read as a refusal, or may be one,
    /// under a condition on the caller, is an exit the lowering does not read
    /// ([`RawSymbol::unread_exits`]) unless [`Collector::note_check`] read it.
    fn note_returned(
        &mut self,
        e: &Expression,
        covered: bool,
        gate: Option<&[RawOperand]>,
        depth: u8,
    ) {
        if depth > 4 {
            return;
        }
        let e = peel(e);
        match e {
            Expression::Identifier(id) => {
                self.returned_names.insert(id.name.to_string());
            }
            Expression::ConditionalExpression(c) => {
                let test = self.sources_of(&c.test);
                let gate = if test.is_empty() { self.gate() } else { test };
                self.note_returned(&c.consequent, false, Some(&gate), depth + 1);
                self.note_returned(&c.alternate, false, Some(&gate), depth + 1);
            }
            Expression::LogicalExpression(l) => {
                self.note_returned(&l.left, false, gate, depth + 1);
                self.note_returned(&l.right, false, gate, depth + 1);
            }
            Expression::CallExpression(_) | Expression::NewExpression(_) => {
                let gate = gate.map_or_else(|| self.gate(), <[RawOperand]>::to_vec);
                // A branch whose exit was read as a refusal answers for the call it
                // returns, unless the status of what it hands back is not read.
                if !gate.is_empty()
                    && (!covered || self.status_unread(e))
                    && let Some(callee) = self.exit_kind(e)
                {
                    self.note_unread_exit(callee, &gate);
                }
            }
            _ => {}
        }
    }

    /// A local bound to a value that may be a refusal: kept, with what the walk is
    /// inside, to be recorded where the body returns the local.
    fn note_bound(&mut self, name: &str, e: &Expression, depth: u8) {
        if depth > 4 {
            return;
        }
        let e = peel(e);
        match e {
            Expression::ConditionalExpression(c) => {
                self.note_bound(name, &c.consequent, depth + 1);
                self.note_bound(name, &c.alternate, depth + 1);
            }
            Expression::LogicalExpression(l) => {
                self.note_bound(name, &l.left, depth + 1);
                self.note_bound(name, &l.right, depth + 1);
            }
            Expression::CallExpression(_) | Expression::NewExpression(_) => {
                let gate = self.gate();
                if !gate.is_empty()
                    && let Some(callee) = self.exit_kind(e)
                    && self.pending_exits.len() < MAX_ORDER
                {
                    self.pending_exits.push((name.to_string(), callee, gate));
                }
            }
            _ => {}
        }
    }

    /// The returns of a branch whose exit [`Collector::note_check`] read.
    fn cover(&mut self, s: &Statement) {
        match s {
            Statement::ReturnStatement(r) => {
                self.covered_returns.insert(r.span.start);
            }
            Statement::BlockStatement(b) => b.body.iter().for_each(|s| self.cover(s)),
            _ => {}
        }
    }

    /// The branch returns a call of a function that may be a refusal builder
    /// ([`RawSymbol::refusal_builder`]): one of this file, with its status, or
    /// one of another module of the repository, to be told by linking (its
    /// reference; `Unauthenticated` stands until linking says).
    fn builder_returned(
        &self,
        s: &Statement,
    ) -> Option<(drift_core::CheckOutcome, Option<RawRef>)> {
        let r = match s {
            Statement::ReturnStatement(r) => r,
            Statement::BlockStatement(b) => match b.body.as_slice() {
                [Statement::ReturnStatement(r)] => r,
                _ => return None,
            },
            _ => return None,
        };
        let Expression::CallExpression(c) = peel(r.argument.as_ref()?) else {
            return None;
        };
        let Expression::Identifier(_) = unwrap_expr(&c.callee) else {
            return None;
        };
        let callee = self.l.canon_callee(&c.callee)?;
        match &callee.base {
            RawBase::Local(name) if callee.member.is_empty() => {
                self.l.builders.get(name).map(|o| (*o, None))
            }
            // A package's function is no builder of the repository: linking keeps
            // none for it.
            RawBase::Import { .. } if callee.member.is_empty() => {
                Some((drift_core::CheckOutcome::Unauthenticated, Some(callee)))
            }
            _ => None,
        }
    }

    /// The returned expression is a response built as a value (`NextResponse.json(body,
    /// { status: 401 })`, `new Response(null, { status: 401 })`, `c.json(body, 401)`),
    /// not one sent where it stands: no status set on a response the function was
    /// handed (`res.status(401).json()`, `reply.code(401).send()`), no error handed
    /// to the framework (`next(createError(401))`), no helper that throws
    /// (`reply.unauthorized()`).
    fn hands_back_value(&self, e: &Expression) -> bool {
        let mut cur = peel(e);
        if matches!(cur, Expression::NewExpression(_)) {
            return true;
        }
        if !matches!(cur, Expression::CallExpression(_)) {
            return false;
        }
        while let Expression::CallExpression(c) = cur {
            if self.continues(&c.callee)
                || matches!(
                    call_name(&c.callee),
                    Some(
                        "status"
                            | "code"
                            | "sendStatus"
                            | "writeHead"
                            | "unauthorized"
                            | "forbidden"
                            | "redirect"
                            | "permanentRedirect"
                    )
                )
            {
                return false;
            }
            cur = match unwrap_expr(&c.callee) {
                Expression::StaticMemberExpression(m) => unwrap_expr(&m.object),
                _ => break,
            };
        }
        true
    }

    /// The statement leaves the function without handing the request on: it throws,
    /// or returns anything but a call of the continuation (`return next()`), on
    /// every path.
    fn leaves_for_good(&self, s: &Statement) -> bool {
        match s {
            Statement::ThrowStatement(_) => true,
            Statement::ReturnStatement(r) => !matches!(
                r.argument.as_ref().map(peel),
                Some(Expression::CallExpression(c)) if self.hands_on(c)
            ),
            Statement::BlockStatement(b) => b.body.last().is_some_and(|l| self.leaves_for_good(l)),
            Statement::IfStatement(i) => {
                self.leaves_for_good(&i.consequent)
                    && i.alternate
                        .as_ref()
                        .is_some_and(|a| self.leaves_for_good(a))
            }
            // Next.js's `redirect()`, `notFound()`, `unauthorized()` and
            // `forbidden()` throw: nothing after them runs.
            Statement::ExpressionStatement(x) => {
                matches!(peel(&x.expression), Expression::CallExpression(c)
                if self.l.canon_callee(&c.callee).is_some_and(|r| {
                    matches!(&r.base, RawBase::Import { spec, name }
                        if spec == "next/navigation"
                            && matches!(
                                name.as_str(),
                                "redirect"
                                    | "permanentRedirect"
                                    | "notFound"
                                    | "unauthorized"
                                    | "forbidden"
                            ))
                        && r.member.is_empty()
                }))
            }
            _ => false,
        }
    }

    /// After the branch `s`, which answers the caller, the function goes on: the
    /// branch hands the request on itself (`res.status(401).json({}); return
    /// next();`), or it does not leave and something follows it that is not a
    /// statement that leaves ([`Collector::followed`]).
    fn branch_goes_on(&self, s: &Statement) -> bool {
        let hands_on = |s: &Statement| match s {
            Statement::ExpressionStatement(x) => {
                matches!(peel(&x.expression), Expression::CallExpression(c) if self.hands_on(c))
            }
            Statement::ReturnStatement(r) => matches!(
                r.argument.as_ref().map(peel),
                Some(Expression::CallExpression(c)) if self.hands_on(c)
            ),
            _ => false,
        };
        let handed = match s {
            Statement::BlockStatement(b) => b.body.iter().any(hands_on),
            s => hands_on(s),
        };
        if handed {
            return true;
        }
        if self.leaves_for_good(s) {
            return false;
        }
        // What follows, from the innermost list of statements outwards.
        self.followed.iter().rev().find(|f| **f != 0) == Some(&2)
    }

    /// `st` binds what a call hands back, and a statement after it in the same list
    /// returns that value when there is one: `const denied = await
    /// requireSession(req); if (denied) return denied;`, `if (res instanceof
    /// Response) return res;`, `const { error } = await requireUser(req); if (error)
    /// return error;`, `const auth = ...; if (auth.error) return auth.error;`.
    /// Recorded where every request reaches the pair
    /// ([`RawSymbol::result_uses`]).
    fn note_returned_result(&mut self, st: &Statement, rest: &[Statement]) {
        if self.branches > 0 || self.served || self.in_catch > 0 || self.in_callback > 0 {
            return;
        }
        let Statement::VariableDeclaration(v) = st else {
            return;
        };
        let [d] = v.declarations.as_slice() else {
            return;
        };
        let Some(Expression::CallExpression(call)) = d.init.as_ref().map(peel) else {
            return;
        };
        let Some(callee) = self.l.canon_callee(&call.callee) else {
            return;
        };
        // The locals to look for, each with the key it is under ("" for the value).
        let mut names: Vec<(&str, String)> = Vec::new();
        match &d.id {
            BindingPattern::BindingIdentifier(id) => names.push((id.name.as_str(), String::new())),
            BindingPattern::ObjectPattern(o) => {
                for p in &o.properties {
                    if let (Some(k), BindingPattern::BindingIdentifier(local)) =
                        (key_name(&p.key), &p.value)
                    {
                        names.push((local.name.as_str(), format!(".{k}")));
                    }
                }
            }
            _ => {}
        }
        for s in rest {
            let Statement::IfStatement(i) = s else {
                continue;
            };
            for (name, key) in &names {
                if let Some(member) = returns_when_set(i, name) {
                    // A member of a destructured local is not followed.
                    if key.is_empty() || member.is_empty() {
                        self.result_returned
                            .insert((callee.clone(), format!("{key}{member}")));
                    }
                }
            }
        }
    }

    /// The status a response or error expression sends: a status setter in its chain
    /// (`res.status(401).json()`), an options object (`{ status: 401 }`), a numeric
    /// argument (`c.json(b, 401)`, `new HTTPException(401)`), a tRPC code, or a Nest
    /// exception class.
    fn response_status(&self, e: &Expression) -> Option<u16> {
        match peel(e) {
            Expression::CallExpression(c) => self.sent_status(Sent::Call(c)),
            Expression::NewExpression(n) => self.sent_status(Sent::New(n)),
            _ => None,
        }
    }

    fn sent_status(&self, x: Sent) -> Option<u16> {
        let (callee, args, is_new) = x.parts();
        if describes_responses(callee) {
            return None;
        }
        if let Some(s) = chain_status(callee) {
            return Some(s);
        }
        if is_new
            && let Some(name) = call_name(callee)
            && let Some(s) = drift_core::practice::nest_status(name)
        {
            return Some(s);
        }
        for (i, a) in args.iter().enumerate() {
            let Some(x) = a.as_expression().map(unwrap_expr) else {
                continue;
            };
            if let Expression::ObjectExpression(o) = x
                && let Some(s) = options_status(o)
            {
                return Some(s);
            }
            if (i > 0 || is_new || call_name(callee) == Some("sendStatus"))
                && let Some(s) = literal_status(x)
            {
                return Some(s);
            }
        }
        None
    }

    /// The response a call or `new` sends, if it is one, with the way it is sent when
    /// the expression itself says (a redirect, `notFound()`).
    fn response_of(&self, x: Sent) -> Option<(RawResponse, Option<drift_core::ResponseVia>)> {
        use drift_core::ResponseVia;
        let throwing = matches!(self.p.exit, Some((at, ResponseVia::Throw)) if at == x.start());
        let make = |status: u16, builder: Option<RawRef>, keys: Vec<String>| RawResponse {
            status,
            via: ResponseVia::Return,
            builder,
            model: None,
            keys,
            in_catch: self.in_catch > 0,
        };
        match x {
            Sent::New(n) => {
                let r = self.l.canon(&n.callee)?;
                let name = call_name(&n.callee).unwrap_or("");
                let response_class = matches!(&r.base, RawBase::Global(g) if g == "Response" && r.member.is_empty())
                    || is_next_response(&r);
                let status = self.sent_status(x);
                let error_class = drift_core::practice::nest_status(name).is_some()
                    || matches!(
                        name,
                        "TRPCError" | "HttpException" | "HTTPException" | "HttpError" | "HTTPError"
                    );
                if !(response_class || (throwing && (status.is_some() || error_class))) {
                    return None;
                }
                let mut b = r;
                b.member.push_str("(new)");
                let keys = if response_class {
                    body_keys(n.arguments.first().and_then(|a| a.as_expression()))
                } else {
                    vec![]
                };
                let status = status.unwrap_or(if response_class { 200 } else { 0 });
                Some((make(status, Some(b), keys), None))
            }
            Sent::Call(c) => {
                let name = call_name(&c.callee)?;
                let r = self.l.canon_callee(&c.callee);
                let first = c.arguments.first().and_then(|a| a.as_expression());
                let imported = |pkg: &str| matches!(&r, Some(RawRef { base: RawBase::Import { spec, .. }, .. }) if spec == pkg);
                // `next/navigation`: `redirect()` and `notFound()` throw.
                if matches!(name, "redirect" | "permanentRedirect") && imported("next/navigation") {
                    let s = if name == "redirect" { 307 } else { 308 };
                    return Some((make(s, r, vec![]), Some(ResponseVia::Redirect)));
                }
                if name == "notFound" && imported("next/navigation") {
                    return Some((make(404, r, vec![]), Some(ResponseVia::Throw)));
                }
                let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee) else {
                    // `throw createError(404)`, `throw error(401, "..")`.
                    if throwing
                        && let Some(s) = first
                            .and_then(literal_status)
                            .or_else(|| self.sent_status(x))
                    {
                        return Some((make(s, r, vec![]), None));
                    }
                    return None;
                };
                // `res` / `reply` / `c` as a handler parameter (not a fetch result).
                let res_like = chain_root_ident(&m.object).is_some_and(|id| {
                    RESPONSE_RECEIVERS.contains(&id.name.as_str())
                        && self
                            .symbol_of(id)
                            .is_some_and(|s| self.p.params.contains_key(&s))
                });
                let builder_root = r.as_ref().is_some_and(|r| {
                    is_next_response(&RawRef {
                        base: r.base.clone(),
                        member: String::new(),
                    }) || matches!(&r.base, RawBase::Global(g) if g == "Response")
                });
                let has_setter = chain_status(&m.object).is_some();
                if RESPONSE_METHODS.contains(&name) && (builder_root || res_like || has_setter) {
                    let status = if name == "redirect" {
                        first
                            .and_then(literal_status)
                            .or_else(|| self.sent_status(x))
                            .unwrap_or(if builder_root { 307 } else { 302 })
                    } else {
                        self.sent_status(x).unwrap_or(200)
                    };
                    let keys = if name == "redirect" {
                        vec![]
                    } else {
                        body_keys(first)
                    };
                    let builder = r.filter(|_| builder_root);
                    let via = (name == "redirect").then_some(ResponseVia::Redirect);
                    let via = via.or((!builder_root).then_some(ResponseVia::Setter));
                    return Some((make(status, builder, keys), via));
                }
                // `res.status(401)` on its own.
                if STATUS_SETTERS.contains(&name)
                    && res_like
                    && let Some(s) = first.and_then(literal_status)
                {
                    return Some((make(s, None, vec![]), Some(ResponseVia::Setter)));
                }
                if throwing && let Some(s) = self.sent_status(x) {
                    return Some((make(s, r, vec![]), None));
                }
                None
            }
        }
    }

    /// Record the response `x` sends, if any (once per chain).
    fn note_response(&mut self, x: Sent) {
        use drift_core::ResponseVia;
        let start = x.start();
        if self.p.consumed.contains(&start) {
            return;
        }
        let Some((mut resp, via)) = self.response_of(x) else {
            return;
        };
        let exit = self.p.exit.filter(|(at, _)| *at == start).map(|(_, v)| v);
        resp.via = match (via, exit) {
            (Some(ResponseVia::Redirect), _) => ResponseVia::Redirect,
            (_, Some(v)) => v,
            (Some(v), None) => v,
            (None, None) => ResponseVia::Return,
        };
        // The calls inside the chain are part of this response.
        let mut cur = match x {
            Sent::Call(c) => Some(&c.callee),
            Sent::New(_) => None,
        };
        while let Some(callee) = cur {
            cur = None;
            if let Expression::StaticMemberExpression(m) = unwrap_expr(callee)
                && let Expression::CallExpression(inner) = unwrap_expr(&m.object)
            {
                self.p.consumed.insert(inner.span.start);
                cur = Some(&inner.callee);
            }
        }
        if let Some(f) = self.p.frames.last_mut() {
            f.does.insert((format!("respond:{}", resp.status), None));
        }
        self.p.sent += 1;
        self.p.responses.insert(resp);
    }

    /// A log-call candidate: a level-named method ([`drift_core::practice::LOG_LEVELS`])
    /// on a receiver with a canonical name (`console`, an import, a top-level binding,
    /// an injected or constructed `this.logger`).
    fn note_log_call(&mut self, it: &CallExpression) {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) else {
            return;
        };
        let method = m.property.name.as_str();
        let Some(level) = drift_core::practice::normalize_level(method) else {
            return;
        };
        if level == "print" {
            return;
        }
        let callee = self.l.canon_callee(&it.callee).or_else(|| {
            let Expression::StaticMemberExpression(o) = unwrap_expr(&m.object) else {
                return None;
            };
            if !matches!(unwrap_expr(&o.object), Expression::ThisExpression(_)) {
                return None;
            }
            let mut r = self
                .l
                .this_news
                .borrow()
                .get(o.property.name.as_str())?
                .clone();
            r.member.push('.');
            r.member.push_str(method);
            Some(r)
        });
        let Some(callee) = callee else { return };
        if matches!(&callee.base, RawBase::Global(g) if g != "console") {
            return;
        }
        let caught = |e: &Expression| match unwrap_expr(e) {
            Expression::Identifier(id) => self
                .symbol_of(id)
                .is_some_and(|s| self.p.frames.iter().any(|f| f.param == Some(s))),
            _ => false,
        };
        let mut structured = false;
        let mut passes_error = false;
        for a in &it.arguments {
            let Some(x) = a.as_expression().map(unwrap_expr) else {
                continue;
            };
            if let Expression::ObjectExpression(o) = x {
                structured = true;
                passes_error |= o.properties.iter().any(|p| match p {
                    ObjectPropertyKind::ObjectProperty(p) => caught(&p.value),
                    ObjectPropertyKind::SpreadProperty(_) => false,
                });
            }
            passes_error |= caught(x);
        }
        if let Some(f) = self.p.frames.last_mut() {
            f.does.insert(("log".into(), None));
        }
        self.p.log_calls.insert(RawLogCall {
            callee,
            level: level.to_string(),
            in_catch: self.in_catch > 0,
            structured,
            passes_error,
        });
    }

    /// The expression reads request input: a local bound to it, an input name
    /// (`input`, `params`, `searchParams`), `req.body`, `await req.json()`, or a call or
    /// object built from one.
    fn mentions_input(&self, e: &Expression, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        match peel(e) {
            Expression::Identifier(id) => {
                INPUT_NAMES.contains(&id.name.as_str())
                    || self
                        .symbol_of(id)
                        .is_some_and(|s| self.p.input_vars.contains(&s))
            }
            Expression::StaticMemberExpression(m) => {
                let on_request = match peel(&m.object) {
                    Expression::Identifier(id) => matches!(id.name.as_str(), "req" | "request"),
                    Expression::StaticMemberExpression(o) => o.property.name == "req",
                    _ => false,
                };
                (on_request && input::REQUEST_INPUT_MEMBERS.contains(&m.property.name.as_str()))
                    || INPUT_NAMES.contains(&m.property.name.as_str())
                    || self.mentions_input(&m.object, depth + 1)
            }
            Expression::CallExpression(c) => {
                self.mentions_input(&c.callee, depth + 1)
                    || c.arguments
                        .iter()
                        .filter_map(|a| a.as_expression())
                        .any(|a| self.mentions_input(a, depth + 1))
            }
            Expression::ObjectExpression(o) => o.properties.iter().any(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => self.mentions_input(&p.value, depth + 1),
                ObjectPropertyKind::SpreadProperty(s) => {
                    self.mentions_input(&s.argument, depth + 1)
                }
            }),
            _ => false,
        }
    }

    /// Schemas request input is validated into: `Schema.parse(await req.json())`,
    /// valibot `parse(Schema, body)`, class-transformer `plainToInstance(Dto, body)`,
    /// next-safe-action `.schema(S).action(fn)` / `.inputSchema(S)`.
    fn note_input(&mut self, it: &CallExpression) {
        let Some(name) = call_name(&it.callee) else {
            return;
        };
        let arg = |i: usize| it.arguments.get(i).and_then(|a| a.as_expression());
        let schema_ref = |e: &Expression| {
            self.l
                .canon(e)
                .filter(|r| !matches!(r.base, RawBase::Global(_)))
        };
        let callee = self.l.canon_callee(&it.callee);
        let from = |pkgs: &[&str]| matches!(&callee, Some(RawRef { base: RawBase::Import { spec, .. }, .. }) if pkgs.contains(&spec.as_str()));
        let found = if from(&["valibot"])
            && matches!(
                name,
                "parse" | "safeParse" | "parseAsync" | "safeParseAsync"
            ) {
            arg(1)
                .filter(|x| self.mentions_input(x, 0))
                .and(arg(0))
                .and_then(schema_ref)
        } else if from(&["class-transformer"]) && matches!(name, "plainToInstance" | "plainToClass")
        {
            arg(1)
                .filter(|x| self.mentions_input(x, 0))
                .and(arg(0))
                .and_then(schema_ref)
        } else if name == "action"
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && let Expression::CallExpression(inner) = unwrap_expr(&m.object)
            && matches!(call_name(&inner.callee), Some("schema" | "inputSchema"))
        {
            inner
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(schema_ref)
        } else if SCHEMA_METHODS.contains(&name)
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && arg(0).is_some_and(|x| self.mentions_input(x, 0))
        {
            schema_ref(&m.object)
        } else {
            None
        };
        if let Some(r) = found {
            self.p.inputs.insert(r);
        }
    }

    /// The argument registers a handler: a function written in place, or a name bound
    /// at module level or imported (`app.onError(handleError)`). A value made on the
    /// spot or a local says the call reports an error to a callback instead
    /// (`callbacks.onError(new Error("..."))`, `opts.onError(err)` in a `catch`).
    fn names_handler(&self, e: &Expression) -> bool {
        match unwrap_expr(e) {
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
            Expression::Identifier(id) => {
                matches!(
                    self.l.resolve_ident(id),
                    Some(RawBase::Import { .. } | RawBase::Local(_))
                )
            }
            _ => false,
        }
    }

    /// Error handlers registered by this call: Hono `app.onError(fn)`, Fastify
    /// `setErrorHandler(fn)`, an Express error middleware given to `app.use`, and
    /// `initTRPC.create({ errorFormatter })`.
    fn note_error_handler(&mut self, it: &CallExpression) {
        let any = || RawOperand::Text("*".into());
        match call_name(&it.callee) {
            Some("onError" | "setErrorHandler")
                if matches!(unwrap_expr(&it.callee), Expression::StaticMemberExpression(_))
                    && it.arguments.first().and_then(|a| a.as_expression()).is_some_and(|a| self.names_handler(a)) =>
            {
                self.p.handles.insert(any());
            }
            Some("use") => {
                if it.arguments.iter().filter_map(|a| a.as_expression()).any(|a| match unwrap_expr(a) {
                    Expression::ArrowFunctionExpression(f) => error_middleware(&f.params),
                    Expression::FunctionExpression(f) => error_middleware(&f.params),
                    _ => false,
                }) {
                    self.p.handles.insert(any());
                }
            }
            Some("create")
                if it.arguments.iter().filter_map(|a| a.as_expression()).any(|a| {
                    matches!(unwrap_expr(a), Expression::ObjectExpression(o) if routes_object_has(o, "errorFormatter"))
                }) && chain_root_name(&it.callee) == Some("initTRPC") =>
            {
                self.p.handles.insert(any());
            }
            _ => {}
        }
    }

    /// Environment reads through a module constant or a literal-keyed dict
    /// (`process.env[KEY]`, `process.env[ENV.db]`, `process.env["X"]`).
    fn note_env_index(&mut self, m: &ComputedMemberExpression) {
        let Expression::StaticMemberExpression(inner) = unwrap_expr(&m.object) else {
            return;
        };
        if inner.property.name != "env" {
            return;
        }
        let prefix = match unwrap_expr(&inner.object) {
            Expression::Identifier(p)
                if p.name == "process"
                    && matches!(self.l.resolve_ident(p), Some(RawBase::Global(_))) =>
            {
                "process.env"
            }
            Expression::ImportMeta(_) => "import.meta.env",
            _ => return,
        };
        if let Some(name) = self.l.env_key(&m.expression) {
            let var = format!("{prefix}.{name}");
            if self.server_only == 0 {
                self.browser_reads.insert(var.clone());
            }
            self.reads.insert(var);
        }
    }

    /// A call of a possible environment helper with a name it reads
    /// (`env("DATABASE_URL")`, `getEnv(KEY)`): kept for linking.
    fn note_env_call(&mut self, it: &CallExpression) {
        let Some(r) = self.l.canon_callee(&it.callee) else {
            return;
        };
        if matches!(r.base, RawBase::Global(_)) || r.member.contains('(') {
            return;
        }
        for (i, a) in it.arguments.iter().enumerate().take(4) {
            if let Some(name) = a.as_expression().and_then(|x| self.l.env_key(x))
                && name
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
                && self.p.env_calls.len() < MAX_ENV_CALLS
            {
                let i = u32::try_from(i).unwrap_or(u32::MAX);
                self.p
                    .env_calls
                    .insert((r.clone(), i, name, self.server_only > 0));
            }
        }
    }
}

impl Collector<'_, '_> {
    /// Remember what a local binding holds ([`Practice::bound`], [`Practice::input_vars`]).
    fn note_binding(&mut self, id: &BindingPattern, init: &Expression) {
        if let Expression::CallExpression(c) = peel(init)
            && let Some(lib) = self.always_present(c)
        {
            match id {
                BindingPattern::BindingIdentifier(b) => {
                    if let Some(s) = b.symbol_id.get() {
                        self.p.present.insert(s);
                    }
                }
                // `const { isAuthenticated } = getKindeServerSession()`.
                BindingPattern::ObjectPattern(o) => {
                    for p in &o.properties {
                        if let BindingPattern::BindingIdentifier(b) = &p.value
                            && let Some(k) = key_name(&p.key)
                            && ASYNC_PREDICATES
                                .iter()
                                .any(|(l, names)| *l == lib && names.contains(&k.as_str()))
                            && let Some(s) = b.symbol_id.get()
                        {
                            self.p.promised.insert(s);
                        }
                    }
                }
                _ => {}
            }
        }
        let input = self.mentions_input(init, 0);
        // The answer of a constant-time compare is what the compare says, not the
        // secret it was given (`const ok = timingSafeEqual(given, secret)`).
        let compare = matches!(peel(init), Expression::CallExpression(c)
            if call_name(&c.callee) == Some("timingSafeEqual") && self.verifier_check(c).is_some());
        let held = if self.env_derived(init, 0) && !compare {
            Some((RawOperand::Text(ENV_COMPARED.into()), String::new()))
        } else {
            match peel(init) {
                // `const wh = new Webhook(secret)`.
                Expression::NewExpression(n) => self.l.canon(&n.callee).map(|mut r| {
                    r.member.push_str("(new)");
                    (RawOperand::Ref(r), String::new())
                }),
                _ => self.operand(init, 0),
            }
        };
        match id {
            BindingPattern::BindingIdentifier(b) => {
                let Some(s) = b.symbol_id.get() else { return };
                self.p.initialised.insert(s);
                if input {
                    self.p.input_vars.insert(s);
                }
                if let Expression::NewExpression(n) = peel(init)
                    && n.arguments
                        .iter()
                        .filter_map(|a| a.as_expression())
                        .any(|a| self.env_derived(a, 0))
                {
                    self.p.env_secrets.insert(s);
                }
                if let Some(h) = held {
                    self.p.bound.insert(s, h);
                }
            }
            BindingPattern::ObjectPattern(o) => {
                for p in &o.properties {
                    let b = match &p.value {
                        BindingPattern::BindingIdentifier(b) => b,
                        BindingPattern::AssignmentPattern(a) => match &a.left {
                            BindingPattern::BindingIdentifier(b) => b,
                            _ => continue,
                        },
                        _ => continue,
                    };
                    let Some(s) = b.symbol_id.get() else { continue };
                    if input {
                        self.p.input_vars.insert(s);
                    }
                    if !p.computed
                        && let Some(k) = key_name(&p.key)
                        && let Some((src, mut path)) = held.clone()
                    {
                        if path.matches('.').count() < MAX_MEMBER_DEPTH {
                            path.push('.');
                            path.push_str(&k);
                        }
                        self.p.bound.insert(s, (src, path));
                    }
                }
            }
            _ => {}
        }
    }
}

/// Request headers that say nothing of who sends the request: the size, the type and
/// the encoding of what it carries, what it accepts. A limit on them is not a check
/// of the caller ([`Collector::caller_free`]).
const NOT_OF_THE_CALLER: &[&str] = &[
    "content-length",
    "content-type",
    "content-encoding",
    "accept",
    "accept-encoding",
    "accept-language",
];

/// A branch that does nothing but answer or leave: statements of its own, no `if`, loop
/// or `try` inside it, so that what it holds is all the answer.
fn simple_branch(s: &Statement) -> bool {
    match s {
        Statement::BlockStatement(b) => b.body.iter().all(simple_branch),
        Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_)
        | Statement::ExpressionStatement(_) => true,
        _ => false,
    }
}

/// Whether an expression reads a local the body assigns more than once: its
/// declaration's initialiser and an assignment, or two assignments. What such a local
/// holds where it is read is not what any one of them gave it.
struct ReassignedReads<'s> {
    scoping: &'s Scoping,
    initialised: &'s HashSet<SymbolId>,
    found: bool,
}

impl<'a> Visit<'a> for ReassignedReads<'_> {
    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(s) = it
            .reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id())
        {
            let writes = self
                .scoping
                .get_resolved_references(s)
                .filter(|r| r.is_write())
                .count()
                + usize::from(self.initialised.contains(&s));
            if writes >= 2 {
                self.found = true;
            }
        }
    }
}

/// [`drift_core::BodyCheck::compares`] for an env-derived secret (the name never echoed).
const ENV_COMPARED: &str = "env";

/// [`drift_core::BodyCheck::compares`] of a webhook verifier given a secret written in the
/// code (`constructEvent(body, sig, "")`): never the service's own secret.
const LITERAL_SECRET: &str = "literal";

/// A string written in place: a literal, or a template with nothing in it.
fn is_literal_text(e: &Expression) -> bool {
    match peel(e) {
        Expression::StringLiteral(_) => true,
        Expression::TemplateLiteral(t) => t.expressions.is_empty(),
        _ => false,
    }
}

/// Library accessors that always hand back a value, never null or undefined: a test
/// of what one hands back for being there refuses no one; a test of a member of it
/// (`session.user`) does. (package, imported name). A closed list.
const ALWAYS_PRESENT: &[(&str, &str)] = &[
    ("iron-session", "getIronSession"),
    ("iron-session", "getSession"),
    ("@kinde-oss/kinde-auth-nextjs", "getKindeServerSession"),
    ("next/headers", "cookies"),
    ("next/headers", "headers"),
];

/// The functions an accessor on [`ALWAYS_PRESENT`] hands back that answer with a
/// Promise: negated without `await`, a call of one is always false. A closed list.
const ASYNC_PREDICATES: &[(&str, &[&str])] = &[(
    "@kinde-oss/kinde-auth-nextjs",
    &[
        "isAuthenticated",
        "getUser",
        "getPermission",
        "getPermissions",
        "getOrganization",
        "getUserOrganizations",
        "getRoles",
        "getClaim",
        "getAccessToken",
        "getIdToken",
        "getFlag",
        "getBooleanFlag",
    ],
)];

/// Collects every function parameter binding of a file ([`Lowerer::params`]).
struct ParamFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    found: HashMap<SymbolId, (String, Option<RawRef>)>,
    builtins: HashMap<SymbolId, BTreeSet<String>>,
}

/// The members an object type literal gives a built-in value's type: a string, a
/// number, a boolean, a bigint, or an array (`T[]`, `readonly T[]`, `Array<T>`,
/// `ReadonlyArray<T>`), each declared once by a plain name. Nothing else: a union, a
/// name Drift would have to resolve, a member declared twice.
fn builtin_members(t: &TSType) -> BTreeSet<String> {
    fn builtin(t: &TSType) -> bool {
        match t {
            TSType::TSStringKeyword(_)
            | TSType::TSNumberKeyword(_)
            | TSType::TSBooleanKeyword(_)
            | TSType::TSBigIntKeyword(_)
            | TSType::TSArrayType(_) => true,
            TSType::TSTypeOperatorType(o) => matches!(o.type_annotation, TSType::TSArrayType(_)),
            TSType::TSTypeReference(r) => {
                r.type_arguments.is_some()
                    && matches!(&r.type_name, TSTypeName::IdentifierReference(id)
                        if id.name == "Array" || id.name == "ReadonlyArray")
            }
            _ => false,
        }
    }
    let TSType::TSTypeLiteral(lit) = t else {
        return BTreeSet::new();
    };
    let mut seen: BTreeMap<String, bool> = BTreeMap::new();
    for m in &lit.members {
        let TSSignature::TSPropertySignature(p) = m else {
            continue;
        };
        let PropertyKey::StaticIdentifier(k) = &p.key else {
            continue;
        };
        let ok = !p.computed
            && p.type_annotation
                .as_ref()
                .is_some_and(|a| builtin(&a.type_annotation));
        seen.entry(k.name.to_string())
            .and_modify(|v| *v = false)
            .or_insert(ok);
    }
    seen.into_iter()
        .filter(|(_, ok)| *ok)
        .map(|(k, _)| k)
        .collect()
}

impl<'a> Visit<'a> for ParamFinder<'_, '_> {
    fn visit_formal_parameter(&mut self, it: &FormalParameter<'a>) {
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
        names(&it.pattern, &mut found);
        // `(server: FastifyZodProvider)`: a plain type name, imported or declared here.
        let ty = match (&it.pattern, &it.type_annotation) {
            (BindingPattern::BindingIdentifier(_), Some(t)) => match &t.type_annotation {
                TSType::TSTypeReference(r) if r.type_arguments.is_none() => match &r.type_name {
                    TSTypeName::IdentifierReference(id) => match self.l.resolve_ident(id) {
                        Some(base @ (RawBase::Local(_) | RawBase::Import { .. })) => Some(RawRef {
                            base,
                            member: String::new(),
                        }),
                        _ => None,
                    },
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        // `(params: { path: string[] })`: what the literal types as built-in values.
        let builtins = match (&it.pattern, &it.type_annotation) {
            (BindingPattern::BindingIdentifier(_), Some(t)) => builtin_members(&t.type_annotation),
            _ => BTreeSet::new(),
        };
        for (s, n) in found {
            if !builtins.is_empty() {
                self.builtins.insert(s, builtins.clone());
            }
            self.found.insert(s, (n, ty.clone()));
        }
        walk::walk_formal_parameter(self, it);
    }
}

/// Parameter names of a handler's request, response and continuation, whose members
/// are framework plumbing (`res.status()`, `req.log.info()`), not work handed on.
const PLUMBING_PARAMS: &[&str] = &[
    "req", "request", "res", "response", "reply", "h", "next", "done", "event",
];

/// Members of a request or a reply that are the framework's own: a method called
/// through one runs no code of the repository (`req.log.info()`,
/// `req.headers.get()`, `req.session.save()`).
const REQUEST_MEMBERS: &[&str] = &[
    "log",
    "logger",
    "headers",
    "header",
    "body",
    "query",
    "params",
    "raw",
    "socket",
    "cookies",
    "session",
    "nextUrl",
    "url",
    "req",
    "res",
    "json",
    "text",
    "formData",
    "signal",
    "connection",
    "server",
    "app",
    "locals",
    "routeOptions",
    "context",
];

/// Members of a Fastify instance that are its own, not a decoration.
/// And what the database and token plugins of `@fastify` decorate it with: a client
/// of a package, whose call is data access or signing (`app.pg.query(...)`).
const INSTANCE_MEMBERS: &[&str] = &[
    "log",
    "server",
    "prefix",
    "version",
    "initialConfig",
    "pg",
    "mysql",
    "redis",
    "mongo",
    "jwt",
];

/// Most calls through parameters kept per symbol.
const MAX_PARAM_CALLS: usize = 64;

/// Most candidate environment-helper calls kept per symbol.
const MAX_ENV_CALLS: usize = 64;
/// Most module constants and dict entries kept as environment names.
const MAX_ENV_CONSTS: usize = 256;
/// Most top-level text constants kept for a file ([`RawFile::text_consts`]).
const MAX_TEXT_CONSTS: usize = 64;
/// The longest text kept for one.
const MAX_TEXT_CONST: usize = 64;

/// The status a setter in a call chain sets (`res.status(401).json()` -> 401).
fn chain_status(callee: &Expression) -> Option<u16> {
    let mut cur = unwrap_expr(callee);
    for _ in 0..8 {
        let m = match cur {
            Expression::StaticMemberExpression(m) => m,
            Expression::CallExpression(c) => {
                cur = unwrap_expr(&c.callee);
                continue;
            }
            _ => return None,
        };
        if let Expression::CallExpression(c) = unwrap_expr(&m.object)
            && let Some(name) = call_name(&c.callee)
            && STATUS_SETTERS.contains(&name)
            && let Some(s) = c
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .and_then(literal_status)
        {
            return Some(s);
        }
        cur = unwrap_expr(&m.object);
    }
    None
}

/// The identifier a member or call chain starts from, as a reference.
fn chain_root_ident<'b, 'a>(e: &'b Expression<'a>) -> Option<&'b IdentifierReference<'a>> {
    let mut cur = unwrap_expr(e);
    for _ in 0..12 {
        cur = match cur {
            Expression::Identifier(id) => return Some(id),
            Expression::StaticMemberExpression(m) => unwrap_expr(&m.object),
            Expression::CallExpression(c) => unwrap_expr(&c.callee),
            Expression::AwaitExpression(a) => unwrap_expr(&a.argument),
            _ => return None,
        };
    }
    None
}

/// The identifier a member or call chain starts from (`res` of `res.status(1).json`).
fn chain_root_name<'b>(e: &'b Expression) -> Option<&'b str> {
    let mut cur = unwrap_expr(e);
    for _ in 0..12 {
        cur = match cur {
            Expression::Identifier(id) => return Some(id.name.as_str()),
            Expression::StaticMemberExpression(m) => unwrap_expr(&m.object),
            Expression::CallExpression(c) => unwrap_expr(&c.callee),
            Expression::AwaitExpression(a) => unwrap_expr(&a.argument),
            _ => return None,
        };
    }
    None
}

fn routes_object_has(o: &ObjectExpression, key: &str) -> bool {
    o.properties.iter().any(|p| match p {
        ObjectPropertyKind::ObjectProperty(p) => {
            !p.computed && p.key.static_name().is_some_and(|k| k.as_str() == Some(key))
        }
        _ => false,
    })
}

/// An Express error middleware's parameters: four, the first named for the error.
fn error_middleware(params: &FormalParameters) -> bool {
    params.items.len() == 4
        && matches!(&params.items[0].pattern, BindingPattern::BindingIdentifier(b)
            if matches!(b.name.as_str(), "err" | "error" | "e" | "ex" | "exception" | "_err" | "_error"))
}

fn is_next_response(r: &RawRef) -> bool {
    matches!(&r.base, RawBase::Import { spec, name }
        if (spec == "next/server" || spec == "next/dist/server/web/spec-extension/response")
            && name == "NextResponse")
        && (r.member.is_empty() || r.member.starts_with('.'))
}

fn is_next_headers_ref(r: &RawRef) -> bool {
    matches!(&r.base, RawBase::Import { spec, name } if spec == "next/headers" && name == "headers")
        && r.member.is_empty()
}

/// A call or `new` that may send a response.
#[derive(Clone, Copy)]
enum Sent<'b, 'a> {
    Call(&'b CallExpression<'a>),
    New(&'b NewExpression<'a>),
}

impl<'b, 'a> Sent<'b, 'a> {
    fn parts(
        self,
    ) -> (
        &'b Expression<'a>,
        &'b oxc_allocator::Vec<'a, Argument<'a>>,
        bool,
    ) {
        match self {
            Sent::Call(c) => (&c.callee, &c.arguments, false),
            Sent::New(n) => (&n.callee, &n.arguments, true),
        }
    }

    fn start(self) -> u32 {
        match self {
            Sent::Call(c) => c.span.start,
            Sent::New(n) => n.span.start,
        }
    }
}

/// HTTP methods a test may call a route handler or a client by.
const HTTP_VERBS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/// A request URL that is not a literal: a template with placeholders, or any other
/// expression (`` `${baseUrl}/api/x` ``, `url`). Which route is requested is unknown.
fn non_literal(e: Option<&Expression>) -> bool {
    match e.map(unwrap_expr) {
        None | Some(Expression::StringLiteral(_)) => false,
        Some(Expression::TemplateLiteral(t)) => !t.expressions.is_empty(),
        Some(_) => true,
    }
}

/// A test, spec or end-to-end file (as `roles::is_test_path` reads TypeScript paths):
/// only these record [`RawFile::test_requests`].
pub(crate) fn is_test_file(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(&lower);
    file.contains(".test.")
        || file.contains(".spec.")
        || file.contains(".e2e.")
        || lower.split('/').any(|d| {
            matches!(
                d,
                "__tests__" | "tests" | "test" | "e2e" | "cypress" | "playwright"
            )
        })
}

/// The expression holds `process.env[name]` (through `??`, `||`, conditionals, calls
/// on it and members of it).
fn reads_env_param(e: &Expression, name: &str, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    match unwrap_expr(e) {
        Expression::ComputedMemberExpression(m) => {
            let on_env = matches!(unwrap_expr(&m.object), Expression::StaticMemberExpression(o)
                if o.property.name == "env"
                    && matches!(unwrap_expr(&o.object), Expression::Identifier(p) if p.name == "process"));
            (on_env
                && matches!(unwrap_expr(&m.expression), Expression::Identifier(i) if i.name == name))
                || reads_env_param(&m.object, name, depth + 1)
        }
        Expression::LogicalExpression(l) => {
            reads_env_param(&l.left, name, depth + 1) || reads_env_param(&l.right, name, depth + 1)
        }
        Expression::ConditionalExpression(c) => {
            reads_env_param(&c.consequent, name, depth + 1)
                || reads_env_param(&c.alternate, name, depth + 1)
        }
        Expression::CallExpression(c) => {
            reads_env_param(&c.callee, name, depth + 1)
                || c.arguments
                    .iter()
                    .filter_map(|a| a.as_expression())
                    .any(|a| reads_env_param(a, name, depth + 1))
        }
        Expression::StaticMemberExpression(m) => reads_env_param(&m.object, name, depth + 1),
        Expression::AwaitExpression(a) => reads_env_param(&a.argument, name, depth + 1),
        _ => false,
    }
}

/// The parameter an environment helper reads the variable of: a function of at most
/// four statements (bindings, early exits, one `return`) that reads
/// `process.env[param]`, or a concise arrow that does (`(k) => process.env[k] ?? ""`).
fn env_helper_param(
    params: &FormalParameters,
    body: Option<&FunctionBody>,
    concise: Option<&Expression>,
) -> Option<u32> {
    if params.items.len() > 3 {
        return None;
    }
    let exprs: Vec<&Expression> = if let Some(e) = concise {
        vec![e]
    } else {
        let body = body?;
        if body.statements.len() > 4 {
            return None;
        }
        let mut out = Vec::new();
        for s in &body.statements {
            match s {
                Statement::ReturnStatement(r) => out.extend(r.argument.as_ref()),
                Statement::VariableDeclaration(v) => {
                    out.extend(v.declarations.iter().filter_map(|d| d.init.as_ref()))
                }
                Statement::IfStatement(i) if leaves(&i.consequent) => {}
                _ => return None,
            }
        }
        out
    };
    params.items.iter().enumerate().find_map(|(i, p)| {
        let BindingPattern::BindingIdentifier(b) = &p.pattern else {
            return None;
        };
        exprs
            .iter()
            .any(|e| reads_env_param(e, b.name.as_str(), 0))
            .then(|| u32::try_from(i).unwrap_or(u32::MAX))
    })
}

impl Lowerer<'_> {
    /// The expression is an environment read (`process.env.X`, `process.env[k]`,
    /// `import.meta.env.X`), through `??` / `||`, `!`, a template literal, a call made
    /// on or with one (`Buffer.from(process.env.X)`), a top-level constant bound to one,
    /// or an in-file environment helper's call.
    fn env_value(&self, e: &Expression, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        match peel(e) {
            Expression::StaticMemberExpression(m) => {
                self.env_read(m).is_some() || self.env_value(&m.object, depth + 1)
            }
            Expression::ComputedMemberExpression(m) => {
                matches!(unwrap_expr(&m.object), Expression::StaticMemberExpression(o)
                    if o.property.name == "env"
                        && matches!(unwrap_expr(&o.object), Expression::Identifier(p) if p.name == "process"))
            }
            Expression::LogicalExpression(l) => {
                self.env_value(&l.left, depth + 1) || self.env_value(&l.right, depth + 1)
            }
            Expression::TemplateLiteral(t) => {
                t.expressions.iter().any(|x| self.env_value(x, depth + 1))
            }
            Expression::CallExpression(c) => {
                matches!(unwrap_expr(&c.callee), Expression::Identifier(id)
                    if matches!(self.resolve_ident(id), Some(RawBase::Local(ref n)) if self.env_helpers.contains_key(n)))
                    || self.env_value(&c.callee, depth + 1)
                    || c.arguments
                        .iter()
                        .filter_map(|a| a.as_expression())
                        .any(|a| self.env_value(a, depth + 1))
            }
            Expression::Identifier(id) => {
                matches!(self.resolve_ident(id), Some(RawBase::Local(n)) if self.env_bound.contains(&n))
            }
            _ => false,
        }
    }

    /// An environment variable name an index expression spells: a literal, a module
    /// constant (`KEY`), or a literal-keyed dict entry (`ENV.db`, `ENV["db"]`).
    fn env_key(&self, e: &Expression) -> Option<String> {
        let local = |id: &IdentifierReference| match self.resolve_ident(id) {
            Some(RawBase::Local(n)) => Some(n),
            _ => None,
        };
        match unwrap_expr(e) {
            Expression::StringLiteral(l) => {
                let t = lit(l);
                env_name(&t).then_some(t)
            }
            Expression::Identifier(id) => self.env_consts.get(&local(id)?).cloned(),
            Expression::StaticMemberExpression(m) => match unwrap_expr(&m.object) {
                Expression::Identifier(id) => self
                    .env_consts
                    .get(&format!("{}.{}", local(id)?, m.property.name))
                    .cloned(),
                _ => None,
            },
            Expression::ComputedMemberExpression(m) => {
                match (unwrap_expr(&m.object), unwrap_expr(&m.expression)) {
                    (Expression::Identifier(id), Expression::StringLiteral(k)) => self
                        .env_consts
                        .get(&format!("{}.{}", local(id)?, lit(k)))
                        .cloned(),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Top-level facts read before the statements are lowered: environment-name
    /// constants and dicts, environment helpers, and middleware route matchers.
    fn practice_prepass(&mut self, program: &Program) {
        for stmt in &program.body {
            let decl = match stmt {
                Statement::VariableDeclaration(v) => Some(&**v),
                Statement::ExportNamedDeclaration(_) => None,
                Statement::ExportDeclaration(e) => match &e.declaration {
                    Declaration::VariableDeclaration(v) => Some(&**v),
                    Declaration::FunctionDeclaration(f) => {
                        self.note_env_helper_fn(f);
                        None
                    }
                    _ => None,
                },
                Statement::FunctionDeclaration(f) => {
                    self.note_env_helper_fn(f);
                    None
                }
                _ => None,
            };
            let Some(v) = decl else { continue };
            if !v.kind.is_const() {
                continue;
            }
            for d in &v.declarations {
                let (BindingPattern::BindingIdentifier(id), Some(init)) = (&d.id, &d.init) else {
                    continue;
                };
                let name = id.name.to_string();
                if let Expression::StringLiteral(l) = unwrap_expr(init)
                    && l.value.len() <= MAX_TEXT_CONST
                    && self.out.text_consts.len() < MAX_TEXT_CONSTS
                {
                    self.out.text_consts.push((name.clone(), lit(l)));
                }
                self.note_env_consts(&name, init);
                if self.env_value(init, 0) && self.env_bound.len() < MAX_ENV_CONSTS {
                    self.env_bound.insert(name.clone());
                }
                if let Expression::NewExpression(n) = peel(init)
                    && let Some(class) = self.canon(&n.callee)
                    && self.module_news.len() < MAX_ENV_CONSTS
                {
                    let env = n.arguments.iter().filter_map(|a| a.as_expression()).any(|a| {
                        self.env_value(a, 0)
                            || matches!(unwrap_expr(a), Expression::ObjectExpression(o)
                                if o.properties.iter().any(|p| matches!(p,
                                    ObjectPropertyKind::ObjectProperty(p) if self.env_value(&p.value, 0))))
                    });
                    self.module_news.insert(name.clone(), (class, env));
                }
                match unwrap_expr(init) {
                    Expression::ArrowFunctionExpression(a) => {
                        if let Some(i) =
                            env_helper_param(&a.params, a.get_function_body(), a.get_expression())
                        {
                            self.env_helpers.insert(name.clone(), i);
                        }
                        self.note_composed(&name, a.get_function_body(), a.get_expression());
                    }
                    Expression::FunctionExpression(f) => {
                        if let Some(body) = &f.body
                            && let Some(i) = env_helper_param(&f.params, Some(body), None)
                        {
                            self.env_helpers.insert(name.clone(), i);
                        }
                        self.note_composed(&name, f.body.as_deref(), None);
                    }
                    _ => {}
                }
                self.note_route_matchers(&name, init);
            }
        }
        self.out.env_helpers = self
            .env_helpers
            .iter()
            .map(|(n, i)| (n.clone(), *i))
            .collect();
        self.out.route_matchers.sort();
        self.out.route_matchers.dedup();
    }

    fn note_env_helper_fn(&mut self, f: &Function) {
        if let (Some(id), Some(body)) = (&f.id, &f.body)
            && !f.generator
            && let Some(i) = env_helper_param(&f.params, Some(body), None)
        {
            self.env_helpers.insert(id.name.to_string(), i);
        }
        if let (Some(id), Some(body)) = (&f.id, &f.body) {
            self.note_composed(&id.name, Some(body), None);
        }
    }

    /// A Nest decorator composed with `applyDecorators(...)` from `@nestjs/common`
    /// ([`RawFile::composed_decorators`]): what every `return applyDecorators(...)` of
    /// the function (or its concise body) composes. Any other returned call
    /// (`return EERequireAuthentication()`) is a decorator it may compose too.
    fn note_composed(
        &mut self,
        name: &str,
        body: Option<&FunctionBody>,
        concise: Option<&Expression>,
    ) {
        let mut returns = Returns { found: Vec::new() };
        if let Some(b) = body {
            returns.visit_function_body(b);
        }
        let mut exprs: Vec<&Expression> = returns.found;
        exprs.extend(concise);
        let mut guards = Vec::new();
        let mut inner = Vec::new();
        let mut composes = false;
        for e in exprs {
            let Expression::CallExpression(c) = peel(e) else {
                continue;
            };
            let Some(callee) = self.canon_callee(&c.callee) else {
                continue;
            };
            let applies = matches!(&callee, RawRef { base: RawBase::Import { spec, name }, member }
                if spec == "@nestjs/common" && name == "applyDecorators" && member.is_empty());
            if !applies {
                if !matches!(callee.base, RawBase::Global(_)) {
                    inner.push(callee);
                }
                continue;
            }
            composes = true;
            for a in c.arguments.iter().filter_map(|a| a.as_expression()) {
                let Expression::CallExpression(d) = unwrap_expr(a) else {
                    continue;
                };
                let Some(r) = self.canon_callee(&d.callee) else {
                    continue;
                };
                let use_guards = matches!(&r, RawRef { base: RawBase::Import { spec, name }, member }
                    if spec == "@nestjs/common" && name == "UseGuards" && member.is_empty());
                if !use_guards {
                    if !matches!(r.base, RawBase::Global(_)) {
                        inner.push(r);
                    }
                    continue;
                }
                for g in d.arguments.iter().filter_map(|a| a.as_expression()) {
                    let g = match unwrap_expr(g) {
                        Expression::CallExpression(f) => self.canon_callee(&f.callee),
                        Expression::NewExpression(n) => self.canon(&n.callee),
                        x => self.canon(x),
                    };
                    guards.extend(g);
                }
            }
        }
        if composes && self.out.composed_decorators.len() < MAX_ENV_CONSTS {
            guards.sort();
            guards.dedup();
            inner.sort();
            inner.dedup();
            self.out
                .composed_decorators
                .push((name.to_string(), guards, inner));
        }
    }

    /// `const KEY = "DATABASE_URL"`, and `const ENV = { db: "DATABASE_URL" }`.
    fn note_env_consts(&mut self, name: &str, init: &Expression) {
        if self.env_consts.len() >= MAX_ENV_CONSTS {
            return;
        }
        match unwrap_expr(init) {
            Expression::StringLiteral(l) => {
                let t = lit(l);
                if env_name(&t) {
                    self.env_consts.insert(name.to_string(), t);
                }
            }
            Expression::ObjectExpression(o) => {
                for p in &o.properties {
                    if let ObjectPropertyKind::ObjectProperty(p) = p
                        && !p.computed
                        && let Some(k) = key_name(&p.key)
                        && let Expression::StringLiteral(l) = unwrap_expr(&p.value)
                        && env_name(&lit(l))
                        && self.env_consts.len() < MAX_ENV_CONSTS
                    {
                        self.env_consts.insert(format!("{name}.{k}"), lit(l));
                    }
                }
            }
            _ => {}
        }
    }

    /// Next.js `export const config = { matcher: [...] }` and Clerk
    /// `const isPublic = createRouteMatcher([...])`. A matcher any pattern of which
    /// cannot be read (not a literal, or not route-shaped, such as a negative
    /// lookahead) is recorded with no patterns: unknown, never a partial list.
    fn note_route_matchers(&mut self, name: &str, init: &Expression) {
        let (binding, patterns) = match unwrap_expr(init) {
            Expression::ObjectExpression(o) if name == "config" => {
                let Some(m) = routes::object_prop(o, "matcher") else {
                    return;
                };
                ("config.matcher".to_string(), m)
            }
            Expression::CallExpression(c) if call_name(&c.callee) == Some("createRouteMatcher") => {
                let Some(first) = c.arguments.first().and_then(|a| a.as_expression()) else {
                    return;
                };
                (name.to_string(), first)
            }
            _ => return,
        };
        let one = |e: &Expression| -> Option<String> {
            match unwrap_expr(e) {
                Expression::StringLiteral(l) => Some(lit(l)),
                Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                    t.quasis.first().map(|q| q.value.raw.to_string())
                }
                Expression::ObjectExpression(o) => {
                    routes::object_prop(o, "source").and_then(|s| match unwrap_expr(s) {
                        Expression::StringLiteral(l) => Some(lit(l)),
                        _ => None,
                    })
                }
                _ => None,
            }
        };
        let read: Option<Vec<String>> = match unwrap_expr(patterns) {
            Expression::ArrayExpression(a) => a
                .elements
                .iter()
                .map(|el| el.as_expression().and_then(one))
                .collect(),
            e => one(e).map(|p| vec![p]),
        };
        let mut patterns = read
            .filter(|ps| ps.iter().all(|p| drift_core::practice::valid_route(p)))
            .unwrap_or_default();
        patterns.sort();
        patterns.dedup();
        if patterns.len() > drift_core::practice::caps::MATCHER_PATTERNS {
            patterns.clear();
        }
        let polarity = if binding == "config.matcher" {
            drift_core::MatcherPolarity::Applies
        } else {
            drift_core::MatcherPolarity::Unknown
        };
        self.out.route_matchers.push(drift_core::RouteMatcher {
            binding,
            opaque: patterns.is_empty(),
            patterns,
            polarity,
        });
    }

    /// What a `createRouteMatcher` list is for, from how the file uses it: `if
    /// (!isPublic(req)) auth.protect()` opens the listed routes (`public`), `if
    /// (isProtected(req)) auth.protect()` guards them (`applies`). Without such a use,
    /// the binding's name says (`isPublicRoute`, `isProtectedRoute`); otherwise, or
    /// when uses disagree, unknown.
    fn matcher_polarity(&mut self, program: &Program) {
        use drift_core::MatcherPolarity;
        let names: BTreeSet<String> = self
            .out
            .route_matchers
            .iter()
            .filter(|m| m.binding != "config.matcher")
            .map(|m| m.binding.clone())
            .collect();
        if names.is_empty() {
            return;
        }
        let mut uses = MatcherUses {
            names: &names,
            found: BTreeMap::new(),
        };
        uses.visit_program(program);
        let found = uses.found;
        for m in &mut self.out.route_matchers {
            if m.binding == "config.matcher" {
                continue;
            }
            let lower = m.binding.to_ascii_lowercase();
            m.polarity = match found
                .get(&m.binding)
                .map(|s| s.iter().copied().collect::<Vec<_>>())
            {
                Some(v) if v == [true] => MatcherPolarity::Public,
                Some(v) if v == [false] => MatcherPolarity::Applies,
                Some(_) => MatcherPolarity::Unknown,
                None if lower.contains("public") || lower.contains("unprotected") => {
                    MatcherPolarity::Public
                }
                None if lower.contains("protected") || lower.contains("private") => {
                    MatcherPolarity::Applies
                }
                None => MatcherPolarity::Unknown,
            };
        }
    }
}

/// A returned value that is a constant: a literal (`true`, `null`, `0`, `"x"`, a
/// template without placeholders) or `undefined`, through `await`, parentheses and a
/// `Promise.resolve(...)`.
fn constant_value(e: &Expression) -> bool {
    match peel(e) {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::TemplateLiteral(t) => t.expressions.is_empty(),
        Expression::Identifier(id) => id.name == "undefined",
        Expression::UnaryExpression(u) if u.operator == UnaryOperator::Void => true,
        Expression::CallExpression(c)
            if matches!(unwrap_expr(&c.callee), Expression::StaticMemberExpression(m)
                if m.property.name == "resolve"
                    && matches!(unwrap_expr(&m.object), Expression::Identifier(p) if p.name == "Promise")) =>
        {
            c.arguments
                .first()
                .and_then(|a| a.as_expression())
                .is_none_or(constant_value)
        }
        _ => false,
    }
}

/// The arguments of the `return`s of one function body, not of the functions it holds.
struct Returns<'b, 'a> {
    found: Vec<&'b Expression<'a>>,
}

impl<'b, 'a> Returns<'b, 'a> {
    fn visit_function_body(&mut self, b: &'b FunctionBody<'a>) {
        for s in &b.statements {
            self.statement(s);
        }
    }

    fn statement(&mut self, s: &'b Statement<'a>) {
        match s {
            Statement::ReturnStatement(r) => self.found.extend(r.argument.as_ref()),
            Statement::BlockStatement(b) => b.body.iter().for_each(|s| self.statement(s)),
            Statement::IfStatement(i) => {
                self.statement(&i.consequent);
                if let Some(a) = &i.alternate {
                    self.statement(a);
                }
            }
            Statement::TryStatement(t) => {
                t.block.body.iter().for_each(|s| self.statement(s));
                if let Some(h) = &t.handler {
                    h.body.body.iter().for_each(|s| self.statement(s));
                }
            }
            _ => {}
        }
    }
}

/// Uses of route-matcher bindings guarding a sign-in check: for each binding, whether
/// it was negated (`if (!isPublic(req)) auth.protect()`).
struct MatcherUses<'n> {
    names: &'n BTreeSet<String>,
    found: BTreeMap<String, BTreeSet<bool>>,
}

/// A call that makes the caller sign in (`auth.protect()`, `auth().protect()`,
/// `redirectToSignIn()`) anywhere in a statement.
struct ProtectCall(bool);

impl<'a> Visit<'a> for ProtectCall {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if matches!(
            call_name(&it.callee),
            Some("protect" | "redirectToSignIn" | "redirectToLogin" | "redirectToSignin")
        ) {
            self.0 = true;
        }
        walk::walk_call_expression(self, it);
    }
}

impl<'a> Visit<'a> for MatcherUses<'_> {
    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        let (negated, test) = match peel(&it.test) {
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                (true, peel(&u.argument))
            }
            e => (false, e),
        };
        if let Expression::CallExpression(c) = test
            && let Expression::Identifier(id) = unwrap_expr(&c.callee)
            && self.names.contains(id.name.as_str())
        {
            let mut p = ProtectCall(false);
            p.visit_statement(&it.consequent);
            if p.0 {
                self.found
                    .entry(id.name.to_string())
                    .or_default()
                    .insert(negated);
            }
        }
        walk::walk_if_statement(self, it);
    }
}

/// Finds what a test file requests and asserts, and what any file mocks.
struct TestFinder<'l, 's> {
    l: &'l Lowerer<'s>,
    tests: bool,
    /// Requests of the test block being walked (innermost `it`/`test` callback), and the
    /// statuses it asserts.
    block: Vec<(Vec<RawTestRequest>, BTreeSet<u16>)>,
    requests: BTreeSet<RawTestRequest>,
    mocks: BTreeSet<String>,
}

impl TestFinder<'_, '_> {
    fn request(
        &mut self,
        method: &str,
        route: Option<String>,
        target: Option<String>,
        dynamic: bool,
    ) {
        if !self.tests {
            return;
        }
        let route = route
            .and_then(|r| drift_core::practice::normalize_route(&r))
            .unwrap_or_default();
        let r = RawTestRequest {
            method: method.to_ascii_uppercase(),
            route,
            target,
            statuses: vec![],
            dynamic,
        };
        match self.block.last_mut() {
            Some((reqs, _)) => reqs.push(r),
            None => {
                self.requests.insert(r);
            }
        }
    }

    fn status(&mut self, s: u16) {
        if let Some((_, statuses)) = self.block.last_mut() {
            statuses.insert(s);
        }
    }

    /// `expect(res.status).toBe(401)`, `expect(res.statusCode).toEqual(n)`,
    /// `expect(response.status()).toBe(n)`, `expect(res).toHaveStatus(n)`, supertest's
    /// `.expect(401)`.
    fn assertion(&mut self, it: &CallExpression) {
        let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) else {
            return;
        };
        let Some(n) = it
            .arguments
            .first()
            .and_then(|a| a.as_expression())
            .and_then(literal_status)
        else {
            return;
        };
        let method = m.property.name.as_str();
        let status_of = |e: &Expression| match peel(e) {
            Expression::StaticMemberExpression(s) => {
                matches!(s.property.name.as_str(), "status" | "statusCode")
            }
            Expression::CallExpression(c) => {
                call_name(&c.callee) == Some("status") && c.arguments.is_empty()
            }
            _ => false,
        };
        let expected = match unwrap_expr(&m.object) {
            Expression::CallExpression(e) if matches!(unwrap_expr(&e.callee), Expression::Identifier(i) if i.name == "expect") => {
                e.arguments.first().and_then(|a| a.as_expression())
            }
            _ => None,
        };
        let ok = match method {
            "toBe" | "toEqual" | "toStrictEqual" => expected.is_some_and(status_of),
            "toHaveStatus" | "toHaveHTTPStatus" | "toHaveStatusCode" => expected.is_some(),
            // supertest: `request(app).get("/x").expect(401)`.
            "expect" => !matches!(unwrap_expr(&m.object), Expression::Identifier(_)),
            _ => false,
        };
        if ok {
            self.status(n);
        }
    }
}

impl<'a> Visit<'a> for TestFinder<'_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let name = call_name(&it.callee);
        let first = it.arguments.first().and_then(|a| a.as_expression());
        let callee = self.l.canon_callee(&it.callee);
        // `vi.mock("spec")`, `jest.mock("spec")`.
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(unwrap_expr(&m.object), Expression::Identifier(o) if matches!(o.name.as_str(), "vi" | "jest"))
            && matches!(
                m.property.name.as_str(),
                "mock" | "doMock" | "unstable_mockModule"
            )
            && let Some(Expression::StringLiteral(l)) = first.map(unwrap_expr)
        {
            self.mocks.insert(lit(l));
        }
        // MSW: `http.get("/api/x", ...)`, `rest.post(...)` from `msw`.
        if let Some(RawRef {
            base:
                RawBase::Import {
                    spec,
                    name: imported,
                },
            member,
        }) = &callee
            && spec == "msw"
            && matches!(imported.as_str(), "http" | "rest")
            && let Some(m) = member.strip_prefix('.')
            && (HTTP_VERBS.contains(&m.to_ascii_uppercase().as_str()) || m == "all")
            && let Some(route) = first
                .and_then(url_path)
                .and_then(|p| drift_core::practice::normalize_route(&p))
        {
            self.mocks
                .insert(format!("{}{route}", drift_core::practice::MSW_PREFIX));
        }
        if self.tests {
            self.assertion(it);
            let verb = name.map(str::to_ascii_uppercase);
            let is_verb = verb.as_deref().is_some_and(|v| HTTP_VERBS.contains(&v));
            if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) {
                let object = peel(&m.object);
                // supertest `request(app).get("/x")`, `supertest(app).post(..)`,
                // `request.agent(app).get(..)`; playwright `request.get("/x")`.
                let client = match object {
                    Expression::CallExpression(c) => matches!(
                        chain_root_name(&c.callee),
                        Some("request" | "supertest" | "agent")
                    ),
                    Expression::Identifier(i) => {
                        matches!(i.name.as_str(), "request" | "api" | "apiContext")
                    }
                    Expression::StaticMemberExpression(o) => o.property.name == "request",
                    _ => false,
                };
                if is_verb && client {
                    self.request(
                        verb.as_deref().unwrap_or("ANY"),
                        first.and_then(url_path),
                        None,
                        non_literal(first),
                    );
                }
                if name == Some("goto")
                    && matches!(object, Expression::Identifier(i) if i.name == "page")
                {
                    self.request("GET", first.and_then(url_path), None, non_literal(first));
                }
                // Fastify `app.inject({ method, url })`.
                if name == Some("inject")
                    && let Some(Expression::ObjectExpression(o)) = first.map(unwrap_expr)
                {
                    let method = routes::object_prop(o, "method")
                        .and_then(|m| match unwrap_expr(m) {
                            Expression::StringLiteral(l) => Some(lit(l)),
                            _ => None,
                        })
                        .unwrap_or_else(|| "GET".into());
                    let raw = routes::object_prop(o, "url");
                    let url = raw.and_then(url_path);
                    self.request(&method, url, None, non_literal(raw));
                }
            }
            // `fetch("/api/x", { method: "POST" })`.
            if matches!(&callee, Some(RawRef { base: RawBase::Global(g), member }) if g == "fetch" && member.is_empty())
                && let Some(url) = first.and_then(url_path)
            {
                let method = it
                    .arguments
                    .get(1)
                    .and_then(|a| a.as_expression())
                    .and_then(|o| match unwrap_expr(o) {
                        Expression::ObjectExpression(o) => routes::object_prop(o, "method"),
                        _ => None,
                    })
                    .and_then(|m| match unwrap_expr(m) {
                        Expression::StringLiteral(l) => Some(lit(l)),
                        _ => None,
                    })
                    .unwrap_or_else(|| "GET".into());
                self.request(&method, Some(url), None, non_literal(first));
            }
            // A route handler imported and called directly: `GET(req)`, `route.POST(req)`.
            if is_verb
                && let Some(RawRef {
                    base:
                        RawBase::Import {
                            spec,
                            name: imported,
                        },
                    member,
                }) = &callee
            {
                let direct = member.is_empty() && HTTP_VERBS.contains(&imported.as_str());
                let ns = imported == "*"
                    && member
                        .strip_prefix('.')
                        .is_some_and(|m| HTTP_VERBS.contains(&m));
                if direct || ns {
                    self.request(
                        verb.as_deref().unwrap_or("ANY"),
                        None,
                        Some(spec.clone()),
                        false,
                    );
                }
            }
        }
        // `it("...", async () => { ... })`, `test(...)`, `it.only(...)`.
        let block = self.tests
            && matches!(chain_root_name(&it.callee), Some("it" | "test"))
            && it.arguments.iter().any(|a| {
                matches!(
                    a.as_expression().map(unwrap_expr),
                    Some(
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )
                )
            });
        if block {
            self.block.push((Vec::new(), BTreeSet::new()));
        }
        walk::walk_call_expression(self, it);
        if block && let Some((reqs, statuses)) = self.block.pop() {
            let statuses: Vec<u16> = statuses.into_iter().collect();
            for mut r in reqs {
                r.statuses.clone_from(&statuses);
                self.requests.insert(r);
            }
        }
    }
}

/// Finds a call of the continuation in the statements walked ([`Collector::continues`]).
struct HandsOn<'c, 'l, 's> {
    c: &'c Collector<'l, 's>,
    found: bool,
}

impl<'a> Visit<'a> for HandsOn<'_, '_, '_> {
    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.c.hands_on(it) {
            self.found = true;
        }
        walk::walk_call_expression(self, it);
    }
}

/// Finds a statement that answers "not signed in" at any depth of the statements
/// walked, outside the functions written there ([`Collector::handler_outcome`]).
struct Answers401<'c, 'l, 's> {
    c: &'c Collector<'l, 's>,
    found: bool,
}

impl<'a> Visit<'a> for Answers401<'_, '_, '_> {
    fn visit_statement(&mut self, it: &Statement<'a>) {
        if self.c.handler_outcome(it) == Some(drift_core::CheckOutcome::Unauthenticated) {
            self.found = true;
        }
        walk::walk_statement(self, it);
    }

    fn visit_function(&mut self, _: &Function<'a>, _: oxc_semantic::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
}

/// The call whose value a statement of a `try` takes: the call itself, awaited or
/// not, with any type arguments and TypeScript wrappers; the value an assignment
/// stores (`request.operator = await request.jwtVerify<Operator>()`); what a member
/// is read off (`(await jwtVerify(token, key)).payload`). A value that may not call
/// (`a ? f() : g`, `ok && f()`) is none.
fn verified_call<'b, 'a>(e: &'b Expression<'a>) -> Option<&'b CallExpression<'a>> {
    match peel(e) {
        Expression::CallExpression(c) => Some(c),
        Expression::AssignmentExpression(a) => verified_call(&a.right),
        Expression::StaticMemberExpression(m) => verified_call(&m.object),
        _ => None,
    }
}

/// A branch that sets a refusing status in a statement of its own and leaves:
/// `{ res.statusCode = 401; return res.end(); }`.
fn status_assigned(s: &Statement) -> Option<drift_core::CheckOutcome> {
    let Statement::BlockStatement(b) = s else {
        return None;
    };
    if !b.body.last().is_some_and(leaves) {
        return None;
    }
    b.body.iter().find_map(|st| {
        let Statement::ExpressionStatement(x) = st else {
            return None;
        };
        let Expression::AssignmentExpression(a) = unwrap_expr(&x.expression) else {
            return None;
        };
        let AssignmentTarget::StaticMemberExpression(m) = &a.left else {
            return None;
        };
        if m.property.name != "statusCode" {
            return None;
        }
        literal_status(&a.right).and_then(status_outcome)
    })
}

/// The statement always leaves by throwing.
fn throws(s: &Statement) -> bool {
    match s {
        Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(b) => b.body.last().is_some_and(throws),
        _ => false,
    }
}

/// The branch a test guards is taken only where two conditions hold together: the
/// consequent of `a && b` (and of `!(a || b)`), the `else` (`otherwise`) of `a || b`
/// (and of `!(a && b)`).
fn asks_for_both(test: &Expression, otherwise: bool) -> bool {
    let mut negated = otherwise;
    let mut e = unwrap_expr(test);
    while let Expression::UnaryExpression(u) = e {
        if u.operator != UnaryOperator::LogicalNot {
            break;
        }
        negated = !negated;
        e = unwrap_expr(&u.argument);
    }
    match e {
        Expression::LogicalExpression(l) => match l.operator {
            LogicalOperator::And => !negated,
            LogicalOperator::Or => negated,
            LogicalOperator::Coalesce => false,
        },
        _ => false,
    }
}

/// The call is given a value: not nothing, a literal, or a callback the body itself
/// defines (`exporter.run(params.userId)`, `rows.push(row)`; not `res.json()`,
/// `query.get("page")` or `rows.map((r) => r.id)`, whose callback is read where it is).
fn hands_value_on(c: &CallExpression) -> bool {
    c.arguments.iter().any(|a| match a.as_expression() {
        Some(e) => match unwrap_expr(e) {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_) => false,
            Expression::TemplateLiteral(t) => !t.expressions.is_empty(),
            _ => true,
        },
        // `f(...args)`.
        None => true,
    })
}

impl<'a> Visit<'a> for Collector<'_, '_> {
    fn visit_decorator(&mut self, it: &Decorator<'a>) {
        if !self.skip_decorators {
            walk::walk_decorator(self, it);
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if self.l.require_spec_call(it).is_some() {
            // `require("x")` is an import, not a call worth recording.
            return walk::walk_call_expression(self, it);
        }
        self.note_data_callbacks(it);
        let kinds = self.l.call_sinks(it);
        // The call is given a value read off a parameter of the function: an
        // operation fed by it ([`drift_core::controls::SINK_FED`]), a callee it is
        // handed on to ([`drift_core::controls::PASSES_PARAM`]).
        fn argument<'b, 'a>(a: &'b Argument<'a>) -> Option<&'b Expression<'a>> {
            match a {
                Argument::SpreadElement(s) => Some(&s.argument),
                other => other.as_expression(),
            }
        }
        let given_a_parameter = it.arguments.iter().any(|a| {
            argument(a).is_some_and(|e| self.taint(e).of_a_parameter() || self.reads_own_param(e))
        });
        // Or off a parameter of the function the body hands back
        // ([`drift_core::controls::SINK_FED_MADE`]).
        let given_a_made_parameter = it
            .arguments
            .iter()
            .any(|a| argument(a).is_some_and(|e| self.reads_product_param(e)));
        if given_a_parameter {
            self.fed_sinks.extend(kinds.iter().map(|k| k.to_string()));
            if let Some(r) = self.l.canon_callee(&it.callee) {
                self.param_passes.insert(r);
            }
        }
        // What the callee is handed, where it is code a reader can follow.
        if self.fn_depth >= 1
            && let Some(r) = self.l.canon_callee(&it.callee)
            && !matches!(r.base, RawBase::Global(_))
        {
            self.note_arg_sides(&r, it);
        }
        if given_a_made_parameter {
            self.made_fed_sinks
                .extend(kinds.iter().map(|k| k.to_string()));
            if let Some(r) = self.l.canon_callee(&it.callee) {
                self.made_passes.insert(r);
            }
        }
        for s in kinds {
            self.sinks.insert(s.to_string());
        }
        self.flow_call(it);
        self.orm_filter |= self.l.orm_filter_call(it);
        if self.l.is_validation_call(it) {
            self.controls.insert("validates".into());
        }
        // What becomes of the value the call hands back ([`RawSymbol::result_uses`]).
        if let Some(r) = self.l.canon_callee(&it.callee)
            && !matches!(r.base, RawBase::Global(_))
        {
            if self.drop_sites.contains(&it.span.start) {
                self.result_dropped.insert(r);
            } else {
                self.result_used.insert(r);
            }
        }
        // Nest: `app.useGlobalGuards(new AuthGuard(), rolesGuard)`.
        if call_name(&it.callee) == Some("useGlobalGuards") {
            for a in &it.arguments {
                let guard = match a.as_expression().map(unwrap_expr) {
                    Some(Expression::NewExpression(n)) => self.l.canon(&n.callee),
                    Some(e) => self.l.canon(e),
                    None => None,
                };
                if let Some(g) = guard {
                    self.global_guards.push(g);
                }
            }
        }
        // A query builder's comparison by a tenant or an owner column
        // (`eq(invoices.orgId, orgId)`, `.where("org_id", "=", orgId)`,
        // `.whereIn("owner_id", ids)`): a filter no fact records.
        if matches!(
            call_name(&it.callee),
            Some(
                "eq" | "ne"
                    | "inArray"
                    | "notInArray"
                    | "where"
                    | "andWhere"
                    | "orWhere"
                    | "whereIn"
                    | "having"
                    | "equals"
            )
        ) && it
            .arguments
            .iter()
            .any(|a| match a.as_expression().map(unwrap_expr) {
                Some(Expression::StaticMemberExpression(m)) => scope_key(m.property.name.as_str()),
                Some(Expression::StringLiteral(l)) => scope_key(&lit(l)),
                _ => false,
            })
        {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
        // A filter present in one arm only (`where(role === "admin" ? {} : {
        // brand_id })`, `findMany({ where: admin ? undefined : { brandId } })`): the
        // query is scoped for some requests, by what no fact records.
        {
            let in_one_arm = |e: &Expression| -> bool {
                let filter = |x: &Expression| matches!(unwrap_expr(x), Expression::ObjectExpression(o) if !o.properties.is_empty());
                match unwrap_expr(e) {
                    Expression::ConditionalExpression(c) => {
                        filter(&c.consequent) || filter(&c.alternate)
                    }
                    Expression::LogicalExpression(l) => filter(&l.left) || filter(&l.right),
                    _ => false,
                }
            };
            let filters = matches!(
                call_name(&it.callee),
                Some("where" | "andWhere" | "orWhere" | "having")
            );
            let found = it.arguments.iter().any(|a| {
                let Some(x) = a.as_expression() else {
                    return false;
                };
                (filters && in_one_arm(x))
                    || matches!(unwrap_expr(x), Expression::ObjectExpression(o)
                        if routes::object_prop(o, "where").is_some_and(in_one_arm))
            });
            if found {
                self.controls
                    .insert(drift_core::controls::SCOPE_UNREAD.into());
            }
        }
        self.note_response(Sent::Call(it));
        self.note_log_call(it);
        if let Some(h) = self.header_read(it) {
            self.p.headers.insert(h);
        }
        self.note_input(it);
        self.note_verifier(it);
        self.note_error_handler(it);
        self.note_env_call(it);
        if let Some(name) = call_name(&it.callee)
            && REPORT_CALLS.contains(&name)
            && let Some(r) = self.l.canon_callee(&it.callee)
            && let Some(f) = self.p.frames.last_mut()
        {
            f.does.insert(("report".into(), Some(r)));
        }
        self.note_rejection(&it.callee, &it.arguments, it.span.end);
        self.note_carried_call(&it.callee);
        // SQL as text among the arguments, with what it is given beside it.
        for a in &it.arguments {
            let text = match a.as_expression().map(unwrap_expr) {
                Some(Expression::StringLiteral(l)) => lit(l),
                Some(Expression::TemplateLiteral(t)) => t
                    .quasis
                    .iter()
                    .map(|q| q.value.raw.as_str())
                    .collect::<Vec<&str>>()
                    .join(" "),
                _ => continue,
            };
            let values = it.arguments.iter().filter_map(|x| x.as_expression());
            self.note_sql_scope(&text, values);
        }
        if let Expression::Identifier(id) = unwrap_expr(&it.callee)
            && self.dropped.contains(&it.span.end)
        {
            self.dropped_callees.insert(id.span.start);
        }
        // A sibling method called through `this`: where it stands in the body's
        // order, and whether every request makes the call.
        if self.own_this == 0
            && let Some((class, names)) = &self.this_methods
            && let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && matches!(unwrap_expr(&m.object), Expression::ThisExpression(_))
            && names.contains(m.property.name.as_str())
        {
            let r = RawRef {
                base: RawBase::Local(class.clone()),
                member: format!(".{}", m.property.name),
            };
            if !self.order.contains(&r) && self.order.len() < MAX_ORDER {
                self.order.push(r.clone());
            }
            self.note_call_why(r, it.span.end);
        }
        if let Some(r) = self.l.canon_callee(&it.callee) {
            for (i, a) in it.arguments.iter().enumerate() {
                if let Some(e) = a.as_expression() {
                    self.object_keys(&r, i, e);
                    // A call every request reaches, and no other: a filter under a
                    // branch scopes the requests that take it.
                    if self.counting() && self.branches == 0 && !self.served {
                        self.caller_keys_at(&r, e, "", 0);
                    }
                }
            }
            if !self.order.contains(&r) && self.order.len() < MAX_ORDER {
                self.order.push(r.clone());
            }
            // What comes after the continuation, or takes its result, acts on what the
            // continuation handed back (`mapAuthErrors(await next())`).
            if self.continued
                || it.arguments.iter().any(|a| {
                    a.as_expression()
                        .is_some_and(|e| self.mentions_continuation(e, 0))
                })
            {
                self.after_calls.insert(r.clone());
            } else {
                self.before_calls.insert(r.clone());
            }
            self.note_call_why(r.clone(), it.span.end);
            if self.in_try > 0 {
                self.called_in_try.insert(r.clone());
            } else {
                self.called_outside.insert(r.clone());
            }
            if self.cred_present > 0 {
                self.called_with_credential.insert(r.clone());
            } else {
                self.called_without_credential.insert(r.clone());
            }
            self.calls.insert(r);
        } else {
            // A member of a parameter (`request.jwtVerify()`), in a `try` or not.
            {
                let mut members: Vec<&str> = Vec::new();
                let mut root = unwrap_expr(&it.callee);
                while let Expression::StaticMemberExpression(m) = root {
                    members.push(m.property.name.as_str());
                    root = unwrap_expr(&m.object);
                }
                if let Expression::Identifier(id) = root
                    && !members.is_empty()
                    && members.len() <= MAX_MEMBER_DEPTH
                    && let Some(s) = self.symbol_of(id)
                    && let Some(name) = self
                        .l
                        .params
                        .get(&s)
                        .map(|(name, _)| name)
                        .or_else(|| self.param_values.get(&s))
                {
                    members.reverse();
                    let path: String = members.iter().map(|m| format!(".{m}")).collect();
                    let call = format!("param:{name}{path}");
                    if self.in_try > 0 {
                        self.params_in_try.insert(call);
                    } else if self.params_outside.len() < MAX_PARAM_CALLS {
                        self.params_outside.insert(call);
                    }
                }
            }
            self.note_param_call(&it.callee);
            self.note_this_call(&it.callee);
            self.note_alias_call(&it.callee, it.span.end);
            // A method of a local or of a value no import names: the call is not
            // recorded, and what it does with the value was not read.
            if hands_value_on(it) {
                self.controls
                    .insert(drift_core::controls::UNREAD_CALL.into());
            }
            // Given a parameter itself (the request, the response, the
            // continuation), or a method of a local given a value: what runs then
            // is not read. Not the continuation's own call.
            if !self.continues(&it.callee) {
                let param = |id: &IdentifierReference| {
                    self.symbol_of(id)
                        .is_some_and(|s| self.l.params.contains_key(&s))
                };
                // The request, the response, the continuation: not what a
                // callback over data is called with ([`Collector::param_values`]).
                let handed = |id: &IdentifierReference| {
                    self.symbol_of(id).is_some_and(|s| {
                        self.l.params.contains_key(&s) && !self.param_values.contains_key(&s)
                    })
                };
                let given_param = it.arguments.iter().any(|a| match a {
                    Argument::SpreadElement(_) => true,
                    other => matches!(
                        other.as_expression().map(unwrap_expr),
                        Some(Expression::Identifier(id)) if handed(id)
                    ),
                });
                let mut root = unwrap_expr(&it.callee);
                let mut member = false;
                while let Expression::StaticMemberExpression(m) = root {
                    root = unwrap_expr(&m.object);
                    member = true;
                }
                // A local that holds a value of a parameter is no service: its
                // method is a method of that value, as one written on the
                // parameter's member is.
                let of_local = member
                    && hands_value_on(it)
                    && matches!(root, Expression::Identifier(id)
                        if self.symbol_of(id).is_some_and(|s| !self.param_values.contains_key(&s))
                            && !param(id));
                // A method written in the same object as the function that calls
                // it through `this`: read with the value it is written in.
                let own_method = matches!(
                    unwrap_expr(&it.callee),
                    Expression::StaticMemberExpression(m)
                        if matches!(unwrap_expr(&m.object), Expression::ThisExpression(_))
                            && self.value_methods.last().is_some_and(|keys| {
                                keys.as_ref().is_some_and(|k| k.contains(m.property.name.as_str()))
                            })
                );
                if (given_param && !own_method) || of_local {
                    self.hands_on = true;
                }
            }
        }
        // A call of an export of a package on the guard lists: its shape decides
        // what it is where it stands as a guard.
        if self.guard_calls.len() < drift_core::GuardCall::MAX
            && let Some(call) = self.l.call_shape(it, 0)
            && matches!(&call.callee.base, RawBase::Import { spec, .. }
                if drift_core::guard_lists::shaped(spec))
            && !self.guard_calls.contains(&call)
        {
            self.guard_calls.push(call);
        }
        // A callback given to `.then()`/`.catch()`/`.finally()` runs on what the promise
        // settles with: `next().catch((e) => { throw ... })` maps the continuation's error.
        let callback = matches!(
            unwrap_expr(&it.callee),
            Expression::StaticMemberExpression(m)
                if matches!(m.property.name.as_str(), "then" | "catch" | "finally")
        );
        self.visit_expression(&it.callee);
        if let Some(t) = &it.type_arguments {
            self.visit_ts_type_parameter_instantiation(t);
        }
        if callback {
            self.in_callback += 1;
        }
        // A callback handed to an element method (`names.forEach((n) => ...)`,
        // `map`, `filter`, `some`, ...) runs once per element, so perhaps never;
        // and so may one handed to a method that is not named
        // (`names[how]((n) => ...)`). What it calls, it calls for some requests
        // only ([`drift_core::Symbol::conditional_calls`]).
        let per_element = match unwrap_expr(&it.callee) {
            Expression::StaticMemberExpression(m) => {
                ELEMENT_METHODS.contains(&m.property.name.as_str())
            }
            Expression::ComputedMemberExpression(m) => {
                !matches!(unwrap_expr(&m.expression), Expression::StringLiteral(l)
                    if !ELEMENT_METHODS.contains(&l.value.as_str().unwrap_or_default()))
            }
            Expression::ChainExpression(ch) => match &ch.expression {
                ChainElement::StaticMemberExpression(m) => {
                    ELEMENT_METHODS.contains(&m.property.name.as_str())
                }
                ChainElement::ComputedMemberExpression(_) => true,
                _ => false,
            },
            _ => false,
        };
        if per_element {
            for a in &it.arguments {
                if let Some(
                    f
                    @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
                ) = a.as_expression().map(unwrap_expr)
                {
                    self.per_element_fns.insert(f.span().start);
                }
            }
        }
        // A callback handed to a timer runs after the body went on.
        if matches!(
            call_name(&it.callee),
            Some("setTimeout" | "setInterval" | "setImmediate" | "queueMicrotask" | "nextTick")
        ) {
            for a in &it.arguments {
                if let Some(
                    f
                    @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
                ) = a.as_expression().map(unwrap_expr)
                {
                    self.later_fns.insert(f.span().start);
                }
            }
        }
        for a in &it.arguments {
            self.visit_argument(a);
        }
        if callback {
            self.in_callback -= 1;
        }
        if self.continues(&it.callee) {
            self.continued = true;
        }
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Some(var) = self.l.env_read(it) {
            if self.server_only == 0 {
                self.browser_reads.insert(var.clone());
            }
            self.reads.insert(var);
        }
        let property = it.property.name.as_str();
        let on_request = match unwrap_expr(&it.object) {
            Expression::Identifier(id) => matches!(id.name.as_str(), "req" | "request"),
            Expression::StaticMemberExpression(m) => {
                matches!(m.property.name.as_str(), "req" | "request")
            }
            _ => false,
        };
        if INPUT_NAMES.contains(&property)
            || (on_request && input::REQUEST_INPUT_MEMBERS.contains(&property))
        {
            self.saw_input = true;
        }
        if drift_core::controls::names_subject(property) {
            self.reads_subject = true;
        }
        // `req.headers.authorization`.
        if let Expression::StaticMemberExpression(o) = unwrap_expr(&it.object)
            && o.property.name == "headers"
            && !HEADER_METHODS.contains(&property)
        {
            let h = property.to_ascii_lowercase();
            if drift_core::practice::valid_header(&h) {
                self.p.headers.insert(h);
            }
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        self.note_env_index(it);
        self.flow_selects(&it.expression);
        // `req.headers["x-api-key"]`.
        if let Expression::StaticMemberExpression(o) = unwrap_expr(&it.object)
            && o.property.name == "headers"
            && let Expression::StringLiteral(l) = unwrap_expr(&it.expression)
        {
            let h = lit(l).to_ascii_lowercase();
            if drift_core::practice::valid_header(&h) {
                self.p.headers.insert(h);
            }
        }
        walk::walk_computed_member_expression(self, it);
    }

    fn visit_binary_expression(&mut self, it: &BinaryExpression<'a>) {
        // `e instanceof X` in a catch clause names what it catches.
        if it.operator == BinaryOperator::Instanceof
            && let Expression::Identifier(id) = unwrap_expr(&it.left)
            && let Some(s) = self.symbol_of(id)
            && let Some(r) = self.l.canon(&it.right)
            && let Some(f) = self.p.frames.iter_mut().rev().find(|f| f.param == Some(s))
        {
            f.classes.insert(RawOperand::Ref(r));
        }
        self.flow_binary(it);
        // A comparison by a tenant or an owner key that no check records
        // (`rules.filter((rule) => rule.orgId === session.orgId)`, a ternary, a value
        // bound first): it may be how the body scopes what it answers
        // ([`drift_core::controls::SCOPE_UNREAD`]).
        if self.refusal_test == 0
            && matches!(
                it.operator,
                BinaryOperator::StrictEquality
                    | BinaryOperator::Equality
                    | BinaryOperator::StrictInequality
                    | BinaryOperator::Inequality
            )
        {
            let key = |e: &Expression| match unwrap_expr(e) {
                Expression::StaticMemberExpression(m) => {
                    let name = m.property.name.as_str();
                    drift_core::practice::tenant_key(name) || drift_core::practice::owner_key(name)
                }
                Expression::Identifier(id) => {
                    let name = id.name.as_str();
                    drift_core::practice::tenant_key(name) || drift_core::practice::owner_key(name)
                }
                _ => false,
            };
            if key(&it.left) || key(&it.right) {
                self.controls
                    .insert(drift_core::controls::SCOPE_UNREAD.into());
            }
        }
        walk::walk_binary_expression(self, it);
    }

    fn visit_binding_property(&mut self, it: &BindingProperty<'a>) {
        // `({ input, ctx }) => ...`, `{ params }: { params: Promise<...> }`.
        if !it.computed
            && let Some(k) = it.key.static_name()
            && let Some(k) = k.as_str()
            && INPUT_NAMES.contains(&k)
        {
            self.saw_input = true;
        }
        if !it.computed
            && let Some(k) = it.key.static_name()
            && let Some(k) = k.as_str()
            && drift_core::controls::names_subject(k)
        {
            self.reads_subject = true;
        }
        walk::walk_binding_property(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if drift_core::controls::names_subject(it.name.as_str()) {
            self.reads_subject = true;
        }
        // A named local function read where every request gets
        // ([`Collector::settle`]).
        if self.fn_depth > 0
            && self.local_fns.is_empty()
            && self.branches == 0
            && self.in_catch == 0
            && !self.served
            && let Some(sym) = it
                .reference_id
                .get()
                .and_then(|r| self.l.scoping.get_reference(r).symbol_id())
        {
            let u = self.local_uses.entry(sym).or_default();
            if self.dropped_callees.contains(&it.span.start) {
                u.1 = true;
            } else {
                u.0 = true;
            }
        }
        walk::walk_identifier_reference(self, it);
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        // A function declared inside a body that nothing in the file refers to
        // never runs.
        let later = self.later_fns.contains(&it.span.start)
            || self.per_element_fns.contains(&it.span.start)
            || (it.r#type == FunctionType::FunctionDeclaration
                && it.id.as_ref().is_some_and(|id| self.unread_local(id)));
        if it.r#type == FunctionType::FunctionDeclaration
            && let Some(sym) = it.id.as_ref().and_then(|id| id.symbol_id.get())
        {
            self.named_fns.insert(it.span.start, sym);
            if it.r#async {
                self.async_fns.insert(sym);
            }
        }
        // Each function hands control on in its own body, to the continuation it
        // receives.
        let outer = self.enter_fn(it.span.start, later);
        self.own_this += 1;
        let of_value = self.object_fns.remove(&it.span.start);
        self.value_methods.push(of_value);
        self.continuation_names
            .push(continuation_params(&it.params));
        self.note_params(&it.params);
        walk::walk_function(self, it, flags);
        self.continuation_names.pop();
        self.value_methods.pop();
        self.own_this -= 1;
        self.leave_fn(outer);
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let later = self.later_fns.contains(&it.span.start)
            || self.per_element_fns.contains(&it.span.start);
        // `(req, res) => relayJson(req, res)`: the function the walk started on
        // hands back what the call gave, as `return relayJson(req, res)` does.
        if self.fn_depth == 0
            && let Some(body) = it.body.as_expression()
        {
            match unwrap_expr(body) {
                f
                @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                    self.returns_fn += 1;
                    self.note_product_params(f);
                }
                _ => self.returns_other = true,
            }
        }
        if self.fn_depth == 0
            && self.in_callback == 0
            && let Some(body) = it.body.as_expression()
        {
            let mut returned = unwrap_expr(body);
            if let Expression::AwaitExpression(a) = returned {
                returned = unwrap_expr(&a.argument);
            }
            if let Expression::CallExpression(c) = returned
                && let Some(r) = self.l.canon_callee(&c.callee)
            {
                self.returns_calls.insert(r);
            }
        }
        let outer = self.enter_fn(it.span.start, later);
        self.continuation_names
            .push(continuation_params(&it.params));
        self.note_params(&it.params);
        if self.fn_depth == 1
            && let Some(body) = it.body.as_expression()
        {
            self.flow_return(body);
            self.note_return_credential(body);
        }
        walk::walk_arrow_function_expression(self, it);
        self.continuation_names.pop();
        self.leave_fn(outer);
    }

    fn visit_expression_statement(&mut self, it: &ExpressionStatement<'a>) {
        let mut e = unwrap_expr(&it.expression);
        if let Expression::UnaryExpression(u) = e
            && u.operator == UnaryOperator::Void
        {
            e = unwrap_expr(&u.argument);
        }
        // `await requireSession(req);`: what the call hands back goes nowhere.
        // Not a call handed the continuation or a function written in place: what
        // such a callee refuses, it refuses by not going on. Unless the body
        // itself goes on after the call (`ensure(req, res, () => {});
        // res.json(rows)`): what follows runs whatever the callee answered.
        if let Expression::CallExpression(c) = peel(e)
            && (self.followed.iter().rev().find(|f| **f != 0) == Some(&2)
                || !c.arguments.iter().any(|a| {
                    a.as_expression().is_some_and(|x| {
                        self.continues(x)
                            || matches!(
                                unwrap_expr(x),
                                Expression::ArrowFunctionExpression(_)
                                    | Expression::FunctionExpression(_)
                            )
                    })
                }))
        {
            self.drop_sites.insert(c.span.start);
        }
        // The value of a call that is a statement of its own is dropped, and so is
        // that of the call a `.then()` / `.catch()` / `.finally()` hangs on.
        let mut cur = e;
        while let Expression::CallExpression(c) = cur {
            match unwrap_expr(&c.callee) {
                Expression::StaticMemberExpression(m)
                    if matches!(m.property.name.as_str(), "then" | "catch" | "finally") =>
                {
                    cur = unwrap_expr(&m.object);
                }
                _ => {
                    self.dropped.insert(c.span.end);
                    break;
                }
            }
        }
        // `rule.private && assertAccess(session, rule);`: the right side runs only
        // for some requests.
        if let Expression::LogicalExpression(l) = e {
            self.visit_expression(&l.left);
            self.branches += 1;
            let notes = self.unauth_notes;
            self.visit_expression(&l.right);
            self.branches -= 1;
            // `!ok && res.status(401).end(); next();`: the answer does not leave,
            // and the function goes on ([`Collector::branch_goes_on`]).
            if self.followed.iter().rev().find(|f| **f != 0) == Some(&2) {
                self.unauth_goes_on += self.unauth_notes - notes;
            }
            return;
        }
        walk::walk_expression_statement(self, it);
    }

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        // A branch that answers and does not leave, after which the function goes
        // on (`if (!token) { res.status(401).json({}); } next();`): found, not
        // proven to turn anyone away.
        let answering = if self.branch_outcome(&it.consequent).is_some()
            || status_assigned(&it.consequent).is_some()
        {
            Some(&it.consequent)
        } else {
            it.alternate
                .as_ref()
                .filter(|a| self.branch_outcome(a).is_some())
        };
        // [STRICT] The answer is given under a condition that reads nothing of the
        // request or the caller (`if (process.env.MAINTENANCE === "1") return 401`, a
        // size limit): not a check of who calls, and no function that refuses its
        // caller. The route reads as it would without the branch.
        // (A call of a refusal builder of another module is read by linking: it
        // answers as the branch it is returned in.)
        let refusing = answering
            .or_else(|| Some(&it.consequent).filter(|b| self.builder_returned(b).is_some()));
        let free = refusing.is_some_and(|b| simple_branch(b))
            && self.counting()
            && self.fn_depth <= 1
            && self.caller_free(&it.test, 0);
        let goes_on = !free && answering.is_some_and(|b| self.branch_goes_on(b));
        let notes = self.unauth_notes;
        self.check_goes_on = goes_on;
        let test = if self.counting() && self.fn_depth <= 1 && !free {
            self.sources_of(&it.test)
        } else {
            Vec::new()
        };
        // A branch that hands control on and leaves (`if (apiKey) { return next() }`)
        // does not hand it on for what follows; one that does not leave does.
        let read = free || self.note_check(it);
        self.check_goes_on = false;
        // A constant-time compare tests the caller's secret or signature: where
        // nothing of the branches was read, what the `if` does with the answer is not
        // known, never nothing.
        if !read {
            let compares: Vec<RawOperand> =
                test.iter().filter(|s| is_compare(s)).cloned().collect();
            self.note_unread_exit(None, &compares);
        }
        let refuses = self.branch_outcome(&it.consequent).is_some()
            || it
                .alternate
                .as_ref()
                .is_some_and(|a| self.branch_outcome(a).is_some());
        // What the condition of an exit that answers "not signed in" compares is
        // how the caller is identified, not a scope.
        let signs_in = [Some(&it.consequent), it.alternate.as_ref()]
            .into_iter()
            .flatten()
            .any(|b| {
                matches!(
                    self.branch_outcome(b),
                    Some(
                        drift_core::CheckOutcome::Unauthenticated
                            | drift_core::CheckOutcome::SignInRedirect
                    )
                )
            });
        self.flow.authn_test += u32::from(signs_in);
        self.flow_test(&it.test);
        self.refusal_test += u32::from(refuses);
        self.visit_expression(&it.test);
        self.refusal_test -= u32::from(refuses);
        self.flow.authn_test -= u32::from(signs_in);
        let server = window_test(&it.test);
        let before = self.continued;
        self.server_only += u32::from(server == Some(true));
        self.branches += 1;
        self.tests.push(test.clone());
        let answers = free && std::ptr::eq(refusing.unwrap(), &it.consequent);
        let (n0, k0) = (self.unauth_notes, self.free_refusal);
        self.free_refusal += u32::from(answers);
        let present = u32::from(self.credential_present(&it.test));
        self.cred_present += present;
        self.visit_statement(&it.consequent);
        self.cred_present -= present;
        self.free_refusal = k0;
        if answers {
            self.unauth_goes_on += self.unauth_notes - n0;
        }
        self.tests.pop();
        self.branches -= 1;
        self.server_only -= u32::from(server == Some(true));
        let then = self.continued && !leaves(&it.consequent);
        self.continued = before;
        let mut other = false;
        if let Some(a) = &it.alternate {
            // The `else` of a branch that leaves is where every other request goes:
            // every request, where the branch turns its own away, and the rest only
            // where it serves them (`if (req.method === "GET") { return json(rule) }
            // else { <check> }` checks no GET).
            let goes_on = u32::from(!leaves(&it.consequent));
            if goes_on == 0 && self.serves(&it.consequent) {
                self.served = true;
            }
            self.server_only += u32::from(server == Some(false));
            self.branches += goes_on;
            self.tests.push(test.clone());
            let answers = free && !answers;
            let (n0, k0) = (self.unauth_notes, self.free_refusal);
            self.free_refusal += u32::from(answers);
            self.visit_statement(a);
            self.free_refusal = k0;
            if answers {
                self.unauth_goes_on += self.unauth_notes - n0;
            }
            self.tests.pop();
            self.branches -= goes_on;
            self.server_only -= u32::from(server == Some(false));
            other = self.continued && !leaves(a);
        }
        self.continued = before || then || other;
        // A branch that returns without turning the caller away serves those
        // requests without what follows, at whatever depth: what follows the
        // outermost branch runs for the others only.
        if self.serves(&it.consequent) || it.alternate.as_ref().is_some_and(|a| self.serves(a)) {
            self.served = true;
            for source in test {
                if self.serving_tests.len() < MAX_ORDER && !self.serving_tests.contains(&source) {
                    self.serving_tests.push(source);
                }
            }
        }
        if goes_on {
            self.unauth_goes_on += self.unauth_notes - notes;
        }
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        let server = window_test(&it.test);
        self.flow_test(&it.test);
        self.visit_expression(&it.test);
        self.branches += 1;
        self.server_only += u32::from(server == Some(true));
        self.visit_expression(&it.consequent);
        self.server_only -= u32::from(server == Some(true));
        self.server_only += u32::from(server == Some(false));
        self.visit_expression(&it.alternate);
        self.server_only -= u32::from(server == Some(false));
        self.branches -= 1;
    }

    fn visit_switch_statement(&mut self, it: &SwitchStatement<'a>) {
        self.flow_selects(&it.discriminant);
        self.visit_expression(&it.discriminant);
        self.branches += 1;
        for case in &it.cases {
            self.visit_switch_case(case);
        }
        self.branches -= 1;
    }

    fn visit_for_statement(&mut self, it: &ForStatement<'a>) {
        self.branches += 1;
        walk::walk_for_statement(self, it);
        self.branches -= 1;
    }

    fn visit_for_in_statement(&mut self, it: &ForInStatement<'a>) {
        self.branches += 1;
        walk::walk_for_in_statement(self, it);
        self.branches -= 1;
    }

    fn visit_for_of_statement(&mut self, it: &ForOfStatement<'a>) {
        self.flow_for_of(it);
        self.branches += 1;
        walk::walk_for_of_statement(self, it);
        self.branches -= 1;
    }

    fn visit_while_statement(&mut self, it: &WhileStatement<'a>) {
        self.branches += 1;
        walk::walk_while_statement(self, it);
        self.branches -= 1;
    }

    fn visit_do_while_statement(&mut self, it: &DoWhileStatement<'a>) {
        self.branches += 1;
        walk::walk_do_while_statement(self, it);
        self.branches -= 1;
    }

    fn visit_function_body(&mut self, it: &FunctionBody<'a>) {
        self.at_body = true;
        walk::walk_function_body(self, it);
        self.at_body = false;
    }

    fn visit_statements(&mut self, it: &oxc_allocator::Vec<'a, Statement<'a>>) {
        // `if (typeof window !== "undefined") return ...;`: what follows runs on the
        // server only.
        let mut raised = 0;
        // The statements of a function's own body, not of a block inside it.
        let body = std::mem::take(&mut self.at_body);
        for (i, st) in it.iter().enumerate() {
            if let Statement::TryStatement(t) = st {
                self.note_verified_try(t, body && i + 1 == it.len());
            }
            self.note_returned_result(st, &it[i + 1..]);
            self.followed.push(match it.get(i + 1) {
                None => 0,
                Some(next) if self.leaves_for_good(next) => 1,
                Some(_) => 2,
            });
            self.visit_statement(st);
            self.followed.pop();
            if let Statement::IfStatement(i) = st
                && i.alternate.is_none()
                && leaves(&i.consequent)
                && window_test(&i.test) == Some(false)
            {
                self.server_only += 1;
                raised += 1;
            }
        }
        self.server_only -= raised;
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        self.flow_tagged(it);
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        self.flow_assign(it);
        // `target[key] = value` under a key read off a parameter of the function
        // (`o[req.query.k] = req.query.v`): whoever chooses the key chooses which
        // property is written, `__proto__` among them. Read since the measured
        // build (the listed reading only).
        if self.fn_depth >= 1
            && let AssignmentTarget::ComputedMemberExpression(m) = &it.left
            && !matches!(
                peel(&m.expression),
                Expression::NumericLiteral(_) | Expression::StringLiteral(_)
            )
            && self.reads_own_param(&m.expression)
            && !routes::unmeasured_listing()
        {
            self.sinks.insert(signals::kind::KEY_WRITE.into());
            self.fed_sinks.insert(signals::kind::KEY_WRITE.into());
        }
        // `res = unauthorized();`
        if self.counting()
            && self.fn_depth <= 1
            && it.operator == AssignmentOperator::Assign
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &it.left
        {
            self.note_bound(id.name.as_str(), &it.right, 0);
        }
        // `let svc; svc = services.rules;`: another name for a module's binding.
        if self.fn_depth > 0
            && it.operator == AssignmentOperator::Assign
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &it.left
            && let Some(s) = self.symbol_of(id)
        {
            match self.module_ref(&it.right) {
                Some(r) => {
                    self.aliases.insert(s, r);
                }
                None => {
                    self.aliases.remove(&s);
                }
            }
        }
        // `handlers.DELETE = async () => { <check> }` inside a body: kept, as a
        // function an object literal holds is.
        if self.fn_depth > 0
            && it.left.as_member_expression().is_some()
            && let f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) =
                unwrap_expr(&it.right)
        {
            self.later_fns.insert(f.span().start);
        }
        if let AssignmentTarget::StaticMemberExpression(m) = &it.left
            && matches!(m.property.name.as_str(), "innerHTML" | "outerHTML")
        {
            self.sinks.insert(signals::kind::HTML.into());
        }
        // Koa `ctx.status = 401`.
        if let AssignmentTarget::StaticMemberExpression(m) = &it.left
            && m.property.name == "status"
            && matches!(unwrap_expr(&m.object), Expression::Identifier(o) if matches!(o.name.as_str(), "ctx" | "context"))
            && let Some(status) = literal_status(&it.right)
        {
            if let Some(f) = self.p.frames.last_mut() {
                f.does.insert((format!("respond:{status}"), None));
            }
            self.p.sent += 1;
            self.p.responses.insert(RawResponse {
                status,
                via: drift_core::ResponseVia::Setter,
                builder: None,
                model: None,
                keys: vec![],
                in_catch: self.in_catch > 0,
            });
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_jsx_attribute(&mut self, it: &JSXAttribute<'a>) {
        if let JSXAttributeName::Identifier(n) = &it.name
            && n.name == "dangerouslySetInnerHTML"
        {
            self.sinks.insert(signals::kind::HTML.into());
        }
        walk::walk_jsx_attribute(self, it);
    }

    fn visit_ts_any_keyword(&mut self, it: &TSAnyKeyword) {
        self.controls.insert("uses_any".into());
        walk::walk_ts_any_keyword(self, it);
    }

    fn visit_object_expression(&mut self, it: &ObjectExpression<'a>) {
        self.orm_filter |= self.l.orm_registration(it);
        // The functions written as its properties, and the keys that hold one.
        let fns: Vec<(u32, String)> = it
            .properties
            .iter()
            .filter_map(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) if !p.computed => {
                    match (unwrap_expr(&p.value), key_name(&p.key)) {
                        (Expression::FunctionExpression(f), Some(k)) => Some((f.span.start, k)),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect();
        if !fns.is_empty() {
            let keys = std::rc::Rc::new(fns.iter().map(|(_, k)| k.clone()).collect::<HashSet<_>>());
            for (start, _) in &fns {
                self.object_fns.insert(*start, keys.clone());
            }
        }
        walk::walk_object_expression(self, it);
    }

    fn visit_new_expression(&mut self, it: &NewExpression<'a>) {
        self.flow_new(it);
        self.note_response(Sent::New(it));
        if matches!(self.l.canon(&it.callee), Some(RawRef { base: RawBase::Global(ref n), ref member }) if n == "Function" && member.is_empty())
        {
            self.sinks.insert(signals::kind::EVAL.into());
        }
        // `new RegExp(pattern)` with a pattern built from a value: who writes the
        // pattern decides how long a match takes. Read since the measured build.
        if matches!(self.l.canon(&it.callee), Some(RawRef { base: RawBase::Global(ref n), ref member }) if n == "RegExp" && member.is_empty())
            && it
                .arguments
                .first()
                .and_then(|a| a.as_expression())
                .is_some_and(|p| self.l.dynamic_pattern(p))
            && !routes::unmeasured_listing()
        {
            self.sinks.insert(signals::kind::REGEX.into());
        }
        if let Some(mut r) = self.l.canon(&it.callee) {
            r.member.push_str("(new)");
            self.calls.insert(r);
        }
        walk::walk_new_expression(self, it);
    }

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        self.saw_jsx = true;
        walk::walk_jsx_element(self, it);
    }

    fn visit_jsx_fragment(&mut self, it: &JSXFragment<'a>) {
        self.saw_jsx = true;
        walk::walk_jsx_fragment(self, it);
    }

    fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'a>) {
        if let Some(r) = self.l.canon_jsx(&it.name) {
            self.renders.insert(r);
        }
        walk::walk_jsx_opening_element(self, it);
    }

    fn visit_await_expression(&mut self, it: &AwaitExpression<'a>) {
        self.controls.insert("await".into());
        if let Expression::CallExpression(c) = unwrap_expr(&it.argument) {
            self.awaited_calls.insert(c.span.end);
        }
        walk::walk_await_expression(self, it);
    }

    fn visit_throw_statement(&mut self, it: &ThrowStatement<'a>) {
        self.controls.insert("throw".into());
        if self.counting() {
            let r = self.rejecting(&it.argument);
            self.other_rejection |= r == Some(drift_core::controls::Rejection::Unauthenticated);
            self.note(r);
        }
        let thrown = match unwrap_expr(&it.argument) {
            Expression::NewExpression(n) => self.l.canon(&n.callee),
            Expression::CallExpression(c) => self.l.canon_callee(&c.callee),
            _ => None,
        };
        if let Some(f) = self.p.frames.last() {
            let rethrow = matches!(unwrap_expr(&it.argument), Expression::Identifier(id)
                if f.param.is_some() && self.symbol_of(id) == f.param);
            let what = if rethrow {
                ("rethrow".to_string(), None)
            } else {
                ("throw".to_string(), thrown.clone())
            };
            if let Some(f) = self.p.frames.last_mut() {
                f.does.insert(what);
            }
        }
        if let Some(r) = thrown {
            self.throws.insert(r);
        }
        let exit = self.p.exit.replace((
            peel(&it.argument).span().start,
            drift_core::ResponseVia::Throw,
        ));
        walk::walk_throw_statement(self, it);
        self.p.exit = exit;
    }

    fn visit_try_statement(&mut self, it: &TryStatement<'a>) {
        self.controls.insert("try".into());
        if it.handler.is_none() {
            return walk::walk_try_statement(self, it);
        }
        // What the block calls throws into the handler, not past the function.
        self.in_try += 1;
        self.visit_block_statement(&it.block);
        self.in_try -= 1;
        if let Some(h) = &it.handler {
            self.visit_catch_clause(h);
        }
        if let Some(f) = &it.finalizer {
            self.visit_block_statement(f);
        }
    }

    fn visit_return_statement(&mut self, it: &ReturnStatement<'a>) {
        if self.fn_depth == 1
            && let Some(arg) = &it.argument
        {
            self.flow_return(arg);
            self.note_return_credential(arg);
        }
        // `return stripe.webhooks.constructEventAsync(...)`: the promise is the
        // function's value, and what rejects it is the caller's to answer.
        if let Some(arg) = &it.argument
            && let Expression::CallExpression(c) = unwrap_expr(arg)
        {
            self.awaited_calls.insert(c.span.end);
        }
        if let Some(arg) = &it.argument
            && matches!(
                unwrap_expr(arg),
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            )
        {
            self.controls.insert("return_jsx".into());
        }
        if self.counting()
            && let Some(arg) = &it.argument
        {
            let r = self.rejecting(arg);
            let unauthenticated = Some(drift_core::controls::Rejection::Unauthenticated);
            // `return unauthenticated()`: a refusal builder's call is the response
            // it builds, of this file by its status, of another module as linking
            // finds it.
            if r.is_none()
                && let Expression::CallExpression(c) = peel(arg)
                && let Expression::Identifier(_) = unwrap_expr(&c.callee)
            {
                match self.l.canon_callee(&c.callee) {
                    Some(RawRef {
                        base: RawBase::Local(name),
                        member,
                    }) if member.is_empty()
                        && self.l.builders.get(&name)
                            == Some(&drift_core::CheckOutcome::Unauthenticated) =>
                    {
                        if self.fn_depth <= 1 {
                            if self.free_refusal == 0 {
                                self.returned_rejections.insert(String::new());
                                self.builder_rejects = true;
                            }
                        } else {
                            self.other_rejection = true;
                        }
                    }
                    Some(
                        r @ RawRef {
                            base: RawBase::Import { .. },
                            ..
                        },
                    ) if r.member.is_empty()
                        && self.fn_depth <= 1
                        && self.free_refusal == 0
                        && !self.returns_builder.contains(&r) =>
                    {
                        self.returns_builder.push(r);
                    }
                    _ => {}
                }
            }
            if r == unauthenticated {
                // Handed back by the function itself; by a function written
                // inside it, what its caller gets is not read.
                if self.fn_depth <= 1 {
                    if self.free_refusal == 0 {
                        self.returned_rejections.insert(String::new());
                    }
                } else {
                    self.other_rejection = true;
                }
            }
            // `return { error: NextResponse.json(..., { status: 401 }) }`.
            if let Expression::ObjectExpression(o) = unwrap_expr(arg)
                && self.fn_depth <= 1
            {
                for p in &o.properties {
                    if let ObjectPropertyKind::ObjectProperty(p) = p
                        && let Some(k) = key_name(&p.key)
                        && self.rejecting(&p.value) == unauthenticated
                    {
                        self.returned_rejections.insert(format!(".{k}"));
                    }
                }
            }
            self.note(r);
        }
        // What the function hands back where the lowering does not read it as a
        // refusal: ([`RawSymbol::unread_exits`]).
        if self.counting()
            && self.fn_depth <= 1
            && let Some(arg) = &it.argument
        {
            let covered = self.covered_returns.contains(&it.span.start);
            self.note_returned(arg, covered, None, 0);
        }
        // What the function the walk started on hands back: a function written
        // here, or anything else.
        if self.fn_depth <= 1
            && let Some(arg) = &it.argument
        {
            match unwrap_expr(arg) {
                f
                @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)) => {
                    self.returns_fn += 1;
                    self.note_product_params(f);
                }
                _ => self.returns_other = true,
            }
        }
        // `return helper(request)`, `return await helper(request)`: the value the
        // body hands back is what that call gave.
        if self.in_callback == 0
            && let Some(arg) = &it.argument
        {
            let mut returned = unwrap_expr(arg);
            if let Expression::AwaitExpression(a) = returned {
                returned = unwrap_expr(&a.argument);
            }
            if let Expression::CallExpression(call) = returned
                && let Some(r) = self.l.canon_callee(&call.callee)
            {
                self.returns_calls.insert(r);
            }
        }
        // A `return` with a value under a branch, a `switch` case or a `catch` that
        // does not turn the caller away serves those requests: what the function
        // does after it, in another arm or below, runs for the others only. (A bare
        // `return` may follow the refusal itself: the `if` it ends says.)
        if (self.branches > 0 || self.in_catch > 0)
            && it.argument.is_some()
            && self.return_serves(it)
        {
            self.served = true;
        }
        let exit = std::mem::replace(
            &mut self.p.exit,
            it.argument
                .as_ref()
                .map(|a| (peel(a).span().start, drift_core::ResponseVia::Return)),
        );
        let sent = self.p.sent;
        walk::walk_return_statement(self, it);
        self.p.exit = exit;
        if self.p.sent == sent
            && let Some(f) = self.p.frames.last_mut()
        {
            f.does.insert(("return".into(), None));
        }
    }

    fn visit_catch_clause(&mut self, it: &CatchClause<'a>) {
        let param = match it.param.as_ref().map(|p| &p.pattern) {
            Some(BindingPattern::BindingIdentifier(b)) => b.symbol_id.get(),
            _ => None,
        };
        self.p.frames.push(CatchFrame {
            param,
            classes: BTreeSet::new(),
            does: BTreeSet::new(),
        });
        self.in_catch += 1;
        walk::walk_catch_clause(self, it);
        self.in_catch -= 1;
        if let Some(f) = self.p.frames.pop() {
            let mut catches: Vec<RawOperand> = f.classes.into_iter().collect();
            if catches.is_empty() {
                catches.push(RawOperand::Text("*".into()));
            }
            let mut does: Vec<(String, Option<RawRef>)> = f.does.into_iter().collect();
            if does.is_empty() {
                does.push(("swallow".into(), None));
            }
            self.p.catches.insert(RawCatch { catches, does });
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        // A local bound to a value read off a parameter of the function made
        // ([`Collector::product_params`]) is one too.
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Some(sym) = id.symbol_id.get()
        {
            if self.reads_product_param(init) {
                self.product_params.insert(sym);
            }
            if self.reads_own_param(init) {
                self.own_locals.insert(sym);
            }
            if let Some(of) = self.param_chain(init) {
                self.param_values.insert(sym, of);
            }
            if self.credential_identity(init) {
                self.cred_locals.insert(sym);
            } else if self.credential_read(init) {
                self.cred_seeds.insert(sym);
            }
            if let Some(of) = self.param_root(init) {
                self.param_locals.insert(sym, of);
            }
        }
        // `const { userId } = opts`: each name is the parameter's value under its key.
        if let (BindingPattern::ObjectPattern(o), Some(init)) = (&it.id, &it.init)
            && let Some((name, token)) = self.param_root(init)
        {
            for prop in &o.properties {
                let target = match &prop.value {
                    BindingPattern::BindingIdentifier(b) => b.symbol_id.get(),
                    BindingPattern::AssignmentPattern(a) => match &a.left {
                        BindingPattern::BindingIdentifier(b) => b.symbol_id.get(),
                        _ => None,
                    },
                    _ => None,
                };
                let key = (!prop.computed)
                    .then(|| key_name(&prop.key))
                    .flatten()
                    .filter(|k| side_key(k));
                if let (Some(sym), Some(k)) = (target, key) {
                    self.param_locals
                        .insert(sym, (name.clone(), format!("{token}.{k}")));
                }
            }
        }
        if let Some(init) = &it.init {
            self.flow_declarator(&it.id, init);
            self.note_binding(&it.id, init);
            self.note_alias(&it.id, init);
        }
        if let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(init) = &it.init
            && matches!(
                unwrap_expr(init),
                Expression::CallExpression(_) | Expression::NewExpression(_)
            )
            && let Some(r) = rejection_marker(init, 0)
        {
            self.rejection_vars.insert(id.name.to_string(), r);
        }
        // `const r = unauthorized();`: what the body goes on to do with `r`.
        if self.counting()
            && self.fn_depth <= 1
            && let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(init) = &it.init
        {
            self.note_bound(id.name.as_str(), init, 0);
        }
        // `const check = () => assertAccess(user, id);` with `check` never read: the
        // function is written and never runs.
        if let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(
                f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
            ) = it.init.as_ref().map(unwrap_expr)
            && self.unread_local(id)
        {
            self.later_fns.insert(f.span().start);
        } else if let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(
                f @ (Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
            ) = it.init.as_ref().map(unwrap_expr)
            && self.fn_depth > 0
            && let Some(sym) = id.symbol_id.get()
        {
            self.named_fns.insert(f.span().start, sym);
            if match f {
                Expression::ArrowFunctionExpression(a) => a.r#async,
                Expression::FunctionExpression(f) => f.r#async,
                _ => false,
            } {
                self.async_fns.insert(sym);
            }
        }
        // `const table = { GET: () => ..., DELETE: () => { <check> } }` inside a
        // body: the functions are kept, and run where something picks one
        // (`table[req.method]()`), which no call here says.
        if self.fn_depth > 0
            && let Some(init) = &it.init
        {
            let mut kept = Vec::new();
            kept_functions(init, &mut kept, 0);
            self.later_fns.extend(kept);
        }
        // `const pending = assertAccess(user, id);` with `pending` never read: the
        // call's value is dropped as a statement's is.
        if let BindingPattern::BindingIdentifier(id) = &it.id
            && let Some(Expression::CallExpression(c)) = it.init.as_ref().map(unwrap_expr)
            && let Some(sym) = id.symbol_id.get()
            && self.l.scoping.get_resolved_reference_ids(sym).is_empty()
        {
            self.dropped.insert(c.span.end);
        }
        // `const r = await next()`, `const { ok } = await next()`: what the
        // continuation handed back.
        if let Some(init) = &it.init
            && self.mentions_continuation(init, 0)
        {
            match &it.id {
                BindingPattern::BindingIdentifier(id) => {
                    self.continuation_vars.insert(id.name.to_string());
                }
                BindingPattern::ObjectPattern(o) => {
                    for p in &o.properties {
                        if let BindingPattern::BindingIdentifier(b) = &p.value {
                            self.continuation_vars.insert(b.name.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_string_literal(&mut self, it: &StringLiteral<'a>) {
        self.strings = self.strings.saturating_add(1);
        // SQL written as text that names a tenant or an owner key
        // (`pool.query("select * from invoices where org_id = $1", [orgId])`): a
        // filter no fact records.
        if drift_core::practice::sql_names_scope(&lit(it)) {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
        walk::walk_string_literal(self, it);
    }

    fn visit_template_literal(&mut self, it: &TemplateLiteral<'a>) {
        // The same in a template, tagged or not (sql`select ... where org_id =
        // ${orgId}`): its literal parts are the text.
        let text: String = it
            .quasis
            .iter()
            .map(|q| q.value.raw.as_str())
            .collect::<Vec<&str>>()
            .join(" ");
        if drift_core::practice::sql_names_scope(&text) {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
        // sql`select ... where fleet_id = ${request.operator.fleetId}`.
        self.note_sql_scope(&text, it.expressions.iter());
        walk::walk_template_literal(self, it);
    }
}
