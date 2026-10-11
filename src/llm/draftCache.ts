import { normalize } from '../detect/normalize';
import type { KeyValueStore } from '../profile/storage';

interface Draft {
  text: string;
  savedAt: string;
}

const KEY = 'answerDrafts';
const MAX_ENTRIES = 200;
const MAX_AGE_DAYS = 30;

type Drafts = Record<string, Draft>;

/**
 * AI drafts by posting and question. Filling the same application again (a second click, the next
 * wizard step, a reload) reuses the draft instead of paying for a new one. The model is part of the
 * key, so changing it gets fresh answers.
 */
export const draftKey = (postingUrl: string, question: string, model: string, maxChars?: number) =>
  [postingUrl, normalize(question), model, maxChars ?? ''].join('|');

export async function getDraft(kv: KeyValueStore, key: string, now = new Date()): Promise<string | null> {
  const hit = (((await kv.get(KEY)) as Drafts | undefined) ?? {})[key];
  if (!hit) return null;
  const ageDays = (now.getTime() - new Date(hit.savedAt).getTime()) / 86_400_000;
  return ageDays <= MAX_AGE_DAYS ? hit.text : null;
}

export async function saveDraft(kv: KeyValueStore, key: string, text: string, now = new Date()): Promise<void> {
  const drafts = ((await kv.get(KEY)) as Drafts | undefined) ?? {};
  drafts[key] = { text, savedAt: now.toISOString() };
  const keep = Object.entries(drafts).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).slice(0, MAX_ENTRIES);
  await kv.set(KEY, Object.fromEntries(keep));
}
