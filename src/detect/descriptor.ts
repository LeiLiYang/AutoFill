import type { FieldDescriptor, FieldKind, FieldOption, Section } from '../adapters/types';
import { PLACEHOLDER_OPTION } from '../config/optionSynonyms';
import { isCaptchaElement, isFillable } from '../fill/safety';
import { deepQueryAll, parentAcrossShadow } from './deepQuery';
import { attrWords, cleanLabel, normalize } from './normalize';
import { isOptionSelected } from './selection';

const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search', 'range', 'color']);
// Custom dropdowns: ARIA comboboxes (react-select) and listbox triggers (Workday buttons, MUI divs).
// Custom choices: ARIA radios, checkboxes and switches. Rich-text answers: contenteditable boxes.
export const CONTROL_SELECTOR =
  'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], [role="radio"], [role="checkbox"], [role="switch"], [contenteditable="true"], [contenteditable=""]';
/** Caption elements that are really validation or help text, not the field's name. */
const NOT_A_CAPTION = /error|invalid|help|hint|descr|counter|tooltip/i;
const MAX_NEARBY_CHARS = 200;

/** Text of an element excluding form controls (so a wrapping <label> yields only its caption). */
function captionText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, button, script, style, [role="listbox"]').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Where an element's id references resolve: its shadow root if it is in one, else the document. */
function idScope(el: Element): { getElementById(id: string): HTMLElement | null } {
  const root = el.getRootNode?.();
  return root && 'getElementById' in root ? (root as Document | ShadowRoot) : el.ownerDocument;
}

function byIdsText(scope: { getElementById(id: string): HTMLElement | null }, ids: string | null): string {
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => scope.getElementById(id))
    .filter((n): n is HTMLElement => !!n)
    .map((n) => captionText(n))
    .join(' ')
    .trim();
}

function isHiddenByStyle(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  for (let n: Element | null = el; n; n = parentAcrossShadow(n)) {
    if ((n as HTMLElement).hidden || n.getAttribute('aria-hidden') === 'true') return true;
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  }
  return false;
}

interface LabelIndex {
  /** The `<label for>` pointing at this element, looked up in the element's own tree (document or shadow root). */
  forEl(el: Element): HTMLLabelElement | undefined;
}

function buildLabelIndex(): LabelIndex {
  const byRoot = new Map<Node, Map<string, HTMLLabelElement>>();
  return {
    forEl(el) {
      if (!el.id) return undefined;
      const root = el.getRootNode?.() ?? el.ownerDocument;
      let map = byRoot.get(root);
      if (!map) {
        map = new Map();
        (root as ParentNode).querySelectorAll?.('label[for]').forEach((l) => map!.set(l.getAttribute('for')!, l as HTMLLabelElement));
        byRoot.set(root, map);
      }
      return map.get(el.id);
    },
  };
}

const realControls = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter((c) => !(c instanceof HTMLInputElement && c.type === 'hidden'));

/**
 * A caption that is not a <label>: in-house forms often use `<div class="label">`, a legend or a
 * <dt> next to the control. Only trusted while the wrapper holds this one control.
 */
function captionNear(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    if (realControls(node).length > 1) break;
    const cap = Array.from(node.querySelectorAll<HTMLElement>('[class*="label" i], legend, dt')).find(
      (c) => !c.contains(el) && !el.contains(c) && !NOT_A_CAPTION.test(c.getAttribute('class') ?? ''),
    );
    const t = cap ? captionText(cap) : '';
    if (t && t.length <= MAX_NEARBY_CHARS) return t;
  }
  return '';
}

