import { rememberAnswers } from '../posting/answerStore';
import type { CachedPosting } from '../posting/cache';
import { buildAnswersJson, buildPostingMarkdown, postingFolder, type FormAnswer, type SavePostingResult } from '../posting/save';
import type { ExtractedPosting, ToContent } from '../messaging/protocol';
import type { KeyValueStore } from '../profile/storage';
import { downloadBlob, downloadText, type DownloadedFile } from './downloads';

export interface SaveDeps {
  /** Put the content script in the top frame and every frame that can be reached. */
  injectAll(tabId: number): Promise<void>;
  /** Frames of the tab that have the content script running. */
  frames(tabId: number): Promise<number[]>;
  kv: KeyValueStore;
  /** The posting read earlier for this application, when this page is only its form. */
  postingForForm?(tabId: number, form: ExtractedPosting): Promise<CachedPosting | null>;
  /** Resolves once a fill that is still running in the tab has finished. */
  whenIdle?(tabId: number): Promise<void>;
  now?: () => Date;
}

const ask = <T>(tabId: number, frameId: number, msg: ToContent) =>
  chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => undefined) as Promise<T | undefined>;

/** What every reachable frame's form holds right now. */
export async function collectFormAnswers(tabId: number, frameIds: number[]): Promise<FormAnswer[]> {
  const answers: FormAnswer[] = [];
  for (const frameId of frameIds) {
    const r = await ask<{ answers: FormAnswer[] }>(tabId, frameId, { type: 'collect-form-answers' });
    answers.push(...(r?.answers ?? []));
  }
  return answers;
}

/**
 * Save the posting for `tabId` under Downloads/AutoFill/{Company}/{date} {Title}/:
 * posting.mhtml (full snapshot), posting.md (clean description), answers.json (what the form holds).
 *
 * The answers are read from the page at this moment, from every frame, and merged with what was
 * read at earlier fills of the same application (earlier steps of a wizard are no longer on screen).
 * On a page that is only the application form, the description comes from the posting page if the
 * extension read it earlier; the answers are saved either way.
 */
export async function savePosting(tabId: number, deps: SaveDeps): Promise<SavePostingResult> {
  try {
    await deps.whenIdle?.(tabId);
    await deps.injectAll(tabId);
    const res = await ask<{ posting: ExtractedPosting }>(tabId, 0, { type: 'extract-posting' });
    if (!res?.posting) return { ok: false, code: 'no-page', message: 'Could not read this page. Reload it and try again.' };
    let posting = res.posting;
    const warnings: string[] = [];

    if (posting.formOnly) {
      // Any text scraped here comes from the form, not the posting.
      const earlier = await deps.postingForForm?.(tabId, posting);
      if (earlier) {
        posting = {
          ...posting,
          title: earlier.title || posting.title,
          company: earlier.company || posting.company,
          location: earlier.location || posting.location,
          salary: earlier.salary || posting.salary,
          descriptionMd: earlier.descriptionMd,
        };
        warnings.push('This is the application form: posting.mhtml is a snapshot of the form, and the description in posting.md was read earlier on the posting page.');
      } else {
        posting = { ...posting, descriptionMd: '' };
        warnings.push('This is the application form, so posting.md has no job description. Open the job posting page and save again to add it.');
      }
    }

    const live = await collectFormAnswers(tabId, await deps.frames(tabId));
    const date = (deps.now ?? (() => new Date()))();
    const answers = await rememberAnswers(deps.kv, posting.canonicalUrl, live, date);

    const folder = postingFolder(posting, date);
    const files: DownloadedFile[] = [];

    // The snapshot is the most failure-prone (restricted pages, size): do not let it block the others.
    // Page capture can fail transiently (the tab is busy or another capture is finishing): try twice.
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const mhtml = await chrome.pageCapture.saveAsMHTML({ tabId });
        if (!mhtml) throw new Error('Chrome returned no snapshot');
        files.push(await downloadBlob(`${folder}/posting.mhtml`, mhtml, 'multipart/related'));
        lastError = '';
        break;
      } catch (e) {
        lastError = (e as Error).message;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (lastError) warnings.push(`posting.mhtml was not saved: ${lastError}`);
    files.push(await downloadText(`${folder}/posting.md`, buildPostingMarkdown(posting, date), 'text/markdown'));
    files.push(await downloadText(`${folder}/answers.json`, buildAnswersJson(posting, answers, date), 'application/json'));

    return { ok: true, folder, files, warnings };
  } catch (e) {
    return { ok: false, code: 'error', message: (e as Error).message };
  }
}
