//! Writing `drift setup`'s answers into `.drift/config.yaml` in place, line by line,
//! so a person's own content and comments stay as they wrote them.
//!
//! Only block-style YAML is edited: a key on a line of its own (`security:`) whose
//! children are indented below it. Each entry `drift setup` writes is one line, with a
//! comment line above it that starts `# drift setup <id>`: that pair is what
//! [`remove`] takes out again. A key written on one line with its value
//! (`security: {not_deployed: [a]}`, `not_deployed: [a, b]`) is not edited: the
//! caller is told what to add by hand. Every edit is checked by parsing the file before
//! and after: the result must be the same settings with the one entry added.

use anyhow::bail;
use serde_json::Value;

/// What one written line adds to the settings, for the check.
#[derive(Debug, Clone, PartialEq)]
pub enum Entry {
    /// An item of the list at the path.
    Item(Value),
    /// A key and value of the mapping at the path.
    Pair(String, Value),
}

fn indent(l: &str) -> usize {
    l.len() - l.trim_start().len()
}

/// Blank or a comment: says nothing of the structure.
fn meta(l: &str) -> bool {
    let t = l.trim();
    t.is_empty() || t.starts_with('#')
}

/// What follows `key:` on a line that is that key at `ind`, comment taken out:
/// `None` when the line is not that key.
fn key_value<'a>(l: &'a str, ind: usize, key: &str) -> Option<&'a str> {
    if meta(l) || indent(l) != ind {
        return None;
    }
    let t = l.trim_start();
    let rest = t
        .strip_prefix(key)
        .or_else(|| t.strip_prefix(&format!("\"{key}\"")))
        .or_else(|| t.strip_prefix(&format!("'{key}'")))?
        .strip_prefix(':')?;
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let rest = rest.trim();
    Some(if rest.starts_with('#') { "" } else { rest })
}

/// The end (exclusive) of the block of the key on line `i`: its children are the lines
/// below indented more, and a list written at the key's own indent (`key:\n- a`).
fn block_end(lines: &[Option<String>], i: usize) -> usize {
    let Some(head) = lines[i].as_deref() else {
        return i + 1;
    };
    let ind = indent(head);
    let item = |l: &str| l.trim_start().starts_with("- ") || l.trim() == "-";
    // A list written at the key's own indent belongs to it.
    let own_list = lines[i + 1..]
        .iter()
        .flatten()
        .find(|l| !meta(l))
        .is_some_and(|l| indent(l) == ind && item(l));
    let mut end = i + 1;
    for (j, l) in lines.iter().enumerate().skip(i + 1) {
        let Some(l) = l.as_deref() else {
            continue;
        };
        if meta(l) {
            continue;
        }
        let li = indent(l);
        if li > ind || (own_list && li == ind && item(l)) {
            end = j + 1;
        } else {
            break;
        }
    }
    end
}

/// The indent of the first child line of the block `[from, to)`, if any.
fn child_indent(lines: &[Option<String>], from: usize, to: usize) -> Option<usize> {
    lines[from..to]
        .iter()
        .flatten()
        .find(|l| !meta(l))
        .map(|l| indent(l))
}

/// How the file ends the lines Drift adds (`\r\n` only where every line of it does),
/// and whether its last line is ended: kept by every edit. Each line already there
/// keeps its own ending ([`endings`]).
#[derive(Debug, Clone, Copy)]
struct Layout {
    eol: &'static str,
    ended: bool,
}

impl Layout {
    fn of(text: &str) -> Layout {
        let crlf = text.matches("\r\n").count();
        Layout {
            eol: if crlf > 0 && crlf == text.matches('\n').count() {
                "\r\n"
            } else {
                "\n"
            },
            ended: text.is_empty() || text.ends_with('\n'),
        }
    }
}

fn split(text: &str) -> Vec<Option<String>> {
    text.lines().map(|l| Some(l.to_string())).collect()
}

