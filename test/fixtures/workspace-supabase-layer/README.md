# workspace-supabase-layer

EW-5. midday's shape, reduced.

The data layer is a workspace package whose name (`@acme/supabase`) has no textual relationship to
either the substring whitelist (`prisma` / `database` / `db` / `data-access`) or to the wrapper's
path (`packages/supabase/src/server.ts`). Routes import it as `@acme/supabase/server`.

Two things must both work, and they are different mechanisms:

1. **Discovery** must name `packages/supabase/src/server.ts` - reached from the declared
   `@supabase/supabase-js` dependency, not from any naming convention. That requires resolving the
   workspace package name to its directory before matching, because the specifier and the wrapper
   path share no tail.
2. A **violating route must yield an evidenced finding** once that module is the declared data
   layer. Discovery naming a module that then produces nothing is the state midday was in.
