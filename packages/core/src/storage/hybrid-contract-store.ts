/**
 * Hybrid Contract Store
 *
 * A contract store that uses SQLite for storage.
 * This replaces the legacy JSON-based ContractStore.
 *
 * @module storage/hybrid-contract-store
 */

import { EventEmitter } from 'node:events';

import { UnifiedStore } from './unified-store.js';
import type {
  DbContract,
  DbContractFrontend,
  DbContractStatus,
  DbHttpMethod,
} from './types.js';
import type {
  Contract,
  ContractStatus,
  ContractQuery,
  ContractQueryOptions,
  ContractQueryResult,
  ContractStats,
  HttpMethod,
  FrontendApiCall,
  BackendEndpoint,
  FieldMismatch,
  ContractConfidence,
  ContractMetadata,
} from '../types/contracts.js';

// ============================================================================
// Configuration
// ============================================================================

export interface HybridContractStoreConfig {
  /** Root directory of the project */
  rootDir: string;
}

const DEFAULT_CONFIG: HybridContractStoreConfig = {
  rootDir: '.',
};

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert a DbContract to the Contract format
 */
function dbContractToContract(db: DbContract, frontends: DbContractFrontend[]): Contract {
  const backend: BackendEndpoint = {
    method: (db.backend_method as HttpMethod) ?? db.method,
    path: db.backend_path ?? db.endpoint,
    normalizedPath: db.backend_normalized_path ?? db.normalized_endpoint,
    file: db.backend_file ?? '',
    line: db.backend_line ?? 0,
    framework: db.backend_framework ?? '',
    responseFields: db.backend_response_fields ? JSON.parse(db.backend_response_fields) : [],
  };

  const frontend: FrontendApiCall[] = frontends.map(f => ({
    method: f.method as HttpMethod,
    path: f.path,
    normalizedPath: f.normalized_path,
    file: f.file,
    line: f.line,
    library: f.library ?? '',
    responseFields: f.response_fields ? JSON.parse(f.response_fields) : [],
  }));

  const confidence: ContractConfidence = {
    score: db.confidence_score,
    level: db.confidence_level as 'high' | 'medium' | 'low' | 'uncertain',
    matchConfidence: db.match_confidence ?? 0,
    fieldExtractionConfidence: db.field_extraction_confidence ?? 0,
  };

  const metadata: ContractMetadata = {
    firstSeen: db.first_seen,
    lastSeen: db.last_seen,
  };
  if (db.verified_at) metadata.verifiedAt = db.verified_at;
  if (db.verified_by) metadata.verifiedBy = db.verified_by;

  const mismatches: FieldMismatch[] = db.mismatches ? JSON.parse(db.mismatches) : [];

  return {
    id: db.id,
    method: db.method as HttpMethod,
    endpoint: db.endpoint,
    status: db.status as ContractStatus,
    backend,
    frontend,
    confidence,
    mismatches,
    metadata,
  };
}

/**
 * Convert a Contract to DbContract format
 */
function contractToDbContract(contract: Contract): DbContract {
  return {
    id: contract.id,
    method: contract.method as DbHttpMethod,
    endpoint: contract.endpoint,
    normalized_endpoint: contract.backend.normalizedPath,
    status: contract.status as DbContractStatus,
    backend_method: contract.backend.method,
    backend_path: contract.backend.path,
    backend_normalized_path: contract.backend.normalizedPath,
    backend_file: contract.backend.file,
    backend_line: contract.backend.line,
    backend_framework: contract.backend.framework ?? null,
    backend_response_fields: contract.backend.responseFields?.length 
      ? JSON.stringify(contract.backend.responseFields) 
      : null,
    confidence_score: contract.confidence.score,
    confidence_level: contract.confidence.level,
    match_confidence: contract.confidence.matchConfidence ?? null,
    field_extraction_confidence: contract.confidence.fieldExtractionConfidence ?? null,
    mismatches: contract.mismatches.length ? JSON.stringify(contract.mismatches) : null,
    first_seen: contract.metadata.firstSeen,
    last_seen: contract.metadata.lastSeen,
    verified_at: contract.metadata.verifiedAt ?? null,
    verified_by: contract.metadata.verifiedBy ?? null,
  };
}

/**
 * Convert Contract frontends to DbContractFrontend format
 */
