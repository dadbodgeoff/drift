/**
 * Value Converter Extractor
 *
 * Extracts IValueConverter and IMultiValueConverter implementations from C# code.
 * Tracks converter usage across XAML files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { SourceLocation } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface ValueConverterInfo {
  /** Class name */
  className: string;
  /** Full qualified name */
  qualifiedName: string;
  /** File path */
  filePath: string;
  /** Converter type */
  converterType: 'IValueConverter' | 'IMultiValueConverter';
  /** Resource keys (from XAML) */
  resourceKeys: string[];
  /** Convert method info */
  convertMethod: ConverterMethodInfo | null;
  /** ConvertBack method info */
  convertBackMethod: ConverterMethodInfo | null;
  /** Usages in XAML */
  usages: ConverterUsage[];
  /** Source location */
  location: SourceLocation;
}

export interface ConverterMethodInfo {
  /** Has implementation (not just throw) */
  hasImplementation: boolean;
  /** Return type */
  returnType: string;
  /** Parameter types */
  parameterTypes: string[];
  /** Line number */
  line: number;
}

export interface ConverterUsage {
  /** XAML file */
  xamlFile: string;
  /** Element type */
  elementType: string;
  /** Binding property */
  property: string;
  /** Resource key used */
  resourceKey: string;
  /** Line number */
  line: number;
}

export interface ValueConverterExtractionResult {
  /** Extracted converters */
  converters: ValueConverterInfo[];
  /** Total usages found */
  totalUsages: number;
  /** Extraction confidence */
  confidence: number;
}

// ============================================================================
// Regex Patterns
// ============================================================================

export const VALUE_CONVERTER_PATTERNS = {
  // IValueConverter implementation
  valueConverter: /(?:public|internal)\s+(?:sealed\s+)?class\s+(\w+)\s*:\s*(?:[\w.,\s]+,\s*)?IValueConverter/g,

  // IMultiValueConverter implementation
  multiValueConverter: /(?:public|internal)\s+(?:sealed\s+)?class\s+(\w+)\s*:\s*(?:[\w.,\s]+,\s*)?IMultiValueConverter/g,

  // Namespace declaration
  namespace: /namespace\s+([\w.]+)/,

  // Convert method
  convertMethod: /public\s+object\s+Convert\s*\(\s*object\s+\w+\s*,\s*Type\s+\w+\s*,\s*object\s+\w+\s*,\s*CultureInfo\s+\w+\s*\)\s*\{([^}]+)\}/,

  // ConvertBack method
  convertBackMethod: /public\s+object\s+ConvertBack\s*\(\s*object\s+\w+\s*,\s*Type\s+\w+\s*,\s*object\s+\w+\s*,\s*CultureInfo\s+\w+\s*\)\s*\{([^}]+)\}/,

  // MultiValue Convert method
  multiConvertMethod: /public\s+object\s+Convert\s*\(\s*object\[\]\s+\w+\s*,\s*Type\s+\w+\s*,\s*object\s+\w+\s*,\s*CultureInfo\s+\w+\s*\)\s*\{([^}]+)\}/,

  // MultiValue ConvertBack method
  multiConvertBackMethod: /public\s+object\[\]\s+ConvertBack\s*\(\s*object\s+\w+\s*,\s*Type\[\]\s+\w+\s*,\s*object\s+\w+\s*,\s*CultureInfo\s+\w+\s*\)\s*\{([^}]+)\}/,

  // Throw NotImplementedException (indicates no real implementation)
  throwNotImplemented: /throw\s+new\s+NotImplementedException/,

  // Throw NotSupportedException
  throwNotSupported: /throw\s+new\s+NotSupportedException/,

  // XAML converter usage
  xamlConverterUsage: /Converter\s*=\s*\{StaticResource\s+(\w+)\}/g,

  // XAML converter resource definition
  xamlConverterResource: /<(\w+:)?(\w+Converter)\s+x:Key\s*=\s*["'](\w+)["']/g,

  // MarkupExtension converter (inline)
  markupExtensionConverter: /\[ValueConversion\s*\(\s*typeof\s*\(\s*(\w+)\s*\)\s*,\s*typeof\s*\(\s*(\w+)\s*\)\s*\)\]/,
};

