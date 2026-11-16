//! Stream S8, audit 6 ("what breaks with 10 to 50 times more conventions"): an agent
//! message lists at most `MAX_AGENT_VIOLATIONS` violations. Before, it kept the first ones
//! in the order given (by path), so with many advice violations the ones that block the
//! end of the turn could be the part cut off, and the cut line said only "+N more". Now
//! block-mode violations come first and the cut line says how many of each were left out.

use drift_mine::check::{Extent, Violation};
use drift_mine::report::{
    AgentAt, GithubSummary, MAX_AGENT_VIOLATIONS, MAX_SUMMARY_VIOLATIONS, agent_message,
    github_summary,
};
use drift_mine::tier::Tier;

fn v(path: &str, mode: &str) -> Violation {
    Violation {
        id: "D-abc123".into(),
        path: path.into(),
        symbol: "GET".into(),
        line: 4,
        summary: "HTTP handlers in app/api/** are wrapped in withAuth()".into(),
        evidence: "40/43".into(),
        example: "app/api/a/route.ts#GET".into(),
        mode: mode.into(),
        tier: Tier::Default,
        baselined: false,
        suppressed: false,
        unsure: false,
        suppressed_neighbour: false,
        extent: Extent::Symbol { start: 4, end: 9 },
        wire: None,
        import: None,
        practice: None,
    }
}

/// Seven advice violations sorted before two block-mode ones (`a…` before `z…`).
fn mixed() -> Vec<Violation> {
    let mut vs: Vec<Violation> = (0..7)
        .map(|i| v(&format!("app/api/a{i}/route.ts"), "advise"))
        .collect();
    vs.push(v("app/api/z1/route.ts", "block"));
    vs.push(v("app/api/z2/route.ts", "block"));
    vs
}

#[test]
fn block_mode_violations_are_listed_before_the_cap() {
    let vs = mixed();
    let refs: Vec<&Violation> = vs.iter().collect();
    let msg = agent_message(&refs, AgentAt::Edit);
    assert_eq!(
        msg.matches("  at   ").count(),
        MAX_AGENT_VIOLATIONS,
        "{msg}"
    );
    // Both block-mode ones are listed, first.
    let at = |needle: &str| {
        msg.find(needle)
            .unwrap_or_else(|| panic!("{needle} in {msg}"))
    };
    assert!(
        at("app/api/z1/route.ts") < at("app/api/a0/route.ts"),
        "{msg}"
    );
    assert!(
        at("app/api/z2/route.ts") < at("app/api/a0/route.ts"),
        "{msg}"
    );
    // The advice cut off is counted as advice; no block-mode one was cut.
    assert!(
        msg.contains("+4 more (4 advice): run `drift check` to see all\n"),
        "{msg}"
    );
}

#[test]
fn the_cut_line_counts_each_mode() {
    let vs: Vec<Violation> = (0..8)
        .map(|i| v(&format!("app/api/b{i}/route.ts"), "block"))
        .chain((0..2).map(|i| v(&format!("app/api/c{i}/route.ts"), "advise")))
        .collect();
    let refs: Vec<&Violation> = vs.iter().collect();
    let msg = agent_message(&refs, AgentAt::Edit);
    assert!(
        msg.contains("+5 more (3 that block, 2 advice): run `drift check` to see all\n"),
        "{msg}"
    );
    // Advice only: the line never speaks of blocking.
    let advice: Vec<Violation> = (0..7)
        .map(|i| v(&format!("app/api/d{i}/route.ts"), "advise"))
        .collect();
    let refs: Vec<&Violation> = advice.iter().collect();
    let msg = agent_message(&refs, AgentAt::Check);
    assert!(msg.contains("+2 more (2 advice)"), "{msg}");
    assert!(!msg.contains("block"), "{msg}");
}

#[test]
fn the_job_summary_says_what_it_cut() {
    let vs: Vec<Violation> = (0..12)
        .map(|i| v(&format!("app/api/e{i:02}/route.ts"), "advise"))
        .chain((0..2).map(|i| v(&format!("app/api/f{i}/route.ts"), "block")))
        .collect();
    let new: Vec<&Violation> = vs.iter().collect();
    let md = github_summary(&GithubSummary {
        new: &new,
        suppressed: &[],
        legacy: 0,
        diff: None,
        strict: false,
        unchecked: &[],
        base_unchecked: &[],
        unsure: 0,
    });
    assert!(md.contains("`app/api/f0/route.ts`"), "{md}");
    assert!(md.contains("`app/api/f1/route.ts`"), "{md}");
    assert!(
        md.contains(&format!(
            "\n+{} more (4 advice) in the annotations and the log.\n",
            vs.len() - MAX_SUMMARY_VIOLATIONS
        )),
        "{md}"
    );
}
