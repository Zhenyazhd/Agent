import type { DecodedTransactionWithHierarchy } from './types.js';
import { normalizeAddress } from '../utils/index.js';

const callTypeIcons: Record<string, string> = {
  'CALL': '→', 'DELEGATECALL': '⇢', 'STATICCALL': '⇠', 'CREATE': '+', 'CREATE2': '++',
};

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
  lines.push(`Gas Used: ${decoded.rootGasUsed}`);
  lines.push('');
  lines.push('=== Call Trace ===');
  lines.push('');

  for (const call of decoded.traceCalls) {
    const indent = '  '.repeat(call.depth);
    const icon = callTypeIcons[call.callType] || '?';
    const contractName = decoded.contractMeta[normalizeAddress(call.to)]?.name || '';
    const contractLabel = contractName ? `[${contractName}]` : '';

    let funcName = call.signature || 'unknown';
    if ((funcName === 'fallback()' || funcName === 'unknown') && call.selector && call.selector !== '0x') {
      funcName = call.selector;
    }
    const valueStr = call.value !== '0' ? `{value: ${call.valueDecimal} ETH}` : '';
    const successStr = call.success ? '' : ' [FAILED]';

    lines.push(`${indent}${icon} ${call.to}${contractLabel}::${funcName}${valueStr}${successStr}`);

    for (const arg of call.args) {
      lines.push(`${indent}    arg: ${arg}`);
    }

    for (const log of call.logs) {
      const logName = log.name || 'UnknownEvent';
      const params = log.params.map(p => `${p.name}: ${p.value}`).join(', ');
      lines.push(`${indent}    emit ${logName}(${params})`);
    }
  }

  return lines.join('\n');
}
