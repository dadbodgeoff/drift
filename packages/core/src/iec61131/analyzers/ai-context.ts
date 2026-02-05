/**
 * AI Context Generator
 * 
 * Generates structured context optimized for LLM consumption.
 * Following architecture doc Part 2.3.2: AI Context Generator
 * 
 * This is THE KEY OUTPUT for AI migration.
 * It provides everything an LLM needs to understand and translate the code.
 */

import type {
  STPOU,
  STVariable,
  AIContextPackage,
  AIProjectContext,
  AIConventionContext,
  AITypeContext,
  AISafetyContext,
  AIPOUContext,
  AIVariableDescription,
  AITranslationHint,
  AITranslationGuide,
  AIPatternMapping,
  AIVerificationRequirement,
  TargetLanguage,
  SafetyAnalysisResult,
  VendorId,
} from '../types.js';
import type { DocstringExtractionResult } from '../extractors/index.js';
import type { StateMachineExtractionResult } from '../extractors/index.js';
import type { TribalKnowledgeExtractionResult } from '../extractors/index.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AIContextGeneratorConfig {
  maxTokens?: number;
  includeRaw?: boolean;
}

// ============================================================================
// TYPE MAPPINGS
// ============================================================================

const PLC_TO_PYTHON: Record<string, string> = {
  'BOOL': 'bool',
  'BYTE': 'int',
  'WORD': 'int',
  'DWORD': 'int',
  'LWORD': 'int',
  'SINT': 'int',
  'INT': 'int',
  'DINT': 'int',
  'LINT': 'int',
  'USINT': 'int',
  'UINT': 'int',
  'UDINT': 'int',
  'ULINT': 'int',
  'REAL': 'float',
  'LREAL': 'float',
  'STRING': 'str',
  'WSTRING': 'str',
  'TIME': 'timedelta',
  'DATE': 'date',
  'DATE_AND_TIME': 'datetime',
  'TOD': 'time',
  'ARRAY': 'list',
};

const PLC_TO_RUST: Record<string, string> = {
  'BOOL': 'bool',
  'BYTE': 'u8',
  'WORD': 'u16',
  'DWORD': 'u32',
  'LWORD': 'u64',
  'SINT': 'i8',
  'INT': 'i16',
  'DINT': 'i32',
  'LINT': 'i64',
  'USINT': 'u8',
  'UINT': 'u16',
  'UDINT': 'u32',
  'ULINT': 'u64',
  'REAL': 'f32',
  'LREAL': 'f64',
  'STRING': 'String',
  'WSTRING': 'String',
  'TIME': 'Duration',
  'DATE': 'NaiveDate',
  'DATE_AND_TIME': 'NaiveDateTime',
  'TOD': 'NaiveTime',
  'ARRAY': 'Vec',
};

const PLC_TO_TYPESCRIPT: Record<string, string> = {
  'BOOL': 'boolean',
  'BYTE': 'number',
  'WORD': 'number',
  'DWORD': 'number',
  'LWORD': 'bigint',
  'SINT': 'number',
  'INT': 'number',
  'DINT': 'number',
  'LINT': 'bigint',
  'USINT': 'number',
  'UINT': 'number',
  'UDINT': 'number',
  'ULINT': 'bigint',
  'REAL': 'number',
  'LREAL': 'number',
  'STRING': 'string',
  'WSTRING': 'string',
  'TIME': 'number',
  'DATE': 'Date',
  'DATE_AND_TIME': 'Date',
  'TOD': 'Date',
  'ARRAY': 'Array',
};

