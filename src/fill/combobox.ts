import type { FieldOption } from '../adapters/types';
import { normalize } from '../detect/normalize';
import { MIN_OPTION_SCORE, pickOption } from './choice';
import { safeClick, safeClickDeep, safeKey, safeMouseDown } from './safety';
import { dispatchInput, setNativeValue } from './text';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 1500, interval = 50): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(interval);
  }
}

const OPTION_SELECTOR = '[role="option"], [class*="option" i][id*="option"], li[data-automation-id*="promptOption"], [data-automation-id="promptOption"]';

/** Options currently shown for a combobox: its own listbox if linked, else any visible listbox. */
function visibleOptions(input: HTMLElement): HTMLElement[] {
  const doc = input.ownerDocument;
  const linkedId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
  const linked = linkedId ? doc.getElementById(linkedId) : null;
  const scope: ParentNode = linked ?? doc;
  return Array.from(scope.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
    (o) => o.getAttribute('aria-hidden') !== 'true' && (o.textContent ?? '').trim() !== '',
  );
}

const optionText = (e: HTMLElement) => (e.textContent ?? '').replace(/\s+/g, ' ').trim();

const toFieldOptions = (els: HTMLElement[]): FieldOption[] =>
  els.map((e) => ({ text: optionText(e), value: e.getAttribute('data-value') ?? e.id, element: e }));

function typeInto(input: HTMLElement, text: string) {
  if (input instanceof HTMLInputElement) {
    setNativeValue(input, text);
    dispatchInput(input, text);
  }
}

/** Does the control now show something that matches the chosen option? */
function showsValue(input: HTMLElement, optionText: string): boolean {
  const n = normalize(optionText);
  const container = input.closest('[class*="control" i], [class*="select" i], [data-automation-id]') ?? input.parentElement;
  const text = normalize(container?.textContent ?? '');
  const typed = normalize((input as HTMLInputElement).value ?? '');
  return (!!n && (text.includes(n) || typed === n));
}

export interface ComboboxResult {
  ok: boolean;
  chosen?: string;
  score?: number;
  /** What the dropdown actually offered, so a failure can say why nothing matched. */
  offered?: string[];
}

/**
 * Open a custom dropdown (react-select, Workday listboxes, ...), search for the target, and select
 * the matching option with simulated user events. Never presses Enter outside the combobox.
 */
export async function fillCombobox(input: HTMLElement, targets: string[]): Promise<ComboboxResult> {
  const control = input.closest<HTMLElement>('[class*="control" i]') ?? input;

  // Options already on screen before we open this control belong to some other (possibly stuck-open)
  // dropdown. Ignore them, unless this control is explicitly linked to its own listbox.
  const linked = !!(input.getAttribute('aria-controls') || input.getAttribute('aria-owns'));
  const stale = linked ? new Set<HTMLElement>() : new Set(visibleOptions(input));
  const ours = () => visibleOptions(input).filter((o) => !stale.has(o));

  input.focus();
  safeMouseDown(control);
  if (!ours().length) safeClick(control);
  if (!ours().length) safeKey(input, 'ArrowDown');

  const attempt = async (query: string) => {
    typeInto(input, query);
    return waitFor(() => {
      const els = ours();
      return els.length ? els : null;
    });
  };

  // First try a filtered search on the primary target, then fall back to the unfiltered list.
  let els = (await attempt(targets[0] ?? '')) ?? [];
  let picked = els.length ? pickOption(toFieldOptions(els), targets) : null;
  if (!picked || picked.score < MIN_OPTION_SCORE) {
    els = (await attempt('')) ?? [];
    picked = els.length ? pickOption(toFieldOptions(els), targets) : null;
  }

  if (!picked || picked.score < MIN_OPTION_SCORE) {
    const offered = els.map(optionText).slice(0, 12);
    typeInto(input, '');
    safeKey(input, 'Escape');
    return { ok: false, offered };
  }

  const optionEl = picked.option.element!;
  const selected = () => showsValue(input, picked!.option.text) || !ours().includes(optionEl);

  safeClickDeep(optionEl);
  await sleep(80);
  let ok = selected();
  if (!ok) {
    // Some listboxes select on keyboard activation only: hover the option, then press Enter on it.
    optionEl.dispatchEvent(new (optionEl.ownerDocument.defaultView as any).MouseEvent('mouseover', { bubbles: true }));
    safeKey(optionEl, 'Enter');
    await sleep(80);
    ok = selected();
  }
  if (!ok) safeKey(input, 'Escape');
  return { ok, chosen: picked.option.text, score: picked.score, offered: els.map(optionText).slice(0, 12) };
}
