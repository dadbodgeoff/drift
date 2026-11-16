//! The closed lists a guard position is read by (TypeScript and JavaScript).
//!
//! What stands where a guard goes (a middleware argument, a `use`, a hook, a
//! decorator's argument, a wrapper of an exported handler) is one of three things:
//! the guard, nothing, or unknown. Unknown is the default. A value is taken out of it
//! only by proof, and the proof depends on where the value comes from:
//!
//! - a. a function of the repository whose body is read to refuse every request
//!   without identity: the guard;
//! - b. a function of the repository whose body is read to the end and never
//!   refuses: nothing;
//! - c. a function of the repository that refuses some requests only, or is not
//!   read to the end: unknown;
//! - d. a call of a library guard on [`LIBRARY_GUARDS`], in a call shape the entry
//!   understands: the guard;
//! - e. the same library with an option the entry lists as letting a request
//!   without identity through: nothing; with any other option or argument the entry
//!   does not understand: unknown;
//! - f. a library value on [`NEVER_AUTHENTICATES`]: nothing;
//! - g. a value imported from a package on neither list: unknown;
//! - h. a value of unknown origin (a parameter, a variable not resolved, a member of
//!   an object that is not read, a computed access, a conditional): unknown;
//! - i. a composition on [`COMBINATORS`] whose every member is classified: what the
//!   relation makes of the members; any other composition: unknown.
//!
//! This module holds d, e, f and the combinators of i: what a package documents, as
//! data, one entry per export, each with the call shapes it understands. The
//! semantics are the libraries' documented behaviour as of the versions named in
//! the entries; a shape that is not listed is not understood, whatever it looks
//! like, and an entry is added only for a behaviour the library documents. The
//! bodies of the repository (a, b, c) and the values of unknown origin (g, h) are
//! read by `drift_mine::guard_position`, which is the one place every position asks.

use crate::facts::{CallArg, GuardCall};

/// What a list says of a library value at a guard position ([`library`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Library {
    /// A library guard in an understood shape: it refuses every request without
    /// identity.
    Guard,
    /// A library guard in a shape documented to let a request without identity
    /// through (`credentialsRequired: false`): it identifies, and refuses no one.
    Optional,
    /// A library guard in a shape the entry does not understand: unknown.
    Unread,
    /// On [`NEVER_AUTHENTICATES`]: nothing.
    Never,
    /// A combinator: the relation, and the members as they are written.
    Combines(Relation, Vec<CallArg>),
    /// On no list: unknown.
    Unlisted,
}

/// How a combinator decides from its members ([`COMBINATORS`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Relation {
    /// Every member runs, in order, and each can refuse: the composition is a guard
    /// where one member is.
    All,
    /// The request passes where one member lets it through: the composition is a
    /// guard only where every member is, and nothing where one member is nothing.
    Any,
}

/// The arguments of each call of a chain, innermost first ([`GuardCall::args`]).
type Calls<'a> = &'a [Vec<CallArg>];

/// One export of a package that guards ([`LIBRARY_GUARDS`]).
pub struct LibraryGuard {
    /// The module the export is imported from, as written (`hono/jwt`).
    pub package: &'static str,
    /// The export (`authenticate` for `passport.authenticate` and for a named
    /// import of it; `default` for the default export called itself).
    pub export: &'static str,
    /// The call shapes the entry understands, for a reader.
    pub understood: &'static str,
    /// Reads a use: the members read off the export's result (`unless` in
    /// `expressjwt(...).unless(...)`), and the arguments of each call; no call at
    /// all for a bare reference.
    read: fn(chain: &[&str], calls: Calls) -> Library,
}

