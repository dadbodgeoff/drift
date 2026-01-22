/**
 * Enterprise Response Builder
 * 
 * Provides consistent response formatting with:
 * - Summary-first responses
 * - Token budget awareness
 * - Pagination support
 * - AI-friendly hints
 */

import { TokenEstimator } from './token-estimator.js';

export interface MCPResponseMeta {
  requestId: string;
  durationMs: number;
  cached: boolean;
  tokenEstimate: number;
}

export interface PaginationInfo {
  cursor?: string | undefined;
  hasMore: boolean;
  totalCount?: number | undefined;
  pageSize: number;
}

export interface ResponseHints {
  nextActions?: string[];
  relatedTools?: string[];
  warnings?: string[] | undefined;
}

export interface MCPResponse<T> {
  summary: string;
  data: T;
  pagination?: PaginationInfo;
  hints?: ResponseHints;
  meta: MCPResponseMeta;
}

export interface ResponseBuilderConfig {
  maxResponseTokens: number;
  maxSectionTokens: number;
  preferSummary: boolean;
}

const DEFAULT_CONFIG: ResponseBuilderConfig = {
  maxResponseTokens: 4000,
  maxSectionTokens: 1000,
  preferSummary: true,
};

export class ResponseBuilder<T> {
  private summary: string = '';
  private data: T | null = null;
  private pagination?: PaginationInfo;
  private hints?: ResponseHints;
  private startTime: number;
  private cached: boolean = false;
  
  private readonly config: ResponseBuilderConfig;
  private readonly tokenEstimator: TokenEstimator;
  
  constructor(
    private readonly requestId: string,
    config: Partial<ResponseBuilderConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenEstimator = new TokenEstimator();
    this.startTime = Date.now();
  }
  
  /**
   * Set the summary (1-2 sentences describing the response)
   */
  withSummary(summary: string): this {
    this.summary = summary;
    return this;
  }
  
  /**
   * Set the main data payload
   */
  withData(data: T): this {
    this.data = data;
    return this;
  }
  
  /**
   * Add pagination info
   */
  withPagination(info: PaginationInfo): this {
    this.pagination = info;
    return this;
  }
  
  /**
   * Create pagination from array results
   */
  withArrayPagination<Item>(
    items: Item[],
    totalCount: number,
    pageSize: number,
    createCursor: (lastItem: Item) => string
  ): this {
    const hasMore = items.length === pageSize && items.length < totalCount;
    
    this.pagination = {
      hasMore,
      totalCount,
      pageSize,
      cursor: hasMore && items.length > 0 
        ? createCursor(items[items.length - 1]!) 
        : undefined,
    };
    
    return this;
  }
  
  /**
   * Add hints for AI to understand next steps
   */
  withHints(hints: ResponseHints): this {
    this.hints = hints;
    return this;
  }
  
  /**
   * Add a single next action hint
   */
  addNextAction(action: string): this {
    if (!this.hints) {
      this.hints = {};
    }
    if (!this.hints.nextActions) {
      this.hints.nextActions = [];
    }
    this.hints.nextActions.push(action);
    return this;
  }
  
  /**
   * Add a warning hint
   */
  addWarning(warning: string): this {
    if (!this.hints) {
      this.hints = {};
    }
    if (!this.hints.warnings) {
      this.hints.warnings = [];
    }
    this.hints.warnings.push(warning);
    return this;
  }
  
  /**
   * Mark response as served from cache
   */
  markCached(): this {
    this.cached = true;
    return this;
  }
  
  /**
   * Build the final response
   */
  build(): MCPResponse<T> {
    if (this.data === null) {
      throw new Error('Response data is required');
    }
    
    if (!this.summary) {
      throw new Error('Response summary is required');
    }
    
    const response: MCPResponse<T> = {
      summary: this.summary,
      data: this.data,
      meta: {
        requestId: this.requestId,
        durationMs: Date.now() - this.startTime,
        cached: this.cached,
        tokenEstimate: 0, // Will be calculated below
      },
    };
    
    if (this.pagination) {
      response.pagination = this.pagination;
    }
    
    if (this.hints && Object.keys(this.hints).length > 0) {
      response.hints = this.hints;
    }
    
    // Calculate token estimate
    response.meta.tokenEstimate = this.tokenEstimator.estimate(
      JSON.stringify(response)
    );
    
    // Check if we need to fit to budget
    if (response.meta.tokenEstimate > this.config.maxResponseTokens) {
      return this.fitToBudget(response);
    }
    
    return response;
  }
  
  /**
   * Build and serialize to MCP content format
   */
  buildContent(): { content: Array<{ type: string; text: string }> } {
    const response = this.build();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2),
      }],
    };
  }
  
  /**
   * Fit response to token budget
   */
  private fitToBudget(response: MCPResponse<T>): MCPResponse<T> {
    // Strategy 1: If data is an array, reduce page size
    if (Array.isArray(response.data) && response.pagination) {
      const targetSize = Math.floor(
        response.data.length * 
        (this.config.maxResponseTokens / response.meta.tokenEstimate)
      );
      
      const reducedData = response.data.slice(0, Math.max(1, targetSize)) as T;
      
      return {
        ...response,
        data: reducedData,
        pagination: {
          ...response.pagination,
          hasMore: true,
          pageSize: targetSize,
        },
        hints: {
          ...response.hints,
          warnings: [
            ...(response.hints?.warnings || []),
            `Response truncated to fit token budget. Use pagination to see more.`,
          ],
        },
        meta: {
          ...response.meta,
          tokenEstimate: this.tokenEstimator.estimate(JSON.stringify({
            ...response,
            data: reducedData,
          })),
        },
      };
    }
    
    // Strategy 2: Add truncation warning
    return {
      ...response,
      hints: {
        ...response.hints,
        warnings: [
          ...(response.hints?.warnings || []),
          `Response is large (${response.meta.tokenEstimate} tokens). Consider using more specific filters.`,
        ],
      },
    };
  }
}

/**
 * Factory function for creating response builders
 */
export function createResponseBuilder<T>(
  requestId?: string,
  config?: Partial<ResponseBuilderConfig>
): ResponseBuilder<T> {
  const id = requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return new ResponseBuilder<T>(id, config);
}
