import { appliesOnCompanySite, isEasyApply, isLinkedIn } from '../adapters/linkedin';
import type { Category, Channel, Location } from '../config/tracking';
import type { ExtractedPosting } from '../posting/extract';
import { classifyCategory } from './category';
import { formatSheetDate } from './date';
import { classifyLocation } from './location';

/**
 * "linkedin" for a LinkedIn Easy Apply; every other application is "website". On LinkedIn the
 * page markup changes often, so it counts as Easy Apply unless the posting plainly applies on the
 * company's own site.
 */
export function detectChannel(url: URL, doc: Document): Channel {
  if (!isLinkedIn(url)) return 'website';
  if (isEasyApply(doc, url)) return 'linkedin';
  return appliesOnCompanySite(doc) ? 'website' : 'linkedin';
}

/** What the log card starts with. Everything is editable; nothing is written until the user confirms. */
export interface LogPrefill {
  company: string;
  category: Category;
  /** '' when no rule applies: the user must pick before logging. */
  location: Location | '';
  /** The raw location text, shown next to the dropdown when it could not be classified. */
  locationText: string;
  date: string;
  channel: Channel;
  url: string;
  /** This page is only the application form: saving the posting must be done from the posting page. */
  formOnly: boolean;
}

/**
 * Fill the gaps of a form page's prefill from the posting read earlier: the form rarely repeats the
 * location, and its title is often just "Apply". What the page itself stated is never overridden.
 */
export function withEarlierPosting(prefill: LogPrefill, earlier: { title?: string; location?: string } | null): LogPrefill {
  if (!earlier) return prefill;
  const location = prefill.location || (classifyLocation(earlier.location) ?? '');
  return {
    ...prefill,
    location,
    locationText: prefill.location ? prefill.locationText : earlier.location || prefill.locationText,
    category: prefill.formOnly && earlier.title ? classifyCategory(earlier.title) : prefill.category,
  };
}

export function buildLogPrefill(p: ExtractedPosting, channel: Channel, now: Date = new Date()): LogPrefill {
  return {
    company: p.company,
    category: classifyCategory(p.title),
    location: classifyLocation(p.location) ?? '',
    locationText: p.location,
    date: formatSheetDate(now),
    channel,
    url: p.canonicalUrl,
    formOnly: p.formOnly,
  };
}
