import { normalize } from '../detect/normalize';

const compact = (s: string) => normalize(s).replace(/ /g, '');

/** "acme-corp" → "Acme Corp"; names that already have capitals are left alone. */
export function prettifySlug(slug: string): string {
  const decoded = decodeURIComponent(slug).trim();
  if (/[A-Z]/.test(decoded)) return decoded.replace(/[-_]+/g, ' ');
  return decoded
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The ATS-provided company identifier from the URL, or null when the URL has none. */
export function companySlugFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (segs[0] === 'embed') return url.searchParams.get('for');
    return segs[0] ?? null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.ashbyhq.com') return segs[0] ?? null;
  if (/\.myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split('.')[0];
    return tenant && tenant !== 'www' ? tenant : null;
  }
  return null;
}

interface JsonLdOrg {
  hiringOrganization?: { name?: string } | string;
}

function companyFromJsonLd(doc: Document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(s.textContent ?? '');
      const items: JsonLdOrg[] = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const item of items) {
        const org = item.hiringOrganization;
        const name = typeof org === 'string' ? org : org?.name;
        if (name) return name.trim();
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return null;
}

/** Legal-form suffixes that are never part of the name people use ("Chewy Inc" → "Chewy"). */
const LEGAL_SUFFIX = /[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|gmbh|plc|ulc|llp|lp)\.?$/i;

/** The short name used in the sheet: whitespace collapsed, parentheticals and legal suffixes dropped. */
export function cleanCompany(name: string): string {
  let out = name.replace(/\s+/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(LEGAL_SUFFIX, '').trim();
  }
  return out || name.trim();
}

/** LinkedIn titles name the company, not the page: "Role | Company | LinkedIn", "Company hiring Role in City | LinkedIn". */
function companyFromLinkedInTitle(title: string): string | null {
  const hiring = title.match(/^(.+?)\s+hiring\s+.+\s+\|\s*LinkedIn\s*$/i)?.[1];
  if (hiring) return hiring.trim();
  const parts = title.split(/\s+\|\s+/).map((x) => x.trim());
  if (parts.length >= 3 && /^linkedin$/i.test(parts[parts.length - 1]!)) return parts[parts.length - 2]!;
  return null;
}

function companyFromMetadata(doc: Document, onLinkedIn = false): string | null {
  const ld = companyFromJsonLd(doc);
  if (ld) return ld;
  const sel = doc.querySelector(
    '.company-name, [data-qa="company-name"], [class*="company-name" i], .job-details-jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name a, .topcard__org-name-link',
  );
  if (sel?.textContent?.trim()) return sel.textContent.trim();
  if (onLinkedIn) {
    const li = companyFromLinkedInTitle(doc.title ?? '');
    if (li) return li;
  }
  const og = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (og?.trim() && !/^linkedin$/i.test(og.trim())) return og.trim();
  if (onLinkedIn) return null; // "Role - Company" guessing below would return the job title
  // "Job Application for Backend Engineer at Acme" / "Acme - Software Engineer" / "Software Engineer | Acme"
  const title = doc.title ?? '';
  const at = title.match(/\bat\s+(.+?)\s*$/i)?.[1];
  if (at) return at.trim();
  // Lever-style "Acme - Software Engineer": the company leads. (Only a guess for unknown sites.)
  const parts = title.split(/\s+[-|–—]\s+/);
  return parts.length > 1 ? parts[0]!.trim() : null;
}

/** An embedded Greenhouse/Lever form on a company site names the company in its iframe src. */
function companyFromEmbeds(doc: Document): string | null {
  const src = doc.querySelector('iframe[src*="greenhouse.io"]')?.getAttribute('src');
  if (!src) return null;
  try {
    return new URL(src, 'https://boards.greenhouse.io').searchParams.get('for');
  } catch {
    return null;
  }
}

/**
 * Company name for the tracking sheet. The ATS slug/tenant is the anchor; page metadata is
 * preferred only when it is the same name with better capitalisation/spacing.
 */
export function deriveCompany(url: URL, doc?: Document): string {
  const slug = companySlugFromUrl(url) ?? (doc ? companyFromEmbeds(doc) : null);
  const metaRaw = doc ? companyFromMetadata(doc, /(^|\.)linkedin\.com$/i.test(url.hostname)) : null;
  const meta = metaRaw ? cleanCompany(metaRaw) : null;
  if (slug) {
    const sc = compact(slug);
    if (meta && sc) {
      // The shortest leading words of the metadata name that spell the slug: "Chewy Inc" and
      // "TikTok Live" both give the company itself when the slug is chewy / tiktok.
      const words = meta.split(' ');
      for (let n = 1; n <= words.length; n++) {
        const head = words.slice(0, n).join(' ');
        if (compact(head) === sc) return head;
        if (compact(head).length > sc.length) break;
      }
    }
    return prettifySlug(slug);
  }
  if (meta) return meta;
  // Last resort: the site's registrable name ("careers.acme.com" → "Acme").
  const labels = url.hostname.replace(/^www\./, '').split('.');
  const name = labels.length > 1 ? labels[labels.length - 2]! : labels[0]!;
  return prettifySlug(name);
}
