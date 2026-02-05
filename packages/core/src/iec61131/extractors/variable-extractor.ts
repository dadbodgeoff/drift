/**
 * Variable Extractor
 * 
 * Extracts all variables from IEC 61131-3 code with full metadata.
 * Handles all variable sections and I/O address mappings.
 */

import type {
  STVariable,
  VariableSection,
  IOMapping,
  IOAddressType,
} from '../types.js';
import { generateId } from '../utils/id-generator.js';

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export interface VariableExtractionResult {
  variables: ExtractedVariable[];
  ioMappings: IOMapping[];
  summary: VariableSummary;
}

export interface ExtractedVariable extends STVariable {
  file: string;
}

export interface VariableSummary {
  total: number;
  bySection: Record<VariableSection, number>;
  withComments: number;
  withIOAddress: number;
  safetyCritical: number;
}

export interface VariableExtractionOptions {
  extractIO?: boolean;
  detectSafety?: boolean;
}

// ============================================================================
// PATTERNS
// ============================================================================

// Variable section patterns
const VAR_SECTION_PATTERNS: Array<{ pattern: RegExp; section: VariableSection }> = [
  { pattern: /VAR_INPUT\b/gi, section: 'VAR_INPUT' },
  { pattern: /VAR_OUTPUT\b/gi, section: 'VAR_OUTPUT' },
  { pattern: /VAR_IN_OUT\b/gi, section: 'VAR_IN_OUT' },
  { pattern: /VAR_GLOBAL\b/gi, section: 'VAR_GLOBAL' },
  { pattern: /VAR_TEMP\b/gi, section: 'VAR_TEMP' },
  { pattern: /VAR_CONSTANT\b/gi, section: 'VAR_CONSTANT' },
  { pattern: /VAR_EXTERNAL\b/gi, section: 'VAR_EXTERNAL' },
  { pattern: /VAR\b(?!_)/gi, section: 'VAR' },
];

// I/O address pattern
const IO_ADDRESS_PATTERN = /%([IQM])([XBWD]?)(\d+(?:\.\d+)?)/gi;

// Safety variable patterns
const SAFETY_PATTERNS = [
  /^bIL_/i,
  /^IL_/i,
  /Interlock/i,
  /Permissive/i,
  /EStop/i,
  /E_Stop/i,
  /EmergencyStop/i,
  /Safety/i,
  /Bypass/i,
];

// ============================================================================
// EXTRACTOR
// ============================================================================

export function extractVariables(
  source: string,
  filePath: string,
  options: VariableExtractionOptions = {}
): VariableExtractionResult {
  const { extractIO = true, detectSafety = true } = options;

  const variables: ExtractedVariable[] = [];
  const ioMappings: IOMapping[] = [];

  // Find all variable sections
  const sections = findVariableSections(source);

  for (const section of sections) {
    const sectionVars = parseVariableSection(
      section.content,
      section.section,
      section.startLine,
      filePath,
      detectSafety
    );
    variables.push(...sectionVars);
  }

  // Extract I/O mappings if requested
  if (extractIO) {
    const ios = extractIOAddresses(source, filePath);
    ioMappings.push(...ios);
  }

  const summary = calculateSummary(variables, ioMappings);
  return { variables, ioMappings, summary };
}

// ============================================================================
// SECTION FINDING
// ============================================================================

interface VariableSectionInfo {
  section: VariableSection;
  content: string;
  startLine: number;
  endLine: number;
}

function findVariableSections(source: string): VariableSectionInfo[] {
  const sections: VariableSectionInfo[] = [];
  const lines = source.split('\n');

  let currentSection: VariableSection | null = null;
  let sectionStart = 0;
  let sectionContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineUpper = line.toUpperCase().trim();

    // Check for section start
    for (const { pattern, section } of VAR_SECTION_PATTERNS) {
      if (pattern.test(line)) {
        // Save previous section if exists
        if (currentSection && sectionContent.length > 0) {
          sections.push({
            section: currentSection,
            content: sectionContent.join('\n'),
            startLine: sectionStart,
            endLine: i,
          });
        }

        currentSection = section;
        sectionStart = i + 1;
        sectionContent = [];
        break;
      }
    }

    // Check for section end
    if (lineUpper.includes('END_VAR')) {
      if (currentSection && sectionContent.length > 0) {
        sections.push({
          section: currentSection,
          content: sectionContent.join('\n'),
          startLine: sectionStart,
          endLine: i + 1,
        });
      }
      currentSection = null;
      sectionContent = [];
      continue;
    }

    // Accumulate content
    if (currentSection) {
      sectionContent.push(line);
    }
  }

  return sections;
}

