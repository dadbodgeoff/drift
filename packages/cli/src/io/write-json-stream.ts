import { streamJson } from "@drift/core";
import { closeSync, openSync, writeSync } from "node:fs";

/**
 * T-02: write a value as JSON without building the whole JSON string first.
 *
 * Two payloads the CLI hands to the engine are files already - the scan-reuse manifest, and the
 * infer-candidates request - and both were produced by `JSON.stringify(everything)`. The file was
 * never the problem; the string on the way to it was, because it is bounded by
 * MAX_STRING_LENGTH (536,870,888) and grows with the repo.
 *
 * Chunks are batched to about a mebibyte before each `writeSync`. Writing per chunk would trade a
 * memory problem for a syscall-per-token one, and `streamJson` emits a chunk per key, per comma
 * and per array element.
 */
const FLUSH_THRESHOLD_BYTES = 1024 * 1024;

export function writeJsonFileStreamed(path: string, value: unknown): void {
  const fd = openSync(path, "w");
  try {
    let pending: string[] = [];
    let pendingLength = 0;
    const flush = (): void => {
      if (pendingLength === 0) {
        return;
      }
      writeSync(fd, pending.join(""));
      pending = [];
      pendingLength = 0;
    };

    streamJson(value, (chunk) => {
      pending.push(chunk);
      pendingLength += chunk.length;
      if (pendingLength >= FLUSH_THRESHOLD_BYTES) {
        flush();
      }
    });
    flush();
  } finally {
    closeSync(fd);
  }
}
