/**
 * Primitive Discovery
 *
 * Discovers framework primitives from imports, decorators, and usage patterns.
 */

import type {
  DetectedPrimitive,
  PrimitiveSource,
  SupportedLanguage,
  FrameworkDetectionResult,
} from '../types.js';
import {
  ALL_PRIMITIVES,
  findPrimitiveFramework,
  looksLikePrimitive,
  getPrimitiveNames,
} from './registry.js';

// =============================================================================
// Types
// =============================================================================

export interface ImportInfo {
  source: string;
  imported: string[];
  isDefault?: boolean;
  isNamespace?: boolean;
}

export interface DecoratorUsage {
  name: string;
  functionName: string;
  file: string;
  line: number;
  arguments?: string[];
}

export interface FunctionUsage {
  name: string;
  calledFrom: string[];
  callCount: number;
}

export interface DiscoveryContext {
  language: SupportedLanguage;
  imports: ImportInfo[];
  decorators: DecoratorUsage[];
  functionUsages: FunctionUsage[];
  packageJson?: Record<string, unknown>;
}

// =============================================================================
// Framework Detection
// =============================================================================

const FRAMEWORK_PACKAGE_MAP: Record<string, string[]> = {
  // TypeScript/JavaScript
  react: ['react', 'react-dom'],
  'tanstack-query': ['@tanstack/react-query', 'react-query'],
  swr: ['swr'],
  apollo: ['@apollo/client', 'apollo-client'],
  urql: ['urql', '@urql/core'],
  redux: ['react-redux', 'redux', '@reduxjs/toolkit'],
  zustand: ['zustand'],
  jotai: ['jotai'],
  recoil: ['recoil'],
  'react-hook-form': ['react-hook-form'],
  formik: ['formik'],
  'react-router': ['react-router', 'react-router-dom'],
  next: ['next'],
  vue: ['vue'],
  'vue-router': ['vue-router'],
  pinia: ['pinia'],
  svelte: ['svelte'],
  angular: ['@angular/core'],
  express: ['express'],
  jest: ['jest', '@jest/globals'],
  vitest: ['vitest'],
  '@testing-library/react': ['@testing-library/react'],

  // Python (detected via imports)
  fastapi: ['fastapi'],
  django: ['django'],
  flask: ['flask'],
  sqlalchemy: ['sqlalchemy'],
  celery: ['celery'],
  pydantic: ['pydantic'],
  pytest: ['pytest'],

  // Java (detected via imports/annotations)
  spring: ['org.springframework'],
  'spring-boot': ['org.springframework.boot'],
  junit5: ['org.junit.jupiter'],
  mockito: ['org.mockito'],

  // C# (detected via using statements)
  aspnet: ['Microsoft.AspNetCore'],
  efcore: ['Microsoft.EntityFrameworkCore'],
  xunit: ['Xunit'],
  nunit: ['NUnit'],
  moq: ['Moq'],

  // PHP (detected via use statements)
  laravel: ['Illuminate'],
  symfony: ['Symfony'],
  phpunit: ['PHPUnit'],
  pest: ['Pest'],
};


/**
 * Detect which frameworks are used in the codebase
 */
export function detectFrameworks(context: DiscoveryContext): FrameworkDetectionResult[] {
  const results: FrameworkDetectionResult[] = [];
  const seen = new Set<string>();

  // 1. Check package.json dependencies (highest confidence for JS/TS)
  if (context.packageJson && context.language === 'typescript') {
    const deps = {
      ...(context.packageJson.dependencies as Record<string, string> || {}),
      ...(context.packageJson.devDependencies as Record<string, string> || {}),
    };

    for (const [framework, packages] of Object.entries(FRAMEWORK_PACKAGE_MAP)) {
      for (const pkg of packages) {
        if (deps[pkg] && !seen.has(framework)) {
          seen.add(framework);
          results.push({
            framework,
            version: deps[pkg],
            confidence: 1.0,
            detectedVia: 'package.json',
          });
        }
      }
    }
  }

  // 2. Check imports
  for (const imp of context.imports) {
    for (const [framework, packages] of Object.entries(FRAMEWORK_PACKAGE_MAP)) {
      if (seen.has(framework)) continue;

      const matches = packages.some(
        (pkg) => imp.source === pkg || imp.source.startsWith(`${pkg}/`)
      );

      if (matches) {
        seen.add(framework);
        results.push({
          framework,
          confidence: 0.9,
          detectedVia: 'import',
        });
      }
    }
  }

  // 3. Check decorators (for Python, Java, C#, PHP)
  if (context.language !== 'typescript') {
    const decoratorFrameworks = inferFrameworksFromDecorators(context.decorators, context.language);
    for (const fw of decoratorFrameworks) {
      if (!seen.has(fw.framework)) {
        seen.add(fw.framework);
        results.push(fw);
      }
    }
  }

  return results;
}

