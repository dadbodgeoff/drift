# AI-Assisted First Scan Review

## Overview

An optional AI verification step integrated into `drift scan`. After AST-based pattern detection completes, the CLI can invoke an LLM to review the structured results before saving. AI verifies Drift's deterministic output, auto-approves correct patterns, auto-ignores false positives, and flags outliers for human review.

```
drift scan --ai-verify
  → AST parsing (deterministic)
  → Pattern detection (deterministic)
  → AI reviews structured output (not files!)
  → Auto-triage based on verification
  → Save clean baseline
```

**Key Insight**: AI never reads source files. Drift's AST parsing already extracted everything. AI just reviews the structured summary - patterns, tables, access points, confidence scores. This is dramatically more efficient than an agent reading 50 files to understand a data model.

**Current State**: First scan is pure AST. All patterns save as "discovered". User manually reviews hundreds of patterns.

**With AI Verify**: AI reviews Drift's output, auto-approves verified patterns, auto-ignores false positives, flags edge cases. User reviews only the outliers.

## Problem Statement

First scan of a codebase produces overwhelming output:
- Hundreds of patterns (984 in demo project)
- Duplicate/near-duplicate detections
- Ambiguous table names (`User` vs `users` vs `Users`)
- False positives mixed with real patterns
- Manual review of 400+ high-confidence patterns is tedious

Users must manually:
1. Review each pattern for accuracy
2. Identify and merge duplicates
3. Approve legitimate patterns
4. Ignore noise/false positives
5. Resolve naming inconsistencies

This takes hours and delays adoption.

## Solution

Add `--ai-review` flag to `drift scan` that:

1. Runs normal deterministic scan
2. Before persisting, sends results to LLM for review
3. LLM consolidates, verifies, and triages
4. User confirms, then clean results are saved

```bash
drift scan --ai-review
drift scan --ai-review --auto-apply  # Skip confirmation
drift scan --ai-review --dry-run     # Preview only
```

## Why AI Reviews Structured Output, Not Files

Traditional agent approach (wasteful):
```
Agent: "Let me understand your data model"
  → reads src/models/user.ts (500 tokens)
  → reads src/models/order.ts (400 tokens)
  → reads src/services/userService.ts (800 tokens)
  → ... 47 more files ...
  → builds mental model (probably wrong)
  → hallucinates table relationships
Total: 25,000+ tokens, questionable accuracy
```

Drift's AI-verify approach (efficient):
```
drift scan --ai-verify
  → AST parses all files (deterministic, fast)
  → Extracts: 13 tables, 69 access points, 984 patterns
  → Sends structured summary to AI (~2,000 tokens)
  → AI verifies: "users table looks correct, 
                  User/Users should merge,
                  this pattern is a false positive"
  → Clean baseline saved
Total: 2,000 tokens, deterministic foundation + AI verification
```

The AI sees:
```json
{
  "tables": [
    { "name": "users", "fields": ["id", "email", "password"], "accessCount": 12 },
    { "name": "User", "fields": ["id", "email"], "accessCount": 3 }
  ],
  "patterns": [
    { "id": "abc", "name": "Prisma findMany", "confidence": 92, "locations": 15 },
    { "id": "def", "name": "Raw SQL query", "confidence": 45, "locations": 2 }
  ]
}
```

Not 50 source files. Just the structured extraction results.

## Philosophy Alignment

This feature aligns with Drift's core philosophy:

| Principle | How This Feature Aligns |
|-----------|------------------------|
| "AI learns, deterministic enforces" | AI assists one-time setup, then enforcement is deterministic |
| "Eliminate ongoing AI dependency" | Single API call at setup, never needed again |
| "Reduce hallucination risk" | AI reviews deterministic output, doesn't generate patterns |
| "Human in the loop" | User confirms before applying AI recommendations |

## User Experience

### Command Line Interface

