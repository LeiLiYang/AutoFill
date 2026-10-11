export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'custom';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  custom: 'your OpenAI-compatible server',
};

export interface LlmRequest {
  model: string;
  /** Instructions. The same for every question, so providers can cache it. */
  system: string;
  /** Context shared by every question on one page (posting, profile): sent first so it can be cached. */
  stable?: string;
  /** What differs per question. */
  user: string;
  maxTokens: number;
}

export interface LlmReply {
  text: string;
  /** The provider declined on policy grounds (no usable text). */
  refused?: boolean;
}

export type LlmErrorKind = 'auth' | 'rate-limit' | 'network' | 'not-found' | 'bad-request' | 'error';

/** A provider failure, already sorted into what the user can do about it. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmReply>;
  /** Model ids this key can use, for the settings page. */
  listModels(): Promise<string[]>;
}

/** `fetch` is injected so tests never reach a real API. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const kindForStatus = (status: number): LlmErrorKind =>
  status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate-limit' : status === 404 ? 'not-found' : status === 400 || status === 422 ? 'bad-request' : 'error';

/** Send a JSON request and turn HTTP and network failures into LlmError. `detail` digs the provider's message out of an error body. */
export async function requestJson<T>(fetchFn: Fetch, url: string, init: RequestInit, detail: (body: any) => string | undefined): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new LlmError('network', (e as Error).message);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON error page: fall back to the status line below */
  }
  if (!res.ok) throw new LlmError(kindForStatus(res.status), detail(body) ?? (text.slice(0, 200) || `HTTP ${res.status}`), res.status);
  return body as T;
}
