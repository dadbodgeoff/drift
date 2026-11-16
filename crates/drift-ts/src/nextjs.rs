//! Next.js adapter: execution facts only (which exports are routes, pages,
//! server actions or middleware). It never produces conventions.

use drift_core::{EntryPoint, FileFacts};

const HTTP_METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ADAPTER: &str = "nextjs";

fn stem_and_ext(file: &str) -> (&str, &str) {
    match file.rfind('.') {
        Some(i) => (&file[..i], &file[i + 1..]),
        None => (file, ""),
    }
}

/// Turn path segments after a router root into a route template.
/// Route groups `(x)` and parallel slots `@x` are dropped; dynamic segments are kept.
fn route_from(segments: &[&str]) -> String {
    let parts: Vec<&str> = segments
        .iter()
        .copied()
        .filter(|s| !(s.starts_with('(') && s.ends_with(')')) && !s.starts_with('@'))
        .collect();
    format!("/{}", parts.join("/"))
}

fn exports_named(facts: &FileFacts, name: &str) -> bool {
    facts.exports.iter().any(|e| e.name == name)
}

fn entry(symbol: &str, kind: &str, method: Option<&str>, route: Option<String>) -> EntryPoint {
    EntryPoint {
        symbol: symbol.to_string(),
        kind: kind.to_string(),
        method: method.map(str::to_string),
        route,
        adapter: ADAPTER.to_string(),
    }
}

/// Whether the package at `package` (repo-relative directory, `""` for the root) is
/// built with Next.js: its `package.json`, or one above it up to the repository root,
/// lists `next` as a dependency, dev dependency or peer dependency, or a directory on
/// the way has a `next.config.*`. It is not only when the package's own manifest
/// declares dependencies and neither it nor one above it is `next`: a manifest without
/// any (or none at all) says nothing about the framework, so it counts as Next.js and
/// routes are never dropped for lack of one. A Vite or Docusaurus app's `src/pages/Login.tsx` and a template's
/// `app/api/x/route.ts` inside a package that does not use Next.js are not Next.js
/// entry points.
pub fn package_uses_next(root: &std::path::Path, package: &str) -> bool {
    let mut dir = if package.is_empty() {
        root.to_path_buf()
    } else {
        root.join(package)
    };
    let mut declares = false;
    let mut first = true;
    loop {
        if NEXT_CONFIGS.iter().any(|c| dir.join(c).is_file()) {
            return true;
        }
        // A planted FIFO or device in place of a manifest is no manifest.
        if let Ok(text) = drift_core::fsutil::read_regular_to_string(
            &dir.join("package.json"),
            drift_core::fsutil::MAX_CONFIG_BYTES,
        ) && let Ok(json) = serde_json::from_str::<serde_json::Value>(&text)
        {
            let mut own = false;
            for k in ["dependencies", "devDependencies", "peerDependencies"] {
                let Some(deps) = json.get(k).and_then(|d| d.as_object()) else {
                    continue;
                };
                if deps.contains_key("next") {
                    return true;
                }
                own |= !deps.is_empty();
            }
            // The package's own manifest decides whether it declares its dependencies.
            if first {
                declares = own;
                first = false;
            }
        }
        if dir == root || !dir.pop() || !dir.starts_with(root) {
            return !declares;
        }
    }
}

const NEXT_CONFIGS: &[&str] = &[
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "next.config.mts",
];

/// Entry points for one file, derived from its path, exports and directives. `next`:
/// the file's package is built with Next.js ([`package_uses_next`]); otherwise only
/// server actions are read (a `"use server"` directive says so itself), not routes,
/// pages, layouts or middleware by file name.
pub fn entry_points(facts: &FileFacts, next: bool) -> Vec<EntryPoint> {
    let mut out = Vec::new();
    if !next {
        server_actions(facts, &mut out);
        return out;
    }
    let segs: Vec<&str> = facts.path.split('/').collect();
    let Some((file, dirs)) = segs.split_last() else {
        return out;
    };
    let (stem, ext) = stem_and_ext(file);
    if !matches!(ext, "ts" | "tsx" | "js" | "jsx" | "mjs") {
        return out;
    }
    file_entries(facts, stem, dirs, &mut out);
    server_actions(facts, &mut out);
    out
}

