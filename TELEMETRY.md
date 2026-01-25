# Drift Telemetry

Drift includes an **opt-in, privacy-first** telemetry system to help improve pattern detection for everyone.

## Privacy First

- **No source code is ever sent** - only anonymized pattern signatures and aggregate statistics
- **Completely opt-in** - disabled by default, you choose what to share
- **Transparent** - all telemetry types are documented below
- **Controllable** - change settings anytime with `drift telemetry`

## What We Collect (When Enabled)

### Pattern Signatures
Anonymized hashes of pattern names and configurations, along with:
- Pattern category (e.g., "api", "auth", "errors")
- Confidence score (0-1)
- Location and outlier counts (numbers only)
- Detection method used (AST, regex, hybrid, semantic)
- Primary language

**Example event:**
```json
{
  "type": "pattern_signature",
  "signatureHash": "a1b2c3d4e5f6...",
  "category": "api",
  "confidence": 0.92,
  "locationCount": 15,
  "outlierCount": 2,
  "detectionMethod": "hybrid",
  "language": "typescript"
}
```

### Aggregate Statistics
Project-level statistics with no identifying information:
- Total pattern counts by status (discovered/approved/ignored)
- Pattern counts by category
- Languages and frameworks detected
- Features enabled
- Codebase size tier (small/medium/large/enterprise)

### User Actions
Learning from your approve/ignore decisions:
- Action type (approve, ignore, create variant, dismiss outlier)
- Pattern category (no name or code)
- Confidence at time of action
- Time since pattern discovery
- Whether it was a bulk action

## How to Enable

### During `drift init`
You'll be prompted to opt-in during initialization:
```
📊 Help Improve Drift

  Drift can collect anonymized telemetry to improve pattern detection.
  • No source code is ever sent
  • Only pattern signatures and aggregate statistics
  • You can change this anytime with `drift telemetry`

? Enable telemetry to help improve Drift? (y/N)
```

### Anytime with CLI
```bash
# Enable with interactive setup
drift telemetry enable

# Enable all telemetry options
drift telemetry enable --all

# Interactive configuration
drift telemetry setup

# Check current status
drift telemetry

# Disable completely
drift telemetry disable
```

## Configuration

Telemetry settings are stored in `.drift/config.json`:

```json
{
  "telemetry": {
    "enabled": true,
    "sharePatternSignatures": true,
    "shareAggregateStats": true,
    "shareUserActions": false,
    "installationId": "uuid-generated-on-opt-in",
    "enabledAt": "2026-01-25T12:00:00.000Z"
  }
}
```

### Options

| Setting | Description | Default |
|---------|-------------|---------|
| `enabled` | Master switch for all telemetry | `false` |
| `sharePatternSignatures` | Share anonymized pattern hashes | `false` |
| `shareAggregateStats` | Share aggregate statistics | `false` |
| `shareUserActions` | Share approve/ignore decisions | `false` |

## Data Handling

- Events are batched locally before submission
- Failed submissions are retried gracefully
- Telemetry never blocks user operations
- Queue is cleared when telemetry is disabled

## Why Telemetry?

Your anonymized data helps us:

1. **Improve pattern detection** - Learn which patterns are most useful
2. **Tune confidence scoring** - Understand when patterns should be auto-approved
3. **Prioritize features** - Know which languages and frameworks need attention
4. **Train ML models** - Build better pattern recognition (future)

## Questions?

- Open an issue: https://github.com/drift/drift/issues
- Read our privacy policy: https://drift.dev/privacy
