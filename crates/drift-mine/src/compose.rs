//! A compose file as compose itself reads it: with the files it includes and the
//! services it extends put in, or a note of what could not be.
//!
//! A service is said to be internal only when its whole definition is read. `include`
//! and `extends` bring in parts of it from other files; [`resolve`] puts them in, with
//! their paths made relative to the including file, and marks a service whose
//! definition it could not complete ([`UNRESOLVED`]). [`unknown_key`] names a key of
//! a service that is not on the list of those Drift knows ([`SERVICE_KEYS`]).

use std::path::Path;

use serde_json::{Map, Value};

/// The key [`resolve`] leaves on a service whose definition is not all read, with why.
pub const UNRESOLVED: &str = "x-drift-unresolved";

/// The largest compose file read.
const MAX_BYTES: u64 = 1024 * 1024;
/// How far `extends` is followed.
const MAX_DEPTH: usize = 8;

/// The keys of a service that Drift reads, or knows to say nothing of who can reach
/// it. The list to extend: a service with any other key is never said to be internal.
/// Keys starting with `x-` are the file's own notes.
pub const SERVICE_KEYS: &[&str] = &[
    "annotations",
    "attach",
    "build",
    "cap_add",
    "cap_drop",
    "command",
    "configs",
    "container_name",
    "cpu_count",
    "cpu_shares",
    "cpus",
    "depends_on",
    "deploy",
    "develop",
    "dns",
    "dns_search",
    "entrypoint",
    "env_file",
    "environment",
    "expose",
    "extends",
    "extra_hosts",
    "healthcheck",
    "hostname",
    "image",
    "init",
    "labels",
    "links",
    "logging",
    "mem_limit",
    "mem_reservation",
    "network_mode",
    "networks",
    "platform",
    "ports",
    "profiles",
    "pull_policy",
    "read_only",
    "restart",
    "scale",
    "secrets",
    "security_opt",
    "shm_size",
    "stdin_open",
    "stop_grace_period",
    "stop_signal",
    "tmpfs",
    "tty",
    "ulimits",
    "user",
    "volumes",
    "working_dir",
];

/// The first key of the service `def` that is not one Drift knows.
pub fn unknown_key(def: &Map<String, Value>) -> Option<&str> {
    def.keys()
        .map(String::as_str)
        .find(|k| !k.starts_with("x-") && !SERVICE_KEYS.contains(k))
}

/// Whether `text` is a compose file: a `services` mapping at its top whose entries
/// are mappings. A file of another kind with a `services` key (a Kubernetes list, an
/// API description) has no service that names an image, a build or a base to extend,
/// unless its name says compose.
pub fn is_compose(name: &str, text: &str) -> bool {
    if !text.lines().any(|l| l.starts_with("services:")) {
        return false;
    }
    let Ok(v) = serde_saphyr::from_str::<Value>(text) else {
        // Not parsed: said where it is read, when its name says what it is.
        return named_compose(name);
    };
    let Some(services) = v.get("services").and_then(Value::as_object) else {
        return false;
    };
    let defs: Vec<&Map<String, Value>> = services.values().filter_map(Value::as_object).collect();
    !defs.is_empty()
        && (named_compose(name)
            || defs.iter().any(|d| {
                ["image", "build", "extends"]
                    .iter()
                    .any(|k| d.contains_key(*k))
            }))
}

/// A file name that says compose: `compose.yaml`, `docker-compose.prod.yml`,
/// `compose.override.yaml`.
pub fn named_compose(name: &str) -> bool {
    let file = name.rsplit('/').next().unwrap_or(name).to_lowercase();
    (file.ends_with(".yml") || file.ends_with(".yaml")) && file.contains("compose")
}

