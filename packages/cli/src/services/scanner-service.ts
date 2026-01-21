/**
 * Scanner Service - Enterprise-grade pattern detection
 *
 * Uses the real detectors from driftdetect-detectors to find
 * high-value architectural patterns and violations.
 *
 * Now includes manifest generation for pattern location discovery.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createAllDetectorsArray,
  getDetectorCounts,
  type BaseDetector,
  type DetectionContext,
} from 'driftdetect-detectors';
import {
  type Language,
  ManifestStore,
  hashContent,
  type SemanticLocation,
  type SemanticType,
  type ManifestPattern,
  type Manifest,
} from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

/**
 * Project-wide context for detection
 */
export interface ProjectContext {
  rootDir: string;
  files: string[];
  config: Record<string, unknown>;
}

/**
 * Scanner service configuration
 */
export interface ScannerServiceConfig {
  rootDir: string;
  verbose?: boolean;
  categories?: string[];
  /** Only run critical/high-value detectors */
  criticalOnly?: boolean;
  /** Enable manifest generation */
  generateManifest?: boolean;
  /** Only scan changed files (incremental) */
  incremental?: boolean;
}

/**
 * Aggregated pattern match across files
 */
export interface AggregatedPattern {
  patternId: string;
  detectorId: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  locations: Array<{
    file: string;
    line: number;
    column: number;
  }>;
  confidence: number;
  occurrences: number;
}

/**
 * Aggregated violation across files
 */
export interface AggregatedViolation {
  patternId: string;
  detectorId: string;
  category: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  file: string;
  line: number;
  column: number;
  message: string;
  explanation?: string | undefined;
  suggestedFix?: string | undefined;
}

/**
 * Scan result for a single file
 */
export interface FileScanResult {
  file: string;
  patterns: Array<{
    patternId: string;
    detectorId: string;
    confidence: number;
    location: { file: string; line: number; column: number };
  }>;
  violations: AggregatedViolation[];
  duration: number;
  error?: string;
}

/**
 * Overall scan results
 */
export interface ScanResults {
  files: FileScanResult[];
  patterns: AggregatedPattern[];
  violations: AggregatedViolation[];
  totalPatterns: number;
  totalViolations: number;
  totalFiles: number;
  duration: number;
  errors: string[];
  detectorStats: {
    total: number;
    ran: number;
    skipped: number;
  };
  /** Manifest with semantic locations (if generateManifest is true) */
  manifest?: Manifest;
}

// ============================================================================
// Language Detection
// ============================================================================

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyw: 'python',
  cs: 'csharp',
  java: 'java',
  php: 'php',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
};

function getLanguage(filePath: string): Language | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

function isDetectorApplicable(detector: BaseDetector, language: Language | null): boolean {
  if (!language) return false;
  const info = detector.getInfo();
  return info.supportedLanguages.includes(language);
}

// ============================================================================
// Critical Detectors (highest value)
// ============================================================================

const CRITICAL_DETECTOR_IDS = new Set([
  // Security - CRITICAL
  'security/sql-injection',
  'security/xss-prevention',
  'security/secret-management',
  'security/input-sanitization',
  'security/csrf-protection',
  
  // Auth - CRITICAL
  'auth/middleware-usage',
  'auth/token-handling',
  
  // API - HIGH
  'api/route-structure',
  'api/error-format',
  'api/response-envelope',
  
  // Data Access - HIGH
  'data-access/n-plus-one',
  'data-access/query-patterns',
  
  // Structural - HIGH
  'structural/circular-deps',
  'structural/module-boundaries',
  
  // Errors - HIGH
  'errors/exception-hierarchy',
  'errors/try-catch-placement',
  
  // Logging - HIGH
  'logging/pii-redaction',
]);

// ============================================================================
// Scanner Service
// ============================================================================

/**
 * Scanner Service
 *
 * Orchestrates pattern detection across files using real detectors
 * from driftdetect-detectors package.
 */
export class ScannerService {
  private config: ScannerServiceConfig;
  private detectors: BaseDetector[] = [];
  private initialized = false;
  private manifestStore: ManifestStore | null = null;

  constructor(config: ScannerServiceConfig) {
    this.config = config;
    if (config.generateManifest) {
      this.manifestStore = new ManifestStore(config.rootDir);
    }
  }

