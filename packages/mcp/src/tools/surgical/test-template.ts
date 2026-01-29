/**
 * drift_test_template - Generate Test Scaffolding
 * 
 * Layer: Surgical
 * Token Budget: 800 target, 1500 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: test-topology, file:{targetFile}
 * 
 * Generates test scaffolding based on existing test patterns.
 * Solves: Tests are the most convention-heavy code. Every codebase is different.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore, FunctionNode } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface TestTemplateArgs {
  /** File being tested */
  targetFile: string;
  /** Specific function to test (optional) */
  function?: string;
  /** Test type */
  type?: 'unit' | 'integration' | 'e2e';
}

export interface TestConventions {
  framework: string;
  style: string;
  mockStyle: string;
  assertionStyle: string;
  filePattern: string;
}

export interface ExampleTest {
  file: string;
  preview: string;
}

export interface TestTemplateData {
  testFile: string;
  template: string;
  conventions: TestConventions;
  exampleTest?: ExampleTest | undefined;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleTestTemplate(
  store: CallGraphStore,
  args: TestTemplateArgs,
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<TestTemplateData>();
  
  // Validate input
  if (!args.targetFile || args.targetFile.trim() === '') {
    throw Errors.missingParameter('targetFile');
  }
  
  const targetFile = args.targetFile.trim();
  const targetFunction = args.function?.trim();
  const testType = args.type ?? 'unit';
  
  // Load call graph
  await store.initialize();
  const graph = store.getGraph();
  
  if (!graph) {
    throw Errors.custom(
      'CALLGRAPH_NOT_BUILT',
      'Call graph has not been built. Run "drift callgraph build" first.',
      ['drift_status']
    );
  }
  
  // Find the target function if specified
  let targetFunc: FunctionNode | undefined;
  if (targetFunction) {
    for (const [, func] of graph.functions) {
      if (func.file.endsWith(targetFile) && func.name === targetFunction) {
        targetFunc = func;
        break;
      }
    }
  }
  
  // Detect test conventions from existing tests
  const detectedConventions = await detectTestConventions(projectRoot, targetFile);
  
  // Find example test in same directory
  const exampleTest = await findExampleTest(projectRoot, targetFile, detectedConventions);
  
  // Generate test file path
  const testFile = generateTestFilePath(targetFile, detectedConventions);
  
  // Generate template
  const template = generateTestTemplate(
    targetFile,
    targetFunc,
    detectedConventions,
    testType
  );
  
  const data: TestTemplateData = {
    testFile,
    template,
    conventions: detectedConventions,
    exampleTest,
  };
  
  // Build summary
  const funcName = targetFunc?.name ?? path.basename(targetFile, path.extname(targetFile));
  const summary = `Generated ${testType} test template for "${funcName}" using ${detectedConventions.framework}/${detectedConventions.style}`;
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: [
      `Create ${testFile} with the template`,
      'Fill in test cases based on function behavior',
      exampleTest ? `Reference ${exampleTest.file} for patterns` : 'Add assertions matching codebase style',
    ],
    relatedTools: ['drift_signature', 'drift_callers', 'drift_similar'],
  };
  
  if (!exampleTest) {
    hints.warnings = ['No existing tests found in directory - conventions inferred from project'];
  }
  
  // Record metrics
  metrics.recordRequest('drift_test_template', Date.now() - startTime, true, false);
  
  return builder
    .withSummary(summary)
    .withData(data)
    .withHints(hints)
    .buildContent();
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect test conventions from existing tests
 */
async function detectTestConventions(
  projectRoot: string,
  targetFile: string
): Promise<TestConventions> {
  const conventions: TestConventions = {
    framework: 'vitest',
    style: 'describe/it',
    mockStyle: 'vi.mock',
    assertionStyle: 'expect',
    filePattern: '*.test.ts',
  };
  
  // Check package.json for test framework
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (deps['vitest']) {
      conventions.framework = 'vitest';
      conventions.mockStyle = 'vi.mock';
    } else if (deps['jest']) {
      conventions.framework = 'jest';
      conventions.mockStyle = 'jest.mock';
    } else if (deps['mocha']) {
      conventions.framework = 'mocha';
      conventions.mockStyle = 'sinon';
      conventions.assertionStyle = 'chai';
    }
  } catch {
    // Use defaults
  }
  
  // Check for test file patterns in the target directory
  const targetDir = path.dirname(targetFile);
  const fullTargetDir = path.join(projectRoot, targetDir);
  
