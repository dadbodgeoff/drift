//! Conformance tests: small fixture repos, one per capability.
//!
//! Each capability has an explicit assertion (so the intent is readable) and
//! every fixture's fact index is snapshotted (so unintended changes show up).

use std::path::{Path, PathBuf};

use drift_core::{FileFacts, RepoFacts, SkipReason, Symbol, SymbolKind, WrapKind};
use drift_py::{ScanOptions, debug_imports, scan};

const FIXTURES: &[&str] = &[
    "fastapi-app",
    "fastapi-deps",
    "flask-app",
    "django-project",
    "pkg-relative",
    "signals",
    "import-edge-cases",
    "import-case",
    "purpose",
];

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn scan_fixture(name: &str, threads: usize) -> RepoFacts {
    scan(
        &fixture(name),
        &ScanOptions {
            cache_dir: None,
            threads,
        },
    )
    .expect("scan")
    .0
}

fn file<'a>(r: &'a RepoFacts, path: &str) -> &'a FileFacts {
    r.files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} not scanned"))
}

fn symbol<'a>(f: &'a FileFacts, name: &str) -> &'a Symbol {
    f.symbols
        .iter()
        .find(|s| s.name == name)
        .unwrap_or_else(|| panic!("{name} not in {}", f.path))
}

fn wraps(s: &Symbol) -> Vec<(WrapKind, &str)> {
    s.wraps
        .iter()
        .map(|w| (w.kind, w.wrapper.as_str()))
        .collect()
}

/// `path method route adapter` for every entry point, sorted.
fn entries(r: &RepoFacts) -> Vec<String> {
    let mut out: Vec<String> = r
        .files
        .iter()
        .flat_map(|f| {
            f.entry_points.iter().map(move |e| {
                format!(
                    "{} {} {} {} {}",
                    f.path,
                    e.symbol,
                    e.method.as_deref().unwrap_or(&e.kind),
                    e.route.as_deref().unwrap_or("-"),
                    e.adapter
                )
            })
        })
        .collect();
    out.sort();
    out
}

#[test]
fn fastapi_routes_join_router_prefixes_and_carry_dependencies() {
    let r = scan_fixture("fastapi-app", 0);
    assert_eq!(
        entries(&r),
        [
            "app/api/routes/admin.py delete_user DELETE /api/v1/admin/users/{user_id} fastapi",
            "app/api/routes/items.py read_items GET /api/v1/items fastapi",
            "app/api/routes/items.py sync_item PATCH /api/v1/items/{item_id}/sync fastapi",
            "app/api/routes/items.py sync_item PUT /api/v1/items/{item_id}/sync fastapi",
            "app/api/routes/items.py update_item POST /api/v1/items/{item_id} fastapi",
            "app/main.py health GET /health fastapi",
            // Celery's default task name is `module.function`; beat schedules (a
            // `beat_schedule` dict, `add_periodic_task`) make the task a cron entry too.
            "app/worker.py cleanup cron nightly-cleanup celery",
            "app/worker.py cleanup job app.worker.cleanup celery",
            "app/worker.py reindex cron reindex-every-10-minutes celery",
            "app/worker.py reindex job app.worker.reindex celery",
            "app/worker.py send_email job send-email celery",
        ]
    );
    // `user: CurrentUser` is `Annotated[str, Depends(get_current_user)]` in another file;
    // the dependency's own dependencies follow it, and a configured instance
    // (`oauth2_scheme = OAuth2PasswordBearer(...)`) depends as its class.
    let items = file(&r, "app/api/routes/items.py");
    assert_eq!(
        wraps(symbol(items, "read_items")),
        [
            (WrapKind::Call, "app/api/deps.py#get_db"),
            (WrapKind::Call, "app/api/deps.py#get_current_user"),
            (WrapKind::Call, "pkg:fastapi#security.OAuth2PasswordBearer"),
        ]
    );
    // `include_router(..., dependencies=[Depends(get_current_superuser)])` guards every admin
    // route, and the team's `VersionedRouter(APIRouter)` subclass is a router.
    let admin = symbol(file(&r, "app/api/routes/admin.py"), "delete_user");
    assert_eq!(
        admin.wraps[0].wrapper,
        "app/api/deps.py#get_current_superuser"
    );
    // A configured instance with `__call__` depends as its class, then its own dependencies.
    let update = symbol(items, "update_item");
    assert_eq!(
        wraps(update),
        [
            (WrapKind::Call, "app/api/deps.py#Authorizer"),
            (WrapKind::Call, "app/api/deps.py#get_current_user"),
            (WrapKind::Call, "app/api/deps.py#get_db"),
            (WrapKind::Call, "pkg:fastapi#security.OAuth2PasswordBearer"),
        ]
    );
    // Route decorator keywords are recorded against one callee for every method.
    assert!(
        update
            .args
            .contains(&"pkg:fastapi#APIRouter.api_route@99:response_model".to_string()),
        "{:?}",
        update.args
    );
    assert!(update.controls.contains(&"validates".to_string()));
    assert!(update.controls.contains(&"await".to_string()));
    assert_eq!(update.throws, ["pkg:fastapi#HTTPException"]);
    // Private helpers are symbols but not exported.
    assert!(symbol(items, "_helper").exported_as.is_empty());
}

/// The wrappers a route of `fastapi-deps` gets, short names only.
fn route_deps(r: &RepoFacts, path: &str, name: &str) -> Vec<String> {
    symbol(file(r, path), name)
        .wraps
        .iter()
        .filter(|w| w.kind == WrapKind::Call)
        .map(|w| w.wrapper.rsplit('#').next().unwrap().to_string())
        .collect()
}

#[test]
fn fastapi_dependency_chains_reach_what_their_dependencies_depend_on() {
    let r = scan_fixture("fastapi-deps", 0);
    let strict = "app/routes/strict.py";
    let user = ["get_current_user", "security.OAuth2PasswordBearer"];
    let active = ["get_current_active_user", user[0], user[1]];
    // (a) a dependency whose own parameters depend on the next, through `Security` too.
    assert_eq!(route_deps(&r, strict, "via_chain"), active);
    assert_eq!(
        route_deps(&r, strict, "via_alias_of_chain"),
        ["get_current_superuser", active[0], active[1], active[2]]
    );
    // (b) an `Annotated` alias, an alias of a `Depends(f)` constant, the constant as a
    // default.
    for name in ["via_alias", "via_constant", "via_default_constant"] {
        assert_eq!(route_deps(&r, strict, name), user, "{name}");
    }
    // (c) router-level dependencies and those added at `include_router`.
    assert_eq!(
        route_deps(&r, "app/routes/guarded.py", "guarded_list"),
        active
    );
    assert_eq!(
        route_deps(&r, "app/routes/mounted.py", "mounted_list"),
        active
    );
    // (d) an instance runs its class's `__call__` (not `__init__`'s `get_db`);
    // `Depends()` on a class runs its `__init__`.
    assert_eq!(
        route_deps(&r, strict, "via_instance"),
        ["RoleChecker", user[0], user[1]]
    );
    assert_eq!(
        route_deps(&r, strict, "via_class"),
        ["Pagination", user[0], user[1]]
    );
    // Built strict, by position or as a module-level instance.
    assert_eq!(
        route_deps(&r, strict, "via_strict_positional_class"),
        ["Require", user[0], user[1]]
    );
    assert_eq!(
        route_deps(&r, strict, "via_strict_instance"),
        ["Auth", user[0], user[1]]
    );
    // On the route itself a parameter that may be `None` still names the dependency,
    // and `Security(..., scopes=...)` counts like `Depends`.
    for name in ["via_optional_route_param", "via_security_scopes"] {
        assert_eq!(route_deps(&r, strict, name), user, "{name}");
    }
    // A soft word that is not the name's qualifier, or that qualifies something other
    // than who is asking, says nothing.
    for (name, dep) in [
        ("via_strict_soft_word", "verify_public_key"),
        ("via_public_key_auth", "public_key_auth"),
        ("via_optional_scopes_user", "optional_scopes_user"),
    ] {
        assert_eq!(
            route_deps(&r, strict, name),
            [dep, user[0], user[1]],
            "{name}"
        );
    }
    // Positional arguments bind what the callee's parameters say: a `*args` takes
    // them, a keyword-only flag is not bound, an inherited `__init__` is the base's.
    // A factory's product is the function it defines and returns, so its parameters'
    // dependencies are reached as a class's `__call__` parameters are.
    assert_eq!(
        route_deps(&r, strict, "via_varargs"),
        ["require_any", user[0], user[1]]
    );
    assert_eq!(
        route_deps(&r, strict, "via_keyword_only"),
        ["require_role", user[0], user[1]]
    );
    assert_eq!(route_deps(&r, strict, "via_inherited_strict"), ["SubAuth"]);
    // A list literal is no soft flag's value, by position or keyword.
    for name in ["via_list_literal", "via_list_literal_keyword"] {
        assert_eq!(
            route_deps(&r, strict, name),
            ["Roles", user[0], user[1]],
            "{name}"
        );
    }
}

