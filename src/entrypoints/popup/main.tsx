import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { FieldReport } from '../../adapters/types';
import { reportsKey, type FrameReport, type SavePostingResult, type ToBackground } from '../../messaging/protocol';
import { loadSettings, saveSettings } from '../../profile/store';
import { pendingRows } from '../../tracking/localLog';
import { queueAction, useRows } from '../../tracking/useRows';
import './style.css';

function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [frames, setFrames] = useState<FrameReport[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTabId(t?.id ?? null));
    loadSettings().then((s) => setOverwrite(s.overwrite));
  }, []);

  useEffect(() => {
    if (tabId == null) return;
    const key = reportsKey(tabId);
    chrome.storage.session.get(key).then((r) => setFrames((r[key] as FrameReport[]) ?? []));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[key]) setFrames((changes[key].newValue as FrameReport[]) ?? []);
    };
    chrome.storage.session.onChanged.addListener(onChange);
    return () => chrome.storage.session.onChanged.removeListener(onChange);
  }, [tabId]);

  const fill = async () => {
    if (tabId == null) return;
    setBusy(true);
    const msg: ToBackground = { type: 'trigger-fill', tabId, overwrite };
    await chrome.runtime.sendMessage(msg);
    setBusy(false);
  };

  const pending = pendingRows(useRows());
  const [retrying, setRetrying] = useState(false);
  const retryAll = async () => {
    setRetrying(true);
    await queueAction({ type: 'queue-retry' });
    setRetrying(false);
  };
  const [postingMsg, setPostingMsg] = useState<string | null>(null);
  const savePosting = async () => {
    if (tabId == null) return;
    setPostingMsg('Saving…');
    const msg: ToBackground = { type: 'save-posting', tabId };
    const res = (await chrome.runtime.sendMessage(msg)) as SavePostingResult;
    setPostingMsg(res.ok ? `Saved to Downloads/${res.folder}${res.warnings.length ? ` (${res.warnings[0]})` : ''}` : res.message);
  };

  const toggleOverwrite = async (v: boolean) => {
    setOverwrite(v);
    await saveSettings({ ...(await loadSettings()), overwrite: v });
  };

  const all: FieldReport[] = frames.flatMap((f) => f.reports);
  const count = (pred: (r: FieldReport) => boolean) => all.filter(pred).length;
  const green = count((r) => r.status === 'filled');
  const yellow = count((r) => r.status === 'low-confidence' || r.status === 'ai');
  const red = count((r) => r.emptyRequired);

  return (
    <div className="popup">
      <button className="primary" onClick={fill} disabled={busy || tabId == null}>
        {busy ? 'Filling…' : 'Fill this page'}
      </button>
      <label className="check">
        <input type="checkbox" checked={overwrite} onChange={(e) => toggleOverwrite(e.target.checked)} />
        Overwrite already-filled fields
      </label>
      {all.length > 0 && (
        <ul className="summary">
          <li><span className="dot g" /> {green} filled</li>
          <li><span className="dot y" /> {yellow} need review</li>
          <li><span className="dot r" /> {red} required, empty</li>
        </ul>
      )}
      <button className="secondary" onClick={savePosting} disabled={tabId == null}>Save posting</button>
      {postingMsg && <p className="note">{postingMsg}</p>}
      {pending.length > 0 && (
        <div className="pending" role="status">
          <strong>{pending.length} row{pending.length === 1 ? '' : 's'} not in your sheet yet</strong>
          <ul>
            {pending.slice(0, 4).map((r) => (
              <li key={r.id}>
                {r.entry.company} <span className="why">{r.lastError ?? 'queued'}</span>
              </li>
            ))}
          </ul>
          <button className="secondary" onClick={retryAll} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry now'}</button>
        </div>
      )}
      <p className="note">Never submits. Review the form, then click Submit yourself.</p>
      <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); }}>Profile &amp; settings</a>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Popup />);
