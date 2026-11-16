//! Repo-wide configuration the linker applies on top of the adapters: Django settings
//! (`ROOT_URLCONF`, `MIDDLEWARE`, DRF's defaults), the Django admin, Flask's app-wide
//! hooks, and Celery task names and beat schedules.
//!
//! **Settings modules.** A module named by a literal `DJANGO_SETTINGS_MODULE` in
//! `manage.py`, `wsgi.py` or `asgi.py`; when there is none, every `settings.py` and
//! `settings/*.py`. Star imports (`from .base import *`) are followed. Only settings
//! with a `ROOT_URLCONF` inside the repo count.
//!
//! **URL roots.** With settings found, the `ROOT_URLCONF` modules and what they include
//! are the URLconfs that serve requests. A URLconf below a settings module's project
//! directory (the directory `ROOT_URLCONF`'s dotted name is relative to) that no root
//! reaches serves nothing; URLconfs outside every project directory keep the fallback
//! of being roots themselves, as when no settings are found at all.

use drift_core::ingest::rel_posix;

use super::*;

const LOGIN_MIDDLEWARE: &str = "pkg:django#contrib.auth.middleware.LoginRequiredMiddleware";
const LOGIN_NOT_REQUIRED: &str = "pkg:django#contrib.auth.decorators.login_not_required";
/// Django's own views marked `login_not_required` (Django 5.1).
const LOGIN_EXEMPT_VIEWS: &[&str] = &[
    "pkg:django#contrib.auth.views.LoginView",
    "pkg:django#contrib.auth.views.PasswordResetView",
    "pkg:django#contrib.auth.views.PasswordResetDoneView",
    "pkg:django#contrib.auth.views.PasswordResetConfirmView",
    "pkg:django#contrib.auth.views.PasswordResetCompleteView",
];
/// The default admin site object.
const ADMIN_SITES: &[&str] = &[
    "pkg:django#contrib.admin.site",
    "pkg:django#contrib.admin.sites.site",
];
/// Wraps every admin view: it requires an active staff user (`AdminSite.has_permission`).
const ADMIN_VIEW: &str = "pkg:django#contrib.admin.sites.AdminSite.admin_view";
/// Wrappers that open a view to anyone rather than guard it.
pub(super) const OPENS: &[&str] = &[
    "pkg:rest_framework#permissions.AllowAny",
    LOGIN_NOT_REQUIRED,
];
/// Packages whose middleware turns no caller away and answers no request in a
/// view's place (Django's own, CORS headers, static files, the debug toolbar,
/// metrics), by the start of the dotted path written in `MIDDLEWARE`. The list to
/// extend: any other package's middleware is not read, so no view it serves is said
/// to have no guard ([`Guards::middleware`]).
const NO_GUARD_MIDDLEWARE: &[&str] = &[
    "django.",
    "corsheaders.",
    "whitenoise.",
    "debug_toolbar.",
    "django_prometheus.",
    // The request or its user kept where code outside a view reads it
    // (django-crum, django-currentuser, django-simple-history, django-htmx,
    // django-user-agents): each sets a value and hands the request on.
    "crum.",
    "django_currentuser.",
    "simple_history.",
    "django_htmx.",
    "django_user_agents.",
    // Request ids, logging, profiling and tracing.
    "log_request_id.",
    "request_id.",
    "django_guid.",
    "django_structlog.",
    "request_logging.",
    "silk.",
    "querycount.",
    "nplusone.",
    "elasticapm.",
    "ddtrace.",
    "opentelemetry.",
    "rollbar.",
    // Response headers (django-csp, django-permissions-policy) and the
    // development reloader.
    "csp.",
    "django_permissions_policy.",
    "django_browser_reload.",
];
/// What stands for a middleware of `MIDDLEWARE` that is not read: `unresolved:`, so
/// the reading of a guard position says unknown.
const UNREAD_MIDDLEWARE: &str = "unresolved:";
/// Classes followed up an inheritance chain.
const MAX_CHAIN: usize = 8;

/// Whether a base of a class reads the DRF class attributes it declares
/// ([`Linker::drf_attrs`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DrfAttrs {
    /// A DRF view base runs them.
    Read,
    /// Every base resolves to a framework view that is no DRF view: they run nowhere.
    Ignored,
    /// A base the facts do not read (its canonical id): whether it runs them is not
    /// known.
    Unread(String),
}

/// Guards a settings module applies to every view it serves (canonical class ids).
#[derive(Debug, Default, Clone)]
pub(super) struct Guards {
    /// `LoginRequiredMiddleware` (or an in-repo subclass) in `MIDDLEWARE`.
    login: Vec<String>,
    /// `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]`.
    drf_auth: Vec<String>,
    /// `REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"]`.
    drf_perm: Vec<String>,
    /// In-repo middleware in `MIDDLEWARE` (other than [`Guards::login`]) that turns a
    /// caller away itself ([`drift_core::controls::REJECTS_CALLER`]), or does or may
    /// in an `except` handler ([`drift_core::controls::HANDLER_REJECTS`],
    /// [`drift_core::controls::HANDLER_MAY_REJECT`]; not in what mining reads): it
    /// runs before every view, DRF's included. Since the measured build, also each
    /// middleware of a package on no list ([`NO_GUARD_MIDDLEWARE`]), as
    /// `unresolved:<dotted path> in MIDDLEWARE`, added however `MIDDLEWARE` is built
    /// (`+=`, `.insert`, another settings module).
    middleware: Vec<String>,
    /// In-repo middleware in `MIDDLEWARE` that turns no one away but keeps a value
    /// on an object of its module ([`drift_core::controls::KEEPS_VALUE`]) or hands
    /// a value of the caller to a call (`set_current_tenant(request.user.account)`):
    /// what it keeps may scope the rows of every view it serves. An application
    /// middleware of each view ([`drift_core::Symbol::app_middleware`]), read for
    /// authorization; since the measured build.
    scoping: Vec<String>,
}

