/**
 * drift_coupling - Module Coupling Analysis
 * 
 * Analysis tool for module dependencies, cycles, and coupling metrics.
 * Based on Robert C. Martin's coupling metrics (Ca, Ce, Instability, Abstractness, Distance).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  createModuleCouplingAnalyzer,
  createCallGraphAnalyzer,
  type AggregateCouplingMetrics,
  type DependencyCycle,
  type ModuleCouplingAnalysis,
  type RefactorImpact,
  type UnusedExportAnalysis,
  type CouplingMetrics,
} from 'driftdetect-core';

import { createResponseBuilder, Errors } from '../../infrastructure/index.js';

// ============================================================================
// Types
// ============================================================================

export type CouplingAction = 
  | 'status'
  | 'cycles'
  | 'hotspots'
  | 'analyze'
  | 'refactor-impact'
  | 'unused-exports';

export interface CouplingArgs {
  action: CouplingAction;
  module?: string;
  limit?: number;
  minCoupling?: number;
  maxCycleLength?: number;
  minSeverity?: 'info' | 'warning' | 'critical';
}

export interface CouplingStatusData {
  metrics: AggregateCouplingMetrics;
  generatedAt?: string;
}

export interface CouplingCyclesData {
  cycles: DependencyCycle[];
  total: number;
  bySeverity: { critical: number; warning: number; info: number };
}

export interface CouplingHotspotsData {
  hotspots: Array<{ path: string; coupling: number; metrics: CouplingMetrics }>;
  total: number;
}

export interface CouplingAnalyzeData {
  module: string;
  analysis: ModuleCouplingAnalysis;
}

export interface CouplingRefactorData {
  module: string;
  impact: RefactorImpact;
}

export interface CouplingUnusedData {
  unused: UnusedExportAnalysis[];
  total: number;
}

// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const COUPLING_DIR = 'module-coupling';

// ============================================================================
// Handler
// ============================================================================

export async function handleCoupling(
  projectRoot: string,
  args: CouplingArgs
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { action } = args;

  switch (action) {
    case 'status':
      return handleStatus(projectRoot);
    case 'cycles':
      return handleCycles(projectRoot, args.maxCycleLength, args.minSeverity);
    case 'hotspots':
      return handleHotspots(projectRoot, args.limit, args.minCoupling);
    case 'analyze':
      return handleAnalyze(projectRoot, args.module);
    case 'refactor-impact':
      return handleRefactorImpact(projectRoot, args.module);
    case 'unused-exports':
      return handleUnusedExports(projectRoot, args.limit);
    default:
      throw Errors.invalidArgument('action', `Invalid action: ${action}. Valid: status, cycles, hotspots, analyze, refactor-impact, unused-exports`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleStatus(
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingStatusData>();

  // Try to load cached data first
  const graphPath = path.join(projectRoot, DRIFT_DIR, COUPLING_DIR, 'graph.json');
  
  try {
    const data = JSON.parse(await fs.readFile(graphPath, 'utf-8'));
    const { metrics, generatedAt } = data;
    
    let summaryText = `🔗 ${metrics.totalModules} modules, ${metrics.totalEdges} dependencies. `;
    summaryText += `${metrics.cycleCount} cycles. `;
    summaryText += `Avg instability: ${metrics.avgInstability}, distance: ${metrics.avgDistance}.`;
    
    const warnings: string[] = [];
    if (metrics.cycleCount > 0) {
      warnings.push(`${metrics.cycleCount} dependency cycles detected`);
    }
    if (metrics.zoneOfPain.length > 0) {
      warnings.push(`${metrics.zoneOfPain.length} modules in zone of pain`);
    }
    
    const hints = {
      nextActions: metrics.cycleCount > 0
        ? ['Run drift_coupling action="cycles" to see cycle details']
        : ['Coupling looks healthy'],
      warnings: warnings.length > 0 ? warnings : undefined,
      relatedTools: ['drift_coupling action="cycles"', 'drift_coupling action="hotspots"'],
    };
    
    return builder
      .withSummary(summaryText)
      .withData({ metrics, generatedAt })
      .withHints(hints)
      .buildContent();
      
  } catch {
    // No cached data - try to build on-demand from call graph
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      const hotspots = analyzer.getHotspots({ limit: 100 });
      const cycles = analyzer.getCycles();
      
      // Calculate aggregate metrics from hotspots
      const totalModules = hotspots.length;
      const totalEdges = hotspots.reduce((sum, h) => sum + h.coupling, 0);
      const cycleCount = cycles.length;
      const avgInstability = hotspots.length > 0 
        ? hotspots.reduce((sum, h) => sum + h.metrics.instability, 0) / hotspots.length 
        : 0;
      const avgDistance = hotspots.length > 0
        ? hotspots.reduce((sum, h) => sum + h.metrics.distance, 0) / hotspots.length
        : 0;
      
      let summaryText = `🔗 ${totalModules} modules, ${totalEdges} dependencies. `;
      summaryText += `${cycleCount} cycles. `;
      summaryText += `Avg instability: ${avgInstability.toFixed(2)}, distance: ${avgDistance.toFixed(2)}.`;
      
      const warnings: string[] = [];
      if (cycleCount > 0) {
        warnings.push(`${cycleCount} dependency cycles detected`);
      }
      
      const hints = {
        nextActions: cycleCount > 0
          ? ['Run drift_coupling action="cycles" to see cycle details']
          : ['Coupling looks healthy'],
        warnings: warnings.length > 0 ? warnings : undefined,
        relatedTools: ['drift_coupling action="cycles"', 'drift_coupling action="hotspots"'],
      };
      
      return builder
        .withSummary(summaryText)
        .withData({ 
          metrics: { 
            totalModules, 
            totalEdges, 
            cycleCount, 
            avgInstability, 
            avgDistance,
            zoneOfPain: [],
            zoneOfUselessness: [],
            hotspots: [],
            isolatedModules: []
          } as AggregateCouplingMetrics
        })
        .withHints(hints)
        .buildContent();
    } catch {
      // No call graph available - return graceful empty state
      return builder
        .withSummary('🔗 Coupling analysis not available. Run a scan first.')
        .withData({ 
          metrics: { 
            totalModules: 0, 
            totalEdges: 0, 
            cycleCount: 0, 
            avgInstability: 0, 
            avgDistance: 0,
            zoneOfPain: [],
            zoneOfUselessness: [],
            hotspots: [],
            isolatedModules: []
          } as AggregateCouplingMetrics
        })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase first'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }
}

async function handleCycles(
  projectRoot: string,
  maxCycleLength?: number,
  minSeverity?: 'info' | 'warning' | 'critical'
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingCyclesData>();

  // First try cached data
  const graphPath = path.join(projectRoot, DRIFT_DIR, COUPLING_DIR, 'graph.json');
  
  let cycles: DependencyCycle[] = [];
  
  try {
    const data = JSON.parse(await fs.readFile(graphPath, 'utf-8'));
    cycles = data.cycles;
  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      cycles = analyzer.getCycles();
    } catch {
      // Return empty state
      return builder
        .withSummary('🔄 No cycle analysis available. Run a scan first.')
        .withData({ cycles: [], total: 0, bySeverity: { critical: 0, warning: 0, info: 0 } })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }

  // Filter by length
  if (maxCycleLength) {
    cycles = cycles.filter(c => c.length <= maxCycleLength);
  }

  // Filter by severity
  if (minSeverity) {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const minOrder = severityOrder[minSeverity];
    cycles = cycles.filter(c => severityOrder[c.severity] <= minOrder);
  }

  const bySeverity = {
    critical: cycles.filter(c => c.severity === 'critical').length,
    warning: cycles.filter(c => c.severity === 'warning').length,
    info: cycles.filter(c => c.severity === 'info').length,
  };

  let summaryText = `🔄 ${cycles.length} cycles. `;
  if (bySeverity.critical > 0) {summaryText += `🔴 ${bySeverity.critical} critical. `;}
  if (bySeverity.warning > 0) {summaryText += `🟡 ${bySeverity.warning} warning. `;}
  if (bySeverity.info > 0) {summaryText += `⚪ ${bySeverity.info} info.`;}

  const hints = {
    nextActions: bySeverity.critical > 0
      ? ['Focus on breaking critical cycles first']
      : cycles.length > 0
        ? ['Consider breaking cycles to improve maintainability']
        : ['No cycles - good architecture!'],
    relatedTools: ['drift_coupling action="analyze" module="<path>"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ cycles, total: cycles.length, bySeverity })
    .withHints(hints)
    .buildContent();
}

async function handleHotspots(
  projectRoot: string,
  limit?: number,
  minCoupling?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingHotspotsData>();

  // First try cached data
  const graphPath = path.join(projectRoot, DRIFT_DIR, COUPLING_DIR, 'graph.json');
  
  let modules: [string, { metrics: CouplingMetrics }][] = [];
  
  try {
    const data = JSON.parse(await fs.readFile(graphPath, 'utf-8'));
    modules = Object.entries(data.modules);
  } catch {
    // Try to build on-demand
    try {
      const analyzer = await buildAnalyzer(projectRoot);
      const hotspots = analyzer.getHotspots({ limit: limit ?? 15, minCoupling: minCoupling ?? 3 });
      
      let summaryText = `🔥 ${hotspots.length} coupling hotspots. `;
      if (hotspots.length > 0) {
        summaryText += `Top: ${hotspots[0]!.path} (${hotspots[0]!.coupling} connections).`;
      }

      const hints = {
        nextActions: hotspots.length > 0
          ? [`Analyze top hotspot: drift_coupling action="analyze" module="${hotspots[0]!.path}"`]
          : ['No hotspots - coupling is well distributed'],
        relatedTools: ['drift_coupling action="refactor-impact"'],
      };

      return builder
        .withSummary(summaryText)
        .withData({ hotspots, total: hotspots.length })
        .withHints(hints)
        .buildContent();
    } catch {
      // Return empty state
      return builder
        .withSummary('🔥 No coupling hotspots analysis available. Run a scan first.')
        .withData({ hotspots: [], total: 0 })
        .withHints({
          nextActions: ['Run drift scan to analyze the codebase'],
          relatedTools: ['drift_status'],
        })
        .buildContent();
    }
  }
  
  const hotspots = modules
    .map(([modPath, mod]) => ({
      path: modPath,
      coupling: mod.metrics.Ca + mod.metrics.Ce,
      metrics: mod.metrics,
    }))
    .filter(h => h.coupling >= (minCoupling ?? 3))
    .sort((a, b) => b.coupling - a.coupling)
    .slice(0, limit ?? 15);

  let summaryText = `🔥 ${hotspots.length} coupling hotspots. `;
  if (hotspots.length > 0) {
    summaryText += `Top: ${hotspots[0]!.path} (${hotspots[0]!.coupling} connections).`;
  }

  const hints = {
    nextActions: hotspots.length > 0
      ? [`Analyze top hotspot: drift_coupling action="analyze" module="${hotspots[0]!.path}"`]
      : ['No hotspots - coupling is well distributed'],
    relatedTools: ['drift_coupling action="refactor-impact"'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ hotspots, total: hotspots.length })
    .withHints(hints)
    .buildContent();
}

async function handleAnalyze(
  projectRoot: string,
  modulePath?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingAnalyzeData>();

  if (!modulePath) {
    throw Errors.missingParameter('module');
  }

  // Build analyzer on-demand
  const analyzer = await buildAnalyzer(projectRoot);
  const analysis = analyzer.analyzeModule(modulePath);

  if (!analysis) {
    throw Errors.custom(
      'MODULE_NOT_FOUND',
      `Module not found: ${modulePath}`,
      ['Check the module path and ensure call graph is built']
    );
  }

  const { module, cyclesInvolved, health } = analysis;
  
  let summaryText = `📦 ${modulePath}: ${module.role} role. `;
  summaryText += `Ca: ${module.metrics.Ca}, Ce: ${module.metrics.Ce}. `;
  summaryText += `Health: ${health.score}/100.`;

  const warnings: string[] = [];
  if (cyclesInvolved.length > 0) {
    warnings.push(`Involved in ${cyclesInvolved.length} cycle(s)`);
  }
  if (health.issues.length > 0) {
    warnings.push(...health.issues);
  }

  const hints = {
    nextActions: health.suggestions,
    warnings: warnings.length > 0 ? warnings : undefined,
    relatedTools: ['drift_coupling action="refactor-impact"', 'drift_impact_analysis'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ module: modulePath, analysis })
    .withHints(hints)
    .buildContent();
}

async function handleRefactorImpact(
  projectRoot: string,
  modulePath?: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingRefactorData>();

  if (!modulePath) {
    throw Errors.missingParameter('module');
  }

  const analyzer = await buildAnalyzer(projectRoot);
  const impact = analyzer.analyzeRefactorImpact(modulePath);

  if (!impact) {
    throw Errors.custom(
      'MODULE_NOT_FOUND',
      `Module not found: ${modulePath}`,
      ['Check the module path']
    );
  }

  let summaryText = `🔧 Refactoring ${modulePath}: ${impact.totalAffected} affected modules. `;
  summaryText += `Risk: ${impact.risk.toUpperCase()}.`;

  const hints = {
    nextActions: impact.suggestions,
    warnings: impact.risk === 'critical' || impact.risk === 'high'
      ? [`High risk refactor - ${impact.totalAffected} modules affected`]
      : undefined,
    relatedTools: ['drift_coupling action="analyze"', 'drift_impact_analysis'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ module: modulePath, impact })
    .withHints(hints)
    .buildContent();
}

async function handleUnusedExports(
  projectRoot: string,
  limit?: number
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<CouplingUnusedData>();

  const analyzer = await buildAnalyzer(projectRoot);
  const unused = analyzer.getUnusedExports().slice(0, limit ?? 20);

  const totalExports = unused.reduce((sum, u) => sum + u.unusedExports.length, 0);
  
  let summaryText = `📤 ${unused.length} modules with unused exports. `;
  summaryText += `${totalExports} total unused exports.`;

  const hints = {
    nextActions: unused.length > 0
      ? ['Review unused exports - may be dead code or public API']
      : ['No unused exports found'],
    relatedTools: ['drift_dead_code'],
  };

  return builder
    .withSummary(summaryText)
    .withData({ unused, total: unused.length })
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

async function buildAnalyzer(projectRoot: string) {
  const callGraphAnalyzer = createCallGraphAnalyzer({ rootDir: projectRoot });
  await callGraphAnalyzer.initialize();
  const callGraph = callGraphAnalyzer.getGraph();

  if (!callGraph) {
    throw Errors.custom(
      'NO_CALL_GRAPH',
      'Call graph required for coupling analysis',
      ['drift callgraph build']
    );
  }

  const analyzer = createModuleCouplingAnalyzer({ rootDir: projectRoot });
  analyzer.setCallGraph(callGraph);
  analyzer.build();

  return analyzer;
}
