import { INSUFFICIENT } from './prompt';
import { anthropicClient, sdkDeps, supportsEffort, type ClaudeDeps } from './providers/anthropic';
import { LlmError, type LlmClient } from './providers/types';

export { sdkDeps, supportsEffort, type ClaudeDeps };

export type AnswerResult =
  | { ok: true; text: string }
  | { ok: false; kind: 'no-key' | 'auth' | 'rate-limit' | 'network' | 'refusal' | 'insufficient' | 'error'; message: string };

/**
 * Room for the answer plus the model's own reasoning. Claude's current models always think before
 * answering and that counts against this cap, so a tight cap would cut answers off mid-sentence.
 */
const MAX_OUTPUT_TOKENS = 2000;

/** Cut to the character limit at a sentence (or word) boundary rather than mid-word. */
export function fitToLimit(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > maxChars * 0.5) return cut.slice(0, sentence + 1).trim();
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxChars).trim();
}

/** Free-text answers are at most two paragraphs. Extra paragraphs are folded into the second, not dropped. */
export const MAX_PARAGRAPHS = 2;
export function limitParagraphs(text: string, max = MAX_PARAGRAPHS): string {
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (paras.length <= max) return paras.join('\n\n');
  return [...paras.slice(0, max - 1), paras.slice(max - 1).join(' ')].join('\n\n');
}

/**
 * Em dashes are the most recognisable mark of machine-written text, and models use them even when
 * asked not to. A spaced dash between words becomes a comma; number ranges (2019–2021) are left alone.
 */
export function plainPunctuation(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/(?<=[A-Za-z,.])\s+–\s+(?=[A-Za-z])/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1');
}

/** A provider failure in the user's terms: what went wrong and what to do about it. */
export function describeLlmError(e: unknown, label: string, model: string): Extract<AnswerResult, { ok: false }> {
  if (!(e instanceof LlmError)) return { ok: false, kind: 'error', message: (e as Error).message };
  switch (e.kind) {
    case 'auth':
      return { ok: false, kind: 'auth', message: `${label} rejected the API key. Check it in the extension settings.` };
    case 'rate-limit':
      return { ok: false, kind: 'rate-limit', message: `Rate limited by ${label}. Wait a moment and fill again.` };
    case 'network':
      return { ok: false, kind: 'network', message: `Could not reach ${label}. Check your connection.` };
    case 'not-found':
      return { ok: false, kind: 'error', message: `Model not found: ${model}. Check the model name in settings.` };
    case 'bad-request':
      return { ok: false, kind: 'error', message: `${label} rejected the request: ${e.message}` };
    default:
      return { ok: false, kind: 'error', message: `${label} API error ${e.status ?? ''}: ${e.message}` };
  }
}

export interface AnswerRequest {
  model: string;
  system: string;
  /** Context shared by every question on the page; providers cache it. */
  stable?: string;
  user: string;
  maxChars?: number;
  /** Provider name for error messages. */
  label?: string;
}

export async function generateAnswer(client: LlmClient | ClaudeDeps, req: AnswerRequest): Promise<AnswerResult> {
  const llm = 'complete' in client ? client : anthropicClient(client);
  try {
    const reply = await llm.complete({ model: req.model, system: req.system, stable: req.stable, user: req.user, maxTokens: MAX_OUTPUT_TOKENS });
    if (reply.refused) return { ok: false, kind: 'refusal', message: 'The model declined to answer this question. Write it yourself.' };
    if (!reply.text) return { ok: false, kind: 'error', message: 'The model returned no text.' };
    if (reply.text.startsWith(INSUFFICIENT)) {
      return { ok: false, kind: 'insufficient', message: 'Not enough in your profile or answer bank to answer this without inventing details. Write it yourself.' };
    }
    return { ok: true, text: fitToLimit(limitParagraphs(plainPunctuation(reply.text)), req.maxChars) };
  } catch (e) {
    return describeLlmError(e, req.label ?? 'Anthropic', req.model);
  }
}
