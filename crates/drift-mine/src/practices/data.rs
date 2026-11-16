//! Data access (PLAN-R13 §1.8): which database instrument each production symbol uses,
//! and from which layer. Population: symbols that call a database instrument (a client
//! library, or an in-repo client binding built from one) or reach a `raw_sql` /
//! `sql_string_interpolation` sink.
//!
//! The key is `<layer>:<instrument>`. The layer is `entry_direct` (an entry point's own
//! handler calls it), `script` (scripts, migrations, seeds, management commands),
//! `repository` (a module whose path names data access: `repositories/`, `crud.py`,
//! `db/`) or `service` (any other module). Layers come from the path, not from call
//! hops. Every unit of the population is known (the population is what a data call
//! proves); a file that did not parse is unknown. The tenancy filter is `authz`'s.

use drift_core::{FileFacts, Symbol, SymbolKind};

use super::common::{self, unknown, use_of};
use super::libraries::{REPOSITORY_PATHS, SCRIPT_PATHS, data_library};
use super::{Assignment, Concern, Cx, UnitRef, UnknownReason, VariantSource};

pub struct DataAccess;

/// Sinks that are SQL written by hand.
const SQL_SINKS: &[&str] = &["raw_sql", "sql_string_interpolation"];

/// The database library a callee reaches: a library's own call, or a call on an in-repo
/// client binding (a const, variable or class, never a function: calling a repository
/// function is not calling the database) built from one, or a model class built on one
/// (Django `.objects`, a `PrismaClient` subclass).
pub fn instrument_of(cx: &Cx<'_>, callee: &str) -> Option<String> {
    if let Some(l) = data_library(callee) {
        return Some(l);
    }
    if common::external(callee) {
        return None;
    }
    let ctx = cx.context();
    let d = ctx.definition(callee)?;
    match d.kind {
        SymbolKind::Const | SymbolKind::Variable => d.calls.iter().find_map(|c| data_library(c)),
        SymbolKind::Class | SymbolKind::Model => {
            let (module, _) = callee.split_once('#')?;
            let class = format!("{module}#{}", d.name);
            let built_on = ctx.ancestors(&class).iter().find_map(|a| data_library(a));
            // Python: a class that serves routes (`AnalyticsEndpoint.as_view()` in
            // `urlpatterns`) is a handler, not a client binding. The database calls
            // of its body are its handlers' own, counted on them; calling the class
            // or a member it does not define reaches none of them.
            if built_on.is_none() && serves_routes(cx, module, &d.name) {
                return None;
            }
            built_on.or_else(|| d.calls.iter().find_map(|c| data_library(c)))
        }
        // A function bound to what a call it was handed to gave back, called through
        // a member: a call on what the function built.
        SymbolKind::Function => {
            common::built_by_factory(cx, callee, d).and_then(|class| instrument_of(cx, class))
        }
        _ => None,
    }
}

/// A Python class of `module` that an entry point of its file is, or is a method of.
fn serves_routes(cx: &Cx<'_>, module: &str, class: &str) -> bool {
    let module = crate::mine::norm_ref(module);
    let Some(file) = cx
        .facts
        .files
        .iter()
        .find(|f| f.path == module.as_ref() && f.lang == "py")
    else {
        return false;
    };
    let method = format!("{class}.");
    file.entry_points
        .iter()
        .any(|e| e.symbol == class || e.symbol.starts_with(&method))
}

fn instruments(cx: &Cx<'_>, s: &Symbol) -> Vec<String> {
    let mut out: Vec<String> = s
        .calls
        .iter()
        .filter(|c| !c.ends_with("(ref)"))
        .filter_map(|c| instrument_of(cx, c))
        .collect();
    if s.sinks.iter().any(|k| SQL_SINKS.contains(&k.as_str())) {
        out.push("raw_sql".into());
    }
    out.sort();
    out.dedup();
    out
}

/// Where in the code a data call sits.
pub fn layer(file: &FileFacts, s: &Symbol) -> &'static str {
    if common::is_entry_symbol(file, s) {
        return "entry_direct";
    }
    let segs: Vec<String> = file
        .path
        .split('/')
        .map(|seg| seg.split('.').next().unwrap_or(seg).to_ascii_lowercase())
        .collect();
    let has = |list: &[&str]| segs.iter().any(|s| list.contains(&s.as_str()));
    if has(SCRIPT_PATHS) {
        "script"
    } else if has(REPOSITORY_PATHS) {
        "repository"
    } else {
        "service"
    }
}

