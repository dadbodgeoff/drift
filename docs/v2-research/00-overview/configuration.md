# Configuration System

## Config File
`drift.config.json` in project root.

```json
{
  "severity": {
    "pattern-id": "warning"
  },
  "ignore": ["legacy/", "generated/"],
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "ci": {
    "failOn": "error",
    "reportFormat": "github"
  },
  "learning": {
    "autoApproveThreshold": 0.85,
    "minOccurrences": 3
  },
  "performance": {
    "maxWorkers": 4,
    "cacheEnabled": true,
    "incrementalAnalysis": true
  }
}
```

## Config Loading
1. Load from `drift.config.json` (or `.driftrc.json`, `.driftrc`)
2. Merge with defaults
3. Apply environment variable overrides (`DRIFT_AI_PROVIDER`, `DRIFT_CI_FAIL_ON`, etc.)
4. Validate with `ConfigValidator`

## .driftignore
Gitignore-compatible pattern file. Default patterns:
```
node_modules/
dist/
build/
coverage/
.idea/
.vscode/
*.log
```

## .drift/ Directory
Created by `drift init` or `drift setup`. Contains:
```
.drift/
├── patterns/           # Pattern JSON files (legacy)
├── contracts/          # Contract JSON files (legacy)
├── history/            # Pattern history
├── variants/           # Pattern variants
├── constraints/        # Constraint definitions
├── dna/                # DNA profiles
├── callgraph/          # Call graph shards
├── boundaries/         # Boundary data
├── constants/          # Constants analysis
├── environment/        # Environment analysis
├── test-topology/      # Test topology
├── wrappers/           # Wrapper detection
├── decisions/          # Decision mining
├── quality-gates/      # Gate results
├── learning/           # Learning data
├── lake/               # Data lake (shards, views, indexes)
├── memory/             # Cortex memory database
├── drift.db            # Unified SQLite database
└── config.json         # Project-specific config
```
