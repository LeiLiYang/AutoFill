import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launchExtension, savePosting, seed, startServers, triggerFill, type Ext, type Servers } from './harness';

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

test('refuses to save from an application-form-only page and says where to go', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/acme/abc/apply`);
  const result = await savePosting(ext, page);
  expect(result.ok).toBe(false);
  expect(result.code).toBe('form-only');
  expect(result.message).toContain('Open the job posting page');
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
