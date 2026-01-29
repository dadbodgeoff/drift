/**
 * CSS Parser - CSS/SCSS/SASS/LESS parsing for AST extraction
 *
 * Extracts selectors, properties, values, @rules, and CSS variables
 * from CSS-like files using regex-based parsing.
 *
 * @requirements 3.2
 */

import { BaseParser } from './base-parser.js';

import type { AST, ASTNode, Language, ParseResult, Position } from './types.js';

/**
 * Types of CSS selectors
 */
export type SelectorType = 'class' | 'id' | 'element' | 'pseudo-class' | 'pseudo-element' | 'attribute' | 'universal' | 'combinator';

/**
 * Information about a CSS selector
 */
export interface CSSSelectorInfo {
  /** The full selector text */
  selector: string;
  /** Type of selector */
  type: SelectorType;
  /** Individual selector parts (for compound selectors) */
  parts: SelectorPart[];
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * A single part of a compound selector
 */
export interface SelectorPart {
  /** The selector text */
  text: string;
  /** Type of this part */
  type: SelectorType;
}

/**
 * Information about a CSS property declaration
 */
export interface CSSPropertyInfo {
  /** Property name */
  name: string;
  /** Property value */
  value: string;
  /** Whether this is a CSS variable (custom property) */
  isVariable: boolean;
  /** Whether this property uses !important */
  isImportant: boolean;
  /** Parent selector */
  parentSelector: string;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a CSS @rule
 */
export interface CSSAtRuleInfo {
  /** Rule name (e.g., 'media', 'import', 'keyframes') */
  name: string;
  /** Rule parameters/condition */
  params: string;
  /** Whether this rule has a block body */
  hasBlock: boolean;
  /** Nested rules (for @media, @supports, etc.) */
  nestedRules: CSSRuleInfo[];
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a CSS rule (selector + declarations)
 */
export interface CSSRuleInfo {
  /** Selectors for this rule */
  selectors: string[];
  /** Properties in this rule */
  properties: CSSPropertyInfo[];
  /** Nested rules (for SCSS/LESS) */
  nestedRules: CSSRuleInfo[];
  /** Parent selector (for nested rules) */
  parentSelector: string | null;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Information about a CSS variable (custom property)
 */
export interface CSSVariableInfo {
  /** Variable name (including --) */
  name: string;
  /** Variable value */
  value: string;
  /** Scope selector where defined */
  scope: string;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
}

/**
 * Extended parse result with CSS-specific information
 */
export interface CSSParseResult extends ParseResult {
  /** Extracted selectors */
  selectors: CSSSelectorInfo[];
  /** Extracted properties */
  properties: CSSPropertyInfo[];
  /** Extracted @rules */
  atRules: CSSAtRuleInfo[];
  /** Extracted CSS variables */
  variables: CSSVariableInfo[];
  /** Extracted rules (selector + declarations) */
  rules: CSSRuleInfo[];
}

/**
 * CSS/SCSS/SASS/LESS parser using regex-based parsing.
 *
 * Provides AST parsing and extraction of selectors, properties,
 * values, @rules, and CSS variables from CSS-like source files.
 *
 * @requirements 3.2 - Support CSS/SCSS parsing
 * @requirements 3.3 - Graceful degradation on parse errors
 */
export class CSSParser extends BaseParser {
  readonly language: Language = 'css';
  readonly extensions: string[] = ['.css', '.scss', '.sass', '.less'];