/// `dir` and a path relative to it as one repo-relative path; none when it leaves the
/// repository or is absolute.
fn join(dir: &str, rel: &str) -> Option<String> {
    if rel.starts_with('/') || rel.contains("://") || rel.contains('$') {
        return None;
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// The path `rel` of a file in `from`, as a path relative to `to` (both repo-relative
/// directories): what a service brought in from another directory must say for the
/// same file. A path that is not relative, or leaves the repository, is absolute and
/// so outside it.
fn rebase(rel: &str, from: &str, to: &str) -> String {
    if !(rel.starts_with("./") || rel.starts_with("../") || rel == "." || rel == "..") {
        return rel.to_string();
    }
    match join(from, rel) {
        Some(at) => {
            let up = to.split('/').filter(|p| !p.is_empty()).count();
            let mut out = "../".repeat(up);
            out.push_str(&at);
            if up == 0 {
                out.insert_str(0, "./");
            }
            out
        }
        None => format!("/outside-the-repository/{rel}"),
    }
}

/// The paths of the service `def`, written in a compose file of `from`, made
/// relative to `to`: its build context, its env files, the sources of its bind
/// mounts.
fn rebase_service(def: &mut Map<String, Value>, from: &str, to: &str) {
    if from == to {
        return;
    }
    let path = |v: &mut Value| {
        if let Value::String(s) = v {
            // A build context or an env file is a path whatever it starts with.
            let rel = if s.starts_with('.') || s.starts_with('/') || s.contains("://") {
                s.clone()
            } else {
                format!("./{s}")
            };
            *s = rebase(&rel, from, to);
        }
    };
    match def.get_mut("build") {
        Some(b @ Value::String(_)) => path(b),
        Some(Value::Object(b)) => match b.get_mut("context") {
            Some(c) => path(c),
            None => {
                b.insert("context".into(), Value::String(rebase(".", from, to)));
            }
        },
        _ => {}
    }
    match def.get_mut("env_file") {
        Some(e @ Value::String(_)) => path(e),
        Some(Value::Array(a)) => {
            for item in a {
                match item {
                    Value::Object(o) => {
                        if let Some(p) = o.get_mut("path") {
                            path(p);
                        }
                    }
                    other => path(other),
                }
            }
        }
        _ => {}
    }
    if let Some(Value::Array(volumes)) = def.get_mut("volumes") {
        for v in volumes {
            match v {
                Value::String(s) => {
                    if let Some((source, rest)) = s.split_once(':')
                        && source.starts_with('.')
                    {
                        *s = format!("{}:{rest}", rebase(source, from, to));
                    }
                }
                Value::Object(o) => {
                    if let Some(Value::String(s)) = o.get_mut("source")
                        && s.starts_with('.')
                    {
                        *s = rebase(s, from, to);
                    }
                }
                _ => {}
            }
        }
    }
}

fn read(root: &Path, rel: &str) -> Result<Value, String> {
    let path = root.join(rel);
    let small = std::fs::metadata(&path)
        .map(|m| m.is_file() && m.len() <= MAX_BYTES)
        .unwrap_or(false);
    if !small {
        return Err(format!("{rel} is not in the repository"));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{rel} is not read ({e})"))?;
    serde_saphyr::from_str(&text).map_err(|e| format!("{rel} is not parsed ({e})"))
}

/// `over` merged into `base` as compose merges a service into the one it extends:
/// mappings key by key, sequences appended, anything else replaced.
fn merge(base: &mut Value, over: Value, depth: usize) {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) if depth < 32 => {
            for (k, v) in o {
                match b.get_mut(&k) {
                    Some(slot) => merge(slot, v, depth + 1),
                    None => {
                        b.insert(k, v);
                    }
                }
            }
        }
        (Value::Array(b), Value::Array(o)) => b.extend(o),
        (slot, v) => *slot = v,
    }
}

/// The definition of `service` in the compose file `file` (already parsed as `doc`
/// when it is the file being read), with what it extends put in, its paths relative
/// to `to`.
fn extended(
    root: &Path,
    file: &str,
    doc: Option<&Value>,
    service: &str,
    to: &str,
    depth: usize,
) -> Result<Map<String, Value>, String> {
    if depth > MAX_DEPTH {
        return Err(format!("`extends` goes deeper than Drift follows ({file})"));
    }
    let loaded;
    let doc = match doc {
        Some(d) => d,
        None => {
            loaded = read(root, file)?;
            &loaded
        }
    };
    let dir = file.rsplit_once('/').map_or("", |(d, _)| d);
    let mut def = doc
        .get("services")
        .and_then(|s| s.get(service))
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| format!("{file} has no service `{service}`"))?;
    let Some(extends) = def.remove("extends") else {
        rebase_service(&mut def, dir, to);
        return Ok(def);
    };
    let (base_file, base_service) = match &extends {
        Value::String(s) => (None, s.clone()),
        Value::Object(o) => (
            o.get("file").and_then(Value::as_str).map(str::to_string),
            o.get("service")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("an `extends` of `{service}` in {file} names no service"))?
                .to_string(),
        ),
        _ => return Err(format!("an `extends` of `{service}` in {file} is not read")),
    };
    let base = match base_file {
        Some(f) => {
            let at = join(dir, &f).ok_or_else(|| {
                format!("`extends` of `{service}` in {file} names `{f}`, which Drift cannot place")
            })?;
            extended(root, &at, None, &base_service, to, depth + 1)?
        }
        None => extended(root, file, Some(doc), &base_service, to, depth + 1)?,
    };
    rebase_service(&mut def, dir, to);
    let mut merged = Value::Object(base);
    merge(&mut merged, Value::Object(def), 0);
    match merged {
        Value::Object(m) => Ok(m),
        _ => unreachable!("an object merged with an object"),
    }
}

