import 'dotenv/config'
import { createPublicClient, http, type Chain } from 'viem'
import { mainnet, polygon, arbitrum, optimism, base, bsc, avalanche } from 'viem/chains'

const chains: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  42161: arbitrum,
  10: optimism,
  8453: base,
  56: bsc,
  43114: avalanche,
}

const rpcUrls: Record<number, string> = {
  1: process.env.ETH_RPC_URL || 'https://rpc.ankr.com/eth',
  137: process.env.POLYGON_RPC_URL || 'https://rpc.ankr.com/polygon',
  42161: process.env.ARBITRUM_RPC_URL || 'https://rpc.ankr.com/arbitrum',
  10: process.env.OPTIMISM_RPC_URL || 'https://rpc.ankr.com/optimism',
  8453: process.env.BASE_RPC_URL || 'https://rpc.ankr.com/base',
  56: process.env.BSC_RPC_URL || 'https://rpc.ankr.com/bsc',
  43114: process.env.AVALANCHE_RPC_URL || 'https://rpc.ankr.com/avalanche',
}

export const getPublicClient = (chainId: number) => {
  const chain = chains[chainId]
  const rpcUrl = rpcUrls[chainId]

  if (!chain || !rpcUrl) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }

  return {
    client: createPublicClient({
      chain,
      transport: http(rpcUrl),
    }),
  }
}
