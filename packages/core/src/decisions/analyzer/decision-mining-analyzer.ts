/**
 * Decision Mining Analyzer
 *
 * Main orchestrator for mining architectural decisions from git history.
 * Coordinates git walking, semantic extraction, clustering, and synthesis.
 */

import {
  createAllCommitExtractors,
  type CommitExtractorOptions,
} from '../extractors/index.js';
import {
  GitWalker,
  createGitWalker,
  type GitWalkResult,
} from '../git/index.js';

import type {
  GitCommit,
  CommitSemanticExtraction,
  CommitCluster,
  MinedDecision,
  DecisionMiningResult,
  DecisionMiningSummary,
  DecisionMiningOptions,
  DecisionLanguage,
  DecisionCategory,
  DecisionConfidence,
  DecisionStatus,
  MiningError,
} from '../types.js';

// ============================================================================
// Analyzer Class
// ============================================================================

/**
 * Decision Mining Analyzer
 */
export class DecisionMiningAnalyzer {
  private options: DecisionMiningOptions;
  private gitWalker: GitWalker;
  private extractors: ReturnType<typeof createAllCommitExtractors>;

  constructor(options: DecisionMiningOptions) {
    this.options = {
      maxCommits: 1000,
      minClusterSize: 2,
      minConfidence: 0.5,
      includeMergeCommits: false,
      verbose: false,
      ...options,
    };

    // Build git walker options, only including defined values
    const walkerOpts: Parameters<typeof createGitWalker>[0] = {
      rootDir: options.rootDir,
    };
    if (options.since !== undefined) {walkerOpts.since = options.since;}
    if (options.until !== undefined) {walkerOpts.until = options.until;}
    if (options.maxCommits !== undefined) {walkerOpts.maxCommits = options.maxCommits;}
    if (options.includeMergeCommits !== undefined) {walkerOpts.includeMergeCommits = options.includeMergeCommits;}
    if (options.excludePaths !== undefined) {walkerOpts.excludePaths = options.excludePaths;}
    
    this.gitWalker = createGitWalker(walkerOpts);

    // Build extractor options, only including defined values
    const extractorOptions: CommitExtractorOptions = {
      rootDir: options.rootDir,
      includeFunctions: true,
    };
    if (options.usePatternData !== undefined) {extractorOptions.includePatterns = options.usePatternData;}
    if (options.verbose !== undefined) {extractorOptions.verbose = options.verbose;}

    this.extractors = createAllCommitExtractors(extractorOptions);
  }

  /**
   * Run the full decision mining pipeline
   */
  async mine(): Promise<DecisionMiningResult> {
    const startTime = Date.now();
    const errors: MiningError[] = [];
    const warnings: string[] = [];

    // Step 1: Walk git history
    if (this.options.verbose) {
      console.log('Step 1: Walking git history...');
    }

    let walkResult: GitWalkResult;
    try {
      walkResult = await this.gitWalker.walk();
    } catch (error) {
      const miningError: MiningError = {
        type: 'git-error',
        message: `Failed to walk git history: ${error}`,
      };
      if (error instanceof Error && error.stack) {
        miningError.stack = error.stack;
      }
      return this.createErrorResult([miningError]);
    }

    if (walkResult.commits.length === 0) {
      warnings.push('No commits found in the specified range');
      return this.createEmptyResult(warnings);
    }

    if (this.options.verbose) {
      console.log(`  Found ${walkResult.commits.length} commits`);
    }

    // Step 2: Extract semantic information from each commit
    if (this.options.verbose) {
      console.log('Step 2: Extracting semantic information...');
    }

    const extractions: CommitSemanticExtraction[] = [];
    for (const commit of walkResult.commits) {
      try {
        const extraction = await this.extractCommit(commit);
        extractions.push(extraction);
      } catch (error) {
        errors.push({
          type: 'extraction-error',
          message: `Failed to extract commit ${commit.shortSha}: ${error}`,
          commitSha: commit.sha,
        });
      }
    }

    // Filter to significant commits
    const significantExtractions = extractions.filter(
      e => e.significance >= (this.options.minConfidence || 0.5)
    );

    if (this.options.verbose) {
      console.log(`  ${significantExtractions.length} significant commits`);
    }

    // Step 3: Cluster related commits
    if (this.options.verbose) {
      console.log('Step 3: Clustering commits...');
    }

    const { clusters, rejected } = this.clusterCommits(significantExtractions);

    if (this.options.verbose) {
      console.log(`  ${clusters.length} clusters formed`);
    }

    // Step 4: Synthesize decisions from clusters
    if (this.options.verbose) {
      console.log('Step 4: Synthesizing decisions...');
    }

    const decisions: MinedDecision[] = [];
    for (const cluster of clusters) {
      try {
        const decision = this.synthesizeDecision(cluster, extractions);
        if (decision.confidenceScore >= (this.options.minConfidence || 0.5)) {
          decisions.push(decision);
        }
      } catch (error) {
        errors.push({
          type: 'synthesis-error',
          message: `Failed to synthesize decision from cluster: ${error}`,
        });
      }
    }

    // Step 5: Build summary
    const summary = this.buildSummary(
      decisions,
      walkResult,
      extractions,
      Date.now() - startTime
    );

    return {
      decisions,
      summary,
      rejectedClusters: rejected,
      errors,
      warnings,
    };
  }

