import type { Settings } from '../profile/schema';
import { PROVIDER_LABELS, type ProviderId } from './providers/types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

/** The chosen provider with everything a request needs. Pure: safe to import from the content script. */
export interface LlmConfig {
  provider: ProviderId;
  label: string;
  apiKey: string;
  /** Model that writes free-text answers. */
  model: string;
  /** Cheaper model that only maps unrecognised field labels to profile fields. */
  mappingModel: string;
  baseUrl: string;
  /** Enough is configured to make a call (a local server needs a URL, everything else a key). */
  ready: boolean;
}

export function llmConfig(s: Settings): LlmConfig {
  const provider = s.provider;
  const label = PROVIDER_LABELS[provider];
  if (provider === 'anthropic') {
    const apiKey = s.anthropicApiKey.trim();
    const model = s.model.trim() || DEFAULT_ANTHROPIC_MODEL;
    return { provider, label, apiKey, model, mappingModel: s.anthropicMappingModel.trim() || model, baseUrl: '', ready: !!apiKey };
  }
  const p = s.providers[provider];
  const apiKey = p.apiKey.trim();
  const model = p.model.trim();
  const baseUrl = provider === 'custom' ? p.baseUrl.trim() : '';
  const ready = !!model && (provider === 'custom' ? !!baseUrl : !!apiKey);
  return { provider, label, apiKey, model, mappingModel: p.mappingModel.trim() || model, baseUrl, ready };
}

/** Why no call can be made yet, in the user's terms. */
export function notReadyReason(c: LlmConfig): string {
  if (c.provider === 'custom' && !c.baseUrl) return 'No server URL is set for your OpenAI-compatible provider.';
  if (c.provider !== 'anthropic' && !c.model) return `No model name is set for ${c.label}.`;
  return `No ${c.label} API key is set.`;
}
