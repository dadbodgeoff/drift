//! The language-neutral fact model.
//!
//! A language parser lowers each source file into a [`FileFacts`]. Everything
//! downstream (roles, mining, policy, check) reads only these types, so adding
//! a language never touches the core.
//!
//! Canonical references are strings of the form `"<module>#<export>[.<member>...]"`:
//!
//! - `<module>` is a repo-relative POSIX path (`apps/web/lib/auth.ts`), or
//!   `pkg:<name>` for an external package (`pkg:zod`, `pkg:next/server`), or
//!   `global` for ambient names (`global#fetch`).
//! - `<export>` is the exported name at its *origin* after barrel and
//!   `export *` chains are followed, or `default`, or `*` for a namespace.
//! - Member paths are appended with `.` (`pkg:@prisma/client#prisma.link.findMany`).
//!
//! Every collection is kept sorted so serialised output is byte-identical
//! across runs, thread counts and machines.
//!
//! String literals are recorded only as a count ([`Symbol::string_literals`]), with one
//! amendment (facts schema 11): the practice facts may echo exactly three shape-checked
//! kinds of literal, and drop anything else. They are header names
//! ([`crate::practice::valid_header`], `^[a-z0-9-]{1,64}$`), route patterns
//! ([`crate::practice::valid_route`]) and numeric status codes. [`FileFacts::normalize`]
//! drops any header or route that fails its check, and every renderer still passes
//! them through `report::sanitize`.

use serde::{Deserialize, Serialize};

use crate::practice::{self, caps};

/// Bumped whenever the shape or meaning of facts changes. Part of every cache key.
/// 5: handler input controls and field decorators (#37). 6: lazy and optional imports (#49).
/// 7: `derives_from` (#51). 8: Python class `meta`, `decorator_args` and `disclaims`.
/// 9: wiring registries and discovery globs (#38). 10: class `members`, `server_reads`.
/// 11: practice facts (body_checks, responses, log_calls, catches, headers, inputs,
/// handles_errors, test_requests, mocks, route_matchers, dev_only).
pub const FACTS_SCHEMA_VERSION: u32 = 11;

/// Name of the base a class extends when its base expression names no class
/// (`class X(*BASES)`), or when it is defined again with other bases: the extends
/// wrap is `global#(base)`, no class of any repo, so the class's ancestry is unknown.
pub const UNKNOWN_BASE_NAME: &str = "(base)";

/// All facts for one source file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileFacts {
    /// Repo-relative POSIX path, Unicode NFC.
    pub path: String,
    /// BLAKE3 of the file's bytes (hex).
    pub hash: String,
    /// Language tag, e.g. `ts`, `tsx`, `js`, `jsx`.
    pub lang: String,
    /// Repo-relative directory of the nearest `package.json` ("" for the root).
    pub package: String,
    /// False when the parser reported errors; facts are then best-effort.
    pub parse_ok: bool,
    /// File-level directives such as `use client` or `use server`.
    pub directives: Vec<String>,
    /// Modules this file imports (canonical module ids), with the names used.
    pub imports: Vec<Import>,
    /// Names this file exports and where each one comes from.
    pub exports: Vec<Export>,
    /// Top-level symbols with their structural facts.
    pub symbols: Vec<Symbol>,
    /// Execution facts added by framework adapters (never conventions).
    pub entry_points: Vec<EntryPoint>,
    /// A matching test or spec file exists (`x.test.ts`, `__tests__/x.ts`, ...).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_test: bool,
    /// The module declares types only (type aliases, interfaces, ambient
    /// declarations, type imports and exports): it has no code that runs, so nothing
    /// to test. Recorded by TypeScript only; omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub type_only: bool,
    /// For `"use client"` files: the server-only modules reached through imports
    /// (the module that imports a server root such as `PrismaClient`, or the root
    /// package when imported directly), and non-public env vars read (`env:NAME`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub client_leaks: Vec<String>,
    /// Lists in this file that name other code by reference: array and object
    /// literals passed to a call or decorator (`@Module({ providers: [...] })`),
    /// module-level list and object bindings (`urlpatterns = [...]`,
    /// `export const routes = [...]`), and the arguments of repeated statement-level
    /// calls on one receiver (`app.use(a); app.use(b)`, `admin.site.register(M)`).
    /// What "registered somewhere" means for wiring rules. Sorted; not serialised
    /// when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub registries: Vec<Registry>,
    /// Repo-relative path globs this file loads every match of at run time
    /// (`import.meta.glob("./pages/*.tsx")`, `require.context("./x", true)`), or a
    /// framework autodiscovery marker (`celery:autodiscover_tasks`). Code these
    /// reach is wired without being listed anywhere. Sorted; not serialised when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub discovers: Vec<String>,
    /// Test files only: the requests the tests make. Sorted, at most
    /// [`caps::TEST_REQUESTS`](crate::practice::caps::TEST_REQUESTS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub test_requests: Vec<TestRequest>,
    /// Canonical modules this file mocks (`vi.mock` / `jest.mock` / `@patch("a.b")` /
    /// `mocker.patch`), and `msw:<route>` for an MSW handler. Sorted, at most
    /// [`caps::MOCKS`](crate::practice::caps::MOCKS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mocks: Vec<String>,
    /// The requests the file's code sends to another server, each with what is read
    /// of its URL ([`OutgoingRequest`]): what says whether an application that names
    /// another service only calls it or may relay requests to it. Not recorded for
    /// test files. Sorted, at most
    /// [`caps::OUTGOING`](crate::practice::caps::OUTGOING), the ones whose URL is not
    /// read kept before the others; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outgoing: Vec<OutgoingRequest>,
    /// Route patterns a middleware in this file applies to. Sorted, at most
    /// [`caps::MATCHERS`](crate::practice::caps::MATCHERS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route_matchers: Vec<RouteMatcher>,
    /// The capped file-level practice fields that lost entries to their cap, by JSON
    /// name (`test_requests`, `mocks`, `route_matchers`, and `route_matchers.patterns`
    /// for a matcher's own list): what such a field holds is not all there is, so a
    /// reader answers unknown, never none, from it. [`FileFacts::normalize`] adds each
    /// field it cuts; a lowering that caps a field itself adds its name. Sorted;
    /// omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub truncated: Vec<String>,
    /// What each mount of a router adds to an entry point of this file, where the
    /// mounts of its router do not all add the same ([`MountFacts`]). Sorted; omitted
    /// when empty. Read with [`FileFacts::mount`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<MountFacts>,
    /// The application objects the file builds at module level (`app = FastAPI()`),
    /// each with what Drift does not know of it ([`AppFacts`]). Sorted; omitted when
    /// empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apps: Vec<AppFacts>,
    /// The file as `drift security` and the practice map read it, when listings that
    /// mining does not read yet change it ([`Listed`]). None for every other file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listed: Option<Box<Listed>>,
    /// The lines of the registrations written as a route is (`x.get("/path", (req,
    /// res) => ...)`: a method named for an HTTP verb, a path written out, a handler
    /// written in place) that no listing of the file's entry points accounts for:
    /// routes that may be served and are in no inventory. What registers them was not
    /// read (the receiver is a parameter no call in the file hands a router, or of a
    /// framework with no adapter). TypeScript lowering 76; sorted; omitted when
    /// empty. Not test files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unlisted_routes: Vec<u32>,
}

/// What a file's facts are with every listing of entry points Drift makes
/// ([`FileFacts::listed`]), where that is not what `entry_points`, `mounts` and
/// `symbols` hold.
///
/// Mining's input is held at the entry points of the last build whose proposals were
/// measured (the frozen build of the pre-registered Python evaluation, F12), until
/// the next measured round: its verdict on what mining proposes carries over to a
/// later build only while that build mines the same input. Listings added since
/// (a registration under `i18n_patterns(...)`, a pattern list added to
/// `urlpatterns`, a router handed on to a mount that is not read) are marked where
/// they are made (`unmeasured`, in the language front end), and a file they change
/// keeps two readings: `entry_points`, `mounts` and `symbols` without them, which
/// is all mining reads, and this one with them, which `drift security` and the
/// practice map read ([`RepoFacts::listed`]). An entry point that is only here does
/// not make its symbol an entry point for a mined role, selector or evidence; one
/// whose route merely reads differently (`/?/x`) is in both.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Listed {
    /// Every entry point of the file.
    pub entry_points: Vec<EntryPoint>,
    /// [`FileFacts::mounts`] of those entry points.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<MountFacts>,
    /// The symbols whose facts differ with them (an entry point's guards from
    /// configuration, what it reads of its request, the guards every one of its
    /// mounts gives it), whole, by name and line.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<Symbol>,
    /// The calls whose shape decides what they are at a guard position, by symbol
    /// ([`SymbolCalls`]): for an entry point, each call written where a middleware, a
    /// hook or a wrapper of the route goes (`passport.authenticate("jwt", { session:
    /// false })`, `app.auth([verifyJwt, verifyKey])`, `requireRole("admin")`), on the
    /// route itself, on a router it is registered on or mounted through; for any
    /// other symbol, the calls its body or its initialiser makes of an export of a
    /// package on the closed list of library guards ([`crate::guard_lists`]): `const
    /// requireAuth = passport.authenticate("jwt")`. A library's guard is one only in
    /// a call shape the list understands, so a call that is not here is not proven.
    /// With it, whether the symbol's body hands the request on where the facts do
    /// not follow ([`SymbolCalls::hands_on`]). A file that has these keeps a listed
    /// reading for them alone, with the entry points and mounts it has anyway.
    /// TypeScript lowering 65; sorted; omitted when empty. Read with
    /// [`FileFacts::guard_calls_of`] and [`FileFacts::hands_on`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub guard_calls: Vec<SymbolCalls>,
    /// A Next.js configuration file (`next.config.*`): the rewrites its `rewrites`
    /// function returns ([`NextRewrite`]). The middleware of the package runs for the
    /// path a request asks for, not for the path it is rewritten to, so a route a
    /// rewrite reaches from a path the middleware's matcher leaves out is not
    /// guarded by it. TypeScript lowering 65; sorted; omitted when empty. Read with
    /// [`FileFacts::rewrites`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rewrites: Vec<NextRewrite>,
}

/// One rewrite of a Next.js configuration ([`Listed::rewrites`]): `{ source:
/// "/open/:path*", destination: "/api/admin/:path*" }`, each as written; `?` for
/// one that is not a literal, and both `?` for what the function returns that is
/// not read (a binding, a call, a spread). A destination on another host keeps the
/// text it begins with (`https://`).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NextRewrite {
    pub source: String,
    pub destination: String,
}

/// An application object a server can be started on ([`FileFacts::apps`]): a
/// `FastAPI()` or `Flask()` instance, or Django's `get_wsgi_application()`.
///
/// Its routes are served at the paths Drift lists only when nothing else stands
/// between the server and its router: a constructor option, a middleware, a wrapper
/// or an assignment that Drift does not know to leave the path alone is in
/// `unknown`, as written. Empty means every use of the object in the repository was
/// read and is one that does not move its routes.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct AppFacts {
    /// The module-level name it is bound to.
    pub name: String,
    /// 1-based line of the assignment.
    pub line: u32,
    /// Each construct Drift does not know, as written, with where it is. Sorted, at
    /// most 8.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unknown: Vec<String>,
}

/// The guards one mount of a router gives one entry point ([`FileFacts::mounts`]).
///
/// A router mounted more than once (`include_router(r, prefix="/admin",
/// dependencies=[Depends(require_admin)])` and again under `/public`) has an entry
/// point for each mount, and they share the handler's symbol. The symbol's `wraps`
/// hold what guards the handler on every mount; what one mount adds is here, keyed
/// by the entry point's symbol and route.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct MountFacts {
    /// [`EntryPoint::symbol`].
    pub symbol: String,
    /// [`EntryPoint::route`].
    pub route: String,
    /// The wraps this mount adds, outermost first: the dependencies and middleware
    /// given where the router is mounted, and those of the routers it is mounted
    /// through, that the handler's other mounts do not all have.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wraps: Vec<Wrap>,
    /// What this mount adds could not be read (`include_router(r, **options)`,
    /// `dependencies=DEPS`): whether the entry point is guarded is unknown, never
    /// taken from another mount. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub opaque: bool,
    /// The handler may also be served at paths that are not read (its URLconf has an
    /// include Drift cannot follow): this route is one of its routes, not known to
    /// be all of them. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub elsewhere: bool,
    /// The application middleware this mount passes through that the handler's other
    /// mounts do not all pass through ([`Symbol::app_middleware`] holds what all of
    /// them do). Sorted; omitted when empty. TypeScript (lowering 56): what the
    /// routers this mount goes through were given for a path that covers it, a
    /// middleware written in place before it, and [`APP_UNREAD`] where one of them
    /// was handed to a function.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub app_middleware: Vec<String>,
}

/// What starts an entry of [`Symbol::app_middleware`] (after its `?`) that is no
/// middleware Drift names: the application or blueprint the route is served by went
/// where Drift does not read what was registered on it (passed to a function of a
/// package, its hook registries written directly, built by a class of the
/// repository with its own constructor), and the rest says how. It may have a hook
/// that turns callers away: the route is never said to have no guard.
pub const APP_UNREAD: &str = "unread:";

/// What starts an entry of [`Symbol::app_middleware`] (after its `?`) that is a guard
/// class a NestJS application runs before every route: `app.useGlobalGuards(new
/// JwtAuthGuard())` on the application `NestFactory.create` built gives each route
/// of the package `nest_guard:<class>`. It is read as a class given to `@UseGuards`
/// or provided as `APP_GUARD` is (its `canActivate` decides). After `?`: the call
/// stands under a condition, in a loop or after a return some calls take, so the
/// guard may run and is not proven to. An argument that is no class built where it
/// is given (a variable, a factory's result, `app.get(Guard)`) is an
/// [`APP_UNREAD`] entry. TypeScript lowering 64.
pub const NEST_GUARD: &str = "nest_guard:";

/// A check in the body that turns a caller away (the condition of a REJECTS_CALLER-
/// style exit, or of a NotFound exit), and what the condition reads. Recorded where
/// `controls::REJECTS_CALLER` is recorded (outside catch/callbacks, before the
/// continuation), plus 404 exits under a condition that reads a subject.
///
/// TypeScript also records, since lowering 60, what `REJECTS_CALLER` does not
/// hold: a `try` whose `catch` answers "not signed in" is a check on what the `try`
/// verifies first (`try { await request.jwtVerify() } catch { return
/// reply.code(401).send() }`), unconditional where every request enters the `try`
/// and the function goes on only past it, and [`not_always::SWALLOWED`] where the
/// handler answers so for some of what it catches, hands the request on, or does
/// not leave; since lowering 62, a branch that sets the status in a statement of
/// its own and leaves (`res.statusCode = 401; return res.end()`). Since lowering
/// 64 a check that answers "not signed in" in a branch after which the function
/// goes on is [`not_always::SWALLOWED`] too. Mining reads none of these: what it
/// reads of a body is `REJECTS_CALLER`, which is what it was.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BodyCheck {
    /// Canonical callee whose result the condition tests, directly or through a local
    /// binding (`const s = await auth(); if (!s) ...` -> `pkg:next-auth#auth`;
    /// a FastAPI parameter bound to `Depends(get_current_user)` ->
    /// `app/deps.py#get_current_user`). `param:<name>` for a handler parameter,
    /// `header:<name>` for a request header, "" when none can be read.
    pub source: String,
    /// Member path read off the source, cut at MAX_MEMBER_DEPTH (`.user.orgId`,
    /// `.role`); "" for the value itself.
    pub reads: String,
    /// What it is compared with: "" (truthiness), `param:<name>`, `header:<name>`,
    /// `literal` (a string or number literal, never echoed), `call:<canonical>`, `env`
    /// (an env-derived secret: an `os.environ` read, or a module constant or settings
    /// attribute bound from one; the name is never echoed).
    pub compares: String,
    pub outcome: CheckOutcome,
    /// How the condition compares the value with another ([`check_op`]): `ne` when
    /// the caller is turned away where the two differ (`a != b`, `a not in b`,
    /// `a is not b`, `not (a == b)`, `a !== b`, the `else` of `a === b`), `eq` when
    /// turned away where they match, `other` for another comparison (`<`). Recorded
    /// also where the other value could not be read ([`Self::compares`] is then
    /// empty). Omitted when the condition compares nothing: a test of the value
    /// itself (`not a`, `a is None`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub op: String,
    /// The check sits inside a branch of the body that only some requests take: under
    /// another `if` (`if (req.method !== "GET") { ... if (!allowed) return 403 }`), in
    /// the `else` of a branch that goes on, in a loop or a `switch` / `match` case. A
    /// request that does not take the branch is not checked. A check after an `if`
    /// whose branch leaves (`if (!session) return 401; if (...) return 403`) is not
    /// conditional. Omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conditional: bool,
    /// Why the check is conditional ([`not_always`]): `under_branch`,
    /// `after_conditional_return`, `and_operand`, `bypass_operand`, `swallowed`.
    /// Omitted when it is not.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
    /// The condition in the code's own words, where the lowering can state it: `only
    /// when principal.org_id is not None`, `not when rule.visibility ==
    /// Visibility.SHARED`. Identifiers and operators only: a string literal is written
    /// `"…"`. At most [`not_always::MAX_WORDS`] characters; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unless: String,
    /// The member path read off what the value is compared with, as
    /// [`Self::reads`] is the path read off [`Self::source`]: `rule.orgId !==
    /// req.user.orgId` records `.user.orgId`, `rule.orgId !== req.query.orgId`
    /// records `.query.orgId`. It says whether the other side is the caller's or
    /// what the request sent. TypeScript lowering 54; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub compares_path: String,
    /// What the body calls before the check, canonical, in the order of each
    /// callee's first call: `repo.delete_rule(rule_id)` before `if rule.org_id !=
    /// caller.org_id: raise ...` records `app/repo.py#delete_rule`. The calls of the
    /// function the check is in, not those of the condition itself. A check that
    /// follows a call with an effect refuses after the effect: a reader follows
    /// each callee to say whether it has one. At most
    /// [`caps::CHECK_AFTER`](crate::practice::caps::CHECK_AFTER), then [`AFTER_MORE`]
    /// once; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub after: Vec<String>,
}

/// [`BodyCheck::after`] and [`RaiseCheck::after`]: more calls precede the check than
/// the list holds.
pub const AFTER_MORE: &str = "*";

