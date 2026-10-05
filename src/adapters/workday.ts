import { attrWords } from '../detect/normalize';
import { defaultFill } from '../fill/fillers';
import { applyHints, describeWithin, hostMatches, type Hint } from './common';
import type { FieldDescriptor, PlatformAdapter } from './types';

/**
 * Workday (*.myworkdayjobs.com): a multi-step wizard of custom React widgets that exposes stable
 * `data-automation-id` attributes. This adapter fills only what is rendered on the CURRENT step.
 * The user clicks Next themselves (the safety layer refuses to click it) and triggers fill again.
 *
 * Dropdowns are `button[aria-haspopup="listbox"]` and are driven through the shared combobox filler.
 * Repeated sections (Work Experience 1…n) are numbered by the engine in page order, so nothing here
 * depends on how Workday numbers its section ids.
 */
const STEP_ROOTS = ['[data-automation-id="applyFlowPage"]', '[data-automation-id="pageContent"]', 'main', '[role="main"]'];

/**
 * Attribute words of the field and of its wrappers (a few levels up). Workday often names the
 * *wrapper* ("formField-startDate") and leaves the input as "dateSectionMonth-input".
 */
function wordsOf(d: FieldDescriptor): string {
  const parts = [d.automationId, d.htmlId, d.name];
  for (let n: Element | null = d.element.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
    const id = n.getAttribute('data-automation-id');
    if (id) parts.push(id);
    if (n.id) parts.push(n.id);
  }
  return parts.filter(Boolean).map((v) => attrWords(v)).join(' ');
}

// The country dialling code and extension belong to the phone field, not separate questions.
// (Phone device type is NOT skipped: it is answered from the profile, "Mobile" by default.)
const isPhoneCompanion = (d: FieldDescriptor) => /country phone code|phone extension|phone code|dial code/.test(wordsOf(d));

const experience = (re: RegExp) => (d: FieldDescriptor) => d.section === 'experience' && re.test(wordsOf(d));
const startDate = (part: 'month' | 'year') => (d: FieldDescriptor) => /\b(start|from)\b/.test(wordsOf(d)) && new RegExp(`\\b${part}\\b`).test(wordsOf(d));
const endDate = (part: 'month' | 'year') => (d: FieldDescriptor) => /\b(end|to)\b/.test(wordsOf(d)) && new RegExp(`\\b${part}\\b`).test(wordsOf(d));

const HINTS: Hint[] = [
  // Uploads: a cover-letter section is a cover letter; any other file input on a Workday step is the resume.
  { test: (d) => /cover/.test(wordsOf(d)) || /cover/i.test(d.label), key: 'coverLetter', only: ['file'] },
  { test: () => true, key: 'resume', only: ['file'] },

  // My Experience
  { test: experience(/role description|\bdescription\b/), key: 'expDescription' },
  { test: experience(/currently work here/), key: 'expCurrent' },
  { test: experience(/\blocation\b/), key: 'expLocation' },
  { test: (d) => d.section === 'experience' && startDate('month')(d), key: 'startMonth', only: ['text', 'combobox', 'select'] },
  { test: (d) => d.section === 'experience' && startDate('year')(d), key: 'startYear', only: ['text', 'combobox', 'select'] },
  { test: (d) => d.section === 'experience' && endDate('month')(d), key: 'endMonth', only: ['text', 'combobox', 'select'] },
  { test: (d) => d.section === 'experience' && endDate('year')(d), key: 'endYear', only: ['text', 'combobox', 'select'] },

  // Education
  { test: (d) => d.section === 'education' && startDate('year')(d), key: 'startYear', only: ['text', 'combobox', 'select'] },
  { test: (d) => d.section === 'education' && endDate('year')(d), key: 'endYear', only: ['text', 'combobox', 'select'] },
];

export const workdayAdapter: PlatformAdapter = {
  id: 'workday',

  detect(ctx) {
    if (hostMatches(ctx, /\.myworkdayjobs\.com$/)) return 1;
    if (ctx.doc.querySelector('[data-automation-id="applyFlowPage"]')) return 0.9;
    return 0;
  },

  getFields(ctx) {
    return applyHints(describeWithin(ctx, STEP_ROOTS, isPhoneCompanion), HINTS);
  },

  fill: defaultFill,
};
