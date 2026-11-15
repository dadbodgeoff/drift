//! The practice vocabularies (PLAN-R13 §1): library tables as `*_LIBRARIES` /
//! `*_CALLEES` consts, one group per concern. The vocab test forbids `const *_WORDS`
//! outside `vocab.rs`. Groups that [`crate::mine::LIBRARY_GROUPS`] already holds
//! (logging, validation, database) are read from there and only extended here; auth
//! guards are [`crate::security::library_guard`]'s, and the tables below only name the
//! session readers and libraries around them.
//!
//! Package names are the roots [`super::common::package_root`] gives: npm names
//! (`@clerk/nextjs`) and the first segment of a Python module (`sqlalchemy`).

/// The members of a [`crate::mine::LIBRARY_GROUPS`] group.
pub fn group(name: &str) -> &'static [&'static str] {
    crate::mine::LIBRARY_GROUPS
        .iter()
        .find(|(g, _)| *g == name)
        .map_or(&[], |(_, m)| m)
}

/// `package` is one of `extra` or of the [`crate::mine::LIBRARY_GROUPS`] group.
fn in_group(package: &str, group_name: &str, extra: &[&str]) -> bool {
    extra.contains(&package) || group(group_name).contains(&package)
}

/// A package (or a package prefix ending in `/`) of the list.
fn listed(package: &str, list: &[&str]) -> bool {
    list.iter().any(|l| {
        if let Some(prefix) = l.strip_suffix('/') {
            package.starts_with(prefix) && package[prefix.len()..].starts_with('/')
        } else {
            package == *l
        }
    })
}

/// The name part of a reference ends with `path` at a segment boundary
/// (`lib/s.ts#supabase.auth.getUser` ends with `auth.getUser`). A step of the reference
/// that builds or calls its receiver is that receiver's segment: a method called on an
/// object built in place is the class's method, so `Webhook(new).verify` (TypeScript's
/// `new Webhook(secret).verify(..)`) and `webhooks.Webhook().verify` (Python's
/// `Webhook(secret).verify(..)`) end with `Webhook.verify`.
pub fn ends_with_path(r: &str, path: &str) -> bool {
    let name = super::common::short(r).trim_end_matches("(new)");
    let name = if name.contains(").") {
        std::borrow::Cow::Owned(name.replace("(new).", ".").replace("().", "."))
    } else {
        std::borrow::Cow::Borrowed(name)
    };
    *name == *path
        || name
            .strip_suffix(path)
            .is_some_and(|rest| rest.ends_with('.'))
}

// ---------- authn (PLAN-R13 §1.1) ----------

/// Authentication libraries: a wrapper or decorator from one of them that
/// [`crate::security::library_guard`] does not know is unclassified, never ignored.
pub const AUTHN_LIBRARIES: &[&str] = &[
    "@auth/core",
    "@auth/express",
    "@auth/sveltekit",
    "@auth0/nextjs-auth0",
    "@clerk/",
    "@fastify/jwt",
    "@fastify/passport",
    "@kinde-oss/kinde-auth-nextjs",
    "@nestjs/jwt",
    "@nestjs/passport",
    "@supabase/auth-helpers-nextjs",
    "@supabase/ssr",
    "better-auth",
    "express-jwt",
    "express-oauth2-jwt-bearer",
    "express-openid-connect",
    "firebase-admin",
    "iron-session",
    "jose",
    "jsonwebtoken",
    "lucia",
    "next-auth",
    "passport",
    "authlib",
    "fastapi_users",
    "flask_httpauth",
    "flask_jwt_extended",
    "flask_login",
    "jwt",
    "rest_framework_simplejwt",
];

/// Calls that read who the caller is, by the path after `#` (any receiver): with a
/// check on what they return they authenticate (Clerk `auth()` / `currentUser()`,
/// NextAuth `getServerSession`, Supabase `auth.getUser`, Lucia `validateRequest`,
/// better-auth `auth.api.getSession`, iron-session `getIronSession`).
pub const AUTHN_CALLEES: &[&str] = &[
    "auth",
    "currentUser",
    "getAuth",
    "getServerSession",
    "getSession",
    "auth.getUser",
    "auth.getSession",
    "api.getSession",
    "validateRequest",
    "getIronSession",
    "getUser",
    "verifyIdToken",
    "jwt.verify",
    "verify",
    "decode",
    "jwtVerify",
];

