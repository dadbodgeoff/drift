# Complete Directory Map: Root & Configuration Files

## Root Directory
```
drift/
├── package.json                        # Root monorepo config (drift-v2 v0.9.47)
├── pnpm-workspace.yaml                 # pnpm workspace definition
├── pnpm-lock.yaml                      # Dependency lock
├── turbo.json                          # Turborepo pipeline config
├── tsconfig.json                       # Root TypeScript config
├── tsconfig.base.json                  # Shared TS config
├── vitest.config.ts                    # Root Vitest config
├── vitest.workspace.ts                 # Vitest workspace config
├── eslint.config.mjs                   # ESLint config
├── .prettierrc                         # Prettier config
├── .prettierignore                     # Prettier ignore
├── .gitignore                          # Git ignore
├── .driftignore                        # Drift ignore patterns
├── .dockerignore                       # Docker ignore
├── .env.example                        # Environment variable template
├── docker-compose.yml                  # Docker Compose config
├── Dockerfile                          # Docker build
├── LICENSE                             # Apache-2.0
├── README.md                           # Main readme
├── CHANGELOG.md                        # Changelog
├── SUPPORTED_LANGUAGES_FRAMEWORKS.md   # Language/framework support matrix
│
├── .github/                            # GitHub config (CI/CD workflows)
├── .kiro/                              # Kiro IDE config
├── .drift-backup-test/                 # Backup test data
├── .drift-backups/                     # Backup storage
│
├── actions/
│   └── drift-action/                   # GitHub Action for CI
│
├── infrastructure/
│   └── telemetry-worker/               # Telemetry collection worker
│
├── scripts/
│   ├── generate-large-codebase.ts      # Test codebase generator
│   ├── publish.sh                      # Publish script
│   ├── transform-detector.ts           # Detector transformation utility
│   ├── validate-docs.sh                # Documentation validation
│   └── validate-docs.ts                # Documentation validation (TS)
│
├── docs/                               # Documentation
├── wiki/                               # Wiki content
├── demo/                               # Demo projects
├── licenses/                           # Third-party licenses
└── skills/                             # Skill definitions
```

## Key Config Files Per Package
Each package has:
- `package.json` — Dependencies, scripts, exports
- `tsconfig.json` — TypeScript configuration
- Some have: `vitest.config.ts`, `vite.config.ts`, `postcss.config.js`, `tailwind.config.js`
