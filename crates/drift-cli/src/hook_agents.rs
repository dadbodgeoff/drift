//! The agent-neutral face of Drift's hooks: `drift hook <agent> <event>`.
//!
//! The per-event functions in [`crate::agent`] were written for Claude Code and read and
//! write its hook JSON; that JSON stays the core's own form, so Claude Code's behaviour
//! is the core's, byte for byte. Every other agent goes through an [`Adapter`]: it lowers
//! the agent's payload to a [`Call`] (what the core reads) and turns the core's output into
//! an [`Answer`] (all the core can say) in the agent's own words. The rules before an
//! edit, the advice after it, the refusal of writes to Drift's own files and the one
//! end-of-turn block then come from one implementation for every agent.
//!
//! Adding an agent is one file under `hook_agents/` and one value of `Agent` in
//! `main.rs`. Add one only for a hook format checked field by field against that agent's
//! own documentation: a guessed field fails open in silence (an edit nobody primed, a
//! block nobody saw), which reads to the person as an agent that follows the rules.

pub mod claude;
pub mod generic;

use serde_json::{Map, Value, json};

/// One agent's hook protocol.
pub trait Adapter {
    /// The core's event name and input for this agent's `event` and payload, or `Err`
    /// with a note for the person when it is not one this adapter reads: the hook then
    /// answers with that note alone and lets the agent go on (it fails open).
    fn core_input(&self, event: &str, payload: Value) -> Result<(String, Value), String>;

    /// The agent's form of the core's output for `core_event`; `None` prints nothing.
    fn render(&self, core_event: &str, out: Value) -> Option<Value>;
}

/// The moments the core answers, whatever the agent calls them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// A session starts, resumes, is cleared or compacted: the baseline and the brief.
    SessionStart,
    /// Before a file is written or edited: its rules, or a refusal for Drift's own files.
    BeforeEdit,
    /// After a file was written or edited: what the edit introduced, as advice.
    AfterEdit,
    /// Before a shell command: a refusal for one that writes Drift's files or changes
    /// its policy, an approval for Drift's read-only lookups.
    BeforeShell,
    /// Before a content or file-name search: a pointer to `drift card` where it helps.
    BeforeSearch,
    /// The person sends a prompt: advice the last end of turn queued.
    PromptSubmit,
    /// The agent ends its turn: the one place a hook blocks.
    EndOfTurn,
    /// A session ends: hands the baseline to the next one on a clear.
    SessionEnd,
}

impl Event {
    /// The core's (Claude Code's) event name.
    pub fn core_name(self) -> &'static str {
        match self {
            Event::SessionStart => "SessionStart",
            Event::BeforeEdit | Event::BeforeShell | Event::BeforeSearch => "PreToolUse",
            Event::AfterEdit => "PostToolUse",
            Event::PromptSubmit => "UserPromptSubmit",
            Event::EndOfTurn => "Stop",
            Event::SessionEnd => "SessionEnd",
        }
    }
}

/// A search, as the search hint reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Search {
    /// A content search: its regular expression, and the file glob it is limited to.
    Content {
        pattern: String,
        glob: Option<String>,
    },
    /// A search for file names by glob.
    Files { pattern: String },
}

/// What the core reads of one hook event. Unset fields are left out of the core's input,
/// as an agent that does not send them would.
#[derive(Clone, Debug)]
pub struct Call {
    pub event: Event,
    /// The agent's session (conversation) id; one state file per id.
    pub session_id: Option<String>,
    /// The directory the agent works in; relative paths resolve against it.
    pub cwd: Option<String>,
    /// SessionStart: `startup`, `resume`, `clear` or `compact`. SessionEnd: why it
    /// ended (`clear` hands the baseline on).
    pub source: Option<String>,
    /// BeforeEdit and AfterEdit: the file.
    pub file_path: Option<String>,
    /// BeforeEdit of a whole new file: its content, so the rules said follow what it declares.
    pub content: Option<String>,
    /// BeforeShell: the command line.
    pub command: Option<String>,
    /// BeforeSearch: the search.
    pub search: Option<Search>,
    /// BeforeSearch: the directory searched, when not `cwd`.
    pub search_path: Option<String>,
    /// EndOfTurn: whether this turn goes on because a hook blocked its end (the loop guard).
    pub after_block: bool,
}