#[test]
fn fastapi_soft_dependencies_never_count_as_the_strict_ones_they_reach() {
    let r = scan_fixture("fastapi-deps", 0);
    let soft = "app/routes/soft.py";
    let cases: &[(&str, &[&str])] = &[
        // Named optional: the chain stops at it.
        ("via_optional", &["get_optional_user"]),
        // Takes the user as possibly `None`; the session it also takes still counts.
        ("via_viewer", &["get_viewer", "get_db"]),
        // A token read through a scheme built with `auto_error=False`.
        ("via_auto_error", &["get_token_user"]),
        // The soft scheme itself stands for itself, not for `OAuth2PasswordBearer`.
        ("via_soft_scheme", &["optional_scheme"]),
        // Soft instances made in place depend on nothing.
        ("via_soft_inline", &[]),
        ("via_soft_factory", &[]),
        // "auth" in a name proves nothing: an auth context that depends on no user, and
        // a public auth dependency, which a chain does not follow.
        ("via_auth_context", &["auth_context", "get_db"]),
        ("via_public_auth", &["public_auth"]),
        // An `Annotated[Optional[...], Depends(...)]` alias is possibly `None`.
        ("via_maybe_alias", &["get_wrapped_user"]),
        // An instance whose `__init__` (not `__call__`) depends on the user.
        ("via_init_only", &["Signer", "get_db"]),
        // Soft flags by position, matched to the callee's parameter names: a factory,
        // an in-repo class, a `fastapi.security` class.
        ("via_positional_factory", &[]),
        ("via_positional_class", &[]),
        ("via_positional_scheme", &["positional_scheme"]),
        // A soft flag whose value is not a literal is soft.
        ("via_non_literal", &[]),
        // Module-level instances built soft stand for themselves only: by
        // `required=False`, `optional=True` or position.
        ("via_required_instance", &["relaxed"]),
        ("via_optional_instance", &["loose"]),
        ("via_positional_instance", &["lax"]),
        // A soft instance reached through a parameter that is not optional.
        ("via_soft_instance_chain", &["get_relaxed_user", "relaxed"]),
        // A positional-only soft flag; one inherited from the base's `__init__`.
        ("via_positional_only", &[]),
        ("via_inherited_init", &[]),
        // What positional arguments bind is unknown: a dataclass's generated
        // `__init__`, a `*args` argument, a `**kwargs` argument.
        ("via_dataclass", &[]),
        ("via_starred", &[]),
        ("via_double_starred", &[]),
    ];
    for (name, want) in cases {
        assert_eq!(route_deps(&r, soft, name), *want, "{name}");
    }
}

#[test]
fn celery_tasks_cors_env_reads_and_models() {
    let r = scan_fixture("fastapi-app", 0);
    let send = symbol(file(&r, "app/worker.py"), "send_email");
    assert!(send.wraps.is_empty(), "task decorators are registrations");
    assert!(
        send.args
            .contains(&"pkg:celery#Celery.task@99:bind".to_string())
    );
    let main = file(&r, "app/main.py");
    assert_eq!(symbol(main, "(module)").sinks, ["cors_any_origin"]);
    let settings = symbol(file(&r, "app/core/config.py"), "Settings");
    assert_eq!(
        settings.reads,
        ["os.environ.DATABASE_URL", "os.environ.SECRET_KEY"]
    );
    assert_eq!(r.models.len(), 1);
    assert_eq!(r.models[0].name, "Item");
    assert_eq!(r.models[0].source, "sqlmodel");
    assert_eq!(r.models[0].fields, ["id", "owner_id", "title"]);
    assert!(file(&r, "app/api/routes/items.py").has_test);
}

#[test]
fn flask_blueprints_hooks_and_restx_namespaces() {
    let r = scan_fixture("flask-app", 0);
    assert_eq!(
        entries(&r),
        [
            "src/shop/admin.py ban POST /admin/users/<int:user_id>/ban flask",
            "src/shop/admin.py index GET /admin flask",
            "src/shop/api.py UserResource.delete DELETE /api/v1/people/<int:user_id> flask_restx",
            "src/shop/api.py UserResource.get GET /api/v1/people/<int:user_id> flask_restx",
            "src/shop/auth.py login GET /auth/login flask",
            "src/shop/auth.py login POST /auth/login flask",
            "src/shop/auth.py logout GET /auth/logout flask",
            "src/shop/console.py purge POST /console/purge flask",
            // Imported inside `create_app()` and registered there.
            "src/shop/reports.py daily GET /reports/daily flask",
        ]
    );
    // App-wide hooks, outermost first: a blueprint's `before_app_request`, then those on
    // the factory's local app (a call and a nested `@app.before_request`, and in a
    // helper the app is passed to, `init_hooks(app)`); then the blueprint's own
    // `before_request`, which is not app-wide.
    let app_hooks = [
        (WrapKind::AppHook, "src/shop/auth.py#load_session"),
        (
            WrapKind::AppHook,
            "src/shop/__init__.py#create_app.require_tenant",
        ),
        (WrapKind::AppHook, "src/shop/hooks.py#check_csrf"),
        (WrapKind::AppHook, "src/shop/hooks.py#init_hooks.track"),
    ];
    let auth = file(&r, "src/shop/auth.py");
    let mut login = app_hooks.to_vec();
    login.push((WrapKind::Call, "src/shop/auth.py#load_user"));
    assert_eq!(wraps(symbol(auth, "login")), login);
    // A second factory passes its app to the same helper: the helper's hooks run in
    // both apps, and only that helper's hooks run in the second.
    assert_eq!(
        wraps(symbol(file(&r, "src/shop/console.py"), "purge")),
        [(WrapKind::AppHook, "src/shop/hooks.py#init_hooks.track")]
    );
    // `before_app_request` guards other blueprints of the app, not only its own.
    assert_eq!(
        wraps(symbol(file(&r, "src/shop/reports.py"), "daily")),
        app_hooks
    );
    assert_eq!(symbol(auth, "login").sinks, ["dynamic_redirect"]);
    assert!(symbol(auth, "logout").sinks.is_empty());
    let mut index = app_hooks.to_vec();
    index.push((WrapKind::Decorator, "pkg:flask_login#login_required"));
    assert_eq!(wraps(symbol(file(&r, "src/shop/admin.py"), "index")), index);
    // Handler methods of a class-based view are entry points with their own decorators.
    let api = file(&r, "src/shop/api.py");
    let mut delete = app_hooks.to_vec();
    delete.extend([
        (WrapKind::Extends, "pkg:flask_restx#Resource"),
        (WrapKind::Decorator, "src/shop/auth.py#admins_only"),
    ]);
    assert_eq!(wraps(symbol(api, "UserResource.delete")), delete);
    assert_eq!(
        symbol(api, "UserResource.get").exported_as,
        ["UserResource.get"]
    );
}

