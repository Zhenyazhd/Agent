import { join } from 'path';
import { readJson } from './io.js';

// ── Error handling ───────────────────────────────────────────────────

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Regex ────────────────────────────────────────────────────────────

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Address helpers ──────────────────────────────────────────────────

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function addressFilePath(workspaceDir: string, address: string, chainId: number): string {
  return join(workspaceDir, `${chainId}_${normalizeAddress(address)}.json`);
}

export function loadAddressJson(workspaceDir: string, address: string, chainId: number): any | null {
  return readJson(addressFilePath(workspaceDir, address, chainId));
}

export function getImplementationAddress(addressData: any): string | null {
  if (!addressData?.isProxy || !addressData?.implementation) return null;
  if (Array.isArray(addressData.implementation)) return addressData.implementation[0] || null;
  return addressData.implementation;
}

// ── Selector / argument extraction ───────────────────────────────────

export function extractSelector(data: string): `0x${string}` | null {
  if (!data || data.length < 10) return null;
  return data.slice(0, 10) as `0x${string}`;
}

export function parseFullNumber(value: string): string {
  if (!value) return value;
  if (/^-?\d+$/.test(value) || /^0x[a-fA-F0-9]+$/i.test(value)) return value;
  const match = value.match(/^(-?\d+)\s*\[/);
  if (match) return match[1];
  const numMatch = value.match(/^(-?\d+)/);
  if (numMatch) return numMatch[1];
  return value;
}

export function parseArgRaw(arg: string): string {
  if (!arg) return arg;
  const labeledAddr = arg.match(/^[^:]+:\s*\[?(0x[0-9a-fA-F]+)\]?$/);
  if (labeledAddr) return labeledAddr[1].toLowerCase();
  return parseFullNumber(arg);
}

export function detectArgType(raw: string): string {
  if (/^0x[0-9a-fA-F]{40}$/i.test(raw)) return 'address';
  if (raw === 'true' || raw === 'false') return 'bool';
  if (/^\d+$/.test(raw)) return 'uint256';
  if (/^-?\d+$/.test(raw)) return 'int256';
  if (/^0x[0-9a-fA-F]*$/i.test(raw)) return 'bytes';
  return 'string';
}

export function computeEffectiveSignature(signature: string | null, selector: string | null): string | null {
  if (signature && signature !== 'fallback()') return signature;
  if (selector && /^0x[0-9a-fA-F]{8}$/.test(selector)) return `unknown(${selector})`;
  return null;
}

export function extractLabel(arg: string): string | undefined {
  const match = arg.match(/^([^:]+):\s*\[?0x/);
  return match ? match[1].trim() : undefined;
}

// ── Hex / Wei conversions ────────────────────────────────────────────

export function hexToDecimal(hex: string): string {
  if (!hex || hex === '0x' || hex === '0x0') return '0';
  try {
    if (!hex.startsWith('0x')) hex = '0x' + hex;
    return BigInt(hex).toString();
  } catch {
    return '0';
  }
}

export function weiToEth(wei: string): string {
  try {
    const n = BigInt(wei);
    const whole = n / 10n ** 18n;
    const fraction = n % 10n ** 18n;

    if (fraction === 0n) return whole.toString();

    const fracStr = fraction
      .toString()
      .padStart(18, '0')
      .replace(/0+$/, '');

    return `${whole}.${fracStr}`;
  } catch {
    return '0';
  }
}

// ── Large number formatting ──────────────────────────────────────────

const UINT_SCALES: [bigint, string][] = [
  [10n ** 27n, 'e27'],
  [10n ** 24n, 'e24'],
  [10n ** 21n, 'e21'],
  [10n ** 18n, 'e18'],
  [10n ** 15n, 'e15'],
  [10n ** 12n, 'e12'],
  [10n ** 9n,  'e9'],
  [10n ** 6n,  'e6'],
];

export function humanizeUint(value: string): string {
  let n: bigint;
  try {
    n = BigInt(value);
  } catch {
    return value;
  }

  const abs = n < 0n ? -n : n;
  if (abs < 1_000_000n) return value;

  for (const [threshold, suffix] of UINT_SCALES) {
    if (abs >= threshold) {
      const intPart = abs / threshold;
      const fracPart = (abs * 100n / threshold) % 100n;
      const frac = fracPart > 0n
        ? `.${fracPart.toString().padStart(2, '0').replace(/0+$/, '')}`
        : '';
      const sign = n < 0n ? '-' : '';
      return `${value} (~${sign}${intPart}${frac}${suffix})`;
    }
  }

  return value;
}
