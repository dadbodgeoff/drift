//! What forwards requests in the repository's Terraform, read as one kind of fact
//! whatever the cloud: a [`Forward`] sends some requests (every path, some path
//! patterns, one API path and method) from somewhere (the internet, inside a
//! network, a place not known) to the resources it names, followed through the
//! resources that pass requests on (a target group to what is attached to it, a
//! Lambda alias to its function, a backend service to its network endpoint group,
//! that group to its Cloud Run service).
//!
//! Read, each in its plain form:
//!
//! - AWS load balancers: `aws_lb_listener_rule` (one `forward` action, after any
//!   `authenticate-*` ones, and `path_pattern` conditions) and `aws_lb_listener`
//!   default actions, from the load balancer the listener names (`internal = true`
//!   is inside, unless something that can reach a private load balancer names it);
//! - API Gateway REST APIs (`aws_api_gateway_resource` paths, `_method`,
//!   `_integration`) and HTTP APIs (`aws_apigatewayv2_route` route keys and
//!   `_integration`), with each method's or route's authorization as a fact;
//! - Lambda function URLs;
//! - GCP URL maps (`host_rule`, `path_matcher`, `path_rule`, default services) from
//!   the forwarding rules that reach them, and Cloud Run services from their
//!   ingress and whether their invoker role is granted to `allUsers`.
//!
//! Security groups, IAM policies other than Cloud Run's invoker, CloudFront
//! behaviours and Azure are not read.

use std::collections::{BTreeMap, BTreeSet};

use super::values::{self, Env, Inst, Val};
use super::{Addr, Block, Item, Module, Res};
use crate::gateway::{Glob, Route};

/// Which requests a forward sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Paths {
    /// Every request.
    Every,
    /// An AWS load-balancer rule's path patterns (`*` any run of characters, `?` one).
    Lb(Vec<String>),
    /// Path patterns as a load balancer's (`take`; empty for every path), less what
    /// other rules beside them (`others`) send elsewhere.
    Globs {
        take: Vec<String>,
        others: Vec<String>,
    },
    /// An API Gateway path (`/users/{id}`, `/{proxy+}`).
    Template(String),
}

/// Where the requests a forward sends come from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum From {
    Internet,
    /// Only from inside a network, and why.
    Inside(String),
    /// Not known, and why.
    Unknown(String),
}

/// Where a forward may send requests to a target Drift cannot name: what says so,
/// and the kinds of target it could be.
pub(super) type Any = Option<(String, &'static [&'static str])>;

/// One thing of the repository's Terraform that sends requests on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Forward {
    /// What it is, for messages: ``listener rule `api` (infra/main.tf:3)``.
    pub shown: String,
    /// The module it is in.
    pub module: String,
    /// The resources of its module it sends requests to, with those they pass them on to.
    pub to: BTreeSet<Addr>,
    /// Where it may send requests to a target Drift cannot name: what says so, and the
    /// kinds of target it could be.
    pub any: Any,
    pub paths: Paths,
    /// The method it is for; none for any.
    pub method: Option<String>,
    pub from: From,
    /// Why which requests it sends is not read: it may carry any route.
    pub unread: Option<String>,
    /// Said after `unread` or `any`: the expression the files do not settle.
    pub detail: Option<String>,
    /// Why the path the application sees may not be the path matched.
    pub rewrites: Option<String>,
    /// Facts said with it (an authorizer, `authorization = "NONE"`).
    pub notes: Vec<String>,
}

impl Forward {
    fn new(shown: String, module: &str, paths: Paths, from: From) -> Forward {
        Forward {
            shown,
            module: module.to_string(),
            to: BTreeSet::new(),
            any: None,
            paths,
            method: None,
            from,
            unread: None,
            detail: None,
            rewrites: None,
            notes: Vec::new(),
        }
    }
}

pub(super) const TARGET_GROUPS: &[&str] = &["aws_lb_target_group", "aws_alb_target_group"];
const LAMBDAS: &[&str] = &["aws_lambda_function", "aws_lambda_alias"];
/// What a load balancer may send to: a target group, and what is attached to it.
const LB_KINDS: &[&str] = &[
    "aws_lb_target_group",
    "aws_alb_target_group",
    "aws_lambda_function",
    "aws_lambda_alias",
];
/// What a GCP load balancer may send to.
const GCP_KINDS: &[&str] = &[
    "google_compute_backend_service",
    "google_compute_region_backend_service",
    "google_cloud_run_service",
    "google_cloud_run_v2_service",
];
/// Any target Drift reads.
const ANY_KINDS: &[&str] = super::TARGET_KINDS;

const RULES: &[&str] = &["aws_lb_listener_rule", "aws_alb_listener_rule"];
const LISTENERS: &[&str] = &["aws_lb_listener", "aws_alb_listener"];
const BALANCERS: &[&str] = &["aws_lb", "aws_alb"];

/// One instance of a resource, with what its expressions are worked out against.
struct Cx<'a> {
    m: &'a Module,
    env: Env<'a>,
    inst: Inst,
}

impl Cx<'_> {
    /// The value of `attr` of `b`; why not, naming it.
    fn val(&self, b: &Block, attr: &str) -> Option<Result<Val, String>> {
        let expr = b.attr(attr)?;
        Some(
            values::eval(expr, &self.env, &self.inst)
                .map_err(|e| format!("`{attr} = {expr}`: {e}")),
        )
    }

    fn text(&self, b: &Block, attr: &str) -> Option<Result<String, String>> {
        let expr = b.attr(attr).unwrap_or_default().to_string();
        self.val(b, attr).map(|v| {
            v.and_then(|v| {
                v.text()
                    .ok_or_else(|| format!("`{attr} = {expr}` is not a string"))
            })
        })
    }

    fn texts(&self, b: &Block, attr: &str) -> Option<Result<Vec<String>, String>> {
        let expr = b.attr(attr).unwrap_or_default().to_string();
        self.val(b, attr).map(|v| {
            v.and_then(|v| {
                v.texts()
                    .ok_or_else(|| format!("`{attr} = {expr}` is not a list of strings"))
            })
        })
    }

    /// The resources of the module `expr` names (`aws_lb_target_group.api.arn`,
    /// `"integrations/${aws_apigatewayv2_integration.x.id}"`).
    fn refs(&self, expr: &str) -> BTreeSet<Addr> {
        refs(self.m, expr)
    }

    /// The instance of a resource of `kind` that `expr` names: its name, and the key
    /// of the instance where it is indexed (`aws_api_gateway_resource.r[each.key].id`).
    fn named(&self, expr: &str, kind: &str) -> Option<(String, Option<String>)> {
        let rest = expr.find(&format!("{kind}."))?;
        if rest > 0
            && expr[..rest]
                .chars()
                .last()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
        {
            return None;
        }
        let rest = &expr[rest + kind.len() + 1..];
        let end = rest
            .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-'))
            .unwrap_or(rest.len());
        let name = rest[..end].to_string();
        let key = rest[end..].strip_prefix('[').and_then(|k| {
            let k = &k[..k.find(']')?];
            values::eval(k, &self.env, &self.inst).ok()?.text()
        });
        Some((name, key))
    }
}

/// The resources of the module `m` that `expr` names.
pub(super) fn refs(m: &Module, expr: &str) -> BTreeSet<Addr> {
    let mut out = BTreeSet::new();
    let mut word = String::new();
    for c in expr.chars().chain(std::iter::once(' ')) {
        if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' {
            word.push(c);
        } else {
            // `data.x.y` and `module.x.y` are not references to a resource.
            let parts: Vec<&str> = word.split('.').collect();
            if parts.len() >= 2 && m.has(parts[0], parts[1]) {
                out.insert((parts[0].to_string(), parts[1].to_string()));
            }
            word.clear();
        }
    }
    out
}

/// Every resource of the module that any expression of `b` names, at any depth.
fn refs_in(m: &Module, b: &Block) -> BTreeSet<Addr> {
    let mut out = BTreeSet::new();
    for i in &b.body {
        match i {
            Item::Attr(_, v) => out.extend(refs(m, v)),
            Item::Block(inner) => out.extend(refs_in(m, inner)),
        }
    }
    out
}

