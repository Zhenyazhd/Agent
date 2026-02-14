/**
 * Extract and find source code snippets in address data (WORKSPACE JSON).
 */

import { readJson, addressFilePath, escapeRegExp } from '../utils/index.js';

// ── Types ─────────────────────────────────────────────────────────────

export interface NormalizedSource {
  fileName: string;
  lines: string[];
}

export interface SourceMatch {
  snippet: string;
  fileName: string;
  startLine: number;
  endLine: number;
}

// ── Source extraction ─────────────────────────────────────────────────

export function extractSourceTexts(addressData: any): NormalizedSource[] {
  const sc = addressData.sourceCode;
  if (!sc) return [];

  const toLines = (val: unknown): string[] => {
    const content = typeof val === 'string' ? val : (val as any)?.content ?? '';
    return content ? content.split('\n') : [];
  };

  if (typeof sc === 'string') {
    return [{ fileName: 'source.sol', lines: sc.split('\n') }];
  }

  if (typeof sc === 'object' && sc.sources && typeof sc.sources === 'object') {
    return Object.entries(sc.sources).map(([name, val]) => ({
      fileName: name,
      lines: toLines(val),
    }));
  }

  if (typeof sc === 'object') {
    return Object.entries(sc).map(([name, val]) => ({
      fileName: name,
      lines: toLines(val),
    }));
  }

  return [];
}

// ── Snippet extraction ────────────────────────────────────────────────

const LINES_BEFORE = 10;
const LINES_AFTER = 200;

function extractSnippet(
  lines: string[],
  matchLine: number,
): { snippet: string; startLine: number; endLine: number } {
  const start = Math.max(0, matchLine - LINES_BEFORE);
  const end = Math.min(lines.length, matchLine + LINES_AFTER + 1);
  return { snippet: lines.slice(start, end).join('\n'), startLine: start + 1, endLine: end };
}

// ── Search strategies ─────────────────────────────────────────────────

function findByFunctionName(
  lines: string[],
  functionName: string,
): { snippet: string; startLine: number; endLine: number } | null {
  const pattern = new RegExp(`function\\s+${escapeRegExp(functionName)}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return extractSnippet(lines, i);
  }
  return null;
}

function findBySelector(
  lines: string[],
  selector: string,
): { snippet: string; startLine: number; endLine: number } | null {
  const selectorLower = selector.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@custom:selector') && lines[i].toLowerCase().includes(selectorLower)) {
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (/^\s*function\s+/.test(lines[j])) {
          return extractSnippet(lines, j);
        }
      }
      return extractSnippet(lines, i);
    }
  }
  return null;
}

function findBySelectorHex(
  lines: string[],
  selector: string,
): { snippet: string; startLine: number; endLine: number } | null {
  const selectorLower = selector.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(selectorLower)) {
      for (let j = Math.max(0, i - 5); j < Math.min(i + 15, lines.length); j++) {
        if (/^\s*function\s+/.test(lines[j])) {
          return extractSnippet(lines, j);
        }
      }
      return extractSnippet(lines, i);
    }
  }
  return null;
}

type FindStrategy = (lines: string[]) => { snippet: string; startLine: number; endLine: number } | null;

export function findSourceInAddress(
  addressData: any,
  functionName: string | null,
  selector: string | null,
): SourceMatch | null {
  const sources = extractSourceTexts(addressData);

  const strategies: FindStrategy[] = [
    ...(functionName ? [(lines: string[]) => findByFunctionName(lines, functionName)] : []),
    ...(selector ? [
      (lines: string[]) => findBySelector(lines, selector),
      (lines: string[]) => findBySelectorHex(lines, selector),
    ] : []),
  ];

  for (const strategy of strategies) {
    for (const { fileName, lines } of sources) {
      if (lines.length === 0) continue;
      const result = strategy(lines);
      if (result) return { ...result, fileName };
    }
  }

  return null;
}

// ── Address data I/O ──────────────────────────────────────────────────

export function loadAddressData(workspaceDir: string, address: string, chainId: number): any | null {
  return readJson(addressFilePath(workspaceDir, address, chainId));
}
