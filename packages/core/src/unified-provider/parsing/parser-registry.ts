/**
 * Parser Registry
 *
 * Manages tree-sitter parser instances with singleton pattern per language.
 * Provides efficient parser reuse and availability checking.
 */

import type { TreeSitterParser } from '../../parsers/tree-sitter/types.js';
import type { UnifiedLanguage } from '../types.js';

// Lazy imports to avoid loading parsers until needed
let typescriptLoader: typeof import('../../parsers/tree-sitter/typescript-loader.js') | null = null;
let pythonLoader: typeof import('../../parsers/tree-sitter/loader.js') | null = null;
let javaLoader: typeof import('../../parsers/tree-sitter/java-loader.js') | null = null;
let phpLoader: typeof import('../../parsers/tree-sitter/php-loader.js') | null = null;
let csharpLoader: typeof import('../../parsers/tree-sitter/csharp-loader.js') | null = null;
let goLoader: typeof import('../../parsers/tree-sitter/go-loader.js') | null = null;
let rustLoader: typeof import('../../parsers/tree-sitter/rust-loader.js') | null = null;
let cppLoader: typeof import('../../parsers/tree-sitter/cpp-loader.js') | null = null;

/**
 * Parser availability status
 */
export interface ParserAvailability {
  language: UnifiedLanguage;
  available: boolean;
  reason?: string | undefined;
}

/**
 * Parser Registry - Singleton manager for tree-sitter parsers
 */
