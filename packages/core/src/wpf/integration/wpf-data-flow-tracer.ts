/**
 * WPF Data Flow Tracer
 *
 * Traces data flow from UI elements through ViewModels to data access.
 * Identifies sensitive data paths and potential security concerns.
 */

import type {
  XamlExtractionResult,
  ViewModelAnalysis,
  ViewModelLink,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface DataFlowTrace {
  /** Starting element */
  element: string;
  /** Flow steps */
  steps: DataFlowStep[];
  /** Reaches database */
  reachesDatabase: boolean;
  /** Sensitive data accessed */
  sensitiveDataAccessed: string[];
  /** Total depth */
  depth: number;
  /** Confidence score */
  confidence: number;
}

export interface DataFlowStep {
  /** Step type */
  type: DataFlowStepType;
  /** Location description */
  location: string;
  /** File path */
  file: string;
  /** Line number */
  line: number;
  /** Additional details */
  details?: DataFlowStepDetails | undefined;
}

export type DataFlowStepType =
  | 'xaml-element'
  | 'binding'
  | 'viewmodel-property'
  | 'viewmodel-command'
  | 'method-call'
  | 'service-call'
  | 'ef-query'
  | 'database-table';

export interface DataFlowStepDetails {
  /** Property or method name */
  name?: string | undefined;
  /** Type information */
  type?: string | undefined;
  /** Table name for database steps */
  table?: string | undefined;
  /** Binding path */
  bindingPath?: string | undefined;
  /** Command name */
  commandName?: string | undefined;
}

export interface DataFlowAnalysisResult {
  /** All traced flows */
  flows: DataFlowTrace[];
  /** Elements with database access */
  elementsWithDbAccess: string[];
  /** Sensitive data summary */
  sensitiveDataSummary: SensitiveDataSummary;
  /** Statistics */
  stats: DataFlowStats;
}

export interface SensitiveDataSummary {
  /** Fields accessed */
  fields: string[];
  /** Tables accessed */
  tables: string[];
  /** Entry points */
  entryPoints: string[];
}

export interface DataFlowStats {
  /** Total elements traced */
  totalElements: number;
  /** Elements reaching database */
  reachingDatabase: number;
  /** Average flow depth */
  averageDepth: number;
  /** Max flow depth */
  maxDepth: number;
}

// ============================================================================
// Sensitive Data Patterns
// ============================================================================

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /apikey/i,
  /api_key/i,
  /credential/i,
  /ssn/i,
  /social.*security/i,
  /credit.*card/i,
  /card.*number/i,
  /cvv/i,
  /pin/i,
  /email/i,
  /phone/i,
  /address/i,
  /salary/i,
  /income/i,
  /bank.*account/i,
  /routing.*number/i,
];