/// Webhook verifiers that throw on a bad signature (Stripe `constructEvent`, svix
/// `Webhook.verify`, Octokit `webhooks.verify`, Python `stripe.Webhook.construct_event`):
/// calling one authenticates the sending service.
pub const SIGNATURE_CALLEES: &[&str] = &[
    "webhooks.constructEvent",
    "webhooks.constructEventAsync",
    "Webhook.verify",
    "Webhooks.verify",
    "webhooks.verify",
    "verifySignature",
    "verify_signature",
    "construct_event",
    "Webhook.construct_event",
];

/// Constant-time compares a service secret is checked with (`crypto.timingSafeEqual`,
/// `hmac.compare_digest`): a verifier only as the source of a check against an env
/// value.
pub const COMPARE_CALLEES: &[&str] = &["timingSafeEqual", "compare_digest"];

/// A session-reading callee of [`AUTHN_CALLEES`] from an auth library, or any receiver's
/// method path of the list on an in-repo client (`supabase.auth.getUser`).
pub fn authn_callee(r: &str) -> bool {
    let from_auth_lib = super::common::package_root(r).is_some_and(|p| listed(&p, AUTHN_LIBRARIES));
    let in_repo = !super::common::external(r);
    AUTHN_CALLEES
        .iter()
        .any(|p| ends_with_path(r, p) && (from_auth_lib || (in_repo && p.contains('.'))))
}

/// A webhook verifier that throws on a bad signature ([`SIGNATURE_CALLEES`]).
pub fn signature_callee(r: &str) -> bool {
    SIGNATURE_CALLEES.iter().any(|p| ends_with_path(r, p))
}

/// A verifier a check's source can be: [`SIGNATURE_CALLEES`] or [`COMPARE_CALLEES`].
pub fn verifier_callee(r: &str) -> bool {
    signature_callee(r) || COMPARE_CALLEES.iter().any(|p| ends_with_path(r, p))
}

/// Words of an in-repo check's name that say it verifies a service, not a user: a
/// signature or a shared secret (`verifyQstashSignature`, `checkCronSecret`). Only for
/// a check that rejects ([`crate::security::authenticates`]).
pub const SERVICE_CHECK_NAMES: &[&str] = &["signature", "hmac", "webhook", "secret"];

/// Middleware matcher bindings that list routes left open (Clerk `isPublicRoute`):
/// a route they match is public, not covered. Matched on the binding's lower-cased name.
pub const PUBLIC_MATCHER_NAMES: &[&str] = &["public", "ignored", "unprotected", "open"];
/// Bindings that list the routes the middleware protects (`isProtectedRoute`).
pub const PROTECTED_MATCHER_NAMES: &[&str] =
    &["protected", "private", "secure", "authed", "authenticated"];

/// Guards that limit rate, not who may call, by package.
pub const NOT_AUTH_GUARD_LIBRARIES: &[&str] = &["@nestjs/throttler", "nestjs-throttler"];
/// ... and by a word of their name (`CustomThrottlerGuard`): a name may veto.
pub const NOT_AUTH_GUARD_NAMES: &[&str] = &["throttler", "throttle", "ratelimit", "limiter"];

/// Words of a metadata decorator's name that declare a route public.
pub const PUBLIC_DECORATOR_NAMES: &[&str] = &[
    "public",
    "anonymous",
    "unauthenticated",
    "unprotected",
    "guest",
];

/// Paths a load balancer or orchestrator polls to learn whether a process is up or
/// ready (Kubernetes' `livez` / `readyz` / `healthz`, the plain `/health` an ALB target
/// group is given, and its `live` / `ready` split). A probe has to answer a caller that
/// holds no credentials, so a `GET` on one of these, exactly or as the last segments
/// under a mount prefix (`/billing/health`), whose handler provably reads no request
/// input, is public on purpose. Keep the list to paths that mean nothing else: `/status`,
/// `/ping`, `/metrics` and `/info` also name routes that report data, so they are not here.
pub const PROBE_PATHS: &[&str] = &[
    "/health",
    "/healthz",
    "/livez",
    "/readyz",
    "/health/live",
    "/health/ready",
];

/// Whether `route` is a probe path ([`PROBE_PATHS`]), alone or under a mount prefix. A
/// trailing slash is ignored; a probe path starts with `/`, so a suffix match is always
/// on a segment boundary (`/api/health`, never `/apihealth`).
pub fn probe_path(route: &str) -> bool {
    let route = match route.trim_end_matches('/') {
        "" => return false,
        r => r,
    };
    PROBE_PATHS.iter().any(|p| route.ends_with(p))
}

// ---------- authz (PLAN-R13 §1.2) ----------

pub use drift_core::practice::POLICY_LIBRARIES;

