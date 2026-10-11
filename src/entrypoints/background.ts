import { collectFormAnswers, savePosting } from '../background/savePosting';
import { describeLlmError, sdkDeps, type AnswerResult, type ClaudeDeps } from '../llm/client';
import { llmConfig, notReadyReason } from '../llm/config';
import { classifyFields } from '../llm/classifyFields';
import { draftKey, getDraft, saveDraft } from '../llm/draftCache';
import { makeClient } from '../llm/providers';
import type { Fetch } from '../llm/providers/types';
import { answerQuestion } from '../llm/answerQuestion';
import { rememberAnswers } from '../posting/answerStore';
import { cachePosting, findCachedPosting, getCachedPosting, type CachedPosting } from '../posting/cache';
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
  type SavePostingResult,
  type TestLlmResult,
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

/** Fills still running, by tab: saving waits for them so it records the answers the fill is about to write. */
const fillsRunning = new Map<number, Promise<unknown>>();

/** Inject the filler into every reachable frame of the tab, then ask each frame to fill. User-triggered only. */
function triggerFill(tabId: number, overwriteOverride?: boolean): Promise<void> {
  const run = runFillInTab(tabId, overwriteOverride).finally(() => {
    if (fillsRunning.get(tabId) === run) fillsRunning.delete(tabId);
  });
  fillsRunning.set(tabId, run);
  return run;
}

async function runFillInTab(tabId: number, overwriteOverride?: boolean) {
  const settings = await loadSettings();
  const overwrite = overwriteOverride ?? settings.overwrite;
  await enqueue(tabId, () => chrome.storage.session.set({ [reportsKey(tabId)]: [] }));
  postingMemo.delete(tabId); // the tab may show a different posting than at the last fill

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
  // Record what this step of the form now holds: a later step, or a save from another page, adds to it.
  await recordAnswers(tabId, frameIds).catch(() => undefined);
}

async function recordAnswers(tabId: number, frameIds: number[]) {
  const page = await postingFor(tabId);
  if (page) await rememberAnswers(chromeLocalStore, page.canonicalUrl, await collectFormAnswers(tabId, frameIds));
}

const lastPostingKey = (tabId: number) => `lastPosting:${tabId}`;
const EARLIER_POSTING_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.');
  } catch {
    return '';
  }
};

/**
 * The posting an application form belongs to. The form's own address usually maps back to the
 * posting's (same canonical URL). When it does not (an in-house site, or a form hosted by another
 * company's ATS), use the posting last read in this tab or the tab that opened it, but only if it is
 * recent and is the same company or the same site: never another employer's description.
 */
async function earlierPosting(tabId: number | undefined, canonicalUrl: string, company: string): Promise<CachedPosting | null> {
  const direct = await getCachedPosting(chromeLocalStore, canonicalUrl);
  if (direct || tabId == null) return direct;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  for (const id of [tabId, tab?.openerTabId]) {
    if (id == null) continue;
    const key = lastPostingKey(id);
    const last = ((await chrome.storage.session.get(key))[key] ?? null) as { url: string; at: number } | null;
    if (!last || Date.now() - last.at > EARLIER_POSTING_MAX_AGE_MS) continue;
    const hit = await findCachedPosting(
      chromeLocalStore,
      (url, p) => url === last.url && (siteOf(url) === siteOf(canonicalUrl) || (!!company && normalize(p.company) === normalize(company))),
    );
    if (hit) return hit;
  }
  return null;
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

/** Inject into every frame that can be reached (some cannot: sandboxed, or a browser page). */
async function injectAllFrames(tabId: number) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
  } catch {
    await ensureInjected(tabId);
  }
}

const runSavePosting = (tabId: number) =>
  savePosting(tabId, {
    injectAll: injectAllFrames,
    frames: framesWithExtension,
    kv: chromeLocalStore,
    postingForForm: (id, form) => earlierPosting(id, form.canonicalUrl, form.company),
    whenIdle: async (id) => void (await fillsRunning.get(id)?.catch(() => undefined)),
  });

/** The Anthropic client factory and `fetch` are swappable so end-to-end tests never call a real API. */
let claudeFactory: (apiKey: string) => ClaudeDeps = sdkDeps;
let llmFetch: Fetch = (input, init) => fetch(input, init);
const llmClient = (config: Parameters<typeof makeClient>[0]) => makeClient(config, { claude: (key) => claudeFactory(key), fetch: (i, n) => llmFetch(i, n) });

/** Settings page: check the key works and list the models it can use. Sends no prompt, costs nothing. */
async function testLlm(): Promise<TestLlmResult> {
  const config = llmConfig(await loadSettings());
  if (!config.ready && !(config.provider !== 'anthropic' && !config.model && (config.apiKey || config.baseUrl))) {
    return { ok: false, message: `${notReadyReason(config)} Save your settings first.` };
  }
  try {
    const models = await llmClient(config).listModels();
    return { ok: true, models, label: config.label };
  } catch (e) {
    return { ok: false, message: describeLlmError(e, config.label, config.model).message };
  }
}

interface PagePosting {
  canonicalUrl: string;
  posting: { title: string; company: string; descriptionMd?: string };
}

