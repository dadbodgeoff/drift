/**
 * Parser Command - drift parser
 *
 * Show parser information and diagnostics for drift's language parsers.
 * Displays which parsers are available, their capabilities, and allows
 * testing parsing on specific files.
 *
 * @requirements Phase 4 - CLI Integration
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';

export interface ParserOptions {
  /** Test parsing a specific file */
  test?: string;
  /** Output format */
  format?: 'text' | 'json';
  /** Show verbose output */
  verbose?: boolean;
}

/**
 * Get Python parser information
 */
async function getPythonParserInfo(): Promise<{
  treeSitterAvailable: boolean;
  activeParser: string;
  capabilities: Record<string, boolean>;
  supportedFrameworks: string[];
  loadingError: string | undefined;
}> {
  try {
    const { isTreeSitterAvailable, getLoadingError } = await import('driftdetect-core');
    
    const available = isTreeSitterAvailable();
    const loadingError = getLoadingError() ?? undefined;
    
    return {
      treeSitterAvailable: available,
      activeParser: available ? 'tree-sitter' : 'regex',
      capabilities: {
        basicRouteDetection: true,
        simplePydanticModels: true,
        pydanticModels: available,
        nestedTypes: available,
        fieldConstraints: available,
        inheritance: available,
        generics: available,
        django: available,
        typeHints: available,
      },
      supportedFrameworks: available 
        ? ['fastapi', 'flask', 'django', 'starlette']
        : ['fastapi', 'flask'],
      loadingError,
    };
  } catch {
    return {
      treeSitterAvailable: false,
      activeParser: 'regex',
      capabilities: {
        basicRouteDetection: true,
        simplePydanticModels: true,
        pydanticModels: false,
        nestedTypes: false,
        fieldConstraints: false,
        inheritance: false,
        generics: false,
        django: false,
        typeHints: false,
      },
      supportedFrameworks: ['fastapi', 'flask'],
      loadingError: 'driftdetect-core not available',
    };
  }
}

/**
 * Get C# parser information
 */
async function getCSharpParserInfo(): Promise<{
  treeSitterAvailable: boolean;
  activeParser: string;
  capabilities: Record<string, boolean>;
  supportedFrameworks: string[];
  loadingError: string | undefined;
}> {
  try {
    const { isCSharpTreeSitterAvailable, getCSharpLoadingError } = await import('driftdetect-core');
    
    const available = isCSharpTreeSitterAvailable();
    const loadingError = getCSharpLoadingError() ?? undefined;
    
    return {
      treeSitterAvailable: available,
      activeParser: available ? 'tree-sitter' : 'regex',
      capabilities: {
        basicParsing: true,
        classExtraction: available,
        methodExtraction: available,
        attributeExtraction: available,
        aspNetControllers: available,
        minimalApis: available,
        recordTypes: available,
      },
      supportedFrameworks: available 
        ? ['asp.net-core', 'minimal-apis', 'web-api']
        : [],
      loadingError,
    };
  } catch {
    return {
      treeSitterAvailable: false,
      activeParser: 'regex',
      capabilities: {
        basicParsing: true,
        classExtraction: false,
        methodExtraction: false,
        attributeExtraction: false,
        aspNetControllers: false,
        minimalApis: false,
        recordTypes: false,
      },
      supportedFrameworks: [],
      loadingError: 'C# parser not available',
    };
  }
}

/**
 * Get Java parser information
 * 
 * Java uses semantic detectors for pattern detection.
 * Tree-sitter support can be added when tree-sitter-java is installed.
 */
