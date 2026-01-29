/**
 * Language Strategies Index
 *
 * Exports all language strategy providers and utilities.
 *
 * @module simulation/language-strategies
 */

import { csharpStrategyProvider } from './csharp-strategies.js';
import { javaStrategyProvider } from './java-strategies.js';
import { phpStrategyProvider } from './php-strategies.js';
import { pythonStrategyProvider } from './python-strategies.js';
import { CATEGORY_KEYWORDS } from './types.js';
import { typescriptStrategyProvider } from './typescript-strategies.js';

import type { CallGraphLanguage } from '../../call-graph/types.js';
import type { TaskCategory } from '../types.js';
import type { LanguageStrategyProvider, StrategyTemplate } from './types.js';


// Re-export types
export * from './types.js';

// Re-export providers
export { typescriptStrategyProvider } from './typescript-strategies.js';
export { pythonStrategyProvider } from './python-strategies.js';
export { javaStrategyProvider } from './java-strategies.js';
export { csharpStrategyProvider } from './csharp-strategies.js';
export { phpStrategyProvider } from './php-strategies.js';

/** All language strategy providers */
const PROVIDERS = new Map<CallGraphLanguage, LanguageStrategyProvider>();
PROVIDERS.set('typescript', typescriptStrategyProvider);
PROVIDERS.set('javascript', typescriptStrategyProvider); // JS uses same strategies as TS
PROVIDERS.set('python', pythonStrategyProvider);
PROVIDERS.set('java', javaStrategyProvider);
PROVIDERS.set('csharp', csharpStrategyProvider);
PROVIDERS.set('php', phpStrategyProvider);

/**
 * Get strategy provider for a language
 */
export function getStrategyProvider(language: CallGraphLanguage): LanguageStrategyProvider | null {
  return PROVIDERS.get(language) ?? null;
}

/**
 * Get strategies for a language and task category
 */
export function getStrategiesForTask(
  language: CallGraphLanguage,
  category: TaskCategory,
  framework?: string
): StrategyTemplate[] {
  const provider = PROVIDERS.get(language);
  if (!provider) {return [];}
  return provider.getStrategies(category, framework);
}

/**
 * Detect task category from description
 */
export function detectTaskCategory(description: string): TaskCategory {
  const descLower = description.toLowerCase();
  
  let bestMatch: { category: TaskCategory; score: number } = {
    category: 'generic',
    score: 0,
  };
  
  for (const { category, keywords, weight } of CATEGORY_KEYWORDS) {
    let matchCount = 0;
    for (const keyword of keywords) {
      if (descLower.includes(keyword)) {
        matchCount++;
      }
    }
    
    const score = matchCount * weight;
    if (score > bestMatch.score) {
      bestMatch = { category, score };
    }
  }
  
  return bestMatch.category;
}

/**
 * Detect framework from file content
 */
export function detectFramework(
  content: string,
  filePath: string,
  language: CallGraphLanguage
): string | null {
  const provider = PROVIDERS.get(language);
  if (!provider) {return null;}
  return provider.detectFramework(content, filePath);
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): CallGraphLanguage[] {
  return Array.from(PROVIDERS.keys());
}

/**
 * Get all frameworks for a language
 */
export function getFrameworksForLanguage(language: CallGraphLanguage): string[] {
  const provider = PROVIDERS.get(language);
  if (!provider) {return [];}
  return provider.frameworks.map(f => f.name);
}