  /**
   * Initialize the scanner service - loads all detectors
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create all detectors
    this.detectors = await createAllDetectorsArray();

    // Filter by category if specified
    if (this.config.categories && this.config.categories.length > 0) {
      const categories = new Set(this.config.categories);
      this.detectors = this.detectors.filter(d => {
        const info = d.getInfo();
        return categories.has(info.category);
      });
    }

    // Filter to critical only if specified
    if (this.config.criticalOnly) {
      this.detectors = this.detectors.filter(d => CRITICAL_DETECTOR_IDS.has(d.id));
    }

    // Load existing manifest for incremental scanning
    if (this.manifestStore) {
      await this.manifestStore.load();
    }

    this.initialized = true;
  }

  /**
   * Get detector count
   */
  getDetectorCount(): number {
    return this.detectors.length;
  }

  /**
   * Get detector counts by category
   */
  getDetectorCounts() {
    return getDetectorCounts();
  }

  /**
   * Scan files for patterns using real detectors
   */
  async scanFiles(files: string[], projectContext: ProjectContext): Promise<ScanResults> {
    const startTime = Date.now();
    const fileResults: FileScanResult[] = [];
    const errors: string[] = [];
    
    // Aggregation maps
    const patternMap = new Map<string, AggregatedPattern>();
    const allViolations: AggregatedViolation[] = [];
    
    // Manifest pattern aggregation
    const manifestPatternMap = new Map<string, ManifestPattern>();
    
    let detectorsRan = 0;
    let detectorsSkipped = 0;

    // Filter to changed files if incremental
    let filesToScan = files;
    if (this.config.incremental && this.manifestStore) {
      const fullPaths = files.map(f => path.join(this.config.rootDir, f));
      const changedPaths = await this.manifestStore.getChangedFiles(fullPaths);
      filesToScan = changedPaths.map(f => path.relative(this.config.rootDir, f));
      
      // Clear patterns for changed files
      for (const file of filesToScan) {
        this.manifestStore.clearFilePatterns(path.join(this.config.rootDir, file));
      }
    }

    for (const file of filesToScan) {
      const fileStart = Date.now();
      const filePath = path.join(this.config.rootDir, file);
      const language = getLanguage(file);

      // Skip files we can't detect language for
      if (!language) {
        fileResults.push({
          file,
          patterns: [],
          violations: [],
          duration: Date.now() - fileStart,
        });
        continue;
      }

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const contentHash = hashContent(content);
        const filePatterns: FileScanResult['patterns'] = [];
        const fileViolations: AggregatedViolation[] = [];

        // Create detection context
        const context: DetectionContext = {
          file,
          content,
          language,
          ast: null, // AST parsing is optional
          imports: [], // Will be populated by detectors that need it
          exports: [], // Will be populated by detectors that need it
          extension: path.extname(file),
          isTestFile: /\.(test|spec)\.[jt]sx?$/.test(file) || file.includes('__tests__'),
          isTypeDefinition: file.endsWith('.d.ts'),
          projectContext: {
            rootDir: projectContext.rootDir,
            files: projectContext.files,
            config: projectContext.config,
          },
        };

        // Run applicable detectors
        for (const detector of this.detectors) {
          if (!isDetectorApplicable(detector, language)) {
            detectorsSkipped++;
            continue;
          }

          detectorsRan++;
          
          try {
            const result = await detector.detect(context);
            const info = detector.getInfo();

            // Process patterns
            for (const match of result.patterns) {
              filePatterns.push({
                patternId: match.patternId,
                detectorId: detector.id,
                confidence: match.confidence,
                location: match.location,
              });

              // Aggregate pattern
              const key = match.patternId;
              const existing = patternMap.get(key);
              if (existing) {
                existing.locations.push(match.location);
                existing.occurrences++;
                existing.confidence = Math.max(existing.confidence, match.confidence);
              } else {
                patternMap.set(key, {
                  patternId: match.patternId,
                  detectorId: detector.id,
                  category: info.category,
                  subcategory: info.subcategory,
                  name: info.name,
                  description: info.description,
                  locations: [match.location],
                  confidence: match.confidence,
                  occurrences: 1,
                });
              }

              // Build manifest pattern with semantic location
              if (this.config.generateManifest) {
                const semanticLoc = this.createSemanticLocation(
                  match.location,
                  content,
                  contentHash,
                  language
                );
                
                const manifestKey = `${info.category}/${info.subcategory}/${match.patternId}`;
                const existingManifest = manifestPatternMap.get(manifestKey);
                
                if (existingManifest) {
                  existingManifest.locations.push(semanticLoc);
                  existingManifest.confidence = Math.max(existingManifest.confidence, match.confidence);
                  existingManifest.lastSeen = new Date().toISOString();
                } else {
                  manifestPatternMap.set(manifestKey, {
                    id: manifestKey,
                    name: info.name,
                    category: info.category as any,
                    subcategory: info.subcategory,
                    status: 'discovered',
                    confidence: match.confidence,
                    locations: [semanticLoc],
                    outliers: [],
                    description: info.description,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                  });
                }
              }
            }

            // Process violations
            // First check the standard violations array
            let violationsToProcess = result.violations;
            
            // If empty, check for violations in custom metadata (many detectors store them there)
            if (violationsToProcess.length === 0 && result.metadata?.custom) {
              const customData = result.metadata.custom as Record<string, unknown>;
              const customViolations = customData['violations'] as Array<{
                type?: string;
                file: string;
                line: number;
                column: number;
                endLine?: number;
                endColumn?: number;
                value?: string;
                issue?: string;
                message?: string;
                suggestedFix?: string;
                severity?: string;
              }> | undefined;
              
              if (customViolations && Array.isArray(customViolations)) {
                // Convert custom violations to standard format
                violationsToProcess = customViolations.map(cv => {
                  const violation: typeof result.violations[0] = {
                    id: `${detector.id}-${cv.file}-${cv.line}-${cv.column}`,
                    patternId: detector.id,
                    severity: (cv.severity as 'error' | 'warning' | 'info' | 'hint') || 'warning',
                    file: cv.file,
                    range: {
                      start: { line: cv.line - 1, character: cv.column - 1 },
                      end: { line: (cv.endLine || cv.line) - 1, character: (cv.endColumn || cv.column) - 1 },
                    },
                    message: cv.issue || cv.message || cv.type || 'Pattern violation detected',
                    expected: cv.suggestedFix || 'Follow established patterns',
                    actual: cv.value || 'Non-conforming code',
                    aiExplainAvailable: true,
                    aiFixAvailable: !!cv.suggestedFix,
                    firstSeen: new Date(),
                    occurrences: 1,
                  };
                  if (cv.type) {
                    violation.explanation = `Violation type: ${cv.type}`;
                  }
                  return violation;
                });
              }
            }
            
            for (const violation of violationsToProcess) {
              const aggViolation: AggregatedViolation = {
                patternId: violation.patternId,
                detectorId: detector.id,
                category: info.category,
                severity: violation.severity,
                file: violation.file,
                line: violation.range.start.line + 1,
                column: violation.range.start.character + 1,
                message: violation.message,
                explanation: violation.explanation,
                suggestedFix: violation.expected,
              };
              fileViolations.push(aggViolation);
              allViolations.push(aggViolation);

              // Add violation as outlier to manifest
              if (this.config.generateManifest) {
                const outlierLoc = this.createSemanticLocation(
                  {
                    file: violation.file,
                    line: violation.range.start.line + 1,
                    column: violation.range.start.character + 1,
                  },
                  content,
                  contentHash,
                  language,
                  violation.message
                );

                const manifestKey = `${info.category}/${info.subcategory}/${violation.patternId}`;
                const existingManifest = manifestPatternMap.get(manifestKey);
                
                if (existingManifest) {
                  existingManifest.outliers.push(outlierLoc);
                } else {
                  manifestPatternMap.set(manifestKey, {
                    id: manifestKey,
                    name: info.name,
                    category: info.category as any,
                    subcategory: info.subcategory,
                    status: 'discovered',
                    confidence: 0.5,
                    locations: [],
                    outliers: [outlierLoc],
                    description: info.description,
                    firstSeen: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                  });
                }
              }
            }
          } catch (detectorError) {
            if (this.config.verbose) {
              errors.push(`Detector ${detector.id} failed on ${file}: ${(detectorError as Error).message}`);
            }
          }
        }

        fileResults.push({
          file,
          patterns: filePatterns,
          violations: fileViolations,
          duration: Date.now() - fileStart,
        });

      } catch (e) {
        const error = `Failed to scan ${file}: ${e instanceof Error ? e.message : e}`;
        errors.push(error);
        fileResults.push({
          file,
          patterns: [],
          violations: [],
          duration: Date.now() - fileStart,
          error,
        });
      }
    }

