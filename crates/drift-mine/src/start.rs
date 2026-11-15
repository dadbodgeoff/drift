//! What a container starts with, read to the end or not at all.
//!
//! A route is said to be internal only when Drift can state what serves it: the
//! server program, every option it is given, and the application object it is
//! started on. This module reads a start command (compose's `entrypoint` and
//! `command`, a Dockerfile's `ENTRYPOINT` and `CMD`, the scripts they run) word by
//! word against lists of what is known, and stops at the first word that is not on
//! one: [`Start::unknown`] then names that word, as written. Nothing here guesses.
//!
//! The lists, each the one place to extend: [`SERVERS`] (the server programs and the
//! options that do nothing to the path of a request), [`WORKER_CLASSES`],
//! [`RUNNERS`] (programs that run another), [`BEFORE`] (commands a start script may
//! run before the server), [`SERVER_ENV`] (the environment variables a server reads
//! that are known).

use std::collections::{BTreeMap, BTreeSet};

/// A server program and the options of it that are known: `--name` takes no value,
/// `--name=` takes one (as the next word, or after `=`).
struct Server {
    program: &'static str,
    /// Words that must follow the program (`fastapi run`).
    then: &'static [&'static str],
    options: &'static [&'static str],
    /// The attribute served when the target names only a module.
    attr: &'static str,
}

/// Not on these lists, on purpose: `--root-path`, `--factory`, `--app-dir`,
/// `--env-file` (uvicorn); `-c`/`--config`, `-e`/`--env`, `--paste`, `--chdir`,
/// `--pythonpath` (gunicorn); `-c`/`--config`, `--root-path` (hypercorn);
/// `--url-path-prefix` (granian); `--root-path` (daphne); `--url-prefix` (waitress).
const SERVERS: &[Server] = &[
    Server {
        program: "uvicorn",
        then: &[],
        options: &[
            "--host=",
            "--port=",
            "--workers=",
            "--log-level=",
            "--log-config=",
            "--loop=",
            "--http=",
            "--ws=",
            "--lifespan=",
            "--interface=",
            "--timeout-keep-alive=",
            "--timeout-graceful-shutdown=",
            "--limit-concurrency=",
            "--limit-max-requests=",
            "--backlog=",
            "--forwarded-allow-ips=",
            "--reload",
            "--reload-dir=",
            "--access-log",
            "--no-access-log",
            "--use-colors",
            "--no-use-colors",
            "--proxy-headers",
            "--no-proxy-headers",
            "--server-header",
            "--no-server-header",
            "--date-header",
            "--no-date-header",
        ],
        attr: "",
    },
    Server {
        program: "gunicorn",
        then: &[],
        options: &[
            "-w=",
            "--workers=",
            "-b=",
            "--bind=",
            "-k=",
            "--worker-class=",
            "-t=",
            "--timeout=",
            "--threads=",
            "--graceful-timeout=",
            "--keep-alive=",
            "--max-requests=",
            "--max-requests-jitter=",
            "--log-level=",
            "--access-logfile=",
            "--error-logfile=",
            "--log-file=",
            "--worker-tmp-dir=",
            "--forwarded-allow-ips=",
            "-n=",
            "--name=",
            "--capture-output",
            "--preload",
            "--reload",
        ],
        attr: "application",
    },
    Server {
        program: "hypercorn",
        then: &[],
        options: &[
            "-b=",
            "--bind=",
            "-w=",
            "--workers=",
            "-k=",
            "--worker-class=",
            "--log-level=",
            "--access-logfile=",
            "--error-logfile=",
            "--keep-alive=",
            "--graceful-timeout=",
            "--reload",
        ],
        attr: "app",
    },
    Server {
        program: "granian",
        then: &[],
        options: &[
            "--interface=",
            "--host=",
            "--port=",
            "--workers=",
            "--threads=",
            "--log-level=",
            "--loop=",
            "--http=",
            "--reload",
        ],
        attr: "app",
    },
    Server {
        program: "daphne",
        then: &[],
        options: &[
            "-b=",
            "--bind=",
            "-p=",
            "--port=",
            "-v=",
            "--verbosity=",
            "--access-log=",
        ],
        attr: "application",
    },
    Server {
        program: "fastapi",
        then: &["run"],
        options: &[
            "--host=",
            "--port=",
            "--workers=",
            "--proxy-headers",
            "--no-proxy-headers",
        ],
        attr: "app",
    },
    Server {
        program: "fastapi",
        then: &["dev"],
        options: &["--host=", "--port=", "--reload", "--no-reload"],
        attr: "app",
    },
];

