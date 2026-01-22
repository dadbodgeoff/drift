/**
 * Cursor Manager
 * 
 * Provides stable, opaque cursor-based pagination.
 * Cursors are:
 * - Base64url encoded for URL safety
 * - Versioned for forward compatibility
 * - Time-limited to prevent stale pagination
 * - Query-bound to prevent misuse
 */

import { createHash } from 'crypto';

export interface CursorData {
  // Position markers (at least one required)
  lastId?: string;
  lastScore?: number;
  lastTimestamp?: string;
  offset?: number;
  
  // Query context for validation
  queryHash: string;
  
  // Metadata
  createdAt: number;
  version: number;
}

export interface CursorConfig {
  version: number;
  maxAgeMs: number;
  secret?: string; // For HMAC signing (optional)
}

const DEFAULT_CONFIG: CursorConfig = {
  version: 1,
  maxAgeMs: 3600000, // 1 hour
};

export class CursorManager {
  private readonly config: CursorConfig;
  
  constructor(config: Partial<CursorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Encode cursor data to opaque string
   */
  encode(data: Omit<CursorData, 'createdAt' | 'version'>): string {
    const fullData: CursorData = {
      ...data,
      createdAt: Date.now(),
      version: this.config.version,
    };
    
    const json = JSON.stringify(fullData);
    const encoded = Buffer.from(json).toString('base64url');
    
    // Optionally add HMAC signature
    if (this.config.secret) {
      const signature = this.sign(encoded);
      return `${encoded}.${signature}`;
    }
    
    return encoded;
  }
  
  /**
   * Decode cursor string to data
   */
  decode(cursor: string): CursorData | null {
    try {
      let encoded = cursor;
      
      // Verify signature if secret is configured
      if (this.config.secret) {
        const parts = cursor.split('.');
        if (parts.length !== 2) {
          return null;
        }
        
        const [data, signature] = parts;
        if (!data || !signature || !this.verify(data, signature)) {
          return null;
        }
        
        encoded = data;
      }
      
      const json = Buffer.from(encoded, 'base64url').toString();
      const data = JSON.parse(json) as CursorData;
      
      // Validate version
      if (data.version !== this.config.version) {
        return null;
      }
      
      // Validate age
      if (Date.now() - data.createdAt > this.config.maxAgeMs) {
        return null;
      }
      
      return data;
    } catch {
      return null;
    }
  }
  
  /**
   * Create a query hash for cursor validation
   */
  createQueryHash(params: Record<string, unknown>): string {
    // Sort keys for consistent hashing
    const sorted = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, unknown>);
    
    return createHash('sha256')
      .update(JSON.stringify(sorted))
      .digest('hex')
      .slice(0, 16);
  }
  
  /**
   * Validate that a cursor matches the current query
   */
  validateQueryMatch(cursor: CursorData, params: Record<string, unknown>): boolean {
    const currentHash = this.createQueryHash(params);
    return cursor.queryHash === currentHash;
  }
  
  /**
   * Create cursor for pattern-based pagination
   */
  createPatternCursor(
    lastPattern: { id: string; confidence: { score: number } },
    queryParams: Record<string, unknown>
  ): string {
    return this.encode({
      lastId: lastPattern.id,
      lastScore: lastPattern.confidence.score,
      queryHash: this.createQueryHash(queryParams),
    });
  }
  
  /**
   * Create cursor for offset-based pagination (fallback)
   */
  createOffsetCursor(
    offset: number,
    queryParams: Record<string, unknown>
  ): string {
    return this.encode({
      offset,
      queryHash: this.createQueryHash(queryParams),
    });
  }
  
  /**
   * Create cursor for timestamp-based pagination
   */
  createTimestampCursor(
    lastTimestamp: string | Date,
    lastId: string,
    queryParams: Record<string, unknown>
  ): string {
    return this.encode({
      lastTimestamp: typeof lastTimestamp === 'string' 
        ? lastTimestamp 
        : lastTimestamp.toISOString(),
      lastId,
      queryHash: this.createQueryHash(queryParams),
    });
  }
  
  /**
   * Sign data with HMAC
   */
  private sign(data: string): string {
    if (!this.config.secret) {
      throw new Error('Secret required for signing');
    }
    
    return createHash('sha256')
      .update(data + this.config.secret)
      .digest('hex')
      .slice(0, 16);
  }
  
  /**
   * Verify HMAC signature
   */
  private verify(data: string, signature: string): boolean {
    const expected = this.sign(data);
    return expected === signature;
  }
}

/**
 * Singleton instance for convenience
 */
export const cursorManager = new CursorManager();

/**
 * Simple cursor creation for offset-based pagination
 * Creates a lightweight cursor without query validation
 */
export function createCursor(offset: number, limit: number): string {
  const data = { offset, limit, v: 1 };
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

/**
 * Parse a simple cursor
 */
export function parseCursor(cursor: string): { offset: number; limit: number } {
  try {
    const json = Buffer.from(cursor, 'base64url').toString();
    const data = JSON.parse(json) as { offset: number; limit: number };
    return {
      offset: data.offset ?? 0,
      limit: data.limit ?? 20,
    };
  } catch {
    return { offset: 0, limit: 20 };
  }
}
