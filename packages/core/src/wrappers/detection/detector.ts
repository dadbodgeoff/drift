/**
 * Wrapper Detection
 *
 * Detects functions that wrap framework primitives (direct and transitive).
 */

import type {
  DetectedPrimitive,
  WrapperFunction,
  SupportedLanguage,
} from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface FunctionInfo {
  name: string;
  qualifiedName: string;
  file: string;
  startLine: number;
  endLine: number;
  language: SupportedLanguage;
  isAsync: boolean;
  returnType?: string;
  parameters?: ParameterInfo[];
  decorators?: string[];
  calls: CallInfo[];
}

export interface ParameterInfo {
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface CallInfo {
  calleeName: string;
  calleeQualifiedName?: string;
  line: number;
  isCallback?: boolean;
}

export interface DetectionContext {
  functions: FunctionInfo[];
  primitives: DetectedPrimitive[];
  language: SupportedLanguage;
}

export interface DetectionOptions {
  maxDepth?: number;
  includeTestFiles?: boolean;
  minUsageCount?: number;
}

const DEFAULT_OPTIONS: Required<DetectionOptions> = {
  maxDepth: 10,
  includeTestFiles: true,
  minUsageCount: 0,
};

// =============================================================================
// Main Detection
// =============================================================================

/**
 * Detect all wrapper functions in the codebase
 */
export function detectWrappers(
  context: DetectionContext,
  options: DetectionOptions = {}
): WrapperFunction[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const primitiveNames = new Set(context.primitives.map((p) => p.name));
  const wrappers = new Map<string, WrapperFunction>();

  // Pass 1: Find direct wrappers (depth 1)
  for (const func of context.functions) {
    if (!opts.includeTestFiles && isTestFile(func.file)) continue;

    const calledPrimitives = func.calls
      .filter((c) => primitiveNames.has(c.calleeName))
      .map((c) => c.calleeName);

    if (calledPrimitives.length > 0) {
      const uniquePrimitives = [...new Set(calledPrimitives)];
      wrappers.set(func.qualifiedName, createWrapper(func, {
        directPrimitives: uniquePrimitives,
        transitivePrimitives: [],
        primitiveSignature: uniquePrimitives.sort(),
        depth: 1,
        callsWrappers: [],
      }));
    }
  }

  // Pass 2+: Find transitive wrappers (depth 2+)
  let changed = true;
  let currentDepth = 1;

  while (changed && currentDepth < opts.maxDepth) {
    changed = false;
    currentDepth++;

    // Collect new wrappers for this depth (don't add to map until end of pass)
    const newWrappers: Array<[string, WrapperFunction]> = [];

    for (const func of context.functions) {
      if (wrappers.has(func.qualifiedName)) continue;
      if (!opts.includeTestFiles && isTestFile(func.file)) continue;

      const calledWrappers = func.calls
        .filter((c) => wrappers.has(c.calleeName) || wrappers.has(c.calleeQualifiedName || ''))
        .map((c) => c.calleeQualifiedName || c.calleeName);

      if (calledWrappers.length > 0) {
        // Collect transitive primitives from all called wrappers
        const transitive = new Set<string>();
        for (const wrapperName of calledWrappers) {
          const wrapper = wrappers.get(wrapperName);
          if (wrapper) {
            wrapper.directPrimitives.forEach((p) => transitive.add(p));
            wrapper.transitivePrimitives.forEach((p) => transitive.add(p));
          }
        }

        // Also check if this function directly calls any primitives
        const directPrimitives = func.calls
          .filter((c) => primitiveNames.has(c.calleeName))
          .map((c) => c.calleeName);

        const allPrimitives = new Set([...transitive, ...directPrimitives]);

        newWrappers.push([func.qualifiedName, createWrapper(func, {
          directPrimitives: [...new Set(directPrimitives)],
          transitivePrimitives: [...transitive],
          primitiveSignature: [...allPrimitives].sort(),
          depth: currentDepth,
          callsWrappers: calledWrappers,
        })]);

        changed = true;
      }
    }

    // Add all new wrappers at once (after processing all functions)
    for (const [key, wrapper] of newWrappers) {
      wrappers.set(key, wrapper);
    }
  }

  // Pass 3: Build reverse edges (calledBy)
  for (const func of context.functions) {
    for (const call of func.calls) {
      const wrapper = wrappers.get(call.calleeName) || wrappers.get(call.calleeQualifiedName || '');
      if (wrapper && !wrapper.calledBy.includes(func.qualifiedName)) {
        wrapper.calledBy.push(func.qualifiedName);
      }
    }
  }

  // Filter by minimum usage
  const result = [...wrappers.values()].filter(
    (w) => w.calledBy.length >= opts.minUsageCount
  );

  return result;
}


// =============================================================================
// Wrapper Creation
// =============================================================================

interface WrapperData {
  directPrimitives: string[];
  transitivePrimitives: string[];
  primitiveSignature: string[];
  depth: number;
  callsWrappers: string[];
}

function createWrapper(func: FunctionInfo, data: WrapperData): WrapperFunction {
  return {
    name: func.name,
    qualifiedName: func.qualifiedName,
    file: func.file,
    line: func.startLine,
    language: func.language,
    directPrimitives: data.directPrimitives,
    transitivePrimitives: data.transitivePrimitives,
    primitiveSignature: data.primitiveSignature,
    depth: data.depth,
    callsWrappers: data.callsWrappers,
    calledBy: [],
    isFactory: detectFactoryPattern(func),
    isHigherOrder: detectHigherOrderPattern(func),
    isDecorator: detectDecoratorPattern(func),
    isAsync: func.isAsync,
    returnType: func.returnType,
    parameterSignature: func.parameters?.map((p) => p.type || p.name),
  };
}

// =============================================================================
// Pattern Detection
// =============================================================================

/**
 * Detect if function is a factory (returns a function)
 */
function detectFactoryPattern(func: FunctionInfo): boolean {
  // Check return type
  if (func.returnType) {
    const rt = func.returnType.toLowerCase();
    if (rt.includes('=>') || rt.includes('function') || rt.includes('callable')) {
      return true;
    }
    // React hook factory pattern
    if (rt.startsWith('use')) {
      return true;
    }
  }

  // Check name patterns
  const factoryPatterns = /^(create|make|build|get|with)[A-Z]/;
  if (factoryPatterns.test(func.name)) {
    return true;
  }

  // Check if name contains "factory"
  if (func.name.toLowerCase().includes('factory')) {
    return true;
  }

  return false;
}

/**
 * Detect if function is higher-order (takes function as parameter)
 */
function detectHigherOrderPattern(func: FunctionInfo): boolean {
  if (!func.parameters) return false;

  return func.parameters.some((p) => {
    const type = p.type?.toLowerCase() || '';
    const name = p.name.toLowerCase();

    // Type-based detection
    if (type.includes('=>') || type.includes('function') || type.includes('callable')) {
      return true;
    }

    // Name-based detection
    if (name.includes('callback') || name.includes('handler') || name === 'fn' || name === 'func') {
      return true;
    }

    return false;
  });
}

/**
 * Detect if function is a decorator pattern
 */
function detectDecoratorPattern(func: FunctionInfo): boolean {
  // Python decorator: takes function, returns function
  if (func.language === 'python') {
    if (func.parameters?.length === 1) {
      const param = func.parameters[0];
      if (param.name === 'func' || param.name === 'fn' || param.type?.includes('Callable')) {
        return true;
      }
    }
  }

  // TypeScript/JavaScript decorator
  if (func.language === 'typescript') {
    if (func.decorators && func.decorators.length > 0) {
      return true;
    }
  }

  // Check if function has decorator-like structure
  if (func.name.toLowerCase().includes('decorator') || func.name.toLowerCase().includes('wrapper')) {
    return true;
  }

  return false;
}

// =============================================================================
// Utility Functions
// =============================================================================

function isTestFile(filePath: string): boolean {
  const testPatterns = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /_test\.(py|go|java|cs|php)$/,
    /Test\.(java|cs)$/,
    /Tests?\//,
    /__tests__\//,
    /test_.*\.py$/,
  ];

