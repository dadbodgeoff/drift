export const meta = {
  name: 'drift-beta-wave',
  description: 'Execute beta live-validation charters, escalate only what failed, assemble results',
  whenToUse: 'Run one wave of the Drift beta live-validation program. Pass args: {wave, charters}.',
  phases: [
    { title: 'Charters',  detail: 'one agent per charter: probes, results file, validate-result' },
    { title: 'Escalate',  detail: 'only for failures a charter could not explain itself' },
  ],
}

// ---------------------------------------------------------------- configuration
const WAVES = {
  1: ['22'],
  2: ['01', '04', '05', '17', '19', '20'],   // 03 completed 2026-08-19, results accepted
  3: ['02', '06', '08', '09'],
  '3b': ['12', '13', '18', '21'],
  4: ['16'],
  5: ['07'],
  6: ['10', '11', '14'],
  7: ['15'],            // exclusive: N>=30 fresh cold scans, machine to itself
}
// Charters that reason more than they execute. They get MORE THINKING, not a bigger model:
// reconciling a contradiction, hunting a false pass, judging whether a proof justifies a verdict.
const DEEP = new Set(['07', '10', '11', '15', '16'])
// Take the machine alone. Anything concurrent invalidates them.
const EXCLUSIVE = new Set(['15', '16', '22'])

const wave = args?.wave ?? 2
const charters = args?.charters ?? WAVES[wave]
if (!charters?.length) throw new Error(`no charters for wave ${wave}`)
if (charters.length > 1 && charters.some((c) => EXCLUSIVE.has(c)))
  throw new Error(`charters ${[...EXCLUSIVE].join(',')} must run alone; got ${charters.join(',')}`)

const ENV = args?.env ?? '~/drift-beta-freeze/env.sh'
// EVERY charter runs on Sonnet.
//
// The original policy put five charters on Opus because they "require judgment". Most of that
// judgment has since moved into the harness: `run-probe` computes the verdict from a declared
// oracle, `bench` decides whether a timing sample is usable, `validate-result` checks coverage and
// ledger fidelity, `route-oracle` and `scope-oracle` supply ground truth. What remains is running a
// prescriptive brief and reading the files it cites by line number.
//
// Charter 03 is the evidence: 45 probes, 9 oracle failures, and the hardest call in the whole run
// was recognising `missing_contract` as a documented exit-3 refusal rather than a defect - reading
// comprehension over a table the charter cites directly.
//
// Context is not the constraint either: `run-probe` bounds every probe's output to ~20 lines and
// puts the rest on disk, which is why a 45-probe charter fits comfortably.
//
// Opus is kept for exactly two jobs, both demand-driven rather than assumed:
//   - escalation: by construction, only what a Sonnet charter could NOT explain itself
//   - synthesis:  reading every results file at once and finding cross-charter contradictions
//
// This makes the policy testable rather than asserted. If Sonnet is sufficient, the escalation rate
// trends to zero and we will have measured that. If it is not, escalations rise and name the
// charters where it fell short - which is a better answer than either of us arguing it in advance.
const modelFor  = () => 'sonnet'
const effortFor = (c) => (DEEP.has(c) ? 'high' : 'medium')

// ---------------------------------------------------------------- schemas
const CHARTER_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['charter', 'accepted', 'headline', 'suspects', 'unexplained_failures', 'not_covered'],
  properties: {
    charter: { type: 'string' },
    accepted: { type: 'boolean', description: 'Did validate-result accept the results file?' },
    validator_output: { type: 'string' },
    headline: { type: 'string' },
    suspects: {
      type: 'array',
      items: { type: 'object', required: ['id', 'disposition'],
               properties: { id: { type: 'string' },
                             disposition: { enum: ['CONFIRMED','REFUTED','NOT_REACHABLE','INCONCLUSIVE'] } } },
    },
    unexplained_failures: {
      type: 'array',
      description: 'ONLY failures you could not trace to a cause yourself. Empty is the good case.',
      items: { type: 'object', required: ['probe', 'what_you_ruled_out'],
               properties: { probe: { type: 'string' }, what_you_ruled_out: { type: 'string' } } },
    },
    discovered: { type: 'array', items: { type: 'string' } },
    not_covered: { type: 'array', items: { type: 'string' } },
  },
}

const PROBE_LOG_UNUSED = {
  type: 'object', additionalProperties: false,
  required: ['charter', 'probes_run', 'suspects', 'discovered', 'not_covered', 'headline'],
  properties: {
    charter: { type: 'string' },
    headline: { type: 'string', description: 'One paragraph: what is now known that was not before.' },
    probes_run: { type: 'array', items: { type: 'string' }, description: 'Probe ids executed.' },
    probes_blocked: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' } },
      },
    },
    suspects: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'disposition', 'evidence'],
        properties: {
          id: { type: 'string' },
          disposition: { enum: ['CONFIRMED', 'REFUTED', 'NOT_REACHABLE', 'INCONCLUSIVE'] },
          evidence: { type: 'string', description: 'Probe ids and artifact paths.' },
          fixed_by_commit: { type: 'string', description: 'If REFUTED because already fixed.' },
        },
      },
    },
    discovered: { type: 'array', items: { type: 'string' } },
    not_covered: { type: 'array', items: { type: 'string' } },
  },
}

