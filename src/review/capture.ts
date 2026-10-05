import type { FieldDescriptor, FieldReport } from '../adapters/types';
import { currentAnswerText } from '../detect/descriptor';
import type { CapturedAnswer } from '../messaging/protocol';

const MIN_QUESTION_CHARS = 4;
const NOT_OURS = new Set(['unmatched', 'no-data', 'failed']);

/**
 * Questions the user answered by hand: fields we did not fill that now hold an answer.
 * Consent-style checkboxes and file inputs are never captured.
 */
export function captureAnswers(
  descriptors: Map<string, FieldDescriptor>,
  reports: FieldReport[],
): CapturedAnswer[] {
  const out: CapturedAnswer[] = [];
  for (const r of reports) {
    if (!NOT_OURS.has(r.status)) continue;
    const d = descriptors.get(r.id);
    if (!d || d.kind === 'file' || d.kind === 'checkbox') continue;
    const question = d.label.trim();
    if (question.length < MIN_QUESTION_CHARS) continue;
    const answer = currentAnswerText(d);
    if (answer) out.push({ question, answer });
  }
  return out;
}
