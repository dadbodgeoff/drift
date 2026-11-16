//! What a TypeScript check that answers "not signed in" tests ([`tested`]).
//!
//! A 401 says nothing by itself: a CAPTCHA answer compared with the stored one, or
//! an empty new password, is answered 401 by some code bases. What makes a check a
//! sign-in check is that it tests who calls, as the permission reading already
//! tells a value of the caller from what the request sent
//! ([`super::authz::caller_side`], [`super::authz::whose`]). No word of a callee's
//! name is asked here beyond those readings.

use drift_core::BodyCheck;

use super::Cx;
use super::authz::{Whose, caller_side, side_is_callers, whose};
use super::libraries::authn_callee;

/// What a check tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Tested {
    /// A value of the caller: a session, a user or a token read off the request
    /// or a context, what a library's session read or a function proven to give the
    /// caller hands back, or the credential the request carries in a header or a
    /// cookie.
    Caller,
    /// What the request sent in its body, query or path, or the value such input
    /// is compared with in another check of the same body (the stored CAPTCHA
    /// answer `req.body.captcha` must equal): input validation, with whatever
    /// status it answers. It says nothing of who calls, and is no proof that
    /// nothing does (`changePassword` refuses a missing token by `next(err)` after
    /// it), so the unit is unknown where nothing else is read.
    Input,
    /// A header the request carries under no credential's name, or a credential
    /// sent as input (`req.query.token`): found, not proven to be a sign-in check.
    CannotTell,
    /// Anything else the facts do not say (a value a function of the repository
    /// hands back that is not proven to be the caller's, a package's call, a
    /// condition not read): read as before, a body check. The matrix of sign-in
    /// shapes pins these (`const m = await member(req); if (!m) return 401`);
    /// whether to read them unknown is the owner's to decide.
    Unsaid,
}

/// What `c` tests ([`Tested`]); `all` are the checks of the same body.
pub(super) fn tested(cx: &Cx<'_>, c: &BodyCheck, all: &[BodyCheck]) -> Tested {
    // The value tested is itself the caller (`if (!req.user)`, `!ctx.session`):
    // [`whose`] reads the last member as the value compared and names nothing by
    // it, so the path is read to its end here.
    let itself = whose(&c.source, &format!("{}.value", c.reads)) == Whose::Caller;
    if itself || caller_side(c) || gives_caller(cx, &c.source) || gives_caller(cx, &c.compares) {
        return Tested::Caller;
    }
    if let Some(name) = carried_in(&c.source, &c.reads) {
        return if credential(&name) {
            Tested::Caller
        } else {
            Tested::CannotTell
        };
    }
    if sent(&c.source, &c.reads) {
        // A credential sent as input (`req.query.token`, `body.apiKey`) may be what
        // signs the caller in: not told.
        let key = c.reads.rsplit('.').next().unwrap_or_default();
        return if credential(key) {
            Tested::CannotTell
        } else {
            Tested::Input
        };
    }
    // What another check of the body compares the request's input with
    // (`captcha != null && req.body.captcha === captcha.answer`, of `const captcha
    // = await CaptchaModel.findOne(...)`): the reference of an input check.
    let called = format!("call:{}", c.source);
    let reference = !c.source.is_empty()
        && all.iter().any(|d| {
            (d.compares == called && sent(&d.source, &d.reads))
                || (d.source == c.source && sent(&d.compares, &d.compares_path))
        });
    if reference {
        return Tested::Input;
    }
    Tested::Unsaid
}

/// The value is what the request sent in its body, query or path, by
/// [`whose`]; not a header or a cookie ([`carried_in`]).
fn sent(root: &str, path: &str) -> bool {
    whose(root, path) == Whose::Sent && carried_in(root, path).is_none()
}

/// A side of the check is what a callee hands back that gives the caller: a
/// library's session read, or a function of the repository proven to give the
/// caller or what was made of a credential the request carries ([`side_is_callers`],
/// [`drift_core::controls::RETURNS_CREDENTIAL`]). A row a query of the repository
/// found, or what a function the facts do not prove hands back, is none of these.
fn gives_caller(cx: &Cx<'_>, side: &str) -> bool {
    use drift_core::controls::{GIVES_CALLER, RETURNS_CALLER, RETURNS_CREDENTIAL};
    let callee = side.strip_prefix("call:").unwrap_or(side);
    if callee.is_empty()
        || !callee.contains('#')
        || callee.starts_with("param:")
        || callee.starts_with("header:")
    {
        return false;
    }
    let proven = || {
        let name = crate::mine::norm_ref(callee);
        cx.context().definition(&name).is_some_and(|d| {
            d.controls
                .iter()
                .any(|c| c == RETURNS_CREDENTIAL || c == RETURNS_CALLER || c == GIVES_CALLER)
        })
    };
    authn_callee(callee) || side_is_callers(cx, &format!("gives {callee}")) || proven()
}

/// The header or cookie a value is read from, by its name: `header:<name>`, or a
/// member path through the request's headers or cookies (`req.headers.authorization`,
/// a destructured `headers.authorization`, `req.cookies.token`).
fn carried_in(root: &str, path: &str) -> Option<String> {
    if let Some(name) = root.strip_prefix("header:") {
        return Some(name.to_string());
    }
    let first = root.strip_prefix("param:")?;
    let segs: Vec<&str> = std::iter::once(first)
        .chain(path.split('.').filter(|s| !s.is_empty()))
        .collect();
    let at = segs
        .iter()
        .position(|s| matches!(*s, "headers" | "header" | "cookies" | "cookie"))?;
    Some(segs.get(at + 1).copied().unwrap_or(segs[at]).to_string())
}

/// A name the request's credentials are carried under (`authorization`,
/// `x-api-key`, `token`), as the security inventory reads a header
/// ([`crate::security::exit_unread_of_caller`]).
fn credential(name: &str) -> bool {
    !name.is_empty() && crate::security::exit_unread_of_caller(&format!("header:{name}"))
}

#[cfg(test)]
mod tests {
    use super::carried_in;

    #[test]
    fn a_header_or_cookie_is_named_by_its_key() {
        assert_eq!(
            carried_in("header:authorization", "").as_deref(),
            Some("authorization")
        );
        assert_eq!(
            carried_in("param:req", ".headers.authorization").as_deref(),
            Some("authorization")
        );
        assert_eq!(
            carried_in("param:headers", ".authorization").as_deref(),
            Some("authorization")
        );
        assert_eq!(carried_in("param:req", ".body.captcha"), None);
        assert_eq!(carried_in("param:query", ".new"), None);
    }
}
