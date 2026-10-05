import { beforeEach, describe, expect, it } from 'vitest';
import { ashbyAdapter } from '../../../src/adapters/ashby';
import { pickAdapter } from '../../../src/adapters/registry';
import { workdayAdapter } from '../../../src/adapters/workday';
import { datePart } from '../../../src/detect/values';
import { isOptionSelected } from '../../../src/detect/selection';
import { safeClick } from '../../../src/fill/safety';
import { fillWith, loadFixture, testProfile } from '../fixtures';
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
    expect(val('#jt1')).toBe('');
    expect(reports.some((r) => r.label.startsWith('Job Title'))).toBe(false);
  });

  it('skips the phone country code and device type widgets', async () => {
    const { reports } = await fillWith(workdayAdapter, URL_, testProfile());
    expect(reports.some((r) => /country phone code|phone device type/i.test(r.label))).toBe(false);
    expect(text('#pdt')).toBe('Select One');
    expect(text('#cpc')).toBe('Select One');
  });

  it('flags required fields it cannot fill (no street address in the profile)', async () => {
    const { reports } = await fillWith(workdayAdapter, URL_, testProfile());
    expect(reports.find((r) => r.label.startsWith('Address Line 1'))).toMatchObject({ status: 'no-data', emptyRequired: true });
  });

  it('fills the next step when triggered again, mapping repeated sections to profile entries', async () => {
    const profile = testProfile();
    await fillWith(workdayAdapter, URL_, profile);
    // the user clicks Next themselves
    document.getElementById('step1')!.style.display = 'none';
    document.getElementById('step2')!.style.display = '';

    const { reports } = await fillWith(workdayAdapter, URL_, profile);
    expect(val('#jt1')).toBe('Engineer');
    expect(val('#co1')).toBe('Analytical Engines');
    expect(val('#loc1')).toBe('Montreal, QC');
    expect((document.getElementById('cur1') as HTMLInputElement).checked).toBe(true);
    expect(val('#sm1')).toBe('05');
    expect(val('#sy1')).toBe('2025');
    expect(val('#em1')).toBe(''); // current job: no end date
    expect(val('#rd1')).toBe('Built the engine.');
    expect(val('#sch1')).toBe('Example University');
    expect(text('#deg1')).toBe('BSc');
    expect(val('#ly1')).toBe('2026');

    // a second, unfilled work-experience section has no profile entry: left empty, flagged required
    expect(val('#jt2')).toBe('');
    expect(reports.filter((r) => r.label.startsWith('Job Title')).map((r) => r.status)).toEqual(['filled', 'no-data']);
    expect(reports.filter((r) => r.label.startsWith('Job Title')).at(1)!.emptyRequired).toBe(true);
    // step-1 fields were already filled and are left alone
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
