/**
 * IEC 61131-3 Structured Text Tokenizer
 * 
 * Lexical analysis for ST code. Produces tokens for the parser.
 * Handles comments, strings, identifiers, keywords, operators.
 */

// ============================================================================
// TOKEN TYPES
// ============================================================================

export type TokenType =
  // Keywords - POU
  | 'PROGRAM' | 'END_PROGRAM'
  | 'FUNCTION_BLOCK' | 'END_FUNCTION_BLOCK'
  | 'FUNCTION' | 'END_FUNCTION'
  | 'CLASS' | 'END_CLASS'
  | 'INTERFACE' | 'END_INTERFACE'
  | 'METHOD' | 'END_METHOD'
  | 'PROPERTY' | 'END_PROPERTY'
  // Keywords - Variables
  | 'VAR' | 'END_VAR'
  | 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT'
  | 'VAR_GLOBAL' | 'VAR_TEMP' | 'VAR_CONSTANT' | 'VAR_EXTERNAL'
  | 'CONSTANT' | 'RETAIN' | 'PERSISTENT'
  // Keywords - Control
  | 'IF' | 'THEN' | 'ELSIF' | 'ELSE' | 'END_IF'
  | 'CASE' | 'OF' | 'END_CASE'
  | 'FOR' | 'TO' | 'BY' | 'DO' | 'END_FOR'
  | 'WHILE' | 'END_WHILE'
  | 'REPEAT' | 'UNTIL' | 'END_REPEAT'
  | 'EXIT' | 'CONTINUE' | 'RETURN'
  // Keywords - Types
  | 'TYPE' | 'END_TYPE'
  | 'STRUCT' | 'END_STRUCT'
  | 'ARRAY'
  | 'AT'
  | 'EXTENDS' | 'IMPLEMENTS'
  // Operators
  | 'ASSIGN'      // :=
  | 'COLON'       // :
  | 'SEMICOLON'   // ;
  | 'COMMA'       // ,
  | 'DOT'         // .
  | 'DOTDOT'      // ..
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'LBRACKET'    // [
  | 'RBRACKET'    // ]
  | 'HASH'        // #
  | 'PLUS'        // +
  | 'MINUS'       // -
  | 'STAR'        // *
  | 'SLASH'       // /
  | 'MOD'
  | 'POWER'       // **
  | 'EQ'          // =
  | 'NE'          // <>
  | 'LT'          // <
  | 'LE'          // <=
  | 'GT'          // >
  | 'GE'          // >=
  | 'AND' | 'OR' | 'XOR' | 'NOT'
  // Literals
  | 'INTEGER'
  | 'REAL'
  | 'STRING'
  | 'WSTRING'
  | 'TIME'
  | 'DATE'
  | 'DATETIME'
  | 'TRUE' | 'FALSE'
  // Other
  | 'IDENTIFIER'
  | 'COMMENT'
  | 'NEWLINE'
  | 'WHITESPACE'
  | 'EOF'
  | 'UNKNOWN';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

// ============================================================================
// KEYWORD MAP
// ============================================================================

const KEYWORDS: Record<string, TokenType> = {
  // POU
  'PROGRAM': 'PROGRAM',
  'END_PROGRAM': 'END_PROGRAM',
  'FUNCTION_BLOCK': 'FUNCTION_BLOCK',
  'END_FUNCTION_BLOCK': 'END_FUNCTION_BLOCK',
  'FUNCTION': 'FUNCTION',
  'END_FUNCTION': 'END_FUNCTION',
  'CLASS': 'CLASS',
  'END_CLASS': 'END_CLASS',
  'INTERFACE': 'INTERFACE',
  'END_INTERFACE': 'END_INTERFACE',
  'METHOD': 'METHOD',
  'END_METHOD': 'END_METHOD',
  'PROPERTY': 'PROPERTY',
  'END_PROPERTY': 'END_PROPERTY',
  // Variables
  'VAR': 'VAR',
  'END_VAR': 'END_VAR',
  'VAR_INPUT': 'VAR_INPUT',
  'VAR_OUTPUT': 'VAR_OUTPUT',
  'VAR_IN_OUT': 'VAR_IN_OUT',
  'VAR_GLOBAL': 'VAR_GLOBAL',
  'VAR_TEMP': 'VAR_TEMP',
  'VAR_CONSTANT': 'VAR_CONSTANT',
  'VAR_EXTERNAL': 'VAR_EXTERNAL',
  'CONSTANT': 'CONSTANT',
  'RETAIN': 'RETAIN',
  'PERSISTENT': 'PERSISTENT',
  // Control
  'IF': 'IF',
  'THEN': 'THEN',
  'ELSIF': 'ELSIF',
  'ELSE': 'ELSE',
  'END_IF': 'END_IF',
  'CASE': 'CASE',
  'OF': 'OF',
  'END_CASE': 'END_CASE',
  'FOR': 'FOR',
  'TO': 'TO',
  'BY': 'BY',
  'DO': 'DO',
  'END_FOR': 'END_FOR',
  'WHILE': 'WHILE',
  'END_WHILE': 'END_WHILE',
  'REPEAT': 'REPEAT',
  'UNTIL': 'UNTIL',
  'END_REPEAT': 'END_REPEAT',
  'EXIT': 'EXIT',
  'CONTINUE': 'CONTINUE',
  'RETURN': 'RETURN',
  // Types
  'TYPE': 'TYPE',
  'END_TYPE': 'END_TYPE',
  'STRUCT': 'STRUCT',
  'END_STRUCT': 'END_STRUCT',
  'ARRAY': 'ARRAY',
  'AT': 'AT',
  'EXTENDS': 'EXTENDS',
  'IMPLEMENTS': 'IMPLEMENTS',
  // Operators
  'MOD': 'MOD',
  'AND': 'AND',
  'OR': 'OR',
  'XOR': 'XOR',
  'NOT': 'NOT',
  // Literals
  'TRUE': 'TRUE',
  'FALSE': 'FALSE',
};

