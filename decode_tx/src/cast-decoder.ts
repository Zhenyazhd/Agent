import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { getPublicClient } from './provider.js';

interface CastTraceNode {
  parent: number | null;
  children: number[];
  idx: number;
  trace: {
    depth: number;
    success: boolean;
    caller: string;
    address: string;
    maybe_precompile: boolean | null;
    selfdestruct_address: string | null;
    selfdestruct_refund_target: string | null;
    selfdestruct_transferred_value: string | null;
    kind: 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2';
    value: string;
    data: string;
    output: string;
    gas_used: number;
    gas_limit: number;
    status: string;
    steps: any[];
    decoded: {
      label: string | null;
      return_data: any;
      call_data: {
        signature: string;
        args: string[];
      } | null;
    };
  };
  logs: CastLogEntry[];
}

interface CastLogEntry {
  raw_log: {
    topics: string[];
    data: string;
  };
  decoded: {
    name: string | null;
    params: [string, string][] | null;
  };
  position: number;
  index: number;
}

interface CastRunOutput {
  arena: CastTraceNode[];
}

export type ParsedArg = string;

export interface EnrichedTraceCall {
  depth: number;
  index: number;
  parentIndex: number | null;
  childrenIndices: number[];
  callType: 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2';
  from: string;
  to: string;
  value: string;
  valueDecimal: string;
  signature: string | null;
  selector: string | null;
  args: ParsedArg[];
  success: boolean;
  output: string;
  gasUsed: number;
  gasLimit: number;
  input: string;
  logs: EnrichedLog[];
  label: string | null;
}

export interface EnrichedLog {
  index: number;
  name: string | null;
  params: { name: string; value: string }[];
  topics: string[];
  data: string;
}

export interface DecodedTransactionWithHierarchy {
  txHash: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  valueDecimal: string;
  functionSignature: string | null;
  functionArgs: ParsedArg[];
  traceCalls: EnrichedTraceCall[];
  allLogs: EnrichedLog[];
  addresses: string[];
  totalCalls: number;
  maxDepth: number;
  totalGasUsed: number;
  success: boolean;
  contractMeta: Record<string, ContractMeta>;
}

export interface ContractMeta {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  type: 'ERC20' | 'ERC721' | 'ERC1155' | 'PROXY' | 'OTHER';
}

const CHAIN_RPC_URLS: Record<number, string> = {
  1: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  137: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
  42161: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
  10: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
  8453: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
  56: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
  43114: process.env.AVALANCHE_RPC_URL || 'https://avalanche.llamarpc.com',
};

function getRpcUrl(chainId: number): string {
  return CHAIN_RPC_URLS[chainId] || CHAIN_RPC_URLS[1];
}

function hexToDecimal(hex: string): string {
  if (!hex || hex === '0x' || hex === '0x0') return '0';
  try {
    return BigInt(hex).toString();
  } catch {
    return '0';
  }
}

function weiToEth(wei: string): string {
  try {
    const weiBigInt = BigInt(wei);
    const ethValue = Number(weiBigInt) / 1e18;
    return ethValue.toString();
  } catch {
    return '0';
  }
}

function extractSelector(data: string): string | null {
  if (!data || data.length < 10) return null;
  return data.slice(0, 10);
}