/// The worker classes of gunicorn and hypercorn that are the library's own: a class
/// of the repository may be given a root path (`CONFIG_KWARGS`).
const WORKER_CLASSES: &[&str] = &[
    "sync",
    "gthread",
    "gevent",
    "eventlet",
    "asyncio",
    "uvloop",
    "trio",
    "uvicorn.workers.UvicornWorker",
    "uvicorn.workers.UvicornH11Worker",
    "uvicorn_worker.UvicornWorker",
];

/// Programs that run the words after them, with the words of their own that may
/// stand in between.
const RUNNERS: &[(&[&str], &[&str])] = &[
    (&["exec"], &[]),
    (&["tini"], &["--", "-g", "-s", "-v"]),
    (&["dumb-init"], &["--"]),
    (
        &["uv", "run"],
        &["--no-sync", "--frozen", "--locked", "--no-dev"],
    ),
    (&["poetry", "run"], &[]),
    (&["pipenv", "run"], &[]),
    (&["pdm", "run"], &[]),
    (&["npx"], &[]),
    (&["python", "-m"], &[]),
    (&["python3", "-m"], &[]),
];

/// What a start script may run before its server and leave the server as it is:
/// the first words of the statement.
const BEFORE: &[&[&str]] = &[
    &["set"],
    &["echo"],
    &["printf"],
    &["mkdir"],
    &["sleep"],
    &["true"],
    &[":"],
    &["umask"],
    &["alembic"],
    &["python", "-m", "alembic"],
    &["python", "manage.py", "migrate"],
    &["python", "manage.py", "collectstatic"],
    &["python", "manage.py", "check"],
    &["flask", "db"],
];

/// Environment variables a server program reads for itself, by prefix, and the ones
/// of them that do nothing to the path of a request.
const SERVER_ENV_PREFIXES: &[&str] = &["UVICORN_", "GUNICORN_", "HYPERCORN_", "GRANIAN_"];
const SERVER_ENV: &[&str] = &[
    "UVICORN_WORKERS",
    "UVICORN_HOST",
    "UVICORN_PORT",
    "UVICORN_LOG_LEVEL",
    "UVICORN_RELOAD",
    "UVICORN_ACCESS_LOG",
    "UVICORN_TIMEOUT_KEEP_ALIVE",
    "GUNICORN_WORKERS",
    "GUNICORN_THREADS",
    "GUNICORN_TIMEOUT",
    "GUNICORN_BIND",
];
/// Variables that set a prefix whatever the server.
const PREFIX_ENV: &[&str] = &[
    "SCRIPT_NAME",
    "UVICORN_ROOT_PATH",
    "GRANIAN_URL_PATH_PREFIX",
];

/// What is served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Serves {
    /// A Python application object: `module` and `attr` of `uvicorn module:attr`.
    Python { module: String, attr: String },
    /// `next start`: the Next.js application of the working directory.
    Next,
}

/// What [`read`] found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Start {
    /// What the command serves, when every word of it is known.
    pub serves: Result<Serves, String>,
    /// The directory the server runs in.
    pub workdir: String,
}

/// The environment a container is given, as far as the repository says.
#[derive(Debug, Clone, Default)]
pub struct Env {
    /// Variables with a value written in the repository.
    pub known: BTreeMap<String, String>,
    /// Variables that are set to something Drift does not read.
    pub opaque: BTreeSet<String>,
}

impl Env {
    /// `KEY=VALUE` lines (an env file, or a Dockerfile's `ENV`s): a value with a `$`
    /// in it is not read.
    pub fn set(&mut self, key: &str, value: Option<&str>) {
        let key = key.trim();
        if key.is_empty() {
            return;
        }
        match value.map(unquote) {
            Some(v) if !v.contains('$') => {
                self.opaque.remove(key);
                self.known.insert(key.to_string(), v);
            }
            _ => {
                self.known.remove(key);
                self.opaque.insert(key.to_string());
            }
        }
    }

    /// The lines of an env file.
    pub fn file(&mut self, text: &str) {
        for line in text.lines().map(str::trim) {
            let line = line.strip_prefix("export ").unwrap_or(line);
            if let Some((k, v)) = line.split_once('=')
                && !line.starts_with('#')
            {
                self.set(k, Some(v));
            }
        }
    }

