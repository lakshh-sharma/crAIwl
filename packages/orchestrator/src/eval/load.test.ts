/**
 * Smoke test for the on-disk fixture loader plus the end-to-end harness.
 * Walks the bundled __fixtures__/article-pricing fixture and asserts a
 * clean pass — if this breaks, the cleaner or executor regressed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './load.js';
import { runEval } from './runner.js';

const FIXED_NOW = () => new Date('2026-06-04T12:00:00.000Z');
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

describe('loadFixtures + runEval against bundled fixtures', () => {
  it('loads every fixture directory under __fixtures__/', async () => {
    const fixtures = await loadFixtures(fixturesDir);
    expect(fixtures.length).toBeGreaterThan(0);
    const names = fixtures.map((f) => f.name);
    expect(names).toContain('article-pricing');
  });

  it('all bundled fixtures pass — regression canary', async () => {
    const fixtures = await loadFixtures(fixturesDir);
    const report = runEval(fixtures, { now: FIXED_NOW });
    expect(report.totals.fixturesPassed).toBe(report.totals.fixtures);
    if (report.totals.fixturesPassed !== report.totals.fixtures) {
      // surface the first failure in the assertion message
      const failing = report.fixtures.find((f) => !f.ok);
      throw new Error(`fixture ${failing?.name} failed: ${JSON.stringify(failing, null, 2)}`);
    }
  });
});