const TYPE_MAPPINGS: Record<TargetLanguage, Record<string, string>> = {
  python: PLC_TO_PYTHON,
  rust: PLC_TO_RUST,
  typescript: PLC_TO_TYPESCRIPT,
  csharp: {
    'BOOL': 'bool',
    'BYTE': 'byte',
    'WORD': 'ushort',
    'DWORD': 'uint',
    'LWORD': 'ulong',
    'SINT': 'sbyte',
    'INT': 'short',
    'DINT': 'int',
    'LINT': 'long',
    'REAL': 'float',
    'LREAL': 'double',
    'STRING': 'string',
    'TIME': 'TimeSpan',
    'DATE': 'DateTime',
    'ARRAY': 'List',
  },
  cpp: {
    'BOOL': 'bool',
    'BYTE': 'uint8_t',
    'WORD': 'uint16_t',
    'DWORD': 'uint32_t',
    'LWORD': 'uint64_t',
    'SINT': 'int8_t',
    'INT': 'int16_t',
    'DINT': 'int32_t',
    'LINT': 'int64_t',
    'REAL': 'float',
    'LREAL': 'double',
    'STRING': 'std::string',
    'TIME': 'std::chrono::milliseconds',
    'ARRAY': 'std::vector',
  },
  go: {
    'BOOL': 'bool',
    'BYTE': 'uint8',
    'WORD': 'uint16',
    'DWORD': 'uint32',
    'LWORD': 'uint64',
    'SINT': 'int8',
    'INT': 'int16',
    'DINT': 'int32',
    'LINT': 'int64',
    'REAL': 'float32',
    'LREAL': 'float64',
    'STRING': 'string',
    'TIME': 'time.Duration',
    'ARRAY': '[]',
  },
  java: {
    'BOOL': 'boolean',
    'BYTE': 'byte',
    'WORD': 'short',
    'DWORD': 'int',
    'LWORD': 'long',
    'SINT': 'byte',
    'INT': 'short',
    'DINT': 'int',
    'LINT': 'long',
    'REAL': 'float',
    'LREAL': 'double',
    'STRING': 'String',
    'TIME': 'Duration',
    'ARRAY': 'List',
  },
};

// ============================================================================
// AI CONTEXT GENERATOR CLASS
// ============================================================================

export class AIContextGenerator {
  constructor(_config?: AIContextGeneratorConfig) {
    // Config reserved for future use
  }

  /**
   * Generate complete AI context package
   */
  generateContext(
    pous: STPOU[],
    docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult,
    safety: SafetyAnalysisResult,
    tribalKnowledge: TribalKnowledgeExtractionResult,
    targetLanguage: TargetLanguage,
    projectInfo?: { name: string; vendor?: VendorId; plcType?: string }
  ): AIContextPackage {
    return {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      targetLanguage,
      project: this.generateProjectContext(pous, projectInfo),
      conventions: this.extractConventions(pous),
      types: this.generateTypeContext(pous, targetLanguage),
      safety: this.generateSafetyContext(safety),
      pous: pous.map(pou => this.generatePOUContext(
        pou, docstrings, stateMachines, safety, targetLanguage
      )),
      tribalKnowledge: tribalKnowledge.items,
      translationGuide: this.generateTranslationGuide(targetLanguage),
      verificationRequirements: this.generateVerificationRequirements(pous, safety, stateMachines),
    };
  }

  // ==========================================================================
  // PROJECT CONTEXT
  // ==========================================================================

  private generateProjectContext(
    pous: STPOU[],
    projectInfo?: { name: string; vendor?: VendorId; plcType?: string }
  ): AIProjectContext {
    const totalLines = pous.reduce((sum, pou) => 
      sum + (pou.bodyEndLine - pou.bodyStartLine), 0
    );

    return {
      name: projectInfo?.name ?? 'Unknown Project',
      vendor: projectInfo?.vendor ?? 'generic-st',
      plcType: projectInfo?.plcType ?? null,
      totalPOUs: pous.length,
      totalLines,
      languages: ['ST'],
    };
  }

  // ==========================================================================
  // CONVENTIONS
  // ==========================================================================

