import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { deriveCompany } from '../tracking/company';
import { canonicalPostingUrl } from './canonicalUrl';
import { SELECTORS, isFormOnlyUrl, platformFor, type Platform } from './selectors';

export interface ExtractedPosting {
  title: string;
  company: string;
  location: string;
  salary: string;
  /** Job description as Markdown. */
  descriptionMd: string;
  url: string;
  canonicalUrl: string;
  platform: Platform;
  /** True when this page is only the application form; save from the posting page instead. */
  formOnly: boolean;
  source: 'selectors' | 'jsonld' | 'readability' | 'none';
}

/** Below this many characters we do not consider a block a real job description. */
const MIN_DESCRIPTION_CHARS = 200;

const NOISE = 'script, style, noscript, form, button, svg, iframe, nav, [aria-hidden="true"], [hidden], input, select, textarea';

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '_' });
  td.remove((node) => ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG'].includes(node.nodeName.toUpperCase()));
  return td;
}

function htmlToMarkdown(html: string): string {
  return turndown()
    .turndown(html)
    // Turndown pads list markers to "-   item"; normalise to "- item".
    .replace(/^(\s*)([-*+]|\d+\.)[ \t]{2,}/gm, '$1$2 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function elementToMarkdown(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(NOISE).forEach((n) => n.remove());
  return htmlToMarkdown(clone.innerHTML);
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function firstText(doc: Document, selectors: string[]): string {
  for (const s of selectors) {
    const t = textOf(doc.querySelector(s));
    if (t) return t;
  }
  return '';
}

interface JobLd {
  title?: string;
  description?: string;
  jobLocation?: unknown;
  baseSalary?: any;
}

function readJobPostingLd(doc: Document): JobLd | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(s.textContent ?? '');
      const items: any[] = Array.isArray(data) ? data : data['@graph'] ?? [data];
      const hit = items.find((i) => (Array.isArray(i['@type']) ? i['@type'].includes('JobPosting') : i['@type'] === 'JobPosting'));
      if (hit) return hit as JobLd;
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

function locationFromLd(loc: unknown): string {
  const list = Array.isArray(loc) ? loc : loc ? [loc] : [];
  return list
    .map((l: any) => {
      const a = l?.address ?? l;
      return [a?.addressLocality, a?.addressRegion, typeof a?.addressCountry === 'string' ? a.addressCountry : a?.addressCountry?.name]
        .filter(Boolean)
        .join(', ');
    })
    .filter(Boolean)
    .join(' | ');
}

function salaryFromLd(s: any): string {
  if (!s) return '';
  const v = s.value ?? {};
  const cur = s.currency ?? v.currency ?? '';
  const unit = v.unitText ? ` per ${String(v.unitText).toLowerCase()}` : '';
  const range = v.minValue != null && v.maxValue != null ? `${v.minValue}–${v.maxValue}` : (v.value ?? '');
  return range ? `${cur} ${range}${unit}`.trim() : '';
}

const SALARY_RE =
  /(?:[$£€]|CAD|USD|EUR|GBP|C\$|US\$)\s?\d[\d,]*(?:\.\d+)?\s?[kK]?\s*(?:[-–—]|to)\s*(?:[$£€]|CAD|USD|EUR|GBP|C\$|US\$)?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s*(?:per|\/|a)\s*(?:year|yr|hour|hr|month|annum))?/i;

/** Pull a salary range out of free text, only when it sits near pay-related wording. */
export function findSalary(text: string): string {
  const m = SALARY_RE.exec(text);
  if (!m) return '';
  const around = text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 40);
  return /salary|compensation|pay|base|range|annual|per (year|hour)/i.test(around) ? m[0].trim() : '';
}

function metaContent(doc: Document, sel: string): string {
  return doc.querySelector(sel)?.getAttribute('content')?.trim() ?? '';
}

function pickDescription(doc: Document, selectors: string[]): string {
  for (const s of selectors) {
    for (const el of Array.from(doc.querySelectorAll(s))) {
      const md = elementToMarkdown(el);
      if (md.length >= MIN_DESCRIPTION_CHARS) return md;
    }
  }
  return '';
}

function readabilityMarkdown(doc: Document): { md: string; title: string } {
  try {
    const clone = doc.cloneNode(true) as Document;
    const parsed = new Readability(clone, { keepClasses: false }).parse();
    if (parsed?.content) return { md: htmlToMarkdown(parsed.content), title: parsed.title ?? '' };
  } catch {
    /* fall through */
  }
  return { md: '', title: '' };
}

/**
 * Extract the job posting from the current page: per-ATS selectors first, then schema.org
 * JobPosting JSON-LD, then Mozilla Readability. Pure over `doc`, so it is unit-testable.
 */
export function extractPosting(doc: Document, url: URL): ExtractedPosting {
  const platform = platformFor(url, doc);
  const sel = SELECTORS[platform];
  const ld = readJobPostingLd(doc);

  let descriptionMd = pickDescription(doc, sel.description);
  let source: ExtractedPosting['source'] = descriptionMd ? 'selectors' : 'none';

  if (!descriptionMd && ld?.description) {
    // JSON-LD descriptions are HTML (sometimes entity-escaped HTML).
    const holder = doc.createElement('div');
    holder.innerHTML = ld.description;
    if (/&lt;\w+/.test(holder.innerHTML) && !holder.querySelector('p, ul, li, br, div')) holder.innerHTML = holder.textContent ?? '';
    const md = htmlToMarkdown(holder.innerHTML);
    if (md.length >= MIN_DESCRIPTION_CHARS) {
      descriptionMd = md;
      source = 'jsonld';
    }
  }

  let readabilityTitle = '';
  if (!descriptionMd) {
    const r = readabilityMarkdown(doc);
    readabilityTitle = r.title;
    if (r.md.length >= MIN_DESCRIPTION_CHARS) {
      descriptionMd = r.md;
      source = 'readability';
    }
  }

  const title =
    firstText(doc, sel.title) || ld?.title?.trim() || metaContent(doc, 'meta[property="og:title"]') || readabilityTitle || doc.title.trim();
  const location = firstText(doc, sel.location) || locationFromLd(ld?.jobLocation);
  const salary = firstText(doc, sel.salary) || salaryFromLd(ld?.baseSalary) || findSalary(descriptionMd);

  const formOnly =
    isFormOnlyUrl(url, platform) || (descriptionMd.length < MIN_DESCRIPTION_CHARS && doc.querySelectorAll('form input, form select, form textarea').length >= 4);

  return {
    title,
    company: deriveCompany(url, doc),
    location,
    salary,
    descriptionMd,
    url: url.toString(),
    canonicalUrl: canonicalPostingUrl(url.toString()),
    platform,
    formOnly,
    source,
  };
}
