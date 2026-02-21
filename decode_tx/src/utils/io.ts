import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

export function readJson(filePath: string): any | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function loadTraceFiles(txDir: string): string[] {
  return readdirSync(txDir)
    .filter(f => f.startsWith('trace_') && f.endsWith('.json'))
    .sort((a, b) => {
      const idA = parseInt(a.replace('trace_', '').replace('.json', ''), 10);
      const idB = parseInt(b.replace('trace_', '').replace('.json', ''), 10);
      return idA - idB;
    });
}
