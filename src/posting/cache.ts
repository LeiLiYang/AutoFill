import type { KeyValueStore } from '../profile/storage';

export interface CachedPosting {
  title: string;
  company: string;
  descriptionMd: string;
  /** As read on the posting page: the application form usually does not repeat them. */
  location?: string;
  salary?: string;
  savedAt: string;
}

const KEY = 'postingCache';
const MAX_ENTRIES = 40;

type Cache = Record<string, CachedPosting>;

/**
 * Job descriptions by canonical URL. A Workday apply page has no description, but its canonical URL
 * equals the posting page's, so the text read earlier on the posting page can feed the LLM prompt.
 */
export async function cachePosting(kv: KeyValueStore, canonicalUrl: string, p: Omit<CachedPosting, 'savedAt'>, now = new Date()) {
  const cache = ((await kv.get(KEY)) as Cache | undefined) ?? {};
  cache[canonicalUrl] = { ...p, savedAt: now.toISOString() };
  const keep = Object.entries(cache).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).slice(0, MAX_ENTRIES);
  await kv.set(KEY, Object.fromEntries(keep));
}

/** The cached posting with its URL, for callers that look one up by something other than the URL. */
export async function findCachedPosting(kv: KeyValueStore, pick: (url: string, p: CachedPosting) => boolean): Promise<CachedPosting | null> {
  const cache = ((await kv.get(KEY)) as Cache | undefined) ?? {};
  const hits = Object.entries(cache).filter(([url, p]) => pick(url, p)).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
  return hits[0]?.[1] ?? null;
}

export async function getCachedPosting(kv: KeyValueStore, canonicalUrl: string): Promise<CachedPosting | null> {
  const cache = ((await kv.get(KEY)) as Cache | undefined) ?? {};
  return cache[canonicalUrl] ?? null;
}