  return testPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * Get wrappers by depth
 */
export function getWrappersByDepth(wrappers: WrapperFunction[]): Map<number, WrapperFunction[]> {
  const byDepth = new Map<number, WrapperFunction[]>();

  for (const wrapper of wrappers) {
    const existing = byDepth.get(wrapper.depth) || [];
    byDepth.set(wrapper.depth, [...existing, wrapper]);
  }

  return byDepth;
}

/**
 * Get wrappers that wrap a specific primitive
 */
export function getWrappersForPrimitive(
  wrappers: WrapperFunction[],
  primitiveName: string
): WrapperFunction[] {
  return wrappers.filter(
    (w) =>
      w.directPrimitives.includes(primitiveName) ||
      w.transitivePrimitives.includes(primitiveName)
  );
}

/**
 * Get the wrapper call chain (from wrapper to primitives)
 */
export function getWrapperCallChain(
  wrapper: WrapperFunction,
  allWrappers: WrapperFunction[]
): string[][] {
  const chains: string[][] = [];
  const wrapperMap = new Map(allWrappers.map((w) => [w.qualifiedName, w]));

  function buildChain(current: WrapperFunction, chain: string[]): void {
    const newChain = [...chain, current.name];

    if (current.directPrimitives.length > 0) {
      // Reached primitives
      for (const primitive of current.directPrimitives) {
        chains.push([...newChain, primitive]);
      }
    }

    // Continue through called wrappers
    for (const calledWrapper of current.callsWrappers) {
      const called = wrapperMap.get(calledWrapper);
      if (called && !chain.includes(called.name)) {
        buildChain(called, newChain);
      }
    }
  }

  buildChain(wrapper, []);
  return chains;
}

/**
 * Calculate wrapper statistics
 */
export function calculateWrapperStats(wrappers: WrapperFunction[]): {
  totalWrappers: number;
  avgDepth: number;
  maxDepth: number;
  factoryCount: number;
  higherOrderCount: number;
  decoratorCount: number;
  asyncCount: number;
} {
  if (wrappers.length === 0) {
    return {
      totalWrappers: 0,
      avgDepth: 0,
      maxDepth: 0,
      factoryCount: 0,
      higherOrderCount: 0,
      decoratorCount: 0,
      asyncCount: 0,
    };
  }

  const depths = wrappers.map((w) => w.depth);

  return {
    totalWrappers: wrappers.length,
    avgDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
    maxDepth: Math.max(...depths),
    factoryCount: wrappers.filter((w) => w.isFactory).length,
    higherOrderCount: wrappers.filter((w) => w.isHigherOrder).length,
    decoratorCount: wrappers.filter((w) => w.isDecorator).length,
    asyncCount: wrappers.filter((w) => w.isAsync).length,
  };
}
