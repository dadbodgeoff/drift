//! Helpers the practice facts (facts schema 11) share between the parsers and mining:
//! the log-level table, the route and header shape checks, the status tables and the
//! caps. Both lowerings call these, so neither edits the other's crate and each table
//! is tested once.
//!
//! The string policy ([`crate::facts`]): besides counts, practice facts echo only
//! header names ([`valid_header`]), route patterns ([`valid_route`]) and numeric
//! status codes. Anything else is dropped.

/// Policy libraries: a call into one is a role or permission check (CASL
/// `ability.can`, casbin, oso, cerbos, permit.io). By package root: both lowerings keep
/// a conditional call into one ([`crate::facts::Symbol::conditional_calls`]), and
/// mining reads the call as the check.
pub const POLICY_LIBRARIES: &[&str] = &[
    "@casl/ability",
    "@casl/prisma",
    "casbin",
    "@cerbos/grpc",
    "@cerbos/http",
    "oso",
    "oso-cloud",
    "permitio",
    "accesscontrol",
    "cerbos",
    "casbin_sqlalchemy_adapter",
    "pycasbin",
    "django_rules",
    "rules",
    "guardian",
];

/// The reference is a call into a policy library ([`POLICY_LIBRARIES`]): `pkg:<root>...`
/// by its package root (`pkg:@casl/ability#...`, `pkg:casbin.enforcer#...`).
pub fn policy_call(canonical: &str) -> bool {
    let Some(module) = canonical
        .strip_prefix("pkg:")
        .and_then(|r| r.split_once('#'))
        .map(|(m, _)| m)
    else {
        return false;
    };
    let module = module.strip_prefix("python:").unwrap_or(module);
    POLICY_LIBRARIES.iter().any(|p| {
        module == *p
            || module
                .strip_prefix(p)
                .is_some_and(|rest| rest.starts_with(['.', '/']))
    })
}

/// Calls whose result, when called, runs what was looked up by name or bound at run
/// time: `getattr(service, operation)(...)`, `functools.partial(check, caller)(...)`,
/// `operator.methodcaller("check", caller)(service)`.
const DYNAMIC_CALLS: &[&str] = &[
    "global#getattr()",
    "pkg:python:functools#partial()",
    "pkg:python:operator#attrgetter()",
    "pkg:python:operator#methodcaller()",
];

/// Containers of a framework object that hold what the request sent, or plain
/// configuration: an element of one is a plain value.
const PLAIN_CONTAINERS: &[&str] = &[
    "COOKIES",
    "FILES",
    "GET",
    "META",
    "POST",
    "args",
    "argv",
    "body",
    "cookies",
    "data",
    "environ",
    "files",
    "form",
    "headers",
    "json",
    "params",
    "path_params",
    "query",
    "query_params",
    "session",
    "values",
    "view_args",
];

/// Attributes of Flask's application object that are Flask's own: any other
/// (`current_app.project_service`) is what the application stored there.
const FLASK_APP_ATTRS: &[&str] = &[
    "blueprints",
    "cli",
    "config",
    "debug",
    "extensions",
    "jinja_env",
    "json",
    "logger",
    "login_manager",
    "name",
    "session_interface",
    "testing",
    "url_map",
    "view_functions",
];

