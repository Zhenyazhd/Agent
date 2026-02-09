
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { keccak256, toBytes, toHex } from 'viem';

const execAsync = promisify(exec);

export interface BytecodeCheckResult {
  hasBytecode: boolean;
  hasImplementationBytecode: boolean;
  hasSourceCode: boolean;
  bytecode?: string;
  implementationBytecode?: string;
  filePath: string;
  error?: string;
  primaryBytecode?: string;
}


export function checkBytecode(filePath: string): BytecodeCheckResult {
  const result: BytecodeCheckResult = {
    hasBytecode: false,
    hasImplementationBytecode: false,
    hasSourceCode: false,
    filePath,
  };

  try {
    if (!existsSync(filePath)) {
      result.error = `File not found: ${filePath}`;
      return result;
    }

    const fileContent = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(fileContent);

    if (data.sourceCode) {
      const sourceCode = data.sourceCode;
      if (
        (typeof sourceCode === 'string' && sourceCode.trim() !== '') ||
        (typeof sourceCode === 'object' && Object.keys(sourceCode).length > 0)
      ) {
        result.hasSourceCode = true;
        return result;
      }
    }

    if (data.bytecode && typeof data.bytecode === 'string' && data.bytecode.trim() !== '') {
      result.hasBytecode = true;
      result.bytecode = data.bytecode;
    }

    if (
      data.implementationBytecode &&
      typeof data.implementationBytecode === 'string' &&
      data.implementationBytecode.trim() !== ''
    ) {
      result.hasImplementationBytecode = true;
      result.implementationBytecode = data.implementationBytecode;
      result.primaryBytecode = data.implementationBytecode;
    } else if (result.hasBytecode) {
      result.primaryBytecode = result.bytecode;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

export function checkBytecodes(filePaths: string[]): BytecodeCheckResult[] {
  return filePaths.map(checkBytecode);
}

export function checkBytecodesInDirectory(
  directory: string,
  extension: string = '.json'
): BytecodeCheckResult[] {
  const files = readdirSync(directory)
    .filter((file: string) => file.endsWith(extension))
    .map((file: string) => join(directory, file));

  return checkBytecodes(files);
}

async function checkHeimdallInstalled(): Promise<boolean> {
  try {
    const homeDir = homedir();
    const heimdallPath = join(homeDir, '.bifrost', 'bin', 'heimdall');
    await execAsync(`${heimdallPath} --version`);
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


function getHeimdallPath(): string {
  const homeDir = homedir();
  const heimdallPath = join(homeDir, '.bifrost', 'bin', 'heimdall');
  if (existsSync(heimdallPath)) {
    return heimdallPath;
  }
  return 'heimdall'; 
}

const signatureCache = new Map<string, string | null>();

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          active--;
          next();
        }
      };
      queue.push(run);
      next();
    });
  };
}

