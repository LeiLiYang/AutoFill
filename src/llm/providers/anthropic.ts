import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmClient } from './types';

export interface ClaudeDeps {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  listModels?(): Promise<string[]>;
}

/** The official SDK. `dangerouslyAllowBrowser` is required in an extension worker; the key never leaves this device except to Anthropic. */
export function sdkDeps(apiKey: string): ClaudeDeps {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  return {
    create: (params) => client.messages.create(params),
    listModels: async () => {
      const ids: string[] = [];
      for await (const m of client.models.list()) ids.push(m.id);
      return ids;
    },
  };
}

/** `output_config.effort` exists on the current Opus/Sonnet/Fable models and Haiku 5.5; Haiku 4.5 and older reject it. */
export const supportsEffort = (model: string) => /^claude-(opus|sonnet|fable|mythos)-(4-[5-9]|5)|^claude-haiku-5/.test(model);

const CACHED = { type: 'ephemeral' } as const;

function toLlmError(e: unknown): LlmError {
  if (e instanceof Anthropic.AuthenticationError) return new LlmError('auth', e.message, e.status);
  if (e instanceof Anthropic.RateLimitError) return new LlmError('rate-limit', e.message, e.status);
  if (e instanceof Anthropic.NotFoundError) return new LlmError('not-found', e.message, e.status);
  if (e instanceof Anthropic.BadRequestError) return new LlmError('bad-request', e.message, e.status);
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('network', e.message);
  if (e instanceof Anthropic.APIError) return new LlmError('error', e.message, e.status);
  return new LlmError('error', (e as Error).message);
}

export function anthropicClient(deps: ClaudeDeps): LlmClient {
  return {
    async complete(req) {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: req.model,
        max_tokens: req.maxTokens,
        // Cache breakpoints: the instructions, then the posting and profile. Every further question
        // on the same page reads both at a fraction of the price instead of paying for them again.
        system: [{ type: 'text', text: req.system, cache_control: CACHED }],
        messages: [
          {
            role: 'user',
            content: req.stable
              ? [
                  { type: 'text', text: req.stable, cache_control: CACHED },
                  { type: 'text', text: req.user },
                ]
              : req.user,
          },
        ],
        // Short answers don't need deep reasoning; low effort keeps latency and cost down.
        ...(supportsEffort(req.model) ? ({ output_config: { effort: 'low' } } as object) : {}),
      };
      try {
        const msg = await deps.create(params);
        const text = msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        return { text, refused: (msg.stop_reason as string) === 'refusal' };
      } catch (e) {
        throw toLlmError(e);
      }
    },
    async listModels() {
      try {
        return (await deps.listModels?.()) ?? [];
      } catch (e) {
        throw toLlmError(e);
      }
    },
  };
}
