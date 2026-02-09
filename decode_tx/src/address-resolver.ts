import { createPublicClient, http, type Address } from 'viem';
import { mainnet, polygon, arbitrum, optimism, base, bsc, avalanche } from 'viem/chains';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import evmProxyDetection from 'evm-proxy-detection';


type AbiItem = {
  name?: string;
  type: string;
  inputs?: Array<{ name?: string; type: string }>;
  outputs?: Array<{ name?: string; type: string }>;
  stateMutability?: string;
  [key: string]: unknown;
};

export interface AddressInfo {
  address: string;
  chainId: number;
  isContract: boolean;
  bytecode?: string;
  bytecodeHash?: string;
  abi?: AbiItem[];
  abiSource?: 'etherscan' | 'sourcify' | null;
  sourceCode?: string | { [key: string]: { content: string } };
  sourceCodeSource?: 'etherscan' | 'sourcify' | null;
  compilerVersion?: string;
  optimizationUsed?: boolean;
  runs?: number;
  contractName?: string;
  constructorArgs?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  contractType?: 'ERC20' | 'ERC721' | 'ERC1155' | 'OTHER';
  isProxy?: boolean;
  proxyType?: string;
  implementation?: string | string[];
  immutable?: boolean;
  implementationBytecode?: string;
  implementationBytecodeHash?: string;
  implementationContractName?: string;
  fetchedAt: number;
  error?: string;
}

interface ChainConfig {
  chain: any;
  rpcUrl: string;
  etherscanApi: string;
  etherscanKey?: string;
}

