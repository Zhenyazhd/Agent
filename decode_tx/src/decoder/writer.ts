import { join } from 'path';
import type { 
  DecodedTransactionWithHierarchy, 
  TraceDoc,
  EnrichedTraceCall,
  ContractMeta,
  AddressRole,
  TxMeta,
  SourceLink,
  ExecutionContext,
  ArgPretty
} from './types.js';
import {
  ensureDir,
  writeJson,
  readJson,
  extractFunctionName,
  normalizeAddress,
  addressFilePath,
  computeEffectiveSignature,
} from '../utils/index.js';

import { parseArgRaw, detectArgType, extractLabel } from '../utils/index.js';


// ── Arg parsing utils ─────────────────────────────────────────────────


export function parseArgPretty(arg: string): ArgPretty {
  const value = parseArgRaw(arg);
  const type = detectArgType(value);
  const label = extractLabel(arg);
  const result: ArgPretty = { type, value };
  if (label) result.label = label;
  return result;
}

// ── Classification ────────────────────────────────────────────────────

const DEX_SIG_RE = /swap|liquidity|getAmounts|exactInput|exactOutput/i;
const DEX_EVENT_RE = /^Swap$/;

function classifyAddressRole(
  call: EnrichedTraceCall,
  contractMeta: Record<string, ContractMeta>,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): AddressRole {
  const addr = normalizeAddress(call.to);
  const meta = contractMeta[addr];

  if (meta) {
    if (meta.type === 'PROXY') return 'Proxy';
    if (meta.type === 'ERC20' || meta.type === 'ERC721' || meta.type === 'ERC1155') return 'Token';
  }

  if (resolvedAddresses) {
    const resolved = resolvedAddresses.get(addr);
    if (resolved?.isProxy) return 'Proxy';
    //if (resolved && !resolved.isContract) return 'EOA';
  }

  if (call.signature && DEX_SIG_RE.test(call.signature)) return 'DEX';
  if (call.logs.some(l => l.name && DEX_EVENT_RE.test(l.name))) return 'DEX';
  //if (!call.signature && call.input === '0x') return 'EOA';

  return 'Other';
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildSourceLink(call: EnrichedTraceCall): SourceLink {
  const link: SourceLink = { address: call.to };
  if (call.signature) {
    const fn = extractFunctionName(call.signature);
    if (fn) link.functionName = fn;
  }
  return link;
}

function getExecutionContext(
  call: EnrichedTraceCall,
  callsByIndex: Map<number, EnrichedTraceCall>,
  parentContexts: Map<number, ExecutionContext>
): ExecutionContext {
  if (call.callType === 'DELEGATECALL') {
    const parent =
      call.parentIndex != null ? callsByIndex.get(call.parentIndex) : null;

    const parentCtx = parent ? parentContexts.get(parent.index) : undefined;

    const fallbackMsgSender = parentCtx?.msg_sender ?? parent?.from ?? call.from;
    return {
      code_address: call.to,
      storage_address: parentCtx?.storage_address ?? call.from,
      msg_sender: fallbackMsgSender,
      this_address: parentCtx?.this_address ?? call.from,
    };
  }

  return {
    code_address: call.to,
    storage_address: call.to,
    msg_sender: call.from,
    this_address: call.to,
  };
}

// ── Builders ──────────────────────────────────────────────────────────

export function buildTraceDocs(
  decoded: DecodedTransactionWithHierarchy,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): TraceDoc[] {
  const callsByIndex = new Map<number, EnrichedTraceCall>();
  for (const call of decoded.traceCalls) {
    callsByIndex.set(call.index, call);
  }
  const sorted = [...decoded.traceCalls].sort((a, b) =>
    a.depth !== b.depth ? a.depth - b.depth : a.index - b.index
  );
  const executionContexts = new Map<number, ExecutionContext>();
  for (const call of sorted) {
    executionContexts.set(call.index, getExecutionContext(call, callsByIndex, executionContexts));
  }

  return decoded.traceCalls.map(call => {
    const rawArgs = call.args;
    const effSig = computeEffectiveSignature(call.signature, call.selector);

    return {
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
      signature: call.signature !== effSig ? null : call.signature,
      effective_signature: effSig,
      args_raw: rawArgs.map(parseArgRaw),
      args_pretty: rawArgs.map(parseArgPretty),

      logs: call.logs.map(log => ({
        name: log.name,
        topics: log.topics,
        data: log.data,
        decoded_params: log.params.length > 0
          ? log.params.map(p => ({ name: p.name, value: p.value }))
          : null,
      })),

      execution_context: executionContexts.get(call.index)!,

      address_role: classifyAddressRole(call, decoded.contractMeta, resolvedAddresses),
      source_links: buildSourceLink(call),

      gas_used: call.gasUsed,
      gas_limit: call.gasLimit,
      label: call.label,
      output: call.output,
      input: call.input,
    };
  });
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
    root_gas_used: decoded.rootGasUsed,
    addresses: decoded.addresses,
    total_logs: decoded.allLogs.length,
    trace_doc_count: docCount,
  };
}

// ── Source link enrichment ────────────────────────────────────────────

function sourceLinks(docs: TraceDoc[], workspaceDir: string, chainId: number): void {
  const cache = new Map<string, { contractName?: string; filePath?: string }>();

  for (const doc of docs) {
    const addr = normalizeAddress(doc.to);
    if (cache.has(addr)) {
      const cached = cache.get(addr)!;
      if (cached.filePath) doc.source_links.filePath = cached.filePath;
      continue;
    }

    const addrFile = addressFilePath(workspaceDir, addr, chainId);
    const info = readJson(addrFile);
    if (info) {
      const entry: { contractName?: string; filePath?: string } = { filePath: addrFile };
      if (info.contractName) entry.contractName = info.contractName;
      cache.set(addr, entry);
      doc.source_links.filePath = addrFile;
    } else {
      cache.set(addr, {});
    }
  }
}

// ── Write to disk ─────────────────────────────────────────────────────

export async function writeTraceDocs(
  decoded: DecodedTransactionWithHierarchy,
  baseDir: string,
  resolvedAddresses?: Map<string, { isContract: boolean; isProxy?: boolean }>
): Promise<{ dir: string; count: number }> {
  const txDir = join(baseDir, decoded.txHash);
  ensureDir(txDir);

  const docs = buildTraceDocs(decoded, resolvedAddresses);

  sourceLinks(docs, baseDir, decoded.chainId);

  for (const doc of docs) {
    writeJson(join(txDir, `trace_${doc.call_id}.json`), doc);
  }

  const meta = buildTxMeta(decoded, docs.length);
  writeJson(join(txDir, 'tx_meta.json'), meta);

  return { dir: txDir, count: docs.length };
}
