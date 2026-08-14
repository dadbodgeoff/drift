/**
 * T-02: produce `JSON.stringify`'s output in chunks, so nothing has to hold all of it.
 *
 * Three places serialized the whole graph into one string, each bounded only by Node's
 * MAX_STRING_LENGTH (536,870,888). Measured on papermark, a 1,366-file repo:
 *
 *   105,024,113 chars  the infer-candidates request sent back to the engine
 *    97,230,007 chars  sha256(JSON.stringify(graph)) for the graph artifact
 *    10,793,116 chars  the scan-reuse manifest, on any rescan
 *
 * None of the three needs the string. One is hash input, two are file contents. What they need is
 * the BYTES, in order - so this emits them in pieces and the callers consume the pieces.
 *
 * BYTE-IDENTICAL IS THE WHOLE REQUIREMENT. `graph_hash` is persisted, compared across scans, and
 * covered by the determinism digests; a serializer that is merely equivalent-looking would change
 * every stored hash and silently invalidate every determinism claim in the project. So this does
 * not implement JSON encoding. It walks containers and delegates every leaf to `JSON.stringify`
 * itself, which is the only way to be sure the escaping, number formatting and key handling match.
 * `json-stream.test.ts` asserts the concatenation equals `JSON.stringify` over the awkward cases.
 */

/**
 * Below this depth, containers are walked and their children emitted separately. At or beyond it,
 * a value is handed to `JSON.stringify` whole.
 *
 * It has to be deeper than the deepest container that grows with the repo, or the walk stops
 * above the big array and delegates it in one piece - which is the bug this module exists to fix,
 * reintroduced one level up. The payloads here nest about four deep (request -> scan -> facts ->
 * fact), so 8 clears them with room while still bounding recursion on hostile input.
 */
const MAX_WALK_DEPTH = 8;

/**
 * True for a value this module is willing to walk rather than delegate.
 *
 * A `toJSON` method disqualifies an object: `JSON.stringify` would call it and serialize the
 * result, so walking the raw properties would produce different bytes. Dates are the common case.
 */
function isWalkable(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * True when `JSON.stringify(value)` would return `undefined` rather than a string.
 *
 * Decided from the type, NOT by calling `JSON.stringify` and looking at the answer. Doing it the
 * obvious way means serializing every array element and every object value in full just to ask
 * whether it serializes at all - which rebuilds the whole-graph string this module exists to
 * avoid, invisibly, inside the check that was supposed to be cheap. Measured when exactly that
 * happened here: 50,332,481 chars, from a predicate.
 *
 * `undefined`, functions and symbols are the only values with no JSON form. An object with a
 * `toJSON` is the one case that must actually be asked, since its method decides - and those are
 * leaves (a Date, typically), so asking is cheap.
 */
function serializesToUndefined(value: unknown): boolean {
  const kind = typeof value;
  if (kind === "undefined" || kind === "function" || kind === "symbol") {
    return true;
  }
  if (value !== null && kind === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return JSON.stringify(value) === undefined;
  }
  return false;
}

/**
 * Emit `JSON.stringify(value)` as a sequence of chunks, in order.
 *
 * Concatenating every chunk yields exactly `JSON.stringify(value)`. Emits nothing at all when
 * `JSON.stringify` would return `undefined` (a function, a symbol, or `undefined` at the top
 * level), matching its behaviour rather than inventing a representation for it.
 */
export function streamJson(value: unknown, emit: (chunk: string) => void, depth = 0): void {
  if (depth >= MAX_WALK_DEPTH || !isWalkable(value)) {
    const encoded = JSON.stringify(value);
    if (encoded !== undefined) {
      emit(encoded);
    }
    return;
  }

  if (Array.isArray(value)) {
    emit("[");
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        emit(",");
      }
      const element = value[index];
      // An array hole, `undefined`, a function or a symbol all serialize as `null` in an array -
      // an array's length is part of its shape, so nothing can be omitted.
      if (serializesToUndefined(element)) {
        emit("null");
        continue;
      }
      streamJson(element, emit, depth + 1);
    }
    emit("]");
    return;
  }

  emit("{");
  let written = 0;
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key];
    // Omitted entirely rather than emitted as null: an object key whose value does not serialize
    // is absent from `JSON.stringify`'s output, comma and all.
    if (serializesToUndefined(entry)) {
      continue;
    }
    if (written > 0) {
      emit(",");
    }
    written += 1;
    emit(`${JSON.stringify(key)}:`);
    streamJson(entry, emit, depth + 1);
  }
  emit("}");
}