/// A canonical callee a package names and whose body is nonetheless the
/// repository's, or anyone's: a method of what the application stored in a
/// framework object's free-form place (an element of `current_app.extensions`, an
/// attribute of Flask's `g` or of `current_app`), a provider NestJS's container
/// looked up by its token, or the call of what a dynamic lookup handed back
/// ([`DYNAMIC_CALLS`]). The Python linker keeps such a receiver
/// call where it drops a package's, and a reader that asks "was everything this
/// body runs read" answers no for it.
pub fn unread_callee(canonical: &str) -> bool {
    if DYNAMIC_CALLS.iter().any(|d| {
        canonical
            .strip_prefix(d)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '(']))
    }) {
        return true;
    }
    let Some((module, path)) = canonical
        .strip_prefix("pkg:")
        .and_then(|r| r.split_once('#'))
    else {
        return false;
    };
    let segs: Vec<&str> = path.split('.').collect();
    if let Some(i) = segs.iter().position(|s| *s == "__getitem__()")
        && i >= 1
        && i + 1 < segs.len()
        && !PLAIN_CONTAINERS.contains(&segs[i - 1])
    {
        return true;
    }
    // What NestJS's container handed back for a token (`this.moduleRef.get(
    // RulesService).list(user)`, `app.get(Service).run()`): a provider of the
    // repository's, under the container's name.
    if module.starts_with("@nestjs/")
        && segs.len() >= 3
        && NEST_CONTAINERS.contains(&segs[0])
        && matches!(segs[1], "get()" | "resolve()" | "create()")
    {
        return true;
    }
    let flask = module == "flask" || module.starts_with("flask.") || module.starts_with("flask/");
    flask
        && segs.len() >= 3
        && (segs[0] == "g" || (segs[0] == "current_app" && !FLASK_APP_ATTRS.contains(&segs[1])))
}

/// NestJS types that look a provider up by its token ([`unread_callee`]).
const NEST_CONTAINERS: &[&str] = &[
    "ModuleRef",
    "INestApplication",
    "INestApplicationContext",
    "INestMicroservice",
    "NestApplication",
    "NestExpressApplication",
    "NestFastifyApplication",
];

/// Caps on the practice facts. Lowering collects each field into a sorted set and keeps
/// the first `N` after sorting; [`crate::facts::FileFacts::normalize`] enforces them again.
pub mod caps {
    /// [`crate::facts::Symbol::body_checks`].
    pub const BODY_CHECKS: usize = 16;
    /// [`crate::facts::Symbol::responses`].
    pub const RESPONSES: usize = 16;
    /// [`crate::facts::ResponseFact::keys`].
    pub const RESPONSE_KEYS: usize = 8;
    /// [`crate::facts::Symbol::log_calls`].
    pub const LOG_CALLS: usize = 32;
    /// [`crate::facts::Symbol::catches`].
    pub const CATCHES: usize = 16;
    /// [`crate::facts::Symbol::headers`].
    pub const HEADERS: usize = 16;
    /// [`crate::facts::Symbol::inputs`].
    pub const INPUTS: usize = 8;
    /// [`crate::facts::Symbol::handles_errors`].
    pub const HANDLES: usize = 8;
    /// [`crate::facts::Symbol::scoped_queries`].
    pub const SCOPED_QUERIES: usize = 8;
    /// [`crate::facts::BodyCheck::after`], [`crate::facts::RaiseCheck::after`].
    pub const CHECK_AFTER: usize = 16;
    /// [`crate::facts::Symbol::raise_checks`].
    pub const RAISE_CHECKS: usize = 16;
    /// [`crate::facts::FileFacts::test_requests`].
    pub const TEST_REQUESTS: usize = 256;
    /// [`crate::facts::FileFacts::outgoing`].
    pub const OUTGOING: usize = 128;
    /// [`crate::facts::FileFacts::mocks`].
    pub const MOCKS: usize = 64;
    /// [`crate::facts::FileFacts::route_matchers`].
    pub const MATCHERS: usize = 8;
    /// [`crate::facts::RouteMatcher::patterns`].
    pub const MATCHER_PATTERNS: usize = 64;
    /// [`crate::facts::Symbol::order`]: where both lowerings stop adding callees
    /// (their `MAX_ORDER`). They record no `truncated` entry for it, so a list this
    /// long may have been cut: the listed reading marks it so
    /// ([`crate::facts::RepoFacts::listed`]); what mining reads is left as it is.
    pub const ORDER: usize = 32;
}

/// Longest route pattern echoed ([`valid_route`]).
pub const MAX_ROUTE_LEN: usize = 120;
/// Longest header name echoed ([`valid_header`]).
pub const MAX_HEADER_LEN: usize = 64;
/// What a dynamic route segment becomes in [`normalize_route`].
pub const ANY_SEGMENT: &str = "[*]";
/// Prefix of a mock that is an MSW handler in [`crate::facts::FileFacts::mocks`]
/// (`msw:/api/x`); the rest is a route ([`valid_route`]).
pub const MSW_PREFIX: &str = "msw:";

