export {
  strategyConfig,
  pageTemplate,
  fieldSpec,
  pagination,
  fieldType,
  fetchProfile,
  crawlScope,
  configReason,
  type StrategyConfig,
  type StrategyConfigInput,
  type PageTemplate,
  type FieldSpec,
  type Pagination,
  type FieldType,
  type FetchProfile,
  type CrawlScope,
  type ConfigReason,
} from './types.js';

export {
  STRATEGY_CONFIG_JSON_SCHEMA,
  parseStrategyConfig,
  safeParseStrategyConfig,
} from './schema.js';

export {
  STRATEGY_CONFIG_VERSION,
  parseSemver,
  isStrategyVersionCompatible,
  type ParsedSemver,
} from './version.js';

export {
  diffStrategyConfigs,
  formatConfigDiff,
  type ConfigChange,
  type ConfigDiff,
} from './diff.js';

export {
  StrategyConfigStore,
  type SaveOptions,
  type LoadedVersion,
  type VersionMetadata,
} from './store.js';

export {
  compileExpression,
  validateExpression,
  ExpressionError,
  type CompiledExpression,
  type EvaluationContext,
  type ValidationResult,
} from './expression.js';

export {
  compileTransformPipeline,
  validateTransformPipeline,
  getTransform,
  isRegisteredTransform,
  REGISTERED_TRANSFORMS,
  UnknownTransformError,
  type Transform,
} from './transforms.js';
