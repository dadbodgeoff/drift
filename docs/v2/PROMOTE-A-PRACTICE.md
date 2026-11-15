# Design: turn a practice into a convention in one step

Status: **proposal, nothing built**. It needs four decisions (section 7).

## 1. The problem

Drift knows two kinds of things about a repository:

- **Conventions**: rules it mined, that a person accepts and `drift check` then enforces on new code.
- **The practice map**: what the code does for sign-in, permissions, validation, errors and responses. Facts only. Nothing checks them.

The map is by far the richer of the two, and today a person cannot act on it. On the seven sample repositories:

| Repository | Conventions proposed | Kinds of entry point in the map | Places where one way holds 80% and some units differ |
| --- | --- | --- | --- |
| epic-stack | 0 | 1 | 4 |
| juice-shop | 1 | 1 | 4 |
| full-stack-fastapi-template | 0 | 1 | 1 |
| plane | 5 (all naming) | 2 | 13 |
| cal.com | 7 | 7 | 10 |
| NodeGoat | 0 | 1 | 0 |
| pygoat | 0 | 1 | 3 |

So a person reads "38 of 40 routes are wrapped in `withAuth`, 2 are not" and the only thing Drift can do with it is tell an agent as advice. They cannot say "yes, that is our rule, hold new code to it".

The groundwork for promotion exists and is unused: every variant has a `promotable` field, and it is null for every variant in all seven repositories, because no concern implements `Concern::promotable`.

## 2. What is proposed

One command, and the same step in `drift review` and the Studio:

```
drift practices promote <P-id> [--in <package or directory>] [--with <P-id>...] [--block]
```

It writes one accepted convention of a new rule kind, `practice`, and baselines today's exceptions in `drift.lock`. From then on `drift check` holds new code in that place to it.

```yaml
- id: D-4c1e07
  status: accepted
  mode: advise
  promoted_from_practice: P-0f0acb
  rule:
    type: practice
    concern: authn
    any_of: ["wrap:lib/auth.ts#withAuth"]   # variant keys, not names
  place: { package: "", dir: "app/api" }
```

What the command prints before it writes:

```
Sign-in in app/api: 38 of 40 entry points use wrap withAuth.
  2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).
  0 could not be read; those are never reported.
From now on `drift check` reports a new entry point here that signs a caller in another way, or not at all.
Mode: advise (it never fails a check). `drift review --block D-4c1e07` makes it fail one.
```

## 3. How the rule is checked

The rule is checked by the same classifier that draws the map, not by matching a name. For each unit of the concern in the place:

| The classifier says | Result |
| --- | --- |
| One of the ways in `any_of` | follows |
| Another known way, or nothing found in a body it read to the end | violation |
| Could not tell | **never a violation**; counted as "not checked: N" |

This is why a new rule kind is proposed and not the mapping to existing rules that `PLAN-R13.md` §4.5 sketched (`WrappedBy`, `Calls`, ...). Those rules match a wrapper or callee by name. They cannot express "either of these two guards", they cannot tell "nothing found" from "could not tell", and a helper that does the same thing under another name fails them. The classifier already handles all three, and it is what the hooks and `drift card` use, so a person sees one answer everywhere.

Three properties follow from using the classifier:

- **Alternatives are one rule.** Sign-in is often a policy with alternatives (plane: `IsAuthenticated` or `ProjectEntityPermission`, 599 of 828). `--with` adds a way; the map's folded policies promote as one rule with both.
- **Declared ways count.** A helper a person declared in `.drift/config.yaml` `practices:` is a known way, so it can be in `any_of`.
- **A stale rule says so.** If no unit in the place uses any way in `any_of` any more (the guard was renamed or replaced), `drift check` reports the convention as stale and fires on nothing. It never turns a rename into forty violations.

`drift check` already computes the practice map for the files it looks at (it prints departures today), so this adds no second analysis.

## 4. What may be promoted

Decided from counts, never from names:

- The place (a package, or a directory of it) has at least 8 units of the concern (`MIN_ROLE_SIZE`).
- The chosen ways hold at least 80% of the units Drift could read (`PLACE_SHARE`, the share the map already uses for "departs from").
- At most 20% of the place is "could not tell". Above that Drift refuses and points at `drift practices --hints`: it cannot check what it cannot read.
- `--force` lets a person promote below the 80%, in advise mode only. It is their codebase.

Existing gates are unchanged: Python conventions advise only; block mode needs 15 units (`MIN_BLOCK_ROLE_SIZE`); `// drift-ignore <id>: <reason>` works as for any convention; agents are told under the existing admission rules.

## 5. Where a person meets it

1. **`drift init`**, in `Worth a look first`: a finding in a place that qualifies ends with the command, e.g. `make it the rule for new code: drift practices promote P-0f0acb`.
2. **`drift practices`**: each variant that qualifies shows the same command. `--json` fills the existing `promotable` field (the rule type becomes `practice`).
3. **`drift review`** (interactive): after the proposals, the practices that qualify, one at a time: `y` advise, `b` block, `n` no (remembered, not asked again), `s` skip.
4. **Studio**, Practices view: a "Make this a convention" action on a variant, with the same preview. One new write operation.

Weak mined cards (kept back by the show policy) already have a promotion path, `drift review --hidden --answer <id>=same`. Step 3 puts both kinds in one flow, so "promote" means one thing to a person.

## 6. Build plan

| Phase | What | Notes |
| --- | --- | --- |
| 1 | `Rule::Practice`, its check, lock baseline, stale detection, `drift practices promote`, `promotable` filled, docs, tests | Advise mode only. `conventions.yaml` gains one rule type, which an older Drift cannot parse: the file's version goes up with the first promoted practice, so an older binary stops with "written by a newer Drift" and not with a parse error. A file with no promoted practice keeps its version. |
| 2 | The `drift review` step, the `drift init` and `drift practices` pointers, the Studio action | Contract change: `promotable.rule = "practice"`; one new Studio write op. |
| 3 | Block mode for promoted practices, behind a history replay | See decision 4. |

Each phase is measured on the seven repositories: how many places qualify, and for phase 3, how many times the rule would have fired on real past commits.

## 7. Decisions needed

1. **Rule kind.** A classifier-checked `practice` rule (recommended, section 3), or the name-matching mapping of `PLAN-R13.md` §4.5. The first is more work in `check`; the second is faster to build and wrong for alternatives and renamed helpers.
2. **Old code.** Baseline every existing exception at promotion, so only new units are reported (recommended; it is what every other convention does), or list them as violations to fix.
3. **Explicit "open" routes.** Some frameworks have a way to say "this route is public on purpose" (`AllowAny`, a `public` procedure). Recommended: the preview lists it as a way the person can include with `--with`, and never includes it silently.
4. **Blocking.** `PLAN-R13.md` decision 6 made a history replay a precondition of any promotion. Recommended: advise mode ships without it (it cannot fail a check), and block mode for a promoted practice requires the replay, shown as evidence ("of the last 14 entry points added here, 13 followed it"). The alternative is to hold all of phase 1 until the replay exists.

## 8. Risks

- **A wrong reading becomes a rule.** The classifier can be wrong about a unit. Mitigated by: unknown never fires, advise by default, the preview names the exceptions before anything is written, and stale detection.
- **Noise on public routes.** A health check added to a place where sign-in is the rule is reported. In advise mode that is one line; `drift-ignore` with a reason settles it, and decision 3 covers frameworks that mark it.
- **Two things called a convention.** Mined rules and promoted practices would sit in one file with one lifecycle. That is the point, but the wiki's "what is a convention" page needs rewriting, and `drift review --list` must say where each came from.