    // Convert pattern map to array
    const patterns = Array.from(patternMap.values());

    // Build and save manifest
    let manifest: Manifest | undefined;
    if (this.config.generateManifest && this.manifestStore) {
      const manifestPatterns = Array.from(manifestPatternMap.values());
      this.manifestStore.updatePatterns(manifestPatterns);
      await this.manifestStore.save();
      manifest = await this.manifestStore.get();
    }

    const result: ScanResults = {
      files: fileResults,
      patterns,
      violations: allViolations,
      totalPatterns: patterns.reduce((sum, p) => sum + p.occurrences, 0),
      totalViolations: allViolations.length,
      totalFiles: files.length,
      duration: Date.now() - startTime,
      errors,
      detectorStats: {
        total: this.detectors.length,
        ran: detectorsRan,
        skipped: detectorsSkipped,
      },
    };
    
    if (manifest) {
      result.manifest = manifest;
    }

    return result;
  }

  /**
   * Create a semantic location from a basic location
   */
  private createSemanticLocation(
    location: { file: string; line: number; column: number },
    content: string,
    hash: string,
    language: Language,
    name?: string
  ): SemanticLocation {
    const lines = content.split('\n');
    const lineContent = lines[location.line - 1] || '';
    
    // Try to extract semantic info from the line
    const semanticInfo = this.extractSemanticInfo(lineContent, language);
    
    const result: SemanticLocation = {
      file: location.file,
      hash,
      range: {
        start: location.line,
        end: location.line,
      },
      type: semanticInfo.type,
      name: name || semanticInfo.name || `line-${location.line}`,
      confidence: 0.9,
      snippet: lineContent.trim().substring(0, 100),
      language,
    };
    
    if (semanticInfo.signature) {
      result.signature = semanticInfo.signature;
    }
    
    return result;
  }

  /**
   * Extract semantic information from a line of code
   */
  private extractSemanticInfo(line: string, language: Language): {
    type: SemanticType;
    name?: string;
    signature?: string;
  } {
    const trimmed = line.trim();

    // TypeScript/JavaScript patterns
    if (language === 'typescript' || language === 'javascript') {
      // Class
      const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
      if (classMatch && classMatch[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Function
      const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch && funcMatch[1]) {
        return { type: 'function', name: funcMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Arrow function / const
      const arrowMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=/);
      if (arrowMatch && arrowMatch[1]) {
        return { type: 'function', name: arrowMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Interface
      const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch && interfaceMatch[1]) {
        return { type: 'interface', name: interfaceMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Type
      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)/);
      if (typeMatch && typeMatch[1]) {
        return { type: 'type', name: typeMatch[1], signature: trimmed.substring(0, 80) };
      }
    }

    // Python patterns
    if (language === 'python') {
      // Class
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch && classMatch[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Function/method
      const defMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)/);
      if (defMatch && defMatch[1]) {
        return { type: 'function', name: defMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Decorator
      const decoratorMatch = trimmed.match(/^@(\w+)/);
      if (decoratorMatch && decoratorMatch[1]) {
        return { type: 'decorator', name: decoratorMatch[1], signature: trimmed };
      }
    }

    // PHP patterns
    if (language === 'php') {
      // Class
      const classMatch = trimmed.match(/^(?:abstract\s+|final\s+)?class\s+(\w+)/);
      if (classMatch && classMatch[1]) {
        return { type: 'class', name: classMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Interface
      const interfaceMatch = trimmed.match(/^interface\s+(\w+)/);
      if (interfaceMatch && interfaceMatch[1]) {
        return { type: 'interface', name: interfaceMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Trait
      const traitMatch = trimmed.match(/^trait\s+(\w+)/);
      if (traitMatch && traitMatch[1]) {
        return { type: 'class', name: traitMatch[1], signature: trimmed.substring(0, 80) };
      }

      // Function/method
      const funcMatch = trimmed.match(/^(?:public|protected|private)?\s*(?:static\s+)?function\s+(\w+)/);
      if (funcMatch && funcMatch[1]) {
        return { type: 'function', name: funcMatch[1], signature: trimmed.substring(0, 80) };
      }

      // PHP 8 Attribute
      const attrMatch = trimmed.match(/^#\[(\w+)/);
      if (attrMatch && attrMatch[1]) {
        return { type: 'decorator', name: attrMatch[1], signature: trimmed };
      }
    }

    // Default to block
    return { type: 'block' };
  }

  /**
   * Get the manifest store (for external access)
   */
  getManifestStore(): ManifestStore | null {
    return this.manifestStore;
  }
}

/**
 * Create a scanner service
 */
export function createScannerService(config: ScannerServiceConfig): ScannerService {
  return new ScannerService(config);
}
