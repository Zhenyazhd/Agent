import { readFileSync } from 'fs';
import { join } from 'path';
import type { TraceDoc } from '../decoder/types.js';
import {
  writeJson,
  loadTraceFiles,
  funcLabel,
  funcName,
  argsSummary,
  outputPreview,
} from '../utils/index.js';

// ── Output types ─────────────────────────────────────────────────────

export interface CompactCall {
  call_id: number;
  parent: number | null;
  children: number[];
  depth: number;
  from: string;
  to: string;
  call_type: string;
  func: string | null;
  args: string;
  value: string;
  success: boolean;
  has_logs: boolean;
  log_names: string[];
  output_preview: string;
}

export interface LoopIteration {
  iteration: number;
  calls: number[];
  pattern: string[];
  key_values: Record<string, string>;
}

export interface LoopGroup {
  name: string;
  parent_call_id: number;        
  depth: number;               
  iterations: LoopIteration[];
  pattern: string[];            
  total_calls: number;
}

export interface KeyCall {
  call_id: number;
  reason: string;
  func: string | null;
  from: string;
  to: string;
  value: string;
  call_type: string;
  depth: number;
  log_names: string[];
  args_summary: string;
  output_preview: string;
}

export interface Phase {
  name: string;
  call_ids: number[];
  description: string;
}

