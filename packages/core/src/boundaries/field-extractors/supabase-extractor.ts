/**
 * Supabase Field Extractor
 * 
 * Extracts fields from Supabase query patterns:
 * - .select('field1, field2')
 * - .eq('field', value)
 * - .neq('field', value)
 * - .in('field', [values])
 * - .insert({ field: value })
 * - .update({ field: value })
 * - .order('field')
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class SupabaseFieldExtractor extends BaseFieldExtractor {
  readonly name = 'supabase';
  readonly framework: ORMFramework = 'supabase';
  readonly languages = ['typescript', 'javascript'];
  
  matches(content: string, language: string): boolean {
    if (!this.languages.includes(language)) {return false;}
    return (
      content.includes('supabase') ||
      content.includes('@supabase/supabase-js') ||
      /\.from\s*\(\s*["'`]/.test(content)
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from .from('table_name')
    const fromMatch = line.match(/\.from\s*\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/);
    if (fromMatch?.[1]) {
      table = fromMatch[1];
    }
    
    // Extract fields from .select('field1, field2, field3')
    const selectMatch = line.match(/\.select\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (selectMatch?.[1]) {
      const fieldNames = this.parseFieldList(selectMatch[1]);
      for (const name of fieldNames) {
        // Handle nested selects like 'id, profiles(name, avatar)'
        if (name.includes('(')) {
          const [fieldName] = name.split('(');
          if (fieldName) {
            fields.push(this.createField(fieldName.trim(), 'query', 0.95, {
              line: lineNumber,
              isRelation: true,
            }));
          }
        } else {
          fields.push(this.createField(name, 'query', 0.95, { line: lineNumber }));
        }
      }
    }

    // Extract fields from filter methods: .eq('field', value), .neq(), .gt(), .lt(), etc.
    const filterPatterns = [
      /\.eq\s*\(\s*["'](\w+)["']/g,
      /\.neq\s*\(\s*["'](\w+)["']/g,
      /\.gt\s*\(\s*["'](\w+)["']/g,
      /\.gte\s*\(\s*["'](\w+)["']/g,
      /\.lt\s*\(\s*["'](\w+)["']/g,
      /\.lte\s*\(\s*["'](\w+)["']/g,
      /\.like\s*\(\s*["'](\w+)["']/g,
      /\.ilike\s*\(\s*["'](\w+)["']/g,
      /\.is\s*\(\s*["'](\w+)["']/g,
      /\.in\s*\(\s*["'](\w+)["']/g,
      /\.contains\s*\(\s*["'](\w+)["']/g,
      /\.containedBy\s*\(\s*["'](\w+)["']/g,
      /\.range\s*\(\s*["'](\w+)["']/g,
      /\.match\s*\(\s*\{([^}]+)\}/g,
    ];
    
    for (const pattern of filterPatterns) {
      const matches = line.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          // For .match({ field: value }), extract object keys
          if (pattern.source.includes('match')) {
            const keyMatches = match[1].matchAll(/(\w+)\s*:/g);
            for (const km of keyMatches) {
              if (km[1]) {
                fields.push(this.createField(km[1], 'filter', 0.9, { line: lineNumber }));
              }
            }
          } else {
            fields.push(this.createField(match[1], 'filter', 0.9, { line: lineNumber }));
          }
        }
      }
    }
    
    // Extract fields from .order('field')
    const orderMatch = line.match(/\.order\s*\(\s*["'](\w+)["']/);
    if (orderMatch?.[1]) {
      fields.push(this.createField(orderMatch[1], 'query', 0.85, { line: lineNumber }));
    }
    
    // Extract fields from .insert({ field: value }) or .update({ field: value })
    const mutationMatch = line.match(/\.(?:insert|update|upsert)\s*\(\s*\{([^}]+)\}/);
    if (mutationMatch?.[1]) {
      const keyMatches = mutationMatch[1].matchAll(/(\w+)\s*:/g);
      for (const km of keyMatches) {
        if (km[1]) {
          const source = line.includes('.insert') ? 'insert' : 'update';
          fields.push(this.createField(km[1], source, 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Deduplicate fields by name
    const uniqueFields = this.deduplicateFields(fields);
    
    return this.buildResult(uniqueFields, table, this.framework);
  }
  
  extractFromModels(_content: string): ModelExtractionResult[] {
    // Supabase doesn't have model definitions in code
    // Models are defined in the database schema
    return [];
  }
  
  private deduplicateFields(fields: ExtractedField[]): ExtractedField[] {
    const seen = new Map<string, ExtractedField>();
    for (const field of fields) {
      const existing = seen.get(field.name);
      if (!existing || field.confidence > existing.confidence) {
        seen.set(field.name, field);
      }
    }
    return Array.from(seen.values());
  }
}

export function createSupabaseExtractor(): SupabaseFieldExtractor {
  return new SupabaseFieldExtractor();
}
