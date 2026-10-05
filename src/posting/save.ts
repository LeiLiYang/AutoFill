import type { ExtractedPosting } from './extract';

export interface FormAnswer {
  question: string;
  answer: string;
  /** autofill = from profile, ai = AI draft, existing = was already filled, manual = typed by the user. */
  source: 'autofill' | 'ai' | 'existing' | 'manual';
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_SEGMENT = 60;

/** Make a string safe as one Windows path segment (also safe on macOS/Linux). */
export function sanitizeSegment(input: string, fallback = 'untitled'): string {
  let s = input
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).trim().replace(/[. ]+$/, '');
  if (!s) return fallback;
  return WINDOWS_RESERVED.test(s) ? `_${s}` : s;
}

export const localIsoDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Relative to Chrome's Downloads folder: AutoFill/{Company}/{YYYY-MM-DD} {Title} */
export function postingFolder(p: Pick<ExtractedPosting, 'company' | 'title'>, date: Date = new Date()): string {
  return `AutoFill/${sanitizeSegment(p.company, 'Unknown company')}/${sanitizeSegment(`${localIsoDate(date)} ${p.title}`, localIsoDate(date))}`;
}

export function buildPostingMarkdown(p: ExtractedPosting, date: Date = new Date()): string {
  const meta = [
    `- **Company:** ${p.company}`,
    p.location && `- **Location:** ${p.location}`,
    p.salary && `- **Salary:** ${p.salary}`,
    `- **URL:** ${p.canonicalUrl}`,
    `- **Saved:** ${localIsoDate(date)}`,
  ].filter(Boolean);
  const body = p.descriptionMd || '_No job description could be extracted from this page. See posting.mhtml._';
  return `# ${p.title || 'Job posting'}\n\n${meta.join('\n')}\n\n---\n\n${body}\n`;
}

export function buildAnswersJson(p: ExtractedPosting, answers: FormAnswer[], date: Date = new Date()): string {
  return `${JSON.stringify(
    {
      company: p.company,
      title: p.title,
      url: p.canonicalUrl,
      savedAt: date.toISOString(),
      answers,
    },
    null,
    2,
  )}\n`;
}

export type SavePostingResult =
  | { ok: true; folder: string; files: { name: string; path: string }[]; warnings: string[] }
  | { ok: false; code: 'form-only' | 'no-page' | 'error'; message: string };
