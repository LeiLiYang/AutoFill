import { expect, test, type Page } from '@playwright/test';
import { e2eFourInternships, launchExtension, seed, startServers, submitEvents, triggerFill, type Ext, type Servers } from './harness';

let servers: Servers;
let ext: Ext;

test.beforeAll(async () => {
  servers = await startServers();
  ext = await launchExtension();
  await seed(ext, e2eFourInternships());
});
test.afterAll(async () => {
  await ext?.close();
  await servers?.close();
});

const wx = (n: number, field: string) => `[id="workExperience-${n}--${field}"]`;
const shown = (page: Page, id: string) => page.locator(`[id="${id}"]`).locator('xpath=ancestor::*[contains(@class,"select__control")]').locator('.select__single-value');

test('ashby: fills system fields, Yes/No buttons and the resume', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/ashby/application.html`);
  await triggerFill(ext, page);

  await expect.poll(() => page.locator('#_systemfield_name').inputValue()).toBe('Ada Lovelace');
  expect(await page.locator('#_systemfield_email').inputValue()).toBe('ada@example.com');
  await expect(page.locator('#yn-auth button', { hasText: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#yn-auth button', { hasText: 'No' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#yn-spons button', { hasText: 'No' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('#_systemfield_resume').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)).toBe('ada-cv.pdf');

  // The open-ended question is left for the user and flagged.
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('What interests you most about this role?');
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('ashby: authorized = Yes and sponsorship = No even when the markup has no recognisable hooks', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/ashby/hashed.html`);
  await triggerFill(ext, page);

  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Filling…', { timeout: 100 }).catch(() => undefined);
  await expect(page.locator('#auth button').first()).toHaveClass(/_k8x2/); // Yes was clicked and the page reacted
  // Sponsorship: No was clicked, but this page shows no visible change, so it is flagged for a look, not failed.
  await expect(panel).toContainText('Will you now or in the future require sponsorship');
  await expect(panel).toContainText('clicked “No” but the page showed no change'); // says why, not just "check this"
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('greenhouse: degree "Bachelor" selects "Bachelor\'s degree", and month dropdowns + year boxes fill', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/sections.html`);
  await triggerFill(ext, page);

  await expect(shown(page, 'degree--0')).toHaveText("Bachelor's degree", { timeout: 15_000 });
  await expect(shown(page, 'school--0')).toHaveText('Example University');
  await expect(shown(page, 'discipline--0')).toHaveText('Computer Science');
  await expect(shown(page, 'start-month--0')).toHaveText('September');
  await expect(page.locator('[id="start-year--0"]')).toHaveValue('2022');
  await expect(shown(page, 'end-month--0')).toHaveText('May');
  await expect(page.locator('[id="end-year--0"]')).toHaveValue('2026');

  // Two employment entries get two different internships, with their own dates.
  await expect(page.locator('[id="company-name-0"]')).toHaveValue('Alpha Labs');
  await expect(page.locator('[id="company-name-1"]')).toHaveValue('Beta Systems');
  await expect(shown(page, 'emp-start-month-1')).toHaveText('May');
  await expect(page.locator('[id="emp-start-year-1"]')).toHaveValue('2024');
  await expect(page.locator('[id="emp-end-year-0"]')).toHaveValue('2025');
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('workday: fills the current step, never advances, then fills the next step on request', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/workday/apply.html`);
  const syntheticNext = () => page.evaluate(() => (window as any).__syntheticNextClicks as number);

  // ---- Step 1: My Information
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('#first').inputValue()).toBe('Ada');
  expect(await page.locator('#last').inputValue()).toBe('Lovelace');
  expect(await page.locator('#city').inputValue()).toBe('Montreal');
  expect(await page.locator('#phone').inputValue()).toBe('555-0100');
  await expect(page.locator('#country')).toHaveText('Canada'); // custom listbox driven with simulated events
  await expect(page.locator('#region')).toHaveText('Quebec'); // profile says QC; the dropdown offers full names
  await expect(page.locator('#pdt')).toHaveText('Mobile'); // phone type
  await expect(page.locator('#cpc')).toHaveText('Select One'); // dialling code left alone
  expect(await page.locator(wx(4, 'jobTitle')).inputValue()).toBe(''); // step 2 is hidden: untouched
  expect(await syntheticNext()).toBe(0);
  await expect(page.locator('#step1')).toBeVisible(); // still on step 1: the extension did not advance

  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Address Line 1'); // required and not in the profile

  // ---- The user clicks Save and Continue themselves (a real, trusted click)
  await page.locator('#next1').click();
  await expect(page.locator('#step2')).toBeVisible();

  // ---- Step 2: My Experience: four sections numbered 4..7, each gets its own internship
  await triggerFill(ext, page);
  const jobs = [['Alpha Labs', 'SWE Intern', '2025'], ['Beta Systems', 'Backend Intern', '2024'], ['Gamma Cloud', 'Platform Intern', '2023'], ['Delta Data', 'Data Intern', '2022']];
  for (const [i, n] of [4, 5, 6, 7].entries()) {
    const [company, title, year] = jobs[i]!;
    await expect(page.locator(wx(n, 'companyName'))).toHaveValue(company!, { timeout: 15_000 });
    await expect(page.locator(wx(n, 'jobTitle'))).toHaveValue(title!);
    await expect(page.locator(wx(n, 'roleDescription'))).toHaveValue(`${company} work in ${year}.`);
    await expect(page.locator(wx(n, 'startDate-dateSectionMonth-input'))).toHaveValue('05');
    await expect(page.locator(wx(n, 'startDate-dateSectionYear-input'))).toHaveValue(year!);
    await expect(page.locator(wx(n, 'endDate-dateSectionMonth-input'))).toHaveValue('08');
    await expect(page.locator(wx(n, 'endDate-dateSectionYear-input'))).toHaveValue(year!);
  }
  await expect(page.locator('[id="education-2--degree"]')).toHaveText("Bachelor's Degree");
  await expect(page.locator('[id="education-2--schoolName"]')).toHaveValue('Example University');
  await expect(page.locator('[id="education-2--lastYearAttended-dateSectionYear-input"]')).toHaveValue('2026');

  // The resume drop zone shows the file.
  await expect(page.locator('#file-name')).toHaveText('ada-cv.pdf');

  // Step 1 values were not touched by the second run, and only the user's own click reached Next.
  expect(await page.locator('#first').inputValue()).toBe('Ada');
  expect(await syntheticNext()).toBe(0);
  await page.close();
});

