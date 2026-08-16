// NOT a D-H3 case, and here to mark the boundary of what D-H3 fixed.
//
// This is a real Drizzle client in a package called `store`. No vocabulary of ORM names can see it,
// because its name says nothing - identifying it needs the structural discovery in
// packages/cli/src/domain/data-layer-discovery.ts, which reads package.json dependencies and walks
// imports to find the wrapper. That is the F4 path midday exercises in scripts/external-eval.mjs,
// and it is a suggestion flow requiring a human declaration, not something inference decides.
//
// It is deliberately imported by no route: a fixture that mixed the two would make a D-H3
// regression look like an F4 regression.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const unnamedLayer = drizzle(new Pool());
