# Drift Studio: design

Drift Studio is where a person sees what Drift learned about their codebase and
what coding agents did in it. It is a reading tool first: most time is spent
scanning evidence, following a path to code and deciding. The design serves
that.

## Product

### Users

- **Maintainers and tech leads** who own a repository's conventions. They
  review what Drift learned and decide what is enforced.
- **Engineers** who hit a Drift advice or block (in an agent session, in CI)
  and need to know why, fast.
- **Platform and security engineers** who want to understand the codebase's
  shape, its guards and its risky operations.

### Jobs, in priority order

1. **Review** what Drift learned: accept, reject or block each proposal.
2. **Investigate** a violation or an agent session: "why did Drift block
   this?", "what did the agent do, and where did Drift step in?"
3. **Understand** the codebase: the map, roles, layering and security.

### Information architecture

The sidebar is grouped by job; each item has a one-key jump (`g` then the key).

| Section | Views | Job |
| --- | --- | --- |
| (top) | **Attention** (home) `g h` | all three: what needs a person now |
| Review | **Conventions** `g c` | review |
| Investigate | **Check** `g v`, **Sessions** `g s` | investigate |
| Understand | **Map** `g m`, **Security** `g x` | understand |
| Evidence | **Studies** `g t` | trust in Drift itself |
| (footer) | Logs, Settings, Component gallery | support |

**Attention, not a dashboard.** Home lists only things that need a decision or
a look, each with a count and a key: pending proposals (`g c`), new
violations since the last scan (`g v`), sessions where Drift advised or
blocked (`g s`), security changes since the previous scan (`g x`). When
nothing needs attention it says so in one line and shows the repository's
vital signs below.

### Primary flows

**Review 15 proposals** (target: under 5 minutes).

1. `g c` opens the review queue at the first unreviewed proposal, with
   progress ("7 of 15 reviewed").
2. The proposal shows its rule, evidence chip, confidence tier, example and
   outliers. `o` opens the example in the code drawer; `Enter` expands every
   outlier; `Esc` closes.
3. `a` accepts, `r` rejects, `b` blocks (only `b` asks for confirmation,
   because it can fail CI and stop agents). Each action shows the exact
   command it runs (`drift review --accept D-83351e`) and waits 5 seconds
   before running it; `u` undoes within that window.
   There is one pending slot: a second decision commits the pending one at
   once (so `a a a` through a queue never loses a decision), and closing or
   reloading the window commits it too. Once run, a decision is changed only
   by another decision; `drift review` has no reset yet.
4. The queue advances to the next proposal. Every decision made in the Studio
   is kept in a local audit trail (who, when, command, result) shown in the
   convention's detail.

**From a violation to its code** (target: 3 keys from Attention).

1. Attention lists new violations (click one to open it), or `g v` goes to
   Check with the first new violation selected; `j`/`k` move, `Enter` opens
   the code drawer at the line, with the rule, its evidence and the file to copy.

**Why did Drift block this session?**

1. `g s`, choose the session; `n` jumps to the next Drift event.
2. The event shows Drift's message exactly as the agent saw it, the findings
   with links to code, and the edit that caused it (diff).

**Understand a boundary.**

1. `g m`; layering rules are drawn as overlays; violating edges are red and
   dashed. Click an edge to see the files and the rule.

### Success metrics (measured in the e2e suite where possible)

| Metric | Target |
| --- | --- |
| Review 15 proposals by keyboard (UI time, excluding thinking) | < 5 min for a person; < 2 s of UI latency in total |
| Keys from Attention to a violation's code | ≤ 3 (`g v Enter`) |
| View switch on cached data | < 100 ms |
| First paint with cached facts | < 1 s |
| Map pan/zoom on twenty (36k files) | 60 fps (p95 frame < 20 ms) |
| Map expand/collapse on twenty | < 150 ms to re-aggregate and lay out |

Measured by the e2e suite (tests/e2e/run.mjs, Chromium, fixture data; twenty
generated locally), 2026-11-05: one review decision 19 ms of UI time, 15
queue moves 143 ms; view switch median 15 ms, p95 44 ms; first contentful
paint 104 ms; twenty (36,125 files) map first render 1.9 s (cold load of
3 MB of facts), expand 144 ms, frame time p50 16.7 ms and p95 16.7 ms while
panning and zooming (60 fps); model build 175 ms, re-aggregation 18 ms.

