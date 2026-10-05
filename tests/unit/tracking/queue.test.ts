import { beforeEach, describe, expect, it } from 'vitest';
import { memoryStore } from '../../../src/profile/storage';
import { pendingRows } from '../../../src/tracking/localLog';
import { createLogger } from '../../../src/tracking/queue';
import type { LogEntry } from '../../../src/tracking/row';
import { FakeSheets } from './fakeSheets';

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  company: 'Acme Corp', category: 'SWE', location: 'montreal', date: '2026/10/04', channel: 'website',
  url: 'https://boards.greenhouse.io/acme/jobs/1', ...over,
});

let sheets: FakeSheets;
let kv: ReturnType<typeof memoryStore>;
let settings: { sheetId: string; tabName: string };
let n = 0;
const make = () =>
  createLogger({ sheets: sheets.deps, kv, getSettings: async () => settings, now: () => new Date('2026-10-04T12:00:00Z'), uuid: () => `id-${++n}` });

beforeEach(() => {
  sheets = new FakeSheets();
  kv = memoryStore();
  settings = { sheetId: 'sheet1', tabName: 'Sheet1' };
  n = 0;
});

describe('logging', () => {
  it('writes the row, and keeps a local copy marked synced', async () => {
    const log = make();
    const r = await log.logApplication(entry());
    expect(r).toMatchObject({ ok: true, status: 'synced' });
    expect(sheets.rows).toEqual([['Acme Corp', 'SWE', '', 'montreal', '2026/10/04', 'website', '', 'https://boards.greenhouse.io/acme/jobs/1']]);
    const [row] = await log.list();
    expect(row).toMatchObject({ status: 'synced', attempts: 1, entry: { company: 'Acme Corp' } });
  });

  it('rejects invalid entries before touching the network or the local log', async () => {
    const log = make();
    const r = await log.logApplication({ ...entry(), location: 'paris' });
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
    expect(sheets.calls).toHaveLength(0);
    expect(await log.list()).toEqual([]);
  });

  it('requires a configured sheet', async () => {
    settings.sheetId = '  ';
    const r = await make().logApplication(entry());
    expect(r).toMatchObject({ ok: false, code: 'not-configured' });
    expect(sheets.calls).toHaveLength(0);
  });

  it('escapes formula-like company names in the written row', async () => {
    await make().logApplication(entry({ company: '=1+1' }));
    expect(sheets.rows[0]![0]).toBe("'=1+1");
  });
});

describe('duplicate check', () => {
  it('warns instead of writing when column H already has the same URL', async () => {
    const log = make();
    await log.logApplication(entry());
    const again = await log.logApplication(entry({ url: 'https://boards.greenhouse.io/acme/jobs/1?utm_source=linkedin' }));
    expect(again).toMatchObject({ ok: false, code: 'duplicate', rows: [1] });
    expect(sheets.rows).toHaveLength(1);
    expect(await log.list()).toHaveLength(1);
  });

  it('writes anyway when the user confirms (force)', async () => {
    const log = make();
    await log.logApplication(entry());
    const forced = await log.logApplication(entry(), { force: true });
    expect(forced).toMatchObject({ ok: true, status: 'synced' });
    expect(sheets.rows).toHaveLength(2);
  });
});

