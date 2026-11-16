//! Repo-level pass: resolve imports, follow re-exports to each name's origin,
//! confirm adapter registrations across files, and produce final [`FileFacts`].
//!
//! Python has no export statement: every module-level binding is an attribute,
//! so origin following walks *all* bindings (`from .models import User` in
//! `app/crud.py` makes `app.crud.User` the same object), plus submodules of
//! packages and `from x import *`.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;

use drift_core::{
    EntryPoint, Export, ExportKind, FileFacts, Import, Registry, RegistryItem, Symbol, Wrap,
    WrapKind,
};

use crate::lower::KWARG_INDEX;
use crate::lower::adapters::soft_value;
use crate::raw::*;
use crate::resolve::Resolver;

#[path = "config.rs"]
pub(crate) mod config;

/// Maximum hops followed through re-exports (guards cycles).
const MAX_HOPS: usize = 32;
/// Deepest FastAPI sub-dependency chain followed.
const MAX_DEP_DEPTH: usize = 8;

/// Leading qualifiers that name a soft dependency when what follows names who is
/// asking ([`PRINCIPALS`]): `get_optional_user`, `public_user`, `MaybeAuth`,
/// `get_optional_current_user`. A chain does not follow one: what it depends on is no
/// requirement of its dependents.
const SOFT_LEADS: &[&str] = &[
    "optional",
    "maybe",
    "anonymous",
    "anon",
    "soft",
    "lenient",
    "public",
    "guest",
    "unauthenticated",
    "nullable",
];
/// Words that name who is asking, after a soft lead (and any of [`PRINCIPAL_PREFIXES`]).
const PRINCIPALS: &[&str] = &[
    "user",
    "users",
    "session",
    "principal",
    "account",
    "member",
    "identity",
    "subject",
    "viewer",
    "actor",
    "caller",
    "client",
    "customer",
    "developer",
    "auth",
    "token",
    "credentials",
    "creds",
];
/// Words allowed between a soft lead and the principal (`optional_current_user`).
const PRINCIPAL_PREFIXES: &[&str] = &["current", "active", "authenticated"];
/// Trailing qualifiers that do (`get_current_user_optional`, `get_user_or_none`,
/// `user_or_anonymous`), as word sequences.
const SOFT_TAILS: &[&[&str]] = &[
    &["optional"],
    &["or", "none"],
    &["or", "anonymous"],
    &["or", "anon"],
    &["or", "guest"],
];

/// The words of a name, lower-cased: `snake_case`, `CamelCase` and both mixed.
fn name_words(name: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for ch in name.chars() {
        if !ch.is_alphanumeric() {
            words.push(std::mem::take(&mut cur));
            prev_lower = false;
            continue;
        }
        if ch.is_uppercase() && prev_lower {
            words.push(std::mem::take(&mut cur));
        }
        prev_lower = ch.is_lowercase() || ch.is_ascii_digit();
        cur.extend(ch.to_lowercase());
    }
    words.push(cur);
    words.retain(|w| !w.is_empty());
    words
}

/// True when a dependency's name says it is soft: after a `get_`, a leading qualifier
/// of [`SOFT_LEADS`] on a principal (`public_user`, `get_optional_current_user`,
/// `MaybeAuth`), or a trailing one of [`SOFT_TAILS`] (`*_optional`, `*_or_none`). A soft
/// word elsewhere, or on something else (`verify_public_key`, `public_key_auth`,
/// `optional_scopes_user`), says nothing.
fn soft_name(id: &str) -> bool {
    let name = id.rsplit('#').next().unwrap_or(id);
    let name = name.rsplit('.').next().unwrap_or(name);
    let words = name_words(name);
    let rest = match words.as_slice() {
        [get, rest @ ..] if get == "get" => rest,
        all => all,
    };
    let soft_lead = match rest {
        [lead, after @ ..] if SOFT_LEADS.contains(&lead.as_str()) => after
            .iter()
            .find(|w| !PRINCIPAL_PREFIXES.contains(&w.as_str()))
            .is_some_and(|w| PRINCIPALS.contains(&w.as_str())),
        _ => false,
    };
    soft_lead
        || SOFT_TAILS.iter().any(|t| {
            words.len() > t.len()
                && words[words.len() - t.len()..]
                    .iter()
                    .zip(*t)
                    .all(|(w, t)| w == t)
        })
}

/// Parameter names of `fastapi.security` classes that take `auto_error` positionally.
const FASTAPI_SECURITY_PARAMS: &[(&str, &[&str])] = &[
    (
        "OAuth2PasswordBearer",
        &[
            "tokenUrl",
            "scheme_name",
            "scopes",
            "description",
            "auto_error",
        ],
    ),
    (
        "OAuth2AuthorizationCodeBearer",
        &[
            "authorizationUrl",
            "tokenUrl",
            "refreshUrl",
            "scheme_name",
            "scopes",
            "description",
            "auto_error",
        ],
    ),
];

/// What positional arguments of a call to a callee bind to.
enum Params {
    /// Positional parameter names in order (more arguments go to `*args`, or fail).
    Known { names: Vec<String> },
    /// An in-repo callee whose parameters the code does not show (a dataclass, a class
    /// built on a package base without an `__init__` of its own).
    Unknown,
    /// A package callee, or a symbol that is no function or class: not read.
    External,
}

/// A resolved FastAPI dependency: the wrap it adds (`id`) and the `fn_deps` entry that
/// holds what it depends on in turn (`key`: the function, the class's `__init__` for
/// `Depends(Class)`, `Class.__call__` for an instance; none for a soft instance).
/// `optional` when the parameter that takes it may be `None` ([`RawDep::Optional`]).
#[derive(Debug, Clone)]
struct Dep {
    id: String,
    key: Option<String>,
    optional: bool,
    /// How it is written where it is a call (`(auto_error=False)` for
    /// `Depends(HTTPBearer(auto_error=False))`, and for a module-level instance
    /// built so), for [`drift_core::controls::SHAPE`]; empty for a name. No part
    /// of what the dependency is: two that differ in this alone are one.
    shape: String,
}

impl PartialEq for Dep {
    fn eq(&self, other: &Self) -> bool {
        (&self.id, &self.key, self.optional) == (&other.id, &other.key, other.optional)
    }
}

impl Eq for Dep {}

impl PartialOrd for Dep {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Dep {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (&self.id, &self.key, self.optional).cmp(&(&other.id, &other.key, other.optional))
    }
}

impl Dep {
    /// A wrap that is no dependency (a Flask hook), looked up as before.
    fn plain(id: String) -> Self {
        Self {
            key: Some(id.clone()),
            id,
            optional: false,
            shape: String::new(),
        }
    }
}

const HTTP_VERBS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "options", "head", "trace",
];

/// Router, app and queue classes, by canonical id.
/// Django's application objects are made by these.
const DJANGO_APPS: &[&str] = &[
    "pkg:django#core.wsgi.get_wsgi_application",
    "pkg:django#core.asgi.get_asgi_application",
];

/// Constructor options of `FastAPI()` that do nothing to where its routes are
/// served. The list to extend: any other option makes the application one Drift
/// does not fully know. Not on it, on purpose: `root_path`, `openapi_prefix`,
/// `routes`, `middleware`.
const APP_KEYWORDS: &[&str] = &[
    "title",
    "summary",
    "description",
    "version",
    "docs_url",
    "redoc_url",
    "openapi_url",
    "openapi_tags",
    "servers",
    "lifespan",
    "debug",
    "default_response_class",
    "dependencies",
    "exception_handlers",
    "on_startup",
    "on_shutdown",
    "terms_of_service",
    "contact",
    "license_info",
    "responses",
    "swagger_ui_parameters",
    "swagger_ui_oauth2_redirect_url",
    "swagger_ui_init_oauth",
    "generate_unique_id_function",
    "separate_input_output_schemas",
    "redirect_slashes",
    "deprecated",
    "include_in_schema",
];

/// The same for `Flask()`, whose `root_path` is a directory on disk. Not on it:
/// `static_host`, `host_matching`, `subdomain_matching`.
const FLASK_KEYWORDS: &[&str] = &[
    "import_name",
    "static_url_path",
    "static_folder",
    "template_folder",
    "instance_path",
    "instance_relative_config",
    "root_path",
];

/// Attributes of an application that have nothing to do with where its routes are
/// served: reading or assigning one is not the application handed on. The list to
/// extend. Not on it, on purpose: `root_path`, `router`, `routes`, `wsgi_app`,
/// `user_middleware`, `middleware_stack`.
const APP_ATTRIBUTES: &[&str] = &[
    "state",
    "openapi_schema",
    "openapi",
    "title",
    "version",
    "description",
    "dependency_overrides",
    "debug",
    "logger",
    "config",
    "extensions",
    "json",
    "jinja_env",
    "secret_key",
    "name",
];

/// Middleware classes (package, class) that leave the path of a request alone. The
/// list to extend: any other class given to `add_middleware` makes the application
/// one Drift does not fully know.
const MIDDLEWARE: &[(&str, &str)] = &[
    ("fastapi", "CORSMiddleware"),
    ("starlette", "CORSMiddleware"),
    ("fastapi", "GZipMiddleware"),
    ("starlette", "GZipMiddleware"),
    ("fastapi", "TrustedHostMiddleware"),
    ("starlette", "TrustedHostMiddleware"),
    ("fastapi", "HTTPSRedirectMiddleware"),
    ("starlette", "HTTPSRedirectMiddleware"),
    ("starlette", "SessionMiddleware"),
];

/// What a middleware function may read on its request and still be known to leave
/// the path alone. Not on it, on purpose: `scope`, `app`.
const REQUEST_ATTRIBUTES: &[&str] = &[
    "headers",
    "method",
    "url",
    "client",
    "cookies",
    "query_params",
    "state",
    "base_url",
];

/// Prefixes of the `MIDDLEWARE` entries of a Django project that leave the path of
/// a request alone. The list to extend.
const DJANGO_MIDDLEWARE: &[&str] = &["django.", "corsheaders.", "whitenoise."];

const ROUTER_CLASSES: &[(&str, &str)] = &[
    ("pkg:fastapi#FastAPI", "fastapi"),
    ("pkg:fastapi#APIRouter", "fastapi"),
    ("pkg:fastapi#routing.APIRouter", "fastapi"),
    ("pkg:fastapi#applications.FastAPI", "fastapi"),
    ("pkg:flask#Flask", "flask"),
    ("pkg:flask#Blueprint", "flask"),
    ("pkg:flask#app.Flask", "flask"),
    ("pkg:flask#blueprints.Blueprint", "flask"),
    ("pkg:flask_smorest#Blueprint", "flask"),
    ("pkg:apiflask#APIFlask", "flask"),
    ("pkg:apiflask#APIBlueprint", "flask"),
    ("pkg:flask_restx#Namespace", "flask_restx"),
    ("pkg:flask_restplus#Namespace", "flask_restx"),
    ("pkg:flask_restx#Api", "flask_restx"),
    ("pkg:flask_restplus#Api", "flask_restx"),
    ("pkg:flask_restful#Api", "flask_restx"),
    ("pkg:celery#Celery", "celery"),
    ("pkg:rest_framework#routers.DefaultRouter", "drf_router"),
    ("pkg:rest_framework#routers.SimpleRouter", "drf_router"),
    ("pkg:django#contrib.admin.AdminSite", "django_admin"),
    ("pkg:django#contrib.admin.sites.AdminSite", "django_admin"),
];

/// Class names recognised when the constructor cannot be followed, e.g. a factory that
/// returns a subclass (`APIRouter = get_api_router_class(...)`).
const ROUTER_NAMES: &[(&str, &str)] = &[
    ("FastAPI", "fastapi"),
    ("APIRouter", "fastapi"),
    ("Flask", "flask"),
    ("Blueprint", "flask"),
    ("Celery", "celery"),
    ("DefaultRouter", "drf_router"),
    ("SimpleRouter", "drf_router"),
    ("AdminSite", "django_admin"),
];

#[derive(Debug, Clone)]
pub struct LoweredFile {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub hash: String,
    pub raw: RawFile,
}

#[derive(Debug, Clone)]
struct RouterInfo {
    adapter: String,
    prefix: String,
    deps: Vec<Dep>,
    /// A Flask app (not a blueprint): its hooks run before every request.
    app: bool,
    /// An application (`FastAPI()`, `Flask()`), which serves its routes at their own
    /// paths, not a router or blueprint, which serves nothing until it is mounted.
    root: bool,
}

impl RouterInfo {
    /// An application, router or blueprint of a web framework (not a Celery app, a
    /// DRF router).
    fn web(&self) -> bool {
        matches!(self.adapter.as_str(), "fastapi" | "flask" | "flask_restx")
    }
}

/// Facts a file's symbols get from elsewhere: routes registered in other files,
/// inherited guards.
#[derive(Debug, Default, Clone, PartialEq)]
struct Extra {
    entries: Vec<EntryPoint>,
    /// symbol -> wraps to prepend (outermost first)
    wraps: BTreeMap<String, Vec<Wrap>>,
    /// symbol -> extra args
    args: BTreeMap<String, Vec<String>>,
    /// symbols whose route decorator was not a route after all: plain decorators
    fallback: BTreeMap<String, Vec<(u32, String)>>,
    /// symbol -> guards applied by settings (outermost of all)
    config: BTreeMap<String, Vec<Wrap>>,
    /// symbol -> how its dependencies, and those of every router and mount on the
    /// way to it, are written ([`Linker::dep_shapes`]).
    shapes: BTreeMap<String, BTreeSet<String>>,
    /// symbol -> how many of its decorators stand above every route decorator it
    /// has ([`RawRoute::above`]); set since the measured build.
    above: BTreeMap<String, (u32, u32)>,
    /// What one mount adds to an entry point that its other mounts do not all add.
    mounts: Vec<drift_core::MountFacts>,
    /// Each route decorator or registration that reached a symbol: the symbol,
    /// whether it is the entry point's (not the class of a view's handlers), the
    /// routes it is served on, and the hooks and guards it gave the symbol
    /// ([`Linker::split_routes`]).
    routed: Vec<(String, bool, Vec<String>, Vec<Wrap>)>,
}

/// The link of this symbol itself reads what the measured build did not
/// ([`Linker::links_differently`]): a decorator that is no name.
fn symbol_unmeasured(s: &RawSymbol) -> bool {
    !s.since_wraps.is_empty()
        || !s.since_sinks.is_empty()
        || s.members.iter().any(|m| !m.since_sinks.is_empty())
        || s.drf_reassigned.is_some()
        || !s.wraps_only.is_empty()
        || !s.since_only.is_empty()
        || s.body_checks.iter().any(|b| b.since || b.measured)
        || s.members
            .iter()
            .any(|m| m.body_checks.iter().any(|b| b.since || b.measured))
        || s.controls.iter().any(|c| c == UNREAD_EXIT_MEASURED)
        || s.members
            .iter()
            .any(|m| m.unread.iter().any(|c| c == UNREAD_EXIT_MEASURED))
        || s.controls.iter().any(|c| marked_by_reading(c))
        || s.fed_sinks.iter().any(|c| marked_by_reading(c))
        || s.members.iter().any(|m| {
            m.unread.iter().any(|c| marked_by_reading(c))
                || m.fed_sinks.iter().any(|c| marked_by_reading(c))
        })
}

/// A fact the lowering wrote for one of the two readings only
/// ([`crate::raw::SINCE`], [`crate::raw::MEASURED`]).
fn marked_by_reading(fact: &str) -> bool {
    fact.starts_with(crate::raw::SINCE) || fact.starts_with(crate::raw::MEASURED)
}

/// The kind of a body's [`RawSymbol::fed_sinks`] entry as a
/// [`drift_core::controls::SINK_FED`] control, its reading's mark kept in front
/// ([`Linker::since_marked`] reads it off).
fn fed_control(kind: &str) -> String {
    let sink_fed = drift_core::controls::SINK_FED;
    match kind.strip_prefix(crate::raw::SINCE) {
        Some(k) => format!("{}{sink_fed}{k}", crate::raw::SINCE),
        None => format!("{sink_fed}{kind}"),
    }
}

/// Packages whose view classes apply the list `decorators` (Flask's `View`) or
/// `method_decorators` (Flask-RESTful's and Flask-RESTX's `Resource`) to their
/// handlers ([`RawSymbol::view_decorators`]).
const FLASK_VIEW_PACKAGES: &[&str] = &[
    "pkg:flask#",
    "pkg:flask_restful#",
    "pkg:flask_restx#",
    "pkg:flask_restplus#",
    "pkg:flask_smorest#",
    "pkg:flask_classful#",
];

/// Packages whose functions and classes, handed an application, register no hook
/// that turns a caller away (servers, test clients, instrumentation, extensions
/// that add no request guard of their own): an application passed to one is still
/// read in full. The list to extend: passed to anything else of a package, the
/// application may have a guard Drift did not see ([`Linker::unread`]).
const REGISTERS_NO_GUARD: &[&str] = &[
    "uvicorn",
    "hypercorn",
    "gunicorn",
    "waitress",
    "mangum",
    "a2wsgi",
    "asgiref",
    "httpx",
    "asgi_lifespan",
    "starlette#TestClient",
    "starlette#testclient.TestClient",
    "fastapi#TestClient",
    "fastapi#testclient.TestClient",
    "flask_cors",
    "flask_sqlalchemy",
    "flask_migrate",
    "flask_marshmallow",
    "flask_caching",
    "flask_compress",
    "flask_mail",
    "flask_babel",
    "flask_bcrypt",
    "flask_session",
    "flask_socketio",
    "flask_limiter",
    "flask_talisman",
    "flask_wtf",
    "flask_login",
    "flask_jwt_extended",
    "flask_restx",
    "flask_restful",
    "flask_smorest",
    "flasgger",
    "socketio",
    "slowapi",
    "fastapi_pagination",
    "prometheus_fastapi_instrumentator",
    "prometheus_flask_exporter",
    "opentelemetry",
    "sentry_sdk",
    "logfire",
    "ddtrace",
    "celery",
    "whitenoise",
];

/// Attributes of an application that register nothing a request passes through,
/// beyond [`APP_ATTRIBUTES`]: reading or assigning one does not make the application
/// one whose hooks are not all read ([`Linker::unread`]). The list to extend.
const NO_GUARD_ATTRIBUTES: &[&str] = &[
    "cli",
    "url_map",
    "json_encoder",
    "json_decoder",
    "json_provider_class",
    "testing",
    "env",
    "instance_path",
    "root_path",
    "import_name",
    "static_folder",
    "static_url_path",
    "template_folder",
    "permanent_session_lifetime",
    "routes",
    "docs_url",
    "redoc_url",
    "openapi_url",
    "servers",
];

/// Starlette's application class ([`Linker::build_adapter_tables`]).
const STARLETTE_APPS: &[&str] = &[
    "pkg:starlette#applications.Starlette",
    "pkg:starlette#Starlette",
];

/// Starlette's router class: a route table that is served where it is mounted
/// ([`Linker::build_adapter_tables`]).
const STARLETTE_ROUTERS: &[&str] = &["pkg:starlette#routing.Router"];

/// Marks an application middleware among the hooks of a node, until the symbol's
/// facts are written ([`drift_core::Symbol::app_middleware`]).
const EVERY_MIDDLEWARE: &str = "mw:";
/// The same of a middleware that only some of the applications serving the route at
/// one path have (the service's own and a test's, built on the same router).
const SOME_MIDDLEWARE: &str = "mw?:";

/// The middleware a hook stands for, as [`drift_core::Symbol::app_middleware`] writes
/// it: canonical, after `?` for one that only some of the applications have.
fn middleware_of(hook: &str) -> Option<String> {
    hook.strip_prefix(EVERY_MIDDLEWARE)
        .map(str::to_string)
        .or_else(|| hook.strip_prefix(SOME_MIDDLEWARE).map(|m| format!("?{m}")))
}

/// A mount parent: (parent node, prefix given at the mount, deps added at the mount,
/// whether what the mount adds could not all be read, the middleware given at the
/// mount, as hooks are written).
type Parent = (String, Option<String>, Vec<Dep>, bool, Vec<String>);

/// How many mounts of one router or URLconf get an entry point each
/// ([`Linker::chains`]).
const MAX_MOUNTS: usize = 16;

/// One way a router or URLconf is served: through one mount of it, one of what
/// mounts that, up to a root ([`Linker::chains`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Chain {
    /// The full path prefix.
    prefix: String,
    /// The guards inherited on the way, outermost first.
    guards: Vec<Dep>,
    /// The app-wide hooks (Flask hooks that run before every request of the app).
    hooks: Vec<String>,
    /// What a mount on the way adds could not all be read.
    opaque: bool,
}

/// What the chains of one router come to for one of its routes: the routes it is
/// served on, the guards and hooks every chain gives it (the handler's own), and
/// for each route what its chain adds to those.
struct Served {
    routes: Vec<String>,
    guards: Vec<Dep>,
    hooks: Vec<String>,
    /// Per route: (guards, hooks, opaque) beyond the common ones.
    adds: Vec<(Vec<Dep>, Vec<String>, bool)>,
}

impl Served {
    fn of(chains: &[Chain], route: impl Fn(&Chain) -> String) -> Served {
        let first = chains.first();
        let in_all = |has: &dyn Fn(&Chain) -> bool| chains.iter().all(has);
        let guards: Vec<Dep> = first
            .into_iter()
            .flat_map(|c| &c.guards)
            .filter(|g| in_all(&|c| c.guards.contains(g)))
            .cloned()
            .collect();
        let hooks: Vec<String> = first
            .into_iter()
            .flat_map(|c| &c.hooks)
            .filter(|h| in_all(&|c| c.hooks.contains(h)))
            .cloned()
            .collect();
        let adds = chains
            .iter()
            .map(|c| {
                (
                    c.guards
                        .iter()
                        .filter(|g| !guards.contains(g))
                        .cloned()
                        .collect(),
                    c.hooks
                        .iter()
                        .filter(|h| !hooks.contains(h))
                        .cloned()
                        .collect(),
                    c.opaque,
                )
            })
            .collect();
        Served {
            routes: chains.iter().map(route).collect(),
            guards,
            hooks,
            adds,
        }
    }
}

pub struct Linker<'r> {
    res: &'r Resolver,
    files: &'r [LoweredFile],
    index: BTreeMap<String, usize>,
    specs: Vec<BTreeMap<String, String>>,
    bindings: Vec<BTreeMap<String, RawBinding>>,
    routers: BTreeMap<String, RouterInfo>,
    parents: BTreeMap<String, BTreeSet<Parent>>,
    hooks: BTreeMap<String, Vec<String>>,
    dep_aliases: BTreeMap<String, Vec<Dep>>,
    /// What a dependency depends on in turn, by [`Dep::key`], without the soft ones
    /// ([`Dep::optional`]).
    fn_deps: BTreeMap<String, Vec<Dep>>,
    /// Module-level instance -> its class (`file#_read` -> `auth.py#Authenticator`).
    instances: BTreeMap<String, String>,
    /// Module-level instances built soft (`HTTPBearer(auto_error=False)`).
    soft_instances: BTreeSet<String>,
    /// How each module-level instance was built ([`SoftArgs::shape`]).
    instance_shapes: BTreeMap<String, String>,
    /// Module-level names bound once to the call of a function of the repository
    /// (`caller_dependency = auth_dependency()`): the function and how it is
    /// called. As a FastAPI dependency such a name is what the factory hands
    /// back, with the dependencies of the function it returns
    /// ([`RawSymbol::call_deps`]). Read since the measured build.
    factory_values: BTreeMap<String, (String, String)>,
    /// The attributes of a request-scoped holder (`pkg:flask#g.venue_id`) some body
    /// of the repository binds a value of the caller on
    /// ([`RawSymbol::caller_args`] with the holder as the callee).
    held: BTreeSet<String>,
    /// The dependencies code of the repository outside its tests replaces in a
    /// FastAPI application ([`RawFile::dependency_overrides`]), canonical; `"*"`
    /// where the key of one is not a reference, which may be any of them.
    overridden: BTreeSet<String>,
    /// The `async def` functions and methods of the repository, canonical.
    async_defs: BTreeSet<String>,
    /// The functions, methods and classes of the repository that are not `async`,
    /// canonical: a call of one whose value is dropped ran to its end.
    sync_defs: BTreeSet<String>,
    extra: BTreeMap<String, Extra>,
    /// Django settings: URL roots and global guards.
    django: config::Django,
    /// A helper's app parameter -> the factory locals passed to it
    /// (`init.py#init_hooks.app` -> `app.py#create_app.app`, `app.py#create_admin.app`).
    alias: BTreeMap<String, BTreeSet<String>>,
    /// Hooks that run before every request of an app (`before_app_request`).
    app_hooks: BTreeMap<String, Vec<String>>,
    /// URLconfs with an include Drift cannot follow.
    open_urlconfs: BTreeSet<String>,
    /// Routers, apps and pattern lists that are handed on somewhere Drift reads no
    /// mount of ([`RawFile::router_uses`], outside tests): each may be mounted there.
    handed_on: BTreeMap<String, String>,
    /// [`Linker::handed_on`] and [`Linker::mounts_unseen`] were given, the first
    /// link's ([`Linker::measured`]), not built.
    handed_given: bool,
    /// Building [`Linker::handed_on`] met a reference to another module's
    /// `urlpatterns`, which the two links read differently ([`Linker::node_of`]).
    handed_differs: bool,
    /// How many references to a module's `urlpatterns` [`Linker::node_of`] met.
    urlpatterns_met: std::sync::atomic::AtomicUsize,
    /// Applications and blueprints that went where Drift does not read what was
    /// registered on them, each with how ([`drift_core::APP_UNREAD`]): passed to a
    /// function of a package that is not known to register nothing
    /// ([`REGISTERS_NO_GUARD`]) or that is not found, an attribute or a method Drift
    /// does not know used on it (`app.before_request_funcs`), read as a value in
    /// another file, or built by a class of the repository with its own
    /// constructor.
    unread: BTreeMap<String, String>,
    /// Applications handed to a function or a class of the repository whose result
    /// is what is served in their place (`app = TokenMiddleware(app)`,
    /// `uvicorn.run(require_signature(app))`), each with those wrappers: read as
    /// middleware of the application, which is the guard where its body answers
    /// "not signed in" for every request ([`Linker::read_passes`]).
    wrapped: BTreeMap<String, Vec<String>>,
    /// What Django's application object is served through
    /// ([`Linker::django_wrappers`]).
    django_served: Vec<String>,
    /// A module-level name bound to what a function returns (`admin =
    /// make_app("admin")`) -> what the nodes of that function's locals start with
    /// (`app.py#make_app.`).
    results: BTreeMap<String, String>,
    /// module -> the application objects it builds ([`drift_core::AppFacts`]).
    apps: BTreeMap<String, Vec<drift_core::AppFacts>>,
    /// Import roots with a file that imports modules by a computed name, or with
    /// more references than are kept ([`RawFile::uses_all`]): any router under one
    /// may be mounted from it.
    mounts_unseen: BTreeSet<String>,
    /// Import roots (repo-relative directories) with a mount of an application Drift
    /// could not name ([`MountTarget::Unfollowed`]): no application under one is
    /// known to be served at its own paths only.
    unfollowed: BTreeSet<String>,
    /// What error handlers registered elsewhere handle, by handler (`module#name`):
    /// `add_exception_handler(X, h)`, DRF's `EXCEPTION_HANDLER` setting.
    handles: BTreeMap<String, BTreeSet<String>>,
    /// Link as the last build whose mined proposals were measured did: without the
    /// listings made since ([`Linker::measured`]).
    measured: bool,
    /// A listing made since was met ([`Linker::lists_unmeasured`]).
    unmeasured: std::sync::atomic::AtomicBool,
    /// Entry points declared outside Python code (console scripts, `langgraph.json`),
    /// by file ([`Linker::with_declared`]).
    declared: BTreeMap<String, Vec<EntryPoint>>,
    track: Option<Track>,
}

