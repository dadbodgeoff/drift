//! A route place can name the tRPC procedures under a path of router keys
//! (`--in '.:/user.'`): a procedure is in it when its dotted path starts with those
//! keys, by key, never by string prefix; one whose path Drift could not read to the end
//! (`?.ping`, a router nothing mounts) is counted as not read there; and HTTP routes
//! and procedures are never in each other's places.

use drift_mine::practices::promote::{Place, candidate, canonical_route};
use drift_mine::practices::{AUTHN, ConcernReport, PracticesReport, UnitRow, Variant, VariantKind};

fn variant(id: &str, key: &str, label: &str, kind: VariantKind) -> Variant {
    Variant {
        id: id.into(),
        key: key.into(),
        label: label.into(),
        kind,
        ..Variant::default()
    }
}

/// One unit of `variant` of `kind`, root package, served at `route`.
fn unit(path: &str, symbol: &str, variant: &str, kind: &str, route: &str) -> UnitRow {
    UnitRow {
        package: String::new(),
        variant: variant.into(),
        path: path.into(),
        symbol: symbol.into(),
        line: 1,
        assignment: match variant {
            "" => "unknown",
            "P-none" => "none",
            _ => "known",
        }
        .into(),
        route: Some(route.into()),
        kind: Some(kind.into()),
        ..UnitRow::default()
    }
}

/// Ten procedures under `user.` signed in by `authed`, ten under `usersettings.` with
/// no guard, ten HTTP routes under `/user` with no guard, and one procedure of a
/// router nothing mounts (`?.ping`).
fn report() -> PracticesReport {
    let mut units: Vec<UnitRow> = (0..10)
        .map(|i| {
            unit(
                "src/routers/user.ts",
                &format!("QUERY q{i}"),
                "P-auth",
                "rpc",
                &format!("user.q{i}"),
            )
        })
        .collect();
    units.extend((0..10).map(|i| {
        unit(
            "src/routers/settings.ts",
            &format!("QUERY s{i}"),
            "P-none",
            "rpc",
            &format!("usersettings.s{i}"),
        )
    }));
    units.extend((0..10).map(|i| {
        unit(
            "src/http.ts",
            &format!("GET /user/h{i}"),
            "P-none",
            "http",
            &format!("/user/h{i}"),
        )
    }));
    units.push(unit(
        "src/routers/orphan.ts",
        "QUERY ping",
        "",
        "rpc",
        "?.ping",
    ));
    PracticesReport {
        concerns: vec![ConcernReport {
            id: AUTHN.into(),
            title: "Authentication".into(),
            unit: "entry_point".into(),
            variants: vec![
                variant(
                    "P-auth",
                    "wrap:src/trpc.ts#authed",
                    "wrap authed",
                    VariantKind::Known,
                ),
                variant("P-none", "none", "no guard found", VariantKind::None),
            ],
            units,
            ..ConcernReport::default()
        }],
        ..PracticesReport::default()
    }
}

#[test]
fn a_procedure_prefix_holds_the_procedures_under_its_keys() {
    let r = report();
    let place = Place::parse(".:/user.", &r).expect("a procedure prefix is a place");
    assert_eq!(place.route.as_deref(), Some("user."));
    // Shown as `--in` reads it back.
    assert_eq!(place.shown(), ".:/user.");
    assert_eq!(Place::parse(&place.shown(), &r), Some(place.clone()));
    let c = candidate(&r, "P-auth", Some(&place), &[], false).unwrap();
    // By key: `usersettings.*` is not under `user.`, nor is the HTTP `/user/*`; the
    // procedure whose path was not read could be.
    assert_eq!((c.follows, c.exceptions.len(), c.total), (10, 0, 11));
    assert_eq!(c.unread_routes, 1);
    // The HTTP prefix holds the HTTP routes only: none of them is signed in.
    let http = Place::parse(".:/user", &r).unwrap();
    assert_eq!(http.route.as_deref(), Some("/user"));
    assert!(candidate(&r, "P-auth", Some(&http), &[], false).map_or(true, |c| c.follows == 0));
}

#[test]
fn a_procedure_prefix_is_read_in_its_canonical_form() {
    assert_eq!(canonical_route("user.").as_deref(), Some("user."));
    assert_eq!(
        canonical_route("/viewer.me.").as_deref(),
        Some("viewer.me.")
    );
    // A key that is not read is no literal prefix.
    assert_eq!(canonical_route("?.user."), None);
    assert_eq!(canonical_route("."), None);
    // HTTP prefixes read as before.
    assert_eq!(canonical_route("/api/v2/").as_deref(), Some("/api/v2"));
}
