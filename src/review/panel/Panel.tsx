import { useState } from 'react';
import type { FieldReport } from '../../adapters/types';
import type { FrameReport } from '../../messaging/protocol';
import { levelFor, type Level } from '../highlight';

export interface PanelProps {
  frames: FrameReport[];
  filling: boolean;
  onScroll: (frameId: number, fieldId: string) => void;
  onSaveAnswers: () => Promise<number>;
  onClose: () => void;
}

interface Row {
  frameId: number;
  report: FieldReport;
  level: Level | null;
}

const STATUS_TEXT: Record<string, string> = {
  filled: 'filled',
  'low-confidence': 'check this match',
  ai: 'AI draft: review',
  'skipped-existing': 'already filled',
  'no-data': 'nothing in profile',
  unmatched: 'not recognised',
  failed: 'could not fill',
};

export function Panel({ frames, filling, onScroll, onSaveAnswers, onClose }: PanelProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);

  const rows: Row[] = frames.flatMap((f) =>
    f.reports.map((report) => ({ frameId: f.frameId ?? 0, report, level: levelFor(report) })),
  );
  const red = rows.filter((r) => r.level === 'red');
  const yellow = rows.filter((r) => r.level === 'yellow');
  const green = rows.filter((r) => r.level === 'green');
  const other = rows.filter((r) => r.level === null && r.report.status !== 'skipped-existing');

  const save = async () => {
    const n = await onSaveAnswers();
    setSaved(n ? `Saved ${n} answer${n === 1 ? '' : 's'} to your answer bank.` : 'No new manual answers to save.');
  };

  const list = (items: Row[], cls: string) =>
    items.map(({ frameId, report }) => (
      <li key={`${frameId}:${report.id}`}>
        <button className={`row ${cls}`} onClick={() => onScroll(frameId, report.id)}>
          <span className="label">{report.label}</span>
          <span className="why">{report.detail && report.status === 'unmatched' ? report.detail : STATUS_TEXT[report.status]}</span>
        </button>
      </li>
    ));

  return (
    <aside className="panel" role="complementary" aria-label="Autofill review">
      <header>
        <strong>Autofill review</strong>
        <button className="close" onClick={onClose} aria-label="Close review panel">×</button>
      </header>

      {filling && <p className="note">Filling…</p>}

      <div className="counts">
        <span className="chip g">{green.length} filled</span>
        <span className="chip y">{yellow.length} review</span>
        <span className="chip r">{red.length} required empty</span>
      </div>

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
            <button className="link" onClick={() => setShowOther(!showOther)}>
              {showOther ? '▾' : '▸'} Not filled ({other.length})
            </button>
          </h3>
          {showOther && <ul>{list(other, 'n')}</ul>}
        </section>
      )}

      <footer>
        <button className="action" onClick={save}>Save my answers to answer bank</button>
        {saved && <p className="note" role="status">{saved}</p>}
        <p className="note">Nothing is submitted. Review the form, then click Submit yourself.</p>
      </footer>
    </aside>
  );
}
