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

const val = (page: import('@playwright/test').Page | import('@playwright/test').Frame, sel: string) => page.locator(sel).inputValue();

test('generic page: fills by label, panel appears, nothing is submitted', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/basic.html`);
  await triggerFill(ext, page);

  await expect.poll(() => val(page, '#a')).toBe('Ada');
  expect(await val(page, '#b')).toBe('Lovelace');
  expect(await val(page, '#c')).toBe('ada@example.com');
  expect(await val(page, '#d')).toBe('Montreal, QC, Canada');
  expect(await val(page, '#e')).toBe(''); // free text is never invented without an answer or API key

  await expect(page.locator('#autofill-review-host .panel')).toBeVisible();
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('nothing runs until triggered', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/basic.html`);
  await page.waitForTimeout(800);
  expect(await val(page, '#a')).toBe('');
  expect(await page.locator('#autofill-review-host').count()).toBe(0);
  await page.close();
});

test('greenhouse: fills form, attaches resume, highlights, scrolls, saves manual answers', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await triggerFill(ext, page);

  await expect.poll(() => val(page, '#first_name')).toBe('Ada');
  expect(await val(page, '#email')).toBe('ada@example.com');
  expect(await page.locator('#q_auth').evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.text)).toBe('Yes');
  expect(await page.locator('#gender').evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.text)).toBe('Decline To Self Identify');
  await expect.poll(() => page.locator('#resume').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)).toBe('ada-cv.pdf');

  // Highlights: green for filled, red for required-and-empty.
  expect(await page.locator('#first_name').getAttribute('data-autofill-level')).toBe('green');
  expect(await page.locator('#q_why').getAttribute('data-autofill-level')).toBe('red');

  // Panel lists the required-empty question; clicking it scrolls to and focuses the field.
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Why do you want to work at Acme?');
  await panel.locator('button.row', { hasText: 'Why do you want' }).click();
  await expect(page.locator('#q_why')).toBeFocused();

  // Answer manually, then save to the answer bank.
  await page.locator('#q_why').fill('Because the mission resonates.');
  await panel.locator('button.action').click();
  await expect(panel).toContainText('Saved 1 answer');
  const bank = await ext.worker.evaluate(async () => (await chrome.storage.local.get('profile')).profile.answerBank);
  expect(bank).toHaveLength(1);
  expect(bank[0]).toMatchObject({ question: 'Why do you want to work at Acme?', answer: 'Because the mission resonates.' });

  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('greenhouse form embedded in a cross-origin iframe', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/embed-parent.html`);
  const frame = page.frameLocator('#grnhse_iframe');
  await frame.locator('#first_name').waitFor();
  await triggerFill(ext, page);

  await expect.poll(() => frame.locator('#first_name').inputValue()).toBe('Ada');
  expect(await frame.locator('#email').inputValue()).toBe('ada@example.com');
  await expect.poll(() => frame.locator('#resume').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)).toBe('ada-cv.pdf');

  // The panel lives in the top frame and lists fields from the iframe.
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Why do you want to work at Acme?');
  await panel.locator('button.row', { hasText: 'Why do you want' }).click();
  await expect(frame.locator('#q_why')).toBeFocused();
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('lever: radios, EEO decline, location suggestion chosen, resume attached', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/lever/apply.html`);
  await triggerFill(ext, page);

  await expect.poll(() => val(page, 'input[name=name]')).toBe('Ada Lovelace');
  await expect(page.locator('input[name="cards[u1][field0]"][value=Yes]')).toBeChecked();
  await expect(page.locator('input[name="cards[u2][field0]"][value=No]')).toBeChecked();
  await expect.poll(() => val(page, '#selected-location')).toBe('Montréal, Quebec, Canada');
  expect(await page.locator('select[name="eeo[gender]"]').inputValue()).toBe('Decline to self-identify');
  await expect.poll(() => page.locator('#resume-upload-input').evaluate((i: HTMLInputElement) => i.files?.[0]?.name)).toBe('ada-cv.pdf');
  expect(await val(page, 'textarea[name="cards[u3][field0]"]')).toBe('');

  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('re-running leaves filled fields alone, and CAPTCHA widgets are untouched', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await page.locator('#first_name').fill('Custom');
  await triggerFill(ext, page);
  await expect.poll(() => val(page, '#last_name')).toBe('Lovelace');
  expect(await val(page, '#first_name')).toBe('Custom');
  expect(await val(page, '#g-recaptcha-response')).toBe('');
  await page.close();
});
