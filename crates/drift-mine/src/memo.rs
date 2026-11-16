//! Answers kept for the length of one reading, so a question asked again (the same
//! guard, named by every entry point that uses it; the same entry point, read by
//! authentication, authorization and testing) is answered once.
//!
//! A memo only ever holds what the question it stands for returns: each one is named
//! for one function, is keyed by everything that function's answer depends on beyond
//! the context that holds the memo, and is filled by calling that function. So a run
//! with the memos says exactly what a run without them says, only sooner. The practice
//! map runs its concerns side by side ([`crate::practices`]), so both kinds are behind
//! locks, and no lock is held while an answer is worked out.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Arc, Mutex, OnceLock, PoisonError, RwLock};

/// One question's answers, by the question's argument. Worked out outside the lock: two
/// threads asking at once may both work it out, and both get the one answer.
pub(crate) struct Memo<K, V> {
    answers: RwLock<HashMap<K, V>>,
}

impl<K: Eq + Hash, V: Clone> Memo<K, V> {
    /// The answer kept for `key`, or `answer()`, kept.
    pub(crate) fn get_or<Q>(&self, key: &Q, answer: impl FnOnce() -> V) -> V
    where
        K: std::borrow::Borrow<Q>,
        Q: Eq + Hash + ToOwned<Owned = K> + ?Sized,
    {
        let kept = self
            .answers
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(key)
            .cloned();
        if let Some(v) = kept {
            return v;
        }
        let v = answer();
        self.answers
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.to_owned())
            .or_insert(v)
            .clone()
    }
}

impl<K, V> Default for Memo<K, V> {
    fn default() -> Self {
        Memo {
            answers: RwLock::new(HashMap::new()),
        }
    }
}

/// A copy starts empty: it may be changed before it is asked anything
/// ([`crate::context::RepoContext::reading_since_measured`]).
impl<K, V> Clone for Memo<K, V> {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl<K, V> std::fmt::Debug for Memo<K, V> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Memo")
    }
}

/// The guard questions [`crate::security`] is asked of a wrapper or a callee, each
/// kept by its package-normalised reference under the name of the function that
/// answers it. Held by the [`crate::context::RepoContext`] they read, whose
/// [`since_measured`](crate::context::RepoContext::since_measured) they depend on.
#[derive(Debug, Clone, Default)]
pub(crate) struct Asked {
    /// [`crate::security::authenticating_root`].
    pub(crate) authenticating_root: Memo<String, Option<String>>,
    /// [`crate::security::proving_root`].
    pub(crate) proving_root: Memo<String, Option<String>>,
    /// [`crate::security::may_authenticate`].
    pub(crate) may_authenticate: Memo<String, bool>,
    /// [`crate::security::callee_is_guard`].
    pub(crate) callee_is_guard: Memo<String, bool>,
}

/// [`Memo`] for an answer that costs much and that threads running side by side ask
/// in the same order (every concern reads the entry points in one order): the first
/// to ask works it out, and one that asks meanwhile waits for that answer instead of
/// working it out too.
pub(crate) struct Shared<K, V> {
    answers: Mutex<HashMap<K, Arc<OnceLock<V>>>>,
}

impl<K: Eq + Hash, V: Clone> Shared<K, V> {
    /// The answer kept for `key`, or `answer()`, kept. `answer` must not ask this
    /// memo for the same key.
    pub(crate) fn get_or(&self, key: K, answer: impl FnOnce() -> V) -> V {
        let cell = self
            .answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key)
            .or_default()
            .clone();
        cell.get_or_init(answer).clone()
    }
}

impl<K, V> Default for Shared<K, V> {
    fn default() -> Self {
        Shared {
            answers: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A memo answers what the function answers, works each key out once, and a copy
    /// of it keeps nothing.
    #[test]
    fn answers_once_per_key() {
        let m: Memo<String, usize> = Memo::default();
        let mut calls = 0;
        assert_eq!(
            m.get_or("a", || {
                calls += 1;
                1
            }),
            1
        );
        assert_eq!(
            m.get_or("a", || {
                calls += 1;
                2
            }),
            1
        );
        assert_eq!(
            m.get_or("b", || {
                calls += 1;
                3
            }),
            3
        );
        assert_eq!(calls, 2);
        assert_eq!(m.clone().get_or("a", || 4), 4);
        let s: Shared<(usize, usize), String> = Shared::default();
        assert_eq!(s.get_or((1, 2), || "x".into()), "x");
        assert_eq!(s.get_or((1, 2), || "y".into()), "x");
        assert_eq!(s.get_or((2, 1), || "y".into()), "y");
    }
}