```bash
$ drift scan --ai-review

🔍 Drift - Enterprise Pattern Scanner

✔ Discovered 386 files
✔ Analyzed 386 files in 7.48s
✔ Found 984 patterns, 13 tables, 69 access points

🤖 AI Review Starting...
   Provider: anthropic (claude-sonnet-4-20250514)
   Estimated tokens: ~45,000
   Estimated cost: ~$0.15
   
   [Continue? Y/n] y

   ⠋ Analyzing patterns for duplicates...
   ⠙ Verifying confidence scores...
   ⠹ Consolidating table names...
   ⠸ Triaging for approval...

✔ AI Review Complete (12.3s)

📋 Review Summary
────────────────────────────────────────
  Patterns analyzed:    984
  
  Actions taken:
    ✓ Auto-approved:    380 patterns
    ✓ Auto-ignored:     89 patterns
    ⚠ Needs review:     15 patterns
    ○ No change:        500 patterns
  
  Consolidations:
    Tables merged:      2 (User→users, Order→orders)
    Duplicates removed: 47 patterns
    
  Confidence adjustments:
    Increased:          12 patterns
    Decreased:          8 patterns
    
  Estimated time saved: ~2.5 hours

📝 Items Requiring Human Review (15):
────────────────────────────────────────

1. Pattern: "UserRepository.findByEmail"
   Category: data-access
   Original confidence: 72%
   AI assessment: UNCERTAIN
   
   Reasoning: "Detected as direct data-access but appears to be 
   a repository abstraction layer. If this delegates to an ORM,
   it should be ignored. If it contains raw SQL, approve it."
   
   Code context:
   │ class UserRepository {
   │   async findByEmail(email: string) {
   │     return this.prisma.user.findUnique({ where: { email } });
   │   }
   │ }
   
   [a]pprove  [i]gnore  [s]kip  [v]iew more context
   > a
   ✓ Approved

2. Pattern: "OrderService.getOrderHistory"
   ...

────────────────────────────────────────
Review complete: 15/15 items resolved

💾 Save Results?
   This will persist all changes to .drift/
   
   [Y]es  [n]o  [r]eview summary
   > y

✔ Saved 937 patterns (47 duplicates removed)
✔ 380 patterns approved, 89 ignored
✔ 2 table name consolidations applied

🎉 First scan complete! Your codebase baseline is ready.
   Run 'drift status' to see your pattern summary.
```

### Dry Run Mode

```bash
$ drift scan --ai-review --dry-run

🔍 Scanning... ✔
🤖 AI Review... ✔

📋 Dry Run Summary (no changes saved)
────────────────────────────────────────
  Would auto-approve:   380 patterns
  Would auto-ignore:    89 patterns
  Would need review:    15 patterns
  Would merge tables:   2
  Would remove dupes:   47

Full report saved to: .drift/reports/ai-review-preview.json
```

### Auto-Apply Mode

For CI/CD or scripted setups:

```bash
$ drift scan --ai-review --auto-apply --review-threshold=90

# Only auto-applies if AI confidence > 90%
# Items below threshold are left as "discovered"
```

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Layer                                │
│  scan.ts --ai-review                                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Scanner Service                               │
│  1. Run normal scan                                             │
│  2. Collect results (patterns, tables, access points)           │
│  3. If --ai-review: invoke AIReviewService                      │
│  4. Apply recommendations                                        │
│  5. Persist to stores                                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AI Review Service                              │
│  packages/ai/src/review/                                        │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Deduplicator│  │ Confidence  │  │   Triage    │             │
│  │             │  │  Verifier   │  │   Engine    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                       │
│                 ┌─────────────────┐                             │
│                 │  LLM Provider   │                             │
│                 │  (Anthropic/    │                             │
│                 │   OpenAI/etc)   │                             │
│                 └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### New Package Structure

```
packages/ai/
├── src/
│   ├── index.ts
│   ├── providers/
│   │   ├── index.ts
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   └── types.ts
│   ├── review/
│   │   ├── index.ts
│   │   ├── ai-review-service.ts
│   │   ├── deduplicator.ts
│   │   ├── confidence-verifier.ts
│   │   ├── triage-engine.ts
│   │   ├── table-consolidator.ts
│   │   └── types.ts
│   └── prompts/
│       ├── index.ts
│       ├── pattern-review.ts
│       ├── table-consolidation.ts
│       └── confidence-verification.ts
├── package.json
└── tsconfig.json
```

### Core Types

