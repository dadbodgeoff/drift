# enforcement-gate-adjacent

Committed state: eight properly layered routes plus one violating route, so inference learns the
data-access convention in **block** mode (a minority violates).

The two routes that matter are added by the test, not committed, because the completeness gate only
considers API-route files **in the checked scope** — a committed route is not in the diff and does not
trigger it. That detail is the difference between this fixture reproducing the defect and appearing to
pass:

- `src/app/api/newbad/route.ts` — a new, unambiguous violation. Alone: exit 2.
- `src/app/api/adjacent/route.ts` — a namespace import of the real `@acme/util` workspace package,
  used at runtime, containing **no violation**. Added alongside `newbad`: exit 0 at `a48ac41`.
