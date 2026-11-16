//! `drift hook generic <event>` (experimental): Drift's own hook protocol, for an agent
//! Drift has no adapter for, through a small wrapper a person writes around that agent's
//! hooks. Its events and fields are the neutral ones ([`super::Event`], [`super::Call`],
//! [`super::Answer`]) under plain names; docs/wiki/Hooks-Reference.md documents them.
//! It is defined here, not read from any agent, so it is known field by field.

use drift_mine::report::sanitize;
use serde_json::{Map, Value, json};

use super::{Adapter, Answer, Call, Event, Permission, Search};

pub struct Generic;

/// The protocol's event names, as given on the command line.
pub const EVENTS: &[(&str, Event)] = &[
    ("session-start", Event::SessionStart),
    ("before-edit", Event::BeforeEdit),
    ("after-edit", Event::AfterEdit),
    ("before-shell", Event::BeforeShell),
    ("before-search", Event::BeforeSearch),
    ("prompt-submit", Event::PromptSubmit),
    ("end-of-turn", Event::EndOfTurn),
    ("session-end", Event::SessionEnd),
];

/// The call a payload makes, or the note saying why it is not read.
fn call(event: &str, payload: &Value) -> Result<Call, String> {
    let Some(&(_, ev)) = EVENTS.iter().find(|(name, _)| *name == event) else {
        let names: Vec<&str> = EVENTS.iter().map(|(n, _)| *n).collect();
        return Err(format!(
            "drift: {} is not an event of `drift hook generic` ({}); skipped",
            sanitize(event, 40),
            names.join(", ")
        ));
    };
    let Value::Object(p) = payload else {
        return Err(format!(
            "drift: the {event} payload is not a JSON object; skipped"
        ));
    };
    // A field that is there must be a string; one the event needs must be there.
    let text = |k: &str| -> Result<Option<String>, String> {
        match p.get(k) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(format!(
                "drift: `{k}` in the {event} payload is not a string; skipped"
            )),
        }
    };
    let needed = |k: &str| -> Result<String, String> {
        text(k)?.ok_or_else(|| format!("drift: the {event} payload has no `{k}`; skipped"))
    };
    let mut c = Call::new(ev);
    c.session_id = text("session_id")?;
    c.cwd = text("cwd")?;
    match ev {
        Event::SessionStart => c.source = text("source")?,
        Event::SessionEnd => c.source = text("reason")?,
        Event::BeforeEdit => {
            c.file_path = Some(needed("file_path")?);
            c.content = text("content")?;
        }
        Event::AfterEdit => c.file_path = Some(needed("file_path")?),
        Event::BeforeShell => c.command = Some(needed("command")?),
        Event::BeforeSearch => {
            let pattern = needed("pattern")?;
            c.search_path = text("path")?;
            c.search = Some(match needed("kind")?.as_str() {
                "content" => Search::Content {
                    pattern,
                    glob: text("glob")?,
                },
                "files" => Search::Files { pattern },
                other => {
                    return Err(format!(
                        "drift: `kind` {} in the before-search payload is not content or files; skipped",
                        sanitize(other, 40)
                    ));
                }
            });
        }
        Event::EndOfTurn => {
            c.after_block = match p.get("after_block") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => {
                    return Err(
                        "drift: `after_block` in the end-of-turn payload is not true or false; skipped"
                            .to_string(),
                    );
                }
            };
        }
        Event::PromptSubmit => {}
    }
    Ok(c)
}

impl Adapter for Generic {
    fn core_input(&self, event: &str, payload: Value) -> Result<(String, Value), String> {
        call(event, &payload).map(|c| c.core_input())
    }

    fn render(&self, _core_event: &str, out: Value) -> Option<Value> {
        let a = Answer::from_core(&out);
        if a.is_empty() {
            return None;
        }
        let mut o = Map::new();
        let decision = match (&a.block_stop, a.permission) {
            (Some(reason), _) => Some(("block", Some(reason.clone()))),
            (None, Some(Permission::Deny)) => Some(("deny", a.reason.clone())),
            (None, Some(Permission::Allow)) => Some(("allow", a.reason.clone())),
            (None, None) => None,
        };
        if let Some((d, reason)) = decision {
            o.insert("decision".into(), json!(d));
            if let Some(r) = reason {
                o.insert("reason".into(), json!(r));
            }
        }
        if let Some(c) = a.context {
            o.insert("context".into(), json!(c));
        }
        if let Some(m) = a.message {
            o.insert("message".into(), json!(m));
        }
        Some(Value::Object(o))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins: a payload missing what its event needs, of the wrong type, or for an event
    /// the protocol does not have is a note for the person, never an answer that refuses
    /// or blocks.
    #[test]
    fn payloads_it_cannot_read_are_notes() {
        for (event, payload) in [
            ("before-edit", json!({})),
            ("before-edit", json!({ "file_path": 3 })),
            ("before-shell", json!([])),
            ("before-search", json!({ "pattern": "x", "kind": "regex" })),
            ("end-of-turn", json!({ "after_block": "yes" })),
            ("PreToolUse", json!({})),
        ] {
            let note = Generic.core_input(event, payload.clone()).unwrap_err();
            assert!(
                note.starts_with("drift: ") && note.ends_with("skipped"),
                "{note}"
            );
        }
    }

    /// Pins: the answer's fields, one decision at most.
    #[test]
    fn answers_name_one_decision() {
        let stop = json!({ "decision": "block", "reason": "fix", "systemMessage": "note" });
        assert_eq!(
            Generic.render("Stop", stop),
            Some(json!({ "decision": "block", "reason": "fix", "message": "note" }))
        );
        let deny = json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "no" } });
        assert_eq!(
            Generic.render("PreToolUse", deny),
            Some(json!({ "decision": "deny", "reason": "no" }))
        );
        let ctx = json!({ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "advice" } });
        assert_eq!(
            Generic.render("PostToolUse", ctx),
            Some(json!({ "context": "advice" }))
        );
        assert_eq!(Generic.render("Stop", json!({})), None);
    }
}
