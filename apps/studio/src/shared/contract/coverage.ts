// What the Studio does with each of Drift's user-visible surfaces. The founder's rule:
// every addition to Drift ships with Studio support or a linked paired Studio PR.
// tests/unit/coverage.test.ts reads Drift's Rust sources and fails when a top-level
// `drift` subcommand, a rule kind or a skip reason is in neither column here, so a
// new one fails CI until the Studio handles it or this file says why it need not.

export type Coverage = { studio: string } | { allow: string };

/** Top-level `drift` subcommands (crates/drift-cli/src/main.rs `enum Command`, hidden ones excepted). */
export const COMMANDS: Record<string, Coverage> = {
  scan: { studio: "drift scan --out: facts for Attention, Map, Security and the code drawer" },
  facts: { allow: "one file's facts, for agents and debugging; the Studio reads the full scan" },
  init: { studio: "Conventions: Run drift init (confirmed)" },
  census: { studio: "Conventions and Attention: census --json (proposals, tiers, evidence, outliers)" },
  review: { studio: "Conventions: accept, reject, block, block --force (suggestions) and advise; a block candidate's one question (--json, --answer)" },
  example: { allow: "what agents copy; the Studio shows the same example from census and check JSON" },
  check: { studio: "Check: --format json, and --diff-base for pull requests" },
  security: { studio: "Security: security --json (entry points, shared guards, exposure), and --diff-base for pull requests (Changes since base)" },
  card: { allow: "one file's place for an agent about to touch it (also the MCP tool drift_card, text); --json (schema 1, contract DriftCard) adds every convention covering the file, accepted or proposed, with status and mode. The Studio shows the same facts in Security and the code drawer (the drawer's drift card block, built from security --json and the policy); reading card --json there is the Practices/Security view work of round 13. Not shown: the card's `regularities` (strong mined regularities of the file's roles, stated to agents as facts; contract CardRegularity) its preview practice lines and its `Defined elsewhere too` lines (the file's helpers other files define too; both text only)" },
  map: { studio: "Map: the graph is drawn from drift scan; a package's panel reads map --json for its production (`depends_on`) and test (`dependencies_test`) dependencies apart (contract MapPackage)" },
  hook: { studio: "Sessions: hook messages in transcripts and .drift/cache/sessions state" },
  mcp: { allow: "agents' tool server over the same data census and check give the Studio: the lookups read only; drift_setup_answer and drift_investigate_record write an agent's answer or outcome (to .drift/config.yaml, one that would make a fact waiting for a person, or a local finding or gap report), and drift_verify_card writes verdicts to .drift/verify-cache.json" },
  export: { allow: "writes AGENTS.md for agents, and Claude Code permission entries (claude-settings); an Agents & CI view is proposed in docs/DESIGN.md" },
  setup: { allow: "the questions only a person can answer (test stacks, Terraform ties, checks to confirm), written to .drift/config.yaml; setup --json (schema drift-setup-questions, contract DriftSetupQuestions) is ready for a Setup screen, not built yet" },
  investigate: { allow: "every route Drift could not settle, grouped by what would settle it, with evidence, and the outcomes an agent or a person records (fact-making ones wait for setup --review); investigate --json (schema drift-investigate, contract DriftInvestigate; with --limit one page in short, schema drift-investigate-page, contract DriftInvestigatePage) is ready for a screen, not built yet" },
  findings: { allow: "local findings and gap reports an agent wrote while investigating (.drift/findings, .drift/gap-reports, git-ignored, never posted); an issue draft or a local fix branch on a person's request; findings --json (schema drift-findings, contract DriftFindings) is ready for a screen, not built yet" },
  practices: { studio: "Practices (read-only): practices --json, the recipe per package and kind of entry point, the findings, and every concern's variants by share, where, what sets each apart and unknown with its config line; --units is for measurement, not shown" },
};

/** MCP tools (crates/drift-cli/src/mcp.rs, every `"name": "drift_…"`): what the Studio shows of each, or why it need not. */
export const MCP_TOOLS: Record<string, Coverage> = {
  drift_rules_for: { allow: "an agent's rules for one file; the Studio shows the same conventions from census and the policy (Conventions), and priming in Sessions" },
  drift_example: { allow: "what agents copy; the Studio shows the same example from census and check JSON" },
  drift_check: { studio: "Check runs drift check --format json; Sessions shows the advice agents got" },
  drift_explain: { allow: "one convention explained to an agent; Conventions shows the same card, evidence and exceptions" },
  drift_map: { allow: "agents' read-only structural map; the Map view draws the same facts from drift scan" },
  drift_card: { allow: "one file's place for an agent (text only); the code drawer's drift card block shows the same facts" },
  drift_security: { studio: "Security: the same inventory from security --json" },
  drift_verify_card: { allow: "experimental host-agent verification of hidden suggestions (agents.verify); no JSON the Studio reads" },
  drift_practices: { studio: "Practices: the recipe agents get for a file's package and kinds of entry point, from the same practices --json" },
  drift_setup_questions: { allow: "an agent's setup questions with their evidence, the same drift-setup-questions JSON as setup --json --evidence; no Studio screen yet (SYNC row)" },
  drift_setup_answer: { allow: "an agent answers a setup question (always as an agent: a fact-making answer waits under setup.proposed for setup --review); the Studio writes no config" },
  drift_investigate_items: { allow: "the routes Drift could not settle, grouped by what would settle them: without ids one page in short, the same drift-investigate-page JSON as investigate --json --limit (contract DriftInvestigatePage); with ids the same drift-investigate JSON as investigate --json --evidence --item; no Studio screen yet (SYNC row)" },
  drift_investigate_record: { allow: "an agent records an outcome for an open item (always as an agent: a fact-making outcome waits under setup.proposed for setup --review; findings and gap reports are local files); the Studio writes nothing" },
};

/** Skip reasons (crates/drift-core/src/facts.rs `enum SkipReason`) the Studio explains: see entities/facts SKIP_REASON. */
export const SKIP_REASONS_ALLOWED: Record<string, string> = {};

/** Rule kinds the Studio intentionally shows only as "Other" (none today); every other kind needs a family (entities/convention RULE_KIND_FAMILY). */
export const RULE_KINDS_ALLOWED: Record<string, string> = {};
