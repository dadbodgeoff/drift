/**
 * drift_patterns_list - Pattern Listing
 * 
 * Exploration tool that lists patterns with summaries.
 * Returns pattern IDs for use with drift_pattern_get.
 * 
 * OPTIMIZED: Uses data lake pattern shards for category-specific queries,
 * and pattern index view for full listings.
 * 
 * MIGRATION: Now supports both legacy PatternStore and new IPatternService.
 * The service-based approach is preferred for new code.
 */

import { 
  createResponseBuilder, 
  cursorManager,
  Errors,
  type PaginationInfo,
} from '../../infrastructure/index.js';

import type { 
  PatternStore, 
  PatternCategory, 
  DataLake,
  IPatternService,
} from 'driftdetect-core';

export interface PatternSummary {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  confidence: number;
  confidenceLevel: string;
  status: string;
  locationCount: number;
  outlierCount: number;
}

export interface PatternsListData {
  patterns: PatternSummary[];
  /** Response source for debugging */
  _source?: 'lake' | 'store' | 'service';
}

const VALID_CATEGORIES: PatternCategory[] = [
  'api', 'auth', 'security', 'errors', 'logging',
  'data-access', 'config', 'testing', 'performance',
  'components', 'styling', 'structural', 'types',
  'accessibility', 'documentation',
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface PatternsListArgs {
  categories?: string[];
  status?: string;
  minConfidence?: number;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Handle patterns list using IPatternService (preferred)
 */
export async function handlePatternsListWithService(
  service: IPatternService,
  args: PatternsListArgs,
  dataLake?: DataLake
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<PatternsListData>();
  
  // Validate categories
  if (args.categories) {
    for (const cat of args.categories) {
      if (!VALID_CATEGORIES.includes(cat as PatternCategory)) {
        throw Errors.invalidCategory(cat, VALID_CATEGORIES);
      }
    }
  }
  
  // Parse cursor if provided
  let startOffset = 0;
  if (args.cursor) {
    const cursorData = cursorManager.decode(args.cursor);
    if (!cursorData) {
      throw Errors.invalidCursor();
    }
    startOffset = cursorData.offset ?? 0;
  }

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // OPTIMIZATION: Try data lake first
  if (dataLake) {
    const lakeResult = await tryGetPatternsFromLake(dataLake, args, startOffset, limit);
    if (lakeResult) {
      return buildResponse(builder, lakeResult, args, startOffset, limit, 'lake');
    }
  }
  
  // Use the pattern service
  const result = await service.query({
    filter: {
      categories: args.categories as PatternCategory[] | undefined,
      statuses: args.status && args.status !== 'all' 
        ? [args.status as 'discovered' | 'approved' | 'ignored'] 
        : undefined,
      minConfidence: args.minConfidence,
      search: args.search,
    },
    sort: {
      field: 'confidence',
      direction: 'desc',
    },
    pagination: {
      offset: startOffset,
      limit,
    },
  });
  
  // Map to summaries
  const summaries: PatternSummary[] = result.patterns.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    confidence: Math.round(p.confidence * 100) / 100,
    confidenceLevel: p.confidenceLevel,
    status: p.status,
    locationCount: p.locations.length,
    outlierCount: p.outliers.length,
  }));
  
  return buildResponse(
    builder, 
    { summaries, totalCount: result.total }, 
    args, 
    startOffset, 
    limit, 
    'service'
  );
}

/**
 * Handle patterns list using legacy PatternStore (backward compatibility)
 * @deprecated Use handlePatternsListWithService instead
 */
