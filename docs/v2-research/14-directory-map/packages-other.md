# Complete Directory Map: Other Packages

## packages/cortex/
```
src/
├── index.ts
├── cortex.ts                           # Main orchestrator
├── types/                              # 25+ memory types
│   ├── index.ts
│   ├── core-memory.ts, memory.ts
│   ├── tribal-memory.ts, procedural-memory.ts, semantic-memory.ts
│   ├── episodic-memory.ts, decision-memory.ts, conversation-memory.ts
│   ├── entity-memory.ts, environment-memory.ts, goal-memory.ts
│   ├── incident-memory.ts, meeting-memory.ts, skill-memory.ts
│   ├── workflow-memory.ts, feedback-memory.ts, agent-spawn-memory.ts
│   ├── code-smell.ts, preference-memory.ts, insight-memory.ts
│   ├── reference-memory.ts, pattern-rationale.ts
│   ├── constraint-override.ts, decision-context.ts
│   ├── compressed-memory.ts, bitemporal.ts, causal.ts
│   ├── citation.ts, generation-context.ts, session-context.ts
│   ├── learning.ts, prediction.ts
├── storage/ (factory.ts, interface.ts, sqlite/)
├── embeddings/ (local.ts, openai.ts, ollama.ts, lexical/, semantic/, structural/, hybrid/, cache/)
├── retrieval/ (engine.ts, ranking.ts, scoring.ts, weighting.ts, budget.ts, compression.ts)
├── learning/ (correction-extractor.ts, fact-extractor.ts, preference-learner.ts, outcome-tracker.ts, active/, analysis/, confidence/, factory/)
├── consolidation/ (engine.ts, abstraction.ts, strengthening.ts, pruning.ts, replay.ts, scheduler.ts, adaptive-scheduler.ts, integration.ts)
├── causal/ (inference/, narrative/, storage/, traversal/)
├── prediction/ (predictor/, signals/, cache/, types.ts)
├── compression/ (budget/, compressor/, types.ts)
├── contradiction/ (detector.ts, propagator.ts)
├── decay/ (calculator.ts, half-lives.ts, boosters.ts)
├── generation/ (context/, feedback/, provenance/, validation/, types.ts)
├── linking/ (constraint-linker.ts, decision-linker.ts, file-linker.ts, function-linker.ts, pattern-linker.ts)
├── orchestrators/ (cortex-v2.ts, generation-orchestrator.ts, learning-orchestrator.ts, retrieval-orchestrator.ts)
├── privacy/ (sanitizer.ts, validator.ts, patterns.ts)
├── session/ (context/, storage/, types.ts)
├── validation/ (engine.ts, citation-validator.ts, contradiction-detector.ts, temporal-validator.ts, pattern-alignment.ts, healing.ts)
├── why/ (synthesizer.ts, decision-context.ts, pattern-context.ts, tribal-context.ts, warning-aggregator.ts)
├── cache/ (l1-memory.ts, l2-index.ts, l3-shard.ts, preloader.ts)
└── utils/ (hash.ts, id-generator.ts, time.ts, tokens.ts)
```

## packages/mcp/
```
src/
├── index.ts
├── enterprise-server.ts                # Full MCP server
├── feedback.ts                         # Feedback collection
├── packs.ts                            # Tool pack definitions
├── bin/
│   ├── server.ts                       # stdio entry point
│   └── http-server.ts                  # HTTP entry point
├── infrastructure/
│   ├── index.ts
│   ├── cache.ts, cursor-manager.ts, error-handler.ts
│   ├── metrics.ts, project-resolver.ts, rate-limiter.ts
│   ├── response-builder.ts, startup-warmer.ts
│   ├── token-estimator.ts, tool-filter.ts
├── tools/
│   ├── index.ts, registry.ts
│   ├── analysis/ (18 files: audit, constants, constraints, coupling, cpp, decisions, error-handling, go, java, php, python, quality-gate, rust, simulate, test-topology, typescript, wpf)
│   ├── curation/ (audit-store.ts, handler.ts, verifier.ts, types.ts)
│   ├── detail/ (code-examples.ts, dna-profile.ts, file-patterns.ts, files-list.ts, impact-analysis.ts, pattern-get.ts, reachability.ts, wrappers.ts)
│   ├── discovery/ (capabilities.ts, projects.ts, status.ts)
│   ├── exploration/ (contracts-list.ts, env.ts, patterns-list.ts, security-summary.ts, trends.ts)
│   ├── generation/ (explain.ts, suggest-changes.ts, validate-change.ts)
│   ├── memory/ (33 files: add, agent-spawn, conflicts, consolidate, contradictions, conversation, delete, entity, environment, explain, export, feedback, for-context, get, goal, graph, health, import, incident, learn, meeting, predict, query, search, skill, status, suggest, update, validate, warnings, why, workflow)
│   ├── orchestration/ (context.ts, package-context.ts)
│   ├── setup/ (handler.ts, telemetry-handler.ts)
│   └── surgical/ (callers.ts, dependencies.ts, errors.ts, hooks.ts, imports.ts, middleware.ts, prevalidate.ts, recent.ts, signature.ts, similar.ts, test-template.ts, type.ts)
```

