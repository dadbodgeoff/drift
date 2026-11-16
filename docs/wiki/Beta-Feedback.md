# Beta Feedback

`drift feedback` lets a team in the beta tell Drift's maintainers two things with numbers: what share of Drift's proposals the team keeps, and what share of Drift's reports on new code are true. It writes one small JSON file that you can read in full before you decide to hand it over. Drift sends nothing anywhere, and this command does not change that: it opens no network connection, and it has no upload step.

## What you do

1. Review the proposals as usual (`drift review`): accept, block or reject each one. Turn the review log on first if you want the counts of what you were shown (`drift review --set-log on`); it is local and off by default.
2. Leave the hooks on and work. When Drift reports a violation, decide whether it is right, and mark it:

   ```
   drift feedback mark D-37416b app/api/new/route.ts#GET --true
   drift feedback mark D-37416b app/api/ping/route.ts#GET --wrong --why "health check, public by design"
   ```

   A violation is named the way `drift check` and `drift.lock` name it: the convention id and the member (`path#symbol`). A whole line of `drift.lock`, quoted, works too. A finding of `drift investigate` is named by its id: `drift feedback mark F-1a2b3c --true`. Marking the same report again replaces your verdict.

   In Drift Studio, open a violation in Check and choose Mark true or Mark wrong. The dialog shows the exact `drift feedback mark` command it runs. The Feedback view lists your marks. The Studio never runs the export and sends nothing.
3. When the beta asks for it, look at what the file would hold, then write it:

   ```
   drift feedback export --dry-run
   drift feedback export
   ```

## What a mark does, and what it does not

A mark is kept in `.drift/feedback/marks.json`, on your machine. Nothing in Drift reads that file except `drift feedback export`. Marking a report wrong changes no verdict: `drift check`, the hooks and CI report it exactly as before.

If the code is fine as it is and Drift should stop reporting it, record an exception the usual way: `drift review --exempt <id> --member <path#symbol> --reason "..."`, or a `// drift-ignore <id>: <reason>` comment (`#` in Python) above the declaration. A mark marked wrong prints that command for you.

## The files

| File | What it holds | Shared? |
| --- | --- | --- |
| `.drift/feedback/marks.json` | Your marks: convention id, member, verdict, your reason, the rule kind and tier, whether the violation was legacy (in `drift.lock`), the day | No. The directory has a `.gitignore` of `*`, so `git add -A` does not commit it |
| `.drift/feedback/key` | 32 random bytes, made once, used to hash ids | Never. It is not written to the exported file |
| `.drift/feedback/drift-feedback.json` | The exported document (or the file you name with `--out`) | Only if you choose to send it |

The Claude Code hooks deny agent edits to everything under `.drift/`, these files included.

## What the exported file holds

Every field is listed here. Nothing else is written. Ids are replaced by a keyed hash (`h:` and 16 hex digits): a convention's id is itself a hash of its place, which names directories, so without a key someone could test a guess against it. With the key, which never leaves your machine, they cannot.

| Field | What it is | Why it is safe |
| --- | --- | --- |
| `schema`, `schema_version` | `drift-feedback`, and the version of the document's shape | Names the format only |
| `drift_version` | Drift's release version | The same for every user of a build |
| `formats` | The version of `.drift/conventions.yaml` in your repository, the newest Drift writes, and the marks file's version | Numbers |
| `repository` | A keyed hash of nothing | Lets the collector count teams without knowing which they are |
| `include_reasons` | Whether the marks' reasons are in the file | Tells a reader whether free text is present |
| `files_by_language` | How many files Drift read, by its language tag (`ts`, `tsx`, `py`, ...) | Numbers; no file is named |
| `files_not_read` | How many files Drift skipped | A number |
| `conventions[].id` | Keyed hash of the convention's id | See above |
| `conventions[].rule_kind` | The kind of rule (`wrapped_by:call`, `avoids:import`, `practice`, ...) | Drift's own words, never what the rule names (no wrapper, import or package) |
| `conventions[].language` | `ts` or `py` | |
| `conventions[].proposed_by`, `map` | `mined`, `promoted_hidden`, `promoted_practice`, or `from_map` with the map (`practice`, `layering`, `manifest`) | Drift's own words |
| `conventions[].tier`, `decision`, `mode` | `default` or `suggestion`; `accepted`, `declined` or `proposed`; `advise` or `block` | Drift's own words |
| `conventions[].at_acceptance` | Role size, holders and total when you accepted it (kept from the next `drift init` on) | Numbers |
| `conventions[].at_last_init` | The same counts as of the last `drift init` | Numbers |
| `conventions[].now` | For an accepted convention: members and holders now, how many members were not checked (Drift could not read them to the end), violations listed, how many of those are on new code, and whether it went stale | Numbers |
| `conventions[].exceptions`, `files_set_apart` | How many reviewer exceptions and set-apart files it has | Numbers |
| `marks[].convention` | Keyed hash of the convention's id (or of the finding's id) | Joins with `conventions[].id`; the member is never exported |
| `marks[].report`, `kind`, `tier` | `violation` or `finding`; the rule kind (or `finding:authn`, `authz`, `exposure`); the tier | Drift's own words |
| `marks[].verdict` | `true` or `wrong` | |
| `marks[].new_code` | Whether the violation was on new code (not in `drift.lock`) when you marked it | Yes or no |
| `marks[].day` | The day you marked it, `YYYY-MM-DD` | No finer time |
| `marks[].reason_given` | Whether you gave a reason | Yes or no |
| `marks[].reason` | Your reason as typed, **only** with `--include-reasons` | Free text can hold anything: read it before you share |
| `marks_by_kind` | Per rule kind: marked true, marked wrong, and how many of each were on new code | Numbers |
| `exceptions[]` | Per recorded exception: keyed hash of its convention, how it was recorded (`review`, `drift_ignore`, `different_kind`), and whether a reason was given | Never the member or the reason |
| `review_log` | Whether a review log was found; cards shown, accepted and declined, in all, by rule kind, by channel (how the convention was proposed) and by where the decision was made (`cli`, `interactive`, `studio`) | Numbers by Drift's own words |

A value Drift wrote that is not one of its own short words (a hand-edited marks file, a newer Drift's field) is written as `other`, or left out.

## What is never included

- No path, file name, symbol, package or dependency name, or route.
- No repository name, directory name or remote; no author or user name; no commit hash.
- No time finer than the day.
- No member of a mark or an exception, hashed or not.
- No reason for an exception. No reason for a mark unless you pass `--include-reasons`.
- No source code and no file contents.
- Not the hashing key.

The tests in `crates/drift-cli/tests/s23_feedback.rs` build a repository with distinctive names and check that none of them, and none of its raw convention ids, appears in the file.

## How to share it

1. Run `drift feedback export --dry-run`. It prints a plain summary of what the file holds and leaves out, then the whole document, and writes nothing.
2. Read it. If you passed `--include-reasons`, read the reasons in particular.
3. Run `drift feedback export` (or `--out FILE`). It prints the same summary and the path, then writes the file.
4. Send the file to the maintainers the way you choose: an email attachment, a shared drive. Drift does not send it.

Two exports of the same state are byte-identical, so you can compare what you sent with what you have. Each person's marks live in their own checkout; if several people mark, each exports their own file.

See also: [Security and Privacy](Security-and-Privacy), [Files Drift Writes](Files-Drift-Writes).
