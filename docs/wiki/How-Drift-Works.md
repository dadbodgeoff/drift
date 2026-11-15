# How Drift Works

This page explains the pipeline from your files to Drift's answers, what the cache does, what "proven" means, and what `known`, `none` and `unknown` mean, including why `unknown` is common and what to do about it. It is for anyone who needs to read Drift's answers correctly, and for reviewers who want to know what Drift does before they trust it.

## The pipeline

```
files -> scan -> per-file facts -> linking -> structure and roles
      -> mining -> conventions            (drift init, census, review, check)
      -> practice map                     (drift practices, drift card)
      -> security inventory               (drift security, drift card)
```

1. **Scan.** Drift walks the working tree. It respects `.gitignore` and `.ignore` files, skips dependency and build-output directories, never follows symlinks out of the repository, skips files over 1 MB, declaration files, and generated and minified code, and never runs repository scripts. `drift scan` prints the summary (files, parse errors, skipped files, symbols, entry points, imports and how many resolved).
2. **Facts, per file.** Each TypeScript, JavaScript and Python file is parsed on its own and "lowered" into language-neutral facts: its symbols, imports and exports, wrappers and decorators, calls, argument keys, control flow, environment reads, thrown classes, risky operations and entry points (HTTP routes, jobs, queues, commands). This step depends only on the file's text, so its output is cached by content hash. TypeScript and JavaScript use one parser and Python another; each language has its own framework adapters. [Languages and Frameworks](Languages-and-Frameworks) lists what is read.
3. **Linking.** Facts that name something imported are resolved across files: through `tsconfig` `paths`, workspace packages and barrel files for TypeScript, and import resolution for Python, so that a call to `withAuth` in a route file is tied to its definition.
4. **Structure and roles.** Drift finds the packages (directories with a `package.json`, `pyproject.toml`, `setup.cfg`, `setup.py` or `requirements*.txt`), their layers, and *roles*: groups of similar things that live together, such as "HTTP handlers in `app/api/**`" or "functions in `lib/**`". Roles come from structure only: package, directory prefix, kind of file, entry-point kind and symbol kind. `drift map` prints this and changes nothing.
5. **Mining.** Within each role, Drift looks for a pattern that nearly all members share and the rest of the code does not. See [Conventions and Review](Conventions-and-Review).
6. **The practice map.** For each cross-cutting concern, Drift reads what each entry point does and groups the entry points by variant. See [Practices Map](Practices-Map).
7. **The security inventory.** Drift lists entry points with their guards, the risky operations they reach, and where each can be reached from. See [Security Inventory](Security-Inventory).