/// Why a check or a call does not run for every request that reaches the body
/// ([`BodyCheck::condition`], [`RaiseCheck::condition`], [`Symbol::conditional_calls`]).
pub mod not_always {
    /// Under another `if`, in a loop, a `match` / `switch` case or an arm of `?:`.
    pub const UNDER_BRANCH: &str = "under_branch";
    /// After an `if` whose branch returns without refusing (`if preview: return
    /// {...}`, `if rule.visibility == SHARED: return`), or after the body has returned.
    pub const AFTER_CONDITIONAL_RETURN: &str = "after_conditional_return";
    /// An operand of an effective `and`: it decides only when the others hold (`x is
    /// not None and a != b`).
    pub const AND_OPERAND: &str = "and_operand";
    /// The right side of an `or`: skipped when the left side holds
    /// (`caller.is_support or check()`).
    pub const BYPASS_OPERAND: &str = "bypass_operand";
    /// A comparison that is an operand of an effective `and` whose every other
    /// operand tests that the caller lacks a role (`if not caller.is_superuser and
    /// row.owner_id != caller.id: raise Forbidden`, `if not (caller.is_admin or
    /// row.owner_id == caller.id)`): the request is refused unless the caller has
    /// the role or the comparison holds, so every request is decided, by the role
    /// or by the comparison. [`BodyCheck::unless`] names the role (`not when
    /// caller.is_superuser`). A reader that cannot show the role to be the
    /// caller's reads the comparison as an [`AND_OPERAND`].
    pub const ROLE_ALTERNATIVE: &str = "role_alternative";
    /// The test of the role beside a [`ROLE_ALTERNATIVE`] comparison: the caller is
    /// refused for lacking it only where the comparison fails too. Read as an
    /// [`AND_OPERAND`]; its sides are recorded so that a reader can say whose the
    /// role is.
    pub const ALTERNATIVE_ROLE: &str = "alternative_role";
    /// Inside a `try` with a handler that neither raises nor answers with an error:
    /// its refusal may be caught and the request served all the same. In
    /// TypeScript (lowering 64) also a check that answers "not signed in" in a
    /// branch after which the function goes on: the branch does not leave and what
    /// follows hands the request on or serves it (`if (!token) {
    /// res.status(401).json({}); } next();`), or the branch hands it on itself.
    pub const SWALLOWED: &str = "swallowed";
    /// A call of an `async def` whose value the body drops (`assert_rule_org(rule,
    /// caller)` as a statement of its own, or bound to a name the body never reads;
    /// not awaited, returned or handed to another call): the coroutine is built and
    /// never runs, so what the callee checks is not checked. In TypeScript, a call
    /// of an `async` function as a statement of its own, under `void`, or with only
    /// `.catch()` / `.then()` / `.finally()` on it: the promise settles after the
    /// caller went on, and its rejection stops nothing. Of
    /// [`super::Symbol::conditional_calls`] only.
    pub const NOT_AWAITED: &str = "not_awaited";
    /// TypeScript (lowering 75): the condition tests a local the body assigns more
    /// than once (`let ok = timingSafeEqual(a, b); if (dev) ok = true; if (!ok) ...`):
    /// what it holds where the check runs is not read, so the check is found and
    /// proves nothing.
    pub const UNREAD_LOCAL: &str = "unread_local";
    /// The most characters [`super::BodyCheck::unless`] holds.
    pub const MAX_WORDS: usize = 96;
}

/// How a check's condition compares its value ([`BodyCheck::op`], [`RaiseCheck::op`]).
pub mod check_op {
    /// The caller is turned away where the two values differ.
    pub const REFUSES_MISMATCH: &str = "ne";
    /// The caller is turned away where the two values match.
    pub const REFUSES_MATCH: &str = "eq";
    /// Another comparison (`<`, `>=`).
    pub const OTHER: &str = "other";
}

/// What a [`BodyCheck`] does to the caller it turns away.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum CheckOutcome {
    /// Not signed in: 401, `UNAUTHORIZED`.
    #[default]
    Unauthenticated,
    /// Not allowed: 403, `FORBIDDEN`.
    Forbidden,
    /// Not found: 404, `notFound()`, `TRPCError NOT_FOUND`.
    NotFound,
    /// Too many requests: 429.
    Throttled,
    /// A redirect to a sign-in page.
    SignInRedirect,
    /// Bad input: 400, 422 (a manual validation that turns the request away).
    Invalid,
}

/// A condition whose first exit raises an error class ([`Symbol::raise_checks`]):
/// `if org_id != self.caller.org_id: raise ForbiddenError(...)`. What the condition
/// reads and compares is recorded as for a [`BodyCheck`]; what the refusal means is
/// not decided here: the class raised is named, and its status when the raise states
/// one as a literal.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RaiseCheck {
    /// As [`BodyCheck::source`].
    pub source: String,
    /// As [`BodyCheck::reads`].
    pub reads: String,
    /// As [`BodyCheck::compares`], and [`UNREAD_COMPARE`] for a comparison with a value
    /// that could not be read (`if org_id != active.id`, `active` a local of unknown
    /// source): compared with something, as against a test of the value itself.
    pub compares: String,
    /// Canonical class the exit raises (`app/core/exceptions.py#ForbiddenError`,
    /// `pkg:fastapi#HTTPException`).
    pub raises: String,
    /// The status the raise states as a literal (`HTTPException(status_code=403)`);
    /// omitted when it states none.
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub status: u16,
    /// As [`BodyCheck::op`]: `if org_id != self.caller.org_id: raise ...` refuses a
    /// mismatch (`ne`); `if org_id == self.caller.org_id: raise ...` refuses the
    /// caller's own (`eq`). Omitted when the condition compares nothing.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub op: String,
    /// As [`BodyCheck::conditional`]. Omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub conditional: bool,
    /// As [`BodyCheck::condition`]. Omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
    /// As [`BodyCheck::unless`]. Omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unless: String,
    /// As [`BodyCheck::after`]. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub after: Vec<String>,
}

/// Between the callee and the dependency of an entry of [`Symbol::caller_args`].
pub const CALLER_ARG_VIA: &str = " via ";

/// The request-scoped holders whose attributes code may bind a value of the caller
/// on, as [`Symbol::caller_args`] names them: Flask's `g.<name>` and
/// `<request>.state.<name>` of Starlette and FastAPI (under one reference, whatever
/// the request is called).
pub const CALLER_HOLDERS: [&str; 2] = ["pkg:flask#g.", "global#request.state."];

/// What a request-scoped holder of TypeScript and JavaScript is written as in
/// [`Symbol::caller_args`], before the key: `global#held.depot` for `req.depot`,
/// `res.locals.depot`, Hono's `c.get("depot")` and `c.var.depot`, a tRPC `ctx.depot`
/// (one reference whatever the holder is, so a value a middleware binds on one is
/// found where a handler reads it off another spelling of it). TypeScript lowering 66.
pub const CALLER_HOLDER_TS: &str = "global#held.";

/// The entry of [`Symbol::caller_args`] for a use of a value of the caller that
/// has no callee to name: a comparison, a `switch`, an index, a test, a method of
/// a local or of the value itself. TypeScript lowering 66.
pub const CALLER_USE_UNREAD: &str = "global#scope_unread";

/// [`Member::unread`] for a method whose body answers 403.
pub const ANSWERS_403: &str = "status:403";

/// [`Member::unread`] of a permission test, where its body says what it answers a
/// caller who is not signed in: `has_permission(self, request, view)` of a class (a
/// DRF permission class reads `request.user`) and `test_func(self)` (a view with
/// Django's `UserPassesTestMixin` reads `self.request.user`). Read for a body that
/// is one `return <test>`, or that opens with `if not <signed in>: return False`;
/// any other body has none of the three, and what it answers is not read. Recorded
/// by Python (lowering 57).
///
/// The test is `True`, whoever asks: the class permits everyone.
pub const VERDICT_TRUE: &str = "verdict:true";
/// The test is false for a caller who is not signed in: `<user>.is_authenticated`
/// (or `is_staff`, `is_superuser`, which Django's anonymous user has as `False`),
/// `bool(...)` of it, an `and` with such an operand (`request.user and
/// request.user.is_authenticated`), an `or` of such operands only.
pub const VERDICT_SIGNED_IN: &str = "verdict:signed_in";
/// The test is false where the base class's own is: `super().has_permission(request,
/// view)`, alone, as an operand of an `and`, or beside operands of an `or` that are
/// false for a caller who is not signed in. What it answers is the base's answer.
pub const VERDICT_SUPER: &str = "verdict:super";
/// What a test asks of a caller who is signed in ([`Member::unread`] of Django's
/// `test_func`): a role, a group, a permission or a staff flag (`<user>.is_staff`,
/// `is_superuser`, `has_perm(...)`, `has_perms(...)`, `has_module_perms(...)`,
/// `groups.filter(...).exists()`), in every answer that lets the caller through.
/// Python lowering 61; read by the practice map only.
pub const ASKS_ROLE: &str = "asks:role";
/// The test was read to the end and asks only whether the caller is signed in and
/// what state the account is in (`is_authenticated`, `is_active`, `not
/// is_anonymous`, `True`): no role. A test with neither this nor
/// [`ASKS_ROLE`] is not read. Python lowering 61; read by the practice map only.
pub const ASKS_STATUS: &str = "asks:status";

/// [`RaiseCheck::compares`] for a comparison with a value that could not be read.
pub const UNREAD_COMPARE: &str = "value";

fn is_zero_u16(n: &u16) -> bool {
    *n == 0
}

/// One response the symbol sends.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ResponseFact {
    /// HTTP status; 0 when it is not a literal or a known constant.
    pub status: u16,
    pub via: ResponseVia,
    /// Canonical builder or class (`pkg:next/server#NextResponse.json`,
    /// `pkg:fastapi#HTTPException`, `lib/errors.ts#ApiError(new)`); "" for a literal.
    pub builder: String,
    /// Declared response model or schema, canonical (`response_model=UserOut`,
    /// `@ApiOkResponse({ type: UserDto })`, tRPC `.output(schema)`); "" none.
    pub model: String,
    /// Top-level keys of the body object literal, sorted, at most 8 (`error`, `code`,
    /// `message`): the error envelope.
    pub keys: Vec<String>,
    /// Inside a catch / except.
    pub in_catch: bool,
}

/// How a [`ResponseFact`] is sent.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ResponseVia {
    /// Returned (`return NextResponse.json(...)`, `return x, 400`).
    #[default]
    Return,
    /// Thrown or raised (`throw new NotFoundException()`, `raise HTTPException(404)`).
    Throw,
    /// A status setter (`res.status(n)`, `reply.code(n)`, `ctx.status = n`).
    Setter,
    /// `abort(n)`.
    Abort,
    /// Declared on the route (`status_code=`, Nest `@HttpCode(n)`).
    Declared,
    /// A redirect (`redirect()`, `RedirectResponse`).
    Redirect,
}

/// A call to a level-named method or a print (a log-call candidate; the classifier
/// decides whether the receiver is a logger).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct LogCall {
    /// Canonical callee as in `calls` (`global#console.error`, `lib/log.ts#logger.info`,
    /// `app/x.py#logger.exception`, `pkg:loguru#logger.info`, `global#print`).
    pub callee: String,
    /// Normalised level ([`crate::practice::LOG_LEVELS`]): trace, debug, info, warn,
    /// error, fatal, exception, log, print.
    pub level: String,
    pub in_catch: bool,
    /// An object literal argument, or keyword arguments beyond the message (`extra=`,
    /// structlog kwargs): structured logging.
    pub structured: bool,
    /// An argument is the caught error binding (or `exc_info=True`).
    pub passes_error: bool,
    /// The receiver is a logger derived with bound fields (`logger.bind(user=u)`,
    /// `log.child({ requestId })`, a structlog logger bound at its initialiser): the
    /// call logs those fields too. Omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bound: bool,
}

/// A data-access call whose filter names a tenant-like key ([`Symbol::scoped_queries`]):
/// `Item.objects.filter(organization=request.user.org)`,
/// `select(Item).where(Item.org_id == org_id)`.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ScopedQuery {
    /// Canonical callee of the filtering call (`app/models.py#Item.objects.filter`,
    /// `pkg:sqlalchemy#select().where`); "" when it does not resolve.
    pub callee: String,
    /// The tenant-like key filtered on, as the code names it (`organization`,
    /// `org_id`, `workspace__id`): an identifier ([`crate::practice::tenant_key`]).
    pub key: String,
    pub source: ScopeSource,
    /// Why the filtering call does not run for every request that reaches the body
    /// ([`not_always`]): the query is filtered under a branch (`if mine: stmt =
    /// select(Rule).where(Rule.org_id == caller.org_id)`), in an arm of a
    /// conditional expression, or after a return that serves. The other requests
    /// are answered by a query that is not this one. Omitted when it does (Python
    /// lowering 52).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub condition: String,
}

/// Where the value a [`ScopedQuery`] filters with came from.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ScopeSource {
    /// Not known.
    #[default]
    Unknown,
    /// The caller's session or identity (`request.user.org`, `current_user.org_id`,
    /// what an authenticating dependency gives).
    Session,
    /// A handler parameter (a path or query parameter).
    Param,
    /// A request header.
    Header,
    /// A literal (never echoed).
    Literal,
}

/// One catch / except clause.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct CatchFact {
    /// Canonical classes caught, sorted; `*` for a bare catch.
    pub catches: Vec<String>,
    /// What the clause does, sorted: `rethrow`, `throw:<canonical>`, `log`,
    /// `respond:<status>`, `report:<canonical>` (Sentry and the like), `return`,
    /// `swallow` (none of the others). `rethrow` is also a clause that hands what
    /// it caught to the continuation the framework gave the function, by position
    /// (`catch (e) { next(e) }`, `return next(e)`): the error goes on to the
    /// framework's error handling, and no `return` is recorded for it (TypeScript
    /// lowering 85, the listed reading only).
    pub does: Vec<String>,
}

/// A request the code sends with an HTTP client ([`FileFacts::outgoing`]): `fetch`,
/// `axios`, `got`, `ky`, `undici`, Node's `http`; `httpx`, `requests`, `aiohttp`,
/// `urllib`, and a method of a client or session object.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct OutgoingRequest {
    /// Why the URL's path is not written out, with the expression: it is built from
    /// the request being served (its path, its URL, a catch-all parameter), or it is
    /// not read (a name, a call, a path with no literal segment). Empty when the path
    /// is written out. Such a request may relay what the application is asked for.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub unread: String,
    /// 1-based line of the call.
    pub line: u32,
    /// The top-level function or class the call is in; empty at module level.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub within: String,
    /// The URL as written, each value in it as `{}` (`{}/v1/items/{}`,
    /// `http://api:8000/health`, `{}/{}`); empty when it is not an argument that is
    /// read. With `unread` empty, its path has a literal segment: the request goes to
    /// a path the code names, whoever asked, and a value in it is taken as an
    /// identifier or a parameter.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
}

/// A request a test makes ([`FileFacts::test_requests`], test files only).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TestRequest {
    /// GET, POST, ... or ANY.
    pub method: String,
    /// Route template, dynamic segments as `[*]` ([`crate::practice::normalize_route`]);
    /// "" when not a literal.
    pub route: String,
    /// Canonical module whose handler the test imports and calls directly (a Next.js
    /// `route.ts` GET called in the test), "" none.
    pub target: String,
    /// Status codes asserted in the same test block, sorted.
    pub statuses: Vec<u16>,
    /// The route had a non-literal part (a base-URL constant, an interpolated
    /// segment): which route the test requests is unknown, whatever [`Self::route`]
    /// holds. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dynamic: bool,
}

/// Route patterns a middleware applies to (Next.js `config.matcher`, Clerk
/// `createRouteMatcher([...])`).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RouteMatcher {
    /// `config.matcher`, or the binding the matcher is assigned to.
    pub binding: String,
    /// Route-shaped patterns ([`crate::practice::valid_route`]), sorted, at most 64.
    pub patterns: Vec<String>,
    /// The patterns are not all the matcher holds: one was dropped (by
    /// [`crate::practice::valid_route`] or the cap), or the matcher is not a literal
    /// list. For a middleware, no matcher means every route, a list means those
    /// patterns, and an empty list means unknown; [`FileFacts::normalize`] sets
    /// `opaque` on an empty list, so unknown is always explicit. Not serialised when
    /// false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub opaque: bool,
    /// What a route the patterns match gets. Not serialised when `unknown`.
    #[serde(default, skip_serializing_if = "MatcherPolarity::is_unknown")]
    pub polarity: MatcherPolarity,
}

/// What a [`RouteMatcher`]'s patterns mean for the routes they match.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum MatcherPolarity {
    /// The middleware applies to them (`config.matcher`, a protected-route list).
    Applies,
    /// They are opened to anyone (Clerk `isPublicRoute`): the middleware's check is
    /// skipped there.
    Public,
    /// Not known.
    #[default]
    Unknown,
}

impl MatcherPolarity {
    pub fn is_unknown(&self) -> bool {
        *self == MatcherPolarity::Unknown
    }
}

/// A list of references in one file ([`FileFacts::registries`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Registry {
    /// Where the list sits, independent of its line:
    ///
    /// - `arg:<callee>@<index>` or `arg:<callee>@<index>:<key path>`: an argument of a
    ///   call or decorator, or an object key inside it
    ///   (`arg:pkg:@nestjs/common#Module@0:providers`); Python keywords use
    ///   index 99 (`arg:pkg:celery#Celery@99:include`);
    /// - `binding:<name>`: a module-level binding (`binding:urlpatterns`,
    ///   `binding:default` for `export default [...]`);
    /// - `calls:<receiver>`: arguments of every statement-level call of a method of
    ///   `<receiver>` (`calls:pkg:django#contrib.admin.site`).
    pub slot: String,
    /// 1-based line where the list starts.
    pub line: u32,
    /// What it names, sorted by target.
    pub items: Vec<RegistryItem>,
    /// The list also holds something Drift cannot resolve to what it names: a
    /// call result (`...providers()`, `provideHttpClient()`), a function (a lazy
    /// route's `loadComponent`), a spread of something that is not a list, or a
    /// module named by a string Drift cannot place (`include("pkg.urls")`). A member
    /// missing from such a list may be in it: wiring rules call that unknown, never
    /// missing. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub opaque: bool,
}

/// One reference in a [`Registry`].
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RegistryItem {
    /// Canonical symbol (`src/users/users.service.ts#UsersService`, member paths cut),
    /// or a whole module named by string (`netbox/dcim/__init__.py#*` for
    /// `INSTALLED_APPS = ["dcim"]`).
    pub target: String,
    /// 1-based line of the reference.
    pub line: u32,
    /// Spread into the list (`...USE_CASES`, `*extra`): it stands for its own
    /// items, so it must be a list Drift can read, or the registry is opaque.
    /// Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub spread: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Import {
    /// Canonical module id (`apps/web/lib/auth.ts`, `pkg:zod`) or `unresolved:<specifier>`.
    pub module: String,
    /// Imported names (`default`, `*`, or export names), sorted.
    pub names: Vec<String>,
    pub type_only: bool,
    /// When the module is loaded (omitted when `static`).
    #[serde(default, skip_serializing_if = "ImportLoad::is_static")]
    pub load: ImportLoad,
}

/// When an import edge loads its module. A deferred load (any but `Static`) runs
/// only when the code that holds it runs, so a package can make the target optional.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ImportLoad {
    /// Loaded with the importing module: an `import ... from` declaration, a
    /// `require()`, `import()` or lazy-load helper call at module scope (or in a
    /// function called there in place), or any load of a module the file also
    /// re-exports (`export ... from`). Python imports are always `Static`: Python
    /// facts do not record when a module loads yet.
    #[default]
    Static,
    /// `require("m")` inside a function: loaded when the function runs.
    Require,
    /// `import("m")` inside a function: loaded asynchronously when it runs.
    Dynamic,
    /// The specifier is passed, inside a function, to a lazy-load helper of the
    /// repository: a function whose body `require()`s or `import()`s that parameter
    /// (`optionalRequire("m")`).
    Lazy,
}

impl ImportLoad {
    pub fn is_static(&self) -> bool {
        *self == ImportLoad::Static
    }

