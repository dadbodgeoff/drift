#!/usr/bin/env node
/**
 * Postinstall Script
 * 
 * Shows users the available setup options after npm install.
 * This runs automatically after `npm install driftdetect`.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

console.log();
console.log(`${BOLD}${GREEN}✓ Drift installed successfully!${RESET}`);
console.log();
console.log(`${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║${RESET}                    ${BOLD}Get Started with Drift${RESET}                    ${BOLD}${CYAN}║${RESET}`);
console.log(`${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════╝${RESET}`);
console.log();
console.log(`${BOLD}Choose your setup:${RESET}`);
console.log();
console.log(`  ${BOLD}${GREEN}1. Full Setup (Recommended)${RESET}`);
console.log(`     ${DIM}Complete codebase analysis with pattern detection, call graphs,${RESET}`);
console.log(`     ${DIM}constraints, and AI memory system.${RESET}`);
console.log();
console.log(`     ${CYAN}drift setup${RESET}          ${DIM}Interactive guided setup${RESET}`);
console.log(`     ${CYAN}drift setup -y${RESET}       ${DIM}Quick setup with defaults${RESET}`);
console.log();
console.log(`  ${BOLD}${MAGENTA}2. Cortex Memory Only${RESET}`);
console.log(`     ${DIM}Interactive wizard to set up AI memory - tribal knowledge,${RESET}`);
console.log(`     ${DIM}workflows, agent spawns, and preferences. Perfect for existing projects.${RESET}`);
console.log();
console.log(`     ${CYAN}drift memory setup${RESET}   ${DIM}Interactive Cortex wizard${RESET}`);
console.log(`     ${CYAN}drift memory init${RESET}    ${DIM}Quick init (no wizard)${RESET}`);
console.log();
console.log(`  ${BOLD}${YELLOW}3. Quick Scan${RESET}`);
console.log(`     ${DIM}Just scan for patterns without full setup.${RESET}`);
console.log();
console.log(`     ${CYAN}drift scan${RESET}           ${DIM}Scan current directory${RESET}`);
console.log();
console.log(`${DIM}─────────────────────────────────────────────────────────────────${RESET}`);
console.log(`${DIM}Documentation: https://github.com/dadbodgeoff/drift${RESET}`);
console.log(`${DIM}MCP Setup:     https://github.com/dadbodgeoff/drift/wiki/MCP-Setup${RESET}`);
console.log();