// ============================================================================
// Value Converter Extractor
// ============================================================================

export class ValueConverterExtractor {
  private converters: Map<string, ValueConverterInfo> = new Map();
  private resourceKeyToClass: Map<string, string> = new Map();

  /**
   * Extract converters from C# content
   */
  extractFromCSharp(filePath: string, content: string): ValueConverterInfo[] {
    const results: ValueConverterInfo[] = [];

    // Get namespace
    const namespaceMatch = content.match(VALUE_CONVERTER_PATTERNS.namespace);
    const namespace = namespaceMatch?.[1] ?? '';

    // Extract IValueConverter implementations
    let match;
    VALUE_CONVERTER_PATTERNS.valueConverter.lastIndex = 0;
    while ((match = VALUE_CONVERTER_PATTERNS.valueConverter.exec(content)) !== null) {
      const className = match[1] ?? '';
      const qualifiedName = namespace ? `${namespace}.${className}` : className;

      const converter: ValueConverterInfo = {
        className,
        qualifiedName,
        filePath,
        converterType: 'IValueConverter',
        resourceKeys: [],
        convertMethod: this.extractConvertMethod(content, false),
        convertBackMethod: this.extractConvertBackMethod(content, false),
        usages: [],
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      };

      results.push(converter);
      this.converters.set(className, converter);
      this.converters.set(qualifiedName, converter);
    }

    // Extract IMultiValueConverter implementations
    VALUE_CONVERTER_PATTERNS.multiValueConverter.lastIndex = 0;
    while ((match = VALUE_CONVERTER_PATTERNS.multiValueConverter.exec(content)) !== null) {
      const className = match[1] ?? '';
      const qualifiedName = namespace ? `${namespace}.${className}` : className;

      const converter: ValueConverterInfo = {
        className,
        qualifiedName,
        filePath,
        converterType: 'IMultiValueConverter',
        resourceKeys: [],
        convertMethod: this.extractConvertMethod(content, true),
        convertBackMethod: this.extractConvertBackMethod(content, true),
        usages: [],
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      };

      results.push(converter);
      this.converters.set(className, converter);
      this.converters.set(qualifiedName, converter);
    }

    return results;
  }

  /**
   * Extract converter resource definitions from XAML
   */
  extractFromXaml(_filePath: string, content: string): void {
    let match;
    VALUE_CONVERTER_PATTERNS.xamlConverterResource.lastIndex = 0;
    while ((match = VALUE_CONVERTER_PATTERNS.xamlConverterResource.exec(content)) !== null) {
      const converterClass = match[2] ?? '';
      const resourceKey = match[3] ?? '';

      this.resourceKeyToClass.set(resourceKey, converterClass);

      // Link to converter if found
      const converter = this.converters.get(converterClass);
      if (converter && !converter.resourceKeys.includes(resourceKey)) {
        converter.resourceKeys.push(resourceKey);
      }
    }
  }

  /**
   * Find converter usages in XAML
   */
  findUsages(xamlFile: string, content: string): ConverterUsage[] {
    const usages: ConverterUsage[] = [];

    let match;
    VALUE_CONVERTER_PATTERNS.xamlConverterUsage.lastIndex = 0;
    while ((match = VALUE_CONVERTER_PATTERNS.xamlConverterUsage.exec(content)) !== null) {
      const resourceKey = match[1] ?? '';
      const line = this.getLineNumber(content, match.index);

      // Find element context
      const elementType = this.findElementContext(content, match.index);

      const usage: ConverterUsage = {
        xamlFile,
        elementType,
        property: 'Converter',
        resourceKey,
        line,
      };

      usages.push(usage);

      // Link to converter
      const converterClass = this.resourceKeyToClass.get(resourceKey);
      if (converterClass) {
        const converter = this.converters.get(converterClass);
        if (converter) {
          converter.usages.push(usage);
        }
      }
    }

    return usages;
  }