/// Method name of a log call to its normalised level ([`crate::facts::LogCall::level`]).
/// The levels are `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `exception`, `log`
/// and `print`.
pub const LOG_LEVELS: &[(&str, &str)] = &[
    ("critical", "fatal"),
    ("debug", "debug"),
    ("error", "error"),
    ("exception", "exception"),
    ("fatal", "fatal"),
    ("info", "info"),
    ("log", "log"),
    ("print", "print"),
    ("trace", "trace"),
    ("warn", "warn"),
    ("warning", "warn"),
];

/// The level a log method name says (`warning` -> `warn`), or `None` when the name is
/// no log level.
pub fn normalize_level(method: &str) -> Option<&'static str> {
    LOG_LEVELS
        .iter()
        .find(|(m, _)| *m == method)
        .map(|(_, level)| *level)
}

/// A header name that may be echoed: `^[a-z0-9-]{1,64}$`.
pub fn valid_header(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_HEADER_LEN
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A route pattern that may be echoed: it starts with `/` (not `//`), is at most
/// [`MAX_ROUTE_LEN`] bytes, holds only `A-Za-z0-9_-./[]{}:*()+?`, and names no scheme
/// (`://`): a path, never a URL.
pub fn valid_route(s: &str) -> bool {
    s.starts_with('/')
        && !s.starts_with("//")
        && !s.contains("://")
        && s.len() <= MAX_ROUTE_LEN
        && s.bytes().all(|b| {
            b.is_ascii_alphanumeric()
                || matches!(
                    b,
                    b'_' | b'-'
                        | b'.'
                        | b'/'
                        | b'['
                        | b']'
                        | b'{'
                        | b'}'
                        | b':'
                        | b'*'
                        | b'('
                        | b')'
                        | b'+'
                        | b'?'
                )
        })
}

/// A route template with every dynamic segment as [`ANY_SEGMENT`], so that a test's
/// request and an entry point's route compare: `[id]`, `[...slug]`, `[[...slug]]`,
/// `:id` (with any `?` or `(regex)` after it), `{id}`, `{path:path}`, `<id>` and
/// `<int:id>` each become `[*]`. A query (`?a=1`) or fragment after a plain segment
/// is cut, a missing leading `/` is added (Django `path("users/<int:pk>/")`) and a
/// trailing `/` is removed (but `/` stays `/`). A scheme and host
/// (`http://localhost:3000/api/x`, `//cdn.example.com/x`) are stripped, leaving the
/// path. `None` when the result is not a [`valid_route`], or when what is left is no
/// path (`mailto:a@b`, `localhost:3000/x`, `/a/http://x`).
pub fn normalize_route(raw: &str) -> Option<String> {
    let mut segs: Vec<&str> = Vec::new();
    for seg in strip_origin(raw.trim())?.trim_start_matches('/').split('/') {
        let dynamic = seg.starts_with(':')
            || (seg.starts_with('[') && seg.ends_with(']'))
            || (seg.starts_with('{') && seg.ends_with('}'))
            || (seg.starts_with('<') && seg.ends_with('>'));
        if dynamic {
            segs.push(ANY_SEGMENT);
            continue;
        }
        if let Some(i) = seg.find(['?', '#']) {
            segs.push(&seg[..i]);
            break;
        }
        segs.push(seg);
    }
    while segs.len() > 1 && segs.last() == Some(&"") {
        segs.pop();
    }
    let out = format!("/{}", segs.join("/"));
    valid_route(&out).then_some(out)
}

/// `raw` without a leading `scheme://host[:port]` or `//host`: the path that follows,
/// `/` when none does. `None` when `raw` names a scheme elsewhere before any query
/// (`/a/http://x`), or begins with one that has no `//` (`mailto:`, `localhost:3000`):
/// what is left is no path.
fn strip_origin(raw: &str) -> Option<&str> {
    let head = &raw[..raw.find(['?', '#']).unwrap_or(raw.len())];
    let rest = if let Some(rest) = raw.strip_prefix("//") {
        rest
    } else if let Some((scheme, _)) = head.split_once("://") {
        if !is_scheme(scheme) {
            return None;
        }
        &raw[scheme.len() + 3..]
    } else if head.split_once(':').is_some_and(|(s, _)| is_scheme(s)) {
        return None;
    } else {
        return Some(raw);
    };
    Some(match rest.find(['/', '?', '#']) {
        Some(i) if rest[i..].starts_with('/') => &rest[i..],
        _ => "/",
    })
}

/// A URL scheme: a letter, then letters, digits, `+`, `-` or `.`.
fn is_scheme(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_alphabetic())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
}

