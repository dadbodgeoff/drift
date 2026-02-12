# Galaxy Visualization Package

## Location
`packages/galaxy/` — TypeScript/React, published as `driftdetect-galaxy`

## What It Is
A 3D visualization library that renders database schemas, data access patterns, and security boundaries as an interactive galaxy. Tables are planets, fields are moons, entry points are space stations, and data flows are glowing lanes.

## Tech Stack
- React 18 (peer dependency)
- Three.js 0.160 + react-three-fiber 8
- @react-three/drei (helpers)
- @react-three/postprocessing (bloom, effects)
- Zustand 4 (state management)
- jsfxr (procedural sound effects)

## Architecture

```
┌─────────────────────────────────────────┐
│           GalaxyCanvas (root)            │
│  Camera │ Lighting │ PostProcessing      │
├──────────┬──────────┬───────────────────┤
│  Nodes   │Connections│   Effects         │
│ TablePlanet│DataPathLane│ AccessPulse    │
│ FieldMoon  │TableRel   │ GalaxyBloom    │
│ EntryPoint │           │ StarField      │
├──────────┴──────────┴───────────────────┤
│              UI Overlays                 │
│ ControlsPanel│DetailsPanel│ SearchOverlay│
│ SecurityPanel│ StatsOverlay              │
├─────────────────────────────────────────┤
│  Hooks: useGalaxyData │ useAccessStream  │
├─────────────────────────────────────────┤
│  Store: galaxy-store (Zustand)           │
├─────────────────────────────────────────┤
│  Utils: color │ geometry │ layout-engine  │
└─────────────────────────────────────────┘
```

## File Map

### Components
| File | Purpose |
|------|---------|
| `canvas/GalaxyCanvas.tsx` | Root Three.js canvas |
| `canvas/GalaxyCamera.tsx` | Orbital camera controls |
| `canvas/GalaxyLighting.tsx` | Scene lighting |
| `nodes/TablePlanet.tsx` | Database table as planet |
| `nodes/FieldMoon.tsx` | Table field as orbiting moon |
| `nodes/EntryPointStation.tsx` | API entry point as station |
| `connections/DataPathLane.tsx` | Data flow visualization |
| `connections/TableRelationship.tsx` | FK/PK relationships |
| `effects/AccessPulse.tsx` | Real-time access animation |
| `effects/GalaxyBloom.tsx` | Post-processing bloom |
| `effects/StarField.tsx` | Background star particles |
| `ui/ControlsPanel.tsx` | Camera/filter controls |
| `ui/DetailsPanel.tsx` | Selected entity details |
| `ui/SearchOverlay.tsx` | Search functionality |
| `ui/SecurityPanel.tsx` | Security boundary view |
| `ui/StatsOverlay.tsx` | Statistics HUD |

### Supporting
| File | Purpose |
|------|---------|
| `hooks/useGalaxyData.ts` | Data fetching/transformation |
| `hooks/useAccessStream.ts` | Real-time access stream |
| `store/galaxy-store.ts` | Zustand state (selection, filters, camera) |
| `audio/sound-effects.ts` | Procedural sound generation |
| `audio/useGalaxySound.ts` | Sound hook |
| `utils/color-utils.ts` | Color mapping (sensitivity → color) |
| `utils/geometry-utils.ts` | 3D math helpers |
| `utils/layout-engine.ts` | Force-directed layout |
| `constants/index.ts` | Visual constants |
| `types/index.ts` | Type definitions |

## v2 Considerations
- Stays TypeScript/React — pure visualization
- Data source changes to match v2 Rust output format
- Layout engine could be optimized with WASM if needed
- Consider WebGPU path for large schemas (1000+ tables)