function parseFullNumber(value: string): string {
  if (!value) return value;

  if (/^-?\d+$/.test(value) || /^0x[a-fA-F0-9]+$/.test(value)) {
    return value;
  }

  const match = value.match(/^(-?\d+)\s*\[/);
  if (match) {
    return match[1];
  }

  const numMatch = value.match(/^(-?\d+)/);
  if (numMatch) {
    return numMatch[1];
  }

  return value;
}

function parseArgs(args: string[]): string[] {
  return args.map(arg => parseFullNumber(arg));
}

export async function getCastTrace(txHash: string, chainId: number = 1): Promise<CastRunOutput | null> {
  const rpcUrl = getRpcUrl(chainId);

  try {
    const result = execSync(
      `cast run ${txHash} --rpc-url "${rpcUrl}" --json`,
      {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, 
        timeout: 120000
      }
    );

    return JSON.parse(result) as CastRunOutput;
  } catch (error: any) {
    console.error('Failed to get cast trace:', error.message);
    return null;
  }
}

function transformCastOutput(castOutput: CastRunOutput): EnrichedTraceCall[] {
  const { arena } = castOutput;
  const enrichedCalls: EnrichedTraceCall[] = [];

  for (const node of arena) {
    const { trace, logs, idx, parent, children } = node;

    const enrichedLogs: EnrichedLog[] = logs.map(log => ({
      index: log.index,
      name: log.decoded?.name || null,
      params: log.decoded?.params?.map(([name, rawValue]) => ({
        name,
        value: parseFullNumber(rawValue)
      })) || [],
      topics: log.raw_log.topics,
      data: log.raw_log.data,
    }));

    const valueWei = hexToDecimal(trace.value);
    const valueEth = weiToEth(valueWei);

    const enrichedCall: EnrichedTraceCall = {
      depth: trace.depth,
      index: idx,
      parentIndex: parent,
      childrenIndices: children,

      callType: trace.kind,
      from: trace.caller,
      to: trace.address,
      value: valueWei,
      valueDecimal: valueEth,

      signature: trace.decoded?.call_data?.signature || null,
      selector: extractSelector(trace.data),
      args: parseArgs(trace.decoded?.call_data?.args || []),

      success: trace.success,
      output: trace.output,
      gasUsed: trace.gas_used,
      gasLimit: trace.gas_limit,

      input: trace.data,
      logs: enrichedLogs,
      label: trace.decoded?.label || null,
    };

    enrichedCalls.push(enrichedCall);
  }

  return enrichedCalls;
}

function extractAllLogs(traceCalls: EnrichedTraceCall[]): EnrichedLog[] {
  const allLogs: EnrichedLog[] = [];

  for (const call of traceCalls) {
    allLogs.push(...call.logs);
  }
  allLogs.sort((a, b) => a.index - b.index);

  return allLogs;
}

function getMaxDepth(traceCalls: EnrichedTraceCall[]): number {
  return Math.max(...traceCalls.map(c => c.depth), 0);
}

function getTotalGas(traceCalls: EnrichedTraceCall[]): number {
  return traceCalls[0]?.gasUsed || 0;
}

export async function decodeTransactionWithCast(
  txHash: string,
  chainId: number = 1
): Promise<DecodedTransactionWithHierarchy | null> {
  console.log(`Decoding transaction ${txHash} on chain ${chainId} using cast...`);

  const castOutput = await getCastTrace(txHash, chainId);

  if (!castOutput || !castOutput.arena || castOutput.arena.length === 0) {
    console.error('Failed to get trace from cast');
    return null;
  }

  const traceCalls = transformCastOutput(castOutput);
  const allLogs = extractAllLogs(traceCalls);
  const rootCall = traceCalls[0];

  const addressSet = new Set<string>();
  for (const call of traceCalls) {
    if (call.from) addressSet.add(call.from.toLowerCase());
    if (call.to) addressSet.add(call.to.toLowerCase());
  }
  addressSet.delete('');
  const addresses = [...addressSet].sort();

  const result: DecodedTransactionWithHierarchy = {
    txHash,
    chainId,

    from: rootCall.from,
    to: rootCall.to,
    value: rootCall.value,
    valueDecimal: rootCall.valueDecimal,

    functionSignature: rootCall.signature,
    functionArgs: rootCall.args,

    traceCalls,
    allLogs,
    addresses,

    totalCalls: traceCalls.length,
    maxDepth: getMaxDepth(traceCalls),
    totalGasUsed: getTotalGas(traceCalls),

    success: rootCall.success,
    contractMeta: {},
  };

  return result;
}

export async function enrichWithContractMeta(
  decoded: DecodedTransactionWithHierarchy
): Promise<DecodedTransactionWithHierarchy> {
  const addresses = new Set<string>();

  for (const call of decoded.traceCalls) {
    addresses.add(call.to.toLowerCase());
    if (call.from) addresses.add(call.from.toLowerCase());
  }

  const { client } = getPublicClient(decoded.chainId);

  for (const address of addresses) {
    try {
      const [name, symbol, decimals] = await Promise.allSettled([
        client.readContract({
          address: address as `0x${string}`,
          abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] }],
          functionName: 'name',
        }),
        client.readContract({
          address: address as `0x${string}`,
          abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] }],
          functionName: 'symbol',
        }),
        client.readContract({
          address: address as `0x${string}`,
          abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] }],
          functionName: 'decimals',
        }),
      ]);

      const hasERC20Methods =
        name.status === 'fulfilled' &&
        symbol.status === 'fulfilled';

      if (hasERC20Methods) {
        decoded.contractMeta[address] = {
          address,
          name: name.status === 'fulfilled' ? name.value as string : null,
          symbol: symbol.status === 'fulfilled' ? symbol.value as string : null,
          decimals: decimals.status === 'fulfilled' ? Number(decimals.value) : null,
          type: 'ERC20',
        };
      }
    } catch {
    }
  }

  return decoded;
}

