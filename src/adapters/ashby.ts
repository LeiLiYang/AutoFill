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
const YES_NO_CLASS = '[class*="_yesno_" i], [class*="yesno" i]';
const isYesNoText = (b: Element) => /^(yes|no)$/i.test((b.textContent ?? '').trim());

/**
 * Yes/No button groups: a class-named container, or (class names are hashed and change) any parent
 * whose only buttons read exactly "Yes" and "No".
 */
function findYesNoGroups(root: ParentNode): HTMLElement[] {
  const groups = new Set<HTMLElement>(Array.from(root.querySelectorAll<HTMLElement>(YES_NO_CLASS)));
  for (const b of Array.from(root.querySelectorAll<HTMLElement>('button, [role="radio"]'))) {
    const parent = b.parentElement;
    if (!parent || !isYesNoText(b)) continue;
    const buttons = Array.from(parent.querySelectorAll<HTMLElement>('button, [role="radio"]'));
    const texts = buttons.map((x) => (x.textContent ?? '').trim().toLowerCase()).sort();
    if (buttons.length === 2 && texts[0] === 'no' && texts[1] === 'yes') groups.add(parent);
  }
  // Keep the outermost container only.
  return [...groups].filter((g) => ![...groups].some((o) => o !== g && o.contains(g)));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clean = (s: string) => squash(s).replace(/[*✱]\s*$/, '').trim();

/**
 * The raw question text for a group (a trailing * marks it required): its entry's label/legend/title,
 * else the closest text just above it.
 */
function questionText(group: HTMLElement): string {
  const entry = group.closest('.ashby-application-form-field-entry, [class*="fieldEntry" i], fieldset');
  const inEntry = entry?.querySelector('label, legend, [class*="questionTitle" i], [class*="question-title" i]');
  if (inEntry?.textContent?.trim()) return squash(inEntry.textContent);

  for (let n: HTMLElement | null = group, up = 0; n && up < 4; n = n.parentElement, up++) {
    for (let prev = n.previousElementSibling; prev; prev = prev.previousElementSibling) {
      const t = squash(prev.textContent ?? '');
      if (t && t.length < 400) return t;
    }
  }
  return '';
}

function buttonGroups(groups: HTMLElement[], startIndex: number): FieldDescriptor[] {
  return groups.map((group, i) => {
    const buttons = Array.from(group.querySelectorAll<HTMLElement>('button, [role="radio"]'));
    const options: FieldOption[] = buttons.map((b) => ({ text: (b.textContent ?? '').trim(), value: (b.textContent ?? '').trim(), element: b }));
    const raw = questionText(group);
    return {
      id: `ab${startIndex + i}`,
      element: group,
      kind: 'radio' as const,
      label: clean(raw),
      options,
      required: /[*✱]\s*$/.test(raw) || !!group.closest('[class*="required" i]'),
      currentValue: buttons.some((b) => isOptionSelected(b)) ? 'checked' : '',
    };
  });
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
    const groups = findYesNoGroups(root);
    // The Yes/No buttons are not form controls; the file picker's helper buttons must not appear either.
    const base = buildDescriptors(root, ctx.doc).filter((d) => !groups.some((g) => g.contains(d.element)));
    const withHints = applyHints(base, [
      // ids look like "_systemfield_name" → "systemfield name"
      { attr: /^systemfield name$/, key: 'fullName' },
      { attr: /^systemfield email$/, key: 'email' },
      { attr: /^systemfield resume$/, key: 'resume', only: ['file'] },
      { attr: /^systemfield location$/, key: 'location', only: ['text', 'combobox'] },
    ]);
    return [...withHints, ...buttonGroups(groups, withHints.length)];
  },

  fill: defaultFill,
};