What the fact layer records, for TypeScript and JavaScript (Python has its own adapters; see [Languages and Frameworks](Languages-and-Frameworks) and [PYTHON.md](https://github.com/dadbodgeoff/drift/blob/main/docs/v2/PYTHON.md)): imports and exports resolved through `tsconfig` `paths`, workspace packages and barrel files; wrappers, decorators, `extends`, JSX layout wrappers and `try` bodies; calls, rendered components, argument keys and control flow; environment reads, thrown classes, call order and risky operations; entry points for Next.js, Express, Hono, Fastify, NestJS (HTTP, GraphQL, cron, queues), tRPC, Inngest, Trigger.dev and BullMQ; and, per repository, which files have tests, client files reaching server code, Prisma, Drizzle and SQL models, workspace package config and the linter settings Drift relates to its conventions. Facts are cached by content hash, and an index of file stamps in `.drift/cache` lets later scans read only the files that changed; `drift hook` uses it to check one edited TypeScript, JavaScript or Python file without a full scan, with the same result.

The commands that change files are `drift init`, `drift review`, `drift setup`, `drift export --write` and the hooks' session state. `drift scan`, `facts`, `census`, `check`, `security`, `card`, `map`, `practices` and `example` only read the repository (some write the cache).

Output is deterministic: byte-identical across runs, thread counts, operating systems and checkout paths. That is tested.

## The cache

Drift keeps a cache so the second run is fast. It is only a speed-up, never a source of answers: an edit that changes any fact gives a different cache key.

| Layer | Where | Keyed by |
| --- | --- | --- |
| Per-file facts | `.drift/cache/facts-v11/ts-l<N>-<version>/` (TypeScript and JavaScript) and `py-l<N>-<version>/` (Python) | the file's content hash, the facts schema (11 at head), the lowering version (TypeScript 80, Python 69 at head) and the Drift version |
| File stamps | `.drift/cache/index-v11-1/`, `.drift/cache/index-py-v11-5/` | size and modification time, so a later scan reads only files that changed |
| Derived results | `.drift/cache/derived-v1/` | a digest of the scanned facts, the Drift build, every `DRIFT_*` variable and the settings used; holds the practice map, the keys of the security inventory and what mining finds for `drift card`; the six newest files of each kind stay |
| Hook session state | `.drift/cache/sessions/` | the agent session |

Rules about the cache:

- `.drift/cache/` writes its own `.gitignore` containing `*`, so it is never committed.
- A cache that git tracks is not used (Drift runs `git ls-files` for that one check), so committed facts cannot hide a violation. A cache containing a symbolic link is not used either, and a cache file that does not read back as written is ignored and replaced.
- `--no-cache` on any command keeps nothing on disk. `DRIFT_CACHE_DIR=<dir>` moves the cache elsewhere (the GitHub Action does this, to a fresh directory outside the checkout).
- A new Drift version, schema or lowering version simply produces new cache directories. See [Versioning and Upgrades](Versioning-and-Upgrades).
- The cache is why a first run is slower than later ones. On the fixture used for this wiki a warm `drift scan` read 106 files from cache in 0.06 s against 0.12 s with `--no-cache`; the difference grows with the size of the repository (see "How long it takes" below).

## How long it takes

These are measurements from the project's performance record ([eval/perf/2026-11-07](https://github.com/dadbodgeoff/drift/blob/main/eval/perf/2026-11-07/README.md)), taken on its development repositories with a release build, as the minimum of 5 runs on a shared 4-CPU machine; yours will differ. CPU time is user plus system, over several threads.

| Repository | Run | CPU time | Peak memory |
| --- | --- | --- | --- |
| dub (a Next.js monorepo of about 3,900 files) | cold `drift census --json --max 15` (empty fact cache) | 5.1 s | 137 MB |
| dub | warm | 2.7 s | 123 MB |
| twenty (the largest development repository) | cold | 16.2 s | 963 MB |

Each file is parsed in its own arena and freed once it is turned into facts, so memory is bounded by the largest files, not the repository. After an edit, a hook re-reads only that file and the files its facts depend on; see [Hooks Reference](Hooks-Reference) for what that costs.

## What "proven" means

Drift separates what it found from what it proved. Two rules carry most of the weight:

- **A name is never proof.** A function called `check_access` is not a check. Drift reads the body: it counts a guard only where the body is read to turn a caller away, and a check only where the body is read to compare something of the caller with something of the resource.
- **Anything it cannot read, it says it cannot read.** A dependency list built where Drift does not look, a decorator it has no list for, a service reached by name at runtime: each makes the answer `unknown` and names what was not read. It never turns "could not read" into "none".

A check is *proven* when it was read where it is and shown to run, and to decide, on every request to the route. A check under a branch, in a loop, after a conditional return, as one operand of `and`, on the right of `or`, inside a `try` whose handler goes on, in a helper that returns early, not awaited, or after a call that has already changed data is *found, not proven*.

## `known`, `none`, `unknown`, and "found, not proven"

These are the states of an authentication or authorization answer for one route (or other unit):

| State | What it says | How to treat it |
| --- | --- | --- |
| `known` | A check was read where it is and is proven to run, and to decide, on every request to the route. The answer names the check and where it is. | Reliable. It was read against the source and is proven. |
| `identified` | Authentication that identifies the caller (a session is read, or DRF `authentication_classes` are set) and turns no one away. It is counted apart from `known`, never as a guard to copy, and its key keeps `identifies:<instrument>`. | Not a guard. The caller is known; nobody is rejected. Look at what the route does with that caller. |
| `none` | Drift found nothing that turns a caller away or scopes what is read in what it read: the bodies, dependencies, middleware and hooks it followed. What it saw and did not read (a body past the depth it follows, a package's function no list has an entry for) is listed with the answer (`N not read`). Worded "no guard found in what Drift read" (authentication) or "no role check, tenant scope or owner scope found in what Drift read" (authorization). | A finding to check, not a fact. On code Drift was not tuned on a share of `none` answers are wrong. Read it as "nothing found in what Drift read". |
| `unknown` | Something that could guard or scope the route was not read or not proven. The answer says what and why (the reason names the construct as written). | Counted against coverage, never hidden. Go and look at what the reason names. |
| found, not proven | A check was found and is not proven to run on every request. The route stays `unknown` with reason `check_not_proven`, and the line names the check and why. | Look at the check yourself. If it does decide for every request, say so with a `practices:` line (below). |

An example line:

```
unknown: a tenant check was found (`_ensure_access`) but is not proven to run on every request: it is skipped when rule.visibility == "..."
```

Other states and words you will meet: a route can be `opens` (declared public, or a liveness or readiness probe) or `service_auth` (a webhook signature or a secret from the environment: a service caller, not a user). Exposure has its own states (`internet-facing`, `internal`, `unknown`); see [Security Inventory](Security-Inventory).

### What a `none` or `internal` carries

`none` (authentication, authorization) and `internal` (exposure) are statements about what Drift found in what it read, never about the code. Each carries its basis, so that you know where to look:

- **What was read:** how many bodies (`bodies`), and which functions of the repository were followed (`followed`); for an exposure, which deployment descriptions were read (`descriptions`).
- **What Drift saw and did not read** (`not_read`), each with a `kind`, a `what` and a `why`:

| Kind | Meaning |
| --- | --- |
| `package_function` | A package's function no list of Drift's has an entry for: its body is not read, and nothing says what it does. |
| `depth_limit` | A body of the repository that was not followed: past the depth the reading follows. |
| `not_modelled` | A construct the facts mark and do not model (a call they do not record, a refusal on a condition they could not read). |
| `description` | A deployment description recognised and not read, or left out by a person. |
| `file` | A file Drift saw and did not read or classify (skipped by the scan, not parsed, a description it did not recognise). |

An empty `not_read` is not proof either: the words still say "in what Drift read". The text surfaces say it in one form, for example `none: no guard found in what Drift read (2 not read: svc/app/broken.py (skipped by the scan), lookup from company_auth)` in `drift practices`, `internal in what Drift read (compose service api in svc/compose.yaml publishes no ports; 3 not read: ...)` in `drift security`, and a count (`2 not read`) on each row of "Entry points where Drift found no guard". The wording is produced in one place and is the same in the CLI, the hooks, the MCP tools, the cards and the Studio. The JSON keeps the value `none` and adds `basis` (on a `none` unit of `drift practices --json --units`, and on an inventory row with no guard) and `exposure_basis` (on an `internal` row); see [Output and JSON Reference](Output-and-JSON-Reference). The keys and `P-` ids of `none` variants are unchanged, so answers and links that name them still do.

## Why `unknown` is common

`unknown` is the honest answer when proof is missing, and proof is often missing for reasons outside the code Drift reads:

- The guard is set up in a file Drift does not read: a deployment description of a kind it recognises but does not evaluate (Terraform, Kubernetes, a platform's config), a package's own middleware that no list knows, a registry or lookup by name.
- The check is in a helper whose name says it is a check, but the body does not prove it (it returns early, or only runs for some requests).
- A value of the caller is handed to a query or a service whose handling is not followed (every TypeScript query filtered by the session's own value reads `unknown` for authorization today).
- The repository holds more than one description of how a service is deployed (a test stack that publishes ports), and the most exposed one decides.

On a 3,200-file monorepo the README reports authorization as 19 known, 2 none and 116 unknown of 137 units, and 64 of the unknown carry a check that was found and not proven. Authentication on the same repository read 150 known, 20 none and 8 unknown of 178 units. Many `unknown` answers are therefore not "no check", they are "a check that Drift will not vouch for".

## What to do about `unknown`

1. **Read the reason.** Every `unknown` names what was not read or not proven. `drift card <file>` prints it for one file; `drift practices --all` lists it per concern.
2. **Answer the questions only you can answer.** `drift setup` asks whether a compose file is only for tests, which Terraform target group serves a service, and whether a helper is your check. See [Setup Questions](Setup-Questions).
3. **Declare a check you have verified.** `drift practices --hints` prints, as one block to merge by hand, the `practices:` lines for `.drift/config.yaml` that settle what Drift cannot classify alone, with the units each line frees:

   ```yaml
   practices:
     authz:
       "svc/services.py#RuleBook._ensure_access": "RuleBook._ensure_access"
   ```

   That line is your statement that the check is what its name says and decides for every request that reaches it. It settles a route only where the route runs the named check on every path; a check the route reaches only sometimes stays `unknown` whatever you declare. A declared answer is counted as known and marked "declared in .drift/config.yaml, not proven".
4. **Say which descriptions deploy nothing.** `security.not_deployed` removes a test stack from the exposure reading; `security.terraform` ties code to the target group that forwards to it. See [Security Inventory](Security-Inventory).
5. **Leave it `unknown`.** That is a valid outcome. An `unknown` is a prompt to look, not a defect to silence.

See also: [Practices Map](Practices-Map), [Security Inventory](Security-Inventory), [Setup Questions](Setup-Questions), [Accuracy and Limits](Accuracy-and-Limits), [Glossary](Glossary).