// ── TraceDoc: one document per call node ──────────────────────────────

export type AddressRole = 'EOA' | 'Proxy' | 'Token' | 'DEX' | 'Other';

export interface TraceDocLog {
  name: string | null;
  topics: string[];
  data: string;
  decoded_params: { name: string; value: string }[] | null;
}

export interface SourceLink {
  address: string;
  functionName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
}

export interface TraceDoc {
  call_id: number;
  parent: number | null;
  children: number[];
  depth: number;

  from: string;
  to: string;
  value: string;
  success: boolean;
  call_type: string;

  selector: string | null;
  signature: string | null;
  args: string[];

  logs: TraceDocLog[];

  address_role: AddressRole;
  source_links: SourceLink;

  gas_used: number;
  gas_limit: number;
  label: string | null;
  output: string;
  input: string;
}

export interface TxMeta {
  tx_hash: string;
  chain_id: number;
  from: string;
  to: string;
  value: string;
  value_decimal: string;
  function_signature: string | null;
  function_args: string[];
  success: boolean;
  total_calls: number;
  max_depth: number;
  total_gas_used: number;
  addresses: string[];
  total_logs: number;
  trace_doc_count: number;
}

const DEX_SIG_RE = /swap|liquidity|getAmounts|exactInput|exactOutput/i;
const DEX_EVENT_RE = /^Swap$/;

function classifyAddressRole(
  call: EnrichedTraceCall,
  contractMeta: Record<string, ContractMeta>,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): AddressRole {
  const addr = call.to.toLowerCase();
  const meta = contractMeta[addr];

  if (meta) {
    if (meta.type === 'PROXY') return 'Proxy';
    if (meta.type === 'ERC20' || meta.type === 'ERC721' || meta.type === 'ERC1155') return 'Token';
  }

  // resolved address info from address-resolver cache
  if (resolvedAddresses) {
    const resolved = resolvedAddresses.get(addr);
    if (resolved?.isProxy) return 'Proxy';
    if (resolved && !resolved.isContract) return 'EOA';
  }

  // DEX heuristic: signature or Swap event
  if (call.signature && DEX_SIG_RE.test(call.signature)) return 'DEX';
  if (call.logs.some(l => l.name && DEX_EVENT_RE.test(l.name))) return 'DEX';

  // plain ETH transfer to address with no function call
  if (!call.signature && call.input === '0x') return 'EOA';

  return 'Other';
}

