export type AbiFunction = {
  type: 'function';
  name: string;
  inputs?: Array<{ name?: string; type: string }>;
  outputs?: Array<{ name?: string; type: string }>;
  stateMutability?: string;
};

export type AbiItem = AbiFunction | { type: string; [k: string]: unknown };

export interface AddressInfo {
  address: string;
  chainId: number;
  isContract: boolean;
  bytecode?: string;
  abi?: AbiItem[];
  abiSource?: 'etherscan' | 'sourcify' | 'heimdall' | null;
  sourceCode?: string | { [key: string]: { content: string } };
  sourceCodeSource?: 'etherscan' | 'sourcify' | 'heimdall' | null;
  compilerVersion?: string;
  optimizationUsed?: boolean;
  contractName?: string;
  constructorArgs?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  contractType?: 'ERC20' | 'ERC721' | 'ERC1155' | 'OTHER';
  isProxy?: boolean;
  proxyType?: string;
  implementation?: string | string[];
  implementationBytecode?: string;
  implementationBytecodes?: string[];
  implementationContractName?: string;
  fetchedAt: number;
  error?: string;
}

export interface SourceCodeResult {
  sourceCode: string | { [key: string]: { content: string } };
  abi?: AbiItem[];
  compilerVersion?: string;
  optimizationUsed?: boolean;
  contractName?: string;
  constructorArgs?: string;
}

export interface ProxyResult {
  isProxy: boolean;
  proxyType?: string;
  implementation?: string | string[];
}

export type AddressRole = 'EOA' | 'Proxy' | 'Token' | 'DEX' | 'Other';


export interface SourceLink {
  address: string;
  functionName?: string;
  filePath?: string;
  sourceFile?: string;
  startLine?: number;
  endLine?: number;
}

export interface TraceDocLog {
  name: string | null;
  topics: string[];
  data: string;
  decoded_params: { name: string; value: string }[] | null;
}


export interface ExecutionContext {
  code_address: string;
  storage_address: string;
  msg_sender: string;
  this_address: string;
}

export interface ArgPretty {
  type: string;
  value: string;
  label?: string;
}

export interface TraceDoc {
  call_id: number;
  parent: number | null;
  children: number[];
  depth: number;

  from: string;
  to: string;
  value: string;
  success: boolean;
  call_type: string;

  selector: `0x${string}` | null;
  signature: string | null;
  effective_signature: string | null;
  args_raw: string[];
  args_pretty: ArgPretty[];

  logs: TraceDocLog[];

  execution_context: ExecutionContext;

  address_role: AddressRole;
  source_links: SourceLink;
  source_code?: string;

  gas_used: number;
  gas_limit: number;
  label: string | null;
  output: string;
  input: string;
}


export interface EtherscanAbiResponse {
  status: string;
  result: string;
  message?: string;
}

export interface EtherscanContractInfo {
  SourceCode?: string;
  ABI?: string;
  ContractName?: string;
  CompilerVersion?: string;
  ConstructorArguments?: string;
  Proxy?: string;
  Implementation?: string;
}

export interface EtherscanSourceResponse {
  status: string;
  result: EtherscanContractInfo[];
  message?: string;
}
