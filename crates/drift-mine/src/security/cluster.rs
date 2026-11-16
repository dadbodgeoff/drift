//! The repository's Kubernetes manifests, read as a deployment of its code: which
//! workload runs which application, and what reaches each from outside the cluster
//! ([`Boundaries`]).
//!
//! The chain is the one the compose files give, link by link:
//!
//! - **What reaches a workload from outside**: an `Ingress` rule (host, path, path
//!   type, the Service and port it sends to), a Gateway API `HTTPRoute` (its path
//!   matches), `TLSRoute` / `TCPRoute` / `UDPRoute` (every path), an OpenShift
//!   `Route`, and a `Service` of type `LoadBalancer` or `NodePort` or with
//!   `externalIPs`. The Service's selector picks the workloads whose pod template
//!   carries every label of it, in its namespace (a `Deployment`, `StatefulSet`,
//!   `DaemonSet`, `ReplicaSet`, `Job`, `CronJob` or `Pod`), and its target port the
//!   container.
//! - **Which code a container runs**: its image is one the repository is seen to
//!   build (a compose service with both `image` and `build`, a Skaffold artifact),
//!   or a person said so (`security.kubernetes` in `.drift/config.yaml`). Its
//!   `command` and `args`, over the Dockerfile's, say what it starts, as a compose
//!   service's do ([`super::started`]).
//!
//! A route of tied code is then internet-facing when a path from outside provably
//! reaches it: a rule whose path takes every path of the route (`Prefix` by path
//! element, `Exact`, an OpenShift path or an unqualified Ingress path read by path
//! element, which every controller agrees on), with no longer rule to another
//! backend that may take it; or a Service open on every path. It is internal only
//! on proof: nothing in the manifests reaches its workload from outside, or the
//! rules that do take none of its paths, every manifest was read, and nothing that
//! may route to it was seen and not read. Unknown otherwise, with the reason.
//!
//! What stops an internal verdict: a manifest that is not parsed (it stays an
//! unread description, as before), an object of a kind Drift does not read (a
//! service mesh's `VirtualService`, an operator's own kinds), an Ingress annotation
//! of a controller that changes the path sent or the backend ([`PATH_ANNOTATIONS`]),
//! a Gateway route filter that rewrites, a Service the manifests do not hold or
//! one with no selector, a workload on the host's network or with a host port, pods
//! that join a service mesh, an object a kustomization patches or renames, a
//! workload reached from outside whose image is not one the repository builds (it
//! may pass requests on), and an application of the repository reached from
//! outside whose code sends a request whose URL is not read ([`relays`]). Of these,
//! what also keeps a route from being proved internet-facing: what touches the
//! path itself (a rewrite, a regular expression, a patch, a namespace that cannot
//! be told the same), since the path a request has then is not the path the route
//! answers. A `NetworkPolicy` only narrows who reaches a pod: it never opens one to
//! the outside, so it changes neither verdict.
//!
//! Kustomize: the `resources` and `bases` of a kustomization are manifests read as
//! they are. `namespace`, `labels`, `commonLabels`, `replicas`, an image's new tag
//! and the ConfigMap and Secret generators change nothing that routes. Patches
//! touch their targets (all of its resources when the target cannot be told), a
//! name prefix or suffix, replacements, vars and components touch every resource of
//! it, and an image's new name touches the workloads that run that image: what they
//! touch is unknown, never guessed. A remote resource, a Helm chart and any other
//! key leave the kustomization unread. Helm templates are text until Helm renders
//! them: they stay unread and keep every route from being said to be internal.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{
    Boundaries, DATA_IMAGES, Description, EVERY_MOUNT_LISTED, EntryRow, Exposure, SERVED_ELSEWHERE,
    join_dir, normal_dir, read_small,
};
use crate::gateway::{Glob, Route};
use crate::kubernetes::{Object, list, parse_file, scalar, text};
use crate::policy::{CONFIG_FILE, KubernetesTie};

/// The annotations of ingress controllers, as their documentation names them, that
/// change the path a backend is sent or send a request to another backend than the
/// rule names: a rule of an object that carries one may carry any path to its
/// Service and proves none. A key ending in `.` is a family (`actions.<name>`). The
/// list to extend.
pub const PATH_ANNOTATIONS: &[&str] = &[
    "nginx.ingress.kubernetes.io/rewrite-target",
    "nginx.ingress.kubernetes.io/use-regex",
    "nginx.ingress.kubernetes.io/app-root",
    "nginx.ingress.kubernetes.io/configuration-snippet",
    "nginx.ingress.kubernetes.io/server-snippet",
    "nginx.ingress.kubernetes.io/default-backend",
    "nginx.ingress.kubernetes.io/mirror-target",
    "ingress.kubernetes.io/rewrite-target",
    "nginx.org/rewrites",
    "nginx.org/location-snippets",
    "nginx.org/server-snippets",
    "traefik.ingress.kubernetes.io/router.middlewares",
    "traefik.ingress.kubernetes.io/router.pathmatcher",
    "haproxy.org/path-rewrite",
    "haproxy.router.openshift.io/rewrite-target",
    "konghq.com/strip-path",
    "konghq.com/rewrite",
    "konghq.com/plugins",
    "alb.ingress.kubernetes.io/actions.",
    "alb.ingress.kubernetes.io/conditions.",
    "alb.ingress.kubernetes.io/transforms.",
    "appgw.ingress.kubernetes.io/backend-path-prefix",
];

/// The annotations and labels by which pods join a service mesh, as the meshes
/// document them: the mesh's own routing is not in the manifests.
const MESH_MARKS: &[&str] = &[
    "sidecar.istio.io/inject",
    "istio-injection",
    "istio.io/rev",
    "linkerd.io/inject",
    "consul.hashicorp.com/connect-inject",
    "kuma.io/sidecar-injection",
];

/// The kinds that run pods, by API group (`""` the core group).
const WORKLOADS: &[(&str, &str)] = &[
    ("", "Pod"),
    ("", "ReplicationController"),
    ("apps", "Deployment"),
    ("apps", "StatefulSet"),
    ("apps", "DaemonSet"),
    ("apps", "ReplicaSet"),
    ("extensions", "Deployment"),
    ("extensions", "DaemonSet"),
    ("extensions", "ReplicaSet"),
    ("batch", "Job"),
    ("batch", "CronJob"),
];

/// The kinds that open no path from outside to a pod and route nothing: read, and
/// nothing more to read. Every kind not here and not read otherwise may route
/// requests (a mesh's `VirtualService`, Traefik's `IngressRoute`, a Knative
/// `Service`). The list to extend.
const CLOSED: &[(&str, &str)] = &[
    ("", "ConfigMap"),
    ("", "Secret"),
    ("", "ServiceAccount"),
    ("", "PersistentVolume"),
    ("", "PersistentVolumeClaim"),
    ("", "Namespace"),
    ("", "LimitRange"),
    ("", "ResourceQuota"),
    ("", "Endpoints"),
    ("discovery.k8s.io", "EndpointSlice"),
    ("rbac.authorization.k8s.io", "Role"),
    ("rbac.authorization.k8s.io", "ClusterRole"),
    ("rbac.authorization.k8s.io", "RoleBinding"),
    ("rbac.authorization.k8s.io", "ClusterRoleBinding"),
    ("storage.k8s.io", "StorageClass"),
    ("scheduling.k8s.io", "PriorityClass"),
    ("policy", "PodDisruptionBudget"),
    ("autoscaling", "HorizontalPodAutoscaler"),
    ("autoscaling.k8s.io", "VerticalPodAutoscaler"),
    ("networking.k8s.io", "NetworkPolicy"),
    ("networking.k8s.io", "IngressClass"),
    ("gateway.networking.k8s.io", "GatewayClass"),
    ("gateway.networking.k8s.io", "Gateway"),
    ("gateway.networking.k8s.io", "ReferenceGrant"),
    ("apiextensions.k8s.io", "CustomResourceDefinition"),
    ("cert-manager.io", "Certificate"),
    ("cert-manager.io", "Issuer"),
    ("cert-manager.io", "ClusterIssuer"),
    ("monitoring.coreos.com", "ServiceMonitor"),
    ("monitoring.coreos.com", "PodMonitor"),
    ("monitoring.coreos.com", "PrometheusRule"),
    ("bitnami.com", "SealedSecret"),
    ("external-secrets.io", "ExternalSecret"),
    ("external-secrets.io", "SecretStore"),
    ("external-secrets.io", "ClusterSecretStore"),
];

/// The names of a kustomization file.
const KUSTOMIZATIONS: &[&str] = &["kustomization.yaml", "kustomization.yml", "Kustomization"];

/// The keys of a kustomization that change nothing that routes.
const KUSTOMIZE_PLAIN: &[&str] = &[
    "apiVersion",
    "kind",
    "metadata",
    "namespace",
    "commonLabels",
    "labels",
    "replicas",
    "configMapGenerator",
    "secretGenerator",
    "generatorOptions",
    "buildMetadata",
    "sortOptions",
];

/// How deep kustomizations are followed through each other.
const KUSTOMIZE_DEPTH: usize = 8;

/// An image the repository builds, by the name a manifest runs it by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Built {
    /// As written (`ghcr.io/acme/api:dev`).
    pub(crate) image: String,
    /// The code it is built from.
    pub(crate) dir: String,
    /// The build context and the Dockerfile, repo-relative.
    pub(crate) context: Option<String>,
    pub(crate) dockerfile: Option<String>,
    /// What says so: `compose service api in docker-compose.yml`.
    pub(crate) by: String,
}

/// A workload of the manifests whose containers Drift ties to no code, for a person
/// to say which code it runs (`drift setup`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Workload {
    /// `[namespace/]Kind/name`, as `security.kubernetes` names it.
    pub object: String,
    /// `file:line`.
    pub at: String,
    /// The images of its containers.
    pub images: Vec<String>,
    /// The names of its containers.
    pub containers: Vec<String>,
    /// Something in the manifests reaches it from outside.
    pub reached: bool,
}

