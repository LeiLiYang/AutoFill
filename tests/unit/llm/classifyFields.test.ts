import { beforeEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../../../src/adapters/generic';
import { runFill } from '../../../src/fill/engine';
import { buildClassifyPrompt, classifyFields, parseClassification, type FieldToClassify } from '../../../src/llm/classifyFields';
import { llmConfig } from '../../../src/llm/config';
import type { LlmClient, LlmRequest } from '../../../src/llm/providers/types';
import { memoryStore } from '../../../src/profile/storage';
import { defaultProfile, defaultSettings, type Profile } from '../../../src/profile/schema';
import { mount } from '../helpers';

const fields: FieldToClassify[] = [
  { id: 'f0', label: 'Where do you hang your hat?', kind: 'text' },
  { id: 'f1', label: 'Are you allowed to work here?', kind: 'radio', options: ['Yes', 'No'] },
  { id: 'f2', label: 'Upload your story', kind: 'file' },
  { id: 'f3', label: 'What draws you to us?', kind: 'text' },
];
const config = llmConfig({ ...defaultSettings(), anthropicApiKey: 'k' });

const fakeLlm = (reply: string | Error) => {
  const complete = vi.fn(async (_req: LlmRequest) => {
    if (reply instanceof Error) throw reply;
    return { text: reply };
  });
  const client: LlmClient = { complete, listModels: async () => [] };
  return { complete, llm: () => client };
};

describe('classification prompt', () => {
  it('sends only what the form shows: labels, kinds and options', () => {
    const { system, user } = buildClassifyPrompt(fields);
    expect(user).toContain('Where do you hang your hat?');
    expect(user).toContain('"options"');
    expect(system).toContain('"authorizedToWork"');
    expect(system).toMatch(/when in doubt answer "none"/);
  });

  it('caps long labels and long option lists', () => {
    const { user } = buildClassifyPrompt([{ id: 'a', label: 'x'.repeat(900), kind: 'select', options: Array.from({ length: 80 }, (_, i) => `opt${i}`) }]);
    expect(user).not.toContain('x'.repeat(201));
    expect(user).toContain('opt29');
    expect(user).not.toContain('opt30');
  });
});

describe('reading the reply', () => {
  it('accepts prose around the JSON and keeps only known values for known ids', () => {
    const reply = 'Here you go:\n```json\n{"f0":"city","f1":"authorizedToWork","f2":"resume","f3":"freeText","zz":"email","f9":"city"}\n```';
    expect(parseClassification(reply, fields)).toEqual({ f0: 'city', f1: 'authorizedToWork', f2: 'resume', f3: 'freeText' });
  });

  it('drops invented keys, a file mapped to text data, text mapped to a file, and free text on a choice', () => {
    const reply = JSON.stringify({ f0: 'favouriteColour', f1: 'freeText', f2: 'email', f3: 'resume' });
    expect(parseClassification(reply, fields)).toEqual({});
  });

  it('survives a reply that is not JSON at all', () => {
    expect(parseClassification('I cannot help with that.', fields)).toEqual({});
    expect(parseClassification('{ broken', fields)).toEqual({});
  });
});

describe('classifyFields', () => {
  it('asks once for the whole page with the small model, then answers from memory', async () => {
    const kv = memoryStore();
    const { complete, llm } = fakeLlm('{"f0":"city","f1":"authorizedToWork","f2":"none","f3":"freeText"}');
    const first = await classifyFields({ llm, kv }, config, 'careers.example.com', fields);
    expect(first).toEqual({ f0: 'city', f1: 'authorizedToWork', f2: 'none', f3: 'freeText' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0].model).toBe('claude-haiku-5-5');

    // Same labels on the same site, different ids (ids are per scan): nothing is sent.
    const again = await classifyFields({ llm, kv }, config, 'careers.example.com', fields.map((f, i) => ({ ...f, id: `g${i}` })));
    expect(again).toEqual({ g0: 'city', g1: 'authorizedToWork', g2: 'none', g3: 'freeText' });
    expect(complete).toHaveBeenCalledTimes(1);

    // Another site is asked separately; a "none" is remembered too.
    await classifyFields({ llm, kv }, config, 'jobs.other.com', [fields[0]!]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('only sends the fields it has not seen before', async () => {
    const kv = memoryStore();
    await classifyFields({ llm: fakeLlm('{"f0":"city"}').llm, kv }, config, 'h', [fields[0]!]);
    const { complete, llm } = fakeLlm('{"f1":"authorizedToWork"}');
    await classifyFields({ llm, kv }, config, 'h', [fields[0]!, fields[1]!]);
    expect(complete.mock.calls[0]![0].user).not.toContain('hang your hat');
    expect(complete.mock.calls[0]![0].user).toContain('allowed to work');
  });

  it('fails soft: an API error or an unusable reply leaves the fields unrecognised and nothing cached', async () => {
    const kv = memoryStore();
    expect(await classifyFields({ llm: fakeLlm(new Error('down')).llm, kv }, config, 'h', fields)).toEqual({});
    expect(await classifyFields({ llm: fakeLlm('nonsense').llm, kv }, config, 'h', fields)).toEqual({});
    const { complete, llm } = fakeLlm('{"f0":"city"}');
    expect(await classifyFields({ llm, kv }, config, 'h', fields)).toEqual({ f0: 'city' });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('sends nothing without a provider, and nothing for fields with no label', async () => {
    const { complete, llm } = fakeLlm('{}');
    await classifyFields({ llm, kv: memoryStore() }, llmConfig(defaultSettings()), 'h', fields);
    await classifyFields({ llm, kv: memoryStore() }, config, 'h', [{ id: 'f0', label: '  ', kind: 'text' }]);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('runFill with a classifier', () => {
  let profile: Profile;
  beforeEach(() => {
    profile = defaultProfile();
    profile.contact = { ...profile.contact, firstName: 'Ada' };
    profile.address = { ...profile.address, city: 'Montreal' };
  });
  const run = (classify: NonNullable<Parameters<typeof runFill>[0]['options']['classify']>, extra = {}) =>
    runFill({
      adapter: genericAdapter,
      ctx: { doc: document, url: new URL('https://careers.example.com/apply'), isTopFrame: true },
      profile,
      options: { overwrite: false, getFile: async () => null, rescanDelayMs: 0, classify, ...extra },
    });

  it('asks only about fields the rules missed, fills them and flags them for review', async () => {
    mount(`
      <label for="a">First name</label><input id="a">
      <label for="b">Where do you hang your hat?</label><input id="b">
      <label for="c">Shoe size</label><input id="c">
      <label for="d">Already answered by me</label><input id="d" value="typed">`);
    const classify = vi.fn(async (fs: { id: string; label: string }[]) => Object.fromEntries(fs.map((f) => [f.id, f.label.includes('hat') ? 'city' : 'none'] as const)));
    const { reports } = await run(classify);

    expect(classify.mock.calls[0]![0].map((f) => f.label)).toEqual(['Where do you hang your hat?', 'Shoe size']);
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('Montreal');
    expect(reports[1]).toMatchObject({ status: 'low-confidence', key: 'city', detail: 'matched by AI: check it' });
    expect(reports[2]!.status).toBe('unmatched');
    expect((document.getElementById('d') as HTMLInputElement).value).toBe('typed');
  });

  it('carries on when the classifier fails', async () => {
    mount('<label for="a">First name</label><input id="a"><label for="b">Mystery field</label><input id="b">');
    const { reports } = await run(async () => Promise.reject(new Error('offline')));
    expect(reports.map((r) => r.status)).toEqual(['filled', 'unmatched']);
  });

  it('does not ask about a question a saved answer already settles', async () => {
    mount('<label for="h">How did you hear about this role?</label><select id="h"><option value="">Select…</option><option>LinkedIn</option></select>');
    const classify = vi.fn(async () => ({}));
    await run(classify, { bankAnswer: () => ({ text: 'LinkedIn', score: 0.95 }) });
    expect(classify).not.toHaveBeenCalled();
  });
});
