import { sleep } from './async.js';
import { normalizeSelector } from './abi.js';


const selectorCache = new Map<string, string | null>();

export async function lookupSelectorOnline(
  selector: string,
  retries = 2,
  baseDelay = 200,
): Promise<string | null> {
  const sel = normalizeSelector(selector);
  if (!sel || sel.length !== 10) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(
        `https://api.openchain.xyz/signature-database/v1/lookup?function=${sel}&filter=true`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await sleep(baseDelay * Math.pow(2, attempt));
          continue;
        }
        return null;
      }
      if (!response.ok) return null;

      const data = (await response.json()) as {
        result?: { function?: Record<string, Array<{ name: string }>> };
      };
      const results = data?.result?.function?.[sel];
      return results && results.length > 0 ? results[0].name : null;
    } catch {
      if (attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

export function getCachedSelector(selector: string): string | null | undefined {
  return selectorCache.get(normalizeSelector(selector));
}

export function setCachedSelector(selector: string, value: string | null): void {
  selectorCache.set(normalizeSelector(selector), value);
}