```typescript
// packages/ai/src/review/types.ts

export interface AIReviewConfig {
  provider: 'anthropic' | 'openai' | 'ollama';
  model?: string;
  apiKey?: string;  // Falls back to env var
  
  // Review settings
  autoApproveThreshold: number;  // 0-100, default 85
  autoIgnoreThreshold: number;   // 0-100, default 30
  maxPatternsPerBatch: number;   // Default 50
  
  // Cost controls
  maxTokens?: number;
  maxCostUSD?: number;
  
  // Behavior
  dryRun: boolean;
  autoApply: boolean;
  interactive: boolean;
}

export interface AIReviewInput {
  patterns: DiscoveredPattern[];
  tables: TableInfo[];
  accessPoints: DataAccessPoint[];
  contracts: Contract[];
  codeContext: Map<string, string>;  // file -> relevant snippet
}

export interface AIReviewOutput {
  // Pattern decisions
  approvals: PatternDecision[];
  ignores: PatternDecision[];
  needsReview: PatternDecision[];
  unchanged: string[];  // pattern IDs
  
  // Consolidations
  duplicateMerges: DuplicateMerge[];
  tableConsolidations: TableConsolidation[];
  
  // Confidence adjustments
  confidenceAdjustments: ConfidenceAdjustment[];
  
  // Metadata
  tokensUsed: number;
  estimatedCost: number;
  reviewDuration: number;
  modelUsed: string;
}

export interface PatternDecision {
  patternId: string;
  action: 'approve' | 'ignore' | 'review';
  confidence: number;  // AI's confidence in this decision
  reasoning: string;
  codeContext?: string;
  suggestedConfidence?: number;  // If adjusting
}

export interface DuplicateMerge {
  keepPatternId: string;
  mergePatternIds: string[];
  reasoning: string;
}

export interface TableConsolidation {
  canonicalName: string;
  aliases: string[];
  reasoning: string;
}

export interface ConfidenceAdjustment {
  patternId: string;
  originalConfidence: number;
  adjustedConfidence: number;
  reasoning: string;
}
```

### AI Review Service

```typescript
// packages/ai/src/review/ai-review-service.ts

export class AIReviewService {
  private provider: LLMProvider;
  private config: AIReviewConfig;
  
  constructor(config: AIReviewConfig) {
    this.config = config;
    this.provider = createProvider(config);
  }
  
  async review(input: AIReviewInput): Promise<AIReviewOutput> {
    const startTime = Date.now();
    
    // Phase 1: Deduplicate patterns
    const dedupeResult = await this.deduplicatePatterns(input.patterns);
    
    // Phase 2: Consolidate table names
    const tableResult = await this.consolidateTables(input.tables);
    
    // Phase 3: Verify confidence scores
    const confidenceResult = await this.verifyConfidence(
      input.patterns,
      input.codeContext
    );
    
    // Phase 4: Triage for approval/ignore
    const triageResult = await this.triagePatterns(
      input.patterns,
      confidenceResult
    );
    
    return {
      ...triageResult,
      duplicateMerges: dedupeResult.merges,
      tableConsolidations: tableResult.consolidations,
      confidenceAdjustments: confidenceResult.adjustments,
      tokensUsed: this.provider.totalTokens,
      estimatedCost: this.provider.estimateCost(),
      reviewDuration: Date.now() - startTime,
      modelUsed: this.config.model || this.provider.defaultModel,
    };
  }
  
  private async deduplicatePatterns(
    patterns: DiscoveredPattern[]
  ): Promise<DedupeResult> {
    // Group by category and similarity
    // Send to LLM for semantic duplicate detection
    // Return merge recommendations
  }
  
  private async consolidateTables(
    tables: TableInfo[]
  ): Promise<TableConsolidationResult> {
    // Identify naming variations (User, users, Users)
    // Send to LLM for canonical name selection
    // Return consolidation map
  }
  
  private async verifyConfidence(
    patterns: DiscoveredPattern[],
    codeContext: Map<string, string>
  ): Promise<ConfidenceResult> {
    // For patterns with confidence 60-90%
    // Send pattern + code context to LLM
    // Get adjusted confidence + reasoning
  }
  
  private async triagePatterns(
    patterns: DiscoveredPattern[],
    confidenceResult: ConfidenceResult
  ): Promise<TriageResult> {
    // Apply thresholds
    // High confidence (>85%) → auto-approve
    // Low confidence (<30%) → auto-ignore
    // Middle ground → needs review with reasoning
  }
}
```

### Prompt Engineering

```typescript
// packages/ai/src/prompts/pattern-review.ts

export const PATTERN_REVIEW_SYSTEM = `
You are a code architecture expert reviewing automatically detected patterns.
Your job is to verify pattern accuracy and recommend approval/ignore actions.

Guidelines:
- Approve patterns that represent genuine, intentional architectural decisions
- Ignore patterns that are noise, test fixtures, or false positives
- Flag uncertain cases for human review with clear reasoning
- Be conservative: when in doubt, flag for review rather than auto-deciding

Output JSON only, no explanation outside the JSON structure.
`;

export const PATTERN_REVIEW_USER = (patterns: PatternBatch) => `
Review these detected patterns and recommend actions:

${JSON.stringify(patterns, null, 2)}

