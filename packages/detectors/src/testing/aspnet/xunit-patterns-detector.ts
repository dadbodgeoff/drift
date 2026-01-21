/**
 * xUnit Patterns Detector for C#
 *
 * Detects xUnit test patterns:
 * - [Fact] / [Theory] attributes
 * - [InlineData] / [MemberData] / [ClassData]
 * - IClassFixture<T> / ICollectionFixture<T>
 * - Test naming conventions
 */

import type { PatternMatch, Language } from 'driftdetect-core';
import type { DetectionContext, DetectionResult } from '../../base/base-detector.js';
import { BaseDetector } from '../../base/base-detector.js';

// ============================================================================
// Types
// ============================================================================

export interface XUnitPatternInfo {
  /** Type of xUnit pattern */
  type: 'fact' | 'theory' | 'inline-data' | 'member-data' | 'class-data' | 'class-fixture' | 'collection-fixture' | 'output';
  /** Test method or class name */
  name: string;
  /** Data source for theories */
  dataSource: string | null;
  /** Line number */
  line: number;
  /** File path */
  file: string;
}

export interface XUnitAnalysis {
  /** All xUnit patterns found */
  patterns: XUnitPatternInfo[];
  /** Number of [Fact] tests */
  factCount: number;
  /** Number of [Theory] tests */
  theoryCount: number;
  /** Whether using fixtures */
  usesFixtures: boolean;
  /** Whether using ITestOutputHelper */
  usesTestOutput: boolean;
  /** Test naming patterns detected */
  namingPatterns: string[];
  /** Confidence score */
  confidence: number;
}

// ============================================================================
// Detector Implementation
// ============================================================================

export class XUnitPatternsDetector extends BaseDetector {
  readonly id = 'testing/xunit-patterns';
  readonly category = 'testing' as const;
  readonly subcategory = 'unit-testing';
  readonly name = 'xUnit Patterns Detector';
  readonly description = 'Detects xUnit test patterns in C#';
  readonly supportedLanguages: Language[] = ['csharp'];
  readonly detectionMethod = 'regex' as const;

  async detect(context: DetectionContext): Promise<DetectionResult> {
    const { content, file } = context;
    
    if (!this.isRelevantFile(content)) {
      return this.createEmptyResult();
    }

    const analysis = this.analyzeXUnitPatterns(content, file);
    const patterns: PatternMatch[] = [];

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

    return this.createResult(patterns, [], analysis.confidence, {
      custom: {
        xunitAnalysis: analysis,
      },
    });
  }

  private isRelevantFile(content: string): boolean {
    return (
      content.includes('[Fact]') ||
      content.includes('[Theory]') ||
      content.includes('using Xunit') ||
      content.includes('IClassFixture') ||
      content.includes('ITestOutputHelper')
    );
  }

  analyzeXUnitPatterns(content: string, file: string): XUnitAnalysis {
    const patterns: XUnitPatternInfo[] = [];
    const namingPatterns = new Set<string>();
    let factCount = 0;
    let theoryCount = 0;
    let usesFixtures = false;
    let usesTestOutput = false;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const lineNum = i + 1;

      // Detect [Fact]
      if (line.includes('[Fact]') || line.includes('[Fact(')) {
        factCount++;
        const methodMatch = this.findMethodName(lines, i);
        patterns.push({
          type: 'fact',
          name: methodMatch || 'Unknown',
          dataSource: null,
          line: lineNum,
          file,
        });
        
        if (methodMatch) {
          this.detectNamingPattern(methodMatch, namingPatterns);
        }
      }

      // Detect [Theory]
      if (line.includes('[Theory]') || line.includes('[Theory(')) {
        theoryCount++;
        const methodMatch = this.findMethodName(lines, i);
        patterns.push({
          type: 'theory',
          name: methodMatch || 'Unknown',
          dataSource: null,
          line: lineNum,
          file,
        });
        
        if (methodMatch) {
          this.detectNamingPattern(methodMatch, namingPatterns);
        }
      }

      // Detect [InlineData]
      const inlineDataMatch = line.match(/\[InlineData\s*\(([^)]*)\)\]/);
      if (inlineDataMatch) {
        patterns.push({
          type: 'inline-data',
          name: 'InlineData',
          dataSource: inlineDataMatch[1] || null,
          line: lineNum,
          file,
        });
      }

      // Detect [MemberData]
      const memberDataMatch = line.match(/\[MemberData\s*\(\s*(?:nameof\s*\(\s*)?(\w+)/);
      if (memberDataMatch) {
        patterns.push({
          type: 'member-data',
          name: 'MemberData',
          dataSource: memberDataMatch[1] || null,
          line: lineNum,
          file,
        });
      }

      // Detect [ClassData]
      const classDataMatch = line.match(/\[ClassData\s*\(\s*typeof\s*\(\s*(\w+)/);
      if (classDataMatch) {
        patterns.push({
          type: 'class-data',
          name: 'ClassData',
          dataSource: classDataMatch[1] || null,
          line: lineNum,
          file,
        });
      }

      // Detect IClassFixture<T>
      const classFixtureMatch = line.match(/IClassFixture<([^>]+)>/);
      if (classFixtureMatch) {
        usesFixtures = true;
        patterns.push({
          type: 'class-fixture',
          name: classFixtureMatch[1] || 'Fixture',
          dataSource: null,
          line: lineNum,
          file,
        });
      }

      // Detect ICollectionFixture<T>
      const collectionFixtureMatch = line.match(/ICollectionFixture<([^>]+)>/);
      if (collectionFixtureMatch) {
        usesFixtures = true;
        patterns.push({
          type: 'collection-fixture',
          name: collectionFixtureMatch[1] || 'Fixture',
          dataSource: null,
          line: lineNum,
          file,
        });
      }

      // Detect ITestOutputHelper
      if (line.includes('ITestOutputHelper')) {
        usesTestOutput = true;
        patterns.push({
          type: 'output',
          name: 'ITestOutputHelper',
          dataSource: null,
          line: lineNum,
          file,
        });
      }
    }

    return {
      patterns,
      factCount,
      theoryCount,
      usesFixtures,
      usesTestOutput,
      namingPatterns: Array.from(namingPatterns),
      confidence: patterns.length > 0 ? 0.9 : 0,
    };
  }

  private findMethodName(lines: string[], attributeLine: number): string | null {
    // Look for method declaration in the next few lines
    for (let i = attributeLine + 1; i < Math.min(attributeLine + 5, lines.length); i++) {
      const line = lines[i] || '';
      const methodMatch = line.match(/(?:public|private|protected|internal)\s+(?:async\s+)?(?:Task|void)\s+(\w+)\s*\(/);
      if (methodMatch) {
        return methodMatch[1] || null;
      }
    }
    return null;
  }

  private detectNamingPattern(methodName: string, patterns: Set<string>): void {
    // Should_When pattern
    if (methodName.includes('_Should_') || methodName.includes('Should_')) {
      patterns.add('Should_When');
    }
    // Given_When_Then pattern
    if (methodName.includes('Given_') || methodName.includes('_Given_')) {
      patterns.add('Given_When_Then');
    }
    // MethodName_Scenario_ExpectedBehavior pattern
    if ((methodName.match(/_/g) || []).length >= 2) {
      patterns.add('Method_Scenario_Expected');
    }
    // Simple descriptive (no underscores)
    if (!methodName.includes('_')) {
      patterns.add('Descriptive');
    }
  }

  generateQuickFix(): null {
    return null;
  }
}

export function createXUnitPatternsDetector(): XUnitPatternsDetector {
  return new XUnitPatternsDetector();
}
