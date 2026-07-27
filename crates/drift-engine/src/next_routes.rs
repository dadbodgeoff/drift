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

pub const API_ROUTE_SCOPE_GLOBS: [&str; 12] = [
    "**/app/api/**/route.ts",
    "**/app/api/**/route.tsx",
    "**/app/api/**/route.js",
    "**/app/api/**/route.jsx",
    "**/app/**/api/**/route.ts",
    "**/app/**/api/**/route.tsx",
    "**/app/**/api/**/route.js",
    "**/app/**/api/**/route.jsx",
    "**/pages/api/**/*.ts",
    "**/pages/api/**/*.tsx",
    "**/pages/api/**/*.js",
    "**/pages/api/**/*.jsx",
];

pub fn next_api_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let normalized = file_path.replace('\\', "/");
    next_app_route_identity(&normalized).or_else(|| next_pages_api_identity(&normalized))
}

fn next_app_route_identity(file_path: &str) -> Option<NextApiRouteIdentity> {
    let route_suffix = ["/route.ts", "/route.tsx", "/route.js", "/route.jsx"]
        .iter()
        .find(|suffix| file_path.ends_with(**suffix))?;
    let without_route = file_path.strip_suffix(route_suffix)?;
    let segments = without_route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let app_index = segments.iter().position(|segment| *segment == "app")?;
    let route_segments = &segments[app_index + 1..];
    let api_index = route_segments
        .iter()
        .position(|segment| *segment == "api")?;
    let mut dynamic_params = Vec::new();
    let mut route_group_segments = route_segments
        .iter()
        .take(api_index)
        .filter(|segment| is_route_group(segment))
        .map(|segment| (*segment).to_string())
        .collect::<Vec<_>>();
    let mut ignored_segments = Vec::new();
    let mut url_segments = Vec::new();

    for segment in route_segments.iter().skip(api_index) {
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

    if url_segments.first().map(|segment| segment.as_str()) != Some("api") {
        return None;
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
