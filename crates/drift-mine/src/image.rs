//! What a Dockerfile says a container starts with, and where a file of the image comes
//! from in the build context, so that a start script (`CMD ["./entrypoint.sh"]`) can be
//! read where it is in the repository ([`crate::security::Boundaries`]).
//!
//! Read: stages (`FROM ... AS name`), `WORKDIR`, `COPY` (from the context or
//! `--from=<stage>`), `ENTRYPOINT` and `CMD` in either form. Everything else is passed
//! over, except a `RUN` that names the file being traced and is not a `chmod`: it may
//! write the file. A path with a variable or a pattern in it is not followed. What is
//! not read is an error with the reason, never a guess.

/// How many stages, and steps of a stage, are read.
const MAX_STEPS: usize = 2000;
/// How many `COPY --from` hops a file is traced through.
const MAX_HOPS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Op {
    Workdir(String),
    Copy {
        from: Option<String>,
        sources: Vec<String>,
        dest: String,
    },
    Run(String),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Stage {
    name: Option<String>,
    ops: Vec<Op>,
    entrypoint: Option<Vec<String>>,
    cmd: Option<Vec<String>>,
}

/// A Dockerfile, as far as it is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    stages: Vec<Stage>,
}

impl Image {
    /// None when `text` has no `FROM`, or more steps than are read.
    pub fn parse(text: &str) -> Option<Image> {
        let mut stages: Vec<Stage> = Vec::new();
        let joined = text.replace("\\\r\n", " ").replace("\\\n", " ");
        for (n, line) in joined.lines().map(str::trim).enumerate() {
            if n > MAX_STEPS * 4 {
                return None;
            }
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (instruction, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
            let rest = rest.trim();
            let instruction = instruction.to_uppercase();
            if instruction == "FROM" {
                let words: Vec<&str> = rest.split_whitespace().collect();
                let name = words
                    .iter()
                    .position(|w| w.eq_ignore_ascii_case("as"))
                    .and_then(|i| words.get(i + 1))
                    .map(|n| n.to_lowercase());
                stages.push(Stage {
                    name,
                    ..Stage::default()
                });
                if stages.len() > MAX_STEPS {
                    return None;
                }
                continue;
            }
            let stage = stages.last_mut()?;
            if stage.ops.len() > MAX_STEPS {
                return None;
            }
            match instruction.as_str() {
                "WORKDIR" => stage.ops.push(Op::Workdir(unquote(rest))),
                "COPY" | "ADD" => {
                    let mut from = None;
                    let mut words = words_of(rest);
                    words.retain(|w| match w.strip_prefix("--") {
                        Some(flag) => {
                            if let Some(f) = flag.strip_prefix("from=") {
                                from = Some(f.to_lowercase());
                            }
                            false
                        }
                        None => true,
                    });
                    // `ADD` may fetch or unpack: what it puts in place is not the file.
                    let dest = match (instruction.as_str(), words.pop()) {
                        ("COPY", Some(d)) if !words.is_empty() => d,
                        _ => {
                            stage.ops.push(Op::Run(rest.to_string()));
                            continue;
                        }
                    };
                    stage.ops.push(Op::Copy {
                        from,
                        sources: words,
                        dest,
                    });
                }
                "RUN" => stage.ops.push(Op::Run(rest.to_string())),
                "ENTRYPOINT" => stage.entrypoint = Some(words_of(rest)),
                "CMD" => stage.cmd = Some(words_of(rest)),
                _ => {}
            }
        }
        (!stages.is_empty()).then_some(Image { stages })
    }

    /// The words the container starts with, as the last stage has them: `ENTRYPOINT`
    /// then `CMD`. Empty when it names neither (the base image's then apply).
    pub fn start(&self) -> Vec<String> {
        let last = self.stages.last();
        let part = |p: Option<&Vec<String>>| p.cloned().unwrap_or_default();
        let mut words = part(last.and_then(|s| s.entrypoint.as_ref()));
        words.extend(part(last.and_then(|s| s.cmd.as_ref())));
        words
    }

    /// The `ENTRYPOINT` words of the last stage alone: what a `command` given from
    /// outside is added to.
    pub fn entrypoint(&self) -> Vec<String> {
        self.stages
            .last()
            .and_then(|s| s.entrypoint.clone())
            .unwrap_or_default()
    }

    /// The working directory the container starts in.
    pub fn workdir(&self) -> String {
        let mut dir = "/".to_string();
        for op in self.stages.last().into_iter().flat_map(|s| &s.ops) {
            if let Op::Workdir(w) = op {
                dir = absolute(&dir, w);
            }
        }
        dir
    }

    /// The path in the build context of the file that is at `path` (absolute) in the
    /// image, `exists` saying whether a context path is a file. An error says why it
    /// cannot be told.
    pub fn source(&self, path: &str, exists: &dyn Fn(&str) -> bool) -> Result<String, String> {
        self.trace(self.stages.len() - 1, path, exists, 0)
    }

    fn trace(
        &self,
        stage: usize,
        path: &str,
        exists: &dyn Fn(&str) -> bool,
        hops: usize,
    ) -> Result<String, String> {
        if hops > MAX_HOPS {
            return Err("it is copied through more stages than Drift follows".into());
        }
        let name = path.rsplit('/').next().unwrap_or(path);
        // Each step with the working directory it runs in.
        let mut dir = "/".to_string();
        let mut steps: Vec<(String, &Op)> = Vec::new();
        for op in &self.stages[stage].ops {
            steps.push((dir.clone(), op));
            if let Op::Workdir(w) = op {
                dir = absolute(&dir, w);
            }
        }
        // The last step that puts the file there decides.
        for (dir, op) in steps.iter().rev() {
            match op {
                Op::Workdir(_) => {}
                Op::Run(text) => {
                    let writes = text.contains(name)
                        && !text
                            .split("&&")
                            .filter(|part| part.contains(name))
                            .all(|part| part.trim_start().starts_with("chmod "));
                    if writes {
                        return Err(format!("a step of the Dockerfile may write it (`{text}`)"));
                    }
                }
                Op::Copy {
                    from,
                    sources,
                    dest,
                } => {
                    let unread = |s: &str| s.contains(['$', '*', '?', '[']);
                    let to = absolute(dir, dest);
                    let covers = to == "/" || path == to || path.starts_with(&format!("{to}/"));
                    if unread(dest) || (covers && sources.iter().any(|s| unread(s))) {
                        return Err(format!(
                            "a COPY to `{dest}` holds a variable or a pattern, and may be what puts it there"
                        ));
                    }
                    let mut candidates: Vec<String> = Vec::new();
                    for s in sources {
                        if sources.len() == 1 && !dest.ends_with('/') && to == path {
                            candidates.push(s.clone());
                        }
                        let under = if to == "/" {
                            path.strip_prefix('/')
                        } else {
                            path.strip_prefix(&to).and_then(|r| r.strip_prefix('/'))
                        };
                        if let Some(rest) = under {
                            // A directory copied in, or a file copied into a directory.
                            candidates.push(format!("{}/{rest}", s.trim_end_matches('/')));
                            if s.rsplit('/').next() == Some(rest) {
                                candidates.push(s.clone());
                            }
                        }
                    }
                    for c in candidates {
                        match from {
                            None => {
                                let rel = absolute("/", &c);
                                let rel = rel.trim_start_matches('/');
                                if exists(rel) {
                                    return Ok(rel.to_string());
                                }
                            }
                            Some(f) => {
                                let Some(i) = self.stage_named(f, stage) else {
                                    return Err(format!(
                                        "it may be copied from `{f}`, which is no stage of the Dockerfile"
                                    ));
                                };
                                if let Ok(found) =
                                    self.trace(i, &absolute("/", &c), exists, hops + 1)
                                {
                                    return Ok(found);
                                }
                            }
                        }
                    }
                }
            }
        }
        Err("nothing the Dockerfile copies from the repository puts it there".into())
    }

    /// The earlier stage `from` names: by its name, or its number.
    fn stage_named(&self, from: &str, before: usize) -> Option<usize> {
        let by_name = self.stages[..before]
            .iter()
            .position(|s| s.name.as_deref() == Some(from));
        by_name.or_else(|| from.parse::<usize>().ok().filter(|i| *i < before))
    }
}

/// The words of an instruction: a JSON array (`["a", "b"]`) or words between spaces,
/// quotes taken off.
fn words_of(rest: &str) -> Vec<String> {
    if rest.starts_with('[')
        && let Ok(words) = serde_json::from_str::<Vec<String>>(rest)
    {
        return words;
    }
    rest.split_whitespace().map(unquote).collect()
}

fn unquote(word: &str) -> String {
    let w = word.trim();
    for q in ['"', '\''] {
        if w.len() >= 2 && w.starts_with(q) && w.ends_with(q) {
            return w[1..w.len() - 1].to_string();
        }
    }
    w.to_string()
}

/// `path` made absolute from the directory `dir`, `.` and `..` resolved.
pub fn absolute(dir: &str, path: &str) -> String {
    let joined = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{dir}/{path}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for p in joined.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_STAGES: &str = "# syntax=docker/dockerfile:1.4\nFROM python:3.13-slim AS build\nWORKDIR /src\nCOPY backend/packages/core backend/packages/core\nCOPY backend/services/api backend/services/api\nRUN cd backend/services/api && \\\n    uv sync --locked\n\nFROM python:3.13-slim AS runtime\nWORKDIR /app\nCOPY --from=build /app/.venv /app/.venv\nCOPY --from=build /src/backend/services/api/app /app/app\nCOPY --from=build /src/backend/services/api/entrypoint.sh /app/entrypoint.sh\nRUN chmod +x /app/entrypoint.sh\nUSER appuser\nCMD [\"./entrypoint.sh\"]\n";

    fn in_context(files: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |p| files.contains(&p)
    }

    #[test]
    fn a_start_script_is_traced_to_the_build_context() {
        let image = Image::parse(TWO_STAGES).unwrap();
        assert_eq!(image.start(), ["./entrypoint.sh"]);
        assert_eq!(image.workdir(), "/app");
        let exists = in_context(&["backend/services/api/entrypoint.sh"]);
        assert_eq!(
            image.source("/app/entrypoint.sh", &exists),
            Ok("backend/services/api/entrypoint.sh".to_string())
        );
        // A file of a directory that is copied in.
        let exists = in_context(&["backend/services/api/app/run.sh"]);
        assert_eq!(
            image.source("/app/app/run.sh", &exists),
            Ok("backend/services/api/app/run.sh".to_string())
        );
        // Not in the repository, or put there by nothing that is read.
        assert!(
            image
                .source("/app/entrypoint.sh", &in_context(&[]))
                .is_err()
        );
        assert!(image.source("/usr/local/bin/start", &exists).is_err());

        // One stage, the whole context copied in; shell form.
        let image = Image::parse(
            "FROM python:3.12\nWORKDIR /srv\nCOPY . .\nENTRYPOINT [\"tini\", \"--\"]\nCMD sh scripts/start.sh\n",
        )
        .unwrap();
        assert_eq!(image.start(), ["tini", "--", "sh", "scripts/start.sh"]);
        assert_eq!(
            image.source("/srv/scripts/start.sh", &in_context(&["scripts/start.sh"])),
            Ok("scripts/start.sh".to_string())
        );
        // A file copied into a directory.
        let image = Image::parse("FROM a\nCOPY deploy/run.sh /usr/local/bin/\n").unwrap();
        assert_eq!(
            image.source("/usr/local/bin/run.sh", &in_context(&["deploy/run.sh"])),
            Ok("deploy/run.sh".to_string())
        );
    }

    #[test]
    fn what_may_write_the_file_is_an_error_not_a_guess() {
        let exists = in_context(&["entrypoint.sh", "api/entrypoint.sh"]);
        let source = |text: &str| {
            Image::parse(text)
                .unwrap()
                .source("/app/entrypoint.sh", &exists)
        };
        assert_eq!(
            source("FROM a\nWORKDIR /app\nCOPY . .\n"),
            Ok("entrypoint.sh".to_string())
        );
        // Written after it is copied.
        assert!(
            source("FROM a\nWORKDIR /app\nCOPY . .\nRUN sed -i s/a/b/ entrypoint.sh\n").is_err()
        );
        assert!(
            source("FROM a\nWORKDIR /app\nCOPY . .\nRUN echo x > /app/entrypoint.sh && chmod +x /app/entrypoint.sh\n")
                .is_err()
        );
        // A variable or a pattern in a later COPY: it may be the one.
        assert!(source("FROM a\nWORKDIR /app\nCOPY . .\nCOPY ${APP_PATH}/ /app/\n").is_err());
        assert!(source("FROM a\nWORKDIR /app\nCOPY *.sh /app/\n").is_err());
        // From an image that is no stage, from a download.
        assert!(source("FROM a\nCOPY --from=tools:1 /entrypoint.sh /app/entrypoint.sh\n").is_err());
        assert!(source("FROM a\nADD https://example.com/e.sh /app/entrypoint.sh\n").is_err());
        // No FROM: not a Dockerfile.
        assert!(Image::parse("COPY . .\n").is_none());
        assert_eq!(absolute("/app", "../srv/./x.sh"), "/srv/x.sh");
    }
}
