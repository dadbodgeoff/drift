/**
 * Metrics Collector
 * 
 * Collects operational metrics for observability:
 * - Request counts and durations
 * - Cache hit/miss rates
 * - Token usage estimates
 * - Error rates
 */

export interface MetricLabels {
  tool?: string;
  success?: string;
  cached?: string;
  errorCode?: string;
}

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

export interface HistogramBuckets {
  le_10: number;
  le_50: number;
  le_100: number;
  le_250: number;
  le_500: number;
  le_1000: number;
  le_2500: number;
  le_5000: number;
  le_inf: number;
  sum: number;
  count: number;
}

export class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, HistogramBuckets> = new Map();
  private metrics: Metric[] = [];
  private maxMetrics: number = 10000;
  
  /**
   * Increment a counter
   */
  increment(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.makeKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
    
    this.recordMetric({
      name,
      type: 'counter',
      value: current + value,
      labels,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
    
    this.recordMetric({
      name,
      type: 'gauge',
      value,
      labels,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Record a histogram observation
   */
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.makeKey(name, labels);
    
    let buckets = this.histograms.get(key);
    if (!buckets) {
      buckets = this.createEmptyBuckets();
      this.histograms.set(key, buckets);
    }
    
    // Update buckets
    if (value <= 10) {buckets.le_10++;}
    if (value <= 50) {buckets.le_50++;}
    if (value <= 100) {buckets.le_100++;}
    if (value <= 250) {buckets.le_250++;}
    if (value <= 500) {buckets.le_500++;}
    if (value <= 1000) {buckets.le_1000++;}
    if (value <= 2500) {buckets.le_2500++;}
    if (value <= 5000) {buckets.le_5000++;}
    buckets.le_inf++;
    buckets.sum += value;
    buckets.count++;
    
    this.recordMetric({
      name,
      type: 'histogram',
      value,
      labels,
      timestamp: Date.now(),
    });
  }
  
  // Convenience methods for common metrics
  
  /**
   * Record a request
   */
  recordRequest(tool: string, durationMs: number, success: boolean, cached: boolean = false): void {
    this.increment('drift_mcp_requests_total', { 
      tool, 
      success: String(success),
      cached: String(cached),
    });
    
    this.observe('drift_mcp_request_duration_ms', durationMs, { tool });
    
    if (cached) {
      this.increment('drift_mcp_cache_hits_total', { tool });
    } else {
      this.increment('drift_mcp_cache_misses_total', { tool });
    }
  }
  
  /**
   * Record an error
   */
  recordError(tool: string, errorCode: string): void {
    this.increment('drift_mcp_errors_total', { tool, errorCode });
  }
  
  /**
   * Record token estimate
   */
  recordTokens(tool: string, tokens: number): void {
    this.observe('drift_mcp_response_tokens', tokens, { tool });
  }
  
  /**
   * Record patterns queried
   */
  recordPatternsQueried(count: number, tool: string): void {
    this.increment('drift_mcp_patterns_queried_total', { tool }, count);
  }
  
  /**
   * Get all metrics
   */
  getMetrics(): Metric[] {
    return [...this.metrics];
  }
  
  /**
   * Get summary statistics
   */
  getSummary(): {
    totalRequests: number;
    totalErrors: number;
    cacheHitRate: number;
    avgDurationMs: number;
    avgTokens: number;
    requestsByTool: Record<string, number>;
  } {
    let totalRequests = 0;
    let totalErrors = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const requestsByTool: Record<string, number> = {};
    
    // Count requests
    for (const [key, value] of this.counters) {
      if (key.startsWith('drift_mcp_requests_total')) {
        totalRequests += value;
        
        // Extract tool from key
        const toolMatch = key.match(/tool:(\w+)/);
        if (toolMatch) {
          const tool = toolMatch[1]!;
          requestsByTool[tool] = (requestsByTool[tool] ?? 0) + value;
        }
      }
      if (key.startsWith('drift_mcp_errors_total')) {
        totalErrors += value;
      }
      if (key.startsWith('drift_mcp_cache_hits_total')) {
        cacheHits += value;
      }
      if (key.startsWith('drift_mcp_cache_misses_total')) {
        cacheMisses += value;
      }
    }
    
    // Calculate averages from histograms
    let totalDuration = 0;
    let durationCount = 0;
    let totalTokens = 0;
    let tokenCount = 0;
    
    for (const [key, buckets] of this.histograms) {
      if (key.startsWith('drift_mcp_request_duration_ms')) {
        totalDuration += buckets.sum;
        durationCount += buckets.count;
      }
      if (key.startsWith('drift_mcp_response_tokens')) {
        totalTokens += buckets.sum;
        tokenCount += buckets.count;
      }
    }
    
    return {
      totalRequests,
      totalErrors,
      cacheHitRate: cacheHits + cacheMisses > 0 
        ? cacheHits / (cacheHits + cacheMisses) 
        : 0,
      avgDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
      avgTokens: tokenCount > 0 ? totalTokens / tokenCount : 0,
      requestsByTool,
    };
  }
  
  /**
   * Export metrics in Prometheus format
   */
  toPrometheus(): string {
    const lines: string[] = [];
    
    // Counters
    for (const [key, value] of this.counters) {
      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);
      lines.push(`${name}${labelStr} ${value}`);
    }
    
    // Gauges
    for (const [key, value] of this.gauges) {
      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);
      lines.push(`${name}${labelStr} ${value}`);
    }
    
    // Histograms
    for (const [key, buckets] of this.histograms) {
      const { name, labels } = this.parseKey(key);
      const labelStr = this.formatLabels(labels);
      
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '10')} ${buckets.le_10}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '50')} ${buckets.le_50}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '100')} ${buckets.le_100}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '250')} ${buckets.le_250}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '500')} ${buckets.le_500}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '1000')} ${buckets.le_1000}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '2500')} ${buckets.le_2500}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '5000')} ${buckets.le_5000}`);
      lines.push(`${name}_bucket${this.addLabel(labelStr, 'le', '+Inf')} ${buckets.le_inf}`);
      lines.push(`${name}_sum${labelStr} ${buckets.sum}`);
      lines.push(`${name}_count${labelStr} ${buckets.count}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Clear all metrics
   */
  clear(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.metrics = [];
  }
  
  // Private methods
  
  private makeKey(name: string, labels: MetricLabels): string {
    const labelParts = Object.entries(labels)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`);
    
    return labelParts.length > 0 
      ? `${name}{${labelParts.join(',')}}` 
      : name;
  }
  
  private parseKey(key: string): { name: string; labels: MetricLabels } {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/);
    if (!match) {
      return { name: key, labels: {} };
    }
    
    const name = match[1]!;
    const labels: MetricLabels = {};
    
    if (match[2]) {
      for (const part of match[2].split(',')) {
        const [k, v] = part.split(':');
        if (k && v) {
          (labels as Record<string, string>)[k] = v;
        }
      }
    }
    
    return { name, labels };
  }
  
  private formatLabels(labels: MetricLabels): string {
    const parts = Object.entries(labels)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}="${v}"`);
    
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
  }
  
  private addLabel(labelStr: string, key: string, value: string): string {
    if (labelStr === '') {
      return `{${key}="${value}"}`;
    }
    return labelStr.replace('}', `,${key}="${value}"}`);
  }
  
  private createEmptyBuckets(): HistogramBuckets {
    return {
      le_10: 0,
      le_50: 0,
      le_100: 0,
      le_250: 0,
      le_500: 0,
      le_1000: 0,
      le_2500: 0,
      le_5000: 0,
      le_inf: 0,
      sum: 0,
      count: 0,
    };
  }
  
  private recordMetric(metric: Metric): void {
    this.metrics.push(metric);
    
    // Trim old metrics if over limit
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics / 2);
    }
  }
}

/**
 * Singleton instance for convenience
 */
export const metrics = new MetricsCollector();
