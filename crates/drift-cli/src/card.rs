//! `drift card <path>` and MCP `drift_card`: one file's card, put together the same way
//! for both.
//!
//! Beside the security inventory, the accepted conventions agents are shown and the
//! practice map's lines, the card states the strong regularities mining found in the
//! file's roles ([`drift_mine::card::regularities`]), whether the show policy withholds
//! their cards or no person has accepted them: as facts about the code, never as
//! conventions. Nothing else reads them: `drift check`, the hooks, the exports and SARIF
//! are what they were.
//!
//! Last before what is not known, the card names the functions the file defines that
//! other files define too ([`drift_mine::practices::duplicates_in`]), with where the
//! other copies are: text only, as the practice lines are.
//!
//! The regularities are mined when the card is asked for, as `drift init` would mine on
//! the project's policy (so the ids and counts are those `drift review` and
//! `drift review --hidden` show). Mining runs on a thread of its own beside the rest of
//! the card ([`beside`]), so the card takes as long as it did before it mined. Where
//! results may be kept ([`crate::derived`]: a project with a cache directory), what
//! mining found is kept for the facts and the policy it was found from, and the next
//! card of the same code, for any file, reads it back instead of mining again.

use std::collections::BTreeSet;
use std::path::Path;

use drift_core::RepoFacts;
use drift_mine::card::{ConventionLine, MinedCard, Regularity};
use drift_mine::mine::{Candidate, MineOptions, mine_keeping, mine_with_kinds};
use drift_mine::policy::{ConventionsFile, Lock, Status};
use drift_mine::roles::FileKinds;

use crate::derived::Derived;
use crate::project::{NewFileRules, Project};

/// What the card reads of a mining run: the cards proposed, the cards withheld (the
/// show policy's, and the Python ones while Python proposals are off), and the file
/// kinds the roles were read with. Kept between processes ([`crate::derived::MINED`]).
#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct MinedCards {
    candidates: Vec<Candidate>,
    withheld: Vec<Candidate>,
    kinds: FileKinds,
}