#[derive(Debug)]
struct Settings {
    /// URLconf module ids that serve requests (`ROOT_URLCONF` first).
    roots: Vec<String>,
    /// Repo-relative project directory (`""` for the repo root).
    scope: String,
    /// Nested projects inside `scope` (their own entry script, other settings).
    excluded: Vec<String>,
    /// Every root was found and every include they reach was followed.
    complete: bool,
    guards: Guards,
    /// `MIDDLEWARE`, as written.
    listed: Vec<String>,
}

impl Settings {
    /// True when `file` belongs to this settings module's project.
    fn covers(&self, file: &str) -> bool {
        in_scope(file, &self.scope) && !self.excluded.iter().any(|d| in_scope(file, d))
    }
}

#[derive(Debug, Default)]
pub(super) struct Django {
    settings: Vec<Settings>,
    /// URLconf or router node -> the settings whose `ROOT_URLCONF` reaches it.
    reach: BTreeMap<String, BTreeSet<usize>>,
}

impl Django {
    /// `MIDDLEWARE` of every settings module whose project `file` is in, as written;
    /// none when no settings module is found for it.
    pub(super) fn middleware_for(&self, file: &str) -> Option<Vec<&str>> {
        let mut found = false;
        let mut out = Vec::new();
        for s in self.settings.iter().filter(|s| s.covers(file)) {
            found = true;
            out.extend(s.listed.iter().map(String::as_str));
        }
        found.then_some(out)
    }
}

/// `manage.py`, `wsgi.py`, `asgi.py` (also as packages): where Django's entry scripts set
/// `DJANGO_SETTINGS_MODULE`.
pub(crate) fn is_entry_script(rel: &str) -> bool {
    let mut parts = rel.rsplit('/');
    let file = parts.next().unwrap_or(rel);
    match file {
        "manage.py" | "wsgi.py" | "asgi.py" => true,
        "__init__.py" => matches!(parts.next(), Some("wsgi" | "asgi")),
        _ => false,
    }
}

/// `settings.py` and `settings/*.py`.
pub(crate) fn is_settings_file(rel: &str) -> bool {
    let mut parts = rel.rsplit('/');
    parts.next() == Some("settings.py") || parts.next() == Some("settings")
}

/// The directory a dotted module name is relative to: `netbox/netbox/urls.py` for
/// `netbox.urls` is in project directory `netbox`.
fn scope_of(id: &str, dotted: &str) -> String {
    let comps: Vec<&str> = id.split('/').collect();
    let drop = dotted.split('.').count() + usize::from(id.ends_with("/__init__.py"));
    comps[..comps.len().saturating_sub(drop)].join("/")
}

