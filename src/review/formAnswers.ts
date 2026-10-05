import type { FieldDescriptor } from '../adapters/types';
import { currentAnswerText } from '../detect/descriptor';
import type { FormAnswer } from '../posting/save';
import type { PriorRun } from './capture';

const SOURCE: Record<string, FormAnswer['source']> = {
  filled: 'autofill',
  'low-confidence': 'autofill',
  ai: 'ai',
  'skipped-existing': 'existing',
};

/**
 * Everything the form holds right now, with where each answer came from. The page is re-read at the
 * moment of saving, so edits made after the autofill (and fields on a later wizard step) are what get
 * recorded; an AI draft the user rewrote becomes "manual". File inputs list the file name.
 */
export function collectFormAnswers(fresh: FieldDescriptor[], prior: PriorRun | null): FormAnswer[] {
  const byElement = new Map<HTMLElement, { status: string; id: string }>();
  for (const r of prior?.reports ?? []) {
    const d = prior!.descriptors.get(r.id);
    if (d) byElement.set(d.element, { status: r.status, id: r.id });
  }

  const out: FormAnswer[] = [];
  for (const d of fresh) {
    const question = (d.label || d.nearbyText || d.name || '').trim();
    if (!question) continue;
    const answer = d.kind === 'file' ? ((d.element as HTMLInputElement).files?.[0]?.name ?? '') : currentAnswerText(d);
    if (!answer) continue;
    const seen = byElement.get(d.element);
    let source: FormAnswer['source'] = seen ? (SOURCE[seen.status] ?? 'manual') : 'manual';
    if (seen?.status === 'ai' && answer !== prior!.generated.get(seen.id)) source = 'manual';
    out.push({ question, answer, source });
  }
  return out;
}
