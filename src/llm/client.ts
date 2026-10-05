import Anthropic from '@anthropic-ai/sdk';
import { INSUFFICIENT } from './prompt';

export type AnswerResult =
  | { ok: true; text: string }
  | { ok: false; kind: 'no-key' | 'auth' | 'rate-limit' | 'network' | 'refusal' | 'insufficient' | 'error'; message: string };

export interface ClaudeDeps {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/** The official SDK. `dangerouslyAllowBrowser` is required in an extension worker; the key never leaves this device except to Anthropic. */
export function sdkDeps(apiKey: string): ClaudeDeps {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return { create: (params) => client.messages.create(params) };
}

/** `output_config.effort` exists on the current Opus/Sonnet/Fable models; Haiku 4.5 and older reject it. */
export const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(4-[5-9]|5)/.test(model);

const MAX_OUTPUT_TOKENS = 2000;

/** Cut to the character limit at a sentence (or word) boundary rather than mid-word. */
export function fitToLimit(text: string, maxChars?: number): string {
  if (!maxChars || text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > maxChars * 0.5) return cut.slice(0, sentence + 1).trim();
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxChars).trim();
}

export async function generateAnswer(
  deps: ClaudeDeps,
  req: { model: string; system: string; user: string; maxChars?: number },
): Promise<AnswerResult> {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    // Short answers don't need deep reasoning; low effort keeps latency and cost down.
    ...(supportsEffort(req.model) ? ({ output_config: { effort: 'low' } } as object) : {}),
  };

  try {
    const msg = await deps.create(params);
    if ((msg.stop_reason as string) === 'refusal') {
      return { ok: false, kind: 'refusal', message: 'The model declined to answer this question. Write it yourself.' };
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return { ok: false, kind: 'error', message: 'The model returned no text.' };
    if (text.startsWith(INSUFFICIENT)) {
      return { ok: false, kind: 'insufficient', message: 'Not enough in your profile or answer bank to answer this without inventing details. Write it yourself.' };
    }
    return { ok: true, text: fitToLimit(text, req.maxChars) };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, kind: 'auth', message: 'Anthropic rejected the API key. Check it in the extension settings.' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, kind: 'rate-limit', message: 'Rate limited by Anthropic. Wait a moment and fill again.' };
    if (e instanceof Anthropic.NotFoundError) return { ok: false, kind: 'error', message: `Model not found: ${req.model}. Check the model name in settings.` };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, kind: 'error', message: `Anthropic rejected the request: ${e.message}` };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, kind: 'network', message: 'Could not reach Anthropic. Check your connection.' };
    if (e instanceof Anthropic.APIError) return { ok: false, kind: 'error', message: `Anthropic API error ${e.status ?? ''}: ${e.message}` };
    return { ok: false, kind: 'error', message: (e as Error).message };
  }
}