impl Call {
    pub fn new(event: Event) -> Call {
        Call {
            event,
            session_id: None,
            cwd: None,
            source: None,
            file_path: None,
            content: None,
            command: None,
            search: None,
            search_path: None,
            after_block: false,
        }
    }

    /// The core's event name and input (the fields of Claude Code's hook JSON the core reads).
    pub fn core_input(&self) -> (String, Value) {
        let name = self.event.core_name();
        let mut v = Map::new();
        v.insert("hook_event_name".into(), json!(name));
        put(&mut v, "session_id", &self.session_id);
        put(&mut v, "cwd", &self.cwd);
        let mut ti = Map::new();
        let tool = match self.event {
            Event::SessionStart => {
                put(&mut v, "source", &self.source);
                None
            }
            Event::SessionEnd => {
                put(&mut v, "reason", &self.source);
                None
            }
            Event::BeforeEdit | Event::AfterEdit => {
                put(&mut ti, "file_path", &self.file_path);
                put(&mut ti, "content", &self.content);
                // A whole new file is a Write; anything else an Edit (the core reads the
                // file from disk after it, and its content, when given, before it).
                Some(if self.content.is_some() {
                    "Write"
                } else {
                    "Edit"
                })
            }
            Event::BeforeShell => {
                put(&mut ti, "command", &self.command);
                Some("Bash")
            }
            Event::BeforeSearch => {
                put(&mut ti, "path", &self.search_path);
                Some(match &self.search {
                    Some(Search::Content { pattern, glob }) => {
                        ti.insert("pattern".into(), json!(pattern));
                        put(&mut ti, "glob", glob);
                        "Grep"
                    }
                    Some(Search::Files { pattern }) => {
                        ti.insert("pattern".into(), json!(pattern));
                        "Glob"
                    }
                    None => "Grep",
                })
            }
            Event::EndOfTurn => {
                v.insert("stop_hook_active".into(), json!(self.after_block));
                None
            }
            Event::PromptSubmit => None,
        };
        if let Some(tool) = tool {
            v.insert("tool_name".into(), json!(tool));
            v.insert("tool_input".into(), Value::Object(ti));
        }
        (name.to_string(), Value::Object(v))
    }
}

/// `m[k] = s`, when `s` is set.
fn put(m: &mut Map<String, Value>, k: &str, s: &Option<String>) {
    if let Some(s) = s {
        m.insert(k.into(), json!(s));
    }
}

/// A tool-permission decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    /// Run it without asking the person (Drift's read-only lookups only).
    Allow,
    /// Refuse it, with the reason for the agent.
    Deny,
}

/// Everything the core can answer, read from its output. An empty answer prints nothing.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Answer {
    /// Before a tool: allow or refuse it.
    pub permission: Option<Permission>,
    /// Why, for the agent, beside `permission`.
    pub reason: Option<String>,
    /// Text for the agent's context (rules, advice, a brief).
    pub context: Option<String>,
    /// A message for the person, not the agent.
    pub message: Option<String>,
    /// At the end of a turn: the turn may not end yet; the reason is for the agent.
    pub block_stop: Option<String>,
}

