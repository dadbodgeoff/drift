# Rust Constants & Secrets Analyzer

## Location
`crates/drift-core/src/constants/`

## Files
- `analyzer.rs` — `ConstantsAnalyzer`: orchestrates extraction, secret detection, magic numbers, inconsistencies
- `extractor.rs` — `ConstantExtractor`: extracts constant declarations from parsed ASTs
- `secrets.rs` — `SecretDetector`: regex-based secret detection (21 patterns)
- `types.rs` — All types: `ConstantInfo`, `SecretCandidate`, `MagicNumber`, `InconsistentValue`, etc.
- `mod.rs` — Module exports

## NAPI Exposure
- `analyze_constants(files: Vec<String>) -> JsConstantsResult`

## Architecture

```
Files (parallel via rayon)
  │
  ├─ thread_local! ParserManager → ParseResult
  │
  ├─ thread_local! ConstantExtractor → Vec<ConstantInfo>
  │     └─ Extracts const/let/var declarations from AST
  │
  ├─ thread_local! SecretDetector → Vec<SecretCandidate>
  │     └─ 21 regex patterns against source lines
  │
  └─ find_magic_numbers() → Vec<MagicNumber>
        └─ Regex \b(\d{2,})\b with exclusion list
  │
  ▼
Aggregate → find_inconsistencies() → build_stats() → ConstantsResult
```

## Thread-Local Pattern
Uses `thread_local!` for rayon parallelism (each thread gets its own instances):
```rust
thread_local! {
    static PARSER: RefCell<ParserManager> = RefCell::new(ParserManager::new());
    static EXTRACTOR: ConstantExtractor = ConstantExtractor::new();
    static SECRET_DETECTOR: SecretDetector = SecretDetector::new();
}
```

## Secret Detection Patterns (21 total)

### Critical Severity (base confidence: 0.9)
| Pattern Name | Regex | Example Match |
|-------------|-------|---------------|
| AWS Access Key | `AKIA[0-9A-Z]{16}` | AKIAIOSFODNN7EXAMPLE |
| AWS Secret Key | `aws.{0,20}secret.{0,20}['"][0-9a-zA-Z/+]{40}['"]` | aws_secret="..." |
| GitHub Token | `ghp_[a-zA-Z0-9]{36}` or `github.{0,20}token.{0,20}['"][a-zA-Z0-9]{35,40}['"]` | ghp_xxxx... |
| Stripe Key | `sk_live_[a-zA-Z0-9]{24,}` or `rk_live_[a-zA-Z0-9]{24,}` | sk_live_xxxx... |
| RSA Private Key | `-----BEGIN RSA PRIVATE KEY-----` | PEM header |
| SSH Private Key | `-----BEGIN OPENSSH PRIVATE KEY-----` | PEM header |
| PGP Private Key | `-----BEGIN PGP PRIVATE KEY BLOCK-----` | PEM header |

### High Severity (base confidence: 0.8)
| Pattern Name | Regex | Example Match |
|-------------|-------|---------------|
| Google API Key | `AIza[0-9A-Za-z\-_]{35}` | AIzaSyxxxx... |
| Password Assignment | `(password\|passwd\|pwd)\s*[=:]\s*['"][^'"]{8,}['"]` | password="longvalue" |
| JWT Token | `eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*` | eyJhbGci... |
| Database Connection | `(mongodb\|postgres\|mysql\|redis)://[^'"\s]+` | postgres://user:pass@host |
| Database Password | `db.{0,10}(password\|passwd\|pwd)\s*[=:]\s*['"][^'"]+['"]` | db_password="..." |
| Slack Token | `xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*` | xoxb-xxxx... |
| SendGrid API Key | `SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}` | SG.xxxx... |
| Twilio API Key | `SK[a-f0-9]{32}` | SKxxxx... |

### Medium Severity (base confidence: 0.6)
| Pattern Name | Regex | Example Match |
|-------------|-------|---------------|
| Hardcoded Password | `(password\|passwd\|pwd)\s*[=:]\s*['"][^'"]+['"]` | pwd="short" |
| Bearer Token | `bearer\s+[a-zA-Z0-9_\-\.]+['"]?` | Bearer abc.def |
| Secret Assignment | `(secret\|api_key\|..)\s*[=:]\s*['"][^'"]{16,}['"]` | secret="longvalue" |
| Generic API Key | `(api[_-]?key\|apikey)\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]` | api_key="xxxx" |
| Slack Webhook | `https://hooks\.slack\.com/services/T.../B.../...` | Webhook URL |

## Confidence Scoring Algorithm

```
base = severity_to_base(severity)
  Critical → 0.9
  High     → 0.8
  Medium   → 0.6
  Low      → 0.4
  Info     → 0.2

adjustments:
  + 0.05 if high entropy (≥3 of: uppercase, lowercase, digit, special)
  + 0.05 if length > 30 chars

confidence = min(base + adjustments, 1.0)
```

## Placeholder Detection
Skips matches containing (case-insensitive):
- "example", "placeholder", "your_", "xxx", "todo", "changeme", "replace"
- Exact matches: "password", "secret"
- All-X/all-* strings

## Value Masking
```
if len ≤ 8: return "*" × len
else: visible = min(4, len/4)
      return first_visible + "..." + last_visible
```

## Magic Number Detection

**Regex:** `\b(\d{2,})\b` (2+ digit numbers)

**Excluded numbers:**
- Common: 0, 1, 2, 10, 100, 1000
- Time: 60, 24, 365
- Powers of 2: 1024, 2048, 4096
- HTTP status codes: 200, 201, 204, 301, 302, 400, 401, 403, 404, 500, 502, 503
- Years: 1900-2100

**Skipped lines:** Comments (`//`, `#`, `*`, `/*`) and lines containing string literals (`"`)

**Name suggestion** (context-aware):
- timeout/delay → `TIMEOUT_MS_{value}`
- interval → `INTERVAL_MS_{value}`
- size/length → `MAX_SIZE_{value}`
- limit → `LIMIT_{value}`
- count/max → `MAX_COUNT_{value}`
- retry → `MAX_RETRIES_{value}`
- port → `PORT_{value}`

## Inconsistency Detection
1. Group all constants by normalized name (lowercase)
2. For groups with 2+ entries, check if values differ
3. If different values found → `InconsistentValue` with all locations

## Types

```rust
ConstantInfo { name, value, category: ConstantCategory, file, line, language, is_exported }
SecretCandidate { name, masked_value, secret_type, severity: SecretSeverity, file, line, confidence, reason }
SecretSeverity { Critical, High, Medium, Low, Info }
MagicNumber { value: f64, file, line, context, suggested_name? }
InconsistentValue { name_pattern, values: Vec<ValueLocation>, severity }
ValueLocation { value, file, line }
ConstantsStats { total_constants, by_category, by_language, exported_count, secrets_count, magic_numbers_count, files_analyzed, duration_ms }
ConstantsResult { constants, secrets, magic_numbers, inconsistencies, dead_constants, stats }
```

## TS Counterpart
`packages/core/src/constants/` — Additional features:
- Dead constant detection (requires usage analysis)
- Richer categorization
- Integration with pattern store

## v2 Notes
- Secret detection patterns are comprehensive. Consider adding: Azure keys, GCP service accounts, npm tokens, PyPI tokens.
- Magic number detection is basic (line-level regex). AST-based detection would be more accurate.
- Inconsistency detection could use fuzzy name matching (e.g., `MAX_RETRIES` vs `maxRetries`).
