//! Registrations written as a route is that Drift did not list
//! ([`drift_core::FileFacts::unlisted_reasons`]): one entry per registration, with
//! its line and why ([`UnlistedReason`]), so a person knows the inventory is
//! incomplete and where.
//!
//! The one place Python reports them. Lowering notes what it could not make into a
//! registration ([`Lowerer::unlisted`]); the linker notes the registrations it made
//! that listed nothing ([`Linker::note_unlisted_route`],
//! [`Linker::note_unlisted_registration`]) and the mounts it could not follow; an
//! adapter added later calls the same two. Reporting only: nothing here is an entry
//! point or a violation, and only the listed linker reports (never the copy mining
//! reads), so mining's input is as it was.

use std::collections::BTreeMap;

use drift_core::{UnlistedReason, UnlistedRoute};
use ruff_python_ast::{self as ast, Expr};
use ruff_text_size::Ranged;
use serde::{Deserialize, Serialize};

use super::{Extra, HTTP_VERBS, Linker, is_test_path};
use crate::lower::Lowerer;
use crate::raw::{MountTarget, RawMount, RawRef, RawRegistration, RawRoute};

/// What a receiver must be for a registration lowering could not make to count
/// ([`RawUnlisted::on`]): the call has the name of a framework's method, and other
/// libraries have methods of the same name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Family {
    /// An application, router or blueprint of FastAPI, Flask or flask-restx.
    Web,
    /// A Django REST framework router.
    DrfRouter,
}

/// A registration written as a route is that lowering could not make into one
/// ([`crate::raw::RawFile::unlisted`]).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RawUnlisted {
    pub line: u32,
    pub reason: UnlistedReason,
    /// Kept only where this receiver is of the family: `app.add_url_rule(...)` is
    /// Flask's only on a Flask application. None where the call is the framework's
    /// by its own name (Django `path()`, a Starlette `Route`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<(RawRef, Family)>,
}

impl Lowerer<'_> {
    /// Notes a registration written at `node` that lowering does not make, and why.
    pub(crate) fn unlisted(
        &mut self,
        node: &impl Ranged,
        reason: UnlistedReason,
        on: Option<(RawRef, Family)>,
    ) {
        let line = self.line(node);
        self.out.unlisted.push(RawUnlisted { line, reason, on });
    }

    /// [`Lowerer::unlisted`] of a registration call on `parent` that names a
    /// framework's method (`add_url_rule`, `include_router`), where what it is given
    /// (`written`) is there: counted where `parent` is an application or router of
    /// FastAPI, Flask or flask-restx, which the linker says.
    pub(crate) fn unlisted_call(
        &mut self,
        c: &ast::ExprCall,
        written: Option<&Expr>,
        parent: &Option<RawRef>,
        reason: UnlistedReason,
    ) {
        if let (Some(_), Some(p)) = (written, parent) {
            self.unlisted(c, reason, Some((p.clone(), Family::Web)));
        }
    }

    /// [`Lowerer::unlisted`] of the registration call being lowered
    /// ([`Lowerer::site`]): an entry of a Django `urlpatterns`, a registration call.
    pub(crate) fn unlisted_here(&mut self, reason: UnlistedReason, on: Option<(RawRef, Family)>) {
        self.out.unlisted.push(RawUnlisted {
            line: self.site,
            reason,
            on,
        });
    }
}

/// How many entry points the registrations read so far listed.
pub(super) fn listed_count(extra: &BTreeMap<String, Extra>) -> usize {
    extra.values().map(|e| e.entries.len()).sum()
}