#[test]
fn django_urlconfs_class_views_and_drf() {
    let r = scan_fixture("django-project", 0);
    assert_eq!(
        entries(&r),
        [
            "blog/tasks.py purge_drafts cron purge-drafts celery",
            "blog/tasks.py purge_drafts job blog.tasks.purge_drafts celery",
            "blog/views.py CommentViewSet ANY /api/comments drf",
            "blog/views.py PostDetail.get GET /blog/<int:pk> django",
            "blog/views.py PostViewSet.list GET /api/posts drf",
            "blog/views.py PostViewSet.publish POST /api/posts drf",
            "blog/views.py ReportViewSet.list GET /api/reports drf",
            "blog/views.py SignInView ANY /blog/login django",
            "blog/views.py TokenProvisionView.post POST /blog/tokens/provision drf",
            "blog/views.py WhoAmIView.get GET /blog/whoami drf",
            "blog/views.py archive ANY /blog/archive/(?P<year>[0-9]{4}) django",
            "blog/views.py drafts GET /blog/drafts django",
            "blog/views.py drafts POST /blog/drafts django",
            "blog/views.py health GET /blog/health drf",
            "blog/views.py index ANY /blog django",
            "blog/views.py signup ANY /blog/signup django",
            // `admin.site.urls`: one entry for the whole admin.
            "mysite/urls.py urlpatterns ANY /admin django_admin",
        ]
    );
    // `blog/legacy_urls.py` is not reached from `ROOT_URLCONF`, so `views.index` is
    // only served at `/blog`.
    let views = file(&r, "blog/views.py");
    let login_mw = (
        WrapKind::Config,
        "pkg:django#contrib.auth.middleware.LoginRequiredMiddleware",
    );
    let token = (
        WrapKind::ConfigAuthenticates,
        "pkg:rest_framework#authentication.TokenAuthentication",
    );
    // `login_required(views.drafts)` in urls.py guards the view; `LoginRequiredMiddleware`
    // in `MIDDLEWARE` guards every view, outermost.
    assert_eq!(
        wraps(symbol(views, "drafts")),
        [
            login_mw,
            (
                WrapKind::Call,
                "pkg:django#contrib.auth.decorators.login_required"
            ),
            (
                WrapKind::Decorator,
                "pkg:django#views.decorators.http.require_http_methods"
            ),
        ]
    );
    assert_eq!(
        wraps(symbol(views, "PostDetail")),
        [
            (
                WrapKind::Decorator,
                "pkg:django#views.decorators.cache.never_cache"
            ),
            (
                WrapKind::Extends,
                "pkg:django#contrib.auth.mixins.LoginRequiredMixin"
            ),
            (WrapKind::Extends, "pkg:django#views.generic.DetailView"),
        ]
    );
    assert!(wraps(symbol(views, "PostViewSet")).contains(&(
        WrapKind::Call,
        "pkg:rest_framework#permissions.IsAuthenticated"
    )));
    // Its own `permission_classes` replace the default permission; authentication is
    // still the default. DRF exempts its views from `LoginRequiredMiddleware`.
    assert_eq!(
        wraps(symbol(views, "health")),
        [
            token,
            (WrapKind::Opens, "pkg:rest_framework#permissions.AllowAny")
        ]
    );
    // DRF's `DEFAULT_*_CLASSES` apply to a view that declares neither.
    assert_eq!(
        wraps(symbol(views, "CommentViewSet")),
        [
            token,
            (WrapKind::Config, "blog/permissions.py#IsMember"),
            (
                WrapKind::Extends,
                "pkg:rest_framework#viewsets.ModelViewSet"
            ),
        ]
    );
    // Classes declared on an in-repo base replace the defaults.
    assert_eq!(
        wraps(symbol(views, "ReportViewSet.list")),
        [
            (
                WrapKind::Authenticates,
                "pkg:rest_framework#authentication.SessionAuthentication"
            ),
            (WrapKind::Call, "pkg:rest_framework#permissions.IsAdminUser"),
            (WrapKind::Extends, "blog/views.py#StaffViewSet"),
        ]
    );
    // `@login_not_required` and Django's `LoginView` are exempt from the middleware.
    assert_eq!(
        wraps(symbol(views, "signup")),
        [(
            WrapKind::Opens,
            "pkg:django#contrib.auth.decorators.login_not_required"
        )]
    );
    assert_eq!(
        wraps(symbol(views, "SignInView")),
        [(WrapKind::Extends, "pkg:django#contrib.auth.views.LoginView")]
    );
    // The admin requires an active staff user.
    assert_eq!(
        wraps(symbol(file(&r, "mysite/urls.py"), "urlpatterns")),
        [
            login_mw,
            (
                WrapKind::Call,
                "pkg:django#contrib.admin.sites.AdminSite.admin_view"
            ),
        ]
    );
    // Both import styles of one third-party class give one id; subpackages stay distinct.
    let api = file(&r, "blog/api.py");
    assert_eq!(
        wraps(symbol(api, "TagViewSet")),
        [
            (
                WrapKind::Extends,
                "pkg:rest_framework#viewsets.ModelViewSet"
            ),
            (
                WrapKind::Call,
                "pkg:rest_framework#permissions.IsAuthenticated"
            ),
        ]
    );
    assert_eq!(
        wraps(symbol(api, "TagViewSet")),
        wraps(symbol(api, "LabelViewSet"))
    );
    assert_eq!(
        symbol(api, "fields").calls,
        [
            "pkg:django#db.models.CharField",
            "pkg:django#forms.CharField"
        ]
    );
    let settings = file(&r, "mysite/settings.py");
    assert_eq!(
        symbol(settings, "CORS_ALLOW_ALL_ORIGINS").sinks,
        ["cors_any_origin"]
    );
    assert_eq!(symbol(settings, "SECRET_KEY").kind, SymbolKind::Const);
    assert_eq!(r.models[0].name, "Post");
    assert_eq!(r.models[0].fields, ["author", "body", "title"]);
    // Migrations are generated code.
    assert!(
        r.skipped
            .iter()
            .any(|s| s.path == "blog/migrations/0001_initial.py"
                && s.reason == SkipReason::Generated)
    );
}