/// The routes, pages, layouts and middleware of a file named `stem` plus an
/// extension Next.js takes, in the directories `dirs`.
fn file_entries(facts: &FileFacts, stem: &str, dirs: &[&str], out: &mut Vec<EntryPoint>) {
    // App router: the last `app` directory in the path.
    if let Some(app_idx) = dirs.iter().rposition(|d| *d == "app") {
        let route = route_from(&dirs[app_idx + 1..]);
        match stem {
            "route" => {
                for m in HTTP_METHODS {
                    if exports_named(facts, m) {
                        out.push(entry(m, "http", Some(m), Some(route.clone())));
                    }
                }
            }
            "page" if exports_named(facts, "default") => {
                out.push(entry("default", "page", None, Some(route)))
            }
            "layout" if exports_named(facts, "default") => {
                out.push(entry("default", "layout", None, Some(route)))
            }
            _ => {}
        }
    } else if let Some(pages_idx) = dirs.iter().rposition(|d| *d == "pages") {
        // Pages router.
        let mut rest: Vec<&str> = dirs[pages_idx + 1..].to_vec();
        if stem != "index" {
            rest.push(stem);
        }
        let is_special = stem.starts_with('_');
        if exports_named(facts, "default") && !is_special {
            if rest.first() == Some(&"api") {
                out.push(entry(
                    "default",
                    "http",
                    Some("ANY"),
                    Some(route_from(&rest)),
                ));
            } else {
                out.push(entry("default", "page", None, Some(route_from(&rest))));
            }
        }
    }

    // Middleware sits next to `app`/`pages` or in `src/`.
    if stem == "middleware" {
        let sym = if exports_named(facts, "middleware") {
            "middleware"
        } else {
            "default"
        };
        if exports_named(facts, sym) {
            out.push(entry(sym, "middleware", None, None));
        }
    }
}

/// The extensions Next.js accepts for its file conventions when `next.config`
/// does not set `pageExtensions` (`config-shared` of Next.js 16: `tsx`, `ts`,
/// `jsx`, `js`). `.mts`, `.cts`, `.mjs` and `.cjs` are not among them: a
/// `route.mts` is no route unless the configuration lists `mts`.
const DEFAULT_PAGE_EXTENSIONS: &[&str] = &["tsx", "ts", "jsx", "js"];

/// What a Next.js package's own files say about the conventions the listed
/// reading reads ([`listed_entry_points`]), read once per package
/// ([`next_package`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextPackage {
    /// The package may run Next.js 16 or later, where `proxy.ts` is the
    /// middleware (Next.js 16.0.0 renamed `middleware` to `proxy`): the `next`
    /// its manifest declares admits 16, or the spec is not one Drift reads (a
    /// tag, a catalog, a workspace link). False only where every version the
    /// spec takes is older: there a `proxy.ts` is a file like any other.
    pub proxy: bool,
    /// The extensions its file conventions take: the `pageExtensions` literal of
    /// its `next.config`, or [`DEFAULT_PAGE_EXTENSIONS`].
    pub extensions: Vec<String>,
    /// The package directories, relative to the package (`""`, `"src"`), that
    /// hold a `middleware.*` file. Next.js 16 stops the build where one stands
    /// beside a `proxy.*` ("Both middleware file and proxy file are detected"),
    /// so no request is served through either: the proxy is not listed there.
    pub middleware_dirs: Vec<String>,
}

impl Default for NextPackage {
    fn default() -> Self {
        NextPackage {
            proxy: true,
            extensions: DEFAULT_PAGE_EXTENSIONS
                .iter()
                .map(|e| e.to_string())
                .collect(),
            middleware_dirs: Vec::new(),
        }
    }
}