/// The library guards. A call of one of these exports is a guard only in a shape its
/// entry understands; in any other it is unknown.
pub const LIBRARY_GUARDS: &[LibraryGuard] = &[
    // Passport 0.4 to 0.7, `passport.authenticate(strategy, [options], [callback])`.
    // Documented: without a callback a failed authentication is answered 401 (or
    // redirected with `failureRedirect`, or handed to `next(err)` with
    // `failWithError`); given several strategies, the request fails only when all
    // of them fail. With a custom callback "it becomes the application's
    // responsibility to establish a session and send a response": the library
    // refuses no one. `passport-anonymous`, whose strategy is named `anonymous`,
    // passes every request.
    LibraryGuard {
        package: "passport",
        export: "authenticate",
        understood: "authenticate(<text> | [<text>, ...] without \"anonymous\"[, { session, failWithError, failureRedirect, failureMessage, failureFlash, scope, state }]); a custom callback, a strategy that is no text literal and any other option are not read",
        read: passport_authenticate,
    },
    // @fastify/passport 2 and 3, `fastifyPassport.authenticate(strategy, [options],
    // [callback])`: the same contract as Passport's, as a Fastify hook.
    LibraryGuard {
        package: "@fastify/passport",
        export: "authenticate",
        understood: "as passport's authenticate",
        read: passport_authenticate,
    },
    // express-jwt 7 and 8, `expressjwt(options)`; 6 and earlier, the default export
    // `jwt(options)`. Documented: a request with no valid token is answered with
    // `UnauthorizedError` (401); "credentialsRequired: false" lets a request
    // without a token continue; `.unless(...)` (express-unless) skips the
    // middleware for the paths, methods or conditions it names.
    LibraryGuard {
        package: "express-jwt",
        export: "expressjwt",
        understood: "expressjwt({ secret, algorithms, audience, issuer, requestProperty, getToken, isRevoked[, credentialsRequired: true] }); credentialsRequired: false is optional identity; .unless(...), a spread, any other option or value are not read",
        read: express_jwt,
    },
    LibraryGuard {
        package: "express-jwt",
        export: "default",
        understood: "as expressjwt (versions before 7)",
        read: express_jwt,
    },
    LibraryGuard {
        package: "express-jwt",
        export: "jwt",
        understood: "as expressjwt (versions before 7)",
        read: express_jwt,
    },
    // express-oauth2-jwt-bearer 1, `auth([options])`. Documented: "returns a 401 if
    // a valid JWT bearer token is not provided in the request"; "authRequired:
    // false" makes the token optional. `requiredScopes` and the claim checks are
    // documented to follow `auth()`: alone they are not listed.
    LibraryGuard {
        package: "express-oauth2-jwt-bearer",
        export: "auth",
        understood: "auth() and auth({ audience, issuerBaseURL, issuer, jwksUri, secret, tokenSigningAlg[, authRequired: true] }); authRequired: false is optional identity; any other option or value is not read",
        read: oauth2_bearer_auth,
    },
    // express-openid-connect 2, `requiresAuth()`. Documented: "requires the user to
    // be authenticated", else it starts a login or answers 401. With a custom
    // predicate (`requiresAuth((req) => ...)`) the predicate decides: not read.
    LibraryGuard {
        package: "express-openid-connect",
        export: "requiresAuth",
        understood: "requiresAuth() with no argument",
        read: no_arguments,
    },
    // Hono 3 and 4, `jwt({ secret, ... })` of `hono/jwt`. Documented: verifies the
    // token of the `Authorization` header (or of a cookie) and answers 401
    // otherwise.
    LibraryGuard {
        package: "hono/jwt",
        export: "jwt",
        understood: "jwt({ secret[, cookie, alg, headerName] })",
        read: |chain, calls| one_object(chain, calls, &["secret", "cookie", "alg", "headerName"]),
    },
    // Hono 3 and 4, `bearerAuth({ token | verifyToken, ... })` of
    // `hono/bearer-auth`. Documented: answers 401 where the bearer token is absent
    // or does not match.
    LibraryGuard {
        package: "hono/bearer-auth",
        export: "bearerAuth",
        understood: "bearerAuth({ token | verifyToken[, realm, prefix, headerName, hashFunction] })",
        read: |chain, calls| {
            one_object(
                chain,
                calls,
                &[
                    "token",
                    "verifyToken",
                    "realm",
                    "prefix",
                    "headerName",
                    "hashFunction",
                ],
            )
        },
    },
    // Hono 3 and 4, `basicAuth({ username, password } | { verifyUser }, ...users)` of
    // `hono/basic-auth`. Documented: answers 401 with `WWW-Authenticate` where the
    // credentials are absent or do not match.
    LibraryGuard {
        package: "hono/basic-auth",
        export: "basicAuth",
        understood: "basicAuth({ username, password | verifyUser[, realm, hashFunction] }[, { username, password }, ...])",
        read: hono_basic_auth,
    },
    // @nestjs/passport 8 to 11, `AuthGuard(strategy)`. Documented: its
    // `canActivate` runs the Passport strategy and its `handleRequest` throws
    // `UnauthorizedException` where no user was found. A subclass that overrides
    // either is read by its own body, not here.
    LibraryGuard {
        package: "@nestjs/passport",
        export: "AuthGuard",
        understood: "AuthGuard(), AuthGuard(<text>) and AuthGuard([<text>, ...]) without \"anonymous\"",
        read: nest_auth_guard,
    },
    // next-auth 4, `withAuth` of `next-auth/middleware` (also its default export).
    // Documented: a request with no session token is redirected to the sign-in
    // page; a middleware function given to it "will only be invoked if the
    // authorized callback returns true"; `callbacks.authorized` replaces the
    // check, and is not read.
    LibraryGuard {
        package: "next-auth/middleware",
        export: "withAuth",
        understood: "withAuth, withAuth(), withAuth(<function>), withAuth({ pages, secret }) and withAuth(<function>, { pages, secret }); callbacks and any other option are not read",
        read: next_with_auth,
    },
    LibraryGuard {
        package: "next-auth/middleware",
        export: "default",
        understood: "as withAuth",
        read: next_with_auth,
    },
    // Clerk (`@clerk/nextjs`, `@clerk/express`, ...), `auth.protect()` and
    // `auth().protect()`. Documented: an unauthenticated request is redirected to
    // sign-in or answered 401/404, whatever it is given (a role, a permission, a
    // predicate narrow it further).
    LibraryGuard {
        package: "@clerk/",
        export: "protect",
        understood: "auth.protect(...) and auth().protect(...), with any argument",
        read: |_, calls| {
            if calls.is_empty() {
                Library::Unread
            } else {
                Library::Guard
            }
        },
    },
    // hapi 17 to 21, a route's authentication (`options.auth`, or the server's
    // default): the TypeScript reader writes `auth.required` of the package for a
    // route whose auth names a strategy in the mode `required`, the mode hapi
    // gives a strategy unless told otherwise. Documented: such a route answers 401
    // to a request that does not authenticate, whatever the strategy.
    LibraryGuard {
        package: "@hapi/hapi",
        export: "auth",
        understood: "a route's auth in the mode required, as the reader writes it",
        read: hapi_auth,
    },
    LibraryGuard {
        package: "hapi",
        export: "auth",
        understood: "as @hapi/hapi",
        read: hapi_auth,
    },
];

/// [`LIBRARY_GUARDS`]: hapi's route authentication, as the reader writes it.
fn hapi_auth(chain: &[&str], _: Calls) -> Library {
    if chain == ["required"] {
        Library::Guard
    } else {
        Library::Unread
    }
}

/// The combinators: a call that runs the guards it is given.
pub struct Combinator {
    pub package: &'static str,
    pub export: &'static str,
    pub understood: &'static str,
    read: fn(chain: &[&str], calls: Calls) -> Library,
}

