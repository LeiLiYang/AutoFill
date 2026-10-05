import { bytesToBase64 } from '../profile/importExport';
import { getFile } from '../profile/files';
import { loadSettings } from '../profile/store';
import { reportsKey, type FileMessage, type FrameReport, type ToBackground, type ToContent } from '../messaging/protocol';

const CONTENT_SCRIPT = 'content-scripts/filler.js';

/** Inject the filler into every frame of the tab, then ask each frame to fill. User-triggered only. */
async function triggerFill(tabId: number, overwriteOverride?: boolean) {
  const settings = await loadSettings();
  const overwrite = overwriteOverride ?? settings.overwrite;
  await chrome.storage.session.set({ [reportsKey(tabId)]: [] });

  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
  } catch {
    // Some frames (cross-origin without host permission) are not injectable: fall back to the top frame.
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
  }
  const msg: ToContent = { type: 'run-fill', overwrite };
  await chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

async function storeFrameReport(tabId: number, report: FrameReport) {
  const key = reportsKey(tabId);
  const cur = ((await chrome.storage.session.get(key))[key] ?? []) as FrameReport[];
  await chrome.storage.session.set({ [key]: [...cur.filter((r) => r.frameUrl !== report.frameUrl), report] });
}

export default defineBackground(() => {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'fill-page') return;
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (target?.id != null) await triggerFill(target.id);
  });

  chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
    switch (msg.type) {
      case 'trigger-fill':
        triggerFill(msg.tabId, msg.overwrite).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
        return true;
      case 'frame-report':
        if (sender.tab?.id != null) storeFrameReport(sender.tab.id, msg.report).then(() => sendResponse({ ok: true }));
        return true;
      case 'get-file':
        getFile(msg.kind).then((f) => {
          const res: FileMessage | null = f ? { name: f.name, mime: f.mime, base64: bytesToBase64(new Uint8Array(f.data)) } : null;
          sendResponse(res);
        });
        return true;
    }
  });
});
