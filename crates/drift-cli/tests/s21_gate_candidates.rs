//! `drift census --gate-candidate <name>` (stream S21; audit 7 gaps G2, G5; PLAN-R14
//! WS-H): candidate changes to mining's gates, each behind a switch that is off. On small
//! synthetic repositories with invented names, each switch changes what census proposes
//! in the way its candidate says, marks what only it made (`gate_candidate` in the JSON,
//! a `study:` line in the text), and with no switch on (or on a repository where the
//! candidate has nothing to change) census prints exactly what it printed before.
//!
//! What it pins: before S21 the flag did not exist (every test below fails on the
//! argument), the outlier rule refused a rule every member holds, roles under 19 members
//! yielded no plain rule, the per-role cap counted hidden drafts, the caps ran before the
//! merge of sibling roles, and the layering share cut default-tier rules.

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

/// Run the CLI; `unshown`: without the show policy (a debug build's test switch), so a
/// card of a family the policy does not admit can be seen.
fn run(root: &Path, args: &[&str], unshown: bool) -> std::process::Output {
    let mut cmd = Command::new(&*BIN);
    cmd.args(args)
        .current_dir(root)
        .env_remove("DRIFT_CACHE_DIR")
        .env_remove("DRIFT_FUNNEL")
        .env_remove("DRIFT_EXPERIMENTAL")
        .env_remove("DRIFT_TEST_UNSHOWN");
    if unshown {
        cmd.env("DRIFT_TEST_UNSHOWN", "1");
    }
    cmd.output().unwrap()
}

fn drift(root: &Path, args: &[&str], unshown: bool) -> String {
    let out = run(root, args, unshown);
    assert!(
        out.status.success(),
        "{args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn census(root: &Path, extra: &[&str], unshown: bool) -> Value {
    let mut args = vec!["census", "--json"];
    args.extend_from_slice(extra);
    serde_json::from_str(&drift(root, &args, unshown)).unwrap()
}

fn proposals(v: &Value) -> &Vec<Value> {
    v["proposals"].as_array().unwrap()
}

/// The proposals whose rule names `target` (a wrapper, component, pattern or signal)
/// and whose summary names `place`.
fn find<'v>(v: &'v Value, target: &str, place: &str) -> Vec<&'v Value> {
    proposals(v)
        .iter()
        .filter(|p| {
            let rule = p["rule"].to_string();
            rule.contains(target) && p["summary"].as_str().unwrap_or("").contains(place)
        })
        .collect()
}

const SIGNED: &str = "import { withSession } from \"@/lib/session\";\n\nexport const GET = withSession(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const GATED: &str = "import { withBadge } from \"@/lib/badge\";\n\nexport const GET = withBadge(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const ROOSTED: &str = "import { withRoost } from \"@/lib/roost\";\n\nexport const GET = withRoost(async (req: Request) => {\n  return Response.json({ ok: true });\n});\n";
const PLAIN: &str =
    "export async function GET(req: Request) {\n  return Response.json({ ok: true });\n}\n";

fn next_app(r: &Path) {
    write(r, "package.json", "{ \"name\": \"heronry\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } } }",
    );
    for w in ["Session", "Badge", "Roost"] {
        write(
            r,
            &format!("lib/{}.ts", w.to_lowercase()),
            &format!("export function with{w}<T>(h: T): T {{\n  return h;\n}}\n"),
        );
    }
    // Helpers, so a wrapper is rare among functions at large (lift).
    for i in 0..30 {
        write(
            r,
            &format!("lib/h{i:02}.ts"),
            &format!("export function h{i}() {{\n  return {i};\n}}\n"),
        );
    }
}