const CAUSE = {
  type: 'object', additionalProperties: false,
  required: ['probe_id', 'established', 'cause', 'blast_radius', 'reproduction'],
  properties: {
    probe_id: { type: 'string' },
    established: { type: 'boolean' },
    cause: { type: 'string', description: 'Must cite file:line, or state "cause not established".' },
    ruled_out: { type: 'array', items: { type: 'string' } },
    blast_radius: { type: 'string' },
    reproduction: { type: 'string', description: 'Shortest command sequence from a clean state.' },
  },
}

// ---------------------------------------------------------------- prompts
const RULES = `
BINDING RULES — these are the difference between a measurement and a pile of transcripts:
1. You do NOT edit product source, update any baseline JSON, or fix anything. An agent that
   patches a bug to unblock itself has destroyed the measurement. Record it and route around.
2. A failing probe is a data point, NOT a stop. Record it and continue. A charter that stops at
   its first failure has failed.
3. Run EVERY command through \`run-probe\`, never bare. Declare the oracle as assertions
   (--expect-exit / --expect-out / --refute-out / --expect-json ...) so the verdict is computed,
   not argued. A probe with no assertion is recorded UNJUDGED and counts against you.
4. Benchmarks go through \`bench\`, never through your own timing loop.
5. Every mutating probe gets its own state root: eval "$(workspace.sh <charter> <probe> ...)".
6. Disposition EVERY suspect in the charter's section 8. None may be omitted.
7. Do NOT read DRIFT-ARCHITECTURE-FORENSICS-REPORT.md, and do not sweep the codebase. The charter
   carries every citation you need; reading more costs context and buys nothing.
8. Anything outside your charter's scope: note it in "discovered", do not chase it.
Your final output is DATA, not a report. The results file is written by a later stage from the
ledger you produce.`

const charterPrompt = (c) => `
You are running CHARTER ${c} of the Drift beta live-validation program.

START WITH EXACTLY:
  source ${ENV} && assert-env
If assert-env refuses, stop and report the refusal as your headline. Do not improvise around it.

Read docs/beta-live-validation/${c}-*.md and execute it as written. Also read
docs/beta-live-validation/00-PREFLIGHT.md section 5 (evidence protocol). Nothing else.
${EXCLUSIVE.has(c) ? `
This charter requires the machine to itself:
  quiet-lock.sh acquire ${c} && trap 'quiet-lock.sh release ${c}' EXIT
  machine-state --assert     # refuse to benchmark a machine that will lie to you
` : ''}
Run every probe the charter names. \`charter-probes ${c}\` prints the canonical list.

THEN, in the same session:
  1. Trace every failed probe to a cause yourself, to file:line. First decide whether the PRODUCT
     misbehaved or your ORACLE was too narrow - a documented refusal (exit 3 with a
     FAILURE_CONTRACT code) against an oracle that only allowed 0 is your error. Use
     \`--expect-exit-any 0,3\` where both outcomes are legitimate.
  2. Write the results file to docs/beta-live-validation/results/${c}-<slug>.md from
     RESULTS-TEMPLATE.md. THE LEDGER IS THE SOURCE OF TRUTH - every exit code you write must be the
     one it recorded; \`validate-result ${c}\` cross-checks and rejects on any disagreement.
  3. Run \`validate-result ${c}\` and fix whatever it rejects. Return its final output.

Report in \`unexplained_failures\` ONLY what you genuinely could not trace, with what you ruled
out. That list is what gets a second, deeper pass - so an empty list should mean you did the work,
not that you skipped it.
${RULES}`

const causePrompt = (c, p) => `
A probe in CHARTER ${c} did not match its oracle. Establish WHY, to file:line.

  probe:    ${p.probe}
  command:  ${Array.isArray(p.command) ? p.command.join(' ') : p.command}
  exit:     ${p.exit_code}${p.timed_out ? '  (TIMED OUT)' : ''}
  verdict:  ${p.verdict}
  failed checks: ${JSON.stringify((p.checks ?? []).filter((x) => !x.ok))}
  stdout:   ${p.stdout_path}
  stderr:   ${p.stderr_path}

source ${ENV} first. Read the artifacts. Use \`replay ${c} ${p.probe}\` to re-run it, and
\`replay ${c} ${p.probe} --rerun\` to check whether it even reproduces.

Trace the cause into the source at $DRIFT_BETA_SRC. Cite file:line. If you cannot establish the
cause, say "cause not established" and list exactly what you ruled out — a confident guess is
worse here than an honest gap. Do not fix anything. Do not read the forensics report.`