/// The combinators that are read. Any other function given guards (one of the
/// repository that is not proven, a package's) is unknown.
pub const COMBINATORS: &[Combinator] = &[
    // express-async-handler 1, `asyncHandler(fn)`. Documented: calls `fn` and hands
    // a rejection to `next`: what it is given decides.
    Combinator {
        package: "express-async-handler",
        export: "default",
        understood: "asyncHandler(<middleware>)",
        read: |chain, calls| match (chain, calls) {
            ([], [args]) if args.len() == 1 => Library::Combines(Relation::All, args.clone()),
            _ => Library::Unread,
        },
    },
    // compose-middleware 5, `compose(...middleware)` (arrays are flattened).
    // Documented: runs each in order as Express does.
    Combinator {
        package: "compose-middleware",
        export: "compose",
        understood: "compose(<middleware>, ...) and compose([<middleware>, ...])",
        read: |chain, calls| match (chain, calls) {
            ([], [args]) if !args.is_empty() => {
                let mut members = Vec::new();
                for a in args {
                    match a {
                        CallArg::List(inner) => members.extend(inner.iter().cloned()),
                        other => members.push(other.clone()),
                    }
                }
                Library::Combines(Relation::All, members)
            }
            _ => Library::Unread,
        },
    },
    // Hono 4, `every(...middleware)` of `hono/combine`. Documented: runs each in
    // order and stops where one fails.
    Combinator {
        package: "hono/combine",
        export: "every",
        understood: "every(<middleware>, ...)",
        read: |chain, calls| match (chain, calls) {
            ([], [args]) if !args.is_empty() => Library::Combines(Relation::All, args.clone()),
            _ => Library::Unread,
        },
    },
    // Hono 4, `some(...middleware)` of `hono/combine`. Documented: runs the first,
    // and the next one only where it fails: the request passes where any passes.
    Combinator {
        package: "hono/combine",
        export: "some",
        understood: "some(<middleware>, ...)",
        read: |chain, calls| match (chain, calls) {
            ([], [args]) if !args.is_empty() => Library::Combines(Relation::Any, args.clone()),
            _ => Library::Unread,
        },
    },
];

/// The decorators a Fastify plugin of a package adds to the instance, read where the
/// package depends on the plugin and the repository decorates no member of that
/// name itself ([`fastify_decorator`]).
pub struct FastifyDecorator {
    /// The member of the instance (`app.basicAuth`).
    pub name: &'static str,
    pub package: &'static str,
    pub understood: &'static str,
    read: fn(calls: Calls) -> Library,
}

pub const FASTIFY_DECORATORS: &[FastifyDecorator] = &[
    // @fastify/basic-auth 3 to 6: `fastify.basicAuth`, a hook. Documented: answers
    // 401 where the `Authorization` header is missing or badly formed, before the
    // `validate` function of the registration runs.
    FastifyDecorator {
        name: "basicAuth",
        package: "@fastify/basic-auth",
        understood: "app.basicAuth, given as a hook",
        read: bare,
    },
    // @fastify/bearer-auth 7 to 10: `fastify.verifyBearerAuth`, the hook the plugin
    // decorates the instance with (and installs itself unless `addHook: false`).
    // Documented: answers 401 where the bearer key is absent or not one of `keys`.
    FastifyDecorator {
        name: "verifyBearerAuth",
        package: "@fastify/bearer-auth",
        understood: "app.verifyBearerAuth, given as a hook",
        read: bare,
    },
    // @fastify/auth 3 to 5: `fastify.auth(functions, [options])`. Documented: the
    // default relation is `or` (the request passes where one function passes);
    // `{ relation: 'and' }` asks every function to pass; `run: 'all'` only says
    // whether the others still run. Nested arrays mix the two relations: not read.
    FastifyDecorator {
        name: "auth",
        package: "@fastify/auth",
        understood: "app.auth([<function>, ...][, { relation: \"and\" | \"or\", run }]); nested arrays, a relation that is no text literal and any other option are not read",
        read: fastify_auth,
    },
    // @fastify/rate-limit 7 to 10: `fastify.rateLimit(options)`, a hook that
    // answers 429 by rate. It asks nothing of who calls.
    FastifyDecorator {
        name: "rateLimit",
        package: "@fastify/rate-limit",
        understood: "app.rateLimit(...)",
        read: |_| Library::Never,
    },
    // @fastify/csrf-protection 6 and 7: `fastify.csrfProtection`, a hook that
    // checks the CSRF token of a request. It asks nothing of who calls.
    FastifyDecorator {
        name: "csrfProtection",
        package: "@fastify/csrf-protection",
        understood: "app.csrfProtection",
        read: |_| Library::Never,
    },
];

/// tRPC 10 and 11: what builds an instance (`initTRPC.create()`,
/// `initTRPC.context<Ctx>().meta<Meta>().create(...)`). The instance's
/// `procedure` is the base builder, documented to run no middleware: a procedure
/// is guarded only by what `.use(...)` adds to it.
pub const TRPC_INSTANCE: &str = "pkg:@trpc/server#initTRPC";

/// What the canonical of a member of a Fastify instance starts with
/// (`global#fastify.basicAuth`): the lowering writes it for `app.<name>` and
/// `fastify.<name>` where the receiver is an instance, whatever it is called.
pub const FASTIFY_MEMBER: &str = "global#fastify.";