/// Routes in four folders: `nests` 12 of 12 on `withSession` (no outlier, a role under
/// 15), `roosts` 16 of 16 on `withRoost` (no outlier, a role the default tier would
/// take), `perches` 12 of 13 on `withBadge` (lower bound 0.667, under 0.75), and 10 plain
/// routes, so no wrapper is a convention of `app/**` as a whole.
fn routes() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r);
    for i in 0..12 {
        write(r, &format!("app/nests/n{i:02}/route.ts"), SIGNED);
    }
    for i in 0..16 {
        write(r, &format!("app/roosts/r{i:02}/route.ts"), ROOSTED);
    }
    for i in 0..13 {
        write(
            r,
            &format!("app/perches/p{i:02}/route.ts"),
            if i < 12 { GATED } else { PLAIN },
        );
    }
    for i in 0..10 {
        write(r, &format!("app/plain/q{i:02}/route.ts"), PLAIN);
    }
    dir
}

/// `universal`: a rule every member holds is proposed, advise only, marked, and said to
/// hold everywhere; without the switch it is not proposed.
#[test]
fn universal_proposes_a_rule_with_no_outlier_advise_only() {
    let dir = routes();
    let r = dir.path();
    let off = census(r, &[], true);
    assert!(
        find(&off, "withSession", "app/nests/**").is_empty(),
        "{off:#}"
    );
    assert!(
        find(&off, "withRoost", "app/roosts/**").is_empty(),
        "{off:#}"
    );

    let on = census(r, &["--gate-candidate", "universal"], true);
    let nest = find(&on, "withSession", "app/nests/**");
    assert_eq!(nest.len(), 1, "{on:#}");
    assert_eq!(nest[0]["gate_candidate"], "universal");
    assert_eq!(nest[0]["outliers_total"], 0);
    assert_eq!(nest[0]["evidence"]["holders"], 12);
    assert_eq!(nest[0]["tier"], "suggestion");
    // 16 of 16, a call wrapper defined in the repository: the default tier's kind and
    // size, but a candidate's proposal advises only.
    let roost = find(&on, "withRoost", "app/roosts/**");
    assert_eq!(roost.len(), 1, "{on:#}");
    assert_eq!(roost[0]["gate_candidate"], "universal");
    assert_eq!(roost[0]["tier"], "suggestion");
    assert_eq!(roost[0]["tier_reason"], "gate_candidate");
    // What mining proposes without the switch is still proposed, unmarked.
    for p in proposals(&off) {
        let same = proposals(&on)
            .iter()
            .find(|q| q["id"] == p["id"])
            .unwrap_or_else(|| panic!("{} lost with the switch", p["id"]));
        assert!(same.get("gate_candidate").is_none(), "{same:#}");
    }

    let text = drift(r, &["census", "--gate-candidate", "universal"], true);
    assert!(
        text.contains("study:    holds everywhere; cannot be checked against an exception"),
        "{text}"
    );
    let plain = drift(r, &["census"], true);
    assert!(!plain.contains("study:"), "{plain}");
}

/// `small-roles`: 12 of 13 (92%, lower bound 0.667) in a role of 13, with the target in
/// the repository, is proposed, advise only; without the switch it is dropped at `wilson`.
#[test]
fn small_roles_proposes_a_rule_held_by_nine_in_ten_of_a_role_under_19() {
    let dir = routes();
    let r = dir.path();
    let off = census(r, &[], true);
    assert!(
        find(&off, "withBadge", "app/perches/**").is_empty(),
        "{off:#}"
    );

    let on = census(r, &["--gate-candidate", "small-roles"], true);
    let perch = find(&on, "withBadge", "app/perches/**");
    assert_eq!(perch.len(), 1, "{on:#}");
    let p = perch[0];
    assert_eq!(p["gate_candidate"], "small-roles");
    assert_eq!(p["evidence"]["holders"], 12);
    assert_eq!(p["evidence"]["total"], 13);
    assert_eq!(p["tier"], "suggestion");
    assert_eq!(p["outliers_total"], 1);
    // A role of 8 to 18 that every member follows is the same candidate's.
    let nest = find(&on, "withSession", "app/nests/**");
    assert_eq!(nest.len(), 1, "{on:#}");
    assert_eq!(nest[0]["gate_candidate"], "small-roles");

    // `universal` alone does not bring the 12 of 13 in.
    let universal = census(r, &["--gate-candidate", "universal"], true);
    assert!(find(&universal, "withBadge", "app/perches/**").is_empty());
}

