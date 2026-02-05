/**
 * AI Context Generator Tests
 */

import { describe, it, expect } from 'vitest';
import { AIContextGenerator, createAIContextGenerator } from '../analyzers/ai-context.js';
import type { STPOU, SafetyAnalysisResult } from '../types.js';
import type { DocstringExtractionResult, StateMachineExtractionResult, TribalKnowledgeExtractionResult } from '../extractors/index.js';

describe('AIContextGenerator', () => {
  const createMockPOU = (overrides: Partial<STPOU> = {}): STPOU => ({
    id: 'test-pou-1',
    type: 'FUNCTION_BLOCK',
    name: 'FB_Test',
    qualifiedName: 'FB_Test',
    location: { file: 'test.st', line: 1, column: 1 },
    documentation: null,
    variables: [
      {
        id: 'var-1',
        name: 'bInput',
        dataType: 'BOOL',
        section: 'VAR_INPUT',
        initialValue: null,
        comment: 'Input signal',
        isArray: false,
        arrayBounds: null,
        isSafetyCritical: false,
        ioAddress: null,
        location: { file: 'test.st', line: 5, column: 1 },
        pouId: 'test-pou-1',
      },
      {
        id: 'var-2',
        name: 'bOutput',
        dataType: 'BOOL',
        section: 'VAR_OUTPUT',
        initialValue: null,
        comment: 'Output signal',
        isArray: false,
        arrayBounds: null,
        isSafetyCritical: false,
        ioAddress: null,
        location: { file: 'test.st', line: 6, column: 1 },
        pouId: 'test-pou-1',
      },
    ],
    extends: null,
    implements: [],
    methods: [],
    bodyStartLine: 10,
    bodyEndLine: 50,
    vendorAttributes: {},
    ...overrides,
  });

  const createMockDocstrings = (): DocstringExtractionResult => ({
    docstrings: [],
    summary: {
      total: 0,
      byBlock: {},
      withParams: 0,
      withHistory: 0,
      withWarnings: 0,
      averageQuality: 0,
    },
  });

  const createMockStateMachines = (): StateMachineExtractionResult => ({
    stateMachines: [],
    summary: {
      total: 0,
      totalStates: 0,
      byVariable: {},
      withDeadlocks: 0,
      withGaps: 0,
    },
  });

  const createMockSafety = (): SafetyAnalysisResult => ({
    interlocks: [],
    bypasses: [],
    criticalWarnings: [],
    summary: {
      totalInterlocks: 0,
      byType: {
        'interlock': 0,
        'permissive': 0,
        'estop': 0,
        'safety-relay': 0,
        'safety-device': 0,
        'bypass': 0,
      },
      bypassCount: 0,
      criticalWarningCount: 0,
    },
  });

  const createMockTribalKnowledge = (): TribalKnowledgeExtractionResult => ({
    items: [],
    summary: {
      total: 0,
      byType: {},
      byImportance: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      criticalCount: 0,
    },
  });

  describe('factory function', () => {
    it('should create generator', () => {
      const generator = createAIContextGenerator();
      expect(generator).toBeInstanceOf(AIContextGenerator);
    });
  });

  describe('generateContext', () => {
    it('should generate context for Python target', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'python'
      );

      expect(result.version).toBe('1.0.0');
      expect(result.targetLanguage).toBe('python');
      expect(result.pous).toHaveLength(1);
      expect(result.types.plcToTarget['BOOL']).toBe('bool');
      expect(result.types.plcToTarget['INT']).toBe('int');
      expect(result.types.plcToTarget['REAL']).toBe('float');
    });

    it('should generate context for Rust target', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'rust'
      );

      expect(result.targetLanguage).toBe('rust');
      expect(result.types.plcToTarget['BOOL']).toBe('bool');
      expect(result.types.plcToTarget['INT']).toBe('i16');
      expect(result.types.plcToTarget['DINT']).toBe('i32');
    });

    it('should generate context for TypeScript target', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'typescript'
      );

      expect(result.targetLanguage).toBe('typescript');
      expect(result.types.plcToTarget['BOOL']).toBe('boolean');
      expect(result.types.plcToTarget['STRING']).toBe('string');
    });

    it('should include POU interface information', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'python'
      );

      const pouContext = result.pous[0]!;
      expect(pouContext.pouName).toBe('FB_Test');
      expect(pouContext.interface.inputs).toHaveLength(1);
      expect(pouContext.interface.outputs).toHaveLength(1);
      expect(pouContext.interface.inputs[0]!.name).toBe('bInput');
    });

    it('should include translation guide', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'python'
      );

      expect(result.translationGuide).toBeDefined();
      expect(result.translationGuide.targetLanguage).toBe('python');
      expect(result.translationGuide.typeMapping).toBeDefined();
      expect(result.translationGuide.patternMapping.length).toBeGreaterThan(0);
    });

    it('should include project info when provided', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        createMockSafety(),
        createMockTribalKnowledge(),
        'python',
        { name: 'TestProject', vendor: 'siemens-tia', plcType: 'S7-1500' }
      );

      expect(result.project.name).toBe('TestProject');
      expect(result.project.vendor).toBe('siemens-tia');
      expect(result.project.plcType).toBe('S7-1500');
    });

    it('should include safety context', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const safetyWithInterlocks: SafetyAnalysisResult = {
        ...createMockSafety(),
        interlocks: [{
          id: 'il-1',
          name: 'bIL_DoorClosed',
          type: 'interlock',
          location: { file: 'test.st', line: 20, column: 1 },
          pouId: null,
          isBypassed: false,
          bypassCondition: null,
          confidence: 0.95,
          severity: 'high',
          relatedInterlocks: [],
        }],
      };

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        safetyWithInterlocks,
        createMockTribalKnowledge(),
        'python'
      );

      expect(result.safety.interlocks).toHaveLength(1);
      expect(result.safety.mustPreserve.length).toBeGreaterThan(0);
    });

    it('should generate verification requirements', () => {
      const generator = new AIContextGenerator();
      const pou = createMockPOU();

      const safetyWithInterlocks: SafetyAnalysisResult = {
        ...createMockSafety(),
        interlocks: [{
          id: 'il-1',
          name: 'bIL_Test',
          type: 'interlock',
          location: { file: 'test.st', line: 20, column: 1 },
          pouId: null,
          isBypassed: false,
          bypassCondition: null,
          confidence: 0.95,
          severity: 'high',
          relatedInterlocks: [],
        }],
      };

      const result = generator.generateContext(
        [pou],
        createMockDocstrings(),
        createMockStateMachines(),
        safetyWithInterlocks,
        createMockTribalKnowledge(),
        'python'
      );

      expect(result.verificationRequirements.length).toBeGreaterThan(0);
      expect(result.verificationRequirements.some(r => r.category === 'safety')).toBe(true);
    });
  });
});
