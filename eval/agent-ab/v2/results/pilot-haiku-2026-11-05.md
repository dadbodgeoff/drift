# Agent A/B v2 report

8 scored runs in /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/abv2-pilot.
Only conventions labelled ACCEPT by the independent reviewers are enforced and counted.

- **final**: run left at least one new violation in the files it changed (final-state score, as v1).
- **introduced**: at least one violation existed after some edit during the session (trajectory replay).
- **regression**: an existing symbol that satisfied a rule stopped satisfying it at some point (e.g. a route inserted between a decorator and its handler).
- **fixed**: introduced violations gone by the end (pooled over runs).
- **CI fails**: `drift check` on the final tree exits non-zero, as the GitHub action would.

## claude-haiku-5-5

| Arm | Runs | final | introduced | regression | fixed | mean final | mean introduced | CI fails | suppressions | $ total | turns (mean) | s (mean) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 4 | 0/4 0% [0%–49%] | 0/4 0% [0%–49%] | 0/4 0% [0%–49%] | 0/0 – [–––] | 0.00 [0.00–0.00] | 0.00 [0.00–0.00] | 0/4 0% [0%–49%] | 0 | 0.23 | 25.8 | 85 |
| drift | 4 | 0/4 0% [0%–49%] | 0/4 0% [0%–49%] | 0/4 0% [0%–49%] | 0/0 – [–––] | 0.00 [0.00–0.00] | 0.00 [0.00–0.00] | 0/4 0% [0%–49%] | 0 | 0.39 | 36.3 | 113 |

### By category

| Category | Arm | Runs | final | introduced | regression |
| --- | --- | --- | --- | --- | --- |
| a | control | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| a | drift | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| d | control | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| d | drift | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| e | control | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| e | drift | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| f | control | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |
| f | drift | 1 | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] | 0/1 0% [0%–79%] |

### Paired by task (control minus drift; positive means fewer violations with Drift)

| Task | Cat | n c/d | final c | final d | introduced c | introduced d | regression c | regression d |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dub-d-domains-count-quick | d | 1/1 | 0% | 0% | 0% | 0% | 0% | 0% |
| immich-a-memory-duplicate | a | 1/1 | 0% | 0% | 0% | 0% | 0% | 0% |
| infisical-e-split-user-mfa | e | 1/1 | 0% | 0% | 0% | 0% | 0% | 0% |
| midday-f-budgets-session | f | 1/1 | 0% | 0% | 0% | 0% | 0% | 0% |

- **final**: mean paired difference 0% [0%–0%] over 4 tasks (bootstrap over tasks); Drift better on 0, tie 4, worse 0.
- **introduced**: mean paired difference 0% [0%–0%] over 4 tasks (bootstrap over tasks); Drift better on 0, tie 4, worse 0.
- **regression**: mean paired difference 0% [0%–0%] over 4 tasks (bootstrap over tasks).

### CI view (control arm)

- Runs that left violations: 0/4; CI would fail on 0 of them (strict mode: 0).
- CI failures without a violation in changed files (e.g. in untouched files): 0.

### What the hooks did (drift arm)

- Advice shown: 0 PostToolUse, 6 PreToolUse primes, 4 SessionStart.
- Stop blocks: 0 (in 0 runs); Stop feedback seen in transcript: 0.
- Introduced violations the hooks reported to the agent: 0/0.
- Hook errors: 0; agent ran `drift review/init`: 0; agent ran drift CLI: 3 times.
- Latency PostToolUse: 47 calls, median of run medians 1082 ms, max 2268 ms.
- Latency PreToolUse: 47 calls, median of run medians 8 ms, max 60 ms.
- Latency SessionStart: 6 calls, median of run medians 984 ms, max 1237 ms.
- Latency Stop: 6 calls, median of run medians 877 ms, max 2141 ms.
- Latency cli:example: 5 calls, median of run medians 612 ms, max 1205 ms.

Replay: 0 of 8 runs inconsistent with the final tree; issues {"failed_in_session":0,"replay_miss":0,"fallback_snapshot":0,"fidelity_mismatch":0,"outside_worktree":1,"bash_changes":0,"bash_denied_or_failed":34,"bash_unrecorded":0}.

## Notes (pilot, 2026-11-05)

Tasks: immich-a-memory-duplicate (a), dub-d-domains-count-quick (d), infisical-e-split-user-mfa (e),
midday-f-budgets-session (f), Haiku 5.5, one repeat, seed 3. Cost $0.62. Purpose: validate the
harness end to end, not to measure an effect (n = 1 per cell).

- Harness: every run replayed consistently with the final tree; 34 Bash calls were denied by
  Claude Code's permission check (`sed -i`, `cat > file <<EOF`, `cd ... && ... > file`) and the
  agent fell back to Edit/Write; one Write went to the agent's scratchpad outside the worktree.
  `--resume` keeps the session id, so a chained task is one transcript and one Drift session.
- Drift hooks, things that look wrong:
  - SessionStart runs again on every `--resume` (and would on compaction) and rebuilds the
    session state: the baseline is recomputed from the current tree, so violations the agent
    introduced earlier in the same session become "baseline" and the Stop hook no longer blocks
    them; `advised`, `primed` and the block counter are reset. In midday-f the final state held
    only the third prompt's primes.
  - New-file primes (PreToolUse) and `drift example` match roles on directory only, ignoring the
    symbol kind: a new Fastify router was primed with "components in src/** render
    <BaseEmailWrapper>", and a new tRPC schema file with the rpc-wrapper rule.
  - midday D-50255f ("rpc entry points in src/** are wrapped in internalProcedure() or
    protectedProcedure()") covers only 16 of 37 router files: files whose stem is a learned
    literal file kind (tags, invoice, transactions, customers, ...) fall outside the `*` role. A
    `publicProcedure` added to `routers/tags.ts` is not reported; the same in `overview.ts` is.
  - Latency: PostToolUse median about 1.1 s and up to 2.3 s per edit on infisical/midday (a full
    scan per edit; 0.23 s on immich); SessionStart and Stop about 1 s.

Correction (review of PR #3): a resumed `claude -p --resume` call reports the session's
cumulative `total_cost_usd`, so summing the three results of an f task double-counts. The f
task cost $0.13 (control) and $0.27 (drift), not $0.18 and $0.34; the pilot cost $0.51 in all,
and the drift arm cost 1.8x the control arm. The pilot also ran before the sandbox
(sandbox.mjs): its sessions inherited the operator's environment, in both arms.
