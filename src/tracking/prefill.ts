import { isEasyApply, isLinkedIn } from '../adapters/linkedin';
import type { Category, Channel, Location } from '../config/tracking';
import type { ExtractedPosting } from '../posting/extract';
import { classifyCategory } from './category';
import { formatSheetDate } from './date';
import { classifyLocation } from './location';

/** "linkedin" only for a LinkedIn Easy Apply; every other application is "website". */
export function detectChannel(url: URL, doc: Document): Channel {
  return isLinkedIn(url) && isEasyApply(doc) ? 'linkedin' : 'website';
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