const WORDS: &[&str] = &[
    "Alder",
    "Birch",
    "Cedar",
    "Dogwood",
    "Elm",
    "Fir",
    "Ginkgo",
    "Hazel",
    "Ivy",
    "Juniper",
    "Kapok",
    "Larch",
    "Maple",
    "Neem",
    "Oak",
    "Pine",
    "Quince",
    "Rowan",
    "Spruce",
    "Teak",
    "Ulmo",
    "Vine",
    "Willow",
    "Yew",
    "Zelkova",
    "Acacia",
    "Banyan",
    "Cypress",
    "Date",
    "Ebony",
    "Fig",
    "Gum",
    "Holly",
    "Iroko",
    "Jacaranda",
    "Kauri",
    "Lime",
    "Mango",
    "Nutmeg",
    "Olive",
    "Poplar",
    "Quassia",
    "Redwood",
    "Sumac",
    "Tamarind",
    "Umbrella",
    "Walnut",
    "Xylosma",
    "Yucca",
    "Ziziphus",
    "Almond",
    "Beech",
    "Cherry",
    "Douglas",
    "Eucalyptus",
    "Filbert",
    "Guava",
    "Hickory",
    "Ironwood",
    "Jujube",
    "Kumquat",
    "Laurel",
    "Mulberry",
    "Nectarine",
];

fn tsx_app(r: &Path) {
    write(r, "package.json", "{ \"name\": \"arboretum\" }");
    write(
        r,
        "tsconfig.json",
        "{ \"compilerOptions\": { \"jsx\": \"react-jsx\", \"baseUrl\": \".\" } }",
    );
    // Components outside the roles under test, rendering nothing of the repository's, so
    // the rules below are rare among components at large (lift).
    for (i, w) in WORDS.iter().enumerate() {
        write(
            r,
            &format!("widgets/{w}.tsx"),
            &format!("export function {w}Widget() {{\n  return <p>{i}</p>;\n}}\n"),
        );
    }
}

const PARTS: &[&str] = &["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

/// 20 components in `components/`: each renders five parts of `ui/` but one (component i
/// lacks part i, so the five rules have different outliers), and 19 are named `*Card`.
/// Five renders rules (19 of 20, a family the show policy hides in TypeScript) outscore
/// the naming rule (19 of 20, shown), which is the role's sixth draft.
fn cards() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tsx_app(r);
    for p in PARTS {
        write(
            r,
            &format!("ui/{p}.tsx"),
            &format!("export function {p}() {{\n  return <span />;\n}}\n"),
        );
    }
    for (i, word) in WORDS.iter().enumerate().take(20) {
        let imports: String = PARTS
            .iter()
            .map(|p| format!("import {{ {p} }} from \"../ui/{p}\";\n"))
            .collect();
        let body: String = PARTS
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, p)| format!("<{p} />"))
            .collect();
        let name = if i == 19 {
            "Lonely".to_string()
        } else {
            format!("{word}Card")
        };
        write(
            r,
            &format!("components/{name}.tsx"),
            &format!("{imports}\nexport function {name}() {{\n  return <div>{body}</div>;\n}}\n"),
        );
    }
    dir
}

/// `cap-show-aware`: the per-role cap of 5 counts the five hidden renders drafts and
/// cuts the naming rule; counting only shown drafts, it keeps it, and the show policy
/// shows it.
#[test]
fn cap_show_aware_keeps_a_shown_draft_behind_hidden_ones() {
    let dir = cards();
    let r = dir.path();
    let off = census(r, &[], false);
    assert!(find(&off, "*Card", "components/**").is_empty(), "{off:#}");
    let on = census(r, &["--gate-candidate", "cap-show-aware"], false);
    let named = find(&on, "*Card", "components/**");
    assert_eq!(named.len(), 1, "{on:#}");
    assert_eq!(named[0]["gate_candidate"], "cap-show-aware");
    assert_eq!(named[0]["evidence"]["holders"], 19);
}