/// `start` and the resources they pass requests on to, and where one passes them to a
/// target Drift cannot name.
fn closure(m: &Module, start: BTreeSet<Addr>) -> (BTreeSet<Addr>, Any) {
    let mut seen: BTreeSet<Addr> = BTreeSet::new();
    let mut todo: Vec<Addr> = start.into_iter().collect();
    let mut any = None;
    while let Some(a) = todo.pop() {
        if !seen.insert(a.clone()) {
            continue;
        }
        let (kind, name) = (a.0.as_str(), a.1.as_str());
        let mut next: Vec<(BTreeSet<Addr>, &'static [&'static str], String)> = Vec::new();
        if TARGET_GROUPS.contains(&kind) {
            for att in m.resources.iter().filter(|r| {
                matches!(
                    r.kind.as_str(),
                    "aws_lb_target_group_attachment" | "aws_alb_target_group_attachment"
                ) && r
                    .block
                    .attr("target_group_arn")
                    .is_some_and(|e| refs(m, e).contains(&a))
            }) {
                let e = att.block.attr("target_id").unwrap_or_default();
                next.push((refs(m, e), LAMBDAS, att.shown("target group attachment")));
            }
        }
        if kind == "aws_lambda_alias"
            && let Some(alias) = m.get(kind, name)
        {
            let e = alias.block.attr("function_name").unwrap_or_default();
            next.push((refs(m, e), LAMBDAS, alias.shown("Lambda alias")));
        }
        if matches!(
            kind,
            "google_compute_backend_service" | "google_compute_region_backend_service"
        ) && let Some(svc) = m.get(kind, name)
        {
            for b in svc.block.blocks("backend") {
                let e = b.attr("group").unwrap_or_default();
                next.push((refs(m, e), GCP_KINDS, svc.shown("backend service")));
            }
        }
        if kind.ends_with("network_endpoint_group")
            && let Some(neg) = m.get(kind, name)
        {
            for inner in ["cloud_run", "cloud_function", "app_engine"] {
                for b in neg.block.blocks(inner) {
                    let found = refs_in(m, b);
                    next.push((found, GCP_KINDS, neg.shown("network endpoint group")));
                }
            }
        }
        for (found, kinds, what) in next {
            if found.is_empty() {
                any.get_or_insert((
                    format!("{what} passes requests on to something that is not a resource of its module"),
                    kinds,
                ));
            }
            todo.extend(found);
        }
    }
    (seen, any)
}

/// Sets where `f` sends requests: `expr` (of `attr`), followed; where it names no
/// resource of the module, a target that is not read of `kinds`, said by `why`.
fn send_to(
    f: &mut Forward,
    m: &Module,
    found: BTreeSet<Addr>,
    kinds: &'static [&'static str],
    why: String,
) {
    if found.is_empty() {
        f.any.get_or_insert((why, kinds));
        return;
    }
    let (to, any) = closure(m, found);
    f.to.extend(to);
    if let Some(any) = any {
        f.any.get_or_insert(any);
    }
}

/// Every forward of the repository's modules, and what may forward and is not read.
pub(super) fn read(modules: &BTreeMap<String, Module>) -> Vec<Forward> {
    let mut out = Vec::new();
    // What can reach a private load balancer from outside its network, anywhere: an
    // expression of one that names no load balancer of its module may be any of them.
    let mut fronts: BTreeMap<Addr, String> = BTreeMap::new();
    let mut fronts_any: Option<String> = None;
    for m in modules.values() {
        read_fronts(m, &mut fronts, &mut fronts_any);
    }
    for m in modules.values() {
        lb(m, &fronts, fronts_any.as_deref(), &mut out);
        rest(m, &mut out);
        http(m, &mut out);
        function_urls(m, &mut out);
        url_maps(m, &mut out);
        cloud_run(m, &mut out);
        modules_given(m, &mut out);
    }
    out
}

/// The kinds that can send requests from outside a network to a private load
/// balancer: a CloudFront VPC origin, a REST API's VPC link, a Global Accelerator
/// endpoint group, a target group of another load balancer, an HTTP API's private
/// integration.
fn read_fronts(m: &Module, fronts: &mut BTreeMap<Addr, String>, any: &mut Option<String>) {
    for r in &m.resources {
        let private = match r.kind.as_str() {
            "aws_cloudfront_vpc_origin"
            | "aws_api_gateway_vpc_link"
            | "aws_globalaccelerator_endpoint_group" => true,
            "aws_lb_target_group_attachment" | "aws_alb_target_group_attachment" => false,
            "aws_apigatewayv2_integration" | "aws_api_gateway_integration" => r
                .block
                .attr("connection_type")
                .is_some_and(|c| !c.contains("INTERNET")),
            _ => continue,
        };
        let found = refs_in(m, &r.block);
        let mut named = false;
        for a in &found {
            let lb = if BALANCERS.contains(&a.0.as_str()) {
                Some(a.clone())
            } else if LISTENERS.contains(&a.0.as_str()) {
                m.get(&a.0, &a.1).and_then(|l| {
                    refs(m, l.block.attr("load_balancer_arn").unwrap_or_default())
                        .into_iter()
                        .find(|b| BALANCERS.contains(&b.0.as_str()))
                })
            } else {
                None
            };
            if let Some(lb) = lb {
                named = true;
                fronts
                    .entry((format!("{}#{}", m.dir, lb.0), lb.1))
                    .or_insert_with(|| r.shown(&r.kind));
            }
        }
        if private && !named && any.is_none() {
            *any = Some(format!(
                "{}, which can send requests from outside to a private load balancer, names none of its module",
                r.shown(&r.kind)
            ));
        }
    }
}

/// Where requests a load balancer `lb` of `m` takes come from.
fn lb_from(
    m: &Module,
    lb: Option<&Addr>,
    fronts: &BTreeMap<Addr, String>,
    fronts_any: Option<&str>,
) -> From {
    let Some(res) = lb.and_then(|(k, n)| m.get(k, n)) else {
        // The load balancer is not a resource of the module: as a person's tie says,
        // its rules take requests from outside.
        return From::Internet;
    };
    let insts = match values::instances(res.meta(), &m.env()) {
        Ok(i) => i,
        Err(e) => return From::Unknown(format!("load balancer {}: {e}", res.shown(""))),
    };
    let mut inside = true;
    for inst in insts {
        let cx = Cx {
            m,
            env: m.env(),
            inst,
        };
        match cx.val(&res.block, "internal").map(|v| v.map(|v| v.truth())) {
            None | Some(Ok(Some(false))) => inside = false,
            Some(Ok(Some(true))) => {}
            Some(Ok(None)) => {
                return From::Unknown(format!(
                    "whether load balancer `{}` is internal is not a boolean",
                    res.name
                ));
            }
            Some(Err(e)) => {
                return From::Unknown(format!(
                    "whether load balancer `{}` is internal is not settled by the files: {e}",
                    res.name
                ));
            }
        }
    }
    if !inside {
        return From::Internet;
    }
    if let Some(front) = fronts.get(&(format!("{}#{}", m.dir, res.kind), res.name.clone())) {
        return From::Unknown(format!(
            "load balancer `{}` is internal, and {front} sends requests to it",
            res.name
        ));
    }
    if let Some(front) = fronts_any {
        return From::Unknown(format!(
            "load balancer `{}` is internal, and {front}",
            res.name
        ));
    }
    From::Inside(format!(
        "load balancer `{}` ({}) is internal (`internal = true`)",
        res.name,
        res.at()
    ))
}

/// The load balancer a listener of `m` belongs to, named by `expr`.
fn balancer_of_listener(m: &Module, listener: &Addr) -> Option<Addr> {
    let l = m.get(&listener.0, &listener.1)?;
    refs(m, l.block.attr("load_balancer_arn").unwrap_or_default())
        .into_iter()
        .find(|a| BALANCERS.contains(&a.0.as_str()))
}