export class ParserRegistry {
  private static instance: ParserRegistry | null = null;
  private parsers: Map<string, TreeSitterParser> = new Map();
  private availability: Map<UnifiedLanguage, boolean> = new Map();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): ParserRegistry {
    if (!ParserRegistry.instance) {
      ParserRegistry.instance = new ParserRegistry();
    }
    return ParserRegistry.instance;
  }

  /**
   * Reset the singleton (for testing)
   */
  static reset(): void {
    if (ParserRegistry.instance) {
      ParserRegistry.instance.parsers.clear();
      ParserRegistry.instance.availability.clear();
    }
    ParserRegistry.instance = null;
  }

  /**
   * Check if a parser is available for a language
   */
  async isAvailable(language: UnifiedLanguage): Promise<boolean> {
    if (this.availability.has(language)) {
      return this.availability.get(language)!;
    }

    const available = await this.checkAvailability(language);
    this.availability.set(language, available);
    return available;
  }

  /**
   * Get a parser for a language
   */
  async getParser(language: UnifiedLanguage, filePath?: string): Promise<TreeSitterParser | null> {
    const cacheKey = this.getCacheKey(language, filePath);

    if (this.parsers.has(cacheKey)) {
      return this.parsers.get(cacheKey)!;
    }

    const parser = await this.createParser(language, filePath);
    if (parser) {
      this.parsers.set(cacheKey, parser);
    }
    return parser;
  }

  /**
   * Get availability status for all languages
   */
  async getAllAvailability(): Promise<ParserAvailability[]> {
    const languages: UnifiedLanguage[] = ['typescript', 'javascript', 'python', 'java', 'csharp', 'php', 'go', 'rust', 'cpp'];
    const results: ParserAvailability[] = [];

    for (const language of languages) {
      const available = await this.isAvailable(language);
      results.push({
        language,
        available,
        reason: available ? undefined : `Tree-sitter parser not available for ${language}`,
      });
    }

    return results;
  }

  /**
   * Get cache key for parser
   */
  private getCacheKey(language: UnifiedLanguage, filePath?: string): string {
    // TypeScript/JavaScript need different parsers for different file types
    if (language === 'typescript' || language === 'javascript') {
      if (filePath) {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.tsx')) {return 'tsx';}
        if (lower.endsWith('.jsx')) {return 'jsx';}
        if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {return 'ts';}
      }
      return language === 'typescript' ? 'ts' : 'js';
    }
    return language;
  }

  /**
   * Check parser availability for a language
   */
  private async checkAvailability(language: UnifiedLanguage): Promise<boolean> {
    try {
      switch (language) {
        case 'typescript':
        case 'javascript': {
          if (!typescriptLoader) {
            typescriptLoader = await import('../../parsers/tree-sitter/typescript-loader.js');
          }
          return typescriptLoader.isTypeScriptTreeSitterAvailable() ||
                 typescriptLoader.isJavaScriptTreeSitterAvailable();
        }
        case 'python': {
          if (!pythonLoader) {
            pythonLoader = await import('../../parsers/tree-sitter/loader.js');
          }
          return pythonLoader.isTreeSitterAvailable();
        }
        case 'java': {
          if (!javaLoader) {
            javaLoader = await import('../../parsers/tree-sitter/java-loader.js');
          }
          return javaLoader.isJavaTreeSitterAvailable();
        }
        case 'php': {
          if (!phpLoader) {
            phpLoader = await import('../../parsers/tree-sitter/php-loader.js');
          }
          return phpLoader.isPhpTreeSitterAvailable();
        }
        case 'csharp': {
          if (!csharpLoader) {
            csharpLoader = await import('../../parsers/tree-sitter/csharp-loader.js');
          }
          return csharpLoader.isCSharpTreeSitterAvailable();
        }
        case 'go': {
          if (!goLoader) {
            goLoader = await import('../../parsers/tree-sitter/go-loader.js');
          }
          return goLoader.isGoTreeSitterAvailable();
        }
        case 'rust': {
          if (!rustLoader) {
            rustLoader = await import('../../parsers/tree-sitter/rust-loader.js');
          }
          return rustLoader.isRustTreeSitterAvailable();
        }
        case 'cpp': {
          if (!cppLoader) {
            cppLoader = await import('../../parsers/tree-sitter/cpp-loader.js');
          }
          return cppLoader.isCppTreeSitterAvailable();
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Create a parser for a language
   */
  private async createParser(language: UnifiedLanguage, filePath?: string): Promise<TreeSitterParser | null> {
    try {
      switch (language) {
        case 'typescript':
        case 'javascript': {
          if (!typescriptLoader) {
            typescriptLoader = await import('../../parsers/tree-sitter/typescript-loader.js');
          }
          if (filePath) {
            return typescriptLoader.createParserForFile(filePath);
          }
          return language === 'typescript'
            ? typescriptLoader.createTypeScriptParser()
            : typescriptLoader.createJavaScriptParser();
        }
        case 'python': {
          if (!pythonLoader) {
            pythonLoader = await import('../../parsers/tree-sitter/loader.js');
          }
          return pythonLoader.createPythonParser();
        }
        case 'java': {
          if (!javaLoader) {
            javaLoader = await import('../../parsers/tree-sitter/java-loader.js');
          }
          return javaLoader.createJavaParser();
        }
        case 'php': {
          if (!phpLoader) {
            phpLoader = await import('../../parsers/tree-sitter/php-loader.js');
          }
          return phpLoader.createPhpParser();
        }
        case 'csharp': {
          if (!csharpLoader) {
            csharpLoader = await import('../../parsers/tree-sitter/csharp-loader.js');
          }
          return csharpLoader.createCSharpParser();
        }
        case 'go': {
          if (!goLoader) {
            goLoader = await import('../../parsers/tree-sitter/go-loader.js');
          }
          return goLoader.createGoParser();
        }
        case 'rust': {
          if (!rustLoader) {
            rustLoader = await import('../../parsers/tree-sitter/rust-loader.js');
          }
          return rustLoader.createRustParser();
        }
        case 'cpp': {
          if (!cppLoader) {
            cppLoader = await import('../../parsers/tree-sitter/cpp-loader.js');
          }
          return cppLoader.createCppParser();
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}

/**
 * Get the parser registry singleton
 */
export function getParserRegistry(): ParserRegistry {
  return ParserRegistry.getInstance();
}

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): UnifiedLanguage | null {
  const lower = filePath.toLowerCase();

  // TypeScript
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') ||
      lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }

  // JavaScript
  if (lower.endsWith('.js') || lower.endsWith('.jsx') ||
      lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }

  // Python
  if (lower.endsWith('.py') || lower.endsWith('.pyw') || lower.endsWith('.pyi')) {
    return 'python';
  }

  // Java
  if (lower.endsWith('.java')) {
    return 'java';
  }

  // C#
  if (lower.endsWith('.cs')) {
    return 'csharp';
  }

  // PHP
  if (lower.endsWith('.php') || lower.endsWith('.phtml') ||
      lower.endsWith('.php3') || lower.endsWith('.php4') ||
      lower.endsWith('.php5') || lower.endsWith('.php7') ||
      lower.endsWith('.phps')) {
    return 'php';
  }

  // Go
  if (lower.endsWith('.go')) {
    return 'go';
  }

  // Rust
  if (lower.endsWith('.rs')) {
    return 'rust';
  }

  // C++
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') ||
      lower.endsWith('.cxx') || lower.endsWith('.c++') ||
      lower.endsWith('.hpp') || lower.endsWith('.hh') ||
      lower.endsWith('.hxx') || lower.endsWith('.h++') ||
      lower.endsWith('.h')) {
    return 'cpp';
  }

  return null;
}

/**
 * Get file extensions for a language
 */
export function getLanguageExtensions(language: UnifiedLanguage): string[] {
  switch (language) {
    case 'typescript':
      return ['.ts', '.tsx', '.mts', '.cts'];
    case 'javascript':
      return ['.js', '.jsx', '.mjs', '.cjs'];
    case 'python':
      return ['.py', '.pyw', '.pyi'];
    case 'java':
      return ['.java'];
    case 'csharp':
      return ['.cs'];
    case 'php':
      return ['.php', '.phtml', '.php3', '.php4', '.php5', '.php7', '.phps'];
    case 'go':
      return ['.go'];
    case 'rust':
      return ['.rs'];
    case 'cpp':
      return ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.h'];
    default:
      return [];
  }
}
