/**
 * Detect contract type (ERC20, ERC721, ERC1155) via on-chain calls.
 */

import { Address } from 'viem';
import { getClient } from '../utils/index.js';

// ── Known ABIs ───────────────────────────────────────────────────────

export const ERC20_ABI = [
  { name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

export const ERC165_ABI = [{
  name: 'supportsInterface',
  type: 'function',
  inputs: [{ type: 'bytes4' }],
  outputs: [{ type: 'bool' }],
}] as const;

export const NAME_SYMBOL_ABI = [
  { name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] },
] as const;

// ── Detection ────────────────────────────────────────────────────────

export async function detectContractType(
  address: string,
  chainId: number
): Promise<{ type: 'ERC20' | 'ERC721' | 'ERC1155' | 'OTHER'; name?: string; symbol?: string; decimals?: number }> {
  const client = getClient(chainId);
  const addr = address as Address;

  try {
    const [name, symbol, decimals] = await Promise.allSettled([
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'name' }),
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    if (decimals.status === 'fulfilled' && (name.status === 'fulfilled' || symbol.status === 'fulfilled')) {
      return {
        type: 'ERC20',
        name: name.status === 'fulfilled' ? String(name.value) : undefined,
        symbol: symbol.status === 'fulfilled' ? String(symbol.value) : undefined,
        decimals: Number(decimals.value),
      };
    }
  } catch {
  }

  try {
    const [supportsERC721, supportsERC1155] = await Promise.allSettled([
      client.readContract({ address: addr, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0x80ac58cd' as `0x${string}`] }),
      client.readContract({ address: addr, abi: ERC165_ABI, functionName: 'supportsInterface', args: ['0xd9b67a26' as `0x${string}`] }),
    ]);

    if (supportsERC721.status === 'fulfilled' && supportsERC721.value) {
      const [name, symbol] = await Promise.allSettled([
        client.readContract({ address: addr, abi: NAME_SYMBOL_ABI, functionName: 'name' }),
        client.readContract({ address: addr, abi: NAME_SYMBOL_ABI, functionName: 'symbol' }),
      ]);

      return {
        type: 'ERC721',
        name: name.status === 'fulfilled' ? String(name.value) : undefined,
        symbol: symbol.status === 'fulfilled' ? String(symbol.value) : undefined,
      };
    }

    if (supportsERC1155.status === 'fulfilled' && supportsERC1155.value) {
      return { type: 'ERC1155' };
    }
  } catch {
  }

  return { type: 'OTHER' };
}