/// How a rule matches a request path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum How {
    /// `Exact`: the path itself.
    Exact,
    /// `Prefix` / `PathPrefix`: by path element.
    Prefix,
    /// Unqualified (`ImplementationSpecific`, an OpenShift path): by path element
    /// for every controller, and some take more (a prefix of characters).
    Begins,
    /// What it matches or sends on is not read.
    Opaque,
}

/// One rule of a path from outside.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PathRule {
    /// For messages: `Ingress shop/front (k8s/ingress.yaml:9) routes /api (Prefix) to Service web:80`.
    said: String,
    host: String,
    path: String,
    how: How,
    /// The Service and port it sends to: rules to one backend never compete.
    backend: String,
}

impl PathRule {
    /// Its path takes every path of `route` (`route` as written; case kept).
    fn every(&self, route: &Route) -> bool {
        match self.how {
            How::Exact => route.glob(&self.path) == Glob::Every,
            How::Prefix | How::Begins => {
                self.path == "/"
                    || route.glob(&self.path) == Glob::Every
                    || route.glob(&format!("{}/*", self.path)) == Glob::Every
            }
            How::Opaque => false,
        }
    }

    /// Its path may take a path of the route written `shown`, compared as a service
    /// may (without regard to case, with or without a `/` at the end).
    fn may(&self, shown: &str) -> bool {
        let Some(route) = Route::parse(&shown.to_lowercase()) else {
            return true;
        };
        let p = self.path.to_lowercase();
        let some = |pattern: &str| route.glob(pattern) != Glob::None;
        match self.how {
            How::Exact => some(&p) || some(&format!("{p}/")),
            How::Prefix => p == "/" || some(&p) || some(&format!("{p}/*")),
            How::Begins => some(&format!("{p}*")),
            How::Opaque => true,
        }
    }

    /// Whether this rule wins over `other` for a request both take, or may: a
    /// longer path, an exact one over a prefix of the same length, and one Drift
    /// does not read whatever its length.
    fn outranks(&self, other: &PathRule) -> bool {
        let (a, b) = (self.path.len(), other.path.len());
        self.how == How::Opaque
            || a > b
            || (a == b && !(other.how == How::Exact && self.how != How::Exact))
    }

    fn hosts_overlap(&self, other: &PathRule) -> bool {
        self.host.is_empty()
            || other.host.is_empty()
            || self.host == other.host
            || self.host.starts_with('*')
            || other.host.starts_with('*')
    }
}

/// What reaches a container from outside.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Reach {
    /// Every path, proved.
    Every(String),
    /// The paths of a rule, proved to come to this container.
    Path(PathRule),
    /// The paths of a rule, which may come to this container: why it is not proved.
    MayPath(PathRule, String),
    /// Something may reach it, and how is not known: no route of it is internal,
    /// and none is proved internet-facing by this.
    May(String),
}

/// What a container's start command says, as a compose service's does.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Start {
    unread: Option<String>,
    target: Option<(String, String)>,
    next: bool,
    /// What it takes its environment from that Drift does not read (`envFrom`).
    absent: Vec<String>,
}

/// A container of a workload, tied to code.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Placed {
    code: String,
    /// `Deployment shop/web (k8s/web.yaml:3), container web`.
    who: String,
    /// The manifest file of the workload.
    file: String,
    /// The namespace of the workload, as written.
    namespace: String,
    /// How it is tied, for messages.
    tie: String,
    reaches: Vec<Reach>,
    /// Why no route of it is internal: the workload itself (the host's network, a
    /// mesh, a patch).
    caveat: Option<String>,
    start: Start,
    /// The names its Services answer to, lower case, for what a client may send.
    names: Vec<String>,
}

impl Placed {
    fn covers(&self, path: &str) -> bool {
        self.code.is_empty() || path == self.code || path.starts_with(&format!("{}/", self.code))
    }

    fn reached(&self) -> bool {
        !self.reaches.is_empty()
    }
}

/// The manifests, read ([`load`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cluster {
    /// The manifests read whole, repo-relative.
    files: Vec<String>,
    placed: Vec<Placed>,
    /// Every path rule of the manifests that reaches a Service: what a rule to a
    /// container competes with.
    rules: Vec<PathRule>,
    /// Why no route of any tied code is internal, wherever its workload runs: an
    /// object that may route and is not read, a workload reached from outside that
    /// may pass requests on.
    open: Option<String>,
    /// The workloads tied to no code.
    pub(crate) untied: Vec<Workload>,
    root: PathBuf,
}

/// The API group of an object: `apps` of `apps/v1`, `""` of `v1`.
fn group<'a>(o: &'a Object) -> &'a str {
    let v = text(&o.doc, "apiVersion");
    v.rsplit_once('/').map_or("", |(g, _)| g)
}

fn is(o: &Object, kinds: &[(&str, &str)]) -> bool {
    let g = group(o);
    kinds.iter().any(|(kg, k)| *kg == g && *k == o.kind)
}

fn at(o: &Object) -> String {
    format!("{}:{}", o.path, o.line)
}

/// `Deployment shop/web (k8s/web.yaml:3)`.
fn named(o: &Object) -> String {
    match o.namespace.as_str() {
        "" => format!("{} {} ({})", o.kind, o.name, at(o)),
        ns => format!("{} {ns}/{} ({})", o.kind, o.name, at(o)),
    }
}

fn annotations(o: &Object) -> Vec<(String, String)> {
    o.doc
        .get("metadata")
        .and_then(|m| m.get("annotations"))
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(k, v)| (k.clone(), scalar(v).unwrap_or_default()))
        .collect()
}

/// The annotation of `o` that changes the path a backend is sent ([`PATH_ANNOTATIONS`]).
fn path_annotation(o: &Object) -> Option<String> {
    annotations(o).into_iter().map(|(k, _)| k).find(|k| {
        PATH_ANNOTATIONS
            .iter()
            .any(|a| k == a || (a.ends_with('.') && k.starts_with(a)))
    })
}

/// An annotation that says the object answers only on a private network (an
/// internal load balancer, an internal ALB scheme).
fn private_annotation(o: &Object) -> Option<String> {
    annotations(o).into_iter().find_map(|(k, v)| {
        let v = v.to_ascii_lowercase();
        ((k.to_ascii_lowercase().contains("internal") && !matches!(v.as_str(), "false" | "0" | ""))
            || v == "internal")
            .then_some(k)
    })
}

/// An image reference without its tag or digest, and the registry's default names
/// taken off: `docker.io/library/nginx:1` -> `nginx`.
fn image_ref(image: &str) -> Option<String> {
    let image = image.trim().to_lowercase();
    if image.is_empty() || image.contains(['$', '{', '}', ' ']) {
        return None;
    }
    let image = image.split('@').next().unwrap_or_default();
    let (head, last) = image.rsplit_once('/').unwrap_or(("", image));
    let last = last.split(':').next().unwrap_or_default();
    let mut full = if head.is_empty() {
        last.to_string()
    } else {
        format!("{head}/{last}")
    };
    for prefix in ["docker.io/", "index.docker.io/", "library/"] {
        if let Some(rest) = full.strip_prefix(prefix) {
            full = rest.to_string();
        }
    }
    (!full.is_empty()).then_some(full)
}

/// What a kustomization does to the objects of its resources.
#[derive(Debug, Default)]
struct Kustomized {
    /// The manifest files it brings in, through other kustomizations too.
    files: BTreeSet<String>,
    /// Why it touches every one of them.
    all: Option<String>,
    /// The objects it touches by kind and name, with why.
    some: Vec<(String, String, String)>,
    /// Image names it gives a new name.
    renamed: Vec<String>,
    /// Its patch files: not manifests to deploy as they are.
    patches: Vec<String>,
    /// Why it is not read at all.
    unread: Option<String>,
}

fn kustomization_in(dir: &str, files: &BTreeMap<String, String>) -> Option<String> {
    KUSTOMIZATIONS
        .iter()
        .filter_map(|k| join_dir(dir, k))
        .find(|p| files.contains_key(p))
}

