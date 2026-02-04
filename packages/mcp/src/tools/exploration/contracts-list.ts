/**
 * drift_contracts_list - API Contract Listing
 * 
 * Exploration tool that lists API contracts between frontend and backend.
 * Shows verified contracts, mismatches, and discovered endpoints.
 * 
 * MIGRATION: Now supports both legacy ContractStore and new UnifiedStore (SQLite).
 * The SQLite-based approach is preferred for new code.
 */

import { 
  createResponseBuilder, 
  cursorManager,
  Errors,
  type PaginationInfo,
} from '../../infrastructure/index.js';

import type { ContractStore, Contract } from 'driftdetect-core';
import type { UnifiedStore, DbContract } from 'driftdetect-core/storage';

export interface ContractSummary {
  id: string;
  endpoint: string;
  method: string;
  status: 'verified' | 'mismatch' | 'discovered';
  frontendFile: string | undefined;
  backendFile: string;
  mismatchCount: number;
}

export interface ContractsListData {
  contracts: ContractSummary[];
  stats: {
    verified: number;
    mismatch: number;
    discovered: number;
  };
  /** Response source for debugging */
  _source?: 'sqlite' | 'json';
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Handle contracts list using UnifiedStore (SQLite - preferred)
 */
export async function handleContractsListWithSqlite(
  unifiedStore: UnifiedStore,
  args: {
    status?: string;
    limit?: number;
    cursor?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ContractsListData>();
  
  // Parse cursor if provided
  let startOffset = 0;
  if (args.cursor) {
    const cursorData = cursorManager.decode(args.cursor);
    if (!cursorData) {
      throw Errors.invalidCursor();
    }
    startOffset = cursorData.offset ?? 0;
  }
  
  // Get contracts from SQLite by status
  const verified = await unifiedStore.contracts.findByStatus('verified');
  const mismatches = await unifiedStore.contracts.findByStatus('mismatch');
  const discovered = await unifiedStore.contracts.findByStatus('discovered');
  
  // Build contract summaries from SQLite data
  let allContracts: ContractSummary[] = [];
  
  const mapDbContract = async (contract: DbContract): Promise<ContractSummary> => {
    // Get frontends for this contract
    const frontends = await unifiedStore.contracts.getFrontends(contract.id);
    const mismatchList = contract.mismatches ? JSON.parse(contract.mismatches) : [];
    
    return {
      id: contract.id,
      endpoint: contract.endpoint,
      method: contract.method,
      status: contract.status as 'verified' | 'mismatch' | 'discovered',
      frontendFile: frontends[0]?.file,
      backendFile: contract.backend_file ?? '',
      mismatchCount: mismatchList.length,
    };
  };
  
  // Add all contracts (map in parallel for performance)
  const allDbContracts = [...verified, ...mismatches, ...discovered];
  allContracts = await Promise.all(allDbContracts.map(mapDbContract));
  
  // Filter by status
  if (args.status && args.status !== 'all') {
    allContracts = allContracts.filter(c => c.status === args.status);
  }
  
  // Sort: mismatches first, then by endpoint
  allContracts.sort((a, b) => {
    if (a.status === 'mismatch' && b.status !== 'mismatch') {return -1;}
    if (b.status === 'mismatch' && a.status !== 'mismatch') {return 1;}
    return a.endpoint.localeCompare(b.endpoint);
  });
  
  const totalCount = allContracts.length;
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  
  // Apply pagination
  const paginatedContracts = allContracts.slice(startOffset, startOffset + limit);
  
  // Build pagination info
  const hasMore = startOffset + limit < totalCount;
  const pagination: PaginationInfo = {
    hasMore,
    totalCount,
    pageSize: limit,
    cursor: hasMore 
      ? cursorManager.createOffsetCursor(startOffset + limit, args)
      : undefined,
  };
  
  const stats = {
    verified: verified.length,
    mismatch: mismatches.length,
    discovered: discovered.length,
  };
  
  // Build summary
  let summary = `${totalCount} contracts: ${stats.verified} verified, ${stats.mismatch} mismatches, ${stats.discovered} discovered.`;
  if (stats.mismatch > 0) {
    summary += ` ⚠️ ${stats.mismatch} need attention.`;
  }
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: stats.mismatch > 0
      ? [
          'Review mismatch contracts to fix API inconsistencies',
          'Use drift_patterns_list to see API patterns',
        ]
      : [
          'Use drift_patterns_list to see API patterns',
        ],
    relatedTools: ['drift_patterns_list'],
  };
  
  if (stats.mismatch > 0) {
    hints.warnings = [`${stats.mismatch} API contracts have mismatches between frontend and backend`];
  }
  
  return builder
    .withSummary(summary)
    .withData({ contracts: paginatedContracts, stats, _source: 'sqlite' })
    .withPagination(pagination)
    .withHints(hints)
    .buildContent();
}

/**
 * Handle contracts list using legacy ContractStore (JSON - backward compatibility)
 * @deprecated Use handleContractsListWithSqlite instead
 */
export async function handleContractsList(
  store: ContractStore,
  args: {
    status?: string;
    limit?: number;
    cursor?: string;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const builder = createResponseBuilder<ContractsListData>();
  
  await store.initialize();
  
  // Parse cursor if provided
  let startOffset = 0;
  if (args.cursor) {
    const cursorData = cursorManager.decode(args.cursor);
    if (!cursorData) {
      throw Errors.invalidCursor();
    }
    startOffset = cursorData.offset ?? 0;
  }
  
  // Get contracts by status
  const verified = store.getVerified();
  const mismatches = store.getMismatched();
  const discovered = store.getDiscovered();
  
  // Build contract summaries
  let allContracts: ContractSummary[] = [];
  
  const mapContract = (contract: Contract, status: 'verified' | 'mismatch' | 'discovered'): ContractSummary => ({
    id: contract.id,
    endpoint: contract.endpoint,
    method: contract.method,
    status,
    frontendFile: contract.frontend[0]?.file,
    backendFile: contract.backend.file,
    mismatchCount: contract.mismatches.length,
  });
  
  // Add verified contracts
  for (const contract of verified) {
    allContracts.push(mapContract(contract, 'verified'));
  }
  
  // Add mismatches
  for (const contract of mismatches) {
    allContracts.push(mapContract(contract, 'mismatch'));
  }
  
  // Add discovered
  for (const contract of discovered) {
    allContracts.push(mapContract(contract, 'discovered'));
  }
  
  // Filter by status
  if (args.status && args.status !== 'all') {
    allContracts = allContracts.filter(c => c.status === args.status);
  }
  
  // Sort: mismatches first, then by endpoint
  allContracts.sort((a, b) => {
    if (a.status === 'mismatch' && b.status !== 'mismatch') {return -1;}
    if (b.status === 'mismatch' && a.status !== 'mismatch') {return 1;}
    return a.endpoint.localeCompare(b.endpoint);
  });
  
  const totalCount = allContracts.length;
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  
  // Apply pagination
  const paginatedContracts = allContracts.slice(startOffset, startOffset + limit);
  
  // Build pagination info
  const hasMore = startOffset + limit < totalCount;
  const pagination: PaginationInfo = {
    hasMore,
    totalCount,
    pageSize: limit,
    cursor: hasMore 
      ? cursorManager.createOffsetCursor(startOffset + limit, args)
      : undefined,
  };
  
  const stats = {
    verified: verified.length,
    mismatch: mismatches.length,
    discovered: discovered.length,
  };
  
  // Build summary
  let summary = `${totalCount} contracts: ${stats.verified} verified, ${stats.mismatch} mismatches, ${stats.discovered} discovered.`;
  if (stats.mismatch > 0) {
    summary += ` ⚠️ ${stats.mismatch} need attention.`;
  }
  
  const hints: { nextActions: string[]; warnings?: string[]; relatedTools: string[] } = {
    nextActions: stats.mismatch > 0
      ? [
          'Review mismatch contracts to fix API inconsistencies',
          'Use drift_patterns_list to see API patterns',
        ]
      : [
          'Use drift_patterns_list to see API patterns',
        ],
    relatedTools: ['drift_patterns_list'],
  };
  
  if (stats.mismatch > 0) {
    hints.warnings = [`${stats.mismatch} API contracts have mismatches between frontend and backend`];
  }
  
  return builder
    .withSummary(summary)
    .withData({ contracts: paginatedContracts, stats })
    .withPagination(pagination)
    .withHints(hints)
    .buildContent();
}
