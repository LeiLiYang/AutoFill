import { useEffect, useRef, useState } from 'react';
import type { FieldReport } from '../../adapters/types';
import type { FrameReport, LogApplicationResponse, SaveAnswersResult, SavePostingResult } from '../../messaging/protocol';
import type { LogPrefill } from '../../tracking/prefill';
import type { LogEntry } from '../../tracking/row';
import { levelFor, type Level } from '../highlight';
import { LogCard } from './LogCard';

export interface PanelProps {
  frames: FrameReport[];
  filling: boolean;
  /** Something the run could not do (an unreachable frame, a frame that failed). */
  notice?: string;
  /** LinkedIn: the extension never autofills there; the panel only logs and saves the posting. */
  logOnly?: boolean;
  /** Explains why no fields are listed in log-only mode. */
  logOnlyNote?: string;
  /** Null until the page has been read. */
  prefill?: LogPrefill | null;
  onScroll: (frameId: number, fieldId: string) => void;
  onSaveAnswers: () => Promise<SaveAnswersResult>;
  onSavePosting: () => Promise<SavePostingResult>;
  onLog?: (entry: LogEntry, force: boolean) => Promise<LogApplicationResponse | undefined>;
  onClose: () => void;
}

interface Row {
  frameId: number;
  report: FieldReport;
  level: Level | null;
}

const STATUS_TEXT: Record<string, string> = {
  filled: 'Filled',
  'low-confidence': 'Check this match',
  ai: 'AI draft. Review it',
  'skipped-existing': 'Already filled',
  'no-data': 'Nothing in your profile for this',
  unmatched: 'Not recognised',
  failed: 'Could not fill',
};

/** Long explanations from the fill code, cut down to what fits one or two lines. The full text stays in the tooltip. */
const SHORTER: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^AI draft\b/i, () => 'AI draft. Review it before submitting'],
  [/^matched by AI/i, () => 'Field matched by AI. Check it'],
  [/^from your answer bank/i, () => 'From your answer bank. Check it fits'],
  [/^free-text question \(no question text found\)/i, () => 'Open question with no readable label'],
  [/^free-text question: no saved answer matches\.?\s*(.*)$/i, (m) => `No saved answer. ${m[1]}`.trim()],
  [/^free-text question: (.+)$/is, (m) => m[1]!],
  [/^free-text question$/i, () => 'Open question: no saved answer'],
  [/^no matching option for “([^”]*)”\.\s*The dropdown showed no options/i, (m) => `The dropdown showed no options for “${m[1]}”`],
  [/^no matching option for “([^”]*)”/i, (m) => `No option matches “${m[1]}”`],
  [/^no matching option/i, () => 'No option matches your answer'],
  [/^attached (.+) but the page does not show it yet/i, (m) => `${m[1]}: upload not confirmed. Check it`],
  [/^clicked “([^”]*)” but the page showed no change/i, (m) => `Clicked “${m[1]}”, not confirmed. Check it`],
  [/^weak match for/i, () => 'Not sure what this field asks for'],
  [/^input rejected the value/i, () => 'The field did not keep the value'],
  [/^no (resume|coverLetter) stored/i, (m) => `No ${m[1] === 'resume' ? 'resume' : 'cover letter'} in your files`],
];

/**
 * Why a row needs attention. A specific reason (what a dropdown offered, that a click could not be
 * confirmed, why an AI answer was not given) beats a generic status; routine outcomes stay short.
 */
