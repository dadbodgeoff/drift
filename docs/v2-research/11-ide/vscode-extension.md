# VSCode Extension

## Location
`packages/vscode/`

## Architecture

### Activation (`activation/`)
- `activation-controller.ts` — Extension activation orchestration
- `activation-phases.ts` — Phased activation (lazy loading)

### LSP Client (`client/`)
- `connection-manager.ts` — LSP connection lifecycle
- `language-client-factory.ts` — Client creation
- `connection-config.ts` — Connection configuration
- `request-middleware.ts` — Request interception

### Commands (`commands/`)
- `command-definitions.ts` — All command definitions
- `command-router.ts` — Command routing
- Handlers: `pattern-handlers.ts`, `scan-handlers.ts`, `violation-handlers.ts`, `connection-handlers.ts`, `constants-handlers.ts`, `ui-handlers.ts`
- Middleware: `connection-check-middleware.ts`, `logging-middleware.ts`, `telemetry-middleware.ts`

### UI (`ui/`)
- `decorations/` — Code decorations (inline pattern indicators)
- `notifications/` — Notification service
- `status-bar/` — Status bar controller and modes

### Views (`views/`)
- `patterns-tree-provider.ts` — Pattern tree view
- `violations-tree-provider.ts` — Violations tree view
- `files-tree-provider.ts` — Files tree view
- `constants-tree-provider.ts` — Constants tree view
- `base-tree-provider.ts` — Abstract base

### Webview (`webview/`)
- `webview-manager.ts` — Webview panel management

### Infrastructure
- `config/` — Configuration management
- `state/` — State management (Redux-like)
- `infrastructure/` — Service container, event bus, logger, disposable manager

## v2 Notes
- VSCode extension stays in TypeScript (VSCode API requirement).
- Should communicate with Rust engine via LSP or direct NAPI calls.
- The architecture is clean — activation phases, command routing, middleware.
