//! Security- and quality-relevant signals inside Python function bodies.
//!
//! The same sink kinds as the TypeScript parser where they apply, plus
//! `unsafe_deserialize` (pickle, `yaml.load` without a safe loader). These are
//! facts about how code runs, never rules. Detection is syntactic and narrow,
//! so a hit is worth a look.

use super::*;

/// Sink kinds, as recorded in `Symbol::sinks`.
pub mod kind {
    pub const EVAL: &str = "eval";
    pub const EXEC: &str = "shell_exec";
    pub const HTML: &str = "raw_html";
    pub const SQL_RAW: &str = "raw_sql";
    pub const SQL_INTERP: &str = "sql_string_interpolation";
    pub const REDIRECT: &str = "dynamic_redirect";
    pub const FETCH: &str = "dynamic_fetch";
    pub const WEAK_HASH: &str = "weak_hash";
    pub const JWT_DECODE: &str = "jwt_decode_without_verify";
    pub const COOKIE: &str = "cookie_without_httponly";
    pub const CORS: &str = "cors_any_origin";
    pub const DESERIALIZE: &str = "unsafe_deserialize";
}

const SHELL_FNS: &[&str] = &[
    "os.system",
    "os.popen",
    "subprocess.getoutput",
    "subprocess.getstatusoutput",
    "asyncio.create_subprocess_shell",
];
const SUBPROCESS_FNS: &[&str] = &[
    "subprocess.run",
    "subprocess.call",
    "subprocess.check_call",
    "subprocess.check_output",
    "subprocess.Popen",
];
const DESERIALIZERS: &[&str] = &[
    "pickle.load",
    "pickle.loads",
    "pickle.Unpickler",
    "cPickle.load",
    "cPickle.loads",
    "dill.load",
    "dill.loads",
    "marshal.load",
    "marshal.loads",
    "shelve.open",
    "jsonpickle.decode",
    "yaml.unsafe_load",
    "yaml.unsafe_load_all",
];
const HTTP_CLIENT_MODULES: &[&str] = &["requests", "httpx"];
const HTTP_CLIENT_FNS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "head", "options", "request", "stream",
];
const REDIRECTS: &[&str] = &[
    "django.shortcuts.redirect",
    "django.http.HttpResponseRedirect",
    "django.http.HttpResponsePermanentRedirect",
    "django.http.response.HttpResponseRedirect",
    "flask.redirect",
    "werkzeug.utils.redirect",
    "starlette.responses.RedirectResponse",
    "fastapi.responses.RedirectResponse",
];
const SAFE_HTML: &[&str] = &[
    "django.utils.safestring.mark_safe",
    "django.utils.html.mark_safe",
    "markupsafe.Markup",
    "flask.Markup",
    "jinja2.Markup",
];
const SQL_KEYWORDS: &[&str] = &[
    "SELECT ", "INSERT ", "UPDATE ", "DELETE ", " WHERE ", "FROM ",
];

fn is_true(e: Option<&Expr>) -> bool {
    matches!(e, Some(Expr::BooleanLiteral(b)) if b.value)
}

fn is_false(e: Option<&Expr>) -> bool {
    matches!(e, Some(Expr::BooleanLiteral(b)) if !b.value)
}

fn is_literal_string(e: &Expr) -> bool {
    string_value(e).is_some() || matches!(e, Expr::BytesLiteral(_))
}

/// Last attribute or name of a callee (`cursor.execute` -> `execute`).
fn callee_name(e: &Expr) -> Option<&str> {
    match e {
        Expr::Attribute(a) => Some(a.attr.as_str()),
        Expr::Name(n) => Some(n.id.as_str()),
        _ => None,
    }
}

