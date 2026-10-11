import { requestJson, type Fetch, type LlmClient } from './types';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
}

const detail = (body: any): string | undefined => (typeof body?.error === 'string' ? body.error : body?.error?.message);

/**
 * The Chat Completions API, which OpenAI and most other providers and local servers speak
 * (OpenRouter, Groq, DeepSeek, Mistral, Ollama, LM Studio). No output cap is sent: its name and
 * meaning differ between servers, and the prompt already asks for a short answer. These providers
 * cache a repeated prompt prefix on their own, so the stable context simply goes first.
 */
export function openAiClient(opts: { apiKey: string; baseUrl?: string; fetch: Fetch }): LlmClient {
  const base = (opts.baseUrl?.trim() || OPENAI_BASE_URL).replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // A local server needs no key.
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  return {
    async complete(req) {
      const body = {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: (req.stable ?? '') + req.user },
        ],
      };
      const res = await requestJson<ChatCompletion>(opts.fetch, `${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, detail);
      const choice = res.choices?.[0];
      const text = (choice?.message?.content ?? '').trim();
      return { text, refused: !text && (!!choice?.message?.refusal || choice?.finish_reason === 'content_filter') };
    },
    async listModels() {
      const res = await requestJson<{ data?: { id: string }[] }>(opts.fetch, `${base}/models`, { method: 'GET', headers }, detail);
      return (res.data ?? []).map((m) => m.id).sort();
    },
  };
}
