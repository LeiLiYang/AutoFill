import { buildDescriptors } from '../detect/descriptor';
import { attrWords } from '../detect/normalize';
import type { AdapterContext, FieldDescriptor, ProfileKey } from './types';

/**
 * Descriptors for the form inside the first matching root selector (or the whole document).
 * A root that holds no fields was the wrong guess (another site reusing the same id): look at the
 * whole document rather than report an empty form.
 */
export function describeWithin(ctx: AdapterContext, rootSelectors: string[], skip: (d: FieldDescriptor) => boolean = () => false): FieldDescriptor[] {
  const root = rootSelectors.map((s) => ctx.doc.querySelector(s)).find(Boolean) ?? ctx.doc;
  const scoped = buildDescriptors(root, ctx.doc).filter((d) => !skip(d));
  if (scoped.length || root === ctx.doc) return scoped;
  return buildDescriptors(ctx.doc, ctx.doc).filter((d) => !skip(d));
}

export interface Hint {
  /** Tested against the field's attribute words ("job application first name"). */
  attr?: RegExp;
  /** Alternative to `attr`: any predicate over the descriptor (e.g. "inside the resume section"). */
  test?: (d: FieldDescriptor) => boolean;
  key: ProfileKey;
  only?: FieldDescriptor['kind'][];
}

/** Platform hints skip rule matching for fields whose ids/names we know. First matching hint wins. */
export function applyHints(ds: FieldDescriptor[], hints: Hint[]): FieldDescriptor[] {
  return ds.map((d) => {
    const words = [d.name, d.htmlId, d.automationId].filter(Boolean).map((v) => attrWords(v));
    const hint = hints.find(
      (h) =>
        (!h.only || h.only.includes(d.kind)) &&
        ((h.attr && words.some((w) => h.attr!.test(w))) || (h.test && h.test(d))),
    );
    return hint ? { ...d, hintedKey: hint.key } : d;
  });
}

/** Replace weak labels with the platform's own question element text. */
export function refineLabels(ds: FieldDescriptor[], questionText: (el: HTMLElement) => string | null): FieldDescriptor[] {
  return ds.map((d) => {
    const q = questionText(d.element);
    return q ? { ...d, label: q.replace(/\s+/g, ' ').replace(/[*✱]\s*$/, '').trim(), required: d.required || /[*✱]\s*$/.test(q.trim()) } : d;
  });
}

export const hostMatches = (ctx: AdapterContext, re: RegExp) => re.test(ctx.url.hostname);