impl Concern for DataAccess {
    fn id(&self) -> &'static str {
        super::DATA_ACCESS
    }

    fn unit(&self) -> &'static str {
        "symbol"
    }

    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>> {
        let mut out = Vec::new();
        for file in &cx.facts.files {
            for symbol in &file.symbols {
                if !instruments(cx, symbol).is_empty() {
                    out.push(UnitRef::Symbol { file, symbol });
                }
            }
        }
        out
    }

    fn assign<'a>(&self, cx: &Cx<'a>, unit: &UnitRef<'a>) -> Assignment {
        let UnitRef::Symbol { file, symbol } = *unit else {
            return unknown(UnknownReason::NoSymbol, "");
        };
        if !file.parse_ok {
            return unknown(UnknownReason::Unparsed, &file.path);
        }
        let l = layer(file, symbol);
        let uses = instruments(cx, symbol)
            .iter()
            .map(|i| use_of(l, i))
            .collect();
        common::known(uses, VariantSource::Vocab)
    }
}

#[cfg(test)]
mod tests {
    use super::super::common::fixtures;
    use super::super::common::testkit::{assign_all, empty, key, of};
    use super::*;

    #[test]
    fn clients_through_bindings_by_layer() {
        let facts = fixtures::next_clerk();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&DataAccess, &cx);
        let route = "app/api/projects/[projectId]/route.ts";
        assert_eq!(key(&of(&all, route, "GET")), "entry_direct:@prisma/client");
        assert_eq!(
            key(&of(&all, "lib/db.ts", "db")),
            "repository:@prisma/client"
        );
        let facts = fixtures::fastapi_split();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&DataAccess, &cx);
        assert_eq!(
            key(&of(&all, "services/api/app/deps.py", "get_db")),
            "service:sqlalchemy"
        );
        // A call of a repository function is not a database call.
        assert!(
            !all.iter()
                .any(|(_, n, _)| n == "create_item" || n == "read_item"),
            "{all:#?}"
        );
    }

    #[test]
    fn scripts_raw_sql_and_django_models() {
        let facts = fixtures::ts_cases();
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&DataAccess, &cx);
        assert_eq!(
            key(&of(&all, "scripts/seed.ts", "main")),
            "script:@prisma/client"
        );
        assert_eq!(
            key(&of(&all, "lib/repo/users.ts", "findUser")),
            "repository:raw_sql"
        );
        let facts = fixtures::py_cases();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&DataAccess, &cx);
        assert_eq!(
            key(&of(&all, "svc/web/views.py", "ItemView.get")),
            "entry_direct:django"
        );
        // Nothing the facts can prove is a database call: not in the population.
        assert!(!all.iter().any(|(p, _, _)| p == "svc/app/routes.py"));
        assert_eq!(
            of(&all, "svc/app/broken.py", "helper"),
            unknown(UnknownReason::Unparsed, "svc/app/broken.py")
        );
    }

    /// S3: a URLconf that hands a view class's `as_view()` to `path(...)` makes no
    /// database call, though the class's body (its handlers) does (plane
    /// `apps/api/plane/app/urls/analytic.py` `urlpatterns`, read `service:django`).
    /// The handler's own call is still counted on the handler.
    #[test]
    fn a_urlconf_naming_a_view_class_is_no_database_call() {
        let mut facts = fixtures::py_cases();
        let views = facts
            .files
            .iter_mut()
            .find(|f| f.path == "svc/web/views.py")
            .unwrap();
        let class = views
            .symbols
            .iter_mut()
            .find(|s| s.name == "ItemView")
            .unwrap();
        class.calls.push("pkg:django#db.models.Count".into());
        let mut urls = views.clone();
        urls.path = "svc/web/urls.py".into();
        urls.entry_points.clear();
        urls.symbols.truncate(1);
        urls.symbols[0].name = "urlpatterns".into();
        urls.symbols[0].kind = SymbolKind::Variable;
        urls.symbols[0].calls = vec![
            "pkg:django#urls.path".into(),
            "svc/web/views.py#ItemView.as_view".into(),
        ];
        facts.files.push(urls);
        let d = empty();
        let cx = Cx::new(&facts, &d);
        let all = assign_all(&DataAccess, &cx);
        assert!(
            !all.iter().any(|(p, _, _)| p == "svc/web/urls.py"),
            "{all:#?}"
        );
        assert_eq!(
            key(&of(&all, "svc/web/views.py", "ItemView.get")),
            "entry_direct:django"
        );
    }
}