    /// The `ENV` instructions of a Dockerfile.
    pub fn dockerfile(&mut self, text: &str) {
        for line in text.lines().map(str::trim) {
            let Some(rest) = line
                .strip_prefix("ENV ")
                .or_else(|| line.strip_prefix("env "))
            else {
                continue;
            };
            let rest = rest.trim();
            if rest
                .split_whitespace()
                .next()
                .is_some_and(|w| w.contains('='))
            {
                for (word, _) in words(rest) {
                    if let Some((k, v)) = word.split_once('=') {
                        self.set(k, Some(v));
                    }
                }
            } else if let Some((k, v)) = rest.split_once(char::is_whitespace) {
                self.set(k, Some(v.trim()));
            }
        }
    }
}

/// A variable a server reads for itself that is not known to leave the path alone,
/// named in one of `texts` (a compose definition, a Dockerfile, an env file, a
/// script): what to say of it.
pub fn server_env(texts: &[&str]) -> Option<String> {
    for text in texts {
        for token in text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
            if PREFIX_ENV.contains(&token) {
                return Some(format!("`{token}`, which sets a prefix for every route"));
            }
            if SERVER_ENV_PREFIXES.iter().any(|p| token.starts_with(p))
                && !SERVER_ENV.contains(&token)
            {
                return Some(format!(
                    "`{token}`, a setting of the server that Drift does not know"
                ));
            }
        }
    }
    None
}

/// A word of a compose `command` or `entrypoint` with compose's own variables put
/// in from the `.env` beside the compose file (`dotenv`); `$$` is a `$` for the
/// container. A variable that file does not set comes from the environment compose
/// is run in, which is not in the repository.
pub fn interpolate(word: &str, dotenv: &BTreeMap<String, String>) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = word;
    while let Some(i) = rest.find('$') {
        out.push_str(&rest[..i]);
        rest = &rest[i + 1..];
        if let Some(r) = rest.strip_prefix('$') {
            out.push('$');
            rest = r;
            continue;
        }
        let (name, _, after) = variable(rest).ok_or_else(|| format!("`{word}`"))?;
        match dotenv.get(name) {
            Some(v) => out.push_str(v),
            None => {
                return Err(format!(
                    "`${{{name}}}`, which compose takes from the environment it is run in"
                ));
            }
        }
        rest = after;
    }
    out.push_str(rest);
    Ok(out)
}

/// The variable at the start of `s` (the text after a `$`): its name, its default
/// (`${NAME:-default}`), and what follows it.
fn variable(s: &str) -> Option<(&str, Option<&str>, &str)> {
    let name_len = |s: &str| {
        s.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(s.len())
    };
    if let Some(inner) = s.strip_prefix('{') {
        let end = inner.find('}')?;
        let (body, after) = (&inner[..end], &inner[end + 1..]);
        let n = name_len(body);
        let (name, tail) = body.split_at(n);
        let default = match tail {
            "" => None,
            t => Some(t.strip_prefix(":-").or_else(|| t.strip_prefix('-'))?),
        };
        (n > 0).then_some((name, default, after))
    } else {
        let n = name_len(s);
        (n > 0 && !s.starts_with(|c: char| c.is_ascii_digit())).then(|| (&s[..n], None, &s[n..]))
    }
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    for q in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
            return v[1..v.len() - 1].to_string();
        }
    }
    v.to_string()
}

/// How a word was quoted where it was written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Quote {
    None,
    /// In double quotes: variables are put in, and the word stays one word.
    Double,
    /// In single quotes: as written.
    Single,
}

/// The words of a shell statement, each with how it was quoted. A word with more
/// than one kind of quoting in it is the kind of its first part.
fn words(text: &str) -> Vec<(String, Quote)> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut kind: Option<Quote> = None;
    let mut within: Option<char> = None;
    for c in text.chars() {
        match (within, c) {
            (Some(q), c) if c == q => within = None,
            (Some(_), c) => word.push(c),
            (None, '"') => {
                kind.get_or_insert(Quote::Double);
                within = Some('"');
            }
            (None, '\'') => {
                kind.get_or_insert(Quote::Single);
                within = Some('\'');
            }
            (None, c) if c.is_whitespace() => {
                if let Some(k) = kind.take() {
                    out.push((std::mem::take(&mut word), k));
                }
            }
            (None, c) => {
                kind.get_or_insert(Quote::None);
                word.push(c);
            }
        }
    }
    if let Some(k) = kind {
        out.push((word, k));
    }
    out
}