/// Reads the kustomization at `path` (its text among `files`, every file Drift has
/// read as a description of the cluster).
fn kustomize(path: &str, files: &BTreeMap<String, String>, depth: usize) -> Kustomized {
    let mut k = Kustomized::default();
    let dir = path.rsplit_once('/').map_or("", |(d, _)| d).to_string();
    if depth > KUSTOMIZE_DEPTH {
        k.unread = Some(format!(
            "{path} is reached through more kustomizations than Drift follows"
        ));
        return k;
    }
    let Some(v) = files
        .get(path)
        .and_then(|t| serde_saphyr::from_str::<Value>(t).ok())
    else {
        k.unread = Some(format!("{path} is not parsed"));
        return k;
    };
    let Some(map) = v.as_object() else {
        k.unread = Some(format!("{path} is not a mapping"));
        return k;
    };
    let strings = |v: &Value| -> Vec<String> { list(Some(v)).filter_map(scalar).collect() };
    let touch_all = |k: &mut Kustomized, why: String| {
        k.all.get_or_insert(why);
    };
    for (key, value) in map {
        match key.as_str() {
            _ if KUSTOMIZE_PLAIN.contains(&key.as_str()) => {}
            "resources" | "bases" => {
                for r in strings(value) {
                    let remote = r.contains("://")
                        || r.starts_with("github.com/")
                        || r.starts_with("git@")
                        || r.contains("?ref=");
                    let Some(rel) = join_dir(&dir, &r).filter(|_| !remote) else {
                        k.unread.get_or_insert(format!(
                            "{path} brings in `{r}`, which is not in the repository"
                        ));
                        continue;
                    };
                    if files.contains_key(&rel) {
                        k.files.insert(rel);
                    } else if let Some(inner) = kustomization_in(&rel, files) {
                        let sub = kustomize(&inner, files, depth + 1);
                        if let Some(why) = sub.unread {
                            k.unread.get_or_insert(why);
                        }
                        // What the inner one does to its own resources stands
                        // as it did; this one's transformations reach them too.
                        k.files.extend(sub.files);
                    } else {
                        k.unread.get_or_insert(format!(
                            "{path} brings in `{r}`, which is not a manifest or a kustomization Drift reads"
                        ));
                    }
                }
            }
            "commonAnnotations" => {
                let keys: Vec<&String> = value
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(k, _)| k)
                    .collect();
                if let Some(a) = keys.iter().find(|k| {
                    PATH_ANNOTATIONS
                        .iter()
                        .any(|a| *k == a || (a.ends_with('.') && k.starts_with(a)))
                }) {
                    touch_all(
                        &mut k,
                        format!("{path} sets the annotation {a} on every resource"),
                    );
                }
            }
            "images" => {
                for img in list(Some(value)) {
                    if img.get("newName").is_some() {
                        k.renamed.push(text(img, "name").to_string());
                    }
                }
            }
            "namePrefix" | "nameSuffix" | "replacements" | "vars" | "components" => {
                touch_all(
                    &mut k,
                    format!("{path} has `{key}`, which renames or rewrites its resources"),
                );
            }
            "patches" | "patchesJson6902" | "patchesStrategicMerge" => {
                for p in list(Some(value)) {
                    let target = p.get("target");
                    let file = match p {
                        Value::String(s) if !s.contains('\n') => Some(s.clone()),
                        _ => p.get("path").and_then(scalar),
                    };
                    let body: Option<String> = match (p, &file) {
                        (_, Some(f)) => join_dir(&dir, f).and_then(|rel| {
                            k.patches.push(rel.clone());
                            files.get(&rel).cloned()
                        }),
                        (Value::String(s), None) => Some(s.clone()),
                        _ => p.get("patch").and_then(scalar),
                    };
                    let by_target = target.and_then(|t| {
                        let plain = t.get("labelSelector").is_none()
                            && t.get("annotationSelector").is_none();
                        let name = text(t, "name");
                        let kind = text(t, "kind");
                        (plain
                            && !name.is_empty()
                            && !kind.is_empty()
                            && !name.contains(['*', '.', '^', '$', '|', '(']))
                        .then(|| (kind.to_string(), name.to_string()))
                    });
                    let by_body = || {
                        let v: Value = serde_saphyr::from_str(body.as_deref()?).ok()?;
                        let kind = text(&v, "kind");
                        let name = v
                            .get("metadata")
                            .map(|m| text(m, "name"))
                            .unwrap_or_default();
                        (!kind.is_empty() && !name.is_empty())
                            .then(|| (kind.to_string(), name.to_string()))
                    };
                    let shown = file
                        .clone()
                        .unwrap_or_else(|| "an inline patch".to_string());
                    match by_target.or_else(by_body) {
                        Some((kind, name)) if target.is_some() || key != "patchesJson6902" => {
                            k.some
                                .push((kind, name, format!("{path} patches it ({shown})")));
                        }
                        _ => touch_all(
                            &mut k,
                            format!(
                                "{path} patches its resources ({shown}), and which ones is not read"
                            ),
                        ),
                    }
                }
            }
            other => {
                k.unread
                    .get_or_insert(format!("{path} has `{other}`, which Drift does not read"));
            }
        }
    }
    k
}

/// Reads the manifests among the deployment descriptions `unread` (kind, file),
/// leaving out what `left` says is not deployed. What is read whole is taken out of
/// `unread` and named among the descriptions read; what is not stays, with why.
/// `ties` are what a person said (`security.kubernetes`).
pub(super) fn load(
    b: &mut Boundaries,
    root: &Path,
    unread: &mut Vec<(String, String)>,
    left: &dyn Fn(&str) -> bool,
    ties: &[KubernetesTie],
) {
    let charts: Vec<String> = unread
        .iter()
        .filter(|(kind, path)| kind == "Helm" && path.rsplit('/').next() == Some("Chart.yaml"))
        .map(|(_, path)| {
            path.rsplit_once('/')
                .map_or(String::new(), |(d, _)| d.to_string())
        })
        .collect();
    let in_chart = |path: &str| {
        charts
            .iter()
            .any(|d| d.is_empty() || path.starts_with(&format!("{d}/")))
    };
    // A manifest of a Helm chart is a template of it.
    for (kind, path) in unread.iter_mut() {
        if kind == "Kubernetes" && in_chart(path) {
            *kind = "Helm".to_string();
        }
    }
    let candidates: Vec<String> = unread
        .iter()
        .filter(|(kind, path)| kind == "Kubernetes" && !left(path))
        .map(|(_, path)| path.clone())
        .collect();
    if candidates.is_empty() {
        return;
    }
    let mut texts: BTreeMap<String, String> = BTreeMap::new();
    let mut not_read: BTreeMap<String, String> = BTreeMap::new();
    for path in &candidates {
        match read_small(&root.join(path)) {
            Some(t) => {
                texts.insert(path.clone(), t);
            }
            None => {
                not_read.insert(
                    path.clone(),
                    "it is too large to read, or not readable".into(),
                );
            }
        }
    }
    let name_of = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    // The kustomizations, and what each touches.
    let mut kustomized: Vec<(String, Kustomized)> = Vec::new();
    for path in texts
        .keys()
        .filter(|p| KUSTOMIZATIONS.contains(&name_of(p.as_str()).as_str()))
    {
        let k = kustomize(path, &texts, 0);
        if let Some(why) = &k.unread {
            not_read.insert(path.clone(), why.clone());
        }
        kustomized.push((path.clone(), k));
    }
    let patch_files: BTreeSet<String> = kustomized
        .iter()
        .flat_map(|(_, k)| k.patches.iter().cloned())
        .collect();
    // Parse every manifest; Skaffold's own file says which images are built where.
    let mut parsed: Vec<(String, Vec<Object>)> = Vec::new();
    let mut built: Vec<Built> = b.built.clone();
    for (path, t) in &texts {
        if KUSTOMIZATIONS.contains(&name_of(path.as_str()).as_str()) || patch_files.contains(path) {
            continue;
        }
        match parse_file(path, t) {
            Ok(objects) => {
                let (skaffold, rest): (Vec<Object>, Vec<Object>) = objects
                    .into_iter()
                    .partition(|o| text(&o.doc, "apiVersion").starts_with("skaffold/"));
                for s in &skaffold {
                    let base = s.path.rsplit_once('/').map_or("", |(d, _)| d);
                    for a in list(s.doc.get("build").and_then(|b| b.get("artifacts"))) {
                        let context = join_dir(
                            base,
                            a.get("context").and_then(Value::as_str).unwrap_or("."),
                        );
                        let named = a
                            .get("docker")
                            .and_then(|d| d.get("dockerfile"))
                            .and_then(Value::as_str);
                        let dockerfile = context
                            .as_ref()
                            .and_then(|c| join_dir(c, named.unwrap_or("Dockerfile")));
                        if let Some(dir) = context.clone() {
                            built.push(Built {
                                image: text(a, "image").to_string(),
                                dir: normal_dir(&dir),
                                context,
                                dockerfile,
                                by: format!("an artifact of {}", at(s)),
                            });
                        }
                    }
                }
                parsed.push((path.clone(), rest));
            }
            Err(why) => {
                not_read.insert(path.clone(), why);
            }
        }
    }
    let objects: Vec<&Object> = parsed.iter().flat_map(|(_, o)| o.iter()).collect();
    for (path, why) in &not_read {
        b.warnings.push(format!(
            "{path}: not read as a Kubernetes manifest ({why}): what it deploys is not known, so nothing is said to be internal"
        ));
    }
    // What the kustomizations touch, object by object.
    let mut touched: BTreeMap<usize, String> = BTreeMap::new();
    for (_, k) in kustomized.iter().filter(|(p, _)| !not_read.contains_key(p)) {
        for (i, o) in objects.iter().enumerate() {
            if !k.files.contains(o.path) {
                continue;
            }
            let why = k.all.clone().or_else(|| {
                k.some
                    .iter()
                    .find(|(kind, name, _)| *kind == o.kind && *name == o.name)
                    .map(|(_, _, why)| why.clone())
            });
            let why = why.or_else(|| {
                let images = pod_images(o);
                k.renamed
                    .iter()
                    .find(|r| images.iter().any(|i| image_ref(i) == image_ref(r)))
                    .map(|r| format!("a kustomization gives the image {r} a new name"))
            });
            if let Some(why) = why {
                touched.entry(i).or_insert(why);
            }
        }
    }
    let mut c = Cluster {
        root: root.to_path_buf(),
        files: texts
            .keys()
            .filter(|p| !not_read.contains_key(*p))
            .cloned()
            .collect(),
        ..Cluster::default()
    };
    c.read_objects(&objects, &touched, &built, ties, root, &mut b.warnings);
    // Read whole: no longer a description Drift does not read.
    unread.retain(|(kind, path)| !(kind == "Kubernetes" && c.files.contains(path)));
    b.read.extend(c.files.iter().cloned());
    b.cluster = Some(c);
}

/// The images of a pod template's containers.
fn pod_images(o: &Object) -> Vec<String> {
    o.pods()
        .into_iter()
        .flat_map(|(_, spec)| list(spec.get("containers")))
        .map(|c| text(c, "image").to_string())
        .collect()
}

/// The code a container runs, how that is known, and the image build that says so.
type Tie<'b> = Option<(String, String, Option<&'b Built>)>;

