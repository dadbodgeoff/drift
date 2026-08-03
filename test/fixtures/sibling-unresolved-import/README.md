# sibling-unresolved-import

EW-2. Committed state: eight properly layered routes plus one violating route, so inference learns
the data-access convention in **block** mode.

The routes that matter are written by the test, not committed, because the completeness gate only
considers API-route files **in the checked scope** - a committed route is not in the diff and does
not trigger it.

The three shapes the tests add:

- `src/app/api/sibling/route.ts` - a fully evidenced violation **plus** a sibling import of a module
  that does not exist. The violation's own chain is complete; the unresolved import is unrelated to
  it. This is the shape that made one unfinished import hide every violation in the diff.
- `src/app/api/ownchain/route.ts` - the forbidden specifier is *itself* unresolvable (a subpath of
  the data layer that does not exist). The uncertainty is in the finding's own dependency chain, so
  the finding must still be withheld. This is the line that must not move.
- `src/app/api/otherfile/route.ts` - an unresolved import and no violation at all, added alongside a
  violation in a different file, to pin that adjacency across files changes nothing.
