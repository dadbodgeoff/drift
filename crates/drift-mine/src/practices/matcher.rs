//! Middleware route matchers joined to routes, three-valued (PLAN-R13 §6.2 slice 1, lead
//! decision 6): a matcher pattern `covers` a route, `excludes` it, or is
//! `indeterminate` for it. Only a small, sound subset of the Next.js / path-to-regexp
//! pattern language is read: literal text, `:name` (one segment), `:name?`, `:name*` /
//! `:name+`, `(.*)` and `.*`, a group of literal alternatives `(api|trpc)`, and a
//! negative lookahead of literal alternatives `((?!_next|static).*)`. Anything else
//! (character classes, quantifiers, escapes other than `\.`) is indeterminate, and so is
//! a literal that meets a dynamic route segment (`[id]`). Indeterminate is unknown,
//! never covered and never excluded [STRICT].

use drift_core::RouteMatcher;

/// How a matcher stands to a route. Ordered so that `max` is "some branch covers".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tri {
    Excludes,
    Indeterminate,
    Covers,
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Lit(char),
    /// One segment, not empty.
    Seg,
    /// One segment or nothing.
    SegOpt,
    /// Anything, `/` included, possibly empty.
    Rest,
    /// Anything, `/` included, not empty.
    RestPlus,
    /// One of these literals.
    Alt(Vec<String>),
    /// Not followed by any of these literals.
    NotAhead(Vec<String>),
}

/// One item of a route: a character, or a dynamic segment.
#[derive(Debug, Clone, Copy, PartialEq)]
enum R {
    C(char),
    /// `[id]`, `:id`, `{id}`, `<id>`, `[*]`: one segment, unknown text.
    Dyn,
    /// `[...slug]`, `[[...slug]]`: any number of segments, unknown text.
    DynRest,
}

fn literal_alts(s: &str) -> Option<Vec<String>> {
    let alts: Vec<String> = s.split('|').map(|a| a.replace("\\.", ".")).collect();
    alts.iter()
        .all(|a| {
            !a.is_empty()
                && a.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "/-_.".contains(c))
        })
        .then_some(alts)
}

