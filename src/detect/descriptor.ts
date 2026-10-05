import type { FieldDescriptor, FieldKind, FieldOption } from '../adapters/types';
import { PLACEHOLDER_OPTION } from '../config/optionSynonyms';
import { isCaptchaElement, isFillable } from '../fill/safety';
import { cleanLabel, normalize } from './normalize';
import { isOptionSelected } from './selection';

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search', 'range', 'color']);
// Custom dropdowns: ARIA comboboxes (react-select) and listbox buttons (Workday).
const CONTROL_SELECTOR = 'input, textarea, select, [role="combobox"], button[aria-haspopup="listbox"]';
const MAX_NEARBY_CHARS = 200;

/** Text of an element excluding form controls (so a wrapping <label> yields only its caption). */
function captionText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, button, script, style, [role="listbox"]').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function byIdsText(doc: Document, ids: string | null): string {
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id))
    .filter((n): n is HTMLElement => !!n)
    .map((n) => captionText(n))
    .join(' ')
    .trim();
}

function isHiddenByStyle(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden || n.getAttribute('aria-hidden') === 'true') return true;
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  }
  return false;
}

interface LabelIndex {
  forId: Map<string, HTMLLabelElement>;
}

function buildLabelIndex(doc: Document): LabelIndex {
  const forId = new Map<string, HTMLLabelElement>();
  doc.querySelectorAll('label[for]').forEach((l) => forId.set(l.getAttribute('for')!, l as HTMLLabelElement));
  return { forId };
}

function labelFor(el: HTMLElement, idx: LabelIndex): string {
  const doc = el.ownerDocument;
  const fromLabelledBy = byIdsText(doc, el.getAttribute('aria-labelledby'));
  if (fromLabelledBy) return fromLabelledBy;
  const explicit = el.id ? idx.forId.get(el.id) : undefined;
  if (explicit) return captionText(explicit);
  const wrapping = el.closest('label');
  if (wrapping) {
    const t = captionText(wrapping);
    if (t) return t;
  }
  // A <label> with no `for`, sitting directly before the control or as the control wrapper's caption.
  const prev = el.previousElementSibling;
  if (prev?.tagName === 'LABEL' && !prev.hasAttribute('for')) return captionText(prev);
  const parent = el.parentElement;
  if (parent && parent.querySelectorAll(CONTROL_SELECTOR).length === 1) {
    const own = Array.from(parent.children).find((c) => c.tagName === 'LABEL' && !c.hasAttribute('for'));
    if (own) return captionText(own);
  }
  return '';
}

/** True when the field holds an answer right now (files count by attachment). */
export function hasValue(d: FieldDescriptor): boolean {
  if (d.kind === 'file') return !!(d.element as HTMLInputElement).files?.length;
  return currentAnswerText(d) !== '';
}

/** Closest preceding text that is not the control's own caption: used when there is no label. */
function nearbyTextFor(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    let prev = node.previousElementSibling;
    while (prev) {
      const t = captionText(prev);
      if (t && t.length <= MAX_NEARBY_CHARS) return t;
      prev = prev.previousElementSibling;
    }
  }
  return '';
}

function groupLabel(first: HTMLElement): string {
  const doc = first.ownerDocument;
  const fieldset = first.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend) return captionText(legend);
  const grp = first.closest('[role="radiogroup"],[role="group"]');
  if (grp) {
    const l = byIdsText(doc, grp.getAttribute('aria-labelledby')) || grp.getAttribute('aria-label') || '';
    if (l) return l;
  }
  return nearbyTextFor(first.closest('div,li,p') ?? first);
}

function selectOptions(sel: HTMLSelectElement): FieldOption[] {
  return Array.from(sel.options).map((o) => ({ text: o.text.trim(), value: o.value, element: o }));
}

function isPlaceholderOption(text: string, value: string): boolean {
  return value === '' || PLACEHOLDER_OPTION.test(normalize(text));
}

function readCurrentValue(el: HTMLElement, kind: FieldKind, group?: HTMLInputElement[]): string {
  if (kind === 'select') {
    const s = el as HTMLSelectElement;
    const o = s.selectedOptions[0];
    return o && !isPlaceholderOption(o.text, o.value) ? o.text.trim() : '';
  }
  if (kind === 'radio' || kind === 'checkbox') return group?.some((r) => isOptionSelected(r)) ? 'checked' : '';
  if (kind === 'file') return (el as HTMLInputElement).files?.length ? (el as HTMLInputElement).files![0]!.name : '';
  if (kind === 'combobox') {
    if (el instanceof HTMLButtonElement) {
      // Listbox buttons show the chosen value as their text; "Select One" is the empty state.
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      return PLACEHOLDER_OPTION.test(normalize(t)) ? '' : t;
    }
    const typed = (el as HTMLInputElement).value ?? '';
    if (typed) return typed;
    const shown = el.closest('[class*="control" i], [class*="select" i]')?.querySelector('[class*="singleValue" i], [class*="single-value" i]');
    return shown?.textContent?.trim() ?? '';
  }
  return (el as HTMLInputElement | HTMLTextAreaElement).value ?? '';
}

