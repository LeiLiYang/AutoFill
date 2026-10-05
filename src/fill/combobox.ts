import type { FieldOption } from '../adapters/types';
import { normalize } from '../detect/normalize';
import { MIN_OPTION_SCORE, pickOption } from './choice';
import { safeClick, safeKey, safeMouseDown } from './safety';
import { dispatchInput, setNativeValue } from './text';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null | undefined | false, timeout = 1500, interval = 50): Promise<T | null> {
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

const toFieldOptions = (els: HTMLElement[]): FieldOption[] =>
  els.map((e) => ({ text: (e.textContent ?? '').trim(), value: e.getAttribute('data-value') ?? e.id, element: e }));

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

/**
 * Open a custom dropdown (react-select, Workday listbox, ...), search for the target, and click
 * the matching option with simulated user events. Never presses Enter outside the combobox.
 */
export async function fillCombobox(
  input: HTMLElement,
  targets: string[],
): Promise<{ ok: boolean; chosen?: string; score?: number }> {
  const control = input.closest<HTMLElement>('[class*="control" i]') ?? input;
  input.focus();
  safeMouseDown(control);
  if (!visibleOptions(input).length) safeClick(control);
  if (!visibleOptions(input).length) safeKey(input, 'ArrowDown');

  const attempt = async (query: string) => {
    typeInto(input, query);
    return waitFor(() => {
      const els = visibleOptions(input);
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
    typeInto(input, '');
    safeKey(input, 'Escape');
    return { ok: false };
  }

  const optionEl = picked.option.element!;
  safeClick(optionEl);
  await sleep(60);
  const ok = showsValue(input, picked.option.text) || !visibleOptions(input).includes(optionEl);
  if (!ok) safeKey(input, 'Escape');
  return { ok, chosen: picked.option.text, score: picked.score };
}
