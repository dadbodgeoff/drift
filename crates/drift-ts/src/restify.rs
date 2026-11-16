//! Restify 7 and later: `restify.createServer()`, its routes
//! (`server.get/post/put/patch/del/head/opts(path | { path, version }, ...handlers)`),
//! and what `server.pre(...)` and `server.use(...)` add, which Restify runs for every
//! route of the server, before its own handlers, wherever they are added. A
//! `server.param(name, fn)` is a `use` handler that runs `fn` for the routes whose
//! path has the parameter `name`. Checked against the published `restify` 12.1.0
//! (`lib/server.js`: there is no `server.delete`, only `del`).
//!
//! The plugins Restify ships (`restify.plugins.bodyParser()`, `queryParser()`, ...,
//! and the `restify.pre` / `restify.plugins.pre` ones) parse, log, throttle or serve
//! files, and turn no one away for who they are: they are nothing.
//! `conditionalHandler` runs the handlers it is given, and is unread.

use super::*;

pub(super) const PACKAGE: &str = "restify";

const VERBS: &[(&str, &str)] = &[
    ("get", "GET"),
    ("post", "POST"),
    ("put", "PUT"),
    ("patch", "PATCH"),
    ("del", "DELETE"),
    ("head", "HEAD"),
    ("opts", "OPTIONS"),
];

struct RestifyWalk<'l, 's> {
    l: &'l mut Lowerer<'s>,
    servers: BTreeSet<String>,
    /// What `pre` and `use` add on each server, gathered first.
    before: BTreeMap<String, Before>,
    /// What `param(name, fn)` adds on each server, by the parameter, gathered first.
    params: BTreeMap<String, Vec<(String, Before)>>,
    collecting: bool,
    listed: Vec<u32>,
}

impl Lowerer<'_> {
    pub(super) fn lower_restify(
        &mut self,
        program: &Program,
        listed: &mut Vec<u32>,
        unlisted: &mut Vec<u32>,
    ) {
        let _ = unlisted;
        let mut before = BTreeMap::new();
        let mut params = BTreeMap::new();
        for collecting in [true, false] {
            let mut w = RestifyWalk {
                l: self,
                servers: BTreeSet::new(),
                before,
                params,
                collecting,
                listed: Vec::new(),
            };
            w.visit_program(program);
            before = w.before;
            params = w.params;
            listed.extend(w.listed);
        }
    }

    /// `restify.createServer(...)`, or `createServer(...)` imported by name.
    fn restify_server(&self, e: &Expression) -> bool {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return false;
        };
        self.canon(&c.callee).is_some_and(|r| match &r.base {
            RawBase::Import { spec, name } if spec == PACKAGE => matches!(
                (name.as_str(), r.member.as_str()),
                ("default" | "*", ".createServer") | ("createServer", "")
            ),
            _ => false,
        })
    }

    /// A plugin Restify ships, called: `restify.plugins.bodyParser()`,
    /// `plugins.queryParser()` (`const { plugins } = require("restify")`). Some
    /// where it refuses no one, none for one that is not such a plugin.
    fn restify_plugin(&self, e: &Expression) -> Option<bool> {
        let Expression::CallExpression(c) = unwrap_expr(e) else {
            return None;
        };
        let r = self.canon(&c.callee)?;
        let RawBase::Import { spec, name } = &r.base else {
            return None;
        };
        if spec != PACKAGE {
            return None;
        }
        let plugin = match name.as_str() {
            "default" | "*" => r
                .member
                .strip_prefix(".plugins.")
                .or_else(|| r.member.strip_prefix(".pre."))?,
            "plugins" | "pre" => r.member.strip_prefix('.')?,
            _ => return None,
        };
        Some(plugin != "conditionalHandler")
    }
}

impl RestifyWalk<'_, '_> {
    fn server_of(&self, e: &Expression) -> Option<String> {
        match unwrap_expr(e) {
            Expression::Identifier(id) if self.servers.contains(id.name.as_str()) => {
                Some(id.name.to_string())
            }
            _ => None,
        }
    }

