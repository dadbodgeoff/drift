/**
 * ST Parser - Orchestrator
 * 
 * Single responsibility: Orchestrate extractors, produce unified parse result
 */

import { BaseParser } from '../../base-parser.js';
import { extractBlocks } from './extractors/block-extractor.js';
import { extractVariables } from './extractors/variable-extractor.js';
import { extractComments } from './extractors/comment-extractor.js';
import { extractTimersAndCounters } from './extractors/timer-counter-extractor.js';
import { extractStateMachines } from './extractors/state-machine-extractor.js';

import type { AST, ASTNode, Language, ParseResult, Position } from '../../types.js';
import type { STParseResult, STBlock } from './types.js';

/**
 * Extended parse result with ST-specific data
 */
export interface STExtendedParseResult extends ParseResult {
  st: STParseResult;
}

export class STParser extends BaseParser {
  readonly language: Language = 'structured-text' as Language;
  readonly extensions: string[] = ['.st', '.stx', '.scl', '.pou', '.exp'];

  parse(source: string, _filePath?: string): STExtendedParseResult {
    const errors: string[] = [];

    // Run all extractors (single responsibility each)
    const blockResult = extractBlocks(source);
    const variableResult = extractVariables(source);
    const commentResult = extractComments(source);
    const timerCounterResult = extractTimersAndCounters(source);
    const stateMachineResult = extractStateMachines(source);

    // Collect errors
    errors.push(...blockResult.errors);
    errors.push(...variableResult.errors);

    // Build AST from blocks
    const ast = this.buildAST(source, blockResult.blocks);

    // Build ST-specific result
    const stResult: STParseResult = {
      blocks: blockResult.blocks,
      variables: variableResult.variables,
      comments: commentResult.comments,
      timers: timerCounterResult.timers,
      counters: timerCounterResult.counters,
      stateCases: stateMachineResult.stateCases,
      errors,
    };

    return {
      ast,
      language: this.language,
      errors: errors.map(msg => ({ message: msg, position: { row: 0, column: 0 } })),
      success: errors.length === 0,
      st: stResult,
    };
  }

  query(ast: AST, pattern: string): ASTNode[] {
    // Query by node type
    return this.findNodesByType(ast, pattern);
  }

  private buildAST(source: string, blocks: STBlock[]): AST {
    const lines = source.split('\n');
    const children: ASTNode[] = [];

    for (const block of blocks) {
      const blockText = lines.slice(block.startLine - 1, block.endLine).join('\n');
      
      children.push(this.createNode(
        block.type,
        blockText,
        { row: block.startLine - 1, column: block.startColumn - 1 },
        { row: block.endLine - 1, column: block.endColumn - 1 },
        []
      ));
    }

    const endPos: Position = lines.length > 0
      ? { row: lines.length - 1, column: lines[lines.length - 1]?.length ?? 0 }
      : { row: 0, column: 0 };

    const rootNode = this.createNode(
      'SourceFile',
      source,
      { row: 0, column: 0 },
      endPos,
      children
    );

    return this.createAST(rootNode, source);
  }
}
