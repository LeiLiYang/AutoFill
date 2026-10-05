import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fakeSheet, installSheetsStub, launchExtension, openLogPanel, resetSheet, seed, setOnline, startServers, submitEvents, triggerFill, type Ext, type Servers } from './harness';

let servers: Servers;
let ext: Ext;

test.beforeAll(async () => {
  servers = await startServers();
  ext = await launchExtension();
  await seed(ext);
  await installSheetsStub(ext);
});
test.afterAll(async () => {
  await ext?.close();
  await servers?.close();
});
test.beforeEach(() => resetSheet(ext));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

async function openGreenhouse(): Promise<{ page: Page; card: ReturnType<Page['locator']> }> {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await triggerFill(ext, page);
  const card = page.locator('#autofill-review-host .logcard');
  await expect(card).toBeVisible();
  return { page, card };
}

test('the extension ID is pinned by the manifest key', async () => {
  expect(ext.id).toBe('cihdjaikbfmejnlkcmncpggnjledlpoc');
});

test('log card is pre-filled from the page and nothing is written until confirmed', async () => {
  const { page, card } = await openGreenhouse();
  await expect(card.getByLabel('Company')).toHaveValue('Acme Corp');
  await expect(card.getByLabel('Category')).toHaveValue('SWE');
  await expect(card.getByLabel('Location')).toHaveValue('montreal');
  await expect(card.getByLabel('Date')).toHaveValue(today());
  await expect(card.getByLabel('Channel')).toHaveValue('website');
  await expect(card.getByLabel('Job URL')).toHaveValue(`${servers.main.origin}/greenhouse/classic.html`);

  expect((await fakeSheet(ext)).calls).toHaveLength(0); // nothing automatic
  expect((await fakeSheet(ext)).rows).toHaveLength(0);
  await page.close();
});

test('confirming writes exactly one correctly ordered row and keeps a local copy', async () => {
  const { page, card } = await openGreenhouse();
  await card.getByLabel('Company').fill('Acme Corp');
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Logged to your sheet');

  const sheet = await fakeSheet(ext);
  expect(sheet.rows).toEqual([['Acme Corp', 'SWE', '', 'montreal', today(), 'website', '', `${servers.main.origin}/greenhouse/classic.html`]]);
  const append = sheet.calls.find((c) => c.method === 'POST')!;
  expect(decodeURIComponent(append.url)).toContain("'Sheet1'!A:H:append");
  expect(append.url).toContain('valueInputOption=USER_ENTERED');

  const local = await ext.worker.evaluate(async () => (await chrome.storage.local.get('loggedRows')).loggedRows);
  expect(local).toHaveLength(1);
  expect(local[0]).toMatchObject({ status: 'synced', entry: { company: 'Acme Corp', location: 'montreal' } });
  await page.close();
});

test('"also save posting" is offered in the card and saves the three files on confirm', async () => {
  const { page, card } = await openGreenhouse();
  const box = card.getByLabel('Also save the posting', { exact: false });
  await expect(box).toBeChecked();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Posting saved to Downloads/AutoFill/Acme Corp/', { timeout: 20_000 });
  await page.close();
});

test('edits in the card are what gets written, and formula-like text is escaped', async () => {
  const { page, card } = await openGreenhouse();
  await card.getByLabel('Company').fill('=HYPERLINK("x")');
  await card.getByLabel('Category').selectOption('PM');
  await card.getByLabel('Location').selectOption('USA');
  await card.getByLabel('Channel').selectOption('linkedin');
  await card.getByLabel('Date').fill('2026/01/05');
  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Logged to your sheet');
  const [row] = (await fakeSheet(ext)).rows;
  expect(row!.slice(0, 7)).toEqual(["'=HYPERLINK(\"x\")", 'PM', '', 'USA', '2026/01/05', 'linkedin', '']);
  await page.close();
});

test('warns about a duplicate URL and only writes again after "Log anyway"', async () => {
  let { page, card } = await openGreenhouse();
  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Logged to your sheet');
  await page.close();

  ({ page, card } = await openGreenhouse());
  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('already in the sheet (row 1)');
  expect((await fakeSheet(ext)).rows).toHaveLength(1);

  await card.getByRole('button', { name: 'Log anyway' }).click();
  await expect(card).toContainText('Logged to your sheet');
  expect((await fakeSheet(ext)).rows).toHaveLength(2);
  await page.close();
});

test('offline: the row is queued locally, shown as pending, and retried exactly once', async () => {
  const { page, card } = await openGreenhouse();
  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await setOnline(ext, false);
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Saved locally and queued');
  expect((await fakeSheet(ext)).rows).toHaveLength(0);

  let local = await ext.worker.evaluate(async () => (await chrome.storage.local.get('loggedRows')).loggedRows);
  expect(local).toHaveLength(1);
  expect(local[0]).toMatchObject({ status: 'pending', errorKind: 'transient' });

  // The popup lists pending rows.
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.id}/popup.html`);
  await expect(popup.getByRole('status')).toContainText('1 row not in your sheet yet');
  await expect(popup.getByRole('status')).toContainText('Acme Corp');

  // Back online: the retry writes it once; a second pass does nothing.
  await setOnline(ext, true);
  await popup.getByRole('button', { name: 'Retry now' }).click();
  await expect.poll(async () => (await fakeSheet(ext)).rows.length).toBe(1);
  await ext.worker.evaluate(() => (globalThis as any).__autofill.retryQueue(false));
  expect((await fakeSheet(ext)).rows).toHaveLength(1);
  local = await ext.worker.evaluate(async () => (await chrome.storage.local.get('loggedRows')).loggedRows);
  expect(local[0].status).toBe('synced');
  await expect(popup.getByText('not in your sheet yet')).toHaveCount(0);

  // The options page shows the local log.
  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.id}/options.html`);
  await options.getByRole('button', { name: 'Applications' }).click();
  await expect(options.locator('table.apps')).toContainText('Acme Corp');
  await expect(options.locator('table.apps')).toContainText('In sheet');
  await Promise.all([popup.close(), options.close(), page.close()]);
});

