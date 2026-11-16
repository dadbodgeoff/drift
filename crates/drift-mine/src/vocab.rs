//! The access-control vocabularies: the one place Drift reads from a name alone
//! whether something is about who may call code. There are two, with opposite error
//! budgets, and a caller picks one by what a match would make Drift do.
//!
//! - [`refuse`] over-includes. A name it takes may only make Drift stricter: refuse an
//!   exemption (the gate, F7/F8, framework root files), a narrowing, a shared part, an
//!   opt-out, or a sibling joining a variant set. A word too many costs an exemption or
//!   a merge; it never hides a violation.
//! - [`grant`] under-includes. A name it takes may make Drift looser: a wrapper built on
//!   another counts as it (`call_match`), a wrapper the facts do not define counts as a
//!   guard ([`grant::grants_by_name`], read by [`crate::security::authenticates`]), a
//!   sibling of the same strength joins a variant set (`sibling_of`), an error class
//!   makes what throws it a guard ([`grant::rejection_class`]). A word too many there
//!   hides a violation. Its opening words (`public`, `optional`, `OrNull`) only veto a
//!   grant, so they over-include.
//!
//! What this module's tests hold every change to:
//! - every word a grant classifier grants on is a refuse word, and some refuse words
//!   grant nothing (grant is a strict subset of refuse): a name that may make a rule
//!   hold is always one that refuses its exemption;
//! - the grant words are pinned, and no refuse-only word makes a grant classifier grant,
//!   in whatever name it stands;
//! - outside this module, only the grant sites listed in the tests read [`grant`], and
//!   no other source file declares a word list.
//!
//! [`grant::auth_class`] and [`grant::auth_strength`] are two classifiers because they
//! answer two questions. `auth_class` says whether one binding is a guard by its name
//! (`Authenticated`) or opens access (`Public`), from the binding's own name before any
//! member path (`authedProcedure.use()`): a privilege counts (`adminProcedure` is a
//! guard). `auth_strength` ranks alternatives against each other (open, unknown,
//! authenticated) so that a sibling joins a variant set only at the same rank, from
//! every segment of the chain (`authenticatedActionClient.inputSchema().action`):
//! a privilege is no authentication rank, or `authedProcedure` would join an
//! `adminProcedure` set as its equal. One classifier would loosen one of the two grants.
//! They share their core words ([`grant::AUTHENTICATION_WORDS`]).

pub mod refuse {
    //! The refuse vocabulary: [`WORDS`] and [`PHRASES`] ([`names_access_control`]),
    //! which every refusal reads, and the refusals' own additions, which may only add
    //! to it: shared parts ([`part_guard_shaped`]), who may pass
    //! ([`guard_shaped`]: privileges, scopes, other proofs, openings), opt-outs
    //! ([`wrapper_access_shaped`]). A word here only ever keeps a check on.

    /// The refuse vocabulary: words that name access control in a wrapper's, decorator's,
    /// base class's or callee's name ([`names_access_control`]). Every refusal reads it:
    /// the exemption gate ([`crate::mine::Rule::exemption_allowed`]), the F7/F8 exemptions'
    /// guard check, narrowing, shared parts ([`part_guard_shaped`]), opt-outs and anything
    /// else that narrows or exempts a rule by its target's name. A name it takes for access
    /// control only ever keeps a check on, so it over-includes, and every word a
    /// [`super::grant`] classifier grants on is in it.
    /// `member` is in it (`assertMember`, `ensureMembership`; `listMembers` too, which only
    /// refuses more). Subject and tenancy words (`user`, `team`, `workspace`) are not: alone
    /// they say who calls, not that anything is checked (`requireUser` is, by
    /// [`PHRASES`]).
    pub const WORDS: &[&str] = &[
        "auth",
        "authed",
        "authenticated",
        "authenticator",
        "authentication",
        "authorize",
        "authorization",
        "authorized",
        "authorizer",
        "authorise",
        "authorisation",
        "authorised",
        "authenticate",
        "authz",
        "authn",
        "login",
        "logged",
        "permission",
        "permitted",
        "admin",
        "guard",
        "guarded",
        "protected",
        "secure",
        "secured",
        "security",
        "csrf",
        "token",
        "jwt",
        "oauth",
        "session",
        "role",
        "rbac",
        "acl",
        "access",
        "policy",
        "tenant",
        "scope",
        "scoped",
        "restricted",
        "private",
        "staff",
        "superuser",
        "owner",
        // CASL's `can()` / `ability.can()`, and `canEditProject`: only ever a whole word of
        // the name (`cancel`, `scan`, `candidate`, `canvas` are other words).
        "can",
        "ability",
        "ownership",
        "owns",
        "member",
        "membership",
        "entitled",
        "entitlement",
        "allowed",
        "protect",
        "permit",
        "signed",
        "verify",
        "verified",
        "credential",
        "apikey",
        "ratelimit",
        "throttle",
        // What the grant classifiers take too ([`super::grant::STRENGTH_EXTRA_WORDS`],
        // [`super::grant::REJECTION_WORDS`]): a name that grants always refuses.
        "internal",
        "unauthorized",
        "unauthorised",
        "unauthenticated",
        "forbidden",
    ];

    /// Runs of words that name access control together, though no word does alone:
    /// `requireUser`, `requireUserId`, `require_user`, Django's `user_passes_test`.
    /// (`user` alone, `requireConfig`, `passesTest` say nothing.)
    const PHRASES: &[&[&str]] = &[
        &["require", "user"],
        &["requires", "user"],
        &["required", "user"],
        &["user", "passes", "test"],
    ];

    /// The symbol's name (any segment after the module: `LoginRequiredMixin`,
    /// `TenantScopedModel`, `RowLevelSecurityModel`, `requires_auth`, `ability.can`,
    /// `authActionClient.inputSchema().action`) has a word that names access control
    /// ([`WORDS`], singular or plural). Every segment, as [`super::grant::auth_strength`]
    /// reads a chain: a name that ranks as authenticated always refuses. A rule on such a
    /// target is a security boundary even where no entry point shows it: every exemption
    /// path refuses it ([`crate::mine::Rule::exemption_allowed`]).
    pub fn names_access_control(canonical: &str) -> bool {
        let name = canonical.rsplit_once('#').map_or(canonical, |(_, n)| n);
        let words: Vec<String> = name
            .split(['.', '(', ')'])
            .flat_map(crate::mine::words)
            .map(|w| w.to_ascii_lowercase())
            .collect();
        words.iter().any(|w| {
            WORDS.contains(&w.as_str()) || WORDS.contains(&crate::mine::singular(w).as_str())
        }) || PHRASES.iter().any(|p| {
            words
                .windows(p.len())
                .any(|w| w.iter().zip(*p).all(|(a, b)| a == b))
        })
    }

