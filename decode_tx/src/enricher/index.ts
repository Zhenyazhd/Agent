/**
 * Enricher: source snippets, contract meta, selector resolution, contract type detection.
 * This file re-exports all public API.
 */

export {
  extractSourceTexts,
  findSourceInAddress,
  loadAddressData,
  type NormalizedSource,
  type SourceMatch,
} from './source.js';

export { getImplementationAddress } from '../utils/index.js';

export { resolveTraceDocs, type TraceDocLike } from './resolve-selectors.js';

export { enrichWithContractMeta } from './contract-meta.js';

export {
  ERC20_ABI,
  ERC165_ABI,
  NAME_SYMBOL_ABI,
  detectContractType,
} from './contract-type.js';
