# Scoreboard: before and after the map-to-enforcement sprint

- **Before** is `baseline/score.json`: the audit binary's outputs on the seven repositories.
- **After** is `after/score.json`: the binary built from the head of `map-to-enforcement`
  (commit 525d956a), collected with `collect` on 2026-11-16.

Both are scored by harness version 2. The before was re-scored from its saved data, and only
the numbers this harness computes differently changed (see `provenance` in the file). The raw
outputs (7.7 MB after) are not committed, the same as for the baseline.

```
python3 -I eval/scoreboard/scoreboard.py diff eval/scoreboard/baseline/score.json eval/scoreboard/after/score.json
```

The diff exits 1 because of two guard trips. Both are reviewed below: neither is a regression of
the permission reading.

The after binary is a debug build (optimisation level 1), and it ran while other builds used
the machine. All of its timings are therefore n/a (`score --no-timing`).

## The roadmap's eight numbers

| # | Number | Before | After | What it needs before it can be filled |
|---|---|---|---|---|
| 1 | Real team rules enforceable (of 96) | 23 (audits 8 and 9) | **n/a** | A person sets `state_after` (E/M/P/N) and `after_note` for each of the 96 rules in `truth/rules.json` against this build. None is set. |
| 2 | Share of proposals a team would keep (bar 70%) | TS 9 yes + 4 qualified of 45; Python 4 yes + 7 qualified of 32; census 6 yes, 2 probably, 4 plausibly, 1 wrong of 13 | **n/a** for candidates and the map. Census: the same 13, judged the same | Verdicts in `truth/proposals.json` for the 99 candidates whose key is new (TS 33 of 75, Python 66 of 95) and for the 39 proposals from the map (`from_map`, none labelled). The plain census text is byte-identical on all seven, so its 13 verdicts carry over. Over the labelled candidates only, the share reads TS 10 of 42 and Python 11 of 29. That is not the number, because it leaves out every new candidate. |
| 3 | True reports on new code, per rule kind | not measured | **not measured** | A history replay (`eval/replay`, never run) and a verdict per report. |
| 4 | Recorded exceptions that are real departures (Python sign-in and permissions) | 7 of 58 | **n/a**: 7 real and 43 not real are labelled; 89 of 139 distinct exceptions are unlabelled (157 rows) | A `real` verdict in `truth/exceptions.json` for each of the 89 new exceptions (plane alone has 152 rows, up from 54). |
| 5 | Known holes of juice-shop, NodeGoat and pygoat that `drift check` reports as new | not measured (proxy: 455 inventory findings) | **not measured** (proxy: 487) | A list of the holes, a copy of each repository, a diff that adds each hole, and `drift check` on each. `collect` does not run `check`. |
| 6 | Units a check fails on although Drift could not read them | 15 / 0 / 0 (mined outliers / promoted exceptions / guard-gap exceptions) | **15 / 0 / 0** | The fourth path (`security --diff-base`, `added_without_guard`) needs a diff. The 15 are still cal.com D-594d38: plain census did not change. |
| 7 | First census per 100,000 lines (bar 60 s) | 5.15 s (NodeGoat and pygoat only) | **n/a** | `collect` with a release build on a machine with nothing else running. |
| 8 | Check after one edited file, p95 (bar 300 ms) | not measured | **not measured** | Timed `drift check` runs after a one-file edit on a copy, with a release build. |

Only number 6 is a measured after value, and it did not move.

## What the build exposes now, compared with before

These are counts over all seven repositories (before > after).

- **Proposals from the map: 39** (cal.com 16, plane 10, fastapi 4, pygoat 4, epic 3, juice-shop 1,
  NodeGoat 1). By kind: 26 practice, 10 layering, 3 declared. One restates a mined rule (cal.com,
  D-594d38). The map lists 251 entries, and 212 of them are not proposed. Harness 1 printed 0 here;
  the cause is under "Harness fixes" below.
- **Promote candidates: 77 > 170.** Of these, 12 are listed apart as passive, 25 accept a whole
  mechanism, and 1 accepts any enforcing way. Sign-in and permission units under a candidate:
  645 > 2,253 (the S1 target was 1,432). Response units: 241 > 1,412 (the target was 759). Recorded
  exceptions: 340 > 600. `diff` marks the candidate numbers "not comparable (older build)", because
  the before list has no `passive` split.
- **Practice units read as a variant: 7,548 > 8,031 distinct.** Unknown: 1,280 > 1,290. None:
  1,705 > 1,674. Rows: 12,677 > 13,139, mostly from cal.com (+475).
- **Response (api) unknown: 257 > 158** (epic 62 > 3, juice-shop 75 > 35).
- **juice-shop `codefixes` snippets** are no longer listed as production code: unlisted rows
  56 > 5, codefixes sinks 8 > 0. They are listed apart instead, as 98 unreached files holding 8
  sinks.
