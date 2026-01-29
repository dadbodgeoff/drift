/**
 * SQLAlchemy Field Extractor
 * 
 * Extracts fields from SQLAlchemy query patterns:
 * - session.query(User.id, User.email)
 * - session.query(User).with_entities(User.email)
 * - session.query(User).filter(User.email == 'test')
 * - session.query(User).filter_by(email='test')
 * 
 * Also extracts from SQLAlchemy model definitions.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class SQLAlchemyFieldExtractor extends BaseFieldExtractor {
  readonly name = 'sqlalchemy';
  readonly framework: ORMFramework = 'sqlalchemy';
  readonly languages = ['python'];
  
  matches(content: string, language: string): boolean {
    if (language !== 'python') {return false;}
    return (
      content.includes('session.query') ||
      content.includes('declarative_base') ||
      content.includes('from sqlalchemy') ||
      content.includes('Column(')
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from session.query(Model) or session.query(Model.field)
    const queryMatch = line.match(/\.query\s*\(\s*([A-Z][a-zA-Z0-9]*)/);
    if (queryMatch?.[1]) {
      table = queryMatch[1].toLowerCase() + 's';
    }
    
    // Extract fields from session.query(Model.field1, Model.field2)
    const queryFieldsMatch = line.match(/\.query\s*\(([^)]+)\)/);
    if (queryFieldsMatch?.[1]) {
      const fieldMatches = queryFieldsMatch[1].matchAll(/[A-Z]\w*\.(\w+)/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .with_entities(Model.field1, Model.field2)
    const entitiesMatch = line.match(/\.with_entities\s*\(([^)]+)\)/);
    if (entitiesMatch?.[1]) {
      const fieldMatches = entitiesMatch[1].matchAll(/[A-Z]\w*\.(\w+)/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }

    // Extract fields from .filter(Model.field == value)
    const filterMatch = line.match(/\.filter\s*\(([^)]+)\)/);
    if (filterMatch?.[1]) {
      const fieldMatches = filterMatch[1].matchAll(/[A-Z]\w*\.(\w+)/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'filter', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .filter_by(field=value)
    const filterByMatch = line.match(/\.filter_by\s*\(([^)]+)\)/);
    if (filterByMatch?.[1]) {
      const fieldMatches = filterByMatch[1].matchAll(/(\w+)\s*=/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'filter', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .order_by(Model.field)
    const orderMatch = line.match(/\.order_by\s*\(([^)]+)\)/);
    if (orderMatch?.[1]) {
      const fieldMatches = orderMatch[1].matchAll(/[A-Z]\w*\.(\w+)/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .group_by(Model.field)
    const groupMatch = line.match(/\.group_by\s*\(([^)]+)\)/);
    if (groupMatch?.[1]) {
      const fieldMatches = groupMatch[1].matchAll(/[A-Z]\w*\.(\w+)/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Deduplicate
    const uniqueFields = this.deduplicateFields(fields);
    
    return this.buildResult(uniqueFields, table, this.framework);
  }
  
  extractFromModels(content: string): ModelExtractionResult[] {
    const results: ModelExtractionResult[] = [];
    
    // Parse SQLAlchemy model class definitions
    const modelPattern = /class\s+(\w+)\s*\([^)]*(?:Base|DeclarativeBase)[^)]*\)\s*:/g;
    let match;
    
    while ((match = modelPattern.exec(content)) !== null) {
      const modelName = match[1];
      if (!modelName) {continue;}
      
      const startLine = content.substring(0, match.index).split('\n').length;
      
      // Find the model body
      const afterClass = content.substring(match.index + match[0].length);
      const lines = afterClass.split('\n');
      const fields: ExtractedField[] = [];
      let endLine = startLine;
      let tableName: string | undefined;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {continue;}
        
        // Check if we've exited the class
        if (i > 0 && line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          break;
        }
        
        endLine = startLine + i + 1;
        
        // Check for __tablename__
        const tableNameMatch = line.match(/__tablename__\s*=\s*["'](\w+)["']/);
        if (tableNameMatch?.[1]) {
          tableName = tableNameMatch[1];
        }
        
        // Parse field definitions: field_name = Column(Type, ...)
        const fieldMatch = line.match(/^\s+(\w+)\s*=\s*Column\s*\(\s*(\w+)/);
        if (fieldMatch?.[1] && fieldMatch[2]) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          
          fields.push(this.createField(fieldName, 'model', 0.98, {
            type: this.mapSQLAlchemyType(fieldType),
            line: startLine + i + 1,
          }));
        }
        
        // Parse relationship definitions
        const relMatch = line.match(/^\s+(\w+)\s*=\s*relationship\s*\(\s*["'](\w+)["']/);
        if (relMatch?.[1] && relMatch[2]) {
          fields.push(this.createField(relMatch[1], 'model', 0.95, {
            type: 'relation',
            line: startLine + i + 1,
            isRelation: true,
            relatedTable: relMatch[2].toLowerCase() + 's',
          }));
        }
      }
      
      if (fields.length > 0) {
        results.push({
          modelName,
          tableName: tableName ?? modelName.toLowerCase() + 's',
          fields,
          framework: this.framework,
          startLine,
          endLine,
        });
      }
    }
    
    return results;
  }
  
  private mapSQLAlchemyType(saType: string): string {
    const typeMap: Record<string, string> = {
      'String': 'string',
      'Text': 'string',
      'Unicode': 'string',
      'UnicodeText': 'string',
      'Integer': 'int',
      'SmallInteger': 'int',
      'BigInteger': 'bigint',
      'Float': 'float',
      'Numeric': 'decimal',
      'Boolean': 'boolean',
      'Date': 'date',
      'DateTime': 'datetime',
      'Time': 'time',
      'LargeBinary': 'bytes',
      'PickleType': 'bytes',
      'Enum': 'enum',
      'JSON': 'json',
      'ARRAY': 'array',
    };
    return typeMap[saType] ?? 'unknown';
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

export function createSQLAlchemyExtractor(): SQLAlchemyFieldExtractor {
  return new SQLAlchemyFieldExtractor();
}