/// Library guards that check a role or permission, not only that the caller is
/// signed in, by name after `#` (Django, DRF object permissions).
pub const ROLE_GUARD_CALLEES: &[&str] = &[
    "permission_required",
    "staff_member_required",
    "user_passes_test",
    "PermissionRequiredMixin",
    "UserPassesTestMixin",
    "IsAdminUser",
    "DjangoModelPermissions",
    "DjangoObjectPermissions",
    "DjangoModelPermissionsOrAnonReadOnly",
];

/// DRF permissions that only ask for a signed-in caller (no role).
pub const SIGNED_IN_ONLY_CALLEES: &[&str] =
    &["IsAuthenticated", "IsAuthenticatedOrReadOnly", "AllowAny"];

/// Words of a checked value or a wrapper name that say role or permission
/// (`.user.role`, `isAdmin`, `adminProcedure`, `RolesGuard`).
pub const ROLE_KEYS: &[&str] = &[
    "role",
    "roles",
    "permission",
    "permissions",
    "admin",
    "admins",
    "staff",
    "superuser",
    "scopes",
    "ability",
    "privilege",
    "privileges",
    "owner",
];

/// Words of a header, claim, route parameter or query key that name a tenant
/// (`x-org-id`, `.orgId`, `{workspace_id}`, `where.organizationId`).
pub const TENANT_KEYS: &[&str] = &[
    "org",
    "orgs",
    "organization",
    "organisation",
    "organizations",
    "workspace",
    "workspaces",
    "tenant",
    "tenants",
    "team",
    "teams",
    "account",
    "accounts",
];

/// Query keys and checked values that name the row's owner, as whole identifiers
/// with `_` removed and lower-cased (`userId`, `owner_id`, `created_by`): object-level
/// authorization by owner. Never a word of a longer name (`created_at`).
pub const OWNER_KEYS: &[&str] = &[
    "user",
    "userid",
    "users",
    "owner",
    "ownerid",
    "author",
    "authorid",
    "creator",
    "creatorid",
    "createdby",
    "createdbyid",
    "uploadedby",
    "uploadedbyid",
    "uploader",
    "member",
    "memberid",
];

/// First words of a check function's name that say it decides access
/// (`canEdit`, `may_configure`, `ensureAccess`, `assertCanManage`).
pub const PERMISSION_VERBS: &[&str] = &[
    "can",
    "may",
    "ensure",
    "assert",
    "require",
    "check",
    "verify",
    "authorize",
    "authorise",
];

/// Words of a function's name that make it a question about access, where its answer
/// decides a 403 (`ownsWorkspace`, `callerCanOpenWorkspace`, `hasTeamAccess`,
/// `isOrgAdmin`, `belongsToOrg`): with a tenant or a role word, what the 403 is for.
pub const ACCESS_PREDICATES: &[&str] = &[
    "can", "may", "owns", "own", "has", "is", "belongs", "allowed", "member", "access",
];

/// Libraries that send an HTTP request to another service, by package (`fetch` is a
/// global): a body that calls one may hand the request, and its authorization, on.
pub const HTTP_CLIENT_LIBRARIES: &[&str] = &[
    "axios",
    "got",
    "ky",
    "node-fetch",
    "undici",
    "superagent",
    "httpx",
    "requests",
    "aiohttp",
    "urllib3",
];

/// First segments of a query argument key that are not a filter (`select.userId`,
/// `data.orgId`).
pub const NOT_FILTER_KEYS: &[&str] = &[
    "select", "include", "orderBy", "order_by", "data", "create", "update", "omit", "_count",
    "distinct", "skip", "take", "cursor", "defaults",
];

/// A name with an [`OWNER_KEYS`] word.
pub fn names_owner(s: &str) -> bool {
    // The whole identifier, not a word of it: `created_by`, `user_id`, `ownerId`, never
    // `created_at__gte`. Of a member path or query key, the last member; of a Django
    // lookup, the field before it (`created_by__id`, `user__in`).
    let last = s.rsplit('.').next().unwrap_or(s);
    let field = last.split("__").next().unwrap_or(last);
    let id: String = field
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    OWNER_KEYS.contains(&id.as_str())
}

/// A function name that starts with a [`PERMISSION_VERBS`] word.
pub fn permission_verb(name: &str) -> bool {
    let last = name.rsplit('.').next().unwrap_or(name);
    key_words(last)
        .first()
        .is_some_and(|w| PERMISSION_VERBS.contains(&w.as_str()))
}

/// Lower-cased words of an identifier, header or member path.
pub fn key_words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .flat_map(crate::mine::words)
        .map(|w| w.to_ascii_lowercase())
        .collect()
}