/// `settings.API_URL`, `config.base_url`, `API_URL`: set by operators, not by requests.
fn is_config(e: &Expr) -> bool {
    match e {
        Expr::Name(n) => is_constant_name(n.id.as_str()),
        Expr::Attribute(a) => {
            is_constant_name(a.attr.as_str())
                || matches!(a.value.as_ref(), Expr::Name(n) if matches!(n.id.as_str(), "settings" | "config" | "conf" | "app_settings"))
        }
        _ => false,
    }
}

/// A URL whose origin is literal (`f"https://api.x.com/{id}"`) or configured.
fn is_fixed_origin(e: &Expr) -> bool {
    if is_literal_string(e) || is_config(e) {
        return true;
    }
    let Expr::FString(f) = e else {
        return matches!(e, Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) && is_fixed_origin(&b.left));
    };
    let Some(ast::FStringPartRef::FString(fs)) = f.value.iter().next() else {
        return true;
    };
    match fs.elements.first() {
        Some(ast::InterpolatedStringElement::Literal(l)) => {
            let s = l.value.as_ref();
            match s
                .strip_prefix("https://")
                .or_else(|| s.strip_prefix("http://"))
            {
                Some(rest) => {
                    rest.find('/').is_some_and(|i| i > 0)
                        // `f"http://localhost:{port}/api"`: a literal host, only the
                        // port interpolated.
                        || (rest.len() > 1
                            && rest.ends_with(':')
                            && !rest.contains(['@', '/', '?', '#'])
                            && matches!(
                                fs.elements.get(1),
                                Some(ast::InterpolatedStringElement::Interpolation(_))
                            )
                            && match fs.elements.get(2) {
                                Some(ast::InterpolatedStringElement::Literal(n)) => {
                                    n.value.starts_with('/')
                                }
                                Some(_) => false,
                                None => true,
                            })
                }
                None => s.starts_with('/'),
            }
        }
        Some(ast::InterpolatedStringElement::Interpolation(i)) => is_config(&i.expression),
        None => true,
    }
}

/// SQL built by interpolation: an f-string, `%` formatting, `.format()` or `+`
/// concatenation whose literal text contains SQL keywords.
pub(crate) fn interpolated_sql(e: &Expr) -> bool {
    let has_sql = |s: &str| {
        let u = s.to_ascii_uppercase();
        SQL_KEYWORDS.iter().any(|k| u.contains(k))
    };
    match e {
        Expr::FString(f) => {
            let mut literal = String::new();
            let mut interpolated = false;
            for part in f.value.iter() {
                match part {
                    ast::FStringPartRef::Literal(l) => literal.push_str(&l.value),
                    ast::FStringPartRef::FString(fs) => {
                        for el in &fs.elements {
                            match el {
                                ast::InterpolatedStringElement::Literal(l) => {
                                    literal.push_str(&l.value)
                                }
                                ast::InterpolatedStringElement::Interpolation(_) => {
                                    interpolated = true
                                }
                            }
                        }
                    }
                }
            }
            interpolated && has_sql(&literal)
        }
        Expr::BinOp(b) if matches!(b.op, ast::Operator::Mod) => {
            string_value(&b.left).is_some_and(|s| has_sql(&s))
        }
        Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
            let lit = string_value(&b.left).or_else(|| string_value(&b.right));
            lit.is_some_and(|s| has_sql(&s))
                && !(is_literal_string(&b.left) && is_literal_string(&b.right))
        }
        Expr::Call(c) => match c.func.as_ref() {
            Expr::Attribute(a) if a.attr.as_str() == "format" => {
                string_value(&a.value).is_some_and(|s| has_sql(&s))
            }
            _ => false,
        },
        _ => false,
    }
}

/// Text written out that holds SQL keywords (`"SELECT * FROM users WHERE 1 = 1"`).
pub(crate) fn sql_text(e: &Expr) -> bool {
    string_value(e).is_some_and(|s| {
        let u = s.to_ascii_uppercase();
        SQL_KEYWORDS.iter().any(|k| u.contains(k))
    })
}

