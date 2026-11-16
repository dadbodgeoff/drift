//! CircleCI: `.circleci/config.yml`.
//!
//! - **A download handed to an interpreter** in a `run` step (`- run: curl ... |
//!   sh`, or its `command:`), of a job or of a reusable command (`commands:`, read
//!   as the job `commands/<name>`), `piped_download`.
//! - **An orb named by what its publisher can move** (`unpinned_action`, job
//!   `orbs`): a version that is not a full release (`@1`, `@1.2`, `@volatile`,
//!   `@dev:...`). A release `X.Y.Z` of an orb cannot be published again with other
//!   content, so it is pinned. CircleCI's own orbs (the `circleci` namespace) are not
//!   listed, as GitHub's own actions are not; an orb written inline is the
//!   repository's own. What an orb runs, runs with the project's variables.
//!
//! A job's `docker:` images named by a tag are not listed: they are the counterpart
//! of a GitHub job's `container:`, which the GitHub reading does not list.

use std::path::Path;

use serde_json::Value;

use super::{Read, finding, key_under, line_at, top_key};
use crate::workflows::piped_download;

const FILES: &[&str] = &[".circleci/config.yml", ".circleci/config.yaml"];

pub(super) fn read(root: &Path, out: &mut Read) {
    for rel in FILES {
        let Some(text) = out.load(root, rel) else {
            continue;
        };
        let Some(doc) = out.yaml(rel, &text) else {
            continue;
        };
        let mut found = Vec::new();
        if let Some(orbs) = doc.get("orbs").and_then(Value::as_object) {
            for name in orbs.values().filter_map(Value::as_str) {
                if unpinned_orb(name) {
                    found.push(finding(
                        "unpinned_action",
                        rel,
                        line_at(&text, top_key(&text, "orbs"), name),
                        "orbs",
                        name,
                    ));
                }
            }
        }
        for (section, prefix) in [("jobs", ""), ("commands", "commands/")] {
            let Some(jobs) = doc.get(section).and_then(Value::as_object) else {
                continue;
            };
            for (name, body) in jobs {
                let from = key_under(&text, section, name);
                let steps = body.get("steps").and_then(Value::as_array);
                for step in steps.into_iter().flatten() {
                    let run = step.get("run");
                    let command = run
                        .and_then(Value::as_str)
                        .or_else(|| run.and_then(|r| r.get("command")).and_then(Value::as_str));
                    if let Some(c) = command.and_then(piped_download) {
                        found.push(finding(
                            "piped_download",
                            rel,
                            line_at(&text, from, c),
                            &format!("{prefix}{name}"),
                            c,
                        ));
                    }
                }
            }
        }
        out.add(found);
    }
}

/// An orb (`namespace/name@version`) of another publisher than CircleCI, named by a
/// version that is not a full release.
fn unpinned_orb(orb: &str) -> bool {
    let Some((name, version)) = orb.split_once('@') else {
        return false;
    };
    let namespace = name.split('/').next().unwrap_or_default();
    if namespace == "circleci" || version.contains("<<") {
        return false;
    }
    let parts: Vec<&str> = version.split('.').collect();
    let release = parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    !release
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_orb_is_pinned_by_a_full_release() {
        use super::unpinned_orb;
        assert!(!unpinned_orb("someone/deploy@1.2.3"));
        assert!(unpinned_orb("someone/deploy@1"));
        assert!(unpinned_orb("someone/deploy@1.2"));
        assert!(unpinned_orb("someone/deploy@volatile"));
        assert!(unpinned_orb("someone/deploy@dev:alpha"));
        assert!(!unpinned_orb("circleci/node@5"));
    }
}
