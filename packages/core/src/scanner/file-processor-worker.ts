/**
 * File Processor Worker - Worker thread for CPU-bound file processing
 *
 * This worker runs in a separate thread and handles:
 * - Tree-sitter AST parsing
 * - Regex pattern matching
 * - File content analysis
 *
 * @requirements 2.6 - Parallel file processing with worker threads
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Task input for file processing
 */
export interface FileProcessorTask {
  /** Absolute path to the file */
  filePath: string;

  /** File content (optional - will be read if not provided) */
  content?: string;

  /** Root directory for relative path calculation */
  rootDir: string;

  /** Patterns to match (regex strings) */
  patterns?: Array<{
    id: string;
    regex: string;
    flags?: string;
  }>;

  /** Whether to parse AST */
  parseAst?: boolean;

  /** Language hint (optional - will be detected from extension) */
  language?: string;
}

/**
 * Result of file processing
 */
export interface FileProcessorResult {
  /** Relative path to the file */
  relativePath: string;

  /** Absolute path to the file */
  absolutePath: string;

  /** Detected language */
  language: string | null;

  /** Pattern matches found */
  matches: Array<{
    patternId: string;
    line: number;
    column: number;
    match: string;
  }>;

  /** AST info (if parsed) */
  ast?: {
    nodeCount: number;
    rootType: string;
    hasErrors: boolean;
  } | undefined;

  /** Processing duration in milliseconds */
  duration: number;

  /** Error message if processing failed */
  error?: string | undefined;
}

/**
 * Extension to language mapping
 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.cs': 'csharp',
  '.java': 'java',
  '.php': 'php',
};

/**
 * Detect language from file extension
 */
function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || null;
}

/**
 * Count nodes in a tree-sitter tree
 */
function countNodes(node: { childCount: number; children: unknown[] }): number {
  let count = 1;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.children[i] as { childCount: number; children: unknown[] } | undefined;
    if (child) {
      count += countNodes(child);
    }
  }
  return count;
}

/**
 * Process a single file
 *
 * This is the main export that Piscina will call for each task.
 */
export default async function processFile(task: FileProcessorTask): Promise<FileProcessorResult> {
  const startTime = Date.now();
  const relativePath = path.relative(task.rootDir, task.filePath);
  const language = task.language || detectLanguage(task.filePath);

  try {
    // Read content if not provided
    const content = task.content ?? await fs.readFile(task.filePath, 'utf-8');

    const matches: FileProcessorResult['matches'] = [];

    // Run regex pattern matching
    if (task.patterns && task.patterns.length > 0) {
      for (const pattern of task.patterns) {
        try {
          const regex = new RegExp(pattern.regex, pattern.flags || 'gm');
          let match: RegExpExecArray | null;

          // Reset regex state
          regex.lastIndex = 0;

          while ((match = regex.exec(content)) !== null) {
            // Calculate line and column from match index
            let line = 1;
            let lastNewline = 0;

            for (let i = 0; i < match.index; i++) {
              if (content[i] === '\n') {
                line++;
                lastNewline = i + 1;
              }
            }

            const column = match.index - lastNewline + 1;

            matches.push({
              patternId: pattern.id,
              line,
              column,
              match: match[0].substring(0, 100), // Limit match length
            });

            // Prevent infinite loops on zero-length matches
            if (match[0].length === 0) {
              regex.lastIndex++;
            }
          }
        } catch (regexError) {
          // Invalid regex - skip this pattern
          console.error(`Invalid regex pattern ${pattern.id}: ${regexError}`);
        }
      }
    }

    // Parse AST if requested
    let ast: FileProcessorResult['ast'];
    if (task.parseAst && language) {
      try {
        ast = await parseAst(content, language);
      } catch (astError) {
        // AST parsing failed - continue without it
        ast = {
          nodeCount: 0,
          rootType: 'error',
          hasErrors: true,
        };
      }
    }

    return {
      relativePath,
      absolutePath: task.filePath,
      language,
      matches,
      ast,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      relativePath,
      absolutePath: task.filePath,
      language,
      matches: [],
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse AST using tree-sitter
 */
async function parseAst(
  content: string,
  language: string
): Promise<FileProcessorResult['ast']> {
  // Dynamic import tree-sitter based on language
  // Each worker thread loads its own instance of tree-sitter

  let Parser: new () => { setLanguage: (lang: unknown) => void; parse: (content: string) => { rootNode: { type: string; hasError: boolean; childCount: number; children: unknown[] } } };
  let languageModule: unknown;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Parser = require('tree-sitter');
  } catch {
    throw new Error('tree-sitter not available');
  }

  // Load language-specific grammar
  switch (language) {
    case 'python':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      languageModule = require('tree-sitter-python');
      break;
    case 'typescript':
    case 'javascript':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsModule = require('tree-sitter-typescript');
      languageModule = language === 'typescript' ? tsModule.typescript : tsModule.tsx;
      break;
    case 'csharp':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      languageModule = require('tree-sitter-c-sharp');
      break;
    case 'java':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      languageModule = require('tree-sitter-java');
      break;
    case 'php':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const phpModule = require('tree-sitter-php');
      languageModule = phpModule.php;
      break;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }

  const parser = new Parser();
  parser.setLanguage(languageModule);

  const tree = parser.parse(content);
  const rootNode = tree.rootNode;

  return {
    nodeCount: countNodes(rootNode),
    rootType: rootNode.type,
    hasErrors: rootNode.hasError,
  };
}