  private extractConventions(pous: STPOU[]): AIConventionContext {
    const namingPatterns: Record<string, string> = {};
    const variablePrefixes: Record<string, string> = {};
    const stateEncodings: string[] = [];
    const commentStyles: string[] = [];

    // Analyze variable naming patterns
    for (const pou of pous) {
      for (const v of pou.variables) {
        // Detect prefixes
        const prefixMatch = v.name.match(/^([a-z]+)_/i);
        if (prefixMatch) {
          const prefix = prefixMatch[1]!.toLowerCase();
          variablePrefixes[prefix] = this.inferPrefixMeaning(prefix);
        }

        // Detect Hungarian notation
        const hungarianMatch = v.name.match(/^([a-z]{1,3})[A-Z]/);
        if (hungarianMatch) {
          const prefix = hungarianMatch[1]!;
          variablePrefixes[prefix] = this.inferHungarianMeaning(prefix);
        }
      }
    }

    // Common patterns
    namingPatterns['function_block'] = 'FB_<Name>';
    namingPatterns['program'] = 'PRG_<Name> or <Name>_Main';
    namingPatterns['function'] = 'FC_<Name> or <Name>';

    // State encodings
    stateEncodings.push('Integer values (0, 10, 20, ...)');
    stateEncodings.push('Enum values');

    // Comment styles
    commentStyles.push('(* Block comment *)');
    commentStyles.push('// Line comment');

    return {
      namingPatterns,
      variablePrefixes,
      stateEncodings,
      commentStyles,
    };
  }

  private inferPrefixMeaning(prefix: string): string {
    const meanings: Record<string, string> = {
      'b': 'Boolean',
      'i': 'Integer',
      'r': 'Real/Float',
      's': 'String',
      'n': 'Number',
      'w': 'Word',
      'd': 'Double word',
      't': 'Time/Timer',
      'dt': 'Date/Time',
      'arr': 'Array',
      'st': 'Structure',
      'fb': 'Function Block instance',
      'il': 'Interlock',
      'pb': 'Pushbutton',
      'ls': 'Limit switch',
      'ps': 'Pressure switch',
      'ts': 'Temperature switch',
      'mv': 'Motor valve',
      'sv': 'Solenoid valve',
    };
    return meanings[prefix] ?? 'Unknown';
  }

  private inferHungarianMeaning(prefix: string): string {
    const meanings: Record<string, string> = {
      'b': 'Boolean',
      'n': 'Integer',
      'r': 'Real',
      's': 'String',
      'w': 'Word',
      'dw': 'Double word',
      'by': 'Byte',
      'a': 'Array',
      'p': 'Pointer',
      'fb': 'Function Block',
    };
    return meanings[prefix] ?? 'Unknown';
  }

  // ==========================================================================
  // TYPE CONTEXT
  // ==========================================================================

  private generateTypeContext(pous: STPOU[], targetLanguage: TargetLanguage): AITypeContext {
    const typeMapping = TYPE_MAPPINGS[targetLanguage] ?? TYPE_MAPPINGS.python;
    const customTypes: string[] = [];
    const structDefinitions: Record<string, unknown> = {};

    // Collect custom types from variables
    for (const pou of pous) {
      for (const v of pou.variables) {
        const baseType = v.dataType.split('[')[0]!.trim();
        if (!typeMapping[baseType] && !customTypes.includes(baseType)) {
          customTypes.push(baseType);
        }
      }
    }

    return {
      plcToTarget: typeMapping,
      customTypes,
      structDefinitions,
    };
  }

  // ==========================================================================
  // SAFETY CONTEXT
  // ==========================================================================

  private generateSafetyContext(safety: SafetyAnalysisResult): AISafetyContext {
    return {
      interlocks: safety.interlocks,
      criticalPaths: safety.interlocks
        .filter(i => i.severity === 'critical')
        .map(i => `${i.name} at ${i.location.file}:${i.location.line}`),
      mustPreserve: [
        ...safety.interlocks.map(i => `Interlock: ${i.name}`),
        ...safety.bypasses.map(b => `BYPASS (review): ${b.name}`),
      ],
    };
  }

  // ==========================================================================
  // POU CONTEXT
  // ==========================================================================

