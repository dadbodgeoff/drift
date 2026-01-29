/**
 * Diesel Field Extractor (Rust)
 * 
 * Extracts fields from Diesel query patterns:
 * - users.select((id, email)).load(&conn)
 * - users.filter(email.eq("test")).first(&conn)
 * - diesel::insert_into(users).values(&new_user)
 * - diesel::update(users.find(1)).set(name.eq("new"))
 * 
 * Also extracts from Diesel model definitions.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class DieselFieldExtractor extends BaseFieldExtractor {
  readonly name = 'diesel';
  readonly framework: ORMFramework = 'diesel';
  readonly languages = ['rust'];
  
  matches(content: string, language: string): boolean {
    if (language !== 'rust') {return false;}
    return (
      content.includes('diesel::') ||
      content.includes('#[derive(Queryable)]') ||
      content.includes('#[table_name') ||
      content.includes('use diesel::')
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from table_name::table or insert_into(table_name)
    const tableMatch = line.match(/(?:insert_into|update|delete_from)\s*\(\s*(\w+)/);
    if (tableMatch?.[1]) {
      table = tableMatch[1];
    }
    
    // Extract table from table.select() or table.filter()
    const tableSelectMatch = line.match(/(\w+)\.(?:select|filter|find|first|load)/);
    if (tableSelectMatch?.[1] && !['diesel', 'self', 'conn', 'db'].includes(tableSelectMatch[1])) {
      table = tableSelectMatch[1];
    }
    
    // Extract fields from .select((field1, field2))
    const selectMatch = line.match(/\.select\s*\(\s*\(([^)]+)\)/);
    if (selectMatch?.[1]) {
      const fieldNames = selectMatch[1].split(',').map(f => f.trim()).filter(Boolean);
      for (const name of fieldNames) {
        fields.push(this.createField(name, 'query', 0.95, { line: lineNumber }));
      }
    }
    
    // Extract fields from .filter(field.eq(value))
    const filterMatch = line.match(/\.filter\s*\(\s*(\w+)\./);
    if (filterMatch?.[1]) {
      fields.push(this.createField(filterMatch[1], 'filter', 0.9, { line: lineNumber }));
    }

    // Extract fields from .order(field.desc())
    const orderMatch = line.match(/\.order\s*\(\s*(\w+)\./);
    if (orderMatch?.[1]) {
      fields.push(this.createField(orderMatch[1], 'query', 0.85, { line: lineNumber }));
    }
    
    // Extract fields from .set(field.eq(value))
    const setMatch = line.match(/\.set\s*\(\s*(\w+)\./);
    if (setMatch?.[1]) {
      fields.push(this.createField(setMatch[1], 'update', 0.9, { line: lineNumber }));
    }
    
    // Extract fields from .set((field1.eq(v1), field2.eq(v2)))
    const setMultiMatch = line.match(/\.set\s*\(\s*\(([^)]+)\)/);
    if (setMultiMatch?.[1]) {
      const fieldMatches = setMultiMatch[1].matchAll(/(\w+)\./g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'update', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Deduplicate
    const uniqueFields = this.deduplicateFields(fields);
    
    return this.buildResult(uniqueFields, table, this.framework);
  }
  
  extractFromModels(content: string): ModelExtractionResult[] {
    const results: ModelExtractionResult[] = [];
    
    // Parse Rust struct definitions with Diesel derives
    const structPattern = /#\[derive\([^\]]*Queryable[^\]]*\)\]\s*(?:#\[table_name\s*=\s*"(\w+)"\])?\s*(?:pub\s+)?struct\s+(\w+)\s*\{([^}]+)\}/g;
    let match;
    
    while ((match = structPattern.exec(content)) !== null) {
      const tableName = match[1];
      const modelName = match[2];
      const structBody = match[3];
      if (!modelName || !structBody) {continue;}
      
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = startLine + structBody.split('\n').length;
      
      const fields: ExtractedField[] = [];
      const lines = structBody.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line || line.startsWith('//')) {continue;}
        
        // Parse field: pub field_name: Type,
        const fieldMatch = line.match(/(?:pub\s+)?(\w+)\s*:\s*(\S+)/);
        if (fieldMatch?.[1] && fieldMatch[2]) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2].replace(/,\s*$/, '');
          
          fields.push(this.createField(fieldName, 'model', 0.98, {
            type: this.mapRustType(fieldType),
            line: startLine + i,
          }));
        }
      }
      
      if (fields.length > 0) {
        results.push({
          modelName,
          tableName: tableName ?? this.toSnakeCase(modelName) + 's',
          fields,
          framework: this.framework,
          startLine,
          endLine,
        });
      }
    }
    
    return results;
  }
  
  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }
  
  private mapRustType(rustType: string): string {
    const typeMap: Record<string, string> = {
      'String': 'string',
      '&str': 'string',
      'i8': 'int',
      'i16': 'int',
      'i32': 'int',
      'i64': 'bigint',
      'u8': 'int',
      'u16': 'int',
      'u32': 'int',
      'u64': 'bigint',
      'f32': 'float',
      'f64': 'float',
      'bool': 'boolean',
      'NaiveDateTime': 'datetime',
      'NaiveDate': 'date',
      'NaiveTime': 'time',
      'Vec<u8>': 'bytes',
      'Uuid': 'uuid',
    };
    
    // Handle Option<T>
    const optionMatch = rustType.match(/Option<(.+)>/);
    if (optionMatch?.[1]) {
      return typeMap[optionMatch[1]] ?? 'unknown';
    }
    
    return typeMap[rustType] ?? 'unknown';
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

export function createDieselExtractor(): DieselFieldExtractor {
  return new DieselFieldExtractor();
}
