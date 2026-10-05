import { beforeEach, describe, expect, it } from 'vitest';
import { ashbyAdapter } from '../../../src/adapters/ashby';
import { greenhouseAdapter } from '../../../src/adapters/greenhouse';
import { genericAdapter } from '../../../src/adapters/generic';
import { optionScore } from '../../../src/detect/fuzzy';
import { matchField } from '../../../src/detect/match';
import { descriptors, mount } from '../helpers';
import { fillWith, loadFixture, testProfile } from '../fixtures';

const GH = 'https://job-boards.greenhouse.io/acme/jobs/1';
const shown = (id: string) => document.getElementById(id)!.closest('.select__control')!.querySelector('.select__single-value')!.textContent;
const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe('option matching: "Bachelor" vs "Bachelor\'s degree"', () => {
  it.each([
    ['Bachelor\'s degree', 'Bachelor', 0.7],
    ['Bachelors degree', 'Bachelor', 0.7],
    ['Master\'s degree', 'Masters', 0.7],
    ['Colleges', 'College', 0.9],
  ])('%s ← %s', (option, target, min) => expect(optionScore(option, target)).toBeGreaterThanOrEqual(min));

  it('does not over-match unrelated options', () => {
    expect(optionScore('Not sure', 'No')).toBe(0);
    expect(optionScore('Bachelor of Arts', 'Master')).toBe(0);
    expect(optionScore('Associate degree', 'Bachelor')).toBe(0);
  });
});

