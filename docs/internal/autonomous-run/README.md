# Autonomous run

- `PLAN.md` — 73 tasks to production soft beta, with a definition of done and verify command each.
- `PROTOCOL.md` — how an unattended run behaves: triage and continue, never halt on one task.
- `log.jsonl` — append-only run log, source of truth, committed after every task.
- `SUMMARY.md` — regenerated from the log; ends with the discussion agenda.

Resume a run by reading `log.jsonl` and skipping tasks already marked DONE.
