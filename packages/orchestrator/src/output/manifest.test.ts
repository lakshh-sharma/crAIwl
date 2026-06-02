import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLog,
  parseStrategyConfig,
  type StrategyConfig,
  type StrategyConfigInput,
} from '@craiwl/core';
import { buildManifest } from './manifest.js';

const baseConfig = (auth?: StrategyConfigInput['auth']): StrategyConfig =>
  parseStrategyConfig({
    strategyVersion: '1.1.0',
    createdBy: 'test',
    createdAt: '2026-05-01T00:00:00.000Z',
    lastValidated: null,
    reason: 'compile',
    target: { entryUrl: 'https://example.com', scope: 'section' },
    goal: 'titles',
    pageTemplates: [
      {
        id: 'page',
        multiRecord: false,
        fields: {
          title: {
            locators: ['h1'],
            semanticAnchor: 'title',
            type: 'string',
            required: true,
          },
        },
      },
    ],
    pagination: { type: 'none' },
    fetchProfile: 'static',
    confidenceFloor: 0.8,
    ...(auth ? { auth } : {}),
  } as StrategyConfigInput);

const baseCost = {
  llm: { totalCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, byPhase: {} },
  pages: { total: 0, byTier: {} },
  records: { total: 0, perKtokenIn: 0, perKtokenOut: 0 },
  durationMs: 0,
  model: 'unknown',
};

describe('manifest compliance summary', () => {
  it('returns a zeroed unauthenticated summary when no audit log is supplied', () => {
    const m = buildManifest({
      runId: 'r1',
      startedAt: '2026-06-02T00:00:00.000Z',
      finishedAt: '2026-06-02T00:01:00.000Z',
      config: baseConfig(),
      records: [],
      cleanCount: 0,
      reviewCount: 0,
      pagesCrawled: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      cost: baseCost,
    });
    expect(m.compliance).toEqual({
      authProfile: null,
      secretsAccessed: [],
      pagesAuthenticated: 0,
      robotsBypasses: 0,
      httpAuthFailures: 0,
    });
  });

  it('lifts the auth profile type and secret name without leaking values', () => {
    const m = buildManifest({
      runId: 'r1',
      startedAt: '2026-06-02T00:00:00.000Z',
      finishedAt: '2026-06-02T00:01:00.000Z',
      config: baseConfig({ type: 'bearer', secret: 'my-token' }),
      records: [],
      cleanCount: 0,
      reviewCount: 0,
      pagesCrawled: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      cost: baseCost,
    });
    expect(m.compliance.authProfile).toEqual({ type: 'bearer', secretNames: ['my-token'] });
  });

  it('counts audit events by kind and dedupes secrets', () => {
    const audit = new InMemoryAuditLog();
    audit.record({
      at: '2026-06-02T00:00:00.000Z',
      kind: 'auth-attached',
      url: 'https://example.com/a',
      secretName: 'my-token',
      headerNames: ['Authorization'],
      authType: 'bearer',
    });
    audit.record({
      at: '2026-06-02T00:00:01.000Z',
      kind: 'auth-attached',
      url: 'https://example.com/b',
      secretName: 'my-token',
      headerNames: ['Authorization'],
      authType: 'bearer',
    });
    audit.record({
      at: '2026-06-02T00:00:02.000Z',
      kind: 'secret-accessed',
      secretName: 'my-token',
      providerLabel: 'env',
      reason: 'resolve-auth',
    });
    audit.record({
      at: '2026-06-02T00:00:03.000Z',
      kind: 'robots-bypass',
      policy: 'warn',
      url: 'https://example.com/private',
      userAgent: 'craiwl',
    });
    audit.record({
      at: '2026-06-02T00:00:04.000Z',
      kind: 'http-auth-failure',
      url: 'https://example.com/c',
      status: 401,
    });

    const m = buildManifest({
      runId: 'r1',
      startedAt: '2026-06-02T00:00:00.000Z',
      finishedAt: '2026-06-02T00:01:00.000Z',
      config: baseConfig({ type: 'bearer', secret: 'my-token' }),
      records: [],
      cleanCount: 0,
      reviewCount: 0,
      pagesCrawled: 0,
      pagesSkipped: 0,
      pagesFailed: 0,
      cost: baseCost,
      auditLog: audit,
    });
    expect(m.compliance.pagesAuthenticated).toBe(2);
    expect(m.compliance.secretsAccessed).toEqual(['my-token']);
    expect(m.compliance.robotsBypasses).toBe(1);
    expect(m.compliance.httpAuthFailures).toBe(1);
  });
});
