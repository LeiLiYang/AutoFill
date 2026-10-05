import type {
  AdapterContext,
  FieldDescriptor,
  FieldReport,
  FillOptions,
  FillStatus,
  PlatformAdapter,
} from '../adapters/types';
import { hasValue } from '../detect/descriptor';
import { matchField } from '../detect/match';
import { resolveValue } from '../detect/values';
import type { Profile } from '../profile/schema';

/** Matches below this are listed for the user but never written into the form. */
export const MIN_FILL_CONFIDENCE = 0.5;
/** Fills at or above this are green; anything lower is yellow. */
export const HIGH_CONFIDENCE = 0.8;

export interface FillRun {
  reports: FieldReport[];
  /** id → descriptor, so the review panel can scroll to, highlight and re-read fields. */
  descriptors: Map<string, FieldDescriptor>;
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

export async function runFill({ adapter, ctx, profile, options }: RunFillInput): Promise<FillRun> {
  const fields = adapter.getFields(ctx);
  const reports: FieldReport[] = [];
  const descriptors = new Map<string, FieldDescriptor>();

  for (const d of fields) {
    descriptors.set(d.id, d);
    const label = d.label || d.ariaLabel || d.placeholder || d.nearbyText?.slice(0, 80) || d.name || '(unlabeled)';
    const base = { id: d.id, label, kind: d.kind, required: d.required };
    const report = (status: FillStatus, extra: Partial<FieldReport> = {}): void => {
      // Judged on the live value after the attempt: typed-but-unconfirmed text is yellow, not red.
      const emptyRequired = d.required && !FILLED.includes(status) && !hasValue(d);
      reports.push({ ...base, confidence: 0, status, emptyRequired, ...extra });
    };

    const match = matchField(d);
    if (!match) {
      report('unmatched');
      continue;
    }
    if (match.key === 'freeText') {
      // Answer bank / LLM handling arrives in a later milestone.
      report('unmatched', { key: match.key, confidence: match.confidence, detail: 'free-text question' });
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
  return { reports, descriptors };
}
