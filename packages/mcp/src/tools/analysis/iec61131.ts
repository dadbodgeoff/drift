/**
 * IEC 61131-3 Analysis MCP Tool
 *
 * Analyze industrial automation code: docstrings, state machines, safety interlocks, tribal knowledge.
 * 
 * This is a thin wrapper around driftdetect-core/iec61131.
 * All logic lives in the core library for CLI/MCP parity.
 */

import { IEC61131Analyzer } from 'driftdetect-core/iec61131';
import type {
  DocstringExtractionResult,
  StateMachineExtractionResult,
  SafetyAnalysisResult,
  TribalKnowledgeExtractionResult,
  VariableExtractionResult,
  TargetLanguage,
  IOMapping,
  ExtractedDocstring,
  StateMachine,
  StateMachineState,
  SafetyInterlock,
  SafetyBypass,
  SafetyCriticalWarning,
  TribalKnowledgeItem,
  ExtractedVariable,
  MigrationReadinessReport,
  STCallGraph,
} from 'driftdetect-core/iec61131';

// ============================================================================
// Types
// ============================================================================

export type IEC61131Action =
  | 'status'           // Project overview
  | 'docstrings'       // Extract all docstrings (PhD's primary request)
  | 'state-machines'   // Find CASE-based state machines
  | 'safety'           // Safety interlocks and bypasses
  | 'tribal-knowledge' // Warnings, workarounds, institutional knowledge
  | 'blocks'           // PROGRAM/FUNCTION_BLOCK/FUNCTION definitions
  | 'variables'        // Extract all variables with types
  | 'io-map'           // I/O address mapping
  | 'migration'        // Migration readiness scoring
  | 'ai-context'       // Generate AI context package
  | 'call-graph'       // Build call graph
  | 'all';             // Full analysis

export interface IEC61131Args {
  action: IEC61131Action;
  path?: string;
  file?: string;
  limit?: number;
  includeRaw?: boolean;
  format?: 'json' | 'markdown';
  targetLanguage?: TargetLanguage;
  maxTokens?: number;
}