export function reasonFor(r: FieldReport): { short: string; full?: string } {
  const specific = ['unmatched', 'low-confidence', 'failed', 'ai'].includes(r.status) ? r.detail?.trim() : '';
  if (!specific) return { short: STATUS_TEXT[r.status] ?? r.status };
  for (const [pattern, shorten] of SHORTER) {
    const m = pattern.exec(specific);
    if (m) {
      const short = shorten(m);
      return short === specific ? { short } : { short, full: specific };
    }
  }
  return { short: specific };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Typing in the panel must not trigger the host page's keyboard shortcuts. */
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const KEEP_KEYS_IN_PANEL = { onKeyDown: stop, onKeyUp: stop, onKeyPress: stop };

/** Say what happened when "Save my answers" runs, including why nothing was saved. */
export function describeSave(r: SaveAnswersResult): string {
  if (r.saved > 0) return `Saved ${plural(r.saved, 'answer')} to your answer bank.`;
  if (r.found > 0) return `Found ${plural(r.found, 'answer')}, already in your answer bank unchanged.`;
  if (r.unreachable > 0 && r.scanned === 0) {
    return "Couldn't read the form. Reload the page, click Fill again, answer the questions, then save.";
  }
  return (
    `No hand-written answers found (looked at ${plural(r.scanned, 'field')}). ` +
    'Type your own answers into questions the extension left empty, then click again. ' +
    'Name, email, address and other profile fields are not saved as answers.'
  );
}

export function Panel({ frames, filling, notice, logOnly, logOnlyNote, prefill, onScroll, onSaveAnswers, onSavePosting, onLog, onClose }: PanelProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const [otherToggled, setOtherToggled] = useState<boolean | null>(null);
  const [posting, setPosting] = useState<SavePostingResult | 'saving' | null>(null);

  const savePosting = async () => {
    setPosting('saving');
    try {
      setPosting((await onSavePosting()) ?? { ok: false, code: 'error', message: 'The extension did not respond. Reload this page and try again.' });
    } catch (e) {
      setPosting({ ok: false, code: 'error', message: `Could not save the posting: ${(e as Error).message}` });
    }
  };

  const rows: Row[] = frames.flatMap((f) =>
    f.reports.map((report) => ({ frameId: f.frameId ?? 0, report, level: levelFor(report) })),
  );
  const red = rows.filter((r) => r.level === 'red');
  const yellow = rows.filter((r) => r.level === 'yellow');
  const green = rows.filter((r) => r.level === 'green');
  const other = rows.filter((r) => r.level === null && r.report.status !== 'skipped-existing');
  const kept = rows.filter((r) => r.report.status === 'skipped-existing').length;
  // When nothing was filled, the reasons are the whole story: show them without a click.
  const nothingFilled = !filling && green.length + yellow.length + kept === 0;
  const showOther = otherToggled ?? nothingFilled;

  const saveNote = useRef<HTMLParagraphElement>(null);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const save = async () => {
    setSavingAnswers(true);
    setSaved(null);
    try {
      setSaved(describeSave(await onSaveAnswers()));
    } catch (e) {
      setSaved(`Could not save: ${(e as Error).message}`);
    } finally {
      setSavingAnswers(false);
    }
  };
  // The panel scrolls; make sure the outcome is actually on screen.
  useEffect(() => {
    // Purely cosmetic: an error here must never blank the panel.
    try {
      if (saved) saveNote.current?.scrollIntoView?.({ block: 'nearest' });
    } catch {
      /* ignore */
    }
  }, [saved]);

  const list = (items: Row[], cls: string) =>
    items.map(({ frameId, report }) => {
      const reason = reasonFor(report);
      return (
        <li key={`${frameId}:${report.id}`}>
          <button className={`row ${cls}`} onClick={() => onScroll(frameId, report.id)} title={reason.full ?? 'Show this field'}>
            <span className="dot" aria-hidden="true" />
            <span className="text">
              <span className="label">{report.label}</span>
              <span className="why">{reason.short}</span>
            </span>
          </button>
        </li>
      );
    });

  return (
    <aside className="panel" role="complementary" aria-label="Autofill review" {...KEEP_KEYS_IN_PANEL}>
      <header>
        <strong>Autofill review</strong>
        <button className="close" onClick={onClose} aria-label="Close review panel">×</button>
      </header>

      {filling && (
        <p className="progress" role="status">
          <span className="bar" aria-hidden="true" />
          Filling…
        </p>
      )}

      {logOnly ? (
        <p className="note">{logOnlyNote || 'Nothing is being filled. You can still log this posting and save it.'}</p>
      ) : (
        <div className="counts" aria-label="Summary">
          <span className="count g"><i aria-hidden="true" />{green.length} filled</span>
          <span className="count y"><i aria-hidden="true" />{yellow.length} review</span>
          <span className="count r"><i aria-hidden="true" />{red.length} required empty</span>
          {other.length > 0 && <span className="count n"><i aria-hidden="true" />{other.length} not filled</span>}
        </div>
      )}

      {notice && <p className="note err" role="alert">{notice}</p>}
      {!logOnly && !filling && rows.length === 0 && (
        <p className="note empty" role="status">
          No form fields found on this page. If the form opens after you click Apply (or on a later step), open it and press Fill again.
        </p>
      )}
      {!logOnly && nothingFilled && rows.length > 0 && (
        <p className="note empty" role="status">
          Found {plural(rows.length, 'field')} but could not fill any. The reasons are listed under Not filled.
        </p>
      )}

      {red.length > 0 && (
        <section>
          <h3>Required, still empty</h3>
          <ul>{list(red, 'r')}</ul>
        </section>
      )}
      {yellow.length > 0 && (
        <section>
          <h3>Needs your review</h3>
          <ul>{list(yellow, 'y')}</ul>
        </section>
      )}
      {other.length > 0 && (
        <section>
          <h3>
            <button className="link" onClick={() => setOtherToggled(!showOther)} aria-expanded={showOther}>
              {showOther ? '▾' : '▸'} Not filled ({other.length})
            </button>
          </h3>
          {showOther && <ul>{list(other, 'n')}</ul>}
        </section>
      )}

      {/* Keyed by posting: moving to another job starts a fresh card instead of showing the last one as "Logged". */}
      {prefill && onLog && <LogCard key={`${prefill.url}|${prefill.location}|${prefill.category}`} prefill={prefill} onLog={onLog} onSavePosting={onSavePosting} />}

      <footer>
        <div className="actions">
          {!logOnly && (
            <button className="action secondary" onClick={save} disabled={savingAnswers} title="Save the answers you typed yourself to your answer bank, to reuse next time">
              {savingAnswers ? 'Saving…' : 'Save my answers'}
            </button>
          )}
          <button className="action secondary" onClick={savePosting} disabled={posting === 'saving'} title="Save the posting, a snapshot of this page and the form's answers to your Downloads folder">
            {posting === 'saving' ? 'Saving posting…' : 'Save posting'}
          </button>
        </div>
        {saved && <p className="note save-note" role="status" ref={saveNote}>{saved}</p>}
        {posting && posting !== 'saving' && (
          <div className={`note save-note ${posting.ok ? '' : 'err'}`} role="status">
            {posting.ok ? (
              <>
                Saved to Downloads/{posting.folder}
                <ul className="files">{posting.files.map((f) => <li key={f.path}>{f.name}</li>)}</ul>
                {posting.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
              </>
            ) : (
              posting.message
            )}
          </div>
        )}
        <p className="note fine">Nothing is submitted. Review the form, then click Submit yourself.</p>
      </footer>
    </aside>
  );
}
