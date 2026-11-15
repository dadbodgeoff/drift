# Accuracy and Limits

This page says plainly how accurate Drift's answers are, what has been measured and how, what the figures do not show, which constructs and frameworks Drift does not read, and how to read each kind of answer accordingly. It is for anyone deciding how much to trust Drift, and for leads who must explain that trust to a team. The figures are those committed in the repository's [ACCURACY.md](https://github.com/dadbodgeoff/drift/blob/main/docs/ACCURACY.md) and README; this page adds none.

## In one paragraph

Drift's answers for exposure and error handling are in good shape. For authentication and authorization, `known` is proven: a check was read where it is and shown to run on every request. But on code Drift was not tuned on, a share of the `none` answers (and some `known` ones) are wrong: independent, unseen test suites found roughly one soundness check in seven to one in eleven (9% to 15%) wrong on first contact. So `none` and `internal` are to be treated as "nothing found in what Drift read": findings to check, not facts. Mined conventions are weaker: on repositories Drift was not tuned on, about half of the default-tier cards (7 of 15) and most of the TypeScript and JavaScript suggestions shown (6 of 7) were right, on small samples, which is why an agent is told only about conventions a person accepted and nothing blocks unless a person sets it to block. The release gate for letting a default tier block without a person's choice (at least 95% accepted on a held-out set) is not met.

> Source: the first run of each independent acceptance suite written after Drift began requiring proof for `none`, `known` and `internal` found 9%, 11%, 15% and 14.7% of its soundness checks wrong (22 of 237, 34 of 301, 52 of 342, 43 of 293), almost all of them false `none` or `internal`. These suites are not in the repository, so their cases stay unseen; the figures are recorded in the pull request that introduced the practice map's proof rules. `docs/ACCURACY.md` covers mined conventions only; the committed practice-map figures are the monorepo counts in "Practices and exposure" below.

## What is measured, and how

Drift has two kinds of output, and they are measured differently.

### Mined conventions

Every figure below is marked **in-sample** (measured on repositories the fixes were developed on) or **out-of-sample** (measured blind, on repositories nobody building the product had opened). Each card Drift shows is judged blind by two independent labelling agents under a written rubric, with a third deciding where they disagree. They judge whether a reviewer on the team would want an agent told this, and warned when it breaks it. **ACCEPT** is yes; **TRIVIAL** means a tool the repository already runs would catch the violation anyway; **WRONG** is everything else (a card nobody labelled counts as WRONG). **These are not real-maintainer decisions.** Drift has no measured accept rate from real maintainers yet; the opt-in local review log exists to collect that later.

| What | In-sample | Out-of-sample (blind and held-out) |
| --- | --- | --- |
| TypeScript/JavaScript **default tier** (call wrappers and layering): accepted | 100% (30/30), Wilson 88.6 to 100% | **46.7% (7/15)** pooled over three pools, Wilson 24.8 to 69.9% |
| TypeScript/JavaScript **suggestions** after the show policy: accepted | not reported separately | **85.7% (6/7)**, Wilson 48.7 to 97.4%, one blind pool of 4 repositories |
| TypeScript/JavaScript, **everything shown**: accepted | 93.5% (43/46) | **58.3% (7/12)**, Wilson 32.0 to 80.7% |
| TypeScript/JavaScript, **everything shown**: not wrong (accept or trivial) | 93.5% | **66.7% (8/12)**, Wilson 39.1 to 86.2% |
| **Python**, everything shown, round 10: accepted | 100% (12/12) | **50.0% (1/2)**, Wilson 9.5 to 90.5% |
| **Python**, everything shown, at the `F12` freeze: accepted | 83.3% (25/30) | **90.9% (10/11)**, Wilson 62.3 to 98.4%, one blind development pool of 30 repositories (not held-out) |
| **Yield**, TypeScript/JavaScript: accepted cards per repository | 2.69 | **0.58** (7 over 12 repositories; median 0; 8 repositories with none) |
| **Yield**, Python, at the `F12` freeze | 0.50 (25 over 50 repositories) | **0.33** (10 over 30 repositories; median 0; 20 with none) |
| **Unvetted cards shown to agents** | 0 | 0 |

The first study (the figures are in its reports) measured 60% and 76% (181 proposals) under rubric v1, so they are not comparable with those above ([first study](https://github.com/dadbodgeoff/drift/blob/main/docs/v2/STUDY-2026-11-05.md), [rerun](https://github.com/dadbodgeoff/drift/blob/main/eval/study/runs/dev-2026-11-05/README.md)).

The in-sample figures are optimistic: every precision fix since round 3 was developed and checked on those repositories, and the default tier was chosen from their labels. The default-tier figure in particular is about half right out of sample, and no build-set reading forecasts it to better than about 40 points either way. The cards that were wrong were mostly scope errors: the role also holds a recurring, different kind of member (a config file, a script, a plain helper) that the rule should not cover. They show up in the card's outliers, which is why `drift review` lists them and why you review default-tier cards first.

Full tables, sources and protocol: [ACCURACY.md](https://github.com/dadbodgeoff/drift/blob/main/docs/ACCURACY.md) and the study under `eval/study/` in the repository.

### Practices and exposure

The practice map and the security inventory are not rated by labelled cards. They are held to two kinds of check:

- **Acceptance suites in the repository.** Test matrices cover guard shapes, authorization flows and soundness for TypeScript and Python (for example `crates/drift-cli/tests/authn_guard_matrix.rs`, `authz_soundness.rs`, `py_authz_matrix.rs`, `practices_textbook.rs`), and the deployment readings have tests of their own.
- **Independent unseen suites**, run against code Drift was not tuned on. Their finding is the one given above: exposure and error handling are in good shape; for authentication and authorization, `known` is proven, but a share of `none` (and some `known`) answers are wrong on first contact, roughly one soundness check in seven to one in eleven (9% to 15%).

The committed example of what this looks like in practice, on a 3,200-file monorepo (README): authorization reads 19 known, 2 none and 116 unknown of 137 units, and 64 of the unknown carry a check that was found and is not proven. Authentication reads 150 known, 20 none and 8 unknown of 178 units. An earlier build read 74 of the authorization units known; that figure included answers that were not proven, and an independent review found about 14 of 31 sampled to be false. The 19 are what is proven, each read against the source: a count of proofs, not of how much of the repository checks authorization.

## What the figures do not show

- **No 95% figure and no held-out pass** of the default tier or of "not wrong".
- **No Python accuracy claim.** Mined Python proposals are on by default, as suggestions only, because a pre-registered blind check passed: 11 Python cards shown on 30 blind repositories, 10 accepted, 1 trivial, none wrong. That is one card above the check's minimum of 10, the wrapper family showed no card in it, and it is not a held-out result.
- **No real-maintainer accept rate.** All labels come from labelling agents under a written rubric.
- **No precision for the experimental agent verifier** (`agents.verify`, off by default): its frozen prompt scored 84.3% (43/51) on development cards it was not tuned on, below the 90% bar set for it, so it gates nothing.
- **No recall figure** for mined conventions.
- **No forecast for the next blind pool.**

## What to expect

On a TypeScript or JavaScript repository Drift has not seen: about 1 card shown per repository and about 0.6 accepted, and most repositories get nothing (the median was 0 accepted, and 8 of 12 repositories had none). On Python: about 0.4 shown and 0.3 accepted per repository (20 of 30 repositories had none). A convention needs a role of roughly 20 or more similar symbols where one pattern dominates, so small or uniform repositories often get none. The practice map and the security inventory do not depend on this: they work on any repository with entry points Drift lists.

## Known limits

- **Languages.** TypeScript, JavaScript and Python only. Other languages are not read. See [Languages and Frameworks](Languages-and-Frameworks).
- **Frameworks not listed.** Entry points are listed for the frameworks Drift has adapters for (for TypeScript and JavaScript: Next.js, Express, Hono, Fastify, NestJS, tRPC, Inngest, Trigger.dev, BullMQ; for Python: FastAPI, Flask, flask-restx, Django, DRF, Starlette and Celery). A route in a framework with no adapter is not listed, and `drift security` does not know it exists. Routes registered from a data structure handed to a helper in another file (`register(app, ROUTES)`) are not listed; routes registered in a loop or from a table in the same file are listed under an unknown prefix (`?`).
- **Constructs not read.** A dependency list built where Drift does not look, a service reached by name at runtime, a package's middleware that no list knows, a request handed to another service by `fetch`, a value of the caller held in a context variable or request-scoped provider, and similar, leave the answer `unknown` and say so.
- **Authorization is mostly `unknown`.** The caller's side of a comparison is partly taken from names (`self.principal.org_id`, `req.user.orgId`, a parameter called `session`): the proofs that would replace this are not built, and a TypeScript comparison with no side named for the caller is unknown. A TypeScript query filtered by the session's own value is unknown, because where a filter's value comes from is not recorded for TypeScript. A tenant check against a JWT claim (`row.org_id != get_jwt()["org_id"]`) is unknown, not known. A Flask blueprint built in a factory that takes its guard as a parameter is not yet read.
- **Deployment descriptions.** Kubernetes, Helm, Terraform (unless tied with `security.terraform`), CloudFormation, CDK, Pulumi and many platform configurations are recognised but not read, so while one is there nothing it may route to is called internal. HAProxy, Envoy and Traefik's file provider are not read. What is deployed from outside the repository, and CI scripts, are not seen.
- **Not a linter, type checker or security scanner.** Drift checks what your code already does. Its risky-operation detection is syntactic and narrow. Every security report ends with what it does not cover, and Drift is a guardrail, not a security control.
- **Mining is held at an earlier input.** Entry points Drift has learned to list since the last measured build (some Django, router-mount, consumer and route-table forms) are in `drift security` and the practice map and not yet read by `census`, `init` or `check`. They enter mining at the next measured round.
- **Small samples.** Every out-of-sample figure above is on 2 to 15 cards or 12 to 30 repositories.

## How to read an answer accordingly

| Answer | How much to trust it | What to do |
| --- | --- | --- |
| `known` (authentication, authorization) | proven: a check was read where it is and shown to run on every request | rely on it; the line names the check |
| `identified` | the caller is identified and no one is turned away | not a guard; look at what the route does with the caller |
| `declared in .drift/config.yaml, not proven` | a person's statement | re-read it when the code changes |
| `none` | nothing found in what Drift read, with what was not read listed (`N not read`); on unseen code a share are wrong | check the route's code, starting with what the row says was not read |
| `unknown` | Drift says what it did not read | read what the reason names; answer `drift setup`; declare what you verified |
| found, not proven | a check exists; Drift will not vouch for it | read the check |
| `internet-facing` | something in the repository provably carries requests to it | usually right; names its source |
| `internal` | read everything it could and found no way in; not assurance, since what is deployed from outside is not seen | check the deployment before relying on it |
| a default-tier convention | about half right out of sample | review its outliers; accept only what you would defend |
| a suggestion | advice only, and filtered | ignore what does not fit; it never blocks unless forced |
| exposure `unknown` | the repository does not say, or something unread may | add `security:` settings or answer setup |

`none` and `internal` are worded this way everywhere: "no guard found in what Drift read", "internal in what Drift read", each with what was read and what Drift saw and did not read (`not_read`). The meaning is the one given above; the wording makes it harder to read `none` as a fact. Authentication that identifies the caller and turns no one away is its own state, `identified`, counted apart from `known`. `drift investigate` lists every route Drift could not settle with the code to read (see [Using Drift with Agents](Using-Drift-with-Agents#investigating-open-routes)); nothing it records makes a `none` or `unknown` into `known` without a person's confirmation.

See also: [How Drift Works](How-Drift-Works), [Conventions and Review](Conventions-and-Review), [Practices Map](Practices-Map), [Security Inventory](Security-Inventory), [Languages and Frameworks](Languages-and-Frameworks), [FAQ](FAQ).
