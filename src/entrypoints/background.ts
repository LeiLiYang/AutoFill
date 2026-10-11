import { savePosting } from '../background/savePosting';
import { sdkDeps, type AnswerResult, type ClaudeDeps } from '../llm/client';
import { answerQuestion } from '../llm/answerQuestion';
import { cachePosting, getCachedPosting } from '../posting/cache';
import { getFile } from '../profile/files';
import { chromeLocalStore } from '../profile/storage';
import { loadProfile, loadSettings, saveProfile } from '../profile/store';
import { bytesToBase64 } from '../util/base64';
import { normalize } from '../detect/normalize';
import {
  reportsKey,
  type CapturedAnswer,
  type FileMessage,
  type FrameReport,
  type LogApplicationResponse,
  type SaveAnswersResult,
  type TestSheetsResult,
  type ToBackground,
  type ToContent,
} from '../messaging/protocol';
import { chromeSheetsDeps } from '../tracking/auth';
import { createLogger } from '../tracking/queue';
import { readUrlColumn, type SheetsDeps } from '../tracking/sheets';

const RETRY_ALARM = 'retry-queue';
const RETRY_EVERY_MINUTES = 5;

/** Sheets access is swappable so end-to-end tests can run without Google. */
let sheetsDeps: SheetsDeps = chromeSheetsDeps;
const logger = createLogger({
  // Resolved per call so a test can swap the implementation after startup.
  sheets: {
    getToken: (i) => sheetsDeps.getToken(i),
    invalidateToken: (t) => sheetsDeps.invalidateToken(t),
    fetch: (input, init) => sheetsDeps.fetch(input, init),
  },
  kv: chromeLocalStore,
  getSettings: async () => {
    const s = await loadSettings();
    return { sheetId: s.sheetId, tabName: s.tabName };
  },
});

const CONTENT_SCRIPT = 'content-scripts/filler.js';

const getReports = async (tabId: number): Promise<FrameReport[]> => {
  const key = reportsKey(tabId);
  return ((await chrome.storage.session.get(key))[key] ?? []) as FrameReport[];
};

const toTopFrame = (tabId: number, msg: ToContent) =>
  chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => undefined);

async function pushPanel(tabId: number, filling: boolean, notice?: string) {
  await toTopFrame(tabId, { type: 'panel-update', frames: await getReports(tabId), filling, notice });
}

/** Chrome's injection errors, in words the user can act on. */
function explain(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/cannot access|cannot be scripted|chrome:\/\/|extensions gallery|chrome web store|error page/i.test(message)) {
    return 'Chrome does not let extensions run on this page (browser pages, the Web Store, PDFs and error pages are off limits).';
  }
  return message;
}

/** The shortcut and the right-click menu have nowhere to show an error: flag it on the toolbar icon. */
async function flagOnIcon(tabId: number, message: string | null) {
  try {
    await chrome.action.setBadgeText({ tabId, text: message ? '!' : '' });
    await chrome.action.setTitle({ tabId, title: message ? `Autofill: ${message}` : '' });
    if (message) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  } catch {
    /* the tab is gone */
  }
}

/** Serialise report writes per tab: frames report concurrently and storage is read-modify-write. */
const queues = new Map<number, Promise<void>>();
function enqueue(tabId: number, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(job, job);
  queues.set(tabId, next);
  return next;
}

/** Inject the filler into every reachable frame of the tab, then ask each frame to fill. User-triggered only. */
async function triggerFill(tabId: number, overwriteOverride?: boolean) {
  const settings = await loadSettings();
  const overwrite = overwriteOverride ?? settings.overwrite;
  await enqueue(tabId, () => chrome.storage.session.set({ [reportsKey(tabId)]: [] }));

  void flagOnIcon(tabId, null);

  let frameIds: number[];
  let notice: string | undefined;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
    frameIds = results.map((r) => r.frameId);
  } catch {
    // Some frames are not injectable (sandboxed, or a browser page embedded in the site): fall back to the top frame.
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    frameIds = results.map((r) => r.frameId);
    notice = 'An embedded frame on this page could not be reached, so any fields inside it were not filled.';
  }

  const msg: ToContent = { type: 'run-fill', overwrite };
  const settled = await Promise.allSettled(
    frameIds.map((frameId) => chrome.tabs.sendMessage(tabId, msg, { frameId }) as Promise<{ ok: boolean; error?: string } | undefined>),
  );
  // A frame that threw part-way would otherwise look exactly like a frame with nothing to fill.
  const failure = settled.map((r) => (r.status === 'fulfilled' ? (r.value?.ok === false ? r.value.error : undefined) : String(r.reason))).find(Boolean);
  if (failure && !/receiving end does not exist|message port closed/i.test(failure)) {
    notice = `Part of this page could not be filled: ${failure.replace(/^Error:\s*/, '')}`;
  }
  await enqueue(tabId, () => pushPanel(tabId, false, notice));
}