/// [`NextPackage`] of the package at `package` (repo-relative, `""` for the
/// root): its nearest manifest that declares `next`, its nearest `next.config.*`.
pub fn next_package(root: &std::path::Path, package: &str) -> NextPackage {
    let pkg_dir = if package.is_empty() {
        root.to_path_buf()
    } else {
        root.join(package)
    };
    let mut out = NextPackage::default();
    let mut spec_read = false;
    let mut config_read = false;
    let mut dir = pkg_dir.clone();
    loop {
        if !config_read
            && let Some(config) = NEXT_CONFIGS
                .iter()
                .map(|c| dir.join(c))
                .find(|p| p.is_file())
        {
            config_read = true;
            if let Some(exts) = page_extensions_of(&config) {
                out.extensions = exts;
            }
        }
        if !spec_read
            && let Ok(text) = drift_core::fsutil::read_regular_to_string(
                &dir.join("package.json"),
                drift_core::fsutil::MAX_CONFIG_BYTES,
            )
            && let Ok(json) = serde_json::from_str::<serde_json::Value>(&text)
            && let Some(spec) = ["dependencies", "devDependencies", "peerDependencies"]
                .iter()
                .find_map(|k| json.get(k)?.get("next")?.as_str().map(str::to_string))
        {
            spec_read = true;
            out.proxy = admits_major(&spec, 16);
        }
        if (spec_read && config_read) || dir == root || !dir.pop() || !dir.starts_with(root) {
            break;
        }
    }
    for sub in ["", "src"] {
        let d = if sub.is_empty() {
            pkg_dir.clone()
        } else {
            pkg_dir.join(sub)
        };
        if out
            .extensions
            .iter()
            .any(|e| d.join(format!("middleware.{e}")).is_file())
        {
            out.middleware_dirs.push(sub.to_string());
        }
    }
    out
}

/// Whether the npm version range `spec` takes some version of major `major` or
/// later. Only a range Drift reads all of says no: every alternative (`||`) is a
/// plain version, a `^`/`~`/`=` one, or an upper bound (`<16`, `<=15.5`), below
/// `major`. Anything else (`latest`, `*`, `>=14`, `catalog:`, `workspace:*`, a
/// URL) may take it.
fn admits_major(spec: &str, major: u64) -> bool {
    let below = |alt: &str| -> bool {
        let parts: Vec<&str> = alt.split_whitespace().collect();
        // An intersection (`>=14 <16`) is below where any of its bounds is.
        parts.iter().any(|p| {
            let (upper, v) = if let Some(v) = p.strip_prefix("<=") {
                (Some(true), v)
            } else if let Some(v) = p.strip_prefix('<') {
                (Some(false), v)
            } else if p.starts_with('>') {
                return false;
            } else {
                (None, p.trim_start_matches(['^', '~', '=']))
            };
            let v = v.trim_start_matches(['=', 'v']);
            let mut nums = v.split(['.', '-', '+']);
            let Some(Ok(m)) = nums.next().map(str::parse::<u64>) else {
                return false;
            };
            let rest_zero = nums
                .take(2)
                .all(|n| n == "0" || n == "x" || n == "*" || n.is_empty());
            match upper {
                // `<16` and `<16.0.0` take nothing of 16; `<16.1` does.
                Some(false) => m < major || (m == major && rest_zero),
                Some(true) => m < major,
                None => m < major,
            }
        })
    };
    !spec
        .split("||")
        .map(str::trim)
        .all(|alt| !alt.is_empty() && below(alt))
}

