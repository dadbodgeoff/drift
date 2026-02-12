# Cortex Test Suite

## Location
`packages/cortex/src/__tests__/`

## Test Categories

### Unit Tests
| Directory | Tests | Coverage |
|-----------|-------|----------|
| `decay/` | `calculator.test.ts` | Decay formula, boosters |
| `retrieval/` | `scoring.test.ts`, `weighting.test.ts` | Relevance scoring, intent weighting |
| `embeddings/` | `cache.test.ts`, `hybrid.test.ts`, `lexical.test.ts`, `semantic.test.ts`, `structural.test.ts` | All embedding strategies |
| `compression/` | `budget.test.ts`, `compressor.test.ts` | Compression levels, budget packing |
| `consolidation/` | `abstraction.test.ts` | Abstraction phase |
| `validation/` | `temporal-validator.test.ts` | Temporal staleness |
| `storage/` | `memory-storage.test.ts` | SQLite CRUD, queries |
| `session/` | `manager.test.ts`, `tracker.test.ts` | Session lifecycle, tracking |
| `utils/` | `hash-time.test.ts`, `id-generator.test.ts`, `tokens.test.ts` | Utilities |
| `types/` | `causal.test.ts`, `compressed-memory.test.ts` | Type validation |

### Learning Tests
| File | Coverage |
|------|----------|
| `learning/learning.test.ts` | Core learning flow |
| `learning/analyzer.test.ts` | Correction analysis |
| `learning/calibrator.test.ts` | Confidence calibration |
| `learning/factory.test.ts` | Memory creation from corrections |
| `learning/active-loop.test.ts` | Active learning loop |

### Causal Tests
| File | Coverage |
|------|----------|
| `causal/inference.test.ts` | Causal inference strategies |
| `causal/narrative.test.ts` | Narrative generation |
| `causal/storage.test.ts` | Causal edge persistence |
| `causal/traverser.test.ts` | Graph traversal |

### Prediction Tests
| File | Coverage |
|------|----------|
| `prediction/predictor.test.ts` | Prediction engine |
| `prediction/signals.test.ts` | Signal gathering |
| `prediction/cache.test.ts` | Prediction caching |

### Generation Tests
| File | Coverage |
|------|----------|
| `generation/builder.test.ts` | Context building |
| `generation/feedback.test.ts` | Feedback processing |
| `generation/provenance.test.ts` | Provenance tracking |
| `generation/validation.test.ts` | Generation validation |

### Orchestrator Tests
| File | Coverage |
|------|----------|
| `orchestrators/cortex-v2.test.ts` | CortexV2 unified API |
| `orchestrators/generation.test.ts` | Generation orchestrator |
| `orchestrators/learning.test.ts` | Learning orchestrator |
| `orchestrators/retrieval.test.ts` | Retrieval orchestrator |

### Integration Tests
| File | Coverage |
|------|----------|
| `integration/full-flow.test.ts` | End-to-end memory lifecycle |
| `integration/causal-narrative.test.ts` | Causal + narrative pipeline |
| `integration/learning-loop.test.ts` | Full learning cycle |
| `integration/token-efficiency.test.ts` | Token budget compliance |

### Stress Tests
| File | Coverage |
|------|----------|
| `stress/memory-scale.test.ts` | Large memory counts |
| `stress/mcp-integration.test.ts` | MCP tool stress testing |
| `stress/chaos.test.ts` | Random operations, error recovery |
| `stress/property-based.test.ts` | Property-based testing |

### Adversarial Tests
| File | Coverage |
|------|----------|
| `adversarial/critical-paths.test.ts` | Critical path failure modes |
| `adversarial/deep-modules.test.ts` | Deep module interactions |
| `adversarial/edge-cases.test.ts` | Edge cases and boundary conditions |

## Test Framework
Vitest with SQLite test database support and mock embedding providers.
