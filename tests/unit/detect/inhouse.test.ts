import { beforeEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../../../src/adapters/generic';
import { describeWithin } from '../../../src/adapters/common';
import { buildDescriptors } from '../../../src/detect/descriptor';
import { matchField } from '../../../src/detect/match';
import { attrWords } from '../../../src/detect/normalize';
import { runFill } from '../../../src/fill/engine';
import { holdsValue } from '../../../src/fill/text';
import { defaultProfile, type Profile } from '../../../src/profile/schema';
import { descriptors, mount } from '../helpers';

/** The kinds of markup in-house career sites use, none of which a per-ATS adapter knows. */

const keyOf = (html: string) => matchField(descriptors(html)[0]!)?.key;

describe('labels that are not <label> elements', () => {
  it('reads a div caption next to the input', () => {
    const [d] = descriptors('<div class="field"><div class="field-label">First name</div><div><input id="q_17"></div></div>');
    expect(d!.label).toBe('First name');
    expect(matchField(d!)).toMatchObject({ key: 'firstName', rule: 'label:firstName' });
  });

  it('ignores validation and help text when looking for a caption', () => {
    const [d] = descriptors('<div><span class="error-label">This field is required</span><input id="q_1"></div>');
    expect(d!.label).toBe('');
  });

  it('does not borrow a caption from a wrapper that holds several fields', () => {
    const ds = descriptors('<div><div class="label">Email</div><input id="a"><input id="b"></div>');
    expect(ds.map((d) => d.label)).toEqual(['', '']);
  });

  it('reads a floating label placed after the input', () => {
    expect(keyOf('<div><input id="x" placeholder=" "><label>Email address</label></div>')).toBe('email');
  });

  it('uses nearby text even when the input has a placeholder', () => {
    const m = matchField(descriptors('<p>Phone number</p><input placeholder="Enter here">')[0]!);
    expect(m).toMatchObject({ key: 'phone', rule: 'nearby:phone' });
  });

  it('uses data-testid when the name and id say nothing', () => {
    expect(keyOf('<input id="input_48213" data-testid="input-last-name">')).toBe('lastName');
  });
});

describe('names and labels the rules used to miss', () => {
  it.each([
    ['firstname', 'first name'],
    ['applicant_lastname', 'applicant last name'],
    ['phonenumber', 'phone number'],
    ['zipcode', 'zip code'],
  ])('splits the glued attribute name %s', (raw, words) => {
    expect(attrWords(raw)).toBe(words);
  });

  it.each([
    ['<input name="firstname">', 'firstName'],
    ['<input name="lastname">', 'lastName'],
    ['<input name="phonenumber">', 'phone'],
    ['<label for="x">Applicant\'s first name</label><input id="x">', 'firstName'],
    ['<label for="x">Name (First)</label><input id="x">', 'firstName'],
    ['<label for="x">Name (Last)</label><input id="x">', 'lastName'],
    ['<label for="x">Prénom</label><input id="x">', 'firstName'],
    ['<label for="x">Nom de famille</label><input id="x">', 'lastName'],
    ['<label for="x">Courriel</label><input id="x">', 'email'],
    ['<label for="x">Téléphone</label><input id="x">', 'phone'],
    ['<label for="x">Ville</label><input id="x">', 'city'],
    ['<label for="x">Pays</label><input id="x">', 'country'],
  ])('%s → %s', (html, key) => {
    expect(keyOf(html)).toBe(key);
  });

  it.each([
    '<label for="x">Emergency contact first name</label><input id="x">',
    '<label for="x">Reference email</label><input id="x">',
    '<label for="x">Manager\'s phone number</label><input id="x">',
  ])('never fills someone else\'s details: %s', (html) => {
    expect(keyOf(html)).toBeUndefined();
  });
});

describe('controls outside the plain light DOM', () => {
  it('finds fields inside open shadow roots, with their labels', () => {
    mount('<my-form></my-form><input name="email">');
    const shadow = document.querySelector('my-form')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label for="fn">First name</label><input id="fn"><x-inner></x-inner>';
    shadow.querySelector('x-inner')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Last name <input></label>';
    const ds = buildDescriptors(document, document);
    expect(ds.map((d) => matchField(d)?.key)).toEqual(['email', 'firstName', 'lastName']);
  });

  it('never treats the review panel\'s own inputs as form fields', () => {
    mount('<div id="autofill-review-host"></div>');
    document.getElementById('autofill-review-host')!.attachShadow({ mode: 'open' }).innerHTML = '<label>Company <input></label>';
    expect(buildDescriptors(document, document)).toHaveLength(0);
  });

  it('keeps native radios that a site hides behind styled labels', () => {
    const [d] = descriptors(`
      <fieldset><legend>Do you require visa sponsorship?</legend>
        <label class="pill"><input type="radio" name="s" value="y" style="display:none"> Yes</label>
        <label class="pill"><input type="radio" name="s" value="n" style="display:none"> No</label>
      </fieldset>`);
    expect(d).toMatchObject({ kind: 'radio', label: 'Do you require visa sponsorship?' });
    expect(d!.options!.map((o) => o.text)).toEqual(['Yes', 'No']);
  });

  it('still skips radios in a section that is hidden as a whole', () => {
    expect(descriptors('<div style="display:none"><label><input type="radio" name="s"> Yes</label></div>')).toHaveLength(0);
  });

  it('groups custom ARIA radios under their radiogroup label', () => {
    const [d, ...rest] = descriptors(`
      <span id="q">Are you legally authorized to work in Canada?</span>
      <div role="radiogroup" aria-labelledby="q">
        <div role="radio" aria-checked="false" tabindex="0">Yes</div>
        <div role="radio" aria-checked="false" tabindex="0">No</div>
      </div>`);
    expect(rest).toHaveLength(0);
    expect(d).toMatchObject({ kind: 'radio', label: 'Are you legally authorized to work in Canada?' });
    expect(d!.options!.map((o) => o.text)).toEqual(['Yes', 'No']);
    expect(matchField(d!)?.key).toBe('authorizedToWork');
  });

  it('treats a div listbox trigger as a dropdown and a contenteditable as a text answer', () => {
    const ds = descriptors(`
      <label id="c">Country</label><div role="button" aria-haspopup="listbox" aria-labelledby="c">Select…</div>
      <label id="w">Why us?</label><div contenteditable="true" aria-labelledby="w"></div>`);
    expect(ds.map((d) => d.kind)).toEqual(['combobox', 'textarea']);
    expect(ds[0]!.currentValue).toBe('');
  });
});

describe('a platform root that turns out to be empty', () => {
  it('falls back to the whole document', () => {
    mount('<form id="application-form"></form><label for="e">Email</label><input id="e">');
    const ctx = { doc: document, url: new URL('https://careers.example.com/apply'), isTopFrame: true };
    expect(describeWithin(ctx, ['#application-form'])).toHaveLength(1);
  });
});

describe('holdsValue', () => {
  it.each([
    ['(514) 555-0100', '5145550100', true],
    ['+1 514 555 0100', '514-555-0100', true],
    ['ada@example.com', 'Ada@Example.com', true],
    ['', 'Ada', false],
    ['Adam', 'Ada', false],
    ['555', '5145550100', false],
  ])('%s vs %s → %s', (actual, wanted, expected) => {
    expect(holdsValue(actual, wanted)).toBe(expected);
  });
});

describe('runFill on an in-house form', () => {
  let profile: Profile;
  beforeEach(() => {
    profile = defaultProfile();
    profile.contact = { ...profile.contact, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '5145550100' };
    profile.work.assumeAuthorized = true;
  });
  const run = (extra: Partial<Parameters<typeof runFill>[0]['options']> = {}) =>
    runFill({
      adapter: genericAdapter,
      ctx: { doc: document, url: new URL('https://careers.example.com/apply'), isTopFrame: true },
      profile,
      options: { overwrite: false, getFile: async () => null, rescanDelayMs: 1, ...extra },
    });

  it('fills div-captioned inputs, hidden styled radios and custom ARIA radios', async () => {
    mount(`
      <div class="row"><div class="lbl form-label">Prénom</div><input id="q1"></div>
      <div class="row"><input id="q2" name="lastname"></div>
      <span id="q">Are you legally authorized to work in Canada?</span>
      <div role="radiogroup" aria-labelledby="q">
        <div role="radio" aria-checked="false" id="yes">Yes</div>
        <div role="radio" aria-checked="false" id="no">No</div>
      </div>`);
    document.getElementById('yes')!.addEventListener('click', (e) => (e.currentTarget as HTMLElement).setAttribute('aria-checked', 'true'));

    const { reports } = await run();
    expect((document.getElementById('q1') as HTMLInputElement).value).toBe('Ada');
    expect((document.getElementById('q2') as HTMLInputElement).value).toBe('Lovelace');
    expect(document.getElementById('yes')!.getAttribute('aria-checked')).toBe('true');
    expect(reports.map((r) => r.status)).toEqual(['filled', 'filled', 'filled']);
  });

  it('reports a reformatted phone number as filled, not failed', async () => {
    mount('<label for="p">Phone</label><input id="p" type="tel">');
    const input = document.getElementById('p') as HTMLInputElement;
    input.addEventListener('input', () => (input.value = '(514) 555-0100'));
    const { reports } = await run();
    expect(reports[0]).toMatchObject({ status: 'filled', key: 'phone' });
  });

  it('answers an unrecognised dropdown question from the answer bank', async () => {
    mount(`
      <label for="h">How did you hear about this role?</label>
      <select id="h"><option value="">Select…</option><option>LinkedIn</option><option>Referral</option></select>
      <label for="x">Extension</label><input id="x">`);
    const asked: string[] = [];
    const { reports } = await run({
      bankAnswer: (d) => {
        asked.push(d.label);
        return { text: 'LinkedIn', score: 0.95 };
      },
    });
    expect((document.getElementById('h') as HTMLSelectElement).value).toBe('LinkedIn');
    expect(reports[0]).toMatchObject({ status: 'filled', detail: 'from your answer bank' });
    // A short field name is not a question: it is never looked up.
    expect(asked).toEqual(['How did you hear about this role?']);
    expect(reports[1]!.status).toBe('unmatched');
  });

  it('fills a field that an earlier answer revealed', async () => {
    mount('<label for="f">First name</label><input id="f"><div id="more"></div>');
    document.getElementById('f')!.addEventListener('change', () => {
      document.getElementById('more')!.innerHTML = '<label for="l">Last name</label><input id="l">';
    });
    const { reports, descriptors: byId } = await run();
    expect((document.getElementById('l') as HTMLInputElement).value).toBe('Lovelace');
    expect(reports).toHaveLength(2);
    expect(new Set(reports.map((r) => r.id)).size).toBe(2);
    expect(byId.get(reports[1]!.id)!.element.id).toBe('l');
  });
});
