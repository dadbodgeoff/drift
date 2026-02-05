/**
 * Structured Text Call Graph Extractor
 * 
 * Single responsibility: Extract functions, calls, and data access from IEC 61131-3 ST code
 */

import { BaseCallGraphExtractor } from './base-extractor.js';

import type {
  CallGraphLanguage,
  FileExtractionResult,
  FunctionExtraction,
  CallExtraction,
  ClassExtraction,
  ParameterInfo,
} from '../types.js';

/**
 * IEC 61131-3 Structured Text call graph extractor
 */
export class STCallGraphExtractor extends BaseCallGraphExtractor {
  readonly language: CallGraphLanguage = 'structured-text';
  readonly extensions: string[] = ['.st', '.stx', '.scl', '.pou', '.exp'];

  extract(source: string, filePath: string): FileExtractionResult {
    const result = this.createEmptyResult(filePath);
    result.language = this.language;

    try {
      // Extract blocks (PROGRAM, FUNCTION_BLOCK, FUNCTION)
      const blocks = this.extractBlocks(source);
      result.functions = blocks.functions;
      result.classes = blocks.classes;

      // Extract calls within each block
      result.calls = this.extractCalls(source);

      // Extract FB instances as "imports" (dependencies)
      result.imports = this.extractFBInstances(source);

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }

  private extractBlocks(source: string): {
    functions: FunctionExtraction[];
    classes: ClassExtraction[];
  } {
    const functions: FunctionExtraction[] = [];
    const classes: ClassExtraction[] = [];

    // Extract PROGRAMs
    let match;
    const programPattern = /PROGRAM\s+(\w+)/gi;
    while ((match = programPattern.exec(source)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(source, match.index);
      const endLine = this.findEndLine(source, match.index, 'END_PROGRAM');
      const params = this.extractParameters(source, match.index);

      functions.push(this.createFunction({
        name,
        qualifiedName: name,
        startLine,
        endLine,
        parameters: params,
        isExported: true,
        isMethod: false,
      }));
    }

    // Extract FUNCTION_BLOCKs (these are like classes)
    const fbPattern = /FUNCTION_BLOCK\s+(\w+)(?:\s+EXTENDS\s+(\w+))?/gi;
    while ((match = fbPattern.exec(source)) !== null) {
      const name = match[1]!;
      const baseClass = match[2];
      const startLine = this.getLineNumber(source, match.index);
      const endLine = this.findEndLine(source, match.index, 'END_FUNCTION_BLOCK');
      const methods = this.extractMethods(source, match.index);

      classes.push(this.createClass({
        name,
        startLine,
        endLine,
        baseClasses: baseClass ? [baseClass] : [],
        methods: methods.map(m => m.name),
        isExported: true,
      }));

      // Add methods as functions
      functions.push(...methods.map(m => this.createFunction({
        name: m.name,
        qualifiedName: `${name}.${m.name}`,
        startLine: m.startLine,
        endLine: m.endLine,
        parameters: m.parameters,
        isMethod: true,
        className: name,
      })));
    }

    // Extract FUNCTIONs
    const funcPattern = /FUNCTION\s+(\w+)\s*:\s*(\w+)/gi;
    while ((match = funcPattern.exec(source)) !== null) {
      const name = match[1]!;
      const returnType = match[2];
      const startLine = this.getLineNumber(source, match.index);
      const endLine = this.findEndLine(source, match.index, 'END_FUNCTION');
      const params = this.extractParameters(source, match.index);

      functions.push(this.createFunction({
        name,
        qualifiedName: name,
        startLine,
        endLine,
        parameters: params,
        returnType,
        isExported: true,
        isMethod: false,
      }));
    }

    return { functions, classes };
  }

  private extractCalls(source: string): CallExtraction[] {
    const calls: CallExtraction[] = [];
    const lines = source.split('\n');

    // Track FB instances for method calls
    const fbInstances = new Map<string, string>();
    const instancePattern = /(\w+)\s*:\s*(\w+)\s*;/g;
    let match;
    while ((match = instancePattern.exec(source)) !== null) {
      fbInstances.set(match[1]!, match[2]!);
    }

    // Find function calls
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // Skip comments
      if (line.trim().startsWith('//') || line.trim().startsWith('(*')) continue;

      // Assignment with function call: result := FunctionName(...)
      const assignCallPattern = /(\w+)\s*:=\s*(\w+)\s*\(/g;
      while ((match = assignCallPattern.exec(line)) !== null) {
        const calleeName = match[2]!;
        // Skip built-in operators and keywords
        if (!this.isBuiltIn(calleeName)) {
          calls.push(this.createCall({
            calleeName,
            line: lineNum,
            column: match.index,
            isMethodCall: false,
          }));
        }
      }

      // FB instance call: fbInstance(IN:=...) or fbInstance.Method(...)
      const fbCallPattern = /(\w+)(?:\.(\w+))?\s*\(/g;
      while ((match = fbCallPattern.exec(line)) !== null) {
        const instanceOrFunc = match[1]!;
        const method = match[2];

        if (fbInstances.has(instanceOrFunc)) {
          // This is an FB instance call
          const fbType = fbInstances.get(instanceOrFunc)!;
          calls.push(this.createCall({
            calleeName: method || fbType,
            receiver: instanceOrFunc,
            fullExpression: method ? `${instanceOrFunc}.${method}` : instanceOrFunc,
            line: lineNum,
            column: match.index,
            isMethodCall: true,
          }));
        } else if (!this.isBuiltIn(instanceOrFunc) && !method) {
          // Direct function call
          calls.push(this.createCall({
            calleeName: instanceOrFunc,
            line: lineNum,
            column: match.index,
            isMethodCall: false,
          }));
        }
      }

      // Timer/Counter calls
      const timerPattern = /(TON|TOF|TP|CTU|CTD|CTUD|R_TRIG|F_TRIG)\s*\(/gi;
      while ((match = timerPattern.exec(line)) !== null) {
        calls.push(this.createCall({
          calleeName: match[1]!.toUpperCase(),
          line: lineNum,
          column: match.index,
          isConstructorCall: true,
        }));
      }
    }

    return calls;
  }

  private extractFBInstances(source: string): Array<{
    source: string;
    names: Array<{ imported: string; local: string; isDefault: boolean; isNamespace: boolean }>;
    line: number;
    isTypeOnly: boolean;
  }> {
    const imports: Array<{
      source: string;
      names: Array<{ imported: string; local: string; isDefault: boolean; isNamespace: boolean }>;
      line: number;
      isTypeOnly: boolean;
    }> = [];

    // FB instance declarations act like imports
    const instancePattern = /(\w+)\s*:\s*(\w+)\s*;/g;
    let match;
    while ((match = instancePattern.exec(source)) !== null) {
      const instanceName = match[1]!;
      const fbType = match[2]!;
      const line = this.getLineNumber(source, match.index);

      // Skip built-in types
      if (!this.isBuiltInType(fbType)) {
        imports.push(this.createImport({
          source: fbType,
          names: [{ imported: fbType, local: instanceName, isDefault: false, isNamespace: false }],
          line,
        }));
      }
    }

    return imports;
  }

  private extractParameters(source: string, blockStart: number): ParameterInfo[] {
    const params: ParameterInfo[] = [];
    const afterBlock = source.slice(blockStart);
    
    // Find VAR_INPUT section
    const varInputMatch = afterBlock.match(/VAR_INPUT\s*\n([\s\S]*?)END_VAR/i);
    if (varInputMatch) {
      const varSection = varInputMatch[1]!;
      const varPattern = /(\w+)\s*:\s*(\w+)(?:\s*:=\s*([^;]+))?/g;
      let match;
      while ((match = varPattern.exec(varSection)) !== null) {
        params.push(this.parseParameter(
          match[1]!,
          match[2],
          !!match[3]
        ));
      }
    }

    return params;
  }

  private extractMethods(source: string, fbStart: number): Array<{
    name: string;
    startLine: number;
    endLine: number;
    parameters: ParameterInfo[];
  }> {
    const methods: Array<{
      name: string;
      startLine: number;
      endLine: number;
      parameters: ParameterInfo[];
    }> = [];

    const fbBody = source.slice(fbStart);
    const methodPattern = /METHOD\s+(\w+)(?:\s*:\s*(\w+))?/gi;
    let match;

    while ((match = methodPattern.exec(fbBody)) !== null) {
      const name = match[1]!;
      const startLine = this.getLineNumber(source, fbStart + match.index);
      const endLine = this.findEndLine(source, fbStart + match.index, 'END_METHOD');
      const params = this.extractParameters(source, fbStart + match.index);

      methods.push({ name, startLine, endLine, parameters: params });
    }

    return methods;
  }

  private getLineNumber(source: string, index: number): number {
    return source.slice(0, index).split('\n').length;
  }

  private findEndLine(source: string, startIndex: number, endKeyword: string): number {
    const afterStart = source.slice(startIndex);
    const endMatch = afterStart.match(new RegExp(endKeyword, 'i'));
    if (endMatch) {
      return this.getLineNumber(source, startIndex + endMatch.index! + endMatch[0].length);
    }
    return this.getLineNumber(source, source.length);
  }

  private isBuiltIn(name: string): boolean {
    const builtIns = new Set([
      // Operators
      'AND', 'OR', 'XOR', 'NOT', 'MOD',
      // Type conversions
      'INT_TO_REAL', 'REAL_TO_INT', 'BOOL_TO_INT', 'INT_TO_BOOL',
      'DINT_TO_REAL', 'REAL_TO_DINT', 'TIME_TO_DINT', 'DINT_TO_TIME',
      // Math functions
      'ABS', 'SQRT', 'LN', 'LOG', 'EXP', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS', 'ATAN',
      'MIN', 'MAX', 'LIMIT', 'SEL', 'MUX',
      // String functions
      'LEN', 'LEFT', 'RIGHT', 'MID', 'CONCAT', 'INSERT', 'DELETE', 'REPLACE', 'FIND',
      // Bit operations
      'SHL', 'SHR', 'ROL', 'ROR',
      // Keywords
      'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
      'CASE', 'OF', 'END_CASE',
      'FOR', 'TO', 'BY', 'DO', 'END_FOR',
      'WHILE', 'END_WHILE',
      'REPEAT', 'UNTIL', 'END_REPEAT',
      'TRUE', 'FALSE',
    ]);
    return builtIns.has(name.toUpperCase());
  }

  private isBuiltInType(name: string): boolean {
    const builtInTypes = new Set([
      'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD',
      'SINT', 'INT', 'DINT', 'LINT',
      'USINT', 'UINT', 'UDINT', 'ULINT',
      'REAL', 'LREAL',
      'TIME', 'DATE', 'TIME_OF_DAY', 'DATE_AND_TIME', 'TOD', 'DT',
      'STRING', 'WSTRING',
      'ARRAY', 'STRUCT',
      // Standard FBs (these are built-in)
      'TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD', 'R_TRIG', 'F_TRIG',
      'SR', 'RS',
    ]);
    return builtInTypes.has(name.toUpperCase());
  }
}