/// Library values that never authenticate: they parse, log, limit, validate, set
/// headers or serve files, and turn no one away for who they are. By package (every
/// export of it), or by package and export. Closed: a package that is not here may
/// be the guard.
pub const NEVER_AUTHENTICATES: &[(&str, &str)] = &[
    // Express's own: body parsers and the static file server.
    ("express", "json"),
    ("express", "urlencoded"),
    ("express", "raw"),
    ("express", "text"),
    ("express", "static"),
    ("body-parser", ""),
    ("serve-static", ""),
    ("serve-favicon", ""),
    // Headers, CORS, compression, cookies.
    ("cors", ""),
    ("helmet", ""),
    ("hpp", ""),
    ("compression", ""),
    ("cookie-parser", ""),
    ("method-override", ""),
    ("response-time", ""),
    ("connect-timeout", ""),
    // Loggers.
    ("morgan", ""),
    ("pino-http", ""),
    ("express-pino-logger", ""),
    ("express-winston", ""),
    // Rate limiters.
    ("express-rate-limit", ""),
    ("express-slow-down", ""),
    ("hono-rate-limiter", ""),
    // Validators and schemas.
    ("express-validator", ""),
    ("celebrate", ""),
    ("@hono/zod-validator", ""),
    ("@hono/valibot-validator", ""),
    ("@hono/typebox-validator", ""),
    ("hono/validator", ""),
    // Uploads.
    ("multer", ""),
    ("express-fileupload", ""),
    // Sessions: they identify a caller who has one, and refuse no one
    // (express-session and cookie-session load or create a session for every
    // request; Passport's `initialize` and `session` restore `req.user` from it).
    ("express-session", ""),
    ("cookie-session", ""),
    ("connect-flash", ""),
    ("passport", "initialize"),
    ("passport", "session"),
    ("@fastify/passport", "initialize"),
    ("@fastify/passport", "secureSession"),
    // CSRF tokens: a check on the request, not on who sends it.
    ("csurf", ""),
    ("hono/csrf", ""),
    // API documentation.
    ("swagger-ui-express", ""),
    // Files a package serves itself, and the listing of a directory: `robots.txt`,
    // `security.txt`, an index page. Each answers its own path and hands every
    // other request on.
    ("express-robots-txt", ""),
    ("express-security.txt", ""),
    ("serve-index", ""),
    ("express-static-gzip", ""),
    ("connect-history-api-fallback", ""),
    // Response headers, request ids and locales.
    ("feature-policy", ""),
    ("permissions-policy", ""),
    ("nocache", ""),
    ("express-request-id", ""),
    ("i18n", "init"),
    ("i18next-http-middleware", ""),
    // Metrics and error pages.
    ("express-prom-bundle", ""),
    ("express-status-monitor", ""),
    ("errorhandler", ""),
    // next-safe-action 7: `createSafeActionClient(...)` builds a client with no
    // middleware of its own; what `.use(...)` adds is read where it is added.
    ("next-safe-action", "createSafeActionClient"),
    // Hono's own middleware that reads or shapes the exchange.
    ("hono/cors", ""),
    ("hono/logger", ""),
    ("hono/pretty-json", ""),
    ("hono/secure-headers", ""),
    ("hono/compress", ""),
    ("hono/etag", ""),
    ("hono/timing", ""),
    ("hono/body-limit", ""),
    ("hono/request-id", ""),
    ("hono/cache", ""),
    ("hono/powered-by", ""),
    ("hono/trailing-slash", ""),
    ("hono/context-storage", ""),
    ("hono/serve-static", ""),
    ("@hono/node-server/serve-static", ""),
];

/// Members of a request that verify who calls and throw where they cannot, by name:
/// `request.jwtVerify()` of `@fastify/jwt`, `req.verify(...)`. A call of one on a
/// parameter, outside any `try`, may be what turns the caller away: the function it
/// stands in is never taken for one that refuses no one
/// ([`crate::facts::SymbolCalls::verifies`]). A name is no proof of a guard either.
pub const VERIFIER_MEMBERS: &[&str] = &["jwtVerify", "verify", "verifyIdToken", "authenticate"];

/// A webhook signature verifier of a closed list ([`SIGNATURE_VERIFIERS`]): a
/// package's call that checks the request was signed by the sending service with a
/// shared secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignatureVerifier {
    /// The package root (`svix`, `stripe`, `slack_sdk`).
    pub package: &'static str,
    /// The call's path in the package, a class built as `()` (`Webhook().verify`):
    /// the canonical's path after `#` is this or ends with `.` and this.
    pub path: &'static str,
    /// The verifier as a row says it (`svix Webhook.verify`).
    pub label: &'static str,
    /// It raises or throws where the signature does not verify (svix, Stripe,
    /// standard-webhooks); otherwise it answers a boolean, which the body must test
    /// and refuse on (Slack's `SignatureVerifier.is_valid_request`).
    pub throws: bool,
}

/// The webhook signature verifiers whose call shape a reader knows: a body that
/// calls one for every request, and whose failure leaves the body (raised past it,
/// or answered with an error; for a boolean verifier, a refusal on its result), is
/// what the sending service is checked by. No sign-in is asked of such a caller, by
/// design. Python's canonical names (`pkg:svix#webhooks.Webhook().verify`,
/// `pkg:stripe#Webhook.construct_event`) and TypeScript's (`pkg:svix#Webhook(new)
/// .verify`, `(new)` read as `()`).
pub const SIGNATURE_VERIFIERS: &[SignatureVerifier] = &[
    SignatureVerifier {
        package: "svix",
        path: "Webhook().verify",
        label: "svix Webhook.verify",
        throws: true,
    },
    SignatureVerifier {
        package: "standardwebhooks",
        path: "Webhook().verify",
        label: "standard-webhooks Webhook.verify",
        throws: true,
    },
    SignatureVerifier {
        package: "stripe",
        path: "Webhook.construct_event",
        label: "Stripe Webhook.construct_event",
        throws: true,
    },
    SignatureVerifier {
        package: "slack_sdk",
        path: "SignatureVerifier().is_valid_request",
        label: "Slack SignatureVerifier.is_valid_request",
        throws: false,
    },
    SignatureVerifier {
        package: "slack_sdk",
        path: "SignatureVerifier().is_valid",
        label: "Slack SignatureVerifier.is_valid",
        throws: false,
    },
];

/// The verifier of [`SIGNATURE_VERIFIERS`] a canonical call is (`pkg:svix#webhooks
/// .Webhook().verify`), if any.
pub fn signature_verifier(canonical: &str) -> Option<&'static SignatureVerifier> {
    let (module, path) = canonical.strip_prefix("pkg:")?.split_once('#')?;
    let path = path.replace("(new)", "()");
    SIGNATURE_VERIFIERS.iter().find(|v| {
        package_root(module).split('.').next() == Some(v.package)
            && (path == v.path
                || path
                    .strip_suffix(v.path)
                    .is_some_and(|head| head.ends_with('.')))
    })
}

