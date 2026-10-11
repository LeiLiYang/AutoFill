import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { mergeAnswers, rememberAnswers, storedAnswers } from '../../../src/posting/answerStore';
import { memoryStore } from '../../../src/profile/storage';
import { LogCard, type LogCardProps } from '../../../src/review/panel/LogCard';
import { Panel } from '../../../src/review/panel/Panel';
import { withEarlierPosting, type LogPrefill } from '../../../src/tracking/prefill';

const prefill = (over: Partial<LogPrefill> = {}): LogPrefill => ({
  company: 'Acme', category: 'SWE', location: 'montreal', locationText: 'Montreal, QC', date: '2026/10/11', channel: 'website',
  url: 'https://careers.acme.com/jobs/1', formOnly: false, ...over,
});

function render(props: Partial<LogCardProps> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onLog = props.onLog ?? vi.fn().mockResolvedValue({ log: { ok: true, status: 'synced', id: '1', message: 'Logged to your sheet.' } });
  flushSync(() => createRoot(host).render(<LogCard prefill={prefill()} onLog={onLog} {...props} />));
  const button = () => Array.from(host.querySelectorAll('button')).find((b) => /Log application|Logging|Logged/.test(b.textContent ?? ''))!;
  const click = () => flushSync(() => button().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  return { host, onLog, button, click };
}

describe('LogCard: a failed log is never silent', () => {
  it('shows the error when the request throws, and lets the user try again', async () => {
    const { host, button, click } = render({ onLog: vi.fn().mockRejectedValue(new Error('storage quota exceeded')) });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('Could not log: storage quota exceeded'));
    expect(button().textContent).toBe('Log application');
    expect(button().disabled).toBe(false);
  });

  it('explains an orphaned page (the extension was reloaded) instead of flashing back to idle', async () => {
    const { host, click } = render({ onLog: vi.fn().mockRejectedValue(new Error('Extension context invalidated.')) });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('The extension did not respond'));
    expect(host.textContent).toContain('reload this page');
  });

  it('treats no answer at all as a failure', async () => {
    const { host, button, click } = render({ onLog: vi.fn().mockResolvedValue(undefined) });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('The extension did not respond'));
    expect(button().textContent).toBe('Log application');
  });

  it('shows an unexpected background error as it is', async () => {
    const { host, click } = render({ onLog: vi.fn().mockResolvedValue({ log: { ok: false, code: 'error', message: 'Could not log this application: boom' } }) });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('Could not log this application: boom'));
  });
});

describe('LogCard: saving the posting after the log', () => {
  it('logs first, then saves, and reports both', async () => {
    const order: string[] = [];
    const onLog = vi.fn(async () => {
      order.push('log');
      return { log: { ok: true as const, status: 'synced' as const, id: '1', message: 'Logged to your sheet.' } };
    });
    const onSavePosting = vi.fn(async () => {
      order.push('save');
      return { ok: true as const, folder: 'AutoFill/Acme/2026-10-11 SWE', files: [], warnings: ['This is the application form: posting.mhtml is a snapshot of the form.'] };
    });
    const { host, click } = render({ onLog, onSavePosting });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('Posting saved to Downloads/AutoFill/Acme/2026-10-11 SWE.'));
    expect(order).toEqual(['log', 'save']);
    expect(host.textContent).toContain('snapshot of the form');
  });

  it('keeps the log when the save fails, and says the save failed', async () => {
    const onSavePosting = vi.fn().mockRejectedValue(new Error('disk full'));
    const { host, button, click } = render({ onSavePosting });
    click();
    await vi.waitFor(() => expect(host.textContent).toContain('The posting was not saved: disk full'));
    expect(host.textContent).toContain('Logged to your sheet.');
    expect(button().textContent).toBe('Logged');
  });

  it('does not save when the log did not go through, or when the box is unticked', async () => {
    const onSavePosting = vi.fn();
    const dup = render({ onLog: vi.fn().mockResolvedValue({ log: { ok: false, code: 'duplicate', message: 'Already there.', rows: [4] } }), onSavePosting });
    dup.click();
    await vi.waitFor(() => expect(dup.host.textContent).toContain('Already there.'));

    const off = render({ onSavePosting });
    const box = off.host.querySelector('input[type=checkbox]') as HTMLInputElement;
    flushSync(() => box.click());
    off.click();
    await vi.waitFor(() => expect(off.host.textContent).toContain('Logged to your sheet.'));
    expect(onSavePosting).not.toHaveBeenCalled();
  });
});

