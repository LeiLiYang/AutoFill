import type { FileKind } from './schema';

export interface StoredFile {
  kind: FileKind;
  name: string;
  mime: string;
  /** Raw bytes; stored as ArrayBuffer rather than Blob so it clones identically everywhere. */
  data: ArrayBuffer;
}

const DB_NAME = 'autofill-files';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'kind' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const putFile = (file: StoredFile) => tx('readwrite', (s) => s.put(file)).then(() => undefined);
export const deleteFile = (kind: FileKind) => tx('readwrite', (s) => s.delete(kind)).then(() => undefined);
export const getFile = (kind: FileKind) =>
  tx<StoredFile | undefined>('readonly', (s) => s.get(kind) as IDBRequest<StoredFile | undefined>);

/** Turn a stored file into a File for DataTransfer-based attachment. */
export const toFile = (f: StoredFile) => new File([f.data], f.name, { type: f.mime });
