import { describe, expect, it } from 'vitest';
import { greenhouseAdapter } from '../../../src/adapters/greenhouse';
import { leverAdapter } from '../../../src/adapters/lever';
import { pickAdapter } from '../../../src/adapters/registry';
import { genericAdapter } from '../../../src/adapters/generic';
import { runFill } from '../../../src/fill/engine';
import { capturedNow, fillWith, formAnswersNow, loadFixture, testProfile } from '../fixtures';
import { mount } from '../helpers';

const ctx = (url: string) => ({ doc: document, url: new URL(url), isTopFrame: true });
const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;
const checked = (sel: string) => (document.querySelector(sel) as HTMLInputElement).checked;

describe('adapter detection', () => {
  it('picks Greenhouse by host, including job-boards and embeds', () => {
    document.body.innerHTML = '';
    for (const url of ['https://boards.greenhouse.io/acme/jobs/1', 'https://job-boards.greenhouse.io/acme/jobs/1', 'https://boards.greenhouse.io/embed/job_app?for=acme&token=1']) {
      expect(pickAdapter(ctx(url)).id).toBe('greenhouse');
    }
  });

  it('picks Greenhouse by markup on a custom domain', () => {
    loadFixture('greenhouse/classic.html');
    expect(pickAdapter(ctx('https://careers.example.com/apply')).id).toBe('greenhouse');
  });

  it('picks Lever by host or form markup', () => {
    document.body.innerHTML = '';
    expect(pickAdapter(ctx('https://jobs.lever.co/acme/abc/apply')).id).toBe('lever');
    loadFixture('lever/apply.html');
    expect(pickAdapter(ctx('https://careers.example.com/x')).id).toBe('lever');
  });

  it('falls back to generic for unknown pages', () => {
    loadFixture('generic/basic.html');
    expect(pickAdapter(ctx('https://example.com/careers')).id).toBe('generic');
  });
});

describe('Greenhouse adapter on the classic form', () => {
  it('fills identity, answers screening questions, and declines EEO', async () => {
    loadFixture('greenhouse/classic.html');
    const { reports } = await fillWith(greenhouseAdapter, 'https://boards.greenhouse.io/acme/jobs/123');

    expect(val('#first_name')).toBe('Ada');
    expect(val('#last_name')).toBe('Lovelace');
    expect(val('#email')).toBe('ada@example.com');
    expect(val('#phone')).toBe('555-0100');
    expect(val('#q_linkedin')).toBe('https://linkedin.com/in/ada');
    expect((document.querySelector('#q_auth') as HTMLSelectElement).selectedOptions[0]!.text).toBe('Yes');
    expect((document.querySelector('#q_spons') as HTMLSelectElement).selectedOptions[0]!.text).toBe('No');
    expect((document.querySelector('#gender') as HTMLSelectElement).selectedOptions[0]!.text).toBe('Decline To Self Identify');
    expect((document.querySelector('#hispanic_ethnicity') as HTMLSelectElement).selectedOptions[0]!.text).toBe('Decline To Self Identify');
    expect((document.querySelector('#veteran_status') as HTMLSelectElement).selectedOptions[0]!.text).toBe("I don't wish to answer");
    expect((document.querySelector('#disability_status') as HTMLSelectElement).selectedOptions[0]!.text).toBe('I do not want to answer');

    const why = reports.find((r) => r.label.startsWith('Why do you want'))!;
    expect(why.emptyRequired).toBe(true);
    expect(val('#q_why')).toBe('');
  });

  it('flags the resume as required-empty when none is stored, and ignores the CAPTCHA field', async () => {
    loadFixture('greenhouse/classic.html');
    const { reports } = await fillWith(greenhouseAdapter, 'https://boards.greenhouse.io/acme/jobs/123');
    const resume = reports.find((r) => r.label.startsWith('Resume'))!;
    expect(resume.key).toBe('resume');
    expect(resume.emptyRequired).toBe(true);
    expect(val('#g-recaptcha-response')).toBe('');
    expect(reports.some((r) => /recaptcha/i.test(r.label))).toBe(false);
  });
});

