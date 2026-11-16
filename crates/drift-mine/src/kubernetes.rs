//! What the repository's Kubernetes manifests open, by what each says itself.
//!
//! These are findings of the manifests alone. Which route of the repository's code a
//! path from outside reaches is decided in `security::cluster`, which reads the
//! same documents ([`parse_file`]) and ties a workload to code by an image the
//! repository builds or by a person's word. What the manifests say of the cluster
//! itself is read here, object by object:
//!
//! - **A path from outside the cluster** (`ingress`): each rule of an `Ingress`, a
//!   Gateway API route (`backendRefs`) or an OpenShift `Route`, with the Service it
//!   sends to and the workloads that Service selects among the manifests.
//! - **A Service with an address outside the cluster** (`public_service`): `type:
//!   LoadBalancer` or `NodePort`, or `externalIPs`, with the workloads it selects.
//!   A load balancer an annotation says is internal is not listed.
//! - **A workload given the node it runs on** (`host_access`): the host's network,
//!   process or IPC namespace, a directory of the host mounted in, a port of the
//!   host, a privileged container, capabilities added. Said with the Service or
//!   the path that reaches it from outside, where one does.
//! - **A Secret whose values are written in the file** (`secret_value`): the keys
//!   are named, never the values. A value that is a placeholder to substitute
//!   (`${NAME}`, `$(NAME)`) is not one.
//! - **A role over everything, or a binding to callers with no credential**
//!   (`wide_role`): a rule with every verb on every resource, a binding to it (or
//!   to the cluster's own `cluster-admin`), a binding whose subject is the
//!   cluster's name for a caller that is not signed in.
//!
//! A workload is any object with a pod template (`spec.containers` under `spec`,
//! `spec.template` or `spec.jobTemplate`), whatever its kind, so an operator's
//! own kinds are read as a `Deployment` is. Objects are matched within a
//! namespace; one that names none matches any.
//!
//! A file that does not parse as YAML or JSON is skipped: a Helm template is
//! text until Helm renders it, and is not read. Nothing is rendered, applied or
//! fetched.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// The largest manifest read.
const MAX_BYTES: u64 = 1024 * 1024;
/// The most files looked into in one repository.
const MAX_FILES: usize = 5_000;
/// The directories below the root that are walked.
const MAX_DEPTH: usize = 12;
/// How deep a pod template is looked for under an object.
const TEMPLATE_DEPTH: usize = 4;

/// One thing a manifest opens ([`read`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct ClusterFinding {
    /// `ingress`, `public_service`, `host_access`, `secret_value` or `wide_role`.
    pub kind: String,
    pub path: String,
    pub line: u32,
    /// The object, as `Kind/name` (`namespace/Kind/name` where it names one).
    pub object: String,
    /// What was read.
    pub detail: String,
}

/// The manifests of the repository at `root`, read.
pub fn read(root: &Path) -> Vec<ClusterFinding> {
    let walker = ignore::WalkBuilder::new(root)
        .max_depth(Some(MAX_DEPTH))
        .follow_links(false)
        .require_git(false)
        .filter_entry(|e| {
            !(e.file_type().is_some_and(|t| t.is_dir()) && e.file_name() == "node_modules")
        })
        .build();
    let mut paths: Vec<std::path::PathBuf> = walker
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| e.into_path())
        .filter(|p| {
            p.extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| matches!(x, "yaml" | "yml" | "json"))
        })
        .collect();
    paths.sort();
    let mut files = Vec::new();
    for p in paths.into_iter().take(MAX_FILES) {
        if std::fs::metadata(&p).map_or(true, |m| m.len() > MAX_BYTES) || !sniff(&p) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        if let Some(rel) = drift_core::ingest::rel_posix(root, &p) {
            files.push((rel, text));
        }
    }
    read_files(&files)
}

/// How much of a file is read to tell whether it is a manifest.
const SNIFF_BYTES: usize = 16 * 1024;

/// The start of the file names an `apiVersion`: an object says what it is before
/// it says anything else, so a file that names none in its first lines (a
/// translation table, a lockfile, a fixture) is not read further.
fn sniff(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut head = vec![0u8; SNIFF_BYTES];
    let mut read = 0;
    while read < head.len() {
        match file.read(&mut head[read..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => read += n,
        }
    }
    head[..read]
        .windows(b"apiVersion".len())
        .any(|w| w == b"apiVersion")
}

/// One object of a manifest.
pub(crate) struct Object<'a> {
    pub(crate) path: &'a str,
    pub(crate) line: u32,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) namespace: String,
    pub(crate) doc: Value,
}

