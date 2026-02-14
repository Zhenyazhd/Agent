/**
 * Resolve unknown selectors in trace docs: replace "unknown(0x...)" with real
 * function signatures using local ABI (WORKSPACE address files) and/or online lookup (4byte/openchain).
 */

import type { AbiFunction, AbiItem } from '../resolver/types.js';
import {
  readJson,
  addressFilePath,
  getImplementationAddress,
  findFunctionBySelector,
  detectArgType,
  getCachedSelector,
  setCachedSelector,
  lookupSelectorOnline,
  createConcurrencyLimiter,
} from '../utils/index.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface TraceDocLike {
  effective_signature: string | null;
  selector: `0x${string}` | null;
  to: string;
  args_raw: string[];
  args_pretty: { type: string; value: string; label?: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────

function loadAddressAbi(
  workspaceDir: string,
  chainId: number,
  address: string
): AbiItem[] | null {
  const path = addressFilePath(workspaceDir, address.toLowerCase(), chainId);
  const data = readJson(path);
  if (!data) return null;

  const implAddr = getImplementationAddress(data);
  if (implAddr) {
    const implPath = addressFilePath(workspaceDir, implAddr.toLowerCase(), chainId);
    const implData = readJson(implPath);
    if (implData?.abi && Array.isArray(implData.abi)) return implData.abi;
  }

  if (data.abi && Array.isArray(data.abi)) return data.abi;
  return null;
}

function reParseArgsPrettyFromAbi(
  fn: AbiFunction,
  rawArgs: string[]
): { type: string; value: string }[] {
  const inputs = fn.inputs ?? [];
  return rawArgs.map((raw, i) => ({
    type: inputs[i]?.type ?? detectArgType(raw),
    value: raw,
  }));
}

// ── Main ──────────────────────────────────────────────────────────────

/**
 * Resolves "unknown(0x...)" effective_signature in trace docs by:
 * 1. Looking up the selector in the contract's ABI (WORKSPACE/{chainId}_{address}.json)
 * 2. For still unresolved, looking up online (4byte/openchain) and caching
 * Mutates docs in place.
 */
export async function resolveTraceDocs(
  docs: TraceDocLike[],
  workspaceDir: string,
  chainId: number
): Promise<void> {
  const unresolved = docs.filter((d) => d.effective_signature?.startsWith('unknown('));
  if (unresolved.length === 0) return;

  const stillUnresolved: { doc: TraceDocLike; selector: string }[] = [];

  for (const doc of unresolved) {
    const selector = doc.selector;
    if (!selector) continue;

    const abi = loadAddressAbi(workspaceDir, chainId, doc.to);
    if (abi) {
      const fn = findFunctionBySelector(abi, selector);

      console.log(`  [Resolving] Found function ${fn?.name} for selector ${selector}...`);
      if (fn) {
        const paramTypes = (fn.inputs ?? []).map((i) => i.type).join(',');
        doc.effective_signature = `${fn.name}(${paramTypes})`;
        doc.args_pretty = reParseArgsPrettyFromAbi(fn, doc.args_raw);
        continue;
      }
    }
    stillUnresolved.push({ doc, selector });
  }

  if (stillUnresolved.length === 0) return;

  const uniqueSelectors = [...new Set(stillUnresolved.map((u) => u.selector))];
  const selectorMap = new Map<string, string | null>();
  const limit = createConcurrencyLimiter(5);

  const uncachedSelectors: string[] = [];
  for (const sel of uniqueSelectors) {
    const cached = getCachedSelector(sel);
    if (cached !== undefined) {
      selectorMap.set(sel, cached);
    } else {
      uncachedSelectors.push(sel);
    }
  }

  if (uncachedSelectors.length > 0) {
    console.log(`  [Resolving] Looking up ${uncachedSelectors.length} selectors online...`);

    await Promise.all(
      uncachedSelectors.map((sel) =>
        limit(async () => {
          console.log(`  [Resolving] Looking up selector ${sel} online...`);  
          const result = await lookupSelectorOnline(sel);
          console.log(`  [Resolved] ${result}`);
          setCachedSelector(sel, result);
          selectorMap.set(sel, result);
        })
      )
    );
  }

  for (const { doc, selector } of stillUnresolved) {
    const sig = selectorMap.get(selector);
    if (sig) doc.effective_signature = sig;
  }
}
