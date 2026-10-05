import type { Profile, Settings } from '../profile/schema';
import { styleSamples } from './answerBank';
import { generateAnswer, type AnswerResult, type ClaudeDeps } from './client';
import { buildPrompt, type PromptInput } from './prompt';

export interface AnswerDeps {
  loadProfile(): Promise<Profile>;
  loadSettings(): Promise<Settings>;
  /** The job posting for the page the form is on (may come from the top frame or the cache). */
  getPosting(): Promise<PromptInput['posting']>;
  claude(apiKey: string): ClaudeDeps;
}

/**
 * Draft an answer to one free-text question: posting text + profile + the most relevant past
 * answers as style examples. Runs in the background worker; without an API key nothing is sent.
 */
export async function answerQuestion(deps: AnswerDeps, req: { question: string; maxLength?: number }): Promise<AnswerResult> {
  const settings = await deps.loadSettings();
  const apiKey = settings.anthropicApiKey.trim();
  if (!apiKey) return { ok: false, kind: 'no-key', message: 'No Anthropic API key set.' };

  const [profile, posting] = await Promise.all([deps.loadProfile(), deps.getPosting()]);
  const { system, user } = buildPrompt({
    question: req.question,
    profile,
    samples: styleSamples(req.question, profile.answerBank),
    posting,
    maxChars: req.maxLength && req.maxLength > 0 ? req.maxLength : undefined,
  });
  return generateAnswer(deps.claude(apiKey), {
    model: settings.model.trim() || 'claude-opus-5-5',
    system,
    user,
    maxChars: req.maxLength && req.maxLength > 0 ? req.maxLength : undefined,
  });
}