test('settings: pasting a sheet URL keeps the ID, and the connection test reports the result', async () => {
  const options = await ext.context.newPage();
  await options.goto(`chrome-extension://${ext.id}/options.html`);
  await options.getByRole('button', { name: 'Settings' }).click();
  await options.getByLabel('Google Sheet ID').fill('https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0');
  await expect(options.getByLabel('Google Sheet ID')).toHaveValue('1AbC-dEf_123');
  await options.getByRole('button', { name: 'Save' }).click();

  await options.getByRole('button', { name: 'Test Google Sheets connection' }).click();
  await expect(options.getByRole('status').last()).toContainText('Connected. 0 job URLs found in column H.');

  await setOnline(ext, false);
  await options.getByRole('button', { name: 'Test Google Sheets connection' }).click();
  await expect(options.getByRole('status').last()).toContainText('Network error');
  await setOnline(ext, true);
  await ext.worker.evaluate(async () => {
    const cur = (await chrome.storage.local.get('settings')).settings;
    await chrome.storage.local.set({ settings: { ...cur, sheetId: 'test-sheet' } });
  });
  await options.close();
});

test('an unresolved location blocks logging until the user picks one', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/basic.html`); // no location on the page
  await triggerFill(ext, page);
  const card = page.locator('#autofill-review-host .logcard');
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Location')).toHaveValue('');
  await expect(card).toContainText('Pick one to log');
  const log = card.getByRole('button', { name: 'Log application' });
  await expect(log).toBeDisabled();
  await card.getByLabel('Location').selectOption('canada');
  await expect(log).toBeEnabled();
  await page.close();
});

test('log a posting you have not applied to: card opens with nothing filled, and the row has an empty Status', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/posting.html`); // a plain posting: no application form
  await page.locator('#newsletter-email').fill(''); // a field that autofill WOULD have filled with the profile email
  await openLogPanel(ext, page);

  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText("you don't need to have applied");
  const card = panel.locator('.logcard');
  await expect(card.getByLabel('Company')).toHaveValue('Globex');
  await expect(card.getByLabel('Category')).toHaveValue('SWE');
  await expect(card.getByLabel('Location')).toHaveValue('toronto');
  await expect(card.getByLabel('Channel')).toHaveValue('website');
  expect(await page.locator('#newsletter-email').inputValue()).toBe(''); // nothing was filled
  expect((await fakeSheet(ext)).calls).toHaveLength(0); // and nothing logged until confirmed

  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Logged to your sheet');
  const [row] = (await fakeSheet(ext)).rows;
  expect(row).toEqual(['Globex', 'SWE', '', 'toronto', today(), 'website', '', `${servers.main.origin}/generic/posting.html`]);
  expect(row![2]).toBe(''); // Status stays empty: logging does not mean you applied
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});

test('log-only on an application form fills nothing and highlights nothing', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await openLogPanel(ext, page);
  await expect(page.locator('#autofill-review-host .logcard')).toBeVisible();
  expect(await page.locator('#first_name').inputValue()).toBe('');
  expect(await page.locator('#first_name').getAttribute('data-autofill-level')).toBeNull();
  await page.close();
});

test('the popup offers the log-only action', async () => {
  const popup = await ext.context.newPage();
  await popup.goto(`chrome-extension://${ext.id}/popup.html`);
  await expect(popup.getByRole('button', { name: 'Log posting only (no autofill)' })).toBeVisible();
  await popup.close();
});

test('LinkedIn: logs and saves the posting but never fills', async () => {
  const page = await ext.context.newPage();
  const url = 'https://www.linkedin.com/jobs/view/3912345678/?trk=public_jobs&refId=abc';
  await page.route('https://www.linkedin.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: readFileSync('tests/fixtures/linkedin/job.html', 'utf8') }),
  );
  await page.goto(url);
  await triggerFill(ext, page);

  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Autofill is off on LinkedIn');
  expect(await page.locator('#email').inputValue()).toBe(''); // not filled
  expect(await page.locator('#email').getAttribute('data-autofill-level')).toBeNull();

  const card = panel.locator('.logcard');
  await expect(card.getByLabel('Company')).toHaveValue('Acme Corp');
  await expect(card.getByLabel('Channel')).toHaveValue('linkedin'); // Easy Apply
  await expect(card.getByLabel('Location')).toHaveValue('toronto');
  await expect(card.getByLabel('Job URL')).toHaveValue('https://www.linkedin.com/jobs/view/3912345678');

  await card.getByLabel('Also save the posting', { exact: false }).uncheck();
  await card.getByRole('button', { name: 'Log application' }).click();
  await expect(card).toContainText('Logged to your sheet');
  expect((await fakeSheet(ext)).rows[0]!.slice(5)).toEqual(['linkedin', '', 'https://www.linkedin.com/jobs/view/3912345678']);
  expect(await submitEvents(page)).toEqual({ submit: 0, submitClick: 0 });
  await page.close();
});