/**
 * Infer frameworks from decorator usage
 */
function inferFrameworksFromDecorators(
  decorators: DecoratorUsage[],
  language: SupportedLanguage
): FrameworkDetectionResult[] {
  const results: FrameworkDetectionResult[] = [];
  const decoratorNames = new Set(decorators.map((d) => d.name));

  // Spring decorators
  if (language === 'java') {
    const springDecorators = ['@Autowired', '@Component', '@Service', '@Repository', '@Controller', '@RestController'];
    if (springDecorators.some((d) => decoratorNames.has(d))) {
      results.push({ framework: 'spring', confidence: 0.95, detectedVia: 'decorator' });
    }

    const springBootDecorators = ['@SpringBootApplication', '@EnableAutoConfiguration'];
    if (springBootDecorators.some((d) => decoratorNames.has(d))) {
      results.push({ framework: 'spring-boot', confidence: 0.95, detectedVia: 'decorator' });
    }
  }

  // Python decorators
  if (language === 'python') {
    if (decoratorNames.has('fixture') || decoratorNames.has('pytest.fixture')) {
      results.push({ framework: 'pytest', confidence: 0.9, detectedVia: 'decorator' });
    }
    if (decoratorNames.has('login_required') || decoratorNames.has('permission_required')) {
      results.push({ framework: 'django', confidence: 0.85, detectedVia: 'decorator' });
    }
  }

  // C# attributes
  if (language === 'csharp') {
    const aspnetAttrs = ['[HttpGet]', '[HttpPost]', '[ApiController]', '[Authorize]'];
    if (aspnetAttrs.some((a) => decoratorNames.has(a))) {
      results.push({ framework: 'aspnet', confidence: 0.95, detectedVia: 'decorator' });
    }
  }

  // PHP attributes
  if (language === 'php') {
    if (decoratorNames.has('#[Route]') || decoratorNames.has('#[Autowire]')) {
      results.push({ framework: 'symfony', confidence: 0.9, detectedVia: 'decorator' });
    }
  }

  return results;
}


// =============================================================================
// Primitive Discovery
// =============================================================================

/**
 * Discover all primitives used in the codebase
 */
export function discoverPrimitives(context: DiscoveryContext): DetectedPrimitive[] {
  const primitives: DetectedPrimitive[] = [];
  const seen = new Set<string>();

  // 1. Bootstrap from known frameworks
  const frameworks = detectFrameworks(context);
  const bootstrapPrimitives = discoverFromBootstrap(frameworks, context);
  for (const p of bootstrapPrimitives) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      primitives.push(p);
    }
  }

  // 2. Discover from imports
  const importPrimitives = discoverFromImports(context);
  for (const p of importPrimitives) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      primitives.push(p);
    }
  }

  // 3. Discover from decorators
  const decoratorPrimitives = discoverFromDecorators(context);
  for (const p of decoratorPrimitives) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      primitives.push(p);
    }
  }

  // 4. Infer from frequency (high usage = likely primitive)
  const frequencyPrimitives = discoverFromFrequency(context, seen);
  for (const p of frequencyPrimitives) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      primitives.push(p);
    }
  }

  // Count usages for all primitives
  return primitives.map((p) => ({
    ...p,
    usageCount: countUsages(p.name, context),
  }));
}

/**
 * Discover primitives from bootstrap registry
 */
function discoverFromBootstrap(
  frameworks: FrameworkDetectionResult[],
  context: DiscoveryContext
): DetectedPrimitive[] {
  const primitives: DetectedPrimitive[] = [];
  const registry = ALL_PRIMITIVES[context.language];

  for (const fw of frameworks) {
    const frameworkPrimitives = registry[fw.framework];
    if (!frameworkPrimitives) continue;

    for (const [category, names] of Object.entries(frameworkPrimitives)) {
      for (const name of names) {
        primitives.push({
          name,
          framework: fw.framework,
          category,
          source: { type: 'bootstrap', confidence: fw.confidence },
          language: context.language,
          usageCount: 0,
        });
      }
    }
  }

  return primitives;
}

/**
 * Discover primitives from imports
 */