const DATABASE_CALL_PATTERNS = [
  /\.SaveChanges/,
  /\.SaveChangesAsync/,
  /\.Add\(/,
  /\.Update\(/,
  /\.Remove\(/,
  /\.Delete\(/,
  /\.Find\(/,
  /\.FindAsync\(/,
  /\.FirstOrDefault/,
  /\.SingleOrDefault/,
  /\.ToList/,
  /\.ToListAsync/,
  /\.Where\(/,
  /\.Select\(/,
  /\.Include\(/,
  /DbSet/,
  /DbContext/,
];

// ============================================================================
// WPF Data Flow Tracer
// ============================================================================

export class WpfDataFlowTracer {
  private xamlFiles: Map<string, XamlExtractionResult> = new Map();
  private viewModels: Map<string, ViewModelAnalysis> = new Map();
  private links: ViewModelLink[] = [];
  private csharpContents: Map<string, string> = new Map();

  /**
   * Initialize with analysis data
   */
  initialize(
    xamlFiles: Map<string, XamlExtractionResult>,
    viewModels: Map<string, ViewModelAnalysis>,
    links: ViewModelLink[],
    csharpContents?: Map<string, string>
  ): void {
    this.xamlFiles = xamlFiles;
    this.viewModels = viewModels;
    this.links = links;
    this.csharpContents = csharpContents ?? new Map();
  }

  /**
   * Trace data flow from a specific element
   */
  trace(elementName: string): DataFlowTrace {
    const steps: DataFlowStep[] = [];
    const sensitiveData: string[] = [];
    let reachesDatabase = false;

    // Find the element in XAML files
    const elementInfo = this.findElement(elementName);
    if (!elementInfo) {
      return {
        element: elementName,
        steps: [{
          type: 'xaml-element',
          location: `Element '${elementName}' not found`,
          file: 'unknown',
          line: 0,
        }],
        reachesDatabase: false,
        sensitiveDataAccessed: [],
        depth: 0,
        confidence: 0,
      };
    }

    // Step 1: XAML element
    steps.push({
      type: 'xaml-element',
      location: `${elementInfo.xamlFile}:${elementInfo.line}`,
      file: elementInfo.xamlFile,
      line: elementInfo.line,
      details: { name: elementName },
    });

    // Step 2: Find binding
    const binding = this.findBindingForElement(elementName, elementInfo.xamlFile);
    if (binding) {
      steps.push({
        type: 'binding',
        location: `Binding: ${binding.path}`,
        file: elementInfo.xamlFile,
        line: binding.line,
        details: { bindingPath: binding.path },
      });

      // Check for sensitive data in binding path
      this.checkSensitiveData(binding.path, sensitiveData);

      // Step 3: Find ViewModel property
      const link = this.links.find(l =>
        l.xamlElement === elementName || l.bindingPath === binding.path
      );

      if (link) {
        steps.push({
          type: 'viewmodel-property',
          location: `${link.viewModelClass}.${link.viewModelProperty}`,
          file: link.locations.csharp.file,
          line: link.locations.csharp.line,
          details: {
            name: link.viewModelProperty,
            type: link.propertyType,
          },
        });

        // Step 4: Trace through ViewModel
        const vmSteps = this.traceViewModelFlow(link.viewModelClass, link.viewModelProperty);
        steps.push(...vmSteps.steps);
        sensitiveData.push(...vmSteps.sensitiveData);
        reachesDatabase = vmSteps.reachesDatabase;
      }
    }

    // Check for command binding
    const command = this.findCommandForElement(elementName, elementInfo.xamlFile);
    if (command) {
      steps.push({
        type: 'viewmodel-command',
        location: `Command: ${command.binding}`,
        file: elementInfo.xamlFile,
        line: command.line,
        details: { commandName: command.binding },
      });

      // Trace command execution
      const cmdSteps = this.traceCommandFlow(command.binding, elementInfo.xamlFile);
      steps.push(...cmdSteps.steps);
      sensitiveData.push(...cmdSteps.sensitiveData);
      reachesDatabase = reachesDatabase || cmdSteps.reachesDatabase;
    }

    return {
      element: elementName,
      steps,
      reachesDatabase,
      sensitiveDataAccessed: [...new Set(sensitiveData)],
      depth: steps.length,
      confidence: this.calculateConfidence(steps),
    };
  }

  /**
   * Trace all elements in the project
   */
  traceAll(): DataFlowAnalysisResult {
    const flows: DataFlowTrace[] = [];
    const elementsWithDbAccess: string[] = [];
    const allSensitiveFields: string[] = [];
    const allTables: string[] = [];
    const entryPoints: string[] = [];

    // Collect all element names from XAML
    const elements = this.collectAllElements();

    for (const element of elements) {
      const flow = this.trace(element);
      flows.push(flow);

      if (flow.reachesDatabase) {
        elementsWithDbAccess.push(element);
        entryPoints.push(element);
      }

      allSensitiveFields.push(...flow.sensitiveDataAccessed);

      // Extract table names from steps
      for (const step of flow.steps) {
        if (step.type === 'database-table' && step.details?.table) {
          allTables.push(step.details.table);
        }
      }
    }

    const depths = flows.map(f => f.depth);

    return {
      flows,
      elementsWithDbAccess,
      sensitiveDataSummary: {
        fields: [...new Set(allSensitiveFields)],
        tables: [...new Set(allTables)],
        entryPoints: [...new Set(entryPoints)],
      },
      stats: {
        totalElements: elements.length,
        reachingDatabase: elementsWithDbAccess.length,
        averageDepth: depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
        maxDepth: depths.length > 0 ? Math.max(...depths) : 0,
      },
    };
  }

  /**
   * Find element in XAML files
   */
  private findElement(elementName: string): { xamlFile: string; line: number } | null {
    for (const [filePath, xaml] of this.xamlFiles) {
      // Check bindings
      for (const binding of xaml.bindings) {
        if (binding.elementName === elementName || binding.elementName.includes(elementName)) {
          return { xamlFile: filePath, line: binding.location.line };
        }
      }

      // Check commands
      for (const command of xaml.commands) {
        if (command.elementName === elementName || command.elementName.includes(elementName)) {
          return { xamlFile: filePath, line: command.location.line };
        }
      }
    }

    return null;
  }

  /**
   * Find binding for an element
   */
  private findBindingForElement(
    elementName: string,
    xamlFile: string
  ): { path: string; line: number } | null {
    const xaml = this.xamlFiles.get(xamlFile);
    if (!xaml) {return null;}

    for (const binding of xaml.bindings) {
      if (binding.elementName === elementName || binding.elementName.includes(elementName)) {
        return { path: binding.parsed.path, line: binding.location.line };
      }
    }

    return null;
  }

  /**
   * Find command for an element
   */
  private findCommandForElement(
    elementName: string,
    xamlFile: string
  ): { binding: string; line: number } | null {
    const xaml = this.xamlFiles.get(xamlFile);
    if (!xaml) {return null;}

    for (const command of xaml.commands) {
      if (command.elementName === elementName || command.elementName.includes(elementName)) {
        return { binding: command.binding, line: command.location.line };
      }
    }

    return null;
  }

  /**
   * Trace flow through ViewModel
   */
  private traceViewModelFlow(
    vmClass: string,
    propertyName: string
  ): { steps: DataFlowStep[]; sensitiveData: string[]; reachesDatabase: boolean } {
    const steps: DataFlowStep[] = [];
    const sensitiveData: string[] = [];
    let reachesDatabase = false;

    const vm = this.viewModels.get(vmClass);
    if (!vm) {return { steps, sensitiveData, reachesDatabase };}

    // Check if property accesses database
    const content = this.csharpContents.get(vm.filePath) ?? '';

    // Look for database patterns in the file
    for (const pattern of DATABASE_CALL_PATTERNS) {
      if (pattern.test(content)) {
        reachesDatabase = true;
        steps.push({
          type: 'ef-query',
          location: `Database access in ${vmClass}`,
          file: vm.filePath,
          line: 0, // Would need more precise analysis
          details: {},
        });
        break;
      }
    }

    // Check for sensitive data
    this.checkSensitiveData(propertyName, sensitiveData);

    return { steps, sensitiveData, reachesDatabase };
  }

  /**
   * Trace command execution flow
   */
  private traceCommandFlow(
    commandName: string,
    _xamlFile: string
  ): { steps: DataFlowStep[]; sensitiveData: string[]; reachesDatabase: boolean } {
    const steps: DataFlowStep[] = [];
    const sensitiveData: string[] = [];
    let reachesDatabase = false;

    // Find the ViewModel that has this command
    for (const vm of this.viewModels.values()) {
      const command = vm.commands.find(c => c.name === commandName);
      if (command) {
        if (command.executeMethod) {
          steps.push({
            type: 'method-call',
            location: `${vm.className}.${command.executeMethod}()`,
            file: vm.filePath,
            line: command.location.line,
            details: { name: command.executeMethod },
          });
        }

        // Check for database access
        const content = this.csharpContents.get(vm.filePath) ?? '';
        for (const pattern of DATABASE_CALL_PATTERNS) {
          if (pattern.test(content)) {
            reachesDatabase = true;
            steps.push({
              type: 'ef-query',
              location: `Database access in ${vm.className}`,
              file: vm.filePath,
              line: 0,
            });
            break;
          }
        }

        break;
      }
    }

    return { steps, sensitiveData, reachesDatabase };
  }

  /**
   * Check for sensitive data in a name
   */
  private checkSensitiveData(name: string, sensitiveData: string[]): void {
    for (const pattern of SENSITIVE_FIELD_PATTERNS) {
      if (pattern.test(name)) {
        sensitiveData.push(name);
        break;
      }
    }
  }

  /**
   * Collect all element names from XAML
   */
  private collectAllElements(): string[] {
    const elements = new Set<string>();

    for (const xaml of this.xamlFiles.values()) {
      for (const binding of xaml.bindings) {
        elements.add(binding.elementName);
      }
      for (const command of xaml.commands) {
        elements.add(command.elementName);
      }
    }

    return Array.from(elements);
  }

  /**
   * Calculate confidence score for a trace
   */
  private calculateConfidence(steps: DataFlowStep[]): number {
    if (steps.length === 0) {return 0;}
    if (steps.length === 1 && steps[0]?.location.includes('not found')) {return 0;}

    // Base confidence
    let confidence = 0.5;

    // More steps = more complete trace
    confidence += Math.min(steps.length * 0.1, 0.3);

    // Reaching database increases confidence
    if (steps.some(s => s.type === 'ef-query' || s.type === 'database-table')) {
      confidence += 0.15;
    }

    return Math.min(confidence, 1.0);
  }
}

/**
 * Factory function
 */
export function createWpfDataFlowTracer(): WpfDataFlowTracer {
  return new WpfDataFlowTracer();
}