    /// The load of an edge reached in two ways: the earlier one (static first).
    pub fn earliest(self, other: ImportLoad) -> ImportLoad {
        self.min(other)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Export {
    /// Exported name (`default` for default exports).
    pub name: String,
    /// Canonical origin of the exported value, after following re-exports.
    pub origin: String,
    pub kind: ExportKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportKind {
    /// Declared in this file.
    Local,
    /// `export { x } from "./y"` or `export { x }` of an import.
    ReExport,
    /// `export * from "./y"` (name is `*`).
    ReExportAll,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    /// Exported names this symbol is visible as (`GET`, `default`, ...), sorted.
    pub exported_as: Vec<String>,
    /// 1-based line of the declaration.
    pub line: u32,
    /// Wrappers applied to the symbol's value, outermost first.
    pub wraps: Vec<Wrap>,
    /// Distinct canonical callees inside the symbol, sorted.
    pub calls: Vec<String>,
    /// Distinct JSX components rendered inside the symbol, sorted.
    pub renders: Vec<String>,
    /// Object-literal keys passed to wrappers or calls, as `callee@argIndex:key`.
    pub args: Vec<String>,
    /// Keys of `args` that some calls to the same callee in the symbol leave out, in
    /// the same form: `FieldSet@99:name` when one `FieldSet()` names its group and
    /// another does not. Such a key is optional per call. Sorted; recorded by Python
    /// only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub omits: Vec<String>,
    /// For a class: the attributes its body binds and the callees each one's statement
    /// calls directly, outside any method: `fieldsets=app/forms.py#FieldSet` for
    /// `fieldsets = (FieldSet(...),)`, and `fieldsets=` for the binding itself (so a
    /// subclass that reassigns `fieldsets` without the call is seen). A statement that
    /// binds nothing tracked has the attribute `""`. Calls in a method's decorators and
    /// default arguments belong to the method's name. Subclasses inherit what they do
    /// not reassign. Sorted; recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub declares: Vec<String>,
    /// Control-flow facts: `await`, `throw`, `try`, `return_jsx`.
    pub controls: Vec<String>,
    /// String literal values are recorded only as a count, never echoed.
    pub string_literals: u32,
    /// Convention ids suppressed by a `// drift-ignore <id>: <reason>` comment
    /// directly above the declaration. A reason is required.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suppressions: Vec<String>,
    /// Environment variables read directly (`process.env.DATABASE_URL`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reads: Vec<String>,
    /// Canonical classes or factories thrown (`lib/errors.ts#AppError`, `global#Error`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub throws: Vec<String>,
    /// Risky operations reached in the body (`raw_html`, `shell_exec`, `raw_sql`, ...).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sinks: Vec<String>,
    /// Canonical callees in first-call order (capped), for ordering rules.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<String>,
    /// What kind of class this is beyond its location ([`traits`]): `enum`,
    /// `namedtuple`, `typeddict`, `dataclass`, `protocol`, `abstract`, `base`
    /// (a base or mixin the repo builds on), `view` (a class whose
    /// handler methods are the entry points), and the purpose facts `subclassed` and
    /// `test_helper`. Sorted; empty for primary classes and for languages that do not
    /// record kinds yet.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub traits: Vec<String>,
    /// What the callee's declared parameter type says about each passed key: one
    /// entry per [`Symbol::args`] entry, as `callee@argIndex:key=required`,
    /// `=optional` or `=unknown`, sorted. `optional` covers `?`, a type with an
    /// `undefined` member and a destructuring default. Unknown means the declaration
    /// could not be read (no annotation, a union, an uninstalled package's type).
    /// TypeScript only; empty for languages that do not resolve parameter types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arg_types: Vec<String>,
    /// Canonical callees of [`Symbol::calls`] that the body calls only after it hands
    /// control on to its continuation (`next()`, the wrapped handler, `call_next`,
    /// `get_response`, a FastAPI dependency's `yield`), or on what the continuation
    /// hands back (`mapAuthErrors(await next())`, `map_errors(f(*args, **kwargs))`):
    /// they act on the result, not on the caller. Python also lists errors of
    /// [`Symbol::throws`] raised only there (`except AuthError: raise PermissionDenied`
    /// around the wrapped view). Mining does not read a guard into them
    /// ([`controls::REJECTS_CALLER`]). Sorted; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub after_continuation: Vec<String>,
    /// Classes only: canonical decorators on the class's fields (`pkg:@nestjs/graphql#Field`,
    /// `pkg:class-validator#IsUUID`), sorted. They say what a class is built for (a
    /// GraphQL type, a validated REST body, an ORM entity) when its own decorators do
    /// not. Empty for every other symbol and for languages that do not record them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub field_decorators: Vec<String>,
    /// Classes only: what the class's own inner `class Meta:` sets (Django models,
    /// forms, filtersets, serializers, graphene types): `model=<canonical class>` for
    /// `model = Site`, and `abstract` / `proxy` for `abstract = True` / `proxy = True`.
    /// A `Meta` inherited from a base is not recorded. Since Python lowering 72 also
    /// what the class gives of its fields: `fields=*` for `fields = "__all__"`,
    /// `exclude=<field>` for each field `exclude` names, and `hidden=<field>` for a
    /// field declared as never given back (`write_only=True`, by the field or by
    /// `extra_kwargs`; `Field(exclude=True)`, read with or without a `Meta`).
    /// Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub meta: Vec<String>,
    /// Python classes: the reference each class decorator is called with as its first
    /// positional argument, as `decorator=argument` (canonical):
    /// `pkg:django#contrib.admin.register=app/models.py#Site` for
    /// `@admin.register(Site)`. With [`Symbol::meta`]'s `model`, what a registration
    /// decorator registers the class under. Recorded by Python, and by TypeScript for
    /// Nest guards: `pkg:@nestjs/common#UseGuards=<guard>` on each handler a controller
    /// or method `@UseGuards(...)` guards, and `APP_GUARD=<guard>` on a `@Module` class
    /// whose providers register a global guard. Sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorator_args: Vec<String>,
    /// Names the symbol's docstring explicitly says it is not, or does not use,
    /// extend, fit or register with, as `Name=phrase`: `ChoiceSet=Not a ChoiceSet`,
    /// `RepositoryBase=doesn't fit RepositoryBase`. The phrase is rebuilt from a fixed
    /// vocabulary and the identifier, never other docstring text. Sorted; recorded by
    /// Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disclaims: Vec<String>,
    /// A value built from another binding by builder steps that only add to it
    /// ([`builders::ADDITIVE_STEPS`]; not metadata), or bound to one: the canonical binding followed by
    /// those steps in source order, without their arguments.
    /// `export const bookingsProcedure = authedProcedure.input(s).use(mw)` derives from
    /// `server/procedures.ts#authedProcedure.input().use()`, `export const p = base` from
    /// `lib/base.ts#base`. A value built by any other call (a factory, an unknown
    /// method) derives from nothing. Mining reads it to see that a wrapper built on a
    /// rule's wrapper is that wrapper. Empty when none; recorded by TypeScript only.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub derives_from: String,
    /// Functions only: the call wrappers of the value the function returns, when that
    /// value is a function wrapped in them, outermost first, as [`Symbol::wraps`] reads
    /// a value's wrappers: `return createTransformer((file, api) => ...)` records
    /// `lib/create-transformer.ts#createTransformer`. Only the body's last statement (or
    /// a concise arrow body) counts; a wrapper called anywhere else in the body is a call.
    /// A factory of wrapped functions: what it returns carries the wrapper, though it
    /// does not ([`Symbol::wraps`] stays empty). Recorded by TypeScript only;
    /// omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns_wrapped_by: Vec<String>,
    /// A value that is a function made by a factory: the canonical callee of the call
    /// it is bound to (`export const withAuth = createAuthWrapper(opts)` records
    /// `lib/auth.ts#createAuthWrapper`), when that callee is proven to return a
    /// function. Proven means its declared return type is a function type (in-repo
    /// source or a `.d.ts`, an installed package's included), or it is a TypeScript
    /// function that is neither async nor a generator and every `return` of its own
    /// body hands back a function. Such a symbol's [`Symbol::kind`] is `function`.
    /// A call whose callee returns anything else, or what Drift cannot read (a type
    /// name, an uninstalled package, a JavaScript file), records nothing and the value
    /// stays a value. Recorded by TypeScript only; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub made_by: String,
    /// Classes only: each method the class body defines (and, in TypeScript, each
    /// property bound to a function), with what that method alone calls and the risky
    /// operations in it. The class's own [`Symbol::calls`] and [`Symbol::sinks`] are
    /// those of every member together; a call of one method (`storage.delete()`,
    /// `ProjectService.exists()`) runs only that one, which is what `drift security`
    /// follows. Calls of a sibling method through `this` / `self` / `cls` are recorded
    /// as the class's member (`lib/storage.ts#StorageClient.upload`). Sorted by name;
    /// omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<Member>,
    /// Of [`Symbol::reads`], those made only where the code runs on the server: the
    /// `typeof window === "undefined"` side of a check, or what follows
    /// `if (typeof window !== "undefined") return`. In a `"use client"` module they do
    /// not reach the browser. Sorted; recorded by TypeScript only; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub server_reads: Vec<String>,
    /// In-body checks that turn a caller away (facts schema 11). Sorted, at most
    /// [`caps::BODY_CHECKS`](crate::practice::caps::BODY_CHECKS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_checks: Vec<BodyCheck>,
    /// Responses the symbol sends (facts schema 11). Sorted, at most
    /// [`caps::RESPONSES`](crate::practice::caps::RESPONSES); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub responses: Vec<ResponseFact>,
    /// Log-call candidates (facts schema 11). Sorted, at most
    /// [`caps::LOG_CALLS`](crate::practice::caps::LOG_CALLS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log_calls: Vec<LogCall>,
    /// Catch / except clauses (facts schema 11). Sorted, at most
    /// [`caps::CATCHES`](crate::practice::caps::CATCHES); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catches: Vec<CatchFact>,
    /// Request header names read, lower-case, only from literals
    /// (`req.headers.get("x-org-id")`, `headers().get(..)`, Nest `@Headers("x")`,
    /// FastAPI `Header(alias=..)`, or a `x_org_id: str = Header()` parameter mapped `_`
    /// to `-`); each a [`crate::practice::valid_header`]. Sorted, at most
    /// [`caps::HEADERS`](crate::practice::caps::HEADERS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<String>,
    /// Canonical types or schemas that request input is validated into (Nest
    /// `@Body() dto: CreateDto`, a FastAPI body or query model, tRPC `.input(x)`,
    /// `schema.parse(await req.json())`, next-safe-action `.schema(x)`). Sorted, at most
    /// [`caps::INPUTS`](crate::practice::caps::INPUTS); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<String>,
    /// Canonical error classes this symbol is registered to handle
    /// (`@app.exception_handler(X)`, `add_exception_handler(X, h)`, Nest `@Catch(X)`,
    /// Flask `@errorhandler(404)` as `status:404`), `*` for any (Express 4-arity error
    /// middleware, a tRPC `errorFormatter`). Sorted, at most
    /// [`caps::HANDLES`](crate::practice::caps::HANDLES); omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handles_errors: Vec<String>,
    /// Data-access calls whose filter names a tenant-like key, with where the value
    /// came from (facts schema 11, PLAN-R14 B7). Sorted, at most
    /// [`caps::SCOPED_QUERIES`](crate::practice::caps::SCOPED_QUERIES); omitted when
    /// empty. Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoped_queries: Vec<ScopedQuery>,
    /// Conditions whose first exit raises an error class, outside any `except` and
    /// before the body hands control on, with the class raised ([`RaiseCheck`]): what a
    /// [`Symbol::body_checks`] entry cannot say when the raise states no status
    /// (`raise ForbiddenError(...)` of the repository's own class) or the condition
    /// names no subject (`if org_id != active.id: raise HTTPException(403)`). Mining
    /// decides what the class means. Sorted, at most
    /// [`caps::RAISE_CHECKS`](crate::practice::caps::RAISE_CHECKS) (`raise_checks` in
    /// [`Symbol::truncated`] when cut); omitted when empty. Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raise_checks: Vec<RaiseCheck>,
    /// A module-level name that stands for a class in annotations: the class an
    /// `Annotated[...]` alias annotates (`RuleBookDep = Annotated[RuleBook,
    /// Depends(get_rule_book)]` records `app/services/rule_book.py#RuleBook`).
    /// A parameter annotated with the name is of that class, so a method called on it
    /// (`<alias>.list_rules` in a body's [`Symbol::calls`]) is the class's method. A
    /// builtin is named as one (`Annotated[str, Depends(get_token)]` records
    /// `global#str`); empty when the annotated type is not a name (a union of two
    /// classes, a generic). Recorded by Python only; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub alias_of: String,
    /// Method calls on a value that [`Symbol::calls`] does not hold, named by what the
    /// receiver is: a local bound once to a call (`svc = RuleBook(db)` then
    /// `svc.list(org)` records `app/services.py#RuleBook().list`), a parameter a
    /// dependency injects with no annotation (`exporter=Depends(get_exporter)` then
    /// `exporter.run(user_id)` records `app/deps.py#get_exporter().run`), a longer
    /// path through a typed parameter (`service.repo.find` as `<class>.repo.find`).
    /// Where what the receiver is cannot be told and the call hands a value on (as
    /// [`controls::UNREAD_CALL`] reads it), the call is named by the receiver's own
    /// name: `param:<name>.<path>` for a parameter (`self` among them), `local:<name>.
    /// <path>` for a local. A reader that asks "was everything this body runs read"
    /// answers no for such a call. A plain value's method (a literal's, a list's, a
    /// built-in's result's) is not recorded, nor is a method of what a package's call
    /// handed back (`httpx.get(url).json`), nor the call that hands control on to the
    /// continuation. Mining proposes no convention from it.
    /// Sorted; omitted when empty.
    ///
    /// TypeScript (lowering 55) records three kinds, in a body that is inside a
    /// function: a method called through `this` that the class does not define
    /// itself (`this.scoped(orgId)`, canonical as the class's own: a base class's,
    /// or a property that holds a function); a method of a property whose type is
    /// not read (`local:this.rules.list`: inherited, typed by an interface, a
    /// getter), but for a property that holds a plain value (an array, a map, a
    /// literal); and a call through a local that is another name for a module's
    /// binding (`const svc = services.rules; svc.list(orgId)`, `const { ruleService }
    /// = await import("./service")`), canonical as what it names.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<String>,
    /// Functions only: the class every `return` (or `yield`) of the function's own
    /// body builds for the value it hands back: `return RuleBook(caller)` records
    /// `app/services.py#RuleBook`; a local bound once to such a call and returned
    /// counts (`db = SessionLocal()` ... `yield db`). A class is what PEP 8 writes as
    /// one (CapWords); the reader checks what the name is. A method called on what
    /// the function returns (`get_service().run`) is then that class's own, whatever
    /// the function's annotation says. Empty when the returns disagree, hand back
    /// what another function returned (`return redirect(url)`) or no call, or there
    /// is none. Recorded by Python only; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub returns_instance: String,
    /// Functions only: the class the return annotation names (`-> RuleBook`,
    /// `-> Iterator[Session]` for a generator, `-> RuleBook | None`). What the
    /// function hands back is of that class or of a subclass. A builtin is not
    /// recorded. Recorded by Python only; omitted when empty.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub returns_type: String,
    /// Classes only: the class of each attribute `__init__` binds on `self` from a
    /// parameter annotated with a class (`self.db = db` with `db: AsyncSession`) or
    /// from a constructor call (`self.repo = RuleRepository()`), as
    /// `attribute=<canonical class>` (`db=pkg:sqlalchemy.ext.asyncio#AsyncSession`).
    /// A method called through the attribute of an instance (`repository.db.commit`)
    /// is that class's. A builtin's is not recorded. Sorted; recorded by Python only;
    /// omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attr_types: Vec<String>,
    /// The repository's callees (of [`Symbol::calls`] and [`Symbol::receiver_calls`])
    /// that the body calls only where some requests do not get, as
    /// `<why>:<canonical>` ([`not_always`]): `under_branch:app/helpers.py#
    /// assert_same_org` for `if request.method != "GET": assert_same_org(rule,
    /// caller)`. A callee the body also calls on every path is not listed; a package's
    /// is listed only where it is a policy library's ([`POLICY_LIBRARIES`]: its call
    /// is the check). What such a callee checks is not checked for every request.
    /// A `not_awaited` entry says the call's value is dropped and the callee is, or
    /// may be, `async` (a method reached through a binding the linker does not
    /// follow): a reader that resolves the callee checks [`Symbol::is_async`].
    /// Sorted; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<String>,
    /// Functions only: the callees whose call's value the body hands back, canonical:
    /// `return proxyRequest(request)`, `return await load(url)`, of the function's own
    /// body (never a callback's). A function that returns what another call gave is
    /// answered by that call: what it catches and throws is how the function's errors
    /// become responses. Empty where a `return` hands back anything else. Sorted;
    /// omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub returns_calls: Vec<String>,
    /// The callees the body hands a value of the caller to, canonical: an argument
    /// read off the session or identity (`request.user.staff`, `g.user.venue_id`),
    /// not a parameter of the handler itself. `Shipment.objects.visible_to(
    /// request.user)`, `load(order_id, g.user.venue_id)`: what the callee does with
    /// the value may be how the rows are scoped to the caller, so a reader that finds
    /// no check and no filter does not take the body for one that scopes nothing. A
    /// value of what a declared dependency gives (`principal.depot_id`, `principal`
    /// a parameter bound to `Depends(current_principal)`) is written `<callee> via
    /// <dependency>` ([`CALLER_ARG_VIA`]): it is the caller's where that dependency
    /// signs the caller in, which a reader decides (`Depends(get_db)` gives a
    /// session of the database). Since Python lowering 58 the same `via` names what
    /// else may give the value, kept where it may: a function of the repository
    /// called with nothing or with the request, whose body returns a value of the
    /// caller ([`controls::RETURNS_CALLER`]) or turns callers away (`load(rid,
    /// current_venue_id())`), and an attribute of a request-scoped holder
    /// ([`CALLER_HOLDERS`]: `g.venue_id`, `request.state.tenant`) that some body of
    /// the repository binds a value of the caller on. That binding is an entry with
    /// the holder as the callee (`pkg:flask#g.venue_id`, or `... via <giver>`), and
    /// a comparison or a filter with what a giver hands back is one with the giver
    /// as its own callee (`<giver> via <giver>`); since lowering 59 also with what a
    /// declared dependency gives (`r.region == db.info["region"]` is `get_db via
    /// get_db`, which a reader drops: it recorded [`controls::SCOPE_UNREAD`] whatever
    /// the dependency). A class's are those of its whole
    /// body; a method's own are in [`Member::caller_args`]. Recorded by Python
    /// (lowering 53), and by TypeScript (lowering 66) in the listed reading only
    /// ([`Listed::symbols`]): there a value of the caller is one of the closed list of
    /// sources of `drift-ts` (`caller.rs`), an entry is every call that is given
    /// one and is not on that module's list of what is no scope (a response, a log, a
    /// conversion), `via` names a function of the repository whose body returns a
    /// value of the caller or a request-scoped holder ([`CALLER_HOLDER_TS`]), and a
    /// use with no callee to name (a comparison, a method of a local) is the entry
    /// [`CALLER_USE_UNREAD`]. Sorted; omitted when empty. Mining does not read it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<String>,
    /// Entry points only: the middleware of the application that serves the route,
    /// on every mount of it, canonical: a function registered with
    /// `@app.middleware("http")`, a class given to `app.add_middleware(...)` (the
    /// repository's or a package's), `global#<words>` for one that could not be read.
    /// After `?`: one that only some of the applications serving the route at this
    /// path have (the service's own and a test's, built on the same router; a Flask
    /// hook registered under a branch, or on what a factory returned), or
    /// [`APP_UNREAD`] and how the application went where Drift does not read.
    /// It runs before the handler for every request, and may turn the caller away.
    /// Never a wrap: mining proposes nothing from it. Sorted; omitted when empty.
    ///
    /// TypeScript: the Fastify hooks of the route's instance, a middleware written in
    /// place before it and what its router was given for a path that covers it
    /// (lowering 51); from lowering 56 also what every router it is mounted through
    /// runs before the mount, a package's Fastify plugin the instance was handed to,
    /// and [`APP_UNREAD`] where the router was handed to a function (`passed to
    /// setupAuth`) or the route's own options or handlers are spread into the
    /// registration (`route options spread from secured`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub app_middleware: Vec<String>,
    /// The capped practice fields of this symbol that lost entries to their cap, by
    /// JSON name (`body_checks`, `responses`, `responses.keys` for a response's own
    /// keys, `log_calls`, `catches`, `headers`, `inputs`, `handles_errors`,
    /// `scoped_queries`, `raise_checks`): what such
    /// a field holds is not all there is, so a reader answers unknown, never none,
    /// from it. [`FileFacts::normalize`] adds each field it cuts; a lowering that caps
    /// a field itself adds its name. Sorted; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub truncated: Vec<String>,
    /// Functions only: declared `async` (`async def`, `async function`, an `async`
    /// arrow function a name is bound to), or annotated to hand back a promise
    /// (`): Promise<void>`). A call of it whose value is dropped runs nothing to the
    /// end before the caller goes on ([`not_always::NOT_AWAITED`]). Omitted when
    /// false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
}

/// What [`Member::unread`] holds for a method whose body hands the request on where
/// the facts do not follow ([`SymbolCalls::hands_on`], for a method). TypeScript
/// lowering 65.
pub const MEMBER_HANDS_ON: &str = "hands_on";

/// The calls of one symbol whose shape decides what they are at a guard position
/// ([`Listed::guard_calls`]), keyed as [`MountFacts`] is: by the symbol's name and
/// line.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SymbolCalls {
    pub symbol: String,
    pub line: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<GuardCall>,
    /// The symbol's body hands the request on where the facts do not follow: it
    /// gives a parameter of a function (the request, the response, the
    /// continuation) to a call that is not recorded (`guards[kind](req, res, next)`,
    /// `svc.check(req, res, next)`), or gives a value to a method of a local
    /// binding (`const svc = container.get("auth"); svc.verify(token)`). What runs
    /// then is not read, so a function with this fact standing where a guard goes
    /// is never taken for one that turns no one away. Not the call of the
    /// continuation itself (`next()`, the wrapped handler). Not serialised when
    /// false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hands_on: bool,
    /// A function that hands back, at every `return` of its own that has a value, a
    /// function written where it is returned (`function requireRole(role) { return
    /// (req, res, next) => { ... } }`, `(role) => (req, res, next) => ...`): called
    /// where a guard goes, what runs is in its own body. One that returns anything
    /// else (a binding, a member of a table, the result of a call) returns what the
    /// facts do not follow. Not serialised when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_function: bool,
    /// The callees every call of which stands in the block of a `try` that has a
    /// handler, as [`Symbol::calls`] writes them: what such a call throws goes to
    /// the handler ([`Symbol::catches`]), not past the function. Sorted; omitted
    /// when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caught: Vec<String>,
    /// The callees every call of which stands in a branch taken only where a
    /// credential the request carries was read and is present (`const token =
    /// req.cookies.token; if (token && ...) { jwt.verify(token, key) }`), as
    /// [`Symbol::calls`] writes them: a request that carries no credential runs
    /// none of them, so whatever they refuse, they refuse no one for carrying
    /// none. Sorted; omitted when empty. TypeScript lowering 76.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub given_credential: Vec<String>,
    /// The calls of a verifying member of a parameter
    /// ([`crate::guard_lists::VERIFIER_MEMBERS`]: `request.jwtVerify()`) outside
    /// any `try`, as `param:<parameter>.<member>`: what it throws leaves the
    /// function. Sorted; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verifies: Vec<String>,
    /// A function whose body does something with a value of one of its own
    /// parameters ([`controls::PARAM_FLOWS`], which Python writes as a control):
    /// it hands one to a call that is no response, log or conversion, compares one,
    /// switches or indexes by one, tests one that is no parameter itself, or (since
    /// TypeScript lowering 68) returns one, which is then used where the call's
    /// value is. A
    /// reader that follows a call given a value of the caller into a function
    /// without this fact has read a body that does nothing with the value. A
    /// method's is in [`Member::unread`]. TypeScript lowering 66; not serialised
    /// when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub param_flows: bool,
}

/// One call at a guard position, or of a library's guard ([`Listed::guard_calls`]):
/// the callee as a wrap of it is written (`pkg:passport#default.authenticate`,
/// `pkg:express-jwt#expressjwt().unless`, `src/auth.ts#requireRole`,
/// `global#fastify.auth` for a member of a Fastify instance), and the arguments of
/// each call of the chain, innermost first: `expressjwt({ secret }).unless({ path })`
/// has two lists. An array literal a binding of the module holds (`const stack =
/// [authenticate, requireVerified]`) is written as a call of [`GuardCall::LIST`] given
/// its elements: handed where a guard goes, each of them runs.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct GuardCall {
    pub callee: String,
    pub args: Vec<Vec<CallArg>>,
}

impl GuardCall {
    /// The callee an array literal is written under.
    pub const LIST: &str = "global#[]";
    /// The callee an object literal that names a Fastify hook is written under
    /// (`const secured = { onRequest: [authenticate] }`), given the object: handed
    /// to a route as its options, what it holds under the hooks runs.
    pub const OPTIONS: &str = "global#{}";
    /// The callee the middleware steps of a builder chain are written under
    /// (`export const authed = base.use(isAuthed).use(audit)`), given what each
    /// step is given, in order: the binding built is the base with each of them.
    pub const STEPS: &str = "global#.use";
    /// The most [`SymbolCalls::calls`] holds for one symbol.
    pub const MAX: usize = 32;
    /// How deep an argument is read ([`CallArg::Unread`] below that).
    pub const MAX_DEPTH: usize = 4;
    /// The most elements of a list or properties of an object that are read: a
    /// longer one ends in [`CallArg::Unread`].
    pub const MAX_ITEMS: usize = 16;
}

/// One argument of a [`GuardCall`], as far as it is written where the call is.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallArg {
    /// A text literal (a template with no expression too).
    Text(String),
    Bool(bool),
    /// A number literal, as written.
    Number(String),
    /// `null` or `undefined`.
    Null,
    /// An array literal.
    List(Vec<CallArg>),
    /// An object literal: its properties in order, a spread as the key `...`.
    Object(Vec<(String, CallArg)>),
    /// A reference Drift names (a function, a binding, a package's export),
    /// canonical.
    Ref(String),
    /// A call given as the argument.
    Call(GuardCall),
    /// A function written in place.
    Function,
    /// `...rest`.
    Spread,
    /// Anything else: a parameter, a local, a conditional, a computed member.
    Unread,
}