  /**
   * Extract Convert method info
   */
  private extractConvertMethod(content: string, isMulti: boolean): ConverterMethodInfo | null {
    const pattern = isMulti
      ? VALUE_CONVERTER_PATTERNS.multiConvertMethod
      : VALUE_CONVERTER_PATTERNS.convertMethod;

    const match = content.match(pattern);
    if (!match) {return null;}

    const body = match[1] ?? '';
    const hasImplementation = !VALUE_CONVERTER_PATTERNS.throwNotImplemented.test(body) &&
                              !VALUE_CONVERTER_PATTERNS.throwNotSupported.test(body);

    // Get line number from match index
    const matchIndex = content.indexOf(match[0]);

    return {
      hasImplementation,
      returnType: 'object',
      parameterTypes: isMulti
        ? ['object[]', 'Type', 'object', 'CultureInfo']
        : ['object', 'Type', 'object', 'CultureInfo'],
      line: this.getLineNumber(content, matchIndex),
    };
  }

  /**
   * Extract ConvertBack method info
   */
  private extractConvertBackMethod(content: string, isMulti: boolean): ConverterMethodInfo | null {
    const pattern = isMulti
      ? VALUE_CONVERTER_PATTERNS.multiConvertBackMethod
      : VALUE_CONVERTER_PATTERNS.convertBackMethod;

    const match = content.match(pattern);
    if (!match) {return null;}

    const body = match[1] ?? '';
    const hasImplementation = !VALUE_CONVERTER_PATTERNS.throwNotImplemented.test(body) &&
                              !VALUE_CONVERTER_PATTERNS.throwNotSupported.test(body);

    // Get line number from match index
    const matchIndex = content.indexOf(match[0]);

    return {
      hasImplementation,
      returnType: isMulti ? 'object[]' : 'object',
      parameterTypes: isMulti
        ? ['object', 'Type[]', 'object', 'CultureInfo']
        : ['object', 'Type', 'object', 'CultureInfo'],
      line: this.getLineNumber(content, matchIndex),
    };
  }

  /**
   * Find element context for a match
   */
  private findElementContext(content: string, index: number): string {
    // Look backwards for opening tag
    const before = content.slice(Math.max(0, index - 500), index);
    const tagMatch = before.match(/<(\w+)(?:\s|>)[^<]*$/);
    return tagMatch?.[1] ?? 'Unknown';
  }

  /**
   * Get all converters
   */
  getConverters(): ValueConverterInfo[] {
    return Array.from(this.converters.values());
  }

  /**
   * Get converter by class name or resource key
   */
  getConverter(nameOrKey: string): ValueConverterInfo | null {
    // Try direct lookup
    let converter = this.converters.get(nameOrKey);
    if (converter) {return converter;}

    // Try resource key lookup
    const className = this.resourceKeyToClass.get(nameOrKey);
    if (className) {
      converter = this.converters.get(className);
      if (converter) {return converter;}
    }

    return null;
  }

  /**
   * Analyze all converters in a project
   */
  async analyzeProject(rootDir: string): Promise<ValueConverterExtractionResult> {
    // Find and analyze C# files
    const csFiles = await this.findFiles(rootDir, '**/*.cs');
    for (const filePath of csFiles) {
      const fullPath = path.join(rootDir, filePath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        if (content.includes('IValueConverter') || content.includes('IMultiValueConverter')) {
          this.extractFromCSharp(filePath, content);
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Find and analyze XAML files
    const xamlFiles = await this.findFiles(rootDir, '**/*.xaml');
    for (const filePath of xamlFiles) {
      const fullPath = path.join(rootDir, filePath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        this.extractFromXaml(filePath, content);
        this.findUsages(filePath, content);
      } catch {
        // Skip unreadable files
      }
    }

    const converters = this.getConverters();
    const totalUsages = converters.reduce((sum, c) => sum + c.usages.length, 0);

    return {
      converters,
      totalUsages,
      confidence: converters.length > 0 ? 0.85 : 0.5,
    };
  }

  /**
   * Find files matching pattern
   */
  private async findFiles(rootDir: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    const extension = pattern.includes('.cs') ? '.cs' : '.xaml';

    const walk = async (dir: string, relativePath: string = ''): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (!['node_modules', 'bin', 'obj', '.git'].includes(entry.name)) {
            await walk(fullPath, relPath);
          }
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          results.push(relPath);
        }
      }
    };

    await walk(rootDir);
    return results;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.converters.clear();
    this.resourceKeyToClass.clear();
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
  }
}

/**
 * Factory function
 */
export function createValueConverterExtractor(): ValueConverterExtractor {
  return new ValueConverterExtractor();
}