/// Puts into the compose file `doc` (at `name`, repo-relative) what compose reads
/// with it: the services, networks and volumes of the files its `include` names, and
/// for each service what it `extends`. Returns what could not be put in at the level
/// of the file (an include that is not found or not parsed): no service of the file
/// is then all read. A service whose `extends` could not be followed gets
/// [`UNRESOLVED`]. With no `root` nothing can be read: any `include` or `extends` is
/// not resolved.
pub fn resolve(root: Option<&Path>, name: &str, doc: &mut Value) -> Vec<String> {
    let dir = name.rsplit_once('/').map_or("", |(d, _)| d).to_string();
    let mut problems = Vec::new();
    // Includes: each a file, or a mapping with `path` (one or several).
    let includes: Vec<String> = match doc.get("include") {
        Some(Value::Array(a)) => a
            .iter()
            .flat_map(|item| match item {
                Value::String(s) => vec![s.clone()],
                Value::Object(o) => match o.get("path") {
                    Some(Value::String(s)) => vec![s.clone()],
                    Some(Value::Array(p)) => p
                        .iter()
                        .map(|x| x.as_str().unwrap_or("?").to_string())
                        .collect(),
                    _ => vec!["?".to_string()],
                },
                _ => vec!["?".to_string()],
            })
            .collect(),
        Some(_) => vec!["?".to_string()],
        None => Vec::new(),
    };
    for include in includes {
        let included = (|| {
            let root = root.ok_or_else(|| "no repository to read it from".to_string())?;
            let at = join(&dir, &include)
                .ok_or_else(|| "Drift cannot place it in the repository".to_string())?;
            let mut inner = read(root, &at)?;
            // What it includes and extends itself, relative to its own directory.
            let inner_problems = resolve(Some(root), &at, &mut inner);
            if let Some(p) = inner_problems.into_iter().next() {
                return Err(p);
            }
            Ok((at, inner))
        })();
        match included {
            Ok((at, inner)) => {
                let from = at.rsplit_once('/').map_or("", |(d, _)| d).to_string();
                let Value::Object(inner) = inner else {
                    continue;
                };
                let Some(top) = doc.as_object_mut() else {
                    continue;
                };
                for (section, entries) in inner {
                    let Value::Object(entries) = entries else {
                        continue;
                    };
                    if !matches!(section.as_str(), "services" | "networks" | "volumes") {
                        continue;
                    }
                    let slot = top
                        .entry(section.clone())
                        .or_insert_with(|| Value::Object(Map::new()));
                    let Some(slot) = slot.as_object_mut() else {
                        continue;
                    };
                    for (key, mut value) in entries {
                        if section == "services"
                            && let Some(def) = value.as_object_mut()
                        {
                            rebase_service(def, &from, &dir);
                        }
                        slot.entry(key).or_insert(value);
                    }
                }
            }
            Err(why) => problems.push(format!(
                "{name} includes `{include}`, which is not read with it ({why})"
            )),
        }
    }
    // Extends: each service that names a base.
    let extending: Vec<String> = doc
        .get("services")
        .and_then(Value::as_object)
        .map(|s| {
            s.iter()
                .filter(|(_, d)| d.get("extends").is_some())
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default();
    for service in extending {
        let done = match root {
            Some(root) => extended(root, name, Some(doc), &service, &dir, 0),
            None => Err(format!(
                "`{service}` extends another service, and there is no repository to read it from"
            )),
        };
        let Some(slot) = doc
            .get_mut("services")
            .and_then(|s| s.get_mut(&service))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        match done {
            Ok(def) => *slot = def,
            Err(why) => {
                slot.insert(UNRESOLVED.into(), Value::String(why));
            }
        }
    }
    problems
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn a_compose_file_is_known_by_its_content() {
        assert!(is_compose("stack.yml", "services:\n  api:\n    build: .\n"));
        assert!(is_compose(
            "docker-compose.prod.yml",
            "services:\n  api:\n    ports: [\"8000:8000\"]\n"
        ));
        // A `services` key of something else.
        assert!(!is_compose(
            "common.yml",
            "services:\n  base:\n    restart: always\n"
        ));
        assert!(!is_compose("openapi.yaml", "services:\n  - name: x\n"));
        assert!(!is_compose("values.yaml", "replicas: 2\n"));
    }

    #[test]
    fn extends_and_include_are_put_in_with_their_paths_made_relative() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        put(
            r,
            "services/common.yml",
            "services:\n  python-base:\n    restart: unless-stopped\n    ports:\n      - \"8000:8000\"\n",
        );
        put(
            r,
            "infra/edge.yaml",
            "services:\n  edge:\n    image: nginx:alpine\n    ports: [\"80:80\"]\n    volumes:\n      - ./edge.conf:/etc/nginx/conf.d/default.conf:ro\nnetworks:\n  edge: {}\n",
        );
        let text = "include:\n  - ../infra/edge.yaml\nservices:\n  api:\n    extends:\n      file: common.yml\n      service: python-base\n    build: ./api\n  worker:\n    extends: api\n    command: worker\n  lost:\n    extends:\n      file: missing.yml\n      service: x\n";
        let mut doc: Value = serde_saphyr::from_str(text).unwrap();
        let problems = resolve(Some(r), "services/compose.yaml", &mut doc);
        assert!(problems.is_empty(), "{problems:?}");
        let s = &doc["services"];
        assert_eq!(s["api"]["ports"][0], "8000:8000");
        assert_eq!(s["api"]["build"], "./api");
        assert_eq!(s["worker"]["ports"][0], "8000:8000");
        assert_eq!(s["worker"]["command"], "worker");
        assert_eq!(
            s["edge"]["volumes"][0],
            "../infra/edge.conf:/etc/nginx/conf.d/default.conf:ro"
        );
        assert!(doc["networks"]["edge"].is_object());
        assert_eq!(
            s["lost"][UNRESOLVED],
            "services/missing.yml is not in the repository"
        );
        // An include that is not there is the whole file's problem.
        let mut doc: Value =
            serde_saphyr::from_str("include: [./gone.yaml]\nservices:\n  api:\n    build: .\n")
                .unwrap();
        let problems = resolve(Some(r), "compose.yaml", &mut doc);
        assert_eq!(
            problems,
            [
                "compose.yaml includes `./gone.yaml`, which is not read with it (gone.yaml is not in the repository)"
            ]
        );
    }

    #[test]
    fn a_key_drift_does_not_know_is_named() {
        let def: Value =
            serde_saphyr::from_str("image: x\nports: []\nx-note: hi\nvolumes_from: [db]\n")
                .unwrap();
        assert_eq!(unknown_key(def.as_object().unwrap()), Some("volumes_from"));
    }
}
