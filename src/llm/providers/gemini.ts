import { requestJson, type Fetch, type LlmClient } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateContent {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

const detail = (body: any): string | undefined => body?.error?.message;
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII']);

/** Google's Generative Language API. The key goes in a header, never in the URL. */
export function geminiClient(opts: { apiKey: string; fetch: Fetch }): LlmClient {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey };
  return {
    async complete(req) {
      const body = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: (req.stable ?? '') + req.user }] }],
      };
      const model = req.model.replace(/^models\//, '');
      const res = await requestJson<GenerateContent>(
        opts.fetch,
        `${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        { method: 'POST', headers, body: JSON.stringify(body) },
        detail,
      );
      const candidate = res.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      return { text, refused: !text && (!!res.promptFeedback?.blockReason || BLOCKED.has(candidate?.finishReason ?? '')) };
    },
    async listModels() {
      const res = await requestJson<{ models?: { name: string; supportedGenerationMethods?: string[] }[] }>(
        opts.fetch,
        `${BASE_URL}/models?pageSize=1000`,
        { method: 'GET', headers },
        detail,
      );
      return (res.models ?? [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .sort();
    },
  };
}
