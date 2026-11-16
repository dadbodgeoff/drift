//! Lowering for message consumers registered by a call of their library: the
//! handler a broker hands each message to, which is code that runs on input from
//! outside the process.
//!
//! Read from each library's documented API only, keyed on the package the call
//! comes from or the file imports:
//!
//! - kombu: `Consumer(channel, queues=[Queue("tasks")], callbacks=[handler])`
//!   (`kombu.Consumer`, `kombu.messaging.Consumer`, or a connection's or channel's
//!   `.Consumer(...)` in a file that imports kombu), each of `callbacks=` and
//!   `on_message=`;
//! - aio_pika: `await queue.consume(handler)` in a file that imports aio_pika,
//!   named by the queue where it is bound in the same function to
//!   `declare_queue("name")` or `get_queue("name")`;
//! - pika: `channel.basic_consume(queue="q", on_message_callback=handler)`;
//! - faust: `@app.agent(topic)` on a function, where `app` is a `faust.App(...)` of
//!   the module, named by the topic where it is `app.topic("name")`.
//!
//! A handler is a function of the repository (by name, through imports), or a
//! method of the class the call is written in (`self.on_message`: the class is
//! the entry point, as the class rule lists one). Anything else (a lambda, a
//! parameter, `functools.partial(...)`) is not listed, and said with its line
//! ([`drift_core::UnlistedReason::HandlerNotRead`]). Each one found is a route of
//! [`RawServers`] of kind `consumer`, which the linker reads into the listed
//! reading only (`link::servers`), so what mining reads is what it was. A poll loop
//! (`confluent_kafka`, `kafka-python`, aio_pika's `queue.iterator()`) hands no
//! handler to the library and is not read.

use drift_core::UnlistedReason;

use super::servers::RawServerRoute;
use super::*;

/// What one call or decorator registers: the handler's reference, the adapter,
/// the queue or topic where it is a literal, and the decorator where it is one.
struct Found {
    target: RawRef,
    adapter: &'static str,
    name: Option<String>,
    decorator: Option<(String, RawRef)>,
}

/// The calls and simple bindings of one function or of the module's own
/// statements, nested blocks included.
#[derive(Default)]
struct Body<'a> {
    calls: Vec<&'a ast::ExprCall>,
    binds: Vec<(&'a str, &'a Expr)>,
}

impl<'a> Visitor<'a> for Body<'a> {
    fn visit_stmt(&mut self, s: &'a Stmt) {
        if let Stmt::Assign(a) = s
            && let [Expr::Name(n)] = a.targets.as_slice()
        {
            self.binds.push((n.id.as_str(), &a.value));
        }
        visitor::walk_stmt(self, s);
    }

    fn visit_expr(&mut self, e: &'a Expr) {
        if let Expr::Call(c) = e {
            self.calls.push(c);
        }
        visitor::walk_expr(self, e);
    }
}

fn unawaited(e: &Expr) -> &Expr {
    match e {
        Expr::Await(a) => &a.value,
        e => e,
    }
}

/// The literal a call names as its first argument, or by keyword `name`.
fn named(c: &ast::ExprCall, name: &str) -> Option<String> {
    arg(c, 0, name).and_then(string_value)
}

impl<'t> Lowerer<'t> {
    fn imports_package(&self, package: &str) -> bool {
        let dotted = format!("{package}.");
        self.out
            .imports
            .iter()
            .any(|i| i.spec == package || i.spec.starts_with(&dotted))
    }

