import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import type { AbiFunction, AbiItem, AddressInfo } from './types.js';
import {
  readJson,
  ensureDir,
  extractFunctionName,
  createConcurrencyLimiter,
  lookupSelectorOnline,
  getCachedSelector,
  setCachedSelector,
  mergeAbi,
  errorMessage,
} from '../utils/index.js';

const execAsync = promisify(exec);
let HEIMDALL_AVAILABLE: boolean = false;

// ── Heimdall helpers ──────────────────────────────────────────────────

function getHeimdallPath(): string {
  const p = join(homedir(), '.bifrost', 'bin', 'heimdall');
  return existsSync(p) ? p : 'heimdall';
}

async function isHeimdallInstalled(): Promise<boolean> {
  try {
    await execAsync(`${join(homedir(), '.bifrost', 'bin', 'heimdall')} --version`);
    return true;
  } catch {
    try {
      await execAsync('heimdall --version');
      return true;
    } catch {
      return false;
    }
  }
}

// ── Decompile ─────────────────────────────────────────────────────────

interface DecompileResult {
  solContent: string;
  abi: AbiItem[];
}

async function decompileHeimdall(bytecode: string, outputDir: string): Promise<DecompileResult | null> {
  if (!HEIMDALL_AVAILABLE) {
    HEIMDALL_AVAILABLE = await isHeimdallInstalled();
    if (!HEIMDALL_AVAILABLE) {
      console.warn('[decompile] Heimdall not installed. Install: curl -L http://get.heimdall.rs | bash && bifrost');
      return null;
    }
  }

  ensureDir(outputDir);

  const tempFile = join(outputDir, 'bytecode.hex');
  writeFileSync(tempFile, bytecode);

  try {
    await execAsync(`${getHeimdallPath()} decompile "${tempFile}" --include-sol -d -q -o "${outputDir}"`);
  } catch (error) {
    console.warn('[decompile] Heimdall error:', errorMessage(error));
    return null;
  }

  const solFiles = readdirSync(outputDir).filter(f => f.endsWith('.sol'));
  if (solFiles.length === 0) {
    console.warn('[decompile] No .sol files generated');
    return null;
  }

  const solContent = readFileSync(join(outputDir, solFiles[0]), 'utf-8');

  let abi: AbiItem[] = [];
  const abiFiles = readdirSync(outputDir).filter(f => f.endsWith('.json') && f.includes('abi'));
  if (abiFiles.length > 0) {
    const parsed = readJson(join(outputDir, abiFiles[0]));
    if (Array.isArray(parsed)) abi = parsed;
  }

  return { solContent, abi };
}

// ── Selector resolution & patching ────────────────────────────────────

function extractSelectorsFromSol(solContent: string): string[] {
  const selectors: string[] = [];
  const re = /@custom:selector\s+0x([0-9a-fA-F]{8})/g;
  let match;
  while ((match = re.exec(solContent)) !== null) {
    selectors.push(`0x${match[1].toLowerCase()}`);
  }
  return selectors;
}

async function resolveSelectors(selectors: string[], concurrency = 5): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uncached: string[] = [];

  for (const sel of [...new Set(selectors)]) {
    const cached = getCachedSelector(sel);
    if (cached !== undefined) {
      if (cached) resolved.set(sel, cached);
    } else {
      uncached.push(sel);
    }
  }

  if (uncached.length > 0) {
    console.log(`  [Resolving] Looking up ${uncached.length} selectors online...`);
    const limit = createConcurrencyLimiter(concurrency);

    await Promise.all(uncached.map(sel =>
      limit(async () => {
        const sig = await lookupSelectorOnline(sel);
        setCachedSelector(sel, sig);
        if (sig) resolved.set(sel, sig);
      })
    ));

    console.log(`  [Resolved] ${resolved.size}/${selectors.length} function signatures found`);
  }

  return resolved;
}

function patchSolidity(solContent: string, selectorMap: Map<string, string>): string {
  let result = solContent;

  for (const [selector, signature] of selectorMap) {
    const hex = selector.slice(2);
    const fnName = extractFunctionName(signature);
    if (!fnName) continue;

    result = result.replace(
      new RegExp(`(@custom:signature\\s+)Unresolved_${hex}[^\\n]*`, 'gi'),
      `$1${signature}`
    );
    result = result.replace(
      new RegExp(`function\\s+Unresolved_${hex.toLowerCase()}\\s*\\(`, 'gi'),
      `function ${fnName}(`
    );
  }

  return result;
}

function patchAbiNames(abi: AbiItem[], selectorMap: Map<string, string>): AbiItem[] {
  return abi.map(item => {
    if (item.type !== 'function' || !('name' in item)) return item;
    const fn = item as AbiFunction;
    const match = fn.name.match(/Unresolved_([0-9a-fA-F]{8})/i);
    if (!match) return item;

    const selector = `0x${match[1].toLowerCase()}`;
    const signature = selectorMap.get(selector);
    if (!signature) return item;

    const fnName = extractFunctionName(signature);
    return fnName ? { ...fn, name: fnName } : item;
  });
}

// ── Pipeline: decompile → resolve → patch → merge ─────────────────────

async function decompile(bytecode: string, outputDir: string): Promise<DecompileResult | null> {
  const raw = await decompileHeimdall(bytecode, outputDir);
  if (!raw) return null;

  const selectors = extractSelectorsFromSol(raw.solContent);
  if (selectors.length === 0) return raw;

  const selectorMap = await resolveSelectors(selectors);
  if (selectorMap.size === 0) return raw;

  return {
    solContent: patchSolidity(raw.solContent, selectorMap),
    abi: raw.abi.length > 0 ? patchAbiNames(raw.abi, selectorMap) : raw.abi,
  };
}

export async function tryDecompileForAddress(info: AddressInfo, bytecode: string, workspaceDir: string): Promise<boolean> {
  try {
    const tempDir = join(workspaceDir, '.heimdall-temp', Date.now().toString());
    const decompiled = await decompile(bytecode, tempDir);
    if (!decompiled?.solContent) return false;

    info.sourceCode = {
      sources: { content: decompiled.solContent  },
    };
    info.sourceCodeSource = 'heimdall';

    if (decompiled.abi.length > 0) {
      info.abi = info.abi && Array.isArray(info.abi)
        ? mergeAbi(info.abi, decompiled.abi)
        : decompiled.abi;
      if (!info.abiSource) info.abiSource = 'heimdall';
    }

    return true;
  } catch (error) {
    console.warn(`[decompile] Error for ${info.address}:`, errorMessage(error));
    return false;
  }
}