function storeFrameReport(tabId: number, frameId: number, report: FrameReport) {
  return enqueue(tabId, async () => {
    const cur = await getReports(tabId);
    const next = [...cur.filter((r) => r.frameId !== frameId), { ...report, frameId }];
    await chrome.storage.session.set({ [reportsKey(tabId)]: next });
    await pushPanel(tabId, true);
  });
}

/**
 * Frames of the tab that have the extension running. A wizard step can appear in a frame that had no
 * fields at the last fill, so ask the tab itself, falling back to the frames that reported earlier.
 */
async function framesWithExtension(tabId: number): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window as unknown as { __autofillInstalled?: boolean }).__autofillInstalled === true,
    });
    const ids = results.filter((r) => r.result === true).map((r) => r.frameId);
    if (ids.length) return ids;
  } catch {
    /* fall through to the frames we already know about */
  }
  return (await getReports(tabId)).map((f) => f.frameId).filter((id): id is number => id != null);
}

/** Add or update answer-bank entries; the same normalized question updates in place. */
async function saveAnswers(answers: CapturedAnswer[]): Promise<number> {
  const profile = await loadProfile();
  const now = new Date().toISOString();
  let changed = 0;
  for (const a of answers) {
    const q = normalize(a.question);
    const existing = profile.answerBank.find((e) => normalize(e.question) === q);
    if (existing) {
      if (existing.answer === a.answer) continue;
      existing.answer = a.answer;
      existing.updatedAt = now;
    } else {
      profile.answerBank.push({ id: crypto.randomUUID(), question: a.question, answer: a.answer, tags: [], updatedAt: now });
    }
    changed++;
  }
  if (changed) await saveProfile(profile);
  return changed;
}

async function collectAndSaveAnswers(tabId: number): Promise<SaveAnswersResult> {
  const collected: CapturedAnswer[] = [];
  let scanned = 0;
  let unreachable = 0;
  const frameIds = await framesWithExtension(tabId);
  for (const frameId of frameIds) {
    const msg: ToContent = { type: 'collect-answers' };
    const res = (await chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => null)) as { answers: CapturedAnswer[]; scanned: number } | null;
    if (!res) {
      unreachable++;
      continue;
    }
    collected.push(...res.answers);
    scanned += res.scanned;
  }
  if (!frameIds.length) unreachable = 1;
  // The same question can appear in more than one frame or step: keep the last answer given.
  const unique = [...new Map(collected.map((a) => [normalize(a.question), a])).values()];
  return { saved: await saveAnswers(unique), found: unique.length, scanned, unreachable };
}

/** Inject the content script into the top frame only (idempotent: it guards against double install). */
const ensureInjected = (tabId: number) =>
  chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] }).then(() => undefined);

/** Open the review panel's log card for this page without reading or filling any field. */
async function openLogPanel(tabId: number) {
  void flagOnIcon(tabId, null);
  await ensureInjected(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'open-log' } satisfies ToContent, { frameId: 0 });
}

const runSavePosting = (tabId: number) => savePosting(tabId, { ensureInjected, getFrames: getReports });

/** The Anthropic client factory is swappable so end-to-end tests never call the real API. */
let claudeFactory: (apiKey: string) => ClaudeDeps = sdkDeps;

/** The job description for the page the form is on: from the page itself, else cached by canonical URL. */
async function postingFor(tabId: number) {
  const res = (await chrome.tabs.sendMessage(tabId, { type: 'extract-posting' } satisfies ToContent, { frameId: 0 }).catch(() => undefined)) as
    | { posting: import('../messaging/protocol').ExtractedPosting }
    | undefined;
  const p = res?.posting;
  if (!p) return null;
  if (!p.formOnly && p.descriptionMd.length >= 200) return { title: p.title, company: p.company, descriptionMd: p.descriptionMd };
  const cached = await getCachedPosting(chromeLocalStore, p.canonicalUrl);
  return cached ?? { title: p.title, company: p.company };
}

function runGenerateAnswer(tabId: number | undefined, msg: Extract<ToBackground, { type: 'generate-answer' }>): Promise<AnswerResult> {
  return answerQuestion(
    {
      loadProfile,
      loadSettings,
      getPosting: () => (tabId == null ? Promise.resolve(null) : postingFor(tabId)),
      claude: (key) => claudeFactory(key),
    },
    { question: msg.question, maxLength: msg.maxLength },
  );
}