/// One method of a class ([`Symbol::members`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Member {
    /// The method's name (`constructor` / `__init__` for the one that builds an instance).
    pub name: String,
    /// Distinct canonical callees inside the method, sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calls: Vec<String>,
    /// Risky operations in the method's body, sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sinks: Vec<String>,
    /// The method can hand back a value that is not a constant: some `return` of its own
    /// body (or its concise body) is not a literal (`return a === b`, `return !!user`,
    /// `return this.check(req)`), as against `return true`. With no calls, a Nest
    /// `canActivate` that only compares values still decides. Recorded by TypeScript
    /// only; omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_nonconstant_bool: bool,
    /// The method has a `return`, and every `return` of its own body (or its concise
    /// body) hands back the literal `true`: a Nest `canActivate` that can only let
    /// the request through, whatever it calls on the way. Recorded by TypeScript
    /// (lowering 65); omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub returns_only_true: bool,
    /// The method's own checks that turn the caller away ([`Symbol::body_checks`], for
    /// this method alone): how a service method scopes or forbids what a handler hands
    /// it. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_checks: Vec<BodyCheck>,
    /// Error classes the method's own body raises or throws. Omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub throws: Vec<String>,
    /// Keys passed to calls in the method's own body ([`Symbol::args`], for this
    /// method alone): the filter keys of its queries. Sorted; omitted when empty.
    /// Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// The method's own scoped queries ([`Symbol::scoped_queries`], for this method
    /// alone). A value from the method's own parameter is whatever its caller passed.
    /// Sorted; omitted when empty. Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoped_queries: Vec<ScopedQuery>,
    /// The method's own conditions that raise an error class
    /// ([`Symbol::raise_checks`], for this method alone). Sorted; omitted when empty.
    /// Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub raise_checks: Vec<RaiseCheck>,
    /// The repository's own decorators on the method, canonical, outermost first
    /// (`@require_role("admin")` records `app/deps.py#require_role`): what runs around
    /// the method's body when it is called, which may be where a caller is turned
    /// away. A built-in's or a package's (`@staticmethod`, `@abstractmethod`, DRF's
    /// `@action`) is not recorded. Omitted when empty. Recorded by Python only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorators: Vec<String>,
    /// The method's own calls on a receiver [`Member::calls`] does not hold
    /// ([`Symbol::receiver_calls`], for this method alone). Sorted; omitted when
    /// empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub receiver_calls: Vec<String>,
    /// The method's own conditional calls ([`Symbol::conditional_calls`], for this
    /// method alone). Sorted; omitted when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional_calls: Vec<String>,
    /// What the method's own body calls, canonical, in the order of each callee's
    /// first call, a sibling method called through `this` among them
    /// ([`Symbol::order`], for this method alone): a callee first called after a call
    /// that may change data checks what it checks after the effect. At most
    /// [`caps::CHECK_AFTER`](crate::practice::caps::CHECK_AFTER), then [`AFTER_MORE`]
    /// once; omitted when empty. TypeScript lowering 54, Python lowering 51.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<String>,
    /// What the method's own body does that no other fact of it records:
    /// [`controls::UNREAD_EXIT`] and [`controls::SCOPE_UNREAD`], as a function's
    /// [`Symbol::controls`] hold them, [`controls::HANDLER_REJECTS`] or
    /// [`controls::HANDLER_MAY_REJECT`] the same way (what it answers in its `except`
    /// handlers), [`controls::PARAM_FLOWS`], and [`ANSWERS_403`] where the body answers 403 outside any `except`
    /// (a function's [`Symbol::responses`] say so). Sorted; omitted when empty.
    /// Recorded by Python; TypeScript records [`controls::SCOPE_UNREAD`],
    /// [`MEMBER_HANDS_ON`] and, since lowering 66, [`controls::PARAM_FLOWS`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
    /// The callees the method's own body hands a value of the caller to
    /// ([`Symbol::caller_args`]). Sorted; omitted when empty. Recorded by Python, and
    /// by TypeScript since lowering 66.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub caller_args: Vec<String>,
    /// The method is declared `async` ([`Symbol::is_async`]). Omitted when false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_async: bool,
}

/// Builder methods that configure a wrapper binding without replacing it: tRPC
/// procedures (`.use()`, `.input()`), next-safe-action clients (`.use()`,
/// `.inputSchema()`). How the libraries run, not a convention.
pub mod builders {
    /// Steps that only add to what the binding they are called on does: middleware or
    /// a schema. A binding built from another with these steps runs everything the
    /// other runs (its middleware, including any authentication, comes first).
    /// Metadata (`.meta()`, `.metadata()`) is not among them: middleware reads it, and
    /// `authedProcedure.meta({ authRequired: false })` can turn authentication off.
    pub const ADDITIVE_STEPS: &[&str] = &[
        "use",
        "input",
        "output",
        "concat",
        "unstable_concat",
        "inputSchema",
        "schema",
        "outputSchema",
        "bindArgsSchemas",
    ];
    /// Steps that add middleware. Drift does not record which middleware, so a rule's
    /// `.use()` is held only by the same step written at the same place in the member's
    /// own chain, never by one of a binding the member's wrapper is built on.
    pub const MIDDLEWARE_STEPS: &[&str] = &["use", "concat", "unstable_concat"];
    /// Steps that declare the input a handler takes: a handler that takes none needs none.
    pub const INPUT_STEPS: &[&str] = &["input", "inputSchema", "schema", "bindArgsSchemas"];
}

/// The key [`Symbol::args`] records for a call that unpacks `**kwargs` or `*args`
/// (`OAuth2PasswordBearer(**opts)`): it may pass any key. Recorded by Python only.
/// Mining never proposes passing it.
pub const SPLAT_KEY: &str = "**";

