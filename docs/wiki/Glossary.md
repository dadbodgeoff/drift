# Glossary

The product terms Drift uses in its output, its files and this wiki, each defined once, in alphabetical order. This page is for anyone reading Drift's answers or this wiki who meets a term they do not know. 

| Term | Meaning |
| --- | --- |
| **Accepted** | A convention's status after a person accepted it. Accepted conventions are checked by `drift check`, the hooks and CI. The other statuses are `proposed` and `rejected`. |
| **Admitted (family)** | A rule family whose suggestions are shown to agents because its record on labelled cards meets a bar (a share of accepted cards over a minimum number of cards, held in a table committed with Drift). A suggestion of a family that is not admitted is visible to people and checked, but not shown to agents unless a person chose `agents: show`. |
| **Advise mode** | A convention's `mode` when a new violation is only reported and fails nothing. Every proposal starts in advise mode. |
| **Agent** | A coding assistant that uses Drift through its hooks, the MCP tools or the exported block. In `drift setup`, an agent's answers take effect only where they make Drift more cautious. |
| **Agents block** | The generated text between `drift:start` and `drift:end` markers that `drift export agents-md` keeps in `AGENTS.md` or `CLAUDE.md`. |
| **Answer (setup)** | What a person or an agent said to a setup question. Recorded under `setup:` in `.drift/config.yaml` with the evidence digest it rested on. |
| **Baseline** | The set of violations that exist now and are not the change's doing. `drift.lock` is the repository's baseline of legacy violations; a hook session records its own baseline at SessionStart. |
| **Basis** | What a `none` or `internal` answer rests on: the bodies Drift read (`bodies`), the functions it followed (`followed`), the deployment descriptions it read (`descriptions`) and what it saw and did not read (`not_read`). JSON fields `basis` (a `none` unit or row) and `exposure_basis` (an `internal` row). It does not make the answer a fact. |
| **Block candidate** | A proposed default-tier convention nobody has accepted. People see it first; no agent surface shows it until a person accepts it. `drift review` asks one question about it (see "Same kind of thing"). |
| **Block mode** | A convention's `mode` when a new violation fails `drift check` and, in Claude Code, blocks the end of the agent's turn. A role of fewer than 15 members advises whatever the mode says. |
| **Boundary (deployment)** | What the repository says about who can reach a directory's entry points: compose files, gateway configuration, and `security:` settings. |
| **Brief** | The short text SessionStart gives an agent: the practices for the package and the packages with their entry points, naming `drift card` as the first stop. Turned off with `agents: {brief: off}`. |
| **Cache** | See "Fact cache". |
| **Card (convention)** | One proposed or accepted convention with its evidence, example and outliers, as `drift review` and the Studio show it. |
| **Card (file)** | `drift card <path>`: one file's place in the repository for an agent about to touch it. |
| **Census** | `drift census`: a preview of what `drift init` would propose, with evidence, that changes nothing. |
| **Check (found, not proven)** | A guard or authorization check Drift found in the code but could not prove runs on every request. The route stays `unknown` with the reason `check_not_proven`, and the line says what was found and why it is not proven. Never worded as if the route does it. |
| **Client leak** | Client-side code (a file marked `use client`, for example) that reaches server-only code or a secret. Listed by `drift security`. |
| **Concern** | One cross-cutting matter the practice map describes: `authn` (authentication), `authz` (authorization), `errors`, `logging`, `api`, `validation`, `config`, `data_access`, `testing`. |
| **Convention** | A rule the code already follows, mined from it: members of a role (`role`) do something (`rule`), with evidence. It is a proposal until a person accepts it. |
| **Coverage (practice map)** | `(known + none) / total` units of a concern. Unknown units count against it and are never hidden. |
| **Default tier** | Conventions of the kinds that may block: call wrappers and layering on in-repo targets, in TypeScript/JavaScript, in roles of at least 15 members. Reaches agents only once a person accepts it. See "Tier". |
| **Departure (practice)** | A concern in which a file's entry points do something other than what at least 80% of the entry points around them do, reported as a fact and never as a violation. |
| **Different kind (set apart)** | A person's answer to a block candidate's question: the flagged files are another kind of thing. `drift check` exempts their members from that convention, by path (`different_kind`). |
| **`drift-ignore`** | A comment directly above a declaration, `// drift-ignore <id>: <reason>` (`#` in Python), that suppresses one convention's violation there. A reason is required; reviewers see it. |
| **`drift.lock`** | The committed file of baselined legacy violations, one `<id> <path#symbol>` per line. They never fail the check. |
| **`.drift/`** | The directory Drift writes in: committed decisions (`conventions.yaml`, `config.yaml`) and local state (`cache/`, `review-log/`, and `verify-cache.json` with the experimental verifier). See [Files Drift Writes](Files-Drift-Writes). |
| **Entry point** | A place a request, job or message enters the code: a route handler, page, server action, RPC procedure, job, scheduled task, consumer or command. Each has a kind (`http`, `page`, `server_action`, `rpc`, `graphql`, `job`, `cron`, `consumer`, `cli`, `agent_graph`). |
| **Evidence** | What backs a convention: `holders` of `total` members follow it, with a lower bound and a lift. |
| **Exception (reviewer's)** | An outlier a person marked as legitimate with a one-line reason (`drift review --exempt`). `drift check` lists it as exempt, not as a violation. |
| **Exempt** | A member a convention is not about, listed with Drift's reason (`code`) rather than counted as a violation: another kind of class, the module that defines the thing, a reviewer's exception, and so on. |
| **Exposure** | Where an entry point is reachable from, as far as the repository says: `public` (internet-facing), `internal` (reachable only from inside the deployment) or `unknown`. `internal` and `public` rest on a deployment description Drift read or on a person's statement. |
| **Fact** | One thing Drift recorded about the code (a symbol, an import, a wrapper, an entry point, a call). Facts are what mining, the practice map and the inventory are computed from. |
| **Fact cache** | `.drift/cache/`: parsed facts per file, keyed by content hash, schema and parser version. Local; safe to delete. |
| **Facts schema** | The version number of the facts Drift records (11 in this build). Part of every cache key. |
| **Finding (local)** | What an agent records when the code has a real gap: `.drift/findings/F-<id>.json` and `.md`, with the code cited, a suggested fix and optionally a patch. Local and git-ignored; never posted. `drift findings` lists them; a person may ask for an issue draft or a local branch. |
| **Finding (practice map)** | An item the practice map lists to look at first: a key a signed-in caller names that nothing scopes (`unscoped_key`), an unexplained split, a `none` in authentication or validation, an unknown instrument, or a helper defined more than once. |
| **Gap report** | What an agent records when Drift does not read a construct that makes the code sound: a minimal self-contained example with the repository's names replaced, in `.drift/gap-reports/G-<id>/`. Local and git-ignored; never sent. |
| **Gateway** | A reverse proxy in front of services (nginx, Traefik, Caddy and similar). Where its configuration is read, exposure is decided route by route. |
| **Guard** | What turns away a request that comes without an identity: a wrapper, decorator, middleware, dependency, hook or permission class. Read from its body or from a closed list of library call shapes; never from its name alone. |
| **Guard gap** | A guard at least 90% of the entry points of one kind in one place share, with the members lacking it. A fact for a reader to judge. |
| **Hidden card** | See "Withheld card". |
| **Holders** | The members of a role that follow a rule. |
| **Hook** | A command Claude Code runs at a moment of a session (`drift hook claude <Event>`). See [Hooks Reference](Hooks-Reference). |
| **Identified** | A state of authentication: the caller is identified (a session is read) and no one is turned away. Counted apart from `known`, never a recipe to copy; its key keeps `identifies:<instrument>`. In the inventory it is the `authenticates` list of an entry point. |
| **Instrument** | The thing that does a practice: a guard function, a wrapper, a logger, a library call. Named as `path#symbol`. A person can declare one under `practices:`. |
| **Internal** | An exposure value: reachable only from inside the deployment. Worded "internal in what Drift read", with what was read and what was not (`exposure_basis`). Treat it as a finding to check, not a fact. |
| **Investigate (item)** | One entry of `drift investigate`: routes Drift could not settle, grouped by what would settle them, with an id `I-` and six hex digits, the evidence to read and the outcomes that can be recorded. |
| **Known** | A practice-map answer that rests on proof: a check or instrument read where it is and shown to run, and to decide, on every request. Also the state of a unit declared by a person under `practices:` (counted as `declared`). |
| **Legacy violation** | A violation that existed when it was baselined in `drift.lock`. It never fails a check; fixing the code lets you remove the line. |
| **Lift** | Share of a role's members that follow a rule, divided by the share in the whole repository. A rule needs a lift of at least 1.5 to be proposed (3.0 where it names a call from outside the repository). |
| **Local entry point** | An entry point whose kind no remote caller reaches (`cli`): listed, never counted as having no guard. |
| **Lock** | See "`drift.lock`". |
| **Lowering** | Turning a language's syntax tree into Drift's language-neutral facts. Each language has a lowering version. |
| **Lower bound** | The 95% Wilson lower bound of `holders / members`: how low the true share plausibly is. A rule needs a lower bound of at least 0.75 to be proposed. |
| **MCP** | The Model Context Protocol. `drift mcp` serves Drift's tools to an MCP client. See [MCP Reference](MCP-Reference). |
| **Mining** | Finding the conventions the code already follows, by comparing members of the same role. |
| **Mode** | A convention's `advise` or `block` setting. |
| **None** | A practice-map or inventory answer meaning no guard, check or validation was found in what Drift read (for example "no guard found in what Drift read"). It is a finding to check, not a fact: on code Drift was not tuned on, a share of `none` answers are wrong. Each `none` carries its `basis`. |
| **Not read** | A thing Drift saw and did not read, listed in a `basis` as `{kind, what, why}`: kinds `package_function`, `depth_limit`, `not_modelled`, `description` and `file`. |
| **Obligation** | Why a found check is not proven: the closed list of conditions it fails (under a branch, after a conditional return, as one operand of `and`, not awaited, swallowed, by name only, after an effect, and so on). |
| **Opaque** | A wrapper or call that may be a guard and cannot be read (its definition is not in the repository, or its body is not proven to refuse). An entry point with one is not counted as having no guard. |
| **Outlier** | A member of a role that does not follow a rule. |
| **Package** | A directory with its own manifest in a workspace (or one set with `packages:`). Conventions, checks and hooks resolve a file's package. |
| **Plugin** | The Claude Code plugin (`drift@drift`) that adds Drift's hooks, a skill and the MCP server. |
| **Practice** | What the codebase does for a concern, as a variant with a share. Facts, not rules. |
| **Practice map** | `drift practices`: the practices of the whole codebase, concern by concern. Read-only; nothing in it is enforced. |
| **Preview concern** | A concern (`logging`, `config`, `data_access`, `testing`) shown in a recipe only where at least 60% of the package does the same. |
| **Promote (withheld card)** | A person's answer to a withheld card that writes it to `.drift/conventions.yaml` as accepted (`promoted_from_hidden: true`). A practice cannot yet be promoted to a convention. |
| **Proposal** | A mined convention not yet decided (`status: proposed`); it only ever advises. Also, in `drift setup` and `drift investigate`, an agent's answer that would make Drift say more (a guard, a check, "internal"): it is recorded under `setup.proposed` in `.drift/config.yaml` and changes nothing until a person confirms it in `drift setup --review`. |
| **Proven** | Read where it is and shown to run on every request. The standard for `known`. |
| **Recipe** | What new code of one kind of entry point does in a package, concern by concern, each with a file to copy. Given to agents before a new entry-point file is written. |
| **Rejected** | A convention's status after a person rejected it: never proposed again. |
| **Review log** | An opt-in local record of review decisions and cards shown, under `.drift/review-log/`. Never sent anywhere. |
| **Role** | A set of similar members of the repository: for example "HTTP handlers in `app/api/**` route files". A convention is a rule about a role. |
| **Role selector** | The frozen description of which members a convention is about (`package`, `dir`, `file`, `entry`, `kind`, ...). Versioned by `selector_version`. |
| **Rule** | What a convention says its role's members do: be wrapped by a call, avoid an import, pass a key, throw a class, and so on. The kinds are listed in [Configuration Reference](Configuration-Reference). |
| **Rule family** | A group of rule kinds with a shared track record (for example `wrapper`, `naming`, `control`, `layering`), used by the show policy and by admission. |
| **SARIF** | The format of `drift check --format sarif`, for GitHub code scanning and IDEs. |
| **Same kind of thing** | The one question `drift review` asks about a block candidate: "Are these the same kind of thing?" Answers: `same`, `different`, `not-a-convention`. |
| **Selector version** | How a convention's role selector is read; frozen when the convention is written so that it keeps checking the same members. |
| **Session (hook)** | One agent conversation, identified by Claude Code's session id; its state is kept in `.drift/cache/sessions/`. |
| **Setup question** | One of the few questions only a person can answer, asked by `drift setup`: is a compose file a test stack, which Terraform target group serves a service, is a helper your check. |
| **Show policy** | A frozen table that decides which suggestions Drift shows at all (at most one outlier, and a family admitted for the language). A suggestion it hides is a withheld card. |
| **Sink (risky operation)** | A risky operation the inventory lists: raw SQL, a shell command, raw HTML, a computed redirect, an unsafe loader, `eval`. |
| **Strict** | `drift check --strict`: fail on any new violation, advise mode included, and on files that could not be checked. |
| **Studio** | Drift Studio, the desktop app in `apps/studio` that reads Drift's JSON and files. |
| **Suggestion** | A convention outside the default tier. Advice only; blocking one needs `--force`. Not shown to agents unless its family is admitted or a person chose to show it. |
| **Suggestion cap** | How many suggestions the human views list by default (5, or `suggestion_cap` in `.drift/conventions.yaml`). Presentation only. |
| **Tier** | `default` or `suggestion`: how strong a convention's evidence and kind are. Set by Drift; shown with a `tier_reason` for a suggestion. |
| **Unchecked** | A file not parsed for lack of thread stack (a memory limit): its violations and facts are unknown, not absent. `drift check --strict` fails on it. |
| **Unit** | The thing a practice-map concern counts: an entry point for `authn`, `authz`, `errors`, `api`, `validation` and `testing`, a symbol for `logging`, `config` and `data_access`. |
| **Unknown** | A practice-map or exposure answer meaning Drift could not tell, with a reason (`unresolved`, `opaque_wrapper`, `check_not_proven`, ...). The default for anything not recognised: never read as nothing. Counted against coverage. |
| **Unsure** | A violation whose file depends on a file that was not parsed for lack of stack. Never new, never blocks, listed as unsure. |
| **Variant** | One way of doing a concern, with its share and where it is. `none` and `identified` are variant kinds (`known` is the default); `unknown` never is. |
| **Wiring** | Experimental rules about registration ("registered in this list") and co-change mined from git history. Suggestion tier; advice only. |
| **Withheld card** | A mined card the show policy keeps from agents, hooks, MCP, exports and SARIF. `drift review --hidden` lists them for people, who may promote one. `drift card <file>` states the strong ones as facts about the code. |
| **Workspace** | A repository of several packages (a monorepo). `drift init` at its root discovers the packages and writes one root policy (`version: 2`). |

See also: [Home](Home), [How Drift Works](How-Drift-Works), [Accuracy and Limits](Accuracy-and-Limits), [Command Reference](Command-Reference), [Configuration Reference](Configuration-Reference), [Output and JSON Reference](Output-and-JSON-Reference)
