//! Does a handler read request input? A three-way answer for one function: it reads
//! input, it provably reads none, or Drift cannot tell. Only the first two become facts
//! (`reads_input`, `no_input`), so "cannot tell" never counts as "takes no input".

use std::collections::BTreeSet;

use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};

use super::unwrap_expr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InputUse {
    /// The function's parameters are request input it reads.
    Reads,
    /// No parameter, or only parameters that carry no input (`({ ctx }) => ...`).
    None,
    /// A parameter is used in a way Drift does not follow (handed to a helper,
    /// `req.headers`, a rest parameter, a destructured key it does not know).
    Unknown,
}

impl InputUse {
    pub(crate) fn merge(self, other: Self) -> Self {
        match (self, other) {
            (Self::Reads, _) | (_, Self::Reads) => Self::Reads,
            (Self::Unknown, _) | (_, Self::Unknown) => Self::Unknown,
            _ => Self::None,
        }
    }
}

/// Keys of a destructured parameter, or of a value read from one, that are request
/// input: tRPC's `input`, next-safe-action's `parsedInput`, route `params` and
/// `searchParams`, an Express `body` or `query`, a form's `formData`.
pub(crate) const INPUT_KEYS: &[&str] = &[
    "input",
    "parsedInput",
    "rawInput",
    "params",
    "searchParams",
    "body",
    "query",
    "formData",
];

/// Names a destructured parameter gives the request (`({ request, params })`).
pub(crate) const REQUEST_KEYS: &[&str] = &["req", "request"];

/// Keys of a destructured parameter that are known to carry no request input. Any
/// other key may be input (Inngest's `{ event }`, multer's `{ file }`, BullMQ's
/// `{ data }`, a plain `createProject({ name })`), so it is unknown, never none.
///
/// - `ctx`: tRPC's procedure and middleware context, built on the server from the
///   session (tRPC hands input only as `input` / `rawInput`);
/// - `next`: tRPC middleware's continuation (`({ ctx, next }) => next()`);
/// - `signal`: the `AbortSignal` tRPC resolvers and TanStack Query functions get.
pub(crate) const NON_INPUT_KEYS: &[&str] = &["ctx", "next", "signal"];

/// Methods of a Hono context that build a response: `c.json(rows)`, `c.text("hi")`.
/// Called with an argument they read nothing (a request's `r.json()` takes none).
const RESPONSE_HELPERS: &[&str] = &["json", "text", "body", "html"];

/// Members of a request object that read its input (`r.json()`, `req.body`, Hono's
/// `c.req.valid()`, `request.nextUrl.searchParams`).
pub(crate) const REQUEST_INPUT_MEMBERS: &[&str] = &[
    "body",
    "query",
    "params",
    "param",
    "json",
    "formData",
    "text",
    "arrayBuffer",
    "blob",
    "valid",
    "parseBody",
    "url",
    "nextUrl",
    "searchParams",
    "payload",
];

/// What the function with these parameters and body reads. `client_args` marks a
/// function whose arguments are client input whatever their names (a Next.js server
/// action: `save(formData)`, `saveLink(url)`).
///
/// The first parameter is the request (`POST(r)`, Express `(req, res)`, Hono `(c)`),
/// and so is the second of an Express error handler `(err, req, res, next)`: reading
/// an input member of it is reading input, and any other use of it (handing it to
/// `parseRequestBody(req)`, `req.headers`) cannot be told apart from one. Later
/// parameters (a route context, `res`, `next`) read input through `params` or
/// `searchParams`, or when named for input (`(prev, formData)`). Destructured
/// parameters read input when they name an input key, carry none only when every key
/// is a known non-input key ([`NON_INPUT_KEYS`]), and are unknown otherwise.
pub(crate) fn arrow_input(a: &ArrowFunctionExpression, client_args: bool) -> InputUse {
    params_input(&a.params, client_args, |uses| {
        uses.visit_arrow_function_expression(a);
    })
}

/// [`arrow_input`] for a function declaration or expression.
pub(crate) fn function_input(f: &Function, client_args: bool) -> InputUse {
    params_input(&f.params, client_args, |uses| {
        if let Some(body) = &f.body {
            uses.visit_function_body(body);
        }
    })
}

/// The function takes exactly one parameter, destructured as an object
/// (`({ ctx, parsedInput }) => ...`): what a wrapper that calls it with an object of
/// its own hands it, read by key.
pub(crate) fn takes_one_object(params: &FormalParameters) -> bool {
    params.rest.is_none()
        && params.items.len() == 1
        && matches!(params.items[0].pattern, BindingPattern::ObjectPattern(_))
}

