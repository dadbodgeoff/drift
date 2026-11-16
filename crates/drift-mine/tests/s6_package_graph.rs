//! The package graph links an import by name only to a package of the importer's
//! own ecosystem (stream S6, audit 5).

use drift_core::{FileFacts, Import, PackageFacts, RepoFacts};
use drift_mine::map::package_graph;

/// Pins the ecosystem check: before, the Python `import emails` of the backend was
/// an edge to the npm workspace package named `emails`, so the backend depended on
/// the email templates; a TypeScript import of the same name still is.
#[test]
fn an_import_by_name_lands_only_in_a_package_of_its_own_ecosystem() {
    let mut r = RepoFacts::default();
    let file = |path: &str, lang: &str, package: &str| FileFacts {
        path: path.into(),
        lang: lang.into(),
        package: package.into(),
        parse_ok: true,
        imports: vec![Import {
            module: "pkg:emails".into(),
            names: vec![],
            type_only: false,
            load: Default::default(),
        }],
        ..Default::default()
    };
    r.files.push(file("backend/app/mail.py", "py", "backend"));
    r.files.push(file("frontend/src/mail.ts", "ts", "frontend"));
    r.files.push(FileFacts {
        path: "emails/index.ts".into(),
        lang: "ts".into(),
        package: "emails".into(),
        parse_ok: true,
        ..Default::default()
    });
    r.packages.push(PackageFacts {
        path: "backend".into(),
        name: "app".into(),
        manifest: "backend/pyproject.toml".into(),
        ..Default::default()
    });
    for (path, name) in [("frontend", "frontend"), ("emails", "emails")] {
        r.packages.push(PackageFacts {
            path: path.into(),
            name: name.into(),
            ..Default::default()
        });
    }
    let g = package_graph(&r);
    assert!(!g.prod.contains_key("backend"), "{:?}", g.prod);
    assert_eq!(g.prod["frontend"]["emails"], 1);
}
