import { useState } from 'react';
import { CATEGORIES, CHANNELS, LOCATIONS } from '../../config/tracking';
import type { LogApplicationResponse } from '../../messaging/protocol';
import type { LogPrefill } from '../../tracking/prefill';
import { validateEntry, type LogEntry } from '../../tracking/row';

export interface LogCardProps {
  prefill: LogPrefill;
  /** Called only when the user clicks a confirm button. */
  onLog: (entry: LogEntry, force: boolean, alsoSavePosting: boolean) => Promise<LogApplicationResponse>;
}

type Draft = Record<'company' | 'category' | 'location' | 'date' | 'channel' | 'url', string>;

/**
 * "Log application": pre-filled from the page and fully editable. The row is written only when
 * the user confirms here: nothing is logged automatically.
 */
export function LogCard({ prefill, onLog }: LogCardProps) {
  const [draft, setDraft] = useState<Draft>({
    company: prefill.company,
    category: prefill.category,
    location: prefill.location,
    date: prefill.date,
    channel: prefill.channel,
    url: prefill.url,
  });
  const [alsoSave, setAlsoSave] = useState(!prefill.formOnly);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<LogApplicationResponse | null>(null);

  const set = (k: keyof Draft) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setResponse(null);
  };
  const check = validateEntry(draft);
  const duplicate = response && !response.log.ok && response.log.code === 'duplicate';
  const done = response?.log.ok === true;

  const submit = async (force: boolean) => {
    if (!check.ok) return;
    setBusy(true);
    try {
      setResponse(await onLog(check.entry, force, alsoSave && !prefill.formOnly));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="logcard" aria-label="Log application">
      <h3>Log application</h3>

      <label>
        Company
        <input value={draft.company} onChange={(e) => set('company')(e.target.value)} />
      </label>
      <div className="two">
        <label>
          Category
          <select value={draft.category} onChange={(e) => set('category')(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Channel
          <select value={draft.channel} onChange={(e) => set('channel')(e.target.value)}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label>
        Location
        <select value={draft.location} onChange={(e) => set('location')(e.target.value)} aria-invalid={!draft.location}>
          <option value="">Select a location…</option>
          {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
        </select>
      </label>
      {!draft.location && (
        <p className="note err">
          {prefill.locationText
            ? `Could not place “${prefill.locationText}” automatically. Pick one to log.`
            : 'No location found on this page. Pick one to log.'}
        </p>
      )}
      <label>
        Date
        <input value={draft.date} onChange={(e) => set('date')(e.target.value)} placeholder="YYYY/MM/DD" />
      </label>
      <label>
        Job URL
        <input value={draft.url} onChange={(e) => set('url')(e.target.value)} />
      </label>

      <label className="check">
        <input type="checkbox" checked={alsoSave && !prefill.formOnly} disabled={prefill.formOnly} onChange={(e) => setAlsoSave(e.target.checked)} />
        Also save the posting (MHTML, Markdown, answers)
      </label>
      {prefill.formOnly && (
        <p className="note">This is the application form. To save the posting, open the job posting page and use Save posting there.</p>
      )}

      {!check.ok && draft.location && <p className="note err">{check.errors.join(' ')}</p>}

      {duplicate && (
        <div className="note err" role="alert">
          {response.log.message}
          <button className="action secondary" disabled={busy} onClick={() => submit(true)}>Log anyway</button>
        </div>
      )}
      {response && !response.log.ok && !duplicate && (
        <p className="note err" role="alert">{response.log.message}</p>
      )}
      {done && response.log.ok && (
        <p className="note ok" role="status">
          {response.log.message}
          {response.save && (response.save.ok ? ` Posting saved to Downloads/${response.save.folder}.` : ` ${response.save.message}`)}
        </p>
      )}

      <button className="action" disabled={busy || !check.ok || done} onClick={() => submit(false)}>
        {busy ? 'Logging…' : done ? 'Logged' : 'Log application'}
      </button>
    </section>
  );
}
