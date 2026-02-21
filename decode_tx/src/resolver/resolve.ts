import type { AddressInfo, SourceCodeResult, AbiItem } from './types.js';
import { loadCachedAddress, saveAddressInfo, WORKSPACE_DIR } from './cache.js';
import { getBytecode, detectProxyInfo } from './rpc.js';
import { fetchAbiFromEtherscan, fetchSourceCodeFromEtherscan, fetchAbiFromSourcify, fetchSourceCodeFromSourcify } from './sources.js';
import { tryDecompileForAddress } from './decompile.js';

// ── Merge helpers for multi-implementation proxy (beacon/diamond/multi-slot) ──

function abiItemSignature(item: AbiItem): string {
  const inputs = Array.isArray(item.inputs) ? item.inputs : [];
  const name = 'name' in item ? String(item.name) : '';
  if (item.type === 'function' && name) {
    const args = inputs.map((x: { type: string }) => x.type).join(',');
    return `${item.type}:${name}(${args})`;
  }
  if (item.type === 'event' && name) {
    const args = inputs.map((x: { type: string }) => x.type).join(',');
    return `${item.type}:${name}(${args})`;
  }
  return JSON.stringify(item);
}

function mergeAbis(abiArrays: (AbiItem[] | null | undefined)[]): AbiItem[] {
  const seen = new Set<string>();
  const out: AbiItem[] = [];
  for (const arr of abiArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const sig = abiItemSignature(item);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(item);
    }
  }
  return out;
}

function mergeSourceCode(
  results: (SourceCodeResult | Omit<SourceCodeResult, 'constructorArgs'> | null)[]
): {
  sourceCode: { [key: string]: { content: string } };
  contractNames: string[];
  compilerVersion?: string;
  optimizationUsed?: boolean;
} {
  const merged: { [key: string]: { content: string } } = {};
  const contractNames: string[] = [];
  let compilerVersion: string | undefined;
  let optimizationUsed: boolean | undefined;

  results.forEach((r, idx) => {
    if (!r?.sourceCode) return;
    const map = typeof r.sourceCode === 'string' ? { 'Contract.sol': { content: r.sourceCode } } : r.sourceCode;
    if (r.contractName) contractNames.push(r.contractName);
    if (r.compilerVersion) compilerVersion = r.compilerVersion;
    if (r.optimizationUsed !== undefined) optimizationUsed = r.optimizationUsed;
    for (const [path, entry] of Object.entries(map)) {
      const targetKey = path in merged ? `impl_${idx}_${path}` : path;
      merged[targetKey] = entry as { content: string };
    }
  });

  return { sourceCode: merged, contractNames, compilerVersion, optimizationUsed };
}

// ── Resolve address ──────────────────────────────────────────────────

