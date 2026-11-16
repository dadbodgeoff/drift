# Drift

This is the documentation for Drift, a command-line tool that reads a repository and tells people, agents and CI what the code already does: which conventions it follows, which practices it uses for authentication, errors and the like, and which entry points are guarded and who can reach them. It is written for engineers and engineering leads adopting Drift on their own repositories, for the platform and security people who approve tools, and for those wiring Drift into coding agents.

## What Drift is

Drift is a Rust program (the binary is `drift`) with an optional desktop app, the Studio. It reads your working tree, never sends anything off the machine, and writes only under `.drift/`, to `drift.lock`, and to a file you name yourself with `drift export --write`. It ships no predefined rules. Everything it reports is learned from your code or read from your repository's own files, and it says how sure it is.

## The five things it does

| Job | Commands | Page |
| --- | --- | --- |
| Mines the conventions the code follows and proposes them as rules, which a person accepts, rejects or sets to block | `drift init`, `drift census`, `drift review`, `drift check` | [Conventions and Review](Conventions-and-Review) |
| Maps what the code does per route for each cross-cutting concern: authentication, authorization, error handling, logging, validation and more; a person can make one practice the rule for new code in a place | `drift practices`, `drift practices promote` | [Practices Map](Practices-Map) |
| Inventories entry points with their guards, the risky operations they reach, and who can reach them (internet-facing, internal, unknown) | `drift security` | [Security Inventory](Security-Inventory) |
| Gives an agent a file's card and the accepted rules before it writes | `drift card`, `drift mcp`, the Claude Code hooks, `drift export` | [Using Drift with Agents](Using-Drift-with-Agents) |
| Asks the few questions only a person (or an agent, with a person confirming) can answer, and hands an agent each route Drift could not settle, with the code to read | `drift setup`, `drift investigate`, `drift findings` | [Setup Questions](Setup-Questions), [Using Drift with Agents](Using-Drift-with-Agents#investigating-open-routes) |

## How sure are its answers?

Not equally sure everywhere, and the documentation says so wherever it matters. Drift's answers for exposure and error handling are in good shape. For authentication and authorization, a `known` answer is proven: Drift read a check, showed it runs on every request, and says where it is. But on code Drift was not tuned on, a share of the `none` answers (and some `known` ones) are wrong: independent test suites on unseen code found roughly one soundness check in seven to one in eleven (9% to 15%) wrong on first contact. Read `none` and `internal` as "nothing found in what Drift read": a finding to check, not a fact. Mined conventions are weaker still: on repositories Drift was not tuned on, about half of the default-tier cards (7 of 15) were right, which is why nothing is shown to an agent, and nothing blocks, until a person says so. The figures, how they were measured and what they do not show are on [Accuracy and Limits](Accuracy-and-Limits).

## Where to start

| You are | Start here, in this order |
| --- | --- |
| An engineer trying it on a repository | [Getting Started](Getting-Started), then [Conventions and Review](Conventions-and-Review), then [Troubleshooting](Troubleshooting) if something looks off |
| A lead rolling it out to a team | [Team Rollout](Team-Rollout), [Drift in CI](Drift-in-CI), [Accuracy and Limits](Accuracy-and-Limits) |
| Security or platform, approving it | [Security and Privacy](Security-and-Privacy), [Accuracy and Limits](Accuracy-and-Limits), [Files Drift Writes](Files-Drift-Writes) |
| Integrating it with coding agents | [Using Drift with Agents](Using-Drift-with-Agents), [Setup Questions](Setup-Questions), [MCP Reference](MCP-Reference), [Hooks Reference](Hooks-Reference) |
| Someone who wants to understand the answers | [How Drift Works](How-Drift-Works), [Practices Map](Practices-Map), [Security Inventory](Security-Inventory), [Glossary](Glossary) |

## The wiki at a glance

- **Start:** [Getting Started](Getting-Started).
- **Concepts:** [How Drift Works](How-Drift-Works), [Conventions and Review](Conventions-and-Review), [Practices Map](Practices-Map), [Security Inventory](Security-Inventory).
- **How-to:** [Setup Questions](Setup-Questions), [Using Drift with Agents](Using-Drift-with-Agents), [Drift in CI](Drift-in-CI).
- **Operating Drift:** [Team Rollout](Team-Rollout), [Security and Privacy](Security-and-Privacy), [Troubleshooting](Troubleshooting).
- **Reference:** [Command Reference](Command-Reference), [Configuration Reference](Configuration-Reference), [Output and JSON Reference](Output-and-JSON-Reference), [MCP Reference](MCP-Reference), [Hooks Reference](Hooks-Reference), [Files Drift Writes](Files-Drift-Writes), [Languages and Frameworks](Languages-and-Frameworks), [Glossary](Glossary), [Versioning and Upgrades](Versioning-and-Upgrades).
- **About:** [Accuracy and Limits](Accuracy-and-Limits), [FAQ](FAQ).

## Status

Drift is in beta (the development version reads `0.1.0-dev`). It reads TypeScript, JavaScript and Python. Nothing blocks a commit, a pull request or an agent's turn unless a person sets a convention to block. The Studio is not packaged yet: you run it from a checkout of the repository. See [Versioning and Upgrades](Versioning-and-Upgrades) for how releases and compatibility work.

See also: [Getting Started](Getting-Started), [Accuracy and Limits](Accuracy-and-Limits), [Glossary](Glossary), [FAQ](FAQ).
