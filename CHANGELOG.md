# Changelog

Every change a user of Drift can see is recorded here: a new command or flag, a
changed output, a change to a file Drift writes, and anything that behaves
differently for someone who already uses Drift. The layout follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/).

**Before 1.0, any release may break something.** Every such change is listed
under **Changed** and starts with **Breaking:**, with what to do about it. No
breaking change ships without a line here.

The rule for contributors: a pull request that changes what a user sees adds its
line under `Unreleased` in the same pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md#changelog).

## [Unreleased]: 0.1.0

> **Not yet released; not yet built or measured.** No version of Drift has been
> published. The lines below describe the code on the main branch. Much of it was
> written in parallel and has not yet been compiled, tested or run on real
> repositories as a whole, so a line here says what the code is written to do,
> not what was measured. Accuracy figures are in [docs/ACCURACY.md](docs/ACCURACY.md);
> none of them covers the changes below.

0.1.0 is the first version. What it does as a whole (mining and review,
`drift check`, the practice map, the security inventory, the agent hooks and MCP
server, `drift setup`, `drift investigate` and `drift findings`) is described in
the [README](README.md) and the draft
[beta release notes](docs/RELEASE-NOTES-beta.md). The sections below list what
changed since those notes were written, for anyone who has run a build from the
main branch.

### Added

- **Make a practice the rule for new code:** `drift practices promote <P-id>`
  with `--in`, `--with`, `--block`, `--force`, `--dry-run`, `--json` and
  `--list`. It writes one accepted convention of rule kind `practice`, in advise
  mode unless `--block` is given and allowed, and baselines in `drift.lock` the units of the place that differ today.
  `drift review` offers the practices that qualify after the proposals.
- **A first screen that says what the code does.** `drift init` now opens with
  what it read, what the code does (the largest kinds of entry point, with
  counts), at most five findings worth a look first, then the conventions, the
  files written and the next steps. The long account of what the show policy
  held back is behind `drift init --explain`.
- **`drift init` offers the security baseline** where the repository has none:
  it says how many findings the baseline would hold, by kind, and the command
  that writes it (`drift security --write-baseline`). It never writes it.
- **`drift census --why [GATE]`** lists what each gate of mining dropped and
  why, with `--json` for every dropped candidate. It is observation only: what
  is proposed does not change.
- **What an accepted mined rule could not check.** `drift check` says, for each
  accepted mined convention, how many members it did not check because Drift
  could not read what decides the rule for them, with up to three reasons; the
  JSON lists them all under `standing`.
- **Security advice on a pull request with no baseline.** Where there is no
  `.drift/security.lock`, `drift check --diff-base` lists what the change adds
  that a baseline would hold (new entry points where no guard was found, those
  that reach an operation fed by the request, those that take a tenant or owner
  key nothing checks) under a heading of its own. It never changes the exit
  code. JSON: `security_advice`; SARIF: a note per item.
- **A new kind of security finding, `unscoped-key`:** an entry point that signs
  the caller in and takes a tenant or owner key from the request that nothing
  it runs checks or scopes a query by. It advises in `drift check` until a
  person sets it to fail.
- **`drift security --write-baseline --fail-on <kind>`** sets the named kinds to
  fail `drift check`. The choice is kept when the baseline is written again.
  `--fail-on public` is refused here (it is read against a commit).
- **`drift-ignore` for a file, a model or a package.** A
  `drift-ignore <id>: <reason>` comment in a file's header (the comments before
  its first line of code) suppresses that convention's file-level violations in
  the file. For a layering violation the comment may also go on the line of the
  import, or directly above it; for a model, directly above its declaration. A
  manifest that cannot hold a comment (`package.json`) is never offered one.

### Changed: the files Drift writes