/// The ending of each line of `text`, beside [`split`]'s lines: "" for a last line
/// that has none, and for a line Drift adds (it gets [`Layout::eol`]).
fn endings(text: &str) -> Vec<&'static str> {
    text.split_inclusive('\n')
        .map(|l| {
            if l.ends_with("\r\n") {
                "\r\n"
            } else if l.ends_with('\n') {
                "\n"
            } else {
                ""
            }
        })
        .collect()
}

fn join(lines: &[Option<String>], ends: &[&str], layout: Layout) -> String {
    let kept: Vec<(&str, &str)> = lines
        .iter()
        .zip(ends)
        .filter_map(|(l, e)| l.as_deref().map(|l| (l, *e)))
        .collect();
    let mut out = String::new();
    for (i, (l, e)) in kept.iter().enumerate() {
        out.push_str(l);
        if i + 1 < kept.len() || layout.ended {
            out.push_str(if e.is_empty() { layout.eol } else { e });
        }
    }
    out
}

/// The settings `text` holds, `{}` for an empty file.
pub fn parse(text: &str) -> anyhow::Result<Value> {
    if text.trim().is_empty() {
        return Ok(Value::Object(Default::default()));
    }
    let v: Value = drift_mine::policy::yaml_value(text)?;
    match v {
        Value::Object(_) => Ok(v),
        Value::Null => Ok(Value::Object(Default::default())),
        _ => bail!("expected a mapping of settings"),
    }
}

/// `v` with `entry` added at `path`, as the check expects it.
fn with_entry(mut v: Value, path: &[&str], entry: &Entry) -> Option<Value> {
    let mut at = &mut v;
    for k in path {
        let map = at.as_object_mut()?;
        at = map
            .entry(k.to_string())
            .or_insert_with(|| match (path.last(), entry) {
                (Some(last), Entry::Item(_)) if last == k => Value::Array(Vec::new()),
                _ => Value::Object(Default::default()),
            });
    }
    match entry {
        Entry::Item(item) => at.as_array_mut()?.push(item.clone()),
        Entry::Pair(k, val) => {
            at.as_object_mut()?.insert(k.clone(), val.clone());
        }
    }
    Some(v)
}

/// Whether the settings already hold `entry` at `path`.
pub fn holds(v: &Value, path: &[&str], entry: &Entry) -> bool {
    let mut at = v;
    for k in path {
        match at.get(k) {
            Some(next) => at = next,
            None => return false,
        }
    }
    match entry {
        Entry::Item(item) => at.as_array().is_some_and(|a| a.contains(item)),
        Entry::Pair(k, val) => at.get(k) == Some(val),
    }
}

/// `text` with `comment` (a `# ...` line) and `line` (the entry, unindented) written
/// under `path`, the keys of the path that are missing added. An error, and nothing
/// written, where the file cannot be edited safely.
pub fn insert(
    text: &str,
    path: &[&str],
    comment: &str,
    line: &str,
    entry: &Entry,
) -> anyhow::Result<String> {
    let before = parse(text)?;
    let layout = Layout::of(text);
    let mut lines = split(text);
    let mut ends = endings(text);
    let (mut from, mut to, mut ind) = (0usize, lines.len(), 0usize);
    // Where the block being looked into ends: its last line that says something.
    let mut last: Option<usize> = None;
    let mut missing: &[&str] = &[];
    for (depth, key) in path.iter().enumerate() {
        let found = (from..to).find_map(|i| {
            key_value(lines[i].as_deref().unwrap_or("#"), ind, key).map(|v| (i, v.to_string()))
        });
        match found {
            Some((i, value)) => {
                if !value.is_empty() {
                    bail!(
                        "`{}` is written on one line (`{}`), which drift setup does not edit",
                        path[..=depth].join("."),
                        lines[i].as_deref().unwrap_or_default().trim()
                    );
                }
                let end = block_end(&lines, i);
                let child = child_indent(&lines, i + 1, end).unwrap_or(ind + 2);
                last = (i + 1..end)
                    .rev()
                    .find(|&j| lines[j].as_deref().is_some_and(|l| !meta(l)))
                    .or(Some(i));
                from = i + 1;
                to = end;
                ind = child;
            }
            None => {
                missing = &path[depth..];
                break;
            }
        }
    }
    let mut add: Vec<String> = Vec::new();
    let mut at_ind = ind;
    for (j, key) in missing.iter().enumerate() {
        add.push(format!("{}{key}:", " ".repeat(ind + 2 * j)));
        at_ind = ind + 2 * (j + 1);
    }
    add.push(format!("{}{comment}", " ".repeat(at_ind)));
    add.push(format!("{}{line}", " ".repeat(at_ind)));
    let at = match last {
        Some(l) => l + 1,
        None => {
            // A new top-level key: at the end of the file, after a blank line.
            while lines
                .last()
                .is_some_and(|l| l.as_deref().is_some_and(|l| l.trim().is_empty()))
            {
                lines.pop();
                ends.pop();
            }
            if !lines.is_empty() {
                add.insert(0, String::new());
            }
            lines.len()
        }
    };
    for (k, l) in add.into_iter().enumerate() {
        lines.insert(at + k, Some(l));
        ends.insert(at + k, "");
    }
    let out = join(&lines, &ends, layout);
    let expected = with_entry(before, path, entry);
    let after = parse(&out).ok();
    if expected.is_none() || after != expected {
        bail!("the file would not read back as the same settings with the new entry");
    }
    Ok(out)
}