/// 20 components in `components/north/` and 20 in `components/south/`, 19 of each
/// rendering `<Panel />` (sibling roles one card covers), and 20 in `components/east/`
/// that render nothing, so `components/**` as a whole has no rule.
fn siblings() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    tsx_app(r);
    write(
        r,
        "ui/Panel.tsx",
        "export function Panel() {\n  return <span />;\n}\n",
    );
    for (f, folder) in ["north", "south", "east"].iter().enumerate() {
        for i in 0..20 {
            let name = format!("{}{}", WORDS[f * 20 + i], ["N", "S", "E"][f]);
            let (import, body) = if *folder != "east" && i < 19 {
                ("import { Panel } from \"../../ui/Panel\";\n\n", "<Panel />")
            } else {
                ("", "<b />")
            };
            write(
                r,
                &format!("components/{folder}/{name}.tsx"),
                &format!("{import}export function {name}() {{\n  return <div>{body}</div>;\n}}\n"),
            );
        }
    }
    dir
}

/// `cap-after-narrow`: with `--max 1`, the cap keeps one of the two sibling drafts and
/// the merge has one part left; capping after the merge keeps the one card that covers
/// both folders.
#[test]
fn cap_after_narrow_caps_the_merged_card_not_its_parts() {
    let dir = siblings();
    let r = dir.path();
    let off = census(r, &["--max", "1"], true);
    let panel = find(&off, "Panel", "components/");
    assert_eq!(panel.len(), 1, "{off:#}");
    assert!(
        panel[0]["role"]
            .get("also")
            .is_none_or(|a| a.as_array().is_some_and(|a| a.is_empty())),
        "without the switch the cap leaves one folder: {off:#}"
    );
    assert_eq!(panel[0]["evidence"]["holders"], 19);

    let on = census(
        r,
        &["--max", "1", "--gate-candidate", "cap-after-narrow"],
        true,
    );
    let panel = find(&on, "Panel", "components/");
    assert_eq!(panel.len(), 1, "{on:#}");
    assert_eq!(panel[0]["gate_candidate"], "cap-after-narrow");
    assert_eq!(panel[0]["evidence"]["holders"], 38);
    assert_eq!(panel[0]["evidence"]["total"], 40);
}

/// `packages/core` sits below `packages/app` and `packages/web`, which import it from
/// many files; one core file imports each of them.
fn layers() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    write(
        r,
        "package.json",
        r#"{ "name": "root", "private": true, "workspaces": ["packages/*"] }"#,
    );
    write(r, "packages/core/package.json", r#"{ "name": "@x/core" }"#);
    for top in ["app", "web"] {
        write(
            r,
            &format!("packages/{top}/package.json"),
            &format!(r#"{{ "name": "@x/{top}", "main": "index.ts" }}"#),
        );
        write(
            r,
            &format!("packages/{top}/index.ts"),
            &format!("export const {top} = 1;\n"),
        );
        for i in 0..30 {
            write(
                r,
                &format!("packages/{top}/src/x{i}.ts"),
                &format!(
                    "import {{ c{i} }} from '../../core/src/c{i}';\nexport const {top}{i} = c{i};\n"
                ),
            );
        }
        write(
            r,
            &format!("packages/core/src/uses-{top}.ts"),
            &format!("import {{ {top} }} from '@x/{top}';\nexport const s = {top};\n"),
        );
    }
    for i in 0..200 {
        write(
            r,
            &format!("packages/core/src/c{i}.ts"),
            &format!("export const c{i} = {i};\n"),
        );
    }
    dir
}

/// `avoid-cap-own`: with `--max 4` the layering share is 1, and it cuts the second of two
/// default-tier layering rules; with the switch both are proposed.
#[test]
fn avoid_cap_own_keeps_default_tier_layering_past_the_share() {
    let dir = layers();
    let r = dir.path();
    let layering = |v: &Value| -> Vec<Value> {
        proposals(v)
            .iter()
            .filter(|p| {
                p["rule"]["signal"] == "import:packages/app"
                    || p["rule"]["signal"] == "import:packages/web"
            })
            .cloned()
            .collect()
    };
    let off = layering(&census(r, &["--max", "4"], false));
    assert_eq!(off.len(), 1, "{off:#?}");
    assert_eq!(off[0]["tier"], "default");

    let on = layering(&census(
        r,
        &["--max", "4", "--gate-candidate", "avoid-cap-own"],
        false,
    ));
    assert_eq!(on.len(), 2, "{on:#?}");
    assert!(on.iter().all(|p| p["tier"] == "default"));
    let marked: Vec<&Value> = on
        .iter()
        .filter(|p| p.get("gate_candidate").is_some())
        .collect();
    assert_eq!(marked.len(), 1, "{on:#?}");
    assert_eq!(marked[0]["gate_candidate"], "avoid-cap-own");
    assert_ne!(marked[0]["id"], off[0]["id"]);
}

/// Routes that all but one wrap in the repository's `withSession` (19 of 20), and
/// helpers: no rule every member holds, no role of 8 to 18, no cap reached, no merge,
/// nothing a recount drops. Every candidate has nothing to change here.
fn steady() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    next_app(r);
    for i in 0..20 {
        write(
            r,
            &format!("app/hives/h{i:02}/route.ts"),
            if i < 19 {
                SIGNED
            } else {
                "export async function GET(req: Request) {\n  return new Response(null);\n}\n"
            },
        );
    }
    dir
}

