import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { FieldReport } from '../../../src/adapters/types';
import { clearHighlights, highlight, levelFor } from '../../../src/review/highlight';
import { Panel } from '../../../src/review/panel/Panel';
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
    const onSaveAnswers = vi.fn().mockResolvedValue(2);
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
});
