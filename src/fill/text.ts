import { isFillable } from './safety';

type TextLike = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Set a value the way a user would, so React/Angular/Vue-controlled inputs notice:
 * use the prototype's native setter (bypassing the framework's patched instance setter),
 * then fire the events frameworks listen to.
 */
export function setNativeValue(el: TextLike, value: string): void {
  const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const proto =
    el.tagName === 'TEXTAREA'
      ? (win ?? window).HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? (win ?? window).HTMLSelectElement.prototype
        : (win ?? window).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

export function dispatchInput(el: Element, data: string | null = null): void {
  const win = el.ownerDocument.defaultView as any;
  el.dispatchEvent(new win.InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data }));
}

export function dispatchChange(el: Element): void {
  const win = el.ownerDocument.defaultView as any;
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function blurEl(el: HTMLElement): void {
  // blur() emits focusout natively when the element really had focus (e.g. a background tab
  // may refuse focus); fall back to a synthetic one so frameworks still see the blur.
  let native = false;
  const mark = () => (native = true);
  el.addEventListener('focusout', mark, { once: true });
  el.blur();
  el.removeEventListener('focusout', mark);
  if (!native) {
    const win = el.ownerDocument.defaultView as any;
    el.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));
  }
}

/** Fill a text-like control. Returns true if the control ends up holding the value. */
export function fillText(el: HTMLInputElement | HTMLTextAreaElement, text: string): boolean {
  if (!isFillable(el) || el.readOnly) return false;
  el.focus();
  setNativeValue(el, text);
  dispatchInput(el, text);
  dispatchChange(el);
  blurEl(el);
  return el.value === text;
}

/** Date inputs only accept ISO strings; try to coerce common formats, else give up. */
export function toIsoDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split('/');
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(t)) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return null;
}
