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
 * Split pasted text into separate answers. A line of "---" or a blank line ends one answer, but a
 * blank line inside a long answer is kept when answers are fenced with "---".
 */
export function splitSamples(pasted: string): string[] {
  const text = pasted.replace(/\r\n/g, '\n').trim();
  const parts = /^\s*-{3,}\s*$/m.test(text) ? text.split(/^\s*-{3,}\s*$/m) : text.split(/\n\s*\n/);
  return parts.map((p) => p.trim()).filter((p) => p.length >= 20);
}

/** Answer-bank entries (no question) for pasted text. */
export function samplesFromPaste(pasted: string, now: Date = new Date(), uuid: () => string = () => crypto.randomUUID()): Answer[] {
  return splitSamples(pasted).map((answer) => ({ id: uuid(), question: '', answer, tags: [], updatedAt: now.toISOString() }));
}

/** Writing samples saved without a question: they show who the applicant is rather than answer something. */
export const isSample = (a: Answer) => !a.question.trim();

/** How many writing samples go with one question, and the cap on any single sample or past answer. */
const BACKGROUND_MAX = 3;
const BACKGROUND_EACH = 1500;
const PAST_ANSWER_EACH = 1200;

export interface PromptSamples {
  /** Past question/answer pairs most related to this question: style and content examples. */
  qa: Answer[];
  /** Answers saved without a question: background on the applicant's interests, experience and voice. */
  background: Answer[];
}

/** Share of the question's meaningful words that a writing sample also uses. */
function sampleRelevance(question: Set<string>, sample: string): number {
  if (!question.size) return 0;
  const words = tokens(sample);
  return [...question].filter((w) => words.has(w)).length / question.size;
}

/**
 * What to show the model besides the profile, kept small on purpose: every sample is paid for on
 * every question. Writing samples (saved without a question) are ranked by how much they share
 * with the question and the best few are sent; with nothing to rank on, the newest stand in so the
 * model still hears the applicant's voice. Past answers are sent only when they relate to the
 * question, except that one recent answer stands in when there is no other writing to learn from.
 */
export function styleSamples(question: string, bank: Answer[], max = 3): PromptSamples {
  const usable = bank.filter((a) => a.answer.trim());
  const byNewest = (a: Answer, b: Answer) => b.updatedAt.localeCompare(a.updatedAt);

  const asked = tokens(question);
  const background = usable
    .filter(isSample)
    .map((entry) => ({ entry, score: sampleRelevance(asked, entry.answer) }))
    .sort((a, b) => b.score - a.score || byNewest(a.entry, b.entry))
    .slice(0, BACKGROUND_MAX)
    .map(({ entry }) => ({ ...entry, answer: entry.answer.trim().slice(0, BACKGROUND_EACH) }));

  const withQuestion = usable.filter((a) => !isSample(a));
  const related = withQuestion
    .map((entry) => ({ entry, score: questionSimilarity(question, entry) }))
    .filter((r) => r.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => r.entry);
  const qa = related.length || background.length ? related : withQuestion.sort(byNewest).slice(0, 1);
  return { qa: qa.map((e) => ({ ...e, answer: e.answer.trim().slice(0, PAST_ANSWER_EACH) })), background };
}