    /// The consumers of the module ([the module docs](self)), as routes of its
    /// [`RawServers`].
    pub(crate) fn lower_consumers(&mut self, body: &'t [Stmt]) {
        let kombu = self.imports_package("kombu");
        let aio_pika = self.imports_package("aio_pika");
        let pika = self.imports_package("pika");
        let faust = self.imports_package("faust");
        if !(kombu || aio_pika || pika || faust) {
            return;
        }
        let libs = Libs {
            kombu,
            aio_pika,
            pika,
        };
        let mut found: Vec<Found> = Vec::new();
        let mut module = Body::default();
        for st in body {
            match st {
                Stmt::FunctionDef(f) => {
                    let mut b = Body::default();
                    b.visit_body(&f.body);
                    self.consumer_calls(&b, None, libs, &mut found);
                }
                Stmt::ClassDef(c) => {
                    for m in &c.body {
                        let Stmt::FunctionDef(f) = m else { continue };
                        let mut b = Body::default();
                        b.visit_body(&f.body);
                        self.consumer_calls(&b, Some(c.name.as_str()), libs, &mut found);
                    }
                }
                st => module.visit_stmt(st),
            }
        }
        self.consumer_calls(&module, None, libs, &mut found);
        if faust {
            self.faust_agents(body, &module, &mut found);
        }
        for f in found {
            self.out.servers.routes.push(RawServerRoute {
                node: None,
                adapter: f.adapter.into(),
                kind: "consumer".into(),
                path: None,
                methods: vec![],
                target: f.target,
                suffix: None,
                name: f.name,
                decorator: f.decorator,
            });
        }
        self.out.servers.routes.sort();
        self.out.servers.routes.dedup();
    }

    /// The handler `h` names: a function by name, or `self.<method>` of `class`.
    /// None, with the line said, for anything else.
    fn consumer_handler(
        &mut self,
        h: &Expr,
        class: Option<&str>,
        at: &ast::ExprCall,
    ) -> Option<RawRef> {
        let r = match h {
            Expr::Attribute(a) => match (a.value.as_ref(), class) {
                (Expr::Name(n), Some(class)) if n.id.as_str() == "self" => Some(RawRef {
                    base: RawBase::Local(class.to_string()),
                    member: String::new(),
                }),
                _ => self.canon(h),
            },
            Expr::Name(_) => self.canon(h),
            _ => None,
        }
        .filter(|r| matches!(r.base, RawBase::Local(_) | RawBase::Import { .. }));
        if r.is_none() {
            self.unlisted(at, UnlistedReason::HandlerNotRead, None);
        }
        r
    }

    fn consumer_calls(
        &mut self,
        b: &Body<'t>,
        class: Option<&str>,
        libs: Libs,
        found: &mut Vec<Found>,
    ) {
        for c in &b.calls {
            let Some((adapter, handlers, name)) = self.consumer_call(c, b, libs) else {
                continue;
            };
            for h in handlers {
                if let Some(target) = self.consumer_handler(h, class, c) {
                    found.push(Found {
                        target,
                        adapter,
                        name: name.clone(),
                        decorator: None,
                    });
                }
            }
        }
    }