- **Fed dynamic fetches: 22 > 8** (epic 7 > 1, juice-shop 9 > 1). The 9 false "fed" reaches to
  juice-shop's `lib/webhook.ts#notify` are gone.
- **Reaches: 169 > 237. Entry points reaching a sink with no guard: 62 > 83. `unguarded-reaching`
  findings: 69 > 109.** Most of the new ones are juice-shop handlers behind `utils.asyncHandler(...)`
  whose bodies are now followed. That turns up real holes: the SQL injection in
  `routes/search.ts:23`, the SSRF in `routes/profileImageUrlUpload.ts:24`, and the `eval` in
  `routes/userProfile.ts:65`. A new NodeGoat sink (`$where` in `app/data/allocations-dao.js:73-78`)
  is also a real hole. Its five reaches from the session routes are false (see R3 below).
- **Entry points:** guard known 1,737 > 1,742, guard unknown 172 > 167, read 1,914 (unchanged).
  `drift map` now also counts every listing (`entry.in_map_listed`): 1,933, against 952 in the
  measured listing.
- **Security findings: 892 > 929.** Workflow findings: cal.com 21 > 28. Guard-gap exceptions:
  8 > 7.
- **Unchanged:** plain census (byte-identical on all seven), its 13 conventions, the mining
  funnel (78,631 observed, 13 shown), and scoreboard 6.

## The numbers that moved the bad way, unit by unit

The units below were read in the repositories' code. Each verdict says whether the old reading
was a claim Drift could not support (the new unknown is honest) or whether the new reading lost
something true (a product regression).

### Guard: "unknown rose without a matching fall", juice-shop authz +7

All 7 units are new to the permission concern. Before, they had no authz row at all. Sign-in now
reads them as known, so they join the authz population, and authz reads each one as unknown. In
the sign-in concern, the "matching fall" did happen: 5 rows moved from none to known and 2 from
unknown to known. The guard counts per concern, so it cannot see that.