describe('failure handling: nothing is ever lost', () => {
  it('queues the row when offline, keeps it locally, and retries later exactly once', async () => {
    const log = make();
    sheets.online = false;
    const r = await log.logApplication(entry());
    expect(r).toMatchObject({ ok: true, status: 'queued' });
    expect(sheets.rows).toHaveLength(0);
    let [row] = await log.list();
    expect(row).toMatchObject({ status: 'pending', errorKind: 'transient', dupUnchecked: true });
    expect(pendingRows(await log.list())).toHaveLength(1);

    // Still offline: retry keeps it pending.
    expect(await log.retryPending()).toEqual({ synced: 0, remaining: 1 });

    sheets.online = true;
    expect(await log.retryPending()).toEqual({ synced: 1, remaining: 0 });
    expect(sheets.rows).toHaveLength(1);
    [row] = await log.list();
    expect(row).toMatchObject({ status: 'synced' });

    // A second retry pass does not write it again.
    expect(await log.retryPending()).toEqual({ synced: 0, remaining: 0 });
    expect(sheets.rows).toHaveLength(1);
  });

  it('survives an expired token: refreshes and writes', async () => {
    sheets.issuedToken = 'expired';
    const r = await make().logApplication(entry());
    expect(r).toMatchObject({ ok: true, status: 'synced' });
    expect(sheets.invalidated).toEqual(['expired']);
  });

  it('queues when sign-in is needed in the background, and does not pop up sign-in on auto-retry', async () => {
    const log = make();
    sheets.online = false;
    await log.logApplication(entry());
    sheets.online = true;
    sheets.signedIn = false;
    const out = await log.retryPending(false); // alarm-style: non-interactive
    expect(out).toEqual({ synced: 0, remaining: 1 });
    expect((await log.list())[0]).toMatchObject({ status: 'pending', errorKind: 'auth' });

    sheets.signedIn = true;
    expect(await log.retryPending(true)).toEqual({ synced: 1, remaining: 0 });
  });

  it('keeps config errors locally as failed and does not auto-retry them', async () => {
    const log = make();
    sheets.status = 404;
    const r = await log.logApplication(entry(), { force: true });
    expect(r).toMatchObject({ ok: true, status: 'queued' });
    expect((await log.list())[0]).toMatchObject({ status: 'failed', errorKind: 'config' });

    sheets.status = null;
    expect(await log.retryPending()).toEqual({ synced: 0, remaining: 1 }); // skipped: needs the user
    const fixed = await log.retryOne('id-1');
    expect(fixed).toMatchObject({ status: 'synced' });
    expect(sheets.rows).toHaveLength(1);
  });

  it('stops retrying after the first network failure instead of hammering every row', async () => {
    const log = make();
    sheets.online = false;
    await log.logApplication(entry({ url: 'https://x.test/1' }));
    await log.logApplication(entry({ url: 'https://x.test/2' }));
    sheets.calls.length = 0;
    await log.retryPending();
    expect(sheets.calls).toHaveLength(1); // one duplicate-check attempt, then stop
  });
});

describe('lost responses: a write that actually succeeded', () => {
  it('detects it on retry and asks instead of double-writing', async () => {
    const log = make();
    sheets.dropNextAppendResponse = true;
    const r = await log.logApplication(entry());
    expect(r).toMatchObject({ ok: true, status: 'queued' });
    expect(sheets.rows).toHaveLength(1); // the server did write it

    const out = await log.retryPending();
    expect(out).toEqual({ synced: 0, remaining: 1 });
    expect(sheets.rows).toHaveLength(1);
    const [row] = await log.list();
    expect(row).toMatchObject({ status: 'pending', errorKind: 'duplicate', duplicateRows: [1] });

    await log.markSynced(row!.id);
    expect((await log.list())[0]!.status).toBe('synced');
    expect(sheets.rows).toHaveLength(1);
  });

  it('can append anyway when the user insists', async () => {
    const log = make();
    sheets.dropNextAppendResponse = true;
    await log.logApplication(entry());
    await log.retryPending();
    const forced = await log.retryOne('id-1', { force: true });
    expect(forced?.status).toBe('synced');
    expect(sheets.rows).toHaveLength(2);
  });
});

describe('concurrency', () => {
  it('never writes the same row twice when retries overlap', async () => {
    const log = make();
    sheets.online = false;
    await log.logApplication(entry());
    sheets.online = true;
    await Promise.all([log.retryPending(), log.retryPending(), log.retryOne('id-1')]);
    expect(sheets.rows).toHaveLength(1);
  });
});

describe('discarding', () => {
  it('removes a row from the local log on request', async () => {
    const log = make();
    sheets.online = false;
    await log.logApplication(entry());
    await log.discard('id-1');
    expect(await log.list()).toEqual([]);
  });
});
