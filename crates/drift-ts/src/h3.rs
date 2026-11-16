//! h3 1.x on its own (Nuxt's and Nitro's file routes are read by
//! [`crate::filerouters`]): `createApp()`, `createRouter()`, the routes of a router
//! (`router.get/post/put/patch/delete/head/options(path, handler)`, `router.use` and
//! `router.add(path, handler[, method])`), and what `app.use([path,] handler)`
//! adds: a router (`router` or `router.handler`), mounted under the path, or an
//! event handler, which runs before what the application serves after it, for the
//! paths it is given.
//!
//! A handler written `defineEventHandler({ onRequest, handler })` runs its
//! `onRequest` hooks before the handler. An event handler given to `app.use` that
//! hands back nothing lets the request go on, and one that throws
//! (`createError({ statusCode: 401 })`) or answers turns it away: what it does is
//! read as any middleware is. `createApp({ onRequest })` runs for every request.

use super::*;

pub(super) const PACKAGE: &str = "h3";

const VERBS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "head", "options", "connect", "trace",
];

#[derive(Default)]
struct State {
    /// The applications of the module, with what each was given for a path (`""`:
    /// every path) so far.
    apps: BTreeMap<String, Vec<(String, Before)>>,
    routers: BTreeSet<String>,
    /// The calls that make a binding's router or application with registrations
    /// chained on them (`const api = createRouter().get(...)`), by where they start.
    chained: BTreeMap<u32, String>,
}