/// The target groups a `forward` action or default action `a` sends to; none when one
/// is not a resource of the module.
fn forward_targets(cx: &Cx<'_>, a: &Block) -> Option<BTreeSet<Addr>> {
    let mut out = BTreeSet::new();
    let mut exprs: Vec<&str> = a.attr("target_group_arn").into_iter().collect();
    for f in a.blocks("forward") {
        for g in f.blocks("target_group") {
            exprs.push(g.attr("arn").unwrap_or_default());
        }
    }
    if exprs.is_empty() {
        return None;
    }
    for e in exprs {
        let found: BTreeSet<Addr> = cx
            .refs(e)
            .into_iter()
            .filter(|a| TARGET_GROUPS.contains(&a.0.as_str()))
            .collect();
        if found.is_empty() {
            return None;
        }
        out.extend(found);
    }
    Some(out)
}

/// What the actions of a rule or a listener say: none when nothing is forwarded (a
/// redirect, a fixed response); else the target groups it forwards to (none when that
/// is not read), why the actions are not read, and the `authenticate-*` actions before.
#[allow(clippy::type_complexity)]
fn actions(
    cx: &Cx<'_>,
    actions: &[&Block],
) -> Option<(Option<BTreeSet<Addr>>, Option<String>, Vec<String>)> {
    let mut auth = Vec::new();
    let mut forward = None;
    let mut unread = None;
    for a in actions {
        match cx.text(a, "type") {
            Some(Ok(t)) if t == "redirect" || t == "fixed-response" => {
                if forward.is_none() && actions.len() == auth.len() + 1 {
                    return None;
                }
                unread.get_or_insert_with(|| format!("it has {} actions", actions.len()));
            }
            Some(Ok(t)) if t.starts_with("authenticate-") => auth.push(t),
            Some(Ok(t)) if t == "forward" && forward.is_none() => forward = Some(*a),
            _ => {
                unread.get_or_insert_with(|| {
                    if actions.len() == 1 {
                        "its action is not a plain forward".to_string()
                    } else {
                        format!("it has {} actions", actions.len())
                    }
                });
            }
        }
    }
    let Some(f) = forward else {
        if actions.is_empty() {
            return Some((None, Some("it has 0 actions".into()), auth));
        }
        return Some((None, unread, auth));
    };
    Some((forward_targets(cx, f), unread, auth))
}

/// The listener rules and listeners of `m`.
fn lb(
    m: &Module,
    fronts: &BTreeMap<Addr, String>,
    fronts_any: Option<&str>,
    out: &mut Vec<Forward>,
) {
    for r in m
        .resources
        .iter()
        .filter(|r| RULES.contains(&r.kind.as_str()))
    {
        let shown = r.shown("listener rule");
        // The listener, and so the load balancer, are those of every instance.
        let listener = refs(m, r.block.attr("listener_arn").unwrap_or_default())
            .into_iter()
            .find(|a| LISTENERS.contains(&a.0.as_str()));
        let balancer = listener.as_ref().and_then(|l| balancer_of_listener(m, l));
        let from = lb_from(m, balancer.as_ref(), fronts, fronts_any);
        let insts = values::instances(r.meta(), &m.env());
        let (insts, meta_err) = match insts {
            Ok(i) => (i, None),
            Err(e) => (vec![Inst::default()], Some(e)),
        };
        for inst in insts {
            let cx = Cx {
                m,
                env: m.env(),
                inst,
            };
            let mut f = Forward::new(shown.clone(), &m.dir, Paths::Lb(Vec::new()), from.clone());
            let note = |f: &mut Forward, why: String, detail: Option<String>| {
                if f.unread.is_none() {
                    f.unread = Some(why);
                    f.detail = detail;
                }
            };
            if let Some(e) = &meta_err {
                let meta = r.meta().map_or("count", |(k, _)| k);
                note(&mut f, format!("it has `{meta}`"), Some(e.clone()));
            }
            if r.block.blocks("dynamic").next().is_some() {
                note(&mut f, "it has a `dynamic` block".into(), None);
            }
            let acts: Vec<&Block> = r.block.blocks("action").collect();
            let Some((targets, unread, auth)) = actions(&cx, &acts) else {
                continue;
            };
            if let Some(why) = unread {
                note(&mut f, why, None);
            }
            for a in &auth {
                f.notes.push(format!(
                    "after an `{a}` action, which Drift does not count as a guard"
                ));
            }
            match targets {
                Some(t) => send_to(&mut f, m, t, LB_KINDS, String::new()),
                None => {
                    f.any = Some((
                        format!(
                            "{shown} is not read ({})",
                            f.unread
                                .as_deref()
                                .unwrap_or("its target is not a target group of its module")
                        ),
                        LB_KINDS,
                    ));
                }
            }
            let mut patterns = Vec::new();
            for condition in r.block.blocks("condition") {
                for item in &condition.body {
                    match item {
                        Item::Block(c) if c.kind == "host_header" => {}
                        Item::Block(c) if c.kind == "path_pattern" => match cx.texts(c, "values") {
                            Some(Ok(values)) => patterns.extend(values),
                            Some(Err(e)) => note(
                                &mut f,
                                "its path patterns are not literal strings".into(),
                                Some(e),
                            ),
                            None => note(
                                &mut f,
                                "its path patterns are not literal strings".into(),
                                None,
                            ),
                        },
                        Item::Block(c) => note(
                            &mut f,
                            format!("its `{}` condition is not read", c.kind),
                            None,
                        ),
                        Item::Attr(k, _) => {
                            note(&mut f, format!("its condition `{k}` is not read"), None)
                        }
                    }
                }
            }
            f.paths = if patterns.is_empty() {
                Paths::Every
            } else {
                Paths::Lb(patterns)
            };
            out.push(f);
        }
    }
    for l in m
        .resources
        .iter()
        .filter(|r| LISTENERS.contains(&r.kind.as_str()))
    {
        let shown = l.shown("listener");
        let balancer = balancer_of_listener(m, &(l.kind.clone(), l.name.clone()));
        let from = lb_from(m, balancer.as_ref(), fronts, fronts_any);
        let may = format!("{shown} may forward by default");
        let insts = match values::instances(l.meta(), &m.env()) {
            Ok(i) => i,
            Err(e) => {
                let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, from.clone());
                f.any = Some((may.clone(), LB_KINDS));
                f.detail = Some(e);
                out.push(f);
                continue;
            }
        };
        for inst in insts {
            let cx = Cx {
                m,
                env: m.env(),
                inst,
            };
            let acts: Vec<&Block> = l.block.blocks("default_action").collect();
            if l.block.blocks("dynamic").next().is_some() {
                let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, from.clone());
                f.any = Some((may.clone(), LB_KINDS));
                out.push(f);
                continue;
            }
            let Some((targets, unread, auth)) = actions(&cx, &acts) else {
                continue;
            };
            let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, from.clone());
            for a in &auth {
                f.notes.push(format!(
                    "after an `{a}` action, which Drift does not count as a guard"
                ));
            }
            match (targets, unread) {
                (Some(t), None) => send_to(&mut f, m, t, LB_KINDS, String::new()),
                _ => f.any = Some((may.clone(), LB_KINDS)),
            }
            out.push(f);
        }
    }
}

/// The authorization of an API Gateway method or route, said as a fact.
fn authorization(kind: Option<Result<String, String>>, authorizer: Option<&str>) -> String {
    match kind {
        Some(Ok(k)) if k == "NONE" => "authorization `NONE`".to_string(),
        Some(Ok(k)) => format!(
            "authorization `{k}`{}, which Drift does not count as a guard",
            authorizer.map_or(String::new(), |a| format!(" (authorizer `{a}`)"))
        ),
        Some(Err(e)) => format!("its authorization is not settled by the files ({e})"),
        None => "no authorization is set".to_string(),
    }
}

/// The paths of a REST API resource, each with the key of its instance; or why not.
type ResourcePaths = Result<Vec<(Option<String>, String)>, String>;

/// One invoker grant: its role and its members, as far as they are read.
type Grant = (Option<Result<String, String>>, Result<Vec<String>, String>);