/// The statements of a script or a `-c` string: lines, split at `&&` and `;`, with
/// continuation lines joined and comments left out.
fn statements(text: &str) -> Vec<String> {
    let joined = text.replace("\\\n", " ");
    let mut out = Vec::new();
    for line in joined.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut within: Option<char> = None;
        let mut current = String::new();
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            match (within, c) {
                (Some(q), c) if c == q => {
                    within = None;
                    current.push(c);
                }
                (None, '"' | '\'') => {
                    within = Some(c);
                    current.push(c);
                }
                (None, ';') => out.push(std::mem::take(&mut current)),
                (None, '&') if chars.peek() == Some(&'&') => {
                    chars.next();
                    out.push(std::mem::take(&mut current));
                }
                _ => current.push(c),
            }
        }
        out.push(current);
    }
    out.into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

const MAX_DEPTH: usize = 6;

/// The text of the file at an absolute path of the container, with the name to call
/// it by; or why it is not read.
pub type ReadFile<'a> = dyn Fn(&str) -> Result<(String, String), String> + 'a;

struct Reader<'a> {
    env: &'a Env,
    /// The text of the file at an absolute path of the container, with the name to
    /// call it by; or why it is not read.
    file: &'a ReadFile<'a>,
    /// Variables the scripts read so far assign.
    vars: BTreeMap<String, String>,
    workdir: String,
}

/// Reads the start command `command` (words as compose or a Dockerfile has them)
/// of a container that starts in `workdir` with the environment `env`.
pub fn read(command: &[String], env: &Env, workdir: &str, file: &ReadFile) -> Start {
    let mut r = Reader {
        env,
        file,
        vars: BTreeMap::new(),
        workdir: workdir.to_string(),
    };
    let words = command.iter().map(|w| (w.clone(), Quote::None)).collect();
    let serves = r.command(words, &[], 0);
    Start {
        serves,
        workdir: r.workdir,
    }
}

fn file_name(word: &str) -> &str {
    word.rsplit('/').next().unwrap_or(word)
}

