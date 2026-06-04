export { runEval, type RunEvalOptions } from './runner.js';
export { loadFixtures, loadFixture } from './load.js';
export { formatReport, failedRecords } from './format.js';
export { diffRecord, diffField } from './diff.js';
export type {
  EvalFixture,
  EvalReport,
  ExpectedField,
  ExpectedRecord,
  FieldDiff,
  FixtureEvalResult,
  FixturePage,
  PageEvalResult,
  RecordDiff,
} from './types.js';
