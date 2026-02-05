/**
 * IEC 61131-3 Analyzer
 * 
 * Main entry point for Code Factory analysis.
 * Orchestrates parsing, extraction, and analysis.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative, basename } from 'path';

import {
  extractDocstrings,
  extractStateMachines,
  extractSafetyInterlocks,
  extractTribalKnowledge,
  extractVariables,
} from './extractors/index.js';
import type {
  DocstringExtractionResult,
  StateMachineExtractionResult,
  TribalKnowledgeExtractionResult,
  VariableExtractionResult,
} from './extractors/index.js';
import { STParser } from './parser/index.js';
import type { ParseResult } from './parser/index.js';
import { MigrationScorer } from './analyzers/migration-scorer.js';
import { AIContextGenerator } from './analyzers/ai-context.js';
import type {
  STProjectStatus,
  SafetyAnalysisResult,
  MigrationReadinessReport,
  AIContextPackage,
  TargetLanguage,
  STPOU,
  STCallGraph,
  STCallGraphNode,
  STCallGraphEdge,
  CallType,
  VendorId,
} from './types.js';

// ============================================================================
// FILE EXTENSIONS
// ============================================================================

const ST_FILE_EXTENSIONS = ['.st', '.stx', '.scl', '.pou', '.exp'];

// ============================================================================
// ANALYZER CLASS
// ============================================================================

export interface AnalyzerOptions {
  storagePath?: string;
}

export class IEC61131Analyzer {
  private projectPath: string = '';
  private files: string[] = [];
  private fileContents: Map<string, string> = new Map();
  private parseResults: Map<string, ParseResult> = new Map();
  private parsedPOUs: STPOU[] = [];
  private callGraph: STCallGraph | null = null;

  constructor(_options?: AnalyzerOptions) {
    // Options for future storage integration
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize analyzer with project path
   */
  async initialize(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    this.files = this.discoverFiles(projectPath);
    this.fileContents.clear();
    this.parseResults.clear();
  }

  /**
   * Discover all ST files in directory
   */
  private discoverFiles(rootPath: string): string[] {
    const files: string[] = [];

    const walk = (dir: string): void => {
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
              walk(fullPath);
            } else if (stat.isFile() && ST_FILE_EXTENSIONS.includes(extname(entry).toLowerCase())) {
              files.push(fullPath);
            }
          } catch {
            // Skip inaccessible files
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    if (existsSync(rootPath)) {
      const stat = statSync(rootPath);
      if (stat.isFile()) {
        files.push(rootPath);
      } else {
        walk(rootPath);
      }
    }

    return files;
  }

  /**
   * Read file content (cached)
   */
  private readFile(filePath: string): string {
    if (this.fileContents.has(filePath)) {
      return this.fileContents.get(filePath)!;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      this.fileContents.set(filePath, content);
      return content;
    } catch {
      return '';
    }
  }

  /**
   * Get files for analysis
   */
  private getFiles(path?: string): Array<{ path: string; content: string }> {
    const targetPath = path ?? this.projectPath;
    const files = path ? this.discoverFiles(targetPath) : this.files;

    return files.map(f => ({
      path: relative(this.projectPath, f),
      content: this.readFile(f),
    }));
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  /**
   * Get project status overview
   */
  async status(path?: string): Promise<STProjectStatus> {
    const targetPath = path ?? this.projectPath;
    const files = this.getFiles(targetPath);

    let totalLines = 0;
    let totalPOUs = 0;
    let totalStateMachines = 0;
    let totalInterlocks = 0;
    let totalTribalKnowledge = 0;
    let totalDocstrings = 0;

    const byExtension: Record<string, number> = {};

    for (const file of files) {
      const ext = extname(file.path).toLowerCase();
      byExtension[ext] = (byExtension[ext] || 0) + 1;
      totalLines += file.content.split('\n').length;

      // Quick counts
      const docResult = extractDocstrings(file.content, file.path, { minLength: 20 });
      totalDocstrings += docResult.docstrings.length;

      const smResult = extractStateMachines(file.content, file.path);
      totalStateMachines += smResult.stateMachines.length;

      const safetyResult = extractSafetyInterlocks(file.content, file.path);
      totalInterlocks += safetyResult.interlocks.length;

      const tribalResult = extractTribalKnowledge(file.content, file.path);
      totalTribalKnowledge += tribalResult.items.length;

      // Count POUs
      const pouPattern = /\b(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+\w+/gi;
      const pouMatches = file.content.match(pouPattern);
      totalPOUs += pouMatches?.length ?? 0;
    }

    return {
      project: {
        path: targetPath,
        name: basename(targetPath),
        vendor: null,
        plcType: null,
      },
      files: {
        total: files.length,
        byExtension,
        totalLines,
      },
      analysis: {
        lastRun: new Date().toISOString(),
        pous: totalPOUs,
        stateMachines: totalStateMachines,
        safetyInterlocks: totalInterlocks,
        tribalKnowledge: totalTribalKnowledge,
        docstrings: totalDocstrings,
      },
      health: {
        score: this.calculateHealthScore(totalDocstrings, totalPOUs, totalInterlocks),
        issues: [],
      },
    };
  }

  private calculateHealthScore(docstrings: number, pous: number, _interlocks: number): number {
    if (pous === 0) return 0;
    
    // Simple health score based on documentation coverage
    const docRatio = Math.min(docstrings / pous, 1);
    return Math.round(docRatio * 100);
  }

  // ============================================================================
  // EXTRACTION METHODS
  // ============================================================================

  /**
   * Extract docstrings (PhD's primary request)
   */
  async docstrings(path?: string, options?: { includeRaw?: boolean; limit?: number }): Promise<DocstringExtractionResult> {
    const files = this.getFiles(path);
    const allDocstrings: DocstringExtractionResult['docstrings'] = [];

    for (const file of files) {
      const result = extractDocstrings(file.content, file.path, {
        includeRaw: options?.includeRaw ?? false,
      });
      allDocstrings.push(...result.docstrings);
    }

    // Apply limit
    const limited = options?.limit ? allDocstrings.slice(0, options.limit) : allDocstrings;

    // Recalculate summary
    const byBlock: Record<string, number> = {};
    let withParams = 0;
    let withHistory = 0;
    let withWarnings = 0;
    let totalQuality = 0;

    for (const doc of limited) {
      const key = doc.associatedBlock || 'standalone';
      byBlock[key] = (byBlock[key] || 0) + 1;
      if (doc.params.length > 0) withParams++;
      if (doc.history.length > 0) withHistory++;
      if (doc.warnings.length > 0) withWarnings++;
      totalQuality += doc.quality.score;
    }

    return {
      docstrings: limited,
      summary: {
        total: allDocstrings.length,
        byBlock,
        withParams,
        withHistory,
        withWarnings,
        averageQuality: limited.length > 0 ? totalQuality / limited.length : 0,
      },
    };
  }

  /**
   * Extract state machines
   */
  async stateMachines(path?: string, options?: { limit?: number }): Promise<StateMachineExtractionResult> {
    const files = this.getFiles(path);
    const allMachines: StateMachineExtractionResult['stateMachines'] = [];

    for (const file of files) {
      const pouName = this.inferPOUName(file.content, file.path);
      const result = extractStateMachines(file.content, file.path, pouName);
      allMachines.push(...result.stateMachines);
    }

    const limited = options?.limit ? allMachines.slice(0, options.limit) : allMachines;

    return {
      stateMachines: limited,
      summary: {
        total: allMachines.length,
        totalStates: allMachines.reduce((sum, sm) => sum + sm.states.length, 0),
        byVariable: allMachines.reduce((acc, sm) => {
          acc[sm.stateVariable] = (acc[sm.stateVariable] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        withDeadlocks: allMachines.filter(sm => sm.verification.hasDeadlocks).length,
        withGaps: allMachines.filter(sm => sm.verification.hasGaps).length,
      },
    };
  }

  /**
   * Analyze safety interlocks (CRITICAL)
   */
  async safety(path?: string): Promise<SafetyAnalysisResult> {
    const files = this.getFiles(path);
    const allInterlocks: SafetyAnalysisResult['interlocks'] = [];
    const allBypasses: SafetyAnalysisResult['bypasses'] = [];
    const allWarnings: SafetyAnalysisResult['criticalWarnings'] = [];

    for (const file of files) {
      const result = extractSafetyInterlocks(file.content, file.path);
      allInterlocks.push(...result.interlocks);
      allBypasses.push(...result.bypasses);
      allWarnings.push(...result.criticalWarnings);
    }

    return {
      interlocks: allInterlocks,
      bypasses: allBypasses,
      criticalWarnings: allWarnings,
      summary: {
        totalInterlocks: allInterlocks.length,
        byType: {
          'interlock': allInterlocks.filter(i => i.type === 'interlock').length,
          'permissive': allInterlocks.filter(i => i.type === 'permissive').length,
          'estop': allInterlocks.filter(i => i.type === 'estop').length,
          'safety-relay': allInterlocks.filter(i => i.type === 'safety-relay').length,
          'safety-device': allInterlocks.filter(i => i.type === 'safety-device').length,
          'bypass': allBypasses.length,
        },
        bypassCount: allBypasses.length,
        criticalWarningCount: allWarnings.filter(w => w.severity === 'critical').length,
      },
    };
  }

  /**
   * Extract tribal knowledge
   */
  async tribalKnowledge(path?: string, options?: { limit?: number }): Promise<TribalKnowledgeExtractionResult> {
    const files = this.getFiles(path);
    const allItems: TribalKnowledgeExtractionResult['items'] = [];

    for (const file of files) {
      const result = extractTribalKnowledge(file.content, file.path);
      allItems.push(...result.items);
    }

    const limited = options?.limit ? allItems.slice(0, options.limit) : allItems;

    return {
      items: limited,
      summary: {
        total: allItems.length,
        byType: allItems.reduce((acc, item) => {
          acc[item.type] = (acc[item.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        byImportance: {
          critical: allItems.filter(i => i.importance === 'critical').length,
          high: allItems.filter(i => i.importance === 'high').length,
          medium: allItems.filter(i => i.importance === 'medium').length,
          low: allItems.filter(i => i.importance === 'low').length,
        },
        criticalCount: allItems.filter(i => i.importance === 'critical').length,
      },
    };
  }

  /**
   * Extract variables
   */
  async variables(path?: string, options?: { limit?: number }): Promise<VariableExtractionResult> {
    const files = this.getFiles(path);
    const allVariables: VariableExtractionResult['variables'] = [];
    const allIOMappings: VariableExtractionResult['ioMappings'] = [];

    for (const file of files) {
      const result = extractVariables(file.content, file.path);
      allVariables.push(...result.variables);
      allIOMappings.push(...result.ioMappings);
    }

    const limited = options?.limit ? allVariables.slice(0, options.limit) : allVariables;

    return {
      variables: limited,
      ioMappings: allIOMappings,
      summary: {
        total: allVariables.length,
        bySection: allVariables.reduce((acc, v) => {
          acc[v.section] = (acc[v.section] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        withComments: allVariables.filter(v => v.comment).length,
        withIOAddress: allVariables.filter(v => v.ioAddress).length + allIOMappings.length,
        safetyCritical: allVariables.filter(v => v.isSafetyCritical).length,
      },
    };
  }

  /**
   * List all POUs (blocks)
   */
  async blocks(path?: string, options?: { limit?: number }): Promise<{
    blocks: Array<{ file: string; type: string; name: string; line: number }>;
    summary: { total: number; byType: Record<string, number> };
  }> {
    const files = this.getFiles(path);
    const blocks: Array<{ file: string; type: string; name: string; line: number }> = [];

    const blockPattern = /\b(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+(\w+)/gi;

    for (const file of files) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(blockPattern.source, blockPattern.flags);

      while ((match = regex.exec(file.content)) !== null) {
        const line = file.content.slice(0, match.index).split('\n').length;
        blocks.push({
          file: file.path,
          type: match[1]!.toUpperCase(),
          name: match[2]!,
          line,
        });
      }
    }

    const limited = options?.limit ? blocks.slice(0, options.limit) : blocks;

    const byType = blocks.reduce((acc, b) => {
      acc[b.type] = (acc[b.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      blocks: limited,
      summary: {
        total: blocks.length,
        byType,
      },
    };
  }

  // ============================================================================
  // FULL ANALYSIS
  // ============================================================================

  /**
   * Run full analysis pipeline
   */
  async fullAnalysis(path?: string): Promise<{
    status: STProjectStatus;
    docstrings: DocstringExtractionResult;
    stateMachines: StateMachineExtractionResult;
    safety: SafetyAnalysisResult;
    tribalKnowledge: TribalKnowledgeExtractionResult;
    variables: VariableExtractionResult;
  }> {
    const [status, docstrings, stateMachines, safety, tribalKnowledge, variables] = await Promise.all([
      this.status(path),
      this.docstrings(path),
      this.stateMachines(path),
      this.safety(path),
      this.tribalKnowledge(path),
      this.variables(path),
    ]);

    return {
      status,
      docstrings,
      stateMachines,
      safety,
      tribalKnowledge,
      variables,
    };
  }

  // ============================================================================
  // MIGRATION SCORING
  // ============================================================================

  /**
   * Calculate migration readiness scores for all POUs
   */
  async migrationReadiness(path?: string): Promise<MigrationReadinessReport> {
    // Get all required data
    const [docstrings, stateMachines, safety] = await Promise.all([
      this.docstrings(path),
      this.stateMachines(path),
      this.safety(path),
    ]);

    // Parse POUs
    const pous = await this.parsePOUs(path);

    // Build call graph for dependency analysis
    const callGraphMap = this.buildCallGraphMap(pous);

    // Calculate readiness
    const scorer = new MigrationScorer();
    return scorer.calculateReadiness(pous, docstrings, stateMachines, safety, callGraphMap);
  }

  /**
   * Parse all POUs from files
   */
  private async parsePOUs(path?: string): Promise<STPOU[]> {
    if (this.parsedPOUs.length > 0 && !path) {
      return this.parsedPOUs;
    }

    const files = this.getFiles(path);
    const pous: STPOU[] = [];
    const parser = new STParser();

    for (const file of files) {
      try {
        const result = parser.parse(file.content, file.path);
        pous.push(...result.pous);
      } catch {
        // Skip files that fail to parse
      }
    }

    if (!path) {
      this.parsedPOUs = pous;
    }

    return pous;
  }

  /**
   * Build call graph map for dependency analysis
   */
  private buildCallGraphMap(pous: STPOU[]): Map<string, string[]> {
    const callGraph = new Map<string, string[]>();

    // Build a map of POU names to IDs
    const pouNameToId = new Map<string, string>();
    for (const pou of pous) {
      pouNameToId.set(pou.name.toLowerCase(), pou.id);
    }

    // For each POU, find what it calls
    for (const pou of pous) {
      const dependencies: string[] = [];

      // Check for FB instances in variables
      for (const v of pou.variables) {
        const fbType = v.dataType.split('[')[0]?.trim().toLowerCase();
        if (fbType && pouNameToId.has(fbType)) {
          const depId = pouNameToId.get(fbType)!;
          if (!dependencies.includes(depId)) {
            dependencies.push(depId);
          }
        }
      }

      callGraph.set(pou.id, dependencies);
    }

    return callGraph;
  }

  // ============================================================================
  // AI CONTEXT GENERATION
  // ============================================================================

  /**
   * Generate AI context package for migration assistance
   */
  async generateAIContext(
    targetLanguage: TargetLanguage,
    path?: string,
    options?: { maxTokens?: number }
  ): Promise<AIContextPackage> {
    // Get all required data
    const [status, docstrings, stateMachines, safety, tribalKnowledge] = await Promise.all([
      this.status(path),
      this.docstrings(path),
      this.stateMachines(path),
      this.safety(path),
      this.tribalKnowledge(path),
    ]);

    // Parse POUs
    const pous = await this.parsePOUs(path);

    // Generate context - only pass maxTokens if defined
    const generatorConfig = options?.maxTokens !== undefined 
      ? { maxTokens: options.maxTokens } 
      : undefined;
    const generator = new AIContextGenerator(generatorConfig);
    
    // Build project info, only including defined values
    const projectInfo: { name: string; vendor?: VendorId; plcType?: string } = {
      name: status.project.name,
    };
    if (status.project.vendor) {
      projectInfo.vendor = status.project.vendor;
    }
    if (status.project.plcType) {
      projectInfo.plcType = status.project.plcType;
    }
    
    return generator.generateContext(
      pous,
      docstrings,
      stateMachines,
      safety,
      tribalKnowledge,
      targetLanguage,
      projectInfo
    );
  }

  // ============================================================================
  // CALL GRAPH
  // ============================================================================

  /**
   * Build and return the call graph for the project
   */
  async buildCallGraph(path?: string): Promise<STCallGraph> {
    if (this.callGraph && !path) {
      return this.callGraph;
    }

    const files = this.getFiles(path);
    const nodes = new Map<string, STCallGraphNode>();
    const edges: STCallGraphEdge[] = [];

    // First pass: collect all POUs as nodes
    const pouPattern = /\b(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+(\w+)/gi;
    const fbInstances = new Map<string, string>(); // instanceName -> typeName

    for (const file of files) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pouPattern.source, pouPattern.flags);

      while ((match = regex.exec(file.content)) !== null) {
        const type = match[1]!.toUpperCase() as 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION';
        const name = match[2]!;
        const line = file.content.slice(0, match.index).split('\n').length;

        // Extract variables for this POU
        const varResult = extractVariables(file.content, file.path);
        const inputs = varResult.variables.filter(v => v.section === 'VAR_INPUT');
        const outputs = varResult.variables.filter(v => v.section === 'VAR_OUTPUT');

        nodes.set(name.toLowerCase(), {
          id: `${file.path}:${name}`,
          name,
          type,
          file: file.path,
          line,
          inputs: inputs.map(v => ({
            id: v.id,
            name: v.name,
            dataType: v.dataType,
            section: v.section,
            initialValue: v.initialValue,
            comment: v.comment,
            isArray: v.isArray,
            arrayBounds: v.arrayBounds,
            isSafetyCritical: v.isSafetyCritical,
            ioAddress: v.ioAddress,
            location: v.location,
            pouId: null,
          })),
          outputs: outputs.map(v => ({
            id: v.id,
            name: v.name,
            dataType: v.dataType,
            section: v.section,
            initialValue: v.initialValue,
            comment: v.comment,
            isArray: v.isArray,
            arrayBounds: v.arrayBounds,
            isSafetyCritical: v.isSafetyCritical,
            ioAddress: v.ioAddress,
            location: v.location,
            pouId: null,
          })),
        });
      }

      // Collect FB instances
      const instancePattern = /(\w+)\s*:\s*(\w+)\s*;/g;
      while ((match = instancePattern.exec(file.content)) !== null) {
        fbInstances.set(match[1]!.toLowerCase(), match[2]!.toLowerCase());
      }
    }

    // Second pass: find calls
    let edgeId = 0;
    for (const file of files) {
      const lines = file.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('(*')) continue;

        // Find function calls: result := FunctionName(...)
        const callPattern = /(\w+)\s*\(/g;
        let match: RegExpExecArray | null;

        while ((match = callPattern.exec(line)) !== null) {
          const calleeName = match[1]!.toLowerCase();

          // Check if it's an FB instance call
          if (fbInstances.has(calleeName)) {
            const fbType = fbInstances.get(calleeName)!;
            if (nodes.has(fbType)) {
              edges.push({
                id: `edge-${edgeId++}`,
                callerId: file.path,
                calleeId: nodes.get(fbType)?.id ?? null,
                calleeName: fbType,
                callType: 'instantiation' as CallType,
                location: { file: file.path, line: lineNum, column: match.index },
                arguments: [],
              });
            }
          } else if (nodes.has(calleeName)) {
            // Direct function call
            edges.push({
              id: `edge-${edgeId++}`,
              callerId: file.path,
              calleeId: nodes.get(calleeName)?.id ?? null,
              calleeName,
              callType: 'function_call' as CallType,
              location: { file: file.path, line: lineNum, column: match.index },
              arguments: [],
            });
          }
        }
      }
    }

    const result: STCallGraph = { nodes, edges };

    if (!path) {
      this.callGraph = result;
    }

    return result;
  }

  /**
   * Get callers of a specific function/FB
   */
  async getCallers(functionName: string, path?: string): Promise<{
    function: string;
    callers: Array<{ file: string; line: number; callType: CallType }>;
  }> {
    const callGraph = await this.buildCallGraph(path);
    const targetName = functionName.toLowerCase();

    const callers: Array<{ file: string; line: number; callType: CallType }> = [];

    for (const edge of callGraph.edges) {
      if (edge.calleeName.toLowerCase() === targetName) {
        callers.push({
          file: edge.location.file,
          line: edge.location.line,
          callType: edge.callType,
        });
      }
    }

    return { function: functionName, callers };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private inferPOUName(content: string, filePath: string): string {
    // Try to find first POU name
    const match = content.match(/\b(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+(\w+)/i);
    if (match) return match[1]!;
    
    // Fall back to filename
    return basename(filePath, extname(filePath));
  }
}

// ============================================================================
// CONVENIENCE EXPORT
// ============================================================================

export function createAnalyzer(options?: AnalyzerOptions): IEC61131Analyzer {
  return new IEC61131Analyzer(options);
}
