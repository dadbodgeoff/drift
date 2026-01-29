/**
 * Token Estimator
 * 
 * Estimates token count for responses to stay within context budgets.
 * Uses heuristics based on typical tokenization patterns.
 */

export interface TokenEstimate {
  tokens: number;
  confidence: 'high' | 'medium' | 'low';
  breakdown?: {
    text: number;
    structure: number;
    whitespace: number;
  };
}

export class TokenEstimator {
  // Average characters per token for different content types
  private static readonly CHARS_PER_TOKEN = {
    english: 4,
    code: 3.5,
    json: 3,
    mixed: 3.5,
  };
  
  // JSON structure overhead multiplier
  private static readonly JSON_OVERHEAD = 1.15;
  
  /**
   * Estimate tokens for a string
   */
  estimate(text: string): number {
    if (!text) {return 0;}
    
    const contentType = this.detectContentType(text);
    const charsPerToken = TokenEstimator.CHARS_PER_TOKEN[contentType];
    
    // Base token count
    let tokens = Math.ceil(text.length / charsPerToken);
    
    // Add overhead for JSON structure
    if (contentType === 'json') {
      tokens = Math.ceil(tokens * TokenEstimator.JSON_OVERHEAD);
    }
    
    return tokens;
  }
  
  /**
   * Estimate with detailed breakdown
   */
  estimateDetailed(text: string): TokenEstimate {
    if (!text) {
      return { tokens: 0, confidence: 'high' };
    }
    
    const contentType = this.detectContentType(text);
    const charsPerToken = TokenEstimator.CHARS_PER_TOKEN[contentType];
    
    // Count different parts
    const whitespaceCount = (text.match(/\s/g) || []).length;
    const structureCount = (text.match(/[{}\[\]":,]/g) || []).length;
    const textCount = text.length - whitespaceCount - structureCount;
    
    // Estimate each part
    const textTokens = Math.ceil(textCount / charsPerToken);
    const structureTokens = Math.ceil(structureCount / 2); // Structure chars are often single tokens
    const whitespaceTokens = Math.ceil(whitespaceCount / 10); // Whitespace is heavily compressed
    
    const totalTokens = textTokens + structureTokens + whitespaceTokens;
    
    // Confidence based on content type
    const confidence = contentType === 'json' ? 'high' : 
                       contentType === 'code' ? 'medium' : 'medium';
    
    return {
      tokens: totalTokens,
      confidence,
      breakdown: {
        text: textTokens,
        structure: structureTokens,
        whitespace: whitespaceTokens,
      },
    };
  }
  
  /**
   * Estimate tokens for an object (will be JSON serialized)
   */
  estimateObject(obj: unknown): number {
    return this.estimate(JSON.stringify(obj, null, 2));
  }
  
  /**
   * Check if content fits within a token budget
   */
  fitsInBudget(text: string, budget: number): boolean {
    return this.estimate(text) <= budget;
  }
  
  /**
   * Truncate text to fit within token budget
   */
  truncateToFit(text: string, budget: number, suffix: string = '...[truncated]'): string {
    const currentTokens = this.estimate(text);
    
    if (currentTokens <= budget) {
      return text;
    }
    
    // Estimate how much to keep
    const ratio = budget / currentTokens;
    const targetLength = Math.floor(text.length * ratio * 0.9); // 10% safety margin
    const suffixLength = suffix.length;
    
    return text.slice(0, targetLength - suffixLength) + suffix;
  }
  
  /**
   * Detect content type for better estimation
   */
  private detectContentType(text: string): 'english' | 'code' | 'json' | 'mixed' {
    // Check for JSON
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        JSON.parse(text);
        return 'json';
      } catch {
        // Not valid JSON, continue checking
      }
    }
    
    // Check for code indicators
    const codeIndicators = [
      /function\s+\w+/,
      /const\s+\w+\s*=/,
      /class\s+\w+/,
      /import\s+.*from/,
      /def\s+\w+\(/,
      /=>/,
    ];
    
    const codeMatches = codeIndicators.filter(pattern => pattern.test(text)).length;
    if (codeMatches >= 2) {
      return 'code';
    }
    
    // Check JSON-like structure ratio
    const structureChars = (text.match(/[{}\[\]":,]/g) || []).length;
    const structureRatio = structureChars / text.length;
    
    if (structureRatio > 0.1) {
      return 'json';
    }
    
    // Default to mixed
    return 'mixed';
  }
}

/**
 * Singleton instance for convenience
 */
export const tokenEstimator = new TokenEstimator();
