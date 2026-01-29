/**
 * Field Extractors Index
 * 
 * Exports all field extractors and provides a factory function
 * to get the appropriate extractor(s) for a given file.
 */

// Types
export * from './types.js';

// Extractors
export { SupabaseFieldExtractor, createSupabaseExtractor } from './supabase-extractor.js';
export { PrismaFieldExtractor, createPrismaExtractor } from './prisma-extractor.js';
export { DjangoFieldExtractor, createDjangoExtractor } from './django-extractor.js';
export { SQLAlchemyFieldExtractor, createSQLAlchemyExtractor } from './sqlalchemy-extractor.js';
export { RawSQLFieldExtractor, createRawSQLExtractor } from './raw-sql-extractor.js';
export { GORMFieldExtractor, createGORMExtractor } from './gorm-extractor.js';
export { DieselFieldExtractor, createDieselExtractor } from './diesel-extractor.js';

import { createDieselExtractor } from './diesel-extractor.js';
import { createDjangoExtractor } from './django-extractor.js';
import { createGORMExtractor } from './gorm-extractor.js';
import { createPrismaExtractor } from './prisma-extractor.js';
import { createRawSQLExtractor } from './raw-sql-extractor.js';
import { createSQLAlchemyExtractor } from './sqlalchemy-extractor.js';
import { createSupabaseExtractor } from './supabase-extractor.js';

import type { FieldExtractor, ExtractedField, LineExtractionResult } from './types.js';
import type { ORMFramework } from '../types.js';

/**
 * All available field extractors
 */
const ALL_EXTRACTORS: FieldExtractor[] = [
  // TypeScript/JavaScript
  createSupabaseExtractor(),
  createPrismaExtractor(),
  // Python
  createDjangoExtractor(),
  createSQLAlchemyExtractor(),
  // Go
  createGORMExtractor(),
  // Rust
  createDieselExtractor(),
  // Generic (fallback)
  createRawSQLExtractor(),
];

/**
 * Get all extractors that match the given content and language
 */
export function getMatchingExtractors(content: string, language: string): FieldExtractor[] {
  return ALL_EXTRACTORS.filter(e => e.matches(content, language));
}

/**
 * Get all available extractors
 */
export function getAllExtractors(): FieldExtractor[] {
  return [...ALL_EXTRACTORS];
}


/**
 * Extract fields from a line using all matching extractors
 */
export function extractFieldsFromLine(
  line: string,
  context: string[],
  lineNumber: number,
  content: string,
  language: string
): LineExtractionResult {
  const extractors = getMatchingExtractors(content, language);
  
  if (extractors.length === 0) {
    return { fields: [] };
  }
  
  // Collect fields from all matching extractors
  const allFields: ExtractedField[] = [];
  let table: string | undefined;
  let framework: string | undefined;
  
  for (const extractor of extractors) {
    const result = extractor.extractFromLine(line, context, lineNumber);
    
    if (result.fields.length > 0) {
      allFields.push(...result.fields);
      
      // Use the first table/framework found
      if (!table && result.table) {
        table = result.table;
      }
      if (!framework && result.framework) {
        framework = result.framework;
      }
    }
  }
  
  // Deduplicate fields by name, keeping highest confidence
  const uniqueFields = deduplicateFields(allFields);
  
  // Build result without undefined values
  const result: LineExtractionResult = { fields: uniqueFields };
  if (table) {
    result.table = table;
  }
  if (framework) {
    result.framework = framework as ORMFramework;
  }
  return result;
}

/**
 * Extract model definitions from content using all matching extractors
 */
export function extractModelsFromContent(
  content: string,
  language: string
): import('./types.js').ModelExtractionResult[] {
  const extractors = getMatchingExtractors(content, language);
  const allModels: import('./types.js').ModelExtractionResult[] = [];
  
  for (const extractor of extractors) {
    const models = extractor.extractFromModels(content);
    allModels.push(...models);
  }
  
  return allModels;
}

/**
 * Deduplicate fields by name, keeping highest confidence
 */
function deduplicateFields(fields: ExtractedField[]): ExtractedField[] {
  const seen = new Map<string, ExtractedField>();
  
  for (const field of fields) {
    const existing = seen.get(field.name);
    if (!existing || field.confidence > existing.confidence) {
      seen.set(field.name, field);
    }
  }
  
  return Array.from(seen.values());
}