describe('the card follows the posting on screen', () => {
  it('starts fresh when the page moves to another posting, instead of staying on "Logged"', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onLog = vi.fn().mockResolvedValue({ log: { ok: true, status: 'synced', id: '1', message: 'Logged to your sheet.' } });
    const show = (p: LogPrefill) =>
      flushSync(() =>
        root.render(<Panel frames={[]} filling={false} logOnly prefill={p} onLog={onLog} onScroll={() => {}} onSaveAnswers={vi.fn()} onSavePosting={vi.fn()} onClose={() => {}} />),
      );
    const logButton = () => Array.from(host.querySelectorAll('.logcard button')).find((b) => /Log application|Logged/.test(b.textContent ?? '')) as HTMLButtonElement;
    const summary = () => host.querySelector('.logsummary')!.textContent!;

    show(prefill());
    flushSync(() => logButton().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await vi.waitFor(() => expect(logButton().textContent).toBe('Logged'));

    show(prefill({ company: 'Globex', url: 'https://careers.globex.com/jobs/9' }));
    expect(logButton().textContent).toBe('Log application');
    expect(logButton().disabled).toBe(false);
    expect(summary()).toContain('Globex');
  });
});

describe('a form page borrows what the posting page said', () => {
  it('fills a missing location and the category, without overriding what the page itself stated', () => {
    const form = prefill({ location: '', locationText: '', formOnly: true, category: 'SWE' });
    expect(withEarlierPosting(form, { title: 'Senior Product Manager', location: 'Toronto, ON' })).toMatchObject({ location: 'toronto', locationText: 'Toronto, ON', category: 'PM' });
    expect(withEarlierPosting(prefill(), { title: 'Product Manager', location: 'Toronto, ON' })).toMatchObject({ location: 'montreal', category: 'SWE' });
    expect(withEarlierPosting(form, null)).toBe(form);
    // A location the tracker cannot place is still shown, so the user knows what to pick.
    expect(withEarlierPosting(form, { location: 'Lunar base' })).toMatchObject({ location: '', locationText: 'Lunar base' });
  });
});

describe('answers recorded per application', () => {
  const a = (question: string, answer: string, source: 'autofill' | 'ai' | 'manual' = 'autofill') => ({ question, answer, source });

  it('merges a later reading over an earlier one and keeps questions no longer on screen', () => {
    expect(mergeAnswers([a('First name', 'Ada'), a('Why us?', 'Draft', 'ai')], [a('why us', 'My rewrite', 'manual'), a('Start date', 'May')])).toEqual([
      a('First name', 'Ada'),
      a('why us', 'My rewrite', 'manual'),
      a('Start date', 'May'),
    ]);
  });

  it('builds up across the steps of one application and keeps applications apart', async () => {
    const kv = memoryStore();
    await rememberAnswers(kv, 'https://x/job/1', [a('First name', 'Ada')]);
    const merged = await rememberAnswers(kv, 'https://x/job/1', [a('Why us?', 'Because.', 'manual')]);
    expect(merged.map((m) => m.question)).toEqual(['First name', 'Why us?']);
    expect(await storedAnswers(kv, 'https://x/job/2')).toEqual([]);
    // A reading of a page with no form does not wipe what is stored.
    expect(await rememberAnswers(kv, 'https://x/job/1', [])).toHaveLength(2);
    expect(await storedAnswers(kv, 'https://x/job/1')).toHaveLength(2);
  });
});

describe('LogCard: one line when nothing needs the user', () => {
  it('shows a summary with the confirm button, and opens the fields on Edit', () => {
    const { host } = render();
    expect(host.querySelector('.logsummary')!.textContent).toBe('Acme · SWE · montreal · website · 2026/10/11');
    expect(host.querySelector('.logfields')).toBeNull();
    const edit = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Edit')!;
    flushSync(() => edit.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelectorAll('.logfields input, .logfields select').length).toBe(6);
  });

  it('opens by itself when something is missing', () => {
    const { host, button } = render({ prefill: prefill({ location: '', locationText: '' }) });
    expect(host.querySelector('.logfields')).not.toBeNull();
    expect(host.textContent).toContain('No location found on this page. Pick one to log.');
    expect(button().disabled).toBe(true);
  });
});
