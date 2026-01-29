/**
 * Resource Dictionary Parser
 *
 * Parses merged resource dictionaries and resolves resource references.
 * Extracts styles, templates, converters, and other resources.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { XamlResource, XamlResourceType, SourceLocation } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface ResourceDictionary {
  /** File path */
  path: string;
  /** Merged dictionaries (paths) */
  mergedDictionaries: string[];
  /** Resources in this dictionary */
  resources: Map<string, XamlResource>;
  /** Source attribute (for merged dictionaries) */
  source?: string | undefined;
}

export interface ResourceResolution {
  /** Resource key */
  key: string;
  /** Resolved resource */
  resource: XamlResource | null;
  /** Resolution path (which dictionaries were searched) */
  searchPath: string[];
  /** Found in dictionary */
  foundIn?: string | undefined;
}

export interface ValueConverterInfo {
  /** Resource key */
  resourceKey: string;
  /** C# class name */
  converterClass: string;
  /** Full type name with namespace */
  fullTypeName: string;
  /** File where defined */
  definedIn: string;
  /** Usages in XAML */
  usages: ConverterUsage[];
  /** Source location */
  location: SourceLocation;
}

export interface ConverterUsage {
  /** XAML file */
  xamlFile: string;
  /** Binding property */
  property: string;
  /** Line number */
  line: number;
}

// ============================================================================
// Regex Patterns
// ============================================================================