/// A name with a [`TENANT_KEYS`] word.
pub fn names_tenant(s: &str) -> bool {
    key_words(s)
        .iter()
        .any(|w| TENANT_KEYS.contains(&w.as_str()))
}

/// A name with a [`ROLE_KEYS`] word.
pub fn names_role(s: &str) -> bool {
    key_words(s).iter().any(|w| ROLE_KEYS.contains(&w.as_str()))
}

// ---------- errors (PLAN-R13 §1.3) ----------

/// Packages whose thrown errors the framework turns into responses: HTTPException
/// (FastAPI, Starlette, Werkzeug), DRF exceptions, Django `Http404` /
/// `PermissionDenied`, Nest `*Exception`, `TRPCError`, `next/navigation#notFound`,
/// Boom, http-errors, h3, hono, SvelteKit.
pub const ERROR_LIBRARIES: &[&str] = &[
    "fastapi",
    "starlette",
    "werkzeug",
    "flask",
    "rest_framework",
    "django",
    "ninja",
    "litestar",
    "sanic",
    "@nestjs/common",
    "@trpc/server",
    "next",
    "@hapi/boom",
    "boom",
    "http-errors",
    "h3",
    "hono",
    "@sveltejs/kit",
    "@remix-run/node",
    "elysia",
];

/// Error reporters: a catch that calls one reports the error.
pub const ERROR_REPORT_LIBRARIES: &[&str] = &[
    "@sentry/",
    "sentry_sdk",
    "@bugsnag/",
    "bugsnag",
    "rollbar",
    "@honeybadger-io/",
    "honeybadger",
    "@highlight-run/",
    "@datadog/browser-rum",
];

/// A framework error class or helper (`pkg:fastapi#HTTPException`, `pkg:flask#abort`,
/// `pkg:@nestjs/common#NotFoundException(new)`).
pub fn framework_error(r: &str) -> bool {
    super::common::package_root(r).is_some_and(|p| listed(&p, ERROR_LIBRARIES))
        && !r.contains("#NextResponse")
}

pub fn error_reporter(r: &str) -> bool {
    super::common::package_root(r).is_some_and(|p| listed(&p, ERROR_REPORT_LIBRARIES))
}

// ---------- logging (PLAN-R13 §1.4) ----------

/// Logger libraries beyond [`crate::mine::LIBRARY_GROUPS`] `logging`.
pub const LOGGING_LIBRARIES: &[&str] = &[
    "nestjs-pino",
    "pino-http",
    "tslog",
    "log4js",
    "signale",
    "npmlog",
    "roarr",
    "@logtape/logtape",
    "logging",
    "structlog",
    "loguru",
    "logbook",
    "eliot",
];

/// Logger classes of frameworks, by reference (`@nestjs/common` `Logger`).
pub const LOGGER_CALLEES: &[&str] = &[
    "pkg:@nestjs/common#Logger",
    "pkg:@nestjs/common#ConsoleLogger",
    "pkg:fastify#log",
    "pkg:@sentry/node#logger",
];

/// Libraries whose level-named methods are no log calls (toasts, notifications).
pub const NOT_LOGGER_LIBRARIES: &[&str] = &[
    "sonner",
    "react-hot-toast",
    "react-toastify",
    "notistack",
    "@mantine/notifications",
    "antd",
    "@chakra-ui/react",
    "vscode",
    "ora",
    "chalk",
    "@clack/prompts",
    "inquirer",
];

/// Tracing and observability libraries an entry point can be traced with.
pub const TRACING_LIBRARIES: &[&str] = &[
    "@opentelemetry/",
    "opentelemetry",
    "dd-trace",
    "ddtrace",
    "logfire",
    "@sentry/",
    "sentry_sdk",
];

/// The logger library a reference is into: a [`LOGGING_LIBRARIES`] or
/// `LIBRARY_GROUPS` `logging` package, or a framework logger of [`LOGGER_CALLEES`].
pub fn logger_library(r: &str) -> Option<String> {
    let n = crate::mine::norm_ref(r);
    if let Some(l) = LOGGER_CALLEES
        .iter()
        .find(|l| n == **l || n.starts_with(&format!("{l}.")) || n.starts_with(&format!("{l}(")))
    {
        return Some(l.trim_start_matches("pkg:").to_string());
    }
    let p = super::common::package_root(r)?;
    in_group(&p, "logging", LOGGING_LIBRARIES).then_some(p)
}

pub fn not_logger(r: &str) -> bool {
    r.starts_with("global#Math.")
        || super::common::package_root(r).is_some_and(|p| listed(&p, NOT_LOGGER_LIBRARIES))
        || stdlib_not_logger(r)
}