/// One entry `drift setup` wrote: the keys above it and what it adds.
pub type Written = (Vec<String>, Entry);

fn is_tag(l: &str, tag: &str) -> bool {
    let t = l.trim_start();
    t == tag || t.starts_with(&format!("{tag} ")) || t.starts_with(&format!("{tag}:"))
}

fn is_item(l: &str) -> bool {
    let t = l.trim_start();
    t.starts_with("- ") || t == "-"
}

/// A key line without the comment at its end (`setup:  # answers` is `setup:`): a `#`
/// at the start or after a space or tab, past a quoted key.
fn without_comment(t: &str) -> &str {
    let from = match t.chars().next() {
        Some(q @ ('"' | '\'')) => t[1..].find(q).map_or(t.len(), |e| e + 2),
        _ => 0,
    };
    let cut = t[from..]
        .char_indices()
        .find(|&(i, c)| c == '#' && (from + i == 0 || t[..from + i].ends_with([' ', '\t'])))
        .map_or(t.len(), |(i, _)| from + i);
    t[..cut].trim_end()
}

/// The entry on line `j` with the keys above it and their lines: one list item or one
/// `key: value` with its value on the line, at `ind`. `None` for anything else.
fn entry_at(lines: &[Option<String>], j: usize, ind: usize) -> Option<(Written, Vec<usize>)> {
    let l = lines.get(j)?.as_deref()?;
    if meta(l) || indent(l) != ind {
        return None;
    }
    let t = l.trim();
    let item = is_item(l);
    let entry = if item {
        Entry::Item(drift_mine::policy::yaml_value(t.trim_start_matches('-').trim()).ok()?)
    } else {
        let v = drift_mine::policy::yaml_value(t).ok()?;
        let map = v.as_object()?;
        let (k, v) = map.iter().next().filter(|_| map.len() == 1)?;
        if v.is_null() {
            return None;
        }
        Entry::Pair(k.clone(), v.clone())
    };
    // The keys above it: a list at its key's own indent has the key beside it.
    let (mut path, mut at) = (Vec::new(), Vec::new());
    let (mut ind, mut sibling_items) = (ind, item);
    for k in (0..j).rev() {
        let Some(l) = lines[k].as_deref() else {
            continue;
        };
        if meta(l) || indent(l) > ind {
            continue;
        }
        if indent(l) == ind && (!sibling_items || is_item(l)) {
            continue;
        }
        let key = without_comment(l.trim()).strip_suffix(':')?;
        let key = key.trim_matches('"').trim_matches('\'');
        path.push(key.to_string());
        at.push(k);
        ind = indent(l);
        sibling_items = false;
        if ind == 0 {
            break;
        }
    }
    if ind != 0 {
        return None;
    }
    path.reverse();
    Some(((path, entry), at))
}