For each pattern, provide:
{
  "patternId": "...",
  "action": "approve" | "ignore" | "review",
  "confidence": 0-100,
  "reasoning": "Brief explanation"
}
`;

export const TABLE_CONSOLIDATION_PROMPT = `
These table names were detected in the codebase. Identify which ones
refer to the same underlying table and should be consolidated:

Tables: ${JSON.stringify(tables)}

Output:
{
  "consolidations": [
    {
      "canonicalName": "users",
      "aliases": ["User", "Users", "user"],
      "reasoning": "Same table, different casing conventions"
    }
  ]
}
`;
```

### CLI Integration

```typescript
// packages/cli/src/commands/scan.ts

scanCommand
  .option('--ai-review', 'Enable AI-assisted review of scan results')
  .option('--ai-provider <provider>', 'AI provider (anthropic, openai, ollama)', 'anthropic')
  .option('--ai-model <model>', 'Specific model to use')
  .option('--auto-apply', 'Auto-apply AI recommendations without confirmation')
  .option('--dry-run', 'Preview AI recommendations without saving')
  .option('--review-threshold <n>', 'Confidence threshold for auto-decisions', '85')
  .action(async (targetPath, options) => {
    // ... existing scan logic ...
    
    if (options.aiReview) {
      const reviewService = new AIReviewService({
        provider: options.aiProvider,
        model: options.aiModel,
        autoApply: options.autoApply,
        dryRun: options.dryRun,
        autoApproveThreshold: parseInt(options.reviewThreshold),
        interactive: !options.autoApply && !options.dryRun,
      });
      
      // Estimate cost before proceeding
      const estimate = await reviewService.estimateCost(scanResults);
      
      if (!options.autoApply) {
        const proceed = await confirm({
          message: `AI review will use ~${estimate.tokens} tokens (~$${estimate.cost.toFixed(2)}). Continue?`
        });
        if (!proceed) return;
      }
      
      // Run AI review
      const reviewResult = await reviewService.review({
        patterns: scanResults.patterns,
        tables: scanResults.tables,
        accessPoints: scanResults.accessPoints,
        contracts: scanResults.contracts,
        codeContext: await gatherCodeContext(scanResults),
      });
      
      // Display results
      displayReviewSummary(reviewResult);
      
      // Handle items needing human review
      if (options.interactive && reviewResult.needsReview.length > 0) {
        await interactiveReview(reviewResult.needsReview);
      }
      
      // Apply if not dry-run
      if (!options.dryRun) {
        await applyReviewResults(reviewResult, scanResults);
      }
    }
    
    // ... persist results ...
  });
```

### Configuration

```json
// .drift/config.json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "review": {
      "autoApproveThreshold": 85,
      "autoIgnoreThreshold": 30,
      "maxCostUSD": 1.00,
      "enabledCategories": ["data-access", "api", "auth"]
    }
  }
}
```

```bash
# Environment variables
DRIFT_AI_PROVIDER=anthropic
DRIFT_AI_API_KEY=sk-ant-...
DRIFT_AI_MODEL=claude-sonnet-4-20250514
```

## Cost Management

### Token Estimation

```typescript
function estimateTokens(input: AIReviewInput): number {
  // Rough estimates
  const patternTokens = input.patterns.length * 150;  // ~150 tokens per pattern
  const tableTokens = input.tables.length * 50;
  const contextTokens = sumValues(input.codeContext) / 4;  // ~4 chars per token
  const promptOverhead = 2000;  // System prompts, formatting
  
  return patternTokens + tableTokens + contextTokens + promptOverhead;
}

function estimateCost(tokens: number, provider: string): number {
  const rates = {
    'anthropic:claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
    'anthropic:claude-3-haiku': { input: 0.00025, output: 0.00125 },
    'openai:gpt-4o': { input: 0.005, output: 0.015 },
    'openai:gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  };
  
  // Assume 30% output ratio
  const inputTokens = tokens * 0.7;
  const outputTokens = tokens * 0.3;
  
  const rate = rates[provider] || rates['anthropic:claude-sonnet-4-20250514'];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
}
```

### Cost Controls

```typescript
interface CostControls {
  maxTokens?: number;      // Hard limit on tokens
  maxCostUSD?: number;     // Hard limit on cost
  batchSize: number;       // Process in batches to stay under limits
  prioritize: 'accuracy' | 'cost';  // Trade-off preference
}

// If approaching limits, prioritize:
// 1. Data-access patterns (most valuable)
// 2. Low-confidence patterns (most need review)
// 3. Patterns with outliers (most likely issues)
```

