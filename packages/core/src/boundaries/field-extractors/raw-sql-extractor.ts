/**
 * Raw SQL Field Extractor
 * 
 * Extracts fields from raw SQL queries in any language:
 * - SELECT id, email, name FROM users
 * - INSERT INTO users (email, name) VALUES (?, ?)
 * - UPDATE users SET name = ?, email = ? WHERE id = ?
 * - DELETE FROM users WHERE id = ?
 * 
 * This is a fallback extractor that works across all languages.
 */

import {
  BaseFieldExtractor,
  type LineExtractionResult,
  type ModelExtractionResult,
  type ExtractedField,
} from './types.js';

import type { ORMFramework } from '../types.js';

export class RawSQLFieldExtractor extends BaseFieldExtractor {
  readonly name = 'raw-sql';
  readonly framework: ORMFramework = 'raw-sql';
  readonly languages = [
    'typescript', 'javascript', 'python', 'csharp', 'php', 'java', 'go', 'rust', 'cpp'
  ];
  
  matches(content: string, _language: string): boolean {
    // Match any file with SQL keywords
    return /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(content);
  }
  
  extractFromLine(line: string, _context: string[], lineNumber: number): LineExtractionResult {
    if (this.isComment(line)) {
      return { fields: [] };
    }
    
    const fields: ExtractedField[] = [];
    let table: string | undefined;
    
    // Normalize line (handle multi-line SQL by joining with context)
    const normalizedLine = this.normalizeSQL(line, _context);
    
    // Extract table from FROM clause
    const fromMatch = normalizedLine.match(/\bFROM\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
    if (fromMatch?.[1]) {
      table = fromMatch[1];
    }
    
    // Extract table from INTO clause
    const intoMatch = normalizedLine.match(/\bINTO\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
    if (intoMatch?.[1]) {
      table = intoMatch[1];
    }
    
    // Extract table from UPDATE clause
    const updateTableMatch = normalizedLine.match(/\bUPDATE\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/i);
    if (updateTableMatch?.[1]) {
      table = updateTableMatch[1];
    }
    
    // Extract fields from SELECT clause
    const selectMatch = normalizedLine.match(/\bSELECT\s+(.*?)\s+FROM\b/i);
    if (selectMatch?.[1]) {
      const selectFields = this.parseSelectFields(selectMatch[1]);
      for (const name of selectFields) {
        fields.push(this.createField(name, 'query', 0.85, { line: lineNumber }));
      }
    }

    // Extract fields from INSERT INTO table (field1, field2)
    const insertMatch = normalizedLine.match(/\bINSERT\s+INTO\s+\S+\s*\(([^)]+)\)/i);
    if (insertMatch?.[1]) {
      const insertFields = this.parseFieldList(insertMatch[1]);
      for (const name of insertFields) {
        fields.push(this.createField(name, 'insert', 0.85, { line: lineNumber }));
      }
    }
    
    // Extract fields from UPDATE table SET field1 = ?, field2 = ?
    const setMatch = normalizedLine.match(/\bSET\s+(.*?)(?:\bWHERE\b|$)/i);
    if (setMatch?.[1]) {
      const setFields = this.parseSetFields(setMatch[1]);
      for (const name of setFields) {
        fields.push(this.createField(name, 'update', 0.85, { line: lineNumber }));
      }
    }
    
    // Extract fields from WHERE clause
    const whereMatch = normalizedLine.match(/\bWHERE\s+(.*?)(?:\bORDER\b|\bGROUP\b|\bLIMIT\b|$)/i);
    if (whereMatch?.[1]) {
      const whereFields = this.parseWhereFields(whereMatch[1]);
      for (const name of whereFields) {
        fields.push(this.createField(name, 'filter', 0.8, { line: lineNumber }));
      }
    }
    
    // Extract fields from ORDER BY clause
    const orderMatch = normalizedLine.match(/\bORDER\s+BY\s+(.*?)(?:\bLIMIT\b|$)/i);
    if (orderMatch?.[1]) {
      const orderFields = this.parseOrderFields(orderMatch[1]);
      for (const name of orderFields) {
        fields.push(this.createField(name, 'query', 0.75, { line: lineNumber }));
      }
    }
    
    // Extract fields from GROUP BY clause
    const groupMatch = normalizedLine.match(/\bGROUP\s+BY\s+(.*?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)/i);
    if (groupMatch?.[1]) {
      const groupFields = this.parseFieldList(groupMatch[1]);
      for (const name of groupFields) {
        fields.push(this.createField(name, 'query', 0.75, { line: lineNumber }));
      }
    }
    
    // Deduplicate
    const uniqueFields = this.deduplicateFields(fields);
    
    return this.buildResult(uniqueFields, table, this.framework);
  }
  
  extractFromModels(_content: string): ModelExtractionResult[] {
    // Raw SQL doesn't have model definitions
    return [];
  }
  
  /**
   * Normalize SQL by joining multi-line queries
   */
  private normalizeSQL(line: string, _context: string[]): string {
    // If line contains SQL keyword, try to get full statement from context
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) {
      // Find the start of the SQL statement in context
      // Extract the SQL statement (simplified - just use the line for now)
      return line;
    }
    return line;
  }
  