fn in_scope(file: &str, scope: &str) -> bool {
    scope.is_empty()
        || file
            .strip_prefix(scope)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// Entries of `first` that every other list also has, in `first`'s order.
fn common(lists: &[&Vec<String>]) -> Vec<String> {
    let Some((first, rest)) = lists.split_first() else {
        return vec![];
    };
    first
        .iter()
        .filter(|x| rest.iter().all(|l| l.contains(x)))
        .cloned()
        .collect()
}

impl Linker<'_> {
    /// The raw symbol a canonical `module#name` reference names, in the repo.
    pub(crate) fn symbol_at(&self, c: &str) -> Option<(usize, &RawSymbol)> {
        let (module, name) = c.split_once('#')?;
        if name.contains(['(', '*']) {
            return None;
        }
        let fi = self.file(module)?;
        let sym = self.files[fi].raw.symbols.iter().find(|s| s.name == name)?;
        Some((fi, sym))
    }

    /// `class` and its ancestors, depth first, left to right (in-repo bases are followed;
    /// an external base ends its branch).
    pub(super) fn class_chain(&self, class: &str) -> Vec<String> {
        let mut out = Vec::new();
        self.chain_into(class, 0, &mut out);
        out
    }

    fn chain_into(&self, class: &str, depth: usize, out: &mut Vec<String>) {
        if depth > MAX_CHAIN || out.iter().any(|c| c == class) {
            return;
        }
        out.push(class.to_string());
        if let Some((fi, sym)) = self.symbol_at(class) {
            for (base, kind) in &sym.wraps {
                if *kind == WrapKind::Extends {
                    self.chain_into(&self.canon(fi, base), depth + 1, out);
                }
            }
        }
    }

    /// True when `module#class` has a DRF view (`APIView`, a `ViewSet`) among its ancestors.
    pub(super) fn is_drf_view(&self, module: &str, class: &str) -> bool {
        self.class_chain(&format!("{module}#{class}"))
            .iter()
            .any(|c| {
                c.strip_prefix("pkg:rest_framework#").is_some_and(|rest| {
                    let last = rest.rsplit('.').next().unwrap_or(rest);
                    last.ends_with("APIView") || last.ends_with("ViewSet")
                })
            })
    }

    /// Whether anything runs the DRF class attributes (`permission_classes`,
    /// `authentication_classes`) that `module#class` declares, from the bases the
    /// facts resolve. They are a guard only where a base reads them: a DRF view
    /// base does ([`DrfAttrs::Read`]); a chain that ends only in framework view
    /// classes that are no DRF view (Django's `View`, Flask's) runs them nowhere
    /// ([`DrfAttrs::Ignored`]); any other base (a package's class Drift does not
    /// know, an unresolved import, a chain too deep to follow) might read them, and
    /// that is not known ([`DrfAttrs::Unread`], with the base in the code's words).
    pub(super) fn drf_attrs(&self, module: &str, class: &str) -> DrfAttrs {
        if self.is_drf_view(module, class) {
            return DrfAttrs::Read;
        }
        let chain = self.class_chain(&format!("{module}#{class}"));
        if chain.len() > MAX_CHAIN {
            return DrfAttrs::Unread(chain.last().cloned().unwrap_or_default());
        }
        for c in &chain {
            // A class of the repository: its own bases are in the chain.
            if self.symbol_at(c).is_some() || c == "global#object" {
                continue;
            }
            let framework = c
                .strip_prefix("pkg:")
                .and_then(|r| r.split_once('#'))
                .and_then(|(package, path)| {
                    crate::lower::adapters::view_adapter(&format!("{package}.{path}"))
                })
                .is_some_and(|a| a != "drf");
            if !framework {
                return DrfAttrs::Unread(c.clone());
            }
        }
        DrfAttrs::Ignored
    }

    /// Canonical id of a dotted path in a setting (`"rest_framework.permissions.IsAuthenticated"`),
    /// resolved as `import_string` would from the settings file.
    pub(super) fn dotted_canon(&self, fi: usize, path: &str) -> Option<String> {
        let (module, name) = path.rsplit_once('.')?;
        let m = self.res.resolve(&self.files[fi].abs_path, module);
        Some(if m.contains(':') {
            fold_external(&format!("{m}#{name}"))
        } else {
            fold_external(&self.origin(&m, name))
        })
    }

    /// A module's settings as Python binds them: what its star imports
    /// (`from .base import *`, later ones rebinding earlier ones) bring, then its own
    /// assignments, which rebind a setting or extend it (`+=`, `{**REST_FRAMEWORK}`).
    ///
    /// `memo` holds each module's result once computed, so star-import fan-out (every
    /// module importing every later one) costs one visit per module, not one per path;
    /// `path` is the import chain being followed, to stop at cycles.
    fn effective_settings(
        &self,
        fi: usize,
        depth: usize,
        path: &mut BTreeSet<usize>,
        memo: &mut BTreeMap<usize, RawSettings>,
    ) -> RawSettings {
        if let Some(done) = memo.get(&fi) {
            return done.clone();
        }
        let raw = &self.files[fi].raw;
        let own = raw.settings.clone();
        if depth > MAX_HOPS || !path.insert(fi) {
            return own;
        }
        let mut base = RawSettings::default();
        for spec in &raw.star_imports {
            let Some(bi) = self.specs[fi].get(spec).and_then(|m| self.file(m)) else {
                continue;
            };
            let b = self.effective_settings(bi, depth + 1, path, memo);
            for (k, v) in b.urlconfs {
                base.urlconfs.retain(|(x, _)| *x != k);
                base.urlconfs.push((k, v));
            }
            base.middleware = b.middleware.or(base.middleware);
            base.drf = b.drf.or(base.drf);
        }
        path.remove(&fi);
        let mut out = base;
        for (k, v) in own.urlconfs {
            out.urlconfs.retain(|(x, _)| *x != k);
            out.urlconfs.push((k, v));
        }
        out.middleware = match (own.middleware, out.middleware) {
            (None, b) => b,
            (Some(l), Some(mut b)) if l.extends => {
                for m in l.items {
                    if !b.items.contains(&m) {
                        b.items.push(m);
                    }
                }
                Some(b)
            }
            (Some(l), _) => Some(l),
        };
        out.drf = match (own.drf, out.drf) {
            (None, b) => b,
            (Some(d), Some(b)) if d.extends => Some(RawDrf {
                extends: b.extends,
                permissions: d.permissions.or(b.permissions),
                authentication: d.authentication.or(b.authentication),
                exception_handler: d.exception_handler.or(b.exception_handler),
            }),
            (Some(d), _) => Some(d),
        };
        out.settings_module = own.settings_module;
        memo.insert(fi, out.clone());
        out
    }

    /// Entry scripts (`manage.py`, `wsgi.py`, `asgi.py`): each one's project directory and
    /// the settings module it names, if any.
    fn entry_projects(&self) -> Vec<(String, Option<String>)> {
        let mut out = Vec::new();
        for f in self.files {
            if !is_entry_script(&f.rel_path) {
                continue;
            }
            let settings = f.raw.settings.settings_module.as_ref().and_then(|m| {
                let id = self.res.resolve(&f.abs_path, m);
                self.file(&id).is_some().then(|| (id, m.clone()))
            });
            let dir = if f.rel_path.ends_with("manage.py") {
                f.rel_path
                    .rsplit_once('/')
                    .map_or("", |(d, _)| d)
                    .to_string()
            } else if let Some((id, dotted)) = &settings {
                scope_of(id, dotted)
            } else {
                rel_posix(self.res.root(), &self.res.basedir(&f.abs_path)).unwrap_or_default()
            };
            out.push((dir, settings.map(|(id, _)| id)));
        }
        out
    }

    pub(super) fn django_config(&self) -> Django {
        let projects = self.entry_projects();
        let mut candidates: BTreeSet<usize> = projects
            .iter()
            .filter_map(|(_, s)| s.as_ref().and_then(|id| self.file(id)))
            .collect();
        if candidates.is_empty() {
            candidates = (0..self.files.len())
                .filter(|&fi| is_settings_file(&self.files[fi].rel_path))
                .collect();
        }
        let mut out = Django::default();
        let mut memo = BTreeMap::new();
        for fi in candidates {
            let eff = self.effective_settings(fi, 0, &mut BTreeSet::new(), &mut memo);
            let Some(urlconf) = eff.urlconf("ROOT_URLCONF") else {
                continue;
            };
            let abs = &self.files[fi].abs_path;
            let root = self.res.resolve(abs, urlconf);
            if self.file(&root).is_none() {
                continue;
            }
            let module = self.module_of(fi).to_string();
            let scope = scope_of(&root, urlconf);
            // A nested project (its own entry script, other settings) is not this one's.
            let excluded = projects
                .iter()
                .filter(|(dir, s)| {
                    *dir != scope && in_scope(dir, &scope) && s.as_deref() != Some(&module)
                })
                .map(|(dir, _)| dir.clone())
                .collect();
            // Other URL roots: `PUBLIC_SCHEMA_URLCONF`, the URLconfs a `ROOT_HOSTCONF`
            // serves. One Drift cannot find makes the roots incomplete.
            let mut roots = vec![root];
            let mut complete = true;
            for (k, v) in &eff.urlconfs {
                let id = self.res.resolve(abs, v);
                let found = self.file(&id);
                if k.ends_with("HOSTCONF") {
                    match found {
                        Some(hi) => {
                            let h = &self.files[hi];
                            for u in &h.raw.host_urlconfs {
                                match self.file(&self.res.resolve(&h.abs_path, u)) {
                                    Some(ui) => roots.push(self.module_of(ui).to_string()),
                                    None => complete = false,
                                }
                            }
                        }
                        None => complete = false,
                    }
                } else if k != "ROOT_URLCONF" {
                    match found {
                        Some(ui) => roots.push(self.module_of(ui).to_string()),
                        None => complete = false,
                    }
                }
            }
            let drf = eff.drf.clone().unwrap_or_default();
            let classes = |list: &Option<Vec<String>>| -> Vec<String> {
                list.iter()
                    .flatten()
                    .filter_map(|p| self.dotted_canon(fi, p))
                    .collect()
            };
            let listed: Vec<String> = eff
                .middleware
                .iter()
                .flat_map(|l| &l.items)
                .filter_map(|m| self.dotted_canon(fi, m))
                .collect();
            let (login, others): (Vec<String>, Vec<String>) = listed
                .into_iter()
                .partition(|c| self.class_chain(c).iter().any(|x| x == LOGIN_MIDDLEWARE));
            let mut middleware: Vec<String> = others
                .into_iter()
                .filter(|c| {
                    use drift_core::controls::{
                        HANDLER_MAY_REJECT, HANDLER_REJECTS, REJECTS_CALLER,
                    };
                    self.symbol_at(c).is_some_and(|(_, s)| {
                        let has = |control: &str| s.controls.iter().any(|x| x == control);
                        // One that answers "not signed in" in an `except` handler
                        // (or may) is read since the measured build.
                        has(REJECTS_CALLER)
                            || ((has(HANDLER_REJECTS) || has(HANDLER_MAY_REJECT))
                                && self.since_measured())
                    })
                })
                .collect();
            // A package's middleware on no list runs before every view and may turn
            // a caller away, or answer in the view's place: it is not read.
            let unlisted: Vec<String> = eff
                .middleware
                .iter()
                .flat_map(|l| &l.items)
                .filter(|m| {
                    !self
                        .dotted_canon(fi, m)
                        .is_some_and(|c| !c.starts_with("pkg:") && !c.starts_with("global#"))
                        && !NO_GUARD_MIDDLEWARE.iter().any(|p| m.starts_with(p))
                })
                .map(|m| format!("{UNREAD_MIDDLEWARE}{m} in MIDDLEWARE"))
                .collect();
            // A middleware of the repository built on a package's on no list
            // (`class Gate(RequireAuthMiddleware)`): what it inherits runs and is not
            // read.
            let through_package: Vec<String> = eff
                .middleware
                .iter()
                .flat_map(|l| &l.items)
                .filter(|m| {
                    self.dotted_canon(fi, m).is_some_and(|c| {
                        !c.starts_with("pkg:")
                            && !c.starts_with("global#")
                            && !login.contains(&c)
                            && !middleware.contains(&c)
                            && self.class_chain(&c).iter().skip(1).any(|b| {
                                b.strip_prefix("pkg:").is_some_and(|p| {
                                    let dotted = p.replace('#', ".");
                                    !NO_GUARD_MIDDLEWARE.iter().any(|x| dotted.starts_with(x))
                                })
                            })
                    })
                })
                .map(|m| format!("{UNREAD_MIDDLEWARE}{m} in MIDDLEWARE"))
                .collect();
            if !unlisted.is_empty() && self.since_measured() {
                middleware.extend(unlisted);
            }
            if !through_package.is_empty() && self.since_measured() {
                middleware.extend(through_package);
            }
            let scoping: Vec<String> = eff
                .middleware
                .iter()
                .flat_map(|l| &l.items)
                .filter_map(|m| self.dotted_canon(fi, m))
                .filter(|c| {
                    !c.starts_with("pkg:")
                        && !c.starts_with("global#")
                        && !login.contains(c)
                        && !middleware.contains(c)
                        && self.symbol_at(c).is_some_and(|(_, s)| {
                            s.controls
                                .iter()
                                .any(|x| x == drift_core::controls::KEEPS_VALUE)
                                || !s.caller_args.is_empty()
                        })
                })
                .collect();
            let scoping = if !scoping.is_empty() && self.since_measured() {
                scoping
            } else {
                Vec::new()
            };
            out.settings.push(Settings {
                listed: eff
                    .middleware
                    .iter()
                    .flat_map(|l| &l.items)
                    .cloned()
                    .collect(),
                roots,
                scope,
                excluded,
                complete,
                guards: Guards {
                    login,
                    drf_auth: classes(&drf.authentication),
                    drf_perm: classes(&drf.permissions),
                    middleware,
                    scoping,
                },
            });
        }
        // `request.urlconf = "..."` in the project's code (a middleware) is a root too.
        for f in self.files {
            for u in &f.raw.request_urlconfs {
                let target = self.file(&self.res.resolve(&f.abs_path, u));
                for s in &mut out.settings {
                    if s.covers(&f.rel_path) {
                        match target {
                            Some(ui) => s.roots.push(self.module_of(ui).to_string()),
                            None => s.complete = false,
                        }
                    }
                }
            }
        }
        // What each settings module's roots reach through includes and router mounts.
        let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for (target, ps) in &self.parents {
            for (p, ..) in ps {
                children
                    .entry(p.as_str())
                    .or_default()
                    .push(target.as_str());
            }
        }
        for (i, s) in out.settings.iter().enumerate() {
            let mut stack: Vec<&str> = s.roots.iter().map(String::as_str).collect();
            while let Some(n) = stack.pop() {
                if !out.reach.entry(n.to_string()).or_default().insert(i) {
                    continue;
                }
                stack.extend(children.get(n).into_iter().flatten().copied());
            }
        }
        // An include Drift cannot follow in a reached URLconf: the roots are not known
        // to be complete, so nothing in that project is pruned.
        for (n, idx) in &out.reach {
            if self.open_urlconfs.contains(n) {
                for &i in idx {
                    out.settings[i].complete = false;
                }
            }
        }
        out
    }

    /// True for a URLconf (or router) that serves nothing: in a Django project whose URL
    /// roots are all known, and reached from none of them. When in doubt (an include
    /// Drift cannot follow, a nested project), it is kept as a root: hiding an entry
    /// point is worse than listing one too many.
    pub(super) fn is_dead(&self, node: &str) -> bool {
        let d = &self.django;
        if d.settings.is_empty() || d.reach.contains_key(node) {
            return false;
        }
        let file = node.split('#').next().unwrap_or(node);
        let covering: Vec<&Settings> = d.settings.iter().filter(|s| s.covers(file)).collect();
        !covering.is_empty() && covering.iter().all(|s| s.complete)
    }

    /// Guards every settings module serving `node` applies.
    pub(super) fn settings_guards(&self, node: &str) -> Guards {
        let Some(idx) = self.django.reach.get(node) else {
            return Guards::default();
        };
        let gs: Vec<&Guards> = idx
            .iter()
            .map(|&i| &self.django.settings[i].guards)
            .collect();
        let pick =
            |f: fn(&Guards) -> &Vec<String>| common(&gs.iter().map(|g| f(g)).collect::<Vec<_>>());
        Guards {
            login: pick(|g| &g.login),
            drf_auth: pick(|g| &g.drf_auth),
            drf_perm: pick(|g| &g.drf_perm),
            // A middleware that is not read, of any settings module serving it.
            middleware: {
                let mut m = pick(|g| &g.middleware);
                for g in &gs {
                    for x in g
                        .middleware
                        .iter()
                        .filter(|x| x.starts_with(UNREAD_MIDDLEWARE))
                    {
                        if !m.contains(x) {
                            m.push(x.clone());
                        }
                    }
                }
                m
            },
            // One that may scope, of any settings module serving it.
            scoping: {
                let mut m: Vec<String> = Vec::new();
                for x in gs.iter().flat_map(|g| &g.scoping) {
                    if !m.contains(x) {
                        m.push(x.clone());
                    }
                }
                m
            },
        }
    }

    /// Wraps the settings give one view symbol in file `ti` (`Config`,
    /// `ConfigAuthenticates`), and the DRF classes it inherits from an in-repo base
    /// (`Call`, `Authenticates`), which replace the settings' defaults, as in DRF.
    pub(super) fn view_settings_guards(
        &self,
        ti: usize,
        symbol: &str,
        adapter: &str,
        settings: &Guards,
        reg_guards: &[String],
    ) -> (Vec<Wrap>, Vec<Wrap>) {
        let wrap = |wrapper: &String, kind| Wrap {
            wrapper: wrapper.clone(),
            kind,
        };
        let mut cfg = Vec::new();
        let mut inherited = Vec::new();
        let Some(sym) = self.files[ti].raw.symbols.iter().find(|s| s.name == symbol) else {
            return (cfg, inherited);
        };
        let rel = self.module_of(ti);
        let view = format!("{rel}#{}", sym.owner.as_deref().unwrap_or(&sym.name));
        let chain = self.class_chain(&view);
        // DRF (3.16+) sets `login_required = False` on every `APIView`, viewset and
        // `@api_view`: the middleware never guards them. (Older DRF on Django 5.1 is
        // guarded; Drift does not read the installed version, and under-reporting a
        // guard is the safe direction.)
        cfg.extend(
            settings
                .middleware
                .iter()
                .map(|w| wrap(w, WrapKind::Config)),
        );
        cfg.extend(
            settings
                .scoping
                .iter()
                .map(|w| wrap(&format!("mw:{w}"), WrapKind::Config)),
        );
        if !settings.login.is_empty() && adapter != "drf" {
            // `@login_not_required` on the view (or `login_not_required(view)` in the
            // URLconf, or on a base class's dispatch), and Django's own login views.
            let exempt = reg_guards.iter().any(|g| g == LOGIN_NOT_REQUIRED)
                || sym
                    .wraps
                    .iter()
                    .any(|(r, _)| self.canon(ti, r) == LOGIN_NOT_REQUIRED)
                || chain.iter().any(|c| {
                    LOGIN_EXEMPT_VIEWS.contains(&c.as_str())
                        || self.symbol_at(c).is_some_and(|(fi, s)| {
                            s.wraps
                                .iter()
                                .any(|(r, _)| self.canon(fi, r) == LOGIN_NOT_REQUIRED)
                        })
                });
            if !exempt {
                cfg.extend(settings.login.iter().map(|w| wrap(w, WrapKind::Config)));
            }
        }
        // The permission classes the view runs with could not be read (since the
        // measured build): said on the view, in place of the settings' default where
        // the view binds its own.
        let unread = (adapter == "drf")
            .then(|| self.permissions_unread(sym, &chain))
            .flatten()
            .filter(|_| self.since_measured());
        // What the `get_permissions` of its class answers for this handler, where
        // the method is read to the end ([`RawSymbol::drf_permission_cases`]): the
        // classes of the case its method and its action take, in place of "not
        // read". The `permission_classes` the view itself declares are its wraps
        // already, and a method that returns its own lists does not run them:
        // those are taken off ([`REPLACES`]).
        let chosen: Option<(usize, &RawPermCase)> = match &unread {
            Some((words, _))
                if words == crate::raw::GET_PERMISSIONS
                    && sym.owner.is_some()
                    && sym.drf_permissions_unread.is_none() =>
            {
                chain
                    .iter()
                    .filter_map(|c| self.symbol_at(c))
                    .find(|(_, s)| {
                        s.drf_permissions_unread.as_deref() == Some(crate::raw::GET_PERMISSIONS)
                    })
                    .and_then(|(fi, definer)| {
                        let case = permission_case(definer.drf_permission_cases.as_deref()?, sym)?;
                        Some((fi, case))
                    })
                    .filter(|(_, case)| {
                        case.classes.is_none()
                            || !chain.first().is_some_and(|view| {
                                self.symbol_at(view)
                                    .is_some_and(|(_, s)| s.drf_reassigned.is_some())
                            })
                    })
            }
            _ => None,
        };
        let unread = unread.filter(|_| chosen.is_none());
        if let Some((words, _)) = &unread {
            inherited.push(wrap(&format!("unresolved:{words}"), WrapKind::Call));
        }
        let own_unread = unread.is_some_and(|(_, own)| own);
        // A class of the chain whose `permission_classes` are assigned after its
        // body holds those ([`RawSymbol::drf_reassigned`]), since the measured
        // build.
        let reassigned = chain.iter().any(|c| {
            self.symbol_at(c)
                .is_some_and(|(_, s)| s.drf_reassigned.is_some())
        }) && self.since_measured();
        if adapter == "drf" {
            type Pick = fn(&RawSymbol) -> &Option<Vec<RawRef>>;
            let permissions: Pick = if reassigned {
                |s| match &s.drf_reassigned {
                    Some(now) => &now.classes,
                    None => &s.drf_permissions,
                }
            } else {
                |s| &s.drf_permissions
            };
            let slots: [(Pick, &Vec<String>, WrapKind, WrapKind); 2] = [
                (
                    |s| &s.drf_authentication,
                    &settings.drf_auth,
                    WrapKind::Authenticates,
                    WrapKind::ConfigAuthenticates,
                ),
                (
                    permissions,
                    &settings.drf_perm,
                    WrapKind::Call,
                    WrapKind::Config,
                ),
            ];
            for (pick, default, own_kind, cfg_kind) in slots {
                // The classes `get_permissions` returns for this handler are its
                // permissions: neither a base's `permission_classes` nor the
                // settings' default run beside them.
                if cfg_kind == WrapKind::Config
                    && let Some((
                        fi,
                        RawPermCase {
                            classes: Some(classes),
                            ..
                        },
                    )) = chosen
                {
                    let returned: Vec<String> = classes.iter().map(|r| self.canon(fi, r)).collect();
                    // What the view declares and the method does not return.
                    if let Some((vi, view)) = chain.first().and_then(|c| self.symbol_at(c)) {
                        for declared in view.drf_permissions.iter().flatten() {
                            let declared = self.canon(vi, declared);
                            if !returned.contains(&declared) {
                                inherited.push(wrap(&format!("{REPLACES}{declared}"), own_kind));
                            }
                        }
                    }
                    inherited.extend(returned.iter().map(|w| wrap(w, own_kind)));
                    continue;
                }
                let declared = chain.iter().enumerate().find_map(|(i, c)| {
                    let (fi, s) = self.symbol_at(c)?;
                    pick(s).as_ref().map(|l| (i, fi, l))
                });
                match declared {
                    // Declared by the view itself: already its wraps.
                    Some((0, _, _)) => {}
                    Some((_, fi, list)) => {
                        inherited.extend(list.iter().map(|r| wrap(&self.canon(fi, r), own_kind)))
                    }
                    None if own_unread && cfg_kind == WrapKind::Config => {}
                    None => cfg.extend(default.iter().map(|w| wrap(w, cfg_kind))),
                }
            }
        }
        (cfg, inherited)
    }

    /// The DRF permission classes of the view `sym` (its class chain `chain`, nearest
    /// first) that could not be read ([`RawSymbol::drf_permissions_unread`]), in the
    /// code's words, and whether the view binds its own in place of the settings'
    /// default: an action's own (`@action(permission_classes=...)`), a
    /// `get_permissions` any class of the chain defines, or the nearest
    /// `permission_classes` of the chain where that is no list of classes.
    fn permissions_unread(&self, sym: &RawSymbol, chain: &[String]) -> Option<(String, bool)> {
        if sym.owner.is_some()
            && let Some(w) = &sym.drf_permissions_unread
        {
            return Some((w.clone(), false));
        }
        let classes: Vec<&RawSymbol> = chain
            .iter()
            .filter_map(|c| self.symbol_at(c).map(|(_, s)| s))
            .collect();
        // (What is assigned after the class's body stands in place of the body's.)
        let of = |s: &RawSymbol| match &s.drf_reassigned {
            Some(now) => now.unread.clone(),
            None => s.drf_permissions_unread.clone(),
        };
        if classes
            .iter()
            .any(|s| of(s).as_deref() == Some(crate::raw::GET_PERMISSIONS))
        {
            return Some((crate::raw::GET_PERMISSIONS.to_string(), false));
        }
        // A function view (`@permission_classes(...)`) is its own chain.
        classes
            .into_iter()
            .find(|s| {
                s.drf_permissions.is_some()
                    || s.drf_permissions_unread.is_some()
                    || s.drf_reassigned.is_some()
            })
            .and_then(of)
            .map(|w| (w, true))
    }

    /// `admin.site` or an in-repo `AdminSite` instance.
    pub(super) fn is_admin_site(&self, node: &str) -> bool {
        ADMIN_SITES.contains(&node)
            || self
                .router_info(node)
                .is_some_and(|r| r.adapter == "django_admin")
    }

    /// `path("admin/", admin.site.urls)`: one entry point for the whole admin, on the
    /// URLconf's `urlpatterns`, guarded by `AdminSite.admin_view` (active staff users).
    pub(super) fn admin_entry(
        &self,
        fi: usize,
        parent: &str,
        prefix: &str,
        extra: &mut BTreeMap<String, Extra>,
    ) {
        if self.is_dead(parent)
            || !self.files[fi]
                .raw
                .symbols
                .iter()
                .any(|s| s.name == "urlpatterns")
        {
            return;
        }
        // Under each mount of the URLconf, with that mount's guards.
        let served = Served::of(&self.chains(parent, 0), |c| join_path(&[&c.prefix, prefix]));
        let settings = self.settings_guards(parent);
        let e = extra.entry(self.module_of(fi).to_string()).or_default();
        self.mount_facts(&served, "urlpatterns", &mut e.mounts);
        for route in &served.routes {
            e.entries.push(EntryPoint {
                symbol: "urlpatterns".into(),
                kind: "http".into(),
                method: Some("ANY".into()),
                route: Some(route.clone()),
                adapter: "django_admin".into(),
            });
        }
        let ws = e.wraps.entry("urlpatterns".into()).or_default();
        for w in served
            .guards
            .iter()
            .map(|d| d.id.clone())
            .chain([ADMIN_VIEW.to_string()])
        {
            let w = Wrap {
                wrapper: w,
                kind: WrapKind::Call,
            };
            if !ws.contains(&w) {
                ws.push(w);
            }
        }
        let cs = e.config.entry("urlpatterns".into()).or_default();
        for w in settings.login.into_iter().chain(settings.middleware) {
            let w = Wrap {
                wrapper: w,
                kind: WrapKind::Config,
            };
            if !cs.contains(&w) {
                cs.push(w);
            }
        }
    }

    /// Bases of `node` through every mount chain (the apps it is registered on);
    /// `node` itself when it is mounted nowhere.
    pub(super) fn mount_roots(&self, node: &str) -> Vec<String> {
        let mut out = BTreeSet::new();
        let mut seen = BTreeSet::new();
        let mut stack = vec![(node.to_string(), 0)];
        while let Some((n, depth)) = stack.pop() {
            if !seen.insert(n.clone()) {
                continue;
            }
            match self.parents.get(&n) {
                Some(ps) if depth < 16 => {
                    stack.extend(ps.iter().map(|(p, ..)| (p.clone(), depth + 1)));
                }
                _ => {
                    out.insert(n);
                }
            }
        }
        out.into_iter().collect()
    }

    /// `init_hooks(app)` called from `create_app()` with its local `app`: the helper's
    /// parameter is the factory's app, so hooks and blueprints registered on it belong
    /// to that app. Chains (`create_app` -> `setup` -> `init_hooks`) are followed.
    pub(super) fn app_aliases(&self) -> BTreeMap<String, BTreeSet<String>> {
        let mut edges: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (fi, f) in self.files.iter().enumerate() {
            for p in &f.raw.app_passes {
                let callee = self.canon(fi, &p.callee);
                let Some((module, func)) = callee.split_once('#') else {
                    continue;
                };
                let Some(gi) = self.file(module) else {
                    continue;
                };
                let Some((_, params)) = self.files[gi]
                    .raw
                    .factory_params
                    .iter()
                    .find(|(n, _)| n == func)
                else {
                    continue;
                };
                let param = match (&p.keyword, p.index) {
                    (Some(k), _) if params.contains(k) => k.as_str(),
                    (None, Some(i)) => match params.get(i as usize) {
                        Some(x) => x.as_str(),
                        None => continue,
                    },
                    _ => continue,
                };
                // A pass the measured build did not record.
                if p.unmeasured && !self.since_measured() {
                    continue;
                }
                let to = self.canon(fi, &p.from);
                let key = format!("{callee}.{param}");
                if key != to {
                    edges.entry(key).or_default().insert(to);
                }
            }
        }
        // Every app a parameter stands for, through helpers that pass it on
        // (`create_app` -> `setup(app)` -> `init_hooks(app)`); cycles end the walk.
        let mut alias = BTreeMap::new();
        for key in edges.keys() {
            let mut out = BTreeSet::new();
            let mut seen = BTreeSet::new();
            let mut stack: Vec<(&str, usize)> = vec![(key.as_str(), 0)];
            while let Some((n, depth)) = stack.pop() {
                if !seen.insert(n) {
                    continue;
                }
                match edges.get(n) {
                    Some(ts) if depth < MAX_CHAIN => {
                        stack.extend(ts.iter().map(|t| (t.as_str(), depth + 1)));
                    }
                    Some(_) => {}
                    None => {
                        out.insert(n.to_string());
                    }
                }
            }
            if !out.is_empty() {
                alias.insert(key.clone(), out);
            }
        }
        alias
    }

    /// Celery's default task name, `module.function` (`proj.tasks.add`).
    pub(super) fn task_name(&self, fi: usize, symbol: &str) -> String {
        match self.res.module_name(&self.files[fi].abs_path) {
            Some(m) => format!("{m}.{symbol}"),
            None => symbol.to_string(),
        }
    }

    /// A file-level entry point with its Celery task name filled in.
    pub(super) fn named_entry(&self, fi: usize, e: &EntryPoint) -> EntryPoint {
        let mut e = e.clone();
        if e.adapter == "celery" && e.route.is_none() {
            e.route = Some(self.task_name(fi, &e.symbol));
        }
        e
    }

    /// Celery beat entries become `cron` entry points on the task they run.
    pub(super) fn beat_entries(&self, extra: &mut BTreeMap<String, Extra>) {
        // task name -> (file, symbol); `file#symbol` -> task name
        let mut by_name: BTreeMap<String, (String, String)> = BTreeMap::new();
        let mut by_ref: BTreeMap<String, String> = BTreeMap::new();
        let mut add = |rel: &str, e: &EntryPoint| {
            if e.adapter == "celery"
                && e.kind == "job"
                && let Some(r) = &e.route
            {
                by_name
                    .entry(r.clone())
                    .or_insert_with(|| (rel.to_string(), e.symbol.clone()));
                by_ref
                    .entry(format!("{rel}#{}", e.symbol))
                    .or_insert_with(|| r.clone());
            }
        };
        for (fi, f) in self.files.iter().enumerate() {
            for e in &f.raw.entry_points {
                add(&f.rel_path, &self.named_entry(fi, e));
            }
        }
        for (rel, x) in extra.iter() {
            for e in &x.entries {
                add(rel, e);
            }
        }
        let mut crons = Vec::new();
        for (fi, f) in self.files.iter().enumerate() {
            for b in &f.raw.beats {
                let found = match &b.task {
                    RawBeatTask::Name(n) => by_name.get(n).map(|t| (t.clone(), n.clone())),
                    RawBeatTask::Ref(r) => {
                        let c = self.canon(fi, r);
                        let at = c
                            .split_once('#')
                            .map(|(m, s)| (m.to_string(), s.to_string()));
                        by_ref.get(&c).zip(at).map(|(n, at)| (at, n.clone()))
                    }
                };
                if let Some(((rel, symbol), task)) = found {
                    crons.push((rel, symbol, b.name.clone().unwrap_or(task)));
                }
            }
        }
        for (rel, symbol, route) in crons {
            extra.entry(rel).or_default().entries.push(EntryPoint {
                symbol,
                kind: "cron".into(),
                method: None,
                route: Some(route),
                adapter: "celery".into(),
            });
        }
    }
}

/// What starts a wrap that takes another off a handler: the permission class its
/// view declares and its `get_permissions` does not return for it
/// ([`Linker::view_settings_guards`]). Never in the facts: read where a symbol's
/// wraps are put together.
pub(crate) const REPLACES: &str = "replaces:";

/// The case of a `get_permissions` ([`RawPermCase`]) the handler `sym` takes: the
/// first whose every test holds for its method and its action (the handler's own
/// name: `list`, `retrieve`, an `@action`'s). `None` where a test is of the method
/// and the handler serves more than one, and where no case is taken.
fn permission_case<'c>(cases: &'c [RawPermCase], sym: &RawSymbol) -> Option<&'c RawPermCase> {
    let action = sym.name.rsplit('.').next()?;
    let method = match sym.methods.as_slice() {
        [one] => Some(one.as_str()),
        _ => None,
    };
    for case in cases {
        let mut taken = true;
        for t in &case.tests {
            let named = match t.action {
                true => t.names.iter().any(|n| n == action),
                false => {
                    let method = method?;
                    t.names.iter().any(|n| n == method)
                }
            };
            if named != t.holds {
                taken = false;
                break;
            }
        }
        if taken {
            return Some(case);
        }
    }
    None
}