/// A level-named call into Python's standard library that no logger answers. The
/// standard library is a closed set (the facts name its modules `pkg:python:<module>`)
/// and it defines its loggers in `logging` alone, so two kinds of callee in any other
/// module cannot be one:
/// - a function the module itself defines, called on no receiver (`math.log(x)`,
///   `cmath.log`, `warnings.warn`);
/// - a method of a class the module defines, called on the class or on an object built
///   from it (`argparse.ArgumentParser().error(..)`): the receiver is a class by its
///   name ([`super::common::class_name`]).
///
/// What a function of such a module returns, or a module holds, may still be a
/// `logging.Logger` (`multiprocessing.get_logger().info(..)`, `distutils.log.info(..)`):
/// that is not decided here, and stays unknown [STRICT]. A package outside the standard
/// library is never decided by this either (`numpy.log` is unclassified until a table
/// or a `practices:` line says what the package is).
fn stdlib_not_logger(r: &str) -> bool {
    let n = crate::mine::norm_ref(r);
    let Some((_, name)) = n
        .strip_prefix("pkg:")
        .and_then(|m| m.strip_prefix(super::common::PYTHON_STDLIB))
        .and_then(|m| m.split_once('#'))
    else {
        return false;
    };
    if logger_library(r).is_some() {
        return false;
    }
    match name.rsplit_once('.') {
        None => true,
        Some((receiver, _)) => {
            let last = receiver.rsplit('.').next().unwrap_or(receiver);
            super::common::class_name(last.strip_suffix("()").unwrap_or(last))
        }
    }
}

pub fn tracer(r: &str) -> bool {
    super::common::package_root(r).is_some_and(|p| listed(&p, TRACING_LIBRARIES))
}

// ---------- validation (PLAN-R13 §1.6) ----------

/// Validation libraries beyond [`crate::mine::LIBRARY_GROUPS`] `validation`.
pub const VALIDATION_LIBRARIES: &[&str] = &[
    "arktype",
    "@sinclair/typebox",
    "@effect/schema",
    "effect",
    "ajv",
    "io-ts",
    "runtypes",
    "class-validator",
    "pydantic",
    "marshmallow",
    "rest_framework",
    "cerberus",
    "voluptuous",
    "msgspec",
    "attrs",
    "wtforms",
    "flask_wtf",
    "ninja",
];

/// Typed-model libraries: input bound to a declared class (pydantic models, DRF
/// serializers, Nest DTOs with class-validator), not a schema value.
pub const TYPED_MODEL_LIBRARIES: &[&str] = &[
    "pydantic",
    "rest_framework",
    "class-validator",
    "marshmallow",
    "msgspec",
    "attrs",
    "wtforms",
    "flask_wtf",
    "ninja",
];

/// The validation library a reference is into.
pub fn validation_library(r: &str) -> Option<String> {
    let p = super::common::package_root(r)?;
    in_group(&p, "validation", VALIDATION_LIBRARIES).then_some(p)
}

/// Nest's `ValidationPipe`, which makes DTO decorators run.
pub const VALIDATION_PIPE_CALLEES: &[&str] = &["pkg:@nestjs/common#ValidationPipe"];

// ---------- config (PLAN-R13 §1.7) ----------

/// Env schema and config libraries (t3-env `createEnv`, envalid, `@nestjs/config`,
/// convict, pydantic-settings, Django settings, dynaconf, python-decouple, environs,
/// dotenv).
pub const CONFIG_LIBRARIES: &[&str] = &[
    "@t3-oss/env-nextjs",
    "@t3-oss/env-core",
    "@t3-oss/env-nuxt",
    "envalid",
    "@nestjs/config",
    "convict",
    "env-var",
    "znv",
    "dotenv",
    "dotenv-flow",
    "@dotenvx/dotenvx",
    "config",
    "pydantic_settings",
    "dynaconf",
    "decouple",
    "environs",
    "django",
];

/// Feature-flag SDKs (LaunchDarkly, Unleash, GrowthBook, Flagsmith, the Vercel `flags`
/// SDK, Statsig, OpenFeature, ConfigCat, Split).
pub const FLAG_LIBRARIES: &[&str] = &[
    "@launchdarkly/",
    "launchdarkly-node-server-sdk",
    "launchdarkly-js-client-sdk",
    "launchdarkly-react-client-sdk",
    "ldclient",
    "unleash-client",
    "@unleash/proxy-client-react",
    "UnleashClient",
    "@growthbook/growthbook",
    "@growthbook/growthbook-react",
    "growthbook",
    "flagsmith",
    "flagsmith-nodejs",
    "flags",
    "@vercel/flags",
    "statsig-node",
    "@statsig/",
    "statsig",
    "@openfeature/",
    "openfeature",
    "configcat-node",
    "configcat-js",
    "@splitsoftware/splitio",
];