    /// Words beyond [`WORDS`] that make a rule's target
    /// guard-shaped for shared parts: who is asking (`user`, `member`, `account`), tenancy
    /// (`team`, `workspace`, `org`), keys and abilities, rate limits. They only ever refuse
    /// parts (narrowing), never allow one.
    pub(crate) const PART_EXTRA_WORDS: &[&str] = &[
        "user",
        "rate",
        "team",
        "workspace",
        "org",
        "organization",
        "account",
        "key",
    ];

    /// The wrapper's or callee's name says it controls access (`withAuth`, `requireSession`,
    /// `withWorkspace`, `ensureTeamAccess`, `assertCan`,
    /// `authActionClient.inputSchema().action`, `@UseGuards`, `<ProtectedRoute>`), for
    /// shared parts ([`crate::parts`]): [`WORDS`] or [`PART_EXTRA_WORDS`] in any segment
    /// of its name or in its file's name, or [`names_access_control`].
    pub fn part_guard_shaped(target: &str) -> bool {
        let name = target.rsplit_once('#').map_or(target, |(_, n)| n);
        let module = target.split_once('#').map_or("", |(m, _)| m);
        let file = module.rsplit('/').next().unwrap_or(module);
        name.split(['.', '(', ')'])
            .chain(std::iter::once(file))
            .flat_map(crate::mine::words)
            .any(|w| {
                let is = |w: &str| WORDS.contains(&w) || PART_EXTRA_WORDS.contains(&w);
                is(&w) || is(&crate::mine::singular(&w))
            })
            || names_access_control(target)
    }

    /// Words that say a wrapper decides who may pass, though not by authentication: a
    /// privilege (`adminProcedure`, `admin_required`), a tenant scope (`orgProcedure`,
    /// `withWorkspace`), a requirement (`ajax_required`, `staffOnly`) or another proof
    /// (`withCron`, `verifySignature`).
    pub(crate) const WHO_MAY_PASS_WORDS: &[&str] = &[
        "admin",
        "admins",
        "administrator",
        "staff",
        "superuser",
        "owner",
        "owners",
        "org",
        "orgs",
        "organization",
        "organisation",
        "team",
        "teams",
        "workspace",
        "workspaces",
        "tenant",
        "member",
        "members",
        "membership",
        "require",
        "required",
        "requires",
        "only",
        "restrict",
        "restricted",
        "policy",
        "authorizer",
        "authoriser",
        "check",
        "checks",
        "can",
        "ensure",
        "verify",
        "verified",
        "token",
        "apikey",
        "key",
        "secret",
        "signature",
        "signed",
        "hmac",
        "csrf",
        "captcha",
        "cron",
    ];

    /// The name states something about who may pass: an [`super::grant::AuthStrength`]
    /// other than unknown (an open word counts: it says who may pass too), or a
    /// [`WHO_MAY_PASS_WORDS`] word (`adminProcedure`, `RequireAuth`, `withCron`), or
    /// [`names_access_control`]. Read by refusals only (framework root files, sibling
    /// joins, opt-outs); it reads the grant classifier, which only takes words this
    /// vocabulary takes too.
    pub fn guard_shaped(guard: &str) -> bool {
        names_access_control(guard)
            || super::grant::auth_strength(guard) != super::grant::AuthStrength::Unknown
            || super::grant::guard_words(guard)
                .iter()
                .any(|w| WHO_MAY_PASS_WORDS.contains(&w.as_str()))
    }

    /// Words that say a wrapper is about who may call the code: authentication, sessions,
    /// permissions, roles, openings. A wrapper whose name, module or callees use one is
    /// guard- or auth-shaped.
    pub(crate) const OPT_OUT_ACCESS_WORDS: &[&str] = &[
        "auth",
        "authn",
        "authz",
        "authenticate",
        "authenticated",
        "authentication",
        "authorize",
        "authorise",
        "authorized",
        "authorised",
        "authorization",
        "authorisation",
        "oauth",
        "guard",
        "guards",
        "permission",
        "permissions",
        "perm",
        "perms",
        "login",
        "logged",
        "logout",
        "session",
        "sessions",
        "role",
        "roles",
        "rbac",
        "acl",
        "access",
        "protect",
        "protected",
        "secure",
        "security",
        "token",
        "jwt",
        "passport",
        "admin",
        "scope",
        "scopes",
        "policy",
        "policies",
        "public",
        "anonymous",
        "csrf",
        "credential",
        "credentials",
        "apikey",
        "throttle",
        "ratelimit",
    ];

    /// Packages that only exist to authenticate or authorise.
    const OPT_OUT_ACCESS_PACKAGES: &[&str] = &[
        "jsonwebtoken",
        "jose",
        "lucia",
        "better-auth",
        "casbin",
        "@casl/ability",
    ];

    /// Package scopes whose every package authenticates (`@clerk/nextjs`, `@auth/core`).
    const OPT_OUT_ACCESS_SCOPES: &[&str] = &["@clerk/", "@auth/"];