/// Words that name a tenant ([`tenant_key`]).
pub const TENANT_WORDS: &[&str] = &[
    "account",
    "org",
    "organisation",
    "organization",
    "team",
    "tenant",
    "workspace",
];

/// Django lookups a filter key may end with (`organization__in`).
const LOOKUPS: &[&str] = &["exact", "iexact", "in", "eq"];

/// A filter key that names a tenant ([`crate::facts::ScopedQuery::key`]): an identifier
/// of at most 64 bytes whose last word is a tenant word ([`TENANT_WORDS`]), or `id` /
/// `pk` after one, past a Django lookup (`org`, `organization_id`, `workspace__id`,
/// `team__pk__in`, `orgId`). `account_type` and `organizations_count` are not.
pub fn tenant_key(key: &str) -> bool {
    if key.is_empty()
        || key.len() > 64
        || key.starts_with(|c: char| c.is_ascii_digit())
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return false;
    }
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in key.chars() {
        if c == '_' {
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
    while words.len() > 1 && words.last().is_some_and(|w| LOOKUPS.contains(&w.as_str())) {
        words.pop();
    }
    if words.len() > 1 && words.last().is_some_and(|w| w == "id" || w == "pk") {
        words.pop();
    }
    words
        .last()
        .is_some_and(|w| TENANT_WORDS.contains(&w.as_str()))
}

/// Identifiers that name the owner of a row, with `_` removed and lower-cased
/// ([`owner_key`]).
pub const OWNER_KEYS: &[&str] = &[
    "author",
    "authorid",
    "createdby",
    "createdbyid",
    "creator",
    "creatorid",
    "member",
    "memberid",
    "owner",
    "ownerid",
    "uploadedby",
    "uploadedbyid",
    "uploader",
    "user",
    "userid",
    "users",
];

/// SQL written as text that names a tenant or an owner key (`select * from rules
/// where org_id = $1`, `SET LOCAL app.current_org = ...`): a filter no fact records
/// ([`crate::facts::controls::SCOPE_UNREAD`]). The text starts with an SQL verb; a
/// table's name is no key (`from users`, `join members`).
pub fn sql_names_scope(text: &str) -> bool {
    let first = text
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        first.as_str(),
        "select" | "update" | "delete" | "insert" | "with" | "set"
    ) && text
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .any(|w| (tenant_key(w) || owner_key(w)) && !matches!(w, "user" | "users" | "member"))
}

/// SQL written as text that filters its rows: it starts with an SQL verb and has a
/// `where`. Given a value read off the caller (`"select * from devices where fleet_id
/// = $1", [request.operator.fleetId]`), it may be the scope whatever the column is
/// called.
pub fn sql_filters(text: &str) -> bool {
    let mut words = text.split_whitespace().map(str::to_ascii_lowercase);
    matches!(
        words.next().as_deref(),
        Some("select" | "update" | "delete" | "with")
    ) && words.any(|w| w == "where")
}

/// A key that names the owner of a row as a whole identifier (`user_id`, `ownerId`,
/// `created_by`), never a word of a longer name (`created_at`).
pub fn owner_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 64 {
        return false;
    }
    let id: String = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    OWNER_KEYS.contains(&id.as_str())
}

