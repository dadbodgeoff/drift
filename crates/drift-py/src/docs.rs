//! What a docstring explicitly says a class or function is not, or does not use:
//! `"""Not a ChoiceSet: ..."""`, `"""... so it doesn't fit `RepositoryBase`."""`.
//!
//! A team documents a deliberate exception to its own convention where the code is.
//! Only an explicit statement about the symbol itself counts: a negation whose
//! subject is the symbol (none, `it`, `this`, `this <noun>`, `the class` or its own
//! name), in an active, declarative clause, directly naming an identifier. Only the
//! negation and the identifier are kept (`ChoiceSet=Not a ChoiceSet`), never other
//! docstring text. Nothing is recorded for:
//!
//! - a mention (`"""A ChoiceSet of colours."""`, `"""Not only a ChoiceSet ..."""`);
//! - another subject (`"""Callers that do not use X ..."""`);
//! - a passive clause about others (`"""Not used by X."""`, `"""not subclassed by X"""`);
//! - a negation without a subject after a comma: it continues the clause before it
//!   (`"""`f(False)` passes the role, not `required`."""`); after a semicolon or a
//!   conjunction it is about the subject of the sentence it continues, never the
//!   symbol when that sentence opens on a call or other code;
//! - a question, `need not`, and a docstring that says the exception is pending (a
//!   `TODO`, `FIXME` or `yet` anywhere in it).

use ruff_python_ast::{Expr, Stmt};

/// Negating words. An auxiliary in front of `not` (`does not`) is kept in the phrase.
const NEGATIONS: &[&str] = &[
    "not",
    "never",
    "cannot",
    "can't",
    "isn't",
    "aren't",
    "wasn't",
    "doesn't",
    "don't",
    "won't",
    "shouldn't",
    "mustn't",
];

/// Auxiliaries kept in front of `not` / `never` (`need not` is not a statement).
const AUXILIARIES: &[&str] = &[
    "is", "are", "was", "does", "do", "did", "should", "must", "can", "will",
];

/// Adverbs allowed between the subject and the negation.
const ADVERBS: &[&str] = &[
    "deliberately",
    "intentionally",
    "purposely",
    "explicitly",
    "also",
    "still",
    "simply",
];

/// Subjects that are the symbol itself (with its own name and `this <noun>`).
const SELF_SUBJECTS: &[&str] = &["it", "this", "class"];

/// Words that start a clause without a subject of their own (`..., so it does not`,
/// `... and does not`).
const CONJUNCTIONS: &[&str] = &["so", "and", "but", "therefore", "thus", "hence"];

/// Verbs that relate a class or function to the name after them, by stem; a word is a
/// verb when it is a stem with an inflection ([`is_verb`]), never by prefix.
const VERB_STEMS: &[&str] = &[
    "use",
    "extend",
    "subclass",
    "inherit",
    "derive",
    "fit",
    "decorate",
    "register",
    "implement",
    "build",
];
/// Irregular forms.
const VERB_FORMS: &[&str] = &[
    "using",
    "built",
    "based",
    "fitting",
    "deriving",
    "decorating",
];
const INFLECTIONS: &[&str] = &["", "s", "es", "d", "ed", "ing"];
/// Passive verbs whose agent (`by X`) is still about the symbol: it is decorated or
/// registered by X.
const PASSIVE_ABOUT_SELF: &[&str] = &["decorated", "registered"];

const PREPOSITIONS: &[&str] = &["from", "with", "by", "on", "via"];
const ARTICLES: &[&str] = &["a", "an", "the"];
/// `not a subclass of X`.
const RELATIONS: &[&str] = &["subclass", "instance", "kind", "type"];
/// Words that say the exception is pending, not settled.
const PENDING: &[&str] = &["todo", "fixme", "yet"];

/// Most names one docstring can disclaim.
const MAX_DISCLAIMS: usize = 8;
/// Words of a docstring read.
const MAX_WORDS: usize = 2000;

/// The leading docstring of a class or function body.
pub(crate) fn docstring(body: &[Stmt]) -> Option<&str> {
    match body.first() {
        Some(Stmt::Expr(e)) => match e.value.as_ref() {
            Expr::StringLiteral(s) => Some(s.value.to_str()),
            _ => None,
        },
        _ => None,
    }
}