/// Control facts ([`Symbol::controls`]) that are shared between the parsers and mining.
pub mod controls {
    /// A handler that reads request input (a tRPC `input`, a parsed body, query or
    /// path parameters, a server action's arguments).
    pub const READS_INPUT: &str = "reads_input";
    /// A handler that provably reads no request input: no parameter, or only
    /// parameters that carry none (`({ ctx }) => ...`). A handler with neither fact
    /// may or may not read input.
    pub const NO_INPUT: &str = "no_input";
    /// A Python handler whose every request input arrives through a parameter the
    /// framework binds and parses by its declared type before the body runs (a
    /// FastAPI parameter annotated `uuid.UUID`, `EmailStr` or a model; a Django or
    /// Flask URL converter such as `<uuid:pk>`), and whose body reads no other
    /// input: a value the type does not take is answered with an error, not served.
    /// In the listed reading only (the practice map's validation concern).
    pub const INPUT_TYPED: &str = "input_typed";
    /// A FastAPI route decorator given `response_model=None`: the return annotation
    /// is no response model. In the listed reading only (the practice map's API
    /// concern).
    pub const NO_RESPONSE_MODEL: &str = "no_response_model";
    /// The body turns a caller away as not signed in or not allowed, before it hands
    /// control on: it throws, raises or returns an error or response that says so
    /// (`code: "UNAUTHORIZED"`, `status.HTTP_401_UNAUTHORIZED`, `"Unauthorized: login
    /// required"`), or calls a status setter (`res.status(401)`, `abort(401)`) or a
    /// sign-in redirect. A 403 (`FORBIDDEN`) counts only in a body that also reads a
    /// user, session, auth, token or permission value; a rate limit (429, "Too many
    /// requests") never does. Nothing counts inside a `catch`/`except` handler or a
    /// promise callback, or after the body's first call of its continuation (`next()`,
    /// `call_next()`, the wrapped handler). Mining reads it to tell a guard from a
    /// wrapper that only opens a database session or logs ([`crate::facts::Symbol::controls`]).
    /// The literal itself is never recorded.
    pub const REJECTS_CALLER: &str = "rejects_caller";
    /// A function that files its first parameter in a registry and hands it back
    /// unchanged (`registry["filtersets"][label] = cls; return cls`): applied as a class
    /// decorator it registers the class at import and leaves the class as it was, so
    /// nothing of it runs when code constructs the class. A decorator that sets
    /// anything on the class, calls a method on it, passes it elsewhere or wraps it is
    /// no such function. Recorded by Python only.
    pub const REGISTERS_ARG: &str = "registers_arg";
    /// The body hands a value to a call the facts do not record: a method of a local,
    /// or of a parameter no annotation types (`exporter.run(user_id)`). What that call
    /// does with the value was not read, so nothing can be said of what the body leaves
    /// undone. A call given nothing, only literals, or a callback written in place
    /// (`rows.all()`, `d.get("k")`, `rows.map((r) => r.id)`) is not one. Mining never
    /// proposes it.
    pub const UNREAD_CALL: &str = "unread_call";
    /// What starts the control of a body that calls a method on a member of a
    /// parameter whose declared type gives that member a built-in value's type: an
    /// object type literal declaring it a string, a number, a boolean or an array
    /// (`params: { path: string[] }`, then `params.path.join("/")`):
    /// `builtin_value:<parameter>.<member>`. The method is the built-in's (`Array`'s
    /// `join`), no code of the repository. Recorded by TypeScript (lowering 72), in the
    /// listed reading only ([`crate::Listed`]); mining never reads it.
    pub const BUILTIN_VALUE: &str = "builtin_value:";
    /// A module-level name bound to nothing yet: `rule_book = None`, or `...`, to be
    /// set by code that runs later (`global rule_book` in an `init()`). What it
    /// holds when a method is called on it is not in its definition. Recorded by
    /// Python only. Mining never proposes it.
    pub const LATE_BOUND: &str = "late_bound";
    /// The body turns some requests away where the facts do not say on what: a `raise`
    /// or an error answer under a condition that could not be read (`if not ok:`, `ok`
    /// a comparison bound earlier; `if not any(...)`), one that follows a branch that
    /// returns (`if same: return rule` / `raise ...`), one in a loop, a `match` case or
    /// an `else`, or an `assert`. No [`BodyCheck`] or [`RaiseCheck`] says what the
    /// refusal is for, so a reader never takes the body for one that refuses no one.
    /// A method's is in [`Member::unread`]. Recorded by Python only. Mining never
    /// proposes it.
    pub const UNREAD_EXIT: &str = "unread_exit";
    /// The body compares or filters by a tenant or an owner key where no fact records
    /// it: a comparison outside the condition of an exit that refuses (a comprehension
    /// filter, `any(...)`, a value bound or returned, a branch that returns `None`), a
    /// path through a tenant of the caller (`caller.organization.rules`), SQL written
    /// as text that names such a key. Since Python lowering 53 also where the key
    /// has no such name and a side is the caller's: a comparison of a value read off
    /// the session or identity with another value (`s.depot_id !=
    /// request.user.depot_id` before a `continue`), and a path through what belongs
    /// to the caller (`request.user.depot.shipments.all()`,
    /// `g.user.venue.events`). It may be how the body scopes what it reads. A
    /// method's is in [`Member::unread`]. Recorded by Python, and by TypeScript for a
    /// comparison (lowering 48). Mining never proposes it.
    pub const SCOPE_UNREAD: &str = "scope_unread";
    /// The body does something with a value of one of its own parameters (not
    /// `self` or `cls`): it compares one with another value that is no literal,
    /// outside the condition of an exit that refuses, or hands one to a call
    /// (`row.venue_id != venue_id` before `return None`,
    /// `self.filter(depot_id=staff.depot_id)`). Whose value the parameter holds is
    /// known where the function is called: a reader that follows a call given a
    /// value of the caller ([`crate::facts::Symbol::caller_args`]) into a body with
    /// this fact has found what may scope the rows to the caller, and into a body
    /// without it has read a body that does nothing with the value. A method's is
    /// in [`crate::facts::Member::unread`]. Recorded by Python (lowering 53);
    /// TypeScript (lowering 66) writes a method's the same way and a function's as
    /// [`crate::facts::SymbolCalls::param_flows`]. Mining never proposes it.
    pub const PARAM_FLOWS: &str = "param_flows";
    /// The body answers "not signed in" (a 401, a sign-in redirect) in the `except`
    /// handler of a `try` it cannot pass otherwise: the `try` is a statement every
    /// request reaches (under no branch or loop, after no return that serves some
    /// requests, in no `try` whose handler goes on), before the body hands control
    /// on; its body neither hands control on nor returns under a branch; every one
    /// of its handlers ends by refusing (a `raise`, an error answer, `abort(...)`),
    /// and one of them says the caller is not signed in. Such a body is passed only
    /// by a request whose `try` raised nothing: `try: claims = jwt.decode(token)` /
    /// `except JWTError: raise HTTPException(status_code=401)`. [`REJECTS_CALLER`]
    /// counts nothing inside a handler, and stays as it was. Recorded by Python
    /// (lowering 53). Mining never proposes it, and reads no guard from it.
    pub const HANDLER_REJECTS: &str = "handler_rejects";
    /// The body answers "not signed in" in an `except` handler where
    /// [`HANDLER_REJECTS`] is not proven: the handler does so under a branch, another
    /// handler of the `try` goes on, the `try` is under a branch or follows a return
    /// that serves some requests, or its body returns under a branch. It may be the
    /// guard of the requests it runs for: never proof of one, and never read as a
    /// body that turns no one away. Not recorded for a `try` whose body hands control
    /// on (`try: return view(request)` / `except AuthError: return 401`): that
    /// handler maps what the view raised. Also where a handler answers "not allowed"
    /// (a 403) in a body that reads a user, session, auth, token or permission
    /// value: a 403 is weaker evidence of a sign-in guard, never proof of one here.
    /// Recorded by Python (lowering 53). Mining never proposes it.
    pub const HANDLER_MAY_REJECT: &str = "handler_may_reject";
    /// What starts the control of a function that turns its caller away only by a
    /// value it hands back: every exit of its own body that answers "not signed in"
    /// is a `return` of a response (`if (!session) return NextResponse.json({ error
    /// }, { status: 401 })`, `return new Response(null, { status: 401 })`, `return
    /// c.json({ error }, 401)`), and it neither throws, redirects nor sets the status
    /// on a response it was handed. The rest is the key the response is under: none
    /// for the response itself, `.error` for `return { error: NextResponse.json(...,
    /// { status: 401 }) }`. A call of such a function turns the caller of the
    /// calling function away only where that function returns what it was handed
    /// ([`RETURNS_RESULT_OF`]); where it is the handler, the hook or the middleware
    /// itself, the framework takes the response. Held in the listed reading only
    /// ([`crate::facts::Listed`]); TypeScript lowering 64. Mining never reads it.
    pub const RETURNS_REJECTION: &str = "returns_rejection:";
    /// What starts the control of an error class of the repository that answers a
    /// refusal by its own definition, with the status: `refusal_status:403` of
    /// `class Forbidden extends HttpError { constructor(m) { super(403, m) } }`,
    /// of `this.statusCode = 401` in its constructor, or of a `status = 403`
    /// property, where nothing in it says another status. Read from what the
    /// class is, never from what it is called ([`rejection_class_name`] is the
    /// by-name fallback where no definition is read). A throw of one in a branch
    /// that turns the caller away is a [`crate::facts::BodyCheck`] of that status.
    /// A class whose status is set by a base of another module carries none.
    /// Recorded by TypeScript (lowering 85), on classes, in the listed reading only
    /// ([`crate::facts::Listed`]); mining never reads it.
    pub const REFUSAL_STATUS: &str = "refusal_status:";
    /// What starts the control of a body that returns what a call handed back when
    /// there is something, for every request: `const denied = await
    /// requireSession(req); if (denied) return denied;` (the test also written
    /// `denied instanceof Response`, `denied != null`), `const { error } = await
    /// requireUser(req); if (error) return error;`, `if (auth.error) return
    /// auth.error;`. The rest is the key and the callee:
    /// `returns_result_of:@lib/auth.ts#requireSession`,
    /// `returns_result_of:.error@lib/auth.ts#requireUser`. Recorded for a callee
    /// with [`RETURNS_REJECTION`] only, in the listed reading only; TypeScript
    /// lowering 64. Mining never reads it.
    pub const RETURNS_RESULT_OF: &str = "returns_result_of:";
    /// What starts the control of a body that turns a caller away, or may, in a way
    /// the facts do not read: a branch on a value of the caller (a session read, a
    /// header, a signature or secret compare) whose exit hands back a response that
    /// is not read as a refusal. A refusal builder's call reaching a `return`
    /// through a local, a ternary or an `else` (`const r = unauthorized(); return
    /// r;`), a refusal on the fall-through of a branch that serves
    /// (`if (a === b) { return ok } return new Response(null, { status: 401 })`),
    /// a response whose status is a name (`{ status: UNAUTH }`, `fail(UNAUTH, ...)`),
    /// a constant-time compare in an `if` test nothing else reads. The rest is the
    /// canonical callee or value the condition reads, empty where it is not read:
    /// `exit_unread:pkg:next-auth#getServerSession`. The practice map and `drift
    /// security` read it as a guard that may be here and could not be read (unknown,
    /// "guard unknown"), where the value is the caller's and nothing else proves a
    /// guard; never as one. Held in the listed reading only; TypeScript lowering 74.
    /// Mining never reads it.
    pub const EXIT_UNREAD: &str = "exit_unread:";
    /// What starts the control of a body every call of which to the callee is a
    /// statement of its own (`await requireSession(req);`): what the callee hands
    /// back goes nowhere. Recorded for a callee with [`RETURNS_REJECTION`], in the
    /// listed reading only; TypeScript lowering 64. Since lowering 65 also for a
    /// callee that may answer on a response it was handed and throws nothing
    /// (`ensureUser(req, res);` where `ensureUser` sends the 401 itself): the caller
    /// goes on after the answer. Not for a call handed the continuation or a
    /// function written in place. Mining never reads it.
    pub const DROPS_RESULT_OF: &str = "drops_result_of:";
    /// What starts the control of a body that calls a webhook signature verifier
    /// that raises where the signature does not verify
    /// ([`crate::guard_lists::SIGNATURE_VERIFIERS`]) on every request that reaches
    /// it, outside any `try` whose handler goes on: what it raises leaves the body, or
    /// is answered with an error. The rest is the canonical callee
    /// (`verifies_signature:pkg:svix#webhooks.Webhook().verify`), a method of a local
    /// built from the package's class included. Python lowering 66. Mining never
    /// reads it.
    pub const VERIFIES_SIGNATURE: &str = "verifies_signature:";
    /// What starts the control of a NestJS decorator that sets route metadata: the
    /// function calls `SetMetadata(KEY, value)` with a value that is true of any
    /// route it is written on (`export const Public = () => SetMetadata(IS_PUBLIC,
    /// true)`), and the rest is the key: the canonical reference of the binding
    /// that holds it (`src/auth/public.ts#IS_PUBLIC`), or the text in double quotes
    /// (`"isPublic"`; a binding of the repository that holds a text is written as
    /// that text). `~` before the key where the value is not such a literal (`export
    /// const Roles = (...roles) => SetMetadata(ROLES_KEY, roles)`,
    /// `Reflector.createDecorator()`, whose key is the decorator itself), and
    /// `sets_metadata:?` where the key is not read. A guard class that lets through
    /// a route carrying the key ([`OPENS_FOR_METADATA`]) does not guard a route
    /// under the decorator. Held in the listed reading only
    /// ([`crate::facts::Listed`]); TypeScript lowering 64. Mining never reads it.
    pub const SETS_METADATA: &str = "sets_metadata:";
    /// What starts the control of a NestJS guard class whose `canActivate` lets a
    /// request through, before it checks anything, where the route carries a
    /// metadata key: `const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC,
    /// [context.getHandler(), context.getClass()]); if (isPublic) return true;`.
    /// The rest is where the key is read (`handler`, `class`, or `any` for both)
    /// and the key as [`SETS_METADATA`] writes it:
    /// `opens_for_metadata:any:src/auth/public.ts#IS_PUBLIC`. Held in the listed
    /// reading only; TypeScript lowering 64. Mining never reads it.
    pub const OPENS_FOR_METADATA: &str = "opens_for_metadata:";
    /// A NestJS guard class reads route metadata, or hands its execution context
    /// on, where [`OPENS_FOR_METADATA`] does not say what for: a read whose result
    /// is used in any other way than `if (<it>) return true` at the top of
    /// `canActivate`, a read in another method (`handleRequest`), the context
    /// given to a function of the repository. What a decorator on a route changes
    /// for this guard is not read. Held in the listed reading only; TypeScript
    /// lowering 64. Mining never reads it.
    pub const METADATA_UNREAD: &str = "metadata_unread";
    /// What starts the control of a NestJS guard class that reads one metadata key
    /// of the route and does with it what is not read (`request.allowed =
    /// this.reflector.get(OnlyAllow, context.getHandler())` in `getRequest`): where
    /// it is read and the key, as [`OPENS_FOR_METADATA`] writes them
    /// (`reads_metadata:handler:src/auth/only-allow.ts#OnlyAllow`). A decorator
    /// that sets this key may change what the guard does for the route; one that
    /// sets another key is nothing the guard reads. A read whose key or target is
    /// not read stays [`METADATA_UNREAD`]. Held in the listed reading only;
    /// TypeScript lowering 80. Mining never reads it.
    pub const READS_METADATA: &str = "reads_metadata:";
    /// The body turns a caller away as not signed in or not allowed, and not every
    /// request: on some path it returns without refusing (or hands control on, or
    /// yields) before it has passed a check that refuses a caller with no identity.
    /// `if not authorization: return None` before the 401 for a token that is not
    /// valid; a 401 under `if authorization:` only; `if token and not valid(token):`
    /// (a caller with no token is not refused); a return under a condition that says
    /// nothing of the caller (`if request.path.startswith("/public")`) before the
    /// refusal. Read per function, and recorded where no function of the symbol that
    /// refuses does so for every request. A check every request passes is an `if`
    /// whose branch always ends by refusing so (not an `and` with an operand that is
    /// no test of a credential's absence), a refusal written in an expression
    /// (`user or abort(401)`), or a `try` that is proof ([`HANDLER_REJECTS`]); a
    /// branch that returns is passed only by callers with an identity where its
    /// condition reads one (`if user: return user`) and every other request is
    /// refused after it. [`REJECTS_CALLER`] is recorded as it was: this fact says the
    /// refusal it records is no proof of a guard. A method's is in
    /// [`crate::facts::Member::unread`]. Recorded by Python (lowering 56). Mining
    /// never proposes it, and reads no guard from it.
    pub const REJECTS_SOME: &str = "rejects_some";
    /// The body never returns: every path through it ends by refusing, and one says
    /// the caller is not signed in or not allowed (`def deny(): raise
    /// HTTPException(status_code=401)`). Called under a condition it is that
    /// condition's refusal, as a `raise` written there; a guard called under a
    /// condition is the guard of some requests only. Recorded by Python (lowering
    /// 56). Mining never proposes it, and reads no guard from it.
    pub const REFUSES_ALL: &str = "refuses_all";
    /// A function or class decorated with Django's `user_passes_test(<test>)` (also
    /// through `method_decorator`), where the test is read: a `lambda u: ...` or a
    /// function of the same module that takes the user. The test is false for a
    /// caller who is not signed in (`lambda u: u.is_authenticated`, `u.is_staff`,
    /// an `and` with one): as [`crate::VERDICT_SIGNED_IN`]. Recorded by Python
    /// (lowering 57). Mining never proposes it.
    pub const PASSES_TEST_SIGNED_IN: &str = "passes_test:signed_in";
    /// The test is `True` whoever asks (`lambda u: True`): the decorator turns no one
    /// away. Recorded by Python (lowering 57). Mining never proposes it.
    pub const PASSES_TEST_TRUE: &str = "passes_test:true";
    /// A `user_passes_test` on the symbol has a test that is not read (a call, a
    /// name of another module, a body of another shape). Recorded by Python
    /// (lowering 57). Mining never proposes it.
    pub const PASSES_TEST_UNREAD: &str = "passes_test:unread";
    /// A `user_passes_test` on the symbol has a test that asks a role, a group, a
    /// permission or a staff flag of the caller ([`crate::ASKS_ROLE`]). Recorded
    /// by Python (lowering 61). Mining never proposes it.
    pub const TEST_ASKS_ROLE: &str = "test_asks:role";
    /// A `user_passes_test` on the symbol has a test that was read to the end and
    /// asks only for the sign-in and the account's state
    /// ([`crate::ASKS_STATUS`]). A test with neither this nor
    /// [`TEST_ASKS_ROLE`] is not read. Recorded by Python (lowering 61). Mining
    /// never proposes it.
    pub const TEST_ASKS_STATUS: &str = "test_asks:status";
    /// A `user_passes_test` on the symbol has a test whose question of a signed-in
    /// caller was not read (neither [`TEST_ASKS_ROLE`] nor
    /// [`TEST_ASKS_STATUS`]). Recorded by Python (lowering 61). Mining never
    /// proposes it.
    pub const TEST_ASKS_UNREAD: &str = "test_asks:unread";
    /// A function whose own body returns a value of the caller by the closed list of
    /// sources a name or an accessor gives (`return get_jwt()["venue_id"]`, `return
    /// g.user.tenant_id`, a local bound to one), in every `return` that gives a
    /// value. Called with nothing, or with the request only, what it hands back is
    /// the caller's ([`crate::facts::Symbol::caller_args`], `via`). Recorded by
    /// Python (lowering 58), and by TypeScript (lowering 66) in the listed reading
    /// only. Mining never proposes it.
    pub const RETURNS_CALLER: &str = "returns_caller";
    /// What starts the control that says a risky operation of the body
    /// ([`crate::Symbol::sinks`]) is given a value read off a parameter of the
    /// function the body is of: `sink_fed:<kind>`. Of an entry point's handler, a
    /// parameter is what the request sent; of any other function, what its caller
    /// passed. The value is followed through the body as a value of the caller is:
    /// members and items, locals in the order written, templates, objects and arrays
    /// that hold it. An operation with no such control was given nothing of a
    /// parameter that the lowering read. TypeScript lowering 76 (listed reading),
    /// Python lowering 69. Mining never proposes it.
    pub const SINK_FED: &str = "sink_fed:";
    /// What starts the control that says the body hands a callee a value read off a
    /// parameter of its own function: `passes_param:<callee>`, canonical. With
    /// [`SINK_FED`] it says whether what an entry point was sent reaches an
    /// operation some calls away: each call on the way hands on a value read off a
    /// parameter. TypeScript lowering 76 (listed reading), Python lowering 69. On a
    /// Python method the same strings are in [`crate::facts::Member::unread`].
    /// Mining never proposes it.
    pub const PASSES_PARAM: &str = "passes_param:";
    /// As [`SINK_FED`] and [`PASSES_PARAM`], of a parameter of the function the body
    /// hands back (`export function login() { return (req, res) => { ... } }`):
    /// `sink_fed_made:<kind>`, `passes_made:<callee>`. What the function made is
    /// called with is its input: where an entry point names the maker as its handler,
    /// what the request sent. TypeScript lowering 76 (listed reading).
    pub const SINK_FED_MADE: &str = "sink_fed_made:";
    pub const PASSES_MADE: &str = "passes_made:";
    /// [`SINK_FED`] by position: `sink_fed_at:<kind>\t<position>`, the position
    /// among the function's parameters that the operation's operand (the value it
    /// judges: the first argument that is no number, the key written) is read off:
    /// `#0` for the first, `*` where which one is not read, `-` where the operand
    /// is given nothing of a parameter though another argument is. A kind with no
    /// such control is read as [`SINK_FED`] says. TypeScript lowering (listed
    /// reading). Mining never proposes it.
    pub const SINK_FED_AT: &str = "sink_fed_at:";
    /// [`PASSES_PARAM`] by argument: `passes_at:<callee>\t<argument>\t<position>`,
    /// canonical: the call hands the callee, at the argument's position (`#1`; `*`
    /// at or after a spread), a value read off the parameter at the position
    /// (`#0`, `*`). With [`SINK_FED_AT`] a reader follows what an entry point was
    /// sent through the parameter that carries it: a parameter the caller does
    /// not pass (one with a default) carries nothing. A callee with no such
    /// control is read as [`PASSES_PARAM`] says. TypeScript lowering (listed
    /// reading). Mining never proposes it.
    pub const PASSES_AT: &str = "passes_at:";
    /// [`PASSES_MADE`] by argument: `passes_made_at:<callee>\t<argument>`, the
    /// positions of the arguments read off a parameter of the function the body
    /// hands back. TypeScript lowering (listed reading). Mining never proposes it.
    pub const PASSES_MADE_AT: &str = "passes_made_at:";
    /// What starts the control that says what held where a wrapper hands a request
    /// on: one control for each call, in a function defined in another, of what the
    /// outer function was given (`return view_func(request, *args, **kwargs)` in a
    /// decorator's wrapper), with the callees, canonical and tab-separated, whose
    /// call's value was true on every path to it: the test of an `if` the call is
    /// under, the test of an `if` that left the function where it did not hold (`if
    /// not q.exists(): return Response(status=403)`), a local bound to one, the
    /// operands of an `and`, what `is not None` is said of. Nothing after the
    /// prefix where nothing held. What a callee is (a lookup of the caller, say) is
    /// read where its arguments are ([`ARG_VALUE`]). Recorded by Python (lowering
    /// 69) where some site has something that held; on a method the same strings
    /// are in [`crate::facts::Member::unread`]. Mining never proposes it.
    pub const HANDED_AFTER: &str = "handed_after:";
    /// A function whose every branch that returns early without refusing does so
    /// for the requests it finds to be about the caller's own record: the test of
    /// the branch is `==` or `is` between the caller itself, or the key of the
    /// caller's record, and something else (`if user == current_user: return
    /// user`). A check that follows ([`crate::not_always::AFTER_CONDITIONAL_RETURN`])
    /// is asked of every other request: the body serves the caller's own record, or
    /// what passes the check. Recorded by Python (lowering 69). Mining never
    /// proposes it.
    pub const RETURNS_EARLY_FOR_OWN: &str = "returns_early_for_own";
    /// What starts the control that says which rows a statement of the body reads
    /// and by what: `rows:<model>`, canonical, then tab-separated `own`, the key and
    /// the side ([`OWN_SIDE`]) where the statement filters them by the caller
    /// itself or the key of the caller's record (`select(Item).where(Item.owner_id
    /// == current_user.id)`, `Seat.objects.filter(holder=request.user)`); `from`
    /// and the callees or values a filter of it reads its value off
    /// (`Comment.objects.filter(doc=doc)`); or `any` for anything else (`select(
    /// Item)`, `session.get(Item, item_id)`). A model is what a statement names
    /// where rows are read: the class a query method is called on, or a class handed
    /// to a call. A filter under an `or` or a negation narrows nothing and is not
    /// read. Recorded by Python (lowering 69); on a method the same strings are in
    /// [`crate::facts::Member::unread`]. Mining never proposes it.
    pub const ROWS: &str = "rows:";
    /// What ends an `own` entry of [`ROWS`] whose statement also filters by a value
    /// read off a parameter or off what the request sent: the caller is looked up
    /// in what the request names.
    pub const ROWS_ASKED: &str = "asked";
    /// What ends the callee of a site ([`HANDED_AFTER`]) that is such a lookup
    /// written on a value the facts give no name (`db.query(Seat).filter_by(
    /// holder_id=user.id, space=space).first()` on a session a dependency gives):
    /// the model, then this.
    pub const LOOKUP_OF: &str = "()lookup";
    /// A function whose every `return` that gives a value gives what a call or a
    /// lookup made of a credential the request carries: its `Cookie` or
    /// `Authorization` header, or the cookies a framework parsed
    /// (`store.getSession(request.headers.get("cookie"))`, then the row a session
    /// id finds, then `session.userId`). What it hands back is who the credential
    /// says, or nothing. Recorded by TypeScript (lowering 76, the listed reading).
    pub const RETURNS_CREDENTIAL: &str = "returns_credential";
    /// A function of the repository whose every `return` that gives a value gives
    /// a value of the caller, read from what its body does and never from what it
    /// is called: by its own sources ([`RETURNS_CALLER`]), what was made of a
    /// credential the request carries ([`RETURNS_CREDENTIAL`]), or what a function
    /// that is one hands back where the body calls it with nothing or with the
    /// request (`requireSeat(request)` returning what `seatOf(request)` gave), a
    /// few calls deep. What a call of it hands back is the caller's, wherever the
    /// value goes: a side `call <it>` is written `caller`. Linked by TypeScript
    /// (lowering 81) into the listed reading only. Mining never proposes it.
    pub const GIVES_CALLER: &str = "gives_caller";
    /// `returns_built:<class>`: every `return` of the function that gives a value
    /// gives an instance of the class, built in the body (`() => { const client =
    /// new PrismaClient(); ...; return client }`). Where the function is bound to
    /// what a call it was handed to gave back (`export const prisma =
    /// remember("prisma", () => ...)`), a call through a member of the binding
    /// (`prisma.user.findMany`) is a call on what the function built: a function
    /// has no such member. Linked by TypeScript (lowering 81) into the listed
    /// reading only. Mining never proposes it.
    pub const RETURNS_BUILT: &str = "returns_built:";
    /// Every value the function hands back is plain data: built from literals and
    /// built-ins only, or read off a local or a binding of the file that holds
    /// such a value (`function previous() { return solves[solves.length - 1] }` of
    /// `const solves = [...]`). A method called on what it handed back is a
    /// built-in's. Listed reading only; TypeScript lowering 79.
    pub const RETURNS_DATA: &str = "returns_data";
    /// A function whose every `return` that gives a value gives a credential the
    /// request carries, a part of one, or what a method of one made, and nothing
    /// else (`return req.cookies.session`, `const parts =
    /// headers.authorization.split(" "); return parts[1]`): a request that carries
    /// no credential is handed nothing. Listed reading only; TypeScript lowering 79.
    pub const RETURNS_SENT_CREDENTIAL: &str = "returns_sent_credential";
    /// What starts the control of a body every call of which to a verifying callee
    /// stands in a branch taken only where what another call handed back is there
    /// (`const token = tokenOf(req); if (token) { jwt.verify(token, key) }`): the
    /// verifying callee, a tab, the callee whose value the branch is by, both
    /// canonical. Where that callee hands back a credential the request carries or
    /// nothing ([`RETURNS_SENT_CREDENTIAL`]), a request that carries none runs
    /// past the verifying call, as [`super::SymbolCalls::given_credential`] says of
    /// a credential read in the body itself. Listed reading only; TypeScript
    /// lowering 79.
    pub const GIVEN_RESULT_OF: &str = "given_result_of:";
    /// What starts the control of a body every call of which to a function of the
    /// repository is a statement of its own that nothing waits for
    /// (`void audit(req);`, `notifyAll(order);`): where the callee is asynchronous
    /// ([`super::Symbol::is_async`]), what it throws rejects a promise nobody
    /// holds, and stops nothing in the body. Listed reading only; TypeScript
    /// lowering 79.
    pub const UNAWAITED: &str = "unawaited:";
    /// Every `throw` of the body stands in a function written as the argument of
    /// a promise's own method (`then`, `catch`, `finally`) on a chain that is a
    /// statement nothing waits for (`Feedback.count().then(tally).catch(() => {
    /// throw new Error("unavailable") })`): each rejects the promise the method
    /// made, which nobody holds, and stops nothing in the body. The `throw`
    /// control and [`super::Symbol::throws`] stay as the measured build wrote
    /// them. Listed reading only; TypeScript lowering 79.
    pub const THROWS_LOST: &str = "throws_lost";
    /// The body calls its continuation with nothing somewhere (`next()`; not
    /// `next(error)`, which hands an error to what answers for it): it is written
    /// to stand before what serves the request, wherever it is given. A function a route is given last that does so (`app.post("/cards",
    /// appendUserId())`, with the routes that serve registered after it) is read as
    /// what stands at a guard position is, not as the handler that answers. Listed
    /// reading only; TypeScript lowering 79.
    pub const CONTINUES: &str = "continues";
    /// What starts the control of a body that throws for every request for which
    /// what a callee handed back is absent (`const userId = await
    /// getUserId(request); if (!userId) throw redirect(target)`): one for each such
    /// test, with the callees that may have given the value, canonical and
    /// tab-separated. The body turns away every request with no caller where each
    /// of them gives the caller or nothing ([`RETURNS_CREDENTIAL`],
    /// [`RETURNS_CALLER`], a library's session read); what is thrown is not asked.
    /// Recorded by TypeScript (lowering 76, the listed reading).
    pub const REFUSES_WITHOUT: &str = "refuses_without:";
    /// What starts a side of [`ARG_VALUE`] that is the caller itself or the key of
    /// the caller's record (`request.user`, `request.user.id`), before the side it
    /// is (`own caller`, `own gives <dependency>`): not something read off the
    /// caller (`request.user.org_id` is `caller`). Recorded by Python (lowering
    /// 69).
    pub const OWN_SIDE: &str = "own ";
    /// As [`HANDED_AFTER`], of where the symbol's own function lets a request
    /// through: each `return` that does not refuse and the end of its body, in a
    /// function that refuses somewhere.
    pub const LEAVES_AFTER: &str = "leaves_after:";
    /// As [`HANDED_AFTER`], of where the symbol's own function may answer true:
    /// each `return` that gives anything but `False` or nothing, with what its
    /// value says held too (`return a and q.exists()`), in a function that answers
    /// `False` somewhere.
    pub const TRUE_AFTER: &str = "true_after:";
    /// What starts the control of a function whose every `return` that gives a
    /// value gives one read off what a dependency gave it, each dependency its own
    /// entry (`returns_given:<dependency>`, canonical): `def get_current_user(db:
    /// SessionDep, token: TokenDep): ... return db.get(User, claims.sub)`, where
    /// the claims are what the verification of `token` handed back. The value is
    /// one of the caller where every such dependency gives one (it signs the
    /// caller in), which a reader decides. Read off a dependency's value: its
    /// members and items, what a token verifier hands back of it (`jwt.decode`),
    /// an object built from it alone (`Claims(**payload)`), and the row a primary
    /// key read off it names (`db.get(User, sub)`, `User.objects.get(pk=sub)`).
    /// Recorded by Python (lowering 69). Mining never proposes it.
    pub const RETURNS_GIVEN: &str = "returns_given:";
    /// A function whose own body returns what the request sent in every `return`
    /// that gives a value: a header, a query, path, body or cookie value, a
    /// parameter that is not a dependency (`def team(x_team_id: str = Header(...)):
    /// return x_team_id`, `return request.headers["x-team"]`). What it hands back is
    /// the request's wherever it is used, also where the function turns callers
    /// away. Recorded by Python (lowering 62). Mining never proposes it.
    pub const RETURNS_REQUEST: &str = "returns_request";
    /// A FastAPI dependency that code of the repository outside its tests replaces
    /// (`app.dependency_overrides[get_user] = ...`, under a condition or not): the
    /// function that runs where a route depends on it is not this one. Read by
    /// `drift security` and the practice map as a guard position that is not read.
    /// Recorded by Python (lowering 63). Mining never proposes it.
    pub const OVERRIDDEN: &str = "overridden";
    /// A `return` of the function, or of a function it defines, hands back one of its
    /// own parameters unchanged, and another hands back something else: as a
    /// decorator it leaves the view as it is on some path and not on another
    /// (`if settings.DEBUG: return view` before `return login_required(view)`).
    /// Read by `drift security` and the practice map: what runs in the view's place
    /// is decided where the decorator is applied, which is not read. Recorded by
    /// Python (lowering 63). Mining never proposes it.
    pub const HANDS_BACK_PARAM: &str = "hands_back_param";
    /// The body writes a value that is no literal on an object of its module, one it
    /// does not create for the call (`current_org.set(org_id)` on a `ContextVar`,
    /// `_local.tenant_id = tenant_id` on a `threading.local()`, `CURRENT[k] = v`,
    /// `setattr(_local, ...)`): a value kept past the call, which code the route
    /// does not call may read (a repository, an ORM event, a manager). Read by the
    /// practice map: a unit whose reach writes one is never without authorization.
    /// Recorded by Python (lowering 63). Mining never proposes it.
    pub const KEEPS_VALUE: &str = "keeps_value";
    /// What starts the control that says where the two sides of a comparison come
    /// from, for a comparison a check of the body records ([`crate::BodyCheck`],
    /// [`crate::RaiseCheck`]): the check's `source`, `reads` and `compares` as the
    /// check writes them (a comparison with a value that was not read has an empty
    /// `compares`), then the side read and the side it is compared with, tab
    /// separated: `sides:<source>\t<reads>\t<compares>\t<left>\t<right>`. A side is
    /// one of:
    ///
    /// - `caller`: a value of the caller by the closed list of sources of the
    ///   lowering (a name that says a subject, a request-scoped holder, a claims
    ///   accessor);
    /// - `via <dependency>`: what a declared dependency gives, canonical, and `call
    ///   via <dependency>` what a method called on it hands back; `gives
    ///   <callee>`: what a function called with nothing or with the request, or an
    ///   attribute of a request-scoped holder, gives. A reader says whether that is
    ///   the caller's (it signs the caller in, it returns a value of the caller)
    ///   or the request's ([`RETURNS_REQUEST`]);
    /// - `request`: a header, a query, body, form or cookie value read off the
    ///   request, the URL arguments of a view;
    /// - `param <name>` or `param <name> #<position>`: a parameter of the
    ///   function, or what is read off one, whatever it is called (`user.org_id` of
    ///   `def check(user, doc)`): the request's in a handler, whatever its caller
    ///   passed anywhere else ([`ARG_VALUE`]); the position is among the positional
    ///   parameters, a first `self` or `cls` left out;
    /// - `self.<attribute>`: read off an attribute of `self`;
    /// - `setting`: an environment read or a name bound to one; `literal`;
    /// - `call <callee>`: what a call handed back, canonical; `value <name>`: a
    ///   module-level name that is no call (a constant, a settings object);
    /// - `unread`: anything else.
    ///
    /// On a method the same strings are in [`crate::facts::Member::unread`].
    /// Recorded by Python (lowering 62). Mining never proposes it.
    pub const SIDES: &str = "sides:";
    /// `called_leaving:<callee>`: every call of the callee the body makes is
    /// written in what a `throw` outside any `try` throws (`throw redirect("/", {
    /// headers: { "set-cookie": await sessions.destroySession(session) } })`): no
    /// request the call ran for goes on to what the body does next, so what the
    /// call changed is not changed before a check that follows. TypeScript
    /// lowering 81; mining never proposes it.
    pub const CALLED_LEAVING: &str = "called_leaving:";
    /// `caller_from:<callee>`: the body takes what a call of the callee hands back
    /// as who calls (`const userId = await requireUserId(request)`): what the
    /// callee and the code it calls read to find that out is how the caller is
    /// identified, not a scope of the rows the route reads. TypeScript lowering
    /// 81; mining never proposes it.
    pub const CALLER_FROM: &str = "caller_from:";
    /// `filter_own:<callee>\t<key>`: every call of the callee the body makes that
    /// gives the key gives it the caller itself or the key of the caller's record
    /// (what a call that gives the caller handed back, whole; `session.user.id`),
    /// and nothing else read off the caller (`session.user.orgId` is a group of
    /// the caller): rows narrowed to it are this caller's, whatever the key is
    /// called. TypeScript lowering 81; mining never proposes it.
    pub const FILTER_OWN: &str = "filter_own:";
    /// `filter_every:<callee>\t<key>\t<own|caller>`: every call of the callee the
    /// body makes, on whatever path, gives the key a value of the caller (`own`
    /// where each gives the caller itself, [`FILTER_OWN`]), in an object written
    /// in place with no spread and no computed key at its level (`if (intent ===
    /// "delete") await db.passkey.delete({ where: { id, userId } })`). A filter
    /// that is itself under a condition (`where: flag ? undefined : { ... }`) is
    /// not one. TypeScript lowering 81; mining never proposes it.
    pub const FILTER_EVERY: &str = "filter_every:";
    /// Python: an attribute of what a call handed back is written after the call,
    /// by a value that is not the caller itself (`item = Item(owner_id=
    /// current_user.id); item.owner_id = body.owner_id`): `<callee>\t<attribute>`.
    /// What the call was given for that attribute is no longer what the row holds.
    pub const ROW_SET: &str = "row_set:";
    /// Python: a call of a package's code that is handed something, with what
    /// each argument is, written as [`ARG_VALUE`] is (which holds the calls of
    /// the repository's own code only): `session.add(current_user)` on a session
    /// a parameter types as the package's. A call handed nothing is not recorded.
    pub const PKG_ARG_VALUE: &str = "pkg_arg_value:";
    /// What starts the control of a body that leaves by a refusal (a `throw`, an
    /// answer that turns the caller away) for every request for which what one
    /// call of it handed back is absent (`const user = await db.user.findFirst({
    /// where: { id: userId, roles: { some: { name } } } }); if (!user) throw
    /// forbidden()`): the callee, canonical. What the call was given says what the
    /// request must have for it to hand anything back
    /// ([`ARG_VALUE`]). On a method the same strings are in
    /// [`crate::facts::Member::unread`]. Recorded by TypeScript (lowering 81, the
    /// listed reading). Mining never proposes it.
    pub const REFUSES_ABSENT: &str = "refuses_absent:";
    /// What starts the control that says where the value a scoped query filters by
    /// comes from ([`crate::ScopedQuery`]): `filter_value:<callee>\t<key>\t<side>`,
    /// the side as [`SIDES`] writes one. Recorded by Python (lowering 62). Mining
    /// never proposes it.
    pub const FILTER_VALUE: &str = "filter_value:";
    /// What starts the control that says what a call of the body is given, for
    /// each call of the repository's own code, also one given nothing:
    /// `arg_value:<callee>`, then for each argument a tab, the argument by its
    /// keyword or as `#<position>` (`*` for an unpacking), a tab and the side as
    /// [`SIDES`] writes one; the callee canonical. `ProjectService(repository=repo,
    /// principal=principal)` in a dependency whose `principal` is what
    /// `Depends(resolve_principal)` gives records `arg_value:<...>#ProjectService\t
    /// repository\tparam repo #0\tprincipal\tvia <...>#resolve_principal`. On a
    /// method the same strings are in [`crate::facts::Member::unread`]. Recorded by
    /// Python (lowering 62). Mining never proposes it.
    ///
    /// TypeScript (lowering 78) writes the argument as `#<position>`, and the
    /// values of an object written in place by the path of their keys
    /// (`#0.where.userId`; an item of a list by its position, `#0.where.OR.1
    /// .teamId.in`), to six objects deep. It records a call whose callee has no
    /// canonical name by the name it is written under (`param:ctx.prisma.user
    /// .findUnique`, `local:this.db.note.findMany`, `local:tx.note.update`), a
    /// package's call where it is handed an object, and `arg_value:*` where a body
    /// makes more calls than are recorded. Its sides: `caller`, `param <name>
    /// #<position>`, `literal`, `call <callee>` (a value read off what a call of
    /// the body handed back), `unread`.
    ///
    /// TypeScript (lowering 82) records a call of one of the body's own
    /// parameters, given by position, under [`PARAM_CALLED`] and the parameter's
    /// name, with no member
    /// (`arg_value:param:handler\t#0\tunread\t#1\tunread\t#2\tcaller` of
    /// `handler(req, res, user)` in `withUser(handler)`): what a wrapper hands the
    /// function it was given.
    pub const ARG_VALUE: &str = "arg_value:";
    /// What the callee of an [`ARG_VALUE`] starts with where the body calls a
    /// parameter, or a method of what one holds.
    pub const PARAM_CALLED: &str = "param:";
    /// What starts the control of a body that binds, on the request or what
    /// holds it, a key named for the caller to what the request sent:
    /// `holds_sent:<key>` (`req.user = req.body.user`, `req.user = { id:
    /// req.headers["x-user-id"] }`, `req.user = req.user || req.query.as`).
    /// What a later body reads under that key is what the request chose, not
    /// who calls. TypeScript lowering 83, the listed reading only; mining never
    /// proposes it.
    pub const HOLDS_SENT: &str = "holds_sent:";
    /// What starts the control of a body that reads, off the request or what
    /// holds it, a key named for the caller as who calls: `reads_held:<key>`
    /// (`req.user.id`). Beside a body around the same unit that binds the key
    /// to what the request sent ([`HOLDS_SENT`]), nothing the body does with
    /// the caller's value is proven. TypeScript lowering 83, the listed reading
    /// only; mining never proposes it.
    pub const READS_HELD: &str = "reads_held:";
    /// What starts the control of a body that takes a field out of what a call
    /// handed back before it answers: `withholds:<callee>\t<field>`, the callee
    /// canonical. The call is told to leave it out (`omit: { passwordHash: true
    /// }`), the field is taken apart from the rest and never read (`const {
    /// passwordHash, ...safe } = user`), or it is deleted or blanked (`delete
    /// user.passwordHash`, `{ ...user, passwordHash: undefined }`). Where the
    /// value is one the function was handed, the callee is `param #<position>`
    /// (`function toPublic(user) { const { passwordHash, ...rest } = user }`),
    /// and the calls of the function say which rows those are
    /// ([`ARG_VALUE`]). No field is withheld by its name. TypeScript lowering
    /// 84; mining never proposes it.
    pub const WITHHOLDS: &str = "withholds:";
    /// What starts the control of a body that hands a response the whole of what
    /// a call handed back: `sends_whole:<callee>` (`res.json(user)`,
    /// `NextResponse.json({ user })`). A call that chooses its fields (`select`)
    /// hands back no whole. TypeScript lowering 84; mining never proposes it.
    pub const SENDS_WHOLE: &str = "sends_whole:";
    /// As [`SENDS_WHOLE`], for what the body returns: `returns_whole:<callee>`
    /// (`return user`, `return db.user.findMany()`). Whether what a function
    /// returns is sent back is for the reader to say (an entry point's is).
    /// TypeScript lowering 84; mining never proposes it.
    pub const RETURNS_WHOLE: &str = "returns_whole:";
    /// What starts the control of a body that hands a call what the request sent
    /// and, in another argument (or another property of an object written in
    /// place, or what a function written in place hands back), a value read off a
    /// binding: `parses_input:<callee>\t<binding>`, both canonical
    /// (`parseWithZod(formData, { schema: LoginSchema })` records the package's
    /// function and `LoginSchema`). Whether the binding is a schema, and so
    /// whether the call checks the request against it, is for the reader to say
    /// from what the binding is built with; no name of the callee is asked.
    /// TypeScript lowering, the listed reading only; mining never proposes it.
    pub const PARSES_INPUT: &str = "parses_input:";
    /// What starts the control of a handler a parameter of which is bound to
    /// request input by a parameter decorator that is also handed a pipe
    /// (`@Param("id", ParseIntPipe) id: number`, `@Body(new ValidationPipe())`):
    /// `pipes_input:<pipe>`, canonical. The framework runs the pipe on the value
    /// before the handler. TypeScript lowering, the listed reading only; mining
    /// never proposes it.
    pub const PIPES_INPUT: &str = "pipes_input:";
    /// What starts the control of a class that says which parameter of `__init__` an
    /// attribute of `self` is bound from, by a statement of the constructor's own
    /// body (`self.principal = principal`):
    /// `attr_param:<attribute>\t<parameter>\t<position>`, the position counted
    /// without `self`. Recorded by Python (lowering 62). Mining never proposes it.
    pub const ATTR_PARAM: &str = "attr_param:";
    /// The control of a dataclass whose generated constructor is not read (it has a
    /// base, an option or a field that changes the constructor's parameters, or a
    /// method that binds a field again): no attribute is known to be bound from a
    /// parameter, and the classes it derives from say nothing of its constructor.
    /// Starts with [`ATTR_PARAM`], so what leaves that out leaves this out. Recorded
    /// by Python (lowering 65). Mining never proposes it.
    pub const ATTR_PARAM_UNREAD: &str = "attr_param:?";
    /// What starts the control that says how a thing at one of the symbol's guard
    /// positions is written (a decorator, a FastAPI dependency of the symbol, of its
    /// router or of a mount): the canonical callee, then the arguments in
    /// parentheses. An argument is `True`, `False`, `None`, `lit` (any other
    /// literal, a display of literals included) or `?` (anything else); a keyword
    /// argument is `name=<argument>`; `*` and `**` are an unpacking.
    /// `shape:pkg:flask_jwt_extended#jwt_required(optional=True)` for
    /// `@jwt_required(optional=True)`, `shape:pkg:fastapi#security.HTTPBearer()` on
    /// what depends on `bearer = HTTPBearer()`,
    /// `shape:app/auth.py#require_role(lit)` for `Depends(require_role("admin"))`.
    /// A callee with no parentheses is the thing written bare, recorded only beside
    /// a called shape of the same callee on the symbol. `=` before the callee says
    /// what the value of a module-level name is: the call it is bound to
    /// (`shape:=pkg:fastapi#security.HTTPBearer(auto_error=False)` on `bearer`) or
    /// the name it is another name for (`shape:=app/auth.py#login_needed`); a name
    /// bound more than once has `shape:=` alone beside them, and a reader takes
    /// none. A call in a body is recorded for the library functions whose
    /// arguments decide (`verify_jwt_in_request(optional=True)`). A reader takes a library's
    /// guard for one only in the shapes a closed list knows
    /// (`drift_mine::py_guards`). Recorded by Python (lowering 60). Mining never
    /// proposes it, and reads nothing from it.
    pub const SHAPE: &str = "shape:";
    /// A function has a `return` that hands back something the facts do not name:
    /// not a function, a class or an instance by a module-level name, not `None` or
    /// a literal (`return GUARDS[mode]`, `return guard if strict else lenient`, a
    /// local that is no nested `def`). Called where a guard goes
    /// (`Depends(pick_guard())`, `@pick()`), what it hands back is not read.
    /// Recorded by Python (lowering 60). Mining never proposes it.
    pub const RETURNS_UNREAD: &str = "returns_unread";
    /// A function defined in the body (what a factory or a decorator hands back)
    /// turns callers away only by a response it returns, where the body itself
    /// does not ([`RETURNS_REJECTION`] says that of the body's own returns, in
    /// Python too since lowering 60). Handed to FastAPI as a dependency
    /// (`Depends(require("admin"))`), what such a function returns is dropped:
    /// it refuses no one. Recorded by Python (lowering 60). Mining never
    /// proposes it.
    pub const RETURNS_REFUSING: &str = "returns_refusing";
    /// Every request the body lets through has passed a refusal of a caller with no
    /// identity, as [`REJECTS_SOME`] reads paths, where a refusal is also a call of a
    /// function of the same module that never returns (`if user is None: deny()`).
    /// A reader takes a call of such a function under a branch for the body's
    /// refusal only where the body has this. Recorded by Python (lowering 60).
    /// Mining never proposes it.
    pub const REFUSES_EVERY: &str = "refuses_every";
    /// Every refusal of the symbol is in a function defined in its body that the
    /// body does not hand back, while it hands back another that refuses no one
    /// (`def strict(...): raise ...` beside `return lenient`). The refusals prove
    /// nothing of what the function returns. Recorded by Python (lowering 60).
    /// Mining never proposes it.
    pub const REFUSAL_NOT_RETURNED: &str = "refusal_not_returned";
    /// The body calls something that is no name and no method of a name: what a
    /// lookup, a call or a conditional expression gives (`HOOKS[kind]()`,
    /// `(strict if flag else lenient)()`). What runs is not in
    /// [`crate::facts::Symbol::calls`]: a reader that asks whether the body may turn a
    /// caller away answers that it is not read. Recorded by Python (lowering 60).
    /// Mining never proposes it.
    pub const CALLS_UNNAMED: &str = "calls_unnamed";
    /// The body configures a filter a data library adds to the queries it runs,
    /// below any one query: Prisma `$extends`/`$use`, MikroORM `setFilterParams`,
    /// `addFilter` and `@Filter`, Kysely `withPlugin`, Mongoose query middleware
    /// (`pre`/`post` named by a query, on any receiver) and plugins, Sequelize
    /// scopes and find hooks, TypeORM `@EventSubscriber`; and, since TypeScript
    /// lowering 71, any object written in a file that imports a data library that
    /// takes such a key (`filters`, `plugins`, `hooks`, `subscribers`, ...:
    /// MikroORM `defineConfig({ filters })`, Kysely `new Kysely({ plugins })`).
    /// A route whose queries carry no filter of their own may be scoped by it:
    /// authorization is never `none` while one is in the repository. Held in the
    /// listed reading only; TypeScript lowering 70. Mining never reads it.
    pub const ORM_FILTER: &str = "orm_filter";

