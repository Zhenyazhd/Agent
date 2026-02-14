import { CHAINS } from '../utils/index.js';
import type { AbiItem, SourceCodeResult, EtherscanAbiResponse, EtherscanSourceResponse } from './types.js';

// ── Etherscan ────────────────────────────────────────────────────────

async function fetchFromEtherscan<T>(
  address: string,
  chainId: number,
  action: 'getabi' | 'getsourcecode'
): Promise<T | null> {
  const config = CHAINS[chainId] || CHAINS[1];
  const apiKey = config.etherscanKey;

  if (!apiKey) {
    return null;
  }

  try {
    const url = `${config.etherscanApi}?chainid=${chainId}&module=contract&action=${action}&address=${address}&apikey=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      return null;
    }

    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function fetchAbiFromEtherscan(address: string, chainId: number): Promise<AbiItem[] | null> {
  const data = await fetchFromEtherscan<EtherscanAbiResponse>(address, chainId, 'getabi');

  if (!data || data.status !== '1' || !data.result) {
    return null;
  }

  try {
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

function parseEtherscanSourceCode(sourceCode: string): string | { [key: string]: { content: string } } {
  if (sourceCode.startsWith('{{')) {
    try {
      return JSON.parse(sourceCode.slice(1, -1)) as { [key: string]: { content: string } };
    } catch {
    }
  }
  return sourceCode;
}

export async function fetchSourceCodeFromEtherscan(address: string, chainId: number): Promise<SourceCodeResult | null> {
  const data = await fetchFromEtherscan<EtherscanSourceResponse>(address, chainId, 'getsourcecode');

  if (!data || data.status !== '1' || !data.result?.length) {
    return null;
  }

  const contract = data.result[0];
  const sourceCode = contract.SourceCode?.trim();

  if (!sourceCode || sourceCode === 'Contract source code not verified') {
    return null;
  }

  const result: SourceCodeResult = {
    sourceCode: parseEtherscanSourceCode(sourceCode),
  };

  if (contract.ABI && contract.ABI !== 'Contract source code not verified' && contract.ABI.trim()) {
    try {
      result.abi = JSON.parse(contract.ABI);
    } catch {
    }
  }

  if (contract.CompilerVersion) {
    result.compilerVersion = contract.CompilerVersion.replace(/^v/, '');
  }

  if (contract.ContractName) {
    result.contractName = contract.ContractName;
  }

  if (contract.ConstructorArguments) {
    result.constructorArgs = contract.ConstructorArguments;
  }

  return result;
}

// ── Sourcify ─────────────────────────────────────────────────────────

interface SourcifyFile {
  name: string;
  content: string;
}

interface SourcifyMetadata {
  output?: { abi?: AbiItem[] };
  compiler?: { version: string };
  settings?: {
    compilationTarget?: Record<string, string>;
  };
}

async function fetchFromSourcify(address: string, chainId: number): Promise<SourcifyFile[] | null> {
  const urls = [
    `https://sourcify.dev/server/v2/${chainId}/${address}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        return await response.json() as SourcifyFile[];
      }
    } catch {
    }
  }

  return null;
}

export async function fetchAbiFromSourcify(address: string, chainId: number): Promise<AbiItem[] | null> {
  const files = await fetchFromSourcify(address, chainId);
  if (!files) return null;

  const metadataFile = files.find(f => f.name === 'metadata.json');
  if (!metadataFile) return null;

  try {
    const metadata = JSON.parse(metadataFile.content) as SourcifyMetadata;
    return metadata.output?.abi || null;
  } catch {
    return null;
  }
}

export async function fetchSourceCodeFromSourcify(address: string, chainId: number): Promise<Omit<SourceCodeResult, 'constructorArgs'> | null> {
  const files = await fetchFromSourcify(address, chainId);
  if (!files) return null;

  const sourceCode: { [key: string]: { content: string } } = {};
  let metadata: SourcifyMetadata | null = null;
  let contractName: string | undefined;

  for (const file of files) {
    if (file.name.endsWith('.sol')) {
      const path = file.name.replace(/^contracts\//, '');
      sourceCode[path] = { content: file.content };
    } else if (file.name === 'metadata.json') {
      try {
        metadata = JSON.parse(file.content) as SourcifyMetadata;
        const targets = metadata.settings?.compilationTarget ? Object.keys(metadata.settings.compilationTarget) : [];
        if (targets.length > 0) {
          contractName = targets[0].split(':').pop();
        }
      } catch {
      }
    }
  }

  if (Object.keys(sourceCode).length === 0) {
    return null;
  }

  const result: Omit<SourceCodeResult, 'constructorArgs'> = { sourceCode };

  if (metadata) {
    if (metadata.output?.abi) {
      result.abi = metadata.output.abi;
    }
    if (metadata.compiler?.version) {
      result.compilerVersion = metadata.compiler.version;
    }
  }

  if (contractName) {
    result.contractName = contractName;
  }

  return result;
}