export interface CollapseResult {
  compact_traces: CompactCall[];
  loop_groups: LoopGroup[];
  key_calls: KeyCall[];
  phases: Phase[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function loadTraces(txDir: string): TraceDoc[] {
  const files = loadTraceFiles(txDir);
  return files.map(f => JSON.parse(readFileSync(join(txDir, f), 'utf-8')));
}

// ── 1. Compact traces ────────────────────────────────────────────────

function buildCompactTraces(traces: TraceDoc[]): CompactCall[] {
  return traces.map(t => ({
    call_id: t.call_id,
    parent: t.parent,
    children: t.children,
    depth: t.depth,
    from: t.from,
    to: t.to,
    call_type: t.call_type,
    func: funcLabel(t),
    args: argsSummary(t),
    value: t.value,
    success: t.success,
    has_logs: t.logs.length > 0,
    log_names: t.logs.map(l => l.name).filter((n): n is string => n !== null),
    output_preview: outputPreview(t),
  }));
}

// ── 2. Loop detection (O(n) precompute, then scan) ───────────────────

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function sequenceHash(sequence: string[]): string {
  const M1 = 31;
  const M2 = 37;
  let h1 = 0;
  let h2 = 0;
  for (const s of sequence) {
    const v = hashString(s);
    h1 = ((h1 * M1) + v) >>> 0;
    h2 = ((h2 * M2) + v) >>> 0;
  }
  return `${h1.toString(16)}:${h2.toString(16)}`;
}

interface SubtreeFingerprint {
  rootCallId: number;
  sequence: string[];
  hash: string;
  rootFunc: string;
  allCalls: number[];
  rootArgSummary: string;
  rootOutput: string;
  rootValue: string;
}

function isReadOnly(t: TraceDoc): boolean {
  if (t.call_type === 'STATICCALL') return true;
  if (t.call_type === 'DELEGATECALL' && t.logs.length === 0 && t.value === '0') return true;
  return false;
}

function funcSignature(t: TraceDoc): string {
  return funcName(t) + '@' + (t.to || '').toLowerCase();
}


function precompute(traceMap: Map<number, TraceDoc>): {
  subtreeMap: Map<number, number[]>;
  fingerprintMap: Map<number, SubtreeFingerprint>;
} {
  const subtreeMap = new Map<number, number[]>();
  const fingerprintMap = new Map<number, SubtreeFingerprint>();
  const byDepthDesc = [...traceMap.values()].sort((a, b) => b.depth - a.depth);

  for (const trace of byDepthDesc) {
    const id = trace.call_id;

    const allCalls: number[] = [id];
    for (const childId of trace.children) {
      const childSub = subtreeMap.get(childId);
      if (childSub) {
        for (const cid of childSub) allCalls.push(cid);
      }
    }
    subtreeMap.set(id, allCalls);

    const sequence: string[] = [];
    if (!isReadOnly(trace)) {
      sequence.push(funcSignature(trace));
    }
    for (const childId of trace.children) {
      const childFp = fingerprintMap.get(childId);
      if (childFp) {
        for (const s of childFp.sequence) sequence.push(s);
      }
    }

    const hash = sequenceHash(sequence);

    fingerprintMap.set(id, {
      rootCallId: id,
      sequence,
      hash,
      rootFunc: funcSignature(trace),
      allCalls,
      rootArgSummary: argsSummary(trace),
      rootOutput: outputPreview(trace),
      rootValue: trace.value,
    });
  }

  return { subtreeMap, fingerprintMap };
}

function buildIterationKeyValues(fps: SubtreeFingerprint[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const fp of fps) {
    if (fp.rootArgSummary) kv[`${fp.rootFunc}_args`] = fp.rootArgSummary;
    if (fp.rootOutput) kv[`${fp.rootFunc}_output`] = fp.rootOutput;
    if (fp.rootValue !== '0') kv[`${fp.rootFunc}_value`] = fp.rootValue;
  }
  return kv;
}

function findLoopsInChildren(fingerprints: SubtreeFingerprint[]): LoopGroup[] {
  if (fingerprints.length < 2) return [];

  const groups: LoopGroup[] = [];

  let i = 0;
  while (i < fingerprints.length) {
    const cur = fingerprints[i];
    const run: SubtreeFingerprint[] = [cur];
    let j = i + 1;
    while (j < fingerprints.length && fingerprints[j].hash === cur.hash) {
      run.push(fingerprints[j]);
      j++;
    }
    if (run.length >= 2) {
      groups.push(makeLoopGroup(`${cur.rootFunc} loop`, run.map(fp => [fp])));
    }
    i = j;
  }

  if (groups.length > 0) return groups;

  const funcSeq = fingerprints.map(fp => fp.rootFunc);
  const n = funcSeq.length;

  for (let start = 0; start < n; start++) {
    const maxCycleLen = Math.floor((n - start) / 2);
    for (let cycleLen = 2; cycleLen <= maxCycleLen; cycleLen++) {
      let repeats = 0;
      let pos = start;
      while (pos + cycleLen <= n) {
        let match = true;
        for (let k = 0; k < cycleLen; k++) {
          if (funcSeq[pos + k] !== funcSeq[start + k]) {
            match = false;
            break;
          }
        }
        if (!match) break;
        repeats++;
        pos += cycleLen;
      }
      if (repeats >= 2) {
        const iterChunks: SubtreeFingerprint[][] = [];
        for (let it = 0; it < repeats; it++) {
          iterChunks.push(
            fingerprints.slice(start + it * cycleLen, start + (it + 1) * cycleLen),
          );
        }
        const pattern = funcSeq.slice(start, start + cycleLen);
        groups.push(makeLoopGroup(`${pattern.join(' → ')} cycle`, iterChunks));
        return groups;
      }
    }
  }

  return groups;
}

function makeLoopGroup(name: string, iterChunks: SubtreeFingerprint[][]): LoopGroup {
  const iterations: LoopIteration[] = iterChunks.map((fps, idx) => ({
    iteration: idx,
    calls: fps.flatMap(fp => fp.allCalls),
    pattern: fps.flatMap(fp => fp.sequence),
    key_values: buildIterationKeyValues(fps),
  }));
  return {
    name,
    parent_call_id: -1,
    depth: -1,
    iterations,
    pattern: iterChunks[0].map(fp => fp.rootFunc),
    total_calls: iterations.reduce((s, it) => s + it.calls.length, 0),
  };
}

function detectLoops(
  traceMap: Map<number, TraceDoc>,
  fingerprintMap: Map<number, SubtreeFingerprint>,
): LoopGroup[] {
  const allGroups: LoopGroup[] = [];

  for (const [callId, trace] of traceMap) {
    if (trace.children.length < 4) continue;

    const fps: SubtreeFingerprint[] = [];
    for (const childId of trace.children) {
      const fp = fingerprintMap.get(childId);
      if (fp) fps.push(fp);
    }

    const groups = findLoopsInChildren(fps);
    for (const g of groups) {
      g.parent_call_id = callId;
      g.depth = trace.depth;
    }
    allGroups.push(...groups);
  }

  return allGroups;
}

// ── 3. Key calls identification ──────────────────────────────────────

function identifyKeyCalls(
  traces: TraceDoc[],
  loopGroups: LoopGroup[],
): KeyCall[] {
  const keyCalls: KeyCall[] = [];

  const redundant = new Set<number>();
  for (const g of loopGroups) {
    for (let i = 1; i < g.iterations.length; i++) {
      for (const id of g.iterations[i].calls) redundant.add(id);
    }
  }

  const firstIterCalls = new Set<number>();
  for (const g of loopGroups) {
    if (g.iterations.length > 0) {
      for (const id of g.iterations[0].calls) firstIterCalls.add(id);
    }
  }

  for (const t of traces) {
    if (redundant.has(t.call_id)) continue;

    const reasons: string[] = [];

    if (t.parent === null || t.depth === 0) reasons.push('root call');

    if (t.value !== '0') reasons.push('ETH transfer');

    if (t.logs.length > 0) {
      const names = t.logs.map(l => l.name).filter(Boolean);
      if (names.length > 0) reasons.push(`emits: ${names.join(', ')}`);
    }

    if (!t.success) reasons.push('FAILED');

    if (reasons.length === 0 && firstIterCalls.has(t.call_id)) {
      reasons.push('first in loop pattern');
    }

    if (reasons.length === 0) {
      if (t.call_type === 'DELEGATECALL' && t.logs.length === 0 && t.value === '0') continue;
      if (t.call_type === 'STATICCALL' && t.logs.length === 0) continue;
    }

    if (reasons.length > 0) {
      keyCalls.push({
        call_id: t.call_id,
        reason: reasons.join('; '),
        func: funcLabel(t),
        from: t.from,
        to: t.to,
        value: t.value,
        call_type: t.call_type,
        depth: t.depth,
        log_names: t.logs.map(l => l.name).filter((n): n is string => n !== null),
        args_summary: argsSummary(t),
        output_preview: outputPreview(t),
      });
    }
  }

  return keyCalls;
}

// ── 4. Phase detection ───────────────────────────────────────────────

function detectPhases(
  traces: TraceDoc[],
  loopGroups: LoopGroup[],
): Phase[] {
  const phases: Phase[] = [];
  const traceMap = new Map(traces.map(t => [t.call_id, t]));

  const root = traces.find(t => t.parent === null || t.depth === 0);
  if (!root) return phases;

  const loopCallIds = new Set<number>();
  for (const g of loopGroups) {
    for (const it of g.iterations) {
      for (const id of it.calls) loopCallIds.add(id);
    }
  }

  const loopParents = new Set(loopGroups.map(g => g.parent_call_id));

  let cur: { name: string; ids: number[]; desc: string } | null = null;

  for (const childId of root.children) {
    const child = traceMap.get(childId);
    if (!child) continue;

    const fn = funcName(child);
    let phaseName: string;
    let phaseDesc: string;

    if (loopCallIds.has(childId)) {
      phaseName = 'exploit_loop';
      phaseDesc = 'Repeating exploit cycle';
    } else if (loopParents.has(childId)) {
      phaseName = 'exploit_loop';
      phaseDesc = 'Contains nested loop';
    } else if (/repay|flashLoan/i.test(fn)) {
      phaseName = 'flashloan';
      phaseDesc = fn.includes('repay') ? 'Flash loan repay' : 'Flash loan borrow';
    } else if (fn === 'ETH_TRANSFER' || fn === 'FALLBACK') {
      phaseName = 'value_transfer';
      phaseDesc = 'ETH transfers (profit extraction, bribes)';
    } else {
      phaseName = 'other';
      phaseDesc = fn;
    }

    if (cur && cur.name === phaseName) {
      cur.ids.push(childId);
    } else {
      if (cur) phases.push({ name: cur.name, call_ids: cur.ids, description: cur.desc });
      cur = { name: phaseName, ids: [childId], desc: phaseDesc };
    }
  }
  if (cur) phases.push({ name: cur.name, call_ids: cur.ids, description: cur.desc });

  return phases;
}

// ── Main: collapse ───────────────────────────────────────────────────

export function collapseTraces(txDir: string): CollapseResult {
  const traces = loadTraces(txDir);
  const traceMap = new Map(traces.map(t => [t.call_id, t]));

  const compact_traces = buildCompactTraces(traces);

  const { fingerprintMap } = precompute(traceMap);

  const loop_groups = detectLoops(traceMap, fingerprintMap);
  const key_calls = identifyKeyCalls(traces, loop_groups);
  const phases = detectPhases(traces, loop_groups);

  return { compact_traces, loop_groups, key_calls, phases };
}

// ── Write results ────────────────────────────────────────────────────

export function writeCollapseResults(txDir: string, result: CollapseResult): void {
  writeJson(join(txDir, 'compact_traces.json'), result.compact_traces);
  writeJson(join(txDir, 'loop_groups.json'), result.loop_groups);
  writeJson(join(txDir, 'key_calls.json'), result.key_calls);
  writeJson(join(txDir, 'phases.json'), result.phases);
}