    /// What a rejection says ([`REJECTS_CALLER`]).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum Rejection {
        /// Not signed in: 401, `UNAUTHORIZED`, "Not authenticated".
        Unauthenticated,
        /// Not allowed: 403, `FORBIDDEN`, "Permission denied". Weaker evidence of a
        /// guard: rate limiters and feature switches send it too.
        Forbidden,
        /// Too many requests (429, "rate limit", "quota"): no access control at all.
        Throttled,
    }

    impl Rejection {
        /// Of two rejections an expression carries, the one it says: a rate limit wins
        /// (a "403 Too many requests" is a rate limit), then not signed in.
        pub fn combine(a: Option<Self>, b: Option<Self>) -> Option<Self> {
            match (a, b) {
                (Some(Self::Throttled), _) | (_, Some(Self::Throttled)) => Some(Self::Throttled),
                (Some(x), Some(y)) => Some(x.min(y)),
                (x, None) | (None, x) => x,
            }
        }
    }

    /// The rejection a status code says: 401, 403, or 429.
    pub fn rejection_status(code: u64) -> Option<Rejection> {
        match code {
            401 => Some(Rejection::Unauthenticated),
            403 => Some(Rejection::Forbidden),
            429 => Some(Rejection::Throttled),
            _ => None,
        }
    }

    /// The rejection a text says: `UNAUTHORIZED`, `Not authenticated`, `Unauthorized:
    /// Login required.` (a message that opens with it), `forbidden`, `Permission denied`;
    /// a rate limit anywhere in it ("Too many requests", "rate limit exceeded", "quota",
    /// "throttled").
    pub fn rejection_text(s: &str) -> Option<Rejection> {
        const UNAUTHENTICATED: &[&str] = &[
            "unauthorized",
            "unauthorised",
            "unauthenticated",
            "not authenticated",
            "not logged in",
            "not signed in",
            "login required",
            "authentication required",
        ];
        const FORBIDDEN: &[&str] = &[
            "forbidden",
            "not authorized",
            "not authorised",
            "permission denied",
            "access denied",
        ];
        let s = s.trim().to_ascii_lowercase().replace(['_', '-'], " ");
        let words: Vec<&str> = s
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        let throttled = s.contains("too many")
            || words.iter().any(|w| {
                matches!(
                    *w,
                    "rate"
                        | "ratelimit"
                        | "ratelimited"
                        | "limit"
                        | "limited"
                        | "limits"
                        | "throttle"
                        | "throttled"
                        | "throttling"
                        | "quota"
                        | "429"
                )
            });
        if throttled {
            Some(Rejection::Throttled)
        } else if s == "401" || UNAUTHENTICATED.iter().any(|o| s.starts_with(o)) {
            Some(Rejection::Unauthenticated)
        } else if s == "403" || FORBIDDEN.iter().any(|o| s.starts_with(o)) {
            Some(Rejection::Forbidden)
        } else {
            None
        }
    }

    /// An error class named for turning a caller away, by its own name
    /// (`UnauthorizedError`, `AuthenticationFailed`, `PermissionDenied`,
    /// `NotAuthenticated`): what a reader of [`crate::facts::Symbol::throws`] takes
    /// as a refusal of the caller, asked where the class is raised
    /// ([`REJECTS_SOME`]).
    ///
    /// By name: a fallback only. What an error is, is said by its own definition,
    /// the status it sets or passes to its base ([`REFUSAL_STATUS`], read by the
    /// TypeScript lowering). This word list decides only where no such definition
    /// is read, which today is Python's `guard_paths` for a class raised with no
    /// status argument. It is not to be extended, and nothing new is to be built
    /// on it.
    pub fn rejection_class_name(name: &str) -> bool {
        let lower = name_words(name);
        let has = |list: &[&str]| lower.iter().any(|w| list.contains(&w.as_str()));
        has(&[
            "unauthorized",
            "unauthorised",
            "unauthenticated",
            "forbidden",
        ]) || (has(&[
            "auth",
            "authentication",
            "authorization",
            "authorisation",
            "permission",
            "access",
            "login",
        ]) && has(&["error", "exception", "failed", "denied", "required"]))
            || (has(&["not"]) && has(&["authenticated", "authorized", "authorised", "logged"]))
    }

    /// The words of a name, lower case: split at what is no letter or digit and
    /// where a capital follows a lower-case letter or a digit.
    pub fn name_words(name: &str) -> Vec<String> {
        let mut words: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut prev_lower = false;
        for c in name.chars() {
            if !c.is_ascii_alphanumeric() {
                if !cur.is_empty() {
                    words.push(std::mem::take(&mut cur));
                }
                prev_lower = false;
                continue;
            }
            if c.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
            cur.push(c.to_ascii_lowercase());
        }
        if !cur.is_empty() {
            words.push(cur);
        }
        words
    }

    /// A name a value read in a guard's body carries: the user, session, auth, token or
    /// permission it checks (`ctx.user`, `session`, `request.auth`, `token`,
    /// `user.permissions`). A 403 counts as a guard's only next to one.
    pub fn names_subject(name: &str) -> bool {
        let words = name_words(name);
        words.iter().any(|w| {
            matches!(
                w.as_str(),
                "user"
                    | "users"
                    | "session"
                    | "sessions"
                    | "auth"
                    | "token"
                    | "tokens"
                    | "permission"
                    | "permissions"
                    | "role"
                    | "roles"
            )
        })
    }

    /// Text that names a sign-in page (`/login`, `/auth/signin`, `auth.login`), where a
    /// redirect sends a caller who is not signed in.
    pub fn sign_in_target(s: &str) -> bool {
        let s = s.to_ascii_lowercase().replace(['_', '-'], "");
        ["login", "signin", "logon"].iter().any(|w| s.contains(w))
    }

    /// The rejection a status constant's name says (`status.HTTP_401_UNAUTHORIZED`,
    /// `HttpStatus.FORBIDDEN`, `HTTP_429_TOO_MANY_REQUESTS`).
    pub fn rejection_status_name(name: &str) -> Option<Rejection> {
        match name {
            "HTTP_401_UNAUTHORIZED" | "UNAUTHORIZED" | "Unauthorized" => {
                Some(Rejection::Unauthenticated)
            }
            "HTTP_403_FORBIDDEN" | "FORBIDDEN" | "Forbidden" => Some(Rejection::Forbidden),
            "HTTP_429_TOO_MANY_REQUESTS" | "TOO_MANY_REQUESTS" | "TooManyRequests" => {
                Some(Rejection::Throttled)
            }
            _ => None,
        }
    }
}