impl Lowerer<'_> {
    pub(super) fn lower_h3(
        &mut self,
        program: &Program,
        listed: &mut Vec<u32>,
        unlisted: &mut Vec<u32>,
    ) {
        let _ = unlisted;
        let mut w = H3Walk {
            l: self,
            st: State::default(),
            listed: Vec::new(),
        };
        w.visit_program(program);
        listed.extend(w.listed);
    }

    /// The export of h3 a call is of (`createApp`, `defineEventHandler`).
    fn h3_call<'b, 'a>(&self, e: &'b Expression<'a>) -> Option<(String, &'b CallExpression<'a>)> {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        let r = self.canon(&c.callee)?;
        match &r.base {
            RawBase::Import { spec, name } if spec == PACKAGE => {
                match (name.as_str(), r.member.as_str()) {
                    ("default" | "*", m) if m.starts_with('.') => Some((m[1..].to_string(), c)),
                    (n, "") => Some((n.to_string(), c)),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// An event handler: what its `onRequest` hooks run before it, and the function
    /// that answers.
    fn h3_handler<'b, 'a>(
        &mut self,
        router: &str,
        e: &'b Expression<'a>,
        before: &mut Before,
    ) -> Option<&'b Expression<'a>> {
        let Some((name, c)) = self.h3_call(e) else {
            return Some(e);
        };
        if !matches!(name.as_str(), "defineEventHandler" | "eventHandler") {
            return Some(e);
        }
        let inner = c.arguments.first().and_then(|a| a.as_expression())?;
        match unwrap_expr(inner) {
            Expression::ObjectExpression(o) => {
                if let Some(h) = object_prop(o, "onRequest") {
                    self.before_of(router, "onRequest", h, before);
                }
                object_prop(o, "handler")
            }
            _ => Some(inner),
        }
    }
}

struct H3Walk<'l, 's> {
    l: &'l mut Lowerer<'s>,
    st: State,
    listed: Vec<u32>,
}

impl H3Walk<'_, '_> {
    fn binding(&self, e: &Expression) -> Option<(String, bool)> {
        match unwrap_expr(e) {
            Expression::Identifier(id) if self.st.apps.contains_key(id.name.as_str()) => {
                Some((id.name.to_string(), true))
            }
            Expression::Identifier(id) if self.st.routers.contains(id.name.as_str()) => {
                Some((id.name.to_string(), false))
            }
            // A registration hands back what it registers on.
            Expression::CallExpression(c) => match self.st.chained.get(&c.span.start) {
                Some(name) if c.span.start == chain_start(e) => self.binding_named(name),
                _ => match unwrap_expr(&c.callee) {
                    Expression::StaticMemberExpression(m) => self.binding(&m.object),
                    _ => None,
                },
            },
            _ => None,
        }
    }

    fn binding_named(&self, name: &str) -> Option<(String, bool)> {
        if self.st.apps.contains_key(name) {
            Some((name.to_string(), true))
        } else {
            self.st
                .routers
                .contains(name)
                .then(|| (name.to_string(), false))
        }
    }

    fn route(
        &mut self,
        router: &str,
        method: String,
        path: Option<&Expression>,
        handler: Option<&Expression>,
        line: u32,
    ) {
        let path = path.and_then(route_text).unwrap_or_else(|| "?".to_string());
        let mut before = Before::default();
        let handler = match handler {
            Some(h) => self.l.h3_handler(router, h, &mut before),
            None => None,
        };
        self.l.server_route(
            ServerRoute {
                adapter: "h3",
                router: Some(router.to_string()),
                method,
                path: join_path(&[&path]),
                line,
                before,
                handler,
                schemas: Vec::new(),
            },
            &mut self.listed,
        );
    }

    /// `app.use([path,] handler[, options])`.
    fn app_use(&mut self, app: &str, args: &[&Expression]) {
        let (pattern, handler) = match args {
            [p, h, ..] if route_text(p).is_some() => (route_text(p).unwrap_or_default(), *h),
            [h, ..] => (String::new(), *h),
            [] => return,
        };
        // What the application was given so far, for a path that takes the mount.
        let mut before = Before::default();
        for (p, b) in self.st.apps.get(app).into_iter().flatten() {
            match covers_mount(p, &pattern) {
                Some(true) => before.add(b),
                None => before.unread(format!(
                    "a middleware given for {p}, which may cover the route"
                )),
                Some(false) => {}
            }
        }
        // A router: `router`, `router.handler`.
        let router = match unwrap_expr(handler) {
            Expression::StaticMemberExpression(m) if m.property.name == "handler" => {
                Some(&m.object)
            }
            _ => None,
        };
        if let Some((name, false)) = router
            .and_then(|r| self.binding(r))
            .or_else(|| self.binding(handler))
        {
            let target = RawRef {
                base: RawBase::Local(name),
                member: String::new(),
            };
            self.l.server_mount(app, &pattern, target, &before);
            return;
        }
        if let Some(r) = router
            .and_then(|r| self.l.canon(r))
            .filter(|r| !matches!(r.base, RawBase::Global(_)))
        {
            self.l.server_mount(app, &pattern, r, &before);
            return;
        }
        // An event handler: it runs before what the application serves after it.
        let mut b = Before::default();
        match self.l.h3_handler(app, handler, &mut b) {
            Some(f) => self.l.before_of(app, "use", f, &mut b),
            None => b.unread("an event handler that is not read"),
        }
        if let Some(list) = self.st.apps.get_mut(app) {
            list.push((pattern, b));
        }
    }
}

impl<'a> Visit<'a> for H3Walk<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && let Some((name, c)) = self.l.h3_call(chain_root(init))
        {
            let binding = id.name.to_string();
            self.st.chained.insert(c.span.start, binding.clone());
            match name.as_str() {
                "createApp" => {
                    let mut hooks = Vec::new();
                    if let Some(Expression::ObjectExpression(o)) = c
                        .arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .map(unwrap_expr)
                        && let Some(h) = object_prop(o, "onRequest")
                    {
                        let mut b = Before::default();
                        self.l.before_of(&binding, "onRequest", h, &mut b);
                        hooks.push((String::new(), b));
                    }
                    self.st.apps.insert(binding.clone(), hooks);
                    self.l.server_router(&binding);
                }
                "createRouter" => {
                    self.st.routers.insert(binding.clone());
                    self.l.server_router(&binding);
                }
                _ => {}
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && let Some((name, is_app)) = self.binding(&m.object)
        {
            let args = arg_exprs(&it.arguments);
            let line = self.l.line_of(m.property.span.start);
            let method = m.property.name.as_str();
            match (is_app, method) {
                (true, "use") => self.app_use(&name, &args),
                (false, v) if VERBS.contains(&v) => {
                    self.route(
                        &name,
                        v.to_ascii_uppercase(),
                        args.first().copied(),
                        args.get(1).copied(),
                        line,
                    );
                }
                (false, "use" | "add") => {
                    let methods: Vec<String> = match args.get(2).map(|x| unwrap_expr(x)) {
                        None => vec!["ALL".to_string()],
                        Some(Expression::ArrayExpression(a)) => a
                            .elements
                            .iter()
                            .map(|el| {
                                el.as_expression()
                                    .and_then(text_of)
                                    .map_or_else(|| "?".to_string(), |t| t.to_ascii_uppercase())
                            })
                            .collect(),
                        Some(x) => vec![
                            text_of(x).map_or_else(|| "?".to_string(), |t| t.to_ascii_uppercase()),
                        ],
                    };
                    for mth in methods {
                        self.route(
                            &name,
                            mth,
                            args.first().copied(),
                            args.get(1).copied(),
                            line,
                        );
                    }
                }
                _ => {}
            }
        }
        walk::walk_call_expression(self, it);
    }
}

/// The call a registration chain starts from (`createRouter()` in
/// `createRouter().get(...).post(...)`), or the expression itself.
fn chain_root<'b, 'a>(e: &'b Expression<'a>) -> &'b Expression<'a> {
    let mut cur = unwrap_expr(e);
    while let Expression::CallExpression(c) = cur
        && let Expression::StaticMemberExpression(m) = unwrap_expr(&c.callee)
        && matches!(unwrap_expr(&m.object), Expression::CallExpression(_))
    {
        cur = unwrap_expr(&m.object);
    }
    cur
}

fn chain_start(e: &Expression) -> u32 {
    chain_root(e).span().start
}
