/**
 * Contract Store - Contract persistence and querying
 *
 * @deprecated This class uses the legacy JSON-based storage format.
 * Use `HybridContractStore` from `@drift/core/storage` instead,
 * which provides SQLite-backed storage with better performance.
 *
 * For new code, use the factory function:
 * ```typescript
 * import { createContractStore } from '@drift/core/storage';
 * const store = await createContractStore({ rootDir: '/path/to/project' });
 * ```
 *
 * Migration: Run `drift migrate-storage` to convert to SQLite format.
 *
 * Loads and saves contracts to .drift/contracts/ directory.
 * Supports querying by status, method, endpoint, and mismatches.
 * Handles contract state transitions (discovered → verified/mismatch/ignored).
 */

import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { CONTRACT_FILE_VERSION } from '../types/contracts.js';

import type {
  Contract,
  ContractFile,
  StoredContract,
  ContractStatus,
  ContractQuery,
  ContractQueryOptions,
  ContractQueryResult,
  ContractSortOptions,
  ContractStats,
  HttpMethod,
} from '../types/contracts.js';


// ============================================================================
// Constants
// ============================================================================

const DRIFT_DIR = '.drift';
const CONTRACTS_DIR = 'contracts';

const STATUS_DIRS: Record<ContractStatus, string> = {
  discovered: 'discovered',
  verified: 'verified',
  mismatch: 'mismatch',
  ignored: 'ignored',
};

const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  discovered: ['verified', 'mismatch', 'ignored'],
  verified: ['mismatch', 'ignored'],
  mismatch: ['verified', 'ignored'],
  ignored: ['verified', 'mismatch'],
};

// ============================================================================
// Error Classes
// ============================================================================

export class ContractNotFoundError extends Error {
  constructor(public readonly contractId: string) {
    super(`Contract not found: ${contractId}`);
    this.name = 'ContractNotFoundError';
  }
}

export class InvalidContractTransitionError extends Error {
  constructor(
    public readonly contractId: string,
    public readonly fromStatus: ContractStatus,
    public readonly toStatus: ContractStatus
  ) {
    super(`Invalid state transition for contract ${contractId}: ${fromStatus} → ${toStatus}`);
    this.name = 'InvalidContractTransitionError';
  }
}

export class ContractStoreError extends Error {
  public readonly errorCause: Error | undefined;
  
