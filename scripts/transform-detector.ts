#!/usr/bin/env npx ts-node
/**
 * Detector Transformation Script
 * 
 * Transforms hardcoded detectors to learning-based detectors.
 * 
 * Usage: npx ts-node scripts/transform-detector.ts <detector-path>
 * Example: npx ts-node scripts/transform-detector.ts packages/detectors/src/auth/middleware-usage.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface DetectorInfo {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  className: string;
  factoryName: string;
}

function extractDetectorInfo(content: string): DetectorInfo | null {
  const idMatch = content.match(/readonly\s+id\s*=\s*['"`]([^'"`]+)['"`]/);
  const categoryMatch = content.match(/readonly\s+category\s*=\s*['"`]([^'"`]+)['"`]/);
  const subcategoryMatch = content.match(/readonly\s+subcategory\s*=\s*['"`]([^'"`]+)['"`]/);
  const nameMatch = content.match(/readonly\s+name\s*=\s*['"`]([^'"`]+)['"`]/);
  const descMatch = content.match(/readonly\s+description\s*=\s*['"`]([^'"`]+)['"`]/);
  const classMatch = content.match(/export\s+class\s+(\w+Detector)/);
  const factoryMatch = content.match(/export\s+function\s+(create\w+Detector)/);

  if (!idMatch || !categoryMatch || !classMatch) {
    return null;
  }

  return {
    id: idMatch[1],
    category: categoryMatch[1],
    subcategory: subcategoryMatch?.[1] || '',
    name: nameMatch?.[1] || '',
    description: descMatch?.[1] || '',
    className: classMatch[1],
    factoryName: factoryMatch?.[1] || `create${classMatch[1]}`,
  };
}

function identifyConventions(content: string): string[] {
  const conventions: string[] = [];
  
  // Look for hardcoded patterns
  const patterns = [
    { regex: /const\s+\w+_PATTERNS?\s*=\s*\[/g, name: 'patterns' },
    { regex: /const\s+\w+_CONVENTION/g, name: 'convention' },
    { regex: /const\s+ALLOWED_\w+/g, name: 'allowed' },
    { regex: /const\s+VALID_\w+/g, name: 'valid' },
    { regex: /const\s+DEFAULT_\w+/g, name: 'default' },
    { regex: /new\s+Set\s*\(\s*\[/g, name: 'set' },
  ];

  for (const { regex, name } of patterns) {
    if (regex.test(content)) {
      conventions.push(name);
    }
  }

  return conventions;
}

function generateLearningDetector(info: DetectorInfo, originalContent: string): string {
  const conventions = identifyConventions(originalContent);
  
  return `/**
 * ${info.name} - LEARNING VERSION
 *
 * Learns patterns from the user's codebase rather than enforcing hardcoded conventions.
 *
 * @requirements DRIFT-CORE - Learn patterns from user's code, not enforce arbitrary rules
 */

import type { PatternMatch, Violation, QuickFix, Language } from 'driftdetect-core';
import {
  LearningDetector,
  ValueDistribution,
  type DetectionContext,
  type DetectionResult,
  type LearningResult,
} from '../base/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Conventions this detector learns
 */
export interface ${info.className.replace('Detector', '')}Conventions {
  [key: string]: unknown;
  // TODO: Define conventions based on what the detector should learn
  // Example: namingConvention: 'camelCase' | 'snake_case' | 'kebab-case';
}

// ============================================================================
// Helper Functions
// ============================================================================

// TODO: Add helper functions for pattern extraction

// ============================================================================
// Learning Detector
// ============================================================================

export class ${info.className}Learning extends LearningDetector<${info.className.replace('Detector', '')}Conventions> {
  readonly id = '${info.id}';
  readonly category = '${info.category}' as const;
  readonly subcategory = '${info.subcategory}';
  readonly name = '${info.name} (Learning)';
  readonly description = '${info.description}';
  readonly supportedLanguages: Language[] = ['typescript', 'javascript', 'python'];

  protected getConventionKeys(): Array<keyof ${info.className.replace('Detector', '')}Conventions> {
    // TODO: Return the keys of conventions to learn
    return [];
  }

  protected extractConventions(
    context: DetectionContext,
    distributions: Map<keyof ${info.className.replace('Detector', '')}Conventions, ValueDistribution>
  ): void {
    // TODO: Implement convention extraction
    // Parse the file and record what patterns are used
  }

  protected async detectWithConventions(
    context: DetectionContext,
    conventions: LearningResult<${info.className.replace('Detector', '')}Conventions>
  ): Promise<DetectionResult> {
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    // TODO: Implement detection using learned conventions
    // Compare file patterns against learned conventions
    // Create violations for deviations

    return this.createResult(patterns, violations, 1.0);
  }

  override generateQuickFix(_violation: Violation): QuickFix | null {
    return null;
  }
}

export function create${info.className}Learning(): ${info.className}Learning {
  return new ${info.className}Learning();
}
`;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npx ts-node scripts/transform-detector.ts <detector-path>');
    console.log('Example: npx ts-node scripts/transform-detector.ts packages/detectors/src/auth/middleware-usage.ts');
    process.exit(1);
  }

  const detectorPath = args[0];
  const fullPath = path.resolve(process.cwd(), detectorPath);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const info = extractDetectorInfo(content);

  if (!info) {
    console.error('Could not extract detector info from file');
    process.exit(1);
  }

  console.log('Detector Info:');
  console.log(JSON.stringify(info, null, 2));
  console.log('\nConventions found:', identifyConventions(content));

  const learningContent = generateLearningDetector(info, content);
  const outputPath = fullPath.replace('.ts', '-learning.ts');
  
  fs.writeFileSync(outputPath, learningContent);
  console.log(`\nGenerated: ${outputPath}`);
}

main().catch(console.error);
