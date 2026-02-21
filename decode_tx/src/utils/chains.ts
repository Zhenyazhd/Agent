import { createPublicClient, http } from 'viem';
import { mainnet, polygon, arbitrum, optimism, base, bsc, avalanche } from 'viem/chains';

interface ChainConfig {
  chain: any;
  rpcUrl: string;
  etherscanApi: string;
  etherscanKey?: string;
}

export const CHAINS: Record<number, ChainConfig> = {
  1: {
    chain: mainnet,
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    etherscanApi: 'https://api.etherscan.io/v2/api',
    etherscanKey: process.env.ETHERSCAN_API_KEY,
  },
  137: {
    chain: polygon,
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
    etherscanApi: 'https://api.polygonscan.com/v2/api',
    etherscanKey: process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  42161: {
    chain: arbitrum,
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
    etherscanApi: 'https://api.arbiscan.io/v2/api',
    etherscanKey: process.env.ARBISCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  10: {
    chain: optimism,
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
    etherscanApi: 'https://api-optimistic.etherscan.io/v2/api',
    etherscanKey: process.env.OPTIMISM_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  8453: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
    etherscanApi: 'https://api.basescan.org/v2/api',
    etherscanKey: process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  56: {
    chain: bsc,
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
    etherscanApi: 'https://api.bscscan.com/v2/api',
    etherscanKey: process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
  43114: {
    chain: avalanche,
    rpcUrl: process.env.AVALANCHE_RPC_URL || 'https://avalanche.llamarpc.com',
    etherscanApi: 'https://api.snowtrace.io/v2/api',
    etherscanKey: process.env.SNOWTRACE_API_KEY || process.env.ETHERSCAN_API_KEY,
  },
};

export function getClient(chainId: number) {
  const config = CHAINS[chainId] || CHAINS[1];
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}
