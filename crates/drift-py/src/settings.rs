//! Django settings and Celery beat schedules at lowering time.
//!
//! Every module's settings-shaped assignments are recorded (`ROOT_URLCONF`,
//! `MIDDLEWARE`, `REST_FRAMEWORK`, beat schedules); which modules really are the
//! settings is decided by the linker, from `DJANGO_SETTINGS_MODULE` or file names.
//! Only literals are read: a value computed at runtime is not a setting Drift knows.

use super::adapters::CallFinder;
use super::*;

const MIDDLEWARE: &str = "MIDDLEWARE";
const REST_FRAMEWORK: &str = "REST_FRAMEWORK";
/// Names a beat schedule is assigned to: Django settings (`namespace="CELERY"`), the old
/// upper-case setting, and a Celery config module.
const BEAT_SCHEDULES: &[&str] = &[
    "CELERY_BEAT_SCHEDULE",
    "CELERYBEAT_SCHEDULE",
    "beat_schedule",
];
/// Statement nesting followed into `if`/`try`/`with` blocks.
const MAX_DEPTH: usize = 8;

/// String literals of a list or tuple, also through `[...] + NAME` and `[*NAME, ...]`.
fn strings_in(e: &Expr, out: &mut Vec<String>, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    match e {
        Expr::BinOp(b) if matches!(b.op, ast::Operator::Add) => {
            strings_in(&b.left, out, depth + 1);
            strings_in(&b.right, out, depth + 1);
        }
        e => {
            for x in elements(e).unwrap_or_default() {
                if let Some(s) = string_value(x) {
                    out.push(s);
                }
            }
        }
    }
}

/// True when `e` reads the name `name` (`[*MIDDLEWARE, ...]`, `{**REST_FRAMEWORK}`).
fn mentions(e: &Expr, name: &str) -> bool {
    struct Find<'n> {
        name: &'n str,
        found: bool,
    }
    impl<'a> Visitor<'a> for Find<'_> {
        fn visit_expr(&mut self, e: &'a Expr) {
            if matches!(e, Expr::Name(n) if n.id.as_str() == self.name) {
                self.found = true;
            }
            visitor::walk_expr(self, e);
        }
    }
    let mut f = Find { name, found: false };
    f.visit_expr(e);
    f.found
}

/// `{"KEY": value}` or `dict(KEY=value)`: (key, value) pairs with literal keys.
fn dict_items(e: &Expr) -> Vec<(String, &Expr)> {
    match e {
        Expr::Dict(d) => d
            .items
            .iter()
            .filter_map(|i| Some((i.key.as_ref().and_then(string_value)?, &i.value)))
            .collect(),
        Expr::Call(c) if matches!(c.func.as_ref(), Expr::Name(n) if n.id.as_str() == "dict") => c
            .arguments
            .keywords
            .iter()
            .filter_map(|k| Some((k.arg.as_ref()?.as_str().to_string(), &k.value)))
            .collect(),
        _ => vec![],
    }
}

fn is_beat_receiver(e: &Expr) -> bool {
    match e {
        Expr::Name(n) => BEAT_SCHEDULES.contains(&n.id.as_str()),
        // `app.conf.beat_schedule`
        Expr::Attribute(a) => a.attr.as_str() == "beat_schedule",
        _ => false,
    }
}

