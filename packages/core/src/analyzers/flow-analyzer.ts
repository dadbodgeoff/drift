/**
 * Flow Analyzer - Control flow and data flow analysis
 *
 * Provides control flow graph (CFG) construction from AST,
 * data flow analysis (reads, writes, captures), detection of
 * unreachable code, infinite loops, missing return statements,
 * null/undefined dereferences, unused variables, and uninitialized reads.
 *
 * @requirements 3.5 - Parser SHALL provide a unified AST query interface across all languages
 */

import type {
  FlowAnalysisResult,
  ControlFlowGraph,
  ControlFlowNode,
  ControlFlowEdge,
  ControlFlowNodeKind,
  DataFlowInfo,
  DataFlowVariable,
  SourceLocation,
} from './types.js';
import type { AST, ASTNode } from '../parsers/types.js';

/**
 * Options for flow analysis
 */
export interface FlowAnalysisOptions {
  /** Whether to detect unreachable code */
  detectUnreachable?: boolean;

  /** Whether to detect infinite loops */
  detectInfiniteLoops?: boolean;

  /** Whether to detect missing return statements */
  detectMissingReturns?: boolean;

  /** Whether to detect null/undefined dereferences */
  detectNullDereferences?: boolean;

  /** Whether to detect unused variables */
  detectUnusedVariables?: boolean;

  /** Whether to detect uninitialized variable reads */
  detectUninitializedReads?: boolean;

  /** Maximum depth for analysis */
  maxDepth?: number;
}

/**
 * Internal representation of a CFG node during construction
 */
interface InternalCFGNode {
  id: string;
  kind: ControlFlowNodeKind;
  astNode?: ASTNode;
  location: SourceLocation;
  outgoing: Set<string>;
  incoming: Set<string>;
  isReachable: boolean;
}

/**
 * Variable state during data flow analysis
 */
interface VariableState {
  name: string;
  isInitialized: boolean;
  isRead: boolean;
  isWritten: boolean;
  isCaptured: boolean;
  declarationLocation: SourceLocation;
  readLocations: SourceLocation[];
  writeLocations: SourceLocation[];
}

/**
 * Context for flow analysis within a function/method
 */
interface FlowContext {
  /** Current scope variables */
  variables: Map<string, VariableState>;

  /** Parent context for closures */
  parentContext: FlowContext | null;

  /** Whether we're in a loop */
  inLoop: boolean;

  /** Whether we're in a try block */
  inTry: boolean;

  /** Current loop entry node (for continue) */
  loopEntry: string | null;

  /** Current loop exit node (for break) */
  loopExit: string | null;

  /** Switch exit node (for break in switch) */
  switchExit: string | null;
}

/**
 * Flow Analyzer class for control flow and data flow analysis.
 *
 * Provides a unified interface for analyzing control flow and data flow
 * across TypeScript and JavaScript code.
 *
 * @requirements 3.5 - Unified AST query interface across all languages
 */
export class FlowAnalyzer {
  /** Counter for generating unique node IDs */
  private nodeIdCounter = 0;

  /** All CFG nodes during construction */
  private nodes: Map<string, InternalCFGNode> = new Map();

  /** All CFG edges during construction */
  private edges: ControlFlowEdge[] = [];

  /** Entry node ID */
  private entryNodeId: string | null = null;

  /** Exit node IDs */
  private exitNodeIds: Set<string> = new Set();

  /** Unreachable code locations */
  private unreachableCode: SourceLocation[] = [];

  /** Infinite loop locations */
  private infiniteLoops: SourceLocation[] = [];

  /** Missing return locations */
  private missingReturns: SourceLocation[] = [];

  /** Current analysis options */
  private options: FlowAnalysisOptions = {};

  /**
   * Analyze an AST and produce flow analysis results.
   *
   * @param ast - The AST to analyze
   * @param options - Analysis options
   * @returns Flow analysis result
   */
  analyze(ast: AST, options: FlowAnalysisOptions = {}): FlowAnalysisResult {
    // Reset state for fresh analysis
    this.reset();
    this.options = {
      detectUnreachable: true,
      detectInfiniteLoops: true,
      detectMissingReturns: true,
      detectNullDereferences: true,
      detectUnusedVariables: true,
      detectUninitializedReads: true,
      ...options,
    };

    // Create entry and exit nodes
    const entryNode = this.createNode('entry', {
      start: ast.rootNode.startPosition,
      end: ast.rootNode.startPosition,
    });
    this.entryNodeId = entryNode.id;

    const exitNode = this.createNode('exit', {
      start: ast.rootNode.endPosition,
      end: ast.rootNode.endPosition,
    });
    this.exitNodeIds.add(exitNode.id);

    // Create initial flow context
    const context = this.createFlowContext(null);

    // Build CFG from AST
    const lastNodes = this.buildCFG(ast.rootNode, [entryNode.id], context);

    // Connect remaining nodes to exit
    for (const nodeId of lastNodes) {
      this.addEdge(nodeId, exitNode.id);
    }

    // Mark reachable nodes
    this.markReachableNodes();

    // Detect unreachable code
    if (this.options.detectUnreachable) {
      this.detectUnreachableCode();
    }

    // Analyze data flow
    const dataFlow = this.analyzeDataFlow(ast.rootNode, context);

    // Build result
    return this.buildResult(dataFlow);
  }

