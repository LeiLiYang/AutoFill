import { beforeEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../../../src/adapters/generic';
import type { FreeTextResult } from '../../../src/adapters/types';
import { runFill } from '../../../src/fill/engine';
import { captureAnswers } from '../../../src/review/capture';
import { collectFormAnswers } from '../../../src/review/formAnswers';
import { testProfile } from '../fixtures';
import { mount } from '../helpers';

const FORM = `
  <label for="why">Why do you want to work at Acme? *</label><textarea id="why" required></textarea>
  <label for="other">Anything else?</label><textarea id="other"></textarea>`;

const run = (freeText?: (d: any) => Promise<FreeTextResult>, overwrite = false) =>
  runFill({
    adapter: genericAdapter,
    ctx: { doc: document, url: new URL('https://example.com/apply'), isTopFrame: true },
    profile: testProfile(),
    options: { overwrite, getFile: async () => null, freeText },
  });

const val = (id: string) => (document.getElementById(id) as HTMLTextAreaElement).value;

beforeEach(() => mount(FORM));

describe('engine: free-text questions', () => {
  it('leaves them empty and flagged when there is no provider', async () => {
    const { reports } = await run();
    expect(val('why')).toBe('');
    expect(reports[0]).toMatchObject({ status: 'unmatched', detail: 'free-text question', emptyRequired: true });
  });

  it('fills a close answer-bank match green and a loose one yellow', async () => {
    const provider = vi.fn(async (d: any): Promise<FreeTextResult> =>
      d.label.startsWith('Why') ? { kind: 'bank', text: 'Mission.', score: 0.97 } : { kind: 'bank', text: 'Sure.', score: 0.75 });
    const { reports } = await run(provider);
    expect(val('why')).toBe('Mission.');
    expect(reports[0]).toMatchObject({ status: 'filled', detail: 'from your answer bank', emptyRequired: false });
    expect(val('other')).toBe('Sure.');
    expect(reports[1]!.status).toBe('low-confidence');
  });

  it('marks AI drafts for review and remembers what the model wrote', async () => {
    const { reports, generated } = await run(async () => ({ kind: 'ai', text: 'I admire the mission.' }));
    expect(val('why')).toBe('I admire the mission.');
    expect(reports[0]).toMatchObject({ status: 'ai', emptyRequired: false });
    expect(generated.get(reports[0]!.id)).toBe('I admire the mission.');
  });

  it('leaves the field empty and flagged when no answer is available, with the reason', async () => {
    const { reports } = await run(async () => ({ kind: 'none', reason: 'free-text question: no API key is set' }));
    expect(val('why')).toBe('');
    expect(reports[0]).toMatchObject({ status: 'unmatched', detail: 'free-text question: no API key is set', emptyRequired: true });
  });

  it('does not call the provider (or spend an API call) for an already-answered question', async () => {
    (document.getElementById('why') as HTMLTextAreaElement).value = 'Mine.';
    const provider = vi.fn(async (): Promise<FreeTextResult> => ({ kind: 'ai', text: 'x' }));
    const { reports } = await run(provider);
    expect(provider).toHaveBeenCalledTimes(1); // only the other, empty textarea
    expect(val('why')).toBe('Mine.');
    expect(reports[0]!.status).toBe('skipped-existing');
  });

  it('overwrites when asked', async () => {
    (document.getElementById('why') as HTMLTextAreaElement).value = 'Mine.';
    await run(async () => ({ kind: 'ai', text: 'Draft.' }), true);
    expect(val('why')).toBe('Draft.');
  });

  it('survives a provider that throws', async () => {
    const { reports } = await run(async () => {
      throw new Error('network down');
    });
    expect(reports[0]).toMatchObject({ status: 'failed', detail: 'network down', emptyRequired: true });
  });
});

describe('what gets saved afterwards', () => {
  it('saves only AI drafts the user rewrote, never untouched drafts', async () => {
    const { reports, descriptors, generated } = await run(async (d) => ({ kind: 'ai', text: `Draft for ${d.label.slice(0, 3)}` }));
    expect(captureAnswers(descriptors, reports, generated)).toEqual([]); // nothing edited yet

    (document.getElementById('why') as HTMLTextAreaElement).value = 'My own words.';
    expect(captureAnswers(descriptors, reports, generated)).toEqual([{ question: 'Why do you want to work at Acme?', answer: 'My own words.' }]);
  });

  it('records the source of each answer in answers.json, and downgrades an edited draft to manual', async () => {
    const { reports, descriptors, generated } = await run(async () => ({ kind: 'ai', text: 'Draft.' }));
    expect(collectFormAnswers(descriptors, reports, generated).map((a) => a.source)).toEqual(['ai', 'ai']);
    (document.getElementById('why') as HTMLTextAreaElement).value = 'Rewritten.';
    expect(collectFormAnswers(descriptors, reports, generated).map((a) => a.source)).toEqual(['manual', 'ai']);
  });
});