    /// A wrapper (`target`, a canonical ref) is guard- or auth-shaped for an opt-out
    /// ([`crate::opt_out`]; besides [`guard_shaped`] and [`names_access_control`]): its name or module,
    /// or one of `calls` (what its body calls, canonical refs), names access control
    /// ([`OPT_OUT_ACCESS_WORDS`]: `Authenticated`, `UseGuards`, `login_required`, `next-auth`), or
    /// comes from an access-control package. Whether such a wrapper is missing is never
    /// for an opt-out to decide: what it guards is the entry point. Only ever a reason to
    /// refuse, so a word it over-matches costs an exemption, never a missed violation.
    pub fn wrapper_access_shaped<'c>(
        target: &'c str,
        calls: impl IntoIterator<Item = &'c str>,
    ) -> bool {
        std::iter::once(target).chain(calls).any(|r| {
            let module = r.split_once('#').map_or(r, |(m, _)| m);
            crate::mine::words(r)
                .iter()
                .any(|w| OPT_OUT_ACCESS_WORDS.contains(&w.as_str()))
                || module.strip_prefix("pkg:").is_some_and(|m| {
                    OPT_OUT_ACCESS_PACKAGES
                        .iter()
                        .any(|p| m == *p || m.starts_with(&format!("{p}/")))
                        || OPT_OUT_ACCESS_SCOPES.iter().any(|p| m.starts_with(p))
                })
        })
    }

    /// An error class named for turning away a caller who is signed in:
    /// `ForbiddenError`, `PermissionDenied`, `AccessDeniedError`, `AuthorizationError`,
    /// `NotAuthorized`. One named only for signing in (`UnauthorizedError`,
    /// `AuthenticationFailed`, `NotAuthenticated`) is not, nor is any class
    /// [`super::grant::rejection_class`] does not take. Only ever a reason to say
    /// less: the practice map reads it to keep from saying that nothing checks a
    /// caller's key where such an error is raised.
    pub fn forbids_class(canonical: &str) -> bool {
        if !super::grant::rejection_class(canonical) {
            return false;
        }
        let name = canonical.rsplit_once('#').map_or(canonical, |(_, n)| n);
        let name = name.trim_end_matches("(new)");
        let name = name.rsplit('.').next().unwrap_or(name);
        let words: Vec<String> = crate::mine::words(name)
            .into_iter()
            .map(|w| w.to_ascii_lowercase())
            .collect();
        let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
        has(FORBIDS_WORDS) || (has(&["not"]) && has(FORBIDS_NOT_WORDS))
    }

    /// The rejection words that say allowed or not, rather than signed in or not
    /// ([`forbids_class`]); each is one [`super::grant::rejection_class`] reads.
    const FORBIDS_WORDS: &[&str] = &[
        "forbidden",
        "permission",
        "access",
        "authorization",
        "authorisation",
    ];

    /// What `not` forbids ([`forbids_class`]): `NotAuthorized`.
    const FORBIDS_NOT_WORDS: &[&str] = &["authorized", "authorised"];
}

pub mod grant {
    //! The grant vocabulary: classifiers whose match may make a rule hold or a wrapper
    //! count as a guard ([`auth_class`] `Authenticated`, [`grants_by_name`],
    //! [`auth_strength`] at a sibling's rank, [`rejection_class`]). Each takes only words
    //! [`super::refuse::WORDS`] takes too, and fewer: a word belongs here only when a name
    //! with it, and no opening word, turns away callers who are not signed in or not
    //! allowed. Its opening words ([`AuthClass::Public`], [`AuthStrength::Open`]) veto a
    //! grant and over-include.