impl Object<'_> {
    /// `Kind/name`, with the namespace where the object names one.
    pub(crate) fn label(&self) -> String {
        match self.namespace.as_str() {
            "" => format!("{}/{}", self.kind, self.name),
            ns => format!("{ns}/{}/{}", self.kind, self.name),
        }
    }

    /// The two are of one namespace, as far as they say.
    fn beside(&self, other: &Object) -> bool {
        self.namespace.is_empty() || other.namespace.is_empty() || self.namespace == other.namespace
    }

    /// The pod template of the object: the labels its pods carry and their spec.
    pub(crate) fn pods(&self) -> Option<(&Value, &Value)> {
        let mut at = &self.doc;
        for _ in 0..TEMPLATE_DEPTH {
            let spec = at.get("spec")?;
            if spec.get("containers").is_some_and(Value::is_array) {
                let labels = at.get("metadata").and_then(|m| m.get("labels"));
                return Some((labels.unwrap_or(&Value::Null), spec));
            }
            at = spec.get("template").or_else(|| spec.get("jobTemplate"))?;
        }
        None
    }

    pub(crate) fn spec(&self, key: &str) -> Option<&Value> {
        self.doc.get("spec").and_then(|s| s.get(key))
    }
}

/// The text of a scalar, as a manifest may write it (`80`, `"80"`, `true`).
pub(crate) fn scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

pub(crate) fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or_default()
}

pub(crate) fn list(v: Option<&Value>) -> impl Iterator<Item = &Value> {
    v.and_then(Value::as_array).into_iter().flatten()
}

fn is_true(v: Option<&Value>) -> bool {
    v.and_then(scalar).is_some_and(|s| s == "true")
}

/// The documents of a file: a YAML stream is split at its `---` lines, each
/// document with the line it starts on.
fn documents(rel: &str, text: &str) -> Vec<(u32, Value, String)> {
    if rel.ends_with(".json") {
        return serde_json::from_str::<Value>(text)
            .map(|v| vec![(1, v, text.to_string())])
            .unwrap_or_default();
    }
    let mut out = Vec::new();
    let mut start = 1u32;
    let mut body = String::new();
    let mut flush = |start: u32, body: &mut String| {
        if body.contains("apiVersion")
            && let Ok(v) = serde_saphyr::from_str::<Value>(body)
        {
            out.push((start, v, std::mem::take(body)));
        }
        body.clear();
    };
    for (i, line) in text.lines().enumerate() {
        if line == "---" || line.starts_with("--- ") {
            flush(start, &mut body);
            start = i as u32 + 2;
        } else {
            body.push_str(line);
            body.push('\n');
        }
    }
    flush(start, &mut body);
    out
}

/// The objects of a document: itself, or the items of a list of objects.
fn objects<'a>(rel: &'a str, start: u32, doc: Value, body: &str, out: &mut Vec<Object<'a>>) {
    if let Some(items) = doc.get("items").and_then(Value::as_array)
        && doc.get("spec").is_none()
    {
        for item in items.clone() {
            objects(rel, start, item, body, out);
        }
        return;
    }
    let kind = text(&doc, "kind").to_string();
    if kind.is_empty() || doc.get("apiVersion").and_then(scalar).is_none() {
        return;
    }
    let meta = doc.get("metadata").cloned().unwrap_or(Value::Null);
    let name = match text(&meta, "name") {
        "" => text(&meta, "generateName"),
        n => n,
    }
    .to_string();
    // The line that names the object, else the one its document starts on.
    let named = body
        .lines()
        .position(|l| {
            let l = l.trim().trim_start_matches("- ");
            !name.is_empty()
                && l.strip_prefix("name:")
                    .or_else(|| l.strip_prefix("\"name\":"))
                    .is_some_and(|v| v.trim().trim_matches(['"', '\'', ',']) == name)
        })
        .unwrap_or(0);
    out.push(Object {
        path: rel,
        line: start + named as u32,
        kind,
        name,
        namespace: text(&meta, "namespace").to_string(),
        doc,
    });
}