- **Breaking: a promoted practice is a new rule type in
  `.drift/conventions.yaml`.** A Drift from before promotion cannot read a file
  that holds one at all: every command that reads the policy stops with a parse
  error, exit 2. The file's `version:` does not change. Upgrade every machine
  and CI before the first promotion; see
  [Versioning and upgrades](docs/wiki/Versioning-and-Upgrades.md#promoted-practices-and-older-drift).
- **`drift.lock` gains a second line per violation it baselines:**
  `<convention id> ~<fingerprint> <path#symbol>`, where the fingerprint is 16
  hexadecimal characters computed from what the member is (its kind, wrappers,
  calls and other facts), not from where it is. A lock written before has no
  such lines and works as before. Both kinds of line are plain lines of one
  sorted set, so `drift.lock merge=union` stays safe.
  **Breaking:** a Drift from before this change reads each fingerprint line as
  one more entry that matches nothing, so its `drift check --format json` lists
  those lines as `fixed`. Do not remove them; upgrade every machine and CI
  together.
- **`.drift/conventions.yaml`: a new field `accepted_evidence`** on an accepted
  convention (`role_size`, `holders`, `total`, `lower_bound`): the evidence the
  file held when `drift init` first ran over the convention as accepted. It is
  written once and not refreshed, so a later reader can see how the role has
  changed since a person accepted it. It is absent until then, so a file written
  before is written as before. An older Drift ignores the field and drops it if
  it rewrites the file.
- **`.drift/conventions.yaml`: decided conventions are ordered by id.** Accepted
  conventions come first, then proposed, then rejected, as before; accepted and
  rejected ones are now ordered by id alone, not by the strength of their
  evidence, so a run that only refreshes evidence moves no line of what people
  decided. Proposals stay strongest first. The first `drift init` after
  upgrading may reorder the file once.
- **`.drift/security.lock` gains two header lines** after the three comment
  lines it had: `# inventory: 2` (which version of the inventory wrote it) and
  `# fail: <kinds>` (the kinds whose new findings fail `drift check`,
  comma-separated and sorted). A new baseline sets every kind to fail except
  `unscoped-key`. A baseline written before has neither line: it is read as
  inventory 1, its kinds fail as they did, and a finding of a kind newer than
  it is reported as new in this version of Drift and fails nothing until the
  baseline is written again.

### Changed: behaviour an existing user will notice

- **Breaking: `drift init` no longer baselines violations of a convention the
  policy already had.** Before, re-running `drift init` baselined the current
  violations of every convention that had no line left in `drift.lock`, so a
  convention whose old debt had all been fixed got its new violations recorded
  as legacy. Now only a convention new to the policy is baselined; a violation
  of an existing convention written since is reported as new.
- **A moved or renamed file is no longer new debt.** When a baselined member is
  no longer at its `path#symbol` and a violation of the same convention has the
  same fingerprint, that violation stays baselined, one lock line for one
  violation (a copy beside the original is new). A reviewer's exception follows
  the member in the same way. This needs the fingerprint lines above, so it
  works for debt baselined by this version on; existing lines gain their
  fingerprint the next time `drift init` runs.
- **A decision follows its convention when the rule gains an alternative.**
  When `drift init` mines an accepted wrapper rule again with more wrappers than
  before (a second wrapper beside the first), its id changes; the new id now
  takes over the person's decision (status, mode, the agents choice, files set
  apart, exceptions, accepted evidence) and its lines in `drift.lock`, and the
  old id leaves the file.
- **An accepted mined rule answers "holds", "breaks" or "cannot tell".** A
  member whose deciding fact Drift did not read (a wrapper that does not resolve
  to code Drift read, a wrapper built by a factory call, a call the facts do not
  record) is counted as not checked and never reported as a violation. Mining
  itself is unchanged.
- **A stale mined rule advises.** When an accepted mined rule's role now holds
  fewer than 8 members, or fewer than 75% of the members Drift can tell follow
  it, `drift check` says it is stale and checks it in advise mode while it is
  stale, even if it is set to block, and offers `drift review --advise <id>`
  and `drift review --reject <id>`. A convention set to block that is checked in
  advise mode says `was block, now advise because ...`.
- **A layering violation also prints a `like` line:** a file of its role that
  imports nothing it should not.
- **Agent messages list block-mode violations first.** When more violations
  exist than an agent message shows, the ones that block are never the ones cut
  off, and the last line says how many of each mode were left out.
- **An entry point whose guard cannot be read is "guard unknown", not "no
  guard".** `drift security --diff-base` lists it apart and does not count it
  under `--fail-on no-guard`. The GitHub Action's optional security comment now
  posts for a new entry point with no guard found, and not for one whose guard
  is unknown.
- **`drift practices promote` refuses a place that overlaps** another promoted
  practice of the same concern, as `drift review` already did, and writes
  nothing. Promoting again a practice that blocked runs the block gate again; if
  the gate no longer allows it, it advises and says so.
- **The hook's one-file check stays one file** for an edit outside every
  promoted practice's place.
- **`drift init` counts violations, not lock lines**, in
  `(N existing violations recorded, ...)`.
- **The practice map and the security inventory read more of the code.** These
  readings are made only where the practice map, the security inventory and
  promoted practices read; what `drift census` and `drift init` mine is
  unchanged. TypeScript and JavaScript: a `return next(err)` on the branch
  where no caller is signed in turns the request away; a package call handed
  request data and a schema is validation (`schema:<library>`); a database client
  generated from the repository's Prisma schema is read as data access; members of object
  literals and constructor functions are members with bodies;
  `catch (e) { next(e) }` hands the error on; a class that refuses with a single
  401 or 403 status says so; routes mounted through a factory call are listed;
  the security reach follows a wrapper call and the argument that feeds a risky
  operation. Python: `permission_classes` on a class that is not a Django REST
  framework view is not counted as a check; a `raise` inside `except` no longer
  marks the code after it as skipped; typed parameters and a FastAPI return
  annotation are read as validation and as the response model. Authorization:
  the tenant and owner keys a repository scopes by are learned from its own
  queries. Each of these can change what `drift practices`, `drift security` and
  a promoted practice report on the same code.
