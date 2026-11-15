//! Security- and quality-relevant signals inside function bodies.
//!
//! These are *facts about how code runs* (this call evaluates a string, builds
//! SQL from interpolation, writes raw HTML, ...). They are never rules: mining
//! learns which roles use or avoid them, and `drift security` lists them for review.
//!
//! Detection is syntactic and deliberately narrow, so a hit is worth a look.

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
    // Read since the measured build (TypeScript lowering 76): in the listed
    // reading only.
    pub const PATH: &str = "path_traversal";
    pub const TEMPLATE: &str = "template_injection";
    pub const NOSQL: &str = "nosql_injection";
    pub const SECRET: &str = "hardcoded_secret";
    pub const TLS: &str = "tls_verify_disabled";
}

/// Functions of `fs` that read, write or remove the file at the path they are given.
const FS_FNS: &[&str] = &[
    "readFile",
    "readFileSync",
    "createReadStream",
    "writeFile",
    "writeFileSync",
    "createWriteStream",
    "appendFile",
    "appendFileSync",
    "unlink",
    "unlinkSync",
    "rm",
    "rmSync",
    "readdir",
    "readdirSync",
];

/// Functions that compile or render the template text they are given, by package.
const TEMPLATE_FNS: &[(&str, &str)] = &[
    ("ejs", "render"),
    ("ejs", "compile"),
    ("pug", "render"),
    ("pug", "compile"),
    ("handlebars", "compile"),
    ("nunjucks", "renderString"),
    ("mustache", "render"),
    ("lodash", "template"),
];

