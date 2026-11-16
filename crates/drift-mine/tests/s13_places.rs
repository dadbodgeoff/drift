//! Stream S13: places other than directories. A promoted practice may hold in one file
//! ("every route in this router signs in this way") or under a literal route prefix
//! ("every route under `workspaces/<slug>/projects/<id>/` checks project membership"),
//! with the same thresholds as a directory. A directory place keeps its id and its
//! YAML.

use std::collections::BTreeSet;

use drift_mine::check::Scope;
use drift_mine::mine::Rule;
use drift_mine::policy::{ConventionsFile, Lock};
use drift_mine::practices::promote::{
    self, Candidate, Place, Refusal, Request, candidate, candidate_for, candidates, convention,
    convention_id, place_of,
};
use drift_mine::practices::{
    AUTHN, ConcernReport, PracticesReport, UnitRow, Variant, VariantKind,
};
use drift_mine::roles::FileKinds;

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

fn variants() -> Vec<Variant> {
    vec![
        variant("P-auth", AUTH, "wrap withAuth", VariantKind::Known),
        variant("P-member", MEMBER, "dependency require_member", VariantKind::Known),
        variant("P-none", "none", "no guard found", VariantKind::None),
    ]
}

/// One unit of `variant` ("" unknown) at `path`, root package, with `route`.
fn unit(path: &str, variant: &str, route: Option<&str>) -> UnitRow {
    UnitRow {
        package: String::new(),
        variant: variant.into(),
        path: path.into(),
        symbol: "get".into(),
        line: 1,
        assignment: match variant {
            "" => "unknown",
            "P-none" => "none",
            _ => "known",
        }
        .into(),
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
            variants: variants(),
            units,
            ..ConcernReport::default()
        }],
        ..PracticesReport::default()
    }
}

