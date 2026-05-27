/**
 * Tiny duration parser for the CLI's `--every` flag.
 *
 * Accepts integer + unit, e.g. `30s`, `5m`, `2h`, `1d`. Returns milliseconds.
 * Anything else throws so the user sees the bad input rather than getting a
 * mysterious schedule that never fires.
 */

const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  const m = /^\s*(\d+)\s*([smhd])\s*$/i.exec(input);
  if (!m) {
    throw new Error(`invalid duration "${input}" — use e.g. 30s, 5m, 2h, 1d`);
  }
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  return n * UNITS[unit]!;
}

export function formatDuration(ms: number): string {
  if (ms % UNITS['d']! === 0) return `${ms / UNITS['d']!}d`;
  if (ms % UNITS['h']! === 0) return `${ms / UNITS['h']!}h`;
  if (ms % UNITS['m']! === 0) return `${ms / UNITS['m']!}m`;
  return `${Math.round(ms / 1000)}s`;
}