describe('Greenhouse education and employment sections', () => {
  beforeEach(() => loadFixture('greenhouse/sections.html', { runScripts: true }));

  const profile = () => {
    const p = testProfile();
    p.education = [{ school: 'Example University', degree: 'Bachelor', field: 'Computer Science', startDate: '2022-09', endDate: '2026-05', gpa: '', current: true }];
    p.experience = [
      { company: 'Alpha Labs', title: 'SWE Intern', location: '', startDate: '2025-05', endDate: '2025-08', current: false, description: '' },
      { company: 'Beta Systems', title: 'Backend Intern', location: '', startDate: '2024-06', endDate: '2024-09', current: false, description: '' },
    ];
    return p;
  };

  it('selects "Bachelor\'s degree" when the profile just says "Bachelor"', async () => {
    const { reports } = await fillWith(greenhouseAdapter, GH, profile());
    expect(shown('degree--0')).toBe("Bachelor's degree");
    expect(reports.find((r) => r.label === 'Degree')).toMatchObject({ status: 'filled' });
    expect(shown('school--0')).toBe('Example University');
    expect(shown('discipline--0')).toBe('Computer Science');
  });

  it('fills the education start month (a month-name dropdown) and start year (a text box) from YYYY-MM', async () => {
    await fillWith(greenhouseAdapter, GH, profile());
    expect(shown('start-month--0')).toBe('September');
    expect(val('start-year--0')).toBe('2022');
    expect(shown('end-month--0')).toBe('May');
    expect(val('end-year--0')).toBe('2026');
  });

  it('keeps education dates and employment dates apart, and numbers the employment entries in order', async () => {
    await fillWith(greenhouseAdapter, GH, profile());
    expect(val('company-name-0')).toBe('Alpha Labs');
    expect(val('title-0')).toBe('SWE Intern');
    expect(shown('emp-start-month-0')).toBe('May');
    expect(val('emp-start-year-0')).toBe('2025');
    expect(shown('emp-end-month-0')).toBe('August');
    expect(val('emp-end-year-0')).toBe('2025');
    expect(val('company-name-1')).toBe('Beta Systems');
    expect(shown('emp-start-month-1')).toBe('June');
    expect(val('emp-start-year-1')).toBe('2024');
    expect(val('emp-end-year-1')).toBe('2024');
    // none of the employment dates leaked into the education fields, or the other way round
    expect(val('start-year--0')).toBe('2022');
  });

  it('classifies each date field by the part of the form it sits in', () => {
    const byId = (id: string) => descriptors(document.body.innerHTML).find((d) => d.htmlId === id)!;
    loadFixture('greenhouse/sections.html');
    expect(byId('start-year--0').section).toBe('education');
    expect(byId('emp-start-year-0').section).toBe('experience');
    expect(matchField(byId('start-month--0'))?.key).toBe('startMonth');
    expect(matchField(byId('emp-end-year-1'))?.key).toBe('endYear');
  });

  it('reports the options a dropdown offered when none matches', async () => {
    const p = profile();
    p.education[0]!.degree = 'Underwater basket weaving';
    const { reports } = await fillWith(greenhouseAdapter, GH, p);
    const deg = reports.find((r) => r.label === 'Degree')!;
    expect(deg.status).toBe('failed');
    expect(deg.detail).toMatch(/Offered:.*Bachelor's degree/);
  });
});

describe('the same dropdown fixes apply on every platform (generic adapter)', () => {
  it('maps a province code to the full name a dropdown offers', async () => {
    loadFixture('workday/apply.html', { runScripts: true });
    await fillWith(genericAdapter, 'https://example.com/apply', testProfile());
    expect(document.getElementById('region')!.textContent).toBe('Quebec'); // profile says QC
  });
});

describe('phone type and work authorization', () => {
  it('answers a phone-type dropdown with Mobile by default, and honours a custom value', async () => {
    mount('<label for="t">Phone Type</label><select id="t"><option value="">Select</option><option>Home</option><option>Work</option><option>Mobile</option></select>');
    await fillWith(genericAdapter, 'https://example.com', testProfile());
    expect((document.getElementById('t') as HTMLSelectElement).value).toBe('Mobile');

    const p = testProfile();
    p.contact.phoneType = 'Home';
    mount('<label for="t">Phone Type</label><select id="t"><option value="">Select</option><option>Home</option><option>Work</option><option>Mobile</option></select>');
    await fillWith(genericAdapter, 'https://example.com', p);
    expect((document.getElementById('t') as HTMLSelectElement).value).toBe('Home');
  });

  it('does not mistake the phone-type field for the phone number', () => {
    const [d] = descriptors('<label for="t">Phone Device Type</label><select id="t"><option>Mobile</option></select>');
    expect(matchField(d!)?.key).toBe('phoneType');
  });
});

describe('Ashby: authorization and sponsorship, whatever the markup', () => {
  beforeEach(() => loadFixture('ashby/hashed.html', { runScripts: true }));
  const URL_ = 'https://jobs.ashbyhq.com/acme/abc/application';
  const profile = () => {
    const p = testProfile();
    p.work.authorizedCountries = []; // nothing to infer the answer from: it must come from the setting
    return p;
  };

  it('finds Yes/No groups with hashed class names by their button text, and labels them', () => {
    const fields = ashbyAdapter.getFields({ doc: document, url: new URL(URL_), isTopFrame: true });
    const radios = fields.filter((f) => f.kind === 'radio');
    expect(radios.map((f) => f.label)).toEqual([
      'Are you legally authorized to work in the country in which this job is located?',
      'Will you now or in the future require sponsorship to work in this country?',
      'Are you open to relocating?',
    ]);
    expect(radios.every((f) => f.required === (f.label.length > 0 && !f.label.includes('relocating')))).toBe(true);
  });

  it('always selects Yes for authorized to work, even with no country list', async () => {
    const { reports } = await fillWith(ashbyAdapter, URL_, profile());
    const auth = document.querySelectorAll('#auth button');
    expect(auth[0]!.className).toContain('_k8x2'); // "Yes" was clicked and the page reacted
    expect(reports.find((r) => r.label.startsWith('Are you legally authorized'))).toMatchObject({ status: 'filled', emptyRequired: false });
  });

  it('selects No for sponsorship, and says so plainly when the page shows no visible change', async () => {
    const { reports } = await fillWith(ashbyAdapter, URL_, profile());
    const spons = reports.find((r) => r.label.startsWith('Will you now or in the future'))!;
    // nothing observable changed: it was clicked, but we cannot confirm. That is flagged yellow, not a failure.
    expect(spons.status).toBe('low-confidence');
    expect(spons.detail).toMatch(/clicked “No”/);
    expect(spons.emptyRequired).toBe(false);
  });

  it('confirms a normal aria-pressed toggle', async () => {
    const { reports } = await fillWith(ashbyAdapter, URL_, { ...profile(), work: { ...profile().work, willingToRelocate: true } });
    expect(document.querySelectorAll('#reloc button')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(reports.find((r) => r.label.startsWith('Are you open to relocating'))!.status).toBe('filled');
  });

  it('the setting can be turned off to answer per country again', async () => {
    const p = profile();
    p.work.assumeAuthorized = false;
    p.work.authorizedCountries = ['Canada'];
    // The question says "the country in which this job is located": no country named → falls back to home jurisdiction (Yes).
    const { reports } = await fillWith(ashbyAdapter, URL_, p);
    expect(reports.find((r) => r.label.startsWith('Are you legally authorized'))!.status).toBe('filled');
    expect(document.querySelectorAll('#spons button')[1]).toBeTruthy();
    expect(p.work.requiresSponsorship).toBe(false);
  });
});