  /**
   * Parse SELECT field list, handling aliases and expressions
   */
  private parseSelectFields(selectStr: string): string[] {
    const fields: string[] = [];
    
    // Handle SELECT *
    if (selectStr.trim() === '*') {
      return [];
    }
    
    // Split by comma, handling nested parentheses
    const parts = this.splitByComma(selectStr);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '*') {continue;}
      
      // Handle table.field
      const dotMatch = trimmed.match(/(?:\w+\.)?(\w+)(?:\s+(?:AS\s+)?(\w+))?$/i);
      if (dotMatch) {
        // Use alias if present, otherwise use field name
        const fieldName = dotMatch[2] ?? dotMatch[1];
        if (fieldName && !this.isSQLKeyword(fieldName)) {
          fields.push(fieldName);
        }
      }
    }
    
    return fields;
  }
  
  /**
   * Parse SET clause fields
   */
  private parseSetFields(setStr: string): string[] {
    const fields: string[] = [];
    const parts = this.splitByComma(setStr);
    
    for (const part of parts) {
      const match = part.match(/^\s*(\w+)\s*=/);
      if (match?.[1]) {
        fields.push(match[1]);
      }
    }
    
    return fields;
  }
  
  /**
   * Parse WHERE clause fields
   */
  private parseWhereFields(whereStr: string): string[] {
    const fields: string[] = [];
    
    // Match field comparisons: field = ?, field > ?, field IN (...), etc.
    const fieldMatches = whereStr.matchAll(/(?:\w+\.)?(\w+)\s*(?:=|<>|!=|>|<|>=|<=|LIKE|IN|IS|BETWEEN)/gi);
    for (const match of fieldMatches) {
      if (match[1] && !this.isSQLKeyword(match[1])) {
        fields.push(match[1]);
      }
    }
    
    return fields;
  }
  
  /**
   * Parse ORDER BY fields
   */
  private parseOrderFields(orderStr: string): string[] {
    const fields: string[] = [];
    const parts = this.splitByComma(orderStr);
    
    for (const part of parts) {
      // Match field name, ignoring ASC/DESC
      const match = part.match(/(?:\w+\.)?(\w+)(?:\s+(?:ASC|DESC))?/i);
      if (match?.[1] && !this.isSQLKeyword(match[1])) {
        fields.push(match[1]);
      }
    }
    
    return fields;
  }
  
  /**
   * Split string by comma, respecting parentheses
   */
  private splitByComma(str: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    
    for (const char of str) {
      if (char === '(') {depth++;}
      else if (char === ')') {depth--;}
      else if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    
    if (current) {parts.push(current);}
    return parts;
  }
  
  /**
   * Check if a word is a SQL keyword
   */
  private isSQLKeyword(word: string): boolean {
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
      'TRUE', 'FALSE', 'LIKE', 'BETWEEN', 'ORDER', 'BY', 'ASC', 'DESC',
      'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT', 'RIGHT',
      'INNER', 'OUTER', 'ON', 'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG',
      'MIN', 'MAX', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    ];
    return keywords.includes(word.toUpperCase());
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

export function createRawSQLExtractor(): RawSQLFieldExtractor {
  return new RawSQLFieldExtractor();
}
