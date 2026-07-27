import { statfsSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { dirname } from "node:path";

/**
 * Disk-space preflight for local state.
 *
 * Drift's per-repo state is substantial - roughly 1 GB for a 5,000-file monorepo - and running
 * out of space part-way through a scan does not fail cleanly. SQLite surfaces a raw
 * "database or disk is full", the database is left partially written, and subsequent
 * operations report failures that have nothing to do with the repo being scanned. During
 * development this happened twice: the first time it produced four false test failures that
 * all passed on retry after freeing space, with no code change.
 *
 * So this refuses up front rather than degrading mid-write. A guardrail that reports
 * untrustworthy results is worse than one that declines to run.
 */

/** Rough state size per indexed file, measured across the evaluation repos. */
const BYTES_PER_INDEXED_FILE = 220 * 1024;

/** Never proceed below this, regardless of estimate. */
const ABSOLUTE_FLOOR_BYTES = 512 * 1024 * 1024;

export interface DiskSpaceReport {
  /** Bytes available to this user on the volume holding the database. */
  availableBytes: number;
  /** Estimated bytes needed, when a file count is known. */
  estimatedBytes: number | null;
  /** True when there is comfortably enough room. */
  sufficient: boolean;
  /** Human-readable detail for doctor output and refusals. */
  detail: string;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Inspect free space on the volume that will hold `databasePath`.
 *
 * `indexableFileCount` is optional: `doctor` knows it, but `start` may be called before
 * discovery. Without it, only the absolute floor is enforced.
 */
export function checkDiskSpace(
  databasePath: string,
  indexableFileCount?: number
): DiskSpaceReport {
  let availableBytes: number;
  try {
    // The database's parent may not exist yet on a first run; walk up to a real directory.
    let probe = dirname(databasePath);
    let stats: ReturnType<typeof statfsSync> | undefined;
    for (let depth = 0; depth < 8; depth += 1) {
      try {
        stats = statfsSync(probe);
        break;
      } catch {
        const parent = dirname(probe);
        if (parent === probe) {
          break;
        }
        probe = parent;
      }
    }
    if (!stats) {
      // Cannot measure: do not invent a refusal, and say so.
      return {
        availableBytes: Number.POSITIVE_INFINITY,
        estimatedBytes: null,
        sufficient: true,
        detail: "free space could not be measured on this platform"
      };
    }
    availableBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return {
      availableBytes: Number.POSITIVE_INFINITY,
      estimatedBytes: null,
      sufficient: true,
      detail: "free space could not be measured on this platform"
    };
  }

  const estimatedBytes =
    indexableFileCount === undefined ? null : indexableFileCount * BYTES_PER_INDEXED_FILE;
  const requiredBytes = Math.max(ABSOLUTE_FLOOR_BYTES, estimatedBytes ?? 0);
  const sufficient = availableBytes >= requiredBytes;

  const detail = sufficient
    ? estimatedBytes === null
      ? `${formatGb(availableBytes)} free`
      : `${formatGb(availableBytes)} free, about ${formatGb(estimatedBytes)} needed`
    : estimatedBytes === null
      ? `${formatGb(availableBytes)} free, at least ${formatGb(ABSOLUTE_FLOOR_BYTES)} needed`
      : `${formatGb(availableBytes)} free, about ${formatGb(estimatedBytes)} needed for ${indexableFileCount} files`;

  return { availableBytes, estimatedBytes, sufficient, detail };
}

/** Message for a refusal, naming what to do about it. */
export function insufficientDiskMessage(report: DiskSpaceReport, statePath: string): string {
  return [
    `Not enough disk space for local state: ${report.detail}.`,
    "",
    `State directory: ${statePath}`,
    "",
    "Drift keeps a scan database per repo. Free space, then retry:",
    "  drift state size            # what Drift is using",
    "  rm -rf ~/.drift/repos/<id>  # discard one repo's state (it is rebuilt on next scan)"
  ].join("\n");
}

/**
 * Heap preflight.
 *
 * Measured on a synthetic 20,000-file repository: the Rust engine peaks at 93 MB, while the Node
 * CLI peaks at 1.76 GB doing storage and graph assembly - 19x the engine, for the same scan. With
 * the heap capped at 512 MB the process dies with `FATAL ERROR: JavaScript heap out of memory`
 * and exit 134: no Drift error, no code, no next action, and a partially written database.
 *
 * Constrained CI runners routinely cap Node's heap, so this is a real configuration rather than a
 * contrived one. Refusing with an instruction beats crashing without one.
 */

/** Heap bytes per indexable file, from the 20k-file measurement (1 GB sufficed, 512 MB did not). */
const HEAP_BYTES_PER_FILE = 52 * 1024;

export interface HeapReport {
  limitBytes: number;
  estimatedBytes: number | null;
  sufficient: boolean;
  detail: string;
}

export function checkHeadroom(indexableFileCount?: number): HeapReport {
  // `heap_size_limit` reflects --max-old-space-size and the platform default.
  const limitBytes = getHeapStatistics().heap_size_limit;
  const estimatedBytes =
    indexableFileCount === undefined ? null : indexableFileCount * HEAP_BYTES_PER_FILE;
  const sufficient = estimatedBytes === null ? true : limitBytes >= estimatedBytes;
  const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return {
    limitBytes,
    estimatedBytes,
    sufficient,
    detail:
      estimatedBytes === null
        ? `${gb(limitBytes)} heap limit`
        : `${gb(limitBytes)} heap limit, about ${gb(estimatedBytes)} needed for ${indexableFileCount} files`
  };
}

export function insufficientHeapMessage(report: HeapReport, fileCount: number): string {
  return [
    `Not enough heap for a repository this size: ${report.detail}.`,
    "",
    "Node would run out of memory part-way through the scan and exit without a usable error,",
    "leaving the database partially written. Raise the limit and retry:",
    "",
    `  NODE_OPTIONS=--max-old-space-size=${Math.ceil((fileCount * HEAP_BYTES_PER_FILE) / 1024 ** 2 / 512) * 512} drift start --repo-root .`
  ].join("\n");
}
