import { dice } from '../detect/fuzzy';
import { normalize } from '../detect/normalize';
import type { Answer } from '../profile/schema';

/** Words that carry no meaning for matching two questions. ("why/what/how" are kept: they change the question.) */
const STOP = new Set([
  'a', 'an', 'the', 'of', 'to', 'at', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'do', 'does', 'you', 'your',
  'we', 'us', 'our', 'here', 'this', 'that', 'with', 'it', 'be', 'can', 'will', 'would', 'please', 'tell', 'me',
  'about', 'us', 'describe', 'explain',
]);

/** At or above this a bank answer is trusted (green); between USABLE and this it is filled but flagged yellow. */
export const BANK_CONFIDENT = 0.92;
export const BANK_USABLE = 0.7;

const tokens = (s: string) => new Set(normalize(s).split(' ').filter((w) => w && !STOP.has(w)));

function overlap(a: Set<string>, b: Set<string>) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { jaccard: union ? inter / union : 0, containment: Math.min(a.size, b.size) ? inter / Math.min(a.size, b.size) : 0 };
}

/** How close a saved question is to a form question, 0..1. Tags count as extra phrasings of the question. */
export function questionSimilarity(question: string, entry: Pick<Answer, 'question' | 'tags'>): number {
  const q = normalize(question);
  if (!q) return 0;
  const phrasings = [entry.question, ...entry.tags];
  let best = 0;
  for (const p of phrasings) {
    const n = normalize(p);
    if (!n) continue;
    if (n === q) return 1;
    const { jaccard, containment } = overlap(tokens(question), tokens(p));
    const score = Math.max(0.6 * jaccard + 0.4 * containment, 0.5 * dice(q, n) + 0.5 * jaccard);
    // A tag is a short topic label ("why this company"), so being mostly contained in the question is enough.
    const isTag = p !== entry.question;
    best = Math.max(best, isTag && containment >= 0.66 ? Math.max(score, BANK_USABLE + 0.05) : score);
  }
  return Math.min(best, 0.99);
}

export interface BankMatch {
  entry: Answer;
  score: number;
}

/** The best saved answer for a question, or null when nothing is close enough to use. */
export function findAnswer(question: string, bank: Answer[]): BankMatch | null {
  let best: BankMatch | null = null;
  for (const entry of bank) {
    if (!entry.answer.trim()) continue;
    const score = questionSimilarity(question, entry);
    if (score >= BANK_USABLE && (!best || score > best.score)) best = { entry, score };
  }
  return best;
}

/**
 * Past answers to show the model as style examples: the most relevant ones, falling back to the
 * most recently written when none are related.
 */
export function styleSamples(question: string, bank: Answer[], max = 3): Answer[] {
  const usable = bank.filter((a) => a.answer.trim());
  const ranked = usable
    .map((entry) => ({ entry, score: questionSimilarity(question, entry) }))
    .filter((r) => r.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => r.entry);
  if (ranked.length) return ranked;
  return usable.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(2, max));
}
