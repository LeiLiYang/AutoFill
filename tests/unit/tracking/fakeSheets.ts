import { SheetsError, type SheetsDeps } from '../../../src/tracking/sheets';

/** An in-memory Google Sheets: enough of the values API to exercise reads, appends and failures. */
export class FakeSheets {
  rows: string[][] = [];
  online = true;
  /** Tokens Google currently accepts. */
  validTokens = new Set(['good']);
  issuedToken = 'good';
  /** Which token getToken() hands out next. */
  signedIn = true;
  status: number | null = null; // force an HTTP status on the next call(s)
  /** Simulate a write that succeeds server-side but whose response is lost. */
  dropNextAppendResponse = false;
  calls: { method: string; url: string; body?: any }[] = [];
  invalidated: string[] = [];

  deps: SheetsDeps = {
    getToken: async (interactive) => {
      if (!this.signedIn && !interactive) throw new SheetsError('auth', 'Google sign-in is required');
      return this.issuedToken;
    },
    invalidateToken: async (t) => {
      this.invalidated.push(t);
      this.issuedToken = 'good';
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      this.calls.push({ method, url, body });
      if (!this.online) throw new TypeError('Failed to fetch');
      const auth = (init?.headers as Record<string, string>)?.Authorization?.replace('Bearer ', '');
      if (!auth || !this.validTokens.has(auth)) return json(401, { error: { message: 'Invalid Credentials' } });
      if (this.status) return json(this.status, { error: { message: `forced ${this.status}` } });
      if (method === 'GET') return json(200, { values: this.rows.map((r) => [r[7] ?? '']) });
      this.rows.push(body.values[0]);
      if (this.dropNextAppendResponse) {
        this.dropNextAppendResponse = false;
        throw new TypeError('network connection lost');
      }
      return json(200, { updates: { updatedRows: 1 } });
    }) as typeof fetch,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