  constructor(message: string, errorCause?: Error) {
    super(message);
    this.name = 'ContractStoreError';
    this.errorCause = errorCause;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function contractToStored(contract: Contract): StoredContract {
  const { status, ...stored } = contract;
  return stored;
}

function storedToContract(stored: StoredContract, status: ContractStatus): Contract {
  return { ...stored, status };
}

function generateChecksum(contracts: StoredContract[]): string {
  const content = JSON.stringify(contracts);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

// ============================================================================
// Contract Store Configuration
// ============================================================================

export interface ContractStoreConfig {
  rootDir: string;
  autoSave: boolean;
  autoSaveDebounce: number;
  createBackup: boolean;
  maxBackups: number;
}

export const DEFAULT_CONTRACT_STORE_CONFIG: ContractStoreConfig = {
  rootDir: '.',
  autoSave: false,
  autoSaveDebounce: 1000,
  createBackup: true,
  maxBackups: 5,
};

// ============================================================================
// Contract Store Event Types
// ============================================================================

export type ContractStoreEventType =
  | 'contract:created'
  | 'contract:updated'
  | 'contract:deleted'
  | 'contract:verified'
  | 'contract:mismatch'
  | 'contract:ignored'
  | 'file:loaded'
  | 'file:saved'
  | 'error';

export interface ContractStoreEvent {
  type: ContractStoreEventType;
  contractId?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Contract Store Class
// ============================================================================

export class ContractStore extends EventEmitter {
  private readonly config: ContractStoreConfig;
  private readonly contractsDir: string;
  private contracts: Map<string, Contract> = new Map();
  private dirty: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(config: Partial<ContractStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONTRACT_STORE_CONFIG, ...config };
    this.contractsDir = path.join(this.config.rootDir, DRIFT_DIR, CONTRACTS_DIR);
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  async initialize(): Promise<void> {
    await this.ensureDirectoryStructure();
    await this.loadAll();
  }

  private async ensureDirectoryStructure(): Promise<void> {
    for (const status of Object.values(STATUS_DIRS)) {
      await ensureDir(path.join(this.contractsDir, status));
    }
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  async loadAll(): Promise<void> {
    this.contracts.clear();

    for (const status of Object.keys(STATUS_DIRS) as ContractStatus[]) {
      await this.loadByStatus(status);
    }

    this.emitEvent('file:loaded', undefined, { count: this.contracts.size });
  }

  private async loadByStatus(status: ContractStatus): Promise<void> {
    const statusDir = path.join(this.contractsDir, STATUS_DIRS[status]);
    const filePath = path.join(statusDir, 'contracts.json');

    if (!(await fileExists(filePath))) {
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as ContractFile;

      for (const stored of data.contracts) {
        const contract = storedToContract(stored, status);
        this.contracts.set(contract.id, contract);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw new ContractStoreError(`Failed to load contract file: ${filePath}`, error as Error);
    }
  }

  // ==========================================================================
  // Saving
  // ==========================================================================

  async saveAll(): Promise<void> {
    const grouped = this.groupContractsByStatus();

    for (const [status, contracts] of Array.from(grouped.entries())) {
      await this.saveStatusFile(status, contracts);
    }

    this.dirty = false;
    this.emitEvent('file:saved', undefined, { count: this.contracts.size });
  }

  private groupContractsByStatus(): Map<ContractStatus, Contract[]> {
    const grouped = new Map<ContractStatus, Contract[]>();

    for (const status of Object.keys(STATUS_DIRS) as ContractStatus[]) {
      grouped.set(status, []);
    }

    for (const contract of Array.from(this.contracts.values())) {
      grouped.get(contract.status)!.push(contract);
    }

    return grouped;
  }

  private async saveStatusFile(status: ContractStatus, contracts: Contract[]): Promise<void> {
    const statusDir = path.join(this.contractsDir, STATUS_DIRS[status]);
    const filePath = path.join(statusDir, 'contracts.json');

    if (contracts.length === 0) {
      if (await fileExists(filePath)) {
        await fs.unlink(filePath);
      }
      return;
    }

    const storedContracts = contracts.map(contractToStored);

    const contractFile: ContractFile = {
      version: CONTRACT_FILE_VERSION,
      status,
      contracts: storedContracts,
      lastUpdated: new Date().toISOString(),
      checksum: generateChecksum(storedContracts),
    };

    if (this.config.createBackup && (await fileExists(filePath))) {
      await this.createBackup(filePath);
    }

    await ensureDir(statusDir);
    await fs.writeFile(filePath, JSON.stringify(contractFile, null, 2));
  }

  private async createBackup(filePath: string): Promise<void> {
    const backupDir = path.join(path.dirname(filePath), '.backups');
    await ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `contracts-${timestamp}.json`);

    await fs.copyFile(filePath, backupPath);
    await this.cleanupBackups(backupDir);
  }

  private async cleanupBackups(backupDir: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith('contracts-') && f.endsWith('.json'))
        .sort()
        .reverse();

      for (const backup of backups.slice(this.config.maxBackups)) {
        await fs.unlink(path.join(backupDir, backup));
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private scheduleAutoSave(): void {
    if (!this.config.autoSave) {return;}

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      if (this.dirty) {
        await this.saveAll();
      }
    }, this.config.autoSaveDebounce);
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  get(id: string): Contract | undefined {
    return this.contracts.get(id);
  }

  getOrThrow(id: string): Contract {
    const contract = this.contracts.get(id);
    if (!contract) {
      throw new ContractNotFoundError(id);
    }
    return contract;
  }

  has(id: string): boolean {
    return this.contracts.has(id);
  }

  add(contract: Contract): void {
    if (this.contracts.has(contract.id)) {
      throw new ContractStoreError(`Contract already exists: ${contract.id}`);
    }

    this.contracts.set(contract.id, contract);
    this.dirty = true;
    this.emitEvent('contract:created', contract.id);
    this.scheduleAutoSave();
  }

  update(id: string, updates: Partial<Omit<Contract, 'id'>>): Contract {
    const existing = this.getOrThrow(id);

    const updated: Contract = {
      ...existing,
      ...updates,
      id,
    };

    this.contracts.set(id, updated);
    this.dirty = true;
    this.emitEvent('contract:updated', id);
    this.scheduleAutoSave();

    return updated;
  }

  delete(id: string): boolean {
    const contract = this.contracts.get(id);
    if (!contract) {return false;}

    this.contracts.delete(id);
    this.dirty = true;
    this.emitEvent('contract:deleted', id);
    this.scheduleAutoSave();

    return true;
  }

  // ==========================================================================
  // Status Transitions
  // ==========================================================================

  verify(id: string, verifiedBy?: string): Contract {
    return this.transitionStatus(id, 'verified', verifiedBy);
  }

  markMismatch(id: string): Contract {
    return this.transitionStatus(id, 'mismatch');
  }

  ignore(id: string): Contract {
    return this.transitionStatus(id, 'ignored');
  }

  private transitionStatus(id: string, newStatus: ContractStatus, user?: string): Contract {
    const contract = this.getOrThrow(id);
    const currentStatus = contract.status;

    if (!VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
      throw new InvalidContractTransitionError(id, currentStatus, newStatus);
    }

    const now = new Date().toISOString();
    const updatedMetadata = {
      ...contract.metadata,
      lastSeen: now,
    };

    if (newStatus === 'verified') {
      updatedMetadata.verifiedAt = now;
      if (user) {
        updatedMetadata.verifiedBy = user;
      }
    }

    const updated: Contract = {
      ...contract,
      status: newStatus,
      metadata: updatedMetadata,
    };

    this.contracts.set(id, updated);
    this.dirty = true;

    if (newStatus === 'verified') {
      this.emitEvent('contract:verified', id);
    } else if (newStatus === 'mismatch') {
      this.emitEvent('contract:mismatch', id);
    } else if (newStatus === 'ignored') {
      this.emitEvent('contract:ignored', id);
    }

    this.scheduleAutoSave();
    return updated;
  }

  // ==========================================================================
  // Querying
  // ==========================================================================

  query(options: ContractQueryOptions = {}): ContractQueryResult {
    const startTime = Date.now();
    const { filter, sort, pagination } = options;

    let results = Array.from(this.contracts.values());

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
      if (filter.ids && !filter.ids.includes(contract.id)) {return false;}

      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(contract.status)) {return false;}
      }

      if (filter.method) {
        const methods = Array.isArray(filter.method) ? filter.method : [filter.method];
        if (!methods.includes(contract.method)) {return false;}
      }

      if (filter.endpoint && !contract.endpoint.includes(filter.endpoint)) {return false;}

      if (filter.hasMismatches !== undefined) {
        const hasMismatches = contract.mismatches.length > 0;
        if (filter.hasMismatches !== hasMismatches) {return false;}
      }

      if (filter.minMismatches !== undefined && contract.mismatches.length < filter.minMismatches) {
        return false;
      }

      if (filter.backendFile && contract.backend.file !== filter.backendFile) {return false;}

      if (filter.frontendFile) {
        const hasFile = contract.frontend.some((f) => f.file === filter.frontendFile);
        if (!hasFile) {return false;}
      }

      if (filter.minConfidence !== undefined && contract.confidence.score < filter.minConfidence) {
        return false;
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        if (!contract.endpoint.toLowerCase().includes(searchLower)) {return false;}
      }

      return true;
    });
  }

  private applySorting(contracts: Contract[], sort: ContractSortOptions): Contract[] {
    const { field, direction } = sort;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...contracts].sort((a, b) => {
      let comparison = 0;

      switch (field) {
        case 'endpoint':
          comparison = a.endpoint.localeCompare(b.endpoint);
          break;
        case 'method':
          comparison = a.method.localeCompare(b.method);
          break;
        case 'mismatchCount':
          comparison = a.mismatches.length - b.mismatches.length;
          break;
        case 'confidence':
          comparison = a.confidence.score - b.confidence.score;
          break;
        case 'firstSeen':
          comparison = new Date(a.metadata.firstSeen).getTime() - new Date(b.metadata.firstSeen).getTime();
          break;
        case 'lastSeen':
          comparison = new Date(a.metadata.lastSeen).getTime() - new Date(b.metadata.lastSeen).getTime();
          break;
      }

      return comparison * multiplier;
    });
  }

  // ==========================================================================
  // Convenience Query Methods
  // ==========================================================================

  getAll(): Contract[] {
    return Array.from(this.contracts.values());
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
    const contracts = Array.from(this.contracts.values());

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

    const mismatchesByType: Record<string, number> = {
      missing_in_frontend: 0,
      missing_in_backend: 0,
      type_mismatch: 0,
      optionality_mismatch: 0,
      nullability_mismatch: 0,
    };

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
      mismatchesByType: mismatchesByType,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  private emitEvent(type: ContractStoreEventType, contractId?: string, data?: Record<string, unknown>): void {
    const event: ContractStoreEvent = {
      type,
      timestamp: new Date().toISOString(),
    };

    if (contractId !== undefined) {
      event.contractId = contractId;
    }
    if (data !== undefined) {
      event.data = data;
    }

    this.emit(type, event);
    this.emit('*', event);
  }
}