/// The REST APIs of `m`: each integration of a method of a resource path.
fn rest(m: &Module, out: &mut Vec<Forward>) {
    let env = m.env();
    // Each REST API: where requests come from, and what puts a prefix before the path.
    let mut apis: BTreeMap<String, (From, Option<String>)> = BTreeMap::new();
    for a in m.of(&["aws_api_gateway_rest_api"]) {
        let cx = Cx {
            m,
            env: m.env(),
            inst: Inst::default(),
        };
        if a.block.attr("body").is_some() {
            let mut f = Forward::new(a.shown("REST API"), &m.dir, Paths::Every, From::Internet);
            f.any = Some((
                format!(
                    "{} is defined by its OpenAPI `body`, which Drift does not read",
                    a.shown("REST API")
                ),
                ANY_KINDS,
            ));
            out.push(f);
        }
        let types = a
            .block
            .blocks("endpoint_configuration")
            .find_map(|e| cx.texts(e, "types"));
        let from = match types {
            None => From::Internet,
            Some(Ok(t)) if t.iter().any(|t| t == "PRIVATE") => From::Inside(format!(
                "REST API `{}` ({}) is private (endpoint type `PRIVATE`)",
                a.name,
                a.at()
            )),
            Some(Ok(_)) => From::Internet,
            Some(Err(e)) => From::Unknown(format!(
                "the endpoint type of REST API `{}` is not settled by the files: {e}",
                a.name
            )),
        };
        apis.insert(a.name.clone(), (from, None));
    }
    for b in m.of(&["aws_api_gateway_base_path_mapping"]) {
        let cx = Cx {
            m,
            env: m.env(),
            inst: Inst::default(),
        };
        let Some((api, _)) = cx.named(
            b.block.attr("api_id").unwrap_or_default(),
            "aws_api_gateway_rest_api",
        ) else {
            continue;
        };
        let base = match cx.text(&b.block, "base_path") {
            None => continue,
            Some(Ok(p)) if p.is_empty() || p == "(none)" => continue,
            Some(Ok(p)) => format!(
                "base path mapping {} puts `/{p}` before the path",
                b.shown("")
            ),
            Some(Err(e)) => format!(
                "the base path of {} is not settled by the files: {e}",
                b.shown("")
            ),
        };
        if let Some(api) = apis.get_mut(&api) {
            api.1.get_or_insert(base);
        }
    }
    // The paths of each resource, by instance key.
    let mut paths: BTreeMap<String, ResourcePaths> = BTreeMap::new();
    let resources: Vec<&Res> = m.of(&["aws_api_gateway_resource"]).collect();
    for _ in 0..=resources.len() {
        for r in &resources {
            if paths.contains_key(&r.name) {
                continue;
            }
            let parent = r.block.attr("parent_id").unwrap_or_default();
            let probe = Cx {
                m,
                env: m.env(),
                inst: Inst::default(),
            };
            let base: Result<Vec<(Option<String>, String)>, String> =
                if probe.named(parent, "aws_api_gateway_rest_api").is_some()
                    && parent.contains("root_resource_id")
                {
                    Ok(vec![(None, String::new())])
                } else if let Some((p, _)) = probe.named(parent, "aws_api_gateway_resource") {
                    match paths.get(&p) {
                        None if resources.iter().any(|x| x.name == p) => continue,
                        None => Err(format!("its parent `{p}` is not in its module")),
                        Some(Err(e)) => Err(e.clone()),
                        Some(Ok(v)) => Ok(v.clone()),
                    }
                } else {
                    Err(format!(
                        "`parent_id = {parent}` names no resource of its module"
                    ))
                };
            let found = base.and_then(|base| {
                let insts = values::instances(r.meta(), &env)?;
                let mut out = Vec::new();
                for inst in insts {
                    let key = inst
                        .each
                        .as_ref()
                        .and_then(|(k, _)| k.text())
                        .or_else(|| inst.count.map(|c| c.to_string()));
                    let cx = Cx {
                        m,
                        env: m.env(),
                        inst,
                    };
                    let part = cx
                        .text(&r.block, "path_part")
                        .unwrap_or_else(|| Err("it has no `path_part`".into()))?;
                    let parent_key = cx
                        .named(parent, "aws_api_gateway_resource")
                        .and_then(|(_, k)| k);
                    let bases: Vec<&(Option<String>, String)> = match &parent_key {
                        Some(k) => base
                            .iter()
                            .filter(|(bk, _)| bk.as_ref() == Some(k))
                            .collect(),
                        None if base.len() == 1 => base.iter().collect(),
                        None => return Err(format!("its parent has {} instances", base.len())),
                    };
                    let [(_, b)] = bases.as_slice() else {
                        return Err("the instance of its parent it names is not known".into());
                    };
                    out.push((key.clone(), format!("{b}/{part}")));
                }
                Ok(out)
            });
            paths.insert(r.name.clone(), found);
        }
    }
    for r in &resources {
        paths
            .entry(r.name.clone())
            .or_insert_with(|| Err("its parents name each other".into()));
    }
    // Each method's authorization, by (resource expression, method).
    let mut auth: BTreeMap<(String, String), String> = BTreeMap::new();
    for meth in m.of(&["aws_api_gateway_method"]) {
        let Ok(insts) = values::instances(meth.meta(), &env) else {
            continue;
        };
        for inst in insts {
            let cx = Cx {
                m,
                env: m.env(),
                inst,
            };
            let Some(Ok(method)) = cx.text(&meth.block, "http_method") else {
                continue;
            };
            let resource = meth
                .block
                .attr("resource_id")
                .unwrap_or_default()
                .to_string();
            let key = cx
                .named(&resource, "aws_api_gateway_resource")
                .map_or(resource, |(n, k)| format!("{n}[{}]", k.unwrap_or_default()));
            let fact = authorization(
                cx.text(&meth.block, "authorization"),
                meth.block.attr("authorizer_id"),
            );
            auth.insert((key, method), fact);
        }
    }
    for i in m.of(&["aws_api_gateway_integration"]) {
        let shown = i.shown("API Gateway integration");
        let probe = Cx {
            m,
            env: m.env(),
            inst: Inst::default(),
        };
        let (from, prefix) = probe
            .named(
                i.block.attr("rest_api_id").unwrap_or_default(),
                "aws_api_gateway_rest_api",
            )
            .and_then(|(a, _)| apis.get(&a).cloned())
            .unwrap_or((From::Internet, None));
        let insts = match values::instances(i.meta(), &env) {
            Ok(v) => v,
            Err(e) => {
                let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, from.clone());
                f.unread = Some("it has `count` or `for_each`".into());
                f.detail = Some(e);
                f.to.insert((i.kind.clone(), i.name.clone()));
                integration_targets(&mut f, m, &i.block, "uri");
                out.push(f);
                continue;
            }
        };
        for inst in insts {
            let cx = Cx {
                m,
                env: m.env(),
                inst,
            };
            let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, from.clone());
            f.to.insert((i.kind.clone(), i.name.clone()));
            let kind = cx.text(&i.block, "type");
            if matches!(&kind, Some(Ok(k)) if k == "MOCK") {
                continue;
            }
            integration_targets(&mut f, m, &i.block, "uri");
            match &kind {
                Some(Ok(k)) if k == "AWS_PROXY" => {}
                Some(Ok(k)) if k == "AWS" => {
                    f.rewrites = Some(
                        "a non-proxy integration hands its target what its mapping template builds"
                            .into(),
                    )
                }
                Some(Ok(k)) => {
                    f.rewrites = Some(format!(
                        "an `{k}` integration sends the request to its `uri`, whose path is the one the application sees"
                    ))
                }
                Some(Err(e)) => {
                    f.rewrites = Some(format!("its type is not settled by the files: {e}"))
                }
                None => f.rewrites = Some("it has no `type`".into()),
            }
            if f.rewrites.is_none() {
                f.rewrites = prefix.clone();
            }
            let method = match cx.text(&i.block, "http_method") {
                Some(Ok(m)) => Ok(m),
                Some(Err(e)) => {
                    // `aws_api_gateway_method.get.http_method`: the method's own.
                    match cx
                        .named(
                            i.block.attr("http_method").unwrap_or_default(),
                            "aws_api_gateway_method",
                        )
                        .and_then(|(n, _)| m.get("aws_api_gateway_method", &n))
                        .and_then(|meth| cx.text(&meth.block, "http_method"))
                    {
                        Some(Ok(v)) => Ok(v),
                        _ => Err(e),
                    }
                }
                None => Err("it has no `http_method`".into()),
            };
            let resource = i.block.attr("resource_id").unwrap_or_default().to_string();
            let path: Result<String, String> = if cx
                .named(&resource, "aws_api_gateway_rest_api")
                .is_some()
                && resource.contains("root_resource_id")
            {
                Ok("/".to_string())
            } else if let Some((r, key)) = cx.named(&resource, "aws_api_gateway_resource") {
                match paths.get(&r) {
                    Some(Ok(v)) => {
                        let found: Vec<&(Option<String>, String)> = match &key {
                            Some(k) => v.iter().filter(|(rk, _)| rk.as_ref() == Some(k)).collect(),
                            None => v.iter().collect(),
                        };
                        match found.as_slice() {
                            [(_, p)] => Ok(p.clone()),
                            _ => Err(format!(
                                "which instance of resource `{r}` it is for is not known"
                            )),
                        }
                    }
                    Some(Err(e)) => Err(format!("the path of resource `{r}` is not known: {e}")),
                    None => Err(format!("resource `{r}` is not in its module")),
                }
            } else {
                Err(format!(
                    "`resource_id = {resource}` names no resource of its module"
                ))
            };
            match (path, method) {
                (Ok(p), Ok(meth)) => {
                    let key = cx
                        .named(&resource, "aws_api_gateway_resource")
                        .map_or(resource.clone(), |(n, k)| {
                            format!("{n}[{}]", k.unwrap_or_default())
                        });
                    f.notes.push(
                        auth.get(&(key, meth.clone()))
                            .cloned()
                            .unwrap_or_else(|| "its method resource is not read".to_string()),
                    );
                    f.shown = format!(
                        "API Gateway method `{meth} {p}` ({}:{})",
                        i.file, i.block.line
                    );
                    f.method = (meth != "ANY").then_some(meth);
                    f.paths = Paths::Template(p);
                }
                (Err(e), _) | (_, Err(e)) => {
                    f.unread = Some("its path or method is not read".into());
                    f.detail = Some(e);
                }
            }
            out.push(f);
        }
    }
}

