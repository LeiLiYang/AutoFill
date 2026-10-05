import { waitFor } from '../fill/combobox';
import { defaultFill } from '../fill/fillers';
import { safeClick } from '../fill/safety';
import { applyHints, describeWithin, hostMatches, refineLabels } from './common';
import type { FillResult, PlatformAdapter } from './types';

const FORM_ROOTS = ['form#application-form', '.application-form', 'form[action*="lever.co"]', 'form'];
const LOCATION_RESULT = '.dropdown-results .dropdown-location, .dropdown-container .dropdown-location';

/** Lever puts each custom question in an `.application-question` with an `.application-label`. */
const leverQuestion = (el: HTMLElement): string | null => {
  const q = el.closest('.application-question');
  const label = q?.querySelector('.application-label, .text');
  if (!label) return null;
  // Group questions (radios/checkboxes): the option labels live inside; take only the heading text.
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, ul').forEach((n) => n.remove());
  const t = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t || null;
};

export const leverAdapter: PlatformAdapter = {
  id: 'lever',

  detect(ctx) {
    if (hostMatches(ctx, /(^|\.)lever\.co$/)) return 1;
    if (ctx.doc.querySelector('form#application-form')) return 0.9;
    return 0;
  },

  getFields(ctx) {
    const ds = describeWithin(ctx, FORM_ROOTS);
    // Only relabel radio/checkbox/custom cards: top-level fields already have proper <label>s.
    const refined = refineLabels(ds, (el) =>
      el.closest('.custom-question, [class*="application-question"]') && /^cards\[/.test((el as HTMLInputElement).name ?? '')
        ? leverQuestion(el)
        : null,
    );
    return applyHints(refined, [
      { attr: /^location$|^location input$/, key: 'location', only: ['text'] },
      { attr: /^org$/, key: 'currentCompany' },
      { attr: /^name$/, key: 'fullName' },
      { attr: /^eeo gender$/, key: 'gender' },
      { attr: /^eeo race$/, key: 'race' },
      { attr: /^eeo veteran$/, key: 'veteran' },
      { attr: /^eeo disability status$/, key: 'disability' },
    ]);
  },

  async fill(d, value, opts): Promise<FillResult> {
    const res = await defaultFill(d, value, opts);
    // Lever's location box is an autocomplete: the typed text only counts once a suggestion is chosen.
    if (res.status === 'filled' && d.hintedKey === 'location' && d.kind === 'text') {
      const first = await waitFor(() => d.element.ownerDocument.querySelector<HTMLElement>(LOCATION_RESULT), 1200);
      if (first && safeClick(first)) return { status: 'filled', detail: first.textContent?.trim() };
      return { status: 'failed', detail: 'location suggestion not chosen: pick one manually' };
    }
    return res;
  },
};
