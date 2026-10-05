import { isLinkedIn } from '../adapters/linkedin';
import { pickAdapter } from '../adapters/registry';
import type { FieldDescriptor, FreeTextResult } from '../adapters/types';
import { runFill } from '../fill/engine';
import { findAnswer } from '../llm/answerBank';
import type { AnswerResult } from '../llm/client';
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
    let generated = new Map<string, string>();
    let logOnly = false;
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
        logOnly,
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
    function makeFreeText(profile: Profile) {
      return async (d: FieldDescriptor): Promise<FreeTextResult> => {
        const question = (d.label || d.nearbyText || '').trim();
        if (!question) return { kind: 'none', reason: 'free-text question (no question text found)' };
        const bank = findAnswer(question, profile.answerBank);
        if (bank) return { kind: 'bank', text: bank.entry.answer, score: bank.score };

        const settings = await loadSettings();
        if (!settings.anthropicApiKey.trim()) {
          return { kind: 'none', reason: 'free-text question: no saved answer matches and no API key is set' };
        }
        const maxLength = (d.element as HTMLTextAreaElement).maxLength;
        const res = await send<AnswerResult>({ type: 'generate-answer', question, maxLength: maxLength > 0 ? maxLength : undefined });
        return res?.ok ? { kind: 'ai', text: res.text } : { kind: 'none', reason: `free-text question: ${res?.message ?? 'no answer'}` };
      };
    }

    async function run(overwrite: boolean) {
      clearHighlights();
      const url = new URL(location.href);
      if (isLinkedIn(url)) {
        // LinkedIn: log and save the posting only. Never fill there.
        if (isTop) {
          logOnly = true;
          filling = false;
          frames = [];
          prefill = computePrefill();
          renderPanel();
        }
        return;
      }
      if (isTop) {
        logOnly = false;
        frames = [];
        filling = true;
        prefill = computePrefill();
        renderPanel();
      }
      const profile = await loadProfile();
      const ctx = { doc: document, url, isTopFrame: isTop };
      const adapter = pickAdapter(ctx);
      const result = await runFill({ adapter, ctx, profile, options: { overwrite, getFile, freeText: makeFreeText(profile) } });
      descriptors = result.descriptors;
      lastReports = result.reports;
      generated = result.generated;
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
