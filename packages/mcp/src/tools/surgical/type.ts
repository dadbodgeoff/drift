/**
 * drift_type - Expand Type Definitions
 * 
 * Layer: Surgical
 * Token Budget: 400 target, 800 max
 * Cache TTL: 5 minutes
 * Invalidation Keys: callgraph, types
 * 
 * Expands type definitions to see full structure.
 * Solves: AI sees `user: User` but doesn't know User has 20 fields.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createResponseBuilder, Errors, metrics } from '../../infrastructure/index.js';

import type { CallGraphStore } from 'driftdetect-core';

// ============================================================================
// Types
// ============================================================================

export interface TypeArgs {
  /** Type name to expand */
  type: string;
  /** How deep to expand nested types (default: 2) */
  depth?: number;
  /** Specific file to look in (optional) */
  file?: string;
}

export interface TypeDefinition {
  name: string;
  kind: 'interface' | 'type' | 'class' | 'enum';
  source: string;
  shape: Record<string, string>;
  raw: string;
}

export interface RelatedType {
  name: string;
  relationship: 'extends' | 'contains' | 'parameter' | 'return';
  source: string;
}

export interface TypeData {
  found: boolean;
  definition?: TypeDefinition | undefined;
  relatedTypes: RelatedType[];
}

// ============================================================================
// Handler
// ============================================================================

