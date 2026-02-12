# Licensing & Feature Gating System

## Location
`packages/core/src/licensing/`

## What It Does
Runtime feature gating for the open-core business model. Gates enterprise features behind license tiers while keeping all core functionality free.

## Architecture

### License Manager (`license-manager.ts`)
Singleton that loads, validates, and caches the license.

**License sources (priority order):**
1. `DRIFT_LICENSE_KEY` environment variable
2. `.drift/license.key` file
3. `.drift/config.json` `licenseKey` field
4. No license = community tier (always valid)

**Key methods:**
- `initialize()` — Load and validate license from sources
- `checkFeature(feature)` — Check if a specific feature is available
- `hasTier(minimumTier)` — Check if current tier meets minimum
- `getAvailableFeatures()` — List all features at current tier
- `getUpgradeFeatures(targetTier)` — List features unlocked by upgrading
- `isExpired()` / `getDaysUntilExpiration()` — Expiration tracking
- `getWarnings()` — Expiration warnings (30-day threshold)

### License Validator (`license-validator.ts`)
Validates both JWT-based and simple activation key licenses.

**JWT licenses:**
- Standard JWT with header.payload.signature
- Payload: `{ tier, org, seats, iat, exp, iss, ver, features }`
- HMAC signature verification
- Expiration checking with 30-day warning

**Simple key licenses:**
- Prefix-based: `DRIFT-COM-`, `DRIFT-TEAM-`, `DRIFT-ENT-`
- Body: 16-32 alphanumeric characters
- No expiration (managed server-side)

### Feature Guard (`feature-guard.ts`)
Multiple patterns for gating features:

1. **`requireFeature(feature)`** — Throws `FeatureNotLicensedError` if not licensed
2. **`checkFeature(feature)`** — Returns `FeatureCheckResult` (non-throwing)
3. **`guardFeature(feature, fn)`** — Wraps a function, returns `GatedResult<T>`
4. **`withFeatureGate(feature, fn)`** — Creates a gated version of a function
5. **`@RequiresFeature(feature)`** — Method decorator for class methods
6. **`guardMCPTool(feature, handler)`** — MCP-specific guard with error response format
7. **`requireTier(minimumTier)`** — Check tier level directly

## Tier Structure

| Tier | Level | Features |
|------|-------|----------|
| community | 0 | All scanning, detection, analysis, CI, MCP, VSCode — everything core |
| team | 1 | + policy engine, regression detection, custom rules, trends, exports |
| enterprise | 2 | + multi-repo governance, team analytics, audit trails, impact simulation, security boundaries, Jira/Slack/webhooks, self-hosted models, custom detectors, REST API, team dashboard |

## 16 Gated Enterprise Features

```typescript
// Team tier (level 1)
'gate:policy-engine'           // Multiple policies, branch/path scoping
'gate:regression-detection'    // Regression detection across time
'gate:custom-rules'            // Custom rules engine
'dashboard:trends'             // Historical trend analysis
'dashboard:export'             // Report exports

// Enterprise tier (level 2)
'gate:impact-simulation'       // Impact simulation gate
'gate:security-boundary'       // Security boundary gate
'governance:multi-repo'        // Multi-repo pattern governance
'governance:team-analytics'    // Per-team metrics and scores
'governance:audit-trail'       // Full audit trail for compliance
'integration:webhooks'         // Webhook callbacks
'integration:jira'             // Jira integration
'integration:slack'            // Slack notifications
'advanced:self-hosted-models'  // Air-gapped model support
'advanced:custom-detectors'    // Custom pattern detectors
'advanced:api-access'          // REST API access
'dashboard:team-view'          // Team-level dashboard
```

## v2 Notes
- This system must be preserved exactly in v2. It defines the business model boundary.
- The feature guard patterns (decorator, wrapper, MCP guard) should be replicated.
- Consider: Should v2 move license validation to Rust for tamper resistance?
- The upgrade URL (`https://driftscan.dev/pricing`) is hardcoded — make configurable.