async function lookupSelectorWithRetry(
  selector: string,
  retries = 2,
  baseDelay = 200
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(
        `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}&filter=true`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await sleep(baseDelay * Math.pow(2, attempt));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { result?: { function?: Record<string, Array<{ name: string }>> } };
      const results = data?.result?.function?.[selector];

      if (results && results.length > 0) {
        return results[0].name;
      }

      return null;
    } catch {
      if (attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function lookupSelector(selector: string): Promise<string | null> {
  if (!selector || selector.length !== 10) return null;

  if (signatureCache.has(selector)) {
    return signatureCache.get(selector)!;
  }

  const result = await lookupSelectorWithRetry(selector);
  signatureCache.set(selector, result);
  return result;
}

async function batchLookupSelectors(
  selectors: string[],
  concurrency = 5
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const unique = [...new Set(selectors)];

  const uncached: string[] = [];
  for (const sel of unique) {
    if (signatureCache.has(sel)) {
      results.set(sel, signatureCache.get(sel)!);
    } else {
      uncached.push(sel);
    }
  }

  if (uncached.length === 0) {
    return results;
  }

  const limit = createLimiter(concurrency);
  const lookupPromises = uncached.map(sel =>
    limit(async () => {
      const sig = await lookupSelectorWithRetry(sel);
      signatureCache.set(sel, sig);
      results.set(sel, sig);
    })
  );

  await Promise.all(lookupPromises);
  return results;
}


function extractSelectorsFromSol(solContent: string): string[] {
  const selectors: string[] = [];
  const selectorRegex = /@custom:selector\s+0x([0-9a-fA-F]{8})/g;
  let match;
  while ((match = selectorRegex.exec(solContent)) !== null) {
    selectors.push(`0x${match[1].toLowerCase()}`);
  }
  return selectors;
}


function extractSelectorsFromAbi(abi: any[]): string[] {
  const selectors: string[] = [];
  for (const item of abi) {
    if (item.type === 'function' && item.name) {
      const match = item.name.match(/Unresolved_([0-9a-fA-F]{8})/i);
      if (match) {
        selectors.push(`0x${match[1].toLowerCase()}`);
      }
    }
  }
  return selectors;
}


function computeSelector(signature: string): string {
  const hash = keccak256(toBytes(signature));
  return hash.slice(0, 10);
}

function replaceUnresolvedFunctions(solContent: string, selectorMap: Map<string, string>): string {
  let result = solContent;
  
  for (const [selector, signature] of selectorMap.entries()) {
    const selectorHex = selector.slice(2).toUpperCase();
    
    const functionNameMatch = signature.match(/^([^(]+)\(/);
    if (!functionNameMatch) continue;
    
    const realName = functionNameMatch[1];
    const unresolvedName = `Unresolved_${selectorHex.toLowerCase()}`;
    
    const signatureCommentRegex = new RegExp(
      `(@custom:signature\\s+)Unresolved_${selectorHex}[^\\n]*`,
      'gi'
    );
    result = result.replace(signatureCommentRegex, `$1${signature}`);
    
    const functionRegex = new RegExp(
      `function\\s+${unresolvedName}\\s*\\(`,
      'gi'
    );
    result = result.replace(functionRegex, `function ${realName}(`);
  }
  
  return result;
}

function updateAbiWithSignatures(abi: any[], selectorMap: Map<string, string>): any[] {
  return abi.map(item => {
    if (item.type === 'function' && item.name) {
      const match = item.name.match(/Unresolved_([0-9a-fA-F]{8})/i);
      if (match) {
        const selector = `0x${match[1].toLowerCase()}`;
        const signature = selectorMap.get(selector);
        if (signature) {
          const functionNameMatch = signature.match(/^([^(]+)\(/);
          if (functionNameMatch) {
            return { ...item, name: functionNameMatch[1] };
          }
        }
      }
    }
    return item;
  });
}

async function decompileWithHeimdall(bytecode: string, outputDir: string): Promise<{ solContent: string; abi: any[] } | null> {
  try {
    if (!(await checkHeimdallInstalled())) {
      console.warn('[decompileWithHeimdall] Heimdall not installed. Install: curl -L http://get.heimdall.rs | bash && bifrost');
      return null;
    }

    const heimdallPath = getHeimdallPath();
    
    mkdirSync(outputDir, { recursive: true });

    const tempBytecodeFile = join(outputDir, 'bytecode.hex');
    writeFileSync(tempBytecodeFile, bytecode);

    const command = `${heimdallPath} decompile "${tempBytecodeFile}" --include-sol -d -q -o "${outputDir}"`;
    
    const { stdout, stderr } = await execAsync(command);
    
    const solFiles = readdirSync(outputDir).filter(f => f.endsWith('.sol'));
    const abiFiles = readdirSync(outputDir).filter(f => f.endsWith('.json') && f.includes('abi'));
    
    if (solFiles.length === 0) {
      console.warn('[decompileWithHeimdall] No .sol files generated');
      return null;
    }

    const solFile = join(outputDir, solFiles[0]);
    let solContent = readFileSync(solFile, 'utf-8');
    
    let abi: any[] = [];
    if (abiFiles.length > 0) {
      try {
        const abiFile = join(outputDir, abiFiles[0]);
        const abiContent = readFileSync(abiFile, 'utf-8');
        abi = JSON.parse(abiContent);
      } catch {
      }
    }

    const selectors = solContent ? extractSelectorsFromSol(solContent) : extractSelectorsFromAbi(abi);
    
    if (selectors.length > 0) {
      console.log(`  [Resolving] Found ${selectors.length} function selectors, checking signatures...`);
      
      const selectorMap = await batchLookupSelectors(selectors, 5);
      
      const resolved = Array.from(selectorMap.values()).filter(Boolean).length;
      console.log(`  [Resolved] ${resolved}/${selectors.length} function signatures found`);
      
      const resolvedSelectors = new Map<string, string>();
      for (const [selector, signature] of selectorMap.entries()) {
        if (signature) {
          resolvedSelectors.set(selector, signature);
        }
      }
      
      if (solContent && resolvedSelectors.size > 0) {
        solContent = replaceUnresolvedFunctions(solContent, resolvedSelectors);
      }
      
      if (abi.length > 0 && resolvedSelectors.size > 0) {
        abi = updateAbiWithSignatures(abi, resolvedSelectors);
      }
    }
    
    return { solContent, abi };
  } catch (error) {
    console.warn('[decompileWithHeimdall] Error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}


export async function decompileAndSave(filePath: string, bytecode: string): Promise<boolean> {
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(fileContent);

    if (data.sourceCode) {
      return false;
    }

    const tempDir = join(dirname(filePath), '.heimdall-temp', Date.now().toString());
    const decompiled = await decompileWithHeimdall(bytecode, tempDir);
    
    if (!decompiled || !decompiled.solContent) {
      return false;
    }

    const fileName = 'Decompiled.sol';
    data.sourceCode = {
      language: 'Solidity',
      sources: {
        [fileName]: {
          content: decompiled.solContent
        }
      }
    };
    data.sourceCodeSource = 'heimdall';
    
    if (decompiled.abi && decompiled.abi.length > 0) {
      if (data.abi && Array.isArray(data.abi)) {
        const existingSelectors = new Set<string>();
        const mergedAbi = [...data.abi];
        
        for (const item of decompiled.abi) {
          if (item.type === 'function' && item.name) {
            const signature = `${item.name}(${item.inputs?.map((i: any) => i.type).join(',') || ''})`;
            const selector = computeSelector(signature);
            if (!existingSelectors.has(selector)) {
              existingSelectors.add(selector);
              mergedAbi.push(item);
            }
          } else {
            mergedAbi.push(item);
          }
        }
        data.abi = mergedAbi;
      } else {
        data.abi = decompiled.abi;
      }
      if (!data.abiSource) {
        data.abiSource = 'heimdall';
      }
    }

    writeFileSync(filePath, JSON.stringify(data, null, 2));

    return true;
  } catch (error) {
    console.warn(`[decompileAndSave] Error for ${filePath}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}