/// The entries below each `tag` line, as [`remove_tagged`] reads them.
pub fn tagged(text: &str, tag: &str) -> Vec<Written> {
    let lines = split(text);
    (0..lines.len())
        .filter(|&i| lines[i].as_deref().is_some_and(|l| is_tag(l, tag)))
        .filter_map(|i| {
            let ind = indent(lines[i].as_deref().unwrap_or_default());
            entry_at(&lines, i + 1, ind).map(|(w, _)| w)
        })
        .collect()
}

/// `text` without what `drift setup` wrote for `id` ([`remove_tagged`] of its tag).
pub fn remove(
    text: &str,
    id: &str,
    wrote: &dyn Fn(&[String], &Entry) -> Option<bool>,
) -> anyhow::Result<String> {
    remove_tagged(text, &format!("# drift setup {id}"), wrote)
}

/// `text` without the lines `drift setup` wrote under `tag` (a whole word): each tag
/// line and the line below it, which must be an entry `wrote` says Drift wrote
/// (`Some`), taken out where it says `Some(true)`; a key
/// that held nothing else and is left empty goes too. An error, and nothing taken
/// out, where a tag has anything else below it (a person's own line, or nothing: what
/// Drift wrote was edited by hand), and where the result would not read back as the
/// settings before without exactly those entries.
pub fn remove_tagged(
    text: &str,
    tag: &str,
    wrote: &dyn Fn(&[String], &Entry) -> Option<bool>,
) -> anyhow::Result<String> {
    let before = parse(text)?;
    let layout = Layout::of(text);
    let mut lines = split(text);
    let ends = endings(text);
    let mut parents: Vec<usize> = Vec::new();
    let mut removed: Vec<Written> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let Some(l) = lines[i].as_deref().filter(|l| is_tag(l, tag)) else {
            i += 1;
            continue;
        };
        let ind = indent(l);
        let found = entry_at(&lines, i + 1, ind);
        match found
            .as_ref()
            .and_then(|((path, entry), _)| wrote(path, entry))
        {
            Some(true) => {
                let Some(((path, entry), at)) = found else {
                    unreachable!()
                };
                lines[i] = None;
                lines[i + 1] = None;
                parents.extend(at);
                removed.push((path, entry));
                i += 2;
            }
            // Drift's own, of another part of the record: it stays.
            Some(false) => i += 2,
            // A line of the person's below Drift's comment, or none: nothing is taken
            // out.
            _ => bail!(
                "{} line {} is not what Drift wrote for {} (it was edited by hand): Drift takes out only its own lines, so nothing was changed; edit that entry yourself",
                drift_mine::policy::CONFIG_FILE,
                i + 2,
                tag.rsplit(' ').next().unwrap_or(tag)
            ),
        }
    }
    // Deepest first: a key with nothing left below it goes.
    parents.sort_by_key(|&p| std::cmp::Reverse(indent(lines[p].as_deref().unwrap_or_default())));
    parents.dedup();
    for p in parents {
        let Some(head) = lines[p].clone() else {
            continue;
        };
        if !head.trim_end().ends_with(':') {
            continue;
        }
        let end = block_end(&lines, p);
        let empty = lines[p + 1..end]
            .iter()
            .flatten()
            .all(|l| l.trim().is_empty());
        if empty {
            lines[p] = None;
        }
    }
    // A blank line left at the end by a key that went.
    while lines
        .iter()
        .rev()
        .find(|l| l.is_some())
        .is_some_and(|l| l.as_deref().is_some_and(|l| l.trim().is_empty()))
    {
        let last = lines.iter().rposition(|l| l.is_some()).unwrap_or_default();
        lines[last] = None;
    }
    let out = join(&lines, &ends, layout);
    let mut expected = before;
    for (path, entry) in &removed {
        let path: Vec<&str> = path.iter().map(String::as_str).collect();
        expected = without_entry(expected, &path, entry)
            .ok_or_else(|| anyhow::anyhow!("an entry drift setup wrote does not read back"))?;
    }
    if normal(parse(&out)?) != normal(expected) {
        bail!("taking out what drift setup wrote would change more than its own lines");
    }
    Ok(out)
}

