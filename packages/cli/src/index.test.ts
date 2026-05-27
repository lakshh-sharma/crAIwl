import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME, parseArgs, main } from './index.js';

describe('@craiwl/cli', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@craiwl/cli');
  });
});

describe('parseArgs', () => {
  it('returns help when no args are provided', () => {
    expect(parseArgs([]).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-h']).command).toBe('help');
  });

  it('parses crawl with a URL and --goal', () => {
    const parsed = parseArgs(['crawl', 'https://x.com/docs', '--goal', 'extract docs']);
    expect(parsed.command).toBe('crawl');
    expect(parsed.positional[0]).toBe('https://x.com/docs');
    expect(parsed.options['goal']).toBe('extract docs');
  });

  it('treats a flag immediately before another flag as boolean', () => {
    const parsed = parseArgs(['crawl', 'https://x.com', '--no-follow-links', '--out', 'csv']);
    expect(parsed.options['no-follow-links']).toBe(true);
    expect(parsed.options['out']).toBe('csv');
  });

  it('maps the short -o flag to --output-file', () => {
    const parsed = parseArgs(['compile', 'https://x.com', '--goal', 'x', '-o', 'out.json']);
    expect(parsed.options['output-file']).toBe('out.json');
  });

  it('rejects unknown commands', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow();
  });

  it('rejects unknown short flags', () => {
    expect(() => parseArgs(['crawl', 'https://x.com', '-x'])).toThrow();
  });

  it('parses schedule subcommands', () => {
    const add = parseArgs(['schedule', 'add', '--config', 'c.json', '--every', '6h']);
    expect(add.command).toBe('schedule');
    expect(add.subcommand).toBe('add');
    expect(add.options['every']).toBe('6h');

    const list = parseArgs(['schedule', 'list']);
    expect(list.subcommand).toBe('list');

    const remove = parseArgs(['schedule', 'remove', 'sched-id']);
    expect(remove.subcommand).toBe('remove');
    expect(remove.positional[0]).toBe('sched-id');
  });
});

describe('main', () => {
  it('returns exit code 0 for --help', async () => {
    expect(await main(['--help'])).toBe(0);
  });

  it('returns exit code 2 for an unknown command', async () => {
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(await main(['nope'])).toBe(2);
    } finally {
      process.stderr.write = original;
    }
  });
});