// ============================================================================
// VARIABLE PARSING
// ============================================================================

function parseVariableSection(
  content: string,
  section: VariableSection,
  startLine: number,
  filePath: string,
  detectSafety: boolean
): ExtractedVariable[] {
  const variables: ExtractedVariable[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith('(*') || line.startsWith('//')) continue;
    
    // Skip modifiers
    if (/^(CONSTANT|RETAIN|PERSISTENT)\s*$/i.test(line)) continue;

    const variable = parseVariableLine(line, section, startLine + i, filePath, detectSafety);
    if (variable) {
      variables.push(variable);
    }
  }

  return variables;
}

function parseVariableLine(
  line: string,
  section: VariableSection,
  lineNum: number,
  filePath: string,
  detectSafety: boolean
): ExtractedVariable | null {
  // Pattern: name [AT %address] : type [:= value] ; (* comment *)
  const pattern = /^(\w+)\s*(?:AT\s+(%[IQM][XBWD]?\d+(?:\.\d+)?))?\s*:\s*(\w+(?:\s*\[\s*\d+\s*(?:\.\.\s*\d+)?\s*\])?(?:\s+OF\s+\w+)?)\s*(?::=\s*([^;]+))?\s*;?\s*(?:\(\*\s*(.*?)\s*\*\))?/i;
  
  const match = line.match(pattern);
  if (!match) {
    // Try simpler pattern
    const simplePattern = /^(\w+)\s*:\s*(\w+)/;
    const simpleMatch = line.match(simplePattern);
    if (!simpleMatch) return null;
    
    return {
      id: generateId(),
      file: filePath,
      name: simpleMatch[1]!,
      dataType: simpleMatch[2]!,
      section,
      initialValue: null,
      comment: null,
      isArray: false,
      arrayBounds: null,
      isSafetyCritical: detectSafety && isSafetyVariable(simpleMatch[1]!),
      ioAddress: null,
      location: {
        file: filePath,
        line: lineNum,
        column: 1,
      },
      pouId: null,
    };
  }

  const name = match[1]!;
  const ioAddress = match[2] || null;
  const dataType = match[3]!;
  const initialValue = match[4]?.trim() || null;
  const comment = match[5]?.trim() || null;

  // Check for array
  const isArray = /ARRAY\s*\[/i.test(dataType) || /\[\s*\d+/.test(dataType);
  const arrayBounds = isArray ? parseArrayBounds(dataType) : null;

  return {
    id: generateId(),
    file: filePath,
    name,
    dataType: cleanDataType(dataType),
    section,
    initialValue,
    comment,
    isArray,
    arrayBounds,
    isSafetyCritical: detectSafety && isSafetyVariable(name),
    ioAddress,
    location: {
      file: filePath,
      line: lineNum,
      column: 1,
    },
    pouId: null,
  };
}

function parseArrayBounds(dataType: string): { dimensions: Array<{ lower: number; upper: number }> } | null {
  const boundsPattern = /\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/g;
  const dimensions: Array<{ lower: number; upper: number }> = [];
  
  let match: RegExpExecArray | null;
  while ((match = boundsPattern.exec(dataType)) !== null) {
    dimensions.push({
      lower: parseInt(match[1]!, 10),
      upper: parseInt(match[2]!, 10),
    });
  }

  // Simple array [n]
  const simplePattern = /\[\s*(\d+)\s*\]/g;
  while ((match = simplePattern.exec(dataType)) !== null) {
    dimensions.push({
      lower: 0,
      upper: parseInt(match[1]!, 10) - 1,
    });
  }

  return dimensions.length > 0 ? { dimensions } : null;
}

function cleanDataType(dataType: string): string {
  // Remove array bounds for cleaner type
  return dataType
    .replace(/ARRAY\s*\[[^\]]+\]\s*OF\s*/gi, '')
    .replace(/\[[^\]]+\]/g, '')
    .trim();
}