/// `v` with one `entry` at `path` taken out.
fn without_entry(mut v: Value, path: &[&str], entry: &Entry) -> Option<Value> {
    let mut at = &mut v;
    for k in path {
        at = at.get_mut(*k)?;
    }
    match entry {
        Entry::Item(item) => {
            let a = at.as_array_mut()?;
            let i = a.iter().position(|x| x == item)?;
            a.remove(i);
        }
        Entry::Pair(k, val) => {
            let m = at.as_object_mut()?;
            if m.get(k) != Some(val) {
                return None;
            }
            m.remove(k);
        }
    }
    Some(v)
}

/// Settings compared as Drift reads them: an empty or null value is no value.
fn normal(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| (k, normal(v)))
                .filter(|(_, v)| {
                    !(v.is_null()
                        || v.as_object().is_some_and(|o| o.is_empty())
                        || v.as_array().is_some_and(|a| a.is_empty()))
                })
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.into_iter().map(normal).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HAND: &str = "# Our settings: keep these comments.\nexperimental: [wiring]\n\nsecurity:\n  # The gateway's services.\n  internal:\n    - services/worker   # behind the gateway\n\npackages:\n  exclude: [legacy]\n";

    fn any(_: &[String], _: &Entry) -> Option<bool> {
        Some(true)
    }
    const ANY: &dyn Fn(&[String], &Entry) -> Option<bool> = &any;

    fn item(s: &str) -> Entry {
        Entry::Item(json!(s))
    }

    #[test]
    fn an_entry_goes_under_its_key_and_the_rest_stays_byte_for_byte() {
        let out = insert(
            HAND,
            &["security", "not_deployed"],
            "# drift setup S-1a2b (2026-11-11): only for tests",
            "- \"e2e/docker-compose.yml\"",
            &item("e2e/docker-compose.yml"),
        )
        .unwrap();
        assert_eq!(
            out,
            HAND.replace(
                "    - services/worker   # behind the gateway\n",
                "    - services/worker   # behind the gateway\n  not_deployed:\n    # drift setup S-1a2b (2026-11-11): only for tests\n    - \"e2e/docker-compose.yml\"\n"
            )
        );
        // Taken out again, the file is the person's, byte for byte.
        assert_eq!(remove(&out, "S-1a2b", ANY).unwrap(), HAND);
    }

    #[test]
    fn a_second_entry_joins_the_list_and_a_new_key_goes_at_the_end() {
        let one = insert(
            HAND,
            &["security", "internal"],
            "# drift setup S-0001 (d): x",
            "- \"b\"",
            &item("b"),
        )
        .unwrap();
        assert!(one.contains("    - services/worker   # behind the gateway\n    # drift setup S-0001 (d): x\n    - \"b\"\n"), "{one}");
        let two = insert(
            &one,
            &["practices", "authz"],
            "# drift setup S-0002 (d): y",
            "\"a.py#f\": \"tenant check\"",
            &Entry::Pair("a.py#f".into(), json!("tenant check")),
        )
        .unwrap();
        assert!(two.ends_with("  exclude: [legacy]\n\npractices:\n  authz:\n    # drift setup S-0002 (d): y\n    \"a.py#f\": \"tenant check\"\n"), "{two}");
        assert_eq!(
            remove(&remove(&two, "S-0002", ANY).unwrap(), "S-0001", ANY).unwrap(),
            HAND
        );
    }

    #[test]
    fn a_key_written_on_one_line_is_not_edited() {
        let err = insert(
            HAND,
            &["packages", "exclude"],
            "# drift setup S-0003 (d): z",
            "- \"c\"",
            &item("c"),
        )
        .unwrap_err();
        assert!(err.to_string().contains("written on one line"), "{err}");
        let err = insert(
            "security: {internal: [a]}\n",
            &["security", "not_deployed"],
            "# drift setup S-0003 (d): z",
            "- \"c\"",
            &item("c"),
        )
        .unwrap_err();
        assert!(err.to_string().contains("written on one line"), "{err}");
    }

    #[test]
    fn an_empty_file_gets_the_keys() {
        let out = insert(
            "",
            &["security", "not_deployed"],
            "# drift setup S-0004 (d): w",
            "- \"x\"",
            &item("x"),
        )
        .unwrap();
        assert_eq!(
            out,
            "security:\n  not_deployed:\n    # drift setup S-0004 (d): w\n    - \"x\"\n"
        );
        assert_eq!(remove(&out, "S-0004", ANY).unwrap(), "");
    }

    #[test]
    fn a_comment_at_the_end_of_a_key_line_does_not_stop_taking_out() {
        let text = "# ours\nsetup:  # answers live here\n  S-0000: {answer: \"skip\"}\n  \"a #b\":   # quoted\n    x: 1\n";
        for (path, id) in [
            (&["setup"][..], "S-0006"),
            (&["setup", "a #b"][..], "S-0007"),
        ] {
            let out = insert(
                text,
                path,
                &format!("# drift setup {id} (d): u"),
                &format!("{id}: {{answer: \"x\"}}"),
                &Entry::Pair(id.into(), json!({"answer": "x"})),
            )
            .unwrap();
            assert_eq!(
                tagged(&out, &format!("# drift setup {id}")),
                vec![(
                    path.iter().map(|k| k.to_string()).collect(),
                    Entry::Pair(id.into(), json!({"answer": "x"}))
                )],
                "{out}"
            );
            assert_eq!(remove(&out, id, ANY).unwrap(), text, "{out}");
        }
    }

    #[test]
    fn each_line_keeps_its_own_ending() {
        // One CRLF line: the file's other lines and the lines Drift adds end in LF.
        let mixed = "# a note\r\nsecurity:\n  internal:\n    - a\n";
        let out = insert(
            mixed,
            &["security", "internal"],
            "# drift setup S-0008 (d): t",
            "- \"b\"",
            &item("b"),
        )
        .unwrap();
        assert_eq!(
            out,
            "# a note\r\nsecurity:\n  internal:\n    - a\n    # drift setup S-0008 (d): t\n    - \"b\"\n"
        );
        assert_eq!(remove(&out, "S-0008", ANY).unwrap(), mixed);
        // Every line CRLF: so are the lines Drift adds.
        let crlf = mixed.replace("\r\n", "\n").replace('\n', "\r\n");
        let out = insert(
            &crlf,
            &["practices", "authz"],
            "# drift setup S-0009 (d): s",
            "\"a.py#f\": \"tenant check\"",
            &Entry::Pair("a.py#f".into(), json!("tenant check")),
        )
        .unwrap();
        assert!(!out.replace("\r\n", "").contains('\n'), "{out:?}");
        assert_eq!(remove(&out, "S-0009", ANY).unwrap(), crlf);
        // A last line with no ending stays without one.
        let open = "security:\r\n  internal:\r\n    - a";
        let out = insert(
            open,
            &["security", "internal"],
            "# drift setup S-000a (d): r",
            "- \"b\"",
            &item("b"),
        )
        .unwrap();
        assert_eq!(
            out,
            "security:\r\n  internal:\r\n    - a\r\n    # drift setup S-000a (d): r\r\n    - \"b\""
        );
        assert_eq!(remove(&out, "S-000a", ANY).unwrap(), open);
    }

    #[test]
    fn a_list_at_the_keys_own_indent_is_extended() {
        let text = "security:\n  not_deployed:\n  - a\n  internal:\n  - b\n";
        let out = insert(
            text,
            &["security", "not_deployed"],
            "# drift setup S-0005 (d): v",
            "- \"c\"",
            &item("c"),
        )
        .unwrap();
        assert_eq!(
            out,
            "security:\n  not_deployed:\n  - a\n  # drift setup S-0005 (d): v\n  - \"c\"\n  internal:\n  - b\n"
        );
    }
}