/// The regularities the card of `rel` states ([`drift_mine::card::regularities`]):
/// every card mining finds now, proposed or withheld, less those a person rejected,
/// those agents are shown as conventions and those in `listed` (the conventions the
/// card lists). None when the policy cannot be read: what a person decided is unknown.
pub fn regularities(
    root: &Path,
    facts: &RepoFacts,
    rel: &str,
    listed: &[ConventionLine],
    derived: Option<&Derived>,
) -> Vec<Regularity> {
    let Ok(policy) = ConventionsFile::load(root) else {
        return Vec::new();
    };
    let opts = MineOptions::default();
    let accepted = policy
        .as_ref()
        .map(ConventionsFile::accepted_rules)
        .unwrap_or_default();
    // Every value mining is run with beside the facts, read once: what is mined, and
    // the key of what is kept, are of these and nothing else.
    let frozen = policy.as_ref().map(|p| &p.file_kinds);
    let roles = (
        drift_mine::policy::test_roles(root, false),
        drift_mine::policy::kind_roles(root, false),
    );
    let python = drift_mine::policy::python_proposals(root, false).on();
    let mine = || {
        let mut mined = match frozen {
            Some(kinds) => mine_keeping(facts, &opts, kinds.clone(), &accepted),
            None => mine_with_kinds(facts, &opts, FileKinds::learn_with(facts, roles.0, roles.1)),
        };
        if !python {
            drift_mine::mine::withhold_python(&mut mined, &accepted);
        }
        MinedCards {
            candidates: mined.candidates,
            withheld: mined.withheld.into_iter().map(|w| w.candidate).collect(),
            kinds: mined.kinds,
        }
    };
    let MineOptions { max_per_repo } = &opts;
    let mined = match serde_json::to_vec(&(frozen, &accepted, roles, python, max_per_repo)) {
        Ok(more) => crate::derived::get_or(derived, crate::derived::MINED, &more, mine),
        Err(_) => mine(),
    };
    let decided = |id: &str| {
        policy
            .as_ref()
            .and_then(|p| p.conventions.iter().find(|c| c.id == id))
    };
    let mut cards: Vec<MinedCard> = Vec::new();
    for c in &mined.candidates {
        let status = match decided(&c.id) {
            Some(d) if d.status == Status::Rejected => continue,
            // Shown to agents as a convention: the card's conventions are where it is said.
            Some(d) if drift_mine::admission::shown_to_agents(d) => continue,
            Some(d) if d.status == Status::Accepted => "accepted",
            _ => "proposed",
        };
        cards.push(MinedCard { card: c, status });
    }
    for w in &mined.withheld {
        // One a person decided is theirs, not withheld: rejected, or in the lines above.
        if decided(&w.id).is_none() {
            cards.push(MinedCard {
                card: w,
                status: "withheld",
            });
        }
    }
    // For a file that is not in the repository yet: the cards whose role would hold it,
    // found as the conventions for a new file are (by its path and the policy's packages).
    let planned: BTreeSet<String> = if facts.files.iter().any(|f| f.path == rel) {
        BTreeSet::new()
    } else {
        let candidates: Vec<_> = cards.iter().map(|m| m.card.clone()).collect();
        let base = policy.map(|mut p| {
            p.conventions.clear();
            p
        });
        let view = Project {
            root: root.to_path_buf(),
            policy: ConventionsFile::merge(base, "drift", mined.kinds.clone(), &candidates),
            lock: Lock::default(),
            unverified: Vec::new(),
        };
        let covering = match view.rules_for_new_file(rel, None, false) {
            NewFileRules::Matched(convs) => convs,
            NewFileRules::Grouped(groups) => groups.into_iter().flat_map(|(_, c)| c).collect(),
        };
        covering.into_iter().map(|c| c.id.clone()).collect()
    };
    drift_mine::card::regularities(
        facts,
        &mined.kinds,
        rel,
        &cards,
        &|c| planned.contains(&c.id),
        listed,
    )
}

/// The stack mining gets on its own thread: what the main thread, where it runs
/// everywhere else, has on Linux and macOS.
const MINING_STACK: usize = 8 * 1024 * 1024;

/// `mined` and `rest`, both run to their end: `mined` on a thread of its own while
/// `rest` runs here. Mining for the regularities is the longest step of a card and
/// reads the same facts as the inventory and the practice map, so the card waits for
/// the slower of the two, not for both in turn. Where no thread can be started,
/// `mined` runs here after `rest`; a panic in it is passed on.
///
/// The hooks read the security inventory beside the practice map the same way
/// (`agent.rs`): two reads of the same facts, neither of which reads the other's
/// result, so what each returns is what it returns run alone.
pub fn beside<A: Send, B>(mined: impl Fn() -> A + Sync, rest: impl FnOnce() -> B) -> (A, B) {
    std::thread::scope(|s| {
        let thread = std::thread::Builder::new()
            .stack_size(MINING_STACK)
            .spawn_scoped(s, &mined);
        let rest = rest();
        let mined = match thread {
            Ok(t) => t
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
            Err(_) => mined(),
        };
        (mined, rest)
    })
}

/// `facts` with every listing of entry points ([`RepoFacts::listed`]), for a caller
/// with more than one reader of it: copied once, when the first reader asks (readers
/// may ask side by side), and never where no file has a second reading. The copy is
/// freed on a thread of its own: freeing the facts of a large repository takes tens
/// of milliseconds, which the answer does not wait for (and a command that ends with
/// its answer never spends).
pub struct Listed<'f> {
    facts: &'f RepoFacts,
    copy: std::sync::OnceLock<std::borrow::Cow<'f, RepoFacts>>,
}

impl<'f> Listed<'f> {
    pub fn of(facts: &'f RepoFacts) -> Self {
        Self {
            facts,
            copy: std::sync::OnceLock::new(),
        }
    }

    pub fn get(&self) -> &RepoFacts {
        self.copy.get_or_init(|| self.facts.listed())
    }
}

