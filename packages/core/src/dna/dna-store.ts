import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DEFAULT_DNA_STORE_CONFIG } from './types.js';

import type { StylingDNAProfile, DNAStoreConfig, EvolutionEntry } from './types.js';

export type DNAStoreEvents = 'saved' | 'loaded' | 'error';

export class DNAStore {
  private readonly config: DNAStoreConfig;
  private profile: StylingDNAProfile | null = null;

  constructor(config: Partial<DNAStoreConfig> = {}) { this.config = { ...DEFAULT_DNA_STORE_CONFIG, ...config }; }

  async initialize(): Promise<void> {
    const dnaDir = path.join(this.config.rootDir, '.drift', 'dna');
    await fs.mkdir(dnaDir, { recursive: true });
    await this.load();
  }

  async load(): Promise<StylingDNAProfile | null> {
    const filePath = path.join(this.config.rootDir, '.drift', 'dna', 'styling.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.profile = JSON.parse(content) as StylingDNAProfile;
      return this.profile;
    } catch { return null; }
  }

  async save(profile: StylingDNAProfile): Promise<void> {
    const dnaDir = path.join(this.config.rootDir, '.drift', 'dna');
    await fs.mkdir(dnaDir, { recursive: true });
    const filePath = path.join(dnaDir, 'styling.json');
    if (this.profile) {
      const entry: EvolutionEntry = {
        timestamp: new Date().toISOString(),
        healthScore: profile.summary.healthScore,
        geneticDiversity: profile.summary.geneticDiversity,
        changes: [],
      };
      profile.evolution = [...(this.profile.evolution ?? []), entry].slice(-50);
    }
    this.profile = profile;
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2));
  }

  getProfile(): StylingDNAProfile | null { return this.profile; }
  getConfig(): DNAStoreConfig { return this.config; }
}
