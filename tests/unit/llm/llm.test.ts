import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { BANK_CONFIDENT, findAnswer, questionSimilarity, samplesFromPaste, splitSamples, styleSamples } from '../../../src/llm/answerBank';
import { answerQuestion } from '../../../src/llm/answerQuestion';
import { fitToLimit, generateAnswer, supportsEffort, type ClaudeDeps } from '../../../src/llm/client';
import { INSUFFICIENT, buildPrompt, profileSummary } from '../../../src/llm/prompt';
import { cachePosting, getCachedPosting } from '../../../src/posting/cache';
import { memoryStore } from '../../../src/profile/storage';
import { defaultProfile, defaultSettings, type Answer } from '../../../src/profile/schema';
import { testProfile } from '../fixtures';

const ans = (question: string, answer: string, tags: string[] = [], updatedAt = '2026-01-01T00:00:00Z'): Answer => ({
  id: question, question, answer, tags, updatedAt,
});

describe('answer bank matching', () => {
  it('treats identical questions as a perfect match, ignoring case and punctuation', () => {
    expect(questionSimilarity('Why do you want to work here?', ans('why do you want to work here', 'x'))).toBe(1);
  });

  it('matches paraphrases but flags them below the confident threshold', () => {
    const m = findAnswer('Why do you want to work at Acme?', [ans('Why do you want to work here?', 'Because.')]);
    expect(m).not.toBeNull();
    expect(m!.score).toBeGreaterThanOrEqual(0.7);
    expect(m!.score).toBeLessThan(BANK_CONFIDENT);
  });

  it('does not match unrelated questions', () => {
    expect(findAnswer('What is your favourite programming language?', [ans('Why do you want to work here?', 'x')])).toBeNull();
  });

  it('uses tags as extra phrasings of the question', () => {
    const bank = [ans('Why us', 'Mission.', ['why this company'])];
    expect(findAnswer('Why are you interested in this company?', bank)).not.toBeNull();
    expect(findAnswer('What is your biggest weakness?', bank)).toBeNull();
  });

  it('picks the best of several and ignores empty answers', () => {
    const bank = [ans('Tell us about a project you are proud of', ''), ans('Describe a project you are proud of', 'The engine.'), ans('Biggest challenge?', 'Time.')];
    expect(findAnswer('Tell us about a project you are proud of', bank)!.entry.answer).toBe('The engine.');
  });

  it('chooses style samples by relevance, falling back to the most recent', () => {
    const bank = [ans('Why this company?', 'A', [], '2026-01-01'), ans('Biggest challenge', 'B', [], '2026-03-01'), ans('Favorite tool', 'C', [], '2026-02-01')];
    expect(styleSamples('Why do you want this company?', bank, 1).qa[0]!.answer).toBe('A');
    expect(styleSamples('zzz unrelated qqq', bank, 2).qa.map((s) => s.answer)).toEqual(['B', 'C']);
  });

  it('always includes answers saved without a question as background, newest first, within a budget', () => {
    const bank = [
      ans('', 'I built a compiler for fun and love systems programming.', [], '2026-01-01'),
      ans('', 'Robotics club captain; I enjoy mentoring.', [], '2026-02-01'),
      ans('Why us?', 'Because.', [], '2026-03-01'),
    ];
    const { qa, background } = styleSamples('Totally unrelated question zzz', bank);
    expect(background.map((b) => b.answer.slice(0, 8))).toEqual(['Robotics', 'I built ']);
    expect(qa.map((q) => q.question)).toEqual(['Why us?']);

    const huge = Array.from({ length: 20 }, (_, i) => ans('', 'x'.repeat(1700), [], `2026-01-${String(i + 1).padStart(2, '0')}`));
    expect(styleSamples('q', huge).background.length).toBeLessThanOrEqual(4); // 8000-char budget
  });

  it('never matches a question-less entry to a form question', () => {
    expect(findAnswer('Why do you want to work here?', [ans('', 'I built a compiler for fun.')])).toBeNull();
  });

  it('turns pasted text into question-less entries that are never matched to form questions', () => {
    let n = 0;
    const entries = samplesFromPaste('First answer is long enough to keep.\n\nSecond answer is also long enough.', new Date('2026-10-05T00:00:00Z'), () => `id-${++n}`);
    expect(entries).toEqual([
      { id: 'id-1', question: '', answer: 'First answer is long enough to keep.', tags: [], updatedAt: '2026-10-05T00:00:00.000Z' },
      { id: 'id-2', question: '', answer: 'Second answer is also long enough.', tags: [], updatedAt: '2026-10-05T00:00:00.000Z' },
    ]);
    expect(findAnswer('First answer is long enough to keep.', entries)).toBeNull();
    expect(samplesFromPaste('too short')).toEqual([]);
  });

  it('splits pasted text into separate samples', () => {
    const a = 'First answer is long enough to keep.';
    const b = 'Second answer, also long enough.\n\nWith a blank line inside it.';
    expect(splitSamples(`${a}\n\n${a}`)).toEqual([a, a]);
    expect(splitSamples(`${a}\n---\n${b}`)).toEqual([a, b]); // --- fences allow blank lines within an answer
    expect(splitSamples('short\n\n   \n\n')).toEqual([]);
  });
});

