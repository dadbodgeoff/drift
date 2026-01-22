/**
 * Rate Limiter
 * 
 * Sliding window rate limiting to prevent abuse.
 * Configurable per-tool and global limits.
 */

import { Errors } from './error-handler.js';

export interface RateLimitConfig {
  // Global limits
  globalMaxRequests: number;
  globalWindowMs: number;
  
  // Per-tool limits (optional overrides)
  toolLimits?: Record<string, {
    maxRequests: number;
    windowMs: number;
  }>;
  
  // Expensive operations get stricter limits
  expensiveTools?: string[];
  expensiveMaxRequests?: number;
  expensiveWindowMs?: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  globalMaxRequests: 100,
  globalWindowMs: 60000, // 1 minute
  expensiveTools: [
    'drift_callgraph',
    'drift_code_examples',
    'drift_impact_analysis',
    'drift_security_summary',
  ],
  expensiveMaxRequests: 10,
  expensiveWindowMs: 60000,
};

interface RateLimitWindow {
  requests: number[];
}

export class RateLimiter {
  private windows: Map<string, RateLimitWindow> = new Map();
  private config: RateLimitConfig;
  
  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Check if request is allowed
   * @throws DriftError if rate limited
   */
  checkLimit(tool: string, identifier: string = 'default'): void {
    const now = Date.now();
    
    // Check global limit
    this.checkWindowLimit(
      `global:${identifier}`,
      this.config.globalMaxRequests,
      this.config.globalWindowMs,
      now
    );
    
    // Check tool-specific limit
    const toolLimit = this.config.toolLimits?.[tool];
    if (toolLimit) {
      this.checkWindowLimit(
        `tool:${tool}:${identifier}`,
        toolLimit.maxRequests,
        toolLimit.windowMs,
        now
      );
    }
    
    // Check expensive tool limit
    if (this.config.expensiveTools?.includes(tool)) {
      this.checkWindowLimit(
        `expensive:${identifier}`,
        this.config.expensiveMaxRequests ?? 10,
        this.config.expensiveWindowMs ?? 60000,
        now
      );
    }
  }
  
  /**
   * Get remaining requests for a limit
   */
  getRemainingRequests(
    tool: string, 
    identifier: string = 'default'
  ): {
    global: number;
    tool?: number;
    expensive?: number;
  } {
    const now = Date.now();
    
    const result: {
      global: number;
      tool?: number;
      expensive?: number;
    } = {
      global: this.getRemaining(
        `global:${identifier}`,
        this.config.globalMaxRequests,
        this.config.globalWindowMs,
        now
      ),
    };
    
    const toolLimit = this.config.toolLimits?.[tool];
    if (toolLimit) {
      result.tool = this.getRemaining(
        `tool:${tool}:${identifier}`,
        toolLimit.maxRequests,
        toolLimit.windowMs,
        now
      );
    }
    
    if (this.config.expensiveTools?.includes(tool)) {
      result.expensive = this.getRemaining(
        `expensive:${identifier}`,
        this.config.expensiveMaxRequests ?? 10,
        this.config.expensiveWindowMs ?? 60000,
        now
      );
    }
    
    return result;
  }
  
  /**
   * Record a request (call after successful processing)
   */
  recordRequest(tool: string, identifier: string = 'default'): void {
    const now = Date.now();
    
    this.addToWindow(`global:${identifier}`, now);
    
    if (this.config.toolLimits?.[tool]) {
      this.addToWindow(`tool:${tool}:${identifier}`, now);
    }
    
    if (this.config.expensiveTools?.includes(tool)) {
      this.addToWindow(`expensive:${identifier}`, now);
    }
  }
  
  /**
   * Clear all rate limit windows
   */
  clear(): void {
    this.windows.clear();
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    activeWindows: number;
    totalRequests: number;
  } {
    let totalRequests = 0;
    for (const window of this.windows.values()) {
      totalRequests += window.requests.length;
    }
    
    return {
      activeWindows: this.windows.size,
      totalRequests,
    };
  }
  
  // Private methods
  
  private checkWindowLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
    now: number
  ): void {
    const window = this.getOrCreateWindow(key);
    const windowStart = now - windowMs;
    
    // Clean old requests
    window.requests = window.requests.filter(t => t > windowStart);
    
    if (window.requests.length >= maxRequests) {
      // Calculate retry after
      const oldestRequest = window.requests[0];
      const retryAfter = oldestRequest ? oldestRequest + windowMs - now : windowMs;
      
      throw Errors.rateLimited(Math.max(0, retryAfter));
    }
  }
  
  private getRemaining(
    key: string,
    maxRequests: number,
    windowMs: number,
    now: number
  ): number {
    const window = this.windows.get(key);
    if (!window) {
      return maxRequests;
    }
    
    const windowStart = now - windowMs;
    const validRequests = window.requests.filter(t => t > windowStart);
    
    return Math.max(0, maxRequests - validRequests.length);
  }
  
  private addToWindow(key: string, timestamp: number): void {
    const window = this.getOrCreateWindow(key);
    window.requests.push(timestamp);
  }
  
  private getOrCreateWindow(key: string): RateLimitWindow {
    let window = this.windows.get(key);
    if (!window) {
      window = { requests: [] };
      this.windows.set(key, window);
    }
    return window;
  }
}

/**
 * Singleton instance for convenience
 */
export const rateLimiter = new RateLimiter();
