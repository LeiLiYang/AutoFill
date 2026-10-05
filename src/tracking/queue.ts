import type { KeyValueStore } from '../profile/storage';
import { listRows, removeRow, saveRows, upsertRow, type StoredRow } from './localLog';
import { buildRow, validateEntry, type LogEntry } from './row';
import { SheetsError, appendRow, findDuplicateRows, readUrlColumn, type SheetsDeps } from './sheets';

export type LogResult =
  | { ok: true; status: 'synced' | 'queued'; id: string; message: string }
  | { ok: false; code: 'invalid'; message: string; errors: string[] }
  | { ok: false; code: 'not-configured'; message: string }
  | { ok: false; code: 'duplicate'; message: string; rows: number[] }
  | { ok: false; code: 'auth' | 'config'; message: string };

export interface LoggerDeps {
  sheets: SheetsDeps;
  kv: KeyValueStore;
  getSettings(): Promise<{ sheetId: string; tabName: string }>;
  now?: () => Date;
  uuid?: () => string;
}

export interface RetryOutcome {
  synced: number;
  remaining: number;
}

/**
 * Orchestrates logging: validate → duplicate check → local copy → append. Every confirmed row is
 * stored locally first; a failed write is queued and retried, and never lost.
 */
export function createLogger(deps: LoggerDeps) {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  // One operation at a time: an alarm retry must not race a manual retry into a double append.
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const next = chain.then(job, job);
    chain = next.catch(() => undefined);
    return next;
  };

  async function readDuplicates(sheetId: string, tab: string, url: string, interactive: boolean) {
    return findDuplicateRows(await readUrlColumn(deps.sheets, sheetId, tab, interactive), url);
  }

  function applyFailure(row: StoredRow, e: unknown): StoredRow {
    const err = e instanceof SheetsError ? e : new SheetsError('transient', (e as Error).message);
    row.attempts += 1;
    row.lastError = err.message;
    row.errorKind = err.kind;
    // config errors need a settings fix; auth and transient errors are queued for retry.
    row.status = err.kind === 'config' ? 'failed' : 'pending';
    return row;
  }

  async function logApplication(input: unknown, opts: { force?: boolean } = {}): Promise<LogResult> {
    return exclusive(async () => {
      const v = validateEntry(input);
      if (!v.ok) return { ok: false, code: 'invalid', message: v.errors.join(' '), errors: v.errors };
      const { sheetId, tabName } = await deps.getSettings();
      if (!sheetId.trim()) {
        return { ok: false, code: 'not-configured', message: 'Set your Google Sheet ID in the extension options before logging.' };
      }

      let dupUnchecked = false;
      if (!opts.force) {
        try {
          const rows = await readDuplicates(sheetId, tabName, v.entry.url, true);
          if (rows.length) {
            return { ok: false, code: 'duplicate', rows, message: `This URL is already in the sheet (row ${rows.join(', ')}).` };
          }
        } catch (e) {
          if (e instanceof SheetsError && e.kind === 'auth') return { ok: false, code: 'auth', message: e.message };
          if (e instanceof SheetsError && e.kind === 'config') return { ok: false, code: 'config', message: e.message };
          dupUnchecked = true; // offline: log anyway, check again when the row is retried
        }
      }

      let row: StoredRow = {
        id: uuid(),
        entry: v.entry,
        row: buildRow(v.entry),
        status: 'pending',
        attempts: 0,
        dupUnchecked: dupUnchecked || undefined,
        createdAt: now().toISOString(),
      };
      await upsertRow(deps.kv, row); // local copy first: nothing is lost if the write fails

      try {
        await appendRow(deps.sheets, sheetId, tabName, row.row, true);
        row = { ...row, status: 'synced', syncedAt: now().toISOString(), attempts: 1, lastError: undefined, errorKind: undefined, dupUnchecked: undefined };
        await upsertRow(deps.kv, row);
        return { ok: true, status: 'synced', id: row.id, message: 'Logged to your sheet.' };
      } catch (e) {
        row = applyFailure(row, e);
        await upsertRow(deps.kv, row);
        const queued = row.status === 'pending';
        return {
          ok: true,
          status: 'queued',
          id: row.id,
          message: queued
            ? `Could not reach the sheet (${row.lastError}). Saved locally and queued: it will retry automatically.`
            : `The sheet rejected the row (${row.lastError}). Saved locally: fix the settings, then retry from the extension.`,
        };
      }
    });
  }

  /** Try to write one stored row. `force` skips the duplicate check (user chose "append anyway"). */
  async function syncRow(row: StoredRow, interactive: boolean, force: boolean): Promise<StoredRow> {
    const { sheetId, tabName } = await deps.getSettings();
    if (!sheetId.trim()) return applyFailure(row, new SheetsError('config', 'Set your Google Sheet ID in the extension options.'));
    try {
      if (!force) {
        // Also catches a write that succeeded but whose response was lost.
        const dups = await readDuplicates(sheetId, tabName, row.entry.url, interactive);
        if (dups.length) {
          return {
            ...row,
            status: 'pending',
            errorKind: 'duplicate',
            duplicateRows: dups,
            lastError: `This URL is already in the sheet (row ${dups.join(', ')}). Append anyway, or mark it as synced.`,
          };
        }
      }
      await appendRow(deps.sheets, sheetId, tabName, row.row, interactive);
      return { ...row, status: 'synced', syncedAt: now().toISOString(), attempts: row.attempts + 1, lastError: undefined, errorKind: undefined, duplicateRows: undefined, dupUnchecked: undefined };
    } catch (e) {
      return applyFailure(row, e);
    }
  }

  /**
   * Retry queued rows. Automatic retries pass interactive=false (no sign-in popups); rows waiting
   * on a duplicate decision or a settings fix are skipped until the user acts on them.
   */
  function retryPending(interactive = false): Promise<RetryOutcome> {
    return exclusive(async () => {
      let synced = 0;
      const rows = await listRows(deps.kv);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const retryable = r.status === 'pending' && r.errorKind !== 'duplicate';
        if (!retryable) continue;
        const next = await syncRow(r, interactive, false);
        if (next.status === 'synced') synced++;
        rows[i] = next;
        await saveRows(deps.kv, rows);
        // Offline: stop early instead of failing every row in turn.
        if (next.errorKind === 'transient' || next.errorKind === 'auth') break;
      }
      return { synced, remaining: rows.filter((r) => r.status !== 'synced').length };
    });
  }

  /** User-initiated retry of one row. */
  function retryOne(id: string, opts: { force?: boolean } = {}): Promise<StoredRow | null> {
    return exclusive(async () => {
      const rows = await listRows(deps.kv);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) return null;
      rows[i] = await syncRow(rows[i]!, true, !!opts.force);
      await saveRows(deps.kv, rows);
      return rows[i]!;
    });
  }

  /** The user confirms the row is already in the sheet. */
  function markSynced(id: string): Promise<void> {
    return exclusive(async () => {
      const rows = await listRows(deps.kv);
      const r = rows.find((x) => x.id === id);
      if (r) {
        Object.assign(r, { status: 'synced', syncedAt: now().toISOString(), lastError: undefined, errorKind: undefined, duplicateRows: undefined });
        await saveRows(deps.kv, rows);
      }
    });
  }

  const discard = (id: string) => exclusive(() => removeRow(deps.kv, id));

  return { logApplication, retryPending, retryOne, markSynced, discard, list: () => listRows(deps.kv) };
}

export type Logger = ReturnType<typeof createLogger>;
export type { LogEntry };
