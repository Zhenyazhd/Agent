#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { TraceDoc, TxMeta } from '../decoder/types.js';
import {
  extractSourceTexts,
  findSourceInAddress,
  loadAddressData,
  getImplementationAddress,
  resolveTraceDocs,
} from '../enricher/index.js';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/Users/evgenijzdarkin/Documents/future/mcp_rust/agent/WORKSPACE';

function getAddressSourceData(
  workspaceDir: string,
  chainId: number,
  addressCache: Map<string, any>,
  address: string
): any | null {
  const addr = address.toLowerCase();
  if (addressCache.has(addr)) return addressCache.get(addr);

  const data = loadAddressData(workspaceDir, addr, chainId);
  if (!data) {
    addressCache.set(addr, null);
    return null;
  }

  const implAddr = getImplementationAddress(data);
  if (implAddr) {
    const implData = loadAddressData(workspaceDir, implAddr, chainId);
    if (implData && extractSourceTexts(data).length === 0 && extractSourceTexts(implData).length > 0) {
      data.sourceCode = implData.sourceCode;
    }
  }

  addressCache.set(addr, data);
  return data;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Enrich trace docs with source code snippets

Usage:
  npx tsx src/cli/enrich-source.ts <tx_hash>

Reads WORKSPACE/<tx_hash>/trace_*.json files,
finds function source code from WORKSPACE/<chainId>_<address>.json,
and writes source_code field back into each trace doc.
`);
    process.exit(0);
  }

  const txHash = args[0];
  const txDir = join(WORKSPACE_DIR, txHash);

  if (!existsSync(txDir)) {
    console.error(`Directory not found: ${txDir}`);
    process.exit(1);
  }

  const metaPath = join(txDir, 'tx_meta.json');
  if (!existsSync(metaPath)) {
    console.error(`tx_meta.json not found in ${txDir}`);
    process.exit(1);
  }

  const meta: TxMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const chainId = meta.chain_id;

  const addressCache = new Map<string, any>();

  const traceFiles = readdirSync(txDir)
    .filter(f => f.startsWith('trace_') && f.endsWith('.json'))
    .sort((a, b) => {
      const idA = parseInt(a.replace('trace_', '').replace('.json', ''), 10);
      const idB = parseInt(b.replace('trace_', '').replace('.json', ''), 10);
      return idA - idB;
    });

  const traceEntries: { filePath: string; trace: TraceDoc }[] = traceFiles.map(file => {
    const filePath = join(txDir, file);
    return { filePath, trace: JSON.parse(readFileSync(filePath, 'utf-8')) as TraceDoc };
  });

  console.log(`Resolving trace docs for ${traceEntries.length} traces...`);

  await resolveTraceDocs(traceEntries.map(e => e.trace), WORKSPACE_DIR, chainId);

  let enriched = 0;
  let skipped = 0;
  let notFound = 0;

  for (const { filePath, trace } of traceEntries) {

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

    const addressData = getAddressSourceData(WORKSPACE_DIR, chainId, addressCache, trace.to);
    if (!addressData) {
      notFound++;
      writeFileSync(filePath, JSON.stringify(trace, null, 2));
      continue;
    }

    const result = findSourceInAddress(addressData, functionName, trace.selector);
    if (!result) {
      notFound++;
      writeFileSync(filePath, JSON.stringify(trace, null, 2));
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

  console.log(`Done. ${traceEntries.length} traces total:`);
  console.log(`  enriched:  ${enriched}`);
  console.log(`  skipped:   ${skipped} (no signature/selector)`);
  console.log(`  not found: ${notFound} (no address file or function not in source)`);
}

main().catch(console.error);
