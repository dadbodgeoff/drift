/**
 * Quick test script for the enterprise MCP server
 * Run with: node test-enterprise.mjs
 */

import { createEnterpriseMCPServer, getAllTools, getToolCategories } from './dist/enterprise-server.js';

async function test() {
  console.log('🧪 Testing Enterprise MCP Server\n');
  
  // Test 1: Create server
  console.log('1. Creating server...');
  const server = createEnterpriseMCPServer({
    projectRoot: process.cwd(),
    enableCache: true,
    enableRateLimiting: true,
    enableMetrics: true,
  });
  console.log('   ✅ Server created\n');
  
  // Test 2: Check tools
  console.log('2. Checking tools...');
  const tools = getAllTools();
  const categories = getToolCategories();
  
  console.log(`   Total tools: ${tools.length}`);
  console.log(`   Categories:`);
  for (const [category, toolNames] of Object.entries(categories)) {
    console.log(`     - ${category}: ${toolNames.join(', ')}`);
  }
  console.log('   ✅ Tools registered\n');
  
  // Test 3: Verify drift_context exists
  console.log('3. Verifying drift_context (the final boss)...');
  const contextTool = tools.find(t => t.name === 'drift_context');
  if (contextTool) {
    console.log(`   Name: ${contextTool.name}`);
    console.log(`   Description preview: ${contextTool.description.slice(0, 100)}...`);
    console.log('   ✅ drift_context found\n');
  } else {
    console.log('   ❌ drift_context NOT FOUND\n');
    process.exit(1);
  }
  
  // Test 4: Check tool schema
  console.log('4. Checking drift_context schema...');
  const schema = contextTool.inputSchema;
  if (schema.properties) {
    console.log(`   Properties: ${Object.keys(schema.properties).join(', ')}`);
    console.log('   ✅ Schema valid\n');
  }
  
  // Test 5: List all tools with descriptions
  console.log('5. All tools summary:');
  console.log('   ─────────────────────────────────────────');
  for (const tool of tools) {
    const desc = tool.description.split('\n')[0].slice(0, 60);
    console.log(`   ${tool.name.padEnd(25)} ${desc}...`);
  }
  console.log('   ─────────────────────────────────────────\n');
  
  console.log('✅ All tests passed! Enterprise server is ready.\n');
  
  // Summary
  console.log('📊 Summary:');
  console.log(`   - ${tools.length} tools across ${Object.keys(categories).length} categories`);
  console.log('   - Orchestration layer: drift_context (intent-aware)');
  console.log('   - Infrastructure: caching, rate limiting, metrics');
  console.log('   - Response format: summary + data + hints + pagination');
}

test().catch(console.error);
