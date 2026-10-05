import { buildDescriptors } from '../detect/descriptor';
import { defaultFill } from '../fill/fillers';
import type { PlatformAdapter } from './types';

/** Fallback for unknown sites: label-based matching over every control in the document. */
export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  detect: () => 0.1,
  getFields: (ctx) => buildDescriptors(ctx.doc, ctx.doc),
  fill: defaultFill,
};