/// A Service of the manifests, as a path from outside comes to it.
struct Svc<'o> {
    o: &'o Object<'o>,
    i: usize,
}

/// One path from outside to a Service, before it is followed.
struct Hop<'o> {
    from: &'o Object<'o>,
    from_i: usize,
    /// What it is, for messages: `Ingress front (k8s/ingress.yaml:9) routes /api (Prefix)`.
    said: String,
    /// The rule, where it routes by path; none where every path comes.
    rule: Option<(String, String, How)>,
    /// Why it proves nothing (an annotation, a filter).
    opaque: Option<String>,
    /// The Service named, and the namespace (the object's own unless it says).
    service: String,
    namespace: String,
    port: Option<String>,
}

impl Cluster {
    fn read_objects(
        &mut self,
        objects: &[&Object],
        touched: &BTreeMap<usize, String>,
        built: &[Built],
        ties: &[KubernetesTie],
        root: &Path,
        warnings: &mut Vec<String>,
    ) {
        let mut open: Vec<String> = Vec::new();
        let workloads: Vec<usize> = (0..objects.len())
            .filter(|i| is(objects[*i], WORKLOADS) && objects[*i].pods().is_some())
            .collect();
        let services: Vec<Svc> = (0..objects.len())
            .filter(|i| objects[*i].kind == "Service" && group(objects[*i]).is_empty())
            .map(|i| Svc { o: objects[i], i })
            .collect();
        // Objects of a kind Drift does not read.
        for (i, o) in objects.iter().enumerate() {
            let read = is(o, WORKLOADS)
                || is(o, CLOSED)
                || (o.kind == "Service" && group(o).is_empty())
                || is(
                    o,
                    &[("networking.k8s.io", "Ingress"), ("extensions", "Ingress")],
                )
                || (group(o) == "gateway.networking.k8s.io"
                    && matches!(
                        o.kind.as_str(),
                        "HTTPRoute" | "GRPCRoute" | "TLSRoute" | "TCPRoute" | "UDPRoute"
                    ))
                || is(o, &[("route.openshift.io", "Route")]);
            if !read {
                open.push(format!(
                    "{} is a {} of {}, which Drift does not read: it may route requests from outside",
                    named(o),
                    o.kind,
                    text(&o.doc, "apiVersion")
                ));
            }
            let routes = !is(o, WORKLOADS) && !is(o, CLOSED);
            if let (true, Some(why)) = (routes, touched.get(&i)) {
                open.push(format!(
                    "{} routes requests and {why}: what it routes once patched is not read",
                    named(o)
                ));
            }
        }
        // Every path from outside, to the Service it names.
        let mut hops: Vec<Hop> = Vec::new();
        for (i, o) in objects.iter().enumerate() {
            Self::hops_of(o, i, &mut hops, &mut open);
        }
        // What each container is reached by.
        let mut reached: BTreeMap<(usize, usize), Vec<Reach>> = BTreeMap::new();
        let mut selects_nothing: BTreeSet<usize> = BTreeSet::new();
        for hop in &hops {
            let lenient = |s: &&Svc| {
                s.o.name == hop.service
                    && (hop.namespace.is_empty()
                        || s.o.namespace.is_empty()
                        || s.o.namespace == hop.namespace)
            };
            let all: Vec<&Svc> = services.iter().filter(lenient).collect();
            if all.is_empty() {
                open.push(format!(
                    "{} sends requests to Service {}, which is not in the manifests: what it selects is not known",
                    hop.said, hop.service
                ));
                continue;
            }
            // The Service it is proved to send to: of its namespace, the nearest.
            let strict: Vec<&Svc> = all
                .iter()
                .copied()
                .filter(|s| s.o.namespace == hop.namespace)
                .collect();
            let nearest = nearest(hop.from, &strict);
            for s in &all {
                let proven = nearest.is_some_and(|n| std::ptr::eq(n, *s))
                    && hop.opaque.is_none()
                    && !touched.contains_key(&s.i)
                    && !touched.contains_key(&hop.from_i);
                let found = self.follow(
                    hop,
                    s,
                    proven,
                    objects,
                    &workloads,
                    touched,
                    &mut reached,
                    &mut open,
                    0,
                );
                if !found && proven {
                    selects_nothing.insert(s.i);
                }
            }
        }
        for i in &selects_nothing {
            warnings.push(format!(
                "{} is reached from outside and its selector matches no workload of the manifests",
                named(objects[*i])
            ));
        }
        // Each container, tied to code where Drift can tell.
        let tie_of = |w: &Object, c: &Value, n: usize| -> Result<Tie<'_>, String> {
            let label = w.label();
            let cname = text(c, "name");
            let by_person: Vec<&KubernetesTie> = ties
                .iter()
                .filter(|t| {
                    (t.workload == label
                        || (t.workload.matches('/').count() == 1
                            && format!("{}/{}", w.kind, w.name) == t.workload))
                        && t.container.as_deref().is_none_or(|x| x == cname)
                })
                .collect();
            if let Some(t) = by_person.first() {
                if t.container.is_none() && n > 1 {
                    return Err(format!(
                        "{CONFIG_FILE}: `security.kubernetes` ties {} to {}, and its pod has {n} containers: name the one that runs the code with `container` (the entry is ignored)",
                        t.workload,
                        shown_dir(&t.code)
                    ));
                }
                let built = image_ref(text(c, "image")).and_then(|r| {
                    built.iter().find(|bi| {
                        bi.dir == t.code && image_ref(&bi.image).as_deref() == Some(r.as_str())
                    })
                });
                return Ok(Some((
                    t.code.clone(),
                    format!("tied to {} by {CONFIG_FILE}", shown_dir(&t.code)),
                    built,
                )));
            }
            let Some(r) = image_ref(text(c, "image")) else {
                return Ok(None);
            };
            let builders: Vec<&Built> = built
                .iter()
                .filter(|bi| image_ref(&bi.image).as_deref() == Some(r.as_str()))
                .collect();
            let dirs: BTreeSet<&str> = builders.iter().map(|bi| bi.dir.as_str()).collect();
            match dirs.len() {
                0 => Ok(None),
                1 => Ok(Some((
                    builders[0].dir.clone(),
                    format!(
                        "image {} is built from {} by {}",
                        text(c, "image"),
                        shown_dir(&builders[0].dir),
                        builders[0].by
                    ),
                    Some(builders[0]),
                ))),
                _ => Err(format!(
                    "{}: container {cname} runs {}, which the repository builds from more than one directory ({}): which code it runs is not known",
                    named(w),
                    text(c, "image"),
                    dirs.into_iter().collect::<Vec<_>>().join(", ")
                )),
            }
        };
        for &wi in &workloads {
            let w = objects[wi];
            let Some((labels, spec)) = w.pods() else {
                continue;
            };
            let containers: Vec<&Value> = list(spec.get("containers")).collect();
            // The workload itself: what keeps any route of it from being internal.
            let host = spec
                .get("hostNetwork")
                .and_then(scalar)
                .filter(|v| v == "true")
                .map(|_| format!("{} runs on the host's network", named(w)))
                .or_else(|| {
                    containers.iter().find_map(|c| {
                        list(c.get("ports")).find_map(|p| {
                            p.get("hostPort")
                                .and_then(scalar)
                                .map(|hp| format!("{} opens host port {hp}", named(w)))
                        })
                    })
                });
            let pod_marks = |m: Option<&Value>| -> Option<String> {
                let m = m?.as_object()?;
                m.keys().find(|k| MESH_MARKS.contains(&k.as_str())).cloned()
            };
            let template_meta = w
                .doc
                .get("spec")
                .and_then(|s| s.get("template"))
                .and_then(|t| t.get("metadata"));
            let meta = template_meta.or_else(|| w.doc.get("metadata"));
            let mesh = pod_marks(meta.and_then(|m| m.get("annotations")))
                .or_else(|| pod_marks(Some(labels)))
                .or_else(|| {
                    objects
                        .iter()
                        .filter(|n| n.kind == "Namespace" && n.name == w.namespace && !w.namespace.is_empty())
                        .find_map(|n| {
                            let m = n.doc.get("metadata");
                            pod_marks(m.and_then(|m| m.get("labels")))
                                .or_else(|| pod_marks(m.and_then(|m| m.get("annotations"))))
                        })
                })
                .map(|mark| format!("the pods of {} join a service mesh ({mark}), whose routing is not in the manifests", named(w)));
            let patched = touched.get(&wi).map(|why| {
                format!(
                    "{} is changed by a kustomization ({why}): what is deployed of it is not read",
                    named(w)
                )
            });
            let caveat = patched.or(host).or(mesh);
            let mut any_tied = false;
            for (ci, c) in containers.iter().enumerate() {
                let tie = match tie_of(w, c, containers.len()) {
                    Ok(t) => t,
                    Err(why) => {
                        warnings.push(why);
                        None
                    }
                };
                let Some((code, tie, builder)) = tie else {
                    continue;
                };
                any_tied = true;
                let mut reaches = reached.get(&(wi, ci)).cloned().unwrap_or_default();
                // Another container of the pod reached from outside may pass
                // requests on to this one over the pod's own network.
                for (oi, other) in containers.iter().enumerate().filter(|(oi, _)| *oi != ci) {
                    if let Some(r) = reached.get(&(wi, oi)).and_then(|r| r.first()) {
                        reaches.push(Reach::May(format!(
                            "container {} of the same pod is reached from outside ({}) and may pass requests on to it",
                            text(other, "name"),
                            reach_said(r)
                        )));
                    }
                }
                let names: Vec<String> = services
                    .iter()
                    .filter(|s| beside(s.o, w) && selects(s.o, labels))
                    .flat_map(|s| {
                        let (n, ns) = (s.o.name.to_lowercase(), s.o.namespace.to_lowercase());
                        let mut v = vec![n.clone()];
                        if !ns.is_empty() {
                            v.push(format!("{n}.{ns}"));
                            v.push(format!("{n}.{ns}.svc"));
                            v.push(format!("{n}.{ns}.svc.cluster.local"));
                        }
                        v
                    })
                    .collect();
                let who = format!("{}, container {}", named(w), text(c, "name"));
                let start = start_of(root, w, c, builder, &code, &who);
                self.placed.push(Placed {
                    code,
                    who,
                    file: w.path.to_string(),
                    namespace: w.namespace.clone(),
                    tie,
                    reaches,
                    caveat: caveat.clone(),
                    start,
                    names,
                });
            }
            let reached_here = (0..containers.len()).any(|ci| reached.contains_key(&(wi, ci)));
            if !any_tied {
                let images: Vec<String> = containers
                    .iter()
                    .map(|c| text(c, "image").to_string())
                    .collect();
                // A workload reached from outside whose code Drift does not know
                // may run this repository's code, or pass requests on to it.
                let data = !images.is_empty()
                    && images.iter().all(|i| {
                        let r = image_ref(i).unwrap_or_default();
                        DATA_IMAGES.contains(&r.rsplit('/').next().unwrap_or_default())
                    });
                if reached_here && !data {
                    open.push(format!(
                        "{} is reached from outside and runs {}, which Drift ties to no code of the repository: it may run this code, or pass requests on to it (security.kubernetes in {CONFIG_FILE} can say which code it runs)",
                        named(w),
                        images.join(", ")
                    ));
                }
                self.untied.push(Workload {
                    object: w.label(),
                    at: at(w),
                    images,
                    containers: containers
                        .iter()
                        .map(|c| text(c, "name").to_string())
                        .collect(),
                    reached: reached_here,
                });
            }
        }
        // A person's tie that names no workload.
        for t in ties {
            let found = workloads.iter().any(|i| {
                let w = objects[*i];
                t.workload == w.label() || format!("{}/{}", w.kind, w.name) == t.workload
            });
            if !found {
                warnings.push(format!(
                    "{CONFIG_FILE}: `security.kubernetes` names {}, and no such workload is in the manifests Drift read (the entry is ignored)",
                    t.workload
                ));
            }
        }
        self.untied.sort();
        self.open = open.into_iter().next();
    }

    /// The paths from outside that `o` opens, to the Service each names.
    fn hops_of<'o>(o: &'o Object<'o>, i: usize, hops: &mut Vec<Hop<'o>>, open: &mut Vec<String>) {
        let private = private_annotation(o)
            .map(|k| format!("an annotation ({k}) says it may answer only on a private network"));
        let rewrites = path_annotation(o)
            .map(|k| format!("its annotation {k} changes the path or the backend"));
        let opaque = rewrites.clone().or(private.clone());
        let mut hop = |said: String,
                       rule: Option<(String, String, How)>,
                       opaque: Option<String>,
                       service: String,
                       namespace: String,
                       port: Option<String>| {
            hops.push(Hop {
                from: o,
                from_i: i,
                said,
                rule,
                opaque,
                service,
                namespace,
                port,
            });
        };
        let ns = o.namespace.clone();
        let opaque_path = |p: &str| {
            p.contains([
                '*', '?', '(', ')', '[', ']', '{', '}', '^', '$', '|', '+', '\\',
            ])
        };
        if o.kind == "Service" && group(o).is_empty() {
            let kind = o.spec("type").and_then(Value::as_str).unwrap_or_default();
            let external: Vec<String> = list(o.spec("externalIPs")).filter_map(scalar).collect();
            let outside = matches!(kind, "LoadBalancer" | "NodePort") || !external.is_empty();
            if outside {
                let how = if external.is_empty() {
                    format!("type {kind}")
                } else {
                    format!("externalIPs {}", external.join(", "))
                };
                let opaque = if kind == "LoadBalancer" && external.is_empty() {
                    private.clone()
                } else {
                    None
                };
                hop(
                    format!("Service {} ({}, {how})", o.name, at(o)),
                    None,
                    opaque,
                    o.name.clone(),
                    ns.clone(),
                    None,
                );
            }
            return;
        }
        if is(
            o,
            &[("networking.k8s.io", "Ingress"), ("extensions", "Ingress")],
        ) {
            let backend = |b: &Value| -> Option<(String, Option<String>)> {
                if let Some(s) = b.get("service") {
                    let port = s
                        .get("port")
                        .and_then(|p| p.get("number").or_else(|| p.get("name")).and_then(scalar));
                    return Some((text(s, "name").to_string(), port));
                }
                b.get("serviceName")
                    .and_then(scalar)
                    .map(|n| (n, b.get("servicePort").and_then(scalar)))
            };
            let rules: Vec<&Value> = list(o.spec("rules")).collect();
            for rule in &rules {
                let host = text(rule, "host").to_string();
                for p in list(rule.get("http").and_then(|h| h.get("paths"))) {
                    let Some((service, port)) = p.get("backend").and_then(&backend) else {
                        continue;
                    };
                    let path = match text(p, "path") {
                        "" => "/",
                        p => p,
                    }
                    .to_string();
                    let how = match text(p, "pathType") {
                        "Exact" => How::Exact,
                        "Prefix" => How::Prefix,
                        _ => How::Begins,
                    };
                    let (how, why) = if opaque_path(&path) {
                        (
                            How::Opaque,
                            Some(format!(
                                "its path {path} is a pattern Drift does not evaluate"
                            )),
                        )
                    } else if let Some(why) = &rewrites {
                        (How::Opaque, Some(why.clone()))
                    } else {
                        (how, None)
                    };
                    let shown_type = match text(p, "pathType") {
                        "" => "no path type",
                        t => t,
                    };
                    let said = format!(
                        "Ingress {} ({}) routes {host}{path} ({shown_type})",
                        o.name,
                        at(o)
                    );
                    hop(
                        said,
                        Some((host.clone(), trim_path(&path, how), how)),
                        why.or(private.clone()),
                        service,
                        ns.clone(),
                        port,
                    );
                }
            }
            if let Some((service, port)) = o
                .spec("defaultBackend")
                .or_else(|| o.spec("backend"))
                .and_then(&backend)
            {
                let said = format!(
                    "Ingress {} ({}) sends every path no rule takes",
                    o.name,
                    at(o)
                );
                let why = if rules.is_empty() {
                    opaque.clone()
                } else {
                    Some("it is the default backend, which gets the paths no rule of any Ingress takes".to_string())
                };
                let how = if why.is_some() {
                    How::Opaque
                } else {
                    How::Prefix
                };
                hop(
                    said,
                    Some((String::new(), "/".to_string(), how)),
                    why,
                    service,
                    ns.clone(),
                    port,
                );
            }
            return;
        }
        if group(o) == "gateway.networking.k8s.io"
            && matches!(
                o.kind.as_str(),
                "HTTPRoute" | "GRPCRoute" | "TLSRoute" | "TCPRoute" | "UDPRoute"
            )
        {
            let hosts: Vec<String> = list(o.spec("hostnames")).filter_map(scalar).collect();
            let host = if hosts.len() == 1 {
                hosts[0].clone()
            } else {
                String::new()
            };
            let filters_of = |v: &Value| -> Option<String> {
                list(v.get("filters")).find_map(|f| {
                    let t = text(f, "type");
                    matches!(t, "URLRewrite" | "ExtensionRef" | "RequestMirror")
                        .then(|| format!("its filter {t} is not read"))
                })
            };
            for rule in list(o.spec("rules")) {
                let rule_filter = filters_of(rule);
                // A mirror sends a copy to another backend.
                for f in list(rule.get("filters")).filter(|f| text(f, "type") == "RequestMirror") {
                    if let Some(b) = f.get("requestMirror").and_then(|m| m.get("backendRef")) {
                        let bns = b
                            .get("namespace")
                            .and_then(scalar)
                            .unwrap_or_else(|| ns.clone());
                        hop(
                            format!("{} {} ({}) mirrors requests", o.kind, o.name, at(o)),
                            Some((host.clone(), "/".into(), How::Opaque)),
                            Some("a mirror sends it copies of requests".into()),
                            text(b, "name").to_string(),
                            bns,
                            b.get("port").and_then(scalar),
                        );
                    }
                }
                let mut paths: Vec<(String, How)> = Vec::new();
                let mut matches_any = false;
                for m in list(rule.get("matches")) {
                    matches_any = true;
                    match m.get("path") {
                        None => paths.push(("/".to_string(), How::Prefix)),
                        Some(p) => {
                            let value = p
                                .get("value")
                                .and_then(scalar)
                                .unwrap_or_else(|| "/".to_string());
                            let how = match text(p, "type") {
                                "Exact" => How::Exact,
                                "" | "PathPrefix" => How::Prefix,
                                _ => How::Opaque,
                            };
                            paths.push((value, how));
                        }
                    }
                }
                if !matches_any {
                    paths.push(("/".to_string(), How::Prefix));
                }
                for b in list(rule.get("backendRefs")) {
                    if !matches!(text(b, "kind"), "" | "Service")
                        || !matches!(text(b, "group"), "" | "core")
                    {
                        open.push(format!(
                            "{} {} ({}) sends requests to a {} {}, which Drift does not read",
                            o.kind,
                            o.name,
                            at(o),
                            text(b, "kind"),
                            text(b, "name")
                        ));
                        continue;
                    }
                    let bns = b
                        .get("namespace")
                        .and_then(scalar)
                        .unwrap_or_else(|| ns.clone());
                    let port = b.get("port").and_then(scalar);
                    let why = rule_filter.clone().or_else(|| filters_of(b));
                    match o.kind.as_str() {
                        "HTTPRoute" => {
                            for (path, how) in &paths {
                                let (how, why) = match (&why, opaque_path(path) && *how != How::Opaque) {
                                    (Some(w), _) => (How::Opaque, Some(w.clone())),
                                    (None, true) => (How::Opaque, Some(format!("its path {path} is a pattern Drift does not evaluate"))),
                                    (None, false) if *how == How::Opaque => (How::Opaque, Some(format!("its path match {path} is a regular expression, which Drift does not evaluate"))),
                                    (None, false) => (*how, None),
                                };
                                let said = format!("HTTPRoute {} ({}) routes {host}{path}", o.name, at(o));
                                hop(said, Some((host.clone(), trim_path(path, how), how)), why, text(b, "name").to_string(), bns.clone(), port.clone());
                            }
                        }
                        "GRPCRoute" => hop(format!("GRPCRoute {} ({})", o.name, at(o)), Some((host.clone(), "/".into(), How::Opaque)), Some("a gRPC route is matched by service and method, which Drift does not read as paths".into()), text(b, "name").to_string(), bns, port),
                        _ => hop(format!("{} {} ({}) passes every request through", o.kind, o.name, at(o)), None, None, text(b, "name").to_string(), bns, port),
                    }
                }
            }
            return;
        }
        if is(o, &[("route.openshift.io", "Route")]) {
            let host = o.spec("host").and_then(scalar).unwrap_or_default();
            let path = o
                .spec("path")
                .and_then(scalar)
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "/".to_string());
            let port = o
                .spec("port")
                .and_then(|p| p.get("targetPort"))
                .and_then(scalar);
            let (how, why) = if opaque_path(&path) {
                (
                    How::Opaque,
                    Some(format!(
                        "its path {path} is a pattern Drift does not evaluate"
                    )),
                )
            } else {
                (How::Begins, rewrites.clone())
            };
            let how = if why.is_some() { How::Opaque } else { how };
            let mut targets: Vec<&Value> = o.spec("to").into_iter().collect();
            targets.extend(list(o.spec("alternateBackends")));
            for to in targets {
                if !matches!(text(to, "kind"), "" | "Service") {
                    continue;
                }
                let said = format!("Route {} ({}) routes {host}{path}", o.name, at(o));
                hop(
                    said,
                    Some((host.clone(), trim_path(&path, how), how)),
                    why.clone().or(private.clone()),
                    text(to, "name").to_string(),
                    ns.clone(),
                    port.clone(),
                );
            }
        }
    }

    /// Follows `hop` through the Service `s` to the containers it selects, adding
    /// what reaches each to `reached`. Whether it selects any workload.
    #[allow(clippy::too_many_arguments)]
    fn follow(
        &mut self,
        hop: &Hop,
        s: &Svc,
        proven: bool,
        objects: &[&Object],
        workloads: &[usize],
        touched: &BTreeMap<usize, String>,
        reached: &mut BTreeMap<(usize, usize), Vec<Reach>>,
        open: &mut Vec<String>,
        depth: usize,
    ) -> bool {
        let to = match &hop.port {
            Some(p) => format!("Service {}:{p}", s.o.name),
            None => format!("Service {}", s.o.name),
        };
        let said = if hop.from_i == s.i {
            hop.said.clone()
        } else {
            format!("{} to {to}", hop.said)
        };
        // An ExternalName Service is another name: one of the cluster's is followed.
        if s.o.spec("type").and_then(Value::as_str) == Some("ExternalName") {
            let name =
                s.o.spec("externalName")
                    .and_then(scalar)
                    .unwrap_or_default();
            let parts: Vec<&str> = name.trim_end_matches('.').split('.').collect();
            match parts.as_slice() {
                [svc, ns, "svc", ..] | [svc, ns] if depth == 0 => {
                    let next = Hop {
                        from: hop.from,
                        from_i: hop.from_i,
                        said: format!("{said} (ExternalName {name})"),
                        rule: hop.rule.clone(),
                        opaque: hop.opaque.clone(),
                        service: svc.to_string(),
                        namespace: ns.to_string(),
                        port: hop.port.clone(),
                    };
                    let mut any = false;
                    for (i, o) in objects.iter().enumerate() {
                        if o.kind == "Service"
                            && group(o).is_empty()
                            && o.name == next.service
                            && (o.namespace == next.namespace || o.namespace.is_empty())
                        {
                            let strict = o.namespace == next.namespace;
                            any |= self.follow(
                                &next,
                                &Svc { o, i },
                                proven && strict,
                                objects,
                                workloads,
                                touched,
                                reached,
                                open,
                                depth + 1,
                            );
                        }
                    }
                    return any;
                }
                [_] => open.push(format!(
                    "{said}, an ExternalName Service whose name {name} Drift cannot resolve"
                )),
                _ => {}
            }
            return false;
        }
        if s.o
            .spec("selector")
            .and_then(Value::as_object)
            .is_none_or(|m| m.is_empty())
        {
            open.push(format!("{said}, and {} selects no pods by label: its endpoints are set apart and may be any pod", named(s.o)));
            return false;
        }
        // The Service's ports the hop comes in by, and the pod port each sends to.
        let ports: Vec<&Value> = list(s.o.spec("ports")).collect();
        let chosen: Vec<&Value> = ports
            .iter()
            .copied()
            .filter(|p| match &hop.port {
                None => true,
                Some(want) => {
                    p.get("port").and_then(scalar).as_deref() == Some(want.as_str())
                        || text(p, "name") == want
                }
            })
            .collect();
        let port_known = !chosen.is_empty() || hop.port.is_none();
        let chosen = if chosen.is_empty() {
            ports.clone()
        } else {
            chosen
        };
        let targets: Vec<String> = chosen
            .iter()
            .map(|p| {
                p.get("targetPort")
                    .or_else(|| p.get("port"))
                    .and_then(scalar)
                    .unwrap_or_default()
            })
            .collect();
        let selected: Vec<usize> = workloads
            .iter()
            .copied()
            .filter(|w| {
                beside(s.o, objects[*w])
                    && objects[*w]
                        .pods()
                        .is_some_and(|(labels, _)| selects(s.o, labels))
            })
            .collect();
        // Proved: of the Service's own namespace, the nearest.
        let strict: Vec<usize> = selected
            .iter()
            .copied()
            .filter(|w| objects[*w].namespace == s.o.namespace)
            .collect();
        let near = nearest_workloads(s.o, &strict, objects);
        for &wi in &selected {
            let w = objects[wi];
            let Some((_, spec)) = w.pods() else { continue };
            let containers: Vec<&Value> = list(spec.get("containers")).collect();
            let declared = |t: &str, c: &Value| {
                list(c.get("ports")).any(|p| {
                    p.get("containerPort").and_then(scalar).as_deref() == Some(t)
                        || text(p, "name") == t
                })
            };
            let mut hit: BTreeSet<usize> = BTreeSet::new();
            let mut sure = port_known && !targets.is_empty();
            for t in &targets {
                let by_port: Vec<usize> = (0..containers.len())
                    .filter(|ci| declared(t, containers[*ci]))
                    .collect();
                match (by_port.is_empty(), containers.len()) {
                    (false, _) => hit.extend(by_port),
                    (true, 1) => {
                        hit.insert(0);
                    }
                    (true, _) => {
                        sure = false;
                        hit.extend(0..containers.len());
                    }
                }
            }
            if targets.is_empty() {
                hit.extend(0..containers.len());
            }
            let proven = proven && sure && near.contains(&wi) && !touched.contains_key(&wi);
            // What a kustomization does to the workload, its Service or the route.
            let touch = [wi, s.i, hop.from_i]
                .iter()
                .find_map(|i| touched.get(i))
                .map(String::as_str);
            for ci in hit {
                let chain = format!("{said}, which selects {}", named(w));
                let reach = match (&hop.rule, proven) {
                    (None, true) => Reach::Every(said.clone()),
                    (Some((host, path, how)), true) => Reach::Path(PathRule {
                        said: said.clone(),
                        host: host.clone(),
                        path: path.clone(),
                        how: *how,
                        backend: format!("{}/{}:{}", s.o.namespace, s.o.name, targets.join(",")),
                    }),
                    (Some((host, path, how)), false)
                        if hop.opaque.is_none() && *how != How::Opaque =>
                    {
                        let why = if !sure {
                            format!(
                                "{chain}, and which container of the pod it reaches is not in the manifests"
                            )
                        } else if let Some(why) = touch {
                            format!("{chain}, and {why}")
                        } else {
                            format!(
                                "{chain}, and whether they are applied to one namespace is not in the manifests"
                            )
                        };
                        let rule = PathRule {
                            said: chain,
                            host: host.clone(),
                            path: path.clone(),
                            how: *how,
                            backend: format!(
                                "{}/{}:{}",
                                s.o.namespace,
                                s.o.name,
                                targets.join(",")
                            ),
                        };
                        Reach::MayPath(rule, why)
                    }
                    (_, false) => Reach::May(match (&hop.opaque, sure) {
                        (Some(why), _) => format!("{chain}; {why}"),
                        (None, false) => format!(
                            "{chain}, and which container of the pod it reaches is not in the manifests"
                        ),
                        (None, true) if touch.is_some() => {
                            format!("{chain}, and {}", touch.unwrap_or_default())
                        }
                        (None, true) => format!(
                            "{chain}, and whether they are applied to one namespace is not in the manifests"
                        ),
                    }),
                };
                reached.entry((wi, ci)).or_default().push(reach);
            }
        }
        // Every rule that comes to the Service competes with the others.
        if let Some((host, path, how)) = &hop.rule {
            self.rules.push(PathRule {
                said: match &hop.opaque {
                    Some(why) => format!("{said} ({why})"),
                    None => said.clone(),
                },
                host: host.clone(),
                path: path.clone(),
                how: if hop.opaque.is_some() {
                    How::Opaque
                } else {
                    *how
                },
                backend: format!("{}/{}:{}", s.o.namespace, s.o.name, targets.join(",")),
            });
        }
        !selected.is_empty()
    }

    /// The exposure of `route` (written `shown`, read by `adapter`) of the container
    /// `p`, and what says so; `known` are the routes of its code.
    fn verdict(
        &self,
        b: &Boundaries,
        p: &Placed,
        route: &Route,
        shown: &str,
        adapter: &str,
        known: &[String],
    ) -> (Exposure, String) {
        let tie = &p.tie;
        for r in &p.reaches {
            if let Reach::Every(chain) = r {
                return (
                    Exposure::Public,
                    format!("{chain}, which selects {}: every path ({tie})", p.who),
                );
            }
        }
        let mut outranked: Option<String> = None;
        for r in &p.reaches {
            let Reach::Path(rule) = r else { continue };
            if !rule.every(route) {
                continue;
            }
            let rival = self.rules.iter().find(|q| {
                q.backend != rule.backend
                    && q.hosts_overlap(rule)
                    && q.outranks(rule)
                    && q.may(shown)
            });
            match rival {
                None => {
                    return (
                        Exposure::Public,
                        format!("{}, which selects {} ({tie})", rule.said, p.who),
                    );
                }
                Some(q) => {
                    outranked.get_or_insert(format!(
                        "{} may route {shown} to {}, but {} may take it first",
                        rule.said, p.who, q.said
                    ));
                }
            }
        }
        let unknown = |why: String| (Exposure::Unknown, format!("{why} ({tie})"));
        if let Some(why) = outranked {
            return unknown(why);
        }
        for r in &p.reaches {
            match r {
                Reach::May(why) => return unknown(why.clone()),
                Reach::Path(rule) if rule.may(shown) => {
                    return unknown(format!(
                        "{} may route {shown} to {}, which Drift could not confirm",
                        rule.said, p.who
                    ));
                }
                Reach::MayPath(rule, why) if rule.may(shown) => return unknown(why.clone()),
                _ => {}
            }
        }
        if let Some(why) = p.caveat.as_ref().or(self.open.as_ref()) {
            return unknown(why.clone());
        }
        let routed: Vec<&PathRule> = p
            .reaches
            .iter()
            .filter_map(|r| match r {
                Reach::Path(rule) | Reach::MayPath(rule, _) => Some(rule),
                _ => None,
            })
            .collect();
        if let Some(first) = routed.first() {
            if let Some(r) = routed
                .iter()
                .find(|r| r.path != "/" && !known.iter().any(|k| r.may(k)))
            {
                return unknown(format!(
                    "{}, which selects {}, where Drift reads no route of it: its routes may be served under a prefix",
                    r.said, p.who
                ));
            }
            if adapter == SERVED_ELSEWHERE {
                return unknown(format!(
                    "{}, which selects {}, and an include Drift cannot follow may serve the handler of {shown} on other paths",
                    first.said, p.who
                ));
            }
            if !EVERY_MOUNT_LISTED.contains(&adapter) {
                return unknown(format!(
                    "{}, which selects {}, and a {adapter} route may be mounted on paths Drift does not read",
                    first.said, p.who
                ));
            }
            if let Some(why) = &p.start.unread {
                return unknown(why.clone());
            }
            let svc = p.who.clone();
            if let Some(why) = b.served_by(
                &p.who,
                &svc,
                &p.code,
                p.start.target.as_ref(),
                p.start.next,
                &self.root,
                adapter,
            ) {
                return unknown(why);
            }
        }
        (
            Exposure::Internal,
            format!(
                "{}: nothing in the Kubernetes manifests routes {shown} to it from outside ({}){}; what the cluster has beyond the manifests (its ingress controller's own settings) is not read ({tie})",
                p.who,
                match routed.as_slice() {
                    [] => "no Ingress, Gateway route, OpenShift Route, or Service of type LoadBalancer or NodePort reaches it".to_string(),
                    rules => format!("{} take{} none of its paths", rules.iter().map(|r| r.said.clone()).collect::<Vec<_>>().join("; "), if rules.len() == 1 { "s" } else { "" }),
                },
                match p.start.absent.as_slice() {
                    [] => String::new(),
                    from => format!("; not read: its environment from {}", from.join(", ")),
                }
            ),
        )
    }

    /// The exposure of the container `p` as a whole, for an entry point that is not
    /// a route.
    fn whole(&self, p: &Placed) -> (Exposure, String) {
        let tie = &p.tie;
        for r in &p.reaches {
            match r {
                Reach::Every(chain) => {
                    return (
                        Exposure::Public,
                        format!("{chain}, which selects {}: every path ({tie})", p.who),
                    );
                }
                Reach::Path(rule) => {
                    return (
                        Exposure::Public,
                        format!("{}, which selects {} ({tie})", rule.said, p.who),
                    );
                }
                Reach::May(_) | Reach::MayPath(..) => {}
            }
        }
        if let Some(why) = p
            .reaches
            .iter()
            .find_map(|r| match r {
                Reach::May(w) | Reach::MayPath(_, w) => Some(w),
                _ => None,
            })
            .or(p.caveat.as_ref())
            .or(self.open.as_ref())
        {
            return (Exposure::Unknown, format!("{why} ({tie})"));
        }
        (
            Exposure::Internal,
            format!(
                "{}: nothing in the Kubernetes manifests reaches it from outside ({tie})",
                p.who
            ),
        )
    }
}

