/**
 * Corruption markers for data read back from the local SQLite database.
 *
 * A JSON parse error is ambiguous at the top of the CLI: it can come from user input (a contract
 * file passed to `contract import`) or from a blob SQLite handed back off a corrupted page. The
 * two need opposite advice - "fix your input" versus "your local state is damaged, restore a
 * backup" - so the disambiguation has to happen at the throw site, where we still know the bytes
 * came from the database. R-3 verified that without this marker, corrupted stored blobs surfaced
 * as generic `cli_error` with the misleading advice "rerun with corrected inputs".
 *
 * The marker is duck-typed (`driftFailureCode`) rather than `instanceof` so classifiers in other
 * packages do not depend on sharing this exact class identity across build boundaries.
 */
export class StoredBlobCorruptionError extends Error {
  readonly driftFailureCode = "corrupt_database" as const;

  constructor(context: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Stored data for ${context} in the local Drift database is unreadable (${detail}). ` +
        `The database file is likely corrupted.`
    );
    this.name = "StoredBlobCorruptionError";
  }
}

/** True when a thrown value carries the corrupt-database marker, across package boundaries. */
export function isCorruptStoredDataError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { driftFailureCode?: unknown }).driftFailureCode === "corrupt_database"
  );
}