    /// What call `c` registers, where it is a consumer of one of `libs`: the
    /// adapter, the handlers it is given and the queue it names.
    fn consumer_call<'c>(
        &self,
        c: &'c ast::ExprCall,
        b: &Body<'t>,
        libs: Libs,
    ) -> Option<(&'static str, Vec<&'c Expr>, Option<String>)> {
        let attr = match c.func.as_ref() {
            Expr::Attribute(a) => Some(a),
            _ => None,
        };
        let method = attr.map(|a| a.attr.as_str());
        let dotted = self.dotted_of(&c.func);
        let kombu_consumer = matches!(
            dotted.as_deref(),
            Some("kombu.Consumer" | "kombu.messaging.Consumer")
        ) || (libs.kombu && method == Some("Consumer") && dotted.is_none());
        if kombu_consumer {
            let mut handlers: Vec<&Expr> = keyword(c, "callbacks")
                .and_then(elements)
                .map(|els| els.iter().collect())
                .unwrap_or_default();
            handlers.extend(keyword(c, "on_message"));
            // `queues=[Queue("tasks", ...)]`: named where it is one queue.
            let queues: Vec<String> = keyword(c, "queues")
                .and_then(elements)
                .unwrap_or_default()
                .iter()
                .filter_map(|q| match q {
                    Expr::Call(q)
                        if matches!(
                            self.dotted_of(&q.func).as_deref(),
                            Some("kombu.Queue" | "kombu.entity.Queue")
                        ) =>
                    {
                        named(q, "name")
                    }
                    _ => None,
                })
                .collect();
            let name = (queues.len() == 1).then(|| queues[0].clone());
            return Some(("kombu", handlers, name));
        }
        let a = attr?;
        match a.attr.as_str() {
            "consume" if libs.aio_pika => {
                let h = arg(c, 0, "callback")?;
                // `queue = await channel.declare_queue("orders")` in the same body.
                let name = match a.value.as_ref() {
                    Expr::Name(n) => b
                        .binds
                        .iter()
                        .rev()
                        .find(|(bound, _)| *bound == n.id.as_str())
                        .and_then(|(_, v)| match unawaited(v) {
                            Expr::Call(d) => match d.func.as_ref() {
                                Expr::Attribute(m)
                                    if matches!(m.attr.as_str(), "declare_queue" | "get_queue") =>
                                {
                                    named(d, "name")
                                }
                                _ => None,
                            },
                            _ => None,
                        }),
                    _ => None,
                };
                Some(("aio_pika", vec![h], name))
            }
            "basic_consume" if libs.pika => {
                let h = arg(c, 1, "on_message_callback")?;
                Some(("pika", vec![h], named(c, "queue")))
            }
            _ => None,
        }
    }

    /// faust's `@app.agent(...)` on the module's functions, where `app` is bound
    /// at the module's level to `faust.App(...)`.
    fn faust_agents(&self, body: &'t [Stmt], module: &Body<'t>, found: &mut Vec<Found>) {
        let bound_to = |name: &str, test: &dyn Fn(&ast::ExprCall) -> bool| {
            module
                .binds
                .iter()
                .any(|(b, v)| *b == name && matches!(v, Expr::Call(c) if test(c)))
        };
        let is_app = |name: &str| {
            bound_to(name, &|c| {
                self.dotted_of(&c.func).as_deref() == Some("faust.App")
            })
        };
        for st in body {
            let Stmt::FunctionDef(f) = st else { continue };
            for d in &f.decorator_list {
                let Expr::Call(c) = &d.expression else {
                    continue;
                };
                let Expr::Attribute(a) = c.func.as_ref() else {
                    continue;
                };
                let Expr::Name(app) = a.value.as_ref() else {
                    continue;
                };
                if a.attr.as_str() != "agent" || !is_app(app.id.as_str()) {
                    continue;
                }
                let Some(deco) = self.canon(&c.func) else {
                    continue;
                };
                // `orders = app.topic("orders")`, given as the agent's channel.
                let name = arg(c, 0, "channel").and_then(|t| match t {
                    Expr::Name(t) => module.binds.iter().find_map(|(b, v)| match v {
                        Expr::Call(tc)
                            if *b == t.id.as_str()
                                && matches!(tc.func.as_ref(), Expr::Attribute(m)
                                    if m.attr.as_str() == "topic"
                                        && matches!(m.value.as_ref(), Expr::Name(x) if x.id == app.id)) =>
                        {
                            tc.arguments.args.first().and_then(string_value)
                        }
                        _ => None,
                    }),
                    _ => None,
                });
                let symbol = f.name.to_string();
                found.push(Found {
                    target: RawRef {
                        base: RawBase::Local(symbol.clone()),
                        member: String::new(),
                    },
                    adapter: "faust",
                    name,
                    decorator: Some((symbol, deco)),
                });
            }
        }
    }
}

/// Which consumer libraries the file imports.
#[derive(Clone, Copy)]
struct Libs {
    kombu: bool,
    aio_pika: bool,
    pika: bool,
}
