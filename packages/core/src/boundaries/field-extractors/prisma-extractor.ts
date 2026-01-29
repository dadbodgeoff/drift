/**
 * Prisma Field Extractor
 * 
 * Extracts fields from Prisma query patterns:
 * - prisma.user.findMany({ select: { id: true, email: true } })
 * - prisma.user.findFirst({ where: { email: 'test' } })
 * - prisma.user.create({ data: { email: 'test', name: 'Test' } })
 * - prisma.user.update({ where: { id: 1 }, data: { name: 'New' } })
 * 
 * Also extracts from schema.prisma model definitions.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class PrismaFieldExtractor extends BaseFieldExtractor {
  readonly name = 'prisma';
  readonly framework: ORMFramework = 'prisma';
  readonly languages = ['typescript', 'javascript', 'prisma'];
  
  matches(content: string, language: string): boolean {
    if (language === 'prisma') {return true;}
    if (!['typescript', 'javascript'].includes(language)) {return false;}
    return (
      content.includes('prisma.') ||
      content.includes('@prisma/client') ||
      content.includes('PrismaClient')
    );
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Extract table from prisma.tableName.method()
    const tableMatch = line.match(/prisma\.([a-zA-Z_][a-zA-Z0-9_]*)\./);
    if (tableMatch?.[1]) {
      table = tableMatch[1];
    }
    
    // Extract fields from select: { field: true }
    const selectMatch = line.match(/select\s*:\s*\{([^}]+)\}/);
    if (selectMatch?.[1]) {
      const fieldMatches = selectMatch[1].matchAll(/(\w+)\s*:\s*true/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.95, { line: lineNumber }));
        }
      }
    }

    // Extract fields from where: { field: value }
    const whereMatch = line.match(/where\s*:\s*\{([^}]+)\}/);
    if (whereMatch?.[1]) {
      const fieldMatches = whereMatch[1].matchAll(/(\w+)\s*:/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'filter', 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from data: { field: value }
    const dataMatch = line.match(/data\s*:\s*\{([^}]+)\}/);
    if (dataMatch?.[1]) {
      const fieldMatches = dataMatch[1].matchAll(/(\w+)\s*:/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          const source = line.includes('.create') ? 'insert' : 'update';
          fields.push(this.createField(fm[1], source, 0.9, { line: lineNumber }));
        }
      }
    }
    
    // Extract fields from include: { relation: true }
    const includeMatch = line.match(/include\s*:\s*\{([^}]+)\}/);
    if (includeMatch?.[1]) {
      const fieldMatches = includeMatch[1].matchAll(/(\w+)\s*:/g);
      for (const fm of fieldMatches) {
        if (fm[1]) {
          fields.push(this.createField(fm[1], 'query', 0.85, {
            line: lineNumber,
            isRelation: true,
          }));
        }
      }
    }
    
    // Extract fields from orderBy: { field: 'asc' }
    const orderMatch = line.match(/orderBy\s*:\s*\{([^}]+)\}/);
    if (orderMatch?.[1]) {
      const fieldMatches = orderMatch[1].matchAll(/(\w+)\s*:/g);
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
    
    // Parse schema.prisma model definitions
    const modelPattern = /model\s+(\w+)\s*\{([^}]+)\}/g;
    let match;
    
    while ((match = modelPattern.exec(content)) !== null) {
      const modelName = match[1];
      const modelBody = match[2];
      if (!modelName || !modelBody) {continue;}
      
      const startLine = content.substring(0, match.index).split('\n').length;
      const endLine = startLine + modelBody.split('\n').length;
      
      const fields: ExtractedField[] = [];
      const lines = modelBody.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim();
        if (!line || line.startsWith('//') || line.startsWith('@@')) {continue;}
        
        // Parse field: name Type @attributes
        const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?/);
        if (fieldMatch?.[1] && fieldMatch[2]) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          
          // Check if it's a relation
          const isRelation = /^[A-Z]/.test(fieldType) && !['Int', 'String', 'Boolean', 'DateTime', 'Float', 'Decimal', 'BigInt', 'Bytes', 'Json'].includes(fieldType);
          
          const fieldOptions: Partial<ExtractedField> = {
            type: fieldType,
            line: startLine + i,
            isRelation,
          };
          if (isRelation) {
            fieldOptions.relatedTable = fieldType.toLowerCase() + 's';
          }
          
          fields.push(this.createField(fieldName, 'model', 0.98, fieldOptions));
        }
      }
      
      results.push({
        modelName,
        tableName: modelName.toLowerCase() + 's',
        fields,
        framework: this.framework,
        startLine,
        endLine,
      });
    }
    
    return results;
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

export function createPrismaExtractor(): PrismaFieldExtractor {
  return new PrismaFieldExtractor();
}
