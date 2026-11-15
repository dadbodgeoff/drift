//! Human views list the default tier in full, then the best suggestions, capped (round 8,
//! W4: `drift_mine::rank`). The cap is presentation only: `census --json` keeps every
//! proposal, and ids, tiers and `drift check` do not change with it.

use std::path::Path;
use std::process::Command;

use serde_json::Value;

/// The CLI under test: `DRIFT_TEST_BIN` when set (a private copy, so another build sharing
/// this target directory cannot swap the binary mid-run), else Cargo's own.
static BIN: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    std::env::var("DRIFT_TEST_BIN").unwrap_or_else(|_| env!("CARGO_BIN_EXE_drift").to_string())
});

fn write(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// One default-tier call wrapper (30 route handlers) and, in each of 4 areas, two
/// suggestions: emails rendered inside the area's `<Base*Wrapper>` (a JSX layout wrapper)
/// and helpers that pass `level` to the area's `log*()` (an argument key): 8 suggestions.
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(r, "package.json", "{ \"name\": \"t\" }");
    write(
        r,
        "lib/auth.ts",
        "export function withAuth<T>(h: T): T {\n  return h;\n}\n",
    );
    for i in 10..40 {
        let route = if i < 38 {
            "import { withAuth } from \"../../../lib/auth\";\n\nexport const GET = withAuth(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n"
        } else {
            "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n"
        };
        write(r, &format!("app/api/r{i}/route.ts"), route);
    }
    for (k, d) in ["a", "b", "c", "d"].into_iter().enumerate() {
        write(
            r,
            &format!("src/ui{d}/base.tsx"),
            &format!(
                "export function Base{d}Wrapper(p: any) {{\n  return <div>{{p.children}}</div>;\n}}\n"
            ),
        );
        write(
            r,
            &format!("src/lib{d}/log.ts"),
            &format!("export function log{d}(m: {{ level?: string }}) {{}}\n"),
        );
        let n = 30 + 3 * k;
        for i in 0..n {
            let follows = i < n - 1 - (k % 3);
            let email = if follows {
                format!(
                    "import {{ Base{d}Wrapper }} from \"../ui{d}/base\";\n\nexport function Email{d}{i}() {{\n  return <Base{d}Wrapper><p>hi</p></Base{d}Wrapper>;\n}}\n"
                )
            } else {
                format!("export function Email{d}{i}() {{\n  return <p>hi</p>;\n}}\n")
            };
            write(r, &format!("src/emails{d}/e{i}.tsx"), &email);
            let key = if follows { "level: \"x\"" } else { "" };
            write(
                r,
                &format!("src/lib{d}/u{i}.ts"),
                &format!(
                    "import {{ log{d} }} from \"./log\";\n\nexport function util{d}{i}() {{\n  log{d}({{ {key} }});\n  return {i};\n}}\n"
                ),
            );
        }
    }
    for i in 10..30 {
        write(
            r,
            &format!("src/ui/c{i}.tsx"),
            &format!("export function Card{i}() {{\n  return <div>c</div>;\n}}\n"),
        );
        write(
            r,
            &format!("src/other/o{i}.ts"),
            &format!("export function other{i}() {{\n  return {i};\n}}\n"),
        );
    }
    dir
}