/// Symbol kind facts ([`Symbol::traits`]). Mining keeps classes of a special kind out
/// of the roles of primary classes: a role of "classes in `repository.py`" should hold
/// repositories, not the NamedTuples and result types next to them.
pub mod traits {
    /// `class X(Enum)` and other enumerations (Django `TextChoices`).
    pub const ENUM: &str = "enum";
    pub const NAMEDTUPLE: &str = "namedtuple";
    pub const TYPEDDICT: &str = "typeddict";
    pub const DATACLASS: &str = "dataclass";
    pub const PROTOCOL: &str = "protocol";
    /// Declares abstract methods, derives from `ABC`, or is an abstract model.
    pub const ABSTRACT: &str = "abstract";
    /// A base or mixin the repo builds on: named like one (`BaseLoader`,
    /// `ExportMixin`), in a `base`/`mixins` module, extended by several production
    /// classes, or `*Base` and extended or abstract (`RepositoryBase`).
    pub const BASE: &str = "base";
    /// A view class represented by its handler methods (`UserViewSet.list`), or built
    /// on a framework view base and not routed itself.
    pub const VIEW: &str = "view";
    /// A type variable (`T = TypeVar("T")`): a generic parameter, not a value.
    pub const TYPE_VAR: &str = "type_var";
    /// Declared abstract (TypeScript `abstract class`): never registered itself.
    /// Only wiring rules read it; ordinary roles keep such classes, as they did
    /// before TypeScript recorded it, so it is not [`ABSTRACT`].
    pub const DECLARED_ABSTRACT: &str = "declared_abstract";
    /// A class that at least one production class of the repo extends (also when it
    /// is a `base`): a concrete parent such as a Django proxy parent or a
    /// single-table-inheritance root. Subclasses in test code, Django's `tests.py`,
    /// `testing/` or `fixtures/` packages and test helpers do not count. A purpose
    /// fact: no role depends on it.
    pub const SUBCLASSED: &str = "subclassed";
    /// A production class or function that exists for tests: a class named for a test
    /// double (`FakeListLLM`, `MockTransport`), or anything defined in a test-support
    /// module (`factories.py`, `fakes.py`, `testutils.py`). A purpose fact: no role
    /// depends on it.
    pub const TEST_HELPER: &str = "test_helper";
    /// A function that passes one of its own parameters (an argument, `*args` or
    /// `**kwargs`) to a call of its own name: a thin wrapper of that call
    /// (`def button(*args, **kwargs): return tag.button(*args, **kwargs)`). Recorded by
    /// Python only; what makes a function a team version of a library function.
    pub const FORWARDS: &str = "forwards";
    /// Lineage kinds of a Python class ([`crate::lineage`]): built, directly or through
    /// classes of the repo, on a framework view, a DRF serializer, a Django model, a
    /// form, a Django model admin, a Django admin inline, only mixins (or named
    /// `*Mixin`), or an exception.
    /// A class of one kind forms roles of its own (`RoleSelector::member_kind`); a class
    /// of none is a plain class.
    pub const LINEAGE_VIEW: &str = "lineage_view";
    pub const LINEAGE_SERIALIZER: &str = "lineage_serializer";
    pub const LINEAGE_MODEL: &str = "lineage_model";
    pub const LINEAGE_FORM: &str = "lineage_form";
    pub const LINEAGE_ADMIN: &str = "lineage_admin";
    pub const LINEAGE_INLINE: &str = "lineage_inline";
    pub const LINEAGE_MIXIN: &str = "lineage_mixin";
    pub const LINEAGE_EXCEPTION: &str = "lineage_exception";
    /// A value (`const`, `let`) a schema library builds: a call chain from a schema
    /// package (`z.object({...}).refine(fn)`, `yup.string()`) or from a binding of the
    /// same file that is one. Recorded by TypeScript only.
    pub const SCHEMA_VALUE: &str = "schema_value";
    /// A value built from literals and built-ins only at its root: an object, array or
    /// primitive literal, or plain data from a built-in (`Object.keys(x)`, `new Map()`).
    /// No library's or the repo's code makes it. Recorded by TypeScript only.
    pub const PLAIN_VALUE: &str = "plain_value";
}

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    #[default]
    Function,
    Component,
    Class,
    Const,
    Variable,
    /// Pseudo-symbol for top-level statements; also the kind of file-level roles.
    Module,
    /// A database model (Prisma model, Drizzle table, SQL table).
    Model,
    /// A workspace package.
    Package,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Wrap {
    /// Canonical wrapper (`apps/web/lib/auth.ts#withWorkspace`), or `try`.
    pub wrapper: String,
    pub kind: WrapKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WrapKind {
    /// `export const GET = withX(handler)`
    Call,
    /// `@Decorator() class X {}`
    Decorator,
    /// A component whose root element is `<Wrapper>`.
    Jsx,
    /// Function body is a single `try { ... }`.
    Try,
    /// `class X extends Base {}`
    Extends,
    /// Applied by project configuration rather than written at the symbol: Django's
    /// `LoginRequiredMiddleware` in `MIDDLEWARE`, DRF's `DEFAULT_PERMISSION_CLASSES`.
    /// A guard for `drift security`; not a convention for mining, since every member
    /// of the role gets it from one setting.
    Config,
    /// Identifies the caller without rejecting a request (DRF `authentication_classes`).
    /// Not a guard.
    Authenticates,
    /// Like [`WrapKind::Authenticates`], applied by configuration (DRF
    /// `DEFAULT_AUTHENTICATION_CLASSES`).
    ConfigAuthenticates,
    /// Explicitly opens the symbol to anyone: DRF `AllowAny`, Django
    /// `@login_not_required`. The opposite of a guard.
    Opens,
    /// A hook the app runs before every request (Flask `app.before_request`, a
    /// blueprint's `before_app_request`). A guard, but not one written for the symbol.
    AppHook,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EntryPoint {
    /// Exported symbol name that is the entry point.
    pub symbol: String,
    /// `http`, `page`, `layout`, `server_action`, `middleware`.
    pub kind: String,
    /// HTTP method for `http` (`GET`, ..., or `ANY`).
    pub method: Option<String>,
    /// Route template with dynamic segments abstracted (`/api/links/[id]`).
    pub route: Option<String>,
    /// Which adapter produced it (`nextjs`).
    pub adapter: String,
}

/// The whole-repo index produced by `drift scan`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoFacts {
    pub schema_version: u32,
    pub files: Vec<FileFacts>,
    pub skipped: Vec<Skipped>,
    /// Database models from Prisma schemas, Drizzle tables and SQL migrations.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<Model>,
    /// Workspace packages: scripts, dependencies and compiler flags.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub packages: Vec<PackageFacts>,
    /// Linter configs (ESLint, oxlint, Biome) and the rules they set that Drift
    /// relates to its own conventions. Read best-effort: a config Drift cannot
    /// parse is listed with no rules, and never fails a scan.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lint: Vec<LintConfig>,
    /// Single-file (incremental) scans only: facts of other files that rules about
    /// the scanned file read, which are not themselves analysed. Today, the class
    /// symbols of the in-repo base classes the file's classes extend, at any depth
    /// ("extends `Mailer`" holds for `ZEmail extends MidEmail extends Mailer`).
    /// Empty, and not serialised, in a full scan, where every file is in `files`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context_files: Vec<FileFacts>,
    /// Keys (environment variable names) of the files co-change rules compare
    /// (`.env.example`, `turbo.json`, an env schema), read from their text when a
    /// policy names them. Empty, and not serialised, otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub key_files: Vec<KeyFile>,
    /// Single-file (incremental) scans of a file below a directory named
    /// [`INTEGRATION_DIR`] only: where the other analysed files below one are (path
    /// and package, no facts). Whether a top-level `integration/` directory is an
    /// integration-test suite, whose code no convention covers, is learned from all
    /// of its test files, which the scanned file alone does not show; it decides
    /// nothing about a file outside such a directory. Empty, and not serialised, in
    /// a full scan, where every file is in `files`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub integration_files: Vec<FileRef>,
    /// The directories a Prisma schema of the repository says its client is
    /// generated into (`generator client { provider = "prisma-client"; output =
    /// "./generated/prisma" }`), repo-relative, sorted. The client written there is
    /// build output, usually not committed: an import that resolves to no file
    /// below one of them is an import of the database client, as one of
    /// `@prisma/client` is. Empty, and not serialised, where no schema names an
    /// output, and in a single-file scan.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generated_clients: Vec<String>,
}

/// The keys one file declares, for co-change rules.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct KeyFile {
    /// Repo-relative path.
    pub path: String,
    /// `(key, 1-based line of its first mention)`, sorted by key.
    pub keys: Vec<(String, u32)>,
}

/// The directory name of integration-test suites (see [`RepoFacts::integration_files`]).
pub const INTEGRATION_DIR: &str = "integration";

/// True when `path` (repo-relative, POSIX) is below a directory named
/// [`INTEGRATION_DIR`], at any depth.
pub fn in_integration_dir(path: &str) -> bool {
    path.rsplit_once('/')
        .is_some_and(|(dir, _)| dir.split('/').any(|d| d == INTEGRATION_DIR))
}

/// Where an analysed file is: its repo-relative path and workspace package.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FileRef {
    pub path: String,
    pub package: String,
}

/// One linter config file.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct LintConfig {
    /// Repo-relative path of the config. Its directory is the scope it covers.
    pub path: String,
    /// `eslint`, `oxlint` or `biome`.
    pub tool: String,
    /// The config also takes settings from a parent config of the same tool
    /// (legacy ESLint without `root: true`, an `extends` Drift does not follow).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inherits: bool,
    /// Settings that apply to every file the config covers (settings scoped to some
    /// files by `files`/`overrides` are left out), sorted by rule.
    pub rules: Vec<LintRule>,
    /// Settings scoped to some directories by an `overrides` entry, where the scope
    /// itself is the information: today only `no-restricted-imports` at `warn` or
    /// `error` ("`packages/app-store` must not import `../features`" states which
    /// way a layer edge goes). Sorted; not serialised when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoped: Vec<ScopedLintRules>,
}

/// Lint settings an `overrides` entry applies to some directories only.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ScopedLintRules {
    /// Repo-relative directories the entry's file globs cover (the literal part of
    /// each glob, `packages/app-store` for `packages/app-store/**/*.ts`), sorted.
    pub dirs: Vec<String>,
    /// The settings, sorted by rule.
    pub rules: Vec<LintRule>,
}

