import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { answerQuestion } from '../../../src/llm/answerQuestion';
import { generateAnswer } from '../../../src/llm/client';
import { llmConfig, notReadyReason } from '../../../src/llm/config';
import { makeClient } from '../../../src/llm/providers';
import { geminiClient } from '../../../src/llm/providers/gemini';
import { openAiClient } from '../../../src/llm/providers/openai';
import type { Fetch } from '../../../src/llm/providers/types';
import { exportBackup, importBackup } from '../../../src/profile/importExport';
import { memoryStore } from '../../../src/profile/storage';
import { defaultSettings, SettingsSchema, type Settings } from '../../../src/profile/schema';
import { loadSettings, saveSettings } from '../../../src/profile/store';
import { testProfile } from '../fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fakeFetch = (reply: () => Response) => vi.fn<Fetch>(async () => reply());
const sent = (f: ReturnType<typeof fakeFetch>, n = 0) => ({ url: f.mock.calls[n]![0], init: f.mock.calls[n]![1]!, body: JSON.parse(String(f.mock.calls[n]![1]!.body ?? 'null')) });
const req = { model: 'm-1', system: 'SYSTEM', stable: 'SHARED ', user: 'QUESTION', maxTokens: 100 };

const withProvider = (provider: Settings['provider'], patch: Partial<Settings['providers']['openai']> = {}): Settings => {
  const s = defaultSettings();
  return provider === 'anthropic' ? s : { ...s, provider, providers: { ...s.providers, [provider]: { ...s.providers[provider], ...patch } } };
};

describe('settings: choosing a provider', () => {
  it('defaults to Anthropic and keeps reading settings saved before providers existed', () => {
    const old = SettingsSchema.parse({ sheetId: 'x', tabName: 'Sheet1', anthropicApiKey: 'sk-old', model: 'claude-sonnet-5-5', overwrite: false });
    expect(llmConfig(old)).toMatchObject({ provider: 'anthropic', apiKey: 'sk-old', model: 'claude-sonnet-5-5', mappingModel: 'claude-haiku-5-5', ready: true });
  });

  it('is not ready until the chosen provider has what it needs', () => {
    expect(llmConfig(defaultSettings()).ready).toBe(false);
    expect(notReadyReason(llmConfig(defaultSettings()))).toBe('No Anthropic API key is set.');
    expect(notReadyReason(llmConfig(withProvider('openai', { apiKey: 'k' })))).toBe('No model name is set for OpenAI.');
    expect(llmConfig(withProvider('openai', { apiKey: 'k', model: 'm' }))).toMatchObject({ ready: true, model: 'm', mappingModel: 'm' });
    expect(llmConfig(withProvider('gemini', { apiKey: 'k', model: 'm', mappingModel: 'small' })).mappingModel).toBe('small');
    // A local server needs a URL and a model, not a key.
    expect(notReadyReason(llmConfig(withProvider('custom', { model: 'llama' })))).toMatch(/No server URL/);
    expect(llmConfig(withProvider('custom', { model: 'llama', baseUrl: 'http://localhost:11434/v1' })).ready).toBe(true);
  });

  it('never exports any provider key, and an import keeps the keys already on the device', async () => {
    const kv = memoryStore();
    const s = withProvider('openai', { apiKey: 'sk-openai', model: 'm' });
    await saveSettings({ ...s, anthropicApiKey: 'sk-ant' }, kv);
    const backup = await exportBackup(kv);
    expect(JSON.stringify(backup)).not.toContain('sk-openai');
    expect(JSON.stringify(backup)).not.toContain('sk-ant');
    expect(backup.settings.providers.openai.model).toBe('m');

    await importBackup(JSON.parse(JSON.stringify(backup)), kv);
    const after = await loadSettings(kv);
    expect(after.providers.openai.apiKey).toBe('sk-openai');
    expect(after.anthropicApiKey).toBe('sk-ant');
    expect(after.provider).toBe('openai');
  });
});

describe('OpenAI and OpenAI-compatible servers', () => {
  it('sends the instructions as the system message and the shared context before the question', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { content: ' Hello. ' } }] }));
    expect(await openAiClient({ apiKey: 'sk-1', fetch: f }).complete(req)).toEqual({ text: 'Hello.', refused: false });
    const { url, init, body } = sent(f);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-1');
    expect(body).toEqual({ model: 'm-1', messages: [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'SHARED QUESTION' }] });
  });

  it('uses a custom base URL and sends no auth header to a keyless local server', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { content: 'ok' } }] }));
    await openAiClient({ apiKey: '', baseUrl: 'http://localhost:11434/v1/', fetch: f }).complete(req);
    expect(sent(f).url).toBe('http://localhost:11434/v1/chat/completions');
    expect((sent(f).init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('lists models and reports a refusal', async () => {
    const list = fakeFetch(() => json({ data: [{ id: 'b' }, { id: 'a' }] }));
    expect(await openAiClient({ apiKey: 'k', fetch: list }).listModels()).toEqual(['a', 'b']);
    const refuse = fakeFetch(() => json({ choices: [{ message: { content: null, refusal: 'no' } }] }));
    expect(await openAiClient({ apiKey: 'k', fetch: refuse }).complete(req)).toEqual({ text: '', refused: true });
  });
});

