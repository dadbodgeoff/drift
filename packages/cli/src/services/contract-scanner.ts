/**
 * Contract Scanner Service
 *
 * Scans backend and frontend files to detect API contracts
 * and identify mismatches between what backend returns and
 * what frontend expects.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createContractStore, type ContractStoreInterface, type Contract } from 'driftdetect-core';
import {
  extractBackendEndpoints,
  extractFrontendApiCalls,
  extractSpringEndpoints,
  matchContracts,
  type ExtractedEndpoint,
  type ExtractedApiCall,
} from 'driftdetect-detectors';

// ============================================================================
// Types
// ============================================================================

export interface ContractScannerConfig {
  rootDir: string;
  verbose?: boolean;
}

export interface ContractScanResult {
  contracts: Contract[];
  unmatchedBackend: ExtractedEndpoint[];
  unmatchedFrontend: ExtractedApiCall[];
  stats: {
    backendEndpoints: number;
    frontendCalls: number;
    matchedContracts: number;
    mismatches: number;
  };
  duration: number;
}

// ============================================================================
// Language Detection
// ============================================================================

function getLanguage(filePath: string): 'python' | 'typescript' | 'javascript' | 'java' | 'csharp' | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.py':
    case '.pyw':
      return 'python';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.java':
      return 'java';
    case '.cs':
      return 'csharp';
    default:
      return null;
  }
}

function isBackendFile(filePath: string, content: string): boolean {
  // Python files with FastAPI/Flask/Django patterns
  if (filePath.endsWith('.py')) {
    if (content.includes('from fastapi') || content.includes('from flask') || 
        content.includes('from django') || content.includes('@app.route') ||
        content.includes('@router.')) {
      return true;
    }
  }
  
  // Java files with Spring patterns
  if (filePath.endsWith('.java')) {
    if (content.includes('@RestController') || content.includes('@Controller') ||
        content.includes('@RequestMapping') || content.includes('@GetMapping') ||
        content.includes('@PostMapping') || content.includes('@PutMapping') ||
        content.includes('@DeleteMapping') || content.includes('@PatchMapping')) {
      return true;
    }
  }
  
  // C# files with ASP.NET patterns
  if (filePath.endsWith('.cs')) {
    if (content.includes('[ApiController]') || content.includes('[Controller]') ||
        content.includes('[HttpGet]') || content.includes('[HttpPost]') ||
        content.includes('[HttpPut]') || content.includes('[HttpDelete]') ||
        content.includes('[Route(') || content.includes('ControllerBase')) {
      return true;
    }
  }
  
  // TypeScript/JS files - detect by content, not path
  if (filePath.match(/\.(ts|js|mjs)$/)) {
    // Express/Koa/Hapi server patterns
    if (content.includes('express()') || content.includes('app.listen') || 
        content.includes('router.get(') || content.includes('router.post(') ||
        content.includes('router.put(') || content.includes('router.delete(') ||
        content.includes('app.get(') || content.includes('app.post(') ||
        content.includes('res.json(') || content.includes('res.send(') ||
        content.includes('req.body') || content.includes('req.params') ||
        content.includes('req.query')) {
      // But not if it also has React/frontend patterns
      if (!content.includes('import React') && !content.includes("from 'react'") &&
          !content.includes('useState') && !content.includes('useEffect')) {
        return true;
      }
    }
  }
  
  return false;
}

function isFrontendFile(filePath: string, content: string): boolean {
  // TypeScript/JS files - detect by content, not path
  if (filePath.match(/\.(ts|tsx|js|jsx)$/)) {
    // Skip if it's clearly a backend file
    if (content.includes('express()') || content.includes('app.listen') ||
        content.includes('res.json(') || content.includes('res.send(')) {
      return false;
    }
    
    // React patterns
    if (content.includes('import React') || content.includes("from 'react'") ||
        content.includes('useState') || content.includes('useEffect') ||
        content.includes('useCallback') || content.includes('useMemo')) {
      return true;
    }
    
    // API client patterns (fetch, axios, or custom clients making HTTP calls)
    if (content.includes('fetch(') || content.includes('axios.') || 
        content.match(/\w+Client\.(get|post|put|patch|delete)\s*[<(]/) ||
        content.match(/\w+Api\.(get|post|put|patch|delete)\s*[<(]/)) {
      return true;
    }
    
    // TypeScript API type definitions with HTTP-related types
    if ((content.includes('ApiResponse') || content.includes('ApiError')) &&
        !content.includes('express')) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Contract Scanner
// ============================================================================

export class ContractScanner {
  private config: ContractScannerConfig;
  private store: ContractStoreInterface | null = null;

  constructor(config: ContractScannerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.store = await createContractStore({ rootDir: this.config.rootDir });
  }

  async scanFiles(files: string[]): Promise<ContractScanResult> {
    if (!this.store) {
      throw new Error('ContractScanner not initialized. Call initialize() first.');
    }
    
    const startTime = Date.now();
    
    const backendEndpoints: ExtractedEndpoint[] = [];
    const frontendCalls: ExtractedApiCall[] = [];

    // Scan each file
    for (const file of files) {
      const filePath = path.join(this.config.rootDir, file);
      const language = getLanguage(file);
      
      if (!language) {continue;}

      try {
        const content = await fs.readFile(filePath, 'utf-8');

        // Check if backend file
        if (isBackendFile(file, content)) {
          if (language === 'python') {
            const result = extractBackendEndpoints(content, file, 'python');
            backendEndpoints.push(...result.endpoints);
          } else if (language === 'typescript' || language === 'javascript') {
            const result = extractBackendEndpoints(content, file, language);
            backendEndpoints.push(...result.endpoints);
          } else if (language === 'java') {
            // Use Spring endpoint detector for Java files
            const result = extractSpringEndpoints(content, file);
            // Convert Spring endpoints to ExtractedEndpoint format
            for (const endpoint of result.endpoints) {
              const extractedEndpoint: ExtractedEndpoint = {
                method: endpoint.method,
                path: endpoint.path,
                normalizedPath: endpoint.normalizedPath || endpoint.path,
                file: endpoint.file,
                line: endpoint.line,
                responseFields: endpoint.responseFields,
                framework: 'spring-mvc',
              };
              
              if (endpoint.requestFields && endpoint.requestFields.length > 0) {
                extractedEndpoint.requestFields = endpoint.requestFields;
              }
              if (endpoint.responseTypeName) {
                extractedEndpoint.responseTypeName = endpoint.responseTypeName;
              }
              if (endpoint.requestTypeName) {
                extractedEndpoint.requestTypeName = endpoint.requestTypeName;
              }
              
              backendEndpoints.push(extractedEndpoint);
            }
          }
        }

        // Check if frontend file
        if (isFrontendFile(file, content)) {
          if (language === 'typescript' || language === 'javascript') {
            const result = extractFrontendApiCalls(content, file);
            frontendCalls.push(...result.apiCalls);
          }
        }
      } catch (error) {
        if (this.config.verbose) {
          console.error(`Error scanning ${file}:`, (error as Error).message);
        }
      }
    }

    // Match contracts
    const matchResult = matchContracts(backendEndpoints, frontendCalls);

    // Store contracts
    for (const contract of matchResult.contracts) {
      if (!this.store!.has(contract.id)) {
        await this.store!.add(contract);
      } else {
        // Update existing contract
        await this.store!.update(contract.id, {
          backend: contract.backend,
          frontend: contract.frontend,
          mismatches: contract.mismatches,
          confidence: contract.confidence,
          metadata: {
            ...contract.metadata,
            lastSeen: new Date().toISOString(),
          },
        });
      }
    }

    await this.store!.saveAll();

    // Calculate stats
    const mismatchCount = matchResult.contracts.reduce(
      (sum: number, c: { mismatches: unknown[] }) => sum + c.mismatches.length,
      0
    );

    return {
      contracts: matchResult.contracts,
      unmatchedBackend: matchResult.unmatchedBackend,
      unmatchedFrontend: matchResult.unmatchedFrontend,
      stats: {
        backendEndpoints: backendEndpoints.length,
        frontendCalls: frontendCalls.length,
        matchedContracts: matchResult.contracts.length,
        mismatches: mismatchCount,
      },
      duration: Date.now() - startTime,
    };
  }

  getStore(): ContractStoreInterface {
    if (!this.store) {
      throw new Error('ContractScanner not initialized. Call initialize() first.');
    }
    return this.store;
  }

  async close(): Promise<void> {
    if (this.store?.close) {
      await this.store.close();
    }
  }
}

export function createContractScanner(config: ContractScannerConfig): ContractScanner {
  return new ContractScanner(config);
}