export interface ToolContext {
  projectRoot: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

export async function executeIEC61131Tool(
  args: IEC61131Args,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectPath = args.path ?? context.projectRoot;
  const limit = args.limit ?? 50;
  const includeRaw = args.includeRaw ?? false;

  // Create analyzer
  const analyzer = new IEC61131Analyzer();
  await analyzer.initialize(projectPath);

  let result: unknown;

  try {
    switch (args.action) {
      case 'status':
        result = await analyzer.status();
        break;

      case 'docstrings':
        result = formatDocstrings(
          await analyzer.docstrings(undefined, { includeRaw, limit })
        );
        break;

      case 'state-machines':
        result = formatStateMachines(
          await analyzer.stateMachines(undefined, { limit })
        );
        break;

      case 'safety':
        result = formatSafety(await analyzer.safety());
        break;

      case 'tribal-knowledge':
        result = formatTribalKnowledge(
          await analyzer.tribalKnowledge(undefined, { limit })
        );
        break;

      case 'blocks':
        result = await analyzer.blocks(undefined, { limit });
        break;

      case 'variables':
        result = formatVariables(
          await analyzer.variables(undefined, { limit })
        );
        break;

      case 'io-map': {
        const varResult = await analyzer.variables();
        result = {
          ioMappings: varResult.ioMappings,
          summary: {
            total: varResult.ioMappings.length,
            inputs: varResult.ioMappings.filter((io: IOMapping) => io.isInput).length,
            outputs: varResult.ioMappings.filter((io: IOMapping) => !io.isInput).length,
          },
        };
        break;
      }

      case 'migration':
        result = formatMigrationReadiness(
          await analyzer.migrationReadiness()
        );
        break;

      case 'ai-context': {
        const targetLang = args.targetLanguage ?? 'python';
        const options = args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {};
        result = await analyzer.generateAIContext(targetLang, undefined, options);
        break;
      }

      case 'call-graph':
        result = formatCallGraph(await analyzer.buildCallGraph());
        break;

      case 'all':
        result = await analyzer.fullAnalysis();
        break;

      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: true,
          message: error instanceof Error ? error.message : 'Unknown error',
          action: args.action,
          path: projectPath,
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

// ============================================================================
// Formatters
// ============================================================================

function formatDocstrings(result: DocstringExtractionResult): unknown {
  return {
    total: result.summary.total,
    byBlock: result.summary.byBlock,
    withParams: result.summary.withParams,
    withHistory: result.summary.withHistory,
    withWarnings: result.summary.withWarnings,
    averageQuality: Math.round(result.summary.averageQuality),
    docstrings: result.docstrings.map((d: ExtractedDocstring) => ({
      file: d.file,
      line: d.location.line,
      endLine: d.location.endLine,
      summary: d.summary,
      description: d.description,
      associatedBlock: d.associatedBlock,
      params: d.params,
      returns: d.returns,
      history: d.history,
      warnings: d.warnings,
      quality: d.quality.completeness,
      ...(d.raw ? { raw: d.raw } : {}),
    })),
    truncated: result.docstrings.length < result.summary.total,
    summary: `${result.summary.total} docstrings extracted`,
  };
}

function formatStateMachines(result: StateMachineExtractionResult): unknown {
  return {
    total: result.summary.total,
    totalStates: result.summary.totalStates,
    byVariable: result.summary.byVariable,
    withDeadlocks: result.summary.withDeadlocks,
    withGaps: result.summary.withGaps,
    machines: result.stateMachines.map((sm: StateMachine) => ({
      file: sm.location.file,
      name: sm.name,
      variable: sm.stateVariable,
      stateCount: sm.states.length,
      states: sm.states.map((s: StateMachineState) => ({
        value: s.value,
        name: s.name,
        isInitial: s.isInitial,
        isFinal: s.isFinal,
        documentation: s.documentation,
      })),
      transitions: sm.transitions.length,
      verification: sm.verification,
      diagram: sm.visualizations.mermaid,
    })),
    truncated: result.stateMachines.length < result.summary.total,
    summary: `${result.summary.total} state machines with ${result.summary.totalStates} total states`,
  };
}

function formatSafety(result: SafetyAnalysisResult): unknown {
  return {
    total: result.summary.totalInterlocks,
    byType: result.summary.byType,
    bypassed: {
      count: result.bypasses.length,
      items: result.bypasses.map((b: SafetyBypass) => ({
        name: b.name,
        file: b.location.file,
        line: b.location.line,
        affectedInterlocks: b.affectedInterlocks,
      })),
    },
    criticalWarnings: result.criticalWarnings.map((w: SafetyCriticalWarning) => ({
      type: w.type,
      message: w.message,
      severity: w.severity,
      file: w.location.file,
      line: w.location.line,
      remediation: w.remediation,
    })),
    interlocks: result.interlocks.map((il: SafetyInterlock) => ({
      file: il.location.file,
      name: il.name,
      type: il.type,
      line: il.location.line,
      isBypassed: il.isBypassed,
      severity: il.severity,
    })),
    summary: `${result.summary.totalInterlocks} safety interlocks, ${result.bypasses.length} BYPASSED`,
    warning: result.bypasses.length > 0
      ? `⚠️ ${result.bypasses.length} safety bypass(es) detected - review immediately!`
      : undefined,
  };
}

function formatTribalKnowledge(result: TribalKnowledgeExtractionResult): unknown {
  return {
    total: result.summary.total,
    byType: result.summary.byType,
    byImportance: result.summary.byImportance,
    criticalCount: result.summary.criticalCount,
    knowledge: result.items.map((k: TribalKnowledgeItem) => ({
      file: k.location.file,
      type: k.type,
      content: k.content,
      line: k.location.line,
      importance: k.importance,
      context: k.context,
    })),
    truncated: result.items.length < result.summary.total,
    summary: `${result.summary.total} tribal knowledge items found`,
    highlights: {
      warnings: result.summary.byType['warning'] ?? 0,
      workarounds: result.summary.byType['workaround'] ?? 0,
      hacks: result.summary.byType['hack'] ?? 0,
      todos: result.summary.byType['todo'] ?? 0,
      critical: result.summary.criticalCount,
    },
  };
}

function formatVariables(result: VariableExtractionResult): unknown {
  return {
    total: result.summary.total,
    bySection: result.summary.bySection,
    withComments: result.summary.withComments,
    withIOAddress: result.summary.withIOAddress,
    safetyCritical: result.summary.safetyCritical,
    variables: result.variables.map((v: ExtractedVariable) => ({
      file: v.file,
      name: v.name,
      type: v.dataType,
      section: v.section,
      line: v.location.line,
      comment: v.comment,
      ioAddress: v.ioAddress,
      isSafetyCritical: v.isSafetyCritical,
      initialValue: v.initialValue,
    })),
    ioMappings: result.ioMappings.map((io: IOMapping) => ({
      address: io.address,
      type: io.addressType,
      variable: io.variableName,
      isInput: io.isInput,
      file: io.location.file,
      line: io.location.line,
    })),
    truncated: result.variables.length < result.summary.total,
    summary: `${result.summary.total} variables, ${result.summary.safetyCritical} safety-critical`,
  };
}


// ============================================================================
// New Formatters for Migration, AI Context, and Call Graph
// ============================================================================

function formatMigrationReadiness(result: MigrationReadinessReport): unknown {
  return {
    overallScore: Math.round(result.overallScore),
    overallGrade: result.overallGrade,
    summary: `Migration readiness: ${result.overallGrade} (${Math.round(result.overallScore)}/100)`,
    pouScores: result.pouScores.map(score => ({
      name: score.pouName,
      type: score.pouType,
      score: Math.round(score.overallScore),
      grade: score.grade,
      dimensions: {
        documentation: Math.round(score.dimensionScores.documentation),
        safety: Math.round(score.dimensionScores.safety),
        complexity: Math.round(score.dimensionScores.complexity),
        dependencies: Math.round(score.dimensionScores.dependencies),
        testability: Math.round(score.dimensionScores.testability),
      },
      blockers: score.blockers.map(b => ({
        type: b.type,
        description: b.description,
        severity: b.severity,
        remediation: b.remediation,
      })),
      warnings: score.warnings,
      suggestions: score.suggestions,
    })),
    migrationOrder: result.migrationOrder.map(item => ({
      order: item.order,
      name: item.pouName,
      reason: item.reason,
      dependencies: item.dependencies,
      estimatedEffort: item.estimatedEffort,
    })),
    risks: result.risks.map(risk => ({
      severity: risk.severity,
      category: risk.category,
      description: risk.description,
      affectedPOUs: risk.affectedPOUs,
      mitigation: risk.mitigation,
    })),
    estimatedEffort: {
      totalHours: result.estimatedEffort.totalHours,
      confidence: Math.round(result.estimatedEffort.confidence * 100) + '%',
      byPOU: result.estimatedEffort.byPOU,
    },
    guidance: generateMigrationGuidance(result),
  };
}

function generateMigrationGuidance(result: MigrationReadinessReport): string[] {
  const guidance: string[] = [];

  if (result.overallScore >= 80) {
    guidance.push('✅ Project is well-prepared for migration');
  } else if (result.overallScore >= 60) {
    guidance.push('⚠️ Project needs some preparation before migration');
  } else {
    guidance.push('🚨 Significant preparation needed before migration');
  }

  const blockedCount = result.pouScores.filter(s => s.blockers.length > 0).length;
  if (blockedCount > 0) {
    guidance.push(`${blockedCount} POU(s) have blockers that must be resolved`);
  }

  const criticalRisks = result.risks.filter(r => r.severity === 'critical');
  if (criticalRisks.length > 0) {
    guidance.push(`${criticalRisks.length} critical risk(s) identified - review immediately`);
  }

  if (result.migrationOrder.length > 0) {
    guidance.push(`Recommended first migration: ${result.migrationOrder[0]?.pouName}`);
  }

  return guidance;
}

function formatCallGraph(result: STCallGraph): unknown {
  const nodes: Array<{
    id: string;
    name: string;
    type: string;
    file: string;
    line: number;
    inputs: unknown[];
    outputs: unknown[];
  }> = Array.from(result.nodes.values());
  const edges = result.edges;

  // Calculate metrics
  const nodesByType: Record<string, number> = {};
  for (const node of nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
  }

  // Find most called functions
  const callCounts: Record<string, number> = {};
  for (const edge of edges) {
    callCounts[edge.calleeName] = (callCounts[edge.calleeName] || 0) + 1;
  }

  const mostCalled = Object.entries(callCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, callCount: count }));

  // Find entry points (nodes with no incoming edges)
  const calledNodes = new Set(edges.map(e => e.calleeName.toLowerCase()));
  const entryPoints = nodes
    .filter(n => !calledNodes.has(n.name.toLowerCase()))
    .map(n => n.name);

  return {
    summary: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      byType: nodesByType,
      entryPoints,
      mostCalled,
    },
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      file: n.file,
      line: n.line,
      inputCount: n.inputs.length,
      outputCount: n.outputs.length,
    })),
    edges: edges.map(e => ({
      from: e.callerId,
      to: e.calleeName,
      type: e.callType,
      file: e.location.file,
      line: e.location.line,
    })),
    mermaid: generateCallGraphMermaid(nodes, edges),
  };
}

function generateCallGraphMermaid(
  nodes: Array<{ name: string; type: string }>,
  edges: Array<{ callerId: string; calleeName: string; callType: string }>
): string {
  const lines: string[] = ['graph TD'];

  // Add nodes with styling
  for (const node of nodes) {
    const shape = node.type === 'PROGRAM' ? `[${node.name}]` :
                  node.type === 'FUNCTION_BLOCK' ? `[[${node.name}]]` :
                  `(${node.name})`;
    lines.push(`  ${node.name}${shape}`);
  }

  // Add edges
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    const edgeKey = `${edge.callerId}->${edge.calleeName}`;
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      const arrow = edge.callType === 'instantiation' ? '-.->|instance|' : '-->';
      // Extract caller name from path
      const callerName = edge.callerId.split(':').pop() || edge.callerId;
      lines.push(`  ${callerName}${arrow}${edge.calleeName}`);
    }
  }

  return lines.join('\n');
}
