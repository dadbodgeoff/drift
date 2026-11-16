# How a task is selected and frozen

A task is a real merged pull request, turned back: the agent starts from the commit just before
the change and is given the linked issue as its prompt. The real change stays hidden from the
agent and is given to the graders as a reference.

The builder does not pick tasks. A registered query decides which pull requests are eligible, a
seed made after registration orders them, and the first in that order are the tasks. Every rule
below is fixed before any export is looked at.

## The steps

1. **Registration.** `PREREG-DRAFT.md` becomes `PREREG.md` with the spec below (D6, D7).
2. **The seed**, made after the registration commit (PREREG §9).
3. **Exports.** For each of the 5 repositories, the operator writes one JSON export of its merged
   pull requests (format below). This is the only step that needs the network, and the harness
   does not do it. The export's sha256 is recorded before the draw.
4. **The draw.** `python3 -I eval/benchmark/select_tasks.py draw --spec SPEC.json --seed SEED --out
   DIR EXPORTS...` writes `DIR/selection.json` and `DIR/tasks/<id>.json`. A directory that already
   holds a selection is refused: there is one draw. `select_tasks.py verify --out DIR EXPORTS...`
   replays it.
5. **Freezing**, before any agent run (below).

## The export format

One file per repository, `schema: "drift-benchmark-pr-export/1"`:

```json
{
  "schema": "drift-benchmark-pr-export/1",
  "repository": "owner/name",
  "exported_at": "2026-11-20T00:00:00Z",
  "source": "how it was exported (tool and query), in one line",
  "pull_requests": [
    {
      "number": 123,
      "title": "Fix totals on an empty list",
      "merged_at": "2026-03-01T10:00:00Z",
      "merge_commit": "<40 hex: the commit on the base branch that landed the change>",
      "base_commit": "<40 hex: the first parent of merge_commit>",
      "base_branch": "main",
      "author_kind": "user",
      "commits": ["<40 hex>", "..."],
      "changed_files": [
        {"path": "src/api/totals.ts", "status": "modified", "additions": 20, "deletions": 4}
      ],
      "linked_issues": [
        {"number": 99, "title": "...", "body": "...", "created_at": "2026-02-01T09:00:00Z",
         "is_pull_request": false}
      ]
    }
  ]
}
```

- `merge_commit` is the merge commit for a merge, the squashed commit for a squash merge, and the
  last rebased commit for a rebase merge. `base_commit` is always its first parent. A rebase merge
  of several commits is not one change on the base branch, so the operator leaves such pull
  requests out of the export and says so in `source`.