/// SQL built by a chain of `+` of any length (`"SELECT ... '" + name + "'"`): the
/// text written out holds SQL keywords and an operand is no literal string. The
/// measured build read a `+` of two operands only ([`interpolated_sql`]).
pub(crate) fn concatenated_sql(e: &Expr) -> bool {
    fn parts(e: &Expr, text: &mut String, other: &mut bool) {
        match e {
            Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
                parts(&b.left, text, other);
                parts(&b.right, text, other);
            }
            e => match string_value(e) {
                Some(s) => text.push_str(&s),
                None => *other = true,
            },
        }
    }
    if !matches!(e, Expr::BinOp(b) if matches!(b.op, ast::Operator::Add)) {
        return false;
    }
    let (mut text, mut other) = (String::new(), false);
    parts(e, &mut text, &mut other);
    let u = text.to_ascii_uppercase();
    other && SQL_KEYWORDS.iter().any(|k| u.contains(k))
}

/// Text built from a part that is no literal: an f-string with an interpolation,
/// `%` formatting, `.format()` or `+` with an operand that is no literal string.
pub(crate) fn interpolates(e: &Expr) -> bool {
    match e {
        Expr::FString(f) => f.value.iter().any(|part| match part {
            ast::FStringPartRef::Literal(_) => false,
            ast::FStringPartRef::FString(fs) => fs
                .elements
                .iter()
                .any(|el| matches!(el, ast::InterpolatedStringElement::Interpolation(_))),
        }),
        Expr::BinOp(b) if matches!(b.op, ast::Operator::Mod) => string_value(&b.left).is_some(),
        Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
            !(is_literal_string(&b.left) && is_literal_string(&b.right))
        }
        Expr::Call(c) => matches!(c.func.as_ref(), Expr::Attribute(a)
            if a.attr.as_str() == "format" && string_value(&a.value).is_some()),
        _ => false,
    }
}

/// HTML escapers: what they return is safe to mark safe.
const ESCAPERS: &[&str] = &[
    "django.utils.html.escape",
    "django.utils.html.conditional_escape",
    "markupsafe.escape",
    "html.escape",
    "flask.escape",
    "jinja2.escape",
];

/// Text marked safe that is escaped first: `Markup(escape(body))`, or an f-string whose
/// every interpolation is escaped (`f'<a href="{escape(url)}">{escape(url)}</a>'`).
fn escaped(col: &Collector, e: &Expr) -> bool {
    let is_escape = |e: &Expr| matches!(e, Expr::Call(c) if col.canon(&c.func).as_ref().and_then(dotted).is_some_and(|d| ESCAPERS.contains(&d.as_str())));
    match e {
        Expr::FString(f) => f.value.iter().all(|part| match part {
            ast::FStringPartRef::Literal(_) => true,
            ast::FStringPartRef::FString(fs) => fs.elements.iter().all(|el| match el {
                ast::InterpolatedStringElement::Literal(_) => true,
                ast::InterpolatedStringElement::Interpolation(i) => is_escape(&i.expression),
            }),
        }),
        e => is_escape(e),
    }
}

