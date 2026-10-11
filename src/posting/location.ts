import { classifyLocation } from '../tracking/location';

/** schema.org uses ISO country codes ("CA"); spell out the common ones so they read as countries, not states. */
const ISO_COUNTRIES: Record<string, string> = {
  CA: 'Canada', US: 'United States', GB: 'United Kingdom', UK: 'United Kingdom', IE: 'Ireland', DE: 'Germany',
  FR: 'France', IN: 'India', AU: 'Australia', NL: 'Netherlands', ES: 'Spain', SG: 'Singapore', JP: 'Japan',
};

const countryName = (raw: unknown): string => {
  const value = typeof raw === 'string' ? raw : typeof (raw as any)?.name === 'string' ? (raw as any).name : '';
  return ISO_COUNTRIES[value.trim().toUpperCase()] ?? value.trim();
};

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** One schema.org Place / PostalAddress (or a plain string) as "City, Region, Country". */
function placeText(place: unknown): string {
  if (typeof place === 'string') return place.trim();
  if (!place || typeof place !== 'object') return '';
  const a = (place as any).address ?? place;
  if (typeof a === 'string') return a.trim();
  const parts = [a?.addressLocality, a?.addressRegion, countryName(a?.addressCountry)].filter((p) => typeof p === 'string' && p.trim());
  return parts.length ? parts.join(', ') : typeof (place as any).name === 'string' ? (place as any).name.trim() : '';
}

/**
 * The location a schema.org JobPosting declares. A remote job says so with
 * `jobLocationType: TELECOMMUTE` and lists where applicants may live, instead of a jobLocation.
 */
export function locationFromLd(job: any): string {
  if (!job || typeof job !== 'object') return '';
  const places = asList(job.jobLocation).map(placeText).filter(Boolean);
  if (places.length) return places.join(' | ');
  if (/telecommute/i.test(String(job.jobLocationType ?? ''))) {
    const where = asList(job.applicantLocationRequirements)
      .map((r) => (typeof r === 'string' ? countryName(r) : countryName((r as any)?.name) || placeText(r)))
      .filter(Boolean);
    return where.length ? `Remote - ${where.join(' | ')}` : 'Remote';
  }
  return '';
}

/** Text of an element with spaces between its parts, so `<dt>locations</dt><dd>Vancouver</dd>` is not "locationsVancouver". */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    if (t && !n.parentElement?.closest('script, style, noscript')) parts.push(t);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const MAX_LOCATION_CHARS = 140;
/** "Location", "Job location", "Work location(s)", "Office", "Lieu de travail", "Where": a caption, not a value. */
const CAPTION = /^(job |work |office |primary |position )?(locations?|office|based in)\s*:?$|^lieu( de travail)?\s*:?$|^emplacement\s*:?$|^where\s*:?$/i;
const INLINE = /^(?:job |work |office |primary |position )?locations?\s*[:–-]\s*(.{2,120})$|^(?:lieu(?: de travail)?|emplacement)\s*[:–-]\s*(.{2,120})$/i;
/** Never read a location out of the application form, site chrome or our own panel. */
const OFF_LIMITS = 'form, nav, footer, [role="navigation"], #autofill-review-host, script, style';

const usable = (el: Element) => !el.closest(OFF_LIMITS) && !el.querySelector('input, select, textarea');
const short = (t: string) => t.length >= 2 && t.length <= MAX_LOCATION_CHARS;
const stripCaption = (t: string) => t.replace(/^(job |work |office |primary |position )?locations?\s*[:–-]?\s*/i, '').trim();

/** Text held directly by an element (not by its children). */
function ownText(el: Element): string {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
}

/** "Location" captions with their value next to them, and "Location: Montreal, QC" written inline. */
function labelledLocations(doc: Document): string[] {
  const out: string[] = [];
  const elements = Array.from(doc.querySelectorAll('dt, th, td, li, p, span, div, strong, b, label, h2, h3, h4, h5, h6')).slice(0, 6000);
  for (const el of elements) {
    if (el.closest(OFF_LIMITS)) continue;
    const own = ownText(el);
    if (!own || own.length > MAX_LOCATION_CHARS + 20) continue;

    const inline = INLINE.exec(own);
    if (inline) {
      out.push((inline[1] ?? inline[2])!.trim());
      continue;
    }
    if (!CAPTION.test(own)) continue;
    // The value sits beside the caption: the next cell or sibling, or the rest of the caption's parent.
    const next = el.nextElementSibling;
    const beside = next && usable(next) ? spacedText(next) : '';
    const parent = el.parentElement;
    const around = parent && usable(parent) ? stripCaption(spacedText(parent).replace(own, ' ').trim()) : '';
    for (const value of [beside, around]) if (short(value) && !CAPTION.test(value)) out.push(value);
  }
  return out;
}

function fromSelectors(doc: Document, selectors: string[]): string[] {
  const out: string[] = [];
  for (const s of selectors) {
    for (const el of Array.from(doc.querySelectorAll(s)).slice(0, 5)) {
      if (!usable(el)) continue;
      const t = stripCaption(spacedText(el));
      if (short(t)) out.push(t);
    }
  }
  return out;
}

function fromMicrodata(doc: Document): string[] {
  const out: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('[itemprop="jobLocation"], [itemprop="addressLocality"]')).slice(0, 5)) {
    const scope = el.getAttribute('itemprop') === 'addressLocality' ? (el.closest('[itemprop="address"], [itemprop="jobLocation"]') ?? el) : el;
    const t = (el as HTMLMetaElement).content?.trim() || spacedText(scope);
    if (short(t)) out.push(t);
  }
  return out;
}

/** Places that often hold a location but are not labelled as one: only trusted if they read as a real place. */
function unlabelled(doc: Document, url: URL): string[] {
  const out: string[] = [];
  const h1 = doc.querySelector('h1');
  // Under the title: "Toronto, ON" as its own line.
  for (let el = h1?.nextElementSibling, hops = 0; el && hops < 5; el = el.nextElementSibling, hops++) {
    if (!usable(el)) continue;
    const t = spacedText(el);
    if (short(t) && t.length <= 80) out.push(t);
  }
  // In the title or the tab title: "Platform Engineer - Toronto - Globex".
  for (const text of [h1 ? spacedText(h1) : '', doc.title]) {
    for (const part of text.split(/\s[-–—|·@]\s|[()]/)) if (short(part.trim())) out.push(part.trim());
  }
  // Workday puts it in the address: /job/Vancouver-BC/Title_R123.
  const inPath = /\/job\/([^/]+)\//i.exec(url.pathname)?.[1];
  if (inPath) out.push(decodeURIComponent(inPath).replace(/[-_]+/g, ' '));
  return out;
}

/**
 * The job's location as text. Every place a posting may state it is read, and the first reading
 * that names a place the tracker can classify wins; failing that, the first one labelled as a
 * location is returned so the user at least sees what the page said. `ldLocations` are the
 * readings from schema.org JobPosting data, already turned into text.
 */
export function findLocation(doc: Document, url: URL, selectors: string[], ldLocations: string[]): string {
  const labelled = [
    ...fromSelectors(doc, selectors),
    ...ldLocations,
    ...fromMicrodata(doc),
    ...labelledLocations(doc),
    ...fromSelectors(doc, ['[class*="location" i]', '[data-testid*="location" i]', '[data-qa*="location" i]', '[id*="location" i]']),
  ].filter(Boolean);
  const placed = [...labelled, ...unlabelled(doc, url)].find((c) => classifyLocation(c) !== null);
  return placed ?? labelled[0] ?? '';
}