function contractFrontendsToDb(contractId: string, frontends: FrontendApiCall[]): DbContractFrontend[] {
  return frontends.map(f => ({
    contract_id: contractId,
    method: f.method,
    path: f.path,
    normalized_path: f.normalizedPath,
    file: f.file,
    line: f.line,
    library: f.library ?? null,
    response_fields: f.responseFields?.length ? JSON.stringify(f.responseFields) : null,
  }));
}

// ============================================================================
// Hybrid Contract Store
// ============================================================================

/**
 * HybridContractStore - SQLite-backed contract storage
 */
export class HybridContractStore extends EventEmitter {
  private readonly config: HybridContractStoreConfig;
  private store: UnifiedStore | null = null;
  private initialized = false;
  private contractCache: Map<string, Contract> = new Map();

  constructor(config: Partial<HybridContractStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.store = new UnifiedStore({ rootDir: this.config.rootDir });
    await this.store.initialize();
    await this.loadAllToCache();

    this.initialized = true;
  }

  private async loadAllToCache(): Promise<void> {
    if (!this.store) return;

    this.contractCache.clear();
    const dbContracts = await this.store.contracts.findByStatus('discovered');
    const verified = await this.store.contracts.findByStatus('verified');
    const mismatch = await this.store.contracts.findByStatus('mismatch');
    const ignored = await this.store.contracts.findByStatus('ignored');

    const allContracts = [...dbContracts, ...verified, ...mismatch, ...ignored];

    for (const dbContract of allContracts) {
      const frontends = await this.store.contracts.getFrontends(dbContract.id);
      const contract = dbContractToContract(dbContract, frontends);
      this.contractCache.set(contract.id, contract);
    }
  }

  async close(): Promise<void> {
    if (this.store) {
      await this.store.close();
      this.store = null;
    }
    this.contractCache.clear();
    this.initialized = false;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  get(id: string): Contract | undefined {
    return this.contractCache.get(id);
  }

  getOrThrow(id: string): Contract {
    const contract = this.contractCache.get(id);
    if (!contract) {
      throw new Error(`Contract not found: ${id}`);
    }
    return contract;
  }

  has(id: string): boolean {
    return this.contractCache.has(id);
  }

  async add(contract: Contract): Promise<void> {
    if (!this.store) throw new Error('Store not initialized');
    if (this.contractCache.has(contract.id)) {
      throw new Error(`Contract already exists: ${contract.id}`);
    }

    const dbContract = contractToDbContract(contract);
    await this.store.contracts.create(dbContract);

    // Add frontends
    const frontends = contractFrontendsToDb(contract.id, contract.frontend);
    for (const frontend of frontends) {
      await this.store.contracts.addFrontend(contract.id, frontend);
    }

    this.contractCache.set(contract.id, contract);
    this.emit('contract:created', contract.id);
  }

  async update(id: string, updates: Partial<Omit<Contract, 'id'>>): Promise<Contract> {
    if (!this.store) throw new Error('Store not initialized');

    const existing = this.getOrThrow(id);
    const updated: Contract = { ...existing, ...updates, id };

    const dbUpdates = contractToDbContract(updated);
    await this.store.contracts.update(id, dbUpdates);

    this.contractCache.set(id, updated);
    this.emit('contract:updated', id);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.store) throw new Error('Store not initialized');

    const contract = this.contractCache.get(id);
    if (!contract) return false;

    await this.store.contracts.delete(id);
    this.contractCache.delete(id);
    this.emit('contract:deleted', id);
    return true;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  async verify(id: string, verifiedBy?: string): Promise<Contract> {
    if (!this.store) throw new Error('Store not initialized');

    const contract = this.getOrThrow(id);
    await this.store.contracts.verify(id, verifiedBy);

    const now = new Date().toISOString();
    const updated: Contract = {
      ...contract,
      status: 'verified',
      metadata: {
        ...contract.metadata,
        lastSeen: now,
        verifiedAt: now,
        ...(verifiedBy ? { verifiedBy } : {}),
      },
    };
    this.contractCache.set(id, updated);
    this.emit('contract:verified', id);
    return updated;
  }

  async markMismatch(id: string): Promise<Contract> {
    if (!this.store) throw new Error('Store not initialized');

    const contract = this.getOrThrow(id);
    await this.store.contracts.markMismatch(id);

    const updated: Contract = {
      ...contract,
      status: 'mismatch',
      metadata: {
        ...contract.metadata,
        lastSeen: new Date().toISOString(),
      },
    };
    this.contractCache.set(id, updated);
    this.emit('contract:mismatch', id);
    return updated;
  }

  async ignore(id: string): Promise<Contract> {
    if (!this.store) throw new Error('Store not initialized');

    const contract = this.getOrThrow(id);
    await this.store.contracts.ignore(id);

    const updated: Contract = {
      ...contract,
      status: 'ignored',
      metadata: {
        ...contract.metadata,
        lastSeen: new Date().toISOString(),
      },
    };
    this.contractCache.set(id, updated);
    this.emit('contract:ignored', id);
    return updated;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  query(options: ContractQueryOptions = {}): ContractQueryResult {
    const startTime = Date.now();
    const { filter, sort, pagination } = options;

    let results = Array.from(this.contractCache.values());

    if (filter) {
      results = this.applyFilters(results, filter);
    }

    const total = results.length;

    if (sort) {
      results = this.applySorting(results, sort);
    }

    const offset = pagination?.offset ?? 0;
    const limit = pagination?.limit ?? results.length;
    const hasMore = offset + limit < total;
    results = results.slice(offset, offset + limit);

    return {
      contracts: results,
      total,
      hasMore,
      executionTime: Date.now() - startTime,
    };
  }

  private applyFilters(contracts: Contract[], filter: ContractQuery): Contract[] {
    return contracts.filter((contract) => {
      if (filter.ids && !filter.ids.includes(contract.id)) return false;
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(contract.status)) return false;
      }
      if (filter.method) {
        const methods = Array.isArray(filter.method) ? filter.method : [filter.method];
        if (!methods.includes(contract.method)) return false;
      }
      if (filter.endpoint && !contract.endpoint.includes(filter.endpoint)) return false;
      if (filter.hasMismatches !== undefined) {
        const hasMismatches = contract.mismatches.length > 0;
        if (filter.hasMismatches !== hasMismatches) return false;
      }
      if (filter.minConfidence !== undefined && contract.confidence.score < filter.minConfidence) {
        return false;
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        if (!contract.endpoint.toLowerCase().includes(searchLower)) return false;
      }
      return true;
    });
  }

