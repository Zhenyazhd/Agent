#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  decodeTransactionWithCast,
  writeTraceDocs,
} from '../decoder/index.js';
import { resolveAddresses, WORKSPACE_DIR } from '../resolver/index.js';
import {
  extractSourceTexts,
  findSourceInAddress,
  loadAddressData,
  enrichWithContractMeta,
  getImplementationAddress,
} from '../enricher/index.js';
import { collapseTraces, writeCollapseResults } from '../collapse/index.js';
import type { TxMeta, TraceDoc } from '../decoder/types.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Full Transaction Analysis Pipeline

Usage:
  npx tsx src/cli/pipeline.ts <tx_hash> [chain_id] [options]

Steps:
  1. Decode transaction (cast trace + metadata)
  2. Resolve all addresses (ABI, source, proxy, decompile fallback)
  3. Enrich traces with source code snippets
  4. Collapse traces (compact, loop detection, key calls, phases)

Options:
  --no-decompile    Skip Heimdall decompilation fallback
  --no-enrich       Stop after step 2 (skip source enrichment)
  -v, --verbose     Show detailed progress
  -h, --help        Show this help

Examples:
  npx tsx src/cli/pipeline.ts 0xabc123... 1
  npx tsx src/cli/pipeline.ts 0xabc123... 137 --verbose
`);
    process.exit(0);
  }

  const txHash = args[0];
  const chainIdArg = args.find((a, i) => i === 1 && !a.startsWith('-'));
  const chainId = chainIdArg ? parseInt(chainIdArg, 10) : 1;
  const decompile = !args.includes('--no-decompile');
  const doEnrich = !args.includes('--no-enrich');
  const verbose = args.includes('-v') || args.includes('--verbose');

  if (!txHash.match(/^0x[a-fA-F0-9]{64}$/)) {
    console.error('Error: Invalid transaction hash format');
    process.exit(1);
  }

  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  }

  const startTime = Date.now();

  // ── Step 1: Decode transaction ──────────────────────────────────────
  console.log(`\n[1/4] Decoding transaction ${txHash} (chain ${chainId})...`);

  let decoded = await decodeTransactionWithCast(txHash, chainId);
  if (!decoded) {
    console.error('Failed to decode transaction');
    process.exit(1);
  }

  decoded = await enrichWithContractMeta(decoded);

  const { dir: txDir, count: docCount } = await writeTraceDocs(decoded, WORKSPACE_DIR);
  console.log(`  ✓ ${docCount} trace docs written to ${txDir}`);

  // ── Step 2: Resolve addresses (+ decompile fallback) ────────────────
  const metaPath = join(txDir, 'tx_meta.json');
  const meta: TxMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const addresses = meta.addresses;

  if (addresses.length === 0) {
    console.log('[2/4] No addresses to resolve, skipping.');
  } else {
    console.log(`\n[2/4] Resolving ${addresses.length} addresses...`);

    const results = await resolveAddresses(addresses, chainId, {
      useCache: true,
      fetchAbi: true,
      fetchSourceCode: true,
      detectType: true,
      decompile,
      concurrency: 3,
      onProgress: (resolved, total) => {
        process.stdout.write(`\r  Progress: ${resolved}/${total}`);
      },
    });

    let contracts = 0, withAbi = 0, proxies = 0;
    for (const [, info] of results) {
      if (info.isContract) {
        contracts++;
        if (info.abi) withAbi++;
        if (info.isProxy) proxies++;
      }
    }
    console.log(`\n  ✓ ${results.size} addresses resolved (${contracts} contracts, ${withAbi} with ABI, ${proxies} proxies)`);
  }

  // ── Step 3: Enrich traces with source code ──────────────────────────
  if (!doEnrich) {
    console.log('\n[3/4] Skipped (--no-enrich)');
  } else {
    console.log(`\n[3/4] Enriching traces with source code...`);

    const addressCache = new Map<string, any>();

    function getAddressSourceData(address: string): any | null {
      const addr = address.toLowerCase();
      if (addressCache.has(addr)) return addressCache.get(addr);

      const data = loadAddressData(WORKSPACE_DIR, addr, chainId);
      if (!data) {
        addressCache.set(addr, null);
        return null;
      }

      const implAddr = getImplementationAddress(data);
      if (implAddr) {
        const implData = loadAddressData(WORKSPACE_DIR, implAddr, chainId);
        if (implData && extractSourceTexts(data).length === 0 && extractSourceTexts(implData).length > 0) {
          data.sourceCode = implData.sourceCode;
        }
      }

      addressCache.set(addr, data);
      return data;
    }

    const traceFiles = readdirSync(txDir)
      .filter(f => f.startsWith('trace_') && f.endsWith('.json'))
      .sort((a, b) => {
        const idA = parseInt(a.replace('trace_', '').replace('.json', ''), 10);
        const idB = parseInt(b.replace('trace_', '').replace('.json', ''), 10);
        return idA - idB;
      });

    let enriched = 0, skipped = 0, notFound = 0;

    for (const file of traceFiles) {
      const filePath = join(txDir, file);
      const trace: TraceDoc = JSON.parse(readFileSync(filePath, 'utf-8'));

      const sig = trace.effective_signature || trace.signature;
      if (!sig && !trace.selector) {
        skipped++;
        continue;
      }

      let functionName: string | null = null;
      if (sig && !sig.startsWith('unknown(')) {
        const match = sig.match(/^([^(]+)/);
        if (match) functionName = match[1];
      }

      const addressData = getAddressSourceData(trace.to);
      if (!addressData) {
        notFound++;
        continue;
      }

      const result = findSourceInAddress(addressData, functionName, trace.selector);
      if (!result) {
        notFound++;
        continue;
      }

      trace.source_code = result.snippet;
      trace.source_links.filePath = join(WORKSPACE_DIR, `${chainId}_${trace.to.toLowerCase()}.json`);
      trace.source_links.sourceFile = result.fileName;
      trace.source_links.startLine = result.startLine;
      trace.source_links.endLine = result.endLine;

      writeFileSync(filePath, JSON.stringify(trace, null, 2));
      enriched++;
    }

    console.log(`  ✓ ${traceFiles.length} traces: ${enriched} enriched, ${skipped} skipped, ${notFound} no source`);
  }

  // ── Step 4: Collapse traces ──────────────────────────────────────────
  console.log(`\n[4/4] Collapsing traces...`);

  const collapseResult = collapseTraces(txDir);
  writeCollapseResults(txDir, collapseResult);

  console.log(`  ${collapseResult.compact_traces.length} calls → ${collapseResult.key_calls.length} key calls`);
  if (collapseResult.loop_groups.length > 0) {
    for (const g of collapseResult.loop_groups) {
      console.log(`  Loop: "${g.name}" × ${g.iterations.length} iterations (${g.total_calls} calls)`);
    }
  }
  console.log(`  ${collapseResult.phases.length} phases detected`);

  // ── Done ────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Pipeline complete in ${elapsed}s`);
  console.log(`  Output: ${txDir}`);
}

main().catch(error => {
  console.error('Fatal error:', error.message || error);
  process.exit(1);
});
