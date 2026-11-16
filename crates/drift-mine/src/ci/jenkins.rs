//! A `Jenkinsfile` at the repository's root.
//!
//! A Jenkinsfile is a Groovy program, and Drift does not run or parse Groovy. What
//! can be read soundly off its text is read: an `sh` step given one string literal
//! (`sh 'curl ... | sh'`, `sh(script: """ ... """)`) that hands a download to an
//! interpreter (`piped_download`, in the job named by the last `stage('...')` written
//! before it, `pipeline` where none is). The text of a literal is what the step runs,
//! whatever Groovy fills into a `${...}` of it. Every other risk is unknown, and the
//! file is listed as read in part ([`super::NotRead`]).

use std::path::Path;

use super::{Read, finding, line_at};
use crate::workflows::piped_download;

const FILE: &str = "Jenkinsfile";

pub(super) fn read(root: &Path, out: &mut Read) {
    let Some(text) = out.load(root, FILE) else {
        return;
    };
    out.not_read(
        FILE,
        "Groovy, read only for `sh` steps written as one string (a download handed to an interpreter); what else it runs is not read".to_string(),
    );
    let mut found = Vec::new();
    for (stage, at, literal) in sh_literals(&text) {
        if let Some(command) = piped_download(&literal) {
            let from = text[..at].lines().count().saturating_sub(1);
            found.push(finding(
                "piped_download",
                FILE,
                line_at(&text, from, command),
                stage.as_deref().unwrap_or("pipeline"),
                command,
            ));
        }
    }
    out.add(found);
}

/// A Groovy string literal starting at `at` (`'`, `"`, `'''` or `"""`): its text
/// (escapes taken off) and where it ends.
fn literal(text: &str, at: usize) -> Option<(String, usize)> {
    let rest = &text[at..];
    let quote = ["'''", "\"\"\"", "'", "\""]
        .into_iter()
        .find(|q| rest.starts_with(q))?;
    let body = &rest[quote.len()..];
    let mut out = String::new();
    let mut chars = body.char_indices();
    while let Some((i, c)) = chars.next() {
        if c == '\\' {
            if let Some((_, n)) = chars.next() {
                out.push(n);
            }
            continue;
        }
        if body[i..].starts_with(quote) {
            return Some((out, at + quote.len() + i + quote.len()));
        }
        // A one-line literal ends on its line.
        if c == '\n' && quote.len() == 1 {
            return None;
        }
        out.push(c);
    }
    None
}

/// Each `sh` step given one string literal, outside comments: the stage written last
/// before it, its byte offset, and the literal's text.
fn sh_literals(text: &str) -> Vec<(Option<String>, usize, String)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut stage: Option<String> = None;
    let mut i = 0;
    let word_at = |i: usize, w: &str| {
        text[i..].starts_with(w)
            && (i == 0
                || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_' || b[i - 1] == b'.'))
            && b.get(i + w.len())
                .is_none_or(|c| !(c.is_ascii_alphanumeric() || *c == b'_'))
    };
    // The literal an argument list starting at `j` opens with, past `(` and a
    // `script:` name.
    let argument = |mut j: usize| {
        let skip = |j: &mut usize| {
            while *j < b.len() && matches!(b[*j], b' ' | b'\t') {
                *j += 1;
            }
        };
        skip(&mut j);
        if b.get(j) == Some(&b'(') {
            j += 1;
            skip(&mut j);
        }
        if text[j..].starts_with("script:") {
            j += "script:".len();
            skip(&mut j);
        }
        literal(text, j)
    };
    while i < b.len() {
        let rest = &text[i..];
        if rest.starts_with("//") {
            i += rest.find('\n').unwrap_or(rest.len());
            continue;
        }
        if rest.starts_with("/*") {
            i += rest.find("*/").map_or(rest.len(), |e| e + 2);
            continue;
        }
        if matches!(b[i], b'\'' | b'"') {
            match literal(text, i) {
                Some((_, end)) => i = end,
                None => i += 1,
            }
            continue;
        }
        if word_at(i, "stage") {
            if let Some((name, end)) = argument(i + "stage".len()) {
                stage = Some(name);
                i = end;
                continue;
            }
        } else if word_at(i, "sh")
            && let Some((script, end)) = argument(i + "sh".len())
        {
            out.push((stage.clone(), i, script));
            i = end;
            continue;
        }
        i += text[i..].chars().next().map_or(1, char::len_utf8);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sh_steps_written_as_one_string_are_read_outside_comments() {
        let text = "pipeline {\n  stages {\n    stage('Build') {\n      steps {\n        sh 'curl -fsSL https://x/i.sh | bash'\n        // sh 'curl https://x | sh'\n        sh(script: \"\"\"\n          set -e\n          wget -qO- https://y | sh\n        \"\"\", returnStdout: true)\n        sh label: 'x', script: 'make'\n        echo 'sh \"no\"'\n      }\n    }\n  }\n}\n";
        let found: Vec<(Option<String>, String)> = sh_literals(text)
            .into_iter()
            .map(|(s, _, l)| (s, l.trim().to_string()))
            .collect();
        assert_eq!(
            found,
            [
                (
                    Some("Build".to_string()),
                    "curl -fsSL https://x/i.sh | bash".to_string()
                ),
                (
                    Some("Build".to_string()),
                    "set -e\n          wget -qO- https://y | sh".to_string()
                ),
            ]
        );
    }
}
