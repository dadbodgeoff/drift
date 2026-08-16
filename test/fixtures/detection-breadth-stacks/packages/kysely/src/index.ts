// D-H3. Kysely was already in DATA_LAYER_PACKAGES in packages/cli/src/domain/data-layer-discovery.ts,
// so the project treated it as a data layer everywhere except the one predicate that decides.
import { Kysely, PostgresDialect } from "kysely";

export const reporting = new Kysely({ dialect: new PostgresDialect({}) });
