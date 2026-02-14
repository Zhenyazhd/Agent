import { keccak256, toBytes } from 'viem';
import type { AbiFunction, AbiItem } from '../resolver/types.js';

// ── Selector helpers ─────────────────────────────────────────────────

export function computeSelector(signature: string): string {
  return keccak256(toBytes(signature)).slice(0, 10).toLowerCase();
}

export function normalizeSelector(selector: string): string {
  const s = selector.trim().toLowerCase();
  return s.startsWith('0x') ? s : `0x${s}`;
}

export function extractFunctionName(signature: string): string | null {
  const match = signature.match(/^([^(]+)\(/);
  return match ? match[1] : null;
}

// ── ABI type normalization ───────────────────────────────────────────

export function normalizeAbiType(raw: string): string {
  return raw
    .trim()
    .replace(/\s*(memory|calldata|storage)\s*/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

function canonicalSignature(fn: AbiFunction): string {
  const types = (fn.inputs ?? []).map(i => normalizeAbiType(i.type)).join(',');
  return `${fn.name.trim()}(${types})`;
}

export function selectorOfAbiFn(fn: AbiFunction): string {
  return computeSelector(canonicalSignature(fn));
}

// ── ABI lookup ───────────────────────────────────────────────────────

export function findFunctionBySelector(abi: AbiItem[], selector: string): AbiFunction | null {
  const target = normalizeSelector(selector);
  for (const item of abi) {
    if (item.type !== 'function' || !('name' in item)) continue;
    const fn = item as AbiFunction;
    if (computeSelector(canonicalSignature(fn)) === target) return fn;
  }
  return null;
}

// ── ABI merge ────────────────────────────────────────────────────────

function abiEntryQuality(fn: AbiFunction): number {
  let score = 0;
  const inputs = fn.inputs ?? [];
  const outputs = fn.outputs ?? [];

  if (inputs.length > 0) score += 2;
  if (inputs.every(i => i.name && i.name !== '')) score += 2;
  if (outputs.length > 0) score += 1;
  if (outputs.every(o => o.name && o.name !== '')) score += 1;
  if (fn.stateMutability) score += 1;

  return score;
}

export function mergeAbi(existing: AbiItem[], incoming: AbiItem[]): AbiItem[] {
  const bySel = new Map<string, { idx: number; fn: AbiFunction }>();
  const byNameArity = new Map<string, { idx: number; fn: AbiFunction }>();
  const nonFuncSigs = new Set<string>();

  const merged = [...existing];

  for (let i = 0; i < merged.length; i++) {
    const item = merged[i];
    if (item.type === 'function' && 'name' in item) {
      const fn = item as AbiFunction;
      const sel = selectorOfAbiFn(fn);
      const key = `${fn.name.trim()}|${(fn.inputs ?? []).length}`;
      bySel.set(sel, { idx: i, fn });
      byNameArity.set(key, { idx: i, fn });
    } else {
      nonFuncSigs.add(JSON.stringify(item));
    }
  }

  for (const item of incoming) {
    if (item.type === 'function' && 'name' in item) {
      const fn = item as AbiFunction;
      const sel = selectorOfAbiFn(fn);
      const key = `${fn.name.trim()}|${(fn.inputs ?? []).length}`;

      const exactMatch = bySel.get(sel);
      if (exactMatch) {
        if (abiEntryQuality(fn) > abiEntryQuality(exactMatch.fn)) {
          merged[exactMatch.idx] = fn;
          bySel.set(sel, { idx: exactMatch.idx, fn });
          byNameArity.set(key, { idx: exactMatch.idx, fn });
        }
        continue;
      }

      const arityMatch = byNameArity.get(key);
      if (arityMatch) {
        if (abiEntryQuality(fn) > abiEntryQuality(arityMatch.fn)) {
          const oldSel = selectorOfAbiFn(arityMatch.fn);
          bySel.delete(oldSel);
          merged[arityMatch.idx] = fn;
          bySel.set(sel, { idx: arityMatch.idx, fn });
          byNameArity.set(key, { idx: arityMatch.idx, fn });
        }
        continue;
      }

      const idx = merged.length;
      merged.push(fn);
      bySel.set(sel, { idx, fn });
      byNameArity.set(key, { idx, fn });
    } else {
      const sig = JSON.stringify(item);
      if (!nonFuncSigs.has(sig)) {
        nonFuncSigs.add(sig);
        merged.push(item);
      }
    }
  }

  return merged;
}
