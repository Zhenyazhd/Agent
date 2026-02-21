#!/usr/bin/env node
import { existsSync, statSync } from 'fs';
import { collapseTraces, writeCollapseResults } from '../collapse/index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Trace Collapse — reduce raw traces into compact/grouped/key summaries

Usage:
  npx tsx src/cli/collapse.ts <tx_dir>

Output (written to tx_dir):
  compact_traces.json  — all calls as one-liners
  loop_groups.json     — detected repeating patterns
  key_calls.json       — state-changing / important calls only
  phases.json          — transaction phases (setup, loop, extraction)

Examples:
  npx tsx src/cli/collapse.ts ./WORKSPACE/0xabc123...
`);
    process.exit(0);
  }

  const txDir = args[0];

  if (!existsSync(txDir) || !statSync(txDir).isDirectory()) {
    console.error(`Error: ${txDir} is not a valid directory`);
    process.exit(1);
  }

  console.log(`[collapse] Processing ${txDir}...`);

  const result = collapseTraces(txDir);

  console.log(`  compact_traces: ${result.compact_traces.length} calls`);
  console.log(`  loop_groups:    ${result.loop_groups.length} groups`);
  for (const g of result.loop_groups) {
    console.log(`    - "${g.name}": ${g.iterations.length} iterations, ${g.total_calls} calls`);
  }
  console.log(`  key_calls:      ${result.key_calls.length} calls`);
  console.log(`  phases:         ${result.phases.length} phases`);
  for (const p of result.phases) {
    console.log(`    - ${p.name}: ${p.call_ids.length} root children (${p.description})`);
  }

  writeCollapseResults(txDir, result);
  console.log(`\n✓ Written to ${txDir}`);
}

main().catch(error => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