impl Lowerer<'_> {
    /// Sinks reached by one call.
    pub(crate) fn call_sinks(&self, col: &Collector, c: &ast::ExprCall) -> Vec<&'static str> {
        let mut out = Vec::new();
        let r = col.canon(&c.func);
        let d = r.as_ref().and_then(dotted);
        let d = d.as_deref();
        let name = callee_name(&c.func);
        let first = c.arguments.args.first();

        if let Some(RawRef {
            base: RawBase::Global(g),
            member,
        }) = &r
            && member.is_empty()
            && matches!(g.as_str(), "eval" | "exec")
            && first.is_some_and(|a| !is_literal_string(a))
        {
            out.push(kind::EVAL);
        }
        if let Some(d) = d {
            // A command written out in full (`os.system("clear")`) carries no input.
            let literal = arg(c, 0, "args")
                .or_else(|| arg(c, 0, "cmd"))
                .or_else(|| arg(c, 0, "command"))
                .is_some_and(is_literal_string);
            if !literal
                && (SHELL_FNS.contains(&d)
                    || (SUBPROCESS_FNS.contains(&d) && is_true(keyword(c, "shell"))))
            {
                out.push(kind::EXEC);
            }
            if DESERIALIZERS.contains(&d) {
                out.push(kind::DESERIALIZE);
            }
            if matches!(d, "yaml.load" | "yaml.load_all") {
                let loader = c.arguments.args.get(1).or_else(|| keyword(c, "Loader"));
                let safe = loader.is_some_and(|l| {
                    callee_name(l)
                        .is_some_and(|n| matches!(n, "SafeLoader" | "CSafeLoader" | "BaseLoader"))
                });
                if !safe {
                    out.push(kind::DESERIALIZE);
                }
            }
            if let Some((module, f)) = d.rsplit_once('.')
                && HTTP_CLIENT_MODULES.contains(&module)
                && HTTP_CLIENT_FNS.contains(&f)
            {
                let url = if f == "request" || f == "stream" {
                    arg(c, 1, "url")
                } else {
                    arg(c, 0, "url")
                };
                if url.is_some_and(|u| !is_fixed_origin(u)) {
                    out.push(kind::FETCH);
                }
            }
            if matches!(d, "urllib.request.urlopen" | "urllib.request.Request")
                && arg(c, 0, "url").is_some_and(|u| !is_fixed_origin(u))
            {
                out.push(kind::FETCH);
            }
            if REDIRECTS.contains(&d) {
                let target = arg(c, 0, "url").or_else(|| keyword(c, "redirect_to"));
                let computed = target.is_some_and(|t| {
                    !is_fixed_origin(t)
                        && !matches!(t, Expr::Call(tc) if matches!(callee_name(&tc.func), Some("url_for" | "reverse" | "reverse_lazy" | "url_path_for")))
                });
                if computed {
                    out.push(kind::REDIRECT);
                }
            }
            if matches!(d, "hashlib.md5" | "hashlib.sha1")
                && !is_false(keyword(c, "usedforsecurity"))
            {
                out.push(kind::WEAK_HASH);
            }
            if d == "hashlib.new"
                && first
                    .and_then(string_value)
                    .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "md5" | "sha1"))
                && !is_false(keyword(c, "usedforsecurity"))
            {
                out.push(kind::WEAK_HASH);
            }
            if d == "jwt.decode" {
                let no_verify = is_false(keyword(c, "verify"))
                    || matches!(keyword(c, "options"), Some(Expr::Dict(o)) if o.items.iter().any(|i| {
                        i.key.as_ref().and_then(string_value).as_deref() == Some("verify_signature")
                            && is_false(Some(&i.value))
                    }));
                if no_verify {
                    out.push(kind::JWT_DECODE);
                }
            }
            if SAFE_HTML.contains(&d)
                && first.is_some_and(|a| !is_literal_string(a) && !escaped(col, a))
            {
                out.push(kind::HTML);
            }
            if d == "flask_cors.CORS" {
                let origins = keyword(c, "origins").or_else(|| keyword(c, "resources"));
                if origins.is_none() || origins.and_then(string_value).as_deref() == Some("*") {
                    out.push(kind::CORS);
                }
            }
            if d.ends_with("RawSQL") && first.is_some_and(|a| !is_literal_string(a)) {
                out.push(kind::SQL_RAW);
            }
        }
        match name {
            Some("raw")
                if r.as_ref().is_some_and(|r| r.member.contains(".objects"))
                    && first.is_some_and(|a| !is_literal_string(a)) =>
            {
                if first.is_some_and(interpolated_sql) {
                    out.push(kind::SQL_INTERP);
                } else {
                    out.push(kind::SQL_RAW);
                }
            }
            Some(
                "execute" | "executemany" | "executescript" | "text" | "raw" | "exec_driver_sql",
            ) if first.is_some_and(interpolated_sql) => {
                out.push(kind::SQL_INTERP);
            }
            Some("set_cookie" | "set_signed_cookie") if !c.arguments.args.is_empty() => {
                if !is_true(keyword(c, "httponly")) {
                    out.push(kind::COOKIE);
                }
            }
            Some("add_middleware") => {
                let is_cors = first.is_some_and(|m| callee_name(m) == Some("CORSMiddleware"));
                let any = matches!(keyword(c, "allow_origins").and_then(elements), Some(els) if els.iter().any(|x| string_value(x).as_deref() == Some("*")))
                    || keyword(c, "allow_origin_regex")
                        .and_then(string_value)
                        .is_some_and(|s| s == ".*");
                if is_cors && any {
                    out.push(kind::CORS);
                }
            }
            _ => {}
        }
        out.dedup();
        out
    }

    /// Sinks one call reaches that the measured build did not read
    /// ([`crate::raw::RawSymbol::since_sinks`]): a query given a name the body bound
    /// to SQL built from a part that is no literal ([`Collector::sql_built`]), or a
    /// chain of `+` written where the query is ([`concatenated_sql`]).
    pub(crate) fn call_sinks_since(&self, col: &Collector, c: &ast::ExprCall) -> Vec<&'static str> {
        let first = c.arguments.args.first();
        let through_name = matches!(first, Some(Expr::Name(n)) if col.sql_built.contains(n.id.as_str()))
            || first.is_some_and(concatenated_sql);
        match callee_name(&c.func) {
            Some(
                "execute" | "executemany" | "executescript" | "text" | "raw" | "exec_driver_sql",
            ) if through_name => vec![kind::SQL_INTERP],
            _ => vec![],
        }
    }

    /// Schema validation: pydantic `model_validate`, DRF `serializer.is_valid()`, `jsonschema.validate`.
    pub(crate) fn is_validation_call(&self, col: &Collector, c: &ast::ExprCall) -> bool {
        if matches!(
            callee_name(&c.func),
            Some(
                "model_validate"
                    | "model_validate_json"
                    | "validate_python"
                    | "validate_json"
                    | "parse_obj"
                    | "parse_raw"
                    | "is_valid"
            )
        ) && matches!(c.func.as_ref(), Expr::Attribute(_))
        {
            return true;
        }
        matches!(
            col.canon(&c.func).as_ref().and_then(dotted).as_deref(),
            Some("jsonschema.validate")
        )
    }

    /// `os.getenv("X")`, `os.environ.get("X")` -> `os.environ.X`. The name may also come
    /// through a module constant (`KEY = "X"`), a literal key of a module dict of names
    /// (`NAMES["db"]`), or a call of a one-line env helper of the module
    /// (`def _env(n): return os.environ.get(n)` called as `_env("X")`).
    pub(crate) fn env_read_call(&self, col: &Collector, c: &ast::ExprCall) -> Option<String> {
        if let Some(key) = self.env_helper_call(col, c) {
            return Some(format!("os.environ.{key}"));
        }
        let d = col.canon(&c.func).as_ref().and_then(dotted)?;
        if !matches!(
            d.as_str(),
            "os.getenv" | "os.environ.get" | "os.environ.setdefault" | "os.environ.pop"
        ) {
            return None;
        }
        let key = c
            .arguments
            .args
            .first()
            .and_then(|a| self.env_key(col, a))?;
        Some(format!("os.environ.{key}"))
    }

    /// `os.environ["X"]` -> `os.environ.X`.
    pub(crate) fn env_read_subscript(
        &self,
        col: &Collector,
        s: &ast::ExprSubscript,
    ) -> Option<String> {
        let d = col.canon(&s.value).as_ref().and_then(dotted)?;
        if d != "os.environ" {
            return None;
        }
        let key = self.env_key(col, &s.slice)?;
        Some(format!("os.environ.{key}"))
    }
}
