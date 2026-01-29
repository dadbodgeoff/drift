/**
 * GORM Field Extractor (Go)
 * 
 * Extracts fields from GORM query patterns:
 * - db.Select("id", "email").Find(&users)
 * - db.Where("email = ?", email).First(&user)
 * - db.Create(&user)
 * - db.Model(&user).Updates(map[string]interface{}{"name": "new"})
 * 
 * Also extracts from GORM model definitions.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class GORMFieldExtractor extends BaseFieldExtractor {
  readonly name = 'gorm';
  readonly framework: ORMFramework = 'gorm';
  readonly languages = ['go'];
  
  matches(content: string, language: string): boolean {
    if (language !== 'go') {return false;}
    return (
      content.includes('gorm.Model') ||
      content.includes('gorm.DB') ||
      content.includes('"gorm.io/gorm"') ||
      content.includes('db.Find') ||
      content.includes('db.Create') ||
      content.includes('db.Where')
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from db.Model(&Model{}) or Find(&[]Model{})
    const modelMatch = line.match(/(?:Model|Find|First|Last|Take)\s*\(\s*&(?:\[\])?(\w+)/);
    if (modelMatch?.[1]) {
      table = modelMatch[1].toLowerCase() + 's';
    }
    
    // Extract fields from .Select("field1", "field2")
    const selectMatch = line.match(/\.Select\s*\(([^)]+)\)/);
    if (selectMatch?.[1]) {
      const fieldMatches = selectMatch[1].matchAll(/"(\w+)"/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .Where("field = ?", value) or .Where("field IN ?", values)
    const whereMatch = line.match(/\.Where\s*\(\s*"([^"]+)"/);
    if (whereMatch?.[1]) {
      const whereFields = this.parseWhereClause(whereMatch[1]);
      for (const name of whereFields) {
        fields.push(this.createField(name, 'filter', 0.9, { line: lineNumber }));
      }
    }

    // Extract fields from .Order("field desc")
    const orderMatch = line.match(/\.Order\s*\(\s*"([^"]+)"/);
    if (orderMatch?.[1]) {
      const orderFields = orderMatch[1].split(',').map(f => f.trim().split(/\s+/)[0]).filter(Boolean);
      for (const name of orderFields) {
        if (name) {
          fields.push(this.createField(name, 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .Omit("field1", "field2")
    const omitMatch = line.match(/\.Omit\s*\(([^)]+)\)/);
    if (omitMatch?.[1]) {
      const fieldMatches = omitMatch[1].matchAll(/"(\w+)"/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .Updates(map[string]interface{}{"field": value})
    const updatesMatch = line.match(/\.Updates\s*\(\s*map\[string\]interface\{\}\{([^}]+)\}/);
    if (updatesMatch?.[1]) {
      const fieldMatches = updatesMatch[1].matchAll(/"(\w+)"/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'update', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .Update("field", value)
    const updateMatch = line.match(/\.Update\s*\(\s*"(\w+)"/);
    if (updateMatch?.[1]) {
      fields.push(this.createField(updateMatch[1], 'update', 0.9, { line: lineNumber }));
    }
    
    // Deduplicate
    const uniqueFields = this.deduplicateFields(fields);
    
    return this.buildResult(uniqueFields, table, this.framework);
  }
  
  extractFromModels(content: string): ModelExtractionResult[] {
    const results: ModelExtractionResult[] = [];
    
    // Parse Go struct definitions with gorm tags
    const structPattern = /type\s+(\w+)\s+struct\s*\{([^}]+)\}/g;
    let match;
    
    while ((match = structPattern.exec(content)) !== null) {
      const modelName = match[1];
      const structBody = match[2];
      if (!modelName || !structBody) {continue;}
      
      // Check if this struct has gorm tags or embeds gorm.Model
      if (!structBody.includes('gorm:') && !structBody.includes('gorm.Model')) {
        continue;
      }
      
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = startLine + structBody.split('\n').length;
      
      const fields: ExtractedField[] = [];
      const lines = structBody.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line || line.startsWith('//')) {continue;}
        
        // Parse field: FieldName Type `gorm:"column:field_name"`
        const fieldMatch = line.match(/^\s*(\w+)\s+(\S+)(?:\s+`([^`]+)`)?/);
        if (fieldMatch?.[1] && fieldMatch[2]) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          const tags = fieldMatch[3] ?? '';
          
          // Skip embedded gorm.Model
          if (fieldType === 'gorm.Model') {continue;}
          
          // Extract column name from gorm tag if present
          const columnMatch = tags.match(/gorm:"[^"]*column:(\w+)/);
          const actualFieldName = columnMatch?.[1] ?? this.toSnakeCase(fieldName);
          
          fields.push(this.createField(actualFieldName, 'model', 0.98, {
            type: this.mapGoType(fieldType),
            line: startLine + i,
          }));
        }
      }
      
      if (fields.length > 0) {
        results.push({
          modelName,
          tableName: this.toSnakeCase(modelName) + 's',
          fields,
          framework: this.framework,
          startLine,
          endLine,
        });
      }
    }
    
    return results;
  }
  
  private parseWhereClause(whereStr: string): string[] {
    const fields: string[] = [];
    // Match field names before operators
    const fieldMatches = whereStr.matchAll(/(\w+)\s*(?:=|<>|!=|>|<|>=|<=|LIKE|IN|IS)/gi);
    for (const match of fieldMatches) {
      if (match[1]) {
        fields.push(match[1]);
      }
    }
    return fields;
  }
  
  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }
  
  private mapGoType(goType: string): string {
    const typeMap: Record<string, string> = {
      'string': 'string',
      'int': 'int',
      'int8': 'int',
      'int16': 'int',
      'int32': 'int',
      'int64': 'bigint',
      'uint': 'int',
      'uint8': 'int',
      'uint16': 'int',
      'uint32': 'int',
      'uint64': 'bigint',
      'float32': 'float',
      'float64': 'float',
      'bool': 'boolean',
      'time.Time': 'datetime',
      '[]byte': 'bytes',
    };
    return typeMap[goType] ?? 'unknown';
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

export function createGORMExtractor(): GORMFieldExtractor {
  return new GORMFieldExtractor();
}