impl Linker<'_> {
    /// Whether this link reports what it did not list: the listed link only, of a
    /// full scan or of one file ([`Linker::tracking`], whose lookups here are
    /// tracked as every other is, so that it says what a full scan says). The copy
    /// mining reads ([`Linker::measured`], [`Linker::compat`]) takes the listed
    /// link's ([`drift_core::FileFacts::hold`]).
    pub(super) fn reports_unlisted(&self) -> bool {
        !self.measured && !self.compat
    }

    fn note(
        &self,
        fi: usize,
        line: u32,
        reason: UnlistedReason,
        out: &mut BTreeMap<String, Vec<UnlistedRoute>>,
    ) {
        out.entry(self.module_of(fi).to_string())
            .or_default()
            .push(UnlistedRoute { line, reason });
    }

    /// A route decorator that listed nothing (`listed` false): its receiver is no
    /// router Drift reads. Said where it is written as a route is: a method named
    /// for an HTTP verb (or `route`, `api_route`, `websocket`) given a path written
    /// out from the root, as TypeScript says of `x.get("/path", handler)`.
    pub(super) fn note_unlisted_route(
        &self,
        fi: usize,
        rt: &RawRoute,
        listed: bool,
        out: &mut BTreeMap<String, Vec<UnlistedRoute>>,
    ) {
        let verb = rt.verb.as_str();
        if listed
            || !(HTTP_VERBS.contains(&verb) || matches!(verb, "route" | "api_route" | "websocket"))
            || !rt.path.as_deref().is_some_and(|p| p.starts_with('/'))
        {
            return;
        }
        self.note(fi, rt.line, UnlistedReason::ReceiverNotRead, out);
    }

    /// A registration that listed no entry point: why, as [`Linker::registration`]
    /// and [`Linker::registration_at`] drop it. Nothing where it is no route after
    /// all (a call of the same name on something else), where it only names a view
    /// that may be one ([`RawRegistration::candidate`]), and where the cause is not
    /// one Drift can name.
    pub(super) fn note_unlisted_registration(
        &self,
        fi: usize,
        g: &RawRegistration,
        out: &mut BTreeMap<String, Vec<UnlistedRoute>>,
    ) {
        if let Some(reason) = self.registration_unlisted(fi, g) {
            self.note(fi, g.line.0, reason, out);
        }
    }

    fn registration_unlisted(&self, fi: usize, g: &RawRegistration) -> Option<UnlistedReason> {
        if g.candidate {
            return None;
        }
        let django = matches!(g.adapter.as_str(), "django" | "drf");
        let nodes = match &g.router {
            Some(r) => self.nodes_of(fi, r),
            None => vec![self.module_of(fi).to_string()],
        };
        if g.router.is_some() {
            let of = |f: &dyn Fn(&super::RouterInfo) -> bool| {
                nodes.iter().any(|n| self.router_info(n).is_some_and(f))
            };
            let web = of(&|i| i.web());
            match g.adapter.as_str() {
                // `register("items", X)` is many libraries' method: only a DRF
                // router's is a route.
                "drf" if !of(&|i| i.adapter == "drf_router") => return None,
                // `x.route(rule)(view)`: a route where `x` is an application.
                crate::lower::adapters::OWN_ADAPTER if !web => return None,
                "drf" | crate::lower::adapters::OWN_ADAPTER => {}
                // `add_url_rule("/x", ...)` on what is no application Drift reads.
                _ if !web => {
                    return g
                        .route
                        .starts_with('/')
                        .then_some(UnlistedReason::ReceiverNotRead);
                }
                _ => {}
            }
        }
        let target = self.canon(fi, &g.target);
        let (module, name) = target.split_once('#')?;
        if module.starts_with("pkg:") {
            return Some(UnlistedReason::PackageHandler);
        }
        if name.contains(['.', '(']) || name == "*" {
            return Some(UnlistedReason::HandlerNotRead);
        }
        if module.contains(':') || module == "global" {
            return Some(UnlistedReason::NotFound);
        }
        let ti = self.file(module)?;
        if !self.files[ti].raw.symbols.iter().any(|s| s.name == name) {
            return Some(UnlistedReason::NotFound);
        }
        if django && nodes.iter().all(|n| self.is_dead(n)) {
            return Some(UnlistedReason::NotMounted);
        }
        None
    }

    /// Whether `on` holds of a registration lowering could not make: its receiver is
    /// an application or router of the family it was written for.
    fn on_holds(&self, fi: usize, on: &Option<(RawRef, Family)>) -> bool {
        let Some((r, family)) = on else {
            return true;
        };
        self.nodes_of(fi, r).iter().any(|n| {
            self.router_info(n).is_some_and(|i| match family {
                Family::Web => i.web(),
                Family::DrfRouter => i.adapter == "drf_router",
            })
        })
    }

    /// A mount that serves what Drift does not list: an include of a URLconf module
    /// that is not in the repository's code Drift read, a router or URLconf named
    /// by a call (`include_router(make_router())`), and an application mounted that
    /// Drift cannot name, unless what the call wraps is one it reads
    /// (`WSGIMiddleware(flask_app)`). An include of a package's URLconf is the
    /// package's routes, not the repository's: not said.
    fn mount_unlisted(&self, fi: usize, m: &RawMount, all: &[RawMount]) -> Option<UnlistedReason> {
        match &m.target {
            MountTarget::Module(spec) => {
                let module = self.specs[fi].get(spec).map(String::as_str).unwrap_or("");
                if module.starts_with("pkg:") {
                    return None;
                }
                let found = !module.is_empty()
                    && !module.contains(':')
                    && (self.file(module).is_some() || self.router_info(module).is_some());
                (!found).then_some(UnlistedReason::NotFound)
            }
            MountTarget::Ref(t) if !m.whole_app => {
                let c = self.canon(fi, t);
                if c.contains('(') {
                    Some(UnlistedReason::TargetNotRead)
                } else if c.starts_with("unresolved:") || c.starts_with("global#") {
                    Some(UnlistedReason::NotFound)
                } else {
                    None
                }
            }
            MountTarget::Unfollowed => {
                // What the call that builds the application is given, mounted from
                // the same line: one Drift reads is what is served.
                let wraps_read = all.iter().any(|o| {
                    o.whole_app
                        && o.line.0 == m.line.0
                        && o.parent == m.parent
                        && matches!(&o.target, MountTarget::Ref(t)
                            if self.nodes_of(fi, t).iter().any(|n| self.router_info(n).is_some()))
                });
                (!wraps_read).then_some(UnlistedReason::TargetNotRead)
            }
            _ => None,
        }
    }

    /// What file `fi` registers that Drift did not list, sorted: what the link of
    /// the registrations noted, what lowering could not make, and the mounts it
    /// could not follow. None for a test file, and none but in the listed link.
    pub(super) fn unlisted_of(&self, fi: usize, test_file: bool) -> Vec<UnlistedRoute> {
        if test_file || !self.reports_unlisted() || is_test_path(self.module_of(fi)) {
            return Vec::new();
        }
        let raw = &self.files[fi].raw;
        let mut out: Vec<UnlistedRoute> = self
            .unlisted
            .get(self.module_of(fi))
            .cloned()
            .unwrap_or_default();
        out.extend(
            raw.unlisted
                .iter()
                .filter(|u| self.on_holds(fi, &u.on))
                .map(|u| UnlistedRoute {
                    line: u.line,
                    reason: u.reason,
                }),
        );
        out.extend(raw.mounts.iter().filter_map(|m| {
            self.mount_unlisted(fi, m, &raw.mounts)
                .map(|reason| UnlistedRoute {
                    line: m.line.0,
                    reason,
                })
        }));
        out.retain(|u| u.line > 0);
        out.sort();
        out.dedup();
        out
    }
}
