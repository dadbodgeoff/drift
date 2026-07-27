# Test isolation

`pnpm test` runs package suites in parallel. It did not always, and the reason it can now is
worth recording, because the previous fix hid the problem rather than solving it.

## What went wrong

C3 serialised the workspace with `--workspace-concurrency=1` after intermittent failures under
parallel runs. That made CI deterministic by removing the concurrency, which is a trade rather
than a fix: it cost wall-clock time on every run and left the underlying contention in place, so
it would resurface the moment anyone ran the suites another way.

## What the contention actually was

`SQLITE_BUSY`. WAL mode was enabled, so readers never blocked the writer, but **`busy_timeout`
was never set** — so two concurrent writers failed instantly instead of waiting a few
milliseconds. Under `--workspace-concurrency=1` that could not happen, which is exactly why
serialising appeared to work.

T17 set `busy_timeout = 5000` for a different reason: an edit-time hook, the CLI, and an MCP
server can all legitimately hold the database at once in normal use, and `SQLITE_BUSY` reached
users as a crash. Fixing it for users fixed it for the test suite too.

## Evidence

Four consecutive `pnpm -r test` runs at default concurrency, all green — 789 tests across nine
packages. Serialisation removed on that basis rather than on the assumption that T17 had covered
it.

## If flakes come back

Do not reach for `--workspace-concurrency=1` first. It suppresses the symptom and the cause
survives. Establish what the contention is:

- **Database** — check `busy_timeout` is actually applied (`packages/storage/test/concurrency.test.ts`).
- **Engine binary** — suites invoking `target/release/drift-engine` share one binary but no
  state; contention here means a shared temp path, not the binary.
- **Fixtures** — a suite writing into `test/fixtures/` rather than a temp directory will collide
  with any other suite reading it. Fixtures are read-only by convention.
- **Disk** — low disk produced four false failures during this project's development, all of
  which passed on retry after freeing space with no code change. Check `df -h` before believing a
  flake is real.