/// A lint rule setting, under a tool-neutral name.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct LintRule {
    /// `no-explicit-any`, `no-console`, `no-process-env`, `rules-of-hooks` or
    /// `no-restricted-imports`.
    pub rule: String,
    /// `off`, `warn` or `error`.
    pub level: String,
    /// String values in the rule's options (restricted import paths), sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Model {
    /// File the model is declared in.
    pub path: String,
    pub name: String,
    /// `prisma`, `drizzle` or `sql`.
    pub source: String,
    pub line: u32,
    /// Field / column names, sorted.
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PackageFacts {
    /// Repo-relative package directory ("" for the root).
    pub path: String,
    pub name: String,
    /// `package.json` script names, sorted.
    pub scripts: Vec<String>,
    /// `name@range` for dependencies and devDependencies, sorted.
    pub dependencies: Vec<String>,
    /// `name@range` for peerDependencies, sorted (`package.json`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub peer_dependencies: Vec<String>,
    /// `name@range` for packages the package runs without: optionalDependencies and
    /// the peerDependencies `peerDependenciesMeta` marks `optional`, sorted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub optional_dependencies: Vec<String>,
    /// tsconfig `compilerOptions` set to `true` (following `extends`), sorted.
    pub compiler_flags: Vec<String>,
    /// Repo-relative manifest the facts were read from, when it is not
    /// `<path>/package.json`: `pyproject.toml`, or `requirements.txt` for a Python
    /// project without one.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub manifest: String,
    /// Source files the manifest exposes to code outside the repository: what `main`,
    /// `module`, `types`, `source`, `bin` and `exports` name, repo-relative, when the
    /// file exists (a build path such as `dist/index.js` is mapped back to
    /// `src/index.ts`). Sorted; npm packages only. What these files export may be used
    /// by code the facts do not see.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<String>,
    /// Package names of the dependencies that appear only in npm `devDependencies`, or
    /// only in Python dev, test or lint groups (`[dependency-groups]`,
    /// `[tool.poetry.group.dev]`, optional-dependencies named `dev`/`test`/`tests`/
    /// `lint`). [`PackageFacts::dependencies`] keeps its meaning. Sorted; omitted when
    /// empty (facts schema 11).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dev_only: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Skipped {
    pub path: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    TooLarge,
    Generated,
    Minified,
    Declaration,
    NotUtf8,
    /// Nesting beyond `nesting::MAX_NESTING`: would overflow the parser's stack.
    TooDeep,
    /// Syntax that makes the TypeScript/JavaScript parser re-read large spans
    /// (`speculation::too_costly`), or a parse that ran out of its memory budget:
    /// parsing would take far more memory than the file's size.
    TooCostly,
    /// No thread stack that covers the file's length could be reserved with room
    /// to spare (an address-space limit, strict overcommit): not parsed this time.
    /// Depends on the process, not the content, so it is never cached.
    StackUnavailable,
    /// JavaScript with type annotations (Flow) that the parser cannot read, or that
    /// cannot be removed with certainty to leave plain JavaScript (Flow-only syntax
    /// such as `{| |}` or `opaque type`, TypeScript-only nodes, a strip that would
    /// change the program): no facts.
    FlowSyntax,
}

impl RepoFacts {
    /// The facts with every listing of entry points ([`Listed`]): what `drift
    /// security` and the practice map read. The facts themselves when no file has a
    /// second reading.
    pub fn listed(&self) -> std::borrow::Cow<'_, RepoFacts> {
        let listed = |files: &[FileFacts]| files.iter().any(|f| f.listed.is_some());
        if !listed(&self.files) && !listed(&self.context_files) {
            return std::borrow::Cow::Borrowed(self);
        }
        std::borrow::Cow::Owned(self.clone().into_listed())
    }

    /// [`RepoFacts::listed`], in place: no copy of the facts is made.
    pub fn into_listed(mut self) -> RepoFacts {
        for f in self.files.iter_mut().chain(&mut self.context_files) {
            f.take_listed();
        }
        self
    }
}

impl FileFacts {
    /// Makes the file its reading with every listing ([`Listed`]), in place.
    fn take_listed(&mut self) {
        let Some(l) = self.listed.take() else { return };
        self.entry_points = l.entry_points;
        self.mounts = l.mounts;
        for s in l.symbols {
            match self
                .symbols
                .iter_mut()
                .find(|x| x.name == s.name && x.line == s.line)
            {
                Some(x) => *x = s,
                None => self.symbols.push(s),
            }
        }
        self.symbols.sort();
        // What the listed reading holds beside the file's own fields stays with
        // it ([`Listed::guard_calls`]).
        if !l.guard_calls.is_empty() || !l.rewrites.is_empty() {
            self.listed = Some(Box::new(Listed {
                entry_points: self.entry_points.clone(),
                mounts: self.mounts.clone(),
                symbols: Vec::new(),
                guard_calls: l.guard_calls,
                rewrites: l.rewrites,
            }));
        }
    }

    /// Every entry point of the file, the ones mining does not read yet included
    /// ([`Listed`]): what says whether, and of what kind, the file serves requests.
    pub fn listed_entry_points(&self) -> &[EntryPoint] {
        match &self.listed {
            Some(l) => &l.entry_points,
            None => &self.entry_points,
        }
    }

    /// Keeps `full`, the same file linked with every listing, beside this one,
    /// linked without the unmeasured ones ([`Listed`]); nothing when they agree.
    pub fn hold(&mut self, full: FileFacts) {
        // What is not listed is said of every listing made, not of the measured ones.
        self.unlisted_routes.clone_from(&full.unlisted_routes);
        if self.entry_points == full.entry_points
            && self.mounts == full.mounts
            && self.symbols == full.symbols
        {
            return;
        }
        let symbols = full
            .symbols
            .into_iter()
            .filter(|s| !self.symbols.contains(s))
            .collect();
        self.listed = Some(Box::new(Listed {
            entry_points: full.entry_points,
            mounts: full.mounts,
            symbols,
            guard_calls: Vec::new(),
            rewrites: Vec::new(),
        }));
    }

    /// `self` is the file linked with every listing and `measured` the same file
    /// linked as the last measured build listed it: `measured`, with the reading
    /// of `self` held beside it ([`Listed`]).
    pub fn held_beside(mut self, mut measured: FileFacts) -> FileFacts {
        let (calls, rewrites) = self
            .listed
            .as_ref()
            .map(|l| (l.guard_calls.clone(), l.rewrites.clone()))
            .unwrap_or_default();
        self.take_listed();
        self.listed = None;
        measured.listed = None;
        measured.hold(self);
        measured.hold_guard_calls(calls);
        measured.hold_rewrites(rewrites);
        measured
    }

    /// Gives the file's listed reading the rewrites of a Next.js configuration
    /// ([`Listed::rewrites`]), sorted.
    pub fn hold_rewrites(&mut self, mut rewrites: Vec<NextRewrite>) {
        rewrites.sort();
        rewrites.dedup();
        if rewrites.is_empty() {
            return;
        }
        match &mut self.listed {
            Some(l) => l.rewrites = rewrites,
            None => {
                self.listed = Some(Box::new(Listed {
                    entry_points: self.entry_points.clone(),
                    mounts: self.mounts.clone(),
                    symbols: Vec::new(),
                    guard_calls: Vec::new(),
                    rewrites,
                }));
            }
        }
    }

    /// The rewrites a Next.js configuration file declares ([`Listed::rewrites`]).
    pub fn rewrites(&self) -> &[NextRewrite] {
        self.listed.as_ref().map_or(&[], |l| &l.rewrites)
    }

    /// Gives the file's listed reading the calls whose shape is recorded
    /// ([`Listed::guard_calls`]), sorted; a file with no second reading gets one
    /// that differs in nothing else.
    pub fn hold_guard_calls(&mut self, mut calls: Vec<SymbolCalls>) {
        for c in &mut calls {
            c.calls.sort();
            c.calls.dedup();
            c.calls.truncate(GuardCall::MAX);
        }
        calls.retain(|c| {
            !c.calls.is_empty()
                || c.hands_on
                || c.param_flows
                || c.returns_function
                || !c.caught.is_empty()
                || !c.verifies.is_empty()
        });
        calls.sort();
        calls.dedup();
        if calls.is_empty() {
            return;
        }
        match &mut self.listed {
            Some(l) => l.guard_calls = calls,
            None => {
                self.listed = Some(Box::new(Listed {
                    entry_points: self.entry_points.clone(),
                    mounts: self.mounts.clone(),
                    symbols: Vec::new(),
                    guard_calls: calls,
                    rewrites: Vec::new(),
                }));
            }
        }
    }

    /// What the mount `entry` is served through adds to it ([`FileFacts::mounts`]);
    /// none when its router's mounts all add the same, which is then on the symbol.
    pub fn mount(&self, entry: &EntryPoint) -> Option<&MountFacts> {
        let route = entry.route.as_deref()?;
        self.mounts
            .iter()
            .find(|m| m.symbol == entry.symbol && m.route == route)
    }

    /// The wraps the mount of `entry` adds ([`MountFacts::wraps`]); empty for most.
    pub fn mount_wraps(&self, entry: &EntryPoint) -> &[Wrap] {
        self.mount(entry).map_or(&[], |m| m.wraps.as_slice())
    }

    /// The calls of `symbol` whose shape is recorded ([`Listed::guard_calls`]);
    /// empty for most.
    pub fn guard_calls_of(&self, symbol: &Symbol) -> &[GuardCall] {
        self.listed
            .iter()
            .flat_map(|l| &l.guard_calls)
            .find(|c| c.symbol == symbol.name && c.line == symbol.line)
            .map_or(&[], |c| c.calls.as_slice())
    }

    /// The body of `symbol` hands the request on where the facts do not follow
    /// ([`SymbolCalls::hands_on`]).
    pub fn hands_on(&self, symbol: &Symbol) -> bool {
        self.listed
            .iter()
            .flat_map(|l| &l.guard_calls)
            .any(|c| c.symbol == symbol.name && c.line == symbol.line && c.hands_on)
    }

    /// What is recorded of `symbol` beside its facts ([`SymbolCalls`]), if anything.
    pub fn symbol_calls(&self, symbol: &Symbol) -> Option<&SymbolCalls> {
        self.listed
            .iter()
            .flat_map(|l| &l.guard_calls)
            .find(|c| c.symbol == symbol.name && c.line == symbol.line)
    }

    /// `symbol` hands back a function written in its own body, wherever it returns
    /// a value ([`SymbolCalls::returns_function`]).
    pub fn returns_function(&self, symbol: &Symbol) -> bool {
        self.listed
            .iter()
            .flat_map(|l| &l.guard_calls)
            .any(|c| c.symbol == symbol.name && c.line == symbol.line && c.returns_function)
    }

    /// Sort and de-duplicate every collection so output is canonical.
    pub fn normalize(&mut self) {
        self.mounts.sort();
        self.mounts.dedup();
        self.outgoing.sort();
        self.outgoing.dedup();
        // The cap drops the ones whose URL is read first: one that is not is never
        // lost while one that is stays.
        if self.outgoing.len() > crate::practice::caps::OUTGOING {
            self.outgoing.sort_by_key(|o| o.unread.is_empty());
            self.outgoing.truncate(crate::practice::caps::OUTGOING);
            self.outgoing.sort();
        }
        self.apps.sort();
        self.apps.dedup();
        self.directives.sort();
        self.directives.dedup();
        for i in &mut self.imports {
            i.names.sort();
            i.names.dedup();
        }
        self.imports.sort();
        self.imports.dedup();
        self.exports.sort();
        self.exports.dedup();
        for s in &mut self.symbols {
            s.exported_as.sort();
            s.exported_as.dedup();
            s.calls.sort();
            s.calls.dedup();
            s.renders.sort();
            s.renders.dedup();
            s.args.sort();
            s.args.dedup();
            s.controls.sort();
            s.controls.dedup();
            s.suppressions.sort();
            s.suppressions.dedup();
            s.reads.sort();
            s.reads.dedup();
            s.throws.sort();
            s.throws.dedup();
            s.sinks.sort();
            s.sinks.dedup();
            s.server_reads.sort();
            s.server_reads.dedup();
            // One entry per name: overloads, a getter and its setter, are one member.
            let mut members: std::collections::BTreeMap<String, Member> =
                std::collections::BTreeMap::new();
            for m in std::mem::take(&mut s.members) {
                let e = members.entry(m.name.clone()).or_insert_with(|| Member {
                    name: m.name.clone(),
                    // Of every body under the name, once merged below.
                    returns_only_true: true,
                    ..Member::default()
                });
                e.returns_only_true &= m.returns_only_true;
                e.calls.extend(m.calls);
                e.sinks.extend(m.sinks);
                e.returns_nonconstant_bool |= m.returns_nonconstant_bool;
                e.body_checks.extend(m.body_checks);
                e.throws.extend(m.throws);
                e.args.extend(m.args);
                e.scoped_queries.extend(m.scoped_queries);
                e.raise_checks.extend(m.raise_checks);
                e.decorators.extend(m.decorators);
                e.receiver_calls.extend(m.receiver_calls);
                e.conditional_calls.extend(m.conditional_calls);
                e.order.extend(m.order);
                e.unread.extend(m.unread);
                e.caller_args.extend(m.caller_args);
                e.is_async |= m.is_async;
            }
            s.members = members
                .into_values()
                .map(|mut m| {
                    m.calls.sort();
                    m.calls.dedup();
                    m.sinks.sort();
                    m.sinks.dedup();
                    m.body_checks.sort();
                    m.body_checks.dedup();
                    m.throws.sort();
                    m.throws.dedup();
                    m.args.sort();
                    m.args.dedup();
                    m.scoped_queries.sort();
                    m.scoped_queries.dedup();
                    m.raise_checks.sort();
                    m.raise_checks.dedup();
                    // In source order: only a repeat is dropped.
                    let mut seen = std::collections::BTreeSet::new();
                    m.decorators.retain(|d| seen.insert(d.clone()));
                    m.receiver_calls.sort();
                    m.receiver_calls.dedup();
                    m.conditional_calls.sort();
                    m.conditional_calls.dedup();
                    m.unread.sort();
                    m.unread.dedup();
                    m.caller_args.sort();
                    m.caller_args.dedup();
                    m
                })
                .collect();
            s.traits.sort();
            s.traits.dedup();
            s.arg_types.sort();
            s.arg_types.dedup();
            s.field_decorators.sort();
            s.field_decorators.dedup();
            s.meta.sort();
            s.meta.dedup();
            s.decorator_args.sort();
            s.decorator_args.dedup();
            s.disclaims.sort();
            s.disclaims.dedup();
            s.receiver_calls.sort();
            s.receiver_calls.dedup();
            s.attr_types.sort();
            s.attr_types.dedup();
            s.conditional_calls.sort();
            s.conditional_calls.dedup();
            normalize_practice(s);
        }
        self.symbols.sort();
        self.entry_points.sort();
        self.entry_points.dedup();
        self.client_leaks.sort();
        self.client_leaks.dedup();
        for r in &mut self.registries {
            r.items.sort();
            r.items.dedup_by(|a, b| a.target == b.target);
        }
        self.registries.sort();
        self.registries.dedup();
        self.discovers.sort();
        self.discovers.dedup();
        for t in &mut self.test_requests {
            if !practice::valid_route(&t.route) {
                t.route.clear();
            }
            t.statuses.sort_unstable();
            t.statuses.dedup();
        }
        self.mocks.retain(|m| {
            m.strip_prefix(practice::MSW_PREFIX)
                .is_none_or(practice::valid_route)
        });
        let mut cut = Vec::new();
        for m in &mut self.route_matchers {
            let before = m.patterns.len();
            m.patterns.retain(|p| practice::valid_route(p));
            let dropped = m.patterns.len() < before;
            let capped = sort_cap(&mut m.patterns, caps::MATCHER_PATTERNS);
            if capped {
                cut.push("route_matchers.patterns");
            }
            m.opaque |= dropped || capped || m.patterns.is_empty();
        }
        for (field, capped) in [
            (
                "test_requests",
                sort_cap(&mut self.test_requests, caps::TEST_REQUESTS),
            ),
            ("mocks", sort_cap(&mut self.mocks, caps::MOCKS)),
            (
                "route_matchers",
                sort_cap(&mut self.route_matchers, caps::MATCHERS),
            ),
        ] {
            if capped {
                cut.push(field);
            }
        }
        add_truncated(&mut self.truncated, cut);
    }
}

/// Sort, de-duplicate, then keep the first `cap`: truncation after sorting does not
/// depend on the order facts were found in. True when the cap cut entries.
fn sort_cap<T: Ord>(v: &mut Vec<T>, cap: usize) -> bool {
    v.sort();
    v.dedup();
    let cut = v.len() > cap;
    v.truncate(cap);
    cut
}

/// Add the names of the fields a cap cut to `truncated`, sorted and de-duplicated
/// (names already there stay: a second `normalize` cuts nothing).
fn add_truncated(truncated: &mut Vec<String>, cut: Vec<&str>) {
    truncated.extend(cut.into_iter().map(String::from));
    truncated.sort();
    truncated.dedup();
}

/// The practice facts of one symbol (facts schema 11): inner lists first, then each
/// list sorted, de-duplicated and capped; headers that are no header name are dropped
/// (the string policy).
fn normalize_practice(s: &mut Symbol) {
    let mut cut = Vec::new();
    for r in &mut s.responses {
        if sort_cap(&mut r.keys, caps::RESPONSE_KEYS) {
            cut.push("responses.keys");
        }
    }
    for c in &mut s.catches {
        c.catches.sort();
        c.catches.dedup();
        c.does.sort();
        c.does.dedup();
    }
    s.headers.retain(|h| practice::valid_header(h));
    for (field, capped) in [
        (
            "body_checks",
            sort_cap(&mut s.body_checks, caps::BODY_CHECKS),
        ),
        ("responses", sort_cap(&mut s.responses, caps::RESPONSES)),
        ("log_calls", sort_cap(&mut s.log_calls, caps::LOG_CALLS)),
        ("catches", sort_cap(&mut s.catches, caps::CATCHES)),
        ("headers", sort_cap(&mut s.headers, caps::HEADERS)),
        ("inputs", sort_cap(&mut s.inputs, caps::INPUTS)),
        (
            "handles_errors",
            sort_cap(&mut s.handles_errors, caps::HANDLES),
        ),
        (
            "scoped_queries",
            sort_cap(&mut s.scoped_queries, caps::SCOPED_QUERIES),
        ),
        (
            "raise_checks",
            sort_cap(&mut s.raise_checks, caps::RAISE_CHECKS),
        ),
    ] {
        if capped {
            cut.push(field);
        }
    }
    add_truncated(&mut s.truncated, cut);
}

impl RepoFacts {
    /// Files skipped for lack of stack ([`SkipReason::StackUnavailable`]), sorted:
    /// not parsed this time, so what they hold is unknown, not absent. Every reader
    /// of facts treats them as unchecked ([`SkipReason::StackUnavailable`] never
    /// comes from the content, so a later scan with room parses them).
    pub fn stack_unavailable(&self) -> Vec<&str> {
        let mut out: Vec<&str> = self
            .skipped
            .iter()
            .filter(|s| s.reason == SkipReason::StackUnavailable)
            .map(|s| s.path.as_str())
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    }

    pub fn normalize(&mut self) {
        for f in &mut self.files {
            f.normalize();
        }
        self.files.sort_by(|a, b| a.path.cmp(&b.path));
        self.skipped.sort();
        for m in &mut self.models {
            m.fields.sort();
            m.fields.dedup();
        }
        self.models.sort();
        for p in &mut self.packages {
            p.dev_only.sort();
            p.dev_only.dedup();
        }
        self.packages.sort();
        for c in &mut self.lint {
            for r in &mut c.rules {
                r.options.sort();
                r.options.dedup();
            }
            c.rules.sort();
            c.rules.dedup_by(|a, b| a.rule == b.rule);
            for sc in &mut c.scoped {
                sc.dirs.sort();
                sc.dirs.dedup();
                for r in &mut sc.rules {
                    r.options.sort();
                    r.options.dedup();
                }
                sc.rules.sort();
            }
            c.scoped.sort();
        }
        self.lint.sort();
        for f in &mut self.context_files {
            f.normalize();
        }
        self.context_files.sort_by(|a, b| a.path.cmp(&b.path));
        for k in &mut self.key_files {
            k.keys.sort();
            k.keys.dedup_by(|a, b| a.0 == b.0);
        }
        self.key_files.sort();
        self.key_files.dedup_by(|a, b| a.path == b.path);
        self.integration_files.sort();
        self.integration_files.dedup();
    }
}
