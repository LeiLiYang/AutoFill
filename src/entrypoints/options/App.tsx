import { useEffect, useState, type ReactNode } from 'react';
import {
  EEO_DECLINE,
  defaultProfile,
  defaultSettings,
  type Answer,
  type FileKind,
  type Profile,
  type Settings,
} from '../../profile/schema';
import { loadProfile, loadSettings, saveProfile, saveSettings } from '../../profile/store';
import { deleteFile, getFile, putFile } from '../../profile/files';
import { exportBackup, importBackup } from '../../profile/importExport';
import type { TestLlmResult, TestSheetsResult, ToBackground } from '../../messaging/protocol';
import { PROVIDER_LABELS, type ProviderId } from '../../llm/providers/types';
import { samplesFromPaste } from '../../llm/answerBank';
import { pendingRows } from '../../tracking/localLog';
import { queueAction, useRows } from '../../tracking/useRows';

type Tab = 'profile' | 'history' | 'answers' | 'files' | 'applications' | 'settings' | 'backup';
const TABS: [Tab, string][] = [
  ['profile', 'Contact & work'],
  ['history', 'Education & experience'],
  ['answers', 'Answer bank'],
  ['files', 'Resume'],
  ['applications', 'Applications'],
  ['settings', 'Settings'],
  ['backup', 'Import / export'],
];

/** Set a value at a dotted path on a deep copy. */
function setPath<T>(obj: T, path: string, value: unknown): T {
  const copy = structuredClone(obj) as Record<string, any>;
  const keys = path.split('.');
  let cur = copy;
  for (const k of keys.slice(0, -1)) cur = cur[k];
  cur[keys[keys.length - 1]!] = value;
  return copy as T;
}
function getPath(obj: unknown, path: string): any {
  return path.split('.').reduce((o: any, k) => o?.[k], obj);
}

const EEO_FIELDS: [string, string][] = [
  ['gender', 'Gender'],
  ['race', 'Race / ethnicity'],
  ['hispanicLatino', 'Hispanic / Latino'],
  ['veteran', 'Veteran status'],
  ['disability', 'Disability status'],
];

