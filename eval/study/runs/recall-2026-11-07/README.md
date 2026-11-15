# Recall audit of the 2026-11-06 precision PRs: cd8296b vs feefad6, 2026-11-07

**These are dev-set figures from synthetic edits, measured in-sample, and not held-out.** They test whether code that `check` and the Stop hook caught at the morning base still gets caught. They do not estimate recall against documented conventions (S3), and none of them is a headline result.

## Question

On 2026-11-06, about 28 PRs merged between `cd8296b` (the morning base) and `feefad6` (main). They added exemptions, narrowed roles and rules, and changed the tier, all aimed at precision. This run asks whether recall dropped: does a violation that `cd8296b` reported still get reported on `feefad6`, by `drift check` and by the Stop hook?

## Answer

| Set | Valid edits | Repos | `check` base → main | Stop blocks base → main | PostToolUse base → main |
| --- | --- | --- | --- | --- | --- |
| Default tier (TS call wrappers and layering) | 43 | 9 | **43 → 38** | 43 → 38 | 43 → 38 |
| Suggestions (TS and Python) | 20 | 11 | 20 → 20 | 6 → 0 (by design, D7) | 20 → 20 |
| Probes of new exemption and identity paths | 11 | 6 | 9 → 7 | 9 → 7 | 9 → 7 |

- **The 5 default-tier misses are real recall regressions.** Each is a violation that `cd8296b` caught and `feefad6` does not report at all.
- **None of them comes from a `check`-time exemption code.** On every edit where main still has a covering convention, it reported the violation, and no exemption code fired. Each miss is a mining change: the convention that covered the code is no longer proposed.
  - **formbricks, 2 edits.** Unwrapped server actions in `modules/**` outside `modules/ee`, and in `app/**`. Causes: #60 together with the existing depth dedupe, and #50's sibling join.
  - **nest, 3 edits.** Static imports of `platform-express`, `websockets` and `microservices` from `packages/core`. Cause: #49, together with the existing rule that layering candidates are seeded only from import signals some member already has.
