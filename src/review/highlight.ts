import type { FieldReport } from '../adapters/types';

export type Level = 'green' | 'yellow' | 'red';

export const LEVEL_COLORS: Record<Level, string> = {
  green: '#1e9e4a',
  yellow: '#e6a700',
  red: '#d93025',
};

/** green = filled with confidence, yellow = needs review, red = required and still empty. */
export function levelFor(r: FieldReport): Level | null {
  if (r.emptyRequired) return 'red';
  if (r.status === 'low-confidence' || r.status === 'ai' || r.status === 'failed') return 'yellow';
  if (r.status === 'filled') return 'green';
  return null;
}

/** The visible element to outline: radios/file inputs/comboboxes are often hidden or tiny. */
export function highlightTarget(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'radio' || el.type === 'checkbox') {
      return el.closest<HTMLElement>('fieldset, [role="radiogroup"], [role="group"]') ?? el.parentElement ?? el;
    }
    if (el.type === 'file') {
      return el.closest<HTMLElement>('[class*="drop" i], [class*="upload" i], [class*="attach" i], fieldset, .field, div') ?? el;
    }
  }
  if (el.getAttribute('role') === 'combobox') {
    return el.closest<HTMLElement>('[class*="control" i]') ?? el;
  }
  return el;
}

const originals = new WeakMap<HTMLElement, { outline: string; offset: string }>();
const marked = new Set<HTMLElement>();

export function highlight(el: HTMLElement, level: Level): void {
  const target = highlightTarget(el);
  if (!originals.has(target)) {
    originals.set(target, {
      outline: target.style.getPropertyValue('outline'),
      offset: target.style.getPropertyValue('outline-offset'),
    });
  }
  target.style.setProperty('outline', `2px solid ${LEVEL_COLORS[level]}`, 'important');
  target.style.setProperty('outline-offset', '2px', 'important');
  target.setAttribute('data-autofill-level', level);
  marked.add(target);
}

export function clearHighlights(): void {
  for (const t of marked) {
    const o = originals.get(t);
    t.style.removeProperty('outline');
    t.style.removeProperty('outline-offset');
    if (o?.outline) t.style.setProperty('outline', o.outline);
    if (o?.offset) t.style.setProperty('outline-offset', o.offset);
    t.removeAttribute('data-autofill-level');
  }
  marked.clear();
}

/** Scroll a field into view, focus it when possible, and pulse its outline. */
export function scrollToField(el: HTMLElement): void {
  const target = highlightTarget(el);
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (el.offsetParent !== null) el.focus({ preventScroll: true });
  const prev = target.style.getPropertyValue('outline-offset');
  target.style.setProperty('outline-offset', '6px', 'important');
  setTimeout(() => (prev ? target.style.setProperty('outline-offset', prev, 'important') : target.style.setProperty('outline-offset', '2px', 'important')), 500);
}
