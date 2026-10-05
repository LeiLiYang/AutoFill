import type { FieldOption } from '../adapters/types';
import { NO, PLACEHOLDER_OPTION, YES } from '../config/optionSynonyms';
import { optionScore } from '../detect/fuzzy';
import { normalize } from '../detect/normalize';
import { isOptionSelected } from '../detect/selection';
import { safeClick } from './safety';
import { dispatchChange, dispatchInput, setNativeValue } from './text';

export interface PickedOption {
  option: FieldOption;
  score: number;
}

/** A group choice; `unconfirmed` = a custom button was clicked but the page showed no visible change. */
export interface GroupChoice extends PickedOption {
  unconfirmed?: boolean;
}

export const boolTargets = (value: boolean): string[] => (value ? YES : NO);

/** Best option for any of the targets; placeholders are never chosen. */
export function pickOption(options: FieldOption[], targets: string[]): PickedOption | null {
  let best: PickedOption | null = null;
  for (const option of options) {
    if (PLACEHOLDER_OPTION.test(normalize(option.text))) continue;
    for (const t of targets) {
      const score = Math.max(optionScore(option.text, t), optionScore(option.value, t) * 0.9);
      if (score > 0 && (!best || score > best.score)) best = { option, score };
    }
  }
  return best;
}

/** Minimum option score considered a real match. */
export const MIN_OPTION_SCORE = 0.6;

export function selectNative(select: HTMLSelectElement, targets: string[]): PickedOption | null {
  const options: FieldOption[] = Array.from(select.options).map((o) => ({ text: o.text.trim(), value: o.value, element: o }));
  const picked = pickOption(options, targets);
  if (!picked || picked.score < MIN_OPTION_SCORE) return null;
  select.focus();
  setNativeValue(select, picked.option.value);
  dispatchInput(select);
  dispatchChange(select);
  select.blur();
  return select.value === picked.option.value ? picked : null;
}

/** Click the best-matching radio/checkbox option. Returns null when nothing matches well. */
export function chooseInGroup(options: FieldOption[], targets: string[]): GroupChoice | null {
  const picked = pickOption(options, targets);
  if (!picked || picked.score < MIN_OPTION_SCORE) return null;
  const el = picked.option.element!;
  if (isOptionSelected(el)) return picked;

  const snapshot = () => options.map((o) => o.element?.outerHTML ?? '').join('|');
  const before = snapshot();
  if (!safeClick(el)) return null;
  if (isOptionSelected(el)) return picked;

  // A real radio/checkbox that did not become checked failed. A custom button group may show its
  // selection in a way we cannot read: if the DOM changed the click registered, otherwise say so.
  if (el instanceof HTMLInputElement) return null;
  return snapshot() !== before ? picked : { ...picked, unconfirmed: true };
}

/** Set a lone checkbox to the desired state. */
export function setCheckbox(input: HTMLInputElement, checked: boolean): boolean {
  if (input.checked !== checked && !safeClick(input)) return false;
  return input.checked === checked;
}
