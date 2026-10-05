import { useEffect, useState } from 'react';
import type { ToBackground } from '../messaging/protocol';
import { chromeLocalStore } from '../profile/storage';
import { listRows, type StoredRow } from './localLog';

/** The local copy of logged rows, kept live as the background worker updates it. */
export function useRows(): StoredRow[] {
  const [rows, setRows] = useState<StoredRow[]>([]);
  useEffect(() => {
    listRows(chromeLocalStore).then(setRows);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.loggedRows) setRows((changes.loggedRows.newValue as StoredRow[]) ?? []);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return rows;
}

export const queueAction = (msg: Extract<ToBackground, { type: 'queue-retry' | 'queue-mark-synced' | 'queue-discard' }>) =>
  chrome.runtime.sendMessage(msg);
