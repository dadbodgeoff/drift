//! Practice facts of Python code (facts schema 11, see [`drift_core::practice`]): in-body
//! checks that turn a caller away, the responses a symbol sends, log calls, `except`
//! clauses, request headers, validated inputs, error handlers, and, file-level, the
//! requests tests make and the modules they mock. Lowering records them raw; the linker
//! resolves their references.
//!
//! The string policy holds: besides counts, only header names, route patterns and
//! numeric status codes are echoed. Response keys are kept only when they are
//! identifier-shaped (`error`, `detail`): a key that could carry text is dropped.

use std::collections::{BTreeMap, BTreeSet};

use drift_core::practice;
use drift_core::{CheckOutcome, ResponseVia, TestRequest};
use ruff_python_ast::visitor::{self, Visitor};
use ruff_python_ast::{self as ast, Expr, Stmt};
use ruff_text_size::Ranged;

use super::{Collector, Lowerer, MAX_MEMBER_DEPTH, arg, dotted, elements, keyword, string_value};
use crate::raw::*;

/// Longest response key echoed ([`identifier_key`]).
const MAX_KEY_LEN: usize = 32;
/// Deepest expression a request-input or status search descends.
const MAX_DEPTH: usize = 4;

/// Errors and exceptions that send an HTTP status when raised, with the status each
/// sends by default (`0`: given by the call).
const HTTP_ERRORS: &[(&str, u16)] = &[
    ("django.core.exceptions.BadRequest", 400),
    ("django.core.exceptions.PermissionDenied", 403),
    ("django.core.exceptions.SuspiciousOperation", 400),
    ("django.http.Http404", 404),
    ("django.http.response.Http404", 404),
    ("fastapi.HTTPException", 0),
    ("fastapi.exceptions.HTTPException", 0),
    ("rest_framework.exceptions.APIException", 500),
    ("rest_framework.exceptions.AuthenticationFailed", 401),
    ("rest_framework.exceptions.MethodNotAllowed", 405),
    ("rest_framework.exceptions.NotAcceptable", 406),
    ("rest_framework.exceptions.NotAuthenticated", 401),
    ("rest_framework.exceptions.NotFound", 404),
    ("rest_framework.exceptions.ParseError", 400),
    ("rest_framework.exceptions.PermissionDenied", 403),
    ("rest_framework.exceptions.Throttled", 429),
    ("rest_framework.exceptions.UnsupportedMediaType", 415),
    ("rest_framework.exceptions.ValidationError", 400),
    ("starlette.exceptions.HTTPException", 0),
    ("werkzeug.exceptions.BadRequest", 400),
    ("werkzeug.exceptions.Conflict", 409),
    ("werkzeug.exceptions.Forbidden", 403),
    ("werkzeug.exceptions.HTTPException", 0),
    ("werkzeug.exceptions.InternalServerError", 500),
    ("werkzeug.exceptions.MethodNotAllowed", 405),
    ("werkzeug.exceptions.NotFound", 404),
    ("werkzeug.exceptions.TooManyRequests", 429),
    ("werkzeug.exceptions.Unauthorized", 401),
    ("werkzeug.exceptions.UnprocessableEntity", 422),
];

/// Django's `HttpResponse` subclasses named for their status.
const DJANGO_RESPONSES: &[(&str, u16)] = &[
    ("HttpResponseBadRequest", 400),
    ("HttpResponseForbidden", 403),
    ("HttpResponseGone", 410),
    ("HttpResponseNotAllowed", 405),
    ("HttpResponseNotFound", 404),
    ("HttpResponseNotModified", 304),
    ("HttpResponsePermanentRedirect", 301),
    ("HttpResponseRedirect", 302),
    ("HttpResponseServerError", 500),
];

/// `http.HTTPStatus` members to their status.
const HTTP_STATUS_NAMES: &[(&str, u16)] = &[
    ("ACCEPTED", 202),
    ("BAD_GATEWAY", 502),
    ("BAD_REQUEST", 400),
    ("CONFLICT", 409),
    ("CONTENT_TOO_LARGE", 413),
    ("CREATED", 201),
    ("FORBIDDEN", 403),
    ("FOUND", 302),
    ("GATEWAY_TIMEOUT", 504),
    ("GONE", 410),
    ("INTERNAL_SERVER_ERROR", 500),
    ("LOCKED", 423),
    ("METHOD_NOT_ALLOWED", 405),
    ("MOVED_PERMANENTLY", 301),
    ("NOT_ACCEPTABLE", 406),
    ("NOT_FOUND", 404),
    ("NOT_IMPLEMENTED", 501),
    ("NOT_MODIFIED", 304),
    ("NO_CONTENT", 204),
    ("OK", 200),
    ("PAYMENT_REQUIRED", 402),
    ("PERMANENT_REDIRECT", 308),
    ("PRECONDITION_FAILED", 412),
    ("REQUEST_ENTITY_TOO_LARGE", 413),
    ("SEE_OTHER", 303),
    ("SERVICE_UNAVAILABLE", 503),
    ("TEMPORARY_REDIRECT", 307),
    ("TOO_MANY_REQUESTS", 429),
    ("UNAUTHORIZED", 401),
    ("UNPROCESSABLE_CONTENT", 422),
    ("UNPROCESSABLE_ENTITY", 422),
    ("UNSUPPORTED_MEDIA_TYPE", 415),
];

/// Attributes of a request object that hold what the caller sent.
const REQUEST_INPUTS: &[&str] = &[
    "FILES",
    "GET",
    "POST",
    "args",
    "body",
    "data",
    "files",
    "form",
    "get_json",
    "json",
    "query_params",
    "values",
];

/// Methods that validate data into a schema or model (`schema.load(...)`,
/// `Model.model_validate(...)`).
const VALIDATE_METHODS: &[&str] = &[
    "load",
    "model_validate",
    "model_validate_json",
    "parse_obj",
    "parse_raw",
    "validate",
    "validate_json",
    "validate_python",
];

/// Methods that derive a logger with bound fields (`logger.bind(user=u)`, structlog's
/// `log.new(...)`).
const BIND_METHODS: &[&str] = &["bind", "new"];

/// Calls that filter a query by their keywords or comparisons (Django ORM, SQLAlchemy,
/// SQLModel), and Django's shortcuts that do.
/// Methods of a Django manager or queryset, or of a SQLAlchemy relationship loaded
/// as a query: called on what belongs to the caller
/// (`request.user.shipments.all()`), the rows are the caller's by how they are
/// reached ([`Collector::note_scope_path`]).
const RELATION_METHODS: &[&str] = &[
    "all",
    "count",
    "exclude",
    "exists",
    "filter",
    "filter_by",
    "first",
    "get",
    "last",
    "order_by",
    "prefetch_related",
    "select_related",
    "values",
    "values_list",
];

const FILTER_CALLS: &[&str] = &[
    "exclude",
    "filter",
    "filter_by",
    "get",
    "get_list_or_404",
    "get_object_or_404",
    "get_or_create",
    "update_or_create",
    "where",
];

/// A traced log receiver ([`Collector::log_recv`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LogRecv {
    /// Bound to what a reference gives (a factory call, a module-level logger), and
    /// whether derived with bound fields.
    Init(RawRef, bool),
    /// A parameter (`logger.info` in `def f(logger)`, or `self.x` set from one).
    Param(String, bool),
}

impl LogRecv {
    fn bound(self) -> Self {
        match self {
            Self::Init(r, _) => Self::Init(r, true),
            Self::Param(p, _) => Self::Param(p, true),
        }
    }
}

/// The expression derives a logger with bound fields: a `.bind(...)` / `.new(...)` call
/// with arguments, or `LoggerAdapter(logger, extra)`.
fn binds_fields(e: &Expr) -> bool {
    let Expr::Call(c) = e else { return false };
    match c.func.as_ref() {
        Expr::Attribute(a) if BIND_METHODS.contains(&a.attr.as_str()) => {
            !c.arguments.keywords.is_empty()
                || !c.arguments.args.is_empty()
                || binds_fields(&a.value)
        }
        Expr::Attribute(a) => binds_fields(&a.value),
        f => last_name(f) == Some("LoggerAdapter"),
    }
}

/// Attributes of a request that read what the caller sent, beyond [`REQUEST_INPUTS`].
const MORE_REQUEST_INPUTS: &[&str] = &["get_data", "path_params", "query_string", "stream"];

/// Request types a handler parameter may be annotated with: the request itself, not
/// input.
const REQUEST_TYPES: &[&str] = &[
    "django.http.HttpRequest",
    "django.http.request.HttpRequest",
    "fastapi.Request",
    "fastapi.WebSocket",
    "fastapi.requests.Request",
    "flask.Request",
    "rest_framework.request.Request",
    "starlette.requests.Request",
    "starlette.websockets.WebSocket",
];

/// Parameter types through which no request input arrives.
const NOT_INPUT_TYPES: &[&str] = &[
    "fastapi.BackgroundTasks",
    "fastapi.Response",
    "fastapi.responses.Response",
    "fastapi.security.SecurityScopes",
    "starlette.background.BackgroundTasks",
    "starlette.responses.Response",
];

/// FastAPI parameter markers that read request input.
const INPUT_MARKERS: &[&str] = &[
    "fastapi.Body",
    "fastapi.Cookie",
    "fastapi.File",
    "fastapi.Form",
    "fastapi.Header",
    "fastapi.Path",
    "fastapi.Query",
    "fastapi.UploadFile",
    "fastapi.params.Body",
    "fastapi.params.Cookie",
    "fastapi.params.File",
    "fastapi.params.Form",
    "fastapi.params.Header",
    "fastapi.params.Path",
    "fastapi.params.Query",
];

/// Calls a request may be handed to without anything of it being read as input:
/// Django's messages and session login and logout.
const REQUEST_SAFE_CALLS: &[&str] = &[
    "django.contrib.auth.login",
    "django.contrib.auth.logout",
    "django.contrib.messages",
];

/// Keywords of a log call that configure it rather than add data to it.
const LOG_OPTIONS: &[&str] = &["exc_info", "stack_info", "stacklevel"];

/// Decorators and methods that register an error handler, by attribute.
const HANDLER_DECORATORS: &[&str] = &["app_errorhandler", "errorhandler", "exception_handler"];
const HANDLER_CALLS: &[&str] = &["add_exception_handler", "register_error_handler"];

/// Libraries whose decorators make a command-line command (`@click.command()`,
/// `@app.command()` on a `typer.Typer()`).
const CLI_LIBRARIES: &[&str] = &["asyncclick", "click", "rich_click", "typer"];

/// Methods a test client sends a request with.
const CLIENT_METHODS: &[&str] = &["delete", "get", "head", "options", "patch", "post", "put"];

/// Methods of a mock library, by the module or fixture they come from: what each
/// patches is its first argument.
const PATCHERS: &[&str] = &[
    "mock.patch",
    "mock.patch.dict",
    "mock.patch.object",
    "unittest.mock.patch",
    "unittest.mock.patch.dict",
    "unittest.mock.patch.object",
];

fn lookup(table: &[(&str, u16)], key: &str) -> Option<u16> {
    table.iter().find(|(k, _)| *k == key).map(|(_, s)| *s)
}

/// The last name of a callee (`JSONResponse` in `responses.JSONResponse`).
fn last_name(e: &Expr) -> Option<&str> {
    match e {
        Expr::Name(n) => Some(n.id.as_str()),
        Expr::Attribute(a) => Some(a.attr.as_str()),
        _ => None,
    }
}

/// The last name of a callee (`Mount`, `routing.Mount` -> `Mount`).
pub(crate) fn callee_name(e: &Expr) -> Option<&str> {
    last_name(e)
}

/// An HTTP status the expression names: an integer literal from 100 to 599, a status
/// constant (`status.HTTP_404_NOT_FOUND`, `HTTP_201_CREATED`), or an `HTTPStatus`
/// member (`HTTPStatus.NOT_FOUND`, `.value` of one).
pub(crate) fn status_of(e: &Expr) -> Option<u16> {
    match e {
        Expr::NumberLiteral(n) => match &n.value {
            ast::Number::Int(i) => i
                .as_u64()
                .filter(|v| (100..=599).contains(v))
                .map(|v| v as u16),
            _ => None,
        },
        Expr::Attribute(a) if a.attr.as_str() == "value" => status_of(&a.value),
        Expr::Attribute(a) => status_name(a.attr.as_str()).or_else(|| {
            matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "HTTPStatus")
                .then(|| lookup(HTTP_STATUS_NAMES, a.attr.as_str()))
                .flatten()
        }),
        Expr::Name(n) => status_name(n.id.as_str()),
        _ => None,
    }
}

/// `HTTP_404_NOT_FOUND` -> 404.
fn status_name(name: &str) -> Option<u16> {
    let rest = name.strip_prefix("HTTP_")?;
    let digits = rest.split('_').next()?;
    let v: u16 = digits.parse().ok()?;
    (digits.len() == 3 && (100..=599).contains(&v)).then_some(v)
}

/// The statuses an expression names: one ([`status_of`]), or each of a tuple, list or
/// set of them.
fn statuses_of(e: &Expr, out: &mut BTreeSet<u16>) {
    match elements(e) {
        Some(els) => out.extend(els.iter().filter_map(status_of)),
        None => out.extend(status_of(e)),
    }
}

/// What a status says about a caller turned away.
fn outcome_of_status(status: u16) -> Option<CheckOutcome> {
    match status {
        401 => Some(CheckOutcome::Unauthenticated),
        403 => Some(CheckOutcome::Forbidden),
        404 => Some(CheckOutcome::NotFound),
        429 => Some(CheckOutcome::Throttled),
        _ => None,
    }
}

fn outcome_of_rejection(r: drift_core::controls::Rejection) -> CheckOutcome {
    use drift_core::controls::Rejection;
    match r {
        Rejection::Unauthenticated => CheckOutcome::Unauthenticated,
        Rejection::Forbidden => CheckOutcome::Forbidden,
        Rejection::Throttled => CheckOutcome::Throttled,
    }
}

/// A key of a response body that may be echoed: identifier-shaped, at most
/// [`MAX_KEY_LEN`] bytes.
fn identifier_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_KEY_LEN
        && !s.starts_with(|c: char| c.is_ascii_digit())
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Top-level keys of a dict literal body ([`identifier_key`] only).
fn dict_keys(e: Option<&Expr>) -> Vec<String> {
    let Some(Expr::Dict(d)) = e else {
        return vec![];
    };
    d.items
        .iter()
        .filter_map(|i| i.key.as_ref().and_then(string_value))
        .filter(|k| identifier_key(k))
        .collect()
}

/// A header name as a request reads it: lower-case, and a valid one.
fn header_name(s: &str) -> Option<String> {
    let h = s.trim().to_ascii_lowercase();
    practice::valid_header(&h).then_some(h)
}

/// A Django `META` key for a header (`HTTP_X_ORG_ID`) as the header's name.
fn meta_header(s: &str) -> Option<String> {
    header_name(&s.strip_prefix("HTTP_")?.replace('_', "-"))
}

/// A route template from a string or f-string: literal parts, and each interpolation
/// as `{name}` (the last name of the interpolated expression, `{param}` otherwise).
pub(crate) fn route_template(e: &Expr) -> Option<String> {
    if let Some(s) = string_value(e) {
        return Some(s);
    }
    let Expr::FString(f) = e else { return None };
    let mut out = String::new();
    for part in f.value.iter() {
        match part {
            ast::FStringPartRef::Literal(l) => out.push_str(&l.value),
            ast::FStringPartRef::FString(fs) => {
                for el in &fs.elements {
                    match el {
                        ast::InterpolatedStringElement::Literal(l) => out.push_str(&l.value),
                        ast::InterpolatedStringElement::Interpolation(i) => {
                            let name = last_name(&i.expression)
                                .filter(|n| n.chars().all(|c| c.is_alphanumeric() || c == '_'))
                                .unwrap_or("param");
                            out.push('{');
                            out.push_str(name);
                            out.push('}');
                        }
                    }
                }
            }
        }
    }
    Some(out)
}

/// The path of a URL a test requests: a route as written, or the path of an absolute
/// URL (`http://testserver/api/x` -> `/api/x`).
fn request_path(s: &str) -> Option<String> {
    let s = s.trim();
    let path = match s.split_once("://") {
        Some((_, rest)) => match rest.find('/') {
            Some(i) => &rest[i..],
            None => "/",
        },
        None => s,
    };
    practice::normalize_route(path)
}

/// `e` names `request.<input>` (`request.json`, `request.data`,
/// `await request.json()`, `self.request.POST`), at any depth of the arguments of
/// the calls it makes.
fn mentions_request_input(e: &Expr, depth: usize) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    let m = |x: &Expr| mentions_request_input(x, depth + 1);
    match e {
        Expr::Attribute(a) => {
            let request = match a.value.as_ref() {
                Expr::Name(n) => matches!(n.id.as_str(), "request" | "req"),
                Expr::Attribute(inner) => {
                    inner.attr.as_str() == "request"
                        && matches!(inner.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self")
                }
                _ => false,
            };
            (request && REQUEST_INPUTS.contains(&a.attr.as_str())) || m(&a.value)
        }
        Expr::Call(c) => {
            m(&c.func)
                || c.arguments
                    .args
                    .iter()
                    .chain(c.arguments.keywords.iter().map(|k| &k.value))
                    .any(m)
        }
        Expr::Await(a) => m(&a.value),
        Expr::Starred(s) => m(&s.value),
        Expr::Subscript(s) => m(&s.value),
        _ => false,
    }
}

fn call_mentions_request_input(c: &ast::ExprCall) -> bool {
    c.arguments
        .args
        .iter()
        .chain(c.arguments.keywords.iter().map(|k| &k.value))
        .any(|a| mentions_request_input(a, 0))
}

/// `e` reads a status off a response (`r.status_code`, `response.status`).
fn reads_status(e: &Expr) -> bool {
    matches!(e, Expr::Attribute(a) if matches!(a.attr.as_str(), "status_code" | "status" | "status_int"))
}

/// The value an expression bound in a condition reads, with the member path read off
/// it, cut at [`MAX_MEMBER_DEPTH`] segments.
type Read = (RawOperand, String);

fn push_member(reads: &mut String, attr: &str) {
    if reads.matches('.').count() < MAX_MEMBER_DEPTH {
        reads.push('.');
        reads.push_str(attr);
    }
}

/// The name a `__name__ == "__main__"` test is true for, if it is one.
fn is_main_guard(test: &Expr) -> bool {
    let Expr::Compare(c) = test else { return false };
    if c.ops.len() != 1 || !matches!(c.ops[0], ast::CmpOp::Eq) {
        return false;
    }
    let is_name = |e: &Expr| matches!(e, Expr::Name(n) if n.id.as_str() == "__name__");
    let is_main = |e: &Expr| string_value(e).as_deref() == Some("__main__");
    let (a, b) = (c.first_operand(), c.second_operand());
    (is_name(a) && is_main(b)) || (is_main(a) && is_name(b))
}