fn reach_said(r: &Reach) -> String {
    match r {
        Reach::Every(s) | Reach::May(s) => s.clone(),
        Reach::Path(rule) | Reach::MayPath(rule, _) => rule.said.clone(),
    }
}

/// A rule's path as it is compared: a prefix without its `/` at the end.
fn trim_path(path: &str, how: How) -> String {
    match how {
        How::Prefix | How::Begins if path.len() > 1 => path.trim_end_matches('/').to_string(),
        _ => path.to_string(),
    }
}

fn shown_dir(dir: &str) -> &str {
    if dir.is_empty() {
        "the repository"
    } else {
        dir
    }
}

/// The two may be of one namespace, as far as they say.
fn beside(a: &Object, b: &Object) -> bool {
    a.namespace.is_empty() || b.namespace.is_empty() || a.namespace == b.namespace
}

/// Every label of the Service's selector is a label of the pods.
fn selects(service: &Object, labels: &Value) -> bool {
    service
        .spec("selector")
        .and_then(Value::as_object)
        .is_some_and(|sel| {
            !sel.is_empty()
                && sel
                    .iter()
                    .all(|(k, v)| labels.get(k).is_some_and(|l| scalar(l) == scalar(v)))
        })
}

fn dir_of(p: &str) -> &str {
    p.rsplit_once('/').map_or("", |(d, _)| d)
}