struct Word<'a> {
    /// Without surrounding punctuation.
    text: &'a str,
    lower: String,
    /// The raw token was decorated like code: backticks, quotes, `@`, `()`.
    code: bool,
    /// The raw token is a call with arguments (`` `f(False)` ``, `` `f(a, `` ): an
    /// expression, not the name of a symbol.
    call: bool,
    /// The clause punctuation the raw token ends with (`.`, `,`, `?`, ...): a
    /// negation does not reach past it.
    stop: Option<char>,
}

fn word(raw: &str) -> Word<'_> {
    let trim_start: &[char] = &['`', '"', '\'', '(', '[', '{', '*', '@'];
    let trim_end: &[char] = &[
        '`', '"', '\'', '(', ')', ']', '}', '.', ',', ';', ':', '!', '?', '*',
    ];
    let t = raw
        .trim_start_matches(trim_start)
        .trim_end_matches(trim_end);
    let code = raw.starts_with(['`', '"', '\'', '@']) || raw.contains("()");
    let call = raw
        .split_once('(')
        .is_some_and(|(_, args)| !args.is_empty() && !args.starts_with(')'));
    let stop = raw
        .trim_end_matches(['`', '"', '\'', ')', ']', '}', '*'])
        .chars()
        .last()
        .filter(|c| matches!(c, '.' | ',' | ';' | ':' | '!' | '?'));
    Word {
        text: t,
        lower: t.to_lowercase(),
        code,
        call,
        stop,
    }
}

/// How a name follows its negation.
#[derive(Clone, Copy, PartialEq, Eq)]
enum After {
    /// Right after it (`not ChoiceSet`): only a name that is certainly code counts.
    Bare,
    /// After an article, a verb or `subclass of` (`not a Model`, `does not use Model`).
    Phrase,
}

