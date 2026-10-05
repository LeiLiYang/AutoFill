import type { ToOffscreen } from '../messaging/protocol';
import { bytesToBase64 } from '../util/base64';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const POLL_MS = 150;

export interface DownloadedFile {
  name: string;
  /** Absolute path as reported by Chrome. */
  path: string;
}

/** Wait for a download to finish; rejects if it is interrupted or times out. */
async function waitForDownload(id: number): Promise<chrome.downloads.DownloadItem> {
  const end = Date.now() + DOWNLOAD_TIMEOUT_MS;
  for (;;) {
    const [item] = await chrome.downloads.search({ id });
    if (item?.state === 'complete') return item;
    if (item?.state === 'interrupted') throw new Error(`download interrupted: ${item.error ?? 'unknown error'}`);
    if (Date.now() > end) throw new Error('download timed out');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function startAndWait(url: string, filename: string): Promise<DownloadedFile> {
  // `filename` is relative to Chrome's Downloads folder; Chrome creates the subfolders.
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  const item = await waitForDownload(id);
  return { name: filename.split('/').pop() ?? filename, path: item.filename };
}

/** Small text files: a data URL is fine and avoids the offscreen round trip. */
export function downloadText(filename: string, text: string, mime: string): Promise<DownloadedFile> {
  return startAndWait(`data:${mime};charset=utf-8,${encodeURIComponent(text)}`, filename);
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS' as chrome.offscreen.Reason],
    justification: 'Create blob URLs so large page snapshots can be saved with chrome.downloads.',
  });
}

/** Large binary files: data URLs are capped (~2 MB), so hand the bytes to an offscreen document for a blob URL. */
export async function downloadBlob(filename: string, blob: Blob, mime: string): Promise<DownloadedFile> {
  await ensureOffscreen();
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  const make: ToOffscreen = { target: 'offscreen', type: 'make-blob-url', base64, mime };
  const res = (await chrome.runtime.sendMessage(make)) as { url?: string } | undefined;
  if (!res?.url) throw new Error('could not create a blob URL for the download');
  try {
    return await startAndWait(res.url, filename);
  } finally {
    const revoke: ToOffscreen = { target: 'offscreen', type: 'revoke-blob-url', url: res.url };
    chrome.runtime.sendMessage(revoke).catch(() => undefined);
  }
}