  try {
    const files = await fs.readdir(fullTargetDir);
    
    // Check for __tests__ directory
    if (files.includes('__tests__')) {
      conventions.filePattern = '__tests__/*.test.ts';
    }
    
    // Check for .spec.ts files
    if (files.some(f => f.endsWith('.spec.ts'))) {
      conventions.filePattern = '*.spec.ts';
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  
  return conventions;
}

/**
 * Find an example test in the same directory
 */
async function findExampleTest(
  projectRoot: string,
  targetFile: string,
  _conventions: TestConventions
): Promise<ExampleTest | undefined> {
  const targetDir = path.dirname(targetFile);
  
  // Possible test locations
  const testDirs = [
    path.join(projectRoot, targetDir, '__tests__'),
    path.join(projectRoot, targetDir),
    path.join(projectRoot, targetDir.replace('/src/', '/test/')),
  ];
  
  for (const testDir of testDirs) {
    try {
      const files = await fs.readdir(testDir);
      const testFiles = files.filter(f => 
        f.endsWith('.test.ts') || 
        f.endsWith('.spec.ts') ||
        f.endsWith('.test.js') ||
        f.endsWith('.spec.js')
      );
      
      if (testFiles.length > 0) {
        const testFile = testFiles[0]!;
        const fullPath = path.join(testDir, testFile);
        const content = await fs.readFile(fullPath, 'utf-8');
        
        // Get first 20 lines as preview
        const preview = content.split('\n').slice(0, 20).join('\n');
        
        return {
          file: path.relative(projectRoot, fullPath),
          preview,
        };
      }
    } catch {
      // Directory doesn't exist
    }
  }
  
  return undefined;
}

/**
 * Generate test file path based on conventions
 */
function generateTestFilePath(targetFile: string, conventions: TestConventions): string {
  const dir = path.dirname(targetFile);
  const base = path.basename(targetFile, path.extname(targetFile));
  const ext = path.extname(targetFile);
  
  if (conventions.filePattern.includes('__tests__')) {
    return path.join(dir, '__tests__', `${base}.test${ext}`);
  }
  
  if (conventions.filePattern.includes('.spec.')) {
    return path.join(dir, `${base}.spec${ext}`);
  }
  
  return path.join(dir, `${base}.test${ext}`);
}

/**
 * Generate test template
 */
function generateTestTemplate(
  targetFile: string,
  targetFunc: FunctionNode | undefined,
  conventions: TestConventions,
  _testType: string
): string {
  const moduleName = path.basename(targetFile, path.extname(targetFile));
  const funcName = targetFunc?.name ?? moduleName;
  
  // Import statement based on framework
  let imports: string;
  if (conventions.framework === 'vitest') {
    imports = `import { describe, it, expect, beforeEach, vi } from 'vitest';`;
  } else if (conventions.framework === 'jest') {
    imports = `// Jest globals are available automatically`;
  } else {
    imports = `import { describe, it } from 'mocha';\nimport { expect } from 'chai';`;
  }
  
  // Import the module under test
  const relativePath = './' + moduleName;
  const moduleImport = targetFunc
    ? `import { ${funcName} } from '${relativePath}';`
    : `import * as ${moduleName} from '${relativePath}';`;
  
  // Mock setup based on framework
  let mockSetup = '';
  if (conventions.framework === 'vitest') {
    mockSetup = `
beforeEach(() => {
  vi.clearAllMocks();
});`;
  } else if (conventions.framework === 'jest') {
    mockSetup = `
beforeEach(() => {
  jest.clearAllMocks();
});`;
  }
  
  // Generate test cases
  let testCases: string;
  if (targetFunc) {
    const params = targetFunc.parameters.map(p => p.name).join(', ');
    const hasParams = targetFunc.parameters.length > 0;
    
    testCases = `
  it('should ${funcName} successfully', async () => {
    // Arrange
    ${hasParams ? `const ${targetFunc.parameters[0]?.name ?? 'input'} = {}; // TODO: Add test data` : '// No input needed'}
    
    // Act
    const result = await ${funcName}(${params});
    
    // Assert
    expect(result).toBeDefined();
    // TODO: Add specific assertions
  });

  it('should handle errors gracefully', async () => {
    // Arrange
    // TODO: Set up error condition
    
    // Act & Assert
    // TODO: Add error handling test
  });`;
  } else {
    testCases = `
  it('should work correctly', () => {
    // Arrange
    // TODO: Set up test data
    
    // Act
    // TODO: Call function under test
    
    // Assert
    // TODO: Add assertions
  });`;
  }
  
  // Combine template
  return `${imports}
${moduleImport}

describe('${funcName}', () => {${mockSetup}
${testCases}
});
`;
}

/**
 * Tool definition for MCP registration
 */
export const testTemplateToolDefinition = {
  name: 'drift_test_template',
  description: 'Generate test scaffolding based on existing test patterns. Returns ready-to-use template matching codebase conventions (framework, mocking style, file location).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      targetFile: {
        type: 'string',
        description: 'File being tested (relative path)',
      },
      function: {
        type: 'string',
        description: 'Optional: specific function to test',
      },
      type: {
        type: 'string',
        enum: ['unit', 'integration', 'e2e'],
        description: 'Test type (default: unit)',
      },
    },
    required: ['targetFile'],
  },
};