/// Packages whose calls verify who calls (a token, a session) and may throw where
/// they cannot. A call of one in a function standing where a guard goes may be what
/// turns the caller away, so the function is read to refuse no one only where what
/// the call throws is caught and swallowed ([`crate::facts::SymbolCalls::caught`]).
pub const VERIFYING_PACKAGES: &[&str] = &[
    "jsonwebtoken",
    "jose",
    "jwks-rsa",
    "passport",
    "@fastify/jwt",
    "@fastify/passport",
    "@nestjs/jwt",
    "@nestjs/passport",
    "firebase-admin",
    "next-auth",
    "@auth/core",
    "@auth/express",
    "@clerk/",
    "@supabase/ssr",
    "@supabase/supabase-js",
    "better-auth",
    "lucia",
    "iron-session",
    "express-jwt",
    "express-oauth2-jwt-bearer",
    "express-openid-connect",
    "hono/jwt",
];

/// `spec` is one of [`VERIFYING_PACKAGES`], or a module of one (`jose/jwt/verify`).
pub fn verifying_package(spec: &str) -> bool {
    VERIFYING_PACKAGES.iter().any(|p| {
        spec == *p
            || (p.ends_with('/') && spec.starts_with(p))
            || spec
                .strip_prefix(p)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// The runtime's own objects and functions, by the name a reference to them starts
/// with (`global#console.log`): a call of one written in a middleware (`(req, res,
/// next) => { console.log(req.path); next() }`) turns no one away. Any other name
/// that is declared nowhere may hold anything.
pub const RUNTIME: &[&str] = &[
    "console",
    "JSON",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Date",
    "Math",
    "Promise",
    "Symbol",
    "Map",
    "Set",
    "Error",
    "URL",
    "URLSearchParams",
    "Buffer",
    "performance",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "clearTimeout",
    "clearInterval",
    "queueMicrotask",
    "structuredClone",
    "parseInt",
    "parseFloat",
    "encodeURIComponent",
    "decodeURIComponent",
];

/// What builds an application or a router of a framework Drift lists routes of: a
/// function that calls a binding made by one of these hands the request on to it
/// (`http.createServer((req, res) => app(req, res))`).
pub const ROUTER_CONSTRUCTORS: &[(&str, &str)] = &[
    ("express", "default"),
    ("express", "Router"),
    ("fastify", "default"),
    ("fastify", "fastify"),
    ("fastify", "Fastify"),
    ("hono", "Hono"),
    ("@hono/zod-openapi", "OpenAPIHono"),
];

/// `canonical` is a call of one of [`ROUTER_CONSTRUCTORS`] (`pkg:express#default`,
/// `pkg:hono#Hono(new)`).
pub fn router_constructor(canonical: &str) -> bool {
    let c = canonical.trim_end_matches("(new)");
    let Some((package, path)) = c.strip_prefix("pkg:").and_then(|c| c.split_once('#')) else {
        return false;
    };
    let export = path.strip_prefix("default.").unwrap_or(path);
    ROUTER_CONSTRUCTORS
        .iter()
        .any(|(p, e)| *p == package && *e == export)
}

/// `canonical` names something of the runtime ([`RUNTIME`]).
pub fn runtime(canonical: &str) -> bool {
    canonical.strip_prefix("global#").is_some_and(|rest| {
        let first = rest.split(['.', '(']).next().unwrap_or_default();
        RUNTIME.contains(&first)
    })
}

/// A package's export, from its canonical (`pkg:passport#default.authenticate`):
/// the package, the export, and the members read off the export's result. `default`
/// before a member is the default import (`passport.authenticate`), so the member is
/// the export.
pub fn export_of(canonical: &str) -> Option<(&str, &str, Vec<&str>)> {
    let (package, path) = canonical.strip_prefix("pkg:")?.split_once('#')?;
    let mut segments: Vec<&str> = path.split('.').collect();
    if segments.len() > 1 && segments[0] == "default" {
        segments.remove(0);
    }
    let export = segments.first()?.trim_end_matches("()");
    let chain = segments[1..]
        .iter()
        .map(|s| s.trim_end_matches("()"))
        .collect();
    Some((package, export, chain))
}

fn package_is(listed: &str, package: &str) -> bool {
    match listed.strip_suffix('/') {
        // `@clerk/`: every package of the scope.
        Some(_) => package.starts_with(listed),
        None => package == listed,
    }
}

/// What the lists say of a package's export standing at a guard position, as it is
/// called there (`call`), or referenced with no call.
pub fn library(canonical: &str, call: Option<&GuardCall>) -> Library {
    let Some((package, export, chain)) = export_of(canonical) else {
        return Library::Unlisted;
    };
    let calls: Calls = call.map_or(&[], |c| c.args.as_slice());
    if let Some(g) = LIBRARY_GUARDS
        .iter()
        .find(|g| package_is(g.package, package) && guard_export(g, export, &chain))
    {
        // Clerk's `protect` is a member of what `auth` or `auth()` gives.
        if g.package.ends_with('/') {
            return (g.read)(&[], calls);
        }
        return (g.read)(&chain, calls);
    }
    if let Some(c) = COMBINATORS
        .iter()
        .find(|c| c.package == package && c.export == export)
    {
        return (c.read)(&chain, calls);
    }
    if never_authenticates(package, export) {
        return Library::Never;
    }
    Library::Unlisted
}

/// The export is a library's own guard ([`LIBRARY_GUARDS`]), whatever shape it is
/// called in: what [`library`] reads the shape of. No combinator, no member of a
/// Fastify instance ([`listed_guard`] names those too).
pub fn library_guard_export(canonical: &str) -> bool {
    export_of(canonical).is_some_and(|(package, export, chain)| {
        LIBRARY_GUARDS
            .iter()
            .any(|g| package_is(g.package, package) && guard_export(g, export, &chain))
    })
}

fn guard_export(g: &LibraryGuard, export: &str, chain: &[&str]) -> bool {
    if g.package.ends_with('/') {
        // `auth.protect`, `auth().protect`.
        return chain.last().is_some_and(|m| *m == g.export) || export == g.export;
    }
    g.export == export
}

/// The export is on [`NEVER_AUTHENTICATES`].
pub fn never_authenticates(package: &str, export: &str) -> bool {
    NEVER_AUTHENTICATES
        .iter()
        .any(|(p, e)| *p == package && (e.is_empty() || *e == export))
}

/// What the lists say of the member `name` of a Fastify instance
/// ([`FASTIFY_MEMBER`]) where no decoration of the repository is read for it:
/// a library's decorator where the package depends on the library (`depends`),
/// anything else unlisted.
pub fn fastify_decorator(
    name: &str,
    call: Option<&GuardCall>,
    depends: &dyn Fn(&str) -> bool,
) -> Library {
    let calls: Calls = call.map_or(&[], |c| c.args.as_slice());
    match FASTIFY_DECORATORS
        .iter()
        .find(|d| d.name == name && depends(d.package))
    {
        Some(d) => (d.read)(calls),
        None => Library::Unlisted,
    }
}

/// `canonical` names an export of [`LIBRARY_GUARDS`] or [`COMBINATORS`], or a member
/// of a Fastify instance on [`FASTIFY_DECORATORS`] that guards, whatever shape it is
/// called in: what a position's reading can name as the instrument that proves a
/// guard.
pub fn listed_guard(canonical: &str) -> bool {
    if let Some(name) = canonical.strip_prefix(FASTIFY_MEMBER) {
        return FASTIFY_DECORATORS
            .iter()
            .any(|d| d.name == name && !matches!((d.read)(&[]), Library::Never));
    }
    // An instrument is written under its package's root (`pkg:hono#jwt` for
    // `hono/jwt`): the export names the entry.
    export_of(canonical).is_some_and(|(package, export, chain)| {
        let same = |listed: &str| {
            package_is(listed, package) || package_root(listed) == package_root(package)
        };
        LIBRARY_GUARDS
            .iter()
            .any(|g| same(g.package) && guard_export(g, export, &chain))
            || COMBINATORS
                .iter()
                .any(|c| same(c.package) && c.export == export)
    })
}

/// The package a module belongs to: `hono` of `hono/jwt`, `@clerk/nextjs` of
/// `@clerk/nextjs/server`.
fn package_root(module: &str) -> &str {
    let mut parts = module.splitn(3, '/');
    let first = parts.next().unwrap_or_default();
    if first.starts_with('@') {
        match parts.next() {
            Some(second) => &module[..first.len() + 1 + second.len()],
            None => first,
        }
    } else {
        first
    }
}

/// The lowering records the shape of every call of an export of this module
/// (`import ... from "<spec>"`): one of [`LIBRARY_GUARDS`] or [`COMBINATORS`].
pub fn shaped(spec: &str) -> bool {
    LIBRARY_GUARDS.iter().any(|g| package_is(g.package, spec))
        || COMBINATORS.iter().any(|c| c.package == spec)
}

// ---- the shapes --------------------------------------------------------------------

/// An object literal with no spread whose keys are all in `allowed`: its properties.
fn object<'a>(a: &'a CallArg, allowed: &[&str]) -> Option<&'a [(String, CallArg)]> {
    let CallArg::Object(props) = a else {
        return None;
    };
    props
        .iter()
        .all(|(k, _)| allowed.contains(&k.as_str()))
        .then_some(props.as_slice())
}

fn prop<'a>(props: &'a [(String, CallArg)], key: &str) -> Option<&'a CallArg> {
    // The last writer wins, as JavaScript builds the object.
    props.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// A strategy name, or a list of them, none `anonymous`.
