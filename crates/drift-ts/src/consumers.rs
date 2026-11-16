//! Message consumers the last measured build did not list (entry kind
//! `consumer`): what a broker hands them comes from outside the process.
//!
//! The measured build lists Bull and Bee-Queue `queue.process(...)` given a
//! function or a reference, kafkajs `consumer.run({ eachMessage })` and amqplib
//! `channel.consume(queue, handler)` ([`EntryFinder::consumer`]). This pass adds,
//! in the listed reading only ([`unmeasured_listing`]), the forms each package
//! documents beside those:
//!
//! - Bull / Bee-Queue `process` given a handler that is a call of a reference
//!   (`this.handle.bind(this)`, `wrap(handler)`), read through the reference;
//! - Bull `process` given a processor file path (`queue.process("./email.js")`),
//!   which runs in a process of its own: not listed, said so with its line
//!   ([`RawFile::unlisted_reasons`], `handler_not_read`);
//! - `sqs-consumer` `Consumer.create({ queueUrl, handleMessage })` (or
//!   `handleMessageBatch`), named by the queue URL where it is a literal;
//! - `nats` `connection.subscribe(subject, { callback })`, named by the subject. A
//!   subscription read with `for await` has no handler to list: it is said, as a
//!   path is.
//!
//! Each keys on the package the file imports and on that package's documented
//! call, never on a name of the repository's. New entries are named after the
//! ones the measured build listed, so no name that build gave changes.

use super::*;

/// The packages whose consumers this pass reads.
const BULL: &[&str] = &["bull", "bee-queue"];
const SQS: &str = "sqs-consumer";
const NATS: &str = "nats";

/// One consumer found: its route (queue, subject), adapter, line and symbol.
type Since = (String, &'static str, u32, RawSymbol);

impl Lowerer<'_> {
    /// The consumers of [the module docs](self) in the file, listed in the listed
    /// reading only.
    pub(in crate::lower) fn lower_consumers_since(&mut self, program: &Program) {
        if self.test_file {
            return;
        }
        let imports = |p: &str| self.out.imports.iter().any(|i| i.spec == p);
        let bull = BULL.iter().any(|p| imports(p));
        let (sqs, nats) = (imports(SQS), imports(NATS));
        if !(bull || sqs || nats) {
            return;
        }
        let mut f = Finder {
            l: self,
            bull,
            nats,
            found: Vec::new(),
            unread: Vec::new(),
            class: None,
        };
        f.visit_program(program);
        let (found, unread) = (f.found, f.unread);
        if (found.is_empty() && unread.is_empty()) || unmeasured_listing() {
            return;
        }
        for (route, adapter, line, mut sym) in found {
            let name = self.unique_route_name("CONSUMER", &route);
            sym.name = name.clone();
            sym.line = line;
            self.push_symbol(sym);
            self.out.entry_points.push(drift_core::EntryPoint {
                symbol: name,
                kind: "consumer".into(),
                method: None,
                route: Some(route),
                adapter: adapter.into(),
            });
        }
        self.out
            .unlisted_reasons
            .extend(unread.into_iter().map(|line| drift_core::UnlistedRoute {
                line,
                reason: drift_core::UnlistedReason::HandlerNotRead,
            }));
        self.out.unlisted_reasons.sort();
        self.out.unlisted_reasons.dedup();
    }
}

/// The package of NestJS's BullMQ module: a `@Processor(queue)` class that extends
/// its `WorkerHost` is handed each job of the queue in `process(job)`.
const NEST_BULLMQ: &str = "@nestjs/bullmq";

impl Lowerer<'_> {
    /// Whether `class` is a `@Processor` of `@nestjs/bullmq` extending its
    /// `WorkerHost`: its `process` method is a `job` entry point
    /// ([`worker_process`]).
    pub(super) fn bullmq_worker_host(&self, class: &Class) -> bool {
        let of = |r: Option<RawRef>, export: &str| {
            r.is_some_and(|r| {
                r.member.is_empty()
                    && matches!(&r.base, RawBase::Import { spec, name } if spec == NEST_BULLMQ && name == export)
            })
        };
        of(
            class
                .heritage
                .as_ref()
                .and_then(|h| self.canon(&h.expression)),
            "WorkerHost",
        ) && class
            .decorators
            .iter()
            .any(|d| of(self.decorator_ref(d), "Processor"))
    }
}

/// Whether `m` is the `process` method of a `WorkerHost` class
/// ([`Lowerer::bullmq_worker_host`]), noted as a listing made since the last
/// measured build: false when lowering as that build did.
pub(super) fn worker_process(m: &MethodDefinition) -> bool {
    m.kind == MethodDefinitionKind::Method
        && !m.r#static
        && m.key
            .static_name()
            .is_some_and(|k| k.as_str() == Some("process"))
        && !unmeasured_listing()
}

struct Finder<'l, 's> {
    l: &'l Lowerer<'s>,
    bull: bool,
    nats: bool,
    found: Vec<Since>,
    /// Lines of consumers whose handler is not read.
    unread: Vec<u32>,
    /// The class whose body is being walked: `this.handle` there is its method.
    class: Option<String>,
}

/// `handle` of `this.handle` or of `this.handle.bind(this)`.
fn this_method<'b>(h: &'b Expression) -> Option<&'b str> {
    let m = match unwrap_expr(h) {
        Expression::CallExpression(c) => match unwrap_expr(&c.callee) {
            Expression::StaticMemberExpression(b) if b.property.name == "bind" => {
                match unwrap_expr(&b.object) {
                    Expression::StaticMemberExpression(m) => m,
                    _ => return None,
                }
            }
            _ => return None,
        },
        Expression::StaticMemberExpression(m) => m,
        _ => return None,
    };
    matches!(unwrap_expr(&m.object), Expression::ThisExpression(_))
        .then(|| m.property.name.as_str())
}

