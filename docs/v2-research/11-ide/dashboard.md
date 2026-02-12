# Dashboard

## Location
`packages/dashboard/`

## Architecture
Vite + React + Tailwind web dashboard with Express backend.

### Server (`src/server/`)
- `dashboard-server.ts` — Main server
- `express-app.ts` — Express application
- `api-routes.ts` — REST API routes
- `drift-data-reader.ts` — Read drift data from disk
- `pattern-watcher.ts` — Watch for pattern changes
- `websocket-server.ts` — Real-time updates
- `galaxy-data-transformer.ts` — Transform data for Galaxy visualization
- `quality-gates-api.ts` — Quality gates API

### Client (`src/client/`)
- `App.tsx` — Main application
- `main.tsx` — Entry point
- Components:
  - `OverviewTab.tsx` — Overview dashboard
  - `patterns/` — Pattern management (list, detail, filters, stats, review)
  - `violations/` — Violation management
  - `contracts/` — Contract management
  - `boundaries/` — Boundary management (with rule editor)
  - `ConstantsTab.tsx` — Constants view
  - `FilesTab.tsx` — File browser
  - `GalaxyTab.tsx` — Galaxy visualization
  - `QualityGatesTab.tsx` — Quality gates
  - `SettingsTab.tsx` — Settings
  - `ProjectSwitcher.tsx` — Multi-project switching
  - `trends/` — Trend visualization
  - `ErrorBoundary.tsx` — Error boundary
- Hooks: `use-api.ts`, `use-websocket.ts`
- Store: `index.ts` — Client state management

## v2 Notes
- Dashboard stays in TypeScript/React.
- Backend should call Rust engine for data.
- The Galaxy visualization is unique — keep and enhance.