describe('prompt', () => {
  const profile = { ...testProfile(), answerBank: [] };
  profile.contact.email = 'secret@example.com';
  profile.address.line1 = '1 Private Street';
  profile.work.salaryExpectation.amount = '123456';
  profile.eeo.gender = 'Female';

  const posting = { company: 'Acme', title: 'Backend Engineer', descriptionMd: 'Acme builds payment infrastructure.' };
  const out = buildPrompt({ question: 'Why Acme?', profile, posting, samples: [ans('Why us?', 'I like building things.')] });

  it('includes the posting, the relevant profile, and style samples', () => {
    expect(out.user).toContain('payment infrastructure');
    expect(out.user).toContain('Analytical Engines');
    expect(out.user).toContain('Example University');
    expect(out.user).toContain('Q: Why us?\nA: I like building things.');
    expect(out.user).toContain('<question>\nWhy Acme?\n</question>');
  });

  it('never sends contact details, address, salary or demographics', () => {
    for (const secret of ['secret@example.com', '555-0100', '1 Private Street', '123456', 'Female']) {
      expect(out.system + out.user).not.toContain(secret);
    }
    expect(profileSummary(profile)).not.toContain('@');
  });

  it('presents question-less answers as background on the applicant, and allows using their facts', () => {
    const withBg = buildPrompt({
      question: 'What excites you about this role?',
      profile,
      samples: [],
      background: [ans('', 'I spent a summer building a distributed key-value store and loved it.')],
    });
    expect(withBg.user).toContain('<writing_samples');
    expect(withBg.user).toContain('distributed key-value store');
    expect(withBg.system).toMatch(/profile, past answers and writing samples/i);
    expect(withBg.user.indexOf('<writing_samples')).toBeLessThan(withBg.user.indexOf('<question>'));
    expect(out.user).not.toContain('<writing_samples'); // none provided: no empty block
  });

  it('forbids inventing experience and defines the insufficient-info escape hatch', () => {
    expect(out.system).toMatch(/never invent/i);
    expect(out.system).toContain(INSUFFICIENT);
    expect(out.system).toMatch(/first person/i);
  });

  it('truncates a very long posting and states the form limit', () => {
    const long = buildPrompt({ question: 'q', profile, samples: [], posting: { descriptionMd: 'x'.repeat(50_000) }, maxChars: 500 });
    expect(long.user.length).toBeLessThan(8000);
    expect(long.system).toContain('at most 500 characters');
  });

  it('works with an empty profile and no posting', () => {
    expect(buildPrompt({ question: 'q', profile: defaultProfile(), samples: [], posting: null }).user).toContain('no profile details');
  });
});