  /**
   * Extract semantic information from a single commit
   */
  private async extractCommit(commit: GitCommit): Promise<CommitSemanticExtraction> {
    // Determine primary language
    const languageCounts = new Map<DecisionLanguage, number>();
    
    for (const file of commit.files) {
      if (file.language !== 'other' && file.language !== 'config' && file.language !== 'docs') {
        const lang = file.language;
        languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
      }
    }

    // Find primary language
    let primaryLanguage: DecisionLanguage | 'mixed' | 'other' = 'other';
    let maxCount = 0;
    
    for (const [lang, count] of languageCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryLanguage = lang;
      }
    }

    if (languageCounts.size > 1 && maxCount < commit.files.length * 0.7) {
      primaryLanguage = 'mixed';
    }

    // Use appropriate extractor
    if (primaryLanguage !== 'mixed' && primaryLanguage !== 'other') {
      const extractor = this.extractors.get(primaryLanguage);
      if (extractor) {
        return extractor.extract(commit);
      }
    }

    // For mixed or other, use TypeScript extractor as fallback
    const tsExtractor = this.extractors.get('typescript')!;
    return tsExtractor.extract(commit);
  }

  /**
   * Cluster related commits together
   */
  private clusterCommits(
    extractions: CommitSemanticExtraction[]
  ): { clusters: CommitCluster[]; rejected: CommitCluster[] } {
    const clusters: CommitCluster[] = [];
    const rejected: CommitCluster[] = [];
    const used = new Set<string>();

    // Sort by date
    const sorted = [...extractions].sort(
      (a, b) => a.commit.date.getTime() - b.commit.date.getTime()
    );

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (!current || used.has(current.commit.sha)) {continue;}

      const cluster = this.buildCluster(sorted, i, used);
      
      if (cluster.commits.length >= (this.options.minClusterSize || 2)) {
        clusters.push(cluster);
      } else if (cluster.commits.length > 0) {
        rejected.push(cluster);
      }
    }

    return { clusters, rejected };
  }

  /**
   * Build a cluster starting from a seed commit
   */
  private buildCluster(
    extractions: CommitSemanticExtraction[],
    seedIndex: number,
    used: Set<string>
  ): CommitCluster {
    const seed = extractions[seedIndex];
    if (!seed) {
      // Return empty cluster if seed is undefined
      return this.createEmptyCluster();
    }
    
    const clusterExtractions: CommitSemanticExtraction[] = [seed];
    used.add(seed.commit.sha);

    // Look for related commits within temporal window
    const temporalThreshold = 14 * 24 * 60 * 60 * 1000; // 14 days

    for (let j = seedIndex + 1; j < extractions.length; j++) {
      const candidate = extractions[j];
      if (!candidate || used.has(candidate.commit.sha)) {continue;}

      // Check temporal proximity
      const timeDiff = candidate.commit.date.getTime() - seed.commit.date.getTime();
      if (timeDiff > temporalThreshold) {break;}

      // Check similarity
      const similarity = this.calculateSimilarity(seed, candidate);
      if (similarity >= 0.3) {
        clusterExtractions.push(candidate);
        used.add(candidate.commit.sha);
      }
    }

    return this.createCluster(clusterExtractions);
  }

  /**
   * Create an empty cluster (for edge cases)
   */
  private createEmptyCluster(): CommitCluster {
    return {
      id: 'empty-cluster',
      commits: [],
      commitShas: new Set(),
      clusterReasons: [],
      similarity: 0,
      dateRange: { start: new Date(), end: new Date() },
      duration: '0 days',
      filesAffected: [],
      languages: [],
      primaryLanguage: 'mixed',
      totalLinesChanged: 0,
      authors: [],
      patternsAffected: [],
      dependencyChanges: [],
    };
  }

  /**
   * Calculate similarity between two extractions
   */
  private calculateSimilarity(
    a: CommitSemanticExtraction,
    b: CommitSemanticExtraction
  ): number {
    let score = 0;
    let weights = 0;

    // File overlap
    const aFiles = new Set(a.commit.files.map(f => f.path));
    const bFiles = new Set(b.commit.files.map(f => f.path));
    const overlap = [...aFiles].filter(f => bFiles.has(f)).length;
    const fileOverlap = overlap / Math.max(aFiles.size, bFiles.size);
    score += fileOverlap * 0.4;
    weights += 0.4;

    // Pattern similarity
    const aPatterns = new Set(a.patternsAffected.map(p => p.patternId));
    const bPatterns = new Set(b.patternsAffected.map(p => p.patternId));
    if (aPatterns.size > 0 && bPatterns.size > 0) {
      const patternOverlap = [...aPatterns].filter(p => bPatterns.has(p)).length;
      const patternSim = patternOverlap / Math.max(aPatterns.size, bPatterns.size);
      score += patternSim * 0.3;
      weights += 0.3;
    }

    // Message keyword similarity
    const aKeywords = new Set(a.messageSignals.filter(s => s.type === 'keyword').map(s => s.value));
    const bKeywords = new Set(b.messageSignals.filter(s => s.type === 'keyword').map(s => s.value));
    if (aKeywords.size > 0 && bKeywords.size > 0) {
      const keywordOverlap = [...aKeywords].filter(k => bKeywords.has(k)).length;
      const keywordSim = keywordOverlap / Math.max(aKeywords.size, bKeywords.size);
      score += keywordSim * 0.2;
      weights += 0.2;
    }

    // Author similarity
    if (a.commit.authorEmail === b.commit.authorEmail) {
      score += 0.1;
    }
    weights += 0.1;

    return weights > 0 ? score / weights : 0;
  }

  /**
   * Create a cluster from extractions
   */
  private createCluster(extractions: CommitSemanticExtraction[]): CommitCluster {
    const commits = extractions.map(e => e.commit);
    const dates = commits.map(c => c.date.getTime());
    const start = new Date(Math.min(...dates));
    const end = new Date(Math.max(...dates));
    const durationMs = end.getTime() - start.getTime();

    // Aggregate files
    const filesSet = new Set<string>();
    for (const e of extractions) {
      for (const f of e.commit.files) {
        filesSet.add(f.path);
      }
    }

    // Aggregate languages
    const languagesSet = new Set<DecisionLanguage>();
    for (const e of extractions) {
      for (const lang of e.languagesAffected) {
        languagesSet.add(lang);
      }
    }

    // Aggregate patterns
    const patternsMap = new Map<string, typeof extractions[0]['patternsAffected'][0]>();
    for (const e of extractions) {
      for (const p of e.patternsAffected) {
        if (!patternsMap.has(p.patternId)) {
          patternsMap.set(p.patternId, p);
        }
      }
    }

    // Aggregate dependencies
    const depsMap = new Map<string, typeof extractions[0]['dependencyChanges'][0]>();
    for (const e of extractions) {
      for (const d of e.dependencyChanges) {
        if (!depsMap.has(d.name)) {
          depsMap.set(d.name, d);
        }
      }
    }

    // Calculate total lines changed
    const totalLines = commits.reduce(
      (sum, c) => sum + c.files.reduce((s, f) => s + f.additions + f.deletions, 0),
      0
    );

    // Get unique authors
    const authors = [...new Set(commits.map(c => c.authorName))];

    // Determine primary language
    const langCounts = new Map<DecisionLanguage, number>();
    for (const lang of languagesSet) {
      langCounts.set(lang, extractions.filter(e => e.primaryLanguage === lang).length);
    }
    let primaryLang: DecisionLanguage | 'mixed' = 'mixed';
    let maxLangCount = 0;
    for (const [lang, count] of langCounts) {
      if (count > maxLangCount) {
        maxLangCount = count;
        primaryLang = lang;
      }
    }

    // Build cluster reasons
    const reasons: CommitCluster['clusterReasons'] = [];
    
    // Temporal reason
    const daySpan = Math.ceil(durationMs / (24 * 60 * 60 * 1000));
    reasons.push({
      type: 'temporal',
      description: `Commits span ${daySpan} days`,
      daysSpan: daySpan,
    });

    // File overlap reason
    if (filesSet.size < commits.length * 3) {
      reasons.push({
        type: 'file-overlap',
        files: [...filesSet].slice(0, 5),
        overlapPercent: filesSet.size / (commits.length * 3),
      });
    }

    return {
      id: `cluster-${commits[0]?.shortSha ?? 'unknown'}-${commits.length}`,
      commits,
      commitShas: new Set(commits.map(c => c.sha)),
      clusterReasons: reasons,
      similarity: 0.5, // Placeholder
      dateRange: { start, end },
      duration: this.formatDuration(durationMs),
      filesAffected: [...filesSet],
      languages: [...languagesSet],
      primaryLanguage: primaryLang,
      totalLinesChanged: totalLines,
      authors,
      patternsAffected: [...patternsMap.values()],
      dependencyChanges: [...depsMap.values()],
    };
  }

  /**
   * Synthesize a decision from a cluster
   */
  private synthesizeDecision(
    cluster: CommitCluster,
    allExtractions: CommitSemanticExtraction[]
  ): MinedDecision {
    // Get extractions for this cluster
    const clusterExtractions = allExtractions.filter(
      e => cluster.commitShas.has(e.commit.sha)
    );

    // Determine category from signals
    const category = this.inferCategory(clusterExtractions);

    // Generate title
    const title = this.generateTitle(cluster, clusterExtractions, category);

    // Calculate confidence
    const confidenceScore = this.calculateConfidence(cluster, clusterExtractions);
    const confidence = this.scoreToLevel(confidenceScore);

    // Generate ADR content
    const adr = this.generateADR(cluster, clusterExtractions, category);

    // Generate decision ID
    const id = `DEC-${cluster.commits[0]?.shortSha?.toUpperCase() ?? 'UNKNOWN'}`;

    return {
      id,
      title,
      status: 'draft',
      category,
      confidence,
      confidenceScore,
      dateRange: cluster.dateRange,
      duration: cluster.duration,
      cluster,
      patternsChanged: cluster.patternsAffected,
      dependenciesChanged: cluster.dependencyChanges,
      adr,
      currentCodeLocations: [], // Would need call graph integration
      relatedDecisions: [],
      tags: this.generateTags(cluster, category),
      minedAt: new Date(),
      lastUpdated: new Date(),
    };
  }

  /**
   * Infer decision category from extractions
   */
  private inferCategory(extractions: CommitSemanticExtraction[]): DecisionCategory {
    const categoryCounts = new Map<DecisionCategory, number>();

    for (const e of extractions) {
      // From message signals
      for (const signal of e.messageSignals) {
        if (signal.categoryHint) {
          categoryCounts.set(
            signal.categoryHint,
            (categoryCounts.get(signal.categoryHint) || 0) + signal.confidence
          );
        }
      }

      // From architectural signals
      for (const signal of e.architecturalSignals) {
        const category = this.signalTypeToCategory(signal.type);
        if (category) {
          categoryCounts.set(
            category,
            (categoryCounts.get(category) || 0) + signal.confidence
          );
        }
      }

      // From dependency changes
      if (e.dependencyChanges.length > 0) {
        const hasAdded = e.dependencyChanges.some(d => d.changeType === 'added');
        const hasRemoved = e.dependencyChanges.some(d => d.changeType === 'removed');
        
        if (hasAdded && !hasRemoved) {
          categoryCounts.set('technology-adoption', (categoryCounts.get('technology-adoption') || 0) + 0.5);
        } else if (hasRemoved && !hasAdded) {
          categoryCounts.set('technology-removal', (categoryCounts.get('technology-removal') || 0) + 0.5);
        }
      }
    }

    // Find highest scoring category
    let maxCategory: DecisionCategory = 'other';
    let maxScore = 0;

    for (const [category, score] of categoryCounts) {
      if (score > maxScore) {
        maxScore = score;
        maxCategory = category;
      }
    }

    return maxCategory;
  }

  /**
   * Map architectural signal type to decision category
   */
  private signalTypeToCategory(signalType: string): DecisionCategory | null {
    const mapping: Record<string, DecisionCategory> = {
      'new-abstraction': 'pattern-introduction',
      'layer-change': 'architecture-change',
      'api-surface-change': 'api-change',
      'data-model-change': 'architecture-change',
      'config-change': 'infrastructure',
      'build-change': 'infrastructure',
      'test-strategy-change': 'testing-strategy',
      'error-handling-change': 'pattern-introduction',
      'auth-change': 'security-enhancement',
      'integration-change': 'technology-adoption',
    };

    return mapping[signalType] || null;
  }

  /**
   * Generate a title for the decision
   */
  private generateTitle(
    cluster: CommitCluster,
    extractions: CommitSemanticExtraction[],
    category: DecisionCategory
  ): string {
    // Try to extract from commit messages
    const keywords = new Set<string>();
    for (const e of extractions) {
      for (const signal of e.messageSignals) {
        if (signal.type === 'keyword') {
          keywords.add(signal.value);
        }
      }
    }

    // Use first commit subject as base
    const firstCommit = cluster.commits[0];
    const firstSubject = firstCommit?.subject ?? 'Unknown change';

    // If we have good keywords, use them
    if (keywords.size > 0) {
      const keywordList = [...keywords].slice(0, 3).join(', ');
      return `${this.categoryToVerb(category)} ${keywordList}`;
    }

    // Fall back to first commit subject
    if (firstSubject.length < 60) {
      return firstSubject;
    }

    return `${this.categoryToVerb(category)} (${cluster.commits.length} commits)`;
  }

  /**
   * Convert category to action verb
   */
  private categoryToVerb(category: DecisionCategory): string {
    const verbs: Record<DecisionCategory, string> = {
      'technology-adoption': 'Adopt',
      'technology-removal': 'Remove',
      'pattern-introduction': 'Introduce',
      'pattern-migration': 'Migrate',
      'architecture-change': 'Restructure',
      'api-change': 'Update API',
      'security-enhancement': 'Enhance security',
      'performance-optimization': 'Optimize',
      'refactoring': 'Refactor',
      'testing-strategy': 'Update testing',
      'infrastructure': 'Update infrastructure',
      'other': 'Change',
    };

    return verbs[category] || 'Change';
  }

  /**
   * Calculate confidence score for a decision
   */
  private calculateConfidence(
    cluster: CommitCluster,
    extractions: CommitSemanticExtraction[]
  ): number {
    let score = 0;

    // Cluster size (more commits = more confidence)
    score += Math.min(0.2, cluster.commits.length * 0.05);

    // Average extraction significance
    const avgSignificance = extractions.reduce((s, e) => s + e.significance, 0) / extractions.length;
    score += avgSignificance * 0.3;

    // Architectural signals present
    const hasArchSignals = extractions.some(e => e.architecturalSignals.length > 0);
    if (hasArchSignals) {
      score += 0.2;
    }

    // Dependency changes present
    const hasDeps = cluster.dependencyChanges.length > 0;
    if (hasDeps) {
      score += 0.15;
    }

    // Pattern changes present
    const hasPatterns = cluster.patternsAffected.length > 0;
    if (hasPatterns) {
      score += 0.15;
    }

    return Math.min(1, score);
  }

  /**
   * Convert numeric score to confidence level
   */
  private scoreToLevel(score: number): DecisionConfidence {
    if (score >= 0.7) {return 'high';}
    if (score >= 0.4) {return 'medium';}
    return 'low';
  }

  /**
   * Generate ADR content
   */
  private generateADR(
    cluster: CommitCluster,
    extractions: CommitSemanticExtraction[],
    category: DecisionCategory
  ): MinedDecision['adr'] {
    // Generate context
    const context = this.generateContext(cluster, extractions, category);

    // Generate decision statement
    const decision = this.generateDecisionStatement(cluster, extractions, category);

    // Generate consequences
    const consequences = this.generateConsequences(cluster, extractions);

    // Build references
    const references = cluster.commits.map(c => ({
      type: 'commit' as const,
      id: c.sha,
      title: c.subject,
    }));

    // Build evidence
    const evidence = this.buildEvidence(cluster, extractions);

    return {
      context,
      decision,
      consequences,
      references,
      evidence,
    };
  }

  /**
   * Generate context section
   */
  private generateContext(
    cluster: CommitCluster,
    _extractions: CommitSemanticExtraction[],
    category: DecisionCategory
  ): string {
    const parts: string[] = [];

    // Time context
    parts.push(
      `Between ${cluster.dateRange.start.toLocaleDateString()} and ${cluster.dateRange.end.toLocaleDateString()}, ` +
      `${cluster.commits.length} commits were made affecting ${cluster.filesAffected.length} files.`
    );

    // Category-specific context
    switch (category) {
      case 'technology-adoption':
        if (cluster.dependencyChanges.length > 0) {
          const added = cluster.dependencyChanges.filter(d => d.changeType === 'added');
          if (added.length > 0) {
            parts.push(`New dependencies were introduced: ${added.map(d => d.name).join(', ')}.`);
          }
        }
        break;
      case 'technology-removal':
        if (cluster.dependencyChanges.length > 0) {
          const removed = cluster.dependencyChanges.filter(d => d.changeType === 'removed');
          if (removed.length > 0) {
            parts.push(`Dependencies were removed: ${removed.map(d => d.name).join(', ')}.`);
          }
        }
        break;
      case 'architecture-change':
        parts.push(`Architectural changes were made across ${cluster.languages.join(', ')} code.`);
        break;
      case 'api-change':
        parts.push('API surface changes were detected in the codebase.');
        break;
      default:
        parts.push(`Changes were made primarily in ${cluster.primaryLanguage} code.`);
    }

    return parts.join(' ');
  }

  /**
   * Generate decision statement
   */
  private generateDecisionStatement(
    cluster: CommitCluster,
    _extractions: CommitSemanticExtraction[],
    category: DecisionCategory
  ): string {
    // Use first commit message as base
    const firstCommit = cluster.commits[0];
    
    // Try to extract meaningful decision from commit messages
    const subjects = cluster.commits.map(c => c.subject);
    
    // Find common theme
    if (subjects.length === 1) {
      return subjects[0] ?? 'Unknown change';
    }

    // Summarize based on category
    switch (category) {
      case 'technology-adoption':
        return `Adopt new technology/library as indicated by dependency additions and code changes.`;
      case 'technology-removal':
        return `Remove deprecated technology/library and migrate to alternatives.`;
      case 'pattern-introduction':
        return `Introduce new coding pattern or abstraction across the codebase.`;
      case 'architecture-change':
        return `Restructure code architecture affecting ${cluster.filesAffected.length} files.`;
      case 'api-change':
        return `Modify API surface with changes to endpoints or contracts.`;
      case 'security-enhancement':
        return `Enhance security measures in authentication or authorization.`;
      case 'refactoring':
        return `Refactor code for improved maintainability without changing behavior.`;
      default:
        return firstCommit?.subject ?? 'Unknown change';
    }
  }

  /**
   * Generate consequences
   */
  private generateConsequences(
    cluster: CommitCluster,
    _extractions: CommitSemanticExtraction[]
  ): string[] {
    const consequences: string[] = [];

    // Files affected
    consequences.push(`${cluster.filesAffected.length} files were modified.`);

    // Lines changed
    consequences.push(`${cluster.totalLinesChanged} lines of code were changed.`);

    // Dependency impact
    if (cluster.dependencyChanges.length > 0) {
      consequences.push(`${cluster.dependencyChanges.length} dependency changes were made.`);
    }

    // Pattern impact
    if (cluster.patternsAffected.length > 0) {
      consequences.push(`${cluster.patternsAffected.length} code patterns were affected.`);
    }

    return consequences;
  }

  /**
   * Build evidence for the ADR
   */
  private buildEvidence(
    cluster: CommitCluster,
    _extractions: CommitSemanticExtraction[]
  ): MinedDecision['adr']['evidence'] {
    const evidence: MinedDecision['adr']['evidence'] = [];

    // Commit message evidence
    for (const commit of cluster.commits.slice(0, 3)) {
      evidence.push({
        type: 'commit-message',
        description: commit.subject,
        source: commit.sha,
        confidence: 0.7,
      });
    }

    // Dependency change evidence
    for (const dep of cluster.dependencyChanges.slice(0, 3)) {
      evidence.push({
        type: 'dependency-change',
        description: `${dep.changeType}: ${dep.name}`,
        source: dep.sourceFile,
        confidence: 0.8,
      });
    }

    // Pattern change evidence
    for (const pattern of cluster.patternsAffected.slice(0, 3)) {
      evidence.push({
        type: 'pattern-change',
        description: `${pattern.changeType}: ${pattern.patternName}`,
        source: pattern.filesAffected[0] ?? 'unknown',
        confidence: 0.6,
      });
    }

    return evidence;
  }

  /**
   * Generate tags for the decision
   */
  private generateTags(cluster: CommitCluster, category: DecisionCategory): string[] {
    const tags: string[] = [category];

    // Add language tags
    for (const lang of cluster.languages) {
      tags.push(lang);
    }

    // Add author tags if single author
    if (cluster.authors.length === 1) {
      tags.push(`author:${cluster.authors[0]}`);
    }

    return tags;
  }

  /**
   * Build summary statistics
   */
  private buildSummary(
    decisions: MinedDecision[],
    walkResult: GitWalkResult,
    extractions: CommitSemanticExtraction[],
    duration: number
  ): DecisionMiningSummary {
    const byStatus: Record<DecisionStatus, number> = {
      draft: 0,
      confirmed: 0,
      superseded: 0,
      rejected: 0,
    };

    const byCategory: Record<DecisionCategory, number> = {
      'technology-adoption': 0,
      'technology-removal': 0,
      'pattern-introduction': 0,
      'pattern-migration': 0,
      'architecture-change': 0,
      'api-change': 0,
      'security-enhancement': 0,
      'performance-optimization': 0,
      'refactoring': 0,
      'testing-strategy': 0,
      'infrastructure': 0,
      'other': 0,
    };

    const byConfidence: Record<DecisionConfidence, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };

    const byLanguage: Record<DecisionLanguage | 'mixed', number> = {
      typescript: 0,
      javascript: 0,
      python: 0,
      java: 0,
      csharp: 0,
      php: 0,
      rust: 0,
      cpp: 0,
      mixed: 0,
    };

    // Count decisions
    for (const decision of decisions) {
      byStatus[decision.status]++;
      byCategory[decision.category]++;
      byConfidence[decision.confidence]++;
      byLanguage[decision.cluster.primaryLanguage]++;
    }

    // Calculate top patterns
    const patternCounts = new Map<string, number>();
    for (const decision of decisions) {
      for (const pattern of decision.patternsChanged) {
        patternCounts.set(
          pattern.patternName,
          (patternCounts.get(pattern.patternName) || 0) + 1
        );
      }
    }
    const topPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // Calculate top dependencies
    const depCounts = new Map<string, number>();
    for (const decision of decisions) {
      for (const dep of decision.dependenciesChanged) {
        depCounts.set(dep.name, (depCounts.get(dep.name) || 0) + 1);
      }
    }
    const topDependencies = [...depCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([dependency, count]) => ({ dependency, count }));

    // Calculate average cluster size
    const avgClusterSize = decisions.length > 0
      ? decisions.reduce((sum, d) => sum + d.cluster.commits.length, 0) / decisions.length
      : 0;

    // Count significant commits
    const significantCommits = extractions.filter(
      e => e.significance >= (this.options.minConfidence || 0.5)
    ).length;

    return {
      totalDecisions: decisions.length,
      byStatus,
      byCategory,
      byConfidence,
      byLanguage,
      dateRange: walkResult.dateRange,
      totalCommitsAnalyzed: walkResult.commits.length,
      significantCommits,
      avgClusterSize,
      topPatterns,
      topDependencies,
      miningDuration: duration,
      lastMined: new Date(),
    };
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''}`;
    }
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    return 'less than an hour';
  }

  /**
   * Create an error result
   */
  private createErrorResult(errors: MiningError[]): DecisionMiningResult {
    return {
      decisions: [],
      summary: this.createEmptySummary(),
      rejectedClusters: [],
      errors,
      warnings: [],
    };
  }

  /**
   * Create an empty result
   */
  private createEmptyResult(warnings: string[]): DecisionMiningResult {
    return {
      decisions: [],
      summary: this.createEmptySummary(),
      rejectedClusters: [],
      errors: [],
      warnings,
    };
  }

  /**
   * Create an empty summary
   */
  private createEmptySummary(): DecisionMiningSummary {
    return {
      totalDecisions: 0,
      byStatus: { draft: 0, confirmed: 0, superseded: 0, rejected: 0 },
      byCategory: {
        'technology-adoption': 0,
        'technology-removal': 0,
        'pattern-introduction': 0,
        'pattern-migration': 0,
        'architecture-change': 0,
        'api-change': 0,
        'security-enhancement': 0,
        'performance-optimization': 0,
        'refactoring': 0,
        'testing-strategy': 0,
        'infrastructure': 0,
        'other': 0,
      },
      byConfidence: { high: 0, medium: 0, low: 0 },
      byLanguage: {
        typescript: 0,
        javascript: 0,
        python: 0,
        java: 0,
        csharp: 0,
        php: 0,
        rust: 0,
        cpp: 0,
        mixed: 0,
      },
      dateRange: { earliest: new Date(), latest: new Date() },
      totalCommitsAnalyzed: 0,
      significantCommits: 0,
      avgClusterSize: 0,
      topPatterns: [],
      topDependencies: [],
      miningDuration: 0,
      lastMined: new Date(),
    };
  }
}

/**
 * Create a decision mining analyzer
 */
export function createDecisionMiningAnalyzer(
  options: DecisionMiningOptions
): DecisionMiningAnalyzer {
  return new DecisionMiningAnalyzer(options);
}