/// Where an API Gateway integration sends requests: the resources its `attr` names
/// (a Lambda function's `invoke_arn`), followed.
fn integration_targets(f: &mut Forward, m: &Module, b: &Block, attr: &str) {
    let expr = b.attr(attr).unwrap_or_default();
    let found = refs(m, expr);
    if found.is_empty() {
        // A URL of its own names nothing of the repository; a variable or another
        // module's output may name a function.
        if !(expr.starts_with("\"http") && !expr.contains("${")) {
            f.any = Some((
                format!(
                    "{} sends requests to `{attr} = {expr}`, which names no resource of its module",
                    f.shown
                ),
                LAMBDAS,
            ));
        }
        return;
    }
    let (to, any) = closure(m, found);
    f.to.extend(to);
    if let Some(any) = any {
        f.any.get_or_insert(any);
    }
}

/// The HTTP APIs of `m`: each route to its integration.
fn http(m: &Module, out: &mut Vec<Forward>) {
    let env = m.env();
    let cx0 = Cx {
        m,
        env: m.env(),
        inst: Inst::default(),
    };
    // Each HTTP API: whether it is one (not a WebSocket API), and what puts a prefix
    // before the path the application sees.
    let mut apis: BTreeMap<String, (bool, Option<String>)> = BTreeMap::new();
    for a in m.of(&["aws_apigatewayv2_api"]) {
        let protocol = cx0.text(&a.block, "protocol_type");
        if matches!(&protocol, Some(Ok(p)) if p == "WEBSOCKET") {
            apis.insert(a.name.clone(), (false, None));
            continue;
        }
        if a.block.attr("body").is_some() {
            let mut f = Forward::new(a.shown("HTTP API"), &m.dir, Paths::Every, From::Internet);
            f.any = Some((
                format!(
                    "{} is defined by its OpenAPI `body`, which Drift does not read",
                    a.shown("HTTP API")
                ),
                ANY_KINDS,
            ));
            out.push(f);
        }
        let stages: Vec<Result<String, String>> = m
            .of(&["aws_apigatewayv2_stage"])
            .filter(|s| {
                cx0.named(
                    s.block.attr("api_id").unwrap_or_default(),
                    "aws_apigatewayv2_api",
                )
                .is_some_and(|(n, _)| n == a.name)
            })
            .map(|s| {
                cx0.text(&s.block, "name")
                    .unwrap_or_else(|| Err("a stage has no `name`".into()))
            })
            .collect();
        let quick = a.block.attr("target").is_some();
        let mut prefix = match stages
            .iter()
            .find(|s| !matches!(s, Ok(n) if n == "$default"))
        {
            Some(Ok(n)) => Some(format!(
                "its stage `{n}` may come before the path the application sees"
            )),
            Some(Err(e)) => Some(format!("its stage is not settled by the files: {e}")),
            None if stages.is_empty() && !quick => Some("no stage of it is read".to_string()),
            None => None,
        };
        for map in m.of(&["aws_apigatewayv2_api_mapping"]) {
            if cx0
                .named(
                    map.block.attr("api_id").unwrap_or_default(),
                    "aws_apigatewayv2_api",
                )
                .is_some_and(|(n, _)| n == a.name)
                && let Some(key) = cx0.text(&map.block, "api_mapping_key")
                && !matches!(&key, Ok(k) if k.is_empty())
            {
                prefix.get_or_insert(format!(
                    "API mapping {} puts a key before the path",
                    map.shown("")
                ));
            }
        }
        if let Some(target) = a.block.attr("target") {
            let shown = a.shown("HTTP API");
            let (paths, method) = match cx0.text(&a.block, "route_key") {
                None => (Ok(Paths::Every), None),
                Some(Ok(k)) => match route_key(&k) {
                    Some(x) => (Ok(x.0), x.1),
                    None => (Err(format!("its route key `{k}` is not read")), None),
                },
                Some(Err(e)) => (Err(e), None),
            };
            let mut f = Forward::new(shown, &m.dir, Paths::Every, From::Internet);
            f.method = method;
            match paths {
                Ok(p) => f.paths = p,
                Err(e) => {
                    f.unread = Some("its route is not read".into());
                    f.detail = Some(e);
                }
            }
            f.rewrites = prefix.clone();
            f.notes
                .push("a quick-create route with no authorization".into());
            let found = refs(m, target);
            send_to(
                &mut f,
                m,
                found,
                LAMBDAS,
                format!(
                    "{} sends requests to `target = {target}`, which names no resource of its module",
                    a.shown("HTTP API")
                ),
            );
            out.push(f);
        }
        apis.insert(a.name.clone(), (true, prefix));
    }
    for r in m.of(&["aws_apigatewayv2_route"]) {
        let api = cx0
            .named(
                r.block.attr("api_id").unwrap_or_default(),
                "aws_apigatewayv2_api",
            )
            .and_then(|(n, _)| apis.get(&n).cloned());
        let (is_http, prefix) = api.unwrap_or((true, Some("its API is not in its module".into())));
        if !is_http {
            continue;
        }
        let insts = match values::instances(r.meta(), &env) {
            Ok(v) => v,
            Err(e) => {
                let mut f = Forward::new(
                    r.shown("HTTP API route"),
                    &m.dir,
                    Paths::Every,
                    From::Internet,
                );
                f.unread = Some("it has `count` or `for_each`".into());
                f.detail = Some(e);
                route_target(&mut f, &cx0, &r.block);
                out.push(f);
                continue;
            }
        };
        for inst in insts {
            let cx = Cx {
                m,
                env: m.env(),
                inst,
            };
            let mut f = Forward::new(
                r.shown("HTTP API route"),
                &m.dir,
                Paths::Every,
                From::Internet,
            );
            match cx.text(&r.block, "route_key") {
                Some(Ok(k)) => match route_key(&k) {
                    Some((p, meth)) => {
                        f.shown = format!("HTTP API route `{k}` ({}:{})", r.file, r.block.line);
                        f.paths = p;
                        f.method = meth;
                    }
                    None => f.unread = Some(format!("its route key `{k}` is not read")),
                },
                Some(Err(e)) => {
                    f.unread = Some("its route key is not read".into());
                    f.detail = Some(e);
                }
                None => f.unread = Some("it has no `route_key`".into()),
            }
            f.notes.push(authorization(
                cx.text(&r.block, "authorization_type"),
                r.block.attr("authorizer_id"),
            ));
            f.rewrites = prefix.clone();
            route_target(&mut f, &cx, &r.block);
            out.push(f);
        }
    }
}

