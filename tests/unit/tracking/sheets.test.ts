import { describe, expect, it } from 'vitest';
import { SheetsError, a1, appendRow, findDuplicateRows, readUrlColumn } from '../../../src/tracking/sheets';
import { FakeSheets } from './fakeSheets';

describe('a1', () => {
  it('quotes and encodes tab names', () => {
    expect(decodeURIComponent(a1('Sheet1', 'H:H'))).toBe("'Sheet1'!H:H");
    expect(decodeURIComponent(a1("Bob's Jobs 2026", 'A:H'))).toBe("'Bob''s Jobs 2026'!A:H");
    expect(a1('My Tab', 'A:H')).not.toContain(' ');
  });
});

describe('appendRow', () => {
  it('uses USER_ENTERED and INSERT_ROWS on A:H, sending the row as given', async () => {
    const s = new FakeSheets();
    const row = ['Acme', 'SWE', '', 'montreal', '2026/10/04', 'website', '', 'https://x.test/1'];
    await appendRow(s.deps, 'sheet123', 'Sheet1', row);
    const call = s.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/spreadsheets/sheet123/values/');
    expect(decodeURIComponent(call.url)).toContain("'Sheet1'!A:H:append");
    expect(call.url).toContain('valueInputOption=USER_ENTERED');
    expect(call.url).toContain('insertDataOption=INSERT_ROWS');
    expect(call.body).toEqual({ values: [row] });
    expect(s.rows).toEqual([row]);
  });
});

describe('duplicate detection', () => {
  const column = ['URL', 'https://boards.greenhouse.io/acme/jobs/1?gh_src=abc', '', 'https://jobs.lever.co/acme/xyz', 'not a url'];

  it('matches the same posting regardless of tracking params, and reports 1-based rows', () => {
    expect(findDuplicateRows(column, 'https://boards.greenhouse.io/acme/jobs/1')).toEqual([2]);
    expect(findDuplicateRows(column, 'https://boards.greenhouse.io/acme/jobs/1?utm_source=x&gh_src=y')).toEqual([2]);
  });

  it('treats a Lever /apply form URL as the same posting as the sheet entry', () => {
    expect(findDuplicateRows(column, 'https://jobs.lever.co/acme/xyz/apply')).toEqual([4]);
  });

  it('does not match different jobs', () => {
    expect(findDuplicateRows(column, 'https://boards.greenhouse.io/acme/jobs/2')).toEqual([]);
  });

  it('reads column H from the sheet', async () => {
    const s = new FakeSheets();
    s.rows = [['A', 'SWE', '', 'canada', '2026/01/01', 'website', '', 'https://x.test/1']];
    expect(await readUrlColumn(s.deps, 'id', 'Sheet1')).toEqual(['https://x.test/1']);
  });
});

describe('error handling', () => {
  const row = ['A', 'SWE', '', 'canada', '2026/01/01', 'website', '', 'https://x.test/1'];

  it('retries once with a fresh token after a 401, and drops the rejected token', async () => {
    const s = new FakeSheets();
    s.issuedToken = 'expired';
    await appendRow(s.deps, 'id', 'Sheet1', row);
    expect(s.invalidated).toEqual(['expired']);
    expect(s.rows).toHaveLength(1);
  });

  it('classifies failures: network/5xx/429 transient, 403/404/400 config', async () => {
    const s = new FakeSheets();
    const kind = async () => appendRow(s.deps, 'id', 'Sheet1', row).then(() => 'ok', (e: SheetsError) => e.kind);

    s.online = false;
    expect(await kind()).toBe('transient');
    s.online = true;
    for (const [status, expected] of [[500, 'transient'], [503, 'transient'], [429, 'transient'], [403, 'config'], [404, 'config'], [400, 'config']] as const) {
      s.status = status;
      expect(await kind(), String(status)).toBe(expected);
    }
  });

  it('gives actionable messages for config errors', async () => {
    const s = new FakeSheets();
    s.status = 404;
    await expect(appendRow(s.deps, 'id', 'Sheet1', row)).rejects.toThrow(/Sheet not found/);
    s.status = 403;
    await expect(appendRow(s.deps, 'id', 'Sheet1', row)).rejects.toThrow(/No access/);
  });
});