  /**
   * Parse CSS source code into an AST.
   *
   * @param source - The source code to parse
   * @param filePath - Optional file path for error reporting
   * @returns CSSParseResult containing the AST and extracted information
   *
   * @requirements 3.2, 3.3
   */
  parse(source: string, _filePath?: string): CSSParseResult {
    try {
      const lines = source.split('\n');
      const rootChildren: ASTNode[] = [];

      // Extract semantic information
      const atRules = this.extractAtRules(source, lines);
      const rules = this.extractRules(source, lines);
      const selectors = this.extractSelectors(rules);
      const properties = this.extractAllProperties(rules);
      const variables = this.extractVariables(source, lines);

      // Build AST nodes for @rules
      for (const atRule of atRules) {
        const atRuleNode = this.createAtRuleNode(atRule, source);
        rootChildren.push(atRuleNode);
      }

      // Build AST nodes for rules
      for (const rule of rules) {
        const ruleNode = this.createRuleNode(rule, source);
        rootChildren.push(ruleNode);
      }

      // Create root node
      const endPosition = lines.length > 0
        ? { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 }
        : { row: 0, column: 0 };

      const rootNode = this.createNode(
        'StyleSheet',
        source,
        { row: 0, column: 0 },
        endPosition,
        rootChildren
      );

      const ast = this.createAST(rootNode, source);

      return {
        ...this.createSuccessResult(ast),
        selectors,
        properties,
        atRules,
        variables,
        rules,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown parse error';
      return {
        ...this.createFailureResult([this.createError(errorMessage, { row: 0, column: 0 })]),
        selectors: [],
        properties: [],
        atRules: [],
        variables: [],
        rules: [],
      };
    }
  }

  /**
   * Query the AST for nodes matching a pattern.
   *
   * Supports querying by node type (e.g., 'Rule', 'AtRule', 'Declaration').
   *
   * @param ast - The AST to query
   * @param pattern - The node type to search for
   * @returns Array of matching AST nodes
   *
   * @requirements 3.5
   */
  query(ast: AST, pattern: string): ASTNode[] {
    return this.findNodesByType(ast, pattern);
  }

  // ============================================
  // @Rule Extraction
  // ============================================

  /**
   * Extract all @rules from CSS source.
   */
  private extractAtRules(source: string, _lines: string[]): CSSAtRuleInfo[] {
    const atRules: CSSAtRuleInfo[] = [];
    
    // Match @rules: @import, @media, @keyframes, @font-face, @charset, @supports, etc.
    // This regex matches @rule-name followed by params and optionally a block
    const atRuleRegex = /@([\w-]+)\s*([^{;]*?)(?:\{([^}]*(?:\{[^}]*\}[^}]*)*)\}|;)/g;
    let match: RegExpExecArray | null;

    while ((match = atRuleRegex.exec(source)) !== null) {
      const lineStart = this.getLineNumber(source, match.index);
      const name = match[1] ?? '';
      const params = (match[2] ?? '').trim();
      const blockContent = match[3];
      const hasBlock = blockContent !== undefined;

      const endOffset = match.index + (match[0]?.length ?? 0);
      const lineEnd = this.getLineNumber(source, endOffset);

      // Parse nested rules if this is a block @rule
      const nestedRules: CSSRuleInfo[] = [];
      if (hasBlock && blockContent) {
        const nestedSource = blockContent;
        const nestedLines = nestedSource.split('\n');
        nestedRules.push(...this.extractRules(nestedSource, nestedLines));
      }

      atRules.push({
        name,
        params,
        hasBlock,
        nestedRules,
        startPosition: { row: lineStart, column: this.getColumnNumber(source, match.index) },
        endPosition: { row: lineEnd, column: this.getColumnNumber(source, endOffset) },
      });
    }

    return atRules;
  }

  // ============================================
  // Rule Extraction
  // ============================================

  /**
   * Extract all CSS rules (selector + declarations) from source.
   */
  private extractRules(source: string, _lines: string[]): CSSRuleInfo[] {
    const rules: CSSRuleInfo[] = [];
    
    // Remove comments first
    const sourceWithoutComments = this.removeComments(source);
    
    // Remove @rules to avoid matching their content as regular rules
    const sourceWithoutAtRules = this.removeAtRules(sourceWithoutComments);
    
    // Match CSS rules: selector(s) { declarations }
    // This handles multi-line selectors and nested rules
    const ruleRegex = /([^{}@]+?)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = ruleRegex.exec(sourceWithoutAtRules)) !== null) {
      const selectorText = (match[1] ?? '').trim();
      const declarationsText = match[2] ?? '';
      
      // Skip if selector is empty or looks like a comment
      if (!selectorText || selectorText.startsWith('/*') || selectorText.startsWith('//')) {
        continue;
      }

      const lineStart = this.getLineNumber(source, match.index);
      const endOffset = match.index + (match[0]?.length ?? 0);
      const lineEnd = this.getLineNumber(source, endOffset);

      // Parse selectors (comma-separated)
      const selectors = this.parseSelectors(selectorText);
      
      // Parse properties
      const properties = this.parseDeclarations(declarationsText, selectorText, lineStart);
      
      // Parse nested rules (for SCSS/LESS)
      const nestedRules = this.parseNestedRules(declarationsText, selectorText, lineStart);

      rules.push({
        selectors,
        properties,
        nestedRules,
        parentSelector: null,
        startPosition: { row: lineStart, column: this.getColumnNumber(source, match.index) },
        endPosition: { row: lineEnd, column: this.getColumnNumber(source, endOffset) },
      });
    }

