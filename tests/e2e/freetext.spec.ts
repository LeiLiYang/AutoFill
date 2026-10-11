import { expect, test } from '@playwright/test';
import { claudeCalls, clearDrafts, installClaudeStub, launchExtension, patchSettings, seed, promptText, setAnswerBank, startServers, triggerFill, type Ext, type Servers } from './harness';

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
test.beforeEach(async () => {
  await patchSettings(ext, { anthropicApiKey: '', model: 'claude-opus-5-5' });
  await setAnswerBank(ext, []);
  await clearDrafts(ext);
  await installClaudeStub(ext, { text: 'I am drawn to Acme because it builds reliable payment systems.' });
});

const open = async () => {
  const page = await ext.context.newPage();
  await page.goto(`${servers.main.origin}/greenhouse/classic.html`);
  return page;
};

test('without an API key or a matching saved answer the field stays empty and is flagged', async () => {
  const page = await open();
  await triggerFill(ext, page);
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('Why do you want to work at Acme?');
  await expect(panel).toContainText('No Anthropic API key is set');
  expect(await page.locator('#q_why').inputValue()).toBe('');
  expect(await page.locator('#q_why').getAttribute('data-autofill-level')).toBe('red');
  expect(await claudeCalls(ext)).toHaveLength(0); // nothing was sent anywhere
  await page.close();
});

test('a close saved answer is used first and no API call is made, even with a key', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test' });
  await setAnswerBank(ext, [
    { id: '1', question: 'Why do you want to work at Acme?', answer: 'Because I love payments.', tags: [], updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  const page = await open();
  await triggerFill(ext, page);
  await expect.poll(() => page.locator('#q_why').inputValue()).toBe('Because I love payments.');
  expect(await page.locator('#q_why').getAttribute('data-autofill-level')).toBe('green'); // exact match
  expect(await claudeCalls(ext)).toHaveLength(0);
  await page.close();
});

test('with a key, drafts an answer from the posting and profile, and flags it yellow', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test', model: 'claude-sonnet-5-5' });
  await setAnswerBank(ext, [
    { id: '1', question: 'Why are you interested in this role?', answer: 'I like building things that last.', tags: [], updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  const page = await open();
  await triggerFill(ext, page);

  await expect.poll(() => page.locator('#q_why').inputValue()).toBe('I am drawn to Acme because it builds reliable payment systems.');
  expect(await page.locator('#q_why').getAttribute('data-autofill-level')).toBe('yellow');
  await expect(page.locator('#autofill-review-host .panel')).toContainText('AI draft');

  const calls = await claudeCalls(ext);
  const why = calls.find((c) => promptText(c.params).includes('Why do you want to work at Acme?'))!;
  expect(why.apiKey).toBe('sk-test');
  expect(why.params.model).toBe('claude-sonnet-5-5'); // model name is configurable
  const prompt = promptText(why.params);
  expect(prompt).toContain('payment infrastructure'); // the job posting scraped from the page
  expect(prompt).toContain('Analytical Engines'); // experience from the profile
  expect(prompt).toContain('I like building things that last.'); // saved answer as a style example
  expect(prompt).toMatch(/never invent/i);
  for (const secret of ['ada@example.com', '555-0100']) expect(prompt).not.toContain(secret); // contact details stay local
  await page.close();
});

test('an answer the model cannot give honestly is left empty, not invented', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test' });
  await installClaudeStub(ext, { text: 'INSUFFICIENT_INFO' });
  const page = await open();
  await triggerFill(ext, page);
  const panel = page.locator('#autofill-review-host .panel');
  await expect(panel).toContainText('without inventing details');
  expect(await page.locator('#q_why').inputValue()).toBe('');
  expect(await page.locator('#q_why').getAttribute('data-autofill-level')).toBe('red');
  await page.close();
});

test('a model refusal is reported and the field is left for the user', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test' });
  await installClaudeStub(ext, { stop_reason: 'refusal' });
  const page = await open();
  await triggerFill(ext, page);
  await expect(page.locator('#autofill-review-host .panel')).toContainText('declined to answer');
  expect(await page.locator('#q_why').inputValue()).toBe('');
  await page.close();
});

test('an already-answered question costs no API call, and an untouched AI draft is not saved as the user\'s answer', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test' });
  const page = await open();
  await page.locator('#q_why').fill('Typed by me before filling.');
  await triggerFill(ext, page);
  await expect(page.locator('#autofill-review-host .panel')).not.toContainText('Filling…');
  expect((await claudeCalls(ext)).some((c) => promptText(c.params).includes('Why do you want to work at Acme?'))).toBe(false);
  expect(await page.locator('#q_why').inputValue()).toBe('Typed by me before filling.');
  await page.close(); // the helper finds the tab by URL, so only one tab may show this page

  // Another run on a fresh page: the draft is untouched, so "Save my answers" saves nothing for it.
  const fresh = await open();
  await triggerFill(ext, fresh);
  await expect.poll(() => fresh.locator('#q_why').inputValue()).toContain('Acme');
  const panel = fresh.locator('#autofill-review-host .panel');
  await panel.locator('button.action', { hasText: 'Save my answers' }).click();
  await expect(panel).toContainText('No hand-written answers found'); // and it says what it looked at
  await expect(panel).toContainText('looked at');

  // Rewriting the draft makes it the user's own answer.
  await fresh.locator('#q_why').fill('My own rewrite of the answer.');
  await panel.locator('button.action', { hasText: 'Save my answers' }).click();
  await expect(panel).toContainText('Saved 1 answer');
  await fresh.close();
});

test('filling the same application again reuses the draft instead of paying for a new one', async () => {
  await patchSettings(ext, { anthropicApiKey: 'sk-test' });
  const asked = async () => (await claudeCalls(ext)).filter((c) => promptText(c.params).includes('Why do you want to work at Acme?')).length;

  const first = await open();
  await triggerFill(ext, first);
  await expect.poll(() => first.locator('#q_why').inputValue()).toContain('Acme');
  expect(await asked()).toBe(1);
  // The instructions and the posting + profile are marked cacheable; the question is not.
  const params = (await claudeCalls(ext)).find((c) => promptText(c.params).includes('Why do you want to work at Acme?'))!.params;
  expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(params.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  expect(params.messages[0].content[1].cache_control).toBeUndefined();
  await first.close();

  const again = await open();
  await triggerFill(ext, again);
  await expect.poll(() => again.locator('#q_why').inputValue()).toContain('Acme');
  expect(await asked()).toBe(1); // no second call
  await again.close();
});