describe('Gemini', () => {
  it('puts the key in a header, never in the URL', async () => {
    const f = fakeFetch(() => json({ candidates: [{ content: { parts: [{ text: 'Hi' }, { text: ' there' }] } }] }));
    expect(await geminiClient({ apiKey: 'g-key', fetch: f }).complete({ ...req, model: 'models/gem-1' })).toEqual({ text: 'Hi there', refused: false });
    const { url, init, body } = sent(f);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gem-1:generateContent');
    expect(url).not.toContain('g-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(body.systemInstruction.parts[0].text).toBe('SYSTEM');
    expect(body.contents[0].parts[0].text).toBe('SHARED QUESTION');
  });

  it('lists only models that can generate text, and reports a blocked prompt', async () => {
    const list = fakeFetch(() => json({ models: [{ name: 'models/gem-1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] }));
    expect(await geminiClient({ apiKey: 'k', fetch: list }).listModels()).toEqual(['gem-1']);
    const blocked = fakeFetch(() => json({ promptFeedback: { blockReason: 'SAFETY' } }));
    expect(await geminiClient({ apiKey: 'k', fetch: blocked }).complete(req)).toEqual({ text: '', refused: true });
  });
});

describe('errors read the same whichever provider is used', () => {
  const failing = (status: number, body: unknown = { error: { message: 'boom' } }) => openAiClient({ apiKey: 'k', fetch: fakeFetch(() => json(body, status)) });
  const answer = (client: ReturnType<typeof openAiClient>) => generateAnswer(client, { model: 'm-1', system: 's', user: 'u', label: 'OpenAI' });

  it.each([
    [401, 'auth', 'OpenAI rejected the API key. Check it in the extension settings.'],
    [429, 'rate-limit', 'Rate limited by OpenAI. Wait a moment and fill again.'],
    [404, 'error', 'Model not found: m-1. Check the model name in settings.'],
    [400, 'error', 'OpenAI rejected the request: boom'],
    [500, 'error', 'OpenAI API error 500: boom'],
  ])('HTTP %i → %s', async (status, kind, message) => {
    expect(await answer(failing(status))).toEqual({ ok: false, kind, message });
  });

  it('reports an unreachable server and a refusal', async () => {
    const down = openAiClient({ apiKey: 'k', fetch: vi.fn<Fetch>(async () => Promise.reject(new TypeError('Failed to fetch'))) });
    expect(await answer(down)).toEqual({ ok: false, kind: 'network', message: 'Could not reach OpenAI. Check your connection.' });
    const refuse = openAiClient({ apiKey: 'k', fetch: fakeFetch(() => json({ choices: [{ message: { refusal: 'no' } }] })) });
    expect(await answer(refuse)).toMatchObject({ ok: false, kind: 'refusal' });
  });

  it('copes with an error page that is not JSON', async () => {
    const html = openAiClient({ apiKey: 'k', fetch: fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 })) });
    expect(await answer(html)).toMatchObject({ ok: false, kind: 'error', message: expect.stringContaining('502') });
  });
});

describe('answerQuestion with another provider', () => {
  it('sends the prompt to the chosen provider with its model, and nothing to Anthropic', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { content: 'Draft — done.' } }] }));
    const claude = vi.fn();
    const settings = withProvider('custom', { model: 'llama3', baseUrl: 'http://localhost:11434/v1' });
    const r = await answerQuestion(
      {
        loadProfile: async () => testProfile(),
        loadSettings: async () => ({ ...settings, voiceNotes: 'Short sentences.' }),
        getPosting: async () => ({ company: 'Acme', title: 'SWE', descriptionMd: 'We build payment systems.' }),
        llm: (config) => makeClient(config, { claude, fetch: f }),
      },
      { question: 'Why Acme?' },
    );
    expect(r).toEqual({ ok: true, text: 'Draft, done.' });
    expect(claude).not.toHaveBeenCalled();
    const { url, body } = sent(f);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(body.model).toBe('llama3');
    expect(body.messages[1].content).toContain('We build payment systems.');
    expect(body.messages[1].content).toContain('Short sentences.');
    expect(body.messages[1].content).toContain('<question>\nWhy Acme?\n</question>');
  });

  it('sends nothing when the provider is not set up', async () => {
    const f = fakeFetch(() => json({}));
    const r = await answerQuestion(
      { loadProfile: async () => testProfile(), loadSettings: async () => withProvider('gemini'), getPosting: async () => null, llm: (c) => makeClient(c, { claude: vi.fn(), fetch: f }) },
      { question: 'Why?' },
    );
    expect(r).toMatchObject({ ok: false, kind: 'no-key' });
    expect(f).not.toHaveBeenCalled();
  });
});
