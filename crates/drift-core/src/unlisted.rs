//! Registrations written as a route is that no listing of entry points accounts
//! for ([`FileFacts::unlisted`]): routes that may be served and are in no inventory,
//! each with why Drift did not list it.
//!
//! Reporting only: an unlisted registration is never an entry point and never a
//! violation. It tells a person the inventory is incomplete, and where.

use serde::{Deserialize, Serialize};

use crate::FileFacts;

/// Why a registration written as a route is not listed. One vocabulary for every
/// reader: TypeScript reports [`UnlistedReason::ReceiverNotRead`] for a route and
/// [`UnlistedReason::HandlerNotRead`] for a message consumer; the others are what
/// Python reports, where the registration names its handler, its path or what it
/// mounts in a way Drift can tell it did not follow.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum UnlistedReason {
    /// Registered on something Drift does not read as a router: a parameter no call
    /// hands a router, an object of a framework Drift has no adapter for, a router
    /// class it does not know.
    #[default]
    ReceiverNotRead,
    /// The handler is written as something Drift does not follow: a call's result
    /// (`views.make_view()`), a lambda, a subscript.
    HandlerNotRead,
    /// What the registration names (a view, a viewset, a router, a URLconf module)
    /// is not in the code Drift read.
    NotFound,
    /// The handler is a package's (`TemplateView.as_view(...)`, `LoginView`): Drift
    /// does not read package code, so what it answers is not known.
    PackageHandler,
    /// What is mounted or included is computed (`include(plugin_urls())`,
    /// `app.mount("/v1", make_app())`): what it serves is not known.
    TargetNotRead,
    /// The path is computed and the registration is dropped with it.
    PathNotRead,
    /// Nothing that serves requests reaches the URLconf it is written in (a Django
    /// `urls.py` that `ROOT_URLCONF` does not include, with every include read).
    NotMounted,
    /// A route table, or an entry of one, that Drift does not read: `routes=` that is
    /// no list written in place, an unpacked `*more`, a `WebSocketRoute`.
    TableNotRead,
    /// A function that reads a request and answers it, that no listed entry point
    /// reaches (found by `drift security`, not by a reader).
    HandlerNotReached,
    /// What a deployment file names as a function (a Serverless Framework, SAM or
    /// platform configuration) is not settled: its handler, its event or a value
    /// they depend on is one Drift does not read, or the file does not parse. The
    /// place is in the deployment file, with what it says.
    DeploymentNotRead,
    /// A class that only its name, or its base's, says is a message consumer
    /// (`class Orders(BaseQueueConsumer)`): no messaging library Drift reads is
    /// imported into what it or its base does, so what feeds it is not known.
    NamedOnly,
}

impl UnlistedReason {
    /// The reason as a person reads it in text output (`handler not read`).
    pub fn label(self) -> &'static str {
        match self {
            Self::ReceiverNotRead => "receiver not read",
            Self::HandlerNotRead => "handler not read",
            Self::NotFound => "not found",
            Self::PackageHandler => "package handler",
            Self::TargetNotRead => "target not read",
            Self::PathNotRead => "path not read",
            Self::NotMounted => "not mounted",
            Self::TableNotRead => "table not read",
            Self::HandlerNotReached => "handler not reached",
            Self::DeploymentNotRead => "deployment not read",
            Self::NamedOnly => "named as a consumer only",
        }
    }
}

/// One registration Drift did not list: the 1-based line it is written on, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct UnlistedRoute {
    pub line: u32,
    pub reason: UnlistedReason,
}

impl FileFacts {
    /// Every registration of the file that Drift did not list, with why, sorted: a
    /// line of [`FileFacts::unlisted_routes`] (the TypeScript reading, which says
    /// only where) is [`UnlistedReason::ReceiverNotRead`], beside the entries of
    /// [`FileFacts::unlisted_reasons`].
    pub fn unlisted(&self) -> Vec<UnlistedRoute> {
        let mut out: Vec<UnlistedRoute> = self
            .unlisted_routes
            .iter()
            .map(|&line| UnlistedRoute {
                line,
                reason: UnlistedReason::ReceiverNotRead,
            })
            .chain(self.unlisted_reasons.iter().copied())
            .collect();
        out.sort();
        out.dedup();
        out
    }
}
