//! The listed reading of the consumer classes ([`Linker::consumers`]): only what
//! resolves to a messaging library through imports is a consumer.
//!
//! The class rule lists a subclass of kombu's `ConsumerMixin`, and a subclass of
//! an in-repo base whose body calls a messaging library (adapter: that library),
//! or that is named for a consumer (`QueueConsumer`, `BaseWorker`, adapter
//! `queue`). A name says nothing of what feeds the class, so the listed reading
//! drops the last: such a class is not listed, and is said, with its line, as a
//! registration not listed for that reason ([`UnlistedReason::NamedOnly`]). What
//! mining reads keeps the rule as the measured build made it (the measured and
//! compat links read [`Linker::consumers`] unchanged, and so does the test of which
//! files mining links again, [`Linker::links_differently`]).

use drift_core::{UnlistedReason, UnlistedRoute};

use super::*;

/// The adapter the class rule gives a class that only a name says is a consumer.
const NAMED: &str = "queue";

impl Linker<'_> {
    /// The consumer classes of file `fi` as this link lists them: as
    /// [`Linker::consumers`] in what mining reads; in the listed reading, without
    /// those only a name says are consumers, and without a class `listed` (the
    /// file's entry points so far) already has as a consumer (one a call of the
    /// library registers, `queue.consume(self.on_message)`).
    pub(super) fn consumers_read(&self, fi: usize, listed: &[EntryPoint]) -> Vec<EntryPoint> {
        let all = self.consumers(fi);
        if self.measured || self.compat {
            return all;
        }
        let read = |e: &EntryPoint| {
            e.adapter != NAMED
                && !listed
                    .iter()
                    .any(|l| l.kind == "consumer" && l.symbol == e.symbol)
        };
        if all.iter().all(read) || !self.since_frozen() {
            return all;
        }
        all.into_iter().filter(read).collect()
    }

    /// The classes of file `fi` that only a name says are consumers, by line: what
    /// [`Linker::consumers_read`] drops. Reported by the listed link only
    /// ([`Linker::reports_unlisted`]).
    pub(super) fn consumers_named_only(&self, fi: usize) -> Vec<UnlistedRoute> {
        if !self.reports_unlisted() {
            return Vec::new();
        }
        let symbols = &self.files[fi].raw.symbols;
        self.consumers(fi)
            .iter()
            .filter(|e| e.adapter == NAMED)
            .filter_map(|e| {
                symbols
                    .iter()
                    .find(|s| s.name == e.symbol && s.owner.is_none())
                    .map(|s| UnlistedRoute {
                        line: s.line,
                        reason: UnlistedReason::NamedOnly,
                    })
            })
            .collect()
    }
}
