import { isLinkedIn } from '../adapters/linkedin';
import { pickAdapter } from '../adapters/registry';
import type { FieldDescriptor, FreeTextResult } from '../adapters/types';
import { CONTROL_SELECTOR } from '../detect/descriptor';
import { deepQueryAll } from '../detect/deepQuery';
import { runFill } from '../fill/engine';
import { findAnswer } from '../llm/answerBank';
import type { AnswerResult } from '../llm/client';
import { llmConfig, notReadyReason } from '../llm/config';
import type {
  FileMessage,
  FrameReport,
  LogApplicationResponse,
  SaveAnswersResult,
  SavePostingResult,
  ToBackground,
  ToContent,
} from '../messaging/protocol';
import { extractPosting } from '../posting/extract';
import { buildLogPrefill, detectChannel, type LogPrefill } from '../tracking/prefill';
import type { FileKind, Profile } from '../profile/schema';
import { loadProfile, loadSettings } from '../profile/store';
import { base64ToBytes } from '../util/base64';
import { captureAnswers, type PriorRun } from '../review/capture';
import { collectFormAnswers } from '../review/formAnswers';
import { clearHighlights, highlight, levelFor, scrollToField } from '../review/highlight';
import type { PanelProps } from '../review/panel/Panel';
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
    let notice = '';
    let generated = new Map<string, string>();
    let logOnly = false;
    let logOnlyNote = '';
    let prefill: LogPrefill | null = null;

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
        notice,
        logOnly,
        logOnlyNote,
        prefill,
        onScroll: (frameId: number, fieldId: string) => void send({ type: 'focus-field', frameId, fieldId }),
        onSaveAnswers: async (): Promise<SaveAnswersResult> =>
          (await send<SaveAnswersResult | undefined>({ type: 'save-answers' })) ?? { saved: 0, found: 0, scanned: 0, unreachable: 1 },
        onSavePosting: () => send<SavePostingResult>({ type: 'save-posting' }),
        // Reached only from the user's click on the log card's confirm button.
        onLog: (entry: Parameters<NonNullable<PanelProps['onLog']>>[0], force: boolean, alsoSavePosting: boolean) =>
          send<LogApplicationResponse>({ type: 'log-application', entry, force, alsoSavePosting }),
        onClose: () => {
          panel?.unmount();
          panel = null;
          clearHighlights();
        },
      };
      if (panel) panel.update(props);
      else panel = mountPanel(document, props);
    }

    /** The fields on the page right now (a wizard may have moved on since the last fill). */
    function rescan(): FieldDescriptor[] {
      const ctx = { doc: document, url: new URL(location.href), isTopFrame: isTop };
      return pickAdapter(ctx).getFields(ctx);
    }
    const priorRun = (): PriorRun => ({ descriptors, reports: lastReports, generated });

    function computePrefill(): LogPrefill | null {
      try {
        const url = new URL(location.href);
        const posting = extractPosting(document, url);
        // Keep the description for the LLM: the application form page often has none of its own.
        if (!posting.formOnly && posting.descriptionMd.length >= 200) void send({ type: 'cache-posting', posting });
        return buildLogPrefill(posting, detectChannel(url, document));
      } catch {
        return null; // the card then simply does not appear; filling is unaffected
      }
    }

    /** Open-ended questions: a close saved answer first, then (only with an API key) an AI draft. */
    function makeFreeText(profile: Profile, overwrite: boolean) {
      return async (d: FieldDescriptor): Promise<FreeTextResult> => {
        const question = (d.label || d.nearbyText || '').trim();
        if (!question) return { kind: 'none', reason: 'free-text question (no question text found)' };
        const bank = findAnswer(question, profile.answerBank);
        if (bank) return { kind: 'bank', text: bank.entry.answer, score: bank.score };

        const llm = llmConfig(await loadSettings());
        if (!llm.ready) return { kind: 'none', reason: `free-text question: no saved answer matches. ${notReadyReason(llm)}` };
        const maxLength = (d.element as HTMLTextAreaElement).maxLength;
        const res = await send<AnswerResult>({ type: 'generate-answer', question, maxLength: maxLength > 0 ? maxLength : undefined, fresh: overwrite });
        return res?.ok ? { kind: 'ai', text: res.text } : { kind: 'none', reason: `free-text question: ${res?.message ?? 'no answer'}` };
      };
    }

    /**
     * Forms that render after the page loads (or after "Apply" is clicked) may not be there yet.
     * Give a frame with no controls a moment before deciding it has none. Tiny frames (trackers,
     * ad slots) never hold a form and are not waited for.
     */
    function waitForControls(timeoutMs = 1500): Promise<void> {
      const has = () => deepQueryAll(document, CONTROL_SELECTOR).length > 0;
      if (has() || window.innerWidth < 300 || window.innerHeight < 150) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        };
        const observer = new MutationObserver(() => has() && done());
        const timer = setTimeout(done, timeoutMs);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    }

    /** Panel with the log card only: nothing is read from or written to the page's form fields. */
    function showLogOnly(note: string) {
      clearHighlights();
      logOnly = true;
      logOnlyNote = note;
      notice = '';
      filling = false;
      frames = [];
      prefill = computePrefill();
      renderPanel();
    }

    async function run(overwrite: boolean) {
      clearHighlights();
      const url = new URL(location.href);
      if (isLinkedIn(url)) {
        // LinkedIn: log and save the posting only. Never fill there.
        if (isTop) showLogOnly('Autofill is off on LinkedIn. You can still log this application and save the posting.');
        return;
      }
      if (isTop) {
        logOnly = false;
        frames = [];
        notice = '';
        filling = true;
        prefill = computePrefill();
        renderPanel();
      }
      const profile = await loadProfile();
      await waitForControls();
      const ctx = { doc: document, url, isTopFrame: isTop };
      const adapter = pickAdapter(ctx);
      const bankAnswer = (d: FieldDescriptor) => {
        const hit = findAnswer((d.label || d.nearbyText || '').trim(), profile.answerBank);
        return hit ? { text: hit.entry.answer, score: hit.score } : null;
      };
      const result = await runFill({ adapter, ctx, profile, options: { overwrite, getFile, freeText: makeFreeText(profile, overwrite), bankAnswer } });
      descriptors = result.descriptors;
      lastReports = result.reports;
      generated = result.generated;
      for (const r of result.reports) {
        const level = levelFor(r);
        const d = result.descriptors.get(r.id);
        if (level && d) highlight(d.element, level);
      }
      // Frames without fields report too, so the panel can say "no form found" instead of nothing.
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
        case 'open-log':
          if (isTop) {
            showLogOnly("Nothing is being filled. Log this posting to your sheet (you don't need to have applied), or save it for later.");
          }
          sendResponse({ ok: true });
          return;
        case 'panel-update':
          if (isTop) {
            frames = msg.frames;
            filling = msg.filling;
            notice = msg.notice ?? '';
            renderPanel();
          }
          return;
        case 'scroll-to': {
          const d = descriptors.get(msg.fieldId);
          if (d) scrollToField(d.element);
          return;
        }
        case 'collect-answers':
          sendResponse(captureAnswers(rescan(), priorRun()));
          return;
        case 'collect-form-answers':
          sendResponse({ answers: collectFormAnswers(rescan(), priorRun()) });
          return;
        case 'extract-posting':
          sendResponse({ posting: extractPosting(document, new URL(location.href)) });
          return;
      }
    });
  },
});