/// tRPC error code to HTTP status (`@trpc/server` `TRPC_ERROR_CODES_BY_KEY`, as the
/// HTTP adapters map them).
pub const TRPC_CODE_STATUS: &[(&str, u16)] = &[
    ("BAD_GATEWAY", 502),
    ("BAD_REQUEST", 400),
    ("CLIENT_CLOSED_REQUEST", 499),
    ("CONFLICT", 409),
    ("FORBIDDEN", 403),
    ("GATEWAY_TIMEOUT", 504),
    ("INTERNAL_SERVER_ERROR", 500),
    ("METHOD_NOT_SUPPORTED", 405),
    ("NOT_FOUND", 404),
    ("NOT_IMPLEMENTED", 501),
    ("PARSE_ERROR", 400),
    ("PAYLOAD_TOO_LARGE", 413),
    ("PAYMENT_REQUIRED", 402),
    ("PRECONDITION_FAILED", 412),
    ("SERVICE_UNAVAILABLE", 503),
    ("TIMEOUT", 408),
    ("TOO_MANY_REQUESTS", 429),
    ("UNAUTHORIZED", 401),
    ("UNPROCESSABLE_CONTENT", 422),
    ("UNSUPPORTED_MEDIA_TYPE", 415),
];

/// Nest's built-in HTTP exception classes (`@nestjs/common`) to the status each sends.
pub const NEST_EXCEPTION_STATUS: &[(&str, u16)] = &[
    ("BadGatewayException", 502),
    ("BadRequestException", 400),
    ("ConflictException", 409),
    ("ForbiddenException", 403),
    ("GatewayTimeoutException", 504),
    ("GoneException", 410),
    ("HttpVersionNotSupportedException", 505),
    ("ImATeapotException", 418),
    ("InternalServerErrorException", 500),
    ("MethodNotAllowedException", 405),
    ("MisdirectedException", 421),
    ("NotAcceptableException", 406),
    ("NotFoundException", 404),
    ("NotImplementedException", 501),
    ("PayloadTooLargeException", 413),
    ("PreconditionFailedException", 412),
    ("RequestTimeoutException", 408),
    ("ServiceUnavailableException", 503),
    ("UnauthorizedException", 401),
    ("UnprocessableEntityException", 422),
    ("UnsupportedMediaTypeException", 415),
];

/// The status a tRPC error code sends (`NOT_FOUND` -> 404).
pub fn trpc_status(code: &str) -> Option<u16> {
    lookup(TRPC_CODE_STATUS, code)
}

/// The status a Nest exception class sends (`NotFoundException` -> 404).
pub fn nest_status(class: &str) -> Option<u16> {
    lookup(NEST_EXCEPTION_STATUS, class)
}

fn lookup(table: &[(&str, u16)], key: &str) -> Option<u16> {
    table.iter().find(|(k, _)| *k == key).map(|(_, s)| *s)
}

/// A piece of the URL an outgoing request is sent to, as the code builds it
/// ([`outgoing_url`]): literal text, or a value (a name, a call, an interpolation),
/// as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlPart {
    Text(String),
    Value(String),
}

