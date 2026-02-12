# Cortex Privacy System

## Location
`packages/cortex/src/privacy/`

## Purpose
Sanitizes memory content to remove PII and secrets before storage or transmission.

## Files
- `sanitizer.ts` — `PrivacySanitizer`: main sanitization engine
- `validator.ts` — `PrivacyValidator`: validates privacy compliance
- `patterns.ts` — Regex patterns for sensitive data detection

## Detected PII Patterns

| Pattern | Replacement |
|---------|-------------|
| Email addresses | `[EMAIL]` |
| Phone numbers | `[PHONE]` |
| SSN | `[SSN]` |
| Credit card numbers | `[CREDIT_CARD]` |
| IP addresses | `[IP_ADDRESS]` |

## Detected Secret Patterns

| Pattern | Replacement |
|---------|-------------|
| API keys | `[API_KEY]` |
| AWS access keys (AKIA...) | `[AWS_KEY]` |
| JWT tokens | `[JWT_TOKEN]` |
| Private keys (PEM) | `[PRIVATE_KEY]` |
| Passwords in strings | `[PASSWORD]` |

## PrivacySanitizer API

### `sanitize(content)` → `SanitizationResult`
Removes all PII and secrets.

### `sanitizePII(content)` → `SanitizationResult`
Removes only PII (emails, phones, SSN, credit cards, IPs).

### `sanitizeSecrets(content)` → `SanitizationResult`
Removes only secrets (API keys, AWS keys, JWTs, private keys, passwords).

### `containsSensitive(content)` → `boolean`
Quick check without modification.

### SanitizationResult
```typescript
interface SanitizationResult {
  sanitized: string;
  redactedCount: number;
  redactedTypes: string[];
}
```

## Rust Rebuild Considerations
- Regex-based — Rust's `regex` crate is faster than JS regex
- Pattern matching is embarrassingly parallel for batch sanitization
- Consider adding more patterns (Slack tokens, GitHub tokens, etc.)
- The validator could enforce sanitization at the storage layer boundary