/// The `pageExtensions` a Next.js configuration file sets, where every one it
/// sets is a list of string literals that agree; none where it sets none or one
/// Drift does not read (a binding, a spread, a call): then the defaults are read.
fn page_extensions_of(path: &std::path::Path) -> Option<Vec<String>> {
    use oxc_ast_visit::Visit;
    let text =
        drift_core::fsutil::read_regular_to_string(path, drift_core::fsutil::MAX_CONFIG_BYTES)
            .ok()?;
    let alloc = oxc_allocator::Allocator::default();
    let source_type = oxc_span::SourceType::from_path(path).unwrap_or_default();
    let ret = oxc_parser::Parser::new(&alloc, &text, source_type).parse();
    #[derive(Default)]
    struct Find {
        found: Vec<Option<Vec<String>>>,
    }
    fn literal_list(e: &oxc_ast::ast::Expression) -> Option<Vec<String>> {
        let oxc_ast::ast::Expression::ArrayExpression(a) = e.get_inner_expression() else {
            return None;
        };
        a.elements
            .iter()
            .map(
                |el| match el.as_expression().map(|x| x.get_inner_expression()) {
                    Some(oxc_ast::ast::Expression::StringLiteral(s)) => {
                        Some(s.value.display().to_string())
                    }
                    _ => None,
                },
            )
            .collect()
    }
    impl<'a> Visit<'a> for Find {
        fn visit_object_property(&mut self, it: &oxc_ast::ast::ObjectProperty<'a>) {
            if !it.computed
                && it
                    .key
                    .static_name()
                    .and_then(|n| n.as_str().map(String::from))
                    .is_some_and(|k| k == "pageExtensions")
            {
                self.found.push(literal_list(&it.value));
            }
            oxc_ast_visit::walk::walk_object_property(self, it);
        }
        fn visit_assignment_expression(&mut self, it: &oxc_ast::ast::AssignmentExpression<'a>) {
            if let oxc_ast::ast::AssignmentTarget::StaticMemberExpression(m) = &it.left
                && m.property.name == "pageExtensions"
            {
                self.found.push(literal_list(&it.right));
            }
            oxc_ast_visit::walk::walk_assignment_expression(self, it);
        }
    }
    let mut f = Find::default();
    f.visit_program(&ret.program);
    let first = f.found.first()?.clone()?;
    f.found
        .iter()
        .all(|x| x.as_ref() == Some(&first))
        .then_some(first)
        .filter(|l| !l.is_empty())
}

