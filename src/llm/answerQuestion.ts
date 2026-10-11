import type { Profile, Settings } from '../profile/schema';
import { styleSamples } from './answerBank';
import { generateAnswer, type AnswerResult } from './client';
import { llmConfig, notReadyReason, type LlmConfig } from './config';
import { buildPrompt, type PromptInput } from './prompt';
import type { LlmClient } from './providers/types';

export interface AnswerDeps {
  loadProfile(): Promise<Profile>;
  loadSettings(): Promise<Settings>;
  /** The job posting for the page the form is on (may come from the top frame or the cache). */
  getPosting(): Promise<PromptInput['posting']>;
  /** The client for the provider chosen in settings. */
  llm(config: LlmConfig): LlmClient;
}

/**
 * Draft an answer to one free-text question: posting text + profile + the most relevant past
 * answers as style examples. Runs in the background worker; until a provider is set up nothing is sent.
 */
export async function answerQuestion(deps: AnswerDeps, req: { question: string; maxLength?: number }): Promise<AnswerResult> {
  const settings = await deps.loadSettings();
  const config = llmConfig(settings);
  if (!config.ready) return { ok: false, kind: 'no-key', message: notReadyReason(config) };

  const [profile, posting] = await Promise.all([deps.loadProfile(), deps.getPosting()]);
  const { qa, background } = styleSamples(req.question, profile.answerBank);
  const maxChars = req.maxLength && req.maxLength > 0 ? req.maxLength : undefined;
  const prompt = buildPrompt({ question: req.question, profile, samples: qa, background, posting, maxChars, voiceNotes: settings.voiceNotes });
  return generateAnswer(deps.llm(config), { model: config.model, ...prompt, maxChars, label: config.label });
}
