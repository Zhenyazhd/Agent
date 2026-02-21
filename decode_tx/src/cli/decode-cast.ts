#!/usr/bin/env node
import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import {
  decodeTransactionWithCast,
  formatTraceHierarchy,
  writeTraceDocs,
} from '../decoder/index.js';
import type { DecodedTransactionWithHierarchy } from '../decoder/types.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/agent/WORKSPACE';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Cast-based Transaction Decoder - Full hierarchy preservation

Usage:
  npx tsx src/cli/decode-cast.ts <tx_hash> [chain_id] [options]

Options:
  -o, --output <file>    Save JSON output to file
  -p, --pretty           Print pretty formatted trace
  -j, --json             Output raw JSON to stdout
  -h, --help             Show this help

Examples:
  npx tsx src/cli/decode-cast.ts 0x1234... 1
  npx tsx src/cli/decode-cast.ts 0x1234... 1 -o trace.json -p
  npx tsx src/cli/decode-cast.ts 0x1234... 137 --meta --pretty

Supported chains:
  1     - Ethereum Mainnet
  137   - Polygon
  42161 - Arbitrum
  10    - Optimism
  8453  - Base
  56    - BSC
  43114 - Avalanche
`);
    process.exit(0);
  }

  const txHash = args[0];
  const chainIdArg = args.find((a, i) => i === 1 && !a.startsWith('-'));
  const chainId = chainIdArg ? parseInt(chainIdArg, 10) : 1;

  const outputIndex = args.findIndex(a => a === '-o' || a === '--output');
  let outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

  if (!outputFile) {
    const filePathArg = args.find((a, i) =>
      i > 1 &&
      !a.startsWith('-') &&
      (a.includes('/') || a.includes('\\') || a.endsWith('.json'))
    );
    if (filePathArg) {
      outputFile = filePathArg;
    }
  }

  const prettyPrint = args.includes('-p') || args.includes('--pretty');
  const jsonOutput = args.includes('-j') || args.includes('--json');

  if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
    console.error('Error: Invalid transaction hash format');
    process.exit(1);
  }

  console.log(`\nDecoding transaction: ${txHash}`);
  console.log(`Chain ID: ${chainId}`);
  console.log('');

  try {
    let decoded = await decodeTransactionWithCast(txHash, chainId);

    if (!decoded) {
      console.error('Failed to decode transaction');
      process.exit(1);
    }

    if (!existsSync(WORKSPACE_DIR)) {
      mkdirSync(WORKSPACE_DIR, { recursive: true });
    }

    const { dir: txDir, count: docCount } = await writeTraceDocs(decoded, WORKSPACE_DIR);
    console.log(`Wrote ${docCount} trace docs to: ${txDir}`);

    if (outputFile) {
      writeFileSync(outputFile, JSON.stringify(decoded, null, 2));
      console.log(`Also saved to: ${outputFile}`);
    }

    if (prettyPrint) {
      console.log(formatTraceHierarchy(decoded));
      console.log('');
    }

    if (jsonOutput) {
      console.log(JSON.stringify(decoded, null, 2));
    }

    if (!jsonOutput && !prettyPrint) {
      printSummary(decoded);
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function printSummary(decoded: DecodedTransactionWithHierarchy) {
  console.log('=== Transaction Summary ===');
  console.log(`Hash: ${decoded.txHash}`);
  console.log(`Chain: ${decoded.chainId}`);
  console.log(`From: ${decoded.from}`);
  console.log(`To: ${decoded.to}`);
  console.log(`Value: ${decoded.valueDecimal} ETH`);
  console.log(`Function: ${decoded.functionSignature || 'unknown'}`);
  console.log(`Success: ${decoded.success}`);
  console.log('');
  console.log('=== Stats ===');
  console.log(`Total Calls: ${decoded.totalCalls}`);
  console.log(`Max Depth: ${decoded.maxDepth}`);
  console.log(`Total Logs: ${decoded.allLogs.length}`);
  console.log(`Gas Used: ${decoded.rootGasUsed.toLocaleString()}`);
  console.log('');

  const addresses = new Set<string>();
  decoded.traceCalls.forEach(c => {
    addresses.add(c.to);
    if (c.from) addresses.add(c.from);
  });
  console.log(`Unique Addresses: ${addresses.size}`);

  const callTypes: Record<string, number> = {};
  decoded.traceCalls.forEach(c => {
    callTypes[c.callType] = (callTypes[c.callType] || 0) + 1;
  });
  console.log('Call Types:', callTypes);

  const depthCounts: Record<number, number> = {};
  decoded.traceCalls.forEach(c => {
    depthCounts[c.depth] = (depthCounts[c.depth] || 0) + 1;
  });
  console.log('Calls by Depth:', depthCounts);

  console.log('');
  console.log('=== Top-level Calls (depth 0-1) ===');
  decoded.traceCalls
    .filter(c => c.depth <= 1)
    .slice(0, 15)
    .forEach(c => {
      const indent = '  '.repeat(c.depth);
      const funcName = c.signature || c.selector || 'fallback';
      const contractMeta = decoded.contractMeta[c.to.toLowerCase()];
      const label = contractMeta?.name || c.to.slice(0, 10) + '...';
      console.log(`${indent}${c.callType}: ${label}::${funcName}`);
    });
}

main().catch(console.error);