/// The one Service of `candidates` nearest `from`: of its file, else of its
/// directory, else the only one. None where the nearest are more than one.
fn nearest<'a, 'o>(from: &Object, candidates: &[&'a Svc<'o>]) -> Option<&'a Svc<'o>> {
    for tier in 0..3 {
        let picked: Vec<&&Svc> = candidates
            .iter()
            .filter(|s| match tier {
                0 => s.o.path == from.path,
                1 => dir_of(s.o.path) == dir_of(from.path),
                _ => true,
            })
            .collect();
        match picked.as_slice() {
            [] => continue,
            [one] => return Some(**one),
            _ => return None,
        }
    }
    None
}

/// The workloads of `candidates` nearest the Service: of its file, else of its
/// directory, else all.
fn nearest_workloads(
    service: &Object,
    candidates: &[usize],
    objects: &[&Object],
) -> BTreeSet<usize> {
    for tier in 0..3 {
        let picked: BTreeSet<usize> = candidates
            .iter()
            .copied()
            .filter(|w| match tier {
                0 => objects[*w].path == service.path,
                1 => dir_of(objects[*w].path) == dir_of(service.path),
                _ => true,
            })
            .collect();
        if !picked.is_empty() {
            return picked;
        }
    }
    BTreeSet::new()
}

