# Autonomous run summary

| Outcome | Count |
|---|---|
| Done | 2 |
| Done (partial) | 0 |
| Premise false (no change needed) | 0 |
| Blocked — needs discussion | 0 |
| Skipped — dependency blocked | 0 |
| Deferred — human-gated | 0 |
| Discoveries | 0 |
| Baseline changes | 0 |

## Completed

- **T100** Match on resolved module identity, not specifier strings — Both T93 bypasses closed. Relative import (../../../lib/prisma) and barrel re-export now block; the clean control still passes; external suite 7/7 with ZERO baseline drift, so no overshoot.
- **T100b** Rebuild the T93 fixtures so they actually reproduce — The fixtures I committed in run 1 did not reproduce the bypass they were filed for. Each now carries a tsconfig paths mapping and a route violating via the ALIAS form, so inference learns @/lib/prisma and the sneaky route is genuinely the odd one out. Pinned by packages/cli/test/bypass-fixtures.test.ts, which drives the real CLI end to end.

