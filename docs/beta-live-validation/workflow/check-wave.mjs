// Validate wave.mjs the way the Workflow runtime loads it: meta hoisted out, body wrapped in an
// async function (which is what makes top-level await AND top-level return legal there).
// Then stub agent/pipeline/parallel/phase/log and assert the dispatch policy is what we intended.
import { readFileSync } from 'node:fs'

const SRC = new URL('./wave.mjs', import.meta.url)
const raw = readFileSync(SRC, 'utf8')
const body = raw.replace(/^export const meta = \{[\s\S]*?\n\}\n/m, '')
const metaSrc = raw.match(/^export const meta = (\{[\s\S]*?\n\})\n/m)?.[1]
if (!metaSrc) throw new Error('meta block not found or not a pure literal')
const meta = new Function(`return ${metaSrc}`)()

for (const k of ['name', 'description', 'phases']) if (!meta[k]) throw new Error(`meta.${k} missing`)
if (!/^[a-z0-9-]+$/.test(meta.name)) throw new Error('meta.name must be kebab-case')

async function run(args, { failing = 0 } = {}) {
  const calls = [], logs = []
  const g = {
    args,
    agent: async (prompt, o = {}) => {
      calls.push({ ...o, prompt })
      if (o.label?.startsWith('escalate:')) return { causes: [] }
      return {
        charter: o.label.split(':')[1], accepted: true, headline: 'h', suspects: [],
        unexplained_failures: Array.from({ length: failing }, (_, i) =>
          ({ probe: `P-x-0${i}`, what_you_ruled_out: 'x' })),
        discovered: [], not_covered: [],
      }
    },
    pipeline: async (items, ...stages) => {
      const out = []
      for (const it of items) { let v = it; for (const s of stages) v = await s(v, it, 0); out.push(v) }
      return out
    },
    parallel: async (thunks) => Promise.all(thunks.map((f) => f())),
    phase: () => {}, log: (m) => logs.push(m),
  }
  const fn = new Function(...Object.keys(g), `return (async () => { ${body} })()`)
  const result = await fn(...Object.values(g))
  return { calls, logs, result }
}

const problems = []
const ok = (c, m) => { if (!c) problems.push(m) }

// wave 2: seven charters, none deep, none exclusive
{
  const { calls, result } = await run({ wave: 2 })
  const exec = calls.filter((c) => c.label?.startsWith('charter:'))
  ok(exec.length === 6, `wave 2 has 6 charters, got ${exec.length}`)
  ok(exec.every((c) => c.model === 'sonnet' && c.effort === 'medium'), 'wave 2 is sonnet/medium')
  ok(calls.length === exec.length,
     `a clean wave must spawn ONE agent per charter and nothing else, got ${calls.length} for ${exec.length}`)
  ok(calls.every((c) => c.phase), 'every agent must declare a phase')
  ok(result.accepted.length === 6, `wave 2 should accept 6, got ${result.accepted.length}`)
}
// wave 6: investigative charters get opus/high, procedural ones do not
{
  const { calls } = await run({ wave: 6 })
  const exec = calls.filter((c) => c.label?.startsWith('charter:'))
  ok(exec.length === 3, `wave 6 should run 3 charters (10,11,14), got ${exec.length}`)
  const model = Object.fromEntries(exec.map((c) => [c.label, c.model]))
  ok(exec.every((c) => c.model === 'sonnet'),
     'EVERY charter runs on sonnet - opus is reserved for escalation and synthesis')
  const eff = Object.fromEntries(exec.map((c) => [c.label, c.effort]))
  ok(eff['charter:10'] === 'high' && eff['charter:11'] === 'high',
     'investigative charters get more THINKING, not a bigger model')
  ok(eff['charter:14'] === 'medium', 'procedural charters stay at medium effort')
}
// every exclusive charter must be alone in its own wave, or the wave can never run
{
  const src = readFileSync(SRC, 'utf8')
  const waves = new Function(`return ${src.match(/const WAVES = (\{[\s\S]*?\n\})/)[1].replace(/\/\/.*$/gm, '')}`)()
  const excl = new Function(`return ${src.match(/const EXCLUSIVE = new Set\((\[[^\]]*\])\)/)[1]}`)()
  for (const [w, cs] of Object.entries(waves))
    ok(!(cs.length > 1 && cs.some((c) => excl.includes(c))),
       `wave ${w} = [${cs}] mixes an exclusive charter with others — it can never run`)
}
// escalation fires only on what a charter could NOT explain itself
{
  const clean = await run({ wave: 4 }, { failing: 0 })
  ok(clean.calls.filter((c) => c.label?.startsWith('escalate:')).length === 0,
     'a charter that explained its own failures must spawn zero escalation agents')
  ok(clean.calls.length === 1, `a clean single-charter wave must be exactly 1 agent, got ${clean.calls.length}`)
  const dirty = await run({ wave: 4 }, { failing: 5 })
  const esc = dirty.calls.filter((c) => c.label?.startsWith('escalate:'))
  ok(esc.length === 1, `escalation is ONCE per charter regardless of count, got ${esc.length}`)
  ok(esc.every((c) => c.model === 'opus' && c.effort === 'high'), 'escalation must be opus/high')
  ok(dirty.calls.length === 2, `1 charter + 1 escalation = 2 agents, got ${dirty.calls.length}`)
}
// exclusivity guard must actually reject, for the right reason
{
  let msg = null
  try { await run({ charters: ['16', '03'] }) } catch (e) { msg = e.message }
  ok(msg && /must run alone/.test(msg), `exclusivity guard did not fire correctly (got: ${msg})`)
  let solo = null
  try { await run({ charters: ['16'] }) } catch (e) { solo = e.message }
  ok(solo === null, `charter 16 alone must be allowed, got: ${solo}`)
}
// prompts must carry the binding rules and must forbid the forensics report
{
  const { calls } = await run({ wave: 2 })
  const p = calls.find((c) => c.label === 'charter:01').prompt
  for (const must of ['assert-env', 'run-probe', 'workspace.sh', 'Do NOT read DRIFT-ARCHITECTURE',
                      'charter-probes', 'is a data point, NOT a stop'])
    ok(p.includes(must), `execute prompt is missing: ${must}`)
  ok(p.includes('validate-result'), 'the charter prompt must end at validate-result')
  ok(p.includes('LEDGER IS THE SOURCE OF TRUTH'), 'the charter prompt must pin the ledger as truth')
  ok(p.includes('unexplained_failures'), 'the charter must be told to trace its own failures first')
}
// exclusive charters must be told to take the lock and assert machine state
{
  const { calls } = await run({ wave: 4 })
  const p = calls.find((c) => c.label === 'charter:16').prompt
  ok(p.includes('quiet-lock.sh acquire'), 'charter 16 prompt must acquire the machine lock')
  ok(p.includes('machine-state --assert'), 'charter 16 prompt must assert machine state')
}

if (problems.length) { console.log('WAVE CHECK FAILED'); problems.forEach((p) => console.log('  - ' + p)); process.exit(1) }
console.log(`wave.mjs ok · meta valid · ${meta.phases.length} phases · dispatch policy, escalation`)
console.log('              gating, exclusivity guard and prompt invariants all verified')