/// `$default`, or `METHOD /path`: the requests a route key takes.
fn route_key(k: &str) -> Option<(Paths, Option<String>)> {
    if k == "$default" {
        return Some((Paths::Every, None));
    }
    let (method, path) = k.split_once(' ')?;
    if !path.starts_with('/') {
        return None;
    }
    let method = (method != "ANY").then(|| method.to_string());
    Some((Paths::Template(path.to_string()), method))
}

/// The integration a route sends to (`target = "integrations/${...id}"`), followed to
/// where it sends requests.
fn route_target(f: &mut Forward, cx: &Cx<'_>, route: &Block) {
    let expr = route.attr("target").unwrap_or_default();
    let Some((name, _)) = cx.named(expr, "aws_apigatewayv2_integration") else {
        f.any = Some((
            format!(
                "{} sends requests to `target = {expr}`, which names no integration of its module",
                f.shown
            ),
            ANY_KINDS,
        ));
        return;
    };
    f.to.insert(("aws_apigatewayv2_integration".into(), name.clone()));
    let Some(i) = cx.m.get("aws_apigatewayv2_integration", &name) else {
        return;
    };
    let kind = cx.text(&i.block, "integration_type");
    integration_targets(f, cx.m, &i.block, "integration_uri");
    let private = refs(cx.m, i.block.attr("integration_uri").unwrap_or_default())
        .iter()
        .any(|a| LISTENERS.contains(&a.0.as_str()) || BALANCERS.contains(&a.0.as_str()));
    match kind {
        Some(Ok(k)) if k == "AWS_PROXY" => {}
        Some(Ok(_)) if private => {}
        Some(Ok(k)) => {
            f.rewrites = Some(format!(
                "an `{k}` integration sends the request to its `integration_uri`, whose path is the one the application sees"
            ))
        }
        Some(Err(e)) => {
            f.rewrites = Some(format!(
                "its integration type is not settled by the files: {e}"
            ))
        }
        None => f.rewrites = Some("its integration has no `integration_type`".into()),
    }
    if i.block
        .attr("request_parameters")
        .is_some_and(|p| p.contains("path"))
    {
        f.rewrites = Some("its integration rewrites the path (`request_parameters`)".into());
    }
}

/// The Lambda function URLs of `m`: every request to the function.
fn function_urls(m: &Module, out: &mut Vec<Forward>) {
    for u in m.of(&["aws_lambda_function_url"]) {
        let cx = Cx {
            m,
            env: m.env(),
            inst: Inst::default(),
        };
        let shown = u.shown("Lambda function URL");
        let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, From::Internet);
        f.notes.push(match cx.text(&u.block, "authorization_type") {
            Some(Ok(k)) if k == "NONE" => "authorization `NONE`".to_string(),
            Some(Ok(k)) => format!("authorization `{k}`, which Drift does not count as a guard"),
            Some(Err(e)) => format!("its authorization is not settled by the files ({e})"),
            None => "no authorization is set".to_string(),
        });
        let expr = u.block.attr("function_name").unwrap_or_default();
        let found = refs(m, expr);
        send_to(
            &mut f,
            m,
            found,
            LAMBDAS,
            format!(
                "{shown} is for `function_name = {expr}`, which names no function of its module"
            ),
        );
        out.push(f);
    }
}

/// Where the requests a URL map `u` routes come from: the forwarding rules that reach
/// it through a target proxy.
fn map_from(m: &Module, u: &Res) -> From {
    let me = (u.kind.clone(), u.name.clone());
    let proxies: BTreeSet<Addr> = m
        .resources
        .iter()
        .filter(|r| r.kind.contains("target_http") && r.kind.ends_with("_proxy"))
        .filter(|r| refs(m, r.block.attr("url_map").unwrap_or_default()).contains(&me))
        .map(|r| (r.kind.clone(), r.name.clone()))
        .collect();
    let cx = Cx {
        m,
        env: m.env(),
        inst: Inst::default(),
    };
    let mut internal = Vec::new();
    let mut found = false;
    for rule in m.of(&[
        "google_compute_global_forwarding_rule",
        "google_compute_forwarding_rule",
    ]) {
        if refs(m, rule.block.attr("target").unwrap_or_default()).is_disjoint(&proxies) {
            continue;
        }
        found = true;
        match cx.text(&rule.block, "load_balancing_scheme") {
            None => return From::Internet,
            Some(Ok(s)) if s.starts_with("EXTERNAL") => return From::Internet,
            Some(Ok(s)) => internal.push(format!(
                "{} has `load_balancing_scheme = \"{s}\"`",
                rule.shown("forwarding rule")
            )),
            Some(Err(e)) => {
                return From::Unknown(format!(
                    "the scheme of {} is not settled by the files: {e}",
                    rule.shown("forwarding rule")
                ));
            }
        }
    }
    if found {
        From::Inside(internal.join(", "))
    } else {
        // No forwarding rule of the module reaches it: as a person's tie says, it
        // takes requests from outside.
        From::Internet
    }
}

/// The GCP URL maps of `m`: their default services, path matchers and path rules.
fn url_maps(m: &Module, out: &mut Vec<Forward>) {
    for u in m.of(&["google_compute_url_map", "google_compute_region_url_map"]) {
        let from = map_from(m, u);
        let shown = u.shown("URL map");
        let cx = Cx {
            m,
            env: m.env(),
            inst: Inst::default(),
        };
        let mut push = |what: String,
                        svc: &str,
                        paths: Paths,
                        unread: Option<(String, Option<String>)>| {
            let mut f = Forward::new(what.clone(), &m.dir, paths, from.clone());
            if let Some((why, detail)) = unread {
                f.unread = Some(why);
                f.detail = detail;
            }
            let found = refs(m, svc);
            send_to(
                &mut f,
                m,
                found,
                GCP_KINDS,
                format!("{what} sends requests to `{svc}`, which names no backend of its module"),
            );
            out.push(f);
        };
        if u.meta().is_some() {
            let svc: Vec<String> = refs_in(m, &u.block)
                .iter()
                .map(|(k, n)| format!("{k}.{n}"))
                .collect();
            push(
                shown.clone(),
                &svc.join(" "),
                Paths::Every,
                Some(("it has `count` or `for_each`".into(), None)),
            );
            continue;
        }
        if let Some(svc) = u.block.attr("default_service") {
            let unread = u
                .block
                .blocks("default_route_action")
                .next()
                .map(|_| ("its `default_route_action` is not read".to_string(), None));
            push(format!("{shown} by default"), svc, Paths::Every, unread);
        }
        for pm in u.block.blocks("path_matcher") {
            let name = pm
                .attr("name")
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            let what = format!("path matcher `{name}` of {shown}");
            if pm.blocks("route_rules").next().is_some()
                || pm.blocks("default_route_action").next().is_some()
            {
                let svc: Vec<String> = refs_in(m, pm)
                    .iter()
                    .map(|(k, n)| format!("{k}.{n}"))
                    .collect();
                push(
                    what.clone(),
                    &svc.join(" "),
                    Paths::Every,
                    Some((
                        "its `route_rules` or route actions are not read".into(),
                        None,
                    )),
                );
                continue;
            }
            // Each rule's patterns and service, as read.
            let mut rules: Vec<(Result<Vec<String>, String>, String, bool)> = Vec::new();
            for pr in pm.blocks("path_rule") {
                let svc = pr.attr("service").unwrap_or_default().to_string();
                rules.push((
                    cx.texts(pr, "paths")
                        .unwrap_or_else(|| Err("it has no `paths`".into())),
                    svc,
                    pr.blocks("route_action").next().is_some()
                        || pr.blocks("url_redirect").next().is_some(),
                ));
            }
            let all_read = rules.iter().all(|(p, ..)| p.is_ok());
            let patterns_except = |svc: &str| -> Vec<String> {
                rules
                    .iter()
                    .filter(|(_, s, _)| s != svc)
                    .filter_map(|(p, ..)| p.as_ref().ok())
                    .flatten()
                    .cloned()
                    .collect()
            };
            if let Some(svc) = pm.attr("default_service") {
                let unread =
                    (!all_read).then(|| ("a path rule beside it is not read".to_string(), None));
                push(
                    format!("{what} by default"),
                    svc,
                    Paths::Globs {
                        take: Vec::new(),
                        others: patterns_except(svc),
                    },
                    unread,
                );
            }
            for (paths, svc, action) in &rules {
                if svc.is_empty() {
                    continue;
                }
                match paths {
                    Ok(p) => push(
                        format!("path rule {} of {what}", p.join(", ")),
                        svc,
                        Paths::Globs {
                            take: p.clone(),
                            others: patterns_except(svc),
                        },
                        action.then(|| ("its `route_action` is not read".to_string(), None)),
                    ),
                    Err(e) => push(
                        format!("a path rule of {what}"),
                        svc,
                        Paths::Every,
                        Some(("its paths are not read".into(), Some(e.clone()))),
                    ),
                }
            }
        }
    }
}

