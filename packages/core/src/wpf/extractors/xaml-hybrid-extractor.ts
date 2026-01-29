/**
 * XAML Hybrid Extractor
 *
 * Combines XML DOM parsing (primary) with regex fallback for enterprise-grade
 * XAML extraction. Follows Drift's hybrid extraction pattern.
 */

import { XamlRegexExtractor, XAML_REGEX_PATTERNS } from './regex/xaml-regex.js';

import type {
  XamlExtractionResult,
  XamlBinding,
  XamlResource,
  ExtractedBinding,
  ExtractedCommand,
  BindingMode,
  BindingSourceType,
  UpdateSourceTrigger,
} from '../types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface XamlExtractorConfig {
  /** Enable XML DOM parsing */
  enableDomParsing?: boolean;
  /** Enable regex fallback */
  enableRegexFallback?: boolean;
  /** Minimum confidence to skip fallback */
  minConfidenceThreshold?: number;
}

const DEFAULT_CONFIG: Required<XamlExtractorConfig> = {
  enableDomParsing: true,
  enableRegexFallback: true,
  minConfidenceThreshold: 0.8,
};

// ============================================================================
// XAML Hybrid Extractor
// ============================================================================

export class XamlHybridExtractor {
  private config: Required<XamlExtractorConfig>;
  private regexExtractor: XamlRegexExtractor;

  constructor(config?: XamlExtractorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.regexExtractor = new XamlRegexExtractor();
  }