  private applySorting(contracts: Contract[], sort: { field: string; direction: 'asc' | 'desc' }): Contract[] {
    const multiplier = sort.direction === 'asc' ? 1 : -1;
    return [...contracts].sort((a, b) => {
      switch (sort.field) {
        case 'endpoint': return a.endpoint.localeCompare(b.endpoint) * multiplier;
        case 'method': return a.method.localeCompare(b.method) * multiplier;
        case 'confidence': return (a.confidence.score - b.confidence.score) * multiplier;
        case 'mismatchCount': return (a.mismatches.length - b.mismatches.length) * multiplier;
        default: return 0;
      }
    });
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  getAll(): Contract[] {
    return Array.from(this.contractCache.values());
  }

  getByStatus(status: ContractStatus): Contract[] {
    return this.query({ filter: { status } }).contracts;
  }

  getByMethod(method: HttpMethod): Contract[] {
    return this.query({ filter: { method } }).contracts;
  }

  getWithMismatches(): Contract[] {
    return this.query({ filter: { hasMismatches: true } }).contracts;
  }

  getVerified(): Contract[] {
    return this.getByStatus('verified');
  }

  getDiscovered(): Contract[] {
    return this.getByStatus('discovered');
  }

  getMismatched(): Contract[] {
    return this.getByStatus('mismatch');
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  getStats(): ContractStats {
    const contracts = Array.from(this.contractCache.values());

    const byStatus: Record<ContractStatus, number> = {
      discovered: 0,
      verified: 0,
      mismatch: 0,
      ignored: 0,
    };

    const byMethod: Record<HttpMethod, number> = {
      GET: 0,
      POST: 0,
      PUT: 0,
      PATCH: 0,
      DELETE: 0,
    };

    const mismatchesByType: Record<string, number> = {};
    let totalMismatches = 0;

    for (const contract of contracts) {
      byStatus[contract.status]++;
      byMethod[contract.method]++;
      totalMismatches += contract.mismatches.length;

      for (const mismatch of contract.mismatches) {
        mismatchesByType[mismatch.mismatchType] = (mismatchesByType[mismatch.mismatchType] || 0) + 1;
      }
    }

    return {
      totalContracts: contracts.length,
      byStatus,
      byMethod,
      totalMismatches,
      mismatchesByType,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  async saveAll(): Promise<void> {
    // SQLite saves are immediate
    if (this.store) {
      await this.store.checkpoint();
    }
  }

  async loadAll(): Promise<void> {
    await this.loadAllToCache();
  }
}
