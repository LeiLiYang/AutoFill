import type {
  AdapterContext,
  FieldDescriptor,
  FieldReport,
  FillOptions,
  FillStatus,
  Match,
  PlatformAdapter,
  ProfileKey,
} from '../adapters/types';
import { hasValue } from '../detect/descriptor';
import { matchField } from '../detect/match';
import { resolveValue } from '../detect/values';
import { BANK_CONFIDENT } from '../llm/answerBank';
import type { Profile } from '../profile/schema';

/** Matches below this are listed for the user but never written into the form. */
export const MIN_FILL_CONFIDENCE = 0.5;
/** Fills at or above this are green; anything lower is yellow. */
export const HIGH_CONFIDENCE = 0.8;

export interface FillRun {
  reports: FieldReport[];
  /** id → descriptor, so the review panel can scroll to, highlight and re-read fields. */
  descriptors: Map<string, FieldDescriptor>;
  /** id → text the model wrote, so a later edit by the user can be told apart from the draft. */
  generated: Map<string, string>;
}

export interface RunFillInput {
  adapter: PlatformAdapter;
  ctx: AdapterContext;
  profile: Profile;
  options: FillOptions;
}

const FILLED: FillStatus[] = ['filled', 'low-confidence', 'ai', 'skipped-existing'];

function preview(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Keys that belong to a repeated section (Work Experience 1, 2, 3 …; Education 1, 2 …).
 * When one of them appears more than once on the page, the n-th occurrence belongs to the n-th
 * entry in the profile. Counting by page order works on every site, whatever its ids look like
 * (Workday numbers its sections from arbitrary offsets, Greenhouse suffixes `--0`, `--1`).
 */
const REPEATED_KEYS = new Set<ProfileKey>([
  'currentCompany', 'currentTitle', 'expLocation', 'expDescription', 'expCurrent',
  'startMonth', 'startYear', 'endMonth', 'endYear',
  'expStartMonth', 'expStartYear', 'expEndMonth', 'expEndYear',
  'school', 'degree', 'field', 'gpa', 'eduStartYear', 'eduEndYear',
]);

export function assignEntryIndexes(fields: FieldDescriptor[], matches: (Match | null)[]): void {
  const groups = new Map<string, FieldDescriptor[]>();
  fields.forEach((d, i) => {
    const m = matches[i];
    if (!m || m.key === 'freeText' || !REPEATED_KEYS.has(m.key) || d.entryIndex != null) return;
    // Dates are separate series per section: education's first start year is not experience's.
    const bucket = /^(start|end)/.test(m.key) ? `${m.key}:${d.section ?? 'experience'}` : m.key;
    groups.set(bucket, [...(groups.get(bucket) ?? []), d]);
  });
  for (const members of groups.values()) {
    // A single occurrence is not a repeated section: leave it unindexed (current job / first education).
    if (members.length < 2) continue;
    members.forEach((d, n) => (d.entryIndex = n));
  }
}

export async function runFill({ adapter, ctx, profile, options }: RunFillInput): Promise<FillRun> {
  const fields = adapter.getFields(ctx);
  const matches = fields.map((d) => matchField(d));
  assignEntryIndexes(fields, matches);
  const reports: FieldReport[] = [];
  const descriptors = new Map<string, FieldDescriptor>();
  const generated = new Map<string, string>();

  for (const [i, d] of fields.entries()) {
    descriptors.set(d.id, d);
    const label = d.label || d.ariaLabel || d.placeholder || d.nearbyText?.slice(0, 80) || d.name || '(unlabeled)';
    const base = { id: d.id, label, kind: d.kind, required: d.required };
    const report = (status: FillStatus, extra: Partial<FieldReport> = {}): void => {
      // Judged on the live value after the attempt: typed-but-unconfirmed text is yellow, not red.
      const emptyRequired = d.required && !FILLED.includes(status) && !hasValue(d);
      reports.push({ ...base, confidence: 0, status, emptyRequired, ...extra });
    };

    const match = matches[i] ?? null;
    if (!match) {
      report('unmatched');
      continue;
    }
    if (match.key === 'freeText') {
      const free = { key: match.key, confidence: match.confidence } as const;
      if (!options.freeText) {
        report('unmatched', { ...free, detail: 'free-text question' });
        continue;
      }
      // Never spend an API call on a question the user already answered.
      if (d.currentValue && !options.overwrite) {
        report('skipped-existing', { ...free, valuePreview: preview(d.currentValue) });
        continue;
      }
      try {
        const answer = await options.freeText(d);
        if (answer.kind === 'none') {
          report('unmatched', { ...free, detail: answer.reason });
          continue;
        }
        const result = await adapter.fill(d, { type: 'text', text: answer.text }, options);
        if (result.status !== 'filled') {
          report(result.status, { ...free, detail: result.detail });
          continue;
        }
        if (answer.kind === 'ai') {
          generated.set(d.id, answer.text);
          report('ai', { ...free, valuePreview: preview(answer.text), detail: 'AI draft from your profile and posting: review before submitting' });
        } else {
          // A close match to a saved answer is trusted; a loose one is filled but flagged.
          report(answer.score >= BANK_CONFIDENT ? 'filled' : 'low-confidence', {
            key: match.key,
            confidence: answer.score,
            valuePreview: preview(answer.text),
            detail: 'from your answer bank',
          });
        }
      } catch (e) {
        report('failed', { ...free, detail: (e as Error).message });
      }
      continue;
    }
    if (match.confidence < MIN_FILL_CONFIDENCE) {
      report('unmatched', { key: match.key, confidence: match.confidence, detail: `weak match for ${match.key}` });
      continue;
    }

    const value = resolveValue(match.key, profile, d);
    if (!value) {
      report('no-data', { key: match.key, confidence: match.confidence, detail: `no profile data for ${match.key}` });
      continue;
    }
    if (d.currentValue && !options.overwrite) {
      report('skipped-existing', { key: match.key, confidence: match.confidence, valuePreview: preview(d.currentValue) });
      continue;
    }

    try {
      const result = await adapter.fill(d, value, options);
      if (result.status === 'filled') {
        const status: FillStatus = match.confidence >= HIGH_CONFIDENCE ? 'filled' : 'low-confidence';
        report(status, {
          key: match.key,
          confidence: match.confidence,
          valuePreview: preview(result.detail ?? (value.type === 'text' ? value.text : value.type)),
        });
      } else {
        report(result.status, { key: match.key, confidence: match.confidence, detail: result.detail });
      }
    } catch (e) {
      report('failed', { key: match.key, confidence: match.confidence, detail: (e as Error).message });
    }
  }
  return { reports, descriptors, generated };
}
