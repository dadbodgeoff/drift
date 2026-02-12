# Contract Detection Pipeline

## Overview
Contract detection is a multi-phase pipeline that discovers API contracts by matching backend endpoint definitions to frontend API calls, then comparing their field structures.

## Pipeline

```
1. Backend Endpoint Extraction
   ├─ Scan backend files for route definitions
   ├─ Extract HTTP method + path from decorators/annotations
   ├─ Extract response fields from return types/schemas
   └─ Normalize path syntax

2. Frontend API Call Extraction
   ├─ Scan frontend files for HTTP client calls
   ├─ Extract HTTP method + path from call arguments
   ├─ Extract expected response type from TypeScript generics
   └─ Normalize path syntax

3. Endpoint Matching
   ├─ Normalize both paths to common format
   ├─ Match by (method, normalizedPath)
   └─ Calculate match confidence

4. Field Comparison
   ├─ Compare backend response fields ↔ frontend expected fields
   ├─ Recursive comparison for nested objects
   ├─ Detect mismatches (missing, type, optionality, nullability)
   └─ Calculate field extraction confidence

5. Contract Creation
   ├─ Create Contract with backend + frontend + mismatches
   ├─ Set status (discovered, mismatch if mismatches found)
   ├─ Calculate overall confidence
   └─ Store in SQLite + JSON
```

---

## Path Normalization

Different frameworks use different path parameter syntax. Normalization converts all to a common format:

| Framework | Original | Normalized |
|-----------|----------|------------|
| Express | `/users/:id` | `/users/:id` |
| FastAPI | `/users/{id}` | `/users/:id` |
| Flask | `/users/<id>` | `/users/:id` |
| Django | `/users/<int:id>` | `/users/:id` |
| Spring | `/users/{id}` | `/users/:id` |
| Frontend (template literal) | `/users/${id}` | `/users/:id` |

---

## Backend Endpoint Extraction

### Framework Detection Patterns

#### Express/Koa (TypeScript/JavaScript)
```typescript
// Detected via: app.get(), router.post(), etc.
app.get('/users/:id', handler)
router.post('/users', createUser)
```

#### FastAPI (Python)
```python
# Detected via: @app.get(), @app.post() decorators
@app.get("/users/{id}")
async def get_user(id: int) -> User:
```

#### Flask (Python)
```python
# Detected via: @app.route() decorator
@app.route("/users/<id>", methods=["GET"])
def get_user(id):
```

#### Django (Python)
```python
# Detected via: path() in urlpatterns
path("users/<int:pk>/", views.UserDetail.as_view())
```

#### Spring (Java)
```java
// Detected via: @GetMapping, @PostMapping, etc.
@GetMapping("/users/{id}")
public User getUser(@PathVariable Long id) { }
```

#### ASP.NET (C#)
```csharp
// Detected via: [HttpGet], [Route] attributes
[HttpGet("users/{id}")]
public ActionResult<User> GetUser(int id) { }
```

### Response Field Extraction
- **TypeScript**: Extract from return type annotations, response.json() calls
- **Python (FastAPI)**: Extract from Pydantic model return type annotations
- **Python (Flask/Django)**: Extract from jsonify() / Response() calls
- **Java (Spring)**: Extract from return type + ResponseEntity generics
- **C# (ASP.NET)**: Extract from ActionResult<T> generic parameter

---

## Frontend API Call Extraction

### Library Detection Patterns

#### fetch API
```typescript
const res = await fetch('/api/users');
const data: User[] = await res.json();
```

#### axios
```typescript
const { data } = await axios.get<User[]>('/api/users');
```

#### react-query
```typescript
const { data } = useQuery<User[]>('users', () => fetch('/api/users'));
```

#### Angular HttpClient
```typescript
this.http.get<User[]>('/api/users').subscribe(...)
```

### Response Type Extraction
- Generic type parameters: `axios.get<User[]>(...)` → `User[]`
- Type assertions: `res.json() as User[]` → `User[]`
- Variable type annotations: `const data: User[] = ...` → `User[]`
- Then resolve the TypeScript interface to extract fields

---

## Field Comparison Algorithm

### Recursive Comparison
```
compareFields(backendFields, frontendFields):
  for each backendField:
    find matching frontendField by name
    if not found → missing_in_frontend mismatch
    if found:
      compare types → type_mismatch if different
      compare optional → optionality_mismatch if different
      compare nullable → nullability_mismatch if different
      if both have children → recurse into children

  for each frontendField not matched:
    → missing_in_backend mismatch
```

### Type Mapping
Backend types are normalized to a common set for comparison:
| Backend Type | Normalized |
|-------------|------------|
| `str`, `string`, `String` | `string` |
| `int`, `float`, `number`, `Integer`, `Double` | `number` |
| `bool`, `boolean`, `Boolean` | `boolean` |
| `list`, `array`, `List<T>`, `T[]` | `array` |
| `dict`, `object`, `Map<K,V>` | `object` |
| `None`, `null`, `void` | `null` |

---

## Confidence Scoring

### Match Confidence (how sure we are about endpoint matching)
- Exact path match → 1.0
- Path match with different parameter names → 0.9
- Path match with different base paths (e.g., `/api/` prefix) → 0.7
- Fuzzy path match → 0.5

### Field Extraction Confidence (how sure we are about field extraction)
- Typed response (Pydantic model, TypeScript interface) → 0.9
- Inferred from return statements → 0.6
- Unknown/any types → 0.3

### Overall Confidence
```
score = (matchConfidence * 0.6) + (fieldExtractionConfidence * 0.4)
level = score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : score >= 0.3 ? 'low' : 'uncertain'
```

---

## v2 Considerations
- Backend endpoint extraction should use Rust parsers (decorator/annotation extraction is already there)
- Path normalization is simple string manipulation — ideal for Rust
- Field comparison is recursive but pure logic — ideal for Rust
- Frontend API call extraction is TS-specific (TypeScript compiler API needed) — keep in TS
- Pydantic model extraction (for FastAPI response types) depends on the Pydantic parser being ported to Rust
- Consider adding GraphQL contract support (schema ↔ query comparison)
