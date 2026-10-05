import { attrWords } from '../detect/normalize';
import { defaultFill } from '../fill/fillers';
import { applyHints, describeWithin, hostMatches, sectionIndex, type Hint } from './common';
import type { FieldDescriptor, PlatformAdapter } from './types';

/**
 * Workday (*.myworkdayjobs.com): a multi-step wizard of custom React widgets that exposes stable
 * `data-automation-id` attributes. This adapter fills only what is rendered on the CURRENT step.
 * The user clicks Next themselves (the safety layer refuses to click it) and triggers fill again.
 *
 * Dropdowns are `button[aria-haspopup="listbox"]` and are driven through the shared combobox filler.
 */
const STEP_ROOTS = ['[data-automation-id="applyFlowPage"]', '[data-automation-id="pageContent"]', 'main', '[role="main"]'];

/**
 * Attribute words of the field and of its wrappers up to its repeating section. Workday often names
 * the *wrapper* ("formField-startDate") and leaves the input as "dateSectionMonth-input".
 */
function wordsOf(d: FieldDescriptor): string {
  const parts = [d.automationId, d.htmlId, d.name];
  for (let n: Element | null = d.element.parentElement, i = 0; n && i < 6; n = n.parentElement, i++) {
    const id = n.getAttribute('data-automation-id');
    if (id) parts.push(id);
    if (/^(workExperience|education)-\d+$/.test(id ?? '')) break;
  }
  return parts.filter(Boolean).map((v) => attrWords(v)).join(' ');
}

// Phone country code / device type / extension belong to the phone field, not separate questions.
const isPhoneCompanion = (d: FieldDescriptor) => /country phone code|phone device type|phone extension|phone code/.test(wordsOf(d));

const inSection = (prefix: string, re: RegExp) => (d: FieldDescriptor) =>
  !!d.element.closest(`[data-automation-id^="${prefix}-"]`) && re.test(wordsOf(d));

const HINTS: Hint[] = [
  // Resume / cover letter uploads live in their own sections; the input itself is generic.
  { test: (d) => !!d.element.closest('[data-automation-id*="cover" i]'), key: 'coverLetter', only: ['file'] },
  { test: (d) => !!d.element.closest('[data-automation-id*="resume" i], [data-automation-id*="cv" i]') || /resume|cv/i.test(d.label), key: 'resume', only: ['file'] },

  // My Experience: repeated work-experience sections ("workExperience-1", "workExperience-2", ...).
  { test: inSection('workExperience', /job title/), key: 'currentTitle' },
  { test: inSection('workExperience', /company name|company$|employer/), key: 'currentCompany' },
  { test: inSection('workExperience', /currently work here/), key: 'expCurrent' },
  { test: inSection('workExperience', /start date.*month|month.*start/), key: 'expStartMonth' },
  { test: inSection('workExperience', /start date.*year|year.*start/), key: 'expStartYear' },
  { test: inSection('workExperience', /end date.*month|month.*end/), key: 'expEndMonth' },
  { test: inSection('workExperience', /end date.*year|year.*end/), key: 'expEndYear' },
  { test: inSection('workExperience', /role description|description/), key: 'expDescription' },
  { test: inSection('workExperience', /location/), key: 'expLocation' },

  // Education ("education-1", ...).
  { test: inSection('education', /school/), key: 'school' },
  { test: inSection('education', /degree/), key: 'degree' },
  { test: inSection('education', /field of study/), key: 'field' },
  { test: inSection('education', /grade average|gpa/), key: 'gpa' },
  { test: inSection('education', /first year attended|start/), key: 'eduStartYear' },
  { test: inSection('education', /last year attended|end/), key: 'eduEndYear' },
];

export const workdayAdapter: PlatformAdapter = {
  id: 'workday',

  detect(ctx) {
    if (hostMatches(ctx, /\.myworkdayjobs\.com$/)) return 1;
    if (ctx.doc.querySelector('[data-automation-id="applyFlowPage"]')) return 0.9;
    return 0;
  },

  getFields(ctx) {
    const ds = describeWithin(ctx, STEP_ROOTS, isPhoneCompanion);
    return applyHints(ds, HINTS).map((d) => {
      const entryIndex = sectionIndex(d.element, 'workExperience') ?? sectionIndex(d.element, 'education');
      return entryIndex == null ? d : { ...d, entryIndex };
    });
  },

  fill: defaultFill,
};
