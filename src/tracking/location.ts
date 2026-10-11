import {
  CANADIAN_CITIES,
  CANADIAN_PROVINCES,
  COUNTRY_WORDS,
  OTHER_CITIES,
  US_CITIES,
  US_STATES,
  type Country,
} from '../config/geo';
import type { Location } from '../config/tracking';
import { normalize } from '../detect/normalize';

type KnownCountry = Country | 'unknown';

interface Place {
  city?: string;
  country?: Country;
}

interface Entry {
  key: string;
  country: KnownCountry;
  /** Set when the place is one of the listed cities (montreal / vancouver / toronto / london). */
  listed?: Extract<Location, 'montreal' | 'vancouver' | 'toronto' | 'london'>;
  cityLess: boolean;
}

const WORK_MODE = /\b(remote|hybrid|on site|onsite|in office|flexible|work from home|wfh|anywhere|multiple locations?|various locations?|locations?)\b/g;
const DECORATION = /\b(greater|metropolitan area|metro area|metro|area|region|gta)\b/g;
// "newfoundland" alone: the full name is shortened before splitting on "and" (see segments).
const PROVINCE_NAMES = new Set([...Object.values(CANADIAN_PROVINCES), 'newfoundland']);
const STATE_NAMES = new Set(Object.values(US_STATES));
const PROVINCE_CODES = new Set(Object.keys(CANADIAN_PROVINCES));
const STATE_CODES = new Set(Object.keys(US_STATES));
const LISTED_CANADIAN = new Set(['montreal', 'toronto', 'vancouver']);
/** Cities we can place without a region, so a bare code after one ("Montreal QC") can be trusted. */
const isKnownCity = (name: string) => LISTED_CANADIAN.has(name) || CANADIAN_CITIES.has(name) || US_CITIES.has(name) || name in OTHER_CITIES;
const isRegionName = (name: string) => name in COUNTRY_WORDS || PROVINCE_NAMES.has(name) || STATE_NAMES.has(name);

/**
 * "Montreal QC", "Toronto Ontario Canada": a place written without commas. Peel region and country
 * words off the end so the rest reads as the city. A two-letter code or a short country name is
 * only peeled after a city we know, since on its own it is as likely to be a word ("in", "or", "us").
 */
function splitUnpunctuated(token: string): string[] {
  if (isRegionName(token) || isKnownCity(token)) return [token];
  const words = token.split(' ');
  for (let n = Math.min(4, words.length - 1); n >= 1; n--) {
    const head = words.slice(0, -n).join(' ');
    const tail = words.slice(-n).join(' ');
    const isCode = n === 1 && (PROVINCE_CODES.has(tail) || STATE_CODES.has(tail));
    // Short names ("us", "uk", "gb") are ordinary words too ("join us"): like codes, only after a known city.
    const spelledOut = isRegionName(tail) && tail.length > 3;
    if (spelledOut || ((isCode || isRegionName(tail)) && isKnownCity(splitUnpunctuated(head)[0]!))) return [...splitUnpunctuated(head), tail];
  }
  return [token];
}

/** Split a raw location into candidate places: strong separators first, then city/region comma groups. */
function segments(raw: string): string[] {
  return raw
    // "Newfoundland and Labrador" is one province, not two places.
    .replace(/newfoundland\s*(?:and|&)\s*labrador/gi, 'Newfoundland')
    .split(/[;|\n•·&+]| \/ | or | and /i)
    .map((s) => s.replace(/\s+-\s+/g, ', '))
    .map((s) => normalizeSegment(s))
    .filter(Boolean);
}

