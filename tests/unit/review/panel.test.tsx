import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { FieldReport } from '../../../src/adapters/types';
import { clearHighlights, highlight, levelFor } from '../../../src/review/highlight';
import { Panel, describeSave, reasonFor } from '../../../src/review/panel/Panel';
import { mount } from '../helpers';

const rep = (over: Partial<FieldReport>): FieldReport => ({
  id: 'x', label: 'Field', kind: 'text', confidence: 0.9, status: 'filled', required: false, emptyRequired: false, ...over,
});

describe('levelFor', () => {
  it('maps statuses to the green/yellow/red scheme', () => {
    expect(levelFor(rep({ status: 'filled' }))).toBe('green');
    expect(levelFor(rep({ status: 'low-confidence' }))).toBe('yellow');
    expect(levelFor(rep({ status: 'ai' }))).toBe('yellow');
    expect(levelFor(rep({ status: 'unmatched', required: true, emptyRequired: true }))).toBe('red');
    expect(levelFor(rep({ status: 'unmatched' }))).toBeNull();
    expect(levelFor(rep({ status: 'skipped-existing' }))).toBeNull();
  });
});

describe('highlight', () => {
  it('outlines with !important and restores the original style', () => {
    mount('<input id="a" style="outline: 1px dotted blue">');
    const el = document.getElementById('a')!;
    highlight(el, 'red');
    expect(el.style.getPropertyValue('outline')).toContain('#d93025');
    expect(el.style.getPropertyPriority('outline')).toBe('important');
    clearHighlights();
    expect(el.style.getPropertyValue('outline')).toContain('blue');
    expect(el.hasAttribute('data-autofill-level')).toBe(false);
  });

  it('outlines the whole fieldset for radio groups', () => {
    mount('<fieldset id="g"><input type="radio" id="r1" name="n"></fieldset>');
    highlight(document.getElementById('r1')!, 'green');
    expect(document.getElementById('g')!.getAttribute('data-autofill-level')).toBe('green');
    clearHighlights();
  });
});

describe('Panel', () => {
  const render = (props: Partial<Parameters<typeof Panel>[0]> = {}) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onScroll = vi.fn();
    const onSaveAnswers = vi.fn().mockResolvedValue({ saved: 2, found: 2, scanned: 9, unreachable: 0 });
    const onSavePosting = vi.fn().mockResolvedValue({ ok: false, code: 'form-only', message: 'Open the job posting page.' });
    flushSync(() =>
      root.render(
        <Panel
          filling={false}
          onScroll={onScroll}
          onSaveAnswers={onSaveAnswers}
          onSavePosting={onSavePosting}
          onClose={() => {}}
          frames={[
            {
              frameId: 3, frameUrl: 'https://x', isTop: false, adapter: 'greenhouse',
              reports: [
                rep({ id: 'a', label: 'First name', status: 'filled' }),
                rep({ id: 'b', label: 'Phone', status: 'low-confidence' }),
                rep({ id: 'c', label: 'Why us?', status: 'unmatched', required: true, emptyRequired: true, detail: 'free-text question' }),
                rep({ id: 'd', label: 'Favorite color', status: 'unmatched' }),
              ],
            },
          ]}
          {...props}
        />,
      ),
    );
    return { host, onScroll, onSaveAnswers, onSavePosting };
  };

  it('shows the form-only guidance when the posting cannot be saved from this page', async () => {
    const { host, onSavePosting } = render();
    const btn = Array.from(host.querySelectorAll('button.action')).find((b) => b.textContent === 'Save posting') as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('Open the job posting page.'));
    expect(onSavePosting).toHaveBeenCalled();
  });

  it('lists required-empty and review items, and scrolls to the clicked field in its frame', () => {
    const { host, onScroll } = render();
    const text = host.textContent!;
    expect(text).toContain('1 filled');
    expect(text).toContain('1 review');
    expect(text).toContain('1 required empty');
    expect(text).toContain('Why us?');
    expect(text).toContain('Phone');
    expect(text).not.toContain('Favorite color'); // collapsed under "Not filled"

    const row = Array.from(host.querySelectorAll('button.row')).find((b) => b.textContent!.includes('Why us?'))!;
    flushSync(() => (row as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onScroll).toHaveBeenCalledWith(3, 'c');
  });

  it('saves answers via the button and reports the count', async () => {
    const { host, onSaveAnswers } = render();
    const btn = Array.from(host.querySelectorAll('button.action'))[0] as HTMLElement;
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('Saved 2 answers'));
    expect(onSaveAnswers).toHaveBeenCalled();
  });

  it('shows a visible message when the save request fails instead of doing nothing', async () => {
    const { host } = render({ onSaveAnswers: vi.fn().mockRejectedValue(new Error('extension reloaded')) });
    (host.querySelector('button.action') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('Could not save: extension reloaded'));
  });
});

