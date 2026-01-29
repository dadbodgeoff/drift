/**
 * Django ORM Field Extractor
 * 
 * Extracts fields from Django query patterns:
 * - User.objects.values('id', 'email')
 * - User.objects.values_list('email', flat=True)
 * - User.objects.filter(email='test')
 * - User.objects.exclude(is_active=False)
 * - User.objects.only('id', 'email')
 * - User.objects.defer('password')
 * 
 * Also extracts from Django model definitions.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class DjangoFieldExtractor extends BaseFieldExtractor {
  readonly name = 'django';
  readonly framework: ORMFramework = 'django';
  readonly languages = ['python'];
  
  matches(content: string, language: string): boolean {
    if (language !== 'python') {return false;}
    return (
      content.includes('.objects.') ||
      content.includes('models.Model') ||
      content.includes('from django')
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from Model.objects
    const tableMatch = line.match(/([A-Z][a-zA-Z0-9]*)\.objects/);
    if (tableMatch?.[1]) {
      table = tableMatch[1].toLowerCase() + 's';
    }
    
    // Extract fields from .values('field1', 'field2')
    const valuesMatch = line.match(/\.values\s*\(([^)]+)\)/);
    if (valuesMatch?.[1]) {
      const fieldMatches = valuesMatch[1].matchAll(/["'](\w+)["']/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .values_list('field1', 'field2')
    const valuesListMatch = line.match(/\.values_list\s*\(([^)]+)\)/);
    if (valuesListMatch?.[1]) {
      const fieldMatches = valuesListMatch[1].matchAll(/["'](\w+)["']/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }

    // Extract fields from .filter(field=value) or .filter(field__lookup=value)
    const filterMatch = line.match(/\.filter\s*\(([^)]+)\)/);
    if (filterMatch?.[1]) {
      // Match field=value or field__lookup=value patterns
      const fieldMatches = filterMatch[1].matchAll(/(\w+)(?:__\w+)?\s*=/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'filter', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .exclude(field=value)
    const excludeMatch = line.match(/\.exclude\s*\(([^)]+)\)/);
    if (excludeMatch?.[1]) {
      const fieldMatches = excludeMatch[1].matchAll(/(\w+)(?:__\w+)?\s*=/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'filter', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .only('field1', 'field2')
    const onlyMatch = line.match(/\.only\s*\(([^)]+)\)/);
    if (onlyMatch?.[1]) {
      const fieldMatches = onlyMatch[1].matchAll(/["'](\w+)["']/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .defer('field1', 'field2')
    const deferMatch = line.match(/\.defer\s*\(([^)]+)\)/);
    if (deferMatch?.[1]) {
      const fieldMatches = deferMatch[1].matchAll(/["'](\w+)["']/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .order_by('field') or .order_by('-field')
    const orderMatch = line.match(/\.order_by\s*\(([^)]+)\)/);
    if (orderMatch?.[1]) {
      const fieldMatches = orderMatch[1].matchAll(/["']-?(\w+)["']/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .create(field=value)
    const createMatch = line.match(/\.create\s*\(([^)]+)\)/);
    if (createMatch?.[1]) {
      const fieldMatches = createMatch[1].matchAll(/(\w+)\s*=/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'insert', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from .update(field=value)
    const updateMatch = line.match(/\.update\s*\(([^)]+)\)/);
    if (updateMatch?.[1]) {
      const fieldMatches = updateMatch[1].matchAll(/(\w+)\s*=/g);
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
    
    // Parse Django model class definitions
    const modelPattern = /class\s+(\w+)\s*\([^)]*models\.Model[^)]*\)\s*:/g;
    let match;
    
    while ((match = modelPattern.exec(content)) !== null) {
      const modelName = match[1];
      if (!modelName) {continue;}
      
      const startLine = content.substring(0, match.index).split('\n').length;
      
      // Find the model body (indented lines after class definition)
      const afterClass = content.substring(match.index + match[0].length);
      const lines = afterClass.split('\n');
      const fields: ExtractedField[] = [];
      let endLine = startLine;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) {continue;}
        
        // Check if we've exited the class (non-indented, non-empty line)
        if (i > 0 && line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          break;
        }
        
        endLine = startLine + i + 1;
        
        // Parse field definitions: field_name = models.FieldType(...)
        const fieldMatch = line.match(/^\s+(\w+)\s*=\s*models\.(\w+)/);
        if (fieldMatch?.[1] && fieldMatch[2]) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          
          // Check if it's a relation
          const isRelation = ['ForeignKey', 'OneToOneField', 'ManyToManyField'].includes(fieldType);
          
          fields.push(this.createField(fieldName, 'model', 0.98, {
            type: this.mapDjangoType(fieldType),
            line: startLine + i + 1,
            isRelation,
          }));
        }
      }
      
      if (fields.length > 0) {
        results.push({
          modelName,
          tableName: modelName.toLowerCase() + 's',
          fields,
          framework: this.framework,
          startLine,
          endLine,
        });
      }
    }
    
    return results;
  }
  
  private mapDjangoType(djangoType: string): string {
    const typeMap: Record<string, string> = {
      'CharField': 'string',
      'TextField': 'string',
      'EmailField': 'string',
      'URLField': 'string',
      'SlugField': 'string',
      'IntegerField': 'int',
      'BigIntegerField': 'bigint',
      'SmallIntegerField': 'int',
      'PositiveIntegerField': 'int',
      'FloatField': 'float',
      'DecimalField': 'decimal',
      'BooleanField': 'boolean',
      'NullBooleanField': 'boolean',
      'DateField': 'date',
      'DateTimeField': 'datetime',
      'TimeField': 'time',
      'BinaryField': 'bytes',
      'FileField': 'string',
      'ImageField': 'string',
      'UUIDField': 'uuid',
      'JSONField': 'json',
      'ForeignKey': 'relation',
      'OneToOneField': 'relation',
      'ManyToManyField': 'relation',
    };
    return typeMap[djangoType] ?? 'unknown';
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

export function createDjangoExtractor(): DjangoFieldExtractor {
  return new DjangoFieldExtractor();
}
