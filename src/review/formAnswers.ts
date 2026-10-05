import type { FieldDescriptor, FieldReport } from '../adapters/types';
import { currentAnswerText } from '../detect/descriptor';
import type { FormAnswer } from '../posting/save';

const SOURCE: Record<string, FormAnswer['source']> = {
  filled: 'autofill',
  'low-confidence': 'autofill',
  ai: 'ai',
  'skipped-existing': 'existing',
};

/**
 * Everything the form holds right now, with where each answer came from. Read live from the DOM
 * so edits the user made after the autofill are what gets recorded. File inputs list the file name.
 */
export function collectFormAnswers(descriptors: Map<string, FieldDescriptor>, reports: FieldReport[]): FormAnswer[] {
  const out: FormAnswer[] = [];
  for (const r of reports) {
    const d = descriptors.get(r.id);
    if (!d) continue;
    const question = (d.label || d.nearbyText || d.name || '').trim();
    if (!question) continue;
    const answer =
      d.kind === 'file' ? ((d.element as HTMLInputElement).files?.[0]?.name ?? '') : currentAnswerText(d);
    if (!answer) continue;
    out.push({ question, answer, source: SOURCE[r.status] ?? 'manual' });
  }
  return out;
}