describe('describeSave: always says what happened', () => {
  it.each([
    [{ saved: 1, found: 1, scanned: 5, unreachable: 0 }, 'Saved 1 answer to your answer bank.'],
    [{ saved: 3, found: 3, scanned: 5, unreachable: 0 }, 'Saved 3 answers to your answer bank.'],
    [{ saved: 0, found: 2, scanned: 5, unreachable: 0 }, 'Found 2 answers, already in your answer bank unchanged.'],
    [{ saved: 0, found: 0, scanned: 0, unreachable: 1 }, "Couldn't read the form"],
    [{ saved: 0, found: 0, scanned: 14, unreachable: 0 }, 'looked at 14 fields'],
  ])('%j', (result, expected) => expect(describeSave(result)).toContain(expected));

  it('explains what to do when nothing qualified', () => {
    const msg = describeSave({ saved: 0, found: 0, scanned: 1, unreachable: 0 });
    expect(msg).toContain('looked at 1 field)');
    expect(msg).toMatch(/Type your own answers/);
    expect(msg).toMatch(/profile fields are not saved/);
  });
});

describe('reasonFor: short enough to read at a glance, with the full text kept for the tooltip', () => {
  it.each([
    [rep({ status: 'filled' }), 'Filled', undefined],
    [rep({ status: 'no-data', detail: 'no profile data for gpa' }), 'Nothing in your profile for this', undefined],
    [rep({ status: 'ai', detail: 'AI draft from your profile and posting: review before submitting' }), 'AI draft. Review it before submitting', 'AI draft from your profile and posting: review before submitting'],
    [rep({ status: 'low-confidence', detail: 'matched by AI: check it' }), 'Field matched by AI. Check it', 'matched by AI: check it'],
    [rep({ status: 'unmatched', detail: 'free-text question: no saved answer matches. No Anthropic API key is set.' }), 'No saved answer. No Anthropic API key is set.', expect.any(String)],
    [rep({ status: 'unmatched', detail: 'free-text question: Rate limited by OpenAI. Wait a moment and fill again.' }), 'Rate limited by OpenAI. Wait a moment and fill again.', expect.any(String)],
    [rep({ status: 'failed', detail: 'no matching option for “QC”. Offered: Quebec, Ontario, Alberta, Manitoba' }), 'No option matches “QC”', 'no matching option for “QC”. Offered: Quebec, Ontario, Alberta, Manitoba'],
    [rep({ status: 'low-confidence', detail: 'attached cv.pdf but the page does not show it yet: check the upload' }), 'cv.pdf: upload not confirmed. Check it', expect.any(String)],
    [rep({ status: 'failed', detail: 'something nobody anticipated' }), 'something nobody anticipated', undefined],
  ])('%#', (report, short, full) => {
    expect(reasonFor(report)).toEqual(full === undefined ? { short } : { short, full });
  });
});

describe('Panel layout', () => {
  it('puts the reason under the field name, and keeps the long explanation in the tooltip', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const long = 'no matching option for “QC”. Offered: Quebec, Ontario, Alberta, Manitoba, Saskatchewan, British Columbia';
    flushSync(() =>
      createRoot(host).render(
        <Panel
          filling={false}
          onScroll={() => {}}
          onSaveAnswers={vi.fn()}
          onSavePosting={vi.fn()}
          onClose={() => {}}
          frames={[{ frameId: 0, frameUrl: 'https://x', isTop: true, adapter: 'generic', reports: [rep({ id: 'a', label: 'Province', status: 'failed', detail: long }), rep({ id: 'b', label: 'Shoe size', status: 'unmatched' })] }]}
        />,
      ),
    );
    const row = host.querySelector('button.row')!;
    expect(row.querySelector('.text .label')!.textContent).toBe('Province');
    expect(row.querySelector('.text .why')!.textContent).toBe('No option matches “QC”');
    expect(row.getAttribute('title')).toBe(long);
    expect(host.querySelector('.counts')!.textContent).toBe('0 filled1 review0 required empty1 not filled');
  });
});