    /// What a wrapper's name says about who may call what it wraps.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum AuthClass {
        /// Named for authentication or authorisation: `authedProcedure`, `withAuth`,
        /// `protectedProcedure`, `adminProcedure`, `authenticatedActionClient`.
        Authenticated,
        /// Named for opening it to anyone: `publicProcedure`, `unauthedClient`,
        /// `optionalAuthProcedure`, `anonymousAction`.
        Public,
        /// Says neither (`bookingsProcedure`, `actionClient`).
        Unknown,
    }

    /// Words that name an opening on their own: they win over authentication words
    /// (`publicAuthRoute`, `optionalAuthProcedure`).
    const PUBLIC_WORDS: &[&str] = &[
        "public",
        "unauth",
        "unauthed",
        "unauthenticated",
        "unauthorized",
        "unauthorised",
        "noauth",
        "anonymous",
        "anon",
        "optional",
        "guest",
        "guests",
        "open",
        "unprotected",
        "authless",
        "everyone",
        "anyone",
        "insecure",
        "unsafe",
    ];

    /// Words that negate or weaken an authentication word (or a subject word,
    /// [`SUBJECT_WORDS`]) anywhere in the same name:
    /// `notAuthedProcedure`, `skipAuth`, `authNotRequired`, `auth_exempt`, `softAuth`,
    /// `withAuthOrNull`, `authIfPresent`, `maybeAuthenticatedProcedure`,
    /// `loggedOutProcedure`, `login_not_required`. A name with one is never authenticated.
    const WEAKENING_WORDS: &[&str] = &[
        "no",
        "non",
        "not",
        "un",
        "skip",
        "skips",
        "skipped",
        "ignore",
        "ignores",
        "disable",
        "disabled",
        "without",
        "exempt",
        "except",
        "soft",
        "try",
        "maybe",
        "if",
        "or",
        "out",
        "null",
        "nullable",
        "lax",
        "bypass",
        "allow",
        "unless",
        "less",
        "off",
        "none",
        "free",
        "lenient",
        "loose",
        "relaxed",
        "noop",
        "mock",
        "fake",
        "insecure",
        "unsafe",
        "everyone",
        "anyone",
        "perhaps",
        "when",
        "present",
        "possible",
        "whenpresent",
        "ifpossible",
        "any",
    ];

    /// Words that name authentication or authorisation: the core both [`auth_class`] and
    /// [`auth_strength`] grant on.
    pub(crate) const AUTHENTICATION_WORDS: &[&str] = &[
        "auth",
        "authed",
        "authenticate",
        "authenticated",
        "authorize",
        "authorise",
        "authorized",
        "authorised",
        "protected",
        "private",
        "session",
        "signed",
        "logged",
        "login",
        "permission",
        "permissions",
        "secure",
    ];

    /// What [`auth_class`] grants on beyond [`AUTHENTICATION_WORDS`]: a privilege. An
    /// `adminProcedure` is a guard; it is not an authentication strength
    /// ([`auth_strength`]).
    pub(crate) const CLASS_PRIVILEGE_WORDS: &[&str] = &["admin"];

    /// A word [`auth_class`] reads as authenticating ([`AUTHENTICATION_WORDS`] or
    /// [`CLASS_PRIVILEGE_WORDS`]).
    fn class_auth_word(w: &str) -> bool {
        AUTHENTICATION_WORDS.contains(&w) || CLASS_PRIVILEGE_WORDS.contains(&w)
    }

    /// Words that name who is calling without saying it is checked (`userProcedure`): with a
    /// weakening word they open up (`noUserProcedure`, `withUserIfAny`), alone they say
    /// nothing.
    const SUBJECT_WORDS: &[&str] = &["user", "users", "session", "sessions", "viewer", "member"];

    /// The [`AuthClass`] of a wrapper (canonical ref or name) by the words of its name:
    /// the binding's own name, before any member path (`lib/a.ts#authedProcedure.use()`
    /// -> `authedProcedure`). Public when a word opens it (`publicProcedure`,
    /// `unauthProcedure`, `allowGuests`), or when an authentication word comes with one that
    /// negates or weakens it (`noAuthProcedure`, `skipAuth`, `withAuthOrNull`); Authenticated
    /// only when an authentication word comes with neither. Mining uses it so that a wrapper
    /// built on another counts as it only while nothing says it opens up, so an ambiguous
    /// name never comes out Authenticated.
    pub fn auth_class(wrapper: &str) -> AuthClass {
        let name = wrapper.rsplit_once('#').map_or(wrapper, |(_, n)| n);
        let name = name.split(['.', '(']).next().unwrap_or(name);
        let words = strengthened(name_words(name));
        let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
        let auth = words.iter().any(|w| class_auth_word(w));
        // An authentication or subject word glued to a weakening one (`authwhenpresent`,
        // `noauth`, `authless`): a name written in one case.
        let subject = |w: &str| class_auth_word(w) || SUBJECT_WORDS.contains(&w);
        let glued = words.iter().any(|w| {
            (1..w.len()).any(|i| {
                w.is_char_boundary(i) && {
                    let (a, b) = w.split_at(i);
                    // A short suffix is part of another word (`author` is no `auth` + `or`).
                    (subject(a) && b.len() >= 3 && WEAKENING_WORDS.contains(&b))
                        || (WEAKENING_WORDS.contains(&a) && subject(b))
                }
            })
        });
        if has(PUBLIC_WORDS) || glued || ((auth || has(SUBJECT_WORDS)) && has(WEAKENING_WORDS)) {
            AuthClass::Public
        } else if auth {
            AuthClass::Authenticated
        } else {
            AuthClass::Unknown
        }
    }

    /// Words that, after `or`, make a name stricter, not weaker: `getUserOrThrow`,
    /// `assertMemberOrThrow`, `get_user_or_404`, `requireUserOrRedirect` turn the caller away
    /// when the check fails. Not `error`: a Result-style `userOrErrorProcedure` hands the
    /// error back and turns no one away, and [`auth_class`] also decides whether a wrapper
    /// built on another counts as it, so this list must never grant.
    const STRENGTHENING_WORDS: &[&str] = &[
        "throw", "throws", "raise", "raises", "fail", "fails", "reject", "deny", "redirect", "401",
        "403", "404",
    ];

    /// `words` without each `or` that a [`STRENGTHENING_WORDS`] word follows: such an `or`
    /// weakens nothing ([`auth_class`]).
    fn strengthened(words: Vec<String>) -> Vec<String> {
        let keep: Vec<bool> = (0..words.len())
            .map(|i| {
                words[i] != "or"
                    || !words
                        .get(i + 1)
                        .is_some_and(|n| STRENGTHENING_WORDS.contains(&n.as_str()))
            })
            .collect();
        words
            .into_iter()
            .zip(keep)
            .filter_map(|(w, k)| k.then_some(w))
            .collect()
    }

    /// Lower-case words of an identifier: `authedAdminProcedure` -> `authed`, `admin`,
    /// `procedure`; `with_auth` -> `with`, `auth`.
    fn name_words(name: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut cur = String::new();
        let mut prev_lower = false;
        for c in name.chars() {
            if !c.is_ascii_alphanumeric() {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                prev_lower = false;
                continue;
            }
            if c.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
            cur.push(c.to_ascii_lowercase());
        }
        if !cur.is_empty() {
            out.push(cur);
        }
        out
    }

    /// An in-repo wrapper the facts do not define is a guard by its name only when the name
    /// authenticates ([`AuthClass::Authenticated`]) through a word other than `session` or
    /// `private`: `withAuth`, `requireLogin`, not `withDbSession` or `privateRoute`
    /// ([`crate::security::authenticates`]).
    pub fn grants_by_name(w: &str) -> bool {
        let name = w.rsplit_once('#').map_or(w, |(_, n)| n);
        let name = name.split(['.', '(']).next().unwrap_or(name);
        auth_class(w) == AuthClass::Authenticated
            && name_words(name)
                .iter()
                .any(|x| class_auth_word(x) && !matches!(x.as_str(), "session" | "private"))
    }

    /// How strongly a guard's name says it restricts who may call what it wraps, from
    /// weakest to strongest. Drift prescribes no security rules; mining uses this only to
    /// never treat a guard of another strength as an alternative to a rule's wrappers, nor
    /// exempt anything from an authenticating one ([`crate::mine`]'s sibling wrappers and
    /// framework root files).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    pub enum AuthStrength {
        /// Named as open, only optionally authenticated, or with authentication negated or
        /// softened: `publicProcedure`, `maybeAuthenticatedProcedure`, `withoutAuth`,
        /// `authNotRequired`, `softAuth`, `withAuthOrNull`. Ambiguous names land here,
        /// never in [`AuthStrength::Authenticated`].
        Open,
        /// The name says nothing either way: `procedure`, `MetadataResolver`, `withWorkspace`.
        Unknown,
        /// Named as authenticating or authorising, with nothing that negates or softens it:
        /// `authenticatedProcedure`, `protectedProcedure`, `withSession`,
        /// `internalProcedure`. Privilege and scope words (`admin`, `org`) say who may use
        /// something, not that the wrapper authenticates ([`super::refuse::guard_shaped`]
        /// reads them).
        Authenticated,
    }

    /// Words of a guard's name that open it to anyone, make authentication optional,
    /// negate or soften it, wherever they stand in the name (`notAuthedProcedure`,
    /// `authNotRequired`, `login_not_required`, `auth_exempt`, `softAuth`, `tryAuth`,
    /// `withAuthOrNull`, `authIfPresent`). A name with one of them is never read as
    /// authenticating: what is ambiguous is open.
    const OPEN_WORDS: &[&str] = &[
        "public",
        "unauthenticated",
        "unauthed",
        "unauthorized",
        "unauthorised",
        "unprotected",
        "unguarded",
        "anonymous",
        "anon",
        "guest",
        "guests",
        "maybe",
        "optional",
        "optionally",
        "noauth",
        "open",
        "insecure",
        "not",
        "non",
        "no",
        "without",
        "skip",
        "skips",
        "bypass",
        "except",
        "exempt",
        "exempted",
        "ignore",
        "ignores",
        "ignored",
        "disable",
        "disabled",
        "unless",
        "soft",
        "lazy",
        "try",
        "if",
        "or",
        "null",
        "nullable",
    ];

    /// `allow` opens what it names (`allowAny`, `AllowAll`), not what it says it checks.
    const ALLOWED_TO_ANYONE: &[&str] = &["any", "all", "anyone", "everyone"];

    /// What [`auth_strength`] grants on beyond [`AUTHENTICATION_WORDS`]: other spellings
    /// of authentication, and guards and roles that say a caller is checked
    /// (`internalProcedure`, `UseGuards`, `withRole`). Not privileges (`admin`): those
    /// are no authentication strength.
    pub(crate) const STRENGTH_EXTRA_WORDS: &[&str] = &[
        "authn",
        "authz",
        "authentication",
        "authorization",
        "authorisation",
        "secured",
        "internal",
        "guard",
        "guarded",
        "guards",
        "role",
        "roles",
    ];

    /// A word [`auth_strength`] reads as authenticating ([`AUTHENTICATION_WORDS`] or
    /// [`STRENGTH_EXTRA_WORDS`]).
    fn strength_auth_word(w: &str) -> bool {
        AUTHENTICATION_WORDS.contains(&w) || STRENGTH_EXTRA_WORDS.contains(&w)
    }

    /// The [`AuthStrength`] a guard's name states (`apps/api/trpc.ts#protectedProcedure`,
    /// `pkg:x#withAuth`). An open word wins over an authentication word
    /// (`maybeAuthenticatedProcedure`, `allowUnauthenticated`), and so does an
    /// authentication word negated by the word before it (`withoutAuth`, `skipAuth`).
    pub fn auth_strength(guard: &str) -> AuthStrength {
        // Every segment of a chain counts: `authenticatedActionClient.inputSchema().action`.
        let words = guard_words(guard);
        let open = words.iter().any(|w| OPEN_WORDS.contains(&w.as_str()))
            || words
                .windows(2)
                .any(|p| p[0] == "allow" && ALLOWED_TO_ANYONE.contains(&p[1].as_str()));
        if open {
            AuthStrength::Open
        } else if words.iter().any(|w| strength_auth_word(w)) {
            AuthStrength::Authenticated
        } else {
            AuthStrength::Unknown
        }
    }

    pub(super) fn guard_words(guard: &str) -> Vec<String> {
        let name = guard.rsplit_once('#').map_or(guard, |(_, n)| n);
        crate::mine::words(name)
    }

    /// An error class named for turning a caller away: `UnauthorizedError`,
    /// `ForbiddenException`, `AuthenticationFailed`, `AuthorizationError`,
    /// `PermissionDenied`, `NotAuthenticated`, `AccessDeniedError`.
    pub fn rejection_class(canonical: &str) -> bool {
        // A built-in or standard-library error is about something else (`PermissionError`
        // is an operating-system file error).
        if canonical.starts_with("global#") || canonical.starts_with("pkg:python:") {
            return false;
        }
        let name = canonical.rsplit_once('#').map_or(canonical, |(_, n)| n);
        let name = name.trim_end_matches("(new)");
        let name = name.rsplit('.').next().unwrap_or(name);
        let words = name_words(name);
        let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
        has(REJECTION_WORDS)
            || (has(REJECTION_SUBJECT_WORDS) && has(REJECTION_OUTCOME_WORDS))
            || (has(&["not"]) && has(NOT_REJECTION_WORDS))
    }

    /// Words that name a rejection on their own ([`rejection_class`]): `UnauthorizedError`,
    /// `ForbiddenException`.
    pub(crate) const REJECTION_WORDS: &[&str] = &[
        "unauthorized",
        "unauthorised",
        "unauthenticated",
        "forbidden",
    ];

    /// What is rejected, with a [`REJECTION_OUTCOME_WORDS`] word ([`rejection_class`]):
    /// `AuthenticationFailed`, `PermissionDenied`, `AccessDeniedError`.
    pub(crate) const REJECTION_SUBJECT_WORDS: &[&str] = &[
        "auth",
        "authentication",
        "authorization",
        "authorisation",
        "permission",
        "access",
        "login",
    ];

    /// How it is rejected ([`REJECTION_SUBJECT_WORDS`]). Not access words: alone they
    /// grant nothing.
    const REJECTION_OUTCOME_WORDS: &[&str] =
        &["error", "exception", "failed", "denied", "required"];

    /// What `not` rejects ([`rejection_class`]): `NotAuthenticated`, `NotLoggedInError`.
    pub(crate) const NOT_REJECTION_WORDS: &[&str] =
        &["authenticated", "authorized", "authorised", "logged"];
}

