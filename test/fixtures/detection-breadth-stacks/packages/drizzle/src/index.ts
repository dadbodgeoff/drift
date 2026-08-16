// D-H3. A Drizzle client in a package whose name says drizzle. The pre-W7 vocabulary recognised
// prisma, database, db and data-access and nothing else, so this was invisible to the primary path
// while the degraded TypeScript fallback it replaced had recognised `drizzle` all along.
//
// None of the seven corpus repos can stand in for this. openstatus IS a Drizzle app, but its
// package is `@openstatus/db`, so the old vocabulary caught it by accident through the `/db`
// clause; every other repo names its data layer prisma or database.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const store = drizzle(pool);
