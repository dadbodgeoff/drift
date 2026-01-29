/**
 * drift_contracts_list - API Contract Listing
 * 
 * Exploration tool that lists API contracts between frontend and backend.
 * Shows verified contracts, mismatches, and discovered endpoints.
 */

import { 
  createResponseBuilder, 
  cursorManager,
  Errors,
  type PaginationInfo,
} from '../../infrastructure/index.js';

import type { ContractStore, Contract } from 'driftdetect-core';

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
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
