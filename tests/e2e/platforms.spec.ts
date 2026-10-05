import { expect, test } from '@playwright/test';
import { launchExtension, seed, startServers, submitEvents, triggerFill, type Ext, type Servers } from './harness';

let servers: Servers;
let ext: Ext;

test.beforeAll(async () => {
  servers = await startServers();
  ext = await launchExtension();
  await seed(ext);
});
test.afterAll(async () => {
  await ext?.close();
  await servers?.close();
});

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
  await expect(page.locator('#pdt')).toHaveText('Select One'); // phone device type left alone
  await expect(page.locator('#cpc')).toHaveText('Select One');
  expect(await page.locator('#jt1').inputValue()).toBe(''); // step 2 is hidden: untouched
  expect(await syntheticNext()).toBe(0);
  await expect(page.locator('#step1')).toBeVisible(); // still on step 1: the extension did not advance

  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Address Line 1'); // required and not in the profile

  // ---- The user clicks Save and Continue themselves (a real, trusted click)
  await page.locator('#next1').click();
  await expect(page.locator('#step2')).toBeVisible();

  // ---- Step 2: My Experience
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('#jt1').inputValue()).toBe('Engineer');
  expect(await page.locator('#co1').inputValue()).toBe('Analytical Engines');
  expect(await page.locator('#loc1').inputValue()).toBe('Montreal, QC');
  await expect(page.locator('#cur1')).toBeChecked();
  expect(await page.locator('#sm1').inputValue()).toBe('05');
  expect(await page.locator('#sy1').inputValue()).toBe('2025');
  expect(await page.locator('#rd1').inputValue()).toBe('Built the engine.');
  expect(await page.locator('#sch1').inputValue()).toBe('Example University');
  await expect(page.locator('#deg1')).toHaveText('BSc');
  expect(await page.locator('#ly1').inputValue()).toBe('2026');
  await expect.poll(() => page.locator('#resume-input').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)).toBe('ada-cv.pdf');

  // The second work-experience section has no matching profile entry: empty and flagged.
  expect(await page.locator('#jt2').inputValue()).toBe('');
  await expect(panel).toContainText('Job Title');
  // Step 1 values were not touched by the second run.
  expect(await page.locator('#first').inputValue()).toBe('Ada');

  // Only the user's own click ever reached the Next buttons.
  expect(await syntheticNext()).toBe(0);
  await page.close();
});