/// What is read of the URL of an outgoing request built from `parts`
/// ([`crate::facts::OutgoingRequest`]): the URL as written, each value as `{}`, and,
/// unless its path is written out, why it is not. A path is written out when it
/// has a literal segment and no value in the URL comes from the request being
/// served, or when the URL has no value in it at all.
///
/// A value comes from the request being served when it reads its URL or path
/// (`req.url`, `request.nextUrl.pathname`, `request.url.path`, `request.scope`), joins
/// a list (`path.join("/")`, a catch-all parameter), or is a name that says so
/// (`path`, `pathname`, `url`, `rest`, `full_path`). The request's own origin
/// (`req.nextUrl.origin`) is the application itself, not a path.
pub fn outgoing_url(parts: &[UrlPart]) -> (String, Option<String>) {
    const READS: &[&str] = &[
        ".join(",
        ".url",
        ".nexturl",
        "pathname",
        "originalurl",
        ".path",
        "full_path",
        "raw_path",
        "path_info",
        ".scope",
        ".href",
    ];
    const NAMES: &[&str] = &[
        "path",
        "pathname",
        "url",
        "uri",
        "rest",
        "slug",
        "segments",
        "subpath",
        "full_path",
        "rest_of_path",
        "proxy_path",
        "target_path",
        "catchall",
    ];
    let clip = |v: &str| -> String {
        let one_line: String = v.split_whitespace().collect::<Vec<_>>().join(" ");
        match one_line.char_indices().nth(60) {
            Some((i, _)) => format!("{}...", &one_line[..i]),
            None => one_line,
        }
    };
    let mut shape = String::new();
    for p in parts {
        match p {
            UrlPart::Text(t) => shape.push_str(t),
            UrlPart::Value(_) => shape.push_str("{}"),
        }
    }
    let shape = clip(&shape);
    for p in parts {
        let UrlPart::Value(v) = p else { continue };
        let low = v.trim().trim_start_matches("await ").to_lowercase();
        if low.ends_with(".origin") {
            continue;
        }
        if READS.iter().any(|r| low.contains(r)) || NAMES.contains(&low.as_str()) {
            let why = format!("`{}` is built from the request being served", clip(v));
            return (shape, Some(why));
        }
    }
    match parts {
        [UrlPart::Value(v)] => return (shape, Some(format!("`{}` is not read", clip(v)))),
        // Nothing in it is a value: it goes where it says.
        _ if parts.iter().all(|p| matches!(p, UrlPart::Text(_))) => return (shape, None),
        _ => {}
    }
    // What follows the host, or the value that stands for it.
    let rest = match shape
        .strip_prefix("http://")
        .or_else(|| shape.strip_prefix("https://"))
    {
        Some(r) => r.find('/').map_or("", |i| &r[i..]),
        None => shape.strip_prefix("{}").unwrap_or(&shape),
    };
    let path = rest.split(['?', '#']).next().unwrap_or_default();
    let literal = path.split('/').any(|segment| {
        segment
            .replace("{}", "")
            .chars()
            .any(|c| c.is_ascii_alphanumeric())
    });
    let why = (!literal).then(|| format!("the path of `{shape}` is not written out"));
    (shape, why)
}

/// Whether a request to `url` ([`outgoing_url`]) may go to a host named one of
/// `names`: not one to the application's own origin (`/api/x`), nor one to another
/// host that is written out (`https://api.example.com/...`).
pub fn outgoing_reaches(url: &str, names: &[String]) -> bool {
    if url.starts_with('/') && !url.starts_with("//") {
        return false;
    }
    let Some(rest) = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
    else {
        return true;
    };
    let host = rest.split(['/', ':', '?', '#']).next().unwrap_or_default();
    host.contains("{}") || names.iter().any(|n| n.eq_ignore_ascii_case(host))
}

#[cfg(test)]
mod tests {

    #[test]
    fn an_outgoing_url_is_read_when_its_path_is_written_out() {
        use UrlPart::{Text, Value};
        let t = |s: &str| Text(s.to_string());
        let v = |s: &str| Value(s.to_string());
        // A base that is a value, then literal segments, an identifier aside.
        assert_eq!(
            outgoing_url(&[v("API"), t("/v1/items/"), v("id")]),
            ("{}/v1/items/{}".to_string(), None)
        );
        assert_eq!(
            outgoing_url(&[v("req.nextUrl.origin"), t("/api/x")]),
            ("{}/api/x".to_string(), None)
        );
        // Nothing in it is a value.
        assert_eq!(
            outgoing_url(&[t("https://api.example.com")]),
            ("https://api.example.com".to_string(), None)
        );
        // Built from the request being served.
        for value in [
            "path.join(\"/\")",
            "req.nextUrl.pathname",
            "request.url.path",
            "full_path",
        ] {
            let (_, why) = outgoing_url(&[v("API"), t("/api/"), v(value)]);
            assert!(
                why.is_some_and(|w| w.contains("the request being served")),
                "{value}"
            );
        }
        // Not read: a name alone, and a path with no literal segment.
        let unread = |parts: &[UrlPart]| outgoing_url(parts).1.unwrap_or_default();
        assert!(unread(&[v("target")]).contains("is not read"));
        assert!(unread(&[v("API"), v("suffix")]).contains("not written out"));
        assert!(unread(&[v("API"), t("/"), v("id")]).contains("not written out"));
        // Where it may go.
        let api = ["api".to_string()];
        assert!(outgoing_reaches("{}/{}", &api));
        assert!(outgoing_reaches("http://api:8000/{}", &api));
        assert!(!outgoing_reaches("https://files.example.com/{}", &api));
        assert!(!outgoing_reaches("/api/{}", &api));
    }
    use super::*;

