# AI Provider Package

## Location
`packages/ai/` — TypeScript, private package (`@drift/ai`)

## What It Is
Unified AI provider abstraction for code explanation and fix generation. Supports Anthropic (Claude), OpenAI, and Ollama (local). Used by CLI and CI for AI-powered suggestions.

## Architecture

```
┌─────────────────────────────────────┐
│           AIProvider Interface       │
│  explain() │ generateFix()           │
├──────────┬──────────┬───────────────┤
│ Anthropic│  OpenAI  │    Ollama     │
│ Provider │ Provider │   Provider    │
├──────────┴──────────┴───────────────┤
│         Context Building             │
│  CodeExtractor │ ContextBuilder      │
│  Sanitizer                           │
├─────────────────────────────────────┤
│         Prompt Templates             │
│  ExplainPrompt │ FixPrompt           │
├─────────────────────────────────────┤
│         Confirmation                 │
│  Consent │ Preview                   │
└─────────────────────────────────────┘
```

## File Map

| Directory | Files | Purpose |
|-----------|-------|---------|
| `providers/` | `base-provider.ts`, `anthropic-provider.ts`, `openai-provider.ts`, `ollama-provider.ts`, `types.ts` | Provider implementations |
| `context/` | `code-extractor.ts`, `context-builder.ts`, `sanitizer.ts` | Code context preparation |
| `prompts/` | `explain-prompt.ts`, `fix-prompt.ts` | Prompt templates |
| `confirmation/` | `consent.ts`, `preview.ts` | User confirmation flow |
| `types/` | `ai-types.ts` | Shared type definitions |

## AIProvider Interface
```typescript
interface AIProvider {
  name: string;
  requiresApiKey: boolean;
  envKeyName: string;
  isConfigured(): boolean;
  explain(context: ExplainContext): Promise<ExplainResult>;
  generateFix(context: FixContext): Promise<FixResult>;
}
```

## Provider Types
```typescript
type AIProviderType = 'openai' | 'anthropic' | 'ollama';
```

## Context Types
```typescript
interface ExplainContext {
  violation: unknown;
  pattern: unknown;
  codeSnippet: string;
  similarExamples: CodeExample[];
}

interface FixContext {
  violation: unknown;
  pattern: unknown;
  codeSnippet: string;
  surroundingCode: string;
}
```

## Result Types
```typescript
interface ExplainResult {
  explanation: string;
  suggestedAction: 'fix' | 'variant' | 'ignore';
}

interface FixResult {
  fixedCode: string;
  explanation: string;
  confidence: number;
}

interface AIResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

## Implementation Status
- `base-provider.ts` — Stub (TODO: implement)
- `anthropic-provider.ts` — Implemented
- `openai-provider.ts` — Implemented
- `ollama-provider.ts` — Implemented (local inference)

## Dependencies
- `driftdetect-core` ^0.9.28

## v2 Considerations
- Stays TypeScript — API calls to external services
- Consider adding streaming support for long explanations
- May add more providers (Google Gemini, AWS Bedrock)
- Context building could leverage Rust-parsed AST for better snippets
- Token counting should use tiktoken or provider-specific tokenizers
