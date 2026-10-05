import { defaultFill } from '../fill/fillers';
import { applyHints, describeWithin, hostMatches } from './common';
import type { FieldDescriptor, PlatformAdapter } from './types';

/**
 * Greenhouse: classic boards (boards.greenhouse.io, #application_form) and the newer React
 * boards (job-boards.greenhouse.io). Also runs inside the boards.greenhouse.io/embed iframe that
 * company career sites embed.
 */
const FORM_ROOTS = ['#application_form', 'form#application-form', '#application', 'form[action*="greenhouse"]', 'main form'];

// Phone country pickers (intl-tel-input) are widgets of the phone field, not separate questions.
const isPhoneCountryPicker = (d: FieldDescriptor) =>
  !!d.element.closest('.iti, .iti__country-container, [class*="phone-country" i]') || /country code|dial code/i.test(`${d.label} ${d.ariaLabel ?? ''}`);

export const greenhouseAdapter: PlatformAdapter = {
  id: 'greenhouse',

  detect(ctx) {
    if (hostMatches(ctx, /(^|\.)greenhouse\.io$/)) return 1;
    // Greenhouse markup on a custom domain (e.g. self-hosted embeds).
    if (ctx.doc.querySelector('#application_form, #grnhse_app, form[action*="greenhouse.io"]')) return 0.9;
    return 0;
  },

  getFields(ctx) {
    const ds = describeWithin(ctx, FORM_ROOTS, isPhoneCountryPicker);
    return applyHints(ds, [
      { attr: /\b(candidate )?location\b/, key: 'location', only: ['text', 'combobox'] },
      { attr: /^(job application )?gender( id)?$/, key: 'gender' },
      { attr: /hispanic (ethnicity|latino)/, key: 'hispanicLatino' },
      { attr: /^(job application )?(race|ethnicity)( id)?$/, key: 'race' },
      { attr: /veteran status/, key: 'veteran' },
      { attr: /disability status/, key: 'disability' },
    ]);
  },

  fill: defaultFill,
};
