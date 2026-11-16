# Roadmap: from the map to enforcement

Status: **sprint 1 is being written; nothing in it is built or measured yet.** Written 2026-11-16 from nine audits of the code and of Drift's output on seven real repositories (epic-stack, juice-shop, cal.com, NodeGoat, full-stack-fastapi-template, plane, pygoat). Every number below comes from those audits; targets are marked as targets.

## 1. Where Drift stands

Drift's maps are strong. What turns a map into something `drift check` enforces is thin.

| Measure, across the seven repositories | Number |
| --- | --- |
| Entry points read | 1,914 |
| Entry points whose guard state is known | 1,737 (91%) |
| Candidate rules the miner looks at | 78,631 |
| Conventions shown to a person | 13 |
| Conventions shown to agents | 0 |
| Findings in the security inventory | 892 |
| Security findings `drift check` reports | 0 |
| Practices that can block a build | 0 of 77 |

Two auditors wrote down the rules each team really follows, from the repositories' own source, before looking at Drift's output: 96 rules.

| What Drift does with the rule | TypeScript (53) | Python (43) | Total (96) | What it needs |
| --- | --- | --- | --- | --- |
| Enforceable today | 15 | 8 | 23 (about 15 that matter) | Nothing |
| Mapped, not enforceable | 5 | 10 | 15 | The layers between the map and the check |
| Partly mapped | 11 | 12 | 23 | Layers and reading fixes |
| Not seen | 22 | 13 | 35 | New facts |

**The answer to "is the data there?"** For about two thirds of the rules, yes: the work is the layers. For the last third, no: Drift does not read those things yet.

How good are the readings a rule would rest on?

| Area | Checked against source | Right |
| --- | --- | --- |
| Sign-in and permissions | 14 units | 13 |
| Validation, data access, tests (TypeScript) | 17 units | 7 (6 wrong, 4 right but recorded as exceptions by mistake) |
| Validation, errors, logging, config, data access, tests | 14 units | 9 |
| Python sign-in and permission candidates | 58 recorded exceptions | 7 are real departures |

So sign-in can be trusted now. Validation, data access and tests cannot until their readings are fixed, and the fixes belong in the same sprint as the loosening.

### Why so little gets through

1. **Promotion counts only an exact match.** A route that does the accepted thing and more is "another way". cal.com's `ApiAuthGuard` rule is split over 17 variants; plane's sign-in candidate has 48 exceptions, 43 of which are other permission classes that also turn anonymous callers away.
2. **The miner refuses a rule that holds 100% of the time,** and a statistical bound makes the smallest group that can yield a proposal 19 members, not the 8 the code states. No study backs either gate. 148 pairs of layers import one way only; none can be proposed.
3. **The security baseline is never written.** The mechanism that makes `drift check` report new findings exists. Nothing in `init` or `setup` creates its file.
4. **Mined rules treat "cannot read" as a violation.** On cal.com, all 15 outliers of the `authedProcedure` rule are deliberately public procedures.
5. **Blocking needs git history,** and every shallow clone has none.
6. **Some readings are wrong**, mostly "no validation" where the code validates.
7. **A third of real rules are not a concern Drift has:** registration, role levels, rules that live in a route prefix or a router mount.

## 2. The scoreboard

Every sprint is judged on the same numbers, measured on the seven repositories with the built binary.

| # | Number | Today | Target for a beta |
| --- | --- | --- | --- |
| 1 | Real team rules enforceable (of 96) | 23, about 15 that matter | 60 or more (target) |
| 2 | Share of proposals a team would keep | about 11 of 45 TypeScript candidates, 8 of 32 Python | 70% or more (target) |
| 3 | Share of reports on new code that are true, per rule kind, on replayed history | not measured | 80% or the kind stays quiet by default |
| 4 | Recorded exceptions that are real departures | 7 of 58 (Python sign-in and permissions) | 80% or more (target) |
| 5 | Known holes of juice-shop, NodeGoat and pygoat that `drift check` would report as new | 0 | all the ones the inventory already finds |
| 6 | Units a check fails on although Drift could not read them | above 0 (two code paths) | 0 |

Number 3 is the one no audit measured. Coverage was measured everywhere; how often a new rule is wrong on new code was measured nowhere. Sprint 2 exists to measure it.

## 3. Rules that hold in every sprint

- **Nothing is decided from a list of names.** Rules come from what the facts and the classifier say.
- **Unknown is never a violation.** What Drift could not read is counted and shown as "not checked".
- **Confidence is raised by reading more, never by assuming.**
- **Nothing new fails a check or reaches an agent without a person accepting it.** New enforcement starts in advise mode.
- **The miner and the study tables do not move without the owner.** The study pre-registered what the miner reads and proposes. New proposals come through a second channel, "from the map", labelled as such.
- **Held-out study data is never opened.**