## packages/cli/
```
src/
├── index.ts
├── bin/drift.ts                        # Entry point
├── commands/ (~45 command files + setup/runners/)
├── services/ (scanner-service.ts, boundary-scanner.ts, contract-scanner.ts, pattern-service-factory.ts, backup-service.ts)
├── reporters/ (github-reporter.ts, gitlab-reporter.ts, json-reporter.ts, text-reporter.ts, types.ts)
├── ui/ (progress.ts, spinner.ts, table.ts, prompts.ts, project-indicator.ts)
├── git/ (hooks.ts, staged-files.ts)
├── workers/ (detector-worker.ts)
└── types/ (index.ts)
```

## packages/lsp/
```
src/
├── index.ts, server.ts, capabilities.ts
├── bin/server.ts
├── handlers/ (initialize.ts, diagnostics.ts, code-actions.ts, code-lens.ts, hover.ts, document-sync.ts, commands.ts)
├── commands/ (approve-pattern.ts, create-variant.ts, explain-ai.ts, fix-ai.ts, ignore-once.ts, ignore-pattern.ts, rescan.ts, show-patterns.ts, show-violations.ts)
├── integration/ (core-scanner.ts, pattern-store-adapter.ts, types.ts)
├── server/ (index.ts, types.ts)
├── types/ (index.ts, lsp-types.ts)
└── utils/ (diagnostic.ts, document.ts, position.ts, workspace.ts)
```

## packages/vscode/
```
src/
├── extension.ts                        # Extension entry point
├── activation/ (activation-controller.ts, activation-phases.ts)
├── client/ (connection-manager.ts, language-client-factory.ts, connection-config.ts, request-middleware.ts)
├── commands/ (command-definitions.ts, command-router.ts, handlers/, middleware/)
├── config/ (config-manager.ts, defaults.ts, validator.ts)
├── infrastructure/ (service-container.ts, event-bus.ts, logger.ts, disposable-manager.ts)
├── state/ (state-manager.ts, selectors.ts, initial-state.ts)
├── types/ (config-types.ts, extension-types.ts, lsp-types.ts, state-types.ts, vscode-types.ts)
├── ui/ (decorations/, notifications/, status-bar/)
├── views/ (patterns-tree-provider.ts, violations-tree-provider.ts, files-tree-provider.ts, constants-tree-provider.ts, base-tree-provider.ts)
└── webview/ (webview-manager.ts)
```

## packages/dashboard/
```
src/
├── server/ (dashboard-server.ts, express-app.ts, api-routes.ts, drift-data-reader.ts, pattern-watcher.ts, websocket-server.ts, galaxy-data-transformer.ts, quality-gates-api.ts)
└── client/ (App.tsx, main.tsx, components/, hooks/, store/, types.ts)
    └── components/ (OverviewTab, PatternsTab, ViolationsTab, ContractsTab, BoundariesTab, ConstantsTab, FilesTab, GalaxyTab, QualityGatesTab, SettingsTab, ProjectSwitcher, trends/, ErrorBoundary)
```

## packages/ai/
```
src/
├── index.ts
├── providers/ (base-provider.ts, anthropic-provider.ts, openai-provider.ts, ollama-provider.ts, types.ts)
├── prompts/ (explain-prompt.ts, fix-prompt.ts)
├── context/ (code-extractor.ts, context-builder.ts, sanitizer.ts)
├── confirmation/ (consent.ts, preview.ts)
└── types/ (ai-types.ts)
```

## packages/ci/
```
src/
├── index.ts, types.ts
├── bin/drift-ci.ts
├── agent/pr-analyzer.ts
├── integration/drift-adapter.ts
├── providers/ (github.ts, gitlab.ts)
└── reporters/ (github-comment.ts, sarif.ts)
```

## packages/galaxy/
```
src/
├── index.ts
├── audio/ (sound-effects.ts, useGalaxySound.ts, jsfxr.d.ts)
├── components/ (canvas/, connections/, effects/, nodes/, ui/)
├── hooks/ (useAccessStream.ts, useGalaxyData.ts)
├── store/ (galaxy-store.ts)
├── constants/
├── types/
└── utils/ (color-utils.ts, geometry-utils.ts, layout-engine.ts)
```

## packages/cibench/
```
src/
├── index.ts, cli.ts, cli-v2.ts
├── adapters/
├── evaluator/
└── schema/
corpus/ (competitive-intelligence-api/, demo-backend/, typescript-express/)
results/ (baseline-real.json, drift-real.json, etc.)
```
