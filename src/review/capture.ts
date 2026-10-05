import type { FieldDescriptor, FieldReport } from '../adapters/types';
import { currentAnswerText } from '../detect/descriptor';
import { matchField } from '../detect/match';
import type { CapturedAnswer } from '../messaging/protocol';

const MIN_QUESTION_CHARS = 4;
/** Statuses where the extension itself put the value there (so it is not the user's own answer). */
const OURS = new Set(['filled', 'low-confidence', 'skipped-existing']);

/** What the last fill saw, keyed by the live element so it survives re-scanning the page. */
export interface PriorRun {
  descriptors: Map<string, FieldDescriptor>;
  reports: FieldReport[];
  /** id → text the model wrote. */
  generated: Map<string, string>;
}

export interface CaptureResult {
  answers: CapturedAnswer[];
  /** Fields looked at, so the panel can say what it checked when nothing qualified. */
  scanned: number;
}

/**
 * Questions the user answered by hand, found by looking at the page *now* (not at what the last fill
 * saw, so a wizard's next step or a field added later is covered). A field counts when:
 *  - it holds an answer, and the question has a readable label;
 *  - it is a question rather than profile data: the matcher has no profile key for it
 *    (unrecognised, or an open-ended text question), so typing a missing address is not "an answer";
 *  - the extension did not put that value there itself. An AI draft counts only once the user rewrote it.
 * File inputs and checkboxes are never captured.
 */
export function captureAnswers(fresh: FieldDescriptor[], prior: PriorRun | null): CaptureResult {
  const byElement = new Map<HTMLElement, { report: FieldReport; id: string }>();
  for (const r of prior?.reports ?? []) {
    const d = prior!.descriptors.get(r.id);
    if (d) byElement.set(d.element, { report: r, id: r.id });
  }

  const answers: CapturedAnswer[] = [];
  for (const d of fresh) {
    if (d.kind === 'file' || d.kind === 'checkbox') continue;
    const seen = byElement.get(d.element);
    const key = seen?.report.key ?? matchField(d)?.key;
    if (key && key !== 'freeText') continue; // profile data, not a question

    const question = d.label.trim();
    if (question.length < MIN_QUESTION_CHARS) continue;
    const answer = currentAnswerText(d);
    if (!answer) continue;

    if (seen) {
      if (OURS.has(seen.report.status)) continue;
      if (seen.report.status === 'ai' && answer === prior!.generated.get(seen.id)) continue;
    }
    answers.push({ question, answer });
  }
  return { answers, scanned: fresh.length };
}
