/**
 * Pattern type definitions
 * 
 * @requirements 4.2
 */

import type { ConfidenceScore, Location } from '../matcher/types.js';
import type { PatternCategory, DetectorConfig } from '../store/types.js';

export interface Pattern {
  /** Unique pattern ID */
  id: string;
  /** Pattern category */
  category: PatternCategory;
  /** Pattern subcategory */
  subcategory: string;
  /** Human-readable name */
  name: string;
  /** Pattern description */
  description: string;
  /** Detector configuration */
  detector: DetectorConfig;
  /** Confidence information */
  confidence: ConfidenceScore;
  /** Locations where pattern is found */
  locations: Location[];
  /** Outlier locations */
  outliers: Location[];
  /** Pattern metadata */
  metadata: PatternMetadata;
}

export interface PatternMetadata {
  /** When first detected */
  firstSeen: Date;
  /** When last seen */
  lastSeen: Date;
  /** When approved (if approved) */
  approvedAt?: Date;
  /** Who approved (if approved) */
  approvedBy?: string;
}