/// The index of the `)` closing the `(` at `open`, at the same depth.
fn closing(cs: &[char], open: usize) -> Option<usize> {
    let mut depth = 0;
    for (i, &c) in cs.iter().enumerate().skip(open) {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn tokens(pattern: &str) -> Option<Vec<Tok>> {
    let cs: Vec<char> = pattern.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        match cs[i] {
            ':' => {
                let start = i + 1;
                let mut j = start;
                while j < cs.len() && (cs[j].is_ascii_alphanumeric() || cs[j] == '_') {
                    j += 1;
                }
                if j == start {
                    return None;
                }
                match cs.get(j) {
                    Some('*') => {
                        out.push(Tok::Rest);
                        j += 1;
                    }
                    Some('+') => {
                        out.push(Tok::RestPlus);
                        j += 1;
                    }
                    Some('?') => {
                        out.push(Tok::SegOpt);
                        j += 1;
                    }
                    // `:path(.*)`: the group says what the parameter matches.
                    Some('(') => {}
                    _ => out.push(Tok::Seg),
                }
                i = j;
            }
            '(' => {
                let end = closing(&cs, i)?;
                let inner: String = cs[i + 1..end].iter().collect();
                if inner == ".*" {
                    out.push(Tok::Rest);
                } else if let Some(rest) = inner.strip_prefix("(?!") {
                    let close = rest.find(')')?;
                    if &rest[close + 1..] != ".*" {
                        return None;
                    }
                    out.push(Tok::NotAhead(literal_alts(&rest[..close])?));
                    out.push(Tok::Rest);
                } else {
                    out.push(Tok::Alt(literal_alts(&inner)?));
                }
                i = end + 1;
                // `(...)?` and friends: an optional group is not read.
                if matches!(cs.get(i), Some('?' | '*' | '+' | '{')) {
                    return None;
                }
            }
            '.' if cs.get(i + 1) == Some(&'*') => {
                out.push(Tok::Rest);
                i += 2;
            }
            '*' => {
                out.push(Tok::Rest);
                i += 1;
            }
            '\\' if cs.get(i + 1) == Some(&'.') => {
                out.push(Tok::Lit('.'));
                i += 2;
            }
            c if c.is_ascii_alphanumeric() || "/-_.~".contains(c) => {
                out.push(Tok::Lit(c));
                i += 1;
            }
            _ => return None,
        }
    }
    Some(out)
}

fn route_items(route: &str) -> Vec<R> {
    let mut out = Vec::new();
    for (k, seg) in route.split('/').enumerate() {
        if k > 0 {
            out.push(R::C('/'));
        }
        let dynamic = |open: char, close: char| seg.starts_with(open) && seg.ends_with(close);
        if seg.starts_with("[...") || seg.starts_with("[[...") {
            out.push(R::DynRest);
        } else if dynamic('[', ']')
            || dynamic('{', '}')
            || dynamic('<', '>')
            || seg.starts_with(':')
        {
            out.push(R::Dyn);
        } else {
            out.extend(seg.chars().map(R::C));
        }
    }
    out
}

/// Does `route[j..]` start with `lit`: covers (yes), excludes (no) or indeterminate
/// (a dynamic segment is in the way). With the length consumed when it covers.
fn starts_with(route: &[R], j: usize, lit: &str) -> (Tri, usize) {
    let mut k = j;
    for c in lit.chars() {
        match route.get(k) {
            Some(R::C(r)) if *r == c => k += 1,
            Some(R::C(_)) | None => return (Tri::Excludes, 0),
            Some(R::Dyn | R::DynRest) => return (Tri::Indeterminate, 0),
        }
    }
    (Tri::Covers, k - j)
}

/// Steps allowed for one match, so a pathological pattern cannot run away: past it the
/// answer is indeterminate.
const BUDGET: usize = 20_000;

fn go(toks: &[Tok], route: &[R], i: usize, j: usize, budget: &mut usize) -> Tri {
    if *budget == 0 {
        return Tri::Indeterminate;
    }
    *budget -= 1;
    let Some(t) = toks.get(i) else {
        // The whole route must be matched; a trailing `/` is the same route.
        return match &route[j..] {
            [] | [R::C('/')] => Tri::Covers,
            r if r.iter().all(|x| *x == R::DynRest) => Tri::Indeterminate,
            _ => Tri::Excludes,
        };
    };
    let mut best = Tri::Excludes;
    let try_at = |k: usize, best: &mut Tri, budget: &mut usize| {
        *best = (*best).max(go(toks, route, i + 1, k, budget));
        *best == Tri::Covers
    };
    match t {
        Tok::Lit(c) => match route.get(j) {
            Some(R::C(r)) if r == c => return go(toks, route, i + 1, j + 1, budget),
            Some(R::C(_)) | None => return Tri::Excludes,
            Some(R::Dyn) => {
                // The dynamic segment may or may not be this text: it takes the
                // pattern's literals up to the next `/`, and the answer is at best unknown.
                let mut k = i;
                while matches!(toks.get(k), Some(Tok::Lit(c)) if *c != '/') {
                    k += 1;
                }
                return go(toks, route, k, j + 1, budget).min(Tri::Indeterminate);
            }
            Some(R::DynRest) => {
                let mut k = i;
                while matches!(toks.get(k), Some(Tok::Lit(_))) {
                    k += 1;
                }
                return go(toks, route, k, j + 1, budget).min(Tri::Indeterminate);
            }
        },
        Tok::Seg | Tok::SegOpt => {
            if matches!(t, Tok::SegOpt) && try_at(j, &mut best, budget) {
                return best;
            }
            let mut k = j;
            while let Some(r) = route.get(k) {
                if *r == R::C('/') {
                    break;
                }
                k += 1;
                let sure = !route[j..k].contains(&R::DynRest);
                let got = go(toks, route, i + 1, k, budget);
                best = best.max(if sure {
                    got
                } else {
                    got.min(Tri::Indeterminate)
                });
                if best == Tri::Covers {
                    return best;
                }
            }
        }
        Tok::Rest | Tok::RestPlus => {
            let from = if matches!(t, Tok::RestPlus) { j + 1 } else { j };
            for k in from..=route.len() {
                if try_at(k, &mut best, budget) {
                    return best;
                }
            }
        }
        Tok::Alt(alts) => {
            for a in alts {
                match starts_with(route, j, a) {
                    (Tri::Covers, n) => {
                        if try_at(j + n, &mut best, budget) {
                            return best;
                        }
                    }
                    (Tri::Indeterminate, _) => best = best.max(Tri::Indeterminate),
                    (Tri::Excludes, _) => {}
                }
            }
        }
        Tok::NotAhead(alts) => {
            let mut cap = Tri::Covers;
            for a in alts {
                match starts_with(route, j, a).0 {
                    Tri::Covers => return Tri::Excludes,
                    Tri::Indeterminate => cap = Tri::Indeterminate,
                    Tri::Excludes => {}
                }
            }
            return go(toks, route, i + 1, j, budget).min(cap);
        }
    }
    best
}

/// How one matcher pattern stands to one route.
pub fn pattern(pattern: &str, route: &str) -> Tri {
    let Some(toks) = tokens(pattern) else {
        return Tri::Indeterminate;
    };
    let mut budget = BUDGET;
    go(&toks, &route_items(route), 0, 0, &mut budget)
}

/// How a list of patterns stands to a route: covered by any, excluded by all. An empty
/// list (a matcher that could not be read) is indeterminate.
pub fn patterns(ps: &[String], route: &str) -> Tri {
    if ps.is_empty() {
        return Tri::Indeterminate;
    }
    ps.iter()
        .map(|p| pattern(p, route))
        .max()
        .unwrap_or(Tri::Indeterminate)
}

/// What a binding's name says its list is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ListKind {
    /// Routes let through (`isPublicRoute`).
    Public,
    /// The only routes it protects (`isProtectedRoute`).
    Protected,
    /// A list whose meaning the name does not say.
    Other,
}