  /**
   * Analyze a single function/method for flow.
   *
   * @param node - The function AST node
   * @param options - Analysis options
   * @returns Flow analysis result for the function
   */
  analyzeFunction(node: ASTNode, options: FlowAnalysisOptions = {}): FlowAnalysisResult {
    // Reset state for fresh analysis
    this.reset();
    this.options = {
      detectUnreachable: true,
      detectInfiniteLoops: true,
      detectMissingReturns: true,
      detectNullDereferences: true,
      detectUnusedVariables: true,
      detectUninitializedReads: true,
      ...options,
    };

    // Create entry and exit nodes
    const entryNode = this.createNode('entry', {
      start: node.startPosition,
      end: node.startPosition,
    });
    this.entryNodeId = entryNode.id;

    const exitNode = this.createNode('exit', {
      start: node.endPosition,
      end: node.endPosition,
    });
    this.exitNodeIds.add(exitNode.id);

    // Create initial flow context
    const context = this.createFlowContext(null);

    // Add function parameters to context
    this.collectFunctionParameters(node, context);

    // Find function body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement');

    if (body) {
      // Build CFG from function body
      const lastNodes = this.buildCFG(body, [entryNode.id], context);

      // Connect remaining nodes to exit (implicit return)
      for (const nodeId of lastNodes) {
        this.addEdge(nodeId, exitNode.id);
      }

      // Check for missing returns if function has return type
      if (this.options.detectMissingReturns) {
        this.checkMissingReturns(node, lastNodes);
      }
    } else {
      // Expression body (arrow function)
      const lastNodes = this.buildCFG(node, [entryNode.id], context);
      for (const nodeId of lastNodes) {
        this.addEdge(nodeId, exitNode.id);
      }
    }

    // Mark reachable nodes
    this.markReachableNodes();

    // Detect unreachable code
    if (this.options.detectUnreachable) {
      this.detectUnreachableCode();
    }

    // Analyze data flow
    const dataFlow = this.analyzeDataFlow(node, context);

    // Build result
    return this.buildResult(dataFlow);
  }

  // ============================================
  // CFG Construction Methods
  // ============================================

  /**
   * Build CFG from an AST node.
   * Returns the IDs of nodes that flow out of this construct.
   */
  private buildCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const nodeType = node.type;