/** Sign in (if needed) and read column H: proves the OAuth client, Sheet ID and tab name work. */
async function testSheets(): Promise<TestSheetsResult> {
  const { sheetId, tabName } = await loadSettings();
  if (!sheetId.trim()) return { ok: false, message: 'Enter your Google Sheet ID first (and save).' };
  try {
    const column = await readUrlColumn(
      {
        getToken: (i) => sheetsDeps.getToken(i),
        invalidateToken: (t) => sheetsDeps.invalidateToken(t),
        fetch: (input, init) => sheetsDeps.fetch(input, init),
      },
      sheetId.trim(),
      tabName,
      true,
    );
    return { ok: true, rows: column.filter((c) => /^https?:/i.test(c)).length };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The user confirmed the log card: write the row, and save the posting too if they ticked that. */
async function runLog(tabId: number | undefined, msg: Extract<ToBackground, { type: 'log-application' }>): Promise<LogApplicationResponse> {
  const log = await logger.logApplication(msg.entry, { force: msg.force });
  const target = msg.tabId ?? tabId;
  if (log.ok && msg.alsoSavePosting && target != null) return { log, save: await runSavePosting(target) };
  return { log };
}

export default defineBackground(() => {
  if (import.meta.env.MODE === 'test') {
    // Test hooks for Playwright: there is no user gesture to press the toolbar button or shortcut,
    // and tests must not talk to Google.
    (globalThis as any).__autofill = {
      triggerFill,
      openLogPanel,
      savePosting: runSavePosting,
      setSheets: (deps: SheetsDeps) => (sheetsDeps = deps),
      setClaude: (factory: (apiKey: string) => ClaudeDeps) => (claudeFactory = factory),
      retryQueue: (interactive = false) => logger.retryPending(interactive),
    };
  }

  // Retry queued rows on browser start and every few minutes (never with a sign-in popup).
  chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_EVERY_MINUTES }));
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_EVERY_MINUTES });
    void logger.retryPending(false);
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) void logger.retryPending(false);
  });

  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'fill-page' && command !== 'log-posting') return;
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (target?.id == null) return;
    const tabId = target.id;
    await (command === 'fill-page' ? triggerFill(tabId) : openLogPanel(tabId)).catch((e) => flagOnIcon(tabId, explain(e)));
  });

  chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    switch (msg.type) {
      case 'open-log':
        openLogPanel(msg.tabId).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: explain(e) }));
        return true;
      case 'trigger-fill':
        triggerFill(msg.tabId, msg.overwrite).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: explain(e) }));
        return true;
      case 'frame-report':
        if (tabId == null) return;
        storeFrameReport(tabId, sender.frameId ?? 0, msg.report).then(() => sendResponse({ ok: true }));
        return true;
      case 'get-file':
        getFile(msg.kind).then((f) => {
          const res: FileMessage | null = f ? { name: f.name, mime: f.mime, base64: bytesToBase64(new Uint8Array(f.data)) } : null;
          sendResponse(res);
        });
        return true;
      case 'focus-field':
        if (tabId == null) return;
        chrome.tabs.sendMessage(tabId, { type: 'scroll-to', fieldId: msg.fieldId } satisfies ToContent, { frameId: msg.frameId }).catch(() => undefined);
        return;
      case 'save-answers':
        if (tabId == null) return;
        collectAndSaveAnswers(tabId).then(sendResponse, () => sendResponse({ saved: 0, found: 0, scanned: 0, unreachable: 1 } satisfies SaveAnswersResult));
        return true;
      case 'save-posting': {
        const target = msg.tabId ?? tabId;
        if (target == null) return;
        runSavePosting(target).then(sendResponse);
        return true;
      }
      case 'log-application':
        runLog(tabId, msg).then(sendResponse);
        return true;
      case 'test-sheets':
        testSheets().then(sendResponse);
        return true;
      case 'generate-answer':
        runGenerateAnswer(tabId, msg).then(sendResponse);
        return true;
      case 'cache-posting':
        cachePosting(chromeLocalStore, msg.posting.canonicalUrl, {
          title: msg.posting.title,
          company: msg.posting.company,
          descriptionMd: msg.posting.descriptionMd,
        }).then(() => sendResponse({ ok: true }));
        return true;
      case 'queue-retry': {
        const job = msg.id ? logger.retryOne(msg.id, { force: msg.force }) : logger.retryPending(true);
        job.then((r) => sendResponse(r));
        return true;
      }
      case 'queue-mark-synced':
        logger.markSynced(msg.id).then(() => sendResponse({ ok: true }));
        return true;
      case 'queue-discard':
        logger.discard(msg.id).then(() => sendResponse({ ok: true }));
        return true;
    }
  });
});
