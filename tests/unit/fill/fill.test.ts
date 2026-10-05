import { describe, expect, it } from 'vitest';
import { selectNative, chooseInGroup, setCheckbox, pickOption } from '../../../src/fill/choice';
import { fillCombobox } from '../../../src/fill/combobox';
import { attachFile } from '../../../src/fill/file';
import { fillText, toIsoDate } from '../../../src/fill/text';
import { descriptors, mount } from '../helpers';

describe('fillText with a React-style controlled input', () => {
  it('uses the native setter so the framework sees a change', () => {
    mount('<input id="x" type="text">');
    const input = document.getElementById('x') as HTMLInputElement;

    // React patches the instance `value` property to track the last value it knows about.
    let tracked = '';
    const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => nativeDesc.get!.call(input),
      set(v) {
        tracked = String(v);
        nativeDesc.set!.call(input, v);
      },
    });
    const changes: string[] = [];
    input.addEventListener('input', () => {
      const current = nativeDesc.get!.call(input);
      if (current !== tracked) {
        tracked = current;
        changes.push(current); // "onChange" only fires when the tracker differs
      }
    });

    expect(fillText(input, 'Ada')).toBe(true);
    expect(changes).toEqual(['Ada']);
  });

  it('dispatches input, change and focusout', () => {
    mount('<textarea id="x"></textarea>');
    const el = document.getElementById('x') as HTMLTextAreaElement;
    const seen: string[] = [];
    for (const t of ['input', 'change', 'focusout']) el.addEventListener(t, () => seen.push(t));
    fillText(el, 'hello');
    expect(seen).toEqual(['input', 'change', 'focusout']);
  });

  it('refuses readonly and password fields', () => {
    mount('<input id="r" readonly><input id="p" type="password">');
    expect(fillText(document.getElementById('r') as HTMLInputElement, 'x')).toBe(false);
    expect(fillText(document.getElementById('p') as HTMLInputElement, 'x')).toBe(false);
  });
});

describe('toIsoDate', () => {
  it.each([
    ['2026-05-04', '2026-05-04'],
    ['2026/5/4', '2026-05-04'],
    ['May 4, 2026', '2026-05-04'],
    ['ASAP', null],
    ['2 weeks', null],
  ])('%s → %s', (input, expected) => expect(toIsoDate(input)).toBe(expected));
});

describe('native selects', () => {
  const html = (opts: string[]) =>
    `<label for="s">L</label><select id="s"><option value="">Select...</option>${opts.map((o, i) => `<option value="${i + 1}">${o}</option>`).join('')}</select>`;

  it('maps boolean-ish targets to Yes/No variants', () => {
    mount(html(['Yes, I am authorized', 'No, I am not authorized']));
    const sel = document.getElementById('s') as HTMLSelectElement;
    const picked = selectNative(sel, ['yes', 'y', 'true']);
    expect(picked?.option.text).toBe('Yes, I am authorized');
    expect(sel.value).toBe('1');
  });

  it('does not confuse "No" with "Not authorized"-style options', () => {
    mount(html(['Not sure', 'No']));
    const sel = document.getElementById('s') as HTMLSelectElement;
    expect(selectNative(sel, ['no', 'n', 'false'])?.option.text).toBe('No');
  });

  it('matches country aliases and ignores the placeholder', () => {
    mount(html(['United States', 'Canada']));
    const sel = document.getElementById('s') as HTMLSelectElement;
    expect(selectNative(sel, ['Canada', 'canada', 'ca'])?.option.text).toBe('Canada');
  });

  it('returns null and leaves the select alone when nothing matches', () => {
    mount(html(['Red', 'Blue']));
    const sel = document.getElementById('s') as HTMLSelectElement;
    expect(selectNative(sel, ['Canada'])).toBeNull();
    expect(sel.value).toBe('');
  });

  it('picks the decline option for EEO selects', () => {
    mount(html(['Male', 'Female', 'I do not wish to answer']));
    const sel = document.getElementById('s') as HTMLSelectElement;
    const picked = selectNative(sel, ['Decline to self-identify', 'decline to self identify', 'i do not wish to answer']);
    expect(picked?.option.text).toBe('I do not wish to answer');
  });
});

