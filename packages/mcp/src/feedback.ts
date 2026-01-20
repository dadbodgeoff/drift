/**
 * Example Quality Feedback System
 * 
 * Tracks user feedback on pattern examples to improve future suggestions.
 * Feedback is stored per-project and used to boost/penalize pattern locations.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ExampleFeedback {
  patternId: string;
  patternName: string;
  category: string;
  file: string;
  line: number;
  rating: 'good' | 'bad' | 'irrelevant';
  reason?: string | undefined;
  timestamp: string;
}

export interface FeedbackStats {
  totalFeedback: number;
  goodExamples: number;
  badExamples: number;
  irrelevantExamples: number;
  topGoodPatterns: Array<{ pattern: string; count: number }>;
  topBadPatterns: Array<{ pattern: string; count: number }>;
  topBadFiles: Array<{ file: string; count: number }>;
}

export interface LocationScore {
  file: string;
  boost: number;  // Positive = good examples, negative = bad examples
  confidence: number;  // How confident we are in this score (based on feedback count)
}

// ============================================================================
// Feedback Manager
// ============================================================================

export class FeedbackManager {
  private feedbackDir: string;
  private feedbackFile: string;
  private scoresFile: string;
  private feedback: ExampleFeedback[] = [];
  private locationScores: Map<string, LocationScore> = new Map();
  private initialized = false;

  constructor(projectRoot: string) {
    this.feedbackDir = path.join(projectRoot, '.drift', 'feedback');
    this.feedbackFile = path.join(this.feedbackDir, 'examples.json');
    this.scoresFile = path.join(this.feedbackDir, 'scores.json');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await fs.mkdir(this.feedbackDir, { recursive: true });
    await this.loadFeedback();
    await this.loadScores();
    this.initialized = true;
  }

  private async loadFeedback(): Promise<void> {
    try {
      const content = await fs.readFile(this.feedbackFile, 'utf-8');
      this.feedback = JSON.parse(content);
    } catch {
      this.feedback = [];
    }
  }

  private async loadScores(): Promise<void> {
    try {
      const content = await fs.readFile(this.scoresFile, 'utf-8');
      const scores: LocationScore[] = JSON.parse(content);
      this.locationScores = new Map(scores.map(s => [s.file, s]));
    } catch {
      this.locationScores = new Map();
    }
  }

  private async saveFeedback(): Promise<void> {
    await fs.writeFile(this.feedbackFile, JSON.stringify(this.feedback, null, 2), 'utf-8');
  }

  private async saveScores(): Promise<void> {
    const scores = Array.from(this.locationScores.values());
    await fs.writeFile(this.scoresFile, JSON.stringify(scores, null, 2), 'utf-8');
  }

  /**
   * Record feedback on an example
   */
  async recordFeedback(feedback: Omit<ExampleFeedback, 'timestamp'>): Promise<void> {
    await this.initialize();
    
    const entry: ExampleFeedback = {
      ...feedback,
      timestamp: new Date().toISOString(),
    };
    
    this.feedback.push(entry);
    
    // Update location scores
    await this.updateLocationScore(feedback.file, feedback.rating);
    
    // Keep last 5000 feedback entries
    if (this.feedback.length > 5000) {
      this.feedback = this.feedback.slice(-5000);
    }
    
    await this.saveFeedback();
    await this.saveScores();
  }

  private async updateLocationScore(file: string, rating: 'good' | 'bad' | 'irrelevant'): Promise<void> {
    const existing = this.locationScores.get(file) || {
      file,
      boost: 0,
      confidence: 0,
    };
    
    // Update boost based on rating
    const delta = rating === 'good' ? 0.1 : rating === 'bad' ? -0.15 : -0.05;
    existing.boost = Math.max(-1, Math.min(1, existing.boost + delta));
    
    // Increase confidence with each feedback
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    
    this.locationScores.set(file, existing);
    
    // Also update directory-level scores for pattern propagation
    const dir = path.dirname(file);
    const dirScore = this.locationScores.get(dir) || {
      file: dir,
      boost: 0,
      confidence: 0,
    };
    dirScore.boost = Math.max(-1, Math.min(1, dirScore.boost + delta * 0.3));
    dirScore.confidence = Math.min(1, dirScore.confidence + 0.03);
    this.locationScores.set(dir, dirScore);
  }

  /**
   * Get the quality score for a file (used to rank examples)
   * Returns a multiplier: 1.0 = neutral, >1 = boosted, <1 = penalized
   */
  getFileScore(file: string): number {
    const fileScore = this.locationScores.get(file);
    const dirScore = this.locationScores.get(path.dirname(file));
    
    let boost = 0;
    let confidence = 0;
    
    if (fileScore) {
      boost += fileScore.boost * fileScore.confidence;
      confidence = Math.max(confidence, fileScore.confidence);
    }
    
    if (dirScore) {
      boost += dirScore.boost * dirScore.confidence * 0.5;
      confidence = Math.max(confidence, dirScore.confidence * 0.5);
    }
    
    // Convert boost to multiplier: -1 -> 0.3, 0 -> 1.0, 1 -> 1.7
    return 1 + (boost * 0.7);
  }

  /**
   * Check if a file should be excluded based on consistent bad feedback
   */
  shouldExcludeFile(file: string): boolean {
    const score = this.locationScores.get(file);
    if (!score) return false;
    
    // Exclude if we have high confidence that this file produces bad examples
    return score.boost < -0.5 && score.confidence > 0.5;
  }

  /**
   * Get feedback statistics
   */
  async getStats(): Promise<FeedbackStats> {
    await this.initialize();
    
    const goodExamples = this.feedback.filter(f => f.rating === 'good').length;
    const badExamples = this.feedback.filter(f => f.rating === 'bad').length;
    const irrelevantExamples = this.feedback.filter(f => f.rating === 'irrelevant').length;
    
    // Count patterns
    const patternCounts = new Map<string, { good: number; bad: number }>();
    for (const f of this.feedback) {
      const key = `${f.category}/${f.patternName}`;
      const counts = patternCounts.get(key) || { good: 0, bad: 0 };
      if (f.rating === 'good') counts.good++;
      else if (f.rating === 'bad') counts.bad++;
      patternCounts.set(key, counts);
    }
    
    // Count bad files
    const fileCounts = new Map<string, number>();
    for (const f of this.feedback) {
      if (f.rating === 'bad' || f.rating === 'irrelevant') {
        fileCounts.set(f.file, (fileCounts.get(f.file) || 0) + 1);
      }
    }
    
    const topGoodPatterns = Array.from(patternCounts.entries())
      .filter(([, c]) => c.good > 0)
      .sort((a, b) => b[1].good - a[1].good)
      .slice(0, 5)
      .map(([pattern, counts]) => ({ pattern, count: counts.good }));
    
    const topBadPatterns = Array.from(patternCounts.entries())
      .filter(([, c]) => c.bad > 0)
      .sort((a, b) => b[1].bad - a[1].bad)
      .slice(0, 5)
      .map(([pattern, counts]) => ({ pattern, count: counts.bad }));
    
    const topBadFiles = Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));
    
    return {
      totalFeedback: this.feedback.length,
      goodExamples,
      badExamples,
      irrelevantExamples,
      topGoodPatterns,
      topBadPatterns,
      topBadFiles,
    };
  }

  /**
   * Get all feedback for export/analysis
   */
  async getAllFeedback(): Promise<ExampleFeedback[]> {
    await this.initialize();
    return [...this.feedback];
  }

  /**
   * Clear all feedback (for testing or reset)
   */
  async clearFeedback(): Promise<void> {
    this.feedback = [];
    this.locationScores = new Map();
    await this.saveFeedback();
    await this.saveScores();
  }
}