export function App() {
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<Profile>(defaultProfile());
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  /** Text typed into the answer bank's paste box that has not been added yet. */
  const [paste, setPaste] = useState('');

  useEffect(() => {
    Promise.all([loadProfile(), loadSettings()]).then(([p, s]) => {
      setProfile(p);
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  const flash = (text: string, err = false) => setMsg({ text, err });
  const editProfile = (path: string, value: unknown) => {
    setProfile((p) => setPath(p, path, value));
    setDirty(true);
  };
  const editSettings = (key: keyof Settings, value: unknown) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };
  /** A field of the selected non-Anthropic provider. */
  const editProvider = (field: 'apiKey' | 'model' | 'mappingModel' | 'baseUrl', value: string) => {
    setSettings((s) => (s.provider === 'anthropic' ? s : setPath(s, `providers.${s.provider}.${field}`, value)));
    setDirty(true);
  };
  const [models, setModels] = useState<string[]>([]);

  const pending = samplesFromPaste(paste);
  const save = async () => {
    if (!dirty && !pending.length) {
      flash(paste.trim() ? 'Nothing was saved: pasted answers must be at least 20 characters each.' : 'Nothing to save: no changes yet.', !!paste.trim());
      return;
    }
    try {
      // Text still sitting in the paste box counts: it is added to the answer bank on Save.
      // Blank entries (an "Add" clicked and never filled in) are dropped rather than saved.
      const bank = [...profile.answerBank, ...pending].filter((a) => a.question.trim() || a.answer.trim());
      const toSave = { ...profile, answerBank: bank };
      await saveProfile(toSave);
      await saveSettings(settings);
      setProfile(toSave);
      setPaste('');
      setDirty(false);
      flash(pending.length ? `Saved. Added ${pending.length} writing sample${pending.length === 1 ? '' : 's'} to your answer bank.` : 'Saved locally.');
    } catch (e) {
      flash(`Save failed: ${(e as Error).message}`, true);
    }
  };

  if (!loaded) return <div className="wrap">Loading…</div>;

  const text = (path: string, label: string, type = 'text') => (
    <label className="f" key={path}>
      {label}
      <input
        type={type}
        value={getPath(profile, path) ?? ''}
        onChange={(e) => editProfile(path, e.target.value)}
      />
    </label>
  );
  const check = (path: string, label: string) => (
    <label className="check" key={path}>
      <input
        type="checkbox"
        checked={!!getPath(profile, path)}
        onChange={(e) => editProfile(path, e.target.checked)}
      />
      {label}
    </label>
  );
  const group = (title: string, children: ReactNode) => (
    <fieldset>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <div className="wrap">
      <h1>Job Application Autofill</h1>
      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'profile' && (
        <>
          {group(
            'Contact',
            <div className="grid">
              {text('contact.firstName', 'First name')}
              {text('contact.lastName', 'Last name')}
              {text('contact.preferredName', 'Preferred name')}
              {text('contact.email', 'Email', 'email')}
              {text('contact.phone', 'Phone', 'tel')}
              {text('contact.phoneType', 'Phone type (for “device type” dropdowns)')}
              {text('contact.pronouns', 'Pronouns')}
            </div>,
          )}
          {group(
            'Links',
            <div className="grid">
              {text('links.linkedin', 'LinkedIn', 'url')}
              {text('links.github', 'GitHub', 'url')}
              {text('links.portfolio', 'Portfolio / website', 'url')}
              <label className="f">
                Other links (one per line)
                <textarea
                  value={profile.links.other.join('\n')}
                  onChange={(e) =>
                    editProfile('links.other', e.target.value.split('\n').filter(Boolean))
                  }
                />
              </label>
            </div>,
          )}
          {group(
            'Location & address',
            <div className="grid">
              {text('address.line1', 'Address line 1')}
              {text('address.line2', 'Address line 2')}
              {text('address.city', 'City')}
              {text('address.region', 'Province / state')}
              {text('address.postalCode', 'Postal / ZIP code')}
              {text('address.country', 'Country')}
            </div>,
          )}
          {group(
            'Work preferences',
            <>
              <div className="grid">
                <label className="f">
                  Authorized to work in (comma-separated countries)
                  <input
                    type="text"
                    value={profile.work.authorizedCountries.join(', ')}
                    onChange={(e) =>
                      editProfile(
                        'work.authorizedCountries',
                        e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      )
                    }
                  />
                </label>
                {text('work.startDate', 'Earliest start date')}
                {text('work.noticePeriod', 'Notice period')}
                {text('work.salaryExpectation.amount', 'Salary expectation (amount)')}
                {text('work.salaryExpectation.currency', 'Currency')}
                <label className="f">
                  Per
                  <select
                    value={profile.work.salaryExpectation.period}
                    onChange={(e) => editProfile('work.salaryExpectation.period', e.target.value)}
                  >
                    <option value="year">year</option>
                    <option value="month">month</option>
                    <option value="hour">hour</option>
                  </select>
                </label>
              </div>
              <div className="row">
                {check('work.assumeAuthorized', 'Always answer “authorized to work” = Yes and “require sponsorship” = No')}
              </div>
              <small className="hint">
                On: every work-authorization and sponsorship question gets those two answers, whatever
                country it names. Check that this is true for the role before you click Fill. Off: answers
                follow the country list and the checkbox below.
              </small>
              <div className="row">
                {check('work.requiresSponsorship', 'I require visa sponsorship (used only when the box above is off)')}
                {check('work.willingToRelocate', 'Willing to relocate')}
              </div>
            </>,
          )}
          {group(
            'EEO / demographic (defaults to decline)',
            <>
              <div className="grid">
                {EEO_FIELDS.map(([k, label]) => text(`eeo.${k}`, label))}
              </div>
              <small className="hint">
                Leave as “{EEO_DECLINE}” unless you want these answered. The matcher maps this to
                each form's own decline wording.
              </small>
            </>,
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {group(
            'Education',
            <>
              {profile.education.map((ed, i) => (
                <div className="entry" key={i}>
                  <div className="grid">
                    {text(`education.${i}.school`, 'School')}
                    {text(`education.${i}.degree`, 'Degree')}
                    {text(`education.${i}.field`, 'Field of study')}
                    {text(`education.${i}.startDate`, 'Start (YYYY-MM)')}
                    {text(`education.${i}.endDate`, 'End (YYYY-MM)')}
                    {text(`education.${i}.gpa`, 'GPA')}
                  </div>
                  <div className="row">
                    {check(`education.${i}.current`, 'Currently enrolled')}
                    <button
                      className="danger"
                      onClick={() =>
                        editProfile('education', profile.education.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="ghost"
                onClick={() =>
                  editProfile('education', [
                    ...profile.education,
                    { school: '', degree: '', field: '', startDate: '', endDate: '', gpa: '', current: false },
                  ])
                }
              >
                + Add education
              </button>
            </>,
          )}
          {group(
            'Work experience',
            <>
              {profile.experience.map((ex, i) => (
                <div className="entry" key={i}>
                  <div className="grid">
                    {text(`experience.${i}.company`, 'Company')}
                    {text(`experience.${i}.title`, 'Title')}
                    {text(`experience.${i}.location`, 'Location')}
                    {text(`experience.${i}.startDate`, 'Start (YYYY-MM)')}
                    {text(`experience.${i}.endDate`, 'End (YYYY-MM)')}
                  </div>
                  <label className="f" style={{ marginTop: 8 }}>
                    Description
                    <textarea
                      value={ex.description}
                      onChange={(e) => editProfile(`experience.${i}.description`, e.target.value)}
                    />
                  </label>
                  <div className="row">
                    {check(`experience.${i}.current`, 'Current role')}
                    <button
                      className="danger"
                      onClick={() =>
                        editProfile('experience', profile.experience.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="ghost"
                onClick={() =>
                  editProfile('experience', [
                    ...profile.experience,
                    { company: '', title: '', location: '', startDate: '', endDate: '', current: false, description: '' },
                  ])
                }
              >
                + Add experience
              </button>
            </>,
          )}
        </>
      )}

      {tab === 'answers' && (
        <AnswerBank
          answers={profile.answerBank}
          onChange={(a) => editProfile('answerBank', a)}
          paste={paste}
          onPaste={setPaste}
          pendingCount={pending.length}
        />
      )}

      {tab === 'files' && <Files flash={flash} />}

      {tab === 'applications' && <Applications />}

      {tab === 'settings' &&
        group(
          'Integrations',
          <>
            <div className="grid">
              <label className="f">
                Google Sheet ID
                <input
                  type="text"
                  placeholder="or paste the sheet's full URL"
                  value={settings.sheetId}
                  // Accept a pasted URL and keep just the ID part.
                  onChange={(e) =>
                    editSettings('sheetId', (/\/spreadsheets\/d\/([\w-]+)/.exec(e.target.value)?.[1] ?? e.target.value).trim())
                  }
                />
              </label>
              <label className="f">
                Sheet tab name
                <input
                  type="text"
                  value={settings.tabName}
                  onChange={(e) => editSettings('tabName', e.target.value)}
                />
              </label>
            </div>
            <TestSheets dirty={dirty} />
            <div className="row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.overwrite}
                  onChange={(e) => editSettings('overwrite', e.target.checked)}
                />
                Overwrite already-filled fields
              </label>
            </div>
          </>,
        )}

      {tab === 'settings' &&
        group(
          'AI (optional)',
          <>
            <div className="grid">
              <label className="f">
                Provider
                <select value={settings.provider} onChange={(e) => editSettings('provider', e.target.value)}>
                  {PROVIDERS.map((id) => <option key={id} value={id}>{PROVIDER_NAMES[id]}</option>)}
                </select>
              </label>
              {settings.provider === 'custom' && (
                <label className="f">
                  Server URL
                  <input
                    type="text"
                    placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
                    value={settings.providers.custom.baseUrl}
                    onChange={(e) => editProvider('baseUrl', e.target.value.trim())}
                  />
                </label>
              )}
              <label className="f">
                API key (stored locally{settings.provider === 'custom' ? '; leave empty for a local server' : ''})
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.provider === 'anthropic' ? settings.anthropicApiKey : settings.providers[settings.provider].apiKey}
                  onChange={(e) =>
                    settings.provider === 'anthropic' ? editSettings('anthropicApiKey', e.target.value.trim()) : editProvider('apiKey', e.target.value.trim())
                  }
                />
              </label>
              <label className="f">
                Model for free-text answers
                <input
                  type="text"
                  list="llm-models"
                  placeholder={settings.provider === 'anthropic' ? 'claude-opus-5-5' : 'model id from your provider'}
                  value={settings.provider === 'anthropic' ? settings.model : settings.providers[settings.provider].model}
                  onChange={(e) => (settings.provider === 'anthropic' ? editSettings('model', e.target.value.trim()) : editProvider('model', e.target.value.trim()))}
                />
              </label>
              <label className="f">
                Model for recognising fields (a small, cheap one)
                <input
                  type="text"
                  list="llm-models"
                  placeholder={settings.provider === 'anthropic' ? 'claude-haiku-5-5' : 'blank = same as above'}
                  value={settings.provider === 'anthropic' ? settings.anthropicMappingModel : settings.providers[settings.provider].mappingModel}
                  onChange={(e) =>
                    settings.provider === 'anthropic' ? editSettings('anthropicMappingModel', e.target.value.trim()) : editProvider('mappingModel', e.target.value.trim())
                  }
                />
              </label>
            </div>
            <label className="f">
              How you write (optional)
              <textarea
                rows={3}
                placeholder="e.g. Short sentences. I say “I built” rather than “I was responsible for”. Canadian spelling. No buzzwords."
                value={settings.voiceNotes}
                onChange={(e) => editSettings('voiceNotes', e.target.value)}
              />
            </label>
            <datalist id="llm-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <TestLlm dirty={dirty} onModels={setModels} />
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={settings.aiFieldMapping} onChange={(e) => editSettings('aiFieldMapping', e.target.checked)} />
                Let the AI work out which profile field an unrecognised form field is
              </label>
            </div>
            <small className="hint">
              Once a provider is set up, an open-ended question with no close saved answer is drafted
              by the model you chose. That sends the question, the job posting text, your name,
              links, education, work history and a few of your saved answers to that provider: never
              your contact details, address, salary or demographic answers. Recognising fields sends
              only the labels and options of fields the built-in rules did not recognise, once per
              site (the result is remembered). Without a provider nothing is sent. Keys are never
              included in exports.
            </small>
          </>,
        )}

      {tab === 'backup' && <Backup flash={flash} onImported={() => location.reload()} />}

      <div className="savebar">
        {msg && <span className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</span>}
        {(dirty || pending.length > 0) && <span className="msg">Unsaved changes</span>}
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

/** Signs in to Google and reads the sheet, so setup problems show up here and not on a real application. */
const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'custom'];
const PROVIDER_NAMES: Record<ProviderId, string> = { ...PROVIDER_LABELS, custom: 'OpenAI-compatible (OpenRouter, Groq, Ollama, …)' };

/** Checks the saved provider settings by listing its models: no prompt is sent, so it costs nothing. */
function TestLlm({ dirty, onModels }: { dirty: boolean; onModels: (models: string[]) => void }) {
  const [state, setState] = useState<'idle' | 'testing' | { ok: boolean; text: string }>('idle');
  const test = async () => {
    setState('testing');
    const msg: ToBackground = { type: 'test-llm' };
    const res = (await chrome.runtime.sendMessage(msg)) as TestLlmResult | undefined;
    if (!res) return setState({ ok: false, text: 'The extension did not respond. Reload this page and try again.' });
    if (!res.ok) return setState({ ok: false, text: res.message });
    onModels(res.models);
    setState({
      ok: true,
      text: res.models.length
        ? `Connected to ${res.label}. ${res.models.length} models available: start typing in a model box to pick one.`
        : `Connected to ${res.label}. It did not list its models, so type the model name by hand.`,
    });
  };
  return (
    <div className="row">
      <button className="ghost" onClick={test} disabled={state === 'testing'}>
        {state === 'testing' ? 'Testing…' : 'Test connection and list models'}
      </button>
      {dirty && <small className="hint">Save your changes first: the test uses the saved settings.</small>}
      {typeof state === 'object' && <span className={`msg ${state.ok ? 'ok' : 'err'}`} role="status">{state.text}</span>}
    </div>
  );
}

function TestSheets({ dirty }: { dirty: boolean }) {
  const [state, setState] = useState<'idle' | 'testing' | { ok: boolean; text: string }>('idle');
  const test = async () => {
    setState('testing');
    const msg: ToBackground = { type: 'test-sheets' };
    const res = (await chrome.runtime.sendMessage(msg)) as TestSheetsResult;
    setState(
      res.ok
        ? { ok: true, text: `Connected. ${res.rows} job URL${res.rows === 1 ? '' : 's'} found in column H.` }
        : { ok: false, text: res.message },
    );
  };
  return (
    <div className="row">
      <button className="ghost" onClick={test} disabled={state === 'testing'}>
        {state === 'testing' ? 'Testing…' : 'Test Google Sheets connection'}
      </button>
      {dirty && <small className="hint">Save your changes first: the test uses the saved settings.</small>}
      {typeof state === 'object' && <span className={`msg ${state.ok ? 'ok' : 'err'}`} role="status">{state.text}</span>}
    </div>
  );
}

const STATUS_LABEL ={ synced: 'In sheet', pending: 'Queued', failed: 'Needs attention' } as const;

/** Local copy of every logged row, with the retry queue made visible and actionable. */
function Applications() {
  const rows = useRows().slice().reverse();
  const pending = pendingRows(rows);
  return (
    <fieldset>
      <legend>Logged applications (local copy)</legend>
      <div className="row">
        <span>{rows.length} logged · {pending.length} not in the sheet yet</span>
        {pending.length > 0 && (
          <button className="ghost" onClick={() => queueAction({ type: 'queue-retry' })}>Retry all</button>
        )}
      </div>
      <table className="apps">
        <thead>
          <tr><th>Date</th><th>Company</th><th>Cat.</th><th>Location</th><th>Channel</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status}>
              <td>{r.entry.date}</td>
              <td title={r.entry.url}>{r.entry.company}</td>
              <td>{r.entry.category}</td>
              <td>{r.entry.location}</td>
              <td>{r.entry.channel}</td>
              <td>
                {STATUS_LABEL[r.status]}
                {r.lastError && <small className="hint"> {r.lastError}</small>}
              </td>
              <td className="acts">
                {r.status !== 'synced' && (
                  <>
                    {r.errorKind === 'duplicate' ? (
                      <>
                        <button className="ghost" onClick={() => queueAction({ type: 'queue-mark-synced', id: r.id })}>Already there</button>
                        <button className="ghost" onClick={() => queueAction({ type: 'queue-retry', id: r.id, force: true })}>Append anyway</button>
                      </>
                    ) : (
                      <button className="ghost" onClick={() => queueAction({ type: 'queue-retry', id: r.id })}>Retry</button>
                    )}
                    <button className="danger" onClick={() => queueAction({ type: 'queue-discard', id: r.id })}>Discard</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <small className="hint">Nothing logged yet. Rows appear here after you confirm the log card.</small>}
    </fieldset>
  );
}

function AnswerBank({
  answers,
  onChange,
  paste,
  onPaste,
  pendingCount,
}: {
  answers: Answer[];
  onChange: (a: Answer[]) => void;
  paste: string;
  onPaste: (text: string) => void;
  pendingCount: number;
}) {
  // Optional shortcut: the bottom Save bar also adds whatever is in the paste box.
  const addPasted = () => {
    onChange([...answers, ...samplesFromPaste(paste)]);
    onPaste('');
  };
  const update = (i: number, patch: Partial<Answer>) =>
    onChange(
      answers.map((a, j) => (j === i ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)),
    );
  return (
    <fieldset>
      <legend>Answer bank</legend>
      <small className="hint">
        Two kinds of entry. <strong>With a question</strong>: reused directly when a form asks
        something similar. <strong>Without a question</strong> (a “writing sample”): background on
        your experience, interests and voice. These are never pasted into forms; with an API key
        they guide AI drafts for new questions. Don't have the original questions? Paste your
        answers below.
      </small>
      <div className="entry">
        <label className="f">
          Paste several answers without their questions (separate with a blank line, or a line of ---)
          <textarea value={paste} onChange={(e) => onPaste(e.target.value)} style={{ minHeight: 110 }} />
        </label>
        <div className="row">
          <button className="ghost" disabled={!pendingCount} onClick={addPasted}>
            Add {pendingCount || ''} as writing sample{pendingCount === 1 ? '' : 's'} to the list below
          </button>
          {pendingCount > 0 && <small className="hint">{pendingCount} ready. Press the button, or just <strong>Save</strong> at the bottom.</small>}
          {pendingCount === 0 && paste.trim() !== '' && (
            <small className="hint msg err">Each answer needs at least 20 characters, and answers are separated by a blank line or a line of ---.</small>
          )}
        </div>
      </div>
      {answers.map((a, i) => (
        <div className="entry" key={a.id}>
          <label className="f">
            Question {!a.question.trim() && <strong>· writing sample (no question)</strong>}
            <input
              type="text"
              placeholder="Leave empty for a general writing sample"
              value={a.question}
              onChange={(e) => update(i, { question: e.target.value })}
            />
          </label>
          <label className="f" style={{ marginTop: 8 }}>
            Answer
            <textarea value={a.answer} onChange={(e) => update(i, { answer: e.target.value })} />
          </label>
          <div className="row">
            <label className="f" style={{ flex: 1 }}>
              Tags (comma-separated, e.g. why this company)
              <input
                type="text"
                value={a.tags.join(', ')}
                onChange={(e) =>
                  update(i, { tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </label>
            <button className="danger" onClick={() => onChange(answers.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        className="ghost"
        onClick={() =>
          onChange([
            ...answers,
            { id: crypto.randomUUID(), question: '', answer: '', tags: [], updatedAt: new Date().toISOString() },
          ])
        }
      >
        + Add answer or writing sample
      </button>
    </fieldset>
  );
}

function Files({ flash }: { flash: (t: string, err?: boolean) => void }) {
  const [names, setNames] = useState<Partial<Record<FileKind, string>>>({});
  const refresh = async () => {
    const [r, c] = await Promise.all([getFile('resume'), getFile('coverLetter')]);
    setNames({ resume: r?.name, coverLetter: c?.name });
  };
  useEffect(() => {
    refresh();
  }, []);

  const upload = async (kind: FileKind, file?: File) => {
    if (!file) return;
    await putFile({ kind, name: file.name, mime: file.type || 'application/pdf', data: await file.arrayBuffer() });
    await refresh();
    flash(`${file.name} stored locally.`);
  };
  const row = (kind: FileKind, label: string) => (
    <div className="row" key={kind}>
      <strong style={{ width: 110 }}>{label}</strong>
      <input type="file" accept="application/pdf,.pdf" onChange={(e) => upload(kind, e.target.files?.[0])} />
      <span>{names[kind] ?? 'none'}</span>
      {names[kind] && (
        <button
          className="danger"
          onClick={async () => {
            await deleteFile(kind);
            await refresh();
          }}
        >
          Remove
        </button>
      )}
    </div>
  );
  return (
    <fieldset>
      <legend>Documents (stored in this browser only)</legend>
      {row('resume', 'Resume (PDF)')}
      {row('coverLetter', 'Cover letter')}
    </fieldset>
  );
}

function Backup({ flash, onImported }: { flash: (t: string, err?: boolean) => void; onImported: () => void }) {
  const doExport = async () => {
    const backup = await exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `autofill-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Backup exported (API key not included).');
  };
  const doImport = async (file?: File) => {
    if (!file) return;
    try {
      await importBackup(JSON.parse(await file.text()));
      flash('Imported. Reloading…');
      setTimeout(onImported, 400);
    } catch (e) {
      flash(`Import failed: ${(e as Error).message}`, true);
    }
  };
  return (
    <fieldset>
      <legend>Backup</legend>
      <p>
        Export includes your profile, answer bank, settings (except the API key) and resume as
        base64. Keep it out of git.
      </p>
      <div className="row">
        <button className="primary" onClick={doExport}>
          Export JSON
        </button>
        <label className="f">
          Import JSON (replaces current data)
          <input type="file" accept="application/json,.json" onChange={(e) => doImport(e.target.files?.[0])} />
        </label>
      </div>
    </fieldset>
  );
}
