/**
 * RFC 9309 robots.txt parser and matcher.
 *
 * The RFC defines `User-agent`, `Allow`, and `Disallow` directives plus a
 * specific longest-match rule. `Crawl-delay` and `Sitemap` are not part of
 * RFC 9309 but are widely deployed; we parse them as advisory data so the
 * orchestrator can honor them.
 *
 * Matching rules (RFC 9309 §2.2):
 *   - Most specific (longest pattern) wins.
 *   - On a tie, `allow` beats `disallow`.
 *   - Paths are case-sensitive. User-agent tokens are case-insensitive.
 *   - `*` matches zero or more characters; `$` anchors the match to URL end.
 *   - An empty `Disallow:` means "allow everything for this group."
 */

export type RobotsRule = {
  kind: 'allow' | 'disallow';
  pattern: string;
  /** Internal: regex equivalent of `pattern`, precompiled. */
  regex: RegExp;
};

export type RobotsGroup = {
  /** Lower-cased user-agent tokens this group applies to. */
  userAgents: string[];
  rules: RobotsRule[];
  /** Non-RFC extension. Caller decides whether to honor it. */
  crawlDelaySec?: number;
};

export type RobotsRules = {
  groups: RobotsGroup[];
  /** Non-RFC extension. */
  sitemaps: string[];
  /** Raw text — kept for debugging. */
  raw: string;
  /** True if parsing was clean. Malformed content still parses leniently. */
  wellFormed: boolean;
};

const STAR_GROUP = '*';

export function parseRobotsTxt(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let wellFormed = true;
  let current: RobotsGroup | undefined;
  let inGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) {
      // Blank line terminates the current group; subsequent UA lines start fresh.
      inGroup = false;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) {
      wellFormed = false;
      continue;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!inGroup) {
          current = { userAgents: [], rules: [] };
          groups.push(current);
          inGroup = true;
        }
        current!.userAgents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (!current) {
          // RFC 9309: a rule without a preceding User-agent is ignored.
          wellFormed = false;
          continue;
        }
        if (field === 'disallow' && value === '') {
          // Empty Disallow → allow everything; represent as no rule.
          continue;
        }
        current.rules.push({
          kind: field,
          pattern: value,
          regex: patternToRegex(value),
        });
        break;
      }
      case 'crawl-delay': {
        if (!current) continue;
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
        else wellFormed = false;
        break;
      }
      case 'sitemap': {
        if (value) sitemaps.push(value);
        break;
      }
      default:
        // Unknown directive — preserve forward-compat per RFC 9309 §2.2.4.
        break;
    }
  }
  return { groups, sitemaps, raw: text, wellFormed };
}

function stripComment(line: string): string {
  const i = line.indexOf('#');
  return i === -1 ? line : line.slice(0, i);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
  let body = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') body += '.*';
    else if (c === '$' && i === pattern.length - 1) body += '$';
    else body += escapeRegex(c);
  }
  // Robots patterns match against URL paths (incl. query) from the start.
  return new RegExp(`^${body}`);
}

/** Returns the group most specific to `userAgent` (case-insensitive longest prefix), or undefined. */
function selectGroup(rules: RobotsRules, userAgent: string): RobotsGroup | undefined {
  const ua = userAgent.toLowerCase();
  let bestSpecific: RobotsGroup | undefined;
  let bestSpecificLen = -1;
  let starGroup: RobotsGroup | undefined;
  for (const g of rules.groups) {
    for (const u of g.userAgents) {
      if (u === STAR_GROUP) {
        starGroup = g;
        continue;
      }
      // RFC 9309 §2.2.1: case-insensitive prefix match — `Googlebot` matches `googlebot-news`.
      if (ua.startsWith(u) && u.length > bestSpecificLen) {
        bestSpecific = g;
        bestSpecificLen = u.length;
      }
    }
  }
  return bestSpecific ?? starGroup;
}

/**
 * Returns true if `userAgent` is allowed to fetch `path` per the parsed rules.
 * `path` should be the URL path + query (e.g. `/docs?lang=en`), not the full URL.
 */
export function isAllowed(rules: RobotsRules, path: string, userAgent: string): boolean {
  const group = selectGroup(rules, userAgent);
  if (!group || group.rules.length === 0) return true;

  let bestMatch: { rule: RobotsRule } | undefined;
  for (const rule of group.rules) {
    const m = rule.regex.exec(path);
    if (!m) continue;
    if (!bestMatch) {
      bestMatch = { rule };
      continue;
    }
    if (rule.pattern.length > bestMatch.rule.pattern.length) {
      bestMatch = { rule };
    } else if (rule.pattern.length === bestMatch.rule.pattern.length) {
      // Tiebreak: allow wins over disallow.
      if (rule.kind === 'allow') bestMatch = { rule };
    }
  }

  if (!bestMatch) return true;
  return bestMatch.rule.kind === 'allow';
}

/** Returns the advisory `Crawl-delay` for `userAgent` if the file declares one. */
export function getCrawlDelay(rules: RobotsRules, userAgent: string): number | undefined {
  return selectGroup(rules, userAgent)?.crawlDelaySec;
}