/// Every entry point of one file in the listed reading ([`drift_core::Listed`]):
/// those of [`entry_points`], which mining reads, and beside them what the last
/// measured build did not list:
///
/// - route, page, layout and middleware files under the extensions the package's
///   `pageExtensions` adds (`route.mts` where it lists `mts`);
/// - Next.js 16's `proxy.*` at the package root or in `src/`, under the name the
///   framework documents (`proxy`, or the default export), as the middleware;
/// - `getServerSideProps` of a Pages Router page: it runs on the server for every
///   request of the page, and answers `/_next/data/<build>/<route>.json` with
///   what it returns, so it is an HTTP entry point, `GET` at the page's route.
///   `getStaticProps` and `getStaticPaths` are not: they are handed no request
///   (no cookie, no header), so what they return is the page's own, served the
///   same to everyone who can load the page; nothing in them can tell callers
///   apart, and an entry point there could only ever read "no guard";
/// - inline server actions (`actions`): functions whose own body starts with
///   `"use server"` ([`inline_actions`]), each a server action as an exported
///   function of a `"use server"` module is.
pub fn listed_entry_points(
    facts: &FileFacts,
    next: bool,
    pkg: &NextPackage,
    actions: &[String],
) -> Vec<EntryPoint> {
    let mut out = entry_points(facts, next);
    for a in actions {
        out.push(entry(a, "server_action", None, None));
    }
    if next {
        let segs: Vec<&str> = facts.path.split('/').collect();
        if let Some((file, dirs)) = segs.split_last() {
            // The longest extension first: `page.tsx` before `tsx`.
            let mut exts: Vec<&str> = pkg.extensions.iter().map(String::as_str).collect();
            exts.sort_by_key(|e| std::cmp::Reverse(e.len()));
            if let Some(stem) = exts
                .iter()
                .find_map(|e| file.strip_suffix(*e)?.strip_suffix('.'))
            {
                file_entries(facts, stem, dirs, &mut out);
                proxy_entry(facts, stem, dirs, pkg, &mut out);
                server_side_props(facts, stem, dirs, &mut out);
            }
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    out.retain(|e| seen.insert(e.clone()));
    out
}

/// Next.js 16's `proxy.*`: in the package's own directory or its `src/`, the
/// function exported as `proxy` or by default, a middleware entry point read as
/// `middleware.*` is (its `config.matcher` included). Not where the package's
/// `next` is older than 16, nor where a `middleware.*` stands beside it (Next.js
/// stops the build).
fn proxy_entry(
    facts: &FileFacts,
    stem: &str,
    dirs: &[&str],
    pkg: &NextPackage,
    out: &mut Vec<EntryPoint>,
) {
    if stem != "proxy" || !pkg.proxy {
        return;
    }
    let pkg_dirs: Vec<&str> = if facts.package.is_empty() {
        Vec::new()
    } else {
        facts.package.split('/').collect()
    };
    let Some(within) = dirs.strip_prefix(pkg_dirs.as_slice()) else {
        return;
    };
    let sub = match within {
        [] => "",
        ["src"] => "src",
        _ => return,
    };
    if pkg.middleware_dirs.iter().any(|d| d == sub) {
        return;
    }
    let sym = if exports_named(facts, "proxy") {
        "proxy"
    } else {
        "default"
    };
    if exports_named(facts, sym) {
        out.push(entry(sym, "middleware", None, None));
    }
}

/// `getServerSideProps` of a Pages Router page ([`listed_entry_points`]).
fn server_side_props(facts: &FileFacts, stem: &str, dirs: &[&str], out: &mut Vec<EntryPoint>) {
    if dirs.contains(&"app") || !exports_named(facts, "getServerSideProps") {
        return;
    }
    let Some(pages_idx) = dirs.iter().rposition(|d| *d == "pages") else {
        return;
    };
    let mut rest: Vec<&str> = dirs[pages_idx + 1..].to_vec();
    if stem != "index" {
        rest.push(stem);
    }
    if stem.starts_with('_') || rest.first() == Some(&"api") {
        return;
    }
    out.push(entry(
        "getServerSideProps",
        "http",
        Some("GET"),
        Some(route_from(&rest)),
    ));
}

/// A function whose own body starts with `"use server"`, found by
/// [`inline_actions`].
pub(crate) enum ActionFn<'b, 'a> {
    Function(&'b oxc_ast::ast::Function<'a>),
    Arrow(&'b oxc_ast::ast::ArrowFunctionExpression<'a>),
}

/// One inline server action ([`inline_actions`]).
pub(crate) struct InlineAction<'b, 'a> {
    /// The module-level binding it is written in (`Page` of `export default
    /// function Page() { async function save() { "use server" } }`), `default`
    /// for a default export; none at the top of the module.
    pub owner: Option<&'b str>,
    /// The name it is bound to, declared with or written under: a function's
    /// own name, a variable, an object key, a JSX attribute (`action` of
    /// `<form action={async () => { "use server" }}>`); none for one written
    /// anywhere else.
    pub name: Option<&'b str>,
    /// It is the module-level binding itself (`export async function save() {
    /// "use server" }`), which is a symbol of the file already.
    pub top: bool,
    pub func: ActionFn<'b, 'a>,
}

fn says_use_server(body: Option<&oxc_ast::ast::FunctionBody>) -> bool {
    body.is_some_and(|b| b.directives.iter().any(|d| d.directive == "use server"))
}

/// Each function of `program` whose own body starts with the `"use server"`
/// directive, handed to `found` in source order. Next.js makes each such
/// function a server action, wherever it is written: a server component's body,
/// an object of props, a JSX attribute. Class methods are not read: Next.js
/// refuses an inline action there.
pub(crate) fn inline_actions<'a>(
    program: &oxc_ast::ast::Program<'a>,
    found: &mut dyn FnMut(InlineAction<'_, 'a>),
) {
    use oxc_ast::ast::*;
    use oxc_ast_visit::{Visit, walk};
    use oxc_span::{GetSpan, Span};

    struct Finder<'f, 'a> {
        found: &'f mut dyn FnMut(InlineAction<'_, 'a>),
        owner: Option<String>,
        /// The span of a value that is the module-level binding itself.
        top: Option<Span>,
        /// The name the next function of this span is bound to.
        named: Option<(String, Span)>,
        /// The span of a class method's function, which is not read.
        method: Option<Span>,
    }
    impl<'a> Finder<'_, 'a> {
        fn name_for(&self, span: Span) -> Option<String> {
            self.named
                .as_ref()
                .filter(|(_, s)| *s == span)
                .map(|(n, _)| n.clone())
        }
        fn report(&mut self, span: Span, own: Option<String>, func: ActionFn<'_, 'a>) {
            let top = self.top == Some(span);
            let name = own.or_else(|| self.name_for(span));
            let owner = self.owner.clone();
            (self.found)(InlineAction {
                owner: owner.as_deref(),
                name: name.as_deref(),
                top,
                func,
            });
        }
    }
    impl<'a> Visit<'a> for Finder<'_, 'a> {
        fn visit_function(&mut self, it: &Function<'a>, flags: oxc_semantic::ScopeFlags) {
            if self.method != Some(it.span) && says_use_server(it.body.as_deref()) {
                let own = it.id.as_ref().map(|i| i.name.to_string());
                self.report(it.span, own, ActionFn::Function(it));
            }
            walk::walk_function(self, it, flags);
        }
        fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
            if says_use_server(it.get_function_body()) {
                self.report(it.span, None, ActionFn::Arrow(it));
            }
            walk::walk_arrow_function_expression(self, it);
        }
        fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
            if let (BindingPattern::BindingIdentifier(id), Some(init)) = (&it.id, &it.init) {
                self.named = Some((id.name.to_string(), init.get_inner_expression().span()));
            }
            walk::walk_variable_declarator(self, it);
        }
        fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
            if !it.computed
                && let Some(k) = it
                    .key
                    .static_name()
                    .and_then(|n| n.as_str().map(String::from))
            {
                self.named = Some((k, it.value.get_inner_expression().span()));
            }
            walk::walk_object_property(self, it);
        }
        fn visit_jsx_attribute(&mut self, it: &JSXAttribute<'a>) {
            if let JSXAttributeName::Identifier(n) = &it.name
                && let Some(JSXAttributeValue::ExpressionContainer(c)) = &it.value
                && let Some(e) = c.expression.as_expression()
            {
                self.named = Some((n.name.to_string(), e.get_inner_expression().span()));
            }
            walk::walk_jsx_attribute(self, it);
        }
        fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
            self.method = Some(it.value.span);
            walk::walk_method_definition(self, it);
        }
    }

    let mut f = Finder {
        found,
        owner: None,
        top: None,
        named: None,
        method: None,
    };
    for stmt in &program.body {
        let (owner, top) = module_binding(stmt);
        f.owner = owner;
        f.top = top;
        f.named = None;
        f.visit_statement(stmt);
    }
}