const RESOURCE_PATTERNS = {
  // ResourceDictionary.MergedDictionaries
  mergedDictionary: /<ResourceDictionary\s+Source\s*=\s*["']([^"']+)["']/g,

  // Style with x:Key
  style: /<Style\s+(?:[^>]*?)x:Key\s*=\s*["']([^"']+)["'](?:[^>]*?)(?:TargetType\s*=\s*["']\{?x:Type\s+)?([^}"'\s]+)?/g,

  // DataTemplate with x:Key
  dataTemplate: /<DataTemplate\s+(?:[^>]*?)x:Key\s*=\s*["']([^"']+)["'](?:[^>]*?)(?:DataType\s*=\s*["']\{?x:Type\s+)?([^}"'\s]+)?/g,

  // ControlTemplate with x:Key
  controlTemplate: /<ControlTemplate\s+(?:[^>]*?)x:Key\s*=\s*["']([^"']+)["'](?:[^>]*?)(?:TargetType\s*=\s*["']\{?x:Type\s+)?([^}"'\s]+)?/g,

  // Value converter (local:SomeConverter x:Key="...")
  converter: /<(\w+:)?(\w+Converter)\s+x:Key\s*=\s*["']([^"']+)["']/g,

  // Alternative converter pattern (x:Key first)
  converterAlt: /x:Key\s*=\s*["']([^"']+)["'][^>]*?(?:xmlns:\w+\s*=\s*["'][^"']*["'][^>]*)?\/>/g,

  // Brush resources
  brush: /<(SolidColorBrush|LinearGradientBrush|RadialGradientBrush)\s+(?:[^>]*?)x:Key\s*=\s*["']([^"']+)["']/g,

  // Generic resource with x:Key
  genericResource: /<(\w+(?::\w+)?)\s+(?:[^>]*?)x:Key\s*=\s*["']([^"']+)["']/g,

  // Namespace declarations
  namespace: /xmlns:(\w+)\s*=\s*["']clr-namespace:([^;"']+)(?:;assembly=([^"']+))?["']/g,

  // Converter usage in binding
  converterUsage: /Converter\s*=\s*\{StaticResource\s+([^}]+)\}/g,
};

// ============================================================================
// Resource Dictionary Parser
// ============================================================================

export class ResourceDictionaryParser {
  private dictionaries: Map<string, ResourceDictionary> = new Map();
  private converters: Map<string, ValueConverterInfo> = new Map();
  private namespaces: Map<string, string> = new Map(); // prefix -> namespace

  /**
   * Parse a resource dictionary file
   */
  async parse(filePath: string, content: string): Promise<ResourceDictionary> {
    const resources = new Map<string, XamlResource>();
    const mergedDictionaries: string[] = [];

    // Extract namespace declarations
    this.extractNamespaces(content);

    // Extract merged dictionaries
    let match;
    while ((match = RESOURCE_PATTERNS.mergedDictionary.exec(content)) !== null) {
      const source = match[1] ?? '';
      mergedDictionaries.push(source);
    }

    // Extract styles
    RESOURCE_PATTERNS.style.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.style.exec(content)) !== null) {
      const key = match[1] ?? '';
      const targetType = match[2];
      resources.set(key, {
        key,
        type: 'Style',
        targetType,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract data templates
    RESOURCE_PATTERNS.dataTemplate.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.dataTemplate.exec(content)) !== null) {
      const key = match[1] ?? '';
      const targetType = match[2];
      resources.set(key, {
        key,
        type: 'DataTemplate',
        targetType,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract control templates
    RESOURCE_PATTERNS.controlTemplate.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.controlTemplate.exec(content)) !== null) {
      const key = match[1] ?? '';
      const targetType = match[2];
      resources.set(key, {
        key,
        type: 'ControlTemplate',
        targetType,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract converters
    RESOURCE_PATTERNS.converter.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.converter.exec(content)) !== null) {
      const prefix = match[1]?.replace(':', '') ?? '';
      const converterClass = match[2] ?? '';
      const key = match[3] ?? '';
      const namespace = this.namespaces.get(prefix) ?? '';

      resources.set(key, {
        key,
        type: 'Converter',
        converterType: converterClass,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });

      // Track converter info
      this.converters.set(key, {
        resourceKey: key,
        converterClass,
        fullTypeName: namespace ? `${namespace}.${converterClass}` : converterClass,
        definedIn: filePath,
        usages: [],
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract brushes
    RESOURCE_PATTERNS.brush.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.brush.exec(content)) !== null) {
      const key = match[2] ?? '';
      resources.set(key, {
        key,
        type: 'Brush',
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    const dictionary: ResourceDictionary = {
      path: filePath,
      mergedDictionaries,
      resources,
    };

    this.dictionaries.set(filePath, dictionary);
    return dictionary;
  }

  /**
   * Parse all resource dictionaries in a directory
   */
  async parseAll(rootDir: string): Promise<Map<string, ResourceDictionary>> {
    const xamlFiles = await this.findResourceDictionaries(rootDir);

    for (const filePath of xamlFiles) {
      const fullPath = path.join(rootDir, filePath);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        await this.parse(filePath, content);
      } catch {
        // Skip files that can't be read
      }
    }

    return this.dictionaries;
  }

  /**
   * Find resource dictionary files
   */
  private async findResourceDictionaries(rootDir: string): Promise<string[]> {
    const results: string[] = [];

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
        } else if (entry.isFile() && entry.name.endsWith('.xaml')) {
          // Check if it's a resource dictionary
          const content = await fs.readFile(fullPath, 'utf-8');
          if (content.includes('<ResourceDictionary') || 
              content.includes('Resources>') ||
              entry.name.includes('Dictionary') ||
              entry.name.includes('Resources') ||
              entry.name.includes('Styles')) {
            results.push(relPath);
          }
        }
      }
    };

    await walk(rootDir);
    return results;
  }

  /**
   * Extract namespace declarations
   */
  private extractNamespaces(content: string): void {
    let match;
    RESOURCE_PATTERNS.namespace.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.namespace.exec(content)) !== null) {
      const prefix = match[1] ?? '';
      const namespace = match[2] ?? '';
      this.namespaces.set(prefix, namespace);
    }
  }

  /**
   * Resolve a resource by key
   */
  resolve(key: string, startingDictionary?: string): ResourceResolution {
    const searchPath: string[] = [];

    // Search in specific dictionary first
    if (startingDictionary) {
      const dict = this.dictionaries.get(startingDictionary);
      if (dict) {
        searchPath.push(startingDictionary);
        const resource = dict.resources.get(key);
        if (resource) {
          return { key, resource, searchPath, foundIn: startingDictionary };
        }

        // Search merged dictionaries
        for (const merged of dict.mergedDictionaries) {
          const result = this.resolve(key, merged);
          searchPath.push(...result.searchPath);
          if (result.resource) {
            return { key, resource: result.resource, searchPath, foundIn: result.foundIn };
          }
        }
      }
    }

    // Search all dictionaries
    for (const [dictPath, dict] of this.dictionaries) {
      if (!searchPath.includes(dictPath)) {
        searchPath.push(dictPath);
        const resource = dict.resources.get(key);
        if (resource) {
          return { key, resource, searchPath, foundIn: dictPath };
        }
      }
    }

    return { key, resource: null, searchPath };
  }

  /**
   * Get all converters
   */
  getConverters(): ValueConverterInfo[] {
    return Array.from(this.converters.values());
  }

  /**
   * Track converter usage
   */
  trackConverterUsage(converterKey: string, xamlFile: string, property: string, line: number): void {
    const converter = this.converters.get(converterKey);
    if (converter) {
      converter.usages.push({ xamlFile, property, line });
    }
  }

  /**
   * Find converter usages in XAML content
   */
  findConverterUsages(xamlFile: string, content: string): void {
    let match;
    RESOURCE_PATTERNS.converterUsage.lastIndex = 0;
    while ((match = RESOURCE_PATTERNS.converterUsage.exec(content)) !== null) {
      const converterKey = match[1]?.trim() ?? '';
      const line = this.getLineNumber(content, match.index);
      this.trackConverterUsage(converterKey, xamlFile, 'Converter', line);
    }
  }

  /**
   * Get all resources of a specific type
   */
  getResourcesByType(type: XamlResourceType): XamlResource[] {
    const results: XamlResource[] = [];
    for (const dict of this.dictionaries.values()) {
      for (const resource of dict.resources.values()) {
        if (resource.type === type) {
          results.push(resource);
        }
      }
    }
    return results;
  }

  /**
   * Clear all parsed data
   */
  clear(): void {
    this.dictionaries.clear();
    this.converters.clear();
    this.namespaces.clear();
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
export function createResourceDictionaryParser(): ResourceDictionaryParser {
  return new ResourceDictionaryParser();
}
