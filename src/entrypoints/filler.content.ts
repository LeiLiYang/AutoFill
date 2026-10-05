import { pickAdapter } from '../adapters/registry';
import { runFill } from '../fill/engine';
import type { FileMessage, FrameReport, ToBackground, ToContent } from '../messaging/protocol';
import { base64ToBytes } from '../profile/importExport';
import { loadProfile } from '../profile/store';
import type { FileKind } from '../profile/schema';

/**
 * Injected on demand by the background worker (never declared in the manifest), so nothing
 * runs on page load. Fills the fields of this frame and reports back; never clicks submit.
 */
export default defineContentScript({
  registration: 'runtime',
  matches: [],
  allFrames: true,
  main() {
    const w = window as unknown as { __autofillInstalled?: boolean };
    if (w.__autofillInstalled) return;
    w.__autofillInstalled = true;

    async function getFile(kind: FileKind): Promise<File | null> {
      const msg: ToBackground = { type: 'get-file', kind };
      const res = (await chrome.runtime.sendMessage(msg)) as FileMessage | null;
      if (!res) return null;
      return new File([base64ToBytes(res.base64) as BlobPart], res.name, { type: res.mime });
    }

    async function run(overwrite: boolean) {
      const profile = await loadProfile();
      const ctx = { doc: document, url: new URL(location.href), isTopFrame: window === window.top };
      const adapter = pickAdapter(ctx);
      const { reports } = await runFill({ adapter, ctx, profile, options: { overwrite, getFile } });
      if (!reports.length) return; // frames without form controls stay silent
      const report: FrameReport = {
        frameUrl: location.href,
        isTop: ctx.isTopFrame,
        adapter: adapter.id,
        reports,
      };
      const msg: ToBackground = { type: 'frame-report', report };
      await chrome.runtime.sendMessage(msg);
    }

    chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
      if (msg?.type !== 'run-fill') return;
      run(msg.overwrite).then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e) }),
      );
      return true;
    });
  },
});
