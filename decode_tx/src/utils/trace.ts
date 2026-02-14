import type { TraceDoc } from '../decoder/types.js';
import { humanizeUint } from './primitives.js';

export function funcLabel(trace: TraceDoc): string | null {
  if (trace.effective_signature && !trace.effective_signature.startsWith('unknown(')) {
    return trace.effective_signature;
  }
  if (trace.signature) return trace.signature;
  if (trace.selector) return trace.selector;
  return null;
}

export function funcName(trace: TraceDoc): string {
  const label = funcLabel(trace);
  if (!label) {
    if (trace.call_type === 'SELFDESTRUCT') return 'SELFDESTRUCT';
    if (trace.value !== '0') return 'ETH_TRANSFER';
    switch (trace.call_type) {
      case 'SELFDESTRUCT': return 'SELFDESTRUCT';
      case 'DELEGATECALL': return 'DELEGATE_FALLBACK';
      case 'STATICCALL':   return 'STATIC_FALLBACK';
      case 'CREATE':
      case 'CREATE2':      return trace.call_type;
      default:             return 'FALLBACK';
    }
  }
  const match = label.match(/^([^(]+)/);
  return match ? match[1] : label;
}

export function argsSummary(trace: TraceDoc): string {
  if (trace.args_pretty.length === 0) return '';
  return trace.args_pretty
    .map(a => {
      const v = a.value;
      if (a.type === 'address') return v;
      if (v.startsWith('0x') && v.length > 66) return v.slice(0, 66) + '...';
      if (a.type.startsWith('uint') || a.type.startsWith('int')) return humanizeUint(v);
      return v;
    })
    .join(', ');
}


export function outputPreview(trace: TraceDoc): string {
  if (!trace.output || trace.output === '0x') return '';
  if (trace.output.length <= 66) return trace.output;
  return trace.output.slice(0, 66) + '...';
}