describe('Lever adapter', () => {
  it('uses the application-label as the question for radio cards and fills them', async () => {
    loadFixture('lever/apply.html');
    const { reports } = await fillWith(leverAdapter, 'https://jobs.lever.co/acme/abc/apply');

    expect(val('input[name=name]')).toBe('Ada Lovelace');
    expect(val('input[name=email]')).toBe('ada@example.com');
    expect(val('input[name=org]')).toBe('Analytical Engines');
    expect(val('input[name="urls[LinkedIn]"]')).toBe('https://linkedin.com/in/ada');
    expect(val('input[name="urls[GitHub]"]')).toBe('https://github.com/ada');
    expect(val('input[name="urls[Portfolio]"]')).toBe('https://ada.dev');

    expect(checked('input[name="cards[u1][field0]"][value=Yes]')).toBe(true);
    expect(checked('input[name="cards[u2][field0]"][value=No]')).toBe(true);
    const auth = reports.find((r) => r.label.startsWith('Are you legally authorized'))!;
    expect(auth.status).toBe('filled');

    expect((document.querySelector('select[name="eeo[gender]"]') as HTMLSelectElement).value).toBe('Decline to self-identify');
    expect((document.querySelector('select[name="eeo[veteran]"]') as HTMLSelectElement).value).toBe('I decline to self-identify');
  });

  it('reports a location whose suggestion could not be chosen instead of claiming success', async () => {
    loadFixture('lever/apply.html'); // scripts stripped: no suggestions appear
    const { reports } = await fillWith(leverAdapter, 'https://jobs.lever.co/acme/abc/apply');
    const loc = reports.find((r) => r.label.startsWith('Current location'))!;
    expect(loc.status).toBe('failed');
    expect(loc.emptyRequired).toBe(false); // text was typed; user must pick the suggestion
  }, 10000);

  it('leaves free-text card questions for the user and flags them', async () => {
    loadFixture('lever/apply.html');
    const { reports } = await fillWith(leverAdapter, 'https://jobs.lever.co/acme/abc/apply');
    const q = reports.find((r) => r.label.startsWith('Tell us about a project'))!;
    expect(q.detail).toBe('free-text question');
    expect(q.emptyRequired).toBe(true);
  });
});

describe('captureAnswers', () => {
  it('captures only fields the user answered manually after the run', async () => {
    loadFixture('greenhouse/classic.html');
    const run = await fillWith(greenhouseAdapter, 'https://boards.greenhouse.io/acme/jobs/123');

    expect(capturedNow(greenhouseAdapter, run).answers).toEqual([]);

    (document.querySelector('#q_why') as HTMLTextAreaElement).value = 'Because the mission resonates.';
    (document.querySelector('#q_edu') as HTMLInputElement).value = 'Functional';
    const captured = capturedNow(greenhouseAdapter, run);
    expect(captured.answers).toEqual([
      { question: 'Why do you want to work at Acme?', answer: 'Because the mission resonates.' },
      { question: 'What is your favorite programming paradigm?', answer: 'Functional' },
    ]);
    expect(captured.scanned).toBeGreaterThan(10); // reports what it looked at, so an empty result can be explained
  });

  it('does not save profile fields the user typed by hand (an address is not a question)', async () => {
    mount('<label for="a">Address Line 1</label><input id="a"><label for="q">Why do you want to work here?</label><textarea id="q"></textarea>');
    const run = await fillWith(genericAdapter, 'https://example.com/apply'); // profile has no street address
    (document.getElementById('a') as HTMLInputElement).value = '1 Main Street';
    (document.getElementById('q') as HTMLTextAreaElement).value = 'Because it is a good fit for my skills.';
    expect(capturedNow(genericAdapter, run).answers.map((a) => a.question)).toEqual(['Why do you want to work here?']);
  });

  it('finds answers on a wizard step that appeared after the last fill', async () => {
    mount('<div id="s1"><label for="a">First Name</label><input id="a"></div>');
    const run = await fillWith(genericAdapter, 'https://example.com/apply');
    // the page moves on to a new step the extension never scanned
    document.body.insertAdjacentHTML('beforeend', '<div id="s2"><label for="q">Tell us about a project you are proud of</label><textarea id="q"></textarea></div>');
    (document.getElementById('q') as HTMLTextAreaElement).value = 'I built a small compiler.';
    expect(capturedNow(genericAdapter, run).answers).toEqual([{ question: 'Tell us about a project you are proud of', answer: 'I built a small compiler.' }]);
  });

  it('does not save values the extension itself filled', async () => {
    mount('<label for="a">Why do you want to work here?</label><textarea id="a"></textarea>');
    const run = await runFill({
      adapter: genericAdapter,
      ctx: { doc: document, url: new URL('https://example.com'), isTopFrame: true },
      profile: testProfile(),
      options: { overwrite: false, getFile: async () => null, freeText: async () => ({ kind: 'bank', text: 'From my bank.', score: 0.99 }) },
    });
    expect(capturedNow(genericAdapter, run).answers).toEqual([]);
  });

  it('keeps answers.json current with what the form holds now, including later steps', async () => {
    mount('<label for="a">First Name</label><input id="a">');
    const run = await fillWith(genericAdapter, 'https://example.com/apply');
    document.body.insertAdjacentHTML('beforeend', '<label for="q">Anything else we should know?</label><textarea id="q"></textarea>');
    (document.getElementById('q') as HTMLTextAreaElement).value = 'I can start in May.';
    const answers = formAnswersNow(genericAdapter, run);
    expect(answers.find((a) => a.question === 'First Name')).toMatchObject({ answer: 'Ada', source: 'autofill' });
    expect(answers.find((a) => a.question === 'Anything else we should know?')).toMatchObject({ answer: 'I can start in May.', source: 'manual' });
  });
});