/// The Cloud Run services of `m`: every request, from where their ingress and their
/// invoker grants say.
fn cloud_run(m: &Module, out: &mut Vec<Forward>) {
    let cx = Cx {
        m,
        env: m.env(),
        inst: Inst::default(),
    };
    // Each service granted its invoker role to everyone, and the grants not read.
    let mut public: BTreeMap<Addr, String> = BTreeMap::new();
    let mut unread: Vec<String> = Vec::new();
    for g in m.resources.iter().filter(|r| {
        r.kind.starts_with("google_cloud_run_")
            && (r.kind.ends_with("_iam_member")
                || r.kind.ends_with("_iam_binding")
                || r.kind.ends_with("_iam_policy"))
    }) {
        let attr = if g.kind.contains("_v2_") {
            "name"
        } else {
            "service"
        };
        let svc: Vec<Addr> = refs(m, g.block.attr(attr).unwrap_or_default())
            .into_iter()
            .filter(|a| a.0.starts_with("google_cloud_run_"))
            .collect();
        // (role, members) of the grant.
        let mut grants: Vec<Grant> = Vec::new();
        if g.kind.ends_with("_iam_member") {
            grants.push((
                cx.text(&g.block, "role"),
                cx.text(&g.block, "member")
                    .map_or_else(|| Err("no `member`".into()), |r| r.map(|m| vec![m])),
            ));
        } else if g.kind.ends_with("_iam_binding") {
            grants.push((
                cx.text(&g.block, "role"),
                cx.texts(&g.block, "members")
                    .unwrap_or_else(|| Err("no `members`".into())),
            ));
        } else {
            let policy = g.block.attr("policy_data").unwrap_or_default();
            let data = policy
                .strip_prefix("data.google_iam_policy.")
                .and_then(|r| r.split('.').next())
                .and_then(|n| {
                    m.data
                        .iter()
                        .find(|d| d.kind == "google_iam_policy" && d.name == n)
                });
            match data {
                Some(d) => {
                    for b in d.block.blocks("binding") {
                        grants.push((
                            cx.text(b, "role"),
                            cx.texts(b, "members")
                                .unwrap_or_else(|| Err("no `members`".into())),
                        ));
                    }
                }
                None => grants.push((None, Err(format!("`policy_data = {policy}` is not read")))),
            }
        }
        for (role, members) in grants {
            let invoker = match &role {
                Some(Ok(r)) => r == "roles/run.invoker",
                _ => true,
            };
            if let Some(Err(e)) = &role {
                unread.push(format!("{}: {e}", g.shown(&g.kind)));
                continue;
            }
            match members {
                Ok(members) => {
                    if invoker
                        && members
                            .iter()
                            .any(|x| x == "allUsers" || x == "allAuthenticatedUsers")
                    {
                        for s in &svc {
                            public.entry(s.clone()).or_insert_with(|| g.shown(&g.kind));
                        }
                    }
                }
                Err(e) => unread.push(format!("{}: {e}", g.shown(&g.kind))),
            }
        }
        if svc.is_empty() {
            unread.push(format!(
                "{} names no service of its module",
                g.shown(&g.kind)
            ));
        }
    }
    for s in m.of(&["google_cloud_run_service", "google_cloud_run_v2_service"]) {
        let shown = s.shown("Cloud Run service");
        let me = (s.kind.clone(), s.name.clone());
        let ingress = if s.kind == "google_cloud_run_v2_service" {
            cx.text(&s.block, "ingress").map(|r| {
                r.map(|v| match v.as_str() {
                    "INGRESS_TRAFFIC_ALL" => "all".to_string(),
                    "INGRESS_TRAFFIC_INTERNAL_ONLY" => "internal".to_string(),
                    "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" => {
                        "internal-and-cloud-load-balancing".to_string()
                    }
                    other => other.to_string(),
                })
            })
        } else {
            s.block
                .blocks("metadata")
                .find_map(|md| md.attr("annotations"))
                .map(|e| {
                    values::eval(e, &m.env(), &Inst::default())
                        .map_err(|x| format!("`annotations = {e}`: {x}"))
                })
                .map(|v| {
                    v.map(|v| match v {
                        Val::Map(a) => a
                            .get("run.googleapis.com/ingress")
                            .and_then(Val::text)
                            .unwrap_or_else(|| "all".to_string()),
                        _ => "?".to_string(),
                    })
                })
        };
        let from = match ingress {
            None => Ok("all".to_string()),
            Some(r) => r,
        };
        let from = match from.as_deref() {
            Ok("all") => match (public.get(&me), unread.first()) {
                (Some(grant), _) => {
                    let mut f = Forward::new(shown.clone(), &m.dir, Paths::Every, From::Internet);
                    f.notes.push(format!("its invoker role is granted to everyone by {grant}"));
                    f.to.insert(me.clone());
                    out.push(f);
                    continue;
                }
                (None, Some(grant)) => From::Unknown(format!(
                    "it takes requests from the internet (ingress `all`), and an invoker grant is not read: {grant}"
                )),
                (None, None) => From::Unknown(
                    "it takes requests from the internet (ingress `all`), and the repository's Terraform grants its invoker role to neither `allUsers` nor `allAuthenticatedUsers`: who may call it is IAM's, which Drift does not read as reach".to_string(),
                ),
            },
            Ok("internal") => From::Inside(format!("{shown} takes requests from inside only (ingress `internal`)")),
            Ok("internal-and-cloud-load-balancing") => From::Inside(format!(
                "{shown} takes requests from inside and through a load balancer only (ingress `internal-and-cloud-load-balancing`)"
            )),
            Ok(other) => From::Unknown(format!("its ingress `{other}` is not read")),
            Err(e) => From::Unknown(format!("its ingress is not settled by the files: {e}")),
        };
        let mut f = Forward::new(shown, &m.dir, Paths::Every, from);
        f.to.insert(me);
        out.push(f);
    }
}

/// A module of the registry (or anywhere but the repository) given a target of the
/// module: what it builds with it is not read.
fn modules_given(m: &Module, out: &mut Vec<Forward>) {
    for call in &m.calls {
        let source = call
            .block
            .attr("source")
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        if source.starts_with("./") || source.starts_with("../") {
            continue;
        }
        let found = refs_in(m, &call.block);
        if found.is_empty() {
            continue;
        }
        let mut f = Forward::new(call.shown("module"), &m.dir, Paths::Every, From::Internet);
        f.unread = Some(format!(
            "it is given a resource of its module, and what `{source}` builds with it is not read"
        ));
        let (to, _) = closure(m, found);
        f.to = to;
        out.push(f);
    }
}