/// Last property name of a member callee (`res.redirect` -> `redirect`).
fn member_name<'b>(callee: &'b Expression) -> Option<&'b str> {
    match unwrap_expr(callee) {
        Expression::StaticMemberExpression(m) => Some(m.property.name.as_str()),
        Expression::ChainExpression(c) => match &c.expression {
            ChainElement::StaticMemberExpression(m) => Some(m.property.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn is_literal_string(e: &Expression) -> bool {
    match unwrap_expr(e) {
        Expression::StringLiteral(_) => true,
        Expression::TemplateLiteral(t) => t.expressions.is_empty(),
        _ => false,
    }
}

/// Deployment config (`process.env.API_URL`, `import.meta.env.X`, `env.API_URL`,
/// `config.apiUrl`): set by operators, not by requests.
fn is_config(e: &Expression) -> bool {
    let Expression::StaticMemberExpression(m) = unwrap_expr(e) else {
        return false;
    };
    match unwrap_expr(&m.object) {
        Expression::StaticMemberExpression(inner) => inner.property.name == "env",
        Expression::Identifier(id) => matches!(id.name.as_str(), "env" | "config" | "Config"),
        _ => false,
    }
}

/// `API_URL`, `HOOK`: SCREAMING_CASE names are constants by convention.
fn is_constant_name(e: &Expression) -> bool {
    matches!(unwrap_expr(e), Expression::Identifier(id)
        if id.name.len() >= 3
            && id.name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            && id.name.chars().any(|c| c.is_ascii_uppercase()))
}

/// A URL with a literal or configured origin (`https://api.x.com/...${id}`,
/// `${process.env.API_URL}/v1`) is not "dynamic".
fn is_fixed_origin(e: &Expression) -> bool {
    match unwrap_expr(e) {
        Expression::StringLiteral(_) => true,
        e if is_config(e) || is_constant_name(e) => true,
        Expression::TemplateLiteral(t) => t.quasis.first().is_some_and(|q| {
            let s = q.value.raw.as_str();
            // The host must be literal: `https://api.x.com/${id}`, not `https://${host}`.
            let host_then_path = |rest: &str| {
                rest.find('/').is_some_and(|i| i > 0)
                    // `http://localhost:${port}/api`: a literal host, only the port interpolated.
                    || (rest.len() > 1
                        && rest.ends_with(':')
                        && !rest.contains(['@', '/', '?', '#'])
                        && t.quasis.get(1).is_some_and(|q| {
                            let n = q.value.raw.as_str();
                            n.starts_with('/') || (n.is_empty() && t.expressions.len() == 1)
                        }))
            };
            match s
                .strip_prefix("https://")
                .or_else(|| s.strip_prefix("http://"))
            {
                Some(rest) => host_then_path(rest),
                None if s.is_empty() => t
                    .expressions
                    .first()
                    .is_some_and(|e| is_config(e) || is_constant_name(e)),
                None => s.starts_with('/'),
            }
        }),
        _ => false,
    }
}

fn object_has_key(e: &Expression, key: &str) -> bool {
    matches!(unwrap_expr(e), Expression::ObjectExpression(o) if o.properties.iter().any(|p| matches!(p,
        ObjectPropertyKind::ObjectProperty(p) if p.key.static_name().is_some_and(|k| k.as_str() == Some(key)))))
}

fn object_value<'b, 'a>(e: &'b Expression<'a>, key: &str) -> Option<&'b Expression<'a>> {
    let Expression::ObjectExpression(o) = unwrap_expr(e) else {
        return None;
    };
    o.properties.iter().find_map(|p| match p {
        ObjectPropertyKind::ObjectProperty(p)
            if p.key.static_name().is_some_and(|k| k.as_str() == Some(key)) =>
        {
            Some(&p.value)
        }
        _ => None,
    })
}

/// Text an SQL statement is recognised by.
const SQL_KEYWORDS: [&str; 6] = [
    "SELECT ", "INSERT ", "UPDATE ", "DELETE ", " WHERE ", "FROM ",
];

fn has_sql(text: &str) -> bool {
    let s = text.to_ascii_uppercase();
    SQL_KEYWORDS.iter().any(|k| s.contains(k))
}

/// What the file's bindings hold that an SQL sink reads through a name (TypeScript
/// lowering 76): `const q = "SELECT ... '" + id + "'"; db.query(q)` is the
/// interpolation `db.query(`SELECT ... '${id}'`)` is, and `` `SELECT * FROM ${TABLE}` ``
/// with `const TABLE = "users"` interpolates no input.
#[derive(Default)]
pub(crate) struct SqlLocals {
    /// `const` bindings initialised with a literal: text written out, never input.
    constants: HashSet<SymbolId>,
    /// Bindings whose text is SQL (it holds a keyword), built or not.
    text: HashSet<SymbolId>,
    /// Bindings some statement gives SQL text built from a part that is no constant.
    built: HashSet<SymbolId>,
}

/// The symbol a reference names, where the file declares it.
fn symbol_of(scoping: &Scoping, id: &IdentifierReference) -> Option<SymbolId> {
    id.reference_id
        .get()
        .and_then(|r| scoping.get_reference(r).symbol_id())
}

/// The operands of a `+` chain and of the templates in it: the text written out
/// goes to `text`, everything else to `parts`.
fn string_parts<'b, 'a>(
    e: &'b Expression<'a>,
    text: &mut String,
    parts: &mut Vec<&'b Expression<'a>>,
) {
    match unwrap_expr(e) {
        Expression::StringLiteral(l) => text.push_str(&lit(l)),
        Expression::TemplateLiteral(t) => {
            for q in &t.quasis {
                text.push_str(q.value.raw.as_str());
            }
            for x in &t.expressions {
                string_parts(x, text, parts);
            }
        }
        Expression::BinaryExpression(b) if b.operator == BinaryOperator::Addition => {
            string_parts(&b.left, text, parts);
            string_parts(&b.right, text, parts);
        }
        other => parts.push(other),
    }
}

/// A list of placeholders: `ids.map(() => "?").join(", ")`, `ids.map((_, i) =>
/// `$${i + 1}`).join(",")`, `Array(n).fill("?").join(",")`. What it interpolates
/// is the count of the values, never one of them.
fn placeholders(e: &Expression) -> bool {
    let Expression::CallExpression(join) = unwrap_expr(e) else {
        return false;
    };
    let Expression::StaticMemberExpression(m) = unwrap_expr(&join.callee) else {
        return false;
    };
    if m.property.name != "join" {
        return false;
    }
    let Expression::CallExpression(made) = unwrap_expr(&m.object) else {
        return false;
    };
    let first = made.arguments.first().and_then(|a| a.as_expression());
    match member_name(&made.callee) {
        Some("fill") => first.is_some_and(is_literal_string),
        Some("map") => {
            let Some(Expression::ArrowFunctionExpression(f)) = first.map(unwrap_expr) else {
                return false;
            };
            let Some(body) = f.get_expression() else {
                return false;
            };
            // Only the index may be interpolated: the second parameter.
            let index = f.params.items.get(1).and_then(|p| match &p.pattern {
                BindingPattern::BindingIdentifier(b) => Some(b.name.as_str()),
                _ => None,
            });
            let mut text = String::new();
            let mut parts = Vec::new();
            string_parts(body, &mut text, &mut parts);
            parts.iter().all(|p| index_only(p, index))
        }
        _ => false,
    }
}

/// Arithmetic on the index and on numbers (`i + 1`, `i * 2 + offset` is not).
fn index_only(e: &Expression, index: Option<&str>) -> bool {
    match unwrap_expr(e) {
        Expression::NumericLiteral(_) => true,
        Expression::Identifier(id) => index == Some(id.name.as_str()),
        Expression::BinaryExpression(b) => {
            index_only(&b.left, index) && index_only(&b.right, index)
        }
        _ => false,
    }
}

impl SqlLocals {
    pub(crate) fn of(program: &Program, scoping: &Scoping) -> Self {
        let mut found = SqlLocals::default();
        let mut pass = SqlPass {
            scoping,
            found: &mut found,
            constants: true,
        };
        pass.visit_program(program);
        pass.constants = false;
        pass.visit_program(program);
        found
    }

    /// A value no request decides: a literal, deployment configuration, a constant
    /// by its name or by what it is bound to, a number made of anything, a list of
    /// placeholders.
    /// Text built from a part that is no constant, whatever the text is: a template
    /// or a chain of `+`.
    pub(crate) fn builds_text(&self, scoping: &Scoping, e: &Expression) -> bool {
        self.builds(scoping, e, true)
    }

    /// A value no request decides where a path is built: a constant, the directory
    /// of the module (`__dirname`, `__filename`, `import.meta.dirname`), the working
    /// or the temporary directory.
    pub(crate) fn fixed_path(&self, scoping: &Scoping, e: &Expression) -> bool {
        let e = unwrap_expr(e);
        match e {
            Expression::Identifier(id)
                if matches!(id.name.as_str(), "__dirname" | "__filename")
                    && symbol_of(scoping, id).is_none() =>
            {
                true
            }
            Expression::StaticMemberExpression(m)
                if matches!(unwrap_expr(&m.object), Expression::ImportMeta(_)) =>
            {
                true
            }
            Expression::CallExpression(c) => {
                matches!(member_name(&c.callee), Some("cwd" | "tmpdir" | "homedir"))
                    && c.arguments.is_empty()
            }
            _ => self.constant(scoping, e),
        }
    }

    pub(crate) fn constant(&self, scoping: &Scoping, e: &Expression) -> bool {
        let e = unwrap_expr(e);
        match e {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_) => true,
            Expression::Identifier(id) => {
                is_constant_name(e)
                    || symbol_of(scoping, id).is_some_and(|s| self.constants.contains(&s))
            }
            Expression::CallExpression(c) => {
                placeholders(e)
                    || matches!(unwrap_expr(&c.callee), Expression::Identifier(id)
                        if matches!(id.name.as_str(), "Number" | "parseInt" | "parseFloat")
                            && symbol_of(scoping, id).is_none())
            }
            _ => is_config(e),
        }
    }

    /// SQL text with a part that is no constant, written where it is used or bound
    /// to the name given.
    pub(crate) fn dynamic(&self, scoping: &Scoping, e: &Expression) -> bool {
        if let Expression::Identifier(id) = unwrap_expr(e) {
            return symbol_of(scoping, id).is_some_and(|s| self.built.contains(&s));
        }
        self.builds(scoping, e, false)
    }

    /// `e` builds text from a part that is no constant, and the text is SQL (or is
    /// added to SQL text: `known`).
    fn builds(&self, scoping: &Scoping, e: &Expression, known: bool) -> bool {
        if !matches!(
            unwrap_expr(e),
            Expression::TemplateLiteral(_) | Expression::BinaryExpression(_)
        ) {
            return false;
        }
        let mut text = String::new();
        let mut parts = Vec::new();
        string_parts(e, &mut text, &mut parts);
        (known || has_sql(&text))
            && parts.iter().any(|p| match unwrap_expr(p) {
                // SQL built from built SQL is built.
                Expression::Identifier(id)
                    if symbol_of(scoping, id).is_some_and(|s| self.built.contains(&s)) =>
                {
                    true
                }
                _ => !self.constant(scoping, p),
            })
    }
}

/// Fills [`SqlLocals`]: the constants first, then what is built from what is not one.
struct SqlPass<'s, 'f> {
    scoping: &'s Scoping,
    found: &'f mut SqlLocals,
    constants: bool,
}

impl<'a> Visit<'a> for SqlPass<'_, '_> {
    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        for d in &it.declarations {
            let (BindingPattern::BindingIdentifier(b), Some(init)) = (&d.id, &d.init) else {
                continue;
            };
            let Some(sym) = b.symbol_id.get() else {
                continue;
            };
            if self.constants {
                let literal = match unwrap_expr(init) {
                    Expression::StringLiteral(_) | Expression::NumericLiteral(_) => true,
                    Expression::TemplateLiteral(t) => t.expressions.is_empty(),
                    _ => false,
                };
                if it.kind.is_const() && literal {
                    self.found.constants.insert(sym);
                }
                let mut text = String::new();
                string_parts(init, &mut text, &mut Vec::new());
                if has_sql(&text) {
                    self.found.text.insert(sym);
                }
            } else if self.found.builds(self.scoping, init, false) {
                self.found.built.insert(sym);
            }
        }
        walk::walk_variable_declaration(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if !self.constants
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &it.left
            && let Some(sym) = symbol_of(self.scoping, id)
        {
            let known = self.found.text.contains(&sym);
            let built = match it.operator {
                AssignmentOperator::Assign => self.found.builds(self.scoping, &it.right, false),
                // `q += " AND owner = '" + owner + "'"`: more of the SQL `q` holds.
                AssignmentOperator::Addition => {
                    known
                        && (self.found.builds(self.scoping, &it.right, true)
                            || !matches!(
                                unwrap_expr(&it.right),
                                Expression::TemplateLiteral(_) | Expression::BinaryExpression(_)
                            ) && !self.found.constant(self.scoping, &it.right))
                }
                _ => false,
            };
            if built {
                self.found.built.insert(sym);
            }
        }
        walk::walk_assignment_expression(self, it);
    }
}

fn import_of(r: &RawRef) -> Option<(&str, &str)> {
    match &r.base {
        RawBase::Import { spec, name } => Some((spec.trim_start_matches("node:"), name.as_str())),
        _ => None,
    }
}

impl Lowerer<'_> {
    /// Sinks reached by one call.
    pub(super) fn call_sinks(&self, c: &CallExpression) -> Vec<&'static str> {
        let mut out = Vec::new();
        let first = c.arguments.first().and_then(|a| a.as_expression());
        let canon = self.canon_callee(&c.callee);
        let member = member_name(&c.callee);
        let imp = canon.as_ref().and_then(import_of);

        if let Some(r) = &canon
            && r.member.is_empty()
            && matches!(&r.base, RawBase::Global(n) if n == "eval")
        {
            out.push(kind::EVAL);
        }
        // child_process.exec / execSync (shell strings), spawn with { shell: true }.
        // The function itself, not a method called on what it returned
        // (`execSync("git --version").toString()`).
        let cp_member = canon.as_ref().map_or("", |r| r.member.as_str());
        let cp_fn = match imp {
            Some(("child_process", n)) if n == "default" || n == "*" => cp_member
                .strip_prefix('.')
                .filter(|m| !m.contains(['.', '(']))
                .map(str::to_string),
            Some(("child_process", n)) if cp_member.is_empty() => Some(n.to_string()),
            _ => None,
        };
        if let Some(f) = cp_fn.as_deref() {
            let shell_opt = c
                .arguments
                .iter()
                .filter_map(|a| a.as_expression())
                .any(|a| {
                    object_value(a, "shell").is_some_and(
                        |v| matches!(unwrap_expr(v), Expression::BooleanLiteral(b) if b.value),
                    )
                });
            // A command written out in full (`execSync("git --version")`) carries no input.
            let literal = first.is_some_and(is_literal_string);
            if !literal
                && (matches!(f, "exec" | "execSync")
                    || (matches!(f, "spawn" | "spawnSync" | "execFile" | "execFileSync")
                        && shell_opt))
            {
                out.push(kind::EXEC);
            }
        }
        if matches!(member, Some("$queryRawUnsafe" | "$executeRawUnsafe")) {
            out.push(kind::SQL_RAW);
        }
        if member == Some("raw")
            && let Some(r) = &canon
            && (r.member.ends_with("sql.raw")
                || r.member.ends_with("knex.raw")
                || r.member == ".raw"
                || r.member.ends_with("Prisma.raw"))
        {
            out.push(kind::SQL_RAW);
        }
        // The measured build read SQL interpolated where the call is written, of
        // five methods, whatever was interpolated. Since (lowering 76): text built
        // by `+`, text bound to a name first, the statement methods of the SQLite
        // drivers, and no hit where every part interpolated is a constant.
        let measured = matches!(
            member,
            Some("query" | "execute" | "$queryRaw" | "$executeRaw" | "unsafe")
        ) && matches!(first.map(unwrap_expr), Some(Expression::TemplateLiteral(t))
            if !t.expressions.is_empty()
                && t.quasis.iter().any(|q| has_sql(q.value.raw.as_str())));
        let since = matches!(
            member,
            Some(
                "query"
                    | "execute"
                    | "$queryRaw"
                    | "$executeRaw"
                    | "unsafe"
                    | "all"
                    | "get"
                    | "run"
                    | "each"
                    | "exec"
                    | "prepare"
            )
        ) && first.is_some_and(|e| self.sql.dynamic(self.scoping, e));
        if measured != since && routes::unmeasured_listing() {
            if measured {
                out.push(kind::SQL_INTERP);
            }
        } else if since {
            out.push(kind::SQL_INTERP);
        }
        if member == Some("redirect")
            || matches!(
                imp,
                Some(("next/navigation", "redirect" | "permanentRedirect"))
            )
        {
            // `res.redirect(url)` with a computed target; `res.redirect(302, url)` (status
            // first) and Hono's `c.redirect(url, 302)` (status second) too.
            let status_first =
                first.is_some_and(|e| matches!(unwrap_expr(e), Expression::NumericLiteral(_)));
            let target = if status_first {
                c.arguments.get(1)
            } else {
                c.arguments.first()
            };
            if target
                .and_then(|a| a.as_expression())
                .is_some_and(|e| !is_literal_string(e) && !is_fixed_origin(e))
            {
                out.push(kind::REDIRECT);
            }
        }
        // The client itself or one of its request methods (`axios.get(url)`), not its
        // helpers (`axios.isAxiosError(e)`, `axios.create(opts)`).
        let request_member = canon.as_ref().is_some_and(|r| {
            matches!(
                r.member.as_str(),
                "" | ".get"
                    | ".post"
                    | ".put"
                    | ".patch"
                    | ".delete"
                    | ".head"
                    | ".options"
                    | ".request"
                    | ".stream"
            )
        });
        let is_fetch = matches!(&canon, Some(r) if r.member.is_empty() && matches!(&r.base, RawBase::Global(n) if n == "fetch"))
            || (request_member
                && matches!(imp, Some(("axios", "default")) | Some(("got", "default"))))
            || matches!(&canon, Some(r) if r.member.is_empty() && matches!(import_of(r), Some(("node-fetch", "default"))))
            || matches!(imp, Some(("undici", "fetch" | "request")));
        if is_fetch
            && first.is_some_and(|e| !is_fixed_origin(e))
            && first.is_some_and(|e| !matches!(unwrap_expr(e), Expression::ObjectExpression(_)))
        {
            out.push(kind::FETCH);
        }
        if (member == Some("createHash") || matches!(imp, Some(("crypto", "createHash"))))
            && let Some(Expression::StringLiteral(l)) = first.map(unwrap_expr)
            && matches!(
                l.value.as_str().map(str::to_ascii_lowercase).as_deref(),
                Some("md5" | "sha1")
            )
        {
            out.push(kind::WEAK_HASH);
        }
        if matches!(imp, Some(("jsonwebtoken", "decode")))
            || (member == Some("decode") && matches!(imp, Some(("jsonwebtoken", "default" | "*"))))
        {
            out.push(kind::JWT_DECODE);
        }
        // res.cookie(name, value, opts) / cookies().set(name, value, opts) without httpOnly.
        let is_cookie_set = member == Some("cookie")
            || (member == Some("set")
                && matches!(&canon, Some(r) if r.member.ends_with("().set") && matches!(import_of(r), Some(("next/headers", "cookies")))));
        if is_cookie_set && c.arguments.len() >= 2 {
            let opts = c.arguments.get(2).and_then(|a| a.as_expression());
            if !opts.is_some_and(|o| object_has_key(o, "httpOnly")) {
                out.push(kind::COOKIE);
            }
        }
        if matches!(imp, Some(("cors", "default"))) {
            let any = match first {
                None => true,
                Some(o) => object_value(o, "origin").is_some_and(|v| match unwrap_expr(v) {
                    Expression::StringLiteral(l) => l.value.as_str() == Some("*"),
                    Expression::BooleanLiteral(b) => b.value,
                    _ => false,
                }),
            };
            if any {
                out.push(kind::CORS);
            }
        }
        // What the measured build did not read is in the listed reading only.
        let since = self.call_sinks_since(c);
        if !since.is_empty() && !routes::unmeasured_listing() {
            out.extend(since);
        }
        out
    }

    /// The function of a package a call names: `("fs", "readFile")` for
    /// `fs.readFile(...)`, `fs.promises.readFile(...)` and a named import of it.
    fn package_fn(&self, callee: &Expression) -> Option<(String, String)> {
        let r = self.canon_callee(callee)?;
        let (spec, name) = import_of(&r)?;
        let member = r.member.trim_start_matches('.');
        if member.contains('(') {
            return None;
        }
        let function = match (name, member.rsplit('.').next().filter(|m| !m.is_empty())) {
            ("default" | "*", Some(m)) => m,
            // The package itself, called: `session({...})`.
            ("default" | "*", None) => "default",
            (n, None) => n,
            // `promises.readFile` of `import { promises } from "fs"`.
            (_, Some(m)) => m,
        };
        Some((spec.to_string(), function.to_string()))
    }

    /// Sinks one call reaches that the measured build did not read (TypeScript
    /// lowering 76): a file at a path built from a part that is no constant,
    /// template text that is not written out, a MongoDB `$where` built from a part
    /// that is no constant, Angular's `bypassSecurityTrust*`, a secret written in
    /// the code where a token is signed or a session is keyed, and a TLS
    /// connection that does not verify the certificate.
    fn call_sinks_since(&self, c: &CallExpression) -> Vec<&'static str> {
        let mut out = Vec::new();
        let args: Vec<&Expression> = c
            .arguments
            .iter()
            .filter_map(|a| a.as_expression())
            .collect();
        let first = args.first().copied();
        let member = member_name(&c.callee);
        let named = self.package_fn(&c.callee);
        let named = named.as_ref().map(|(p, f)| (p.as_str(), f.as_str()));
        let text = |e: &Expression| matches!(unwrap_expr(e), Expression::StringLiteral(l) if !lit(l).is_empty());

        // A path joined or built from a part that is no constant.
        let built_path = |e: &Expression| -> bool {
            if let Expression::CallExpression(j) = unwrap_expr(e)
                && matches!(
                    self.package_fn(&j.callee)
                        .as_ref()
                        .map(|(p, f)| (p.as_str(), f.as_str())),
                    Some(("path" | "path/posix" | "path/win32", "join" | "resolve"))
                )
            {
                return j.arguments.iter().any(|a| {
                    !a.as_expression()
                        .is_some_and(|x| self.sql.fixed_path(self.scoping, x))
                });
            }
            self.sql.builds_text(self.scoping, e)
        };
        let reads_file = matches!(named, Some(("fs" | "fs/promises" | "fs-extra", f)) if FS_FNS.contains(&f))
            || matches!(member, Some("sendFile" | "download"));
        if reads_file && first.is_some_and(built_path) {
            out.push(kind::PATH);
        }
        if matches!(named, Some(pf) if TEMPLATE_FNS.contains(&pf))
            && first.is_some_and(|e| !is_literal_string(e))
        {
            out.push(kind::TEMPLATE);
        }
        if matches!(
            named,
            Some((
                "vm",
                "runInNewContext" | "runInContext" | "runInThisContext"
            ))
        ) && first.is_some_and(|e| !is_literal_string(e))
        {
            out.push(kind::EVAL);
        }
        // `{ $where: `this.owner == ${owner}` }` in what a query is given.
        let wheres = |e: &Expression| -> bool {
            let Expression::ObjectExpression(o) = unwrap_expr(e) else {
                return false;
            };
            o.properties.iter().any(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => {
                    p.key
                        .static_name()
                        .is_some_and(|k| k.as_str() == Some("$where"))
                        && self.sql.builds_text(self.scoping, &p.value)
                }
                _ => false,
            })
        };
        if args.iter().any(|a| wheres(a)) {
            out.push(kind::NOSQL);
        }
        if matches!(
            member,
            Some(
                "bypassSecurityTrustHtml"
                    | "bypassSecurityTrustScript"
                    | "bypassSecurityTrustStyle"
                    | "bypassSecurityTrustUrl"
                    | "bypassSecurityTrustResourceUrl"
            )
        ) && first.is_some_and(|e| !is_literal_string(e))
        {
            out.push(kind::HTML);
        }
        // A secret written in the code: the key a token is signed or verified
        // with, the secret a session or a cookie is signed with.
        let secret = match named {
            Some(("jsonwebtoken", "sign" | "verify")) => args.get(1).is_some_and(|e| text(e)),
            Some(("express-session" | "cookie-session", _)) => first
                .and_then(|o| object_value(o, "secret"))
                .is_some_and(text),
            Some(("cookie-parser", _)) => first.is_some_and(text),
            _ => false,
        };
        if secret {
            out.push(kind::SECRET);
        }
        if args.iter().any(|a| {
            object_value(a, "rejectUnauthorized").is_some_and(
                |v| matches!(unwrap_expr(v), Expression::BooleanLiteral(b) if !b.value),
            )
        }) {
            out.push(kind::TLS);
        }
        out
    }

    /// Schema validation calls: zod/valibot/yup/joi/class-validator style.
    pub(super) fn is_validation_call(&self, c: &CallExpression) -> bool {
        if matches!(
            member_name(&c.callee),
            Some(
                "parse"
                    | "safeParse"
                    | "parseAsync"
                    | "safeParseAsync"
                    | "validateSync"
                    | "validateAsync"
            )
        ) {
            return true;
        }
        matches!(
            self.canon_callee(&c.callee).as_ref().and_then(import_of),
            Some(("valibot", "parse" | "safeParse" | "parseAsync"))
                | Some((
                    "class-validator",
                    "validate" | "validateOrReject" | "validateSync"
                ))
        )
    }

    /// `process.env.X` / `import.meta.env.X` read by a member expression.
    pub(super) fn env_read(&self, m: &StaticMemberExpression) -> Option<String> {
        match unwrap_expr(&m.object) {
            Expression::StaticMemberExpression(inner) if inner.property.name == "env" => {
                match unwrap_expr(&inner.object) {
                    Expression::Identifier(p)
                        if p.name == "process"
                            && matches!(self.resolve_ident(p), Some(RawBase::Global(_))) =>
                    {
                        Some(format!("process.env.{}", m.property.name))
                    }
                    Expression::ImportMeta(_) => {
                        Some(format!("import.meta.env.{}", m.property.name))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// Record a class's injected/typed properties so `this.users.find()` resolves to `UsersService#find`.
    pub(super) fn set_this_types(&self, class: &Class) {
        let mut map = BTreeMap::new();
        let type_ref = |t: &Option<oxc_allocator::Box<TSTypeAnnotation>>| -> Option<RawRef> {
            // `rules: RulesService`, and `model: typeof Rule` (the class itself).
            let id = match &t.as_ref()?.type_annotation {
                TSType::TSTypeReference(r) => match &r.type_name {
                    TSTypeName::IdentifierReference(id) => id,
                    _ => return None,
                },
                TSType::TSTypeQuery(q) => match &q.expr_name {
                    TSTypeQueryExprName::IdentifierReference(id) => id,
                    _ => return None,
                },
                _ => return None,
            };
            // A class imported with `import type` is erased, and is still the type.
            let base = self.resolve_ident(id).or_else(|| {
                let (spec, name) = self.type_imports.get(id.name.as_str())?;
                Some(RawBase::Import {
                    spec: spec.clone(),
                    name: name.clone(),
                })
            })?;
            Some(RawRef {
                base,
                member: String::new(),
            })
        };
        // A property that holds a plain value, by its declared type or by what it is
        // initialised with.
        let global = |id: &IdentifierReference| {
            PLAIN_TYPES.contains(&id.name.as_str())
                && matches!(self.resolve_ident(id), Some(RawBase::Global(_)))
        };
        let plain_type = |t: &Option<oxc_allocator::Box<TSTypeAnnotation>>| -> bool {
            match t.as_ref().map(|t| &t.type_annotation) {
                Some(
                    TSType::TSArrayType(_)
                    | TSType::TSTupleType(_)
                    | TSType::TSStringKeyword(_)
                    | TSType::TSNumberKeyword(_)
                    | TSType::TSBooleanKeyword(_)
                    | TSType::TSBigIntKeyword(_),
                ) => true,
                Some(TSType::TSTypeReference(r)) => {
                    matches!(&r.type_name, TSTypeName::IdentifierReference(id) if global(id))
                }
                _ => false,
            }
        };
        let plain_value = |e: &Expression| match unwrap_expr(e) {
            Expression::ArrayExpression(_)
            | Expression::StringLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_) => true,
            Expression::NewExpression(n) => {
                matches!(unwrap_expr(&n.callee), Expression::Identifier(id) if global(id))
            }
            _ => false,
        };
        let mut plain = BTreeSet::new();
        let mut request = BTreeSet::new();
        // `@Inject(REQUEST)`: the field holds the request.
        let injects_request = |p: &FormalParameter| {
            p.decorators.iter().any(|d| {
                let Expression::CallExpression(c) = unwrap_expr(&d.expression) else {
                    return false;
                };
                call_name(&c.callee) == Some("Inject")
                    && c.arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .and_then(|a| self.canon(a))
                        .is_some_and(|r| {
                            matches!(&r.base, RawBase::Import { spec, name }
                                if (spec == "@nestjs/core" && name == "REQUEST")
                                    || (spec == "@nestjs/graphql" && name == "CONTEXT"))
                                && r.member.is_empty()
                        })
            })
        };
        for el in &class.body.body {
            match el {
                ClassElement::MethodDefinition(m) if m.kind.is_constructor() => {
                    for p in &m.value.params.items {
                        if let BindingPattern::BindingIdentifier(id) = &p.pattern
                            && injects_request(p)
                        {
                            request.insert(id.name.to_string());
                        }
                        if (p.accessibility.is_some() || p.readonly)
                            && let BindingPattern::BindingIdentifier(id) = &p.pattern
                        {
                            if plain_type(&p.type_annotation) {
                                plain.insert(id.name.to_string());
                            } else if let Some(r) = type_ref(&p.type_annotation) {
                                map.insert(id.name.to_string(), r);
                            }
                        }
                    }
                }
                ClassElement::PropertyDefinition(p) => {
                    if let Some(k) = p.key.static_name()
                        && let Some(k) = k.as_str()
                    {
                        if plain_type(&p.type_annotation)
                            || (p.type_annotation.is_none()
                                && p.value.as_ref().is_some_and(plain_value))
                        {
                            plain.insert(k.to_string());
                        }
                        if let Some(r) = type_ref(&p.type_annotation) {
                            map.insert(k.to_string(), r);
                        }
                    }
                }
                _ => {}
            }
        }
        *self.this_types.borrow_mut() = map;
        *self.this_plain.borrow_mut() = plain;
        *self.this_request.borrow_mut() = request;
    }
}

/// Built-in types whose values run no code of the repository when a method of
/// theirs is called.
const PLAIN_TYPES: &[&str] = &[
    "Array",
    "ReadonlyArray",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Record",
    "Date",
    "RegExp",
    "String",
    "Number",
    "URL",
    "URLSearchParams",
    "AbortController",
];