test('save my answers: finds a question on a wizard step that appeared after the last fill', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/workday/apply.html`);
  await triggerFill(ext, page); // step 1 only
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Log application');

  // The user moves to step 2 (never scanned) and writes an answer to a question that was added there.
  await page.locator('#next1').click();
  await page.evaluate(() => {
    document.getElementById('step2')!.insertAdjacentHTML(
      'beforeend',
      '<div><label for="q-extra">Tell us about a project you are proud of</label><textarea id="q-extra"></textarea></div>',
    );
  });
  await page.locator('#q-extra').fill('I built a small compiler for fun.');

  await panel.locator('button.action', { hasText: 'Save my answers' }).click();
  await expect(panel).toContainText('Saved 1 answer to your answer bank');
  const bank = await ext.worker.evaluate(async () => (await chrome.storage.local.get('profile')).profile.answerBank);
  expect(bank).toContainEqual(expect.objectContaining({ question: 'Tell us about a project you are proud of', answer: 'I built a small compiler for fun.' }));
  await page.close();
});

test('workday: a resume zone that ignores the input change event still gets the file via drop', async () => {
  const page = await ext.context.newPage();
  await page.addInitScript(() => ((window as any).__uploadMode = 'drop-only'));
  await page.goto(`${servers.main.origin}/workday/apply.html`);
  await page.locator('#next1').click();
  await triggerFill(ext, page);

  await expect(page.locator('#file-name')).toHaveText('ada-cv.pdf', { timeout: 15_000 });
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});
