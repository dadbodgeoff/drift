// The repo's real authorization helper. It is the symbol the proposer nominates, because three
// api-route files call it — `push_guard_candidate` needs the same symbol in >= 2 route facts
// (candidate_command.rs:1660) and one call is not a convention.
//
// It takes no arguments on purpose: it reads the caller's identity out of request-scoped async
// context rather than being handed a subject. See test/fixtures/GT-CANARY-FIXTURES.md for why that
// shape, and not `requirePermission(session.user, "...")`, is the only one a candidate-sourced
// authorization convention can currently prove.
export async function requirePermission(): Promise<void> {
  // Throws when the caller lacks the permission; returns nothing when it holds.
}

// Telemetry, not a guard. Named to look like one.
export function logPermissionCheck(): void {}