function buildSourceLink(call: EnrichedTraceCall): SourceLink {
  const link: SourceLink = { address: call.to };
  if (call.signature) {
    const fnMatch = call.signature.match(/^([^(]+)/);
    if (fnMatch) link.functionName = fnMatch[1];
  }
  return link;
}

export function buildTraceDocs(
  decoded: DecodedTransactionWithHierarchy,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): TraceDoc[] {
  return decoded.traceCalls.map(call => ({
    call_id: call.index,
    parent: call.parentIndex,
    children: call.childrenIndices,
    depth: call.depth,

    from: call.from,
    to: call.to,
    value: call.value,
    success: call.success,
    call_type: call.callType,

    selector: call.selector,
    signature: call.signature,
    args: call.args,

    logs: call.logs.map(log => ({
      name: log.name,
      topics: log.topics,
      data: log.data,
      decoded_params: log.params.length > 0
        ? log.params.map(p => ({ name: p.name, value: p.value }))
        : null,
    })),

    address_role: classifyAddressRole(call, decoded.contractMeta, resolvedAddresses),
    source_links: buildSourceLink(call),

    gas_used: call.gasUsed,
    gas_limit: call.gasLimit,
    label: call.label,
    output: call.output,
    input: call.input,
  }));
}

export function buildTxMeta(decoded: DecodedTransactionWithHierarchy, docCount: number): TxMeta {
  return {
    tx_hash: decoded.txHash,
    chain_id: decoded.chainId,
    from: decoded.from,
    to: decoded.to,
    value: decoded.value,
    value_decimal: decoded.valueDecimal,
    function_signature: decoded.functionSignature,
    function_args: decoded.functionArgs,
    success: decoded.success,
    total_calls: decoded.totalCalls,
    max_depth: decoded.maxDepth,
    total_gas_used: decoded.totalGasUsed,
    addresses: decoded.addresses,
    total_logs: decoded.allLogs.length,
    trace_doc_count: docCount,
  };
}

/**
 * Enriches source_links with file paths from resolved address JSON files in WORKSPACE.
 */
function enrichSourceLinksFromCache(docs: TraceDoc[], workspaceDir: string, chainId: number): void {
  const cache = new Map<string, { contractName?: string; filePath?: string }>();

  for (const doc of docs) {
    const addr = doc.to.toLowerCase();
    if (cache.has(addr)) {
      const cached = cache.get(addr)!;
      if (cached.filePath) doc.source_links.filePath = cached.filePath;
      continue;
    }

    const addrFile = join(workspaceDir, `${chainId}_${addr}.json`);
    if (existsSync(addrFile)) {
      try {
        const raw = readFileSync(addrFile, 'utf-8');
        const info = JSON.parse(raw);
        const entry: { contractName?: string; filePath?: string } = {};
        if (info.contractName) entry.contractName = info.contractName;
        entry.filePath = addrFile;
        cache.set(addr, entry);
        doc.source_links.filePath = addrFile;
      } catch {
        cache.set(addr, {});
      }
    } else {
      cache.set(addr, {});
    }
  }
}

export function writeTraceDocs(
  decoded: DecodedTransactionWithHierarchy,
  baseDir: string,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): { dir: string; count: number } {
  const txDir = join(baseDir, decoded.txHash);
  mkdirSync(txDir, { recursive: true });

  const docs = buildTraceDocs(decoded, resolvedAddresses);

  // try to enrich source_links from cached address files
  enrichSourceLinksFromCache(docs, baseDir, decoded.chainId);

  // write each trace doc
  for (const doc of docs) {
    const filePath = join(txDir, `trace_${doc.call_id}.json`);
    writeFileSync(filePath, JSON.stringify(doc, null, 2));
  }

  // write tx_meta.json
  const meta = buildTxMeta(decoded, docs.length);
  writeFileSync(join(txDir, 'tx_meta.json'), JSON.stringify(meta, null, 2));

  return { dir: txDir, count: docs.length };
}

export function formatTraceHierarchy(decoded: DecodedTransactionWithHierarchy): string {
  const lines: string[] = [];

  lines.push(`Transaction: ${decoded.txHash}`);
  lines.push(`Chain: ${decoded.chainId}`);
  lines.push(`From: ${decoded.from}`);
  lines.push(`To: ${decoded.to}`);
  lines.push(`Value: ${decoded.valueDecimal} ETH`);
  lines.push(`Function: ${decoded.functionSignature || 'unknown'}`);
  lines.push(`Success: ${decoded.success}`);
  lines.push(`Total Calls: ${decoded.totalCalls}`);
  lines.push(`Max Depth: ${decoded.maxDepth}`);
  lines.push(`Gas Used: ${decoded.totalGasUsed}`);
  lines.push('');
  lines.push('=== Call Trace ===');
  lines.push('');

  for (const call of decoded.traceCalls) {
    const indent = '  '.repeat(call.depth);
    const callTypeIcon = {
      'CALL': '→',
      'DELEGATECALL': '⇢',
      'STATICCALL': '⇠',
      'CREATE': '+',
      'CREATE2': '++',
    }[call.callType] || '?';

    const contractName = decoded.contractMeta[call.to.toLowerCase()]?.name || '';
    const contractLabel = contractName ? `[${contractName}]` : '';

    let funcName = call.signature || 'unknown';
    if ((funcName === 'fallback()' || funcName === 'unknown') && call.selector && call.selector !== '0x') {
      funcName = call.selector;
    }
    const valueStr = call.value !== '0' ? `{value: ${call.valueDecimal} ETH}` : '';
    const successStr = call.success ? '' : ' [FAILED]';

    lines.push(`${indent}${callTypeIcon} ${call.to}${contractLabel}::${funcName}${valueStr}${successStr}`);

    if (call.args.length > 0) {
      for (const arg of call.args) {
        lines.push(`${indent}    arg: ${arg}`);
      }
    }

    for (const log of call.logs) {
      const logName = log.name || 'UnknownEvent';
      const params = log.params.map(p => `${p.name}: ${p.value}`).join(', ');
      lines.push(`${indent}    emit ${logName}(${params})`);
    }
  }

  return lines.join('\n');
}