/// PostHog's flag calls (the rest of PostHog is analytics).
pub const FLAG_CALLEES: &[&str] = &[
    "isFeatureEnabled",
    "getFeatureFlag",
    "getFeatureFlagPayload",
    "feature_enabled",
    "get_feature_flag",
    "useFeatureFlagEnabled",
];

/// The config library a reference is into. Django counts only for `django.conf`.
pub fn config_library(r: &str) -> Option<String> {
    let p = super::common::package_root(r)?;
    if p == "django" {
        return crate::mine::norm_ref(r)
            .contains("#conf.settings")
            .then_some(p);
    }
    listed(&p, CONFIG_LIBRARIES).then_some(p)
}

/// The flag SDK a reference is into.
pub fn flag_library(r: &str) -> Option<String> {
    let p = super::common::package_root(r)?;
    if listed(&p, FLAG_LIBRARIES) {
        return Some(p);
    }
    (p.starts_with("posthog") && FLAG_CALLEES.iter().any(|f| ends_with_path(r, f))).then_some(p)
}

/// Env names that name a secret (`STRIPE_SECRET_KEY`, `API_TOKEN`).
pub const SECRET_KEYS: &[&str] = &[
    "secret",
    "key",
    "token",
    "password",
    "passwd",
    "pwd",
    "credentials",
    "dsn",
];

/// Env names that switch a feature (`FEATURE_X`, `ENABLE_Y`, `X_ENABLED`).
pub const FLAG_ENV_KEYS: &[&str] = &[
    "feature", "flag", "enable", "enabled", "disable", "disabled",
];