function normalizeSegment(s: string): string {
  // Keep commas as token separators; normalise everything else.
  return s
    .split(',')
    .map((t) =>
      normalize(t)
        // A caption glued to its value by a careless text read: "locationsVancouver".
        .replace(/^locations?(?=[a-z])/, '')
        .replace(/\bbay area\b/, 'sf bay')
        .replace(WORK_MODE, ' ')
        .replace(DECORATION, ' ')
        .replace(/\b(based|located|office|offices|canada wide|in|the)\b/g, (w) => (w === 'canada wide' ? 'canada' : ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .flatMap(splitUnpunctuated)
    .join(',');
}

/** Region/country information carried by one comma token, or null when it names a city. */
function regionOf(token: string, afterPlace: boolean): { country: Country } | null {
  if (token in COUNTRY_WORDS) {
    // "us"/"uk" etc. are safe; "in" or "ca" are not in COUNTRY_WORDS so they never reach here.
    return { country: COUNTRY_WORDS[token]! };
  }
  if (PROVINCE_NAMES.has(token)) return { country: 'canada' };
  if (STATE_NAMES.has(token)) return { country: 'usa' };
  // Two-letter codes are only meaningful straight after a place ("Toronto, ON", "Washington, DC").
  if (afterPlace && PROVINCE_CODES.has(token)) return { country: 'canada' };
  if (afterPlace && STATE_CODES.has(token)) return { country: 'usa' };
  return null;
}

function placesOf(segment: string): Place[] {
  const places: Place[] = [];
  let current: Place | null = null;
  for (const token of segment.split(',')) {
    const region = regionOf(token, !!current);
    if (region) {
      if (current && !current.country) current.country = region.country;
      else if (current && token.length <= 3) {
        // A short code after a place that already has its country is a repeat, not a second place:
        // "Toronto, ON, CA" where CA is the ISO code for Canada, not California.
      } else {
        // Standalone region/country ("Canada", "Ontario", "New York"): a country-only place.
        current = { country: region.country };
        places.push(current);
      }
    } else {
      current = { city: token };
      places.push(current);
    }
  }
  return places;
}

function entryOf(p: Place): Entry {
  const city = p.city;
  if (!city) return { key: `${p.country}:`, country: p.country ?? 'unknown', cityLess: true };

  if (city === 'london') {
    // London, Ontario/Kentucky are not London, UK.
    if (p.country === 'canada') return { key: 'canada:london', country: 'canada', cityLess: false };
    if (p.country === 'usa') return { key: 'usa:london', country: 'usa', cityLess: false };
    return { key: 'london', country: 'uk', listed: 'london', cityLess: false };
  }
  if (LISTED_CANADIAN.has(city)) {
    if (p.country === 'usa') return { key: `usa:${city}`, country: 'usa', cityLess: false }; // Vancouver, WA
    return { key: city, country: 'canada', listed: city as Entry['listed'], cityLess: false };
  }

  const inherent: KnownCountry = CANADIAN_CITIES.has(city) ? 'canada' : US_CITIES.has(city) ? 'usa' : (OTHER_CITIES[city] ?? 'unknown');
  const country: KnownCountry = p.country ?? inherent;
  return { key: `${country}:${city}`, country, cityLess: false };
}

/**
 * Map a job's location text to one of the sheet's Location values, or null when no rule applies
 * (the caller must then ask the user). Rules, in order:
 *  1. a single listed city → that city
 *  2. a single unlisted Canadian location, or "Remote - Canada" → canada
 *  3. a single US location, or "Remote - US" → USA
 *  4. multiple cities all in one country → that country (canada or USA)
 *  5. multiple countries → canada
 */
export function classifyLocation(raw: string | string[] | null | undefined): Location | null {
  const text = Array.isArray(raw) ? raw.join(';') : (raw ?? '');
  if (!text.trim()) return null;

  const all = segments(text).flatMap((s) => placesOf(s)).map(entryOf);

  // A bare country is redundant next to a city in the same country ("Toronto; Canada").
  const withCities = all.filter((e) => !e.cityLess);
  const entries = all.filter((e) => !e.cityLess || !withCities.some((c) => c.country === e.country));
  const unique = [...new Map(entries.map((e) => [e.key, e])).values()];
  if (!unique.length) return null;

  if (unique.length === 1) {
    const e = unique[0]!;
    if (e.listed) return e.listed; // rule 1
    if (e.country === 'canada') return 'canada'; // rule 2
    if (e.country === 'usa') return 'USA'; // rule 3
    return null;
  }

  const countries = new Set(unique.map((e) => e.country));
  if (countries.has('unknown')) return null; // cannot tell whether the countries differ
  if (countries.size === 1) {
    const [only] = [...countries];
    return only === 'canada' ? 'canada' : only === 'usa' ? 'USA' : null; // rule 4 (only canada/USA exist)
  }
  return 'canada'; // rule 5
}