impl<'t> Lowerer<'t> {
    pub(crate) fn lower_settings(&mut self, body: &'t [Stmt]) {
        for stmt in body {
            self.settings_stmt(stmt, 0);
        }
        let mut f = CallFinder::default();
        for s in body {
            f.visit_stmt(s);
        }
        for &(c, _) in &f.calls {
            self.settings_call(c);
            // `app.dependency_overrides.update({get_user: ...})`, `.setdefault(...)`.
            if let Expr::Attribute(m) = c.func.as_ref()
                && matches!(m.attr.as_str(), "update" | "setdefault")
                && matches!(m.value.as_ref(), Expr::Attribute(o) if o.attr.as_str() == "dependency_overrides")
            {
                match (m.attr.as_str(), c.arguments.args.first()) {
                    ("update", Some(Expr::Dict(d))) if c.arguments.keywords.is_empty() => {
                        for i in &d.items {
                            let key = i.key.as_ref().and_then(|k| self.canon(k));
                            self.out.dependency_overrides.push(key);
                        }
                    }
                    ("setdefault", Some(k)) => {
                        let key = self.canon(k);
                        self.out.dependency_overrides.push(key);
                    }
                    _ => self.out.dependency_overrides.push(None),
                }
            }
        }
        for a in &f.assigns {
            // `app.dependency_overrides[get_user] = ...`
            for t in &a.targets {
                if let Expr::Subscript(x) = t
                    && matches!(x.value.as_ref(), Expr::Attribute(o) if o.attr.as_str() == "dependency_overrides")
                {
                    let key = self.canon(&x.slice);
                    self.out.dependency_overrides.push(key);
                }
            }
        }
        for a in &f.assigns {
            let Some(v) = string_value(&a.value) else {
                continue;
            };
            for t in &a.targets {
                match t {
                    // `request.urlconf = "proj.alt_urls"` (a per-request URLconf)
                    Expr::Attribute(x) if x.attr.as_str() == "urlconf" => {
                        self.out.request_urlconfs.push(v.clone());
                    }
                    // `os.environ["DJANGO_SETTINGS_MODULE"] = "proj.settings"`
                    Expr::Subscript(x)
                        if string_value(&x.slice).as_deref() == Some("DJANGO_SETTINGS_MODULE")
                            && self.canon(&x.value).as_ref().and_then(dotted).as_deref()
                                == Some("os.environ")
                            && self.out.settings.settings_module.is_none() =>
                    {
                        self.out.settings.settings_module = Some(v.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    fn settings_stmt(&mut self, stmt: &'t Stmt, depth: usize) {
        if depth > MAX_DEPTH {
            return;
        }
        match stmt {
            Stmt::Assign(a) => {
                for t in &a.targets {
                    self.settings_assign(t, &a.value);
                }
            }
            Stmt::AnnAssign(a) => {
                if let Some(v) = &a.value {
                    self.settings_assign(&a.target, v);
                }
            }
            Stmt::AugAssign(a) => match a.target.as_ref() {
                Expr::Name(n) if n.id.as_str() == MIDDLEWARE => {
                    let mut items = Vec::new();
                    strings_in(&a.value, &mut items, 0);
                    self.middleware_add(items);
                }
                t if is_beat_receiver(t) => self.beat_dict(&a.value),
                _ => {}
            },
            Stmt::Expr(e) => {
                let Expr::Call(c) = e.value.as_ref() else {
                    return;
                };
                let Expr::Attribute(a) = c.func.as_ref() else {
                    return;
                };
                let attr = a.attr.as_str();
                match a.value.as_ref() {
                    Expr::Name(n) if n.id.as_str() == MIDDLEWARE => {
                        let mut items = Vec::new();
                        match attr {
                            "append" | "insert" => {
                                let at = usize::from(attr == "insert");
                                items.extend(c.arguments.args.get(at).and_then(string_value));
                            }
                            "extend" => {
                                if let Some(x) = c.arguments.args.first() {
                                    strings_in(x, &mut items, 0);
                                }
                            }
                            _ => return,
                        }
                        self.middleware_add(items);
                    }
                    Expr::Name(n) if n.id.as_str() == REST_FRAMEWORK && attr == "update" => {
                        if let Some(x) = c.arguments.args.first() {
                            self.drf_update(x, true);
                        }
                    }
                    r if is_beat_receiver(r) && attr == "update" => {
                        if let Some(x) = c.arguments.args.first() {
                            self.beat_dict(x);
                        }
                    }
                    // `app.conf.update(beat_schedule={...})`
                    Expr::Attribute(conf) if conf.attr.as_str() == "conf" && attr == "update" => {
                        for k in &c.arguments.keywords {
                            if k.arg
                                .as_ref()
                                .is_some_and(|n| BEAT_SCHEDULES.contains(&n.as_str()))
                            {
                                self.beat_dict(&k.value);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Stmt::If(i) => {
                for s in &i.body {
                    self.settings_stmt(s, depth + 1);
                }
                for c in &i.elif_else_clauses {
                    for s in &c.body {
                        self.settings_stmt(s, depth + 1);
                    }
                }
            }
            Stmt::Try(t) => {
                let handlers = t.handlers.iter().flat_map(|h| {
                    let ast::ExceptHandler::ExceptHandler(h) = h;
                    &h.body
                });
                for s in t
                    .body
                    .iter()
                    .chain(handlers)
                    .chain(&t.orelse)
                    .chain(&t.finalbody)
                {
                    self.settings_stmt(s, depth + 1);
                }
            }
            Stmt::With(w) => {
                for s in &w.body {
                    self.settings_stmt(s, depth + 1);
                }
            }
            _ => {}
        }
    }

    fn settings_assign(&mut self, target: &'t Expr, value: &'t Expr) {
        match target {
            Expr::Name(n) => match n.id.as_str() {
                k if k.ends_with("URLCONF") || k.ends_with("HOSTCONF") => {
                    let urlconfs = &mut self.out.settings.urlconfs;
                    urlconfs.retain(|(x, _)| x != k);
                    if let Some(s) = string_value(value) {
                        urlconfs.push((k.to_string(), s));
                    }
                }
                REST_FRAMEWORK => {
                    // `REST_FRAMEWORK = {**REST_FRAMEWORK, ...}` updates; any other value
                    // rebinds, and the keys it leaves out are DRF's defaults.
                    let extends = mentions(value, REST_FRAMEWORK);
                    if !extends {
                        self.out.settings.drf = Some(RawDrf::default());
                    }
                    self.drf_update(value, extends);
                }
                MIDDLEWARE => {
                    let mut items = Vec::new();
                    strings_in(value, &mut items, 0);
                    if mentions(value, MIDDLEWARE) {
                        self.middleware_add(items);
                    } else {
                        self.out.settings.middleware = Some(RawList {
                            extends: false,
                            items,
                        });
                    }
                }
                b if BEAT_SCHEDULES.contains(&b) => self.beat_dict(value),
                _ => {}
            },
            Expr::Attribute(a) if a.attr.as_str() == "beat_schedule" => self.beat_dict(value),
            Expr::Subscript(s) => {
                let Some(key) = string_value(&s.slice) else {
                    return;
                };
                match s.value.as_ref() {
                    Expr::Name(n) if n.id.as_str() == REST_FRAMEWORK => {
                        self.drf_state(true);
                        self.drf_key(&key, value);
                    }
                    r if is_beat_receiver(r) => self.beat_entry(Some(key), value),
                    _ => {}
                }
            }
            _ => {}
        }
    }

    /// Additions to `MIDDLEWARE` (`+=`, `.append`, `[*MIDDLEWARE, ...]`).
    fn middleware_add(&mut self, items: Vec<String>) {
        let list = self.out.settings.middleware.get_or_insert(RawList {
            extends: true,
            items: vec![],
        });
        list.items.extend(items);
    }

    fn drf_state(&mut self, extends: bool) -> &mut RawDrf {
        self.out.settings.drf.get_or_insert(RawDrf {
            extends,
            ..Default::default()
        })
    }

    /// The keys a dict literal sets in `REST_FRAMEWORK`.
    fn drf_update(&mut self, value: &Expr, extends: bool) {
        self.drf_state(extends);
        for (k, v) in dict_items(value) {
            self.drf_key(&k, v);
        }
    }

    fn drf_key(&mut self, key: &str, value: &Expr) {
        let drf = self.drf_state(true);
        if key == "EXCEPTION_HANDLER" {
            drf.exception_handler = string_value(value);
            return;
        }
        let slot = match key {
            "DEFAULT_PERMISSION_CLASSES" => &mut drf.permissions,
            "DEFAULT_AUTHENTICATION_CLASSES" => &mut drf.authentication,
            _ => return,
        };
        // A value that is not a literal list names classes Drift cannot know: none.
        let mut out = Vec::new();
        strings_in(value, &mut out, 0);
        *slot = Some(out);
    }

    fn beat_dict(&mut self, value: &Expr) {
        for (k, v) in dict_items(value) {
            self.beat_entry(Some(k), v);
        }
    }

    /// One beat entry: `{"task": "proj.tasks.cleanup", "schedule": crontab(...)}`.
    fn beat_entry(&mut self, name: Option<String>, value: &Expr) {
        if let Some(task) = dict_items(value)
            .into_iter()
            .find(|(k, _)| k == "task")
            .and_then(|(_, v)| string_value(v))
        {
            self.out.beats.push(RawBeat {
                name,
                task: RawBeatTask::Name(task),
            });
        }
    }

    /// Calls anywhere: `os.environ.setdefault("DJANGO_SETTINGS_MODULE", "x")` and
    /// `sender.add_periodic_task(crontab(...), cleanup.s(), name="...")`.
    fn settings_call(&mut self, c: &'t ast::ExprCall) {
        // django-hosts: `host(r"api", "proj.api_urls", name="api")`
        if matches!(
            self.canon(&c.func).as_ref().and_then(dotted).as_deref(),
            Some("django_hosts.host" | "django_hosts.defaults.host")
        ) && let Some(u) = arg(c, 1, "urlconf").and_then(string_value)
        {
            self.out.host_urlconfs.push(u);
        }
        let Expr::Attribute(a) = c.func.as_ref() else {
            return;
        };
        match a.attr.as_str() {
            "setdefault" => {
                if self.canon(&c.func).as_ref().and_then(dotted).as_deref()
                    == Some("os.environ.setdefault")
                    && c.arguments.args.first().and_then(string_value).as_deref()
                        == Some("DJANGO_SETTINGS_MODULE")
                    && let Some(m) = c.arguments.args.get(1).and_then(string_value)
                    && self.out.settings.settings_module.is_none()
                {
                    self.out.settings.settings_module = Some(m);
                }
            }
            "add_periodic_task" => {
                let Some(sig) = arg(c, 1, "sig") else { return };
                let name = keyword(c, "name").and_then(string_value);
                let task = match sig {
                    // `cleanup.s(...)`, `cleanup.si(...)`, `cleanup.signature(...)`
                    Expr::Call(sc) => match sc.func.as_ref() {
                        Expr::Attribute(sa)
                            if matches!(sa.attr.as_str(), "s" | "si" | "signature") =>
                        {
                            self.canon(&sa.value).map(RawBeatTask::Ref)
                        }
                        // `signature("proj.tasks.cleanup")`
                        f => self
                            .canon(f)
                            .as_ref()
                            .and_then(dotted)
                            .filter(|d| d == "celery.signature")
                            .and_then(|_| sc.arguments.args.first().and_then(string_value))
                            .map(RawBeatTask::Name),
                    },
                    e => self.canon(e).map(RawBeatTask::Ref),
                };
                if let Some(task) = task
                    && !matches!(
                        task,
                        RawBeatTask::Ref(RawRef {
                            base: RawBase::Global(_),
                            ..
                        })
                    )
                {
                    self.out.beats.push(RawBeat { name, task });
                }
            }
            _ => {}
        }
    }
}