const CHAINS: Record<number, ChainConfig> = {
  1: {
    chain: mainnet,
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    etherscanApi: 'https://api.etherscan.io/v2/api',
    etherscanKey: process.env.ETHERSCAN_API_KEY,
  },
  137: {
    chain: polygon,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
    etherscanApi: 'https://api.polygonscan.com/v2/api',
    etherscanKey: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  42161: {
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
    etherscanApi: 'https://api.arbiscan.io/v2/api',
    etherscanKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  10: {
    chain: optimism,
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
    etherscanApi: 'https://api-optimistic.etherscan.io/v2/api',
    etherscanKey: process.env.OPTIMISM_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  8453: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
    etherscanApi: 'https://api.basescan.org/v2/api',
    etherscanKey: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  56: {
    chain: bsc,
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
    etherscanApi: 'https://api.bscscan.com/v2/api',
    etherscanKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  43114: {
    chain: avalanche,
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://avalanche.llamarpc.com',
    etherscanApi: 'https://api.snowtrace.io/v2/api',
    etherscanKey: process.env.SNOWTRACE_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
};

function getClient(chainId: number) {
  const config = CHAINS[chainId] || CHAINS[1];
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || join(process.cwd(), 'WORKSPACE');

function ensureWorkspace() {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

function getAddressFilePath(address: string, chainId: number): string {
  const normalizedAddress = address.toLowerCase();
  return join(WORKSPACE_DIR, `${chainId}_${normalizedAddress}.json`);
}

function loadCachedAddress(address: string, chainId: number): AddressInfo | null {
  const filePath = getAddressFilePath(address, chainId);
  if (existsSync(filePath)) {
    try {
      const data = readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function saveAddressInfo(info: AddressInfo): void {
  ensureWorkspace();
  const filePath = getAddressFilePath(info.address, info.chainId);
  writeFileSync(filePath, JSON.stringify(info, null, 2));
}

async function getBytecode(address: string, chainId: number): Promise<string | null> {
  const client = getClient(chainId);
  try {
    const code = await client.getCode({ address: address as Address });
    return code && code !== '0x' ? code : null;
  } catch {
    return null;
  }
}

function hashBytecode(bytecode: string): string {
  if (!bytecode || bytecode.length < 20) return bytecode;
  return `${bytecode.slice(0, 10)}...${bytecode.slice(-10)}[${bytecode.length}]`;
}

interface ProxyResult {
  isProxy: boolean;
  proxyType?: string;
  implementation?: string | string[];
  immutable?: boolean;
}

async function detectProxyInfo(address: string, chainId: number): Promise<ProxyResult> {
  if (typeof (evmProxyDetection as any).default !== 'function') {
    return { isProxy: false };
  }

  const client = getClient(chainId);

  try {
    const requestFunc = async (args: { method: string; params: unknown[] }): Promise<unknown> => {
      return client.request({
        method: args.method as any,
        params: args.params as any,
      });
    };

    const result = await (evmProxyDetection as any).default(address as `0x${string}`, requestFunc);

    if (result) {
      return {
        isProxy: true,
        proxyType: result.type,
        implementation: result.target,
        immutable: result.immutable,
      };
    }
  } catch (error) {
    console.warn(`[detectProxyInfo] Failed for ${address}:`, error instanceof Error ? error.message : error);
  }

  return { isProxy: false };
}

interface EtherscanAbiResponse {
  status: string;
  result: string;
  message?: string;
}

interface EtherscanContractInfo {
  SourceCode?: string;
  ABI?: string;
  ContractName?: string;
  CompilerVersion?: string;
  OptimizationUsed?: string;
  Runs?: string;
  ConstructorArguments?: string;
  EVMVersion?: string;
  Library?: string;
  LicenseType?: string;
  Proxy?: string;
  Implementation?: string;
  SwarmSource?: string;
}

interface EtherscanSourceResponse {
  status: string;
  result: EtherscanContractInfo[];
  message?: string;
}

interface SourceCodeResult {
  sourceCode: string | { [key: string]: { content: string } };
  abi?: AbiItem[];
  compilerVersion?: string;
  optimizationUsed?: boolean;
  runs?: number;
  contractName?: string;
  constructorArgs?: string;
}

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

async function fetchAbiFromEtherscan(address: string, chainId: number): Promise<AbiItem[] | null> {
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

async function fetchSourceCodeFromEtherscan(address: string, chainId: number): Promise<SourceCodeResult | null> {
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

  result.optimizationUsed = contract.OptimizationUsed === '1' || contract.OptimizationUsed === 'true';
  if (result.optimizationUsed && contract.Runs) {
    result.runs = parseInt(contract.Runs, 10);
  }

  if (contract.ContractName) {
    result.contractName = contract.ContractName;
  }

  if (contract.ConstructorArguments) {
    result.constructorArgs = contract.ConstructorArguments;
  }

  return result;
}

interface SourcifyFile {
  name: string;
  content: string;
}

interface SourcifyMetadata {
  output?: { abi?: AbiItem[] };
  compiler?: { version: string };
  settings?: {
    optimizer?: { enabled: boolean; runs?: number };
    compilationTarget?: Record<string, string>;
  };
}

async function fetchFromSourcify(address: string, chainId: number): Promise<SourcifyFile[] | null> {
  const urls = [
    `https://sourcify.dev/server/files/${chainId}/${address}`,
    `https://sourcify.dev/server/files/any/${chainId}/${address}`,
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

async function fetchAbiFromSourcify(address: string, chainId: number): Promise<AbiItem[] | null> {
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

async function fetchSourceCodeFromSourcify(address: string, chainId: number): Promise<Omit<SourceCodeResult, 'constructorArgs'> | null> {
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
    if (metadata.settings?.optimizer?.enabled) {
      result.optimizationUsed = true;
      result.runs = metadata.settings.optimizer.runs;
    } else {
      result.optimizationUsed = false;
    }
  }

  if (contractName) {
    result.contractName = contractName;
  }

  return result;
}

const ERC20_ABI = [
  { name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

const ERC165_ABI = [{
  name: 'supportsInterface',
  type: 'function',
  inputs: [{ type: 'bytes4' }],
  outputs: [{ type: 'bool' }],
}] as const;

const NAME_SYMBOL_ABI = [
  { name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
] as const;

async function detectContractType(
  address: string,
  chainId: number
): Promise<{ type: 'ERC20' | 'ERC721' | 'ERC1155' | 'OTHER'; name?: string; symbol?: string; decimals?: number }> {
  const client = getClient(chainId);
  const addr = address as Address;

  try {
    const [name, symbol, decimals] = await Promise.allSettled([
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'name' }),
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    if (decimals.status === 'fulfilled' && (name.status === 'fulfilled' || symbol.status === 'fulfilled')) {
      return {
        type: 'ERC20',
        name: name.status === 'fulfilled' ? String(name.value) : undefined,
        symbol: symbol.status === 'fulfilled' ? String(symbol.value) : undefined,
        decimals: Number(decimals.value),
      };
    }
  } catch {
  }

  try {
    const [supportsERC721, supportsERC1155] = await Promise.allSettled([
      client.readContract({ address: addr, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0x80ac58cd' as `0x${string}`] }),
      client.readContract({ address: addr, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0xd9b67a26' as `0x${string}`] }),
    ]);

    if (supportsERC721.status === 'fulfilled' && supportsERC721.value) {
      const [name, symbol] = await Promise.allSettled([
        client.readContract({ address: addr, abi: NAME_SYMBOL_ABI, functionName: 'name' }),
        client.readContract({ address: addr, abi: NAME_SYMBOL_ABI, functionName: 'symbol' }),
      ]);

      return {
        type: 'ERC721',
        name: name.status === 'fulfilled' ? String(name.value) : undefined,
        symbol: symbol.status === 'fulfilled' ? String(symbol.value) : undefined,
      };
    }

    if (supportsERC1155.status === 'fulfilled' && supportsERC1155.value) {
      return { type: 'ERC1155' };
    }
  } catch {
  }

  return { type: 'OTHER' };
}

export async function resolveAddress(
  address: string,
  chainId: number,
  options: {
    useCache?: boolean;
    fetchAbi?: boolean;
    fetchSourceCode?: boolean;
    detectType?: boolean;
  } = {}
): Promise<AddressInfo> {
  const { useCache = true, fetchAbi = true, fetchSourceCode = true, detectType = true } = options;
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
      info.bytecodeHash = hashBytecode(bytecode);

      const proxyInfo = await detectProxyInfo(normalizedAddress, chainId);
      info.isProxy = proxyInfo.isProxy;
      info.proxyType = proxyInfo.proxyType;
      info.implementation = proxyInfo.implementation;
      info.immutable = proxyInfo.immutable;

      const implAddr = Array.isArray(proxyInfo.implementation) 
        ? proxyInfo.implementation[0] 
        : proxyInfo.implementation;
      
      if (proxyInfo.isProxy && implAddr) {
        const implBytecode = await getBytecode(implAddr.toLowerCase(), chainId);
        if (implBytecode) {
          info.implementationBytecode = implBytecode;
          info.implementationBytecodeHash = hashBytecode(implBytecode);
        }
      }

      const abiAddress = implAddr || normalizedAddress;

      if (fetchAbi || fetchSourceCode) {
        let sourceResult: (SourceCodeResult | Omit<SourceCodeResult, 'constructorArgs'>) | null = null;
        let sourceSource: 'etherscan' | 'sourcify' | null = null;

        if (fetchSourceCode) {
          sourceResult = await fetchSourceCodeFromEtherscan(abiAddress, chainId);
          if (sourceResult) {
            sourceSource = 'etherscan';
          } else {
            sourceResult = await fetchSourceCodeFromSourcify(abiAddress, chainId);
            if (sourceResult) {
              sourceSource = 'sourcify';
            }
          }
        }

        if (sourceResult) {
          info.sourceCode = sourceResult.sourceCode;
          info.sourceCodeSource = sourceSource;
          info.compilerVersion = sourceResult.compilerVersion;
          info.optimizationUsed = sourceResult.optimizationUsed;
          info.runs = sourceResult.runs;
          info.contractName = sourceResult.contractName;
          if ('constructorArgs' in sourceResult && sourceResult.constructorArgs) {
            info.constructorArgs = sourceResult.constructorArgs;
          }
          if (info.isProxy && sourceResult.contractName) {
            info.implementationContractName = sourceResult.contractName;
          }
        }

        if (fetchAbi) {
          if (sourceResult?.abi) {
            info.abi = sourceResult.abi;
            info.abiSource = sourceSource;
          } else {
            const etherscanAbi = await fetchAbiFromEtherscan(abiAddress, chainId);
            if (etherscanAbi) {
              info.abi = etherscanAbi;
              info.abiSource = 'etherscan';
            } else {
              const sourcifyAbi = await fetchAbiFromSourcify(abiAddress, chainId);
              if (sourcifyAbi) {
                info.abi = sourcifyAbi;
                info.abiSource = 'sourcify';
              }
            }
          }
        }
      }

      if (detectType) {
        const typeInfo = await detectContractType(normalizedAddress, chainId);
        Object.assign(info, typeInfo);
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

export {
  loadCachedAddress,
  saveAddressInfo,
  getAddressFilePath,
  WORKSPACE_DIR,
};
