import type { FieldDescriptor, FillOptions, FillResult, FillValue } from '../adapters/types';
import { boolTargets, chooseInGroup, selectNative, setCheckbox } from './choice';
import { fillCombobox } from './combobox';
import { attachFile, dropFile, findDropzone } from './file';
import { fillText, setNativeValue, toIsoDate } from './text';

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

/** Fill one field based on its kind. Adapters call this unless they need a custom widget path. */
export async function defaultFill(d: FieldDescriptor, v: FillValue, opts: FillOptions): Promise<FillResult> {
  const el = d.element;
  switch (d.kind) {
    case 'text':
    case 'textarea': {
      const done = fillText(el as HTMLInputElement | HTMLTextAreaElement, textOf(v));
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
      return picked ? ok(picked.option.text) : fail('no matching option');
    }
    case 'checkbox': {
      if (v.type === 'bool' && (d.options?.length ?? 1) <= 1) {
        return setCheckbox(el as HTMLInputElement, v.value) ? ok() : fail('checkbox did not change');
      }
      const picked = chooseInGroup(d.options ?? [], targetsOf(v));
      return picked ? ok(picked.option.text) : fail('no matching option');
    }
    case 'combobox': {
      const res = await fillCombobox(el, targetsOf(v));
      return res.ok ? ok(res.chosen) : fail('no matching option');
    }
    case 'file': {
      if (v.type !== 'file') return fail('not a file value');
      const file = await opts.getFile(v.fileKind);
      if (!file) return fail(`no ${v.fileKind} stored`);
      const input = el as HTMLInputElement;
      if (attachFile(input, file)) return ok(file.name);
      const zone = findDropzone(input);
      return zone && dropFile(zone, file) ? ok(file.name) : fail('could not attach file');
    }
  }
}

export { setNativeValue };