impl Reader<'_> {
    /// The value of a variable: what a script assigned, what the container is
    /// given, else its default.
    fn value(&self, name: &str, default: Option<&str>) -> Result<String, String> {
        if let Some(v) = self.vars.get(name).or_else(|| self.env.known.get(name)) {
            return Ok(v.clone());
        }
        if self.env.opaque.contains(name) {
            return Err(format!("`${name}`, whose value is not in the repository"));
        }
        match default {
            Some(d) if !d.contains('$') => Ok(unquote(d)),
            Some(d) => Err(format!("`${{{name}:-{d}}}`")),
            None => Err(format!("`${name}`, which nothing Drift reads sets")),
        }
    }

    /// The words with their variables put in: an unquoted variable is split into
    /// words again, as the shell does, and `"$@"` is the arguments.
    fn expand(&self, words: Vec<(String, Quote)>, args: &[String]) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        for (word, quote) in words {
            if quote == Quote::Single || !word.contains('$') {
                out.push(word);
                continue;
            }
            if word == "$@" {
                out.extend(args.iter().cloned());
                continue;
            }
            let mut text = String::new();
            let mut rest = word.as_str();
            while let Some(i) = rest.find('$') {
                text.push_str(&rest[..i]);
                let (name, default, after) =
                    variable(&rest[i + 1..]).ok_or_else(|| format!("`{word}`"))?;
                text.push_str(&self.value(name, default)?);
                rest = after;
            }
            text.push_str(rest);
            match quote {
                Quote::None => out.extend(text.split_whitespace().map(str::to_string)),
                _ => out.push(text),
            }
        }
        Ok(out)
    }

    /// What the command `words` serves.
    fn command(
        &mut self,
        words: Vec<(String, Quote)>,
        args: &[String],
        depth: usize,
    ) -> Result<Serves, String> {
        if depth > MAX_DEPTH {
            return Err("a start command that runs more scripts than Drift follows".into());
        }
        let mut words = self.expand(words, args)?;
        loop {
            let Some(first) = words.first().cloned() else {
                return Err("a start command with nothing in it".into());
            };
            let name = file_name(&first).to_string();
            // A program that runs the rest.
            if let Some((runner, own)) = RUNNERS.iter().find(|(runner, _)| {
                runner[0] == name
                    && runner[1..]
                        .iter()
                        .zip(words.iter().skip(1))
                        .filter(|(a, b)| *a == b)
                        .count()
                        == runner.len() - 1
            }) {
                let mut n = runner.len();
                while words.get(n).is_some_and(|w| own.contains(&w.as_str())) {
                    n += 1;
                }
                words.drain(..n);
                continue;
            }
            // A shell: a `-c` string, or a script.
            if matches!(name.as_str(), "sh" | "bash" | "ash" | "dash") {
                let mut n = 1;
                while words
                    .get(n)
                    .is_some_and(|w| w.starts_with('-') && w != "-c")
                {
                    if !matches!(words[n].as_str(), "-e" | "-x" | "-u" | "-eu" | "-ex" | "-l") {
                        return Err(format!("`{name} {}`", words[n]));
                    }
                    n += 1;
                }
                return match words.get(n).map(String::as_str) {
                    Some("-c") => {
                        let text = words[n + 1..].join(" ");
                        self.text(&text, &[], "the start command", depth + 1)
                    }
                    Some(_) => {
                        let script = words[n].clone();
                        self.script(&script, &words[n + 1..], depth + 1)
                    }
                    None => Err(format!("`{name}` with nothing to run")),
                };
            }
            if name.ends_with(".sh")
                || first.starts_with("./")
                || first.starts_with('/') && !self.known(&name)
            {
                return self.script(&first, &words[1..], depth + 1);
            }
            if name == "next" {
                return next(&words[1..]);
            }
            if matches!(name.as_str(), "npm" | "pnpm" | "yarn" | "bun") {
                let script = match words.get(1).map(String::as_str) {
                    Some("run") => words.get(2),
                    other => other.and(words.get(1)),
                };
                let Some(script) = script.filter(|s| !s.starts_with('-')) else {
                    return Err(format!("`{}`", words.join(" ")));
                };
                let at = crate::image::absolute(&self.workdir, "package.json");
                let (shown, text) = (self.file)(&at).map_err(|why| {
                    format!("`{name} {script}`, whose package.json is not read ({why})")
                })?;
                let line = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| {
                        v.get("scripts")?
                            .get(script.as_str())?
                            .as_str()
                            .map(String::from)
                    })
                    .ok_or_else(|| format!("`{name} {script}`, which {shown} does not define"))?;
                return self.text(&line, &[], &shown, depth + 1);
            }
            return self.server(&name, &words[1..]);
        }
    }

    /// The name is a program Drift reads, not a script.
    fn known(&self, name: &str) -> bool {
        SERVERS.iter().any(|s| s.program == name)
            || RUNNERS.iter().any(|(r, _)| r[0] == name)
            || matches!(
                name,
                "sh" | "bash" | "ash" | "dash" | "next" | "node" | "npm" | "pnpm" | "yarn" | "bun"
            )
    }

    /// The script at `path`, run with `args`.
    fn script(&mut self, path: &str, args: &[String], depth: usize) -> Result<Serves, String> {
        let at = crate::image::absolute(&self.workdir, path);
        let (shown, text) =
            (self.file)(&at).map_err(|why| format!("`{path}`, which is not read ({why})"))?;
        self.text(&text, args, &shown, depth)
    }

    /// The statements of a script (`origin`, for the message) or a `-c` string: what
    /// may come before the server, then the server.
    fn text(
        &mut self,
        text: &str,
        args: &[String],
        origin: &str,
        depth: usize,
    ) -> Result<Serves, String> {
        let all = statements(text);
        let last = all.len().saturating_sub(1);
        for (i, statement) in all.iter().enumerate() {
            let unread = || format!("`{statement}` in {origin}, which Drift does not read");
            let bare: String = {
                // Outside quotes: what would make this more than one command.
                let mut within: Option<char> = None;
                statement
                    .chars()
                    .filter(|&c| {
                        match (within, c) {
                            (Some(q), c) if c == q => within = None,
                            (None, '"' | '\'') => within = Some(c),
                            _ => {}
                        }
                        within.is_none()
                    })
                    .collect()
            };
            if bare
                .replace("${", "")
                .contains(['|', '&', '>', '<', '`', '(', '{'])
            {
                return Err(unread());
            }
            let words = words(statement);
            let Some((first, _)) = words.first() else {
                continue;
            };
            let plain: Vec<&str> = words.iter().map(|(w, _)| w.as_str()).collect();
            // `NAME=value`, `export NAME=value`.
            let assigns = if first == "export" {
                &words[1..]
            } else {
                &words[..]
            };
            if !assigns.is_empty()
                && (first == "export" || words.len() == 1)
                && assigns.iter().all(|(w, _)| {
                    let name = w.split('=').next().unwrap_or_default();
                    !name.is_empty()
                        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        && (w.contains('=') || first == "export")
                })
            {
                for (w, quote) in assigns {
                    let Some((name, value)) = w.split_once('=') else {
                        continue;
                    };
                    let value = self
                        .expand(vec![(value.to_string(), *quote)], args)
                        .map(|v| v.join(" "))?;
                    self.vars.insert(name.to_string(), value);
                }
                continue;
            }
            if first == "cd" {
                match plain.as_slice() {
                    [_, dir] if !dir.contains('$') => {
                        self.workdir = crate::image::absolute(&self.workdir, dir);
                        continue;
                    }
                    _ => return Err(unread()),
                }
            }
            if BEFORE
                .iter()
                .any(|b| plain.len() >= b.len() && b.iter().zip(&plain).all(|(a, b)| a == b))
            {
                continue;
            }
            if first == "exec" || i == last {
                return self.command(words, args, depth);
            }
            return Err(unread());
        }
        Err(format!("{origin}, which starts nothing Drift reads"))
    }

    /// A server program and its options.
    fn server(&mut self, name: &str, rest: &[String]) -> Result<Serves, String> {
        let name = name.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
        let Some(server) = SERVERS.iter().find(|s| {
            s.program == name
                && s.then.iter().zip(rest).filter(|(a, b)| *a == b).count() == s.then.len()
        }) else {
            let shown = match rest.first() {
                Some(w) if !w.starts_with('-') && SERVERS.iter().any(|s| s.program == name) => {
                    format!("{name} {w}")
                }
                _ => name.to_string(),
            };
            return Err(format!("`{shown}`, a program Drift does not know"));
        };
        let mut target: Option<&str> = None;
        let mut words = rest[server.then.len()..].iter();
        while let Some(word) = words.next() {
            if !word.starts_with('-') {
                if target.replace(word).is_some() {
                    return Err(format!("`{word}`, a second thing for {name} to serve"));
                }
                continue;
            }
            let (option, mut value) = match word.split_once('=') {
                Some((o, v)) => (o, Some(v.to_string())),
                None => (word.as_str(), None),
            };
            let takes_value = if server.options.contains(&option) {
                false
            } else if server.options.contains(&format!("{option}=").as_str()) {
                true
            } else {
                return Err(match option {
                    "--root-path" | "--url-path-prefix" | "--url-prefix" => {
                        format!("`{option}`, which sets a prefix for every route")
                    }
                    _ => format!("`{option}`, an option of {name} that Drift does not know"),
                });
            };
            if takes_value && value.is_none() {
                value = words.next().cloned();
            }
            if matches!(option, "-k" | "--worker-class")
                && !value
                    .as_deref()
                    .is_some_and(|v| WORKER_CLASSES.contains(&v))
            {
                return Err(format!(
                    "`{option} {}`, a worker class Drift does not know",
                    value.unwrap_or_default()
                ));
            }
        }
        let Some(target) = target else {
            return Err(format!("`{name}` with no application named"));
        };
        // `fastapi run app/main.py`: a file, served as its module.
        if server.program == "fastapi" {
            let module = target.trim_end_matches(".py").replace('/', ".");
            return Ok(Serves::Python {
                module,
                attr: server.attr.to_string(),
            });
        }
        let (module, attr) = match target.split_once(':') {
            Some((m, a)) => (m, a),
            None if !server.attr.is_empty() => (target, server.attr),
            None => return Err(format!("`{target}`, which names no application object")),
        };
        let name_like = |s: &str| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        };
        if !name_like(module) || !name_like(attr) || attr.contains('.') {
            return Err(format!("`{target}`, which is not a module and a name"));
        }
        Ok(Serves::Python {
            module: module.to_string(),
            attr: attr.to_string(),
        })
    }
}