const escalatePrompt = (c, batch) => `
CHARTER ${c} ran, traced what it could, and could NOT establish a cause for the following.
Establish WHY for each, to file:line. They may share a cause - say so if they do, rather than repeating it.

${batch.map((p) => `  ${p.probe}
    the charter already ruled out: ${p.what_you_ruled_out}`).join('\n')}

Read its ledger row and artifacts: jq 'select(.probe=="<id>")' $DRIFT_BETA_LEDGER/${c}.jsonl

source ${ENV} first. Read the artifacts before theorising; \`replay ${c} <probe>\` re-runs one.

FIRST, for each: decide whether the PRODUCT misbehaved or the PROBE'S ORACLE was too narrow. A
documented refusal (exit 3 with a FAILURE_CONTRACT code) against an oracle that only allowed 0 is
the charter's error, not a defect — say so plainly and move on. Charter 03 had six of those.

For real defects, trace the cause into $DRIFT_BETA_SRC and cite file:line. If you cannot establish
it, say "cause not established" and list what you ruled out. Do not fix anything.`

const assemblePrompt = (c, log, causes) => `
Write the results file for CHARTER ${c}.

  source ${ENV}
  Template:  docs/beta-live-validation/RESULTS-TEMPLATE.md   (section order is load-bearing)
  Write to:  docs/beta-live-validation/results/${c}-<charter-slug>.md
  Ledger:    $DRIFT_BETA_LEDGER/${c}.jsonl and ${c}.bench.jsonl

THE LEDGER IS THE SOURCE OF TRUTH, not the summary below. Every exit code you write must be the
exit code the ledger recorded — \`validate-result ${c}\` cross-checks them and rejects the file on
any disagreement. Never restate a number you did not read out of the ledger.

Agent's structured log:
${JSON.stringify(log, null, 1)}

Cause traces for probes that failed:
${JSON.stringify(causes, null, 1)}

Every measurement must carry its trial count and spread, taken from the bench ledger. Every
suspect in the charter's section 8 must appear in section 4 with a disposition. Long output is
referenced by artifact path, never pasted beyond 20 lines.

Finish by running \`validate-result ${c}\` and fixing whatever it rejects. Return its final output.`

// ---------------------------------------------------------------- run
phase('Charters')
log(`wave ${wave}: ${charters.join(', ')}  (deep: ${charters.filter((c) => DEEP.has(c)).join(', ') || 'none'})`)

// ONE agent per charter. It runs the probes, writes its own results file, and puts that file
// through `validate-result` itself.
//
// This replaced a four-stage pipeline (execute -> collect -> cause -> assemble) that spawned 4
// agents per charter. Two of those stages did not need a model at all: `collect` existed to run a
// jq query over a ledger the executing agent had just written, and `assemble` re-read that same
// ledger to write it up. The pipeline pattern came from the tool's own examples rather than from
// the work, and it tripled the agent count for no measurement gained.
const results = await pipeline(
  charters,

  (c) => agent(charterPrompt(c), {
    label: `charter:${c}`, phase: 'Charters', schema: CHARTER_RESULT,
    model: modelFor(c), effort: effortFor(c),
  }),

  // Escalate ONLY what the charter itself could not explain, once per charter. A Sonnet agent that
  // traced its own failures to file:line needs no help; one that says "cause not established" does.
  async (r, c) => {
    if (!r) return { charter: c, accepted: false, note: 'charter agent returned nothing' }
    const open_ = (r.unexplained_failures ?? []).filter(Boolean)
    if (!open_.length) return r
    log(`charter ${c}: ${open_.length} failure(s) the charter could not explain - escalating once`)
    const deep = await agent(escalatePrompt(c, open_), {
      label: `escalate:${c}`, phase: 'Escalate', model: 'opus', effort: 'high',
      schema: { type: 'object', required: ['causes'],
                properties: { causes: { type: 'array', items: CAUSE } } },
    })
    return { ...r, escalated: deep?.causes ?? [] }
  },
)

phase('Escalate')
const clean = results.filter(Boolean).filter((r) => r.accepted).map((r) => r.charter)
const dirty = results.filter(Boolean).filter((r) => !r.accepted).map((r) => r.charter)
log(`accepted: ${clean.join(', ') || 'none'}`)
if (dirty.length) log(`NEEDS A HUMAN: ${dirty.join(', ')}`)

return {
  wave, charters, accepted: clean, rejected: dirty,
  next: 'run `ledger-sweep` before starting the next wave — it checks completeness, cross-charter ' +
        'exit-code contradictions, and that every probe ran against one subject',
}
