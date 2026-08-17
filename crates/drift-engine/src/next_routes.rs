#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NextApiRouteIdentity {
    pub framework: String,
    pub file_path: String,
    pub route_path: String,
    pub route_pattern: String,
    pub dynamic_params: Vec<String>,
    pub route_group_segments: Vec<String>,
    pub ignored_segments: Vec<String>,
}

/// D-H2. `**/app/**/route.*` rather than `**/app/api/**/route.*`, because that is what Next.js
/// itself routes: under the App Router, ANY `route.ts` is an HTTP route handler and the folder it
/// sits in only decides its URL. The narrower globs described a naming convention, not a framework
/// rule, and the difference is 27 real handlers across the corpus (dub 3, formbricks 9,
/// openstatus 15) that no role-scoped convention could reach.
///
/// The `app/api` entries are subsumed by `app/**` and are gone rather than kept for symmetry:
/// two globs that must always agree are a place for them to stop agreeing.
pub const API_ROUTE_SCOPE_GLOBS: [&str; 8] = [
    "**/app/**/route.ts",
    "**/app/**/route.tsx",
    "**/app/**/route.js",
    "**/app/**/route.jsx",
    "**/pages/api/**/*.ts",
    "**/pages/api/**/*.tsx",
    "**/pages/api/**/*.js",
    "**/pages/api/**/*.jsx",
];

pub fn next_api_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let normalized = file_path.replace('\\', "/");
    next_app_route_identity(&normalized).or_else(|| next_pages_api_identity(&normalized))
}

/// D-H2. Under the Next.js App Router a file named `route.ts` IS an HTTP route handler; the folders
/// above it decide only its URL. This used to require a literal `api` segment and to return `None`
/// without one, which is a naming convention mistaken for a framework rule.
///
/// What it cost, measured on the corpus: 27 handlers were invisible to every role-scoped convention
/// and to every check - dub 3, formbricks 9, openstatus 15. dub's
/// `apps/web/app/wellknown/[domain]/[file]/route.ts` is the clearest case: it wraps its handler in
/// nothing at all, imports `{ prisma }` from `@/lib/prisma` and calls `prisma.domain.findUnique`
/// directly. That is structurally the exact pattern `api_route_no_direct_data_access` and the
/// auth-helper family exist to catch, and it was not merely unflagged - it was never counted, never
/// in `scope_files_count`, never in evidence. It is also the source of the +-1 between the engine's
/// `withSession`/`withPartnerProfile` counts and an independent grep of the same repo.
///
/// The URL is now built from every segment below `app`, not from `api` onwards. That also corrects
/// the shape openstatus really has: `app/(landing)/play/checker/api/route.ts` served
/// `/api` before and serves `/play/checker/api` now, which is the URL Next.js actually mounts.
fn next_app_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let route_suffix = ["/route.ts", "/route.tsx", "/route.js", "/route.jsx"]
        .iter()
        .find(|suffix| file_path.ends_with(**suffix))?;
    let without_route = file_path.strip_suffix(route_suffix)?;
    let segments = without_route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    // An `app` ancestor is still required, and is the whole of what distinguishes a Next route
    // handler from any other file called `route.ts`: `server/api/users/route.ts` is an Express
    // module and stays out.
    let app_index = segments.iter().position(|segment| *segment == "app")?;
    let route_segments = &segments[app_index + 1..];
    let mut dynamic_params = Vec::new();
    let mut route_group_segments = Vec::new();
    let mut ignored_segments = Vec::new();
    let mut url_segments = Vec::new();

    for segment in route_segments {
        if is_route_group(segment) {
            route_group_segments.push((*segment).to_string());
            continue;
        }
        if segment.starts_with('@') || segment.starts_with('_') {
            ignored_segments.push((*segment).to_string());
            continue;
        }
        url_segments.push(normalize_route_segment(segment, &mut dynamic_params));
    }

    let route_path = format!("/{}", url_segments.join("/"));
    Some(NextApiRouteIdentity {
        framework: "next_app_route".to_string(),
        file_path: file_path.to_string(),
        route_pattern: route_path.clone(),
        route_path,
        dynamic_params,
        route_group_segments,
        ignored_segments,
    })
}

fn next_pages_api_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let marker = "pages/api/";
    let index = file_path.find(marker)?;
    let route = &file_path[index + "pages/".len()..];
    let route = route
        .strip_suffix(".ts")
        .or_else(|| route.strip_suffix(".tsx"))
        .or_else(|| route.strip_suffix(".js"))
        .or_else(|| route.strip_suffix(".jsx"))?;
    let mut dynamic_params = Vec::new();
    let url_segments = route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| normalize_route_segment(segment, &mut dynamic_params))
        .collect::<Vec<_>>();
    let route_path = format!("/{}", url_segments.join("/"));
    Some(NextApiRouteIdentity {
        framework: "next_pages_api".to_string(),
        file_path: file_path.to_string(),
        route_pattern: route_path.clone(),
        route_path,
        dynamic_params,
        route_group_segments: Vec::new(),
        ignored_segments: Vec::new(),
    })
}

fn is_route_group(segment: &str) -> bool {
    segment.starts_with('(')
        && segment.ends_with(')')
        && !segment.starts_with("(.)")
        && !segment.starts_with("(..)")
        && !segment.starts_with("(...)")
}

fn normalize_route_segment(segment: &str, dynamic_params: &mut Vec<String>) -> String {
    if let Some(param) = segment
        .strip_prefix("[[...")
        .and_then(|value| value.strip_suffix("]]"))
    {
        dynamic_params.push(param.to_string());
        format!(":{param}*")
    } else if let Some(param) = segment
        .strip_prefix("[...")
        .and_then(|value| value.strip_suffix(']'))
    {
        dynamic_params.push(param.to_string());
        format!(":{param}*")
    } else if let Some(param) = segment
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    {
        dynamic_params.push(param.to_string());
        format!(":{param}")
    } else {
        segment.to_string()
    }
}