/// The objects of one manifest, read for what it deploys
/// ([`crate::security::Boundaries`]): an error, with why, when a document of it is
/// not parsed, is not an object, or holds template markup outside a `ConfigMap` or a
/// `Secret` (a Helm or other template is text until a tool renders it), since what
/// the file deploys is then not known. Unlike [`read_files`], which passes such a
/// document over: a finding needs only what is there, a verdict needs all of it.
pub(crate) fn parse_file<'a>(rel: &'a str, text: &str) -> Result<Vec<Object<'a>>, String> {
    let mut out = Vec::new();
    let mut chunks: Vec<(u32, String)> = Vec::new();
    if rel.ends_with(".json") {
        chunks.push((1, text.to_string()));
    } else {
        let mut start = 1u32;
        let mut body = String::new();
        for (i, line) in text.lines().enumerate() {
            if line == "---" || line.starts_with("--- ") {
                chunks.push((start, std::mem::take(&mut body)));
                start = i as u32 + 2;
            } else {
                body.push_str(line);
                body.push('\n');
            }
        }
        chunks.push((start, body));
    }
    for (start, body) in chunks {
        let content = body.lines().any(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#')
        });
        if !content {
            continue;
        }
        let parsed = if rel.ends_with(".json") {
            serde_json::from_str::<Value>(&body).map_err(|e| e.to_string())
        } else {
            serde_saphyr::from_str::<Value>(&body).map_err(|e| e.to_string())
        };
        let v = parsed.map_err(|e| {
            let e: String = e.chars().take(120).collect();
            match body.contains("{{") {
                true => format!(
                    "the document at line {start} holds template markup (`{{{{`) and is not parsed ({e})"
                ),
                false => format!("the document at line {start} is not parsed ({e})"),
            }
        })?;
        if v.is_null() {
            continue;
        }
        let before = out.len();
        objects(rel, start, v, &body, &mut out);
        if out.len() == before {
            return Err(format!(
                "the document at line {start} is not a Kubernetes object (it names no kind and apiVersion)"
            ));
        }
        if body.contains("{{")
            && out[before..]
                .iter()
                .any(|o| !matches!(o.kind.as_str(), "ConfigMap" | "Secret"))
        {
            return Err(format!(
                "the document at line {start} holds template markup (`{{{{`), which is text until a tool renders it"
            ));
        }
        // An object with no name is a fragment (a patch, a piece another tool fills
        // in), not what is applied. A Skaffold file is build configuration.
        if let Some(o) = out[before..].iter().find(|o| {
            o.name.is_empty() && !self::text(&o.doc, "apiVersion").starts_with("skaffold/")
        }) {
            return Err(format!(
                "the {} at line {} has no `metadata.name`, so it is a fragment, not a whole manifest",
                o.kind, o.line
            ));
        }
    }
    Ok(out)
}