## Data, privacy and state

- **No telemetry.** The Studio sends nothing anywhere. It makes no network
  requests except what the person asks for explicitly (none today).
- **Reads never write into the repository.** Drift's fact cache for the
  Studio's runs lives in the app's data directory (`DRIFT_CACHE_DIR`). The
  only repository writes are `drift review` and `drift init`, after the
  person chooses them.
- **State the Studio keeps**, per repository (keyed by the repository root and
  its `origin` remote) in the app's data directory: the last slim scan (for a
  fast first paint), scan snapshots (for "since the last scan"; the last 30
  within 90 days) and the decision audit trail (the last 1,000 within a year).
  Settings → Data and privacy clears it.
- **Transcripts** are read in place from `~/.claude/projects`, never copied.

## Follow-ups (out of scope now)

- Packaging, code signing and notarisation, auto-update.
- Pixel-diff visual regression against committed gallery baselines (the suite
  writes the screenshots; comparing needs a diff tool and stable fonts in CI).
- A Python view of the map once Drift's Python facts land (the Studio already
  treats `lang` as open: highlighting for `.py`, unknown entry kinds shown as
  they come).

## Confidence

The precision study shows some rule families are almost always right
(wrappers 91%, base classes 82%, argument keys 69%) and others often wrong
(naming 42%, calls 44%, other avoidance 31%). A reviewer should know where to
look hardest, everywhere a convention appears:

- **Evidence chip:** `53/54 · LB 0.90 · lift 36`: holders/total, the 95%
  Wilson lower bound and lift, in mono with tabular numerals, with a tally of
  one mark per role member (outliers drawn apart); above 30 members, a
  proportional bar.
