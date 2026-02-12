# Cortex Utilities

## Location
`packages/cortex/src/utils/`

## Files

### `hash.ts`
Content hashing for drift detection. Used by file linker to detect when linked files have changed.

### `id-generator.ts`
Unique ID generation for memories, edges, and sessions. Uses UUID v4.

### `time.ts`
Time utilities for bitemporal tracking, age calculation, and ISO timestamp formatting.

### `tokens.ts`
Token counting/estimation for compression and budget management. Approximates token count from string length.

## Rust Rebuild Considerations
- All utilities are trivial to port
- Hashing: `sha2` or `blake3` crate
- IDs: `uuid` crate
- Time: `chrono` crate
- Tokens: `tiktoken-rs` for accurate counting
