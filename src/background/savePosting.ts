import { buildAnswersJson, buildPostingMarkdown, postingFolder, type FormAnswer, type SavePostingResult } from '../posting/save';
import type { ExtractedPosting, FrameReport, ToContent } from '../messaging/protocol';
import { downloadBlob, downloadText, type DownloadedFile } from './downloads';

export interface SaveDeps {
  /** Make sure the content script is present in the top frame (and answer frames). */
  ensureInjected(tabId: number): Promise<void>;
  /** Frames that reported fields during the last fill (empty if the user never filled). */
  getFrames(tabId: number): Promise<FrameReport[]>;
  now?: () => Date;
}

const ask = <T>(tabId: number, frameId: number, msg: ToContent) =>
  chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => undefined) as Promise<T | undefined>;

/**
 * Save the posting for `tabId` under Downloads/AutoFill/{Company}/{date} {Title}/:
 * posting.mhtml (full snapshot), posting.md (clean description), answers.json (what the form holds).
 * Refuses on application-form-only pages, where the description is not available.
 */
export async function savePosting(tabId: number, deps: SaveDeps): Promise<SavePostingResult> {
  try {
    await deps.ensureInjected(tabId);
    const res = await ask<{ posting: ExtractedPosting }>(tabId, 0, { type: 'extract-posting' });
    if (!res?.posting) return { ok: false, code: 'no-page', message: 'Could not read this page. Reload it and try again.' };
    const posting = res.posting;

    // formOnly is set from the platform's apply-URL pattern, or from "a form and no real description".
    // Either way any text we scraped here comes from the form, not the posting.
    if (posting.formOnly) {
      return {
        ok: false,
        code: 'form-only',
        message: 'This looks like the application form, and the job description is on a different page. Open the job posting page and use Save posting there.',
      };
    }

    const answers: FormAnswer[] = [];
    for (const f of await deps.getFrames(tabId)) {
      if (f.frameId == null) continue;
      const r = await ask<{ answers: FormAnswer[] }>(tabId, f.frameId, { type: 'collect-form-answers' });
      answers.push(...(r?.answers ?? []));
    }

    const date = (deps.now ?? (() => new Date()))();
    const folder = postingFolder(posting, date);
    const files: DownloadedFile[] = [];
    const warnings: string[] = [];

    // The snapshot is the most failure-prone (restricted pages, size): do not let it block the others.
    try {
      const mhtml = await chrome.pageCapture.saveAsMHTML({ tabId });
      if (!mhtml) throw new Error('Chrome returned no snapshot');
      files.push(await downloadBlob(`${folder}/posting.mhtml`, mhtml, 'multipart/related'));
    } catch (e) {
      warnings.push(`posting.mhtml was not saved: ${(e as Error).message}`);
    }
    files.push(await downloadText(`${folder}/posting.md`, buildPostingMarkdown(posting, date), 'text/markdown'));
    files.push(await downloadText(`${folder}/answers.json`, buildAnswersJson(posting, answers, date), 'application/json'));

    return { ok: true, folder, files, warnings };
  } catch (e) {
    return { ok: false, code: 'error', message: (e as Error).message };
  }
}
