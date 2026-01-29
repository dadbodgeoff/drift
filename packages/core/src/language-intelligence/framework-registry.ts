/**
 * Framework Registry
 *
 * Central registry for framework patterns. Manages loading, registration,
 * and lookup of framework-specific decorator/annotation patterns.
 */

import type { FrameworkPattern, DecoratorMapping, DecoratorSemantics } from './types.js';
import type { CallGraphLanguage } from '../call-graph/types.js';

/**
 * Framework Registry
 *
 * Singleton registry that holds all known framework patterns.
 * Frameworks can be registered at startup or dynamically added.
 */
export class FrameworkRegistry {
  private static instance: FrameworkRegistry | null = null;

  /** All registered framework patterns */
  private frameworks: Map<string, FrameworkPattern> = new Map();

  /** Index by language for fast lookup */
  private byLanguage: Map<CallGraphLanguage, FrameworkPattern[]> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): FrameworkRegistry {
    if (!FrameworkRegistry.instance) {
      FrameworkRegistry.instance = new FrameworkRegistry();
    }
    return FrameworkRegistry.instance;
  }

  /**
   * Reset the registry (mainly for testing)
   */
  static reset(): void {
    FrameworkRegistry.instance = null;
  }

  /**
   * Register a framework pattern
   */
  register(pattern: FrameworkPattern): void {
    this.frameworks.set(pattern.framework, pattern);

    // Update language index
    for (const lang of pattern.languages) {
      const existing = this.byLanguage.get(lang) ?? [];
      if (!existing.find(f => f.framework === pattern.framework)) {
        existing.push(pattern);
        this.byLanguage.set(lang, existing);
      }
    }
  }

  /**
   * Register multiple framework patterns
   */
  registerAll(patterns: FrameworkPattern[]): void {
    for (const pattern of patterns) {
      this.register(pattern);
    }
  }

  /**
   * Get a framework pattern by name
   */
  get(framework: string): FrameworkPattern | undefined {
    return this.frameworks.get(framework);
  }

  /**
   * Get all frameworks for a language
   */
  getForLanguage(language: CallGraphLanguage): FrameworkPattern[] {
    return this.byLanguage.get(language) ?? [];
  }

  /**
   * Get all registered frameworks
   */
  getAll(): FrameworkPattern[] {
    return Array.from(this.frameworks.values());
  }

  /**
   * Check if a framework is registered
   */
  has(framework: string): boolean {
    return this.frameworks.has(framework);
  }

  /**
   * Detect frameworks from source code
   *
   * Checks detection patterns against the source to determine
   * which frameworks are likely in use.
   */
  detectFrameworks(source: string, language: CallGraphLanguage): FrameworkPattern[] {
    const candidates = this.getForLanguage(language);
    const detected: FrameworkPattern[] = [];

    for (const framework of candidates) {
      if (this.matchesDetectionPatterns(source, framework)) {
        detected.push(framework);
      }
    }

    return detected;
  }

  /**
   * Check if source matches a framework's detection patterns
   */
  private matchesDetectionPatterns(source: string, framework: FrameworkPattern): boolean {
    const { detectionPatterns } = framework;

    // Check import patterns
    if (detectionPatterns.imports?.length) {
      for (const pattern of detectionPatterns.imports) {
        if (pattern.test(source)) {
          return true;
        }
      }
    }

    // Check decorator patterns
    if (detectionPatterns.decorators?.length) {
      for (const pattern of detectionPatterns.decorators) {
        if (pattern.test(source)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Find matching decorator mapping for a raw decorator string
   */
  findDecoratorMapping(
    raw: string,
    frameworks: FrameworkPattern[]
  ): { mapping: DecoratorMapping; framework: FrameworkPattern } | null {
    for (const framework of frameworks) {
      for (const mapping of framework.decoratorMappings) {
        if (mapping.pattern.test(raw)) {
          return { mapping, framework };
        }
      }
    }
    return null;
  }

  /**
   * Get default semantics for an unknown decorator
   */
  getDefaultSemantics(): DecoratorSemantics {
    return {
      category: 'unknown',
      intent: 'Unknown decorator',
      isEntryPoint: false,
      isInjectable: false,
      requiresAuth: false,
      confidence: 0,
    };
  }
}

/**
 * Get the global framework registry instance
 */
export function getFrameworkRegistry(): FrameworkRegistry {
  return FrameworkRegistry.getInstance();
}

/**
 * Register a framework pattern in the global registry
 */
export function registerFramework(pattern: FrameworkPattern): void {
  getFrameworkRegistry().register(pattern);
}

/**
 * Register multiple framework patterns
 */
export function registerFrameworks(patterns: FrameworkPattern[]): void {
  getFrameworkRegistry().registerAll(patterns);
}
