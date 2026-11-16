//! Drift core: the language-neutral fact model, repository ingest and the fact cache.

pub mod cache;
pub mod facts;
pub mod fsutil;
pub mod guard_lists;
pub mod ingest;
pub mod lineage;
pub mod nesting;
pub mod pathtext;
pub mod practice;
pub mod speculation;
pub mod stack;
pub mod unlisted;
pub mod work;

pub use facts::*;
pub use unlisted::{UnlistedReason, UnlistedRoute};