/// One segment of a path template.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Seg {
    Lit(String),
    /// One whole segment.
    Param,
    /// API Gateway's `{name+}`: one segment or more.
    Greedy,
    /// A catch-all of a route: none or more.
    Rest,
    /// Not read: at least one segment, then anything.
    Unknown,
}

/// The segments of an API Gateway path.
fn api_segments(path: &str) -> Vec<Seg> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            if let Some(inner) = s.strip_prefix('{').and_then(|x| x.strip_suffix('}')) {
                if inner.ends_with('+') {
                    Seg::Greedy
                } else {
                    Seg::Param
                }
            } else if s.contains(['{', '}']) {
                Seg::Unknown
            } else {
                Seg::Lit(s.to_string())
            }
        })
        .collect()
}

/// The segments of a route template as frameworks write them (`{id}`, `:id`,
/// `[id]`, `<int:id>`, and the catch-alls `*`, `{rest:path}`, `[...rest]`,
/// `[[...rest]]`, `<path:rest>`).
fn route_segments(template: &str) -> Vec<Seg> {
    let ident = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_');
    let mut out = Vec::new();
    for s in template.split('/').filter(|s| !s.is_empty()) {
        let seg = if s == "*" {
            Seg::Rest
        } else if let Some(inner) = s.strip_prefix('{').and_then(|x| x.strip_suffix('}')) {
            match inner.split_once(':') {
                Some((n, "path")) if ident(n) => Seg::Rest,
                None if ident(inner) => Seg::Param,
                _ => Seg::Unknown,
            }
        } else if let Some(inner) = s.strip_prefix("[[...").and_then(|x| x.strip_suffix("]]")) {
            if ident(inner) {
                Seg::Rest
            } else {
                Seg::Unknown
            }
        } else if let Some(inner) = s.strip_prefix("[...").and_then(|x| x.strip_suffix(']')) {
            if ident(inner) {
                Seg::Rest
            } else {
                Seg::Unknown
            }
        } else if let Some(inner) = s.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            if ident(inner) {
                Seg::Param
            } else {
                Seg::Unknown
            }
        } else if let Some(inner) = s.strip_prefix('<').and_then(|x| x.strip_suffix('>')) {
            match inner.split_once(':') {
                Some(("path", n)) if ident(n) => Seg::Rest,
                Some((_, n)) if ident(n) => Seg::Param,
                None if ident(inner) => Seg::Param,
                _ => Seg::Unknown,
            }
        } else if let Some(n) = s.strip_prefix(':') {
            if ident(n) { Seg::Param } else { Seg::Unknown }
        } else if s.contains([
            '{', '}', '[', ']', '<', '>', '*', '?', '(', ')', ':', '+', '\\', '|', '^', '$',
        ]) {
            Seg::Unknown
        } else {
            Seg::Lit(s.to_string())
        };
        let stop = seg == Seg::Unknown;
        out.push(seg);
        if stop {
            break;
        }
    }
    out
}

/// Every path of the route `r` is one the API path `a` takes.
fn every(a: &[Seg], r: &[Seg]) -> bool {
    match (a.first(), r.first()) {
        (None, None) => true,
        // One segment or more: every path of a route that has one that is not a catch-all.
        (Some(Seg::Greedy), _) => r.iter().any(|s| *s != Seg::Rest),
        (Some(Seg::Lit(x)), Some(Seg::Lit(y))) => x == y && every(&a[1..], &r[1..]),
        (Some(Seg::Param), Some(Seg::Lit(_) | Seg::Param)) => every(&a[1..], &r[1..]),
        _ => false,
    }
}

/// Some path of the route `r` may be one the API path `a` takes.
fn some(a: &[Seg], r: &[Seg]) -> bool {
    match (a.first(), r.first()) {
        (None, None) => true,
        (None, Some(Seg::Rest)) => some(a, &r[1..]),
        (None, Some(_)) => false,
        (Some(Seg::Greedy), _) => !r.is_empty(),
        (Some(_), None) => false,
        (Some(Seg::Unknown), _) | (_, Some(Seg::Unknown)) => true,
        (Some(_), Some(Seg::Rest)) => some(a, &r[1..]) || some(&a[1..], r),
        (Some(Seg::Lit(x)), Some(Seg::Lit(y))) => x == y && some(&a[1..], &r[1..]),
        (Some(_), Some(_)) => some(&a[1..], &r[1..]),
    }
}

/// What the API path `api` takes of the paths of the route written `template`.
pub(super) fn template_glob(api: &str, template: &str) -> Glob {
    let (a, r) = (api_segments(api), route_segments(template));
    if every(&a, &r) {
        Glob::Every
    } else if some(&a, &r) {
        Glob::Some
    } else {
        Glob::None
    }
}

/// What a forward for `method` (none: any) takes of a route answering `route` (none:
/// a method Drift does not know, or any).
pub(super) fn method_glob(method: Option<&str>, route: Option<&str>) -> Glob {
    let verbs = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    match (method, route.map(str::to_ascii_uppercase)) {
        (None, _) => Glob::Every,
        (Some(m), Some(r)) if verbs.contains(&r.as_str()) => {
            if m.eq_ignore_ascii_case(&r) {
                Glob::Every
            } else {
                Glob::None
            }
        }
        _ => Glob::Some,
    }
}

/// The lesser of two takes.
pub(super) fn both(a: Glob, b: Glob) -> Glob {
    match (a, b) {
        (Glob::None, _) | (_, Glob::None) => Glob::None,
        (Glob::Every, Glob::Every) => Glob::Every,
        _ => Glob::Some,
    }
}

/// What `paths` (not [`Paths::Lb`]) take of `route`, and the pattern that does.
pub(super) fn takes(paths: &Paths, route: &Route, template: &str) -> (Glob, String) {
    match paths {
        Paths::Every | Paths::Lb(_) => (Glob::Every, "every path".to_string()),
        Paths::Template(t) => (template_glob(t, template), t.clone()),
        Paths::Globs { take, others } => {
            let (mut got, mut label) = if take.is_empty() {
                (Glob::Every, "every path".to_string())
            } else {
                let mut best = (Glob::None, String::new());
                for p in take {
                    match route.glob(p) {
                        Glob::Every => {
                            best = (Glob::Every, p.clone());
                            break;
                        }
                        Glob::Some if best.0 == Glob::None => best = (Glob::Some, p.clone()),
                        _ => {}
                    }
                }
                best
            };
            if got == Glob::None {
                return (got, label);
            }
            for q in others {
                match route.glob(q) {
                    // Every path of it goes elsewhere where this one is the default.
                    Glob::Every if take.is_empty() => return (Glob::None, label),
                    Glob::None => {}
                    _ => {
                        got = Glob::Some;
                        label = format!("{label} (beside {q}, which goes elsewhere)");
                    }
                }
            }
            (got, label)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_api_path_takes_every_some_or_no_path_of_a_route() {
        assert_eq!(
            template_glob("/users/{id}", "/users/{user_id}"),
            Glob::Every
        );
        assert_eq!(template_glob("/users/{id}", "/users/:id"), Glob::Every);
        assert_eq!(template_glob("/users/{id}", "/users/me"), Glob::Every);
        assert_eq!(template_glob("/users/me", "/users/{id}"), Glob::Some);
        assert_eq!(
            template_glob("/users/{id}", "/users/{id}/posts"),
            Glob::None
        );
        assert_eq!(template_glob("/{proxy+}", "/users/{id}/posts"), Glob::Every);
        assert_eq!(template_glob("/{proxy+}", "/"), Glob::None);
        assert_eq!(template_glob("/", "/"), Glob::Every);
        assert_eq!(template_glob("/api/{proxy+}", "/api/[...slug]"), Glob::Some);
        assert_eq!(template_glob("/api/{proxy+}", "/v1/items"), Glob::None);
        assert_eq!(template_glob("/files", "/files/{rest:path}"), Glob::Some);
        assert_eq!(method_glob(Some("GET"), Some("get")), Glob::Every);
        assert_eq!(method_glob(Some("GET"), Some("POST")), Glob::None);
        assert_eq!(method_glob(Some("GET"), None), Glob::Some);
        assert_eq!(method_glob(None, Some("POST")), Glob::Every);
    }
}
