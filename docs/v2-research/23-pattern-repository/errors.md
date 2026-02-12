# Pattern System Errors

## Location
`packages/core/src/patterns/errors.ts`

## Purpose
Shared error classes for the pattern system. Used by all repository implementations and the service layer for consistent error handling.

## Error Classes

### PatternNotFoundError
```typescript
class PatternNotFoundError extends Error {
  readonly patternId: string;
  // "Pattern not found: {patternId}"
}
```
Thrown by `update()`, `approve()`, `ignore()` when the target pattern doesn't exist.

### InvalidStatusTransitionError
```typescript
class InvalidStatusTransitionError extends Error {
  readonly patternId: string;
  readonly fromStatus: PatternStatus;
  readonly toStatus: PatternStatus;
  // "Invalid status transition for pattern {id}: {from} → {to}"
}
```
Thrown when attempting a transition not in `VALID_STATUS_TRANSITIONS` (e.g., `approved → discovered`).

### PatternAlreadyExistsError
```typescript
class PatternAlreadyExistsError extends Error {
  readonly patternId: string;
  // "Pattern already exists: {patternId}"
}
```
Thrown by `add()` when a pattern with the same ID already exists.

## Rust Rebuild Considerations
- Map to a Rust enum with `thiserror` derive
- Each variant carries the same metadata fields
- Pattern matching on error types replaces `instanceof` checks
