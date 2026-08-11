use std::fs;

use drift_engine::next_routes::next_api_route_identity;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RouteCase {
    name: String,
    file_path: String,
    is_api_route: bool,
    framework: Option<String>,
    route_path: Option<String>,
    dynamic_params: Option<Vec<String>>,
    route_group_segments: Option<Vec<String>>,
    ignored_segments: Option<Vec<String>>,
}

#[test]
fn next_route_identity_matches_shared_fixture() {
    let fixture = fs::read_to_string("../../test/fixtures/next-route-groups/route-cases.json")
        .expect("read route fixture");
    let cases: Vec<RouteCase> = serde_json::from_str(&fixture).expect("parse route fixture");

    for case in cases {
        let identity = next_api_route_identity(&case.file_path);
        assert_eq!(identity.is_some(), case.is_api_route, "{}", case.name);
        if let Some(identity) = identity {
            assert_eq!(identity.framework, case.framework.unwrap(), "{}", case.name);
            assert_eq!(
                identity.route_path,
                case.route_path.unwrap(),
                "{}",
                case.name
            );
            assert_eq!(
                identity.dynamic_params,
                case.dynamic_params.unwrap(),
                "{}",
                case.name
            );
            assert_eq!(
                identity.route_group_segments,
                case.route_group_segments.unwrap(),
                "{}",
                case.name
            );
            assert_eq!(
                identity.ignored_segments,
                case.ignored_segments.unwrap(),
                "{}",
                case.name
            );
        }
    }
}
