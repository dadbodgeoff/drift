# Roadmap: from the map to enforcement, and to a beta

Status, 2026-11-16: **sprint 1 is being written; nothing in it is built or measured yet.** This document is the working list for getting Drift to a beta. An independent pass checked it item by item against the audits (283 items; the 107 it found missing or wrong are now in). It is built from nine audits of the code and of Drift's output on seven real repositories (epic-stack, juice-shop, cal.com, NodeGoat, full-stack-fastapi-template, plane, pygoat), from the state of `main` and the open pull requests, and from the bars `PLAN.md` already set. Every number is measured unless it is marked as a target.

## 1. The short version

- **The map is strong; the path from the map to a rule is thin.** Drift reads 1,914 entry points and knows the guard state of 91% of them. It shows a person 13 conventions and an agent none.
- **Six sprints, plus one that runs beside the first.** Land what exists (0), turn the map into rules (1), build once and measure (2), earn block mode (3), read what is not seen (4), harden for strangers (5), run the beta (6).
- **A private beta in advise mode needs sprints 0, 1 and 2 and the install part of sprint 5.** Nothing else is on its critical path. Sprints 3 and 4 make the beta better; they do not gate it.
- **The one number nobody has measured decides it:** how often a new rule is wrong on new code. Sprint 2 measures it. A rule kind under 80% true reports ships quiet.
- **The owner's part:** merge three pull requests in order, do the one-time release setup, choose the package name, choose the first teams, and read the seven questions sprint 1 is assuming an answer to. Section 7 lists every decision and when it is needed.

