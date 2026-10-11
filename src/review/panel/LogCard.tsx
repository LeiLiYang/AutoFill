import { useState } from 'react';
import { CATEGORIES, CHANNELS, LOCATIONS } from '../../config/tracking';
import type { LogApplicationResponse, SavePostingResult } from '../../messaging/protocol';
import type { LogPrefill } from '../../tracking/prefill';
import { validateEntry, type LogEntry } from '../../tracking/row';

export interface LogCardProps {
  prefill: LogPrefill;
  /** Called only when the user clicks a confirm button. */
  onLog: (entry: LogEntry, force: boolean) => Promise<LogApplicationResponse | undefined>;
  /** Called after a successful log when "also save the posting" is ticked. */
  onSavePosting?: () => Promise<SavePostingResult | undefined>;
}

type Draft = Record<'company' | 'category' | 'location' | 'date' | 'channel' | 'url', string>;

/** Shown when the extension itself did not answer (reloaded or updated while this page stayed open). */
const NO_REPLY = 'The extension did not respond. If you just reloaded or updated it, reload this page and try again.';

function describeFailure(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return /context invalidated|receiving end does not exist|message port closed|message channel closed/i.test(message) ? NO_REPLY : `Could not log: ${message}`;
}

/**
 * "Log application": pre-filled from the page and fully editable. The row is written only when
 * the user confirms here: nothing is logged automatically.
 */
export function LogCard({ prefill, onLog, onSavePosting }: LogCardProps) {
  const [draft, setDraft] = useState<Draft>({
    company: prefill.company,
    category: prefill.category,
    location: prefill.location,
    date: prefill.date,
    channel: prefill.channel,
    url: prefill.url,
  });
  const [alsoSave, setAlsoSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<LogApplicationResponse | null>(null);
  /** A failure with no log result at all: the request threw or nothing answered. */
  const [failure, setFailure] = useState<string | null>(null);
  const [save, setSave] = useState<SavePostingResult | 'saving' | null>(null);
  /** Collapsed to one line when the page gave us everything; open when something needs the user. */
  const [open, setOpen] = useState(() => !validateEntry({ ...prefill }).ok);

  const set = (k: keyof Draft) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setResponse(null);
    setFailure(null);
  };
  const check = validateEntry(draft);
  const duplicate = response && !response.log.ok && response.log.code === 'duplicate';
  const done = response?.log.ok === true;

  const submit = async (force: boolean) => {
    if (!check.ok) return;
    setBusy(true);
    setFailure(null);
    setSave(null);
    let logged = false;
    try {
      const res = await onLog(check.entry, force);
      if (res?.log) {
        setResponse(res);
        logged = res.log.ok;
      } else {
        setFailure(NO_REPLY);
      }
    } catch (e) {
      setFailure(describeFailure(e));
    } finally {
      setBusy(false);
    }
    // The row is in: the snapshot is saved separately, so a slow or failed save cannot hide the log.
    if (logged && alsoSave && onSavePosting) {
      setSave('saving');
      try {
        setSave((await onSavePosting()) ?? { ok: false, code: 'error', message: NO_REPLY });
      } catch (e) {
        setSave({ ok: false, code: 'error', message: `The posting was not saved: ${(e as Error).message}` });
      }
    }
  };

  return (
    <section className="logcard" aria-label="Log application">
      <div className="loghead">
        <h3>Log application</h3>
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide details' : 'Edit'}</button>
      </div>

      {!open && (
        <p className="logsummary">
          {draft.company} <span>· {draft.category} · {draft.location} · {draft.channel} · {draft.date}</span>
        </p>
      )}

      {open && (
        <div className="logfields">
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
        </div>
      )}

      {onSavePosting && (
        <label className="check">
          <input type="checkbox" checked={alsoSave} onChange={(e) => setAlsoSave(e.target.checked)} />
          Also save the posting (MHTML, Markdown, answers)
        </label>
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
      {failure && <p className="note err" role="alert">{failure}</p>}
      {done && response.log.ok && (
        <p className="note ok" role="status">
          {response.log.message}
          {save === 'saving' && ' Saving the posting…'}
          {save && save !== 'saving' && save.ok && ` Posting saved to Downloads/${save.folder}.`}
        </p>
      )}
      {save && save !== 'saving' && save.ok && save.warnings.map((w) => <p className="note" key={w}>⚠ {w}</p>)}
      {save && save !== 'saving' && !save.ok && <p className="note err" role="alert">{save.message}</p>}

      <button className="action" disabled={busy || !check.ok || done} onClick={() => submit(false)}>
        {busy ? 'Logging…' : done ? 'Logged' : 'Log application'}
      </button>
    </section>
  );
}
