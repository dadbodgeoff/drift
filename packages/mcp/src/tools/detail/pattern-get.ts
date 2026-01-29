/**
 * drift_pattern_get - Full Pattern Details
 * 
 * Detail tool that returns complete information for a specific pattern.
 * Use pattern ID from drift_patterns_list.
 * 
 * MIGRATION: Now supports both legacy PatternStore and new IPatternService.
 * The service-based approach is preferred for new code.
 */

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

import type { PatternStore, IPatternService } from 'driftdetect-core';

export interface PatternLocation {
  file: string;
  line: number;
  column?: number;
}

export interface PatternOutlier {
  file: string;
  line: number;
  reason: string;
}

export interface PatternGetData {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  status: string;
  confidence: {
    score: number;
    level: string;
  };
  locations: PatternLocation[];
  outliers: PatternOutlier[];
  locationCount: number;
  outlierCount: number;
}

export interface PatternGetArgs {
  id: string;
  includeLocations?: boolean;
  includeOutliers?: boolean;
  maxLocations?: number;
}

const DEFAULT_MAX_LOCATIONS = 20;

/**
 * Handle pattern get using IPatternService (preferred)
 */
export async function handlePatternGetWithService(
  service: IPatternService,
  args: PatternGetArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<PatternGetData>();
  
  if (!args.id) {
    throw Errors.missingParameter('id');
  }
  
  const pattern = await service.getPattern(args.id);
  
  if (!pattern) {
    throw Errors.notFound('pattern', args.id);
  }
  
  const includeLocations = args.includeLocations !== false;
  const includeOutliers = args.includeOutliers !== false;
  const maxLocations = args.maxLocations ?? DEFAULT_MAX_LOCATIONS;
  
  // Map locations
  let locations: PatternLocation[] = [];
  if (includeLocations) {
    locations = pattern.locations
      .slice(0, maxLocations)
      .map(loc => ({
        file: loc.file,
        line: loc.line,
        column: loc.column,
      }));
  }
  
  // Map outliers
  let outliers: PatternOutlier[] = [];
  if (includeOutliers) {
    outliers = pattern.outliers.map(out => ({
      file: out.file,
      line: out.line,
      reason: out.reason ?? 'Unknown reason',
    }));
  }
  
  const data: PatternGetData = {
    id: pattern.id,
    name: pattern.name,
    description: pattern.description,
    category: pattern.category,
    subcategory: pattern.subcategory,
    status: pattern.status,
    confidence: {
      score: Math.round(pattern.confidence * 100) / 100,
      level: pattern.confidenceLevel,
    },
    locations,
    outliers,
    locationCount: pattern.locations.length,
    outlierCount: pattern.outliers.length,
  };
  
  // Build summary
  let summary = `${pattern.name} (${pattern.category}/${pattern.subcategory}). `;
  summary += `Confidence: ${Math.round(pattern.confidence * 100)}% (${pattern.confidenceLevel}). `;
  summary += `${pattern.locations.length} locations`;
  if (pattern.outliers.length > 0) {
    summary += `, ${pattern.outliers.length} outliers`;
  }
  summary += '.';
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      'Use drift_code_examples to see implementations',
      pattern.outliers.length > 0 
        ? 'Review outliers to understand deviations'
        : 'Use drift_patterns_list to explore more patterns',
    ],
    relatedTools: ['drift_code_examples', 'drift_patterns_list'],
  };
  
  if (pattern.outliers.length > 5) {
    hints.warnings = [`High outlier count (${pattern.outliers.length}) may indicate pattern drift`];
  } else if (pattern.confidence < 0.7) {
    hints.warnings = ['Low confidence - pattern may need review'];
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

/**
 * Handle pattern get using legacy PatternStore (backward compatibility)
 * @deprecated Use handlePatternGetWithService instead
 */
export async function handlePatternGet(
  store: PatternStore,
  args: PatternGetArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<PatternGetData>();
  
  if (!args.id) {
    throw Errors.missingParameter('id');
  }
  
  await store.initialize();
  
  const pattern = store.get(args.id);
  
  if (!pattern) {
    throw Errors.notFound('pattern', args.id);
  }
  
  const includeLocations = args.includeLocations !== false;
  const includeOutliers = args.includeOutliers !== false;
  const maxLocations = args.maxLocations ?? DEFAULT_MAX_LOCATIONS;
  
  // Map locations
  let locations: PatternLocation[] = [];
  if (includeLocations) {
    locations = pattern.locations
      .slice(0, maxLocations)
      .map(loc => ({
        file: loc.file,
        line: loc.line,
        column: loc.column,
      }));
  }
  
  // Map outliers
  let outliers: PatternOutlier[] = [];
  if (includeOutliers) {
    outliers = pattern.outliers.map(out => ({
      file: out.file,
      line: out.line,
      reason: out.reason,
    }));
  }
  
  const data: PatternGetData = {
    id: pattern.id,
    name: pattern.name,
    description: pattern.description,
    category: pattern.category,
    subcategory: pattern.subcategory,
    status: pattern.status,
    confidence: {
      score: Math.round(pattern.confidence.score * 100) / 100,
      level: pattern.confidence.level,
    },
    locations,
    outliers,
    locationCount: pattern.locations.length,
    outlierCount: pattern.outliers.length,
  };
  
  // Build summary
  let summary = `${pattern.name} (${pattern.category}/${pattern.subcategory}). `;
  summary += `Confidence: ${Math.round(pattern.confidence.score * 100)}% (${pattern.confidence.level}). `;
  summary += `${pattern.locations.length} locations`;
  if (pattern.outliers.length > 0) {
    summary += `, ${pattern.outliers.length} outliers`;
  }
  summary += '.';
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: [
      'Use drift_code_examples to see implementations',
      pattern.outliers.length > 0 
        ? 'Review outliers to understand deviations'
        : 'Use drift_patterns_list to explore more patterns',
    ],
    relatedTools: ['drift_code_examples', 'drift_patterns_list'],
  };
  
  if (pattern.outliers.length > 5) {
    hints.warnings = [`High outlier count (${pattern.outliers.length}) may indicate pattern drift`];
  } else if (pattern.confidence.score < 0.7) {
    hints.warnings = ['Low confidence - pattern may need review'];
  }
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}
