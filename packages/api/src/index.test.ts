import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@craiwl/api', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@craiwl/api');
  });
});
