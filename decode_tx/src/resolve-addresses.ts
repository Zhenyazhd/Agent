#!/usr/bin/env node

import 'dotenv/config';
import { resolveAddresses, resolveAddress, WORKSPACE_DIR } from './address-resolver.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
        Address Resolver - Determines contract vs EOA, fetches bytecode/ABI

        Usage:
          npx tsx src/resolve-addresses.ts <addresses> [chain_id] [options]

        Arguments:
          addresses    Comma-separated list of addresses, or path to JSON file with addresses array
          chain_id     Chain ID (default: 1)

        Options:
          --no-cache      Skip cache, always fetch fresh
          --no-abi        Skip ABI fetching
          --no-type       Skip contract type detection
          -v, --verbose   Show detailed logs (warnings, API errors)
          -j, --json      Output JSON to stdout
          -h, --help      Show this help

        Examples:
          # Single address
          npx tsx src/resolve-addresses.ts 0x1234...abcd 1

          # Multiple addresses
          npx tsx src/resolve-addresses.ts 0x1234...abcd,0x5678...efgh 1

          # From transaction trace
          npx tsx src/resolve-addresses.ts $(cat trace.json | jq -r '.addresses | join(",")')

        Output:
          Saves to: ${WORKSPACE_DIR}/{chainId}_{address}.json

        Supported chains: 1 (ETH), 137 (Polygon), 42161 (Arbitrum), 10 (Optimism), 8453 (Base), 56 (BSC)
        `);
    process.exit(0);
  }

  const addressArg = args[0];
  const chainIdArg = args.find((a, i) => i === 1 && !a.startsWith('-'));
  const chainId = chainIdArg ? parseInt(chainIdArg, 10) : 1;

  const useCache = !args.includes('--no-cache');
  const fetchAbi = !args.includes('--no-abi');
  const detectType = !args.includes('--no-type');
  const jsonOutput = args.includes('-j') || args.includes('--json');
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  if (verbose) {
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      originalWarn(...args);
    };
  }

  let addresses: string[];
  if (addressArg.endsWith('.json')) {
    const fs = await import('fs');
    const data = JSON.parse(fs.readFileSync(addressArg, 'utf-8'));
    addresses = Array.isArray(data) ? data : data.addresses || [];
  } else {
    addresses = addressArg.split(',').map(a => a.trim()).filter(a => a);
  }

  if (addresses.length === 0) {
    console.error('No addresses provided');
    process.exit(1);
  }

  const results = await resolveAddresses(addresses, chainId, {
    useCache,
    fetchAbi,
    fetchSourceCode: true, 
    detectType,
    concurrency: 3,
    onProgress: (resolved, total) => {
      if (!jsonOutput) {
        process.stdout.write(`\rProgress: ${resolved}/${total}`);
      }
    },
  });

  if (!jsonOutput) {
    console.log('\n');
  }

  const summary = {
    total: results.size,
    contracts: 0,
    eoa: 0,
    withAbi: 0,
    proxies: 0,
    types: {} as Record<string, number>,
  };

  for (const [addr, info] of results) {
    if (info.isContract) {
      summary.contracts++;
      if (info.abi) summary.withAbi++;
      if (info.isProxy) summary.proxies++;
      if (info.contractType) {
        summary.types[info.contractType] = (summary.types[info.contractType] || 0) + 1;
      }
    } else {
      summary.eoa++;
    }

    if (!jsonOutput) {
      const typeStr = info.contractType || (info.isContract ? 'CONTRACT' : 'EOA');
      const abiStr = info.abi ? '✓ ABI' : '';
      const proxyStr = info.isProxy ? `→ ${info.implementation?.slice(0, 10)}...` : '';
      const nameStr = info.name || info.symbol || '';

      console.log(`${addr.slice(0, 10)}... ${typeStr.padEnd(8)} ${abiStr.padEnd(6)} ${proxyStr.padEnd(15)} ${nameStr}`);
    }
  }

  if (jsonOutput) {
    const output = Object.fromEntries(results);
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('');
    console.log('=== Summary ===');
    console.log(`Total: ${summary.total}`);
    console.log(`Contracts: ${summary.contracts}`);
    console.log(`EOA: ${summary.eoa}`);
    console.log(`With ABI: ${summary.withAbi}`);
    console.log(`Proxies: ${summary.proxies}`);
    console.log(`\nFiles saved to: ${WORKSPACE_DIR}`);
  }
}

main().catch(console.error);