fn scan_files(files: &[(&str, &str)]) -> RepoFacts {
    let tmp = tempfile::tempdir().unwrap();
    for (path, text) in files {
        let p = tmp.path().join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    scan(tmp.path(), &ScanOptions::default()).unwrap().0
}

const VIEWS: &str = "def page(request):\n    return None\n";
const URLS: &str = "from django.urls import path\n\nfrom . import views\n\nurlpatterns = [path(\"page/\", views.page)]\n";

#[test]
fn django_without_settings_every_urlconf_is_a_root() {
    let r = scan_files(&[
        ("shop/__init__.py", ""),
        ("shop/views.py", VIEWS),
        ("shop/urls.py", URLS),
    ]);
    assert_eq!(entries(&r), ["shop/views.py page ANY /page django"]);
}

#[test]
fn django_settings_package_with_star_imports_and_project_scope() {
    // No manage.py: `settings/*.py` are the settings; `dev.py` gets `ROOT_URLCONF` and
    // `MIDDLEWARE` from `base.py` through its star import and adds a middleware.
    let r = scan_files(&[
        ("server/proj/__init__.py", ""),
        ("server/proj/settings/__init__.py", ""),
        (
            "server/proj/settings/base.py",
            "ROOT_URLCONF = \"proj.urls\"\nMIDDLEWARE = [\"django.contrib.sessions.middleware.SessionMiddleware\"]\n",
        ),
        (
            "server/proj/settings/dev.py",
            "from .base import *  # noqa\n\nMIDDLEWARE.append(\"proj.middleware.StrictLogin\")\n",
        ),
        (
            "server/proj/middleware.py",
            "from django.contrib.auth.middleware import LoginRequiredMiddleware\n\n\nclass StrictLogin(LoginRequiredMiddleware):\n    pass\n",
        ),
        (
            "server/proj/urls.py",
            "from django.urls import include, path\n\nurlpatterns = [path(\"shop/\", include(\"shop.urls\"))]\n",
        ),
        ("server/shop/__init__.py", ""),
        ("server/shop/views.py", VIEWS),
        ("server/shop/urls.py", URLS),
        // In the project, included by nobody: not served.
        ("server/old/__init__.py", ""),
        ("server/old/views.py", VIEWS),
        ("server/old/urls.py", URLS),
        // Outside the project directory (`server/`, where `proj.urls` is relative to):
        // the fallback still applies.
        ("docs/example/__init__.py", ""),
        ("docs/example/views.py", VIEWS),
        ("docs/example/urls.py", URLS),
    ]);
    assert_eq!(
        entries(&r),
        [
            "docs/example/views.py page ANY /page django",
            "server/shop/views.py page ANY /shop/page django",
        ]
    );
    // Only the settings that enable the middleware (`dev`) serve `proj.urls` with it:
    // `base` serves it without, so the guard is not certain and is left out.
    let page = symbol(file(&r, "server/shop/views.py"), "page");
    assert!(page.wraps.is_empty(), "{:?}", page.wraps);
    // With `DJANGO_SETTINGS_MODULE` naming `dev`, the subclass of
    // `LoginRequiredMiddleware` guards every view.
    let r = scan_files(&[
        (
            "server/manage.py",
            "import os\n\n\ndef main():\n    os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings.dev\")\n",
        ),
        ("server/proj/__init__.py", ""),
        ("server/proj/settings/__init__.py", ""),
        (
            "server/proj/settings/base.py",
            "ROOT_URLCONF = \"proj.urls\"\nMIDDLEWARE = []\n",
        ),
        (
            "server/proj/settings/dev.py",
            "from .base import *  # noqa\n\nMIDDLEWARE.append(\"proj.middleware.StrictLogin\")\n",
        ),
        (
            "server/proj/middleware.py",
            "from django.contrib.auth.middleware import LoginRequiredMiddleware\n\n\nclass StrictLogin(LoginRequiredMiddleware):\n    pass\n",
        ),
        (
            "server/proj/urls.py",
            "from django.urls import include, path\n\nurlpatterns = [path(\"shop/\", include(\"shop.urls\"))]\n",
        ),
        ("server/shop/__init__.py", ""),
        ("server/shop/views.py", VIEWS),
        ("server/shop/urls.py", URLS),
    ]);
    assert_eq!(
        wraps(symbol(file(&r, "server/shop/views.py"), "page")),
        [(WrapKind::Config, "server/proj/middleware.py#StrictLogin")]
    );
}

const DRF_VIEWS: &str = "from rest_framework.views import APIView


def page(request):
    return None


class OpenView(APIView):
    def get(self, request):
        return None
";
const DRF_URLS: &str = "from django.urls import path

from . import views

urlpatterns = [path(\"page/\", views.page), path(\"open/\", views.OpenView.as_view())]
";
const LOGIN_MW: &str = "django.contrib.auth.middleware.LoginRequiredMiddleware";

/// Unguarded entry points of a `mysite` project with these settings modules.
fn unguarded_with(settings: &[(&str, &str)]) -> Vec<String> {
    let mut files = vec![
        (
            "manage.py",
            "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"mysite.settings.prod\")\n",
        ),
        ("mysite/__init__.py", ""),
        ("mysite/settings/__init__.py", ""),
        ("mysite/urls.py", DRF_URLS),
        ("mysite/views.py", DRF_VIEWS),
    ];
    files.extend_from_slice(settings);
    let inv = drift_mine::security::inventory(&scan_files(&files));
    inv.unguarded().map(|e| e.symbol.clone()).collect()
}

#[test]
fn settings_rebinding_replaces_what_a_star_import_brought() {
    let base = format!(
        "ROOT_URLCONF = \"mysite.urls\"\nMIDDLEWARE = [\"{LOGIN_MW}\"]\nREST_FRAMEWORK = {{\"DEFAULT_PERMISSION_CLASSES\": [\"rest_framework.permissions.IsAuthenticated\"]}}\n"
    );
    // `prod` rebinds both: no login middleware, and DRF's default `AllowAny`.
    let prod = "from .base import *\n\nMIDDLEWARE = [\"django.contrib.sessions.middleware.SessionMiddleware\"]\nREST_FRAMEWORK = {\"DEFAULT_RENDERER_CLASSES\": [\"rest_framework.renderers.JSONRenderer\"]}\n";
    assert_eq!(
        unguarded_with(&[
            ("mysite/settings/base.py", &base),
            ("mysite/settings/prod.py", prod)
        ]),
        ["OpenView.get", "page"]
    );
    // Extending keeps the base's values.
    let prod = "from .base import *\n\nMIDDLEWARE += [\"django.contrib.sessions.middleware.SessionMiddleware\"]\nREST_FRAMEWORK = {**REST_FRAMEWORK, \"DEFAULT_RENDERER_CLASSES\": [\"rest_framework.renderers.JSONRenderer\"]}\n";
    assert!(
        unguarded_with(&[
            ("mysite/settings/base.py", &base),
            ("mysite/settings/prod.py", prod)
        ])
        .is_empty()
    );
    let prod = "from .base import *\n\nMIDDLEWARE = [*MIDDLEWARE, \"x.Y\"]\nREST_FRAMEWORK[\"PAGE_SIZE\"] = 10\n";
    assert!(
        unguarded_with(&[
            ("mysite/settings/base.py", &base),
            ("mysite/settings/prod.py", prod)
        ])
        .is_empty()
    );
    // Within one module, a later plain assignment clears earlier keys.
    let prod = format!("{base}REST_FRAMEWORK = {{\"PAGE_SIZE\": 10}}\nMIDDLEWARE = []\n");
    assert_eq!(
        unguarded_with(&[("mysite/settings/prod.py", &prod)]),
        ["OpenView.get", "page"]
    );
}

#[test]
fn star_import_fan_out_in_settings_is_linear() {
    // s0..s39, each `from .sJ import *` for every later J: 2^39 import paths, so the
    // settings must be computed once per module, not once per path.
    const N: usize = 40;
    let mut owned = Vec::new();
    for i in 0..N {
        let mut text: String = (i + 1..N)
            .map(|j| format!("from .s{j} import *\n"))
            .collect();
        if i == N - 1 {
            text.push_str(&format!(
                "ROOT_URLCONF = \"mysite.urls\"\nMIDDLEWARE = [\"{LOGIN_MW}\"]\n"
            ));
        }
        owned.push((format!("mysite/settings/s{i}.py"), text));
    }
    let mut files: Vec<(&str, &str)> = owned
        .iter()
        .map(|(p, t)| (p.as_str(), t.as_str()))
        .collect();
    files.extend([
        (
            "manage.py",
            "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"mysite.settings.s0\")\n",
        ),
        ("mysite/__init__.py", ""),
        ("mysite/settings/__init__.py", ""),
        ("mysite/urls.py", DRF_URLS),
        ("mysite/views.py", DRF_VIEWS),
    ]);
    let started = std::time::Instant::now();
    let inv = drift_mine::security::inventory(&scan_files(&files));
    let took = started.elapsed();
    assert!(took < std::time::Duration::from_secs(1), "took {took:?}");
    // The settings at the end of the chain reach `s0`: the plain view is guarded.
    let unguarded: Vec<&str> = inv.unguarded().map(|e| e.symbol.as_str()).collect();
    assert_eq!(unguarded, ["OpenView.get"]);
}

#[test]
fn login_required_middleware_does_not_guard_drf_views() {
    // DRF (3.16+) sets `login_required = False` on its views; with no DRF defaults the
    // view is open even though the middleware guards plain Django views.
    let prod = format!("ROOT_URLCONF = \"mysite.urls\"\nMIDDLEWARE = [\"{LOGIN_MW}\"]\n");
    assert_eq!(
        unguarded_with(&[("mysite/settings/prod.py", &prod)]),
        ["OpenView.get"]
    );
}

/// Entry points of a `proj` project: `manage.py` names `proj.settings`.
fn project_entries(files: &[(&str, &str)]) -> Vec<String> {
    let mut all = vec![
        (
            "manage.py",
            "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n",
        ),
        ("proj/__init__.py", ""),
        ("shop/__init__.py", ""),
        ("shop/views.py", VIEWS),
        ("shop/urls.py", URLS),
        ("other/__init__.py", ""),
        ("other/views.py", VIEWS),
        ("other/urls.py", URLS),
    ];
    all.extend_from_slice(files);
    entries(&scan_files(&all))
}

const INCLUDE_SHOP: &str = "from django.urls import include, path\n\nurlpatterns = [path(\"shop/\", include(\"shop.urls\"))]\n";

#[test]
fn urlconfs_are_pruned_only_when_the_roots_are_complete() {
    let settings = ("proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n");
    // Complete: `other/urls.py` is reached from nothing and serves nothing.
    assert_eq!(
        project_entries(&[settings, ("proj/urls.py", INCLUDE_SHOP)]),
        ["shop/views.py page ANY /shop/page django"]
    );
    // An include Drift cannot follow: `other` may be behind it, so it stays a root.
    let dynamic = "from django.urls import include, path\n\nfrom .plugins import get_plugin_urls\n\nurlpatterns = [path(\"shop/\", include(\"shop.urls\")), path(\"p/\", include(get_plugin_urls()))]\n";
    assert_eq!(
        project_entries(&[
            settings,
            ("proj/plugins.py", "def get_plugin_urls():\n    return []\n"),
            ("proj/urls.py", dynamic),
        ]),
        [
            "other/views.py page ANY /page django",
            "shop/views.py page ANY /shop/page django",
        ]
    );
}

#[test]
fn other_url_roots_come_from_settings_hostconfs_and_request_urlconf() {
    let other = "from django.urls import include, path\n\nurlpatterns = [path(\"other/\", include(\"other.urls\"))]\n";
    // django-tenants: `PUBLIC_SCHEMA_URLCONF`.
    assert_eq!(
        project_entries(&[
            (
                "proj/settings.py",
                "ROOT_URLCONF = \"proj.urls\"\nPUBLIC_SCHEMA_URLCONF = \"proj.public_urls\"\n",
            ),
            ("proj/urls.py", INCLUDE_SHOP),
            ("proj/public_urls.py", other),
        ]),
        [
            "other/views.py page ANY /other/page django",
            "shop/views.py page ANY /shop/page django",
        ]
    );
    // django-hosts: `ROOT_HOSTCONF` and its `host()` URLconfs.
    assert_eq!(
        project_entries(&[
            (
                "proj/settings.py",
                "ROOT_URLCONF = \"proj.urls\"\nROOT_HOSTCONF = \"proj.hosts\"\n",
            ),
            ("proj/urls.py", INCLUDE_SHOP),
            (
                "proj/hosts.py",
                "from django_hosts import host, patterns\n\nhost_patterns = patterns(\"\", host(r\"api\", \"proj.api_urls\", name=\"api\"))\n",
            ),
            ("proj/api_urls.py", other),
        ]),
        [
            "other/views.py page ANY /other/page django",
            "shop/views.py page ANY /shop/page django",
        ]
    );
    // A middleware that sets `request.urlconf`.
    assert_eq!(
        project_entries(&[
            ("proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n"),
            ("proj/urls.py", INCLUDE_SHOP),
            (
                "proj/middleware.py",
                "def tenant(get_response):\n    def inner(request):\n        request.urlconf = \"proj.alt_urls\"\n        return get_response(request)\n\n    return inner\n",
            ),
            ("proj/alt_urls.py", other),
        ]),
        [
            "other/views.py page ANY /other/page django",
            "shop/views.py page ANY /shop/page django",
        ]
    );
}

#[test]
fn a_nested_project_is_its_own_scope() {
    let portal = |manage: &'static str| {
        project_entries(&[
            ("proj/settings.py", "ROOT_URLCONF = \"proj.urls\"\n"),
            ("proj/urls.py", INCLUDE_SHOP),
            ("tools/portal/manage.py", manage),
            ("tools/portal/portal/__init__.py", ""),
            (
                "tools/portal/portal/settings.py",
                "ROOT_URLCONF = \"portal.urls\"\n",
            ),
            ("tools/portal/portal/views.py", VIEWS),
            (
                "tools/portal/portal/urls.py",
                "from django.urls import path\n\nfrom . import views\n\nurlpatterns = [path(\"refund/\", views.page)]\n",
            ),
        ])
    };
    // Its settings, named by an `os.environ[...] =` assignment, serve its URLconf.
    let served =
        portal("import os\n\nos.environ[\"DJANGO_SETTINGS_MODULE\"] = \"portal.settings\"\n");
    assert!(
        served.contains(&"tools/portal/portal/views.py page ANY /refund django".to_string()),
        "{served:?}"
    );
    // Without a literal settings module it is still not the root project's.
    let unknown = portal("import sys\n\nprint(sys.argv)\n");
    assert!(
        unknown.contains(&"tools/portal/portal/views.py page ANY /refund django".to_string()),
        "{unknown:?}"
    );
}

/// `drift security` on a DRF project: authentication and openings are not guards.
#[test]
fn drf_authentication_and_openings_are_not_guards() {
    // netbox's `TokenProvisionView`: no permission classes, a schema decorator.
    let views = "from django.contrib.auth.decorators import login_not_required
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView


class TokenProvisionView(APIView):
    permission_classes = []

    @extend_schema(responses={201: None})
    def post(self, request):
        return None


class AuthOnlyView(APIView):
    authentication_classes = [TokenAuthentication]

    def get(self, request):
        return None


class OpenView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return None


class GuardedView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return None


@login_not_required
def signup(request):
    return None
";
    let urls = "from django.urls import path

from . import views

urlpatterns = [
    path(\"provision/\", views.TokenProvisionView.as_view()),
    path(\"auth-only/\", views.AuthOnlyView.as_view()),
    path(\"open/\", views.OpenView.as_view()),
    path(\"guarded/\", views.GuardedView.as_view()),
    path(\"signup/\", views.signup),
]
";
    let manage =
        "import os\n\nos.environ.setdefault(\"DJANGO_SETTINGS_MODULE\", \"proj.settings\")\n";
    // `DEFAULT_PERMISSION_CLASSES` unset: DRF's default is `AllowAny`.
    let auth_only = "ROOT_URLCONF = \"proj.urls\"\nREST_FRAMEWORK = {\"DEFAULT_AUTHENTICATION_CLASSES\": [\"rest_framework.authentication.SessionAuthentication\"]}\n";
    let row = |inv: &drift_mine::security::Inventory, symbol: &str| {
        inv.entry_points
            .iter()
            .find(|e| e.symbol == symbol)
            .unwrap_or_else(|| panic!("{symbol}"))
            .clone()
    };
    for (settings, default_perm) in [
        (auth_only.to_string(), None),
        (
            format!(
                "{auth_only}REST_FRAMEWORK[\"DEFAULT_PERMISSION_CLASSES\"] = [\"rest_framework.permissions.AllowAny\"]\n"
            ),
            Some("permissions.AllowAny"),
        ),
    ] {
        let r = scan_files(&[
            ("manage.py", manage),
            ("proj/__init__.py", ""),
            ("proj/settings.py", &settings),
            ("proj/urls.py", urls),
            ("proj/views.py", views),
        ]);
        let inv = drift_mine::security::inventory(&r);
        let unguarded: Vec<&str> = inv.unguarded().map(|e| e.symbol.as_str()).collect();
        assert_eq!(
            unguarded,
            [
                "AuthOnlyView.get",
                "OpenView.get",
                "TokenProvisionView.post",
                "signup"
            ]
        );
        assert_eq!(
            row(&inv, "GuardedView.get").guards,
            ["permissions.IsAuthenticated"]
        );
        // Authentication is shown, as what it is.
        let provision = row(&inv, "TokenProvisionView.post");
        assert_eq!(
            provision.authenticates,
            ["authentication.SessionAuthentication (settings)"]
        );
        assert!(provision.opens.is_empty());
        let auth = row(&inv, "AuthOnlyView.get");
        assert_eq!(auth.authenticates, ["authentication.TokenAuthentication"]);
        assert_eq!(auth.opens, default_perm.into_iter().collect::<Vec<_>>());
        assert_eq!(row(&inv, "OpenView.get").opens, ["permissions.AllowAny"]);
        assert_eq!(
            row(&inv, "signup").opens,
            ["contrib.auth.decorators.login_not_required"]
        );
    }
}

#[test]
fn celery_periodic_tasks_and_conf_update_schedules() {
    let r = scan_files(&[
        ("proj/__init__.py", ""),
        (
            "proj/tasks.py",
            "from celery import Celery\nfrom celery.schedules import crontab\nfrom celery.task import periodic_task\n\napp = Celery(\"proj\")\napp.conf.update(beat_schedule={\"hourly\": dict(task=\"proj.tasks.tick\", schedule=crontab(minute=0))})\n\n\n@app.task\ndef tick():\n    pass\n\n\n@periodic_task(run_every=crontab(minute=0))\ndef legacy():\n    pass\n",
        ),
    ]);
    assert_eq!(
        entries(&r),
        [
            "proj/tasks.py legacy cron proj.tasks.legacy celery",
            "proj/tasks.py legacy job proj.tasks.legacy celery",
            "proj/tasks.py tick cron hourly celery",
            "proj/tasks.py tick job proj.tasks.tick celery",
        ]
    );
}

#[test]
fn relative_imports_init_reexports_and_src_layout() {
    let r = scan_fixture("pkg-relative", 0);
    let init = file(&r, "src/mylib/__init__.py");
    let origins: Vec<_> = init
        .exports
        .iter()
        .map(|e| (e.name.as_str(), e.origin.as_str()))
        .collect();
    assert_eq!(
        origins,
        [
            ("*", "src/mylib/utils/__init__.py#*"),
            ("Engine", "src/mylib/core.py#Engine"),
            ("VERSION", "src/mylib/__init__.py#VERSION"),
            ("helper", "src/mylib/utils/text.py#helper"),
            ("plugins", "src/mylib/plugins/__init__.py#*"),
            ("run_engine", "src/mylib/core.py#run"),
        ]
    );
    let tool = symbol(file(&r, "scripts/tool.py"), "main");
    for c in [
        "src/mylib/core.py#Engine",
        "src/mylib/core.py#run",
        "src/mylib/utils/text.py#slugify",
        "src/mylib/plugins/__init__.py#Plugin",
        "src/mylib/contrib/extra.py#make",
        "pkg:python:os#path.join",
        "pkg:requests#get",
    ] {
        assert!(tool.calls.contains(&c.to_string()), "{c}: {:?}", tool.calls);
    }
    let imports: Vec<_> = file(&r, "scripts/tool.py")
        .imports
        .iter()
        .map(|i| i.module.as_str())
        .collect();
    assert!(imports.contains(&"unresolved:mylib.missing"), "{imports:?}");
    // Star import names resolve to their origin; a parameter shadows the import.
    let core = file(&r, "src/mylib/core.py");
    assert!(
        symbol(core, "Engine")
            .calls
            .contains(&"src/mylib/utils/text.py#helper".to_string())
    );
    assert_eq!(
        wraps(symbol(core, "Engine")),
        [(WrapKind::Extends, "src/mylib/base.py#Base")]
    );
    // `engine.start()` on a parameter annotated with the class is the class's method.
    assert_eq!(
        symbol(core, "run").calls,
        ["global#RuntimeError", "src/mylib/core.py#Engine.start"]
    );
    let type_only: Vec<_> = core
        .imports
        .iter()
        .filter(|i| i.type_only)
        .map(|i| i.module.as_str())
        .collect();
    assert_eq!(type_only, ["src/mylib/plugins/__init__.py"]);
    // `__all__` decides what a module exports.
    let utils = file(&r, "src/mylib/utils/__init__.py");
    let names: Vec<_> = utils.exports.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["helper"]);
}

#[test]
fn debug_imports_report_submodules_and_attributes() {
    let rows = debug_imports(&fixture("pkg-relative")).unwrap();
    let find = |spec: &str| {
        rows.iter()
            .find(|r| r.file == "scripts/tool.py" && r.spec == spec)
            .map(|r| r.module.as_str())
    };
    assert_eq!(find("mylib"), Some("src/mylib/__init__.py"));
    assert_eq!(find("mylib:Engine"), Some("src/mylib/core.py#Engine"));
    assert_eq!(find("mylib:plugins"), Some("src/mylib/plugins/__init__.py"));
    assert_eq!(find("mylib.contrib"), Some("src/mylib/contrib"));
    assert_eq!(
        find("mylib.contrib:extra"),
        Some("src/mylib/contrib/extra.py")
    );
    assert_eq!(find("os.path"), Some("pkg:python:os.path"));
}

#[test]
fn import_edge_cases_follow_importlib() {
    let rows = debug_imports(&fixture("import-edge-cases")).unwrap();
    let find = |file: &str, spec: &str| {
        rows.iter()
            .find(|r| r.file == file && r.spec == spec)
            .map(|r| r.module.as_str())
            .unwrap_or_else(|| panic!("{file} {spec}"))
    };
    // A package beats a module of the same name.
    assert_eq!(find("scripts/y.py", "a"), "a/__init__.py");
    // A directory without Python code is not a namespace package.
    assert_eq!(find("scripts/y.py", "b"), "pkg:b");
    // The script's own directory comes first, before the standard library.
    assert_eq!(find("scripts/y.py", "logging"), "scripts/logging.py");
    assert_eq!(find("top.py", "logging"), "pkg:python:logging");
    assert_eq!(find("scripts/y.py", "util"), "scripts/util.py");
    // `__init__` binds `foo` to the function, shadowing the submodule.
    assert_eq!(find("scripts/y.py", "pkg:foo"), "pkg/foo.py#foo");
    assert_eq!(find("scripts/y.py", "pkg:bar"), "pkg/bar.py");
    assert_eq!(find("scripts/y.py", "pkg:sub"), "pkg/sub/__init__.py");
    // Nested namespace packages, and relative imports beyond the top-level package.
    assert_eq!(find("scripts/y.py", "ns.inner:mod"), "ns/inner/mod.py");
    assert_eq!(find("pkg/m.py", ".."), "unresolved:..");
    assert_eq!(find("pkg/m.py", ".:foo"), "pkg/foo.py#foo");
}

#[test]
fn imports_match_names_case_exactly() {
    // Names are matched against directory listings, as importlib's FileFinder does,
    // so a case-insensitive file system (macOS) gives the same answer as Linux.
    let rows = debug_imports(&fixture("import-case")).unwrap();
    let find = |spec: &str| {
        rows.iter()
            .find(|r| r.file == "app.py" && r.spec == spec)
            .map(|r| r.module.as_str())
            .unwrap_or_else(|| panic!("{spec}"))
    };
    assert_eq!(find("Models"), "pkg:Models");
    assert_eq!(find("models"), "models.py");
    assert_eq!(find("markdown"), "pkg:markdown");
    assert_eq!(find("Markdown"), "Markdown");
    assert_eq!(find("Markdown:core"), "Markdown/core.py");
}

#[cfg(unix)]
#[test]
fn symlinks_out_of_the_repo_are_not_followed() {
    let outside = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(outside.path().join("deep/er")).unwrap();
    std::fs::write(outside.path().join("deep/er/x.py"), "x = 1\n").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    std::fs::create_dir_all(r.join("pkg")).unwrap();
    std::fs::write(r.join("pkg/__init__.py"), "").unwrap();
    std::fs::write(
        r.join("main.py"),
        "from pkg.outside import deep\nimport linked\n",
    )
    .unwrap();
    std::os::unix::fs::symlink(outside.path(), r.join("pkg/outside")).unwrap();
    std::os::unix::fs::symlink(outside.path(), r.join("linked")).unwrap();
    let rows = debug_imports(r).unwrap();
    let module = |spec: &str| {
        rows.iter()
            .find(|x| x.spec == spec)
            .map(|x| x.module.clone())
            .unwrap()
    };
    assert_eq!(module("pkg.outside"), "unresolved:pkg.outside");
    assert_eq!(module("linked"), "pkg:linked");
}

#[test]
fn security_signals_are_detected_and_safe_forms_are_not() {
    let r = scan_fixture("signals", 0);
    let f = file(&r, "sinks.py");
    let sinks = |name: &str| symbol(f, name).sinks.clone();
    assert_eq!(sinks("run_eval"), ["eval"]);
    assert!(sinks("run_literal_eval").is_empty());
    assert_eq!(sinks("shell"), ["shell_exec"]);
    assert!(sinks("no_shell").is_empty());
    assert_eq!(sinks("sql"), ["sql_string_interpolation"]);
    assert!(sinks("safe_sql").is_empty());
    assert_eq!(sinks("raw_sql"), ["raw_sql"]);
    assert_eq!(sinks("deserialize"), ["unsafe_deserialize"]);
    assert!(sinks("safe_deserialize").is_empty());
    assert_eq!(sinks("fetch"), ["dynamic_fetch"]);
    assert!(sinks("fixed_fetch").is_empty());
    assert_eq!(sinks("hashes"), ["weak_hash"]);
    assert!(sinks("hash_ok").is_empty());
    assert_eq!(sinks("decode"), ["jwt_decode_without_verify"]);
    assert_eq!(sinks("cookies"), ["cookie_without_httponly"]);
    assert!(sinks("cookies_ok").is_empty());
    assert_eq!(sinks("html"), ["raw_html"]);
    assert_eq!(sinks("redirects"), ["dynamic_redirect"]);
    assert!(sinks("redirects_ok").is_empty());
}

#[test]
fn suppressions_need_a_reason() {
    let r = scan_fixture("signals", 0);
    let f = file(&r, "sinks.py");
    assert_eq!(symbol(f, "suppressed").suppressions, ["D-abc123"]);
    assert!(symbol(f, "redirects_ok").suppressions.is_empty());
}

#[test]
fn output_is_deterministic_across_threads_and_checkout_paths() {
    for name in FIXTURES {
        let a = serde_json::to_string(&scan_fixture(name, 1)).unwrap();
        let b = serde_json::to_string(&scan_fixture(name, 8)).unwrap();
        assert_eq!(a, b, "{name}: thread count changed the output");
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("some/other/place");
        copy_dir(&fixture(name), &dest);
        let c = serde_json::to_string(&scan(&dest, &ScanOptions::default()).unwrap().0).unwrap();
        assert_eq!(a, c, "{name}: checkout path leaked into the output");
    }
}

#[test]
fn cache_hits_give_identical_facts() {
    let tmp = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(tmp.path().to_path_buf()),
        threads: 0,
    };
    let (cold, s1) = scan(&fixture("fastapi-app"), &opts).unwrap();
    let (warm, s2) = scan(&fixture("fastapi-app"), &opts).unwrap();
    // Identical files (empty `__init__.py`) share an entry even on the first scan.
    assert!(s1.cache_hits < s1.files);
    assert_eq!(s2.cache_hits, s2.files);
    assert_eq!(cold, warm);
}

#[test]
fn malformed_code_is_best_effort() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("broken.py"),
        "def ok():\n    return 1\n\ndef broken(:\n    pass\n\nclass After:\n    pass\n",
    )
    .unwrap();
    // A Jinja template with a `.py` extension: recovery yields a class without a name.
    std::fs::write(
        tmp.path().join("template.py"),
        "from base import Base\n\nclass {{ m.name }}(Base):\n    pass\n",
    )
    .unwrap();
    // Nesting that would overflow the parser's stack is skipped before parsing.
    std::fs::write(
        tmp.path().join("deep_paren.py"),
        format!("x = {}1{}\n", "(\n".repeat(100_000), "\n)".repeat(100_000)),
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("deep_call.py"),
        format!(
            "def f():\n    return ({}{})\n",
            "g(\n".repeat(80_000),
            ")\n".repeat(80_000)
        ),
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("long_attr.py"),
        format!("import os\nx = (os\n{})\n", ".a\n".repeat(200_000)),
    )
    .unwrap();
    let r = scan(tmp.path(), &ScanOptions::default()).unwrap().0;
    let f = file(&r, "broken.py");
    assert!(!f.parse_ok);
    assert!(f.symbols.iter().any(|s| s.name == "ok"));
    assert!(f.symbols.iter().any(|s| s.name == "After"));
    let t = file(&r, "template.py");
    assert!(
        t.symbols.iter().all(|s| !s.name.is_empty()),
        "{:?}",
        t.symbols
    );
    assert!(t.exports.iter().all(|e| !e.name.is_empty()));
    let deep: Vec<_> = r
        .skipped
        .iter()
        .filter(|s| s.reason == SkipReason::TooDeep)
        .map(|s| s.path.as_str())
        .collect();
    assert_eq!(deep, ["deep_call.py", "deep_paren.py", "long_attr.py"]);
}

#[test]
fn lone_carriage_returns_end_lines_and_type_checking_else_is_the_runtime_binding() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(
        tmp.path().join("cr.py"),
        "import os\r# drift-ignore D-abc123: reason\rdef f(cmd):\r    os.system(cmd)\r",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("tc.py"),
        "from typing import TYPE_CHECKING\n\nif TYPE_CHECKING:\n    from models import User\nelse:\n    User = object\n\n\ndef make():\n    return User()\n",
    )
    .unwrap();
    let r = scan(tmp.path(), &ScanOptions::default()).unwrap().0;
    let f = symbol(file(&r, "cr.py"), "f");
    assert_eq!(f.line, 3);
    assert_eq!(f.suppressions, ["D-abc123"]);
    assert_eq!(symbol(file(&r, "tc.py"), "make").calls, ["tc.py#User"]);
}

#[test]
fn snapshots() {
    for name in FIXTURES {
        let r = scan_fixture(name, 0);
        insta::assert_snapshot!(
            format!("{name}_facts"),
            serde_json::to_string_pretty(&r).unwrap()
        );
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_dir(&e.path(), &dest);
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}

#[test]
fn keys_left_out_by_other_calls_to_the_same_callee_are_recorded() {
    let r = scan_files(&[
        ("app/__init__.py", ""),
        (
            "app/rendering.py",
            "class FieldSet:\n    pass\n\n\nclass Column:\n    pass\n",
        ),
        (
            "app/forms.py",
            "from app.rendering import FieldSet, Column\n\n\
         class Filters:\n    fieldsets = (\n        FieldSet('q', 'id'),\n        FieldSet('site', name='Site'),\n    )\n\n\
         class Table:\n    a = Column(verbose_name='A')\n    b = Column(verbose_name='B', linkify=True)\n\n\
         class Spread:\n    a = Column(**{'verbose_name': 'A'})\n    b = Column(verbose_name='B')\n",
        ),
    ]);
    let f = file(&r, "app/forms.py");
    // One `FieldSet()` names its group and one does not: `name` is optional per call.
    assert_eq!(
        symbol(f, "Filters").omits,
        ["app/rendering.py#FieldSet@99:name"]
    );
    // Every `Column()` passes `verbose_name`; `linkify` is left out by one of them.
    assert_eq!(
        symbol(f, "Table").omits,
        ["app/rendering.py#Column@99:linkify"]
    );
    // A call that unpacks a mapping may pass any key, so it leaves none out.
    assert!(symbol(f, "Spread").omits.is_empty());
}

#[test]
fn class_body_calls_are_declarations_and_method_calls_are_not() {
    let r = scan_files(&[
        ("app/__init__.py", ""),
        (
            "app/fields.py",
            "def Field(**kw):\n    return kw\n\n\ndef helper():\n    return 1\n",
        ),
        (
            "app/forms.py",
            "from app.fields import Field, helper\n\n\nclass Form:\n    name = Field(label='Name')\n\n    class Meta:\n        extra = Field()\n\n    def clean(self):\n        return helper()\n",
        ),
    ]);
    let form = symbol(file(&r, "app/forms.py"), "Form");
    assert!(form.calls.contains(&"app/fields.py#helper".to_string()));
    // Each attribute with what its statement calls, the bindings themselves (so a
    // subclass's reassignment is seen), and nothing from the method's body.
    assert_eq!(
        form.declares,
        [
            "Meta=",
            "Meta=app/fields.py#Field",
            "clean=",
            "name=",
            "name=app/fields.py#Field"
        ]
    );
}

#[test]
fn a_class_attribute_bound_inside_a_compound_statement_is_the_classes_own() {
    // Review probe (#27): each body rebinds `fieldsets` without a plain top-level
    // assignment. The class's own attributes are everything its scope binds, so a
    // subclass does not inherit its base's `fieldsets` through any of them; calls in
    // the statement go to the names it binds.
    let bodies = [
        (
            "if/else",
            "    if DEBUG:\n        fieldsets = ()\n    else:\n        fieldsets = (FieldSet('a'),)\n",
        ),
        ("if", "    if DEBUG:\n        fieldsets = ()\n"),
        (
            "try",
            "    try:\n        fieldsets = ()\n    except Exception:\n        pass\n",
        ),
        ("with", "    with open('x') as fieldsets:\n        pass\n"),
        ("for", "    for fieldsets in ((), ()):\n        pass\n"),
        (
            "match",
            "    match DEBUG:\n        case 1:\n            fieldsets = ()\n",
        ),
        ("walrus", "    x = (fieldsets := ())\n"),
        ("import", "    from app.empty import fieldsets\n"),
        ("import as", "    import app.empty as fieldsets\n"),
    ];
    for (form, body) in bodies {
        let text = format!(
            "from app.rendering import FieldSet\n\nDEBUG = False\n\n\nclass SiteForm:\n{body}"
        );
        let r = scan_files(&[
            ("app/__init__.py", ""),
            ("app/empty.py", "fieldsets = ()\n"),
            ("app/rendering.py", "def FieldSet(*a):\n    return a\n"),
            ("app/forms.py", &text),
        ]);
        let declares = &symbol(file(&r, "app/forms.py"), "SiteForm").declares;
        assert!(
            declares.contains(&"fieldsets=".to_string()),
            "{form}: {declares:?}"
        );
        if form == "if/else" {
            assert!(
                declares.contains(&"fieldsets=app/rendering.py#FieldSet".to_string()),
                "{declares:?}"
            );
            assert!(!declares.iter().any(|d| d.starts_with("=")), "{declares:?}");
        }
    }
    // An annotation without a value counts as the class's own: in a pydantic model or
    // a dataclass it redeclares the field, without the base's `Field(...)`.
    let r = scan_files(&[
        ("app/__init__.py", ""),
        (
            "app/forms.py",
            "class SiteForm:\n    fieldsets: tuple\n    other: int = 1\n",
        ),
    ]);
    assert_eq!(
        symbol(file(&r, "app/forms.py"), "SiteForm").declares,
        ["fieldsets=", "other="]
    );
}

#[test]
fn a_class_whose_bases_are_not_all_known_extends_an_unknown_base() {
    // `class Schema(*BASES)` and a class defined again with other bases: what they
    // extend is not in the facts, so they carry the unknown base (no class of the repo).
    let unknown = format!("global#{}", drift_core::UNKNOWN_BASE_NAME);
    let r = scan_files(&[
        ("app/__init__.py", ""),
        (
            "app/starred.py",
            "from pydantic import BaseModel\n\nBASES = (BaseModel,)\n\n\nclass Schema(*BASES):\n    pass\n",
        ),
        (
            "app/redefined.py",
            "import sys\n\nfrom pydantic import BaseModel\n\nif sys.version_info >= (3, 99):\n    class Schema:\n        pass\nelse:\n    class Schema(BaseModel):\n        pass\n",
        ),
        (
            "app/same.py",
            "import sys\n\nfrom pydantic import BaseModel\n\nif sys.version_info >= (3, 99):\n    class Schema(BaseModel):\n        pass\nelse:\n    class Schema(BaseModel):\n        x = 1\n",
        ),
    ]);
    let s = symbol(file(&r, "app/starred.py"), "Schema");
    assert_eq!(wraps(s), [(WrapKind::Extends, unknown.as_str())]);
    let s = symbol(file(&r, "app/redefined.py"), "Schema");
    assert_eq!(wraps(s), [(WrapKind::Extends, unknown.as_str())]);
    // The same bases in every definition: known.
    let s = symbol(file(&r, "app/same.py"), "Schema");
    assert_eq!(wraps(s), [(WrapKind::Extends, "pkg:pydantic#BaseModel")]);
}

/// Copy every cache entry under `from` (a parser tag directory) to the sibling tag
/// `to`, with `fields` removed from every symbol: what a build that lowered without
/// those facts would have written.
fn stale_copy(from: &Path, to: &Path, fields: &[&str]) -> usize {
    let mut n = 0;
    for shard in std::fs::read_dir(from).unwrap().flatten() {
        if !shard.path().is_dir() {
            continue;
        }
        for e in std::fs::read_dir(shard.path()).unwrap().flatten() {
            let Ok(mut v) =
                serde_json::from_slice::<serde_json::Value>(&std::fs::read(e.path()).unwrap())
            else {
                continue;
            };
            if let Some(syms) = v.get_mut("symbols").and_then(|s| s.as_array_mut()) {
                for s in syms {
                    if let Some(o) = s.as_object_mut() {
                        for f in fields {
                            o.remove(*f);
                        }
                    }
                }
            }
            let dest = to.join(shard.file_name()).join(e.file_name());
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            std::fs::write(dest, serde_json::to_vec(&v).unwrap()).unwrap();
            n += 1;
        }
    }
    n
}

#[test]
fn a_cache_written_before_the_class_facts_is_not_read() {
    // Lowering version 4 wrote entries without `declares` (and, before that, `omits`).
    // This build must not read them: a scan on such a cache equals a `--no-cache` scan.
    let src = tempfile::tempdir().unwrap();
    for (path, text) in [
        ("app/__init__.py", ""),
        ("app/rendering.py", "def FieldSet(*a, **k):\n    return a\n"),
        (
            "app/base.py",
            "from app.rendering import FieldSet\n\n\nclass BaseForm:\n    fieldsets = (FieldSet('q'), FieldSet('a', name='A'))\n",
        ),
        (
            "app/forms.py",
            "from app.base import BaseForm\n\n\nclass SiteForm(BaseForm):\n    pass\n",
        ),
    ] {
        let p = src.path().join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    let fresh = scan(src.path(), &ScanOptions::default()).unwrap().0;
    let cache = tempfile::tempdir().unwrap();
    let opts = ScanOptions {
        cache_dir: Some(cache.path().to_path_buf()),
        threads: 1,
    };
    assert_eq!(scan(src.path(), &opts).unwrap().0, fresh);
    // Replace this build's entries by what lowering version 4 wrote.
    let tag = drift_py::parser_tag();
    let current = std::fs::read_dir(cache.path())
        .unwrap()
        .flatten()
        .map(|d| d.path().join(&tag))
        .find(|p| p.is_dir())
        .expect("this build's cache directory");
    let old = current.with_file_name(format!("py-l4-{}", env!("CARGO_PKG_VERSION")));
    assert_ne!(old, current, "the lowering version changed with the facts");
    assert!(stale_copy(&current, &old, &["declares", "omits"]) > 0);
    std::fs::remove_dir_all(&current).unwrap();
    let again = scan(src.path(), &opts).unwrap().0;
    assert_eq!(again, fresh);
    assert!(
        symbol(file(&again, "app/base.py"), "BaseForm")
            .declares
            .contains(&"fieldsets=app/rendering.py#FieldSet".to_string())
    );
}

// F7, F8: a class's own `Meta` (`model`, `abstract`, `proxy`), the reference a class
// decorator is called with, and what a docstring explicitly says a class is not.
#[test]
fn class_meta_decorator_arguments_and_docstring_disclaimers_are_facts() {
    let r = scan_files(&[
        (
            "app/models.py",
            "class Site:\n    pass\n\n\nclass Interface:\n    pass\n",
        ),
        (
            "app/registry.py",
            "def register_filterset(cls):\n    return cls\n\n\ndef register_type(model, **kw):\n    return lambda cls: cls\n",
        ),
        (
            "app/filtersets.py",
            concat!(
                "from app import models\n",
                "from app.models import Interface, Site\n",
                "from app.registry import register_filterset, register_type\n\n\n",
                "@register_filterset\n",
                "class SiteFilterSet:\n",
                "    class Meta:\n",
                "        model = Site\n",
                "        fields = ('id',)\n\n\n",
                "class InterfaceConnectionFilterSet:\n",
                "    \"\"\"Secondary filterset; not registered with `register_filterset`.\"\"\"\n\n",
                "    class Meta:\n",
                "        model = models.Interface\n\n\n",
                "class BaseFilterSet:\n",
                "    class Meta:\n",
                "        abstract = True\n",
                "        proxy = False\n\n\n",
                "class SiteProxy(Site):\n",
                "    class Meta:\n",
                "        proxy = True\n\n\n",
                "@register_type(Interface, filters=None)\n",
                "class InterfaceType:\n",
                "    \"\"\"The GraphQL type. Not a ChoiceSet: see the registry.\"\"\"\n\n\n",
                "class ActionChoices:\n",
                "    \"\"\"Built-in actions. Not a ChoiceSet.\"\"\"\n\n\n",
                "class ColourChoices:\n",
                "    \"\"\"A ChoiceSet of colours, like ChoiceSet.\"\"\"\n\n\n",
                "def helper():\n",
                "    \"\"\"Does not use `register_type()`.\"\"\"\n",
            ),
        ),
    ]);
    let f = file(&r, "app/filtersets.py");
    assert_eq!(
        symbol(f, "SiteFilterSet").meta,
        ["model=app/models.py#Site"]
    );
    // A module attribute resolves like a name.
    assert_eq!(
        symbol(f, "InterfaceConnectionFilterSet").meta,
        ["model=app/models.py#Interface"]
    );
    assert_eq!(
        symbol(f, "InterfaceConnectionFilterSet").disclaims,
        ["register_filterset=not registered with register_filterset"]
    );
    // Only flags set to `True`; the base is abstract, so it is in no role either.
    assert_eq!(symbol(f, "BaseFilterSet").meta, ["abstract"]);
    assert!(
        symbol(f, "BaseFilterSet")
            .traits
            .iter()
            .any(|t| t == "abstract")
    );
    assert_eq!(symbol(f, "SiteProxy").meta, ["proxy"]);
    assert_eq!(
        symbol(f, "InterfaceType").decorator_args,
        ["app/registry.py#register_type=app/models.py#Interface"]
    );
    // A decorator called with no argument, or used bare, records none.
    assert!(symbol(f, "SiteFilterSet").decorator_args.is_empty());
    assert_eq!(
        symbol(f, "ActionChoices").disclaims,
        ["ChoiceSet=Not a ChoiceSet"]
    );
    // Mentioning a name is not disclaiming it.
    assert!(symbol(f, "ColourChoices").disclaims.is_empty());
    assert_eq!(
        symbol(f, "helper").disclaims,
        ["register_type=Does not use register_type"]
    );
}

#[test]
fn purpose_facts_say_what_a_class_is_for() {
    let r = scan_fixture("purpose", 0);
    let traits = |path: &str, name: &str| symbol(file(&r, path), name).traits.clone();
    // Abstract: derives from `ABC`, or declares an abstract method.
    assert_eq!(
        traits("shop/payments.py", "Gateway"),
        ["abstract", "base", "subclassed"]
    );
    assert_eq!(traits("shop/payments.py", "Refunds"), ["abstract"]);
    // A concrete parent extended once is subclassed, not a base; a class only tests
    // extend (`tests/test_orders.py`, `shop/tests.py`) is neither.
    assert_eq!(traits("shop/payments.py", "Order"), ["subclassed"]);
    assert!(traits("shop/payments.py", "Invoice").is_empty());
    assert!(traits("shop/payments.py", "StripeGateway").is_empty());
    // Test helpers: everything in a test-support module, and classes named for a test
    // double; not a word that only starts like one, a function named `fake_*`, or
    // test code itself.
    assert_eq!(traits("shop/fakes.py", "InMemoryGateway"), ["test_helper"]);
    assert_eq!(traits("shop/fakes.py", "make_order"), ["test_helper"]);
    assert_eq!(traits("shop/clock.py", "FakeClock"), ["test_helper"]);
    assert!(traits("shop/clock.py", "Fakeroot").is_empty());
    assert!(traits("shop/clock.py", "fake_user").is_empty());
    assert!(traits("tests/test_orders.py", "FakeMailer").is_empty());
    // Subclasses on the test side do not make a class subclassed: Django's `tests.py`
    // (`InvoiceTests`), or a test double in a test-support module (`InMemoryLedger`).
    assert!(traits("shop/payments.py", "Ledger").is_empty());
    assert_eq!(traits("shop/fakes.py", "InMemoryLedger"), ["test_helper"]);
    assert!(traits("shop/tests.py", "InvoiceTests").is_empty());
    // Forwarding: a parameter of the function's own reaches a call of its own name.
    assert_eq!(traits("shop/jsonio.py", "load"), ["forwards"]);
    assert!(
        traits("shop/jsonio.py", "loads").is_empty(),
        "a nested function's parameter shadows the outer one"
    );
    assert!(
        traits("shop/settings.py", "load").is_empty(),
        "json.load(fp) on a file it opens itself"
    );
    assert_eq!(traits("shop/http.py", "post"), ["forwards"]);
    // Every same-name library call must receive its parameters: `os.environ.get` does
    // not (the forwarded `session.get` is in-repo); nor does `asyncio.run`; a recursive
    // call to itself does not count.
    assert!(traits("shop/http.py", "get").is_empty());
    assert!(traits("shop/procs.py", "run").is_empty());
    assert!(traits("shop/codec.py", "dumps").is_empty());
    // A reassigned parameter, or one passed only as an optional keyword, is not what
    // the call is about.
    assert!(traits("shop/config.py", "load").is_empty());
    assert!(traits("shop/api.py", "get").is_empty());
}

// A registry function files its argument and hands it back unchanged (netbox's
// `register_filterset`, `register_search`); a decorator that changes, wraps or passes
// on the class is none, whatever it is named.
#[test]
fn registry_functions_are_told_from_decorators_that_change_the_class() {
    let r = scan_files(&[(
        "app/registry.py",
        concat!(
            "registry = {'filtersets': {}, 'search': {}}\n",
            "_plugins = []\n\n\n",
            "def register_filterset(filterset_class):\n",
            "    \"\"\"Decorator for registering a FilterSet.\"\"\"\n",
            "    model = filterset_class._meta.model\n",
            "    label = f'{model._meta.app_label}.{model._meta.model_name}'\n",
            "    registry['filtersets'][label] = filterset_class\n",
            "    return filterset_class\n\n\n",
            "def register_plugin(cls):\n",
            "    _plugins.append(cls)\n",
            "    return cls\n\n\n",
            "def returns_only(cls):\n",
            "    return cls\n\n\n",
            "def sets_flag(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    cls.login_required = True\n",
            "    return cls\n\n\n",
            "def sets_attr(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    setattr(cls, 'permission_classes', ())\n",
            "    return cls\n\n\n",
            "def calls_method(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    cls.install()\n",
            "    return cls\n\n\n",
            "def calls_in_value(cls):\n",
            "    label = cls.label()\n",
            "    registry['search'][label] = cls\n",
            "    return cls\n\n\n",
            "def passes_on(cls):\n",
            "    registry['search'][cls.__name__] = audit(cls)\n",
            "    return cls\n\n\n",
            "def wraps_it(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    return protect(cls)\n\n\n",
            "def branches(cls):\n",
            "    if cls.model:\n",
            "        registry['search'][cls.__name__] = cls\n",
            "    return cls\n\n\n",
            "def nested(cls):\n",
            "    def inner():\n",
            "        return cls\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    return cls\n\n\n",
            "def aliases(cls):\n",
            "    other = cls\n",
            "    registry['search'][cls.__name__] = other\n",
            "    return cls\n\n\n",
            "@trace\n",
            "def decorated(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    return cls\n\n\n",
            "async def is_async(cls):\n",
            "    registry['search'][cls.__name__] = cls\n",
            "    return cls\n",
        ),
    )]);
    let f = file(&r, "app/registry.py");
    let registers = |name: &str| {
        symbol(f, name)
            .controls
            .iter()
            .any(|c| c == drift_core::controls::REGISTERS_ARG)
    };
    assert!(registers("register_filterset"));
    assert!(registers("register_plugin"));
    for name in [
        "returns_only",
        "sets_flag",
        "sets_attr",
        "calls_method",
        "calls_in_value",
        "passes_on",
        "wraps_it",
        "branches",
        "nested",
        "aliases",
        "decorated",
        "is_async",
    ] {
        assert!(!registers(name), "{name}");
    }
}

/// A class-based view's handler method calls what the class's own helper methods
/// call (`self._write(...)` returning `Response(...)`), two levels deep, but not what a
/// method of another object or an unrelated method of the class calls.
#[test]
fn handler_methods_call_through_their_class_helpers() {
    let r = scan_files(&[
        ("app/__init__.py", ""),
        ("app/audit.py", "def record(request):\n    return None\n"),
        ("app/mail.py", "def send():\n    return None\n"),
        (
            "app/views.py",
            "from rest_framework.response import Response\n\
         from rest_framework.views import APIView\n\
         from app.audit import record\n\
         from app.mail import send\n\
         \n\
         class OrgView(APIView):\n\
         \x20   def _write(self, request, partial):\n\
         \x20       record(request)\n\
         \x20       return self._answer(request)\n\
         \n\
         \x20   def _answer(self, request):\n\
         \x20       return Response({})\n\
         \n\
         \x20   def _unused(self):\n\
         \x20       send()\n\
         \n\
         \x20   def put(self, request):\n\
         \x20       return self._write(request, partial=False)\n\
         \n\
         \x20   def patch(self, request):\n\
         \x20       other = OrgView()\n\
         \x20       return other._write(request, partial=True)\n",
        ),
    ]);
    let f = file(&r, "app/views.py");
    let put = symbol(f, "OrgView.put");
    assert!(
        put.calls
            .iter()
            .any(|c| c == "pkg:rest_framework#response.Response"),
        "{:?}",
        put.calls
    );
    assert!(
        put.calls.iter().any(|c| c == "app/audit.py#record"),
        "{:?}",
        put.calls
    );
    assert!(
        !put.calls.iter().any(|c| c == "app/mail.py#send"),
        "{:?}",
        put.calls
    );
    // `other._write` is not called on the handler's own `self`.
    let patch = symbol(f, "OrgView.patch");
    assert!(
        !patch
            .calls
            .iter()
            .any(|c| c == "pkg:rest_framework#response.Response"),
        "{:?}",
        patch.calls
    );
}