  private generatePOUContext(
    pou: STPOU,
    docstrings: DocstringExtractionResult,
    stateMachines: StateMachineExtractionResult,
    safety: SafetyAnalysisResult,
    targetLanguage: TargetLanguage
  ): AIPOUContext {
    const pouDoc = docstrings.docstrings.find(d => 
      d.associatedBlock === pou.name
    );

    const pouStateMachines = stateMachines.stateMachines.filter(sm => 
      sm.file === pou.location.file
    );

    const pouInterlocks = safety.interlocks.filter(i => 
      i.location.file === pou.location.file
    );

    return {
      pouId: pou.id,
      pouName: pou.name,
      pouType: pou.type,
      purpose: pouDoc?.summary ?? pouDoc?.description ?? 'No documentation available',
      interface: {
        inputs: pou.variables
          .filter(v => v.section === 'VAR_INPUT')
          .map(v => this.describeVariable(v)),
        outputs: pou.variables
          .filter(v => v.section === 'VAR_OUTPUT')
          .map(v => this.describeVariable(v)),
        inOuts: pou.variables
          .filter(v => v.section === 'VAR_IN_OUT')
          .map(v => this.describeVariable(v)),
      },
      behavior: {
        summary: this.summarizeBehavior(pou, pouStateMachines),
        stateMachines: pouStateMachines.map(sm => 
          `${sm.name}: ${sm.states.length} states, ${sm.transitions.length} transitions`
        ),
        algorithms: this.extractAlgorithms(pou),
      },
      safety: {
        isSafetyCritical: pouInterlocks.length > 0 || 
          pou.variables.some(v => v.isSafetyCritical),
        interlocks: pouInterlocks.map(i => i.name),
        constraints: this.extractSafetyConstraints(pou, safety),
      },
      translationHints: this.generateTranslationHints(pou, targetLanguage),
      suggestedTests: this.suggestTestCases(pou, pouStateMachines),
    };
  }

  private describeVariable(v: STVariable): AIVariableDescription {
    return {
      name: v.name,
      type: v.dataType,
      description: v.comment ?? 'No description',
      constraints: this.inferConstraints(v),
    };
  }

  private inferConstraints(v: STVariable): string[] {
    const constraints: string[] = [];

    if (v.isSafetyCritical) {
      constraints.push('SAFETY CRITICAL - must preserve behavior exactly');
    }

    if (v.initialValue) {
      constraints.push(`Default: ${v.initialValue}`);
    }

    if (v.isArray && v.arrayBounds) {
      constraints.push(`Array bounds: ${JSON.stringify(v.arrayBounds)}`);
    }

    return constraints;
  }

  private summarizeBehavior(
    pou: STPOU,
    stateMachines: StateMachineExtractionResult['stateMachines']
  ): string {
    const parts: string[] = [];

    if (pou.documentation?.summary) {
      parts.push(pou.documentation.summary);
    }

    if (stateMachines.length > 0) {
      parts.push(`Contains ${stateMachines.length} state machine(s)`);
    }

    const inputs = pou.variables.filter(v => v.section === 'VAR_INPUT');
    const outputs = pou.variables.filter(v => v.section === 'VAR_OUTPUT');
    parts.push(`${inputs.length} inputs, ${outputs.length} outputs`);

    return parts.join('. ');
  }

  private extractAlgorithms(pou: STPOU): string[] {
    const algorithms: string[] = [];

    // Look for common patterns in variable names
    const hasTimer = pou.variables.some(v => 
      v.dataType.includes('TON') || v.dataType.includes('TOF') || v.dataType.includes('TP')
    );
    if (hasTimer) {
      algorithms.push('Timer-based logic');
    }

    const hasCounter = pou.variables.some(v => 
      v.dataType.includes('CTU') || v.dataType.includes('CTD') || v.dataType.includes('CTUD')
    );
    if (hasCounter) {
      algorithms.push('Counter-based logic');
    }

    const hasPID = pou.variables.some(v => 
      v.name.toLowerCase().includes('pid') || v.dataType.toLowerCase().includes('pid')
    );
    if (hasPID) {
      algorithms.push('PID control loop');
    }

    return algorithms;
  }