/// For linking one file against a subset of the repo ([`Linker::tracking`]): the
/// in-repo modules the link looked for and did not have.
struct Track {
    target: String,
    misses: Mutex<BTreeSet<String>>,
}

/// The reference a dependency names, through [`RawDep::Optional`].
fn dep_ref(d: &RawDep, r: &mut impl FnMut(&RawRef)) {
    match d {
        RawDep::Direct(x) | RawDep::Alias(x) | RawDep::Instance(x, _) | RawDep::Gives(x) => r(x),
        RawDep::Optional(d) => dep_ref(d, r),
        RawDep::Unread(_) => {}
    }
}

/// Every specifier a raw file refers to.
fn specs_in(raw: &RawFile) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut r = |x: &RawRef| {
        if let RawBase::Import { spec, .. } = &x.base {
            out.insert(spec.clone());
        }
    };
    for s in &raw.symbols {
        s.wraps.iter().for_each(|(x, _)| r(x));
        s.calls.iter().for_each(&mut r);
        s.args.iter().for_each(|(x, _, _)| r(x));
        s.omits.iter().for_each(|(x, _, _)| r(x));
        s.declares
            .iter()
            .filter_map(|(_, x)| x.as_ref())
            .for_each(&mut r);
        s.throws.iter().for_each(&mut r);
        s.order.iter().for_each(&mut r);
        s.meta
            .iter()
            .filter_map(|(_, x)| x.as_ref())
            .for_each(&mut r);
        s.decorator_args.iter().for_each(|(d, a)| {
            r(d);
            r(a);
        });
        for d in s.deps.iter().chain(&s.call_deps) {
            dep_ref(d, &mut r);
        }
    }
    for (_, deps) in &raw.dep_aliases {
        for d in deps {
            dep_ref(d, &mut r);
        }
    }
    for rt in &raw.routes {
        r(&rt.receiver);
        for d in &rt.deps {
            dep_ref(d, &mut r);
        }
    }
    for rt in &raw.routers {
        for d in &rt.deps {
            dep_ref(d, &mut r);
        }
    }
    for m in &raw.mounts {
        if let Some(p) = &m.parent {
            r(p);
        }
        if let MountTarget::Ref(t) = &m.target {
            r(t);
        }
        for d in &m.deps {
            dep_ref(d, &mut r);
        }
    }
    for g in &raw.registrations {
        r(&g.target);
        if let Some(x) = &g.router {
            r(x);
        }
        g.guards.iter().for_each(&mut r);
    }
    for h in &raw.hooks {
        r(&h.router);
        r(&h.hook);
    }
    for i in &raw.imports {
        out.insert(i.spec.clone());
    }
    for (_, b) in &raw.bindings {
        if let RawBinding::Import { spec, .. } = b {
            out.insert(spec.clone());
        }
    }
    for s in &raw.star_imports {
        out.insert(s.clone());
    }
    for m in &raw.mounts {
        if let MountTarget::Module(s) = &m.target {
            out.insert(s.clone());
        }
    }
    out
}

/// Third-party and standard-library references are folded at the top-level module,
/// so every import style names an object the same way:
/// `pkg:rest_framework.viewsets#ModelViewSet` (from `from rest_framework.viewsets import
/// ModelViewSet`) and `pkg:rest_framework#viewsets.ModelViewSet` (from `from rest_framework
/// import viewsets`) are both `pkg:rest_framework#viewsets.ModelViewSet`; a module object
/// `pkg:os.path#*` is `pkg:python:os#path`. The dotted path stays, so
/// `pkg:django#db.models.Field` and `pkg:django#forms.Field` remain distinct.
pub fn fold_external(s: &str) -> String {
    let (marker, rest) = if let Some(r) = s.strip_prefix("pkg:python:") {
        ("pkg:python:", r)
    } else if let Some(r) = s.strip_prefix("pkg:") {
        ("pkg:", r)
    } else {
        return s.to_string();
    };
    let Some((module, name)) = rest.split_once('#') else {
        return s.to_string();
    };
    let Some((top, sub)) = module.split_once('.') else {
        return s.to_string();
    };
    if name == "*" {
        format!("{marker}{top}#{sub}")
    } else {
        format!("{marker}{top}#{sub}.{name}")
    }
}

/// A test file, as mining reads one (`drift_mine::roles::is_test_path`, its Python
/// part): `test_x.py`, `x_test.py`, `conftest.py`, `tests.py`, or a file below a
/// `tests/`, `test/`, `testing/` or `fixtures/` directory. Only such files keep the
/// requests and mocks they record.
fn is_test_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let file = lower.rsplit('/').next().unwrap_or(&lower);
    (file.starts_with("test_") && file.ends_with(".py"))
        || file.ends_with("_test.py")
        || file == "conftest.py"
        || file == "tests.py"
        || lower.rsplit_once('/').is_some_and(|(dir, _)| {
            dir.split('/')
                .any(|d| matches!(d, "tests" | "test" | "testing" | "fixtures" | "e2e"))
        })
}

/// Join route segments into `/a/b/{c}`, collapsing duplicate slashes.
/// The symbol a canonical reference names: `module#Name`, member paths and calls cut.
fn symbol_of(canonical: &str) -> String {
    match canonical.split_once('#') {
        Some((module, rest)) => {
            let name = rest.split(['.', '(']).next().unwrap_or(rest);
            format!("{module}#{name}")
        }
        None => canonical.to_string(),
    }
}

pub fn join_path(parts: &[&str]) -> String {
    let segs: Vec<&str> = parts
        .iter()
        .flat_map(|p| p.split('/'))
        .filter(|s| !s.is_empty())
        .collect();
    format!("/{}", segs.join("/"))
}

/// The parameters a route template names, each with its converter, as the template
/// writes them: `<uuid:pk>` and Flask's `<int:id>` (`<id>` takes the default,
/// `string`), Starlette's `{id:int}` (`{id}`: `str`). A regex group
/// (`(?P<pk>\d+)`) is no converter: not listed.
fn route_converters(route: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (open, close, default) in [('<', '>', "string"), ('{', '}', "str")] {
        let mut rest = route;
        while let Some(i) = rest.find(open) {
            let after = &rest[i + open.len_utf8()..];
            let Some(j) = after.find(close) else { break };
            let inner = &after[..j];
            // `(?P<pk>...)`: the group's name, not a converter.
            let regex = open == '<' && rest[..i].ends_with("?P");
            if !regex && !inner.is_empty() {
                let (name, conv) = match (open, inner.split_once(':')) {
                    ('<', Some((conv, name))) => (name, conv),
                    ('{', Some((name, conv))) => (name, conv),
                    _ => (inner, default),
                };
                out.push((name.trim().to_string(), conv.trim().to_string()));
            }
            rest = &after[j + close.len_utf8()..];
        }
    }
    out
}

/// A route converter that parses its segment rather than taking any text of it:
/// one the framework itself defines with a pattern that a value can fail (Django's
/// `int`, `slug` and `uuid`; Werkzeug's `int`, `float`, `uuid` and `any`), a
/// converter's arguments aside (`int(min=1)`). The framework's own definitions, a
/// closed set: a converter the repository registers (`register_converter(Hex,
/// "hex")`, whose pattern may be `.+`) is code this does not read, and is not said
/// to parse (review R5, row 7). Before, every converter but `str`, `string` and
/// `path` was.
fn converter_parses(adapter: &str, conv: &str) -> bool {
    let name = conv.split('(').next().unwrap_or_default().trim();
    match adapter {
        "django" | "drf" => matches!(name, "int" | "slug" | "uuid"),
        "flask" | "flask_restx" => matches!(name, "int" | "float" | "uuid" | "any"),
        _ => false,
    }
}

impl<'r> Linker<'r> {
    pub fn new(res: &'r Resolver, files: &'r [LoweredFile]) -> Self {
        Self::build(res, files, None, false)
    }

    /// The same linker, linking what mining reads: without the listings of entry
    /// points made since the last build whose mined proposals were measured
    /// ([`drift_core::Listed`]). Each is one place where `measured` is asked or
    /// [`Linker::since_measured`] is called: a mount or registration the lowerer
    /// marks ([`RawMount::unmeasured`]), an include of another module's
    /// `urlpatterns`, the mount that is not read of a router handed on, and a class
    /// built by `__new__`. None when this link met none of them: it is then that
    /// link already.
    pub fn measured(&self) -> Option<Self> {
        if !self.lists_unmeasured() {
            return None;
        }
        let track = self.track.as_ref().map(|t| Track {
            target: t.target.clone(),
            misses: Mutex::new(BTreeSet::new()),
        });
        let tables = (
            self.index.clone(),
            self.specs.clone(),
            self.bindings.clone(),
        );
        // What is handed on where no mount is read is a matter of every reference
        // of the repository, and reads the same in both links but where one names
        // another module's `urlpatterns` ([`Linker::node_of`]): the first link's
        // table is the second's, which does not resolve them all again.
        let handed = (!self.handed_given && !self.handed_differs)
            .then(|| (self.handed_on.clone(), self.mounts_unseen.clone()));
        Some(
            Self::with_tables(self.res, self.files, track, true, tables, handed)
                .with_declared(self.declared.clone()),
        )
    }

    /// Whether `measured` ([`Linker::measured`]) may link file `fi` differently from
    /// this linker, so that it has to be linked again. A file's link asks the linker
    /// for three things that depend on which listings are read: what routes and
    /// registrations elsewhere give its symbols, its consumers, and what a call of a
    /// class built by `__new__` binds, which any file may make (`by_new`: some class
    /// of the repository is one).
    ///
    /// Not asked by the scan any more: it links every file again (review R5, row 1:
    /// a reading made since that this test did not know reached what mining reads).
    /// A test of it is a list of the readings made since, which the next one is
    /// missing from.
    pub fn links_differently(&self, measured: &Self, fi: usize, by_new: bool) -> bool {
        let rel = self.module_of(fi);
        by_new
            || self.extra.get(rel) != measured.extra.get(rel)
            || self.consumers(fi) != measured.consumers(fi)
            || self.files[fi].raw.symbols.iter().any(symbol_unmeasured)
            || (!self.overridden.is_empty()
                && self.files[fi].raw.symbols.iter().any(|s| {
                    self.overridden.contains("*")
                        || self.overridden.contains(&format!("{rel}#{}", s.name))
                }))
    }

    /// The sinks of a symbol or a method: those the measured build read, and, but
    /// when linking what mining reads, those read since
    /// ([`RawSymbol::since_sinks`]). Sorted.
    fn sinks_read(&self, measured: &[String], since: &[String]) -> Vec<String> {
        let mut out = measured.to_vec();
        if !since.is_empty() && self.since_measured() {
            out.extend(since.iter().cloned());
            out.sort();
            out.dedup();
        }
        out
    }

    /// Whether this link holds a check of a body: one read since the measured
    /// build is left out of what mining reads, and one that turns away the
    /// requests that have a caller is kept there only
    /// ([`RawBodyCheck::since`], [`RawBodyCheck::measured`]).
    fn reads_check(&self, b: &RawBodyCheck) -> bool {
        match b.since || b.measured {
            true => self.since_measured() != b.measured,
            false => true,
        }
    }

    /// An exit only the measured build left unread ([`UNREAD_EXIT_MEASURED`]):
    /// [`drift_core::controls::UNREAD_EXIT`] for what mining reads, where the
    /// controls do not hold it already, and nothing otherwise.
    fn measured_exits(&self, controls: &mut Vec<String>) {
        let Some(i) = controls.iter().position(|c| c == UNREAD_EXIT_MEASURED) else {
            return;
        };
        let unread = drift_core::controls::UNREAD_EXIT;
        match self.since_measured() || controls.iter().any(|c| c == unread) {
            true => {
                controls.remove(i);
            }
            false => controls[i] = unread.to_string(),
        }
    }

    /// The facts the lowering wrote for one reading only: what follows
    /// [`crate::raw::SINCE`] is kept for the listed reading and dropped from what
    /// mining reads, what follows [`crate::raw::MEASURED`] the other way round. The
    /// measured copy is then what the measured build wrote. Nothing is asked of the
    /// linker where no fact is marked.
    fn since_marked(&self, facts: &mut Vec<String>) {
        if !facts.iter().any(|f| marked_by_reading(f)) {
            return;
        }
        let since = self.since_measured();
        let mut out = Vec::with_capacity(facts.len());
        for f in facts.drain(..) {
            if let Some(rest) = f.strip_prefix(crate::raw::SINCE) {
                if since {
                    out.push(rest.to_string());
                }
            } else if let Some(rest) = f.strip_prefix(crate::raw::MEASURED) {
                if !since {
                    out.push(rest.to_string());
                }
            } else {
                out.push(f);
            }
        }
        *facts = out;
    }

