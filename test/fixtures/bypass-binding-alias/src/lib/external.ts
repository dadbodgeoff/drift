// Negative: the specifier resolves nowhere in the snapshot, so there is no edge to walk.
import { db } from "drizzle-orm";
export const client = db;