impl Drop for Listed<'_> {
    fn drop(&mut self) {
        if let Some(std::borrow::Cow::Owned(copy)) = self.copy.take() {
            std::thread::spawn(move || drop(copy));
        }
    }
}

/// The card of `rel` as agents read it (`drift card`, MCP `drift_card`): `conventions`
/// are the accepted conventions agents are shown that cover it. `derived`: where what
/// mining finds may be kept for these facts ([`regularities`]).
pub fn text(
    root: &Path,
    facts: &RepoFacts,
    rel: &str,
    conventions: &[ConventionLine],
    derived: Option<&Derived>,
) -> String {
    // The inventory and the practice map read every listing of the facts
    // ([`drift_core::Listed`]): one copy for both, made by whichever asks first and
    // left for the exit to free.
    let listed = Listed::of(facts);
    let (regularities, (inv, practices)) = beside(
        || regularities(root, facts, rel, conventions, derived),
        || {
            // The inventory beside the practice map's lines, as mining is beside both.
            beside(
                || {
                    drift_mine::security::inventory_with(
                        listed.get(),
                        drift_mine::security::Boundaries::load(root),
                    )
                },
                || {
                    drift_mine::practices::card_lines(
                        listed.get(),
                        &crate::practices::options(
                            root,
                            facts,
                            drift_mine::practices::Scope::default(),
                        ),
                        rel,
                    )
                },
            )
        },
    );
    drift_mine::card::with_duplicates(
        drift_mine::card::with_practices(
            drift_mine::card::card(facts, &inv, rel, conventions, &regularities, Some(root)),
            &practices,
        ),
        // What the practice map reads: an entry point of the newer listings is none.
        &drift_mine::practices::duplicates_in(listed.get(), rel),
    )
}

/// Where `drift example` points when no convention covers `rel`: the member `drift card`
/// names as "to copy" for it (an entry point of the same kind in the narrowest place of
/// its package with enough of them, one that carries the guard most of them share), as a
/// line saying so; only a member written in the file's own language, and only for a file
/// with entry points (or one not written yet, by its own directory). None when the card
/// names none.
pub fn copy_from(root: &Path, facts: &RepoFacts, rel: &str) -> Option<String> {
    let inv =
        drift_mine::security::inventory_with(facts, drift_mine::security::Boundaries::load(root));
    let card = drift_mine::card::build(facts, &inv, rel, &[], &[]);
    let lang_of = |path: &str| facts.files.iter().find(|f| f.path == path).map(|f| &f.lang);
    let own = lang_of(rel);
    // A file with no entry point of its own is not told to copy a route: for one that
    // does not exist yet, only the siblings of its own directory count, not the package's.
    if card.exists && card.entry_points.is_empty() {
        return None;
    }
    card.siblings.iter().find_map(|s| {
        let e = s.example.as_ref()?;
        if !card.exists && s.dir.as_deref().is_none_or(str::is_empty) {
            return None;
        }
        if own.is_some() && lang_of(&e.path) != own {
            return None;
        }
        let guard = s.guards.first()?;
        Some(format!(
            "to copy: {}:{} {} (the file `drift card {}` names: {} of the {} {} entry points in {} carry {}; a fact about the code, not a rule)",
            e.path,
            e.line,
            e.symbol,
            rel,
            guard.members,
            s.members,
            s.kind,
            match s.dir.as_deref() {
                Some("") | None => "the package".to_string(),
                Some(d) => format!("{d}/"),
            },
            guard.guard
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::beside;

    #[test]
    fn beside_gives_what_both_return() {
        let facts = [1, 2, 3];
        let (mined, rest) = beside(|| facts.iter().sum::<i32>(), || facts.len());
        assert_eq!((mined, rest), (6, 3));
    }

    #[test]
    #[should_panic(expected = "mining failed")]
    fn a_panic_on_the_other_thread_is_passed_on() {
        beside(|| -> u8 { panic!("mining failed") }, || ());
    }
}
