/**
 * Dependency Property Extractor
 *
 * Extracts DependencyProperty definitions from C# code.
 * Supports standard registration, attached properties, and property wrappers.
 */

import type { DependencyPropertyInfo, DependencyPropertyCallback } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface DependencyPropertyExtractionResult {
  /** Extracted dependency properties */
  properties: DependencyPropertyInfo[];
  /** Owner class name */
  ownerClass: string;
  /** Extraction confidence */
  confidence: number;
  /** Extraction method */
  method: 'ast' | 'regex';
}

// ============================================================================
// Regex Patterns
// ============================================================================

export const DEPENDENCY_PROPERTY_PATTERNS = {
  // Standard DependencyProperty.Register
  register: /public\s+static\s+(?:readonly\s+)?DependencyProperty\s+(\w+)Property\s*=\s*DependencyProperty\.Register\s*\(\s*(?:nameof\s*\(\s*(\w+)\s*\)|["'](\w+)["'])\s*,\s*typeof\s*\(\s*([^)]+)\s*\)\s*,\s*typeof\s*\(\s*([^)]+)\s*\)(?:\s*,\s*new\s+(?:Framework)?PropertyMetadata\s*\(([^)]*)\))?/g,

  // Attached property registration
  registerAttached: /public\s+static\s+(?:readonly\s+)?DependencyProperty\s+(\w+)Property\s*=\s*DependencyProperty\.RegisterAttached\s*\(\s*(?:nameof\s*\(\s*(\w+)\s*\)|["'](\w+)["'])\s*,\s*typeof\s*\(\s*([^)]+)\s*\)\s*,\s*typeof\s*\(\s*([^)]+)\s*\)(?:\s*,\s*new\s+(?:Framework)?PropertyMetadata\s*\(([^)]*)\))?/g,

  // Read-only DependencyProperty
  registerReadOnly: /(?:private|internal)\s+static\s+(?:readonly\s+)?DependencyPropertyKey\s+(\w+)PropertyKey\s*=\s*DependencyProperty\.RegisterReadOnly\s*\(\s*(?:nameof\s*\(\s*(\w+)\s*\)|["'](\w+)["'])/g,

  // Property wrapper (CLR wrapper for DP)
  propertyWrapper: /public\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*\{\s*get\s*\{\s*return\s*\(?(\w+)?\)?\s*GetValue\s*\(\s*(\w+)Property\s*\)/g,

  // PropertyChangedCallback in metadata
  propertyChangedCallback: /new\s+PropertyChangedCallback\s*\(\s*(\w+)\s*\)|OnPropertyChanged\s*:\s*(\w+)/g,

  // CoerceValueCallback
  coerceCallback: /new\s+CoerceValueCallback\s*\(\s*(\w+)\s*\)|CoerceValue\s*:\s*(\w+)/g,

  // ValidateValueCallback
  validateCallback: /new\s+ValidateValueCallback\s*\(\s*(\w+)\s*\)|ValidateValue\s*:\s*(\w+)/g,

  // Default value in metadata
  defaultValue: /new\s+(?:Framework)?PropertyMetadata\s*\(\s*([^,)]+)/,

  // Class declaration
  classDeclaration: /(?:public|internal)\s+(?:partial\s+)?class\s+(\w+)/,

  // Static constructor (often contains DP overrides)
  staticConstructor: /static\s+(\w+)\s*\(\s*\)\s*\{([^}]+)\}/g,

  // OverrideMetadata
  overrideMetadata: /(\w+)Property\.OverrideMetadata\s*\(\s*typeof\s*\(\s*(\w+)\s*\)\s*,\s*new\s+(?:Framework)?PropertyMetadata\s*\(([^)]*)\)/g,
};

// ============================================================================
// Dependency Property Extractor
// ============================================================================

export class DependencyPropertyExtractor {
  /**
   * Extract dependency properties from C# content
   */
  extract(filePath: string, content: string): DependencyPropertyExtractionResult {
    const properties: DependencyPropertyInfo[] = [];

    // Get owner class
    const classMatch = content.match(DEPENDENCY_PROPERTY_PATTERNS.classDeclaration);
    const ownerClass = classMatch?.[1] ?? 'Unknown';

    // Extract standard DependencyProperty.Register
    let match;
    DEPENDENCY_PROPERTY_PATTERNS.register.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.register.exec(content)) !== null) {
      const fieldName = `${match[1]}Property`;
      const propertyName = match[2] ?? match[3] ?? match[1] ?? '';
      const propertyType = match[4]?.trim() ?? 'object';
      const ownerType = match[5]?.trim() ?? ownerClass;
      const metadataContent = match[6] ?? '';

      const callbacks = this.extractCallbacks(metadataContent);
      const defaultValue = this.extractDefaultValue(metadataContent);

      properties.push({
        name: propertyName,
        fieldName,
        propertyType,
        ownerType,
        isAttached: false,
        ...(defaultValue !== undefined && { defaultValue }),
        callbacks,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract attached properties
    DEPENDENCY_PROPERTY_PATTERNS.registerAttached.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.registerAttached.exec(content)) !== null) {
      const fieldName = `${match[1]}Property`;
      const propertyName = match[2] ?? match[3] ?? match[1] ?? '';
      const propertyType = match[4]?.trim() ?? 'object';
      const ownerType = match[5]?.trim() ?? ownerClass;
      const metadataContent = match[6] ?? '';

      const callbacks = this.extractCallbacks(metadataContent);
      const defaultValue = this.extractDefaultValue(metadataContent);

      properties.push({
        name: propertyName,
        fieldName,
        propertyType,
        ownerType,
        isAttached: true,
        ...(defaultValue !== undefined && { defaultValue }),
        callbacks,
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Extract read-only properties
    DEPENDENCY_PROPERTY_PATTERNS.registerReadOnly.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.registerReadOnly.exec(content)) !== null) {
      const fieldName = `${match[1]}Property`;
      const propertyName = match[2] ?? match[3] ?? match[1] ?? '';

      // Check if we already have this property
      if (!properties.some(p => p.name === propertyName)) {
        properties.push({
          name: propertyName,
          fieldName,
          propertyType: 'unknown', // Would need more context
          ownerType: ownerClass,
          isAttached: false,
          callbacks: [],
          location: { file: filePath, line: this.getLineNumber(content, match.index) },
        });
      }
    }

    // Enrich with property wrapper info
    this.enrichWithWrapperInfo(properties, content);

    return {
      properties,
      ownerClass,
      confidence: properties.length > 0 ? 0.8 : 0.5,
      method: 'regex',
    };
  }

  /**
   * Extract callbacks from metadata content
   */
  private extractCallbacks(metadataContent: string): DependencyPropertyCallback[] {
    const callbacks: DependencyPropertyCallback[] = [];

    // PropertyChanged callback
    let match;
    DEPENDENCY_PROPERTY_PATTERNS.propertyChangedCallback.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.propertyChangedCallback.exec(metadataContent)) !== null) {
      const methodName = match[1] ?? match[2] ?? '';
      if (methodName) {
        callbacks.push({ type: 'PropertyChanged', methodName });
      }
    }

    // Coerce callback
    DEPENDENCY_PROPERTY_PATTERNS.coerceCallback.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.coerceCallback.exec(metadataContent)) !== null) {
      const methodName = match[1] ?? match[2] ?? '';
      if (methodName) {
        callbacks.push({ type: 'CoerceValue', methodName });
      }
    }

    // Validate callback
    DEPENDENCY_PROPERTY_PATTERNS.validateCallback.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.validateCallback.exec(metadataContent)) !== null) {
      const methodName = match[1] ?? match[2] ?? '';
      if (methodName) {
        callbacks.push({ type: 'Validate', methodName });
      }
    }

    return callbacks;
  }

  /**
   * Extract default value from metadata
   */
  private extractDefaultValue(metadataContent: string): string | undefined {
    const match = metadataContent.match(DEPENDENCY_PROPERTY_PATTERNS.defaultValue);
    if (match?.[1]) {
      const value = match[1].trim();
      // Skip if it's a callback reference
      if (!value.includes('Callback') && !value.startsWith('new ')) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Enrich properties with CLR wrapper information
   */
  private enrichWithWrapperInfo(properties: DependencyPropertyInfo[], content: string): void {
    let match;
    DEPENDENCY_PROPERTY_PATTERNS.propertyWrapper.lastIndex = 0;
    while ((match = DEPENDENCY_PROPERTY_PATTERNS.propertyWrapper.exec(content)) !== null) {
      const wrapperType = match[1] ?? '';
      const dpFieldName = `${match[4]}Property`;

      // Find matching DP
      const dp = properties.find(p => p.fieldName === dpFieldName);
      if (dp && wrapperType) {
        // Update type if we got a more specific one from wrapper
        if (dp.propertyType === 'object' || dp.propertyType === 'unknown') {
          dp.propertyType = wrapperType;
        }
      }
    }
  }

  /**
   * Check if a file likely contains dependency properties
   */
  hasDependencyProperties(content: string): boolean {
    return content.includes('DependencyProperty') ||
           content.includes('DependencyPropertyKey');
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
export function createDependencyPropertyExtractor(): DependencyPropertyExtractor {
  return new DependencyPropertyExtractor();
}