describe('client', () => {
  const ok = (text: string, stop_reason = 'end_turn'): ClaudeDeps => ({
    create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }], stop_reason }),
  });
  const req = { model: 'claude-opus-5-5', system: 's', user: 'u' };

  it('returns the text of the answer', async () => {
    expect(await generateAnswer(ok('  I enjoy it.  '), req)).toEqual({ ok: true, text: 'I enjoy it.' });
  });

  it('sends low effort on models that support it and omits it on Haiku', async () => {
    const d = ok('x');
    await generateAnswer(d, req);
    expect((d.create as any).mock.calls[0][0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' } });
    expect((d.create as any).mock.calls[0][0].thinking).toBeUndefined(); // thinking is always on for Opus 5.5: never send it
    const h = ok('x');
    await generateAnswer(h, { ...req, model: 'claude-haiku-4-5' });
    expect((h.create as any).mock.calls[0][0].output_config).toBeUndefined();
    expect(supportsEffort('claude-sonnet-5-5')).toBe(true);
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
  });

  it('turns the insufficient-info marker into a refusal to guess', async () => {
    expect(await generateAnswer(ok(INSUFFICIENT), req)).toMatchObject({ ok: false, kind: 'insufficient' });
  });

  it('reports a model refusal', async () => {
    expect(await generateAnswer(ok('', 'refusal'), req)).toMatchObject({ ok: false, kind: 'refusal' });
  });

  it('fits the answer to the field limit at a sentence boundary', async () => {
    expect(fitToLimit('One. Two. Three is long.', 12)).toBe('One. Two.');
    expect(fitToLimit('short', 100)).toBe('short');
    const r = await generateAnswer(ok('First sentence here. Second sentence goes on and on.'), { ...req, maxChars: 30 });
    expect(r).toEqual({ ok: true, text: 'First sentence here.' });
  });

  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [404, 'error'],
    [400, 'error'],
    [500, 'error'],
  ])('maps HTTP %i to a typed failure (%s)', async (status, kind) => {
    const err = Anthropic.APIError.generate(status, { error: { message: 'boom' } }, 'boom', new Headers());
    const d: ClaudeDeps = { create: vi.fn().mockRejectedValue(err) };
    const r = await generateAnswer(d, req);
    expect(r).toMatchObject({ ok: false, kind });
  });

  it('maps a connection failure to a network error', async () => {
    const d: ClaudeDeps = { create: vi.fn().mockRejectedValue(new Anthropic.APIConnectionError({ message: 'down' })) };
    expect(await generateAnswer(d, req)).toMatchObject({ ok: false, kind: 'network' });
  });
});

describe('answerQuestion', () => {
  const deps = (apiKey: string, create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Draft.' }], stop_reason: 'end_turn' })) => {
    const profile = { ...testProfile(), answerBank: [ans('Describe a project you are proud of', 'I built an engine.')] };
    return {
      create,
      deps: {
        loadProfile: async () => profile,
        loadSettings: async () => ({ ...defaultSettings(), anthropicApiKey: apiKey, model: 'claude-sonnet-5-5' }),
        getPosting: async () => ({ company: 'Acme', title: 'SWE', descriptionMd: 'We build payment systems.' }),
        claude: (key: string) => ({ create: (p: any) => create({ ...p, __key: key }) }) as ClaudeDeps,
      },
    };
  };

  it('does nothing and sends nothing without an API key', async () => {
    const { deps: d, create } = deps('  ');
    expect(await answerQuestion(d, { question: 'Why us?' })).toMatchObject({ ok: false, kind: 'no-key' });
    expect(create).not.toHaveBeenCalled();
  });

  it('feeds question-less writing samples into the prompt so the model can use them', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Draft.' }], stop_reason: 'end_turn' });
    const profile = { ...testProfile(), answerBank: [ans('', 'I run a robotics club and love teaching younger students.')] };
    await answerQuestion(
      {
        loadProfile: async () => profile,
        loadSettings: async () => ({ ...defaultSettings(), anthropicApiKey: 'k' }),
        getPosting: async () => null,
        claude: () => ({ create }) as ClaudeDeps,
      },
      { question: 'Tell us something about yourself' },
    );
    expect(create.mock.calls[0]![0].messages[0].content).toContain('robotics club');
  });

  it('uses the configured model, the key, the posting and relevant samples', async () => {
    const { deps: d, create } = deps('sk-test');
    const r = await answerQuestion(d, { question: 'Tell us about a project you are proud of', maxLength: 400 });
    expect(r).toEqual({ ok: true, text: 'Draft.' });
    const sent = create.mock.calls[0]![0];
    expect(sent.__key).toBe('sk-test');
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.messages[0].content).toContain('We build payment systems.');
    expect(sent.messages[0].content).toContain('I built an engine.');
    expect(sent.system).toContain('at most 400 characters');
  });
});

describe('posting cache', () => {
  it('stores by canonical URL and keeps only the most recent entries', async () => {
    const kv = memoryStore();
    await cachePosting(kv, 'https://x/0', { title: 't', company: 'c', descriptionMd: 'd' }, new Date(2026, 0, 1));
    for (let i = 1; i <= 45; i++) await cachePosting(kv, `https://x/${i}`, { title: 't', company: 'c', descriptionMd: 'd' }, new Date(2026, 0, 1 + i));
    expect(await getCachedPosting(kv, 'https://x/45')).toMatchObject({ descriptionMd: 'd' });
    expect(await getCachedPosting(kv, 'https://x/0')).toBeNull(); // evicted
  });
});