## Batching Strategy

For large codebases, process in intelligent batches:

```typescript
async function batchReview(
  patterns: DiscoveredPattern[],
  config: AIReviewConfig
): Promise<AIReviewOutput[]> {
  // Sort by priority
  const sorted = patterns.sort((a, b) => {
    // Prioritize: data-access > auth > api > others
    // Then by: low confidence > high confidence
    // Then by: has outliers > no outliers
  });
  
  // Batch by category for better context
  const batches = groupByCategory(sorted, config.maxPatternsPerBatch);
  
  const results: AIReviewOutput[] = [];
  for (const batch of batches) {
    // Check cost limits
    if (exceedsCostLimit(results, config)) {
      console.warn('Cost limit reached, stopping review');
      break;
    }
    
    results.push(await reviewBatch(batch));
  }
  
  return mergeResults(results);
}
```

## Error Handling

```typescript
class AIReviewService {
  async review(input: AIReviewInput): Promise<AIReviewOutput> {
    try {
      return await this.doReview(input);
    } catch (error) {
      if (error instanceof RateLimitError) {
        // Retry with exponential backoff
        return await this.retryWithBackoff(input);
      }
      
      if (error instanceof APIError) {
        // Log error, return empty result (scan still succeeds)
        console.error('AI review failed:', error.message);
        console.log('Continuing with standard scan results...');
        return this.emptyResult();
      }
      
      throw error;
    }
  }
  
  private emptyResult(): AIReviewOutput {
    return {
      approvals: [],
      ignores: [],
      needsReview: [],
      unchanged: [],
      duplicateMerges: [],
      tableConsolidations: [],
      confidenceAdjustments: [],
      tokensUsed: 0,
      estimatedCost: 0,
      reviewDuration: 0,
      modelUsed: 'none',
    };
  }
}
```

## Audit Trail

All AI decisions are logged for transparency:

```typescript
// .drift/history/ai-reviews/2024-01-15T10-30-00.json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "tokensUsed": 45000,
  "cost": 0.15,
  "duration": 12300,
  
  "input": {
    "patternsCount": 984,
    "tablesCount": 13,
    "accessPointsCount": 69
  },
  
  "decisions": [
    {
      "patternId": "abc123",
      "action": "approve",
      "confidence": 95,
      "reasoning": "Clear Prisma query pattern with proper typing"
    },
    // ... all decisions with reasoning
  ],
  
  "consolidations": [
    {
      "type": "table",
      "from": ["User", "Users"],
      "to": "users",
      "reasoning": "Same table, standardizing to lowercase plural"
    }
  ]
}
```

## Future Enhancements

### Phase 2: Learning from Corrections

When users override AI decisions, feed back to improve:

```typescript
// User approved something AI said to ignore
await feedbackService.recordCorrection({
  patternId: 'xyz',
  aiDecision: 'ignore',
  userDecision: 'approve',
  context: pattern,
});

// Use corrections to fine-tune prompts or train custom model
```

### Phase 3: Team Knowledge Sharing

Share AI review results across team:

```bash
drift scan --ai-review --share-decisions

# Uploads anonymized decisions to Drift cloud
# Other users benefit from collective learning
```

### Phase 4: Custom Rules Integration

Let users define rules that AI enforces:

```yaml
# .drift/ai-rules.yaml
rules:
  - name: "Approve all Prisma patterns"
    condition: "pattern.orm === 'prisma'"
    action: "approve"
    
  - name: "Flag raw SQL"
    condition: "pattern.type === 'raw-sql'"
    action: "review"
    note: "Raw SQL should be reviewed for injection risks"
```

## Implementation Plan

### Phase 1: MVP (2 weeks)

1. Basic AI review service with Anthropic support
2. Pattern deduplication
3. Confidence verification
4. Simple approve/ignore triage
5. CLI integration with `--ai-review` flag
6. Cost estimation and confirmation

### Phase 2: Polish (1 week)

1. Interactive review UI for uncertain items
2. Table name consolidation
3. Dry-run mode
4. Audit trail logging
5. OpenAI provider support

### Phase 3: Enterprise (2 weeks)

1. Ollama/local model support
2. Cost controls and limits
3. Batch processing for large codebases
4. Team sharing features
5. Custom rules integration

## Success Metrics

- **Time saved**: Measure manual review time before/after
- **Accuracy**: Track AI decision accuracy vs user corrections
- **Adoption**: % of users enabling AI review
- **Cost efficiency**: Average cost per scan
- **User satisfaction**: Survey feedback on review quality