function labelFor(el: HTMLElement, idx: LabelIndex): string {
  const fromLabelledBy = byIdsText(idScope(el), el.getAttribute('aria-labelledby'));
  if (fromLabelledBy) return fromLabelledBy;
  const explicit = idx.forEl(el);
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
  // Floating labels sit after the input.
  const next = el.nextElementSibling;
  if (next?.tagName === 'LABEL' && !next.hasAttribute('for')) return captionText(next);
  return captionNear(el);
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

const EDUCATION_WORDS = /\b(education|school|university|college|academic)\b/;
const EXPERIENCE_WORDS = /\b(work experience|work history|employment|experience|employer|job history)\b/;

/**
 * Whether a field sits in the Education or the Work experience part of a form, judged from the ids,
 * classes and automation ids of the field and its wrappers, and from the nearest heading above it.
 * Repeated sections are common ("Education 1", "Work Experience 2"), and the same label ("Start date
 * month") means different data in each.
 */
export function sectionOf(el: HTMLElement): Section | undefined {
  const classify = (words: string): Section | undefined =>
    EDUCATION_WORDS.test(words) ? 'education' : EXPERIENCE_WORDS.test(words) ? 'experience' : undefined;

  let n: HTMLElement | null = el;
  for (let depth = 0; n && depth < 8; depth++, n = n.parentElement) {
    const own = [n.id, n.getAttribute('data-automation-id'), n.getAttribute('data-testid'), n.getAttribute('class'), n.getAttribute('aria-label'), n.getAttribute('name')]
      .filter(Boolean)
      .map((v) => attrWords(v))
      .join(' ');
    const hit = classify(own);
    if (hit) return hit;
    // A heading or legend just before this block names the section.
    for (let prev = n.previousElementSibling, hops = 0; prev && hops < 3; prev = prev.previousElementSibling, hops++) {
      if (/^(H[1-6]|LEGEND)$/.test(prev.tagName) || prev.getAttribute('role') === 'heading') {
        const h = classify(normalize(prev.textContent ?? ''));
        if (h) return h;
        break;
      }
    }
    if (n.tagName === 'FORM') break;
  }
  return undefined;
}

function groupLabel(first: HTMLElement): string {
  const fieldset = first.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend) return captionText(legend);
  const grp = first.closest('[role="radiogroup"],[role="group"]');
  if (grp) {
    const l = byIdsText(idScope(grp), grp.getAttribute('aria-labelledby')) || grp.getAttribute('aria-label') || '';
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

function readCurrentValue(el: HTMLElement, kind: FieldKind, group?: HTMLElement[]): string {
  if (kind === 'select') {
    const s = el as HTMLSelectElement;
    const o = s.selectedOptions[0];
    return o && !isPlaceholderOption(o.text, o.value) ? o.text.trim() : '';
  }
  if (kind === 'radio' || kind === 'checkbox') return group?.some((r) => isOptionSelected(r)) ? 'checked' : '';
  if (kind === 'file') return (el as HTMLInputElement).files?.length ? (el as HTMLInputElement).files![0]!.name : '';
  if (kind === 'combobox') {
    if (!(el instanceof HTMLInputElement)) {
      // Listbox triggers show the chosen value as their text; "Select One" is the empty state.
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      return PLACEHOLDER_OPTION.test(normalize(t)) ? '' : t;
    }
    const typed = (el as HTMLInputElement).value ?? '';
    if (typed) return typed;
    const shown = el.closest('[class*="control" i], [class*="select" i]')?.querySelector('[class*="singleValue" i], [class*="single-value" i]');
    return shown?.textContent?.trim() ?? '';
  }
  if (kind === 'textarea' && !(el instanceof HTMLTextAreaElement)) return (el.textContent ?? '').trim(); // contenteditable
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
  const role = el.getAttribute('role');
  if (role === 'combobox') return 'combobox';
  if (!(el instanceof HTMLInputElement)) {
    if (el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
    if (role === 'radio') return 'radio';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    return el.hasAttribute('contenteditable') ? 'textarea' : null;
  }
  const t = el.type;
  if (SKIP_INPUT_TYPES.has(t)) return null;
  if (t === 'radio') return 'radio';
  if (t === 'checkbox') return 'checkbox';
  if (t === 'file') return 'file';
  if (t === 'date' || t === 'month') return 'date';
  return el.hasAttribute('aria-autocomplete') && el.getAttribute('aria-haspopup') === 'listbox' ? 'combobox' : 'text';
}

/**
 * A native radio, checkbox or select that the site hides behind its own styled widget. It is still
 * the real control (clicking or setting it works), as long as it is the control itself that is
 * hidden and not the whole section around it.
 */
function isStyledNative(el: HTMLElement, idx: LabelIndex): boolean {
  const parent = el.parentElement;
  if (el instanceof HTMLSelectElement) {
    // A custom dropdown next to it is discovered on its own; do not answer the same question twice.
    return !!parent && !isHiddenByStyle(parent) && !parent.querySelector('[role="combobox"], [aria-haspopup="listbox"]');
  }
  if (!(el instanceof HTMLInputElement) || (el.type !== 'radio' && el.type !== 'checkbox')) return false;
  if (parent && !isHiddenByStyle(parent)) return true;
  const label = el.closest('label') ?? idx.forEl(el);
  return !!label && !isHiddenByStyle(label);
}

/** Text of a custom (ARIA) radio or checkbox. */
function ariaOptionText(el: HTMLElement, idx: LabelIndex): string {
  const explicit = idx.forEl(el);
  return (
    byIdsText(idScope(el), el.getAttribute('aria-labelledby')) ||
    (explicit ? captionText(explicit) : '') ||
    el.getAttribute('aria-label') ||
    (el.textContent ?? '').replace(/\s+/g, ' ').trim() ||
    labelFor(el, idx)
  );
}

/**
 * Build a descriptor for every fillable control in `root`. Radio/checkbox groups that share a
 * name become a single descriptor with `options`.
 */
export function buildDescriptors(root: ParentNode, doc: Document = (root as Document).ownerDocument ?? (root as Document)): FieldDescriptor[] {
  const idx = buildLabelIndex();
  const out: FieldDescriptor[] = [];
  const seenGroups = new Set<string>();
  const seenAria = new Set<HTMLElement>();
  const controls = deepQueryAll<HTMLElement>(root, CONTROL_SELECTOR);
  let counter = 0;

  for (const el of controls) {
    if (!isFillable(el) || isCaptchaElement(el)) continue;
    // A combobox wrapper that contains the real input: the inner input is the control.
    if (!(el instanceof HTMLInputElement) && el.querySelector('input[role="combobox"]')) continue;
    const kind = kindOf(el);
    if (!kind) continue;
    if (kind !== 'file' && isHiddenByStyle(el) && !isStyledNative(el, idx)) continue;

    let group: HTMLElement[] | undefined;
    let options: FieldOption[] | undefined;
    let label = '';

    if ((kind === 'radio' || kind === 'checkbox') && !(el instanceof HTMLInputElement)) {
      // Custom ARIA choices: radios group by their radiogroup, checkboxes only by a labelled group.
      if (seenAria.has(el)) continue;
      const role = el.getAttribute('role')!;
      const container =
        kind === 'radio' ? el.closest('[role="radiogroup"]') : el.closest('[role="group"][aria-labelledby], [role="group"][aria-label]');
      const members = container ? Array.from(container.querySelectorAll<HTMLElement>(`[role="${role}"]`)) : [el];
      members.forEach((m) => seenAria.add(m));
      group = members;
      options = members.map((m) => ({ text: ariaOptionText(m, idx), value: m.getAttribute('value') ?? m.getAttribute('data-value') ?? '', element: m }));
      label = members.length > 1 ? groupLabel(members[0]!) : labelFor(el, idx) || groupLabel(el);
    } else if (kind === 'radio' || kind === 'checkbox') {
      const input = el as HTMLInputElement;
      const scope = input.form ?? ((input.getRootNode?.() as ParentNode | undefined) ?? doc);
      const siblings = input.name
        ? Array.from(scope.querySelectorAll<HTMLInputElement>(`input[type="${kind}"]`)).filter((i) => i.name === input.name)
        : [input];
      const key = `${kind}:${input.name || counter}:${input.form?.id ?? ''}`;
      if (input.name && seenGroups.has(key)) continue;
      seenGroups.add(key);
      group = siblings;
      options = siblings.map((s) => ({
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

    const ariaLabel = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? undefined;
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
      testId: el.getAttribute('data-testid') ?? el.getAttribute('data-test-id') ?? el.getAttribute('data-qa') ?? undefined,
      nearbyText: nearby,
      options,
      section: sectionOf(el),
      required: isRequired(el, label, group),
      currentValue: readCurrentValue(el, kind, group),
    });
  }
  return out;
}