/// What the container `c` of `w` starts with, read as a compose service's start
/// command is ([`super::started`]): its `command` over the Dockerfile's
/// `ENTRYPOINT`, its `args` over `CMD`.
fn start_of(
    root: &Path,
    w: &Object,
    c: &Value,
    builder: Option<&Built>,
    code: &str,
    who: &str,
) -> Start {
    let mut def = serde_json::Map::new();
    let mut start = Start::default();
    let words = |k: &str| list(c.get(k)).filter_map(scalar).collect::<Vec<_>>();
    if words("command")
        .iter()
        .chain(words("args").iter())
        .any(|w| w.contains('$'))
    {
        start.unread = Some(format!(
            "{who}: its command expands variables (`$(...)`), which Drift does not; so where its routes are served is not known"
        ));
        return start;
    }
    if let Some(v) = c.get("command") {
        def.insert("entrypoint".into(), v.clone());
    }
    if let Some(v) = c.get("args") {
        def.insert("command".into(), v.clone());
    }
    if let Some(v) = c.get("workingDir") {
        def.insert("working_dir".into(), v.clone());
    }
    let env: Vec<Value> = list(c.get("env"))
        .map(|e| match e.get("value").and_then(scalar) {
            Some(v) if e.get("valueFrom").is_none() => {
                Value::String(format!("{}={v}", text(e, "name")))
            }
            _ => Value::String(text(e, "name").to_string()),
        })
        .collect();
    if !env.is_empty() {
        def.insert("environment".into(), Value::Array(env));
    }
    start.absent = list(c.get("envFrom"))
        .filter_map(|e| {
            e.get("configMapRef")
                .map(|r| format!("ConfigMap {}", text(r, "name")))
                .or_else(|| {
                    e.get("secretRef")
                        .map(|r| format!("Secret {}", text(r, "name")))
                })
        })
        .collect();
    let volumes: Vec<(Option<String>, String)> = list(c.get("volumeMounts"))
        .map(|m| (None, text(m, "mountPath").to_string()))
        .collect();
    let dockerfile = builder.and_then(|b| {
        let text = read_small(&root.join(b.dockerfile.as_deref()?))?;
        Some((b.context.clone()?, text))
    });
    let base = dir_of(w.path);
    let s = super::started(
        root,
        base,
        who,
        &def,
        dockerfile.as_ref().map(|(c, t)| (c.as_str(), t.as_str())),
        &volumes,
        Some(code),
    );
    start.unread = s.unread;
    start.target = s.target;
    start.next = s.next;
    start
}

