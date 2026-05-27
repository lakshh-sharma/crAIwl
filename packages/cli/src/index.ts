#!/usr/bin/env node
/**
 * craiwl — command-line entry point.
 *
 * Subcommands:
 *   craiwl crawl <url> --goal "..."   compile + crawl + emit records
 *   craiwl compile <url> --goal "..." compile a config and save it (no crawl)
 *   craiwl run --config <path>        run an existing config (no LLM)
 *   craiwl --help                     show help
 *
 * Output goes to stdout by default; use --out to pick a format (json|csv|md).
 * The Anthropic API key comes from ANTHROPIC_API_KEY.
 */

import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { AnthropicProvider } from '@craiwl/core';
import { Tier0Fetcher, RobotsCache, type Fetcher } from '@craiwl/fetcher';
import {
  runJob,
  exportConfig,
  importConfig,
  serializeAsJson,
  serializeAsCsv,
  serializeAsMarkdown,
  type SerializedOutput,
} from '@craiwl/orchestrator';

export const PACKAGE_NAME = '@craiwl/cli';

const HELP = `craiwl — LLM-as-compiler web crawler

USAGE
  craiwl crawl   <url> --goal "<goal>"      [options]   compile + crawl
  craiwl compile <url> --goal "<goal>" -o config.json   save a config (no crawl)
  craiwl run --config <path>                [options]   run an existing config
  craiwl --help

COMMON OPTIONS
  --out json|csv|md       output format (default: json)
  --output-file <path>    write to file instead of stdout
  --scope single|section|site   crawl scope (default: section)
  --max-pages <n>         hard cap on pages (default: 50)
  --max-depth <n>         link-following depth (default: 3)
  --user-agent <s>        UA string (default: craiwl/0.1)
  --robots respect|warn|ignore  robots.txt policy (default: respect)
  --no-follow-links       seed only — do not enqueue on-page links

ENVIRONMENT
  ANTHROPIC_API_KEY       required for compile (set in your shell or .env)
`;

type Parsed = {
  command: 'crawl' | 'compile' | 'run' | 'help';
  positional: string[];
  options: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { command: 'help', positional: [], options: {} };
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') return out;

  const cmd = argv[0];
  if (cmd === 'crawl' || cmd === 'compile' || cmd === 'run') {
    out.command = cmd;
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.options[key] = true;
      } else {
        out.options[key] = next;
        i++;
      }
    } else if (a === '-o') {
      const next = argv[++i];
      if (next !== undefined) out.options['output-file'] = next;
    } else if (a.startsWith('-')) {
      throw new Error(`unknown short flag: ${a}`);
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function serialize(records: Awaited<ReturnType<typeof runJob>>, format: string): SerializedOutput {
  switch (format) {
    case 'csv':
      return serializeAsCsv(records.cleanRecords);
    case 'md':
    case 'markdown':
      return serializeAsMarkdown(records.cleanRecords, records.manifest);
    case 'json':
    default:
      return serializeAsJson(records.cleanRecords, records.manifest);
  }
}

async function emit(out: SerializedOutput, outputFile: string | undefined): Promise<void> {
  if (outputFile) {
    await writeFile(outputFile, out.body, 'utf8');
    process.stderr.write(`wrote ${out.body.length} bytes to ${outputFile}\n`);
    return;
  }
  process.stdout.write(out.body);
}

function buildRobotsCache(fetcher: Fetcher): RobotsCache {
  return new RobotsCache({ fetcher });
}

async function commandCrawl(args: Parsed): Promise<void> {
  const url = args.positional[0];
  const goal = args.options['goal'];
  if (!url) throw new Error('crawl: missing <url>');
  if (typeof goal !== 'string') throw new Error('crawl: --goal "<text>" is required');

  const userAgent = (args.options['user-agent'] as string) ?? 'craiwl/0.1';
  const fetcher = new Tier0Fetcher({ userAgent });
  const robotsCache = buildRobotsCache(fetcher);
  const llm = new AnthropicProvider();

  const result = await runJob({
    entryUrl: url,
    goal,
    fetcher,
    robotsCache,
    userAgent,
    llm,
    ...(args.options['scope']
      ? { scope: args.options['scope'] as 'single' | 'section' | 'site' }
      : {}),
    ...(args.options['max-pages'] ? { maxPages: Number(args.options['max-pages']) } : {}),
    ...(args.options['max-depth'] ? { maxDepth: Number(args.options['max-depth']) } : {}),
    ...(args.options['robots']
      ? { robotsPolicy: args.options['robots'] as 'respect' | 'warn' | 'ignore' }
      : {}),
    ...(args.options['no-follow-links'] ? { followLinks: false } : {}),
  });

  const format = (args.options['out'] as string) ?? 'json';
  await emit(serialize(result, format), args.options['output-file'] as string | undefined);
}

async function commandCompile(args: Parsed): Promise<void> {
  const url = args.positional[0];
  const goal = args.options['goal'];
  const outputFile = args.options['output-file'] as string | undefined;
  if (!url) throw new Error('compile: missing <url>');
  if (typeof goal !== 'string') throw new Error('compile: --goal "<text>" is required');
  if (!outputFile) throw new Error('compile: --output-file (-o) is required to save the config');

  const userAgent = (args.options['user-agent'] as string) ?? 'craiwl/0.1';
  const fetcher = new Tier0Fetcher({ userAgent });
  const robotsCache = buildRobotsCache(fetcher);
  const llm = new AnthropicProvider();

  // Run with maxPages=1 so we compile against the entry page and stop.
  const result = await runJob({
    entryUrl: url,
    goal,
    fetcher,
    robotsCache,
    userAgent,
    llm,
    maxPages: 1,
    followLinks: false,
  });

  await writeFile(outputFile, exportConfig(result.config), 'utf8');
  process.stderr.write(`wrote config to ${outputFile}\n`);
}

async function commandRun(args: Parsed): Promise<void> {
  const configPath = args.options['config'] as string | undefined;
  if (!configPath) throw new Error('run: --config <path> is required');
  const raw = await readFile(configPath, 'utf8');
  const config = importConfig(raw);

  const userAgent = (args.options['user-agent'] as string) ?? 'craiwl/0.1';
  const fetcher = new Tier0Fetcher({ userAgent });
  const robotsCache = buildRobotsCache(fetcher);

  const result = await runJob({
    entryUrl: config.target.entryUrl,
    goal: config.goal,
    fetcher,
    robotsCache,
    userAgent,
    config,
    ...(args.options['scope']
      ? { scope: args.options['scope'] as 'single' | 'section' | 'site' }
      : {}),
    ...(args.options['max-pages'] ? { maxPages: Number(args.options['max-pages']) } : {}),
    ...(args.options['robots']
      ? { robotsPolicy: args.options['robots'] as 'respect' | 'warn' | 'ignore' }
      : {}),
  });

  const format = (args.options['out'] as string) ?? 'json';
  await emit(serialize(result, format), args.options['output-file'] as string | undefined);
}

export async function main(argv: string[]): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n\n${HELP}`);
    return 2;
  }

  if (parsed.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  try {
    if (parsed.command === 'crawl') await commandCrawl(parsed);
    else if (parsed.command === 'compile') await commandCompile(parsed);
    else if (parsed.command === 'run') await commandRun(parsed);
    return 0;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 1;
  }
}

// Entrypoint: only run when invoked directly, not when imported in tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
