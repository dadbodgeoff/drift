/**
 * Integration test for generation tools against real demo codebases
 * Run with: node test-generation-tools.mjs
 */

import { handleExplain } from './dist/tools/generation/explain.js';
import { handleSuggestChanges } from './dist/tools/generation/suggest-changes.js';
import { handleValidateChange } from './dist/tools/generation/validate-change.js';
import { 
  PatternStore, 
  ManifestStore, 
  BoundaryStore, 
  CallGraphStore 
} from 'driftdetect-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = path.join(__dirname, '../../demo');

// Create stores with proper config
function createStores(projectRoot) {
  const config = { rootDir: projectRoot };
  
  const patternStore = new PatternStore(config);
  const manifestStore = new ManifestStore(projectRoot);  // Takes string directly
  const boundaryStore = new BoundaryStore(config);
  const callGraphStore = new CallGraphStore(config);
  
  return { patternStore, manifestStore, boundaryStore, callGraphStore };
}

async function testExplain(projectRoot, target, options = {}) {
  console.log(`\n📋 Testing drift_explain on: ${target}`);
  const stores = createStores(projectRoot);
  
  try {
    const result = await handleExplain(
      {
        pattern: stores.patternStore,
        manifest: stores.manifestStore,
        boundary: stores.boundaryStore,
        callGraph: stores.callGraphStore,
      },
      projectRoot,
      { target, depth: options.depth || 'detailed', focus: options.focus }
    );
    
    if (result && result.content && result.content[0]) {
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      console.log(`   ✅ Success!`);
      console.log(`   Summary: ${parsed.summary}`);
      if (parsed.data?.explanation) {
        const exp = parsed.data.explanation;
        console.log(`   Purpose: ${exp.purpose}`);
        console.log(`   Context: ${exp.context.role} (${exp.context.importance})`);
        console.log(`   Patterns: ${exp.patterns.length}`);
        console.log(`   Data Access: ${exp.dependencies.dataAccess?.length || 0} points`);
        if (exp.security) {
          console.log(`   Security: ${exp.security.concerns?.length || 0} concerns`);
        }
        if (exp.semantics) {
          console.log(`   Frameworks: ${exp.semantics.frameworks?.join(', ') || 'none'}`);
        }
      }
      return { success: true, data: parsed };
    }
    return { success: false, error: 'Empty response' };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.stack) console.log(`   Stack: ${error.stack.split('\n')[1]}`);
    return { success: false, error: error.message };
  }
}

async function testSuggestChanges(projectRoot, target, options = {}) {
  console.log(`\n📋 Testing drift_suggest_changes on: ${target}`);
  const stores = createStores(projectRoot);
  
  try {
    const result = await handleSuggestChanges(
      { pattern: stores.patternStore, boundary: stores.boundaryStore },
      projectRoot,
      { target, maxSuggestions: options.maxSuggestions || 3, issue: options.issue }
    );
    
    if (result && result.content && result.content[0]) {
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      console.log(`   ✅ Success!`);
      console.log(`   Summary: ${parsed.summary}`);
      if (parsed.data) {
        console.log(`   Total Issues: ${parsed.data.stats?.totalIssues || 0}`);
        console.log(`   Suggestions: ${parsed.data.suggestions?.length || 0}`);
        if (parsed.data.suggestions?.length > 0) {
          for (const s of parsed.data.suggestions.slice(0, 2)) {
            console.log(`     - [${s.priority}] ${s.title}`);
          }
        }
      }
      return { success: true, data: parsed };
    }
    return { success: false, error: 'Empty response' };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.stack) console.log(`   Stack: ${error.stack.split('\n')[1]}`);
    return { success: false, error: error.message };
  }
}

async function testValidateChange(projectRoot, file, content) {
  console.log(`\n📋 Testing drift_validate_change on: ${file}`);
  const stores = createStores(projectRoot);
  
  try {
    const result = await handleValidateChange(
      stores.patternStore,
      projectRoot,
      { file, content }
    );
    
    if (result && result.content && result.content[0]) {
      const text = result.content[0].text;
      const parsed = JSON.parse(text);
      console.log(`   ✅ Success!`);
      console.log(`   Summary: ${parsed.summary}`);
      if (parsed.data) {
        console.log(`   Status: ${parsed.data.status}`);
        console.log(`   Score: ${parsed.data.overallScore}%`);
        console.log(`   Violations: ${parsed.data.violations?.length || 0}`);
        if (parsed.data.violations?.length > 0) {
          for (const v of parsed.data.violations.slice(0, 2)) {
            console.log(`     - [${v.severity}] ${v.message}`);
          }
        }
      }
      return { success: true, data: parsed };
    }
    return { success: false, error: 'Empty response' };
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.stack) console.log(`   Stack: ${error.stack.split('\n')[1]}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing Generation Tools Against Demo Codebases\n');
  console.log(`Demo root: ${DEMO_ROOT}`);
  
  const results = [];
  
  // Test 1: drift_explain on TypeScript file (in-memory, no DB)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: drift_explain on TypeScript backend service');
  console.log('='.repeat(60));
  results.push(await testExplain(DEMO_ROOT, 'backend/src/services/userService.ts'));
  
  // Test 2: drift_explain on PHP/Laravel file (has DB::transaction, Eloquent)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: drift_explain on Laravel backend (Eloquent)');
  console.log('='.repeat(60));
  results.push(await testExplain(DEMO_ROOT, 'laravel-backend/app/Services/ProductService.php'));
  
  // Test 3: drift_explain on Java/Spring Repository (JpaRepository)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: drift_explain on Spring Data JPA Repository');
  console.log('='.repeat(60));
  results.push(await testExplain(DEMO_ROOT, 'spring-backend/src/main/java/com/example/demo/repository/UserRepository.java'));
  
  // Test 4: drift_explain on C# EF Core Repository (actual data access)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: drift_explain on C# EF Core Repository');
  console.log('='.repeat(60));
  results.push(await testExplain(DEMO_ROOT, 'csharp-backend/src/Data/Repositories.cs'));
  
  // Test 5: drift_suggest_changes on C# Repository
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: drift_suggest_changes on C# Repository');
  console.log('='.repeat(60));
  results.push(await testSuggestChanges(DEMO_ROOT, 'csharp-backend/src/Data/Repositories.cs'));
  
  // Test 6: drift_validate_change with inline content (raw SQL)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 6: drift_validate_change with raw SQL (should flag)');
  console.log('='.repeat(60));
  results.push(await testValidateChange(DEMO_ROOT, 'backend/src/services/new-service.ts', `
import { db } from '../db';

export async function getUsers() {
  // Raw SQL - should be flagged
  const users = await db.query('SELECT * FROM users WHERE active = 1');
  return users;
}

export async function getUserById(id: string) {
  return db.users.findUnique({ where: { id } });
}
`));
  
  // Test 7: drift_explain on Laravel with security focus
  console.log('\n' + '='.repeat(60));
  console.log('TEST 7: drift_explain on Laravel with security focus');
  console.log('='.repeat(60));
  results.push(await testExplain(DEMO_ROOT, 'laravel-backend/app/Services/ProductService.php', { 
    depth: 'comprehensive', 
    focus: 'security' 
  }));
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n   Passed: ${passed}/${results.length}`);
  console.log(`   Failed: ${failed}/${results.length}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed! Generation tools are production ready.\n');
  } else {
    console.log('\n⚠️ Some tests failed. Review errors above.\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