#[cfg(test)]
mod tests {
    use super::grant::*;
    use super::refuse;
    use std::collections::BTreeSet;

    // The grant vocabulary, pinned: a word added to a grant classifier must be added here
    // too, where review sees it. Each is a word that, with no opening word beside it,
    // says a caller is turned away unless signed in or allowed.
    const PINNED_AUTHENTICATION: &[&str] = &[
        "auth",
        "authed",
        "authenticate",
        "authenticated",
        "authorize",
        "authorise",
        "authorized",
        "authorised",
        "protected",
        "private",
        "session",
        "signed",
        "logged",
        "login",
        "permission",
        "permissions",
        "secure",
    ];
    const PINNED_CLASS_PRIVILEGE: &[&str] = &["admin"];
    const PINNED_STRENGTH_EXTRA: &[&str] = &[
        "authn",
        "authz",
        "authentication",
        "authorization",
        "authorisation",
        "secured",
        "internal",
        "guard",
        "guarded",
        "guards",
        "role",
        "roles",
    ];
    const PINNED_REJECTION: &[&str] = &[
        "unauthorized",
        "unauthorised",
        "unauthenticated",
        "forbidden",
    ];
    const PINNED_REJECTION_SUBJECT: &[&str] = &[
        "auth",
        "authentication",
        "authorization",
        "authorisation",
        "permission",
        "access",
        "login",
    ];
    const PINNED_NOT_REJECTION: &[&str] = &["authenticated", "authorized", "authorised", "logged"];