- **Evidence gauge** (a convention's detail): every member of the role, the
  share with its 95% Wilson interval on a 50 to 100% axis, the lower bound
  Drift proposes at (`min_lower_bound` from `census --json`) and the lift.
- **Confidence tier:** `default tier` (may block once accepted) or `suggestion`
  (advice; blocking it takes `--force` and a confirmation), with why a suggestion is
  one (its rule kind, a package's symbol, or a small role). From the CLI: `tier` in
  `census --json`, and `conventions[]` in `check --format json` for conventions census
  no longer reports. The study's accept rate for the rule family, from the newest run
  of the convention's language, stays as the track record beside it.
- **Effective mode:** a policy that says `block` for a role under 15 members advises;
  the Studio says `block · advises` rather than claiming it blocks.

## Freshness and provenance

Every data view says what it shows and how old it is: "scanned 3 min ago at
`7dbbccd`, drift 0.1.0-dev". When files change after the scan the header says
**stale** with the number of changed files and a rescan action. Long runs show
which step is running (scan, census, check, security) and the elapsed time.

## Agent sessions

Transcripts are untrusted and can contain secrets. Tokens and keys matching
common patterns are **redacted by default** with a reveal toggle. Thinking is
labelled **model reasoning**. Long sessions render only what is on screen.
`n`/`N` jump between Drift events. A Drift event shows the message exactly as
the agent received it.

## Map visual grammar

| Mark | Means |
| --- | --- |
| Node | an area (Drift's first two path segments), then a directory, file or symbol as you expand |
| Node size | grows with the square root of the files beneath it (symbols for a file) |
| Node depth tint | files beneath it on a log scale (1–2 … 300+), from the sequential ramp; large areas get contour rings |
| Node colour | the chosen layer: package, dependency layer (0 = imports no other area) or health (new violations) |
| Badge | entry points beneath it, by kind (`http`, `page`, `server_action`, ...) |
| Edge | value imports between visible nodes, aggregated from file-to-file imports |
| Edge weight | number of imports (stroke width, log scale) |
| Violating edge | vermilion, dashed, with the rule id; drawn above all others; its label is placed where it covers no node, with a leader to the edge |
| Layering rule | a thin outlined arrow "must not import" from the rule's scope to its target |

Each level aggregates everything beneath it; at most 40 children are shown
per expanded node (the rest fold into "N more"), at most 600 edges (heaviest
first, violating edges always). The legend is always visible.

## Internationalisation and platform

UI strings live in a catalogue (`src/shared/i18n`), English only for now.
Shortcut labels follow the OS (`⌘K` on macOS, `Ctrl+K` elsewhere); the title
bar leaves room for the macOS traffic lights and uses native controls on
Windows and Linux. Layout holds from 80% to 200% zoom.

## Sharing

A convention, a check report or a session excerpt can be copied as Markdown
for a pull request or a chat. Repository text in the export is put in code
spans or fences, never as live Markdown.

## Principles

1. **Evidence before opinion.** Every claim on screen carries its numbers
   (`53/54`, lower bound `0.90`) and a way to the code that backs it. Drift
   decides nothing for the person; the screen shows why Drift proposes what it
   proposes.
2. **Calm by default, loud only when it matters.** Neutral surfaces, one accent,
   and colour reserved for state: a blocking violation is the reddest thing on
   the screen because nothing else is red.
3. **Dense, not cramped.** Engineers keep this open beside an editor. Rows are
   short, numbers are tabular, chrome is thin, but every group has air around
   it and one clear heading.
4. **Precise.** Paths, ids and rules are monospace and copyable. Nothing is
   abbreviated without a tooltip. Counts are exact.
5. **Keyboard first.** Every action has a keyboard path; `Ctrl/⌘-K` reaches
   any view, file, convention or session.
6. **Untrusted text stays text.** Repository and transcript content is shown
   verbatim and escaped. It never becomes a link, markup or a command.

## Identity: Chart

Drift learns the currents of a codebase, and the Studio is drawn as a
**hydrographic survey chart** of it.

- **Paper and ink.** Light is chart paper (warm off-white, ink text, a buff
  "land" tint for the shell); dark is the chart table at night (warm
  umber-black, parchment text). Never pure black or white.
- **Ruled, not boxed.** Sections sit on the page under a hairline rule
  graduated like a chart margin; there are no bordered cards. Hierarchy comes
  from type and position: what to see first, then decide, then dig into.
- **One magenta overprint** (chart magenta, `accent`) for what the person is
  doing: focus, selection, the primary action, Drift's route through its loop.
  It is never used for state; a test keeps it at least ΔE 0.12 from every state
  colour in every theme.
- **Depth tints for magnitude.** The sequential ramp is a bathymetric scale:
  deeper is more (files under an area, for example). Large areas also get
  contour rings.
- **State** colours: positive (green), caution (amber), critical (vermilion),
  information (blue), each with a subtle background. **State is never colour
  alone**: every state has an icon and a word.
- **Data** colours: an 8-step categorical palette in chart inks, tested to
  stay distinguishable under protanopia, deuteranopia and tritanopia.
- **The mark**: three offset depth contours, drawn in magenta on paper.

**Cyanotype** (a blueprint: Prussian blue, white linework, pink markup) is an
optional theme, chosen in Settings → Appearance or the command palette. Every
theme of both passes the same tests: WCAG 2.2 AA (7:1 text in high contrast),
accent far from state, CVD-safe categorical data, a monotonic sequential ramp.
Tokens: `packages/ui/src/tokens/index.ts` (`directions`); drawing:
`packages/ui/src/styles/directions.css`, `apps/studio/src/app/directions.css`.

### One vocabulary

| Object | Statuses (icon + word + colour) |
| --- | --- |
| Convention | proposed (accent) · accepted, advise (positive) · accepted, block (critical) · rejected (neutral) |
| Violation | new · blocks (critical) · new · advises (caution) · suppressed (info, with its `drift-ignore` reason) · baselined (neutral, in `drift.lock`) · fixed (positive) |
| Entry point | guarded in code · guarded by settings · app hooks only · authenticated only · opened to anyone · unguarded (the middle four appear only when `drift security` emits them) |
| Drift message | session start · rules before a new file · denied a policy edit · advice after an edit · blocked the end of the turn · stepped aside (loop guard) |

- **Evidence** is always the tally chip inline and the evidence gauge in a
  detail pane.
- **"Drift said this to the agent"** is always `DriftMessage`: who, what it
  did, the hook, the convention ids (links), the verbatim text.
- **Numbers** are readouts: JetBrains Mono, tabular, on the `readout-*` steps.

### Each view: see, decide, dig

| View | First | Then | Dig into |
| --- | --- | --- | --- |
| Attention | Drift's loop on this repo with real numbers | what needs a person, worst first (blocking leads) | each card's rows |
| Conventions | the rule, its role, the evidence gauge and track record | accept / reject / block (sticky bar, exact command) | example, rule, outliers, violations, audit |
| Check | the verdict (fails or passes, exit code, why) | the status ledger, which also filters | a violation beside the file to copy |
| Sessions | what Drift did at each hook (lifecycle rail; loop guard and denials called out) | which Drift event to read (`n`) | the verbatim message, findings, diffs |
| Map | areas at their magnitude, broken boundaries | an area or a violating edge | directories, files, symbols |
| Security | entry points reaching risky operations, unguarded first | the protection ledger | guards (with origin and the convention requiring them), reach chains |
| Studies | precision from the baseline (main before PR #4, first-round labels) to the final dev-set figures (PR #4), with provenance | where to look hardest (families) | the A/B as paired plots, labelled proposals |

### Proposals (not built yet)

- **Agents & CI** (`g a`): the hooks lifecycle and whether each hook ran;
  `drift mcp`'s five tools; `drift export agents-md` with a preview; SARIF,
  the GitHub Action and pre-commit; `drift.lock` and suppressions as lists.
- **The object graph**, walkable in every direction: a convention's
  violations and the sessions where it fired; session ids to conventions; an
  area to the conventions governing it; an entry point to the convention its
  guard satisfies (started: Security links a guard to the accepted wrapper
  conventions that require it, and Conventions shows its violations).
- **First run**: the loop as the hero before `drift init`, a 60 s "What is
  Drift?" tour on the repo's real numbers, empty states that teach.
- **Components still missing** from `@drift/ui`: split button, combobox and
  multi-select, context menu, hover card, sheet, meter, data-grid row
  selection and keyboard grid navigation.

## Typography

Inter (UI), Source Serif 4 (headings, rule text and other reading at 14 px
and above, never smaller) and JetBrains Mono (code, paths, ids and every
number shown as a readout), all OFL and self-hosted. Cyanotype uses Archivo
and IBM Plex Mono.

| Role | Size / line | Weight | Use |
| --- | --- | --- | --- |
| display | 30/36 | 600 | view hero numbers |
| h1 | 22/28 | 600 | view title |
| h2 | 17/24 | 600 | section |
| h3 | 15/22 | 600 | card title |
| h4 | 13/20 | 600 | group heading |
| title | 13/20 | 500 | row title |
| body | 13/20 | 400 | text |
| body-sm | 12/18 | 400 | secondary text |
| caption | 11/16 | 400 | meta |
| overline | 11/16 | 600, +0.06em, caps | labels above values (never below 11 px) |
| code | 12/18 | 400 | mono |
| readout-xl / lg / md / sm | 44/48, 32/36, 22/28, 15/20 | 500 | numbers: verdicts, ledgers, evidence (mono, tabular) |

Metrics use tabular numerals. Headings use slight negative tracking.

## Layout

- **4 px base unit.** Spacing scale 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Shell:** a 232 px sidebar (navigation, repository, scan state), a 44 px top
  bar (view title, breadcrumbs, command palette, theme), and a content area.
- **Content:** a 12-column fluid grid with 16 px gutters, 24 px outer padding
  (16 px compact). Lists and detail panes use resizable split panes.
- **Overlays** (palette, dialogs, code drawer) sit on a raised surface with one
  shadow level each; nothing stacks more than two levels deep.

## Density

Two densities, switchable at runtime: **comfortable** (controls 30 px, rows
32 px) and **compact** (controls 26 px, rows 26 px). Type sizes do not change;
padding and row heights do.

## Motion

Short and functional: 80 ms (hover, press), 140 ms (reveal, fade), 220 ms
(drawers, dialogs), with a standard `cubic-bezier(0.2, 0, 0, 1)` curve. No
motion is decorative. With `prefers-reduced-motion`, durations become 0 and
the map stops animating layout.

## Theming and accessibility

Dark first, light equal. A high-contrast variant of each. Every text/background
token pair is checked by a test against WCAG 2.2 AA (4.5:1 text, 3:1 UI
borders and focus), and 7:1 for text in high contrast. Focus is always
visible (a 2 px current ring with an offset). Overlays trap focus and restore
it. Components follow the WAI-ARIA Authoring Practices patterns; axe runs on
the gallery and every view.

## Voice

Plain, specific, sentence case. Lead with the number. Say what happened and
what to do next: "No conventions yet. Run `drift init` to learn them." Never
blame, never celebrate, no exclamation marks. Drift's own text is quoted as
Drift wrote it.