    switch (nodeType) {
      case 'program':
      case 'Program':
      case 'statement_block':
      case 'BlockStatement':
        return this.buildBlockCFG(node, predecessors, context);

      case 'if_statement':
      case 'IfStatement':
        return this.buildIfCFG(node, predecessors, context);

      case 'for_statement':
      case 'ForStatement':
        return this.buildForCFG(node, predecessors, context);

      case 'for_in_statement':
      case 'ForInStatement':
      case 'for_of_statement':
      case 'ForOfStatement':
        return this.buildForInOfCFG(node, predecessors, context);

      case 'while_statement':
      case 'WhileStatement':
        return this.buildWhileCFG(node, predecessors, context);

      case 'do_statement':
      case 'DoWhileStatement':
        return this.buildDoWhileCFG(node, predecessors, context);

      case 'switch_statement':
      case 'SwitchStatement':
        return this.buildSwitchCFG(node, predecessors, context);

      case 'try_statement':
      case 'TryStatement':
        return this.buildTryCFG(node, predecessors, context);

      case 'return_statement':
      case 'ReturnStatement':
        return this.buildReturnCFG(node, predecessors, context);

      case 'throw_statement':
      case 'ThrowStatement':
        return this.buildThrowCFG(node, predecessors, context);

      case 'break_statement':
      case 'BreakStatement':
        return this.buildBreakCFG(node, predecessors, context);

      case 'continue_statement':
      case 'ContinueStatement':
        return this.buildContinueCFG(node, predecessors, context);

      case 'expression_statement':
      case 'ExpressionStatement':
      case 'variable_declaration':
      case 'VariableDeclaration':
      case 'lexical_declaration':
        return this.buildStatementCFG(node, predecessors, context);

      default:
        // For other nodes, create a statement node and continue
        if (this.isStatement(node)) {
          return this.buildStatementCFG(node, predecessors, context);
        }
        // For non-statements, just pass through
        return predecessors;
    }
  }

  /**
   * Build CFG for a block of statements.
   */
  private buildBlockCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    let currentPreds = predecessors;

    for (const child of node.children) {
      if (this.isStatement(child)) {
        currentPreds = this.buildCFG(child, currentPreds, context);

        // If no predecessors, remaining statements are unreachable
        if (currentPreds.length === 0) {
          break;
        }
      }
    }

    return currentPreds;
  }

  /**
   * Build CFG for an if statement.
   */
  private buildIfCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    // Create branch node for the condition
    const branchNode = this.createNode('branch', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    // Connect predecessors to branch
    for (const pred of predecessors) {
      this.addEdge(pred, branchNode.id);
    }

    // Find consequence and alternative
    const consequence = this.findChildByType(node, 'statement_block') ||
                        this.findChildByType(node, 'BlockStatement') ||
                        node.children.find(c => this.isStatement(c) && c.type !== 'else_clause');

    const elseClause = this.findChildByType(node, 'else_clause');
    const alternative = elseClause?.children.find(c => this.isStatement(c));

    const exitNodes: string[] = [];

    // Build true branch
    if (consequence) {
      const trueExits = this.buildCFG(consequence, [branchNode.id], context);
      exitNodes.push(...trueExits);
    } else {
      exitNodes.push(branchNode.id);
    }

    // Build false branch
    if (alternative) {
      const falseExits = this.buildCFG(alternative, [branchNode.id], context);
      exitNodes.push(...falseExits);
    } else {
      exitNodes.push(branchNode.id);
    }

    // Create merge node if there are multiple exits
    if (exitNodes.length > 1) {
      const mergeNode = this.createNode('merge', {
        start: node.endPosition,
        end: node.endPosition,
      });

      for (const exit of exitNodes) {
        this.addEdge(exit, mergeNode.id);
      }

      return [mergeNode.id];
    }

    return exitNodes;
  }

  /**
   * Build CFG for a for statement.
   */
  private buildForCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    // Create loop entry node
    const loopNode = this.createNode('loop', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    // Create exit node for break statements
    const exitNode = this.createNode('merge', {
      start: node.endPosition,
      end: node.endPosition,
    });

    // Update context for loop
    const loopContext: FlowContext = {
      ...context,
      inLoop: true,
      loopEntry: loopNode.id,
      loopExit: exitNode.id,
    };

    // Connect predecessors to loop entry
    for (const pred of predecessors) {
      this.addEdge(pred, loopNode.id);
    }

    // Find loop body
    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement') ||
                 node.children.find(c => this.isStatement(c));

    // Build loop body
    let bodyExits: string[] = [loopNode.id];
    if (body) {
      bodyExits = this.buildCFG(body, [loopNode.id], loopContext);
    }

    // Connect body exits back to loop (back edge)
    for (const exit of bodyExits) {
      this.addEdge(exit, loopNode.id, undefined, true);
    }

    // Connect loop to exit (condition false)
    this.addEdge(loopNode.id, exitNode.id);

    // Check for infinite loop (no exit path from body)
    if (this.options.detectInfiniteLoops) {
      this.checkInfiniteLoop(node, bodyExits);
    }

    return [exitNode.id];
  }

  /**
   * Build CFG for a for-in or for-of statement.
   */
  private buildForInOfCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    // Similar to for loop
    const loopNode = this.createNode('loop', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    const exitNode = this.createNode('merge', {
      start: node.endPosition,
      end: node.endPosition,
    });

    const loopContext: FlowContext = {
      ...context,
      inLoop: true,
      loopEntry: loopNode.id,
      loopExit: exitNode.id,
    };

    for (const pred of predecessors) {
      this.addEdge(pred, loopNode.id);
    }

    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement') ||
                 node.children.find(c => this.isStatement(c));

    let bodyExits: string[] = [loopNode.id];
    if (body) {
      bodyExits = this.buildCFG(body, [loopNode.id], loopContext);
    }

    for (const exit of bodyExits) {
      this.addEdge(exit, loopNode.id, undefined, true);
    }

    this.addEdge(loopNode.id, exitNode.id);

    return [exitNode.id];
  }

  /**
   * Build CFG for a while statement.
   */
  private buildWhileCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const loopNode = this.createNode('loop', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    const exitNode = this.createNode('merge', {
      start: node.endPosition,
      end: node.endPosition,
    });

    const loopContext: FlowContext = {
      ...context,
      inLoop: true,
      loopEntry: loopNode.id,
      loopExit: exitNode.id,
    };

    for (const pred of predecessors) {
      this.addEdge(pred, loopNode.id);
    }

    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement') ||
                 node.children.find(c => this.isStatement(c));

    let bodyExits: string[] = [loopNode.id];
    if (body) {
      bodyExits = this.buildCFG(body, [loopNode.id], loopContext);
    }

    for (const exit of bodyExits) {
      this.addEdge(exit, loopNode.id, undefined, true);
    }

    this.addEdge(loopNode.id, exitNode.id);

    // Check for infinite loop
    if (this.options.detectInfiniteLoops) {
      this.checkInfiniteLoop(node, bodyExits);
    }

    return [exitNode.id];
  }

  /**
   * Build CFG for a do-while statement.
   */
  private buildDoWhileCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const loopNode = this.createNode('loop', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    const exitNode = this.createNode('merge', {
      start: node.endPosition,
      end: node.endPosition,
    });

    const loopContext: FlowContext = {
      ...context,
      inLoop: true,
      loopEntry: loopNode.id,
      loopExit: exitNode.id,
    };

    // Connect predecessors directly to body (do-while executes at least once)
    for (const pred of predecessors) {
      this.addEdge(pred, loopNode.id);
    }

    const body = this.findChildByType(node, 'statement_block') ||
                 this.findChildByType(node, 'BlockStatement') ||
                 node.children.find(c => this.isStatement(c));

    let bodyExits: string[] = [loopNode.id];
    if (body) {
      bodyExits = this.buildCFG(body, [loopNode.id], loopContext);
    }

    // Body exits go to condition check, which can loop back or exit
    for (const exit of bodyExits) {
      this.addEdge(exit, loopNode.id, undefined, true);
    }

    this.addEdge(loopNode.id, exitNode.id);

    return [exitNode.id];
  }

  /**
   * Build CFG for a switch statement.
   */
  private buildSwitchCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const branchNode = this.createNode('branch', {
      start: node.startPosition,
      end: node.startPosition,
    }, node);

    const exitNode = this.createNode('merge', {
      start: node.endPosition,
      end: node.endPosition,
    });

    const switchContext: FlowContext = {
      ...context,
      switchExit: exitNode.id,
    };

    for (const pred of predecessors) {
      this.addEdge(pred, branchNode.id);
    }

    // Find switch body
    const switchBody = this.findChildByType(node, 'switch_body') ||
                       node.children.find(c => c.type === 'switch_body' || c.type === 'SwitchCase');

    const caseExits: string[] = [];
    let hasDefault = false;
    let fallthrough: string[] = [branchNode.id];

    if (switchBody) {
      for (const caseNode of switchBody.children) {
        if (caseNode.type === 'switch_case' || caseNode.type === 'SwitchCase' ||
            caseNode.type === 'switch_default' || caseNode.type === 'default') {
          if (caseNode.type === 'switch_default' || caseNode.type === 'default') {
            hasDefault = true;
          }

          // Build case body
          const caseBody = caseNode.children.filter(c => this.isStatement(c));
          let caseCurrentPreds = [...fallthrough, branchNode.id];

          for (const stmt of caseBody) {
            caseCurrentPreds = this.buildCFG(stmt, caseCurrentPreds, switchContext);
            if (caseCurrentPreds.length === 0) {break;}
          }

          // Fallthrough to next case
          fallthrough = caseCurrentPreds;
        }
      }
    }

    // Connect remaining fallthrough to exit
    caseExits.push(...fallthrough);

    // If no default, branch can go directly to exit
    if (!hasDefault) {
      this.addEdge(branchNode.id, exitNode.id);
    }

    for (const exit of caseExits) {
      this.addEdge(exit, exitNode.id);
    }

    return [exitNode.id];
  }

  /**
   * Build CFG for a try statement.
   */
  private buildTryCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const tryContext: FlowContext = {
      ...context,
      inTry: true,
    };

    const exitNodes: string[] = [];

    // Find try block
    const tryBlock = this.findChildByType(node, 'statement_block') ||
                     this.findChildByType(node, 'BlockStatement');

    // Build try block
    let tryExits: string[] = predecessors;
    if (tryBlock) {
      tryExits = this.buildCFG(tryBlock, predecessors, tryContext);
    }
    exitNodes.push(...tryExits);

    // Find catch clause
    const catchClause = this.findChildByType(node, 'catch_clause') ||
                        this.findChildByType(node, 'CatchClause');

    if (catchClause) {
      // Catch can be entered from any point in try block
      const catchExits = this.buildCFG(catchClause, predecessors, context);
      exitNodes.push(...catchExits);
    }

    // Find finally clause
    const finallyClause = this.findChildByType(node, 'finally_clause') ||
                          this.findChildByType(node, 'FinallyClause');

    if (finallyClause) {
      // Finally is always executed
      const finallyBlock = this.findChildByType(finallyClause, 'statement_block') ||
                           this.findChildByType(finallyClause, 'BlockStatement');
      if (finallyBlock) {
        const finallyExits = this.buildCFG(finallyBlock, exitNodes, context);
        return finallyExits;
      }
    }

    // Create merge node
    if (exitNodes.length > 1) {
      const mergeNode = this.createNode('merge', {
        start: node.endPosition,
        end: node.endPosition,
      });

      for (const exit of exitNodes) {
        this.addEdge(exit, mergeNode.id);
      }

      return [mergeNode.id];
    }

    return exitNodes;
  }

  /**
   * Build CFG for a return statement.
   */
  private buildReturnCFG(
    node: ASTNode,
    predecessors: string[],
    _context: FlowContext
  ): string[] {
    const returnNode = this.createNode('return', {
      start: node.startPosition,
      end: node.endPosition,
    }, node);

    for (const pred of predecessors) {
      this.addEdge(pred, returnNode.id);
    }

    // Connect to exit
    for (const exitId of this.exitNodeIds) {
      this.addEdge(returnNode.id, exitId);
    }

    // Return terminates flow - no successors
    return [];
  }

  /**
   * Build CFG for a throw statement.
   */
  private buildThrowCFG(
    node: ASTNode,
    predecessors: string[],
    _context: FlowContext
  ): string[] {
    const throwNode = this.createNode('throw', {
      start: node.startPosition,
      end: node.endPosition,
    }, node);

    for (const pred of predecessors) {
      this.addEdge(pred, throwNode.id);
    }

    // Throw terminates normal flow
    // In a try block, it would go to catch, but we simplify here
    return [];
  }

  /**
   * Build CFG for a break statement.
   */
  private buildBreakCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const breakNode = this.createNode('break', {
      start: node.startPosition,
      end: node.endPosition,
    }, node);

    for (const pred of predecessors) {
      this.addEdge(pred, breakNode.id);
    }

    // Connect to loop/switch exit
    const exitTarget = context.switchExit || context.loopExit;
    if (exitTarget) {
      this.addEdge(breakNode.id, exitTarget);
    }

    // Break terminates normal flow
    return [];
  }

  /**
   * Build CFG for a continue statement.
   */
  private buildContinueCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const continueNode = this.createNode('continue', {
      start: node.startPosition,
      end: node.endPosition,
    }, node);

    for (const pred of predecessors) {
      this.addEdge(pred, continueNode.id);
    }

    // Connect to loop entry
    if (context.loopEntry) {
      this.addEdge(continueNode.id, context.loopEntry, undefined, true);
    }

    // Continue terminates normal flow
    return [];
  }

  /**
   * Build CFG for a regular statement.
   */
  private buildStatementCFG(
    node: ASTNode,
    predecessors: string[],
    context: FlowContext
  ): string[] {
    const stmtNode = this.createNode('statement', {
      start: node.startPosition,
      end: node.endPosition,
    }, node);

    for (const pred of predecessors) {
      this.addEdge(pred, stmtNode.id);
    }

    // Collect variable declarations
    this.collectVariableDeclarations(node, context);

    return [stmtNode.id];
  }

  // ============================================
  // Data Flow Analysis Methods
  // ============================================

  /**
   * Analyze data flow in an AST.
   */
  private analyzeDataFlow(node: ASTNode, context: FlowContext): DataFlowInfo {
    const reads: DataFlowVariable[] = [];
    const writes: DataFlowVariable[] = [];
    const captures: DataFlowVariable[] = [];
    const nullDereferences: SourceLocation[] = [];
    const unusedVariables: string[] = [];
    const uninitializedReads: DataFlowVariable[] = [];

    // Traverse AST to collect data flow information
    this.traverseForDataFlow(node, context, reads, writes, captures);

    // Detect unused variables
    if (this.options.detectUnusedVariables) {
      for (const [name, state] of context.variables) {
        if (!state.isRead && state.isWritten) {
          unusedVariables.push(name);
        }
      }
    }

    // Detect uninitialized reads
    if (this.options.detectUninitializedReads) {
      for (const read of reads) {
        const state = context.variables.get(read.name);
        if (state && !state.isInitialized) {
          uninitializedReads.push(read);
        }
      }
    }

    // Detect null dereferences
    if (this.options.detectNullDereferences) {
      this.detectNullDereferences(node, nullDereferences);
    }

    return {
      reads,
      writes,
      captures,
      nullDereferences,
      unusedVariables,
      uninitializedReads,
    };
  }

  /**
   * Traverse AST for data flow information.
   */
  private traverseForDataFlow(
    node: ASTNode,
    context: FlowContext,
    reads: DataFlowVariable[],
    writes: DataFlowVariable[],
    captures: DataFlowVariable[]
  ): void {
    const nodeType = node.type;

    // Handle identifier reads
    if (nodeType === 'identifier' || nodeType === 'Identifier') {
      const name = node.text;
      const state = context.variables.get(name);

      if (state) {
        // Check if this is a read or write context
        const parent = this.getParentContext(node);
        if (parent === 'read') {
          reads.push({
            name,
            location: { start: node.startPosition, end: node.endPosition },
          });
          state.isRead = true;
          state.readLocations.push({ start: node.startPosition, end: node.endPosition });
        } else if (parent === 'write') {
          writes.push({
            name,
            location: { start: node.startPosition, end: node.endPosition },
          });
          state.isWritten = true;
          state.isInitialized = true;
          state.writeLocations.push({ start: node.startPosition, end: node.endPosition });
        }
      } else if (context.parentContext) {
        // Variable from outer scope - captured
        const outerState = this.findVariableInParentContext(name, context.parentContext);
        if (outerState) {
          captures.push({
            name,
            location: { start: node.startPosition, end: node.endPosition },
          });
          outerState.isCaptured = true;
        }
      }
    }

    // Handle assignment expressions
    if (nodeType === 'assignment_expression' || nodeType === 'AssignmentExpression') {
      const left = node.children[0];
      if (left && (left.type === 'identifier' || left.type === 'Identifier')) {
        const name = left.text;
        const state = context.variables.get(name);
        if (state) {
          writes.push({
            name,
            location: { start: left.startPosition, end: left.endPosition },
          });
          state.isWritten = true;
          state.isInitialized = true;
          state.writeLocations.push({ start: left.startPosition, end: left.endPosition });
        }
      }
    }

    // Handle update expressions (++, --)
    if (nodeType === 'update_expression' || nodeType === 'UpdateExpression') {
      const operand = node.children.find(c => c.type === 'identifier' || c.type === 'Identifier');
      if (operand) {
        const name = operand.text;
        const state = context.variables.get(name);
        if (state) {
          // Update is both read and write
          reads.push({
            name,
            location: { start: operand.startPosition, end: operand.endPosition },
          });
          writes.push({
            name,
            location: { start: operand.startPosition, end: operand.endPosition },
          });
          state.isRead = true;
          state.isWritten = true;
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      this.traverseForDataFlow(child, context, reads, writes, captures);
    }
  }

  /**
   * Detect potential null/undefined dereferences.
   */
  private detectNullDereferences(node: ASTNode, locations: SourceLocation[]): void {
    // Look for member access on potentially null values
    if (node.type === 'member_expression' || node.type === 'MemberExpression') {
      const object = node.children[0];
      if (object && this.isPotentiallyNull(object)) {
        locations.push({
          start: node.startPosition,
          end: node.endPosition,
        });
      }
    }

    // Look for call expressions on potentially null values
    if (node.type === 'call_expression' || node.type === 'CallExpression') {
      const callee = node.children[0];
      if (callee && this.isPotentiallyNull(callee)) {
        locations.push({
          start: node.startPosition,
          end: node.endPosition,
        });
      }
    }

    // Recurse
    for (const child of node.children) {
      this.detectNullDereferences(child, locations);
    }
  }

  /**
   * Check if an expression is potentially null/undefined.
   */
  private isPotentiallyNull(node: ASTNode): boolean {
    // Check for null/undefined literals
    if (node.type === 'null' || node.text === 'null' ||
        node.type === 'undefined' || node.text === 'undefined') {
      return true;
    }

    // Check for optional chaining result
    if (node.type === 'optional_chain_expression' || node.type === 'OptionalMemberExpression') {
      return true;
    }

    // Check for conditional expression that might be null
    if (node.type === 'ternary_expression' || node.type === 'ConditionalExpression') {
      const consequent = node.children[1];
      const alternate = node.children[2];
      const consequentNull = consequent ? this.isPotentiallyNull(consequent) : false;
      const alternateNull = alternate ? this.isPotentiallyNull(alternate) : false;
      return consequentNull || alternateNull;
    }

    return false;
  }

  // ============================================
  // Detection Methods
  // ============================================

  /**
   * Mark all reachable nodes starting from entry.
   */
  private markReachableNodes(): void {
    if (!this.entryNodeId) {return;}

    const visited = new Set<string>();
    const queue = [this.entryNodeId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) {continue;}

      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        node.isReachable = true;
        for (const outgoing of node.outgoing) {
          if (!visited.has(outgoing)) {
            queue.push(outgoing);
          }
        }
      }
    }
  }

  /**
   * Detect unreachable code.
   */
  private detectUnreachableCode(): void {
    for (const node of this.nodes.values()) {
      if (!node.isReachable && node.kind !== 'entry' && node.kind !== 'exit' &&
          node.kind !== 'merge' && node.astNode) {
        this.unreachableCode.push(node.location);
      }
    }
  }

  /**
   * Check for infinite loops.
   */
  private checkInfiniteLoop(node: ASTNode, _bodyExits: string[]): void {
    // A loop is potentially infinite if:
    // 1. The condition is always true (while(true))
    // 2. There's no break/return in the body

    const condition = this.findCondition(node);
    if (condition) {
      // Check for literal true
      if (condition.text === 'true' || condition.text === '1') {
        // Check if there's a break or return in the body
        if (!this.hasBreakOrReturn(node)) {
          this.infiniteLoops.push({
            start: node.startPosition,
            end: node.endPosition,
          });
        }
      }
    }
  }

  /**
   * Check for missing return statements.
   */
  private checkMissingReturns(node: ASTNode, lastNodes: string[]): void {
    // Check if function has a return type annotation
    const returnType = this.findChildByType(node, 'type_annotation') ||
                       this.findChildByType(node, 'return_type');

    if (returnType) {
      // Check if return type is void
      const typeText = returnType.text;
      if (typeText.includes('void') || typeText.includes('undefined')) {
        return; // void functions don't need explicit return
      }

      // Check if all paths return
      for (const nodeId of lastNodes) {
        const cfgNode = this.nodes.get(nodeId);
        if (cfgNode && cfgNode.kind !== 'return' && cfgNode.kind !== 'throw') {
          this.missingReturns.push({
            start: node.startPosition,
            end: node.endPosition,
          });
          break;
        }
      }
    }
  }

  /**
   * Find the condition expression in a loop/if.
   */
  private findCondition(node: ASTNode): ASTNode | null {
    // Look for parenthesized expression or condition
    for (const child of node.children) {
      if (child.type === 'parenthesized_expression' ||
          child.type === 'condition') {
        return child.children[0] || child;
      }
    }
    return null;
  }

  /**
   * Check if a node contains break or return.
   */
  private hasBreakOrReturn(node: ASTNode): boolean {
    if (node.type === 'break_statement' || node.type === 'BreakStatement' ||
        node.type === 'return_statement' || node.type === 'ReturnStatement') {
      return true;
    }

    for (const child of node.children) {
      if (this.hasBreakOrReturn(child)) {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Reset analyzer state.
   */
  private reset(): void {
    this.nodeIdCounter = 0;
    this.nodes.clear();
    this.edges = [];
    this.entryNodeId = null;
    this.exitNodeIds.clear();
    this.unreachableCode = [];
    this.infiniteLoops = [];
    this.missingReturns = [];
    this.options = {};
  }

  /**
   * Create a new CFG node.
   */
  private createNode(
    kind: ControlFlowNodeKind,
    location: SourceLocation,
    astNode?: ASTNode
  ): InternalCFGNode {
    const id = `cfg_${this.nodeIdCounter++}`;
    const node: InternalCFGNode = {
      id,
      kind,
      location,
      outgoing: new Set(),
      incoming: new Set(),
      isReachable: false,
    };
    if (astNode !== undefined) {
      node.astNode = astNode;
    }
    this.nodes.set(id, node);
    return node;
  }

  /**
   * Add an edge between two nodes.
   */
  private addEdge(
    from: string,
    to: string,
    label?: string,
    isBackEdge: boolean = false
  ): void {
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);

    if (fromNode && toNode) {
      fromNode.outgoing.add(to);
      toNode.incoming.add(from);

      const edge: ControlFlowEdge = {
        from,
        to,
        isBackEdge,
      };
      if (label !== undefined) {
        edge.label = label;
      }
      this.edges.push(edge);
    }
  }

  /**
   * Create a flow context.
   */
  private createFlowContext(parent: FlowContext | null): FlowContext {
    return {
      variables: new Map(),
      parentContext: parent,
      inLoop: false,
      inTry: false,
      loopEntry: null,
      loopExit: null,
      switchExit: null,
    };
  }

  /**
   * Collect function parameters into context.
   */
  private collectFunctionParameters(node: ASTNode, context: FlowContext): void {
    const params = this.findChildByType(node, 'formal_parameters') ||
                   this.findChildByType(node, 'parameters');

    if (params) {
      for (const param of params.children) {
        const name = this.getParameterName(param);
        if (name) {
          context.variables.set(name, {
            name,
            isInitialized: true, // Parameters are initialized
            isRead: false,
            isWritten: false,
            isCaptured: false,
            declarationLocation: { start: param.startPosition, end: param.endPosition },
            readLocations: [],
            writeLocations: [],
          });
        }
      }
    }
  }

  /**
   * Collect variable declarations into context.
   */
  private collectVariableDeclarations(node: ASTNode, context: FlowContext): void {
    if (node.type === 'variable_declaration' || node.type === 'VariableDeclaration' ||
        node.type === 'lexical_declaration') {
      for (const child of node.children) {
        if (child.type === 'variable_declarator' || child.type === 'VariableDeclarator') {
          const nameNode = child.children[0];
          if (nameNode && (nameNode.type === 'identifier' || nameNode.type === 'Identifier')) {
            const name = nameNode.text;
            const hasInitializer = child.children.length > 1;

            context.variables.set(name, {
              name,
              isInitialized: hasInitializer,
              isRead: false,
              isWritten: hasInitializer,
              isCaptured: false,
              declarationLocation: { start: nameNode.startPosition, end: nameNode.endPosition },
              readLocations: [],
              writeLocations: hasInitializer
                ? [{ start: nameNode.startPosition, end: nameNode.endPosition }]
                : [],
            });
          }
        }
      }
    }

    // Recurse for nested declarations
    for (const child of node.children) {
      this.collectVariableDeclarations(child, context);
    }
  }

  /**
   * Get parameter name from a parameter node.
   */
  private getParameterName(node: ASTNode): string | null {
    if (node.type === 'identifier' || node.type === 'Identifier') {
      return node.text;
    }

    if (node.type === 'required_parameter' || node.type === 'optional_parameter') {
      const id = this.findChildByType(node, 'identifier') ||
                 this.findChildByType(node, 'Identifier');
      return id?.text || null;
    }

    // Handle destructuring patterns
    if (node.type === 'object_pattern' || node.type === 'array_pattern') {
      return null; // Skip destructuring for now
    }

    return null;
  }

  /**
   * Find a child node by type.
   */
  private findChildByType(node: ASTNode, type: string): ASTNode | null {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return null;
  }

  /**
   * Check if a node is a statement.
   */
  private isStatement(node: ASTNode): boolean {
    const type = node.type;
    return type.includes('statement') ||
           type.includes('Statement') ||
           type.includes('declaration') ||
           type.includes('Declaration') ||
           type === 'if_statement' ||
           type === 'for_statement' ||
           type === 'while_statement' ||
           type === 'do_statement' ||
           type === 'switch_statement' ||
           type === 'try_statement' ||
           type === 'return_statement' ||
           type === 'throw_statement' ||
           type === 'break_statement' ||
           type === 'continue_statement' ||
           type === 'expression_statement' ||
           type === 'lexical_declaration';
  }

  /**
   * Get the parent context for an identifier (read or write).
   */
  private getParentContext(_node: ASTNode): 'read' | 'write' {
    // Simplified: assume read unless in assignment left-hand side
    // A more complete implementation would track the AST path
    return 'read';
  }

  /**
   * Find a variable in parent contexts.
   */
  private findVariableInParentContext(
    name: string,
    context: FlowContext
  ): VariableState | null {
    let current: FlowContext | null = context;

    while (current) {
      const state = current.variables.get(name);
      if (state) {
        return state;
      }
      current = current.parentContext;
    }

    return null;
  }

  /**
   * Build the final result.
   */
  private buildResult(dataFlow: DataFlowInfo): FlowAnalysisResult {
    // Convert internal nodes to external format
    const nodes: ControlFlowNode[] = [];
    const exits: ControlFlowNode[] = [];

    for (const internal of this.nodes.values()) {
      const external: ControlFlowNode = {
        id: internal.id,
        kind: internal.kind,
        location: internal.location,
        outgoing: Array.from(internal.outgoing),
        incoming: Array.from(internal.incoming),
        isReachable: internal.isReachable,
      };
      if (internal.astNode !== undefined) {
        external.astNode = internal.astNode;
      }

      nodes.push(external);

      if (this.exitNodeIds.has(internal.id)) {
        exits.push(external);
      }
    }

    // Find entry node
    const entryNode = nodes.find(n => n.id === this.entryNodeId);
    if (!entryNode) {
      throw new Error('Entry node not found');
    }

    const controlFlow: ControlFlowGraph = {
      entry: entryNode,
      exits,
      nodes,
      edges: this.edges,
    };

    return {
      controlFlow,
      dataFlow,
      unreachableCode: this.unreachableCode,
      infiniteLoops: this.infiniteLoops,
      missingReturns: this.missingReturns,
    };
  }

  // ============================================
  // Public Utility Methods
  // ============================================

  /**
   * Get all nodes in the CFG.
   */
  getNodes(): ControlFlowNode[] {
    return Array.from(this.nodes.values()).map(internal => {
      const node: ControlFlowNode = {
        id: internal.id,
        kind: internal.kind,
        location: internal.location,
        outgoing: Array.from(internal.outgoing),
        incoming: Array.from(internal.incoming),
        isReachable: internal.isReachable,
      };
      if (internal.astNode !== undefined) {
        node.astNode = internal.astNode;
      }
      return node;
    });
  }

  /**
   * Get all edges in the CFG.
   */
  getEdges(): ControlFlowEdge[] {
    return [...this.edges];
  }

  /**
   * Check if a node is reachable.
   */
  isNodeReachable(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    return node?.isReachable ?? false;
  }

  /**
   * Get predecessors of a node.
   */
  getPredecessors(nodeId: string): string[] {
    const node = this.nodes.get(nodeId);
    return node ? Array.from(node.incoming) : [];
  }

  /**
   * Get successors of a node.
   */
  getSuccessors(nodeId: string): string[] {
    const node = this.nodes.get(nodeId);
    return node ? Array.from(node.outgoing) : [];
  }
}