function discoverFromImports(context: DiscoveryContext): DetectedPrimitive[] {
  const primitives: DetectedPrimitive[] = [];
  const knownPrimitives = getPrimitiveNames(context.language);

  for (const imp of context.imports) {
    // Skip internal imports
    if (isInternalImport(imp.source)) continue;

    for (const name of imp.imported) {
      // Check if it's a known primitive
      if (knownPrimitives.has(name)) {
        const info = findPrimitiveFramework(name, context.language);
        if (info) {
          primitives.push({
            name,
            framework: info.framework,
            category: info.category,
            source: { type: 'import', confidence: 0.9 },
            importPath: imp.source,
            language: context.language,
            usageCount: 0,
          });
        }
      }
      // Check if it looks like a primitive
      else if (looksLikePrimitive(name, context.language)) {
        primitives.push({
          name,
          framework: extractFrameworkFromImport(imp.source),
          category: 'discovered',
          source: { type: 'import', confidence: 0.7 },
          importPath: imp.source,
          language: context.language,
          usageCount: 0,
        });
      }
    }
  }

  return primitives;
}

/**
 * Discover primitives from decorator usage
 */
function discoverFromDecorators(context: DiscoveryContext): DetectedPrimitive[] {
  const primitives: DetectedPrimitive[] = [];
  const knownPrimitives = getPrimitiveNames(context.language);
  const seen = new Set<string>();

  for (const dec of context.decorators) {
    if (seen.has(dec.name)) continue;
    seen.add(dec.name);

    // Check if it's a known primitive
    if (knownPrimitives.has(dec.name)) {
      const info = findPrimitiveFramework(dec.name, context.language);
      if (info) {
        primitives.push({
          name: dec.name,
          framework: info.framework,
          category: info.category,
          source: { type: 'decorator', confidence: 0.95 },
          language: context.language,
          usageCount: 0,
        });
      }
    }
  }

  return primitives;
}

/**
 * Discover primitives from high-frequency usage
 */
function discoverFromFrequency(
  context: DiscoveryContext,
  alreadySeen: Set<string>
): DetectedPrimitive[] {
  const primitives: DetectedPrimitive[] = [];
  const FREQUENCY_THRESHOLD = 15;

  for (const usage of context.functionUsages) {
    if (alreadySeen.has(usage.name)) continue;
    if (usage.callCount < FREQUENCY_THRESHOLD) continue;

    // Only consider if it looks like a utility/primitive
    if (looksLikeUtilityFunction(usage.name)) {
      primitives.push({
        name: usage.name,
        framework: 'project',
        category: 'inferred',
        source: { type: 'frequency', confidence: 0.6 },
        language: context.language,
        usageCount: usage.callCount,
      });
    }
  }

  return primitives;
}

// =============================================================================
// Helper Functions
// =============================================================================

function isInternalImport(source: string): boolean {
  return (
    source.startsWith('.') ||
    source.startsWith('/') ||
    source.startsWith('@/') ||
    source.startsWith('~/')
  );
}

function extractFrameworkFromImport(source: string): string {
  // @scope/package -> @scope/package
  // package/subpath -> package
  if (source.startsWith('@')) {
    const parts = source.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : source;
  }
  return source.split('/')[0];
}

function looksLikeUtilityFunction(name: string): boolean {
  // Short, generic names are more likely primitives
  if (name.length < 20) return true;

  // Common utility prefixes
  const utilityPrefixes = ['get', 'set', 'create', 'make', 'build', 'use', 'with', 'to', 'from', 'parse', 'format'];
  if (utilityPrefixes.some((p) => name.toLowerCase().startsWith(p))) return true;

  return false;
}

function countUsages(name: string, context: DiscoveryContext): number {
  const usage = context.functionUsages.find((u) => u.name === name);
  return usage?.callCount || 0;
}

/**
 * Filter primitives by minimum confidence
 */
export function filterByConfidence(
  primitives: DetectedPrimitive[],
  minConfidence: number
): DetectedPrimitive[] {
  return primitives.filter((p) => p.source.confidence >= minConfidence);
}

/**
 * Group primitives by framework
 */
export function groupByFramework(
  primitives: DetectedPrimitive[]
): Map<string, DetectedPrimitive[]> {
  const grouped = new Map<string, DetectedPrimitive[]>();

  for (const p of primitives) {
    const existing = grouped.get(p.framework) || [];
    grouped.set(p.framework, [...existing, p]);
  }

  return grouped;
}

/**
 * Group primitives by category
 */
export function groupByCategory(
  primitives: DetectedPrimitive[]
): Map<string, DetectedPrimitive[]> {
  const grouped = new Map<string, DetectedPrimitive[]>();

  for (const p of primitives) {
    const existing = grouped.get(p.category) || [];
    grouped.set(p.category, [...existing, p]);
  }

  return grouped;
}
