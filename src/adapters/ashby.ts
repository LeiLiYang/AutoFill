import { buildDescriptors } from '../detect/descriptor';
import { isOptionSelected } from '../detect/selection';
import { defaultFill } from '../fill/fillers';
import { applyHints, hostMatches } from './common';
import type { FieldDescriptor, FieldOption, PlatformAdapter } from './types';

/**
 * Ashby (jobs.ashbyhq.com/{company}/{id}/application): a React form whose system fields have ids
 * like `_systemfield_name`, and whose Yes/No questions are pairs of buttons rather than radios.
 */
const FORM_ROOTS = ['.ashby-application-form-container', 'form[class*="application" i]', 'main form', 'form'];
const YES_NO_GROUP = '[class*="_yesno_" i], [class*="yesno" i]';

const questionLabel = (group: Element): string => {
  const entry = group.closest('.ashby-application-form-field-entry, [class*="fieldEntry" i], fieldset') ?? group.parentElement;
  const l = entry?.querySelector('label, legend, [class*="questionTitle" i], [class*="question-title" i]');
  return (l?.textContent ?? '').replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim();
};

/** Yes/No button groups: described as radio groups so the shared choice logic can drive them. */
function buttonGroups(root: ParentNode, startIndex: number): FieldDescriptor[] {
  const out: FieldDescriptor[] = [];
  let n = startIndex;
  for (const group of Array.from(root.querySelectorAll<HTMLElement>(YES_NO_GROUP))) {
    const buttons = Array.from(group.querySelectorAll<HTMLElement>('button, [role="radio"]'));
    if (buttons.length < 2) continue;
    const options: FieldOption[] = buttons.map((b) => ({ text: (b.textContent ?? '').trim(), value: (b.textContent ?? '').trim(), element: b }));
    const label = questionLabel(group);
    const raw = group.closest('.ashby-application-form-field-entry')?.querySelector('label')?.textContent ?? '';
    out.push({
      id: `ab${n++}`,
      element: group,
      kind: 'radio',
      label,
      options,
      required: /[*✱]\s*$/.test(raw.trim()) || !!group.closest('[class*="required" i]'),
      currentValue: buttons.some((b) => isOptionSelected(b)) ? 'checked' : '',
    });
  }
  return out;
}

export const ashbyAdapter: PlatformAdapter = {
  id: 'ashby',

  detect(ctx) {
    if (hostMatches(ctx, /^jobs\.ashbyhq\.com$/)) return 1;
    if (ctx.doc.querySelector('.ashby-application-form-container, [class*="ashby-application-form" i]')) return 0.9;
    return 0;
  },

  getFields(ctx) {
    const root = FORM_ROOTS.map((s) => ctx.doc.querySelector(s)).find(Boolean) ?? ctx.doc;
    const base = buildDescriptors(root, ctx.doc)
      // The Yes/No buttons are not form controls, but the file picker's helper buttons must not appear either.
      .filter((d) => !d.element.closest(YES_NO_GROUP));
    const withHints = applyHints(base, [
      // ids look like "_systemfield_name" → "systemfield name"
      { attr: /^systemfield name$/, key: 'fullName' },
      { attr: /^systemfield email$/, key: 'email' },
      { attr: /^systemfield resume$/, key: 'resume', only: ['file'] },
      { attr: /^systemfield location$/, key: 'location', only: ['text', 'combobox'] },
    ]);
    return [...withHints, ...buttonGroups(root, withHints.length)];
  },

  fill: defaultFill,
};