/// The identifier a word names, as written (a dotted path stays dotted:
/// `models.BaseModel`), if it looks like code: its last segment has an upper-case
/// letter or an underscore, or it is written as code (`` `cached` ``). Right after a
/// negation, a capitalised word (`not Found`) is not enough: it needs two capitals
/// (`ChoiceSet`), an underscore or code marks. Constants written in capitals (`NOT
/// NULL`, `DO NOT USE THIS`) and `None`, `True`, `False` are no names.
fn identifier(w: &Word, after: After) -> Option<String> {
    let segment_ok = |s: &str| {
        s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    if !w.text.split('.').all(segment_ok) {
        return None;
    }
    let name = w.text.rsplit('.').next().unwrap_or(w.text);
    if !name.chars().any(|c| c.is_ascii_lowercase()) || matches!(name, "None" | "True" | "False") {
        return None;
    }
    let capitals = name.chars().filter(char::is_ascii_uppercase).count();
    let codeish = w.code
        || name.contains('_')
        || match after {
            After::Bare => capitals >= 2,
            After::Phrase => capitals >= 1,
        };
    codeish.then(|| w.text.to_string())
}

fn is_verb(lower: &str) -> bool {
    VERB_FORMS.contains(&lower)
        || VERB_STEMS.iter().any(|s| {
            INFLECTIONS.iter().any(|i| {
                lower.len() == s.len() + i.len() && lower.starts_with(s) && lower.ends_with(i)
            })
        })
}

/// `Name=phrase` for every explicit negation of a name in `doc` about the symbol
/// called `own` (its own name may be the subject), sorted.
pub(crate) fn disclaims(doc: &str, own: &str) -> Vec<String> {
    let doc = doc.replace('\u{2019}', "'");
    let words: Vec<Word> = doc.split_whitespace().take(MAX_WORDS).map(word).collect();
    // An exception the docstring calls pending is not settled.
    if words.iter().any(|w| PENDING.contains(&w.lower.as_str())) {
        return vec![];
    }
    let mut out = Vec::new();
    for (i, w) in words.iter().enumerate() {
        if w.stop.is_some() || !NEGATIONS.contains(&w.lower.as_str()) {
            continue;
        }
        let Some(start) = about_self(&words, i, own) else {
            continue;
        };
        let Some((end, name)) = negated_name(&words, i + 1) else {
            continue;
        };
        // A question states nothing.
        if words[end..]
            .iter()
            .find_map(|w| w.stop.filter(|c| matches!(c, '.' | '!' | '?')))
            == Some('?')
        {
            continue;
        }
        let mut phrase: Vec<&str> = words[start..end].iter().map(|w| w.text).collect();
        phrase.push(&name);
        out.push(format!("{name}={}", phrase.join(" ")));
        if out.len() == MAX_DISCLAIMS {
            break;
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The negation at `i` is about the symbol itself: what precedes it in its clause,
/// past an auxiliary and adverbs, is nothing (`Not a ChoiceSet`), a conjunction that
/// opens a clause, or a subject that is the symbol (`it`, `this`, `this <noun>`, `the
/// class`, its own name). Returns where the phrase starts (the auxiliary, if any).
fn about_self(words: &[Word], i: usize, own: &str) -> Option<usize> {
    // The word before `j` in the same clause.
    let prev = |j: usize| {
        j.checked_sub(1)
            .map(|b| &words[b])
            .filter(|b| b.stop.is_none())
    };
    let mut start = i;
    let mut j = i;
    if matches!(words[i].lower.as_str(), "not" | "never") {
        if let Some(p) = prev(j).map(|p| p.lower.as_str()) {
            if matches!(p, "need" | "or" | "if") {
                return None;
            }
            if AUXILIARIES.contains(&p) {
                j -= 1;
                start = j;
            }
        }
    } else if prev(j).is_some_and(|p| matches!(p.lower.as_str(), "or" | "if")) {
        return None;
    }
    while prev(j).is_some_and(|p| ADVERBS.contains(&p.lower.as_str())) {
        j -= 1;
    }
    let Some(subject) = prev(j) else {
        // No subject of its own: a statement about the symbol when it opens a sentence
        // (`Not a ChoiceSet: ...`, `Note: not a ChoiceSet.`), or a clause after a
        // semicolon in a sentence about the symbol (`Secondary filterset; not
        // registered ...`). After a comma it continues the clause before it, whose
        // subject may be anything (`` `f(False)` passes the role, not `required`. ``).
        let after_semicolon = j.checked_sub(1).is_some_and(|b| words[b].stop == Some(';'));
        return (opens_sentence(words, j)
            || (after_semicolon && !opens_on_other_code(words, j - 1, own)))
        .then_some(start);
    };
    let s = subject.lower.as_str();
    // A conjunction continues the sentence before it, about that sentence's subject:
    // the symbol unless the sentence opens on code that is not the symbol's own name
    // (`` `f(False)` passes the role and not `required` ``).
    if CONJUNCTIONS.contains(&s) {
        return (!opens_on_other_code(words, j - 1, own)).then_some(start);
    }
    if subject.text == own || SELF_SUBJECTS.contains(&s) {
        // `the class`, `this filterset`: a determiner names the symbol; a subject
        // after another word (`users who`) is not reached here.
        return Some(start);
    }
    // `this filterset`, `this repository`: a noun after `this`.
    let before = prev(j - 1)?;
    (before.lower == "this").then_some(start)
}

/// Word `j` opens a sentence: it is the docstring's first word, or the word before it
/// ends a sentence or introduces one (`.`, `!`, `?`, `:`).
fn opens_sentence(words: &[Word], j: usize) -> bool {
    j.checked_sub(1).is_none_or(|b| {
        words[b]
            .stop
            .is_some_and(|c| matches!(c, '.' | '!' | '?' | ':'))
    })
}

/// The sentence that word `j` is in opens on code other than the symbol's own name: a
/// call (`` `f(False)` ``, even of the symbol), or another identifier written as code.
fn opens_on_other_code(words: &[Word], j: usize, own: &str) -> bool {
    let mut first = j;
    while first > 0 && !opens_sentence(words, first) {
        first -= 1;
    }
    let w = &words[first];
    w.call || (w.code && w.text != own)
}

/// After a negation, from word `j` on: the name it negates and the index of the
/// name's word. `[be] [a|an|the] NAME`, `[be] VERB [PREP] [a|an|the] NAME`, or
/// `[be] [a|an] subclass of [a|an|the] NAME`, within one clause. A passive verb with
/// an agent (`used by X`, `subclassed by X`) is about X, not the symbol.
fn negated_name(words: &[Word], j: usize) -> Option<(usize, String)> {
    // The words between the negation and the name, which must not end the clause.
    let at = |j: usize| {
        words
            .get(j)
            .filter(|w| w.stop.is_none())
            .map(|w| w.lower.as_str())
    };
    let mut j = j;
    if at(j) == Some("be") {
        j += 1;
    }
    let article = |j: &mut usize| {
        if at(*j).is_some_and(|w| ARTICLES.contains(&w)) {
            *j += 1;
        }
    };
    let name_at = |j: usize, after| {
        words
            .get(j)
            .and_then(|w| identifier(w, after))
            .map(|n| (j, n))
    };
    let mut k = j;
    article(&mut k);
    let after = if k == j { After::Bare } else { After::Phrase };
    if let Some(found) = name_at(k, after) {
        // A verb or relation word is not a name unless written as code.
        let w = &words[k];
        if !(is_verb(&w.lower) || RELATIONS.contains(&w.lower.as_str())) || w.code {
            return Some(found);
        }
    }
    // `[a|an] subclass of [the] NAME`.
    if at(k).is_some_and(|w| RELATIONS.contains(&w)) && at(k + 1) == Some("of") {
        let mut m = k + 2;
        article(&mut m);
        return name_at(m, After::Phrase);
    }
    if let Some(verb) = at(j).filter(|w| is_verb(w)) {
        let mut m = j + 1;
        if let Some(prep) = at(m).filter(|w| PREPOSITIONS.contains(w)) {
            if prep == "by" && verb.ends_with("ed") && !PASSIVE_ABOUT_SELF.contains(&verb) {
                return None;
            }
            m += 1;
        }
        article(&mut m);
        return name_at(m, After::Phrase);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::disclaims;

    fn of(doc: &str) -> Vec<String> {
        disclaims(doc, "Own")
    }

    #[test]
    fn explicit_negations_name_what_they_negate() {
        assert_eq!(
            of("The slugs of the actions. Not a ChoiceSet: the full set lives elsewhere."),
            vec!["ChoiceSet=Not a ChoiceSet"]
        );
        assert_eq!(
            of("Composite key, so\n    it doesn't fit `RepositoryBase`. Methods here."),
            vec!["RepositoryBase=doesn't fit RepositoryBase"]
        );
        assert_eq!(
            of("This filterset is not registered with @register_filterset()."),
            vec!["register_filterset=is not registered with register_filterset"]
        );
        assert_eq!(
            of("Deliberately does not extend models.BaseModel."),
            vec!["models.BaseModel=does not extend models.BaseModel"]
        );
        assert_eq!(
            of("Is not a subclass of the ChoiceSet."),
            vec!["ChoiceSet=Is not a subclass of the ChoiceSet"]
        );
        assert_eq!(
            of("Own is not a ChoiceSet."),
            vec!["ChoiceSet=is not a ChoiceSet"]
        );
        assert_eq!(
            of("The class does not use ChoiceSet."),
            vec!["ChoiceSet=does not use ChoiceSet"]
        );
        assert_eq!(
            of("Not decorated by `register_type`."),
            vec!["register_type=Not decorated by register_type"]
        );
    }

    #[test]
    fn constants_and_capitalised_words_are_no_names() {
        for doc in [
            "Column is NOT NULL.",
            "DO NOT USE THIS.",
            "Returns 404 Not Found.",
            "The result is not None.",
            "Not Found otherwise.",
        ] {
            assert_eq!(of(doc), Vec::<String>::new(), "{doc:?}");
        }
        // A capitalised word after an article or verb is a name: `not a Model`.
        assert_eq!(of("Not a Model."), vec!["Model=Not a Model"]);
        assert_eq!(of("not `cached`"), vec!["cached=not cached"]);
    }

    #[test]
    fn a_mention_is_not_a_negation() {
        for doc in [
            "A ChoiceSet of colours.",
            "Like ChoiceSet, but for icons.",
            "Not only a ChoiceSet: also a registry.",
            "Not just a ChoiceSet.",
            "Uses ChoiceSet, not a list.",
            "Whether or not ChoiceSet applies is decided later.",
            "Does not extend ChoiceSet's behaviour.",
            "This is not a problem.",
            "Not a plain ChoiceSet.",
            "This cannot be used. ChoiceSet values are fixed.",
            "Returns None if not ChoiceSet",
        ] {
            let got = of(doc);
            assert!(
                got.iter().all(|d| !d.starts_with("ChoiceSet=")),
                "{doc:?} -> {got:?}"
            );
        }
    }

    // Review of #53: the statement must be about the symbol itself, settled and
    // declarative.
    #[test]
    fn only_settled_statements_about_the_symbol_itself_count() {
        for doc in [
            // Another subject.
            "Callers that do not use ChoiceSet get raw strings.",
            "Shown to users who are not an Admin.",
            "Plugins do not extend ChoiceSet here.",
            // Passive, about others.
            "Not used by ChoiceSet.",
            "It is not subclassed by ChoiceSet.",
            // A question.
            "Why not a ChoiceSet? Because plugins extend it.",
            "Should this not extend ChoiceSet?",
            // `need not`.
            "It need not extend ChoiceSet.",
            // Pending.
            "Not a ChoiceSet yet.",
            "Not a ChoiceSet. TODO: convert it.",
            "FIXME not a ChoiceSet",
            // Whole-word verbs: `useful` is not `use`.
            "Not useful ChoiceSet values.",
            "Not fitted ChoiceSet.",
        ] {
            assert_eq!(of(doc), Vec::<String>::new(), "{doc:?}");
        }
    }

    // The fastapi-deps fixture (#53): a clause after a comma continues the sentence
    // before it, whose subject is a call; a statement about a call, or about code other
    // than the symbol, is not about the symbol.
    #[test]
    fn statements_about_a_call_or_after_a_comma_are_not_about_the_symbol() {
        let own = |doc: &str, name: &str| disclaims(doc, name);
        for (doc, name) in [
            (
                "`require_role(False)` passes the role, not `required`.",
                "require_role",
            ),
            (
                "`require_role(False)` passes the role and not `required`.",
                "require_role",
            ),
            (
                "`require_role(False)` does not use `required`.",
                "require_role",
            ),
            ("`require_role(x)` is not a `Depends`.", "require_role"),
            ("Takes a role, not a `RoleSet`.", "Own"),
            (
                "`require_role(False)` passes the role; not `required`.",
                "require_role",
            ),
            ("Returns the role, deliberately not `required`.", "Own"),
            ("Wraps the view, is not a `ChoiceSet`.", "Own"),
            (
                "`Other` builds the form and does not extend `ChoiceSet`.",
                "Own",
            ),
        ] {
            assert_eq!(own(doc, name), Vec::<String>::new(), "{doc:?}");
        }
        // Statements that open a sentence, or continue one about the symbol, still count.
        assert_eq!(
            own("Lists the roles. Not a `ChoiceSet`.", "Own"),
            vec!["ChoiceSet=Not a ChoiceSet"]
        );
        assert_eq!(
            own(
                "Secondary filterset; not registered with `register_filterset`.",
                "Own"
            ),
            vec!["register_filterset=not registered with register_filterset"]
        );
        assert_eq!(
            own("Note: not a `ChoiceSet`.", "Own"),
            vec!["ChoiceSet=not a ChoiceSet"]
        );
        assert_eq!(
            own("Lists the roles and does not extend `ChoiceSet`.", "Own"),
            vec!["ChoiceSet=does not extend ChoiceSet"]
        );
        assert_eq!(
            own(
                "`Own()` builds the form and does not extend `ChoiceSet`.",
                "Own"
            ),
            vec!["ChoiceSet=does not extend ChoiceSet"]
        );
        assert_eq!(
            own("`require_role()` is not a `Depends`.", "require_role"),
            vec!["Depends=is not a Depends"]
        );
    }
}
