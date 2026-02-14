import type { Address } from 'viem';
import evmProxyDetection from 'evm-proxy-detection';
import { getClient } from '../utils/index.js';
import type { ProxyResult } from './types.js';

// ── Bytecode ─────────────────────────────────────────────────────────

export async function getBytecode(address: string, chainId: number): Promise<string | null> {
  const client = getClient(chainId);
  try {
    const code = await client.getCode({ address: address as Address });
    return code && code !== '0x' ? code : null;
  } catch {
    return null;
  }
}

// ── Proxy detection ──────────────────────────────────────────────────

export async function detectProxyInfo(address: string, chainId: number): Promise<ProxyResult> {
  if (typeof (evmProxyDetection as any).default !== 'function') {
    return { isProxy: false };
  }

  const client = getClient(chainId);

  try {
    const requestFunc = async (args: { method: string; params: unknown[] }): Promise<unknown> => {
      return client.request({
        method: args.method as any,
        params: args.params as any,
      });
    };

    const result = await (evmProxyDetection as any).default(address as `0x${string}`, requestFunc);

    if (result) {
      return {
        isProxy: true,
        proxyType: result.type,
        implementation: result.target,
      };
    }
  } catch (error) {
    console.warn(`[detectProxyInfo] Failed for ${address}:`, error instanceof Error ? error.message : error);
  }

  return { isProxy: false };
}

