fn strategies(a: &CallArg) -> bool {
    let named = |a: &CallArg| matches!(a, CallArg::Text(t) if t != "anonymous" && !t.is_empty());
    match a {
        CallArg::List(names) => !names.is_empty() && names.iter().all(named),
        other => named(other),
    }
}

const PASSPORT_OPTIONS: &[&str] = &[
    "session",
    "failWithError",
    "failureRedirect",
    "failureMessage",
    "failureFlash",
    "scope",
    "state",
];

fn passport_authenticate(chain: &[&str], calls: Calls) -> Library {
    let ([], [args]) = (chain, calls) else {
        return Library::Unread;
    };
    match args.as_slice() {
        [strategy] if strategies(strategy) => Library::Guard,
        [strategy, options]
            if strategies(strategy) && object(options, PASSPORT_OPTIONS).is_some() =>
        {
            Library::Guard
        }
        _ => Library::Unread,
    }
}

/// A flag that makes the guard optional where it is the literal `off`: absent or
/// the other literal, the guard; anything else, not read.
fn required(props: &[(String, CallArg)], key: &str, off: bool) -> Library {
    match prop(props, key) {
        None => Library::Guard,
        Some(CallArg::Bool(b)) if *b == off => Library::Optional,
        Some(CallArg::Bool(_)) => Library::Guard,
        Some(_) => Library::Unread,
    }
}

fn express_jwt(chain: &[&str], calls: Calls) -> Library {
    let ([], [args]) = (chain, calls) else {
        return Library::Unread;
    };
    let [options] = args.as_slice() else {
        return Library::Unread;
    };
    match object(
        options,
        &[
            "secret",
            "algorithms",
            "audience",
            "issuer",
            "requestProperty",
            "getToken",
            "isRevoked",
            "credentialsRequired",
        ],
    ) {
        Some(props) => required(props, "credentialsRequired", false),
        None => Library::Unread,
    }
}

fn oauth2_bearer_auth(chain: &[&str], calls: Calls) -> Library {
    let ([], [args]) = (chain, calls) else {
        return Library::Unread;
    };
    match args.as_slice() {
        [] => Library::Guard,
        [options] => match object(
            options,
            &[
                "audience",
                "issuerBaseURL",
                "issuer",
                "jwksUri",
                "secret",
                "tokenSigningAlg",
                "authRequired",
            ],
        ) {
            Some(props) => required(props, "authRequired", false),
            None => Library::Unread,
        },
        _ => Library::Unread,
    }
}

