export const PACKAGE_NAME = '@craiwl/fetcher';

export type { Fetcher, FetchTier, FetchMethod, FetchRequestOptions, FetchResult } from './types.js';
export { FetchError } from './types.js';

export { Tier0Fetcher, type Tier0Options } from './tier0.js';
export { Tier2Fetcher, type Tier2Options } from './tier2.js';
export * from './browser/index.js';
export {
  autoTierFetch,
  type AutoTierOptions,
  type AutoTierResult,
  type TierDecision,
  type TierDecisionReason,
} from './auto-tier.js';
export * from './robots/index.js';
