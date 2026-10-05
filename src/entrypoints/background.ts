import { savePosting } from '../background/savePosting';
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
  type ToBackground,
  type ToContent,
} from '../messaging/protocol';
import { chromeSheetsDeps } from '../tracking/auth';
import { createLogger } from '../tracking/queue';
import type { SheetsDeps } from '../tracking/sheets';

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

async function pushPanel(tabId: number, filling: boolean) {
  await toTopFrame(tabId, { type: 'panel-update', frames: await getReports(tabId), filling });
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

  let frameIds: number[];
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
    frameIds = results.map((r) => r.frameId);
  } catch {
    // Some frames (cross-origin without host permission) are not injectable: fall back to the top frame.
    const results = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    frameIds = results.map((r) => r.frameId);
  }

  const msg: ToContent = { type: 'run-fill', overwrite };
  await Promise.allSettled(frameIds.map((frameId) => chrome.tabs.sendMessage(tabId, msg, { frameId })));
  await enqueue(tabId, () => pushPanel(tabId, false));
}

function storeFrameReport(tabId: number, frameId: number, report: FrameReport) {
  return enqueue(tabId, async () => {
    const cur = await getReports(tabId);
    const next = [...cur.filter((r) => r.frameId !== frameId), { ...report, frameId }];
    await chrome.storage.session.set({ [reportsKey(tabId)]: next });
    await pushPanel(tabId, true);
  });
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

async function collectAndSaveAnswers(tabId: number): Promise<number> {
  const collected: CapturedAnswer[] = [];
  for (const f of await getReports(tabId)) {
    if (f.frameId == null) continue;
    const msg: ToContent = { type: 'collect-answers' };
    const res = (await chrome.tabs.sendMessage(tabId, msg, { frameId: f.frameId }).catch(() => null)) as { answers: CapturedAnswer[] } | null;
    collected.push(...(res?.answers ?? []));
  }
  return saveAnswers(collected);
}

/** Inject the content script into the top frame only (idempotent: it guards against double install). */
const ensureInjected = (tabId: number) =>
  chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] }).then(() => undefined);

const runSavePosting = (tabId: number) => savePosting(tabId, { ensureInjected, getFrames: getReports });

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
      savePosting: runSavePosting,
      setSheets: (deps: SheetsDeps) => (sheetsDeps = deps),
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
    if (command !== 'fill-page') return;
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (target?.id != null) await triggerFill(target.id);
  });

  chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    switch (msg.type) {
      case 'trigger-fill':
        triggerFill(msg.tabId, msg.overwrite).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
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
        collectAndSaveAnswers(tabId).then((saved) => sendResponse({ saved }), () => sendResponse({ saved: 0 }));
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