fn env_words(name: &str) -> Vec<String> {
    name.split(|c: char| !c.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .collect()
}

/// Env name prefixes a bundler exposes to the browser by design (`NEXT_PUBLIC_`).
pub const PUBLIC_ENV_PREFIXES: &[&str] = &[
    "NEXT_PUBLIC_",
    "VITE_",
    "PUBLIC_",
    "EXPO_PUBLIC_",
    "REACT_APP_",
    "NUXT_PUBLIC_",
];

/// A secret-named env var that is not public by its prefix.
pub fn secret_env(name: &str) -> bool {
    !PUBLIC_ENV_PREFIXES.iter().any(|p| name.starts_with(p))
        && env_words(name)
            .iter()
            .any(|w| SECRET_KEYS.contains(&w.as_str()))
}

pub fn flag_env(name: &str) -> bool {
    env_words(name)
        .iter()
        .any(|w| FLAG_ENV_KEYS.contains(&w.as_str()))
}

// ---------- data access (PLAN-R13 §1.8) ----------

/// Database clients beyond [`crate::mine::LIBRARY_GROUPS`] `database`.
pub const DATA_LIBRARIES: &[&str] = &[
    "@supabase/supabase-js",
    "@supabase/ssr",
    "pg",
    "postgres",
    "mysql2",
    "mysql",
    "better-sqlite3",
    "sqlite3",
    "@neondatabase/serverless",
    "@planetscale/database",
    "@libsql/client",
    "@vercel/postgres",
    "mongodb",
    "@mikro-orm/core",
    "objection",
    "sqlalchemy",
    "sqlmodel",
    "psycopg",
    "psycopg2",
    "asyncpg",
    "aiosqlite",
    "pymongo",
    "motor",
    "peewee",
    "tortoise",
    "databases",
    "pony",
    "mongoengine",
    "beanie",
    "odmantic",
];

/// The database library a reference is into. Django counts for `django.db`.
pub fn data_library(r: &str) -> Option<String> {
    let p = super::common::package_root(r)?;
    if p == "django" {
        let n = crate::mine::norm_ref(r);
        return (n.contains("#db.") || DJANGO_QUERY_SHORTCUTS.iter().any(|q| n.contains(q)))
            .then_some(p);
    }
    in_group(&p, "database", DATA_LIBRARIES).then_some(p)
}

/// Django shortcuts that run a query (`get_object_or_404(Model, org=...)`).
pub const DJANGO_QUERY_SHORTCUTS: &[&str] =
    &["#shortcuts.get_object_or_404", "#shortcuts.get_list_or_404"];

/// Path segments of a module that holds data access (`repositories/`, `crud.py`).
pub const REPOSITORY_PATHS: &[&str] = &[
    "repo",
    "repos",
    "repository",
    "repositories",
    "crud",
    "dal",
    "dao",
    "daos",
    "db",
    "database",
    "store",
    "stores",
    "models",
    "queries",
    "query",
    "data",
    "persistence",
    "prisma",
    "drizzle",
];

/// Path segments of scripts and migrations.
pub const SCRIPT_PATHS: &[&str] = &[
    "scripts",
    "script",
    "bin",
    "migrations",
    "migration",
    "seed",
    "seeds",
    "seeders",
    "management",
    "commands",
    "tools",
];

// ---------- testing (PLAN-R13 §1.9) ----------

/// Test runners (vitest, jest, mocha, playwright, cypress, ava, `node:test`, pytest,
/// unittest, Django `TestCase`).
pub const TEST_LIBRARIES: &[&str] = &[
    "vitest",
    "jest",
    "@jest/globals",
    "mocha",
    "@playwright/test",
    "cypress",
    "ava",
    "node:test",
    "bun:test",
    "pytest",
    "unittest",
    "django",
];

/// The runner a test file's import names (`pkg:vitest` -> `vitest`); Django only for
/// `django.test`.
pub fn test_runner(module: &str) -> Option<String> {
    let m = module.strip_prefix("pkg:").unwrap_or(module);
    let m = m.strip_prefix(super::common::PYTHON_STDLIB).unwrap_or(m);
    let root = if m.starts_with('@') {
        m.splitn(3, '/').take(2).collect::<Vec<_>>().join("/")
    } else {
        m.split(['.', '/']).next().unwrap_or(m).to_string()
    };
    if root == "django" {
        return m.starts_with("django.test").then_some(root);
    }
    if root == "unittest" && m.starts_with("unittest.mock") {
        return None;
    }
    if m.starts_with("node:test") || m.starts_with("bun:test") {
        return Some(m.to_string());
    }
    TEST_LIBRARIES.contains(&root.as_str()).then_some(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_come_from_library_groups() {
        assert!(group("logging").contains(&"pino"));
        assert_eq!(logger_library("pkg:pino#default").as_deref(), Some("pino"));
        assert_eq!(
            logger_library("pkg:structlog#get_logger").as_deref(),
            Some("structlog")
        );
        assert_eq!(
            logger_library("pkg:@nestjs/common#Logger.error").as_deref(),
            Some("@nestjs/common#Logger")
        );
        assert_eq!(logger_library("pkg:@nestjs/common#Injectable"), None);
        assert_eq!(
            validation_library("pkg:zod#z.object").as_deref(),
            Some("zod")
        );
        assert_eq!(
            validation_library("pkg:pydantic.main#BaseModel").as_deref(),
            Some("pydantic")
        );
        assert_eq!(
            data_library("pkg:@prisma/client#PrismaClient(new)").as_deref(),
            Some("@prisma/client")
        );
        assert_eq!(
            data_library("pkg:sqlalchemy.orm#sessionmaker").as_deref(),
            Some("sqlalchemy")
        );
        assert_eq!(data_library("pkg:django#http.JsonResponse"), None);
        // No table duplicates a LIBRARY_GROUPS group.
        for (g, extra) in [
            ("logging", LOGGING_LIBRARIES),
            ("validation", VALIDATION_LIBRARIES),
            ("database", DATA_LIBRARIES),
        ] {
            for l in extra {
                assert!(!group(g).contains(l), "{l} is already in {g}");
            }
        }
    }

    #[test]
    fn callees_match_by_path() {
        assert!(authn_callee("pkg:@clerk/nextjs/server#auth"));
        assert!(authn_callee("pkg:@clerk/nextjs/server#currentUser"));
        assert!(authn_callee("pkg:next-auth/next#getServerSession"));
        assert!(authn_callee("lib/supabase.ts#supabase.auth.getUser"));
        assert!(!authn_callee("lib/db.ts#db.project.findFirst"));
        assert!(
            !authn_callee("lib/auth.ts#auth"),
            "an in-repo `auth` is read by usage"
        );
        assert!(signature_callee("pkg:stripe#webhooks.constructEvent"));
        assert!(!signature_callee("pkg:stripe#Charge.create"));
        assert!(signature_callee("pkg:stripe#Webhook.construct_event"));
        assert!(verifier_callee("pkg:crypto#timingSafeEqual"));
        assert!(verifier_callee("pkg:hmac#compare_digest"));
        assert!(!signature_callee("pkg:crypto#timingSafeEqual"));
        assert!(framework_error("pkg:fastapi#HTTPException"));
        assert!(framework_error("pkg:@nestjs/common#NotFoundException(new)"));
        assert!(!framework_error("pkg:next/server#NextResponse.json"));
        assert!(error_reporter("pkg:@sentry/nextjs#captureException"));
        assert!(not_logger("pkg:sonner#toast.error"));
        assert!(not_logger("global#Math.log"));
        assert_eq!(
            flag_library("pkg:posthog-node#PostHog.isFeatureEnabled").as_deref(),
            Some("posthog-node")
        );
        assert_eq!(flag_library("pkg:posthog-node#PostHog.capture"), None);
        assert_eq!(
            config_library("pkg:@t3-oss/env-nextjs#createEnv").as_deref(),
            Some("@t3-oss/env-nextjs")
        );
        assert_eq!(
            config_library("pkg:django#conf.settings.DEBUG").as_deref(),
            Some("django")
        );
        assert_eq!(config_library("pkg:django#db.models.Model"), None);
    }

    /// A method called on an object built in place is the class's method: the step
    /// that builds the receiver (`(new)`, Python's `()`) is that receiver's segment.
    #[test]
    fn a_path_matches_through_a_built_receiver() {
        // svix, as each language's facts name it.
        assert!(signature_callee("pkg:svix#Webhook(new).verify"));
        assert!(signature_callee("pkg:svix#webhooks.Webhook().verify"));
        assert!(signature_callee(
            "pkg:@octokit/webhooks#Webhooks(new).verify"
        ));
        assert!(signature_callee("pkg:svix#Webhook.verify"));
        assert!(ends_with_path(
            "lib/s.ts#createClient().auth.getUser",
            "auth.getUser"
        ));
        // Still on a segment boundary, and still the same method.
        assert!(!signature_callee("pkg:acme#MyWebhook().verify"));
        assert!(!signature_callee("pkg:svix#Webhook().sign"));
        assert!(!signature_callee("pkg:acme#Gate().verify"));
        assert!(!signature_callee("pkg:svix#Webhook(new)"));
        assert!(!ends_with_path("pkg:acme#verify().x", "verify"));
    }

    /// Python's standard library defines its loggers in `logging` alone: a function of
    /// another of its modules, and a method of a class another module defines, are no
    /// log calls. What such a module's function returns may be a logger, and a package
    /// outside the standard library is not decided here.
    #[test]
    fn the_standard_library_logs_only_through_logging() {
        for no in [
            "pkg:python:math#log",
            "pkg:python:cmath#log",
            "pkg:python:warnings#warn",
            "pkg:python:argparse#ArgumentParser().error",
            "pkg:python:argparse#ArgumentParser.error",
            "pkg:python:optparse#OptionParser().error",
        ] {
            assert!(not_logger(no), "{no}");
        }
        for maybe in [
            // The logging module itself, and what it builds.
            "pkg:python:logging#info",
            "pkg:python:logging#getLogger().info",
            "pkg:python:logging#Logger().warning",
            // What a function returns or a module holds may be a `logging.Logger`.
            "pkg:python:multiprocessing#get_logger().info",
            "pkg:python:distutils#log.info",
            "pkg:python:asyncio#log.logger.warning",
            // Not the standard library: a table or a `practices:` line decides.
            "pkg:numpy#log",
            "pkg:acme_cli#ArgumentParser().error",
            "svc/app/jobs.py#metrics.info",
        ] {
            assert!(!not_logger(maybe), "{maybe}");
        }
    }

    #[test]
    fn keys_name_tenants_roles_and_secrets() {
        assert!(names_tenant("x-org-id"));
        assert!(names_tenant(".user.orgId"));
        assert!(names_tenant("organization_id"));
        assert!(!names_tenant(".userId"));
        assert!(names_role(".user.role"));
        assert!(names_role("adminProcedure"));
        assert!(!names_role(".userId"));
        assert!(secret_env("STRIPE_SECRET_KEY"));
        assert!(!secret_env("NODE_ENV"));
        assert!(!secret_env("NEXT_PUBLIC_STRIPE_KEY"));
        assert!(flag_env("FEATURE_BILLING"));
    }

    #[test]
    fn runners_by_import() {
        assert_eq!(test_runner("pkg:vitest").as_deref(), Some("vitest"));
        assert_eq!(
            test_runner("pkg:@playwright/test").as_deref(),
            Some("@playwright/test")
        );
        assert_eq!(test_runner("pkg:django.test").as_deref(), Some("django"));
        assert_eq!(test_runner("pkg:django.db"), None);
        assert_eq!(test_runner("pkg:unittest.mock"), None);
        assert_eq!(test_runner("pkg:supertest"), None);
    }
}
