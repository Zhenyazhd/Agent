export type ParsedArg = string;

export interface CastTraceNode {
  parent: number | null;
  children: number[];
  idx: number;
  trace: {
    depth: number;
    success: boolean;
    caller: string;
    address: string;
    maybe_precompile: boolean | null;
    selfdestruct_address: string | null;
    selfdestruct_refund_target: string | null;
    selfdestruct_transferred_value: string | null;
    kind: 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2';
    value: string;
    data: string;
    output: string;
    gas_used: number;
    gas_limit: number;
    status: string;
    steps: any[];
    decoded: {
      label: string | null;
      return_data: any;
      call_data: {
        signature: string;
        args: string[];
      } | null;
    };
  };
  logs: CastLogEntry[];
}

export interface CastLogEntry {
  raw_log: { topics: string[]; data: string };
  decoded: { name: string | null; params: [string, string][] | null };
  position: number;
  index: number;
}

export interface CastRunOutput {
  arena: CastTraceNode[];
}

export interface EnrichedTraceCall {
  depth: number;
  index: number;
  parentIndex: number | null;
  childrenIndices: number[];
  callType: 'CALL' | 'DELEGATECALL' | 'STATICCALL' | 'CREATE' | 'CREATE2';
  from: string;
  to: string;
  value: string;
  valueDecimal: string;
  signature: string | null;
  selector: `0x${string}` | null;
  args: ParsedArg[];
  success: boolean;
  output: string;
  gasUsed: number;
  gasLimit: number;
  input: string;
  logs: EnrichedLog[];
  label: string | null;
}

export interface EnrichedLog {
  index: number;
  name: string | null;
  params: { name: string; value: string }[];
  topics: string[];
  data: string;
}

export interface DecodedTransactionWithHierarchy {
  txHash: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  valueDecimal: string;
  functionSignature: string | null;
  functionArgs: ParsedArg[];
  traceCalls: EnrichedTraceCall[];
  allLogs: EnrichedLog[];
  addresses: string[];
  totalCalls: number;
  maxDepth: number;
  rootGasUsed: number;
  success: boolean;
  contractMeta: Record<string, ContractMeta>;
}

export interface ContractMeta {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  type: 'ERC20' | 'ERC721' | 'ERC1155' | 'PROXY' | 'OTHER';
}

export type AddressRole = 'EOA' | 'Proxy' | 'Token' | 'DEX' | 'Other';

export interface TraceDocLog {
  name: string | null;
  topics: string[];
  data: string;
  decoded_params: { name: string; value: string }[] | null;
}

export interface SourceLink {
  address: string;
  functionName?: string;
  filePath?: string;
  sourceFile?: string;
  startLine?: number;
  endLine?: number;
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

export interface TxMeta {
  tx_hash: string;
  chain_id: number;
  from: string;
  to: string;
  value: string;
  value_decimal: string;
  function_signature: string | null;
  function_args: string[];
  success: boolean;
  total_calls: number;
  max_depth: number;
  root_gas_used: number;
  addresses: string[];
  total_logs: number;
  trace_doc_count: number;
}
