import { expect, test, type Page } from '@playwright/test';
import { launchExtension, seed, type Ext } from './harness';

let ext: Ext;

test.beforeAll(async () => {
  ext = await launchExtension();
  await seed(ext);
});
test.afterAll(() => ext?.close());

const bank = () => ext.worker.evaluate(async () => (await chrome.storage.local.get('profile')).profile.answerBank as { question: string; answer: string }[]);
const resetBank = () =>
  ext.worker.evaluate(async () => {
    const { profile } = await chrome.storage.local.get('profile');
    await chrome.storage.local.set({ profile: { ...profile, answerBank: [] } });
  });

async function openAnswerBank(): Promise<Page> {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.id}/options.html`);
  await page.getByRole('button', { name: 'Answer bank' }).click();
  return page;
}

const PASTE = [
  'I built a small compiler in my second year and found that I love systems programming and debugging hard problems.',
  'As captain of the robotics club I mentored younger students and learned how to explain technical ideas simply.',
].join('\n\n');

test.beforeEach(resetBank);

test('pasting answers and pressing the bottom Save stores them (no extra Add click needed)', async () => {
  const page = await openAnswerBank();
  await page.getByLabel(/Paste several answers/).fill(PASTE);

  await expect(page.locator('.savebar')).toContainText('Unsaved changes'); // the page knows there is something to save
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.savebar')).toContainText('Added 2 writing samples');

  const saved = await bank();
  expect(saved).toHaveLength(2);
  expect(saved.every((a) => a.question === '')).toBe(true);
  expect(saved[0]!.answer).toContain('small compiler');
  expect(saved[1]!.answer).toContain('robotics club');

  // The paste box is emptied and the entries are listed, and they survive a reload.
  await expect(page.getByLabel(/Paste several answers/)).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name: 'Answer bank' }).click();
  await expect(page.locator('.entry textarea').nth(1)).toHaveValue(/small compiler/);
  await expect(page.locator('.entry strong', { hasText: 'writing sample (no question)' })).toHaveCount(2);
  await page.close();
});

test('the optional Add button moves pasted answers into the list, and Save then stores them', async () => {
  const page = await openAnswerBank();
  await page.getByLabel(/Paste several answers/).fill(PASTE);
  await page.getByRole('button', { name: /Add 2 as writing samples/ }).click();
  await expect(page.getByLabel(/Paste several answers/)).toHaveValue('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.savebar')).toContainText('Saved locally');
  expect(await bank()).toHaveLength(2);
  await page.close();
});

test('typing a question and an answer into an entry and pressing Save stores it', async () => {
  const page = await openAnswerBank();
  await page.getByRole('button', { name: /Add answer or writing sample/ }).click();
  await page.getByPlaceholder('Leave empty for a general writing sample').last().fill('Why do you want to work here?');
  await page.locator('.entry textarea').last().fill('Because I like building reliable systems and the mission resonates.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.savebar')).toContainText('Saved locally');
  expect(await bank()).toEqual([expect.objectContaining({ question: 'Why do you want to work here?', answer: expect.stringContaining('reliable systems') })]);
  await page.close();
});

test('Save never does nothing: it says when there is nothing to save, or why pasted text was not usable', async () => {
  const page = await openAnswerBank();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();

  await save.click();
  await expect(page.locator('.savebar')).toContainText('Nothing to save');

  await page.getByLabel(/Paste several answers/).fill('too short');
  await expect(page.locator('.entry')).toContainText('at least 20 characters');
  await save.click();
  await expect(page.locator('.savebar')).toContainText('at least 20 characters');
  expect(await bank()).toHaveLength(0);
  await page.close();
});

test('an Add click that was never filled in is not saved as an empty entry', async () => {
  const page = await openAnswerBank();
  await page.getByRole('button', { name: /Add answer or writing sample/ }).click();
  await page.getByLabel(/Paste several answers/).fill(PASTE);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.savebar')).toContainText('Added 2 writing samples');
  expect(await bank()).toHaveLength(2); // the blank entry was dropped
  await page.close();
});