  /**
   * Check if this extractor can handle a file
   */
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.xaml');
  }

  /**
   * Extract XAML information with hybrid approach
   */
  async extract(filePath: string, content: string): Promise<XamlExtractionResult> {
    const startTime = performance.now();

    // Try DOM-based extraction first
    if (this.config.enableDomParsing) {
      try {
        const domResult = await this.extractWithDom(content, filePath);

        // If DOM extraction succeeded with good confidence, return it
        if (domResult.confidence >= this.config.minConfidenceThreshold) {
          domResult.method = 'ast';
          return domResult;
        }

        // Supplement with regex if confidence is low
        if (this.config.enableRegexFallback) {
          const regexResult = this.regexExtractor.extract(content, filePath);
          return this.mergeResults(domResult, regexResult, startTime);
        }

        return domResult;
      } catch (error) {
        // DOM parsing failed, fall back to regex
        if (this.config.enableRegexFallback) {
          const result = this.regexExtractor.extract(content, filePath);
          result.errors.push(`DOM parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return result;
        }

        // No fallback, return error result
        return this.createErrorResult(filePath, error, startTime);
      }
    }

    // DOM disabled, use regex only
    if (this.config.enableRegexFallback) {
      return this.regexExtractor.extract(content, filePath);
    }

    // Nothing enabled
    return this.createEmptyResult(filePath, startTime);
  }

  /**
   * Extract using XML DOM parsing
   */
  private async extractWithDom(content: string, filePath: string): Promise<XamlExtractionResult> {
    // Simple XML parsing without external dependencies
    // For production, consider using fast-xml-parser or similar
    const result = this.parseXamlSimple(content, filePath);

    return {
      xClass: result.xClass,
      dataContextType: result.dataContextType,
      bindings: result.bindings,
      commands: result.commands,
      resources: result.resources,
      confidence: result.confidence,
      method: 'ast',
      errors: result.errors,
    };
  }

  /**
   * Simple XAML parser using regex-based XML parsing
   * This is a lightweight alternative to full XML DOM parsing
   */
  private parseXamlSimple(content: string, filePath: string): XamlExtractionResult {
    const bindings: ExtractedBinding[] = [];
    const commands: ExtractedCommand[] = [];
    const resources: XamlResource[] = [];

    // Extract x:Class
    const xClassMatch = content.match(XAML_REGEX_PATTERNS.xClass);
    const xClass = xClassMatch?.[1] ?? null;

    // Extract DataContext type
    let dataContextType: string | null = null;

    // Try design-time DataContext first
    const designDcMatch = content.match(/d:DataContext\s*=\s*["']\{d:DesignInstance\s+(?:Type\s*=\s*)?([^,}"']+)/);
    if (designDcMatch?.[1]) {
      dataContextType = designDcMatch[1].trim();
    }

    // Parse elements and extract bindings
    this.parseElements(content, filePath, bindings, commands, resources);

    // Calculate confidence based on extraction success
    const confidence = this.calculateConfidence(content, bindings, commands, []);

    return {
      xClass,
      dataContextType,
      bindings,
      commands,
      resources,
      confidence,
      method: 'ast',
      errors: [],
    };
  }

  /**
   * Parse XAML elements and extract bindings/commands
   */
  private parseElements(
    content: string,
    filePath: string,
    bindings: ExtractedBinding[],
    commands: ExtractedCommand[],
    resources: XamlResource[]
  ): void {
    // Match elements with attributes
    const elementPattern = /<(\w+)(?:\s+[^>]*?)>/g;
    let elementMatch;

    while ((elementMatch = elementPattern.exec(content)) !== null) {
      const elementType = elementMatch[1] ?? '';
      const elementContent = elementMatch[0];
      const elementLine = this.getLineNumber(content, elementMatch.index);

      // Extract bindings from this element
      this.extractBindingsFromElement(
        elementType,
        elementContent,
        filePath,
        elementLine,
        bindings
      );

      // Extract commands from this element
      this.extractCommandsFromElement(
        elementType,
        elementContent,
        filePath,
        elementLine,
        commands
      );
    }

    // Extract resources
    this.extractResources(content, filePath, resources);
  }

  /**
   * Extract bindings from a single element
   */
  private extractBindingsFromElement(
    elementType: string,
    elementContent: string,
    filePath: string,
    elementLine: number,
    bindings: ExtractedBinding[]
  ): void {
    // Match attribute bindings
    const attrPattern = /(\w+)\s*=\s*["']\{Binding\s+([^}]*)\}["']/g;
    let attrMatch;

    while ((attrMatch = attrPattern.exec(elementContent)) !== null) {
      const property = attrMatch[1] ?? '';
      const bindingExpr = attrMatch[2] ?? '';

      // Skip Command properties (handled separately)
      if (property === 'Command' || property === 'CommandParameter') {
        continue;
      }

      const parsed = this.parseBinding(bindingExpr, property, filePath, elementLine);

      bindings.push({
        elementName: elementType,
        elementType,
        property,
        bindingExpression: `{Binding ${bindingExpr}}`,
        parsed,
        location: { file: filePath, line: elementLine },
      });
    }

    // Also match x:Bind expressions
    const xBindPattern = /(\w+)\s*=\s*["']\{x:Bind\s+([^}]*)\}["']/g;

    while ((attrMatch = xBindPattern.exec(elementContent)) !== null) {
      const property = attrMatch[1] ?? '';
      const bindingExpr = attrMatch[2] ?? '';

      const parsed = this.parseXBind(bindingExpr, property, filePath, elementLine);

      bindings.push({
        elementName: elementType,
        elementType,
        property,
        bindingExpression: `{x:Bind ${bindingExpr}}`,
        parsed,
        location: { file: filePath, line: elementLine },
      });
    }
  }

  /**
   * Extract commands from a single element
   */
  private extractCommandsFromElement(
    elementType: string,
    elementContent: string,
    filePath: string,
    elementLine: number,
    commands: ExtractedCommand[]
  ): void {
    // Match Command binding
    const commandMatch = elementContent.match(/Command\s*=\s*["']\{Binding\s+([^}]*)\}["']/);
    if (commandMatch?.[1]) {
      const bindingExpr = commandMatch[1];
      const pathMatch = bindingExpr.match(/(?:Path\s*=\s*)?([^,}\s]+)/);
      const binding = pathMatch?.[1] ?? bindingExpr;

      // Check for CommandParameter
      let parameter: string | undefined;
      const paramMatch = elementContent.match(/CommandParameter\s*=\s*["']\{Binding\s+([^}]*)\}["']/);
      if (paramMatch?.[1]) {
        const paramPath = paramMatch[1].match(/(?:Path\s*=\s*)?([^,}\s]+)/);
        parameter = paramPath?.[1];
      }

      commands.push({
        elementName: elementType,
        binding,
        parameter,
        raw: `{Binding ${bindingExpr}}`,
        location: { file: filePath, line: elementLine },
      });
    }
  }

  /**
   * Parse a Binding expression
   */
  private parseBinding(
    expr: string,
    property: string,
    filePath: string,
    line: number
  ): XamlBinding {
    // Extract path
    let path = '';
    const pathMatch = expr.match(/(?:Path\s*=\s*)?([^,}\s]+)/);
    if (pathMatch?.[1] && !pathMatch[1].includes('=')) {
      path = pathMatch[1];
    }

    // Extract mode
    let mode: BindingMode = 'Default';
    const modeMatch = expr.match(/Mode\s*=\s*(\w+)/);
    if (modeMatch?.[1]) {
      mode = this.parseMode(modeMatch[1]);
    }

    // Extract converter
    let converter: string | undefined;
    const converterMatch = expr.match(/Converter\s*=\s*\{StaticResource\s+([^}]+)\}/);
    if (converterMatch?.[1]) {
      converter = converterMatch[1].trim();
    }

    // Extract source
    const { sourceType, sourceValue } = this.extractSource(expr);

    // Extract update trigger
    let updateSourceTrigger: UpdateSourceTrigger = 'Default';
    const triggerMatch = expr.match(/UpdateSourceTrigger\s*=\s*(\w+)/);
    if (triggerMatch?.[1]) {
      updateSourceTrigger = this.parseTrigger(triggerMatch[1]);
    }

    return {
      property,
      path,
      mode,
      converter,
      sourceType,
      sourceValue,
      updateSourceTrigger,
      raw: `{Binding ${expr}}`,
      location: { file: filePath, line },
    };
  }

  /**
   * Parse an x:Bind expression
   */
  private parseXBind(
    expr: string,
    property: string,
    filePath: string,
    line: number
  ): XamlBinding {
    // x:Bind path is the first part
    const parts = expr.split(',').map(p => p.trim());
    const path = parts[0] ?? '';

    // Extract mode
    let mode: BindingMode = 'OneTime'; // x:Bind defaults to OneTime
    const modeMatch = expr.match(/Mode\s*=\s*(\w+)/);
    if (modeMatch?.[1]) {
      mode = this.parseMode(modeMatch[1]);
    }

    return {
      property,
      path,
      mode,
      sourceType: 'DataContext',
      raw: `{x:Bind ${expr}}`,
      location: { file: filePath, line },
    };
  }

  /**
   * Extract binding source type and value
   */
  private extractSource(expr: string): { sourceType?: BindingSourceType; sourceValue?: string } {
    // RelativeSource
    const relativeMatch = expr.match(/RelativeSource\s*=\s*\{RelativeSource\s+([^}]+)\}/);
    if (relativeMatch?.[1]) {
      return { sourceType: 'RelativeSource', sourceValue: relativeMatch[1].trim() };
    }

    // ElementName
    const elementMatch = expr.match(/ElementName\s*=\s*(\w+)/);
    if (elementMatch?.[1]) {
      return { sourceType: 'ElementName', sourceValue: elementMatch[1] };
    }

    // Source={StaticResource}
    const staticMatch = expr.match(/Source\s*=\s*\{StaticResource\s+([^}]+)\}/);
    if (staticMatch?.[1]) {
      return { sourceType: 'StaticResource', sourceValue: staticMatch[1].trim() };
    }

    return { sourceType: 'DataContext' };
  }

  /**
   * Extract resources from XAML
   */
  private extractResources(
    content: string,
    filePath: string,
    resources: XamlResource[]
  ): void {
    // Styles
    const stylePattern = /<Style\s+(?:[^>]*\s+)?x:Key\s*=\s*["']([^"']+)["'](?:\s+TargetType\s*=\s*["']\{?x:Type\s+)?([^}"']+)?/g;
    let match;

    while ((match = stylePattern.exec(content)) !== null) {
      resources.push({
        key: match[1] ?? '',
        type: 'Style',
        targetType: match[2]?.replace(/[}"']/g, '').trim(),
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // DataTemplates
    const templatePattern = /<DataTemplate\s+(?:[^>]*\s+)?x:Key\s*=\s*["']([^"']+)["']/g;

    while ((match = templatePattern.exec(content)) !== null) {
      resources.push({
        key: match[1] ?? '',
        type: 'DataTemplate',
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }

    // Converters
    const converterPattern = /<(\w+:)?(\w+Converter)\s+x:Key\s*=\s*["']([^"']+)["']/g;

    while ((match = converterPattern.exec(content)) !== null) {
      resources.push({
        key: match[3] ?? '',
        type: 'Converter',
        converterType: match[2],
        location: { file: filePath, line: this.getLineNumber(content, match.index) },
      });
    }
  }

  /**
   * Parse binding mode
   */
  private parseMode(mode: string): BindingMode {
    switch (mode.toLowerCase()) {
      case 'oneway': return 'OneWay';
      case 'twoway': return 'TwoWay';
      case 'onetime': return 'OneTime';
      case 'onewaytosource': return 'OneWayToSource';
      default: return 'Default';
    }
  }

  /**
   * Parse update source trigger
   */
  private parseTrigger(trigger: string): UpdateSourceTrigger {
    switch (trigger.toLowerCase()) {
      case 'propertychanged': return 'PropertyChanged';
      case 'lostfocus': return 'LostFocus';
      case 'explicit': return 'Explicit';
      default: return 'Default';
    }
  }

  /**
   * Calculate extraction confidence
   */
  private calculateConfidence(
    content: string,
    bindings: ExtractedBinding[],
    commands: ExtractedCommand[],
    errors: string[]
  ): number {
    if (errors.length > 0) {
      return 0.5;
    }

    // Count expected bindings using simple regex
    const expectedBindings = (content.match(/\{Binding\s+/g) ?? []).length;
    const expectedCommands = (content.match(/Command\s*=\s*["']\{Binding/g) ?? []).length;

    if (expectedBindings === 0 && expectedCommands === 0) {
      return 0.9; // No bindings expected, high confidence
    }

    const bindingCoverage = expectedBindings > 0 
      ? Math.min(1, bindings.length / expectedBindings)
      : 1;
    const commandCoverage = expectedCommands > 0
      ? Math.min(1, commands.length / expectedCommands)
      : 1;

    return (bindingCoverage + commandCoverage) / 2 * 0.9;
  }

  /**
   * Merge DOM and regex results
   */
  private mergeResults(
    domResult: XamlExtractionResult,
    regexResult: XamlExtractionResult,
    _startTime: number
  ): XamlExtractionResult {
    // Use DOM result as base, supplement with regex
    const merged: XamlExtractionResult = {
      xClass: domResult.xClass ?? regexResult.xClass,
      dataContextType: domResult.dataContextType ?? regexResult.dataContextType,
      bindings: [...domResult.bindings],
      commands: [...domResult.commands],
      resources: [...domResult.resources],
      confidence: Math.max(domResult.confidence, regexResult.confidence),
      method: 'hybrid',
      errors: [...domResult.errors],
    };

    // Add unique bindings from regex
    const seenBindings = new Set(
      merged.bindings.map(b => `${b.property}:${b.location.line}`)
    );
    for (const binding of regexResult.bindings) {
      const key = `${binding.property}:${binding.location.line}`;
      if (!seenBindings.has(key)) {
        merged.bindings.push(binding);
      }
    }

    // Add unique commands from regex
    const seenCommands = new Set(
      merged.commands.map(c => `${c.binding}:${c.location.line}`)
    );
    for (const command of regexResult.commands) {
      const key = `${command.binding}:${command.location.line}`;
      if (!seenCommands.has(key)) {
        merged.commands.push(command);
      }
    }

    return merged;
  }

  /**
   * Create error result
   */
  private createErrorResult(
    _filePath: string,
    error: unknown,
    _startTime: number
  ): XamlExtractionResult {
    return {
      xClass: null,
      dataContextType: null,
      bindings: [],
      commands: [],
      resources: [],
      confidence: 0,
      method: 'ast',
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }

  /**
   * Create empty result
   */
  private createEmptyResult(_filePath: string, _startTime: number): XamlExtractionResult {
    return {
      xClass: null,
      dataContextType: null,
      bindings: [],
      commands: [],
      resources: [],
      confidence: 0,
      method: 'ast',
      errors: ['No extraction method enabled'],
    };
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
export function createXamlHybridExtractor(config?: XamlExtractorConfig): XamlHybridExtractor {
  return new XamlHybridExtractor(config);
}