fn params_input(
    params: &FormalParameters,
    client_args: bool,
    visit_body: impl FnOnce(&mut ParamUse),
) -> InputUse {
    if params.items.is_empty() && params.rest.is_none() {
        // No parameter, but `arguments` reads whatever the caller passed.
        let none = BTreeSet::new();
        let mut uses = ParamUse {
            request: &none,
            context: &none,
            result: InputUse::None,
            arguments: false,
            nested: 0,
        };
        visit_body(&mut uses);
        return match (uses.arguments, client_args) {
            (false, _) => InputUse::None,
            (true, true) => InputUse::Reads,
            (true, false) => InputUse::Unknown,
        };
    }
    if client_args {
        return InputUse::Reads;
    }
    let mut result = if params.rest.is_some() {
        InputUse::Unknown
    } else {
        InputUse::None
    };
    let mut request = BTreeSet::new();
    let mut context = BTreeSet::new();
    // Express calls a function of four parameters as an error handler.
    let error_handler = params.items.len() == 4;
    for (i, p) in params.items.iter().enumerate() {
        result = result.merge(pattern_input(
            &p.pattern,
            i == 0 || (error_handler && i == 1),
            &mut request,
            &mut context,
        ));
    }
    if result == InputUse::Reads || (request.is_empty() && context.is_empty()) {
        return result;
    }
    let mut uses = ParamUse {
        request: &request,
        context: &context,
        result: InputUse::None,
        arguments: false,
        nested: 0,
    };
    visit_body(&mut uses);
    let arguments = if uses.arguments {
        InputUse::Unknown
    } else {
        InputUse::None
    };
    result.merge(uses.result).merge(arguments)
}

fn pattern_input(
    pattern: &BindingPattern,
    first: bool,
    request: &mut BTreeSet<String>,
    context: &mut BTreeSet<String>,
) -> InputUse {
    match pattern {
        BindingPattern::BindingIdentifier(b) => {
            if first {
                request.insert(b.name.to_string());
            } else if INPUT_KEYS.contains(&b.name.as_str()) {
                return InputUse::Reads;
            } else {
                context.insert(b.name.to_string());
            }
            InputUse::None
        }
        BindingPattern::ObjectPattern(o) => {
            let mut result = if o.rest.is_some() {
                InputUse::Unknown
            } else {
                InputUse::None
            };
            for p in &o.properties {
                let key = if p.computed {
                    None
                } else {
                    p.key
                        .static_name()
                        .and_then(|k| k.as_str().map(str::to_string))
                };
                match key.as_deref() {
                    Some(k) if INPUT_KEYS.contains(&k) => return InputUse::Reads,
                    Some(k) if REQUEST_KEYS.contains(&k) => {
                        if let BindingPattern::BindingIdentifier(b) = &p.value {
                            request.insert(b.name.to_string());
                        } else {
                            result = InputUse::Unknown;
                        }
                    }
                    Some(k) if NON_INPUT_KEYS.contains(&k) => {}
                    _ => result = InputUse::Unknown,
                }
            }
            result
        }
        BindingPattern::AssignmentPattern(a) => pattern_input(&a.left, first, request, context),
        BindingPattern::ArrayPattern(_) => InputUse::Unknown,
    }
}

/// An argument list hands `name` on: as an argument or an object property value.
fn passes(args: &[Argument], names: &BTreeSet<String>) -> bool {
    let is_name = |e: &Expression| matches!(unwrap_expr(e), Expression::Identifier(id) if names.contains(id.name.as_str()));
    args.iter().filter_map(Argument::as_expression).any(|e| {
        is_name(e)
            || matches!(unwrap_expr(e), Expression::ObjectExpression(o) if o.properties.iter().any(|p| {
                matches!(p, ObjectPropertyKind::ObjectProperty(p) if is_name(&p.value))
            }))
    })
}

/// Inline functions among a call's arguments, directly or as object property values
/// (`client({ request, handler: async ({ parsedInput }) => ... })`).
fn inline_functions<'b, 'a>(args: &'b [Argument<'a>]) -> Vec<&'b Expression<'a>> {
    let is_fn = |e: &Expression| {
        matches!(
            unwrap_expr(e),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
    };
    let mut out = Vec::new();
    for e in args.iter().filter_map(Argument::as_expression) {
        if is_fn(e) {
            out.push(e);
        } else if let Expression::ObjectExpression(o) = unwrap_expr(e) {
            for p in &o.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = p
                    && is_fn(&p.value)
                {
                    out.push(&p.value);
                }
            }
        }
    }
    out
}

/// The input an inline function reads through its own parameters.
fn inline_input(e: &Expression) -> InputUse {
    match unwrap_expr(e) {
        Expression::ArrowFunctionExpression(a) => arrow_input(a, false),
        Expression::FunctionExpression(f) => function_input(f, false),
        _ => InputUse::Unknown,
    }
}