impl Answer {
    /// The answer in the core's output. A decision the core never makes reads as none,
    /// so an adapter never refuses or blocks on something it does not know.
    pub fn from_core(out: &Value) -> Answer {
        let s = |v: &Value| v.as_str().map(String::from);
        let specific = out.get("hookSpecificOutput");
        let field = |k: &str| specific.and_then(|o| o.get(k)).and_then(s);
        let permission = match field("permissionDecision").as_deref() {
            Some("allow") => Some(Permission::Allow),
            Some("deny") => Some(Permission::Deny),
            _ => None,
        };
        let block_stop = (out.get("decision").and_then(Value::as_str) == Some("block"))
            .then(|| out.get("reason").and_then(s).unwrap_or_default());
        Answer {
            permission,
            reason: permission.and_then(|_| field("permissionDecisionReason")),
            context: field("additionalContext"),
            message: out.get("systemMessage").and_then(s),
            block_stop,
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == Answer::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Claude Code's form of an answer, as the core writes it: what the test below
    /// compares against to show that [`Answer`] keeps all of it.
    fn claude_form(core_event: &str, a: &Answer) -> Value {
        let mut out = Map::new();
        if let Some(reason) = &a.block_stop {
            out.insert("decision".into(), json!("block"));
            out.insert("reason".into(), json!(reason));
        }
        let mut specific = Map::new();
        if let Some(p) = a.permission {
            let p = if p == Permission::Allow {
                "allow"
            } else {
                "deny"
            };
            specific.insert("permissionDecision".into(), json!(p));
        }
        if let Some(r) = &a.reason {
            specific.insert("permissionDecisionReason".into(), json!(r));
        }
        if let Some(c) = &a.context {
            specific.insert("additionalContext".into(), json!(c));
        }
        if !specific.is_empty() {
            specific.insert("hookEventName".into(), json!(core_event));
            out.insert("hookSpecificOutput".into(), Value::Object(specific));
        }
        if let Some(m) = &a.message {
            out.insert("systemMessage".into(), json!(m));
        }
        Value::Object(out)
    }

    /// Pins: every shape of output the core writes (one of each `json!` answer in
    /// agent.rs and lookup.rs) reads into an [`Answer`] that says all of it, so an adapter
    /// built on [`Answer`] loses nothing Claude Code gets.
    #[test]
    fn every_core_answer_shape_survives_the_neutral_answer() {
        let shapes = [
            ("SessionStart", json!({ "systemMessage": "note" })),
            (
                "SessionStart",
                json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "brief" }, "systemMessage": "note" }),
            ),
            (
                "PreToolUse",
                json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "why" } }),
            ),
            (
                "PreToolUse",
                json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "lookup" } }),
            ),
            (
                "PreToolUse",
                json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "rules" } }),
            ),
            (
                "PostToolUse",
                json!({ "systemMessage": "not checked", "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "advice" } }),
            ),
            (
                "UserPromptSubmit",
                json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "queued" } }),
            ),
            (
                "Stop",
                json!({ "decision": "block", "reason": "fix it", "systemMessage": "to the person" }),
            ),
            ("Stop", json!({ "decision": "block", "reason": "fix it" })),
            ("Stop", json!({ "systemMessage": "left for review" })),
        ];
        for (event, out) in shapes {
            let a = Answer::from_core(&out);
            assert!(!a.is_empty(), "{out}");
            assert_eq!(claude_form(event, &a), out, "{event}");
        }
        assert!(Answer::from_core(&json!({})).is_empty());
    }

    /// Pins: a decision the core never writes (`ask`, or a typo) is no decision at all,
    /// so no adapter refuses a tool on it.
    #[test]
    fn an_unknown_decision_is_none() {
        let a = Answer::from_core(
            &json!({ "hookSpecificOutput": { "permissionDecision": "ask", "permissionDecisionReason": "?" } }),
        );
        assert_eq!(a, Answer::default());
    }

    /// Pins: each neutral event lowers to the core event and fields the per-event
    /// functions read (tool names and keys of Claude Code's payload).
    #[test]
    fn calls_lower_to_the_core_input() {
        let mut c = Call::new(Event::BeforeEdit);
        c.session_id = Some("s".into());
        c.file_path = Some("/r/a.ts".into());
        assert_eq!(
            c.core_input(),
            (
                "PreToolUse".to_string(),
                json!({ "hook_event_name": "PreToolUse", "session_id": "s", "tool_name": "Edit", "tool_input": { "file_path": "/r/a.ts" } })
            )
        );
        c.content = Some("x".into());
        assert_eq!(c.core_input().1["tool_name"], "Write");
        assert_eq!(c.core_input().1["tool_input"]["content"], "x");

        let mut c = Call::new(Event::BeforeShell);
        c.command = Some("ls".into());
        assert_eq!(c.core_input().1["tool_name"], "Bash");
        assert_eq!(c.core_input().1["tool_input"]["command"], "ls");

        let mut c = Call::new(Event::BeforeSearch);
        c.search = Some(Search::Files {
            pattern: "**/auth*".into(),
        });
        assert_eq!(c.core_input().1["tool_name"], "Glob");

        let mut c = Call::new(Event::EndOfTurn);
        c.after_block = true;
        let (name, v) = c.core_input();
        assert_eq!(
            (name.as_str(), &v["stop_hook_active"]),
            ("Stop", &json!(true))
        );

        let mut c = Call::new(Event::SessionEnd);
        c.source = Some("clear".into());
        assert_eq!(c.core_input().1["reason"], "clear");
    }
}
