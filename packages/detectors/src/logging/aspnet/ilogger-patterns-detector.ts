/**
 * ILogger Patterns Detector for ASP.NET Core
 *
 * Detects ILogger<T> usage patterns:
 * - ILogger<T> injection
 * - Log level usage (Debug, Info, Warning, Error, Critical)
 * - Structured logging with templates
 * - Log scopes
 * - High-performance logging patterns
 */

import type { PatternMatch, Violation, Language } from 'driftdetect-core';
import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import { BaseDetector } from '../../base/base-detector.js';

// ============================================================================
// Types
// ============================================================================

export interface ILoggerPatternInfo {
  /** Type of logging pattern */
  type: 'logger-injection' | 'log-call' | 'log-scope' | 'logger-message' | 'structured-log';
  /** Log level if applicable */
  level: 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' | 'Trace' | null;
  /** Logger type (generic parameter) */
  loggerType: string | null;
  /** Message template if structured logging */
  messageTemplate: string | null;
  /** Line number */
  line: number;
  /** File path */
  file: string;
}

export interface ILoggerAnalysis {
  /** All logging patterns found */
  patterns: ILoggerPatternInfo[];
  /** Logger types injected */
  loggerTypes: string[];
  /** Log levels used */
  logLevels: string[];
  /** Whether using structured logging */
  usesStructuredLogging: boolean;
  /** Whether using high-performance logging */
  usesHighPerformanceLogging: boolean;
  /** Whether using log scopes */
  usesLogScopes: boolean;
  /** Potential issues */
  issues: string[];
  /** Confidence score */
  confidence: number;
}

// ============================================================================
// Detector Implementation
// ============================================================================

export class ILoggerPatternsDetector extends BaseDetector {
  readonly id = 'logging/aspnet-ilogger-patterns';
  readonly category = 'logging' as const;
  readonly subcategory = 'structured-logging';
  readonly name = 'ASP.NET ILogger Patterns Detector';
  readonly description = 'Detects ILogger<T> usage patterns in ASP.NET Core';
  readonly supportedLanguages: Language[] = ['csharp'];
  readonly detectionMethod = 'regex' as const;

  async detect(context: DetectionContext): Promise<DetectionResult> {
    const { content, file } = context;
    
    if (!this.isRelevantFile(content)) {
      return this.createEmptyResult();
    }

    const analysis = this.analyzeILoggerPatterns(content, file);
    const patterns: PatternMatch[] = [];
    const violations: Violation[] = [];

    for (const pattern of analysis.patterns) {
      patterns.push({
        patternId: `${this.id}/${pattern.type}`,
        location: {
          file: pattern.file,
          line: pattern.line,
          column: 1,
        },
        confidence: analysis.confidence,
        isOutlier: false,
      });
    }

    violations.push(...this.detectViolations(analysis, file));

    return this.createResult(patterns, violations, analysis.confidence, {
      custom: {
        iloggerAnalysis: analysis,
      },
    });
  }

  private isRelevantFile(content: string): boolean {
    return (
      content.includes('ILogger') ||
      content.includes('LogDebug') ||
      content.includes('LogInformation') ||
      content.includes('LogWarning') ||
      content.includes('LogError') ||
      content.includes('LogCritical') ||
      content.includes('LoggerMessage')
    );
  }