fn policy(c: drift_mine::policy::Convention) -> ConventionsFile {
    let mut p = ConventionsFile::merge(None, "e", FileKinds::default(), &[]);
    p.conventions.push(c);
    p
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

fn first_way(c: &Candidate) -> &str {
    c.ways.first().map_or("", |w| w.id.as_str())
}

/// Pins the restatement rule for one file: before this stream no file was ever a
/// place; now a router of 9 routes that all check membership, in a package that signs
/// in with `withAuth`, is offered, and the files of the `withAuth` routes are not (their
/// rule is the package's).
#[test]
fn a_file_is_offered_only_when_it_adds_something_over_its_directory() {
    let mut units: Vec<UnitRow> = (0..70)
        .map(|i| unit(&format!("app/r{i:02}/route.ts"), "P-auth", None))
        .collect();
    // A router of 9 routes, one way, apart from the package's.
    units.extend((0..9).map(|i| UnitRow {
        symbol: format!("h{i}"),
        ..unit("app/items.py", "P-member", None)
    }));
    // A router of 10 routes that do what the package does: a restatement.
    units.extend((0..10).map(|i| UnitRow {
        symbol: format!("h{i}"),
        ..unit("app/same.ts", "P-auth", None)
    }));
    // A router of 5: below the 8-unit gate whatever it does.
    units.extend((0..5).map(|i| UnitRow {
        symbol: format!("h{i}"),
        ..unit("app/small.py", "P-member", None)
    }));
    let r = report(units);
    let files: Vec<(String, String)> = candidates(&r)
        .iter()
        .filter(|c| c.place.file.is_some())
        .map(|c| (first_way(c).to_string(), c.place.shown()))
        .collect();
    assert_eq!(files, [("P-member".to_string(), "app/items.py".to_string())]);
    // `--in` with the file's path names the file.
    let p = Place::parse("app/items.py", &r).unwrap();
    assert_eq!(p.file.as_deref(), Some("app/items.py"));
    assert_eq!(p.dir, "app");
    let c = candidate(&r, "P-member", Some(&p), &[], false).unwrap();
    assert_eq!((c.follows, c.exceptions.len(), c.total), (9, 0, 9));
    // The small router is refused by the gate, never offered.
    let small = Place::parse("app/small.py", &r).unwrap();
    assert!(matches!(
        candidate(&r, "P-member", Some(&small), &[], false),
        Err(Refusal::TooSmall { units: 5, min: 8, .. })
    ));
    // A file place holds that file only.
    assert!(p.holds("", "app/items.py"));
    assert!(!p.holds("", "app/other.py"));
}

/// Project routes, half written `<uuid:project_id>`, half `:projectId`; user routes
/// signed in another way.
fn tenant_units() -> Vec<UnitRow> {
    let mut units: Vec<UnitRow> = (0..10)
        .map(|i| {
            let id = if i % 2 == 0 { "<uuid:project_id>" } else { ":projectId" };
            let at = format!("/api/workspaces/<str:slug>/projects/{id}/t{i}");
            unit(&format!("views/p{i:02}.py"), "P-member", Some(&at))
        })
        .collect();
    units.extend((0..10).map(|i| {
        let at = format!("/api/users/u{i}");
        unit(&format!("views/u{i:02}.py"), "P-auth", Some(&at))
    }));
    units
}

/// Pins route prefixes: compared by segment, a parameter matching a parameter however
/// it is spelled, a literal never matching a parameter; one rule offered once, at the
/// longest prefix that holds the same units.
#[test]
fn a_route_prefix_matches_by_segments_with_parameters() {
    let r = report(tenant_units());
    let routes: Vec<(String, String)> = candidates(&r)
        .iter()
        .filter(|c| c.place.route.is_some() && !c.ways.is_empty())
        .map(|c| (first_way(c).to_string(), c.place.shown()))
        .collect();
    assert_eq!(
        routes,
        [
            ("P-auth".to_string(), ".:/api/users".to_string()),
            ("P-member".to_string(), ".:/api/workspaces/[*]/projects/[*]".to_string()),
        ]
    );
    // The place as `--in` reads it back, whatever the parameter's spelling.
    let p = Place::parse(".:/api/workspaces/<slug>/projects/{id}", &r).unwrap();
    assert_eq!(p, route("/api/workspaces/[*]/projects/[*]"));
    assert_eq!(p.command_arg(), "'.:/api/workspaces/[*]/projects/[*]'");
    let c = candidate(&r, "P-member", Some(&p), &[], false).unwrap();
    assert_eq!((c.follows, c.total), (10, 10));
    // A literal segment is not a parameter: `/api/workspaces/me/...` is outside.
    let mut units = tenant_units();
    units.push(unit(
        "views/me.py",
        "P-none",
        Some("/api/workspaces/me/projects/x"),
    ));
    let c = candidate(&report(units.clone()), "P-member", Some(&p), &[], false).unwrap();
    assert_eq!((c.follows, c.exceptions.len(), c.total), (10, 0, 10));
    // Never by string prefix: `/api/userspace` is not under `/api/users`.
    units.push(unit("views/space.py", "P-none", Some("/api/userspace/x")));
    let users = Place::parse(".:/api/users", &r).unwrap();
    let c = candidate(&report(units), "P-auth", Some(&users), &[], false).unwrap();
    assert_eq!((c.follows, c.exceptions.len()), (10, 0));
    // A prefix that is not a literal is no place.
    assert_eq!(Place::parse(".:/api/?/x", &r), None);
    assert_eq!(Place::parse(".:/", &r), None);
    assert_eq!(Place::parse("nope:/api", &r), None);
}

/// Pins unread routes: a unit whose route Drift did not read as a literal to the end
/// is never a member of a route place, and is counted as not read wherever it could be
/// under the prefix; one whose read part leaves the prefix is not counted.
#[test]
fn a_unit_with_an_unread_route_is_not_a_member_and_is_counted_as_not_read() {
    let p = route("/api/workspaces/[*]/projects/[*]");
    let mut units = tenant_units();
    // Partly read under the prefix, and known to follow: still not a member.
    units.push(unit(
        "views/x1.py",
        "P-member",
        Some("/api/workspaces/<slug>/projects/?/t"),
    ));
    // No route read at all.
    units.push(unit("views/x2.py", "P-none", None));
    // Read up to a segment that leaves the prefix: ruled out, not counted.
    units.push(unit("views/x3.py", "P-none", Some("/api/users/?/t")));
    let r = report(units.clone());
    let c = candidate(&r, "P-member", Some(&p), &[], false).unwrap();
    assert_eq!(
        (c.follows, c.exceptions.len(), c.unknown, c.unread_routes, c.total),
        (10, 0, 2, 2, 12)
    );
    assert!(
        promote::preview(&c, &convention(&c)).contains("2 have a route Drift did not read"),
        "{}",
        promote::preview(&c, &convention(&c))
    );
    // A third makes the place more than 20% unknown: refused, as any place is.
    units.push(unit("views/x4.py", "P-none", Some("/?/jobs")));
    assert!(matches!(
        candidate(&report(units), "P-member", Some(&p), &[], false),
        Err(Refusal::TooUnknown {
            unknown: 3,
            total: 13,
            ..
        })
    ));
}

/// Pins that a directory place is written exactly as before this stream: its id is
/// the hash it always was, and its rule and role carry nothing new.
#[test]
fn a_directory_place_keeps_its_id_and_its_yaml() {
    let units: Vec<UnitRow> = (0..10)
        .map(|i| unit(&format!("app/api/r{i:02}/route.ts"), "P-auth", None))
        .collect();
    let r = report(units);
    let c = candidate(&r, "P-auth", Some(&dir("", "app/api")), &[], false).unwrap();
    let conv = convention(&c);
    let old = blake3::hash(b"practice\0\0app/api\0authn");
    assert_eq!(conv.id, format!("D-{}", &old.to_hex()[..6]));
    assert_eq!(conv.id, convention_id(&dir("", "app/api"), AUTHN));
    assert_eq!(
        serde_saphyr::to_string(&conv.rule).unwrap(),
        "type: practice\nconcern: authn\nany_of:\n- wrap:lib/auth.ts#withAuth\n"
    );
    assert_eq!(
        serde_json::to_string(&conv.rule).unwrap(),
        r#"{"type":"practice","concern":"authn","any_of":["wrap:lib/auth.ts#withAuth"]}"#
    );
    assert_eq!(
        serde_json::to_string(&conv.role).unwrap(),
        r#"{"package":"","dir":"app/api","file":"(practice)","entry":"-","kind":"module"}"#
    );
    assert_eq!(serde_json::to_string(&c.place).unwrap(), r#"{"package":"","dir":"app/api"}"#);
    assert_eq!(place_of(&conv), Some(dir("", "app/api")));
    // A file and a route place are told apart from it, and read back.
    let file = Place::file_of("", "app/api/r00/route.ts").unwrap();
    for p in [file, route("/api")] {
        assert_ne!(convention_id(&p, AUTHN), conv.id);
        let mut other = c.clone();
        other.place = p.clone();
        assert_eq!(place_of(&convention(&other)), Some(p));
    }
}

/// Pins the check of a route-prefix practice: a new route under the prefix that
/// departs is reported; one outside it, and one whose route Drift could not read, are
/// not (the last is counted as not checked).
#[test]
fn a_route_prefix_practice_reports_a_new_route_under_it_and_not_outside() {
    let r = report(tenant_units());
    let req = Request {
        ways: vec!["P-member".into()],
        ..Request::default()
    };
    let p = route("/api/workspaces/[*]/projects/[*]");
    let c = candidate_for(&r, Some(&p), &req).unwrap();
    let conv = convention(&c);
    assert!(matches!(
        &conv.rule,
        Rule::Practice { under_route: Some(u), in_file: None, .. } if u == "/api/workspaces/[*]/projects/[*]"
    ));
    assert!(
        conv.summary
            .starts_with("Sign-in in the routes under /api/workspaces/[*]/projects/[*]: "),
        "{}",
        conv.summary
    );
    assert!(serde_saphyr::to_string(&conv).unwrap().contains("under_route:"));
    let mut units = tenant_units();
    units.push(unit(
        "views/new_under.py",
        "P-none",
        Some("/api/workspaces/<slug>/projects/<id>/new"),
    ));
    units.push(unit("views/new_outside.py", "P-none", Some("/api/health")));
    units.push(unit("views/new_unread.py", "P-none", Some("/api/workspaces/?/x")));
    let now = promote::check(
        &drift_core::RepoFacts::default(),
        &report(units),
        &policy(conv.clone()),
        &Lock::default(),
        Scope::Accepted,
        None,
    );
    let reported: BTreeSet<&str> = now.violations.iter().map(|v| v.path.as_str()).collect();
    assert_eq!(reported, BTreeSet::from(["views/new_under.py"]));
    assert_eq!(now.not_checked.len(), 1);
    assert_eq!(now.not_checked[0].units, 1);
    assert!(now.stale.is_empty());
    // What the hooks read: any file of the package that may serve such a route.
    assert_eq!(
        promote::condition(&conv).as_deref(),
        Some("for its entry points that take a request and are served under /api/workspaces/[*]/projects/[*]")
    );
    let file = drift_core::FileFacts {
        path: "anywhere/router.py".into(),
        entry_points: vec![drift_core::EntryPoint {
            symbol: "get".into(),
            kind: "http".into(),
            method: Some("GET".into()),
            route: Some("/relative".into()),
            adapter: String::new(),
        }],
        ..drift_core::FileFacts::default()
    };
    assert!(promote::covers_file(&conv, &file));
    let other_package = drift_core::FileFacts {
        package: "web".into(),
        path: "web/router.py".into(),
        ..file.clone()
    };
    assert!(!promote::covers_file(&conv, &other_package));
}