  private extractSafetyConstraints(pou: STPOU, safety: SafetyAnalysisResult): string[] {
    const constraints: string[] = [];

    const pouInterlocks = safety.interlocks.filter(i => 
      i.location.file === pou.location.file
    );

    for (const interlock of pouInterlocks) {
      constraints.push(`${interlock.type}: ${interlock.name} must be preserved`);
    }

    const safetyVars = pou.variables.filter(v => v.isSafetyCritical);
    for (const v of safetyVars) {
      constraints.push(`Safety variable ${v.name} behavior must be preserved`);
    }

    return constraints;
  }

  // ==========================================================================
  // TRANSLATION HINTS
  // ==========================================================================

  private generateTranslationHints(pou: STPOU, target: TargetLanguage): AITranslationHint[] {
    const hints: AITranslationHint[] = [];

    // Timer translation
    const hasTimers = pou.variables.some(v => 
      v.dataType.includes('TON') || v.dataType.includes('TOF') || v.dataType.includes('TP')
    );
    if (hasTimers) {
      hints.push({
        category: 'timing',
        plcConstruct: 'TON/TOF/TP timers',
        targetEquivalent: this.getTimerEquivalent(target),
        notes: 'PLC timers are scan-based. Ensure equivalent behavior in target.',
        example: this.getTimerExample(target),
      });
    }

    // I/O access
    const hasIO = pou.variables.some(v => v.ioAddress);
    if (hasIO) {
      hints.push({
        category: 'io',
        plcConstruct: 'Direct I/O (%IX, %QX, etc.)',
        targetEquivalent: 'Hardware abstraction layer',
        notes: 'I/O must be abstracted through hardware interface layer.',
        example: this.getIOExample(target),
      });
    }

    // State machine
    // (Would need state machine info passed in)

    return hints;
  }

  private getTimerEquivalent(target: TargetLanguage): string {
    switch (target) {
      case 'python': return 'asyncio.sleep() or threading.Timer';
      case 'rust': return 'tokio::time::sleep() or std::thread::sleep()';
      case 'typescript': return 'setTimeout() or setInterval()';
      case 'csharp': return 'System.Timers.Timer or Task.Delay()';
      case 'cpp': return 'std::chrono with std::this_thread::sleep_for()';
      case 'go': return 'time.Sleep() or time.After()';
      case 'java': return 'ScheduledExecutorService or Timer';
      default: return 'Language-specific timer';
    }
  }

  private getTimerExample(target: TargetLanguage): string {
    switch (target) {
      case 'python':
        return `# TON equivalent
class TON:
    def __init__(self, preset_time: float):
        self.PT = preset_time
        self.ET = 0.0
        self.Q = False
        self._start_time = None
    
    def __call__(self, IN: bool) -> bool:
        if IN and self._start_time is None:
            self._start_time = time.time()
        elif not IN:
            self._start_time = None
            self.ET = 0.0
            self.Q = False
            return False
        
        if self._start_time:
            self.ET = time.time() - self._start_time
            self.Q = self.ET >= self.PT
        return self.Q`;
      default:
        return '// See language-specific timer implementation';
    }
  }

  private getIOExample(target: TargetLanguage): string {
    switch (target) {
      case 'python':
        return `# I/O abstraction
class IOInterface:
    def read_input(self, address: str) -> bool:
        # Implement hardware-specific read
        pass
    
    def write_output(self, address: str, value: bool) -> None:
        # Implement hardware-specific write
        pass`;
      default:
        return '// See language-specific I/O abstraction';
    }
  }

  // ==========================================================================
  // TRANSLATION GUIDE
  // ==========================================================================

  private generateTranslationGuide(targetLanguage: TargetLanguage): AITranslationGuide {
    const typeMapping = TYPE_MAPPINGS[targetLanguage] ?? TYPE_MAPPINGS.python;

    const patternMapping: AIPatternMapping[] = [
      {
        plcPattern: 'CASE state OF ... END_CASE',
        targetPattern: this.getStateMachinePattern(targetLanguage),
        example: this.getStateMachineExample(targetLanguage),
      },
      {
        plcPattern: 'TON timer',
        targetPattern: this.getTimerEquivalent(targetLanguage),
        example: this.getTimerExample(targetLanguage),
      },
      {
        plcPattern: 'IF condition THEN ... END_IF',
        targetPattern: 'Standard if statement',
        example: 'if condition: ... (Python) / if (condition) { ... } (others)',
      },
    ];

    const warnings: string[] = [
      'PLC code executes cyclically - ensure equivalent behavior',
      'Timer behavior is scan-based - may need adjustment',
      'I/O access must be abstracted',
      'Safety interlocks must be preserved exactly',
    ];

    return {
      targetLanguage,
      typeMapping,
      patternMapping,
      warnings,
    };
  }