fn no_arguments(chain: &[&str], calls: Calls) -> Library {
    match (chain, calls) {
        ([], [args]) if args.is_empty() => Library::Guard,
        _ => Library::Unread,
    }
}

fn one_object(chain: &[&str], calls: Calls, allowed: &[&str]) -> Library {
    match (chain, calls) {
        ([], [args]) => match args.as_slice() {
            [options] if object(options, allowed).is_some_and(|p| !p.is_empty()) => Library::Guard,
            _ => Library::Unread,
        },
        _ => Library::Unread,
    }
}

fn hono_basic_auth(chain: &[&str], calls: Calls) -> Library {
    let allowed = &[
        "username",
        "password",
        "verifyUser",
        "realm",
        "hashFunction",
    ];
    match (chain, calls) {
        ([], [args])
            if !args.is_empty()
                && args
                    .iter()
                    .all(|a| object(a, allowed).is_some_and(|p| !p.is_empty())) =>
        {
            Library::Guard
        }
        _ => Library::Unread,
    }
}

fn nest_auth_guard(chain: &[&str], calls: Calls) -> Library {
    let ([], [args]) = (chain, calls) else {
        return Library::Unread;
    };
    match args.as_slice() {
        [] => Library::Guard,
        [strategy] if strategies(strategy) => Library::Guard,
        _ => Library::Unread,
    }
}

fn next_with_auth(chain: &[&str], calls: Calls) -> Library {
    let options = |a: &CallArg| object(a, &["pages", "secret"]).is_some();
    match (chain, calls) {
        // Re-exported as the middleware itself.
        ([], []) => Library::Guard,
        ([], [args]) => match args.as_slice() {
            [] | [CallArg::Function] => Library::Guard,
            [o] if options(o) => Library::Guard,
            [CallArg::Function, o] if options(o) => Library::Guard,
            _ => Library::Unread,
        },
        _ => Library::Unread,
    }
}

/// A hook given by reference: a call of it is not understood.
fn bare(calls: Calls) -> Library {
    if calls.is_empty() {
        Library::Guard
    } else {
        Library::Unread
    }
}

