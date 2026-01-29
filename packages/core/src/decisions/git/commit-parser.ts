/**
 * Commit Message Parser
 *
 * Parses commit messages to extract semantic information,
 * conventional commit format, and architectural signals.
 */

import type {
  MessageSignal,
  DecisionCategory,
} from '../types.js';
import type {
  ParsedCommitMessage,
  ConventionalCommitType,
  FooterToken,
  MessageReference,
} from './types.js';

// ============================================================================
// Conventional Commit Parsing
// ============================================================================

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const CONVENTIONAL_TYPE_MAP: Record<ConventionalCommitType, DecisionCategory | null> = {
  feat: 'pattern-introduction',
  fix: null, // Usually not architectural
  docs: null,
  style: null,
  refactor: 'refactoring',
  perf: 'performance-optimization',
  test: 'testing-strategy',
  build: 'infrastructure',
  ci: 'infrastructure',
  chore: null,
  revert: null,
};

// ============================================================================
// Keyword Detection
// ============================================================================

/**
 * Keywords that suggest architectural decisions
 */
const ARCHITECTURAL_KEYWORDS: Array<{
  keywords: string[];
  category: DecisionCategory;
  weight: number;
}> = [
  // Technology adoption
  {
    keywords: ['migrate', 'migration', 'switch to', 'adopt', 'introduce', 'add support for', 'integrate'],
    category: 'technology-adoption',
    weight: 0.8,
  },
  // Technology removal
  {
    keywords: ['remove', 'deprecate', 'drop support', 'sunset', 'phase out', 'eliminate'],
    category: 'technology-removal',
    weight: 0.7,
  },
  // Pattern changes
  {
    keywords: ['refactor', 'restructure', 'reorganize', 'consolidate', 'simplify', 'extract', 'inline'],
    category: 'refactoring',
    weight: 0.6,
  },
  // Architecture
  {
    keywords: ['architecture', 'design', 'pattern', 'abstraction', 'layer', 'module', 'component'],
    category: 'architecture-change',
    weight: 0.7,
  },
  // API changes
  {
    keywords: ['api', 'endpoint', 'route', 'interface', 'contract', 'schema', 'breaking change'],
    category: 'api-change',
    weight: 0.7,
  },
  // Security
  {
    keywords: ['security', 'auth', 'authentication', 'authorization', 'permission', 'encrypt', 'vulnerability'],
    category: 'security-enhancement',
    weight: 0.8,
  },
  // Performance
  {
    keywords: ['performance', 'optimize', 'speed', 'cache', 'lazy', 'async', 'parallel', 'batch'],
    category: 'performance-optimization',
    weight: 0.6,
  },
  // Testing
  {
    keywords: ['test strategy', 'testing approach', 'test framework', 'coverage', 'e2e', 'integration test'],
    category: 'testing-strategy',
    weight: 0.5,
  },
  // Infrastructure
  {
    keywords: ['ci/cd', 'pipeline', 'deploy', 'docker', 'kubernetes', 'terraform', 'infrastructure'],
    category: 'infrastructure',
    weight: 0.6,
  },
];

/**
 * Breaking change indicators
 */
const BREAKING_CHANGE_INDICATORS = [
  'BREAKING CHANGE',
  'BREAKING-CHANGE',
  'BREAKING:',
  '!:',
  'breaking:',
  'incompatible',
  'backwards-incompatible',
];

/**
 * Reference patterns
 */