    /// Handlers as Restify takes them: each argument, and each element of an array.
    fn handlers<'b, 'a>(args: &[&'b Expression<'a>]) -> Vec<&'b Expression<'a>> {
        let mut out = Vec::new();
        for x in args {
            match unwrap_expr(x) {
                Expression::ArrayExpression(a) => {
                    out.extend(a.elements.iter().filter_map(|el| match el {
                        ArrayExpressionElement::SpreadElement(s) => Some(&s.argument),
                        other => other.as_expression(),
                    }));
                }
                _ => out.push(*x),
            }
        }
        out
    }

    fn note_use(&mut self, server: &str, args: &[&Expression]) {
        let mut b = self.before.remove(server).unwrap_or_default();
        for h in Self::handlers(args) {
            match self.l.restify_plugin(h) {
                Some(true) => {}
                _ => self.l.before_of(server, "use", h, &mut b),
            }
        }
        self.before.insert(server.to_string(), b);
    }

    /// `server.param(name, fn)`: `fn` runs before the routes with the parameter
    /// `name`. A name that is not written out is read for every route.
    fn note_param(&mut self, server: &str, args: &[&Expression]) {
        let Some(f) = args.get(1) else { return };
        let name = args.first().and_then(|x| text_of(x)).unwrap_or_default();
        let mut b = Before::default();
        self.l.before_of(server, "param", f, &mut b);
        self.params
            .entry(server.to_string())
            .or_default()
            .push((name, b));
    }

    fn route(&mut self, server: &str, method: &str, c: &CallExpression, line: u32) {
        let args = arg_exprs(&c.arguments);
        let Some((first, rest)) = args.split_first() else {
            return;
        };
        let path = match unwrap_expr(first) {
            Expression::ObjectExpression(o) => object_prop(o, "path").and_then(route_text),
            x => route_text(x),
        }
        .unwrap_or_else(|| "?".to_string());
        let mut before = self.before.get(server).cloned().unwrap_or_default();
        for (name, b) in self.params.get(server).into_iter().flatten() {
            let has = |seg: &str| {
                seg.strip_prefix(':').is_some_and(|p| {
                    p == name
                        || p.strip_prefix(name.as_str())
                            .is_some_and(|r| r.starts_with('('))
                })
            };
            if name.is_empty() || path == "?" || path.split('/').any(has) {
                before.add(b);
            }
        }
        for a in &c.arguments {
            if let Argument::SpreadElement(s) = a {
                before.unread(format!("handlers spread from {}", spread_name(&s.argument)));
            }
        }
        let mut handlers = Self::handlers(rest);
        let handler = handlers.pop();
        for h in handlers {
            self.l.before_of(server, "before", h, &mut before);
        }
        self.l.server_route(
            ServerRoute {
                adapter: "restify",
                router: Some(server.to_string()),
                method: method.to_string(),
                path: join_path(&[&path]),
                line,
                before,
                handler,
                schemas: Vec::new(),
            },
            &mut self.listed,
        );
    }
}

impl<'a> Visit<'a> for RestifyWalk<'_, '_> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init)
            && self.l.restify_server(init)
        {
            self.servers.insert(id.name.to_string());
            let top = id.symbol_id.get().is_some_and(|s| {
                self.l.scoping.symbol_scope_id(s) == self.l.scoping.root_scope_id()
            });
            if top && !self.collecting {
                self.l.server_router(id.name.as_str());
            }
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee)
            && let Some(server) = self.server_of(&m.object)
        {
            let name = m.property.name.as_str();
            if self.collecting {
                if matches!(name, "use" | "pre") {
                    let args = arg_exprs(&it.arguments);
                    self.note_use(&server, &args);
                } else if name == "param" {
                    let args = arg_exprs(&it.arguments);
                    self.note_param(&server, &args);
                }
            } else if let Some((_, method)) = VERBS.iter().find(|(v, _)| *v == name) {
                let line = self.l.line_of(m.property.span.start);
                self.route(&server, method, it, line);
            }
        }
        walk::walk_call_expression(self, it);
    }
}