    return rules;
  }

  /**
   * Remove @rules from source to avoid matching their content as regular rules.
   */
  private removeAtRules(source: string): string {
    // Remove @rules with blocks
    let result = source.replace(/@[\w-]+\s*[^{;]*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '');
    // Remove @rules without blocks (like @import, @charset)
    result = result.replace(/@[\w-]+\s*[^{;]*;/g, '');
    return result;
  }

  /**
   * Remove CSS comments from source.
   */
  private removeComments(source: string): string {
    // Remove block comments /* ... */
    let result = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line comments // ... (SCSS/LESS style)
    result = result.replace(/\/\/[^\n]*/g, '');
    return result;
  }

  /**
   * Parse comma-separated selectors.
   */
  private parseSelectors(selectorText: string): string[] {
    return selectorText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('/*'));
  }

  /**
   * Parse CSS declarations (property: value pairs).
   */
  private parseDeclarations(
    declarationsText: string,
    parentSelector: string,
    baseLineNumber: number
  ): CSSPropertyInfo[] {
    const properties: CSSPropertyInfo[] = [];
    
    // Remove nested rules first
    const cleanDeclarations = declarationsText.replace(/[^{}]+\{[^{}]*\}/g, '');
    
    // Match property: value pairs
    const declarationRegex = /([\w-]+)\s*:\s*([^;{}]+?)(?:\s*(!important))?\s*(?:;|$)/g;
    let match: RegExpExecArray | null;

    while ((match = declarationRegex.exec(cleanDeclarations)) !== null) {
      const name = match[1] ?? '';
      const value = (match[2] ?? '').trim();
      const isImportant = !!match[3];
      const isVariable = name.startsWith('--');

      const lineOffset = this.getLineNumber(cleanDeclarations, match.index);
      const lineNumber = baseLineNumber + lineOffset;

      properties.push({
        name,
        value,
        isVariable,
        isImportant,
        parentSelector,
        startPosition: { row: lineNumber, column: 0 },
        endPosition: { row: lineNumber, column: (match[0]?.length ?? 0) },
      });
    }

    return properties;
  }

  /**
   * Parse nested rules (for SCSS/LESS).
   */
  private parseNestedRules(
    declarationsText: string,
    parentSelector: string,
    baseLineNumber: number
  ): CSSRuleInfo[] {
    const nestedRules: CSSRuleInfo[] = [];
    
    // Match nested rules: selector { declarations }
    const nestedRuleRegex = /([&\w\s.#:\[\]="-]+?)\s*\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;

    while ((match = nestedRuleRegex.exec(declarationsText)) !== null) {
      const nestedSelectorText = (match[1] ?? '').trim();
      const nestedDeclarationsText = match[2] ?? '';
      
      // Skip if it looks like a property value with braces
      if (!nestedSelectorText || /^[\w-]+$/.test(nestedSelectorText)) {
        continue;
      }

      const lineOffset = this.getLineNumber(declarationsText, match.index);
      const lineNumber = baseLineNumber + lineOffset;

      // Resolve nested selector (replace & with parent)
      const resolvedSelectors = this.resolveNestedSelectors(nestedSelectorText, parentSelector);
      
      // Parse nested properties
      const properties = this.parseDeclarations(nestedDeclarationsText, resolvedSelectors[0] ?? '', lineNumber);

      nestedRules.push({
        selectors: resolvedSelectors,
        properties,
        nestedRules: [],
        parentSelector,
        startPosition: { row: lineNumber, column: 0 },
        endPosition: { row: lineNumber + this.getLineNumber(nestedDeclarationsText, nestedDeclarationsText.length), column: 0 },
      });
    }

    return nestedRules;
  }

  /**
   * Resolve nested selectors by replacing & with parent selector.
   */
  private resolveNestedSelectors(nestedSelector: string, parentSelector: string): string[] {
    const selectors = this.parseSelectors(nestedSelector);
    
    return selectors.map(selector => {
      if (selector.includes('&')) {
        return selector.replace(/&/g, parentSelector);
      }
      // If no &, prepend parent selector
      return `${parentSelector} ${selector}`;
    });
  }

  // ============================================
  // Selector Extraction
  // ============================================

  /**
   * Extract all selectors from parsed rules.
   */
  private extractSelectors(rules: CSSRuleInfo[]): CSSSelectorInfo[] {
    const selectors: CSSSelectorInfo[] = [];

    for (const rule of rules) {
      for (const selector of rule.selectors) {
        const parts = this.parseSelectorParts(selector);
        const primaryType = this.determinePrimarySelectorType(parts);

        selectors.push({
          selector,
          type: primaryType,
          parts,
          startPosition: rule.startPosition,
          endPosition: rule.endPosition,
        });
      }

      // Also extract from nested rules
      for (const nestedRule of rule.nestedRules) {
        for (const selector of nestedRule.selectors) {
          const parts = this.parseSelectorParts(selector);
          const primaryType = this.determinePrimarySelectorType(parts);

          selectors.push({
            selector,
            type: primaryType,
            parts,
            startPosition: nestedRule.startPosition,
            endPosition: nestedRule.endPosition,
          });
        }
      }
    }

    return selectors;
  }

  /**
   * Parse a selector into its component parts.
   */
  private parseSelectorParts(selector: string): SelectorPart[] {
    const parts: SelectorPart[] = [];
    
    // Match different selector types
    const patterns: Array<{ regex: RegExp; type: SelectorType }> = [
      { regex: /::[\w-]+/g, type: 'pseudo-element' },
      { regex: /:[\w-]+(?:\([^)]*\))?/g, type: 'pseudo-class' },
      { regex: /\[[\w-]+(?:[~|^$*]?=["']?[^"'\]]*["']?)?\]/g, type: 'attribute' },
      { regex: /#[\w-]+/g, type: 'id' },
      { regex: /\.[\w-]+/g, type: 'class' },
      { regex: /\*/g, type: 'universal' },
      { regex: /[>+~\s]+/g, type: 'combinator' },
    ];

    // First, extract all special selectors
    let remaining = selector;
    
    for (const { regex, type } of patterns) {
      let match: RegExpExecArray | null;
      const localRegex = new RegExp(regex.source, 'g');
      
      while ((match = localRegex.exec(selector)) !== null) {
        const text = match[0].trim();
        if (text && type !== 'combinator') {
          parts.push({ text, type });
        }
      }
      
      // Remove matched parts from remaining
      remaining = remaining.replace(regex, ' ');
    }

    // What's left should be element selectors
    const elementParts = remaining.trim().split(/\s+/).filter(p => p && /^[\w-]+$/.test(p));
    for (const element of elementParts) {
      parts.push({ text: element, type: 'element' });
    }

    return parts;
  }

  /**
   * Determine the primary selector type from parts.
   */
  private determinePrimarySelectorType(parts: SelectorPart[]): SelectorType {
    // Priority: id > class > element > pseudo-class > pseudo-element > attribute > universal
    const priority: SelectorType[] = ['id', 'class', 'element', 'pseudo-class', 'pseudo-element', 'attribute', 'universal'];
    
    for (const type of priority) {
      if (parts.some(p => p.type === type)) {
        return type;
      }
    }
    
    return 'element';
  }

  // ============================================
  // Property Extraction
  // ============================================

  /**
   * Extract all properties from parsed rules.
   */
  private extractAllProperties(rules: CSSRuleInfo[]): CSSPropertyInfo[] {
    const properties: CSSPropertyInfo[] = [];

    for (const rule of rules) {
      properties.push(...rule.properties);
      
      // Also extract from nested rules
      for (const nestedRule of rule.nestedRules) {
        properties.push(...nestedRule.properties);
      }
    }

    return properties;
  }

  // ============================================
  // CSS Variable Extraction
  // ============================================

  /**
   * Extract all CSS variables (custom properties) from source.
   */
  private extractVariables(source: string, _lines: string[]): CSSVariableInfo[] {
    const variables: CSSVariableInfo[] = [];
    
    // Match CSS variable declarations: --variable-name: value;
    // We need to find them within rule blocks
    const ruleRegex = /([^{}]+?)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let ruleMatch: RegExpExecArray | null;

    while ((ruleMatch = ruleRegex.exec(source)) !== null) {
      const scope = (ruleMatch[1] ?? '').trim();
      const declarations = ruleMatch[2] ?? '';
      const ruleLineStart = this.getLineNumber(source, ruleMatch.index);

      // Find variable declarations within this rule
      const varRegex = /(--[\w-]+)\s*:\s*([^;{}]+?)\s*;/g;
      let varMatch: RegExpExecArray | null;

      while ((varMatch = varRegex.exec(declarations)) !== null) {
        const name = varMatch[1] ?? '';
        const value = (varMatch[2] ?? '').trim();
        const lineOffset = this.getLineNumber(declarations, varMatch.index);
        const lineNumber = ruleLineStart + lineOffset;

        variables.push({
          name,
          value,
          scope,
          startPosition: { row: lineNumber, column: 0 },
          endPosition: { row: lineNumber, column: (varMatch[0]?.length ?? 0) },
        });
      }
    }

    return variables;
  }

  // ============================================
  // AST Node Creation
  // ============================================

  /**
   * Create an AST node for an @rule.
   */
  private createAtRuleNode(atRule: CSSAtRuleInfo, _source: string): ASTNode {
    const children: ASTNode[] = [];

    // Add params node if present
    if (atRule.params) {
      children.push(
        this.createNode(
          'AtRuleParams',
          atRule.params,
          atRule.startPosition,
          atRule.endPosition,
          []
        )
      );
    }

    // Add nested rule nodes
    for (const nestedRule of atRule.nestedRules) {
      children.push(this.createRuleNode(nestedRule, ''));
    }

    return this.createNode(
      'AtRule',
      `@${atRule.name}`,
      atRule.startPosition,
      atRule.endPosition,
      children
    );
  }

  /**
   * Create an AST node for a CSS rule.
   */
  private createRuleNode(rule: CSSRuleInfo, _source: string): ASTNode {
    const children: ASTNode[] = [];

    // Add selector nodes
    for (const selector of rule.selectors) {
      children.push(
        this.createNode(
          'Selector',
          selector,
          rule.startPosition,
          rule.endPosition,
          []
        )
      );
    }

    // Add declaration nodes
    for (const prop of rule.properties) {
      children.push(
        this.createNode(
          'Declaration',
          `${prop.name}: ${prop.value}`,
          prop.startPosition,
          prop.endPosition,
          []
        )
      );
    }

    // Add nested rule nodes
    for (const nestedRule of rule.nestedRules) {
      children.push(this.createRuleNode(nestedRule, ''));
    }

    return this.createNode(
      'Rule',
      rule.selectors.join(', '),
      rule.startPosition,
      rule.endPosition,
      children
    );
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get the line number for a character offset.
   */
  private getLineNumber(source: string, offset: number): number {
    let line = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === '\n') {
        line++;
      }
    }
    return line;
  }

  /**
   * Get the column number for a character offset.
   */
  private getColumnNumber(source: string, offset: number): number {
    let column = 0;
    for (let i = offset - 1; i >= 0 && source[i] !== '\n'; i--) {
      column++;
    }
    return column;
  }
}
