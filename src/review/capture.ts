import type { FieldDescriptor, FieldReport } from '../adapters/types';
import { currentAnswerText } from '../detect/descriptor';
import type { CapturedAnswer } from '../messaging/protocol';

const MIN_QUESTION_CHARS = 4;
const NOT_OURS = new Set(['unmatched', 'no-data', 'failed']);

/**
 * Questions the user answered by hand: fields we did not fill that now hold an answer, plus AI drafts
 * the user rewrote (an untouched AI draft is not "their" answer, so it is never saved as a style
 * sample). Consent-style checkboxes and file inputs are never captured.
 */
export function captureAnswers(
  descriptors: Map<string, FieldDescriptor>,
  reports: FieldReport[],
  generated: Map<string, string> = new Map(),
): CapturedAnswer[] {
  const out: CapturedAnswer[] = [];
  for (const r of reports) {
    const editedDraft = r.status === 'ai';
    if (!NOT_OURS.has(r.status) && !editedDraft) continue;
    const d = descriptors.get(r.id);
    if (!d || d.kind === 'file' || d.kind === 'checkbox') continue;
    const question = d.label.trim();
    if (question.length < MIN_QUESTION_CHARS) continue;
    const answer = currentAnswerText(d);
    if (!answer) continue;
    if (editedDraft && answer === generated.get(r.id)) continue;
    out.push({ question, answer });
  }
  return out;
}