- `author_kind` is `user` or `bot`.
- `linked_issues` are the issues the pull request closes (the host's "closing issues" link), with
  the issue's own title and body as written by its author. Comments are not exported: they often
  discuss the fix.
- Every merged pull request in the date window is exported, not a sample. The draw decides.
- The test file `tests/fixtures/export-widgets.json` is a made-up example of the format.

## The query (the spec)

The spec is a JSON file of these keys; anything not given takes the default in `select_tasks.py`
(`DEFAULT_SPEC`). An unknown key is refused.

| Key | Default | Meaning |
| --- | --- | --- |
| `repositories` | (required in the registered spec) | The 5 repositories; the exports must match exactly |
| `merged_after`, `merged_before` | 2025-01-01, 2026-11-01 | The date window (D: the owner registers it; see PREREG §12 on training data) |
| `min_changed_lines`, `max_changed_lines` | 10, 400 | Additions plus deletions over all files |
| `min_files`, `max_files` | 1, 12 | Files changed |
| `min_code_files` | 1 | Files in a language Drift reads (`code_extensions`: `.ts .tsx .mts .cts .js .jsx .mjs .cjs .py`), not matched by `not_code_globs` (declarations, minified, vendored, built, migrations, lockfiles, snapshots) and not tests (`test_globs`) |
| `require_linked_issue`, `max_linked_issues` | true, 1 | Exactly one linked issue |
| `min_issue_chars` | 80 | The issue body is long enough to be a prompt |
| `exclude_issue_with_diff` | true | An issue holding a diff or patch gives the fix away |
| `exclude_author_kinds` | `["bot"]` | |
| `exclude_title_patterns` | reverts, chore/build/ci, bump, deps, release | Changes that are not a task an agent would be given |
| `tasks_per_repo`, `total_tasks` | 5, 25 | |
| `reserves_per_repo` | 2 | Used only by the freezing rule below |
| `refill_from_other_repos` | true | A repository with too few eligible pull requests is filled from the others' leftovers in seed order |
| `prompt_template` | "Resolve the following issue in the repository in the current directory.\n\nIssue title: {title}\n\n{body}\n" | The one fixed framing, the same in every arm |

**Eligibility** is tested in a fixed order and the first failing rule is the recorded reason:
not merged, outside the dates, a commit missing, author kind, title pattern, file count, size, no
code Drift reads, no linked issue, several issues, issue too short, issue holds a diff, issue opened
after the merge, the "issue" is itself a pull request. `selection.json` lists every pull request
with its reason, and the counts per reason.

"Touches code Drift reads" is decided by file names only. A filter that ran Drift to keep tasks
where Drift has something to say would select in Drift's favour, so there is none.

## The draw

- Each eligible pull request gets the key sha256(seed, "draw", repository, number).
- Per repository, in key order: the first `tasks_per_repo` are tasks, the next `reserves_per_repo`
  are reserves.
- If there are fewer than `total_tasks`, the shortfall is filled from the remaining eligible pull
  requests of all repositories in key order. Any shortfall left is recorded, never filled by hand.
- The tasks are ranked by key; the rank is in each task record.

## The prompt

The agent receives `prompt_template` filled with the issue's title and body, **verbatim**, except
for what the stripping rule removes. The rule (`strip_fix_links`) removes, and logs in the task
record (`issue.stripped`):

- every URL to a pull, commit or compare page of the same repository, and every URL containing the
  first 7 characters of the merge commit or of any commit of the pull request (`[link removed]`);
- every reference `#N` or `owner/name#N` where N is the pull request's number
  (`[reference removed]`);
- every hexadecimal string of 7 to 40 characters that is a prefix of one of those commits
  (`[reference removed]`).

Nothing else is changed: other links, code blocks, typos and screenshots' alt text stay. The
issue's sha256 before stripping is in the record. The issue's comments are never used.

## Freezing (before any agent run)

All of this is committed with the task records before the first run.

1. **Technical check and reference.** `python3 -I eval/benchmark/harness.py freeze --config CONFIG
   --tests` checks that both commits are in the local mirror, that the base is the merge's first
   parent, and that the changed files match the export; writes `reference/<id>.diff` (the real
   change) and sets `hidden.reference_diff`; with `--tests`, runs the test command at the base and at
   the merge commit. Results go to `freeze-report.json`.
2. **Replacement.** A task the check reports a problem for is replaced by the next reserve of the
   same repository, in key order, and the replacement is listed. Nothing else replaces a task.
3. **Test command.** `test_command` is the repository's own command for the touched code, taken from
   its CI configuration or contributing guide at the base commit (for example the test job's command
   narrowed to the package touched). It must pass at the merge commit. If the repository has none,
   or it cannot run without the network, it is `null` and the task has no mechanical test outcome.
   `setup_command` installs what the tests need from a local cache, if anything; it runs before the
   arm is prepared, so it is the same in every arm.
4. **Plain instructions.** `plain_instructions_dir/<id>.md`, made by the registered procedure (D2) at
   the base commit.
5. **Conventions.** The graders' frozen list per task (`conventions` in the record; RUBRIC.md step 1).

`select_tasks.py verify` still passes after freezing: the fields filled at freezing are outside the
replay.

## The task record

`tasks/schema.json` defines it. In short: `id`, `repository`, `pr_number`, `merge_commit`,
`base_commit`, `base_branch`, `merged_at`, `language`, `issue` (number, sha256 before stripping, what
was stripped), `prompt` (exactly what the agent receives), `hidden` (changed files, size, the
reference diff path: never shown to the agent), `test_command`, `setup_command`, `conventions`,
`draw` (seed, rank, the export's sha256, the selector version). The harness refuses a task that
does not match the schema.

## What the working copy holds

The harness fetches the base commit by id from the local mirror into an empty repository: the base
commit and its history, no remote, no tags, no later commit, no reflog. It checks that the merge
commit is not reachable. The agent can read the repository's history up to the base, as a developer
picking up the issue could.