- **The lost conventions were all WRONG under v3.** The v3 labels call all five base conventions behind these misses WRONG (`legit_outliers` / `false_outliers`). The precision fixes removed wrong *outliers*, and the convention went with them. The rule each one stated (authenticate server actions; `core` does not import the platform packages) is still the team's rule.
- **Stop no longer blocks suggestions.** For 6 suggestion edits, base blocked at Stop and main only advises. These are wrapped_by:extends (TS and Python), and Python call-wrapper and layering rules. That is decision D7 (#61), which moved them to the suggestion tier, and it is intended. `check` and PostToolUse still report all 6.
- **Two probes are blind spots in both binaries, not regressions.** A type-only import and a re-export (`export { x } from`) across a layer are reported by neither.

## Method

- **Binaries.** Release builds into the shared target, copied into scratch:
  - `cd8296b`: sha256 `42755c7c…a0ce3`;
  - `feefad6`: sha256 `24ed92b6…89542`.

  The first copy of the base binary turned out to be a main build, because another agent's build had overwritten `release/drift` in the shared target. It contained the D7 string `rule_kind_d7`, which `cd8296b`'s source lacks. Both binaries were then rebuilt with every `.rs` file touched, which forces a full recompile. Each forced rebuild reproduced the same sha256. The base binary lacks `rule_kind_d7` and the `no_input` message; the main binary has both. All measurements used the verified binaries.
- **Inputs.** Dev clones only: 9 TS repos for the default tier, plus 6 Python repos for suggestions. Each repo was hardlink-copied (`cp -al`, minus `.git`) into scratch, once per binary, with a private `DRIFT_CACHE_DIR`. Edits only ever created new files or `rename`d a fresh file over a path, never writing to a shared inode. After the run, `git status` in all 15 clones used was clean.
- **Setup, per binary.**
  1. `census --json --max 15`.
  2. `init --max 15`.
  3. `review --block <default tier> --accept <suggestions>`, using the binary's own tier: D5 at base, D7 at main.
  4. One `SessionStart` hook, kept as a template baseline.
- **Per edit, per binary.**
  1. Apply the edit.
  2. `check --format json`. The edit counts as caught if there is a new violation (not baselined, not unsure) in the edited file whose convention has the targeted rule kind.
  3. The Stop hook, from a copy of the template session state. It counts as caught if it returns `decision: block` naming that convention.
  4. `PostToolUse` on the edited file.
  5. Revert the edit.

  Edits are matched to a rule kind, not to an id, because some conventions changed id when their set changed: dub `D-50df58`→`D-345913`, cal.com `D-0b36fb`→`D-c54406`, midday `D-ef5012`→`D-50255f`, infisical `D-259bd1`→`D-c4efb8`.
- **Why synthetic edits.** `recall.mjs` scores recall against documented conventions. It needs `recall/docs` and `recall/matches`, and no run has them: only `recall/sources` exists, in `dev-2026-11-05` and `dev-py-2026-11-05`. Following the brief, this run uses synthetic violations instead.
- **Edits.** Hand-written, aimed at conventions both binaries propose, plus every base default-kind convention that main dropped. They come in several variants:
  - a new member file without the wrapper;
  - a handler or action appended to an existing member;
  - the wrapper removed in place;
  - a local pass-through wrapper;
  - a bare `procedure` swapped in;
  - a forbidden import, added to an existing member or in a new file.
- **Probes.** These target the paths the PRs added:
  - `no_input` (unauthenticated and authenticated clients);
  - derived bindings (#51 F1);
  - lazy `import()` (#49 F2);
  - subtree narrowing (#59 F10);
  - inline `onRequest` guards (#62);
  - type-only imports and re-exports.
- **Planted fixtures.** `cargo test -p drift-mine --test planted` passes on both commits: 7/7 on each, rebuilt from each worktree. These fixtures plant conventions on in-memory facts, so they do not exercise the repos above.
- **Invalid edits.** `s-crm-01` was not routed in `urls.py`, so it is no entry point; it was replaced by `s-crm-01b`. `s-nb-01` gets no rule reported by either binary, so it is no probe of its rule. Both are kept in `results.json`, marked `invalid`.

## Default tier: every edit

`base` = `cd8296b`, `main` = `feefad6`. Ids are the conventions `check` reported in the edited file for the targeted rule kind.

| Edit | Repo | Rule kind | File | base check | base Stop | main check | main Stop | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub-01 | dub | `wrapped_by:call` | `apps/web/app/api/recall-synth/route.ts` | yes D-d24d21 | yes | yes D-d24d21 | yes | both |
| dub-02 | dub | `wrapped_by:call` | `apps/web/app/api/activity-logs/route.ts` | yes D-d24d21 | yes | yes D-d24d21 | yes | both |
| dub-03 | dub | `wrapped_by:call` | `apps/web/app/api/workspaces/[idOrSlug]/recall-synth/route.ts` | yes D-015190,D-d24d21 | yes | yes D-015190,D-d24d21 | yes | both |
| dub-04 | dub | `wrapped_by:call` | `apps/web/app/(ee)/api/partner-profile/recall-synth/route.ts` | yes D-83351e | yes | yes D-83351e | yes | both |
| dub-05 | dub | `wrapped_by:call` | `apps/web/app/(ee)/api/partners/recall-synth/route.ts` | yes D-ebbc30 | yes | yes D-ebbc30 | yes | both |
| dub-06 | dub | `wrapped_by:call` | `apps/web/lib/actions/recall-synth-delete-link.ts` | yes D-50df58 | yes | yes D-345913 | yes | both |
| dub-07 | dub | `wrapped_by:call` | `apps/web/lib/actions/add-edit-integration.ts` | yes D-50df58 | yes | yes D-345913 | yes | both |
| dub-08 | dub | `wrapped_by:call` | `apps/web/app/api/recall-synth-passthrough/route.ts` | yes D-d24d21 | yes | yes D-d24d21 | yes | both |
| dub-09 | dub | `wrapped_by:call` | `apps/web/app/api/activity-logs/route.ts` | yes D-d24d21 | yes | yes D-d24d21 | yes | both |
| cal-01 | cal.com | `wrapped_by:call` | `packages/trpc/server/routers/loggedInViewer/_router.tsx` | yes D-0b36fb | yes | yes D-c54406 | yes | both |
| cal-02 | cal.com | `wrapped_by:call` | `packages/trpc/server/routers/features/_router.ts` | yes D-0b36fb | yes | yes D-c54406 | yes | both |
| cal-03 | cal.com | `avoids:import` | `packages/lib/CalEventParser.ts` | yes D-2f232d | yes | yes D-2f232d | yes | both |
| cal-04 | cal.com | `avoids:import` | `packages/lib/recallSynthProviders.ts` | yes D-2f232d | yes | yes D-2f232d | yes | both |
| cal-05 | cal.com | `avoids:import` | `packages/lib/CalEventParser.ts` | yes D-441d0e | yes | yes D-441d0e | yes | both |
| cal-06 | cal.com | `avoids:import` | `packages/emails/auth-email-service.ts` | yes D-31be39 | yes | yes D-31be39 | yes | both |
| cal-07 | cal.com | `avoids:import` | `packages/emails/recall-synth-flags.ts` | yes D-f26528 | yes | yes D-f26528 | yes | both |
| fb-01 | formbricks | `wrapped_by:call` | `apps/web/modules/ee/recall-synth/actions.ts` | yes D-60208a,D-73b648 | yes | yes D-73b648 | yes | both |
| fb-02 | formbricks | `wrapped_by:call` | `apps/web/modules/ee/ai-translation/lib/actions.ts` | yes D-60208a,D-73b648 | yes | yes D-73b648 | yes | both |
| **fb-03** | formbricks | `wrapped_by:call` | `apps/web/modules/analysis/recall-synth/actions.ts` | yes D-60208a | yes | **no** | **no** | **main miss** |
| **fb-04** | formbricks | `wrapped_by:call` | `apps/web/app/(app)/account/settings/authorized-apps/actions.ts` | yes D-5303d3 | yes | **no** | **no** | **main miss** |
| fb-05 | formbricks | `avoids:import` | `packages/surveys/src/lib/recall-synth.ts` | yes D-b8f1ee | yes | yes D-b8f1ee | yes | both |
| fb-06 | formbricks | `avoids:import` | `packages/surveys/src/lib/api-client.ts` | yes D-b8f1ee | yes | yes D-b8f1ee | yes | both |
| doc-01 | documenso | `wrapped_by:call` | `packages/trpc/server/team-router/recall-synth-deleteTeamUnsafeRoute.ts` | yes D-9b91c3 | yes | yes D-32c861,D-9b91c3 | yes | both |
| doc-02 | documenso | `wrapped_by:call` | `packages/trpc/server/organisation-router/recall-synth-deleteOrganisationUnsafeRoute.ts` | yes D-d51d70 | yes | yes D-32c861,D-d51d70 | yes | both |
| doc-03 | documenso | `wrapped_by:call` | `packages/trpc/server/envelope-router/recall-synth-deleteEnvelopeUnsafeRoute.ts` | yes D-55ae12 | yes | yes D-32c861,D-55ae12 | yes | both |
| doc-04 | documenso | `wrapped_by:call` | `packages/trpc/server/team-router/create-team-groups.ts` | yes D-9b91c3 | yes | yes D-32c861,D-9b91c3 | yes | both |
| doc-05 | documenso | `avoids:import` | `packages/lib/advanced-fields-validation/validate-dropdown.ts` | yes D-041293 | yes | yes D-041293 | yes | both |
| doc-06 | documenso | `avoids:import` | `packages/lib/advanced-fields-validation/validate-dropdown.ts` | yes D-7b5140 | yes | yes D-7b5140 | yes | both |
| doc-07 | documenso | `avoids:import` | `packages/lib/advanced-fields-validation/validate-dropdown.ts` | yes D-2a51e9 | yes | yes D-2a51e9 | yes | both |
| doc-08 | documenso | `avoids:import` | `packages/lib/advanced-fields-validation/validate-dropdown.ts` | yes D-c3b713 | yes | yes D-c3b713 | yes | both |
| md-01 | midday | `wrapped_by:call` | `apps/api/src/trpc/routers/tags.ts` | yes D-ef5012 | yes | yes D-50255f | yes | both |
| md-02 | midday | `avoids:import` | `packages/db/src/queries/activities.ts` | yes D-b8cff6 | yes | yes D-b8cff6 | yes | both |
| md-03 | midday | `avoids:import` | `packages/db/src/queries/recall-synth.ts` | yes D-b8cff6 | yes | yes D-b8cff6 | yes | both |
| ai-01 | ai | `wrapped_by:call` | `packages/codemod/src/codemods/v7/recall-synth-rename.ts` | yes D-fc5ef7 | yes | yes D-fc5ef7 | yes | both |
| **nest-01** | nest | `avoids:import` | `packages/core/router/router-explorer.ts` | yes D-44a46d | yes | **no** | **no** | **main miss** |
| **nest-02** | nest | `avoids:import` | `packages/core/router/router-explorer.ts` | yes D-48b32a | yes | **no** | **no** | **main miss** |
| **nest-03** | nest | `avoids:import` | `packages/core/router/router-explorer.ts` | yes D-f68b2a | yes | **no** | **no** | **main miss** |
| supa-01 | supabase | `wrapped_by:call` | `apps/docs/app/guides/recall-synth/[[...slug]]/page.tsx` | yes D-c2e88c | yes | yes D-c2e88c | yes | both |
| supa-02 | supabase | `wrapped_by:call` | `apps/docs/app/guides/ai-tools/[[...slug]]/page.tsx` | yes D-c2e88c | yes | yes D-c2e88c | yes | both |
| inf-01 | infisical | `wrapped_by:call` | `backend/src/server/routes/v2/certificate-authority-router.ts` | yes D-1e9bb3,D-259bd1 | yes | yes D-1e9bb3,D-c4efb8 | yes | both |
| inf-02 | infisical | `wrapped_by:call` | `backend/src/server/routes/v3/deprecated-certificates-router.ts` | yes D-259bd1,D-7731c9 | yes | yes D-7731c9,D-c4efb8 | yes | both |
| inf-03 | infisical | `wrapped_by:call` | `backend/src/ee/routes/v1/access-approval-policy-router.ts` | yes D-259bd1 | yes | yes D-c4efb8,D-f674a5 | yes | both |
| inf-04 | infisical | `wrapped_by:call` | `backend/src/server/routes/v1/admin-router.ts` | yes D-259bd1 | yes | yes D-c4efb8 | yes | both |

The variant of each edit, and the convention it targets, are in `results.json` (`variant` and `intent`).

## The misses: PR and code path

### fb-03: server actions in `modules/**` outside `modules/ee`

**PR #60, together with the existing depth dedupe.** This is a narrowing at mining time: the parent role's rule is dropped.

- **What base had.** Base mined `modules/**` actions as a variant set: `actionClient.action()` or `actionClient.inputSchema().action()` or `authenticatedActionClient.inputSchema().action()` (`D-60208a`, 119 members). v3 labelled it WRONG for `legit_outliers`, because the set allowed the unauthenticated client.
- **What #60 changed.** #60 keeps only guard alternatives in a set: `variant_set`, `crates/drift-mine/src/mine.rs:4671-4679`. The parent is left as the single wrapper `authenticatedActionClient.inputSchema().action`, at 107/119 (Wilson lower bound 0.832).
- **Why the parent is dropped.** Dedupe step 3 (`across_depths`, `mine.rs:4775-4810`; the drop is at `mine.rs:4798-4806`) compares it with the child `modules/ee` (56/58, bound 0.883). The child is 0.0507 higher, past `CHILD_MARGIN` = 0.05 (`mine.rs:35`), so the parent is dropped and only the child is kept.
- **What would have saved it.** The sibling join, which would widen the parent to `authenticatedActionClient.action`, runs only after dedupe (`mine.rs:2704`).
- **Consequence.** No convention covers the 61 server actions in `modules/**` outside `modules/ee`, among them `modules/survey`, `modules/analysis`, `modules/workspaces` and `modules/account`.
- **Checked.** With one more unwrapped action in `modules/ee` (edit `fb-01` applied), the child falls to bound 0.861, and the parent comes back as `D-cf72ae`: 109/120, authenticated clients only.

**Proposed fix (not implemented).** In `across_depths`, do not drop an ancestor whose members outside every kept descendant number `MIN_ROLE_SIZE` or more. Alternatively, never drop an ancestor whose rule is a guard (`security::authenticates` on a target): the duplicate reports in the child are harmless, and the uncovered siblings are not. Optionally, also run `join_siblings` before `dedupe`, so that the parent competes as the set it will become.

### fb-04: server actions in `app/**`

**PR #50, the F6 sibling join.** This is a narrowing at mining time: the rule is dropped as universal.

- **What base had.** Base proposed `app/**` actions wrapped in `authenticatedActionClient.inputSchema().action()` (`D-5303d3`, 29 members). Its outliers were authenticated `authenticatedActionClient.action()` members that take no input (v3: WRONG, `legit_outliers`).
- **What #50 changed.** On main, `join_siblings` (`mine.rs:2854-2931`, called at `mine.rs:2704`) adds `authenticatedActionClient.action` to the set. All 29 members then hold the rule, and `join_siblings` returns false at `mine.rs:2930` ("universal in the role, documentation rather than a check").
- **Consequence.** A new unwrapped action in `app/**` is reported by nothing.
- **Checked.** With the `fb-04` edit applied, main mines the set as `D-c3c4c5` (29/30).

**Proposed fix (not implemented).** "Universal, so documentation" is the wrong rule for a guard: a guard that every member follows is the most enforceable convention there is. In `join_siblings`, and likewise in the `k >= n` test of `consider` (`mine.rs:4578`), keep a call-wrapper rule whose target authenticates (`security::authenticates`), with zero outliers, instead of dropping it.

### nest-01..03: `packages/core` imports a platform package

**PR #49 (F2), together with the existing candidate seeding.** This is a narrowing at mining time: the rule is never generated.

- **What base had.** Base mined three layering rules for `packages/core`: no imports from `platform-express`, `websockets` or `microservices` (`D-44a46d`, `D-48b32a`, `D-f68b2a`). Their only outliers were lazy loads of declared optional peers (v3: all WRONG).
- **What #49 changed.** #49 drops those loads from the import signals, at `mine.rs:377`, which is right for precision.
- **Why the rule disappears.** `avoid_drafts` seeds candidates only from signals some member of the role has (`mine.rs:3633-3639`, `for (signal, h) in inside`). With no member left importing the target, the rule is never generated.
- **Consequence.** A static relative import of `../../platform-express/...` from `packages/core` is reported by nothing.
- **A second obstacle.** Even if the rule were seeded, `consider` drops a rule that every member holds (203/203, `mine.rs:4578`).

**Proposed fix (not implemented).** Seed layering candidates also from the areas a role reaches only through excepted loads, the lazy and optional ones that `mine.rs:377` filters. Let a layering rule with zero outliers through `consider`, when the dependency-direction test (`upward`) holds. A layer nobody breaks is the clearest layer.

### Default-tier coverage, base vs main

Across the 9 TS repos, these are the base default-kind conventions (call wrapper or layering) that main does not propose:

- formbricks `D-60208a` and `D-5303d3`;
- nest `D-44a46d`, `D-48b32a` and `D-f68b2a`.

That is exactly the conventions behind the misses. Every other base convention of these kinds is proposed on main, either with the same id or as a replacement set:

- dub `D-345913`;
- cal.com `D-c54406`;
- documenso `D-a0eee5`, plus the new `D-32c861`;
- midday `D-50255f`;
- infisical `D-c4efb8`, plus the new `D-f674a5`.

These replacements are guard-only sets (#60). They report violations on main that base accepted, for example `publicProcedure` and the unauthenticated `actionClient`.

## Suggestions

| Edit | Repo | Rule kind | base check / Stop | main check / Stop |
| --- | --- | --- | --- | --- |
| s-dub-01 | dub | `avoids:other` (throw bare Error) | yes / no | yes / no |
| s-dub-02 | dub | `named` | yes / no | yes / no |
| s-dub-03 | dub | `renders` | yes / no | yes / no |
| s-dub-04 | dub | `calls` | yes / no | yes / no |
| s-cal-01 | cal.com | `named` | yes / no | yes / no |
| s-cal-02 | cal.com | `wrapped_by:extends` | yes / **yes** | yes / no |
| s-doc-01 | documenso | `named` | yes / no | yes / no |
| s-doc-02 | documenso | `renders` | yes / no | yes / no |
| s-md-01 | midday | `avoids:other` (`any`) | yes / no | yes / no |
| s-md-02 | midday | `wrapped_by:extends` | yes / **yes** | yes / no |
| s-fb-01 | formbricks | `named` | yes / no | yes / no |
| s-nb-02 | netbox | `named` | yes / no | yes / no |
| s-nb-03 | netbox | `wrapped_by:extends` | yes / **yes** | yes / no |
| s-sal-01 | saleor | `named` | yes / no | yes / no |
| s-inv-01 | InvenTree | `named` | yes / no | yes / no |
| s-mis-01 | Misago | `named` | yes / no | yes / no |
| s-mis-02 | Misago | `wrapped_by:extends` | yes / **yes** | yes / no |
| s-crm-01b | Django-CRM | `wrapped_by:call` (Python) | yes / **yes** | yes / no |
| s-sl-01 | simplelogin | `avoids:import` (Python) | yes / **yes** | yes / no |
| s-sl-02 | simplelogin | `calls` | yes / no | yes / no |
| s-nb-01 | netbox | `wrapped_by:decorator` | no / no | no / no (invalid edit) |

**Every valid suggestion edit is still reported by `check` and advised by PostToolUse.** Under D5, base held the 6 bold kinds in the default tier and blocked them at Stop. Under D7 (#61), main reports them in advise mode, so Stop does not block. This is the intended tier change: Python advises only, and TS `extends`/`decorator`/`jsx` rules are suggestions. It is also a drop in what the Stop hook enforces, for every repo where those kinds were the only blocking rules. Of the 26 repos set up here, these had default-tier proposals at base and have none at main, so their Stop hook can no longer block: TS twenty (8 at base), novu (5), immich (3) and nest (4; see the misses above); Python netbox (4), tasking-manager (3), Misago (2), Django-CRM (2), InvenTree (1), paperless-ngx (1) and simplelogin (1).

## Probes

| Probe | Path tested | base | main | Reading |
| --- | --- | --- | --- | --- |
| p-dub-10 | `no_input`: authenticated `authActionClient.action()` that reads no input | reported | exempt (`no_input`) | by design: it is authenticated, and the chain lacks only the input step |
| p-dub-11 | unauthenticated `actionClient.action()` that reads no input and deletes rows | reported | reported | `no_input` does not cross root bindings, correct |
| p-dub-12 | a local client derived from the unauthenticated `actionClient` | reported | reported | correct |
| p-md-04 | a local binding derived from `publicProcedure` | reported | reported | correct |
| p-md-05 | a local binding derived from `protectedProcedure` (a control: it is guarded) | reported | not reported | main is right (#51 F1); base's report was a false positive |
| p-cal-08 | dynamic `import()` of `@calcom/features` from `packages/lib` | reported | reported | F2 exempts only declared optional or peer modules, correct |
| p-cal-09 | type-only import across the layer | not reported | not reported | blind spot in both (`!i.type_only`, `mine.rs:372`); arguably intended |
| p-cal-10 | `export { x } from` across the layer | not reported | not reported | **blind spot in both, not a regression**; cause not traced |
| p-supa-03 | docs page outside `app/guides` (#59 F10, #50 F9) | reported | reported | subtree narrowing did not apply, correct |
| p-ai-02 | codemod outside the version folders (#59 F10) | reported | reported | correct |
| p-inf-05 | route with a hand-rolled `onRequest` instead of `verifyAuth()` | reported | reported | correct |

## Files

- `results.json`: every edit, with its rule kind, files, variant, intent and group (`default`, `suggestion`, `probe`). For each binary it gives:
  - whether `check` reported it, with the convention ids, tiers and modes;
  - whether the Stop hook blocked, and whether PostToolUse advised;
  - any exemptions in the file, and any other new violations.

  It also gives the verdict, and, for the misses, the PR and code path.

**What is not committed.** The edit specifications, harness and work copies stay in the auditor's scratch folder. The specifications quote anchor lines from the dev clones' third-party source, so they are not committed.

## Not done

- **No product change.** The fixes above are proposals.
- **No recall against documented conventions (S3).** It needs extracted docs and matches, which no run has.
- **No held-out data.** Every repo here is a dev repo.
- **Planted fixtures.** Only the in-memory ones of `crates/drift-mine/tests/planted.rs` were run. They are unchanged in substance between the two commits: main adds fields to the struct literals.
