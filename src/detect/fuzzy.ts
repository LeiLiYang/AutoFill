import { normalize } from './normalize';

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  const total = [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return (2 * overlap) / total;
}

/** Optimal-string-alignment distance (Levenshtein plus adjacent transpositions). */
function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * Typo tolerance: same number of words, each word equal or within one edit (words of 4+ letters
 * only, so "last" never matches "fast"). Returns 0.85 for a typo match, 1 for exact, else 0.
 */
export function typoScore(a: string, b: string): number {
  const x = normalize(a).split(' ');
  const y = normalize(b).split(' ');
  if (x.length !== y.length || !x[0]) return 0;
  let edits = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (x[i]!.length < 4 || y[i]!.length < 4 || osaDistance(x[i]!, y[i]!) > 1) return 0;
    edits++;
  }
  return edits === 0 ? 1 : edits === 1 ? 0.85 : 0;
}

/** Fuzzy similarity of a label to a synonym: the better of bigram Dice and typo tolerance. */
export function fuzzyScore(a: string, b: string): number {
  return Math.max(dice(a, b), typoScore(a, b));
}

/**
 * Score how well `text` equals/contains `target` as whole words (0..1).
 * Used for picking options: exact > word-prefix > word-contained > fuzzy.
 */
export function optionScore(text: string, target: string): number {
  const o = normalize(text);
  const t = normalize(target);
  if (!o || !t) return 0;
  if (o === t) return 1;
  if (o.startsWith(`${t} `) || t.startsWith(`${o} `)) return 0.9;
  if (` ${o} `.includes(` ${t} `) || ` ${t} `.includes(` ${o} `)) return 0.75;
  const d = dice(o, t);
  return d >= 0.85 ? 0.6 + (d - 0.85) : 0;
}