    fn sorted_unique(keys: impl Iterator<Item = &'static str>) -> bool {
        let keys: Vec<&str> = keys.collect();
        keys.windows(2).all(|w| w[0] < w[1])
    }

    #[test]
    fn tables_are_sorted_and_unique() {
        assert!(sorted_unique(LOG_LEVELS.iter().map(|(k, _)| *k)));
        assert!(sorted_unique(TRPC_CODE_STATUS.iter().map(|(k, _)| *k)));
        assert!(sorted_unique(NEST_EXCEPTION_STATUS.iter().map(|(k, _)| *k)));
    }

    #[test]
    fn log_levels_normalise() {
        assert_eq!(normalize_level("warning"), Some("warn"));
        assert_eq!(normalize_level("critical"), Some("fatal"));
        assert_eq!(normalize_level("exception"), Some("exception"));
        assert_eq!(normalize_level("log"), Some("log"));
        assert_eq!(normalize_level("info"), Some("info"));
        assert_eq!(normalize_level("print"), Some("print"));
        assert_eq!(normalize_level("Info"), None);
        assert_eq!(normalize_level("get"), None);
        assert_eq!(normalize_level(""), None);
        let levels = [
            "trace",
            "debug",
            "info",
            "warn",
            "error",
            "fatal",
            "exception",
            "log",
            "print",
        ];
        assert!(LOG_LEVELS.iter().all(|(_, l)| levels.contains(l)));
    }

    #[test]
    fn headers_are_shape_checked() {
        for ok in ["x-org-id", "authorization", "x-api-key", "a", "x1"] {
            assert!(valid_header(ok), "{ok}");
        }
        let long = "a".repeat(MAX_HEADER_LEN + 1);
        for bad in [
            "",
            "X-Org-Id",
            "x_org_id",
            "x org",
            "secret: value",
            "/api",
            "é",
            long.as_str(),
        ] {
            assert!(!valid_header(bad), "{bad}");
        }
        assert!(valid_header(&"a".repeat(MAX_HEADER_LEN)));
    }

    #[test]
    fn routes_are_shape_checked() {
        for ok in [
            "/",
            "/api/links/[id]",
            "/items/{item_id}",
            "/users/:id?",
            "/dashboard(.*)",
            "/:path*",
            "/v1/a+b",
        ] {
            assert!(valid_route(ok), "{ok}");
        }
        let long = format!("/{}", "a".repeat(MAX_ROUTE_LEN));
        for bad in [
            "",
            "api/x",
            "hello world",
            "/a b",
            "/a?x=1&y=2",
            "/<int:id>",
            // Next.js negative-lookahead matchers hold `!` and `|`: not echoed.
            "/((?!api|_next).*)",
            "/a\"b",
            "/é",
            "Bearer abc",
            long.as_str(),
        ] {
            assert!(!valid_route(bad), "{bad}");
        }
    }