describe('radios and checkboxes', () => {
  it('groups radios by name and clicks the matching option', () => {
    const [d] = descriptors(`
      <fieldset><legend>Are you willing to relocate?</legend>
        <label><input type="radio" name="r" value="y"> Yes</label>
        <label><input type="radio" name="r" value="n"> No</label>
      </fieldset>`);
    expect(d!.kind).toBe('radio');
    expect(d!.label).toBe('Are you willing to relocate?');
    expect(d!.options!.map((o) => o.text)).toEqual(['Yes', 'No']);
    const picked = chooseInGroup(d!.options!, ['no', 'n', 'false']);
    expect(picked?.option.text).toBe('No');
    expect((document.querySelector('input[value=n]') as HTMLInputElement).checked).toBe(true);
  });

  it('sets a lone checkbox to the desired state both ways', () => {
    mount('<input id="c" type="checkbox">');
    const c = document.getElementById('c') as HTMLInputElement;
    expect(setCheckbox(c, true)).toBe(true);
    expect(c.checked).toBe(true);
    expect(setCheckbox(c, false)).toBe(true);
    expect(c.checked).toBe(false);
  });

  it('pickOption skips placeholders', () => {
    const picked = pickOption([{ text: 'Select...', value: '' }, { text: 'Select', value: 'x' }], ['select']);
    expect(picked).toBeNull();
  });
});

describe('fillCombobox with a react-select-like widget', () => {
  function mountSelect(all: string[]) {
    mount('<div class="select__control" id="ctl"><div class="select__value"></div><input id="inp" role="combobox" aria-autocomplete="list"></div>');
    const ctl = document.getElementById('ctl')!;
    const inp = document.getElementById('inp') as HTMLInputElement;
    const value = ctl.querySelector('.select__value')!;
    const renderMenu = (filter: string) => {
      document.getElementById('menu')?.remove();
      const menu = document.createElement('div');
      menu.id = 'menu';
      menu.setAttribute('role', 'listbox');
      for (const text of all.filter((o) => o.toLowerCase().includes(filter.toLowerCase()))) {
        const o = document.createElement('div');
        o.setAttribute('role', 'option');
        o.textContent = text;
        o.addEventListener('click', () => {
          value.textContent = text;
          menu.remove();
        });
        menu.appendChild(o);
      }
      document.body.appendChild(menu); // portal, outside the control
    };
    ctl.addEventListener('mousedown', () => renderMenu(inp.value));
    inp.addEventListener('input', () => renderMenu(inp.value));
    return { value, inp };
  }

  it('opens, searches and selects the option', async () => {
    const { value, inp } = mountSelect(['United States', 'Canada', 'Cambodia']);
    const res = await fillCombobox(inp, ['Canada', 'canada', 'ca']);
    expect(res.ok).toBe(true);
    expect(value.textContent).toBe('Canada');
  });

  it('falls back to the unfiltered list when the search finds nothing', async () => {
    const { value, inp } = mountSelect(['United States of America', 'Canada']);
    const res = await fillCombobox(inp, ['USA', 'united states', 'united states of america']);
    expect(res.ok).toBe(true);
    expect(value.textContent).toBe('United States of America');
  });

  it('fails cleanly and clears the query when no option matches', async () => {
    const { value, inp } = mountSelect(['Red', 'Blue']);
    const res = await fillCombobox(inp, ['Canada']);
    expect(res.ok).toBe(false);
    expect(value.textContent).toBe('');
    expect(inp.value).toBe('');
  });
});

describe('attachFile', () => {
  it('attaches a file through DataTransfer and fires change', () => {
    mount('<input id="f" type="file">');
    const input = document.getElementById('f') as HTMLInputElement;
    // jsdom has no DataTransfer and a read-only FileList: stub both.
    class FakeDT {
      private list: File[] = [];
      items = { add: (f: File) => void this.list.push(f) };
      get files() {
        return this.list as unknown as FileList;
      }
    }
    (window as any).DataTransfer = FakeDT;
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: null });
    let changed = 0;
    input.addEventListener('change', () => changed++);

    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
    expect(attachFile(input, file)).toBe(true);
    expect(input.files![0]!.name).toBe('cv.pdf');
    expect(changed).toBe(1);
  });
});