/// How a body uses the request and context parameters.
struct ParamUse<'n> {
    request: &'n BTreeSet<String>,
    context: &'n BTreeSet<String>,
    result: InputUse,
    /// The body reads `arguments` (of its own function, not of a nested one).
    arguments: bool,
    /// Depth of nested non-arrow functions, which have their own `arguments`.
    nested: usize,
}

impl ParamUse<'_> {
    fn tracked(&self, e: &Expression) -> bool {
        matches!(unwrap_expr(e), Expression::Identifier(id)
            if self.request.contains(id.name.as_str()) || self.context.contains(id.name.as_str()))
    }
}

impl<'a> Visit<'a> for ParamUse<'_> {
    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if let Expression::Identifier(id) = unwrap_expr(&it.object) {
            let property = it.property.name.as_str();
            if self.request.contains(id.name.as_str()) {
                self.result = self
                    .result
                    .merge(if REQUEST_INPUT_MEMBERS.contains(&property) {
                        InputUse::Reads
                    } else {
                        InputUse::Unknown
                    });
                return;
            }
            if self.context.contains(id.name.as_str()) {
                if matches!(property, "params" | "searchParams") {
                    self.result = InputUse::Reads;
                }
                return;
            }
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        // Express's `next()`: calling a later parameter reads nothing. Hono's
        // `c.json(rows)` builds a response.
        let response = matches!(unwrap_expr(&it.callee), Expression::StaticMemberExpression(m)
            if !it.arguments.is_empty()
                && RESPONSE_HELPERS.contains(&m.property.name.as_str())
                && matches!(unwrap_expr(&m.object), Expression::Identifier(id) if self.request.contains(id.name.as_str())));
        if response
            || matches!(unwrap_expr(&it.callee), Expression::Identifier(id) if self.context.contains(id.name.as_str()))
        {
            for a in it.arguments.iter().filter_map(Argument::as_expression) {
                self.visit_expression(a);
            }
            return;
        }
        let all: BTreeSet<String> = self.request.union(self.context).cloned().collect();
        if passes(&it.arguments, &all) {
            // A request handed to the call that also takes the inline handler: the
            // wrapper parses it, and the handler reads input when its own parameters
            // do. A handler whose parameters carry none (`withBody(req, async () =>
            // ...)`) does not make the request unread: the wrapper was handed it.
            let reads = inline_functions(&it.arguments)
                .iter()
                .any(|f| inline_input(f) == InputUse::Reads);
            self.result = self.result.merge(if reads {
                InputUse::Reads
            } else {
                InputUse::Unknown
            });
        }
        self.visit_expression(&it.callee);
        for a in it.arguments.iter().filter_map(Argument::as_expression) {
            match unwrap_expr(a) {
                e if self.tracked(e) => {}
                Expression::ObjectExpression(o) => {
                    for p in &o.properties {
                        match p {
                            ObjectPropertyKind::ObjectProperty(p) if self.tracked(&p.value) => {}
                            ObjectPropertyKind::ObjectProperty(p) => {
                                self.visit_expression(&p.value)
                            }
                            ObjectPropertyKind::SpreadProperty(s) => {
                                self.visit_expression(&s.argument);
                            }
                        }
                    }
                }
                e => self.visit_expression(e),
            }
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        // `const { body } = req`
        if let Some(init) = &it.init
            && matches!(unwrap_expr(init), Expression::Identifier(id) if self.request.contains(id.name.as_str()))
        {
            let reads = matches!(&it.id, BindingPattern::ObjectPattern(o) if o.properties.iter().any(|p| {
                !p.computed && p.key.static_name().is_some_and(|k| k.as_str().is_some_and(|k| INPUT_KEYS.contains(&k)))
            }));
            self.result = self.result.merge(if reads {
                InputUse::Reads
            } else {
                InputUse::Unknown
            });
            return;
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if self.request.contains(it.name.as_str()) || self.context.contains(it.name.as_str()) {
            self.result = self.result.merge(InputUse::Unknown);
        }
        if it.name == "arguments" && self.nested == 0 {
            self.arguments = true;
        }
    }

    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
        self.nested += 1;
        walk::walk_function(self, it, flags);
        self.nested -= 1;
    }
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;

    /// The input the first function of `src` reads: a declaration, or the value of
    /// the first `const`.
    fn input_of(src: &str) -> InputUse {
        let alloc = Allocator::default();
        let ret = Parser::new(&alloc, src, SourceType::ts()).parse();
        assert!(ret.diagnostics.is_empty(), "{src} does not parse");
        for stmt in &ret.program.body {
            let decl = match stmt {
                Statement::ExportDeclaration(e) => Some(&e.declaration),
                s => s.as_declaration(),
            };
            match decl {
                Some(Declaration::FunctionDeclaration(f)) => return function_input(f, false),
                Some(Declaration::VariableDeclaration(v)) => {
                    match v.declarations[0].init.as_ref().map(unwrap_expr) {
                        Some(Expression::ArrowFunctionExpression(a)) => {
                            return arrow_input(a, false);
                        }
                        Some(Expression::FunctionExpression(f)) => {
                            return function_input(f, false);
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        panic!("no function in {src}");
    }

    fn check(cases: &[(&str, InputUse)]) {
        for (src, want) in cases {
            assert_eq!(input_of(src), *want, "{src}");
        }
    }

    // The review of PR #37: a destructured key Drift does not know may be input.
    #[test]
    fn unknown_destructured_keys_are_unknown() {
        check(&[
            // Inngest, BullMQ, Trigger.dev, multer, Express after `router.param`.
            (
                "const f = async ({ event, step }) => mail(event.data.email);",
                InputUse::Unknown,
            ),
            (
                "const f = async ({ data }) => send(data.to);",
                InputUse::Unknown,
            ),
            (
                "const f = async ({ userId }) => load(userId);",
                InputUse::Unknown,
            ),
            (
                "const f = ({ file }, res) => res.json(store(file));",
                InputUse::Unknown,
            ),
            (
                "const f = ({ user }, res) => res.json(user);",
                InputUse::Unknown,
            ),
            (
                "export function createProject({ name, ownerId }) { return [name, ownerId]; }",
                InputUse::Unknown,
            ),
            // Destructured `headers` is unknown, as `req.headers` is.
            (
                "export function POST({ headers }: Request) { return headers.get(\"x\"); }",
                InputUse::Unknown,
            ),
            (
                "export function POST(req: Request) { return req.headers.get(\"x\"); }",
                InputUse::Unknown,
            ),
            ("const f = ({ [k]: v }) => v;", InputUse::Unknown),
        ]);
    }

    #[test]
    fn known_non_input_keys_and_no_parameters_are_none() {
        check(&[
            ("const f = async ({ ctx }) => ctx.user;", InputUse::None),
            (
                "const f = ({ ctx, next }) => next({ ctx });",
                InputUse::None,
            ),
            (
                "const f = ({ signal }) => fetchAll(signal);",
                InputUse::None,
            ),
            ("const f = async () => list();", InputUse::None),
            (
                "const f = (_req, res) => res.json({ ok: true });",
                InputUse::None,
            ),
            (
                "const f = ({ ctx, input }) => ctx.get(input.id);",
                InputUse::Reads,
            ),
            (
                "export function GET(_r: Request, { params }) { return params.id; }",
                InputUse::Reads,
            ),
        ]);
    }

    // A request handed to a call that also takes a callback is read by the wrapper,
    // whatever the callback's own parameters say.
    #[test]
    fn a_request_handed_to_a_wrapper_with_a_callback() {
        check(&[
            (
                "export function POST(req) { return withBody(req, async ({ name }) => save(name)); }",
                InputUse::Unknown,
            ),
            (
                "export function POST(req) { return withBody(req, async () => ok()); }",
                InputUse::Unknown,
            ),
            (
                "export function POST(req) { return withBody(req, async ({ ctx }) => ctx.user); }",
                InputUse::Unknown,
            ),
            (
                "const f = async (request) => client({ request, handler: async ({ parsedInput }) => parsedInput.name });",
                InputUse::Reads,
            ),
        ]);
    }

    #[test]
    fn hono_response_helpers_read_nothing() {
        check(&[
            ("const f = (c) => c.json(rows());", InputUse::None),
            ("const f = (c) => c.text(\"hi\");", InputUse::None),
            (
                "const f = async (c) => c.json(await c.req.json());",
                InputUse::Unknown,
            ),
            ("const f = async (r) => r.json();", InputUse::Reads),
            ("const f = async (r) => r.text();", InputUse::Reads),
        ]);
    }

    // Later parameters: named for input, or the request of an Express error handler.
    #[test]
    fn later_parameters_that_carry_input() {
        check(&[
            (
                "export async function act(prev, formData) { return formData.get(\"n\"); }",
                InputUse::Reads,
            ),
            (
                "const f = (err, rq, res, next) => res.json(rq.body);",
                InputUse::Reads,
            ),
            (
                "const f = (err, rq, res, next) => { log(rq.headers); next(err); };",
                InputUse::Unknown,
            ),
            (
                "const f = (rq, rs, next) => { rs.json(rq.body); next(); };",
                InputUse::Reads,
            ),
        ]);
    }
}