    #[test]
    fn dynamic_segments_normalise() {
        let cases = [
            ("/api/links/[id]", "/api/links/[*]"),
            ("/docs/[...slug]", "/docs/[*]"),
            ("/docs/[[...slug]]", "/docs/[*]"),
            ("/users/:id", "/users/[*]"),
            ("/users/:id?", "/users/[*]"),
            ("/users/:id(\\d+)/posts", "/users/[*]/posts"),
            ("/items/{item_id}", "/items/[*]"),
            ("/files/{path:path}", "/files/[*]"),
            ("users/<int:pk>/", "/users/[*]"),
            ("/users/<pk>", "/users/[*]"),
            ("/api/x?id=1", "/api/x"),
            ("/api/x/#top", "/api/x"),
            ("/api/x/", "/api/x"),
            ("/", "/"),
            ("", "/"),
        ];
        for (raw, want) in cases {
            assert_eq!(normalize_route(raw).as_deref(), Some(want), "{raw}");
        }
        // Same template, every spelling.
        let forms = ["/a/[id]", "/a/:id", "/a/{id}", "/a/<int:id>"];
        let normal: Vec<_> = forms.iter().map(|r| normalize_route(r)).collect();
        assert!(normal.iter().all(|n| n.as_deref() == Some("/a/[*]")));
        for bad in ["/a b", "/a\"b", "/é"] {
            assert_eq!(normalize_route(bad), None, "{bad}");
        }
        assert_eq!(normalize_route(&"/a".repeat(70)), None);
        // Idempotent.
        for (raw, _) in cases {
            let once = normalize_route(raw).unwrap();
            assert_eq!(normalize_route(&once).as_deref(), Some(once.as_str()));
        }
    }

    #[test]
    fn routes_are_paths_never_urls() {
        for bad in [
            "http://x/y",
            "/http://x/y",
            "https://api.example.com/v1",
            "//cdn.example.com/x",
            "/a/b://c",
        ] {
            assert!(!valid_route(bad), "{bad}");
        }
        assert!(valid_route("/y"));
        let cases = [
            ("http://x/y", "/y"),
            ("/y", "/y"),
            ("https://api.example.com:8443/v1/users/:id", "/v1/users/[*]"),
            ("http://localhost:3000/api/x?next=/a", "/api/x"),
            ("http://localhost:3000", "/"),
            ("http://x?a=1", "/"),
            ("//cdn.example.com/x", "/x"),
            ("/api/x?next=http://y", "/api/x"),
            ("users/<int:pk>/", "/users/[*]"),
            ("/v1/models:generate", "/v1/models:generate"),
        ];
        for (raw, want) in cases {
            assert_eq!(normalize_route(raw).as_deref(), Some(want), "{raw}");
            assert_eq!(normalize_route(want).as_deref(), Some(want), "{want}");
        }
        for bad in [
            "/http://x/y",
            "/a/http://x",
            "mailto:a@b.c",
            "localhost:3000/api/x",
            "data:text/plain,x",
            "1http://x/y",
        ] {
            assert_eq!(normalize_route(bad), None, "{bad}");
        }
    }

    #[test]
    fn tenant_keys() {
        for ok in [
            "org",
            "org_id",
            "organization",
            "organization_id",
            "organisation_id",
            "workspace__id",
            "team__pk__in",
            "tenant",
            "account_id",
            "orgId",
            "workspaceId",
        ] {
            assert!(tenant_key(ok), "{ok}");
        }
        for bad in [
            "",
            "id",
            "account_type",
            "organizations_count",
            "user_id",
            "name",
            "org id",
            "1org",
            "team_name",
        ] {
            assert!(!tenant_key(bad), "{bad}");
        }
    }

    #[test]
    fn status_tables() {
        assert_eq!(trpc_status("NOT_FOUND"), Some(404));
        assert_eq!(trpc_status("UNAUTHORIZED"), Some(401));
        assert_eq!(trpc_status("FORBIDDEN"), Some(403));
        assert_eq!(trpc_status("TOO_MANY_REQUESTS"), Some(429));
        assert_eq!(trpc_status("not_found"), None);
        assert_eq!(nest_status("NotFoundException"), Some(404));
        assert_eq!(nest_status("UnauthorizedException"), Some(401));
        assert_eq!(nest_status("ForbiddenException"), Some(403));
        assert_eq!(nest_status("BadRequestException"), Some(400));
        assert_eq!(nest_status("HttpException"), None);
        assert!(
            TRPC_CODE_STATUS
                .iter()
                .chain(NEST_EXCEPTION_STATUS)
                .all(|(_, s)| (400..=599).contains(s))
        );
    }
}
