import { execSync } from 'child_process';
import { parseFullNumber, hexToDecimal, weiToEth, normalizeAddress, CHAINS, extractSelector } from '../utils/index.js';
import type {
  CastRunOutput,
  EnrichedTraceCall,
  EnrichedLog,
  DecodedTransactionWithHierarchy,
} from './types.js';


export function transformCastOutput(castOutput: CastRunOutput): EnrichedTraceCall[] {
  return castOutput.arena.map(node => {
    const { trace, logs, idx, parent, children } = node;

    const enrichedLogs: EnrichedLog[] = logs.map(log => ({
      index: log.index,
      name: log.decoded?.name || null,
      params: log.decoded?.params?.map(([name, rawValue]) => ({
        name, value: parseFullNumber(rawValue)
      })) || [],
      topics: log.raw_log.topics,
      data: log.raw_log.data,
    }));

    const valueWei = hexToDecimal(trace.value);

    return {
      depth: trace.depth,
      index: idx,
      parentIndex: parent,
      childrenIndices: children,
      callType: trace.kind,
      from: trace.caller,
      to: trace.address,
      value: valueWei,
      valueDecimal: weiToEth(valueWei),
      signature: trace.decoded?.call_data?.signature || null,
      selector: extractSelector(trace.data),
      args: (trace.decoded?.call_data?.args || []).map(parseFullNumber),
      success: trace.success,
      output: trace.output,
      gasUsed: trace.gas_used,
      gasLimit: trace.gas_limit,
      input: trace.data,
      logs: enrichedLogs,
      label: trace.decoded?.label || null,
    };
  });
}

export async function decodeTransactionWithCast(
  txHash: string,
  chainId: number = 1
): Promise<DecodedTransactionWithHierarchy | null> {
  console.log(`Decoding transaction ${txHash} on chain ${chainId} using cast...`);

  let castOutput: CastRunOutput | null;
  const rpcUrl = (CHAINS[chainId] || CHAINS[1]).rpcUrl;
  try {
    const result = execSync(
      `cast run ${txHash} --rpc-url "${rpcUrl}" --json`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    castOutput = JSON.parse(result) as CastRunOutput;
  } catch (error: any) {
    console.error('Failed to get cast trace:', error.message);
    castOutput = null;
  }

  if (!castOutput?.arena?.length) {
    console.error('Failed to get trace from cast');
    return null;
  }

  const traceCalls = transformCastOutput(castOutput);
  const allLogs = traceCalls.flatMap(c => c.logs).sort((a, b) => a.index - b.index);
  const rootCall = traceCalls.find(c => c.parentIndex === null) || traceCalls[0];

  const addressSet = new Set<string>();
  for (const call of traceCalls) {
    if (call.from) addressSet.add(normalizeAddress(call.from));
    if (call.to) addressSet.add(normalizeAddress(call.to));
  }
  addressSet.delete('');

  return {
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
    addresses: [...addressSet].sort(),
    totalCalls: traceCalls.length,
    maxDepth: Math.max(...traceCalls.map(c => c.depth), 0),
    rootGasUsed: rootCall.gasUsed,
    success: rootCall.success,
    contractMeta: {},
  };
}