/// `next start` and `next dev`, with the options that only say where to listen.
fn next(rest: &[String]) -> Result<Serves, String> {
    let mut words = rest.iter();
    match words.next().map(String::as_str) {
        Some("start" | "dev") => {}
        other => return Err(format!("`next {}`", other.unwrap_or_default())),
    }
    while let Some(word) = words.next() {
        match word.split('=').next().unwrap_or_default() {
            "-p" | "--port" | "-H" | "--hostname" => {
                if !word.contains('=') {
                    words.next();
                }
            }
            "--turbo" | "--turbopack" => {}
            _ => {
                return Err(format!(
                    "`{word}`, an option of next that Drift does not know"
                ));
            }
        }
    }
    Ok(Serves::Next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(command: &str, env: &Env, files: &[(&str, &str)]) -> Result<Serves, String> {
        let words: Vec<String> = command.split_whitespace().map(str::to_string).collect();
        read(&words, env, "/app", &|at| {
            files
                .iter()
                .find(|(path, _)| *path == at)
                .map(|(path, text)| (path.to_string(), text.to_string()))
                .ok_or_else(|| "not there".to_string())
        })
        .serves
    }

    fn python(module: &str, attr: &str) -> Result<Serves, String> {
        Ok(Serves::Python {
            module: module.into(),
            attr: attr.into(),
        })
    }

    #[test]
    fn a_server_with_known_options_is_read_to_its_application() {
        let env = Env::default();
        for command in [
            "uvicorn app.main:app",
            "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --no-server-header",
            "exec uvicorn app.main:app --host=0.0.0.0",
            "python -m uvicorn app.main:app --reload",
            "uv run --no-sync uvicorn app.main:app",
            "/app/.venv/bin/uvicorn app.main:app",
            "gunicorn -w 4 -k uvicorn.workers.UvicornWorker app.main:app",
            "sh -c uvicorn app.main:app --port 8000",
            "hypercorn app.main --bind 0.0.0.0:8000",
            "fastapi run app/main.py --port 80",
        ] {
            assert_eq!(
                run(command, &env, &[]),
                python("app.main", "app"),
                "{command}"
            );
        }
        assert_eq!(
            run("gunicorn proj.wsgi", &env, &[]),
            python("proj.wsgi", "application")
        );
        assert_eq!(run("next start -p 3000", &env, &[]), Ok(Serves::Next));
    }

    #[test]
    fn a_word_that_is_not_known_is_named() {
        let env = Env::default();
        for (command, names) in [
            (
                "uvicorn app.main:app --root-path /api",
                "`--root-path`, which sets a prefix",
            ),
            (
                "uvicorn app.main:create --factory",
                "`--factory`, an option of uvicorn",
            ),
            ("uvicorn app.main:app --env-file .env", "`--env-file`"),
            (
                "gunicorn -k app.worker.ApiWorker app.main:app",
                "`-k app.worker.ApiWorker`, a worker class",
            ),
            (
                "gunicorn -c gunicorn.conf.py app.main:app",
                "`-c`, an option of gunicorn",
            ),
            ("gunicorn -e SCRIPT_NAME=/api app.main:app", "`-e`"),
            (
                "hypercorn --config hypercorn.toml app.main:app",
                "`--config`",
            ),
            ("python main.py", "`python`, a program Drift does not know"),
            (
                "supervisord -c /etc/supervisord.conf",
                "`supervisord`, a program",
            ),
            (
                "uvicorn app.main:app $SERVER_ARGS",
                "`$SERVER_ARGS`, which nothing Drift reads sets",
            ),
            ("uvicorn app.main:app $(cat args)", "`$(cat`"),
            (
                "sh -c nginx && uvicorn app.main:app",
                "`nginx` in the start command",
            ),
            ("uvicorn", "with no application named"),
            ("next build", "`next build`"),
        ] {
            let got = run(command, &env, &[]).unwrap_err();
            assert!(got.contains(names), "{command}: {got}");
        }
    }

    #[test]
    fn a_start_script_is_read_statement_by_statement() {
        let script = "#!/bin/bash\nset -euo pipefail\nWORKERS=\"${UVICORN_WORKERS:-1}\"\nalembic upgrade head\nexec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers $WORKERS --log-level info --no-server-header";
        let mut env = Env::default();
        let files = [("/app/entrypoint.sh", script)];
        assert_eq!(
            run("./entrypoint.sh", &env, &files),
            python("app.main", "app")
        );
        // The variable is the container's: its value is read, and split as the shell
        // splits it.
        env.set("UVICORN_WORKERS", Some("2 --root-path /api"));
        let got = run("./entrypoint.sh", &env, &files).unwrap_err();
        assert!(got.contains("`--root-path`"), "{got}");
        // Set to something that is not in the repository.
        env.set("UVICORN_WORKERS", Some("${WORKERS_FROM_HOST}"));
        let got = run("./entrypoint.sh", &env, &files).unwrap_err();
        assert!(
            got.contains("`$UVICORN_WORKERS`, whose value is not in the repository"),
            "{got}"
        );
        // An entrypoint that runs what it is given.
        let files = [(
            "/app/docker-entrypoint.sh",
            "#!/bin/sh\nset -e\npython manage.py migrate --noinput\nexec \"$@\"\n",
        )];
        assert_eq!(
            run(
                "/app/docker-entrypoint.sh gunicorn proj.wsgi:application",
                &Env::default(),
                &files
            ),
            python("proj.wsgi", "application")
        );
        // What Drift does not read in a script is named.
        for (text, names) in [
            (
                "nginx -g 'daemon on;'\nexec uvicorn app.main:app",
                "`nginx -g 'daemon on;'` in /app/run.sh",
            ),
            (
                "if [ -n \"$PREFIX\" ]; then ARGS=\"--root-path $PREFIX\"; fi\nexec uvicorn app.main:app $ARGS",
                "`if [ -n \"$PREFIX\" ]`",
            ),
            (". ./env.sh\nexec uvicorn app.main:app", "`. ./env.sh`"),
            ("uvicorn app.main:app &\nwait", "`uvicorn app.main:app &`"),
            ("echo starting", "starts nothing Drift reads"),
        ] {
            let got = run("./run.sh", &Env::default(), &[("/app/run.sh", text)]).unwrap_err();
            assert!(got.contains(names), "{text}: {got}");
        }
        let got = run("./missing.sh", &Env::default(), &[]).unwrap_err();
        assert!(
            got.contains("`./missing.sh`, which is not read (not there)"),
            "{got}"
        );
        // A package script.
        let files = [(
            "/app/package.json",
            "{\"scripts\": {\"start\": \"next start -p 3000\"}}",
        )];
        assert_eq!(
            run("npm run start", &Env::default(), &files),
            Ok(Serves::Next)
        );
        assert_eq!(run("pnpm start", &Env::default(), &files), Ok(Serves::Next));
    }

    #[test]
    fn compose_variables_come_from_the_env_file_beside_it_or_are_not_read() {
        let mut dotenv = BTreeMap::new();
        dotenv.insert(
            "UVICORN_EXTRA_ARGS".to_string(),
            "--root-path /api".to_string(),
        );
        assert_eq!(
            interpolate("${UVICORN_EXTRA_ARGS}", &dotenv),
            Ok("--root-path /api".to_string())
        );
        assert_eq!(interpolate("$$HOME/x", &dotenv), Ok("$HOME/x".to_string()));
        let got = interpolate("${PORT:-8000}", &dotenv).unwrap_err();
        assert!(
            got.contains("`${PORT}`, which compose takes from the environment"),
            "{got}"
        );
    }

    #[test]
    fn a_setting_of_the_server_in_the_environment_is_known_or_named() {
        assert_eq!(server_env(&["UVICORN_WORKERS: 2\nLOG_LEVEL: info"]), None);
        assert!(
            server_env(&["environment:\n  UVICORN_ROOT_PATH: /api"])
                .unwrap()
                .contains("`UVICORN_ROOT_PATH`, which sets a prefix")
        );
        assert!(
            server_env(&["ENV GUNICORN_CMD_ARGS=\"--bind 0.0.0.0\""])
                .unwrap()
                .contains("`GUNICORN_CMD_ARGS`, a setting of the server")
        );
        assert!(server_env(&["SCRIPT_NAME=/api"]).is_some());
    }

    #[test]
    fn the_environment_is_what_the_repository_writes() {
        let mut env = Env::default();
        env.dockerfile(
            "FROM python\nENV A=1 B=\"two words\"\nENV C three\nENV PATH=\"/x:$PATH\"\n",
        );
        assert_eq!(env.known["A"], "1");
        assert_eq!(env.known["B"], "two words");
        assert_eq!(env.known["C"], "three");
        assert!(env.opaque.contains("PATH"));
        env.file("# comment\nA=2\nexport D=4\n");
        assert_eq!(env.known["A"], "2");
        assert_eq!(env.known["D"], "4");
    }
}