    fn set(lists: &[&[&'static str]]) -> BTreeSet<&'static str> {
        lists.iter().flat_map(|l| l.iter().copied()).collect()
    }

    /// Every word a grant classifier may grant on.
    fn grant_words() -> BTreeSet<&'static str> {
        set(&[
            PINNED_AUTHENTICATION,
            PINNED_CLASS_PRIVILEGE,
            PINNED_STRENGTH_EXTRA,
            PINNED_REJECTION,
            PINNED_REJECTION_SUBJECT,
            PINNED_NOT_REJECTION,
        ])
    }

    /// Every word the refuse vocabulary takes, its refusals' additions included.
    fn refuse_words() -> BTreeSet<&'static str> {
        set(&[
            refuse::WORDS,
            refuse::PART_EXTRA_WORDS,
            refuse::WHO_MAY_PASS_WORDS,
            refuse::OPT_OUT_ACCESS_WORDS,
        ])
    }

    fn upper_first(w: &str) -> String {
        let mut c = w.chars();
        c.next()
            .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
            .unwrap_or_default()
    }

    /// Names a word may stand in, each with nothing else that grants or opens.
    fn names(w: &str) -> Vec<String> {
        let u = upper_first(w);
        vec![
            w.to_string(),
            format!("lib/a.ts#{w}"),
            format!("lib/a.ts#{w}Procedure"),
            format!("lib/a.ts#with{u}"),
            format!("lib/a.ts#require{u}"),
            format!("app/a.py#{w}_required"),
            format!("lib/a.ts#{w}Client.inputSchema().action"),
        ]
    }

    #[test]
    fn grant_words_are_pinned() {
        assert_eq!(AUTHENTICATION_WORDS, PINNED_AUTHENTICATION);
        assert_eq!(CLASS_PRIVILEGE_WORDS, PINNED_CLASS_PRIVILEGE);
        assert_eq!(STRENGTH_EXTRA_WORDS, PINNED_STRENGTH_EXTRA);
        assert_eq!(REJECTION_WORDS, PINNED_REJECTION);
        assert_eq!(REJECTION_SUBJECT_WORDS, PINNED_REJECTION_SUBJECT);
        assert_eq!(NOT_REJECTION_WORDS, PINNED_NOT_REJECTION);
    }

    // Grant is a strict subset of refuse: a name that may make a rule hold, or a wrapper
    // count as a guard, always refuses that rule's exemptions and narrowing.
    #[test]
    fn every_grant_word_is_a_refuse_word() {
        for w in grant_words() {
            for n in names(w) {
                assert!(refuse::names_access_control(&n), "{n}: grants, not refused");
                assert!(refuse::part_guard_shaped(&n), "{n}: grants, a shared part");
            }
        }
        let refuse_only: Vec<&str> = refuse::WORDS
            .iter()
            .copied()
            .filter(|w| !grant_words().contains(w))
            .collect();
        for w in [
            "member", "tenant", "owner", "can", "token", "scope", "staff",
        ] {
            assert!(refuse_only.contains(&w), "{w}");
        }
    }

    // Each refusal that reads a name alone takes every name the core refuse vocabulary
    // takes: its additions only ever add.
    #[test]
    fn every_refusal_reads_the_core_vocabulary() {
        for w in refuse::WORDS {
            for n in names(w) {
                assert!(refuse::names_access_control(&n), "{n}");
                assert!(refuse::part_guard_shaped(&n), "{n}");
                assert!(refuse::guard_shaped(&n), "{n}");
            }
        }
    }

    // The mutation guard: no refuse-only word makes a grant classifier grant, in
    // whatever name it stands. Adding one to a grant list (or a grant code path) fails
    // here until it is pinned above.
    #[test]
    fn refuse_only_words_never_grant() {
        let class = set(&[PINNED_AUTHENTICATION, PINNED_CLASS_PRIVILEGE]);
        let by_name: BTreeSet<&str> = class
            .iter()
            .copied()
            .filter(|w| !matches!(*w, "session" | "private"))
            .collect();
        let strength = set(&[PINNED_AUTHENTICATION, PINNED_STRENGTH_EXTRA]);
        let rejection = set(&[
            PINNED_REJECTION,
            PINNED_REJECTION_SUBJECT,
            PINNED_NOT_REJECTION,
        ]);
        for w in refuse_words() {
            let u = upper_first(w);
            for n in names(w) {
                if !class.contains(w) {
                    assert_ne!(auth_class(&n), AuthClass::Authenticated, "{n}");
                }
                if !by_name.contains(w) {
                    assert!(!grants_by_name(&n), "{n}");
                }
                if !strength.contains(w) {
                    assert_ne!(auth_strength(&n), AuthStrength::Authenticated, "{n}");
                }
            }
            if !rejection.contains(w) {
                for n in [
                    format!("lib/e.ts#{u}"),
                    format!("lib/e.ts#{u}Error"),
                    format!("lib/e.ts#{u}Exception"),
                    format!("lib/e.ts#{u}Denied"),
                    format!("lib/e.ts#{u}Failed"),
                    format!("lib/e.ts#Not{u}"),
                    format!("lib/e.ts#Not{u}Error"),
                ] {
                    assert!(!rejection_class(&n), "{n}");
                }
            }
        }
    }

    // The same end to end: a wrapper the facts do not define is a guard by its name
    // only through a grant word ([`crate::security::authenticates`]).
    #[test]
    fn definitionless_wrappers_are_guards_only_by_grant_words() {
        let repo = drift_core::RepoFacts::default();
        let units = crate::roles::units(&repo, &crate::roles::FileKinds::learn(&repo));
        let ctx = crate::context::RepoContext::new(&repo, &units);
        let grants: BTreeSet<&str> = set(&[PINNED_AUTHENTICATION, PINNED_CLASS_PRIVILEGE])
            .into_iter()
            .filter(|w| !matches!(*w, "session" | "private"))
            .collect();
        for w in refuse_words() {
            let n = format!("lib/a.ts#{w}Procedure");
            assert_eq!(
                crate::security::authenticates(&ctx, &n),
                grants.contains(w),
                "{n}"
            );
        }
    }

    /// Functions outside this module that read [`super::grant`], and why each may: the
    /// grant sites. Any other reads the refuse vocabulary.
    const GRANT_SITES: &[(&str, &str, &str)] = &[
        // A wrapper built on another counts as it unless a binding on the way opens up:
        // the opening words only veto that grant.
        ("mine.rs", "call_match", "veto a derived wrapper"),
        // A sibling joins a variant set at its targets' rank.
        ("mine.rs", "sibling_of", "rank siblings"),
        // A wrapper is a guard: by a definitionless name, by a thrown error class; an
        // opening name vetoes it.
        ("security.rs", "authenticating_root_read", "a guard by name"),
        // What `authenticating_root` asks of each definition, by a thrown error
        // class: asked again where a refusal is found and not proven.
        ("security.rs", "rejects", "a body that rejects"),
        // A callee whose name opens access is no in-body guard (#51, #62): the one
        // opening veto on a refusal. Its name still refuses through
        // `refuse::names_access_control` at every caller.
        (
            "security.rs",
            "callee_is_guard_read",
            "veto an opening callee",
        ),
        // Building an in-repo class is a guard only when its constructor throws a
        // rejection class: what its other methods throw says nothing about the call.
        (
            "security.rs",
            "builds_without_rejecting",
            "a constructor that rejects",
        ),
        // A method used where a guard goes is one when its own body throws a
        // rejection class: what the class's other methods throw says nothing of it.
        ("security.rs", "method_guard", "a method that rejects"),
    ];

    const GRANT_ITEMS: &[&str] = &[
        "auth_class",
        "auth_strength",
        "grants_by_name",
        "rejection_class",
        "AuthClass",
        "AuthStrength",
        "AUTHENTICATION_WORDS",
        "STRENGTH_EXTRA_WORDS",
        "CLASS_PRIVILEGE_WORDS",
    ];

    fn sources() -> Vec<(String, String)> {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut out: Vec<(String, String)> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|x| x == "rs"))
            .map(|p| {
                let name = p.file_name().unwrap().to_string_lossy().into_owned();
                (name, std::fs::read_to_string(&p).unwrap())
            })
            .collect();
        out.sort();
        out
    }

    /// The name of the `fn` a line is in: the nearest `fn` above it.
    fn enclosing_fn(lines: &[&str], at: usize) -> Option<String> {
        lines[..=at].iter().rev().find_map(|l| {
            let t = l.trim_start();
            let t = t
                .strip_prefix("pub(crate) ")
                .or_else(|| t.strip_prefix("pub(super) "))
                .or_else(|| t.strip_prefix("pub "))
                .unwrap_or(t);
            let rest = t.strip_prefix("fn ")?;
            Some(
                rest.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .next()?
                    .to_string(),
            )
        })
    }

    fn code(line: &str) -> Option<&str> {
        let t = line.trim_start();
        (!t.starts_with("//")).then(|| line.split(" //").next().unwrap_or(line))
    }

    /// An identifier `item` in `line` not reached through `grant::`.
    fn bare(line: &str, item: &str) -> bool {
        line.match_indices(item).any(|(i, _)| {
            let before = &line[..i];
            let after = &line[i + item.len()..];
            let ident = |c: char| c.is_alphanumeric() || c == '_';
            !before.ends_with("grant::")
                && !before.chars().next_back().is_some_and(ident)
                && !after.chars().next().is_some_and(ident)
        })
    }

    // Every grant-side read goes through `grant::` from a listed grant site, and the
    // word lists live here alone.
    #[test]
    fn grant_is_read_only_at_grant_sites() {
        let mut seen: BTreeSet<(&str, &str)> = BTreeSet::new();
        for (file, text) in sources() {
            if file == "vocab.rs" {
                continue;
            }
            let lines: Vec<&str> = text.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                let Some(line) = code(line) else {
                    continue;
                };
                let t = line.trim();
                assert!(
                    !(t.contains("const ") && t.contains("_WORDS")),
                    "{file}:{}: a word list outside vocab.rs: {t}",
                    i + 1
                );
                for item in GRANT_ITEMS {
                    assert!(
                        !bare(line, item),
                        "{file}:{}: `{item}` read without `grant::`: {t}",
                        i + 1
                    );
                }
                if !line.contains("grant::") {
                    continue;
                }
                let f = enclosing_fn(&lines, i).unwrap_or_default();
                let site = GRANT_SITES
                    .iter()
                    .find(|(sf, sfn, _)| *sf == file && *sfn == f)
                    .unwrap_or_else(|| {
                        panic!(
                            "{file}:{}: `grant::` read in `{f}`, not a grant site: {t}",
                            i + 1
                        )
                    });
                seen.insert((site.0, site.1));
            }
        }
        // No stale site: each listed one still reads the grant vocabulary.
        for (file, f, _) in GRANT_SITES {
            assert!(seen.contains(&(*file, *f)), "{file} {f}");
        }
    }

    #[test]
    fn wrapper_names_say_whether_they_authenticate() {
        for (w, want) in [
            ("server/p.ts#authedProcedure", AuthClass::Authenticated),
            ("server/p.ts#authedAdminProcedure", AuthClass::Authenticated),
            (
                "lib/a.ts#authenticatedActionClient.use()",
                AuthClass::Authenticated,
            ),
            ("lib/auth.ts#withAuth", AuthClass::Authenticated),
            ("server/p.ts#protectedProcedure", AuthClass::Authenticated),
            ("server/p.ts#publicProcedure", AuthClass::Public),
            ("server/p.ts#optionalAuthProcedure", AuthClass::Public),
            ("server/p.ts#public_route", AuthClass::Public),
            ("server/b.ts#bookingsProcedure", AuthClass::Unknown),
            ("lib/a.ts#actionClient", AuthClass::Unknown),
            // Words, not substrings: `author` is no `auth`, `opener` no `open`.
            ("lib/a.ts#authorProcedure", AuthClass::Unknown),
            ("lib/a.ts#openerClient", AuthClass::Unknown),
            ("lib/a.ts#teamProcedure", AuthClass::Unknown),
            // A subject word alone says nothing; `authenticate` is an auth word.
            ("lib/a.ts#userProcedure", AuthClass::Unknown),
            ("lib/a.ts#authenticateRequest", AuthClass::Authenticated),
            ("lib/a.ts#withAuthorize", AuthClass::Authenticated),
            // A weakening word without an authentication word says nothing.
            ("lib/a.ts#tryParse", AuthClass::Unknown),
        ] {
            assert_eq!(auth_class(w), want, "{w}");
        }
    }

    // The review of #51: negated and weakened authentication is never authenticated.
    #[test]
    fn negated_and_weakened_auth_names_are_public() {
        for w in [
            "nonAuthenticatedProcedure",
            "notAuthedProcedure",
            "noAuthProcedure",
            "authNotRequired",
            "authNotRequiredProcedure",
            "auth_exempt",
            "ignoreAuth",
            "disableAuth",
            "skipAuth",
            "skipAuthProcedure",
            "withoutAuth",
            "authExcept",
            "softAuth",
            "softAuthProcedure",
            "tryAuth",
            "withAuthOrNull",
            "authIfPresent",
            "maybeAuthenticatedProcedure",
            "maybeAuthedProcedure",
            "loggedOutProcedure",
            "signedOutAction",
            "noSessionProcedure",
            "unauthProcedure",
            "unAuthedProcedure",
            "allowGuests",
            "allowGuestsProcedure",
            "guestsProcedure",
            "unauthorizedProcedure",
            "login_not_required",
            "LOGIN_NOT_REQUIRED",
            // Re-review of #51.
            "authlessProcedure",
            "authOffProcedure",
            "authNoneProcedure",
            "authFreeProcedure",
            "lenientAuthProcedure",
            "looseAuth",
            "relaxedAuthProcedure",
            "noopAuth",
            "mockAuthProcedure",
            "fakeAuth",
            "insecureProcedure",
            "unsafeAuthProcedure",
            "everyoneProcedure",
            "anyoneProcedure",
            "perhapsAuthedProcedure",
            "authwhenpresent",
            "authifpossible",
            "authoff",
            "authWhenPresent",
            "noUserProcedure",
            "maybeUserProcedure",
            "withUserIfAny",
            "optionalSessionProcedure",
            "authenticateIfPossible",
            "authorizeIfPresent",
            "adminOrOwnerProcedure",
            "server/more.ts#notAuthedProcedure.use()",
        ] {
            assert_eq!(auth_class(w), AuthClass::Public, "{w}");
        }
    }

    #[test]
    fn guard_names_state_their_auth_strength() {
        use AuthStrength::*;
        for (guard, want) in [
            (
                "packages/trpc/server/trpc.ts#authenticatedProcedure",
                Authenticated,
            ),
            (
                "packages/trpc/server/trpc.ts#maybeAuthenticatedProcedure",
                Open,
            ),
            ("packages/trpc/server/trpc.ts#procedure", Unknown),
            ("packages/trpc/server/trpc.ts#adminProcedure", Unknown),
            (
                "apps/web/lib/action-client.ts#authenticatedActionClient.inputSchema().action",
                Authenticated,
            ),
            (
                "apps/web/lib/action-client.ts#actionClient.inputSchema().action",
                Unknown,
            ),
            ("apps/api/src/trpc/init.ts#publicProcedure", Open),
            ("apps/api/src/trpc/init.ts#internalProcedure", Authenticated),
            (
                "src/decorators/metadata-resolver.decorator.ts#MetadataResolver",
                Unknown,
            ),
            (
                "src/decorators/admin-resolver.decorator.ts#AdminResolver",
                Unknown,
            ),
            ("lib/auth.ts#withAuth", Authenticated),
            ("lib/auth.ts#withoutAuth", Open),
            ("lib/auth.ts#skipAuth", Open),
            ("lib/auth.ts#withSession", Authenticated),
            ("lib/auth.ts#withWorkspace", Unknown),
            ("lib/auth.ts#withOptionalSession", Open),
            ("pkg:@nestjs/common#UseGuards", Authenticated),
            ("src/auth.ts#AllowAnonymous", Open),
            ("src/auth.ts#Public", Open),
            ("src/posts.ts#withAuthor", Unknown),
            ("src/trpc.ts#nonAuthenticatedProcedure", Open),
            ("src/trpc.ts#notAuthedProcedure", Open),
            ("src/auth.ts#authNotRequired", Open),
            ("app/auth.py#login_not_required", Open),
            ("app/auth.py#auth_exempt", Open),
            ("src/auth.ts#ignoreAuth", Open),
            ("src/auth.ts#disableAuth", Open),
            ("src/auth.ts#authExcept", Open),
            ("src/auth.ts#softAuth", Open),
            ("src/auth.ts#tryAuth", Open),
            ("src/auth.ts#withAuthOrNull", Open),
            ("src/auth.ts#authIfPresent", Open),
            ("src/auth.ts#AllowAny", Open),
            ("src/auth.ts#guestsOnly", Open),
            ("src/auth.ts#authRequired", Authenticated),
            ("app/auth.py#login_required", Authenticated),
            (
                "apps/api/src/trpc/init.ts#protectedOrInternalProcedure",
                Open,
            ),
        ] {
            assert_eq!(auth_strength(guard), want, "{guard}");
        }
    }

    #[test]
    fn guard_shaped_names_say_who_may_pass() {
        for guard in [
            "src/trpc.ts#adminProcedure",
            "app/decorators.py#admin_required",
            "app/decorators.py#ajax_required",
            "src/trpc.ts#orgProcedure",
            "lib/auth/workspace.ts#withWorkspace",
            "lib/cron.ts#withCron",
            "src/components/RequireAuth.tsx#RequireAuth",
            "src/components/ProtectedRoute.tsx#ProtectedRoute",
            "pkg:@clerk/nextjs#SignedIn",
            "lib/auth.ts#auth",
            "src/trpc.ts#publicProcedure",
        ] {
            assert!(refuse::guard_shaped(guard), "{guard}");
        }
        for guard in [
            "src/trpc.ts#procedure",
            "src/decorators/metadata-resolver.decorator.ts#MetadataResolver",
            "src/decorators/core-resolver.decorator.ts#CoreResolver",
            "apps/docs/features/docs/GuidesMdx.utils.tsx#genGuideMeta",
            "apps/docs/layouts/guides/index.tsx#Layout",
        ] {
            assert!(!refuse::guard_shaped(guard), "{guard}");
        }
    }
}