fn list_kind(binding: &str) -> ListKind {
    let b = binding.to_ascii_lowercase();
    if b.contains("public") || b.contains("unprotected") || b.contains("ignored") {
        ListKind::Public
    } else if b.contains("protect") || b.contains("private") || b.contains("auth") {
        ListKind::Protected
    } else {
        ListKind::Other
    }
}

/// Whether a middleware file's checks reach `route`: `config.matcher` decides whether
/// it runs (absent: on every route; no patterns: indeterminate); a public list it
/// covers lets the route through; protected lists, when there are any, must cover it;
/// any other list it may cover makes the answer indeterminate. `None` route (not a
/// literal) is indeterminate.
pub fn coverage(matchers: &[RouteMatcher], route: Option<&str>) -> Tri {
    let Some(route) = route else {
        return Tri::Indeterminate;
    };
    let mut out = match matchers.iter().find(|m| m.binding == "config.matcher") {
        None => Tri::Covers,
        Some(m) => patterns(&m.patterns, route),
    };
    if out == Tri::Excludes {
        return Tri::Excludes;
    }
    let mut protected: Option<Tri> = None;
    for m in matchers.iter().filter(|m| m.binding != "config.matcher") {
        let t = patterns(&m.patterns, route);
        match list_kind(&m.binding) {
            ListKind::Public => match t {
                Tri::Covers => return Tri::Excludes,
                Tri::Indeterminate => out = out.min(Tri::Indeterminate),
                Tri::Excludes => {}
            },
            ListKind::Protected => protected = Some(protected.unwrap_or(Tri::Excludes).max(t)),
            ListKind::Other => {
                if t != Tri::Excludes {
                    out = out.min(Tri::Indeterminate);
                }
            }
        }
    }
    match protected {
        Some(Tri::Excludes) => Tri::Excludes,
        Some(t) => out.min(t),
        None => out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patterns_are_three_valued() {
        assert_eq!(
            pattern("/api/(.*)", "/api/projects/[projectId]"),
            Tri::Covers
        );
        assert_eq!(pattern("/api/(.*)", "/dashboard"), Tri::Excludes);
        assert_eq!(pattern("/(api|trpc)(.*)", "/trpc/x"), Tri::Covers);
        assert_eq!(pattern("/(api|trpc)(.*)", "/app/x"), Tri::Excludes);
        assert_eq!(
            pattern("/api/webhooks(.*)", "/api/webhooks/stripe"),
            Tri::Covers
        );
        assert_eq!(pattern("/api/webhooks(.*)", "/api/projects"), Tri::Excludes);
        assert_eq!(pattern("/users/:id", "/users/[id]"), Tri::Covers);
        assert_eq!(pattern("/users/:id", "/users/[id]/posts"), Tri::Excludes);
        assert_eq!(pattern("/:path*", "/anything/at/all"), Tri::Covers);
        // A literal against a dynamic segment: it may or may not be that text.
        assert_eq!(pattern("/org/settings", "/org/[slug]"), Tri::Indeterminate);
        // The negative lookahead form Next.js docs use.
        let p = "/((?!_next/static|_next/image|favicon.ico).*)";
        assert_eq!(pattern(p, "/api/x"), Tri::Covers);
        assert_eq!(pattern(p, "/_next/static/a.js"), Tri::Excludes);
        // Clerk's default, with a character class: not read.
        let clerk = "/((?!_next|[^?]*\\\\.(?:html?|css)).*)";
        assert_eq!(pattern(clerk, "/api/x"), Tri::Indeterminate);
        assert_eq!(pattern("/api/[a-z]+", "/api/x"), Tri::Indeterminate);
    }

    fn m(binding: &str, ps: &[&str]) -> RouteMatcher {
        RouteMatcher {
            binding: binding.into(),
            patterns: ps.iter().map(|p| p.to_string()).collect(),
            opaque: false,
            polarity: drift_core::MatcherPolarity::default(),
        }
    }

    #[test]
    fn coverage_joins_the_matchers() {
        let ms = [
            m("config.matcher", &["/api/(.*)", "/trpc/(.*)"]),
            m("isPublicRoute", &["/api/webhooks(.*)", "/sign-in(.*)"]),
        ];
        assert_eq!(coverage(&ms, Some("/api/projects/[id]")), Tri::Covers);
        assert_eq!(coverage(&ms, Some("/api/webhooks/stripe")), Tri::Excludes);
        assert_eq!(coverage(&ms, Some("/settings")), Tri::Excludes);
        assert_eq!(coverage(&ms, None), Tri::Indeterminate);
        // No config.matcher: it runs on every route.
        assert_eq!(coverage(&[], Some("/x")), Tri::Covers);
        // [STRICT] A matcher that could not be read: indeterminate.
        assert_eq!(
            coverage(&[m("config.matcher", &[])], Some("/x")),
            Tri::Indeterminate
        );
        assert_eq!(
            coverage(&[m("isPublicRoute", &[])], Some("/x")),
            Tri::Indeterminate
        );
        // Protected lists must cover the route.
        let p = [m("isProtectedRoute", &["/dashboard(.*)"])];
        assert_eq!(coverage(&p, Some("/dashboard/a")), Tri::Covers);
        assert_eq!(coverage(&p, Some("/api/a")), Tri::Excludes);
        // A list the name says nothing about: indeterminate where it may match.
        let o = [m("matchers", &["/api(.*)"])];
        assert_eq!(coverage(&o, Some("/api/a")), Tri::Indeterminate);
        assert_eq!(coverage(&o, Some("/web")), Tri::Covers);
    }
}