## 2. Where Drift stands

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
| Enforceable today | 15 | 8 | 23 (about 15 that matter: 9 TypeScript by the audit's count, about 6 Python by mine) | Nothing |
| Mapped, not enforceable | 5 | 10 | 15 | The layers between the map and the check |
| Partly mapped | 11 | 12 | 23 | Layers and reading fixes |
| Not seen | 22 | 13 | 35 | New facts for most; at least eight are held back by a gate, not by a missing fact |

**The answer to "is the data there?"** For about two thirds of the rules, yes: the work is the layers. For most of the last third, no: Drift does not read those things yet.

How good are the readings a rule would rest on?

| Area | Checked against source | Right |
| --- | --- | --- |
| Sign-in and permissions | 14 units | 13 |
| Sign-in, permissions, validation, data access (TypeScript, second audit) | 17 units | 7 (6 wrong, 4 right but recorded as exceptions by mistake) |
| Validation, errors, logging, config, data access, tests | 14 units | 9 |
| Python sign-in and permission candidates | 58 recorded exceptions | 7 are real departures |

Sign-in is the strongest reading and still has known errors: the audits found about seven wrong sign-in readings between them, one of them in the unsafe direction (a guard credited on a Django view that ignores it). Sprint 1 fixes each one found. Validation, data access and tests are weaker and cannot carry a rule until their readings are fixed. All the fixes belong in the same sprint as the loosening.

### Why so little gets through

1. **Promotion counts only an exact match.** A route that does the accepted thing and more is "another way". cal.com's `ApiAuthGuard` rule is split over 17 variants; plane's sign-in candidate has 48 exceptions, most of which are other permission classes that also turn anonymous callers away (43 by one audit's count, 35 by another's).
2. **The miner refuses a rule that holds 100% of the time,** and a statistical bound makes the smallest group that can yield a proposal 19 members, not the 8 the code states. No study backs either gate. 148 pairs of layers import one way only; none can be proposed.
3. **The security baseline is never written.** The mechanism that makes `drift check` report new findings exists. Nothing in `init` or `setup` creates its file.
4. **Mined rules treat "cannot read" as a violation.** On cal.com, all 15 outliers of the `authedProcedure` rule are deliberately public procedures.
5. **Blocking needs git history,** and every shallow clone has none.
6. **Some readings are wrong**, mostly "no validation" where the code validates.
7. **A third of real rules are not read as a concern today:** registration, rules that live in a route prefix or a router mount, response envelopes. Role levels are a further gap the two large repositories both show; they are not among the 96.

### The state of the repository itself

| Thing | State |
| --- | --- |
| `main` | Five checks red: `packaging`, `study`, `studio`, `test-macos`, and the Cloudflare build. |
| Open work | Two draft pull requests stacked on `main` (the first-run summary; promote a practice), and the sprint 1 branch on top of them, not yet pushed. |
| Release | The release workflow and its guide exist. The one-time setup on npm and GitHub has not been done; no version has been published. Version is `0.1.0-dev`. |
| Dependency alerts | 79, all in Studio's test fixtures (sample `package.json` files). None is in code that ships. |
| Published accuracy | The README says the default tier was right on 7 of 15 out of sample, that the release gate (95% on held-out data) has not passed, and "expect few proposals". All three stay true until sprint 2 measures otherwise. |

## 3. The scoreboard

Every sprint is judged on the same numbers, measured on the seven repositories with the built binary.

| # | Number | Today | Bar |
| --- | --- | --- | --- |
| 1 | Real team rules enforceable (of 96) | 23, about 15 that matter | 60 or more (target) |
| 2 | Share of proposals a team would keep | about 11 of 45 TypeScript candidates, 8 of 32 Python | 70% (target; `PLAN.md` sets 50% as the first gate and 70% as the goal) |
| 3 | Share of reports on new code that are true, per rule kind, on replayed history | not measured | 80% to be shown by default; 90% to block (`PLAN.md`) |
| 4 | Recorded exceptions that are real departures | 7 of 58 (Python sign-in and permissions) | 80% or more (target) |
| 5 | Known holes of juice-shop, NodeGoat and pygoat that `drift check` would report as new | 0 | all the ones the inventory already finds |
| 6 | Units a check fails on although Drift could not read them | 15 on the sample (mined rules on cal.com); four code paths can do it | 0, on all four paths |
| 7 | First census on 100,000 lines | not measured on this build | under 60 seconds (`PLAN.md`) |
| 8 | Check after one edited file, 95th percentile | not measured; a whole-tree check takes about 2.4 seconds on juice-shop, and any accepted practice makes every hook run scan the whole tree | under 300 milliseconds (`PLAN.md`) |

Number 3 is the one no audit measured. Coverage was measured everywhere; how often a new rule is wrong on new code was measured nowhere. Sprint 2 exists to measure it.

Numbers 2 and 3 are first measured by labelling agents that did not write the code under test. That is a screen, not the proof: `PLAN.md` asks for ratings by people who are not the builder, and the beta (sprint 6) is where those come from.

## 4. Rules that hold in every sprint

- **Nothing is decided from a list of names.** Rules come from what the facts and the classifier say.
- **Unknown is never a violation.** What Drift could not read is counted and shown as "not checked".
- **Confidence is raised by reading more, never by assuming.**
- **Nothing new fails a check or reaches an agent without a person accepting it.** New enforcement starts in advise mode.
- **The miner and the study tables do not move without the owner.** The study pre-registered what the miner reads and proposes. New proposals come through a second channel, "from the map", labelled as such.
- **Held-out study data is never opened.**
- **Text Drift hands to an agent follows the threat model in `PLAN.md`:** structured, identifiers escaped and capped, string literals and comments never echoed, repository text labelled as untrusted. Every new line an agent can see is tested against the hostile-identifier corpus.
- **No telemetry.** Nothing in the beta sends anything from a user's machine.

How each sprint is run: parallel agents, one work stream and one checkout each, with files that do not overlap. All code is written before anything is built. Then one build, the full test suites, and the scoreboard on the seven repositories. Then a fix wave for whatever was not right.

## 5. The sprints

### Sprint 0. Land what exists (runs beside sprint 1)

**Goal.** `main` is green and holds everything already written, so sprint 1 lands on a clean base.

| Item | State | What it takes |
| --- | --- | --- |
| First-run summary pull request | Draft; its lint check is red on one line (a type the linter calls too complex, `practices/render.rs:737`) | A type alias. Then the owner's review and merge. |
| Promote-a-practice pull request | Draft, stacked on the one above; its own checks pass | The owner's review and merge, second. |
| `packaging` on `main` | Fails at its first step: the check cannot read the repository address from `Cargo.toml` because the line above it contains a bracket (`npm/ci-check.mjs:107`) | A one-line fix. Nothing after that step has ever run in CI, so expect a second failure behind it. |
| `studio` on `main` | Two end-to-end tests fail: the code drawer, and the practices view | Not diagnosed. |
| `test-macos` on `main` | One test fails (`ingest`: unsafe ignore files). The job runs only after a merge, so no pull request ever shows it | Diagnose; then decide whether the job should also run on pull requests. |
| `study` on `main` | Three test files about app selection fail | Not diagnosed. They fail the same way with and without recent work. |
| Cloudflare build | Fails on every commit | Not diagnosed; may be a project setting, not code. |
| Three older open pull requests (two dependency bumps, one docs fix) | Open | Merge or close. |
| 79 dependency alerts | All in Studio fixtures | Dismiss as test fixtures, or freeze the fixtures so alerts stop arriving. Say which in `SECURITY.md`. |

**Exit.** Every check on `main` is green or has been removed on purpose. The merge order is: first-run summary, promote a practice, then the sprint 1 branch.

**Needs from the owner.** The merges. Nothing merges without you.

### Sprint 1. From the map to rules (in progress)

**Goal.** Everything the map already knows can be proposed, promoted and checked in advise mode, and the readings a rule rests on are right.

| Stream | What it changes | Evidence |
| --- | --- | --- |
| S1 Practice matching | A unit that does the accepted way and more follows it. A rule can accept a whole mechanism ("any permission class") or "any way that turns the caller away". Background jobs are not sign-in units. Ways that code follows by doing nothing ("errors left to the framework") are set apart. | Units covered by sign-in and permission rules: 645 to 1,432. Response units: 241 to 759. 28 exceptions in config, logging, errors, responses and data access that are artefacts of the matching disappear; the sign-in ones are on top of that. |
| S2 TypeScript readings | False "no validation" and "no refusal": a schema parse through a helper, a refusal through the framework's continuation, pipes on a parameter, an ORM client behind the repository's own package, end-to-end tests and status assertions. | epic: 12 of 30 "no validation" units validate. |
| S3 Python readings | A guard credited on a Django view that ignores it (the one error in the unsafe direction), typed parameters, return annotations, scoping through an alias, permission-class helpers, one unread call making a whole app unknown (narrowed only where the unread call cannot touch the route; otherwise unknown is the right answer and stays). | FastAPI response model wrong on 7 of 23 routes; 35 plane routes unknown. |
| S4 Unscoped keys | "A signed-in caller can name any value of this tenant or owner key" becomes a fact that is exported and found. A guard that ties a URL parameter to the caller is recognised. | The finding fires 0 times today, with known holes of that kind in the sample; 102 plane units are unknown for want of the tie. |
| S5 Security enforcement | Inventory findings reach `drift check`: on a diff with no baseline, in advise; with a baseline that survives an upgrade. Unknown guards never fail. `init` offers the baseline. | 892 findings, 0 reported. |
| S6 Security reach | Handlers hidden behind a wrapper call, factory mounts, queries built in a helper; a sink is "fed" only by the value that reaches it. | juice-shop: 56 unlisted handlers; all 23 "caller-controlled fetch" reaches are false (the address is a setting), and 14 of them are marked as fed by the caller. |
| S7 Trust in mined rules | A mined rule answers holds, does not hold, or cannot tell. Stale mined rules say so. One place decides advise or block. | cal.com: 15 of 15 outliers are units the map calls unknown. |
| S8 Baseline integrity | A rename is not a new violation. `init` does not grant amnesty. File-level rules can be answered inline. Decisions survive a rule gaining an alternative. | Renames and re-running `init` both tested as failures by the audit. |
| S9 TypeScript facts | Bodies of object-literal and constructor-function handlers; `catch (e) { next(e) }`; a refusal recognised by the error class's status, not its name. | NodeGoat: 11 units classified by usage only. |
| S11 Rules from the structure map | Clean one-way layering proposed from the map, counting only files that import something. | 148 one-way pairs, 0 proposable; cal.com `features` never imports `web`, 0 of 779 files. |
| S12 Funnel visibility | `drift census --why`: which gate dropped which candidate, with the numbers. | 78,631 candidates to 13 with no way to see why. |

Second wave, after S1 lands:

| Stream | What it changes |
| --- | --- |
| S10 Proposals at `init` and `review` | Practices that qualify, and layering from the map, are written as proposals a person accepts or declines, in one flow with mined proposals. A departure line carries its promote command. Passive candidates are listed apart, never proposed. `promote` gains the mechanism and enforcing forms. The code for probation (sprint 3) is written here and left off. |
| S13 Places other than directories | A place can be one file or a literal route prefix (`workspaces/<slug>/projects/<id>/`), counted with the same thresholds. |
| S14 Documentation, Studio, study tables | Wiki, command reference, the Studio contract and views, the tables that list rule kinds. |

A cross-check of this roadmap against the nine audits found items that belong to sprint 1 and were not named above. Each is checked against its stream's report when the stream finishes; whatever was not built becomes one more stream, **S15 Leftovers**, written before the build.

| Belongs with | Item | Evidence |
| --- | --- | --- |
| S1 | Matching "the accepted way and more" is right for concerns whose obligations add up (sign-in, permissions, validation). For config, logging and data access two audits disagree; sprint 2 measures both and the exact match stays unless the numbers say otherwise. A wrapper derived from an accepted one counts as it. | juice-shop `routes/`: "config and the raw environment" really breaks the rule. cal.com: 10 false exceptions from derived procedures. |
| S2 | Return values of one more router framework read as responses; a procedure that takes no input is not "nothing validates it"; a shared-secret check that redirects away is a refusal; an input handed to a library Drift does not know reads unknown, not "none". | epic: 62 of 71 response units unknown. |
| S3 | Checks after an `except` that raises are marked conditional; a class is read as a database client because of its own methods; a dependency that raises is labelled an error mapper; a base view's own exception handler is not reported; the admin site's routes read as "no sign-in"; the `request` of a class-based view's methods is not followed. | 43 checks wrong, FastAPI's standard guard among them; plane `urls` files, 22 units, one an offered candidate that is wrong; 17 units. |
| S4 | Follow the caller's value through constructor functions and object methods; let a tenant-named parameter reach the finding when everything on the path was read. | NodeGoat's data layer. |
| S5 | Guard gaps compare guards by name and so miss a guard that calls the accepted one; a gap turns "new" when other files change; a scope gap whose filter side was not read still counts; workflow findings point at the wrong line; a repository's own actions count as "another owner"; the pull request comment is skipped when the only finding is a new unguarded route; a name list alone must never be enough for a failing "no guard". | epic's one guard gap is false; 14 of 20 plane "unpinned action" findings are plane's own. |
| S6 | Snippet files that never run produce sinks; a redirect through the repository's own sanitiser is still a sink; a GET "reaches eval" because a class is read whole; compose override files are loaded as if deployed; path traversal in Python is not a sink yet. | juice-shop: 9 sinks and 18 unlisted rows from snippets. plane: 57 redirect sinks, 44 of 47 reaches. |
| S7 | Print members, holders and "not checked" for each mined rule; refuse a rule when a large share of its outliers are unknown; the Stop hook uses the same advise-or-block decision as CI. | |
| S8 | `conventions.yaml` is re-sorted on every merge, so diffs grow; the convention id is 24 bits and can collide at about a thousand ids. | |
| S9 | Facts that were cut short are read without checking the mark that says so; an explicit public marker is read as "opens", not as an exception. | cal.com: 17 public procedures read as unknown. |
| S10 | One card where a mined guard rule and a practice say the same thing; a departure never tells an agent to copy a route that handles nothing; promote a group, or a fold of more than two ways; `--list` ranks by how many departures a rule would settle; no promote command is printed that would be refused. | 39 of 93 errors departures point at a route that does not handle errors. |
| S11 | Package names from two ecosystems are joined by bare name, which makes false edges; `drift map` should show the graph layering rests on. | fastapi's backend "depends on" an npm package because of a Python import of the same name. |
| S12 | The census prints a constant as if it were a measured lift; the `--suggestions` help says the default tier is always listed in full, and a cap hides three such proposals. | cal.com: 3 default-tier layering proposals hidden. |
| S14 | Field documentation that says "Python only" where TypeScript records it too. | |

**Exit.** All code merged into one tree, the leftovers stream included. Not built.

### Sprint 2. Integrate and measure

**Goal.** One tree that builds and passes, and the scoreboard measured. This sprint produces evidence, not features, and it decides whether sprint 1 was right.

1. **Bring the base up to date.** Merge whatever landed on the first-run branch since the sprint started.
2. **Build once.** Format, lint, the full Rust suite, the Studio type check, lint, unit and end-to-end tests, the study tests, the packaging dry run. Bump the cache and lowering versions once; regenerate snapshots and review every change to one. Raise the conventions file's version whenever it holds one of the new rule forms: an older Drift ignores fields it does not know and would check a narrower rule without saying so, where it should stop with "written by a newer Drift".
3. **Fix wave.** Compile errors and failed tests go back to agents as a list; rebuild until clean.
4. **Prove the miner did not move.** `drift census` on the seven repositories is byte-identical to before the sprint, flag off.
5. **Measure coverage.** Re-run the audits' own counts: units covered by a promotable rule, exceptions per candidate, unlisted handlers, unscoped keys found, mined violations that became "not checked".
6. **Measure correctness.** This is the new work:
   - Get full history for the sample repositories (the clones are single-commit).
   - Replay each new rule kind over past changes and collect what it would have reported on new code.
   - Read and label every report for the small repositories, a sample of 30 per rule kind for plane and cal.com: true departure, public on purpose, or Drift misread.
   - Read every unit whose verdict changed from "breaks" to "follows" under the new matching, for a contrary second use.
   - Re-measure the study's own gate on false "no sign-in" readings (5% or less), since sprint 1 changes those readings.
   - For "new route with no guard" on a diff, use the security audit's own design: 50 replayed pull requests each from epic, cal.com and plane.
7. **Measure speed.** Scoreboard numbers 7 and 8, with and without an accepted practice, on the largest sample repository. Time the hooks against their budgets.
8. **Decide per rule kind.** Under 80% true reports: quiet by default, shown only on request. Record the number beside the rule kind in the code, with how it was measured.
9. **Re-score the 96 rules.**
10. **Write the numbers where users read them.** The README's accuracy section, `docs/ACCURACY.md` and the wiki's accuracy page gain a part for rules proposed from the map: what was measured, on what, by whom, and what was not. The mined numbers stay as they are.

**Exit.** Green build on the branch; a draft pull request; scoreboard numbers 1 to 8 written into this document; a list of rule kinds that ship quiet.

**Needs from the owner.** Nothing to start. A decision at the end on anything measured between 60% and 80%.

### Sprint 3. Earn block mode

**Goal.** A rule can fail a build for a reason a reviewer would accept, and the gates nobody measured are decided with evidence.

| Item | What | Evidence |
| --- | --- | --- |
| Probation in place of history | A promoted practice may block after it held across the next 15 new units `drift check` saw, where no git history exists to replay. Measured first: hold out the newest 15 units of each large candidate and count departures; the target is 5% or fewer. | 77 of 77 candidates refused on shallow clones. "Block needs a replay" was a deliberate gate; this replaces it and needs the owner's yes. |
| Defects in the miner's caps | The per-role cap counts hidden proposals; caps run before narrowing and merging; no re-check of the bound after narrowing; a cap of a quarter of the list on "avoid" rules hides default-tier layering proposals. | Listed by the study's own plan as known defects; cal.com loses 3 proposals. |
| Before a guard gap may block | Compare guards by what they prove, not by name; count only exceptions in files the change touched. | The audit's condition: not before this and a measurement. |
| Mined guard rules the show policy hides | The policy hides every TypeScript "calls" rule, which undoes the exception made for guards. | epic's sign-in rule never shows. |
| The two unbacked miner gates | With `census --why` output: propose rules that hold 100% (as advise), and decide on groups of 8 to 18 members. | The study's own tier work found the bound does not predict correctness. About 79 universal and 36 near-universal candidates held back (approximate: counted with a re-implementation that runs high on plane). |
| Layering from the miner | If sprint 2 measured map-proposed layering as accurate, fold it into the miner's family or give it its own admission. | 58 strong one-way pairs. |
| Python | Lift advise-only for declarative sign-in rules (permission classes, decorators, dependencies) if sprint 2's numbers hold. Not for validation or errors. | Sign-in by declarative guard read right everywhere it was checked except the Django view case S3 fixes; typed-parameter validation wrong 3 of 3. One rule for mined rules and practices: both may block, or neither. |
| Security kinds | Whether "new entry point with no guard" and "unscoped key" may block, at what measured precision, and with what thresholds in the baseline. | Guard-gap exceptions today: 8, none a real hole. |
| Hidden rule families | Families hidden on fewer than five labels count as "not measured", not "hidden". Regenerate the admission table from the same labelling run as the show table. | A family hidden on a single label hides plane's 35-of-36 rule. |
| Mining reads the full entry-point listing | A measured study round, so mined rules cover routes registered in functions and file routers. | 981 of the 1,933 entry points in the facts are outside mining (the security inventory lists 1,914 of them); the gain in proposals is small (+3), the gain is in check coverage. |
| What a reviewer sees | Evidence as it was when accepted, who accepted and when, where the holders are, the violation's example, how to dispute. | The audit's "what a reviewer needs before trusting a block" table. |

**Exit.** At least one rule kind from the practice map and one from the security inventory can block, each with a measured precision of 90% or more recorded; every gate on the path from pattern to failed build has a cited source or has been removed.

**Needs from the owner.** Most of this sprint is decisions: the two gates, Python, security kinds, the family tables, and whether to run a study round. Each comes with the sprint 2 numbers.

### Sprint 4. Read what is not seen

**Goal.** The rules Drift does not read, or reads only in part, taken in order of how many real rules each unlocks. The counts are the two ground-truth audits' own, and rows overlap: some rules need two rows, and some rows help rules counted as "partly mapped".

| Item | Real rules it unlocks | Size |
| --- | --- | --- |
| Rules that are not a concern yet: response envelopes, permission metadata decorators, inverse guards (`requireAnonymous`), how errors are raised, anti-bot checks on public forms | 10 (TypeScript) | Large; take the response envelope and permission decorators first |
| Registration and side effects: urls, routers, exports, activity jobs, soft-delete filters. Wiring proposals on by default in advise | 6 (Python), plus 21 wiring proposals already computed on 3 repositories | Large |
| More places, beyond the file and route prefix sprint 1 adds: a deployable with its own manifest and container, writes only. The same fix for package assignment in the map and the miner | Up to 6, some already unlocked by sprint 1 | Medium |
| Base-class rules, starting with in-repo bases that set the same guard attributes | 4 | Medium, plus a study decision |
| Role levels: "admin only" as a level, not as a key | Not counted; plane and cal.com both need it | Medium, plus a decision on keeping role names in the facts |
| Scoping in the queryset, which is not an entry point | 2 | Medium |
| Response shape per status | 2 | Medium |
| "New entry points here are tested" | The most valuable testing rule; juice-shop 110 of 121 | Medium, after the test readings are fixed |
| Attributes out of the variant key (envelope, log style, flags), so one way is not split into several | Fewer, larger variants | Small to medium; changes variant ids |
| A semantic data-layer fact in place of path names | Makes data-access rules promotable honestly | Medium |
| The remaining name lists: the refusal words at the fact layer, framework mandates, library groups | Compliance with "no name lists" | Medium |
| Declared rules as evidence: a lint config's import restrictions, an `AGENTS.md` | cal.com declares 17 import restrictions | Medium |
| Real rules no row above reaches: a parameter's type, "imports only these packages", an error class per layer, an import alias, the shape a factory exports; in Python a model family, list envelopes, password helpers, schema decorators | 9 | Each small to medium; decide one by one |
| "A package imports only what its manifest declares" | A new rule kind; plane has 0 undeclared imports in 1,727 | Medium, plus a decision |
| More name lists found by the audits: tenant and owner key names, validation and environment packages, server roots, return-value adapters | Compliance with "no name lists"; the unscoped-key finding rests on the first | Medium to large |
| Known holes the inventory does not find: sandboxed evaluation, slow regular expressions, template escaping switched off, unsafe template output, secret and debug settings in code | Scoreboard number 5 counts only what the inventory finds today; these are the rest | Each a new fact |
| Facts that are recorded and never used: test mocks, "logs the caught error" | Wire them into a rule or stop recording them | Small, plus a decision |

**Exit.** Scoreboard number 1 re-measured; each new reading measured for false "nothing found" before a rule may rest on it.

### Sprint 5. Harden for strangers

**Goal.** A team that has never seen Drift installs it, gets a first screen worth reading, and is not let down in the first week. The items marked **beta** are needed before the first outside team; the rest before an open beta.

| Area | Item | Why |
| --- | --- | --- |
| Install | **beta** One command installs a working binary | Nothing has been published. The packaging check has never run past its first step. |
| Install | **beta** The owner's one-time release setup: package name, trusted publishing on npm, the approval environment, tag protection, two-factor sign-in | `RELEASING.md` lists it; none of it can be done from code. |
| Install | **beta** A first prerelease (`v0.1.0-beta.1`), published under npm's `next` tag, with checksums and build provenance | The workflow supports it and has never run. |
| First run | **beta** Guided setup: `init`, the proposals, the security baseline and the agent hooks as one flow, each decision asked once | Today these are four commands a new user must know to run. |
| First run | **beta** A short security summary on the first screen | The inventory is 892 findings; a person needs the ten that matter. |
| Agents | **beta** What an agent gets on day one: after acceptance, the rules for the file it is about to write, the worst first | Today agents are shown 0 conventions. |
| Agents | **beta** Every new line an agent can see is run against the hostile-identifier corpus | The threat model: hook output becomes the agent's context. |
| Agents | The hook says when an edit reverses a one-way dependency; the hook reports a new unguarded route among guarded siblings; the message never offers an inline ignore where one cannot work; hooks handle subagents | Each found by an audit; none is on the beta's critical path. |
| Security | Rank the first-screen findings by reach and by whether input is validated; decide whether the GitHub Action runs the inventory by default; `drift setup` asks which compose file is the deployed one | One compose file nobody marked decides "public" for 889 plane routes. |
| Speed | **beta** An accepted practice must not make every hook scan the whole tree | Scoreboard number 8. Measured in sprint 2, fixed here if it misses. |
| Speed | A large repository; the Stop hook's 30-second budget; what an agent sees when caps truncate | Not measured. |
| Upgrades | **beta** Test both directions: an older Drift stops on a file with a new rule form, and a newer Drift keeps honouring a lock or baseline an older one wrote (the security baseline has no version mark today) | A beta team will have two versions in play within days. |
| Upgrades | A changelog, and the `drift upgrade` command `PLAN.md` promises | Neither exists. |
| Platforms | **beta** macOS tests green and run on pull requests | macOS is where most beta users will be, and its test job is red and unseen. |
| Platforms | Windows: the release builds a native binary that no test job runs. Either test it or leave it out of the beta | `PLAN.md` says Windows through WSL for v0. |
| Studio | The new proposal kinds, "not checked" counts, the funnel, the security baseline | Studio shows none of sprint 1 yet. |
| Docs | **beta** Getting started, the command reference and the accuracy page match the built binary; a page on what the beta is and is not | S14 writes the pages before the build; they are checked against real output here. |
| Repository | A code of conduct; `SECURITY.md` says how fixture alerts are treated | `PLAN.md` lists both for day one; the first is missing. |
| Measurement | A first-run metric harness: the scoreboard as a command, run on every change | So a regression in what a new user sees is caught before a user sees it. |

**Exit.** A person outside the project installs Drift on their own repository in one command and reaches an accepted rule without help.

**Needs from the owner.** The release setup and the package name. These are the longest waits in the whole roadmap that code cannot shorten, so they should start now.

### Sprint 6. Run the beta

**Goal.** Learn from real teams whether the proposals are worth keeping and the reports are true, and decide on a public launch with their numbers.

| Item | What |
| --- | --- |
| Who | Three to five teams the owner talks to, with a mix of TypeScript and Python, at least one monorepo. Advise mode only. |
| What they are asked | Install, accept or decline each proposal, leave the hooks on for a week, and mark each report true or wrong. |
| How the answers come back | A local file Drift writes when a person disputes or declines (`drift` already records decisions in the lock). The team shares it by hand. Nothing is sent by the tool, and no source code leaves their machine. |
| What is measured | Scoreboard numbers 2 and 3 from people who are not the builder; whether hooks are still on after seven days; time from install to first accepted rule. |
| What stops the beta | A report that blocks a build wrongly (nothing should block at all), a crash that stops an agent, or anything written outside `.drift/`. |
| What ends it well | Number 2 at 50% or more on at least 150 ratings, and number 3 at 80% or more for every kind shown by default (`PLAN.md`, the 3 December gate). |

**Exit.** The numbers above, published in the accuracy page with the method.

**Before a public launch, beyond this roadmap's sprints:** the agent benchmark `PLAN.md` names as the launch proof (20 to 30 tasks, four arms, blind grading), and the release gate on held-out data, which has not passed.

## 6. When is a beta possible

| Kind of beta | Needs | Condition |
| --- | --- | --- |
| Private, advise mode, a few teams the owner talks to | Sprints 0, 1 and 2, and the items marked **beta** in sprint 5 | Scoreboard number 6 is 0; number 3 is 80% or more for every kind shown by default; number 8 is met or the slow path is off |
| Open, advise mode | All of sprint 5; sprint 6 has ended well | |
| Anything that blocks a build by default | Sprint 3, and only for rule kinds measured at 90% or more | |
| Public launch | The agent benchmark and the held-out release gate | Outside this roadmap |

**Against the dates in `PLAN.md`.** The plan has version 0 complete on 25 November, a public launch on 1 December, and a precision gate on 3 December. As of 16 November: the private beta above is a reasonable aim for the 1 December date; a public launch on that date is not, because its two proofs (the benchmark and the held-out gate) are not started and not passed. My recommendation is to treat 1 December as the start of the private beta and to move the public launch behind sprint 6. That is the owner's call.

## 7. Decisions for the owner, and when each is needed

Three groups. The first is things only the owner can do. The second matters most to read now: sprint 1 is being built on an assumed answer to each, and a "no" changes what ships. The third waits for numbers.

### Only the owner can do these

| Action | Needed by | What is known |
| --- | --- | --- |
| Merge the first-run summary, then promote a practice | Sprint 0 | Both are drafts; the first needs a one-line lint fix. |
| The package name on npm | Sprint 5, start now | `npm/config.json` says `@dadbodgeoff/drift`; `RELEASING.md` calls it a founder decision. |
| The one-time release setup | Sprint 5, start now | Five steps in `RELEASING.md`; only the owner's accounts can do them. |
| Is 1 December a private beta or a public launch? | Now | Section 6. |
| Who the first teams are | Sprint 6 | Three to five, advise mode. |
| Is Windows in the beta? | Sprint 5 | A binary is built; nothing tests it. |

### Sprint 1 assumes an answer to these

Everything here ships in advise mode and behind a person's acceptance, so a "no" costs a switch, not a rewrite. But each is the owner's to say.

| Question | Assumed | Why it is a real question |
| --- | --- | --- |
| May Drift propose rules from the map (practices, layering) while mining is frozen? | Yes, as a second channel, labelled, passing none of mining's gates | The study's pre-registration says promotion is deferred and makes a replay a precondition. Widening promotion may need a new pre-registration. |
| May a promoted practice name a whole mechanism, or "any way that enforces"? | Yes | It changes what a rule stores and what a reviewer is agreeing to. |
| May a mined rule's outlier be dropped from violations when the map calls the unit unknown? | Yes | It lowers the baseline the rule's precision was measured against. |
| May a place be one file or a route prefix? | Yes | It changes the `place` contract in `conventions.yaml`. |
| Write the security baseline at `init`, or offer it? | Offer | A written baseline makes `drift check` report new findings from day one. |
| Is a redirect, or a failed shared-secret check, a refusal? | Yes, where the code path leaves | Today only a 401 or a sign-in redirect counts. |
| Probation in place of a replay, with 15 units | Code written, switched off | Sprint 3 decides it with a measurement. |

### Decided later, with numbers

| Decision | Needed by | What the audits say |
| --- | --- | --- |
| May preview concerns (logging, config, data access) be promoted? Should data access wait for a semantic layer fact? | Sprint 2 | 42 of 77 candidates today; the study treats them as gating nothing; data-access layers are read from path names. |
| Is "leave errors to the framework" a rule? | Sprint 2 | 10 of 16 errors candidates; sprint 1 sets it apart instead of offering it. |
| Do existing promoted practices get the new matching? | Sprint 2 | It only removes violations. |
| Should `promote --list` offer folds, or leave them a deliberate flag? | Sprint 2 | Sprint 1 offers them. |
| Stop hook: the same advise-or-block decision as CI, or stricter for agents? | Sprint 2 | Today it reads the raw mode. |
| Rule kinds measured between 60% and 80% | End of sprint 2 | Quiet by default unless you say otherwise. |
| Is a rule that holds 100% a rule or documentation? | Sprint 3 | For layering it is the strongest evidence, not the weakest. Framework-mandated ones stay out either way. |
| Groups of 8 to 18 members | Sprint 3 | No study measured anything these gates dropped. |
| The cap on "avoid" rules: shared with other rules, or its own? | Sprint 3 | It hides three default-tier proposals on cal.com. |
| Advise until 95% on held-out data, and the 15-member floor for blocking | Sprint 3 | Pre-registered; revisit only with held-out results. |
| Python advise-only | Sprint 3 | Defensible to lift for declarative sign-in after the unsafe-direction fix; not for validation or errors. |
| May a security kind block, and with what baseline thresholds? | Sprint 3 | It blocks today when a baseline exists; precision not measured. |
| Is the unscoped-key finding a `drift check` rule at all, or a finding for agents and people only? | Sprint 3 | It is shaped like a defect, not like a convention. |
| A new public route in a signed-in place: an inline ignore with a reason, or learned from a structural fact? | Sprint 3 | The main false report the sign-in rules will make. |
| The 20% limit on unknown units in a place | Sprint 3 | From the design document only; it refuses 17 cal.com places and fastapi over six units no new route would share. |
| May anything that rests on the refusal word lists block? | Sprint 3 | Sprint 1 adds a fact that replaces most uses; the lists remain as a fallback. |
| Hidden families, the two tables from different labelling runs, and a re-run for the decorator family | Sprint 3 | A study decision. NestJS guard decorators are withheld today. |
| The lift of 3.0 for external calls; mined "avoid this sink" cards withheld by the show policy | Sprint 3 | Each rests on one early round. |
| A study round so mining reads the full listing | Sprint 3 | Small gain in proposals, larger gain in what mined rules check. |
| Keep role names in the facts, for levels | Sprint 4 | A privacy decision about what the facts store. |
| A lint config's import restriction: a proposal, or evidence for one? | Sprint 4 | cal.com's own config would have contradicted what the majority does. |
| Manifest consistency as a rule kind; base-class rules re-tested on in-repo bases | Sprint 4 | Each needs a study decision. |
| Recorded facts nothing uses: wire or drop | Sprint 4 | Test mocks, "logs the caught error". |
| Does the GitHub Action run the security inventory by default? | Sprint 5 | Its precision on pull requests is not measured. |
| Fixes that change the miner's input (unparsed files counted as holders, files that import nothing) | Any time | Each is a correctness fix that changes census output on some repositories. One mined rule on juice-shop reads 103 of 104 where the truth is 3 of 4. |

## 8. What stays as it is

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
- Drift is a guardrail and a ratchet in CI, not a security control, and says so.
- "Nothing found" is not a way: an absence is never enforced as the accepted practice.
- The 80% share before a place has a dominant way: every refusal the audits checked was right.
- Declared dependencies are never a layering signal; layering inside one package stays off; a lint rule that says the opposite vetoes a proposal.
- Framework-mandated facts (every Angular service is injectable) are never enforced.
- The security inventory's exclusions: rows it could not read, local and queue entry points, routes opened on purpose. An unlisted handler is never a violation.
- A guard list of documented call shapes is library behaviour, not a name list to remove.
- Wherever a reader stops short it says so (an unread mount, an empty matcher, a cut-off fact), and sprint 1's wider readers must keep that.
- Wiring rules never block.
- Unread files fail a check only under `--strict`; a change to the policy in a pull request gives the full report.

Two cautions the audits would keep are changed on purpose by this roadmap, and each needs the owner's yes before it ships: "block needs a replay" (sprint 3 offers probation instead; section 7) and wiring staying behind a flag (sprint 4 turns advise-mode wiring proposals on).

## 9. Risks

- **Sprint 1 is uncompiled code from many hands.** The first build will surface a batch of errors at once. The shared types were fixed up front to keep that batch small; sprint 2 budgets for it.
- **Coverage is not correctness.** A rule that covers twice the units and is wrong one time in three is worse than what exists. Sprint 2's labelling is the control, and it is the work most tempting to skip.
- **Loosening and reading fixes must land together.** A promoted rule turns every false "nothing found" into a false violation.
- **The study.** Anything that changes what the miner proposes voids its measured numbers for that build. The second channel keeps sprint 1 clear of that; sprint 3 does not avoid it and should not pretend to.
- **Trivial rules.** About two thirds of today's promotable candidates are true and worthless. If the proposals a team sees are mostly those, the product reads as noise however accurate it is.
- **The builder labels the builder's work.** Until sprint 6, every correctness number comes from agents, not from a team that owns the code. Publish them as such.
- **One owner.** Merges, release setup and about forty decisions wait on one person. Section 7 orders them so that none is asked for before its numbers exist, and the two that are slow for outside reasons (the package name and the release setup) are flagged to start now.
- **The dates.** `PLAN.md` puts a public launch two weeks out. Holding that date means launching without the two proofs the plan itself requires.

## 10. Not in this roadmap

These are in `PLAN.md` and belong to the owner's business track, not to the engineering sprints: the company entity and insurance, the audit service and its contracts, pricing and billing, the hosted report, licence files, the privacy policy and support terms. None of them gates a private beta in advise mode with teams the owner already talks to. The disclosure policy for anything Drift finds in a public repository does apply as soon as beta results are published, and should be written before sprint 6 ends.