fn fastify_auth(calls: Calls) -> Library {
    let [args] = calls else {
        return Library::Unread;
    };
    let (functions, options) = match args.as_slice() {
        [CallArg::List(f)] => (f, None),
        [CallArg::List(f), o] => (f, Some(o)),
        _ => return Library::Unread,
    };
    if functions.is_empty() || functions.iter().any(|f| matches!(f, CallArg::List(_))) {
        return Library::Unread;
    }
    let relation = match options {
        None => Relation::Any,
        Some(o) => match object(o, &["relation", "run"]) {
            None => return Library::Unread,
            Some(props) => match prop(props, "relation") {
                None => Relation::Any,
                Some(CallArg::Text(t)) if t == "or" => Relation::Any,
                Some(CallArg::Text(t)) if t == "and" => Relation::All,
                Some(_) => return Library::Unread,
            },
        },
    };
    Library::Combines(relation, functions.clone())
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_signature_verifier_is_known_by_its_package_and_call_shape() {
        let label = |c: &str| super::signature_verifier(c).map(|v| (v.label, v.throws));
        assert_eq!(
            label("pkg:svix#webhooks.Webhook().verify"),
            Some(("svix Webhook.verify", true))
        );
        assert_eq!(
            label("pkg:svix#Webhook(new).verify"),
            Some(("svix Webhook.verify", true))
        );
        assert_eq!(
            label("pkg:stripe#Webhook.construct_event"),
            Some(("Stripe Webhook.construct_event", true))
        );
        assert_eq!(
            label("pkg:slack_sdk#signature.SignatureVerifier().is_valid_request"),
            Some(("Slack SignatureVerifier.is_valid_request", false))
        );
        // Another class's `verify`, another package's `Webhook`, the constructor alone.
        assert_eq!(label("pkg:svix#webhooks.Webhook().sign"), None);
        assert_eq!(label("pkg:acme#Webhook().verify"), None);
        assert_eq!(label("pkg:svix#webhooks.Webhook"), None);
        assert_eq!(label("pkg:svix#MyWebhook().verify"), None);
        assert_eq!(label("app/hooks.py#Webhook().verify"), None);
    }

    use super::*;

    fn text(t: &str) -> CallArg {
        CallArg::Text(t.to_string())
    }

    fn obj(props: &[(&str, CallArg)]) -> CallArg {
        CallArg::Object(
            props
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
        )
    }

    fn call(callee: &str, args: Vec<Vec<CallArg>>) -> GuardCall {
        GuardCall {
            callee: callee.to_string(),
            args,
        }
    }

    fn read(callee: &str, args: Vec<Vec<CallArg>>) -> Library {
        library(callee, Some(&call(callee, args)))
    }

    #[test]
    fn passport_is_a_guard_only_in_the_listed_shapes() {
        let p = "pkg:passport#default.authenticate";
        assert_eq!(read(p, vec![vec![text("jwt")]]), Library::Guard);
        assert_eq!(
            read(
                p,
                vec![vec![text("jwt"), obj(&[("session", CallArg::Bool(false))])]]
            ),
            Library::Guard
        );
        assert_eq!(
            read(
                p,
                vec![vec![CallArg::List(vec![text("jwt"), text("basic")])]]
            ),
            Library::Guard
        );
        for unread in [
            vec![vec![CallArg::List(vec![text("jwt"), text("anonymous")])]],
            vec![vec![text("anonymous")]],
            vec![vec![CallArg::Unread]],
            vec![vec![text("jwt"), obj(&[("optional", CallArg::Bool(true))])]],
            vec![vec![text("jwt"), obj(&[("...", CallArg::Spread)])]],
            vec![vec![text("jwt"), obj(&[]), CallArg::Function]],
            vec![vec![text("jwt"), CallArg::Function]],
            vec![vec![]],
        ] {
            assert_eq!(read(p, unread.clone()), Library::Unread, "{unread:?}");
        }
        // A bare reference is no call of it.
        assert_eq!(library(p, None), Library::Unread);
        assert_eq!(
            library("pkg:passport#default.initialize", None),
            Library::Never
        );
    }

    #[test]
    fn an_option_that_lets_a_request_without_identity_through_is_optional() {
        let secret = ("secret", CallArg::Unread);
        let e = "pkg:express-jwt#expressjwt";
        assert_eq!(
            read(e, vec![vec![obj(std::slice::from_ref(&secret))]]),
            Library::Guard
        );
        assert_eq!(
            read(
                e,
                vec![vec![obj(&[
                    secret.clone(),
                    ("credentialsRequired", CallArg::Bool(false))
                ])]]
            ),
            Library::Optional
        );
        assert_eq!(
            read(
                e,
                vec![vec![obj(&[
                    secret.clone(),
                    ("credentialsRequired", CallArg::Unread)
                ])]]
            ),
            Library::Unread
        );
        // `.unless(...)`.
        assert_eq!(
            read(
                "pkg:express-jwt#expressjwt().unless",
                vec![
                    vec![obj(&[secret])],
                    vec![obj(&[("path", CallArg::Unread)])]
                ]
            ),
            Library::Unread
        );
        let a = "pkg:express-oauth2-jwt-bearer#auth";
        assert_eq!(read(a, vec![vec![]]), Library::Guard);
        assert_eq!(
            read(
                a,
                vec![vec![obj(&[("authRequired", CallArg::Bool(false))])]]
            ),
            Library::Optional
        );
        assert_eq!(
            read(
                "pkg:express-oauth2-jwt-bearer#requiredScopes",
                vec![vec![text("read")]]
            ),
            Library::Unlisted
        );
    }

    #[test]
    fn what_is_on_no_list_is_unlisted_and_the_never_list_is_closed() {
        assert_eq!(library("pkg:@acme/sso#sso", None), Library::Unlisted);
        assert_eq!(read("pkg:helmet#default", vec![vec![]]), Library::Never);
        assert_eq!(
            read("pkg:express#default.json", vec![vec![]]),
            Library::Never
        );
        assert_eq!(
            read("pkg:express#default.Router", vec![vec![]]),
            Library::Unlisted
        );
        assert_eq!(
            read(
                "pkg:express-validator#body().isString",
                vec![vec![text("name")], vec![]]
            ),
            Library::Never
        );
    }

    #[test]
    fn combinators_hand_back_their_members() {
        let a = CallArg::Ref("src/auth.ts#verifyJwt".into());
        let b = CallArg::Ref("src/auth.ts#verifyKey".into());
        let depends = |p: &str| p == "@fastify/auth";
        let auth = |args: Vec<CallArg>| {
            fastify_decorator(
                "auth",
                Some(&call("global#fastify.auth", vec![args])),
                &depends,
            )
        };
        assert_eq!(
            auth(vec![CallArg::List(vec![a.clone(), b.clone()])]),
            Library::Combines(Relation::Any, vec![a.clone(), b.clone()])
        );
        assert_eq!(
            auth(vec![
                CallArg::List(vec![a.clone(), b.clone()]),
                obj(&[("relation", text("and"))])
            ]),
            Library::Combines(Relation::All, vec![a.clone(), b.clone()])
        );
        assert_eq!(
            auth(vec![
                CallArg::List(vec![a.clone()]),
                obj(&[("relation", CallArg::Unread)])
            ]),
            Library::Unread
        );
        assert_eq!(
            auth(vec![CallArg::List(vec![
                CallArg::List(vec![a.clone()]),
                b.clone()
            ])]),
            Library::Unread
        );
        // Without the dependency the member is the repository's own, or unknown.
        assert_eq!(
            fastify_decorator("auth", None, &|_| false),
            Library::Unlisted
        );
        assert_eq!(
            read("pkg:hono/combine#some", vec![vec![a.clone(), b.clone()]]),
            Library::Combines(Relation::Any, vec![a.clone(), b])
        );
        assert_eq!(
            read("pkg:express-async-handler#default", vec![vec![a.clone()]]),
            Library::Combines(Relation::All, vec![a])
        );
    }

    #[test]
    fn only_the_runtimes_own_names_are_nothing_among_globals() {
        assert!(runtime("global#console.log"));
        assert!(runtime("global#Promise.resolve().catch"));
        assert!(!runtime("global#requireAuth"));
        assert!(!runtime("global#a guard chosen by a condition"));
        assert!(!runtime("pkg:console#log"));
    }

    #[test]
    fn an_instrument_names_a_listed_guard_under_its_module_or_its_package() {
        for i in [
            "pkg:hono/jwt#jwt",
            "pkg:hono#jwt",
            "pkg:passport#default.authenticate",
            "pkg:@clerk/nextjs#auth().protect",
            "global#fastify.basicAuth",
            "global#fastify.auth",
        ] {
            assert!(listed_guard(i), "{i}");
        }
        for i in [
            "pkg:hono#cors",
            "pkg:@acme/sso#sso",
            "global#fastify.rateLimit",
            "global#fastify.verifySso",
            "src/auth.ts#requireUser",
        ] {
            assert!(!listed_guard(i), "{i}");
        }
    }

    #[test]
    fn shaped_packages_are_those_of_the_guard_and_combinator_lists() {
        for spec in [
            "passport",
            "hono/jwt",
            "@clerk/nextjs/server",
            "hono/combine",
        ] {
            assert!(shaped(spec), "{spec}");
        }
        for spec in ["helmet", "express", "./auth", "@acme/sso"] {
            assert!(!shaped(spec), "{spec}");
        }
    }
}
