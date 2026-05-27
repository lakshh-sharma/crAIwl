export {
  discoverSitemaps,
  type SitemapUrl,
  type SitemapDiscoveryResult,
  type DiscoverSitemapsOptions,
  type SitemapFetch,
} from './sitemap.js';

export { probeDocPaths, DEFAULT_DOC_PATHS, type ProbeResult, type ProbeOptions } from './probe.js';

export { extractNavLinks, scoreDocLikeness, type NavLink, type NavRegion } from './nav.js';

export {
  discover,
  type CandidateUrl,
  type DiscoverySource,
  type DiscoveryResult,
  type DiscoveryOptions,
} from './discover.js';
