import type { KeyValueStore } from '../profile/storage';
import type { LogEntry } from './row';

export type RowStatus = 'synced' | 'pending' | 'failed';

export interface StoredRow {
  id: string;
  entry: LogEntry;
  /** Exactly what was (or will be) written, columns A–H. */
  row: string[];
  /** synced = in the sheet; pending = queued for retry; failed = needs a settings fix before retrying. */
  status: RowStatus;
  attempts: number;
  lastError?: string;
  errorKind?: 'auth' | 'transient' | 'config' | 'duplicate';
  /** Sheet rows (1-based) that already hold this URL, found when retrying. */
  duplicateRows?: number[];
  /** The duplicate check could not run when the row was logged (offline). */
  dupUnchecked?: boolean;
  createdAt: string;
  syncedAt?: string;
}

const KEY = 'loggedRows';

export async function listRows(kv: KeyValueStore): Promise<StoredRow[]> {
  const raw = await kv.get(KEY);
  return Array.isArray(raw) ? (raw as StoredRow[]) : [];
}

export async function saveRows(kv: KeyValueStore, rows: StoredRow[]): Promise<void> {
  await kv.set(KEY, rows);
}

export async function upsertRow(kv: KeyValueStore, row: StoredRow): Promise<void> {
  const rows = await listRows(kv);
  const i = rows.findIndex((r) => r.id === row.id);
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  await saveRows(kv, rows);
}

export async function removeRow(kv: KeyValueStore, id: string): Promise<void> {
  await saveRows(kv, (await listRows(kv)).filter((r) => r.id !== id));
}

export const pendingRows = (rows: StoredRow[]) => rows.filter((r) => r.status !== 'synced');
