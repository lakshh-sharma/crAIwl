export {
  inferFieldSchema,
  fieldType,
  fieldSchemaItem,
  type FieldType,
  type FieldSchemaItem,
  type UserField,
  type InferFieldsOptions,
  type InferFieldsResult,
} from './field-schema.js';

export {
  detectLocatorKind,
  parseHtml,
  testLocator,
  testLocatorOnDom,
  type LocatorKind,
  type LocatorTestResult,
} from './locator-validate.js';

export {
  synthesizeLocators,
  type SynthesizedField,
  type SynthesizedFieldRaw,
  type SynthesisOptions,
  type SynthesisResult,
} from './synthesize.js';

export { compile, CompileError, type CompileOptions, type CompileResult } from './compile.js';
