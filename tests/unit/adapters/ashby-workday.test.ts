import { beforeEach, describe, expect, it } from 'vitest';
import { ashbyAdapter } from '../../../src/adapters/ashby';
import { pickAdapter } from '../../../src/adapters/registry';
import { workdayAdapter } from '../../../src/adapters/workday';
import { datePart } from '../../../src/detect/values';
import { isOptionSelected } from '../../../src/detect/selection';
import { safeClick } from '../../../src/fill/safety';
import { fillWith, fourInternshipsProfile, loadFixture, testProfile } from '../fixtures';
import { mount } from '../helpers';

const ctx = (url: string) => ({ doc: document, url: new URL(url), isTopFrame: true });
const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;
const text = (sel: string) => document.querySelector(sel)!.textContent!.trim();

describe('datePart / isOptionSelected', () => {
  it.each([
    ['2025-03', 'month', '03'], ['2025-03', 'year', '2025'], ['2025-3-14', 'month', '03'], ['2025', 'month', ''],
    ['2025', 'year', '2025'], ['', 'year', ''], ['ongoing', 'year', ''], ['2025/07', 'month', '07'],
  ] as const)('%s %s → %j', (d, part, expected) => expect(datePart(d, part)).toBe(expected));

  it('reads selection from checked, ARIA state or a state class', () => {
    mount('<input id="a" type="radio" checked><button id="b" aria-pressed="true"></button><button id="c" class="_option_x is-selected"></button><button id="d" class="_option_x"></button>');
    for (const [id, expected] of [['a', true], ['b', true], ['c', true], ['d', false]] as const) {
      expect(isOptionSelected(document.getElementById(id)!)).toBe(expected);
    }
  });
});

describe('Ashby adapter', () => {
  beforeEach(() => loadFixture('ashby/application.html', { runScripts: true }));

  it('is detected by host and by markup', () => {
    expect(pickAdapter(ctx('https://jobs.ashbyhq.com/acme/abc/application')).id).toBe('ashby');
    expect(pickAdapter(ctx('https://careers.example.com/apply')).id).toBe('ashby'); // markup only
  });

  it('fills system fields by id, plain fields by label, and the Yes/No buttons', async () => {
    const { reports } = await fillWith(ashbyAdapter, 'https://jobs.ashbyhq.com/acme/abc/application');
    expect(val('#_systemfield_name')).toBe('Ada Lovelace');
    expect(val('#_systemfield_email')).toBe('ada@example.com');
    expect(val('input[type=tel]')).toBe('555-0100');
    expect(val('[id="9a1b2c3d-0000-0000-0000-000000000001"]')).toBe('https://linkedin.com/in/ada');

    const pressed = (group: string) => Array.from(document.querySelectorAll(`#${group} button`)).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    expect(pressed('yn-auth')).toEqual(['Yes']); // authorized in Canada
    expect(pressed('yn-spons')).toEqual(['No']); // no sponsorship needed

    const auth = reports.find((r) => r.label.startsWith('Are you legally authorized'))!;
    expect(auth.status).toBe('filled');
    expect(auth.emptyRequired).toBe(false);
  });

  it('flags the resume and the open-ended question as required-empty, and never clicks submit', async () => {
    let submitClicks = 0;
    document.getElementById('ashby-submit')!.addEventListener('click', () => submitClicks++);
    const { reports } = await fillWith(ashbyAdapter, 'https://jobs.ashbyhq.com/acme/abc/application');
    expect(reports.find((r) => r.label.startsWith('Resume'))).toMatchObject({ key: 'resume', emptyRequired: true });
    expect(reports.find((r) => r.label.startsWith('What interests you'))).toMatchObject({ detail: 'free-text question', emptyRequired: true });
    expect(submitClicks).toBe(0);
  });

  it('does not double-list the buttons inside a Yes/No group as separate fields', async () => {
    const fields = ashbyAdapter.getFields(ctx('https://jobs.ashbyhq.com/acme/abc/application'));
    expect(fields.filter((f) => f.kind === 'radio')).toHaveLength(2);
    expect(fields.some((f) => f.label === 'Yes' || f.label === 'No')).toBe(false);
  });
});

