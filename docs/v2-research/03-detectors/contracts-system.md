# Contract Detection System

## Location
`packages/detectors/src/contracts/`

## Purpose
Detects API contracts between backend and frontend code, matches endpoints to API calls, and identifies mismatches (missing fields, type incompatibilities, unmatched endpoints).

## Architecture

```
Backend Code → BackendEndpointDetector → ExtractedEndpoint[]
                                                    ↓
                                            ContractMatcher → MatchingResult
                                                    ↑
Frontend Code → FrontendTypeDetector → ExtractedApiCall[]
```

---

## Core Files
- `backend-endpoint-detector.ts` — Extracts API endpoints from backend code
- `frontend-type-detector.ts` — Extracts API calls from frontend code
- `contract-matcher.ts` — Matches BE↔FE and finds mismatches
- `schema-parser.ts` — Parses API schemas (OpenAPI, etc.)
- `types.ts` — Shared types

---

## Backend Endpoint Detection

### Supported Frameworks (built-in)
- **Express.js** — `app.get()`, `router.post()`, etc.
- **FastAPI** — `@app.get()`, `@router.post()`, etc.
- **Flask** — `@app.route()`, etc.
- **Django** — Via `contracts/django/` extension

### Framework Extensions
- **Spring Boot** (`contracts/spring/`) — `@GetMapping`, `@PostMapping`, `@RestController`
- **Laravel** (`contracts/laravel/`) — Route definitions, resource controllers
- **Django** (`contracts/django/`) — URL patterns, ViewSets, Serializers
- **ASP.NET** (`contracts/aspnet/`) — `[HttpGet]`, `[Route]`, controllers

### ExtractedEndpoint
```typescript
interface ExtractedEndpoint {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  file: string;
  line: number;
  responseFields: ContractField[];
  requestFields?: ContractField[];
  responseTypeName?: string;
  requestTypeName?: string;
  framework: string;
}
```

---

## Frontend API Call Detection

### Supported Libraries
- `fetch()` — Native Fetch API
- `axios` — Axios HTTP client
- Custom API clients

### ExtractedApiCall
```typescript
interface ExtractedApiCall {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  file: string;
  line: number;
  responseType?: string;
  responseFields: ContractField[];
  requestType?: string;
  requestFields?: ContractField[];
  library: string;
}
```

---

## Contract Matching

### Path Similarity Algorithm
Multi-factor path matching with weighted scoring:

| Factor | Weight | Description |
|--------|--------|-------------|
| Segment names | configurable | Jaccard similarity of path segments |
| Segment count | configurable | Penalty for different segment counts |
| Suffix match | configurable | Matching trailing segments |
| Resource name | configurable | Matching resource names (e.g., `/users`) |
| Parameter positions | configurable | Matching parameter placeholder positions |

### Field Comparison
- Compares response/request fields between BE and FE
- Detects: missing fields, extra fields, type mismatches
- Type compatibility checking (e.g., `int` ↔ `number`, `str` ↔ `string`)

### MatchingResult
```typescript
interface MatchingResult {
  contracts: Contract[];
  unmatchedEndpoints: ExtractedEndpoint[];
  unmatchedApiCalls: ExtractedApiCall[];
}
```

---

## Django Extension Details

### URL Extractor
Parses Django URL patterns from `urls.py`:
- `path()` and `re_path()` calls
- URL namespaces
- Included URL configs

### ViewSet Extractor
Extracts DRF ViewSet actions:
- Standard actions (list, create, retrieve, update, destroy)
- Custom `@action` decorators
- Router-registered ViewSets

### Serializer Extractor
Extracts DRF Serializer fields:
- `ModelSerializer` with `Meta.fields`
- Explicit field declarations
- Nested serializers
- Field types → TypeScript type mapping

---

## Spring Extension Details

### Spring Endpoint Detector
- `@RestController` + `@RequestMapping`
- `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`
- Path variables, request params, request body

### DTO Extractor
- Extracts fields from Java DTOs/records
- Maps Java types to TypeScript types
- Handles `@JsonProperty` annotations