    /// Whether the link so far met a listing the measured build did not make.
    pub fn lists_unmeasured(&self) -> bool {
        self.unmeasured.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Notes a listing the measured build did not make, and says whether to make
    /// it: not when linking what mining reads.
    fn since_measured(&self) -> bool {
        self.unmeasured
            .store(true, std::sync::atomic::Ordering::Relaxed);
        !self.measured
    }

    /// A linker over a subset of the repo that only links `target`, and records every
    /// in-repo module it looked up and did not have ([`Linker::misses`]): a file, or
    /// a file whose routers, dependency aliases, dependency functions or instances
    /// were asked for. `files` must be sorted by path and hold every file that
    /// mounts routers, registers views, adds hooks or configures the repo (see
    /// `index::is_global`), every file whose app passes may reach a hook helper (see
    /// `index::AppPasses`), and, when `target` defines Celery tasks and any file has a
    /// beat schedule, every file with a Celery task (see `index::defines_tasks`).
    ///
    /// Each table entry and file attribute comes from the file it names, so once
    /// every missed module that exists is added (a fixed point), every lookup gets
    /// the answer a full link gets, and `link(target)` equals the full scan's.
    /// Routes and registrations that only add facts to other files are skipped.
    pub fn tracking(res: &'r Resolver, files: &'r [LoweredFile], target: &str) -> Self {
        let track = Track {
            target: target.to_string(),
            misses: Mutex::new(BTreeSet::new()),
        };
        Self::build(res, files, Some(track), false)
    }

    /// Modules a [`Linker::tracking`] link looked up and did not have.
    pub fn misses(&self) -> BTreeSet<String> {
        self.track
            .as_ref()
            .and_then(|t| t.misses.lock().ok().map(|m| m.clone()))
            .unwrap_or_default()
    }

    /// Record a lookup of `key` (`module` or `module#name`) that found nothing.
    fn miss(&self, key: &str) {
        let Some(t) = &self.track else { return };
        let module = key.split('#').next().unwrap_or_default();
        if module.is_empty() || module.contains(':') {
            return;
        }
        if let Ok(mut m) = t.misses.lock() {
            m.insert(module.to_string());
        }
    }

    /// `v`, recording a miss of `key` when it is `None`.
    fn noted<T>(&self, key: &str, v: Option<T>) -> Option<T> {
        if v.is_none() {
            self.miss(key);
        }
        v
    }

    /// The index of the file for module id `module`.
    fn file(&self, module: &str) -> Option<usize> {
        self.noted(module, self.index.get(module).copied())
    }

    fn router_info(&self, node: &str) -> Option<&RouterInfo> {
        self.noted(node, self.routers.get(node))
    }

    /// True when, in a tracking link, facts for file `rel` are not needed (except what
    /// they add to repo-wide tables).
    fn untracked(&self, rel: &str) -> bool {
        self.track.as_ref().is_some_and(|t| t.target != rel)
    }

    fn build(
        res: &'r Resolver,
        files: &'r [LoweredFile],
        track: Option<Track>,
        measured: bool,
    ) -> Self {
        use rayon::prelude::*;
        let specs: Vec<BTreeMap<String, String>> = files
            .par_iter()
            .map(|f| {
                specs_in(&f.raw)
                    .into_iter()
                    .map(|s| {
                        let m = res.resolve(&f.abs_path, &s);
                        (s, m)
                    })
                    .collect()
            })
            .collect();
        let index = files
            .iter()
            .enumerate()
            .map(|(i, f)| (f.rel_path.clone(), i))
            .collect();
        let bindings = files
            .iter()
            .map(|f| f.raw.bindings.iter().cloned().collect())
            .collect();
        Self::with_tables(res, files, track, measured, (index, specs, bindings), None)
    }

    /// A linker over tables that are the same however the repository's listings are
    /// read (the file index, each file's resolved specifiers and bindings): built
    /// once, and shared by the second link ([`Linker::measured`]).
    #[allow(clippy::type_complexity)]
    fn with_tables(
        res: &'r Resolver,
        files: &'r [LoweredFile],
        track: Option<Track>,
        measured: bool,
        (index, specs, bindings): (
            BTreeMap<String, usize>,
            Vec<BTreeMap<String, String>>,
            Vec<BTreeMap<String, RawBinding>>,
        ),
        handed: Option<(BTreeMap<String, String>, BTreeSet<String>)>,
    ) -> Self {
        let handed_given = handed.is_some();
        let (handed_on, mounts_unseen) = handed.unwrap_or_default();
        let mut l = Self {
            res,
            files,
            index,
            specs,
            bindings,
            routers: BTreeMap::new(),
            parents: BTreeMap::new(),
            hooks: BTreeMap::new(),
            dep_aliases: BTreeMap::new(),
            fn_deps: BTreeMap::new(),
            instances: BTreeMap::new(),
            soft_instances: BTreeSet::new(),
            instance_shapes: BTreeMap::new(),
            factory_values: BTreeMap::new(),
            held: BTreeSet::new(),
            overridden: BTreeSet::new(),
            async_defs: BTreeSet::new(),
            sync_defs: BTreeSet::new(),
            extra: BTreeMap::new(),
            track,
            django: config::Django::default(),
            alias: BTreeMap::new(),
            app_hooks: BTreeMap::new(),
            open_urlconfs: BTreeSet::new(),
            unfollowed: BTreeSet::new(),
            handed_on,
            handed_given,
            handed_differs: false,
            urlpatterns_met: std::sync::atomic::AtomicUsize::new(0),
            unread: BTreeMap::new(),
            wrapped: BTreeMap::new(),
            django_served: Vec::new(),
            results: BTreeMap::new(),
            apps: BTreeMap::new(),
            mounts_unseen,
            handles: BTreeMap::new(),
            measured,
            unmeasured: std::sync::atomic::AtomicBool::new(false),
            declared: BTreeMap::new(),
        };
        l.build_adapter_tables();
        l.build_handles();
        l
    }

    /// Entry points declared outside Python code, by repo-relative file: console
    /// scripts (`[project.scripts]`) and graphs named in `langgraph.json`.
    pub fn with_declared(mut self, declared: BTreeMap<String, Vec<EntryPoint>>) -> Self {
        self.declared = declared;
        self
    }

    /// [`Linker::handles`] from every file's registrations.
    fn build_handles(&mut self) {
        let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (fi, f) in self.files.iter().enumerate() {
            for (what, h) in &f.raw.error_handlers {
                let target = symbol_of(&self.canon(fi, h));
                out.entry(target)
                    .or_default()
                    .insert(self.handled(fi, what));
            }
            if let Some(path) = f
                .raw
                .settings
                .drf
                .as_ref()
                .and_then(|d| d.exception_handler.as_deref())
                && let Some(c) = self.dotted_canon(fi, path)
            {
                out.entry(symbol_of(&c)).or_default().insert("*".into());
            }
        }
        self.handles = out;
    }

    fn handled(&self, fi: usize, h: &RawHandles) -> String {
        match h {
            RawHandles::Class(r) => self.canon(fi, r),
            RawHandles::Status(s) => format!("status:{s}"),
            RawHandles::Any => "*".into(),
        }
    }

    /// A check operand as [`drift_core::BodyCheck`] writes it.
    fn scoped_query(&self, fi: usize, q: &RawScoped) -> drift_core::ScopedQuery {
        drift_core::ScopedQuery {
            callee: q
                .callee
                .as_ref()
                .map(|r| self.canon(fi, r))
                .unwrap_or_default(),
            key: q.key.clone(),
            source: q.source,
            condition: q.condition.clone(),
        }
    }

    /// The rows a body reads as the controls write them
    /// ([`drift_core::controls::ROWS`]), of what resolves to something of the
    /// repository.
    fn rows(&self, fi: usize, rows: &[(RawRef, RawRows)]) -> BTreeSet<String> {
        let mine = |c: &str| {
            !c.starts_with("global#") && !c.starts_with("unresolved:") && !c.starts_with("pkg:")
        };
        rows.iter()
            .filter_map(|(model, by)| {
                let model = self.canon(fi, model);
                // A class of the repository: a value handed to a call
                // (`app.register_blueprint(bp)`) is no rows.
                if !mine(&model)
                    || !self
                        .symbol_at(&model)
                        .is_some_and(|(_, s)| s.kind == drift_core::SymbolKind::Class)
                {
                    return None;
                }
                let by = match by {
                    RawRows::Own(key, side, asked) => format!(
                        "own\t{key}\t{}{}",
                        self.side(fi, side),
                        match asked {
                            true => format!("\t{}", drift_core::controls::ROWS_ASKED),
                            false => String::new(),
                        }
                    ),
                    RawRows::From(refs) => format!(
                        "from\t{}",
                        refs.iter()
                            .map(|r| self.canon(fi, r))
                            .collect::<Vec<_>>()
                            .join("\t")
                    ),
                    RawRows::ByRole(side) => format!("any\trole\t{}", self.side(fi, side)),
                    RawRows::Any => "any".to_string(),
                };
                Some(format!("{}{model}\t{by}", drift_core::controls::ROWS))
            })
            .collect()
    }

    /// The sites of a body as the controls write them
    /// ([`drift_core::controls::HANDED_AFTER`]): one for each site, the callees
    /// that held there canonical and tab-separated; what resolves to nothing of the
    /// repository or of a package is left out.
    fn held(&self, fi: usize, sites: &[(RawHeld, Vec<RawRef>)]) -> BTreeSet<String> {
        sites
            .iter()
            .map(|(kind, refs)| {
                let held: BTreeSet<String> = refs
                    .iter()
                    .map(|r| self.canon(fi, r))
                    .filter(|c| !c.starts_with("global#") && !c.starts_with("unresolved:"))
                    .collect();
                format!(
                    "{}{}",
                    kind.control(),
                    held.into_iter().collect::<Vec<_>>().join("\t")
                )
            })
            .collect()
    }

    /// A side of a comparison or the value of a filter as
    /// [`drift_core::controls::SIDES`] writes it.
    fn side(&self, fi: usize, s: &RawSide) -> String {
        let param = |p: &str, at: &Option<u32>| match at {
            Some(i) => format!("param {p} #{i}"),
            None => format!("param {p}"),
        };
        let named = |word: &str, r: &RawRef| {
            let c = self.canon(fi, r);
            if c.starts_with("global#") || c.starts_with("unresolved:") {
                "unread".to_string()
            } else {
                format!("{word} {c}")
            }
        };
        match s {
            RawSide::Caller => "caller".into(),
            RawSide::Own(inner) => {
                // A name the file imports that says the caller: a class of the
                // repository is the class, whatever it is called; anything else
                // is the caller's, as the name says.
                if let RawSide::Value(r) = inner.as_ref() {
                    return match self.is_repo_class(&self.canon(fi, r)) {
                        true => self.side(fi, inner),
                        false => format!("{}caller", drift_core::controls::OWN_SIDE),
                    };
                }
                // Said only of what reads as a value of the caller here: a
                // parameter whose annotation names no dependency is the parameter.
                let side = self.side(fi, inner);
                match side.as_str() {
                    "caller" => format!("{}{side}", drift_core::controls::OWN_SIDE),
                    s if ["gives ", "via ", "call via "]
                        .iter()
                        .any(|p| s.starts_with(p)) =>
                    {
                        format!("{}{side}", drift_core::controls::OWN_SIDE)
                    }
                    _ => side,
                }
            }
            RawSide::Request => "request".into(),
            RawSide::Param(p, at) => param(p, at),
            RawSide::Annotated(d, p, at, called) => {
                match self.dep_canon(fi, d, false).into_iter().next() {
                    Some(dep) if *called => format!("call via {}", dep.id),
                    Some(dep) => format!("via {}", dep.id),
                    None => param(p, at),
                }
            }
            RawSide::Called(d) => match self.dep_canon(fi, d, false).into_iter().next() {
                Some(dep) => format!("call via {}", dep.id),
                None => "unread".into(),
            },
            RawSide::SelfAttr(a) => format!("self.{a}"),
            RawSide::Setting => "setting".into(),
            RawSide::Literal => "literal".into(),
            RawSide::Unread => "unread".into(),
            RawSide::Call(r) => named("call", r),
            RawSide::Value(r) => named("value", r),
            // A helper or a holder: under the name a reader looks it up by.
            RawSide::Gives(RawDep::Gives(r)) => {
                let c = self.canon(fi, r);
                if c.starts_with("unresolved:")
                    || (c.starts_with("global#")
                        && !drift_core::CALLER_HOLDERS.iter().any(|h| c.starts_with(h)))
                {
                    "unread".to_string()
                } else {
                    format!("gives {c}")
                }
            }
            RawSide::Gives(d) => match self.dep_canon(fi, d, false).into_iter().next() {
                Some(dep) => format!("via {}", dep.id),
                // An annotation that names no dependency: a parameter as any other.
                None if matches!(d, RawDep::Alias(_)) => "param".into(),
                None => "unread".into(),
            },
        }
    }

    /// [`drift_core::controls::SIDES`] and [`drift_core::controls::FILTER_VALUE`] of
    /// a function or a method, as its controls hold them.
    fn origins(
        &self,
        fi: usize,
        sides: &[RawCheckSides],
        values: &[RawFilterValue],
        args: &[(RawRef, Vec<(String, RawSide)>)],
        typed: &[RawRef],
    ) -> Vec<String> {
        let mut out: Vec<String> = sides
            .iter()
            .map(|c| {
                format!(
                    "{}{}\t{}\t{}\t{}\t{}",
                    drift_core::controls::SIDES,
                    self.operand(fi, &c.source, false),
                    c.reads,
                    self.operand(fi, &c.compares, true),
                    self.side(fi, &c.left),
                    self.side(fi, &c.right)
                )
            })
            .chain(values.iter().map(|v| {
                format!(
                    "{}{}\t{}\t{}",
                    drift_core::controls::FILTER_VALUE,
                    v.callee
                        .as_ref()
                        .map(|r| self.canon(fi, r))
                        .unwrap_or_default(),
                    v.key,
                    self.side(fi, &v.value)
                )
            }))
            .chain(args.iter().filter_map(|(raw, given)| {
                let callee = self.canon(fi, raw);
                // A package's or a built-in's call is no body a reader follows:
                // a package's is said apart, where it is made on a value an
                // annotation types and is handed anything.
                let prefix = match callee.as_str() {
                    c if c.starts_with("global#") => return None,
                    c if c.starts_with("pkg:") => {
                        if given.is_empty() || !typed.contains(raw) {
                            return None;
                        }
                        drift_core::controls::PKG_ARG_VALUE
                    }
                    _ => drift_core::controls::ARG_VALUE,
                };
                let mut out = format!("{prefix}{callee}");
                for (key, side) in given {
                    out.push_str(&format!("\t{key}\t{}", self.side(fi, side)));
                }
                Some(out)
            }))
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// [`drift_core::controls::ROW_SET`]: what each written attribute is read
    /// off, as a side names what a call handed back.
    fn row_sets(&self, fi: usize, sets: &[(RawRef, String)]) -> Vec<String> {
        sets.iter()
            .map(|(r, attr)| {
                format!(
                    "{}{}\t{attr}",
                    drift_core::controls::ROW_SET,
                    self.canon(fi, r)
                )
            })
            .collect()
    }

    /// [`drift_core::Symbol::caller_args`]: canonical, sorted, the built-ins left
    /// out; `<callee> via <dependency>` for a value of a dependency.
    fn caller_args(&self, fi: usize, calls: &[(RawRef, Option<RawDep>)]) -> Vec<String> {
        let mut out: Vec<String> = calls
            .iter()
            .map(|(r, d)| (self.canon(fi, r), d))
            // A request's state is no built-in: the holder a value is bound on.
            .filter(|(c, _)| {
                !c.starts_with("global#")
                    || drift_core::CALLER_HOLDERS.iter().any(|h| c.starts_with(h))
            })
            .filter_map(|(c, d)| match d {
                None => Some(c),
                // A dependency that stands for nothing here gives nothing.
                Some(d) => self.dep_canon(fi, d, false).into_iter().next().map(|dep| {
                    // Compared with what it gives: the giver as its own callee,
                    // under the one name a reader looks it up by.
                    let mut own = false;
                    dep_ref(d, &mut |r| own = self.canon(fi, r) == c);
                    let callee = if own { dep.id.as_str() } else { c.as_str() };
                    format!("{callee}{}{}", drift_core::CALLER_ARG_VIA, dep.id)
                }),
            })
            .collect();
        out.sort();
        out.dedup();
        out
    }

    /// Conditional calls as [`drift_core::Symbol::conditional_calls`] writes them: the
    /// repository's own only.
    ///
    /// The raw list holds every call with why it is conditional, empty for a call on
    /// every path: a callee with one such call is not listed.
    fn conditional_calls(&self, fi: usize, calls: &[(RawRef, String)]) -> Vec<String> {
        // A call that is not awaited is conditional only where what is called is an
        // `async def`: of anything else it is a call as any other.
        let every_path = String::new();
        let canon: Vec<(String, &String)> = calls
            .iter()
            .map(|(r, why)| {
                let c = self.canon(fi, r);
                // Of a function, a method or a class the files define and that is not
                // `async`, a dropped call ran to its end. Of anything else of the
                // repository (a method reached through a dependency alias or an
                // instance a function hands back) the linker does not say: the entry
                // is kept for a reader that resolves the callee
                // ([`drift_core::Symbol::is_async`]).
                let plain = why == drift_core::not_always::NOT_AWAITED
                    && !self.async_defs.contains(&c)
                    && (self.sync_defs.contains(&c)
                        || c.starts_with("local:")
                        || c.starts_with("param:"));
                (c, if plain { &every_path } else { why })
            })
            .collect();
        let always: BTreeSet<&String> = canon
            .iter()
            .filter(|(_, why)| why.is_empty())
            .map(|(c, _)| c)
            .collect();
        let mut seen = BTreeSet::new();
        canon
            .iter()
            .filter(|(c, why)| {
                let own = !(c.starts_with("pkg:")
                    || c.starts_with("global#")
                    || c.starts_with("unresolved:"));
                // A package's call is listed only where it is the check itself: a
                // policy library's.
                let policy = why.as_str() != drift_core::not_always::NOT_AWAITED
                    && drift_core::practice::policy_call(c);
                // And where its call is a guard or a verification by a closed list
                // of the reader ([`crate::lower::SHAPED_CALLS`]): that it runs for
                // some requests only is what the reader asks.
                let shaped = why.as_str() != drift_core::not_always::NOT_AWAITED
                    && c.starts_with("pkg:")
                    && !c.starts_with("pkg:python:")
                    && c.rsplit(['.', '#'])
                        .next()
                        .is_some_and(|n| crate::lower::SHAPED_CALLS.contains(&n));
                !why.is_empty()
                    && !always.contains(c)
                    && (own || policy || shaped)
                    && seen.insert(c)
            })
            .map(|(c, why)| format!("{why}:{c}"))
            .collect()
    }

    /// Receiver calls as [`drift_core::Symbol::receiver_calls`] writes them.
    fn receiver_calls(&self, fi: usize, calls: &[RawReceiverCall]) -> Vec<String> {
        calls
            .iter()
            .map(|c| match c {
                RawReceiverCall::Ref(r) => self.canon(fi, r),
                RawReceiverCall::Unread(label) => label.clone(),
            })
            // A method of what a package's or a built-in's call handed back is that
            // library's: nothing of the repository runs in it. Not so what the
            // application stored in a framework object's free-form place, nor what a
            // dynamic lookup handed back ([`drift_core::practice::unread_callee`]).
            .filter(|c| {
                !(c.starts_with("pkg:") || c.starts_with("global#") || c.starts_with("unresolved:"))
                    || drift_core::practice::unread_callee(c)
            })
            .collect()
    }

    fn raise_check(&self, fi: usize, c: &RawRaiseCheck) -> drift_core::RaiseCheck {
        drift_core::RaiseCheck {
            source: self.operand(fi, &c.source, false),
            reads: c.reads.clone(),
            compares: if c.unread_compare {
                drift_core::UNREAD_COMPARE.into()
            } else {
                self.operand(fi, &c.compares, true)
            },
            raises: self.canon(fi, &c.raises),
            status: c.status,
            op: c.op.clone(),
            conditional: c.conditional,
            condition: c.condition.clone(),
            unless: c.unless.clone(),
            after: self.after(fi, &c.after),
        }
    }

    /// [`drift_core::BodyCheck::after`]: what the function calls before a check,
    /// canonical, in order.
    fn after(&self, fi: usize, calls: &[RawReceiverCall]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for c in calls {
            let c = match c {
                RawReceiverCall::Ref(r) => self.canon(fi, r),
                RawReceiverCall::Unread(label) => label.clone(),
            };
            if !out.contains(&c) {
                out.push(c);
            }
        }
        out
    }

    fn operand(&self, fi: usize, op: &RawOperand, compare: bool) -> String {
        let call = |c: String| if compare { format!("call:{c}") } else { c };
        match op {
            RawOperand::None => String::new(),
            RawOperand::Literal => "literal".into(),
            RawOperand::Env => "env".into(),
            RawOperand::Param(n) => format!("param:{n}"),
            RawOperand::Header(h) => format!("header:{h}"),
            RawOperand::Ref(r) => {
                let c = self.canon(fi, r);
                if compare && self.env_derived(&c) {
                    "env".into()
                } else {
                    call(c)
                }
            }
            RawOperand::Dep(d, name) => match self.dep_canon(fi, d, false).into_iter().next() {
                Some(dep) => call(dep.id),
                None => format!("param:{name}"),
            },
        }
    }

    /// A reference to an env-derived secret: a module constant bound to an env read
    /// (`API_KEY = os.environ["API_KEY"]`, imported or not), or a secret-named attribute
    /// (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`) of Django's settings or of a module
    /// binding that reads env or is built by a pydantic `BaseSettings` class.
    fn env_derived(&self, canonical: &str) -> bool {
        let Some((module, rest)) = canonical.split_once('#') else {
            return false;
        };
        let mut parts = rest.split('.');
        let name = parts.next().unwrap_or_default();
        let last = rest
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let secret = ["KEY", "SECRET", "TOKEN", "PASSWORD"]
            .iter()
            .any(|w| last.contains(w));
        if module == "pkg:django" {
            return rest.starts_with("conf.settings.") && secret;
        }
        if module.contains(':') || rest.contains('(') {
            return false;
        }
        let Some(fi) = self.file(module) else {
            return false;
        };
        let Some(sym) = self.files[fi].raw.symbols.iter().find(|s| s.name == name) else {
            return false;
        };
        if !rest.contains('.') {
            return !sym.reads.is_empty();
        }
        if !secret {
            return false;
        }
        !sym.reads.is_empty()
            || sym.calls.iter().any(|r| {
                let c = self.canon(fi, r);
                let (cm, cn) = c.split_once('#').unwrap_or_default();
                !cm.contains(':')
                    && self.file(cm).is_some_and(|ci| {
                        self.files[ci].raw.symbols.iter().any(|s| {
                            s.name == cn
                                && s.wraps.iter().any(|(b, k)| {
                                    *k == WrapKind::Extends
                                        && self.canon(ci, b).ends_with("BaseSettings")
                                })
                        })
                    })
            })
    }

    /// The module a test mocks: a dotted path's longest in-repo module, or the
    /// top-level package of an external one (`pkg:requests`, `pkg:python:os`).
    fn mock_module(&self, fi: usize, m: &RawMock) -> Option<String> {
        let external = |id: &str| -> String {
            let (marker, rest) = match id.strip_prefix("pkg:python:") {
                Some(r) => ("pkg:python:", r),
                None => ("pkg:", id.strip_prefix("pkg:").unwrap_or(id)),
            };
            let top = rest.split(['.', '#']).next().unwrap_or(rest);
            format!("{marker}{top}")
        };
        match m {
            RawMock::Module(id) => Some(id.clone()),
            RawMock::Ref(r) => {
                let c = self.canon(fi, r);
                let module = c.split_once('#').map_or(c.as_str(), |(m, _)| m);
                if module == "global" || module.starts_with("unresolved:") {
                    None
                } else if module.contains(':') {
                    Some(external(module))
                } else {
                    Some(module.to_string())
                }
            }
            RawMock::Dotted(path) => {
                let segs: Vec<&str> = path.split('.').collect();
                let ident = |s: &&str| {
                    !s.is_empty()
                        && !s.starts_with(|c: char| c.is_ascii_digit())
                        && s.chars().all(|c| c.is_alphanumeric() || c == '_')
                };
                if segs.is_empty() || !segs.iter().all(ident) {
                    return None;
                }
                let abs = &self.files[fi].abs_path;
                for n in (1..=segs.len()).rev() {
                    let id = self.res.resolve(abs, &segs[..n].join("."));
                    if id.starts_with("unresolved:") {
                        continue;
                    }
                    return Some(if id.contains(':') { external(&id) } else { id });
                }
                None
            }
        }
    }

    /// `consumer` entry points of file `fi`'s classes: a subclass of kombu's
    /// `ConsumerMixin`, or of an in-repo queue-consumer base: a class that defines a
    /// `handle` / `consume` method and either is named for one (`QueueConsumer`,
    /// `BaseWorker`, `EventSubscriber`, `BaseRabbitMQConsumer`: an acronym is a word
    /// of its own) or uses a messaging library in its body (`aio_pika`, `pika`,
    /// `kombu`, a Kafka or NATS client). The adapter is that library, or `queue`.
    fn consumers(&self, fi: usize) -> Vec<EntryPoint> {
        const WORDS: &[&str] = &["consumer", "worker", "subscriber", "listener"];
        const METHODS: &[&str] = &[
            "consume",
            "handle",
            "handle_message",
            "on_message",
            "process_message",
        ];
        const LIBRARIES: &[&str] = &[
            "aio_pika",
            "aiokafka",
            "aiormq",
            "confluent_kafka",
            "faststream",
            "kafka",
            "kombu",
            "nats",
            "pika",
        ];
        // `RabbitMQConsumer` is `rabbit`, `mq`, `consumer`: the last capital of a run
        // of capitals starts the next word.
        let words = |name: &str| -> Vec<String> {
            let chars: Vec<char> = name.chars().collect();
            let mut spaced = String::new();
            for (i, c) in chars.iter().enumerate() {
                let acronym_end = i > 0
                    && c.is_uppercase()
                    && chars[i - 1].is_uppercase()
                    && chars.get(i + 1).is_some_and(|n| n.is_lowercase());
                if acronym_end {
                    spaced.push('_');
                }
                spaced.push(*c);
            }
            name_words(&spaced)
        };
        let mut out = Vec::new();
        for s in &self.files[fi].raw.symbols {
            if s.kind != drift_core::SymbolKind::Class || s.owner.is_some() {
                continue;
            }
            let mut adapter = None;
            for (r, k) in &s.wraps {
                if *k != WrapKind::Extends {
                    continue;
                }
                let c = self.canon(fi, r);
                if c == "pkg:kombu#mixins.ConsumerMixin" {
                    adapter = Some("kombu");
                    break;
                }
                let Some((module, name)) = c.split_once('#') else {
                    continue;
                };
                if module.contains(':') || name.contains('.') {
                    continue;
                }
                let Some(bi) = self.file(module) else {
                    continue;
                };
                let Some(base) = self.files[bi]
                    .raw
                    .symbols
                    .iter()
                    .find(|b| b.name == name && b.kind == drift_core::SymbolKind::Class)
                else {
                    continue;
                };
                if !base
                    .members
                    .iter()
                    .any(|m| METHODS.contains(&m.name.as_str()))
                {
                    continue;
                }
                // What the base's own body calls says what it consumes from.
                let library = base.calls.iter().find_map(|r| {
                    let c = self.canon(bi, r);
                    let package = c.strip_prefix("pkg:")?.split(['#', '.']).next()?;
                    LIBRARIES.iter().find(|l| **l == package).copied()
                });
                // The measured build listed a base named for a consumer by the plain
                // word split, as `queue`. One that uses a library, or is named with an
                // acronym, is a listing made since ([`Linker::measured`]).
                let named = |words: Vec<String>| words.iter().any(|w| WORDS.contains(&w.as_str()));
                let found = match library {
                    Some(l) if self.since_measured() => Some(l),
                    _ if named(name_words(name)) => Some("queue"),
                    _ if named(words(name)) && self.since_measured() => Some("queue"),
                    _ => None,
                };
                if found.is_some() {
                    adapter = found;
                    break;
                }
            }
            if let Some(a) = adapter {
                out.push(EntryPoint {
                    symbol: s.name.clone(),
                    kind: "consumer".into(),
                    method: None,
                    route: None,
                    adapter: a.into(),
                });
            }
        }
        out
    }

    fn module_of(&self, fi: usize) -> &str {
        &self.files[fi].rel_path
    }

    // ------------------------------------------------------------------ origins

    /// Canonical origin of attribute `name` of `module`.
    pub fn origin(&self, module: &str, name: &str) -> String {
        let mut seen = BTreeSet::new();
        self.origin_inner(module, name, 0, &mut seen)
    }

    fn origin_inner(
        &self,
        module: &str,
        name: &str,
        depth: usize,
        seen: &mut BTreeSet<(String, String)>,
    ) -> String {
        if depth > MAX_HOPS || !seen.insert((module.to_string(), name.to_string())) {
            return format!("{module}#{name}");
        }
        if module.contains(':') {
            return format!("{module}#{name}");
        }
        let Some(fi) = self.file(module) else {
            // Namespace package or an in-repo module that was not scanned.
            return match self.res.submodule(module, name) {
                Some(sub) => format!("{sub}#*"),
                None => format!("{module}#{name}"),
            };
        };
        match self.bindings[fi].get(name) {
            Some(RawBinding::Local) => format!("{module}#{name}"),
            Some(RawBinding::Import { spec, name: n, .. }) => {
                let target = self.specs[fi]
                    .get(spec)
                    .cloned()
                    .unwrap_or_else(|| format!("unresolved:{spec}"));
                if n == "*" {
                    return format!("{target}#*");
                }
                // `from . import sub` inside a package's `__init__` names its submodule.
                if target == module {
                    return match self.res.submodule(module, n) {
                        Some(sub) => format!("{sub}#*"),
                        None => format!("{module}#{name}"),
                    };
                }
                self.origin_inner(&target, n, depth + 1, seen)
            }
            None => {
                if let Some(sub) = self.res.submodule(module, name) {
                    return format!("{sub}#*");
                }
                let raw = &self.files[fi].raw;
                for spec in raw.star_imports.iter().rev() {
                    let Some(m) = self.specs[fi].get(spec) else {
                        continue;
                    };
                    if self.module_exports(m, name, depth + 1, &mut BTreeSet::new()) {
                        return self.origin_inner(m, name, depth + 1, seen);
                    }
                }
                format!("{module}#{name}")
            }
        }
    }

    /// True when `from module import *` brings `name` (in-repo modules only).
    fn module_exports(
        &self,
        module: &str,
        name: &str,
        depth: usize,
        seen: &mut BTreeSet<String>,
    ) -> bool {
        if depth > MAX_HOPS || !seen.insert(module.to_string()) {
            return false;
        }
        let Some(fi) = self.file(module) else {
            return false;
        };
        let raw = &self.files[fi].raw;
        if let Some(all) = &raw.all {
            return all.iter().any(|n| n == name);
        }
        if name.starts_with('_') {
            return false;
        }
        self.bindings[fi].contains_key(name)
            || raw.star_imports.iter().any(|s| {
                self.specs[fi]
                    .get(s)
                    .is_some_and(|m| self.module_exports(m, name, depth + 1, seen))
            })
    }

    /// Public names `from module import *` brings, for expanding star re-exports.
    fn star_names(
        &self,
        module: &str,
        depth: usize,
        seen: &mut BTreeSet<String>,
    ) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if depth > MAX_HOPS || !seen.insert(module.to_string()) {
            return out;
        }
        let Some(fi) = self.file(module) else {
            return out;
        };
        let raw = &self.files[fi].raw;
        if let Some(all) = &raw.all {
            out.extend(all.iter().cloned());
            return out;
        }
        out.extend(
            self.bindings[fi]
                .keys()
                .filter(|n| !n.starts_with('_'))
                .cloned(),
        );
        for s in &raw.star_imports {
            if let Some(m) = self.specs[fi].get(s) {
                out.extend(self.star_names(m, depth + 1, seen));
            }
        }
        out
    }

    /// Follow a member path through modules: `app#*` + `.core.config.settings`
    /// -> `app/core/config.py#settings`.
    fn walk_members(&self, mut start: String, member: &str) -> String {
        let mut rest = member;
        loop {
            let Some(module) = start.strip_suffix("#*") else {
                return format!("{start}{rest}");
            };
            let Some(after) = rest.strip_prefix('.') else {
                return format!("{start}{rest}");
            };
            let end = after.find(['.', '(']).unwrap_or(after.len());
            let seg = &after[..end];
            if module.contains(':') {
                // External module: the first member is the name (`pkg:os#path.join`).
                return format!("{module}#{after}");
            }
            start = self.origin(module, seg);
            rest = &after[end..];
        }
    }

    /// Canonical string for a raw reference in file `fi`.
    fn canon(&self, fi: usize, r: &RawRef) -> String {
        fold_external(&self.canon_unfolded(fi, r))
    }

    fn canon_unfolded(&self, fi: usize, r: &RawRef) -> String {
        let rel = self.module_of(fi);
        match &r.base {
            RawBase::Global(n) => format!("global#{n}{}", r.member),
            RawBase::Local(n) => format!("{rel}#{n}{}", r.member),
            RawBase::Star(n) => {
                let raw = &self.files[fi].raw;
                for spec in raw.star_imports.iter().rev() {
                    let Some(m) = self.specs[fi].get(spec) else {
                        continue;
                    };
                    if self.module_exports(m, n, 0, &mut BTreeSet::new()) {
                        return self.walk_members(self.origin(m, n), &r.member);
                    }
                }
                match raw
                    .star_imports
                    .iter()
                    .rev()
                    .filter_map(|s| self.specs[fi].get(s))
                    .find(|m| m.starts_with("pkg:"))
                {
                    Some(m) => format!("{m}#{n}{}", r.member),
                    None => format!("global#{n}{}", r.member),
                }
            }
            RawBase::Import { spec, name } => {
                let module = self.specs[fi]
                    .get(spec)
                    .cloned()
                    .unwrap_or_else(|| format!("unresolved:{spec}"));
                let start = if name == "*" {
                    format!("{module}#*")
                } else {
                    self.origin(&module, name)
                };
                self.walk_members(start, &r.member)
            }
        }
    }

    // ------------------------------------------------------------------ adapters

    /// The dependencies `d` stands for. In a `chain` (what a dependency depends on in
    /// turn) those its parameter may leave `None` are soft and not counted.
    fn dep_canon(&self, fi: usize, d: &RawDep, chain: bool) -> Vec<Dep> {
        let mut out = self.dep_items(fi, d);
        if chain {
            out.retain(|d| !d.optional);
        }
        out
    }

    fn dep_items(&self, fi: usize, d: &RawDep) -> Vec<Dep> {
        match d {
            // A configured instance (`_read = Authenticator(scopes=...)`) depends as its
            // class, like `Depends(Authenticator(scopes=...))` written inline, and runs
            // its class's `__call__`; one built soft stands for itself only.
            RawDep::Direct(r) => {
                let c = self.canon(fi, r);
                let dep = match self.noted(&c, self.instances.get(&c)) {
                    // The measured build took an instance built soft for no
                    // dependency of its class, by the names of its options. Since
                    // then it is its class as any instance is, written as it was
                    // built: a reader decides by the shape, never by a name.
                    Some(_) if self.soft_instances.contains(&c) && !self.since_measured() => Dep {
                        id: c,
                        key: None,
                        optional: false,
                        shape: String::new(),
                    },
                    Some(class) => Dep {
                        id: class.clone(),
                        key: Some(format!("{class}.__call__")),
                        optional: false,
                        shape: self.instance_shapes.get(&c).cloned().unwrap_or_default(),
                    },
                    // A name bound to what a factory of the repository hands back:
                    // the factory called, with what the function it returns
                    // depends on. The measured build read the name alone.
                    None => match self.factory_values.get(&c) {
                        Some((factory, shape)) if self.since_measured() => Dep {
                            id: factory.clone(),
                            key: Some(format!("{factory}.__call__")),
                            optional: false,
                            shape: shape.clone(),
                        },
                        _ => Dep::plain(c),
                    },
                };
                vec![dep]
            }
            RawDep::Instance(r, args) => {
                let c = self.canon(fi, r);
                if self.soft_call(&c, args) && !self.since_measured() {
                    return vec![];
                }
                vec![Dep {
                    key: Some(format!("{c}.__call__")),
                    id: c,
                    optional: false,
                    shape: args.shape.clone(),
                }]
            }
            RawDep::Alias(r) => {
                let c = self.canon(fi, r);
                self.noted(&c, self.dep_aliases.get(&c))
                    .cloned()
                    .unwrap_or_default()
            }
            RawDep::Optional(inner) => {
                let mut v = self.dep_items(fi, inner);
                for d in &mut v {
                    d.optional = true;
                }
                v
            }
            RawDep::Unread(words) => vec![Dep::plain(format!("unresolved:{words}"))],
            RawDep::Gives(r) => {
                let c = self.canon(fi, r);
                if self.gives(&c) {
                    vec![Dep::plain(c)]
                } else {
                    vec![]
                }
            }
        }
    }

    /// `c` may give a value of the caller ([`RawDep::Gives`]): a function of the
    /// repository whose body returns one
    /// ([`drift_core::controls::RETURNS_CALLER`]) or turns callers away (it may
    /// hand back who passed: a reader says), or an attribute of a request-scoped
    /// holder that some body of the repository binds a value of the caller on
    /// ([`Linker::held`]).
    fn gives(&self, c: &str) -> bool {
        use drift_core::controls::{HANDLER_REJECTS, REJECTS_CALLER, RETURNS_CALLER};
        self.held.contains(c)
            || self.symbol_at(c).is_some_and(|(_, s)| {
                s.kind == drift_core::SymbolKind::Function
                    && s.controls.iter().any(|x| {
                        [RETURNS_CALLER, REJECTS_CALLER, HANDLER_REJECTS].contains(&x.as_str())
                    })
            })
    }

    /// What positional arguments of a call to `callee` bind to: an in-repo function's
    /// parameters, an in-repo class's own `__init__`'s (without `self`) or, without
    /// one, its first base's; a `fastapi.security` class's.
    fn params_of(&self, callee: &str, depth: usize) -> Params {
        if depth > MAX_DEP_DEPTH {
            return Params::Unknown;
        }
        if let Some(rest) = callee.strip_prefix("pkg:fastapi#") {
            let last = rest.rsplit('.').next().unwrap_or(rest);
            return FASTAPI_SECURITY_PARAMS
                .iter()
                .find(|(c, _)| *c == last)
                .map_or(Params::External, |(_, ps)| Params::Known {
                    names: ps.iter().map(|p| p.to_string()).collect(),
                });
        }
        let Some((module, name)) = callee.split_once('#') else {
            return Params::External;
        };
        if module == "global" && name == "object" {
            return Params::Known { names: vec![] };
        }
        if module == "global" || module.contains(':') || name.contains('.') {
            return Params::External;
        }
        let Some(fi) = self.file(module) else {
            return Params::Unknown;
        };
        let Some(sym) = self.files[fi]
            .raw
            .symbols
            .iter()
            .find(|s| s.name == name && s.owner.is_none())
        else {
            return Params::External;
        };
        match &sym.params {
            RawParams::Own { names, .. } => Params::Known {
                names: names.clone(),
            },
            RawParams::Unknown if !(sym.built_by_new && !self.since_measured()) => Params::Unknown,
            RawParams::Inherited if sym.kind != drift_core::SymbolKind::Class => Params::External,
            RawParams::Inherited | RawParams::Unknown => {
                let base = sym
                    .wraps
                    .iter()
                    .find(|(_, k)| *k == WrapKind::Extends)
                    .map(|(r, _)| self.canon(fi, r));
                match base {
                    None => Params::Known { names: vec![] },
                    Some(b) => match self.params_of(&b, depth + 1) {
                        Params::External => Params::Unknown,
                        p => p,
                    },
                }
            }
        }
    }

    /// A call to `callee` that builds a soft dependency: a soft keyword (or `**kwargs`),
    /// or a positional argument bound to a soft flag of the callee ([`soft_value`]).
    /// Positional arguments are soft when what they bind is unknown: an in-repo callee
    /// whose parameters the code does not show, or a `*args` argument. They are not
    /// read for a package callee other than the `fastapi.security` bearers.
    fn soft_call(&self, callee: &str, args: &SoftArgs) -> bool {
        if args.keyword {
            return true;
        }
        if args.positional.is_empty() {
            return false;
        }
        match self.params_of(callee, 0) {
            Params::External => false,
            Params::Unknown => true,
            Params::Known { names } => {
                args.starred
                    || names
                        .iter()
                        .zip(&args.positional)
                        .any(|(p, v)| soft_value(p, *v))
            }
        }
    }

    /// Dependencies with their sub-dependencies, depth-first, without repeats: what
    /// FastAPI runs before the endpoint. A chain stops at a soft dependency (one whose
    /// name says so, [`soft_name`], or a soft instance) and skips the sub-dependencies
    /// a dependency takes as possibly `None`: a weaker dependency never counts as the
    /// stricter one it may reach.
    fn dep_closure(&self, direct: &[Dep]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut seen: BTreeSet<(String, Option<String>)> = BTreeSet::new();
        let mut stack: Vec<(Dep, usize)> = direct.iter().rev().map(|d| (d.clone(), 0)).collect();
        while let Some((d, depth)) = stack.pop() {
            if !seen.insert((d.id.clone(), d.key.clone())) {
                continue;
            }
            // (The measured build stopped at a dependency its name says is soft.
            // FastAPI runs what it depends on all the same: a name is no evidence.)
            if let Some(key) = &d.key
                && depth < MAX_DEP_DEPTH
                && (!soft_name(&d.id) || self.since_measured())
                && let Some(sub) = self.noted(key, self.fn_deps.get(key))
            {
                for s in sub.iter().rev() {
                    stack.push((s.clone(), depth + 1));
                }
            }
            if !out.contains(&d.id) {
                out.push(d.id);
            }
        }
        out
    }

    /// How each of `direct` and of what they depend on in turn is written, as
    /// [`drift_core::controls::SHAPE`] says it: `<id>` for a name, `<id>(...)` for a
    /// call. Walks what [`Linker::dep_closure`] walks.
    fn dep_shapes(&self, direct: &[Dep], out: &mut BTreeSet<String>) {
        let mut seen: BTreeSet<(String, Option<String>, String)> = BTreeSet::new();
        let mut stack: Vec<(Dep, usize)> = direct.iter().map(|d| (d.clone(), 0)).collect();
        while let Some((d, depth)) = stack.pop() {
            if !seen.insert((d.id.clone(), d.key.clone(), d.shape.clone())) {
                continue;
            }
            if let Some(key) = &d.key
                && depth < MAX_DEP_DEPTH
                && let Some(sub) = self.fn_deps.get(key)
            {
                stack.extend(sub.iter().map(|s| (s.clone(), depth + 1)));
            }
            out.insert(format!("{}{}", d.id, d.shape));
        }
    }

    /// Node id of a mount target or registration router.
    fn node_of(&self, fi: usize, r: &RawRef) -> String {
        let c = self.canon(fi, r);
        match c.strip_suffix("#*") {
            Some(m) => m.to_string(),
            // `include((patterns, "ns"))` of another module's `urlpatterns` is an
            // include of that module.
            None => match c.strip_suffix("#urlpatterns") {
                Some(m) => {
                    self.urlpatterns_met
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    match self.since_measured() {
                        true => m.to_string(),
                        false => c.strip_suffix(".urls").map_or(c.clone(), String::from),
                    }
                }
                _ => c.strip_suffix(".urls").map_or(c.clone(), String::from),
            },
        }
    }

    /// Nodes a reference stands for: a helper's app parameter is every factory app
    /// passed to it.
    fn nodes_of(&self, fi: usize, r: &RawRef) -> Vec<String> {
        let n = self.node_of(fi, r);
        match self.alias.get(&n) {
            Some(targets) => targets.iter().cloned().collect(),
            None => vec![n],
        }
    }

    /// Whether Drift reads what the function `callee` (as file `fi` names it) does
    /// with an application it is handed, and the function: one of the repository,
    /// a builtin, or a package's that is known to register nothing
    /// ([`REGISTERS_NO_GUARD`]). Not a class or a method of the repository, nor
    /// anything that is not found.
    fn reads_callee(&self, fi: usize, callee: &RawRef) -> (bool, String) {
        // A method of a module-level instance is its class's.
        let mut callee = self.canon(fi, callee);
        if let Some((instance, method)) = callee.rsplit_once('.')
            && let Some(class) = self.instances.get(instance)
        {
            callee = format!("{class}.{method}");
        }
        let read =
            match callee.split_once('#') {
                Some(("global", _)) => true,
                Some((module, name)) if module.starts_with("pkg:") => {
                    let package = module.trim_start_matches("pkg:");
                    let root = package.split(['.', '/']).next().unwrap_or(package);
                    REGISTERS_NO_GUARD.contains(&root)
                        || REGISTERS_NO_GUARD.contains(&format!("{root}#{name}").as_str())
                }
                Some((module, name)) if !module.contains(':') => {
                    !name.contains(['.', '('])
                        && self.file(module).is_some_and(|gi| {
                            self.files[gi].raw.symbols.iter().any(|s| {
                                s.name == name && s.kind == drift_core::SymbolKind::Function
                            })
                        })
                }
                _ => false,
            };
        (read, callee)
    }

    /// The function or class of the repository that the pass `p` (in file `fi`)
    /// hands an application to and whose result is used in its place: not a call
    /// whose value is dropped (`init_hooks(app)`), not a function that hands its own
    /// parameter back (`app = configure(app)`). What it hands back is what is served
    /// (`app = TokenMiddleware(app)`, `uvicorn.run(require_signature(app))`).
    fn wrapper(&self, fi: usize, p: &RawAppPass) -> Option<String> {
        if !p.used {
            return None;
        }
        let callee = self.canon(fi, &p.callee);
        let (module, name) = callee.split_once('#')?;
        if module.contains(':') || name.contains(['.', '(']) {
            return None;
        }
        let gi = self.file(module)?;
        let raw = &self.files[gi].raw;
        let defined = raw.symbols.iter().any(|s| {
            s.name == name
                && matches!(
                    s.kind,
                    drift_core::SymbolKind::Function | drift_core::SymbolKind::Class
                )
        });
        (defined && !raw.hands_back.iter().any(|f| f == name)).then_some(callee)
    }

    /// The names bound to what a factory returns ([`Linker::results`]).
    fn read_results(&mut self) {
        for fi in 0..self.files.len() {
            if is_test_path(&self.files[fi].rel_path) {
                continue;
            }
            let rel = self.module_of(fi).to_string();
            for (name, callee) in &self.files[fi].raw.factory_results {
                let callee = self.canon(fi, callee);
                let Some((module, function)) = callee.split_once('#') else {
                    continue;
                };
                if module.contains(':') || function.contains(['.', '(']) {
                    continue;
                }
                if self.file(module).is_some() {
                    self.results
                        .insert(format!("{rel}#{name}"), format!("{module}#{function}."));
                }
            }
        }
    }

    /// The applications and routers that went where Drift does not read what was
    /// registered on them ([`Linker::unread`]): one passed to a function, and a
    /// factory's local with an attribute or a method Drift does not know used on
    /// it. A function of the repository is read: one that registers on its
    /// parameter is the application's ([`Linker::nodes_of`]). A class or a method
    /// of the repository, a package's function that is not known to register
    /// nothing ([`REGISTERS_NO_GUARD`]), and one that is not found are not.
    fn read_passes(&mut self) {
        // The applications: a router of a web framework, or a factory's local that
        // something is mounted on.
        let mounted: BTreeSet<String> = self
            .parents
            .values()
            .flatten()
            .map(|(p, ..)| p.clone())
            .collect();
        let object = |l: &Self, node: &str| match l.routers.get(node) {
            Some(i) => i.web(),
            None => {
                mounted.contains(node)
                    && node
                        .split_once('#')
                        .is_some_and(|(_, local)| local.contains('.') && !local.contains('('))
            }
        };
        let mut unread: Vec<(String, String)> = Vec::new();
        let mut wrapped: Vec<(String, String)> = Vec::new();
        for fi in 0..self.files.len() {
            let at = &self.files[fi].rel_path;
            if is_test_path(at) {
                continue;
            }
            // (An imported one is read where its file's reads are: the adapter
            // tables.)
            // (An imported one handed to what is served in its place is read here
            // too: `from api import app`, `app = TokenMiddleware(app)`.)
            for p in self.files[fi]
                .raw
                .app_passes
                .iter()
                .filter(|p| !matches!(p.from.base, RawBase::Import { .. }) || p.used)
            {
                for node in self.nodes_of(fi, &p.from) {
                    if !object(self, &node) {
                        continue;
                    }
                    let (read, callee) = self.reads_callee(fi, &p.callee);
                    let name = node.rsplit(['#', '.']).next().unwrap_or(&node);
                    let to = callee.rsplit('#').next().unwrap_or(&callee);
                    let wrapper = self.wrapper(fi, p);
                    if matches!(p.from.base, RawBase::Import { .. }) && read && wrapper.is_none() {
                        continue;
                    }
                    if !read {
                        unread.push((
                            node.clone(),
                            format!(
                                "`{name}` passed to `{to}`, which Drift does not read ({at}:{})",
                                p.line
                            ),
                        ));
                    } else if wrapper.is_some() {
                        // A function of the repository that hands back something
                        // else: that is what answers, and it may answer for itself.
                        unread.push((
                            node.clone(),
                            format!(
                                "`{name}` served through what `{to}` hands back ({at}:{})",
                                p.line
                            ),
                        ));
                    }
                    if let Some(w) = wrapper {
                        wrapped.push((node.clone(), w));
                    }
                }
            }
            for u in &self.files[fi].raw.local_uses {
                // `.app.before_request_funcs.setdefault`: the local, then what is
                // used of it.
                let mut parts = u.on.member.trim_start_matches('.').splitn(2, '.');
                let (Some(local), Some(rest)) = (parts.next(), parts.next()) else {
                    continue;
                };
                let attr = rest.split('.').next().unwrap_or(rest);
                if APP_ATTRIBUTES.contains(&attr) || NO_GUARD_ATTRIBUTES.contains(&attr) {
                    continue;
                }
                let on = RawRef {
                    base: u.on.base.clone(),
                    member: format!(".{local}"),
                };
                let how = match u.call {
                    true => format!("`{local}.{rest}(...)` ({at}:{})", u.line),
                    false => format!("`{local}.{rest}` ({at}:{})", u.line),
                };
                for node in self.nodes_of(fi, &on) {
                    if object(self, &node) {
                        unread.push((node, how.clone()));
                    }
                }
            }
        }
        for (node, how) in unread {
            self.unread.entry(node).or_insert(how);
        }
        for (node, wrapper) in wrapped {
            let w = self.wrapped.entry(node).or_default();
            if !w.contains(&wrapper) {
                w.push(wrapper);
            }
        }
        self.django_served = self.django_wrappers();
    }

    /// What Django's application object is served through: `application =
    /// get_wsgi_application()` bound again to what a call handed it to gives
    /// (`application = SharedSecretGate(application)` in `wsgi.py` or `asgi.py`),
    /// as middleware hooks are written. Every request of the project passes it
    /// where every module that builds the application wraps it so; where only
    /// some do (`wsgi.py` and not `asgi.py`), the routes served through the other
    /// do not. Not what a package known to register no guard is handed
    /// ([`REGISTERS_NO_GUARD`]).
    fn django_wrappers(&self) -> Vec<String> {
        let mut built = 0usize;
        let mut wrappers: BTreeMap<String, usize> = BTreeMap::new();
        for fi in 0..self.files.len() {
            let raw = &self.files[fi].raw;
            if is_test_path(&self.files[fi].rel_path) {
                continue;
            }
            // (A name bound twice is in `routers` by one binding and in
            // `routers_rebound` by the other.)
            let apps: Vec<&str> = raw
                .routers
                .iter()
                .chain(&raw.routers_rebound)
                .filter(|r| DJANGO_APPS.contains(&self.canon(fi, &r.callee).as_str()))
                .map(|r| r.name.as_str())
                .collect();
            if apps.is_empty() {
                continue;
            }
            built += 1;
            let mut here = BTreeSet::new();
            for p in raw.app_passes.iter().filter(|p| p.used) {
                let app = matches!(&p.from.base, RawBase::Local(n)
                    if p.from.member.is_empty() && apps.contains(&n.as_str()));
                let (read, callee) = self.reads_callee(fi, &p.callee);
                if app && !(read && callee.starts_with("pkg:")) {
                    here.insert(callee);
                }
            }
            for w in here {
                *wrappers.entry(w).or_default() += 1;
            }
        }
        wrappers
            .into_iter()
            .map(|(w, n)| {
                if n == built {
                    format!("{EVERY_MIDDLEWARE}{w}")
                } else {
                    format!("{SOME_MIDDLEWARE}{w}")
                }
            })
            .collect()
    }

    fn build_adapter_tables(&mut self) {
        self.alias = self.app_aliases();
        for fi in 0..self.files.len() {
            if is_test_path(&self.files[fi].rel_path) {
                continue;
            }
            for key in &self.files[fi].raw.dependency_overrides {
                // A key that is no function, class or value made by a call of the
                // repository (a loop variable, a lookup) may be any dependency.
                let c = key.as_ref().map(|r| self.canon(fi, r)).filter(|c| {
                    c.starts_with("pkg:")
                        || self.symbol_at(c).is_some_and(|(_, s)| {
                            matches!(
                                s.kind,
                                drift_core::SymbolKind::Function | drift_core::SymbolKind::Class
                            ) || !s.values.is_empty()
                        })
                });
                self.overridden.insert(c.unwrap_or_else(|| "*".to_string()));
            }
        }
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            for s in &self.files[fi].raw.symbols {
                if s.is_async {
                    self.async_defs.insert(format!("{rel}#{}", s.name));
                } else if matches!(
                    s.kind,
                    drift_core::SymbolKind::Function | drift_core::SymbolKind::Class
                ) {
                    self.sync_defs.insert(format!("{rel}#{}", s.name));
                }
                for m in &s.members {
                    let id = format!("{rel}#{}.{}", s.name, m.name);
                    if m.is_async {
                        self.async_defs.insert(id);
                    } else {
                        self.sync_defs.insert(id);
                    }
                }
                // A value of the caller bound on a holder: the holder is the callee,
                // and what gives the value is not the holder itself (a use).
                for (holder, from) in s
                    .caller_args
                    .iter()
                    .chain(s.members.iter().flat_map(|m| &m.caller_args))
                {
                    if !matches!(from, Some(RawDep::Gives(g)) if g == holder) {
                        let c = self.canon(fi, holder);
                        if drift_core::CALLER_HOLDERS.iter().any(|h| c.starts_with(h)) {
                            self.held.insert(c);
                        }
                    }
                }
            }
            for s in &self.files[fi].raw.symbols {
                if let [(Some(r), shape)] = s.values.as_slice()
                    && shape.starts_with('(')
                {
                    let callee = self.canon(fi, r);
                    let factory = callee.split_once('#').is_some_and(|(module, name)| {
                        !module.contains(':')
                            && !name.contains(['.', '('])
                            && self.file(module).is_some_and(|gi| {
                                self.files[gi].raw.symbols.iter().any(|x| {
                                    x.name == name
                                        && x.kind == drift_core::SymbolKind::Function
                                        && !x.call_deps.is_empty()
                                })
                            })
                    });
                    if factory {
                        self.factory_values
                            .insert(format!("{rel}#{}", s.name), (callee, shape.clone()));
                    }
                }
            }
            for r in &self.files[fi].raw.routers {
                let class = self.canon(fi, &r.callee);
                let id = format!("{rel}#{}", r.name);
                if self.soft_call(&class, &r.args) {
                    self.soft_instances.insert(id.clone());
                }
                if !r.args.shape.is_empty() {
                    self.instance_shapes
                        .insert(id.clone(), r.args.shape.clone());
                }
                self.instances.insert(id, class);
            }
        }
        // Annotated dependency aliases and `Depends(f)` constants first: function deps
        // refer to them. Aliases may refer to aliases (`ApiKeyDep = Annotated[str,
        // API_KEY_REQUIRED]`), at any depth up to the chain bound: every alias is known
        // (empty) from the start, so a lookup misses only for a module not loaded.
        let raw_aliases: Vec<(usize, String, &Vec<RawDep>)> = (0..self.files.len())
            .flat_map(|fi| {
                let rel = self.module_of(fi).to_string();
                self.files[fi]
                    .raw
                    .dep_aliases
                    .iter()
                    .map(move |(name, deps)| (fi, format!("{rel}#{name}"), deps))
            })
            .collect();
        self.dep_aliases = raw_aliases
            .iter()
            .map(|(_, k, _)| (k.clone(), Vec::new()))
            .collect();
        for _ in 0..MAX_DEP_DEPTH {
            let mut next = BTreeMap::new();
            for (fi, k, deps) in &raw_aliases {
                let mut out: Vec<Dep> = Vec::new();
                for d in deps.iter().flat_map(|d| self.dep_canon(*fi, d, false)) {
                    // `Depends(CurrentUser)` naming an alias stands for what it holds.
                    let expanded = match self.noted(&d.id, self.dep_aliases.get(&d.id)) {
                        Some(x) => x
                            .iter()
                            .map(|x| Dep {
                                optional: x.optional || d.optional,
                                ..x.clone()
                            })
                            .collect(),
                        None => vec![d],
                    };
                    for x in expanded {
                        if !out.contains(&x) {
                            out.push(x);
                        }
                    }
                }
                next.insert(k.clone(), out);
            }
            if next == self.dep_aliases {
                break;
            }
            self.dep_aliases = next;
        }
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            for s in &self.files[fi].raw.symbols {
                // A function's dependencies; a class's `__init__`'s (for `Depends(Class)`)
                // and `__call__`'s (for an instance).
                for (key, deps) in [
                    (format!("{rel}#{}", s.name), &s.deps),
                    (format!("{rel}#{}.__call__", s.name), &s.call_deps),
                ] {
                    let c: Vec<Dep> = deps
                        .iter()
                        .flat_map(|d| self.dep_canon(fi, d, true))
                        .collect();
                    if !c.is_empty() {
                        self.fn_deps.insert(key, c);
                    }
                }
            }
            // One name bound twice (`app = FastAPI()`, then `app =
            // TokenMiddleware(app)`): where the binding the measured build kept is
            // no application and another is, that one is the application.
            let raw = &self.files[fi].raw;
            let kept = |name: &str| {
                raw.routers.iter().any(|r| {
                    r.name == name && self.router_adapter(&self.canon(fi, &r.callee), 0).is_some()
                })
            };
            let (mut ctor_middleware, mut ctor_unread) = (Vec::new(), Vec::new());
            let rebound: Vec<&RawRouter> = raw
                .routers_rebound
                .iter()
                .filter(|r| {
                    self.router_adapter(&self.canon(fi, &r.callee), 0).is_some()
                        && !kept(&r.name)
                        && self.since_measured()
                })
                .collect();
            for r in raw.routers.iter().chain(rebound) {
                let class = self.canon(fi, &r.callee);
                let adapter = match self.router_adapter(&class, 0) {
                    Some(a) => a,
                    // A Starlette application: its route table is read since the
                    // measured build, as a FastAPI application's routes are.
                    None if (STARLETTE_APPS.contains(&class.as_str())
                        || STARLETTE_ROUTERS.contains(&class.as_str()))
                        && self.since_measured() =>
                    {
                        "fastapi"
                    }
                    None => continue,
                };
                let prefix = match adapter {
                    "fastapi" => r.prefix.clone(),
                    "flask" => r.url_prefix.clone(),
                    "flask_restx" if class.ends_with("#Namespace") || r.path.is_some() => r
                        .path
                        .clone()
                        .or_else(|| r.first.as_ref().map(|n| format!("/{n}"))),
                    _ => None,
                };
                let deps = r
                    .deps
                    .iter()
                    .flat_map(|d| self.dep_canon(fi, d, false))
                    .collect();
                // A class of the repository built on the library's that writes its own
                // constructor (`class VersionedRouter(APIRouter): def __init__ ...`)
                // may give itself a prefix there: what it is built with is then not
                // all of its prefix.
                let own_class = matches!(adapter, "fastapi" | "flask" | "flask_restx")
                    && self.builds_itself(&class, 0);
                // The middleware the constructor is given runs for every request
                // of the application, as one added to it does.
                if (!r.middleware.is_empty() || r.middleware_unread) && self.since_measured() {
                    let node = format!("{rel}#{}", r.name);
                    for m in &r.middleware {
                        let m = format!("{EVERY_MIDDLEWARE}{}", self.canon(fi, m));
                        ctor_middleware.push((node.clone(), m));
                    }
                    if r.middleware_unread {
                        ctor_unread.push((
                            node,
                            format!(
                                "`middleware=` of `{}(...)` ({}:{})",
                                class.rsplit(['#', '.']).next().unwrap_or(&class),
                                self.files[fi].rel_path,
                                r.line
                            ),
                        ));
                    }
                }
                // An option of a router whose effect on its routes is not read: a
                // route class (`APIRouter(route_class=SignedRoute)`, whose handler
                // runs in place of every route's), the decorators a Flask-RESTX
                // namespace or a Flask-RESTful API applies to every resource
                // (`Namespace("x", decorators=[...])`), options unpacked from a value
                // (`APIRouter(**OPTS)`, which may carry dependencies). Since the
                // measured build.
                if matches!(adapter, "fastapi" | "flask_restx")
                    && let Some(k) = r.keywords.iter().find(|k| {
                        k.starts_with('*') || matches!(k.as_str(), "route_class" | "decorators")
                    })
                    && self.since_measured()
                {
                    let built = class.rsplit(['#', '.']).next().unwrap_or(&class);
                    let shown = if k.starts_with('*') {
                        k.clone()
                    } else {
                        format!("{k}=...")
                    };
                    ctor_unread.push((
                        format!("{rel}#{}", r.name),
                        format!(
                            "`{built}({shown})` ({}:{})",
                            self.files[fi].rel_path, r.line
                        ),
                    ));
                }
                if own_class {
                    let built = class.rsplit(['#', '.']).next().unwrap_or(&class);
                    self.unread.insert(
                        format!("{rel}#{}", r.name),
                        format!(
                            "`{built}`, a class of the repository with its own constructor ({}:{})",
                            self.files[fi].rel_path, r.line
                        ),
                    );
                }
                let prefix = match (own_class, prefix) {
                    (true, p) => Some(join_path(&[
                        crate::lower::adapters::UNKNOWN_PREFIX,
                        p.as_deref().unwrap_or(""),
                    ])),
                    (false, p) => p,
                };
                self.routers.insert(
                    format!("{rel}#{}", r.name),
                    RouterInfo {
                        adapter: adapter.to_string(),
                        prefix: prefix.unwrap_or_default(),
                        deps,
                        app: adapter == "flask" && self.is_app_class(&class, 0),
                        root: self.is_app_class(&class, 0)
                            || STARLETTE_APPS.contains(&class.as_str()),
                    },
                );
            }
            for (node, m) in ctor_middleware {
                self.hooks.entry(node).or_default().push(m);
            }
            for (node, how) in ctor_unread {
                self.unread.entry(node).or_insert(how);
            }
        }
        // Not for a second reading given the first's table ([`Linker::measured`]).
        let met = |l: &Self| l.urlpatterns_met.load(std::sync::atomic::Ordering::Relaxed);
        let before = met(self);
        let files = match self.handed_given {
            true => 0,
            false => self.files.len(),
        };
        for fi in 0..files {
            if is_test_path(&self.files[fi].rel_path) {
                continue;
            }
            let raw = &self.files[fi].raw;
            let rel = self.module_of(fi).to_string();
            if raw.uses_all {
                self.mounts_unseen.insert(self.import_root(fi));
            }
            // A reference to `module`, `router` or `router.routes` hands the module,
            // the router, or the router through its attribute on.
            // An application is not handed on by what is read of it where it is: an
            // attribute that has nothing to do with its routes ([`APP_ATTRIBUTES`]).
            let mut handed: Vec<(String, String)> = Vec::new();
            let mut unread: Vec<(String, String)> = Vec::new();
            let at = &self.files[fi].rel_path;
            let mut hand_on = |r: &RawRef, call: bool, line: u32| {
                // The reference as the linker resolves it, and as the attribute it is
                // written as on what its first name is (an attribute of an instance
                // resolves to its class's).
                let object = self.node_of(
                    fi,
                    &RawRef {
                        base: r.base.clone(),
                        member: String::new(),
                    },
                );
                let written = match (r.member.is_empty(), object.contains('#')) {
                    (true, _) => object,
                    (false, true) => format!("{object}{}", r.member),
                    (false, false) => format!("{object}#{}", r.member.trim_start_matches('.')),
                };
                let resolved = self.node_of(fi, r);
                for full in [
                    Some(resolved.clone()),
                    Some(written).filter(|w| *w != resolved),
                ]
                .into_iter()
                .flatten()
                {
                    let mut node = full.clone();
                    loop {
                        let rest = full[node.len()..].trim_start_matches('.');
                        let attr = rest.split('.').next().unwrap_or_default();
                        let name = node.rsplit(['#', '.']).next().unwrap_or(&node);
                        let app = self.routers.get(&node).is_some_and(|i| i.root);
                        if !(app && APP_ATTRIBUTES.contains(&attr)) {
                            let how = match (rest.is_empty(), call) {
                                (true, _) => format!("`{name}` passed or assigned as a value"),
                                (false, true) => format!("`{name}.{rest}(...)`"),
                                (false, false) => format!("`{name}.{rest}`"),
                            };
                            // What is registered on it there is not read: an
                            // attribute or a method Drift does not know, or the
                            // object read in a file that does not define it.
                            let elsewhere = node.split('#').next() != Some(rel.as_str());
                            // Every read of it here is an argument of a call Drift
                            // reads ([`RawAppPass::unmeasured`]).
                            let explained = || {
                                let mut passes = raw
                                    .app_passes
                                    .iter()
                                    .filter(|p| p.unmeasured && p.from == *r)
                                    .peekable();
                                passes.peek().is_some()
                                    && passes.all(|p| {
                                        self.reads_callee(fi, &p.callee).0
                                            && self.wrapper(fi, p).is_none()
                                    })
                            };
                            if self.routers.get(&node).is_some_and(|i| i.web())
                                && !APP_ATTRIBUTES.contains(&attr)
                                && !NO_GUARD_ATTRIBUTES.contains(&attr)
                                && (!rest.is_empty() || (elsewhere && !explained()))
                            {
                                unread.push((node.clone(), format!("{how} ({at}:{line})")));
                            }
                            handed.push((node.clone(), format!("{how} ({at}:{line})")));
                        }
                        match (node.rfind('.'), node.find('#')) {
                            (Some(dot), Some(hash)) if dot > hash => node.truncate(dot),
                            _ => break,
                        }
                    }
                }
            };
            for u in &raw.router_uses {
                hand_on(&u.on, u.call, u.line);
            }
            if raw.uses_namespace {
                for (name, binding) in &raw.bindings {
                    let base = match binding {
                        RawBinding::Import { spec, name, .. } => RawBase::Import {
                            spec: spec.clone(),
                            name: name.clone(),
                        },
                        _ => RawBase::Local(name.clone()),
                    };
                    hand_on(
                        &RawRef {
                            base,
                            member: String::new(),
                        },
                        false,
                        1,
                    );
                }
                for spec in &raw.star_imports {
                    hand_on(
                        &RawRef {
                            base: RawBase::Import {
                                spec: spec.clone(),
                                name: "*".into(),
                            },
                            member: String::new(),
                        },
                        false,
                        1,
                    );
                }
            }
            for (node, how) in handed {
                self.handed_on.entry(node).or_insert(how);
            }
            for (node, how) in unread {
                self.unread.entry(node).or_insert(how);
            }
        }
        self.handed_differs = met(self) != before;
        self.read_results();
        let mut admin_mounts = Vec::new();
        let mut app_hooks = Vec::new();
        let mut result_hooks: Vec<(String, String)> = Vec::new();
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            let raw = &self.files[fi].raw;
            for m in &raw.mounts {
                if m.unmeasured && !self.since_measured() {
                    continue;
                }
                // A Starlette `Mount`: where the route table that holds it puts
                // it, behind the middleware given on the way.
                let table = m.table.as_deref().filter(|_| self.since_measured());
                if table.is_some_and(|t| t.listed) {
                    continue;
                }
                let at = table.and_then(|t| t.at.as_ref());
                let parents = match (at, &m.parent) {
                    (Some((app, _)), _) => self.nodes_of(fi, app),
                    (None, Some(p)) => self.nodes_of(fi, p),
                    (None, None) => vec![rel.clone()],
                };
                let prefix = match at {
                    Some((_, prefix)) => Some(prefix.clone()),
                    None => m.prefix.clone(),
                };
                let mount_hooks = table
                    .map(|t| self.behind_hooks(fi, &t.behind))
                    .unwrap_or_default();
                let target = match &m.target {
                    MountTarget::Ref(t) => self.node_of(fi, t),
                    MountTarget::Module(spec) => {
                        self.specs[fi].get(spec).cloned().unwrap_or_default()
                    }
                    MountTarget::Dynamic => {
                        self.open_urlconfs.extend(parents);
                        continue;
                    }
                    MountTarget::Unfollowed => {
                        self.unfollowed.insert(self.import_root(fi));
                        continue;
                    }
                };
                if self.is_admin_site(&target) {
                    for parent in parents {
                        admin_mounts.push((fi, parent, m.prefix.clone().unwrap_or_default()));
                    }
                    continue;
                }
                // An include whose target is not a URLconf Drift can read (an imported
                // list, a missing module): the parent's patterns are not all known.
                if m.parent.is_none() && !self.followable(&target) {
                    self.open_urlconfs.extend(parents.iter().cloned());
                }
                if target.is_empty() || target.contains(':') {
                    continue;
                }
                // An application mounted by a name that is no router or app Drift reads
                // (a variable bound to a call): it may be any application here.
                if m.whole_app
                    && self.router_info(&target).is_none()
                    && !target
                        .split_once('#')
                        .is_some_and(|(_, local)| local.contains('.'))
                {
                    self.unfollowed.insert(self.import_root(fi));
                    continue;
                }
                let deps: Vec<Dep> = m
                    .deps
                    .iter()
                    .flat_map(|d| self.dep_canon(fi, d, false))
                    .collect();
                for parent in parents {
                    if target != parent {
                        self.parents.entry(target.clone()).or_default().insert((
                            parent,
                            prefix.clone(),
                            deps.clone(),
                            m.opaque,
                            mount_hooks.clone(),
                        ));
                    }
                }
            }
            for h in &raw.hooks {
                if h.unmeasured && !self.since_measured() {
                    continue;
                }
                // What is given is no name: kept by its words, never read as a
                // built-in of that name.
                let hook = if h.unmeasured {
                    match &h.hook.base {
                        RawBase::Global(words) => format!("unresolved:{words}"),
                        _ => self.canon(fi, &h.hook),
                    }
                } else {
                    self.canon(fi, &h.hook)
                };
                // A hook registered on what a factory returned runs for that
                // application, not for every one the factory builds: one only
                // some of them have. The measured build left it on the name.
                let node = self.node_of(fi, &h.router);
                if !self.routers.contains_key(&node)
                    && let Some(locals) = self.results.get(&node)
                    && self.since_measured()
                {
                    result_hooks.push((locals.clone(), format!("{SOME_MIDDLEWARE}{hook}")));
                    continue;
                }
                // A hook registered under a branch runs for the applications that
                // took it: read as one only some of them have, never as a guard of
                // every route of the node.
                let hook = if h.middleware {
                    format!("{EVERY_MIDDLEWARE}{hook}")
                } else if h.conditional && self.since_measured() {
                    format!("{SOME_MIDDLEWARE}{hook}")
                } else {
                    hook
                };
                for node in self.nodes_of(fi, &h.router) {
                    if h.app_wide {
                        app_hooks.push((node, hook.clone()));
                    } else {
                        self.hooks.entry(node).or_default().push(hook.clone());
                    }
                }
            }
        }
        // The applications a factory builds: its locals that are routers, or that
        // something is mounted on.
        if !result_hooks.is_empty() {
            let nodes: BTreeSet<String> = self
                .routers
                .keys()
                .chain(self.parents.values().flatten().map(|(p, ..)| p))
                .cloned()
                .collect();
            for (locals, hook) in result_hooks {
                for node in nodes.iter().filter(|n| {
                    n.strip_prefix(&locals)
                        .is_some_and(|l| !l.contains(['.', '(']))
                }) {
                    if self.routers.get(node).is_none_or(|i| i.root) {
                        self.hooks
                            .entry(node.clone())
                            .or_default()
                            .push(hook.clone());
                    }
                }
            }
        }
        // `bp.before_app_request(f)` runs before every request of the app `bp` is
        // registered on: a hook of the root the blueprint is mounted under.
        for (node, hook) in app_hooks {
            for root in self.mount_roots(&node) {
                self.app_hooks.entry(root).or_default().push(hook.clone());
            }
        }
        self.read_passes();
        for v in self.hooks.values_mut().chain(self.app_hooks.values_mut()) {
            v.sort();
            v.dedup();
        }
        self.django = self.django_config();
        self.apps = self.app_facts();
        // Routes and registrations, attached to the file defining the symbol.
        let mut extra: BTreeMap<String, Extra> = BTreeMap::new();
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            let raw = &self.files[fi].raw;
            // A route only adds facts to its own file, except a Celery task's: beat
            // schedules find tasks by name across files.
            for rt in &raw.routes {
                if !self.untracked(&rel) || rt.verb == "task" {
                    self.route(fi, rt, extra.entry(rel.clone()).or_default());
                }
            }
            for g in &raw.registrations {
                if g.unmeasured && !self.since_measured() {
                    continue;
                }
                self.registration(fi, g, &mut extra);
            }
        }
        for (fi, parent, prefix) in admin_mounts {
            self.admin_entry(fi, &parent, &prefix, &mut extra);
        }
        self.beat_entries(&mut extra);
        self.split_routes(&mut extra);
        self.extra = extra;
    }

    /// A handler routed more than once, where the routes do not give it the same
    /// hooks and guards (two route decorators on two blueprints, one with a
    /// `before_request` hook; a view registered on two applications; a path wrapped
    /// in `login_required` beside one that is not): each route carries its own
    /// ([`drift_core::MountFacts`]), and the handler's symbol keeps what every route
    /// gives it. Two of them at one path that differ: which answers is not read,
    /// and the route says so (`opaque`). The measured build gave the symbol all of
    /// them.
    fn split_routes(&self, extra: &mut BTreeMap<String, Extra>) {
        for e in extra.values_mut() {
            let mut by_symbol: BTreeMap<String, Vec<usize>> = BTreeMap::new();
            for (i, (symbol, ..)) in e.routed.iter().enumerate() {
                by_symbol.entry(symbol.clone()).or_default().push(i);
            }
            for (symbol, at) in by_symbol {
                let sets: Vec<&Vec<Wrap>> = at.iter().map(|i| &e.routed[*i].3).collect();
                let common: Vec<Wrap> = sets[0]
                    .iter()
                    .filter(|w| sets.iter().all(|s| s.contains(w)))
                    .cloned()
                    .collect();
                if sets.iter().all(|s| s.iter().all(|w| common.contains(w)))
                    || !self.since_measured()
                {
                    continue;
                }
                if let Some(ws) = e.wraps.get_mut(&symbol) {
                    ws.retain(|w| common.contains(w) || !sets.iter().any(|s| s.contains(w)));
                }
                // What each route adds; a path two of them serve differently is
                // not read.
                let mut adds: BTreeMap<String, Vec<Vec<Wrap>>> = BTreeMap::new();
                for i in &at {
                    let (_, entry, routes, own) = &e.routed[*i];
                    if !entry {
                        continue;
                    }
                    let add: Vec<Wrap> = own
                        .iter()
                        .filter(|w| !common.contains(w))
                        .cloned()
                        .collect();
                    for route in routes {
                        adds.entry(route.clone()).or_default().push(add.clone());
                    }
                }
                for (route, lists) in adds {
                    let at = match e
                        .mounts
                        .iter()
                        .position(|m| m.symbol == symbol && m.route == route)
                    {
                        Some(at) => at,
                        None => {
                            e.mounts.push(drift_core::MountFacts {
                                symbol: symbol.clone(),
                                route: route.clone(),
                                ..Default::default()
                            });
                            e.mounts.len() - 1
                        }
                    };
                    let m = &mut e.mounts[at];
                    if lists.iter().any(|l| *l != lists[0]) {
                        m.opaque = true;
                        continue;
                    }
                    for w in &lists[0] {
                        match middleware_of(&w.wrapper) {
                            Some(mw) => {
                                if !m.app_middleware.contains(&mw) {
                                    m.app_middleware.push(mw);
                                    m.app_middleware.sort();
                                }
                            }
                            None if !m.wraps.contains(w) => m.wraps.push(w.clone()),
                            None => {}
                        }
                    }
                }
            }
        }
    }

    /// The application objects each module builds, with what Drift does not know of
    /// each ([`drift_core::AppFacts`]): a constructor option that is not one of
    /// [`APP_KEYWORDS`], a middleware that is not one of [`MIDDLEWARE`] or a function
    /// that only reads its request, a lifespan that does more than keep state, and
    /// any use of the object that is not a method Drift reads
    /// ([`crate::lower::adapters::READ_METHODS`]) or an attribute of
    /// [`APP_ATTRIBUTES`].
    fn app_facts(&self) -> BTreeMap<String, Vec<drift_core::AppFacts>> {
        const MAX_UNKNOWN: usize = 8;
        // What each application is given as middleware, in any file.
        let mut given: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for fi in 0..self.files.len() {
            let at = &self.files[fi].rel_path;
            if is_test_path(at) {
                continue;
            }
            for m in &self.files[fi].raw.middlewares {
                let what = m.what.as_ref().map(|w| self.canon(fi, w));
                let known = match (&what, m.class) {
                    (Some(class), true) => MIDDLEWARE.iter().any(|(package, name)| {
                        class.strip_prefix("pkg:").is_some_and(|c| {
                            c.split('#').next() == Some(package)
                                && c.rsplit(['#', '.']).next() == Some(name)
                        })
                    }),
                    (Some(function), false) => {
                        self.symbol_param_uses(function).is_some_and(|uses| {
                            uses.iter()
                                .all(|u| REQUEST_ATTRIBUTES.contains(&u.as_str()))
                        })
                    }
                    (None, _) => false,
                };
                if !known {
                    for node in self.nodes_of(fi, &m.app) {
                        given
                            .entry(node)
                            .or_default()
                            .push(format!("`{}` ({at}:{})", m.text, m.line));
                    }
                }
            }
        }
        let mut out: BTreeMap<String, Vec<drift_core::AppFacts>> = BTreeMap::new();
        for fi in 0..self.files.len() {
            let rel = self.module_of(fi).to_string();
            let at = &self.files[fi].rel_path;
            for r in &self.files[fi].raw.routers {
                if r.name.contains('.') {
                    continue;
                }
                let class = self.canon(fi, &r.callee);
                let django = DJANGO_APPS.contains(&class.as_str());
                if !(django || self.is_app_class(&class, 0)) {
                    continue;
                }
                let node = format!("{rel}#{}", r.name);
                let built = class.rsplit(['#', '.']).next().unwrap_or(&class);
                let flask = self.router_adapter(&class, 0) == Some("flask");
                let mut unknown: Vec<String> = Vec::new();
                for k in &r.keywords {
                    let known = !k.starts_with('*')
                        && (APP_KEYWORDS.contains(&k.as_str())
                            || (flask && FLASK_KEYWORDS.contains(&k.as_str())));
                    if !known {
                        let shown = if k.starts_with('*') {
                            k.clone()
                        } else {
                            format!("{k}=...")
                        };
                        unknown.push(format!("`{built}({shown})` ({at}:{})", r.line));
                    }
                }
                // A class of the repository built on the library's may do anything in
                // its own constructor.
                if !django && self.builds_itself(&class, 0) {
                    unknown.push(format!(
                        "`{built}`, a class of the repository with its own constructor ({at}:{})",
                        r.line
                    ));
                }
                if let Some(lifespan) = &r.lifespan {
                    let function = self.canon(fi, lifespan);
                    let known = self
                        .symbol_param_uses(&function)
                        .is_some_and(|uses| uses.iter().all(|u| u == "state"));
                    if !known {
                        unknown.push(format!(
                            "`{built}(lifespan=...)`, which is handed the application and does more than keep state on it ({at}:{})",
                            r.line
                        ));
                    }
                }
                unknown.extend(self.handed_on.get(&node).cloned());
                unknown.extend(given.get(&node).into_iter().flatten().cloned());
                if django {
                    match self.django.middleware_for(at) {
                        Some(listed) => {
                            for m in listed.into_iter().filter(|m| {
                                !DJANGO_MIDDLEWARE.iter().any(|p| m.starts_with(p))
                            }) {
                                unknown.push(format!("`{m}` in MIDDLEWARE"));
                            }
                        }
                        None => unknown.push(format!(
                            "the Django settings of {at} are not found, so its MIDDLEWARE is not read"
                        )),
                    }
                }
                // Assigned again, or shadowed by a second definition: which object the
                // name is, is not known.
                if self.files[fi]
                    .raw
                    .routers
                    .iter()
                    .filter(|x| x.name == r.name)
                    .count()
                    > 1
                {
                    unknown.push(format!("`{}` is assigned more than once ({at})", r.name));
                }
                unknown.sort();
                unknown.dedup();
                unknown.truncate(MAX_UNKNOWN);
                out.entry(rel.clone())
                    .or_default()
                    .push(drift_core::AppFacts {
                        name: r.name.clone(),
                        line: r.line,
                        unknown,
                    });
            }
        }
        out
    }

    /// How the function a canonical reference names uses its first parameter
    /// ([`RawSymbol::param_uses`]); none when it is not such a function of the
    /// repository.
    fn symbol_param_uses(&self, c: &str) -> Option<&Vec<String>> {
        let (module, name) = c.split_once('#')?;
        let fi = self.file(module)?;
        let sym = self.files[fi].raw.symbols.iter().find(|s| s.name == name)?;
        sym.param_uses.as_ref()
    }

    /// Whether the router class `class`, or a class of the repository it extends,
    /// defines `__init__` or `__new__` or is decorated: its instances are then not
    /// built as the library builds them.
    fn builds_itself(&self, class: &str, depth: usize) -> bool {
        if depth > 8 {
            return true;
        }
        let Some((module, name)) = class.split_once('#') else {
            return false;
        };
        let Some(fi) = self.file(module) else {
            return false;
        };
        let Some(sym) = self.files[fi].raw.symbols.iter().find(|s| s.name == name) else {
            return false;
        };
        sym.params != RawParams::Inherited
            || sym.wraps.iter().any(|(base, kind)| {
                *kind == WrapKind::Extends && self.builds_itself(&self.canon(fi, base), depth + 1)
            })
    }

    /// Adapter of a router class: a known class, an in-repo subclass of one, or a known name.
    fn router_adapter(&self, class: &str, depth: usize) -> Option<&'static str> {
        if let Some((_, a)) = ROUTER_CLASSES.iter().find(|(c, _)| *c == class) {
            return Some(a);
        }
        if depth > 8 {
            return None;
        }
        if let Some((module, name)) = class.split_once('#')
            && !name.contains(['.', '('])
            && let Some(fi) = self.file(module)
            && let Some(sym) = self.files[fi].raw.symbols.iter().find(|s| s.name == name)
            && sym.kind == drift_core::SymbolKind::Class
        {
            for (base, kind) in &sym.wraps {
                if *kind == WrapKind::Extends
                    && let Some(a) = self.router_adapter(&self.canon(fi, base), depth + 1)
                {
                    return Some(a);
                }
            }
        }
        let short = class.rsplit_once('#').map_or(class, |(_, n)| n);
        let short = short.rsplit('.').next().unwrap_or(short);
        ROUTER_NAMES
            .iter()
            .find(|(n, _)| *n == short)
            .map(|(_, a)| *a)
    }

    /// Every way a router or URLconf node is served: one chain for each live mount of
    /// it and of what mounts it (`include_router(r, prefix="/v1")` and again with
    /// `"/v2"`), each with its own full path prefix, the guards inherited on its way
    /// and the app-wide hooks of its root. Sorted by prefix, at most [`MAX_MOUNTS`].
    /// Never empty: a node nothing mounts is served as it is.
    ///
    /// A URLconf included by a live one (reached from `ROOT_URLCONF`) is served from
    /// there, not from a test or example URLconf that also includes it.
    fn chains(&self, node: &str, depth: usize) -> Vec<Chain> {
        let info = self.router_info(node);
        let own = info.map(|i| i.prefix.as_str()).unwrap_or("");
        let mut own_guards: Vec<Dep> = info.map(|i| i.deps.clone()).unwrap_or_default();
        let mut app_hooks: Vec<String> = self.app_hooks.get(node).cloned().unwrap_or_default();
        // What was registered on it where Drift does not read: it may have a hook
        // that guards, so its routes are never said to have no guard.
        if let Some(how) = self.unread.get(node)
            && self.since_measured()
        {
            app_hooks.push(format!("{SOME_MIDDLEWARE}{}{how}", drift_core::APP_UNREAD));
            // What it is served through is read as its middleware.
            for w in self.wrapped.get(node).into_iter().flatten() {
                app_hooks.push(format!("{EVERY_MIDDLEWARE}{w}"));
            }
        }
        if let Some(h) = self.hooks.get(node) {
            for h in h {
                // Middleware is the application's, whatever it was added to.
                if self.is_app(node) || middleware_of(h).is_some() {
                    app_hooks.push(h.clone());
                } else {
                    own_guards.push(Dep::plain(h.clone()));
                }
            }
        }
        let adapter = info.map(|i| i.adapter.as_str()).unwrap_or("");
        let parents: Vec<&Parent> = self
            .parents
            .get(node)
            .filter(|_| depth < 16)
            .map(|ps| {
                let live: Vec<&Parent> = ps.iter().filter(|(p, ..)| !self.is_dead(p)).collect();
                if live.is_empty() {
                    ps.iter().take(1).collect()
                } else {
                    live
                }
            })
            .unwrap_or_default();
        if parents.is_empty() {
            // Nothing Drift reads mounts it. An application serves its routes at
            // their own paths. A router or blueprint serves nothing until it is
            // mounted, so it is mounted in a way that was not read (in a loop, by
            // `importlib`, from a table): under a prefix that is not known, never at
            // its own paths. The same of every application of a project in which one
            // is mounted that Drift cannot name.
            let unmounted = info
                .is_some_and(|i| !i.root && matches!(adapter, "fastapi" | "flask" | "flask_restx"));
            let prefix = if unmounted || self.under_unfollowed(node) {
                join_path(&[crate::lower::adapters::UNKNOWN_PREFIX, own])
            } else {
                join_path(&[own])
            };
            return vec![Chain {
                prefix,
                guards: own_guards,
                hooks: app_hooks,
                opaque: false,
            }];
        }
        let mut out: Vec<Chain> = Vec::new();
        for (parent, mount_prefix, mount_deps, opaque, mount_hooks) in parents {
            let seg = match adapter {
                // `register_blueprint(bp, url_prefix=)` / `add_namespace(ns, path)` override.
                "flask" | "flask_restx" => mount_prefix.clone().unwrap_or_else(|| own.to_string()),
                _ => format!("{}/{own}", mount_prefix.clone().unwrap_or_default()),
            };
            for up in self.chains(parent, depth + 1) {
                let mut guards = up.guards;
                guards.extend(mount_deps.iter().cloned());
                guards.extend(own_guards.iter().cloned());
                // The middleware of what is above, of the mount, then its own.
                let mut hooks = up.hooks;
                for h in mount_hooks.iter().chain(&app_hooks) {
                    if !hooks.contains(h) {
                        hooks.push(h.clone());
                    }
                }
                out.push(Chain {
                    prefix: join_path(&[&up.prefix, &seg]),
                    guards,
                    hooks,
                    opaque: up.opaque || *opaque,
                });
            }
        }
        // The read mounts do not stand for the router when it is also handed on where
        // Drift reads no mount (a loop, a table, an argument), or when a module of its
        // import root is imported by a computed name: it may be mounted once more,
        // under a prefix and behind guards that are not known.
        let router =
            info.is_some_and(|i| !i.root && matches!(adapter, "fastapi" | "flask" | "flask_restx"));
        let module = node.split_once('#').map_or(node, |(m, _)| m);
        if router
            && (self.handed_on.contains_key(node)
                || self.handed_on.contains_key(module)
                || self.under_unseen_mounts(node))
            && self.since_measured()
        {
            out.push(Chain {
                prefix: join_path(&[crate::lower::adapters::UNKNOWN_PREFIX, own]),
                guards: Vec::new(),
                hooks: Vec::new(),
                opaque: true,
            });
        }
        out.sort();
        out.dedup();
        // Two mounts under one path with different guards: which one answers is the
        // framework's order of registration, which is not kept. Unknown.
        let mut merged: Vec<Chain> = Vec::new();
        let plain = |c: &Chain| -> Vec<String> {
            c.hooks
                .iter()
                .filter(|h| middleware_of(h).is_none())
                .cloned()
                .collect()
        };
        for c in out {
            match merged.last_mut() {
                // Two applications built on the same router (the service's and a
                // test's) that differ only in their middleware: one chain, with the
                // middleware not all of them have marked as such.
                Some(last)
                    if last.prefix == c.prefix
                        && last.guards == c.guards
                        && last.opaque == c.opaque
                        && plain(last) == plain(&c) =>
                {
                    let mut hooks = plain(last);
                    for h in last.hooks.iter().chain(&c.hooks) {
                        let Some(m) = middleware_of(h) else { continue };
                        let m = m.trim_start_matches('?');
                        let all = format!("{EVERY_MIDDLEWARE}{m}");
                        let h = if last.hooks.contains(&all) && c.hooks.contains(&all) {
                            all
                        } else {
                            format!("{SOME_MIDDLEWARE}{m}")
                        };
                        if !hooks.contains(&h) {
                            hooks.push(h);
                        }
                    }
                    last.hooks = hooks;
                }
                Some(last) if last.prefix == c.prefix => last.opaque = true,
                _ => merged.push(c),
            }
        }
        merged.truncate(MAX_MOUNTS);
        merged
    }

    /// The middleware a route of a route table is behind, as hooks are written:
    /// each class named as a middleware of every request, and what was not read as
    /// one that may be there ([`drift_core::APP_UNREAD`], with where).
    fn behind_hooks(&self, fi: usize, behind: &RawBehind) -> Vec<String> {
        let read = behind
            .middleware
            .iter()
            .map(|m| format!("{EVERY_MIDDLEWARE}{}", self.canon(fi, m)));
        let unread = behind.unread.iter().map(|(what, line)| {
            format!(
                "{SOME_MIDDLEWARE}{}{what} ({}:{line})",
                drift_core::APP_UNREAD,
                self.files[fi].rel_path
            )
        });
        read.chain(unread).collect()
    }

    /// Records what each chain adds to `symbol` beyond what all of them give it.
    fn mount_facts(&self, served: &Served, symbol: &str, out: &mut Vec<drift_core::MountFacts>) {
        for (route, (guards, hooks, opaque)) in served.routes.iter().zip(&served.adds) {
            if guards.is_empty() && hooks.is_empty() && !opaque {
                continue;
            }
            // The application middleware only this mount passes through.
            let mut app_middleware: Vec<String> =
                hooks.iter().filter_map(|h| middleware_of(h)).collect();
            app_middleware.sort();
            app_middleware.dedup();
            let hooks = hooks.iter().filter(|h| middleware_of(h).is_none());
            let hooks = hooks.map(|w| Wrap {
                wrapper: w.clone(),
                kind: WrapKind::AppHook,
            });
            let guards = self.dep_closure(guards).into_iter().map(|w| Wrap {
                wrapper: w,
                kind: WrapKind::Call,
            });
            out.push(drift_core::MountFacts {
                symbol: symbol.to_string(),
                route: route.clone(),
                wraps: hooks.chain(guards).collect(),
                opaque: *opaque,
                elsewhere: false,
                app_middleware,
            });
        }
    }

    /// True for a Flask app node: an app instance, or an app factory's local that is
    /// mounted nowhere.
    fn is_app(&self, node: &str) -> bool {
        match self.router_info(node) {
            Some(i) => i.app,
            None => {
                !self.parents.contains_key(node)
                    && node
                        .split_once('#')
                        .is_some_and(|(_, local)| local.contains('.') && !local.contains('('))
            }
        }
    }

    /// The import root of file `fi`, repo-relative: the directory its top-level
    /// package is in ([`Resolver::basedir`]).
    fn import_root(&self, fi: usize) -> String {
        let base = self.res.basedir(&self.files[fi].abs_path);
        let rel = base.strip_prefix(self.res.root()).unwrap_or(&base);
        rel.to_string_lossy().replace('\\', "/")
    }

    /// The node is defined under an import root from which a mount may not be seen.
    fn under_unseen_mounts(&self, node: &str) -> bool {
        if self.mounts_unseen.is_empty() {
            return false;
        }
        let module = node.split_once('#').map_or(node, |(m, _)| m);
        self.file(module)
            .is_some_and(|fi| self.mounts_unseen.contains(&self.import_root(fi)))
    }

    /// The node is defined under an import root with a mount that was not followed.
    fn under_unfollowed(&self, node: &str) -> bool {
        if self.unfollowed.is_empty() {
            return false;
        }
        let module = node.split_once('#').map_or(node, |(m, _)| m);
        self.file(module)
            .is_some_and(|fi| self.unfollowed.contains(&self.import_root(fi)))
    }

    /// An application class (not a router or blueprint): known, an in-repo subclass, or
    /// by name.
    fn is_app_class(&self, class: &str, depth: usize) -> bool {
        const APPS: &[&str] = &[
            "pkg:flask#Flask",
            "pkg:flask#app.Flask",
            "pkg:apiflask#APIFlask",
            "pkg:fastapi#FastAPI",
            "pkg:fastapi#applications.FastAPI",
        ];
        if APPS.contains(&class) {
            return true;
        }
        if depth > 8 {
            return false;
        }
        if let Some((module, name)) = class.split_once('#')
            && !name.contains(['.', '('])
            && let Some(fi) = self.file(module)
            && let Some(sym) = self.files[fi].raw.symbols.iter().find(|s| s.name == name)
            && sym.kind == drift_core::SymbolKind::Class
        {
            return sym.wraps.iter().any(|(base, kind)| {
                *kind == WrapKind::Extends && self.is_app_class(&self.canon(fi, base), depth + 1)
            });
        }
        let short = class.rsplit_once('#').map_or(class, |(_, n)| n);
        matches!(
            short.rsplit('.').next(),
            Some("Flask" | "APIFlask" | "FastAPI")
        )
    }

    /// A Django include target Drift reads: a scanned URLconf module, a router, the
    /// admin, or third-party code. (An imported pattern list or a missing module is not.)
    fn followable(&self, target: &str) -> bool {
        if target.starts_with("pkg:") {
            return true;
        }
        if target.is_empty() || target.contains(':') {
            return false;
        }
        self.file(target).is_some() || self.router_info(target).is_some()
    }

    fn route(&self, fi: usize, rt: &RawRoute, extra: &mut Extra) {
        let node = self.node_of(fi, &rt.receiver);
        let adapter = self.router_info(&node).map(|r| r.adapter.as_str());
        let sym = self.files[fi]
            .raw
            .symbols
            .iter()
            .find(|s| s.name == rt.symbol);
        let verb = rt.verb.as_str();
        let (kind, methods, callee): (&str, Vec<String>, &str) = match (adapter, verb) {
            (Some("fastapi"), v) if HTTP_VERBS.contains(&v) => (
                "http",
                vec![v.to_ascii_uppercase()],
                "pkg:fastapi#APIRouter.api_route",
            ),
            (Some("fastapi"), "api_route") => (
                "http",
                if rt.methods.is_empty() {
                    vec!["GET".into()]
                } else {
                    rt.methods.clone()
                },
                "pkg:fastapi#APIRouter.api_route",
            ),
            (Some("fastapi"), "websocket") => {
                ("websocket", vec![], "pkg:fastapi#APIRouter.api_route")
            }
            (Some("flask"), v) if HTTP_VERBS.contains(&v) => (
                "http",
                vec![v.to_ascii_uppercase()],
                "pkg:flask#Flask.route",
            ),
            (Some("flask"), "route") => {
                let m = if !rt.methods.is_empty() {
                    rt.methods.clone()
                } else if let Some(s) = sym.filter(|s| !s.methods.is_empty()) {
                    s.methods.clone()
                } else if sym.is_some_and(|s| s.kind == drift_core::SymbolKind::Class) {
                    vec!["ANY".into()]
                } else {
                    vec!["GET".into()]
                };
                ("http", m, "pkg:flask#Flask.route")
            }
            (Some("flask_restx"), "route") => {
                let m = match sym.filter(|s| !s.methods.is_empty()) {
                    Some(s) => s.methods.clone(),
                    None => vec!["ANY".into()],
                };
                ("http", m, "pkg:flask_restx#Namespace.route")
            }
            (Some("celery"), "task") => ("job", vec![], "pkg:celery#Celery.task"),
            _ => {
                // Not a router after all: keep the decorator as a wrap.
                let wrapper = format!("{}.{verb}", self.canon(fi, &rt.receiver));
                extra
                    .fallback
                    .entry(rt.symbol.clone())
                    .or_default()
                    .push((rt.position, wrapper));
                return;
            }
        };
        let adapter = adapter.unwrap_or_default().to_string();
        // A router mounted more than once answers on each mount: one entry point
        // each, with the guards of its own mount. A task is not mounted.
        let mut chains = self.chains(&node, 0);
        if kind == "job" {
            chains.truncate(1);
        }
        let served = Served::of(&chains, |c| match kind {
            "job" => rt
                .name
                .clone()
                .unwrap_or_else(|| self.task_name(fi, &rt.symbol)),
            _ => join_path(&[&c.prefix, rt.path.as_deref().unwrap_or("")]),
        });
        let routes = &served.routes;
        let app_hooks = served.hooks.clone();
        let mut wraps: Vec<Dep> = served.guards.clone();
        wraps.extend(rt.deps.iter().flat_map(|d| self.dep_canon(fi, d, false)));
        if !rt.splat_deps.is_empty() && self.since_measured() {
            wraps.extend(
                rt.splat_deps
                    .iter()
                    .flat_map(|d| self.dep_canon(fi, d, false)),
            );
        }
        if kind == "http"
            && matches!(adapter.as_str(), "fastapi" | "flask")
            && rt.above != (0, 0)
            && self.since_measured()
        {
            // Above every route decorator of the symbol: the least of them.
            let a = extra.above.entry(rt.symbol.clone()).or_insert(rt.above);
            *a = (a.0.min(rt.above.0), a.1.min(rt.above.1));
        }
        if let Some(s) = sym {
            wraps.extend(s.deps.iter().flat_map(|d| self.dep_canon(fi, d, false)));
        }
        {
            // Of every chain, not only what all of them share: a reader that finds
            // one dependency written in two ways on a symbol trusts neither.
            let mut all: Vec<Dep> = wraps.clone();
            all.extend(chains.iter().flat_map(|c| c.guards.iter().cloned()));
            self.dep_shapes(&all, extra.shapes.entry(rt.symbol.clone()).or_default());
        }
        let wraps = self.dep_closure(&wraps);
        let ws = extra.wraps.entry(rt.symbol.clone()).or_default();
        let app_hooks = app_hooks.into_iter().map(|w| Wrap {
            wrapper: w,
            kind: WrapKind::AppHook,
        });
        let wraps = wraps.into_iter().map(|w| Wrap {
            wrapper: w,
            kind: WrapKind::Call,
        });
        let own: Vec<Wrap> = app_hooks.chain(wraps).collect();
        for w in &own {
            if !ws.contains(w) {
                ws.push(w.clone());
            }
        }
        let args = extra.args.entry(rt.symbol.clone()).or_default();
        for k in &rt.keywords {
            if !matches!(k.as_str(), "methods" | "name") {
                args.push(format!("{callee}@{KWARG_INDEX}:{k}"));
            }
        }
        // A routed class-based view: each handler method is the entry point.
        let handlers = self.handlers(fi, &rt.symbol);
        let targets: Vec<(String, Vec<String>)> = if handlers.is_empty() || !rt.methods.is_empty() {
            vec![(rt.symbol.clone(), methods)]
        } else {
            let class_wraps = extra.wraps.get(&rt.symbol).cloned().unwrap_or_default();
            let class_shapes = extra.shapes.get(&rt.symbol).cloned().unwrap_or_default();
            for h in &handlers {
                extra
                    .shapes
                    .entry(h.name.clone())
                    .or_default()
                    .extend(class_shapes.iter().cloned());
                let ws = extra.wraps.entry(h.name.clone()).or_default();
                for w in &class_wraps {
                    if !ws.contains(w) {
                        ws.push(w.clone());
                    }
                }
            }
            handlers
                .iter()
                .map(|h| (h.name.clone(), h.methods.clone()))
                .collect()
        };
        if kind != "job" {
            let class = targets.iter().all(|(t, _)| *t != rt.symbol);
            if class {
                extra
                    .routed
                    .push((rt.symbol.clone(), false, routes.clone(), own.clone()));
            }
            for (symbol, _) in &targets {
                extra
                    .routed
                    .push((symbol.clone(), true, routes.clone(), own.clone()));
            }
        }
        for (symbol, methods) in targets {
            self.mount_facts(&served, &symbol, &mut extra.mounts);
            let methods: Vec<Option<String>> = if methods.is_empty() {
                vec![None]
            } else {
                methods.into_iter().map(Some).collect()
            };
            for method in methods {
                for route in routes {
                    extra.entries.push(EntryPoint {
                        symbol: symbol.clone(),
                        kind: kind.into(),
                        method: method.clone(),
                        route: Some(route.clone()),
                        adapter: adapter.clone(),
                    });
                }
            }
        }
    }

    /// The views a registration that is not placed may be handed through the name
    /// `r` read in file `fi` ([`RawRegistration::candidate`]), as (file, symbol): the
    /// function or class it names; every function and class of a module read as a
    /// value (`getattr(views, name)`); and for a name another module binds to
    /// something else (a table: `ROUTES`), the functions and classes that module
    /// reads as values, and what the names it imports and reads as values hand in
    /// turn, three modules deep.
    fn handed_views(
        &self,
        fi: usize,
        r: &RawRef,
        depth: usize,
        seen: &mut BTreeSet<String>,
        out: &mut BTreeSet<(usize, String)>,
    ) {
        let target = self.canon(fi, r);
        let Some((module, name)) = target.split_once('#') else {
            return;
        };
        if module.contains(':') {
            return;
        }
        let Some(ti) = self.file(module) else {
            return;
        };
        let raw = &self.files[ti].raw;
        let defined = |s: &&RawSymbol| {
            s.owner.is_none()
                && matches!(
                    s.kind,
                    drift_core::SymbolKind::Function | drift_core::SymbolKind::Class
                )
        };
        if name == "*" {
            out.extend(
                raw.symbols
                    .iter()
                    .filter(defined)
                    .map(|s| (ti, s.name.clone())),
            );
            return;
        }
        let first = name.split(['.', '(']).next().unwrap_or(name);
        if raw.symbols.iter().filter(defined).any(|s| s.name == first) {
            out.insert((ti, first.to_string()));
            return;
        }
        if depth >= 3 || !seen.insert(module.to_string()) {
            return;
        }
        out.extend(raw.value_defs.iter().map(|n| (ti, n.clone())));
        for u in &raw.router_uses {
            let mut on = u.on.clone();
            // A method called on the name reads the name (`ROUTES.items()`).
            if u.call {
                match on.member.rfind('.') {
                    Some(dot) => on.member.truncate(dot),
                    None => continue,
                }
            }
            if matches!(on.base, RawBase::Import { .. } | RawBase::Star(_)) {
                self.handed_views(ti, &on, depth + 1, seen, out);
            }
        }
    }

    /// The adapter a registration is listed with on `node`: the one its call says, or
    /// the router's own ([`crate::lower::adapters::OWN_ADAPTER`]). None when the
    /// receiver is no router of a framework the call could be of: a call of the
    /// same name on something else (`handlers.get(kind)(payload)`).
    fn registration_adapter(&self, g: &RawRegistration, node: &str) -> Option<String> {
        let own = self.router_info(node).map(|i| i.adapter.as_str());
        let web = |a: &str| matches!(a, "fastapi" | "flask" | "flask_restx");
        match (g.adapter.as_str(), own) {
            (crate::lower::adapters::OWN_ADAPTER, Some(a)) if web(a) => Some(a.to_string()),
            (crate::lower::adapters::OWN_ADAPTER, _) => None,
            ("flask_restx", own) if g.candidate && !own.is_some_and(web) => None,
            ("flask" | "fastapi", Some(a)) if g.candidate && !web(a) => None,
            (a, _) => Some(a.to_string()),
        }
    }

    fn registration(&self, fi: usize, g: &RawRegistration, extra: &mut BTreeMap<String, Extra>) {
        // A registration call that is not placed: every view it may be handed, at a
        // path that is not known.
        if g.candidate && g.adapter != "django" {
            let mut views = BTreeSet::new();
            self.handed_views(fi, &g.target, 0, &mut BTreeSet::new(), &mut views);
            let nodes = match &g.router {
                Some(r) => self.nodes_of(fi, r),
                None => return,
            };
            for (ti, name) in views {
                let module = self.files[ti].rel_path.as_str();
                if self.untracked(module) || is_test_path(module) {
                    continue;
                }
                let Some(sym) = self.files[ti].raw.symbols.iter().find(|s| s.name == name) else {
                    continue;
                };
                // A class is a view when it has handler methods or is a view class.
                if sym.kind == drift_core::SymbolKind::Class
                    && sym.view.is_none()
                    && self.handlers(ti, &name).is_empty()
                {
                    continue;
                }
                for node in &nodes {
                    let Some(adapter) = self.registration_adapter(g, node) else {
                        continue;
                    };
                    let g = RawRegistration {
                        adapter,
                        ..g.clone()
                    };
                    self.registration_at(fi, &g, node, (module, &name, ti, sym), extra);
                }
            }
            return;
        }
        let target = self.canon(fi, &g.target);
        let Some((module, name)) = target.split_once('#') else {
            return;
        };
        if name.contains(['.', '(']) || name == "*" || self.untracked(module) {
            return;
        }
        let Some(ti) = self.file(module) else {
            return;
        };
        let Some(sym) = self.files[ti].raw.symbols.iter().find(|s| s.name == name) else {
            return;
        };
        // A name beside a `urlpatterns` that is not read is listed when it is a view.
        let view = sym.view.is_some()
            || matches!(&sym.params, RawParams::Own { names, .. }
                if sym.kind == drift_core::SymbolKind::Function
                    && names.first().is_some_and(|n| n == "request"));
        if g.candidate && !view {
            return;
        }
        let nodes = match &g.router {
            Some(r) => self.nodes_of(fi, r),
            None => vec![self.module_of(fi).to_string()],
        };
        for node in nodes {
            if g.adapter == crate::lower::adapters::OWN_ADAPTER {
                let Some(adapter) = self.registration_adapter(g, &node) else {
                    continue;
                };
                let g = RawRegistration {
                    adapter,
                    ..g.clone()
                };
                self.registration_at(fi, &g, &node, (module, name, ti, sym), extra);
                continue;
            }
            self.registration_at(fi, g, &node, (module, name, ti, sym), extra);
        }
    }

    fn registration_at(
        &self,
        fi: usize,
        g: &RawRegistration,
        node: &str,
        (module, name, ti, sym): (&str, &str, usize, &RawSymbol),
        extra: &mut BTreeMap<String, Extra>,
    ) {
        if g.router.is_some()
            && g.adapter == "drf"
            && self.router_info(node).map(|r| r.adapter.as_str()) != Some("drf_router")
        {
            return;
        }
        let django = matches!(g.adapter.as_str(), "django" | "drf");
        // A URLconf that `ROOT_URLCONF` does not reach serves nothing.
        if django && self.is_dead(node) {
            return;
        }
        let settings = if django {
            self.settings_guards(node)
        } else {
            config::Guards::default()
        };
        // A URLconf included more than once, a blueprint registered more than once,
        // answers under each mount, with that mount's guards.
        // A live URLconf with an include Drift cannot follow: the view may be served
        // under it as well, at a path that is not known. Said of each route read.
        let elsewhere = django && self.open_urlconfs.iter().any(|u| !self.is_dead(u));
        // [STRICT] A route of a route table is behind every `middleware=` given on
        // the way from the application to it, as it is behind the application's.
        let mut chains = self.chains(node, 0);
        if !g.behind.is_empty() && self.since_measured() {
            let behind = self.behind_hooks(fi, &g.behind);
            for c in &mut chains {
                for h in &behind {
                    if !c.hooks.contains(h) {
                        c.hooks.push(h.clone());
                    }
                }
            }
        }
        let served = Served::of(&chains, |c| join_path(&[&c.prefix, &g.route]));
        let routes = &served.routes;
        let app_hooks = &served.hooks;
        let adapter = match (g.adapter.as_str(), sym.view.as_deref()) {
            ("django", Some("drf")) => "drf".to_string(),
            // A view whose DRF base is an in-repo class (`class V(AvailableObjectsView)`).
            ("django", _) if self.is_drf_view(module, name) => "drf".to_string(),
            (a, _) => a.to_string(),
        };
        let reg_guards: Vec<String> = g.guards.iter().map(|r| self.canon(fi, r)).collect();
        let methods = if !g.methods.is_empty() {
            g.methods.clone()
        } else if !sym.methods.is_empty() {
            sym.methods.clone()
        } else {
            vec!["ANY".into()]
        };
        let mut guards: Vec<String> = served.guards.iter().map(|d| d.id.clone()).collect();
        guards.extend(reg_guards.iter().cloned());
        // A class-based view with handler methods: each handler is the entry point.
        let handlers = self.handlers(ti, name);
        let targets: Vec<(String, Vec<String>)> = if handlers.is_empty() || !g.methods.is_empty() {
            vec![(name.to_string(), methods)]
        } else {
            handlers
                .iter()
                .map(|h| (h.name.clone(), h.methods.clone()))
                .collect()
        };
        let e = extra.entry(module.to_string()).or_default();
        for (symbol, methods) in targets {
            self.mount_facts(&served, &symbol, &mut e.mounts);
            for route in routes.iter().filter(|_| elsewhere) {
                match e
                    .mounts
                    .iter_mut()
                    .find(|m| m.symbol == symbol && m.route == *route)
                {
                    Some(m) => m.elsewhere = true,
                    None => e.mounts.push(drift_core::MountFacts {
                        symbol: symbol.clone(),
                        route: route.clone(),
                        elsewhere: true,
                        ..Default::default()
                    }),
                }
            }
            for m in methods {
                for route in routes {
                    e.entries.push(EntryPoint {
                        symbol: symbol.clone(),
                        kind: "http".into(),
                        method: Some(m.clone()),
                        route: Some(route.clone()),
                        adapter: adapter.clone(),
                    });
                }
            }
            let (cfg, drf_inherited) =
                self.view_settings_guards(ti, &symbol, &adapter, &settings, &reg_guards);
            let hooks = app_hooks.iter().map(|w| Wrap {
                wrapper: w.clone(),
                kind: WrapKind::AppHook,
            });
            let guards = guards.iter().map(|w| Wrap {
                wrapper: w.clone(),
                kind: WrapKind::Call,
            });
            let mut own: Vec<Wrap> = hooks.chain(guards).collect();
            // What Django's application object is served through answers before
            // any view, as an application's middleware does. Read since the
            // measured build.
            if matches!(adapter.as_str(), "django" | "drf")
                && !self.django_served.is_empty()
                && self.since_measured()
            {
                own.extend(self.django_served.iter().map(|w| Wrap {
                    wrapper: w.clone(),
                    kind: WrapKind::AppHook,
                }));
            }
            // How the wrappers written at the registration are called, and those
            // the measured build did not read ([`RawRegistration::since_guards`]).
            let shapes = e.shapes.entry(symbol.clone()).or_default();
            shapes.extend(
                g.shapes
                    .iter()
                    .map(|(r, shape)| format!("{}{shape}", self.canon(fi, r))),
            );
            if !g.since_guards.is_empty() && self.since_measured() {
                for (r, text) in &g.since_guards {
                    let wrapper = match r {
                        Some(r) => {
                            let c = self.canon(fi, r);
                            shapes.insert(format!("{c}{text}"));
                            c
                        }
                        None => format!("unresolved:{text}"),
                    };
                    own.push(Wrap {
                        wrapper,
                        kind: WrapKind::Decorator,
                    });
                }
            }
            e.routed
                .push((symbol.clone(), true, routes.clone(), own.clone()));
            let ws = e.wraps.entry(symbol.clone()).or_default();
            for w in own.into_iter().chain(drf_inherited) {
                if !ws.contains(&w) {
                    ws.push(w);
                }
            }
            let cs = e.config.entry(symbol).or_default();
            for w in cfg {
                if !cs.contains(&w) {
                    cs.push(w);
                }
            }
        }
    }

    /// Handler-method symbols of class `class` in file `fi` (`PostDetail.get`).
    ///
    /// A class no view base is read for has its handler methods as symbols of the
    /// second link only ([`RawSymbol::late`]): the measured build served the class.
    fn handlers(&self, fi: usize, class: &str) -> Vec<&RawSymbol> {
        let of = |late: bool| -> Vec<&RawSymbol> {
            self.files[fi]
                .raw
                .symbols
                .iter()
                .filter(|s| s.owner.as_deref() == Some(class) && s.late == late)
                .collect()
        };
        let own = of(false);
        if !own.is_empty() {
            return own;
        }
        let late = of(true);
        if !late.is_empty() && self.since_measured() {
            late
        } else {
            own
        }
    }

    // ------------------------------------------------------------------ final facts

    fn exported(&self, fi: usize, name: &str, binding: &RawBinding) -> bool {
        let raw = &self.files[fi].raw;
        if let Some(all) = &raw.all {
            return all.iter().any(|n| n == name);
        }
        if name.starts_with('_') {
            return false;
        }
        let is_init = self.files[fi].rel_path.ends_with("__init__.py");
        match binding {
            RawBinding::Local => true,
            // A package's `__init__` re-exports what it imports from the repo (its own
            // submodules, sibling packages); `import x as x` is explicit anywhere.
            RawBinding::Import { explicit, spec, .. } => {
                *explicit || (is_init && self.specs[fi].get(spec).is_some_and(|m| !m.contains(':')))
            }
        }
    }

    /// Produce final facts for file `fi`.
    pub fn link(&self, fi: usize, package: String) -> FileFacts {
        let f = &self.files[fi];
        let rel = f.rel_path.as_str();
        let raw = &f.raw;
        let spec_of = |s: &str| {
            self.specs[fi]
                .get(s)
                .cloned()
                .unwrap_or_else(|| format!("unresolved:{s}"))
        };

        let mut imports = Vec::new();
        for i in &raw.imports {
            let module = spec_of(&i.spec);
            let mut names = Vec::new();
            for n in &i.names {
                if i.from && n != "*" && !module.contains(':') {
                    let o = self.origin(&module, n);
                    if let Some(sub) = o.strip_suffix("#*")
                        && sub != module
                    {
                        imports.push(Import {
                            module: sub.to_string(),
                            names: vec!["*".into()],
                            type_only: i.type_only,
                            load: drift_core::ImportLoad::Static,
                        });
                        continue;
                    }
                }
                names.push(n.clone());
            }
            if !names.is_empty() {
                imports.push(Import {
                    module,
                    names,
                    type_only: i.type_only,
                    load: drift_core::ImportLoad::Static,
                });
            }
        }

        let mut exports = Vec::new();
        let mut exported_as: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut explicit = BTreeSet::new();
        for (name, b) in &raw.bindings {
            if !self.exported(fi, name, b) {
                continue;
            }
            explicit.insert(name.clone());
            match b {
                RawBinding::Local => {
                    exported_as
                        .entry(name.clone())
                        .or_default()
                        .push(name.clone());
                    exports.push(Export {
                        name: name.clone(),
                        origin: format!("{rel}#{name}"),
                        kind: ExportKind::Local,
                    });
                }
                RawBinding::Import { .. } => exports.push(Export {
                    name: name.clone(),
                    origin: fold_external(&self.origin(rel, name)),
                    kind: ExportKind::ReExport,
                }),
            }
        }
        // `__all__` names that are submodules or come from star imports.
        if let Some(all) = &raw.all {
            for n in all {
                if !explicit.contains(n) && explicit.insert(n.clone()) {
                    exports.push(Export {
                        name: n.clone(),
                        origin: fold_external(&self.origin(rel, n)),
                        kind: ExportKind::ReExport,
                    });
                }
            }
        }
        for spec in &raw.star_imports {
            let module = spec_of(spec);
            exports.push(Export {
                name: "*".into(),
                origin: format!("{module}#*"),
                kind: ExportKind::ReExportAll,
            });
            if raw.all.is_some() {
                continue;
            }
            for n in self.star_names(&module, 0, &mut BTreeSet::new()) {
                if explicit.insert(n.clone()) {
                    exports.push(Export {
                        origin: fold_external(&self.origin(&module, &n)),
                        name: n,
                        kind: ExportKind::ReExportAll,
                    });
                }
            }
        }

        let extra = self.extra.get(rel).cloned().unwrap_or_default();
        let mut entry_points: Vec<EntryPoint> = raw
            .entry_points
            .iter()
            .map(|e| self.named_entry(fi, e))
            .collect();
        entry_points.extend(extra.entries.iter().cloned());
        entry_points.extend(self.consumers(fi));
        // A declared entry point the file's own code already shows (a console script
        // naming the `main` an `if __name__` guard runs through argparse) is that entry
        // point, not a second one: the one read from the code is kept.
        for d in self.declared.get(rel).into_iter().flatten() {
            if !entry_points
                .iter()
                .any(|e| e.symbol == d.symbol && e.kind == d.kind)
            {
                entry_points.push(d.clone());
            }
        }
        let http_entries: BTreeSet<String> = entry_points
            .iter()
            .filter(|e| e.kind == "http")
            .map(|e| e.symbol.clone())
            .collect();
        let test_file = is_test_path(rel);
        for e in &entry_points {
            let v = exported_as.entry(e.symbol.clone()).or_default();
            if !v.contains(&e.symbol) {
                v.push(e.symbol.clone());
            }
        }

        let symbols = raw
            .symbols
            .iter()
            // A handler method of a class no view base is read for is a symbol where
            // an entry point names it ([`RawSymbol::late`]).
            .filter(|s| !s.late || entry_points.iter().any(|e| e.symbol == s.name))
            .map(|s| {
                let mut wraps: Vec<Wrap> = Vec::new();
                // A decorator written above the route decorator of a Flask or
                // FastAPI route wraps a function no request reaches
                // ([`RawRoute::above`]): no wrap of the route, since the measured
                // build.
                let skip = extra.above.get(&s.name).map_or(0, |a| a.0 as usize);
                // `permission_classes` assigned on the class after its body: the
                // classes of its body are no longer its permissions
                // ([`RawSymbol::drf_reassigned`]), since the measured build.
                // (A handler method holds its class's.)
                let holder = match &s.owner {
                    Some(class) => raw
                        .symbols
                        .iter()
                        .find(|c| c.name == *class && c.kind == drift_core::SymbolKind::Class),
                    None => Some(s),
                };
                let reassigned = holder
                    .and_then(|h| h.drf_reassigned.as_ref())
                    .filter(|_| self.since_measured());
                let replaced = |r: &RawRef, k: WrapKind| {
                    reassigned.is_some()
                        && k == WrapKind::Call
                        && holder
                            .and_then(|h| h.drf_permissions.as_ref())
                            .is_some_and(|own| own.contains(r))
                };
                // The DRF class attributes of a class served as a view that is no DRF
                // view (`class SignOut(View): permission_classes = [...]`): Django's
                // `View` never runs them, so they are no guard of its handlers; where
                // a base is not read, whether one runs them is not known
                // ([`config::Linker::drf_attrs`]). Since the measured build.
                let attrs = holder
                    .filter(|h| {
                        h.kind == drift_core::SymbolKind::Class
                            && (h.drf_permissions.is_some()
                                || h.drf_authentication.is_some()
                                || h.drf_reassigned.is_some())
                    })
                    .filter(|h| {
                        let method = format!("{}.", h.name);
                        let served: Vec<&EntryPoint> = entry_points
                            .iter()
                            .filter(|e| {
                                e.kind == "http"
                                    && (e.symbol == h.name || e.symbol.starts_with(&method))
                            })
                            .collect();
                        !served.is_empty() && served.iter().all(|e| e.adapter != "drf")
                    })
                    .filter(|_| self.since_measured())
                    .map_or(config::DrfAttrs::Read, |h| self.drf_attrs(rel, &h.name));
                let class_attr = |r: &RawRef, k: WrapKind| {
                    attrs != config::DrfAttrs::Read
                        && holder.is_some_and(|h| match k {
                            WrapKind::Call => {
                                h.drf_permissions.as_ref().is_some_and(|l| l.contains(r))
                            }
                            WrapKind::Authenticates => {
                                h.drf_authentication.as_ref().is_some_and(|l| l.contains(r))
                            }
                            _ => false,
                        })
                };
                if let config::DrfAttrs::Unread(base) = &attrs {
                    wraps.push(Wrap {
                        wrapper: format!(
                            "unresolved:permission_classes, run only if {base} reads them"
                        ),
                        kind: WrapKind::Call,
                    });
                }
                // A decorator of the class that applies to one method only
                // ([`RawSymbol::wraps_only`]): no wrap of another method, nor of the
                // class, since the measured build.
                // A class that is its own route's handler: no method of it is one.
                let handler_class = s.owner.is_none()
                    && s.kind == drift_core::SymbolKind::Class
                    && !raw
                        .symbols
                        .iter()
                        .any(|x| x.owner.as_deref() == Some(s.name.as_str()) && !x.late);
                let only_live = !s.wraps_only.is_empty() && self.since_measured();
                let method = s
                    .owner
                    .as_ref()
                    .and_then(|_| s.name.rsplit_once('.'))
                    .map(|(_, m)| m);
                for (r, k) in s.wraps.iter().skip(skip) {
                    if replaced(r, *k) || class_attr(r, *k) {
                        continue;
                    }
                    let only: Vec<&Option<String>> = if only_live && *k == WrapKind::Decorator {
                        s.wraps_only
                            .iter()
                            .filter(|(o, _)| o == r)
                            .map(|(_, m)| m)
                            .collect()
                    } else {
                        Vec::new()
                    };
                    let wrapper = if *k == WrapKind::Try {
                        "try".to_string()
                    } else if only.iter().any(|m| m.is_none()) {
                        // Which method it applies to is not read.
                        format!("unresolved:method_decorator({})", self.canon(fi, r))
                    } else if !only.is_empty()
                        && !method.is_some_and(|m| only.iter().any(|o| o.as_deref() == Some(m)))
                    {
                        // A class that is its own route's handler (no method of it is
                        // one: it inherits them) runs the method the decorator
                        // replaces (`@method_decorator(login_required, name="get")`
                        // on a class whose `get` is its base's), and maybe others:
                        // which of them a request runs is not read.
                        if handler_class {
                            format!("unresolved:method_decorator({})", self.canon(fi, r))
                        } else {
                            continue;
                        }
                    } else {
                        self.canon(fi, r)
                    };
                    let w = Wrap { wrapper, kind: *k };
                    if !wraps.contains(&w) {
                        wraps.push(w);
                    }
                }
                // A Django route's handler, a class of its own or a method of one, built
                // on a class of the repository that a decorator wraps or one of whose
                // methods a decorator wraps (`@method_decorator(login_required,
                // name="get")`, `@method_decorator(login_required)` on its `get`):
                // Django's `method_decorator` replaces the base's method, which the
                // handler may inherit. Which of the base's methods the route runs, and
                // so which decorators, is not read: unresolved, since the measured
                // build.
                // (Django's and DRF's views: a Flask view's `decorators` list is a
                // class attribute its subclasses inherit, read where it is listed.)
                let django_view = entry_points.iter().any(|e| {
                    e.kind == "http"
                        && e.symbol == s.name
                        && matches!(e.adapter.as_str(), "django" | "drf")
                });
                if django_view && self.since_measured() {
                    let class = s.owner.as_deref().unwrap_or(s.name.as_str());
                    let own = format!("{rel}#{class}");
                    for a in self.class_chain(&own).iter().skip(1) {
                        let decorated = self.symbol_at(a).is_some_and(|(aj, sym)| {
                            let decorates = |x: &RawSymbol| {
                                x.wraps.iter().any(|(_, k)| *k == WrapKind::Decorator)
                                    || !x.since_wraps.is_empty()
                            };
                            sym.kind == drift_core::SymbolKind::Class
                                && (decorates(sym)
                                    || self.files[aj].raw.symbols.iter().any(|m| {
                                        m.owner.as_deref() == Some(sym.name.as_str())
                                            && decorates(m)
                                    }))
                        });
                        if decorated {
                            let w = Wrap {
                                wrapper: format!("unresolved:decorators inherited from {a}"),
                                kind: WrapKind::Decorator,
                            };
                            if !wraps.contains(&w) {
                                wraps.push(w);
                            }
                        }
                    }
                }
                // A decorator that is no name: kept by its words, since the measured
                // build ([`RawSymbol::unread_wraps`]). Last first, so that each
                // lands where it was written.
                if let Some(now) = reassigned.filter(|_| attrs == config::DrfAttrs::Read) {
                    let given: Vec<String> = match &now.unread {
                        Some(words) => vec![format!("unresolved:{words}")],
                        None => now
                            .classes
                            .iter()
                            .flatten()
                            .map(|r| self.canon(fi, r))
                            .collect(),
                    };
                    for wrapper in given {
                        let w = Wrap {
                            wrapper,
                            kind: WrapKind::Call,
                        };
                        if !wraps.contains(&w) {
                            wraps.push(w);
                        }
                    }
                }
                // Since the measured build ([`RawSymbol::since_wraps`]). Last first, so
                // that each lands where it was written.
                let (above, above_since) = extra.above.get(&s.name).copied().unwrap_or((0, 0));
                if !s.since_wraps.is_empty() && self.since_measured() {
                    // The list a view class applies: where the class is a Flask
                    // view; where a class of the repository stands between, what
                    // that class does with the list is not read.
                    let bases = || {
                        s.wraps
                            .iter()
                            .filter(|(_, k)| *k == WrapKind::Extends)
                            .map(|(r, _)| self.canon(fi, r))
                    };
                    let flask_view =
                        bases().any(|b| FLASK_VIEW_PACKAGES.iter().any(|p| b.starts_with(p)));
                    let own_base =
                        bases().any(|b| !b.starts_with("pkg:") && !b.starts_with("global#"));
                    let applied: Vec<(u32, String)> = if !s.view_decorators || flask_view {
                        s.since_wraps
                            .iter()
                            .enumerate()
                            .skip(above_since as usize)
                            // One method's own ([`RawSymbol::since_only`]): on that
                            // method's symbol; on a class that is its own route's
                            // handler (it inherits the method), unresolved.
                            .filter(|(i, _)| {
                                handler_class
                                    || !s.since_only.iter().any(|(j, _)| *j as usize == *i)
                            })
                            .map(|(i, (pos, r, words))| {
                                let w = match r {
                                    Some(r)
                                        if handler_class
                                            && s.since_only
                                                .iter()
                                                .any(|(j, _)| *j as usize == i) =>
                                    {
                                        format!(
                                            "unresolved:method_decorator({})",
                                            self.canon(fi, r)
                                        )
                                    }
                                    Some(r) => self.canon(fi, r),
                                    None => format!("unresolved:{words}"),
                                };
                                (pos.saturating_sub(above), w)
                            })
                            .collect()
                    } else if own_base {
                        vec![(0, format!("unresolved:{}.decorators", s.name))]
                    } else {
                        vec![]
                    };
                    for (pos, wrapper) in applied.into_iter().rev() {
                        let at = (pos as usize).min(wraps.len());
                        wraps.insert(
                            at,
                            Wrap {
                                wrapper,
                                kind: WrapKind::Decorator,
                            },
                        );
                    }
                }
                if let Some(fb) = extra.fallback.get(&s.name) {
                    for (pos, w) in fb {
                        let at = (*pos as usize).min(wraps.len());
                        wraps.insert(
                            at,
                            Wrap {
                                wrapper: w.clone(),
                                kind: WrapKind::Decorator,
                            },
                        );
                    }
                }
                let pre = extra.config.get(&s.name).into_iter().flatten();
                let pre = pre.chain(extra.wraps.get(&s.name).into_iter().flatten());
                // The permission classes the view declares that its
                // `get_permissions` does not return for this handler
                // ([`config::REPLACES`]).
                // On the view class too, for a class one of whose handlers does not
                // run it: each handler carries its own, and a reader that asks the
                // class would be told of a guard that handler does not have.
                let of_class = format!("{}.", s.name);
                let replaced: Vec<&str> = extra
                    .wraps
                    .iter()
                    .filter(|(symbol, _)| {
                        **symbol == s.name
                            || (s.kind == drift_core::SymbolKind::Class
                                && symbol.starts_with(&of_class))
                    })
                    .flat_map(|(_, ws)| ws)
                    .filter_map(|w| w.wrapper.strip_prefix(config::REPLACES))
                    .collect();
                let mut all: Vec<Wrap> = Vec::new();
                let mut app_middleware: Vec<String> = Vec::new();
                for mut w in pre.cloned().chain(wraps) {
                    if w.wrapper.starts_with(config::REPLACES)
                        || (w.kind == WrapKind::Call && replaced.contains(&w.wrapper.as_str()))
                    {
                        continue;
                    }
                    // Application middleware is no wrap of the route.
                    if let Some(m) = middleware_of(&w.wrapper) {
                        app_middleware.push(m);
                        continue;
                    }
                    // `AllowAny`, `@login_not_required`: an opening, not a guard.
                    if matches!(
                        w.kind,
                        WrapKind::Call | WrapKind::Decorator | WrapKind::Config
                    ) && config::OPENS.contains(&w.wrapper.as_str())
                    {
                        w.kind = WrapKind::Opens;
                    }
                    if !all.contains(&w) {
                        all.push(w);
                    }
                }
                wraps = all;
                let mut args: Vec<String> = s
                    .args
                    .iter()
                    .map(|(r, i, k)| format!("{}@{i}:{k}", self.canon(fi, r)))
                    .collect();
                if let Some(a) = extra.args.get(&s.name) {
                    args.extend(a.iter().cloned());
                }
                let mut calls: Vec<String> = s.calls.iter().map(|r| self.canon(fi, r)).collect();
                calls.extend(self.returned_refs(fi, s));
                let mut omits: Vec<String> = s
                    .omits
                    .iter()
                    .map(|(r, i, k)| format!("{}@{i}:{k}", self.canon(fi, r)))
                    .collect();
                omits.sort();
                omits.dedup();
                // Every base of the class is a package's (and known).
                let library_bases = {
                    let mut bases = wraps
                        .iter()
                        .filter(|w| w.kind == WrapKind::Extends)
                        .peekable();
                    bases.peek().is_some() && bases.all(|w| w.wrapper.starts_with("pkg:"))
                };
                Symbol {
                    name: s.name.clone(),
                    kind: s.kind,
                    exported_as: exported_as.get(&s.name).cloned().unwrap_or_default(),
                    line: s.line,
                    renders: vec![],
                    args,
                    omits,
                    declares: {
                        let mut d: Vec<String> = s
                            .declares
                            .iter()
                            .map(|(a, r)| match r {
                                Some(r) => format!("{a}={}", self.canon(fi, r)),
                                None => format!("{a}="),
                            })
                            .collect();
                        d.sort();
                        d.dedup();
                        d
                    },
                    controls: {
                        let mut c = s.controls.clone();
                        self.measured_exits(&mut c);
                        // `response_model=None`: read since the measured build.
                        let no_model = drift_core::controls::NO_RESPONSE_MODEL;
                        if c.iter().any(|x| x == no_model) && !self.since_measured() {
                            c.retain(|x| x != no_model);
                        }
                        // A dependency the repository replaces, since the measured
                        // build.
                        if !self.overridden.is_empty()
                            && (self.overridden.contains("*")
                                || self.overridden.contains(&format!("{rel}#{}", s.name)))
                            && self.since_measured()
                        {
                            c.push(drift_core::controls::OVERRIDDEN.to_string());
                        }
                        if http_entries.contains(&s.name)
                            && let Some(u) = &s.input_use
                            && let Some(x) = self.input_control(fi, u)
                        {
                            c.push(x.to_string());
                        }
                        // Every input it takes is parsed by its declared type before
                        // the body runs, since the measured build.
                        if http_entries.contains(&s.name)
                            && let Some(u) = &s.input_use
                            && self.input_typed(
                                fi,
                                u,
                                &entry_points
                                    .iter()
                                    .filter(|e| e.kind == "http" && e.symbol == s.name)
                                    .collect::<Vec<_>>(),
                            )
                            && self.since_measured()
                        {
                            c.push(drift_core::controls::INPUT_TYPED.to_string());
                        }
                        // How what stands at its guard positions is written: its
                        // own calls (a decorator, the call a variable's value is),
                        // and its dependencies where one of a callee is a call.
                        let mut shapes: BTreeSet<String> = s
                            .shapes
                            .iter()
                            .map(|(r, shape)| format!("{}{shape}", self.canon(fi, r)))
                            // (The standard library's: nothing a reader asks of.)
                            .filter(|x| !x.starts_with("pkg:python:"))
                            .collect();
                        // What the name's value is, where one assignment says it.
                        shapes.extend(s.values.iter().map(|(r, shape)| match r {
                            Some(r) => format!("={}{shape}", self.canon(fi, r)),
                            None => "=".to_string(),
                        }));
                        if let Some(deps) = extra.shapes.get(&s.name) {
                            let called: BTreeSet<&str> = deps
                                .iter()
                                .filter_map(|d| d.split_once('(').map(|(callee, _)| callee))
                                .collect();
                            shapes.extend(
                                deps.iter()
                                    .filter(|d| {
                                        called.contains(d.split('(').next().unwrap_or_default())
                                    })
                                    .cloned(),
                            );
                        }
                        c.extend(
                            shapes
                                .into_iter()
                                .map(|x| format!("{}{x}", drift_core::controls::SHAPE)),
                        );
                        // What the body does with what a call hands back, where a
                        // reader asks: it returns it when there is something, for a
                        // callee of the repository that turns callers away by the
                        // value it returns; or every call of the callee is a
                        // statement of its own, for such a callee and for a
                        // package's (not the standard library's).
                        let returns_rejection = |callee: &str| {
                            self.symbol_at(callee).is_some_and(|(_, d)| {
                                d.controls
                                    .iter()
                                    .any(|x| x == drift_core::controls::RETURNS_REJECTION)
                            })
                        };
                        for r in &s.returns_result_of {
                            let callee = self.canon(fi, r);
                            if returns_rejection(&callee) {
                                c.push(format!(
                                    "{}@{callee}",
                                    drift_core::controls::RETURNS_RESULT_OF
                                ));
                            }
                        }
                        let dropped = |r: &RawRef| {
                            let mut whys = s
                                .conditional_calls
                                .iter()
                                .filter(|(x, _)| x == r)
                                .map(|(_, why)| why.as_str());
                            whys.next() == Some(drift_core::not_always::NOT_AWAITED)
                                && whys.next().is_none()
                        };
                        let mut seen = BTreeSet::new();
                        for (r, _) in &s.conditional_calls {
                            if !seen.insert(r) || !dropped(r) {
                                continue;
                            }
                            let callee = self.canon(fi, r);
                            let package =
                                callee.starts_with("pkg:") && !callee.starts_with("pkg:python:");
                            // (Not what is called only for a method of its result,
                            // `Webhook(secret).verify(...)`: that value is used.)
                            let receiver = format!("{callee}().");
                            let used = s
                                .calls
                                .iter()
                                .any(|x| self.canon(fi, x).starts_with(&receiver));
                            if (package || returns_rejection(&callee))
                                && !used
                                && !self.async_defs.contains(&callee)
                            {
                                c.push(format!(
                                    "{}{callee}",
                                    drift_core::controls::DROPS_RESULT_OF
                                ));
                            }
                        }
                        // A webhook signature verifier that raises, called on every
                        // request and not in a `try` whose handler goes on: no call
                        // of it has a reason, but that its value is dropped (the
                        // verifiers of the list are not `async`: a dropped call
                        // runs, and raises).
                        let every = |why: &str| {
                            why.is_empty() || why == drift_core::not_always::NOT_AWAITED
                        };
                        let mut verifies = BTreeSet::new();
                        for (r, _) in &s.conditional_calls {
                            let callee = self.canon(fi, r);
                            if drift_core::guard_lists::signature_verifier(&callee)
                                .is_some_and(|v| v.throws)
                                && s.conditional_calls
                                    .iter()
                                    .filter(|(x, _)| x == r)
                                    .all(|(_, w)| every(w))
                            {
                                verifies.insert(callee);
                            }
                        }
                        c.extend(verifies.into_iter().map(|callee| {
                            format!("{}{callee}", drift_core::controls::VERIFIES_SIGNATURE)
                        }));
                        c.extend(self.origins(
                            fi,
                            &s.check_sides,
                            &s.filter_values,
                            &s.arg_sides,
                            &s.typed_calls,
                        ));
                        c.extend(self.row_sets(fi, &s.row_sets));
                        c.extend(s.fed_sinks.iter().map(|k| fed_control(k)));
                        // Handed on to code of the repository: what a built-in or a
                        // package does with it is not followed.
                        c.extend(
                            s.param_passes
                                .iter()
                                .map(|r| self.canon(fi, r))
                                .filter(|c| !c.starts_with("global#") && !c.starts_with("pkg:"))
                                .map(|c| format!("{}{c}", drift_core::controls::PASSES_PARAM)),
                        );
                        c.extend(self.held(fi, &s.held));
                        c.extend(self.rows(fi, &s.rows));
                        // What every return of the function reads its value off
                        // ([`drift_core::controls::RETURNS_GIVEN`]): said only where
                        // each dependency stands for something here.
                        let given: Vec<Vec<Dep>> = s
                            .returns_given
                            .iter()
                            .map(|d| self.dep_canon(fi, d, false))
                            .collect();
                        if !given.is_empty() && given.iter().all(|deps| !deps.is_empty()) {
                            c.extend(given.iter().flatten().map(|dep| {
                                format!("{}{}", drift_core::controls::RETURNS_GIVEN, dep.id)
                            }));
                        }
                        c.extend(s.attr_params.iter().map(|(attr, param, i)| {
                            format!("{}{attr}\t{param}\t{i}", drift_core::controls::ATTR_PARAM)
                        }));
                        // What the lowering read for one reading only.
                        self.since_marked(&mut c);
                        c.sort();
                        c.dedup();
                        c
                    },
                    string_literals: s.string_literals,
                    suppressions: s.suppressions.clone(),
                    reads: s.reads.clone(),
                    throws: s.throws.iter().map(|r| self.canon(fi, r)).collect(),
                    sinks: self.sinks_read(&s.sinks, &s.since_sinks),
                    order: s.order.iter().map(|r| self.canon(fi, r)).collect(),
                    traits: if s.kind == drift_core::SymbolKind::Class {
                        let mut t = s.traits.clone();
                        t.extend(crate::kinds::direct_traits(&wraps));
                        t
                    } else {
                        let mut t = crate::kinds::value_traits(s.kind, &calls);
                        // A thin wrapper of a library function of its own name: it
                        // passes a parameter of its own to every such call it makes
                        // (`button(**kwargs)` -> `tag.button(**kwargs)`). In-repo
                        // callees (itself, a module-level `session.get`) and
                        // built-ins do not count; one same-name library call it does
                        // not forward to (`os.environ.get` next to `session.get`) is
                        // enough to say no.
                        let namesakes: Vec<&String> = calls
                            .iter()
                            .filter(|c| {
                                c.split_once('#').is_some_and(|(m, p)| {
                                    m.starts_with("pkg:")
                                        && p.rsplit('.').next() == Some(s.name.as_str())
                                })
                            })
                            .collect();
                        let forwarded: BTreeSet<String> =
                            s.forwards.iter().map(|r| self.canon(fi, r)).collect();
                        if !namesakes.is_empty() && namesakes.iter().all(|c| forwarded.contains(*c))
                        {
                            t.push(drift_core::traits::FORWARDS.to_string());
                            t.sort();
                        }
                        t
                    },
                    calls,
                    wraps,
                    arg_types: vec![],
                    after_continuation: {
                        // Two references may name one callee: met before under either
                        // name, it is met before.
                        let before: BTreeSet<String> = s
                            .calls
                            .iter()
                            .chain(&s.throws)
                            .filter(|r| !s.after_continuation.contains(r))
                            .map(|r| self.canon(fi, r))
                            .collect();
                        let mut a: Vec<String> = s
                            .after_continuation
                            .iter()
                            .map(|r| self.canon(fi, r))
                            .filter(|r| !before.contains(r))
                            .collect();
                        a.sort();
                        a.dedup();
                        a
                    },
                    // Python records no field decorators and no derived bindings.
                    field_decorators: vec![],
                    meta: s
                        .meta
                        .iter()
                        .map(|(k, r)| match r {
                            Some(r) => format!("{k}={}", self.canon(fi, r)),
                            None => k.clone(),
                        })
                        .collect(),
                    decorator_args: s
                        .decorator_args
                        .iter()
                        .map(|(d, a)| format!("{}={}", self.canon(fi, d), self.canon(fi, a)))
                        .collect(),
                    disclaims: s.disclaims.clone(),
                    derives_from: String::new(),
                    returns_wrapped_by: vec![],
                    made_by: String::new(),
                    members: s
                        .members
                        .iter()
                        .map(|m| drift_core::Member {
                            name: m.name.clone(),
                            calls: m.calls.iter().map(|r| self.canon(fi, r)).collect(),
                            sinks: self.sinks_read(&m.sinks, &m.since_sinks),
                            body_checks: m
                                .body_checks
                                .iter()
                                .filter(|b| self.reads_check(b))
                                .map(|b| drift_core::BodyCheck {
                                    source: self.operand(fi, &b.source, false),
                                    reads: b.reads.clone(),
                                    compares: self.operand(fi, &b.compares, true),
                                    outcome: b.outcome,
                                    op: b.op.clone(),
                                    conditional: b.conditional,
                                    condition: b.condition.clone(),
                                    unless: b.unless.clone(),
                                    compares_path: String::new(),
                                    after: self.after(fi, &b.after),
                                })
                                .collect(),
                            throws: m.throws.iter().map(|r| self.canon(fi, r)).collect(),
                            args: m
                                .args
                                .iter()
                                .map(|(r, i, k)| format!("{}@{i}:{k}", self.canon(fi, r)))
                                .collect(),
                            scoped_queries: m
                                .scoped
                                .iter()
                                .map(|q| self.scoped_query(fi, q))
                                .collect(),
                            raise_checks: m
                                .raise_checks
                                .iter()
                                .map(|c| self.raise_check(fi, c))
                                .collect(),
                            // A package's or a built-in's decorator is the
                            // library's: only the repository's own are kept.
                            decorators: m
                                .decorators
                                .iter()
                                .map(|r| self.canon(fi, r))
                                .filter(|c| !c.starts_with("pkg:") && !c.starts_with("global#"))
                                .collect(),
                            receiver_calls: {
                                // `self.assertTrue(x)` in a class built on a
                                // library's classes alone is the library's method.
                                let library = library_bases;
                                let own = format!("{rel}#{}.", s.name);
                                let mut calls = self.receiver_calls(fi, &m.receiver_calls);
                                // So is what `super()` stands for there.
                                calls.retain(|c| {
                                    !(library
                                        && (c.starts_with("local:super().")
                                            || c.strip_prefix(&own)
                                                .is_some_and(|rest| !rest.contains('.'))))
                                });
                                calls
                            },
                            conditional_calls: self.conditional_calls(fi, &m.conditional_calls),
                            order: self.after(fi, &m.order),
                            caller_args: self.caller_args(fi, &m.caller_args),
                            unread: {
                                let mut unread = m.unread.clone();
                                self.measured_exits(&mut unread);
                                unread.extend(m.fed_sinks.iter().map(|k| fed_control(k)));
                                unread.extend(
                                    m.param_passes
                                        .iter()
                                        .map(|r| self.canon(fi, r))
                                        .filter(|c| {
                                            !c.starts_with("global#") && !c.starts_with("pkg:")
                                        })
                                        .map(|c| {
                                            format!("{}{c}", drift_core::controls::PASSES_PARAM)
                                        }),
                                );
                                unread.extend(self.held(fi, &m.held));
                                unread.extend(self.rows(fi, &m.rows));
                                unread.extend(self.origins(
                                    fi,
                                    &m.check_sides,
                                    &m.filter_values,
                                    &m.arg_sides,
                                    &m.typed_calls,
                                ));
                                unread.extend(self.row_sets(fi, &m.row_sets));
                                // What the lowering read for one reading only.
                                self.since_marked(&mut unread);
                                unread
                            },
                            is_async: m.is_async,
                            ..Default::default()
                        })
                        .collect(),
                    truncated: vec![],
                    server_reads: vec![],
                    body_checks: s
                        .body_checks
                        .iter()
                        .filter(|b| self.reads_check(b))
                        .map(|b| drift_core::BodyCheck {
                            source: self.operand(fi, &b.source, false),
                            reads: b.reads.clone(),
                            compares: self.operand(fi, &b.compares, true),
                            outcome: b.outcome,
                            op: b.op.clone(),
                            conditional: b.conditional,
                            condition: b.condition.clone(),
                            unless: b.unless.clone(),
                            compares_path: String::new(),
                            after: self.after(fi, &b.after),
                        })
                        .collect(),
                    responses: s
                        .responses
                        .iter()
                        .map(|r| drift_core::ResponseFact {
                            status: r.status,
                            via: r.via,
                            builder: r
                                .builder
                                .as_ref()
                                .map(|b| self.canon(fi, b))
                                .unwrap_or_default(),
                            model: r
                                .model
                                .as_ref()
                                .map(|m| self.canon(fi, m))
                                .unwrap_or_default(),
                            keys: r.keys.clone(),
                            in_catch: r.in_catch,
                        })
                        .collect(),
                    log_calls: s
                        .log_calls
                        .iter()
                        .map(|l| drift_core::LogCall {
                            callee: match &l.param {
                                Some(p) => format!("param:{p}"),
                                None => self.canon(fi, &l.callee),
                            },
                            level: l.level.clone(),
                            in_catch: l.in_catch,
                            structured: l.structured,
                            passes_error: l.passes_error,
                            bound: l.bound,
                        })
                        .collect(),
                    catches: s.catches.iter().map(|c| self.catch_fact(fi, c)).collect(),
                    headers: s.headers.clone(),
                    inputs: s
                        .inputs
                        .iter()
                        .filter_map(|i| match i {
                            RawInput::Validated(r) => Some(self.canon(fi, r)),
                            RawInput::Param(r) if http_entries.contains(&s.name) => {
                                let c = self.canon(fi, r);
                                self.is_repo_class(&c).then_some(c)
                            }
                            RawInput::Param(_) => None,
                        })
                        .collect(),
                    handles_errors: {
                        let mut h: Vec<String> =
                            s.handles.iter().map(|x| self.handled(fi, x)).collect();
                        if let Some(more) = self.handles.get(&format!("{rel}#{}", s.name)) {
                            h.extend(more.iter().cloned());
                        }
                        h
                    },
                    scoped_queries: s.scoped.iter().map(|q| self.scoped_query(fi, q)).collect(),
                    raise_checks: s
                        .raise_checks
                        .iter()
                        .map(|c| self.raise_check(fi, c))
                        .collect(),
                    alias_of: raw
                        .alias_types
                        .iter()
                        .find(|(n, _)| *n == s.name)
                        .map(|(_, r)| self.canon(fi, r))
                        .unwrap_or_default(),
                    receiver_calls: {
                        let mut calls = self.receiver_calls(fi, &s.receiver_calls);
                        calls.retain(|c| !(library_bases && c.starts_with("local:super().")));
                        calls
                    },
                    returns_instance: s
                        .returns_instance
                        .as_ref()
                        .map(|r| self.canon(fi, r))
                        .filter(|c| !c.starts_with("global#"))
                        .unwrap_or_default(),
                    returns_type: s
                        .returns_type
                        .as_ref()
                        .map(|r| self.canon(fi, r))
                        .filter(|c| !c.starts_with("global#"))
                        .unwrap_or_default(),
                    conditional_calls: self.conditional_calls(fi, &s.conditional_calls),
                    caller_args: self.caller_args(fi, &s.caller_args),
                    is_async: s.is_async,
                    app_middleware: {
                        app_middleware.sort();
                        app_middleware.dedup();
                        app_middleware
                    },
                    returns_calls: {
                        // A function's own: a class's methods are not its body.
                        let mut calls: Vec<String> = s
                            .returns_calls
                            .iter()
                            .filter(|_| s.kind == drift_core::SymbolKind::Function)
                            .map(|r| self.canon(fi, r))
                            .collect();
                        calls.sort();
                        calls.dedup();
                        calls
                    },
                    attr_types: s
                        .attr_types
                        .iter()
                        .map(|(a, r)| (a, self.canon(fi, r)))
                        .filter(|(_, c)| !c.starts_with("global#"))
                        .map(|(a, c)| format!("{a}={c}"))
                        .collect(),
                }
            })
            .collect();

        let mut facts = FileFacts {
            path: f.rel_path.clone(),
            hash: f.hash.clone(),
            lang: "py".into(),
            package,
            parse_ok: raw.parse_ok,
            directives: vec![],
            imports,
            exports,
            symbols,
            entry_points,
            has_test: false,
            type_only: false,
            client_leaks: vec![],
            registries: raw
                .lists
                .iter()
                .filter_map(|l| self.registry(fi, l))
                .collect(),
            truncated: vec![],
            unlisted_routes: vec![],
            discovers: raw.discovers.clone(),
            outgoing: if test_file {
                vec![]
            } else {
                raw.outgoing.clone()
            },
            test_requests: if test_file {
                raw.test_requests.clone()
            } else {
                vec![]
            },
            mocks: if test_file {
                raw.mocks
                    .iter()
                    .filter_map(|m| self.mock_module(fi, m))
                    .collect()
            } else {
                vec![]
            },
            route_matchers: vec![],
            mounts: extra.mounts.clone(),
            apps: self.apps.get(rel).cloned().unwrap_or_default(),
            listed: None,
        };
        facts.normalize();
        facts
    }

    /// Whether an entry point's handler reads request input
    /// ([`drift_core::controls::READS_INPUT`]): its body reads `request.<input>`, or it
    /// takes a parameter input arrives through (a path, query, body, form, header or
    /// cookie parameter, a route kwarg, a model that is no dependency alias). It
    /// provably reads none ([`drift_core::controls::NO_INPUT`]) when it does neither,
    /// takes no `*args` / `**kwargs`, and never hands the request on whole or calls a
    /// method of `self`. Otherwise not known: no control.
    /// [`drift_core::controls::INPUT_TYPED`]: the body reads no request input of its
    /// own, never hands the request on and takes no `*args` / `**kwargs`, and every
    /// parameter request input arrives through (one at least) is parsed by its
    /// declared type, on every route `entries` serves it at: FastAPI parses a
    /// parameter into its annotation ([`RawInputUse::typed`]); Django, DRF and Flask
    /// pass route kwargs as text, parsed only by the route's converter for that
    /// parameter (`<uuid:project_id>`), never by an annotation. Any parameter that is
    /// not, any other adapter, an annotation not read: no.
    fn input_typed(&self, fi: usize, u: &RawInputUse, entries: &[&EntryPoint]) -> bool {
        if u.reads
            || u.escapes
            || u.variadic
            || entries.is_empty()
            || u.typed.len() != u.params.len()
        {
            return false;
        }
        let bound: Vec<&(String, bool)> = u
            .params
            .iter()
            .zip(&u.typed)
            .filter(|(p, _)| match p {
                RawParamKind::Input => true,
                RawParamKind::Alias(r) => self.dep_items(fi, &RawDep::Alias(r.clone())).is_empty(),
                RawParamKind::Dep | RawParamKind::Other => false,
            })
            .map(|(_, t)| t)
            .collect();
        if bound.is_empty() {
            return false;
        }
        entries.iter().all(|e| {
            let converters = route_converters(e.route.as_deref().unwrap_or_default());
            bound.iter().all(|(name, typed)| match e.adapter.as_str() {
                "fastapi" => *typed,
                "django" | "drf" | "flask" | "flask_restx" => converters
                    .iter()
                    .any(|(n, conv)| n == name && converter_parses(&e.adapter, conv)),
                _ => false,
            })
        })
    }

    fn input_control(&self, fi: usize, u: &RawInputUse) -> Option<&'static str> {
        let param = u.params.iter().any(|p| match p {
            RawParamKind::Input => true,
            RawParamKind::Alias(r) => self.dep_items(fi, &RawDep::Alias(r.clone())).is_empty(),
            RawParamKind::Dep | RawParamKind::Other => false,
        });
        if u.reads || param {
            Some(drift_core::controls::READS_INPUT)
        } else if !u.escapes && !u.variadic {
            Some(drift_core::controls::NO_INPUT)
        } else {
            None
        }
    }

    /// The callables a function returns by reference, as reference calls
    /// (`app/auth.py#verify(ref)`): an in-repo function, or the `__call__` of an
    /// in-repo class that defines one (returned, or an instance of it returned); a
    /// FastAPI security scheme instance not built soft; `unresolved:...(ref)` for a
    /// reference Drift cannot follow (a missing module, an in-repo name no symbol
    /// defines): a dependency factory whose product Drift cannot read is opaque, never
    /// no guard. A package function or other class, a value, a class without its own
    /// `__call__` and a soft instance give nothing.
    fn returned_refs(&self, fi: usize, s: &RawSymbol) -> Vec<String> {
        // The symbol a canonical names, and for a class whether it defines `__call__`.
        let kind = |c: &str| -> Option<(drift_core::SymbolKind, bool)> {
            let (module, name) = c.split_once('#')?;
            if module.contains(':') || name.contains(['.', '(']) {
                return None;
            }
            let f = self.file(module)?;
            self.files[f]
                .raw
                .symbols
                .iter()
                .find(|x| x.name == name && x.owner.is_none())
                .map(|x| (x.kind, x.members.iter().any(|m| m.name == "__call__")))
        };
        let mut out = Vec::new();
        for r in &s.returns {
            let (target, instance) = match r {
                RawReturn::Ref(x) => (Some(self.canon(fi, x)), false),
                RawReturn::Partial(x) => (x.as_ref().map(|x| self.canon(fi, x)), false),
                RawReturn::Instance(_, true) => continue,
                RawReturn::Instance(x, false) => (Some(self.canon(fi, x)), true),
            };
            let Some(c) = target else {
                out.push("unresolved:partial(ref)".to_string());
                continue;
            };
            if c.starts_with("unresolved:") {
                out.push(format!("{c}(ref)"));
                continue;
            }
            match kind(&c) {
                Some((drift_core::SymbolKind::Function, _)) if !instance => {
                    out.push(format!("{c}(ref)"))
                }
                // A class Drift sees `__call__` on: an instance is a dependency it runs.
                Some((drift_core::SymbolKind::Class, true)) => {
                    out.push(format!("{c}.__call__(ref)"))
                }
                // FastAPI's own security schemes (`HTTPBearer()`, not built soft).
                None if instance && c.starts_with("pkg:fastapi#security.") => {
                    out.push(format!("{c}(ref)"))
                }
                // An in-repo name no symbol defines (`missing.verify`, an attribute of
                // a module-level object): what it returns is not known.
                None if !c.split_once('#').is_some_and(|(m, _)| m.contains(':')) => {
                    out.push(format!("unresolved:{c}(ref)"))
                }
                _ => {}
            }
        }
        out
    }

    /// One `except` clause as [`drift_core::CatchFact`] writes it.
    fn catch_fact(&self, fi: usize, c: &RawCatch) -> drift_core::CatchFact {
        let catches = c
            .catches
            .iter()
            .map(|x| match x {
                Some(r) => self.canon(fi, r),
                None => "*".into(),
            })
            .collect();
        let mut does: Vec<String> = c
            .does
            .iter()
            .map(|d| match d {
                RawDoes::Rethrow => "rethrow".into(),
                RawDoes::Throw(r) => format!("throw:{}", self.canon(fi, r)),
                RawDoes::Log => "log".into(),
                RawDoes::Respond(s) => format!("respond:{s}"),
                RawDoes::Report(r) => format!("report:{}", self.canon(fi, r)),
                RawDoes::Return => "return".into(),
            })
            .collect();
        if does.is_empty() {
            does.push("swallow".into());
        }
        drift_core::CatchFact { catches, does }
    }

    /// `module#Name` names a class defined in the repo.
    fn is_repo_class(&self, canonical: &str) -> bool {
        let Some((module, name)) = canonical.split_once('#') else {
            return false;
        };
        if module.contains(':') || name.contains('.') || name.contains('(') {
            return false;
        }
        self.file(module).is_some_and(|fi| {
            self.files[fi]
                .raw
                .symbols
                .iter()
                .any(|s| s.name == name && s.kind == drift_core::SymbolKind::Class)
        })
    }

    /// A resolved registry: its slot, and the in-repo symbols and modules it names.
    fn registry(&self, fi: usize, l: &RawRefList) -> Option<Registry> {
        let f = &self.files[fi];
        let module_id = |m: &str| -> Option<String> {
            let id = self.res.resolve(&f.abs_path, m);
            (!id.contains(':')).then(|| format!("{id}#*"))
        };
        let mut opaque = false;
        let mut items: Vec<RegistryItem> = Vec::new();
        for (item, line) in &l.items {
            let (target, spread) = match item {
                RawListItem::Ref(r) => (Some(symbol_of(&self.canon(fi, r))), false),
                RawListItem::Spread(r) => {
                    let t = symbol_of(&self.canon(fi, r));
                    // A spread of a package's or an unresolved list: not known.
                    if t.contains(':') {
                        opaque = true;
                    }
                    (Some(t), true)
                }
                RawListItem::Opaque => {
                    opaque = true;
                    (None, false)
                }
                RawListItem::Include(m) => {
                    let t = module_id(m);
                    if t.is_none() {
                        opaque = true;
                    }
                    (t, false)
                }
                RawListItem::Module(m) => match module_id(m) {
                    Some(t) => (Some(t), false),
                    None => {
                        // `a.apps.AConfig`: an attribute of a module.
                        let t = m.rsplit_once('.').and_then(|(module, name)| {
                            let id = self.res.resolve(&f.abs_path, module);
                            (!id.contains(':')).then(|| symbol_of(&self.origin(&id, name)))
                        });
                        (t, false)
                    }
                },
            };
            if let Some(target) = target.filter(|t| !t.contains(':')) {
                items.push(RegistryItem {
                    target,
                    line: *line,
                    spread,
                });
            }
        }
        // Kept when opaque (`[*helpers()]`): its members are unknown, not missing.
        if items.is_empty() && !opaque {
            return None;
        }
        let slot = match &l.slot {
            RawListSlot::Arg { callee, index, key } if key.is_empty() => {
                format!("arg:{}@{index}", self.canon(fi, callee))
            }
            RawListSlot::Arg { callee, index, key } => {
                format!("arg:{}@{index}:{key}", self.canon(fi, callee))
            }
            RawListSlot::Binding(name) => format!("binding:{name}"),
            RawListSlot::Calls(receiver) => format!("calls:{}", self.canon(fi, receiver)),
        };
        Some(Registry {
            slot,
            line: l.line,
            items,
            opaque,
        })
    }

    /// Resolved specifiers of file `fi` (spec -> module id).
    pub fn specs_of(&self, fi: usize) -> &BTreeMap<String, String> {
        &self.specs[fi]
    }
}

#[cfg(test)]
mod tests {
    use super::soft_name;

    #[test]
    fn soft_names_are_read_from_the_qualifier_only() {
        for soft in [
            "app/deps.py#get_optional_user",
            "app/deps.py#optional_user",
            "app/deps.py#public_auth",
            "app/deps.py#maybe_user",
            "app/deps.py#MaybeUser",
            "app/deps.py#get_current_user_optional",
            "app/deps.py#login_required_optional",
            "app/deps.py#get_user_or_none",
            "app/deps.py#_web_user_or_anonymous",
            "app/deps.py#AnonymousUser",
            "app/deps.py#public_user",
            "app/deps.py#get_optional_current_user",
            "app/deps.py#MaybeAuth",
        ] {
            assert!(soft_name(soft), "{soft}");
        }
        for strict in [
            "app/deps.py#verify_public_key",
            "app/deps.py#get_current_user",
            "app/deps.py#require_non_anonymous",
            "app/deps.py#none_shall_pass",
            "app/deps.py#public_key_auth",
            "app/deps.py#optional_scopes_user",
            "app/deps.py#optional",
            "app/deps.py#public_settings",
            "app/deps.py#get_db",
        ] {
            assert!(!soft_name(strict), "{strict}");
        }
    }
}
