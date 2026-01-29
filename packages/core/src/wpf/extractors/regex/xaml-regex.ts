/**
 * XAML Regex Extractor
 *
 * Regex-based fallback extractor for XAML files when XML DOM parsing fails.
 * Follows Drift's hybrid extraction pattern: AST first, regex fallback.
 */

import type {
  XamlExtractionResult,
  ExtractedBinding,
  ExtractedCommand,
  XamlResource,
  XamlBinding,
  BindingMode,
  BindingSourceType,
  UpdateSourceTrigger,
} from '../../types.js';

// ============================================================================
// Regex Patterns
// ============================================================================

export const XAML_REGEX_PATTERNS = {
  // x:Class declaration
  xClass: /x:Class\s*=\s*["']([^"']+)["']/,

  // Standard bindings: {Binding Path=Name} or {Binding Name}
  binding: /\{Binding\s+(?:Path\s*=\s*)?["']?([^,}"'\s]+)["']?(?:[^}]*)?\}/g,

  // Binding with full details
  bindingFull: /(\w+)\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // x:Bind expressions (compiled bindings)
  xBind: /\{x:Bind\s+([^,}]+)(?:,\s*Mode\s*=\s*(\w+))?[^}]*\}/g,

  // Command bindings
  command: /Command\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // CommandParameter bindings
  commandParameter: /CommandParameter\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // DataContext assignments
  dataContext: /DataContext\s*=\s*["']\{([^}]+)\}["']/g,

  // Design-time DataContext
  designDataContext: /d:DataContext\s*=\s*["']\{d:DesignInstance\s+(?:Type\s*=\s*)?([^,}"']+)/g,

  // StaticResource references
  staticResource: /\{StaticResource\s+([^}]+)\}/g,

  // DynamicResource references
  dynamicResource: /\{DynamicResource\s+([^}]+)\}/g,

  // x:Name declarations
  xName: /x:Name\s*=\s*["']([^"']+)["']/g,

  // Event handlers in XAML
  eventHandler: /(\w+)\s*=\s*["']([A-Z]\w+_\w+)["']/g,

  // Converter references
  converter: /Converter\s*=\s*\{StaticResource\s+([^}]+)\}/g,

  // ItemsSource bindings
  itemsSource: /ItemsSource\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // SelectedItem bindings
  selectedItem: /SelectedItem\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // Style definitions
  style: /<Style\s+(?:[^>]*\s+)?x:Key\s*=\s*["']([^"']+)["'](?:\s+TargetType\s*=\s*["']\{?x:Type\s+)?([^}"']+)?/g,

  // DataTemplate definitions
  dataTemplate: /<DataTemplate\s+(?:[^>]*\s+)?x:Key\s*=\s*["']([^"']+)["'](?:\s+DataType\s*=\s*["']\{?x:Type\s+)?([^}"']+)?/g,

  // Converter definitions
  converterDef: /<(\w+:)?(\w+Converter)\s+x:Key\s*=\s*["']([^"']+)["']/g,

  // Element with binding (captures element type)
  elementWithBinding: /<(\w+)(?:\s+[^>]*?)(\w+)\s*=\s*["']\{Binding\s+([^}]+)\}["']/g,

  // Mode extraction from binding
  bindingMode: /Mode\s*=\s*(\w+)/,

  // UpdateSourceTrigger extraction
  updateSourceTrigger: /UpdateSourceTrigger\s*=\s*(\w+)/,

  // FallbackValue extraction
  fallbackValue: /FallbackValue\s*=\s*([^,}]+)/,

  // TargetNullValue extraction
  targetNullValue: /TargetNullValue\s*=\s*([^,}]+)/,

  // RelativeSource extraction
  relativeSource: /RelativeSource\s*=\s*\{RelativeSource\s+([^}]+)\}/,

  // ElementName extraction
  elementName: /ElementName\s*=\s*(\w+)/,
};

// ============================================================================
// XAML Regex Extractor
// ============================================================================

export class XamlRegexExtractor {
  /**
   * Extract XAML information using regex patterns
   */
  extract(content: string, filePath: string): XamlExtractionResult {
    const bindings: ExtractedBinding[] = [];
    const commands: ExtractedCommand[] = [];
    const resources: XamlResource[] = [];
    const errors: string[] = [];

    try {
      // Extract x:Class
      const xClassMatch = content.match(XAML_REGEX_PATTERNS.xClass);
      const xClass = xClassMatch ? xClassMatch[1] ?? null : null;

      // Extract DataContext type
      const dataContextType = this.extractDataContextType(content);

      // Extract all bindings
      this.extractBindings(content, filePath, bindings);

      // Extract commands
      this.extractCommands(content, filePath, commands);

      // Extract resources
      this.extractResources(content, filePath, resources);

      return {
        xClass,
        dataContextType,
        bindings,
        commands,
        resources,
        confidence: 0.6, // Regex has lower confidence than AST
        method: 'regex',
        errors,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown extraction error');
      return {
        xClass: null,
        dataContextType: null,
        bindings,
        commands,
        resources,
        confidence: 0.3,
        method: 'regex',
        errors,
      };
    }
  }

  /**
   * Extract DataContext type from various sources
   */
  private extractDataContextType(content: string): string | null {
    // Try design-time DataContext first (most reliable)
    const designMatch = XAML_REGEX_PATTERNS.designDataContext.exec(content);
    if (designMatch?.[1]) {
      return designMatch[1].trim();
    }

    // Try explicit DataContext binding
    const dcMatch = XAML_REGEX_PATTERNS.dataContext.exec(content);
    if (dcMatch?.[1]) {
      // Parse the binding to extract type if possible
      const binding = dcMatch[1];
      const sourceMatch = binding.match(/Source\s*=\s*\{StaticResource\s+(\w+)\}/);
      if (sourceMatch?.[1]) {
        return sourceMatch[1];
      }
    }

    return null;
  }

  /**
   * Extract all bindings from XAML content
   */
  private extractBindings(
    content: string,
    filePath: string,
    bindings: ExtractedBinding[]
  ): void {
    // Reset regex lastIndex
    XAML_REGEX_PATTERNS.elementWithBinding.lastIndex = 0;

    let match;
    while ((match = XAML_REGEX_PATTERNS.elementWithBinding.exec(content)) !== null) {
      const elementType = match[1] ?? 'Unknown';
      const property = match[2] ?? '';
      const bindingExpr = match[3] ?? '';
      const line = this.getLineNumber(content, match.index);

      const parsed = this.parseBindingExpression(bindingExpr, property, filePath, line);

      bindings.push({
        elementName: elementType,
        elementType,
        property,
        bindingExpression: `{Binding ${bindingExpr}}`,
        parsed,
        location: { file: filePath, line },
      });
    }

    // Also extract bindings using simpler pattern for edge cases
    XAML_REGEX_PATTERNS.bindingFull.lastIndex = 0;
    const seen = new Set(bindings.map(b => `${b.property}:${b.location.line}`));

    while ((match = XAML_REGEX_PATTERNS.bindingFull.exec(content)) !== null) {
      const property = match[1] ?? '';
      const bindingExpr = match[2] ?? '';
      const line = this.getLineNumber(content, match.index);
      const key = `${property}:${line}`;

      if (seen.has(key)) {continue;}
      seen.add(key);

      const parsed = this.parseBindingExpression(bindingExpr, property, filePath, line);

      bindings.push({
        elementName: 'Unknown',
        elementType: 'Unknown',
        property,
        bindingExpression: `{Binding ${bindingExpr}}`,
        parsed,
        location: { file: filePath, line },
      });
    }
  }

  /**
   * Parse a binding expression into structured data
   */
  private parseBindingExpression(
    expr: string,
    property: string,
    filePath: string,
    line: number
  ): XamlBinding {
    // Extract path (first part or Path= value)
    let path = '';
    const pathMatch = expr.match(/(?:Path\s*=\s*)?([^,}\s]+)/);
    if (pathMatch?.[1] && !pathMatch[1].includes('=')) {
      path = pathMatch[1];
    }

    // Extract mode
    let mode: BindingMode = 'Default';
    const modeMatch = expr.match(XAML_REGEX_PATTERNS.bindingMode);
    if (modeMatch?.[1]) {
      mode = this.parseBindingMode(modeMatch[1]);
    }

    // Extract converter
    let converter: string | undefined;
    const converterMatch = expr.match(/Converter\s*=\s*\{StaticResource\s+([^}]+)\}/);
    if (converterMatch?.[1]) {
      converter = converterMatch[1].trim();
    }

    // Extract source type
    const { sourceType, sourceValue } = this.extractBindingSource(expr);

    // Extract update trigger
    let updateSourceTrigger: UpdateSourceTrigger = 'Default';
    const triggerMatch = expr.match(XAML_REGEX_PATTERNS.updateSourceTrigger);
    if (triggerMatch?.[1]) {
      updateSourceTrigger = this.parseUpdateTrigger(triggerMatch[1]);
    }

    // Extract fallback value
    let fallbackValue: string | undefined;
    const fallbackMatch = expr.match(XAML_REGEX_PATTERNS.fallbackValue);
    if (fallbackMatch?.[1]) {
      fallbackValue = fallbackMatch[1].trim();
    }

    return {
      property,
      path,
      mode,
      converter,
      sourceType,
      sourceValue,
      updateSourceTrigger,
      fallbackValue,
      raw: `{Binding ${expr}}`,
      location: { file: filePath, line },
    };
  }

  /**
   * Extract binding source type and value
   */
  private extractBindingSource(expr: string): { sourceType?: BindingSourceType; sourceValue?: string } {
    // Check for RelativeSource
    const relativeMatch = expr.match(XAML_REGEX_PATTERNS.relativeSource);
    if (relativeMatch?.[1]) {
      return { sourceType: 'RelativeSource', sourceValue: relativeMatch[1].trim() };
    }

    // Check for ElementName
    const elementMatch = expr.match(XAML_REGEX_PATTERNS.elementName);
    if (elementMatch?.[1]) {
      return { sourceType: 'ElementName', sourceValue: elementMatch[1] };
    }

    // Check for Source={StaticResource}
    const staticMatch = expr.match(/Source\s*=\s*\{StaticResource\s+([^}]+)\}/);
    if (staticMatch?.[1]) {
      return { sourceType: 'StaticResource', sourceValue: staticMatch[1].trim() };
    }

    return { sourceType: 'DataContext' };
  }

  /**
   * Parse binding mode string
   */
  private parseBindingMode(mode: string): BindingMode {
    switch (mode.toLowerCase()) {
      case 'oneway': return 'OneWay';
      case 'twoway': return 'TwoWay';
      case 'onetime': return 'OneTime';
      case 'onewaytosource': return 'OneWayToSource';
      default: return 'Default';
    }
  }

  /**
   * Parse update source trigger string
   */
  private parseUpdateTrigger(trigger: string): UpdateSourceTrigger {
    switch (trigger.toLowerCase()) {
      case 'propertychanged': return 'PropertyChanged';
      case 'lostfocus': return 'LostFocus';
      case 'explicit': return 'Explicit';
      default: return 'Default';
    }
  }

  /**
   * Extract commands from XAML content
   */
  private extractCommands(
    content: string,
    filePath: string,
    commands: ExtractedCommand[]
  ): void {
    XAML_REGEX_PATTERNS.command.lastIndex = 0;

    let match;
    while ((match = XAML_REGEX_PATTERNS.command.exec(content)) !== null) {
      const bindingExpr = match[1] ?? '';
      const line = this.getLineNumber(content, match.index);

      // Extract command path
      const pathMatch = bindingExpr.match(/(?:Path\s*=\s*)?([^,}\s]+)/);
      const binding = pathMatch?.[1] ?? bindingExpr;

      // Look for CommandParameter nearby
      const contextStart = Math.max(0, match.index - 200);
      const contextEnd = Math.min(content.length, match.index + 200);
      const context = content.slice(contextStart, contextEnd);
      
      let parameter: string | undefined;
      const paramMatch = context.match(/CommandParameter\s*=\s*["']\{Binding\s+([^}]+)\}["']/);
      if (paramMatch?.[1]) {
        const paramPath = paramMatch[1].match(/(?:Path\s*=\s*)?([^,}\s]+)/);
        parameter = paramPath?.[1];
      }

      commands.push({
        elementName: 'Unknown',
        binding,
        parameter,
        raw: `{Binding ${bindingExpr}}`,
        location: { file: filePath, line },
      });
    }
  }

  /**
   * Extract resources from XAML content
   */
  private extractResources(
    content: string,
    filePath: string,
    resources: XamlResource[]
  ): void {
    // Extract styles
    XAML_REGEX_PATTERNS.style.lastIndex = 0;
    let match;

    while ((match = XAML_REGEX_PATTERNS.style.exec(content)) !== null) {
      const key = match[1] ?? '';
      const targetType = match[2]?.replace(/[}"']/g, '').trim();
      const line = this.getLineNumber(content, match.index);

      resources.push({
        key,
        type: 'Style',
        targetType,
        location: { file: filePath, line },
      });
    }

    // Extract data templates
    XAML_REGEX_PATTERNS.dataTemplate.lastIndex = 0;

    while ((match = XAML_REGEX_PATTERNS.dataTemplate.exec(content)) !== null) {
      const key = match[1] ?? '';
      const targetType = match[2]?.replace(/[}"']/g, '').trim();
      const line = this.getLineNumber(content, match.index);

      resources.push({
        key,
        type: 'DataTemplate',
        targetType,
        location: { file: filePath, line },
      });
    }

    // Extract converters
    XAML_REGEX_PATTERNS.converterDef.lastIndex = 0;

    while ((match = XAML_REGEX_PATTERNS.converterDef.exec(content)) !== null) {
      const converterType = match[2] ?? '';
      const key = match[3] ?? '';
      const line = this.getLineNumber(content, match.index);

      resources.push({
        key,
        type: 'Converter',
        converterType,
        location: { file: filePath, line },
      });
    }
  }

  /**
   * Get line number from character index
   */
  private getLineNumber(content: string, index: number): number {
    const lines = content.slice(0, index).split('\n');
    return lines.length;
  }
}
