# Labelling replayed reports

You are given a file of reports, one JSON object per line. Each is something `drift check` (or `drift security --diff-base`) said about code a team actually wrote, at the commit where they wrote it. Your job is to say, for each one, whether the report is right.

You did not write the tool and you do not need to know how it works. You never learn which build of the tool produced a report, and you should not try to find out: two builds' reports are mixed and shuffled in one file, and the same report from two builds appears once.

## What each line holds

| field | what it is |
|---|---|
| `item` | an opaque id; keep it as it is |
| `kind` | the kind of rule (for example `practice:errors`, `avoids:import`, `security:added_without_guard`) |
| `repo`, `commit`, `file`, `line`, `unit` | where the report points: the repository, the commit that made the change, the file, the line and the declaration (`unit`) |
| `unit_age` | `new` (the unit was added by this change) or `edited` (an existing unit the change edited) |
| `report` | what the tool said, word for word |
| `excerpt` | the code at that commit. Columns: line number, `>` on the lines of the unit, `+` on lines this change added or changed, then the code. It is capped at 60 lines; `excerpt_truncated` says when it was cut |
| `later_touch`, `later_commit` | whether the team changed this unit again later, and in which commit. A unit the team rewrote soon after can be evidence the report was real, but often is not: read it, do not count it |
| `label`, `note` | yours to fill |

You may open the repository at `commit` to read more (the file, the files it imports, the sibling files the report compares it with). Read as much as you need. Do not run the repository's code or scripts.

## The three labels

Write exactly one of these in `label`, and one sentence in `note` saying why.

### `true`: a true departure

The code really does not do what the rule says, and the rule is one this codebase follows: a reviewer who knows the codebase would ask the author to change it, or at least to say why not.

- *Example 1.* The rule says "HTTP handlers in `app/routes/**` check the signed-in user with `requireUserId()` (20/21)". The new `action` in `app/routes/settings+/delete-account.tsx` reads `request.formData()` and deletes rows with no call to `requireUserId` or anything like it. Label `true`: a new handler that changes data skips the check its siblings make.
- *Example 2.* The rule says "Errors in the root package are handled app-wide by `errorHandler`". The change adds a router in a new file that is mounted before `errorHandler` is registered, so errors thrown there escape it (you can see the `app.use` order in the excerpt or the server file). Label `true`.

### `public`: departs on purpose

The code does depart from the rule, the tool read it correctly, but the departure is deliberate and right: the unit is meant to be different.

- *Example 1.* The rule says routes check the signed-in user, and the new unit is `loader` in `app/routes/_auth+/login.tsx` or a health check at `/healthz`. A login page and a health check must be reachable without signing in. Label `public`.
- *Example 2.* The report says a new entry point has no guard (`security:added_without_guard`), and the unit is a webhook receiver that checks a signature header (`stripe.webhooks.constructEvent(...)`) instead of a user session, or a lab in a deliberately vulnerable training app whose comment says it is meant to be exploitable. Label `public`: it is meant to be open to unsigned callers, or meant to be wrong.

Use `public` only when you can say *why* it is meant to differ. "It works anyway" is not a reason.

### `misread`: Drift misread the code

The report is wrong about the code itself: the unit does follow the rule, or the rule does not apply to it at all.

- *Example 1.* The report says `POST /api/notes` has no guard, but the excerpt shows the handler wrapped as `export const action = withAuth(async (...) => ...)` (or the router applies `router.use(requireAuth)` two lines above). The guard is there; the tool did not see it. Label `misread`.
- *Example 2.* The report says a symbol "does not log via `console`", but the unit is a type alias, a constant, or test fixture data, where logging means nothing; or the report points at a line that is not the code it names (an import, a blank line, the wrong function). Label `misread`.

## When you are unsure

- Read more first: the sibling files the rule compares the unit with, and the file the report says to copy.
- If after ten minutes you still cannot tell between two labels, write `unsure` in `label` and say in `note` which two labels you are between and what would decide it. `unsure` is counted as unlabelled: it lowers the labelled count, never the true share.
- If the rule itself makes no sense to you (you cannot say what it asks for), that is `misread` when the code clearly does what its neighbours do, and `unsure` otherwise.
- Do not label by the kind of rule, by how many reports a commit has, or by `later_touch`. Each report on its own.
- Do not change any other field. Score with `python3 -I eval/replay/replay.py score --labels <your file>`.