/// With no switch, and with each switch where it has nothing to change, census prints
/// byte for byte the same text and JSON; and the flag is hidden from the help, unknown to
/// `init`, and writes nothing.
///
/// It compares this binary with itself, switch against no switch, so it cannot show that
/// the path with every switch off is what the binary before the switches mined; each
/// census runs in a process of its own, so it says nothing of state left in one either.
/// That proof is the old-against-new byte diff of `drift --no-cache census --json` (and
/// the text census) at integration.
#[test]
fn every_switch_is_inert_where_it_has_nothing_to_change() {
    let dir = steady();
    let r = dir.path();
    let json = drift(r, &["census", "--json"], false);
    let text = drift(r, &["census"], false);
    let v: Value = serde_json::from_str(&json).unwrap();
    assert!(
        // The role is `app/**` (route files): the only route files are under `app/hives`,
        // so the rule is said of the shallower role (fix wave 1: the test first looked
        // for `app/hives/**`, which mining never names here).
        !find(&v, "withSession", "HTTP handlers in app/** (route files)").is_empty(),
        "the 19 of 20 is proposed: {v:#}"
    );
    for name in [
        "universal",
        "small-roles",
        "cap-show-aware",
        "cap-after-narrow",
        "narrow-recheck",
        "avoid-cap-own",
    ] {
        assert_eq!(
            drift(r, &["census", "--json", "--gate-candidate", name], false),
            json,
            "census --json --gate-candidate {name}"
        );
        assert_eq!(
            drift(r, &["census", "--gate-candidate", name], false),
            text,
            "census --gate-candidate {name}"
        );
    }
    // Several at once, too.
    let all = [
        "census",
        "--json",
        "--gate-candidate",
        "cap-show-aware",
        "--gate-candidate",
        "cap-after-narrow",
        "--gate-candidate",
        "narrow-recheck",
        "--gate-candidate",
        "avoid-cap-own",
    ];
    assert_eq!(drift(r, &all, false), json);
    // And a census with no switch after one with a switch is what it was.
    assert_eq!(drift(r, &["census", "--json"], false), json);

    let help = drift(r, &["census", "--help"], false);
    assert!(!help.contains("gate-candidate"), "{help}");
    let init = run(r, &["init", "--gate-candidate", "universal"], false);
    assert!(!init.status.success(), "init takes no gate candidate");
    assert!(!r.join(".drift/conventions.yaml").exists());
}
