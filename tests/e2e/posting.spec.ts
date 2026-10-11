import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launchExtension, openLogPanel, savePosting, seed, startServers, triggerFill, type Ext, type Servers } from './harness';

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

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('saves posting.mhtml, posting.md and answers.json for a filled application', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('#first_name').inputValue()).toBe('Ada');
  await page.locator('#q_why').fill('Because the mission resonates.');

  const result = await savePosting(ext, page);
  expect(result.ok).toBe(true);
  expect(result.folder).toBe(`AutoFill/Acme Corp/${today()} Backend Engineer`);
  expect(result.warnings, 'warnings explain a missing file').toEqual([]);
  expect(result.files.map((f: { name: string }) => f.name).sort()).toEqual(['answers.json', 'posting.md', 'posting.mhtml']);

  // Every download completed with content on disk.
  const byName = Object.fromEntries(result.files.map((f: { name: string; path: string }) => [f.name, f.path]));
  for (const path of Object.values(byName) as string[]) {
    expect(existsSync(path), path).toBe(true);
  }
  const mhtml = readFileSync(byName['posting.mhtml'], 'utf8');
  expect(mhtml).toContain('MIME-Version');
  expect(mhtml).toContain('Backend Engineer');

  const md = readFileSync(byName['posting.md'], 'utf8');
  expect(md).toContain('# Backend Engineer');
  expect(md).toContain('- **Company:** Acme Corp');
  expect(md).toContain('- **Location:** Montreal, QC');
  expect(md).toContain('Design and ship reliable APIs in Go');
  expect(md).not.toContain('First Name'); // the form is not part of the description

  const answers = JSON.parse(readFileSync(byName['answers.json'], 'utf8'));
  const byQuestion = Object.fromEntries(answers.answers.map((a: { question: string }) => [a.question, a]));
  expect(byQuestion['First Name']).toMatchObject({ answer: 'Ada', source: 'autofill' });
  expect(byQuestion['Why do you want to work at Acme?']).toMatchObject({ answer: 'Because the mission resonates.', source: 'manual' });
  expect(byQuestion['Resume/CV']).toMatchObject({ answer: 'ada-cv.pdf' });

  // The harness redirects downloads; nothing may have landed in the real Downloads folder.
  expect(existsSync(join(homedir(), 'Downloads', 'AutoFill', 'Acme Corp', `${today()} Backend Engineer`))).toBe(false);
  await page.close();
});

const readJson = (result: any, name: string) => JSON.parse(readFileSync(result.files.find((f: { name: string }) => f.name === name).path, 'utf8'));
const readText = (result: any, name: string) => readFileSync(result.files.find((f: { name: string }) => f.name === name).path, 'utf8');

test('saving from the application form records the answers, and says the description is missing', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/acme/abc/apply`);
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('input[name="email"]').inputValue()).toBe('ada@example.com');

  const result = await savePosting(ext, page);
  expect(result.ok).toBe(true);
  expect(result.warnings.join(' ')).toContain('This is the application form');
  const answers = readJson(result, 'answers.json').answers as { question: string; answer: string; source: string }[];
  expect(answers.length).toBeGreaterThan(3); // not an empty file
  expect(answers.find((a) => a.question.startsWith('Email'))).toMatchObject({ answer: 'ada@example.com', source: 'autofill' });
  expect(readText(result, 'posting.md')).toContain('No job description could be extracted');
  await page.close();
});

test('answers typed without ever pressing Fill are still recorded', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/basic.html`);
  await page.locator('#a').fill('Typed by hand');
  const result = await savePosting(ext, page);
  expect(result.ok).toBe(true);
  expect(readJson(result, 'answers.json').answers).toContainEqual({ question: 'Given name', answer: 'Typed by hand', source: 'manual' });
  await page.close();
});

test('a form reached from its posting page inherits the description and the location', async () => {
  const page = await ext.context.newPage();
  // Read the posting first (opening the log card is enough), then move on to the form in the same tab.
  await page.goto(`${servers.main.origin}/generic/posting.html`);
  await openLogPanel(ext, page);
  await expect(page.locator('#autofill-review-host .logcard')).toBeVisible();
  await page.goto(`${servers.main.origin}/acme/abc/apply`);
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('input[name="email"]').inputValue()).toBe('ada@example.com');

  const result = await savePosting(ext, page);
  expect(result.ok).toBe(true);
  expect(result.warnings.join(' ')).toContain('read earlier on the posting page');
  const md = readText(result, 'posting.md');
  expect(md).toContain('Globex builds the infrastructure');
  expect(md).toContain('- **Location:** Toronto, ON');
  expect(readJson(result, 'answers.json').answers.length).toBeGreaterThan(3);
  await page.close();
});

test('answers from an earlier step of the same application are kept when a later step is saved', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/generic/basic.html`);
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('#a').inputValue()).toBe('Ada');
  // The "next step": the first fields are gone from the page, a new question appears.
  await page.evaluate(() => {
    document.getElementById('f')!.innerHTML = '<label for="z">Earliest start date</label><input id="z" value="January">';
  });
  const result = await savePosting(ext, page);
  const answers = readJson(result, 'answers.json').answers as { question: string; answer: string }[];
  expect(answers).toContainEqual(expect.objectContaining({ question: 'Given name', answer: 'Ada' })); // from step one
  expect(answers).toContainEqual(expect.objectContaining({ question: 'Earliest start date', answer: 'January' }));
  await page.close();
});

test('the panel button saves the posting and lists the files', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  await triggerFill(ext, page);
  const panel = page.locator('#autofill-review-host .panel');
  await panel.locator('button.action', { hasText: 'Save posting' }).click();
  await expect(panel).toContainText('posting.md', { timeout: 20_000 });
  await expect(panel).toContainText('posting.mhtml');
  await expect(panel).toContainText('answers.json');
  await page.close();
});
