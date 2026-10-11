import type { FieldDescriptor, Match } from '../adapters/types';
import { MATCH_RULES, type MatchRule } from '../config/matchRules';
import { fuzzyScore } from './fuzzy';
import { attrWords, normalize } from './normalize';

export const CONFIDENCE = {
  hint: 0.98,
  autocomplete: 0.97,
  attrs: 0.95,
  label: 0.85,
  nearby: 0.6,
  fuzzyMax: 0.65,
} as const;

/** Labels longer than this are questions, not field names: never fuzzy-match them. */
const FUZZY_MAX_LABEL_CHARS = 40;
const FUZZY_THRESHOLD = 0.8;

function ruleApplies(rule: MatchRule, d: FieldDescriptor): boolean {
  return rule.only ? d.kind === 'file' : d.kind !== 'file';
}

function attrCandidates(d: FieldDescriptor): { text: string; isAutocomplete: boolean }[] {
  const out: { text: string; isAutocomplete: boolean }[] = [];
  if (d.autocomplete) {
    for (const tok of d.autocomplete.split(/\s+/)) {
      if (tok && !/^(on|off|section-.*|shipping|billing|home|work|mobile|fax|pager)$/.test(tok))
        out.push({ text: attrWords(tok), isAutocomplete: true });
    }
  }
  for (const v of [d.name, d.htmlId, d.automationId, d.testId]) {
    if (v) out.push({ text: attrWords(v), isAutocomplete: false });
  }
  return out;
}

function labelCandidates(d: FieldDescriptor): string[] {
  return [d.label, d.ariaLabel, d.placeholder].map(normalize).filter(Boolean);
}

export function matchField(d: FieldDescriptor, rules: MatchRule[] = MATCH_RULES): Match | null {
  if (d.hintedKey) return { key: d.hintedKey, confidence: CONFIDENCE.hint, rule: 'adapter-hint' };

  const attrs = attrCandidates(d);
  const labels = labelCandidates(d);
  const applicable = rules.filter((r) => ruleApplies(r, d));
  const blockedBy = (r: MatchRule) =>
    !!r.not && (labels.some((l) => r.not!.test(l)) || attrs.some((a) => r.not!.test(a.text)));

  // Stage 1: exact attributes (autocomplete, name, id, data-automation-id).
  for (const r of applicable) {
    if (!r.attrs || blockedBy(r)) continue;
    const hit = attrs.find((a) => r.attrs!.test(a.text));
    if (hit) {
      return {
        key: r.key,
        confidence: hit.isAutocomplete ? CONFIDENCE.autocomplete : CONFIDENCE.attrs,
        rule: `attrs:${r.key}`,
      };
    }
  }

  // Stage 2: normalized label / aria-label / placeholder.
  for (const r of applicable) {
    if (!r.label || blockedBy(r)) continue;
    if (labels.some((l) => r.label!.test(l))) {
      return { key: r.key, confidence: CONFIDENCE.label, rule: `label:${r.key}` };
    }
  }

  // Stage 2b: nearby text only (weaker evidence). It exists only for fields with no label of their own.
  if (d.nearbyText) {
    const near = normalize(d.nearbyText);
    for (const r of applicable) {
      if (r.label && !blockedBy(r) && r.label.test(near)) {
        return { key: r.key, confidence: CONFIDENCE.nearby, rule: `nearby:${r.key}` };
      }
    }
  }

  // Stage 3: fuzzy match against rule synonyms, short labels only.
  let best: { key: MatchRule['key']; score: number } | null = null;
  for (const l of labels) {
    if (l.length > FUZZY_MAX_LABEL_CHARS) continue;
    for (const r of applicable) {
      if (!r.synonyms?.length || blockedBy(r)) continue;
      for (const s of r.synonyms) {
        const score = fuzzyScore(l, s);
        if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { key: r.key, score };
      }
    }
  }
  if (best) {
    // Fuzzy matches span 0.5..fuzzyMax: always fillable, always yellow (needs review).
    const conf = 0.5 + ((best.score - FUZZY_THRESHOLD) / (1 - FUZZY_THRESHOLD)) * (CONFIDENCE.fuzzyMax - 0.5);
    return { key: best.key, confidence: Math.min(conf, CONFIDENCE.fuzzyMax), rule: `fuzzy:${best.key}` };
  }

  // Open-ended textareas are free-text questions.
  if (d.kind === 'textarea') return { key: 'freeText', confidence: 0.3, rule: 'textarea' };
  return null;
}