fn drift(root: &Path, args: &[&str]) -> String {
    let out = Command::new(&*BIN)
        .env("DRIFT_TEST_UNSHOWN", "1")
        .args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn json(root: &Path, args: &[&str]) -> Value {
    serde_json::from_str(&drift(root, args)).unwrap()
}

/// `(rank, id)` of each proposal the text lists, in order.
fn listed(text: &str) -> Vec<(usize, String)> {
    text.lines()
        .filter_map(|l| {
            let (n, rest) = l.trim_start().split_once(". [")?;
            Some((n.parse().ok()?, rest.split(']').next()?.to_string()))
        })
        .collect()
}

fn ids_where(v: &Value, f: impl Fn(&Value) -> bool) -> Vec<(usize, String)> {
    v["proposals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| f(p))
        .map(|p| {
            (
                p["rank"].as_u64().unwrap() as usize,
                p["id"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn census_lists_the_default_tier_then_the_best_five_suggestions() {
    let dir = repo();
    let r = dir.path();
    let v = json(r, &["census", "--json"]);
    let ps = v["proposals"].as_array().unwrap();
    let defaults = v["tiers"]["default"].as_u64().unwrap() as usize;
    let suggestions = v["tiers"]["suggestion"].as_u64().unwrap() as usize;
    assert!(defaults >= 1, "{v}");
    assert!(
        suggestions > 5,
        "the fixture needs more than 5 suggestions: {v}"
    );
    assert_eq!(
        ps.len(),
        defaults + suggestions,
        "JSON keeps every proposal"
    );
    assert_eq!(
        v["suggestion_cap"],
        serde_json::json!({ "cap": 5, "from": "default", "suggestions": suggestions, "listed": 5 })
    );
    // Default tier first, all shown; then suggestions by their evidence: the higher lower
    // bound, then fewer outliers, then the higher lift, then the id.
    for (i, p) in ps.iter().enumerate() {
        assert_eq!(p["rank"].as_u64().unwrap() as usize, i + 1, "{p}");
        assert_eq!(p["tier"] == "default", i < defaults, "{p}");
        assert_eq!(p["shown_by_default"], i < defaults + 5, "{p}");
    }
    let key = |p: &Value| {
        let e = &p["evidence"];
        (
            -e["lower_bound"].as_f64().unwrap(),
            e["total"].as_u64().unwrap() - e["holders"].as_u64().unwrap(),
            -e["lift"].as_f64().unwrap(),
            p["id"].as_str().unwrap().to_string(),
        )
    };
    for w in ps[defaults..].windows(2) {
        assert!(key(&w[0]) < key(&w[1]), "{} then {}", w[0], w[1]);
    }

    // The text lists what JSON marks shown, in the same order and ranks, and says how many
    // it left out.
    let text = drift(r, &["census"]);
    assert_eq!(
        listed(&text),
        ids_where(&v, |p| p["shown_by_default"] == true),
        "{text}"
    );
    assert!(
        text.contains(&format!(
            "Showing 5 of {suggestions} suggestions, best first by their evidence (lower bound, then fewer outliers, then lift); {} more",
            suggestions - 5
        )),
        "{text}"
    );
    assert!(
        text.contains("`drift census --all` lists every one"),
        "{text}"
    );

    // --all lists every proposal, in the JSON's order; --suggestions N the best N.
    let all = drift(r, &["census", "--all"]);
    assert_eq!(listed(&all), ids_where(&v, |_| true), "{all}");
    assert!(!all.contains("Showing "), "{all}");
    let two = drift(r, &["census", "--suggestions", "2"]);
    assert_eq!(listed(&two).len(), defaults + 2, "{two}");
    let zero = drift(r, &["census", "--suggestions", "0"]);
    assert_eq!(
        listed(&zero),
        ids_where(&v, |p| p["tier"] == "default"),
        "a cap of 0 still lists the whole default tier: {zero}"
    );
    // --tier keeps the cap and the ranks of the full list.
    let sugg = drift(r, &["census", "--tier", "suggestion"]);
    assert_eq!(
        listed(&sugg),
        ids_where(&v, |p| p["tier"] == "suggestion"
            && p["shown_by_default"] == true),
        "{sugg}"
    );
    let def = drift(r, &["census", "--tier", "default"]);
    assert!(!def.contains("Showing "), "{def}");

    // The cap changes nothing but what is listed: the same ids, tiers, ranks and evidence.
    let strip = |mut v: Value| {
        v.as_object_mut().unwrap().remove("suggestion_cap");
        for p in v["proposals"].as_array_mut().unwrap() {
            p.as_object_mut().unwrap().remove("shown_by_default");
        }
        v
    };
    assert_eq!(
        strip(v.clone()),
        strip(json(r, &["census", "--json", "--all"]))
    );
    assert_eq!(
        json(r, &["census", "--json", "--all"])["suggestion_cap"]["from"],
        "all"
    );
}

#[test]
fn init_lists_the_best_suggestions_and_keeps_the_policy_cap() {
    let dir = repo();
    let r = dir.path();
    let v = json(r, &["census", "--json"]);
    let suggestions = v["tiers"]["suggestion"].as_u64().unwrap() as usize;
    let out = drift(r, &["init"]);
    assert_eq!(
        listed(&out),
        ids_where(&v, |p| p["shown_by_default"] == true),
        "{out}"
    );
    assert!(
        out.contains(&format!("Showing 5 of {suggestions} suggestions")),
        "{out}"
    );
    // Every proposal is written, listed or not.
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    for (_, id) in ids_where(&v, |_| true) {
        assert!(yaml.contains(&format!("id: {id}")), "{id} not written");
    }

    // `suggestion_cap` in the policy: census, init and review read it; init keeps it.
    let capped = yaml.replacen("conventions:\n", "suggestion_cap: 2\nconventions:\n", 1);
    assert_ne!(capped, yaml);
    std::fs::write(r.join(".drift/conventions.yaml"), &capped).unwrap();
    let c = json(r, &["census", "--json"]);
    assert_eq!(c["suggestion_cap"]["cap"], 2);
    assert_eq!(c["suggestion_cap"]["from"], "conventions.yaml");
    let defaults = v["tiers"]["default"].as_u64().unwrap() as usize;
    assert_eq!(listed(&drift(r, &["census"])).len(), defaults + 2);
    assert_eq!(
        json(r, &["census", "--json", "--suggestions", "4"])["suggestion_cap"]["cap"],
        4,
        "the flag wins"
    );
    let again = drift(r, &["init"]);
    assert_eq!(listed(&again).len(), defaults + 2, "{again}");
    let kept = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    assert!(kept.contains("suggestion_cap: 2\n"), "{kept}");
    std::fs::write(
        r.join(".drift/conventions.yaml"),
        kept.replace("suggestion_cap: 2\n", "suggestion_cap: all\n"),
    )
    .unwrap();
    let c = json(r, &["census", "--json"]);
    assert_eq!(c["suggestion_cap"]["cap"], Value::Null);
    assert_eq!(c["suggestion_cap"]["listed"], suggestions);
    assert_eq!(listed(&drift(r, &["census"])).len(), defaults + suggestions);
}

/// Hidden suggestions are still conventions: accepted, they are checked exactly as
/// before, whatever the cap.
#[test]
fn the_cap_never_changes_check() {
    let dir = repo();
    let r = dir.path();
    drift(r, &["init"]);
    let v = json(r, &["census", "--json"]);
    let hidden: Vec<String> = ids_where(&v, |p| p["shown_by_default"] == false)
        .into_iter()
        .map(|(_, id)| id)
        .collect();
    assert!(!hidden.is_empty());
    let all: Vec<String> = ids_where(&v, |_| true)
        .into_iter()
        .map(|(_, id)| id)
        .collect();
    drift(r, &["review", "--accept", &all.join(",")]);
    let yaml = std::fs::read_to_string(r.join(".drift/conventions.yaml")).unwrap();
    let check = |cap: &str| {
        std::fs::write(
            r.join(".drift/conventions.yaml"),
            yaml.replacen(
                "conventions:\n",
                &format!("suggestion_cap: {cap}\nconventions:\n"),
                1,
            ),
        )
        .unwrap();
        let out = Command::new(&*BIN)
            .env("DRIFT_TEST_UNSHOWN", "1")
            .args(["check", "--format", "json"])
            .current_dir(r)
            .env_remove("DRIFT_CACHE_DIR")
            .output()
            .unwrap();
        String::from_utf8(out.stdout).unwrap()
    };
    let none = check("0");
    assert_eq!(none, check("all"));
    let report: Value = serde_json::from_str(&none).unwrap();
    // The legacy violations of a hidden suggestion are still reported as baselined.
    let ids: Vec<&str> = report["violations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap())
        .collect();
    assert!(
        hidden.iter().any(|h| ids.contains(&h.as_str())),
        "{hidden:?} {ids:?}"
    );
}
