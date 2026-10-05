import { beforeEach, describe, expect, it } from 'vitest';
import { genericAdapter } from '../../../src/adapters/generic';
import { runFill } from '../../../src/fill/engine';
import { defaultProfile, type Profile } from '../../../src/profile/schema';
import { mount } from '../helpers';

const FORM = `
<form id="app">
  <label for="fn">First Name *</label><input id="fn" name="first_name" required>
  <label for="ln">Last Name *</label><input id="ln" name="last_name" required>
  <label for="em">Email *</label><input id="em" type="email" required>
  <label for="ph">Phone</label><input id="ph" type="tel">
  <label for="li">LinkedIn Profile</label><input id="li">
  <label for="co">Country</label>
  <select id="co"><option value="">Select...</option><option value="US">United States</option><option value="CA">Canada</option></select>
  <fieldset><legend>Do you require visa sponsorship? *</legend>
    <label><input type="radio" name="spons" value="1" required> Yes</label>
    <label><input type="radio" name="spons" value="0"> No</label>
  </fieldset>
  <label for="gn">Gender</label>
  <select id="gn"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>
  <label for="fav">Favorite color *</label><input id="fav" required>
  <label for="why">Why do you want to work here? *</label><textarea id="why" required></textarea>
  <div class="g-recaptcha"><textarea name="g-recaptcha-response" id="cap" required></textarea></div>
  <input id="pw" type="password" name="password">
  <button id="submit" type="submit">Submit Application</button>
</form>`;

let profile: Profile;
beforeEach(() => {
  profile = defaultProfile();
  profile.contact = { ...profile.contact, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '555-0100' };
  profile.links.linkedin = 'https://linkedin.com/in/ada';
  profile.address.country = 'Canada';
  profile.work.requiresSponsorship = false;
});

const run = (overwrite = false) =>
  runFill({
    adapter: genericAdapter,
    ctx: { doc: document, url: new URL('https://example.com/apply'), isTopFrame: true },
    profile,
    options: { overwrite, getFile: async () => null },
  });

const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe('runFill (generic adapter)', () => {
  it('fills matched fields and never submits or clicks submit', async () => {
    mount(FORM);
    const form = document.getElementById('app')!;
    const submitBtn = document.getElementById('submit')!;
    let submitted = 0;
    let submitClicked = 0;
    form.addEventListener('submit', () => submitted++);
    submitBtn.addEventListener('click', () => submitClicked++);

    const { reports } = await run();

    expect(val('fn')).toBe('Ada');
    expect(val('ln')).toBe('Lovelace');
    expect(val('em')).toBe('ada@example.com');
    expect(val('ph')).toBe('555-0100');
    expect(val('li')).toBe('https://linkedin.com/in/ada');
    expect(val('co')).toBe('CA');
    expect((document.querySelector('input[name=spons][value="0"]') as HTMLInputElement).checked).toBe(true);
    expect(val('gn')).toBe('Decline to self-identify');

    expect(submitted).toBe(0);
    expect(submitClicked).toBe(0);
    expect(reports.find((r) => r.label.startsWith('First Name'))?.status).toBe('filled');
  });

  it('never touches CAPTCHA response fields or password inputs', async () => {
    mount(FORM);
    const { reports } = await run();
    expect(val('cap')).toBe('');
    expect(val('pw')).toBe('');
    expect(reports.some((r) => /captcha/i.test(r.label))).toBe(false);
  });

  it('flags required fields it could not fill (red) and free-text questions', async () => {
    mount(FORM);
    const { reports } = await run();
    const fav = reports.find((r) => r.label.startsWith('Favorite color'))!;
    expect(fav.status).toBe('unmatched');
    expect(fav.emptyRequired).toBe(true);
    const why = reports.find((r) => r.label.startsWith('Why do you'))!;
    expect(why.detail).toBe('free-text question');
    expect(why.emptyRequired).toBe(true);
    expect(val('why')).toBe('');
  });

  it('reports no-data (and flags if required) when the profile lacks a value', async () => {
    mount(FORM);
    profile.contact.phone = '';
    const { reports } = await run();
    expect(reports.find((r) => r.label === 'Phone')?.status).toBe('no-data');
    expect(val('ph')).toBe('');
  });

  it('leaves already-filled fields alone unless overwrite is on', async () => {
    mount(FORM);
    (document.getElementById('fn') as HTMLInputElement).value = 'Existing';
    let { reports } = await run(false);
    expect(val('fn')).toBe('Existing');
    expect(reports.find((r) => r.label.startsWith('First Name'))?.status).toBe('skipped-existing');

    ({ reports } = await run(true));
    expect(val('fn')).toBe('Ada');
    expect(reports.find((r) => r.label.startsWith('First Name'))?.status).toBe('filled');
  });

  it('marks low-confidence (fuzzy) matches yellow', async () => {
    mount('<label for="x">Fisrt Name</label><input id="x">');
    const { reports } = await run();
    expect(reports[0]!.status).toBe('low-confidence');
    expect(val('x')).toBe('Ada');
  });

  it('answers country-specific work authorization correctly', async () => {
    profile.work.authorizedCountries = ['Canada'];
    mount(`
      <fieldset><legend>Are you legally authorized to work in Canada?</legend>
        <label><input type="radio" name="a" value="y"> Yes</label><label><input type="radio" name="a" value="n"> No</label></fieldset>
      <fieldset><legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" name="b" value="y"> Yes</label><label><input type="radio" name="b" value="n"> No</label></fieldset>`);
    await run();
    expect((document.querySelector('input[name=a][value=y]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('input[name=b][value=n]') as HTMLInputElement).checked).toBe(true);
  });
});