export async function resolveAddress(
  address: string,
  chainId: number,
  options: {
    useCache?: boolean;
    fetchAbi?: boolean;
    fetchSourceCode?: boolean;
  } = {}
): Promise<AddressInfo> {
  const { useCache = true, fetchAbi = true, fetchSourceCode = true} = options;
  const normalizedAddress = address.toLowerCase();

  if (useCache) {
    const cached = loadCachedAddress(normalizedAddress, chainId);
    if (cached) {
      const missingAbiSource = (fetchAbi || fetchSourceCode) && !cached.abi && !cached.sourceCode;
      const proxyMissingImpl = cached.isProxy && !cached.implementationBytecode;
      if (missingAbiSource || proxyMissingImpl) {
        const missing = [
          missingAbiSource && 'ABI/source',
          proxyMissingImpl && 'implementation bytecode'
        ].filter(Boolean).join(', ');
        console.warn(`[resolveAddress] Using cached data for ${normalizedAddress}, but missing: ${missing}. Use --no-cache to refetch.`);
      }
      return cached;
    }
  }

  const info: AddressInfo = {
    address: normalizedAddress,
    chainId,
    isContract: false,
    fetchedAt: Date.now(),
  };

  try {
    const bytecode = await getBytecode(normalizedAddress, chainId);
    info.isContract = !!bytecode;

    if (bytecode) {
      info.bytecode = bytecode;

      const proxyInfo = await detectProxyInfo(normalizedAddress, chainId);
      info.isProxy = proxyInfo.isProxy;
      info.proxyType = proxyInfo.proxyType;
      info.implementation = proxyInfo.implementation;

      const implAddresses: string[] = Array.isArray(proxyInfo.implementation)
        ? proxyInfo.implementation.map((a: string) => a.toLowerCase())
        : proxyInfo.implementation
          ? [proxyInfo.implementation.toLowerCase()]
          : [];

      if (proxyInfo.isProxy && implAddresses.length > 0) {
        const bytecodes: string[] = [];
        for (const implAddr of implAddresses) {
          const implBytecode = await getBytecode(implAddr, chainId);
          if (implBytecode) bytecodes.push(implBytecode);
        }
        if (bytecodes.length > 0) {
          info.implementationBytecode = bytecodes[0];
          if (bytecodes.length > 1) info.implementationBytecodes = bytecodes;
        }
      }

      const abiAddresses = implAddresses.length > 0 ? implAddresses : [normalizedAddress];

      if (fetchAbi || fetchSourceCode) {
        const sourceResults: (SourceCodeResult | Omit<SourceCodeResult, 'constructorArgs'> | null)[] = [];
        const abiResults: AbiItem[][] = [];
        let sourceSource: 'etherscan' | 'sourcify' | null = null;

        for (const addr of abiAddresses) {
          let sourceResult: (SourceCodeResult | Omit<SourceCodeResult, 'constructorArgs'>) | null = null;
          if (fetchSourceCode) {
            sourceResult = await fetchSourceCodeFromEtherscan(addr, chainId);
            if (sourceResult) {
              if (!sourceSource) sourceSource = 'etherscan';
            } else {
              sourceResult = await fetchSourceCodeFromSourcify(addr, chainId);
              if (sourceResult && !sourceSource) sourceSource = 'sourcify';
            }
          }
          sourceResults.push(sourceResult);

          if (fetchAbi) {
            if (sourceResult?.abi) {
              abiResults.push(sourceResult.abi);
            } else {
              const etherscanAbi = await fetchAbiFromEtherscan(addr, chainId);
              if (etherscanAbi) abiResults.push(etherscanAbi);
              else {
                const sourcifyAbi = await fetchAbiFromSourcify(addr, chainId);
                if (sourcifyAbi) abiResults.push(sourcifyAbi);
              }
            }
          }
        }

        const hasAnySource = sourceResults.some((r) => r?.sourceCode);
        if (hasAnySource) {
          const merged = mergeSourceCode(sourceResults);
          info.sourceCode = merged.sourceCode;
          info.sourceCodeSource = sourceSource;
          if (merged.compilerVersion) info.compilerVersion = merged.compilerVersion;
          if (merged.optimizationUsed !== undefined) info.optimizationUsed = merged.optimizationUsed;
          if (merged.contractNames.length > 0) {
            info.contractName = merged.contractNames[0];
            if (info.isProxy && merged.contractNames.length > 0) {
              info.implementationContractName = merged.contractNames.length === 1
                ? merged.contractNames[0]
                : merged.contractNames.join(', ');
            }
          }
          const firstWithArgs = sourceResults.find((r) => r && 'constructorArgs' in r && r.constructorArgs);
          if (firstWithArgs && 'constructorArgs' in firstWithArgs && firstWithArgs.constructorArgs) {
            info.constructorArgs = firstWithArgs.constructorArgs;
          }
        }

        if (fetchAbi && abiResults.length > 0) {
          info.abi = mergeAbis(abiResults);
          info.abiSource = sourceSource;
        }
      }

      if (!info.sourceCode) {
        const primaryBytecode = info.implementationBytecode || info.bytecode;
        if (primaryBytecode) {
          console.log(`  [Decompiling] ${normalizedAddress}...`);
          await tryDecompileForAddress(info, primaryBytecode, WORKSPACE_DIR);
        }
      }
    }
  } catch (error: any) {
    info.error = error.message;
  }

  saveAddressInfo(info);

  return info;
}

export async function resolveAddresses(
  addresses: string[],
  chainId: number,
  options: {
    useCache?: boolean;
    fetchAbi?: boolean;
    fetchSourceCode?: boolean;
    detectType?: boolean;
    decompile?: boolean;
    concurrency?: number;
    onProgress?: (resolved: number, total: number) => void;
  } = {}
): Promise<Map<string, AddressInfo>> {
  const { concurrency = 3, onProgress } = options;
  const results = new Map<string, AddressInfo>();
  const unique = [...new Set(addresses.map(a => a.toLowerCase()))];

  let resolved = 0;

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const promises = batch.map(addr => resolveAddress(addr, chainId, options));
    const batchResults = await Promise.all(promises);

    for (const info of batchResults) {
      results.set(info.address, info);
      resolved++;
      onProgress?.(resolved, unique.length);
    }
  }

  return results;
}
























