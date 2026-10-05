import { dispatchChange, dispatchInput } from './text';
import { isCaptchaElement } from './safety';

/** Attach a File to an <input type=file> via DataTransfer, as a user selection would. */
export function attachFile(input: HTMLInputElement, file: File): boolean {
  if (isCaptchaElement(input) || input.disabled) return false;
  const win = input.ownerDocument.defaultView as any;
  const dt = new win.DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  dispatchInput(input);
  dispatchChange(input);
  return input.files?.length === 1;
}

/** Simulate dropping a file on a drag-and-drop upload zone. */
export function dropFile(target: Element, file: File): boolean {
  if (isCaptchaElement(target)) return false;
  const win = target.ownerDocument.defaultView as any;
  const dt = new win.DataTransfer();
  dt.items.add(file);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new win.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }
  return true;
}

/** Nearest element that looks like an upload drop zone around a file input. */
export function findDropzone(input: HTMLInputElement): HTMLElement | null {
  return input.closest<HTMLElement>('[class*="drop" i], [data-testid*="drop" i], [data-automation-id*="drop" i], [role="button"]');
}
