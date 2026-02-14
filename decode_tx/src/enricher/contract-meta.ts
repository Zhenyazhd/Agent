import type { DecodedTransactionWithHierarchy } from '../decoder/types.js';
import { normalizeAddress, getClient } from '../utils/index.js';

export async function enrichWithContractMeta(
  decoded: DecodedTransactionWithHierarchy
): Promise<DecodedTransactionWithHierarchy> {
  const addresses = new Set<string>();
  for (const call of decoded.traceCalls) {
    addresses.add(normalizeAddress(call.to));
    if (call.from) addresses.add(normalizeAddress(call.from));
  }

  const client = getClient(decoded.chainId);

  for (const address of addresses) {
    try {
      const [name, symbol, decimals] = await Promise.allSettled([
        client.readContract({ address: address as `0x${string}`, abi: [{ name: 'name', type: 'function', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'name' }),
        client.readContract({ address: address as `0x${string}`, abi: [{ name: 'symbol', type: 'function', inputs: [], outputs: [{ type: 'string' }] }], functionName: 'symbol' }),
        client.readContract({ address: address as `0x${string}`, abi: [{ name: 'decimals', type: 'function', inputs: [], outputs: [{ type: 'uint8' }] }], functionName: 'decimals' }),
      ]);

      if (name.status === 'fulfilled' && symbol.status === 'fulfilled') {
        decoded.contractMeta[address] = {
          address,
          name: name.value as string,
          symbol: symbol.value as string,
          decimals: decimals.status === 'fulfilled' ? Number(decimals.value) : null,
          type: 'ERC20',
        };
      }
    } catch {
    }
  }

  return decoded;
}