const REFERENCE_PATTERNS = [
  // GitHub/GitLab style
  { regex: /(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi, type: 'issue' as const, action: true },
  { regex: /#(\d+)/g, type: 'issue' as const, action: false },
  // Full URLs
  { regex: /https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/(\d+)/g, type: 'pr' as const, action: false },
  // Commit references
  { regex: /([a-f0-9]{7,40})/g, type: 'commit' as const, action: false },
];

// ============================================================================
// Parser Class
// ============================================================================

/**
 * Commit message parser
 */
export class CommitParser {
  /**
   * Parse a commit message
   */
  parse(subject: string, body: string = ''): ParsedCommitMessage {
    const fullMessage = body ? `${subject}\n\n${body}` : subject;
    
    // Parse conventional commit format
    const conventional = this.parseConventionalCommit(subject);
    
    // Detect breaking changes
    const isBreakingChange = this.detectBreakingChange(fullMessage, conventional?.isBreaking);
    
    // Parse footer tokens
    const footerTokens = this.parseFooterTokens(body);
    
    // Detect keywords
    const keywords = this.detectKeywords(fullMessage);
    
    // Parse references
    const references = this.parseReferences(fullMessage);

    const result: ParsedCommitMessage = {
      subject,
      body,
      isBreakingChange,
      footerTokens,
      keywords,
      references,
    };
    
    if (conventional?.type) {
      result.conventionalType = conventional.type;
    }
    if (conventional?.scope) {
      result.scope = conventional.scope;
    }

    return result;
  }

  /**
   * Extract message signals for decision mining
   */
  extractSignals(subject: string, body: string = ''): MessageSignal[] {
    const signals: MessageSignal[] = [];
    const parsed = this.parse(subject, body);
    const fullMessage = body ? `${subject}\n\n${body}` : subject;
    const lowerMessage = fullMessage.toLowerCase();

    // Conventional commit type signal
    if (parsed.conventionalType) {
      const categoryHint = CONVENTIONAL_TYPE_MAP[parsed.conventionalType];
      if (categoryHint) {
        signals.push({
          type: 'pattern',
          value: `conventional:${parsed.conventionalType}`,
          confidence: 0.7,
          categoryHint,
        });
      }
    }

    // Breaking change signal
    if (parsed.isBreakingChange) {
      signals.push({
        type: 'breaking-change',
        value: 'breaking-change',
        confidence: 0.9,
        categoryHint: 'api-change',
      });
    }

    // Keyword signals
    for (const keywordGroup of ARCHITECTURAL_KEYWORDS) {
      for (const keyword of keywordGroup.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          signals.push({
            type: 'keyword',
            value: keyword,
            confidence: keywordGroup.weight,
            categoryHint: keywordGroup.category,
          });
        }
      }
    }

    // Reference signals
    for (const ref of parsed.references) {
      signals.push({
        type: 'reference',
        value: `${ref.type}:${ref.id}`,
        confidence: 0.5,
      });
    }

    // Deprecation signals
    if (lowerMessage.includes('deprecat')) {
      signals.push({
        type: 'deprecation',
        value: 'deprecation',
        confidence: 0.8,
        categoryHint: 'technology-removal',
      });
    }

    return signals;
  }

  /**
   * Calculate architectural significance score (0-1)
   */
  calculateSignificance(subject: string, body: string = ''): number {
    const signals = this.extractSignals(subject, body);
    
    if (signals.length === 0) {
      return 0.1; // Base significance for any commit
    }

    // Weight signals
    let totalWeight = 0;
    let maxWeight = 0;

    for (const signal of signals) {
      totalWeight += signal.confidence;
      maxWeight = Math.max(maxWeight, signal.confidence);
    }

    // Combine: max signal weight + bonus for multiple signals
    const multiSignalBonus = Math.min(0.2, (signals.length - 1) * 0.05);
    const significance = Math.min(1, maxWeight + multiSignalBonus);

    return significance;
  }

  /**
   * Parse conventional commit format
   */
  private parseConventionalCommit(subject: string): {
    type: ConventionalCommitType;
    scope?: string;
    isBreaking: boolean;
    description: string;
  } | null {
    const match = subject.match(CONVENTIONAL_COMMIT_REGEX);
    if (!match) {return null;}

    const [, typeStr, scope, breaking, description] = match;
    if (!typeStr || !description) {return null;}
    
    const normalizedType = typeStr.toLowerCase() as ConventionalCommitType;

    // Validate type
    if (!Object.keys(CONVENTIONAL_TYPE_MAP).includes(normalizedType)) {
      return null;
    }

    const result: {
      type: ConventionalCommitType;
      scope?: string;
      isBreaking: boolean;
      description: string;
    } = {
      type: normalizedType,
      isBreaking: !!breaking,
      description,
    };
    
    if (scope) {
      result.scope = scope;
    }

    return result;
  }

  /**
   * Detect breaking changes
   */
  private detectBreakingChange(message: string, conventionalBreaking?: boolean): boolean {
    if (conventionalBreaking) {return true;}

    const upperMessage = message.toUpperCase();
    return BREAKING_CHANGE_INDICATORS.some(indicator =>
      upperMessage.includes(indicator.toUpperCase())
    );
  }

  /**
   * Parse footer tokens (e.g., "Fixes #123", "BREAKING CHANGE: ...")
   */
  private parseFooterTokens(body: string): FooterToken[] {
    const tokens: FooterToken[] = [];
    const lines = body.split('\n');

    for (const line of lines) {
      // Match "Key: Value" or "Key #Value" patterns
      const match = line.match(/^([A-Z][A-Za-z-]+)(?::\s*|\s+#)(.+)$/);
      if (match?.[1] && match[2]) {
        tokens.push({
          key: match[1],
          value: match[2].trim(),
        });
      }
    }

    return tokens;
  }

  /**
   * Detect architectural keywords
   */
  private detectKeywords(message: string): string[] {
    const keywords: string[] = [];
    const lowerMessage = message.toLowerCase();

    for (const group of ARCHITECTURAL_KEYWORDS) {
      for (const keyword of group.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          keywords.push(keyword);
        }
      }
    }

    return [...new Set(keywords)];
  }

  /**
   * Parse references to issues, PRs, commits
   */
  private parseReferences(message: string): MessageReference[] {
    const references: MessageReference[] = [];
    const seen = new Set<string>();

    for (const pattern of REFERENCE_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;

      while ((match = regex.exec(message)) !== null) {
        const id = pattern.action ? match[2] : match[1];
        if (!id) {continue;}
        
        const key = `${pattern.type}:${id}`;

        if (!seen.has(key)) {
          seen.add(key);
          const ref: MessageReference = {
            type: pattern.type,
            id,
          };
          if (pattern.action && match[1]) {
            ref.action = match[1].toLowerCase();
          }
          references.push(ref);
        }
      }
    }

    return references;
  }
}

/**
 * Create a commit parser instance
 */
export function createCommitParser(): CommitParser {
  return new CommitParser();
}

/**
 * Quick parse function
 */
export function parseCommitMessage(subject: string, body?: string): ParsedCommitMessage {
  return new CommitParser().parse(subject, body);
}

/**
 * Quick signal extraction
 */
export function extractMessageSignals(subject: string, body?: string): MessageSignal[] {
  return new CommitParser().extractSignals(subject, body);
}
