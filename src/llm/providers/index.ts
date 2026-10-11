import type { LlmConfig } from '../config';
import { anthropicClient, sdkDeps, type ClaudeDeps } from './anthropic';
import { geminiClient } from './gemini';
import { openAiClient } from './openai';
import type { Fetch, LlmClient } from './types';

export interface ProviderDeps {
  /** Swappable so tests never call the real Anthropic API. */
  claude: (apiKey: string) => ClaudeDeps;
  fetch: Fetch;
}

export const defaultProviderDeps: ProviderDeps = { claude: sdkDeps, fetch: (input, init) => fetch(input, init) };

export function makeClient(config: LlmConfig, deps: ProviderDeps = defaultProviderDeps): LlmClient {
  switch (config.provider) {
    case 'anthropic':
      return anthropicClient(deps.claude(config.apiKey));
    case 'openai':
      return openAiClient({ apiKey: config.apiKey, fetch: deps.fetch });
    case 'custom':
      return openAiClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetch: deps.fetch });
    case 'gemini':
      return geminiClient({ apiKey: config.apiKey, fetch: deps.fetch });
  }
}