  analyzeILoggerPatterns(content: string, file: string): ILoggerAnalysis {
    const patterns: ILoggerPatternInfo[] = [];
    const loggerTypes = new Set<string>();
    const logLevels = new Set<string>();
    const issues: string[] = [];
    let usesStructuredLogging = false;
    let usesHighPerformanceLogging = false;
    let usesLogScopes = false;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const lineNum = i + 1;

      // Detect ILogger<T> injection
      const loggerInjectionMatch = line.match(/ILogger<(\w+)>/);
      if (loggerInjectionMatch && loggerInjectionMatch[1]) {
        loggerTypes.add(loggerInjectionMatch[1]);
        patterns.push({
          type: 'logger-injection',
          level: null,
          loggerType: loggerInjectionMatch[1],
          messageTemplate: null,
          line: lineNum,
          file,
        });
      }

      // Detect log calls with levels
      const logCallMatch = line.match(/(?:_logger|logger|Logger)\s*\.\s*Log(Debug|Information|Warning|Error|Critical|Trace)\s*\(/i);
      if (logCallMatch && logCallMatch[1]) {
        const level = logCallMatch[1] as ILoggerPatternInfo['level'];
        logLevels.add(level || 'Unknown');
        
        // Check for structured logging (message templates with {})
        const templateMatch = line.match(/Log\w+\s*\(\s*["']([^"']*\{[^}]+\}[^"']*)["']/);
        if (templateMatch) {
          usesStructuredLogging = true;
          patterns.push({
            type: 'structured-log',
            level,
            loggerType: null,
            messageTemplate: templateMatch[1] || null,
            line: lineNum,
            file,
          });
        } else {
          patterns.push({
            type: 'log-call',
            level,
            loggerType: null,
            messageTemplate: null,
            line: lineNum,
            file,
          });
        }
      }

      // Detect BeginScope
      if (line.includes('BeginScope')) {
        usesLogScopes = true;
        patterns.push({
          type: 'log-scope',
          level: null,
          loggerType: null,
          messageTemplate: null,
          line: lineNum,
          file,
        });
      }

      // Detect LoggerMessage.Define (high-performance logging)
      if (line.includes('LoggerMessage.Define') || line.includes('[LoggerMessage')) {
        usesHighPerformanceLogging = true;
        patterns.push({
          type: 'logger-message',
          level: null,
          loggerType: null,
          messageTemplate: null,
          line: lineNum,
          file,
        });
      }

      // Detect string interpolation in log calls (potential issue)
      if (line.match(/Log(Debug|Information|Warning|Error|Critical)\s*\(\s*\$"/)) {
        issues.push(`String interpolation in log call at line ${lineNum} - use structured logging instead`);
      }

      // Detect string concatenation in log calls (potential issue)
      if (line.match(/Log(Debug|Information|Warning|Error|Critical)\s*\([^)]*\+/)) {
        issues.push(`String concatenation in log call at line ${lineNum} - use structured logging instead`);
      }
    }

    return {
      patterns,
      loggerTypes: Array.from(loggerTypes),
      logLevels: Array.from(logLevels),
      usesStructuredLogging,
      usesHighPerformanceLogging,
      usesLogScopes,
      issues,
      confidence: patterns.length > 0 ? 0.85 : 0,
    };
  }

  private detectViolations(analysis: ILoggerAnalysis, file: string): Violation[] {
    const violations: Violation[] = [];

    for (const issue of analysis.issues) {
      const lineMatch = issue.match(/line (\d+)/);
      const lineNum = lineMatch ? parseInt(lineMatch[1] || '1', 10) : 1;

      violations.push({
        id: `${this.id}-${file}-${lineNum}-issue`,
        patternId: this.id,
        severity: 'warning',
        file,
        range: {
          start: { line: lineNum - 1, character: 0 },
          end: { line: lineNum - 1, character: 100 },
        },
        message: issue,
        expected: 'Use structured logging with message templates: _logger.LogInformation("User {UserId} logged in", userId)',
        actual: 'String interpolation or concatenation in log call',
        explanation: 'String interpolation/concatenation in log calls prevents structured logging benefits ' +
          'like log aggregation, searching, and filtering. Use message templates with placeholders instead.',
        aiExplainAvailable: true,
        aiFixAvailable: true,
        firstSeen: new Date(),
        occurrences: 1,
      });
    }

    return violations;
  }

  generateQuickFix(): null {
    return null;
  }
}

export function createILoggerPatternsDetector(): ILoggerPatternsDetector {
  return new ILoggerPatternsDetector();
}