impl Lowerer<'_> {
    /// The module binds one of `libs` (`import click`, `from typer import Typer`).
    fn imports_any(&self, libs: &[&'static str]) -> Option<&'static str> {
        self.bindings.values().find_map(|b| match b {
            RawBinding::Import { spec, .. } => {
                let top = spec.split('.').next().unwrap_or(spec);
                libs.iter().find(|l| **l == top).copied()
            }
            RawBinding::Local => None,
        })
    }

    /// A HTTP response or error a call builds, with how it is sent: an error that sends
    /// a status ([`HTTP_ERRORS`], an `...HTTPException` class, or any error given a
    /// literal `status_code=`), a response class (`JSONResponse`, `HttpResponse...`,
    /// DRF's `Response`), Flask's `jsonify` / `make_response` / `redirect`, or `abort`.
    pub(crate) fn response_call(
        &self,
        c: &ast::ExprCall,
        canon: Option<RawRef>,
        raised: bool,
        in_catch: bool,
    ) -> Option<RawResponse> {
        let r = canon?;
        if matches!(r.base, RawBase::Global(_)) {
            return None;
        }
        let name = last_name(&c.func)?;
        let d = dotted(&r);
        let kw_status = keyword(c, "status_code")
            .or_else(|| keyword(c, "status"))
            .or_else(|| keyword(c, "code"))
            .and_then(status_of);
        let first_status = c.arguments.args.first().and_then(status_of);
        let response = |status: u16, via: ResponseVia, keys: Vec<String>| RawResponse {
            status,
            via,
            builder: Some(r.clone()),
            model: None,
            keys,
            in_catch,
        };
        if name == "abort" {
            let status = first_status.or(kw_status).unwrap_or(0);
            return Some(response(status, ResponseVia::Abort, vec![]));
        }
        if raised {
            let known = d.as_deref().and_then(|d| lookup(HTTP_ERRORS, d));
            let named = name.ends_with("HTTPException")
                || name.ends_with("HttpException")
                || name.ends_with("APIException");
            if known.is_none() && !named && kw_status.is_none() {
                return None;
            }
            let status = kw_status
                .or(first_status)
                .or(known.filter(|s| *s != 0))
                .unwrap_or(0);
            return Some(response(status, ResponseVia::Throw, vec![]));
        }
        let flask = d
            .as_deref()
            .is_some_and(|d| d.starts_with("flask.") || d.starts_with("django.shortcuts."));
        if name.ends_with("Response") {
            let via = if name.contains("Redirect") {
                ResponseVia::Redirect
            } else {
                ResponseVia::Return
            };
            let positional = matches!(name, "Response" | "JSONResponse")
                || d.as_deref().is_some_and(|d| {
                    d.starts_with("starlette.")
                        || d.starts_with("fastapi.")
                        || d.starts_with("rest_framework.")
                });
            let status = kw_status
                .or_else(|| {
                    positional
                        .then(|| c.arguments.args.get(1).and_then(status_of))
                        .flatten()
                })
                .or_else(|| lookup(DJANGO_RESPONSES, name))
                .unwrap_or(0);
            let body = keyword(c, "content")
                .or_else(|| keyword(c, "data"))
                .or_else(|| c.arguments.args.first());
            return Some(response(status, via, dict_keys(body)));
        }
        match name {
            "jsonify" if flask => {
                let keys = if c.arguments.args.is_empty() {
                    c.arguments
                        .keywords
                        .iter()
                        .filter_map(|k| k.arg.as_ref().map(|a| a.as_str().to_string()))
                        .filter(|k| identifier_key(k))
                        .collect()
                } else {
                    dict_keys(c.arguments.args.first())
                };
                Some(response(0, ResponseVia::Return, keys))
            }
            "make_response" if flask => {
                let status = c.arguments.args.get(1).and_then(status_of).unwrap_or(0);
                Some(response(
                    status,
                    ResponseVia::Return,
                    dict_keys(c.arguments.args.first()),
                ))
            }
            "redirect" if flask => Some(response(
                kw_status.unwrap_or(0),
                ResponseVia::Redirect,
                vec![],
            )),
            _ => None,
        }
    }

    /// Handlers, route declarations and commands a decorator says: `@app.exception_handler(X)`
    /// / `@app.errorhandler(404)` ([`RawSymbol::handles`]), a route decorator's
    /// `status_code=` / `response_model=` (a `Declared` response), and a click or typer
    /// command (a `cli` entry point). Adds facts only; the decorator is lowered as before.
    pub(crate) fn practice_decorator(
        &mut self,
        symbol: &str,
        d: &ast::Decorator,
        sym: &mut RawSymbol,
    ) {
        let (func, call) = match &d.expression {
            Expr::Call(c) => (c.func.as_ref(), Some(c)),
            e => (e, None),
        };
        let Some(attr) = last_name(func) else { return };
        let r = self.canon(func);
        if let (Expr::Attribute(_), Some(c)) = (func, call)
            && HANDLER_DECORATORS.contains(&attr)
            && let Some(first) = c.arguments.args.first()
        {
            sym.handles.extend(self.handled(first));
        }
        if let (Expr::Attribute(_), Some(c)) = (func, call)
            && (matches!(
                attr,
                "get" | "post" | "put" | "patch" | "delete" | "api_route" | "route"
            ))
        {
            let status = keyword(c, "status_code").and_then(status_of);
            let model = keyword(c, "response_model").and_then(|m| match m {
                Expr::Subscript(s) => self.canon(&s.slice),
                other => self.canon(other),
            });
            if status.is_some() || model.is_some() {
                sym.responses.push(RawResponse {
                    status: status.unwrap_or(0),
                    via: ResponseVia::Declared,
                    builder: None,
                    model,
                    keys: vec![],
                    in_catch: false,
                });
            }
        }
        // `@click.command()`, `@cli.command()`, `@app.command()` (typer).
        let cli = r.as_ref().and_then(dotted).is_some_and(|d| {
            let mut parts = d.splitn(2, '.');
            let top = parts.next().unwrap_or_default();
            CLI_LIBRARIES.contains(&top)
                && matches!(parts.next(), Some("command" | "group" | "Typer.command"))
        });
        let method =
            matches!(func, Expr::Attribute(_)) && matches!(attr, "command" | "group" | "callback");
        if cli || method {
            let lib = if cli {
                r.as_ref().and_then(dotted).and_then(|d| {
                    let top = d.split('.').next().unwrap_or_default().to_string();
                    CLI_LIBRARIES.iter().find(|l| **l == top).copied()
                })
            } else {
                self.imports_any(CLI_LIBRARIES)
            };
            if let Some(lib) = lib {
                let adapter = if lib == "typer" { "typer" } else { "click" };
                self.out.entry_points.push(drift_core::EntryPoint {
                    symbol: symbol.to_string(),
                    kind: "cli".into(),
                    method: None,
                    route: None,
                    adapter: adapter.into(),
                });
            }
        }
        // RQ jobs: `@job("default")` from `rq.decorators` / `django_rq`.
        if let Some(d) = r.as_ref().and_then(dotted)
            && matches!(d.as_str(), "rq.decorators.job" | "rq.job" | "django_rq.job")
        {
            self.out.entry_points.push(drift_core::EntryPoint {
                symbol: symbol.to_string(),
                kind: "consumer".into(),
                method: None,
                route: None,
                adapter: "rq".into(),
            });
        }
    }

    /// What `@errorhandler(x)` or `add_exception_handler(x, h)` registers for: a status,
    /// an error class, or `Exception` (any).
    fn handled(&self, e: &Expr) -> Option<RawHandles> {
        if let Some(s) = status_of(e) {
            return Some(RawHandles::Status(s));
        }
        let r = self.canon(e)?;
        Some(match &r.base {
            RawBase::Global(n)
                if r.member.is_empty() && matches!(n.as_str(), "Exception" | "BaseException") =>
            {
                RawHandles::Any
            }
            _ => RawHandles::Class(r),
        })
    }

    /// The module's own tables for env reads: string constants (`KEY = "X"`), dicts of
    /// string constants (`NAMES = {"db": "DATABASE_URL"}`), and one-line env helpers
    /// (`def _env(n): return os.environ.get(n)`), each by name; a name bound twice is
    /// dropped. At most [`MAX_ENV_TABLE`] of each.
    pub(crate) fn collect_env_tables(&mut self, body: &[Stmt]) {
        const MAX_ENV_TABLE: usize = 256;
        let mut seen: BTreeMap<String, u32> = BTreeMap::new();
        for s in body {
            match s {
                Stmt::Assign(a) => {
                    for t in &a.targets {
                        if let Expr::Name(n) = t {
                            *seen.entry(n.id.to_string()).or_default() += 1;
                        }
                    }
                    if let [Expr::Name(n)] = a.targets.as_slice() {
                        let name = n.id.to_string();
                        if env_read_text(&a.value) && self.env_names.len() < MAX_ENV_TABLE {
                            self.env_names.insert(name.clone());
                        }
                        if binds_fields(&a.value) && self.bound_loggers.len() < MAX_ENV_TABLE {
                            self.bound_loggers.insert(name.clone());
                        }
                        if let Some(v) = string_value(&a.value) {
                            if self.env_strings.len() < MAX_ENV_TABLE {
                                self.env_strings.insert(name, v);
                            }
                        } else if let Expr::Dict(d) = a.value.as_ref() {
                            let items: BTreeMap<String, String> = d
                                .items
                                .iter()
                                .filter_map(|i| {
                                    Some((
                                        i.key.as_ref().and_then(string_value)?,
                                        string_value(&i.value)?,
                                    ))
                                })
                                .take(MAX_ENV_TABLE)
                                .collect();
                            if !items.is_empty() && self.env_dicts.len() < MAX_ENV_TABLE {
                                self.env_dicts.insert(name, items);
                            }
                        }
                    }
                }
                Stmt::FunctionDef(f) => {
                    *seen.entry(f.name.to_string()).or_default() += 1;
                    if let Some(i) = env_helper(f)
                        && self.env_helpers.len() < MAX_ENV_TABLE
                    {
                        self.env_helpers.insert(f.name.to_string(), i);
                    }
                }
                _ => {}
            }
        }
        for (name, n) in seen {
            if n > 1 {
                self.env_strings.remove(&name);
                self.env_names.remove(&name);
                self.bound_loggers.remove(&name);
                self.env_dicts.remove(&name);
                self.env_helpers.remove(&name);
            }
        }
    }

    /// The env name a key expression names: a literal, a module string constant, or a
    /// literal key of a module dict of names (`NAMES["db"]`).
    pub(crate) fn env_key(&self, col: &Collector, e: &Expr) -> Option<String> {
        if let Some(s) = string_value(e) {
            return Some(s);
        }
        let module_local = |n: &str| matches!(col.resolve(n), Some(RawBase::Local(x)) if x == n);
        match e {
            Expr::Name(n) if module_local(n.id.as_str()) => {
                self.env_strings.get(n.id.as_str()).cloned()
            }
            Expr::Subscript(s) => match s.value.as_ref() {
                Expr::Name(n) if module_local(n.id.as_str()) => {
                    let key = string_value(&s.slice)?;
                    self.env_dicts.get(n.id.as_str())?.get(&key).cloned()
                }
                _ => None,
            },
            _ => None,
        }
    }

    /// A call of one of the module's env helpers: the env name it reads.
    pub(crate) fn env_helper_call(&self, col: &Collector, c: &ast::ExprCall) -> Option<String> {
        let Expr::Name(n) = c.func.as_ref() else {
            return None;
        };
        let name = n.id.as_str();
        if !matches!(col.resolve(name), Some(RawBase::Local(x)) if x == name) {
            return None;
        }
        let i = *self.env_helpers.get(name)?;
        let a = c.arguments.args.get(i).filter(|a| !a.is_starred_expr())?;
        self.env_key(col, a)
    }

    /// `app.add_exception_handler(X, handler)` (Starlette, FastAPI) and
    /// `app.register_error_handler(404, handler)` (Flask), anywhere in the file.
    pub(crate) fn lower_error_handlers(&mut self, body: &[Stmt]) {
        struct Finder<'a, 'l, 't> {
            l: &'l Lowerer<'t>,
            out: &'a mut Vec<(RawHandles, RawRef)>,
        }
        impl<'x> Visitor<'x> for Finder<'_, '_, '_> {
            fn visit_expr(&mut self, e: &'x Expr) {
                if let Expr::Call(c) = e
                    && let Expr::Attribute(a) = c.func.as_ref()
                    && HANDLER_CALLS.contains(&a.attr.as_str())
                    && let (Some(x), Some(h)) =
                        (arg(c, 0, "exc_class_or_status_code"), arg(c, 1, "handler"))
                    && let (Some(what), Some(handler)) = (self.l.handled(x), self.l.canon(h))
                    && !matches!(handler.base, RawBase::Global(_))
                {
                    self.out.push((what, handler));
                }
                visitor::walk_expr(self, e);
            }
        }
        let mut out = Vec::new();
        let mut f = Finder {
            l: self,
            out: &mut out,
        };
        for s in body {
            f.visit_stmt(s);
        }
        out.sort();
        out.dedup();
        self.out.error_handlers = out;
    }

    /// `if __name__ == "__main__": main()`: in a module that uses argparse, each
    /// module-level function the block calls is a `cli` entry point; `typer.run(main)`
    /// makes `main` one in any module.
    pub(crate) fn lower_main_guard(&mut self, body: &[Stmt]) {
        let argparse = self.imports_any(&["argparse"]).is_some();
        let mut found: Vec<(String, &'static str)> = Vec::new();
        for s in body {
            let Stmt::If(i) = s else { continue };
            if !is_main_guard(&i.test) {
                continue;
            }
            struct Calls<'l, 't> {
                l: &'l Lowerer<'t>,
                argparse: bool,
                out: Vec<(String, &'static str)>,
            }
            impl<'x> Visitor<'x> for Calls<'_, '_> {
                fn visit_stmt(&mut self, s: &'x Stmt) {
                    if !matches!(s, Stmt::FunctionDef(_) | Stmt::ClassDef(_)) {
                        visitor::walk_stmt(self, s);
                    }
                }
                fn visit_expr(&mut self, e: &'x Expr) {
                    if let Expr::Call(c) = e {
                        let local_fn = |x: &Expr| match x {
                            Expr::Name(n)
                                if self.l.functions.contains(n.id.as_str())
                                    && matches!(
                                        self.l.bindings.get(n.id.as_str()),
                                        Some(RawBinding::Local)
                                    ) =>
                            {
                                Some(n.id.to_string())
                            }
                            _ => None,
                        };
                        if self.argparse
                            && let Some(n) = local_fn(&c.func)
                        {
                            self.out.push((n, "argparse"));
                        }
                        if self.l.canon(&c.func).as_ref().and_then(dotted).as_deref()
                            == Some("typer.run")
                            && let Some(n) = c.arguments.args.first().and_then(local_fn)
                        {
                            self.out.push((n, "typer"));
                        }
                    }
                    visitor::walk_expr(self, e);
                }
            }
            let mut v = Calls {
                l: self,
                argparse,
                out: vec![],
            };
            for st in &i.body {
                v.visit_stmt(st);
            }
            found.extend(v.out);
        }
        for (symbol, adapter) in found {
            let known = self
                .out
                .entry_points
                .iter()
                .any(|e| e.symbol == symbol && e.kind == "cli");
            if !known {
                self.out.entry_points.push(drift_core::EntryPoint {
                    symbol,
                    kind: "cli".into(),
                    method: None,
                    route: None,
                    adapter: adapter.into(),
                });
            }
        }
    }

    /// Requests the file's test functions make, with the statuses each function
    /// asserts, and the modules the file mocks ([`RawFile::test_requests`],
    /// [`RawFile::mocks`]).
    pub(crate) fn lower_tests(&mut self, body: &[Stmt]) {
        let mut t = TestFinder {
            l: self,
            frames: vec![],
            module_clients: BTreeSet::new(),
            requests: BTreeSet::new(),
            mocks: BTreeSet::new(),
        };
        for s in body {
            t.visit_stmt(s);
        }
        let (requests, mocks) = (t.requests, t.mocks);
        self.out.test_requests = requests.into_iter().collect();
        self.out.mocks = mocks.into_iter().collect();
    }

    /// The annotations of a handler's parameters that may be its input models
    /// ([`RawInput::Param`]): a class (`Annotated[T, Body()]`, `T | None` and `list[T]`
    /// unwrapped), not a dependency or a header.
    pub(crate) fn param_inputs(&self, params: &ast::Parameters) -> Vec<RawRef> {
        let mut out = Vec::new();
        for p in params.iter_non_variadic_params() {
            let Some(ann) = p.parameter.annotation() else {
                continue;
            };
            if p.default
                .as_deref()
                .is_some_and(|d| self.is_depends_call(d) || self.header_call(d).is_some())
                || self.annotated_marker(ann, &|l, x| {
                    l.is_depends_call(x) || l.header_call(x).is_some()
                })
            {
                continue;
            }
            if let Some(r) = self.model_type(ann, 0) {
                out.push(r);
            }
        }
        out
    }

    fn model_type(&self, e: &Expr, depth: usize) -> Option<RawRef> {
        if depth > MAX_DEPTH {
            return None;
        }
        match e {
            Expr::Subscript(s) => {
                let outer = self.dotted_of(&s.value);
                match outer.as_deref() {
                    Some(
                        "typing.Annotated"
                        | "typing_extensions.Annotated"
                        | "typing.Optional"
                        | "typing.List"
                        | "typing.Sequence"
                        | "collections.abc.Sequence",
                    ) => match s.slice.as_ref() {
                        Expr::Tuple(t) => {
                            t.elts.first().and_then(|x| self.model_type(x, depth + 1))
                        }
                        other => self.model_type(other, depth + 1),
                    },
                    _ if matches!(s.value.as_ref(), Expr::Name(n) if matches!(n.id.as_str(), "list" | "List" | "Sequence")) => {
                        self.model_type(&s.slice, depth + 1)
                    }
                    _ => None,
                }
            }
            Expr::BinOp(b) if matches!(b.op, ast::Operator::BitOr) => {
                let l = self.model_type(&b.left, depth + 1);
                let r = self.model_type(&b.right, depth + 1);
                match (l, r) {
                    (Some(x), None) | (None, Some(x)) => Some(x),
                    _ => None,
                }
            }
            Expr::Name(_) | Expr::Attribute(_) => {
                let r = self.canon(e)?;
                (!matches!(r.base, RawBase::Global(_))).then_some(r)
            }
            _ => None,
        }
    }

    /// `Annotated[T, m]` with a marker `m` that `test` accepts.
    fn annotated_marker(&self, ann: &Expr, test: &dyn Fn(&Self, &Expr) -> bool) -> bool {
        let Expr::Subscript(s) = ann else {
            return false;
        };
        if !matches!(
            self.dotted_of(&s.value).as_deref(),
            Some("typing.Annotated" | "typing_extensions.Annotated")
        ) {
            return false;
        }
        let Expr::Tuple(t) = s.slice.as_ref() else {
            return false;
        };
        t.elts.iter().skip(1).any(|x| test(self, x))
    }

    /// A FastAPI `Header(...)` call: the header name it reads, given the parameter's
    /// name (`x_org_id` -> `x-org-id`, unless `convert_underscores=False`), or its
    /// `alias=`.
    fn header_call<'e>(&self, e: &'e Expr) -> Option<&'e ast::ExprCall> {
        let Expr::Call(c) = e else { return None };
        matches!(
            self.dotted_of(&c.func).as_deref(),
            Some("fastapi.Header" | "fastapi.params.Header")
        )
        .then_some(c)
    }

    fn header_of_param(&self, name: &str, c: &ast::ExprCall) -> Option<String> {
        if let Some(a) = keyword(c, "alias").and_then(string_value) {
            return header_name(&a);
        }
        let keep =
            matches!(keyword(c, "convert_underscores"), Some(Expr::BooleanLiteral(b)) if !b.value);
        header_name(&if keep {
            name.to_string()
        } else {
            name.replace('_', "-")
        })
    }

    /// A handler's parameters as request input ([`RawParamKind`]), whether it takes
    /// `*args` / `**kwargs`, and the names its request object goes by (`request`,
    /// `req`, or a parameter annotated with a request type).
    pub(crate) fn input_params(
        &self,
        params: &ast::Parameters,
    ) -> (Vec<RawParamKind>, bool, BTreeSet<String>) {
        let mut kinds = Vec::new();
        let mut requests = BTreeSet::new();
        let marker = |e: &Expr, table: &[&str]| -> bool {
            let f = match e {
                Expr::Call(c) => c.func.as_ref(),
                other => other,
            };
            self.dotted_of(f)
                .is_some_and(|d| table.contains(&d.as_str()))
        };
        let annotated = |ann: &Expr, table: &[&str]| -> bool {
            let Expr::Subscript(s) = ann else {
                return false;
            };
            if !matches!(
                self.dotted_of(&s.value).as_deref(),
                Some("typing.Annotated" | "typing_extensions.Annotated")
            ) {
                return false;
            }
            let Expr::Tuple(t) = s.slice.as_ref() else {
                return false;
            };
            t.elts.iter().skip(1).any(|x| marker(x, table))
        };
        for p in params.iter_non_variadic_params() {
            let name = p.parameter.name.as_str();
            let ann = p.parameter.annotation();
            let default = p.default.as_deref();
            let ty = ann.and_then(|a| match a {
                Expr::Subscript(s)
                    if matches!(
                        self.dotted_of(&s.value).as_deref(),
                        Some("typing.Annotated" | "typing_extensions.Annotated")
                    ) =>
                {
                    match s.slice.as_ref() {
                        Expr::Tuple(t) => t.elts.first(),
                        _ => None,
                    }
                }
                other => Some(other),
            });
            let typed = |table: &[&str]| ty.is_some_and(|t| marker(t, table));
            let kind = if matches!(name, "self" | "cls") {
                RawParamKind::Other
            } else if default.is_some_and(|d| self.is_depends_call(d))
                || ann.is_some_and(|a| annotated(a, crate::lower::adapters::DEPENDS))
            {
                RawParamKind::Dep
            } else if default.is_some_and(|d| marker(d, INPUT_MARKERS))
                || ann.is_some_and(|a| annotated(a, INPUT_MARKERS))
            {
                RawParamKind::Input
            } else if typed(REQUEST_TYPES) || (ann.is_none() && matches!(name, "request" | "req")) {
                requests.insert(name.to_string());
                RawParamKind::Other
            } else if typed(NOT_INPUT_TYPES) {
                RawParamKind::Other
            } else {
                match ty {
                    Some(t @ (Expr::Name(_) | Expr::Attribute(_))) => match self.canon(t) {
                        Some(r) if !matches!(r.base, RawBase::Global(_)) => RawParamKind::Alias(r),
                        _ => RawParamKind::Input,
                    },
                    _ => RawParamKind::Input,
                }
            };
            kinds.push(kind);
        }
        (
            kinds,
            params.vararg.is_some() || params.kwarg.is_some(),
            requests,
        )
    }

    /// What each parameter of a function stands for in a check: a header it reads, a
    /// FastAPI dependency it is bound to (or may be: an alias the linker resolves), or
    /// itself.
    pub(crate) fn param_operands(&self, params: &ast::Parameters) -> Vec<(String, RawOperand)> {
        let mut out = Vec::new();
        for p in params.iter_non_variadic_params() {
            let name = p.parameter.name.as_str().to_string();
            let ann = p.parameter.annotation();
            let default = p.default.as_deref();
            let header = default
                .and_then(|d| self.header_call(d))
                .or_else(|| {
                    let Some(Expr::Subscript(s)) = ann else {
                        return None;
                    };
                    let Expr::Tuple(t) = s.slice.as_ref() else {
                        return None;
                    };
                    t.elts.iter().skip(1).find_map(|x| self.header_call(x))
                })
                .and_then(|c| self.header_of_param(&name, c));
            if let Some(h) = header {
                out.push((name, RawOperand::Header(h)));
                continue;
            }
            let dep = match default {
                Some(d @ Expr::Call(c)) if self.is_depends_call(d) => self.depends_target(c, ann),
                Some(d @ (Expr::Name(_) | Expr::Attribute(_))) => self
                    .alias_dep(d)
                    .or_else(|| ann.and_then(|a| self.annotation_deps(a).into_iter().next())),
                _ => ann.and_then(|a| self.annotation_deps(a).into_iter().next()),
            };
            match dep {
                Some(d) => out.push((name.clone(), RawOperand::Dep(d, name))),
                None => out.push((name.clone(), RawOperand::Param(name))),
            }
        }
        out
    }
}