/// The module-level name a statement binds, with the span of the function that
/// is that binding itself, if it is one ([`InlineAction::top`]).
fn module_binding(stmt: &oxc_ast::ast::Statement) -> (Option<String>, Option<oxc_span::Span>) {
    use oxc_ast::ast::*;
    use oxc_span::GetSpan;
    let declaration = |d: &Declaration| -> (Option<String>, Option<oxc_span::Span>) {
        match d {
            Declaration::FunctionDeclaration(f) => {
                (f.id.as_ref().map(|i| i.name.to_string()), Some(f.span))
            }
            Declaration::ClassDeclaration(c) => (c.id.as_ref().map(|i| i.name.to_string()), None),
            Declaration::VariableDeclaration(v) => match v.declarations.as_slice() {
                [d] => match (&d.id, &d.init) {
                    (BindingPattern::BindingIdentifier(id), Some(init)) => {
                        let inner = init.get_inner_expression();
                        let top = matches!(
                            inner,
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        )
                        .then(|| inner.span());
                        (Some(id.name.to_string()), top)
                    }
                    (BindingPattern::BindingIdentifier(id), None) => {
                        (Some(id.name.to_string()), None)
                    }
                    _ => (None, None),
                },
                _ => (None, None),
            },
            _ => (None, None),
        }
    };
    match stmt {
        Statement::ExportDeclaration(e) => declaration(&e.declaration),
        Statement::ExportDefaultDeclaration(e) => {
            let top = match &e.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => Some(f.span),
                other => other.as_expression().and_then(|x| {
                    let inner = x.get_inner_expression();
                    matches!(
                        inner,
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )
                    .then(|| inner.span())
                }),
            };
            // `export default function Page() {}` is the symbol `Page`, as the
            // lowering names it.
            let name = match &e.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                    f.id.as_ref()
                        .map_or("default".to_string(), |i| i.name.to_string())
                }
                ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                    c.id.as_ref()
                        .map_or("default".to_string(), |i| i.name.to_string())
                }
                _ => "default".to_string(),
            };
            (Some(name), top)
        }
        other => match other.as_declaration() {
            Some(d) => declaration(d),
            None => (None, None),
        },
    }
}