export async function handleType(
  store: CallGraphStore,
  args: TypeArgs,
  projectRoot: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const startTime = Date.now();
  const builder = createResponseBuilder<TypeData>();
  
  // Validate input
  if (!args.type || args.type.trim() === '') {
    throw Errors.missingParameter('type');
  }
  
  const typeName = args.type.trim();
  // Reserved for future nested type expansion
  void (args.depth ?? 2);
  
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
  
  // Find type definition by searching:
  // 1. Function return types
  // 2. Function parameter types
  // 3. Class names
  
  let foundFile: string | undefined;
  let foundLine: number | undefined;
  const relatedTypes: RelatedType[] = [];
  
  // Search for the type in function signatures
  for (const [, func] of graph.functions) {
    // Check if file filter applies
    if (args.file && !func.file.includes(args.file)) {
      continue;
    }
    
    // Check return type
    if (func.returnType?.includes(typeName)) {
      relatedTypes.push({
        name: func.name,
        relationship: 'return',
        source: `${func.file}:${func.startLine}`,
      });
      
      // If this looks like a type definition file, note it
      if (func.file.includes('types') || func.file.includes('interfaces')) {
        foundFile = func.file;
        foundLine = func.startLine;
      }
    }
    
    // Check parameter types
    for (const param of func.parameters) {
      if (param.type?.includes(typeName)) {
        relatedTypes.push({
          name: func.name,
          relationship: 'parameter',
          source: `${func.file}:${func.startLine}`,
        });
      }
    }
    
    // Check class name
    if (func.className === typeName) {
      foundFile = func.file;
      foundLine = func.startLine;
      relatedTypes.push({
        name: func.name,
        relationship: 'contains',
        source: `${func.file}:${func.startLine}`,
      });
    }
  }
  
  // Try to find and parse the actual type definition
  let definition: TypeDefinition | undefined;
  
  if (foundFile) {
    definition = await extractTypeDefinition(
      path.join(projectRoot, foundFile),
      typeName,
      foundFile,
      foundLine ?? 1
    );
  } else {
    // Search common type file locations
    const typeFiles = [
      'src/types/index.ts',
      'src/types.ts',
      'types/index.ts',
      'src/interfaces/index.ts',
    ];
    
    for (const typeFile of typeFiles) {
      const fullPath = path.join(projectRoot, typeFile);
      try {
        await fs.access(fullPath);
        definition = await extractTypeDefinition(fullPath, typeName, typeFile, 1);
        if (definition) {
          foundFile = typeFile;
          break;
        }
      } catch {
        // File doesn't exist, continue
      }
    }
  }
  
  // Deduplicate related types
  const uniqueRelated = relatedTypes.reduce((acc, rt) => {
    const key = `${rt.name}:${rt.relationship}`;
    if (!acc.has(key)) {
      acc.set(key, rt);
    }
    return acc;
  }, new Map<string, RelatedType>());
  
  const data: TypeData = {
    found: definition !== undefined,
    definition,
    relatedTypes: Array.from(uniqueRelated.values()).slice(0, 10),
  };
  
  // Build summary
  let summary: string;
  if (definition) {
    const fieldCount = Object.keys(definition.shape).length;
    summary = `Found ${definition.kind} "${typeName}" with ${fieldCount} field${fieldCount !== 1 ? 's' : ''} in ${definition.source}`;
  } else if (relatedTypes.length > 0) {
    summary = `Type "${typeName}" referenced in ${relatedTypes.length} location${relatedTypes.length !== 1 ? 's' : ''} but definition not found`;
  } else {
    summary = `Type "${typeName}" not found in codebase`;
  }
  
  // Build hints
  const hints: { nextActions: string[]; relatedTools: string[]; warnings?: string[] } = {
    nextActions: definition
      ? [
          'Use these fields when constructing objects of this type',
          `Check relatedTypes for functions that use "${typeName}"`,
        ]
      : [
          'Check spelling or try a partial name',
          'Use drift_files_list to find type definition files',
        ],
    relatedTools: ['drift_signature', 'drift_imports', 'drift_similar'],
  };
  
  if (!definition && relatedTypes.length > 0) {
    hints.warnings = ['Type is used but definition not found - may be external or generated'];
  }
  
  // Record metrics
  metrics.recordRequest('drift_type', Date.now() - startTime, true, false);
  
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
 * Extract type definition from a file using regex
 * (Lightweight alternative to full parsing)
 */
async function extractTypeDefinition(
  filePath: string,
  typeName: string,
  relativePath: string,
  _hintLine: number
): Promise<TypeDefinition | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Patterns to match type definitions
    const patterns = [
      // interface Foo { ... }
      new RegExp(`^\\s*(?:export\\s+)?interface\\s+${typeName}\\s*(?:extends\\s+[^{]+)?\\{`, 'm'),
      // type Foo = { ... }
      new RegExp(`^\\s*(?:export\\s+)?type\\s+${typeName}\\s*=\\s*\\{`, 'm'),
      // class Foo { ... }
      new RegExp(`^\\s*(?:export\\s+)?class\\s+${typeName}\\s*(?:extends\\s+[^{]+)?(?:implements\\s+[^{]+)?\\{`, 'm'),
      // enum Foo { ... }
      new RegExp(`^\\s*(?:export\\s+)?enum\\s+${typeName}\\s*\\{`, 'm'),
    ];
    
    const kinds: Array<'interface' | 'type' | 'class' | 'enum'> = ['interface', 'type', 'class', 'enum'];
    
    for (let i = 0; i < patterns.length; i++) {
      const match = content.match(patterns[i]!);
      if (match?.index !== undefined) {
        const startIndex = match.index;
        const lineNumber = content.slice(0, startIndex).split('\n').length;
        
        // Extract the full definition (find matching braces)
        const raw = extractBracedBlock(content, startIndex);
        if (!raw) {continue;}
        
        // Parse fields from the raw definition
        const shape = parseTypeShape(raw, kinds[i]!);
        
        return {
          name: typeName,
          kind: kinds[i]!,
          source: `${relativePath}:${lineNumber}`,
          shape,
          raw: raw.length > 500 ? raw.slice(0, 500) + '\n  // ... truncated' : raw,
        };
      }
    }
    
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract a braced block starting from an index
 */
function extractBracedBlock(content: string, startIndex: number): string | undefined {
  const openBrace = content.indexOf('{', startIndex);
  if (openBrace === -1) {return undefined;}
  
  let depth = 0;
  let endIndex = openBrace;
  
  for (let i = openBrace; i < content.length; i++) {
    if (content[i] === '{') {depth++;}
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }
  
  // Include the declaration before the brace
  const declarationStart = content.lastIndexOf('\n', startIndex) + 1;
  return content.slice(declarationStart, endIndex).trim();
}

/**
 * Parse type shape from raw definition
 */
function parseTypeShape(raw: string, kind: string): Record<string, string> {
  const shape: Record<string, string> = {};
  
  // Extract content between braces
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) {return shape;}
  
  const body = raw.slice(braceStart + 1, braceEnd);
  
  // Simple field extraction (handles most common cases)
  // Matches: fieldName: Type; or fieldName?: Type;
  const fieldPattern = /^\s*(?:readonly\s+)?(\w+)(\?)?:\s*([^;,\n]+)/gm;
  
  let match;
  while ((match = fieldPattern.exec(body)) !== null) {
    const [, name, optional, type] = match;
    if (name && type) {
      const cleanType = type.trim().replace(/\/\/.*$/, '').trim();
      shape[name] = optional ? `${cleanType} | undefined` : cleanType;
    }
  }
  
  // For enums, extract values
  if (kind === 'enum') {
    const enumPattern = /^\s*(\w+)\s*(?:=\s*([^,\n]+))?/gm;
    while ((match = enumPattern.exec(body)) !== null) {
      const [, name, value] = match;
      if (name && !name.includes(':')) {
        shape[name] = value?.trim() ?? 'auto';
      }
    }
  }
  
  return shape;
}

/**
 * Tool definition for MCP registration
 */
export const typeToolDefinition = {
  name: 'drift_type',
  description: 'Expand type definitions to see full structure. Returns fields, related types, and raw definition. Use when you see a type but need to know its shape.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        description: 'Type name to expand (e.g., "User", "CreateUserDTO")',
      },
      depth: {
        type: 'number',
        description: 'How deep to expand nested types (default: 2, max: 5)',
      },
      file: {
        type: 'string',
        description: 'Optional: specific file to search in',
      },
    },
    required: ['type'],
  },
};