/// The index of the parameter a one-line env helper reads: its body (past a
/// docstring) is one `return` of `os.environ.get(p, ...)`, `os.getenv(p, ...)` or
/// `os.environ[p]` (or such a read with `or` a default, or converted by `int()` / `str()` /
/// `bool()`).
fn env_helper(f: &ast::StmtFunctionDef) -> Option<usize> {
    if !f.decorator_list.is_empty() {
        return None;
    }
    let body = super::without_docstring(&f.body);
    let [Stmt::Return(r)] = body else { return None };
    let names: Vec<&str> = f
        .parameters
        .posonlyargs
        .iter()
        .chain(&f.parameters.args)
        .map(|p| p.parameter.name.as_str())
        .collect();
    let mut e = r.value.as_deref()?;
    loop {
        match e {
            Expr::BoolOp(b) => e = b.values.first()?,
            Expr::Call(c)
                if matches!(c.func.as_ref(), Expr::Name(n) if matches!(n.id.as_str(), "int" | "str" | "bool" | "float"))
                    && c.arguments.args.len() == 1 =>
            {
                e = &c.arguments.args[0];
            }
            _ => break,
        }
    }
    let key = match e {
        Expr::Call(c) => {
            let path = env_path(&c.func)?;
            if !matches!(
                path.as_str(),
                "os.getenv" | "os.environ.get" | "environ.get" | "getenv"
            ) {
                return None;
            }
            c.arguments.args.first()?
        }
        Expr::Subscript(s) => {
            let path = env_path(&s.value)?;
            if !matches!(path.as_str(), "os.environ" | "environ") {
                return None;
            }
            &s.slice
        }
        _ => return None,
    };
    let Expr::Name(n) = key else { return None };
    names.iter().position(|p| *p == n.id.as_str())
}

/// An env read as written: `os.environ["X"]`, `os.environ.get(..)`, `os.getenv(..)`
/// (also `environ` / `getenv` imported), or one with `or` a default.
fn env_read_text(e: &Expr) -> bool {
    match e {
        Expr::BoolOp(b) => b.values.first().is_some_and(env_read_text),
        Expr::Call(c) => env_path(&c.func).is_some_and(|p| {
            matches!(
                p.as_str(),
                "os.getenv" | "os.environ.get" | "environ.get" | "getenv"
            )
        }),
        Expr::Subscript(s) => {
            env_path(&s.value).is_some_and(|p| matches!(p.as_str(), "os.environ" | "environ"))
        }
        _ => false,
    }
}

/// `os.environ.get` as written.
fn env_path(e: &Expr) -> Option<String> {
    match e {
        Expr::Name(n) => Some(n.id.to_string()),
        Expr::Attribute(a) => Some(format!("{}.{}", env_path(&a.value)?, a.attr)),
        _ => None,
    }
}