/** The job description for the page the form is on: from the page itself, else cached by canonical URL. */
async function readPosting(tabId: number): Promise<PagePosting | null> {
  const res = (await chrome.tabs.sendMessage(tabId, { type: 'extract-posting' } satisfies ToContent, { frameId: 0 }).catch(() => undefined)) as
    | { posting: import('../messaging/protocol').ExtractedPosting }
    | undefined;
  const p = res?.posting;
  if (!p) return null;
  if (!p.formOnly && p.descriptionMd.length >= 200) {
    return { canonicalUrl: p.canonicalUrl, posting: { title: p.title, company: p.company, descriptionMd: p.descriptionMd } };
  }
  const cached = await earlierPosting(tabId, p.canonicalUrl, p.company);
  return { canonicalUrl: p.canonicalUrl, posting: cached ?? { title: p.title, company: p.company } };
}

/** One fill asks about the same page once per question: read it once and reuse it for a few seconds. */
const POSTING_MEMO_MS = 20_000;
const postingMemo = new Map<number, { at: number; value: Promise<PagePosting | null> }>();
function postingFor(tabId: number): Promise<PagePosting | null> {
  const hit = postingMemo.get(tabId);
  if (hit && Date.now() - hit.at < POSTING_MEMO_MS) return hit.value;
  const value = readPosting(tabId);
  postingMemo.set(tabId, { at: Date.now(), value });
  return value;
}

async function runGenerateAnswer(tabId: number | undefined, msg: Extract<ToBackground, { type: 'generate-answer' }>): Promise<AnswerResult> {
  const page = tabId == null ? null : await postingFor(tabId);
  const config = llmConfig(await loadSettings());
  const maxLength = msg.maxLength && msg.maxLength > 0 ? msg.maxLength : undefined;
  // A draft already written for this question on this posting is reused, unless the user asked to overwrite.
  const key = page && config.ready ? draftKey(page.canonicalUrl, msg.question, config.model, maxLength) : null;
  if (key && !msg.fresh) {
    const draft = await getDraft(chromeLocalStore, key);
    if (draft) return { ok: true, text: draft };
  }
  const result = await answerQuestion(
    { loadProfile, loadSettings, getPosting: async () => page?.posting ?? null, llm: llmClient },
    { question: msg.question, maxLength },
  );
  if (key && result.ok) await saveDraft(chromeLocalStore, key, result.text);
  return result;
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

/**
 * The user confirmed the log card: write the row. Always answers, even when something unexpected
 * throws, so the card can say what went wrong instead of silently going back to idle. Saving the
 * posting is a separate request the card makes afterwards: a slow or failed save cannot hide the log.
 */
async function runLog(msg: Extract<ToBackground, { type: 'log-application' }>): Promise<LogApplicationResponse> {
  try {
    return { log: await logger.logApplication(msg.entry, { force: msg.force }) };
  } catch (e) {
    return { log: { ok: false, code: 'error', message: `Could not log this application: ${(e as Error)?.message ?? String(e)}` } };
  }
}

const LOG_MENU_ID = 'log-posting';
/** Right-click → "Log this posting": the same card as the popup button and Alt+Shift+L. */
function createLogMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: LOG_MENU_ID, title: 'Log this posting', contexts: ['all'] }, () => void chrome.runtime.lastError);
  });
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
      setLlmFetch: (f: Fetch) => (llmFetch = f),
      retryQueue: (interactive = false) => logger.retryPending(interactive),
    };
  }

  // Retry queued rows on browser start and every few minutes (never with a sign-in popup).
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_EVERY_MINUTES });
    createLogMenu();
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== LOG_MENU_ID || tab?.id == null) return;
    const tabId = tab.id;
    void openLogPanel(tabId).catch((e) => flagOnIcon(tabId, explain(e)));
  });
  chrome.runtime.onStartup.addListener(() => {
    createLogMenu();
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
        runSavePosting(target).then(sendResponse, (e) => sendResponse({ ok: false, code: 'error', message: String(e) } satisfies SavePostingResult));
        return true;
      }
      case 'log-application':
        runLog(msg).then(sendResponse);
        return true;
      case 'test-sheets':
        testSheets().then(sendResponse);
        return true;
      case 'test-llm':
        testLlm().then(sendResponse);
        return true;
      case 'generate-answer':
        runGenerateAnswer(tabId, msg).then(sendResponse);
        return true;
      case 'classify-fields':
        loadSettings()
          .then((s) => classifyFields({ llm: llmClient, kv: chromeLocalStore }, llmConfig(s), msg.host, msg.fields))
          .then(sendResponse, () => sendResponse({}));
        return true;
      case 'cache-posting':
        cachePosting(chromeLocalStore, msg.posting.canonicalUrl, {
          title: msg.posting.title,
          company: msg.posting.company,
          descriptionMd: msg.posting.descriptionMd,
          location: msg.posting.location,
          salary: msg.posting.salary,
        })
          // Remember which posting this tab was on: its application form may live at an unrelated address.
          .then(() => (tabId == null ? undefined : chrome.storage.session.set({ [lastPostingKey(tabId)]: { url: msg.posting.canonicalUrl, at: Date.now() } })))
          .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      case 'earlier-posting':
        earlierPosting(tabId, msg.canonicalUrl, msg.company).then(
          (p) => sendResponse(p ? { title: p.title, location: p.location } : null),
          () => sendResponse(null),
        );
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