// ============================================================================
// TOKENIZER CLASS
// ============================================================================

export class STTokenizer {
  private source: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.pos = 0;
    this.line = 1;
    this.column = 1;

    while (!this.isAtEnd()) {
      const token = this.scanToken();
      if (token) {
        this.tokens.push(token);
      }
    }

    this.tokens.push({
      type: 'EOF',
      value: '',
      line: this.line,
      column: this.column,
      endLine: this.line,
      endColumn: this.column,
    });

    return this.tokens;
  }

  private scanToken(): Token | null {
    const startLine = this.line;
    const startColumn = this.column;
    const char = this.advance();

    // Whitespace (skip but track newlines)
    if (char === ' ' || char === '\t' || char === '\r') {
      return null;
    }

    // Newline
    if (char === '\n') {
      this.line++;
      this.column = 1;
      return null;
    }

    // Comments (* ... *) or // ...
    if (char === '(' && this.peek() === '*') {
      return this.scanBlockComment(startLine, startColumn);
    }
    if (char === '/' && this.peek() === '/') {
      return this.scanLineComment(startLine, startColumn);
    }

    // Strings
    if (char === "'") {
      return this.scanString(startLine, startColumn);
    }
    if (char === '"') {
      return this.scanWString(startLine, startColumn);
    }

    // Numbers
    if (this.isDigit(char)) {
      return this.scanNumber(char, startLine, startColumn);
    }

    // Identifiers and keywords
    if (this.isAlpha(char) || char === '_') {
      return this.scanIdentifier(char, startLine, startColumn);
    }

    // Operators and punctuation
    return this.scanOperator(char, startLine, startColumn);
  }

  private scanBlockComment(startLine: number, startColumn: number): Token {
    this.advance(); // consume *
    let value = '(*';
    let depth = 1;

    while (!this.isAtEnd() && depth > 0) {
      const char = this.advance();
      value += char;

      if (char === '\n') {
        this.line++;
        this.column = 1;
      } else if (char === '(' && this.peek() === '*') {
        this.advance();
        value += '*';
        depth++;
      } else if (char === '*' && this.peek() === ')') {
        this.advance();
        value += ')';
        depth--;
      }
    }

    return {
      type: 'COMMENT',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanLineComment(startLine: number, startColumn: number): Token {
    let value = '//';
    this.advance(); // consume second /

    while (!this.isAtEnd() && this.peek() !== '\n') {
      value += this.advance();
    }

    return {
      type: 'COMMENT',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanString(startLine: number, startColumn: number): Token {
    let value = "'";

    while (!this.isAtEnd() && this.peek() !== "'") {
      const char = this.advance();
      value += char;
      if (char === '\n') {
        this.line++;
        this.column = 1;
      }
    }

    if (!this.isAtEnd()) {
      value += this.advance(); // closing quote
    }

    return {
      type: 'STRING',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanWString(startLine: number, startColumn: number): Token {
    let value = '"';

    while (!this.isAtEnd() && this.peek() !== '"') {
      const char = this.advance();
      value += char;
      if (char === '\n') {
        this.line++;
        this.column = 1;
      }
    }

    if (!this.isAtEnd()) {
      value += this.advance(); // closing quote
    }

    return {
      type: 'WSTRING',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanNumber(firstChar: string, startLine: number, startColumn: number): Token {
    let value = firstChar;
    let type: TokenType = 'INTEGER';

    // Integer part
    while (this.isDigit(this.peek()) || this.peek() === '_') {
      const char = this.advance();
      if (char !== '_') value += char;
    }

    // Decimal part
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      type = 'REAL';
      value += this.advance(); // .
      while (this.isDigit(this.peek()) || this.peek() === '_') {
        const char = this.advance();
        if (char !== '_') value += char;
      }
    }

    // Exponent
    if (this.peek() === 'e' || this.peek() === 'E') {
      type = 'REAL';
      value += this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance();
      }
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    return {
      type,
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanIdentifier(firstChar: string, startLine: number, startColumn: number): Token {
    let value = firstChar;

    while (this.isAlphaNumeric(this.peek()) || this.peek() === '_') {
      value += this.advance();
    }

    // Check for time literals (T#, TIME#)
    if ((value.toUpperCase() === 'T' || value.toUpperCase() === 'TIME') && this.peek() === '#') {
      return this.scanTimeLiteral(value, startLine, startColumn);
    }

    // Check for date literals (D#, DATE#)
    if ((value.toUpperCase() === 'D' || value.toUpperCase() === 'DATE') && this.peek() === '#') {
      return this.scanDateLiteral(value, startLine, startColumn);
    }

    // Check for datetime literals (DT#, DATE_AND_TIME#)
    if ((value.toUpperCase() === 'DT' || value.toUpperCase() === 'DATE_AND_TIME') && this.peek() === '#') {
      return this.scanDateTimeLiteral(value, startLine, startColumn);
    }

    const upper = value.toUpperCase();
    const type = KEYWORDS[upper] ?? 'IDENTIFIER';

    return {
      type,
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanTimeLiteral(prefix: string, startLine: number, startColumn: number): Token {
    let value = prefix + this.advance(); // #

    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '_' || this.peek() === '.')) {
      value += this.advance();
    }

    return {
      type: 'TIME',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanDateLiteral(prefix: string, startLine: number, startColumn: number): Token {
    let value = prefix + this.advance(); // #

    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '-')) {
      value += this.advance();
    }

    return {
      type: 'DATE',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanDateTimeLiteral(prefix: string, startLine: number, startColumn: number): Token {
    let value = prefix + this.advance(); // #

    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '-' || this.peek() === ':' || this.peek() === '.')) {
      value += this.advance();
    }

    return {
      type: 'DATETIME',
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  private scanOperator(char: string, startLine: number, startColumn: number): Token {
    let type: TokenType;
    let value = char;

    switch (char) {
      case ':':
        if (this.peek() === '=') {
          value += this.advance();
          type = 'ASSIGN';
        } else {
          type = 'COLON';
        }
        break;
      case ';':
        type = 'SEMICOLON';
        break;
      case ',':
        type = 'COMMA';
        break;
      case '.':
        if (this.peek() === '.') {
          value += this.advance();
          type = 'DOTDOT';
        } else {
          type = 'DOT';
        }
        break;
      case '(':
        type = 'LPAREN';
        break;
      case ')':
        type = 'RPAREN';
        break;
      case '[':
        type = 'LBRACKET';
        break;
      case ']':
        type = 'RBRACKET';
        break;
      case '#':
        type = 'HASH';
        break;
      case '+':
        type = 'PLUS';
        break;
      case '-':
        type = 'MINUS';
        break;
      case '*':
        if (this.peek() === '*') {
          value += this.advance();
          type = 'POWER';
        } else {
          type = 'STAR';
        }
        break;
      case '/':
        type = 'SLASH';
        break;
      case '=':
        type = 'EQ';
        break;
      case '<':
        if (this.peek() === '>') {
          value += this.advance();
          type = 'NE';
        } else if (this.peek() === '=') {
          value += this.advance();
          type = 'LE';
        } else {
          type = 'LT';
        }
        break;
      case '>':
        if (this.peek() === '=') {
          value += this.advance();
          type = 'GE';
        } else {
          type = 'GT';
        }
        break;
      default:
        type = 'UNKNOWN';
    }

    return {
      type,
      value,
      line: startLine,
      column: startColumn,
      endLine: this.line,
      endColumn: this.column,
    };
  }

  // Helper methods
  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private advance(): string {
    const char = this.source[this.pos++]!;
    this.column++;
    return char;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.pos]!;
  }

  private peekNext(): string {
    if (this.pos + 1 >= this.source.length) return '\0';
    return this.source[this.pos + 1]!;
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }
}

/**
 * Convenience function to tokenize ST source
 */
export function tokenize(source: string): Token[] {
  return new STTokenizer(source).tokenize();
}