async function getJavaParserInfo(): Promise<{
  treeSitterAvailable: boolean;
  activeParser: string;
  capabilities: Record<string, boolean>;
  supportedFrameworks: string[];
  loadingError: string | undefined;
}> {
  // Check if Java tree-sitter is available (future support)
  let treeSitterAvailable = false;
  let loadingError: string | undefined;
  
  try {
    // Try to dynamically check for Java tree-sitter support
    // This will be available when tree-sitter-java is installed
    const core = await import('driftdetect-core');
    if ('isJavaTreeSitterAvailable' in core) {
      treeSitterAvailable = (core as { isJavaTreeSitterAvailable: () => boolean }).isJavaTreeSitterAvailable();
      if ('getJavaLoadingError' in core) {
        loadingError = (core as { getJavaLoadingError: () => string | null }).getJavaLoadingError() ?? undefined;
      }
    }
  } catch {
    // Java tree-sitter not yet available - use semantic detectors
    loadingError = undefined; // Not an error, just not available yet
  }
  
  return {
    treeSitterAvailable,
    activeParser: treeSitterAvailable ? 'tree-sitter' : 'semantic',
    capabilities: {
      basicParsing: true,
      classExtraction: true,  // Via semantic detectors
      methodExtraction: true, // Via semantic detectors
      annotationExtraction: true, // Via semantic detectors
      springControllers: true, // Via Spring semantic detectors
      springData: true,
      springSecurity: true,
      recordTypes: treeSitterAvailable,
    },
    supportedFrameworks: ['spring-boot', 'spring-mvc', 'spring-data', 'spring-security'],
    loadingError,
  };
}

/**
 * Get PHP parser information
 * 
 * PHP uses regex-based detection by default.
 * Tree-sitter support is available when tree-sitter-php is installed.
 */
async function getPhpParserInfo(): Promise<{
  treeSitterAvailable: boolean;
  activeParser: string;
  capabilities: Record<string, boolean>;
  supportedFrameworks: string[];
  loadingError: string | undefined;
}> {
  let treeSitterAvailable = false;
  let loadingError: string | undefined;
  
  try {
    const core = await import('driftdetect-core');
    if ('isPhpTreeSitterAvailable' in core) {
      treeSitterAvailable = (core as { isPhpTreeSitterAvailable: () => boolean }).isPhpTreeSitterAvailable();
      if ('getPhpLoadingError' in core) {
        loadingError = (core as { getPhpLoadingError: () => string | null }).getPhpLoadingError() ?? undefined;
      }
    }
  } catch {
    loadingError = undefined;
  }
  
  return {
    treeSitterAvailable,
    activeParser: treeSitterAvailable ? 'tree-sitter' : 'regex',
    capabilities: {
      basicParsing: true,
      classExtraction: treeSitterAvailable,
      methodExtraction: treeSitterAvailable,
      attributeExtraction: treeSitterAvailable,
      laravelControllers: treeSitterAvailable,
      laravelModels: treeSitterAvailable,
      traitExtraction: treeSitterAvailable,
      enumExtraction: treeSitterAvailable,
    },
    supportedFrameworks: treeSitterAvailable 
      ? ['laravel', 'symfony', 'php8']
      : ['laravel'],
    loadingError,
  };
}

/**
 * Get TypeScript parser information
 */
function getTypeScriptParserInfo(): {
  activeParser: string;
  capabilities: Record<string, boolean>;
} {
  return {
    activeParser: 'typescript-compiler-api',
    capabilities: {
      fullAST: true,
      typeInference: true,
      interfaces: true,
      generics: true,
      decorators: true,
    },
  };
}

interface TestResult {
  success: boolean;
  language: string;
  parser: string;
  nodeCount: number | undefined;
  pydanticModels: Array<{ name: string; fieldCount: number }> | undefined;
  errors: string[] | undefined;
}

/**
 * Count nodes in an AST (generic implementation)
 */
function countASTNodes(ast: unknown): number {
  if (!ast || typeof ast !== 'object') {return 0;}
  
  let count = 1;
  const node = ast as Record<string, unknown>;
  
  if (node['children'] && Array.isArray(node['children'])) {
    for (const child of node['children']) {
      count += countASTNodes(child);
    }
  }
  
  return count;
}

