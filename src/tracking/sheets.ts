import { canonicalPostingUrl } from '../posting/canonicalUrl';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export type SheetsErrorKind =
  /** Token missing/expired: re-authenticate. */
  | 'auth'
  /** Offline, 429 or 5xx: worth retrying later. */
  | 'transient'
  /** Wrong sheet id/tab, no access, bad request: fix settings, retrying will not help. */
  | 'config';

export class SheetsError extends Error {
  constructor(
    public kind: SheetsErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface SheetsDeps {
  /** Resolves an OAuth access token. `interactive` may show a Google sign-in/consent window. */
  getToken(interactive: boolean): Promise<string>;
  /** Drops a cached token that Google rejected. */
  invalidateToken(token: string): Promise<void>;
  fetch: typeof fetch;
}

/** A1 range with the tab name quoted ('My Tab'!A:H), URL-encoded for the path. */
export function a1(tab: string, range: string): string {
  return encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`);
}

async function call(deps: SheetsDeps, interactive: boolean, url: string, init: RequestInit = {}): Promise<any> {
  const run = async (token: string) => {
    let res: Response;
    try {
      res = await deps.fetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      throw new SheetsError('transient', `Network error: ${(e as Error).message}`);
    }
    return res;
  };

  let token = await deps.getToken(interactive);
  let res = await run(token);
  if (res.status === 401) {
    // Expired or revoked: drop the cached token and try once with a fresh one.
    await deps.invalidateToken(token);
    token = await deps.getToken(interactive);
    res = await run(token);
  }
  if (res.ok) return res.json();

  let detail = '';
  try {
    detail = ((await res.json()) as any)?.error?.message ?? '';
  } catch {
    /* body is not JSON */
  }
  if (res.status === 401) throw new SheetsError('auth', detail || 'Google sign-in expired', 401);
  if (res.status === 429 || res.status >= 500) throw new SheetsError('transient', detail || `Google Sheets is unavailable (${res.status})`, res.status);
  const hint =
    res.status === 403 ? 'No access to this sheet: check the Sheet ID and that your Google account can edit it.'
    : res.status === 404 ? 'Sheet not found: check the Sheet ID in settings.'
    : res.status === 400 ? 'Bad request: check the Sheet ID and tab name in settings.'
    : '';
  throw new SheetsError('config', [hint, detail].filter(Boolean).join(' ') || `Sheets request failed (${res.status})`, res.status);
}

/** All values in column H (the job URLs), 1-indexed rows preserved by position. */
export async function readUrlColumn(deps: SheetsDeps, sheetId: string, tab: string, interactive = true): Promise<string[]> {
  const data = await call(deps, interactive, `${API}/${encodeURIComponent(sheetId)}/values/${a1(tab, 'H:H')}`);
  return ((data.values ?? []) as string[][]).map((r) => r[0] ?? '');
}

/** Row numbers (1-based) in column H whose URL is the same posting as `url`. */
export function findDuplicateRows(column: string[], url: string): number[] {
  const target = canonicalPostingUrl(url);
  const rows: number[] = [];
  column.forEach((cell, i) => {
    if (cell && /^https?:/i.test(cell.trim()) && canonicalPostingUrl(cell.trim()) === target) rows.push(i + 1);
  });
  return rows;
}

/** Append one row. USER_ENTERED so Sheets parses 2026/10/04 as a date, exactly as if typed. */
export async function appendRow(deps: SheetsDeps, sheetId: string, tab: string, row: string[], interactive = true): Promise<void> {
  const url =
    `${API}/${encodeURIComponent(sheetId)}/values/${a1(tab, 'A:H')}:append` +
    '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
  await call(deps, interactive, url, { method: 'POST', body: JSON.stringify({ values: [row] }) });
}
