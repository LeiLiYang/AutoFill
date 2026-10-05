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

type Tab = 'profile' | 'history' | 'answers' | 'files' | 'settings' | 'backup';
const TABS: [Tab, string][] = [
  ['profile', 'Contact & work'],
  ['history', 'Education & experience'],
  ['answers', 'Answer bank'],
  ['files', 'Resume'],
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

  const save = async () => {
    try {
      await saveProfile(profile);
      await saveSettings(settings);
      setDirty(false);
      flash('Saved locally.');
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
                {check('work.requiresSponsorship', 'I require visa sponsorship')}
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
        <AnswerBank answers={profile.answerBank} onChange={(a) => editProfile('answerBank', a)} />
      )}

      {tab === 'files' && <Files flash={flash} />}

      {tab === 'settings' &&
        group(
          'Integrations',
          <>
            <div className="grid">
              <label className="f">
                Google Sheet ID
                <input
                  type="text"
                  value={settings.sheetId}
                  onChange={(e) => editSettings('sheetId', e.target.value.trim())}
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
              <label className="f">
                Anthropic API key (optional, stored locally)
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.anthropicApiKey}
                  onChange={(e) => editSettings('anthropicApiKey', e.target.value.trim())}
                />
              </label>
              <label className="f">
                Model name
                <input
                  type="text"
                  value={settings.model}
                  onChange={(e) => editSettings('model', e.target.value.trim())}
                />
              </label>
            </div>
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
            <small className="hint">
              The API key is only sent to api.anthropic.com for free-text answers, and is never
              included in exports.
            </small>
          </>,
        )}

      {tab === 'backup' && <Backup flash={flash} onImported={() => location.reload()} />}

      <div className="savebar">
        {msg && <span className={`msg ${msg.err ? 'err' : 'ok'}`}>{msg.text}</span>}
        {dirty && <span className="msg">Unsaved changes</span>}
        <button className="primary" onClick={save} disabled={!dirty}>
          Save
        </button>
      </div>
    </div>
  );
}

function AnswerBank({ answers, onChange }: { answers: Answer[]; onChange: (a: Answer[]) => void }) {
  const update = (i: number, patch: Partial<Answer>) =>
    onChange(
      answers.map((a, j) => (j === i ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)),
    );
  return (
    <fieldset>
      <legend>Answer bank</legend>
      <small className="hint">
        Past answers to open-ended questions. Used first for matching, and as style examples for
        AI drafts.
      </small>
      {answers.map((a, i) => (
        <div className="entry" key={a.id}>
          <label className="f">
            Question
            <input type="text" value={a.question} onChange={(e) => update(i, { question: e.target.value })} />
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
        + Add answer
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
