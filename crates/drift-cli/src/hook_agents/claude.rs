//! `drift hook claude <event>`: Claude Code (code.claude.com/docs/en/hooks), the
//! core's own form. Its payload is the core's input and the core's output is its answer,
//! unchanged: what Claude Code got before there were adapters, byte for byte.

use serde_json::Value;

use super::Adapter;

pub struct ClaudeCode;

impl Adapter for ClaudeCode {
    fn core_input(&self, event: &str, payload: Value) -> Result<(String, Value), String> {
        Ok((event.to_string(), payload))
    }

    fn render(&self, _core_event: &str, out: Value) -> Option<Value> {
        Some(out)
    }
}