export async function handlePatternsList(
  store: PatternStore,
  args: PatternsListArgs,
  dataLake?: DataLake
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<PatternsListData>();
  
  // Validate categories
  if (args.categories) {
    for (const cat of args.categories) {
      if (!VALID_CATEGORIES.includes(cat as PatternCategory)) {
        throw Errors.invalidCategory(cat, VALID_CATEGORIES);
      }
    }
  }
  
  // Parse cursor if provided
  let startOffset = 0;
  if (args.cursor) {
    const cursorData = cursorManager.decode(args.cursor);
    if (!cursorData) {
      throw Errors.invalidCursor();
    }
    startOffset = cursorData.offset ?? 0;
  }

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // OPTIMIZATION: Try data lake first
  if (dataLake) {
    const lakeResult = await tryGetPatternsFromLake(dataLake, args, startOffset, limit);
    if (lakeResult) {
      return buildResponse(builder, lakeResult, args, startOffset, limit, 'lake');
    }
  }
  
  // Fallback: Use pattern store directly
  await store.initialize();
  let patterns = store.getAll();
  
  // Filter by categories
  if (args.categories && args.categories.length > 0) {
    const cats = new Set(args.categories);
    patterns = patterns.filter(p => cats.has(p.category));
  }
  
  // Filter by status
  if (args.status && args.status !== 'all') {
    patterns = patterns.filter(p => p.status === args.status);
  }
  
  // Filter by confidence
  if (args.minConfidence !== undefined) {
    patterns = patterns.filter(p => p.confidence.score >= args.minConfidence!);
  }
  
  // Filter by search
  if (args.search) {
    const searchLower = args.search.toLowerCase();
    patterns = patterns.filter(p => 
      p.name.toLowerCase().includes(searchLower) ||
      p.description.toLowerCase().includes(searchLower) ||
      p.subcategory.toLowerCase().includes(searchLower)
    );
  }
  
  // Sort by confidence (highest first)
  patterns.sort((a, b) => b.confidence.score - a.confidence.score);
  
  const totalCount = patterns.length;
  
  // Apply pagination
  const paginatedPatterns = patterns.slice(startOffset, startOffset + limit);
  
  // Map to summaries
  const summaries: PatternSummary[] = paginatedPatterns.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    confidence: Math.round(p.confidence.score * 100) / 100,
    confidenceLevel: p.confidence.level,
    status: p.status,
    locationCount: p.locations.length,
    outlierCount: p.outliers.length,
  }));
  
  return buildResponse(builder, { summaries, totalCount }, args, startOffset, limit, 'store');
}

/**
 * Try to get patterns from data lake (optimized path)
 */
async function tryGetPatternsFromLake(
  dataLake: DataLake,
  args: {
    categories?: string[];
    status?: string;
    minConfidence?: number;
    search?: string;
  },
  offset: number,
  limit: number
): Promise<{ summaries: PatternSummary[]; totalCount: number } | null> {
  try {
    await dataLake.initialize();
    
    // Build query options, only including defined properties
    // (exactOptionalPropertyTypes requires this approach)
    const queryOptions: Parameters<typeof dataLake.query.getPatterns>[0] = {
      offset,
      limit,
    };
    
    if (args.categories?.length) {
      queryOptions.categories = args.categories as PatternCategory[];
    }
    if (args.status && args.status !== 'all') {
      queryOptions.status = args.status as 'discovered' | 'approved' | 'ignored';
    }
    if (args.minConfidence !== undefined) {
      queryOptions.minConfidence = args.minConfidence;
    }
    if (args.search) {
      queryOptions.search = args.search;
    }
    
    const result = await dataLake.query.getPatterns(queryOptions);
    
    if (result.items.length === 0 && result.total === 0) {
      return null; // No data in lake, fall back to store
    }
    
    const summaries: PatternSummary[] = result.items.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      confidence: Math.round(p.confidence * 100) / 100,
      confidenceLevel: p.confidenceLevel,
      status: p.status,
      locationCount: p.locationCount,
      outlierCount: p.outlierCount,
    }));
    
    return { summaries, totalCount: result.total };
  } catch {
    return null;
  }
}

/**
 * Build the response
 */
function buildResponse(
  builder: ReturnType<typeof createResponseBuilder<PatternsListData>>,
  data: { summaries: PatternSummary[]; totalCount: number },
  args: {
    categories?: string[];
    status?: string;
  },
  startOffset: number,
  limit: number,
  source: 'lake' | 'store' | 'service'
): { content: Array<{ type: string; text: string }> } {
  const { summaries, totalCount } = data;
  
  // Build pagination info
  const hasMore = startOffset + limit < totalCount;
  const pagination: PaginationInfo = {
    hasMore,
    totalCount,
    pageSize: limit,
    cursor: hasMore 
      ? cursorManager.createOffsetCursor(startOffset + limit, args)
      : undefined,
  };
  
  // Build summary
  let summary = `Found ${totalCount} patterns`;
  if (args.categories?.length) {
    summary += ` in ${args.categories.join(', ')}`;
  }
  if (args.status && args.status !== 'all') {
    summary += ` (${args.status})`;
  }
  summary += `. Showing ${summaries.length}.`;
  
  return builder
    .withSummary(summary)
    .withData({ patterns: summaries, _source: source })
    .withPagination(pagination)
    .withHints({
      nextActions: summaries.length > 0 
        ? [
            `Use drift_pattern_get with id="${summaries[0]?.id}" for full details`,
            'Use drift_code_examples with categories to see implementations',
          ]
        : ['Try different filters or run drift scan to discover patterns'],
      relatedTools: ['drift_pattern_get', 'drift_code_examples', 'drift_file_patterns'],
    })
    .buildContent();
}
