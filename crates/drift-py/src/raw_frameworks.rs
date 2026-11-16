//! Raw facts of the frameworks read since the build `a0779066`: django-ninja,
//! Litestar and Sanic ([`super::RawFile::frameworks`]). Quart needs none: it is Flask's
//! API on another package, read by the Flask adapter's facts.
//!
//! They are a field of their own, read by the listed link only
//! (`Linker::since_frozen`): no fact the measured build wrote changes, so what
//! mining reads stays byte for byte what it was. The linker decides which
//! framework a receiver is of, from the package its constructor comes from.

use serde::{Deserialize, Serialize};

use super::RawRef;

/// What one option of a route, a router or an application is given, where it may
/// guard: django-ninja's `auth=`, Litestar's `guards=`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RawGiven {
    /// Names, or calls of names (`auth=ApiKey()`, by the class), in order.
    Refs(Vec<RawRef>),
    /// `auth=None`: none at all, in place of what an outer layer gives.
    Nothing,
    /// Anything else, by its words: it may be the guard.
    Unread(String),
}

/// Options given to a module-level constructor or a class that may be a router of
/// one of these frameworks (`api = NinjaAPI(auth=...)`, `router = Router(path=...,
/// route_handlers=[...], guards=[...])`, `class Items(Controller)`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkOptions {
    /// The module-level name, or the class.
    pub name: String,
    /// A class's own attributes (a Litestar `Controller`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub class: bool,
    /// The class's `path = "/items"` (a constructor's is [`super::RawRouter::path`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `auth=` (django-ninja).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<RawGiven>,
    /// `guards=` (Litestar).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guards: Option<RawGiven>,
    /// `route_handlers=[...]` (Litestar): each element, `None` for one that is no
    /// name; `None` for a value that is no list written in place.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handlers: Option<Vec<Option<RawRef>>>,
    /// Options whose effect on a request is not read, as written
    /// (`before_request=...`, `on_app_init=...`, `**options`): any may turn a
    /// caller away.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
    pub line: u32,
}

/// A router or blueprint mounted on another: django-ninja's
/// `api.add_router("/items", router, auth=...)`, Sanic's `app.blueprint(bp,
/// url_prefix=...)`, and each member of `group = Blueprint.group(a, b,
/// url_prefix="/v1")` on the group.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkMount {
    /// The method called (`add_router`, `blueprint`), or `group`.
    pub how: String,
    pub parent: RawRef,
    pub target: RawRef,
    /// The prefix given at the mount, as written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// `auth=` given at the mount (django-ninja).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<RawGiven>,
    pub line: u32,
}

/// `group = Blueprint.group(a, b, url_prefix="/v1")` (Sanic): a router of its own.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkGroup {
    pub name: String,
    /// The function called (`Blueprint.group`).
    pub callee: RawRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    pub line: u32,
}

/// A route decorator's `auth=` (django-ninja `@api.get("/x", auth=...)`): the
/// route itself is the decorator's [`super::RawRoute`].
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawRouteAuth {
    pub symbol: String,
    pub receiver: RawRef,
    pub auth: RawGiven,
}

/// A Litestar route handler: `@get("/items/{id:int}")` on a function, or on a
/// method of a `Controller` (`Items.show`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkHandler {
    /// The function, or `Class.method`.
    pub symbol: String,
    /// The decorator: a wrap of the measured build, no wrap of the listed reading.
    pub decorator: RawRef,
    /// Upper-cased; empty where they are not read (`route(http_method=METHODS)`).
    pub methods: Vec<String>,
    /// Each path given, as written; `/` where none is.
    pub paths: Vec<String>,
    /// `guards=` of the handler.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guards: Option<RawGiven>,
    /// What the dependencies of the handler and of its controller that it takes by
    /// parameter name are provided by (`dependencies={"user": Provide(load_user)}`
    /// beside a parameter `user`): each runs before the handler.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provided: Vec<RawRef>,
    /// The handler's options whose effect on a request is not read, as written.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unread: Vec<String>,
    pub line: u32,
}

/// A Sanic request hook of an application or blueprint: `@app.on_request`,
/// `@bp.middleware("request")`, `app.register_middleware(f, "request")`. What it
/// returns, if anything, is the answer.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkHook {
    pub router: RawRef,
    pub hook: RawRef,
    /// A request hook; else a response hook, which runs after the handler.
    pub request: bool,
    /// Written `@x.middleware(...)`, which the Flask and FastAPI facts also hold as
    /// an application middleware.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub middleware: bool,
}

/// A Sanic route added by a call: `app.add_route(handler, "/x", methods=[...])`,
/// `bp.add_route(Items.as_view(), "/items")`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawFrameworkRoute {
    pub router: RawRef,
    pub target: RawRef,
    pub path: String,
    /// Upper-cased; empty where none are given.
    pub methods: Vec<String>,
    pub line: u32,
}

/// Everything above, for one file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawFrameworks {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<RawFrameworkOptions>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<RawFrameworkMount>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<RawFrameworkGroup>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub auth: Vec<RawRouteAuth>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub handlers: Vec<RawFrameworkHandler>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hooks: Vec<RawFrameworkHook>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RawFrameworkRoute>,
    /// The names the calls above read as an argument, with their line: a router
    /// handed to a mount that is read, not to one that is not
    /// ([`super::RawFile::router_uses`] keeps them, as the measured build did).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reads: Vec<(RawRef, u32)>,
}

impl RawFrameworks {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