/// The findings of a set of manifests (path, text), read together: what a Service
/// selects may be written in another file.
pub fn read_files(files: &[(String, String)]) -> Vec<ClusterFinding> {
    let mut all: Vec<Object> = Vec::new();
    for (rel, text) in files {
        for (start, doc, body) in documents(rel, text) {
            objects(rel, start, doc, &body, &mut all);
        }
    }
    let mut out = Vec::new();
    let mut push = |o: &Object, kind: &str, detail: String| {
        out.push(ClusterFinding {
            kind: kind.to_string(),
            path: o.path.to_string(),
            line: o.line,
            object: o.label(),
            detail: detail.chars().take(300).collect(),
        });
    };

    // The workloads a Service selects: every label of its selector is a label of
    // the pods.
    let selected = |service: &Object| -> Vec<&Object> {
        let Some(selector) = service
            .spec("selector")
            .and_then(Value::as_object)
            .filter(|s| !s.is_empty())
        else {
            return Vec::new();
        };
        let matching: Vec<&Object> = all
            .iter()
            .filter(|w| w.beside(service))
            .filter(|w| {
                w.pods().is_some_and(|(labels, _)| {
                    selector
                        .iter()
                        .all(|(k, v)| labels.get(k).is_some_and(|l| scalar(l) == scalar(v)))
                })
            })
            .collect();
        // A repository may hold the same application more than once (a base, an
        // overlay, a release file): the nearest manifests that hold a match are
        // the Service's own, its file before its directory before the rest.
        let dir = |p: &str| p.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        let near: [&dyn Fn(&&Object) -> bool; 2] = [&|w| w.path == service.path, &|w| {
            dir(w.path) == dir(service.path)
        }];
        for nearer in near {
            let picked: Vec<&Object> = matching.iter().copied().filter(nearer).collect();
            if !picked.is_empty() {
                return picked;
            }
        }
        matching
    };
    let service_named = |from: &Object, name: &str| -> Option<&Object> {
        let dir = |p: &str| p.rsplit_once('/').map_or("", |(d, _)| d).to_string();
        // The nearest of that name: of the file, of the directory, of the rest.
        all.iter()
            .filter(|o| {
                o.kind == "Service" && o.pods().is_none() && o.name == name && o.beside(from)
            })
            .min_by_key(|o| {
                if o.path == from.path {
                    0
                } else if dir(o.path) == dir(from.path) {
                    1
                } else {
                    2
                }
            })
    };
    // What a workload runs, for a person to recognise it.
    let images = |w: &Object| -> String {
        let images: BTreeSet<&str> = w
            .pods()
            .into_iter()
            .flat_map(|(_, spec)| list(spec.get("containers")))
            .map(|c| text(c, "image"))
            .filter(|i| !i.is_empty())
            .collect();
        images.into_iter().collect::<Vec<_>>().join(", ")
    };
    let workloads = |service: &Object| -> String {
        let picked = selected(service);
        match picked.is_empty() {
            true => "no workload of the manifests".to_string(),
            false => picked
                .iter()
                .map(|w| match images(w).as_str() {
                    "" => w.label(),
                    i => format!("{} ({i})", w.label()),
                })
                .collect::<Vec<_>>()
                .join(", "),
        }
    };
    // The workloads reached from outside, each by what reaches it.
    let mut reached: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut reach = |service: &Object, by: &str| {
        for w in selected(service) {
            reached
                .entry(format!("{}\t{}", w.path, w.label()))
                .or_default()
                .insert(by.to_string());
        }
    };

    for o in &all {
        // A Service with an address outside the cluster.
        if o.kind == "Service" && o.pods().is_none() {
            let kind = o.spec("type").and_then(Value::as_str).unwrap_or_default();
            let external: Vec<String> = list(o.spec("externalIPs")).filter_map(scalar).collect();
            let internal = o
                .doc
                .get("metadata")
                .and_then(|m| m.get("annotations"))
                .and_then(Value::as_object)
                .is_some_and(|a| {
                    a.iter().any(|(k, v)| {
                        let v = scalar(v).unwrap_or_default().to_ascii_lowercase();
                        (k.to_ascii_lowercase().contains("internal")
                            && !matches!(v.as_str(), "false" | "0" | ""))
                            || v == "internal"
                    })
                });
            let outside = match kind {
                "LoadBalancer" => !internal,
                "NodePort" => true,
                _ => false,
            } || !external.is_empty();
            if outside {
                let ports: Vec<String> = list(o.spec("ports"))
                    .filter_map(|p| p.get("nodePort").or_else(|| p.get("port")).and_then(scalar))
                    .collect();
                let how = match external.is_empty() {
                    true => kind.to_string(),
                    false => format!("externalIPs {}", external.join(", ")),
                };
                push(
                    o,
                    "public_service",
                    format!(
                        "{how} port {}, selecting {}",
                        ports.join(", "),
                        workloads(o)
                    ),
                );
                reach(o, &o.label());
            }
        }
        // A path from outside: the three ways a manifest writes one.
        let mut routes: Vec<(String, String, String)> = Vec::new();
        let backend = |b: &Value| -> Option<(String, String)> {
            // `service: {name, port: {number | name}}`, or the older
            // `serviceName` / `servicePort`.
            if let Some(s) = b.get("service") {
                let port = s
                    .get("port")
                    .and_then(|p| p.get("number").or_else(|| p.get("name")).and_then(scalar));
                return Some((text(s, "name").to_string(), port.unwrap_or_default()));
            }
            b.get("serviceName")
                .and_then(scalar)
                .map(|n| (n, b.get("servicePort").and_then(scalar).unwrap_or_default()))
        };
        if o.kind == "Ingress" {
            for rule in list(o.spec("rules")) {
                let host = text(rule, "host");
                for p in list(rule.get("http").and_then(|h| h.get("paths"))) {
                    if let Some((service, port)) = p.get("backend").and_then(&backend) {
                        let path = match text(p, "path") {
                            "" => "/",
                            p => p,
                        };
                        routes.push((format!("{host}{path}"), service, port));
                    }
                }
            }
            if let Some((service, port)) = o
                .spec("defaultBackend")
                .or_else(|| o.spec("backend"))
                .and_then(&backend)
            {
                routes.push(("every other path".to_string(), service, port));
            }
        } else if let Some(rules) = o.spec("rules").and_then(Value::as_array)
            && rules.iter().any(|r| r.get("backendRefs").is_some())
        {
            let hosts: Vec<String> = list(o.spec("hostnames")).filter_map(scalar).collect();
            for rule in rules {
                let mut paths: Vec<String> = list(rule.get("matches"))
                    .filter_map(|m| m.get("path")?.get("value").and_then(scalar))
                    .collect();
                if paths.is_empty() {
                    paths.push("/".to_string());
                }
                for b in list(rule.get("backendRefs")) {
                    // A backend of another kind than a Service is not one of these.
                    if !matches!(text(b, "kind"), "" | "Service") {
                        continue;
                    }
                    for path in &paths {
                        routes.push((
                            format!("{}{path}", hosts.first().map_or("", String::as_str)),
                            text(b, "name").to_string(),
                            b.get("port").and_then(scalar).unwrap_or_default(),
                        ));
                    }
                }
            }
        } else if let Some(to) = o.spec("to")
            && matches!(text(to, "kind"), "" | "Service")
            && o.spec("host").is_some()
        {
            let host = o.spec("host").and_then(scalar).unwrap_or_default();
            let path = o.spec("path").and_then(scalar).unwrap_or_default();
            let port = o
                .spec("port")
                .and_then(|p| p.get("targetPort"))
                .and_then(scalar)
                .unwrap_or_default();
            routes.push((format!("{host}{path}"), text(to, "name").to_string(), port));
        }
        for (from, service, port) in routes {
            let to = match port.as_str() {
                "" => format!("Service {service}"),
                p => format!("Service {service}:{p}"),
            };
            let behind = match service_named(o, &service) {
                Some(s) => {
                    reach(s, &o.label());
                    format!("selecting {}", workloads(s))
                }
                None => "which is not in the manifests".to_string(),
            };
            push(o, "ingress", format!("{from} to {to}, {behind}"));
        }
        // A Secret whose values are written in the file.
        if o.kind == "Secret" {
            let keys: Vec<&str> = ["data", "stringData"]
                .iter()
                .filter_map(|k| o.doc.get(*k)?.as_object())
                .flat_map(|m| m.iter())
                .filter(|(_, v)| {
                    scalar(v).is_some_and(|v| {
                        !v.trim().is_empty() && !v.contains("${") && !v.contains("$(")
                    })
                })
                .map(|(k, _)| k.as_str())
                .collect();
            if !keys.is_empty() {
                push(o, "secret_value", format!("values of {}", keys.join(", ")));
            }
        }
    }

    // A role over everything, and what it is bound to.
    let wide = |o: &Object| -> bool {
        let every = |rule: &Value, key: &str| list(rule.get(key)).any(|v| v.as_str() == Some("*"));
        list(o.doc.get("rules")).any(|r| every(r, "verbs") && every(r, "resources"))
    };
    for o in &all {
        if wide(o) {
            push(
                o,
                "wide_role",
                "a rule with every verb on every resource".to_string(),
            );
        }
        let (Some(role), Some(subjects)) = (
            o.doc.get("roleRef"),
            o.doc.get("subjects").and_then(Value::as_array),
        ) else {
            continue;
        };
        let role_name = text(role, "name");
        let who = |s: &Value| format!("{} {}", text(s, "kind"), text(s, "name"));
        // The cluster's own names for a caller that is not signed in.
        let unsigned: Vec<String> = subjects
            .iter()
            .filter(|s| {
                matches!(
                    text(s, "name"),
                    "system:anonymous" | "system:unauthenticated"
                )
            })
            .map(who)
            .collect();
        if !unsigned.is_empty() {
            push(
                o,
                "wide_role",
                format!(
                    "binds {role_name} to callers with no credential ({})",
                    unsigned.join(", ")
                ),
            );
        }
        // The role is over everything: one of the manifests that is, or the
        // cluster's own, whose rules are in no file.
        let over_all = role_name == "cluster-admin"
            || all
                .iter()
                .any(|r| r.kind == text(role, "kind") && r.name == role_name && wide(r));
        if over_all && !subjects.is_empty() {
            push(
                o,
                "wide_role",
                format!(
                    "binds {role_name}, every verb on every resource, to {}",
                    subjects.iter().map(who).collect::<Vec<_>>().join(", ")
                ),
            );
        }
    }

    // A workload given the node it runs on.
    for o in &all {
        let Some((_, spec)) = o.pods() else {
            continue;
        };
        let mut given: Vec<String> = Vec::new();
        for key in ["hostNetwork", "hostPID", "hostIPC"] {
            if is_true(spec.get(key)) {
                given.push(key.to_string());
            }
        }
        for v in list(spec.get("volumes")) {
            if let Some(path) = v
                .get("hostPath")
                .and_then(|h| h.get("path"))
                .and_then(scalar)
            {
                given.push(format!("hostPath {path}"));
            }
        }
        for c in ["containers", "initContainers", "ephemeralContainers"]
            .iter()
            .flat_map(|k| list(spec.get(*k)))
        {
            let name = text(c, "name");
            let ctx = c.get("securityContext");
            if is_true(ctx.and_then(|s| s.get("privileged"))) {
                given.push(format!("container {name} privileged"));
            }
            let added: Vec<String> = list(ctx.and_then(|s| s.get("capabilities")?.get("add")))
                .filter_map(scalar)
                .collect();
            if !added.is_empty() {
                given.push(format!("container {name} adds {}", added.join(", ")));
            }
            for p in list(c.get("ports")) {
                if let Some(port) = p.get("hostPort").and_then(scalar) {
                    given.push(format!("container {name} hostPort {port}"));
                }
            }
        }
        if given.is_empty() {
            continue;
        }
        let from = reached
            .get(&format!("{}\t{}", o.path, o.label()))
            .map(|by| {
                format!(
                    "; reached from outside by {}",
                    by.iter().cloned().collect::<Vec<_>>().join(", ")
                )
            })
            .unwrap_or_default();
        out.push(ClusterFinding {
            kind: "host_access".to_string(),
            path: o.path.to_string(),
            line: o.line,
            object: o.label(),
            detail: format!("{}{from}", given.join(", "))
                .chars()
                .take(300)
                .collect(),
        });
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(files: &[(&str, &str)]) -> Vec<(String, String, String)> {
        let files: Vec<(String, String)> = files
            .iter()
            .map(|(p, t)| (p.to_string(), t.to_string()))
            .collect();
        let mut rows: Vec<(String, String, String)> = read_files(&files)
            .into_iter()
            .map(|f| (f.kind, f.object, f.detail))
            .collect();
        rows.sort();
        rows
    }

    fn row(kind: &str, object: &str, detail: &str) -> (String, String, String) {
        (kind.to_string(), object.to_string(), detail.to_string())
    }

    const WEB: &str = "\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web, tier: front}
    spec:
      containers:
        - name: web
          image: example/web:1.0
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector: {app: web}
  ports:
    - port: 80
";

    #[test]
    fn a_cluster_service_alone_opens_nothing() {
        assert!(found(&[("k8s/web.yaml", WEB)]).is_empty());
    }

    #[test]
    fn an_ingress_rule_is_a_path_from_outside_to_what_its_service_selects() {
        let ingress = "\
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: front
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: web
                port: {number: 80}
          - path: /gone
            backend:
              serviceName: gone
              servicePort: 8080
";
        assert_eq!(
            found(&[("k8s/web.yaml", WEB), ("k8s/ingress.yaml", ingress)]),
            vec![
                row(
                    "ingress",
                    "Ingress/front",
                    "app.example.com/api to Service web:80, selecting Deployment/web (example/web:1.0)"
                ),
                row(
                    "ingress",
                    "Ingress/front",
                    "app.example.com/gone to Service gone:8080, which is not in the manifests"
                ),
            ]
        );
    }

    #[test]
    fn a_gateway_route_and_an_openshift_route_are_read_by_their_shape() {
        let routes = "\
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api
spec:
  hostnames: [api.example.com]
  rules:
    - matches:
        - path: {type: PathPrefix, value: /v1}
      backendRefs:
        - name: web
          port: 80
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: site
spec:
  host: site.example.com
  to:
    kind: Service
    name: web
";
        assert_eq!(
            found(&[("web.yaml", WEB), ("routes.yaml", routes)]),
            vec![
                row(
                    "ingress",
                    "HTTPRoute/api",
                    "api.example.com/v1 to Service web:80, selecting Deployment/web (example/web:1.0)"
                ),
                row(
                    "ingress",
                    "Route/site",
                    "site.example.com to Service web, selecting Deployment/web (example/web:1.0)"
                ),
            ]
        );
    }

    #[test]
    fn a_service_with_an_address_outside_is_found_and_an_internal_load_balancer_is_not() {
        let services = "\
apiVersion: v1
kind: Service
metadata:
  name: edge
spec:
  type: LoadBalancer
  selector: {app: web}
  ports: [{port: 443}]
---
apiVersion: v1
kind: Service
metadata:
  name: node
  namespace: other
spec:
  type: NodePort
  selector: {app: web}
  ports: [{port: 80, nodePort: 30080}]
---
apiVersion: v1
kind: Service
metadata:
  name: inside
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-internal: \"true\"
spec:
  type: LoadBalancer
  selector: {app: web}
  ports: [{port: 80}]
";
        assert_eq!(
            found(&[("web.yaml", WEB), ("services.yaml", services)]),
            vec![
                row(
                    "public_service",
                    "Service/edge",
                    "LoadBalancer port 443, selecting Deployment/web (example/web:1.0)"
                ),
                row(
                    "public_service",
                    "other/Service/node",
                    "NodePort port 30080, selecting Deployment/web (example/web:1.0)"
                ),
            ]
        );
    }

    #[test]
    fn a_workload_given_the_node_is_found_with_what_reaches_it_whatever_its_kind() {
        let agent = "\
apiVersion: example.com/v1
kind: Rollout
metadata:
  name: agent
spec:
  template:
    metadata:
      labels: {app: agent}
    spec:
      hostNetwork: true
      volumes:
        - name: sock
          hostPath: {path: /var/run/docker.sock}
      containers:
        - name: agent
          image: example/agent:2
          securityContext:
            privileged: true
            capabilities: {add: [SYS_ADMIN]}
          ports:
            - containerPort: 9000
              hostPort: 9000
---
apiVersion: v1
kind: Service
metadata:
  name: agent
spec:
  type: NodePort
  selector: {app: agent}
  ports: [{port: 9000}]
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: plain
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: job
              image: example/job:1
";
        assert_eq!(
            found(&[("agent.yaml", agent)]),
            vec![
                row(
                    "host_access",
                    "Rollout/agent",
                    "hostNetwork, hostPath /var/run/docker.sock, container agent privileged, container agent adds SYS_ADMIN, container agent hostPort 9000; reached from outside by Service/agent"
                ),
                row(
                    "public_service",
                    "Service/agent",
                    "NodePort port 9000, selecting Rollout/agent (example/agent:2)"
                ),
            ]
        );
    }

    #[test]
    fn a_service_selects_the_nearest_manifests_that_match() {
        let service = "\
apiVersion: v1
kind: Service
metadata:
  name: edge
spec:
  type: LoadBalancer
  selector: {app: web}
  ports: [{port: 80}]
";
        let other = WEB.replace("example/web:1.0", "example/web:2.0");
        // The same application twice: the one of the Service's directory is its own.
        assert_eq!(
            found(&[
                ("base/web.yaml", WEB),
                ("base/edge.yaml", service),
                ("release/all.yaml", &other),
            ]),
            vec![row(
                "public_service",
                "Service/edge",
                "LoadBalancer port 80, selecting Deployment/web (example/web:1.0)"
            )]
        );
        // None beside it: whatever of the repository matches.
        assert_eq!(
            found(&[("net/edge.yaml", service), ("release/all.yaml", &other)]),
            vec![row(
                "public_service",
                "Service/edge",
                "LoadBalancer port 80, selecting Deployment/web (example/web:2.0)"
            )]
        );
    }

    #[test]
    fn a_secret_written_in_the_file_names_its_keys_and_never_its_values() {
        let secrets = "\
apiVersion: v1
kind: Secret
metadata:
  name: db
stringData:
  password: hunter2-not-printed
  template: ${DB_PASSWORD}
data:
  token: aHVudGVyMg==
---
apiVersion: v1
kind: Secret
metadata:
  name: later
stringData:
  password: ${PASSWORD}
---
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: sealed
spec:
  encryptedData:
    password: AgBy3i4OJSWK
";
        let got = found(&[("secrets.yaml", secrets)]);
        assert_eq!(
            got,
            vec![row(
                "secret_value",
                "Secret/db",
                "values of token, password"
            )]
        );
        assert!(!format!("{got:?}").contains("hunter2"));
    }

    #[test]
    fn a_role_over_everything_and_a_binding_to_no_one_in_particular_are_found() {
        let rbac = "\
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: everything
rules:
  - apiGroups: ['*']
    resources: ['*']
    verbs: ['*']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: reader
rules:
  - apiGroups: ['']
    resources: [pods]
    verbs: [get, list]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: app-everything
roleRef: {kind: ClusterRole, name: everything}
subjects:
  - kind: ServiceAccount
    name: app
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: admin
roleRef: {kind: ClusterRole, name: cluster-admin}
subjects:
  - kind: ServiceAccount
    name: deployer
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: open
roleRef: {kind: ClusterRole, name: reader}
subjects:
  - kind: Group
    name: system:unauthenticated
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fine
roleRef: {kind: ClusterRole, name: reader}
subjects:
  - kind: ServiceAccount
    name: app
";
        assert_eq!(
            found(&[("rbac.yaml", rbac)]),
            vec![
                row(
                    "wide_role",
                    "ClusterRole/everything",
                    "a rule with every verb on every resource"
                ),
                row(
                    "wide_role",
                    "ClusterRoleBinding/admin",
                    "binds cluster-admin, every verb on every resource, to ServiceAccount deployer"
                ),
                row(
                    "wide_role",
                    "ClusterRoleBinding/app-everything",
                    "binds everything, every verb on every resource, to ServiceAccount app"
                ),
                row(
                    "wide_role",
                    "ClusterRoleBinding/open",
                    "binds reader to callers with no credential (Group system:unauthenticated)"
                ),
            ]
        );
    }

    #[test]
    fn a_list_of_objects_a_json_manifest_and_a_template_that_does_not_parse() {
        let listed = "\
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata:
      name: edge
    spec:
      type: LoadBalancer
      ports: [{port: 80}]
";
        let json = r#"{"apiVersion": "v1", "kind": "Service", "metadata": {"name": "j"}, "spec": {"type": "NodePort", "ports": [{"port": 1}]}}"#;
        let template = "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\nspec:\n  type: {{ .Values.type }}\n  {{- if .Values.x }}\n  ports: []\n  {{- end }}\n";
        let files: Vec<(String, String)> = [
            ("list.yaml", listed),
            ("svc.json", json),
            ("chart/templates/svc.yaml", template),
        ]
        .iter()
        .map(|(p, t)| (p.to_string(), t.to_string()))
        .collect();
        let got = read_files(&files);
        assert_eq!(
            got.iter()
                .map(|f| (f.path.as_str(), f.line, f.object.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("list.yaml", 7, "Service/edge"),
                ("svc.json", 1, "Service/j")
            ]
        );
    }

    /// A file read for a verdict is read whole or not at all: a template or a
    /// document that does not parse fails it, with the line, where the findings
    /// pass such a document over; a template inside a ConfigMap is its data.
    #[test]
    fn a_file_is_parsed_whole_for_a_verdict() {
        let ok = parse_file(
            "k8s/a.yaml",
            "# leading comment\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\n  namespace: shop\n---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata:\n  t: \"{{ .Values.x }}\"\n",
        )
        .unwrap();
        let rows: Vec<(&str, &str, &str, u32)> = ok
            .iter()
            .map(|o| {
                (
                    o.kind.as_str(),
                    o.name.as_str(),
                    o.namespace.as_str(),
                    o.line,
                )
            })
            .collect();
        assert_eq!(
            rows,
            vec![("Service", "web", "shop", 6), ("ConfigMap", "c", "", 12)]
        );
        let templated = parse_file(
            "chart/d.yaml",
            "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\n",
        )
        .err()
        .unwrap();
        assert!(templated.contains("{{"), "{templated}");
        let broken = parse_file("k8s/b.yaml", "kind: ConfigMap\ndata: [unclosed\n")
            .err()
            .unwrap();
        assert!(broken.contains("line 1"), "{broken}");
    }
}
