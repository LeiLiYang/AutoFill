import { normalize } from '../detect/normalize';
import type { KeyValueStore } from '../profile/storage';
import type { FormAnswer } from './save';

const KEY = 'applicationAnswers';
const MAX_ENTRIES = 40;

type Store = Record<string, { answers: FormAnswer[]; savedAt: string }>;

/** Later readings replace earlier ones for the same question; questions no longer on screen are kept. */
export function mergeAnswers(earlier: FormAnswer[], later: FormAnswer[]): FormAnswer[] {
  const byQuestion = new Map<string, FormAnswer>();
  for (const a of [...earlier, ...later]) byQuestion.set(normalize(a.question), a);
  return [...byQuestion.values()];
}

export async function storedAnswers(kv: KeyValueStore, postingUrl: string): Promise<FormAnswer[]> {
  return (((await kv.get(KEY)) as Store | undefined) ?? {})[postingUrl]?.answers ?? [];
}

/**
 * Add what the form holds now to what was read from it before, per posting. An application spread
 * over several steps or pages only ever shows part of itself, so each reading is merged into the
 * record instead of replacing it. Returns the merged answers.
 */
export async function rememberAnswers(kv: KeyValueStore, postingUrl: string, answers: FormAnswer[], now = new Date()): Promise<FormAnswer[]> {
  const store = ((await kv.get(KEY)) as Store | undefined) ?? {};
  const merged = mergeAnswers(store[postingUrl]?.answers ?? [], answers);
  if (!answers.length) return merged;
  store[postingUrl] = { answers: merged, savedAt: now.toISOString() };
  const keep = Object.entries(store).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).slice(0, MAX_ENTRIES);
  await kv.set(KEY, Object.fromEntries(keep));
  return merged;
}
