# Grading rubric (written before any run)

Two graders grade every packet independently. Neither built Drift, chose the repositories, or sees
the key that says which arm a packet came from. They do not talk about packets until both grade
files are handed in. They do not look the pull request up online and do not run Drift.

This rubric is frozen with the pre-registration. Graders may ask the owner what a line means
before grading starts; the answer is added here as a dated note before the first real packet is
graded, never after.

## Step 1: list each task's conventions (before any run)

For each task, each grader alone reads the real change (`reference/<id>.diff`) and the repository
at the base commit, and writes down the conventions a change for this issue should follow:
how this repository does the things the change touches. Then the two graders merge their lists into
one per task, and it is frozen in the task record (`conventions`) before any agent run.

- **Sources:** the real change, the files around it, the repository's own docs (contributing guide,
  lint and format configuration, existing instruction files). **Never Drift's output** for this
  repository, and never another agent's.
- **Each item** is one sentence a grader can check against a diff ("Route handlers in `app/api` are
  wrapped in `withAuth()`", "Errors are raised as `AppError` with a code, never as plain `Error`",
  "New endpoints are registered in `routes/index.ts`"), with one to three files that show it.
- **Kinds that count:** structure (where a file goes, how it is named, what it exports),
  wrappers and guards (authentication, permissions, validation), error handling and response shape,
  data access (which client or helper), registration (where a new thing is wired in), the repository's
  own helpers instead of hand-written equivalents, tests placed and written the way the repository
  does.
- **Kinds that do not count:** what a formatter or linter in the repository's configuration fixes
  on its own; personal taste; anything the issue itself asks to change.
- **Size:** two to eight items per task. A task where the graders cannot find two is still graded;
  its V can only be small, and it is reported.
- Items get ids `C1`, `C2`, ... in the order the graders agree.

## Step 2: calibration

Before the real packets, both graders grade the same 8 practice packets made from runs that are not
in the study (dry-run packets, or headroom-check runs of tasks not drawn), compare, and clarify this
rubric where they disagreed (dated notes below). Practice grades are not analysed.

## Step 3: grade each packet

A packet has the issue as the agent got it, the frozen convention list, the real change as a
reference, the change to grade, and the repository's test result if the task has a test command.
Grade the change to grade as the repository's maintainer reviewing a pull request would. The real
change is one acceptable solution, not the only one.

Fill in the packet's entry in your `grades.json`. Every field is required.

### `resolves` (0 to 3): does the change do what the issue asks?

| Score | Anchor |
| --- | --- |
| 0 | No change, or a change that does not address the issue, or addresses a different problem. |
| 1 | Addresses part of the issue, or the main path is wrong: a maintainer would send it back for a rewrite. |
| 2 | Does what the issue asks, with minor gaps a maintainer would fix in review (an edge case, a message, a missed second call site). |
| 3 | Does everything the issue asks, as well as the real change or better. |

Success (S) is a score of 2 or 3.

### `conventions`: one verdict per listed convention

| Verdict | When |
| --- | --- |
| `followed` | The change touches what the convention governs and does it the repository's way. |
| `violated` | The change touches what the convention governs and does it another way. One verdict per convention, however many places break it. |
| `na` | The change does not touch what the convention governs (including an empty change). |

V is the number of `violated`.

### `other_violations` (a whole number, 0 or more)

Clear departures from how the repository does things that are not on the list and that a
maintainer would ask to change. Count each convention once. Formatting a configured formatter
fixes does not count. When unsure, do not count it.

### `breakage` (0 to 3): did it break anything?

| Score | Anchor |
| --- | --- |
| 0 | Clearly breaks something: the tests fail because of the change, code that does not parse or import, a removed behaviour other code needs. |
| 1 | Likely breaks something on a path the issue does not cover (a changed signature with callers left unchanged, a changed shared default). |
| 2 | A risk a reviewer would ask about, nothing clearly broken. |
| 3 | Nothing broken that a reviewer can see, and the tests (where given) pass. |

### `scope` (0 to 3): size and stray edits

| Score | Anchor |
| --- | --- |
| 0 | Large unrelated changes: rewrites, reformatting of files it did not need to touch, deleted code unrelated to the issue, generated or scratch files left behind. |
| 1 | Several stray edits a reviewer would ask to revert. |
| 2 | One small stray edit, or noticeably larger than needed. |
| 3 | Focused: only what the issue needs, of a size close to the real change's or smaller. |

### `guess_arm`

Your guess of the arm (`none`, `plain`, `agents-md`, `hooks`), or `cannot-tell`. This is only
for the blinding check. Answer `cannot-tell` unless something specific makes you think otherwise,
and say what in `notes`.

### `notes`

Optional. One line on anything a reader of the results would need (why `resolves` is 1, which
convention broke where).

## Blinding: what is removed from a packet

`grade.py packets` removes, from every packet in every arm alike:

- every file under `.drift/`, `drift.lock`, `.mcp.json`, every `AGENTS.md` and `CLAUDE.md` at any
  depth, the configured instructions file, the hook wiring's destination files and any hidden
  configuration directory they live in, from the change to grade;
- added lines carrying a `drift-ignore` comment (counted per run in the key, outside the packet);
- the paths of the working copy and of the results directory, replaced by `<workdir>` or `<path>`;
- the arm's own setup: the change to grade starts after the "Project setup" commit, so what the arm
  added is never in it.

The transcript is not in the packet (`--with-transcript` adds a version with every line naming
Drift, an instructions file or a hook removed, for exploratory use only; it is not used for the
registered grading). Packets have opaque ids, and each grader gets them in their own seeded order.

What cannot be removed: a change in how the code is written because the agent was told the
repository's conventions. That is the treatment, and the guess rate shows how visible it was.

## Notes

(dated clarifications from calibration go here, before the first real packet)
