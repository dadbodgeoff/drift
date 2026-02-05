/**
 * Parser type definitions
 * 
 * @requirements 3.1, 3.5
 */

export type Language = 
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'csharp'
  | 'java'
  | 'php'
  | 'go'
  | 'rust'
  | 'cpp'
  | 'css'
  | 'scss'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'structured-text';

export interface ParseResult {
  /** The parsed AST */
  ast: AST | null;
  /** Language of the parsed file */
  language: Language;
  /** Parse errors if any */
  errors: ParseError[];
  /** Whether parsing was successful */
  success: boolean;
}

export interface AST {
  /** Root node of the AST */
  rootNode: ASTNode;
  /** Source text */
  text: string;
}

export interface ASTNode {
  /** Node type */
  type: string;
  /** Start position */
  startPosition: Position;
  /** End position */
  endPosition: Position;
  /** Child nodes */
  children: ASTNode[];
  /** Node text */
  text: string;
}

export interface Position {
  row: number;
  column: number;
}

export interface ParseError {
  message: string;
  position: Position;
}
