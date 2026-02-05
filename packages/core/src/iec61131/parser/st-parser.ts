/**
 * IEC 61131-3 Structured Text Parser
 * 
 * Parses ST source code into a vendor-neutral AST.
 * Handles POUs, variables, comments, and basic control structures.
 */

import { STTokenizer } from './tokenizer.js';
import type { Token, TokenType } from './tokenizer.js';
import type {
  STPOU,
  STVariable,
  STDocstring,
  STDocParam,
  STHistoryEntry,
  STMethod,
  POUType,
  VariableSection,
  VendorId,
  ParserConfidence,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// PARSE RESULT
// ============================================================================

export interface ParseResult {
  success: boolean;
  pous: STPOU[];
  globalVariables: STVariable[];
  docstrings: STDocstring[];
  comments: ParsedComment[];
  errors: ParseError[];
  warnings: ParseWarning[];
  metadata: ParseMetadata;
}

export interface ParseError {
  code: string;
  message: string;
  line: number;
  column: number;
  recoverable: boolean;
}

export interface ParseWarning {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface ParsedComment {
  content: string;
  line: number;
  endLine: number;
  isDocstring: boolean;
}

export interface ParseMetadata {
  vendor: VendorId;
  confidence: ParserConfidence;
  totalLines: number;
  parseTime: number;
}

export interface ParseOptions {
  extractDocstrings?: boolean;
  preserveComments?: boolean;
  strict?: boolean;
}

// ============================================================================
// PARSER CLASS
// ============================================================================

export class STParser {
  private tokens: Token[] = [];
  private current: number = 0;
  private source: string = '';
  private filePath: string = '';
  private options: ParseOptions;
  
  private pous: STPOU[] = [];
  private globalVariables: STVariable[] = [];
  private docstrings: STDocstring[] = [];
  private comments: ParsedComment[] = [];
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];

  constructor(options: ParseOptions = {}) {
    this.options = {
      extractDocstrings: true,
      preserveComments: true,
      strict: false,
      ...options,
    };
  }

  parse(source: string, filePath: string): ParseResult {
    const startTime = Date.now();
    
    this.source = source;
    this.filePath = filePath;
    this.current = 0;
    this.pous = [];
    this.globalVariables = [];
    this.docstrings = [];
    this.comments = [];
    this.errors = [];
    this.warnings = [];

    // Tokenize
    const tokenizer = new STTokenizer(source);
    this.tokens = tokenizer.tokenize();

    // Extract comments first
    this.extractComments();

    // Parse POUs
    this.parseProgram();

    const parseTime = Date.now() - startTime;

    return {
      success: this.errors.filter(e => !e.recoverable).length === 0,
      pous: this.pous,
      globalVariables: this.globalVariables,
      docstrings: this.docstrings,
      comments: this.comments,
      errors: this.errors,
      warnings: this.warnings,
      metadata: {
        vendor: this.detectVendor(),
        confidence: this.calculateConfidence(),
        totalLines: source.split('\n').length,
        parseTime,
      },
    };
  }

  // ============================================================================
  // COMMENT EXTRACTION
  // ============================================================================

  private extractComments(): void {
    for (const token of this.tokens) {
      if (token.type === 'COMMENT') {
        const isDocstring = this.isDocstringComment(token);
        
        this.comments.push({
          content: token.value,
          line: token.line,
          endLine: token.endLine,
          isDocstring,
        });

        if (isDocstring && this.options.extractDocstrings) {
          const docstring = this.parseDocstring(token);
          if (docstring) {
            this.docstrings.push(docstring);
          }
        }
      }
    }
  }

  private isDocstringComment(token: Token): boolean {
    const content = token.value;
    
    // Multi-line block comments are likely docstrings
    if (content.startsWith('(*') && content.includes('\n')) {
      return true;
    }
    
    // Comments with special markers
    if (/(@param|@returns?|@author|@date|@history|@warning|@note)/i.test(content)) {
      return true;
    }
    
    // Header-style comments with asterisks
    if (/^\(\*{3,}/.test(content) || /^\(\*={3,}/.test(content)) {
      return true;
    }
    
    return false;
  }

  private parseDocstring(token: Token): STDocstring | null {
    const content = token.value
      .replace(/^\(\*+\s*/, '')
      .replace(/\s*\*+\)$/, '');
    
    const lines = content.split('\n').map(l => l.replace(/^\s*\*?\s?/, '').trim());
    
    let summary = '';
    const descLines: string[] = [];
    const params: STDocParam[] = [];
    const history: STHistoryEntry[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];
    let returns: string | null = null;
    let author: string | null = null;
    let date: string | null = null;

    for (const line of lines) {
      // Skip separator lines
      if (/^[=\-*]+$/.test(line)) continue;
      if (!line) continue;

      // @param
      const paramMatch = line.match(/@param\s+(\w+)\s*(?::\s*(\w+))?\s*[-:]?\s*(.*)/i);
      if (paramMatch) {
        params.push({
          name: paramMatch[1]!,
          type: paramMatch[2] || null,
          description: paramMatch[3]?.trim() || '',
          direction: null,
        });
        continue;
      }

      // @returns
      const returnMatch = line.match(/@returns?\s+(.*)/i);
      if (returnMatch) {
        returns = returnMatch[1]?.trim() || null;
        continue;
      }

      // @author
      const authorMatch = line.match(/@author\s+(.*)/i);
      if (authorMatch) {
        author = authorMatch[1]?.trim() || null;
        continue;
      }

      // @date
      const dateMatch = line.match(/@date\s+(.*)/i);
      if (dateMatch) {
        date = dateMatch[1]?.trim() || null;
        continue;
      }

      // History entries (YYYY-MM-DD format)
      const historyMatch = line.match(/^(\d{4}-\d{2}-\d{2})\s*(?:(\w+)\s*)?[-:]?\s*(.*)/);
      if (historyMatch) {
        history.push({
          date: historyMatch[1]!,
          author: historyMatch[2] || null,
          description: historyMatch[3]?.trim() || '',
        });
        continue;
      }

      // Warnings
      if (/^(WARNING|DANGER|CAUTION)\s*[:!]?\s*/i.test(line)) {
        warnings.push(line);
        continue;
      }

      // Notes
      if (/^NOTE\s*[:!]?\s*/i.test(line)) {
        notes.push(line.replace(/^NOTE\s*[:!]?\s*/i, ''));
        continue;
      }

      // Auth: pattern (common in legacy code)
      const authMatch = line.match(/^Auth:\s*(.*)/i);
      if (authMatch) {
        author = authMatch[1]?.trim() || null;
        continue;
      }

      // First non-special line is summary
      if (!summary && !line.startsWith('@')) {
        summary = line;
        continue;
      }

      // Rest is description
      if (summary && !line.startsWith('@')) {
        descLines.push(line);
      }
    }

    // Find associated block
    const afterComment = this.findTokenAfterLine(token.endLine);
    let associatedBlock: string | null = null;
    let associatedBlockType: POUType | null = null;

    if (afterComment) {
      if (this.isPOUKeyword(afterComment.type)) {
        const nameToken = this.findNextToken(afterComment, 'IDENTIFIER');
        if (nameToken) {
          associatedBlock = nameToken.value;
          associatedBlockType = afterComment.type as POUType;
        }
      }
    }

    return {
      id: generateId(),
      summary,
      description: descLines.join(' ').trim(),
      params,
      returns,
      author,
      date,
      history,
      warnings,
      notes,
      raw: token.value,
      location: {
        file: this.filePath,
        line: token.line,
        column: token.column,
        endLine: token.endLine,
        endColumn: token.endColumn,
      },
      associatedBlock,
      associatedBlockType,
    };
  }

  // ============================================================================
  // POU PARSING
  // ============================================================================

  private parseProgram(): void {
    while (!this.isAtEnd()) {
      try {
        this.skipComments();
        
        if (this.isAtEnd()) break;

        if (this.check('PROGRAM')) {
          this.parsePOU('PROGRAM', 'END_PROGRAM');
        } else if (this.check('FUNCTION_BLOCK')) {
          this.parsePOU('FUNCTION_BLOCK', 'END_FUNCTION_BLOCK');
        } else if (this.check('FUNCTION')) {
          this.parsePOU('FUNCTION', 'END_FUNCTION');
        } else if (this.check('CLASS')) {
          this.parsePOU('CLASS', 'END_CLASS');
        } else if (this.check('INTERFACE')) {
          this.parsePOU('INTERFACE', 'END_INTERFACE');
        } else if (this.isVariableSection(this.peek().type)) {
          // Global variables
          const vars = this.parseVariableSection();
          this.globalVariables.push(...vars);
        } else {
          // Skip unknown tokens
          this.advance();
        }
      } catch (error) {
        this.recoverFromError();
      }
    }
  }

  private parsePOU(startKeyword: TokenType, endKeyword: TokenType): void {
    const startToken = this.advance(); // consume keyword
    const startLine = startToken.line;

    // Get name
    this.skipComments();
    const nameToken = this.consume('IDENTIFIER', `Expected ${startKeyword} name`);
    const name = nameToken?.value ?? 'UNKNOWN';

    // Check for EXTENDS
    let extendsName: string | null = null;
    this.skipComments();
    if (this.check('EXTENDS')) {
      this.advance();
      this.skipComments();
      const extendsToken = this.consume('IDENTIFIER', 'Expected base class name');
      extendsName = extendsToken?.value ?? null;
    }

    // Check for IMPLEMENTS
    const implementsList: string[] = [];
    this.skipComments();
    if (this.check('IMPLEMENTS')) {
      this.advance();
      do {
        this.skipComments();
        const implToken = this.consume('IDENTIFIER', 'Expected interface name');
        if (implToken) implementsList.push(implToken.value);
        this.skipComments();
      } while (this.match('COMMA'));
    }

    // Parse variable sections
    const variables: STVariable[] = [];
    const methods: STMethod[] = [];
    let bodyStartLine = startLine;

    this.skipComments();
    while (!this.isAtEnd() && !this.check(endKeyword)) {
      this.skipComments();
      
      if (this.isVariableSection(this.peek().type)) {
        const vars = this.parseVariableSection();
        variables.push(...vars);
      } else if (this.check('METHOD')) {
        const method = this.parseMethod();
        if (method) methods.push(method);
      } else if (this.check('PROPERTY')) {
        this.skipProperty();
      } else {
        // Body starts here
        if (bodyStartLine === startLine) {
          bodyStartLine = this.peek().line;
        }
        this.advance();
      }
    }

    // Consume end keyword
    const endToken = this.match(endKeyword) ? this.previous() : this.peek();
    const endLine = endToken.line;

    // Find associated docstring
    const docstring = this.findDocstringForPOU(startLine);

    const pou: STPOU = {
      id: generateId(),
      type: this.tokenTypeToPOUType(startKeyword),
      name,
      qualifiedName: name,
      location: {
        file: this.filePath,
        line: startLine,
        column: startToken.column,
        endLine,
        endColumn: endToken.endColumn,
      },
      documentation: docstring,
      variables,
      extends: extendsName,
      implements: implementsList,
      methods,
      bodyStartLine,
      bodyEndLine: endLine,
      vendorAttributes: {},
    };

    this.pous.push(pou);
  }

  private parseMethod(): STMethod | null {
    const startToken = this.advance(); // consume METHOD
    this.skipComments();
    
    const nameToken = this.consume('IDENTIFIER', 'Expected method name');
    const name = nameToken?.value ?? 'UNKNOWN';

    // Check for return type
    let returnType: string | null = null;
    this.skipComments();
    if (this.check('COLON')) {
      this.advance();
      this.skipComments();
      const typeToken = this.consume('IDENTIFIER', 'Expected return type');
      returnType = typeToken?.value ?? null;
    }

    // Parse parameters
    const parameters: STVariable[] = [];
    this.skipComments();
    while (!this.isAtEnd() && !this.check('END_METHOD') && this.isVariableSection(this.peek().type)) {
      const vars = this.parseVariableSection();
      parameters.push(...vars);
      this.skipComments();
    }

    // Skip to END_METHOD
    while (!this.isAtEnd() && !this.check('END_METHOD')) {
      this.advance();
    }
    this.match('END_METHOD');

    return {
      id: generateId(),
      name,
      returnType,
      parameters,
      location: {
        file: this.filePath,
        line: startToken.line,
        column: startToken.column,
        endLine: this.previous().line,
        endColumn: this.previous().endColumn,
      },
      documentation: null,
    };
  }

  private skipProperty(): void {
    this.advance(); // consume PROPERTY
    while (!this.isAtEnd() && !this.check('END_PROPERTY')) {
      this.advance();
    }
    this.match('END_PROPERTY');
  }

  // ============================================================================
  // VARIABLE PARSING
  // ============================================================================

  private parseVariableSection(): STVariable[] {
    const variables: STVariable[] = [];
    const sectionToken = this.advance();
    const section = this.tokenTypeToVariableSection(sectionToken.type);

    // Check for modifiers (CONSTANT, RETAIN, etc.)
    this.skipComments();
    while (this.check('CONSTANT') || this.check('RETAIN') || this.check('PERSISTENT')) {
      this.advance();
      this.skipComments();
    }

    // Parse variables until END_VAR
    while (!this.isAtEnd() && !this.check('END_VAR')) {
      this.skipComments();
      if (this.check('END_VAR')) break;

      const variable = this.parseVariable(section);
      if (variable) {
        variables.push(variable);
      }
    }

    this.match('END_VAR');
    return variables;
  }

  private parseVariable(section: VariableSection): STVariable | null {
    this.skipComments();
    if (!this.check('IDENTIFIER')) return null;

    const nameToken = this.advance();
    const name = nameToken.value;
    let ioAddress: string | null = null;

    // Check for AT %address
    this.skipComments();
    if (this.check('AT')) {
      this.advance();
      this.skipComments();
      // Parse address like %IX0.0, %QW10, etc.
      if (this.peek().value.startsWith('%') || this.check('IDENTIFIER')) {
        ioAddress = this.advance().value;
      }
    }

    // Expect colon
    this.skipComments();
    if (!this.match('COLON')) {
      this.addWarning('MISSING_COLON', `Expected ':' after variable name '${name}'`, nameToken.line, nameToken.column);
      return null;
    }

    // Parse type
    this.skipComments();
    let dataType = '';
    let isArray = false;
    let arrayBounds = null;

    if (this.check('ARRAY')) {
      isArray = true;
      this.advance();
      this.skipComments();
      
      // Parse array bounds [lower..upper] or [lower..upper, lower..upper]
      if (this.match('LBRACKET')) {
        arrayBounds = this.parseArrayBounds();
        this.match('RBRACKET');
      }
      
      this.skipComments();
      this.match('OF');
      this.skipComments();
    }

    // Get base type
    if (this.check('IDENTIFIER')) {
      dataType = this.advance().value;
    }

    // Check for initial value
    let initialValue: string | null = null;
    this.skipComments();
    if (this.match('ASSIGN')) {
      initialValue = this.parseInitialValue();
    }

    // Check for inline comment
    let comment: string | null = null;
    this.skipComments();
    const nextToken = this.peek();
    if (nextToken.type === 'COMMENT' && nextToken.line === nameToken.line) {
      comment = this.extractInlineComment(nextToken.value);
    }

    // Consume semicolon
    this.skipComments();
    this.match('SEMICOLON');

    // Detect safety-critical variables
    const isSafetyCritical = this.isSafetyVariable(name);

    return {
      id: generateId(),
      name,
      dataType,
      section,
      initialValue,
      comment,
      isArray,
      arrayBounds,
      isSafetyCritical,
      ioAddress,
      location: {
        file: this.filePath,
        line: nameToken.line,
        column: nameToken.column,
      },
      pouId: null,
    };
  }

  private parseArrayBounds(): { dimensions: Array<{ lower: number; upper: number }> } | null {
    const dimensions: Array<{ lower: number; upper: number }> = [];

    do {
      this.skipComments();
      const lowerToken = this.advance();
      const lower = parseInt(lowerToken.value, 10) || 0;

      this.skipComments();
      this.match('DOTDOT');

      this.skipComments();
      const upperToken = this.advance();
      const upper = parseInt(upperToken.value, 10) || 0;

      dimensions.push({ lower, upper });
      this.skipComments();
    } while (this.match('COMMA'));

    return { dimensions };
  }

  private parseInitialValue(): string {
    let value = '';
    let depth = 0;

    while (!this.isAtEnd()) {
      const token = this.peek();
      
      if (token.type === 'SEMICOLON' && depth === 0) break;
      if (token.type === 'COMMENT') break;
      
      if (token.type === 'LPAREN' || token.type === 'LBRACKET') depth++;
      if (token.type === 'RPAREN' || token.type === 'RBRACKET') depth--;
      
      value += token.value;
      this.advance();
    }

    return value.trim();
  }

  private extractInlineComment(comment: string): string {
    return comment
      .replace(/^\(\*\s*/, '')
      .replace(/\s*\*\)$/, '')
      .replace(/^\/\/\s*/, '')
      .trim();
  }

  private isSafetyVariable(name: string): boolean {
    const safetyPatterns = [
      /^bIL_/i,
      /^IL_/i,
      /Interlock/i,
      /Permissive/i,
      /EStop/i,
      /E_Stop/i,
      /EmergencyStop/i,
      /Safety/i,
      /Bypass/i,
    ];
    return safetyPatterns.some(p => p.test(name));
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private skipComments(): void {
    while (this.check('COMMENT')) {
      this.advance();
    }
  }

  private isVariableSection(type: TokenType): boolean {
    return [
      'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT',
      'VAR_GLOBAL', 'VAR_TEMP', 'VAR_CONSTANT', 'VAR_EXTERNAL',
    ].includes(type);
  }

  private isPOUKeyword(type: TokenType): boolean {
    return ['PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION', 'CLASS', 'INTERFACE'].includes(type);
  }

  private tokenTypeToPOUType(type: TokenType): POUType {
    const map: Record<string, POUType> = {
      'PROGRAM': 'PROGRAM',
      'FUNCTION_BLOCK': 'FUNCTION_BLOCK',
      'FUNCTION': 'FUNCTION',
      'CLASS': 'CLASS',
      'INTERFACE': 'INTERFACE',
    };
    return map[type] ?? 'PROGRAM';
  }

  private tokenTypeToVariableSection(type: TokenType): VariableSection {
    const map: Record<string, VariableSection> = {
      'VAR': 'VAR',
      'VAR_INPUT': 'VAR_INPUT',
      'VAR_OUTPUT': 'VAR_OUTPUT',
      'VAR_IN_OUT': 'VAR_IN_OUT',
      'VAR_GLOBAL': 'VAR_GLOBAL',
      'VAR_TEMP': 'VAR_TEMP',
      'VAR_CONSTANT': 'VAR_CONSTANT',
      'VAR_EXTERNAL': 'VAR_EXTERNAL',
    };
    return map[type] ?? 'VAR';
  }

  private findDocstringForPOU(pouLine: number): STDocstring | null {
    // Find docstring immediately before POU
    for (const doc of this.docstrings) {
      const endLine = doc.location.endLine ?? doc.location.line;
      if (endLine === pouLine - 1 || endLine === pouLine - 2) {
        return doc;
      }
      if (doc.associatedBlock && doc.location.line < pouLine && endLine >= pouLine - 5) {
        return doc;
      }
    }
    return null;
  }

  private findTokenAfterLine(line: number): Token | null {
    for (const token of this.tokens) {
      if (token.line > line && token.type !== 'COMMENT' && token.type !== 'NEWLINE') {
        return token;
      }
    }
    return null;
  }

  private findNextToken(after: Token, type: TokenType): Token | null {
    let found = false;
    for (const token of this.tokens) {
      if (found && token.type === type) {
        return token;
      }
      if (token === after) {
        found = true;
      }
    }
    return null;
  }

  private detectVendor(): VendorId {
    // Check for vendor-specific patterns
    const sourceUpper = this.source.toUpperCase();
    
    if (sourceUpper.includes('ORGANISATION_BLOCK') || sourceUpper.includes('OB1')) {
      return 'siemens-step7';
    }
    if (sourceUpper.includes('#TEMP') || sourceUpper.includes('REGION')) {
      return 'siemens-tia';
    }
    if (sourceUpper.includes('<RSLOGIX5000CONTENT>')) {
      return 'rockwell-studio5000';
    }
    if (sourceUpper.includes('<TCPLCOBJECT>')) {
      return 'beckhoff-twincat';
    }
    if (sourceUpper.includes('CODESYS')) {
      return 'codesys';
    }
    
    return 'generic-st';
  }

  private calculateConfidence(): ParserConfidence {
    const errorCount = this.errors.length;
    const pouCount = this.pous.length;
    
    if (errorCount === 0 && pouCount > 0) {
      return { level: 'definite', reason: 'Clean parse with POUs found' };
    }
    if (errorCount < 3 && pouCount > 0) {
      return { level: 'probable', score: 0.8, reason: 'Minor parse issues' };
    }
    if (pouCount > 0) {
      return { level: 'possible', score: 0.5, reason: 'Multiple parse issues' };
    }
    return { level: 'none' };
  }

  // ============================================================================
  // TOKEN NAVIGATION
  // ============================================================================

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current] ?? { type: 'EOF', value: '', line: 0, column: 0, endLine: 0, endColumn: 0 };
  }

  private previous(): Token {
    return this.tokens[this.current - 1] ?? this.peek();
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token | null {
    if (this.check(type)) {
      return this.advance();
    }
    this.addError('UNEXPECTED_TOKEN', message, this.peek().line, this.peek().column, true);
    return null;
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  private addError(code: string, message: string, line: number, column: number, recoverable: boolean): void {
    this.errors.push({ code, message, line, column, recoverable });
  }

  private addWarning(code: string, message: string, line: number, column: number): void {
    this.warnings.push({ code, message, line, column });
  }

  private recoverFromError(): void {
    // Skip to next POU or variable section
    while (!this.isAtEnd()) {
      if (this.isPOUKeyword(this.peek().type) || this.isVariableSection(this.peek().type)) {
        return;
      }
      this.advance();
    }
  }
}

/**
 * Convenience function to parse ST source
 */
export function parseSTSource(source: string, filePath: string, options?: ParseOptions): ParseResult {
  return new STParser(options).parse(source, filePath);
}