How each sprint is run: parallel agents, one work stream and one checkout each, with files that do not overlap. All code is written before anything is built. Then one build, the full test suites, and the scoreboard on the seven repositories. Then a fix wave for whatever was not right.

## 4. The sprints

### Sprint 1. From the map to rules (in progress)

**Goal.** Everything the map already knows can be proposed, promoted and checked in advise mode, and the readings a rule rests on are right.

| Stream | What it changes | Evidence |
| --- | --- | --- |
| S1 Practice matching | A unit that does the accepted way and more follows it. A rule can accept a whole mechanism ("any permission class") or "any way that turns the caller away". Background jobs are not sign-in units. Ways that code follows by doing nothing ("errors left to the framework") are set apart. | Units covered by sign-in and permission rules: 645 to 1,432. Response units: 241 to 759. 28 exceptions that are artefacts of the matching disappear. |
| S2 TypeScript readings | False "no validation" and "no refusal": a schema parse through a helper, a refusal through the framework's continuation, pipes on a parameter, an ORM client behind the repository's own package, end-to-end tests and status assertions. | epic: 12 of 30 "no validation" units validate. |
| S3 Python readings | A guard credited on a Django view that ignores it (the one error in the unsafe direction), typed parameters, return annotations, scoping through an alias, permission-class helpers, one unread call making a whole app unknown. | FastAPI response model wrong on 7 of 23 routes; 35 plane routes unknown. |
| S4 Unscoped keys | "A signed-in caller can name any value of this tenant or owner key" becomes a fact that is exported and found. A guard that ties a URL parameter to the caller is recognised. | The finding fires 0 times today, with known holes of that kind in the sample; 102 plane units are unknown for want of the tie. |
| S5 Security enforcement | Inventory findings reach `drift check`: on a diff with no baseline, in advise; with a baseline that survives an upgrade. Unknown guards never fail. `init` offers the baseline. | 892 findings, 0 reported. |
| S6 Security reach | Handlers hidden behind a wrapper call, factory mounts, queries built in a helper; a sink is "fed" only by the value that reaches it. | juice-shop: 56 unlisted handlers; 14 of 23 "caller-controlled fetch" reaches are false. |
| S7 Trust in mined rules | A mined rule answers holds, does not hold, or cannot tell. Stale mined rules say so. One place decides advise or block. | cal.com: 15 of 15 outliers are units the map calls unknown. |
| S8 Baseline integrity | A rename is not a new violation. `init` does not grant amnesty. File-level rules can be answered inline. Decisions survive a rule gaining an alternative. | Renames and re-running `init` both tested as failures by the audit. |
| S9 TypeScript facts | Bodies of object-literal and constructor-function handlers; `catch (e) { next(e) }`; a refusal recognised by the error class's status, not its name. | NodeGoat: 11 units classified by usage only. |
| S11 Rules from the structure map | Clean one-way layering proposed from the map, counting only files that import something. | 148 one-way pairs, 0 proposable; cal.com `features` never imports `web`, 0 of 779 files. |
| S12 Funnel visibility | `drift census --why`: which gate dropped which candidate, with the numbers. | 78,631 candidates to 13 with no way to see why. |

Second wave, after S1 lands:

| Stream | What it changes |
| --- | --- |
| S10 Proposals at `init` and `review` | Practices that qualify, and layering from the map, are written as proposals a person accepts or declines, in one flow with mined proposals. A departure line carries its promote command. Passive candidates are listed apart, never proposed. `promote` gains the mechanism and enforcing forms. |
| S13 Places other than directories | A place can be one file or a literal route prefix (`workspaces/<slug>/projects/<id>/`), counted with the same thresholds. |
| S14 Documentation, Studio, study tables | Wiki, command reference, the Studio contract and views, the tables that list rule kinds. |

**Exit.** All code merged into one tree. Not built.

### Sprint 2. Integrate and measure

**Goal.** One tree that builds and passes, and the scoreboard measured. This sprint produces evidence, not features, and it decides whether sprint 1 was right.

1. **Build once.** Format, lint, the full Rust suite, the Studio type check, lint, unit and end-to-end tests, the study tests, the packaging dry run. Bump the cache and lowering versions once; regenerate snapshots and review every change to one.
2. **Fix wave.** Compile errors and failed tests go back to agents as a list; rebuild until clean.
3. **Prove the miner did not move.** `drift census` on the seven repositories is byte-identical to before the sprint, flag off.
4. **Measure coverage.** Re-run the audits' own counts: units covered by a promotable rule, exceptions per candidate, unlisted handlers, unscoped keys found, mined violations that became "not checked".
5. **Measure correctness.** This is the new work:
   - Get full history for the sample repositories (the clones are single-commit).
   - Replay each new rule kind over past changes and collect what it would have reported on new code.
   - Read and label every report for the small repositories, a sample of 30 per rule kind for plane and cal.com: true departure, public on purpose, or Drift misread.
   - Read every unit whose verdict changed from "breaks" to "follows" under the new matching, for a contrary second use.
