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

> **Not yet released; not yet measured.** No version of Drift has been
> published. The lines below describe the code on the branch `map-to-enforcement`,
> which is not merged yet. It compiles and `cargo test --all` passes (2,461 tests),
> and what mining proposes was proved byte-identical to commit `a0779066` on seven
> real repositories; nothing in it has been measured for accuracy yet, so a line
> here says what the code does, not how often it is right. Accuracy figures are in
> [docs/ACCURACY.md](docs/ACCURACY.md); none of them covers the changes below.

0.1.0 is the first version. What it does as a whole (mining and review,
`drift check`, the practice map, the security inventory, the agent hooks and MCP
server, `drift setup`, `drift investigate` and `drift findings`) is described in
the [README](README.md) and the draft
[beta release notes](docs/RELEASE-NOTES-beta.md). The sections below list what
changed since those notes were written, for anyone who has run a build from the
main branch.

### Added

- **Drift Studio packages:** `apps/studio/scripts/package.mjs` builds an AppImage and a
  deb (Linux), a dmg and a zip (macOS arm64 and x64) and an NSIS installer (Windows),
  each carrying its platform's `drift`, which a packaged Studio runs unless Settings
  names another. Unsigned builds say `unsigned` in the file name; signing and
  notarisation read environment variables the owner sets
  ([apps/studio/README.md](apps/studio/README.md#packaging)). CI builds the Linux
  package on Studio pull requests (`.github/workflows/studio-package.yml`) and runs
  a live end-to-end test of the Electron app against a real `drift`
  (`apps/studio/tests/e2e/live.mjs`). No auto-update.
- **Drift Studio: proposals from the map, upgrade and feedback.** Three new views. Proposals from the map is a read-only view of `census --from-map --json`, linked to Conventions. Upgrade reads `upgrade --json` and can run `upgrade --apply [--security-baseline] --json` after you confirm, only for the work Drift lists as its own. Feedback lists `.drift/feedback/marks.json`. Check gains Mark true and Mark wrong on a violation (`feedback mark`). Nothing is sent, and the export stays a command you run. Setup questions still have no screen.
- **More Next.js entry points in `drift security` and the practice map** (the
  listed reading; mining is unchanged): inline server actions (a function whose
  own body starts with `"use server"`, such as one written inside a server
  component), each listed under its own symbol (`Page.save`) with only the
  guards its own body calls; Next.js 16's `proxy.ts` as the middleware;
  `getServerSideProps` as `GET` at its page's route; and route files under
  the extensions a literal `pageExtensions` adds (`route.mts`). TypeScript
  `LOWERING_VERSION` 87.
- **Studio: what a check rests on, and the security baseline.** The Check view
  lists, per accepted mined rule, the members that follow it, break it and were
  not checked (with why), and whether it is stale (`standing[]`); a departure's
  `drift practices promote` command, copyable; and in PR mode the security
  advice (`security_advice[]`) or, with a baseline, what is not in it. The
  Security view adds "Look at these first" (`drift security --top`), "Nothing
  reaches" (`unreached[]`), the entry points a change adds whose guard is
  unknown, shown as unknown (`guard_unknown[]`), and a confirmed, audited
  `drift security --write-baseline`.

- **`drift security --diff-base` compares every kind the security baseline
  holds,** by the key the baseline holds it under (JSON `added`, by kind; text
  `Other findings this change adds`): scope gaps, entry points that check
  nothing of a signed-in caller, unscoped keys, rows sent whole, CI workflows,
  dependencies and Kubernetes manifests, as well as the five it explained
  before. `--fail-on` takes every kind; a kind that could not be compared is
  said (`not_compared`) and fails a `--fail-on` that names it.
- **`drift security --format sarif`:** the inventory, `--diff-base` or
  `--ratchet` as SARIF 2.1.0, with the rules and locations of
  `drift check --format sarif`.
- **Findings a pull request baselines itself are listed.** `drift check
  --diff-base` lists each finding the change adds to the code and also writes
  into `.drift/security.lock` (text, `security.baselined_by_change`, a GitHub
  notice, a SARIF note). It fails nothing.
- **Studio, promote every form:** the promote dialog offers every form of
  `drift practices promote` (ways, mechanisms, any enforcing way; a directory, a
  file or a route prefix; advise, block, and `--force` after Drift refuses below
  the share), shows the exact command, disables what the command refuses with its
  own reason, and shows what a promotion replaces. Each practice on the May be
  promoted tab opens it pre-filled. The funnel and promotion fixtures are now
  written by the real binary (`apps/studio/scripts/make-promote-fixtures.mjs`).
- **Probation (experimental, `experimental: [probation]` in `.drift/config.yaml`):**
  `drift practices promote ... --block` where the history cannot be replayed (a
  shallow clone, no commits) accepts the practice in advise mode on probation and
  writes `.drift/probation.lock`; `drift check` and `drift practices promote --list`
  count the units added to its place since (`probation` in `--json`), and once 15 can
  be told and all follow, print `drift review --block <id>` for a person to run.
  Without the setting, a `--block` refused for want of history adds one line naming
  it, and in a shallow clone how to read the history (`fetch-depth: 0` in CI).
- **Python reports the routes it could not list** in `drift security` (text,
  `--json` `unlisted`, the MCP `drift_security` tool): a Django `path()` whose
  view is not found, is a package's or is computed, an `include()` of a module
  that is not there or made by a call, a URLconf `ROOT_URLCONF` does not reach, a
  DRF `register` of a viewset not found or at a computed prefix, a Flask
  `add_url_rule` or FastAPI `add_api_route` whose view is computed or not found,
  an `include_router` or `app.mount` of something made by a call, a Starlette
  table or entry not read, and a route decorator on a framework Drift has no
  adapter for. Each `unlisted` entry now has a `reason` (TypeScript's are
  `receiver_not_read`). Reporting only; mining is unchanged. Python lowering 75.

- **What a CI workflow or a deployed image leaves open.** `drift security`
  lists a workflow an outsider can start (`pull_request_target`,
  `workflow_run`, `issue_comment`) whose job states no `permissions:`, graded by
  what the job does with the outsider's input; a job on an event a fork can
  start that runs on a `self-hosted` runner (labels, groups and matrix values
  read; an expression is not checked); the final stage of an image a compose
  service builds that runs as root (no `USER` over a base image is not checked,
  never root); and a secret a workflow or a compose file hands to a build
  argument that the Dockerfile writes into `ENV` or a `RUN`. JSON:
  `workflow_hardening`, `image_hardening`, `hardening_not_checked`. They are the
  baseline kinds `workflow-hardening` and `image-hardening`, which advise until
  set to fail (`--fail-on`); the baseline stamp is now `# inventory: 3`, and a
  baseline an older Drift wrote does not start failing.
- **Python: Quart, django-ninja, Litestar and Sanic routes are listed** by
  `drift security`, with their prefixes and guards: Quart as Flask; django-ninja
  routers under the Django URLconf that mounts them, with `auth=` (nearest layer)
  as the guard, read as unknown; Litestar `route_handlers=`, controllers and
  `guards=` of every layer; Sanic blueprints, groups, `add_route` and request
  hooks. Listed reading only: what mining reads does not change.
- **CI other than GitHub Actions in the security inventory:** `drift security`
  reads GitLab CI (`.gitlab-ci.yml` and the files it includes from the
  repository), CircleCI, Azure Pipelines, Bitbucket Pipelines and the `sh` steps
  of a `Jenkinsfile` for the risks it reads in a GitHub workflow: a download
  piped into a shell, text a merge request's or a commit's author writes run as
  code, and another owner's include, orb or pipe named by a tag. They are
  `workflows` rows and baseline `workflow` findings. A CI file Drift cannot read
  (it does not parse, it is too large, a `Jenkinsfile` beyond its `sh` steps),
  a GitHub workflow included, is listed in the new `ci_not_read` of
  `security --json` and said in the text. The security inventory is now version
  3: a baseline stamped 2 does not fail on these findings where the pipeline did
  not change (they are new in this Drift until the baseline is written again).
- **Serverless functions and Workers are entry points.** `drift security`, the
  practice map and cards list the handlers a deployment file names, with the kind
  and route its trigger gives: Serverless Framework `serverless.yml` functions and
  their events, AWS SAM `AWS::Serverless::Function` resources, Cloudflare Workers
  (`wrangler.toml` / `.json` / `.jsonc`: `fetch`, `scheduled`, `queue`, `email`,
  Durable Objects), Netlify Functions and Vercel `api/` functions outside Next.js.
  A platform authorizer, API key or IAM authorization is named and leaves the
  guard unknown; a handler or value the file does not settle is listed under
  `unlisted` with its file and line. Listed reading only: mining is unchanged. The
  security baseline's inventory version is 3: against a baseline stamped 2, these
  new findings in unchanged code are held apart as new in Drift.
- **Exposure from hosting platforms' own files.** `drift security` reads Vercel (`vercel.json`), Netlify (`netlify.toml`), Fly.io (`fly.toml`), Render (`render.yaml`), Heroku (`Procfile` with `app.json`), App Engine (`app.yaml`), Cloud Run service YAML, AWS SAM templates, Serverless Framework (`serverless.yml`) and Cloudflare Workers (`wrangler.*`) for what they deploy and how it is reached: internet-facing where the file says the thing is served publicly, internal only on the file's proof (a Fly app with no service port, a Render private service or worker, a function with no HTTP event), unknown otherwise, each with the file and line. A unit is tied to its code by what the file says (root directory, a package its command selects, a file it names); a monorepo file that does not say which application it deploys stays unknown, `drift setup` asks (question kind `platform`), and `security.platforms` in `.drift/config.yaml` takes the answer. A file read to the end no longer keeps other routes from being called internal. `security --json` gains `boundaries.platforms`. No finding kind changes: a baseline written before stays as it was.

- **GraphQL operations outside NestJS are entry points.** Each root field
  (`Query`, `Mutation`, `Subscription`) of a resolver map given to Apollo Server,
  GraphQL Yoga, `makeExecutableSchema` or an Apollo subgraph, across files and
  through `mergeResolvers` and spreads, and each root field a Pothos, Nexus or
  TypeGraphQL schema adds, is a `graphql` entry point in `drift security` and the
  practice map, with its guards (wrappers, `graphql-shield` rules), its `args` as
  input and its body's checks. Not mined. TypeScript lowering version 87.
- **Routes of Elysia, hapi, Restify, h3 and Astro endpoints.** `drift security`
  and the practice map list them with their prefixes and mounts across files,
  what runs before each (a hook, a prerequisite, an extension, hapi's route
  authentication, an Astro middleware) read as a guard, and their request
  schemas as validation. What cannot be followed is unread, never "no guard".
  Mining is unchanged: they are in the listed reading only.
- **Exposure behind HAProxy, Envoy, Kong, Apache httpd and Traefik's file
  provider.** A compose service running one of them, with its configuration
  mounted or copied in from the repository, now decides each route behind it as
  nginx does: internet-facing where a rule provably carries it, internal where no
  rule can and everything was read, unknown otherwise, with the reason. Caddy
  snippets imported in the Caddyfile are read, and an nginx regular-expression
  location that is a plain anchored prefix (`~ ^/api/`) is evaluated. Before,
  every route behind these read unknown.
- **More Python servers and queues in `drift security`:** aiohttp, Tornado and
  Falcon routes, with their middleware, hooks and guards
  (`@tornado.web.authenticated`, `@falcon.before`); Django management commands
  as `cli`; Django Channels websocket routes; Huey and arq tasks as `job` and
  `cron`. Listed only: mining and `drift check` read none of it.
- **Guards before Koa, SvelteKit and Nitro routes are read:** `drift security`
  and the practice map now say guarded or no guard found for these routes
  instead of always unknown. Koa: `app.use`, `router.use`, `router.routes()`
  mounts and prefixes, `ctx.throw(401)` and `ctx.status = 401`. SvelteKit:
  `hooks.server` `handle` and `sequence(...)`, path tests with `startsWith`,
  and `+layout.server` loads for page loads only (never endpoints or form
  actions). Nitro: `server/middleware/` files and a route's `onRequest` hooks
  (a Nitro route no hook guards stays unknown).
  A hook Drift cannot read leaves the routes it may cover unknown. Mining is
  unchanged.
- **Vue, Svelte and Astro components are read.** The script blocks of `.vue`,
  `.svelte` and `.astro` files (Vue `<script>` and `<script setup>`, Svelte's
  instance and module scripts, Astro frontmatter and bundled `<script>` tags) are
  read as one module each, at the file's own lines, and a `.ts` import of a
  component resolves to it. They are in the listed reading only: `drift security`
  and the practice map read them, `drift scan --json` holds them under
  `listed_files` and `listed_skipped`, and mining proposes the same as without
  them. A component whose blocks cannot be delimited with certainty is skipped as
  `component_script`. Templates are not read. TypeScript lowering 87. The security
  baseline's inventory is 3: a risky operation in a component is new in Drift
  against an older `.drift/security.lock`, not a change's finding, where the file
  did not change.
- **Python GraphQL resolvers are entry points** (strawberry, graphene,
  ariadne): each root field of a schema Drift ties to its `Query`, `Mutation`
  and `Subscription` types is listed by `drift security` as kind `graphql`,
  `MUTATION Mutation.create_user`, with the field's permission classes (named,
  verdict unknown), the resolver's decorators and what the Django route serving
  the schema runs. A schema served by a route Drift does not read has every
  field's guard unknown. A schema whose roots cannot be tied lists nothing.
  Listed reading only; mined conventions are unchanged. Baselines in an older
  `drift.lock` hold the findings these entry points add.
- **Tenant scoping read in TypeScript as in Python:** a Prisma or Drizzle query
  filtered under a key named for a tenant now records where the value comes from
  (`scoped_queries` on the listed reading's symbols): the caller's (`orgId:
  req.user.orgId`, a claim of the verified token), what the request sent
  (`orgId: req.params.orgId`, a header), through a relation filter or an `AND`
  list, and Drizzle's `eq` / `and` in a `.where(...)` or a relational `where`.
  A route whose only authorization is a filter by the tenant the request names,
  and whose bodies were read to the end, now gets the `unscoped-key` finding
  (advice first); an Express handler whose only unrecorded calls write the
  response (`res.json(rows)`) is read to the end. TypeScript lowering 87; the
  security inventory is stamped 3, and findings these readings add to an
  unchanged repository are held as new in Drift. Mining is unchanged.

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
- **Proposals from the map.** `drift init` now also proposes rules that the
  practice map and the structure map show but that did not go through the
  miner's measured gates: a practice most units of a place follow, and a layer
  that never imports another (`<layer> never imports <target> (...; checked on
  imports by path that load code, not on type-only imports or imports by
  package name)`). Each is written `status: proposed`, `mode: advise`, labelled
  `from_map:` in `.drift/conventions.yaml`, and listed apart under `From the map
  (not mined: these did not go through the miner's measured gates; each advises
  only once you accept it)`, with how many units Drift could read follow it,
  how many differ, and how many it could not read (never reported). Nothing from
  the map is checked, baselined in `drift.lock` or shown to an agent until a
  person accepts it in `drift review`, which asks about these apart and says
  where each came from; accepted, it advises unless a person sets it to block. `drift init --no-from-map`
  writes none and removes the ones nobody decided.
  `drift census --from-map` lists the same, and what qualified but is not
  proposed, with why (JSON: `from_map`). It writes nothing.
- **Layering proposals count what Drift could not read.** A file of the layer
  that failed to parse, was skipped, or has an import Drift could not resolve
  counts toward no threshold, and the summary names how many (`N files of X not
  read`). A layer with too large a share of such files is not proposed.
- **A manifest rule from the map: code imports only declared packages.**
  `drift init` and `drift census --from-map` propose, for each workspace
  package whose `package.json` Drift read, `Code in <package> imports only the
  packages <package>/package.json declares (...)` (`from_map: manifest`, rule
  `imports_declared`), with today's undeclared imports counted and where each
  is declared instead; accepting records them in `drift.lock`. `drift check`
  names the import, the manifest that should declare it, where it is declared
  and the fix (`add lodash to apps/web/package.json`; JSON: `import.undeclared`).
  Built-ins, the package's own code, `@types/` for type-only imports and any
  dependency section count; unresolved imports, packages no manifest declares,
  unread manifests and test files are not checked. Python is not proposed, and
  the census says why. It is a suggestion; it blocks only when forced.
- **Promote by mechanism, by any enforcing way, in a file or under a route.**
  `drift practices promote` gains `--concern <ID>`, `--mechanism <NAME>` (a
  mechanism accepted whole, whichever instrument a unit names) and
  `--any-enforcing` (any way Drift reads as enforcing the concern; a route opened
  on purpose is not one); the variant id is then optional. `--in` also takes a
  unit's file (`in_file` in the policy) or a package and a route prefix,
  `<package>:/<prefix>` (`under_route`), each parameter matching any parameter;
  a unit whose route Drift did not read to the end is counted as not read,
  never as in or out. `--list --concern <ID>` lists one concern. New refusal
  codes: `nothing_accepted`, `unknown_concern`, `not_a_mechanism`,
  `no_enforcing`, `no_concern`. The JSON `candidate` gains `mechanisms`,
  `any_enforcing`, `unread_routes`, and `place.file` or `place.route`.
- **The command that promotes a departure.** Where `drift practices promote`
  would take a place's way as the code stands, a practice departure in
  `drift check` text, its GitHub notice and the job summary ends with `; to make
  it the rule for new code there: `drift practices promote <id> --in <place>``
  (JSON: `practices.departures[].promote`). Agents are not given it.
- **What each rule rests on.** After its new violations, `drift check` prints
  `drift: what each rule that reported a new violation rests on:`, with each
  rule's `source` (mined, promoted, or proposed from a map and accepted by a
  person), `evidence` (what the person saw when they accepted it beside what
  this check read), `changed`, `not checked`, and for a rule that blocks where
  it holds near the violation, how to record an exception and how to demote or
  reject it. The GitHub annotations carry the same as `Source:`, `Evidence:`,
  `Changed:` and `Not checked:` lines (and `Here:`, `Holds near it:`,
  `Exception:`, `Wrong rule:` for one that blocks), and the job summary under
  `### What each rule rests on`. `drift card` adds `Violations here (new: not in
  drift.lock, no drift-ignore), and what each rule rests on:` for the file. None
  of this changes a verdict or the exit code.
- **The security findings to look at first.** `drift security --top [N]`
  (default 10, 0 for all) ranks the findings where a request value reaches a
  risky operation, a remote caller reaches the entry point and Drift read what
  guards it; each says what a caller can do, what Drift read and what it did not
  read. A guard Drift could not read is never ranked; what is not ranked is
  counted, with why. JSON: `top`. `drift init` shows the first few under `From
  the security inventory (what Drift read; not conventions, and nothing here is
  checked)`. Neither changes an exit code.
- **Beta feedback:** `drift feedback mark <ID> [PATH#SYMBOL] --true|--wrong
  [--why]` records your verdict on a report in `.drift/feedback/marks.json`, and
  `drift feedback export [--out FILE] [--dry-run] [--include-reasons]` writes a
  file of counts and Drift's own words, with ids replaced by keyed hashes, that
  you can read before you choose to share it. A mark changes no verdict. It
  sends nothing. See [Beta feedback](docs/wiki/Beta-Feedback.md).
- **Hooks: the rules before an edit of an existing file.** Before an agent
  edits a file that exists, once the session has its baseline, the PreToolUse
  hook says the accepted rules for that file it has not said yet, those that
  block first, each marked where the file already breaks it. It reads the
  policy and the file's own facts and never scans the repository.
- **Hooks: two more facts after an edit.** PostToolUse says when an edit adds an
  entry point with no guard found while most of the other entry points of its
  kind around it carry one (with one to copy), and when an import makes the
  file's area depend on an area that imports it while it did not at session
  start. A departure that an accepted promoted practice shown to agents already
  covers is no longer said twice. Each message ends with what to do if the
  change is intended.
- **`drift census --gate-candidate <NAME>`** (hidden, for the study): runs a
  candidate change to one of mining's gates for that census only. A proposal
  only a candidate makes carries `gate_candidate` and advises only. Nothing is
  written, and no other command reads it.
- **`eval/scoreboard/`:** `scoreboard.py collect`, `score` and `diff` recompute
  the roadmap's scoreboard and the audit counts from saved outputs, and `diff`
  exits 1 when a guard regresses (plain `drift census` must stay byte-identical,
  and unknown must not rise without a matching fall). For contributors; it is
  not part of the `drift` binary.
- **MCP tool annotations, resources and prompts:** `drift mcp` now marks each
  tool with `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint` and
  `openWorldHint` (from protocol `2025-03-26` on); `readOnlyHint` is true for
  exactly the tools the hook approves without a prompt. It offers the resources
  `drift://rules` (accepted rules shown to agents only, never a proposal),
  `drift://security` and the template `drift://card/{path}`, and the prompts
  `drift_before_edit`, `drift_review_change` and `drift_first_setup`. A client
  that asked for `resources/list` before got `-32601`; it now gets the list.
- **Drift checks its own repository:** `.drift/conventions.yaml` and
  `drift.lock` are committed as `drift init` wrote them, with every proposal
  undecided and no security baseline; a root `.ignore` leaves fixtures, the
  planted security test code and held-out evaluation data out of the scan. CI
  runs `drift check --diff-base <base commit>` on every pull request (the whole
  repository on other events) with the binary the `oracle` job builds, and a new
  `harness` job runs the Python harness tests (`eval/scoreboard`,
  `eval/benchmark`) and `scripts/snapshot-test.sh`. For contributors; nothing
  changes in the `drift` binary.
- **Release rehearsal:** the release workflow can be run by hand (`gh workflow
  run release.yml`, `dry_run` on by default): it builds the five targets, the
  archives and `SHA256SUMS`, packs the npm packages and installs them on Linux
  x64 and arm64, macOS and Windows, keeps all of it as workflow artifacts, and
  publishes nothing. Only a pushed `vX.Y.Z` tag releases. npm now publishes the
  exact tarballs that were install-tested. `node npm/set-version.mjs --check`
  lists every file whose version disagrees. Archive, checksum and package names
  are unchanged. For maintainers; nothing in the `drift` binary changed.
- **`eval/scoreboard/` after score:** `after/score.json` scores this build
  on the seven repositories, and `RESULTS.md` sets the eight scoreboard numbers
  before against after, says what each still needs (labels, a replay, `drift
  check` runs, a release-build timing), and classifies the two guard trips unit
  by unit. Harness version 2 (`harness_version` in every score) reads the map's
  proposals from `from_map` (version 1 counted none) and unscoped keys from the
  authz rows. `score --no-timing` marks timings n/a. `diff` names a repository
  scored on one side only, and says when the two sides were scored by different
  harness versions.

- **The GitHub Action has outputs, one comment kept up to date, and an optional
  status.** Outputs `exit-code`, `block`, `advise`, `security-findings`,
  `security-advice`, `unchecked`, `report`, `sarif`, `drift-path`,
  `drift-commit` and `installed-from`, counted from `drift check --format json`.
  `comment: "true"` keeps one pull request comment (found by a hidden marker,
  edited on every push, marked resolved when nothing is left) listing new
  convention violations and security findings with file and line, capped, with
  repository text escaped. `status: commit | check` posts a commit status or a
  check run named `drift` (`status-name`) for branch protection; off by default.
  New inputs `working-directory`, `comment-limit` and `install-only`;
  `upload-sarif: file` writes the SARIF without uploading it. The logic is in
  `scripts/action/`, tested by `scripts/action/test.sh`, and CI runs `uses: ./`
  on a fixture repository. See [Drift in CI](docs/wiki/Drift-in-CI.md#the-github-action).
- **Python: env reads through python-decouple, environs, django-environ and
  pydantic settings classes** (Python lowering 75). `drift security` lists them
  under environment reads (`decouple.SECRET_KEY`, `environs.PORT`,
  `environ.DATABASE_URL`, `pydantic_settings.APP_DATABASE_URL`, with environs'
  `prefixed` blocks and pydantic's `env_prefix` applied), and the practice map's
  `config` concern counts each such read as that library's env schema
  (`env_schema:environ`), never as a read of `os.environ` in place. A module
  constant read this way is a value from the environment where a check compares
  with it. Mining is unchanged.
- **Rules from more linter configurations:** `drift census --from-map` and
  `drift init` now also read the import restrictions of an ESLint flat config's
  blocks scoped by a literal `files` (and a legacy `.eslintrc.js`'s
  `overrides`), ruff's `banned-api` and `ban-relative-imports`,
  flake8-tidy-imports' `banned-modules`, and import-linter contracts. Each is
  listed with the file and line that declare it (`declared.at` in `--json`); a
  folder-to-layer restriction Drift can check exactly is proposed (advise, shown
  to no agent until accepted), and the rest is listed with why (a package
  outside the repository, a contract that forbids indirect imports too, a block
  built by code Drift does not read, one a later setting changes). Mining reads
  none of it.
- **Exposure from Kubernetes manifests:** `drift security` reads an `Ingress`, a
  Gateway API route, an OpenShift `Route` or a `LoadBalancer`/`NodePort` Service
  through its Service's selector to a workload, and a route of the code that
  workload runs is internet-facing, internal or unknown with the manifest file
  and line in its reason. A route that read unknown only because manifests were
  there may now read either way. A workload is tied to code by an image the
  repository builds (compose `build` with `image`, a Skaffold artifact) or by
  `security.kubernetes` in `.drift/config.yaml`, which `drift setup` asks for
  (question kind `kubernetes`). Kustomize `resources` and `bases` are read; a
  patch, a name prefix or an unread key makes what it touches unknown, and Helm
  charts stay unread. The security baseline is unchanged.

### Changed: the files Drift writes

- **Breaking: a promoted practice is a new rule type in
  `.drift/conventions.yaml`.** A Drift from before promotion cannot read a file
  that holds one at all: every command that reads the policy stops with a parse
  error, exit 2. A practice of named ways in a package or a directory leaves the
  file's `version:` as it was. Upgrade every machine and CI before the first
  promotion; see
  [Versioning and upgrades](docs/wiki/Versioning-and-Upgrades.md#promoted-practices-and-older-drift).
- **Breaking: `.drift/conventions.yaml` version 4.** A manifest rule
  (`imports_declared`) makes the file `version: 4`; a Drift that reads up to 3
  refuses it with the upgrade message. Any other file is written as before.
  This Drift reads versions 1 to 4.
- **Breaking: `.drift/conventions.yaml` version 3.** A promoted practice that
  accepts a mechanism whole (`any_mechanism`), any enforcing way
  (`any_enforcing`), or holds in one file (`in_file`) or under a route prefix
  (`under_route`) makes the file `version: 3`. A Drift that reads up to version
  2 would check such a rule as a narrower or wider one, so it refuses the file
  (`was written by a newer Drift`) instead. Any other file is written as
  before, byte for byte, and goes back down when the last such practice is
  removed. `from_map` and `accepted_evidence` do not raise the version. This
  Drift reads versions 1 to 3; it reads the version before the rest of the
  file, so a newer file gets `<file> was written by a newer Drift (policy format
  N; this Drift reads up to 3). Upgrade Drift ...`, not a parse error, and the
  hooks tell an agent `no convention is shown to agents until then`. Upgrade
  every machine and CI before promoting one of these forms.
- **`drift.lock` gains a fingerprint line per violation it baselines,** right
  below its member line: `#~ <convention id> <fingerprint> <path#symbol>`, where
  the fingerprint is 16 hexadecimal characters computed from what the member is
  (its kind, wrappers, calls and other facts), not from where it is. It is a
  comment, so a Drift from before this change skips it and reads the lock as
  before. A lock written before has no such lines and works as before. A line
  in the earlier form `<convention id> ~<fingerprint> <path#symbol>` is still
  read, and never written.
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
- **`.drift/feedback/`** is new, written only by `drift feedback`: the marks,
  the key that hashes ids, and the exported file. It is created with its own
  `.gitignore` of `*`; commit none of it.
- **`.drift/conventions.yaml`: a new field `from_map`** (`practice`,
  `layering` or `manifest`) on a convention proposed from a map. An older Drift
  ignores it and drops it if it rewrites the file; the proposal then reads as
  mined.

### Changed: behaviour an existing user will notice

- **The newer route adapters follow each package's published source.** Checked
  against quart 0.23.1, django-ninja 1.8.0, litestar 2.25.0, sanic 25.12.1,
  aiohttp 3.14.5, tornado 6.6.1, falcon 4.4.0, channels 4.3.2, huey 3.5.4,
  arq 0.28.0, elysia 1.4.32, @hapi/hapi 21.4.13, restify 12.1.0, h3 1.15.11 and
  astro 7.4.12, `drift security` now reads: django-ninja's `add_router(auth=...)`
  over the router's own `auth=`; `Litestar([...])` and `Router("/x", ...)` given
  by position, and a handler's `middleware=` as unknown; Sanic `add_route` as
  `GET` where no methods are given, and a group mounted with `url_prefix=` under
  both prefixes; Quart websockets guarded by `before_websocket`, not
  `before_request`; aiohttp `app.router.add_routes`; Falcon's
  `process_request_async`; Huey `context_task` and `on_commit_task`; arq
  `Worker([...])`; Elysia `mapDerive`, `mapResolve`, `.as("scoped")`, a
  websocket's `upgrade` and a guard's `schema`; hapi's default authentication
  for routes added before it, and what a plugin of the repository sets on the
  server as unknown for every route of it (some routes that read "no guard"
  now read unknown); Restify `server.param` (and no `server.delete`); Astro
  endpoint files starting with `_`, and Astro's own segment rules. Listed
  reading only. Lowering versions: TypeScript 88, Python 76.

- **Breaking: the GitHub Action runs the Drift of its own ref, and installs a
  release binary when there is one.** `drift-ref` now defaults to empty, which
  runs the Drift of the ref the Action is used at (`uses: dadbodgeoff/drift@<ref>`)
  instead of building `main`. A workflow that pinned the Action but relied on
  the `main` default now runs the pinned version; set `drift-ref: main` to keep
  the old behaviour. For a release tag (or a commit one points at) the Action
  downloads the release archive, checks it against `SHA256SUMS` and its
  `drift --version` against the tag, and fails the job if either does not match;
  otherwise it builds from source with the cargo registry and build output
  cached by commit, instead of `cargo install`. A `drift` already on the
  runner's `PATH` is no longer used in place of the requested one.
- **The Action's comment covers conventions too, and is edited instead of
  added.** `security-comment: "true"` is now the earlier name of `comment`:
  the one comment it keeps lists new convention violations as well as security
  findings, and no longer adds a copy on every push. A comment the earlier
  Action posted is adopted and edited.

- **Native Windows: the agent hooks read Windows paths.** A shell command that
  writes to `.drift/` or `drift.lock` is denied however Windows spells the path
  (`C:\repo\.drift`, `C:/repo`, `\\?\C:\…`, a `\\server\share`, Git Bash's
  `/c/repo`, a quoted `.drift\x`, `.DRIFT`, `drift.lock.`) and whichever way the
  program is named (`rm.exe`); before, those were let through. A policy change run
  as `drift.exe`, through the npm shim `drift.cmd`, or inside `cmd /c` or
  `powershell -Command` is denied as `drift` is. A `drift.lock` saved with a
  UTF-8 byte-order mark reads as without it (before, an entry on its first line was
  lost), and a `.drift/security.lock` checked out with CRLF line endings is no
  longer taken for a changed file. The Windows executable asks for the 8 MiB
  main-thread stack Linux and macOS give: with Windows' default 1 MiB every
  command that mines (`init`, `census`, `setup`, `practices`, `security`) died
  of a stack overflow with no output. The Windows CI job runs every test binary
  (`--no-fail-fast`); it still never fails the run.
- **tRPC procedures are listed at their dotted path.** `drift security` and the
  practice map name a procedure by the keys of the routers it is mounted through
  (`viewer.me.get`, once per path for a router mounted twice), across files and
  through `mergeRouters`, spreads, named procedures and `lazy` routers; `?` marks
  what is not read (`admin.?.tick` for a computed key, `?.ping` for a router
  nothing mounts). Mining still reads the key alone. `drift practices promote
  --in '<package>:/user.'` holds the procedures under `user.`. The security
  baseline is now `# inventory: 3`: against an older one, a procedure's finding
  re-keyed by its path in a file that did not change is new in this Drift and
  fails nothing until the baseline is written again.

- **`drift security --diff-base` decides what a change added as `drift check`
  does against the baseline.** `--fail-on` counts every finding of the kinds
  named that the merge base did not have, by its baseline key: `--fail-on
  no-guard` now also fails on a guard taken off a route that was there, and a
  signed-in route that checks nothing of who calls is listed as
  `no-authorization`. A row of the explained sections whose finding the merge
  base already had is no longer listed. The SARIF rules `drift-security/<kind>`
  now describe the kind (`Security: <what> (<kind>)`) rather than "not in the
  baseline", since `drift security --format sarif` writes them too.
- **Hooks do less work for the same answers.** Each hook reads
  `.drift/config.yaml` and `.drift/conventions.yaml` once (it read the config up
  to five times) and scans the repository at most once: a PostToolUse that needs
  the repository, and SessionStart with `agents.verify: on`, scanned twice.
  `DRIFT_HOOK_TRACE` lines gain `work`, counts of walks, files read and parsed,
  scans and config reads. Session state is saved under an operating-system lock
  on `.<session>.json.flock`, so a hook killed while saving no longer makes the
  next hooks of the session wait and save unlocked for 10 s, and a lock is never
  taken over from a hook that still holds it.
- **Drift's own files are never read or written through a link that leaves the
  repository.** `drift security --write-baseline` now refuses such a link at
  `.drift/security.lock` as every other writer does; a final link to a file that
  does not exist is refused instead of being replaced by a regular file; and
  `drift check` and `drift security --ratchet` exit 2, naming the path, when
  `.drift/security.lock`, `drift.lock`, `.drift/conventions.yaml` or
  `.drift/config.yaml` is a link that leads outside the repository or to nothing
  (before, they read the outside file, or took a dangling baseline as none). A
  link inside the repository still works. Every command Drift prints quotes each
  id, path and member taken from the repository as one shell word (`drift review
  --show` cards, `--exempt` hints, stale-rule lines, `drift practices promote`
  lines, `drift setup` and `drift findings` messages).
- **Three readings of this release that were wrong on real repositories are put
  right.** A check that answers 401 signs the caller in, in the practice map, only
  where what it tests can be the caller's: one on what the request sent (an empty
  new password, a CAPTCHA answer and the stored answer it must match) is input
  validation, and leaves the route unknown rather than signed in.
  What a query found by a route parameter is no longer taken for the input handed
  to a package's call, so such a loader reads "reads input, nothing validates it"
  again. In `drift security`, a route whose handler is one function a constructor
  function assigns on `this` reaches what that function calls, and a call through
  an instance it builds reaches the method called, not every method of the object.
- **Promoted practices and the readings under them no longer say "followed" or
  "guarded" of code they never saw guarded.** A route practice (`--in
  <package>:/<prefix>`) is no longer shown as a rule for a file whose entry points
  are all served at no route (a module of Next.js server actions, a middleware):
  `drift example`, `drift card`, the MCP tools and the hooks stop listing it there.
  A server action (or any unit of a kind served at no route) under a practice only
  a route can follow (the middleware) is now not checked, counted, instead of a
  violation. A FastAPI dependency that looks the caller up in a value the route's
  path does not declare, or in a value the facts do not name, is now a membership
  check found and not proven (unknown) instead of `known membership_guard`. A
  Python 401 on a value of the module (a constant, a name bound to an environment
  read, a field of a module object) is now unknown instead of sign-in. Each can
  only turn a "follows" or a "known" into "not checked" or unknown: no new
  violation, and a `drift.lock` line of a unit now not checked is kept.
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
- **The `drift init` screen** shows, after what the code does, the security
  findings to look at first, and, after the conventions, the proposals from the
  map.
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
- **The wiki matches the code again, and a test keeps it so.** The Command
  Reference documents `drift upgrade`, exit codes 3 and 141, the guided
  `drift setup` (`--guided`, `--yes-to`, `--no-to`, `--no-from-map`) and
  `drift investigate --routes`; the Configuration Reference, policy version 3,
  the `from_map` field and `DRIFT_NO_FROM_MAP`; the Hooks and MCP pages, the ten
  read-only tools the hook approves; and the lowering versions are current. A
  test (`gap_docs_sync`) fails when a command or flag `--help` prints, an exit
  code, a version constant or the read-only tool list is missing from the pages.
