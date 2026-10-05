import { pickAdapter } from '../adapters/registry';
import type { FieldDescriptor } from '../adapters/types';
import { runFill } from '../fill/engine';
import type { FileMessage, FrameReport, ToBackground, ToContent } from '../messaging/protocol';
import { base64ToBytes } from '../profile/importExport';
import type { FileKind } from '../profile/schema';
import { loadProfile } from '../profile/store';
import { captureAnswers } from '../review/capture';
import { clearHighlights, highlight, levelFor, scrollToField } from '../review/highlight';
import { mountPanel, type PanelHandle } from '../review/panel/mountPanel';

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

    const isTop = window === window.top;
    let descriptors = new Map<string, FieldDescriptor>();
    let lastReports: FrameReport['reports'] = [];
    let panel: PanelHandle | null = null;
    let frames: FrameReport[] = [];
    let filling = false;

    const send = <T = unknown>(msg: ToBackground) => chrome.runtime.sendMessage(msg) as Promise<T>;

    async function getFile(kind: FileKind): Promise<File | null> {
      const res = await send<FileMessage | null>({ type: 'get-file', kind });
      if (!res) return null;
      return new File([base64ToBytes(res.base64) as BlobPart], res.name, { type: res.mime });
    }

    function renderPanel() {
      const props = {
        frames,
        filling,
        onScroll: (frameId: number, fieldId: string) => void send({ type: 'focus-field', frameId, fieldId }),
        onSaveAnswers: async () => (await send<{ saved: number }>({ type: 'save-answers' }))?.saved ?? 0,
        onClose: () => {
          panel?.unmount();
          panel = null;
          clearHighlights();
        },
      };
      if (panel) panel.update(props);
      else panel = mountPanel(document, props);
    }

    async function run(overwrite: boolean) {
      clearHighlights();
      if (isTop) {
        frames = [];
        filling = true;
        renderPanel();
      }
      const profile = await loadProfile();
      const ctx = { doc: document, url: new URL(location.href), isTopFrame: isTop };
      const adapter = pickAdapter(ctx);
      const result = await runFill({ adapter, ctx, profile, options: { overwrite, getFile } });
      descriptors = result.descriptors;
      lastReports = result.reports;
      for (const r of result.reports) {
        const level = levelFor(r);
        const d = result.descriptors.get(r.id);
        if (level && d) highlight(d.element, level);
      }
      if (!result.reports.length) return; // frames without form controls stay silent
      await send({
        type: 'frame-report',
        report: { frameUrl: location.href, isTop, adapter: adapter.id, reports: result.reports },
      });
    }

    chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'run-fill':
          run(msg.overwrite).then(
            () => sendResponse({ ok: true }),
            (e) => sendResponse({ ok: false, error: String(e) }),
          );
          return true;
        case 'panel-update':
          if (isTop) {
            frames = msg.frames;
            filling = msg.filling;
            renderPanel();
          }
          return;
        case 'scroll-to': {
          const d = descriptors.get(msg.fieldId);
          if (d) scrollToField(d.element);
          return;
        }
        case 'collect-answers':
          sendResponse({ answers: captureAnswers(descriptors, lastReports) });
          return;
      }
    });
  },
});