impl Boundaries {
    /// Decides each entry point of code a workload of the manifests runs, beside what
    /// the compose files and a Terraform tie said of it: the most exposed of them
    /// wins, each named where they differ, as [`Boundaries::expose_routes`] does.
    pub(super) fn expose_cluster(&self, entries: &mut [EntryRow], adapters: &[&str]) {
        let Some(c) = &self.cluster else { return };
        let pick = |path: &str| -> Option<&str> {
            c.placed
                .iter()
                .filter(|p| p.covers(path))
                .map(|p| p.code.as_str())
                .max_by_key(|code| code.len())
        };
        let route_of = |e: &EntryRow| {
            Some(e)
                .filter(|e| e.kind == "http" || e.kind == "page")
                .and_then(|e| Route::parse(e.route.as_deref()?))
        };
        let mut known: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for e in entries.iter() {
            if let (Some(code), Some(_)) = (pick(&e.path), route_of(e)) {
                known
                    .entry(code.to_string())
                    .or_default()
                    .push(e.route.clone().unwrap_or_default());
            }
        }
        for (e, adapter) in entries.iter_mut().zip(adapters) {
            if self
                .rule(&e.path)
                .is_some_and(|r| r.source.starts_with("config"))
            {
                continue;
            }
            let Some(code) = pick(&e.path) else {
                // Code no workload is tied to: one the manifests may still run.
                if e.exposure == Exposure::Internal
                    && let Some(why) = &c.open
                {
                    e.exposure = Exposure::Unknown;
                    e.boundary = Some(format!(
                        "{}; but {why}",
                        e.boundary.as_deref().unwrap_or_default()
                    ));
                }
                continue;
            };
            let shown = e.route.clone().unwrap_or_default();
            let mut best: Option<(Exposure, String, String)> = None;
            for p in c.placed.iter().filter(|p| p.code == code) {
                let (x, why) = match route_of(e) {
                    Some(r) => c.verdict(
                        self,
                        p,
                        &r,
                        &shown,
                        adapter,
                        known.get(code).map_or(&[], Vec::as_slice),
                    ),
                    None => c.whole(p),
                };
                if best.as_ref().is_none_or(|(have, _, _)| x < *have) {
                    best = Some((x, why, p.file.clone()));
                }
            }
            let Some((x, why, file)) = best else { continue };
            let mut said: Vec<Description> = if !e.descriptions.is_empty() {
                e.descriptions.clone()
            } else if let Some(other) = &e.boundary {
                vec![Description {
                    compose: if e.tied {
                        "the Terraform tie"
                    } else {
                        super::COMPOSE_AS_A_WHOLE
                    }
                    .to_string(),
                    exposure: e.exposure,
                    boundary: other.clone(),
                }]
            } else {
                Vec::new()
            };
            if said.is_empty() {
                e.exposure = x;
                e.boundary = Some(why);
                e.tied = false;
            } else {
                let before = e.exposure;
                said.push(Description {
                    compose: file,
                    exposure: x,
                    boundary: why,
                });
                said.sort_by(|a, b| (a.exposure, &a.compose).cmp(&(b.exposure, &b.compose)));
                e.exposure = said[0].exposure;
                e.tied = e.tied && e.exposure == before;
                e.boundary = Some(
                    said.iter()
                        .map(|d| {
                            format!("{} in {} ({})", d.exposure.as_str(), d.compose, d.boundary)
                        })
                        .collect::<Vec<_>>()
                        .join("; "),
                );
                e.descriptions = said;
            }
            if e.exposure == Exposure::Internal
                && let Some(note) = self.unread_note(code)
            {
                e.exposure = Exposure::Unknown;
                e.boundary = Some(format!(
                    "{}; {note}",
                    e.boundary.as_deref().unwrap_or_default()
                ));
            }
        }
    }

    /// Reads, in the facts, whether an application of the repository that the
    /// manifests open to the outside may relay requests to a workload of other code
    /// ([`Boundaries::set_relays`] for compose services): a request it sends whose
    /// URL is not read and may go to one of the workload's Service names, with the
    /// name in its code or its own manifest. No route of that workload is then
    /// internal.
    pub(super) fn cluster_relays(&mut self, repo: &drift_core::RepoFacts) {
        let Some(c) = &mut self.cluster else { return };
        let clients: Vec<(String, String, String)> = c
            .placed
            .iter()
            .filter(|q| q.reached())
            .map(|q| (q.code.clone(), q.who.clone(), q.namespace.clone()))
            .collect();
        let root = c.root.clone();
        for p in c
            .placed
            .iter_mut()
            .filter(|p| p.caveat.is_none() && !p.names.is_empty())
        {
            for (from, client, ns) in &clients {
                if *from == p.code
                    || !(ns.is_empty() || p.namespace.is_empty() || *ns == p.namespace)
                {
                    continue;
                }
                let under = |path: &str| {
                    from.is_empty()
                        || path
                            .strip_prefix(from.as_str())
                            .is_some_and(|r| r.starts_with('/'))
                };
                let sent = repo
                    .files
                    .iter()
                    .filter(|f| under(&f.path) && !f.directives.iter().any(|d| d == "use client"))
                    .find_map(|f| {
                        let o = f.outgoing.iter().find(|o| {
                            !o.unread.is_empty()
                                && drift_core::practice::outgoing_reaches(&o.url, &p.names)
                        })?;
                        Some((f, o))
                    });
                let Some((file, request)) = sent else {
                    continue;
                };
                if super::named_in_files(&root, from, &p.names).is_none() {
                    continue;
                }
                p.caveat = Some(format!(
                    "{client} is reached from outside and may relay requests to it: {}({}:{}) sends a request, and {}",
                    match request.within.as_str() {
                        "" => String::new(),
                        name => format!("`{name}` "),
                    },
                    file.path,
                    request.line,
                    request.unread
                ));
                break;
            }
        }
    }

    /// The workloads of the Kubernetes manifests that Drift ties to no code
    /// (`drift setup` asks which code they run).
    pub fn untied_workloads(&self) -> &[Workload] {
        self.cluster.as_ref().map_or(&[], |c| c.untied.as_slice())
    }

    /// Whether a workload of the Kubernetes manifests is tied to the code at `path`.
    pub fn kubernetes_runs(&self, path: &str) -> bool {
        self.cluster
            .as_ref()
            .is_some_and(|c| c.placed.iter().any(|p| p.covers(path)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(path: &str, how: How) -> PathRule {
        PathRule {
            said: String::new(),
            host: "shop.example.com".into(),
            path: path.into(),
            how,
            backend: "shop/web:80".into(),
        }
    }

    fn route(r: &str) -> Route {
        Route::parse(r).unwrap()
    }

    /// An image is compared without its tag, its digest or Docker Hub's default
    /// names, and one written with a variable compares with nothing.
    #[test]
    fn an_image_is_compared_by_its_repository() {
        assert_eq!(
            image_ref("ghcr.io/acme/web:1.4.2").as_deref(),
            Some("ghcr.io/acme/web")
        );
        assert_eq!(
            image_ref("docker.io/library/nginx:1.27@sha256:ab").as_deref(),
            Some("nginx")
        );
        assert_eq!(
            image_ref("localhost:5000/web").as_deref(),
            Some("localhost:5000/web")
        );
        assert_eq!(image_ref("ghcr.io/acme/web:${TAG}"), None);
        assert_eq!(image_ref(""), None);
    }

    /// A prefix takes a route by path element, not by characters; an exact path
    /// takes only itself; `ImplementationSpecific` proves by element and may take
    /// what only begins with the same characters.
    #[test]
    fn a_path_rule_takes_routes_by_path_element() {
        let prefix = rule("/api", How::Prefix);
        assert!(prefix.every(&route("/api/orders")));
        assert!(prefix.every(&route("/api")));
        assert!(!prefix.every(&route("/apiv2/orders")));
        assert!(!prefix.may("/apiv2/orders"));
        assert!(prefix.may("/API/orders"));
        let exact = rule("/api", How::Exact);
        assert!(exact.every(&route("/api")));
        assert!(!exact.every(&route("/api/orders")));
        let begins = rule("/api", How::Begins);
        assert!(begins.every(&route("/api/orders")));
        assert!(!begins.every(&route("/apiv2")));
        assert!(begins.may("/apiv2"));
        assert!(rule("/", How::Prefix).every(&route("/admin/stats")));
        assert!(!rule("/x", How::Opaque).every(&route("/x")));
        assert!(rule("/x", How::Opaque).may("/y"));
    }

    /// Of two rules that take one request, the longer path wins, an exact path
    /// wins over a prefix of its length, and a rule Drift does not read may win.
    #[test]
    fn the_longest_rule_outranks() {
        let api = rule("/api", How::Prefix);
        let admin = rule("/api/admin", How::Prefix);
        assert!(admin.outranks(&api));
        assert!(!api.outranks(&admin));
        assert!(!api.outranks(&rule("/api", How::Exact)));
        assert!(rule("/", How::Opaque).outranks(&admin));
        let mut other = rule("/api", How::Prefix);
        other.host = "admin.example.com".into();
        assert!(!api.hosts_overlap(&other));
        other.host = "*.example.com".into();
        assert!(api.hosts_overlap(&other));
    }
}