| unit (server.ts) | sign-in before > after | verdict |
|---|---|---|
| 655 `GET /rest/image-captcha` | none > known | True: `routes/imageCaptcha.ts:18-22` answers 401 to a caller with no user. Authz unknown is honest. |
| 658 `GET /rest/saveLoginIp` | none > known | True: `routes/saveLoginIp.ts:16,37-38` answers 401. Authz unknown is honest (it updates the caller's own row). |
| 659 `POST /rest/user/data-export` | unknown > known | True, because of `security.appendUserId()` (`lib/insecurity.ts:175-183`, 401 without a token). Drift credits `authenticatedUsers.from` in `verifyImageCaptcha`, which turns nobody away. Authz unknown (`where.UserId`, not proven to be the caller's) is honest. |
| 663 `GET /rest/order-history` | none > known | True: `routes/orderHistory.ts:13-21` refuses a caller with no user, through `next(new Error)`. Authz unknown is honest. |
| 707 `POST /profile` | none > known | True: `routes/updateUserProfile.ts:17-22`. Authz unknown is honest. |
| 636 `GET /rest/user/change-password` | none > known | The verdict is true (`routes/changePassword.ts:27-37` refuses with no token or user), but the evidence is wrong. Drift names `body_check:param:query.new`, the empty-password check that answers 401 (`changePassword.ts:19-21`), not the token check. See R1. |
| 436 `POST /api/Feedbacks #2` | unknown > **known** | **False.** `routes/captcha.ts:35-46` (`verifyCaptcha`) checks a CAPTCHA answer and answers 401 when it is wrong. That is not sign-in: the repository says at `server.ts:392` that POST is open "to provide feedback without being logged in". **Product regression R1.** |

So the guard trip is not a regression of the authz reading: unknown is the honest answer for all
7. One of the 7 entered the population on a false sign-in claim (R1).

### Guard: pygoat authz +2

The 2 units are `admin/` mounted on `admin.site.urls` (`pygoat/urls.py:23`,
`dockerized_labs/sensitive_data_exposure/sensitive_data_lab/urls.py:4`). Sign-in moved from
**none** to unknown. "None" was a claim Drift could not support: Django's admin site asks for a
signed-in staff user on every view. Unknown is now honest for both sign-in and permission, and the
authz rows are new to the population. Verdict: the old reading was unsupported.

### `units.testing.distinct_variant`, juice-shop 110 > 23 (87 units known > unknown)

Every one of the 87 was "tested, none of the required cases asserted" (`tested_none_asserted`).
juice-shop's tests do assert status codes, for example `test/api/payment.test.ts:26-27`
(`assert.equal(res.status, 401)`), `test/api/challenge.test.ts:51` and
`test/api/memory.test.ts:46`. The build now reads those assertions. The cases a unit must assert
come from its other concerns (`practices/testing.rs` `required`). Each of the 87 has at least one
of sign-in, permission, validation or response unknown: validation alone in 24, permission in 43,
sign-in in 18, and response with validation in 2. So whether all required cases are asserted cannot be told,
and the unit reads unknown [STRICT]. I read ten: dataErasure `GET /`, `GET /api/Cards`,
`GET /promotion`, `GET /rest/continue-code-fixIt`, `GET /rest/products/search`,
`GET /security.txt`, `POST /api/Challenges`, `POST /api/SecurityQuestions`, `POST /rest/memories`
and `PUT /api/Feedbacks/:id`.

Verdict: the old reading was unsupported, and unknown is honest. One true fact is now hidden
behind the unknown: these units are tested. That is a limit of the design, not a regression.

### `units.validation` unknown on epic, 27 > 46 (19 units none > unknown)

- **12 units call `parseWithZod` (`@conform-to/zod`) with a zod schema.** They are the
  forgot-password, login, both onboarding, reset-password, signup, theme-switch, change-email,
  password, password-create and two-factor verify actions, and the `$noteId` action. Each one
  validates, so "none" was false. Unknown is honest. Known would be better: the package is not
  taken for zod.
- **3 units hand the input itself to `invariantResponse`.** These are
  `admin/cache/lru.$cacheKey.ts:21` and `sqlite.$cacheKey.ts:21` (`invariantResponse(cacheKey, ...)`),
  and `resources/images.tsx:56` (`invariantResponse(src, ..., { status: 400 })`). These are
  presence checks, so "none" was false and unknown is honest.
- **4 units lost a true "none". Product regression R2.** They are
  `users/$username/index.tsx:18` (the check is at line 32), `users/$username/notes/$noteId.tsx:24`
  (line 43), `$noteId_.edit.tsx:10` (line 30) and `_layout.tsx:11` (line 23). Each passes a route
  parameter straight into a prisma query and validates nothing. What reaches `invariantResponse`
  is the query's result (`invariantResponse(user, 'User not found', { status: 404 })`), not the
  input.

### `sec.reach.via_webhook_notify`, juice-shop 23 > 42

All 42 reaches are real call paths: `solveIf` > `solve` (`lib/challengeUtils.ts:40`) >
`notify`, which calls `fetch(webhook)`. The 19 new ones come from handlers whose bodies are now
followed. I checked ten in `routes/` (`metrics`, `userProfile`, `search`, `currentUser`, `chat`,
`deluxe`, `basket`, `basketItems`, `changePassword`, `updateUserProfile`): each calls `solveIf` or
`solve`. The URL is `process.env.SOLUTIONS_WEBHOOK` (`lib/webhook.ts:9-13`), never the caller's,
and all 42 now read "not fed" (before, 9 were falsely fed). Verdict: the old fed claims were
unsupported, and the new count is true call paths to a fetch of a configured URL. Drift still
names that kind `dynamic_fetch`; that did not change and is not a regression.

### `sec.findings.unguarded-reaching`, 69 > 109 (40 new, 3 gone)

The 3 gone are on epic: `app/root.tsx` loader > `dynamic_key_write`, and the two sqlite cache
actions > `dynamic_fetch`. Ten of the new findings, read by hand:

- **True and newly exposed:** `GET /rest/products/search` > `sql_string_interpolation`
  (`routes/search.ts:23`), and pygoat `ssrf_lab/app.py:19-21` > `path_traversal`, the lab's
  deliberate hole.
- **A true path to a real hole, but "unguarded" rests on a sign-in "none" that is false.** This
  was the same before, so it is not a regression. It is newly visible because the reach is new.
  - `GET /profile` > `eval` (`routes/userProfile.ts:65`): the handler refuses a caller with no
    user at lines 34-36.
  - `POST /profile/image/url` > `dynamic_fetch`, fed (`routes/profileImageUrlUpload.ts:24`): the
    fetch runs only for a signed-in user (lines 22 and 43-44).
- **A true path that the caller does not control:** `GET /rest/captcha` > `eval`
  (`routes/captcha.ts:22` evaluates a server-made expression); `GET /snippets/fixes/:key` >
  `path_traversal` (`routes/vulnCodeFixes.ts:29-30` reads names from `readdir`); `GET /metrics` >
  `dynamic_fetch` (webhook, see above); plane `InstanceAdminSignOutEndpoint.post` >
  `dynamic_redirect` (`apps/api/plane/license/api/views/admin.py:442`, through
  `get_safe_redirect_url`).
- **False:** NodeGoat `GET /login`, `GET /logout`, `GET /signup`, `POST /login` and `POST /signup`
  > `nosql_injection`. **Product regression R3.**

## Product regressions confirmed (not fixed here)

- **R1. Sign-in is credited to any body check that answers 401, whatever it checks.**
  `crates/drift-mine/src/practices/authn.rs:1581-1619` adds `body_check:<what>` for any check
  whose outcome is `Unauthenticated`. juice-shop `POST /api/Feedbacks` (`server.ts:436`, handler
  `routes/captcha.ts:35-46`, a CAPTCHA answer) now reads as signed in. The repository says
  (`server.ts:392`) that it is open. The rule is older than this sprint (it is in the first commit). What changed is that the body
  is now read: it was `body_unreadable` before. The false known also puts the unit into the permission population.
  The same rule names the wrong evidence for `GET /rest/user/change-password`
  (`body_check:param:query.new`, `routes/changePassword.ts:19-21`).
- **R2. A call's result is taken for the request's input.** This sprint added the reading
  "input handed to a package call Drift does not read is unknown, never none":
  `crates/drift-ts/src/lower.rs:12215-12226` (`note_parse` records `input_handed:<callee>`) and
  `crates/drift-mine/src/practices/validation.rs:180-186` with `handed_unread` (lines 220-230),
  from commit 3851d7b6. It rests on an older taint: `lower.rs:12396` (`note_binding`,
  `let input = self.mentions_input(init, 0)`) treats a variable as input when its initialiser is a
  call any of whose arguments mention the input (`mentions_input`, lines 12108-12114). So
  `const user = await prisma.user.findFirst({ where: { username: params.username } })` is input,
  and `invariantResponse(user, 'User not found', { status: 404 })` is "input handed to a package
  call". The unit then reads unknown where "reads input, nothing validates it" was true. This
  affects 4 epic units: `app/routes/users/$username/index.tsx:18`, `notes/$noteId.tsx:24`,
  `notes/$noteId_.edit.tsx:10` and `notes/_layout.tsx:11`. Unknown is never a violation, so this
  loses precision and is not unsafe.
- **R3. A sink in one method of a constructor-function class is reached from every route of
  another class that only constructs it.** The `$where` sink in
  `getByUserIdAndThreshold` (`app/data/allocations-dao.js:73-78`) is recorded on the symbol
  `AllocationsDAO` (line 4). The session routes (`app/routes/index.js:32-41`, all
  `sessionHandler.*`) reach it through `SessionHandler` (`app/routes/session.js:12`,
  `new AllocationsDAO(db)`). The session handlers only call `allocationsDAO.update`
  (`session.js:20`). The result is 5 false `unguarded-reaching` findings. The sink itself is new
  and true.

## Harness fixes in this change (version 2)

| number | what harness 1 read | what is there | fix |
|---|---|---|---|
| `map.entries`, `map.proposed*`, `map.same_as_mined`, the `from_map` labels | `census --from-map --json` key `proposals` (the mined conventions) | `from_map`, each entry with `kind` and `proposed` | read `from_map`; no such list is n/a, not 0 |
| `sec.findings.unscoped-key` (and `sec.findings`) | a `findings` list in `security.json` | none; ratchet adds unscoped keys from the authz rows' `unscoped` | read the authz rows; n/a for a build whose rows predate `kind`/`uses` |
| `entry.guard_unknown`, `guard_class` | `unknown`, `guard_unknown` on entry rows | only `opaque` | read `opaque` only |
| `sec.findings.*` keys | no method in no-guard, guard-gap or no-authorization keys | ratchet.rs `entry_key` has method and route | same key as ratchet.rs (counts unchanged on the seven) |
| new: `sec.unreached`, `sec.unreached_sinks`, `sec.unreached_snippets`, `entry.in_map_listed` | not read | `security.json` `unreached`; `map.json` `entry_point_counts.listed` | counted; n/a for the older build |

`diff` now says when a repository is scored on one side only. It names it as not comparable, and
judges none of its numbers or guards. `diff` also says when the two sides were scored by
different harness versions, and an unknown-guard trip now gives the change in row count. `score
--no-timing REASON` sets every `time.*` to n/a.

Every other number was checked against the after outputs and reads keys that exist. No metric
reads a key that does not exist.

## What was not measured

- **Timings:** scoreboard 7 and 8, `time.*` and peak memory. The after build is a debug build that
  ran on a shared machine.
- **Anything that needs labels:** scoreboard 1, 2 (the candidates and the map) and 4. Precision of
  the 39 proposals from the map, and of promoted practices.
- **Anything that needs `drift check` or a diff:** scoreboard 3, 5, 8 and the fourth path of 6.
- **The hold-out repositories:** not run, not read.
- **Units not read by hand:** the classifications above cover every unit behind the two guard
  trips and the epic validation move, ten units each for the other moves, and nothing else.