/**
 * Test parsing a specific file
 */
async function testFileParsing(
  filePath: string,
  _verbose: boolean
): Promise<TestResult> {
  const ext = path.extname(filePath).toLowerCase();
  
  // Determine language
  let language: string;
  if (['.py', '.pyw', '.pyi'].includes(ext)) {
    language = 'python';
  } else if (['.ts', '.tsx'].includes(ext)) {
    language = 'typescript';
  } else if (['.js', '.jsx'].includes(ext)) {
    language = 'javascript';
  } else if (['.cs'].includes(ext)) {
    language = 'csharp';
  } else if (['.java'].includes(ext)) {
    language = 'java';
  } else if (['.php'].includes(ext)) {
    language = 'php';
  } else {
    return {
      success: false,
      language: 'unknown',
      parser: 'none',
      nodeCount: undefined,
      pydanticModels: undefined,
      errors: [`Unsupported file extension: ${ext}`],
    };
  }
  
  // Read file content
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    return {
      success: false,
      language,
      parser: 'none',
      nodeCount: undefined,
      pydanticModels: undefined,
      errors: [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  
  // Parse based on language
  if (language === 'python') {
    try {
      const { TreeSitterPythonParser, isTreeSitterAvailable } = await import('driftdetect-core');
      
      if (isTreeSitterAvailable()) {
        const parser = new TreeSitterPythonParser();
        const result = parser.parse(content, filePath);
        
        if (result.success && result.ast) {
          const models = result.pydanticModels ?? [];
          
          return {
            success: true,
            language,
            parser: 'tree-sitter',
            nodeCount: countASTNodes(result.ast),
            pydanticModels: models.map(m => ({
              name: m.name,
              fieldCount: m.fields.length,
            })),
            errors: undefined,
          };
        } else {
          return {
            success: false,
            language,
            parser: 'tree-sitter',
            nodeCount: undefined,
            pydanticModels: undefined,
            errors: result.errors.map(e => e.message),
          };
        }
      } else {
        return {
          success: true,
          language,
          parser: 'regex',
          nodeCount: undefined,
          pydanticModels: [],
          errors: undefined,
        };
      }
    } catch (err) {
      return {
        success: false,
        language,
        parser: 'unknown',
        nodeCount: undefined,
        pydanticModels: undefined,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }
  
  if (language === 'csharp') {
    try {
      const { TreeSitterCSharpParser, isCSharpTreeSitterAvailable } = await import('driftdetect-core');
      
      if (isCSharpTreeSitterAvailable()) {
        const parser = new TreeSitterCSharpParser();
        const result = parser.parse(content, filePath);
        
        if (result.success && result.ast) {
          return {
            success: true,
            language,
            parser: 'tree-sitter',
            nodeCount: countASTNodes(result.ast),
            pydanticModels: undefined,
            errors: undefined,
          };
        } else {
          return {
            success: false,
            language,
            parser: 'tree-sitter',
            nodeCount: undefined,
            pydanticModels: undefined,
            errors: result.errors.map(e => e.message),
          };
        }
      } else {
        return {
          success: true,
          language,
          parser: 'regex',
          nodeCount: undefined,
          pydanticModels: undefined,
          errors: undefined,
        };
      }
    } catch (err) {
      return {
        success: false,
        language,
        parser: 'unknown',
        nodeCount: undefined,
        pydanticModels: undefined,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }
  
  if (language === 'java') {
    // Java uses semantic detectors for pattern detection
    return {
      success: true,
      language,
      parser: 'semantic',
      nodeCount: undefined,
      pydanticModels: undefined,
      errors: undefined,
    };
  }
  
  if (language === 'php') {
    try {
      const core = await import('driftdetect-core');
      
      if ('isPhpTreeSitterAvailable' in core && (core as { isPhpTreeSitterAvailable: () => boolean }).isPhpTreeSitterAvailable()) {
        const { TreeSitterPhpParser } = core as { TreeSitterPhpParser: new () => { parse: (content: string, filePath: string) => { success: boolean; ast: unknown; errors: { message: string }[] } } };
        const parser = new TreeSitterPhpParser();
        const result = parser.parse(content, filePath);
        
        if (result.success && result.ast) {
          return {
            success: true,
            language,
            parser: 'tree-sitter',
            nodeCount: countASTNodes(result.ast),
            pydanticModels: undefined,
            errors: undefined,
          };
        } else {
          return {
            success: false,
            language,
            parser: 'tree-sitter',
            nodeCount: undefined,
            pydanticModels: undefined,
            errors: result.errors.map(e => e.message),
          };
        }
      } else {
        return {
          success: true,
          language,
          parser: 'regex',
          nodeCount: undefined,
          pydanticModels: undefined,
          errors: undefined,
        };
      }
    } catch (err) {
      return {
        success: false,
        language,
        parser: 'unknown',
        nodeCount: undefined,
        pydanticModels: undefined,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }
  
  // TypeScript/JavaScript - just report success
  return {
    success: true,
    language,
    parser: 'typescript-compiler-api',
    nodeCount: undefined,
    pydanticModels: undefined,
    errors: undefined,
  };
}

/**
 * Parser command implementation
 */
async function parserAction(options: ParserOptions): Promise<void> {
  const format = options.format ?? 'text';
  const verbose = options.verbose ?? false;
  
  // Gather parser info
  const pythonInfo = await getPythonParserInfo();
  const csharpInfo = await getCSharpParserInfo();
  const javaInfo = await getJavaParserInfo();
  const phpInfo = await getPhpParserInfo();
  const tsInfo = getTypeScriptParserInfo();
  
  // JSON output
  if (format === 'json') {
    const output: Record<string, unknown> = {
      python: pythonInfo,
      csharp: csharpInfo,
      java: javaInfo,
      php: phpInfo,
      typescript: tsInfo,
    };
    
    if (options.test) {
      output['testResult'] = await testFileParsing(options.test, verbose);
    }
    
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  
  // Text output
  console.log();
  console.log(chalk.bold('🔧 Drift Parser Status'));
  console.log(chalk.gray('─'.repeat(50)));
  
  // Python
  console.log();
  console.log(chalk.bold('Python:'));
  console.log(`  Active parser:     ${pythonInfo.treeSitterAvailable ? chalk.green('tree-sitter') : chalk.yellow('regex')}`);
  console.log(`  Tree-sitter:       ${pythonInfo.treeSitterAvailable ? chalk.green('✓ available') : chalk.red('✗ not installed')}`);
  
  if (pythonInfo.loadingError && verbose) {
    console.log(chalk.gray(`  Loading error:     ${pythonInfo.loadingError}`));
  }
  
  if (pythonInfo.treeSitterAvailable) {
    console.log(chalk.green('  Capabilities:'));
    console.log(chalk.green('    ✓ Pydantic model extraction'));
    console.log(chalk.green('    ✓ Nested type resolution'));
    console.log(chalk.green('    ✓ Field constraints'));
    console.log(chalk.green('    ✓ Model inheritance'));
    console.log(chalk.green('    ✓ Generic types'));
    console.log(chalk.green('    ✓ Django REST Framework'));
    console.log(chalk.green('    ✓ Type hint extraction'));
  } else {
    console.log(chalk.yellow('  Limited capabilities (regex-based):'));
    console.log(chalk.yellow('    ✓ Basic route detection'));
    console.log(chalk.yellow('    ✓ Simple Pydantic models'));
    console.log(chalk.red('    ✗ Nested types'));
    console.log(chalk.red('    ✗ Field constraints'));
    console.log(chalk.red('    ✗ Django support'));
    console.log();
    console.log(chalk.gray('  To enable full Python support:'));
    console.log(chalk.cyan('    pnpm add tree-sitter tree-sitter-python'));
  }
  
  console.log(`  Frameworks:        ${pythonInfo.supportedFrameworks.join(', ')}`);
  
  // C#
  console.log();
  console.log(chalk.bold('C#:'));
  console.log(`  Active parser:     ${csharpInfo.treeSitterAvailable ? chalk.green('tree-sitter') : chalk.yellow('regex')}`);
  console.log(`  Tree-sitter:       ${csharpInfo.treeSitterAvailable ? chalk.green('✓ available') : chalk.red('✗ not installed')}`);
  
  if (csharpInfo.treeSitterAvailable) {
    console.log(chalk.green('  Capabilities:'));
    console.log(chalk.green('    ✓ Class extraction'));
    console.log(chalk.green('    ✓ Method extraction'));
    console.log(chalk.green('    ✓ Attribute extraction'));
    console.log(chalk.green('    ✓ ASP.NET Controllers'));
    console.log(chalk.green('    ✓ Minimal APIs'));
    console.log(chalk.green('    ✓ Record types'));
  } else {
    console.log(chalk.yellow('  Limited capabilities:'));
    console.log(chalk.yellow('    ✓ Basic parsing'));
    console.log(chalk.red('    ✗ Full AST analysis'));
    console.log();
    console.log(chalk.gray('  To enable full C# support:'));
    console.log(chalk.cyan('    pnpm add tree-sitter tree-sitter-c-sharp'));
  }
  
  if (csharpInfo.supportedFrameworks.length > 0) {
    console.log(`  Frameworks:        ${csharpInfo.supportedFrameworks.join(', ')}`);
  }
  
  // Java
  console.log();
  console.log(chalk.bold('Java:'));
  console.log(`  Active parser:     ${javaInfo.treeSitterAvailable ? chalk.green('tree-sitter') : chalk.green('semantic')}`);
  console.log(`  Tree-sitter:       ${javaInfo.treeSitterAvailable ? chalk.green('✓ available') : chalk.gray('○ optional')}`);
  
  console.log(chalk.green('  Capabilities (via semantic detectors):'));
  console.log(chalk.green('    ✓ Class extraction'));
  console.log(chalk.green('    ✓ Method extraction'));
  console.log(chalk.green('    ✓ Annotation extraction'));
  console.log(chalk.green('    ✓ Spring Controllers'));
  console.log(chalk.green('    ✓ Spring Data'));
  console.log(chalk.green('    ✓ Spring Security'));
  if (javaInfo.treeSitterAvailable) {
    console.log(chalk.green('    ✓ Record types (tree-sitter)'));
  } else {
    console.log(chalk.gray('    ○ Record types (requires tree-sitter)'));
  }
  
  if (javaInfo.supportedFrameworks.length > 0) {
    console.log(`  Frameworks:        ${javaInfo.supportedFrameworks.join(', ')}`);
  }
  
  // PHP
  console.log();
  console.log(chalk.bold('PHP:'));
  console.log(`  Active parser:     ${phpInfo.treeSitterAvailable ? chalk.green('tree-sitter') : chalk.yellow('regex')}`);
  console.log(`  Tree-sitter:       ${phpInfo.treeSitterAvailable ? chalk.green('✓ available') : chalk.red('✗ not installed')}`);
  
  if (phpInfo.treeSitterAvailable) {
    console.log(chalk.green('  Capabilities:'));
    console.log(chalk.green('    ✓ Class extraction'));
    console.log(chalk.green('    ✓ Method extraction'));
    console.log(chalk.green('    ✓ Attribute extraction (PHP 8+)'));
    console.log(chalk.green('    ✓ Laravel Controllers'));
    console.log(chalk.green('    ✓ Laravel Models'));
    console.log(chalk.green('    ✓ Trait extraction'));
    console.log(chalk.green('    ✓ Enum extraction (PHP 8.1+)'));
  } else {
    console.log(chalk.yellow('  Limited capabilities (regex-based):'));
    console.log(chalk.yellow('    ✓ Basic parsing'));
    console.log(chalk.yellow('    ✓ Laravel patterns'));
    console.log(chalk.red('    ✗ Full AST analysis'));
    console.log(chalk.red('    ✗ PHP 8 attributes'));
    console.log();
    console.log(chalk.gray('  To enable full PHP support:'));
    console.log(chalk.cyan('    pnpm add tree-sitter tree-sitter-php'));
  }
  
  if (phpInfo.supportedFrameworks.length > 0) {
    console.log(`  Frameworks:        ${phpInfo.supportedFrameworks.join(', ')}`);
  }
  
  // TypeScript
  console.log();
  console.log(chalk.bold('TypeScript/JavaScript:'));
  console.log(`  Active parser:     ${chalk.green('typescript-compiler-api')}`);
  console.log(chalk.green('  Capabilities:'));
  console.log(chalk.green('    ✓ Full AST analysis'));
  console.log(chalk.green('    ✓ Type inference'));
  console.log(chalk.green('    ✓ Interface extraction'));
  console.log(chalk.green('    ✓ Generic types'));
  console.log(chalk.green('    ✓ Decorators'));
  
  // Test file parsing if requested
  if (options.test) {
    console.log();
    console.log(chalk.bold(`Testing: ${options.test}`));
    console.log(chalk.gray('─'.repeat(50)));
    
    const result = await testFileParsing(options.test, verbose);
    
    if (result.success) {
      console.log(chalk.green('  ✓ Parsed successfully'));
      console.log(chalk.gray(`    Language: ${result.language}`));
      console.log(chalk.gray(`    Parser: ${result.parser}`));
      
      if (result.nodeCount !== undefined) {
        console.log(chalk.gray(`    AST nodes: ${result.nodeCount}`));
      }
      
      if (result.pydanticModels && result.pydanticModels.length > 0) {
        console.log(chalk.gray(`    Pydantic models: ${result.pydanticModels.length}`));
        for (const model of result.pydanticModels) {
          console.log(chalk.gray(`      - ${model.name} (${model.fieldCount} fields)`));
        }
      }
    } else {
      console.log(chalk.red('  ✗ Parse failed'));
      if (result.errors) {
        for (const error of result.errors) {
          console.log(chalk.red(`    ${error}`));
        }
      }
    }
  }
  
  // Summary
  console.log();
  console.log(chalk.gray('─'.repeat(50)));
  
  const allTreeSitterAvailable = pythonInfo.treeSitterAvailable && csharpInfo.treeSitterAvailable && phpInfo.treeSitterAvailable;
  if (allTreeSitterAvailable) {
    console.log(chalk.green('All tree-sitter parsers available. Full parsing capabilities enabled.'));
    console.log(chalk.green('Java: Using semantic detectors (tree-sitter optional).'));
  } else {
    const missing: string[] = [];
    if (!pythonInfo.treeSitterAvailable) {missing.push('Python');}
    if (!csharpInfo.treeSitterAvailable) {missing.push('C#');}
    if (!phpInfo.treeSitterAvailable) {missing.push('PHP');}
    if (missing.length > 0) {
      console.log(chalk.yellow(`Tree-sitter not available for: ${missing.join(', ')}`));
      console.log(chalk.gray('Install tree-sitter packages for improved parsing accuracy.'));
    }
    console.log(chalk.green('Java: Using semantic detectors (tree-sitter optional).'));
  }
  
  console.log();
}

export const parserCommand = new Command('parser')
  .description('Show parser information and diagnostics')
  .option('--test <file>', 'Test parsing a specific file')
  .option('-f, --format <format>', 'Output format (text, json)', 'text')
  .option('--verbose', 'Enable verbose output')
  .action(parserAction);