function isSafetyVariable(name: string): boolean {
  return SAFETY_PATTERNS.some(p => p.test(name));
}

// ============================================================================
// I/O ADDRESS EXTRACTION
// ============================================================================

function extractIOAddresses(source: string, filePath: string): IOMapping[] {
  const mappings: IOMapping[] = [];
  const seen = new Set<string>();

  // Find all I/O addresses
  let match: RegExpExecArray | null;
  const pattern = new RegExp(IO_ADDRESS_PATTERN.source, IO_ADDRESS_PATTERN.flags);

  while ((match = pattern.exec(source)) !== null) {
    const fullAddress = match[0];
    
    if (seen.has(fullAddress)) continue;
    seen.add(fullAddress);

    const areaType = match[1]!; // I, Q, or M
    const sizeType = match[2] || 'X'; // X, B, W, D

    const addressType = `${areaType}${sizeType}` as IOAddressType;
    const isInput = areaType === 'I';
    const bitSize = getBitSize(sizeType);

    // Try to find associated variable name
    const varName = findAssociatedVariable(source, fullAddress, match.index);

    const line = getLineNumber(source, match.index);

    mappings.push({
      id: generateId(),
      address: fullAddress,
      addressType,
      variableName: varName,
      description: null,
      location: {
        file: filePath,
        line,
        column: match.index - source.lastIndexOf('\n', match.index),
      },
      pouId: null,
      isInput,
      bitSize,
    });
  }

  return mappings;
}

function getBitSize(sizeType: string): number {
  switch (sizeType.toUpperCase()) {
    case 'X': return 1;
    case 'B': return 8;
    case 'W': return 16;
    case 'D': return 32;
    default: return 1;
  }
}

function findAssociatedVariable(source: string, _address: string, addressIndex: number): string | null {
  // Look backwards for variable name
  const beforeAddress = source.slice(Math.max(0, addressIndex - 100), addressIndex);
  
  // Pattern: varName AT %address
  const atPattern = /(\w+)\s+AT\s*$/i;
  const atMatch = beforeAddress.match(atPattern);
  if (atMatch) {
    return atMatch[1]!;
  }

  // Pattern: varName := %address
  const assignPattern = /(\w+)\s*:=\s*$/;
  const assignMatch = beforeAddress.match(assignPattern);
  if (assignMatch) {
    return assignMatch[1]!;
  }

  return null;
}

function getLineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

// ============================================================================
// SUMMARY
// ============================================================================

function calculateSummary(variables: ExtractedVariable[], ioMappings: IOMapping[]): VariableSummary {
  const bySection: Record<VariableSection, number> = {
    'VAR_INPUT': 0,
    'VAR_OUTPUT': 0,
    'VAR_IN_OUT': 0,
    'VAR': 0,
    'VAR_GLOBAL': 0,
    'VAR_TEMP': 0,
    'VAR_CONSTANT': 0,
    'VAR_EXTERNAL': 0,
  };

  let withComments = 0;
  let withIOAddress = 0;
  let safetyCritical = 0;

  for (const v of variables) {
    bySection[v.section]++;
    if (v.comment) withComments++;
    if (v.ioAddress) withIOAddress++;
    if (v.isSafetyCritical) safetyCritical++;
  }

  return {
    total: variables.length,
    bySection,
    withComments,
    withIOAddress: withIOAddress + ioMappings.length,
    safetyCritical,
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export function extractVariablesFromFiles(
  files: Array<{ path: string; content: string }>,
  options?: VariableExtractionOptions
): VariableExtractionResult {
  const allVariables: ExtractedVariable[] = [];
  const allIOMappings: IOMapping[] = [];

  for (const file of files) {
    const result = extractVariables(file.content, file.path, options);
    allVariables.push(...result.variables);
    allIOMappings.push(...result.ioMappings);
  }

  const summary = calculateSummary(allVariables, allIOMappings);
  return { variables: allVariables, ioMappings: allIOMappings, summary };
}
