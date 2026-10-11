import type { FieldDescriptor, FillOptions, FillResult, FillValue } from '../adapters/types';
import { boolTargets, chooseInGroup, selectNative, setCheckbox } from './choice';
import { fillCombobox } from './combobox';
import { attachFile, dropFile, findDropzone } from './file';
import { fillEditable, fillText, setNativeValue, toIsoDate } from './text';

const ok = (detail?: string): FillResult => ({ status: 'filled', detail });
const fail = (detail: string): FillResult => ({ status: 'failed', detail });

function targetsOf(v: FillValue): string[] {
  switch (v.type) {
    case 'text': return [v.text];
    case 'bool': return boolTargets(v.value);
    case 'choice': return v.targets;
    case 'file': return [];
  }
}

function textOf(v: FillValue): string {
  switch (v.type) {
    case 'text': return v.text;
    case 'bool': return v.value ? 'Yes' : 'No';
    case 'choice': return v.text;
    case 'file': return '';
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A native, visible file input shows its own file name; a hidden one relies on the page to show it. */
function isVisible(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

const pageShows = (input: HTMLInputElement, name: string) => !!input.ownerDocument.body.textContent?.includes(name);

/**
 * Attach a file to an input, then check the page actually registered it. Upload widgets with a hidden
 * input (Workday) sometimes ignore a programmatic `change` and only react to a drop on their drop
 * zone, so if the page does not show the file name we also drop it there. If we still cannot confirm,
 * say so rather than claiming success.
 */
async function attachWithVerification(input: HTMLInputElement, file: File): Promise<FillResult> {
  const attached = attachFile(input, file);
  const zone = findDropzone(input) ?? input.closest<HTMLElement>('[data-automation-id*="drop" i], [class*="drop" i]');

  if (attached && isVisible(input)) return ok(file.name); // plain visible input: the browser shows the name itself
  await delay(600);
  if (pageShows(input, file.name)) return ok(file.name);

  if (zone && dropFile(zone, file)) {
    await delay(800);
    if (pageShows(input, file.name)) return ok(file.name);
  }
  if (!attached && !zone) return fail('could not attach file');
  return { status: 'low-confidence', detail: `attached ${file.name} but the page does not show it yet: check the upload` };
}

/** Fill one field based on its kind. Adapters call this unless they need a custom widget path. */
export async function defaultFill(d: FieldDescriptor, v: FillValue, opts: FillOptions): Promise<FillResult> {
  const el = d.element;
  switch (d.kind) {
    case 'text':
    case 'textarea': {
      const native = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const done = native ? fillText(el, textOf(v)) : fillEditable(el, textOf(v));
      return done ? ok() : fail('input rejected the value');
    }
    case 'date': {
      const iso = toIsoDate(textOf(v));
      if (!iso) return fail('could not convert value to a date');
      return fillText(el as HTMLInputElement, iso) ? ok() : fail('date input rejected the value');
    }
    case 'select': {
      const picked = selectNative(el as HTMLSelectElement, targetsOf(v));
      return picked ? ok(picked.option.text) : fail('no matching option');
    }
    case 'radio': {
      const picked = chooseInGroup(d.options ?? [], targetsOf(v));
      if (!picked) return fail(`no matching option${d.options?.length ? `. Offered: ${d.options.map((o) => o.text).join(', ')}` : ''}`);
      if (picked.unconfirmed) return { status: 'low-confidence', detail: `clicked “${picked.option.text}” but the page showed no change: check it` };
      return ok(picked.option.text);
    }
    case 'checkbox': {
      if (v.type === 'bool' && (d.options?.length ?? 1) <= 1) {
        return setCheckbox(el, v.value) ? ok() : fail('checkbox did not change');
      }
      const picked = chooseInGroup(d.options ?? [], targetsOf(v));
      return picked ? ok(picked.option.text) : fail('no matching option');
    }
    case 'combobox': {
      const res = await fillCombobox(el, targetsOf(v));
      if (res.ok) return ok(res.chosen);
      // Say what the dropdown offered, so a mismatch ("QC" vs "Quebec") is visible instead of silent.
      const offered = res.offered?.length ? ` Offered: ${res.offered.join(', ')}` : ' The dropdown showed no options.';
      return fail(`no matching option for “${targetsOf(v)[0] ?? ''}”.${offered}`);
    }
    case 'file': {
      if (v.type !== 'file') return fail('not a file value');
      const file = await opts.getFile(v.fileKind);
      if (!file) return fail(`no ${v.fileKind} stored`);
      return attachWithVerification(el as HTMLInputElement, file);
    }
  }
}

export { setNativeValue };