impl<'t> Collector<'_, 't> {
    /// The value an expression in a condition reads ([`Read`]).
    pub(crate) fn operand(&self, e: &Expr, depth: usize) -> Read {
        let none = (RawOperand::None, String::new());
        if depth > MAX_DEPTH + 4 {
            return none;
        }
        if self.env_value(e, 0) {
            return (RawOperand::Env, String::new());
        }
        match e {
            Expr::StringLiteral(_) | Expr::NumberLiteral(_) | Expr::BytesLiteral(_) => {
                (RawOperand::Literal, String::new())
            }
            Expr::Tuple(_) | Expr::List(_) | Expr::Set(_)
                if elements(e).is_some_and(|els| {
                    !els.is_empty()
                        && els
                            .iter()
                            .all(|x| matches!(x, Expr::StringLiteral(_) | Expr::NumberLiteral(_)))
                }) =>
            {
                (RawOperand::Literal, String::new())
            }
            Expr::Name(n) => {
                let name = n.id.as_str();
                if let Some(v) = self.check_locals.get(name) {
                    return v.clone();
                }
                if let Some(frame) = self.param_ops.last()
                    && let Some(op) = frame.get(name)
                {
                    return (op.clone(), String::new());
                }
                match self.resolve(name) {
                    Some(RawBase::Global(_)) | None => none,
                    Some(base) => (
                        RawOperand::Ref(RawRef {
                            base,
                            member: String::new(),
                        }),
                        String::new(),
                    ),
                }
            }
            Expr::Attribute(a) => {
                let (op, mut reads) = self.operand(&a.value, depth + 1);
                if op == RawOperand::None {
                    return none;
                }
                push_member(&mut reads, a.attr.as_str());
                (op, reads)
            }
            Expr::Await(a) => self.operand(&a.value, depth + 1),
            Expr::Subscript(s) => {
                if let Some(h) = self.header_read(e) {
                    return (RawOperand::Header(h), String::new());
                }
                self.operand(&s.value, depth + 1)
            }
            Expr::Call(c) => {
                if let Some(h) = self.header_read(e) {
                    return (RawOperand::Header(h), String::new());
                }
                match c.func.as_ref() {
                    // `str(user.org_id)`: the value converted.
                    Expr::Name(n)
                        if matches!(
                            n.id.as_str(),
                            "str" | "int" | "bool" | "len" | "uuid.UUID"
                        ) && c.arguments.args.len() == 1 =>
                    {
                        self.operand(&c.arguments.args[0], depth + 1)
                    }
                    Expr::Attribute(a) => {
                        let (op, mut reads) = self.operand(&a.value, depth + 1);
                        match op {
                            RawOperand::Param(_) | RawOperand::Dep(..) | RawOperand::Header(_) => {
                                push_member(&mut reads, a.attr.as_str());
                                (op, reads)
                            }
                            RawOperand::Ref(_) if !reads.is_empty() => {
                                push_member(&mut reads, a.attr.as_str());
                                (op, reads)
                            }
                            _ => match self.canon(&c.func) {
                                Some(r) if !matches!(r.base, RawBase::Global(_)) => {
                                    (RawOperand::Ref(r), String::new())
                                }
                                _ => none,
                            },
                        }
                    }
                    func => match self.canon(func) {
                        Some(r) if !matches!(r.base, RawBase::Global(_)) => {
                            (RawOperand::Ref(r), String::new())
                        }
                        _ => none,
                    },
                }
            }
            _ => none,
        }
    }

    /// An env-derived value: an env read (`os.environ["X"]`, `os.getenv("X")`), a
    /// module name bound to one, a method of one (`.encode()`), or an HMAC keyed with one
    /// (`hmac.new(SECRET.encode(), body, sha256).hexdigest()`).
    fn env_value(&self, e: &Expr, depth: usize) -> bool {
        if depth > MAX_DEPTH {
            return false;
        }
        match e {
            Expr::Name(n) => {
                let name = n.id.as_str();
                self.l.env_names.contains(name)
                    && matches!(self.resolve(name), Some(RawBase::Local(x)) if x == name)
            }
            Expr::Subscript(s) => {
                self.canon(&s.value).as_ref().and_then(dotted).as_deref() == Some("os.environ")
            }
            Expr::Call(c) => {
                let d = self.canon(&c.func).as_ref().and_then(dotted);
                if matches!(d.as_deref(), Some("os.getenv" | "os.environ.get")) {
                    return true;
                }
                if matches!(d.as_deref(), Some("hmac.new" | "hmac.digest")) {
                    return self
                        .hmac_key(c)
                        .is_some_and(|k| self.env_value(k, depth + 1));
                }
                match c.func.as_ref() {
                    Expr::Attribute(a) => self.env_value(&a.value, depth + 1),
                    _ => false,
                }
            }
            Expr::Attribute(a) => self.env_value(&a.value, depth + 1),
            Expr::BoolOp(b) => b
                .values
                .first()
                .is_some_and(|v| self.env_value(v, depth + 1)),
            _ => false,
        }
    }

    /// The key an `hmac.new(key, ...)` call is keyed with, without a `.encode()`.
    fn hmac_key<'e>(&self, c: &'e ast::ExprCall) -> Option<&'e Expr> {
        let mut k = c.arguments.args.first().or_else(|| keyword(c, "key"))?;
        while let Expr::Call(x) = k
            && let Expr::Attribute(a) = x.func.as_ref()
            && matches!(a.attr.as_str(), "encode" | "decode")
        {
            k = &a.value;
        }
        Some(k)
    }

    /// A compare operand with the member path read off a module-level object folded into
    /// its reference (`settings.api_key`), and an HMAC keyed with a module-level object
    /// as that object, so the linker can tell an env-derived secret.
    fn compare_operand(&self, e: &Expr, read: Read) -> RawOperand {
        let hmac = |c: &ast::ExprCall| {
            matches!(
                self.canon(&c.func).as_ref().and_then(dotted).as_deref(),
                Some("hmac.new" | "hmac.digest")
            )
        };
        let mut inner = e;
        // `hmac.new(key, ...).hexdigest()`.
        while let Expr::Call(c) = inner
            && let Expr::Attribute(a) = c.func.as_ref()
            && matches!(a.value.as_ref(), Expr::Call(x) if hmac(x))
        {
            inner = &a.value;
        }
        if let Expr::Call(c) = inner
            && hmac(c)
            && let Some(k) = self.hmac_key(c)
        {
            return self.compare_operand(k, self.operand(k, 0));
        }
        // A local bound to one (`expected = hmac.new(...).hexdigest()`).
        if let Expr::Name(n) = e
            && let Some(v) = self.hmac_locals.get(n.id.as_str())
        {
            return v.clone();
        }
        match read {
            (RawOperand::Ref(mut r), reads) if !reads.is_empty() && !r.member.contains('(') => {
                r.member.push_str(&reads);
                RawOperand::Ref(r)
            }
            (op, _) => op,
        }
    }

    /// The expression is the request object: a request parameter, `self.request`, or
    /// Flask's `request`.
    pub(crate) fn is_request(&self, e: &Expr) -> bool {
        match e {
            Expr::Name(n) => {
                self.request_names.contains(n.id.as_str())
                    || (n.id.as_str() == "request"
                        && self
                            .canon(e)
                            .as_ref()
                            .and_then(dotted)
                            .is_some_and(|d| d == "flask.request"))
            }
            Expr::Attribute(a) => {
                a.attr.as_str() == "request"
                    && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self")
            }
            _ => false,
        }
    }

    /// `request.<input>`: `request.json`, `request.GET`, `request.data`,
    /// `request.get_json`, `request.body`, `request.query_params`.
    pub(crate) fn reads_request_input(&self, a: &ast::ExprAttribute) -> bool {
        let attr = a.attr.as_str();
        (REQUEST_INPUTS.contains(&attr) || MORE_REQUEST_INPUTS.contains(&attr))
            && self.is_request(&a.value)
    }

    /// The call hands the request on whole (`helper(request)`, outside Django's messages
    /// and login), or calls a method of `self` / `super()`, which may read it.
    pub(crate) fn hands_request_on(&self, c: &ast::ExprCall) -> bool {
        let on_self = match c.func.as_ref() {
            Expr::Attribute(a) => match a.value.as_ref() {
                Expr::Name(n) => n.id.as_str() == "self",
                Expr::Call(x) => {
                    matches!(x.func.as_ref(), Expr::Name(n) if n.id.as_str() == "super")
                }
                _ => false,
            },
            _ => false,
        };
        if on_self && !self.reads_request_input_call(c) {
            return true;
        }
        let passes = c
            .arguments
            .args
            .iter()
            .map(|a| match a {
                Expr::Starred(s) => s.value.as_ref(),
                other => other,
            })
            .chain(c.arguments.keywords.iter().map(|k| &k.value))
            .any(|a| self.is_request(a));
        if !passes {
            return false;
        }
        let safe = self
            .canon(&c.func)
            .as_ref()
            .and_then(dotted)
            .is_some_and(|d| {
                REQUEST_SAFE_CALLS
                    .iter()
                    .any(|s| d == *s || d.starts_with(&format!("{s}.")))
            });
        !safe
    }

    /// `self.request.get_json()`-style calls: a read, not a method of `self`.
    fn reads_request_input_call(&self, c: &ast::ExprCall) -> bool {
        matches!(c.func.as_ref(), Expr::Attribute(a) if self.reads_request_input(a))
    }

    /// A request header an expression reads by literal name: `request.headers.get("x")`,
    /// `request.headers["x"]`, `request.META["HTTP_X"]` / `.get(...)`, on a request
    /// (`request`, `req`, `self.request`, or a parameter of the function).
    pub(crate) fn header_read(&self, e: &Expr) -> Option<String> {
        match e {
            Expr::Subscript(s) => self.header_from(&s.value, &s.slice),
            Expr::Call(c) => self.header_read_call(c),
            _ => None,
        }
    }

    pub(crate) fn header_read_call(&self, c: &ast::ExprCall) -> Option<String> {
        let Expr::Attribute(a) = c.func.as_ref() else {
            return None;
        };
        if !matches!(a.attr.as_str(), "get" | "getlist" | "get_all") {
            return None;
        }
        self.header_from(&a.value, c.arguments.args.first()?)
    }

    fn header_from(&self, container: &Expr, key: &Expr) -> Option<String> {
        let Expr::Attribute(h) = container else {
            return None;
        };
        let request = match h.value.as_ref() {
            Expr::Name(n) => {
                matches!(n.id.as_str(), "request" | "req")
                    || self
                        .param_ops
                        .last()
                        .is_some_and(|f| f.contains_key(n.id.as_str()))
            }
            Expr::Attribute(a) => {
                a.attr.as_str() == "request"
                    && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self")
            }
            _ => false,
        };
        if !request {
            return None;
        }
        let key = string_value(key)?;
        match h.attr.as_str() {
            "headers" => header_name(&key),
            "META" => meta_header(&key),
            _ => None,
        }
    }

    /// `e` is a name the module binds at top level or imports, other than a
    /// framework's request state (Flask's `g`): an object that outlives the call of
    /// the function that writes on it.
    pub(crate) fn module_object(&self, e: &Expr) -> bool {
        let Expr::Name(n) = e else {
            return false;
        };
        match self.resolve(n.id.as_str()) {
            Some(RawBase::Local(_)) => true,
            Some(RawBase::Import { spec, .. }) => {
                !["flask", "werkzeug", "fastapi", "starlette", "django"]
                    .iter()
                    .any(|p| spec == *p || spec.starts_with(&format!("{p}.")))
            }
            _ => false,
        }
    }

    /// The call keeps a value on an object of the module (`current_org.set(org_id)`
    /// on a `ContextVar`, `setattr(_local, "org", org_id)`)
    /// ([`drift_core::controls::KEEPS_VALUE`]).
    pub(crate) fn note_kept(&mut self, c: &ast::ExprCall) {
        if self.frames.is_empty() {
            return;
        }
        let given = |i: usize| c.arguments.args.get(i).is_some_and(|a| !literal_value(a));
        let kept = match c.func.as_ref() {
            Expr::Attribute(a) if a.attr.as_str() == "set" => {
                self.module_object(&a.value) && given(0)
            }
            Expr::Name(n) if n.id.as_str() == "setattr" => {
                c.arguments
                    .args
                    .first()
                    .is_some_and(|x| self.module_object(x))
                    && given(2)
            }
            _ => false,
        };
        if kept {
            self.controls
                .insert(drift_core::controls::KEEPS_VALUE.into());
        }
    }

    /// What an assignment binds for the practice facts: in a class body, the schema a
    /// view validates input with (`serializer_class = X`, `form_class = X`); in a
    /// function, locals bound to a response or error, or to a value a check reads, and
    /// a status setter (`response.status_code = 201`).
    pub(crate) fn practice_assign(&mut self, a: &ast::StmtAssign) {
        if self.frames.is_empty() {
            if self.scopes.last().is_some_and(|s| s.class)
                && let [Expr::Name(n)] = a.targets.as_slice()
                && matches!(n.id.as_str(), "serializer_class" | "form_class")
                && let Some(r) = self.canon(&a.value)
                && !matches!(r.base, RawBase::Global(_))
            {
                self.inputs.insert(RawInput::Validated(r));
            }
            return;
        }
        // A value written on an object of the module (`_local.tenant_id = tenant`,
        // `CURRENT[key] = org`): kept past the request
        // ([`drift_core::controls::KEEPS_VALUE`]).
        if !literal_value(&a.value)
            && a.targets.iter().any(|t| match t {
                Expr::Attribute(x) => self.module_object(&x.value),
                Expr::Subscript(x) => self.module_object(&x.value),
                _ => false,
            })
        {
            self.controls
                .insert(drift_core::controls::KEEPS_VALUE.into());
        }
        for t in &a.targets {
            match t {
                Expr::Name(n) => {
                    let name = n.id.to_string();
                    let resp = match a.value.as_ref() {
                        Expr::Call(c) => self
                            .l
                            .response_call(c, self.canon(&c.func), true, false)
                            .or_else(|| self.l.response_call(c, self.canon(&c.func), false, false)),
                        _ => None,
                    };
                    match resp {
                        Some(r) => {
                            self.response_vars.insert(name.clone(), r);
                        }
                        None => {
                            self.response_vars.remove(&name);
                        }
                    }
                    match self.log_init(&a.value) {
                        Some(r) => {
                            self.log_locals.insert(name.clone(), r);
                        }
                        None => {
                            self.log_locals.remove(&name);
                        }
                    }
                    let side = self.side(&a.value);
                    self.side_locals.insert(name.clone(), side);
                    if matches!(a.value.as_ref(), Expr::BoolOp(_) | Expr::If(_)) {
                        self.either_locals.insert(name.clone());
                    } else {
                        self.either_locals.remove(&name);
                    }
                    let read = self.operand(&a.value, 0);
                    let keyed = self.compare_operand(&a.value, read.clone());
                    if keyed != read.0 && !matches!(keyed, RawOperand::None) {
                        self.hmac_locals.insert(name.clone(), keyed);
                    } else {
                        self.hmac_locals.remove(&name);
                    }
                    // A local bound to a value of the caller is one
                    // ([`Collector::caller_value`]).
                    if self.caller_self(&a.value) {
                        self.self_locals.insert(name.clone());
                    } else {
                        self.self_locals.remove(&name);
                    }
                    match self.caller_value(&a.value) {
                        // What a helper may give, under a name that says the
                        // caller: the name decides, as it did (`session =
                        // make_session()`).
                        Some(Some(RawDep::Gives(_))) if names_caller(&name) => {
                            self.caller_locals.remove(&name);
                        }
                        Some(dep) => {
                            self.caller_locals.insert(name.clone(), dep);
                        }
                        None => {
                            self.caller_locals.remove(&name);
                        }
                    }
                    if matches!(read.0, RawOperand::None | RawOperand::Literal) {
                        self.check_locals.remove(&name);
                    } else {
                        self.check_locals.insert(name, read);
                    }
                }
                // `g.venue_id = get_jwt()["venue_id"]`, `request.state.tenant =
                // claims["tid"]`: a value of the caller put where other code reads
                // it, under a name that does not say so.
                Expr::Attribute(_)
                    if !held(t)
                        && let Some(holder) = self.holder(t)
                        && let Some(dep) = self.caller_value(&a.value) =>
                {
                    self.caller_args.insert((holder, dep));
                }
                Expr::Attribute(at) if at.attr.as_str() == "status_code" => {
                    if let Some(status) = status_of(&a.value) {
                        self.responses.insert(RawResponse {
                            status,
                            via: ResponseVia::Setter,
                            builder: None,
                            model: None,
                            keys: vec![],
                            in_catch: self.in_except > 0,
                        });
                    }
                }
                other => {
                    let mut names = Vec::new();
                    super::target_names(other, &mut names);
                    for n in names {
                        self.response_vars.remove(n);
                        self.check_locals.remove(n);
                        self.caller_locals.remove(n);
                        self.self_locals.remove(n);
                        // Bound to a part of a value: not read.
                        self.side_locals.insert(n.to_string(), RawSide::Unread);
                    }
                }
            }
        }
    }

    /// The checks a condition makes: one per operand of `and` / `or`, each with what it
    /// reads, what it compares with, and whether it reads a subject (a user, session,
    /// token, role: [`drift_core::controls::names_subject`]) or a header or dependency.
    ///
    /// The last field says the operand is a comparison with another value (`a != b`,
    /// `compare_digest(a, b)`), also when that value could not be read: not a test of
    /// the value itself (`not a`, `a is None`).
    ///
    /// The operator says how it compares ([`drift_core::check_op`]): whether the exit
    /// is taken where the two values differ or where they match, through any `not`
    /// around it (`negated`); empty for a test of the value itself.
    ///
    /// Each comes with the other operands of the effective `and` it stands in, in
    /// words, when there are any: `x is not None and a != b` exits on `a != b` only
    /// when `x is not None`.
    fn conditions(
        &self,
        test: &Expr,
        out: &mut Vec<(Operand, Option<String>)>,
        depth: usize,
        negated: bool,
    ) {
        if depth > MAX_DEPTH {
            return;
        }
        match test {
            // An effective `and`: `a and b`, or `not (a or b)`.
            Expr::BoolOp(b)
                if b.values.len() > 1 && matches!(b.op, ast::BoolOp::And) != negated =>
            {
                for (i, v) in b.values.iter().enumerate() {
                    let others: Vec<String> = b
                        .values
                        .iter()
                        .enumerate()
                        .filter(|(j, _)| *j != i)
                        .map(|(_, o)| {
                            if negated {
                                format!("not {}", words(o))
                            } else {
                                words(o)
                            }
                        })
                        .collect();
                    let guard = others.join(" and ");
                    let mut inner = Vec::new();
                    self.conditions(v, &mut inner, depth + 1, negated);
                    out.extend(inner.into_iter().map(|(o, g)| {
                        let g = match g {
                            Some(g) => format!("{guard} and {g}"),
                            None => guard.clone(),
                        };
                        (o, Some(clip(g)))
                    }));
                }
            }
            Expr::BoolOp(b) => {
                for v in &b.values {
                    self.conditions(v, out, depth + 1, negated);
                }
            }
            Expr::UnaryOp(u) if matches!(u.op, ast::UnaryOp::Not) => {
                self.conditions(&u.operand, out, depth + 1, !negated)
            }
            _ => {
                let mut flat = Vec::new();
                self.operands(test, &mut flat, negated);
                out.extend(flat.into_iter().map(|o| (o, None)));
            }
        }
    }

    /// One operand of a condition ([`Collector::conditions`]).
    fn operands(&self, test: &Expr, out: &mut Vec<Operand>, negated: bool) {
        use drift_core::check_op::{OTHER, REFUSES_MATCH, REFUSES_MISMATCH};
        let polarity = |equal: bool| {
            if equal != negated {
                REFUSES_MATCH
            } else {
                REFUSES_MISMATCH
            }
        };
        match test {
            Expr::Compare(c) if c.ops.len() == 1 => {
                let (mut l, mut r) = (c.first_operand(), c.second_operand());
                let (mut a, mut b) = (self.operand(l, 0), self.operand(r, 0));
                let lit = |x: &Read| {
                    matches!(
                        x.0,
                        RawOperand::Literal | RawOperand::None | RawOperand::Env
                    )
                };
                if lit(&a) && !lit(&b) {
                    std::mem::swap(&mut a, &mut b);
                    std::mem::swap(&mut l, &mut r);
                }
                let against_none = matches!(r, Expr::NoneLiteral(_));
                let compares = match c.ops[0] {
                    ast::CmpOp::Is | ast::CmpOp::IsNot if against_none => RawOperand::None,
                    _ => self.compare_operand(r, b.clone()),
                };
                let subject =
                    names_subject_in(test) || [&a.0, &b.0].iter().any(|o| reads_caller(o));
                let op = match c.ops[0] {
                    _ if against_none => "",
                    ast::CmpOp::Eq | ast::CmpOp::Is | ast::CmpOp::In => polarity(true),
                    ast::CmpOp::NotEq | ast::CmpOp::IsNot | ast::CmpOp::NotIn => polarity(false),
                    _ => OTHER,
                };
                let sides = (!against_none).then(|| (self.side(l), self.side(r)));
                out.push((a, compares, subject, !against_none, op, sides));
            }
            // `hmac.compare_digest(given, expected)`, `secrets.compare_digest(...)`.
            Expr::Call(c)
                if last_name(&c.func) == Some("compare_digest") && c.arguments.args.len() == 2 =>
            {
                let (mut l, mut r) = (&c.arguments.args[0], &c.arguments.args[1]);
                let (mut a, mut b) = (self.operand(l, 0), self.operand(r, 0));
                let lit = |x: &Read| {
                    matches!(
                        x.0,
                        RawOperand::Literal | RawOperand::None | RawOperand::Env
                    )
                };
                // The given value is the one read off the request.
                if (lit(&a) && !lit(&b))
                    || (!matches!(a.0, RawOperand::Header(_))
                        && matches!(b.0, RawOperand::Header(_)))
                {
                    std::mem::swap(&mut a, &mut b);
                    std::mem::swap(&mut l, &mut r);
                }
                let subject = names_subject_in(test) || reads_caller(&a.0) || reads_caller(&b.0);
                let compares = self.compare_operand(r, b);
                let sides = Some((self.side(l), self.side(r)));
                out.push((a, compares, subject, true, polarity(true), sides));
            }
            e => {
                let a = self.operand(e, 0);
                let subject = names_subject_in(e) || reads_caller(&a.0);
                out.push((a, RawOperand::None, subject, false, "", None));
            }
        }
    }

    /// How the first exit of a block turns the caller away, if it does: what it raises
    /// or returns, `abort(n)`, or a redirect to a sign-in page.
    pub(crate) fn exit_outcome(&self, body: &[Stmt]) -> Option<CheckOutcome> {
        for s in body {
            match s {
                Stmt::Raise(r) => {
                    let e = r.exc.as_deref()?;
                    return self.raised_outcome(e);
                }
                Stmt::Return(r) => {
                    let e = r.value.as_deref()?;
                    return self.returned_outcome(e);
                }
                Stmt::Expr(x) => {
                    if let Some(answer) = self.asgi_answer(&x.value, body) {
                        return answer;
                    }
                    if let Expr::Call(c) = x.value.as_ref() {
                        match last_name(&c.func) {
                            Some("abort") => {
                                return c
                                    .arguments
                                    .args
                                    .first()
                                    .and_then(status_of)
                                    .and_then(outcome_of_status);
                            }
                            Some("redirect_to_login") => return Some(CheckOutcome::SignInRedirect),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// An answer sent by hand in an ASGI callable, where `e` is one: a response
    /// awaited with the three ASGI arguments (`await response(scope, receive,
    /// send)`, the response built there or bound in the block before), or the start
    /// message with its status (`await send({"type": "http.response.start",
    /// "status": 401})`). What it turns the caller away as, if it does.
    fn asgi_answer(&self, e: &Expr, block: &[Stmt]) -> Option<Option<CheckOutcome>> {
        let Expr::Await(a) = e else { return None };
        let Expr::Call(c) = a.value.as_ref() else {
            return None;
        };
        let names: Vec<&str> = c
            .arguments
            .args
            .iter()
            .filter_map(|x| match x {
                Expr::Name(n) => Some(n.id.as_str()),
                _ => None,
            })
            .collect();
        if names == ["scope", "receive", "send"] && c.arguments.keywords.is_empty() {
            let built = match c.func.as_ref() {
                Expr::Name(n) => block.iter().find_map(|s| match s {
                    Stmt::Assign(x) => match x.targets.as_slice() {
                        [Expr::Name(t)] if t.id == n.id => Some(x.value.as_ref()),
                        _ => None,
                    },
                    _ => None,
                })?,
                built @ Expr::Call(_) => built,
                _ => return None,
            };
            return Some(self.returned_outcome(built));
        }
        if let (Expr::Name(f), [Expr::Dict(d)]) = (c.func.as_ref(), &*c.arguments.args)
            && f.id.as_str() == "send"
        {
            let status = d.items.iter().find_map(|i| match i.key.as_ref()? {
                Expr::StringLiteral(k) if k.value.to_str() == "status" => status_of(&i.value),
                _ => None,
            })?;
            return Some(outcome_of_status(status));
        }
        None
    }

    fn raised_outcome(&self, e: &Expr) -> Option<CheckOutcome> {
        if let Expr::Name(n) = e {
            if let Some(r) = self.response_vars.get(n.id.as_str()) {
                return outcome_of_status(r.status);
            }
            if let Some(r) = self.rejection_vars.get(n.id.as_str()) {
                return Some(outcome_of_rejection(*r));
            }
        }
        let c = match e {
            Expr::Call(c) => c,
            // `raise PermissionDenied`, `raise Http404`: the class's own status.
            other => {
                let d = self.canon(other).as_ref().and_then(dotted)?;
                return lookup(HTTP_ERRORS, &d)
                    .filter(|s| *s != 0)
                    .and_then(outcome_of_status);
            }
        };
        if let Some(r) = self.l.response_call(c, self.canon(&c.func), true, false)
            && let Some(o) = outcome_of_status(r.status)
        {
            return Some(o);
        }
        super::rejection_marker(e, 0).map(outcome_of_rejection)
    }

    pub(crate) fn returned_outcome(&self, e: &Expr) -> Option<CheckOutcome> {
        match e {
            Expr::Name(n) => self
                .response_vars
                .get(n.id.as_str())
                .and_then(|r| outcome_of_status(r.status)),
            Expr::Tuple(t) => t
                .elts
                .get(1)
                .and_then(status_of)
                .and_then(outcome_of_status),
            Expr::Call(c) => {
                let name = last_name(&c.func)?;
                if matches!(
                    name,
                    "redirect" | "RedirectResponse" | "HttpResponseRedirect"
                ) && c
                    .arguments
                    .args
                    .first()
                    .is_some_and(|a| super::names_sign_in(a, 0))
                {
                    return Some(CheckOutcome::SignInRedirect);
                }
                if name == "redirect_to_login" {
                    return Some(CheckOutcome::SignInRedirect);
                }
                if name == "unauthorized" {
                    return Some(CheckOutcome::Unauthenticated);
                }
                if let Some(r) = self.l.response_call(c, self.canon(&c.func), false, false)
                    && let Some(o) = outcome_of_status(r.status)
                {
                    return Some(o);
                }
                super::rejection_marker(e, 0)
                    .filter(|_| name.ends_with("Response") || name == "jsonify")
                    .map(outcome_of_rejection)
            }
            _ => None,
        }
    }

    /// The checks an `if` (or `elif`) makes that turn the caller away
    /// ([`drift_core::BodyCheck`]): its first exit rejects the caller, outside any
    /// `except` and before the function hands control on. A 403 or a 404 counts only
    /// when the condition reads a subject, a header or a dependency.
    ///
    /// `cond`: why the `if` itself does not run for every request, when it does not
    /// ([`Collector::not_always`]). An operand of an effective `and` is conditional on
    /// the others ([`drift_core::not_always::AND_OPERAND`]).
    pub(crate) fn note_body_checks(
        &mut self,
        test: &Expr,
        body: &[Stmt],
        cond: Option<(&'static str, String)>,
    ) {
        if !self.counting() || self.frames.is_empty() {
            return;
        }
        self.claim_exit(test, body);
        self.note_raise_checks(test, body, &cond);
        let Some(outcome) = self.exit_outcome(body) else {
            return;
        };
        let mut conds = Vec::new();
        self.conditions(test, &mut conds, 0, false);
        let roles = self.roles_beside(test, &conds, &cond);
        let mut role_sides = roles.iter().flat_map(|(sides, _)| sides.iter().cloned());
        for (((source, reads), compares, subject, compared, op, sides), guard) in conds {
            let role = role_operand(compared, &compares);
            let role_side = match (&roles, role) {
                (Some(_), true) => role_sides.next(),
                _ => None,
            };
            if matches!(outcome, CheckOutcome::Forbidden | CheckOutcome::NotFound) && !subject {
                continue;
            }
            if matches!(source, RawOperand::Literal | RawOperand::Env) {
                continue;
            }
            if let Some((left, right)) = sides.or(role_side.map(|s| (s, RawSide::Literal))) {
                self.check_sides.insert(RawCheckSides {
                    source: source.clone(),
                    reads: reads.clone(),
                    compares: compares.clone(),
                    left,
                    right,
                });
            }
            let (condition, unless) = match &roles {
                Some((_, words)) => why_beside_roles(role, words, guard),
                None => why(&cond, guard),
            };
            self.body_checks.insert(RawBodyCheck {
                source,
                reads,
                compares,
                outcome,
                op: op.to_string(),
                conditional: !condition.is_empty(),
                condition,
                unless,
                after: self.called_before(),
            });
        }
    }

    /// Where a condition refuses a caller unless a role or one comparison holds
    /// ([`role_alternatives`]), and every operand of it was read as one check: the
    /// side each role is read off ([`Collector::side`]), in the order written, and
    /// the roles in the code's own words. None where the condition is another, where
    /// it stands under a condition of its own (`cond`), and where its operands do
    /// not read one for one (the checks are then operands of an `and`, as before).
    fn roles_beside(
        &self,
        test: &Expr,
        conds: &[(Operand, Option<String>)],
        cond: &Option<(&'static str, String)>,
    ) -> Option<(Vec<RawSide>, Vec<String>)> {
        if cond.is_some() {
            return None;
        }
        let roles = role_alternatives(test)?;
        let read_as_roles = conds
            .iter()
            .filter(|((_, compares, _, compared, _, _), _)| role_operand(*compared, compares))
            .count();
        (conds.len() == roles.len() + 1 && read_as_roles == roles.len()).then(|| {
            (
                roles.iter().map(|e| self.side(e)).collect(),
                roles.iter().map(|e| words(e)).collect(),
            )
        })
    }

    /// The first exit of the block turns the caller away: a `raise`, an error answer,
    /// `abort(n)`.
    pub(crate) fn first_exit_refuses(&self, body: &[Stmt]) -> bool {
        body.iter()
            .find(|s| matches!(s, Stmt::Raise(_) | Stmt::Return(_)))
            .is_some_and(|s| self.refuses(s))
            || self.exit_outcome(body).is_some()
    }

    /// The first exit of an `if` that refuses is explained by the condition, where
    /// every operand of it was read; where one was not (`if not ok:`, `ok` bound to a
    /// comparison; `if not any(...)`), the body turns requests away on what the facts
    /// do not hold ([`drift_core::controls::UNREAD_EXIT`]).
    fn claim_exit(&mut self, test: &Expr, body: &[Stmt]) {
        if !self.first_exit_refuses(body) {
            return;
        }
        if let Some(exit) = body
            .iter()
            .find(|s| matches!(s, Stmt::Raise(_) | Stmt::Return(_)))
        {
            self.claimed
                .insert(exit.range().start(), self.skipped.is_some());
        }
        let mut conds = Vec::new();
        self.conditions(test, &mut conds, 0, false);
        let unread = conds.is_empty()
            || conds
                .iter()
                .any(|(((source, _), compares, _, compared, _, _), _)| {
                    *source == RawOperand::None && (!compared || *compares == RawOperand::None)
                });
        if unread {
            self.controls
                .insert(drift_core::controls::UNREAD_EXIT.into());
        }
    }

    /// A `raise` or an error answer that only some requests reach and that is not the
    /// first exit of an `if` whose condition was read: after a branch that returned
    /// (`if same: return rule` / `raise ...`), in a loop, a `match` case, an `else`.
    pub(crate) fn note_unread_exit(&mut self, exit: &Stmt) {
        if !self.counting() || self.frames.is_empty() {
            return;
        }
        // The body returned for some requests, and not for none (`Some("")` is what
        // follows an exit every request takes: it never runs).
        let returned = self.skipped.as_ref().is_some_and(|w| !w.is_empty());
        let unread = match self.claimed.get(&exit.range().start()) {
            // A return between the condition and the exit (`if a:` / `if b: return x`
            // / `raise`): the condition read is not all the exit depends on.
            Some(returned_then) => returned && !returned_then,
            None => returned || !self.conds.is_empty(),
        };
        if unread {
            self.controls
                .insert(drift_core::controls::UNREAD_EXIT.into());
        }
    }

    /// A comparison by a tenant or an owner key that no check records
    /// ([`drift_core::controls::SCOPE_UNREAD`]): anywhere but in the condition of an
    /// `if` whose first exit refuses, which is read as a check.
    ///
    /// [STRICT] A comparison of a value of the caller with another value is kept
    /// there too. A check records it only where the exit is one a check reads and
    /// the condition names a subject: `if row.venue_id != get_jwt()["venue_id"]:
    /// abort(404)` names none, and `if row.venue_id != g.user.venue_id: raise
    /// Gone()` or `return jsonify(error=...), 400` is no exit a check reads. Either
    /// left the body with nothing found.
    pub(crate) fn note_scope_compare(&mut self, c: &ast::ExprCompare) {
        if self.in_annotation || self.frames.is_empty() {
            return;
        }
        let refusal = self.refusal_test > 0;
        let against_none = c.operands.iter().any(|x| matches!(x, Expr::NoneLiteral(_)));
        let compares = c.ops.iter().any(|op| {
            matches!(
                op,
                ast::CmpOp::Eq
                    | ast::CmpOp::NotEq
                    | ast::CmpOp::In
                    | ast::CmpOp::NotIn
                    | ast::CmpOp::Is
                    | ast::CmpOp::IsNot
            )
        });
        if against_none || !compares {
            return;
        }
        let key = |e: &Expr| match e {
            Expr::Attribute(a) => scope_key(a.attr.as_str()),
            Expr::Name(n) => scope_key(n.id.as_str()),
            _ => false,
        };
        // A value of the caller against another value, whatever the key is called
        // (`s.depot_id != request.user.depot_id`); not against a literal, which
        // asks what the caller is (`request.user.kind == "staff"`).
        let literal = |e: &Expr| {
            matches!(
                e,
                Expr::StringLiteral(_)
                    | Expr::BytesLiteral(_)
                    | Expr::NumberLiteral(_)
                    | Expr::BooleanLiteral(_)
                    | Expr::EllipsisLiteral(_)
            )
        };
        let compared = !c.operands.iter().any(literal);
        // A value of the caller by its own source (a name, an accessor).
        let caller = compared
            && c.operands
                .iter()
                .any(|e| self.caller_value(e) == Some(None));
        // Compared with what a declared dependency, a helper or a holder gives: the
        // caller's where a reader finds it so (`Depends(get_db)` gives no identity;
        // [`drift_core::Symbol::caller_args`], the giver as its own callee).
        if compared && !caller && !self.frames.is_empty() {
            for e in c.operands.iter() {
                let Some(Some(dep)) = self.caller_value(e) else {
                    continue;
                };
                self.note_given_use(dep);
            }
        }
        if refusal {
            if caller {
                self.controls
                    .insert(drift_core::controls::SCOPE_UNREAD.into());
            }
            return;
        }
        if compared && c.operands.iter().any(|e| self.param_value(e)) {
            self.controls
                .insert(drift_core::controls::PARAM_FLOWS.into());
        }
        // [STRICT] What a holder keeps (`g.reviewer.funder_id`), compared with
        // another value outside a check: a filter through a query API no fact reads
        // (Peewee's `.where(Award.funder_id == g.reviewer.funder_id)`) may be the
        // caller's scope, whoever put the value there.
        let given = compared
            && c.operands.iter().any(|e| {
                matches!(e, Expr::Attribute(_) | Expr::Subscript(_))
                    && matches!(self.caller_value(e), Some(Some(RawDep::Gives(_))))
            });
        if caller || given || c.operands.iter().any(key) {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
    }

    /// A comparison or a filter by a value that a declared dependency, an
    /// annotation that may name one (`grower: CurrentGrower`), a helper or a holder
    /// gives (`dep`): the giver as its own callee ([`drift_core::Symbol::caller_args`]),
    /// for a reader to say whether it gives the caller, whatever the key compared
    /// is called. An annotation that names no dependency is dropped where it is
    /// linked.
    fn note_given_use(&mut self, dep: RawDep) {
        fn annotated(d: &RawDep) -> Option<RawRef> {
            match d {
                RawDep::Alias(r) => Some(r.clone()),
                RawDep::Optional(inner) => annotated(inner),
                _ => None,
            }
        }
        // Of the dependency itself, also where the value is one operand of `or`
        // (`x_org or user.org_id`).
        let gives = matches!(dep, RawDep::Gives(_)) || declared(&dep);
        let giver = if gives { giver(&dep) } else { annotated(&dep) };
        if let Some(r) = giver {
            self.caller_args.insert((r, Some(dep)));
        }
    }

    /// A path through a member named for a tenant to what it holds
    /// (`caller.organization.rules`, `request.user.team.projects`): the rows are the
    /// tenant's by how they are reached ([`drift_core::controls::SCOPE_UNREAD`]). The
    /// tenant's own name or id is not one.
    pub(crate) fn note_scope_path(&mut self, a: &ast::ExprAttribute) {
        if self.in_annotation || self.frames.is_empty() {
            return;
        }
        if matches!(a.attr.as_str(), "id" | "pk" | "uuid" | "slug" | "name")
            || practice::tenant_key(a.attr.as_str())
        {
            return;
        }
        // A member named for a tenant on the way: `<value>.organization.rules`. Or
        // what belongs to the caller, by members whatever they are called: two past a
        // subject (`g.user.venue.events`), or one where a query method is called on it
        // (`request.user.shipments.filter(...)`). The method called is no member.
        let method = self.method_end == Some(a.range().end());
        let relation = method && RELATION_METHODS.contains(&a.attr.as_str());
        let mut members = usize::from(!method);
        let needed = if relation { 1 } else { 2 };
        let mut at: &Expr = &a.value;
        loop {
            let name = match at {
                Expr::Attribute(x) => x.attr.as_str(),
                Expr::Name(n) => n.id.as_str(),
                _ => return,
            };
            let attribute = matches!(at, Expr::Attribute(_));
            if (attribute && practice::tenant_key(name))
                || (members >= needed && drift_core::controls::names_subject(name))
            {
                self.controls
                    .insert(drift_core::controls::SCOPE_UNREAD.into());
                return;
            }
            let Expr::Attribute(x) = at else { return };
            members += 1;
            at = &x.value;
        }
    }

    /// The expression is a value of the caller. The sources, a closed list:
    ///
    /// 1. A name or a member path with a name that says a subject, by the name's
    ///    last word ([`names_caller`]): `current_user.<x>` (flask_login,
    ///    flask_jwt_extended), `g.user.<x>`, `request.user.<x>`, `request.auth`,
    ///    `self.request.user`, `session[...]`, `request.session[...]`,
    ///    `request.state.user.<x>`. `users_bp` and `auth_router` are none.
    /// 2. What a request-scoped holder keeps of the caller ([`held`]): an attribute
    ///    of Flask's `g` or of `<request>.state` whose name is user-like
    ///    ([`user_like`]: `g.principal`, `g.tenant_id`, `request.state.claims`), and
    ///    the caller's items of the ASGI scope (`request.scope["user"]`).
    /// 3. What a claims accessor hands back ([`CALLER_ACCESSORS`]): `get_jwt()`,
    ///    `get_jwt_identity()`, `get_current_user()`, called with nothing.
    /// 4. What a declared dependency gives (a parameter with `Depends(...)`, or an
    ///    annotation the linker may find one behind), with that dependency: a reader
    ///    says whether it signs the caller in (`Depends(get_db)` gives no identity).
    ///    A member of it that says the caller by 1 or 2 is the caller's whatever the
    ///    dependency (`request.user` of `request: Request`).
    /// 5. What is read off any of these: an attribute, an item, `.get("key")`,
    ///    `str(...)` / `int(...)`, what is awaited, an operand of `or` or a branch of
    ///    a conditional expression; and a local the body assigned one of these to
    ///    ([`Collector::caller_locals`]: `venue = get_jwt()["venue_id"]`).
    ///
    /// A parameter of the function by itself is what its caller passed, whatever it
    /// is called (`user_id` of `/users/{user_id}`). None for anything else.
    ///
    /// What is recorded from it (a callee handed the value, a comparison with it)
    /// only ever keeps a unit from reading `none`: no check is made of it here.
    pub(crate) fn caller_value(&self, e: &Expr) -> Option<Option<RawDep>> {
        self.caller_source(e, 0)
    }

    fn caller_source(&self, e: &Expr, depth: usize) -> Option<Option<RawDep>> {
        if depth > MAX_DEPTH + 4 {
            return None;
        }
        let any = |es: &[&Expr]| es.iter().find_map(|x| self.caller_source(x, depth + 1));
        match e {
            Expr::Starred(s) => self.caller_source(&s.value, depth + 1),
            Expr::Await(a) => self.caller_source(&a.value, depth + 1),
            Expr::BoolOp(b) => any(&b.values.iter().collect::<Vec<_>>()),
            Expr::If(i) => any(&[i.body.as_ref(), i.orelse.as_ref()]),
            Expr::Call(c) => {
                let bare = c.arguments.args.is_empty() && c.arguments.keywords.is_empty();
                if bare && last_name(&c.func).is_some_and(|n| CALLER_ACCESSORS.contains(&n)) {
                    return Some(None);
                }
                // What a token verifier hands back of a value of the caller:
                // `jwt.decode(token, key, algorithms=[...])`.
                if self
                    .canon(&c.func)
                    .as_ref()
                    .and_then(dotted)
                    .is_some_and(|d| TOKEN_DECODERS.contains(&d.as_str()))
                    && let Some(token) = c.arguments.args.first()
                    && let Some(source) = self.caller_source(token, depth + 1)
                {
                    return Some(source);
                }
                // An object built from a value of the caller alone:
                // `TokenPayload(**payload)`.
                if let ([], [only]) = (&*c.arguments.args, &*c.arguments.keywords)
                    && only.arg.is_none()
                    && let Some(source) = self.caller_source(&only.value, depth + 1)
                {
                    return Some(source);
                }
                // The row a primary key of the caller's names: `db.get(User,
                // claims.sub)`, `User.objects.get(pk=claims["sub"])`.
                if let Expr::Attribute(a) = c.func.as_ref()
                    && a.attr.as_str() == "get"
                {
                    let key = match (&*c.arguments.args, &*c.arguments.keywords) {
                        ([Expr::Name(_) | Expr::Attribute(_), key], []) => Some(key),
                        ([], [k])
                            if k.arg
                                .as_ref()
                                .is_some_and(|n| matches!(n.as_str(), "pk" | "id")) =>
                        {
                            Some(&k.value)
                        }
                        _ => None,
                    };
                    if let Some(source) = key.and_then(|k| self.caller_source(k, depth + 1)) {
                        return Some(source);
                    }
                }
                match c.func.as_ref() {
                    // `claims.get("venue_id")`, `session.get("org", None)`.
                    Expr::Attribute(a)
                        if a.attr.as_str() == "get"
                            && c.arguments.keywords.is_empty()
                            && matches!(c.arguments.args.len(), 1 | 2)
                            && matches!(c.arguments.args[0], Expr::StringLiteral(_)) =>
                    {
                        self.caller_source(&a.value, depth + 1)
                    }
                    Expr::Name(n)
                        if matches!(n.id.as_str(), "str" | "int" | "UUID")
                            && c.arguments.args.len() == 1
                            && c.arguments.keywords.is_empty() =>
                    {
                        self.caller_source(&c.arguments.args[0], depth + 1)
                    }
                    _ => self.helper_gives(c).map(|r| Some(RawDep::Gives(r))),
                }
            }
            Expr::Name(_) | Expr::Attribute(_) | Expr::Subscript(_) => {
                // What the path is read off: a name, or a value built there.
                let mut root = e;
                while let Expr::Attribute(ast::ExprAttribute { value, .. })
                | Expr::Subscript(ast::ExprSubscript { value, .. }) = root
                {
                    root = value;
                }
                match root {
                    Expr::Name(n) => {
                        if let Some(dep) = self.caller_locals.get(n.id.as_str()) {
                            // What a helper may give, read by a name that says the
                            // caller: the name decides, as it did.
                            if matches!(dep, Some(RawDep::Gives(_)))
                                && (path_names(e).any(names_caller) || held(e))
                            {
                                return Some(None);
                            }
                            return Some(dep.clone());
                        }
                    }
                    Expr::Call(_) | Expr::Await(_) => return self.caller_source(root, depth + 1),
                    _ => return None,
                }
                // What a holder keeps under a name that says nothing
                // (`g.venue_id`): the caller's where code of the repository puts a
                // value of the caller there, which a reader finds.
                if !held(e)
                    && !path_names(e).any(names_caller)
                    && let Some(r) = self.holder(e)
                {
                    return Some(Some(RawDep::Gives(r)));
                }
                let (op, reads) = self.operand(e, 0);
                match op {
                    // What an annotation may name (`user: CurrentUser`) is a dependency
                    // where the linker finds one. A member that says the caller is the
                    // caller's whatever the parameter is of.
                    RawOperand::Dep(d, _) => {
                        let members = path_names(e).count().saturating_sub(1);
                        let by_name = path_names(e).take(members).any(names_caller) || held(e);
                        Some((!by_name).then_some(d))
                    }
                    RawOperand::Param(_) if reads.is_empty() => None,
                    _ => (path_names(e).any(names_caller) || held(e)).then_some(None),
                }
            }
            _ => None,
        }
    }

    /// The value is the caller itself or the key of the caller's record
    /// (`request.user`, `request.user.id`, `current_user.pk`, `get_jwt_identity()`,
    /// a local bound to one), and nothing read off the caller (`request.user
    /// .org_id`, `get_jwt()["venue_id"]`, `g.venue_id`): rows a query finds by it
    /// are rows of this caller and of no one else, whatever the key is called.
    pub(crate) fn caller_self(&self, e: &Expr) -> bool {
        let e = match e {
            Expr::Await(a) => a.value.as_ref(),
            e => e,
        };
        // `str(x)`, `int(x)`: the value converted.
        if let Expr::Call(c) = e
            && let Expr::Name(n) = c.func.as_ref()
            && matches!(n.id.as_str(), "str" | "int" | "UUID")
            && c.arguments.args.len() == 1
            && c.arguments.keywords.is_empty()
        {
            return self.caller_self(&c.arguments.args[0]);
        }
        if self.caller_value(e).is_none() {
            return false;
        }
        // What the key is read off, where it is the key of a record.
        let owner = match e {
            Expr::Attribute(a) if matches!(a.attr.as_str(), "id" | "pk") => a.value.as_ref(),
            e => e,
        };
        match owner {
            // `get_jwt_identity()`, `get_current_user()`: called with nothing.
            Expr::Call(c) => c.arguments.is_empty() && self.caller_value(owner) == Some(None),
            // A local bound to one; what a dependency gives a parameter; a name the
            // file imports (`current_user` of flask_login). A name the module
            // itself binds is a value of the module, whatever it is called.
            Expr::Name(n) => match self.caller_locals.contains_key(n.id.as_str()) {
                true => self.self_locals.contains(n.id.as_str()),
                false => {
                    matches!(self.operand(owner, 0).0, RawOperand::Dep(..))
                        || matches!(self.resolve(n.id.as_str()), Some(RawBase::Import { .. }))
                }
            },
            // `request.user`, `g.user`: the member that says the caller, read off
            // what is no value of the caller itself.
            Expr::Attribute(a) => {
                names_caller(a.attr.as_str()) && self.caller_value(&a.value).is_none()
            }
            _ => false,
        }
    }

    /// Where the value of an expression that is compared or filtered by comes from
    /// ([`drift_core::controls::SIDES`]): a value of the caller by the closed list
    /// ([`Collector::caller_value`]), what the request sent, a parameter, an
    /// attribute of `self`, a setting, a literal, what a call handed back, a
    /// module-level name. Anything else is not read. What is read off a value (an
    /// attribute, an item, a method of it) is of that value's origin.
    pub(crate) fn side(&self, e: &Expr) -> RawSide {
        self.side_at(e, 0)
    }

    /// [`drift_core::controls::ARG_VALUE`] of a call of the repository's code `r`:
    /// what each argument is.
    pub(crate) fn note_arg_sides(&mut self, r: &RawRef, c: &ast::ExprCall) {
        let positional = c
            .arguments
            .args
            .iter()
            .enumerate()
            .filter(|(_, a)| !matches!(a, Expr::Starred(_)))
            .map(|(i, a)| (format!("#{i}"), a));
        let keywords = c
            .arguments
            .keywords
            .iter()
            .filter_map(|k| k.arg.as_ref().map(|a| (a.to_string(), &k.value)));
        // Every call, also one given nothing: a reader says what a parameter of
        // the callee was handed by every call of it.
        let mut given: Vec<(String, RawSide)> = positional
            .chain(keywords)
            .map(|(key, value)| {
                let side = self.side(value);
                // The caller itself, or the key of the caller's record: said
                // apart from what is read off the caller.
                let own = matches!(
                    side,
                    RawSide::Caller | RawSide::Gives(_) | RawSide::Annotated(..)
                ) && self.caller_self(value);
                (
                    key,
                    if own {
                        RawSide::Own(Box::new(side))
                    } else {
                        side
                    },
                )
            })
            .collect();
        let unpacked = c
            .arguments
            .args
            .iter()
            .any(|a| matches!(a, Expr::Starred(_)))
            || c.arguments.keywords.iter().any(|k| k.arg.is_none());
        if unpacked {
            given.push(("*".into(), RawSide::Unread));
        }
        self.arg_sides.insert((r.clone(), given));
    }

    /// The parameter of the function a member path is read off, with the member
    /// read off it first: `("user", Some("org_id"))` of `user.org_id` where `user`
    /// is a parameter that is not a dependency. None where the path is read off the
    /// request (also a parameter `request` of a decorator's wrapper: `request.user`
    /// is the caller's by the closed list), a local, a dependency or anything else.
    fn parameter_root<'e>(&self, e: &'e Expr) -> Option<(&'e str, Option<&'e str>)> {
        self.root_parameter(e)
            .filter(|(p, _, plain)| *plain && *p != "request")
            .map(|(p, first, _)| (p, first))
    }

    /// [`Collector::parameter_root`] for any parameter, with whether it is one
    /// that is not a dependency.
    fn root_parameter<'e>(&self, e: &'e Expr) -> Option<(&'e str, Option<&'e str>, bool)> {
        let mut at = e;
        let mut first = None;
        loop {
            if self.is_request(at) {
                return None;
            }
            match at {
                Expr::Attribute(a) => {
                    first = Some(a.attr.as_str());
                    at = &a.value;
                }
                Expr::Subscript(s) => {
                    first = None;
                    at = &s.value;
                }
                Expr::Await(a) => at = &a.value,
                // `claims.get("org_id")`.
                Expr::Call(c) => match c.func.as_ref() {
                    Expr::Attribute(a) if a.attr.as_str() == "get" => {
                        first = None;
                        at = &a.value;
                    }
                    _ => return None,
                },
                Expr::Name(n) => {
                    let name = n.id.as_str();
                    let local = self.caller_locals.contains_key(name)
                        || self.check_locals.contains_key(name)
                        || self.side_locals.contains_key(name);
                    let op = self.param_ops.last().and_then(|f| f.get(name))?;
                    let plain = matches!(op, RawOperand::Param(_));
                    return (!local).then_some((name, first, plain));
                }
                _ => return None,
            }
        }
    }

    /// [`RawSide::Param`] of the parameter `name` of the function being read: its
    /// position among the positional parameters, a first `self` or `cls` left out.
    fn param_side(&self, name: &str) -> RawSide {
        let position = self.frame_params.last().and_then(|f| {
            let skip = usize::from(f.named.first().is_some_and(|p| p == "self" || p == "cls"));
            f.named[..f.positional]
                .iter()
                .position(|p| p == name)
                .and_then(|i| i.checked_sub(skip))
                .map(|i| i as u32)
        });
        RawSide::Param(name.to_string(), position)
    }

    fn side_at(&self, e: &Expr, depth: usize) -> RawSide {
        if depth > MAX_DEPTH {
            return RawSide::Unread;
        }
        let e = match e {
            Expr::Await(a) => a.value.as_ref(),
            e => e,
        };
        let literal = |x: &Expr| {
            matches!(
                x,
                Expr::StringLiteral(_)
                    | Expr::BytesLiteral(_)
                    | Expr::NumberLiteral(_)
                    | Expr::BooleanLiteral(_)
                    | Expr::NoneLiteral(_)
            )
        };
        if literal(e) || elements(e).is_some_and(|els| !els.is_empty() && els.iter().all(literal)) {
            return RawSide::Literal;
        }
        if self.env_value(e, 0) {
            return RawSide::Setting;
        }
        // `x_org_id or caller.org_id`, `a if c else b`: either value, so one origin
        // only where every operand has it (the header, when sent, replaces the
        // caller's organization).
        let operands: Vec<&Expr> = match e {
            Expr::BoolOp(b) => b.values.iter().collect(),
            Expr::If(i) => vec![i.body.as_ref(), i.orelse.as_ref()],
            _ => vec![],
        };
        if !operands.is_empty() {
            let sides: Vec<RawSide> = operands
                .iter()
                .map(|x| self.side_at(x, depth + 1))
                .collect();
            return if sides.iter().all(|s| *s == sides[0]) {
                sides[0].clone()
            } else {
                RawSide::Unread
            };
        }
        // `str(x)`, `int(x)`: the value converted.
        if let Expr::Call(c) = e
            && let Expr::Name(n) = c.func.as_ref()
            && matches!(n.id.as_str(), "str" | "int" | "UUID")
            && c.arguments.args.len() == 1
            && c.arguments.keywords.is_empty()
        {
            return self.side_at(&c.arguments.args[0], depth + 1);
        }
        let caller = self.caller_value(e);
        if caller == Some(None) {
            // Read off a local bound to either of two values: of what it was bound
            // to (`org = org or user.org_id` is of no one origin).
            let mut root = e;
            while let Expr::Attribute(ast::ExprAttribute { value, .. })
            | Expr::Subscript(ast::ExprSubscript { value, .. }) = root
            {
                root = value;
            }
            if let Expr::Name(n) = root
                && self.either_locals.contains(n.id.as_str())
                && let Some(side) = self.side_locals.get(n.id.as_str())
            {
                return side.clone();
            }
            // Read off a local the body bound to what is no value of the caller,
            // whatever it is called (`user = Member.objects.get(pk=request.GET
            // ["uid"])`, then `user.org_id`): of what it was bound to. A name is no
            // source.
            if let Expr::Name(n) = root
                && !self.caller_locals.contains_key(n.id.as_str())
                && let Some(side) = self.side_locals.get(n.id.as_str())
            {
                return side.clone();
            }
            // A name is no source, nor a member's name: a header the handler is
            // given (`x_role: str = Header("")`) is what the request sent, and what is
            // read off a parameter whose annotation only may name a dependency
            // (`body: Body`, then `body.acting_role`) is what that gives, whatever it
            // is called: a reader judges it. A framework's request (`request:
            // Request`) is read as it was.
            if self.header_read(e).is_some()
                || matches!(self.operand(e, 0).0, RawOperand::Header(_))
            {
                return RawSide::Request;
            }
            if let RawOperand::Dep(d @ RawDep::Alias(_), _) = self.operand(e, 0).0
                && let RawDep::Alias(r) = &d
                && !dotted(r).is_some_and(|x| {
                    [
                        "fastapi.",
                        "starlette.",
                        "django.",
                        "flask.",
                        "rest_framework.",
                    ]
                    .iter()
                    .any(|p| x.starts_with(p))
                })
            {
                return RawSide::Gives(d);
            }
            // A name is no source: what is read off a parameter of the function is
            // whatever was passed for it (`user.org_id` of `def check(user, doc)`,
            // a body model `user: UserIn` of a handler), and off `self` what the
            // object holds, whatever they are called. The caller's request on a
            // view (`self.request.user`) is read as the request is.
            return match self.parameter_root(e) {
                Some((p, first)) if p == "self" || p == "cls" => match first {
                    Some(attr) => RawSide::SelfAttr(attr.to_string()),
                    None => RawSide::Unread,
                },
                Some((p, _)) => self.param_side(p),
                None => RawSide::Caller,
            };
        }
        if self.header_read(e).is_some() {
            return RawSide::Request;
        }
        // What a call hands back when everything it is given is a value of the
        // caller (`users.resolve(clerk_user_id)`, `load_membership(user)`): the
        // request chose nothing of it, so it is of the caller as its arguments
        // are. Not a method of what the request sent or of a parameter.
        if let Expr::Call(c) = e
            && !c.arguments.is_empty()
            && c.arguments.keywords.iter().all(|k| k.arg.is_some())
        {
            let receiver = match c.func.as_ref() {
                Expr::Name(_) => true,
                Expr::Attribute(a) => matches!(
                    self.side_at(&a.value, depth + 1),
                    RawSide::Call(_)
                        | RawSide::Value(_)
                        | RawSide::SelfAttr(_)
                        | RawSide::Gives(_)
                        | RawSide::Caller
                ),
                _ => false,
            };
            let given: Vec<RawSide> = c
                .arguments
                .args
                .iter()
                .chain(c.arguments.keywords.iter().map(|k| &k.value))
                .map(|a| self.side_at(a, depth + 1))
                .collect();
            let mut gives: Vec<&RawSide> = given
                .iter()
                .filter(|s| matches!(s, RawSide::Gives(_)))
                .collect();
            gives.dedup();
            if receiver
                && caller.is_none()
                && given
                    .iter()
                    .all(|s| matches!(s, RawSide::Caller | RawSide::Gives(_)))
            {
                match gives.as_slice() {
                    [] => return RawSide::Caller,
                    [one] => return (*one).clone(),
                    // Of more than one giver: a reader could judge one only.
                    _ => {}
                }
            }
        }
        // What the path is read off, and the member read off it first.
        let mut root = e;
        let mut first: Option<&str> = None;
        // A method was called on the way: the value is what a call handed back.
        let mut called = false;
        loop {
            if self.is_request(root) {
                break;
            }
            match root {
                Expr::Attribute(a) => {
                    first = Some(a.attr.as_str());
                    root = &a.value;
                }
                Expr::Subscript(s) => root = &s.value,
                Expr::Await(a) => root = &a.value,
                // A method of a value: of that value. A plain call ends the path.
                Expr::Call(c) => match c.func.as_ref() {
                    Expr::Attribute(a) => {
                        called = true;
                        first = Some(a.attr.as_str());
                        root = &a.value;
                    }
                    _ => break,
                },
                _ => break,
            }
        }
        if self.is_request(root) {
            let input = first.is_some_and(|m| {
                REQUEST_INPUTS.contains(&m)
                    || MORE_REQUEST_INPUTS.contains(&m)
                    || matches!(
                        m,
                        "headers" | "cookies" | "COOKIES" | "META" | "view_args" | "match_info"
                    )
            });
            return match caller {
                // What a holder on the request keeps (`request.state.tenant`).
                Some(Some(dep @ RawDep::Gives(_))) => RawSide::Gives(dep),
                _ if input => RawSide::Request,
                _ => RawSide::Unread,
            };
        }
        if let Some(Some(dep)) = caller {
            // Read off a local: of what the local was bound to
            // (`row = db.get(Document, id)` is what a method of the session gave).
            if let Expr::Name(n) = root
                && let Some(side) = self.side_locals.get(n.id.as_str())
            {
                return side.clone();
            }
            // An annotation that may name a dependency, of a parameter.
            if matches!(dep, RawDep::Alias(_))
                && let Some((p, _, _)) = self.root_parameter(e)
                && let RawSide::Param(p, at) = self.param_side(p)
            {
                return RawSide::Annotated(dep, p, at, called);
            }
            // What a method of it hands back (`db.get(Document, id)`), apart from
            // the value itself.
            return if called && !matches!(dep, RawDep::Gives(_) | RawDep::Unread(_)) {
                RawSide::Called(dep)
            } else {
                RawSide::Gives(dep)
            };
        }
        match root {
            Expr::Name(n) => {
                if let Some(side) = self.side_locals.get(n.id.as_str()) {
                    return side.clone();
                }
                match self.operand(root, 0).0 {
                    RawOperand::Header(_) => RawSide::Request,
                    RawOperand::Param(p) if p == "self" || p == "cls" => match first {
                        // The URL arguments Django keeps on a view.
                        Some("kwargs" | "args") => RawSide::Request,
                        Some(attr) => RawSide::SelfAttr(attr.to_string()),
                        None => RawSide::Unread,
                    },
                    RawOperand::Param(_) => self.param_side(n.id.as_str()),
                    // An annotation that may name a dependency: the linker says
                    // which, else it is the parameter.
                    RawOperand::Dep(d @ RawDep::Alias(_), _) => {
                        match self.param_side(n.id.as_str()) {
                            RawSide::Param(p, at) => RawSide::Annotated(d, p, at, called),
                            other => other,
                        }
                    }
                    RawOperand::Dep(d, _) if called => RawSide::Called(d),
                    RawOperand::Dep(d, _) => RawSide::Gives(d),
                    // A method of a module-level value (`Order.objects.get(...)`,
                    // `repository.find(...)`): what the call handed back.
                    RawOperand::Ref(r) if called => RawSide::Call(r),
                    RawOperand::Ref(r) => RawSide::Value(r),
                    RawOperand::Literal => RawSide::Literal,
                    RawOperand::Env => RawSide::Setting,
                    // What the function was passed beyond its named parameters
                    // (`kwargs["slug"]` of `def wrapper(request, *args,
                    // **kwargs)`): a parameter's value as any other.
                    RawOperand::None
                        if self.frame_params.last().is_some_and(|f| {
                            let n = n.id.as_str();
                            f.all.iter().any(|p| p == n) && !f.named.iter().any(|p| p == n)
                        }) =>
                    {
                        RawSide::Param(n.id.to_string(), None)
                    }
                    RawOperand::None => RawSide::Unread,
                }
            }
            Expr::Call(c) => match self.canon(&c.func) {
                Some(r) if !matches!(r.base, RawBase::Global(_)) => RawSide::Call(r),
                _ => RawSide::Unread,
            },
            _ => RawSide::Unread,
        }
    }

    /// A call of a function with nothing, or with the request only
    /// (`current_venue_id()`, `tenant_of(request)`): what it hands back is the
    /// caller's where its body returns a value of the caller
    /// ([`drift_core::controls::RETURNS_CALLER`]), which a reader of the callee
    /// says. The callee, where it is a name the file binds or imports.
    fn helper_gives(&self, c: &ast::ExprCall) -> Option<RawRef> {
        if !c.arguments.keywords.is_empty() || !c.arguments.args.iter().all(|a| self.is_request(a))
        {
            return None;
        }
        // `helper()`, or `module.helper()` on a name the file imports: not a method
        // of a value (`rows.all()`, `Model.query.first()`).
        let plain = match c.func.as_ref() {
            Expr::Name(_) => true,
            Expr::Attribute(a) => matches!(a.value.as_ref(), Expr::Name(_)),
            _ => false,
        };
        self.canon(&c.func).filter(|r| {
            plain
                && match &r.base {
                    RawBase::Local(_) => r.member.is_empty(),
                    RawBase::Import { .. } => !r.member.contains('('),
                    RawBase::Global(_) | RawBase::Star(_) => false,
                }
        })
    }

    /// The attribute of a request-scoped holder the path reads or binds: Flask's
    /// `g.<name>` (by the name `g` is imported under) and `<request>.state.<name>`,
    /// under one reference whatever the request is called.
    pub(crate) fn holder(&self, e: &Expr) -> Option<RawRef> {
        let mut at = e;
        loop {
            match at {
                Expr::Attribute(a) => {
                    if matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "g") {
                        return self
                            .canon(at)
                            .filter(|r| !matches!(r.base, RawBase::Global(_)));
                    }
                    if matches!(a.value.as_ref(), Expr::Attribute(s) if s.attr.as_str() == "state")
                    {
                        // No name the file binds: a request's state under one
                        // reference ([`drift_core::CALLER_HOLDERS`]).
                        return Some(RawRef {
                            base: RawBase::Global("request.state".into()),
                            member: format!(".{}", a.attr.as_str()),
                        });
                    }
                    at = &a.value;
                }
                Expr::Subscript(s) => at = &s.value,
                _ => return None,
            }
        }
    }

    /// The expression is a value of one of the function's own parameters, or read
    /// off one (`venue_id`, `staff.depot_id`): not `self` or `cls`, whose members
    /// are the object's own.
    pub(crate) fn param_value(&self, e: &Expr) -> bool {
        let e = match e {
            Expr::Starred(s) => s.value.as_ref(),
            e => e,
        };
        matches!(e, Expr::Name(_) | Expr::Attribute(_) | Expr::Subscript(_))
            && matches!(
                self.operand(e, 0).0,
                RawOperand::Param(n) | RawOperand::Dep(_, n) if n != "self" && n != "cls"
            )
    }

    /// SQL written as text that names a tenant or an owner key (`text("SELECT * FROM
    /// rules WHERE org_id = :org")`, `SET LOCAL app.current_org = ...`): a filter no
    /// fact records ([`drift_core::controls::SCOPE_UNREAD`]).
    pub(crate) fn note_scope_sql(&mut self, e: &Expr) {
        if self.frames.is_empty() {
            return;
        }
        let Some(text) = literal_text(e) else {
            return;
        };
        let first = text
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(
            first.as_str(),
            "select" | "update" | "delete" | "insert" | "with" | "set"
        ) {
            return;
        }
        // A session variable set on the connection (`SELECT set_config('app.lab_id',
        // :lab, true)`, `SET LOCAL app.tenant = ...`): what row-level security
        // policies read, whatever it is called.
        let lower = text.to_ascii_lowercase();
        if first == "set" || lower.contains("set_config") {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
            return;
        }
        // A table's name is no key (`FROM users`, `JOIN members`).
        if text
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .any(|w| scope_key(w) && !matches!(w, "user" | "users" | "member"))
        {
            self.controls
                .insert(drift_core::controls::SCOPE_UNREAD.into());
        }
    }

    /// SQL written as text that filters its rows, handed to the call with a value of
    /// the caller (`db.execute(text("select * from harvests where estate_id = :e"),
    /// {"e": grower.estate_id})`, `Row.objects.raw("... where kennel_id = %s",
    /// [request.user.kennel_id])`): it may be the scope whatever the column is
    /// called ([`drift_core::practice::sql_filters`]). A value of the caller by the
    /// closed list is [`drift_core::controls::SCOPE_UNREAD`]; what a dependency or
    /// a helper gives is left to a reader ([`Collector::note_given_use`]).
    pub(crate) fn note_scope_sql_call(&mut self, c: &ast::ExprCall) {
        if self.frames.is_empty() || self.in_annotation {
            return;
        }
        let text_of = |e: &Expr| match e {
            Expr::Call(t) if matches!(last_name(&t.func), Some("text" | "sql" | "SQL")) => {
                t.arguments.args.first().and_then(literal_text)
            }
            e => literal_text(e),
        };
        if !c
            .arguments
            .args
            .iter()
            .chain(c.arguments.keywords.iter().map(|k| &k.value))
            .filter_map(text_of)
            .any(|t| drift_core::practice::sql_filters(&t))
        {
            return;
        }
        let given: Vec<&Expr> = c
            .arguments
            .args
            .iter()
            .chain(c.arguments.keywords.iter().map(|k| &k.value))
            .flat_map(|a| {
                let held: Vec<&Expr> = match a {
                    Expr::Dict(d) => d.items.iter().map(|i| &i.value).collect(),
                    Expr::List(l) => l.elts.iter().collect(),
                    Expr::Tuple(t) => t.elts.iter().collect(),
                    _ => Vec::new(),
                };
                std::iter::once(a).chain(held)
            })
            .collect();
        for e in given {
            match self.caller_value(e) {
                Some(None) => {
                    self.controls
                        .insert(drift_core::controls::SCOPE_UNREAD.into());
                }
                Some(Some(dep)) => self.note_given_use(dep),
                None => {}
            }
        }
    }

    /// The conditions of an `if` whose first exit raises an error class
    /// ([`drift_core::RaiseCheck`]): what each reads and compares, the class raised, and
    /// the status when the raise states one. Nothing is decided here about what the
    /// refusal means, so no subject is asked for: mining reads the class and the names.
    fn note_raise_checks(
        &mut self,
        test: &Expr,
        body: &[Stmt],
        cond: &Option<(&'static str, String)>,
    ) {
        let Some(Stmt::Raise(r)) = body
            .iter()
            .find(|s| matches!(s, Stmt::Raise(_) | Stmt::Return(_)))
        else {
            return;
        };
        let Some(e) = r.exc.as_deref() else { return };
        let (class, status) = match e {
            Expr::Call(c) => (
                self.canon(&c.func),
                self.l
                    .response_call(c, self.canon(&c.func), true, false)
                    .map_or(0, |r| r.status),
            ),
            other => (self.canon(other), 0),
        };
        // A built-in's class too (`raise ValueError(...)`, `raise PermissionError`):
        // what the exit is for is in what the condition compares, not in the class.
        let Some(raises) = class else {
            return;
        };
        let mut conds = Vec::new();
        self.conditions(test, &mut conds, 0, false);
        let roles = self.roles_beside(test, &conds, cond);
        let mut role_sides = roles.iter().flat_map(|(sides, _)| sides.iter().cloned());
        for (((source, reads), compares, _, compared, op, sides), guard) in conds {
            let role = role_operand(compared, &compares);
            let role_side = match (&roles, role) {
                (Some(_), true) => role_sides.next(),
                _ => None,
            };
            if matches!(source, RawOperand::Literal | RawOperand::Env)
                || (source == RawOperand::None && compares == RawOperand::None)
            {
                continue;
            }
            if let Some((left, right)) = sides.or(role_side.map(|s| (s, RawSide::Literal))) {
                self.check_sides.insert(RawCheckSides {
                    source: source.clone(),
                    reads: reads.clone(),
                    compares: compares.clone(),
                    left,
                    right,
                });
            }
            let (condition, unless) = match &roles {
                Some((_, words)) => why_beside_roles(role, words, guard),
                None => why(cond, guard),
            };
            self.raise_checks.insert(RawRaiseCheck {
                source,
                reads,
                unread_compare: compared && compares == RawOperand::None,
                compares,
                raises: raises.clone(),
                status,
                op: op.to_string(),
                conditional: !condition.is_empty(),
                condition,
                unless,
                after: self.called_before(),
            });
        }
    }

    /// A response the raised or returned expression sends ([`RawResponse`]).
    pub(crate) fn response_of(&self, e: &Expr, raised: bool) -> Option<RawResponse> {
        let in_catch = self.in_except > 0;
        match e {
            Expr::Call(c) => self
                .l
                .response_call(c, self.canon(&c.func), raised, in_catch),
            Expr::Name(n) if self.response_vars.contains_key(n.id.as_str()) => {
                self.response_vars.get(n.id.as_str()).map(|r| RawResponse {
                    in_catch,
                    via: if raised { ResponseVia::Throw } else { r.via },
                    ..r.clone()
                })
            }
            // `raise PermissionDenied`, `raise Http404`: the class's own status.
            Expr::Name(_) | Expr::Attribute(_) if raised => {
                let r = self.canon(e)?;
                let status = lookup(HTTP_ERRORS, &dotted(&r)?).filter(|s| *s != 0)?;
                Some(RawResponse {
                    status,
                    via: ResponseVia::Throw,
                    builder: Some(r),
                    model: None,
                    keys: vec![],
                    in_catch,
                })
            }
            // Flask: `return body, 400`.
            Expr::Tuple(t) if !raised && t.elts.len() >= 2 => {
                let status = status_of(&t.elts[1])?;
                let first = &t.elts[0];
                let inner = match first {
                    Expr::Call(c) => self
                        .l
                        .response_call(c, self.canon(&c.func), false, in_catch),
                    _ => None,
                };
                Some(match inner {
                    Some(r) => RawResponse { status, ..r },
                    None => RawResponse {
                        status,
                        via: ResponseVia::Return,
                        builder: None,
                        model: None,
                        keys: dict_keys(Some(first)),
                        in_catch,
                    },
                })
            }
            _ => None,
        }
    }

    /// A log-call candidate ([`drift_core::LogCall`]): a call of a level-named method on
    /// a reference that resolves, or of the built-in `print`.
    pub(crate) fn log_call(&self, c: &ast::ExprCall) -> Option<RawLogCall> {
        let mut param = None;
        let mut bound = false;
        let (callee, level) = match c.func.as_ref() {
            Expr::Name(n) if n.id.as_str() == "print" => {
                let r = self.canon(&c.func)?;
                if !matches!(&r.base, RawBase::Global(g) if g == "print") {
                    return None;
                }
                (r, "print")
            }
            Expr::Attribute(a) => {
                let level = practice::normalize_level(a.attr.as_str())?;
                match self.canon(&c.func) {
                    Some(r) if !matches!(r.base, RawBase::Global(_)) => {
                        bound = binds_fields(&a.value) || self.module_bound(&a.value);
                        (r, level)
                    }
                    Some(_) => return None,
                    // A receiver Drift traces instead: a local or `self.x` bound to a
                    // logger, or a parameter.
                    None => match self.log_recv(&a.value, 0)? {
                        LogRecv::Init(mut r, b) => {
                            bound = b;
                            r.member.push('.');
                            r.member.push_str(a.attr.as_str());
                            (r, level)
                        }
                        LogRecv::Param(p, b) => {
                            bound = b;
                            param = Some(format!("{p}.{}", a.attr));
                            (
                                RawRef {
                                    base: RawBase::Global(String::new()),
                                    member: String::new(),
                                },
                                level,
                            )
                        }
                    },
                }
            }
            _ => return None,
        };
        let print = level == "print" && matches!(callee.base, RawBase::Global(_));
        let structured = !print
            && (c.arguments.keywords.iter().any(|k| {
                k.arg
                    .as_ref()
                    .is_none_or(|a| !LOG_OPTIONS.contains(&a.as_str()))
            }) || c.arguments.args.iter().any(|a| matches!(a, Expr::Dict(_))));
        let caught = |e: &Expr| matches!(e, Expr::Name(n) if self.except_names.iter().any(|x| x == n.id.as_str()));
        let passes_error = c.arguments.args.iter().any(caught)
            || c.arguments
                .keywords
                .iter()
                .any(|k| match k.arg.as_ref().map(|a| a.as_str()) {
                    Some("exc_info") => {
                        !matches!(
                            k.value,
                            Expr::BooleanLiteral(ref b) if !b.value
                        ) && !matches!(k.value, Expr::NoneLiteral(_))
                    }
                    _ => caught(&k.value),
                });
        Some(RawLogCall {
            callee,
            level: level.to_string(),
            in_catch: self.in_except > 0,
            structured,
            passes_error,
            param,
            bound,
        })
    }

    /// The module-level name a receiver is (`log` in `log.info(...)`) was bound to a
    /// logger with bound fields.
    fn module_bound(&self, e: &Expr) -> bool {
        matches!(e, Expr::Name(n)
            if self.l.bound_loggers.contains(n.id.as_str())
                && matches!(self.resolve(n.id.as_str()), Some(RawBase::Local(x)) if x == n.id.as_str()))
    }

    /// A log receiver Drift traces when it does not resolve: a local bound to a logger
    /// ([`Collector::log_init`]), `self.x` / `cls.x` bound to one in the class, a
    /// parameter of the function (not `self` / `cls`), each through `.bind(...)`-style
    /// derivations, which make it bound.
    pub(crate) fn log_recv(&self, e: &Expr, depth: usize) -> Option<LogRecv> {
        if depth > MAX_DEPTH {
            return None;
        }
        match e {
            Expr::Call(c) => match c.func.as_ref() {
                Expr::Attribute(a) if BIND_METHODS.contains(&a.attr.as_str()) => {
                    self.log_recv(&a.value, depth + 1).map(LogRecv::bound)
                }
                _ => None,
            },
            Expr::Name(n) => {
                let name = n.id.as_str();
                if let Some(r) = self.log_locals.get(name) {
                    return Some(r.clone());
                }
                (!matches!(name, "self" | "cls")
                    && self.param_ops.last().is_some_and(|f| f.contains_key(name)))
                .then(|| LogRecv::Param(name.to_string(), false))
            }
            Expr::Attribute(a) if matches!(a.value.as_ref(), Expr::Name(n) if matches!(n.id.as_str(), "self" | "cls")) => {
                self.self_logs.last()?.get(a.attr.as_str()).cloned()
            }
            _ => None,
        }
    }

    /// What an initialiser binds a logger receiver to: the factory call it makes or the
    /// object it names (`logging.getLogger(__name__)`, `structlog.get_logger()`,
    /// `logger` from loguru), bound when derived with fields (`.bind(...)`,
    /// `LoggerAdapter(...)`, structlog's `get_logger(**initial)`), or a traced receiver
    /// ([`Collector::log_recv`]).
    pub(crate) fn log_init(&self, e: &Expr) -> Option<LogRecv> {
        let mut e = e;
        let mut bound = false;
        if let Expr::Await(a) = e {
            e = &a.value;
        }
        while let Expr::Call(c) = e
            && let Expr::Attribute(a) = c.func.as_ref()
            && BIND_METHODS.contains(&a.attr.as_str())
        {
            bound = true;
            e = &a.value;
        }
        if let Some(r) = self
            .canon(e)
            .filter(|r| !matches!(r.base, RawBase::Global(_)))
        {
            if let Expr::Call(c) = e {
                bound |= last_name(&c.func) == Some("LoggerAdapter")
                    || (self
                        .canon(&c.func)
                        .as_ref()
                        .and_then(dotted)
                        .is_some_and(|d| d.starts_with("structlog."))
                        && !c.arguments.keywords.is_empty());
            }
            // Only calls and module-level names: what a plain local holds is unknown.
            if matches!(e, Expr::Call(_) | Expr::Name(_) | Expr::Attribute(_)) {
                return Some(LogRecv::Init(r, bound));
            }
        }
        let r = self.log_recv(e, 0)?;
        Some(if bound { r.bound() } else { r })
    }

    /// The loggers a class binds to its attributes: at class level
    /// (`logger = logging.getLogger(__name__)`) and as `self.x = ...` in `__init__`,
    /// where a parameter of `__init__` is an injected logger.
    pub(crate) fn class_loggers(&self, body: &[Stmt]) -> BTreeMap<String, LogRecv> {
        let mut out = BTreeMap::new();
        for s in body {
            match s {
                Stmt::Assign(a) => {
                    if let [Expr::Name(n)] = a.targets.as_slice()
                        && matches!(a.value.as_ref(), Expr::Call(_))
                        && let Some(r) = self.log_init(&a.value)
                    {
                        out.insert(n.id.to_string(), r);
                    }
                }
                Stmt::FunctionDef(f) if f.name.as_str() == "__init__" => {
                    let params: BTreeSet<&str> = f
                        .parameters
                        .iter_non_variadic_params()
                        .map(|p| p.parameter.name.as_str())
                        .skip(1)
                        .collect();
                    for st in &f.body {
                        let Stmt::Assign(a) = st else { continue };
                        let [Expr::Attribute(t)] = a.targets.as_slice() else {
                            continue;
                        };
                        if !matches!(t.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self") {
                            continue;
                        }
                        let mut v = a.value.as_ref();
                        let mut bound = false;
                        while let Expr::Call(c) = v
                            && let Expr::Attribute(x) = c.func.as_ref()
                            && BIND_METHODS.contains(&x.attr.as_str())
                        {
                            bound = true;
                            v = &x.value;
                        }
                        let r = match v {
                            Expr::Name(n) if params.contains(n.id.as_str()) => {
                                Some(LogRecv::Param(n.id.to_string(), bound))
                            }
                            // Another parameter-derived or local value: not known here.
                            Expr::Name(_) if !bound => None,
                            _ => self.log_init(&a.value),
                        };
                        if let Some(r) = r {
                            out.insert(t.attr.to_string(), r);
                        }
                    }
                }
                _ => {}
            }
        }
        out
    }

    /// Data-access calls whose filter names a tenant-like key ([`RawScoped`]): keyword
    /// filters (`Item.objects.filter(organization=org)`, `filter_by(org_id=x)`,
    /// `get_object_or_404(Item, workspace=w)`, `Q(team=t)` inside one) and comparisons
    /// (`.filter(Item.org_id == x)`, `.where(Item.tenant_id == t)`, inside `and_(...)`).
    pub(crate) fn scoped_queries(&self, c: &ast::ExprCall) -> Vec<(RawScoped, RawSide)> {
        let Some(name) = last_name(&c.func) else {
            return vec![];
        };
        if !FILTER_CALLS.contains(&name) {
            return vec![];
        }
        let callee = self
            .canon(&c.func)
            .filter(|r| !matches!(r.base, RawBase::Global(_)));
        let mut out = Vec::new();
        self.filter_args(c, &callee, &mut out, 0);
        out
    }

    fn filter_args(
        &self,
        c: &ast::ExprCall,
        callee: &Option<RawRef>,
        out: &mut Vec<(RawScoped, RawSide)>,
        depth: usize,
    ) {
        if depth > MAX_DEPTH {
            return;
        }
        for k in &c.arguments.keywords {
            if let Some(a) = &k.arg
                && practice::tenant_key(a.as_str())
            {
                out.push((
                    RawScoped {
                        callee: callee.clone(),
                        key: a.to_string(),
                        source: self.scope_source(&k.value),
                        condition: String::new(),
                    },
                    self.side(&k.value),
                ));
            }
        }
        for x in &c.arguments.args {
            match x {
                Expr::Compare(cmp)
                    if cmp.ops.len() == 1
                        && matches!(cmp.ops[0], ast::CmpOp::Eq | ast::CmpOp::In) =>
                {
                    let (l, r) = (cmp.first_operand(), cmp.second_operand());
                    let column = |e: &Expr| match e {
                        Expr::Attribute(a) if practice::tenant_key(a.attr.as_str()) => {
                            Some(a.attr.to_string())
                        }
                        _ => None,
                    };
                    if let Some(key) = column(l) {
                        out.push((
                            RawScoped {
                                callee: callee.clone(),
                                key,
                                source: self.scope_source(r),
                                condition: String::new(),
                            },
                            self.side(r),
                        ));
                    } else if let Some(key) = column(r) {
                        out.push((
                            RawScoped {
                                callee: callee.clone(),
                                key,
                                source: self.scope_source(l),
                                condition: String::new(),
                            },
                            self.side(l),
                        ));
                    }
                }
                Expr::Call(inner)
                    if matches!(last_name(&inner.func), Some("Q" | "and_" | "or_")) =>
                {
                    self.filter_args(inner, callee, out, depth + 1);
                }
                _ => {}
            }
        }
    }

    /// Where a filter value came from ([`drift_core::ScopeSource`]): the caller's session
    /// or identity (it reads a user, session, auth or token value, or is what a declared
    /// dependency gives), a request header, a literal, a handler parameter, else unknown.
    fn scope_source(&self, e: &Expr) -> drift_core::ScopeSource {
        use drift_core::ScopeSource;
        let (op, reads) = self.operand(e, 0);
        let subject = names_subject_in(e) || drift_core::controls::names_subject(&reads);
        // Off the request object: what the caller sent (`request.GET["org"]`) is a
        // parameter; what middleware or authentication set on it (`request.user.org`,
        // `request.profile.org`, `request.state.tenant`) is the session.
        let request_rest = match &op {
            RawOperand::Param(n) | RawOperand::Dep(_, n)
                if matches!(n.as_str(), "request" | "req") =>
            {
                Some(reads.as_str())
            }
            RawOperand::Param(n) if matches!(n.as_str(), "self" | "cls") => {
                Some(reads.strip_prefix(".request").unwrap_or("!"))
            }
            _ => None,
        };
        if let Some(rest) = request_rest {
            let first = rest.trim_start_matches('.').split('.').next().unwrap_or("");
            return if rest == "!" || first.is_empty() {
                ScopeSource::Unknown
            } else if REQUEST_INPUTS.contains(&first)
                || matches!(
                    first,
                    "headers" | "path_params" | "kwargs" | "resolver_match"
                )
            {
                ScopeSource::Param
            } else {
                ScopeSource::Session
            };
        }
        match op {
            RawOperand::Header(_) => ScopeSource::Header,
            RawOperand::Literal => ScopeSource::Literal,
            _ if subject => ScopeSource::Session,
            RawOperand::Dep(..) if reads_caller(&op) => ScopeSource::Session,
            RawOperand::Param(_) | RawOperand::Dep(..) => ScopeSource::Param,
            _ => ScopeSource::Unknown,
        }
    }

    /// An error-reporting call (Sentry `capture_exception` / `capture_message`, Rollbar,
    /// Bugsnag): what it reports with.
    fn report_call(&self, c: &ast::ExprCall) -> Option<RawRef> {
        let name = last_name(&c.func)?;
        let r = self.canon(&c.func)?;
        let d = dotted(&r).unwrap_or_default();
        let reports = matches!(
            name,
            "capture_exception" | "capture_message" | "captureException"
        ) || d.starts_with("rollbar.report")
            || d == "bugsnag.notify";
        reports.then_some(r)
    }

    /// The type or schema a call validates request input into: `XSerializer(data=request.data)`,
    /// `Model(**request.json)`, `schema.load(request.json)`, `Model.model_validate(await request.json())`.
    pub(crate) fn validated_input(&self, c: &ast::ExprCall) -> Option<RawRef> {
        if !call_mentions_request_input(c) {
            return None;
        }
        let strip = |mut r: RawRef| {
            while let Some(m) = r.member.strip_suffix("()") {
                r.member = m.to_string();
            }
            r
        };
        match c.func.as_ref() {
            Expr::Attribute(a) if VALIDATE_METHODS.contains(&a.attr.as_str()) => {
                self.canon(&a.value).map(strip)
            }
            func if last_name(func)
                .is_some_and(|n| n.starts_with(|ch: char| ch.is_ascii_uppercase())) =>
            {
                self.canon(func)
                    .filter(|r| !matches!(r.base, RawBase::Global(_)))
            }
            _ => None,
        }
    }

    /// One `except` clause ([`RawCatch`]): the classes it catches and what its body does.
    pub(crate) fn catch_fact(&self, h: &ast::ExceptHandlerExceptHandler) -> RawCatch {
        let class = |e: &Expr| -> Option<RawRef> {
            self.canon(e).or_else(|| {
                last_name(e).map(|n| RawRef {
                    base: RawBase::Global(n.to_string()),
                    member: String::new(),
                })
            })
        };
        let catches: Vec<Option<RawRef>> = match h.type_.as_deref() {
            None => vec![None],
            Some(e) => match elements(e) {
                Some(els) => els.iter().filter_map(class).map(Some).collect(),
                None => class(e).map(Some).into_iter().collect(),
            },
        };
        let mut does = BTreeSet::new();
        let bound = h.name.as_ref().map(|n| n.as_str());
        self.clause_does(&h.body, bound, &mut does, 0);
        RawCatch {
            catches,
            does: does.into_iter().collect(),
        }
    }

    fn clause_does(
        &self,
        body: &[Stmt],
        bound: Option<&str>,
        out: &mut BTreeSet<RawDoes>,
        depth: usize,
    ) {
        if depth > MAX_DEPTH {
            return;
        }
        for s in body {
            match s {
                Stmt::Raise(r) => match r.exc.as_deref() {
                    None => {
                        out.insert(RawDoes::Rethrow);
                    }
                    Some(Expr::Name(n)) if Some(n.id.as_str()) == bound => {
                        out.insert(RawDoes::Rethrow);
                    }
                    Some(e) => {
                        let resp = self.response_of(e, true);
                        let thrown = match e {
                            Expr::Call(c) => self.canon(&c.func),
                            Expr::Name(n) if self.response_vars.contains_key(n.id.as_str()) => {
                                resp.as_ref().and_then(|r| r.builder.clone())
                            }
                            other => self.canon(other),
                        };
                        if let Some(t) = thrown {
                            out.insert(RawDoes::Throw(t));
                        }
                        if let Some(r) = resp {
                            out.insert(RawDoes::Respond(r.status));
                        }
                    }
                },
                Stmt::Return(r) => {
                    out.insert(RawDoes::Return);
                    if let Some(resp) = r.value.as_deref().and_then(|v| self.response_of(v, false))
                    {
                        out.insert(RawDoes::Respond(resp.status));
                    }
                }
                Stmt::Expr(x) => {
                    let mut e = x.value.as_ref();
                    if let Expr::Await(a) = e {
                        e = &a.value;
                    }
                    if let Expr::Call(c) = e {
                        if self.log_call(c).is_some() {
                            out.insert(RawDoes::Log);
                        }
                        if let Some(r) = self.report_call(c) {
                            out.insert(RawDoes::Report(r));
                        }
                        if last_name(&c.func) == Some("abort")
                            && let Some(r) =
                                self.l.response_call(c, self.canon(&c.func), false, true)
                        {
                            out.insert(RawDoes::Respond(r.status));
                        }
                    }
                }
                Stmt::If(i) => {
                    self.clause_does(&i.body, bound, out, depth + 1);
                    for c in &i.elif_else_clauses {
                        self.clause_does(&c.body, bound, out, depth + 1);
                    }
                }
                Stmt::With(w) => self.clause_does(&w.body, bound, out, depth + 1),
                Stmt::For(f) => self.clause_does(&f.body, bound, out, depth + 1),
                Stmt::While(w) => self.clause_does(&w.body, bound, out, depth + 1),
                Stmt::Try(t) => {
                    self.clause_does(&t.body, bound, out, depth + 1);
                    self.clause_does(&t.finalbody, bound, out, depth + 1);
                }
                _ => {}
            }
        }
    }
}

/// The operand is a request header or what a declared dependency gives (`Depends(f)`,
/// not a bare annotation that may name an alias): what the caller sent or who they are.
/// A name that is a tenant or an owner key ([`practice::tenant_key`],
/// [`practice::owner_key`]).
fn scope_key(name: &str) -> bool {
    practice::tenant_key(name) || practice::owner_key(name)
}

/// The text of a string literal, or of the literal parts of an f-string.
fn literal_text(e: &Expr) -> Option<String> {
    match e {
        Expr::StringLiteral(s) => Some(s.value.to_str().to_string()),
        Expr::FString(f) => Some(
            f.value
                .elements()
                .filter_map(|el| el.as_literal())
                .map(|l| l.value.as_ref())
                .collect::<Vec<&str>>()
                .join(" "),
        ),
        _ => None,
    }
}

/// The reference of what gives a value ([`RawDep`]): the dependency's, the
/// helper's or the holder's. None for one that names nothing a reader can judge.
fn giver(d: &RawDep) -> Option<RawRef> {
    match d {
        RawDep::Direct(r) | RawDep::Instance(r, _) | RawDep::Gives(r) => Some(r.clone()),
        RawDep::Optional(inner) => giver(inner),
        RawDep::Alias(_) | RawDep::Unread(_) => None,
    }
}

/// A dependency declared with `Depends(...)` (not an annotation that may name an
/// alias, nor what a helper gives).
fn declared(d: &RawDep) -> bool {
    match d {
        RawDep::Direct(_) | RawDep::Instance(..) => true,
        RawDep::Alias(_) | RawDep::Unread(_) | RawDep::Gives(_) => false,
        RawDep::Optional(inner) => declared(inner),
    }
}

fn reads_caller(o: &RawOperand) -> bool {
    match o {
        RawOperand::Header(_) => true,
        RawOperand::Dep(d, _) => declared(d),
        _ => false,
    }
}

/// The names on a member path, the last member first: `request.user.staff` is
/// `staff`, `user`, `request`; an item read is its container's
/// (`session["org"]`).
fn path_names(e: &Expr) -> impl Iterator<Item = &str> {
    let mut at = Some(e);
    std::iter::from_fn(move || {
        loop {
            match at? {
                Expr::Attribute(a) => {
                    at = Some(&a.value);
                    return Some(a.attr.as_str());
                }
                Expr::Name(n) => {
                    at = None;
                    return Some(n.id.as_str());
                }
                Expr::Subscript(s) => at = Some(&s.value),
                _ => return None,
            }
        }
    })
}

/// Functions that hand back the caller's identity or claims when called with
/// nothing, by the last name of what is called ([`Collector::caller_value`]):
/// flask_jwt_extended's `get_jwt()`, `get_jwt_identity()`, `get_current_user()` and
/// its older `get_jwt_claims()`, `get_raw_jwt()`; `auth.current_user()`
/// (flask_httpauth) and `current_user_id()` (flask_praetorian). A function of the
/// repository under one of these names is read the same.
/// Calls that verify a token and hand back what it carries: of a value of the
/// caller, a value of the caller.
const TOKEN_DECODERS: &[&str] = &["jwt.decode", "jwt.api_jwt.decode", "jose.jwt.decode"];

const CALLER_ACCESSORS: &[&str] = &[
    "get_jwt",
    "get_jwt_identity",
    "get_jwt_claims",
    "get_raw_jwt",
    "get_current_user",
    "get_current_user_id",
    "current_user",
    "current_user_id",
    "current_identity",
];

/// Words that say who is calling, beside those of a subject
/// ([`drift_core::controls::names_subject`]), in the name of what a request-scoped
/// holder keeps ([`user_like`]).
const CALLER_WORDS: &[&str] = &[
    "principal",
    "identity",
    "claims",
    "caller",
    "actor",
    "viewer",
    "member",
];

/// The name of what a request-scoped holder keeps says the caller: a word of it
/// names a subject (`user_id`, `auth_claims`) or the caller ([`CALLER_WORDS`]), or
/// it is a tenant or an owner key (`tenant_id`, `org`, `owner_id`). `db`,
/// `request_id` and `locale` say nothing of the caller.
fn user_like(name: &str) -> bool {
    drift_core::controls::names_subject(name)
        || scope_key(name)
        || name
            .split('_')
            .any(|w| CALLER_WORDS.contains(&w.to_ascii_lowercase().as_str()))
}

/// The path reads what a request-scoped holder keeps of the caller: a user-like
/// attribute ([`user_like`]) of Flask's `g` (`g.principal.venue_id`) or of the
/// request's `state` (`request.state.claims["venue_id"]`), or the caller's item of
/// the ASGI scope (`request.scope["user"]`, `scope["auth"]`, `scope["session"]`).
fn held(e: &Expr) -> bool {
    let named = |e: &Expr, name: &str| last_name(e) == Some(name);
    let mut at = e;
    loop {
        match at {
            Expr::Attribute(a) => {
                if (named(&a.value, "g") || named(&a.value, "state")) && user_like(a.attr.as_str())
                {
                    return true;
                }
                at = &a.value;
            }
            Expr::Subscript(s) => {
                if named(&s.value, "scope")
                    && matches!(s.slice.as_ref(), Expr::StringLiteral(k)
                        if matches!(k.value.to_str(), "user" | "auth" | "session"))
                {
                    return true;
                }
                at = &s.value;
            }
            _ => return false,
        }
    }
}

/// The name says the caller: its last word names a subject
/// ([`drift_core::controls::names_subject`]: `user`, `current_user`, `session`,
/// `auth_token`), where `users_bp`, `user_service` and `auth_router` name
/// something else.
fn names_caller(name: &str) -> bool {
    let last = name.rsplit('_').find(|w| !w.is_empty()).unwrap_or(name);
    let last = match last.rfind(|c: char| c.is_ascii_uppercase()) {
        Some(i) if i > 0 => &last[i..],
        _ => last,
    };
    drift_core::controls::names_subject(last)
}

/// A name or attribute in the expression names a subject
/// ([`drift_core::controls::names_subject`]).
fn names_subject_in(e: &Expr) -> bool {
    struct Find(bool);
    impl<'x> Visitor<'x> for Find {
        fn visit_expr(&mut self, e: &'x Expr) {
            match e {
                Expr::Name(n) if drift_core::controls::names_subject(n.id.as_str()) => {
                    self.0 = true
                }
                Expr::Attribute(a) if drift_core::controls::names_subject(a.attr.as_str()) => {
                    self.0 = true
                }
                _ => {}
            }
            visitor::walk_expr(self, e);
        }
    }
    let mut f = Find(false);
    f.visit_expr(e);
    f.0
}

/// One test function being walked.
#[derive(Default)]
struct TestFrame {
    /// (method, route, dynamic): `dynamic` when the route had a non-literal part.
    requests: Vec<(String, String, bool)>,
    statuses: BTreeSet<u16>,
    /// Locals bound to a string literal (`url = "/api/x"`).
    strings: BTreeMap<String, String>,
    /// Locals bound to a test client (`client = TestClient(app)`, `as ac`).
    clients: BTreeSet<String>,
}

struct TestFinder<'l, 't> {
    l: &'l Lowerer<'t>,
    frames: Vec<TestFrame>,
    module_clients: BTreeSet<String>,
    requests: BTreeSet<TestRequest>,
    mocks: BTreeSet<RawMock>,
}

/// A call that builds a test client (`TestClient(app)`, `AsyncClient(...)`, `APIClient()`).
fn builds_client(e: &Expr) -> bool {
    let mut e = e;
    if let Expr::Await(a) = e {
        e = &a.value;
    }
    matches!(e, Expr::Call(c) if last_name(&c.func).is_some_and(|n| n.ends_with("Client")))
}

impl TestFinder<'_, '_> {
    fn is_client(&self, e: &Expr) -> bool {
        match e {
            Expr::Name(n) => {
                let name = n.id.as_str();
                name.to_ascii_lowercase().contains("client")
                    || self.module_clients.contains(name)
                    || self.frames.iter().any(|f| f.clients.contains(name))
                    || matches!(
                        self.l.canon(e).as_ref().and_then(dotted).as_deref(),
                        Some("requests" | "httpx")
                    )
            }
            Expr::Attribute(a) => {
                a.attr.as_str().to_ascii_lowercase().contains("client")
                    && matches!(a.value.as_ref(), Expr::Name(n) if n.id.as_str() == "self")
            }
            Expr::Call(_) => builds_client(e),
            _ => false,
        }
    }

    /// The route a request names, and whether it had a non-literal part: anything but a
    /// plain string (an f-string with an interpolation, a variable even when bound to a
    /// literal here, a `url_for` / `reverse` call, a concatenation, no argument at all).
    fn route_arg(&self, e: Option<&Expr>) -> (String, bool) {
        let Some(e) = e else {
            return (String::new(), true);
        };
        let dynamic = string_value(e).is_none();
        let raw = match e {
            Expr::Name(n) => self
                .frames
                .last()
                .and_then(|f| f.strings.get(n.id.as_str()).cloned()),
            other => route_template(other),
        };
        (
            raw.and_then(|r| request_path(&r)).unwrap_or_default(),
            dynamic,
        )
    }

    fn request(&mut self, c: &ast::ExprCall) {
        let Expr::Attribute(a) = c.func.as_ref() else {
            return;
        };
        let attr = a.attr.as_str();
        if !self.is_client(&a.value) {
            return;
        }
        let (method, (route, dynamic)) = if CLIENT_METHODS.contains(&attr) {
            (attr.to_ascii_uppercase(), self.route_arg(arg(c, 0, "url")))
        } else if attr == "request" {
            let Some(m) = c.arguments.args.first().and_then(string_value) else {
                return;
            };
            let m = m.to_ascii_uppercase();
            if !CLIENT_METHODS.contains(&m.to_ascii_lowercase().as_str()) {
                return;
            }
            (m, self.route_arg(arg(c, 1, "url")))
        } else {
            return;
        };
        if let Some(f) = self.frames.last_mut() {
            f.requests.push((method, route, dynamic));
        }
    }

    /// Statuses an `assertEqual(r.status_code, 201)`-style call asserts.
    fn assert_call(&mut self, c: &ast::ExprCall) {
        let Some(name) = last_name(&c.func) else {
            return;
        };
        let Some(f) = self.frames.last_mut() else {
            return;
        };
        match name {
            "assertEqual" | "assertEquals" | "assertIn" | "assert_equal" => {
                let args = &c.arguments.args;
                if args.len() >= 2 {
                    if reads_status(&args[0]) {
                        statuses_of(&args[1], &mut f.statuses);
                    } else if reads_status(&args[1]) {
                        statuses_of(&args[0], &mut f.statuses);
                    }
                }
            }
            _ => {}
        }
        if name.starts_with("assert")
            && let Some(s) = keyword(c, "status_code").and_then(status_of)
        {
            f.statuses.insert(s);
        }
    }

    fn mock(&mut self, c: &ast::ExprCall) {
        let r = self.l.canon(&c.func);
        let d = r.as_ref().and_then(dotted).unwrap_or_default();
        let receiver = match c.func.as_ref() {
            Expr::Attribute(a) => match a.value.as_ref() {
                Expr::Name(n) => Some(n.id.as_str()),
                Expr::Attribute(inner) => match inner.value.as_ref() {
                    Expr::Name(n) => Some(n.id.as_str()),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        };
        let attr = last_name(&c.func).unwrap_or_default();
        let first = c.arguments.args.first();
        let patcher = PATCHERS.contains(&d.as_str())
            || (receiver == Some("mocker") && matches!(attr, "patch" | "object" | "dict"))
            || (receiver == Some("monkeypatch") && matches!(attr, "setattr" | "delattr"));
        if patcher {
            if let Some(e) = first {
                match string_value(e) {
                    Some(s) => {
                        self.mocks.insert(RawMock::Dotted(s));
                    }
                    None => {
                        if let Some(x) = self.l.canon(e)
                            && !matches!(x.base, RawBase::Global(_))
                        {
                            self.mocks.insert(RawMock::Ref(x));
                        }
                    }
                }
            }
            return;
        }
        if d.starts_with("respx.")
            || d == "respx"
            || matches!(receiver, Some("respx_mock" | "httpx_mock"))
        {
            self.mocks.insert(RawMock::Module("pkg:httpx".into()));
        } else if d.starts_with("responses.") {
            self.mocks.insert(RawMock::Module("pkg:requests".into()));
        }
    }
}

impl<'x> Visitor<'x> for TestFinder<'_, '_> {
    fn visit_stmt(&mut self, s: &'x Stmt) {
        match s {
            Stmt::FunctionDef(f) => {
                for d in &f.decorator_list {
                    self.visit_decorator(d);
                }
                // `def test_x(client, respx_mock)`: a fixture.
                let frame = TestFrame::default();
                for p in f.parameters.iter_non_variadic_params() {
                    let n = p.parameter.name.as_str();
                    if matches!(n, "respx_mock" | "httpx_mock") {
                        self.mocks.insert(RawMock::Module("pkg:httpx".into()));
                    }
                }
                self.frames.push(frame);
                for st in &f.body {
                    self.visit_stmt(st);
                }
                if let Some(frame) = self.frames.pop() {
                    let statuses: Vec<u16> = frame.statuses.iter().copied().collect();
                    for (method, route, dynamic) in frame.requests {
                        self.requests.insert(TestRequest {
                            method,
                            route,
                            target: String::new(),
                            statuses: statuses.clone(),
                            dynamic,
                        });
                    }
                }
                return;
            }
            Stmt::Assign(a) => {
                if let [Expr::Name(n)] = a.targets.as_slice() {
                    let name = n.id.to_string();
                    if builds_client(&a.value) {
                        match self.frames.last_mut() {
                            Some(f) => {
                                f.clients.insert(name.clone());
                            }
                            None => {
                                self.module_clients.insert(name.clone());
                            }
                        }
                    }
                    if let Some(f) = self.frames.last_mut() {
                        match string_value(&a.value) {
                            Some(v) => {
                                f.strings.insert(name, v);
                            }
                            None => {
                                f.strings.remove(&name);
                            }
                        }
                    }
                }
            }
            Stmt::With(w) => {
                for item in &w.items {
                    if let Some(Expr::Name(n)) = item.optional_vars.as_deref()
                        && builds_client(&item.context_expr)
                        && let Some(f) = self.frames.last_mut()
                    {
                        f.clients.insert(n.id.to_string());
                    }
                }
            }
            Stmt::Assert(a) => {
                if let Expr::Compare(c) = a.test.as_ref()
                    && c.ops.len() == 1
                    && matches!(c.ops[0], ast::CmpOp::Eq | ast::CmpOp::In)
                    && let Some(f) = self.frames.last_mut()
                {
                    let (l, r) = (c.first_operand(), c.second_operand());
                    if reads_status(l) {
                        statuses_of(r, &mut f.statuses);
                    } else if reads_status(r) {
                        statuses_of(l, &mut f.statuses);
                    }
                }
            }
            _ => {}
        }
        visitor::walk_stmt(self, s);
    }

    fn visit_expr(&mut self, e: &'x Expr) {
        match e {
            Expr::Call(c) => {
                self.request(c);
                self.assert_call(c);
                self.mock(c);
            }
            Expr::Name(_) => {
                if let Some(d) = self.l.canon(e).as_ref().and_then(dotted) {
                    self.bare_mock(&d);
                }
            }
            Expr::Attribute(_) => {
                // A chain `a.b.c` is read once, from its base outwards: reading every
                // prefix from its own top (as walking into it would) takes time
                // quadratic in the chain's length, hours at the size cap.
                let mut attrs = Vec::new();
                let mut base = e;
                while let Expr::Attribute(a) = base {
                    attrs.push(a.attr.as_str());
                    base = &a.value;
                }
                if let Some(mut r) = self.l.canon(base) {
                    for attr in attrs.iter().rev() {
                        // As `canon_with` cuts a member: a longer prefix reads the same.
                        if r.member.matches('.').count() >= MAX_MEMBER_DEPTH {
                            break;
                        }
                        r.member.push('.');
                        r.member.push_str(attr);
                        if let Some(d) = dotted(&r) {
                            self.bare_mock(&d);
                        }
                    }
                }
                return self.visit_expr(base);
            }
            _ => {}
        }
        visitor::walk_expr(self, e);
    }
}

impl TestFinder<'_, '_> {
    /// `@respx.mock`, `@responses.activate` used bare.
    fn bare_mock(&mut self, dotted: &str) {
        if dotted == "respx.mock" {
            self.mocks.insert(RawMock::Module("pkg:httpx".into()));
        } else if dotted == "responses.activate" {
            self.mocks.insert(RawMock::Module("pkg:requests".into()));
        }
    }
}

/// One operand of a condition: what it reads, what it compares with, whether it reads
/// a subject, whether it is a comparison, and how it compares.
type Operand = (
    Read,
    RawOperand,
    bool,
    bool,
    &'static str,
    Option<(RawSide, RawSide)>,
);

/// Why a check is conditional and the condition in words: the enclosing condition
/// first, else the other operands of the `and` it stands in.
fn why(cond: &Option<(&'static str, String)>, guard: Option<String>) -> (String, String) {
    match (cond, guard) {
        (Some((kind, words)), _) => (kind.to_string(), words.clone()),
        (None, Some(g)) => (
            drift_core::not_always::AND_OPERAND.to_string(),
            clip(format!("only when {g}")),
        ),
        (None, None) => (String::new(), String::new()),
    }
}

/// The role tests of a condition that refuses a caller unless a role or one
/// comparison holds ([`drift_core::not_always::ROLE_ALTERNATIVE`]): an effective
/// `and` (`a and b`, `not (a or b)`) every operand of which but one tests that a
/// member is not set or is not a literal (`not user.is_superuser`, `user.role !=
/// "admin"`, `user.role not in ("admin", "staff")`), the one left being a
/// comparison. Each role test by the member it reads. None for any other condition.
fn role_alternatives(test: &Expr) -> Option<Vec<&Expr>> {
    let (values, negated) = match test {
        Expr::BoolOp(b) if matches!(b.op, ast::BoolOp::And) => (&b.values, false),
        Expr::UnaryOp(u) if matches!(u.op, ast::UnaryOp::Not) => match u.operand.as_ref() {
            Expr::BoolOp(b) if matches!(b.op, ast::BoolOp::Or) => (&b.values, true),
            _ => return None,
        },
        _ => return None,
    };
    let roles: Vec<&Expr> = values
        .iter()
        .filter_map(|v| role_test(v, negated))
        .collect();
    let rest: Vec<&Expr> = values
        .iter()
        .filter(|v| role_test(v, negated).is_none())
        .collect();
    let comparison = |v: &Expr| match v {
        Expr::Compare(c) => c.ops.len() == 1,
        Expr::UnaryOp(u) if matches!(u.op, ast::UnaryOp::Not) => {
            matches!(u.operand.as_ref(), Expr::Compare(c) if c.ops.len() == 1)
        }
        _ => false,
    };
    (!roles.is_empty() && rest.len() == 1 && comparison(rest[0])).then_some(roles)
}

/// The member a value tests to be unset, or to be other than a literal, where the
/// condition it stands in refuses on it ([`role_alternatives`]); `negated`: the
/// condition is the negation of what is written.
fn role_test(v: &Expr, negated: bool) -> Option<&Expr> {
    let member = |e: &Expr| matches!(e, Expr::Attribute(_));
    let literal = |e: &Expr| match e {
        Expr::StringLiteral(_) => true,
        Expr::Tuple(t) => t.elts.iter().all(|x| matches!(x, Expr::StringLiteral(_))),
        Expr::List(l) => l.elts.iter().all(|x| matches!(x, Expr::StringLiteral(_))),
        Expr::Set(l) => l.elts.iter().all(|x| matches!(x, Expr::StringLiteral(_))),
        _ => false,
    };
    let (inner, negated) = match v {
        Expr::UnaryOp(u) if matches!(u.op, ast::UnaryOp::Not) => (u.operand.as_ref(), !negated),
        other => (other, negated),
    };
    match inner {
        e if member(e) && negated => Some(e),
        Expr::Compare(c)
            if c.ops.len() == 1 && member(c.first_operand()) && literal(c.second_operand()) =>
        {
            let differs = matches!(c.ops[0], ast::CmpOp::NotEq | ast::CmpOp::NotIn);
            let same = matches!(c.ops[0], ast::CmpOp::Eq | ast::CmpOp::In);
            ((differs && !negated) || (same && negated)).then_some(c.first_operand())
        }
        _ => None,
    }
}

/// The operand is a role test as [`role_alternatives`] reads one: a test of a value
/// itself, or a comparison with a literal.
fn role_operand(compared: bool, compares: &RawOperand) -> bool {
    !compared || *compares == RawOperand::Literal
}

/// [`why`] for an operand of a condition whose role tests are `roles`
/// ([`role_alternatives`]): the comparison is decided by the role or by itself, and
/// says which role; the role test says it is one. `words`: the roles, as written.
fn why_beside_roles(role: bool, words: &[String], guard: Option<String>) -> (String, String) {
    use drift_core::not_always::{ALTERNATIVE_ROLE, ROLE_ALTERNATIVE};
    match role {
        true => (
            ALTERNATIVE_ROLE.to_string(),
            guard.map_or_else(String::new, |g| clip(format!("only when {g}"))),
        ),
        false => (
            ROLE_ALTERNATIVE.to_string(),
            clip(format!("not when {}", words.join(" or "))),
        ),
    }
}

/// At most [`drift_core::not_always::MAX_WORDS`] characters.
fn clip(s: String) -> String {
    let max = drift_core::not_always::MAX_WORDS;
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('\u{2026}');
    out
}

/// An expression in the code's own words, for saying when a check runs: names,
/// attribute paths and operators. A string is written `"..."` (literals are not
/// echoed), as are a number, a call's arguments and a subscript's key.
pub(crate) fn words(e: &Expr) -> String {
    fn go(e: &Expr, depth: usize) -> String {
        if depth > 6 {
            return "...".to_string();
        }
        match e {
            Expr::Name(n) => n.id.to_string(),
            Expr::Attribute(a) => format!("{}.{}", go(&a.value, depth + 1), a.attr),
            Expr::NoneLiteral(_) => "None".to_string(),
            Expr::BooleanLiteral(b) => if b.value { "True" } else { "False" }.to_string(),
            Expr::StringLiteral(_) | Expr::BytesLiteral(_) | Expr::FString(_) => {
                "\"...\"".to_string()
            }
            Expr::Await(a) => go(&a.value, depth + 1),
            Expr::Call(c) => format!("{}(...)", go(&c.func, depth + 1)),
            Expr::Subscript(s) => format!("{}[...]", go(&s.value, depth + 1)),
            Expr::UnaryOp(u) if matches!(u.op, ast::UnaryOp::Not) => {
                format!("not {}", go(&u.operand, depth + 1))
            }
            Expr::BoolOp(b) => {
                let op = match b.op {
                    ast::BoolOp::And => " and ",
                    ast::BoolOp::Or => " or ",
                };
                let parts: Vec<String> = b.values.iter().map(|v| go(v, depth + 1)).collect();
                format!("({})", parts.join(op))
            }
            Expr::Compare(c) if c.ops.len() == 1 => {
                let op = match c.ops[0] {
                    ast::CmpOp::Eq => "==",
                    ast::CmpOp::NotEq => "!=",
                    ast::CmpOp::Is => "is",
                    ast::CmpOp::IsNot => "is not",
                    ast::CmpOp::In => "in",
                    ast::CmpOp::NotIn => "not in",
                    ast::CmpOp::Lt => "<",
                    ast::CmpOp::LtE => "<=",
                    ast::CmpOp::Gt => ">",
                    ast::CmpOp::GtE => ">=",
                };
                format!(
                    "{} {op} {}",
                    go(c.first_operand(), depth + 1),
                    go(c.second_operand(), depth + 1)
                )
            }
            _ => "...".to_string(),
        }
    }
    clip(go(e, 0))
}

/// A literal written in place: nothing of the request or the caller.
fn literal_value(e: &Expr) -> bool {
    matches!(
        e,
        Expr::StringLiteral(_)
            | Expr::BytesLiteral(_)
            | Expr::NumberLiteral(_)
            | Expr::BooleanLiteral(_)
            | Expr::NoneLiteral(_)
            | Expr::EllipsisLiteral(_)
    )
}