  private getStateMachinePattern(target: TargetLanguage): string {
    switch (target) {
      case 'python': return 'Enum-based state machine or state pattern';
      case 'rust': return 'Enum with match expression';
      case 'typescript': return 'Union types with switch or state machine library';
      default: return 'Enum-based state machine';
    }
  }

  private getStateMachineExample(target: TargetLanguage): string {
    switch (target) {
      case 'python':
        return `from enum import Enum, auto

class State(Enum):
    IDLE = 0
    RUNNING = 10
    STOPPED = 20

class StateMachine:
    def __init__(self):
        self.state = State.IDLE
    
    def update(self):
        match self.state:
            case State.IDLE:
                # Handle idle state
                pass
            case State.RUNNING:
                # Handle running state
                pass`;
      default:
        return '// See language-specific state machine implementation';
    }
  }

  // ==========================================================================
  // VERIFICATION REQUIREMENTS
  // ==========================================================================

  private generateVerificationRequirements(
    pous: STPOU[],
    safety: SafetyAnalysisResult,
    stateMachines: StateMachineExtractionResult
  ): AIVerificationRequirement[] {
    const requirements: AIVerificationRequirement[] = [];

    // Safety verification
    if (safety.interlocks.length > 0) {
      requirements.push({
        category: 'safety',
        requirement: 'All safety interlocks must produce identical behavior',
        testApproach: 'Test each interlock with boundary conditions',
      });
    }

    // State machine verification
    if (stateMachines.stateMachines.length > 0) {
      requirements.push({
        category: 'state-machine',
        requirement: 'State transitions must match original behavior',
        testApproach: 'Test all state transitions with guard conditions',
      });
    }

    // I/O verification
    const hasIO = pous.some(pou => pou.variables.some(v => v.ioAddress));
    if (hasIO) {
      requirements.push({
        category: 'io',
        requirement: 'I/O behavior must be verified against hardware',
        testApproach: 'Hardware-in-the-loop testing or simulation',
      });
    }

    // Timing verification
    const hasTimers = pous.some(pou => 
      pou.variables.some(v => 
        v.dataType.includes('TON') || v.dataType.includes('TOF')
      )
    );
    if (hasTimers) {
      requirements.push({
        category: 'timing',
        requirement: 'Timer behavior must match within acceptable tolerance',
        testApproach: 'Timing tests with measurement',
      });
    }

    return requirements;
  }

  // ==========================================================================
  // TEST CASE SUGGESTIONS
  // ==========================================================================

  private suggestTestCases(
    pou: STPOU,
    stateMachines: StateMachineExtractionResult['stateMachines']
  ): string[] {
    const tests: string[] = [];

    // Input boundary tests
    const inputs = pou.variables.filter(v => v.section === 'VAR_INPUT');
    for (const input of inputs) {
      tests.push(`Test ${input.name} with boundary values`);
    }

    // State machine tests
    for (const sm of stateMachines) {
      tests.push(`Test all ${sm.states.length} states in ${sm.name}`);
      tests.push(`Test all ${sm.transitions.length} transitions in ${sm.name}`);
      if (sm.verification.hasDeadlocks) {
        tests.push(`Verify deadlock handling in ${sm.name}`);
      }
    }

    // Safety tests
    const safetyVars = pou.variables.filter(v => v.isSafetyCritical);
    for (const v of safetyVars) {
      tests.push(`Test safety behavior of ${v.name}`);
    }

    return tests;
  }
}


// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createAIContextGenerator(config?: AIContextGeneratorConfig): AIContextGenerator {
  return new AIContextGenerator(config);
}
