# Framework Patterns

## Location
`packages/core/src/language-intelligence/frameworks/`

## Purpose
Defines decorator-to-semantic mappings for 5 major web frameworks. Each framework pattern tells the normalization layer how to interpret raw decorators/annotations.

## Files
- `spring.ts` — `SPRING_PATTERNS`: Spring Boot (Java)
- `fastapi.ts` — `FASTAPI_PATTERNS`: FastAPI (Python)
- `nestjs.ts` — `NESTJS_PATTERNS`: NestJS (TypeScript)
- `laravel.ts` — `LARAVEL_PATTERNS`: Laravel (PHP)
- `aspnet.ts` — `ASPNET_PATTERNS`: ASP.NET Core (C#)
- `index.ts` — Aggregation + utilities

## FrameworkPattern Structure

```typescript
interface FrameworkPattern {
  framework: string;           // e.g., "spring"
  languages: string[];         // e.g., ["java"]
  detectionPatterns: {
    imports?: RegExp[];        // Import patterns that indicate this framework
    decorators?: RegExp[];     // Decorator patterns
  };
  decoratorMappings: DecoratorMapping[];
}
```

## DecoratorMapping

```typescript
interface DecoratorMapping {
  pattern: RegExp;             // Matches the raw decorator string
  semantic: DecoratorSemantics; // What it means
  confidence?: number;         // Default: 1.0
  extractArgs: (raw: string) => DecoratorArguments;  // Argument extraction
}
```

## Framework Coverage

### Spring (Java)
| Decorator | Category | Entry Point | Injectable |
|-----------|----------|-------------|------------|
| `@Controller` | routing | ✅ | ✅ |
| `@RestController` | routing | ✅ | ✅ |
| `@RequestMapping` | routing | ✅ | — |
| `@GetMapping` / `@PostMapping` / etc. | routing | ✅ | — |
| `@Service` | di | — | ✅ |
| `@Repository` | orm | — | ✅ |
| `@Autowired` | di | — | — |
| `@Entity` | orm | — | — |

### FastAPI (Python)
| Decorator | Category | Entry Point |
|-----------|----------|-------------|
| `@app.get` / `@app.post` / etc. | routing | ✅ |
| `@Depends` | di | — |
| `@Body` / `@Query` / `@Path` | validation | — |

### NestJS (TypeScript)
| Decorator | Category | Entry Point | Injectable |
|-----------|----------|-------------|------------|
| `@Controller` | routing | ✅ | ✅ |
| `@Get` / `@Post` / etc. | routing | ✅ | — |
| `@Injectable` | di | — | ✅ |
| `@Module` | di | — | — |
| `@UseGuards` | middleware | — | — |

### Laravel (PHP)
| Pattern | Category | Entry Point |
|---------|----------|-------------|
| `Route::get` / `Route::post` / etc. | routing | ✅ |
| `Route::resource` | routing | ✅ |
| `middleware()` | middleware | — |

### ASP.NET (C#)
| Attribute | Category | Entry Point | Auth |
|-----------|----------|-------------|------|
| `[ApiController]` | routing | ✅ | — |
| `[HttpGet]` / `[HttpPost]` / etc. | routing | ✅ | — |
| `[Authorize]` | auth | — | ✅ |
| `[FromBody]` / `[FromQuery]` | validation | — | — |

## Utility Functions

```typescript
registerAllFrameworks()                    // Register all 5 in the global registry
getFrameworkPattern(name: string)          // Single framework by name
getFrameworksForLanguage(language: string) // All frameworks for a language
ALL_FRAMEWORK_PATTERNS: FrameworkPattern[] // Array of all 5
```

## Rust Rebuild Considerations
- Framework patterns are static configuration data — zero-cost Rust structs
- Regex patterns compile once — Rust's `regex` crate handles this efficiently
- The `extractArgs` functions are string parsing — straightforward in Rust
- Adding new frameworks is just adding new pattern definitions