describe('Workday adapter', () => {
  const URL_ = 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Montreal/Dev_R-1/apply/applyManually';
  beforeEach(() => {
    loadFixture('workday/apply.html', { runScripts: true });
    (window as any).__syntheticNextClicks = 0;
  });

  it('is detected by tenant host and by the apply-flow markup', () => {
    expect(pickAdapter(ctx(URL_)).id).toBe('workday');
    expect(pickAdapter(ctx('https://careers.example.com/x')).id).toBe('workday');
  });

  it('fills only the current step: step 2 stays untouched until the user advances', async () => {
    const { reports } = await fillWith(workdayAdapter, URL_, testProfile());
    expect(val('#first')).toBe('Ada');
    expect(val('#last')).toBe('Lovelace');
    expect(val('#addr1')).toBe(''); // profile has no street address
    expect(val('#city')).toBe('Montreal');
    expect(val('#phone')).toBe('555-0100');
    expect(val('#email')).toBe('ada@example.com');
    expect(text('#country')).toBe('Canada');
    // the step-2 fields are hidden, so they are neither filled nor reported
    expect(val('[id="workExperience-4--jobTitle"]')).toBe('');
    expect(reports.some((r) => r.label.startsWith('Job Title'))).toBe(false);
  });

  it('sets the phone device type to Mobile and leaves the country dialling code alone', async () => {
    const { reports } = await fillWith(workdayAdapter, URL_, testProfile());
    expect(text('#pdt')).toBe('Mobile');
    expect(reports.some((r) => /country phone code/i.test(r.label))).toBe(false);
    expect(text('#cpc')).toBe('Select One');
  });

  it('flags required fields it cannot fill (no street address in the profile)', async () => {
    const { reports } = await fillWith(workdayAdapter, URL_, testProfile());
    expect(reports.find((r) => r.label.startsWith('Address Line 1'))).toMatchObject({ status: 'no-data', emptyRequired: true });
  });

  const goToStep2 = () => {
    // the user clicks Save and Continue themselves
    document.getElementById('step1')!.style.display = 'none';
    document.getElementById('step2')!.style.display = '';
  };
  const wx = (n: number, field: string) => `[id="workExperience-${n}--${field}"]`;

  it('gives each of four work-experience sections its own job, however Workday numbers them', async () => {
    const profile = fourInternshipsProfile();
    goToStep2();
    const { reports } = await fillWith(workdayAdapter, URL_, profile);

    // the page numbers its sections 4,5,6,7; profile entries are matched by order on the page
    [4, 5, 6, 7].forEach((n, i) => {
      const job = profile.experience[i]!;
      expect(val(wx(n, 'jobTitle')), `section ${n} title`).toBe(job.title);
      expect(val(wx(n, 'companyName')), `section ${n} company`).toBe(job.company);
      expect(val(wx(n, 'location'))).toBe(job.location);
      expect(val(wx(n, 'roleDescription')), `section ${n} description`).toBe(job.description);
    });
    expect(new Set([4, 5, 6, 7].map((n) => val(wx(n, 'companyName')))).size).toBe(4); // not the same job four times
    expect(reports.filter((r) => r.label.startsWith('Job Title')).every((r) => r.status === 'filled')).toBe(true);
  });

  it('fills the From / To month and year boxes of every work section', async () => {
    const profile = fourInternshipsProfile();
    goToStep2();
    await fillWith(workdayAdapter, URL_, profile);
    [4, 5, 6, 7].forEach((n, i) => {
      const job = profile.experience[i]!;
      const [sy, sm] = job.startDate.split('-');
      const [ey, em] = job.endDate.split('-');
      expect(val(`[id="workExperience-${n}--startDate-dateSectionMonth-input"]`), `start month ${n}`).toBe(sm);
      expect(val(`[id="workExperience-${n}--startDate-dateSectionYear-input"]`), `start year ${n}`).toBe(sy);
      expect(val(`[id="workExperience-${n}--endDate-dateSectionMonth-input"]`), `end month ${n}`).toBe(em);
      expect(val(`[id="workExperience-${n}--endDate-dateSectionYear-input"]`), `end year ${n}`).toBe(ey);
    });
  });

  it('checks "I currently work here" only on the current job and leaves its end date empty', async () => {
    const profile = fourInternshipsProfile();
    profile.experience[0]!.current = true;
    goToStep2();
    await fillWith(workdayAdapter, URL_, profile);
    const checked = [4, 5, 6, 7].map((n) => (document.querySelector(wx(n, 'currentlyWorkHere')) as HTMLInputElement).checked);
    expect(checked).toEqual([true, false, false, false]);
    expect(val('[id="workExperience-4--endDate-dateSectionYear-input"]')).toBe('');
    expect(val('[id="workExperience-5--endDate-dateSectionYear-input"]')).toBe('2024');
  });

  it('fills education and picks the dropdown option by clicking the element that holds its text', async () => {
    goToStep2();
    await fillWith(workdayAdapter, URL_, fourInternshipsProfile());
    expect(val('[id="education-2--schoolName"]')).toBe('Example University');
    expect(text('[id="education-2--degree"]')).toBe("Bachelor's Degree"); // profile says "Bachelor"
    expect(val('[id="education-2--fieldOfStudy"]')).toBe('Computer Science');
    expect(val('[id="education-2--firstYearAttended-dateSectionYear-input"]')).toBe('2022');
    expect(val('[id="education-2--lastYearAttended-dateSectionYear-input"]')).toBe('2026');
  });

  it('leaves surplus sections empty when the profile has fewer entries, and flags required ones', async () => {
    const profile = fourInternshipsProfile();
    profile.experience = profile.experience.slice(0, 2);
    goToStep2();
    const { reports } = await fillWith(workdayAdapter, URL_, profile);
    expect(val(wx(6, 'jobTitle'))).toBe('');
    expect(reports.filter((r) => r.label.startsWith('Job Title')).map((r) => r.status)).toEqual(['filled', 'filled', 'no-data', 'no-data']);
    expect(reports.filter((r) => r.label.startsWith('Job Title')).at(3)!.emptyRequired).toBe(true);
  });

  it('does not touch step 1 again when filling step 2', async () => {
    const profile = fourInternshipsProfile();
    await fillWith(workdayAdapter, URL_, profile);
    goToStep2();
    const { reports } = await fillWith(workdayAdapter, URL_, profile);
    expect(reports.some((r) => r.label.startsWith('Given Name'))).toBe(false);
  });

  it('never clicks Next / Save and Continue', async () => {
    document.getElementById('step1')!.style.display = '';
    await fillWith(workdayAdapter, URL_, testProfile());
    expect((window as any).__syntheticNextClicks).toBe(0);
    expect(safeClick(document.getElementById('next1')!)).toBe(false);
    expect((window as any).__syntheticNextClicks).toBe(0);
  });
});
