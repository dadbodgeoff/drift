# CIBench — Codebase Intelligence Benchmark

## Location
`packages/cibench/` — TypeScript

## What It Is
A novel benchmark framework for measuring how well tools understand codebases (not just navigate them). Uses a 4-level hierarchical evaluation: Perception, Understanding, Application, Validation. Designed to differentiate tools that truly comprehend code from those that just pattern-match.

## Key Innovation
Unlike SWE-bench (code generation, binary pass/fail), CIBench measures code comprehension with graduated accuracy, calibration measurement, and counterfactual evaluation.

## Architecture

```
┌─────────────────────────────────────────┐
│              CLI (cli-v2.ts)             │
│  run │ compare │ report                  │
├──────────┬──────────────────────────────┤
│ Adapters │        Evaluator              │
│ Drift    │  PerceptionScorer             │
│ Baseline │  UnderstandingScorer          │
│          │  ApplicationScorer            │
│          │  CalibrationMeasurer          │
│          │  ProbeEvaluator               │
├──────────┴──────────────────────────────┤
│              Schema Layer                │
│  v1: patterns│callgraph│dataflow│impact  │
│  v2: perception│understanding│application│
│      probes│manifest                     │
├─────────────────────────────────────────┤
│              Test Corpus                 │
│  demo-backend │ typescript-express        │
│  competitive-intelligence-api            │
└─────────────────────────────────────────┘
```

## File Map

### CLI
| File | Purpose |
|------|---------|
| `src/cli.ts` | v1 CLI |
| `src/cli-v2.ts` | v2 CLI with 4-level evaluation |

### Adapters
| File | Purpose |
|------|---------|
| `src/adapters/drift-adapter.ts` | Drift MCP tool adapter |
| `src/adapters/baseline-adapter.ts` | File-read-only baseline |

### Evaluator v1
| File | Purpose |
|------|---------|
| `src/evaluator/scorer.ts` | Precision, recall, F1 scoring |
| `src/evaluator/types.ts` | Evaluation types |

### Evaluator v2
| File | Purpose |
|------|---------|
| `src/evaluator/v2/perception-scorer.ts` | Level 1: Pattern recognition, call graph accuracy |
| `src/evaluator/v2/understanding-scorer.ts` | Level 2: Architectural intent, causal reasoning |
| `src/evaluator/v2/application-scorer.ts` | Level 3: Token efficiency, compositional reasoning |
| `src/evaluator/v2/calibration.ts` | ECE/MCE calibration measurement |
| `src/evaluator/v2/probe-evaluator.ts` | Generative probe evaluation |
| `src/evaluator/v2/types.ts` | v2 type definitions |

### Schema v1
| File | Purpose |
|------|---------|
| `src/schema/patterns.ts` | Pattern ground truth |
| `src/schema/callgraph.ts` | Call graph ground truth |
| `src/schema/dataflow.ts` | Data flow ground truth |
| `src/schema/impact.ts` | Impact analysis ground truth |
| `src/schema/conventions.ts` | Convention ground truth |
| `src/schema/agentic.ts` | Agentic task ground truth |
| `src/schema/manifest.ts` | Corpus manifest |

### Schema v2
| File | Purpose |
|------|---------|
| `src/schema/v2/perception.ts` | Level 1 ground truth schema |
| `src/schema/v2/understanding.ts` | Level 2 ground truth schema |
| `src/schema/v2/application.ts` | Level 3 ground truth schema |
| `src/schema/v2/probes.ts` | Probe definitions |
| `src/schema/v2/manifest.ts` | v2 manifest |

## Scoring Framework

```
CIBench Score = Σ(level_score × level_weight)

Level 1 (Perception):     30%  — Pattern recognition, call graph, data flow
Level 2 (Understanding):  35%  — Architectural intent, causal reasoning, uncertainty
Level 3 (Application):    25%  — Token efficiency, compositional reasoning, negative knowledge
Level 4 (Validation):     10%  — Human correlation
```

## Novel Features

### Counterfactual Evaluation
"What would happen if we removed this function?" — Tests causal understanding, not just pattern matching.

### Calibration Measurement
- ECE (Expected Calibration Error): Average miscalibration
- MCE (Maximum Calibration Error): Worst-case miscalibration
- Overconfidence/underconfidence rates

### Generative Probes
Open-ended questions scored against expected concepts, with misconception penalties.

### Adversarial Robustness
Misleading variable names, dead code, outdated comments, framework "magic."

### Negative Knowledge
Tests whether tools know what NOT to do — anti-patterns, danger zones, noise files.

## Test Corpus
Located in `corpus/`:
- `demo-backend/` — Express API with intentional patterns and violations
- `typescript-express/` — Standard Express app
- `competitive-intelligence-api/` — Complex multi-layer API

Each corpus has `.cibench/` with ground truth:
```
.cibench/
├── manifest.json
├── perception/
│   ├── patterns.json
│   ├── callgraph.json
│   └── dataflow.json
├── understanding/
│   ├── intent.json
│   ├── causal.json
│   └── uncertainty.json
├── application/
│   ├── efficiency.json
│   ├── compositional.json
│   └── negative.json
├── probes/
│   ├── explanation.json
│   ├── prediction.json
│   └── adversarial.json
└── validation/
    └── human-judgments.json
```

## Benchmark Protocol
See `BENCHMARK_PROTOCOL.md` for the manual benchmark procedure:
- 8 tasks, scored 0-2 each (16 points max)
- Run WITH Drift vs WITHOUT Drift (baseline)
- Expected: Drift 16/16, Baseline 8-11/16
- Key differentiator: Task 3 (missing auth) — grep can't find code that doesn't exist

## v2 Considerations
- Benchmark framework is highly valuable — keep and extend
- Add Rust analysis benchmarks (parsing speed, call graph accuracy)
- Extend corpus with more languages (Python, Java, Go)
- Consider automated benchmark runs in CI
- Calibration measurement is novel — publish as research
