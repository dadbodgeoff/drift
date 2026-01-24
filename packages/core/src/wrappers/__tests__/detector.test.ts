import { describe, it, expect } from 'vitest';
import {
  detectWrappers,
  getWrappersByDepth,
  getWrappersForPrimitive,
  calculateWrapperStats,
  type FunctionInfo,
  type DetectionContext,
} from '../detection/detector.js';
import type { DetectedPrimitive } from '../types.js';

describe('Wrapper Detection', () => {
  const createPrimitive = (name: string): DetectedPrimitive => ({
    name,
    framework: 'react',
    category: 'state',
    source: { type: 'bootstrap', confidence: 1.0 },
    language: 'typescript',
    usageCount: 10,
  });

  const createFunction = (
    name: string,
    calls: string[],
    overrides: Partial<FunctionInfo> = {}
  ): FunctionInfo => ({
    name,
    qualifiedName: `src/hooks/${name}.ts:${name}`,
    file: `src/hooks/${name}.ts`,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    isAsync: false,
    calls: calls.map((c, i) => ({ calleeName: c, line: i + 2 })),
    ...overrides,
  });

  describe('detectWrappers', () => {
    it('detects direct wrappers (depth 1)', () => {
      const primitives = [createPrimitive('useState'), createPrimitive('useEffect')];

      const functions: FunctionInfo[] = [
        createFunction('useCounter', ['useState']),
        createFunction('useLogger', ['useEffect']),
        createFunction('regularFunction', ['console.log']),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);

      expect(wrappers).toHaveLength(2);
      expect(wrappers.map((w) => w.name)).toContain('useCounter');
      expect(wrappers.map((w) => w.name)).toContain('useLogger');
      expect(wrappers.every((w) => w.depth === 1)).toBe(true);
    });

    it('detects transitive wrappers (depth 2+)', () => {
      const primitives = [createPrimitive('useState')];

      const functions: FunctionInfo[] = [
        createFunction('useCounter', ['useState']),
        createFunction('useDoubleCounter', ['useCounter'], {
          qualifiedName: 'src/hooks/useDoubleCounter.ts:useDoubleCounter',
          calls: [{ calleeName: 'useCounter', calleeQualifiedName: 'src/hooks/useCounter.ts:useCounter', line: 2 }],
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);

      expect(wrappers).toHaveLength(2);

      const directWrapper = wrappers.find((w) => w.name === 'useCounter');
      const transitiveWrapper = wrappers.find((w) => w.name === 'useDoubleCounter');

      expect(directWrapper?.depth).toBe(1);
      expect(directWrapper?.directPrimitives).toContain('useState');

      expect(transitiveWrapper?.depth).toBe(2);
      expect(transitiveWrapper?.transitivePrimitives).toContain('useState');
      expect(transitiveWrapper?.callsWrappers).toContain('src/hooks/useCounter.ts:useCounter');
    });

    it('computes primitive signature correctly', () => {
      const primitives = [
        createPrimitive('useState'),
        createPrimitive('useEffect'),
        createPrimitive('useCallback'),
      ];

      const functions: FunctionInfo[] = [
        createFunction('useComplexHook', ['useState', 'useEffect', 'useCallback']),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);

      expect(wrappers).toHaveLength(1);
      expect(wrappers[0].primitiveSignature).toEqual(['useCallback', 'useEffect', 'useState']);
    });

    it('builds calledBy relationships', () => {
      const primitives = [createPrimitive('useState')];

      const functions: FunctionInfo[] = [
        createFunction('useCounter', ['useState']),
        createFunction('ComponentA', ['useCounter'], {
          qualifiedName: 'src/components/ComponentA.tsx:ComponentA',
          calls: [{ calleeName: 'useCounter', calleeQualifiedName: 'src/hooks/useCounter.ts:useCounter', line: 5 }],
        }),
        createFunction('ComponentB', ['useCounter'], {
          qualifiedName: 'src/components/ComponentB.tsx:ComponentB',
          calls: [{ calleeName: 'useCounter', calleeQualifiedName: 'src/hooks/useCounter.ts:useCounter', line: 5 }],
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);
      const useCounter = wrappers.find((w) => w.name === 'useCounter');

      expect(useCounter?.calledBy).toHaveLength(2);
      expect(useCounter?.calledBy).toContain('src/components/ComponentA.tsx:ComponentA');
      expect(useCounter?.calledBy).toContain('src/components/ComponentB.tsx:ComponentB');
    });

    it('detects factory patterns', () => {
      const primitives = [createPrimitive('useState')];

      const functions: FunctionInfo[] = [
        createFunction('createCounter', ['useState'], {
          returnType: '() => number',
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);

      expect(wrappers).toHaveLength(1);
      expect(wrappers[0].isFactory).toBe(true);
    });

    it('detects higher-order functions', () => {
      const primitives = [createPrimitive('useEffect')];

      const functions: FunctionInfo[] = [
        createFunction('useEffectWithCleanup', ['useEffect'], {
          parameters: [{ name: 'callback', type: '() => void' }],
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);

      expect(wrappers).toHaveLength(1);
      expect(wrappers[0].isHigherOrder).toBe(true);
    });

    it('respects maxDepth option', () => {
      const primitives = [createPrimitive('useState')];

      // Create a chain: level1 -> level2 -> level3 -> useState
      // level3 is depth 1 (calls useState directly)
      // level2 is depth 2 (calls level3 which calls useState)
      // level1 is depth 3 (calls level2 which calls level3 which calls useState)
      const level3: FunctionInfo = {
        name: 'level3',
        qualifiedName: 'src/hooks/level3.ts:level3',
        file: 'src/hooks/level3.ts',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
        isAsync: false,
        calls: [{ calleeName: 'useState', line: 2 }],
      };

      const level2: FunctionInfo = {
        name: 'level2',
        qualifiedName: 'src/hooks/level2.ts:level2',
        file: 'src/hooks/level2.ts',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
        isAsync: false,
        calls: [{ calleeName: 'level3', calleeQualifiedName: 'src/hooks/level3.ts:level3', line: 2 }],
      };

      const level1: FunctionInfo = {
        name: 'level1',
        qualifiedName: 'src/hooks/level1.ts:level1',
        file: 'src/hooks/level1.ts',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
        isAsync: false,
        calls: [{ calleeName: 'level2', calleeQualifiedName: 'src/hooks/level2.ts:level2', line: 2 }],
      };

      const context: DetectionContext = {
        functions: [level3, level2, level1],
        primitives,
        language: 'typescript',
      };

      const wrappersDepth2 = detectWrappers(context, { maxDepth: 2 });
      expect(wrappersDepth2).toHaveLength(2); // level3 (depth 1) and level2 (depth 2)
      expect(wrappersDepth2.map(w => w.name).sort()).toEqual(['level2', 'level3']);

      const wrappersDepth3 = detectWrappers(context, { maxDepth: 3 });
      expect(wrappersDepth3).toHaveLength(3); // all three
      expect(wrappersDepth3.map(w => w.name).sort()).toEqual(['level1', 'level2', 'level3']);
    });
  });

  describe('getWrappersByDepth', () => {
    it('groups wrappers by depth', () => {
      const primitives = [createPrimitive('useState')];

      const functions: FunctionInfo[] = [
        createFunction('useA', ['useState']),
        createFunction('useB', ['useState']),
        createFunction('useC', ['useA'], {
          qualifiedName: 'src/useC.ts:useC',
          calls: [{ calleeName: 'useA', calleeQualifiedName: 'src/hooks/useA.ts:useA', line: 2 }],
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);
      const byDepth = getWrappersByDepth(wrappers);

      expect(byDepth.get(1)?.length).toBe(2);
      expect(byDepth.get(2)?.length).toBe(1);
    });
  });

  describe('getWrappersForPrimitive', () => {
    it('finds all wrappers for a primitive', () => {
      const primitives = [createPrimitive('useState'), createPrimitive('useEffect')];

      const functions: FunctionInfo[] = [
        createFunction('useA', ['useState']),
        createFunction('useB', ['useState', 'useEffect']),
        createFunction('useC', ['useEffect']),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);
      const useStateWrappers = getWrappersForPrimitive(wrappers, 'useState');

      expect(useStateWrappers).toHaveLength(2);
      expect(useStateWrappers.map((w) => w.name)).toContain('useA');
      expect(useStateWrappers.map((w) => w.name)).toContain('useB');
    });
  });

  describe('calculateWrapperStats', () => {
    it('calculates correct statistics', () => {
      const primitives = [createPrimitive('useState')];

      const functions: FunctionInfo[] = [
        createFunction('useA', ['useState'], { isAsync: true }),
        createFunction('useB', ['useState'], { returnType: '() => void' }),
        createFunction('useC', ['useA'], {
          qualifiedName: 'src/useC.ts:useC',
          calls: [{ calleeName: 'useA', calleeQualifiedName: 'src/hooks/useA.ts:useA', line: 2 }],
          parameters: [{ name: 'callback', type: '() => void' }],
        }),
      ];

      const context: DetectionContext = {
        functions,
        primitives,
        language: 'typescript',
      };

      const wrappers = detectWrappers(context);
      const stats = calculateWrapperStats(wrappers);

      expect(stats.totalWrappers).toBe(3);
      expect(stats.maxDepth).toBe(2);
      expect(stats.asyncCount).toBe(1);
      expect(stats.factoryCount).toBe(1);
      expect(stats.higherOrderCount).toBe(1);
    });

    it('handles empty wrapper list', () => {
      const stats = calculateWrapperStats([]);

      expect(stats.totalWrappers).toBe(0);
      expect(stats.avgDepth).toBe(0);
      expect(stats.maxDepth).toBe(0);
    });
  });
});
