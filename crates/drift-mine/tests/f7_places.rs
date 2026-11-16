//! Places of promoted practices (fix F7): a route place overlaps every directory and
//! file place of its package (a file's path cannot rule out that it serves a route
//! under the prefix); a route Drift cannot place to the end (a catch-all segment) is
//! counted as not read where it could be under the prefix, never a member; and a
//! departure is left to the check of a route-place practice only for a unit the check
//! reads as a member.

use drift_core::{EntryPoint, FileFacts};
use drift_mine::practices::promote::{Place, candidate, convention, covers_unit};
use drift_mine::practices::{AUTHN, ConcernReport, PracticesReport, UnitRow, Variant, VariantKind};

const AUTH: &str = "wrap:lib/auth.ts#withAuth";
const MEMBER: &str = "dependency:lib/member.py#require_member";

fn variant(id: &str, key: &str, label: &str, kind: VariantKind) -> Variant {
    Variant {
        id: id.into(),
        key: key.into(),
        label: label.into(),
        kind,
        ..Variant::default()
    }
}

/// One unit of `variant` at `path`, root package, with `route`.
fn unit(path: &str, variant: &str, route: Option<&str>) -> UnitRow {
    UnitRow {
        package: String::new(),
        variant: variant.into(),
        path: path.into(),
        symbol: "get".into(),
        line: 1,
        assignment: if variant == "P-none" { "none" } else { "known" }.into(),
        route: route.map(str::to_string),
        kind: Some("http".into()),
        ..UnitRow::default()
    }
}

fn report(units: Vec<UnitRow>) -> PracticesReport {
    PracticesReport {
        concerns: vec![ConcernReport {
            id: AUTHN.into(),
            title: "Authentication".into(),
            unit: "entry_point".into(),
            variants: vec![
                variant("P-auth", AUTH, "wrap withAuth", VariantKind::Known),
                variant("P-member", MEMBER, "dependency require_member", VariantKind::Known),
                variant("P-none", "none", "no guard found", VariantKind::None),
            ],
            units,
            ..ConcernReport::default()
        }],
        ..PracticesReport::default()
    }
}

fn dir(package: &str, dir: &str) -> Place {
    Place {
        package: package.into(),
        dir: dir.into(),
        ..Place::default()
    }
}

fn route(prefix: &str) -> Place {
    Place {
        route: Some(prefix.into()),
        ..Place::default()
    }
}

/// 10 project routes that check membership.
fn tenant_units() -> Vec<UnitRow> {
    (0..10)
        .map(|i| {
            let at = format!("/api/workspaces/<str:slug>/projects/:id/t{i}");
            unit(&format!("views/p{i:02}.py"), "P-member", Some(&at))
        })
        .collect()
}

/// Pins: a route place and a directory below its package, or a file of it, overlap
/// (before: never, so two practices of one concern could report one unit twice);
/// places of two packages still do not.
#[test]
fn a_route_place_overlaps_the_directories_and_files_of_its_package() {
    assert!(dir("", "app/api").overlaps(&route("/api")));
    assert!(route("/api").overlaps(&dir("", "app/api")));
    let file = Place::file_of("", "app/api/r00/route.ts").unwrap();
    assert!(file.overlaps(&route("/api")));
    assert!(route("/api").overlaps(&file));
    assert!(!dir("a", "app").overlaps(&Place {
        package: "b".into(),
        ..route("/api")
    }));
    assert!(!dir("", "app/api").overlaps(&dir("", "lib")));
}

/// Pins: a catch-all segment (`[...slug]`, `<path:rest>`) is no one parameter. Such a
/// route under the prefix is counted as not read (before: read as one parameter, it
/// was neither a member nor counted, so it escaped the rule), and `--in` refuses a
/// prefix that holds one.
#[test]
fn a_catch_all_route_is_counted_as_not_read() {
    let mut units = tenant_units();
    units.push(unit("views/c1.py", "P-none", Some("/api/workspaces/[...slug]")));
    units.push(unit("views/c2.py", "P-none", Some("/api/workspaces/<path:rest>")));
    let r = report(units);
    let p = route("/api/workspaces/[*]/projects/[*]");
    let c = candidate(&r, "P-member", Some(&p), &[], false).unwrap();
    assert_eq!(
        (c.follows, c.exceptions.len(), c.unknown, c.unread_routes, c.total),
        (10, 0, 2, 2, 12)
    );
    assert_eq!(Place::parse(".:/api/[...slug]", &r), None);
    assert_eq!(Place::parse(".:/api/{rest:path}", &r), None);
}

fn file(path: &str, route: &str) -> FileFacts {
    FileFacts {
        path: path.into(),
        package: String::new(),
        entry_points: vec![EntryPoint {
            symbol: "get".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some(route.into()),
            adapter: "test".into(),
        }],
        ..FileFacts::default()
    }
}

/// Pins: the PostToolUse hook leaves a departure to a route-place practice's check
/// only for a unit under the prefix whose route Drift read to the end (before: every
/// departure of the concern in any file of the package, so one outside the prefix was
/// told nowhere).
#[test]
fn only_a_member_of_a_route_place_is_left_to_its_check() {
    let r = report(tenant_units());
    let p = route("/api/workspaces/[*]/projects/[*]");
    let c = convention(&candidate(&r, "P-member", Some(&p), &[], false).unwrap());
    let under = file("views/n1.py", "/api/workspaces/<slug>/projects/:id/x");
    let outside = file("views/n2.py", "/api/users/x");
    let unread = file("views/n3.py", "/api/workspaces/?/projects/x");
    assert!(covers_unit(&c, &under, "get"));
    assert!(!covers_unit(&c, &outside, "get"));
    assert!(!covers_unit(&c, &unread, "get"));
    assert!(!covers_unit(&c, &under, "other"));
}