/// The name a call's receiver is bound to, as the measured build names a Bull
/// consumer with no job name: `emails` of `emails.process(...)`, `q` of
/// `this.q.process(...)`. None for Node's `process`.
fn receiver_name(object: &Expression) -> Option<String> {
    match unwrap_expr(object) {
        Expression::Identifier(id) if id.name != "process" => Some(id.name.to_string()),
        Expression::StaticMemberExpression(o) => Some(o.property.name.to_string()),
        _ => None,
    }
}

impl Finder<'_, '_> {
    /// A consumer whose handler is `h`: listed where `h` is a function written in
    /// place, a reference or a call of one (read through it); said, not listed,
    /// where it is anything else (`handlers[kind]`, a conditional).
    fn push(&mut self, route: String, adapter: &'static str, line: u32, h: &Expression) {
        let read = matches!(
            unwrap_expr(h),
            Expression::ArrowFunctionExpression(_)
                | Expression::FunctionExpression(_)
                | Expression::Identifier(_)
                | Expression::StaticMemberExpression(_)
                | Expression::CallExpression(_)
        );
        if !read {
            self.unread.push(line);
            return;
        }
        let mut sym = RawSymbol::empty("", SymbolKind::Function, line);
        self.l.handler_facts(Some(h), &mut sym);
        // A method of the class the call is written in, as a sibling call is read
        // (`Local(Mailer).handle`).
        if let (Some(class), Some(method)) = (&self.class, this_method(h)) {
            let r = RawRef {
                base: RawBase::Local(class.clone()),
                member: format!(".{method}(ref)"),
            };
            if !sym.calls.contains(&r) {
                sym.calls.push(r);
            }
        }
        self.found.push((route, adapter, line, sym));
    }

    /// Bull / Bee-Queue `queue.process([name,] [concurrency,] handler)`: a handler
    /// that is a call (the measured build lists a function or a reference), or a
    /// processor file path.
    fn bull(&mut self, m: &StaticMemberExpression, exprs: &[&Expression], line: u32) {
        let Some(receiver) = receiver_name(&m.object) else {
            return;
        };
        let Some(last) = exprs.last() else { return };
        match unwrap_expr(last) {
            // `this.handle.bind(this)`, `wrap(handler)`: read through what it binds
            // or wraps ([`Lowerer::handler_facts`]).
            Expression::CallExpression(_) => {
                let named = (exprs.len() > 1).then(|| string_value(exprs[0])).flatten();
                self.push(named.unwrap_or(receiver), "bull", line, last);
            }
            // A sandboxed processor: its own file, run in a child process.
            e if string_value(e).is_some() => self.unread.push(line),
            _ => {}
        }
    }

    /// `Consumer.create({ queueUrl, handleMessage })` of `sqs-consumer`.
    fn sqs(&mut self, it: &CallExpression, exprs: &[&Expression], line: u32) {
        let Some(r) = self.l.canon_callee(&it.callee) else {
            return;
        };
        let RawBase::Import { spec, name } = &r.base else {
            return;
        };
        if spec != SQS || name != "Consumer" || r.member != ".create" {
            return;
        }
        let Some(Expression::ObjectExpression(o)) = exprs.first().map(|x| unwrap_expr(x)) else {
            return;
        };
        let route = object_prop(o, "queueUrl")
            .and_then(string_value)
            .unwrap_or_else(|| "?".into());
        match object_prop(o, "handleMessage").or_else(|| object_prop(o, "handleMessageBatch")) {
            Some(h) => self.push(route, "sqs-consumer", line, h),
            None => self.unread.push(line),
        }
    }

    /// `nc.subscribe(subject, { callback })` of `nats`: a subject given as a string
    /// or a binding, and options that are none or an object written in place.
    fn nats(&mut self, exprs: &[&Expression], line: u32) {
        let Some(subject) = exprs.first().map(|x| unwrap_expr(x)) else {
            return;
        };
        if matches!(subject, Expression::ObjectExpression(_)) || exprs.len() > 2 {
            return;
        }
        let route = string_value(subject).unwrap_or_else(|| "?".into());
        match exprs.get(1).map(|x| unwrap_expr(x)) {
            Some(Expression::ObjectExpression(o)) => match object_prop(o, "callback") {
                Some(h) => self.push(route, "nats", line, h),
                None => self.unread.push(line),
            },
            None => self.unread.push(line),
            Some(_) => {}
        }
    }
}

impl<'a> Visit<'a> for Finder<'_, '_> {
    fn visit_class(&mut self, it: &Class<'a>) {
        let name = it.id.as_ref().map(|i| i.name.to_string());
        let outer = std::mem::replace(&mut self.class, name);
        walk::walk_class(self, it);
        self.class = outer;
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        let line = self.l.line_of(it.span.start);
        let exprs = arg_exprs(&it.arguments);
        if let Expression::StaticMemberExpression(m) = unwrap_expr(&it.callee) {
            match m.property.name.as_str() {
                "process" if self.bull => self.bull(m, &exprs, line),
                "subscribe" if self.nats => self.nats(&exprs, line),
                "create" => self.sqs(it, &exprs, line),
                _ => {}
            }
        }
        walk::walk_call_expression(self, it);
    }
}
