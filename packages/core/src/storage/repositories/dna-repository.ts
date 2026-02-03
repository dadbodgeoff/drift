/**
 * DNA Repository - SQLite implementation
 *
 * Provides operations for component styling DNA profiles, genes, and mutations.
 *
 * @module storage/repositories/dna-repository
 */

import type Database from 'better-sqlite3';
import type {
  IDNARepository,
  DbDNAProfile,
  DbDNAGene,
  DbDNAMutation,
} from '../types.js';

// ============================================================================
// DNA Repository Implementation
// ============================================================================

export class DNARepository implements IDNARepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ==========================================================================
  // Profile
  // ==========================================================================

  async getProfile(): Promise<DbDNAProfile | null> {
    return (this.db
      .prepare('SELECT * FROM dna_profile WHERE id = 1')
      .get() as DbDNAProfile) ?? null;
  }

  async saveProfile(profile: DbDNAProfile): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO dna_profile 
      (id, version, generated_at, health_score, genetic_diversity, summary)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(
      profile.version,
      profile.generated_at,
      profile.health_score,
      profile.genetic_diversity,
      profile.summary
    );
  }

  // ==========================================================================
  // Genes
  // ==========================================================================

  async addGene(gene: DbDNAGene): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO dna_genes 
      (id, name, dominant_variant, frequency, confidence, variants, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      gene.id,
      gene.name,
      gene.dominant_variant,
      gene.frequency,
      gene.confidence,
      gene.variants,
      gene.evidence
    );
  }

  async getGene(id: string): Promise<DbDNAGene | null> {
    return (this.db
      .prepare('SELECT * FROM dna_genes WHERE id = ?')
      .get(id) as DbDNAGene) ?? null;
  }

  async getGenes(): Promise<DbDNAGene[]> {
    return this.db.prepare('SELECT * FROM dna_genes').all() as DbDNAGene[];
  }

  // ==========================================================================
  // Mutations
  // ==========================================================================

  async addMutation(mutation: DbDNAMutation): Promise<void> {
    this.db.prepare(`
      INSERT INTO dna_mutations 
      (gene_id, file, line, expected, actual, impact, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mutation.gene_id,
      mutation.file,
      mutation.line,
      mutation.expected,
      mutation.actual,
      mutation.impact,
      mutation.reason
    );
  }

  async getMutations(geneId?: string): Promise<DbDNAMutation[]> {
    if (geneId) {
      return this.db
        .prepare('SELECT * FROM dna_mutations WHERE gene_id = ?')
        .all(geneId) as DbDNAMutation[];
    }
    return this.db.prepare('SELECT * FROM dna_mutations').all() as DbDNAMutation[];
  }
}