/// Server actions: every exported function of a `use server` module.
fn server_actions(facts: &FileFacts, out: &mut Vec<EntryPoint>) {
    if facts.directives.iter().any(|d| d == "use server") {
        for s in &facts.symbols {
            if matches!(s.kind, drift_core::SymbolKind::Function) {
                for name in &s.exported_as {
                    out.push(entry(name, "server_action", None, None));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drift_core::{Export, ExportKind};

    fn facts(path: &str, exports: &[&str]) -> FileFacts {
        FileFacts {
            path: path.into(),
            exports: exports
                .iter()
                .map(|n| Export {
                    name: (*n).into(),
                    origin: format!("{path}#{n}"),
                    kind: ExportKind::Local,
                })
                .collect(),
            ..FileFacts::default()
        }
    }

    #[test]
    fn app_router_routes_drop_groups_and_keep_dynamic_segments() {
        let f = facts(
            "apps/web/app/(dashboard)/api/links/[linkId]/route.ts",
            &["GET", "PATCH", "helper"],
        );
        let e = entry_points(&f, true);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].route.as_deref(), Some("/api/links/[linkId]"));
        assert_eq!(e[0].method.as_deref(), Some("GET"));
        assert_eq!(e[1].method.as_deref(), Some("PATCH"));
    }

    /// Which `next` specs may run Next.js 16, whose `proxy.ts` is the middleware:
    /// only a range wholly below 16 says no.
    #[test]
    fn next_specs_that_admit_16() {
        for spec in [
            "16.0.1", "^16.1.0", "~16", ">=14.0.0", "latest", "*", "catalog:", "", "15 || 16",
        ] {
            assert!(admits_major(spec, 16), "{spec}");
        }
        for spec in [
            "15.5.28", "^15.5.28", "~15.1", "<16", "<16.0.0", "<=15.9", ">=14 <16", "14 || 15",
        ] {
            assert!(!admits_major(spec, 16), "{spec}");
        }
    }

    #[test]
    fn pages_router_api_and_pages() {
        let api = entry_points(&facts("src/pages/api/users/index.ts", &["default"]), true);
        assert_eq!(api[0].kind, "http");
        assert_eq!(api[0].route.as_deref(), Some("/api/users"));
        let page = entry_points(&facts("pages/blog/[slug].tsx", &["default"]), true);
        assert_eq!(page[0].kind, "page");
        assert_eq!(page[0].route.as_deref(), Some("/blog/[slug]"));
        assert!(entry_points(&facts("pages/_app.tsx", &["default"]), true).is_empty());
    }
}