/** What the control holds right now, as human-readable answer text (re-reads the live DOM). */
export function currentAnswerText(d: FieldDescriptor): string {
  if (d.kind === 'radio' || d.kind === 'checkbox') {
    const chosen = (d.options ?? []).filter((o) => isOptionSelected(o.element));
    return chosen.map((o) => o.text).join(', ');
  }
  if (d.kind === 'file') return '';
  return readCurrentValue(d.element, d.kind).trim();
}

function isRequired(el: HTMLElement, label: string, group?: HTMLElement[]): boolean {
  const flag = (e: HTMLElement) =>
    (e as HTMLInputElement).required === true || e.getAttribute('aria-required') === 'true';
  return (group ?? [el]).some(flag) || /\*\s*$|\(required\)\s*$|\brequired\b\s*$/i.test(label);
}

function kindOf(el: HTMLElement): FieldKind | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  if (el.getAttribute('role') === 'combobox') return 'combobox';
  if (el instanceof HTMLButtonElement) return el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : null;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    if (SKIP_INPUT_TYPES.has(t)) return null;
    if (t === 'radio') return 'radio';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'file') return 'file';
    if (t === 'date' || t === 'month') return 'date';
    return el.hasAttribute('aria-autocomplete') && el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : 'text';
  }
  return null;
}

/**
 * Build a descriptor for every fillable control in `root`. Radio/checkbox groups that share a
 * name become a single descriptor with `options`.
 */
export function buildDescriptors(root: ParentNode, doc: Document = (root as Document).ownerDocument ?? (root as Document)): FieldDescriptor[] {
  const idx = buildLabelIndex(doc);
  const out: FieldDescriptor[] = [];
  const seenGroups = new Set<string>();
  const controls = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
  let counter = 0;

  for (const el of controls) {
    if (!isFillable(el) || isCaptchaElement(el)) continue;
    // A combobox wrapper that contains the real input: the inner input is the control.
    if (el.getAttribute('role') === 'combobox' && !(el instanceof HTMLInputElement) && el.querySelector('input[role="combobox"]')) continue;
    const kind = kindOf(el);
    if (!kind) continue;
    if (kind !== 'file' && isHiddenByStyle(el)) continue;

    let group: HTMLInputElement[] | undefined;
    let options: FieldOption[] | undefined;
    let label = '';

    if (kind === 'radio' || kind === 'checkbox') {
      const input = el as HTMLInputElement;
      const scope = input.form ?? doc;
      const siblings = input.name
        ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${kind}"]`)).filter((i) => i.name === input.name)
        : [input];
      const key = `${kind}:${input.name || counter}:${input.form?.id ?? ''}`;
      if (input.name && seenGroups.has(key)) continue;
      seenGroups.add(key);
      group = siblings.filter((s) => !isHiddenByStyle(s) || s.type === kind);
      options = group.map((s) => ({
        text: labelFor(s, idx) || s.getAttribute('aria-label') || s.value,
        value: s.value,
        element: s,
      }));
      label = group.length > 1 ? groupLabel(group[0]!) : labelFor(el, idx) || groupLabel(el);
    } else if (kind === 'select') {
      options = selectOptions(el as HTMLSelectElement).filter((o) => !isPlaceholderOption(o.text, o.value));
      label = labelFor(el, idx);
    } else {
      label = labelFor(el, idx);
    }

    const ariaLabel = el.getAttribute('aria-label') ?? undefined;
    const placeholder = (el as HTMLInputElement).placeholder || undefined;
    const nearby = !label && !ariaLabel ? nearbyTextFor(el) : undefined;

    out.push({
      id: `f${counter++}`,
      element: group?.[0] ?? el,
      kind,
      label: cleanLabel(label || ariaLabel || ''),
      ariaLabel,
      placeholder,
      name: (el as HTMLInputElement).name || undefined,
      htmlId: el.id || undefined,
      autocomplete: el.getAttribute('autocomplete') ?? undefined,
      automationId: el.getAttribute('data-automation-id') ?? undefined,
      nearbyText: nearby,
      options,
      required: isRequired(el, label, group),
      currentValue: readCurrentValue(el, kind, group),
    });
  }
  return out;
}