6. **Decide per rule kind.** Under 80% true reports: quiet by default, shown only on request. Record the number beside the rule kind in the code, with how it was measured.
7. **Re-score the 96 rules.**

**Exit.** Green build on the branch; scoreboard numbers 1 to 6 written into this document; a list of rule kinds that ship quiet.

**Needs from the owner.** Nothing to start. A decision at the end on anything measured between 60% and 80%.

### Sprint 3. Earn block mode

**Goal.** A rule can fail a build for a reason a reviewer would accept, and the gates nobody measured are decided with evidence.

| Item | What | Evidence |
| --- | --- | --- |
| Probation in place of history | A promoted practice may block after it held across the next 15 new units `drift check` saw, where no git history exists to replay. | 77 of 77 candidates refused on shallow clones. |
| The two unbacked miner gates | With `census --why` output: propose rules that hold 100% (as advise), and decide on groups of 8 to 18 members. | The study's own tier work found the bound does not predict correctness. About 79 universal and 36 near-universal candidates held back. |
| Layering from the miner | If sprint 2 measured map-proposed layering as accurate, fold it into the miner's family or give it its own admission. | 58 strong one-way pairs. |
| Python | Lift advise-only for declarative sign-in rules (permission classes, decorators, dependencies) if sprint 2's numbers hold. Not for validation or errors. | Sign-in by declarative guard read right everywhere it was checked; typed-parameter validation wrong 3 of 3. |
| Security kinds | Whether "new entry point with no guard" and "unscoped key" may block, and at what measured precision. | Guard-gap exceptions today: 8, none a real hole. |
| Hidden rule families | Families hidden on fewer than five labels count as "not measured", not "hidden". Regenerate the admission table from the same labelling run as the show table. | A family hidden on a single label hides plane's 35-of-36 rule. |
| Mining reads the full entry-point listing | A measured study round, so mined rules cover routes registered in functions and file routers. | 981 of 1,933 entry points are outside mining; the gain in proposals is small (+3), the gain is in check coverage. |
| What a reviewer sees | Evidence as it was when accepted, who accepted and when, where the holders are, the violation's example, how to dispute. | The audit's "what a reviewer needs before trusting a block" table. |

**Exit.** At least one rule kind from the practice map and one from the security inventory can block, each with a measured precision recorded; every gate on the path from pattern to failed build has a cited source or has been removed.

**Needs from the owner.** Most of this sprint is decisions: the two gates, Python, security kinds, the family tables, and whether to run a study round. Each comes with the sprint 2 numbers.

### Sprint 4. Read what is not seen

**Goal.** The 35 rules Drift does not read, taken in order of how many real rules each unlocks.

| Item | Real rules it unlocks | Size |
| --- | --- | --- |
| Rules that are not a concern yet: response envelopes, permission metadata decorators, inverse guards (`requireAnonymous`), how errors are raised, anti-bot checks on public forms | 9 (TypeScript) | Large; take the response envelope and permission decorators first |
| Registration and side effects: urls, routers, exports, activity jobs, soft-delete filters. Wiring proposals on by default in advise | 6 (Python), plus 21 wiring proposals already computed on 3 repositories | Large |
| More places: the file that defines the handler, a deployable with its own manifest and container, writes only | 6 | Medium |
| Base-class rules, starting with in-repo bases that set the same guard attributes | 4 | Medium, plus a study decision |
| Role levels: "admin only" as a level, not as a key | Not counted; plane and cal.com both need it | Medium, plus a decision on keeping role names in the facts |
| Scoping in the queryset, which is not an entry point | 2 | Medium |
| Response shape per status | 2 | Medium |
| "New entry points here are tested" | The most valuable testing rule; juice-shop 110 of 121 | Medium, after the test readings are fixed |
| Attributes out of the variant key (envelope, log style, flags), so one way is not split into several | Fewer, larger variants | Small to medium; changes variant ids |
| A semantic data-layer fact in place of path names | Makes data-access rules promotable honestly | Medium |
| The remaining name lists: the refusal words at the fact layer, framework mandates, library groups | Compliance with "no name lists" | Medium |
| Declared rules as evidence: a lint config's import restrictions, an `AGENTS.md` | cal.com declares 17 import restrictions | Medium |

**Exit.** Scoreboard number 1 re-measured; each new reading measured for false "nothing found" before a rule may rest on it.

### Sprint 5. Adoption and beta hardening

**Goal.** A team that has never seen Drift installs it, gets a first screen worth reading, and is not let down in the first week.

| Item | Why |
| --- | --- |
| A real install path | The packaging check fails on `main` at its first step; nothing downstream of it has run in CI. |
| Green CI on `main` | Four checks fail there today. |
| Guided setup | `init`, the proposals, the security baseline and the agent hooks as one flow, with each decision asked once. |
| What an agent gets on day one | Today agents are shown 0 conventions. After acceptance: the rules for the file they are about to write, the worst first. |
| A short security summary on the first screen | The inventory is 892 findings; a person needs the ten that matter. |
| Studio | The new proposal kinds, "not checked" counts, the funnel, the security baseline. |
| Scale | `drift check` stayed at about 2.4 seconds from 0 to 200 rules on one repository. Not measured: a large repository, the Stop hook's 30-second budget, what an agent sees when caps truncate. |
| Upgrades | A conventions file with a new rule form stops an older binary. A lock or baseline written by an older Drift must keep working. Say so before it happens, and test it. |
| A first-run metric harness | The scoreboard as a command, run on every change, so a regression in what a new user sees is caught. |
| Feedback from the beta | A way for a team to say "this report was wrong" that reaches the measurement, without sending their code anywhere. |

**Exit.** A person outside the project installs Drift on their own repository in one command and reaches an accepted rule without help.

## 5. When is a beta possible

| Kind of beta | After | Condition |
| --- | --- | --- |
| Private, advise mode, a few teams you talk to | Sprint 2, plus the install path from sprint 5 | Scoreboard numbers 3 and 6 hold |
| Open, advise mode | Sprint 5 | |
| Anything that blocks a build by default | Sprint 3, and only for rule kinds with a measured precision | |

## 6. Decisions for the owner, and when each is needed

| Decision | Needed by | What the audits say |
| --- | --- | --- |
| Is a rule that holds 100% a rule or documentation? | Sprint 3 | For layering it is the strongest evidence, not the weakest. |
| Groups of 8 to 18 members | Sprint 3 | No study measured anything these gates dropped. |
| Python advise-only | Sprint 3 | Defensible to lift for declarative sign-in after the unsafe-direction fix; not for validation or errors. |
| May a security kind block outside the default tier? | Sprint 3 | It blocks today when a baseline exists; precision not measured. |
| Write the security baseline at `init`, or offer it? | Sprint 1 builds "offer" | A written baseline makes `drift check` report new findings from day one. |
| May preview concerns (logging, config, data access) be promoted? | Sprint 2 | 42 of 77 candidates today; the study treats them as gating nothing. |
| Is "leave errors to the framework" a rule? | Sprint 2 | 10 of 16 errors candidates; sprint 1 sets it apart instead of offering it. |
| Do existing promoted practices get the new matching? | Sprint 2 | It only removes violations. |
| Hidden families and the two tables from different labelling runs | Sprint 3 | A study decision. |
| A study round so mining reads the full listing | Sprint 3 | Small gain in proposals, larger gain in what mined rules check. |
| Keep role names in the facts, for levels | Sprint 4 | A privacy decision about what the facts store. |
| Fixes that change the miner's input (unparsed files counted as holders, files that import nothing) | Any time | Each is a correctness fix that changes census output on some repositories. |

## 7. What stays as it is

The audits also looked for places where Drift is right to be careful. These do not move:

- Unknown never fires, for practices; sprint 1 extends that to mined rules.
- The proof obligations before a permission check counts as proven.
- The unscoped-key claim is all or nothing: widen what it reads, never what it may skip.
- A way that opens a route on purpose is accepted only when a person names it.
- A guard is unknown unless proven; exposure decides no verdict.
- Nothing mined reaches agents or blocks without a person: out of sample, the strongest tier fell from 30 of 30 to 7 of 15.
- No blocking on decorator or base-class rules as mined: per-violation precision 37% and 27%.
- 15 units before anything blocks.
- Places with fewer than 8 units are refused.
- The agent cannot edit the policy, the lock or the baseline, and the Stop hook cannot loop.

## 8. Risks

- **Sprint 1 is uncompiled code from many hands.** The first build will surface a batch of errors at once. The shared types were fixed up front to keep that batch small; sprint 2 budgets for it.
- **Coverage is not correctness.** A rule that covers twice the units and is wrong one time in three is worse than what exists. Sprint 2's labelling is the control, and it is the work most tempting to skip.
- **Loosening and reading fixes must land together.** A promoted rule turns every false "nothing found" into a false violation.
- **The study.** Anything that changes what the miner proposes voids its measured numbers for that build. The second channel keeps sprint 1 clear of that; sprint 3 does not avoid it and should not pretend to.
- **Trivial rules.** About two thirds of today's promotable candidates are true and worthless. If the proposals a team sees are mostly those, the product reads as noise however accurate it is.
